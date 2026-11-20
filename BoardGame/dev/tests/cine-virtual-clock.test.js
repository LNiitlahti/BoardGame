const test = require('node:test');
const assert = require('node:assert');
const { createVirtualClock } = require('../../full/scripts/cinematic/cine-virtual-clock.js');

function makeGlobal() {
    return { performance: {}, Date: { now: () => 0 }, Math: Object.create(Math), console };
}

test('now() starts at 0 and advances only on step()', () => {
    const g = makeGlobal();
    const clock = createVirtualClock(g);
    clock.install();
    assert.strictEqual(g.performance.now(), 0);
    clock.step(16);
    assert.strictEqual(g.performance.now(), 16);
    assert.strictEqual(g.Date.now(), 1700000000000 + 16);
});

test('timers fire in due order, at their due time, and only once', () => {
    const g = makeGlobal();
    const clock = createVirtualClock(g);
    clock.install();
    const log = [];
    g.setTimeout(() => log.push(['b', g.performance.now()]), 30);
    g.setTimeout(() => log.push(['a', g.performance.now()]), 10);
    clock.step(5);
    assert.deepStrictEqual(log, []);
    clock.step(50);
    assert.deepStrictEqual(log, [['a', 10], ['b', 30]]);
    clock.step(100);
    assert.strictEqual(log.length, 2);
});

test('clearTimeout cancels; setInterval repeats; clearInterval stops', () => {
    const g = makeGlobal();
    const clock = createVirtualClock(g);
    clock.install();
    let fired = 0, ticks = 0;
    const id = g.setTimeout(() => fired++, 10);
    g.clearTimeout(id);
    const iv = g.setInterval(() => ticks++, 10);
    clock.step(35);
    assert.strictEqual(fired, 0);
    assert.strictEqual(ticks, 3);
    g.clearInterval(iv);
    clock.step(100);
    assert.strictEqual(ticks, 3);
});

test('a timer scheduled from inside a timer fires in the same step if due', () => {
    const g = makeGlobal();
    const clock = createVirtualClock(g);
    clock.install();
    const log = [];
    g.setTimeout(() => { log.push('outer'); g.setTimeout(() => log.push('inner'), 5); }, 10);
    clock.step(20);
    assert.deepStrictEqual(log, ['outer', 'inner']);
});

test('rAF callbacks run once per step with the virtual timestamp', () => {
    const g = makeGlobal();
    const clock = createVirtualClock(g);
    clock.install();
    const stamps = [];
    const loop = t => { stamps.push(t); g.requestAnimationFrame(loop); };
    g.requestAnimationFrame(loop);
    clock.step(10);
    clock.step(10);
    assert.deepStrictEqual(stamps, [10, 20]);
    const id = g.requestAnimationFrame(() => stamps.push('x'));
    g.cancelAnimationFrame(id);
    clock.step(10);
    assert.deepStrictEqual(stamps, [10, 20, 30]);
});

test('Math.random is seeded and repeatable', () => {
    const a = makeGlobal(); createVirtualClock(a, { seed: 7 }).install();
    const b = makeGlobal(); createVirtualClock(b, { seed: 7 }).install();
    const seqA = [a.Math.random(), a.Math.random(), a.Math.random()];
    const seqB = [b.Math.random(), b.Math.random(), b.Math.random()];
    assert.deepStrictEqual(seqA, seqB);
    assert.ok(seqA.every(x => x >= 0 && x < 1));
});

test('CSS animations are paused and seeked to virtual time; finished ones finish()', () => {
    const g = makeGlobal();
    const anims = [];
    function fakeAnim(endTime) {
        return {
            currentTime: null, paused: false, finished: false,
            effect: { getComputedTiming: () => ({ endTime }) },
            pause() { this.paused = true; },
            finish() { this.finished = true; }
        };
    }
    g.document = { getAnimations: () => anims.filter(a => !a.finished) };
    const clock = createVirtualClock(g);
    clock.install();
    clock.step(100);
    const a = fakeAnim(50);
    anims.push(a);
    clock.step(16);           // first seen at T=116 -> local 0
    assert.strictEqual(a.paused, true);
    assert.strictEqual(a.currentTime, 0);
    clock.step(16);
    assert.strictEqual(a.currentTime, 16);
    clock.step(40);           // local 56 >= endTime 50
    assert.strictEqual(a.finished, true);
});
