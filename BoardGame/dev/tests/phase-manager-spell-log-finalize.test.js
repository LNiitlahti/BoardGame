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
