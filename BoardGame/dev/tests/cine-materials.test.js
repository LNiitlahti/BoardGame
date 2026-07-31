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
