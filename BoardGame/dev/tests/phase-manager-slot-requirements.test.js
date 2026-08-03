/**
 * Regression coverage for phase-manager.js's getSlotRequirements() /
 * belongsToSlot() — the per-slot ("Match 1"/"Match 2") progression bug
 * where a queue entry with no `.slot` tag used to count as pending/ongoing
 * for BOTH match slots at once (see the doc comment above getSlotRequirements
 * in full/scripts/phase-manager.js for the full writeup).
 *
 * The bug: belongsToSlot's untagged fallback was `m.createdAt >=
 * phaseStartedAt`, which has no slot discrimination — a single untagged
 * match created this round would satisfy getSlotRequirements(1) AND
 * getSlotRequirements(2) simultaneously. The fix: untagged matches never
 * belong to any slot (hard `return false`), plus a deduped console.warn so
 * a stuck slot is diagnosable in devtools.
 *
 * phase-manager.js is a plain browser script (`window.PhaseManager = ...`,
 * no module.exports), so it's loaded here the same way the browser would:
 * stub a `global.window` before requiring it, then read the class back off
 * that stub. getSlotRequirements() only touches gameState/getSlotSubPhase
 * for the 'setup'/'playing' sub-phases exercised below, so no DOM/Firebase
 * dependency is needed to instantiate PhaseManager and call it directly.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../../full/scripts/phase-manager.js');
const PhaseManager = global.window.PhaseManager;

function makePhaseManager(gameState) {
    return new PhaseManager(gameState, {});
}

function baseGameState(overrides = {}) {
    return {
        currentPhase: {
            name: 'matches_in_progress',
            roundNumber: 42,
            startedAt: 1_000_000,
            slots: { 1: 'setup', 2: 'setup' }
        },
        gameQueue: [],
        ...overrides
    };
}

// ---- core regression: one untagged match must not satisfy BOTH slots ----

test('an untagged match created this round satisfies NEITHER slot 1 nor slot 2 (setup sub-phase)', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'untagged-1', status: 'pending', createdAt: 2_000_000 } // no .slot, created after phaseStartedAt
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    const slot2 = pm.getSlotRequirements(2);

    assert.strictEqual(slot1.every(r => r.met), false, `slot 1 should NOT be met, got: ${JSON.stringify(slot1)}`);
    assert.strictEqual(slot2.every(r => r.met), false, `slot 2 should NOT be met, got: ${JSON.stringify(slot2)}`);
    assert.match(slot1[0].label, /Create a match/);
    assert.match(slot2[0].label, /Create a match/);
});

test('an untagged ongoing match does not satisfy either slot\'s "playing" requirements', () => {
    const gs = baseGameState({
        currentPhase: {
            name: 'matches_in_progress',
            roundNumber: 42,
            startedAt: 1_000_000,
            slots: { 1: 'playing', 2: 'playing' }
        },
        gameQueue: [
            { id: 'untagged-2', status: 'ongoing', createdAt: 2_000_000 }
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    const slot2 = pm.getSlotRequirements(2);

    // Neither slot saw a match "start" for it, since the untagged match
    // belongs to no slot — both should report "Start the match first".
    assert.deepStrictEqual(slot1, [{ label: 'Start the match first', met: false }]);
    assert.deepStrictEqual(slot2, [{ label: 'Start the match first', met: false }]);
});

// ---- no regression: correctly tagged matches still work exactly as before ----

test('a correctly slot-tagged pending match still satisfies only its own slot (setup sub-phase)', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'tagged-slot-1', status: 'pending', createdAt: 2_000_000, slot: 1, roundNumber: 42 }
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    const slot2 = pm.getSlotRequirements(2);

    assert.strictEqual(slot1.every(r => r.met), true, `slot 1 should be met, got: ${JSON.stringify(slot1)}`);
    assert.strictEqual(slot2.every(r => r.met), false, `slot 2 should NOT be met, got: ${JSON.stringify(slot2)}`);
});

test('a correctly slot-tagged ongoing match satisfies "playing" only for its own slot', () => {
    const gs = baseGameState({
        currentPhase: {
            name: 'matches_in_progress',
            roundNumber: 42,
            startedAt: 1_000_000,
            slots: { 1: 'playing', 2: 'playing' }
        },
        gameQueue: [
            { id: 'tagged-slot-2', status: 'ongoing', createdAt: 2_000_000, slot: 2, roundNumber: 42 }
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    const slot2 = pm.getSlotRequirements(2);

    assert.deepStrictEqual(slot1, [{ label: 'Start the match first', met: false }]);
    assert.deepStrictEqual(slot2, [{ label: '1 match still playing', met: false }]);
});

test('a slot-tagged match from a stale prior round does not block the current round\'s slot', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'stale-round', status: 'pending', createdAt: 500, slot: 1, roundNumber: 1 } // roundNumber !== currentRoundNumber (42)
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    assert.strictEqual(slot1.every(r => r.met), false, `slot 1 should NOT be met by a stale-round match, got: ${JSON.stringify(slot1)}`);
    assert.match(slot1[0].label, /Create a match/);
});

// ---- console.warn: fires once per untagged match id, deduped across calls ----

test('console.warn fires exactly once for an untagged match across repeated getSlotRequirements calls', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'warn-dedup-1', status: 'pending', createdAt: 2_000_000 }
        ]
    });
    const pm = makePhaseManager(gs);

    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
        pm.getSlotRequirements(1);
        pm.getSlotRequirements(2);
        pm.getSlotRequirements(1);
    } finally {
        console.warn = originalWarn;
    }

    const warnsForThisMatch = calls.filter(msg => msg.includes('warn-dedup-1'));
    assert.strictEqual(warnsForThisMatch.length, 1,
        `expected exactly one console.warn for match warn-dedup-1, got ${warnsForThisMatch.length}: ${JSON.stringify(calls)}`);
    assert.match(warnsForThisMatch[0], /\[PhaseManager\].*no \.slot tag/);
});

test('console.warn fires again for a DIFFERENT untagged match id (dedup key is per-match, not global)', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'warn-dedup-2a', status: 'pending', createdAt: 2_000_000 },
            { id: 'warn-dedup-2b', status: 'pending', createdAt: 2_000_000 }
        ]
    });
    const pm = makePhaseManager(gs);

    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
        pm.getSlotRequirements(1);
    } finally {
        console.warn = originalWarn;
    }

    assert.ok(calls.some(msg => msg.includes('warn-dedup-2a')), 'expected a warning mentioning warn-dedup-2a');
    assert.ok(calls.some(msg => msg.includes('warn-dedup-2b')), 'expected a warning mentioning warn-dedup-2b');
});
