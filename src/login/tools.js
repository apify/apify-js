import * as _ from 'underscore';
import log from '../utils_log';

import {staticAttributePatterns, otherAttributePatterns} from './consts';
import {filters} from './filters';

/**
 * Attempts to identify login fields on page first as clustered by form elements and afterwards with no clustering if no match was found using form clusters
 * @param {Object} page
 * @returns {Promise<*>}
 */
export const getLoginFields = async page => {
    const inputFilters = getInputFilters();
    let loginFields;

    console.log('Looking for login fields in inputs clustered by forms');
    loginFields = await findLoginFields(page, inputFilters, true);

    if (loginFields)
        return loginFields;

    console.log('Looking for login fields in all inputs, no clustering');
    loginFields = await findLoginFields(page, inputFilters, false);

    if (loginFields)
        return loginFields;

    throw Error('Could not find login inputs');
};

/**
 * Generates filters to be sequentially applied to all input clusters until a match is found for most likely login fields
 * @returns {Array}
 */
const getInputFilters = () => {
    const patterns = getAttributePatterns(staticAttributePatterns, otherAttributePatterns);
    console.log('patterns', patterns);

    const inputFilters = [];
    const {username: usernamePatterns} = patterns;

    inputFilters.push(...usernamePatterns.map(pattern => createFilter(filters[0], pattern)));

    inputFilters.push(...usernamePatterns
        .filter(pattern => pattern.attribute !== 'type')
        .map(pattern => createFilter(filters[1], pattern)));

    inputFilters.push(createFilter(filters[2]));

    return inputFilters;
};

/**
 * Attempts to identify login fields on page by applying a sequence of filters ordered by priority to inputs optionally grouped in clusters by form elements
 * @param {Object} page
 * @param {Function[]} inputFilters
 * @param {Boolean} forms
 * @returns {Promise<*>}
 */
const findLoginFields = async (page, inputFilters, forms = true) => {
    const inputClusters = await getInputClusters(page, forms);
    console.log('inputClusters', inputClusters);

    const resultFields = filterInputClusters(inputFilters, inputClusters);
    console.log('resultFields', resultFields);

    if (!resultFields.length)
        return;

    const loginFields = identifyFieldsByType(resultFields);
    console.log('loginFields', loginFields);

    return loginFields;
};

/**
 * Generate all possible permutations from element attribute patterns in specified order based on pattern priority
 * @param {Object} staticAttributePatterns
 * @param {Object} otherAttributePatterns
 * @returns {{username: *[]}}
 */
const getAttributePatterns = (staticAttributePatterns, otherAttributePatterns) => {
    const generatedAttributePatterns = {
        username: _.flatten(otherAttributePatterns.attributes
            .map(attribute => otherAttributePatterns.value.username
                .map(value => ({
                    attribute,
                    value
                }))))
    };

    return {
        username: [
            ...staticAttributePatterns.username,
            ...generatedAttributePatterns.username
        ]
    };
};

/**
 * Get inputs from page optionally clustered by form elements
 * @param {Object} page
 * @param {Boolean} forms
 * @returns {Promise<*[]>}
 */
const getInputClusters = async (page, forms) => {
    const $$forms = forms && await page.$$('form');

    if ($$forms.length) {
        const inputsByForm = await Promise.all($$forms.map(async ($form, clusterIndex) => {
            const $$inputs = await $form.$$('input[type="password"], input[type="email"], input[type="text"]');

            return await getExtendedInputs($$inputs, clusterIndex);
        }));

        return sortFormClusters(inputsByForm);
    }

    const $$inputs = await page.$$('input[type="password"], input[type="email"], input[type="text"]');
    const extendedInputs = await getExtendedInputs($$inputs);

    return [extendedInputs];
};

/**
 * Apply input filters to all clusters in a sequence based on filters' priority and check if any login field candidates were yielded by each iteration
 * @param {Function[]} inputFilters
 * @param {Object[]} inputClusters
 * @param {Number} filterIndex
 * @returns {Array}
 */
const filterInputClusters = (inputFilters, inputClusters, filterIndex = 0) => {
    console.log('\nFilters remaining:', inputFilters.length - filterIndex);
    const inputFilter = inputFilters[filterIndex];

    // forms - maybe also cluster non-forms by password fields in reverse direction?
    const resultClusters = inputClusters.map(cluster => inputFilter(cluster));
    console.log('resultClusters', resultClusters);

    // matches of input pairs per form or cluster sorted by priority = probability
    const resultCluster = resultClusters.find(cluster => cluster.length);
    console.log('resultCluster', resultCluster);

    if (resultCluster) {
        // first match of input pairs after filter = best candidate
        const [resultFields] = resultCluster;

        if (resultFields) {
            return resultFields;
        }
    }

    if (++filterIndex < inputFilters.length)
        return filterInputClusters(inputFilters, inputClusters, filterIndex);

    return [];
};

/**
 * Helper function for initializing pattern based filters to be applied to form inputs and match most likely login fields
 * Creates a filter function using a predicate and optionally element attribute patterns to be utilized by the predicate
 * @param {Function} filter
 * @param {Object} pattern
 * @returns {function(*): *}
 */
const createFilter = (filter, pattern = null) =>
    inputCluster => {
        const {clusterIndex, inputCount} = inputCluster[0];

        if (clusterIndex) {
            console.log('inputCount', inputCount);
            console.log('clusterIndex', clusterIndex);
        }

        if (pattern) {
            console.log('pattern', pattern);
        }

        console.log('filter', filter.toString().replace(/\s+/g, ' '));

        return reduceInputs({inputCluster, filter}, {pattern});
    };

/**
 * Tests inputs against patterns defined by filter and returns matching inputs as best login field candidates for given filter for further processing
 * Iterates all inputs in an input cluster testing them against provided filter function with optional extra arguments for testing patterns
 * @param {Object[]} inputCluster
 * @param {Function} filter
 * @param {Object} extras
 * @returns {Object | *}
 */
const reduceInputs = ({inputCluster, filter}, extras = {}) =>
    inputCluster.reduce((cache, input, index, array) => {
        console.log('testing:', _.pick(input, value => typeof value === 'string'));

        const inputPrior = array[index - 1];
        const inputAfter = array[index + 1];

        const inputsPassed = filter({input, inputPrior, inputAfter}, extras);

        if (inputsPassed) {
            cache.unshift([
                inputPrior,
                input
            ]);
        }

        return cache;

    }, []);

/**
 * Map DOM element details to node handles to prepare them for sorting and filtering
 * @param {Object[]} $$inputs ElementHandles
 * @param {Number} clusterIndex
 * @returns {Promise<[{node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}, {node: Object, clusterIndex: Number, inputCount: number}]>}
 */
const getExtendedInputs = async ($$inputs, clusterIndex = 1) =>
    Promise.all($$inputs.map(async ($input) => {
        const inputCount = $$inputs.length;
        const attributes = await $input.evaluate(node => ({
            type: node.getAttribute('type'),
            name: node.getAttribute('name'),
            id: node.getAttribute('id'),
            class: node.getAttribute('class'),
        }));

        return {
            inputCount,
            clusterIndex,
            node: $input,
            ...attributes
        };
    }));

/**
 * Reduce form clusters to ones with at least two input fields and at least one password field and return them sorted by total number of fields in ascending order
 * @param {Object[]} inputsByForm
 * @returns {Object[]}
 */
const sortFormClusters = (inputsByForm = []) => inputsByForm
    .filter(cluster =>
        cluster.length > 1 &&
        cluster.find(input => input.type === 'password'))
    .sort((clusterA, clusterB) => clusterA.length - clusterB.length);

/**
 * Identify username and password result fields based on element type
 * @param {Object[]} loginFields
 * @returns {Object | *}
 */
const identifyFieldsByType = loginFields =>
    loginFields.reduce((pool, next) => {
        if (next.type === 'password') {
            pool.password = next.node;
        } else {
            pool.username = next.node;
            // pool.username.push(next.node);
        }

        return pool;
    }, {
        username: [],
        password: null
    });
