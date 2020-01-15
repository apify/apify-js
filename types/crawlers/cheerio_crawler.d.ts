export default CheerioCrawler;
/**
 * Provides a framework for the parallel crawling of web pages using plain HTTP requests and
 * <a href="https://www.npmjs.com/package/cheerio" target="_blank">cheerio</a> HTML parser.
 * The URLs to crawl are fed either from a static list of URLs
 * or from a dynamic queue of URLs enabling recursive crawling of websites.
 *
 * Since `CheerioCrawler` uses raw HTTP requests to download web pages,
 * it is very fast and efficient on data bandwidth. However, if the target website requires JavaScript
 * to display the content, you might need to use {@link PuppeteerCrawler} instead,
 * because it loads the pages using full-featured headless Chrome browser.
 *
 * `CheerioCrawler` downloads each URL using a plain HTTP request,
 * parses the HTML content using <a href="https://www.npmjs.com/package/cheerio" target="_blank">Cheerio</a>
 * and then invokes the user-provided [`handlePageFunction()`](#new_CheerioCrawler_new) to extract page data
 * using a <a href="https://jquery.com/" target="_blank">jQuery</a>-like interface to the parsed HTML DOM.
 *
 * The source URLs are represented using {@link Request} objects that are fed from
 * {@link RequestList} or {@link RequestQueue} instances provided by the [`requestList`](#new_CheerioCrawler_new)
 * or [`requestQueue`](#new_CheerioCrawler_new) constructor options, respectively.
 *
 * If both [`requestList`](#new_CheerioCrawler_new) and [`requestQueue`](#new_CheerioCrawler_new) are used,
 * the instance first processes URLs from the {@link RequestList} and automatically enqueues all of them
 * to {@link RequestQueue} before it starts their processing. This ensures that a single URL is not crawled multiple times.
 *
 * The crawler finishes when there are no more {@link Request} objects to crawl.
 *
 * By default, `CheerioCrawler` downloads HTML using the
 * <a href="https://www.npmjs.com/package/request" target="_blank">request</a> NPM package.
 * You can use the `requestOptions` parameter to pass additional options to `request`.
 *
 * New requests are only dispatched when there is enough free CPU and memory available,
 * using the functionality provided by the {@link AutoscaledPool} class.
 * All {@link AutoscaledPool} configuration options can be passed to the `autoscaledPoolOptions`
 * parameter of the `CheerioCrawler` constructor. For user convenience, the `minConcurrency` and `maxConcurrency`
 * {@link AutoscaledPool} options are available directly in the `CheerioCrawler` constructor.
 *
 * **Example usage:**
 *
 * ```javascript
 * // Prepare a list of URLs to crawl
 * const requestList = new Apify.RequestList({
 *   sources: [
 *       { url: 'http://www.example.com/page-1' },
 *       { url: 'http://www.example.com/page-2' },
 *   ],
 * });
 * await requestList.initialize();
 *
 * // Crawl the URLs
 * const crawler = new Apify.CheerioCrawler({
 *     requestList,
 *     handlePageFunction: async ({ request, response, body, contentType, $ }) => {
 *         const data = [];
 *
 *         // Do some data extraction from the page with Cheerio.
 *         $('.some-collection').each((index, el) => {
 *             data.push({ title: $(el).find('.some-title').text() });
 *         });
 *
 *         // Save the data to dataset.
 *         await Apify.pushData({
 *             url: request.url,
 *             html: body,
 *             data,
 *         })
 *     },
 * });
 *
 * await crawler.run();
 * ```
 */
declare class CheerioCrawler {
    /**
     * @param {Object} options All `CheerioCrawler` parameters are passed
     *   via an options object with the following keys:
     * @param {CheerioHandlePage} options.handlePageFunction
     *   User-provided function that performs the logic of the crawler. It is called for each page
     *   loaded and parsed by the crawler.
     *
     *   The function receives the following object as an argument:
     * ```
     * {
     *   $: Cheerio, // the Cheerio object with parsed HTML
     *   body: String|Buffer // the request body of the web page
     *   // the parsed object from JSON string
     *   // if the response contains the content type application/json
     *   json: Object,
     *   request: Request,
     *   contentType: Object, // Parsed Content-Type header: { type, encoding }
     *   response: Object // An instance of Node's http.IncomingMessage object,
     *   autoscaledPool: AutoscaledPool,
     *   session: Session
     * }
     * ```
     *   Type of `body` depends on web page `Content-Type` header.
     *   - String for `text/html`, `application/xhtml+xml`, `application/xml` mime types
     *   - Buffer for others mime types
     *
     *   Parsed `Content-Type` header using
     *   <a href="https://www.npmjs.com/package/content-type" target="_blank">content-type package</a>
     *   is stored in `contentType`.
     *
     *   Cheerio is available only for HTML and XML content types.
     *
     *   With the {@link Request} object representing the URL to crawl.
     *
     *   If the function returns a promise, it is awaited by the crawler.
     *
     *   If the function throws an exception, the crawler will try to re-crawl the
     *   request later, up to `option.maxRequestRetries` times.
     *   If all the retries fail, the crawler calls the function
     *   provided to the `options.handleFailedRequestFunction` parameter.
     *   To make this work, you should **always**
     *   let your function throw exceptions rather than catch them.
     *   The exceptions are logged to the request using the
     *   [`request.pushErrorMessage`](request#Request+pushErrorMessage) function.
     * @param {RequestList} options.requestList
     *   Static list of URLs to be processed.
     *   Either `requestList` or `requestQueue` option must be provided (or both).
     * @param {RequestQueue} options.requestQueue
     *   Dynamic queue of URLs to be processed. This is useful for recursive crawling of websites.
     *   Either `requestList` or `requestQueue` option must be provided (or both).
     * @param {Object} [options.requestOptions]
     *   Represents the options passed to
     *   <a href="https://www.npmjs.com/package/request" target="_blank">request</a> to make the HTTP call.
     *   Provided `requestOptions` are added to internal defaults that cannot be overridden to ensure
     *   the operation of `CheerioCrawler` and all its options. Headers will not be merged,
     *   use {@link RequestList} and/or {@link RequestQueue} to initialize your {@link Request} with the
     *   correct headers or use `options.prepareRequestFunction` to modify your {@link Request} dynamically.
     *   If you need more granular control over your requests, use {@link BasicCrawler}.
     *
     *   The mandatory internal defaults that **CANNOT BE OVERRIDDEN** by `requestOptions`:
     *   ```
     *   {
     *       url,       // Provided by RequestList and/or RequestQueue
     *       method,    // Provided by RequestList and/or RequestQueue
     *       headers,   // Provided by RequestList and/or RequestQueue
     *       payload,   // Provided by RequestList and/or RequestQueue
     *       strictSSL, // Use options.ignoreSslErrors
     *       proxy,     // Use options.useApifyProxy or options.proxyUrls
     *   }
     *   ```
     * @param {PrepareRequest} [options.prepareRequestFunction]
     *   A function that executes before the HTTP request is made to the target resource.
     *   This function is suitable for setting dynamic properties such as cookies to the {@link Request}.
     *
     *   The function receives the following object as an argument:
     * ```
     * {
     *   request: Request,
     *   session: Session
     * }
     * ```
     *   where the {@link Request} instance corresponds to the initialized request.
     *
     *   The function should modify the properties of the passed {@link Request} instance
     *   in place because there are already earlier references to it. Making a copy and returning it from
     *   this function is therefore not supported, because it would create inconsistencies where
     *   different parts of SDK would have access to a different {@link Request} instance.
     *
     * @param {Number} [options.handlePageTimeoutSecs=60]
     *   Timeout in which the function passed as `options.handlePageFunction` needs to finish, given in seconds.
     * @param {Number} [options.requestTimeoutSecs=30]
     *   Timeout in which the HTTP request to the resource needs to finish, given in seconds.
     * @param {Boolean} [options.ignoreSslErrors=true]
     *   If set to true, SSL certificate errors will be ignored.
     * @param {Boolean} [options.useApifyProxy=false]
     *   If set to `true`, `CheerioCrawler` will be configured to use
     *   <a href="https://my.apify.com/proxy" target="_blank">Apify Proxy</a> for all connections.
     *   For more information, see the <a href="https://docs.apify.com/proxy" target="_blank">documentation</a>
     * @param {String[]} [options.apifyProxyGroups]
     *   An array of proxy groups to be used
     *   by the <a href="https://docs.apify.com/proxy" target="_blank">Apify Proxy</a>.
     *   Only applied if the `useApifyProxy` option is `true`.
     * @param {String} [options.apifyProxySession]
     *   Apify Proxy session identifier to be used with requests made by `CheerioCrawler`.
     *   All HTTP requests going through the proxy with the same session identifier
     *   will use the same target proxy server (i.e. the same IP address).
     *   The identifier can only contain the following characters: `0-9`, `a-z`, `A-Z`, `"."`, `"_"` and `"~"`.
     *   Only applied if the `useApifyProxy` option is `true`.
     * @param {String[]} [options.proxyUrls]
     *   An array of custom proxy URLs to be used by the `CheerioCrawler` instance.
     *   The provided custom proxies' order will be randomized and the resulting list rotated.
     *   Custom proxies are not compatible with Apify Proxy and an attempt to use both
     *   configuration options will cause an error to be thrown on startup.
     * @param {HandleFailedRequest} [options.handleFailedRequestFunction]
     *   A function to handle requests that failed more than `option.maxRequestRetries` times.
     *
     *   The function receives the following object as an argument:
     * ```
     * {
     *   request: Request,
     *   error: Error,
     * }
     * ```
     *   where the {@link Request} instance corresponds to the failed request, and the `Error` instance
     *   represents the last error thrown during processing of the request.
     *
     *   See <a href="https://github.com/apifytech/apify-js/blob/master/src/crawlers/cheerio_crawler.js#L13">source code</a>
     *   for the default implementation of this function.
     * @param {String[]} [options.additionalMimeTypes]
     *   An array of <a href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Complete_list_of_MIME_types"
     *   target="_blank">mime types</a> you want to process.
     *   By default `text/html`, `application/xhtml+xml` mime types are supported.
     * @param {Number} [options.maxRequestRetries=3]
     *   Indicates how many times the request is retried if either `requestFunction` or `handlePageFunction` fails.
     * @param {Number} [options.maxRequestsPerCrawl]
     *   Maximum number of pages that the crawler will open. The crawl will stop when this limit is reached.
     *   Always set this value in order to prevent infinite loops in misconfigured crawlers.
     *   Note that in cases of parallel crawling, the actual number of pages visited might be slightly higher than this value.
     * @param {Object} [options.autoscaledPoolOptions]
     *   Custom options passed to the underlying {@link AutoscaledPool} constructor.
     *   Note that the `runTaskFunction`, `isTaskReadyFunction` and `isFinishedFunction` options
     *   are provided by `CheerioCrawler` and cannot be overridden. Reasonable {@link Snapshotter}
     *   and {@link SystemStatus} defaults are provided to account for the fact that `cheerio`
     *   parses HTML synchronously and therefore blocks the event loop.
     * @param {Number} [options.minConcurrency=1]
     *   Sets the minimum concurrency (parallelism) for the crawl. Shortcut to the corresponding {@link AutoscaledPool} option.
     *
     *   *WARNING:* If you set this value too high with respect to the available system memory and CPU, your crawler will run extremely slow or crash.
     *   If you're not sure, just keep the default value and the concurrency will scale up automatically.
     * @param {Number} [options.maxConcurrency=1000]
     *   Sets the maximum concurrency (parallelism) for the crawl. Shortcut to the corresponding {@link AutoscaledPool} option.
     * @param {Boolean} [options.useSessionPool=false]
     *   If set to true Crawler will automatically use Session Pool. It will automatically retire sessions on 403, 401 and 429 status codes.
     *   It also marks Session as bad after a request timeout.
     * @param {Object} [options.sessionPoolOptions]
     *   Custom options passed to the underlying {@link SessionPool} constructor.
     * @param {Boolean} [options.persistCookiesPerSession]
     *   Automatically saves cookies to Session. Works only if Session Pool is used.
     *
     *   It parses cookie from response "set-cookie" header saves or updates cookies for session and once the session is used for next request.
     *   It passes the "Cookie" header to the request with the session cookies.
     */
    constructor(options?: {
        handlePageFunction: any;
        requestList: RequestList;
        requestQueue: RequestQueue;
        requestOptions?: any;
        prepareRequestFunction?: any;
        handlePageTimeoutSecs?: number;
        requestTimeoutSecs?: number;
        ignoreSslErrors?: boolean;
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxySession?: string;
        proxyUrls?: string[];
        handleFailedRequestFunction?: any;
        additionalMimeTypes?: string[];
        maxRequestRetries?: number;
        maxRequestsPerCrawl?: number;
        autoscaledPoolOptions?: any;
        minConcurrency?: number;
        maxConcurrency?: number;
        useSessionPool?: boolean;
        sessionPoolOptions?: any;
        persistCookiesPerSession?: boolean;
    });
    supportedMimeTypes: Set<string>;
    requestOptions: any;
    handlePageFunction: any;
    handlePageTimeoutMillis: number;
    requestTimeoutMillis: number;
    ignoreSslErrors: any;
    useApifyProxy: any;
    apifyProxyGroups: any;
    apifyProxySession: any;
    proxyUrls: any;
    lastUsedProxyUrlIndex: number;
    prepareRequestFunction: any;
    persistCookiesPerSession: any;
    useSessionPool: any;
    basicCrawler: BasicCrawler;
    isRunningPromise: Promise<void>;
    /**
     * Runs the crawler. Returns promise that gets resolved once all the requests got processed.
     *
     * @return {Promise}
     */
    run(): Promise<any>;
    /**
     * Wrapper around handlePageFunction that opens and closes pages etc.
     *
     * @ignore
     */
    _handleRequestFunction({ request, autoscaledPool, session }: {
        request: any;
        autoscaledPool: any;
        session: any;
    }): Promise<any>;
    /**
     * Function to make the HTTP request. It performs optimizations
     * on the request such as only downloading the request body if the
     * received content type matches text/html, application/xml, application/xhtml+xml.
     * @ignore
     */
    _requestFunction({ request, session }: {
        request: any;
        session: any;
    }): Promise<{
        dom: any;
        isXml: boolean;
        response: any;
        contentType: {
            type: string;
            encoding: any;
        };
        body?: undefined;
    } | {
        body: any;
        response: any;
        contentType: {
            type: string;
            encoding: any;
        };
        dom?: undefined;
        isXml?: undefined;
    }>;
    /**
     * Combines the provided `requestOptions` with mandatory (non-overridable) values.
     * @param {Request} request
     * @param {Session?} session
     * @ignore
     */
    _getRequestOptions(request: Request, session: any): any;
    /**
     * Enables the use of a proxy by returning a proxy URL
     * based on configured options or null if no proxy is used.
     * @param {Session?} session
     * @ignore
     */
    _getProxyUrl(session?: any): any;
    _encodeResponse(request: any, response: any, encoding: any): {
        response: any;
        encoding: any;
    };
    _parseHtmlToDom(response: any): Promise<any>;
    /**
     * Checks and extends supported mime types
     * @param additionalMimeTypes
     * @ignore
     */
    _extendSupportedMimeTypes(additionalMimeTypes: any): void;
    /**
     * Handles blocked request
     * @param session {Session}
     * @param statusCode {Number}
     * @private
     */
    _throwOnBlockedRequest(session: any, statusCode: number): void;
    /**
     * Handles timeout request
     * @param session {Session}
     * @private
     */
    _handleRequestTimeout(session: any): void;
}
import BasicCrawler from "./basic_crawler";
import Request from "../request";
import { RequestList } from "../request_list";
import { RequestQueue } from "../request_queue";