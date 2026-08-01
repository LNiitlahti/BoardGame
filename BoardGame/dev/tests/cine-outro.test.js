const test = require('node:test');
const assert = require('node:assert');
const { computeOutro } = require('../../full/scripts/cinematic/cine-outro.js');

test('computeOutro: music longer than cinematicOwnEnd extends by the difference', () => {
    const result = computeOutro(109800, 287320);
    assert.strictEqual(result.outroDurationMs, 287320 - 109800);
    assert.strictEqual(result.finalEnd, 287320);
});

test('computeOutro: music shorter than cinematicOwnEnd floors outro to zero', () => {
    const result = computeOutro(109800, 50000);
    assert.strictEqual(result.outroDurationMs, 0);
    assert.strictEqual(result.finalEnd, 109800);
});

test('computeOutro: music exactly equal to cinematicOwnEnd floors outro to zero', () => {
    const result = computeOutro(109800, 109800);
    assert.strictEqual(result.outroDurationMs, 0);
    assert.strictEqual(result.finalEnd, 109800);
});

test('computeOutro: musicDurationMs of 0 (failed load) floors outro to zero', () => {
    const result = computeOutro(109800, 0);
    assert.strictEqual(result.outroDurationMs, 0);
    assert.strictEqual(result.finalEnd, 109800);
});
