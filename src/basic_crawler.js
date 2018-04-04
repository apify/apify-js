import { checkParamOrThrow } from 'apify-client/build/utils';
import _ from 'underscore';
import log from 'apify-shared/log';
import { isPromise, checkParamPrototypeOrThrow } from './utils';
import AutoscaledPool from './autoscaled_pool';
import RequestList from './request_list';
import { RequestQueue } from './request_queue';

const DEFAULT_OPTIONS = {
    maxRequestRetries: 3,
    handleFailedRequestFunction: ({ request }) => log.error('Request failed', _.pick(request, 'url', 'uniqueKey')),
};

/**
 * BasicCrawler provides a simple framework for parallel crawling of a url list provided by `Apify.RequestList`
 * or a dynamically enqueued requests provided by `Apify.RequestQueue` (TODO).
 *
 * It's simply calling handleRequestFunction for each request from requestList or requestQueue as long as
 * both are not empty. The concurrency is scaled based on available memory using `Apify.AutoscaledPool` and all
 * of it's configuration parameters are supported here.
 *
 * Basic usage of BasicCrawler:
 *
 * ```javascript
 * const rp = require('request-promise');
 *
 * const crawler = new Apify.BasicCrawler({
 *     requestList,
 *     handleRequestFunction: async ({ request }) => {
 *         await Apify.pushData({
 *             html: await rp(request.url),
 *             url: request.url,
 *         })
 *     },
 * });
 *
 * await crawler.run();
 * ```
 *
 * @param {Object} options
 * @param {RequestList} [options.requestList] List of the requests to be processed.
 * @param {RequestList} [options.requestQueue] Queue of the requests to be processed.
 * @param {Function} options.handleRequestFunction Function that processes a request. It must return a promise.
 * @param {Function} [options.handleFailedRequestFunction=({ request, error }) => log.error('Request failed', _.pick(request, 'url', 'uniqueKey'))`]
 *                   Function to handle requests that failed more then option.maxRequestRetries times.
 * @param {Number} [options.maxRequestRetries=3] How many times request is retried if handleRequestFunction failed.
 * @param {Number} [options.maxMemoryMbytes] Maximal memory available in the system (see `maxMemoryMbytes` parameter of `Apify.AutoscaledPool`).
 * @param {Number} [options.maxConcurrency=1000] Maximal concurrency of request processing (see `maxConcurrency` parameter of `Apify.AutoscaledPool`).
 * @param {Number} [options.minConcurrency=1] Minimal concurrency of requests processing (see `minConcurrency` parameter of `Apify.AutoscaledPool`).
 * @param {Number} [options.minFreeMemoryRatio=0.2] Minumum ratio of free memory kept in the system.
 */
export default class BasicCrawler {
    constructor(opts) {
        const {
            requestList,
            requestQueue,
            handleRequestFunction,
            handleFailedRequestFunction,
            maxRequestRetries,

            // Autoscaled pool options
            maxMemoryMbytes,
            maxConcurrency,
            minConcurrency,
            minFreeMemoryRatio,
        } = _.defaults(opts, DEFAULT_OPTIONS);

        checkParamOrThrow(handleRequestFunction, 'opts.handleRequestFunction', 'Function');
        checkParamOrThrow(handleFailedRequestFunction, 'opts.handleFailedRequestFunction', 'Function');
        checkParamOrThrow(maxRequestRetries, 'opts.maxRequestRetries', 'Number');
        checkParamPrototypeOrThrow(requestList, 'opts.requestList', RequestList, 'Apify.RequestList', true);
        checkParamPrototypeOrThrow(requestQueue, 'opts.requestQueue', RequestQueue, 'Apify.RequestQueue', true);

        if (!requestList && !requestQueue) {
            throw new Error('At least one of the parameters "opts.requestList" and "opts.requestQueue" must be provided!');
        }

        this.requestList = requestList;
        this.requestQueue = requestQueue;
        this.handleRequestFunction = handleRequestFunction;
        this.handleFailedRequestFunction = handleFailedRequestFunction;
        this.maxRequestRetries = maxRequestRetries;

        this.autoscaledPool = new AutoscaledPool({
            maxMemoryMbytes,
            maxConcurrency,
            minConcurrency,
            minFreeMemoryRatio,
            handleTaskFunction: () => this._handleTaskFunction(),
            isFinishedFunction: () => this._isFinishedFunction(),
            isTaskReadyFunction: () => this._isTaskReadyFunction(),
        });
    }

    /**
     * Runs the crawler. Returns promise that gets resolved once all the requests got processed.
     *
     * @return {Promise}
     */
    run() {
        return this.autoscaledPool.run();
    }

    /**
     * Fetches request from either RequestList or RequestQueue. If request comes from a RequestList
     * and RequestQueue is present then enqueues it to the queue first.
     *
     * @ignore
     */
    _fetchNextRequest() {
        if (!this.requestList) return this.requestQueue.fetchNextRequest();

        return this.requestList
            .fetchNextRequest()
            .then((request) => {
                if (!this.requestQueue) return request;
                if (!request) return this.requestQueue.fetchNextRequest();

                return this.requestQueue
                    .addRequest(request, { forefront: true })
                    .then(() => {
                        return Promise
                            .all([
                                this.requestQueue.fetchNextRequest(),
                                this.requestList.markRequestHandled(request),
                            ])
                            .then(results => results[0]);
                    // If requestQueue.addRequest() fails here then we must reclaim it back to
                    // the RequestList because probably it's not yet in the queue!
                    }, (err) => {
                        log.exception(err, 'RequestQueue.addRequest() failed, reclaiming request back to queue', { request });

                        // Return null so that we finish immediately.
                        return this.requestList
                            .reclaimRequest(request)
                            .then(() => null);
                    });
            })
    }

    /**
     * Wrapper around handleRequestFunction that fetches requests from RequestList/RequestQueue
     * then retries them in a case of an error etc.
     *
     * @ignore
     */
    _handleTaskFunction() {
        const source = this.requestQueue || this.requestList;

        return this._fetchNextRequest()
            .then((request) => {
                if (!request) return;

                const handlePromise = this.handleRequestFunction({ request });
                if (!isPromise(handlePromise)) throw new Error('User provided handleRequestFunction must return a Promise.');

                return handlePromise
                    .then(() => source.markRequestHandled(request))
                    .catch((error) => {
                        request.pushErrorMessage(error);

                        // Retry request.
                        if (request.retryCount < this.maxRequestRetries) {
                            request.retryCount++;

                            return source.reclaimRequest(request);
                        }

                        // Mark as failed.
                        return source
                            .markRequestHandled(request)
                            .then(() => this.handleFailedRequestFunction({ request, error }));
                    });

            });
    }

    /**
     * Returns true if some RequestList and RequestQueue have request ready for processing.
     *
     * @ignore
     */
    _isTaskReadyFunction() {
        return Promise
            .resolve()
            .then(() => {
                if (!this.requestList) return false;

                return this.requestList.isEmpty();
            })
            .then((isRequestListEmpty) => {
                if (!isRequestListEmpty || !this.requestQueue) return isRequestListEmpty;

                return this.requestQueue.isEmpty();
            })
            .then(areBothEmpty => !areBothEmpty)
    }

    /**
     * Returns true if both RequestList and RequestQueue have all requests finished.
     *
     * @ignore
     */
    _isFinishedFunction() {
        const promises = [];

        if (this.requestList) promises.push(this.requestList.isFinished());
        if (this.requestQueue) promises.push(this.requestQueue.isFinished());

        return Promise
            .all(promises)
            .then(results => _.all(results));
    }
}
