import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'babel-polyfill';
import _ from 'underscore';
import sinon from 'sinon';
import { delayPromise } from 'apify-shared/utilities';
import * as Apify from '../build/index';
import { ACTOR_EVENT_NAMES } from '../build/constants';
import { LOG_INFO_INTERVAL, SCALE_UP_MAX_STEP } from '../build/autoscaled_pool';
import * as utils from '../build/utils';

chai.use(chaiAsPromised);
const toBytes = x => x * 1024 * 1024;

describe('AutoscaledPool', () => {
    it('should work with concurrency 1', async () => {
        const range = _.range(0, 10);
        const result = [];

        let isFinished = false;

        const handleTaskFunction = () => {
            if (range.length === 1) {
                isFinished = true;
            }

            return new Promise((resolve) => {
                const item = range.shift();
                result.push(item);
                setTimeout(resolve, 10);
            });
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 1,
            handleTaskFunction,
            isFinishedFunction: () => Promise.resolve(isFinished),
            isTaskReadyFunction: () => Promise.resolve(!isFinished),
        });
        const startedAt = Date.now();
        await pool.run();

        expect(result).to.be.eql(_.range(0, 10));
        expect(Date.now() - startedAt).to.be.within(100, 150);
    });

    it('should work with concurrency 10', async () => {
        const range = _.range(0, 100);
        const result = [];

        let isFinished = false;

        const handleTaskFunction = () => {
            if (range.length === 1) {
                isFinished = true;
            }

            return new Promise((resolve) => {
                const item = range.shift();
                result.push(item);
                setTimeout(resolve, 10);
            });
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 10,
            maxConcurrency: 10,
            handleTaskFunction,
            isFinishedFunction: () => Promise.resolve(isFinished),
            isTaskReadyFunction: () => Promise.resolve(!isFinished),
        });

        const startedAt = Date.now();
        await pool.run();

        expect(result).to.be.eql(_.range(0, 100));
        expect(Date.now() - startedAt).to.be.within(100, 150);
    });

    it('correctly computed space for instances using', async () => {
        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 100,
            handleTaskFunction: () => Promise.resolve(),
            isFinishedFunction: () => Promise.resolve(false),
            isTaskReadyFunction: () => Promise.resolve(true),
        });

        pool.concurrency = 20;
        pool.runningCount = 20;
        pool.freeBytesSnapshots = [
            toBytes(50),
            toBytes(30),
            toBytes(50),
            toBytes(40),
        ];
        const hasSpaceForInstances = pool._computeSpaceForInstances(toBytes(100), true);
        expect(hasSpaceForInstances).to.be.eql(5);

        pool.concurrency = 20;
        pool.runningCount = 20;
        pool.freeBytesSnapshots = [
            toBytes(5),
            toBytes(5),
            toBytes(5),
            toBytes(5),
        ];
        const hasSpaceForInstances2 = pool._computeSpaceForInstances(toBytes(100), true);
        expect(hasSpaceForInstances2).to.be.eql(-2);
    });

    it('should autoscale correctly', async () => {
        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 100,
            minFreeMemoryRatio: 0.1,
            handleTaskFunction: () => Promise.resolve(),
            isFinishedFunction: () => Promise.resolve(false),
            isTaskReadyFunction: () => Promise.resolve(true),
        });
        const mock = sinon.mock(utils);

        // Should scale up.
        pool.concurrency = 1;
        pool.runningCount = 1;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(1 + SCALE_UP_MAX_STEP);

        // Should not do anything.
        pool.concurrency = 10;
        pool.runningCount = 10;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(1), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(10);

        // Should scale down.
        pool.concurrency = 10;
        pool.runningCount = 10;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(0.9), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(9);

        mock.verify();
        mock.restore();
    });

    it('should throw when some of the promises throws', async () => {
        let counter = 0;
        const handleTaskFunction = () => {
            counter++;

            if (counter > 100) return;

            if (counter === 100) {
                const err = new Error('some-error');

                return new Promise((resolve, reject) => setTimeout(reject(err), 10));
            }

            return delayPromise(10);
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 10,
            maxConcurrency: 10,
            handleTaskFunction,
            isFinishedFunction: () => Promise.resolve(false),
            isTaskReadyFunction: () => Promise.resolve(true),
        });

        await expect(pool.run()).to.be.rejectedWith('some-error');
    });

    it('should throw when handleTaskFunction throws', async () => {
        const handleTaskFunction = () => {
            throw new Error('some-error');
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 10,
            maxConcurrency: 10,
            handleTaskFunction,
            isFinishedFunction: () => Promise.resolve(false),
            isTaskReadyFunction: () => Promise.resolve(true),
        });

        await expect(pool.run()).to.be.rejectedWith('some-error');
    });

    it('should scale down when CPU is overloaded', async () => {
        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 100,
            minFreeMemoryRatio: 0.1,
            handleTaskFunction: () => Promise.resolve(),
            isFinishedFunction: () => Promise.resolve(false),
            isTaskReadyFunction: () => Promise.resolve(true),
        });
        const mock = sinon.mock(utils);

        // Should scale up.
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        pool.runningCount = pool.concurrency;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(1 + SCALE_UP_MAX_STEP);

        // Should scale up.
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        pool.runningCount = pool.concurrency;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(1 + (2 * SCALE_UP_MAX_STEP));

        // Emit CPU overloaded = true event.
        Apify.events.emit(ACTOR_EVENT_NAMES.CPU_INFO, { isCpuOverloaded: true });

        // Should scale up but because of CPU overloaded event it always scales down.
        pool.runningCount = pool.concurrency;
        for (let i = 1; i <= 5; i++) {
            pool.intervalCounter = LOG_INFO_INTERVAL - 1;
            mock.expects('getMemoryInfo')
                .once()
                .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
            await pool._autoscale(); //eslint-disable-line
            expect(pool.concurrency).to.be.eql((1 + (2 * SCALE_UP_MAX_STEP)) - i);
        }

        // Emit CPU overloaded = false event.
        Apify.events.emit(ACTOR_EVENT_NAMES.CPU_INFO, { isCpuOverloaded: false });

        // Should scale up again.
        pool.runningCount = pool.concurrency;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql((1 + (3 * SCALE_UP_MAX_STEP)) - 5);

        mock.verify();
        mock.restore();
    });

    it('should not handle tasks added after isFinishedFunction returned true', async () => {
        const tasks = [];
        const finished = [];

        let isFinished = false;

        // Start 3 tasks immediately.
        tasks.push(delayPromise(50).then(() => finished.push(0)));
        tasks.push(delayPromise(50).then(() => finished.push(1)));
        tasks.push(delayPromise(50).then(() => finished.push(2)));

        setTimeout(() => {
            isFinished = true;
        }, 200);

        // Add 2 tasks after 500ms.
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(3))), 300);
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(4))), 300);

        // Run the pool and close it after 3s.
        const pool = new Apify.AutoscaledPool({
            maybeRunIntervalMillis: 10,
            minConcurrency: 3,
            handleTaskFunction: () => tasks.pop(),
            isFinishedFunction: () => Promise.resolve(isFinished),
            isTaskReadyFunction: () => Promise.resolve(true),
        });
        await pool.run();

        // Check finished tasks.
        expect(finished).to.be.eql([0, 1, 2]);
    });

    it('should not handle tasks added if isTaskReadyFunction returned true', async () => {
        const tasks = [];
        const finished = [];

        let isFinished = false;
        let isTaskReady = true;

        const getTask = (id) => {
            return () => delayPromise(50).then(() => finished.push(id));
        };

        // Start 3 tasks immediately.
        tasks.push(getTask(0));
        tasks.push(getTask(1));
        setTimeout(() => tasks.push(getTask(2)), 150);

        setTimeout(() => {
            isTaskReady = false;
        }, 200);

        // Add 2 tasks after 500ms.
        setTimeout(() => tasks.push(getTask(3)), 300);
        setTimeout(() => tasks.push(getTask(4)), 300);

        // Remove tasks and se isTaskReady=true to accept a new task.
        setTimeout(() => {
            tasks.pop();
            tasks.pop();
            isTaskReady = true;
        }, 390);

        // Add one more task.
        setTimeout(() => tasks.push(getTask(5)), 400);

        // Finish.
        setTimeout(() => {
            isFinished = true;
        }, 500);

        // Run the pool and close it after 3s.
        const pool = new Apify.AutoscaledPool({
            maybeRunIntervalMillis: 10,
            minConcurrency: 3,
            handleTaskFunction: () => {
                const task = tasks.shift();

                if (!task) return;

                return task();
            },
            isFinishedFunction: () => Promise.resolve(isFinished),
            isTaskReadyFunction: () => Promise.resolve(isTaskReady),
        });
        await pool.run();

        // Check finished tasks.
        expect(finished).to.be.eql([0, 1, 2, 5]);
    });

    /**
     * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
     *
     * All the tests below use workerFunction and opts.finishWhenEmpty
     * to test that new version of AutoscaledPool is backwards compatible.
     *
     * TODO: after we release v1.0.0 we can remove this compatibility.
     *
     * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
     */


    it('[DEPRECATED] should work with concurrency 1', async () => {
        const range = _.range(0, 10);
        const result = [];

        const workerFunction = () => {
            if (range.length === 0) return;

            return new Promise((resolve) => {
                const item = range.shift();
                result.push(item);
                setTimeout(resolve, 10);
            });
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 1,
            workerFunction,
        });
        const startedAt = Date.now();
        await pool.run();

        expect(result).to.be.eql(_.range(0, 10));
        expect(Date.now() - startedAt).to.be.within(100, 150);
    });

    it('[DEPRECATED] should work with concurrency 10', async () => {
        const range = _.range(0, 100);
        const result = [];

        const workerFunction = () => {
            if (range.length === 0) return;

            return new Promise((resolve) => {
                const item = range.shift();
                result.push(item);
                setTimeout(resolve, 10);
            });
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 10,
            maxConcurrency: 10,
            workerFunction,
        });

        const startedAt = Date.now();
        await pool.run();

        expect(result).to.be.eql(_.range(0, 100));
        expect(Date.now() - startedAt).to.be.within(100, 150);
    });

    it('[DEPRECATED] correctly computed space for instances using', async () => {
        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 100,
            workerFunction: async () => {},
        });

        pool.concurrency = 20;
        pool.runningCount = 20;
        pool.freeBytesSnapshots = [
            toBytes(50),
            toBytes(30),
            toBytes(50),
            toBytes(40),
        ];
        const hasSpaceForInstances = pool._computeSpaceForInstances(toBytes(100), true);
        expect(hasSpaceForInstances).to.be.eql(5);

        pool.concurrency = 20;
        pool.runningCount = 20;
        pool.freeBytesSnapshots = [
            toBytes(5),
            toBytes(5),
            toBytes(5),
            toBytes(5),
        ];
        const hasSpaceForInstances2 = pool._computeSpaceForInstances(toBytes(100), true);
        expect(hasSpaceForInstances2).to.be.eql(-2);
    });

    it('[DEPRECATED] should autoscale correctly', async () => {
        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 100,
            minFreeMemoryRatio: 0.1,
            workerFunction: async () => {},
        });
        const mock = sinon.mock(utils);

        // Should scale up.
        pool.concurrency = 1;
        pool.runningCount = 1;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(1 + SCALE_UP_MAX_STEP);

        // Should not do anything.
        pool.concurrency = 10;
        pool.runningCount = 10;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(1), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(10);

        // Should scale down.
        pool.concurrency = 10;
        pool.runningCount = 10;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(0.9), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(9);

        mock.verify();
        mock.restore();
    });

    it('[DEPRECATED] should throw when some of the promises throws', async () => {
        let counter = 0;
        const workerFunction = () => {
            counter++;

            if (counter > 100) return;

            if (counter === 100) {
                const err = new Error('some-error');

                return new Promise((resolve, reject) => setTimeout(reject(err), 10));
            }

            return delayPromise(10);
        };

        const pool = new Apify.AutoscaledPool({
            minConcurrency: 10,
            maxConcurrency: 10,
            workerFunction,
        });

        await expect(pool.run()).to.be.rejectedWith('some-error');
    });

    it('[DEPRECATED] should scale down when CPU is overloaded', async () => {
        const pool = new Apify.AutoscaledPool({
            minConcurrency: 1,
            maxConcurrency: 100,
            minFreeMemoryRatio: 0.1,
            workerFunction: async () => {},
        });
        const mock = sinon.mock(utils);

        // Should scale up.
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        pool.runningCount = pool.concurrency;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(1 + SCALE_UP_MAX_STEP);

        // Should scale up.
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        pool.runningCount = pool.concurrency;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql(1 + (2 * SCALE_UP_MAX_STEP));

        // Emit CPU overloaded = true event.
        Apify.events.emit(ACTOR_EVENT_NAMES.CPU_INFO, { isCpuOverloaded: true });

        // Should scale up but because of CPU overloaded event it always scales down.
        pool.runningCount = pool.concurrency;
        for (let i = 1; i <= 5; i++) {
            pool.intervalCounter = LOG_INFO_INTERVAL - 1;
            mock.expects('getMemoryInfo')
                .once()
                .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
            await pool._autoscale(); //eslint-disable-line
            expect(pool.concurrency).to.be.eql((1 + (2 * SCALE_UP_MAX_STEP)) - i);
        }

        // Emit CPU overloaded = false event.
        Apify.events.emit(ACTOR_EVENT_NAMES.CPU_INFO, { isCpuOverloaded: false });

        // Should scale up again.
        pool.runningCount = pool.concurrency;
        pool.intervalCounter = LOG_INFO_INTERVAL - 1;
        mock.expects('getMemoryInfo')
            .once()
            .returns(Promise.resolve({ freeBytes: toBytes(9.99), totalBytes: toBytes(10) }));
        await pool._autoscale();
        expect(pool.concurrency).to.be.eql((1 + (3 * SCALE_UP_MAX_STEP)) - 5);

        mock.verify();
        mock.restore();
    });

    it('[DEPRECATED] should not handle tasks added later when opts.finishWhenEmpty is not used', async () => {
        const tasks = [];
        const finished = [];

        // Start 3 tasks immediately.
        tasks.push(delayPromise(50).then(() => finished.push(0)));
        tasks.push(delayPromise(50).then(() => finished.push(1)));
        tasks.push(delayPromise(50).then(() => finished.push(2)));

        // Add 2 tasks after 500ms.
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(3))), 500);
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(4))), 500);

        // Run the pool and close it after 3s.
        const pool = new Apify.AutoscaledPool({
            maybeRunIntervalMillis: 10,
            minConcurrency: 3,
            workerFunction: () => tasks.pop(),
        });
        await pool.run();

        // Check finished tasks.
        expect(finished).to.be.eql([0, 1, 2]);
    });

    it('[DEPRECATED] should be possible let pool running forever with opts.finishWhenEmpty=false', async () => {
        const tasks = [];
        const finished = [];

        // Start 3 tasks immediately.
        tasks.push(delayPromise(50).then(() => finished.push(0)));
        tasks.push(delayPromise(50).then(() => finished.push(1)));
        tasks.push(delayPromise(50).then(() => finished.push(2)));

        // Add 2 tasks after 500ms.
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(3))), 500);
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(4))), 500);

        // Add 1 task after 2s.
        setTimeout(() => tasks.push(delayPromise(50).then(() => finished.push(5))), 2000);

        // Run the pool and close it after 3s.
        const pool = new Apify.AutoscaledPool({
            maybeRunIntervalMillis: 10,
            finishWhenEmpty: false,
            minConcurrency: 3,
            workerFunction: () => tasks.pop(),
        });
        setTimeout(() => pool.finish(), 3000);
        await pool.run();

        // Check finished tasks.
        expect(finished).to.be.eql([0, 1, 2, 3, 4, 5]);
    });
});

