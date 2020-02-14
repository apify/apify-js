export default LiveViewServer;
/**
 * `LiveViewServer` enables serving of browser snapshots via web sockets. It includes its own client
 * that provides a simple frontend to viewing the captured snapshots. A snapshot consists of three
 * pieces of information, the currently opened URL, the content of the page (HTML) and its screenshot.
 *
 * ```json
 * {
 *     "pageUrl": "https://www.example.com",
 *     "htmlContent": "<html><body> ....",
 *     "screenshotIndex": 3,
 *     "createdAt": "2019-04-18T11:50:40.060Z"
 * }
 * ```
 *
 * `LiveViewServer` is useful when you want to be able to inspect the current browser status on demand.
 * When no client is connected, the webserver consumes very low resources so it should have a close
 * to zero impact on performance. Only once a client connects the server will start serving snapshots.
 * Once no longer needed, it can be disabled again in the client to remove any performance impact.
 *
 * NOTE: Screenshot taking in browser typically takes around 300ms. So having the `LiveViewServer`
 * always serve snapshots will have a significant impact on performance.
 *
 * When using {@link PuppeteerPool}, the `LiveViewServer` can be
 * easily used just by providing the `useLiveView = true` option to the {@link PuppeteerPool}.
 * It can also be initiated via {@link PuppeteerCrawler} `puppeteerPoolOptions`.
 *
 * It will take snapshots of the first page of the latest browser. Taking snapshots of only a
 * single page improves performance and stability dramatically in high concurrency situations.
 *
 * When running locally, it is often best to use a headful browser for debugging, since it provides
 * a better view into the browser, including DevTools, but `LiveViewServer` works too.
 */
declare class LiveViewServer {
    /**
     * @param {Object} [options]
     *   All `LiveViewServer` parameters are passed
     *   via an options object with the following keys:
     * @param {string} [options.screenshotDirectoryPath]
     *   By default, the screenshots are saved to
     *   the `live_view` directory in the Apify local storage directory.
     *   Provide a different absolute path to change the settings.
     * @param {number} [options.maxScreenshotFiles=10]
     *   Limits the number of screenshots stored
     *   by the server. This is to prevent using up too much disk space.
     * @param {number} [options.snapshotTimeoutSecs=3]
     *   If a snapshot is not made within the timeout,
     *   its creation will be aborted. This is to prevent
     *   pages from being hung up by a stalled screenshot.
     * @param {number} [options.maxSnapshotFrequencySecs=2]
     *   Use this parameter to further decrease the resource consumption
     *   of `LiveViewServer` by limiting the frequency at which it'll
     *   serve snapshots.
     */
    constructor(options?: {
        screenshotDirectoryPath?: string;
        maxScreenshotFiles?: number;
        snapshotTimeoutSecs?: number;
        maxSnapshotFrequencySecs?: number;
    } | undefined);
    screenshotDirectoryPath: any;
    maxScreenshotFiles: number;
    snapshotTimeoutMillis: number;
    maxSnapshotFrequencyMillis: number;
    /**
     * @type {?Snapshot}
     * @private
     */
    private lastSnapshot;
    lastScreenshotIndex: number;
    clientCount: number;
    _isRunning: boolean;
    httpServer: any;
    socketio: any;
    servingSnapshot: boolean;
    /**
     * Starts the HTTP server with web socket connections enabled.
     * Snapshots will not be created until a client has connected.
     * @return {Promise}
     */
    async start(): Promise<any>;
    /**
     * Prevents the server from receiving more connections. Existing connections
     * will not be terminated, but the server will not prevent a process exit.
     * @return {Promise}
     */
    async stop(): Promise<any>;
    /**
     * Serves a snapshot to all connected clients.
     * Screenshots are not served directly, only their index number
     * which is used by client to retrieve the screenshot.
     *
     * Will time out and throw in `options.snapshotTimeoutSecs`.
     *
     * @param {Page} page
     * @return {Promise}
     */
    async serve(page: Page): Promise<any>;
    /**
     * @return {boolean}
     */
    isRunning(): boolean;
    /**
     * @return {boolean}
     */
    hasClients(): boolean;
    /**
     * Returns an absolute path to the screenshot with the given index.
     * @param {number} screenshotIndex
     * @return {string}
     * @private
     */
    private _getScreenshotPath;
    /**
     * @param {Page} page
     * @return {Promise<Snapshot>}
     * @private
     */
    private async _makeSnapshot;
    /**
     * @param {Snapshot} snapshot
     * @private
     */
    private _pushSnapshot;
    /**
     * Initiates an async delete and does not wait for it to complete.
     * @param {number} screenshotIndex
     * @private
     */
    private _deleteScreenshot;
    _setupHttpServer(): void;
    port: number | undefined;
    liveViewUrl: any;
    /**
     * @param {socketio.Socket} socket
     * @private
     */
    _socketConnectionHandler(socket: any): void;
}
import Snapshot from "./snapshot";
import { Page } from "puppeteer";
