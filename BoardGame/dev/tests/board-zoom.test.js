// Pure zoom math for shared/scripts/board-zoom.js (pinch-zoom on phones).
const test = require('node:test');
const assert = require('node:assert');
const { clampPan, zoomAt, MIN, MAX } = require('../../shared/scripts/board-zoom.js');

const W = 360, H = 340;
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('clampPan: no pan possible at 1x', () => {
    assert.deepStrictEqual(clampPan(1, 50, -50, W, H), { x: 0, y: 0 });
});

test('clampPan: at 2x the board can move half its size each way', () => {
    assert.deepStrictEqual(clampPan(2, 1000, -1000, W, H), { x: W / 2, y: -H / 2 });
    assert.deepStrictEqual(clampPan(2, 10, 20, W, H), { x: 10, y: 20 });
});

test('zoomAt: the point under the fingers stays put', () => {
    const z = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 40, -30, W, H);
    assert.strictEqual(z.scale, 2);
    // screen point = pan + scale * boardPoint; boardPoint was (40,-30) at 1x
    assert.ok(near(z.x + 2 * 40, 40) && near(z.y + 2 * -30, -30));
});

test('zoomAt: zooming about the centre does not pan', () => {
    assert.deepStrictEqual(zoomAt({ scale: 1, x: 0, y: 0 }, 3, 0, 0, W, H), { scale: 3, x: 0, y: 0 });
});

test('zoomAt: scale is clamped to MIN..MAX and 1x resets the pan', () => {
    assert.strictEqual(zoomAt({ scale: 1, x: 0, y: 0 }, 99, 0, 0, W, H).scale, MAX);
    assert.deepStrictEqual(zoomAt({ scale: 2, x: 30, y: 30 }, 0.2, 10, 10, W, H), { scale: MIN, x: 0, y: 0 });
});

test('zoomAt: zooming at the very edge keeps the board covering its box', () => {
    const z = zoomAt({ scale: 1, x: 0, y: 0 }, 4, W / 2, H / 2, W, H);
    assert.ok(Math.abs(z.x) <= (4 - 1) * W / 2 && Math.abs(z.y) <= (4 - 1) * H / 2);
});
