/**
 * Coverage for advancePhase()'s concurrency + auto-advance behavior, plus
 * (later tasks) break-counter and setPhaseDirect semantics.
 *
 * Double-click bug under test: advancePhase used to gate on the CACHED
 * requirements (_cachedReqs), which are only refreshed after the Firestore
 * save completes. A second click during the in-flight save re-passed the
 * gate against the PREVIOUS phase's allMet and advanced a second time —
 * one double-tap skipped a phase (and on round >= 2, skipping scoring_hex
 * silently awarded territory points). The fix is an in-flight guard plus a
 * fresh requirements computation at the gate; the round_advance
 * auto-advance chain must keep working (it re-enters advancePhase after
 * the guard is released).
 */
const test = require('node:test');
const assert = require('node:assert');

// phase-manager.js references bare ICON_SVGS and window at load time.
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.window = global.window || {};
// Render methods hit document; every one early-returns on a null element.
global.document = global.document || {
    getElementById: () => null,
    createElement: () => ({ textContent: '', innerHTML: '' }),
    querySelectorAll: () => []
};
require('../../full/scripts/phase-manager.js');
const PhaseManager = global.window.PhaseManager;

function makePM(gameState, extraDeps = {}) {
    return new PhaseManager(gameState, {
        uiManager: { showStatus() {} },
        saveCallback: async () => {},
        ...extraDeps
    });
}

test('two overlapping advancePhase calls advance exactly ONE phase', async () => {
    const gs = {
        status: 'playing',
        currentPhase: { name: 'scoring_vp', roundNumber: 2, startedAt: '2026-08-05T10:00:00.000Z' },
        teams: [], gameQueue: []
    };
    let release;
    const slowSave = () => new Promise(r => { release = r; });
    const pm = makePM(gs, { saveCallback: slowSave });
    const p1 = pm.advancePhase();
    const p2 = pm.advancePhase(); // fired while save #1 is in flight
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(gs.currentPhase.name, 'scoring_hex', 'double-click must not skip a phase');
    assert.strictEqual([r1, r2].filter(Boolean).length, 1, 'exactly one call should report success');
});

test('round_advance auto-advance still chains through to scoring_vp', async () => {
    const gs = {
        status: 'playing',
        currentPhase: {
            name: 'matches_in_progress', roundNumber: 2,
            startedAt: '2026-08-05T10:00:00.000Z', slots: { 1: 'done', 2: 'done' }
        },
        teams: [], gameQueue: []
    };
    const pm = makePM(gs);
    await pm.advancePhase();
    assert.strictEqual(gs.currentPhase.name, 'scoring_vp');
    assert.strictEqual(gs.currentPhase.roundNumber, 3);
});

test('a sub-2-minute break does not reset the auto-break counter', async () => {
    const gs = {
        status: 'playing',
        currentPhase: {
            name: 'break', roundNumber: 2,
            startedAt: new Date().toISOString(), // just started
            returnToPhase: 'scoring_vp'
        },
        breakSettings: { intervalRounds: 2, roundsSinceLastBreak: 2, lastBreakAt: null },
        teams: [], gameQueue: []
    };
    const pm = makePM(gs);
    await pm.endBreak();
    assert.strictEqual(gs.currentPhase.name, 'scoring_vp');
    assert.strictEqual(gs.breakSettings.roundsSinceLastBreak, 2, 'accidental break must not cancel the scheduled one');
});

test('a real (>2 min) break resets the auto-break counter', async () => {
    const gs = {
        status: 'playing',
        currentPhase: {
            name: 'break', roundNumber: 2,
            startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            returnToPhase: 'scoring_vp'
        },
        breakSettings: { intervalRounds: 2, roundsSinceLastBreak: 2, lastBreakAt: null },
        teams: [], gameQueue: []
    };
    const pm = makePM(gs);
    await pm.endBreak();
    assert.strictEqual(gs.breakSettings.roundsSinceLastBreak, 0);
});

test('setPhaseDirect sets phase, round, slots and keeps status consistent', async () => {
    const gs = {
        status: 'playing',
        currentPhase: { name: 'board_resolved', roundNumber: 3, startedAt: '2026-08-05T10:00:00.000Z' },
        teams: [], gameQueue: [], spellPhase: { isActive: true }
    };
    const pm = makePM(gs);
    const ok = await pm.setPhaseDirect({ name: 'matches_in_progress', roundNumber: 2, slots: { 1: 'playing', 2: 'setup' } });
    assert.strictEqual(ok, true);
    assert.strictEqual(gs.currentPhase.name, 'matches_in_progress');
    assert.strictEqual(gs.currentPhase.roundNumber, 2);
    assert.deepStrictEqual(gs.currentPhase.slots, { 1: 'playing', 2: 'setup' });
    assert.strictEqual(gs.spellPhase.isActive, false, 'spell state must not leak across a manual jump');
});

test('setPhaseDirect rejects unknown phases', async () => {
    const gs = { status: 'playing', currentPhase: { name: 'scoring_vp', roundNumber: 1 }, teams: [], gameQueue: [] };
    const pm = makePM(gs);
    const ok = await pm.setPhaseDirect({ name: 'no_such_phase', roundNumber: 1 });
    assert.strictEqual(ok, false);
    assert.strictEqual(gs.currentPhase.name, 'scoring_vp');
});
