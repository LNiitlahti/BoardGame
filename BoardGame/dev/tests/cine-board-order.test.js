const test = require('node:test');
const assert = require('node:assert');
const { ringOf, buildLandingOrder } = require('../../full/scripts/cinematic/cine-board-order.js');

// Same axial generation as BoardModule.generateHexCoordinates()
function allCoords() {
    const coords = [];
    for (let q = -5; q <= 5; q++) {
        const r1 = Math.max(-5, -q - 5);
        const r2 = Math.min(5, -q + 5);
        for (let r = r1; r <= r2; r++) coords.push([q, r]);
    }
    return coords;
}

test('ringOf: center is ring 0, axial distance formula', () => {
    assert.strictEqual(ringOf(0, 0), 0);
    assert.strictEqual(ringOf(1, 0), 1);
    assert.strictEqual(ringOf(0, -5), 5);
    assert.strictEqual(ringOf(-2, -2), 4); // |q+r|=4 dominates
    assert.strictEqual(ringOf(3, -1), 3);
});

test('buildLandingOrder: 91 entries, center first, rings contiguous ascending', () => {
    const order = buildLandingOrder(allCoords());
    assert.strictEqual(order.length, 91);
    assert.strictEqual(order[0].coord, 'q0r0');
    assert.strictEqual(order[0].ring, 0);
    // Ring sizes 1,6,12,18,24,30 and never decreasing
    const counts = {};
    let prevRing = 0;
    for (const e of order) {
        assert.ok(e.ring >= prevRing, 'rings must be ascending');
        prevRing = e.ring;
        counts[e.ring] = (counts[e.ring] || 0) + 1;
    }
    assert.deepStrictEqual(counts, { 0: 1, 1: 6, 2: 12, 3: 18, 4: 24, 5: 30 });
});

test('buildLandingOrder: entries carry q, r, coord and are unique', () => {
    const order = buildLandingOrder(allCoords());
    const seen = new Set(order.map(e => e.coord));
    assert.strictEqual(seen.size, 91);
    const e = order.find(x => x.coord === 'q-3r2');
    assert.deepStrictEqual({ q: e.q, r: e.r }, { q: -3, r: 2 });
});
