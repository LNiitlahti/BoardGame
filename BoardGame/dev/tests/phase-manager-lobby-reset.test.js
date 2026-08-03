/**
 * Coverage for the lobby-readiness pipeline in phase-manager.js:
 *
 * 1. _getPlayersWhoMustReadyForSlot() — must resolve players from BOTH queue
 *    entry shapes (modern `teams[].playerIds` and legacy
 *    `sides[].players[].teamId`), and must ignore matches tagged for a
 *    different round (a mass-imported future round must not inflate this
 *    round's ready list).
 *
 * 2. _resetLobbyReadyForSlot() via advanceSlot(setup -> lobby) — must write
 *    explicit `false` TOMBSTONES rather than deleting keys. Every client
 *    persists gameState with Firestore set({merge:true}), and merge never
 *    removes absent map keys: a plain `delete` stays local-only, the next
 *    snapshot resurrects last round's `true` flags, and the slot's lobby
 *    auto-advance fires instantly (lobby check silently skipped from round
 *    2 onward). Tombstones merge correctly from any client.
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

function rosterGameState(slots) {
    return {
        status: 'playing',
        currentPhase: {
            name: 'matches_in_progress', roundNumber: 2,
            startedAt: '2026-08-05T10:00:00.000Z', slots
        },
        teams: [
            { id: 1, players: [{ id: 'p1', uid: 'uid-p1' }, { id: 'p2', uid: 'uid-p2' }] },
            { id: 2, players: [{ id: 'p3', uid: 'uid-p3' }, { id: 'p4', uid: 'uid-p4' }] }
        ],
        gameQueue: [],
        lobbyReady: {}
    };
}

// ── _getPlayersWhoMustReadyForSlot ──────────────────────────────

test('must-ready resolves players from modern teams[].playerIds entries', () => {
    const gs = rosterGameState({ 1: 'lobby', 2: 'setup' });
    gs.gameQueue = [{
        id: 101, status: 'pending', slot: 1, roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }]
    }];
    const pm = makePM(gs);
    const uids = pm._getPlayersWhoMustReadyForSlot(1).sort();
    // whole rosters of both involved teams, per existing semantics
    assert.deepStrictEqual(uids, ['uid-p1', 'uid-p2', 'uid-p3', 'uid-p4']);
});

test('must-ready still resolves legacy sides[].players[].teamId entries', () => {
    const gs = rosterGameState({ 1: 'lobby', 2: 'setup' });
    gs.gameQueue = [{
        id: 102, status: 'pending', slot: 1, roundNumber: 2,
        sides: [{ players: [{ teamId: 1 }] }, { players: [{ teamId: 2 }] }]
    }];
    const pm = makePM(gs);
    const uids = pm._getPlayersWhoMustReadyForSlot(1).sort();
    assert.deepStrictEqual(uids, ['uid-p1', 'uid-p2', 'uid-p3', 'uid-p4']);
});

test('a future round\'s tagged match does NOT add players to this round\'s must-ready', () => {
    const gs = rosterGameState({ 1: 'lobby', 2: 'setup' });
    gs.gameQueue = [{
        id: 103, status: 'pending', slot: 1, roundNumber: 3, // future round
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }]
    }];
    const pm = makePM(gs);
    assert.deepStrictEqual(pm._getPlayersWhoMustReadyForSlot(1), []);
});

// ── lobby-ready tombstones ──────────────────────────────────────

test('entering lobby writes false tombstones (merge-safe) instead of deleting keys', async () => {
    const gs = rosterGameState({ 1: 'setup', 2: 'setup' });
    gs.gameQueue = [{
        id: 201, status: 'pending', slot: 1, roundNumber: 2, createdAt: '2026-08-05T10:30:00.000Z',
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }]
    }];
    // stale flags from a previous round
    gs.lobbyReady = {
        'uid-p1': { gameLobby: true, discord: true },
        'uid-p3': { ready: true }
    };
    const pm = makePM(gs);
    const advanced = await pm.advanceSlot(1); // setup -> lobby
    assert.strictEqual(advanced, true);
    assert.strictEqual(pm.getSlotSubPhase(1), 'lobby');
    for (const uid of ['uid-p1', 'uid-p2', 'uid-p3', 'uid-p4']) {
        const r = gs.lobbyReady[uid];
        assert.ok(r, `tombstone missing for ${uid}`);
        assert.strictEqual(r.gameLobby, false);
        assert.strictEqual(r.discord, false);
        assert.strictEqual(r.ready, false, 'legacy ready flag must also be killed');
    }
    // and the lobby gate must actually be unmet now
    const reqs = pm.getSlotRequirements(1);
    assert.strictEqual(reqs.every(r => r.met), false);
});
