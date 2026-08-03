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

let gameState = {};
let activeListener = null;
let boardModule = null;
let boardRenderer = null;
let currentUser = null;
let currentTournamentId = null;
let currentUserRole = null; // 'god' or 'admin'
let _prevRenderSignature = null;
let _prevBoardSignature = null;

// Structured action logger — instantiated eagerly (not lazily, unlike some
// other admin.js state) so player add/remove/link/swap always have
// somewhere to log to, matching what team-manager.js already does in god.html.
const actionLogger = new ActionLogger({
    getFirebaseDB: () => window.firebaseDB,
    getTournamentId: () => currentTournamentId,
    getCurrentUser: () => currentUser,
    getCurrentUserRole: () => currentUserRole,
    getGameState: () => gameState
});

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

// Smart match generator instance (uses BalanceOptimizer)
let smartMatchGenerator = null;

// Hex picker state
let selectedHexCoord = null;

// Pending hex wins - wins that haven't had a hex placed yet.
//
// Backed by gameState.pendingHexWins (persisted via saveGameState(), same
// as gameState.gameQueue/teams) instead of a plain in-memory array — TODO.md
// Task 15: this list is the SOLE gate for advancing past hex_placement_1/2
// (phase-manager.js's _getPendingHexCount(), wired at
// admin-improved-adapter.js:136), so a page refresh mid-hex-placement used
// to silently reset it to [], making the gate report "all clear" regardless
// of true state.
//
// Defined as a `window` accessor (not `let`) so every existing bare
// `pendingHexWins` read/write throughout this file AND
// admin-improved-adapter.js (a separate <script>, loaded after this one,
// sharing the same global scope) transparently goes through gameState with
// zero call-site changes — unqualified global identifier lookups fall
// through to accessor properties defined on `window` exactly like they do
// for `var`/function-declaration globals.
Object.defineProperty(window, 'pendingHexWins', {
    configurable: true,
    get() {
        if (!gameState) return [];
        if (!gameState.pendingHexWins) gameState.pendingHexWins = [];
        return gameState.pendingHexWins;
    },
    set(value) {
        if (gameState) gameState.pendingHexWins = value;
    }
});

// Async operation guard — prevents double-clicks on queue actions
let _asyncBusy = false;

// Game ID to display name mapping (fallback for built-in games)
// Use GAMES_CONFIG from games-config.js for game name mapping
// Backward compatibility: build GAME_NAME_MAP from GAMES_CONFIG
const GAME_NAME_MAP = (typeof GAMES_CONFIG !== 'undefined') ? GAMES_CONFIG.buildNameMap() : {};

/**
 * Get display name for a game ID
 * Checks tournament's gameDefinitions first, then falls back to GAMES_CONFIG
 */
function getGameDisplayName(gameId) {
    // First check if tournament has game definitions (for custom games)
    if (gameState?.gameDefinitions && gameState.gameDefinitions[gameId]) {
        return gameState.gameDefinitions[gameId].name;
    }
    // Use GAMES_CONFIG if available
    if (typeof GAMES_CONFIG !== 'undefined') {
        return GAMES_CONFIG.getGameName(gameId);
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

    // Old format: players array - look up current names from team roster
    if (matchTeam.players && Array.isArray(matchTeam.players)) {
        return matchTeam.players.map(p => {
            // Try to get current name from team roster
            let currentName = p.name;
            const teamId = p.originalTeamId || p.teamId;
            if (p.id && teamId && gameState?.teams) {
                const team = gameState.teams.find(t => t.id === teamId);
                if (team && team.players) {
                    const rosterPlayer = team.players.find(tp => tp.id === p.id);
                    if (rosterPlayer && rosterPlayer.name) {
                        currentName = rosterPlayer.name;
                    }
                }
            }
            return {
                id: p.id || null,
                name: currentName,
                teamId: teamId,
                originalTeamId: teamId,
                teamColor: p.originalTeamColor || p.teamColor,
                originalTeamColor: p.originalTeamColor || p.teamColor,
                teamName: p.originalTeamName || p.teamName,
                originalTeamName: p.originalTeamName || p.teamName
            };
        });
    }

    return [];
}

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('firebase-ready', async function() {
    console.log('Firebase ready, initializing admin...');

    // Check authentication
    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user || user.isAnonymous) {
            window.location.href = (window.BOARDGAME_BASE || '.') + '/login.html';
            return;
        }

        currentUser = user;

        // Check role
        try {
            const userDoc = await window.firebaseDB.collection('users').doc(user.uid).get();
            const userData = userDoc.data();

            if (!userData || (!userData.isGod && !userData.isAdmin)) {
                showToast('Access denied. God or Admin role required.', 'error', 4000);
                setTimeout(() => {
                    window.location.href = (window.BOARDGAME_BASE || '.') + '/full/home.html';
                }, 1500);
                return;
            }

            // Store user role
            currentUserRole = userData.isGod ? 'god' : 'admin';

            // Update UI (navbar elements may be rendered async by navbar.js)
            const userNameEl = document.getElementById('userName');
            const roleBadgeEl = document.getElementById('roleBadge');
            if (userNameEl) userNameEl.textContent = userData.displayName || user.email;
            if (roleBadgeEl) {
                roleBadgeEl.textContent = userData.isGod ? 'GOD' : 'ADMIN';
                roleBadgeEl.className = `navbar-role-badge ${userData.isGod ? 'god' : 'admin'}`;
            }

            // Initialize modules
            initializeBoardModules();

            // Monitor Firebase connection status
            initConnectionMonitor();

            // Tournament context comes from the navbar switcher: URL param first,
            // falling back to the shared storage contract it maintains.
            const tournamentId = resolveTournamentId({
                search: window.location.search,
                paramNames: ['tournamentId'],
                legacyParamNames: ['tournament', 'gameId', 'game'],
                cached: sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId')
            });

            if (tournamentId) {
                await loadTournament(tournamentId);
            }

        } catch (error) {
            console.error('Error checking user role:', error);
            showStatus('Error loading user data', 'error');
        } finally {
            // Always hide the loading overlay — it covers the whole page
            // (including the navbar) at z-index 2000, so leaving it up after
            // an error silently blocks every click, not just this page's UI.
            document.getElementById('loadingOverlay')?.classList.add('hidden');
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
            background-image: url('${(window.BOARDGAME_BASE || '.')}/shared/images/hexes/coords/${coord}.png');
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

async function refreshCurrentTournament() {
    if (!currentTournamentId) {
        showStatus('No tournament selected', 'error');
        return;
    }
    showStatus('Refreshing tournament...', 'info');
    await loadTournament(currentTournamentId);
    showStatus('Tournament refreshed', 'success');
}

async function loadTournament(tournamentId) {
    if (!tournamentId) return;

    // Cleanup previous listener
    if (activeListener) {
        activeListener();
        activeListener = null;
    }

    currentTournamentId = tournamentId;

    // Cache tournament context for navbar and cross-page navigation
    sessionStorage.setItem('currentTournamentId', tournamentId);
    localStorage.setItem('currentTournamentId', tournamentId);

    // Tournament chat — mount once, then just re-point it at the new tournament.
    // Admins aren't on a team, so no teamId is passed.
    if (window.ChatModule) {
        if (window._chatModule) {
            window._chatModule.switchTournament(tournamentId);
        } else {
            window._chatModule = new ChatModule({ tournamentId });
            window._chatModule.mount();
        }
    }

    showStatus('Loading tournament...', 'info');

    try {
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(tournamentId);

        // Set up real-time listener
        activeListener = window.firebaseOnSnapshot(tournamentRef, async (docSnapshot) => {
            if (docSnapshot.exists) {
                const newData = docSnapshot.data();
                // In-place update keeps the object reference stable for OOP modules
                Object.keys(gameState).forEach(k => { if (!(k in newData)) delete gameState[k]; });
                Object.assign(gameState, newData);
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

                // Cache tournament name for navbar
                const tName = gameState.tournamentName || gameState.name || tournamentId;
                sessionStorage.setItem('currentTournamentName', tName);
                localStorage.setItem('currentTournamentName', tName);
                const navLabel = document.getElementById('navTournamentLabel');
                if (navLabel) {
                    const navLabelText = navLabel.querySelector('.navbar-tournament-name-text') || navLabel;
                    navLabelText.textContent = tName;
                    navLabel.title = tName;
                    navLabel.classList.remove('empty');
                }

                // Update all displays (skip if nothing display-relevant changed)
                const newSignature = window.RenderSignature.computeFieldSignature(
                    gameState, window.RenderSignature.EXCLUDED_KEYS
                );
                if (newSignature !== _prevRenderSignature) {
                    _prevRenderSignature = newSignature;
                    updateDisplay();

                    // Apply custom team colors from Firebase
                    applyTeamColors();
                }

                if (gameState.status === 'archived') {
                    showStatus('This tournament is archived. Changes are blocked by the server.', 'warning');
                } else {
                    showStatus('Tournament loaded', 'success');
                }
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
// TOURNAMENT STATE MANAGEMENT
// =============================================================================

const TOURNAMENT_STATES = ['setup', 'playing', 'finished', 'archived'];

function updateTournamentStateButton() {
    const btn = document.getElementById('tournamentStateBtn');
    if (!btn) return;

    if (!gameState.teams) {
        btn.style.display = 'none';
        return;
    }

    const state = gameState.status || 'setup';
    btn.textContent = state;
    btn.style.display = 'inline-block';
    btn.className = 'btn-small tournament-state-btn state-' + state;
}

function openStateChangeModal() {
    if (!gameState || !currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const currentState = gameState.status || 'setup';
    const options = document.querySelectorAll('#stateOptions .state-option');
    options.forEach(opt => {
        const state = opt.dataset.state;
        opt.classList.toggle('current', state === currentState);

        // Archive button only visible when current state is 'finished' or already 'archived'
        if (state === 'archived') {
            opt.style.display = (currentState === 'finished' || currentState === 'archived') ? '' : 'none';
        }

        // When archived, only God can see other state options to unarchive
        if (currentState === 'archived' && state !== 'archived') {
            opt.style.display = (currentUserRole === 'god') ? '' : 'none';
        }
    });

    // Show warning for non-God users viewing archived tournament
    const warningEl = document.getElementById('archivedWarning');
    if (warningEl) {
        warningEl.style.display = (currentState === 'archived' && currentUserRole !== 'god') ? 'block' : 'none';
    }

    document.getElementById('stateChangeModal').classList.add('active');
}

function closeStateChangeModal() {
    document.getElementById('stateChangeModal').classList.remove('active');
}

async function confirmStateChange(newState) {
    if (!gameState || !currentTournamentId) return;

    const currentState = gameState.status || 'setup';
    if (newState === currentState) {
        closeStateChangeModal();
        return;
    }

    // ── Phase-system coupling ──
    // "finished" must go through the phase machine (endTournament sets both
    // currentPhase and status atomically); otherwise the next phase advance
    // silently flips status back to 'playing'.
    if (newState === 'finished' && gameState.currentPhase &&
        gameState.currentPhase.name !== 'tournament_end') {
        if (!confirm('End the tournament? The phase flow jumps to Tournament End. This cannot be undone.')) return;
        closeStateChangeModal();
        if (typeof window.endTournamentViaPhase === 'function') {
            await window.endTournamentViaPhase();
            updateTournamentStateButton();
        } else {
            showStatus('Phase adapter not ready — try again in a moment.', 'warning');
        }
        return;
    }
    // Going back to "setup" while the phase flow is running would desync the
    // two state systems permanently (the Flow Panel keys off currentPhase).
    if (newState === 'setup' && gameState.currentPhase) {
        showStatus('Phase flow is already running — cannot return to setup. Use Set Phase (god) if you need to rewind.', 'warning');
        return;
    }

    // Archive requires confirmation
    if (newState === 'archived') {
        if (!confirm('Archive this tournament? Archived tournaments are protected from edits. Only God users can unarchive.')) {
            return;
        }
        gameState.archivedAt = new Date().toISOString();
    }

    // Unarchiving requires God role
    if (currentState === 'archived') {
        if (currentUserRole !== 'god') {
            showStatus('Only God users can unarchive tournaments', 'error');
            return;
        }
        gameState.archivedAt = null;
    }

    gameState.status = newState;
    await saveGameState();
    updateTournamentStateButton();
    closeStateChangeModal();
    showStatus(`Tournament state changed to ${newState}`, 'success');
}

// =============================================================================
// DISPLAY UPDATES
// =============================================================================

function updateDisplay() {
    if (!gameState.teams) return;

    // Load room hexes into board module if available
    if (gameState.rooms && boardModule) {
        boardModule.setRoomHexes(gameState.rooms);
    }

    // Update navbar (element may not exist if navbar.js hasn't rendered yet)
    const navTournament = document.getElementById('navTournamentName');
    if (navTournament) navTournament.textContent = gameState.name || 'Tournament';

    // Update tournament state button
    updateTournamentStateButton();

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

    // Hook for phase adapter (full/admin.html)
    if (window._onAdminDisplayUpdate) window._onAdminDisplayUpdate();
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
    if (!indicator) return;
    indicator.classList.remove('connected', 'disconnected', 'warning');
    indicator.classList.add(status);
    indicator.title = `Firebase: ${status}`;

    // Sync with connection banner from toast.js
    if (status === 'disconnected') {
        if (typeof showConnectionBanner === 'function') showConnectionBanner();
    } else {
        if (typeof hideConnectionBanner === 'function') hideConnectionBanner();
    }
}

/**
 * Monitor browser connection state using native online/offline events.
 * Shows/hides the offline banner and sets window._isOffline flag.
 */
function initConnectionMonitor() {
    // Set initial state
    if (!navigator.onLine) {
        updateConnectionStatus('disconnected');
    }

    window.addEventListener('online', () => {
        updateConnectionStatus('connected');
    });

    window.addEventListener('offline', () => {
        updateConnectionStatus('disconnected');
    });
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
                <span class="player-drag-handle">${ICON_SVGS.gripVertical}</span>
                <span class="player-name">${escapeHtml(p.name)}</span>
            </div>
        `).join('');

        const splitCount = team.splitCount || 0;
        const challengeSplitCount = team.challengeSplitCount || 0;

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
                <div class="team-split-count">
                    <span title="Times this team has been split in matches"><span class="split-label">Split:</span> <span class="split-value">${splitCount}</span></span>
                    <span class="split-separator">|</span>
                    <span title="Times this team has been involved in challenges"><span class="challenge-split-label">Challenge:</span> <span class="challenge-split-value">${challengeSplitCount}</span></span>
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

    if (!gameState?.teams || !currentTournamentId) return;

    // Delta adjustments must go through a transaction: two admin devices
    // both reading their own stale local gameState, adding a delta, then
    // saveGameState()-ing the whole doc (which fully overwrites the `teams`
    // array — Firestore merge:true doesn't merge array elements) can silently
    // drop one device's edit (bug #5a). The transaction re-reads the current
    // server value immediately before writing, so concurrent deltas
    // correctly accumulate instead of racing.
    const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentTournamentId);
    let updatedTeams = null;
    try {
        await window.firebaseDB.runTransaction(async (transaction) => {
            const doc = await transaction.get(tournamentRef);
            const teams = (doc.data() || {}).teams || [];
            const idx = teams.findIndex(t => t.id === teamId);
            if (idx === -1) return;
            teams[idx] = { ...teams[idx], points: Math.max(0, (teams[idx].points || 0) + delta) };
            transaction.update(tournamentRef, { teams });
            updatedTeams = teams;
        });
    } catch (error) {
        console.error('Error adjusting team points:', error);
        showStatus('Error saving points to Firebase', 'error');
        return;
    }

    if (updatedTeams) {
        gameState.teams = updatedTeams;
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

        const playersList = players.map((player, idx) => {
            const isLinked = !!player.uid;
            return `
            <div class="pm-player">
                <div class="pm-player-info" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                    <input type="text" value="${escapeHtml(player.name || '')}"
                           onchange="updatePlayerName(${team.id}, ${idx}, this.value)"
                           placeholder="Player name">
                    <span class="pm-player-badge" style="font-size:0.7rem;color:${isLinked ? '#10b981' : '#f59e0b'};">
                        ${isLinked ? '● Linked' : '○ Placeholder'}
                    </span>
                </div>
                <button class="btn-remove" onclick="removePlayerFromTeam(${team.id}, ${idx})" title="Delete this slot">${ICON_SVGS.x}</button>
            </div>
        `;
        }).join('');

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
    actionLogger.logAction('player_added', 'admin', {
        teamId, teamName: team.name, playerName, playerId
    }, { playerId, teamId });
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
    const isLinked = !!player?.uid;

    const confirmMsg = isLinked
        ? `Delete "${playerName}"'s slot from ${team.name}? This permanently removes their match history attribution and cannot be undone — if you're replacing this player, use god.html's Users tab to swap instead.`
        : `Delete this empty slot from ${team.name}? This cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    if (playerId && window.PlayerUtils) {
        window.PlayerUtils.deletePlayerSlot(gameState, teamId, playerId);
    } else {
        team.players.splice(playerIndex, 1);
        if (playerId && team.playerIds) {
            team.playerIds = team.playerIds.filter(id => id !== playerId);
        }
    }

    // Linked players need their Firestore user doc unhooked too, or a stale
    // assignedTeamId strands them on a team they've been removed from.
    if (isLinked && window.firebaseDB) {
        try {
            if (!team.formerPlayers) team.formerPlayers = [];
            team.formerPlayers.push({
                uid: player.uid, playerId, name: playerName,
                leftAt: new Date().toISOString(), pointsWhenLeft: team.points || 0
            });
            // Only clear if their account still points at this exact slot —
            // they may have since been linked into a different tournament,
            // whose assignment must not get wiped out here.
            const userRef = window.firebaseDB.collection('users').doc(player.uid);
            const userSnap = await userRef.get();
            if (window.UserAssignment.shouldClearUserAssignment(userSnap.data(), { tournamentId: currentTournamentId, playerId })) {
                await userRef.update({
                    assignedTournamentId: null, assignedTeamId: null, assignedTeamName: null,
                    assignedPlayerId: null, isPlayer: false,
                    unassignedAt: new Date().toISOString(),
                    unassignedBy: firebase.auth().currentUser?.uid || 'admin'
                });
            }
        } catch (error) {
            console.error('[Admin] Failed to clear removed player\'s user doc:', error);
        }
    }

    await saveGameState();
    actionLogger.logAction('player_removed', 'admin', {
        teamId, teamName: team.name, playerName, playerId, wasLinked: isLinked
    }, { player });
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
    renderMatchQueue(); // Also update match queue with new player names
    renderOngoingMatches();
}

/**
 * Update a team's name
 */
async function updateTeamName(teamId, newName) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    const trimmed = newName.trim();
    if (!trimmed || trimmed === team.name) return;

    const oldName = team.name;

    // Name history
    if (!team.nameHistory) team.nameHistory = [];
    team.nameHistory.push({
        oldName,
        newName: trimmed,
        changedAt: new Date().toISOString(),
        changedBy: firebase.auth().currentUser?.uid || 'unknown'
    });

    team.name = trimmed;

    await saveGameState();
    renderTeamsList();
    renderPlayerManager();

    // Update user docs with new team name
    try {
        const db = window.firebaseDB;
        if (db && team.players) {
            const batch = db.batch();
            let hasBatchOps = false;
            for (const player of team.players) {
                if (player.uid) {
                    batch.update(db.collection('users').doc(player.uid), {
                        assignedTeamName: trimmed
                    });
                    hasBatchOps = true;
                }
            }
            if (hasBatchOps) await batch.commit();
        }
    } catch (e) {
        console.warn('[Admin] Failed to update user docs with new team name:', e);
    }
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
            root.style.setProperty(`--team-${team.id}-alpha`, `rgba(${r}, ${g}, ${b}, 1)`);
        }
    });
}

// =============================================================================
// SEATING ORDER
// =============================================================================

/**
 * Escape HTML to prevent XSS in rendered player names
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Get the current seating order, validated as a permutation of 1..10.
 * Falls back to default [1..10] if absent or invalid.
 */
function getSeatingOrder() {
    const order = gameState?.seatingOrder;
    if (!Array.isArray(order) || order.length !== 10) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const sorted = [...order].sort((a, b) => a - b);
    const isValid = sorted.every((val, idx) => val === idx + 1);
    if (!isValid) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    return [...order];
}

/**
 * Build a lookup of logical player numbers to player info.
 * Iterates teams in the same order as getPlayerMapping() in the view page.
 */
function getAllPlayersInOrder() {
    const players = [];
    const teams = gameState?.teams || [];
    let playerNum = 1;

    for (const team of teams) {
        const teamPlayers = team.players || [];
        for (const player of teamPlayers) {
            if (playerNum <= 10) {
                players.push({
                    playerNum,
                    name: player.name || 'Player ' + playerNum,
                    teamId: team.id,
                    teamName: team.name || 'Team ' + team.id,
                    teamColor: team.color || '#666666'
                });
                playerNum++;
            }
        }
    }

    while (playerNum <= 10) {
        const teamIndex = Math.floor((playerNum - 1) / 2);
        const team = teams[teamIndex] || {};
        players.push({
            playerNum,
            name: 'Player ' + playerNum,
            teamId: team.id || teamIndex + 1,
            teamName: team.name || 'Team ' + (teamIndex + 1),
            teamColor: team.color || '#666666'
        });
        playerNum++;
    }

    return players;
}

/**
 * Open the seating order modal
 */
function openSeatingOrder() {
    if (!gameState?.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    renderSeatingOrder();
    document.getElementById('seatingOrderModal').classList.add('active');
}

/**
 * Close the seating order modal
 */
function closeSeatingOrder() {
    const modal = document.getElementById('seatingOrderModal');
    if (modal) modal.classList.remove('active');
}

/**
 * Render the seating order modal contents
 */
function renderSeatingOrder() {
    const order = getSeatingOrder();
    const allPlayers = getAllPlayersInOrder();
    const playerLookup = {};
    for (const p of allPlayers) {
        playerLookup[p.playerNum] = p;
    }

    const leftWall = document.getElementById('seatingLeftWall');
    const rightWall = document.getElementById('seatingRightWall');

    let leftHtml = '';
    for (let seat = 1; seat <= 5; seat++) {
        const pNum = order[seat - 1];
        leftHtml += buildSeatItemHTML(seat, pNum, playerLookup[pNum]);
    }
    leftWall.innerHTML = leftHtml;

    let rightHtml = '';
    for (let seat = 6; seat <= 10; seat++) {
        const pNum = order[seat - 1];
        rightHtml += buildSeatItemHTML(seat, pNum, playerLookup[pNum]);
    }
    rightWall.innerHTML = rightHtml;

    setupSeatingDragDrop();
}

/**
 * Build HTML for a single seat item
 */
function buildSeatItemHTML(seatNum, playerNum, info) {
    const name = info ? escapeHtml(info.name) : 'Player ' + playerNum;
    const color = info ? info.teamColor : '#666666';

    return `<div class="seating-item" draggable="true" data-seat="${seatNum}">
        <span class="seating-drag-handle">&#9776;</span>
        <span class="seating-seat-num">${seatNum}</span>
        <span class="seating-team-dot" style="background: ${color}"></span>
        <span class="seating-player-name">${name}</span>
    </div>`;
}

/**
 * Set up drag-and-drop on all seating items (swap on drop, across both walls)
 * Uses an AbortController so all listeners are cleaned up on re-render.
 */
let _seatingDragAbort = null;

function setupSeatingDragDrop() {
    // Abort previous listeners before adding new ones
    if (_seatingDragAbort) _seatingDragAbort.abort();
    _seatingDragAbort = new AbortController();
    const signal = _seatingDragAbort.signal;

    const items = document.querySelectorAll('.seating-item');
    let draggedSeat = null;

    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedSeat = parseInt(item.dataset.seat);
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        }, { signal });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedSeat = null;
            items.forEach(el => el.classList.remove('drag-over'));
        }, { signal });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (parseInt(item.dataset.seat) !== draggedSeat) {
                item.classList.add('drag-over');
            }
        }, { signal });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        }, { signal });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            const targetSeat = parseInt(item.dataset.seat);
            if (draggedSeat !== null && draggedSeat !== targetSeat) {
                swapSeatingPositions(draggedSeat, targetSeat);
            }
        }, { signal });
    });
}

/**
 * Swap two seats in the seating order and save
 */
async function swapSeatingPositions(seatA, seatB) {
    const order = getSeatingOrder();
    const temp = order[seatA - 1];
    order[seatA - 1] = order[seatB - 1];
    order[seatB - 1] = temp;

    gameState.seatingOrder = order;
    await saveGameState();
    renderSeatingOrder();
}

/**
 * Reset seating order to default [1..10]
 */
async function resetSeatingOrder() {
    gameState.seatingOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    await saveGameState();
    renderSeatingOrder();
    showStatus('Seating order reset to default', 'success');
}

// =============================================================================
// GAME MANAGER
// =============================================================================

/**
 * Open the game manager modal
 */
function openGameManager() {
    if (!gameState.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    renderGameManagerList();
    renderGameCatalog();
    document.getElementById('gameManagerModal').classList.add('active');
}

/**
 * Close the game manager modal
 */
function closeGameManager() {
    document.getElementById('gameManagerModal').classList.remove('active');
}

/**
 * Switch between catalog/custom tabs in the add game section
 */
function switchGameManagerTab(tab) {
    document.getElementById('gmTabCatalog').classList.toggle('active', tab === 'catalog');
    document.getElementById('gmTabCustom').classList.toggle('active', tab === 'custom');
    document.getElementById('gmCatalogTab').style.display = tab === 'catalog' ? '' : 'none';
    document.getElementById('gmCustomTab').style.display = tab === 'custom' ? '' : 'none';
}

/**
 * Count queued/ongoing matches for a given game
 */
function countMatchesForGame(gameId) {
    if (!gameState?.gameQueue) return 0;
    return gameState.gameQueue.filter(m =>
        (m.game === gameId || m.gameType === gameId) &&
        (m.status === 'pending' || m.status === 'queued' || m.status === 'ongoing')
    ).length;
}

/**
 * Render the list of current tournament games with enable/disable toggles
 */
function renderGameManagerList() {
    const container = document.getElementById('gmGamesList');
    const selectedGames = gameState?.selectedGames || [];

    if (selectedGames.length === 0) {
        container.innerHTML = '<p class="queue-empty">No games in this tournament</p>';
        return;
    }

    container.innerHTML = selectedGames.map(gameId => {
        const name = getGameDisplayName(gameId);
        const def = gameState?.gameDefinitions?.[gameId] || {};
        const configGame = (typeof GAMES_CONFIG !== 'undefined') ? GAMES_CONFIG.getGame(gameId) : null;
        const format = def.format || configGame?.format || '5v5';
        const icon = def.icon || configGame?.icon || '🎮';
        const image = def.image || configGame?.image || '';
        const resolvedImage = (typeof GAMES_CONFIG !== 'undefined' && image) ? GAMES_CONFIG.resolveImagePath(image) : image;
        const matchCount = countMatchesForGame(gameId);

        const imageHtml = image
            ? `<img src="${resolvedImage}" alt="${name}" class="gm-game-icon-img" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
            : '';
        const iconFallback = image
            ? `<span class="gm-game-icon-emoji" style="display:none">${icon}</span>`
            : `<span class="gm-game-icon-emoji">${icon}</span>`;

        return `
            <div class="gm-game-item">
                <div class="gm-game-icon">${imageHtml}${iconFallback}</div>
                <div class="gm-game-info">
                    <span class="gm-game-name">${name}</span>
                    <span class="gm-game-meta">${format}${matchCount > 0 ? ` · ${matchCount} queued` : ''}</span>
                </div>
                <button class="btn-small danger" onclick="removeGameFromTournament('${gameId}')" title="Remove from tournament">Remove</button>
            </div>
        `;
    }).join('');
}

/**
 * Render the catalog of available games that aren't already in the tournament
 */
function renderGameCatalog() {
    const container = document.getElementById('gmCatalogList');
    const selectedGames = gameState?.selectedGames || [];

    if (typeof GAMES_CONFIG === 'undefined') {
        container.innerHTML = '<p class="queue-empty">Games catalog not loaded</p>';
        return;
    }

    const allGames = GAMES_CONFIG.getAllGames();
    const available = allGames.filter(g => !selectedGames.includes(g.id));

    if (available.length === 0) {
        container.innerHTML = '<p class="queue-empty">All catalog games are already added</p>';
        return;
    }

    container.innerHTML = available.map(game => {
        const resolvedCatalogImage = game.image ? GAMES_CONFIG.resolveImagePath(game.image) : '';
        const imageHtml = game.image
            ? `<img src="${resolvedCatalogImage}" alt="${game.name}" class="gm-game-icon-img" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
            : '';
        const iconFallback = game.image
            ? `<span class="gm-game-icon-emoji" style="display:none">${game.icon || '🎮'}</span>`
            : `<span class="gm-game-icon-emoji">${game.icon || '🎮'}</span>`;

        return `
            <div class="gm-game-item gm-catalog-item">
                <div class="gm-game-icon">${imageHtml}${iconFallback}</div>
                <div class="gm-game-info">
                    <span class="gm-game-name">${game.name}</span>
                    <span class="gm-game-meta">${game.format}</span>
                </div>
                <button class="btn-small primary" onclick="addCatalogGameToTournament('${game.id}')">Add</button>
            </div>
        `;
    }).join('');
}

/**
 * Add a game from GAMES_CONFIG catalog to the tournament
 */
async function addCatalogGameToTournament(gameId) {
    if (!gameState.teams) return;

    const game = GAMES_CONFIG.getGame(gameId);
    if (!game) {
        showStatus('Game not found in catalog', 'error');
        return;
    }

    // Check if already added
    if (gameState.selectedGames && gameState.selectedGames.includes(gameId)) {
        showStatus('Game is already in the tournament', 'warning');
        return;
    }

    // Add to selectedGames
    if (!gameState.selectedGames) gameState.selectedGames = [];
    gameState.selectedGames.push(gameId);

    // Add to gameDefinitions
    if (!gameState.gameDefinitions) gameState.gameDefinitions = {};
    gameState.gameDefinitions[gameId] = {
        name: game.name,
        shortName: game.shortName || game.name,
        format: game.format,
        icon: game.icon || '🎮',
        image: game.image || '',
        splitFormat: game.splitFormat || false,
        custom: false
    };

    await saveGameState();
    reinitializeMatchGenerator();
    updateDisplay();
    renderGameManagerList();
    renderGameCatalog();
    showStatus(`Added ${game.name} to tournament`, 'success');
}

/**
 * Add a custom game to the tournament
 */
async function addCustomGameToTournament(triggerBtn) {
    if (!gameState.teams) return;

    const id = document.getElementById('gmCustomId').value.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
    const name = document.getElementById('gmCustomName').value.trim();
    const shortName = document.getElementById('gmCustomShortName').value.trim() || name;
    const format = document.getElementById('gmCustomFormat').value;
    const icon = document.getElementById('gmCustomIcon').value.trim() || '🎮';
    const image = document.getElementById('gmCustomImage').value.trim();

    if (!id) {
        showStatus('Game ID is required', 'error');
        return;
    }
    if (!name) {
        showStatus('Game name is required', 'error');
        return;
    }

    // Check for duplicate
    if (gameState.selectedGames && gameState.selectedGames.includes(id)) {
        showStatus('A game with this ID already exists in the tournament', 'warning');
        return;
    }

    // Add to selectedGames
    if (!gameState.selectedGames) gameState.selectedGames = [];
    gameState.selectedGames.push(id);

    // Add to gameDefinitions
    if (!gameState.gameDefinitions) gameState.gameDefinitions = {};
    gameState.gameDefinitions[id] = {
        name,
        shortName,
        format,
        icon,
        image,
        splitFormat: format === '3v3+2v2',
        custom: true
    };

    await saveGameState(triggerBtn);
    reinitializeMatchGenerator();
    updateDisplay();
    renderGameManagerList();
    renderGameCatalog();

    // Clear the form
    document.getElementById('gmCustomId').value = '';
    document.getElementById('gmCustomName').value = '';
    document.getElementById('gmCustomShortName').value = '';
    document.getElementById('gmCustomFormat').value = '5v5';
    document.getElementById('gmCustomIcon').value = '';
    document.getElementById('gmCustomImage').value = '';

    showStatus(`Added ${name} to tournament`, 'success');
}

/**
 * Remove a game from the tournament
 */
async function removeGameFromTournament(gameId) {
    if (!gameState || !gameState.selectedGames) return;

    const name = getGameDisplayName(gameId);
    const matchCount = countMatchesForGame(gameId);

    if (matchCount > 0) {
        if (!confirm(`"${name}" has ${matchCount} queued/ongoing match(es). Remove it anyway?`)) {
            return;
        }
    }

    // Remove from selectedGames
    gameState.selectedGames = gameState.selectedGames.filter(id => id !== gameId);

    // Keep gameDefinitions entry for historical matches display

    await saveGameState();
    reinitializeMatchGenerator();
    updateDisplay();
    renderGameManagerList();
    renderGameCatalog();
    showStatus(`Removed ${name} from tournament`, 'success');
}

/**
 * Reinitialize the smart match generator after game list changes
 */
function reinitializeMatchGenerator() {
    if (smartMatchGenerator) {
        smartMatchGenerator.initializeGameRotation();
    }
}

// =============================================================================
// BOARD RENDERING
// =============================================================================

function renderBoard() {
    if (!boardRenderer || !boardModule) return;

    const boardSignature = window.RenderSignature.computeBoardSignature(gameState?.board, gameState?.rooms);
    if (boardSignature === _prevBoardSignature) return;
    _prevBoardSignature = boardSignature;

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
        // Hearts cannot be rooms
        if (hexType === 'mountain-heart' || hexType === 'side-heart') {
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
                ${isRoom ? ICON_SVGS.doorOpen + ' Remove Room' : ICON_SVGS.doorOpen + ' Mark as Room'}
            </button>
        `;
    } else {
        optionsHtml += `
            <div class="team-picker-hint" style="padding: 8px; color: var(--text-tertiary); font-size: 0.8rem;">
                ${hexType === 'mountain-heart' ? ICON_SVGS.heart + ICON_SVGS.heart + ' Mountain Heart' :
                  hexType === 'side-heart' ? ICON_SVGS.heart + ' Side Heart' :
                  ICON_SVGS.star + ' Starting Location'} - Cannot be a room
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

    // Clear pending hex win notification for this team
    await clearPendingHexWin(teamId);

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
// DEFAULT ROOMS - SAVE/LOAD
// =============================================================================

async function saveDefaultRooms() {
    const rooms = gameState.rooms || [];
    try {
        await saveDefaultRoomsDoc(window.firebaseDB, rooms);
        showStatus(`Saved ${rooms.length} default rooms`, 'success');
    } catch (error) {
        console.error('Error saving default rooms:', error);
        showStatus('Error saving default rooms', 'error');
    }
}

async function loadDefaultRooms() {
    try {
        const rooms = await loadDefaultRoomsDoc(window.firebaseDB);
        if (!rooms) {
            showStatus('No default rooms found', 'error');
            return;
        }
        gameState.rooms = rooms;
        boardModule.setRoomHexes(gameState.rooms);
        await saveGameState();
        renderBoard();
        showStatus(`Loaded ${rooms.length} default rooms`, 'success');
    } catch (error) {
        console.error('Error loading default rooms:', error);
        showStatus('Error loading default rooms', 'error');
    }
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
                <span>${escapeHtml(p.name)} (${escapeHtml(p.originalTeamName || 'Unknown')})</span>
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

async function addMatchToQueue(triggerBtn) {
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
    assignDiscordAndLobby([queueEntry]);
    gameState.gameQueue.push(queueEntry);

    await saveGameState(triggerBtn);
    clearMatchSetup();
    showStatus(`Match #${matchNumber} (${playType}) added to queue!`, 'success');
}

// =============================================================================
// BREAK QUEUE ENTRIES
// =============================================================================

const BREAK_TYPES = {
    piss:      { label: 'Piss Break',      emoji: iconSvg('toilet', '#9ca3af') },
    cigarette: { label: 'Cigarette Break',  emoji: iconSvg('cigarette', '#fef9c3') },
    food:      { label: 'Food Break',       emoji: iconSvg('pizza', '#f97316') },
    sleep:     { label: 'Sleep',            emoji: iconSvg('moon', '#818cf8') }
};

let _breakMenuCloseHandler = null;

function toggleBreakMenu() {
    const menu = document.getElementById('breakMenu');
    if (!menu) return;

    // Clean up previous listener if any
    if (_breakMenuCloseHandler) {
        document.removeEventListener('click', _breakMenuCloseHandler);
        _breakMenuCloseHandler = null;
    }

    menu.classList.toggle('active');

    if (menu.classList.contains('active')) {
        // Close on outside click
        _breakMenuCloseHandler = (e) => {
            if (!e.target.closest('.break-dropdown')) {
                menu.classList.remove('active');
                document.removeEventListener('click', _breakMenuCloseHandler);
                _breakMenuCloseHandler = null;
            }
        };
        setTimeout(() => document.addEventListener('click', _breakMenuCloseHandler), 0);
    }
}

async function addBreakToQueue(breakType) {
    const def = BREAK_TYPES[breakType];
    if (!def) return;

    document.getElementById('breakMenu')?.classList.remove('active');

    const breakEntry = {
        id: Date.now(),
        isBreak: true,
        breakType: breakType,
        breakLabel: def.label,
        breakEmoji: def.emoji,
        status: 'pending',
        teams: [],
        createdAt: new Date().toISOString()
    };

    gameState.gameQueue = gameState.gameQueue || [];

    // Insert as next up: right after ongoing matches, before all pending
    const queue = gameState.gameQueue;
    const firstPendingIndex = queue.findIndex(g =>
        g.status === 'pending' || g.status === undefined || g.status === 'queued'
    );
    if (firstPendingIndex === -1) {
        queue.push(breakEntry);
    } else {
        queue.splice(firstPendingIndex, 0, breakEntry);
    }

    await saveGameState();
    showStatus(`${def.label} added — playing next`, 'success');
}

async function completeBreak(breakId) {
    if (_asyncBusy) return;
    _asyncBusy = true;
    try {
        const breakEntry = (gameState?.gameQueue || []).find(g => g.id === breakId && g.isBreak);
        if (!breakEntry) {
            showStatus('Break not found', 'error');
            return;
        }

        breakEntry.status = 'completed';
        breakEntry.completedAt = new Date().toISOString();

        await saveGameState();

        logEvent('break_completed', {
            breakType: breakEntry.breakType,
            breakLabel: breakEntry.breakLabel,
            message: `${breakEntry.breakEmoji || ''} ${breakEntry.breakLabel} completed`
        });

        showStatus(`${breakEntry.breakLabel} completed!`, 'success');
        closeResultConfirm();
    } finally { _asyncBusy = false; }
}

/**
 * Open the challenge setup modal to select disputing teams
 * Called when clicking the "Challenge" button
 * Supports up to 2 disputes per side (4 teams total)
 */
function addChallengeToQueue() {
    // Check all sides have at least one player
    const emptySides = manualGameSetup.sides.filter(s => s.length === 0);
    if (emptySides.length > 0) {
        showStatus('All sides need at least one player', 'warning');
        return;
    }

    if (!gameState?.teams || gameState.teams.length < 2) {
        showStatus('Need at least 2 teams for a challenge', 'warning');
        return;
    }

    // Build team options with color indicators (required fields)
    const teamOptionsRequired = gameState.teams.map(team => {
        const color = team.color || getTeamColor(team.id) || '#666';
        const name = team.name || 'Team ' + team.id;
        return `<option value="${team.id}" data-color="${color}">● ${name}</option>`;
    }).join('');

    // Optional fields have "None" option
    const teamOptionsOptional = `<option value="" data-color="">— None —</option>` + teamOptionsRequired;

    // Populate all dropdowns
    document.getElementById('challengeSideA1').innerHTML = teamOptionsRequired;
    document.getElementById('challengeSideA2').innerHTML = teamOptionsOptional;
    document.getElementById('challengeSideB1').innerHTML = teamOptionsRequired;
    document.getElementById('challengeSideB2').innerHTML = teamOptionsOptional;

    // Default: select different teams for Side A and Side B primary disputes
    if (gameState.teams.length >= 2) {
        document.getElementById('challengeSideA1').value = gameState.teams[0].id;
        document.getElementById('challengeSideB1').value = gameState.teams[1].id;
    }

    // Apply color styling to all dropdowns (use onchange to avoid listener accumulation)
    ['challengeSideA1', 'challengeSideA2', 'challengeSideB1', 'challengeSideB2'].forEach(id => {
        const select = document.getElementById(id);
        select.onchange = () => {
            updateChallengeSelectColor(id);
            updateChallengeHexPicker();
        };
        updateChallengeSelectColor(id);
    });

    updateChallengeHexPicker();
    document.getElementById('challengeSetupModal').classList.add('active');
}

/**
 * Populate the contested hex picker with heart hexes controlled by the selected teams
 */
function updateChallengeHexPicker() {
    const hexField = document.getElementById('challengeHexField');
    const hexSelect = document.getElementById('challengeHexSelect');
    if (!hexField || !hexSelect) return;

    // Gather all selected team IDs from both sides
    const teamIds = ['challengeSideA1', 'challengeSideA2', 'challengeSideB1', 'challengeSideB2']
        .map(id => document.getElementById(id)?.value)
        .filter(Boolean)
        .map(v => parseInt(v) || v);

    // Find heart hexes controlled by any of these teams
    const heartHexes = [];
    Object.entries(gameState.heartHexControl || {}).forEach(([coord, ownerId]) => {
        if (teamIds.some(tid => String(tid) === String(ownerId))) {
            const team = gameState.teams?.find(t => String(t.id) === String(ownerId));
            const teamName = team?.name || `Team ${ownerId}`;
            const hexType = boardModule?.getHexType
                ? (() => {
                    const m = coord.match(/q(-?\d+)r(-?\d+)/);
                    return m ? boardModule.getHexType(parseInt(m[1]), parseInt(m[2])) : '';
                })()
                : '';
            const typeLabel = hexType === 'mountain-heart' ? 'Mountain Heart' : hexType === 'side-heart' ? 'Side Heart' : 'Heart';
            heartHexes.push({ coord, ownerId, teamName, typeLabel });
        }
    });

    if (heartHexes.length === 0) {
        hexField.style.display = 'none';
        hexSelect.innerHTML = '<option value="">— No specific hex —</option>';
        return;
    }

    hexField.style.display = '';
    hexSelect.innerHTML = '<option value="">— No specific hex —</option>' +
        heartHexes.map(h =>
            `<option value="${h.coord}">${h.typeLabel} (${h.coord}) — ${h.teamName}</option>`
        ).join('');
}

/**
 * Update select border color based on selected team
 */
function updateChallengeSelectColor(selectId) {
    const select = document.getElementById(selectId);
    const selectedOption = select.options[select.selectedIndex];
    const color = selectedOption?.dataset?.color || '';

    if (select.value && color) {
        select.style.borderLeft = `4px solid ${color}`;
        select.style.paddingLeft = '8px';
    } else {
        select.style.borderLeft = '1px solid var(--border-color)';
        select.style.paddingLeft = '10px';
    }
}

/**
 * Close the challenge setup modal
 */
function closeChallengeSetupModal() {
    document.getElementById('challengeSetupModal').classList.remove('active');
}

/**
 * Confirm and create the challenge match with selected disputing teams
 * Supports multiple disputes - Side A teams vs Side B teams
 */
async function confirmChallengeSetup(triggerBtn) {
    // Get teams from each side
    const sideA1 = document.getElementById('challengeSideA1').value;
    const sideA2 = document.getElementById('challengeSideA2').value;
    const sideB1 = document.getElementById('challengeSideB1').value;
    const sideB2 = document.getElementById('challengeSideB2').value;

    // Build arrays of disputing teams per side
    const sideATeams = [sideA1, sideA2].filter(Boolean).map(id => parseInt(id) || id);
    const sideBTeams = [sideB1, sideB2].filter(Boolean).map(id => parseInt(id) || id);

    // Validate: need at least 1 team per side
    if (sideATeams.length === 0 || sideBTeams.length === 0) {
        showStatus('Each side needs at least one team', 'warning');
        return;
    }

    // Validate: no team should appear on both sides
    const overlap = sideATeams.filter(id => sideBTeams.some(bid => String(bid) === String(id)));
    if (overlap.length > 0) {
        showStatus('A team cannot be on both sides', 'warning');
        return;
    }

    // Validate: no duplicate teams on same side
    if (sideATeams.length === 2 && String(sideATeams[0]) === String(sideATeams[1])) {
        showStatus('Cannot select the same team twice on Side A', 'warning');
        return;
    }
    if (sideBTeams.length === 2 && String(sideBTeams[0]) === String(sideBTeams[1])) {
        showStatus('Cannot select the same team twice on Side B', 'warning');
        return;
    }

    closeChallengeSetupModal();

    const playType = getCalculatedPlayType();

    // Build teams array from sides - store player IDs for normalized structure
    const teams = manualGameSetup.sides.map((side, idx) => ({
        id: `TEAM_${SIDE_LABELS[idx]}`,
        playerIds: side.map(p => p.id).filter(Boolean)
    }));

    // Get next match number (persistent, doesn't change with reordering)
    const matchNumber = getNextMatchNumber();

    // Get contested hex (if selected)
    const challengeHexCoord = document.getElementById('challengeHexSelect')?.value || null;

    // Store disputing teams per side for proper hex placement logic
    const queueEntry = {
        id: Date.now(),
        matchNumber: matchNumber,
        game: document.getElementById('gameType').value,
        playType: playType,
        teams: teams,
        status: 'pending',
        isChallenge: true,
        challengeHexCoord: challengeHexCoord,
        // New structure: teams grouped by side
        disputingSideA: sideATeams,
        disputingSideB: sideBTeams,
        // Legacy field for backward compatibility
        disputingTeamIds: [...sideATeams, ...sideBTeams],
        createdAt: new Date().toISOString()
    };

    gameState.gameQueue = gameState.gameQueue || [];

    // Find insertion position: after ongoing games + first pending match
    const queue = gameState.gameQueue;
    const ongoingCount = queue.filter(g => g.status === 'ongoing').length;
    const firstPendingIndex = queue.findIndex(g =>
        g.status === 'pending' || g.status === undefined || g.status === 'queued'
    );

    let insertIndex;
    if (firstPendingIndex === -1) {
        insertIndex = ongoingCount;
    } else {
        insertIndex = firstPendingIndex + 1;
    }

    assignDiscordAndLobby([queueEntry]);
    queue.splice(insertIndex, 0, queueEntry);

    // Build status message showing all disputes
    const getTeamName = (id) => {
        const team = gameState.teams.find(t => String(t.id) === String(id));
        return team?.name || `Team ${id}`;
    };
    const sideANames = sideATeams.map(getTeamName).join(' & ');
    const sideBNames = sideBTeams.map(getTeamName).join(' & ');
    const disputeCount = Math.max(sideATeams.length, sideBTeams.length);
    const disputeLabel = disputeCount > 1 ? `${disputeCount} disputes` : '1 dispute';

    await saveGameState(triggerBtn);
    clearMatchSetup();
    showStatus(`⚔️ CHALLENGE #${matchNumber}: ${sideANames} vs ${sideBNames} (${disputeLabel})`, 'success');
}

/**
 * Get the next available match number
 * Looks at all matches (including completed) to ensure unique numbering
 */
/**
 * Assign Discord channels and lobby creators to match queue entries.
 * Channels #1-#5 are available. Simultaneous matches get consecutive pairs.
 * @param {Object[]} entries - Array of queue entries to enrich (mutated in place)
 */
function assignDiscordAndLobby(entries) {
    if (!entries || entries.length === 0) return;

    // Find already-used channels from pending/ongoing matches
    const queue = gameState?.gameQueue || [];
    const usedChannels = new Set();
    queue.forEach(m => {
        if (m.isBreak || m.status === 'completed') return;
        if (m.discordChannels) {
            Object.values(m.discordChannels).forEach(ch => usedChannels.add(ch));
        }
    });

    // Available channels 1-5 (5 is overflow/admin)
    const allChannels = [1, 2, 3, 4, 5];
    const available = allChannels.filter(ch => !usedChannels.has(ch));

    let channelIdx = 0;
    entries.forEach(entry => {
        if (entry.isBreak) return;

        const teams = entry.teams || [];
        if (teams.length < 2) return;

        // Assign Discord channels per side
        const discordChannels = {};
        teams.forEach(team => {
            if (channelIdx < available.length) {
                discordChannels[team.id] = available[channelIdx++];
            }
        });
        entry.discordChannels = discordChannels;

        // Designate lobby creators (first player of each side)
        const lobbyCreators = {};
        teams.forEach(team => {
            const players = team.players || [];
            const playerIds = team.playerIds || [];
            let creator = null;

            if (players.length > 0) {
                creator = { name: players[0].name || players[0].email || 'Player', uid: players[0].uid || null, teamId: players[0].teamId };
            } else if (playerIds.length > 0) {
                // Resolve from player registry
                const pid = playerIds[0];
                const reg = gameState?.players?.[pid];
                if (reg) {
                    creator = { name: reg.name || reg.email || 'Player', uid: reg.uid || null, teamId: reg.teamId };
                }
            }

            if (creator) {
                lobbyCreators[team.id] = creator;
            }
        });
        entry.lobbyCreators = lobbyCreators;
    });
}

function getNextMatchNumber() {
    const allMatches = gameState?.gameQueue || [];
    if (allMatches.length === 0) return 1;

    const maxNumber = Math.max(...allMatches.map(m => m.matchNumber || 0));
    return maxNumber + 1;
}

// =============================================================================
// MASS IMPORT FUNCTIONALITY
// =============================================================================

let pendingImportData = null;

/**
 * Open the file picker for mass import
 */
function openMassImport() {
    if (!gameState || !gameState.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }
    document.getElementById('importFileInput').click();
}

/**
 * Handle the imported JSON file
 */
function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            validateAndPreviewImport(data);
        } catch (err) {
            showStatus('Invalid JSON file: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);

    // Reset file input so same file can be selected again
    event.target.value = '';
}

// 5v5 rotation pattern for reconstructing teams from splitTeamId
const ROTATION_5V5_PATTERN = [
    { splitTeamId: 1, sideA: [2, 3], sideB: [4, 5] },
    { splitTeamId: 3, sideA: [2, 1], sideB: [4, 5] },
    { splitTeamId: 2, sideA: [1, 3], sideB: [4, 5] },
    { splitTeamId: 5, sideA: [1, 4], sideB: [2, 3] },
    { splitTeamId: 4, sideA: [1, 2], sideB: [3, 5] },
    { splitTeamId: 1, sideA: [2, 4], sideB: [3, 5] },
    { splitTeamId: 3, sideA: [2, 4], sideB: [1, 5] },
    { splitTeamId: 2, sideA: [1, 4], sideB: [3, 5] },
    { splitTeamId: 5, sideA: [1, 2], sideB: [4, 3] },
    { splitTeamId: 4, sideA: [1, 3], sideB: [2, 5] }
];

// 3v3+2v2 rotation pattern (for 3v3 and 2v2 matches)
const ROTATION_3V3_2V2_PATTERN = [
    { splitTeamId: 5, match3v3: { sideA: [1, 2], sideB: [3, 4] }, match2v2: { sideA: [5, 1], sideB: [5, 2] } },
    { splitTeamId: 4, match3v3: { sideA: [1, 3], sideB: [2, 5] }, match2v2: { sideA: [4, 1], sideB: [4, 3] } },
    { splitTeamId: 3, match3v3: { sideA: [2, 4], sideB: [1, 5] }, match2v2: { sideA: [3, 2], sideB: [3, 4] } },
    { splitTeamId: 1, match3v3: { sideA: [3, 5], sideB: [2, 4] }, match2v2: { sideA: [1, 3], sideB: [1, 5] } },
    { splitTeamId: 2, match3v3: { sideA: [1, 4], sideB: [3, 5] }, match2v2: { sideA: [2, 1], sideB: [2, 4] } },
    { splitTeamId: 3, match3v3: { sideA: [2, 5], sideB: [1, 4] }, match2v2: { sideA: [3, 2], sideB: [3, 5] } },
    { splitTeamId: 1, match3v3: { sideA: [3, 4], sideB: [2, 5] }, match2v2: { sideA: [1, 3], sideB: [1, 4] } },
    { splitTeamId: 2, match3v3: { sideA: [1, 5], sideB: [3, 4] }, match2v2: { sideA: [2, 1], sideB: [2, 5] } },
    { splitTeamId: 1, match3v3: { sideA: [2, 3], sideB: [4, 5] }, match2v2: { sideA: [1, 2], sideB: [1, 3] } },
    { splitTeamId: 3, match3v3: { sideA: [1, 2], sideB: [4, 5] }, match2v2: { sideA: [3, 1], sideB: [3, 2] } }
];

/**
 * Normalize imported match data - handles both minimal and full formats
 */
function normalizeImportedMatch(m) {
    // Check if it's minimal format (short keys)
    if (m.n !== undefined) {
        return {
            matchNumber: m.n,
            game: m.g,
            playType: m.t,
            splitTeamId: m.s || null,
            rotationIndex: m.r || null,
            sideA: m.a || null,        // short key for sideA
            sideB: m.b || null,        // short key for sideB
            linkedMatch: m.l || null   // short key for linkedMatch
        };
    }
    // Already full format
    return m;
}

/**
 * Validate import data and show preview modal
 */
function validateAndPreviewImport(data) {
    if (!data.matches || !Array.isArray(data.matches)) {
        showStatus('Invalid format: missing matches array', 'error');
        return;
    }

    if (data.matches.length === 0) {
        showStatus('No matches in import file', 'warning');
        return;
    }

    // Normalize all matches
    const normalizedMatches = data.matches.map(normalizeImportedMatch);
    pendingImportData = { ...data, matches: normalizedMatches };

    // Build preview HTML
    const preview = document.getElementById('importPreview');
    const matchCount = normalizedMatches.length;
    const games = [...new Set(normalizedMatches.map(m => m.game))];
    const formats = [...new Set(normalizedMatches.map(m => m.playType))];

    // Count splits per team
    const splitCounts = {};
    normalizedMatches.forEach(m => {
        if (m.splitTeamId) {
            splitCounts[m.splitTeamId] = (splitCounts[m.splitTeamId] || 0) + 1;
        }
    });

    // Sample matches for preview
    const sampleMatches = normalizedMatches.slice(0, 5);

    preview.innerHTML = `
        <div class="import-summary">
            <div class="import-stat">
                <span class="import-stat-label">Total Matches:</span>
                <span class="import-stat-value">${matchCount}</span>
            </div>
            <div class="import-stat">
                <span class="import-stat-label">Games:</span>
                <span class="import-stat-value">${games.join(', ')}</span>
            </div>
            <div class="import-stat">
                <span class="import-stat-label">Formats:</span>
                <span class="import-stat-value">${formats.join(', ')}</span>
            </div>
            <div class="import-stat">
                <span class="import-stat-label">Generated:</span>
                <span class="import-stat-value">${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'Unknown'}</span>
            </div>
        </div>

        <h5>Sample Matches (first 5):</h5>
        <div class="import-samples">
            ${sampleMatches.map(m => `
                <div class="import-sample-match">
                    <span class="sample-num">#${m.matchNumber}</span>
                    <span class="sample-game">${getGameDisplayName(m.game)}</span>
                    <span class="sample-format">${m.playType}</span>
                    ${m.splitTeamId ? `<span class="sample-split">Split: T${m.splitTeamId}</span>` : ''}
                </div>
            `).join('')}
            ${matchCount > 5 ? `<div class="import-more">... and ${matchCount - 5} more matches</div>` : ''}
        </div>

        <div class="import-warning">
            <strong>Warning:</strong> This will add ${matchCount} matches to the queue.
            Existing queue items will NOT be removed.
        </div>
    `;

    // Show modal
    document.getElementById('massImportModal').classList.add('active');
}

/**
 * Get players from a tournament team
 * Supports both old format (team.players) and new format (team.playerIds)
 */
function getPlayersFromTeam(teamId) {
    // Use PlayerUtils if available (handles both formats properly)
    if (window.PlayerUtils) {
        return window.PlayerUtils.getTeamPlayerIds(gameState, teamId);
    }

    // Fallback: handle both formats manually
    const team = gameState.teams?.find(t => t.id === teamId || String(t.id) === String(teamId));
    if (!team) return [];

    // New format: playerIds array
    if (team.playerIds && Array.isArray(team.playerIds)) {
        return team.playerIds;
    }

    // Old format: players array with id/uid
    if (team.players && Array.isArray(team.players)) {
        return team.players.map(p => p.id || p.uid).filter(Boolean);
    }

    return [];
}

/**
 * Build teams for a 5v5 match from rotation pattern
 * Uses tournament's actual teams and players
 */
function buildTeamsFromRotation(rotationIndex, splitTeamId) {
    // Find the rotation pattern (1-indexed, so subtract 1)
    const patternIdx = ((rotationIndex || 1) - 1) % 10;
    const pattern = ROTATION_5V5_PATTERN[patternIdx];

    // Build Side A: full teams + first player from split team
    const sideAPlayerIds = [];
    pattern.sideA.forEach(teamId => {
        sideAPlayerIds.push(...getPlayersFromTeam(teamId));
    });
    // Add first player from split team
    const splitPlayers = getPlayersFromTeam(splitTeamId || pattern.splitTeamId);
    if (splitPlayers[0]) sideAPlayerIds.push(splitPlayers[0]);

    // Build Side B: full teams + second player from split team
    const sideBPlayerIds = [];
    pattern.sideB.forEach(teamId => {
        sideBPlayerIds.push(...getPlayersFromTeam(teamId));
    });
    // Add second player from split team
    if (splitPlayers[1]) sideBPlayerIds.push(splitPlayers[1]);

    return [
        { id: 'TEAM_A', playerIds: sideAPlayerIds },
        { id: 'TEAM_B', playerIds: sideBPlayerIds }
    ];
}

/**
 * Build teams from explicit player slot lists (v3.0 format from balance optimizer)
 * Player slots are like "1a", "2b" where number = team ID, letter = player index
 *
 * @param {Object} match - Match data with sideAPlayers/sideBPlayers or ap/bp
 * @returns {Array} Array of team objects with playerIds
 */
function buildTeamsFromPlayerLists(match) {
    // Support both full format (sideAPlayers) and minimal format (ap)
    const sideASlots = match.sideAPlayers || match.ap || [];
    const sideBSlots = match.sideBPlayers || match.bp || [];

    /**
     * Convert a player slot (e.g., "2a") to actual player ID from tournament
     * Slot format: "<teamId><playerIndex>" where playerIndex is 'a' (0) or 'b' (1)
     */
    function slotToPlayerId(slot) {
        if (!slot || typeof slot !== 'string') return null;

        // Parse slot: "2a" -> teamId=2, playerIndex=0
        const teamId = parseInt(slot.charAt(0));
        const playerIndex = slot.charCodeAt(1) - 97; // 'a'=0, 'b'=1

        if (isNaN(teamId) || playerIndex < 0) return null;

        // Get players from the team
        const teamPlayers = getPlayersFromTeam(teamId);
        if (!teamPlayers || teamPlayers.length <= playerIndex) return null;

        return teamPlayers[playerIndex];
    }

    const sideAPlayerIds = sideASlots.map(slotToPlayerId).filter(Boolean);
    const sideBPlayerIds = sideBSlots.map(slotToPlayerId).filter(Boolean);

    return [
        { id: 'TEAM_A', playerIds: sideAPlayerIds },
        { id: 'TEAM_B', playerIds: sideBPlayerIds }
    ];
}

/**
 * Build teams for a 3v3 match from sideA/sideB team IDs
 * Each side gets 1 player from each team in sideA/sideB, plus the split team contributes
 */
function buildTeamsFor3v3(match) {
    const sideA = match.sideA || [];
    const sideB = match.sideB || [];
    const splitTeamId = match.splitTeamId;

    // 3v3: Each side needs 3 players
    // sideA/sideB contain team IDs - take 1 player from each + split contribution
    const sideAPlayerIds = [];
    const sideBPlayerIds = [];

    // For each team in sideA, take first player
    sideA.forEach(teamId => {
        const players = getPlayersFromTeam(teamId);
        if (players[0]) sideAPlayerIds.push(players[0]);
    });

    // For each team in sideB, take first player
    sideB.forEach(teamId => {
        const players = getPlayersFromTeam(teamId);
        if (players[0]) sideBPlayerIds.push(players[0]);
    });

    // If we don't have 3 players per side, add from split team or remaining players
    const splitPlayers = splitTeamId ? getPlayersFromTeam(splitTeamId) : [];
    if (sideAPlayerIds.length < 3 && splitPlayers[0]) {
        sideAPlayerIds.push(splitPlayers[0]);
    }
    if (sideBPlayerIds.length < 3 && splitPlayers[1]) {
        sideBPlayerIds.push(splitPlayers[1]);
    }

    return [
        { id: 'TEAM_A', playerIds: sideAPlayerIds },
        { id: 'TEAM_B', playerIds: sideBPlayerIds }
    ];
}

/**
 * Build teams for a 2v2 match from sideA/sideB team IDs
 */
function buildTeamsFor2v2(match) {
    const sideA = match.sideA || [];
    const sideB = match.sideB || [];

    // 2v2: Each side needs 2 players
    const sideAPlayerIds = [];
    const sideBPlayerIds = [];

    // Take second player from teams in sideA (first player is in 3v3)
    sideA.forEach(teamId => {
        const players = getPlayersFromTeam(teamId);
        if (players[1]) sideAPlayerIds.push(players[1]);
        else if (players[0]) sideAPlayerIds.push(players[0]);
    });

    // Take second player from teams in sideB
    sideB.forEach(teamId => {
        const players = getPlayersFromTeam(teamId);
        if (players[1]) sideBPlayerIds.push(players[1]);
        else if (players[0]) sideBPlayerIds.push(players[0]);
    });

    return [
        { id: 'TEAM_A', playerIds: sideAPlayerIds },
        { id: 'TEAM_B', playerIds: sideBPlayerIds }
    ];
}

/**
 * Confirm and execute the mass import
 */
async function confirmMassImport(triggerBtn) {
    if (!pendingImportData || !pendingImportData.matches) {
        showStatus('No import data', 'error');
        closeMassImport();
        return;
    }

    const matches = pendingImportData.matches;
    let imported = 0;
    let startMatchNumber = getNextMatchNumber();

    // Initialize queue if needed
    gameState.gameQueue = gameState.gameQueue || [];

    for (const match of matches) {
        let teams = [];

        // If match has explicit teams with players, use them
        if (match.teams && Array.isArray(match.teams)) {
            teams = match.teams.map(team => {
                const playerIds = [];

                if (team.players && Array.isArray(team.players)) {
                    team.players.forEach(importPlayer => {
                        const playerName = importPlayer.name || importPlayer;
                        const foundPlayer = findPlayerByName(playerName);
                        if (foundPlayer) {
                            playerIds.push(foundPlayer.id);
                        }
                    });
                } else if (team.playerIds && Array.isArray(team.playerIds)) {
                    playerIds.push(...team.playerIds);
                }

                return { id: team.id, playerIds };
            });
        }
        // NEW: For matches with sideAPlayers/sideBPlayers (v3.0 format from balance optimizer)
        else if (match.sideAPlayers || match.sideBPlayers || match.ap || match.bp) {
            teams = buildTeamsFromPlayerLists(match);
        }
        // For 5v5 matches with rotation info, build teams from pattern (legacy)
        else if (match.playType === '5v5' && (match.rotationIndex || match.splitTeamId)) {
            teams = buildTeamsFromRotation(match.rotationIndex, match.splitTeamId);
        }
        // For 3v3 matches with sideA/sideB info
        else if (match.playType === '3v3' && (match.sideA || match.sideB)) {
            teams = buildTeamsFor3v3(match);
        }
        // For 2v2 matches with sideA/sideB info
        else if (match.playType === '2v2' && (match.sideA || match.sideB)) {
            teams = buildTeamsFor2v2(match);
        }
        // Default: empty teams (admin will need to assign manually)
        else {
            teams = [
                { id: 'TEAM_A', playerIds: [] },
                { id: 'TEAM_B', playerIds: [] }
            ];
        }

        const queueEntry = {
            id: Date.now() + imported,
            matchNumber: startMatchNumber + imported,
            game: match.game,
            playType: match.playType,
            teams: teams,
            status: 'pending',
            splitTeamId: match.splitTeamId || null,
            splitTeamName: match.splitTeamId ? getTeamNameById(match.splitTeamId) : null,
            rotationIndex: match.rotationIndex || null,
            linkedMatch: match.linkedMatch || null,
            isSimultaneous: match.isSimultaneous || (match.linkedMatch ? true : false),
            autoGenerated: true,
            importedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };

        assignDiscordAndLobby([queueEntry]);
        gameState.gameQueue.push(queueEntry);
        imported++;
    }

    await saveGameState(triggerBtn);
    closeMassImport();
    showStatus(`Imported ${imported} matches to queue!`, 'success');
}

/**
 * Find player by name in tournament player registry
 */
function findPlayerByName(name) {
    if (!gameState?.playerRegistry) return null;

    const normalizedName = name.toLowerCase().trim();
    for (const [id, player] of Object.entries(gameState.playerRegistry)) {
        if (player.name && player.name.toLowerCase().trim() === normalizedName) {
            return { id, ...player };
        }
    }
    return null;
}

/**
 * Get team name by ID
 */
function getTeamNameById(teamId) {
    if (!gameState?.teams) return null;
    const team = gameState.teams.find(t => String(t.id) === String(teamId));
    return team?.name || `Team ${teamId}`;
}

/**
 * Close the mass import modal
 */
function closeMassImport() {
    document.getElementById('massImportModal').classList.remove('active');
    pendingImportData = null;
}

// =============================================================================
// CLEAR QUEUE
// =============================================================================

/**
 * Open the match queue page in a new tab
 */
function openMatchQueuePage() {
    if (!currentTournamentId) {
        showStatus('No tournament selected', 'warning');
        return;
    }
    const url = `match-queue.html?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    window.open(url, '_blank');
}

/**
 * Open the Clear Queue confirmation modal
 * Shows count of matches that will be removed
 */
function openClearQueueModal() {
    if (!gameState || !gameState.gameQueue) {
        showStatus('No matches in queue to clear', 'warning');
        return;
    }

    const allGames = (gameState.gameQueue || []).filter(g => g.status !== 'completed');
    const ongoingCount = allGames.filter(g => g.status === 'ongoing').length;
    const pendingCount = allGames.filter(g => g.status !== 'ongoing').length;

    if (allGames.length === 0) {
        showStatus('No matches in queue to clear', 'warning');
        return;
    }

    const previewContainer = document.getElementById('clearQueuePreview');
    previewContainer.innerHTML = `
        <p><strong>${allGames.length}</strong> match${allGames.length !== 1 ? 'es' : ''} will be removed:</p>
        <ul style="margin: 8px 0; padding-left: 20px; color: var(--text-secondary);">
            ${ongoingCount > 0 ? `<li>${ongoingCount} ongoing match${ongoingCount !== 1 ? 'es' : ''}</li>` : ''}
            ${pendingCount > 0 ? `<li>${pendingCount} pending match${pendingCount !== 1 ? 'es' : ''}</li>` : ''}
        </ul>
    `;

    document.getElementById('clearQueueModal').classList.add('active');
}

/**
 * Close the Clear Queue confirmation modal
 */
function closeClearQueueModal() {
    document.getElementById('clearQueueModal').classList.remove('active');
}

/**
 * Confirm and clear all matches from the queue
 */
async function confirmClearQueue(triggerBtn) {
    closeClearQueueModal();

    // Spare: completed (history), ongoing (LIVE matches), and matches tagged
    // for future rounds (the mass-imported schedule). "Clear All" means
    // "clear this round's pending clutter", not "destroy the tournament".
    const currentRound = gameState.currentPhase?.roundNumber;
    const keep = g =>
        g.status === 'completed' ||
        g.status === 'ongoing' ||
        (g.roundNumber !== undefined && currentRound !== undefined && g.roundNumber > currentRound);

    const removedCount = (gameState.gameQueue || []).filter(g => !keep(g)).length;
    gameState.gameQueue = (gameState.gameQueue || []).filter(keep);

    await saveGameState(triggerBtn);

    // Log the clear event
    logEvent('queue_cleared', {
        matchesRemoved: removedCount,
        message: `Cleared ${removedCount} matches from queue (live + future rounds kept)`
    });

    showStatus(`Cleared ${removedCount} match${removedCount !== 1 ? 'es' : ''} — live matches and future rounds kept`, 'success');
}

// =============================================================================
// EDIT MATCH MODAL
// =============================================================================

// State for the match being edited
let editMatchState = {
    gameId: null,
    game: '',
    sides: [],      // Array of arrays, each containing player objects
    isChallenge: false
};

/**
 * Open the edit match modal for a queued match
 */
function openEditMatchModal(gameId) {
    const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
    if (!game) {
        showStatus('Match not found', 'warning');
        return;
    }

    // Don't allow editing ongoing matches
    if (game.status === 'ongoing') {
        showStatus('Cannot edit an ongoing match', 'warning');
        return;
    }

    // Initialize edit state from the match data
    editMatchState.gameId = gameId;
    editMatchState.game = game.game || game.gameType || '';
    editMatchState.isChallenge = game.isChallenge || false;

    // Convert teams to sides with full player info
    const teams = game.teams || game.sides || [];
    editMatchState.sides = teams.map(team => {
        return getMatchTeamPlayers(team);
    });

    // Ensure at least 2 sides
    while (editMatchState.sides.length < 2) {
        editMatchState.sides.push([]);
    }

    // Update modal title
    const matchNumber = game.matchNumber ? `#${game.matchNumber}` : '';
    document.getElementById('editMatchNumber').textContent = matchNumber;

    // Round/slot retag fields (hidden for challenges — challenge<->regular
    // conversion is not supported here)
    const tagRow = document.getElementById('editMatchTagRow');
    if (tagRow) tagRow.style.display = game.isChallenge ? 'none' : 'flex';
    const roundInput = document.getElementById('editMatchRoundInput');
    if (roundInput) roundInput.value = game.roundNumber !== undefined ? game.roundNumber : '';
    const slotSelect = document.getElementById('editMatchSlotSelect');
    if (slotSelect && (game.slot === 1 || game.slot === 2)) slotSelect.value = String(game.slot);

    // Populate game type dropdown
    populateEditGameTypeDropdown();

    // Render the sides
    renderEditMatchModal();

    // Show modal
    document.getElementById('editMatchModal').classList.add('active');
}

/**
 * Populate the game type dropdown in the edit modal
 */
function populateEditGameTypeDropdown() {
    const select = document.getElementById('editGameType');
    const selectedGames = gameState?.selectedGames || [];

    if (selectedGames.length === 0) {
        select.innerHTML = '<option value="">No games available</option>';
        return;
    }

    select.innerHTML = selectedGames.map(gameId => {
        const displayName = getGameDisplayName(gameId);
        const selected = gameId === editMatchState.game ? 'selected' : '';
        return `<option value="${gameId}" ${selected}>${displayName}</option>`;
    }).join('');
}

/**
 * Render the edit match modal content (sides and players)
 */
function renderEditMatchModal() {
    const container = document.getElementById('editSidesContainer');

    container.innerHTML = editMatchState.sides.map((side, sideIdx) => {
        const label = SIDE_LABELS[sideIdx] || (sideIdx + 1);

        // Render players in this side
        const playersHtml = side.map((player, playerIdx) => {
            const color = player.teamColor || player.originalTeamColor || '#666';
            const teamName = player.teamName || player.originalTeamName || '';

            // Build move buttons for other sides
            const moveOptions = editMatchState.sides
                .map((_, otherIdx) => {
                    if (otherIdx === sideIdx) return '';
                    const otherLabel = SIDE_LABELS[otherIdx] || (otherIdx + 1);
                    return `<button class="edit-player-move" onclick="movePlayerInEdit(${sideIdx}, ${otherIdx}, ${playerIdx})" title="Move to Side ${otherLabel}">→${otherLabel}</button>`;
                })
                .filter(Boolean)
                .join('');

            return `
                <div class="edit-player-row" style="--player-color: ${color}">
                    <span class="edit-player-name">${escapeHtml(player.name || 'Unknown')}</span>
                    <span class="edit-player-team">${teamName}</span>
                    <div class="edit-player-actions">
                        ${moveOptions}
                        <button class="edit-player-remove" onclick="removePlayerFromEdit(${sideIdx}, ${playerIdx})" title="Remove">${ICON_SVGS.x}</button>
                    </div>
                </div>
            `;
        }).join('');

        // Build player add dropdown - show all available players
        const availablePlayersHtml = buildAvailablePlayersDropdown(sideIdx);

        return `
            <div class="edit-side">
                <div class="edit-side-header">
                    <span class="edit-side-label">Side ${label}</span>
                    <span class="edit-side-count">${side.length} player${side.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="edit-side-players">
                    ${playersHtml || '<p style="color: var(--text-tertiary); font-size: 0.8rem; margin: 4px 0;">No players</p>'}
                </div>
                <div class="edit-add-player">
                    <select id="editAddPlayer_${sideIdx}">
                        <option value="">Add player...</option>
                        ${availablePlayersHtml}
                    </select>
                    <button class="btn-small primary" onclick="addPlayerToEditSide(${sideIdx})">Add</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Build dropdown options for available players (not already in any side)
 */
function buildAvailablePlayersDropdown(forSideIdx) {
    if (!gameState?.teams) return '';

    // Collect all player IDs currently in any side
    const usedPlayerIds = new Set();
    editMatchState.sides.forEach(side => {
        side.forEach(p => {
            if (p.id) usedPlayerIds.add(p.id);
        });
    });

    // Build options grouped by team
    let optionsHtml = '';
    gameState.teams.forEach(team => {
        const teamPlayers = (team.players || [])
            .filter(p => !usedPlayerIds.has(p.id))
            .map(p => `<option value="${p.id}" data-team="${team.id}">${escapeHtml(p.name)} (${escapeHtml(team.name)})</option>`)
            .join('');

        if (teamPlayers) {
            optionsHtml += `<optgroup label="${team.name}">${teamPlayers}</optgroup>`;
        }
    });

    return optionsHtml;
}

/**
 * Add a player to a side in the edit modal
 */
function addPlayerToEditSide(sideIdx) {
    const select = document.getElementById(`editAddPlayer_${sideIdx}`);
    const playerId = select.value;

    if (!playerId) {
        showStatus('Select a player to add', 'warning');
        return;
    }

    // Get full player info
    let playerInfo = null;
    if (window.PlayerUtils) {
        const info = window.PlayerUtils.getPlayerDisplayInfo(gameState, playerId);
        playerInfo = {
            id: playerId,
            name: info.name,
            teamId: info.teamId,
            originalTeamId: info.teamId,
            teamColor: info.teamColor,
            originalTeamColor: info.teamColor,
            teamName: info.teamName,
            originalTeamName: info.teamName
        };
    } else {
        // Fallback
        const player = gameState?.players?.[playerId];
        const team = player ? gameState?.teams?.find(t => t.id === player.teamId) : null;
        playerInfo = {
            id: playerId,
            name: player?.name || 'Unknown',
            teamId: player?.teamId,
            originalTeamId: player?.teamId,
            teamColor: team?.color || '#666666',
            originalTeamColor: team?.color || '#666666',
            teamName: team?.name,
            originalTeamName: team?.name
        };
    }

    editMatchState.sides[sideIdx].push(playerInfo);
    renderEditMatchModal();
}

/**
 * Remove a player from a side in the edit modal
 */
function removePlayerFromEdit(sideIdx, playerIdx) {
    editMatchState.sides[sideIdx].splice(playerIdx, 1);
    renderEditMatchModal();
}

/**
 * Move a player from one side to another
 */
function movePlayerInEdit(fromSideIdx, toSideIdx, playerIdx) {
    const player = editMatchState.sides[fromSideIdx][playerIdx];
    editMatchState.sides[fromSideIdx].splice(playerIdx, 1);
    editMatchState.sides[toSideIdx].push(player);
    renderEditMatchModal();
}

/**
 * Add a new side to the edit modal
 */
function addEditMatchSide() {
    if (editMatchState.sides.length >= SIDE_LABELS.length) {
        showStatus(`Maximum ${SIDE_LABELS.length} sides allowed`, 'warning');
        return;
    }
    editMatchState.sides.push([]);
    renderEditMatchModal();
}

/**
 * Remove the last side from the edit modal
 */
function removeEditMatchSide() {
    if (editMatchState.sides.length <= 2) {
        showStatus('Minimum 2 sides required', 'warning');
        return;
    }

    const lastSide = editMatchState.sides[editMatchState.sides.length - 1];
    if (lastSide.length > 0) {
        if (!confirm(`Side ${SIDE_LABELS[editMatchState.sides.length - 1]} has ${lastSide.length} player(s). Remove anyway?`)) {
            return;
        }
    }

    editMatchState.sides.pop();
    renderEditMatchModal();
}

/**
 * Save the edited match back to the queue
 */
async function saveMatchEdits(triggerBtn) {
    // Validate - at least 2 sides with players
    const sidesWithPlayers = editMatchState.sides.filter(s => s.length > 0);
    if (sidesWithPlayers.length < 2) {
        showStatus('At least 2 sides need players', 'warning');
        return;
    }

    // Find and update the match
    const matchIdx = (gameState?.gameQueue || []).findIndex(g => g.id === editMatchState.gameId);
    if (matchIdx === -1) {
        showStatus('Match not found in queue', 'error');
        closeEditMatchModal();
        return;
    }

    const match = gameState.gameQueue[matchIdx];

    // Update game type
    match.game = document.getElementById('editGameType').value;
    match.gameType = match.game;

    // Calculate play type from sides
    const playType = editMatchState.sides.map(s => s.length).join('v');
    match.playType = playType;

    // Update teams - store player IDs for normalized structure
    match.teams = editMatchState.sides.map((side, idx) => ({
        id: `TEAM_${SIDE_LABELS[idx]}`,
        playerIds: side.map(p => p.id).filter(Boolean)
    }));

    // Remove old format fields if present
    delete match.sides;
    delete match.teamA;
    delete match.teamB;

    // Round/slot retag — only ever SETS values; Firestore merge:true cannot
    // persist a deletion, so there is deliberately no "untag" option.
    if (match.isChallenge !== true) {
        const roundInput = document.getElementById('editMatchRoundInput');
        const slotSelect = document.getElementById('editMatchSlotSelect');
        if (roundInput && roundInput.value.trim() !== '') {
            match.roundNumber = parseInt(roundInput.value, 10);
        }
        if (slotSelect && (slotSelect.value === '1' || slotSelect.value === '2')) {
            match.slot = parseInt(slotSelect.value, 10);
        }
    }

    await saveGameState(triggerBtn);
    closeEditMatchModal();
    showStatus('Match updated successfully', 'success');
}

/**
 * Close the edit match modal
 */
function closeEditMatchModal() {
    document.getElementById('editMatchModal').classList.remove('active');
    editMatchState = {
        gameId: null,
        game: '',
        sides: [],
        isChallenge: false
    };
}

/**
 * Generate suggested matches using SmartMatchGenerator
 * Uses BalanceOptimizer with greedy variance minimization for perfect balance
 *
 * Features:
 * - Minimizes pairing variance (all pairs play with/against equally)
 * - No team split twice in a row (heavy penalty)
 * - Game rotation with smart repeat counts (1-3 per game)
 * - Supports both 5v5 and 3v3+2v2 formats
 */
async function generateSuggestedMatches() {
    if (!gameState || !gameState.teams) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    // Check if SmartMatchGenerator is available
    if (typeof SmartMatchGenerator === 'undefined') {
        showStatus('SmartMatchGenerator not loaded', 'error');
        return;
    }

    try {
        // Initialize or update the smart generator
        if (!smartMatchGenerator) {
            smartMatchGenerator = new SmartMatchGenerator(gameState);
        } else {
            // Update with latest gameState (teams may have changed)
            smartMatchGenerator.gameState = gameState;
            smartMatchGenerator.teams = gameState.teams || [];
        }

        // Generate the next optimized match(es)
        const result = smartMatchGenerator.generateNext();

        // Check for errors (e.g., not enough teams/players)
        if (result.error) {
            showStatus(result.message, 'error');
            return;
        }

        const gameName = getGameDisplayName(result.gameId);

        // Store pending match for confirmation
        pendingAutoMatch = {
            result,
            gameName
        };

        // Build modal content based on format
        let modalContent;

        if (result.format === '3v3+2v2') {
            modalContent = buildSplitFormatModal(result, gameName);
        } else {
            modalContent = build5v5Modal(result, gameName);
        }

        document.getElementById('autoMatchContent').innerHTML = modalContent;
        document.getElementById('autoMatchModal').classList.add('active');

    } catch (error) {
        console.error('Error generating matches:', error);
        showStatus('Error generating matches: ' + error.message, 'error');
    }
}

/**
 * Build modal content for 5v5 match
 */
function build5v5Modal(result, gameName) {
    const match = result.matches[0];

    const sideAHtml = match.teams[0].players.map(p => {
        const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
        const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
        return `<div class="auto-match-player" style="--player-color: ${color}">
            <span class="player-name">${escapeHtml(p.name)}</span>
            <span class="player-team">${escapeHtml(p.originalTeamName)}</span>
            ${splitBadge}
        </div>`;
    }).join('');

    const sideBHtml = match.teams[1].players.map(p => {
        const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
        const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
        return `<div class="auto-match-player" style="--player-color: ${color}">
            <span class="player-name">${escapeHtml(p.name)}</span>
            <span class="player-team">${escapeHtml(p.originalTeamName)}</span>
            ${splitBadge}
        </div>`;
    }).join('');

    // Build balance stats display
    const balanceInfo = result.balanceStats ? buildBalanceInfo(result.balanceStats) : '';
    const splitInfo = result.splitStats ? buildSplitInfo(result.splitStats) : '';

    return `
        <h4>Auto-Generated Match</h4>
        <div class="auto-match-header">
            <span class="rotation-badge">Match #${result.rotationInfo?.totalGenerated || '?'}</span>
            <span class="format-badge">${result.format}</span>
        </div>
        <div class="auto-match-game">
            <span class="game-name">${gameName}</span>
            <span class="play-type">${result.format}</span>
        </div>

        <div class="auto-match-sides">
            <div class="auto-match-side">
                <div class="side-label">Side A</div>
                <div class="side-desc">${result.sideADescription}</div>
                <div class="side-players">${sideAHtml}</div>
            </div>
            <div class="auto-match-vs">VS</div>
            <div class="auto-match-side">
                <div class="side-label">Side B</div>
                <div class="side-desc">${result.sideBDescription}</div>
                <div class="side-players">${sideBHtml}</div>
            </div>
        </div>

        <div class="auto-match-info">
            <div class="split-info">${result.splitDescription}</div>
            ${balanceInfo}
            ${splitInfo}
        </div>

        <div class="auto-match-actions">
            <button class="btn primary" onclick="confirmAutoMatch()">Add to Queue</button>
            <button class="btn secondary" onclick="closeAutoMatchModal()">Cancel</button>
        </div>
    `;
}

/**
 * Build modal content for 3v3+2v2 split format match
 */
function buildSplitFormatModal(result, gameName) {
    const match3v3 = result.matches[0];
    const match2v2 = result.matches[1];

    // Build 3v3 players
    const match3v3SideA = match3v3.teams[0].players.map(p => {
        const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
        const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
        return `<div class="auto-match-player small" style="--player-color: ${color}">
            <span class="player-name">${escapeHtml(p.name)}</span>
            ${splitBadge}
        </div>`;
    }).join('');

    const match3v3SideB = match3v3.teams[1].players.map(p => {
        const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
        const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
        return `<div class="auto-match-player small" style="--player-color: ${color}">
            <span class="player-name">${escapeHtml(p.name)}</span>
            ${splitBadge}
        </div>`;
    }).join('');

    // Build 2v2 players
    const match2v2SideA = match2v2.teams[0].players.map(p => {
        const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
        return `<div class="auto-match-player small" style="--player-color: ${color}">
            <span class="player-name">${escapeHtml(p.name)}</span>
        </div>`;
    }).join('');

    const match2v2SideB = match2v2.teams[1].players.map(p => {
        const color = p.originalTeamColor || getTeamColor(p.originalTeamId) || '#666';
        return `<div class="auto-match-player small" style="--player-color: ${color}">
            <span class="player-name">${escapeHtml(p.name)}</span>
        </div>`;
    }).join('');

    // Build balance stats display
    const balanceInfo = result.balanceStats ? buildBalanceInfo(result.balanceStats) : '';
    const splitInfo = result.splitStats ? buildSplitInfo(result.splitStats) : '';

    return `
        <h4>Auto-Generated Matches (Simultaneous)</h4>
        <div class="auto-match-header">
            <span class="rotation-badge">Match #${result.rotationInfo?.totalGenerated || '?'}</span>
            <span class="format-badge">${result.format}</span>
            <span class="simultaneous-badge">2 MATCHES</span>
        </div>
        <div class="auto-match-game">
            <span class="game-name">${gameName}</span>
            <span class="play-type">${result.format}</span>
        </div>

        <div class="split-format-matches">
            <div class="split-match-block">
                <div class="match-label">3v3 Match</div>
                <div class="auto-match-sides compact">
                    <div class="auto-match-side">
                        <div class="side-label">A</div>
                        <div class="side-players">${match3v3SideA}</div>
                    </div>
                    <div class="auto-match-vs">VS</div>
                    <div class="auto-match-side">
                        <div class="side-label">B</div>
                        <div class="side-players">${match3v3SideB}</div>
                    </div>
                </div>
            </div>
            <div class="split-match-block">
                <div class="match-label">2v2 Match</div>
                <div class="auto-match-sides compact">
                    <div class="auto-match-side">
                        <div class="side-label">A</div>
                        <div class="side-players">${match2v2SideA}</div>
                    </div>
                    <div class="auto-match-vs">VS</div>
                    <div class="auto-match-side">
                        <div class="side-label">B</div>
                        <div class="side-players">${match2v2SideB}</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="auto-match-info">
            <div class="split-info">${result.splitDescription}</div>
            ${balanceInfo}
            ${splitInfo}
        </div>

        <div class="auto-match-actions">
            <button class="btn primary" onclick="confirmAutoMatch()">Add Both to Queue</button>
            <button class="btn secondary" onclick="closeAutoMatchModal()">Cancel</button>
        </div>
    `;
}

/**
 * Build balance statistics info display
 */
function buildBalanceInfo(stats) {
    if (!stats) return '';

    const withRange = stats.with?.range ?? 0;
    const againstRange = stats.against?.range ?? 0;
    const isBalanced = withRange <= 2 && againstRange <= 2;

    const statusClass = isBalanced ? 'good' : 'warn';
    const statusIcon = isBalanced ? ICON_SVGS.check : ICON_SVGS.triangleAlert;

    return `
        <div class="balance-info ${statusClass}">
            ${statusIcon} Balance: W±${withRange} A±${againstRange}
        </div>
    `;
}

/**
 * Build split distribution info display
 */
function buildSplitInfo(stats) {
    if (!stats || !stats.splitCounts) return '';

    const counts = Object.entries(stats.splitCounts)
        .map(([teamId, count]) => `T${teamId}:${count}`)
        .join(' ');

    return `
        <div class="fairness-note">
            Splits: ${counts} (range: ${stats.range})
        </div>
    `;
}

/**
 * Confirm and add the auto-generated match(es) to queue
 * Handles both single 5v5 matches and 3v3+2v2 simultaneous match pairs
 */
async function confirmAutoMatch() {
    if (_asyncBusy) return;
    _asyncBusy = true;
    try {
    if (!pendingAutoMatch) {
        showStatus('No pending match', 'error');
        closeAutoMatchModal();
        return;
    }

    const { result, gameName } = pendingAutoMatch;

    gameState.gameQueue = gameState.gameQueue || [];

    const addedMatches = [];

    // Add each match from the result (1 for 5v5, 2 for 3v3+2v2)
    // Compute the base number once — getNextMatchNumber() reads from
    // gameState.gameQueue, which isn't updated until after this loop, so
    // calling it per-iteration would stamp every entry in a multi-match
    // batch (e.g. a 3v3+2v2 split) with the same duplicate number (bug #2).
    const baseMatchNumber = getNextMatchNumber();
    for (let i = 0; i < result.matches.length; i++) {
        const match = result.matches[i];
        const matchNumber = baseMatchNumber + i;

        // Create the queue entry
        const queueEntry = {
            id: Date.now() + i, // Ensure unique IDs for simultaneous matches
            matchNumber: matchNumber,
            game: result.gameId,
            playType: match.format,
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
            splitTeamId: match.splitTeamId || null,
            splitTeamName: match.splitTeamName || null,
            isSimultaneous: match.isSimultaneous || false,
            status: 'pending',
            createdAt: new Date().toISOString(),
            autoGenerated: true
        };

        addedMatches.push({ entry: queueEntry, number: matchNumber, format: match.format });
    }

    // Assign Discord channels + lobby creators to the batch, then push
    assignDiscordAndLobby(addedMatches.map(m => m.entry));
    addedMatches.forEach(m => gameState.gameQueue.push(m.entry));

    // Save smart match generator state for session continuity
    if (smartMatchGenerator) {
        gameState.smartMatchState = smartMatchGenerator.getState();
    }

    await saveGameState();

    // Build success message
    let statusMessage;
    if (addedMatches.length === 1) {
        statusMessage = `Match #${addedMatches[0].number} (${addedMatches[0].format}) added! ${result.splitDescription}`;
    } else {
        const matchNums = addedMatches.map(m => `#${m.number}`).join(' & ');
        statusMessage = `Matches ${matchNums} added! (${result.format}) ${result.splitDescription}`;
    }

    showStatus(statusMessage, 'success');
    closeAutoMatchModal();
    } finally { _asyncBusy = false; }
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

    const curRound = gameState?.currentPhase?.roundNumber;
    const isFutureRound = g => !g.isBreak && curRound !== undefined &&
        g.roundNumber !== undefined && g.roundNumber > curRound;

    if (curRound !== undefined) {
        const thisRound = allGames.filter(g => !isFutureRound(g)).length;
        countEl.textContent = `${thisRound} now · ${allGames.length} total`;
    } else {
        countEl.textContent = allGames.length;
    }

    // Render ongoing matches first, then queued
    const allToRender = [...ongoingGames, ...queuedGames];

    if (allToRender.length === 0) {
        container.innerHTML = '<p class="queue-empty">No matches in queue</p>';
        return;
    }

    container.innerHTML = allToRender.map((game) => {
        const isOngoing = game.status === 'ongoing';
        const isBreak = game.isBreak === true;

        // Break entries get simplified rendering
        if (isBreak) {
            const breakDef = BREAK_TYPES[game.breakType] || { label: game.breakLabel || 'Break', emoji: ICON_SVGS.pause };
            return `
                <div class="queue-item ${isOngoing ? 'ongoing' : ''} break"
                     draggable="${!isOngoing}"
                     data-queue-id="${game.id}"
                     onclick="openQuickConfirm(${game.id})"
                     ondragstart="dragQueueItem(event, ${game.id})"
                     ondragover="allowQueueDrop(event)"
                     ondragleave="leaveQueueDrop(event)"
                     ondrop="dropQueueItem(event, ${game.id})"
                     ondragend="endQueueDrag(event)">
                    <span class="drag-handle">${isOngoing ? ICON_SVGS.play : ICON_SVGS.menu}</span>
                    <div class="game-info">
                        <div class="game-type-row">
                            <div class="game-type"><span class="break-badge">BREAK</span>${breakDef.emoji} ${breakDef.label}</div>
                            <div class="match-actions">
                                ${!isOngoing ? `<button class="start-btn" onclick="event.stopPropagation(); startMatch(${game.id})" title="Start break">${ICON_SVGS.play}</button>` : ''}
                                ${!isOngoing ? `<button class="move-top-btn" onclick="event.stopPropagation(); moveMatchToTop(${game.id})" title="Play next">${ICON_SVGS.arrowUpToLine}</button>` : ''}
                                <button class="delete-btn" onclick="event.stopPropagation(); removeFromQueue(${game.id})" title="Remove">${ICON_SVGS.x}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Extract teams - handle various data formats
        const teams = game.teams || game.sides || [];

        // Build player display with colors (similar to view.html)
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
        const isChallenge = game.isChallenge === true;
        // Use persistent match number instead of queue position
        const matchNumber = game.matchNumber ? `#${game.matchNumber} ` : '';
        // Challenge badge HTML
        const challengeBadge = isChallenge ? '<span class="challenge-badge">CHALLENGE</span>' : '';

        // Round/slot tag badge — makes the phase system's invisible tagging
        // visible (this is what every slot gate actually keys off of).
        let tagBadge = '';
        if (game.slot === 'challenge' || game.isChallenge === true) {
            tagBadge = ''; // CHALLENGE badge already communicates it
        } else if (game.roundNumber === undefined && game.slot === undefined) {
            tagBadge = '<span class="tag-badge tag-untagged" title="No round/slot tag — counts for either slot this round">R?</span>';
        } else {
            tagBadge = `<span class="tag-badge" title="Round / match slot tag">R${game.roundNumber !== undefined ? game.roundNumber : '?'}${game.slot !== undefined ? '·M' + game.slot : ''}</span>`;
        }

        return `
            <div class="queue-item ${isOngoing ? 'ongoing' : ''} ${isChallenge ? 'challenge' : ''}${isFutureRound(game) ? ' future-round' : ''}"
                 draggable="${!isOngoing}"
                 data-queue-id="${game.id}"
                 onclick="openQuickConfirm(${game.id})"
                 ondragstart="dragQueueItem(event, ${game.id})"
                 ondragover="allowQueueDrop(event)"
                 ondragleave="leaveQueueDrop(event)"
                 ondrop="dropQueueItem(event, ${game.id})"
                 ondragend="endQueueDrag(event)">
                <span class="drag-handle">${isOngoing ? ICON_SVGS.play : ICON_SVGS.menu}</span>
                <div class="game-info">
                    <div class="game-type-row">
                        <div class="game-type">${tagBadge}${challengeBadge}${matchNumber}${gameName}${playType ? ' (' + playType + ')' : ''}</div>
                        <div class="match-actions">
                            ${!isOngoing ? `<button class="start-btn" onclick="event.stopPropagation(); startMatch(${game.id})" title="Start match">${ICON_SVGS.play}</button>` : ''}
                            ${!isOngoing ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditMatchModal(${game.id})" title="Edit match">${ICON_SVGS.settings}</button>` : ''}
                            ${!isOngoing ? `<button class="move-top-btn" onclick="event.stopPropagation(); moveMatchToTop(${game.id})" title="Play next">${ICON_SVGS.arrowUpToLine}</button>` : ''}
                            <button class="delete-btn" onclick="event.stopPropagation(); removeFromQueue(${game.id})" title="Remove">${ICON_SVGS.x}</button>
                        </div>
                    </div>
                    <div class="matchup-players">${matchupHtml || fallbackMatchup || 'TBD'}</div>
                </div>
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

async function moveMatchToTop(gameId) {
    if (_asyncBusy) return;
    _asyncBusy = true;
    try {
        const queue = gameState.gameQueue || [];
        const ongoingGames = queue.filter(g => g.status === 'ongoing');
        const pendingGames = queue.filter(g => g.status === 'pending' || g.status === undefined || g.status === 'queued');
        const completedGames = queue.filter(g => g.status === 'completed');

        const idx = pendingGames.findIndex(g => g.id === gameId);
        if (idx <= 0) return; // Already first or not found

        const [match] = pendingGames.splice(idx, 1);
        pendingGames.unshift(match);

        gameState.gameQueue = [...ongoingGames, ...pendingGames, ...completedGames];
        await saveGameState();
        showStatus('Match moved to play next', 'success');
    } finally { _asyncBusy = false; }
}

async function removeFromQueue(gameId) {
    if (!confirm('Remove this match from the queue?')) return;

    gameState.gameQueue = (gameState.gameQueue || []).filter(g => g.id !== gameId);
    await saveGameState();
    showStatus('Match removed from queue', 'success');
}

/**
 * Deliberately dismiss a pending hex placement (team absent / declined).
 * The alternative — force-advancing past the gate — leaves the win queued
 * forever, where it re-gates a future round's placement phase.
 * pendingHexWins is the accessor over gameState.pendingHexWins, so
 * mutations here persist via saveGameState().
 */
async function waivePendingHexWin(matchNumber, teamId) {
    const win = (pendingHexWins || []).find(w => w.matchNumber === matchNumber);
    if (!win) return;
    const idx = (win.teamIds || []).findIndex(id => String(id) === String(teamId));
    if (idx === -1) return;
    const teamName = (win.teamNames && win.teamNames[idx]) || `Team ${teamId}`;
    win.teamIds.splice(idx, 1);
    if (win.teamNames) win.teamNames.splice(idx, 1);
    pendingHexWins = pendingHexWins.filter(w => w.teamIds.length > 0);
    await saveGameState();
    logEvent('hex_win_waived', {
        matchNumber, teamId, teamName,
        message: `Hex placement waived for ${teamName} (match #${matchNumber})`
    });
    showStatus(`Hex placement waived for ${teamName}.`, 'info');
    if (typeof updatePendingHexNotification === 'function') updatePendingHexNotification();
    if (typeof updateDisplay === 'function') updateDisplay();
}
window.waivePendingHexWin = waivePendingHexWin;

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
        const isBreak = game.isBreak === true;

        // Break entries get simplified rendering with a Done button
        if (isBreak) {
            const breakDef = BREAK_TYPES[game.breakType] || { label: game.breakLabel || 'Break', emoji: ICON_SVGS.pause };
            return `
                <div class="ongoing-match break" onclick="openQuickConfirm(${game.id})">
                    <div class="ongoing-game-name"><span class="break-badge">BREAK</span> ${breakDef.emoji} ${breakDef.label}</div>
                    <div class="ongoing-actions">
                        <button class="btn team-win-btn" onclick="event.stopPropagation(); completeBreak(${game.id})">Done</button>
                    </div>
                </div>
            `;
        }

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
    if (_asyncBusy) return;
    _asyncBusy = true;
    try {
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
    } finally { _asyncBusy = false; }
}

/**
 * Open quick confirm popup for a match
 * Supports any number of teams (2v2, 2v2v2, etc.)
 */
function openQuickConfirm(gameId) {
    const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
    if (!game) return;

    selectedQueuedGame = game;

    // Break entries get a simplified confirm modal
    if (game.isBreak === true) {
        const breakDef = BREAK_TYPES[game.breakType] || { label: game.breakLabel || 'Break', emoji: ICON_SVGS.pause };
        const isOngoing = game.status === 'ongoing';
        const modal = document.getElementById('resultConfirmModal');
        const content = document.getElementById('resultConfirmContent');

        content.innerHTML = `
            <h4>${isOngoing ? 'Complete Break' : 'Start Break'}</h4>
            <div class="confirm-game-name"><span class="break-badge" style="margin-right: 8px;">BREAK</span>${breakDef.emoji} ${breakDef.label}</div>

            <div class="confirm-actions">
                ${isOngoing
                    ? `<button class="btn primary" onclick="completeBreak(${gameId})">Break Over</button>`
                    : `<button class="btn primary" onclick="startMatch(${gameId}); closeResultConfirm();">Start Break</button>`
                }
                <button class="btn secondary" onclick="closeResultConfirm()">Cancel</button>
            </div>
        `;

        modal.classList.add('active');
        return;
    }

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
        let primaryColor = defaultColors[idx] || 'var(--text-secondary)';
        let borderStyle = '';
        let buttonStyle = '';

        if (players.length > 0) {
            teamNames = players.map(p => p.name || 'Unknown').join(', ');

            // Count players per original team for proportional coloring
            const teamColorCounts = {};
            players.forEach(p => {
                const teamId = p.teamId || p.originalTeamId;
                const color = p.teamColor || p.originalTeamColor || defaultColors[idx];
                if (teamId) {
                    if (!teamColorCounts[teamId]) {
                        teamColorCounts[teamId] = { color: color, count: 0 };
                    }
                    teamColorCounts[teamId].count++;
                }
            });

            const colorEntries = Object.values(teamColorCounts);

            if (colorEntries.length === 1) {
                // Single team - solid color
                primaryColor = colorEntries[0].color;
                borderStyle = `border-color: ${primaryColor}`;
                buttonStyle = `background: ${primaryColor}`;
            } else if (colorEntries.length > 1) {
                // Multiple teams - create gradient
                const totalPlayers = players.length;
                let gradientStops = [];
                let currentPercent = 0;

                colorEntries.forEach((entry, i) => {
                    const percent = (entry.count / totalPlayers) * 100;
                    gradientStops.push(`${entry.color} ${currentPercent}%`);
                    gradientStops.push(`${entry.color} ${currentPercent + percent}%`);
                    currentPercent += percent;
                });

                const gradient = `linear-gradient(135deg, ${gradientStops.join(', ')})`;
                borderStyle = `border-image: ${gradient} 1`;
                buttonStyle = `background: ${gradient}`;
                primaryColor = colorEntries[0].color; // Fallback for border-left
            }
        } else if (team.name) {
            teamNames = team.name;
            borderStyle = `border-color: ${primaryColor}`;
            buttonStyle = `background: ${primaryColor}`;
        } else {
            borderStyle = `border-color: ${primaryColor}`;
            buttonStyle = `background: ${primaryColor}`;
        }

        return `
            <div class="confirm-team" style="${borderStyle}">
                <div class="confirm-team-label">Team ${label}</div>
                <div class="confirm-team-players">${teamNames}</div>
                <button class="btn confirm-win-btn" style="${buttonStyle}"
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
    if (_asyncBusy) return;
    _asyncBusy = true;
    try {
        const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
        if (!game) {
            showStatus('Match not found', 'error');
            return;
        }

        // Use existing confirmResult logic but with specific game
        selectedQueuedGame = game;
        await confirmResult(winnerIndex);
        closeResultConfirm();
    } finally { _asyncBusy = false; }
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

    // Count players per team on the losing side
    const losingTeamPlayerCounts = {};
    losingPlayers.forEach(player => {
        const teamId = player.teamId || player.originalTeamId;
        if (teamId) {
            losingTeamPlayerCounts[teamId] = (losingTeamPlayerCounts[teamId] || 0) + 1;
        }
    });

    // Only credit losses to teams with 2+ players on losing side (full team representation)
    // This mirrors the win logic - split teams (with players on both sides) get neither win nor loss
    const teamsWithFullLoss = Object.entries(losingTeamPlayerCounts)
        .filter(([_, count]) => count >= 2)
        .map(([teamId]) => parseInt(teamId) || teamId);

    // Update team win/loss counts - only for non-challenge matches with full representation
    // Challenge matches don't affect team win/loss records
    const isChallenge = selectedQueuedGame.isChallenge === true;
    if (!isChallenge) {
        teamsWithFullCredit.forEach(teamId => {
            const team = gameState.teams.find(t => String(t.id) === String(teamId));
            if (team) {
                team.gamesWon = (team.gamesWon || 0) + 1;
                team.gamesPlayed = (team.gamesPlayed || 0) + 1;
            }
        });

        teamsWithFullLoss.forEach(teamId => {
            const team = gameState.teams.find(t => String(t.id) === String(teamId));
            if (team) {
                team.gamesLost = (team.gamesLost || 0) + 1;
                team.gamesPlayed = (team.gamesPlayed || 0) + 1;
            }
        });
    }

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
        // Challenge flag and disputing teams - carried over from queue entry
        isChallenge: selectedQueuedGame.isChallenge || false,
        disputingTeamIds: selectedQueuedGame.disputingTeamIds || null,
        disputingSideA: selectedQueuedGame.disputingSideA || null,
        disputingSideB: selectedQueuedGame.disputingSideB || null,
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

    // Mark queue entry as completed. adminConfirmed is stamped here too —
    // any player votes attached to this match are now settled and should
    // not surface as "pending" again.
    const queueEntry = gameState.gameQueue.find(g => g.id === selectedQueuedGame.id);
    if (queueEntry) {
        queueEntry.status = 'completed';
        queueEntry.completedAt = new Date().toISOString();
        queueEntry.winningSide = winningSideLabel;
        queueEntry.winnerIndex = winnerIndex;
        queueEntry.adminConfirmed = true;
        queueEntry.adminConfirmedAt = new Date().toISOString();
    }

    // Update games played
    gameState.gamesPlayed = (gameState.gamesPlayed || 0) + 1;

    // Increment split count for the team that was split in this match
    // (only for non-challenge matches, as challenges don't follow rotation)
    if (selectedQueuedGame.splitTeamId && !selectedQueuedGame.isChallenge) {
        const splitTeam = gameState.teams.find(t => String(t.id) === String(selectedQueuedGame.splitTeamId));
        if (splitTeam) {
            splitTeam.splitCount = (splitTeam.splitCount || 0) + 1;
        }
    }

    // For challenge matches, detect and increment challengeSplitCount for teams with players on both sides
    if (selectedQueuedGame.isChallenge) {
        // Find teams that have players on both winning and losing sides (split teams)
        const challengeSplitTeamIds = winningTeamIds.filter(teamId =>
            losingTeamIds.some(losingId => String(losingId) === String(teamId))
        );

        challengeSplitTeamIds.forEach(teamId => {
            const splitTeam = gameState.teams.find(t => String(t.id) === String(teamId));
            if (splitTeam) {
                splitTeam.challengeSplitCount = (splitTeam.challengeSplitCount || 0) + 1;
            }
        });
    }

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

    // Build winningPlayers array for event log display
    const winningPlayersForLog = winningPlayers.map(p => ({
        id: p.id,
        name: p.name,
        originalTeamId: p.teamId || p.originalTeamId,
        originalTeamName: p.teamName || p.originalTeamName,
        originalTeamColor: p.teamColor || p.originalTeamColor
    }));

    // Build losingPlayers array for event log display (for view results)
    const losingPlayersForLog = losingPlayers.map(p => ({
        id: p.id,
        name: p.name,
        originalTeamId: p.teamId || p.originalTeamId,
        originalTeamName: p.teamName || p.originalTeamName,
        originalTeamColor: p.teamColor || p.originalTeamColor
    }));

    // Identify split team (team with only 1 player on winning side)
    const splitTeamIds = Object.entries(winningTeamPlayerCounts)
        .filter(([_, count]) => count === 1)
        .map(([teamId]) => parseInt(teamId) || teamId);

    const splitTeamNames = splitTeamIds.map(teamId => {
        const team = gameState.teams.find(t => String(t.id) === String(teamId));
        return team?.name || `Team ${teamId}`;
    });

    // Build all teams' player data for 3-team matches (stored as separate fields to avoid nested arrays)
    const matchTeams = queueEntry?.teams || [];
    const sideAPlayers = matchTeams[0] ? getMatchTeamPlayers(matchTeams[0]).map(p => ({
        id: p.id,
        name: p.name,
        originalTeamId: p.teamId || p.originalTeamId,
        originalTeamName: p.teamName || p.originalTeamName,
        originalTeamColor: p.teamColor || p.originalTeamColor
    })) : [];
    const sideBPlayers = matchTeams[1] ? getMatchTeamPlayers(matchTeams[1]).map(p => ({
        id: p.id,
        name: p.name,
        originalTeamId: p.teamId || p.originalTeamId,
        originalTeamName: p.teamName || p.originalTeamName,
        originalTeamColor: p.teamColor || p.originalTeamColor
    })) : [];
    const sideCPlayers = matchTeams[2] ? getMatchTeamPlayers(matchTeams[2]).map(p => ({
        id: p.id,
        name: p.name,
        originalTeamId: p.teamId || p.originalTeamId,
        originalTeamName: p.teamName || p.originalTeamName,
        originalTeamColor: p.teamColor || p.originalTeamColor
    })) : [];

    logEvent('game_win', {
        teamName: displayTeamName,
        teamId: teamsWithFullCredit[0] || winningTeamIds[0],
        teamColor: teamColor,
        gameName: logGameName,
        matchNumber: logMatchNumber,
        isChallenge: logIsChallenge,
        winningSide: SIDE_LABELS[winnerIndex],
        playType: queueEntry?.playType || '',
        // Include full player arrays for view results display
        winningPlayers: winningPlayersForLog,
        losingPlayers: losingPlayersForLog,
        winningPlayerIds: winningPlayerIds,
        losingPlayerIds: losingPlayerIds,
        teamsWithFullCredit: teamsWithFullCredit,
        // Split team info for "with the help of" message
        splitTeamIds: splitTeamIds,
        splitTeamNames: splitTeamNames,
        // All teams data for 3-team matches (separate fields to avoid nested arrays)
        teamsCount: matchTeams.length || 2,
        sideAPlayers: sideAPlayers,
        sideBPlayers: sideBPlayers,
        sideCPlayers: sideCPlayers.length > 0 ? sideCPlayers : undefined
    });

    const matchNumMsg = confirmedMatchNumber ? ` (Match #${confirmedMatchNumber})` : '';
    showStatus(`Result confirmed! Team ${SIDE_LABELS[winnerIndex] || winnerIndex} wins${matchNumMsg}!`, 'success');

    // Track pending hex win - remind admin to place hex
    // Challenge matches don't grant hex placement
    if (!logIsChallenge) {
        const pendingHexTeamIds = teamsWithFullCredit.length > 0 ? teamsWithFullCredit : winningTeamIds;
        const pendingHexTeamNames = pendingHexTeamIds.map(teamId => {
            const team = gameState.teams.find(t => String(t.id) === String(teamId));
            return team?.name || `Team ${teamId}`;
        });

        pendingHexWins.push({
            matchNumber: confirmedMatchNumber,
            teamNames: pendingHexTeamNames.length > 0 ? pendingHexTeamNames : [`Team ${SIDE_LABELS[winnerIndex]}`],
            teamIds: pendingHexTeamIds.length > 0 ? pendingHexTeamIds : winningTeamIds,
            isChallenge: false,
            timestamp: new Date().toISOString()
        });

        // Show persistent reminder
        updatePendingHexNotification();

        // Persist immediately — pendingHexWins is the sole gate for advancing
        // past hex_placement_1/2 (phase-manager.js's _getPendingHexCount), so
        // it must survive a refresh rather than only live in memory until
        // some unrelated future save happens to catch it. The earlier
        // `await saveGameState()` above runs BEFORE this push, so this is a
        // deliberate second write, not a duplicate.
        await saveGameState();
    }
}

// =============================================================================
// STATS RECALCULATION
// =============================================================================

/**
 * Recalculate team win/loss stats from match history
 * Use this to fix stats after the split team bug fix
 * Call from console: recalculateTeamStats()
 */
async function recalculateTeamStats() {
    if (!gameState?.teams || !gameState?.gameHistory) {
        console.error('No game state loaded');
        return;
    }

    console.log('Recalculating team stats from match history...');
    console.log(`Processing ${gameState.gameHistory.length} matches for ${gameState.teams.length} teams`);

    // Reset all team stats
    gameState.teams.forEach(team => {
        team.gamesWon = 0;
        team.gamesLost = 0;
        team.gamesPlayed = 0;
    });

    let processedMatches = 0;
    let skippedSplitWins = 0;
    let skippedSplitLosses = 0;

    // Process each match in history (skip challenge matches — they don't affect team records)
    gameState.gameHistory.forEach(match => {
        if (match.isChallenge) return;

        // Get player IDs from the match
        const winningPlayerIds = match.winningPlayerIds || [];
        const losingPlayerIds = match.losingPlayerIds || [];

        // If no player IDs, try legacy format
        if (winningPlayerIds.length === 0 && match.winningPlayers) {
            match.winningPlayers.forEach(p => {
                if (p.id) winningPlayerIds.push(p.id);
            });
        }
        if (losingPlayerIds.length === 0 && match.losingPlayers) {
            match.losingPlayers.forEach(p => {
                if (p.id) losingPlayerIds.push(p.id);
            });
        }

        // Count players per team on each side
        const winningTeamCounts = {};
        const losingTeamCounts = {};

        winningPlayerIds.forEach(playerId => {
            const player = gameState.players?.[playerId];
            const teamId = player?.teamId;
            if (teamId) {
                winningTeamCounts[teamId] = (winningTeamCounts[teamId] || 0) + 1;
            }
        });

        losingPlayerIds.forEach(playerId => {
            const player = gameState.players?.[playerId];
            const teamId = player?.teamId;
            if (teamId) {
                losingTeamCounts[teamId] = (losingTeamCounts[teamId] || 0) + 1;
            }
        });

        // Award wins to teams with 2+ players on winning side
        Object.entries(winningTeamCounts).forEach(([teamId, count]) => {
            const team = gameState.teams.find(t => String(t.id) === String(teamId));
            if (team) {
                if (count >= 2) {
                    team.gamesWon++;
                    team.gamesPlayed++;
                } else {
                    skippedSplitWins++;
                }
            }
        });

        // Award losses to teams with 2+ players on losing side
        Object.entries(losingTeamCounts).forEach(([teamId, count]) => {
            const team = gameState.teams.find(t => String(t.id) === String(teamId));
            if (team) {
                if (count >= 2) {
                    team.gamesLost++;
                    team.gamesPlayed++;
                } else {
                    skippedSplitLosses++;
                }
            }
        });

        processedMatches++;
    });

    // Calculate totals for verification
    const totalWins = gameState.teams.reduce((sum, t) => sum + (t.gamesWon || 0), 0);
    const totalLosses = gameState.teams.reduce((sum, t) => sum + (t.gamesLost || 0), 0);

    console.log('=== Recalculation Complete ===');
    console.log(`Processed: ${processedMatches} matches`);
    console.log(`Split wins skipped: ${skippedSplitWins}`);
    console.log(`Split losses skipped: ${skippedSplitLosses}`);
    console.log(`Total wins: ${totalWins}, Total losses: ${totalLosses}`);
    console.log(`Balance check: ${totalWins === totalLosses ? '✓ BALANCED' : '✗ IMBALANCED by ' + Math.abs(totalWins - totalLosses)}`);

    // Show updated standings
    console.log('\n=== Updated Team Standings ===');
    gameState.teams
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .forEach((team, i) => {
            const winRate = team.gamesPlayed > 0 ? ((team.gamesWon / team.gamesPlayed) * 100).toFixed(0) : 0;
            console.log(`${i + 1}. ${team.name}: ${team.gamesWon}-${team.gamesLost} (${winRate}%)`);
        });

    // Save the corrected state
    await saveGameState();
    console.log('\n✓ Stats saved to database');

    // Refresh UI
    renderTeamPanel();
    showStatus('Team stats recalculated from match history', 'success');

    return {
        processedMatches,
        skippedSplitWins,
        skippedSplitLosses,
        totalWins,
        totalLosses,
        balanced: totalWins === totalLosses
    };
}

// Make it available globally for console access
window.recalculateTeamStats = recalculateTeamStats;

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

    // Collect hex coords under active challenge (pending/ongoing challenge matches)
    const contestedHexes = new Set();
    (gameState.gameQueue || []).forEach(m => {
        if (m.isChallenge && m.challengeHexCoord &&
            (m.status === 'pending' || m.status === 'ongoing')) {
            contestedHexes.add(m.challengeHexCoord);
        }
    });

    const pointsAwarded = {};

    gameState.teams.forEach(team => {
        let roundPoints = 0;

        // Count points from controlled heart hexes
        Object.entries(gameState.heartHexControl || {}).forEach(([coord, ownerId]) => {
            // Skip hexes under active challenge — points frozen until resolved
            if (contestedHexes.has(coord)) return;

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

    // Phase-managed tournaments must never touch the legacy round system:
    // it awards points under a round key the phase flow's double-award
    // guard doesn't check, and bumps currentRound out from under the
    // adapter's round sync. The hidden button is not a guard — this is.
    if (gameState?.currentPhase) {
        showStatus('Phase flow is active — use the Flow Panel to advance.', 'warning');
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
async function confirmAdvanceRound(triggerBtn) {
    // Same guard as advanceRound(): the legacy round system must be inert
    // while the phase flow owns advancement (double-award + round desync).
    if (gameState?.currentPhase) {
        showStatus('Phase flow is active — use the Flow Panel to advance.', 'warning');
        closeNextRoundModal();
        return;
    }
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

    await saveGameState(triggerBtn);

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

async function saveGameState(triggerBtn) {
    if (!gameState || !currentTournamentId) {
        showStatus('No game state to save', 'warning');
        return;
    }

    // Guard against offline saves
    if (window._isOffline) {
        showToast('Cannot save while offline. Waiting for connection...', 'warning');
        return;
    }

    const stopLoading = (typeof btnLoading === 'function' && triggerBtn) ? btnLoading(triggerBtn) : null;

    try {
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentTournamentId);

        // Create a clean copy without internal/migrated fields
        const saveData = { ...gameState };
        delete saveData.tournamentId;
        delete saveData.onboarding; // Onboarding lives in subcollection now

        // Clean undefined values recursively (Firebase rejects them)
        const cleanData = removeUndefined(saveData);

        await tournamentRef.set(cleanData, { merge: true });

        updateConnectionStatus('connected');

    } catch (error) {
        console.error('Error saving game state:', error);
        updateConnectionStatus('disconnected');
        showStatus('Error saving to Firebase', 'error');
    } finally {
        if (stopLoading) stopLoading();
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
 * Log an event to Firebase for real-time display in view
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
// PENDING HEX NOTIFICATION
// =============================================================================

/**
 * Update the pending hex notification banner
 * Shows when teams have won matches but haven't placed their hex yet
 */
function updatePendingHexNotification() {
    let banner = document.getElementById('pendingHexBanner');

    if (pendingHexWins.length === 0) {
        if (banner) banner.remove();
        return;
    }

    // Create banner if it doesn't exist
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pendingHexBanner';
        banner.className = 'pending-hex-banner';

        // Insert after the top bar
        const topBar = document.querySelector('.top-bar');
        if (topBar) {
            topBar.after(banner);
        }
    }

    // Build banner content with team colors
    const pendingList = pendingHexWins.map(win => {
        const matchNum = win.matchNumber ? `Match #${win.matchNumber}` : 'Match';

        // Build colored team names
        const coloredTeams = win.teamIds.map((teamId, idx) => {
            const teamName = win.teamNames[idx] || `Team ${teamId}`;
            const team = gameState?.teams?.find(t => String(t.id) === String(teamId));
            const color = team?.color || getTeamColor(teamId) || 'var(--accent-primary)';
            return `<span class="pending-hex-team" style="color: ${color}; border-left-color: ${color}">${teamName}</span>`;
        }).join('');

        return `<span class="pending-hex-item">${matchNum}: ${coloredTeams}</span>`;
    }).join('');

    banner.innerHTML = `
        <span class="pending-hex-icon">${ICON_SVGS.triangleAlert}</span>
        <span class="pending-hex-text">Pending hex placement:</span>
        ${pendingList}
    `;
}

/**
 * Clear a pending hex win when a team places their hex
 * Called from assignTeamToHex when a hex is assigned
 * Only removes ONE notification per hex placed (the oldest one for this team)
 */
async function clearPendingHexWin(teamId) {
    let changed = false;

    // Find the FIRST (oldest) pending hex win that includes this team
    // Only remove from one entry per hex placed
    for (let i = 0; i < pendingHexWins.length; i++) {
        const win = pendingHexWins[i];
        const idx = win.teamIds.findIndex(id => String(id) === String(teamId));
        if (idx !== -1) {
            win.teamIds.splice(idx, 1);
            // Also remove the corresponding team name
            if (win.teamNames && win.teamNames[idx] !== undefined) {
                win.teamNames.splice(idx, 1);
            }
            changed = true;
            break; // Only remove from the first matching entry
        }
    }

    // Remove entries where all teams have placed their hexes
    const beforeCount = pendingHexWins.length;
    pendingHexWins = pendingHexWins.filter(win => win.teamIds.length > 0);

    if (changed || pendingHexWins.length !== beforeCount) {
        updatePendingHexNotification();
        // Persist the clear — see the persistence note on the pendingHexWins
        // accessor near the top of this file.
        await saveGameState();
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
        window.location.href = (window.BOARDGAME_BASE || '.') + '/login.html';
    }).catch(error => {
        console.error('Logout error:', error);
        showStatus('Error logging out', 'error');
    });
}

// =============================================================================
// VIEW WINDOW
// =============================================================================

/**
 * Open view.html in a new window with the current tournament
 */
function openViewWindow() {
    if (!currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const viewUrl = `view.html?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    window.open(viewUrl, '_blank', 'width=1920,height=1080');
}

/**
 * Open statistics.html in a new window with the current tournament
 */
function openStatsWindow() {
    if (!currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const statsUrl = `statistics.html?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    window.open(statsUrl, '_blank');
}

/**
 * Open onboarding.html admin view in a new window
 */
function openOnboardingWindow() {
    if (!currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const onboardingUrl = `onboarding.html?tournamentId=${encodeURIComponent(currentTournamentId)}&view=true`;
    window.open(onboardingUrl, '_blank');
}

/**
 * Open the dev Match Scheduler tool in a new tab, passing the current
 * tournament so it can pre-populate the game order from selectedGames.
 */
function openMatchSchedulerWindow() {
    let url = 'http://127.0.0.1:5500/BoardGame/dev/dev-matchscheduler.html';
    if (currentTournamentId) {
        url += `?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    }
    window.open(url, '_blank');
}

/**
 * Open view-onboarding.html in a new window (TV display for setup night)
 */
function openOnboardingViewWindow() {
    if (!currentTournamentId) {
        showStatus('Load a tournament first', 'warning');
        return;
    }

    const url = `view-onboarding-layout.html?tournamentId=${encodeURIComponent(currentTournamentId)}`;
    window.open(url, '_blank');
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
        closeSeatingOrder();
        closeNextRoundModal();
        closeAutoMatchModal();
    }
});

// Close modals on outside click (null-safe for pages that omit optional modals)
const modalDismissMap = {
    'teamPickerModal': closeTeamPicker,
    'resultConfirmModal': closeResultConfirm,
    'playerManagerModal': closePlayerManager,
    'seatingOrderModal': closeSeatingOrder,
    'nextRoundModal': closeNextRoundModal,
    'autoMatchModal': closeAutoMatchModal,
    'clearQueueModal': closeClearQueueModal
};

Object.entries(modalDismissMap).forEach(([id, closeFn]) => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('click', (e) => {
            if (e.target.id === id) closeFn();
        });
    }
});
