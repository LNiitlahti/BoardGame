/**
 * Coverage for the 4-slot concurrent challenge machinery added in Round
 * 12A (BoardGame/docs/guides/EVENT_BUG_REPORTS.md, "Challenge matches
 * can't run concurrently"). Before this, challenge_game was a flat phase
 * with only one challenge in flight at a time (see
 * phase-manager-challenge-lobby.test.js for that OLD flat machinery, which
 * stays working unchanged for backward compatibility). Now challenge_game
 * has 4 independent pseudo-slots — challenge1..challenge4 — that walk the
 * SAME setup->lobby->playing->done sequence as matches_in_progress's Match
 * 1/2 slots, stored in the SAME gs.currentPhase.slots map (never collides,
 * since the two phases are never simultaneously current).
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

function baseGameState(overrides = {}) {
    return {
        status: 'playing',
        currentPhase: {
            name: 'challenge_game',
            roundNumber: 3,
            startedAt: '2026-08-10T10:00:00.000Z',
            slots: { challenge1: 'setup', challenge2: 'setup', challenge3: 'setup', challenge4: 'setup' }
        },
        teams: [
            { id: 1, players: [{ id: 'p1', uid: 'uid-p1' }, { id: 'p2', uid: 'uid-p2' }] },
            { id: 2, players: [{ id: 'p3', uid: 'uid-p3' }, { id: 'p4', uid: 'uid-p4' }] },
            { id: 3, players: [{ id: 'p5', uid: 'uid-p5' }, { id: 'p6', uid: 'uid-p6' }] },
            { id: 4, players: [{ id: 'p7', uid: 'uid-p7' }, { id: 'p8', uid: 'uid-p8' }] }
        ],
        gameQueue: [],
        lobbyReady: {},
        ...overrides
    };
}

function challengeEntry(id, slot, opts = {}) {
    return {
        id, status: 'pending', isChallenge: true, slot, roundNumber: 3,
        teams: [{ id: 'TEAM_A', playerIds: ['p1'] }, { id: 'TEAM_B', playerIds: ['p3'] }],
        ...opts
    };
}

// ---- getSlotSubPhase / getSlotDisplayInfo ----

test('challenge slots default to setup and label as "Challenge N"', () => {
    const gs = baseGameState();
    const pm = makePM(gs);
    for (const id of ['challenge1', 'challenge2', 'challenge3', 'challenge4']) {
        assert.strictEqual(pm.getSlotSubPhase(id), 'setup');
        assert.strictEqual(pm.getSlotDisplayInfo(id).name, `Challenge ${id.slice(-1)} — Setup`);
    }
});

// ---- independence: two challenges progress on separate slots without interference ----

test('two concurrent challenges in different slots progress independently', async () => {
    const gs = baseGameState();
    gs.gameQueue = [
        challengeEntry(401, 'challenge1'),
        challengeEntry(402, 'challenge2', {
            teams: [{ id: 'TEAM_A', playerIds: ['p5'] }, { id: 'TEAM_B', playerIds: ['p7'] }]
        })
    ];
    const pm = makePM(gs);

    // Advance challenge1 to lobby; challenge2 must stay untouched.
    const ok1 = await pm.advanceSlot('challenge1');
    assert.strictEqual(ok1, true);
    assert.strictEqual(pm.getSlotSubPhase('challenge1'), 'lobby');
    assert.strictEqual(pm.getSlotSubPhase('challenge2'), 'setup');

    // Ready up only challenge1's players — challenge2's players untouched.
    gs.lobbyReady['uid-p1'] = { gameLobby: true, discord: true };
    gs.lobbyReady['uid-p2'] = { gameLobby: true, discord: true };
    gs.lobbyReady['uid-p3'] = { gameLobby: true, discord: true };
    gs.lobbyReady['uid-p4'] = { gameLobby: true, discord: true };
    assert.strictEqual(pm.getSlotRequirements('challenge1').every(r => r.met), true);
    assert.strictEqual(gs.lobbyReady['uid-p5'], undefined);

    // Now advance challenge2 independently — challenge1 stays in lobby.
    const ok2 = await pm.advanceSlot('challenge2');
    assert.strictEqual(ok2, true);
    assert.strictEqual(pm.getSlotSubPhase('challenge2'), 'lobby');
    assert.strictEqual(pm.getSlotSubPhase('challenge1'), 'lobby');

    // challenge2's lobby reset must not disturb challenge1's ready flags.
    assert.strictEqual(gs.lobbyReady['uid-p1'].gameLobby, true);
});

test('advanceSlot refuses a challenge slot id outside challenge_game', async () => {
    const gs = baseGameState({
        currentPhase: { name: 'matches_in_progress', roundNumber: 3, startedAt: 'x', slots: { 1: 'setup', 2: 'setup' } }
    });
    const pm = makePM(gs);
    const ok = await pm.advanceSlot('challenge1');
    assert.strictEqual(ok, false);
});

test('advanceSlot refuses a numeric match slot id during challenge_game', async () => {
    const gs = baseGameState();
    const pm = makePM(gs);
    const ok = await pm.advanceSlot(1);
    assert.strictEqual(ok, false);
});

// ---- getSlotRequirements setup gating per challenge slot ----

test("getSlotRequirements('challenge3') only counts matches tagged for slot 3", () => {
    const gs = baseGameState();
    gs.gameQueue = [challengeEntry(403, 'challenge1')];
    const pm = makePM(gs);
    assert.strictEqual(pm.getSlotRequirements('challenge3')[0].met, false);
    assert.strictEqual(pm.getSlotRequirements('challenge1')[0].met, true);
});

// ---- legacy 'challenge' alias maps onto challenge1 only ----

test("a legacy 'challenge'-tagged match (pre-4-slot) counts toward challenge1 only", () => {
    const gs = baseGameState();
    gs.gameQueue = [challengeEntry(404, 'challenge')];
    const pm = makePM(gs);
    assert.strictEqual(pm.getSlotRequirements('challenge1')[0].met, true);
    assert.strictEqual(pm.getSlotRequirements('challenge2')[0].met, false);
    assert.strictEqual(pm.getSlotRequirements('challenge3')[0].met, false);
    assert.strictEqual(pm.getSlotRequirements('challenge4')[0].met, false);
});

// ---- allChallengeSlotsDone / the challenge_game exit gate ----

test('allChallengeSlotsDone is true when every slot is unused (0 challenges this round is valid)', () => {
    const gs = baseGameState();
    const pm = makePM(gs);
    assert.strictEqual(pm.allChallengeSlotsDone(), true);
});

test('allChallengeSlotsDone is false while a used slot is still mid-flight, true once it reaches done', () => {
    const gs = baseGameState();
    gs.gameQueue = [challengeEntry(405, 'challenge1', { status: 'ongoing' })];
    gs.currentPhase.slots.challenge1 = 'playing';
    const pm = makePM(gs);
    assert.strictEqual(pm.allChallengeSlotsDone(), false);

    gs.currentPhase.slots.challenge1 = 'done';
    gs.gameQueue[0].status = 'completed';
    assert.strictEqual(pm.allChallengeSlotsDone(), true);
});

test("_calculateRequirements('challenge_game') gates only on USED slots reaching done, unused slots don't block", () => {
    const gs = baseGameState();
    gs.gameQueue = [challengeEntry(406, 'challenge2', { status: 'ongoing' })];
    gs.currentPhase.slots.challenge2 = 'playing';
    const pm = makePM(gs);
    const reqs = pm._calculateRequirements('challenge_game');
    assert.strictEqual(reqs.length, 4);
    const bySlot = Object.fromEntries(reqs.map((r, i) => [`challenge${i + 1}`, r]));
    assert.strictEqual(bySlot.challenge1.met, true);  // unused
    assert.strictEqual(bySlot.challenge2.met, false); // in flight
    assert.strictEqual(bySlot.challenge3.met, true);  // unused
    assert.strictEqual(bySlot.challenge4.met, true);  // unused
});

// ---- 4 challenges truly concurrent: all in flight at once, in different formats ----

test('all 4 challenge slots can be in flight simultaneously with different team counts (2v2, 3v3-ish via extra players, etc.)', async () => {
    const gs = baseGameState();
    gs.gameQueue = [
        challengeEntry(410, 'challenge1'),
        challengeEntry(411, 'challenge2', { teams: [{ id: 'TEAM_A', playerIds: ['p5'] }, { id: 'TEAM_B', playerIds: ['p7'] }] }),
        challengeEntry(412, 'challenge3', { teams: [{ id: 'TEAM_A', playerIds: ['p1', 'p2'] }, { id: 'TEAM_B', playerIds: ['p5', 'p6'] }] }),
        challengeEntry(413, 'challenge4', { teams: [{ id: 'TEAM_A', playerIds: ['p3'] }, { id: 'TEAM_B', playerIds: ['p7'] }] })
    ];
    const pm = makePM(gs);

    for (const id of ['challenge1', 'challenge2', 'challenge3', 'challenge4']) {
        const ok = await pm.advanceSlot(id, true); // force: skip individual readiness for this smoke test
        assert.strictEqual(ok, true, `${id} should advance to lobby`);
    }
    for (const id of ['challenge1', 'challenge2', 'challenge3', 'challenge4']) {
        assert.strictEqual(pm.getSlotSubPhase(id), 'lobby');
    }
});

// ---- migratePhaseIfNeeded: ancient flat challenge_game -> slot-based ----

test('migratePhaseIfNeeded derives challenge1 from the old flat challengeLobbyState, seeds challenge2-4 unused', () => {
    const gs = {
        currentPhase: {
            name: 'challenge_game', roundNumber: 2, startedAt: 'x',
            challengeLobbyState: 'lobby'
            // no .slots yet — ancient shape
        },
        gameQueue: [challengeEntry(420, 'challenge')]
    };
    const pm = makePM(gs);
    const migrated = pm.migratePhaseIfNeeded();
    assert.strictEqual(migrated, true);
    assert.deepStrictEqual(gs.currentPhase.slots, {
        challenge1: 'lobby', challenge2: 'setup', challenge3: 'setup', challenge4: 'setup'
    });
});

test('migratePhaseIfNeeded is a no-op once .slots already exists', () => {
    const gs = baseGameState();
    const pm = makePM(gs);
    const migrated = pm.migratePhaseIfNeeded();
    assert.strictEqual(migrated, false);
});

test('migratePhaseIfNeeded maps an ongoing legacy challenge match to "playing"', () => {
    const gs = {
        currentPhase: { name: 'challenge_game', roundNumber: 2, startedAt: 'x' },
        gameQueue: [challengeEntry(421, 'challenge', { status: 'ongoing' })]
    };
    const pm = makePM(gs);
    pm.migratePhaseIfNeeded();
    assert.strictEqual(gs.currentPhase.slots.challenge1, 'playing');
});
