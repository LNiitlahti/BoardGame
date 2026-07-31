const test = require('node:test');
const assert = require('node:assert');
const easings = require('../../full/scripts/cinematic/cine-easing.js');

test('every easing maps 0→0 and 1→1', () => {
    for (const [name, fn] of Object.entries(easings)) {
        assert.ok(Math.abs(fn(0)) < 1e-9, `${name}(0) should be 0`);
        assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1) should be 1`);
    }
});

test('easeOutCubic decelerates (first half covers more than half)', () => {
    assert.ok(easings.easeOutCubic(0.5) > 0.5);
});

test('easeInCubic accelerates (first half covers less than half)', () => {
    assert.ok(easings.easeInCubic(0.5) < 0.5);
});

test('easeOutBack overshoots past 1 mid-curve', () => {
    let overshot = false;
    for (let t = 0.5; t < 1; t += 0.01) {
        if (easings.easeOutBack(t) > 1) overshot = true;
    }
    assert.ok(overshot);
});
