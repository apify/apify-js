import { EventEmitter } from 'events';
import log from './utils_log';
import { login } from './login/login';
import { main, getEnv, call, callTask, metamorph, addWebhook } from './actor';
import { Apify } from './apify';
import { Configuration } from './configuration';
import AutoscaledPool from './autoscaling/autoscaled_pool';
import { BasicCrawler } from './crawlers/basic_crawler';
import CheerioCrawler from './crawlers/cheerio_crawler';
import { pushData, openDataset } from './storages/dataset';
import events, { initializeEvents, stopEvents } from './events';
import { getValue, setValue, getInput, openKeyValueStore } from './storages/key_value_store';
import { launchPuppeteer } from './browser_launchers/puppeteer_launcher';
import { launchPlaywright } from './browser_launchers/playwright_launcher';
import BrowserCrawler from './crawlers/browser_crawler';
import PuppeteerCrawler from './crawlers/puppeteer_crawler';
import PlaywrightCrawler from './crawlers/playwright_crawler';
import Request from './request';
import { RequestList, openRequestList } from './request_list';
import { createProxyConfiguration } from './proxy_configuration';
import { openRequestQueue } from './storages/request_queue';
import { newClient, getMemoryInfo, isAtHome, publicUtils } from './utils';
import { puppeteerUtils } from './puppeteer_utils';
import { playwrightUtils } from './playwright_utils';
import { socialUtils } from './utils_social';
import { enqueueLinks } from './enqueue_links/enqueue_links';
import PseudoUrl from './pseudo_url';
import LiveViewServer from './live_view/live_view_server';
import { requestAsBrowser } from './utils_request';
import { openSessionPool } from './session_pool/session_pool';
import { Session } from './session_pool/session';

// Increase the global limit for event emitter memory leak warnings.
EventEmitter.defaultMaxListeners = 50;

const exportedUtils = Object.assign(publicUtils, {
    puppeteer: puppeteerUtils,
    playwright: playwrightUtils,
    social: socialUtils,
    log,
    login,
    enqueueLinks,
    requestAsBrowser,
});

/**
 * The following section describes all functions and properties provided by the `apify` package,
 * except individual classes and namespaces that have their separate, detailed, documentation pages
 * accessible from the left sidebar. To learn how Apify SDK works, we suggest following
 * the [Getting Started](../guides/getting-started) tutorial.
 *
 * **Important:**
 * > The following functions: `addWebhook`, `call`, `callTask` and `newClient` invoke features of the
 * > [Apify platform](../guides/apify-platform) and require your scripts to be authenticated.
 * > See the [authentication guide](../guides/apify-platform#logging-into-apify-platform-from-apify-sdk) for instructions.
 *
 * ## `Apify` Class
 *
 * As opposed to those helper functions, there is an alternative approach using `Apify` class (a named export).
 * It has mostly the same API, but the methods on `Apify` instance will use the configuration provided in the constructor.
 * Environment variables will have precedence over this configuration.
 *
 * ```js
 * const { Apify } = require('apify'); // use named export to get the class
 *
 * const sdk = new Apify({ token: '123' });
 * console.log(sdk.config.get('token')); // '123'
 *
 * // the token will be passed to the `call` method automatically
 * const run = await sdk.call('apify/hello-world', { myInput: 123 });
 * console.log(`Received message: ${run.output.body.message}`);
 * ```
 *
 * Another example shows how the default dataset name can be changed:
 *
 * ```js
 * const { Apify } = require('apify'); // use named export to get the class
 *
 * const sdk = new Apify({ defaultDatasetId: 'custom-name' });
 * await sdk.pushData({ myValue: 123 });
 * ```
 *
 * is equivalent to:
 * ```js
 * const Apify = require('apify'); // use default export to get the helper functions
 *
 * const dataset = await Apify.openDataset('custom-name');
 * await dataset.pushData({ myValue: 123 });
 * ```
 *
 *
 * See {@link Configuration} for details about what can be configured and what are the default values.
 *
 * @module Apify
 */
export {
    Apify,
    Configuration,
    main,
    getEnv,
    call,
    callTask,
    metamorph,
    getMemoryInfo,
    isAtHome,
    newClient,
    addWebhook,

    AutoscaledPool,

    BasicCrawler,

    CheerioCrawler,

    pushData,
    openDataset,

    events,
    initializeEvents,
    stopEvents,

    getValue,
    setValue,
    getInput,
    openKeyValueStore,

    launchPuppeteer,
    launchPlaywright,
    BrowserCrawler,
    PuppeteerCrawler,
    PlaywrightCrawler,

    PseudoUrl,

    Request,
    RequestList,
    openRequestList,
    openRequestQueue,

    openSessionPool,

    createProxyConfiguration,

    LiveViewServer,
    Session,

    exportedUtils as utils,
};
