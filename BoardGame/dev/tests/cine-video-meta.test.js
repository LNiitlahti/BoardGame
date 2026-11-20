const test = require('node:test');
const assert = require('node:assert');
const M = require('../../full/scripts/cinematic/cine-video-meta.js');

const good = {
    version: 1, boardVersion: '2', durationMs: 120000, fps: 60, width: 1920, height: 1080,
    nameWindows: [{ startMs: 1000, endMs: 5000 }]
};

test('boardVersionOf: missing/unknown -> "1", 2 or "2" -> "2"', () => {
    assert.strictEqual(M.boardVersionOf({}), '1');
    assert.strictEqual(M.boardVersionOf(null), '1');
    assert.strictEqual(M.boardVersionOf({ boardVersion: 2 }), '2');
    assert.strictEqual(M.boardVersionOf({ boardVersion: '2' }), '2');
    assert.strictEqual(M.boardVersionOf({ boardVersion: 'x' }), '1');
});

test('isUsable: matching board version and well-formed meta', () => {
    assert.strictEqual(M.isUsable(good, { boardVersion: 2 }), true);
});

test('isUsable: board mismatch, bad version, bad windows, missing duration -> false', () => {
    assert.strictEqual(M.isUsable(good, {}), false);
    assert.strictEqual(M.isUsable({ ...good, version: 2 }, { boardVersion: 2 }), false);
    assert.strictEqual(M.isUsable({ ...good, nameWindows: 'x' }, { boardVersion: 2 }), false);
    assert.strictEqual(M.isUsable({ ...good, nameWindows: [{ startMs: 5, endMs: 1 }] }, { boardVersion: 2 }), false);
    assert.strictEqual(M.isUsable({ ...good, durationMs: 0 }, { boardVersion: 2 }), false);
    assert.strictEqual(M.isUsable(null, { boardVersion: 2 }), false);
});
