/**
 * Thin wrapper over the Discord HTTP API.
 *
 * Owns exactly one piece of judgement: translating HTTP responses into the
 * outcome vocabulary the rest of the system uses. Everything downstream
 * decides retry-vs-give-up from that outcome, so the mapping lives in one
 * place rather than being re-derived from status codes at each call site.
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */

const API_BASE = 'https://discord.com/api/v10';

/** Discord's error code for "Target user is not connected to voice." */
const ERR_NOT_IN_VOICE = 40032;

/** Discord channel type for a voice channel (GUILD_VOICE). */
const CHANNEL_TYPE_VOICE = 2;

function createDiscordRest({ token, fetchImpl = fetch }) {

    async function request(method, path, body) {
        return fetchImpl(API_BASE + path, {
            method,
            headers: {
                Authorization: `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    }

    async function readJson(res) {
        try {
            return await res.json();
        } catch {
            return null;
        }
    }

    /**
     * Move one member into a voice channel.
     *
     * Discord requires the member to ALREADY be connected to some voice
     * channel — you cannot pull someone who is not in voice at all. That
     * case comes back as 400/40032 and is mapped to `not_in_voice`, which
     * the caller retries, because it is a condition that changes over time
     * as people join.
     */
    async function moveMember({ guildId, discordUserId, channelId }) {
        let res;
        try {
            res = await request('PATCH', `/guilds/${guildId}/members/${discordUserId}`, {
                channel_id: channelId
            });
        } catch (err) {
            return { outcome: 'error', error: String(err && err.message ? err.message : err) };
        }

        if (res.status === 200) return { outcome: 'moved' };

        const body = await readJson(res);

        if (res.status === 429) {
            const retryAfter = Number(body && body.retry_after);
            return {
                outcome: 'rate_limited',
                retryAfterMs: Math.ceil((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000)
            };
        }
        if (res.status === 403) {
            return { outcome: 'forbidden', error: (body && body.message) || 'Missing Permissions' };
        }
        if (res.status === 404) {
            return { outcome: 'not_in_guild', error: (body && body.message) || 'Unknown Member' };
        }
        if (res.status === 400 && body && body.code === ERR_NOT_IN_VOICE) {
            return { outcome: 'not_in_voice', error: body.message };
        }
        return {
            outcome: 'error',
            error: `HTTP ${res.status}: ${(body && body.message) || 'unknown error'}`
        };
    }

    /**
     * List guild members for the link dropdown.
     *
     * Requires the GUILD_MEMBERS privileged intent to be enabled in the
     * Discord developer portal. Without it this returns an error rather
     * than an empty list — an empty list would look like "this guild has no
     * members", which is indistinguishable from a working call and would
     * silently produce a blank dropdown.
     */
    async function listGuildMembers({ guildId, limit = 1000 }) {
        let res;
        try {
            res = await request('GET', `/guilds/${guildId}/members?limit=${limit}`);
        } catch (err) {
            return { outcome: 'error', error: String(err && err.message ? err.message : err) };
        }

        const body = await readJson(res);

        if (res.status !== 200 || !Array.isArray(body)) {
            return {
                outcome: 'error',
                error: `HTTP ${res.status}: ${(body && body.message) || 'unexpected response'}`
            };
        }

        return {
            outcome: 'ok',
            // Bot accounts (including this bot itself) are never valid link
            // targets — a player can never legitimately be "the bot".
            members: body
                .filter(member => member.user.bot !== true)
                .map(member => ({
                    discordUserId: member.user.id,
                    username: member.user.username,
                    displayName: member.nick || member.user.global_name || member.user.username
                }))
        };
    }

    /**
     * List the guild's voice channels for the setup dropdowns.
     *
     * Filtered to voice channels only: a member can only be moved into one,
     * so listing text channels or categories would just let an operator
     * pick something that fails at move time instead of at setup time.
     *
     * Like listGuildMembers, a failure is reported as an error rather than
     * an empty list — "no channels" and "the call failed" must not look
     * identical to the panel.
     */
    async function listGuildChannels({ guildId }) {
        let res;
        try {
            res = await request('GET', `/guilds/${guildId}/channels`);
        } catch (err) {
            return { outcome: 'error', error: String(err && err.message ? err.message : err) };
        }

        const body = await readJson(res);

        if (res.status !== 200 || !Array.isArray(body)) {
            return {
                outcome: 'error',
                error: `HTTP ${res.status}: ${(body && body.message) || 'unexpected response'}`
            };
        }

        return {
            outcome: 'ok',
            channels: body
                .filter(channel => channel.type === CHANNEL_TYPE_VOICE)
                .map(channel => ({ channelId: channel.id, name: channel.name }))
        };
    }

    /**
     * Post a status message to a text channel — used for the bot's own
     * activity reports ("moved players to ALPHA/BRAVO"), never for voice
     * moves. Shares the same outcome vocabulary as the other calls so
     * callers don't need a second way to interpret a Discord response.
     */
    async function sendMessage({ channelId, content }) {
        let res;
        try {
            res = await request('POST', `/channels/${channelId}/messages`, { content });
        } catch (err) {
            return { outcome: 'error', error: String(err && err.message ? err.message : err) };
        }

        if (res.status === 200) return { outcome: 'sent' };

        const body = await readJson(res);

        if (res.status === 429) {
            const retryAfter = Number(body && body.retry_after);
            return {
                outcome: 'rate_limited',
                retryAfterMs: Math.ceil((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000)
            };
        }
        if (res.status === 403) {
            return { outcome: 'forbidden', error: (body && body.message) || 'Missing Permissions' };
        }
        if (res.status === 404) {
            return { outcome: 'not_found', error: (body && body.message) || 'Unknown Channel' };
        }
        return {
            outcome: 'error',
            error: `HTTP ${res.status}: ${(body && body.message) || 'unknown error'}`
        };
    }

    return { moveMember, listGuildMembers, listGuildChannels, sendMessage };
}

module.exports = { createDiscordRest };
