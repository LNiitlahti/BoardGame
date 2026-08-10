/**
 * Coverage for PhaseManager.getSlotMatchDetails() — the admin-display
 * resolver for a slot's active matches (game name, sides' team names,
 * Discord channels). Mirrors _getPlayersWhoMustReadyForSlot's filtering.
 *
 * phase-manager.js is a plain browser script (window.PhaseManager), so
 * stub global.window + ICON_SVGS before requiring it (same as
 * phase-manager-slot-requirements.test.js).
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/phase-manager.js');
const PhaseManager = global.window.PhaseManager;

function makeGs(overrides = {}) {
    return {
        currentPhase: { name: 'matches_in_progress', roundNumber: 3, startedAt: 1_000_000, slots: { 1: 'lobby', 2: 'setup' } },
        teams: [
            { id: 1, name: 'Red Dragons', players: [{ uid: 'u1', name: 'Alice', id: 101 }] },
            { id: 2, name: 'Blue Owls',   players: [{ uid: 'u2', name: 'Bob',   id: 102 }] }
        ],
        gameQueue: [],
        ...overrides
    };
}

test('resolves game name from gameDefinitions, team names, and discord channels (modern teams[] shape)', () => {
    const gs = makeGs({
        gameDefinitions: { cs2: { name: 'Counter-Strike 2' } },
        gameQueue: [{
            id: 'm1', status: 'pending', slot: 1, roundNumber: 3, createdAt: 2_000_000,
            game: 'cs2', matchNumber: 7,
            teams: [{ id: 1, playerIds: [101] }, { id: 2, playerIds: [102] }]
        }]
    });
    // Discord channel names are resolved via an injected dependency (the
    // tournament's real slotChannels/channelCache config), not read off the
    // match directly -- see the discordChannel comment in
    // getSlotMatchDetails(). Stub it the way admin.js/god-app.js's real
    // resolveDiscordChannelName(slot, sideId) would, to verify the wiring.
    const resolveDiscordChannelName = (slot, sideId) => {
        assert.strictEqual(slot, 1);
        return { 1: 'ALPHA', 2: 'BRAVO' }[sideId] || null;
    };
    const pm = new PhaseManager(gs, { resolveDiscordChannelName });
    const details = pm.getSlotMatchDetails(1);

    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].gameName, 'Counter-Strike 2');
    assert.strictEqual(details[0].matchNumber, 7);
    assert.deepStrictEqual(details[0].sides.map(s => s.teamName), ['Red Dragons', 'Blue Owls']);
    assert.deepStrictEqual(details[0].sides.map(s => s.discordChannel), ['ALPHA', 'BRAVO']);
});

test('legacy sides[].players[].teamId shape resolves team names too', () => {
    const gs = makeGs({
        gameQueue: [{
            id: 'm2', status: 'pending', slot: 1, roundNumber: 3,
            gameType: 'trivia',
            sides: [{ players: [{ id: 101, teamId: 1 }] }, { players: [{ id: 102, teamId: 2 }] }]
        }]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails(1);
    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].gameName, 'trivia'); // no gameDefinitions/getGameDisplayName in node
    assert.deepStrictEqual(details[0].sides.map(s => s.teamName), ['Red Dragons', 'Blue Owls']);
});

test('filters: other slot, other round, completed, breaks, challenges are excluded', () => {
    const gs = makeGs({
        gameQueue: [
            { id: 'other-slot',  status: 'pending', slot: 2, roundNumber: 3 },
            { id: 'other-round', status: 'pending', slot: 1, roundNumber: 2 },
            { id: 'done',        status: 'completed', slot: 1, roundNumber: 3 },
            { id: 'break',       isBreak: true, slot: 1 },
            { id: 'challenge',   status: 'pending', isChallenge: true }
        ]
    });
    const pm = new PhaseManager(gs, {});
    assert.deepStrictEqual(pm.getSlotMatchDetails(1), []);
});

test('untagged match counts for BOTH slots (mirrors ready-list policy)', () => {
    const gs = makeGs({
        gameQueue: [{ id: 'untagged', status: 'pending', teams: [{ id: 1, playerIds: [101] }] }]
    });
    const pm = new PhaseManager(gs, {});
    assert.strictEqual(pm.getSlotMatchDetails(1).length, 1);
    assert.strictEqual(pm.getSlotMatchDetails(2).length, 1);
});

test("pseudo-slot 'challenge' returns only challenge matches", () => {
    const gs = makeGs({
        gameQueue: [
            { id: 'normal', status: 'pending', slot: 1, roundNumber: 3 },
            { id: 'chal', status: 'pending', isChallenge: true, slot: 'challenge', game: 'darts',
              teams: [{ id: 2, playerIds: [102] }] }
        ]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails('challenge');
    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].id, 'chal');
    assert.deepStrictEqual(details[0].sides.map(s => s.teamName), ['Blue Owls']);
});

test('unknown team id falls back to side.name then "Team <id>"', () => {
    const gs = makeGs({
        gameQueue: [{
            id: 'm3', status: 'pending', slot: 1, roundNumber: 3,
            teams: [{ id: 99, playerIds: [] }, { id: 1, playerIds: [101] }]
        }]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails(1);
    assert.strictEqual(details[0].sides[0].teamName, 'Team 99');
    assert.strictEqual(details[0].sides[1].teamName, 'Red Dragons');
});

// ---- getLobbyPlayerStatuses ----

test('getLobbyPlayerStatuses resolves names from rosters and readiness from lobbyReady', () => {
    const gs = makeGs({
        gameQueue: [{ id: 'm1', status: 'pending', slot: 1, roundNumber: 3,
                      teams: [{ id: 1, playerIds: [101] }, { id: 2, playerIds: [102] }] }],
        lobbyReady: {
            u1: { gameLobby: true, discord: false },
            u2: { ready: true } // legacy flag implies both
        }
    });
    const pm = new PhaseManager(gs, {});
    const statuses = pm.getLobbyPlayerStatuses(1);

    assert.deepStrictEqual(statuses, [
        { uid: 'u1', name: 'Alice', teamName: 'Red Dragons', gameLobby: true,  discord: false },
        { uid: 'u2', name: 'Bob',   teamName: 'Blue Owls',   gameLobby: true,  discord: true }
    ]);
});

test('getLobbyPlayerStatuses falls back to lobbyReady.name, then shortened uid', () => {
    const gs = makeGs({
        teams: [{ id: 1, name: 'Red Dragons', players: [
            { uid: 'u1', name: 'Alice', id: 101 },
            { uid: 'mystery-user-uid', id: 103 } // roster entry with no name
        ] }],
        gameQueue: [{ id: 'm1', status: 'pending', slot: 1, roundNumber: 3,
                      teams: [{ id: 1, playerIds: [101] }] }],
        lobbyReady: { 'mystery-user-uid': { name: 'RecordedName', gameLobby: false, discord: false } }
    });
    const pm = new PhaseManager(gs, {});
    const statuses = pm.getLobbyPlayerStatuses(1);
    const mystery = statuses.find(s => s.uid === 'mystery-user-uid');
    assert.strictEqual(mystery.name, 'RecordedName');
});

test('getLobbyPlayerStatuses returns [] when no players must ready', () => {
    const pm = new PhaseManager(makeGs(), {});
    assert.deepStrictEqual(pm.getLobbyPlayerStatuses(1), []);
});
