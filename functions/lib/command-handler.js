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

/**
 * Human label for a slot, matching the wording used elsewhere in the panel.
 */
function slotLabel(slot) {
    if (String(slot) === 'challenge') return 'the challenge match';
    return `match ${slot}`;
}

/**
 * Channel name for a status message, falling back to the raw id when the
 * cache has nothing for it (stale cache, or a channel that was never
 * refreshed) — a readable message beats a blocked one.
 */
function channelLabel(channelId, channelsById) {
    if (!channelId) return 'unknown channel';
    return (channelsById && channelsById[channelId]) || channelId;
}

/** Count of each non-"moved" outcome, e.g. "2 unlinked, 1 forbidden". */
function summariseOutcomes(items) {
    const counts = {};
    items.forEach(i => { counts[i.outcome] = (counts[i.outcome] || 0) + 1; });
    return Object.entries(counts).map(([outcome, n]) => `${n} ${outcome}`).join(', ') || 'none';
}

/** "" for 1, "s" for anything else — keeps "traveler(s)" out of the prose. */
function pl(n) {
    return n === 1 ? '' : 's';
}

/**
 * Reduce one command's results down to the facts a status message must
 * convey, independent of how those facts get phrased. Every template in
 * STATUS_TEMPLATES renders from this — it's the single place that decides
 * what "success"/"partial"/"failure"/"noop" mean and what data each carries.
 */
function computeStatusContext({ command, results, channelsById }) {
    const verb = command.type === 'return' ? 'Return' : 'Pull';
    const label = slotLabel(command.slot);

    const moved = results.filter(r => r.outcome === 'moved');
    const notMoved = results.filter(r => r.outcome !== 'moved');
    const total = results.length;

    const destinations = [...new Set(moved.map(r => channelLabel(r.channelId, channelsById)))];
    const destStr = destinations.join('/');
    const reasons = summariseOutcomes(notMoved);

    let category;
    if (total === 0) category = 'noop';
    else if (moved.length === total) category = 'success';
    else if (moved.length === 0) category = 'failure';
    else category = 'partial';

    return {
        category, verb, label,
        movedCount: moved.length, total, notMovedCount: notMoved.length,
        destinations, destStr, reasons
    };
}

/**
 * The bot's persona: Urho, a rune-spirit bound to the mountain since the
 * sealing of Gasmorah, kept on as the Kronikat's unpaid night clerk. He has
 * watched the deep halls for longer than he cares to say and now spends his
 * evenings shuffling "kulkijat" (travelers) between voice channels for a LAN
 * tournament he finds mildly beneath him. Dry, weary, occasionally wry —
 * a grumpy old caretaker, not a solemn prophecy. He always reports the real
 * outcome (who moved where, and why the rest didn't) before he editorializes.
 *
 * Organised by outcome category because the *shape* of what happened should
 * drive the phrasing, not just be filler wrapped around one template. Every
 * render() must surface the load-bearing facts for its category — that's
 * covered by the "every template still tells the truth" tests below.
 */
const STATUS_TEMPLATES = {
    success: [
        { id: 's01', render: ctx => `The halls shift as commanded: ${ctx.movedCount} traveler${pl(ctx.movedCount)} delivered to ${ctx.destStr} (${ctx.label}). The Kronikat note it and move on.` },
        { id: 's02', render: ctx => `Done. ${ctx.movedCount} kulkija${pl(ctx.movedCount)} walked the dark passage and came out the other side in ${ctx.destStr} (${ctx.label}). No fuss, no delay.` },
        { id: 's03', render: ctx => `${ctx.verb} complete — ${ctx.movedCount} traveler${pl(ctx.movedCount)} now stand in ${ctx.destStr} (${ctx.label}). The mountain barely stirred.` },
        { id: 's04', render: ctx => `Every name accounted for: ${ctx.movedCount}/${ctx.total} moved to ${ctx.destStr} (${ctx.label}). Even I am mildly impressed.` },
        { id: 's05', render: ctx => `The stone doors opened without argument this time. ${ctx.movedCount} traveler${pl(ctx.movedCount)} now in ${ctx.destStr} (${ctx.label}).` },
        { id: 's06', weight: 1.4, render: ctx => `${ctx.verb} complete, ${ctx.label}: all ${ctx.movedCount} sent through to ${ctx.destStr}. Logged, and back to staring at the walls.` },
        { id: 's07', render: ctx => `${ctx.movedCount} traveler${pl(ctx.movedCount)} pulled through the tunnels to ${ctx.destStr} (${ctx.label}) — no stragglers, no complaints. A rare evening.` },
        { id: 's08', render: ctx => `Recorded in the Kronikat: ${ctx.movedCount} of ${ctx.total} reached ${ctx.destStr} for ${ctx.label}, all present and accounted for.` },
        { id: 's09', render: ctx => `They moved when called. All ${ctx.movedCount} now wait in ${ctx.destStr} (${ctx.label}). Somewhere, a riimumestari is smiling.` },
        { id: 's10', render: ctx => `${ctx.verb} finished clean — ${ctx.destStr} now holds ${ctx.movedCount} more soul${pl(ctx.movedCount)} than it did a minute ago (${ctx.label}).` },
        { id: 's11', render: ctx => `No one got lost in the deep halls this round. ${ctx.movedCount} traveler${pl(ctx.movedCount)} safely in ${ctx.destStr} (${ctx.label}).` },
        { id: 's12', render: ctx => `The passage held true: ${ctx.movedCount}/${ctx.total} through to ${ctx.destStr}, ${ctx.label} accounted for. Write it down and move on.` },
        { id: 's13', render: ctx => `Full marks, ${ctx.label}: ${ctx.movedCount} traveler${pl(ctx.movedCount)} now standing in ${ctx.destStr}. Don't get used to it.` },
        { id: 's14', render: ctx => `${ctx.movedCount} kulkija${pl(ctx.movedCount)} answered the call without wandering off. All present in ${ctx.destStr} (${ctx.label}).` },
        { id: 's15', render: ctx => `The mountain remembers obedience fondly. ${ctx.movedCount} traveler${pl(ctx.movedCount)} delivered to ${ctx.destStr} for ${ctx.label}.` },
        { id: 's16', render: ctx => `Another clean entry for the Kronikat: ${ctx.movedCount}/${ctx.total} to ${ctx.destStr} (${ctx.label}). Nothing to report but success.` }
    ],
    partial: [
        { id: 'p01', render: ctx => `${ctx.verb} partial, ${ctx.label}: ${ctx.movedCount} of ${ctx.total} made it to ${ctx.destStr}. The rest (${ctx.notMovedCount}) are still missing — ${ctx.reasons}.` },
        { id: 'p02', render: ctx => `Half the tale is written. ${ctx.movedCount}/${ctx.total} reached ${ctx.destStr} (${ctx.label}); the rest didn't — ${ctx.reasons}.` },
        { id: 'p03', render: ctx => `Some kulkijat found the path, some didn't. ${ctx.movedCount} of ${ctx.total} now in ${ctx.destStr} (${ctx.label}). Left behind: ${ctx.reasons}.` },
        { id: 'p04', render: ctx => `The tunnels only opened partway — ${ctx.movedCount}/${ctx.total} through to ${ctx.destStr} for ${ctx.label}. Still stuck: ${ctx.reasons}.` },
        { id: 'p05', render: ctx => `Not everyone answered. ${ctx.movedCount} of ${ctx.total} moved to ${ctx.destStr} (${ctx.label}); the missing ${ctx.notMovedCount} — ${ctx.reasons}.` },
        { id: 'p06', render: ctx => `A mixed page for the Kronikat: ${ctx.movedCount}/${ctx.total} arrived at ${ctx.destStr} (${ctx.label}). The rest: ${ctx.reasons}.` },
        { id: 'p07', render: ctx => `${ctx.movedCount} of ${ctx.total} traveler${pl(ctx.movedCount)} made it through to ${ctx.destStr}; the rest are still wandering the dark (${ctx.label}) — ${ctx.reasons}.` },
        { id: 'p08', render: ctx => `Progress, not victory. ${ctx.movedCount}/${ctx.total} at ${ctx.destStr} for ${ctx.label}. Unfinished business: ${ctx.reasons}.` },
        { id: 'p09', render: ctx => `The halls took some and refused others. ${ctx.movedCount} of ${ctx.total} landed in ${ctx.destStr} (${ctx.label}); refused entry: ${ctx.reasons}.` },
        { id: 'p10', weight: 1.4, render: ctx => `${ctx.verb} partial, ${ctx.label}: ${ctx.movedCount}/${ctx.total} to ${ctx.destStr}. What's left: ${ctx.reasons}. The mountain shrugs.` },
        { id: 'p11', render: ctx => `Some found the way to ${ctx.destStr}, ${ctx.movedCount} of ${ctx.total} (${ctx.label}). Others are still out there — ${ctx.reasons}.` },
        { id: 'p12', render: ctx => `${ctx.verb} limped through: ${ctx.movedCount}/${ctx.total} to ${ctx.destStr} (${ctx.label}), ${ctx.notMovedCount} left behind — ${ctx.reasons}.` },
        { id: 'p13', render: ctx => `Half-finished work, like most things down here. ${ctx.movedCount} of ${ctx.total} now in ${ctx.destStr} (${ctx.label}); stragglers: ${ctx.reasons}.` },
        { id: 'p14', render: ctx => `The Kronikat records an uneven page: ${ctx.movedCount}/${ctx.total} reached ${ctx.destStr} (${ctx.label}). The rest — ${ctx.reasons}.` }
    ],
    failure: [
        { id: 'f01', render: ctx => `${ctx.verb} failed outright, ${ctx.label}: none of the ${ctx.total} traveler${pl(ctx.total)} moved. Reasons carved plainly: ${ctx.reasons}.` },
        { id: 'f02', render: ctx => `Nothing moved. Not one of the ${ctx.total} kulkija${pl(ctx.total)} reached the halls for ${ctx.label} — ${ctx.reasons}.` },
        { id: 'f03', render: ctx => `The tunnels stayed shut. Zero of ${ctx.total} moved (${ctx.label}). Why: ${ctx.reasons}.` },
        { id: 'f04', render: ctx => `A blank page in the Kronikat tonight — ${ctx.total} attempted for ${ctx.label}, ${ctx.total} refused. Cause: ${ctx.reasons}.` },
        { id: 'f05', render: ctx => `Complete stillness. ${ctx.total} were called for ${ctx.label}; none arrived. ${ctx.reasons}.` },
        { id: 'f06', render: ctx => `The mountain didn't budge. 0 of ${ctx.total} moved (${ctx.label}) — ${ctx.reasons}.` },
        { id: 'f07', render: ctx => `Every path was blocked tonight, ${ctx.label}. 0/${ctx.total} moved. ${ctx.reasons}.` },
        { id: 'f08', render: ctx => `An empty hall waits still. None of the ${ctx.total} traveler${pl(ctx.total)} made it through for ${ctx.label} — ${ctx.reasons}.` },
        { id: 'f09', render: ctx => `Nothing to show for this one, ${ctx.label}: ${ctx.total} attempted, ${ctx.total} failed. ${ctx.reasons}.` },
        { id: 'f10', render: ctx => `The old wards held them all back. 0 of ${ctx.total} moved (${ctx.label}). ${ctx.reasons}.` },
        { id: 'f11', render: ctx => `A wasted trip for everyone, ${ctx.label} — none of the ${ctx.total} traveler${pl(ctx.total)} got through. ${ctx.reasons}.` },
        { id: 'f12', weight: 1.4, render: ctx => `${ctx.verb} failed, ${ctx.label}: 0/${ctx.total} moved. ${ctx.reasons}. The mountain has seen worse.` }
    ],
    noop: [
        { id: 'n01', render: ctx => `${ctx.verb} called for ${ctx.label}, but the halls were already empty. Nobody to move.` },
        { id: 'n02', render: ctx => `Nothing to record, ${ctx.label} — no one was waiting to be moved.` },
        { id: 'n03', render: ctx => `An empty roster for ${ctx.label}. The mountain rests a while longer.` },
        { id: 'n04', render: ctx => `No travelers to summon this round (${ctx.label}). The Kronikat page stays blank.` },
        { id: 'n05', render: ctx => `${ctx.label}: nobody was waiting. Even the old stones found that dull.` },
        { id: 'n06', render: ctx => `Quiet halls, ${ctx.label} — nothing to move, nothing to log.` },
        { id: 'n07', render: ctx => `No one to ${ctx.verb.toLowerCase()} for ${ctx.label} this time. A rare still moment.` },
        { id: 'n08', render: ctx => `The call went out to an empty room (${ctx.label}). Nothing happened, nothing to note.` }
    ]
};

/**
 * Tracks the last template id used per category (module-scoped, so a warm
 * Cloud Function instance keeps some memory between invocations) so the
 * same line never fires twice in a row for the same outcome shape.
 * `resetStatusMessageVariety` exists purely so tests get a clean slate.
 */
let lastUsedByCategory = {};

function resetStatusMessageVariety() {
    lastUsedByCategory = {};
}

/** Weighted random pick, weight defaulting to 1 when a template omits it. */
function weightedPick(list) {
    const totalWeight = list.reduce((sum, t) => sum + (t.weight || 1), 0);
    let r = Math.random() * totalWeight;
    for (const t of list) {
        r -= (t.weight || 1);
        if (r <= 0) return t;
    }
    return list[list.length - 1]; // floating-point fallback, never hit in practice
}

/**
 * Picks a template for a category, filtering out whichever id fired last
 * time so back-to-back messages never repeat verbatim (when the category
 * has more than one template — a category with just one has nowhere else
 * to go).
 */
function pickTemplate(category) {
    const list = STATUS_TEMPLATES[category];
    const avoidId = lastUsedByCategory[category];
    const candidates = list.length > 1 ? list.filter(t => t.id !== avoidId) : list;
    const chosen = weightedPick(candidates);
    lastUsedByCategory[category] = chosen.id;
    return chosen;
}

/**
 * Turn one command's results into the text posted to the status channel.
 * Delegates the facts to computeStatusContext and the phrasing to Urho's
 * template pool — the channel is for a human glancing at what the bot just
 * did (and reads a little personality while they're at it), not a log.
 */
// A TD skimming the status channel mid-event needs to tell success from
// failure at a glance, before reading any prose -- the persona's flavor
// text alone isn't enough for that (severity isn't reliably inferable from
// tone). Same categories buildStatusMessage/computeStatusContext use.
const STATUS_SEVERITY_EMOJI = {
    success: '✅',   // white_check_mark
    partial: '⚠️', // warning
    failure: '❌',   // x
    noop: 'ℹ️',    // information_source
};

function buildStatusMessage({ command, results, channelsById }) {
    const ctx = computeStatusContext({ command, results, channelsById });
    const template = pickTemplate(ctx.category);
    const emoji = STATUS_SEVERITY_EMOJI[ctx.category] || '';
    return emoji ? `${emoji} ${template.render(ctx)}` : template.render(ctx);
}

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

    await postStatusMessage({ tournament, rest, config, command, results });

    return { status: 'done', results };
}

/**
 * Best-effort status report after a pull/return batch finishes. Never
 * throws into the caller: a status-message failure is a nice-to-have going
 * missing, not a reason to mark the whole move command as failed (players
 * were already moved or not — this only narrates it).
 *
 * Guarded with typeof checks because both `rest` and the `tournament`
 * adapter are plain objects in tests, and older fakes predate
 * sendMessage/getChannelCache.
 */
async function postStatusMessage({ tournament, rest, config, command, results }) {
    if (!config.statusChannelId) return;
    if (typeof rest.sendMessage !== 'function') return;

    try {
        const channels = typeof tournament.getChannelCache === 'function'
            ? await tournament.getChannelCache()
            : [];
        const channelsById = {};
        (channels || []).forEach(c => { channelsById[c.channelId] = c.name; });

        const content = buildStatusMessage({ command, results, channelsById });
        await rest.sendMessage({ channelId: config.statusChannelId, content });
    } catch (err) {
        console.error('[Discord] Status message failed', err);
    }
}

module.exports = {
    handleCommand, RETRY_DELAYS_MS, TERMINAL_OUTCOMES,
    buildStatusMessage, computeStatusContext, STATUS_TEMPLATES, resetStatusMessageVariety
};
