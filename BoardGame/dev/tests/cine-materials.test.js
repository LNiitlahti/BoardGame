const test = require('node:test');
const assert = require('node:assert');
const CineMaterials = require('../../full/scripts/cinematic/cine-materials.js');

test('materialFor: returns the explicitly assigned material', () => {
    const cm = new CineMaterials({ default: 'dust', materials: { q0r0: 'magic', 'q1r-1': 'lava' } });
    assert.strictEqual(cm.materialFor('q0r0'), 'magic');
    assert.strictEqual(cm.materialFor('q1r-1'), 'lava');
});

test('materialFor: falls back to the doc default for unassigned coords', () => {
    const cm = new CineMaterials({ default: 'dust', materials: { q0r0: 'magic' } });
    assert.strictEqual(cm.materialFor('q5r-5'), 'dust');
});

test('materialFor: falls back to hardcoded "dust" if doc has no default field', () => {
    const cm = new CineMaterials({ materials: { q0r0: 'water' } });
    assert.strictEqual(cm.materialFor('q9r9'), 'dust');
});

test('constructor: tolerates a null/undefined doc entirely (load failure path)', () => {
    const cm = new CineMaterials(null);
    assert.strictEqual(cm.materialFor('q0r0'), 'dust');
    assert.strictEqual(cm.default, 'dust');
    assert.deepStrictEqual(cm.materials, {});
});

test('constructor: tolerates a doc with materials missing entirely', () => {
    const cm = new CineMaterials({ default: 'water' });
    assert.strictEqual(cm.materialFor('anything'), 'water');
});

const BoardLayouts = require('../../shared/scripts/board-layouts.js');

test('setLayout: mirrored outer hex takes its source tile material (v2)', () => {
    const V2 = BoardLayouts.get(2);
    const src = BoardLayouts.artCoordFor(V2, 'q7r-7');
    const cm = new CineMaterials({ default: 'dust', materials: { [src]: 'lava' } });
    assert.strictEqual(cm.materialFor('q7r-7'), 'dust');   // unchanged without layout
    cm.setLayout(V2);
    assert.strictEqual(cm.materialFor('q7r-7'), 'lava');
});

test('setLayout: old heart spot takes the swapped tile material, new heart the heart tile', () => {
    const V2 = BoardLayouts.get(2);
    const swapped = V2.artSwaps['q-4r2'];
    const cm = new CineMaterials({ default: 'dust', materials: { [swapped]: 'water', 'q-4r2': 'magic' } });
    cm.setLayout(V2);
    assert.strictEqual(cm.materialFor('q-4r2'), 'water');
    assert.strictEqual(cm.materialFor('q-6r3'), 'magic');
});

test('setLayout: legacy layout behaves as identity', () => {
    const cm = new CineMaterials({ default: 'dust', materials: { 'q-4r2': 'magic' } });
    cm.setLayout(BoardLayouts.get(1));
    assert.strictEqual(cm.materialFor('q-4r2'), 'magic');
});
