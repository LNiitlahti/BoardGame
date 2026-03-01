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

// Abuse prevention: cache + cooldown
let tournamentCache = {};        // { tournamentId: { data, fetchedAt } }
let lastListFetchAt = 0;
const LIST_COOLDOWN_MS = 30000;  // 30s between tournament list refreshes
const CACHE_TTL_MS = 300000;     // 5min cache TTL for tournament data
const MIN_DURATION_MINUTES = 5;  // Exclude matches shorter than this from avg duration

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Statistics page loaded, waiting for Firebase...');
});

document.addEventListener('firebase-ready', async () => {
    console.log('Firebase ready');
    updateConnectionStatus('connected');

    await loadTournamentsList(true); // bypass cooldown on initial load

    // Check URL for tournament ID
    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = urlParams.get('tournamentId') || urlParams.get('tournament');

    if (tournamentId) {
        document.getElementById('tournamentSelect').value = tournamentId;
        await loadTournament(tournamentId);

        // Check for player param — auto-select player and switch to Players tab
        const playerId = urlParams.get('player');
        if (playerId && gameState?.players?.[playerId]) {
            switchTab('players');
            document.getElementById('playerSelect').value = playerId;
            onPlayerSelect(playerId);
        }
    }

    document.getElementById('loadingOverlay').classList.add('hidden');
});

// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

/**
 * Load list of all tournaments for the selector
 */
async function loadTournamentsList(bypassCooldown = false) {
    const now = Date.now();
    if (!bypassCooldown && now - lastListFetchAt < LIST_COOLDOWN_MS) {
        const remaining = Math.ceil((LIST_COOLDOWN_MS - (now - lastListFetchAt)) / 1000);
        showToast(`Please wait ${remaining}s before refreshing`, 'warning');
        return;
    }

    lastListFetchAt = now;

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
        startRefreshCooldown();
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

        // Check cache first
        const cached = tournamentCache[tournamentId];
        const now = Date.now();
        if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
            gameState = JSON.parse(JSON.stringify(cached.data));
            gameState.tournamentId = tournamentId;
        } else {
            // Fetch from Firestore
            const db = window.firebaseDB;
            const doc = await db.collection('tournaments').doc(tournamentId).get();

            if (!doc.exists) {
                console.error('Tournament not found:', tournamentId);
                document.getElementById('loadingOverlay').classList.add('hidden');
                return;
            }

            gameState = doc.data();
            gameState.tournamentId = tournamentId;

            // Cache the fetched data
            tournamentCache[tournamentId] = {
                data: JSON.parse(JSON.stringify(doc.data())),
                fetchedAt: Date.now()
            };
        }

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

/**
 * Disable refresh button with countdown after a successful refresh
 */
function startRefreshCooldown() {
    const btn = document.getElementById('refreshBtn');
    if (!btn) return;

    btn.disabled = true;
    let countdown = Math.ceil(LIST_COOLDOWN_MS / 1000);
    btn.textContent = `Wait ${countdown}s`;

    const timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.textContent = 'Refresh';
        } else {
            btn.textContent = `Wait ${countdown}s`;
        }
    }, 1000);
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
    if (typeof GAMES_CONFIG !== 'undefined') {
        const game = GAMES_CONFIG.getGame(gameId);
        if (game) return game.name;
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
 * Get game icon HTML (img tag with fallback to emoji)
 */
function getGameIconHtml(gameId, size = 20) {
    // Check tournament-level gameDefinitions first
    const def = gameState?.gameDefinitions?.[gameId];
    if (def?.image) {
        const src = GAMES_CONFIG?.resolveImagePath?.(def.image) || def.image;
        return `<img src="${src}" alt="" class="game-icon" width="${size}" height="${size}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="game-icon-fallback" style="display:none">${def.icon || ''}</span>`;
    }
    // Check GAMES_CONFIG
    if (typeof GAMES_CONFIG !== 'undefined') {
        const game = GAMES_CONFIG.getGame(gameId);
        if (game?.image) {
            const src = GAMES_CONFIG.resolveImagePath(game.image);
            return `<img src="${src}" alt="" class="game-icon" width="${size}" height="${size}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="game-icon-fallback" style="display:none">${game.icon || ''}</span>`;
        }
        if (game?.icon) {
            return `<span class="game-icon-emoji">${game.icon}</span>`;
        }
    }
    return '';
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

    // Sort teams by total points (hex pts + victory pts), then by wins as tiebreaker
    const sortedTeams = [...gameState.teams].sort((a, b) => {
        const totalA = (a.points || 0) + (a.gamesWon || 0);
        const totalB = (b.points || 0) + (b.gamesWon || 0);
        if (totalB !== totalA) return totalB - totalA;
        return (b.gamesWon || 0) - (a.gamesWon || 0);
    });

    let html = `
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Total</th>
                    <th>Wins</th>
                    <th>Hex Pts</th>
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

        const victoryPts = team.gamesWon || 0;
        const hexPts = team.points || 0;
        const totalPts = victoryPts + hexPts;
        const losses = team.gamesLost || 0;
        const played = team.gamesPlayed || (victoryPts + losses);
        const winRate = played > 0 ? ((victoryPts / played) * 100).toFixed(0) : 0;
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
                <td class="points"><strong>${totalPts}</strong></td>
                <td class="points">${victoryPts}</td>
                <td class="points">${hexPts}</td>
                <td class="record">${victoryPts}-${losses}</td>
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
    const history = (gameState?.gameHistory || []).filter(m => !m.isBreak);

    // Total matches
    document.getElementById('summaryMatches').textContent = history.length;

    // Total rounds
    document.getElementById('summaryRounds').textContent = gameState?.currentRound || 0;

    // Average match duration (excluding < MIN_DURATION_MINUTES)
    const allDurations = history
        .filter(m => m.matchDuration?.durationMinutes != null)
        .map(m => m.matchDuration.durationMinutes);
    const durations = allDurations.filter(d => d >= MIN_DURATION_MINUTES);

    if (durations.length > 0) {
        const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
        document.getElementById('summaryAvgDuration').textContent =
            `${avgDuration} min (${durations.length}/${allDurations.length})`;
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
                    datasets[teamIndex].data.push((snapshot.points || 0) + (snapshot.gamesWon || 0));
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
        datasets[teamIndex].data.push((team.points || 0) + (team.gamesWon || 0));
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
    } else if (currentFilters.result) {
        // Result filter without team filter: show all wins or all losses
        if (currentFilters.result === 'won') {
            filtered = filtered.filter(m => m.winningTeamIds?.length > 0);
        } else if (currentFilters.result === 'lost') {
            filtered = filtered.filter(m => m.losingTeamIds?.length > 0);
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

    // Resolve players with team color info for a match side
    // Returns array of { name, color } objects
    function resolveMatchPlayers(match, side) {
        const playerIds = side === 'winners' ? match.winningPlayerIds : match.losingPlayerIds;
        const oldPlayers = side === 'winners' ? match.winningPlayers : match.losingPlayers;
        const teamIds = side === 'winners' ? match.winningTeamIds : match.losingTeamIds;

        // New format: resolve player IDs with individual team colors
        if (playerIds?.length > 0) {
            return playerIds.map(id => {
                const player = gameState?.players?.[id];
                const teamColor = player ? getTeamColor(player.teamId) : '#666';
                return { name: getPlayerNameById(id), color: teamColor };
            }).filter(p => p.name !== 'Unknown');
        }
        // Old format
        if (oldPlayers?.length > 0) {
            return oldPlayers.map(p => ({
                name: p.name || 'Unknown',
                color: p.teamId ? getTeamColor(p.teamId) : '#666'
            }));
        }
        // Fallback to team names
        return (teamIds || []).map(id => ({
            name: getTeamName(id),
            color: getTeamColor(id)
        }));
    }

    // Render player list with colored dots
    function renderPlayerList(players) {
        return players.map(p =>
            `<span class="match-player"><span class="match-player-dot" style="background:${p.color};box-shadow:0 0 4px ${p.color}"></span>${p.name}</span>`
        ).join('');
    }

    // Table header
    // Format a timestamp to "HH:MM DD.MM.YYYY"
    function formatDateTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d)) return '';
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${hh}:${mm} ${dd}.${mo}.${yyyy}`;
    }

    let html = `
        <div class="matches-table-header">
            <span class="mth-number">#</span>
            <span class="mth-game">Game</span>
            <span class="mth-format">Format</span>
            <span class="mth-winners">Winners</span>
            <span class="mth-losers">Losers</span>
            <span class="mth-duration">Minutes</span>
            <span class="mth-time">Started / Ended</span>
        </div>
    `;

    html += filtered.map(match => {
        const winners = resolveMatchPlayers(match, 'winners');
        const losers = resolveMatchPlayers(match, 'losers');

        const duration = match.matchDuration?.durationMinutes
            ? `${match.matchDuration.durationMinutes} min`
            : '';

        const startedAt = match.matchDuration?.startedAt;
        const endedAt = match.matchDuration?.endedAt || match.timestamp;

        const startStr = formatDateTime(startedAt);
        const endStr = formatDateTime(endedAt);

        // Build the time cell: show both if we have start, otherwise just end
        let timeHtml;
        if (startStr) {
            timeHtml = `<span class="match-time-start">${startStr}</span><span class="match-time-end">${endStr}</span>`;
        } else {
            timeHtml = `<span class="match-time-end">${endStr}</span>`;
        }

        return `
            <div class="match-item ${match.isChallenge ? 'challenge' : ''}">
                <span class="match-number">#${match.id || match.matchNumber || '?'}</span>
                <span class="match-game">${getGameIconHtml(match.game, 18)} ${getGameDisplayName(match.game)}</span>
                <span class="match-format">${match.playType || ''}</span>
                <div class="match-players winner">
                    ${renderPlayerList(winners)}
                </div>
                <div class="match-players loser">
                    ${renderPlayerList(losers)}
                </div>
                <span class="match-duration">${duration}</span>
                <div class="match-time">${timeHtml}</div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
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
                <span class="match-game">${getGameIconHtml(match.game, 16)} ${getGameDisplayName(match.game)}</span>
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

        if (match.matchDuration?.durationMinutes != null) {
            gameDurations[game] = gameDurations[game] || [];
            gameDurations[game].push(match.matchDuration.durationMinutes);
        }
    });

    // Sort by count descending
    const sortedGames = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);

    container.innerHTML = sortedGames.map(([game, count]) => {
        const allDurations = gameDurations[game] || [];
        const durations = allDurations.filter(d => d >= MIN_DURATION_MINUTES);
        const avgDuration = durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : null;

        return `
            <div class="game-stat-card">
                <div class="game-stat-icon">${getGameIconHtml(game, 32)}</div>
                <div class="game-stat-name">${getGameDisplayName(game)}</div>
                <div class="game-stat-count">${count}</div>
                <div class="game-stat-label">matches</div>
                ${avgDuration ? `<div class="game-stat-duration">Avg: ${avgDuration} min (${durations.length}/${allDurations.length})</div>` : ''}
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
        html += `<th>${getGameIconHtml(game, 16)} ${getGameDisplayName(game)}</th>`;
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
        const duration = match.matchDuration?.durationMinutes ?? null;
        const hasDuration = duration != null;

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
            if (hasDuration) {
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
            if (hasDuration) {
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

        // Average match duration (excluding < MIN_DURATION_MINUTES)
        const validDurations = playerStats.matchDurations.filter(d => d >= MIN_DURATION_MINUTES);
        playerStats.avgDuration = validDurations.length > 0
            ? Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length)
            : null;
        playerStats.durationDataPoints = validDurations.length;
        playerStats.durationTotalPoints = playerStats.matchDurations.length;
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

        // Clear player from URL
        const url = new URL(window.location);
        url.searchParams.delete('player');
        window.history.replaceState({}, '', url);
        return;
    }

    renderPlayerDetail(playerId);
    renderPlayerGameStats(playerId);
    renderPlayerFormatStats(playerId);
    renderPlayerRecentForm(playerId);
    renderPlayerH2H(playerId);
    renderTeammateSynergy(playerId);

    // Sync URL
    const url = new URL(window.location);
    url.searchParams.set('player', playerId);
    window.history.replaceState({}, '', url);
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
                    <div class="player-streak-label">Avg Duration (${stats.durationDataPoints}/${stats.durationTotalPoints})</div>
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
                <span class="player-game-name">${getGameIconHtml(game, 18)} ${getGameDisplayName(game)}</span>
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
                <span class="form-match-game">${getGameIconHtml(match.game, 14)} ${getGameDisplayName(match.game)}</span>
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
            totalPoints: (team.points || 0) + (team.gamesWon || 0),
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
            durationDataPoints: stats.durationDataPoints,
            durationTotalPoints: stats.durationTotalPoints,
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

// =============================================================================
// PDF GENERATION
// =============================================================================

/**
 * Load an image as a data URL for PDF embedding
 * @param {string} src - Image source URL
 * @param {boolean} roundCorners - Clip to rounded rectangle
 */
function loadImageForPDF(src, roundCorners = false) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');

            if (roundCorners) {
                const w = canvas.width;
                const h = canvas.height;
                const r = Math.min(w, h) * 0.18;
                ctx.beginPath();
                ctx.moveTo(r, 0);
                ctx.lineTo(w - r, 0);
                ctx.quadraticCurveTo(w, 0, w, r);
                ctx.lineTo(w, h - r);
                ctx.quadraticCurveTo(w, h, w - r, h);
                ctx.lineTo(r, h);
                ctx.quadraticCurveTo(0, h, 0, h - r);
                ctx.lineTo(0, r);
                ctx.quadraticCurveTo(0, 0, r, 0);
                ctx.closePath();
                ctx.clip();
            }

            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/**
 * Generate a comprehensive tournament PDF report
 */
async function generatePDF() {
    if (!gameState) {
        showToast('No tournament selected', 'warning');
        return;
    }

    const overlay = document.getElementById('pdfOverlay');
    const progressText = document.getElementById('pdfProgressText');
    overlay.classList.remove('hidden');

    try {
        // Pre-load logo and game icons
        progressText.textContent = 'Loading assets...';
        const logoDataUrl = await loadImageForPDF((window.BOARDGAME_BASE || '.') + '/shared/images/favicon/android-chrome-192x192.png', true);

        // Pre-load game icons for all games used in this tournament
        const gameIconMap = {}; // gameId -> dataUrl
        const gamesUsed = new Set();
        (gameState.gameHistory || []).forEach(m => { if (m.game) gamesUsed.add(m.game); });
        await Promise.all([...gamesUsed].map(async (gameId) => {
            let imagePath = null;
            // Check tournament gameDefinitions first
            if (gameState.gameDefinitions?.[gameId]?.image) {
                imagePath = gameState.gameDefinitions[gameId].image;
            } else if (typeof GAMES_CONFIG !== 'undefined') {
                const game = GAMES_CONFIG.getGame(gameId);
                if (game?.image) imagePath = game.image;
            }
            if (imagePath) {
                const resolvedPath = (typeof GAMES_CONFIG !== 'undefined' && GAMES_CONFIG.resolveImagePath)
                    ? GAMES_CONFIG.resolveImagePath(imagePath)
                    : (window.BOARDGAME_BASE || '.') + '/' + imagePath;
                const dataUrl = await loadImageForPDF(resolvedPath, true);
                if (dataUrl) gameIconMap[gameId] = dataUrl;
            }
        }));

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentW = pageW - margin * 2;

        // Color palette (matching Dark Void / Gold Accent theme)
        const C = {
            bg:         [5, 7, 16],
            bgDeep:     [8, 11, 20],
            panel:      [16, 20, 32],
            panelLight: [20, 24, 38],
            panelAlt:   [12, 15, 26],
            cardBg:     [14, 17, 28],
            headerBg:   [30, 34, 50],
            gold:       [200, 179, 126],
            goldBright: [232, 216, 168],
            goldDim:    [140, 125, 88],
            text:       [200, 204, 214],
            textBright: [242, 244, 247],
            textMuted:  [106, 112, 136],
            textDim:    [58, 63, 82],
            win:        [0, 216, 128],
            winDim:     [0, 160, 96],
            loss:       [192, 56, 64],
            lossDim:    [140, 44, 50],
            border:     [40, 44, 60],
            borderGold: [80, 72, 50],
            white:      [255, 255, 255]
        };

        // ---- HELPERS ----

        // Convert hex color string to RGB array
        function hexToRgb(hex) {
            hex = (hex || '#666666').replace('#', '');
            if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
            return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
        }

        // Get team index in gameState.teams array for sorting
        function getTeamIndex(teamId) {
            if (!gameState?.teams) return 999;
            const idx = gameState.teams.findIndex(t => String(t.id) === String(teamId));
            return idx >= 0 ? idx : 999;
        }

        function drawPageBg() {
            doc.setFillColor(...C.bg);
            doc.rect(0, 0, pageW, pageH, 'F');
        }

        // Draw small logo on non-cover pages
        function drawPageLogo() {
            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'PNG', margin, 3, 8, 8);
            }
        }

        // Monkey-patch doc.addPage so EVERY page creation (including autoTable
        // internal overflow pages) automatically gets dark bg + logo BEFORE
        // any content is drawn on it. This solves the white-page overflow bug.
        const _origDocAddPage = doc.addPage.bind(doc);
        doc.addPage = function(...args) {
            _origDocAddPage(...args);
            drawPageBg();
            drawPageLogo();
            return doc;
        };

        function addPage() {
            doc.addPage(); // monkey-patch handles bg + logo
            return margin + 4;
        }

        function checkPage(y, needed = 20) {
            if (y + needed > pageH - margin - 6) {
                return addPage();
            }
            return y;
        }

        // Win-rate color helper
        function wrColor(rateNum) {
            if (rateNum >= 60) return C.win;
            if (rateNum >= 40) return C.goldBright;
            return C.loss;
        }

        function parseWinRate(str) {
            const n = parseInt(str);
            return isNaN(n) ? 50 : n;
        }

        // Decorative section title with gold accent bar
        function sectionTitle(y, title) {
            y = checkPage(y, 18);
            // Gold accent dot
            doc.setFillColor(...C.gold);
            doc.circle(margin + 1.5, y - 1.5, 1.2, 'F');
            // Title text
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(...C.gold);
            doc.text(title.toUpperCase(), margin + 5, y);
            y += 2.5;
            // Gradient-style line: gold to faded
            doc.setDrawColor(...C.gold);
            doc.setLineWidth(0.4);
            doc.line(margin, y, margin + contentW * 0.4, y);
            doc.setDrawColor(...C.borderGold);
            doc.setLineWidth(0.15);
            doc.line(margin + contentW * 0.4, y, margin + contentW, y);
            return y + 7;
        }

        // Player card header bar with team color
        function playerHeader(y, name, teamName, teamColorRgb) {
            // Gold-tinted header strip
            doc.setFillColor(28, 32, 46);
            doc.roundedRect(margin, y - 4, contentW, 10, 2, 2, 'F');
            doc.setDrawColor(...C.borderGold);
            doc.setLineWidth(0.3);
            doc.roundedRect(margin, y - 4, contentW, 10, 2, 2, 'S');
            // Left team-color accent bar
            doc.setFillColor(...(teamColorRgb || C.gold));
            doc.rect(margin, y - 4, 1.5, 10, 'F');
            // Name
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(...C.goldBright);
            doc.text(name, margin + 5, y + 2);
            // Team name in team color
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...(teamColorRgb || C.textMuted));
            doc.text(teamName, margin + 5 + doc.getTextWidth(name) + 4, y + 2);
            return y + 10;
        }

        function bodyText(y, text, opts = {}) {
            y = checkPage(y, 6);
            doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
            doc.setFontSize(opts.size || 8.5);
            doc.setTextColor(...(opts.color || C.text));
            doc.text(String(text), opts.x || margin + 2, y);
            return y + (opts.lineHeight || 4.5);
        }

        // Stat box helper for summary grid
        function drawStatBox(x, y, w, h, value, label) {
            doc.setFillColor(...C.panelLight);
            doc.roundedRect(x, y, w, h, 2, 2, 'F');
            doc.setDrawColor(...C.border);
            doc.setLineWidth(0.15);
            doc.roundedRect(x, y, w, h, 2, 2, 'S');
            // Value
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(...C.goldBright);
            doc.text(String(value), x + w / 2, y + h * 0.42, { align: 'center' });
            // Label
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(...C.textMuted);
            doc.text(label, x + w / 2, y + h * 0.75, { align: 'center' });
        }

        // Game icon size in PDF tables (mm)
        const GAME_ICON_SIZE = 5;

        // didDrawCell hook factory: draws game icon in a cell and shifts text right
        // colIndex = which column holds the game name
        // gameIdFn = function(rowIndex) -> gameId (to look up icon)
        function gameIconCellHook(colIndex, gameIdFn) {
            return function(data) {
                if (data.section === 'body' && data.column.index === colIndex) {
                    const gameId = gameIdFn(data.row.index);
                    const iconData = gameIconMap[gameId];
                    if (iconData) {
                        const iconY = data.cell.y + (data.cell.height - GAME_ICON_SIZE) / 2;
                        doc.addImage(iconData, 'PNG', data.cell.x + 2, iconY, GAME_ICON_SIZE, GAME_ICON_SIZE);
                    }
                }
            };
        }

        // Common autoTable base styles
        const tableBase = {
            fillColor: C.panel,
            textColor: C.text,
            lineColor: C.border,
            lineWidth: 0.15,
            fontSize: 8,
            cellPadding: 3,
            font: 'helvetica'
        };
        const tableHeadBase = {
            fillColor: C.headerBg,
            textColor: C.gold,
            fontStyle: 'bold',
            fontSize: 7.5
        };
        const tableAltRow = { fillColor: C.panelAlt };

        // Smaller table styles for player detail sub-tables
        const subTableBase = {
            fillColor: [10, 13, 22],
            textColor: C.text,
            lineColor: [28, 32, 46],
            lineWidth: 0.1,
            fontSize: 7.5,
            cellPadding: 2,
            font: 'helvetica'
        };
        const subTableHead = {
            fillColor: C.panelLight,
            textColor: C.gold,
            fontStyle: 'bold',
            fontSize: 7
        };

        // didParseCell hook for win-rate coloring
        function winRateHook(colIndex) {
            return function(data) {
                if (data.section === 'body' && data.column.index === colIndex) {
                    const rate = parseWinRate(data.cell.raw);
                    data.cell.styles.textColor = wrColor(rate);
                    data.cell.styles.fontStyle = 'bold';
                }
            };
        }

        // Page bg is now handled by the monkey-patched doc.addPage()
        // No need for drawnPages tracking or ensurePageBg

        // Build team color lookup: teamId -> RGB array
        const teamColorMap = {};
        (gameState.teams || []).forEach(t => {
            teamColorMap[t.id] = hexToRgb(t.color);
        });

        // ========================================================
        // PAGE 1: COVER
        // ========================================================
        progressText.textContent = 'Building cover page...';
        drawPageBg(); // Page 1 bg (created by new jsPDF, not addPage)

        const tournamentName = gameState.name || gameState.gameId || 'Tournament';
        const history = (gameState.gameHistory || []).filter(m => !m.isBreak);
        const teams = gameState.teams || [];

        // Top decorative gold bar
        doc.setFillColor(...C.gold);
        doc.rect(0, 0, pageW, 2.5, 'F');

        // Large logo on cover
        if (logoDataUrl) {
            doc.addImage(logoDataUrl, 'PNG', pageW / 2 - 12, 10, 24, 24);
        }

        // Tournament name
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.setTextColor(...C.goldBright);
        doc.text(tournamentName, pageW / 2, 42, { align: 'center' });

        // Subtitle
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...C.text);
        doc.text('Tournament Statistics Report', pageW / 2, 50, { align: 'center' });

        // ---- SIMPLIFIED HEX BOARD ----
        // Draw the final board state using jsPDF polygon drawing
        // Coordinate system matches board-module.js (pointy-top axial coords)
        // with flat-top hex shapes + 30° rotation (matching web CSS)
        const boardCenterX = pageW / 2;
        const boardCenterY = 118;
        const hexR = 4.8; // hex radius in mm
        const sqrt3 = Math.sqrt(3);
        const rot = 30 * Math.PI / 180; // 30-degree rotation to match web view
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);

        // Mountain heart and side heart locations
        const mountainHeart = 'q0r0';
        const sideHearts = ['q-4r2', 'q-2r-2', 'q2r-4', 'q4r-2', 'q2r2', 'q-2r4'];
        const startingLocs = ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0'];

        // Default hex colors
        const hexDefaultFill = [40, 44, 56];
        const hexStartFill = [55, 55, 65];
        const hexHeartFill = [130, 40, 55];
        const hexSideHeartFill = [120, 55, 75];
        const hexBorderColor = [24, 28, 40];

        // Draw hexagon helper using doc.lines() (safe API for jsPDF 2.5.x)
        function drawHex(cx, cy, r, fillRgb, strokeRgb) {
            const points = [];
            for (let i = 0; i < 6; i++) {
                // Flat-top hex vertices + 30° rotation (matching CSS container rotate(30deg))
                const angle = Math.PI / 3 * i + rot;
                points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
            }
            doc.setFillColor(...fillRgb);
            doc.setDrawColor(...(strokeRgb || hexBorderColor));
            doc.setLineWidth(0.3);
            // Build delta array for doc.lines()
            const deltas = [];
            for (let i = 1; i < points.length; i++) {
                deltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]]);
            }
            doc.lines(deltas, points[0][0], points[0][1], [1, 1], 'FD', true);
        }

        // Draw a small heart marker on special hexes
        function drawHeartMarker(cx, cy, size, rgb) {
            doc.setFillColor(...rgb);
            // Simple diamond/heart shape using a small filled circle
            doc.circle(cx, cy, size, 'F');
        }

        // Generate and draw all hexes
        for (let q = -5; q <= 5; q++) {
            const r1 = Math.max(-5, -q - 5);
            const r2 = Math.min(5, -q + 5);
            for (let r = r1; r <= r2; r++) {
                const coord = `q${q}r${r}`;

                // Pointy-top axial to pixel (matching board-module.js)
                const px = hexR * (3 / 2) * q;
                const py = hexR * sqrt3 * (r + q / 2);

                // Apply 30-degree rotation (matching web CSS transform)
                const rx = px * cosR - py * sinR;
                const ry = px * sinR + py * cosR;

                const cx = boardCenterX + rx;
                const cy = boardCenterY + ry;

                // Determine fill color
                let fill = hexDefaultFill;
                const teamId = gameState.board?.[coord];
                if (teamId && teamColorMap[teamId]) {
                    // Blend team color with a darker base for the hex look
                    const tc = teamColorMap[teamId];
                    fill = [
                        Math.round(tc[0] * 0.7 + 20),
                        Math.round(tc[1] * 0.7 + 20),
                        Math.round(tc[2] * 0.7 + 20)
                    ];
                } else if (coord === mountainHeart) {
                    fill = hexHeartFill;
                } else if (sideHearts.includes(coord)) {
                    fill = hexSideHeartFill;
                } else if (startingLocs.includes(coord)) {
                    fill = hexStartFill;
                }

                drawHex(cx, cy, hexR * 0.92, fill, hexBorderColor);

                // Draw heart markers on special hexes (circles since Helvetica lacks ♥)
                if (coord === mountainHeart) {
                    drawHeartMarker(cx - 1.2, cy, 1.2, [255, 255, 255]);
                    drawHeartMarker(cx + 1.2, cy, 1.2, [255, 255, 255]);
                } else if (sideHearts.includes(coord)) {
                    drawHeartMarker(cx, cy, 1.0, [255, 255, 255]);
                }
            }
        }

        // ---- META INFO BELOW BOARD ----
        const metaY = boardCenterY + 58;
        doc.setFontSize(8);
        doc.setTextColor(...C.textMuted);
        const metaText = `Rounds: ${gameState.currentRound || 0}  |  Matches: ${history.length}  |  Players: ${Object.keys(gameState.players || {}).length}`;
        doc.text(metaText, pageW / 2, metaY, { align: 'center' });

        const genDate = `Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        doc.text(genDate, pageW / 2, metaY + 5, { align: 'center' });

        // ---- TEAMS WITH PLAYERS ----
        if (teams.length > 0) {
            const teamsY = metaY + 14;
            const colW = contentW / teams.length;

            teams.forEach((team, i) => {
                const tx = margin + colW * i + colW / 2;
                const rgb = teamColorMap[team.id] || C.textMuted;

                // Team color dot
                doc.setFillColor(...rgb);
                doc.circle(tx, teamsY, 2, 'F');

                // Team name
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.5);
                doc.setTextColor(...rgb);
                doc.text(team.name || 'Team', tx, teamsY + 5.5, { align: 'center' });

                // Player names under team
                const teamPlayers = Object.values(gameState.players || {})
                    .filter(p => String(p.teamId) === String(team.id));
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(...C.text);
                teamPlayers.forEach((player, j) => {
                    doc.text(player.name || 'Player', tx, teamsY + 10 + j * 4, { align: 'center' });
                });
            });
        }

        // Bottom of page tagline
        doc.setFontSize(7);
        doc.setTextColor(...C.textDim);
        doc.text('BoardGame Tournament System', pageW / 2, pageH - 15, { align: 'center' });

        // ========================================================
        // PAGE 2: TEAM STANDINGS + SUMMARY + H2H
        // ========================================================
        progressText.textContent = 'Building team standings...';
        let y = addPage();

        y = sectionTitle(y, 'Team Standings');

        if (teams.length > 0) {
            const sortedTeams = [...teams].sort((a, b) => {
                const totalA = (a.points || 0) + (a.gamesWon || 0);
                const totalB = (b.points || 0) + (b.gamesWon || 0);
                if (totalB !== totalA) return totalB - totalA;
                return (b.gamesWon || 0) - (a.gamesWon || 0);
            });

            // Store sorted team data for color hook
            const sortedTeamColors = sortedTeams.map(t => teamColorMap[t.id] || C.text);

            const standingsData = sortedTeams.map((team, i) => {
                const victoryPts = team.gamesWon || 0;
                const hexPts = team.points || 0;
                const losses = team.gamesLost || 0;
                const played = team.gamesPlayed || (victoryPts + losses);
                const winRate = played > 0 ? ((victoryPts / played) * 100).toFixed(0) + '%' : '0%';
                const hexCount = Object.values(gameState.board || {}).filter(t => t === team.id).length;

                return [
                    String(i + 1),
                    team.name || 'Team ' + team.id,
                    String(victoryPts + hexPts),
                    String(victoryPts),
                    String(hexPts),
                    `${victoryPts}-${losses}`,
                    winRate,
                    String(hexCount)
                ];
            });

            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin },
                head: [['#', 'Team', 'Total', 'Wins', 'Hex Pts', 'W-L', 'Win %', 'Hexes']],
                body: standingsData,
                styles: { ...tableBase, fontSize: 9, cellPadding: 3.5 },
                headStyles: { ...tableHeadBase, fontSize: 8 },
                alternateRowStyles: tableAltRow,
                columnStyles: {
                    0: { halign: 'center', cellWidth: 10 },
                    2: { halign: 'center', fontStyle: 'bold', textColor: C.goldBright },
                    3: { halign: 'center' },
                    4: { halign: 'center' },
                    5: { halign: 'center' },
                    6: { halign: 'center' },
                    7: { halign: 'center' }
                },
                didParseCell: function(data) {
                    // Rank medal colors
                    if (data.section === 'body' && data.column.index === 0) {
                        const rank = parseInt(data.cell.raw);
                        if (rank === 1) data.cell.styles.textColor = [255, 215, 0];
                        else if (rank === 2) data.cell.styles.textColor = [192, 192, 192];
                        else if (rank === 3) data.cell.styles.textColor = [205, 127, 50];
                    }
                    // Team name in team color
                    if (data.section === 'body' && data.column.index === 1) {
                        data.cell.styles.textColor = sortedTeamColors[data.row.index] || C.textBright;
                        data.cell.styles.fontStyle = 'bold';
                    }
                    // Win rate coloring
                    if (data.section === 'body' && data.column.index === 6) {
                        const rate = parseWinRate(data.cell.raw);
                        data.cell.styles.textColor = wrColor(rate);
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            });

            y = doc.lastAutoTable.finalY + 12;
        }

        // ---- TOURNAMENT SUMMARY (Stat Boxes) ----
        y = sectionTitle(y, 'Tournament Summary');

        const pdfAllDurations = history
            .filter(m => m.matchDuration?.durationMinutes != null)
            .map(m => m.matchDuration.durationMinutes);
        const pdfDurations = pdfAllDurations.filter(d => d >= MIN_DURATION_MINUTES);
        const avgDuration = pdfDurations.length > 0
            ? Math.round(pdfDurations.reduce((a, b) => a + b, 0) / pdfDurations.length)
            : null;
        const challenges = history.filter(m => m.isChallenge).length;

        const summaryData = [
            [String(history.length), 'Total Matches'],
            [String(gameState.currentRound || 0), 'Total Rounds'],
            [avgDuration ? `${avgDuration}m` : 'N/A', avgDuration ? `Avg Duration (${pdfDurations.length}/${pdfAllDurations.length})` : 'Avg Duration'],
            [String(challenges), 'Challenges'],
            [String(Object.keys(gameState.players || {}).length), 'Players'],
            [String(teams.length), 'Teams']
        ];

        y = checkPage(y, 30);
        const boxW = (contentW - 10) / 3;
        const boxH = 18;
        const boxGap = 5;
        summaryData.forEach(([value, label], i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const bx = margin + col * (boxW + boxGap);
            const by = y + row * (boxH + boxGap);
            drawStatBox(bx, by, boxW, boxH, value, label);
        });
        y += 2 * (boxH + boxGap) + 6;

        // ---- HEAD-TO-HEAD MATRIX ----
        y = sectionTitle(y, 'Head-to-Head Records');

        if (teams.length > 0 && history.length > 0) {
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
                winners.forEach(winnerId => {
                    losers.forEach(loserId => {
                        if (h2h[winnerId]?.[loserId]) h2h[winnerId][loserId].wins++;
                        if (h2h[loserId]?.[winnerId]) h2h[loserId][winnerId].losses++;
                    });
                });
            });

            const h2hHead = [['', ...teams.map(t => t.name || 'T' + t.id)]];
            const h2hBody = teams.map(rowTeam => {
                const row = [rowTeam.name || 'Team ' + rowTeam.id];
                teams.forEach(colTeam => {
                    if (rowTeam.id === colTeam.id) {
                        row.push('-');
                    } else {
                        const record = h2h[rowTeam.id][colTeam.id];
                        row.push(`${record.wins}-${record.losses}`);
                    }
                });
                return row;
            });

            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin },
                head: h2hHead,
                body: h2hBody,
                styles: { ...tableBase, fontSize: 8, halign: 'center' },
                headStyles: tableHeadBase,
                alternateRowStyles: tableAltRow,
                columnStyles: {
                    0: { halign: 'left', fontStyle: 'bold' }
                },
                didParseCell: function(data) {
                    // Team name column in team color
                    if (data.section === 'body' && data.column.index === 0) {
                        data.cell.styles.textColor = teamColorMap[teams[data.row.index]?.id] || C.textBright;
                    }
                    // Header team names in team color
                    if (data.section === 'head' && data.column.index > 0) {
                        data.cell.styles.textColor = teamColorMap[teams[data.column.index - 1]?.id] || C.gold;
                    }
                    // Cell value coloring
                    if (data.section === 'body' && data.column.index > 0) {
                        const cellText = data.cell.raw;
                        if (cellText === '-') {
                            data.cell.styles.textColor = C.textDim;
                        } else {
                            const parts = cellText.split('-').map(Number);
                            if (parts.length === 2) {
                                if (parts[0] > parts[1]) data.cell.styles.textColor = C.win;
                                else if (parts[0] < parts[1]) data.cell.styles.textColor = C.loss;
                                else data.cell.styles.textColor = C.goldDim;
                            }
                        }
                    }
                }
            });

            y = doc.lastAutoTable.finalY + 14;
        }

        // ========================================================
        // INDIVIDUAL PLAYER STATISTICS
        // ========================================================
        progressText.textContent = 'Building player statistics...';
        y = addPage();
        y = sectionTitle(y, 'Individual Player Statistics');

        if (playerStatsCache) {
            // Sort players: by team order first, then by wins within each team
            const allPlayers = Object.values(playerStatsCache)
                .filter(p => p.gamesPlayed > 0)
                .sort((a, b) => {
                    const teamDiff = getTeamIndex(a.teamId) - getTeamIndex(b.teamId);
                    if (teamDiff !== 0) return teamDiff;
                    return b.wins - a.wins;
                });

            const playerTableData = allPlayers.map((player, i) => {
                const team = getTeamById(player.teamId);
                const winRate = player.gamesPlayed > 0
                    ? (player.winRate).toFixed(0) + '%'
                    : '0%';

                return [
                    String(i + 1),
                    player.name,
                    team?.name || 'Unknown',
                    String(player.gamesPlayed),
                    String(player.wins),
                    String(player.losses),
                    winRate,
                    String(player.bestWinStreak)
                ];
            });

            // Build color array matching player order for the table hook
            const playerTeamColors = allPlayers.map(p => teamColorMap[p.teamId] || C.text);

            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin },
                head: [['#', 'Player', 'Team', 'Games', 'Wins', 'Losses', 'Win %', 'Streak']],
                body: playerTableData,
                styles: { ...tableBase, cellPadding: 2.8 },
                headStyles: tableHeadBase,
                alternateRowStyles: tableAltRow,
                columnStyles: {
                    0: { halign: 'center', cellWidth: 8 },
                    1: { fontStyle: 'bold' },
                    3: { halign: 'center' },
                    4: { halign: 'center', textColor: C.win },
                    5: { halign: 'center', textColor: C.loss },
                    6: { halign: 'center' },
                    7: { halign: 'center' }
                },
                didParseCell: function(data) {
                    if (data.section !== 'body') return;
                    const rowIdx = data.row.index;
                    const tc = playerTeamColors[rowIdx];
                    // Player name in team color
                    if (data.column.index === 1) {
                        data.cell.styles.textColor = tc;
                    }
                    // Team name in team color
                    if (data.column.index === 2) {
                        data.cell.styles.textColor = tc;
                    }
                    // Rank medal colors
                    if (data.column.index === 0) {
                        const rank = parseInt(data.cell.raw);
                        if (rank === 1) data.cell.styles.textColor = [255, 215, 0];
                        else if (rank === 2) data.cell.styles.textColor = [192, 192, 192];
                        else if (rank === 3) data.cell.styles.textColor = [205, 127, 50];
                    }
                    // Win rate coloring
                    if (data.column.index === 6) {
                        const rate = parseWinRate(data.cell.raw);
                        data.cell.styles.textColor = wrColor(rate);
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            });

            y = doc.lastAutoTable.finalY + 12;

            // ---- DETAILED PLAYER CARDS (one page per player) ----
            progressText.textContent = 'Building detailed player profiles...';

            for (const player of allPlayers) {
                // Force new page for each player
                y = addPage();
        
                const team = getTeamById(player.teamId);
                const tc = teamColorMap[player.teamId] || C.gold;
                y = playerHeader(y, player.name, team?.name || 'Unknown Team', tc);

                // Core stats as key-value pairs
                const winRate = player.gamesPlayed > 0 ? player.winRate.toFixed(0) : '0';
                const statsLine = [
                    `Games: ${player.gamesPlayed}`,
                    `Wins: ${player.wins}`,
                    `Losses: ${player.losses}`,
                    `Win Rate: ${winRate}%`,
                    `Best Streak: ${player.bestWinStreak}`
                ].join('  |  ');
                y = bodyText(y, statsLine);

                if (player.avgDuration) {
                    y = bodyText(y, `Avg Match Duration: ${player.avgDuration} min (${player.durationDataPoints}/${player.durationTotalPoints} matches)`);
                }
                if (player.challenges.played > 0) {
                    y = bodyText(y, `Challenges: ${player.challenges.won}W - ${player.challenges.lost}L (${player.challenges.played} total)`);
                }

                // Performance by game table
                const gameEntries = Object.entries(player.byGame);
                if (gameEntries.length > 0) {
                    y += 2;
                    const sortedPlayerGames = gameEntries.sort((a, b) => b[1].played - a[1].played);
                    const playerGameIds = sortedPlayerGames.map(([game]) => game);
                    const gameData = sortedPlayerGames.map(([game, stats]) => {
                            const wr = stats.played > 0 ? ((stats.won / stats.played) * 100).toFixed(0) + '%' : '0%';
                            return ['  ' + getGameDisplayName(game), `${stats.won}-${stats.lost}`, wr];
                        });

                    doc.autoTable({
                        startY: y,
                        margin: { left: margin + 2, right: margin + 2 },
                        head: [['Game', 'W-L', 'Win %']],
                        body: gameData,
                        styles: subTableBase,
                        headStyles: subTableHead,
                        alternateRowStyles: { fillColor: [14, 17, 28] },
                        columnStyles: {
                            0: { cellPadding: { left: GAME_ICON_SIZE + 3, top: 2, right: 2, bottom: 2 } },
                            1: { halign: 'center' },
                            2: { halign: 'center' }
                        },
                        tableWidth: contentW * 0.55,
                        didParseCell: winRateHook(2),
                        didDrawCell: gameIconCellHook(0, (rowIdx) => playerGameIds[rowIdx])
                    });

                    y = doc.lastAutoTable.finalY + 4;
                }

                // H2H vs opponents table
                const opponentEntries = Object.entries(player.vsOpponents).filter(([_, r]) => r.played > 0);
                if (opponentEntries.length > 0) {
                    const h2hData = opponentEntries
                        .sort((a, b) => b[1].played - a[1].played)
                        .map(([opId, record]) => {
                            const opName = playerStatsCache[opId]?.name || 'Unknown';
                            const wr = record.played > 0 ? ((record.won / record.played) * 100).toFixed(0) + '%' : '0%';
                            return [opName, `${record.won}-${record.lost}`, wr];
                        });

                    doc.autoTable({
                        startY: y,
                        margin: { left: margin + 2, right: margin + 2 },
                        head: [['Opponent', 'W-L', 'Win %']],
                        body: h2hData,
                        styles: subTableBase,
                        headStyles: subTableHead,
                        alternateRowStyles: { fillColor: [14, 17, 28] },
                        columnStyles: {
                            0: {},
                            1: { halign: 'center' },
                            2: { halign: 'center' }
                        },
                        tableWidth: contentW * 0.55,
                                didParseCell: function(data) {
                            // Win rate column color
                            if (data.section === 'body' && data.column.index === 2) {
                                const rate = parseWinRate(data.cell.raw);
                                data.cell.styles.textColor = wrColor(rate);
                                data.cell.styles.fontStyle = 'bold';
                            }
                            // Opponent name in their team color
                            if (data.section === 'body' && data.column.index === 0) {
                                const opName = data.cell.raw;
                                const opEntry = Object.values(playerStatsCache).find(p => p.name === opName);
                                if (opEntry) {
                                    data.cell.styles.textColor = teamColorMap[opEntry.teamId] || C.text;
                                }
                            }
                        }
                    });

                    y = doc.lastAutoTable.finalY + 4;
                }
            }
        }

        // ========================================================
        // MATCH HISTORY
        // ========================================================
        progressText.textContent = 'Building match history...';
        y = addPage();
        y = sectionTitle(y, 'Match History');

        if (history.length > 0) {
            const sortedMatches = [...history].sort((a, b) =>
                new Date(a.timestamp) - new Date(b.timestamp)
            );

            function pdfResolvePlayers(match, side) {
                if (side === 'winners') {
                    if (match.winningPlayerIds?.length > 0) {
                        return match.winningPlayerIds.map(id => getPlayerNameById(id)).filter(n => n !== 'Unknown').join(', ');
                    }
                    if (match.winningPlayers?.length > 0) {
                        return match.winningPlayers.map(p => p.name || '?').join(', ');
                    }
                    return (match.winningTeamIds || []).map(id => getTeamName(id)).join(' & ');
                } else {
                    if (match.losingPlayerIds?.length > 0) {
                        return match.losingPlayerIds.map(id => getPlayerNameById(id)).filter(n => n !== 'Unknown').join(', ');
                    }
                    if (match.losingPlayers?.length > 0) {
                        return match.losingPlayers.map(p => p.name || '?').join(', ');
                    }
                    return (match.losingTeamIds || []).map(id => getTeamName(id)).join(' & ');
                }
            }

            // Pre-compute per-player team colors for match history
            function resolvePlayerColorList(playerIds, fallbackPlayers, teamIds) {
                const results = [];
                if (playerIds?.length > 0) {
                    playerIds.forEach(id => {
                        const player = gameState.players?.[id];
                        const name = player?.name || getPlayerNameById(id);
                        const color = player?.teamId ? (teamColorMap[player.teamId] || C.text) : C.text;
                        results.push({ name, color });
                    });
                } else if (fallbackPlayers?.length > 0) {
                    fallbackPlayers.forEach(p => {
                        results.push({ name: p.name || '?', color: C.text });
                    });
                } else if (teamIds?.length > 0) {
                    teamIds.forEach(id => {
                        results.push({ name: getTeamName(id), color: teamColorMap[id] || C.text });
                    });
                }
                return results;
            }
            const matchPlayerColors = sortedMatches.map(match => ({
                winners: resolvePlayerColorList(match.winningPlayerIds, match.winningPlayers, match.winningTeamIds),
                losers: resolvePlayerColorList(match.losingPlayerIds, match.losingPlayers, match.losingTeamIds)
            }));

            const matchData = sortedMatches.map(match => {
                function pdfFormatDT(ts) {
                    if (!ts) return '-';
                    const d = new Date(ts);
                    if (isNaN(d)) return '-';
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const mo = String(d.getMonth() + 1).padStart(2, '0');
                    const yyyy = d.getFullYear();
                    return `${hh}:${mm} ${dd}.${mo}`;
                }

                const duration = match.matchDuration?.durationMinutes
                    ? `${match.matchDuration.durationMinutes} min`
                    : '-';
                const startStr = pdfFormatDT(match.matchDuration?.startedAt);
                const endStr = pdfFormatDT(match.matchDuration?.endedAt || match.timestamp);

                return [
                    '#' + (match.id || match.matchNumber || '?'),
                    '  ' + getGameDisplayName(match.game),
                    match.playType || '-',
                    pdfResolvePlayers(match, 'winners'),
                    pdfResolvePlayers(match, 'losers'),
                    duration,
                    startStr !== '-' ? startStr : '-',
                    endStr
                ];
            });

            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin },
                head: [['#', 'Game', 'Format', 'Winners', 'Losers', 'Min', 'Started', 'Ended']],
                body: matchData,
                styles: { ...tableBase, fontSize: 6.5, cellPadding: 2.2 },
                headStyles: { ...tableHeadBase, fontSize: 6.5 },
                alternateRowStyles: tableAltRow,
                columnStyles: {
                    0: { cellWidth: 9, halign: 'center' },
                    1: { cellPadding: { left: GAME_ICON_SIZE + 3, top: 2.2, right: 2.2, bottom: 2.2 } },
                    2: { cellWidth: 12, halign: 'center' },
                    3: { fontSize: 6.5 },
                    5: { cellWidth: 11, halign: 'center' },
                    6: { cellWidth: 26, halign: 'center', fontSize: 6 },
                    7: { cellWidth: 26, halign: 'center', fontSize: 6 }
                },
                didParseCell: function(data) {
                    if (data.section !== 'body') return;
                    // Hide default text for winner/loser columns (we draw manually in didDrawCell)
                    if (data.column.index === 3 || data.column.index === 4) {
                        data.cell.styles.textColor = data.cell.styles.fillColor || C.panel;
                    }
                },
                didDrawCell: function(data) {
                    // Game icons
                    if (data.section === 'body' && data.column.index === 1) {
                        const gameId = sortedMatches[data.row.index]?.game;
                        const iconData = gameIconMap[gameId];
                        if (iconData) {
                            const iconY = data.cell.y + (data.cell.height - GAME_ICON_SIZE) / 2;
                            doc.addImage(iconData, 'PNG', data.cell.x + 2, iconY, GAME_ICON_SIZE, GAME_ICON_SIZE);
                        }
                    }
                    // Draw player names with individual team colors
                    if (data.section === 'body' && (data.column.index === 3 || data.column.index === 4)) {
                        const pc = matchPlayerColors[data.row.index];
                        const players = data.column.index === 3 ? pc?.winners : pc?.losers;
                        if (players?.length > 0) {
                            const fs = data.cell.styles.fontSize || 6.5;
                            doc.setFontSize(fs);
                            doc.setFont('helvetica', 'normal');
                            const padLeft = typeof data.cell.padding === 'function' ? data.cell.padding('left') : 2.2;
                            let curX = data.cell.x + padLeft;
                            const textY = data.cell.y + data.cell.height / 2 + fs * 0.353 / 2;
                            players.forEach((p, idx) => {
                                doc.setTextColor(...p.color);
                                doc.text(p.name, curX, textY);
                                curX += doc.getTextWidth(p.name);
                                if (idx < players.length - 1) {
                                    doc.setTextColor(...C.textMuted);
                                    doc.text(', ', curX, textY);
                                    curX += doc.getTextWidth(', ');
                                }
                            });
                        }
                    }
                }
            });

            y = doc.lastAutoTable.finalY + 14;
        }

        // ========================================================
        // GAME ANALYSIS
        // ========================================================
        // Start Game Analysis on a fresh page to avoid overflow issues
        y = addPage();
        y = sectionTitle(y, 'Game Analysis');

        if (history.length > 0) {
            const gameCounts = {};
            const gameDurations = {};

            history.forEach(match => {
                const game = match.game || 'Unknown';
                gameCounts[game] = (gameCounts[game] || 0) + 1;
                if (match.matchDuration?.durationMinutes != null) {
                    gameDurations[game] = gameDurations[game] || [];
                    gameDurations[game].push(match.matchDuration.durationMinutes);
                }
            });

            const sortedGameEntries = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);
            const gameAnalysisIds = sortedGameEntries.map(([game]) => game);
            const gameData = sortedGameEntries.map(([game, count]) => {
                    const allDur = gameDurations[game] || [];
                    const validDur = allDur.filter(d => d >= MIN_DURATION_MINUTES);
                    const avg = validDur.length > 0
                        ? Math.round(validDur.reduce((a, b) => a + b, 0) / validDur.length) + `m (${validDur.length}/${allDur.length})`
                        : '-';
                    const pct = ((count / history.length) * 100).toFixed(0) + '%';
                    return ['  ' + getGameDisplayName(game), String(count), pct, avg];
                });

            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin },
                head: [['Game', 'Matches', '% of Total', 'Avg Duration']],
                body: gameData,
                styles: { ...tableBase, fontSize: 9, cellPadding: 3.5 },
                headStyles: { ...tableHeadBase, fontSize: 8 },
                alternateRowStyles: tableAltRow,
                columnStyles: {
                    0: { fontStyle: 'bold', textColor: C.textBright, cellPadding: { left: GAME_ICON_SIZE + 4, top: 3.5, right: 3.5, bottom: 3.5 } },
                    1: { halign: 'center', fontStyle: 'bold', textColor: C.goldBright },
                    2: { halign: 'center' },
                    3: { halign: 'center' }
                },
                tableWidth: contentW * 0.75,
                didDrawCell: gameIconCellHook(0, (rowIdx) => gameAnalysisIds[rowIdx])
            });

            y = doc.lastAutoTable.finalY + 3;
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(...C.textDim);
            doc.text(`* Avg duration counts only matches with ${MIN_DURATION_MINUTES}+ minutes playtime`, margin, y);
        }

        // ========================================================
        // FOOTER on all pages
        // ========================================================
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            // Gold accent line above footer
            doc.setDrawColor(...C.borderGold);
            doc.setLineWidth(0.2);
            doc.line(margin + 20, pageH - 13, pageW - margin - 20, pageH - 13);
            // Footer text
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...C.textMuted);
            doc.text(
                `${tournamentName} — Tournament Statistics Report — Page ${i} of ${totalPages}`,
                pageW / 2, pageH - 8,
                { align: 'center' }
            );
        }

        // Save
        progressText.textContent = 'Downloading PDF...';
        doc.save(`${(tournamentName || 'tournament').replace(/[^a-zA-Z0-9]/g, '_')}_statistics.pdf`);

        overlay.classList.add('hidden');
        showToast('PDF generated successfully!', 'success');

    } catch (error) {
        console.error('PDF generation error:', error);
        overlay.classList.add('hidden');
        showToast('Failed to generate PDF: ' + error.message, 'error');
    }
}
