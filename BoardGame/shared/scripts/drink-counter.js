/**
 * DrinkCounter — pure derivations for the LAN drink counter.
 *
 * Counts live in a `drinkCounts` map on the tournament document, keyed by
 * Firebase Auth uid, mirroring the shape and write path of `lobbyReady`:
 *
 *   drinkCounts: {
 *     "<uid>": { soft: 3, beer: 2, name: "Wustra", teamId: 1, updatedAt: "<iso>" }
 *   }
 *
 * `name` and `teamId` are written for debuggability only. Everything
 * displayed resolves through the live roster instead, so a rename or a
 * roster swap never leaves a stale name on the big screen.
 *
 * DELIBERATELY DRINK-GENERIC. Two types — a soft drink and a beer — summed
 * into one total. Not an alcohol tracker (2026-08-05 developer note), and it
 * never reads or writes anything scoring-related.
 *
 * Pure: no DOM, no Firestore, no globals. Tested in
 * dev/tests/drink-counter.test.js.
 */

const DRINK_TYPES = [
    { id: 'soft', label: 'Soft drink', icon: '🥤' },
    { id: 'beer', label: 'Beer', icon: '🍺' }
];

/**
 * Total drinks in one drinkCounts entry, across every type.
 * @param {Object|undefined} entry
 * @returns {number}
 */
function totalFor(entry) {
    if (!entry) return 0;
    return DRINK_TYPES.reduce((sum, type) => sum + (Number(entry[type.id]) || 0), 0);
}

/**
 * Build a uid -> {name, color, teamName} map from the live roster.
 * @param {Object|null} gameData
 * @returns {Map<string, {name: string, color: string, teamName: string}>}
 */
function _rosterByUid(gameData) {
    const map = new Map();
    (gameData?.teams || []).forEach(team => {
        (team.players || []).forEach(player => {
            if (player.uid) {
                map.set(player.uid, {
                    name: player.name || 'Player',
                    color: team.color || '#c8b37e',
                    teamName: team.name || `Team ${team.id}`
                });
            }
        });
    });
    return map;
}

/**
 * Who has logged the most drinks? Highest first.
 *
 * Players with nothing logged are omitted — this is the break-screen "top
 * drinkers" list, and a tail of zeroes says nothing. (The statistics report
 * keeps them; see buildDrinkPerformanceReport.)
 *
 * @param {Object|null} gameData
 * @param {number} [limit] - omit for the whole list
 * @returns {Array<{uid: string, name: string, color: string, teamName: string, total: number}>}
 */
function buildDrinkLeaderboard(gameData, limit) {
    const roster = _rosterByUid(gameData);
    const counts = gameData?.drinkCounts || {};

    const rows = Object.keys(counts)
        .filter(uid => roster.has(uid))
        .map(uid => ({ uid, ...roster.get(uid), total: totalFor(counts[uid]) }))
        .filter(row => row.total > 0)
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return limit ? rows.slice(0, limit) : rows;
}

/**
 * Drinks against match record, for the post-tournament report.
 *
 * Counts every COMPLETED queue entry a player appears in — challenge matches
 * and split-format matches included. That is intentionally looser than the
 * scoring rules in docs/architecture/scoring.md, which exclude some of those
 * from points. This is a fun stat, not a standings table, and it must never
 * be read as one.
 *
 * The whole roster is included, drinkers or not: "logged nothing, won
 * everything" is a row worth seeing.
 *
 * @param {Object|null} gameData
 * @returns {Array<{uid, name, color, teamName, drinks, played, wons, winRate}>}
 *          sorted by drinks descending; winRate is a 0-100 number, or null
 *          when the player has no completed matches.
 */
function buildDrinkPerformanceReport(gameData) {
    const roster = _rosterByUid(gameData);
    const counts = gameData?.drinkCounts || {};
    const registry = gameData?.players || {};

    const record = new Map(); // uid -> { played, wons }
    (gameData?.gameQueue || []).forEach(match => {
        if (match.status !== 'completed') return;
        (match.teams || []).forEach((side, sideIndex) => {
            (side.playerIds || []).forEach(playerId => {
                const uid = registry[playerId]?.uid;
                if (!uid || !roster.has(uid)) return;
                const current = record.get(uid) || { played: 0, wons: 0 };
                current.played += 1;
                if (sideIndex === match.winnerIndex) current.wons += 1;
                record.set(uid, current);
            });
        });
    });

    return [...roster.entries()]
        .map(([uid, info]) => {
            const { played = 0, wons = 0 } = record.get(uid) || {};
            return {
                uid,
                ...info,
                drinks: totalFor(counts[uid]),
                played,
                wons,
                winRate: played > 0 ? Math.round((wons / played) * 100) : null
            };
        })
        .sort((a, b) => b.drinks - a.drinks || a.name.localeCompare(b.name));
}

const DrinkCounter = { DRINK_TYPES, totalFor, buildDrinkLeaderboard, buildDrinkPerformanceReport };

if (typeof window !== 'undefined') {
    window.DrinkCounter = DrinkCounter;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DrinkCounter;
}
