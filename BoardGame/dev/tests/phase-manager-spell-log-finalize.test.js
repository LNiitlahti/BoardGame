/**
 * Regression coverage for _clearSpellPhaseState()'s manual spell-log
 * finalization (docs/superpowers/specs/2026-08-05-manual-spell-log-design.md).
 * Same require pattern as phase-manager-slot-requirements.test.js: stub
 * global.window, require the plain-script file, read the class back off it.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/phase-manager.js');
const PhaseManager = global.window.PhaseManager;

function makePhaseManager(gameState, logActionCallback) {
    return new PhaseManager(gameState, { logActionCallback });
}

/**
 * Caller-level variant: the finalization bugs are about WHICH callers reach
 * _clearSpellPhaseState, so these tests drive the real public methods. Only
 * the two hard dependencies those methods touch are stubbed (uiManager's
 * showStatus + the save callback), plus the two render hooks, which need a
 * DOM this test file deliberately doesn't build.
 */
function makeCallerPhaseManager(gameState, logActionCallback) {
    const pm = new PhaseManager(gameState, {
        uiManager: { showStatus: () => {} },
        saveCallback: async () => {},
        logActionCallback
    });
    pm.recheckRequirements = () => {};
    pm.renderPhaseIndicator = () => {};
    return pm;
}

function baseGameState(overrides = {}) {
    return {
        currentPhase: { name: 'spell_window_2', roundNumber: 3 },
        spellPhase: { isActive: true },
        ...overrides
    };
}

test('_clearSpellPhaseState logs one spell_used_manual action per surviving entry', () => {
    const logged = [];
    const gs = baseGameState({
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Red', spellName: 'Fireball', addedAt: 1 },
            { id: 'sl_2', teamId: 't2', teamName: 'Blue', spellName: 'Shield', addedAt: 2 }
        ]
    });
    const pm = makePhaseManager(gs, (actionType, category, payload, prev) => {
        logged.push({ actionType, category, payload, prev });
    });

    pm._clearSpellPhaseState();

    assert.strictEqual(logged.length, 2);
    assert.strictEqual(logged[0].actionType, 'spell_used_manual');
    assert.strictEqual(logged[0].category, 'spell');
    assert.deepStrictEqual(logged[0].payload, {
        teamId: 't1', teamName: 'Red', spellName: 'Fireball', phase: 'spell_window_2', roundNumber: 3
    });
    assert.strictEqual(logged[1].payload.teamName, 'Blue');
});

test('_clearSpellPhaseState clears gameState.spellWindowLog after finalizing', () => {
    const gs = baseGameState({
        spellWindowLog: [{ id: 'sl_1', teamId: 't1', teamName: 'Red', spellName: 'Fireball', addedAt: 1 }]
    });
    const pm = makePhaseManager(gs, () => {});

    pm._clearSpellPhaseState();

    assert.strictEqual(gs.spellWindowLog, null);
});

test('_clearSpellPhaseState logs nothing when spellWindowLog is empty or absent', () => {
    const logged = [];
    const logCb = (...args) => logged.push(args);

    const gsEmpty = baseGameState({ spellWindowLog: [] });
    makePhaseManager(gsEmpty, logCb)._clearSpellPhaseState();

    const gsAbsent = baseGameState();
    makePhaseManager(gsAbsent, logCb)._clearSpellPhaseState();

    assert.strictEqual(logged.length, 0);
});

test('_clearSpellPhaseState still deactivates spellPhase.isActive (existing behavior preserved)', () => {
    const gs = baseGameState({ spellWindowLog: [] });
    const pm = makePhaseManager(gs, () => {});

    pm._clearSpellPhaseState();

    assert.strictEqual(gs.spellPhase.isActive, false);
});

/**
 * setPhaseDirect() calls _clearSpellPhaseState() AFTER gs.currentPhase has
 * already been reassigned to the destination phase, so it passes the
 * captured previousPhase explicitly. Entries must be attributed to the spell
 * window they were actually cast in, not to wherever the admin jumped to.
 */
test('_clearSpellPhaseState attributes entries to an explicitly passed phase context', () => {
    const logged = [];
    const gs = baseGameState({
        currentPhase: { name: 'matches_in_progress', roundNumber: 9 },
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Red', spellName: 'Fireball', addedAt: 1 }
        ]
    });
    const pm = makePhaseManager(gs, (actionType, category, payload) => {
        logged.push({ actionType, category, payload });
    });

    pm._clearSpellPhaseState({ name: 'spell_window_2', roundNumber: 3 });

    assert.strictEqual(logged.length, 1);
    assert.strictEqual(logged[0].payload.phase, 'spell_window_2');
    assert.strictEqual(logged[0].payload.roundNumber, 3);
});

// ── Caller-level coverage: paths that used to bypass finalization ──

/**
 * PHASE_ORDER puts spell_window_4 immediately before matches_in_progress, so
 * an overdue break auto-inserts straight out of a spell window. That branch
 * returns early, before advancePhase's own _clearSpellPhaseState() call, and
 * _autoInsertBreak sets returnToPhase: 'matches_in_progress' — endBreak never
 * comes back to the spell window, so unfinalized entries would be orphaned.
 */
test('advancePhase finalizes the spell log before auto-inserting an overdue break', async () => {
    const logged = [];
    const gs = {
        currentPhase: { name: 'spell_window_4', roundNumber: 3 },
        spellPhase: { isActive: true },
        breakSettings: { intervalRounds: 2, roundsSinceLastBreak: 2 },
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Red', spellName: 'Fireball', addedAt: 1 }
        ]
    };
    const pm = makeCallerPhaseManager(gs, (actionType, category, payload) => {
        logged.push({ actionType, category, payload });
    });

    const ok = await pm.advancePhase(true);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.currentPhase.name, 'break', 'sanity: the break branch is the one that ran');
    const spellLogs = logged.filter(l => l.actionType === 'spell_used_manual');
    assert.strictEqual(spellLogs.length, 1);
    assert.strictEqual(spellLogs[0].payload.phase, 'spell_window_4');
    assert.strictEqual(spellLogs[0].payload.roundNumber, 3);
    assert.strictEqual(gs.spellWindowLog, null);
});

/**
 * endTournament() rewrites currentPhase and saves. Reachable from a spell
 * window (the admin state-change modal routes "finished" through
 * endTournamentViaPhase() with no phase guard), so unfinalized entries would
 * be lost forever inside an archived tournament doc.
 */
test('endTournament finalizes the spell log before saving', async () => {
    const logged = [];
    const gs = {
        currentPhase: { name: 'spell_window_2', roundNumber: 5 },
        spellPhase: { isActive: true },
        spellWindowLog: [
            { id: 'sl_1', teamId: 't1', teamName: 'Red', spellName: 'Fireball', addedAt: 1 },
            { id: 'sl_2', teamId: 't2', teamName: 'Blue', spellName: 'Shield', addedAt: 2 }
        ]
    };
    const saves = [];
    const pm = makeCallerPhaseManager(gs, (actionType, category, payload) => {
        logged.push({ actionType, category, payload });
    });
    pm._save = async () => { saves.push(gs.spellWindowLog); };

    await pm.endTournament();

    assert.strictEqual(gs.currentPhase.name, 'tournament_end');
    const spellLogs = logged.filter(l => l.actionType === 'spell_used_manual');
    assert.strictEqual(spellLogs.length, 2);
    // Attributed to the window they were cast in, not to tournament_end.
    assert.strictEqual(spellLogs[0].payload.phase, 'spell_window_2');
    assert.strictEqual(spellLogs[0].payload.roundNumber, 5);
    assert.strictEqual(gs.spellWindowLog, null);
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(saves[0], null, 'the log must already be cleared by the time we persist');
});
