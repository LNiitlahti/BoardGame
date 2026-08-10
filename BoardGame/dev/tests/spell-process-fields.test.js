const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../../full/scripts/spell-process-fields.js');
const { SPELL_PROCESS_FIELDS, resolveFieldCount, shouldShowField } = global.window;

test('SPELL_PROCESS_FIELDS has entries for the representative field-type set', () => {
    assert.ok(SPELL_PROCESS_FIELDS.extra_placement);
    assert.strictEqual(SPELL_PROCESS_FIELDS.extra_placement.coords.type, 'hexes');
    assert.ok(SPELL_PROCESS_FIELDS.reposition);
    assert.strictEqual(SPELL_PROCESS_FIELDS.reposition.moves.type, 'hex-pairs');
    assert.ok(SPELL_PROCESS_FIELDS.conditional_bonus);
    assert.strictEqual(SPELL_PROCESS_FIELDS.conditional_bonus.conditionMet.type, 'boolean');
    assert.ok(SPELL_PROCESS_FIELDS.useChargedRemoval);
    assert.strictEqual(SPELL_PROCESS_FIELDS.useChargedRemoval.coord.type, 'hex');
});

test('resolveFieldCount evaluates a function count against the spell def', () => {
    const def = { effect: { amount: 2 } };
    const count = resolveFieldCount(SPELL_PROCESS_FIELDS.extra_placement.coords, def);
    assert.strictEqual(count, 2);
});

test('resolveFieldCount evaluates conditional_bonus.coords against bonus.tiles', () => {
    const def = { effect: { bonus: { points: 2, tiles: 2 } } };
    const count = resolveFieldCount(SPELL_PROCESS_FIELDS.conditional_bonus.coords, def);
    assert.strictEqual(count, 2);
});

test('resolveFieldCount falls back to 0 when bonus.tiles is absent', () => {
    const def = { effect: { bonus: {} } };
    const count = resolveFieldCount(SPELL_PROCESS_FIELDS.conditional_bonus.coords, def);
    assert.strictEqual(count, 0);
});

test('shouldShowField respects showIf against current form state', () => {
    const field = SPELL_PROCESS_FIELDS.conditional_bonus.coords;
    assert.strictEqual(shouldShowField(field, { conditionMet: true }), true);
    assert.strictEqual(shouldShowField(field, { conditionMet: false }), false);
});

test('shouldShowField defaults to true when a field has no showIf', () => {
    const field = SPELL_PROCESS_FIELDS.extra_placement.coords;
    assert.strictEqual(shouldShowField(field, {}), true);
});
