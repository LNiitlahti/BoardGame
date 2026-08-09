/**
 * Tournament-end semantics — the game has no formal end in normal play (the
 * phase loop cycles forever), so "ended" is DERIVED, never latched:
 *
 *   ended = winner celebration manually forced onto view.html
 *           OR a team is at/over the CURRENT win target
 *           OR the phase system actually reached tournament_end
 *
 * Crucially, if a team reaches the target and the admin then RAISES the win
 * condition above the leader, the game un-ends and the loop keeps going —
 * live (display-manager.js picks the slide again from the phase) and in the
 * replay (replay-engine.js re-derives status per reconstructed frame).
 *
 * Same require pattern as display-manager-spell-window.test.js: stub
 * global.window, require the plain-script files, read the classes back.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/display-manager.js');
require('../../full/scripts/replay-engine.js');
const DisplayManager = global.window.DisplayManager;
const ReplayEngine = global.window.ReplayEngine;

// ──────────────────────────────────────────────────────────────────
// display-manager.js — live view.html slide selection
// ──────────────────────────────────────────────────────────────────

function makeDisplayManager() {
    return new DisplayManager({ container: null, boardModule: null, boardRenderer: null });
}

test('view: team reaching the win target forces the winner celebration', () => {
    const dm = makeDisplayManager();
    const mode = dm._determineDisplayMode({
        winCondition: 50,
        teams: [{ id: 1, points: 50 }, { id: 2, points: 30 }],
        currentPhase: { name: 'matches_in_progress' }
    });
    assert.strictEqual(mode, 'tournament_end');
});

test('view: raising the win target above the leader un-ends the game', () => {
    const dm = makeDisplayManager();
    const mode = dm._determineDisplayMode({
        winCondition: 60, // admin raised it after team 1 hit 50
        teams: [{ id: 1, points: 50 }, { id: 2, points: 30 }],
        currentPhase: { name: 'matches_in_progress' }
    });
    assert.strictEqual(mode, 'matches_in_progress');
});

test('view: manual display override still beats the derived celebration', () => {
    const dm = makeDisplayManager();
    const mode = dm._determineDisplayMode({
        displayOverride: { mode: 'standings' },
        winCondition: 50,
        teams: [{ id: 1, points: 99 }],
        currentPhase: { name: 'matches_in_progress' }
    });
    assert.strictEqual(mode, 'standings');
});

test('view: no win condition set means no derived celebration', () => {
    const dm = makeDisplayManager();
    const mode = dm._determineDisplayMode({
        teams: [{ id: 1, points: 999 }],
        currentPhase: { name: 'break' }
    });
    assert.strictEqual(mode, 'break');
});

// ──────────────────────────────────────────────────────────────────
// replay-engine.js — reconstructed status
// ──────────────────────────────────────────────────────────────────

function makeEngine() {
    return new ReplayEngine({ getFirebaseDB: () => null, tournamentId: 'test' });
}

test('replay: win_condition_changed is applied to reconstructed state', () => {
    const engine = makeEngine();
    const state = { winCondition: 50, teams: [] };
    engine._applyAction(state, {
        actionType: 'win_condition_changed',
        payload: { newValue: 75, previousValue: 50 }
    });
    assert.strictEqual(state.winCondition, 75);
});

test('replay: display_override_set sets and clears displayOverride', () => {
    const engine = makeEngine();
    const state = { displayOverride: null };
    engine._applyAction(state, {
        actionType: 'display_override_set',
        payload: { mode: 'tournament_end', previousMode: null }
    });
    assert.deepStrictEqual(state.displayOverride, { mode: 'tournament_end' });

    engine._applyAction(state, {
        actionType: 'display_override_set',
        payload: { mode: null, previousMode: 'tournament_end' }
    });
    assert.strictEqual(state.displayOverride, null);
});

test('replay: reaching the win target derives status finished', () => {
    const engine = makeEngine();
    const state = {
        status: 'playing',
        winCondition: 50,
        teams: [{ id: 1, points: 52 }],
        currentPhase: { name: 'matches_in_progress' }
    };
    engine._deriveEndStatus(state);
    assert.strictEqual(state.status, 'finished');
});

test('replay: raising the target above the leader flips finished back to playing', () => {
    const engine = makeEngine();
    const state = {
        status: 'finished', // e.g. from a backup taken while target was reached
        winCondition: 80,
        teams: [{ id: 1, points: 52 }],
        currentPhase: { name: 'matches_in_progress' }
    };
    engine._deriveEndStatus(state);
    assert.strictEqual(state.status, 'playing');
});

test('replay: forced winner celebration derives status finished', () => {
    const engine = makeEngine();
    const state = {
        status: 'playing',
        winCondition: 50,
        teams: [{ id: 1, points: 30 }],
        displayOverride: { mode: 'tournament_end' },
        currentPhase: { name: 'matches_in_progress' }
    };
    engine._deriveEndStatus(state);
    assert.strictEqual(state.status, 'finished');
});

test('replay: tournament_end phase still counts as finished', () => {
    const engine = makeEngine();
    const state = {
        status: 'finished',
        winCondition: 50,
        teams: [{ id: 1, points: 30 }],
        currentPhase: { name: 'tournament_end' }
    };
    engine._deriveEndStatus(state);
    assert.strictEqual(state.status, 'finished');
});

test('replay: pre-game setup status is left alone', () => {
    const engine = makeEngine();
    const state = {
        status: 'setup',
        winCondition: 50,
        teams: [{ id: 1, points: 0 }],
        currentPhase: { name: 'pre_game_setup', roundNumber: 0 }
    };
    engine._deriveEndStatus(state);
    assert.strictEqual(state.status, 'setup');
});

test('replay: initial win condition comes from the first change entry, not the final doc', () => {
    const engine = makeEngine();
    // Final doc says 75, but the admin changed 50 -> 75 mid-game; the
    // replay must start from 50 or early frames would wrongly show
    // "not ended" for a team sitting at 60.
    engine._tournamentDoc = { winCondition: 75, teams: [] };
    engine._actions = [
        { sequenceNumber: 1, actionType: 'plate_placed', payload: {} },
        { sequenceNumber: 2, actionType: 'win_condition_changed', payload: { newValue: 75, previousValue: 50 } }
    ];
    engine._buildTimeline();
    const initial = engine._createInitialState();
    assert.strictEqual(initial.winCondition, 50);
});

test('replay: initial win condition falls back to the tournament doc', () => {
    const engine = makeEngine();
    engine._tournamentDoc = { winCondition: 40, teams: [] };
    engine._actions = [
        { sequenceNumber: 1, actionType: 'plate_placed', payload: {} }
    ];
    engine._buildTimeline();
    const initial = engine._createInitialState();
    assert.strictEqual(initial.winCondition, 40);
});
