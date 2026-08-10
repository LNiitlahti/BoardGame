/**
 * Coverage for the "Rematch" (Uusinta) spell — spells.json entry, dispatch
 * through SpellEngine.executeSpellEffect(), and the full-revert wiring via
 * the injected revertMatchByGameId callback (which on god.html delegates to
 * UndoManager's existing 'match_result_confirmed' undo path — see
 * god-app.js's _revertMatchByGameId and undo-manager.js).
 *
 * Same require pattern as the other spell-engine/undo-manager consumers in
 * this suite: stub global.window + global.ICON_SVGS, require the plain
 * script files, read the classes back off window.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeFakeFirebaseDB } = require('./_firestore-transaction-stub');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
// renderSpellHistory() (invoked by processPendingSpellCast) hits document;
// it early-returns when the container element isn't found.
global.document = global.document || { getElementById: () => null };

require('../../full/scripts/spell-engine.js');
require('../../full/scripts/undo-manager.js');
const SpellEngine = global.window.SpellEngine;
const UndoManager = global.window.UndoManager;

const spellsData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../data/spells.json'), 'utf8')
);
const rematchDef = spellsData.spells.find(s => s.id === 'rematch');

// ------------------------------------------------------------------
// spells.json shape
// ------------------------------------------------------------------

test('spells.json has a well-formed rematch entry', () => {
    assert.ok(rematchDef, 'rematch spell should exist in spells.json');
    assert.strictEqual(rematchDef.id, 'rematch');
    assert.strictEqual(rematchDef.name, 'Uusinta');
    assert.strictEqual(rematchDef.nameEn, 'Rematch');
    assert.strictEqual(rematchDef.timing, 'post-game');
    assert.strictEqual(rematchDef.targetType, 'match');
    assert.strictEqual(rematchDef.effect.type, 'rematch');
    assert.ok(rematchDef.description && rematchDef.description.length > 0);
    assert.ok(rematchDef.descriptionEn && rematchDef.descriptionEn.length > 0);
    // effect.type must not collide with any of the other 15 spells' effect types
    const otherTypes = spellsData.spells
        .filter(s => s.id !== 'rematch')
        .map(s => s.effect.type);
    assert.ok(!otherTypes.includes('rematch'), 'effect.type must be unique to rematch');
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeGameState() {
    return {
        spellDefinitions: { rematch: rematchDef },
        teams: [
            { id: 1, name: 'Red', points: 5, gamesWon: 2, gamesLost: 1 },
            { id: 2, name: 'Blue', points: 3, gamesWon: 1, gamesLost: 2 }
        ],
        gamesPlayed: 3,
        currentRound: 2,
        currentPhase: { roundNumber: 2 },
        gameQueue: [
            { id: 'm1', status: 'completed', winnerIndex: 0, winningSide: 'A', completedAt: 'x' }
        ],
        gameHistory: [
            { id: 1, matchNumber: 1, queuedGameId: 'm1', winnerIndex: 0 }
        ],
        pointsHistory: [
            { round: 2, teamId: 1 }
        ],
        activeEffects: [],
        pendingHexWins: []
    };
}

/** Fake action-log entry matching result-manager.js's real payload/previousState shape */
function makeConfirmedEntry(gameState, overrides = {}) {
    return {
        id: 'log1',
        actionType: 'match_result_confirmed',
        undone: false,
        payload: {
            matchId: 'm1',
            matchNumber: 1,
            teamId: 1
        },
        previousState: {
            queueEntry: { id: 'm1', status: 'ongoing', winnerIndex: undefined },
            teamStats: {
                1: { points: 5, gamesWon: 1, gamesLost: 1 },
                2: { points: 3, gamesWon: 1, gamesLost: 1 }
            },
            gamesPlayed: 2,
            gameHistoryLength: 0
        },
        ...overrides
    };
}

function makeSpellEngine(gameState, extraDeps = {}) {
    return new SpellEngine(gameState, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        saveCallback: async () => {},
        logActionCallback: () => {},
        ...extraDeps
    });
}

// ------------------------------------------------------------------
// Dispatch
// ------------------------------------------------------------------

test('executeSpellEffect dispatches rematch effect.type to _handleRematch', () => {
    const gs = makeGameState();
    let calledWith = null;
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: (gameId) => { calledWith = gameId; return { success: true }; }
    });

    const result = engine.executeSpellEffect('rematch', 1, { gameId: 'm1', matchNumber: 1 });

    assert.strictEqual(calledWith, 'm1');
    assert.strictEqual(result.success, true);
});

test('_handleRematch accepts targetData.matchId as an alias for gameId', () => {
    const gs = makeGameState();
    let calledWith = null;
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: (gameId) => { calledWith = gameId; return { success: true }; }
    });

    engine.executeSpellEffect('rematch', 1, { matchId: 'm1' });
    assert.strictEqual(calledWith, 'm1');
});

test('_handleRematch fails cleanly without calling the callback when no match is targeted', () => {
    const gs = makeGameState();
    let called = false;
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: () => { called = true; return { success: true }; }
    });

    const result = engine.executeSpellEffect('rematch', 1, {});

    assert.strictEqual(result.success, false);
    assert.match(result.error, /no match selected/i);
    assert.strictEqual(called, false);
});

test('_handleRematch fails cleanly when revertMatchByGameId is not wired (e.g. admin.html)', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs); // no revertMatchByGameId dep

    const result = engine.executeSpellEffect('rematch', 1, { gameId: 'm1' });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /not available on this page/i);
});

test('_handleRematch surfaces the callback\'s error message on failure', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: () => ({ success: false, error: 'Already undone' })
    });

    const result = engine.executeSpellEffect('rematch', 1, { gameId: 'm1' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Already undone');
});

test('_handleRematch supports an async (Promise-returning) revert callback', async () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: async (gameId) => {
            await Promise.resolve();
            return { success: true };
        }
    });

    const maybePromise = engine.executeSpellEffect('rematch', 1, { gameId: 'm1' });
    assert.strictEqual(typeof maybePromise.then, 'function', 'should return a Promise for async callbacks');
    const result = await maybePromise;
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.gameId, 'm1');
});

test('a successful rematch records a spell history entry and an active effect', () => {
    const gs = makeGameState();
    const loggedActions = [];
    const engine = makeSpellEngine(gs, {
        logActionCallback: (type, cat, payload, prev) => loggedActions.push({ type, cat, payload, prev }),
        revertMatchByGameId: () => ({ success: true })
    });

    const result = engine.executeSpellEffect('rematch', 1, { gameId: 'm1', matchNumber: 1 });

    assert.strictEqual(result.success, true);
    assert.ok(loggedActions.some(a => a.type === 'spell_rematch_triggered' && a.payload.gameId === 'm1'));
    assert.strictEqual(gs.activeEffects.length, 1);
    assert.strictEqual(gs.activeEffects[0].spellId, 'rematch');
    assert.strictEqual(gs.activeEffects[0].category, 'special');
});

// ------------------------------------------------------------------
// End-to-end: SpellEngine -> revertMatchByGameId -> real UndoManager,
// verifying no pointsHistory/gameHistory/queue desync (the exact bug
// class undo-manager.js was hardened against earlier).
// ------------------------------------------------------------------

test('a full rematch revert leaves teams, gameHistory, pointsHistory and the queue entry consistent', async () => {
    const gs = makeGameState();
    const logEntry = makeConfirmedEntry(gs);

    const undo = new UndoManager(gs, {
        actionLogger: null,
        uiManager: null,
        teamManager: null,
        saveCallback: async () => {},
        logActionCallback: () => {}
    });
    global.window.firebaseDB = makeFakeFirebaseDB(gs);

    const revertMatchByGameId = async (gameId) => {
        // Mirrors god-app.js's _revertMatchByGameId: look up the matching
        // confirmed-result log entry, confirm it's undoable, run the same
        // undo path "Undo Last Action" uses.
        const entry = [logEntry].find(e => !e.undone && String(e.payload.matchId) === String(gameId));
        if (!entry) return { success: false, error: 'No confirmed result found for that match' };
        const { canUndo, reason } = undo.canUndo(entry);
        if (!canUndo) return { success: false, error: reason };
        const ok = await undo.executeUndo(entry);
        return ok ? { success: true } : { success: false, error: 'Revert failed' };
    };

    const engine = makeSpellEngine(gs, { revertMatchByGameId });

    const result = await engine.executeSpellEffect('rematch', 1, { gameId: 'm1', matchNumber: 1 });

    assert.strictEqual(result.success, true);

    // Team stats restored to pre-confirmation snapshot
    assert.strictEqual(gs.teams[0].points, 5); // points untouched by match_result_confirmed undo (points come from a separate points_awarded entry)
    assert.strictEqual(gs.teams[0].gamesWon, 1);
    assert.strictEqual(gs.teams[0].gamesLost, 1);
    assert.strictEqual(gs.teams[1].gamesWon, 1);
    assert.strictEqual(gs.teams[1].gamesLost, 1);

    // gamesPlayed restored
    assert.strictEqual(gs.gamesPlayed, 2);

    // gameHistory truncated back to pre-confirmation length — no orphaned entry
    assert.strictEqual(gs.gameHistory.length, 0);

    // Queue entry reset to a replayable state
    const queueEntry = gs.gameQueue.find(g => g.id === 'm1');
    assert.strictEqual(queueEntry.status, 'ongoing');
    assert.strictEqual(queueEntry.winnerIndex, undefined);
    assert.strictEqual(queueEntry.completedAt, undefined);

    // pointsHistory is untouched by a match_result_confirmed undo (it isn't
    // the entry type that wrote it) — still present and consistent, no
    // orphaned/duplicated rows.
    assert.strictEqual(gs.pointsHistory.length, 1);

    // _markAsUndone() only flips `undone` in Firestore (skipped here since
    // gs.tournamentId is unset in this test) — the in-memory entry object
    // itself is not mutated by executeUndo(), matching undo-manager.js's
    // real behavior (the next getActions() call re-fetches the flag).
});

test('rematch fails cleanly (no state mutation) when the match was already reverted', async () => {
    const gs = makeGameState();
    const logEntry = makeConfirmedEntry(gs, { undone: true });

    const undo = new UndoManager(gs, {
        saveCallback: async () => {},
        logActionCallback: () => {}
    });

    const revertMatchByGameId = async (gameId) => {
        const entry = [logEntry].find(e => !e.undone && String(e.payload.matchId) === String(gameId));
        if (!entry) return { success: false, error: 'No confirmed result found for that match' };
        const { canUndo, reason } = undo.canUndo(entry);
        if (!canUndo) return { success: false, error: reason };
        return { success: true };
    };

    const engine = makeSpellEngine(gs, { revertMatchByGameId });
    const before = JSON.stringify(gs);

    const result = await engine.executeSpellEffect('rematch', 1, { gameId: 'm1' });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /no confirmed result/i);
    assert.strictEqual(JSON.stringify(gs), before, 'game state must be untouched on failure');
});

// ------------------------------------------------------------------
// Admin-side "process this cast" trigger (processPendingSpellCast)
//
// castSpellViaFirestore() in team-controls.js only WRITES the cast to
// Firestore -- it never calls executeSpellEffect(). Without an explicit
// admin-side trigger, casting Rematch would never actually revert
// anything at a live event. processPendingSpellCast() is that trigger
// (wired to a "Process Rematch" button in god.html's spell history via
// god-app.js's window.processSpellCast).
// ------------------------------------------------------------------

test('processPendingSpellCast finds a pending rematch cast by timestamp and executes its effect', async () => {
    const gs = makeGameState();
    gs.spellHistory = [
        { timestamp: 'ts-1', spellId: 'rematch', teamId: 1, teamName: 'Red', targetData: { gameId: 'm1' }, result: { success: true } }
    ];
    let calledWith = null;
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: (gameId) => { calledWith = gameId; return { success: true }; }
    });

    const result = await engine.processPendingSpellCast('ts-1');

    assert.strictEqual(calledWith, 'm1');
    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.spellHistory[0].result.processed, true, 'entry should be marked processed so the button does not re-fire');
});

test('processPendingSpellCast is idempotent: a second call on an already-processed entry does not re-execute', async () => {
    const gs = makeGameState();
    gs.spellHistory = [
        { timestamp: 'ts-1', spellId: 'rematch', teamId: 1, teamName: 'Red', targetData: { gameId: 'm1' }, result: { success: true, processed: true } }
    ];
    let calls = 0;
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: () => { calls++; return { success: true }; }
    });

    const result = await engine.processPendingSpellCast('ts-1');

    assert.strictEqual(calls, 0);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /already processed/i);
});

test('processPendingSpellCast surfaces a clear error when the spell-history entry cannot be found', async () => {
    const gs = makeGameState();
    gs.spellHistory = [];
    const engine = makeSpellEngine(gs, { revertMatchByGameId: () => ({ success: true }) });

    const result = await engine.processPendingSpellCast('no-such-timestamp');

    assert.strictEqual(result.success, false);
    assert.match(result.error, /not found/i);
});

test('processPendingSpellCast records the failure result (not just throwing) when the underlying revert fails', async () => {
    const gs = makeGameState();
    gs.spellHistory = [
        { timestamp: 'ts-2', spellId: 'rematch', teamId: 1, teamName: 'Red', targetData: { gameId: 'm1' }, result: {} }
    ];
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: () => ({ success: false, error: 'Already undone' })
    });

    const result = await engine.processPendingSpellCast('ts-2');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Already undone');
    assert.strictEqual(gs.spellHistory[0].result.processed, false, 'a failed attempt must stay retriable, not get permanently marked processed');
});

test('processPendingSpellCast allows retrying after a failed attempt (not permanently stuck)', async () => {
    const gs = makeGameState();
    gs.spellHistory = [
        { timestamp: 'ts-3', spellId: 'rematch', teamId: 1, teamName: 'Red', targetData: { gameId: 'm1' }, result: {} }
    ];
    let attempt = 0;
    const engine = makeSpellEngine(gs, {
        revertMatchByGameId: () => {
            attempt++;
            return attempt === 1 ? { success: false, error: 'transient error' } : { success: true };
        }
    });

    const first = await engine.processPendingSpellCast('ts-3');
    assert.strictEqual(first.success, false);

    const second = await engine.processPendingSpellCast('ts-3');
    assert.strictEqual(second.success, true);
    assert.strictEqual(attempt, 2);
    assert.strictEqual(gs.spellHistory[0].result.processed, true);
});

test('rematch fails cleanly when the target match id does not match any log entry', async () => {
    const gs = makeGameState();
    const logEntry = makeConfirmedEntry(gs);

    const undo = new UndoManager(gs, { saveCallback: async () => {}, logActionCallback: () => {} });

    const revertMatchByGameId = async (gameId) => {
        const entry = [logEntry].find(e => !e.undone && String(e.payload.matchId) === String(gameId));
        if (!entry) return { success: false, error: 'No confirmed result found for that match' };
        const { canUndo } = undo.canUndo(entry);
        return canUndo ? { success: true } : { success: false, error: 'not undoable' };
    };

    const engine = makeSpellEngine(gs, { revertMatchByGameId });
    const result = await engine.executeSpellEffect('rematch', 1, { gameId: 'does-not-exist' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.gameQueue[0].status, 'completed', 'unrelated match must be untouched');
});
