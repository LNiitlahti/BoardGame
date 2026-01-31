/**
 * ============================================================================
 * ADMIN-LIGHTWEIGHT.JS
 * ============================================================================
 * Simplified tournament management - no spells, no complex rules
 * Focus: matches, results, board control, scoring
 * ============================================================================
 */

// =============================================================================
// GLOBAL STATE
// =============================================================================

let gameState = null;
let activeListener = null;
let boardModule = null;
let boardRenderer = null;
let currentUser = null;
let currentTournamentId = null;

// Match creation state - dynamic array of sides
let manualGameSetup = {
    sides: [[], []] // Start with 2 sides (A, B)
};

// Side labels for display
const SIDE_LABELS = ['A', 'B', 'C', 'D', 'E'];

// Queue drag state
let draggedQueueId = null;

// Selected match for confirmation
let selectedQueuedGame = null;

// Pending auto-generated match
let pendingAutoMatch = null;

// Hex picker state
let selectedHexCoord = null;

// Game ID to display name mapping (fallback for built-in games)
const GAME_NAME_MAP = {
    'cs2': 'Counter-Strike 2',
    'CS2': 'Counter-Strike 2',
    'dota2': 'Dota 2',
    'Dota2': 'Dota 2',
    'valorant': 'Valorant',
    'Valorant': 'Valorant',
    'sc2': 'StarCraft II',
    'starcraft2': 'StarCraft II',
    'StarCraft2': 'StarCraft II',
    'predecessor': 'Predecessor',
    'Predecessor': 'Predecessor'
};

/**
 * Get display name for a game ID
 * Checks tournament's gameDefinitions first, then falls back to GAME_NAME_MAP
 */
function getGameDisplayName(gameId) {
    // First check if tournament has game definitions (for custom games)
    if (gameState?.gameDefinitions && gameState.gameDefinitions[gameId]) {
        return gameState.gameDefinitions[gameId].name;
    }
    // Fall back to built-in mapping
    return GAME_NAME_MAP[gameId] || gameId;
}

/**
 * Get players from a match team - supports both old and new formats
 * Old format: team.players = [{ name, originalTeamId, originalTeamColor, ... }]
 * New format: team.playerIds = ["p_abc123", "p_def456"]
 * @param {Object} matchTeam - Team object from gameQueue entry
 * @returns {Object[]} Array of player objects with id, name, teamId, teamColor
 */
function getMatchTeamPlayers(matchTeam) {
    if (!matchTeam) return [];

    // New format: playerIds - resolve from registry
    if (matchTeam.playerIds && Array.isArray(matchTeam.playerIds)) {
        return matchTeam.playerIds.map(playerId => {
            if (window.PlayerUtils) {
                const info = window.PlayerUtils.getPlayerDisplayInfo(gameState, playerId);
                return {
                    id: playerId,
                    name: info.name,
                    teamId: info.teamId,
                    originalTeamId: info.teamId,
                    teamColor: info.teamColor,
                    originalTeamColor: info.teamColor,
                    teamName: info.teamName,
                    originalTeamName: info.teamName
                };
            }
            // Fallback if PlayerUtils not loaded
            const player = gameState?.players?.[playerId];
            const team = player ? gameState?.teams?.find(t => t.id === player.teamId) : null;
            return {
                id: playerId,
                name: player?.name || 'Unknown',
                teamId: player?.teamId,
                originalTeamId: player?.teamId,
                teamColor: team?.color || '#666666',
                originalTeamColor: team?.color || '#666666',
                teamName: team?.name,
                originalTeamName: team?.name
            };
        });
    }

    // Old format: players array - return as-is with backward compatibility
    if (matchTeam.players && Array.isArray(matchTeam.players)) {
        return matchTeam.players.map(p => ({
            id: p.id || null,
            name: p.name,
            teamId: p.originalTeamId || p.teamId,
            originalTeamId: p.originalTeamId || p.teamId,
            teamColor: p.originalTeamColor || p.teamColor,
            originalTeamColor: p.originalTeamColor || p.teamColor,
            teamName: p.originalTeamName || p.teamName,
            originalTeamName: p.originalTeamName || p.teamName
        }));
    }

    return [];
}

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('firebase-ready', async function() {
    console.log('Firebase ready, initializing admin-lightweight...');

    // Check authentication
    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        currentUser = user;

        // Check role
        try {
            const userDoc = await window.firebaseDB.collection('users').doc(user.uid).get();
            const userData = userDoc.data();

            if (!userData || (!userData.isGod && !userData.isAdmin)) {
                alert('Access denied. God or Admin role required.');
                window.location.href = 'home.html';
                return;
            }

            // Update UI
            document.getElementById('userName').textContent = userData.displayName || user.email;
            document.getElementById('roleBadge').textContent = userData.isGod ? 'GOD' : 'ADMIN';
            document.getElementById('roleBadge').className = `navbar-role-badge ${userData.isGod ? 'god' : 'admin'}`;

            // Initialize modules
            initializeBoardModules();

            // Load tournaments
            await loadTournamentsList();

            // Check URL for tournament ID
            const urlParams = new URLSearchParams(window.location.search);
            const tournamentId = urlParams.get('tournamentId');

            if (tournamentId) {
                document.getElementById('tournamentSelect').value = tournamentId;
                await loadTournament(tournamentId);
            }

            // Hide loading overlay
            document.getElementById('loadingOverlay').classList.add('hidden');

        } catch (error) {
            console.error('Error checking user role:', error);
            showStatus('Error loading user data', 'error');
        }
    });
});

function initializeBoardModules() {
    boardModule = new BoardModule(1);

    const hexBoardContainer = document.getElementById('hexBoard');
    boardRenderer = new BoardRenderer(hexBoardContainer, boardModule, {
        responsive: true,
        showHeartImages: true
    });

    // Initial empty render
    boardRenderer.render({});

    // Initialize effects panel
    initEffectsPanel();
}

/**
 * Apply hex terrain images dynamically via CSS
 * Creates coordinate-specific background-image rules for each hex
 */
function applyHexImages(enabled) {
    let styleEl = document.getElementById('hex-images-dynamic-css');

    if (!enabled) {
        if (styleEl) styleEl.remove();
        return;
    }

    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'hex-images-dynamic-css';
        document.head.appendChild(styleEl);
    }

    // Generate CSS rules for each hex coordinate
    const hexCoords = boardModule.generateHexCoordinates();
    let css = '';

    hexCoords.forEach(([q, r]) => {
        const coord = `q${q}r${r}`;
        css += `body.effect-hex-images .board-hex[data-coord="${coord}"]::before {
            background-image: url('images/hexes/coords/${coord}.png');
        }\n`;
    });

    styleEl.textContent = css;
}

/**
 * Initialize the visual effects panel
 */
function initEffectsPanel() {
    document.querySelectorAll('.effect-btn').forEach(btn => {
        const effectName = btn.dataset.effect;

        // Apply initial state for buttons that start active
        if (btn.classList.contains('active')) {
            document.body.classList.add(`effect-${effectName}`);
            // Special handling for hex-images
            if (effectName === 'hex-images') {
                applyHexImages(true);
            }
            // Special handling for heart-images
            if (effectName === 'heart-images' && boardRenderer) {
                boardRenderer.toggleHeartImages(true);
            }
        }

        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            const isActive = btn.classList.contains('active');

            // Toggle body class for CSS effects
            document.body.classList.toggle(`effect-${effectName}`, isActive);

            // Special handling for hex-images (generates dynamic CSS)
            if (effectName === 'hex-images') {
                applyHexImages(isActive);
            }

            // Special handling for heart-images (uses renderer method)
            if (effectName === 'heart-images' && boardRenderer) {
                boardRenderer.toggleHeartImages(isActive);
            }

            console.log(`Effect "${effectName}": ${isActive ? 'ON' : 'OFF'}`);
        });
    });
}

// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

async function loadTournamentsList() {
    try {
        const tournamentsRef = window.firebaseDB.collection('tournaments');
        const snapshot = await tournamentsRef.get();

        const select = document.getElementById('tournamentSelect');
        select.innerHTML = '<option value="">Select a tournament...</option>';

        snapshot.forEach(doc => {
            const data = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `${data.name || doc.id} (${data.status || 'unknown'})`;
            select.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading tournaments:', error);
        showStatus('Error loading tournaments list', 'error');
    }
}

async function refreshTournaments() {
    showStatus('Refreshing tournaments...', 'info');
    await loadTournamentsList();
    showStatus('Tournaments refreshed', 'success');
}

function onTournamentSelect(tournamentId) {
    if (tournamentId) {
        loadTournament(tournamentId);

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('tournamentId', tournamentId);
        window.history.pushState({}, '', url);
    }
}

async function loadTournament(tournamentId) {
    if (!tournamentId) return;

    // Cleanup previous listener
    if (activeListener) {
        activeListener();
        activeListener = null;
    }

    currentTournamentId = tournamentId;
    showStatus('Loading tournament...', 'info');

    try {
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(tournamentId);

        // Set up real-time listener
        activeListener = window.firebaseOnSnapshot(tournamentRef, async (docSnapshot) => {
            if (docSnapshot.exists) {
                gameState = docSnapshot.data();
                gameState.tournamentId = tournamentId;

                // Check if migration to normalized players is needed
                if (window.PlayerUtils && window.PlayerUtils.needsPlayerMigration(gameState)) {
                    console.log('Migrating tournament to normalized player structure...');
                    window.PlayerUtils.migrateToNormalizedPlayers(gameState);
                    await saveGameState();
                    showStatus('Tournament migrated to new format', 'info');
                }

                // Update connection status
                updateConnectionStatus('connected');

                // Update all displays
                updateDisplay();

                // Apply custom team colors from Firebase
                applyTeamColors();

                showStatus('Tournament loaded', 'success');
            } else {
                showStatus('Tournament not found', 'error');
                gameState = null;
            }
        }, (error) => {
            console.error('Listener error:', error);
            updateConnectionStatus('disconnected');
            showStatus('Connection error', 'error');
        });

    } catch (error) {
        console.error('Error loading tournament:', error);
        showStatus('Error loading tournament', 'error');
    }
}

// =============================================================================
// DISPLAY UPDATES
// =============================================================================

function updateDisplay() {
    if (!gameState) return;

    // Load room hexes into board module if available
    if (gameState.rooms && boardModule) {
        boardModule.setRoomHexes(gameState.rooms);
    }

    // Update navbar
    document.getElementById('navTournamentName').textContent = gameState.name || 'Tournament';

    // Update round info
    document.getElementById('currentRound').textContent = gameState.currentRound || 0;
    document.getElementById('gamesPlayed').textContent = gameState.gamesPlayed || 0;

    // Count hexes
    const hexCount = Object.keys(gameState.board || {}).length;
    document.getElementById('hexCount').textContent = hexCount;

    // Count hearts controlled
    const heartsControlled = Object.keys(gameState.heartHexControl || {}).length;
    document.getElementById('heartsControlled').textContent = heartsControlled;

    // Update game type dropdown
    updateGameTypeDropdown();

    // Update teams
    renderTeamsList();

    // Update board
    renderBoard();

    // Update queue
    renderMatchQueue();

    // Render match creation zones (in case sides changed)
    renderMatchCreationZones();
}

/**
 * Populate game type dropdown from tournament's selectedGames
 */
function updateGameTypeDropdown() {
    const select = document.getElementById('gameType');
    const selectedGames = gameState?.selectedGames || [];

    // If no games defined, show placeholder
    if (selectedGames.length === 0) {
        select.innerHTML = '<option value="">No games defined in tournament</option>';
        return;
    }

    // Build options from tournament's selected games
    select.innerHTML = selectedGames.map(gameId => {
        const displayName = getGameDisplayName(gameId);
        return `<option value="${gameId}">${displayName}</option>`;
    }).join('');
}

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionStatus');
    indicator.classList.remove('connected', 'disconnected', 'warning');
    indicator.classList.add(status);
    indicator.title = `Firebase: ${status}`;
}

// =============================================================================
// TEAMS DISPLAY
// =============================================================================

function renderTeamsList() {
    const container = document.getElementById('teamsList');

    if (!gameState?.teams || gameState.teams.length === 0) {
        container.innerHTML = '<p class="queue-empty">No teams found</p>';
        return;
    }

    container.innerHTML = gameState.teams.map(team => {
        const teamColor = team.color || getTeamColor(team.id);
        const players = team.players || [];

        // Build player items for individual dragging
        const playerItems = players.map((p, idx) => `
            <div class="player-item"
                 draggable="true"
                 ondragstart="dragPlayer(event, ${team.id}, ${idx})"
                 ondragend="dragEnd(event)">
                <span class="player-drag-handle">⋮⋮</span>
                <span class="player-name">${p.name}</span>
            </div>
        `).join('');

        return `
            <div class="team-card" style="--team-color: ${teamColor}">
                <div class="team-header"
                     draggable="true"
                     ondragstart="dragTeam(event, ${team.id})"
                     ondragend="dragEnd(event)"
                     title="Drag to add entire team">
                    <span class="team-name" style="color: ${teamColor}">${team.name || 'Team ' + team.id}</span>
                    <span class="team-wins">${team.gamesWon || 0} wins</span>
                </div>
                <div class="team-points-row">
                    <label>Points:</label>
                    <button class="btn secondary points-btn" onclick="adjustTeamPoints(${team.id}, -1, event)">-</button>
                    <input type="number" class="points-input" value="${team.points || 0}"
                           onchange="setTeamPoints(${team.id}, this.value)"
                           onclick="event.stopPropagation()">
                    <button class="btn secondary points-btn" onclick="adjustTeamPoints(${team.id}, 1, event)">+</button>
                </div>
                <div class="team-players-list">${playerItems}</div>
            </div>
        `;
    }).join('');
}

function getTeamColor(teamId) {
    if (teamId == null) return '#666666';

    // First check if team has a custom color set in Firebase
    // Use string comparison to handle type mismatches (string vs number IDs)
    if (gameState?.teams) {
        const team = gameState.teams.find(t => String(t.id) === String(teamId));
        if (team?.color) {
            return team.color;
        }
    }

    // Fallback to default colors
    const colors = {
        1: '#de392c',
        2: '#2278a3',
        3: '#2e9158',
        4: '#f7ba32',
        5: '#22241d'
    };
    return colors[teamId] || '#666666';
}

async function adjustTeamPoints(teamId, delta, e) {
    if (e) e.stopPropagation();

    if (!gameState?.teams) return;

    const team = gameState.teams.find(t => t.id === teamId);
    if (team) {
        team.points = Math.max(0, (team.points || 0) + delta);
        await saveGameState();
        renderTeamsList();
    }
}

async function setTeamPoints(teamId, value) {
    if (!gameState?.teams) return;

    const team = gameState.teams.find(t => t.id === teamId);
    if (team) {
        team.points = Math.max(0, parseInt(value) || 0);
        await saveGameState();
    }
}

// =============================================================================
// PLAYER MANAGEMENT (LOCAL - NO FIREBASE USERS)
// =============================================================================

/**
 * Open the player manager modal
 */
function openPlayerManager() {
    if (!gameState?.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    renderPlayerManager();
    document.getElementById('playerManagerModal').classList.add('active');
}

/**
 * Close the player manager modal
 */
function closePlayerManager() {
    document.getElementById('playerManagerModal').classList.remove('active');
}

/**
 * Render the player manager content
 */
function renderPlayerManager() {
    const container = document.getElementById('playerManagerTeams');

    if (!gameState?.teams || gameState.teams.length === 0) {
        container.innerHTML = '<p class="queue-empty">No teams in this tournament</p>';
        return;
    }

    const MAX_PLAYERS_PER_TEAM = 2;

    container.innerHTML = gameState.teams.map(team => {
        const teamColor = team.color || getTeamColor(team.id);
        const players = team.players || [];
        const canAddMore = players.length < MAX_PLAYERS_PER_TEAM;

        const playersList = players.map((player, idx) => `
            <div class="pm-player">
                <input type="text" value="${player.name || ''}"
                       onchange="updatePlayerName(${team.id}, ${idx}, this.value)"
                       placeholder="Player name">
                <button class="btn-remove" onclick="removePlayerFromTeam(${team.id}, ${idx})" title="Remove player">✕</button>
            </div>
        `).join('');

        // Only show add player section if under the limit
        const addPlayerSection = canAddMore ? `
            <div class="pm-add-player">
                <input type="text" id="newPlayer-${team.id}" placeholder="New player name..."
                       onkeypress="if(event.key === 'Enter') addPlayerToTeam(${team.id})">
                <button class="btn secondary" onclick="addPlayerToTeam(${team.id})">Add</button>
            </div>
        ` : '';

        return `
            <div class="pm-team" style="--team-color: ${teamColor}">
                <div class="pm-team-header">
                    <input type="text" class="pm-team-name" value="${team.name || 'Team ' + team.id}"
                           onchange="updateTeamName(${team.id}, this.value)"
                           style="color: ${teamColor}">
                    <span class="team-wins">${players.length}/${MAX_PLAYERS_PER_TEAM} players</span>
                </div>
                <div class="pm-team-color">
                    <label style="font-size: 0.75rem; color: var(--text-tertiary);">Team Color:</label>
                    <input type="color" value="${teamColor}"
                           onchange="updateTeamColor(${team.id}, this.value)"
                           style="width: 40px; height: 28px; cursor: pointer; border: none; background: none;">
                    <span style="font-size: 0.7rem; color: var(--text-tertiary); font-family: monospace;">${teamColor}</span>
                </div>
                <div class="pm-players-list">
                    ${playersList || '<p class="queue-empty" style="padding: 8px;">No players yet</p>'}
                </div>
                ${addPlayerSection}
            </div>
        `;
    }).join('');
}

/**
 * Add a new player to a team
 * Uses normalized player registry for consistent ID management
 */
async function addPlayerToTeam(teamId) {
    const input = document.getElementById(`newPlayer-${teamId}`);
    const playerName = input.value.trim();

    if (!playerName) {
        showStatus('Enter a player name', 'warning');
        return;
    }

    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    // Generate player ID and add to registry
    let playerId;
    if (window.PlayerUtils) {
        playerId = window.PlayerUtils.addPlayerToTeam(gameState, teamId, { name: playerName });
    } else {
        // Fallback if PlayerUtils not loaded
        playerId = `p_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
        gameState.players = gameState.players || {};
        gameState.players[playerId] = {
            id: playerId,
            name: playerName,
            teamId: teamId,
            createdAt: new Date().toISOString()
        };
        team.playerIds = team.playerIds || [];
        team.playerIds.push(playerId);
    }

    // Also maintain legacy players array for backward compatibility during transition
    team.players = team.players || [];
    team.players.push({
        id: playerId,
        name: playerName
    });

    await saveGameState();
    input.value = '';
    renderPlayerManager();
    renderTeamsList();
    showStatus(`Added ${playerName} to ${team.name}`, 'success');
}

/**
 * Remove a player from a team
 * Also removes from registry and playerIds
 */
async function removePlayerFromTeam(teamId, playerIndex) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team || !team.players) return;

    const player = team.players[playerIndex];
    const playerName = player?.name || 'Player';
    const playerId = player?.id;

    if (!confirm(`Remove ${playerName} from ${team.name}?`)) return;

    // Remove from legacy players array
    team.players.splice(playerIndex, 1);

    // Also remove from playerIds and registry if using normalized structure
    if (playerId) {
        if (team.playerIds) {
            team.playerIds = team.playerIds.filter(id => id !== playerId);
        }
        if (gameState.players && gameState.players[playerId]) {
            delete gameState.players[playerId];
        }
    }

    await saveGameState();
    renderPlayerManager();
    renderTeamsList();
    showStatus(`Removed ${playerName}`, 'success');
}

/**
 * Update a player's name
 * Also updates in registry if using normalized structure
 */
async function updatePlayerName(teamId, playerIndex, newName) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team || !team.players || !team.players[playerIndex]) return;

    const trimmedName = newName.trim();
    const playerId = team.players[playerIndex].id;

    // Update in legacy players array
    team.players[playerIndex].name = trimmedName;

    // Also update in registry if using normalized structure
    if (playerId && gameState.players && gameState.players[playerId]) {
        gameState.players[playerId].name = trimmedName;
    }

    await saveGameState();
    renderTeamsList();
}

/**
 * Update a team's name
 */
async function updateTeamName(teamId, newName) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    team.name = newName.trim();

    await saveGameState();
    renderTeamsList();
    renderPlayerManager();
}

/**
 * Update a team's color
 */
async function updateTeamColor(teamId, newColor) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    team.color = newColor;

    await saveGameState();

    // Update CSS variables for this team
    applyTeamColors();

    renderTeamsList();
    renderPlayerManager();
    renderBoard();

    showStatus(`Team color updated to ${newColor}`, 'success');
}

/**
 * Apply custom team colors to CSS variables
 * This ensures all UI elements use the correct colors from Firebase
 */
function applyTeamColors() {
    if (!gameState?.teams) return;

    const root = document.documentElement;

    gameState.teams.forEach(team => {
        if (team.color) {
            root.style.setProperty(`--team-${team.id}-color`, team.color);

            // Also set alpha version for backgrounds
            const hex = team.color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            root.style.setProperty(`--team-${team.id}-alpha`, `rgba(${r}, ${g}, ${b}, 0.4)`);
        }
    });
}

// =============================================================================
// BOARD RENDERING
// =============================================================================

function renderBoard() {
    if (!boardRenderer || !boardModule) return;

    // Render board with current state
    boardRenderer.render(gameState || {});

    // Add team colors and click handlers to hexes
    const hexes = document.querySelectorAll('.board-hex');
    hexes.forEach(hex => {
        const coord = hex.dataset.coord;

        // Remove old team classes
        hex.classList.remove('team-1', 'team-2', 'team-3', 'team-4', 'team-5');

        // Add team color if occupied
        if (gameState?.board && gameState.board[coord]) {
            const teamId = gameState.board[coord];
            hex.classList.add(`team-${teamId}`);
        }

        // Add click handler
        hex.onclick = () => handleHexClick(coord);
    });
}

function handleHexClick(coord) {
    selectedHexCoord = coord;

    const currentOwner = gameState?.board?.[coord];
    const modal = document.getElementById('teamPickerModal');
    const coordSpan = document.getElementById('pickerHexCoord');
    const optionsContainer = document.getElementById('teamPickerOptions');

    coordSpan.textContent = coord;

    // Check hex type to determine if room toggle is allowed
    const matches = coord.match(/q(-?\d+)r(-?\d+)/);
    let canBeRoom = true;
    let hexType = 'normal';
    if (matches) {
        const [, q, r] = matches;
        hexType = boardModule.getHexType(parseInt(q), parseInt(r));
        // Hearts and starting locations cannot be rooms
        if (hexType === 'mountain-heart' || hexType === 'side-heart' || hexType === 'starting-location') {
            canBeRoom = false;
        }
    }

    // Check if hex is currently a room
    const isRoom = (gameState?.rooms && gameState.rooms.includes(coord)) ||
                   (boardModule.roomHexes && boardModule.roomHexes.includes(coord));

    // Build team options
    let optionsHtml = '';

    // Room toggle option (if allowed)
    if (canBeRoom) {
        optionsHtml += `
            <button class="team-picker-btn ${isRoom ? 'room-active' : ''}"
                    onclick="toggleRoomHex('${coord}')"
                    style="border-left: 4px solid #8b5cf6;">
                ${isRoom ? '🚪 Remove Room' : '🚪 Mark as Room'}
            </button>
        `;
    } else {
        optionsHtml += `
            <div class="team-picker-hint" style="padding: 8px; color: var(--text-tertiary); font-size: 0.8rem;">
                ${hexType === 'mountain-heart' ? '❤️❤️ Mountain Heart' :
                  hexType === 'side-heart' ? '❤️ Side Heart' :
                  '⭐ Starting Location'} - Cannot be a room
            </div>
        `;
    }

    // Divider
    optionsHtml += '<div style="border-top: 1px solid var(--border-color); margin: 8px 0;"></div>';

    // Clear option
    optionsHtml += `
        <button class="team-picker-btn clear-btn" onclick="assignTeamToHex('${coord}', null)">
            Clear Hex (No Owner)
        </button>
    `;

    // Team options
    if (gameState?.teams) {
        gameState.teams.forEach(team => {
            const isCurrentOwner = currentOwner === team.id;
            const teamColor = team.color || getTeamColor(team.id);
            optionsHtml += `
                <button class="team-picker-btn"
                        onclick="assignTeamToHex('${coord}', ${team.id})"
                        style="border-left: 4px solid ${teamColor}; ${isCurrentOwner ? 'background: var(--bg-elevated);' : ''}">
                    ${team.name || 'Team ' + team.id}
                    ${isCurrentOwner ? ' (current)' : ''}
                </button>
            `;
        });
    }

    optionsContainer.innerHTML = optionsHtml;
    modal.classList.add('active');
}

async function assignTeamToHex(coord, teamId) {
    gameState.board = gameState.board || {};

    if (teamId === null) {
        // Remove from local state
        delete gameState.board[coord];

        // Also remove from heart hex control if applicable
        if (gameState.heartHexControl && gameState.heartHexControl[coord]) {
            delete gameState.heartHexControl[coord];
        }

        // For Firebase, we need to explicitly delete the field using FieldValue.delete()
        // Regular merge won't remove fields
        closeTeamPicker();
        try {
            const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentTournamentId);
            const deleteUpdate = {
                [`board.${coord}`]: firebase.firestore.FieldValue.delete()
            };
            // Also delete from heartHexControl if it existed
            if (gameState.heartHexControl !== undefined) {
                deleteUpdate[`heartHexControl.${coord}`] = firebase.firestore.FieldValue.delete();
            }
            await tournamentRef.update(deleteUpdate);

            // Delete the most recent tile_capture event for this hex (likely a mistake)
            deleteLastTileCaptureEvent(coord);

            showStatus(`Cleared hex ${coord}`, 'success');
        } catch (error) {
            console.error('Error clearing hex:', error);
            showStatus('Error clearing hex', 'error');
        }
        renderBoard();
        return;
    }

    // Assign team to hex
    gameState.board[coord] = teamId;

    // Check if this is a heart hex
    const matches = coord.match(/q(-?\d+)r(-?\d+)/);
    let isHeartHex = false;
    if (matches) {
        const [, q, r] = matches;
        const hexType = boardModule.getHexType(parseInt(q), parseInt(r));

        if (hexType === 'side-heart' || hexType === 'mountain-heart') {
            gameState.heartHexControl = gameState.heartHexControl || {};
            gameState.heartHexControl[coord] = teamId;
            isHeartHex = true;
        }
    }

    closeTeamPicker();
    await saveGameState();

    // Log tile capture event
    const team = gameState.teams?.find(t => t.id === teamId);
    logEvent('tile_capture', {
        teamName: team?.name || `Team ${teamId}`,
        teamId: teamId,
        teamColor: team?.color || getTeamColor(teamId),
        hexCoord: coord,
        isHeart: isHeartHex
    });

    renderBoard();
}

function closeTeamPicker() {
    document.getElementById('teamPickerModal').classList.remove('active');
    selectedHexCoord = null;
}

/**
 * Toggle a hex as a room
 * Rooms are stored in gameState.rooms array and synced to Firebase
 */
async function toggleRoomHex(coord) {
    // Initialize rooms array if not exists
    gameState.rooms = gameState.rooms || [];

    const roomIndex = gameState.rooms.indexOf(coord);

    if (roomIndex >= 0) {
        // Remove from rooms
        gameState.rooms.splice(roomIndex, 1);
        showStatus(`Removed room: ${coord}`, 'info');
    } else {
        // Add to rooms
        gameState.rooms.push(coord);
        showStatus(`Added room: ${coord}`, 'success');
    }

    // Update boardModule
    boardModule.setRoomHexes(gameState.rooms);

    closeTeamPicker();
    await saveGameState();
    renderBoard();
}

// =============================================================================
// MATCH CREATION - DRAG & DROP
// =============================================================================

function dragTeam(event, teamId) {
    event.stopPropagation();
    event.dataTransfer.setData('application/json', JSON.stringify({
        type: 'team',
        teamId: teamId
    }));
    event.target.classList.add('dragging');
}

function dragPlayer(event, teamId, playerIndex) {
    event.stopPropagation();
    const team = gameState?.teams?.find(t => t.id === teamId);
    if (!team || !team.players || !team.players[playerIndex]) return;

    const player = team.players[playerIndex];
    event.dataTransfer.setData('application/json', JSON.stringify({
        type: 'player',
        teamId: teamId,
        playerIndex: playerIndex,
        player: {
            id: player.id || player.uid,
            name: player.name,
            originalTeamId: teamId,
            originalTeamName: team.name,
            originalTeamColor: team.color || getTeamColor(teamId)
        }
    }));
    event.target.classList.add('dragging');
}

function dragEnd(event) {
    event.target.classList.remove('dragging');
}

function allowDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

function dragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

function dropToSide(event, sideIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    try {
        const data = JSON.parse(event.dataTransfer.getData('application/json'));

        if (data.type === 'team') {
            const team = gameState?.teams?.find(t => t.id === data.teamId);
            if (!team) return;

            // Check if team is already on this side
            const alreadyOnThisSide = manualGameSetup.sides[sideIndex].some(p => p.originalTeamId === team.id);
            if (alreadyOnThisSide) {
                showStatus('Team already on this side', 'warning');
                return;
            }

            // Add all players from the team
            const players = (team.players || []).map(p => ({
                id: p.id || p.uid,
                name: p.name,
                originalTeamId: team.id,
                originalTeamName: team.name,
                originalTeamColor: team.color || getTeamColor(team.id)
            }));

            manualGameSetup.sides[sideIndex].push(...players);
            renderMatchCreationZones();
        } else if (data.type === 'player') {
            // Single player drop
            const player = data.player;
            if (!player) return;

            // Check if player is already on this side
            const alreadyOnSide = manualGameSetup.sides[sideIndex].some(
                p => p.name === player.name && p.originalTeamId === player.originalTeamId
            );

            if (alreadyOnSide) {
                showStatus('Player already on this side', 'warning');
                return;
            }

            // Remove player from any other side
            manualGameSetup.sides.forEach((side, idx) => {
                if (idx !== sideIndex) {
                    const existingIndex = side.findIndex(
                        p => p.name === player.name && p.originalTeamId === player.originalTeamId
                    );
                    if (existingIndex !== -1) {
                        side.splice(existingIndex, 1);
                    }
                }
            });

            manualGameSetup.sides[sideIndex].push(player);
            renderMatchCreationZones();
        }
    } catch (error) {
        console.error('Drop error:', error);
    }
}

function renderMatchCreationZones() {
    const container = document.getElementById('sidesContainer');
    if (!container) return;

    // Build HTML for each side
    const sidesHtml = manualGameSetup.sides.map((side, idx) => {
        const label = SIDE_LABELS[idx] || (idx + 1);
        const hasPlayers = side.length > 0;

        const playersHtml = side.map((p, playerIdx) => `
            <div class="dropped-player" style="--team-color: ${p.originalTeamColor || 'var(--text-secondary)'}">
                <span>${p.name} (${p.originalTeamName || 'Unknown'})</span>
                <button class="remove-btn" onclick="removeFromSide(${idx}, ${playerIdx})">x</button>
            </div>
        `).join('');

        return `
            <div class="drop-zone ${hasPlayers ? 'has-players' : ''}" id="side${idx}Zone"
                 ondrop="dropToSide(event, ${idx})"
                 ondragover="allowDrop(event)"
                 ondragleave="dragLeave(event)">
                <span class="placeholder">Drop Team/Player ${label}</span>
                <div class="side-players">${playersHtml}</div>
            </div>
            ${idx < manualGameSetup.sides.length - 1 ? '<div class="vs-divider">VS</div>' : ''}
        `;
    }).join('');

    container.innerHTML = sidesHtml;

    // Update auto-calculated format display
    updateAutoFormat();
}

/**
 * Calculate and display the match format based on dropped players
 */
function updateAutoFormat() {
    const formatDisplay = document.getElementById('autoFormat');
    const counts = manualGameSetup.sides.map(s => s.length);
    const allEmpty = counts.every(c => c === 0);
    const allEqual = counts.every(c => c === counts[0]);

    if (allEmpty) {
        formatDisplay.textContent = '--';
        formatDisplay.style.color = 'var(--text-tertiary)';
    } else if (!allEqual) {
        // Uneven teams - show warning
        formatDisplay.textContent = counts.join('v');
        formatDisplay.style.color = 'var(--accent-warning, #f7ba32)';
    } else {
        formatDisplay.textContent = counts.join('v');
        formatDisplay.style.color = 'var(--accent-primary)';
    }
}

/**
 * Get the calculated play type format
 */
function getCalculatedPlayType() {
    return manualGameSetup.sides.map(s => s.length).join('v');
}

function removeFromSide(sideIndex, playerIndex) {
    manualGameSetup.sides[sideIndex].splice(playerIndex, 1);
    renderMatchCreationZones();
}

function clearMatchSetup() {
    manualGameSetup = { sides: [[], []] }; // Reset to 2 empty sides
    renderMatchCreationZones();
}

/**
 * Add another side to the match (for 2v2v2, etc.)
 */
function addMatchSide() {
    if (manualGameSetup.sides.length >= SIDE_LABELS.length) {
        showStatus(`Maximum ${SIDE_LABELS.length} sides allowed`, 'warning');
        return;
    }
    manualGameSetup.sides.push([]);
    renderMatchCreationZones();
}

/**
 * Remove the last side from match creation
 */
function removeMatchSide() {
    if (manualGameSetup.sides.length <= 2) {
        showStatus('Minimum 2 sides required', 'warning');
        return;
    }
    manualGameSetup.sides.pop();
    renderMatchCreationZones();
}

async function addMatchToQueue() {
    // Check all sides have at least one player
    const emptySides = manualGameSetup.sides.filter(s => s.length === 0);
    if (emptySides.length > 0) {
        showStatus('All sides need at least one player', 'warning');
        return;
    }

    const playType = getCalculatedPlayType();

    // Build teams array from sides - store player IDs for normalized structure
    const teams = manualGameSetup.sides.map((side, idx) => ({
        id: `TEAM_${SIDE_LABELS[idx]}`,
        playerIds: side.map(p => p.id).filter(Boolean)
    }));

    // Get next match number (persistent, doesn't change with reordering)
    const matchNumber = getNextMatchNumber();

    const queueEntry = {
        id: Date.now(),
        matchNumber: matchNumber,
        game: document.getElementById('gameType').value,
        playType: playType,
        teams: teams,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    gameState.gameQueue = gameState.gameQueue || [];
    gameState.gameQueue.push(queueEntry);

    await saveGameState();
    clearMatchSetup();
    showStatus(`Match #${matchNumber} (${playType}) added to queue!`, 'success');
}

/**
 * Add a CHALLENGE match to the queue
 * Challenges are hex dispute matches - they don't affect normal rotation counting
 * Challenges are inserted after ongoing games and the first pending match
 */
async function addChallengeToQueue() {
    // Check all sides have at least one player
    const emptySides = manualGameSetup.sides.filter(s => s.length === 0);
    if (emptySides.length > 0) {
        showStatus('All sides need at least one player', 'warning');
        return;
    }

    const playType = getCalculatedPlayType();

    // Build teams array from sides - store player IDs for normalized structure
    const teams = manualGameSetup.sides.map((side, idx) => ({
        id: `TEAM_${SIDE_LABELS[idx]}`,
        playerIds: side.map(p => p.id).filter(Boolean)
    }));

    // Get next match number (persistent, doesn't change with reordering)
    const matchNumber = getNextMatchNumber();

    const queueEntry = {
        id: Date.now(),
        matchNumber: matchNumber,
        game: document.getElementById('gameType').value,
        playType: playType,
        teams: teams,
        status: 'pending',
        isChallenge: true, // Mark as challenge match
        createdAt: new Date().toISOString()
    };

    gameState.gameQueue = gameState.gameQueue || [];

    // Find insertion position: after ongoing games + first pending match
    // This allows the "next up" match to stay in position while challenge slots in after
    const queue = gameState.gameQueue;
    const ongoingCount = queue.filter(g => g.status === 'ongoing').length;
    const firstPendingIndex = queue.findIndex(g =>
        g.status === 'pending' || g.status === undefined || g.status === 'queued'
    );

    // Insert after ongoing + first pending (or at end if no pending matches)
    let insertIndex;
    if (firstPendingIndex === -1) {
        // No pending matches, add after ongoing games
        insertIndex = ongoingCount;
    } else {
        // Insert after the first pending match
        insertIndex = firstPendingIndex + 1;
    }

    queue.splice(insertIndex, 0, queueEntry);

    await saveGameState();
    clearMatchSetup();
    showStatus(`⚔️ CHALLENGE #${matchNumber} (${playType}) added to queue (position ${insertIndex + 1})!`, 'success');
}

/**
 * Get the next available match number
 * Looks at all matches (including completed) to ensure unique numbering
 */
function getNextMatchNumber() {
    const allMatches = gameState?.gameQueue || [];
    if (allMatches.length === 0) return 1;

    const maxNumber = Math.max(...allMatches.map(m => m.matchNumber || 0));
    return maxNumber + 1;
}

/**
 * Generate suggested matches using MatchSuggester
 * Uses the proven 10-match rotation pattern from previous LAN
 */
async function generateSuggestedMatches() {
    if (!gameState || !gameState.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    // Check if MatchSuggester is available
    if (typeof MatchSuggester === 'undefined') {
        showStatus('MatchSuggester not loaded', 'error');
        return;
    }

    try {
        const suggester = new MatchSuggester(gameState);
        const suggestion = suggester.generateSuggestion();

        // Check for errors (e.g., not enough teams/players)
        if (suggestion.error) {
            showStatus(suggestion.message, 'error');
            return;
        }

        const match = suggestion.matches[0]; // The 5v5 match
        const selectedGame = document.getElementById('gameType').value || gameState.selectedGames?.[0] || 'cs2';
        const gameName = getGameDisplayName(selectedGame);

        // Store pending match for confirmation
        pendingAutoMatch = {
            match,
            suggestion,
            selectedGame,
            gameName
        };

        // Build modal content
        const sideAHtml = match.teams[0].players.map(p => {
            const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
            const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
            return `<div class="auto-match-player" style="--player-color: ${color}">
                <span class="player-name">${p.name}</span>
                <span class="player-team">${p.originalTeamName}</span>
                ${splitBadge}
            </div>`;
        }).join('');

        const sideBHtml = match.teams[1].players.map(p => {
            const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
            const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
            return `<div class="auto-match-player" style="--player-color: ${color}">
                <span class="player-name">${p.name}</span>
                <span class="player-team">${p.originalTeamName}</span>
                ${splitBadge}
            </div>`;
        }).join('');

        const modalContent = `
            <h4>Auto-Generated Match</h4>
            <div class="auto-match-header">
                <span class="rotation-badge">Rotation ${suggestion.rotationIndex}/10</span>
                <span class="cycle-badge">Cycle ${suggestion.cycleNumber}</span>
            </div>
            <div class="auto-match-game">
                <span class="game-name">${gameName}</span>
                <span class="play-type">5v5</span>
            </div>

            <div class="auto-match-sides">
                <div class="auto-match-side">
                    <div class="side-label">Side A</div>
                    <div class="side-desc">${suggestion.sideADescription}</div>
                    <div class="side-players">${sideAHtml}</div>
                </div>
                <div class="auto-match-vs">VS</div>
                <div class="auto-match-side">
                    <div class="side-label">Side B</div>
                    <div class="side-desc">${suggestion.sideBDescription}</div>
                    <div class="side-players">${sideBHtml}</div>
                </div>
            </div>

            <div class="auto-match-info">
                <div class="split-info">${suggestion.splitDescription}</div>
                ${suggestion.fairnessNote ? `<div class="fairness-note">${suggestion.fairnessNote}</div>` : ''}
            </div>

            <div class="auto-match-actions">
                <button class="btn primary" onclick="confirmAutoMatch()">Add to Queue</button>
                <button class="btn secondary" onclick="closeAutoMatchModal()">Cancel</button>
            </div>
        `;

        document.getElementById('autoMatchContent').innerHTML = modalContent;
        document.getElementById('autoMatchModal').classList.add('active');

    } catch (error) {
        console.error('Error generating matches:', error);
        showStatus('Error generating matches: ' + error.message, 'error');
    }
}

/**
 * Confirm and add the auto-generated match to queue
 */
async function confirmAutoMatch() {
    if (!pendingAutoMatch) {
        showStatus('No pending match', 'error');
        closeAutoMatchModal();
        return;
    }

    const { match, suggestion, selectedGame } = pendingAutoMatch;

    // Get next match number
    const matchNumber = getNextMatchNumber();

    // Create the queue entry
    const queueEntry = {
        id: Date.now(),
        matchNumber: matchNumber,
        game: selectedGame,
        playType: '5v5',
        teams: [
            {
                id: 'TEAM_A',
                name: 'TEAM A',
                players: match.teams[0].players,
                fullTeams: match.teams[0].fullTeams,
                fullTeamNames: match.teams[0].fullTeamNames
            },
            {
                id: 'TEAM_B',
                name: 'TEAM B',
                players: match.teams[1].players,
                fullTeams: match.teams[1].fullTeams,
                fullTeamNames: match.teams[1].fullTeamNames
            }
        ],
        splitTeamId: match.splitTeamId,
        splitTeamName: match.splitTeamName,
        rotationIndex: suggestion.rotationIndex,
        status: 'pending',
        createdAt: new Date().toISOString(),
        autoGenerated: true
    };

    gameState.gameQueue = gameState.gameQueue || [];
    gameState.gameQueue.push(queueEntry);

    // Update rotation position in gameState for persistence
    gameState.rotationPosition = suggestion.rotationIndex % 10;

    await saveGameState();
    showStatus(`Match #${matchNumber} added! (Rotation ${suggestion.rotationIndex}/10, ${suggestion.splitDescription})`, 'success');

    closeAutoMatchModal();
}

/**
 * Close the auto match modal
 */
function closeAutoMatchModal() {
    document.getElementById('autoMatchModal').classList.remove('active');
    pendingAutoMatch = null;
}

// =============================================================================
// MATCH QUEUE
// =============================================================================

function renderMatchQueue() {
    const container = document.getElementById('matchQueue');
    const countEl = document.getElementById('queueCount');

    // Get all non-completed games
    const allGames = (gameState?.gameQueue || []).filter(g =>
        g.status !== 'completed'
    );

    // Split into ongoing and queued
    const ongoingGames = allGames.filter(g => g.status === 'ongoing');
    const queuedGames = allGames.filter(g =>
        g.status === 'pending' || g.status === undefined || g.status === 'queued'
    );

    countEl.textContent = allGames.length;

    // Render ongoing matches first, then queued
    const allToRender = [...ongoingGames, ...queuedGames];

    if (allToRender.length === 0) {
        container.innerHTML = '<p class="queue-empty">No matches in queue</p>';
        return;
    }

    container.innerHTML = allToRender.map((game) => {
        // Extract teams - handle various data formats
        const teams = game.teams || game.sides || [];

        // Build player display with colors (similar to view-lightweight.html)
        // Supports both old format (players) and new format (playerIds)
        const matchupHtml = teams.map((team, tIdx) => {
            const players = getMatchTeamPlayers(team);

            // Render each player with their individual team color
            const playersHtml = players.map(p => {
                const name = p.name || 'Unknown';
                const color = p.teamColor || p.originalTeamColor || getTeamColor(p.teamId || p.originalTeamId) || '#666';
                const teamName = p.teamName || p.originalTeamName || '';
                return `<span class="queue-player" style="--player-color: ${color}" title="${teamName}">${name}</span>`;
            }).join('');

            // Wrap team players in a container
            const teamBox = `<div class="queue-team">${playersHtml}</div>`;
            const vs = tIdx < teams.length - 1 ? '<span class="queue-vs">VS</span>' : '';
            return teamBox + vs;
        }).join('');

        // Fallback for old format
        let fallbackMatchup = '';
        if (teams.length === 0 && game.teamA && game.teamB) {
            fallbackMatchup = `${game.teamA.name || game.teamA} vs ${game.teamB.name || game.teamB}`;
        }

        const gameName = getGameDisplayName(game.game || game.gameType || 'Unknown');
        const playType = game.playType || game.format || '';
        const isOngoing = game.status === 'ongoing';
        const isChallenge = game.isChallenge === true;
        // Use persistent match number instead of queue position
        const matchNumber = game.matchNumber ? `#${game.matchNumber} ` : '';
        // Challenge badge HTML
        const challengeBadge = isChallenge ? '<span class="challenge-badge">CHALLENGE</span>' : '';

        return `
            <div class="queue-item ${isOngoing ? 'ongoing' : ''} ${isChallenge ? 'challenge' : ''}"
                 draggable="${!isOngoing}"
                 data-queue-id="${game.id}"
                 onclick="openQuickConfirm(${game.id})"
                 ondragstart="dragQueueItem(event, ${game.id})"
                 ondragover="allowQueueDrop(event)"
                 ondragleave="leaveQueueDrop(event)"
                 ondrop="dropQueueItem(event, ${game.id})"
                 ondragend="endQueueDrag(event)">
                <span class="drag-handle">${isOngoing ? '▶' : '☰'}</span>
                <div class="game-info">
                    <div class="game-type">${challengeBadge}${matchNumber}${gameName}${playType ? ' (' + playType + ')' : ''}</div>
                    <div class="matchup-players">${matchupHtml || fallbackMatchup || 'TBD'}</div>
                </div>
                ${!isOngoing ? `<button class="start-btn" onclick="event.stopPropagation(); startMatch(${game.id})" title="Start match">▶</button>` : ''}
                <button class="delete-btn" onclick="event.stopPropagation(); removeFromQueue(${game.id})" title="Remove">✕</button>
            </div>
        `;
    }).join('');
}

/**
 * Get current player name by looking up their ID in the team roster
 * This allows player name changes to reflect in the match queue
 * Falls back to stored name if player not found
 */
function getPlayerCurrentName(player) {
    if (!player) return 'Unknown';

    // If player has an ID, try to look up current name from team roster
    if (player.id && player.originalTeamId && gameState?.teams) {
        const team = gameState.teams.find(t => t.id === player.originalTeamId);
        if (team && team.players) {
            const currentPlayer = team.players.find(p =>
                p.id === player.id || (p.id && p.id === player.id)
            );
            if (currentPlayer && currentPlayer.name) {
                return currentPlayer.name;
            }
        }
    }

    // Fallback to stored name
    return player.name || 'Unknown';
}

function dragQueueItem(event, gameId) {
    draggedQueueId = gameId;
    // Find the queue-item element (event.target might be a child element)
    const queueItem = event.target.closest('.queue-item');
    if (queueItem) {
        queueItem.classList.add('dragging');
    }
    event.dataTransfer.effectAllowed = 'move';
}

function allowQueueDrop(event) {
    event.preventDefault();
    const item = event.currentTarget;
    if (parseInt(item.dataset.queueId) !== draggedQueueId) {
        item.classList.add('drag-over');
    }
}

function leaveQueueDrop(event) {
    event.currentTarget.classList.remove('drag-over');
}

function endQueueDrag(event) {
    // Find the queue-item element (event.target might be a child element)
    const queueItem = event.target.closest('.queue-item');
    if (queueItem) {
        queueItem.classList.remove('dragging');
    }
    draggedQueueId = null;

    // Clean up all drag-over classes
    document.querySelectorAll('.queue-item.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

async function dropQueueItem(event, targetId) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    if (draggedQueueId === targetId) return;

    const queue = gameState.gameQueue || [];
    const ongoingGames = queue.filter(g => g.status === 'ongoing');
    const pendingGames = queue.filter(g => g.status === 'pending' || g.status === undefined || g.status === 'queued');
    const completedGames = queue.filter(g => g.status === 'completed');

    const draggedIndex = pendingGames.findIndex(g => g.id === draggedQueueId);
    const targetIndex = pendingGames.findIndex(g => g.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Reorder only pending games
    const [draggedGame] = pendingGames.splice(draggedIndex, 1);
    pendingGames.splice(targetIndex, 0, draggedGame);

    // Rebuild queue - preserve ongoing games!
    gameState.gameQueue = [...ongoingGames, ...pendingGames, ...completedGames];

    await saveGameState();
    showStatus('Queue reordered', 'success');
}

async function removeFromQueue(gameId) {
    if (!confirm('Remove this match from the queue?')) return;

    gameState.gameQueue = (gameState.gameQueue || []).filter(g => g.id !== gameId);
    await saveGameState();
    showStatus('Match removed from queue', 'success');
}

// =============================================================================
// RESULT CONFIRMATION
// =============================================================================


/**
 * Render ongoing matches section
 * Supports multiple teams (2v2v2, etc.)
 */
function renderOngoingMatches() {
    const container = document.getElementById('ongoingMatchesList');
    if (!container) return;

    const ongoing = (gameState?.gameQueue || []).filter(g => g.status === 'ongoing');

    if (ongoing.length === 0) {
        container.innerHTML = '<p class="queue-empty">No matches in progress</p>';
        return;
    }

    container.innerHTML = ongoing.map(game => {
        const teams = game.teams || [];
        const gameName = getGameDisplayName(game.game || game.gameType);
        const matchNumDisplay = game.matchNumber ? `#${game.matchNumber} ` : '';
        const isChallenge = game.isChallenge === true;
        const challengeBadge = isChallenge ? '<span class="challenge-badge">CHALLENGE</span> ' : '';

        // Build team names display (supports both old players and new playerIds format)
        const teamNamesHtml = teams.map((team, idx) => {
            const label = SIDE_LABELS[idx] || (idx + 1);
            const players = getMatchTeamPlayers(team);
            let names = `Team ${label}`;
            if (players.length > 0) {
                names = players.map(p => p.name || 'Unknown').join(', ');
            } else if (team.name) {
                names = team.name;
            }
            return `<span class="ongoing-team">${names}</span>`;
        }).join('<span class="ongoing-vs">vs</span>');

        // Build quick win buttons for each team
        const winButtonsHtml = teams.map((_, idx) => {
            const label = SIDE_LABELS[idx] || (idx + 1);
            return `<button class="btn team-win-btn" onclick="event.stopPropagation(); quickConfirmResult(${game.id}, ${idx})">${label} Wins</button>`;
        }).join('');

        return `
            <div class="ongoing-match ${isChallenge ? 'challenge' : ''}" onclick="openQuickConfirm(${game.id})">
                <div class="ongoing-game-name">${challengeBadge}${matchNumDisplay}${gameName}</div>
                <div class="ongoing-teams">${teamNamesHtml}</div>
                <div class="ongoing-actions">${winButtonsHtml}</div>
            </div>
        `;
    }).join('');
}

/**
 * Start a match (move from queue to ongoing)
 */
async function startMatch(gameId) {
    const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
    if (!game) {
        showStatus('Match not found', 'error');
        return;
    }

    game.status = 'ongoing';
    game.startedAt = new Date().toISOString();

    await saveGameState();

    // Log match start event
    const gameName = getGameDisplayName(game.game || game.gameType);
    const matchNum = game.matchNumber ? `#${game.matchNumber}` : '';
    logEvent('match_start', {
        gameName: gameName,
        matchNumber: game.matchNumber,
        playType: game.playType,
        isChallenge: game.isChallenge || false,
        message: `${matchNum} ${gameName} started`
    });

    showStatus('Match started!', 'success');
}

/**
 * Open quick confirm popup for a match
 * Supports any number of teams (2v2, 2v2v2, etc.)
 */
function openQuickConfirm(gameId) {
    const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
    if (!game) return;

    selectedQueuedGame = game;

    const gameName = getGameDisplayName(game.game || game.gameType);
    const isOngoing = game.status === 'ongoing';
    const isChallenge = game.isChallenge === true;
    const teams = game.teams || [];

    // Default team colors
    const defaultColors = [
        'var(--accent-danger)',
        'var(--accent-primary)',
        '#2e9158',
        '#f7ba32',
        '#9b59b6'
    ];

    // Build team cards (supports both old players and new playerIds format)
    const teamCardsHtml = teams.map((team, idx) => {
        const label = SIDE_LABELS[idx] || (idx + 1);
        const players = getMatchTeamPlayers(team);
        let teamNames = `Team ${label}`;
        let teamColor = defaultColors[idx] || 'var(--text-secondary)';

        if (players.length > 0) {
            teamNames = players.map(p => p.name || 'Unknown').join(', ');
            teamColor = players[0].teamColor || players[0].originalTeamColor || teamColor;
        } else if (team.name) {
            teamNames = team.name;
        }

        return `
            <div class="confirm-team" style="border-color: ${teamColor}">
                <div class="confirm-team-label">Team ${label}</div>
                <div class="confirm-team-players">${teamNames}</div>
                <button class="btn confirm-win-btn" style="background: ${teamColor}"
                        onclick="quickConfirmResult(${gameId}, ${idx})">
                    Team ${label} Wins
                </button>
            </div>
        `;
    }).join('<div class="confirm-vs">VS</div>');

    // Build popup content
    const modal = document.getElementById('resultConfirmModal');
    const content = document.getElementById('resultConfirmContent');

    const matchNumDisplay = game.matchNumber ? `Match #${game.matchNumber} - ` : '';
    const challengeBadgeHtml = isChallenge ? '<span class="challenge-badge" style="margin-right: 8px;">CHALLENGE</span>' : '';

    content.innerHTML = `
        <h4>${isOngoing ? 'Confirm Result' : 'Start & Confirm Result'}</h4>
        <div class="confirm-game-name">${challengeBadgeHtml}${matchNumDisplay}${gameName} ${game.playType ? '(' + game.playType + ')' : ''}</div>

        <div class="confirm-matchup ${teams.length > 2 ? 'multi-team' : ''}">
            ${teamCardsHtml}
        </div>

        <div class="confirm-actions">
            ${!isOngoing ? `<button class="btn secondary" onclick="startMatch(${gameId}); closeResultConfirm();">Start Match (No Result Yet)</button>` : ''}
            <button class="btn secondary" onclick="closeResultConfirm()">Cancel</button>
        </div>
    `;

    modal.classList.add('active');
}

/**
 * Close result confirm popup
 */
function closeResultConfirm() {
    document.getElementById('resultConfirmModal').classList.remove('active');
    selectedQueuedGame = null;
}

/**
 * Quick confirm result from popup
 * @param {number} gameId - The game queue ID
 * @param {number} winnerIndex - Index of the winning team (0, 1, 2, etc.)
 */
async function quickConfirmResult(gameId, winnerIndex) {
    const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
    if (!game) {
        showStatus('Match not found', 'error');
        return;
    }

    // Use existing confirmResult logic but with specific game
    selectedQueuedGame = game;
    await confirmResult(winnerIndex);
    closeResultConfirm();
}

/**
 * Confirm match result
 * @param {number} winnerIndex - Index of the winning team (0, 1, 2, etc.)
 */
async function confirmResult(winnerIndex) {
    if (!selectedQueuedGame) {
        showStatus('No match selected', 'warning');
        return;
    }

    const teams = selectedQueuedGame.teams || [];
    if (winnerIndex < 0 || winnerIndex >= teams.length) {
        showStatus('Invalid winner selection', 'error');
        return;
    }

    const winningTeam = teams[winnerIndex];
    const losingTeams = teams.filter((_, idx) => idx !== winnerIndex);

    // Resolve players from match teams - supports both old (players) and new (playerIds) format
    const winningPlayers = getMatchTeamPlayers(winningTeam);
    const losingPlayers = losingTeams.flatMap(t => getMatchTeamPlayers(t));

    // Get player IDs for normalized storage
    const winningPlayerIds = winningPlayers.map(p => p.id).filter(Boolean);
    const losingPlayerIds = losingPlayers.map(p => p.id).filter(Boolean);

    // Get unique team IDs
    const winningTeamIds = [...new Set(winningPlayers.map(p => p.teamId || p.originalTeamId).filter(Boolean))];
    const losingTeamIds = [...new Set(losingPlayers.map(p => p.teamId || p.originalTeamId).filter(Boolean))];

    // Count players per team on the winning side
    const winningTeamPlayerCounts = {};
    winningPlayers.forEach(player => {
        const teamId = player.teamId || player.originalTeamId;
        if (teamId) {
            winningTeamPlayerCounts[teamId] = (winningTeamPlayerCounts[teamId] || 0) + 1;
        }
    });

    // Only credit wins to teams with 2+ players on the winning side (full team representation)
    const teamsWithFullCredit = Object.entries(winningTeamPlayerCounts)
        .filter(([_, count]) => count >= 2)
        .map(([teamId]) => parseInt(teamId) || teamId);

    // Update team win counts - only for teams with full representation
    teamsWithFullCredit.forEach(teamId => {
        const team = gameState.teams.find(t => String(t.id) === String(teamId));
        if (team) {
            team.gamesWon = (team.gamesWon || 0) + 1;
            team.gamesPlayed = (team.gamesPlayed || 0) + 1;
        }
    });

    // Update loss counts for all losing teams
    losingTeamIds.forEach(teamId => {
        const team = gameState.teams.find(t => String(t.id) === String(teamId));
        if (team) {
            team.gamesLost = (team.gamesLost || 0) + 1;
            team.gamesPlayed = (team.gamesPlayed || 0) + 1;
        }
    });

    // Get winning side label
    const winningSideLabel = `TEAM_${SIDE_LABELS[winnerIndex] || winnerIndex}`;

    // Calculate match duration if match had a start time
    const now = new Date();
    const startedAt = selectedQueuedGame.startedAt || selectedQueuedGame.ongoingAt;
    let matchDuration = null;
    if (startedAt) {
        const startTime = new Date(startedAt);
        const durationMs = now - startTime;
        matchDuration = {
            startedAt: startedAt,
            endedAt: now.toISOString(),
            durationMinutes: Math.round(durationMs / 60000)
        };
    }

    // Create team stats snapshot for historical tracking
    const teamStatsSnapshot = {};
    gameState.teams.forEach(team => {
        const hexCount = Object.values(gameState.board || {}).filter(t => t === team.id).length;
        teamStatsSnapshot[team.id] = {
            points: team.points || 0,
            gamesWon: team.gamesWon || 0,
            hexCount: hexCount
        };
    });

    // Create history entry
    const historyEntry = {
        id: (gameState.gameHistory?.length || 0) + 1,
        matchNumber: selectedQueuedGame.matchNumber,
        game: selectedQueuedGame.game,
        playType: selectedQueuedGame.playType,
        winningSide: winningSideLabel,
        winnerIndex: winnerIndex,
        winningTeamIds: winningTeamIds,
        losingTeamIds: losingTeamIds,
        // Normalized: store player IDs only (names resolved from registry at display time)
        winningPlayerIds: winningPlayerIds,
        losingPlayerIds: losingPlayerIds,
        queuedGameId: selectedQueuedGame.id,
        // Rotation tracking for fairness
        splitTeamId: selectedQueuedGame.splitTeamId,
        splitTeamName: selectedQueuedGame.splitTeamName,
        rotationIndex: selectedQueuedGame.rotationIndex,
        autoGenerated: selectedQueuedGame.autoGenerated,
        // Challenge flag - carried over from queue entry
        isChallenge: selectedQueuedGame.isChallenge || false,
        timestamp: now.toISOString(),

        // Enhanced statistics fields
        matchDuration: matchDuration,
        tournamentRound: gameState.currentRound || 1,
        matchNumberInRound: ((gameState.gameHistory?.length || 0) % (gameState.teams?.length || 5)) + 1,
        teamStatsSnapshot: teamStatsSnapshot,
        challengeHexCoord: selectedQueuedGame.challengeHexCoord || null
    };

    gameState.gameHistory = gameState.gameHistory || [];
    gameState.gameHistory.push(historyEntry);

    // Mark queue entry as completed
    const queueEntry = gameState.gameQueue.find(g => g.id === selectedQueuedGame.id);
    if (queueEntry) {
        queueEntry.status = 'completed';
        queueEntry.completedAt = new Date().toISOString();
        queueEntry.winningSide = winningSideLabel;
        queueEntry.winnerIndex = winnerIndex;
    }

    // Update games played
    gameState.gamesPlayed = (gameState.gamesPlayed || 0) + 1;

    // Save match number before resetting
    const confirmedMatchNumber = queueEntry?.matchNumber;

    // Reset selection
    const logMatchNumber = queueEntry?.matchNumber;
    const logGameName = getGameDisplayName(queueEntry?.game || 'game');
    const logIsChallenge = queueEntry?.isChallenge || false;

    selectedQueuedGame = null;

    await saveGameState();

    // Log game win event
    // Get team names only for teams that got full credit (2+ players on winning side)
    const creditedTeamNames = teamsWithFullCredit.map(teamId => {
        const team = gameState.teams.find(t => String(t.id) === String(teamId));
        return team?.name || `Team ${teamId}`;
    });
    const displayTeamName = creditedTeamNames.length > 0
        ? creditedTeamNames.join(' & ')
        : `Team ${SIDE_LABELS[winnerIndex]} (mixed)`;
    const firstWinnerTeamId = winningPlayers[0]?.teamId || winningPlayers[0]?.originalTeamId;
    const teamColor = winningPlayers[0]?.teamColor || winningPlayers[0]?.originalTeamColor || getTeamColor(firstWinnerTeamId);

    logEvent('game_win', {
        teamName: displayTeamName,
        teamId: teamsWithFullCredit[0] || winningTeamIds[0],
        teamColor: teamColor,
        gameName: logGameName,
        matchNumber: logMatchNumber,
        isChallenge: logIsChallenge,
        winningSide: SIDE_LABELS[winnerIndex],
        // Include winning player IDs for view-lightweight to resolve names
        winningPlayerIds: winningPlayerIds,
        teamsWithFullCredit: teamsWithFullCredit
    });

    const matchNumMsg = confirmedMatchNumber ? ` (Match #${confirmedMatchNumber})` : '';
    showStatus(`Result confirmed! Team ${SIDE_LABELS[winnerIndex] || winnerIndex} wins${matchNumMsg}!`, 'success');
}

// =============================================================================
// ROUND & POINTS SYSTEM
// =============================================================================

/**
 * Award points to teams based on currently controlled heart hexes
 * Side hearts = +1 point, Mountain heart (center) = +2 points
 * Returns object with points awarded per team for display
 */
function awardRoundPoints() {
    if (!gameState?.teams || !boardModule) {
        return {};
    }

    const pointsAwarded = {};

    gameState.teams.forEach(team => {
        let roundPoints = 0;

        // Count points from controlled heart hexes
        Object.entries(gameState.heartHexControl || {}).forEach(([coord, ownerId]) => {
            if (ownerId === team.id) {
                const matches = coord.match(/q(-?\d+)r(-?\d+)/);
                if (matches) {
                    const [, q, r] = matches;
                    const hexType = boardModule.getHexType(parseInt(q), parseInt(r));

                    if (hexType === 'mountain-heart') {
                        roundPoints += 2; // Center hex = 2 points
                    } else if (hexType === 'side-heart') {
                        roundPoints += 1; // Side hex = 1 point
                    }
                }
            }
        });

        // ADD points to existing total (not replace)
        if (roundPoints > 0) {
            team.points = (team.points || 0) + roundPoints;
            pointsAwarded[team.name || `Team ${team.id}`] = roundPoints;
        }
    });

    return pointsAwarded;
}

/**
 * Recalculate all points from scratch based on current hex control
 * This REPLACES points - use for manual correction only
 */
function calculateAllPoints() {
    if (!gameState?.teams || !boardModule) {
        showStatus('No game state to calculate', 'warning');
        return;
    }

    gameState.teams.forEach(team => {
        let points = 0;

        // Count points from controlled heart hexes
        Object.entries(gameState.heartHexControl || {}).forEach(([coord, ownerId]) => {
            if (ownerId === team.id) {
                const matches = coord.match(/q(-?\d+)r(-?\d+)/);
                if (matches) {
                    const [, q, r] = matches;
                    const hexType = boardModule.getHexType(parseInt(q), parseInt(r));

                    if (hexType === 'mountain-heart') {
                        points += 2;
                    } else if (hexType === 'side-heart') {
                        points += 1;
                    }
                }
            }
        });

        team.points = points;
    });

    renderTeamsList();
    showStatus('Points recalculated from heart hexes', 'success');
}

/**
 * Open the Next Round confirmation modal
 */
function advanceRound() {
    if (!gameState?.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    // Preview points that will be awarded
    const previewContainer = document.getElementById('nextRoundPreview');
    let previewHtml = '<h5>Points to be awarded:</h5>';

    let hasAnyPoints = false;

    gameState.teams.forEach(team => {
        let roundPoints = 0;

        // Calculate points from controlled heart hexes
        Object.entries(gameState.heartHexControl || {}).forEach(([coord, ownerId]) => {
            if (ownerId === team.id) {
                const matches = coord.match(/q(-?\d+)r(-?\d+)/);
                if (matches) {
                    const [, q, r] = matches;
                    const hexType = boardModule.getHexType(parseInt(q), parseInt(r));

                    if (hexType === 'mountain-heart') {
                        roundPoints += 2;
                    } else if (hexType === 'side-heart') {
                        roundPoints += 1;
                    }
                }
            }
        });

        if (roundPoints > 0) hasAnyPoints = true;

        const teamColor = team.color || getTeamColor(team.id);
        const pointsClass = roundPoints > 0 ? '' : 'no-points';

        previewHtml += `
            <div class="points-preview-item">
                <div class="points-preview-team">
                    <span class="points-preview-dot" style="background: ${teamColor}"></span>
                    <span class="points-preview-name">${team.name || 'Team ' + team.id}</span>
                </div>
                <span class="points-preview-points ${pointsClass}">+${roundPoints}</span>
            </div>
        `;
    });

    if (!hasAnyPoints) {
        previewHtml += '<p style="color: var(--text-tertiary); font-size: 0.8rem; margin-top: 8px;">No heart hexes are controlled by any team.</p>';
    }

    previewContainer.innerHTML = previewHtml;

    // Show modal
    document.getElementById('nextRoundModal').classList.add('active');
}

/**
 * Close the Next Round confirmation modal
 */
function closeNextRoundModal() {
    document.getElementById('nextRoundModal').classList.remove('active');
}

/**
 * Confirm and advance to next round, awarding points
 */
async function confirmAdvanceRound() {
    closeNextRoundModal();

    // Award points BEFORE advancing round
    const pointsAwarded = awardRoundPoints();

    // Build message showing points awarded
    let pointsMessage = '';
    const awardedTeams = Object.entries(pointsAwarded);
    if (awardedTeams.length > 0) {
        pointsMessage = awardedTeams
            .map(([team, pts]) => `${team}: +${pts}`)
            .join(', ');
    } else {
        pointsMessage = 'No points awarded (no heart hexes controlled)';
    }

    // Advance round
    gameState.currentRound = (gameState.currentRound || 0) + 1;

    // Record points history for this round
    gameState.pointsHistory = gameState.pointsHistory || [];
    gameState.pointsHistory.push({
        round: gameState.currentRound - 1, // Points are for the round that just ended
        pointsAwarded: pointsAwarded,
        timestamp: new Date().toISOString()
    });

    await saveGameState();

    // Log round advance event
    logEvent('round_advance', {
        round: gameState.currentRound,
        pointsAwarded: pointsAwarded,
        message: `Round ${gameState.currentRound} started`
    });

    showStatus(`Round ${gameState.currentRound} started! Points: ${pointsMessage}`, 'success');
}

// =============================================================================
// FIREBASE OPERATIONS
// =============================================================================

async function saveGameState() {
    if (!gameState || !currentTournamentId) {
        showStatus('No game state to save', 'warning');
        return;
    }

    try {
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentTournamentId);

        // Create a clean copy without the tournamentId field
        const saveData = { ...gameState };
        delete saveData.tournamentId;

        // Clean undefined values recursively (Firebase rejects them)
        const cleanData = removeUndefined(saveData);

        await tournamentRef.set(cleanData, { merge: true });

        updateConnectionStatus('connected');

    } catch (error) {
        console.error('Error saving game state:', error);
        updateConnectionStatus('disconnected');
        showStatus('Error saving to Firebase', 'error');
    }
}

/**
 * Recursively remove undefined values from an object
 * Firebase Firestore rejects documents with undefined values
 */
function removeUndefined(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => removeUndefined(item)).filter(item => item !== undefined);
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            cleaned[key] = removeUndefined(value);
        }
    }
    return cleaned;
}

// =============================================================================
// EVENT LOGGING
// =============================================================================

/**
 * Log an event to Firebase for real-time display in view-lightweight
 * Events are stored in tournaments/{tournamentId}/eventLog subcollection
 * @param {string} type - Event type: game_win, tile_capture, spell_used, round_advance, match_start, etc.
 * @param {object} data - Event-specific data (teamId, teamName, etc.)
 */
async function logEvent(type, data = {}) {
    if (!currentTournamentId) {
        console.warn('[EventLog] No tournament ID, skipping event log');
        return;
    }

    try {
        const eventRef = window.firebaseDB
            .collection('tournaments')
            .doc(currentTournamentId)
            .collection('eventLog')
            .doc();

        // Build event data, filtering out undefined values (Firebase rejects them)
        const eventData = {
            type: type,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Only add defined values from data
        Object.entries(data).forEach(([key, value]) => {
            if (value !== undefined) {
                eventData[key] = value;
            }
        });

        await eventRef.set(eventData);
        console.log('[EventLog] Logged event:', type, eventData);

    } catch (error) {
        console.error('[EventLog] Error logging event:', error);
        // Don't show error to user - event logging is non-critical
    }
}

/**
 * Delete the most recent tile_capture event for a specific hex coordinate
 * Used when admin clears a hex (likely correcting a mistake)
 */
async function deleteLastTileCaptureEvent(hexCoord) {
    if (!currentTournamentId || !hexCoord) return;

    try {
        // Query without orderBy to avoid needing composite index
        const eventLogRef = window.firebaseDB
            .collection('tournaments')
            .doc(currentTournamentId)
            .collection('eventLog')
            .where('type', '==', 'tile_capture')
            .where('hexCoord', '==', hexCoord);

        const snapshot = await eventLogRef.get();

        if (!snapshot.empty) {
            // Find the most recent one client-side
            let mostRecent = null;
            let mostRecentTime = 0;

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                const timestamp = data.timestamp?.toMillis?.() || 0;
                if (timestamp > mostRecentTime) {
                    mostRecentTime = timestamp;
                    mostRecent = doc;
                }
            });

            if (mostRecent) {
                await mostRecent.ref.delete();
                console.log('[EventLog] Deleted tile_capture event for', hexCoord);
            }
        }

    } catch (error) {
        console.error('[EventLog] Error deleting tile_capture event:', error);
        // Non-critical - don't show error to user
    }
}

// =============================================================================
// UI UTILITIES
// =============================================================================

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type} visible`;

    setTimeout(() => {
        statusEl.classList.remove('visible');
    }, 3000);
}

function logout() {
    firebase.auth().signOut().then(() => {
        window.location.href = 'login.html';
    }).catch(error => {
        console.error('Logout error:', error);
        showStatus('Error logging out', 'error');
    });
}

// =============================================================================
// VIEW WINDOW
// =============================================================================

/**
 * Open view-lightweight.html in a new window with the current tournament
 */
function openViewWindow() {
    if (!currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const viewUrl = `view-lightweight.html?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    window.open(viewUrl, '_blank', 'width=1920,height=1080');
}

/**
 * Open statistics-lightweight.html in a new window with the current tournament
 */
function openStatsWindow() {
    if (!currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const statsUrl = `statistics-lightweight.html?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    window.open(statsUrl, '_blank');
}

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

document.addEventListener('keydown', (e) => {
    // Escape to close modals
    if (e.key === 'Escape') {
        closeTeamPicker();
        closeResultConfirm();
        closePlayerManager();
        closeNextRoundModal();
        closeAutoMatchModal();
    }
});

// Close modal on outside click
document.getElementById('teamPickerModal').addEventListener('click', (e) => {
    if (e.target.id === 'teamPickerModal') {
        closeTeamPicker();
    }
});

// Close result confirm modal on outside click
document.getElementById('resultConfirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'resultConfirmModal') {
        closeResultConfirm();
    }
});

// Close player manager modal on outside click
document.getElementById('playerManagerModal').addEventListener('click', (e) => {
    if (e.target.id === 'playerManagerModal') {
        closePlayerManager();
    }
});

// Close next round modal on outside click
document.getElementById('nextRoundModal').addEventListener('click', (e) => {
    if (e.target.id === 'nextRoundModal') {
        closeNextRoundModal();
    }
});

// Close auto match modal on outside click
document.getElementById('autoMatchModal').addEventListener('click', (e) => {
    if (e.target.id === 'autoMatchModal') {
        closeAutoMatchModal();
    }
});
