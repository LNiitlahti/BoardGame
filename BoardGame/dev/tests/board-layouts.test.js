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
    assert.strictEqual(LEGACY.defaultRoomsDocId, 'defaultRooms');
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
    assert.strictEqual(V2.defaultRoomsDocId, 'defaultRoomsV2');
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

test('hexImagesCss(): version 2 emits 169 image rules, no gradient, outer hex uses its mirror file', () => {
    const css = BoardLayouts.hexImagesCss(V2, '.');
    assert.strictEqual((css.match(/url\(/g) || []).length, 169);
    assert.strictEqual((css.match(/linear-gradient/g) || []).length, 0);
    const src = BoardLayouts.mirrorIntoArt(V2, 'q7r-7');
    assert.notStrictEqual(src, 'q7r-7');
    assert.ok(css.includes(`[data-coord="q7r-7"]::before {\n    background-image: url('./shared/images/hexes/coords/${src}.png');`));
    assert.ok(!css.includes('coords/q7r-7.png'));
    assert.ok(css.includes(`[data-coord="q5r0"]::before {\n    background-image: url('./shared/images/hexes/coords/q5r0.png');`));
});

test('hexImagesCss(): legacy output equals the old generator (91 rules, own file each)', () => {
    const expected = BoardLayouts.coordinates(LEGACY).map(([q, r]) =>
        `body.effect-hex-images .board-hex[data-coord="q${q}r${r}"]::before {\n    background-image: url('../shared/images/hexes/coords/q${q}r${r}.png');\n}`
    ).join('\n');
    assert.strictEqual(BoardLayouts.hexImagesCss(LEGACY, '..'), expected);
});

const fs = require('node:fs');
const path = require('node:path');
const OLD_HEARTS = ['q-4r2', 'q-2r-2', 'q2r-4', 'q4r-2', 'q2r2', 'q-2r4'];
const NEW_HEARTS = ['q-6r3', 'q-3r-3', 'q3r-6', 'q6r-3', 'q3r3', 'q-3r6'];
const key = (q, r) => `q${q}r${r}`;
const dist = (a, b) => {
    const [aq, ar] = parse(a); const [bq, br] = parse(b);
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs((aq + ar) - (bq + br)));
};
const ringC = (c) => BoardLayouts.ringOf(...parse(c));

test('mirrorIntoArt(): identity for ring <= 5', () => {
    for (const [q, r] of BoardLayouts.coordinates(LEGACY)) {
        assert.strictEqual(BoardLayouts.mirrorIntoArt(V2, key(q, r)), key(q, r));
    }
});

test('mirrorIntoArt(): each new side heart mirrors onto the matching old heart', () => {
    NEW_HEARTS.forEach((h, i) => assert.strictEqual(BoardLayouts.mirrorIntoArt(V2, h), OLD_HEARTS[i]));
});

test('artCoordFor(): every v2 hex maps to an existing tile; ring 6 -> ring 4, ring 7 -> ring 3', () => {
    const dir = path.join(__dirname, '../../shared/images/hexes/coords');
    for (const [q, r] of BoardLayouts.coordinates(V2)) {
        const c = key(q, r);
        const src = BoardLayouts.artCoordFor(V2, c);
        assert.ok(src, c);
        assert.ok(ringC(src) <= 5, `${c} -> ${src}`);
        assert.ok(fs.existsSync(path.join(dir, `${src}.png`)), `${src}.png exists`);
        const ring = BoardLayouts.ringOf(q, r);
        // Corners of a ring tie on two axes; the reflection then lands on ring 5.
        const v = [q, r, -q - r].map(Math.abs);
        const corner = v.filter(x => x === ring).length > 1;
        // Ring 6 -> ring 4; ring 7 -> ring 3, or 4 near a corner (the second
        // axis is then the larger one after reflecting).
        if (ring === 6) assert.strictEqual(ringC(src), corner ? 5 : 4, c);
        if (ring === 7) assert.ok(corner ? ringC(src) === 5 : [3, 4].includes(ringC(src)), c);
    }
});

test('mirrorIntoArt(): adjacent outer hexes on the same side have adjacent-or-equal sources', () => {
    const dom = (q, r) => {
        const v = [q, r, -q - r];
        let i = 0;
        for (let k = 1; k < 3; k++) if (Math.abs(v[k]) > Math.abs(v[i])) i = k;
        return `${i}${Math.sign(v[i])}`;
    };
    const outer = BoardLayouts.coordinates(V2).filter(([q, r]) => BoardLayouts.ringOf(q, r) > 5);
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    let checked = 0;
    for (const [q, r] of outer) {
        for (const [dq, dr] of dirs) {
            const nq = q + dq, nr = r + dr;
            if (!BoardLayouts.isValid(V2, nq, nr) || BoardLayouts.ringOf(nq, nr) <= 5) continue;
            if (dom(q, r) !== dom(nq, nr)) continue;
            const d = dist(BoardLayouts.mirrorIntoArt(V2, key(q, r)), BoardLayouts.mirrorIntoArt(V2, key(nq, nr)));
            assert.ok(d <= 1, `${key(q, r)} / ${key(nq, nr)} sources ${d} apart`);
            checked++;
        }
    }
    assert.ok(checked > 100);
});

test('artCoordFor(): new hearts show the old heart tiles', () => {
    NEW_HEARTS.forEach((h, i) => assert.strictEqual(BoardLayouts.artCoordFor(V2, h), OLD_HEARTS[i]));
});

test('artCoordFor(): old heart spots on v2 show their inward ring-3 neighbour, not themselves', () => {
    for (const h of OLD_HEARTS) {
        const t = BoardLayouts.artCoordFor(V2, h);
        assert.notStrictEqual(t, h);
        assert.strictEqual(ringC(t), 3);
        assert.strictEqual(dist(t, h), 1);
        assert.strictEqual(V2.artSwaps[h], t);
    }
    assert.ok(Object.isFrozen(V2.artSwaps));
});

test('artCoordFor(): heart tile files are used by exactly the six new hearts in v2', () => {
    const users = {};
    for (const [q, r] of BoardLayouts.coordinates(V2)) {
        const src = BoardLayouts.artCoordFor(V2, key(q, r));
        (users[src] = users[src] || []).push(key(q, r));
    }
    OLD_HEARTS.forEach((h, i) => assert.deepStrictEqual(users[h], [NEW_HEARTS[i]]));
});

test('artCoordFor(): legacy is identity with no swaps', () => {
    assert.deepStrictEqual({ ...LEGACY.artSwaps }, {});
    for (const [q, r] of BoardLayouts.coordinates(LEGACY)) {
        assert.strictEqual(BoardLayouts.artCoordFor(LEGACY, key(q, r)), key(q, r));
    }
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

test('get(): only 1/2 or exact "1"/"2" select a layout; everything else is Legacy', () => {
    [[2], ' 2 ', '2.0', '0x2', true].forEach(v => {
        assert.strictEqual(BoardLayouts.get(v), LEGACY, `get(${JSON.stringify(v)})`);
    });
    assert.strictEqual(BoardLayouts.get(2), V2);
    assert.strictEqual(BoardLayouts.get('2'), V2);
    assert.strictEqual(BoardLayouts.get(1), LEGACY);
    assert.strictEqual(BoardLayouts.get('1'), LEGACY);
});

test('sync(): a module without setLayout returns false instead of throwing', () => {
    assert.strictEqual(BoardLayouts.sync({ layout: null }, null, { boardVersion: 2 }), false);
});

test('sync(): re-applies the tournament rooms after switching layout', () => {
    const applied = [];
    const mod = {
        layout: LEGACY,
        setLayout(l) { this.layout = l; },
        setRoomHexes(rooms) { applied.push([...rooms]); }
    };
    BoardLayouts.sync(mod, null, { boardVersion: 2, rooms: ['q6r0', 'q-4r2'] });
    assert.deepStrictEqual(applied, [['q6r0', 'q-4r2']]);

    // No change of layout -> rooms are not touched again
    BoardLayouts.sync(mod, null, { boardVersion: 2, rooms: ['q1r0'] });
    assert.strictEqual(applied.length, 1);

    // A doc without a rooms array is fine
    BoardLayouts.sync(mod, null, {});
    assert.strictEqual(applied.length, 1);
});
