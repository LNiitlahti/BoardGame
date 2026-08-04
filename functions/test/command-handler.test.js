const test = require('node:test');
const assert = require('node:assert');
const { handleCommand, RETRY_DELAYS_MS } = require('../lib/command-handler');

const CONFIG = {
    enabled: true,
    guildId: 'g1',
    waitingRoomChannelId: 'chWait',
    slotChannels: { '1': ['chAlpha', 'chBravo'] }
};

const GAME_STATE = {
    currentPhase: { name: 'matches_in_progress', slots: { 1: 'lobby' } },
    gameQueue: [{ id: 'm1', status: 'ongoing' }],
    teams: [{ id: 1, players: [{ id: '1a', uid: 'uidA' }, { id: '2a', uid: 'uidB' }] }]
};

const MATCH = { id: 'm1', sides: [{ playerIds: ['1a'] }, { playerIds: ['2a'] }] };

/**
 * Minimal in-memory stand-in for the Firestore surface handleCommand uses.
 * Records tournament updates so tests can assert on lobbyReady writes.
 */
function fakeDb({ config = CONFIG, gameState = GAME_STATE, links = {}, match = MATCH, listMembersResult } = {}) {
    const updates = [];
    const configWrites = [];
    return {
        updates,
        configWrites,
        tournament(tid) {
            return {
                async getGameState() { return gameState; },
                async getConfig() { return config; },
                async getLinks() { return links; },
                async getMatch() { return match; },
                async updateGameState(patch) { updates.push(patch); },
                async writeMemberCache(data) { configWrites.push(data); }
            };
        }
    };
}

function fakeRest(moveResults, { listGuildMembersResult } = {}) {
    const calls = [];
    return {
        calls,
        async moveMember(args) {
            calls.push(args);
            const next = moveResults.shift();
            return next || { outcome: 'moved' };
        },
        async listGuildMembers() {
            return listGuildMembersResult || { outcome: 'ok', members: [{ discordUserId: 'd1', username: 'u', displayName: 'U' }] };
        }
    };
}

/**
 * moveMember driven per-discordUserId rather than a shared FIFO queue, so
 * two players in flight at once can be scripted independently across
 * attempts (queue[discordUserId] is an array of results, shifted in order).
 */
function fakeRestPerUser(queue) {
    const calls = [];
    return {
        calls,
        async moveMember(args) {
            calls.push(args);
            const q = queue[args.discordUserId] || [];
            const next = q.shift();
            return next || { outcome: 'moved' };
        },
        async listGuildMembers() {
            return { outcome: 'ok', members: [] };
        }
    };
}

const noSleep = async () => {};

test('a disabled kill switch skips everything and moves nobody', async () => {
    const db = fakeDb({ config: { ...CONFIG, enabled: false } });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(rest.calls.length, 0);
});

test('a stale pull is skipped without moving anyone', async () => {
    const db = fakeDb({
        gameState: { ...GAME_STATE, currentPhase: { name: 'matches_in_progress', slots: { 1: 'playing' } } }
    });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'stale');
    assert.strictEqual(rest.calls.length, 0);
});

test('force overrides staleness and moves linked players', async () => {
    const db = fakeDb({
        gameState: { ...GAME_STATE, currentPhase: { name: 'break' } },
        links: { uidA: { discordUserId: 'dA' } }
    });
    const rest = fakeRest([{ outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1', force: true }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(rest.calls.length, 1);
    assert.strictEqual(rest.calls[0].channelId, 'chAlpha');
});

test('unlinked players are reported without any API call', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 1);
    const byUid = Object.fromEntries(result.results.map(r => [r.uid, r.outcome]));
    assert.deepStrictEqual(byUid, { uidA: 'moved', uidB: 'unlinked' });
});

test('not_in_voice is retried on the backoff schedule then reported', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest(Array(RETRY_DELAYS_MS.length + 1).fill({ outcome: 'not_in_voice' }));
    const waits = [];
    const result = await handleCommand({
        db, rest, sleep: async ms => { waits.push(ms); },
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, RETRY_DELAYS_MS.length + 1);
    assert.deepStrictEqual(waits, RETRY_DELAYS_MS);
    assert.strictEqual(result.results.find(r => r.uid === 'uidA').outcome, 'not_in_voice');
});

test('a player who joins voice mid-window is moved and not retried again', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'not_in_voice' }, { outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 2);
    assert.strictEqual(result.results.find(r => r.uid === 'uidA').outcome, 'moved');
});

test('forbidden is terminal and never retried', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'forbidden', error: 'Missing Permissions' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 1);
    assert.strictEqual(result.results.find(r => r.uid === 'uidA').outcome, 'forbidden');
});

test('not_in_guild is terminal and never retried', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'not_in_guild', error: 'Unknown Member' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 1);
});

test('rate_limited waits the retry_after the API asked for', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'rate_limited', retryAfterMs: 250 }, { outcome: 'moved' }]);
    const waits = [];
    await handleCommand({
        db, rest, sleep: async ms => { waits.push(ms); },
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.deepStrictEqual(waits, [250]);
});

test('a successful pull marks the player Discord-ready', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'moved' }]);
    await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(db.updates.length, 1);
    assert.strictEqual(db.updates[0]['lobbyReady.uidA.discord'], true);
});

test('a return does NOT mark anyone Discord-ready', async () => {
    const db = fakeDb({
        gameState: { ...GAME_STATE, gameQueue: [{ id: 'm1', status: 'completed' }] },
        links: { uidA: { discordUserId: 'dA' } }
    });
    const rest = fakeRest([{ outcome: 'moved' }]);
    await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'return', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls[0].channelId, 'chWait');
    assert.strictEqual(db.updates.length, 0);
});

test('refresh-members writes the member cache', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-members' }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(db.configWrites.length, 1);
    assert.strictEqual(db.configWrites[0].count, 1);
    assert.strictEqual(db.configWrites[0].members[0].discordUserId, 'd1');
});

test('an unknown command type is skipped rather than throwing', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'explode' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'unknown-type');
});

test('a config with no enabled field at all is treated as disabled (fail closed)', async () => {
    const configNoEnabledField = {
        guildId: 'g1',
        waitingRoomChannelId: 'chWait',
        slotChannels: { '1': ['chAlpha', 'chBravo'] }
    };
    const db = fakeDb({ config: configNoEnabledField });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(rest.calls.length, 0);
});

test('a mixed pending batch: one player resolves early, the other retries, no duplicate results', async () => {
    const db = fakeDb({
        links: { uidA: { discordUserId: 'dA' }, uidB: { discordUserId: 'dB' } }
    });
    const rest = fakeRestPerUser({
        dA: [{ outcome: 'moved' }],
        dB: [{ outcome: 'not_in_voice' }, { outcome: 'moved' }]
    });
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });

    const callsForA = rest.calls.filter(c => c.discordUserId === 'dA');
    const callsForB = rest.calls.filter(c => c.discordUserId === 'dB');
    assert.strictEqual(callsForA.length, 1, 'player A should not be retried once moved');
    assert.strictEqual(callsForB.length, 2);

    const resultsForA = result.results.filter(r => r.uid === 'uidA');
    const resultsForB = result.results.filter(r => r.uid === 'uidB');
    assert.strictEqual(resultsForA.length, 1, 'no duplicate result entries for player A');
    assert.strictEqual(resultsForB.length, 1, 'no duplicate result entries for player B');
    assert.strictEqual(resultsForA[0].outcome, 'moved');
    assert.strictEqual(resultsForB[0].outcome, 'moved');
});

test('a mixed rate-limit batch waits on the slower (max) retry_after', async () => {
    const db = fakeDb({
        links: { uidA: { discordUserId: 'dA' }, uidB: { discordUserId: 'dB' } }
    });
    const rest = fakeRestPerUser({
        dA: [{ outcome: 'rate_limited', retryAfterMs: 5000 }, { outcome: 'moved' }],
        dB: [{ outcome: 'not_in_voice' }, { outcome: 'moved' }]
    });
    const waits = [];
    await handleCommand({
        db, rest, sleep: async ms => { waits.push(ms); },
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.deepStrictEqual(waits, [5000]);
});

test('match-not-found is skipped without calling the Discord API', async () => {
    const db = fakeDb({
        links: { uidA: { discordUserId: 'dA' } },
        match: null
    });
    const rest = fakeRest([{ outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'match-not-found');
    assert.strictEqual(rest.calls.length, 0);
});

test('member-list-failed is skipped without writing the member cache', async () => {
    const db = fakeDb();
    const rest = fakeRest([], { listGuildMembersResult: { outcome: 'error', error: 'some reason' } });
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-members' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'member-list-failed');
    assert.strictEqual(db.configWrites.length, 0);
});
