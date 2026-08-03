/**
 * Coverage for the challenge-lobby ready-check machinery in
 * phase-manager.js. Challenges previously went straight from "queued" to
 * "ongoing" with no ready-check step at all (challenge_game is a flat
 * phase, unlike matches_in_progress's slots, which have a real
 * setup->lobby->playing->done sub-machine). This adds a parallel, smaller
 * state machine (just lobby->ready — only one challenge is ever in flight
 * at a time) reusing the exact same lobbyReady tombstone/dual-status
 * mechanics via the 'challenge' pseudo-slot _getPlayersWhoMustReadyForSlot
 * now supports.
 *
 * Also regression-covers that teaching _getPlayersWhoMustReadyForSlot
 * about 'challenge' didn't flip the exclusion the wrong way — slot 1/2
 * must still never include challenge-tagged matches.
 */
const test = require('node:test');
const assert = require('node:assert');

global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.window = global.window || {};
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

function baseGameState(phaseName, overrides = {}) {
    return {
        status: 'playing',
        currentPhase: {
            name: phaseName, roundNumber: 2,
            startedAt: '2026-08-05T10:00:00.000Z'
        },
        teams: [
            { id: 1, players: [{ id: 'p1', uid: 'uid-p1' }, { id: 'p2', uid: 'uid-p2' }] },
            { id: 2, players: [{ id: 'p3', uid: 'uid-p3' }, { id: 'p4', uid: 'uid-p4' }] }
        ],
        gameQueue: [],
        lobbyReady: {},
        ...overrides
    };
}

// ---- _getPlayersWhoMustReadyForSlot('challenge') ----

test("must-ready for 'challenge' resolves a challenge-tagged match's players", () => {
    const gs = baseGameState('challenge_game');
    gs.gameQueue = [{
        id: 301, status: 'pending', isChallenge: true, slot: 'challenge', roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }]
    }];
    const pm = makePM(gs);
    const uids = pm._getPlayersWhoMustReadyForSlot('challenge').sort();
    assert.deepStrictEqual(uids, ['uid-p1', 'uid-p2', 'uid-p3', 'uid-p4']);
});

test("must-ready for slot 1 still excludes challenge-tagged matches (regression)", () => {
    const gs = baseGameState('matches_in_progress', {
        currentPhase: {
            name: 'matches_in_progress', roundNumber: 2,
            startedAt: '2026-08-05T10:00:00.000Z', slots: { 1: 'lobby', 2: 'setup' }
        }
    });
    gs.gameQueue = [{
        id: 302, status: 'pending', isChallenge: true, slot: 'challenge', roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }]
    }];
    const pm = makePM(gs);
    assert.deepStrictEqual(pm._getPlayersWhoMustReadyForSlot(1), []);
});

test("must-ready for 'challenge' excludes ordinary slot-tagged matches", () => {
    const gs = baseGameState('challenge_game');
    gs.gameQueue = [{
        id: 303, status: 'pending', slot: 1, roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }]
    }];
    const pm = makePM(gs);
    assert.deepStrictEqual(pm._getPlayersWhoMustReadyForSlot('challenge'), []);
});

// ---- openChallengeLobby ----

test('openChallengeLobby refuses outside the challenge_game phase', async () => {
    const gs = baseGameState('spell_window_2');
    const pm = makePM(gs);
    const ok = await pm.openChallengeLobby();
    assert.strictEqual(ok, false);
    assert.strictEqual(gs.currentPhase.challengeLobbyState, undefined);
});

test('openChallengeLobby sets state to lobby, tombstones the whole rosters of teams playing the challenge, and leaves an UNINVOLVED team untouched', async () => {
    const gs = baseGameState('challenge_game', {
        teams: [
            { id: 1, players: [{ id: 'p1', uid: 'uid-p1' }, { id: 'p2', uid: 'uid-p2' }] },
            { id: 2, players: [{ id: 'p3', uid: 'uid-p3' }, { id: 'p4', uid: 'uid-p4' }] },
            { id: 3, players: [{ id: 'p5', uid: 'uid-p5' }] } // not in this challenge at all
        ]
    });
    gs.gameQueue = [{
        id: 304, status: 'pending', isChallenge: true, slot: 'challenge', roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }]
    }];
    // stale ready flags from an unrelated earlier lobby
    gs.lobbyReady = {
        'uid-p1': { gameLobby: true, discord: true },
        'uid-p5': { gameLobby: true, discord: true } // uninvolved team — must be untouched
    };
    const pm = makePM(gs);
    const ok = await pm.openChallengeLobby();

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.currentPhase.challengeLobbyState, 'lobby');
    assert.strictEqual(pm.isChallengeLobbyActive(), true);

    // Both playing teams' WHOLE rosters (p1+p2, p3+p4) get fresh false
    // tombstones — matches the same whole-roster resolution slot 1/2 use.
    for (const uid of ['uid-p1', 'uid-p2', 'uid-p3', 'uid-p4']) {
        assert.strictEqual(gs.lobbyReady[uid].gameLobby, false, `${uid} should be tombstoned`);
    }
    // Team 3 (p5) has no player on this challenge — their unrelated ready
    // state must be left alone
    assert.strictEqual(gs.lobbyReady['uid-p5'].gameLobby, true);
});

// ---- getChallengeLobbyRequirements ----

test('getChallengeLobbyRequirements is unmet before ready-up, met after', async () => {
    const gs = baseGameState('challenge_game');
    gs.gameQueue = [{
        id: 305, status: 'pending', isChallenge: true, slot: 'challenge', roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }]
    }];
    const pm = makePM(gs);
    await pm.openChallengeLobby();

    let reqs = pm.getChallengeLobbyRequirements();
    assert.strictEqual(reqs.every(r => r.met), false);

    gs.lobbyReady['uid-p1'] = { gameLobby: true, discord: true };
    gs.lobbyReady['uid-p2'] = { gameLobby: true, discord: true };
    gs.lobbyReady['uid-p3'] = { gameLobby: true, discord: true };
    gs.lobbyReady['uid-p4'] = { gameLobby: true, discord: true };

    reqs = pm.getChallengeLobbyRequirements();
    assert.strictEqual(reqs.every(r => r.met), true);
});

// ---- forceAllChallengeReady ----

test('forceAllChallengeReady is a no-op when the challenge lobby is not active', () => {
    const gs = baseGameState('challenge_game');
    gs.gameQueue = [{
        id: 306, status: 'pending', isChallenge: true, slot: 'challenge', roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }]
    }];
    const pm = makePM(gs);
    pm.forceAllChallengeReady(); // lobby was never opened
    assert.deepStrictEqual(gs.lobbyReady, {});
});

test('forceAllChallengeReady marks all challenge participants ready when lobby is active', async () => {
    const gs = baseGameState('challenge_game');
    gs.gameQueue = [{
        id: 307, status: 'pending', isChallenge: true, slot: 'challenge', roundNumber: 2,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }]
    }];
    const pm = makePM(gs);
    await pm.openChallengeLobby();
    pm.forceAllChallengeReady();

    const reqs = pm.getChallengeLobbyRequirements();
    assert.strictEqual(reqs.every(r => r.met), true);
});
