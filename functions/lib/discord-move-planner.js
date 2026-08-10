/**
 * Pure planning decisions for Discord voice moves. No I/O, no Firestore,
 * no network — everything here is a function of its arguments so it can be
 * tested exhaustively without a harness.
 *
 * Two responsibilities:
 *   planMoves()      — who moves to which channel
 *   isCommandCurrent() — whether a queued command still reflects reality
 */

/**
 * Map roster player id -> Firebase uid across every team.
 *
 * Roster players may have no `uid` at all (onboarding-created players who
 * never registered an account). Those are simply absent from the map, and
 * planMoves treats them as unlinked — the same way
 * _getPlayersWhoMustReadyForSlot skips them for ready checks.
 */
function buildUidByPlayerId(teams) {
    const map = new Map();
    (teams || []).forEach(team => {
        (team.players || []).forEach(player => {
            if (player.id !== undefined && player.uid) {
                map.set(String(player.id), player.uid);
            }
        });
    });
    return map;
}

/**
 * Player ids on one side of a match, de-duplicated. Sides carry ids in
 * `playerIds`, in `players[].id`, or both depending on how the match was
 * created (auto-generated vs. hand-built vs. challenge).
 */
function sidePlayerIds(side) {
    const ids = new Set();
    (side.playerIds || []).forEach(id => ids.add(String(id)));
    (side.players || []).forEach(player => {
        if (player.id !== undefined) ids.add(String(player.id));
    });
    return [...ids];
}

const CHALLENGE_SLOT_RE = /^challenge[1-4]$/;

/**
 * Resolve the [sideA, sideB] channel pair for one slot, tolerating a
 * pre-4-slot-concurrency Discord config that only has `slotChannels.challenge`
 * (a single pair, from when challenge_game only ever ran one challenge at a
 * time — see phase-manager.js's CHALLENGE_SLOT_IDS doc comment).
 *
 * Additive, non-throwing degradation for in-flight tournaments:
 *   - challenge1 falls back to the legacy `challenge` pair when
 *     `challenge1` itself isn't configured yet.
 *   - challenge2-4 do NOT also fall back to that same legacy pair (that
 *     would silently pile every concurrent challenge's voice traffic into
 *     one pair of channels) — instead they resolve to no channel and a
 *     `warning` is returned so the caller can surface it (never dropped
 *     silently), telling the TD which slots still need a channel.
 *
 * @returns {{pair: [string,string]|Array, warning: string|null}}
 */
function resolveSlotChannelPair(config, slot) {
    const slotChannels = config.slotChannels || {};
    const key = String(slot);

    if (slotChannels[key]) return { pair: slotChannels[key], warning: null };

    if (CHALLENGE_SLOT_RE.test(key) && slotChannels.challenge) {
        if (key === 'challenge1') {
            return { pair: slotChannels.challenge, warning: null };
        }
        return {
            pair: [],
            warning: `slotChannels.${key} is not configured (only the legacy "challenge" pair exists, which aliases to challenge1 only) — players routed to ${key} will not be moved to a voice channel until it's configured in Discord Setup.`
        };
    }

    return { pair: [], warning: null };
}

/**
 * Plan the moves for one command.
 *
 * @returns {{moves: Array, skipped: Array, warning: string|null}} `moves`
 *   are actionable; `skipped` carry a terminal outcome and are reported
 *   without an API call; `warning` is set when the tournament's Discord
 *   config hasn't been extended for this slot yet (see
 *   resolveSlotChannelPair) — callers may surface it to the TD.
 */
function planMoves({ match, teams, slot, direction, links, config }) {
    const sides = match.sides || match.teams || [];
    const uidByPlayerId = buildUidByPlayerId(teams);
    const { pair: slotChannels, warning } = resolveSlotChannelPair(config, slot);
    if (warning) console.warn(`[discord-move-planner] ${warning}`);

    const moves = [];
    const skipped = [];

    sides.forEach((side, sideIndex) => {
        const channelId = direction === 'return'
            ? config.waitingRoomChannelId
            : slotChannels[sideIndex];

        sidePlayerIds(side).forEach(playerId => {
            const uid = uidByPlayerId.get(playerId) || null;

            if (!uid || !links[uid]?.discordUserId) {
                skipped.push({ playerId, uid, outcome: 'unlinked' });
                return;
            }
            if (!channelId) {
                skipped.push({ playerId, uid, outcome: 'no_channel' });
                return;
            }
            moves.push({
                playerId,
                uid,
                discordUserId: links[uid].discordUserId,
                channelId
            });
        });
    });

    return { moves, skipped, warning: warning || null };
}

/**
 * Is this command still worth acting on?
 *
 * Commands are queued by client code and executed asynchronously, so a slow
 * function start or a duplicate delivery can arrive after the world moved
 * on. Pulling players into a match that already started would yank them
 * mid-game, so `pull` requires its slot to still be in lobby.
 *
 * `force: true` (set only by the manual "move now" control) skips the check
 * entirely — its whole purpose is the straggler case this would reject.
 */
function isCommandCurrent(gameState, command) {
    if (command.force) return true;

    const phase = (gameState && gameState.currentPhase) || {};

    if (command.type === 'pull') {
        // Legacy flat pseudo-slot ('challenge', pre-4-slot-concurrency):
        // no per-slot lobby state to check against, just the phase itself.
        if (String(command.slot) === 'challenge') {
            return phase.name === 'challenge_game';
        }
        // New 4-slot challenges (challenge1-4) have real per-slot lobby
        // state now, same shape as matches_in_progress's slots.
        if (CHALLENGE_SLOT_RE.test(String(command.slot))) {
            return phase.name === 'challenge_game'
                && (phase.slots || {})[command.slot] === 'lobby';
        }
        return phase.name === 'matches_in_progress'
            && (phase.slots || {})[command.slot] === 'lobby';
    }

    if (command.type === 'return') {
        const entry = ((gameState && gameState.gameQueue) || [])
            .find(m => String(m.id) === String(command.matchId));
        return !!entry && entry.status === 'completed';
    }

    return true;
}

module.exports = { planMoves, isCommandCurrent };
