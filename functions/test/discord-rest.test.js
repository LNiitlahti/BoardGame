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

test('listGuildMembers excludes bot accounts, including itself', async () => {
    const { rest } = restWith([{
        status: 200,
        body: [
            { user: { id: '1', username: 'alpha', global_name: 'Alpha' }, nick: null },
            { user: { id: '2', username: 'tobias-thorn', global_name: 'Tobias Thorn', bot: true }, nick: null },
            { user: { id: '3', username: 'other-bot', global_name: null, bot: true }, nick: null }
        ]
    }]);
    const result = await rest.listGuildMembers({ guildId: 'g' });
    assert.deepStrictEqual(result, {
        outcome: 'ok',
        members: [{ discordUserId: '1', username: 'alpha', displayName: 'Alpha' }]
    });
});

test('listGuildMembers surfaces a failure instead of pretending the guild is empty', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Access' } }]);
    const result = await rest.listGuildMembers({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.strictEqual(result.members, undefined);
});

test('listGuildChannels returns only voice channels, normalised', async () => {
    const { rest, calls } = restWith([{
        status: 200,
        body: [
            { id: '1', name: 'general', type: 0 },
            { id: '2', name: 'Waiting Room', type: 2 },
            { id: '3', name: 'Alpha', type: 2 },
            { id: '4', name: 'Voice Channels', type: 4 }
        ]
    }]);
    const result = await rest.listGuildChannels({ guildId: 'g' });
    assert.deepStrictEqual(result, {
        outcome: 'ok',
        channels: [
            { channelId: '2', name: 'Waiting Room' },
            { channelId: '3', name: 'Alpha' }
        ]
    });
    assert.match(calls[0].url, /\/guilds\/g\/channels$/);
    assert.strictEqual(calls[0].options.method, 'GET');
});

test('listGuildChannels surfaces a failure instead of an empty list', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Access' } }]);
    const result = await rest.listGuildChannels({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.strictEqual(result.channels, undefined);
});

test('listGuildChannels handles a thrown network error', async () => {
    const { rest } = restWith([new Error('ECONNRESET')]);
    const result = await rest.listGuildChannels({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /ECONNRESET/);
});

test('sendMessage: 200 is sent', async () => {
    const { rest, calls } = restWith([{ status: 200, body: { id: 'msg1' } }]);
    const result = await rest.sendMessage({ channelId: 'c1', content: 'hello' });
    assert.deepStrictEqual(result, { outcome: 'sent' });
    assert.strictEqual(calls[0].url, 'https://discord.com/api/v10/channels/c1/messages');
    assert.strictEqual(calls[0].options.method, 'POST');
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bot tok');
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), { content: 'hello' });
});

test('sendMessage: 403 is forbidden', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Permissions' } }]);
    const result = await rest.sendMessage({ channelId: 'c1', content: 'hi' });
    assert.strictEqual(result.outcome, 'forbidden');
});

test('sendMessage: 404 is not_found', async () => {
    const { rest } = restWith([{ status: 404, body: { message: 'Unknown Channel' } }]);
    const result = await rest.sendMessage({ channelId: 'c1', content: 'hi' });
    assert.strictEqual(result.outcome, 'not_found');
});

test('sendMessage: 429 reports retry_after in milliseconds', async () => {
    const { rest } = restWith([{ status: 429, body: { retry_after: 2 } }]);
    const result = await rest.sendMessage({ channelId: 'c1', content: 'hi' });
    assert.strictEqual(result.outcome, 'rate_limited');
    assert.strictEqual(result.retryAfterMs, 2000);
});

test('sendMessage: a thrown network error becomes an error outcome', async () => {
    const { rest } = restWith([new Error('ECONNRESET')]);
    const result = await rest.sendMessage({ channelId: 'c1', content: 'hi' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /ECONNRESET/);
});

test('sendMessage: any other status is a generic error', async () => {
    const { rest } = restWith([{ status: 500, body: { message: 'Internal Server Error' } }]);
    const result = await rest.sendMessage({ channelId: 'c1', content: 'hi' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /Internal Server Error/);
});
