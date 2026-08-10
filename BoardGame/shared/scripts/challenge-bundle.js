/**
 * CHALLENGE BUNDLE — multi-hex / multi-dispute challenge resolution (Round 12B)
 *
 * Background: a "dispute" is one team (the challenger) contesting a heart
 * hex currently held by another team (the defender). Normally a challenge
 * game resolves exactly one dispute. This module implements *bundling* —
 * combining several separate, unrelated disputes (different challenger,
 * different defender, different hex — not necessarily the same two teams)
 * into ONE challenge game, per the design worked out in
 * docs/guides/EVENT_BUG_REPORTS.md ("Challenge matches can't run
 * concurrently, and can only be logged against one contested hex").
 *
 * Resolution mechanic: treat the bundled disputes as a graph — each dispute
 * is an edge (challenger -> defender). Bipartition the disputing teams into
 * two sides such that every dispute's challenger and defender land on
 * OPPOSITE sides (a standard 2-coloring / bipartite check via BFS). One
 * game is played between the two sides; whichever side wins, every dispute
 * whose CHALLENGER was on the winning side succeeds (challenger takes the
 * hex), every dispute whose DEFENDER was on the winning side keeps their
 * hex (challenge fails). This only works when the dispute graph has no odd
 * cycle — bipartitionDisputes() detects and reports that case by name.
 *
 * Roster fill: the match format (e.g. 5v5) needs full rosters on both
 * sides. The disputing teams' full rosters go on their bipartitioned side;
 * any remaining seats are filled from UNINVOLVED teams (not party to any
 * bundled dispute), one player per side per team — the same "split team"
 * (hajotettu) mechanic shared/scripts/match-suggester.js already uses for
 * the normal 10-match rotation, reused here rather than reimplemented.
 *
 * Pure logic only — no DOM, no Firebase, no gameState mutation. Exposed as
 * window.ChallengeBundle in the browser and module.exports in Node (same
 * dual-export pattern as shared/scripts/board-module.js) so it can be unit
 * tested directly and required from admin.js.
 */

/**
 * Bipartition a list of disputes into two opposing sides.
 *
 * @param {Array<{challengerTeamId: *, defenderTeamId: *, hexCoord: string}>} disputes
 * @returns {{sideA: Array, sideB: Array, disputes: Array} | {error: {type: string, message: string, [key: string]: *}}}
 */
function bipartitionDisputes(disputes) {
    if (!Array.isArray(disputes) || disputes.length === 0) {
        return { error: { type: 'empty', message: 'No disputes provided to bundle.' } };
    }

    for (const d of disputes) {
        if (d == null || d.challengerTeamId == null || d.defenderTeamId == null || !d.hexCoord) {
            return {
                error: {
                    type: 'invalid-dispute',
                    message: 'Every bundled dispute needs a challenger team, a defender team, and a contested hex.',
                    dispute: d
                }
            };
        }
        if (String(d.challengerTeamId) === String(d.defenderTeamId)) {
            return {
                error: {
                    type: 'self-dispute',
                    message: `Team ${d.challengerTeamId} cannot dispute its own hex (${d.hexCoord}).`,
                    dispute: d
                }
            };
        }
    }

    // Same hex can't appear twice in one bundle — the outcome would be
    // ambiguous (two different resolutions for one physical hex).
    const seenHexes = new Map();
    for (const d of disputes) {
        if (seenHexes.has(d.hexCoord)) {
            return {
                error: {
                    type: 'duplicate-hex',
                    message: `Hex ${d.hexCoord} is disputed more than once in this bundle — each hex can only appear once.`,
                    hexCoord: d.hexCoord
                }
            };
        }
        seenHexes.set(d.hexCoord, d);
    }

    // Build an undirected adjacency graph over team keys (stringified, to
    // tolerate mixed number/string team ids the way the rest of the
    // codebase does — see MatchSuggester.getTeamById). Keep the ORIGINAL
    // (non-stringified) value for output.
    const adj = new Map(); // teamKey -> [{ other: teamKey, disputeIndex }]
    const origValue = new Map(); // teamKey -> original id value

    const addNode = (id) => {
        const key = String(id);
        if (!origValue.has(key)) origValue.set(key, id);
        if (!adj.has(key)) adj.set(key, []);
        return key;
    };

    disputes.forEach((d, idx) => {
        const a = addNode(d.challengerTeamId);
        const b = addNode(d.defenderTeamId);
        adj.get(a).push({ other: b, disputeIndex: idx });
        adj.get(b).push({ other: a, disputeIndex: idx });
    });

    const color = new Map(); // teamKey -> 0 | 1
    const parent = new Map(); // teamKey -> teamKey (BFS tree parent)

    for (const startKey of adj.keys()) {
        if (color.has(startKey)) continue;
        color.set(startKey, 0);
        const queue = [startKey];
        while (queue.length > 0) {
            const uKey = queue.shift();
            for (const { other: vKey } of adj.get(uKey)) {
                if (!color.has(vKey)) {
                    color.set(vKey, 1 - color.get(uKey));
                    parent.set(vKey, uKey);
                    queue.push(vKey);
                } else if (color.get(vKey) === color.get(uKey)) {
                    const cycleKeys = _reconstructOddCycle(uKey, vKey, parent);
                    const cycleTeamIds = cycleKeys.map(k => origValue.get(k));
                    const cycleLabel = cycleTeamIds.map(id => `Team ${id}`).join(' → ') +
                        ` → Team ${cycleTeamIds[0]}`;
                    return {
                        error: {
                            type: 'odd-cycle',
                            message: `These disputes form an odd cycle and can't be split into two sides: ${cycleLabel}. ` +
                                `Remove one dispute from the cycle, or play it as a separate challenge.`,
                            teamIds: cycleTeamIds
                        }
                    };
                }
            }
        }
    }

    const sideA = [];
    const sideB = [];
    for (const [key, c] of color.entries()) {
        (c === 0 ? sideA : sideB).push(origValue.get(key));
    }

    return { sideA, sideB, disputes: disputes.map(d => ({ ...d })) };
}

/**
 * Given two BFS-tree-conflicting nodes (an edge whose endpoints ended up
 * the same color), walk their parent chains back to the lowest common
 * ancestor and splice together the odd cycle that caused the conflict.
 * @returns {string[]} team keys in cycle order, e.g. ['1','2','3'] for
 *   Team1 -> Team2 -> Team3 -> Team1.
 */
function _reconstructOddCycle(uKey, vKey, parent) {
    const pathToRoot = (key) => {
        const path = [key];
        let cur = key;
        while (parent.has(cur)) {
            cur = parent.get(cur);
            path.push(cur);
        }
        return path;
    };

    const uPath = pathToRoot(uKey); // [u, ..., root]
    const vPath = pathToRoot(vKey); // [v, ..., root]
    const uSet = new Set(uPath);

    let lca = uPath[uPath.length - 1];
    for (const node of vPath) {
        if (uSet.has(node)) { lca = node; break; }
    }

    const uSide = uPath.slice(0, uPath.indexOf(lca) + 1); // [u, ..., lca]
    const vSide = vPath.slice(0, vPath.indexOf(lca) + 1); // [v, ..., lca]

    // Cycle: lca -> ... -> u -> v -> ... -> lca (last "-> lca" implied)
    const cycle = [...uSide.slice().reverse(), ...vSide.slice(0, vSide.length - 1)];
    return cycle;
}

/**
 * Parse a symmetric "NvN" format string (the only shape the app's match
 * formats ever produce, e.g. getCalculatedPlayType() in admin.js) into the
 * per-side player count. Returns null for anything else, including
 * asymmetric formats — bundled challenges don't support those.
 * @param {string} format
 * @returns {number|null}
 */
function parseSymmetricFormat(format) {
    if (typeof format !== 'string') return null;
    const m = format.trim().match(/^(\d+)\s*v\s*(\d+)$/i);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a !== b || a <= 0) return null;
    return a;
}

/**
 * Fill a bundled challenge's roster to the chosen format: the disputing
 * teams' full rosters go on their bipartitioned side, and any remaining
 * seats are filled one-player-per-side from uninvolved teams — this is
 * exactly the "split team" (hajotettu) mechanic the normal 10-match
 * rotation uses, so this function REUSES it rather than reimplementing
 * it: it builds a MatchSuggester over a synthetic { teams: allTeams }
 * gameState and calls its getTeamById()/getPlayersFromTeam() (the same
 * calls buildRotationMatch() makes at shared/scripts/match-suggester.js
 * lines ~176-198) to fetch each team's roster and mark split players.
 *
 * @param {Object} args
 * @param {Array} args.sideATeamIds - team ids on bipartition side A
 * @param {Array} args.sideBTeamIds - team ids on bipartition side B
 * @param {Array} args.allTeams - full gameState.teams array ({id, name, color, players: [{id/uid, name}]})
 * @param {string} args.format - e.g. "5v5"
 * @returns {{sideAPlayers, sideBPlayers, splitTeamIds, perSide} | {error}}
 */
function fillBundleRoster({ sideATeamIds, sideBTeamIds, allTeams, format }) {
    const perSide = parseSymmetricFormat(format);
    if (perSide == null) {
        return {
            error: {
                type: 'bad-format',
                message: `Unrecognized or asymmetric match format "${format}" — bundled challenges need a symmetric format like "3v3".`
            }
        };
    }

    const MatchSuggesterCtor = (typeof window !== 'undefined' && window.MatchSuggester) ||
        (typeof require !== 'undefined' ? require('./match-suggester.js') : null);
    if (!MatchSuggesterCtor) {
        return { error: { type: 'internal', message: 'MatchSuggester is not available — cannot fill bundled roster.' } };
    }

    const teams = allTeams || [];
    const suggester = new MatchSuggesterCtor({ teams, gameHistory: [], gameQueue: [] });

    const markSplit = (players, isSplit) => players.map(p => ({ ...p, isSplit: !!isSplit }));

    const sideAPlayers = [];
    (sideATeamIds || []).forEach(id => sideAPlayers.push(...markSplit(suggester.getPlayersFromTeam(id), false)));
    const sideBPlayers = [];
    (sideBTeamIds || []).forEach(id => sideBPlayers.push(...markSplit(suggester.getPlayersFromTeam(id), false)));

    if (sideAPlayers.length > perSide || sideBPlayers.length > perSide) {
        return {
            error: {
                type: 'format-too-small',
                message: `The disputing teams' full rosters (${sideAPlayers.length} vs ${sideBPlayers.length} players) don't fit the ${format} format — choose a larger format.`,
                sideACount: sideAPlayers.length,
                sideBCount: sideBPlayers.length,
                perSide
            }
        };
    }

    const involved = new Set([...(sideATeamIds || []), ...(sideBTeamIds || [])].map(String));
    const uninvolvedTeams = teams.filter(t => !involved.has(String(t.id)));

    // Same one-player-per-side split as MatchSuggester.buildRotationMatch():
    // getPlayersFromTeam(splitTeamId)[0] -> side A, [1] -> side B.
    const splitTeamIds = [];
    let ti = 0;
    while ((sideAPlayers.length < perSide || sideBPlayers.length < perSide) && ti < uninvolvedTeams.length) {
        const team = uninvolvedTeams[ti++];
        const players = suggester.getPlayersFromTeam(team.id);
        let used = false;

        if (sideAPlayers.length < perSide && players[0]) {
            sideAPlayers.push({ ...players[0], isSplit: true });
            used = true;
        }
        if (sideBPlayers.length < perSide && players[1]) {
            sideBPlayers.push({ ...players[1], isSplit: true });
            used = true;
        } else if (sideBPlayers.length < perSide && players[0] && !used) {
            // Team has only one player and side A didn't need it (or the
            // team had no player[1]) — give the lone player to side B.
            sideBPlayers.push({ ...players[0], isSplit: true });
            used = true;
        }

        if (used) splitTeamIds.push(team.id);
    }

    if (sideAPlayers.length < perSide || sideBPlayers.length < perSide) {
        return {
            error: {
                type: 'not-enough-players',
                message: `Not enough uninvolved players to fill a ${format} bundled challenge (have ${sideAPlayers.length}/${perSide} on Side A, ${sideBPlayers.length}/${perSide} on Side B). Reduce the format or bundle fewer disputes.`,
                sideACount: sideAPlayers.length,
                sideBCount: sideBPlayers.length,
                perSide
            }
        };
    }

    return { sideAPlayers, sideBPlayers, splitTeamIds, perSide };
}

/**
 * Apply a bipartition + game result to every dispute in the bundle.
 * @param {Object} args
 * @param {Array} args.disputes - [{challengerTeamId, defenderTeamId, hexCoord}]
 * @param {Array} args.sideA - team ids on side A (from bipartitionDisputes)
 * @param {Array} args.sideB - team ids on side B (from bipartitionDisputes)
 * @param {'A'|'B'} args.winningSide
 * @returns {Array<{hexCoord, challengerTeamId, defenderTeamId, outcome: 'challenger_won'|'defender_won', newOwnerTeamId}>}
 */
function resolveBundleDisputes({ disputes, sideA, sideB, winningSide }) {
    const winners = new Set((winningSide === 'A' ? sideA : sideB).map(String));
    return (disputes || []).map(d => {
        const challengerWon = winners.has(String(d.challengerTeamId));
        return {
            hexCoord: d.hexCoord,
            challengerTeamId: d.challengerTeamId,
            defenderTeamId: d.defenderTeamId,
            outcome: challengerWon ? 'challenger_won' : 'defender_won',
            newOwnerTeamId: challengerWon ? d.challengerTeamId : d.defenderTeamId
        };
    });
}

/**
 * Resolve a bundled challenge's outcome DIRECTLY from a confirmed queue
 * entry + the winner index the confirm UI passes (0 or 1 — the same
 * `winnerIndex` argument `confirmResult(winnerIndex)` /
 * `ResultManager.confirmResult(winnerIndex)` always take, picked from
 * `queueEntry.teams[winnerIndex]`).
 *
 * This function is the SINGLE place that encodes the "queue entry's two
 * team slots map to bipartition sideA/sideB positionally" contract:
 * `confirmChallengeBundleSetup()` always builds `queueEntry.teams` as
 * `[TEAM_A, TEAM_B]` (index 0 = TEAM_A = bundleSideA, index 1 = TEAM_B =
 * bundleSideB) — see admin.js. Both admin.js's confirmResult() and
 * result-manager.js's ResultManager (god.html's separate confirm path)
 * call this ONE function instead of each re-deriving `winnerIndex === 0
 * ? 'A' : 'B'` inline, so the mapping is asserted by real unit tests
 * (challenge-bundle.test.js) rather than trusted duplicated inline logic.
 *
 * @param {Object} queueEntry - a gameQueue entry with isBundle:true
 * @param {Array} queueEntry.bundleDisputes
 * @param {Array} queueEntry.bundleSideA
 * @param {Array} queueEntry.bundleSideB
 * @param {number} winnerIndex - 0 or 1, index into queueEntry.teams
 * @returns {Array<{hexCoord, challengerTeamId, defenderTeamId, outcome, newOwnerTeamId}>}
 */
function resolveBundleFromQueueEntry(queueEntry, winnerIndex) {
    if (winnerIndex !== 0 && winnerIndex !== 1) {
        throw new Error(`resolveBundleFromQueueEntry: winnerIndex must be 0 or 1 for a 2-sided bundle, got ${winnerIndex}`);
    }
    const winningSide = winnerIndex === 0 ? 'A' : 'B';
    return resolveBundleDisputes({
        disputes: queueEntry.bundleDisputes || [],
        sideA: queueEntry.bundleSideA || [],
        sideB: queueEntry.bundleSideB || [],
        winningSide
    });
}

/**
 * Convenience one-shot: validate + bipartition + fill roster. Used by the
 * admin UI to go from "list of disputes the admin picked" straight to
 * "queue-entry-ready teams array", surfacing the first error encountered.
 * @param {Object} args
 * @param {Array} args.disputes
 * @param {Array} args.allTeams
 * @param {string} args.format
 */
function buildChallengeBundle({ disputes, allTeams, format }) {
    const bipartition = bipartitionDisputes(disputes);
    if (bipartition.error) return { error: bipartition.error };

    const roster = fillBundleRoster({
        sideATeamIds: bipartition.sideA,
        sideBTeamIds: bipartition.sideB,
        allTeams,
        format
    });
    if (roster.error) return { error: roster.error };

    return {
        sideA: bipartition.sideA,
        sideB: bipartition.sideB,
        disputes: bipartition.disputes,
        sideAPlayers: roster.sideAPlayers,
        sideBPlayers: roster.sideBPlayers,
        splitTeamIds: roster.splitTeamIds,
        perSide: roster.perSide
    };
}

const ChallengeBundle = {
    bipartitionDisputes,
    parseSymmetricFormat,
    fillBundleRoster,
    resolveBundleDisputes,
    resolveBundleFromQueueEntry,
    buildChallengeBundle
};

if (typeof window !== 'undefined') {
    window.ChallengeBundle = ChallengeBundle;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChallengeBundle;
}
