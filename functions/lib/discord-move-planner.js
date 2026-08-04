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

/**
 * Plan the moves for one command.
 *
 * @returns {{moves: Array, skipped: Array}} `moves` are actionable;
 *   `skipped` carry a terminal outcome and are reported without an API call.
 */
function planMoves({ match, teams, slot, direction, links, config }) {
    const sides = match.sides || match.teams || [];
    const uidByPlayerId = buildUidByPlayerId(teams);
    const slotChannels = (config.slotChannels || {})[String(slot)] || [];

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

    return { moves, skipped };
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
        if (String(command.slot) === 'challenge') {
            return phase.name === 'challenge_game';
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
