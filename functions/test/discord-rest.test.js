const test = require('node:test');
const assert = require('node:assert');
const { createDiscordRest } = require('../lib/discord-rest');

function fakeResponse({ status, body }) {
    return {
        status,
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

function restWith(responses) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra fetch call');
        if (next instanceof Error) throw next;
        return fakeResponse(next);
    };
    return { rest: createDiscordRest({ token: 'tok', fetchImpl }), calls };
}

test('200 is a successful move', async () => {
    const { rest, calls } = restWith([{
        status: 200,
        body: { user: { id: 'u' }, channel_id: 'c' }
    }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.deepStrictEqual(result, { outcome: 'moved' });
    assert.strictEqual(calls[0].url, 'https://discord.com/api/v10/guilds/g/members/u');
    assert.strictEqual(calls[0].options.method, 'PATCH');
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bot tok');
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), { channel_id: 'c' });
});

test('400 with code 40032 is not_in_voice', async () => {
    const { rest } = restWith([
        { status: 400, body: { code: 40032, message: 'Target user is not connected to voice.' } }
    ]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'not_in_voice');
});

test('400 with any other code is a generic error, not not_in_voice', async () => {
    const { rest } = restWith([{ status: 400, body: { code: 50035, message: 'Invalid Form Body' } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /Invalid Form Body/);
});

test('403 is forbidden', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Permissions' } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'forbidden');
});

test('404 is not_in_guild', async () => {
    const { rest } = restWith([{ status: 404, body: { message: 'Unknown Member' } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'not_in_guild');
});

test('429 reports retry_after in milliseconds', async () => {
    const { rest } = restWith([{ status: 429, body: { retry_after: 1.5 } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'rate_limited');
    assert.strictEqual(result.retryAfterMs, 1500);
});

test('a thrown network error becomes a retryable error outcome', async () => {
    const { rest } = restWith([new Error('ECONNRESET')]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /ECONNRESET/);
});

test('listGuildMembers normalises the member shape', async () => {
    const { rest, calls } = restWith([{
        status: 200,
        body: [
            { user: { id: '1', username: 'alpha', global_name: 'Alpha' }, nick: 'AlphaNick' },
            { user: { id: '2', username: 'beta', global_name: null }, nick: null }
        ]
    }]);
    const result = await rest.listGuildMembers({ guildId: 'g' });
    assert.deepStrictEqual(result, {
        outcome: 'ok',
        members: [
            { discordUserId: '1', username: 'alpha', displayName: 'AlphaNick' },
            { discordUserId: '2', username: 'beta', displayName: 'beta' }
        ]
    });
    assert.match(calls[0].url, /\/guilds\/g\/members\?limit=1000$/);
});

test('listGuildMembers surfaces a failure instead of pretending the guild is empty', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Access' } }]);
    const result = await rest.listGuildMembers({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.strictEqual(result.members, undefined);
});
