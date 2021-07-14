import * as fs from 'fs';
import ow from 'ow';
import * as vm from 'vm';
import * as util from 'util';
import * as _ from 'underscore';
import { LruCache } from '@apify/datastructures';
import { Page, Response, DirectNavigationOptions } from 'puppeteer'; // eslint-disable-line no-unused-vars
import log from './utils_log';
import { validators } from './validators';

import { enqueueLinksByClickingElements } from './enqueue_links/click_elements';
import { addInterceptRequestHandler, removeInterceptRequestHandler } from './puppeteer_request_interception';
import { openKeyValueStore } from './storages/key_value_store';

const jqueryPath = require.resolve('jquery');
const underscorePath = require.resolve('underscore');
const readFilePromised = util.promisify(fs.readFile);

const MAX_INJECT_FILE_CACHE_SIZE = 10;
const DEFAULT_BLOCK_REQUEST_URL_PATTERNS = ['.css', '.jpg', '.jpeg', '.png', '.svg', '.gif', '.woff', '.pdf', '.zip'];

/**
 * @typedef {object} CompiledScriptParams
 * @property {Page} params.page
 * @property {Request} params.request
 */
/**
 * @callback CompiledScriptFunction
 * @param {CompiledScriptParams} params
 * @returns {Promise<*>}
 */
/**
 * Cache contents of previously injected files to limit file system access.
 */
const injectedFilesCache = new LruCache({ maxLength: MAX_INJECT_FILE_CACHE_SIZE });

/**
 * Injects a JavaScript file into a Puppeteer page.
 * Unlike Puppeteer's `addScriptTag` function, this function works on pages
 * with arbitrary Cross-Origin Resource Sharing (CORS) policies.
 *
 * File contents are cached for up to 10 files to limit file system access.
 *
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @param {string} filePath File path
 * @param {object} [options]
 * @param {boolean} [options.surviveNavigations]
 *   Enables the injected script to survive page navigations and reloads without need to be re-injected manually.
 *   This does not mean, however, that internal state will be preserved. Just that it will be automatically
 *   re-injected on each navigation before any other scripts get the chance to execute.
 * @return {Promise<*>}
 * @memberOf puppeteer
 */
const injectFile = async (page, filePath, options = {}) => {
    ow(page, ow.object.validate(validators.browserPage));
    ow(filePath, ow.string);
    ow(options, ow.object.exactShape({
        surviveNavigations: ow.optional.boolean,
    }));

    let contents = injectedFilesCache.get(filePath);
    if (!contents) {
        contents = await readFilePromised(filePath, 'utf8');
        injectedFilesCache.add(filePath, contents);
    }
    const evalP = page.evaluate(contents);
    return options.surviveNavigations
        ? Promise.all([page.evaluateOnNewDocument(contents), evalP])
        : evalP;
};

/**
 * Injects the [jQuery](https://jquery.com/) library into a Puppeteer page.
 * jQuery is often useful for various web scraping and crawling tasks.
 * For example, it can help extract text from HTML elements using CSS selectors.
 *
 * Beware that the injected jQuery object will be set to the `window.$` variable and thus it might cause conflicts with
 * other libraries included by the page that use the same variable name (e.g. another version of jQuery).
 * This can affect functionality of page's scripts.
 *
 * The injected jQuery will survive page navigations and reloads.
 *
 * **Example usage:**
 * ```javascript
 * await Apify.utils.puppeteer.injectJQuery(page);
 * const title = await page.evaluate(() => {
 *   return $('head title').text();
 * });
 * ```
 *
 * Note that `injectJQuery()` does not affect the Puppeteer's
 * [`page.$()`](https://pptr.dev/#?product=Puppeteer&show=api-pageselector)
 * function in any way.
 *
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @return {Promise<*>}
 * @memberOf puppeteer
 */
const injectJQuery = (page) => {
    ow(page, ow.object.validate(validators.browserPage));
    return injectFile(page, jqueryPath, { surviveNavigations: true });
};

/**
 * Injects the [Underscore](https://underscorejs.org/) library into a Puppeteer page.
 *
 * Beware that the injected Underscore object will be set to the `window._` variable and thus it might cause conflicts with
 * libraries included by the page that use the same variable name.
 * This can affect functionality of page's scripts.
 *
 * The injected Underscore will survive page navigations and reloads.
 *
 * **Example usage:**
 * ```javascript
 * await Apify.utils.puppeteer.injectUnderscore(page);
 * const escapedHtml = await page.evaluate(() => {
 *   return _.escape('<h1>Hello</h1>');
 * });
 * ```
 *
 * @param {Page} page Puppeteer [Page](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#class-page) object.
 * @return {Promise<*>}
 * @memberOf puppeteer
 */
const injectUnderscore = (page) => {
    ow(page, ow.object.validate(validators.browserPage));
    return injectFile(page, underscorePath, { surviveNavigations: true });
};

/**
 * Forces the Puppeteer browser tab to block loading URLs that match a provided pattern.
 * This is useful to speed up crawling of websites, since it reduces the amount
 * of data that needs to be downloaded from the web, but it may break some websites
 * or unexpectedly prevent loading of resources.
 *
 * By default, the function will block all URLs including the following patterns:
 *
 * ```json
 * [".css", ".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip"]
 * ```
 *
 * If you want to extend this list further, use the `extraUrlPatterns` option,
 * which will keep blocking the default patterns, as well as add your custom ones.
 * If you would like to block only specific patterns, use the `urlPatterns` option,
 * which will override the defaults and block only URLs with your custom patterns.
 *
 * This function does not use Puppeteer's request interception and therefore does not interfere
 * with browser cache. It's also faster than blocking requests using interception,
 * because the blocking happens directly in the browser without the round-trip to Node.js,
 * but it does not provide the extra benefits of request interception.
 *
 * The function will never block main document loads and their respective redirects.
 *
 * **Example usage**
 * ```javascript
 * const Apify = require('apify');
 *
 * const browser = await Apify.launchPuppeteer();
 * const page = await browser.newPage();
 *
 * // Block all requests to URLs that include `adsbygoogle.js` and also all defaults.
 * await Apify.utils.puppeteer.blockRequests(page, {
 *     extraUrlPatterns: ['adsbygoogle.js'],
 * });
 *
 * await page.goto('https://cnn.com');
 * ```
 *
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @param {object} [options]
 * @param {string[]} [options.urlPatterns]
 *   The patterns of URLs to block from being loaded by the browser.
 *   Only `*` can be used as a wildcard. It is also automatically added to the beginning
 *   and end of the pattern. This limitation is enforced by the DevTools protocol.
 *   `.png` is the same as `*.png*`.
 * @param {string[]} [options.extraUrlPatterns]
 *   If you just want to append to the default blocked patterns, use this property.
 * @return {Promise<void>}
 * @memberOf puppeteer
 */
const blockRequests = async (page, options = {}) => {
    ow(page, ow.object.validate(validators.browserPage));
    ow(options, ow.object.exactShape({
        urlPatterns: ow.optional.array.ofType(ow.string),
        extraUrlPatterns: ow.optional.array.ofType(ow.string),
    }));

    const {
        urlPatterns = DEFAULT_BLOCK_REQUEST_URL_PATTERNS,
        extraUrlPatterns = [],
    } = options;

    const patternsToBlock = [...urlPatterns, ...extraUrlPatterns];

    await page._client.send('Network.setBlockedURLs', { urls: patternsToBlock }); // eslint-disable-line no-underscore-dangle
};

/**
 * `blockResources()` has a high impact on performance in recent versions of Puppeteer.
 * 'Until this resolves, please use `Apify.utils.puppeteer.blockRequests()`.
 * @deprecated
 */
const blockResources = async (page, resourceTypes = ['stylesheet', 'font', 'image', 'media']) => {
    log.deprecated('Apify.utils.puppeteer.blockResources() has a high impact on performance in recent versions of Puppeteer. '
        + 'Until this resolves, please use Apify.utils.puppeteer.blockRequests()');
    await addInterceptRequestHandler(page, async (request) => {
        const type = request.resourceType();
        if (resourceTypes.includes(type)) await request.abort();
        else await request.continue();
    });
};

/**
 * *NOTE:* In recent versions of Puppeteer using this function entirely disables browser cache which resolves in sub-optimal
 * performance. Until this resolves, we suggest just relying on the in-browser cache unless absolutely necessary.
 *
 * Enables caching of intercepted responses into a provided object. Automatically enables request interception in Puppeteer.
 * *IMPORTANT*: Caching responses stores them to memory, so too loose rules could cause memory leaks for longer running crawlers.
 *   This issue should be resolved or atleast mitigated in future iterations of this feature.
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @param {Object<string, *>} cache
 *   Object in which responses are stored
 * @param {Array<(string|RegExp)>} responseUrlRules
 *   List of rules that are used to check if the response should be cached.
 *   String rules are compared as page.url().includes(rule) while RegExp rules are evaluated as rule.test(page.url()).
 * @return {Promise<void>}
 * @memberOf puppeteer
 * @deprecated
 */
const cacheResponses = async (page, cache, responseUrlRules) => {
    ow(page, ow.object.validate(validators.browserPage));
    ow(cache, ow.object);
    ow(responseUrlRules, ow.array.ofType(ow.any(ow.string, ow.regExp)));

    log.deprecated('Apify.utils.puppeteer.cacheResponses() has a high impact on performance '
        + 'in recent versions of Puppeteer so it\'s use is discouraged until this issue resolves.');

    await addInterceptRequestHandler(page, async (request) => {
        const url = request.url();

        if (cache[url]) {
            await request.respond(cache[url]);
            return;
        }

        await request.continue();
    });

    page.on('response', async (response) => {
        const url = response.url();

        // Response is already cached, do nothing
        if (cache[url]) return;

        const shouldCache = responseUrlRules.some((rule) => {
            if (typeof rule === 'string') return url.includes(rule);
            if (rule instanceof RegExp) return rule.test(url);
        });

        try {
            if (shouldCache) {
                const buffer = await response.buffer();
                cache[url] = {
                    status: response.status(),
                    headers: response.headers(),
                    body: buffer,
                };
            }
        } catch (e) {
            // ignore errors, usualy means that buffer is empty or broken connection
        }
    });
};

/**
 * Compiles a Puppeteer script into an async function that may be executed at any time
 * by providing it with the following object:
 * ```
 * {
 *    page: Page,
 *    request: Request,
 * }
 * ```
 * Where `page` is a Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page)
 * and `request` is a {@link Request}.
 *
 * The function is compiled by using the `scriptString` parameter as the function's body,
 * so any limitations to function bodies apply. Return value of the compiled function
 * is the return value of the function body = the `scriptString` parameter.
 *
 * As a security measure, no globals such as `process` or `require` are accessible
 * from within the function body. Note that the function does not provide a safe
 * sandbox and even though globals are not easily accessible, malicious code may
 * still execute in the main process via prototype manipulation. Therefore you
 * should only use this function to execute sanitized or safe code.
 *
 * Custom context may also be provided using the `context` parameter. To improve security,
 * make sure to only pass the really necessary objects to the context. Preferably making
 * secured copies beforehand.
 *
 * @param {string} scriptString
 * @param {Object<string, *>} context
 * @return {CompiledScriptFunction}
 * @memberOf puppeteer
 */
const compileScript = (scriptString, context = Object.create(null)) => {
    const funcString = `async ({ page, request }) => {${scriptString}}`;

    let func;
    try {
        func = vm.runInNewContext(funcString, context); // "Secure" the context by removing prototypes, unless custom context is provided.
    } catch (err) {
        log.exception(err, 'Cannot compile script!');
        throw err;
    }

    if (!_.isFunction(func)) throw new Error('Compilation result is not a function!'); // This should not happen...

    return func;
};

/**
 * Extended version of Puppeteer's `page.goto()` allowing to perform requests with HTTP method other than GET,
 * with custom headers and POST payload. URL, method, headers and payload are taken from
 * request parameter that must be an instance of Apify.Request class.
 *
 * *NOTE:* In recent versions of Puppeteer using requests other than GET, overriding headers and adding payloads disables
 * browser cache which degrades performance.
 *
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @param {Request} request
 * @param {DirectNavigationOptions} [gotoOptions] Custom options for `page.goto()`.
 * @return {Promise<(Response|null)>}
 *
 * @memberOf puppeteer
 * @name gotoExtended
 */
export const gotoExtended = async (page, request, gotoOptions = {}) => {
    ow(page, ow.object.validate(validators.browserPage));
    ow(request, ow.object.partialShape({
        url: ow.string.url,
        method: ow.optional.string,
        headers: ow.optional.object,
        payload: ow.optional.any(ow.string, ow.buffer),
    }));
    ow(gotoOptions, ow.object);

    const { url, method, headers, payload } = request;

    if (method !== 'GET' || payload || !_.isEmpty(headers)) {
        // This is not deprecated, we use it to log only once.
        log.deprecated('Using other request methods than GET, rewriting headers and adding payloads has a high impact on performance '
            + 'in recent versions of Puppeteer. Use only when necessary.');
        let wasCalled = false;
        const interceptRequestHandler = async (interceptedRequest) => {
            // We want to ensure that this won't get executed again in a case that there is a subsequent request
            // for example for some asset file link from main HTML.
            if (wasCalled) {
                return interceptedRequest.continue();
            }

            wasCalled = true;
            const overrides = {};

            if (method !== 'GET') overrides.method = method;
            if (payload) overrides.postData = payload;
            if (!_.isEmpty(headers)) overrides.headers = headers;
            await removeInterceptRequestHandler(page, interceptRequestHandler);
            interceptedRequest.continue(overrides);
        };

        await addInterceptRequestHandler(page, interceptRequestHandler);
    }

    return page.goto(url, gotoOptions);
};

/**
 * Scrolls to the bottom of a page, or until it times out.
 * Loads dynamic content when it hits the bottom of a page, and then continues scrolling.
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @param {object} [options]
 * @param {number} [options.timeoutSecs=0]
 *   How many seconds to scroll for. If 0, will scroll until bottom of page.
 * @param {number} [options.waitForSecs=4]
 *   How many seconds to wait for no new content to load before exit.
 * @param {boolean} [options.scrollDownAndUp=false]
 *   If true, it will scroll up a bit after each scroll down. This is required on some websites for the scroll to work.
 * @param {string} [options.buttonSelector]
 *   Optionally checks and clicks a button if it appears while scrolling. This is required on some websites for the scroll to work.
 * @param {function} [options.stopScrollCallback]
 *   Expected to be an async function. If this function returns `true`, quit scrolling loop.
 * @returns {Promise<void>}
 * @memberOf puppeteer
 * @name infiniteScroll
 */
export const infiniteScroll = async (page, options = {}) => {
    ow(page, ow.object.validate(validators.browserPage));
    ow(options, ow.object.exactShape({
        timeoutSecs: ow.optional.number,
        waitForSecs: ow.optional.number,
        scrollDownAndUp: ow.optional.boolean,
        buttonSelector: ow.optional.string,
        stopScrollCallback: ow.optional.function,
    }));

    const { timeoutSecs = 0, waitForSecs = 4, scrollDownAndUp = false, buttonSelector, stopScrollCallback } = options;

    let finished;
    const startTime = Date.now();
    const CHECK_INTERVAL_MILLIS = 1000;
    const SCROLL_HEIGHT_IF_ZERO = 10000;
    const maybeResourceTypesInfiniteScroll = ['xhr', 'fetch', 'websocket', 'other'];
    const resourcesStats = {
        newRequested: 0,
        oldRequested: 0,
        matchNumber: 0,
    };

    page.on('request', (msg) => {
        if (maybeResourceTypesInfiniteScroll.includes(msg.resourceType())) {
            resourcesStats.newRequested++;
        }
    });

    const checkFinished = setInterval(() => {
        if (resourcesStats.oldRequested === resourcesStats.newRequested) {
            resourcesStats.matchNumber++;
            if (resourcesStats.matchNumber >= waitForSecs) {
                clearInterval(checkFinished);
                finished = true;
                return;
            }
        } else {
            resourcesStats.matchNumber = 0;
            resourcesStats.oldRequested = resourcesStats.newRequested;
        }
        // check if timeout has been reached
        if (timeoutSecs !== 0 && (Date.now() - startTime) / 1000 > timeoutSecs) {
            clearInterval(checkFinished);
            finished = true;
        }
    }, CHECK_INTERVAL_MILLIS);

    const doScroll = async () => {
        /* istanbul ignore next */
        await page.evaluate(async (scrollHeightIfZero) => {
            const delta = document.body.scrollHeight === 0 ? scrollHeightIfZero : document.body.scrollHeight;
            window.scrollBy(0, delta);
        }, SCROLL_HEIGHT_IF_ZERO);
    };

    const maybeClickButton = async () => {
        const button = await page.$(buttonSelector);
        // Box model returns null if the button is not visible
        if (button && await button.boxModel()) {
            await button.click({ delay: 10 });
        }
    };

    while (!finished) {
        await doScroll();
        await page.waitForTimeout(50);
        if (scrollDownAndUp) {
            await page.evaluate(() => {
                window.scrollBy(0, -1000);
            });
        }
        if (buttonSelector) {
            await maybeClickButton();
        }
        if (stopScrollCallback) {
            if (await stopScrollCallback()) {
                break;
            }
        }
    }
};

/**
 * Saves a full screenshot and HTML of the current page into a Key-Value store.
 * @param {Page} page
 *   Puppeteer [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) object.
 * @param {object} [options]
 * @param {string} [options.key=SNAPSHOT]
 *   Key under which the screenshot and HTML will be saved. `.jpg` will be appended for screenshot and `.html` for HTML.
 * @param {number} [options.screenshotQuality=50]
 *   The quality of the image, between 0-100. Higher quality images have bigger size and require more storage.
 * @param {boolean} [options.saveScreenshot=true]
 *   If true, it will save a full screenshot of the current page as a record with `key` appended by `.jpg`.
 * @param {boolean} [options.saveHtml=true]
 *   If true, it will save a full HTML of the current page as a record with `key` appended by `.html`.
 * @param {string|null} [options.keyValueStoreName=null]
 *   Name or id of the Key-Value store where snapshot is saved. By default it is saved to default Key-Value store.
 * @returns {Promise<void>}
 * @memberOf puppeteer
 * @name saveSnapshot
 */
const saveSnapshot = async (page, options = {}) => {
    ow(page, ow.object.validate(validators.browserPage));
    ow(options, ow.object.exactShape({
        key: ow.optional.string.nonEmpty,
        screenshotQuality: ow.optional.number,
        saveScreenshot: ow.optional.boolean,
        saveHtml: ow.optional.boolean,
        keyValueStoreName: ow.optional.string,
    }));

    const {
        key = 'SNAPSHOT',
        screenshotQuality = 50,
        saveScreenshot = true,
        saveHtml = true,
        keyValueStoreName,
    } = options;

    try {
        const store = await openKeyValueStore(keyValueStoreName);

        if (saveScreenshot) {
            const screenshotName = `${key}.jpg`;
            const screenshotBuffer = await page.screenshot({ fullPage: true, screenshotQuality, type: 'jpeg' });
            await store.setValue(screenshotName, screenshotBuffer, { contentType: 'image/jpeg' });
        }
        if (saveHtml) {
            const htmlName = `${key}.html`;
            const html = await page.content();
            await store.setValue(htmlName, html, { contentType: 'text/html' });
        }
    } catch (err) {
        throw new Error(`saveSnapshot with key ${key} failed.\nCause:${err.message}`);
    }
};

/**
 * A namespace that contains various utilities for
 * [Puppeteer](https://github.com/puppeteer/puppeteer) - the headless Chrome Node API.
 *
 * **Example usage:**
 *
 * ```javascript
 * const Apify = require('apify');
 * const { puppeteer } = Apify.utils;
 *
 * // Open https://www.example.com in Puppeteer
 * const browser = await Apify.launchPuppeteer();
 * const page = await browser.newPage();
 * await page.goto('https://www.example.com');
 *
 * // Inject jQuery into a page
 * await puppeteer.injectJQuery(page);
 * ```
 * @namespace puppeteer
 */
export const puppeteerUtils = {
    injectFile,
    injectJQuery,
    injectUnderscore,
    enqueueLinksByClickingElements,
    blockRequests,
    blockResources,
    cacheResponses,
    compileScript,
    gotoExtended,
    addInterceptRequestHandler,
    removeInterceptRequestHandler,
    infiniteScroll,
    saveSnapshot,
};
