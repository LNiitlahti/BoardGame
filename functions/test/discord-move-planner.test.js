const test = require('node:test');
const assert = require('node:assert');
const { planMoves, isCommandCurrent } = require('../lib/discord-move-planner');

const CONFIG = {
    waitingRoomChannelId: 'chWait',
    slotChannels: { '1': ['chAlpha', 'chBravo'], '2': ['chCharlie', 'chDelta'] }
};

const TEAMS = [
    { id: 1, players: [{ id: '1a', uid: 'uidA' }, { id: '1b', uid: 'uidB' }] },
    { id: 2, players: [{ id: '2a', uid: 'uidC' }, { id: '2b' }] }
];

const LINKS = {
    uidA: { discordUserId: 'dA' },
    uidB: { discordUserId: 'dB' },
    uidC: { discordUserId: 'dC' }
};

const MATCH = {
    id: 'm1',
    sides: [{ playerIds: ['1a', '1b'] }, { playerIds: ['2a', '2b'] }]
};

test('pull maps each side to its slot channel by side index', () => {
    const { moves } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => [m.discordUserId, m.channelId]), [
        ['dA', 'chAlpha'], ['dB', 'chAlpha'], ['dC', 'chBravo']
    ]);
});

test('slot 2 uses the second channel pair', () => {
    const { moves } = planMoves({
        match: MATCH, teams: TEAMS, slot: '2', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual([...new Set(moves.map(m => m.channelId))], ['chCharlie', 'chDelta']);
});

test('return sends everyone to the waiting room regardless of side', () => {
    const { moves } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'return', links: LINKS, config: CONFIG
    });
    assert.strictEqual(moves.length, 3);
    assert.ok(moves.every(m => m.channelId === 'chWait'));
});

test('roster player without a uid is skipped as unlinked', () => {
    const { skipped } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(skipped, [{ playerId: '2b', uid: null, outcome: 'unlinked' }]);
});

test('player with a uid but no confirmed link is skipped as unlinked', () => {
    const { moves, skipped } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull',
        links: { uidA: { discordUserId: 'dA' } }, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => m.uid), ['uidA']);
    assert.deepStrictEqual(skipped.map(s => s.uid), ['uidB', 'uidC', null]);
});

test('missing channel for a side yields no_channel, not a crash', () => {
    const { moves, skipped } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS,
        config: { waitingRoomChannelId: 'chWait', slotChannels: { '1': ['chAlpha'] } }
    });
    assert.deepStrictEqual(moves.map(m => m.uid), ['uidA', 'uidB']);
    assert.deepStrictEqual(
        skipped.filter(s => s.outcome === 'no_channel').map(s => s.uid), ['uidC']
    );
});

test('reads the legacy `teams` key on a match as well as `sides`', () => {
    const legacy = { id: 'm2', teams: [{ playerIds: ['1a'] }, { playerIds: ['2a'] }] };
    const { moves } = planMoves({
        match: legacy, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => m.channelId), ['chAlpha', 'chBravo']);
});

test('mixed-roster side collects players from more than one team', () => {
    const mixed = { id: 'm3', sides: [{ playerIds: ['1a', '2a'] }, { playerIds: ['1b'] }] };
    const { moves } = planMoves({
        match: mixed, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => [m.uid, m.channelId]), [
        ['uidA', 'chAlpha'], ['uidC', 'chAlpha'], ['uidB', 'chBravo']
    ]);
});

test('side.players[].id is read when playerIds is absent', () => {
    const objSide = { id: 'm4', sides: [{ players: [{ id: '1a' }] }, { players: [{ id: '2a' }] }] };
    const { moves } = planMoves({
        match: objSide, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => m.uid), ['uidA', 'uidC']);
});

test('pull is current only while its slot is in lobby', () => {
    const gs = { currentPhase: { name: 'matches_in_progress', slots: { 1: 'lobby', 2: 'setup' } } };
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: '1' }), true);
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: '2' }), false);
});

test('pull for the challenge slot keys off the challenge phase', () => {
    const gs = { currentPhase: { name: 'challenge_game' } };
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: 'challenge' }), true);
    assert.strictEqual(
        isCommandCurrent({ currentPhase: { name: 'break' } }, { type: 'pull', slot: 'challenge' }),
        false
    );
});

test('return is current only once the match is completed', () => {
    const gs = { gameQueue: [{ id: 'm1', status: 'ongoing' }] };
    assert.strictEqual(isCommandCurrent(gs, { type: 'return', matchId: 'm1' }), false);
    assert.strictEqual(
        isCommandCurrent({ gameQueue: [{ id: 'm1', status: 'completed' }] },
            { type: 'return', matchId: 'm1' }),
        true
    );
});

test('force bypasses every staleness check', () => {
    const gs = { currentPhase: { name: 'break' }, gameQueue: [] };
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: '1', force: true }), true);
    assert.strictEqual(isCommandCurrent(gs, { type: 'return', matchId: 'zzz', force: true }), true);
});

test('refresh-members is always current', () => {
    assert.strictEqual(isCommandCurrent({}, { type: 'refresh-members' }), true);
});
