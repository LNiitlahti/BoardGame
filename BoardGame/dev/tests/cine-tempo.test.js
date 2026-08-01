// BoardGame/dev/tests/cine-tempo.test.js
const test = require('node:test');
const assert = require('node:assert');
const { computeTempo } = require('../../full/scripts/cinematic/cine-tempo.js');

test('computeTempo: no stems loaded returns baseline 1.0', () => {
    assert.strictEqual(computeTempo([], 5000), 1);
});

test('computeTempo: stems present but no beats in window returns baseline 1.0', () => {
    const stem = { beats: [100, 200] };
    assert.strictEqual(computeTempo([stem], 50000), 1);
});

test('computeTempo: null/undefined/beatless stems in the array are skipped without throwing', () => {
    assert.strictEqual(computeTempo([null, undefined, { beats: [] }], 5000), 1);
});

test('computeTempo: counts beats within the trailing 2s window only (exclusive start, inclusive end)', () => {
    // t=5000 -> window is (3000, 5000]. 1000 is outside, 3500 and 4000 are inside.
    const stem = { beats: [1000, 3500, 4000] };
    assert.ok(Math.abs(computeTempo([stem], 5000) - (1 + (2 / 8) * 0.6)) < 1e-9);
});

test('computeTempo: sums beats across multiple stems', () => {
    const a = { beats: [4000, 4500] };
    const b = { beats: [4200] };
    assert.ok(Math.abs(computeTempo([a, b], 5000) - (1 + (3 / 8) * 0.6)) < 1e-9);
});

test('computeTempo: clamps at 8+ beats in the window to the max speedFactor (1.6)', () => {
    const stem = { beats: [3100, 3200, 3300, 3400, 3500, 3600, 3700, 3800, 3900, 4000] };
    assert.strictEqual(computeTempo([stem], 5000), 1.6);
});
