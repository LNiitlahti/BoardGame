const test = require('node:test');
const assert = require('node:assert');
const BoardLayouts = require('../../shared/scripts/board-layouts.js');

const LEGACY = BoardLayouts.get(1);
const V2 = BoardLayouts.get(2);

function parse(coord) {
    const m = coord.match(/^q(-?\d+)r(-?\d+)$/);
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

test('legacy layout: 91 hexes, original corners and side hearts', () => {
    assert.strictEqual(LEGACY.radius, 5);
    assert.strictEqual(LEGACY.hexCount, 91);
    assert.strictEqual(BoardLayouts.coordinates(LEGACY).length, 91);
    assert.deepStrictEqual([...LEGACY.startingLocations],
        ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0']);
    assert.deepStrictEqual([...LEGACY.sideHeartLocations],
        ['q-4r2', 'q-2r-2', 'q2r-4', 'q4r-2', 'q2r2', 'q-2r4']);
    assert.strictEqual(LEGACY.mountainHeartLocation, 'q0r0');
    assert.strictEqual(LEGACY.nativeHalf, 375);
    assert.strictEqual(LEGACY.usesSharedDefaultRooms, true);
});

test('version 2 layout: 169 hexes, corners at radius 7, side hearts on ring 6 side midpoints', () => {
    assert.strictEqual(V2.radius, 7);
    assert.strictEqual(V2.hexCount, 169);
    const coords = BoardLayouts.coordinates(V2);
    assert.strictEqual(coords.length, 169);
    assert.strictEqual(new Set(coords.map(([q, r]) => `q${q}r${r}`)).size, 169);
    assert.deepStrictEqual([...V2.startingLocations],
        ['q0r-7', 'q7r-7', 'q7r0', 'q0r7', 'q-7r7', 'q-7r0']);
    assert.deepStrictEqual([...V2.sideHeartLocations],
        ['q-6r3', 'q-3r-3', 'q3r-6', 'q6r-3', 'q3r3', 'q-3r6']);
    assert.strictEqual(V2.nativeHalf, 500);
    assert.strictEqual(V2.usesSharedDefaultRooms, false);
});

test('every layout: starts and hearts are valid, on the expected rings, and distinct', () => {
    for (const layout of [LEGACY, V2]) {
        const outer = layout.radius;
        const second = layout.radius - 1;
        for (const c of layout.startingLocations) {
            const [q, r] = parse(c);
            assert.ok(BoardLayouts.isValid(layout, q, r), `${c} valid`);
            assert.strictEqual(BoardLayouts.ringOf(q, r), outer, `${c} on outer ring`);
        }
        for (const c of layout.sideHeartLocations) {
            const [q, r] = parse(c);
            assert.ok(BoardLayouts.isValid(layout, q, r), `${c} valid`);
            assert.strictEqual(BoardLayouts.ringOf(q, r), second, `${c} on second-outermost ring`);
        }
        const all = [...layout.startingLocations, ...layout.sideHeartLocations, layout.mountainHeartLocation];
        assert.strictEqual(new Set(all).size, all.length, 'no start/heart overlaps');
    }
});

test('get(): unknown, missing or garbage versions fall back to legacy', () => {
    for (const v of [undefined, null, 0, 3, 'garbage', NaN, {}]) {
        assert.strictEqual(BoardLayouts.get(v), LEGACY, `get(${String(v)})`);
    }
    assert.strictEqual(BoardLayouts.get(1), LEGACY);
    assert.strictEqual(BoardLayouts.get('1'), LEGACY);
    assert.strictEqual(BoardLayouts.get(2), V2);
    assert.strictEqual(BoardLayouts.get('2'), V2);
});

test('forTournament(): missing boardVersion means legacy; 2 means version 2', () => {
    assert.strictEqual(BoardLayouts.forTournament(null), LEGACY);
    assert.strictEqual(BoardLayouts.forTournament(undefined), LEGACY);
    assert.strictEqual(BoardLayouts.forTournament({}), LEGACY);
    assert.strictEqual(BoardLayouts.forTournament({ boardVersion: 1 }), LEGACY);
    assert.strictEqual(BoardLayouts.forTournament({ boardVersion: 2 }), V2);
});

test('DEFAULT_VERSION (what setup pre-selects) is version 2', () => {
    assert.strictEqual(BoardLayouts.DEFAULT_VERSION, 2);
    assert.strictEqual(BoardLayouts.LEGACY_VERSION, 1);
});

test('isValid(): rim and out-of-board checks', () => {
    assert.ok(BoardLayouts.isValid(LEGACY, 5, 0));
    assert.ok(!BoardLayouts.isValid(LEGACY, 6, 0));
    assert.ok(!BoardLayouts.isValid(LEGACY, 3, 3));   // |q+r| = 6
    assert.ok(BoardLayouts.isValid(V2, 7, 0));
    assert.ok(BoardLayouts.isValid(V2, 6, 0));
    assert.ok(!BoardLayouts.isValid(V2, 8, 0));
    assert.ok(!BoardLayouts.isValid(V2, 4, 4));       // |q+r| = 8
});

test('ringOf(): axial distance from the centre', () => {
    assert.strictEqual(BoardLayouts.ringOf(0, 0), 0);
    assert.strictEqual(BoardLayouts.ringOf(-2, -2), 4);
    assert.strictEqual(BoardLayouts.ringOf(3, -6), 6);
});

test('hasArt(): version 2 has art only inside radius 5', () => {
    for (const [q, r] of BoardLayouts.coordinates(LEGACY)) {
        assert.ok(BoardLayouts.hasArt(LEGACY, `q${q}r${r}`));
        assert.ok(BoardLayouts.hasArt(V2, `q${q}r${r}`), `v2 reuses legacy tile q${q}r${r}`);
    }
    assert.ok(!BoardLayouts.hasArt(V2, 'q6r0'));
    assert.ok(!BoardLayouts.hasArt(V2, 'q0r-7'));
    assert.ok(!BoardLayouts.hasArt(V2, 'not-a-coord'));
});

test('hexImagesCss(): legacy emits 91 image rules and no placeholders', () => {
    const css = BoardLayouts.hexImagesCss(LEGACY, '..');
    assert.strictEqual((css.match(/url\(/g) || []).length, 91);
    assert.ok(!css.includes('linear-gradient'));
    assert.ok(css.includes(`url('../shared/images/hexes/coords/q0r0.png')`));
});

test('hexImagesCss(): version 2 emits 91 image rules plus 78 placeholder rules, no missing-file urls', () => {
    const css = BoardLayouts.hexImagesCss(V2, '.');
    assert.strictEqual((css.match(/url\(/g) || []).length, 91);
    assert.strictEqual((css.match(/linear-gradient/g) || []).length, 78);
    assert.ok(css.includes('[data-coord="q7r-7"]'));
    assert.ok(!css.includes('coords/q7r-7.png'));
    assert.ok(css.includes(`url('./shared/images/hexes/coords/q5r0.png')`));
});

test('sync(): switches a module in place once, refreshes the renderer, ignores repeats', () => {
    let setCalls = 0;
    let refreshCalls = 0;
    const mod = { layout: LEGACY, setLayout(l) { this.layout = l; setCalls++; } };
    const renderer = { refreshLayout() { refreshCalls++; } };

    assert.strictEqual(BoardLayouts.sync(mod, renderer, { boardVersion: 2 }), true);
    assert.strictEqual(mod.layout, V2);
    assert.strictEqual(setCalls, 1);
    assert.strictEqual(refreshCalls, 1);

    assert.strictEqual(BoardLayouts.sync(mod, renderer, { boardVersion: 2 }), false);
    assert.strictEqual(setCalls, 1);
    assert.strictEqual(refreshCalls, 1);

    // A doc with no boardVersion is Legacy
    assert.strictEqual(BoardLayouts.sync(mod, renderer, {}), true);
    assert.strictEqual(mod.layout, LEGACY);
});

test('sync(): tolerates a missing module or renderer', () => {
    assert.strictEqual(BoardLayouts.sync(null, null, { boardVersion: 2 }), false);
    const mod = { layout: LEGACY, setLayout(l) { this.layout = l; } };
    assert.strictEqual(BoardLayouts.sync(mod, null, { boardVersion: 2 }), true);
    assert.strictEqual(mod.layout, V2);
});
