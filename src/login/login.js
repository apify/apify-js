import log from '../utils_log';
import {checkParamOrThrow} from 'apify-client/build/utils';
import {getLoginFields} from './tools';

/**
 * Attempts to find login fields on page and use them for login after filling in provided credentials
 * @param page
 * @param username
 * @param password
 * @returns {Promise<void>}
 */
export const login = async (page, username = 'username', password = 'password') => {
    log.setLevel(log.LEVELS.DEBUG);
    checkParamOrThrow(page, 'page', 'Object');
    checkParamOrThrow(username, 'username', 'String');
    checkParamOrThrow(password, 'password', 'String');

    const loginFields = await getLoginFields(page);

    if (!loginFields)
        throw Error('Could not find login inputs');

    // try all username candidates at once to increase chances?
    // await Promise.all(loginFields.username.map(field => field.type(username)));

    await loginFields.username.type(username);
    await loginFields.password.type(password);
    await loginFields.password.focus();
    await page.keyboard.press('Enter');

    // TODO check login success etc...
};
