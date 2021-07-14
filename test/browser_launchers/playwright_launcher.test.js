import proxy from 'proxy';
import http from 'http';
import util from 'util';
import portastic from 'portastic';
import basicAuthParser from 'basic-auth-parser';
import _ from 'underscore';
import sinon from 'sinon';
import { ENV_VARS } from '@apify/consts';
import Apify from '../../build/index';
import * as utils from '../../build/utils';

import { PlaywrightLauncher } from '../../build/browser_launchers/playwright_launcher';

let prevEnvHeadless;
let proxyServer;
let proxyPort; // eslint-disable-line no-unused-vars
const proxyAuth = { scheme: 'Basic', username: 'username', password: 'password' };
let wasProxyCalled = false; // eslint-disable-line no-unused-vars

// Setup local proxy server for the tests
beforeAll(() => {
    prevEnvHeadless = process.env[ENV_VARS.HEADLESS];
    process.env[ENV_VARS.HEADLESS] = '1';

    // Find free port for the proxy
    return portastic.find({ min: 50000, max: 50099 }).then((ports) => {
        return new Promise((resolve, reject) => {
            const httpServer = http.createServer();

            // Setup proxy authorization
            httpServer.authenticate = function (req, fn) {
                // parse the "Proxy-Authorization" header
                const auth = req.headers['proxy-authorization'];
                if (!auth) {
                    // optimization: don't invoke the child process if no
                    // "Proxy-Authorization" header was given
                    // console.log('not Proxy-Authorization');
                    return fn(null, false);
                }
                const parsed = basicAuthParser(auth);
                const isEqual = _.isEqual(parsed, proxyAuth);
                // console.log('Parsed "Proxy-Authorization": parsed: %j expected: %j : %s', parsed, proxyAuth, isEqual);
                if (isEqual) wasProxyCalled = true;
                fn(null, isEqual);
            };

            httpServer.on('error', reject);

            proxyServer = proxy(httpServer);
            proxyServer.listen(ports[0], () => {
                proxyPort = proxyServer.address().port;
                resolve();
            });
        });
    });
});

afterAll(() => {
    process.env[ENV_VARS.HEADLESS] = prevEnvHeadless;

    if (proxyServer) return util.promisify(proxyServer.close).bind(proxyServer)();
}, 5000);

describe('Apify.launchPlaywright()', () => {
    test('throws on invalid args', async () => {
        await expect(Apify.launchPlaywright('some non-object')).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright(1234)).rejects.toThrow(Error);

        await expect(Apify.launchPlaywright({ proxyUrl: 234 })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: {} })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: 'invalidurl' })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: 'invalid://somehost:1234' })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: 'https://user:pass@example.com:1234' })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: 'socks4://user:pass@example.com:1234' })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: 'socks5://user:pass@example.com:1234' })).rejects.toThrow(Error);
        await expect(Apify.launchPlaywright({ proxyUrl: ' something really bad' })).rejects.toThrow(Error);
    });

    test('supports non-HTTP proxies without authentication', async () => {
        const closePromises = [];
        const browser1 = await Apify.launchPlaywright({ proxyUrl: 'socks4://example.com:1234' });
        closePromises.push(browser1.close());

        const browser2 = await Apify.launchPlaywright({ proxyUrl: 'socks5://example.com:1234' });
        closePromises.push(browser2.close());

        const browser3 = await Apify.launchPlaywright({ proxyUrl: 'https://example.com:1234' });
        closePromises.push(browser3.close());

        const browser4 = await Apify.launchPlaywright({ proxyUrl: 'HTTP://example.com:1234' });
        closePromises.push(browser4.close());
        await Promise.all(closePromises);
    });

    test('opens https://www.example.com', async () => {
        const browser = await Apify.launchPlaywright();
        const page = await browser.newPage();

        await page.goto('https://www.example.com');
        const html = await page.content();
        expect(html).toMatch('<h1>Example Domain</h1>');
        browser.close();
    });
    describe('headful mode', () => {
        let browser;

        beforeAll(() => {
            // Test headless parameter
            process.env[ENV_VARS.HEADLESS] = '0';
        });

        beforeEach(async () => {
            browser = await Apify.launchPlaywright({
                launchOptions: { headless: true },
                proxyUrl: `http://username:password@127.0.0.1:${proxyPort}`,
            });
        });

        afterEach(async () => {
            if (browser) await browser.close();
        });

        afterAll(() => {
            process.env[ENV_VARS.HEADLESS] = '1';
        });

        test('opens https://www.example.com via proxy with authentication', async () => {
            const page = await browser.newPage();

            await page.goto('https://example.com');
            expect(wasProxyCalled).toBe(true);

            const html = await page.content();
            expect(html).toMatch('<h1>Example Domain</h1>');
        });
    });

    test('supports useChrome option', async () => {
        const spy = sinon.spy(utils, 'getTypicalChromeExecutablePath');
        let browser;
        const opts = {
            useChrome: true,
        };

        try {
            browser = await Apify.launchPlaywright(opts);
            const page = await browser.newPage();

            // Add a test to go to an actual domain because we've seen issues
            // where pages would not load at all with Chrome.
            await page.goto('https://example.com');
            const title = await page.title();
            const version = await browser.version();

            expect(title).toBe('Example Domain');
            expect(version).not.toMatch('Chromium');
            expect(spy.calledOnce).toBe(true);
        } finally {
            spy.restore();
            if (browser) await browser.close();
        }
    });

    describe('Default browser path', () => {
        const path = 'test';

        beforeAll(() => {
            process.env.APIFY_DEFAULT_BROWSER_PATH = path;
        });

        afterAll(() => {
            delete process.env.APIFY_DEFAULT_BROWSER_PATH;
        });

        test('uses Apify default browser path', () => {
            const launcher = new PlaywrightLauncher({
                launcher: {},
            });
            const plugin = launcher.createBrowserPlugin();

            expect(plugin.launchOptions.executablePath).toEqual(path);
        });

        test('does not use default when using chrome', () => {
            const launcher = new PlaywrightLauncher({
                useChrome: true,
                launcher: {},
            });
            const plugin = launcher.createBrowserPlugin();

            expect(plugin.launchOptions.executablePath).toBe(utils.getTypicalChromeExecutablePath());
        });

        test('allows to be overridden', () => {
            const newPath = 'newPath';

            const launcher = new PlaywrightLauncher({
                launchOptions: {
                    executablePath: newPath,
                },
                launcher: {},
            });
            const plugin = launcher.createBrowserPlugin();

            expect(plugin.launchOptions.executablePath).toEqual(newPath);
        });

        test('works without default path', async () => {
            delete process.env.APIFY_DEFAULT_BROWSER_PATH;
            let browser;
            try {
                browser = await Apify.launchPlaywright();
                const page = await browser.newPage();

                await page.goto('https://example.com');
                const title = await page.title();

                expect(title).toBe('Example Domain');
            } finally {
                if (browser) await browser.close();
            }
        });
    });

    test('supports useIncognitoPages: true', async () => {
        let browser;
        try {
            browser = await Apify.launchPlaywright({
                useIncognitoPages: true,
                launchOptions: { headless: true },
            });
            const page1 = await browser.newPage();
            const context1 = page1.context();
            const page2 = await browser.newPage();
            const context2 = page2.context();
            expect(context1).not.toBe(context2);
        } finally {
            if (browser) await browser.close();
        }
    });

    test('supports useIncognitoPages: false', async () => {
        let browser;
        try {
            browser = await Apify.launchPlaywright({
                useIncognitoPages: false,
                launchOptions: { headless: true },
            });
            const page1 = await browser.newPage();
            const context1 = page1.context();
            const page2 = await browser.newPage();
            const context2 = page2.context();
            expect(context1).toBe(context2);
        } finally {
            if (browser) await browser.close();
        }
    });
});
