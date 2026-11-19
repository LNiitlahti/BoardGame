const test = require('node:test');
const assert = require('node:assert');
const { nextFreeSlotTag } = require('../../shared/scripts/match-slot-tags.js');

const m = (roundNumber, slot, extra = {}) => ({ id: Math.random(), roundNumber, slot, status: 'pending', ...extra });

test('empty queue -> current round, slot 1', () => {
    assert.deepStrictEqual(nextFreeSlotTag([], 3), { roundNumber: 3, slot: 1 });
});

test('slot 1 taken -> slot 2', () => {
    assert.deepStrictEqual(nextFreeSlotTag([m(3, 1)], 3), { roundNumber: 3, slot: 2 });
});

test('both slots taken -> next round, slot 1', () => {
    assert.deepStrictEqual(nextFreeSlotTag([m(3, 1), m(3, 2)], 3), { roundNumber: 4, slot: 1 });
});

test('completed matches still occupy their slot', () => {
    assert.deepStrictEqual(nextFreeSlotTag([m(3, 1, { status: 'completed' })], 3), { roundNumber: 3, slot: 2 });
});

test('challenges and breaks never occupy a match slot', () => {
    const q = [m(3, 1, { isChallenge: true }), { id: 9, isBreak: true, roundNumber: 3, slot: 1 }];
    assert.deepStrictEqual(nextFreeSlotTag(q, 3), { roundNumber: 3, slot: 1 });
});

test('untagged entries are ignored', () => {
    assert.deepStrictEqual(nextFreeSlotTag([{ id: 1, status: 'pending' }], 3), { roundNumber: 3, slot: 1 });
});

test('entries from earlier rounds do not matter', () => {
    assert.deepStrictEqual(nextFreeSlotTag([m(2, 1), m(2, 2)], 3), { roundNumber: 3, slot: 1 });
});

test('string slot "1" counts as slot 1', () => {
    assert.deepStrictEqual(nextFreeSlotTag([m(3, '1')], 3), { roundNumber: 3, slot: 2 });
});

test('round 0 (pre-game setup) is treated as round 1', () => {
    assert.deepStrictEqual(nextFreeSlotTag([], 0), { roundNumber: 1, slot: 1 });
});

test('missing round number is treated as round 1', () => {
    assert.deepStrictEqual(nextFreeSlotTag([], undefined), { roundNumber: 1, slot: 1 });
});

test('a gap in a later round is not used before the current round fills', () => {
    assert.deepStrictEqual(nextFreeSlotTag([m(3, 1), m(4, 2)], 3), { roundNumber: 3, slot: 2 });
});

test('null / missing queue is treated as empty', () => {
    assert.deepStrictEqual(nextFreeSlotTag(null, 2), { roundNumber: 2, slot: 1 });
});
