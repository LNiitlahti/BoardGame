const test = require('node:test');
const assert = require('node:assert');
const {
    handleCommand, RETRY_DELAYS_MS, buildStatusMessage,
    computeStatusContext, STATUS_TEMPLATES, resetStatusMessageVariety
} = require('../lib/command-handler');

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
function fakeDb({ config = CONFIG, gameState = GAME_STATE, links = {}, match = MATCH } = {}) {
    const updates = [];
    const configWrites = [];
    const channelWrites = [];
    return {
        updates,
        configWrites,
        channelWrites,
        tournament(tid) {
            return {
                async getGameState() { return gameState; },
                async getConfig() { return config; },
                async getLinks() { return links; },
                async getMatch() { return match; },
                async updateGameState(patch) { updates.push(patch); },
                async writeMemberCache(data) { configWrites.push(data); },
                async writeChannelCache(data) { channelWrites.push(data); }
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
        },
        async listGuildChannels() {
            return { outcome: 'ok', channels: [{ channelId: 'c1', name: 'Waiting Room' }] };
        },
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

test('refresh-channels writes the channel cache', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(db.channelWrites.length, 1);
    assert.strictEqual(db.channelWrites[0].count, 1);
    assert.strictEqual(db.channelWrites[0].channels[0].channelId, 'c1');
    assert.ok(db.channelWrites[0].refreshedAt);
});

test('a failed channel list is reported, not silently cached', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    rest.listGuildChannels = async () => ({ outcome: 'error', error: 'Missing Access' });
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'channel-list-failed');
    assert.strictEqual(db.channelWrites.length, 0);
});

test('refresh-channels runs even when the kill switch is disabled', async () => {
    const db = fakeDb({ config: { ...CONFIG, enabled: false } });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(db.channelWrites.length, 1);
});

test('refresh-members runs even when the kill switch is disabled', async () => {
    const db = fakeDb({ config: { ...CONFIG, enabled: false } });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-members' }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(db.configWrites.length, 1);
});

test('refresh-channels is blocked when no config exists at all', async () => {
    const db = fakeDb({ config: null });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(db.channelWrites.length, 0);
    assert.strictEqual(rest.calls.length, 0);
});

test('refresh-members is blocked when no config exists at all', async () => {
    const db = fakeDb({ config: null });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-members' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(db.configWrites.length, 0);
    assert.strictEqual(rest.calls.length, 0);
});

// ── Status channel reporting ────────────────────────────────────────────

/**
 * fakeDb + fakeRest extended with the status-message surface
 * (getChannelCache / sendMessage), which older fakes above intentionally
 * predate — command-handler must work with or without them.
 */
function fakeDbWithChannelCache(opts, channels = []) {
    const db = fakeDb(opts);
    return {
        ...db,
        tournament(tid) {
            const t = db.tournament(tid);
            return { ...t, async getChannelCache() { return channels; } };
        }
    };
}

function fakeRestWithSend(moveResults, sendResults = []) {
    const rest = fakeRest(moveResults);
    const sentMessages = [];
    return {
        ...rest,
        sentMessages,
        async sendMessage(args) {
            sentMessages.push(args);
            const next = sendResults.shift();
            return next || { outcome: 'sent' };
        }
    };
}

test('a status channel gets a success message after a pull completes', async () => {
    const db = fakeDbWithChannelCache(
        {
            config: { ...CONFIG, statusChannelId: 'statusCh' },
            links: { uidA: { discordUserId: 'dA' }, uidB: { discordUserId: 'dB' } }
        },
        [{ channelId: 'chAlpha', name: 'ALPHA' }, { channelId: 'chBravo', name: 'BRAVO' }]
    );
    const rest = fakeRestWithSend([{ outcome: 'moved' }, { outcome: 'moved' }]);
    await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.sentMessages.length, 1);
    assert.strictEqual(rest.sentMessages[0].channelId, 'statusCh');
    // Wording is persona-flavored and varies per call, but the destination
    // channel names must survive in every variant.
    assert.match(rest.sentMessages[0].content, /ALPHA/);
    assert.match(rest.sentMessages[0].content, /BRAVO/);
});

test('no status channel configured means no message is sent', async () => {
    const db = fakeDbWithChannelCache(
        { links: { uidA: { discordUserId: 'dA' } } }
    );
    const rest = fakeRestWithSend([{ outcome: 'moved' }]);
    await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.sentMessages.length, 0);
});

test('a failed status send does not fail the overall command', async () => {
    const db = fakeDbWithChannelCache({
        config: { ...CONFIG, statusChannelId: 'statusCh' },
        links: { uidA: { discordUserId: 'dA' } }
    });
    const rest = fakeRestWithSend([{ outcome: 'moved' }]);
    rest.sendMessage = async () => { throw new Error('discord is down'); };
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'done');
});

test('a planMoves warning (legacy challenge channel, unconfigured challenge2+) is surfaced on the result and the status message', async () => {
    const db = fakeDbWithChannelCache({
        config: {
            ...CONFIG,
            statusChannelId: 'statusCh',
            // Only the legacy flat 'challenge' pair exists — challenge2 has
            // no channel of its own yet (see resolveSlotChannelPair).
            slotChannels: { '1': ['chAlpha', 'chBravo'], challenge: ['chC1', 'chC2'] }
        },
        gameState: {
            currentPhase: { name: 'challenge_game', slots: { challenge2: 'lobby' } },
            gameQueue: [{ id: 'm1', status: 'ongoing' }],
            teams: [{ id: 1, players: [{ id: '1a', uid: 'uidA' }] }]
        },
        links: { uidA: { discordUserId: 'dA' } },
        match: { id: 'm1', sides: [{ playerIds: ['1a'] }, { playerIds: [] }] }
    });
    const rest = fakeRestWithSend([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: 'challenge2', matchId: 'm1' }
    });

    assert.strictEqual(result.status, 'done');
    assert.match(result.planWarning, /slotChannels\.challenge2 is not configured/);
    assert.strictEqual(rest.sentMessages.length, 1);
    assert.match(rest.sentMessages[0].content, /⚠️ slotChannels\.challenge2 is not configured/);
});

test('no planMoves warning means the status message has no extra warning line', async () => {
    const db = fakeDbWithChannelCache(
        { config: { ...CONFIG, statusChannelId: 'statusCh' }, links: { uidA: { discordUserId: 'dA' } } },
        [{ channelId: 'chAlpha', name: 'ALPHA' }]
    );
    const rest = fakeRestWithSend([{ outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.planWarning, undefined);
    assert.doesNotMatch(rest.sentMessages[0].content, /⚠️.*slotChannels/);
});

test('buildStatusMessage appends a warning line when planWarning is passed', () => {
    const msg = buildStatusMessage({
        command: { type: 'pull', slot: 'challenge2' },
        results: [{ outcome: 'no_channel' }],
        channelsById: {},
        planWarning: 'slotChannels.challenge2 is not configured'
    });
    assert.match(msg, /⚠️ slotChannels\.challenge2 is not configured$/);
});

test('older db/rest fakes without getChannelCache/sendMessage do not break the command', async () => {
    const db = fakeDb({
        config: { ...CONFIG, statusChannelId: 'statusCh' },
        links: { uidA: { discordUserId: 'dA' } }
    });
    const rest = fakeRest([{ outcome: 'moved' }]); // no sendMessage method
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'done');
});

test('buildStatusMessage: all moved is a success summary naming destination channels', () => {
    const msg = buildStatusMessage({
        command: { type: 'pull', slot: '1' },
        results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'moved', channelId: 'c2' }
        ],
        channelsById: { c1: 'ALPHA', c2: 'BRAVO' }
    });
    assert.match(msg, /ALPHA/);
    assert.match(msg, /BRAVO/);
});

test('buildStatusMessage: partial success reports both counts', () => {
    const msg = buildStatusMessage({
        command: { type: 'pull', slot: '1' },
        results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'unlinked' }
        ],
        channelsById: { c1: 'ALPHA' }
    });
    // Wording varies by template, but the destination and the reason the
    // other player didn't move must survive every variant.
    assert.match(msg, /ALPHA/);
    assert.match(msg, /unlinked/);
});

test('buildStatusMessage: zero moved is a failure summary', () => {
    const msg = buildStatusMessage({
        command: { type: 'return', slot: 'challenge' },
        results: [{ uid: 'a', outcome: 'forbidden' }],
        channelsById: {}
    });
    assert.match(msg, /forbidden/);
});

test('buildStatusMessage: falls back to the raw channel id when the cache has no name', () => {
    const msg = buildStatusMessage({
        command: { type: 'pull', slot: '1' },
        results: [{ uid: 'a', outcome: 'moved', channelId: 'rawId123' }],
        channelsById: {}
    });
    assert.match(msg, /rawId123/);
});

// ── Persona template pool (Tobias Thorn / Topias Törni, the quiet guide) ───

test('computeStatusContext classifies outcomes into the right category', () => {
    const base = { command: { type: 'pull', slot: '1' }, channelsById: { c1: 'ALPHA' } };
    assert.strictEqual(computeStatusContext({ ...base, results: [] }).category, 'noop');
    assert.strictEqual(computeStatusContext({
        ...base, results: [{ uid: 'a', outcome: 'moved', channelId: 'c1' }]
    }).category, 'success');
    assert.strictEqual(computeStatusContext({
        ...base, results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'unlinked' }
        ]
    }).category, 'partial');
    assert.strictEqual(computeStatusContext({
        ...base, results: [{ uid: 'a', outcome: 'forbidden' }]
    }).category, 'failure');
});

test('every success template still names the destination and the moved count', () => {
    const ctx = computeStatusContext({
        command: { type: 'pull', slot: '1' },
        results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'moved', channelId: 'c2' }
        ],
        channelsById: { c1: 'ALPHA', c2: 'BRAVO' }
    });
    assert.strictEqual(STATUS_TEMPLATES.success.length >= 15, true, 'expected a real pool, not a token few');
    for (const t of STATUS_TEMPLATES.success) {
        const msg = t.render(ctx);
        assert.match(msg, /ALPHA/, `${t.id} dropped the destination`);
        assert.match(msg, /BRAVO/, `${t.id} dropped the destination`);
        assert.match(msg, /2/, `${t.id} dropped the moved count`);
    }
});

test('every partial template still names the destination, the reason, and the split', () => {
    const ctx = computeStatusContext({
        command: { type: 'pull', slot: '1' },
        results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'unlinked' },
            { uid: 'c', outcome: 'forbidden' }
        ],
        channelsById: { c1: 'ALPHA' }
    });
    assert.strictEqual(STATUS_TEMPLATES.partial.length >= 10, true, 'expected a real pool, not a token few');
    for (const t of STATUS_TEMPLATES.partial) {
        const msg = t.render(ctx);
        assert.match(msg, /ALPHA/, `${t.id} dropped the destination`);
        assert.match(msg, /unlinked/, `${t.id} dropped the failure reasons`);
        assert.match(msg, /forbidden/, `${t.id} dropped the failure reasons`);
        assert.match(msg, /1/, `${t.id} dropped the moved count`);
        assert.match(msg, /3/, `${t.id} dropped the total count`);
    }
});

test('every failure template still names the total and the reasons', () => {
    const ctx = computeStatusContext({
        command: { type: 'return', slot: 'challenge' },
        results: [
            { uid: 'a', outcome: 'forbidden' },
            { uid: 'b', outcome: 'not_in_guild' }
        ],
        channelsById: {}
    });
    assert.strictEqual(STATUS_TEMPLATES.failure.length >= 10, true, 'expected a real pool, not a token few');
    for (const t of STATUS_TEMPLATES.failure) {
        const msg = t.render(ctx);
        assert.match(msg, /forbidden/, `${t.id} dropped the failure reasons`);
        assert.match(msg, /not_in_guild/, `${t.id} dropped the failure reasons`);
        assert.match(msg, /2/, `${t.id} dropped the total count`);
    }
});

test('the persona pool totals roughly fifty distinct lines across all outcome categories', () => {
    const totalTemplates = Object.values(STATUS_TEMPLATES).reduce((n, list) => n + list.length, 0);
    assert.strictEqual(totalTemplates >= 45, true, `only ${totalTemplates} templates`);
    const allIds = Object.values(STATUS_TEMPLATES).flatMap(list => list.map(t => t.id));
    assert.strictEqual(new Set(allIds).size, allIds.length, 'template ids must be unique');
    // Genuinely distinct wording, not the same sentence with one word swapped:
    // every rendered line in a category should be a unique string.
    const ctx = computeStatusContext({
        command: { type: 'pull', slot: '1' },
        results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'unlinked' }
        ],
        channelsById: { c1: 'ALPHA' }
    });
    for (const category of Object.keys(STATUS_TEMPLATES)) {
        const rendered = STATUS_TEMPLATES[category].map(t => t.render(ctx));
        assert.strictEqual(new Set(rendered).size, rendered.length, `${category} has duplicate wording`);
    }
});

test('buildStatusMessage never repeats the same template twice in a row for the same outcome shape', () => {
    resetStatusMessageVariety();
    const args = {
        command: { type: 'pull', slot: '1' },
        results: [
            { uid: 'a', outcome: 'moved', channelId: 'c1' },
            { uid: 'b', outcome: 'moved', channelId: 'c2' }
        ],
        channelsById: { c1: 'ALPHA', c2: 'BRAVO' }
    };
    let previous = null;
    for (let i = 0; i < 100; i++) {
        const msg = buildStatusMessage(args);
        assert.notStrictEqual(msg, previous, `back-to-back repeat at call ${i}`);
        previous = msg;
    }
});

test('buildStatusMessage draws from real variety, not one template dominating', () => {
    resetStatusMessageVariety();
    const args = {
        command: { type: 'pull', slot: '1' },
        results: [{ uid: 'a', outcome: 'moved', channelId: 'c1' }],
        channelsById: { c1: 'ALPHA' }
    };
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(buildStatusMessage(args));
    assert.strictEqual(seen.size > 5, true, `only saw ${seen.size} distinct messages in 60 draws`);
});
