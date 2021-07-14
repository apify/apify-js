import ow from 'ow';
import { ENV_VARS } from '@apify/consts';
import { getTypicalChromeExecutablePath, isAtHome } from '../utils';
import { BrowserPlugin } from './browser_plugin'; // eslint-disable-line no-unused-vars

/**
 * @typedef BrowserLaunchContext
 * @property {Object<string, *>} [launchOptions]
 *  `Options passed to the browser launcher function. Options are based on underlying library.
 * @property {string} [proxyUrl]
 *   URL to a HTTP proxy server. It must define the port number,
 *   and it may also contain proxy username and password.
 *
 *   Example: `http://bob:pass123@proxy.example.com:1234`.
 * @property {boolean} [useChrome=false]
 *   If `true` and `executablePath` is not set,
 *   Playwright will launch full Google Chrome browser available on the machine
 *   rather than the bundled Chromium. The path to Chrome executable
 *   is taken from the `APIFY_CHROME_EXECUTABLE_PATH` environment variable if provided,
 *   or defaults to the typical Google Chrome executable location specific for the operating system.
 *   By default, this option is `false`.
 * @property {*} [launcher]
 *   By default this function uses require("playwright").chromium`.
 *   If you want to use a different browser you can pass it by this property as `require("playwright").firefox
 */

/**
 * Abstract class for creating browser launchers, such as `PlaywrightLauncher` and `PuppeteerLauncher`.
 * @ignore
 */
export default class BrowserLauncher {
    static optionsShape = {
        proxyUrl: ow.optional.string.url,
        useChrome: ow.optional.boolean,
        useIncognitoPages: ow.optional.boolean,
        userDataDir: ow.optional.string,
        launchOptions: ow.optional.object,
    }

    /**
     *
     * @param {string} launcher
     * @param {string} apifyImageName
     * @returns {*}
     *
     */
    static requireLauncherOrThrow(launcher, apifyImageName) {
        try {
            return require(launcher); // eslint-disable-line
        } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND') {
                const msg = `Cannot find module '${launcher}'. Did you you install the '${launcher}' package?\n`
                    + `Make sure you have '${launcher}' in your package.json dependencies and in your package-lock.json, if you use it.`;
                err.message = isAtHome()
                    ? `${msg}\nOn the Apify platform, '${launcher}' can only be used with the ${apifyImageName} Docker image.`
                    : msg;
            }

            throw err;
        }
    }

    /**
    * @param {BrowserLaunchContext} launchContext
    * All `BrowserLauncher` parameters are passed via an launchContext object.
    */
    constructor(launchContext) {
        const {
            launcher,
            proxyUrl,
            useChrome,
            launchOptions = {},
            ...otherLaunchContextProps
        } = launchContext;

        this._validateProxyUrlProtocol(proxyUrl);

        // those need to be reassigned otherwise they are {} in types
        /** @type {*} */
        this.launcher = launcher;
        this.proxyUrl = proxyUrl;
        this.useChrome = useChrome;
        /** @type {Object<string, *>} */
        this.launchOptions = launchOptions;
        this.otherLaunchContextProps = otherLaunchContextProps;

        /** @type {BrowserPlugin} */
        this.Plugin = null; // to be provided by child classes;
    }

    /**
     * @returns {BrowserPlugin}
     * @ignore
     */
    createBrowserPlugin() {
        return new this.Plugin(
            this.launcher,
            {
                proxyUrl: this.proxyUrl,
                launchOptions: this.createLaunchOptions(),
                ...this.otherLaunchContextProps,
            },
        );
    }

    /**
     * Launches a browser instance based on the plugin.
     * @returns {Promise<*>} Browser instance.
     */
    async launch() {
        const plugin = this.createBrowserPlugin();
        const context = await plugin.createLaunchContext();
        return plugin.launch(context);
    }

    /**
     * @returns {Object<string, *>}
     */
    createLaunchOptions() {
        const launchOptions = {
            ...this.launchOptions,
        };

        if (launchOptions.headless == null) {
            launchOptions.headless = this._getDefaultHeadlessOption();
        }

        if (this.useChrome && !launchOptions.executablePath) {
            launchOptions.executablePath = this._getChromeExecutablePath();
        }

        return launchOptions;
    }

    /**
     * @returns {boolean}
     * @private
     */
    _getDefaultHeadlessOption() {
        return process.env[ENV_VARS.HEADLESS] === '1' && process.env[ENV_VARS.XVFB] !== '1';
    }

    /**
    * @returns {string}
    * @private
    */
    _getChromeExecutablePath() {
        return process.env[ENV_VARS.CHROME_EXECUTABLE_PATH] || getTypicalChromeExecutablePath();
    }

    /**
     *
     * @param {string} proxyUrl
     * @private
     */
    _validateProxyUrlProtocol(proxyUrl) {
        if (!proxyUrl) return;

        if (!/^(http|https|socks4|socks5)/i.test(proxyUrl)) {
            throw new Error(`Invalid "proxyUrl". Unsupported protocol: ${proxyUrl}.`);
        }
    }
}
