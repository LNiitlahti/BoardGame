const test = require('node:test');
const assert = require('node:assert');
const CineTimeline = require('../../full/scripts/cinematic/cine-timeline.js');

function makeSpyTrack(at, duration) {
    const log = { starts: 0, updates: [], completes: 0 };
    return {
        log,
        track: {
            at,
            duration,
            onStart: () => log.starts++,
            onUpdate: p => log.updates.push(p),
            onComplete: () => log.completes++
        }
    };
}

test('track lifecycle: start once, monotonic progress 0→1, complete once', () => {
    const tl = new CineTimeline();
    const spy = makeSpyTrack(100, 200);
    tl.add(spy.track);
    tl.play(1000); // startNow = 1000ms

    tl.tick(1050); // before at
    assert.strictEqual(spy.log.starts, 0);

    tl.tick(1150); // mid
    assert.strictEqual(spy.log.starts, 1);
    tl.tick(1200);
    tl.tick(1400); // past end
    assert.strictEqual(spy.log.completes, 1);
    tl.tick(1500); // no double-fire
    assert.strictEqual(spy.log.starts, 1);
    assert.strictEqual(spy.log.completes, 1);

    const ps = spy.log.updates;
    assert.ok(ps.length >= 2);
    assert.ok(ps.every((p, i) => i === 0 || p >= ps[i - 1]), 'progress monotonic');
    assert.strictEqual(ps[ps.length - 1], 1, 'final update is exactly 1');
});

test('duration is max(at + duration) across tracks; finished flag + callback', () => {
    const tl = new CineTimeline();
    tl.add(makeSpyTrack(0, 100).track);
    tl.add(makeSpyTrack(500, 300).track);
    assert.strictEqual(tl.duration, 800);

    let finished = 0;
    tl.onFinished = () => finished++;
    tl.play(0);
    tl.tick(900);
    assert.strictEqual(tl.isFinished, true);
    assert.strictEqual(finished, 1);
});

test('skipToEnd fires remaining starts/completes exactly once, final update p=1', () => {
    const tl = new CineTimeline();
    const a = makeSpyTrack(0, 100);
    const b = makeSpyTrack(200, 100);
    tl.add(a.track);
    tl.add(b.track);
    tl.play(0);
    tl.tick(50); // a started, not complete; b untouched
    tl.skipToEnd();
    assert.strictEqual(a.log.completes, 1);
    assert.strictEqual(b.log.starts, 1);
    assert.strictEqual(b.log.completes, 1);
    assert.strictEqual(b.log.updates[b.log.updates.length - 1], 1);
    assert.strictEqual(tl.isFinished, true);
});

test('pause freezes progress; resume continues without jumping', () => {
    const tl = new CineTimeline();
    const spy = makeSpyTrack(0, 1000);
    tl.add(spy.track);
    tl.play(0);
    tl.tick(400);
    const pBefore = spy.log.updates[spy.log.updates.length - 1];
    tl.pause(500);
    tl.tick(2000); // ignored while paused
    assert.strictEqual(spy.log.updates[spy.log.updates.length - 1], pBefore);
    tl.resume(3000); // clock jumped 2500ms while paused
    tl.tick(3100);   // only 100ms of playback elapsed since pause at t=500
    const pAfter = spy.log.updates[spy.log.updates.length - 1];
    assert.ok(Math.abs(pAfter - 0.6) < 0.01, `expected ~0.6, got ${pAfter}`);
});

test('lastTickAt is recorded (watchdog support)', () => {
    const tl = new CineTimeline();
    tl.add(makeSpyTrack(0, 100).track);
    tl.play(0);
    tl.tick(42);
    assert.strictEqual(tl.lastTickAt, 42);
});
