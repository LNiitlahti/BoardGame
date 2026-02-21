/**
 * ============================================================================
 * STATISTICS.JS - Tournament Statistics & Analysis
 * ============================================================================
 *
 * Handles loading, processing, and displaying comprehensive tournament
 * statistics including standings, match history, head-to-head records,
 * game analysis, and progress charts.
 */

// =============================================================================
// GLOBAL STATE
// =============================================================================

let gameState = null;
let tournamentsList = [];
let pointsChart = null;
let currentFilters = {
    team: '',
    game: '',
    result: '',
    search: ''
};
let currentLeaderboard = 'wins';
let selectedPlayerId = null;
let playerStatsCache = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Statistics page loaded, waiting for Firebase...');
});

document.addEventListener('firebase-ready', async () => {
    console.log('Firebase ready');
    updateConnectionStatus('connected');

    await loadTournamentsList();

    // Check URL for tournament ID
    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = urlParams.get('tournamentId') || urlParams.get('tournament');

    if (tournamentId) {
        document.getElementById('tournamentSelect').value = tournamentId;
        await loadTournament(tournamentId);
    }

    document.getElementById('loadingOverlay').classList.add('hidden');
});

// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

/**
 * Load list of all tournaments for the selector
 */
async function loadTournamentsList() {
    try {
        const db = window.firebaseDB;
        const snapshot = await db.collection('tournaments')
            .orderBy('createdAt', 'desc')
            .get();

        tournamentsList = [];
        snapshot.forEach(doc => {
            tournamentsList.push({
                id: doc.id,
                ...doc.data()
            });
        });

        renderTournamentSelector();
    } catch (error) {
        console.error('Error loading tournaments:', error);
    }
}

/**
 * Render tournament dropdown options
 */
function renderTournamentSelector() {
    const select = document.getElementById('tournamentSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select a tournament...</option>';

    tournamentsList.forEach(tournament => {
        const option = document.createElement('option');
        option.value = tournament.id;

        const status = tournament.status || 'unknown';
        const statusIcon = status === 'finished' ? ' [Finished]' :
                          status === 'playing' ? ' [Active]' :
                          status === 'archived' ? ' [Archived]' : '';

        option.textContent = `${tournament.name || tournament.gameId || tournament.id}${statusIcon}`;
        select.appendChild(option);
    });

    // Restore selection if any
    if (currentValue) {
        select.value = currentValue;
    }
}

/**
 * Handle tournament selection change
 */
async function onTournamentSelect(tournamentId) {
    if (!tournamentId) {
        gameState = null;
        clearAllDisplays();
        return;
    }

    await loadTournament(tournamentId);

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('tournamentId', tournamentId);
    window.history.pushState({}, '', url);
}

/**
 * Load a specific tournament's data
 */
async function loadTournament(tournamentId) {
    try {
        document.getElementById('loadingOverlay').classList.remove('hidden');

        const db = window.firebaseDB;
        const doc = await db.collection('tournaments').doc(tournamentId).get();

        if (!doc.exists) {
            console.error('Tournament not found:', tournamentId);
            document.getElementById('loadingOverlay').classList.add('hidden');
            return;
        }

        gameState = doc.data();
        gameState.tournamentId = tournamentId;

        // Update navbar
        document.getElementById('navTournamentName').textContent =
            gameState.name || gameState.gameId || 'Tournament';

        // Update meta info
        updateMetaInfo();

        // Populate filters
        populateFilters();

        // Render all displays
        renderAllStatistics();

        document.getElementById('loadingOverlay').classList.add('hidden');
    } catch (error) {
        console.error('Error loading tournament:', error);
        document.getElementById('loadingOverlay').classList.add('hidden');
    }
}

/**
 * Refresh tournament list
 */
async function refreshTournaments() {
    await loadTournamentsList();
}

// =============================================================================
// META INFO & UTILITIES
// =============================================================================

function updateMetaInfo() {
    if (!gameState) return;

    const statusEl = document.getElementById('metaStatus');
    const roundsEl = document.getElementById('metaRounds');
    const gamesEl = document.getElementById('metaGames');

    statusEl.textContent = gameState.status || 'Unknown';
    roundsEl.textContent = gameState.currentRound || 0;
    gamesEl.textContent = gameState.gamesPlayed || (gameState.gameHistory?.length || 0);
}

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionStatus');
    if (!indicator) return;

    indicator.className = 'navbar-connection-status';
    indicator.classList.add(status);
    indicator.title = status === 'connected' ? 'Connected' : 'Disconnected';
}

function clearAllDisplays() {
    document.getElementById('navTournamentName').textContent = 'No Tournament';
    document.getElementById('metaStatus').textContent = '--';
    document.getElementById('metaRounds').textContent = '--';
    document.getElementById('metaGames').textContent = '--';

    document.getElementById('standingsTable').innerHTML = '<p class="no-data">Select a tournament to view standings</p>';
    document.getElementById('matchesList').innerHTML = '<p class="no-data">Select a tournament to view match history</p>';
    document.getElementById('h2hMatrixContainer').innerHTML = '<p class="no-data">Select a tournament to view head-to-head records</p>';
    document.getElementById('gameBreakdown').innerHTML = '<p class="no-data">No game data available</p>';

    // Clear player statistics
    playerStatsCache = null;
    selectedPlayerId = null;
    const playerSelect = document.getElementById('playerSelect');
    if (playerSelect) playerSelect.innerHTML = '<option value="">Select a player...</option>';
    document.getElementById('leaderboardContent').innerHTML = '<p class="no-data">Select a tournament to view player leaderboards</p>';
    document.getElementById('playerDetailContent').innerHTML = '<p class="no-data">Select a player to view detailed statistics</p>';
    document.getElementById('playerGameStats').innerHTML = '<p class="no-data">Select a player</p>';
    document.getElementById('playerFormatStats').innerHTML = '<p class="no-data">Select a player</p>';
    document.getElementById('playerRecentForm').innerHTML = '<p class="no-data">Select a player</p>';
    document.getElementById('playerH2HMatrix').innerHTML = '<p class="no-data">Select a player to see head-to-head records</p>';
    document.getElementById('teammateSynergyContent').innerHTML = '<p class="no-data">Select a player to see teammate synergy</p>';
}

function getTeamById(teamId) {
    if (!gameState?.teams) return null;
    return gameState.teams.find(t => String(t.id) === String(teamId));
}

function getTeamName(teamId) {
    const team = getTeamById(teamId);
    return team?.name || `Team ${teamId}`;
}

function getTeamColor(teamId) {
    const team = getTeamById(teamId);
    return team?.color || '#666666';
}

function getGameDisplayName(gameId) {
    if (gameState?.gameDefinitions && gameState.gameDefinitions[gameId]) {
        return gameState.gameDefinitions[gameId].name;
    }
    const gameNames = {
        'cs2': 'Counter-Strike 2',
        'CS2': 'Counter-Strike 2',
        'dota2': 'Dota 2',
        'Dota2': 'Dota 2',
        'valorant': 'Valorant',
        'Valorant': 'Valorant'
    };
    return gameNames[gameId] || gameId || 'Unknown';
}

/**
 * Get player name by ID from the players registry
 * Falls back to 'Unknown' if not found
 */
function getPlayerNameById(playerId) {
    if (!playerId || !gameState?.players) return 'Unknown';
    const player = gameState.players[playerId];
    return player?.name || 'Unknown';
}

/**
 * Get player info by ID, with team details
 */
function getPlayerInfoById(playerId) {
    if (!playerId) return null;

    // Try PlayerUtils first if available
    if (window.PlayerUtils) {
        return window.PlayerUtils.getPlayerDisplayInfo(gameState, playerId);
    }

    // Manual lookup
    const player = gameState?.players?.[playerId];
    if (!player) return null;

    const team = getTeamById(player.teamId);
    return {
        id: playerId,
        name: player.name,
        teamId: player.teamId,
        teamName: team?.name,
        teamColor: team?.color || '#666666'
    };
}

/**
 * Resolve an array of player IDs to player info objects
 */
function resolvePlayerIds(playerIds) {
    if (!playerIds || !Array.isArray(playerIds)) return [];
    return playerIds.map(id => getPlayerInfoById(id)).filter(Boolean);
}

// =============================================================================
// TAB NAVIGATION
// =============================================================================

function switchTab(tabId) {
    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
}

// =============================================================================
// RENDER ALL STATISTICS
// =============================================================================

function renderAllStatistics() {
    if (!gameState) return;

    // Calculate player stats once and cache
    playerStatsCache = calculateAllPlayerStats();

    renderStandings();
    renderSummaryStats();
    renderStreaks();
    renderPointsChart();
    renderMatches();
    renderHeadToHead();
    renderGameAnalysis();

    // Player statistics
    populatePlayerSelector();
    renderLeaderboard(currentLeaderboard);
}

// =============================================================================
// STANDINGS
// =============================================================================

function renderStandings() {
    const container = document.getElementById('standingsTable');
    if (!gameState?.teams || gameState.teams.length === 0) {
        container.innerHTML = '<p class="no-data">No teams found</p>';
        return;
    }

    // Sort teams by points (descending), then by wins
    const sortedTeams = [...gameState.teams].sort((a, b) => {
        if ((b.points || 0) !== (a.points || 0)) {
            return (b.points || 0) - (a.points || 0);
        }
        return (b.gamesWon || 0) - (a.gamesWon || 0);
    });

    let html = `
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Points</th>
                    <th>W-L</th>
                    <th>Win %</th>
                    <th>Hexes</th>
                </tr>
            </thead>
            <tbody>
    `;

    sortedTeams.forEach((team, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';

        const wins = team.gamesWon || 0;
        const losses = team.gamesLost || 0;
        const played = team.gamesPlayed || (wins + losses);
        const winRate = played > 0 ? ((wins / played) * 100).toFixed(0) : 0;
        const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';

        // Count hexes
        const hexCount = Object.values(gameState.board || {}).filter(t => t === team.id).length;

        html += `
            <tr>
                <td class="rank ${rankClass}">${rank}</td>
                <td class="team-name">
                    <span class="team-color-dot" style="background: ${team.color || '#666'}"></span>
                    ${team.name || 'Team ' + team.id}
                </td>
                <td class="points">${team.points || 0}</td>
                <td class="record">${wins}-${losses}</td>
                <td class="win-rate ${winRateClass}">${winRate}%</td>
                <td>${hexCount}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// =============================================================================
// SUMMARY STATS
// =============================================================================

function renderSummaryStats() {
    const history = gameState?.gameHistory || [];

    // Total matches
    document.getElementById('summaryMatches').textContent = history.length;

    // Total rounds
    document.getElementById('summaryRounds').textContent = gameState?.currentRound || 0;

    // Average match duration
    const durations = history
        .filter(m => m.matchDuration?.durationMinutes)
        .map(m => m.matchDuration.durationMinutes);

    if (durations.length > 0) {
        const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
        document.getElementById('summaryAvgDuration').textContent = `${avgDuration} min`;
    } else {
        document.getElementById('summaryAvgDuration').textContent = 'N/A';
    }

    // Challenges
    const challenges = history.filter(m => m.isChallenge).length;
    document.getElementById('summaryChallenges').textContent = challenges;
}

// =============================================================================
// STREAKS
// =============================================================================

function renderStreaks() {
    const container = document.getElementById('streaksList');
    const history = gameState?.gameHistory || [];

    if (history.length === 0 || !gameState?.teams) {
        container.innerHTML = '<p class="no-data">No streak data available</p>';
        return;
    }

    // Calculate current streaks for each team
    const streaks = {};
    gameState.teams.forEach(team => {
        streaks[team.id] = { type: null, count: 0 };
    });

    // Process history in chronological order
    const sortedHistory = [...history].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
    );

    sortedHistory.forEach(match => {
        const winningTeams = match.winningTeamIds || [];
        const losingTeams = match.losingTeamIds || [];

        winningTeams.forEach(teamId => {
            if (streaks[teamId]) {
                if (streaks[teamId].type === 'win') {
                    streaks[teamId].count++;
                } else {
                    streaks[teamId] = { type: 'win', count: 1 };
                }
            }
        });

        losingTeams.forEach(teamId => {
            if (streaks[teamId]) {
                if (streaks[teamId].type === 'loss') {
                    streaks[teamId].count++;
                } else {
                    streaks[teamId] = { type: 'loss', count: 1 };
                }
            }
        });
    });

    // Filter and sort streaks (only show streaks >= 2)
    const notableStreaks = Object.entries(streaks)
        .filter(([_, s]) => s.count >= 2)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

    if (notableStreaks.length === 0) {
        container.innerHTML = '<p class="no-data">No notable streaks yet</p>';
        return;
    }

    container.innerHTML = notableStreaks.map(([teamId, streak]) => {
        const team = getTeamById(teamId);
        const color = team?.color || '#666';

        return `
            <div class="streak-item" style="--streak-color: ${color}">
                <span class="streak-team" style="color: ${color}">${getTeamName(teamId)}</span>
                <div class="streak-info">
                    <span class="streak-count">${streak.count}</span>
                    <span class="streak-type ${streak.type}">${streak.type === 'win' ? 'Wins' : 'Losses'}</span>
                </div>
            </div>
        `;
    }).join('');
}

// =============================================================================
// POINTS CHART
// =============================================================================

function renderPointsChart() {
    const canvas = document.getElementById('pointsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Destroy existing chart if any
    if (pointsChart) {
        pointsChart.destroy();
    }

    if (!gameState?.teams || !gameState?.gameHistory?.length) {
        return;
    }

    // Build data from team stats snapshots in game history
    const labels = [];
    const datasets = [];

    // Initialize datasets for each team
    gameState.teams.forEach(team => {
        datasets.push({
            label: team.name || `Team ${team.id}`,
            data: [0], // Start at 0
            borderColor: team.color || '#666',
            backgroundColor: team.color ? team.color + '20' : '#66666620',
            tension: 0.3,
            fill: false
        });
    });

    labels.push('Start');

    // Process game history to build progress data
    const sortedHistory = [...gameState.gameHistory].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
    );

    sortedHistory.forEach((match, index) => {
        labels.push(`Match ${index + 1}`);

        if (match.teamStatsSnapshot) {
            gameState.teams.forEach((team, teamIndex) => {
                const snapshot = match.teamStatsSnapshot[team.id];
                if (snapshot) {
                    datasets[teamIndex].data.push(snapshot.points || 0);
                } else {
                    // Use last known value
                    const lastValue = datasets[teamIndex].data[datasets[teamIndex].data.length - 1] || 0;
                    datasets[teamIndex].data.push(lastValue);
                }
            });
        } else {
            // No snapshot, carry forward previous values
            gameState.teams.forEach((team, teamIndex) => {
                const lastValue = datasets[teamIndex].data[datasets[teamIndex].data.length - 1] || 0;
                datasets[teamIndex].data.push(lastValue);
            });
        }
    });

    // Add current state as final point
    labels.push('Current');
    gameState.teams.forEach((team, teamIndex) => {
        datasets[teamIndex].data.push(team.points || 0);
    });

    pointsChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#b0b0c0',
                        usePointStyle: true
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#707080' },
                    grid: { color: '#2a2a3a' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#707080' },
                    grid: { color: '#2a2a3a' }
                }
            }
        }
    });
}

// =============================================================================
// MATCH HISTORY
// =============================================================================

function populateFilters() {
    if (!gameState) return;

    // Team filter
    const teamFilter = document.getElementById('filterTeam');
    teamFilter.innerHTML = '<option value="">All Teams</option>';
    (gameState.teams || []).forEach(team => {
        teamFilter.innerHTML += `<option value="${team.id}">${team.name || 'Team ' + team.id}</option>`;
    });

    // Game filter
    const gameFilter = document.getElementById('filterGame');
    gameFilter.innerHTML = '<option value="">All Games</option>';
    const games = new Set();
    (gameState.gameHistory || []).forEach(m => {
        if (m.game) games.add(m.game);
    });
    games.forEach(game => {
        gameFilter.innerHTML += `<option value="${game}">${getGameDisplayName(game)}</option>`;
    });
}

function filterMatches() {
    currentFilters = {
        team: document.getElementById('filterTeam').value,
        game: document.getElementById('filterGame').value,
        result: document.getElementById('filterResult').value,
        search: document.getElementById('filterSearch').value.toLowerCase()
    };

    renderMatches();
}

function renderMatches() {
    const container = document.getElementById('matchesList');
    const history = gameState?.gameHistory || [];

    if (history.length === 0) {
        container.innerHTML = '<p class="no-data">No matches played yet</p>';
        return;
    }

    // Sort by timestamp descending (most recent first)
    let filtered = [...history].sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Apply filters
    if (currentFilters.team) {
        const teamId = parseInt(currentFilters.team) || currentFilters.team;
        filtered = filtered.filter(m =>
            m.winningTeamIds?.includes(teamId) || m.losingTeamIds?.includes(teamId)
        );

        if (currentFilters.result === 'won') {
            filtered = filtered.filter(m => m.winningTeamIds?.includes(teamId));
        } else if (currentFilters.result === 'lost') {
            filtered = filtered.filter(m => m.losingTeamIds?.includes(teamId));
        }
    }

    if (currentFilters.game) {
        filtered = filtered.filter(m => m.game === currentFilters.game);
    }

    if (currentFilters.search) {
        filtered = filtered.filter(m => {
            // Support both old format (winningPlayers/losingPlayers) and new format (winningPlayerIds/losingPlayerIds)
            const playerNames = [
                // Old format
                ...(m.winningPlayers || []).map(p => p.name?.toLowerCase() || ''),
                ...(m.losingPlayers || []).map(p => p.name?.toLowerCase() || ''),
                ...(m.matchup?.teamASide || []).map(p => typeof p === 'string' ? getPlayerNameById(p).toLowerCase() : (p.name?.toLowerCase() || '')),
                ...(m.matchup?.teamBSide || []).map(p => typeof p === 'string' ? getPlayerNameById(p).toLowerCase() : (p.name?.toLowerCase() || '')),
                // New format - resolve player IDs to names
                ...(m.winningPlayerIds || []).map(id => getPlayerNameById(id).toLowerCase()),
                ...(m.losingPlayerIds || []).map(id => getPlayerNameById(id).toLowerCase())
            ];
            return playerNames.some(name => name.includes(currentFilters.search));
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = '<p class="no-data">No matches match the current filters</p>';
        return;
    }

    container.innerHTML = filtered.map(match => {
        const winnerNames = (match.winningTeamIds || []).map(id => getTeamName(id)).join(' & ');
        const loserNames = (match.losingTeamIds || []).map(id => getTeamName(id)).join(' & ');
        const winnerColor = getTeamColor(match.winningTeamIds?.[0]);
        const loserColor = getTeamColor(match.losingTeamIds?.[0]);

        const duration = match.matchDuration?.durationMinutes
            ? `${match.matchDuration.durationMinutes}m`
            : '';

        const time = match.timestamp
            ? new Date(match.timestamp).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })
            : '';

        return `
            <div class="match-item ${match.isChallenge ? 'challenge' : ''}">
                <span class="match-number">#${match.id || match.matchNumber || '?'}</span>
                <span class="match-game">${getGameDisplayName(match.game)}</span>
                <span class="match-format">${match.playType || ''}</span>
                <div class="match-teams">
                    <span class="match-team winner" style="border-left: 3px solid ${winnerColor}">
                        ${winnerNames}
                    </span>
                    <span class="match-vs">def.</span>
                    <span class="match-team loser" style="border-left: 3px solid ${loserColor}">
                        ${loserNames}
                    </span>
                </div>
                <span class="match-duration">${duration}</span>
                <span class="match-time">${time}</span>
            </div>
        `;
    }).join('');
}

// =============================================================================
// HEAD-TO-HEAD
// =============================================================================

function renderHeadToHead() {
    const container = document.getElementById('h2hMatrixContainer');
    const teams = gameState?.teams || [];
    const history = gameState?.gameHistory || [];

    if (teams.length === 0) {
        container.innerHTML = '<p class="no-data">No teams found</p>';
        return;
    }

    // Calculate head-to-head records
    const h2h = {};
    teams.forEach(t1 => {
        h2h[t1.id] = {};
        teams.forEach(t2 => {
            h2h[t1.id][t2.id] = { wins: 0, losses: 0 };
        });
    });

    history.forEach(match => {
        const winners = match.winningTeamIds || [];
        const losers = match.losingTeamIds || [];

        // For each winner-loser pair, record the result
        winners.forEach(winnerId => {
            losers.forEach(loserId => {
                if (h2h[winnerId] && h2h[winnerId][loserId]) {
                    h2h[winnerId][loserId].wins++;
                }
                if (h2h[loserId] && h2h[loserId][winnerId]) {
                    h2h[loserId][winnerId].losses++;
                }
            });
        });
    });

    // Build matrix table
    let html = '<table class="h2h-matrix"><thead><tr><th class="corner"></th>';

    teams.forEach(team => {
        html += `<th><span class="team-header" style="color: ${team.color || '#fff'}">${team.name || 'T' + team.id}</span></th>`;
    });

    html += '</tr></thead><tbody>';

    teams.forEach(rowTeam => {
        html += `<tr><th style="color: ${rowTeam.color || '#fff'}">${rowTeam.name || 'Team ' + rowTeam.id}</th>`;

        teams.forEach(colTeam => {
            if (rowTeam.id === colTeam.id) {
                html += '<td class="cell diagonal">-</td>';
            } else {
                const record = h2h[rowTeam.id][colTeam.id];
                const wins = record.wins;
                const losses = record.losses;
                const cellClass = wins > losses ? 'positive' : wins < losses ? 'negative' : 'neutral';

                html += `
                    <td class="cell ${cellClass}"
                        onclick="showH2HDetail(${rowTeam.id}, ${colTeam.id})"
                        title="${rowTeam.name} vs ${colTeam.name}">
                        <span class="h2h-record">${wins}-${losses}</span>
                    </td>
                `;
            }
        });

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function showH2HDetail(team1Id, team2Id) {
    const detailContainer = document.getElementById('h2hDetail');
    const team1 = getTeamById(team1Id);
    const team2 = getTeamById(team2Id);
    const history = gameState?.gameHistory || [];

    // Find all matches between these two teams
    const matches = history.filter(match => {
        const allTeams = [...(match.winningTeamIds || []), ...(match.losingTeamIds || [])];
        return allTeams.includes(team1Id) && allTeams.includes(team2Id);
    });

    if (matches.length === 0) {
        detailContainer.innerHTML = `
            <div class="h2h-detail-content active">
                <div class="h2h-detail-header">
                    <span class="h2h-team-name" style="color: ${team1?.color}">${team1?.name}</span>
                    <span class="h2h-vs">vs</span>
                    <span class="h2h-team-name" style="color: ${team2?.color}">${team2?.name}</span>
                </div>
                <p class="no-data">No matches between these teams</p>
            </div>
        `;
        return;
    }

    const matchesHtml = matches.map(match => {
        const team1Won = match.winningTeamIds?.includes(team1Id);
        const winnerColor = team1Won ? team1?.color : team2?.color;
        const winnerName = team1Won ? team1?.name : team2?.name;

        return `
            <div class="match-item" style="border-left: 3px solid ${winnerColor}">
                <span class="match-number">#${match.id}</span>
                <span class="match-game">${getGameDisplayName(match.game)}</span>
                <span style="flex: 1; color: ${winnerColor}; font-weight: 600;">
                    ${winnerName} won
                </span>
            </div>
        `;
    }).join('');

    detailContainer.innerHTML = `
        <div class="h2h-detail-content active">
            <div class="h2h-detail-header">
                <span class="h2h-team-name" style="color: ${team1?.color}">${team1?.name}</span>
                <span class="h2h-vs">vs</span>
                <span class="h2h-team-name" style="color: ${team2?.color}">${team2?.name}</span>
            </div>
            <div class="h2h-matches-list">
                ${matchesHtml}
            </div>
        </div>
    `;
}

// =============================================================================
// GAME ANALYSIS
// =============================================================================

function renderGameAnalysis() {
    renderGameBreakdown();
    renderTeamGameStats();
    renderFormatBreakdown();
}

function renderGameBreakdown() {
    const container = document.getElementById('gameBreakdown');
    const history = gameState?.gameHistory || [];

    if (history.length === 0) {
        container.innerHTML = '<p class="no-data">No game data available</p>';
        return;
    }

    // Count games by type
    const gameCounts = {};
    const gameDurations = {};

    history.forEach(match => {
        const game = match.game || 'Unknown';
        gameCounts[game] = (gameCounts[game] || 0) + 1;

        if (match.matchDuration?.durationMinutes) {
            gameDurations[game] = gameDurations[game] || [];
            gameDurations[game].push(match.matchDuration.durationMinutes);
        }
    });

    // Sort by count descending
    const sortedGames = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);

    container.innerHTML = sortedGames.map(([game, count]) => {
        const durations = gameDurations[game] || [];
        const avgDuration = durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : null;

        return `
            <div class="game-stat-card">
                <div class="game-stat-name">${getGameDisplayName(game)}</div>
                <div class="game-stat-count">${count}</div>
                <div class="game-stat-label">matches</div>
                ${avgDuration ? `<div class="game-stat-duration">Avg: ${avgDuration} min</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderTeamGameStats() {
    const container = document.getElementById('teamGameStats');
    const teams = gameState?.teams || [];
    const history = gameState?.gameHistory || [];

    if (teams.length === 0 || history.length === 0) {
        container.innerHTML = '<p class="no-data">No data available</p>';
        return;
    }

    // Get unique games
    const games = [...new Set(history.map(m => m.game).filter(Boolean))];

    // Calculate stats per team per game
    const teamGameStats = {};
    teams.forEach(team => {
        teamGameStats[team.id] = {};
        games.forEach(game => {
            teamGameStats[team.id][game] = { won: 0, lost: 0 };
        });
    });

    history.forEach(match => {
        const game = match.game;
        if (!game) return;

        (match.winningTeamIds || []).forEach(teamId => {
            if (teamGameStats[teamId] && teamGameStats[teamId][game]) {
                teamGameStats[teamId][game].won++;
            }
        });

        (match.losingTeamIds || []).forEach(teamId => {
            if (teamGameStats[teamId] && teamGameStats[teamId][game]) {
                teamGameStats[teamId][game].lost++;
            }
        });
    });

    // Build table
    let html = '<table><thead><tr><th>Team</th>';
    games.forEach(game => {
        html += `<th>${getGameDisplayName(game)}</th>`;
    });
    html += '</tr></thead><tbody>';

    teams.forEach(team => {
        html += `<tr><td style="color: ${team.color}">${team.name}</td>`;
        games.forEach(game => {
            const stats = teamGameStats[team.id][game];
            const total = stats.won + stats.lost;
            const winRate = total > 0 ? Math.round((stats.won / total) * 100) : 0;
            const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';

            html += `<td>${stats.won}-${stats.lost} <span class="win-rate ${winRateClass}">(${winRate}%)</span></td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderFormatBreakdown() {
    const container = document.getElementById('formatBreakdown');
    const history = gameState?.gameHistory || [];

    if (history.length === 0) {
        container.innerHTML = '<p class="no-data">No format data available</p>';
        return;
    }

    // Count by format
    const formatCounts = {};
    history.forEach(match => {
        const format = match.playType || 'Unknown';
        formatCounts[format] = (formatCounts[format] || 0) + 1;
    });

    const total = history.length;
    const sortedFormats = Object.entries(formatCounts).sort((a, b) => b[1] - a[1]);

    container.innerHTML = sortedFormats.map(([format, count]) => {
        const percentage = Math.round((count / total) * 100);

        return `
            <div class="format-item">
                <span class="format-name">${format}</span>
                <div class="format-bar">
                    <div class="format-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <span class="format-count">${count}</span>
            </div>
        `;
    }).join('');
}

// =============================================================================
// EXPORT
// =============================================================================

// =============================================================================
// PLAYER STATISTICS
// =============================================================================

/**
 * Calculate comprehensive stats for all players
 */
function calculateAllPlayerStats() {
    if (!gameState?.players) return {};

    const history = gameState.gameHistory || [];
    const stats = {};

    // Initialize stats for all players
    Object.entries(gameState.players).forEach(([playerId, player]) => {
        stats[playerId] = {
            id: playerId,
            name: player.name,
            teamId: player.teamId,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            currentStreak: { type: null, count: 0 },
            bestWinStreak: 0,
            bestLossStreak: 0,
            byGame: {},      // Stats per game type
            byFormat: {},    // Stats per format (5v5, 3v3, etc.)
            challenges: { played: 0, won: 0, lost: 0 },
            recentMatches: [], // Last 10 matches
            vsOpponents: {},   // H2H vs each opponent
            withTeammates: {}, // Synergy with each teammate
            matchDurations: [] // For average calculation
        };
    });

    // Sort history chronologically for streak calculation
    const sortedHistory = [...history].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
    );

    // Process each match
    sortedHistory.forEach(match => {
        const winningPlayerIds = match.winningPlayerIds || [];
        const losingPlayerIds = match.losingPlayerIds || [];
        const allPlayerIds = [...winningPlayerIds, ...losingPlayerIds];
        const game = match.game || 'Unknown';
        const format = match.playType || 'Unknown';
        const isChallenge = match.isChallenge || false;
        const duration = match.matchDuration?.durationMinutes;

        // Process winners
        winningPlayerIds.forEach(playerId => {
            if (!stats[playerId]) return;
            const playerStats = stats[playerId];

            playerStats.gamesPlayed++;
            playerStats.wins++;

            // Streak tracking
            if (playerStats.currentStreak.type === 'win') {
                playerStats.currentStreak.count++;
            } else {
                playerStats.currentStreak = { type: 'win', count: 1 };
            }
            playerStats.bestWinStreak = Math.max(playerStats.bestWinStreak, playerStats.currentStreak.count);

            // By game
            if (!playerStats.byGame[game]) {
                playerStats.byGame[game] = { played: 0, won: 0, lost: 0 };
            }
            playerStats.byGame[game].played++;
            playerStats.byGame[game].won++;

            // By format
            if (!playerStats.byFormat[format]) {
                playerStats.byFormat[format] = { played: 0, won: 0, lost: 0 };
            }
            playerStats.byFormat[format].played++;
            playerStats.byFormat[format].won++;

            // Challenges
            if (isChallenge) {
                playerStats.challenges.played++;
                playerStats.challenges.won++;
            }

            // Duration
            if (duration) {
                playerStats.matchDurations.push(duration);
            }

            // Recent matches (we'll slice later)
            playerStats.recentMatches.push({
                matchId: match.id,
                result: 'win',
                game,
                format,
                timestamp: match.timestamp,
                opponents: losingPlayerIds
            });

            // H2H vs opponents
            losingPlayerIds.forEach(opponentId => {
                if (!stats[opponentId]) return;
                if (!playerStats.vsOpponents[opponentId]) {
                    playerStats.vsOpponents[opponentId] = { played: 0, won: 0, lost: 0 };
                }
                playerStats.vsOpponents[opponentId].played++;
                playerStats.vsOpponents[opponentId].won++;
            });

            // Teammate synergy (other winners)
            winningPlayerIds.forEach(teammateId => {
                if (teammateId === playerId || !stats[teammateId]) return;
                if (!playerStats.withTeammates[teammateId]) {
                    playerStats.withTeammates[teammateId] = { played: 0, won: 0, lost: 0 };
                }
                playerStats.withTeammates[teammateId].played++;
                playerStats.withTeammates[teammateId].won++;
            });
        });

        // Process losers
        losingPlayerIds.forEach(playerId => {
            if (!stats[playerId]) return;
            const playerStats = stats[playerId];

            playerStats.gamesPlayed++;
            playerStats.losses++;

            // Streak tracking
            if (playerStats.currentStreak.type === 'loss') {
                playerStats.currentStreak.count++;
            } else {
                playerStats.currentStreak = { type: 'loss', count: 1 };
            }
            playerStats.bestLossStreak = Math.max(playerStats.bestLossStreak, playerStats.currentStreak.count);

            // By game
            if (!playerStats.byGame[game]) {
                playerStats.byGame[game] = { played: 0, won: 0, lost: 0 };
            }
            playerStats.byGame[game].played++;
            playerStats.byGame[game].lost++;

            // By format
            if (!playerStats.byFormat[format]) {
                playerStats.byFormat[format] = { played: 0, won: 0, lost: 0 };
            }
            playerStats.byFormat[format].played++;
            playerStats.byFormat[format].lost++;

            // Challenges
            if (isChallenge) {
                playerStats.challenges.played++;
                playerStats.challenges.lost++;
            }

            // Duration
            if (duration) {
                playerStats.matchDurations.push(duration);
            }

            // Recent matches
            playerStats.recentMatches.push({
                matchId: match.id,
                result: 'loss',
                game,
                format,
                timestamp: match.timestamp,
                opponents: winningPlayerIds
            });

            // H2H vs opponents
            winningPlayerIds.forEach(opponentId => {
                if (!stats[opponentId]) return;
                if (!playerStats.vsOpponents[opponentId]) {
                    playerStats.vsOpponents[opponentId] = { played: 0, won: 0, lost: 0 };
                }
                playerStats.vsOpponents[opponentId].played++;
                playerStats.vsOpponents[opponentId].lost++;
            });

            // Teammate synergy (other losers)
            losingPlayerIds.forEach(teammateId => {
                if (teammateId === playerId || !stats[teammateId]) return;
                if (!playerStats.withTeammates[teammateId]) {
                    playerStats.withTeammates[teammateId] = { played: 0, won: 0, lost: 0 };
                }
                playerStats.withTeammates[teammateId].played++;
                playerStats.withTeammates[teammateId].lost++;
            });
        });
    });

    // Calculate derived stats
    Object.values(stats).forEach(playerStats => {
        // Win rate
        playerStats.winRate = playerStats.gamesPlayed > 0
            ? (playerStats.wins / playerStats.gamesPlayed) * 100
            : 0;

        // Keep only last 10 recent matches (most recent first)
        playerStats.recentMatches = playerStats.recentMatches.slice(-10).reverse();

        // Average match duration
        playerStats.avgDuration = playerStats.matchDurations.length > 0
            ? Math.round(playerStats.matchDurations.reduce((a, b) => a + b, 0) / playerStats.matchDurations.length)
            : null;
    });

    return stats;
}

/**
 * Populate player selector dropdown
 */
function populatePlayerSelector() {
    const select = document.getElementById('playerSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Select a player...</option>';

    if (!gameState?.players) return;

    // Get players sorted by team, then name
    const players = Object.entries(gameState.players)
        .map(([id, player]) => ({ id, ...player }))
        .sort((a, b) => {
            if (a.teamId !== b.teamId) return a.teamId - b.teamId;
            return (a.name || '').localeCompare(b.name || '');
        });

    // Group by team
    const teamGroups = {};
    players.forEach(player => {
        const team = getTeamById(player.teamId);
        const teamName = team?.name || `Team ${player.teamId}`;
        if (!teamGroups[teamName]) {
            teamGroups[teamName] = [];
        }
        teamGroups[teamName].push(player);
    });

    // Add options grouped by team
    Object.entries(teamGroups).forEach(([teamName, teamPlayers]) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = teamName;
        teamPlayers.forEach(player => {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = player.name;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });
}

/**
 * Handle player selection
 */
function onPlayerSelect(playerId) {
    selectedPlayerId = playerId || null;

    if (!playerId) {
        document.getElementById('playerDetailContent').innerHTML = '<p class="no-data">Select a player to view detailed statistics</p>';
        document.getElementById('playerGameStats').innerHTML = '<p class="no-data">Select a player</p>';
        document.getElementById('playerFormatStats').innerHTML = '<p class="no-data">Select a player</p>';
        document.getElementById('playerRecentForm').innerHTML = '<p class="no-data">Select a player</p>';
        document.getElementById('playerH2HMatrix').innerHTML = '<p class="no-data">Select a player to see head-to-head records</p>';
        document.getElementById('teammateSynergyContent').innerHTML = '<p class="no-data">Select a player to see teammate synergy</p>';
        return;
    }

    renderPlayerDetail(playerId);
    renderPlayerGameStats(playerId);
    renderPlayerFormatStats(playerId);
    renderPlayerRecentForm(playerId);
    renderPlayerH2H(playerId);
    renderTeammateSynergy(playerId);
}

/**
 * Switch leaderboard view
 */
function switchLeaderboard(type) {
    currentLeaderboard = type;

    // Update tab buttons
    document.querySelectorAll('.leaderboard-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.leaderboard === type);
    });

    renderLeaderboard(type);
}

/**
 * Render leaderboard
 */
function renderLeaderboard(type) {
    const container = document.getElementById('leaderboardContent');
    if (!container) return;

    if (!playerStatsCache || Object.keys(playerStatsCache).length === 0) {
        container.innerHTML = '<p class="no-data">No player data available</p>';
        return;
    }

    // Get players with stats
    let players = Object.values(playerStatsCache).filter(p => p.gamesPlayed > 0);

    // Sort based on type
    switch (type) {
        case 'wins':
            players.sort((a, b) => b.wins - a.wins);
            break;
        case 'winrate':
            // Minimum 3 games for win rate leaderboard
            players = players.filter(p => p.gamesPlayed >= 3);
            players.sort((a, b) => b.winRate - a.winRate);
            break;
        case 'games':
            players.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
            break;
        case 'streak':
            players.sort((a, b) => b.bestWinStreak - a.bestWinStreak);
            break;
    }

    // Take top 10
    players = players.slice(0, 10);

    if (players.length === 0) {
        container.innerHTML = '<p class="no-data">No qualifying players</p>';
        return;
    }

    container.innerHTML = players.map((player, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const team = getTeamById(player.teamId);

        let statValue, statLabel;
        switch (type) {
            case 'wins':
                statValue = player.wins;
                statLabel = 'wins';
                break;
            case 'winrate':
                statValue = player.winRate.toFixed(0) + '%';
                statLabel = `${player.wins}-${player.losses}`;
                break;
            case 'games':
                statValue = player.gamesPlayed;
                statLabel = 'games';
                break;
            case 'streak':
                statValue = player.bestWinStreak;
                statLabel = 'win streak';
                break;
        }

        return `
            <div class="leaderboard-item" onclick="selectPlayerFromLeaderboard('${player.id}')">
                <div class="leaderboard-rank ${rankClass}">${rank}</div>
                <div class="leaderboard-player">
                    <span class="leaderboard-player-name">${player.name}</span>
                    <span class="leaderboard-player-team" style="color: ${team?.color || '#666'}">${team?.name || 'Unknown'}</span>
                </div>
                <div class="leaderboard-stat">
                    <span class="leaderboard-stat-value">${statValue}</span>
                    <span class="leaderboard-stat-label">${statLabel}</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Select player from leaderboard click
 */
function selectPlayerFromLeaderboard(playerId) {
    document.getElementById('playerSelect').value = playerId;
    onPlayerSelect(playerId);

    // Scroll to player details
    document.querySelector('.player-detail-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Render player detail section
 */
function renderPlayerDetail(playerId) {
    const container = document.getElementById('playerDetailContent');
    const stats = playerStatsCache?.[playerId];

    if (!stats) {
        container.innerHTML = '<p class="no-data">Player not found</p>';
        return;
    }

    const player = gameState.players[playerId];
    const team = getTeamById(player?.teamId);
    const teamColor = team?.color || '#666';
    const initials = (stats.name || 'P').substring(0, 2).toUpperCase();

    const winRateClass = stats.winRate >= 60 ? 'positive' : stats.winRate >= 40 ? 'neutral' : 'negative';
    const streakEmoji = stats.currentStreak.type === 'win' ? '🔥' : stats.currentStreak.type === 'loss' ? '❄️' : '➖';
    const streakColor = stats.currentStreak.type === 'win' ? 'var(--accent-success, #2e9158)' : stats.currentStreak.type === 'loss' ? 'var(--accent-danger, #ef4444)' : 'var(--text-tertiary)';

    container.innerHTML = `
        <div class="player-header" style="--player-team-color: ${teamColor}">
            <div class="player-avatar" style="border-color: ${teamColor}">${initials}</div>
            <div class="player-info">
                <div class="player-name">${stats.name}</div>
                <div class="player-team-badge" style="background: ${teamColor}20; color: ${teamColor}">
                    <span class="player-team-dot" style="background: ${teamColor}"></span>
                    ${team?.name || 'Unknown Team'}
                </div>
            </div>
        </div>

        <div class="player-core-stats">
            <div class="player-stat-item">
                <div class="player-stat-value">${stats.gamesPlayed}</div>
                <div class="player-stat-label">Games</div>
            </div>
            <div class="player-stat-item">
                <div class="player-stat-value positive">${stats.wins}</div>
                <div class="player-stat-label">Wins</div>
            </div>
            <div class="player-stat-item">
                <div class="player-stat-value negative">${stats.losses}</div>
                <div class="player-stat-label">Losses</div>
            </div>
            <div class="player-stat-item">
                <div class="player-stat-value ${winRateClass}">${stats.winRate.toFixed(0)}%</div>
                <div class="player-stat-label">Win Rate</div>
            </div>
        </div>

        <div class="player-streaks">
            <div class="player-streak-item">
                <div class="player-streak-icon">${streakEmoji}</div>
                <div class="player-streak-info">
                    <div class="player-streak-value" style="color: ${streakColor}">${stats.currentStreak.count || 0}</div>
                    <div class="player-streak-label">Current ${stats.currentStreak.type || 'N/A'}</div>
                </div>
            </div>
            <div class="player-streak-item">
                <div class="player-streak-icon">🏆</div>
                <div class="player-streak-info">
                    <div class="player-streak-value">${stats.bestWinStreak}</div>
                    <div class="player-streak-label">Best Win Streak</div>
                </div>
            </div>
            ${stats.avgDuration ? `
            <div class="player-streak-item">
                <div class="player-streak-icon">⏱️</div>
                <div class="player-streak-info">
                    <div class="player-streak-value">${stats.avgDuration}m</div>
                    <div class="player-streak-label">Avg Duration</div>
                </div>
            </div>
            ` : ''}
            ${stats.challenges.played > 0 ? `
            <div class="player-streak-item">
                <div class="player-streak-icon">⚔️</div>
                <div class="player-streak-info">
                    <div class="player-streak-value">${stats.challenges.won}-${stats.challenges.lost}</div>
                    <div class="player-streak-label">Challenges</div>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

/**
 * Render player game performance
 */
function renderPlayerGameStats(playerId) {
    const container = document.getElementById('playerGameStats');
    const stats = playerStatsCache?.[playerId];

    if (!stats || Object.keys(stats.byGame).length === 0) {
        container.innerHTML = '<p class="no-data">No game data</p>';
        return;
    }

    const games = Object.entries(stats.byGame)
        .sort((a, b) => b[1].played - a[1].played);

    container.innerHTML = games.map(([game, gameStats]) => {
        const winRate = gameStats.played > 0 ? (gameStats.won / gameStats.played) * 100 : 0;
        const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';

        return `
            <div class="player-game-item">
                <span class="player-game-name">${getGameDisplayName(game)}</span>
                <span class="player-game-record">${gameStats.won}-${gameStats.lost}</span>
                <span class="player-game-winrate ${winRateClass}">${winRate.toFixed(0)}%</span>
            </div>
        `;
    }).join('');
}

/**
 * Render player format performance
 */
function renderPlayerFormatStats(playerId) {
    const container = document.getElementById('playerFormatStats');
    const stats = playerStatsCache?.[playerId];

    if (!stats || Object.keys(stats.byFormat).length === 0) {
        container.innerHTML = '<p class="no-data">No format data</p>';
        return;
    }

    const formats = Object.entries(stats.byFormat)
        .sort((a, b) => b[1].played - a[1].played);

    container.innerHTML = formats.map(([format, formatStats]) => {
        const winRate = formatStats.played > 0 ? (formatStats.won / formatStats.played) * 100 : 0;
        const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';

        return `
            <div class="player-format-item">
                <span class="player-format-name">${format}</span>
                <span class="player-format-record">${formatStats.won}-${formatStats.lost}</span>
                <span class="player-format-winrate ${winRateClass}">${winRate.toFixed(0)}%</span>
            </div>
        `;
    }).join('');
}

/**
 * Render player recent form
 */
function renderPlayerRecentForm(playerId) {
    const container = document.getElementById('playerRecentForm');
    const stats = playerStatsCache?.[playerId];

    if (!stats || stats.recentMatches.length === 0) {
        container.innerHTML = '<p class="no-data">No recent matches</p>';
        return;
    }

    const recent = stats.recentMatches;
    const recentWins = recent.filter(m => m.result === 'win').length;
    const recentLosses = recent.filter(m => m.result === 'loss').length;

    // Form indicators (W/L squares)
    const formIndicators = recent.slice(0, 10).map(match => `
        <div class="form-indicator ${match.result}">${match.result === 'win' ? 'W' : 'L'}</div>
    `).join('');

    // Recent match list
    const matchList = recent.slice(0, 5).map(match => {
        const opponentNames = match.opponents
            .map(id => playerStatsCache[id]?.name || 'Unknown')
            .slice(0, 2)
            .join(', ');
        const moreOpponents = match.opponents.length > 2 ? ` +${match.opponents.length - 2}` : '';

        return `
            <div class="form-match-item">
                <span class="form-match-result ${match.result}">${match.result}</span>
                <span class="form-match-game">${getGameDisplayName(match.game)}</span>
                <span class="form-match-vs">vs ${opponentNames}${moreOpponents}</span>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="form-summary">
            ${formIndicators}
        </div>
        <div class="form-recent-label">Last ${recent.length}: ${recentWins}W - ${recentLosses}L</div>
        ${matchList}
    `;
}

/**
 * Render player head-to-head records
 */
function renderPlayerH2H(playerId) {
    const container = document.getElementById('playerH2HMatrix');
    const stats = playerStatsCache?.[playerId];

    if (!stats || Object.keys(stats.vsOpponents).length === 0) {
        container.innerHTML = '<p class="no-data">No head-to-head data</p>';
        return;
    }

    // Sort opponents by games played
    const opponents = Object.entries(stats.vsOpponents)
        .filter(([_, record]) => record.played > 0)
        .map(([opponentId, record]) => ({
            id: opponentId,
            ...record,
            name: playerStatsCache[opponentId]?.name || 'Unknown',
            teamId: playerStatsCache[opponentId]?.teamId
        }))
        .sort((a, b) => b.played - a.played);

    if (opponents.length === 0) {
        container.innerHTML = '<p class="no-data">No head-to-head data</p>';
        return;
    }

    container.innerHTML = opponents.map(opponent => {
        const winRate = opponent.played > 0 ? (opponent.won / opponent.played) * 100 : 0;
        const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';
        const team = getTeamById(opponent.teamId);
        const barColor = winRate >= 60 ? 'var(--accent-success, #2e9158)' : winRate >= 40 ? 'var(--accent-warning, #f7ba32)' : 'var(--accent-danger, #ef4444)';

        return `
            <div class="player-h2h-item" style="--h2h-color: ${team?.color || '#666'}">
                <div class="player-h2h-opponent">
                    <div class="player-h2h-name">${opponent.name}</div>
                    <div class="player-h2h-team" style="color: ${team?.color || '#666'}">${team?.name || ''}</div>
                </div>
                <div class="player-h2h-stats">
                    <div class="player-h2h-record">${opponent.won}-${opponent.lost}</div>
                    <div class="player-h2h-winrate ${winRateClass}">${winRate.toFixed(0)}%</div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render teammate synergy
 */
function renderTeammateSynergy(playerId) {
    const container = document.getElementById('teammateSynergyContent');
    const stats = playerStatsCache?.[playerId];

    if (!stats || Object.keys(stats.withTeammates).length === 0) {
        container.innerHTML = '<p class="no-data">No teammate data</p>';
        return;
    }

    // Sort teammates by games played together
    const teammates = Object.entries(stats.withTeammates)
        .filter(([_, record]) => record.played > 0)
        .map(([teammateId, record]) => ({
            id: teammateId,
            ...record,
            name: playerStatsCache[teammateId]?.name || 'Unknown',
            teamId: playerStatsCache[teammateId]?.teamId,
            winRate: record.played > 0 ? (record.won / record.played) * 100 : 0
        }))
        .sort((a, b) => b.played - a.played);

    if (teammates.length === 0) {
        container.innerHTML = '<p class="no-data">No teammate data</p>';
        return;
    }

    container.innerHTML = teammates.map(teammate => {
        const winRateClass = teammate.winRate >= 60 ? 'high' : teammate.winRate >= 40 ? 'medium' : 'low';
        const team = getTeamById(teammate.teamId);
        const barColor = teammate.winRate >= 60 ? 'var(--accent-success, #2e9158)' : teammate.winRate >= 40 ? 'var(--accent-warning, #f7ba32)' : 'var(--accent-danger, #ef4444)';

        return `
            <div class="synergy-item" style="--synergy-color: ${team?.color || '#666'}">
                <div class="synergy-teammate">
                    <div class="synergy-name">${teammate.name}</div>
                    <div class="synergy-games">${teammate.played} games together</div>
                </div>
                <div class="synergy-stats">
                    <div class="synergy-winrate ${winRateClass}">${teammate.winRate.toFixed(0)}%</div>
                    <div class="synergy-record">${teammate.won}W-${teammate.lost}L</div>
                </div>
                <div class="synergy-bar">
                    <div class="synergy-bar-fill" style="width: ${teammate.winRate}%; background: ${barColor}"></div>
                </div>
            </div>
        `;
    }).join('');
}

function exportStatistics() {
    if (!gameState) {
        showToast('No tournament selected', 'warning');
        return;
    }

    // Build normalized export with players registry
    const exportData = {
        exportedAt: new Date().toISOString(),
        schemaVersion: "2.0", // Normalized player structure

        tournament: {
            id: gameState.tournamentId,
            name: gameState.name || gameState.gameId,
            status: gameState.status,
            rounds: gameState.currentRound,
            gamesPlayed: gameState.gamesPlayed
        },

        // Players registry - single source of truth for all player names
        players: gameState.players || {},

        // Teams with player IDs (not duplicated names)
        teams: gameState.teams?.map(team => ({
            id: team.id,
            name: team.name,
            color: team.color,
            points: team.points,
            gamesWon: team.gamesWon,
            gamesLost: team.gamesLost,
            gamesPlayed: team.gamesPlayed,
            playerIds: team.playerIds || team.players?.map(p => p.id).filter(Boolean) || []
        })),

        // Match history with player IDs (not duplicated names)
        gameHistory: (gameState.gameHistory || []).map(match => ({
            id: match.id,
            matchNumber: match.matchNumber,
            game: match.game,
            playType: match.playType,
            timestamp: match.timestamp,
            winningTeamIds: match.winningTeamIds,
            losingTeamIds: match.losingTeamIds,
            winningPlayerIds: match.winningPlayerIds || match.winningPlayers?.map(p => p.id).filter(Boolean) || [],
            losingPlayerIds: match.losingPlayerIds || match.losingPlayers?.map(p => p.id).filter(Boolean) || [],
            isChallenge: match.isChallenge || false,
            matchDuration: match.matchDuration,
            tournamentRound: match.tournamentRound
        })),

        summary: {
            totalMatches: gameState.gameHistory?.length || 0,
            totalPlayers: Object.keys(gameState.players || {}).length,
            challenges: gameState.gameHistory?.filter(m => m.isChallenge).length || 0
        },

        // Player statistics (if calculated)
        playerStatistics: playerStatsCache ? Object.entries(playerStatsCache).map(([id, stats]) => ({
            id,
            name: stats.name,
            teamId: stats.teamId,
            gamesPlayed: stats.gamesPlayed,
            wins: stats.wins,
            losses: stats.losses,
            winRate: Math.round(stats.winRate * 100) / 100,
            bestWinStreak: stats.bestWinStreak,
            avgDuration: stats.avgDuration,
            byGame: stats.byGame,
            byFormat: stats.byFormat,
            challenges: stats.challenges
        })) : null
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tournament-stats-${gameState.tournamentId || 'export'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
