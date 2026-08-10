/**
 * Coverage for the REAL god-app.js `_revertMatchByGameId()` method (the
 * Rematch spell's revert entry point on god.html) — not a hand-copied
 * mirror of its logic. A prior review round found both candidate
 * implementations only exercised a re-typed copy of this method's logic
 * against a real UndoManager, so a future edit that desyncs the real
 * method from that copy would never be caught. These tests `new GodApp()`
 * (constructor only — no DOM-dependent init()) and call the production
 * `_revertMatchByGameId` directly.
 *
 * Also covers:
 *  - multiple 'match_result_confirmed' log entries for the same matchId
 *    (confirmed -> manually undone -> replayed -> re-confirmed), verifying
 *    the real method's sequenceNumber-desc-ordered .find() picks the
 *    latest undone:false entry, not a stale one.
 *  - the Firestore round-trip for _markAsUndone() (undo-manager.js), using
 *    a stubbed firebase so the write call shape itself is verified even
 *    though a real Firestore can't run in this harness.
 *  - reverting a challenge match (isChallenge: true), which skips the
 *    pendingHexWins bookkeeping non-challenge matches get.
 */
const test = require('node:test');
const assert = require('node:assert');
const { makeFakeFirebaseDB } = require('./_firestore-transaction-stub');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.document = global.document || {
    addEventListener: () => {},
    getElementById: () => null,
    createElement: () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} } }),
    querySelectorAll: () => []
};

require('../../full/scripts/undo-manager.js');
require('../../full/scripts/god-app.js');
const UndoManager = global.window.UndoManager;
const GodApp = global.window.GodApp;

function makeGameState(overrides = {}) {
    return {
        tournamentId: 't1',
        teams: [
            { id: 1, name: 'Red', points: 5, gamesWon: 2, gamesLost: 1 },
            { id: 2, name: 'Blue', points: 3, gamesWon: 1, gamesLost: 2 }
        ],
        gamesPlayed: 3,
        gameQueue: [
            { id: 'm1', status: 'completed', winnerIndex: 0, winningSide: 'A', completedAt: 'x', isChallenge: false }
        ],
        gameHistory: [
            { id: 1, matchNumber: 1, queuedGameId: 'm1', winnerIndex: 0 }
        ],
        pointsHistory: [],
        activeEffects: [],
        pendingHexWins: [],
        ...overrides
    };
}

function makeConfirmedEntry(overrides = {}) {
    return {
        id: 'log1',
        actionType: 'match_result_confirmed',
        undone: false,
        sequenceNumber: 10,
        payload: { matchId: 'm1', matchNumber: 1, teamId: 1, isChallenge: false },
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

/** Build a GodApp with just enough wiring for _revertMatchByGameId (real
 * constructor — no DOM-touching init()) — mirrors how god-app.js's own
 * init() wires this.actionLogger / this.undo, minus the Firebase bits. */
function makeApp(gameState, { actions = [], firestoreUpdateSpy = null } = {}) {
    const app = new GodApp();
    app.gameState = gameState;

    app.actionLogger = {
        getActions: async ({ actionType, limit }) => ({
            entries: actions.filter(e => e.actionType === actionType).slice(0, limit)
        })
    };

    app.undo = new UndoManager(gameState, {
        actionLogger: app.actionLogger,
        uiManager: null,
        teamManager: null,
        saveCallback: async () => {},
        logActionCallback: () => {}
    });

    // Stubs both the runTransaction() shape executeUndo() now needs (see
    // docs/superpowers/specs/2026-08-10-atomic-array-writes-design.md) and
    // the actionLog collection().doc().update() chain _markAsUndone() uses.
    global.window.firebaseDB = makeFakeFirebaseDB(gameState, { actionLogUpdateSpy: firestoreUpdateSpy });

    return app;
}

// ------------------------------------------------------------------
// Real _revertMatchByGameId — happy path
// ------------------------------------------------------------------

test('the REAL god-app.js _revertMatchByGameId() reverts a confirmed match with no state desync', async () => {
    const gs = makeGameState();
    const entry = makeConfirmedEntry();
    const app = makeApp(gs, { actions: [entry] });

    const result = await app._revertMatchByGameId('m1');

    assert.strictEqual(result.success, true, JSON.stringify(result));
    assert.strictEqual(gs.gamesPlayed, 2);
    assert.strictEqual(gs.gameHistory.length, 0);
    const queueEntry = gs.gameQueue.find(g => g.id === 'm1');
    assert.strictEqual(queueEntry.status, 'ongoing');
    assert.strictEqual(queueEntry.winnerIndex, undefined);
    assert.strictEqual(gs.teams[0].gamesWon, 1);
    assert.strictEqual(gs.teams[1].gamesWon, 1);
});

test('the REAL god-app.js _revertMatchByGameId() fails cleanly when actionLogger/undo are missing', async () => {
    const gs = makeGameState();
    const app = new GodApp();
    app.gameState = gs;
    // app.actionLogger / app.undo left null, as on a page that never wires them

    const result = await app._revertMatchByGameId('m1');

    assert.strictEqual(result.success, false);
    assert.match(result.error, /not available/i);
});

test('the REAL god-app.js _revertMatchByGameId() fails cleanly when no matching entry exists', async () => {
    const gs = makeGameState();
    const app = makeApp(gs, { actions: [] });

    const result = await app._revertMatchByGameId('does-not-exist');

    assert.strictEqual(result.success, false);
    assert.match(result.error, /no confirmed result/i);
    assert.strictEqual(gs.gameQueue[0].status, 'completed', 'unrelated match state must be untouched');
});

// ------------------------------------------------------------------
// Multiple match_result_confirmed entries for the same matchId
// (confirmed -> manually undone -> replayed -> re-confirmed)
// ------------------------------------------------------------------

test('with multiple match_result_confirmed entries for the same matchId, the REAL method reverts the LATEST one, not a stale undone one', async () => {
    const gs = makeGameState({
        teams: [
            { id: 1, name: 'Red', points: 5, gamesWon: 3, gamesLost: 1 },
            { id: 2, name: 'Blue', points: 3, gamesWon: 1, gamesLost: 3 }
        ],
        gameHistory: [
            { id: 1, matchNumber: 1, queuedGameId: 'm1', winnerIndex: 0 },
            { id: 2, matchNumber: 2, queuedGameId: 'm1', winnerIndex: 0 }
        ]
    });

    // Oldest entry: originally confirmed, then manually undone via "Undo
    // Last Action" (undone: true) -- must NOT be picked.
    const staleEntry = makeConfirmedEntry({
        id: 'log-old',
        undone: true,
        sequenceNumber: 5,
        previousState: {
            queueEntry: { id: 'm1', status: 'ongoing', winnerIndex: undefined },
            teamStats: { 1: { points: 5, gamesWon: 0, gamesLost: 0 }, 2: { points: 3, gamesWon: 0, gamesLost: 0 } },
            gamesPlayed: 0,
            gameHistoryLength: 0
        }
    });

    // Newest entry: the match was replayed and re-confirmed -- this is
    // the one that must be reverted.
    const latestEntry = makeConfirmedEntry({
        id: 'log-new',
        undone: false,
        sequenceNumber: 20,
        previousState: {
            queueEntry: { id: 'm1', status: 'ongoing', winnerIndex: undefined },
            teamStats: { 1: { points: 5, gamesWon: 1, gamesLost: 1 }, 2: { points: 3, gamesWon: 1, gamesLost: 1 } },
            gamesPlayed: 1,
            gameHistoryLength: 1
        }
    });

    // getActions() (backed by Firestore's orderBy('sequenceNumber','desc'))
    // returns newest first -- assert the mock matches that contract.
    const app = makeApp(gs, { actions: [latestEntry, staleEntry] });

    const result = await app._revertMatchByGameId('m1');

    assert.strictEqual(result.success, true, JSON.stringify(result));
    // Reverted to the state captured by the LATEST confirmation, not the stale one
    assert.strictEqual(gs.teams[0].gamesWon, 1);
    assert.strictEqual(gs.teams[0].gamesLost, 1);
    assert.strictEqual(gs.gamesPlayed, 1);
    assert.strictEqual(gs.gameHistory.length, 1);
    assert.strictEqual(gs.gameHistory[0].matchNumber, 1, 'only the second (re-confirmed) history entry should be truncated away');
});

// ------------------------------------------------------------------
// Firestore round-trip for _markAsUndone (call-shape verification)
// ------------------------------------------------------------------

test('a successful revert attempts to mark the action-log entry as undone in Firestore with the right doc id/payload', async () => {
    const gs = makeGameState();
    const entry = makeConfirmedEntry();
    let captured = null;
    const app = makeApp(gs, {
        actions: [entry],
        firestoreUpdateSpy: (id, data) => { captured = { id, data }; }
    });

    const result = await app._revertMatchByGameId('m1');

    assert.strictEqual(result.success, true);
    assert.ok(captured, '_markAsUndone should have called .update() on the actionLog doc');
    assert.strictEqual(captured.id, 'log1');
    assert.strictEqual(captured.data.undone, true);
    assert.ok(captured.data.undoneAt);
});

// ------------------------------------------------------------------
// Challenge match rematch
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// points_awarded revert — the OTHER UNDOABLE_TYPES entry named
// explicitly in the Rematch spec, and the entry type this session's
// pointsHistory-desync bug actually occurred against (match_result_
// confirmed never touches pointsHistory in this codebase, so a
// "no desync" claim that only exercises that type is nominal at best).
// Uses UndoManager directly, the exact shared mechanism _handleRematch/
// _revertMatchByGameId delegate to for ANY undoable entry type.
// ------------------------------------------------------------------

test('reverting a points_awarded entry via UndoManager pops the matching pointsHistory row with no desync', async () => {
    const gs = makeGameState({
        teams: [
            { id: 1, name: 'Red', points: 8, gamesWon: 2, gamesLost: 1 },
            { id: 2, name: 'Blue', points: 6, gamesWon: 1, gamesLost: 2 }
        ],
        currentRound: 3,
        pointsHistory: [
            { round: 2, pointsAwarded: { Red: 2, Blue: 1 } },
            { round: 3, pointsAwarded: { Red: 3, Blue: 3 } }
        ]
    });

    // Mirrors stats-manager.js's awardRoundPoints() payload/previousState shape exactly.
    const entry = {
        id: 'log-points',
        actionType: 'points_awarded',
        undone: false,
        payload: { roundNumber: 3, pointsAwarded: { Red: 3, Blue: 3 } },
        previousState: {
            teamPoints: { 1: 5, 2: 3 }, // pre-award points
            currentRound: 2,
            pointsHistoryRound: 3
        }
    };

    const undo = new UndoManager(gs, {
        actionLogger: null, uiManager: null, teamManager: null,
        saveCallback: async () => {}, logActionCallback: () => {}
    });
    global.window.firebaseDB = makeFakeFirebaseDB(gs);

    const { canUndo } = undo.canUndo(entry);
    assert.strictEqual(canUndo, true);

    const ok = await undo.executeUndo(entry);
    assert.strictEqual(ok, true);

    // Points restored to pre-award values
    assert.strictEqual(gs.teams[0].points, 5);
    assert.strictEqual(gs.teams[1].points, 3);
    // currentRound restored
    assert.strictEqual(gs.currentRound, 2);
    // The round-3 pointsHistory row is popped, not left dangling (the
    // exact desync this session's earlier fix targeted) -- only round 2 remains.
    assert.strictEqual(gs.pointsHistory.length, 1);
    assert.strictEqual(gs.pointsHistory[0].round, 2);
    assert.ok(!gs.pointsHistory.some(e => e.round === 3), 'round 3 pointsHistory row must not survive the undo');
});

test('the REAL god-app.js SpellEngine wiring can revert a points_awarded entry too (generic revert path, not match-specific)', async () => {
    // _revertMatchByGameId itself only looks up 'match_result_confirmed'
    // entries (that's the correct, investigated behavior for Rematch,
    // since match confirmation never logs points_awarded in this
    // codebase) -- but the UndoManager instance it shares with "Undo Last
    // Action" must still handle points_awarded correctly, since an admin
    // using plain "Undo Last Action" right after a round-points award (a
    // completely normal sequence at a live event) goes through the same
    // this.undo instance Rematch relies on.
    const gs = makeGameState({
        teams: [{ id: 1, name: 'Red', points: 10, gamesWon: 1, gamesLost: 0 }],
        pointsHistory: [{ round: 1, pointsAwarded: { Red: 4 } }]
    });
    const app = makeApp(gs, { actions: [] });

    const entry = {
        id: 'log-points-2',
        actionType: 'points_awarded',
        undone: false,
        payload: { roundNumber: 1, pointsAwarded: { Red: 4 } },
        previousState: { teamPoints: { 1: 6 }, currentRound: 0, pointsHistoryRound: 1 }
    };

    const ok = await app.undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.teams[0].points, 6);
    assert.strictEqual(gs.pointsHistory.length, 0);
});

test('reverting a challenge match works the same way and does not require pendingHexWins bookkeeping', async () => {
    const gs = makeGameState({
        gameQueue: [
            { id: 'c1', status: 'completed', winnerIndex: 0, winningSide: 'A', completedAt: 'x', isChallenge: true }
        ],
        gameHistory: [
            { id: 1, matchNumber: 7, queuedGameId: 'c1', winnerIndex: 0, isChallenge: true }
        ],
        pendingHexWins: [] // challenge matches never get an entry pushed here
    });

    const entry = makeConfirmedEntry({
        id: 'log-challenge',
        payload: { matchId: 'c1', matchNumber: 7, teamId: 1, isChallenge: true },
        previousState: {
            queueEntry: { id: 'c1', status: 'ongoing', winnerIndex: undefined },
            teamStats: {
                1: { points: 5, gamesWon: 1, gamesLost: 1 },
                2: { points: 3, gamesWon: 1, gamesLost: 1 }
            },
            gamesPlayed: 2,
            gameHistoryLength: 0
        }
    });

    const app = makeApp(gs, { actions: [entry] });

    const result = await app._revertMatchByGameId('c1');

    assert.strictEqual(result.success, true, JSON.stringify(result));
    const queueEntry = gs.gameQueue.find(g => g.id === 'c1');
    assert.strictEqual(queueEntry.status, 'ongoing');
    assert.strictEqual(gs.gameHistory.length, 0);
    assert.strictEqual(gs.pendingHexWins.length, 0, 'challenge matches never had a pendingHexWins entry, so revert must not error trying to remove one');
});
