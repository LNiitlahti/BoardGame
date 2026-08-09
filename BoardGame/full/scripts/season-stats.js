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
 */

const MIN_DURATION_MINUTES = 5; // matches statistics.js's avg-duration filter

let currentSeason = null;
let currentTournaments = [];

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

function renderSeasonStats() {
    if (!currentSeason) return;

    renderSeasonMeta();
    const { rows, warnings } = aggregateSeasonStandings(currentTournaments);
    renderSeasonWarnings(warnings);
    renderSeasonStandings(rows);
    renderSeasonSummary();
    renderTournamentBreakdown(rows);
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

function renderSeasonSummary() {
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    set('seasonSummaryTournaments', currentTournaments.length);

    let totalMatches = 0;
    let totalRounds = 0;
    const allDurations = [];

    currentTournaments.forEach(t => {
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

function renderTournamentBreakdown(seasonRows) {
    const container = document.getElementById('tournamentBreakdownTable');

    if (!currentTournaments.length) {
        container.innerHTML = '<p class="no-data">Select a season to view its tournaments</p>';
        return;
    }

    // Leader per tournament, read straight from each tournament's own
    // standings (not the season aggregate) so it always names the team
    // that actually won THAT tournament.
    const leaderByTournamentId = {};
    currentTournaments.forEach(t => {
        const rows = computeTeamStandings(t);
        leaderByTournamentId[t.id] = rows[0] || null;
    });

    let html = `<table><thead><tr>
        <th>Tournament</th><th>Status</th><th>Matches</th><th>Leader</th><th></th>
    </tr></thead><tbody>`;

    currentTournaments.forEach(t => {
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

function clearAllDisplays() {
    currentSeason = null;
    currentTournaments = [];
    document.getElementById('metaSeasonStatus').textContent = '--';
    document.getElementById('metaSeasonTournaments').textContent = '--';
    document.getElementById('seasonWarnings').style.display = 'none';
    document.getElementById('seasonStandingsTable').innerHTML = '<p class="no-data">Select a season to view combined standings</p>';
    document.getElementById('tournamentBreakdownTable').innerHTML = '<p class="no-data">Select a season to view its tournaments</p>';
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
