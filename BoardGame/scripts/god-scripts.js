/**
 * =============================================================================
 * GOD-SCRIPTS.JS
 * Complete JavaScript functionality for god.html (God Mode Admin Panel)
 * =============================================================================
 * 
 * This file contains ALL the JavaScript logic for the god mode interface,
 * organized into logical sections for easy navigation and maintenance.
 * 
 * DEPENDENCIES:
 * - board-module.js (BoardModule class)
 * - board-renderer.js (BoardRenderer class)
 * - firebase-loader.js (Firebase connection)
 * 
 * SECTIONS:
 * 1. Global State
 * 2. Firebase Connection
 * 3. Utility Functions
 * 4. UI Navigation (Tab Switching)
 * 5. Game Loading & Saving
 * 6. Player Management
 * 7. Manual Game Setup (Drag & Drop)
 * 8. Confirm Result Functions
 * 9. Game Queue Management
 * 10. Board Interaction
 * 11. Display Updates
 * 12. Initialization
 * =============================================================================
 */

// =============================================================================
// SECTION 1: GLOBAL STATE
// =============================================================================
// These variables hold the current state of the application and are accessed
// throughout the codebase. Think of them as the "memory" of the application.

/**
 * Main game state object - contains all game data
 * Structure: { gameId, teams, board, currentTurn, gameQueue, gameHistory, ... }
 * NOTE: Defined on window object to be accessible by other modules (user-management.js, etc.)
 */
window.gameState = null;
let gameState = window.gameState; // Local alias for convenience

/**
 * Firebase listener for real-time updates
 * Stored so we can unsubscribe when loading a different game
 */
let activeListener = null;

/**
 * Manual game setup - tracks players assigned to each side
 * Structure: { teamA: [player objects], teamB: [player objects] }
 */
let manualGameSetup = {
    teamA: [],
    teamB: []
};

/**
 * Currently selected queued game for confirmation
 * Set when user selects a game from the dropdown in Confirm tab
 */
let selectedQueuedGame = null;

/**
 * Board module instance - handles hex grid logic
 */
let boardModule = null;

/**
 * Board renderer instance - handles visual display of the hex grid
 */
let boardRenderer = null;


// =============================================================================
// SECTION 2: FIREBASE CONNECTION
// =============================================================================
// Handles the connection status display and initial Firebase setup

/**
 * Initializes board rendering modules
 * Creates the BoardModule and BoardRenderer instances needed to display the hex grid
 * Only initializes if the board container exists (Board tab)
 */
function initializeBoardModules() {
    boardModule = new BoardModule(1);
    // Try hexBoardAlt first (Board tab), then hexBoard (legacy)
    const hexBoardContainer = document.getElementById('hexBoardAlt') || document.getElementById('hexBoard');

    // Only create BoardRenderer if the container exists
    if (hexBoardContainer) {
        boardRenderer = new BoardRenderer(hexBoardContainer, boardModule, {
            responsive: true
        });
        console.log('[Board] Initialized board renderer with container:', hexBoardContainer.id);
    } else {
        console.log('[Board] Board container not found - will initialize when Board tab is opened');
    }
}
// =======================
// BOARD RENDERING
// =======================
// NOTE: Board rendering now uses BoardRenderer and BoardModule exclusively.
// All hex math and rendering logic has been moved to those dedicated modules.

/**
 * Render the hex board using BoardRenderer module
 * This is a simplified wrapper that delegates to the board renderer
 */
function renderBoard() {
    // Note: The actual rendering is now handled in updateDisplay() using boardRenderer
    // This function is kept for backward compatibility but does nothing
    // All board rendering happens via boardRenderer.render() in updateDisplay()
    if (!boardRenderer || !gameState) {
        console.warn('[renderBoard] Board renderer or game state not available');
        return;
    }

    boardRenderer.render(gameState);
    addLog('Board rendered via BoardRenderer module');
}

function handleHexClick(q, r) {
    const hexKey = `q${q}r${r}`;
    console.log('Clicked hex:', hexKey);
    addLog(`Clicked hex: ${hexKey}`);
    
    // Check if hex has a plate
    if (gameState.board[hexKey]) {
        const plate = gameState.board[hexKey];
        showStatus(`Hex ${hexKey}: ${plate.teamName} plate`, 'info');
    } else {
        showStatus(`Hex ${hexKey}: Empty`, 'info');
    }
}

/**
 * Highlight valid placement locations on the board
 * Uses BoardModule to calculate valid placements based on current game state
 */
function highlightValidPlacements() {
    if (!gameState || !gameState.board || !boardModule) return;

    // Get current turn team's plates
    const currentTeamId = gameState.currentTurn?.teamId;
    if (!currentTeamId) {
        addLog('No active turn - cannot highlight valid placements');
        return;
    }

    // Get team's plates
    const teamPlates = Object.keys(gameState.board)
        .filter(key => gameState.board[key] === currentTeamId);

    // Get all occupied hexes
    const occupiedHexes = Object.keys(gameState.board);

    // Use BoardModule to get valid placements
    const validPlacements = boardModule.getValidPlacements(teamPlates, occupiedHexes);

    // Highlight valid hexes in the UI
    document.querySelectorAll('.board-hex').forEach(hex => {
        const hexKey = hex.dataset.coord; // Changed from dataset.hex to dataset.coord
        if (validPlacements.some(p => p.coord === hexKey)) {
            hex.classList.add('can-place-highlight');
        }
    });

    addLog(`Highlighted ${validPlacements.length} valid placement hexes`);
    showStatus(`${validPlacements.length} valid placements highlighted`, 'success');
}

/**
 * Clear all placement highlights from the board
 */
function clearHighlights() {
    document.querySelectorAll('.board-hex').forEach(hex => {
        hex.classList.remove('can-place-highlight');
    });
    addLog('Cleared hex highlights');
}

/**
 * Parse a hex coordinate string into [q, r] values
 * @param {string} hexKey - Coordinate string like "q1r-2"
 * @returns {Array} [q, r] coordinates
 * NOTE: If you need neighbor calculation, use boardModule.getHexNeighbors() instead
 */
function parseHexKey(hexKey) {
    const match = hexKey.match(/q(-?\d+)r(-?\d+)/);
    return match ? [parseInt(match[1]), parseInt(match[2])] : [0, 0];
}
/**
 * Listen for Firebase ready event
 * Updates the connection status indicator when Firebase successfully connects
 */
document.addEventListener('firebase-ready', function() {
    document.getElementById('connectionStatus').className = 'connection-status connected';
    document.getElementById('connectionStatus').textContent = '🟢 Firebase Connected';
    addLog('Firebase connected successfully', 'success');
});

/**
 * Backup connection check
 * Double-checks Firebase connection after page load in case the event fired too early
 */
window.addEventListener('load', function() {
    setTimeout(() => {
        if (window.firebaseDB) {
            document.getElementById('connectionStatus').className = 'connection-status connected';
            document.getElementById('connectionStatus').textContent = '🟢 Firebase Connected';
            addLog('Firebase connected successfully', 'success');
        }
    }, 2000);
});


// =============================================================================
// SECTION 3: UTILITY FUNCTIONS
// =============================================================================
// General-purpose helper functions used throughout the application

/**
 * Removes undefined values from objects before saving to Firebase
 * Firebase doesn't accept undefined values, so we need to clean the object first
 * 
 * @param {*} obj - The object to clean (can be nested)
 * @returns {*} - Cleaned object with undefined values removed
 */
function cleanObject(obj) {
    if (obj === null || obj === undefined) {
        return null;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => cleanObject(item)).filter(item => item !== undefined);
    }
    
    if (typeof obj === 'object') {
        const cleaned = {};
        for (const key in obj) {
            const value = cleanObject(obj[key]);
            if (value !== undefined) {
                cleaned[key] = value;
            }
        }
        return cleaned;
    }
    
    return obj;
}

/**
 * Gets the display color for a team based on their ID
 * 
 * @param {number} teamId - The team's ID (1-5)
 * @returns {string} - Hex color code for the team
 */
function getTeamColor(teamId) {
    const colors = {
        1: '#ff4444', // Red
        2: '#44ff44', // Green
        3: '#4444ff', // Blue
        4: '#ffff44', // Yellow
        5: '#ff44ff'  // Magenta
    };
    return colors[teamId] || '#888888';
}

/**
 * Shows a status message to the user
 * Displays a colored message banner at the top of the page that auto-dismisses
 * 
 * @param {string} message - The message to display
 * @param {string} type - Message type: 'info', 'success', 'error', or 'warning'
 */
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 5000);
}

/**
 * Adds an entry to the game log
 * The log shows a chronological history of actions taken in the game
 * 
 * @param {string} message - The log message
 * @param {string} type - Message type for styling: 'info', 'success', 'error', or 'warning'
 */
function addLog(message, type = 'info') {
    const log = document.getElementById('gameLog');
    if (!log) {
        console.log(`[Log] ${message}`);
        return; // Element doesn't exist on this tab, just log to console
    }
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span style="opacity: 0.7;">[${timestamp}]</span> ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

/**
 * Clears all entries from the game log
 */
function clearLog() {
    document.getElementById('gameLog').innerHTML = '<div class="log-entry">Log cleared...</div>';
}

/**
 * Exports the current game state as a JSON file
 * Useful for backups or debugging
 */
function exportGameState() {
    if (!gameState) {
        showStatus('No game to export', 'error');
        return;
    }
    
    const dataStr = JSON.stringify(gameState, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `game-${gameState.gameId}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    
    addLog('📥 Game state exported', 'success');
    showStatus('Game exported successfully!', 'success');
}


// =============================================================================
// SECTION 4: UI NAVIGATION (TAB SWITCHING)
// =============================================================================
// Handles switching between "Plan Game" and "Confirm Result" tabs

/**
 * Switches between tabs in the game management section
 * 
 * @param {string} tab - Either 'plan' or 'confirm'
 */
function switchTab(tab) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Activate the selected tab
    if (tab === 'plan') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('planTab').classList.add('active');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('confirmTab').classList.add('active');
        updateQueuedGameSelect(); // Refresh the dropdown when switching to confirm tab
    }
}


// =============================================================================
// SECTION 5: GAME LOADING & SAVING
// =============================================================================
// Handles loading games from Firebase and saving changes back

/**
 * Loads a game from Firebase and sets up real-time listening
 * MIGRATION NOTE: This now loads from tournaments/{tid}/matches/{mid}
 * Called when user enters a game ID and clicks "Load Game"
 */
async function loadGame() {
    const gameId = document.getElementById('gameId').value.trim();
    if (!gameId) {
        showStatus('Please enter a Tournament ID', 'error');
        return;
    }

    // Parse input: support both "tournament_id" and "tournament_id/match_id"
    let tournamentId, matchId;
    if (gameId.includes('/')) {
        [tournamentId, matchId] = gameId.split('/');
    } else {
        // Backward compatibility: treat as tournament ID, find first match
        tournamentId = gameId;
        matchId = null;  // Will be determined below
    }

    try {
        // If no specific match, find first available match
        if (!matchId) {
            const matchesRef = window.firebaseDB.collection('tournaments').doc(tournamentId).collection('matches');
            const matchesSnapshot = await matchesRef.limit(1).get();

            if (matchesSnapshot.empty) {
                // No matches subcollection - try loading tournament document directly (legacy support)
                console.log('[Load Game] No matches found, trying to load tournament document directly...');
                await loadTournamentDirectly(tournamentId);
                return;
            }

            matchId = matchesSnapshot.docs[0].id;
            addLog(`Auto-selected match: ${matchId}`, 'info');
        }

        const docRef = window.firebaseDB.collection('tournaments')
            .doc(tournamentId)
            .collection('matches')
            .doc(matchId);

        // Unsubscribe from previous game if any
        if (activeListener) activeListener();

        // Set up real-time listener for this match
        activeListener = window.firebaseOnSnapshot(docRef, (docSnap) => {
            if (docSnap.exists) {
                gameState = window.gameState = docSnap.data();

                // Store tournament and match IDs for later use
                gameState.tournamentId = tournamentId;
                gameState.matchId = matchId;

                // Initialize game queue if it doesn't exist
                if (!gameState.gameQueue) {
                    gameState.gameQueue = [];
                }

                // Initialize action tracking system for undo/redo
                if (typeof initializeActionSystem === 'function') {
                    initializeActionSystem(tournamentId, matchId);
                }

                // Show the player management section (if it exists - moved to Teams tab)
                const playerMgmtSection = document.getElementById('playerManagementSection');
                if (playerMgmtSection) {
                    playerMgmtSection.style.display = 'block';
                }

                // Update all UI sections
                updateDisplay();
                renderPlanTeamPool();
                renderPlayerManagement();
                updateGameQueue();
                addLog(`📂 Match "${tournamentId}/${matchId}" loaded`, 'success');
                showStatus('Match loaded successfully!', 'success');
            } else {
                showStatus(`Match "${tournamentId}/${matchId}" not found`, 'error');
            }
        });
    } catch (error) {
        console.error('Load error:', error);
        showStatus('Error loading match: ' + error.message, 'error');
    }
}

/**
 * Load tournament data directly from tournament document (legacy support)
 * Used when no matches subcollection exists
 */
async function loadTournamentDirectly(tournamentId) {
    try {
        const docRef = window.firebaseDB.collection('tournaments').doc(tournamentId);

        // Unsubscribe from previous game if any
        if (activeListener) activeListener();

        // Set up real-time listener for this tournament
        activeListener = window.firebaseOnSnapshot(docRef, (docSnap) => {
            if (docSnap.exists) {
                gameState = window.gameState = docSnap.data();

                // Store tournament ID
                gameState.tournamentId = tournamentId;
                gameState.matchId = null; // No specific match

                // Initialize game queue if it doesn't exist
                if (!gameState.gameQueue) {
                    gameState.gameQueue = [];
                }

                // Load match templates if they exist
                if (gameState.matches && gameState.matches.length > 0) {
                    console.log(`[Load Game] Found ${gameState.matches.length} match templates in tournament`);
                    // Display the first template
                    if (typeof loadTemplates === 'function') {
                        loadTemplates();
                    }
                }

                // Show the player management section (if it exists - moved to Teams tab)
                const playerMgmtSection2 = document.getElementById('playerManagementSection');
                if (playerMgmtSection2) {
                    playerMgmtSection2.style.display = 'block';
                }

                // Update all UI sections
                updateDisplay();
                renderPlanTeamPool();
                renderPlayerManagement();
                updateGameQueue();
                addLog(`📂 Tournament "${tournamentId}" loaded successfully`, 'success');
                addLog(`Found ${gameState.matches?.length || 0} match templates`, 'info');
                showStatus('Tournament loaded successfully!', 'success');
            } else {
                showStatus(`Tournament "${tournamentId}" not found`, 'error');
            }
        });
    } catch (error) {
        console.error('Load error:', error);
        showStatus('Error loading tournament: ' + error.message, 'error');
    }
}

/**
 * Saves the current game state to Firebase
 * MIGRATION NOTE: Now saves to tournaments/{tid}/matches/{mid}
 * Legacy support: If no matchId, saves directly to tournament document
 * Called after any change to the game data
 */
async function saveGameState() {
    if (!gameState?.tournamentId) {
        console.warn('Cannot save: missing tournamentId');
        return;
    }

    try {
        // Clean the object to remove undefined values (Firebase requirement)
        const cleanedState = cleanObject(gameState);

        let docRef;
        if (gameState.matchId) {
            // New structure: save to matches subcollection
            docRef = window.firebaseDB.collection('tournaments')
                .doc(gameState.tournamentId)
                .collection('matches')
                .doc(gameState.matchId);
        } else {
            // Legacy structure: save directly to tournament document
            docRef = window.firebaseDB.collection('tournaments')
                .doc(gameState.tournamentId);
        }

        await window.firebaseSetDoc(docRef, cleanedState);
        addLog('💾 State saved', 'success');
    } catch (error) {
        console.error('Save error:', error);
        showStatus('Error saving state: ' + error.message, 'error');
        addLog('Save error: ' + error.message, 'error');
    }
}


// =============================================================================
// SECTION 6: PLAYER MANAGEMENT
// =============================================================================
// Handles displaying teams/players and allowing inline editing of player names

/**
 * Renders the list of teams and their players in the player management section
 * Each player name is clickable to edit it inline
 */
function renderPlayerManagement() {
    const container = document.getElementById('playersList');
    
    if (!gameState?.teams) {
        container.innerHTML = '<p style="opacity: 0.7; text-align: center;">Load game to see players</p>';
        return;
    }
    
    // Build HTML for each team
    container.innerHTML = gameState.teams.map(team => `
        <div style="margin-bottom: 15px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; border-left: 4px solid ${getTeamColor(team.id)};">
            <div style="font-weight: 600; color: #ffd700; margin-bottom: 8px;">
                ${team.name} (${team.points || 0} pts)
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                ${team.players.map((player, playerIndex) => {
                    return `
                        <span class="editable-player-name" 
                              data-player-index="${playerIndex}"
                              data-team-id="${team.id}"
                              onclick="makePlayerNameEditable(this)"
                              title="Click to edit">
                            ${player.name}
                        </span>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');
}

/**
 * Makes a player name editable when clicked
 * Handles the entire edit workflow: entering edit mode, saving changes, updating Firebase
 * 
 * @param {HTMLElement} element - The span element containing the player name
 */
function makePlayerNameEditable(element) {
    // Prevent multiple simultaneous edits
    if (document.querySelector('.editing')) {
        console.log('Another element is already being edited');
        return;
    }
    
    // Extract data from the element
    const playerIndex = parseInt(element.dataset.playerIndex);
    const teamId = parseInt(element.dataset.teamId);
    const currentName = element.textContent.trim();
    
    console.log(`Starting edit for player at index ${playerIndex} (${currentName}) in team ${teamId}`);
    
    // Make the element editable
    element.contentEditable = true;
    element.classList.add('editing');
    element.focus();
    
    // Select all text for easy replacement
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    
    let hasFinished = false;
    
    /**
     * Finishes the edit and saves changes to Firebase
     * This function is called when the user presses Enter or clicks away
     */
    const finishEdit = async function() {
        if (hasFinished) {
            console.log('Already finished editing, skipping duplicate call');
            return;
        }
        hasFinished = true;
        
        console.log('finishEdit called');
        
        const newName = element.textContent.trim();
        console.log(`New name: "${newName}", Old name: "${currentName}"`);
        
        // Exit edit mode
        element.contentEditable = false;
        element.classList.remove('editing');
        
        // Only save if the name actually changed
        if (newName && newName !== currentName) {
            console.log('Name changed, proceeding with update');
            
            try {
                // Find the team and player in the game state
                const team = gameState.teams.find(t => t.id === teamId);
                console.log('Found team:', team);
                
                if (team && team.players[playerIndex]) {
                    const player = team.players[playerIndex];
                    console.log('Found player at index:', player);
                    
                    const oldName = player.name;
                    player.name = newName;
                    console.log(`Updated player object from "${oldName}" to "${newName}"`);
                    
                    // Also update in global players list if it exists
                    if (player.id !== undefined && gameState.players) {
                        const globalPlayer = gameState.players.find(p => p.id === player.id);
                        if (globalPlayer) {
                            globalPlayer.name = newName;
                            console.log('Updated global player object');
                        }
                    }
                    
                    // Save to Firebase
                    console.log('About to save to Firebase...');
                    await saveGameState();
                    console.log('Firebase save completed');
                    
                    addLog(`✏️ Renamed player: ${oldName} → ${newName}`, 'success');
                    showStatus(`Player renamed to ${newName}`, 'success');
                    
                    // Refresh all relevant UI sections
                    console.log('Re-rendering UI sections...');
                    renderPlayerManagement();
                    renderPlanTeamPool();
                    updateTeamsList();
                    console.log('UI update complete');
                } else {
                    console.error('Player not found at index:', playerIndex);
                    element.textContent = currentName;
                }
            } catch (error) {
                console.error('Error updating player name:', error);
                showStatus('Error updating player name: ' + error.message, 'error');
                element.textContent = currentName;
            }
        } else if (!newName) {
            console.log('Empty name, restoring original');
            element.textContent = currentName;
        } else {
            console.log('Name unchanged, no update needed');
        }
    };
    
    /**
     * Handle Enter key to finish editing
     */
    const handleKeyDown = function(e) {
        console.log('Key pressed:', e.key);
        if (e.key === 'Enter') {
            e.preventDefault();
            console.log('Enter pressed, blurring element');
            element.removeEventListener('keydown', handleKeyDown);
            element.blur();
        }
    };
    
    element.addEventListener('keydown', handleKeyDown);
    
    /**
     * Handle blur event (clicking away) to finish editing
     */
    element.addEventListener('blur', function blurHandler() {
        console.log('Blur event fired');
        element.removeEventListener('keydown', handleKeyDown);
        finishEdit();
    }, { once: true });
    
    console.log('Event listeners attached');
}

/**
 * Makes a team name editable in the Tournament Roster
 * Similar to makePlayerNameEditable but for team names in the Teams tab
 *
 * @param {HTMLElement} element - The h4 element containing the team name
 */
function makeTeamNameEditableRoster(element) {
    // Prevent multiple simultaneous edits
    if (document.querySelector('.editing')) {
        console.log('Another element is already being edited');
        return;
    }

    const teamId = parseInt(element.dataset.teamId);
    const currentName = element.textContent.trim();

    console.log(`Starting edit for team ${teamId} (${currentName})`);

    // Make the element editable
    element.contentEditable = true;
    element.classList.add('editing');
    element.focus();

    // Select all text for easy replacement
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    let hasFinished = false;

    const finishEdit = async function() {
        if (hasFinished) return;
        hasFinished = true;

        const newName = element.textContent.trim();

        // Exit edit mode
        element.contentEditable = false;
        element.classList.remove('editing');

        // Only save if the name actually changed
        if (newName && newName !== currentName) {
            try {
                const team = gameState.teams.find(t => t.id === teamId);

                if (team) {
                    const oldName = team.name;
                    team.name = newName;

                    // Save to Firebase
                    await saveGameState();

                    addLog(`✏️ Renamed team: ${oldName} → ${newName}`, 'success');
                    showStatus(`Team renamed to ${newName}`, 'success');

                    // Refresh UI - use try-catch to prevent errors from missing elements
                    try {
                        renderTournamentRoster();
                    } catch (e) {
                        console.warn('Could not refresh tournament roster:', e);
                    }

                    try {
                        if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
                    } catch (e) {
                        console.warn('Could not refresh player management:', e);
                    }

                    try {
                        if (typeof renderPlanTeamPool === 'function') renderPlanTeamPool();
                    } catch (e) {
                        console.warn('Could not refresh plan team pool:', e);
                    }

                    try {
                        if (typeof updateTeamsList === 'function') updateTeamsList();
                    } catch (e) {
                        console.warn('Could not refresh teams list:', e);
                    }
                } else {
                    console.error('Team not found:', teamId);
                    element.textContent = currentName;
                }
            } catch (error) {
                console.error('Error updating team name:', error);
                showStatus('Error updating team name: ' + error.message, 'error');
                element.textContent = currentName;
            }
        } else if (!newName) {
            element.textContent = currentName;
        }
    };

    const handleKeyDown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            element.removeEventListener('keydown', handleKeyDown);
            element.blur();
        }
    };

    element.addEventListener('keydown', handleKeyDown);
    element.addEventListener('blur', function blurHandler() {
        element.removeEventListener('keydown', handleKeyDown);
        finishEdit();
    }, { once: true });
}

/**
 * Makes a player name editable in the Tournament Roster
 * Similar to makePlayerNameEditable but for the Teams tab Tournament Roster
 *
 * @param {HTMLElement} element - The div element containing the player name
 */
function makePlayerNameEditableRoster(element) {
    // Prevent multiple simultaneous edits
    if (document.querySelector('.editing')) {
        console.log('Another element is already being edited');
        return;
    }

    const playerIndex = parseInt(element.dataset.playerIndex);
    const teamId = parseInt(element.dataset.teamId);
    const currentName = element.textContent.trim();

    console.log(`Starting edit for player at index ${playerIndex} (${currentName}) in team ${teamId}`);

    // Make the element editable
    element.contentEditable = true;
    element.classList.add('editing');
    element.focus();

    // Select all text for easy replacement
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    let hasFinished = false;

    const finishEdit = async function() {
        if (hasFinished) return;
        hasFinished = true;

        const newName = element.textContent.trim();

        // Exit edit mode
        element.contentEditable = false;
        element.classList.remove('editing');

        // Only save if the name actually changed
        if (newName && newName !== currentName) {
            try {
                const team = gameState.teams.find(t => t.id === teamId);

                if (team && team.players[playerIndex]) {
                    const player = team.players[playerIndex];
                    const oldName = player.name;
                    player.name = newName;

                    // Also update in global players list if it exists
                    if (player.id !== undefined && gameState.players) {
                        const globalPlayer = gameState.players.find(p => p.id === player.id);
                        if (globalPlayer) {
                            globalPlayer.name = newName;
                        }
                    }

                    // Update user document with new nickname if uid exists
                    if (player.uid) {
                        try {
                            const userRef = window.firebaseDB.collection('users').doc(player.uid);
                            await userRef.update({
                                displayName: newName,
                                lastModified: new Date().toISOString()
                            });
                            console.log('Updated user document with new display name');
                        } catch (error) {
                            console.warn('Could not update user document:', error);
                            // Continue anyway - game state update is more important
                        }
                    }

                    // Save to Firebase
                    await saveGameState();

                    addLog(`✏️ Renamed player: ${oldName} → ${newName}`, 'success');
                    showStatus(`Player renamed to ${newName}`, 'success');

                    // Refresh UI - use try-catch to prevent errors from missing elements
                    try {
                        renderTournamentRoster();
                    } catch (e) {
                        console.warn('Could not refresh tournament roster:', e);
                    }

                    try {
                        if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
                    } catch (e) {
                        console.warn('Could not refresh player management:', e);
                    }

                    try {
                        if (typeof renderPlanTeamPool === 'function') renderPlanTeamPool();
                    } catch (e) {
                        console.warn('Could not refresh plan team pool:', e);
                    }

                    try {
                        if (typeof updateTeamsList === 'function') updateTeamsList();
                    } catch (e) {
                        console.warn('Could not refresh teams list:', e);
                    }
                } else {
                    console.error('Player not found at index:', playerIndex);
                    element.textContent = currentName;
                }
            } catch (error) {
                console.error('Error updating player name:', error);
                showStatus('Error updating player name: ' + error.message, 'error');
                element.textContent = currentName;
            }
        } else if (!newName) {
            element.textContent = currentName;
        }
    };

    const handleKeyDown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            element.removeEventListener('keydown', handleKeyDown);
            element.blur();
        }
    };

    element.addEventListener('keydown', handleKeyDown);
    element.addEventListener('blur', function blurHandler() {
        element.removeEventListener('keydown', handleKeyDown);
        finishEdit();
    }, { once: true });
}


// =============================================================================
// SECTION 7: MANUAL GAME SETUP (DRAG & DROP)
// =============================================================================
// Handles the drag-and-drop interface for creating manual matches

/**
 * Renders the pool of available teams and players that can be dragged
 * Players already assigned to TEAM_A or TEAM_B appear grayed out
 */
function renderPlanTeamPool() {
    const pool = document.getElementById('planTeamPool');
    if (!gameState?.teams) {
        pool.innerHTML = '<p style="opacity: 0.7; text-align: center; font-size: 0.85rem;">Load game first</p>';
        return;
    }
    
    // Build list of already-assigned players using signatures (teamId-playerName)
    const assignedSignatures = [
        ...manualGameSetup.teamA.map(p => `${p.originalTeamId}-${p.name}`),
        ...manualGameSetup.teamB.map(p => `${p.originalTeamId}-${p.name}`)
    ];
    
    console.log('Rendering pool. Assigned signatures:', assignedSignatures);
    
    // Render each team with its players
    pool.innerHTML = gameState.teams.map(team => {
        // Determine which players are available (not assigned)
        const playersWithStatus = team.players.map((player, playerIndex) => {
            const signature = `${team.id}-${player.name}`;
            const isAssigned = assignedSignatures.includes(signature);
            return { player, playerIndex, isAssigned };
        });
        
        const availablePlayers = playersWithStatus.filter(p => !p.isAssigned);
        
        return `
            <div class="team-box team${team.id}" 
                 draggable="${availablePlayers.length > 0 ? 'true' : 'false'}" 
                 ondragstart="dragTeam(event, ${team.id})" 
                 ondragend="dragEnd(event)"
                 style="${availablePlayers.length === 0 ? 'opacity: 0.4; cursor: not-allowed;' : ''}">
                <div class="team-name">
                    <span>${team.name}</span>
                    <span style="opacity: 0.7; font-size: 0.85rem;">${team.points || 0} pts</span>
                </div>
                <div class="players-container">
                    ${playersWithStatus.map(({player, playerIndex, isAssigned}) => {
                        return `
                            <span class="player-tag ${isAssigned ? 'assigned' : ''}" 
                                  draggable="${!isAssigned ? 'true' : 'false'}"
                                  ondragstart="dragPlayer(event, ${playerIndex}, ${team.id})" 
                                  ondragend="dragEnd(event)"
                                  style="${isAssigned ? 'opacity: 0.3; cursor: not-allowed;' : ''}"
                                  title="${player.name}">
                                ${player.name}
                            </span>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Handles the start of dragging a single player
 * Stores player data in the drag event for retrieval on drop
 * 
 * @param {DragEvent} event - The drag event
 * @param {number} playerIndex - Index of the player in their team's players array
 * @param {number} teamId - ID of the player's original team
 */
function dragPlayer(event, playerIndex, teamId) {
    event.stopPropagation(); // Prevent triggering team drag
    event.target.classList.add('dragging');
    
    console.log('Dragging player - Index:', playerIndex, 'Team:', teamId);
    
    // Store drag data as JSON
    event.dataTransfer.setData('application/json', JSON.stringify({
        type: 'player',
        playerId: playerIndex,
        teamId: teamId
    }));
}

/**
 * Handles the start of dragging an entire team
 * 
 * @param {DragEvent} event - The drag event
 * @param {number} teamId - ID of the team being dragged
 */
function dragTeam(event, teamId) {
    event.target.classList.add('dragging');
    
    event.dataTransfer.setData('application/json', JSON.stringify({
        type: 'team',
        teamId: teamId
    }));
}

/**
 * Handles the end of dragging (cleanup)
 * 
 * @param {DragEvent} event - The drag event
 */
function dragEnd(event) {
    event.target.classList.remove('dragging');
}

/**
 * Allows dropping by preventing default behavior and adding visual feedback
 * 
 * @param {DragEvent} event - The drag event
 */
function allowDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

/**
 * Removes visual feedback when drag leaves the drop zone
 * 
 * @param {DragEvent} event - The drag event
 */
function dragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

/**
 * Handles dragging an already-assigned player from TEAM A or TEAM B
 * Sets up the drag data for moving between teams
 *
 * @param {DragEvent} event - The drag event
 * @param {string} sourceTeam - Either 'teamA' or 'teamB'
 * @param {number} playerIndex - Index of the player in the team array
 */
function dragAssignedPlayer(event, sourceTeam, playerIndex) {
    const dragData = {
        type: 'assignedPlayer',
        sourceTeam: sourceTeam,
        playerIndex: playerIndex
    };

    event.dataTransfer.setData('application/json', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'move';

    console.log('Dragging assigned player:', dragData);
}

/**
 * Handles dropping a player or team into TEAM_A or TEAM_B
 * This is the core logic that assigns players to sides
 *
 * @param {DragEvent} event - The drop event
 * @param {string} targetTeam - Either 'teamA' or 'teamB'
 */
function dropPlayer(event, targetTeam) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    console.log('=== DROP EVENT START ===');
    console.log('Target team:', targetTeam);
    console.log('Current TEAM A players:', manualGameSetup.teamA);
    console.log('Current TEAM B players:', manualGameSetup.teamB);
    
    // Parse the drag data
    const dragData = JSON.parse(event.dataTransfer.getData('application/json'));
    console.log('Drag data:', dragData);

    if (dragData.type === 'assignedPlayer') {
        // Handle moving a player between TEAM A and TEAM B
        console.log('Processing assigned player move');

        const sourceTeam = dragData.sourceTeam;
        const playerIndex = dragData.playerIndex;

        // Prevent dropping on the same team
        if (sourceTeam === targetTeam) {
            console.log('Dropped on same team, ignoring');
            return;
        }

        // Get the player from the source team
        const player = sourceTeam === 'teamA'
            ? manualGameSetup.teamA[playerIndex]
            : manualGameSetup.teamB[playerIndex];

        if (!player) {
            console.error('Player not found at index!');
            return;
        }

        console.log('Moving player:', player);

        // Remove from source team
        if (sourceTeam === 'teamA') {
            manualGameSetup.teamA.splice(playerIndex, 1);
            console.log('Removed from TEAM A');
        } else {
            manualGameSetup.teamB.splice(playerIndex, 1);
            console.log('Removed from TEAM B');
        }

        // Add to target team
        if (targetTeam === 'teamA') {
            manualGameSetup.teamA.push(player);
            console.log('Added to TEAM A');
        } else {
            manualGameSetup.teamB.push(player);
            console.log('Added to TEAM B');
        }

        showStatus(`Moved ${player.name} to ${targetTeam === 'teamA' ? 'TEAM A' : 'TEAM B'}`, 'success');

    } else if (dragData.type === 'player') {
        // Handle single player drop
        console.log('Processing single player drop');
        
        const sourceTeam = gameState.teams.find(t => t.id === dragData.teamId);
        console.log('Source team:', sourceTeam);
        
        if (!sourceTeam) {
            console.error('Source team not found!');
            return;
        }
        
        const player = sourceTeam.players[dragData.playerId];
        console.log('Player at index:', player);
        
        if (!player) {
            console.error('Player not found at index!');
            return;
        }
        
        // Check if player is already assigned
        const playerSignature = `${dragData.teamId}-${player.name}`;
        console.log('Player signature:', playerSignature);
        
        const alreadyInA = manualGameSetup.teamA.some(p => 
            p.originalTeamId === dragData.teamId && p.name === player.name
        );
        const alreadyInB = manualGameSetup.teamB.some(p => 
            p.originalTeamId === dragData.teamId && p.name === player.name
        );
        
        console.log('Already in A:', alreadyInA);
        console.log('Already in B:', alreadyInB);
        
        if (alreadyInA || alreadyInB) {
            console.log('Player already assigned, aborting');
            showStatus('Player already assigned', 'error');
            return;
        }
        
        // Create player object for the manual game
        const playerForGame = {
            id: dragData.playerId,
            name: player.name,
            originalTeamId: dragData.teamId,
            originalTeamName: sourceTeam.name,
            originalTeamColor: sourceTeam.color || getTeamColor(dragData.teamId)
        };
        
        console.log('Created player object:', playerForGame);
        
        // Add to appropriate team
        if (targetTeam === 'teamA') {
            console.log('Adding to TEAM A');
            manualGameSetup.teamA.push(playerForGame);
            console.log('TEAM A after push:', manualGameSetup.teamA);
        } else {
            console.log('Adding to TEAM B');
            manualGameSetup.teamB.push(playerForGame);
            console.log('TEAM B after push:', manualGameSetup.teamB);
        }
        
    } else if (dragData.type === 'team') {
        // Handle whole team drop
        console.log('Processing whole team drop');
        
        const sourceTeam = gameState.teams.find(t => t.id === dragData.teamId);
        console.log('Source team:', sourceTeam);
        
        if (!sourceTeam) {
            console.error('Source team not found!');
            return;
        }
        
        // Get list of already-assigned players
        const assignedSignatures = [
            ...manualGameSetup.teamA.map(p => `${p.originalTeamId}-${p.name}`),
            ...manualGameSetup.teamB.map(p => `${p.originalTeamId}-${p.name}`)
        ];
        
        console.log('Currently assigned signatures:', assignedSignatures);
        
        // Filter to only available players
        const playersToAdd = sourceTeam.players
            .map((p, index) => ({
                id: index,
                name: p.name,
                originalTeamId: sourceTeam.id,
                originalTeamName: sourceTeam.name,
                originalTeamColor: sourceTeam.color || getTeamColor(sourceTeam.id),
                signature: `${sourceTeam.id}-${p.name}`
            }))
            .filter(p => !assignedSignatures.includes(p.signature));
        
        console.log('Players to add:', playersToAdd);
        
        if (playersToAdd.length === 0) {
            console.log('All players already assigned');
            showStatus('All players from this team are already assigned', 'error');
            return;
        }
        
        // Remove the signature property (it was just for filtering)
        const cleanedPlayers = playersToAdd.map(({signature, ...rest}) => rest);
        
        // Add all available players to the target team
        if (targetTeam === 'teamA') {
            console.log('Adding to TEAM A');
            manualGameSetup.teamA.push(...cleanedPlayers);
            console.log('TEAM A after push:', manualGameSetup.teamA);
        } else {
            console.log('Adding to TEAM B');
            manualGameSetup.teamB.push(...cleanedPlayers);
            console.log('TEAM B after push:', manualGameSetup.teamB);
        }
    }
    
    // Update the UI to show the new assignments
    console.log('Calling updateManualGameDisplay...');
    updateManualGameDisplay();
    console.log('Calling renderPlanTeamPool...');
    renderPlanTeamPool();
    console.log('=== DROP EVENT END ===');
}

/**
 * Updates the display of players assigned to TEAM_A and TEAM_B
 * Shows the players currently in each drop zone
 */
function updateManualGameDisplay() {
    const teamADiv = document.getElementById('teamAPlayers');
    const teamBDiv = document.getElementById('teamBPlayers');
    
    // Render TEAM A
    if (manualGameSetup.teamA.length === 0) {
        teamADiv.innerHTML = '<span style="opacity: 0.6; font-size: 0.85rem;">Drop players here...</span>';
    } else {
        teamADiv.innerHTML = manualGameSetup.teamA.map((player, index) => {
            const teamColor = player.originalTeamColor || getTeamColor(player.originalTeamId);
            console.log(`Team A Player: ${player.name}, Team ID: ${player.originalTeamId}, Stored Color: ${player.originalTeamColor}, Final Color: ${teamColor}`);
            return `
            <div class="assigned-player"
                 draggable="true"
                 ondragstart="dragAssignedPlayer(event, 'teamA', ${index})"
                 style="cursor: move; border-left: 3px solid ${teamColor};">
                ${player.name}
                <span style="opacity: 0.6; font-size: 0.75rem; margin-left: 4px;">(${player.originalTeamName})</span>
                <button class="remove-player" onclick="removePlayerFromSide('teamA', ${index})" title="Remove">×</button>
            </div>
        `;
        }).join('');
    }
    
    // Render TEAM B
    if (manualGameSetup.teamB.length === 0) {
        teamBDiv.innerHTML = '<span style="opacity: 0.6; font-size: 0.85rem;">Drop players here...</span>';
    } else {
        teamBDiv.innerHTML = manualGameSetup.teamB.map((player, index) => {
            const teamColor = player.originalTeamColor || getTeamColor(player.originalTeamId);
            console.log(`Team B Player: ${player.name}, Team ID: ${player.originalTeamId}, Stored Color: ${player.originalTeamColor}, Final Color: ${teamColor}`);
            return `
            <div class="assigned-player"
                 draggable="true"
                 ondragstart="dragAssignedPlayer(event, 'teamB', ${index})"
                 style="cursor: move; border-left: 3px solid ${teamColor};">
                ${player.name}
                <span style="opacity: 0.6; font-size: 0.75rem; margin-left: 4px;">(${player.originalTeamName})</span>
                <button class="remove-player" onclick="removePlayerFromSide('teamB', ${index})" title="Remove">×</button>
            </div>
        `;
        }).join('');
    }
}

/**
 * Removes a player from TEAM_A or TEAM_B
 * 
 * @param {string} side - Either 'teamA' or 'teamB'
 * @param {number} index - Index of the player to remove
 */
function removePlayerFromSide(side, index) {
    if (side === 'teamA') {
        manualGameSetup.teamA.splice(index, 1);
    } else {
        manualGameSetup.teamB.splice(index, 1);
    }
    
    updateManualGameDisplay();
    renderPlanTeamPool();
}

/**
 * Clears the manual game setup (resets both TEAM_A and TEAM_B)
 */
function clearManualGameSetup() {
    manualGameSetup.teamA = [];
    manualGameSetup.teamB = [];
    document.getElementById('planNotes').value = '';
    updateManualGameDisplay();
    renderPlanTeamPool();
    addLog('🔄 Plan setup cleared');
}

/**
 * Adds the manually configured game to the queue
 * Validates that both teams have players, then creates a queue entry
 */
async function addGameToQueue() {
    console.log('addGameToQueue called');
    console.log('manualGameSetup:', manualGameSetup);
    
    if (!gameState) {
        showStatus('Load game first!', 'error');
        return;
    }
    
    // Get form values
    const game = document.getElementById('planGameType').value;
    const playType = document.getElementById('planPlayType').value;
    const notes = document.getElementById('planNotes').value || '';
    
    // Validate that both teams have players
    if (manualGameSetup.teamA.length === 0 || manualGameSetup.teamB.length === 0) {
        showStatus('Both TEAM A and TEAM B need at least one player', 'error');
        return;
    }
    
    // Create the queue entry
    const queueEntry = {
        id: Date.now(),
        game: game,
        playType: playType,
        teams: [
            {
                id: 'TEAM_A',
                name: 'TEAM A',
                players: manualGameSetup.teamA.map(p => ({
                    id: p.id,
                    name: p.name,
                    originalTeamId: p.originalTeamId,
                    originalTeamName: p.originalTeamName
                }))
            },
            {
                id: 'TEAM_B',
                name: 'TEAM B',
                players: manualGameSetup.teamB.map(p => ({
                    id: p.id,
                    name: p.name,
                    originalTeamId: p.originalTeamId,
                    originalTeamName: p.originalTeamName
                }))
            }
        ],
        notes: notes,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    // Add to queue
    gameState.gameQueue = gameState.gameQueue || [];
    gameState.gameQueue.push(queueEntry);
    
    // Save and update UI
    await saveGameState();
    updateGameQueue();
    clearManualGameSetup();
    
    // Log the addition
    const teamANames = queueEntry.teams[0].players.map(p => p.name).join(' & ');
    const teamBNames = queueEntry.teams[1].players.map(p => p.name).join(' & ');
    
    addLog(`📋 Added ${game} ${playType} to queue: ${teamANames} vs ${teamBNames}`, 'success');
    showStatus('Game added to queue!', 'success');
}


// =============================================================================
// SECTION 8: CONFIRM RESULT FUNCTIONS
// =============================================================================
// Handles confirming game results and starting the winner's turn

/**
 * Updates the dropdown list of queued games in the Confirm tab
 * Only shows pending (not yet confirmed) games
 */
function updateQueuedGameSelect() {
    const select = document.getElementById('queuedGameSelect');
    
    if (!gameState?.gameQueue || gameState.gameQueue.length === 0) {
        select.innerHTML = '<option value="">-- No games in queue --</option>';
        document.getElementById('confirmContainer').style.display = 'none';
        return;
    }
    
    // Filter to only pending games
    const pendingGames = gameState.gameQueue.filter(g => g.status === 'pending');
    
    if (pendingGames.length === 0) {
        select.innerHTML = '<option value="">-- No pending games --</option>';
        document.getElementById('confirmContainer').style.display = 'none';
        return;
    }
    
    // Build the dropdown options
    select.innerHTML = '<option value="">-- Select a game to confirm --</option>' +
        pendingGames.map(game => {
            const teamNames = game.teams.map(t => t.name).join(' vs ');
            return `<option value="${game.id}">${game.game} ${game.playType} - ${teamNames}</option>`;
        }).join('');
}

/**
 * Loads a queued game for confirmation when selected from dropdown
 * Displays the game details and winner selection interface
 */
function loadQueuedGame() {
    const select = document.getElementById('queuedGameSelect');
    const gameId = parseInt(select.value);
    
    if (!gameId) {
        document.getElementById('confirmContainer').style.display = 'none';
        selectedQueuedGame = null;
        return;
    }
    
    selectedQueuedGame = gameState.gameQueue.find(g => g.id === gameId);
    
    if (!selectedQueuedGame) {
        showStatus('Game not found', 'error');
        return;
    }
    
    // Display game info
    const infoDiv = document.getElementById('confirmGameInfo');
    infoDiv.innerHTML = `
        <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 5px;">
            <strong>${selectedQueuedGame.game} - ${selectedQueuedGame.playType}</strong><br>
            <small style="opacity: 0.8;">${selectedQueuedGame.notes || 'No notes'}</small>
        </div>
    `;
    
    // Determine input type: radio for 2 teams (one winner), checkbox for more
    const isTwoTeamMatch = selectedQueuedGame.teams.length === 2;
    const inputType = isTwoTeamMatch ? 'radio' : 'checkbox';
    const inputName = isTwoTeamMatch ? 'winner-selection' : '';
    
    // Display teams with winner selection controls
    const teamsDiv = document.getElementById('confirmTeamsDisplay');
    
    const explanationText = isTwoTeamMatch 
        ? '<p style="font-size: 0.85rem; opacity: 0.8; margin-bottom: 10px;">Select the winning team:</p>'
        : '<p style="font-size: 0.85rem; opacity: 0.8; margin-bottom: 10px;">Check all teams that won together (they will be counted as allied winners):</p>';
    
    teamsDiv.innerHTML = explanationText + selectedQueuedGame.teams.map((team, index) => `
        <div style="margin-bottom: 10px; padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 5px;">
            <label class="winner-label">
                <input type="${inputType}" 
                       ${inputName ? `name="${inputName}"` : ''} 
                       class="winner-checkbox" 
                       id="winner-${index}" 
                       value="${team.id}">
                <strong>${team.name}</strong>
                <span style="opacity: 0.8; font-size: 0.85rem;">
                    (${team.players.map(p => p.name).join(', ')})
                </span>
            </label>
        </div>
    `).join('');
    
    document.getElementById('confirmContainer').style.display = 'block';
}

/**
 * Confirms the game result and starts the winner's turn
 * This is a critical function that:
 * 1. Records the game result in history
 * 2. Updates team win counts
 * 3. Marks the queue entry as completed
 * 4. Starts the winner's turn to place a plate
 */
async function confirmGameResult() {
    if (!selectedQueuedGame) {
        showStatus('Please select a game to confirm', 'error');
        return;
    }
    
    // Get selected winners
    const checkedInputs = Array.from(document.querySelectorAll('input[class="winner-checkbox"]:checked'));
    
    if (checkedInputs.length === 0) {
        showStatus('Please select at least one winning team', 'error');
        return;
    }
    
    // Validate single winner for two-team matches
    const isTwoTeamMatch = selectedQueuedGame.teams.length === 2;
    if (isTwoTeamMatch && checkedInputs.length > 1) {
        showStatus('Error: Only one team can win in a two-team match', 'error');
        return;
    }
    
    const winningSides = checkedInputs.map(input => input.value);
    const resultNotes = document.getElementById('confirmNotes').value || '';
    
    // Collect all winning players
    const winningPlayers = [];
    winningSides.forEach(side => {
        const virtualTeam = selectedQueuedGame.teams.find(t => t.id === side);
        if (virtualTeam) {
            winningPlayers.push(...virtualTeam.players);
        }
    });
    
    // Get the real team IDs (from the original teams, not the virtual TEAM_A/TEAM_B)
    const winningTeamIds = [...new Set(winningPlayers.map(p => p.originalTeamId))];
    
    if (winningTeamIds.length === 0) {
        showStatus('Error: Could not determine winning teams', 'error');
        return;
    }
    
    // For turn assignment, use the first winning team
    const firstWinningTeamId = winningTeamIds[0];
    const winningTeam = gameState.teams.find(t => t.id === firstWinningTeamId);
    
    if (!winningTeam) {
        showStatus('Error: Winning team not found!', 'error');
        return;
    }

    // Get losing teams
    const allTeamIds = [...new Set([...selectedQueuedGame.teams[0].players, ...selectedQueuedGame.teams[1].players].map(p => p.originalTeamId))];
    const losingTeamIds = allTeamIds.filter(id => !winningTeamIds.includes(id));

    // Get team names for display
    const winnerNames = winningTeamIds.map(id => {
        const team = gameState.teams.find(t => t.id === id);
        return team ? team.name : 'Unknown';
    }).join(' & ');

    const loserNames = losingTeamIds.map(id => {
        const team = gameState.teams.find(t => t.id === id);
        return team ? team.name : 'Unknown';
    }).join(' & ');

    // Create the game result record
    const result = {
        id: (gameState.gameHistory?.length || 0) + 1,
        game: selectedQueuedGame.game,
        playType: selectedQueuedGame.playType,
        matchup: {
            teamA: selectedQueuedGame.teams[0].players.map(p => ({
                name: p.name,
                originalTeam: p.originalTeamName
            })),
            teamB: selectedQueuedGame.teams[1].players.map(p => ({
                name: p.name,
                originalTeam: p.originalTeamName
            }))
        },
        winningSide: winningSides[0],
        winningPlayers: winningPlayers.map(p => ({
            name: p.name,
            originalTeamId: p.originalTeamId
        })),
        winningTeamIds: winningTeamIds,
        losingTeamIds: losingTeamIds,
        winner: winnerNames,  // Add for view.html display
        loser: loserNames,    // Add for view.html display
        queuedGameId: selectedQueuedGame.id,
        planNotes: selectedQueuedGame.notes || '',
        resultNotes: resultNotes,
        timestamp: new Date().toISOString()
    };
    
    // Add to game history
    gameState.gameHistory = gameState.gameHistory || [];
    gameState.gameHistory.push(result);
    gameState.gamesPlayed = (gameState.gamesPlayed || 0) + 1;
    gameState.currentRound = Math.ceil(gameState.gamesPlayed / gameState.teams.length);
    
    // Update win counts for all winning teams
    winningTeamIds.forEach(teamId => {
        const team = gameState.teams.find(t => t.id === teamId);
        if (team) {
            team.gamesWon = (team.gamesWon || 0) + 1;
        }
    });
    
    // Mark the queued game as completed
    const queuedGame = gameState.gameQueue.find(g => g.id === selectedQueuedGame.id);
    if (queuedGame) {
        queuedGame.status = 'completed';
        queuedGame.completedAt = new Date().toISOString();
        queuedGame.resultId = result.id;
    }
    
    // Start the winner's turn
    gameState.currentTurn = {
        teamId: firstWinningTeamId,
        needsPlacement: true,
        gameResultId: result.id,
        startTime: new Date().toISOString()
    };
    
    // Save and update UI
    await saveGameState();
    updateDisplay();
    updateGameQueue();
    
    // Create log message
    const teamANames = selectedQueuedGame.teams[0].players.map(p => p.name).join(' & ');
    const teamBNames = selectedQueuedGame.teams[1].players.map(p => p.name).join(' & ');
    const winningNames = winningPlayers.map(p => p.name).join(' & ');
    
    const logMessage = `🏆 ${winningNames} won ${selectedQueuedGame.game} ${selectedQueuedGame.playType}. Match was: ${teamANames} vs ${teamBNames}`;
    
    addLog(logMessage, 'success');
    showStatus(`${winningTeam.name}'s turn to place a plate!`, 'info');
    
    // Clear the confirmation interface
    document.getElementById('confirmContainer').style.display = 'none';
    document.getElementById('queuedGameSelect').value = '';
    document.getElementById('confirmNotes').value = '';
    selectedQueuedGame = null;
}


// =============================================================================
// SECTION 9: GAME QUEUE MANAGEMENT
// =============================================================================
// Handles displaying and managing the queue of planned games

/**
 * Updates the visual display of the game queue
 * Shows all pending games with options to select or delete them
 */
function updateGameQueue() {
    const container = document.getElementById('gameQueue');
    const countSpan = document.getElementById('queueCount');
    
    if (!gameState?.gameQueue || gameState.gameQueue.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.7; font-style: italic; font-size: 0.85rem;">No games in queue</p>';
        countSpan.textContent = '0';
        return;
    }
    
    // Filter to only pending games
    const pendingGames = gameState.gameQueue.filter(g => g.status === 'pending');
    countSpan.textContent = pendingGames.length.toString();
    
    if (pendingGames.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.7; font-style: italic; font-size: 0.85rem;">No pending games</p>';
        return;
    }
    
    // Render each queued game
    container.innerHTML = pendingGames.map(game => {
        const teamNames = game.teams.map(t => t.name).join(' vs ');
        return `
            <div class="queued-game ${game.status}" onclick="selectQueuedGameFromList(${game.id})">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <strong style="font-size: 0.9rem;">${game.game} - ${game.playType}</strong>
                    <button onclick="event.stopPropagation(); removeFromQueue(${game.id})" 
                            style="background: rgba(239, 68, 68, 0.8); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;">×</button>
                </div>
                <div style="font-size: 0.85rem; opacity: 0.9;">${teamNames}</div>
                ${game.notes ? `<div style="font-size: 0.75rem; opacity: 0.7; margin-top: 3px;">${game.notes}</div>` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Selects a queued game from the list (switches to Confirm tab and loads it)
 * 
 * @param {number} gameId - ID of the queued game to select
 */
function selectQueuedGameFromList(gameId) {
    switchTab('confirm');
    document.getElementById('queuedGameSelect').value = gameId;
    loadQueuedGame();
}

/**
 * Removes a game from the queue
 * 
 * @param {number} gameId - ID of the queued game to remove
 */
async function removeFromQueue(gameId) {
    if (!confirm('Remove this game from queue?')) return;
    
    gameState.gameQueue = gameState.gameQueue.filter(g => g.id !== gameId);
    await saveGameState();
    updateGameQueue();
    updateQueuedGameSelect();
    addLog(`🗑️ Removed game from queue`, 'success');
}


// =============================================================================
// SECTION 10: BOARD INTERACTION
// =============================================================================
// Handles clicking hexes, placing plates, and calculating points

/**
 * Checks if a plate can be placed at the given coordinates
 * Uses the BoardModule's adjacency logic
 * 
 * @param {number} q - Q coordinate of the hex
 * @param {number} r - R coordinate of the hex
 * @param {number} teamId - ID of the team trying to place
 * @returns {boolean} - Whether placement is valid
 */
function canPlaceAt(q, r, teamId) {
    if (!gameState || !boardModule) return false;
    
    // Get all coordinates occupied by this team
    const teamPlates = Object.entries(gameState.board || {})
        .filter(([_, occupier]) => occupier === teamId)
        .map(([coord, _]) => coord);
    
    // Get all occupied hexes (any team)
    const occupiedHexes = Object.keys(gameState.board || {});
    
    return boardModule.canPlaceAt(q, r, teamPlates, occupiedHexes);
}

/**
 * Handles clicking on a hex to place a plate
 * Called when user clicks a hex on the board
 * 
 * @param {number} q - Q coordinate of the clicked hex
 * @param {number} r - R coordinate of the clicked hex
 */
function handleHexClick(q, r) {
    if (!gameState?.currentTurn) {
        showStatus('No active turn. Confirm a game result first.', 'error');
        return;
    }
    
    const teamId = gameState.currentTurn.teamId;
    const coord = `q${q}r${r}`;
    
    // Validate placement
    if (!canPlaceAt(q, r, teamId)) {
        showStatus(`Cannot place plate at ${coord}`, 'error');
        return;
    }
    
    // Confirm before placing
    if (confirm(`Place plate for Team ${teamId} at ${coord}?`)) {
        placePlate(q, r, teamId);
    }
}

/**
 * Places a plate on the board for a team
 * Updates the board state, handles heart hex capture, recalculates points
 * 
 * @param {number} q - Q coordinate
 * @param {number} r - R coordinate
 * @param {number} teamId - ID of the team placing the plate
 */
async function placePlate(q, r, teamId) {
    const coord = `q${q}r${r}`;

    // Store previous owner for undo functionality
    const previousOwner = gameState.board[coord] || null;

    // Place the plate
    gameState.board[coord] = teamId;

    // Record the PLACE_PLATE action for undo/redo
    if (typeof recordAction === 'function') {
        await recordAction(ACTION_TYPES.PLACE_PLATE, teamId, {
            hexId: coord,
            hexCoords: { q, r },
            plateColor: getTeamColor(teamId),
            previousOwner: previousOwner
        });
    }

    // Check if this is a heart hex and capture it
    const hexType = boardModule.getHexType(q, r);
    if (hexType === 'high-value' || hexType === 'center') {
        const previousHeartOwner = gameState.heartHexControl?.[coord] || null;

        gameState.heartHexControl = gameState.heartHexControl || {};
        gameState.heartHexControl[coord] = teamId;
        addLog(`❤️ Team ${teamId} captured heart hex ${coord}!`, 'success');

        // Record the CAPTURE_HEART action for undo/redo
        if (typeof recordAction === 'function') {
            await recordAction(ACTION_TYPES.CAPTURE_HEART, teamId, {
                hexId: coord,
                heartType: hexType === 'center' ? 'mountain' : 'normal',
                previousOwner: previousHeartOwner
            });
        }
    }

    // Recalculate all teams' points
    calculatePoints();

    // End the turn
    gameState.currentTurn.needsPlacement = false;
    gameState.currentTurn = null;

    // Check if anyone won
    checkWinCondition();

    // Save and update display
    await saveGameState();

    addLog(`✅ Team ${teamId} placed plate at ${coord}`, 'success');
    updateDisplay();
}

/**
 * Calculates points for all teams
 * Points come from:
 * 1. Adjacency to teammates (from BoardModule)
 * 2. Controlled heart hexes (+1 per turn for normal hearts, +2 for mountain hearts)
 */
function calculatePoints() {
    if (!gameState?.teams || !boardModule) return;
    
    gameState.teams.forEach(team => {
        // Get all plates placed by this team
        const teamPlates = Object.entries(gameState.board || {})
            .filter(([_, occupier]) => occupier === team.id)
            .map(([coord, _]) => coord);
        
        // Calculate base points from adjacency
        team.points = boardModule.calculateTeamPoints(teamPlates);
        
        // Add bonus points from controlled heart hexes
        Object.entries(gameState.heartHexControl || {}).forEach(([heartHex, controllingTeam]) => {
            if (controllingTeam === team.id) {
                const matches = heartHex.match(/-?\d+/g);
                if (matches) {
                    const [q, r] = matches.map(Number);
                    // Mountain hearts give +2, normal hearts give +1
                    team.points += boardModule.getHexType(q, r) === 'center' ? 2 : 1;
                }
            }
        });
    });
}

/**
 * Checks if any team has reached the win condition
 * If so, marks the game as finished
 */
function checkWinCondition() {
    if (!gameState?.teams) return;
    
    const winner = gameState.teams.find(team => team.points >= gameState.winCondition);
    if (winner) {
        gameState.gamePhase = 'finished';
        gameState.finishedAt = new Date().toISOString();
        addLog(`🏆 GAME OVER! ${winner.name} wins with ${winner.points} points!`, 'success');
        showStatus(`🏆 ${winner.name} wins the game!`, 'success');
    }
}

/**
 * Highlights all valid placements for the current turn
 * Shows green highlighted hexes where the active team can place
 */
function highlightValidPlacements() {
    if (!gameState?.currentTurn) {
        showStatus('No active turn', 'error');
        return;
    }
    
    clearHighlights();
    
    const teamId = gameState.currentTurn.teamId;
    const coordinates = boardModule.generateHexCoordinates();
    
    // Check each hex and highlight if valid
    coordinates.forEach(([q, r]) => {
        if (canPlaceAt(q, r, teamId)) {
            const coord = `q${q}r${r}`;
            const hexElement = document.querySelector(`[data-coord="${coord}"]`);
            if (hexElement) {
                hexElement.classList.add('can-place-highlight');
            }
        }
    });
    
    addLog(`🔍 Showing valid placements for Team ${teamId}`);
}

/**
 * Clears all placement highlights from the board
 */
function clearHighlights() {
    document.querySelectorAll('.board-hex.can-place-highlight').forEach(hex => {
        hex.classList.remove('can-place-highlight');
    });
}


// =============================================================================
// SECTION 11: DISPLAY UPDATES
// =============================================================================
// Functions that update various UI sections to reflect current game state

/**
 * Master update function - refreshes all display sections
 * Call this whenever game state changes
 */
function updateDisplay() {
    // Render the board if we have a renderer and game state
    if (boardRenderer && gameState) {
        boardRenderer.render(gameState);
        
        // Attach click handlers to all hex elements
        document.querySelectorAll('.board-hex').forEach(hex => {
            const coord = hex.dataset.coord;
            if (coord) {
                const matches = coord.match(/-?\d+/g);
                if (matches) {
                    const [q, r] = matches.map(Number);
                    hex.addEventListener('click', () => handleHexClick(q, r));
                }
            }
        });
    }
    
    // Update all UI sections
    updateTeamsList();
    updateCurrentTurnInfo();
    updateStatistics();
    updateGameQueue();
}

/**
 * Updates the team rankings list in the right sidebar
 * Shows teams sorted by points with their current statistics
 */
function updateTeamsList() {
    const container = document.getElementById('teamsList');
    
    if (!gameState?.teams) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.7; font-style: italic;">Initialize game to see teams</p>';
        return;
    }
    
    // Sort teams by points (highest first)
    const sortedTeams = [...gameState.teams].sort((a, b) => (b.points || 0) - (a.points || 0));
    
    container.innerHTML = sortedTeams.map((team, index) => {
        const isActive = gameState.currentTurn?.teamId === team.id;
        const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        
        return `
            <div class="team-card team${team.id} ${isActive ? 'active' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${rankIcon} ${team.name}</strong><br>
                        <small>${team.players.map(p => p.name).join(' & ')}</small>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.3rem; font-weight: bold;">${team.points || 0}</div>
                        <div style="font-size: 0.8rem; opacity: 0.8;">${team.gamesWon || 0} wins</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Updates the current turn information banner
 * Shows which team needs to place a plate
 */
function updateCurrentTurnInfo() {
    // Update both possible locations (Board tab has currentTurnInfoBoard)
    const container = document.getElementById('currentTurnInfo') || document.getElementById('currentTurnInfoBoard');
    if (!container) return; // Element doesn't exist on this tab

    if (!gameState?.currentTurn) {
        container.innerHTML = '<strong>⏳ No active turn - Confirm a game result to start</strong>';
        return;
    }

    const team = gameState.teams.find(t => t.id === gameState.currentTurn.teamId);
    container.innerHTML = `
        <strong>🎯 ${team?.name}'s Turn</strong><br>
        <small>${team?.players.map(p => p.name).join(' & ')}</small><br>
        <div style="margin-top: 8px; color: #4ade80;">
            ${gameState.currentTurn.needsPlacement ? '📍 Click a hex to place plate' : '✅ Placement complete'}
        </div>
    `;
}

/**
 * Updates the statistics display in the left sidebar
 * Shows games played, current round, plates on board, and controlled hearts
 */
function updateStatistics() {
    if (!gameState) {
        document.getElementById('statGamesPlayed').textContent = '0';
        document.getElementById('statRound').textContent = '0';
        document.getElementById('statPlates').textContent = '0';
        document.getElementById('statHearts').textContent = '0';
        return;
    }
    
    document.getElementById('statGamesPlayed').textContent = gameState.gamesPlayed || 0;
    document.getElementById('statRound').textContent = gameState.currentRound || 0;
    document.getElementById('statPlates').textContent = Object.keys(gameState.board || {}).length;
    document.getElementById('statHearts').textContent = Object.keys(gameState.heartHexControl || {}).length;
}


// =============================================================================
// SECTION 12: INITIALIZATION
// =============================================================================
// Code that runs when the page loads

/**
 * Main initialization function
 * Sets up the application when the DOM is ready
 */
document.addEventListener('DOMContentLoaded', function() {
    addLog('👑 God Mode Admin Panel Ready');
    
    // Initialize the board rendering system
    initializeBoardModules();
    
    // Check if game ID or tournament was passed in URL
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('tournament') || urlParams.get('gameId') || urlParams.get('game');
    if (gameId) {
        document.getElementById('gameId').value = gameId;
        // Only auto-load if we're on the matches tab
        const currentTab = urlParams.get('tab') || sessionStorage.getItem('godActiveTab');
        if (currentTab === 'matches') {
            setTimeout(() => loadGame(), 1000);
        }
    } else {
        // Don't set a default - leave it empty for user to select a tournament
        document.getElementById('gameId').value = '';
    }
    
    // Initialize the manual game display
    updateManualGameDisplay();
});

/**
 * Auto-save timer
 * Saves game state every 30 seconds if a game is loaded
 */
setInterval(() => {
    if (gameState?.initialized) {
        saveGameState();
    }
}, 30000);
// In god-scripts.js or inline in god.html

let currentTemplate = null;
let matchTemplates = [];

async function loadMatchTemplates() {
    try {
        const gameDoc = await db.collection('games').doc(currentGameId).get();
        if (!gameDoc.exists) return;
        
        const data = gameDoc.data();
        matchTemplates = data.matches || [];
        
        // Find next template
        currentTemplate = matchTemplates.find(m => m.status === 'template');
        
        if (currentTemplate) {
            displayTemplate(currentTemplate);
        } else {
            document.getElementById('templateDisplay').innerHTML = `
                <div style="text-align: center; padding: 40px; color: #94a3b8;">
                    <h3>No templates remaining</h3>
                    <p>All matches have been planned or completed</p>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading templates:', error);
        showStatus('Error loading templates', 'error');
    }
}

function displayTemplate(template) {
    const container = document.getElementById('templateDisplay');
    
    const subMatch = template.subMatch ? ` (${template.subMatch})` : '';
    
    container.innerHTML = `
        <div style="background: rgba(255, 215, 0, 0.1); padding: 20px; border-radius: 10px; border: 2px solid #ffd700;">
            <h3 style="color: #ffd700; margin-bottom: 15px;">
                ${template.gameIcon} Round ${template.round}${subMatch}: ${template.game} (${template.format})
            </h3>
            <p style="color: #94a3b8; margin-bottom: 10px;">Template #${template.id} - Game Sequence #${template.gameSequence}</p>
            
            ${template.suggestedPlayers?.note ? `
                <div style="background: rgba(6, 182, 212, 0.1); padding: 10px; border-radius: 5px; margin-bottom: 15px;">
                    <strong>Suggestion:</strong> ${template.suggestedPlayers.note}
                </div>
            ` : ''}
            
            <div style="margin: 20px 0;">
                <h4 style="color: #3b82f6; margin-bottom: 10px;">TEAM A (${template.teamA.requiredPlayers} players needed)</h4>
                <div id="suggestedTeamA" style="background: rgba(59, 130, 246, 0.1); padding: 10px; border-radius: 5px; min-height: 60px;">
                    ${displaySuggestedPlayers(template.suggestedPlayers?.teamA || [])}
                </div>
            </div>
            
            <div style="margin: 20px 0;">
                <h4 style="color: #ef4444; margin-bottom: 10px;">TEAM B (${template.teamB.requiredPlayers} players needed)</h4>
                <div id="suggestedTeamB" style="background: rgba(239, 68, 68, 0.1); padding: 10px; border-radius: 5px; min-height: 60px;">
                    ${displaySuggestedPlayers(template.suggestedPlayers?.teamB || [])}
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn primary" onclick="confirmTemplateSuggestion()">
                    ✅ Confirm as Suggested
                </button>
                <button class="btn" onclick="openCustomAssignment()">
                    ✏️ Modify Players
                </button>
                <button class="btn btn-secondary" onclick="skipTemplate()">
                    ⏭️ Skip This Match
                </button>
            </div>
        </div>
    `;
}

function displaySuggestedPlayers(players) {
    if (!players || players.length === 0) {
        return '<span style="opacity: 0.6;">No players suggested</span>';
    }
    
    return players.map(p => {
        const splitBadge = p.split ? '<span style="background: #ffd700; color: black; padding: 2px 6px; border-radius: 3px; font-size: 0.8rem; margin-left: 5px;">SPLIT</span>' : '';
        return `
            <div style="display: inline-block; padding: 8px 12px; margin: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 6px; border-left: 3px solid ${p.teamColor || '#666'};">
                ${p.name} <span style="opacity: 0.7; font-size: 0.85rem;">(${p.teamName})</span>${splitBadge}
            </div>
        `;
    }).join('');
}

async function confirmTemplateSuggestion() {
    if (!currentTemplate) return;
    
    try {
        // Convert suggested players to actual assignment
        const actualPlayers = {
            teamA: currentTemplate.suggestedPlayers?.teamA || [],
            teamB: currentTemplate.suggestedPlayers?.teamB || []
        };
        
        await confirmMatchPlanning(actualPlayers);
        
    } catch (error) {
        console.error('Error confirming template:', error);
        showStatus('Error confirming match', 'error');
    }
}

async function confirmMatchPlanning(actualPlayers) {
    if (!currentTemplate) return;
    
    // Update match status and save actual players
    const updatedMatch = {
        ...currentTemplate,
        status: 'planned',
        actualPlayers: actualPlayers,
        teamA: {
            ...currentTemplate.teamA,
            players: actualPlayers.teamA
        },
        teamB: {
            ...currentTemplate.teamB,
            players: actualPlayers.teamB
        },
        plannedAt: new Date().toISOString()
    };
    
    // Update in Firebase
    const gameDoc = await db.collection('games').doc(currentGameId).get();
    const data = gameDoc.data();
    const matches = data.matches || [];
    
    const matchIndex = matches.findIndex(m => m.id === currentTemplate.id);
    if (matchIndex >= 0) {
        matches[matchIndex] = updatedMatch;
        
        await db.collection('games').doc(currentGameId).update({
            matches: matches
        });
        
        showStatus(`Match #${currentTemplate.id} confirmed and added to queue`, 'success');
        
        // Add to game queue display
        addToGameQueue(updatedMatch);
        
        // Load next template
        loadMatchTemplates();
    }
}

function openCustomAssignment() {
    // Switch to existing manual assignment UI
    // Pre-populate with suggested players
    if (currentTemplate?.suggestedPlayers) {
        populateManualAssignment(currentTemplate.suggestedPlayers);
    }
    
    // Show the existing drag-and-drop interface
    document.getElementById('planTab').scrollIntoView({ behavior: 'smooth' });
}

function skipTemplate() {
    if (confirm('Skip this template? It will remain as a template and can be planned later.')) {
        loadMatchTemplates(); // Load next one
    }
}

function addToGameQueue(match) {
    // Add to the queue display (existing functionality)
    const queue = document.getElementById('gameQueue');
    const queueItem = document.createElement('div');
    queueItem.className = 'queued-game ready';
    queueItem.innerHTML = `
        <strong>${match.game} (${match.format})</strong><br>
        Round ${match.round} - Match #${match.id}<br>
        <span style="font-size: 0.85rem; opacity: 0.8;">
            ${match.teamA.players.length}v${match.teamB.players.length} - Ready to play
        </span>
    `;
    queueItem.onclick = () => loadQueuedGameForResult(match.id);
    queue.appendChild(queueItem);

    updateQueueCount();
}

// =============================================================================
// SECTION 13: TOURNAMENT MANAGEMENT
// =============================================================================
// ⚠️ MIGRATED TO tournament-manager.js
// All tournament CRUD operations are now handled by the TournamentManager class
// Access via: window.tournamentManager
//
// The functions below are WRAPPER FUNCTIONS that delegate to tournamentManager
// This maintains backward compatibility with existing code

// Sync local variables with tournament manager
function syncTournamentData() {
    if (window.tournamentManager) {
        allTournaments = window.tournamentManager.getAllTournaments();
        filteredTournaments = window.tournamentManager.getFilteredTournaments();
        editingTournament = window.tournamentManager.editingTournament;
    }
}

/**
 * Load all tournaments - delegates to TournamentManager
 */
async function loadAllTournaments() {
    const result = await window.tournamentManager.loadAllTournaments();
    syncTournamentData();
    return result;
}

/**
 * Update tournament statistics - delegates to TournamentManager
 */
function updateTournamentStats() {
    window.tournamentManager.updateTournamentStats();
}

/**
 * Filter tournaments - delegates to TournamentManager
 */
function filterTournaments() {
    window.tournamentManager.filterTournaments();
    syncTournamentData();
}

/**
 * Render tournament list - delegates to TournamentManager
 */
function renderTournamentList() {
    window.tournamentManager.renderTournamentList();
}

/**
 * Load tournament by ID - delegates to TournamentManager
 */
async function loadTournamentById(tournamentId) {
    await window.tournamentManager.loadTournamentById(tournamentId);
}

/**
 * Edit tournament - delegates to TournamentManager
 */
function editTournament(tournamentId) {
    window.tournamentManager.editTournament(tournamentId);
    syncTournamentData();
}

/**
 * Render teams list for editing - delegates to TournamentManager
 */
function renderEditTeamsList(teams) {
    return window.tournamentManager.renderEditTeamsList(teams);
}

/**
 * Save tournament edits - delegates to TournamentManager
 */
async function saveTournamentEdits() {
    await window.tournamentManager.saveTournamentEdits();
    syncTournamentData();
}

/**
 * Close edit modal - delegates to TournamentManager
 */
function closeEditModal() {
    window.tournamentManager.closeEditModal();
    syncTournamentData();
}

/**
 * Show tournament context menu - delegates to TournamentManager
 */
function showTournamentMenu(tournamentId) {
    window.tournamentManager.showTournamentMenu(tournamentId);
}

/**
 * Duplicate tournament - delegates to TournamentManager
 */
async function duplicateTournament(tournamentId) {
    await window.tournamentManager.duplicateTournament(tournamentId);
    syncTournamentData();
}

/**
 * Archive tournament - delegates to TournamentManager
 */
async function archiveTournament(tournamentId) {
    await window.tournamentManager.archiveTournament(tournamentId);
    syncTournamentData();
}

/**
 * Delete tournament - delegates to TournamentManager
 */
async function deleteTournament(tournamentId) {
    await window.tournamentManager.deleteTournament(tournamentId);
    syncTournamentData();
}

/**
 * Create new tournament - delegates to TournamentManager
 */
function createNewTournament() {
    window.tournamentManager.createNewTournament();
}

/**
 * Quick create tournament - delegates to TournamentManager
 */
async function quickCreateTournament() {
    await window.tournamentManager.quickCreateTournament();
    syncTournamentData();
}

// =============================================================================
// SECTION 14: USER APPOINTMENT SYSTEM
// =============================================================================
// ⚠️ MIGRATED TO user-management.js
// All user appointment functions (assign/unassign users to teams) are now in user-management.js
//
// Functions available globally:
// - loadUnassignedUsers()
// - renderUnassignedUsers()
// - handleUserDragStart()
// - renderTeamAssignmentSlots()
// - handleUserDrop()
// - removeUserAppointment()
// - saveUserAppointments()
// - unassignUserFromTeam()
//
// These functions are called from god.html and work with global gameState

/**
 * Load a tournament into gameState for user appointment
 * This is separate from loadGame() which loads matches
 * Uses TournamentManager to load the data
 */
async function loadTournamentForAppointment(tournamentId) {
    try {
        // Use TournamentManager to load tournament
        const tournamentData = await window.tournamentManager.loadTournamentForAppointment(tournamentId);

        if (!tournamentData) return;

        // Set global gameState
        gameState = tournamentData;

        // Render the team assignment slots
        renderTeamAssignmentSlots();

        // Render tournament roster overview
        renderTournamentRoster();

        // Auto-load unassigned users
        await loadUnassignedUsers();

    } catch (error) {
        console.error('[User Appointment] Error loading tournament:', error);
        showStatus('Error loading tournament: ' + error.message, 'error');
    }
}

/**
 * Render tournament roster overview - shows all teams and their players
 */
function renderTournamentRoster() {
    const container = document.getElementById('tournamentRosterDisplay');

    if (!gameState || !gameState.teams) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5; grid-column: 1 / -1;">Load a tournament to see roster</p>';
        return;
    }

    container.innerHTML = gameState.teams.map(team => {
        const filledSlots = team.players.filter(p => p.name && p.uid).length;
        const totalSlots = team.players.length;
        const isFullyStaffed = filledSlots === totalSlots;

        return `
            <div style="background: rgba(51, 65, 85, 0.3); padding: 15px; border-radius: 10px; border-left: 4px solid ${getTeamColor(team.id)};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; color: #ffd700; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;"
                        class="editable-team-name-roster"
                        data-team-id="${team.id}"
                        onclick="makeTeamNameEditableRoster(this)"
                        onmouseover="this.style.background='rgba(255, 215, 0, 0.1)'"
                        onmouseout="this.style.background='transparent'"
                        title="Click to edit team name">
                        ${team.name}
                    </h4>
                    <span style="font-size: 0.85rem; ${isFullyStaffed ? 'color: #10b981;' : 'color: #f59e0b;'}">
                        ${filledSlots}/${totalSlots} ${isFullyStaffed ? '✓' : '⚠️'}
                    </span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${team.players.map((player, idx) => {
                        if (player.name && player.uid) {
                            const pointsContributed = player.pointsContributed || 0;
                            const matchesCount = (player.matchesParticipated || []).length;
                            const isActive = player.active !== false; // Default to true if not specified

                            return `
                                <div style="background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 5px; border-left: 3px solid #10b981; ${!isActive ? 'opacity: 0.6;' : ''}">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                                        <div style="flex: 1;">
                                            <div style="font-weight: 600; font-size: 0.9rem;">
                                                <span style="cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.2s; display: inline-block;"
                                                      class="editable-player-name-roster"
                                                      data-team-id="${team.id}"
                                                      data-player-index="${idx}"
                                                      onclick="makePlayerNameEditableRoster(this)"
                                                      onmouseover="this.style.background='rgba(16, 185, 129, 0.2)'"
                                                      onmouseout="this.style.background='transparent'"
                                                      title="Click to edit player nickname">
                                                    ${player.name}
                                                </span>
                                                ${!isActive ? '<span style="color: #f59e0b; font-size: 0.7rem; margin-left: 5px;">(Inactive)</span>' : ''}
                                            </div>
                                            <div style="font-size: 0.75rem; opacity: 0.8;">${player.email || 'No email'}</div>
                                            <div style="font-size: 0.75rem; margin-top: 4px; display: flex; gap: 12px;">
                                                <span style="color: #10b981;">
                                                    <strong>${pointsContributed.toFixed(1)}</strong> pts
                                                </span>
                                                <span style="opacity: 0.7;">
                                                    ${matchesCount} match${matchesCount !== 1 ? 'es' : ''}
                                                </span>
                                            </div>
                                        </div>
                                        <button onclick="unassignUserFromTeam(${team.id}, ${idx})"
                                                style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.8rem; white-space: nowrap;"
                                                title="Remove ${player.name} from this team">
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            `;
                        } else {
                            return `
                                <div style="background: rgba(71, 85, 105, 0.2); padding: 8px; border-radius: 5px; border-left: 3px solid #475569;">
                                    <div style="font-style: italic; opacity: 0.5; font-size: 0.9rem;">Empty slot ${idx + 1}</div>
                                </div>
                            `;
                        }
                    }).join('')}
                </div>
                ${team.formerPlayers && team.formerPlayers.length > 0 ? `
                    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.2);">
                        <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 8px; opacity: 0.7;">Former Players</div>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            ${team.formerPlayers.map(former => `
                                <div style="background: rgba(71, 85, 105, 0.2); padding: 6px; border-radius: 4px; font-size: 0.75rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-weight: 500;">${former.name}</span>
                                        <span style="color: #fbbf24;">
                                            <strong>${(former.pointsContributed || 0).toFixed(1)}</strong> pts
                                        </span>
                                    </div>
                                    <div style="opacity: 0.6; margin-top: 2px;">
                                        ${(former.matchesParticipated || []).length} match${(former.matchesParticipated || []).length !== 1 ? 'es' : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; opacity: 0.8;">
                        <span>Points: ${team.points || 0}</span>
                        <span>Wins: ${team.wins || 0}</span>
                        <span>Losses: ${team.losses || 0}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// NOTE: User appointment functions (loadUnassignedUsers, renderUnassignedUsers, etc.)
// are now defined in user-management.js and available globally

// =============================================================================
// SECTION 15: MATCH RESULT CONFIRMATION & PLAYER CONTRIBUTION TRACKING
// =============================================================================

/**
 * Confirm match result and award points to winning team
 * Tracks player contributions and supports undo/redo
 *
 * @param {string} matchId - The match identifier
 * @param {number} winningTeamId - ID of the winning team
 * @param {number} pointsAwarded - Points to award to winning team
 * @param {boolean} isTeamSplit - True if team members played against each other
 */
async function confirmMatchResult(matchId, winningTeamId, pointsAwarded, isTeamSplit = false) {
    if (!gameState || !gameState.gameId) {
        showStatus('No tournament loaded', 'error');
        return false;
    }

    // Don't award points for split team matches
    if (isTeamSplit) {
        console.log('[Match Result] Split team match - no points awarded');
        showStatus('Split team match - no points awarded', 'warning');
        return false;
    }

    const team = gameState.teams.find(t => t.id === winningTeamId);
    if (!team) {
        showStatus('Team not found', 'error');
        return false;
    }

    try {
        // Get active players on the winning team
        const activePlayers = team.players.filter(p => p.active && p.uid);

        if (activePlayers.length === 0) {
            showStatus('No active players on winning team', 'error');
            return false;
        }

        // Calculate previous state (for undo)
        const previousTeamPoints = team.points || 0;
        const playerContributions = {};

        // Distribute points equally among active players
        const pointsPerPlayer = pointsAwarded / activePlayers.length;

        // Update team points
        team.points = previousTeamPoints + pointsAwarded;

        // Update player contributions
        activePlayers.forEach(player => {
            const previousPlayerPoints = player.pointsContributed || 0;
            player.pointsContributed = previousPlayerPoints + pointsPerPlayer;

            // Add match to player's history
            if (!player.matchesParticipated) player.matchesParticipated = [];
            player.matchesParticipated.push(matchId);

            // Record for action history
            playerContributions[player.uid] = {
                pointsBefore: previousPlayerPoints,
                pointsAfter: player.pointsContributed,
                pointsEarned: pointsPerPlayer
            };
        });

        // Record action for undo/redo
        if (typeof recordAction === 'function') {
            await recordAction(ACTION_TYPES.MATCH_RESULT, winningTeamId, {
                matchId,
                pointsAwarded,
                previousTeamPoints,
                newTeamPoints: team.points,
                playerContributions,
                participatingPlayers: activePlayers.map(p => ({
                    uid: p.uid,
                    name: p.name
                })),
                timestamp: new Date().toISOString()
            });
        }

        // Save tournament state
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(gameState.gameId);
        await tournamentRef.update({
            teams: gameState.teams,
            lastModified: new Date().toISOString()
        });

        // Update displays
        renderTournamentRoster();
        if (typeof checkWinCondition === 'function') {
            checkWinCondition();
        }

        showStatus(`${team.name} earned ${pointsAwarded} points!`, 'success');
        addLog(`🏆 ${team.name} won match and earned ${pointsAwarded} points (${pointsPerPlayer.toFixed(1)} per player)`, 'success');

        return true;

    } catch (error) {
        console.error('[Match Result] Error confirming result:', error);
        showStatus('Error confirming match result: ' + error.message, 'error');
        return false;
    }
}

/**
 * Helper function for drag-and-drop: allow drop
 */
function allowDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

/**
 * Helper function for drag-and-drop: drag leave
 */
function dragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

/**
 * Helper function for drag-and-drop: drag end
 */
function dragEnd(event) {
    event.target.classList.remove('dragging');
}

/**
 * Helper function: get team color by ID
 */
function getTeamColor(teamId) {
    const colors = [
        '#3b82f6', // blue
        '#ef4444', // red
        '#10b981', // green
        '#f59e0b', // amber
        '#8b5cf6', // purple
        '#ec4899', // pink
        '#14b8a6', // teal
        '#f97316'  // orange
    ];
    return colors[(teamId - 1) % colors.length] || '#6b7280';
}

// Auto-load tournaments when Firebase is ready
document.addEventListener('firebase-ready', function() {
    // Wait a bit for god-scripts to initialize
    setTimeout(loadAllTournaments, 1000);
});