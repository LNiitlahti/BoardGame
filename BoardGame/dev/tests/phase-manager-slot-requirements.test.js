/**
 * Regression coverage for phase-manager.js's getSlotRequirements() /
 * belongsToSlot() untagged-match handling (see the doc comment above
 * getSlotRequirements in full/scripts/phase-manager.js for the full
 * writeup, and admin-improved-adapter.js's `_belongsToCurrentSlot` for the
 * identical, deliberately-mirrored gate used by admin.html).
 *
 * Policy under test: an untagged queue entry (no `.slot` field) counts as
 * belonging to BOTH match slots, but ONLY if it was created at/after the
 * current matches_in_progress phase began (createdAt >= phaseStartedAt).
 * This is a deliberate tradeoff, not an oversight: excluding untagged
 * matches entirely would reintroduce a previously-confirmed production bug
 * (TODO.md's "match slot never reaches done" — ~61 leftover untagged
 * matches from before slot-tagging existed kept a round from ever reaching
 * round_advance, since an ever-growing pool of untagged matches would
 * never let a slot's pending list empty out). Accepting a narrower risk
 * (a single untagged match created THIS round could double-satisfy both
 * slots) in exchange for avoiding that much more common stuck-forever
 * failure is the chosen policy on both admin.html's and god.html's copies
 * of this logic. A deduped console.warn still fires so an untagged match
 * is diagnosable in devtools.
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
// The icon refactor made the script reference bare ICON_SVGS at load time;
// any icon name resolves to '' — tests don't render markup.
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
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

// ---- untagged match created THIS round: counts toward BOTH slots (by design) ----

test('an untagged match created this round satisfies BOTH slot 1 and slot 2 (setup sub-phase)', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'untagged-1', status: 'pending', createdAt: 2_000_000 } // no .slot, created after phaseStartedAt
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    const slot2 = pm.getSlotRequirements(2);

    assert.strictEqual(slot1.every(r => r.met), true, `slot 1 should be met, got: ${JSON.stringify(slot1)}`);
    assert.strictEqual(slot2.every(r => r.met), true, `slot 2 should be met, got: ${JSON.stringify(slot2)}`);
});

test('an untagged ongoing match satisfies BOTH slots\' "playing" requirements', () => {
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

    assert.deepStrictEqual(slot1, [{ label: '1 match still playing', met: false }]);
    assert.deepStrictEqual(slot2, [{ label: '1 match still playing', met: false }]);
});

// ---- untagged match from a PRIOR phase attempt: excluded, prevents stuck-forever ----

test('an untagged match created BEFORE the current phase started does not satisfy either slot (stuck-forever prevention)', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'stale-untagged', status: 'pending', createdAt: 500 } // no .slot, created before phaseStartedAt (1_000_000)
        ]
    });
    const pm = makePhaseManager(gs);

    const slot1 = pm.getSlotRequirements(1);
    const slot2 = pm.getSlotRequirements(2);

    assert.strictEqual(slot1.every(r => r.met), false, `slot 1 should NOT be met by a stale untagged match, got: ${JSON.stringify(slot1)}`);
    assert.strictEqual(slot2.every(r => r.met), false, `slot 2 should NOT be met by a stale untagged match, got: ${JSON.stringify(slot2)}`);
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

test('console.warn does NOT fire for a stale (pre-phase) untagged match', () => {
    const gs = baseGameState({
        gameQueue: [
            { id: 'no-warn-stale', status: 'pending', createdAt: 500 }
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

    assert.strictEqual(calls.filter(msg => msg.includes('no-warn-stale')).length, 0,
        'a stale untagged match that never counts toward any slot should not warn');
});
