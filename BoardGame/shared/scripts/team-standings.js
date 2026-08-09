/**
 * team-standings.js — shared per-tournament standings computation.
 *
 * Single source of truth for turning one tournament's `gameState.teams[]`
 * into ranked standings rows. Extracted from full/scripts/statistics.js's
 * renderStandings() so every consumer (single-tournament statistics.html,
 * season-wide season-stats.html, and anything added later) computes a
 * team's score the same way instead of re-deriving it.
 *
 * IMPORTANT — do not "fix" the math without reading this first:
 * `team.points` already includes +1 per match win AND heart-hex income
 * (see docs/architecture/scoring.md). `victoryPts` below is a *display*
 * split of that total, derived as min(gamesWon, points) — never summed
 * on top of `points`, or every win gets counted twice.
 */

/**
 * Compute the standings row for a single team within one tournament's
 * gameState. Does not sort or rank — see computeTeamStandings() for that.
 *
 * @param {Object} team - one entry from gameState.teams
 * @param {Object} [gameState] - the tournament's full state (for hex count;
 *                                 omit if hex control isn't needed/available)
 */
function computeTeamStandingsRow(team, gameState) {
    const totalPts = team.points || 0;
    // Each win is worth +1 of the total; never add gamesWon on top of
    // points — that double-counts. This is a split of one number, not a sum
    // of two.
    const victoryPts = Math.min(team.gamesWon || 0, totalPts);
    const hexPts = Math.max(0, totalPts - victoryPts);
    const losses = team.gamesLost || 0;
    const played = team.gamesPlayed || (victoryPts + losses);
    const winRate = played > 0 ? (victoryPts / played) * 100 : 0;
    const hexCount = gameState?.board
        ? Object.values(gameState.board).filter(t => t === team.id).length
        : 0;

    return {
        teamId: team.id,
        name: team.name || `Team ${team.id}`,
        color: team.color || '#666666',
        totalPts,
        victoryPts,
        hexPts,
        losses,
        played,
        winRate,
        hexCount
    };
}

/**
 * Ranked standings rows for one tournament. Sort matches renderStandings():
 * total points desc, then gamesWon desc as a tiebreaker only (gamesWon is
 * never added into the point total itself).
 *
 * @param {Object} gameState - a single tournament's loaded gameState
 * @returns {Array} rows from computeTeamStandingsRow(), sorted best-first
 */
function computeTeamStandings(gameState) {
    const teams = gameState?.teams || [];
    const sorted = [...teams].sort((a, b) => {
        const totalA = a.points || 0;
        const totalB = b.points || 0;
        if (totalB !== totalA) return totalB - totalA;
        return (b.gamesWon || 0) - (a.gamesWon || 0);
    });
    return sorted.map(team => computeTeamStandingsRow(team, gameState));
}

if (typeof window !== 'undefined') {
    window.computeTeamStandingsRow = computeTeamStandingsRow;
    window.computeTeamStandings = computeTeamStandings;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeTeamStandingsRow, computeTeamStandings };
}
