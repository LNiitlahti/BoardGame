/**
 * ============================================================================
 * SEASON-STATS.JS — Season-Wide Standings & Statistics
 * ============================================================================
 *
 * Combines the standings of every tournament linked to a season
 * (season.tournamentIds[]) into one ranked season leaderboard.
 *
 * Team identity across tournaments has no persistent id — every tournament
 * builds its own gameState.teams array from scratch (see full/setup.html's
 * addTeam(): `id: teams.length + 1`). Within a single season the org's
 * convention is that a team keeps its NAME across the season's tournaments,
 * so that's what season standings match on. See aggregateSeasonStandings()
 * below for how same-tournament name collisions are kept from being merged
 * into each other (never silently combine two different teams' stats).
 *
 * Per-tournament standings math (points/wins/losses/win-rate) comes from
 * the shared computeTeamStandings() helper in
 * shared/scripts/team-standings.js — the exact function statistics.js uses
 * for the single-tournament table, so the two views can't disagree.
 *
 * ----------------------------------------------------------------------
 * PLAYER-LEVEL STATS (v2 addition)
 * ----------------------------------------------------------------------
 * Team standings above match teams across tournaments by NAME because teams
 * have no persistent id. Players are different: every roster slot
 * (team.players[]) that has been linked to a real account carries a stable
 * Firebase Auth `uid`, and the per-tournament players registry
 * (tournament.players[playerId], the exact map gameHistory's
 * winningPlayerIds/losingPlayerIds reference — see
 * shared/scripts/player-utils.js migrateToNormalizedPlayers()) mirrors that
 * uid onto every entry. So all player-level aggregation below keys
 * EXCLUSIVELY on uid, never on name (two different real people can share a
 * name) and never on the per-tournament playerId (that's a fresh id every
 * tournament, like team.id). A roster slot with no uid is an unlinked
 * placeholder — it's counted in team-level standings (it still played
 * matches for its team) but excluded from player-level stats entirely,
 * since there's no stable identity to attribute it to.
 *
 * Points are a TEAM-level number only (team.points = win credit + heart-hex
 * income, see shared/scripts/team-standings.js) — gameHistory never records
 * a points value per player, so there is no real "points contributed by
 * this player" metric to compute. Player stats below are therefore built
 * only from what gameHistory actually attributes to individual players:
 * match participation and win/loss (winningPlayerIds / losingPlayerIds).
 */

const MIN_DURATION_MINUTES = 5; // matches statistics.js's avg-duration filter

// A pair needs at least this many matches together (same team, same
// tournament) before it's eligible to be surfaced as a "best teammates"
// result — otherwise a single lucky 1-0 pairing would outrank a proven
// 15-8 one. Chosen as a light floor, not a hard analytical cutoff: pairs
// below it are still computed, just not offered as the headline result.
const MIN_TEAMMATE_GAMES_TOGETHER = 3;

// Same idea for the MVP ranking and the "most improved" stat below — a
// tiny sample shouldn't be able to win on a fluke.
const MIN_MVP_GAMES = 3;
const MIN_IMPROVEMENT_GAMES = 4;

let currentSeason = null;
let currentTournaments = [];

// Which tournament ids are currently included in every displayed
// aggregation. Rebuilt to "all checked" every time a season loads.
let selectedTournamentIds = new Set();

let currentPlayerLeaderboard = 'wins';
let currentPlayerRows = []; // cached from the last renderSeasonStats() pass, reused by leaderboard tab switches

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('firebase-ready', async () => {
    await populateSeasonSelector();

    const urlParams = new URLSearchParams(window.location.search);
    const requestedSeasonId = urlParams.get('seasonId');

    let seasonIdToLoad = requestedSeasonId;
    if (!seasonIdToLoad) {
        // Same fallback as home.html's season panel: prefer the active
        // season, else the most recently created one.
        seasonIdToLoad = await findDefaultSeasonId();
    }

    if (seasonIdToLoad) {
        document.getElementById('seasonSelect').value = seasonIdToLoad;
        await loadSeason(seasonIdToLoad);
    }

    document.getElementById('loadingOverlay').classList.add('hidden');
});

async function populateSeasonSelector() {
    const select = document.getElementById('seasonSelect');
    try {
        const db = window.firebaseDB;
        const snapshot = await db.collection('seasons').orderBy('createdAt', 'desc').get();
        select.innerHTML = '<option value="">Select a season...</option>';
        snapshot.forEach(doc => {
            const data = doc.data();
            const opt = document.createElement('option');
            opt.value = doc.id;
            const count = data.tournamentIds?.length || 0;
            opt.textContent = `${data.name || doc.id} (${count} tournament${count === 1 ? '' : 's'})`;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error('[SeasonStats] Error loading seasons list:', error);
    }
}

async function findDefaultSeasonId() {
    try {
        const db = window.firebaseDB;
        const activeSnapshot = await db.collection('seasons')
            .where('status', '==', 'active')
            .limit(1)
            .get();
        if (!activeSnapshot.empty) return activeSnapshot.docs[0].id;

        const fallbackSnapshot = await db.collection('seasons')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (!fallbackSnapshot.empty) return fallbackSnapshot.docs[0].id;
    } catch (error) {
        console.error('[SeasonStats] Error finding default season:', error);
    }
    return null;
}

function onSeasonSelect(seasonId) {
    const url = new URL(window.location);
    if (seasonId) {
        url.searchParams.set('seasonId', seasonId);
    } else {
        url.searchParams.delete('seasonId');
    }
    window.history.replaceState({}, '', url);

    if (seasonId) {
        loadSeason(seasonId);
    } else {
        clearAllDisplays();
    }
}

// =============================================================================
// LOADING
// =============================================================================

async function loadSeason(seasonId) {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    try {
        const db = window.firebaseDB;
        const seasonDoc = await db.collection('seasons').doc(seasonId).get();

        if (!seasonDoc.exists) {
            console.error('[SeasonStats] Season not found:', seasonId);
            clearAllDisplays();
            if (window.showToast) showToast('Season not found', 'error');
            return;
        }

        currentSeason = { id: seasonDoc.id, ...seasonDoc.data() };

        // A season could theoretically reference the same tournament twice
        // (defensive only — addTournamentToSeason() already guards this);
        // de-dupe so a tournament's stats are never counted twice.
        const tournamentIds = [...new Set(currentSeason.tournamentIds || [])];

        const tournamentDocs = await Promise.all(
            tournamentIds.map(tid => db.collection('tournaments').doc(tid).get())
        );

        currentTournaments = tournamentDocs
            .filter(doc => doc.exists)
            .map(doc => ({ id: doc.id, ...doc.data() }));

        // Default: every tournament included, same as pre-filter behavior.
        selectedTournamentIds = new Set(currentTournaments.map(t => t.id));

        renderSeasonStats();
    } catch (error) {
        console.error('[SeasonStats] Error loading season:', error);
        if (window.showToast) showToast('Error loading season', 'error');
    } finally {
        document.getElementById('loadingOverlay').classList.add('hidden');
    }
}

// =============================================================================
// AGGREGATION
// =============================================================================

/**
 * Combine every linked tournament's standings into one season-wide ranking,
 * matching teams across tournaments by name (teams have no persistent id —
 * see file header).
 *
 * Correctness guarantees:
 *  - Each (tournament, team) pair contributes to the aggregate exactly
 *    once — computeTeamStandings() already returns one row per team id
 *    within a tournament, so there is no risk of counting a team's own
 *    tournament result twice.
 *  - Two DIFFERENT teams that happen to share a name inside the SAME
 *    tournament (e.g. both left at the default "Tiimi 1") are never
 *    merged into one aggregate row — that would silently combine two
 *    unrelated teams' records. They're kept as distinct rows instead,
 *    flagged in `warnings`.
 *  - Matching is case-insensitive and trims whitespace, since that's how
 *    a human re-typing a team name between tournaments would vary it.
 *
 * @returns {{ rows: Array, warnings: string[] }}
 */
function aggregateSeasonStandings(tournaments) {
    const byKey = new Map();
    const warnings = [];

    tournaments.forEach(tournament => {
        const perTournamentRows = computeTeamStandings(tournament);
        const nameCounts = {}; // normalized name -> occurrences seen so far in THIS tournament

        perTournamentRows.forEach(row => {
            const rawName = (row.name || '').trim();
            if (!rawName) return;

            const normalized = rawName.toLowerCase();
            const occurrence = nameCounts[normalized] || 0;
            nameCounts[normalized] = occurrence + 1;

            let key = normalized;
            let displayName = rawName;
            if (occurrence > 0) {
                // Same name appeared earlier in THIS tournament already —
                // never fold a second team's stats into the first team's
                // aggregate. Give it its own key/label instead.
                key = `${normalized}#dup${occurrence}#${tournament.id}#${row.teamId}`;
                displayName = `${rawName} (${tournament.name || tournament.id})`;
                warnings.push(
                    `"${rawName}" appears more than once in "${tournament.name || tournament.id}" — ` +
                    `kept as separate season rows instead of merging their stats.`
                );
            }

            let agg = byKey.get(key);
            if (!agg) {
                agg = {
                    name: displayName,
                    color: row.color,
                    totalPts: 0,
                    victoryPts: 0,
                    hexPts: 0,
                    losses: 0,
                    played: 0,
                    hexCount: 0,
                    tournamentsPlayed: 0,
                    perTournament: []
                };
                byKey.set(key, agg);
            }

            agg.totalPts += row.totalPts;
            agg.victoryPts += row.victoryPts;
            agg.hexPts += row.hexPts;
            agg.losses += row.losses;
            agg.played += row.played;
            agg.hexCount += row.hexCount;
            agg.tournamentsPlayed += 1;
            agg.color = row.color || agg.color; // most recent tournament's color wins for display
            agg.perTournament.push({
                tournamentId: tournament.id,
                tournamentName: tournament.name || tournament.id,
                ...row
            });
        });
    });

    const rows = [...byKey.values()];
    rows.forEach(row => {
        row.winRate = row.played > 0 ? (row.victoryPts / row.played) * 100 : 0;
    });

    rows.sort((a, b) => {
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
        if (b.victoryPts !== a.victoryPts) return b.victoryPts - a.victoryPts;
        return b.winRate - a.winRate;
    });

    return { rows, warnings };
}

// =============================================================================
// RENDERING
// =============================================================================

/**
 * The tournaments actually included in every displayed aggregation right
 * now — everything below reads from this, never from currentTournaments
 * directly, so the filter checkboxes always affect standings, summary,
 * breakdown, player stats, teammates and insights together.
 */
function getFilteredTournaments() {
    return currentTournaments.filter(t => selectedTournamentIds.has(t.id));
}

function renderSeasonStats() {
    if (!currentSeason) return;

    renderSeasonMeta();
    renderTournamentFilter();

    const filtered = getFilteredTournaments();

    const { rows, warnings } = aggregateSeasonStandings(filtered);
    const { rows: playerRows, uidNameMap, unlinkedCount } = aggregateSeasonPlayerStats(filtered);
    const playerWarnings = unlinkedCount > 0
        ? [...warnings, `${unlinkedCount} roster slot${unlinkedCount === 1 ? '' : 's'} excluded from player stats (not linked to a real account)`]
        : warnings;
    renderSeasonWarnings(playerWarnings);
    renderSeasonStandings(rows);
    renderSeasonSummary(filtered);
    renderTournamentBreakdown(filtered);

    currentPlayerRows = playerRows;
    renderSeasonLeaderboard(currentPlayerLeaderboard, playerRows);

    const synergy = aggregateTeammateSynergy(filtered, uidNameMap);
    renderTeammateSynergy(synergy);

    const insights = computeSeasonInsights(playerRows);
    renderSeasonInsights(insights);
}

/**
 * Toggle a single tournament in/out of the filter and recompute everything.
 * Pure client-side — no new Firestore reads.
 */
function toggleTournamentFilter(tournamentId) {
    if (selectedTournamentIds.has(tournamentId)) {
        selectedTournamentIds.delete(tournamentId);
    } else {
        selectedTournamentIds.add(tournamentId);
    }
    // Rebuilds the filter checkbox list too (its checked state now lives in
    // selectedTournamentIds) along with every downstream card.
    renderSeasonStats();
}

function setAllTournamentFilters(included) {
    selectedTournamentIds = included ? new Set(currentTournaments.map(t => t.id)) : new Set();
    renderSeasonStats();
}

function renderSeasonMeta() {
    document.getElementById('metaSeasonStatus').textContent = currentSeason.status || 'Unknown';
    document.getElementById('metaSeasonTournaments').textContent =
        `${currentTournaments.length} / ${currentSeason.maxTournaments || 4}`;
}

function renderSeasonWarnings(warnings) {
    const el = document.getElementById('seasonWarnings');
    if (!warnings.length) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    el.style.display = 'block';
    el.innerHTML = `<strong>Data quality note</strong>` +
        warnings.map(w => `<div>${escapeHtml(w)}</div>`).join('');
}

function renderSeasonStandings(rows) {
    const container = document.getElementById('seasonStandingsTable');

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">This season has no tournaments linked yet</p>';
        return;
    }
    if (!rows.length) {
        container.innerHTML = '<p class="no-data">No teams found in this season\'s tournaments</p>';
        return;
    }

    let html = `<table><thead><tr>
        <th>#</th><th>Team</th><th>Total</th><th>Wins</th><th>Hex Pts</th>
        <th>W-L</th><th>Win %</th><th>Tournaments</th>
    </tr></thead><tbody>`;

    rows.forEach((row, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const winRate = row.winRate.toFixed(0);
        const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';

        html += `<tr>
            <td class="rank ${rankClass}">${rank}</td>
            <td class="team-name"><span class="team-color-dot" style="background:${row.color}"></span>${escapeHtml(row.name)}</td>
            <td class="points"><strong>${row.totalPts}</strong></td>
            <td class="points">${row.victoryPts}</td>
            <td class="points">${row.hexPts}</td>
            <td class="record">${row.victoryPts}-${row.losses}</td>
            <td class="win-rate ${winRateClass}">${winRate}%</td>
            <td>${row.tournamentsPlayed}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderSeasonSummary(tournaments) {
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    set('seasonSummaryTournaments', tournaments.length);

    let totalMatches = 0;
    let totalRounds = 0;
    const allDurations = [];

    tournaments.forEach(t => {
        const history = (t.gameHistory || []).filter(m => !m.isBreak);
        totalMatches += history.length;
        if (t.currentRound) totalRounds += Math.max(0, t.currentRound - 1);
        history.forEach(m => {
            if (m.matchDuration?.durationMinutes != null) {
                allDurations.push(m.matchDuration.durationMinutes);
            }
        });
    });

    set('seasonSummaryMatches', totalMatches);
    set('seasonSummaryRounds', totalRounds);

    const validDurations = allDurations.filter(d => d >= MIN_DURATION_MINUTES);
    if (validDurations.length > 0) {
        const avg = Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length);
        set('seasonSummaryAvgDuration', `${avg} min`);
    } else {
        set('seasonSummaryAvgDuration', 'N/A');
    }
}

function renderTournamentBreakdown(tournaments) {
    const container = document.getElementById('tournamentBreakdownTable');

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">Select a season to view its tournaments</p>';
        return;
    }
    if (!tournaments.length) {
        container.innerHTML = '<p class="no-data">No tournaments selected — check at least one above</p>';
        return;
    }

    // Leader per tournament, read straight from each tournament's own
    // standings (not the season aggregate) so it always names the team
    // that actually won THAT tournament.
    const leaderByTournamentId = {};
    tournaments.forEach(t => {
        const rows = computeTeamStandings(t);
        leaderByTournamentId[t.id] = rows[0] || null;
    });

    let html = `<table><thead><tr>
        <th>Tournament</th><th>Status</th><th>Matches</th><th>Leader</th><th></th>
    </tr></thead><tbody>`;

    tournaments.forEach(t => {
        const matches = (t.gameHistory || []).filter(m => !m.isBreak).length;
        const leader = leaderByTournamentId[t.id];
        const leaderHtml = leader
            ? `<span class="team-color-dot" style="background:${leader.color};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;"></span>${escapeHtml(leader.name)} (${leader.totalPts})`
            : '<span class="no-data" style="padding:0;">--</span>';

        html += `<tr>
            <td class="tourn-name"><a href="statistics.html?tournamentId=${t.id}">${escapeHtml(t.name || t.id)}</a></td>
            <td><span class="tournament-status-pill ${t.status || 'setup'}">${t.status || 'setup'}</span></td>
            <td>${matches}</td>
            <td>${leaderHtml}</td>
            <td><a class="btn secondary" style="padding:6px 12px;font-size:0.75rem;" href="statistics.html?tournamentId=${t.id}">View &rarr;</a></td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// =============================================================================
// TOURNAMENT FILTER — checkboxes
// =============================================================================

function renderTournamentFilter() {
    const container = document.getElementById('tournamentFilterList');
    if (!container) return;

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">Select a season to filter its tournaments</p>';
        return;
    }

    // Same chronological order used everywhere below, oldest first.
    const ordered = [...currentTournaments].sort((a, b) => tournamentSortDate(a) - tournamentSortDate(b));

    container.innerHTML = ordered.map(t => {
        const checked = selectedTournamentIds.has(t.id);
        const dateLabel = formatDateShort(t.createdAt);
        return `<label class="tournament-filter-item ${checked ? 'checked' : ''}">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleTournamentFilter('${t.id}')">
            <span>${escapeHtml(t.name || t.id)}</span>
            ${dateLabel ? `<span class="tf-date">${dateLabel}</span>` : ''}
        </label>`;
    }).join('');
}

function tournamentSortDate(t) {
    const d = new Date(t.createdAt);
    return isNaN(d) ? 0 : d.getTime();
}

function formatDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mo}.${d.getFullYear()}`;
}

// =============================================================================
// PLAYER-LEVEL AGGREGATION (uid-keyed — see file header)
// =============================================================================

/**
 * Season-wide per-player stats, keyed by uid. Walks every filtered
 * tournament's gameHistory (chronologically, both within and across
 * tournaments — matches carry absolute timestamps) and attributes each
 * match to the uid behind the playerIds gameHistory actually records.
 *
 * @returns {{ rows: Array, uidNameMap: Map<string,string>, unlinkedCount: number }}
 */
function aggregateSeasonPlayerStats(tournaments) {
    const byUid = new Map();
    let unlinkedCount = 0;

    // Oldest tournament first so per-tournament win-rate trend (used by the
    // "most improved" insight) and the season-wide streak walk are both in
    // real chronological order.
    const chronological = [...tournaments].sort((a, b) => tournamentSortDate(a) - tournamentSortDate(b));

    const getRecord = (uid, name) => {
        let rec = byUid.get(uid);
        if (!rec) {
            rec = {
                uid,
                name: name || 'Unknown',
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                tournamentIds: new Set(),
                timeline: [],        // chronological { result, timestamp }
                tournamentTrend: []  // per-tournament { tournamentId, tournamentName, played, won, winRate }
            };
            byUid.set(uid, rec);
        }
        if (name) rec.name = name; // most recently-seen name wins for display
        return rec;
    };

    chronological.forEach(t => {
        const registry = t.players || {};
        const history = [...(t.gameHistory || [])]
            .filter(m => !m.isBreak)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        Object.values(registry).forEach(p => { if (!p.uid) unlinkedCount++; });

        const tallyThisTournament = new Map(); // uid -> { played, won }
        const bumpTally = (uid, won) => {
            let tally = tallyThisTournament.get(uid);
            if (!tally) { tally = { played: 0, won: 0 }; tallyThisTournament.set(uid, tally); }
            tally.played++;
            if (won) tally.won++;
        };

        history.forEach(match => {
            (match.winningPlayerIds || []).forEach(pid => {
                const p = registry[pid];
                if (!p || !p.uid) return; // unlinked placeholder — excluded from player stats
                const rec = getRecord(p.uid, p.name);
                rec.gamesPlayed++;
                rec.wins++;
                rec.tournamentIds.add(t.id);
                rec.timeline.push({ result: 'win', timestamp: match.timestamp });
                bumpTally(p.uid, true);
            });
            (match.losingPlayerIds || []).forEach(pid => {
                const p = registry[pid];
                if (!p || !p.uid) return;
                const rec = getRecord(p.uid, p.name);
                rec.gamesPlayed++;
                rec.losses++;
                rec.tournamentIds.add(t.id);
                rec.timeline.push({ result: 'loss', timestamp: match.timestamp });
                bumpTally(p.uid, false);
            });
        });

        tallyThisTournament.forEach((tally, uid) => {
            const rec = byUid.get(uid);
            if (!rec) return;
            rec.tournamentTrend.push({
                tournamentId: t.id,
                tournamentName: t.name || t.id,
                played: tally.played,
                won: tally.won,
                winRate: tally.played > 0 ? (tally.won / tally.played) * 100 : 0
            });
        });
    });

    const rows = [...byUid.values()].map(rec => {
        rec.timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        rec.winRate = rec.gamesPlayed > 0 ? (rec.wins / rec.gamesPlayed) * 100 : 0;
        rec.tournamentsPlayed = rec.tournamentIds.size;

        // Best win streak across the WHOLE season (all filtered tournaments,
        // in true chronological order) — not reset at tournament boundaries,
        // unlike statistics.js's per-tournament streak.
        let best = 0, current = 0;
        rec.timeline.forEach(m => {
            if (m.result === 'win') { current++; best = Math.max(best, current); }
            else current = 0;
        });
        rec.bestSeasonWinStreak = best;

        return rec;
    });

    rows.sort((a, b) => b.wins - a.wins);

    const uidNameMap = new Map(rows.map(r => [r.uid, r.name]));

    return { rows, uidNameMap, unlinkedCount };
}

/**
 * For every pair of players (by uid) who shared a TEAM in the SAME
 * tournament AND the SAME match side (i.e. actually played that match
 * together, not merely rostered on the same team while someone else sat
 * out) — track their combined record. Grouping by match side + teamId
 * (not just teamId) means a team that rotates who plays doesn't credit a
 * pairing for a match neither of them was in.
 */
function aggregateTeammateSynergy(tournaments, uidNameMap) {
    const pairs = new Map(); // "uidA::uidB" (sorted) -> { uidA, uidB, played, won, lost }

    const recordSide = (registry, playerIds, won) => {
        // Group the side's linked players by their team, since a match side
        // can only meaningfully mean "played together" within one team.
        const byTeam = new Map();
        (playerIds || []).forEach(pid => {
            const p = registry[pid];
            if (!p || !p.uid) return; // unlinked — no stable identity to pair
            if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
            byTeam.get(p.teamId).push(p.uid);
        });

        byTeam.forEach(uids => {
            if (uids.length < 2) return;
            for (let i = 0; i < uids.length; i++) {
                for (let j = i + 1; j < uids.length; j++) {
                    const key = [uids[i], uids[j]].sort().join('::');
                    let rec = pairs.get(key);
                    if (!rec) {
                        const [uidA, uidB] = key.split('::');
                        rec = { uidA, uidB, played: 0, won: 0, lost: 0 };
                        pairs.set(key, rec);
                    }
                    rec.played++;
                    if (won) rec.won++; else rec.lost++;
                }
            }
        });
    };

    tournaments.forEach(t => {
        const registry = t.players || {};
        const history = (t.gameHistory || []).filter(m => !m.isBreak);
        history.forEach(match => {
            recordSide(registry, match.winningPlayerIds, true);
            recordSide(registry, match.losingPlayerIds, false);
        });
    });

    const rows = [...pairs.values()].map(rec => ({
        ...rec,
        nameA: uidNameMap.get(rec.uidA) || 'Unknown',
        nameB: uidNameMap.get(rec.uidB) || 'Unknown',
        winRate: rec.played > 0 ? (rec.won / rec.played) * 100 : 0
    }));

    rows.sort((a, b) => b.winRate - a.winRate || b.played - a.played);

    return {
        all: rows,
        // Players who never shared a team are simply absent from `rows` —
        // nothing to special-case, no crash.
        qualified: rows.filter(r => r.played >= MIN_TEAMMATE_GAMES_TOGETHER)
    };
}

/**
 * A handful of season-wide highlights, all derived from real per-player
 * aggregates above — nothing here is a field gameHistory doesn't actually
 * contain.
 */
function computeSeasonInsights(playerRows) {
    const withGames = playerRows.filter(r => r.gamesPlayed > 0);
    if (withGames.length === 0) {
        return { mvp: null, mostActive: null, bestStreakHolder: null, mostImproved: null };
    }

    const maxGames = Math.max(1, ...withGames.map(r => r.gamesPlayed));

    // MVP composite: rewards both efficiency (win rate) and season-long
    // durability/activity (games played, normalized against this season's
    // most active player so one outlier can't win on volume alone).
    // Weighting (65% win rate / 35% activity) is a deliberate call, not a
    // derived constant — documented here so it's not mistaken for one.
    const mvpCandidates = withGames
        .filter(r => r.gamesPlayed >= MIN_MVP_GAMES)
        .map(r => {
            const activityScore = (r.gamesPlayed / maxGames) * 100;
            return { ...r, mvpScore: r.winRate * 0.65 + activityScore * 0.35 };
        })
        .sort((a, b) => b.mvpScore - a.mvpScore);

    const mostActive = [...withGames].sort((a, b) => b.gamesPlayed - a.gamesPlayed)[0] || null;

    const streakSorted = [...withGames].sort((a, b) => b.bestSeasonWinStreak - a.bestSeasonWinStreak);
    const bestStreakHolder = streakSorted[0]?.bestSeasonWinStreak > 0 ? streakSorted[0] : null;

    // Most improved: win-rate trend from a player's first to last tournament
    // played within the filtered set (chronological). Needs data points
    // from at least 2 tournaments and a real sample size, so one lucky
    // match in a short first outing can't read as a dramatic "improvement".
    const improved = withGames
        .filter(r => r.tournamentTrend.length >= 2 && r.gamesPlayed >= MIN_IMPROVEMENT_GAMES)
        .map(r => {
            const first = r.tournamentTrend[0];
            const last = r.tournamentTrend[r.tournamentTrend.length - 1];
            return { ...r, improvement: last.winRate - first.winRate, firstTrend: first, lastTrend: last };
        })
        .sort((a, b) => b.improvement - a.improvement);
    const mostImproved = improved[0]?.improvement > 0 ? improved[0] : null;

    return {
        mvp: mvpCandidates[0] || null,
        mostActive,
        bestStreakHolder,
        mostImproved
    };
}

// =============================================================================
// RENDERING — player leaderboard, teammates, insights
// =============================================================================

function switchSeasonLeaderboard(type) {
    currentPlayerLeaderboard = type;
    document.querySelectorAll('.player-leaderboard-card .leaderboard-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.leaderboard === type);
    });
    renderSeasonLeaderboard(type, currentPlayerRows);
}

function renderSeasonLeaderboard(type, rows) {
    const container = document.getElementById('seasonLeaderboardContent');
    if (!container) return;

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">Select a season to view player stats</p>';
        return;
    }
    if (!getFilteredTournaments().length) {
        container.innerHTML = '<p class="no-data">No tournaments selected — check at least one above</p>';
        return;
    }

    let players = [...rows];
    switch (type) {
        case 'winrate':
            players = players.filter(p => p.gamesPlayed >= MIN_MVP_GAMES); // same floor as the MVP tile
            players.sort((a, b) => b.winRate - a.winRate);
            break;
        case 'games':
            players.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
            break;
        case 'streak':
            players.sort((a, b) => b.bestSeasonWinStreak - a.bestSeasonWinStreak);
            break;
        case 'wins':
        default:
            players.sort((a, b) => b.wins - a.wins);
            break;
    }
    players = players.slice(0, 10);

    if (players.length === 0) {
        container.innerHTML = '<p class="no-data">No qualifying players (linked players with recorded matches)</p>';
        return;
    }

    container.innerHTML = players.map((p, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';

        let statValue, statLabel;
        switch (type) {
            case 'winrate':
                statValue = `${p.winRate.toFixed(0)}%`;
                statLabel = `${p.wins}-${p.losses}`;
                break;
            case 'games':
                statValue = p.gamesPlayed;
                statLabel = `${p.tournamentsPlayed} tournament${p.tournamentsPlayed === 1 ? '' : 's'}`;
                break;
            case 'streak':
                statValue = p.bestSeasonWinStreak;
                statLabel = 'win streak';
                break;
            case 'wins':
            default:
                statValue = p.wins;
                statLabel = 'wins';
                break;
        }

        return `<div class="leaderboard-item" title="${p.tournamentsPlayed} tournament${p.tournamentsPlayed === 1 ? '' : 's'} played">
            <div class="leaderboard-rank ${rankClass}">${rank}</div>
            <div class="leaderboard-player">
                <span class="leaderboard-player-name">${escapeHtml(p.name)}</span>
                <span class="leaderboard-player-team">${p.tournamentsPlayed} tourn.</span>
            </div>
            <div class="leaderboard-stat">
                <span class="leaderboard-stat-value">${statValue}</span>
                <span class="leaderboard-stat-label">${statLabel}</span>
            </div>
        </div>`;
    }).join('');
}

function renderTeammateSynergy(synergy) {
    const container = document.getElementById('seasonSynergyContent');
    const subtitle = document.getElementById('synergySubtitle');
    if (!container) return;

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">Select a season to view teammate synergy</p>';
        if (subtitle) subtitle.textContent = '';
        return;
    }
    if (!getFilteredTournaments().length) {
        container.innerHTML = '<p class="no-data">No tournaments selected — check at least one above</p>';
        if (subtitle) subtitle.textContent = '';
        return;
    }

    if (subtitle) {
        subtitle.textContent = synergy.all.length
            ? `Pairs who played together on the same team, min. ${MIN_TEAMMATE_GAMES_TOGETHER} matches together to rank`
            : '';
    }

    const top = synergy.qualified.slice(0, 6);

    if (top.length === 0) {
        container.innerHTML = synergy.all.length
            ? `<p class="no-data">No pair has played ${MIN_TEAMMATE_GAMES_TOGETHER}+ matches together yet</p>`
            : '<p class="no-data">No players have shared a team in the selected tournaments</p>';
        return;
    }

    container.innerHTML = top.map(pair => {
        const winRate = pair.winRate.toFixed(0);
        const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';
        return `<div class="synergy-item">
            <div class="synergy-teammate">
                <div class="synergy-name">${escapeHtml(pair.nameA)} &amp; ${escapeHtml(pair.nameB)}</div>
                <div class="synergy-games">${pair.played} matches together</div>
                <div class="synergy-bar"><div class="synergy-bar-fill" style="width:${winRate}%;background:${winRate >= 60 ? 'var(--win)' : winRate >= 40 ? 'var(--accent-warning)' : 'var(--loss)'}"></div></div>
            </div>
            <div class="synergy-stats">
                <div class="synergy-winrate ${winRateClass}">${winRate}%</div>
                <div class="synergy-record">${pair.won}-${pair.lost}</div>
            </div>
        </div>`;
    }).join('');
}

function renderSeasonInsights(insights) {
    const container = document.getElementById('seasonInsightsStats');
    if (!container) return;

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">Select a season to view insights</p>';
        return;
    }
    if (!getFilteredTournaments().length) {
        container.innerHTML = '<p class="no-data">No tournaments selected — check at least one above</p>';
        return;
    }

    const tile = (label, value, sub) => `<div class="summary-item">
        <span class="summary-label">${label}</span>
        <span class="summary-value">${value}</span>
        ${sub ? `<span class="tf-date" style="display:block;margin-top:2px;">${sub}</span>` : ''}
    </div>`;

    const tiles = [];

    tiles.push(insights.mvp
        ? tile('Season MVP', escapeHtml(insights.mvp.name), `${insights.mvp.wins}-${insights.mvp.losses} · ${insights.mvp.winRate.toFixed(0)}% WR`)
        : tile('Season MVP', '--', `needs ${MIN_MVP_GAMES}+ games`));

    tiles.push(insights.mostActive
        ? tile('Most Active', escapeHtml(insights.mostActive.name), `${insights.mostActive.gamesPlayed} games · ${insights.mostActive.tournamentsPlayed} tourn.`)
        : tile('Most Active', '--', ''));

    tiles.push(insights.bestStreakHolder
        ? tile('Best Win Streak', escapeHtml(insights.bestStreakHolder.name), `${insights.bestStreakHolder.bestSeasonWinStreak} wins in a row`)
        : tile('Best Win Streak', '--', 'no streaks yet'));

    tiles.push(insights.mostImproved
        ? tile('Most Improved', escapeHtml(insights.mostImproved.name), `+${insights.mostImproved.improvement.toFixed(0)}pp win rate, ${escapeHtml(insights.mostImproved.firstTrend.tournamentName)} &rarr; ${escapeHtml(insights.mostImproved.lastTrend.tournamentName)}`)
        : tile('Most Improved', '--', `needs 2+ tournaments`));

    container.innerHTML = tiles.join('');
}

function clearAllDisplays() {
    currentSeason = null;
    currentTournaments = [];
    selectedTournamentIds = new Set();
    currentPlayerRows = [];
    document.getElementById('metaSeasonStatus').textContent = '--';
    document.getElementById('metaSeasonTournaments').textContent = '--';
    document.getElementById('seasonWarnings').style.display = 'none';
    document.getElementById('seasonStandingsTable').innerHTML = '<p class="no-data">Select a season to view combined standings</p>';
    document.getElementById('tournamentBreakdownTable').innerHTML = '<p class="no-data">Select a season to view its tournaments</p>';
    document.getElementById('tournamentFilterList').innerHTML = '<p class="no-data">Select a season to filter its tournaments</p>';
    document.getElementById('seasonLeaderboardContent').innerHTML = '<p class="no-data">Select a season to view player stats</p>';
    document.getElementById('seasonSynergyContent').innerHTML = '<p class="no-data">Select a season to view teammate synergy</p>';
    document.getElementById('seasonInsightsStats').innerHTML = '<p class="no-data">Select a season to view insights</p>';
    const subtitle = document.getElementById('synergySubtitle');
    if (subtitle) subtitle.textContent = '';
    ['seasonSummaryTournaments', 'seasonSummaryMatches', 'seasonSummaryRounds', 'seasonSummaryAvgDuration']
        .forEach(id => { document.getElementById(id).textContent = '--'; });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.onSeasonSelect = onSeasonSelect;
window.toggleTournamentFilter = toggleTournamentFilter;
window.setAllTournamentFilters = setAllTournamentFilters;
window.switchSeasonLeaderboard = switchSeasonLeaderboard;
