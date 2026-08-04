/**
 * Orchestration for one Discord command.
 *
 * All I/O is injected (`db`, `rest`, `sleep`) so the whole flow — including
 * the two-minute retry window — is testable in microseconds with fakes.
 */

const { planMoves, isCommandCurrent } = require('./discord-move-planner');

/**
 * Waits between move attempts, in ms. Produces attempts at
 * t = 0, 1, 3, 7, 15, 31, 63, 120 seconds: aggressive early (someone who is
 * three seconds late gets pulled almost immediately), sparse later, hard
 * stop at two minutes.
 *
 * Bounded deliberately. An unbounded loop would drag back a player who left
 * the channel on purpose.
 */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 57000];

/**
 * Outcomes that will never change by trying again: either it worked, or
 * retrying cannot fix it (bad permissions, wrong id, no link, no channel).
 * Everything else — not_in_voice, transient errors, rate limits — is worth
 * another attempt inside the window.
 */
const TERMINAL_OUTCOMES = new Set([
    'moved', 'unlinked', 'no_channel', 'forbidden', 'not_in_guild'
]);

async function handleCommand({ db, rest, sleep, tournamentId, command }) {
    const tournament = db.tournament(tournamentId);

    const config = await tournament.getConfig();
    if (!config) {
        return { status: 'skipped', reason: 'disabled', results: [] };
    }

    if (command.type === 'refresh-members') {
        const listed = await rest.listGuildMembers({ guildId: config.guildId });
        if (listed.outcome !== 'ok') {
            return { status: 'skipped', reason: 'member-list-failed', error: listed.error, results: [] };
        }
        await tournament.writeMemberCache({
            members: listed.members,
            count: listed.members.length,
            refreshedAt: new Date().toISOString()
        });
        return { status: 'done', results: [] };
    }

    if (command.type === 'refresh-channels') {
        const listed = await rest.listGuildChannels({ guildId: config.guildId });
        if (listed.outcome !== 'ok') {
            return { status: 'skipped', reason: 'channel-list-failed', error: listed.error, results: [] };
        }
        await tournament.writeChannelCache({
            channels: listed.channels,
            count: listed.channels.length,
            refreshedAt: new Date().toISOString()
        });
        return { status: 'done', results: [] };
    }

    // The kill switch only gates moves (pull/return). refresh-* commands
    // never move anyone, so they run even while disabled — otherwise a
    // brand-new config (which defaults to disabled) could never populate
    // its channel/member caches without first enabling automatic moves.
    if (config.enabled !== true) {
        return { status: 'skipped', reason: 'disabled', results: [] };
    }

    if (command.type !== 'pull' && command.type !== 'return') {
        return { status: 'skipped', reason: 'unknown-type', results: [] };
    }

    const gameState = await tournament.getGameState();
    if (!isCommandCurrent(gameState, command)) {
        return { status: 'skipped', reason: 'stale', results: [] };
    }

    const match = await tournament.getMatch(command.matchId, command.slot);
    if (!match) {
        return { status: 'skipped', reason: 'match-not-found', results: [] };
    }

    const links = await tournament.getLinks();
    const { moves, skipped } = planMoves({
        match,
        teams: gameState.teams,
        slot: command.slot,
        direction: command.type === 'return' ? 'return' : 'pull',
        links,
        config
    });

    // Skipped players already carry a terminal outcome — report, never call.
    const results = skipped.map(s => ({
        uid: s.uid, playerId: s.playerId, outcome: s.outcome
    }));

    // Pending work, mutated in place as players succeed and drop out.
    let pending = moves.map(move => ({ ...move, outcome: null, error: null }));

    for (let attempt = 0; pending.length > 0; attempt++) {
        for (const item of pending) {
            const res = await rest.moveMember({
                guildId: config.guildId,
                discordUserId: item.discordUserId,
                channelId: item.channelId
            });
            item.outcome = res.outcome;
            item.error = res.error || null;
            item.retryAfterMs = res.retryAfterMs;
        }

        const done = pending.filter(i => TERMINAL_OUTCOMES.has(i.outcome));
        done.forEach(i => results.push({
            uid: i.uid, playerId: i.playerId, discordUserId: i.discordUserId,
            channelId: i.channelId, outcome: i.outcome, error: i.error
        }));

        // A successful move IS the confirmation the player is in the right
        // channel — better evidence than the self-reported checkbox.
        if (command.type === 'pull') {
            const moved = done.filter(i => i.outcome === 'moved');
            if (moved.length > 0) {
                const patch = {};
                const now = new Date().toISOString();
                moved.forEach(i => {
                    patch[`lobbyReady.${i.uid}.discord`] = true;
                    patch[`lobbyReady.${i.uid}.discordAt`] = now;
                });
                await tournament.updateGameState(patch);
            }
        }

        pending = pending.filter(i => !TERMINAL_OUTCOMES.has(i.outcome));
        if (pending.length === 0) break;

        if (attempt >= RETRY_DELAYS_MS.length) {
            // Window exhausted — report whoever is still missing.
            pending.forEach(i => results.push({
                uid: i.uid, playerId: i.playerId, discordUserId: i.discordUserId,
                channelId: i.channelId, outcome: i.outcome, error: i.error
            }));
            break;
        }

        // A 429 tells us exactly how long to wait; otherwise use the schedule.
        // Note: honoring a large retry_after can push total elapsed time past
        // the nominal 2-minute ceiling — the ceiling here is attempt-bounded
        // (8 tries), not wall-clock-bounded. That's intentional: ignoring
        // Discord's stated wait would just trigger another rate limit.
        const rateLimited = pending
            .map(i => i.retryAfterMs)
            .filter(ms => Number.isFinite(ms));
        const wait = rateLimited.length > 0
            ? Math.max(...rateLimited)
            : RETRY_DELAYS_MS[attempt];
        await sleep(wait);
    }

    return { status: 'done', results };
}

module.exports = { handleCommand, RETRY_DELAYS_MS, TERMINAL_OUTCOMES };
