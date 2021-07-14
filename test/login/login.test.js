import Apify from '../../build';
import { login } from '../../build/login/login';
import { getLoginFields } from '../../build/login/tools';

const { utils: { log } } = Apify;
const fs = require('fs');

const html = {
    divs: fs.readFileSync(__dirname + '/divs.html').toString(),
    forms: fs.readFileSync(__dirname + '/forms.html').toString(),
};

describe('login()', () => {
    let logLevel;
    beforeAll(() => {
        logLevel = log.getLevel();
        // log.setLevel(log.LEVELS.ERROR);
    });

    afterAll(() => {
        log.setLevel(logLevel);
    });

    describe('using Puppeteer', () => {
        let browser;
        let page;

        beforeEach(async () => {
            browser = await Apify.launchPuppeteer({ headless: true });
            page = await browser.newPage();
        });

        afterEach(async () => {
            if (browser) await browser.close();
            page = null;
            browser = null;
        });

        test('finds login fields (divs)', async () => {
            await page.setContent(html.divs);
            const loginFields = await getLoginFields(page);

            expect(loginFields)
                .toEqual(expect.objectContaining({
                    username: expect.any(Object),
                    password: expect.any(Object),
                }));

            const nodeIds = {
                username: await loginFields.username.evaluate(node => node.id),
                password: await loginFields.password.evaluate(node => node.id),
            };

            expect(nodeIds.username).toBe('u');
            expect(nodeIds.password).toBe('p');
        });

        test('finds login fields (forms)', async () => {
            await page.setContent(html.forms);
            const loginFields = await getLoginFields(page);

            expect(loginFields)
                .toEqual(expect.objectContaining({
                    username: expect.any(Object),
                    password: expect.any(Object),
                }));


            const nodeIds = {
                username: await loginFields.username.evaluate(node => node.id),
                password: await loginFields.password.evaluate(node => node.id),
            };

            expect(nodeIds.username).toBe('u');
            expect(nodeIds.password).toBe('p');
        });
    });
});
