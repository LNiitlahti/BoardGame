/**
 * Action History System
 * Handles undo/redo functionality with Firestore subcollections
 *
 * Architecture:
 * - Each action is stored in tournaments/{tid}/matches/{mid}/actions/{actionId}
 * - Audit logs stored in actionLog/{logId}
 * - Real-time listeners provide instant updates across all clients
 */

// Action types enum
const ACTION_TYPES = {
    PLACE_PLATE: 'PLACE_PLATE',
    CAPTURE_HEART: 'CAPTURE_HEART',
    USE_SPELL: 'USE_SPELL',
    END_TURN: 'END_TURN',
    START_TURN: 'START_TURN',
    MATCH_RESULT: 'MATCH_RESULT',
    MIGRATION: 'MIGRATION'
};

// Global state
let actionListenerUnsubscribe = null;

/**
 * Initialize action tracking system
 * Call this when loading a match
 */
function initializeActionSystem(tournamentId, matchId) {
    console.log('[ActionHistory] Initializing for tournament:', tournamentId, 'match:', matchId);

    // Set up real-time listener for actions
    setupActionListener(tournamentId, matchId);

    // Load recent actions
    loadRecentActions(tournamentId, matchId, 50);

    // Update UI
    updateUndoRedoButtons();
}

/**
 * Clean up action system
 * Call this when leaving god mode or switching games
 */
function cleanupActionSystem() {
    if (actionListenerUnsubscribe) {
        actionListenerUnsubscribe();
        actionListenerUnsubscribe = null;
    }
}

/**
 * Record a new action in Firestore subcollection
 * @param {string} type - Action type from ACTION_TYPES
 * @param {string} teamId - Team performing the action
 * @param {object} data - Action-specific data
 */
async function recordAction(type, teamId, data) {
    if (!gameState?.tournamentId || !gameState?.matchId) {
        console.error('[ActionHistory] No tournamentId or matchId in gameState');
        return;
    }

    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const db = firebase.firestore();

    const action = {
        id: actionId,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        type: type,
        teamId: teamId,
        teamName: getTeamName(teamId),
        data: data,
        round: gameState.currentRound || 0,
        turnNumber: gameState.turnNumber || 0,
        undone: false,
        undoneBy: null,
        undoneAt: null
    };

    try {
        // Write action to subcollection: tournaments/{tid}/matches/{mid}/actions/{aid}
        await db.collection('tournaments')
            .doc(gameState.tournamentId)
            .collection('matches')
            .doc(gameState.matchId)
            .collection('actions')
            .doc(actionId)
            .set(action);

        // Update currentActionIndex in match document
        await db.collection('tournaments')
            .doc(gameState.tournamentId)
            .collection('matches')
            .doc(gameState.matchId)
            .update({
                currentActionIndex: actionId,
                lastActionAt: firebase.firestore.FieldValue.serverTimestamp()
            });

        console.log('[ActionHistory] Recorded:', actionId, type);

        // Update local cache
        gameState.actions = gameState.actions || [];

        // Add timestamp as Date object for local use (server timestamp is null initially)
        action.timestamp = new Date();
        gameState.actions.push(action);
        gameState.currentActionIndex = actionId;

        updateUndoRedoButtons();

    } catch (error) {
        console.error('[ActionHistory] Error recording action:', error);
        throw error;
    }
}

/**
 * Load recent actions from Firestore
 * @param {string} tournamentId - Tournament ID
 * @param {string} matchId - Match ID
 * @param {number} limit - Number of actions to load (default: 50)
 */
async function loadRecentActions(tournamentId, matchId, limit = 50) {
    if (!tournamentId || !matchId) return [];

    const db = firebase.firestore();

    try {
        // Use server-side filtering with composite index for optimal performance
        const snapshot = await db.collection('tournaments')
            .doc(tournamentId)
            .collection('matches')
            .doc(matchId)
            .collection('actions')
            .where('undone', '==', false)
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        const actions = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Convert Firestore timestamp to JS Date
            if (data.timestamp?.toDate) {
                data.timestamp = data.timestamp.toDate();
            }
            actions.push(data);
        });

        // Reverse to get chronological order
        actions.reverse();

        // Cache in gameState
        gameState.actions = actions;

        console.log(`[ActionHistory] Loaded ${actions.length} recent actions`);

        // Update UI
        updateActionHistoryDisplay();

        return actions;

    } catch (error) {
        console.error('[ActionHistory] Error loading actions:', error);
        return [];
    }
}

/**
 * Set up real-time listener for actions
 * Provides instant updates when actions are added/modified
 */
function setupActionListener(tournamentId, matchId) {
    if (!tournamentId || !matchId) return;

    const db = firebase.firestore();

    // Clean up existing listener
    if (actionListenerUnsubscribe) {
        actionListenerUnsubscribe();
    }

    console.log('[ActionHistory] Setting up real-time listener');

    actionListenerUnsubscribe = db.collection('tournaments')
        .doc(tournamentId)
        .collection('matches')
        .doc(matchId)
        .collection('actions')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const action = change.doc.data();

                // Convert Firestore timestamp
                if (action.timestamp?.toDate) {
                    action.timestamp = action.timestamp.toDate();
                }

                if (change.type === 'added') {
                    console.log('[ActionHistory] New action detected:', action.type);

                    // Add to local cache if not already present
                    if (!gameState.actions) gameState.actions = [];
                    const exists = gameState.actions.some(a => a.id === action.id);
                    if (!exists && !action.undone) {
                        gameState.actions.push(action);
                    }

                    // Update UI
                    updateActionHistoryDisplay();
                    updateUndoRedoButtons();
                }

                if (change.type === 'modified') {
                    console.log('[ActionHistory] Action modified:', action.id);

                    if (action.undone) {
                        // Remove from local cache
                        gameState.actions = gameState.actions.filter(a => a.id !== action.id);

                        // Show notification if another admin undid it
                        const currentUserId = firebase.auth().currentUser?.uid;
                        if (action.undoneBy && action.undoneBy !== currentUserId) {
                            if (typeof errorHandler !== 'undefined') {
                                errorHandler.showWarning('⚠️ Another admin undid an action. Board updated.');
                            }
                        }
                    }

                    // Update UI
                    updateActionHistoryDisplay();
                    updateUndoRedoButtons();
                }
            });
        }, (error) => {
            console.error('[ActionHistory] Listener error:', error);
        });
}

/**
 * Undo the last action with audit trail
 * @param {string} reason - Optional reason for undo
 */
async function undoAction(reason = null) {
    if (!gameState?.tournamentId || !gameState?.matchId) {
        console.error('[ActionHistory] No tournamentId or matchId');
        return;
    }

    const currentActionId = gameState.currentActionIndex;
    if (!currentActionId) {
        if (typeof errorHandler !== 'undefined') {
            errorHandler.showWarning('Nothing to undo');
        }
        return;
    }

    const db = firebase.firestore();
    const currentUser = firebase.auth().currentUser;

    try {
        // Use Firestore transaction for consistency
        await db.runTransaction(async (transaction) => {
            const actionRef = db.collection('tournaments')
                .doc(gameState.tournamentId)
                .collection('matches')
                .doc(gameState.matchId)
                .collection('actions')
                .doc(currentActionId);

            const actionDoc = await transaction.get(actionRef);
            if (!actionDoc.exists) {
                throw new Error('Action not found');
            }

            const action = actionDoc.data();

            // Confirm critical actions
            if (action.type === ACTION_TYPES.MATCH_RESULT || action.type === ACTION_TYPES.END_TURN) {
                const confirmed = confirm(
                    `⚠️ WARNING: You are about to undo "${formatActionDescription(action)}"\n\n` +
                    `This will affect game state. Continue?`
                );
                if (!confirmed) {
                    throw new Error('Undo cancelled by user');
                }
            }

            // Mark action as undone
            transaction.update(actionRef, {
                undone: true,
                undoneBy: currentUser.uid,
                undoneByName: currentUser.displayName || 'Unknown',
                undoneAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Find previous non-undone action
            const previousActionsSnapshot = await db.collection('tournaments')
                .doc(gameState.tournamentId)
                .collection('matches')
                .doc(gameState.matchId)
                .collection('actions')
                .where('undone', '==', false)
                .orderBy('timestamp', 'desc')
                .limit(2) // Get 2 to skip the current one
                .get();

            // Find the previous action (skip current if it's in results)
            let previousActionId = null;
            for (const doc of previousActionsSnapshot.docs) {
                if (doc.id !== currentActionId) {
                    previousActionId = doc.id;
                    break;
                }
            }

            // Update match document's current action pointer
            const matchRef = db.collection('tournaments')
                .doc(gameState.tournamentId)
                .collection('matches')
                .doc(gameState.matchId);
            transaction.update(matchRef, {
                currentActionIndex: previousActionId,
                lastModifiedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Log the undo operation to audit log
            const logRef = db.collection('actionLog').doc();
            transaction.set(logRef, {
                tournamentId: gameState.tournamentId,
                matchId: gameState.matchId,
                actionId: currentActionId,
                operation: 'UNDO',
                performedBy: currentUser.uid,
                performedByName: currentUser.displayName || 'Unknown',
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                reason: reason,
                actionType: action.type,
                actionDescription: formatActionDescription(action)
            });

            // Apply reverse of the action
            await applyReverseAction(action);
        });

        console.log('[ActionHistory] Undo complete');

        // Reload game state to ensure consistency
        if (typeof loadGame === 'function') {
            await loadGame();
        }

        if (typeof errorHandler !== 'undefined') {
            errorHandler.showSuccess(`⬅️ Action undone successfully`);
        }

        updateUndoRedoButtons();

    } catch (error) {
        console.error('[ActionHistory] Undo error:', error);
        if (typeof errorHandler !== 'undefined' && !error.message.includes('cancelled')) {
            errorHandler.showError('Failed to undo: ' + error.message);
        }
    }
}

/**
 * Redo a previously undone action
 */
async function redoAction() {
    if (!gameState?.tournamentId || !gameState?.matchId) return;

    const db = firebase.firestore();
    const currentUser = firebase.auth().currentUser;

    try {
        // Find next undone action after current
        const currentActionId = gameState.currentActionIndex;

        let query = db.collection('tournaments')
            .doc(gameState.tournamentId)
            .collection('matches')
            .doc(gameState.matchId)
            .collection('actions')
            .where('undone', '==', true)
            .orderBy('timestamp', 'asc')
            .limit(1);

        if (currentActionId) {
            const currentActionDoc = await db.collection('tournaments')
                .doc(gameState.tournamentId)
                .collection('matches')
                .doc(gameState.matchId)
                .collection('actions')
                .doc(currentActionId)
                .get();

            if (currentActionDoc.exists) {
                const currentTimestamp = currentActionDoc.data().timestamp;
                query = query.where('timestamp', '>', currentTimestamp);
            }
        }

        const snapshot = await query.get();

        if (snapshot.empty) {
            if (typeof errorHandler !== 'undefined') {
                errorHandler.showWarning('Nothing to redo');
            }
            return;
        }

        const actionDoc = snapshot.docs[0];
        const action = actionDoc.data();

        // Use transaction to redo
        await db.runTransaction(async (transaction) => {
            // Mark action as not undone
            transaction.update(actionDoc.ref, {
                undone: false,
                undoneBy: null,
                undoneAt: null,
                undoneByName: null,
                redoneBy: currentUser.uid,
                redoneByName: currentUser.displayName || 'Unknown',
                redoneAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update match pointer
            transaction.update(
                db.collection('tournaments')
                    .doc(gameState.tournamentId)
                    .collection('matches')
                    .doc(gameState.matchId),
                {
                    currentActionIndex: action.id,
                    lastModifiedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            );

            // Log the redo
            const logRef = db.collection('actionLog').doc();
            transaction.set(logRef, {
                tournamentId: gameState.tournamentId,
                matchId: gameState.matchId,
                actionId: action.id,
                operation: 'REDO',
                performedBy: currentUser.uid,
                performedByName: currentUser.displayName || 'Unknown',
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                actionType: action.type,
                actionDescription: formatActionDescription(action)
            });

            // Reapply the action
            await applyAction(action);
        });

        console.log('[ActionHistory] Redo complete');

        // Reload game state
        if (typeof loadGame === 'function') {
            await loadGame();
        }

        if (typeof errorHandler !== 'undefined') {
            errorHandler.showSuccess(`➡️ Action redone successfully`);
        }

        updateUndoRedoButtons();

    } catch (error) {
        console.error('[ActionHistory] Redo error:', error);
        if (typeof errorHandler !== 'undefined') {
            errorHandler.showError('Failed to redo: ' + error.message);
        }
    }
}

/**
 * Apply reverse of an action (undo logic)
 */
async function applyReverseAction(action) {
    console.log('[ActionHistory] Applying reverse of:', action.type);

    switch (action.type) {
        case ACTION_TYPES.PLACE_PLATE:
            // Remove the plate from the hex
            if (gameState.board?.hexes && action.data?.hexId) {
                const hex = gameState.board.hexes[action.data.hexId];
                if (hex) {
                    hex.owner = action.data.previousOwner || null;
                    hex.plateColor = action.data.previousOwner
                        ? getTeamColor(action.data.previousOwner)
                        : null;

                    // Update board renderer if available
                    if (typeof boardRenderer !== 'undefined' && boardRenderer.updateHex) {
                        boardRenderer.updateHex(action.data.hexId);
                    }
                }
            }
            break;

        case ACTION_TYPES.CAPTURE_HEART:
            // Return heart to previous owner
            if (gameState.board?.hexes && action.data?.hexId) {
                const heartHex = gameState.board.hexes[action.data.hexId];
                if (heartHex) {
                    heartHex.owner = action.data.previousOwner || null;

                    if (typeof boardRenderer !== 'undefined' && boardRenderer.updateHex) {
                        boardRenderer.updateHex(action.data.hexId);
                    }
                }
            }
            break;

        case ACTION_TYPES.END_TURN:
            // Revert to previous team's turn
            if (gameState && action.teamId) {
                gameState.currentTeam = action.teamId;
            }
            break;

        case ACTION_TYPES.USE_SPELL:
            // Return spell card to team and reverse effect
            const team = gameState.teams?.find(t => t.id === action.teamId);
            if (team && action.data?.spellCard) {
                team.spellCards = team.spellCards || [];
                team.spellCards.push(action.data.spellCard);
            }

            // Reverse spell effects
            if (action.data?.spellEffects) {
                reverseSpellEffects(action.data.spellEffects, gameState);
            }

            // Remove from spell history
            if (gameState.spellHistory) {
                gameState.spellHistory = gameState.spellHistory.filter(
                    entry => entry.timestamp !== action.data?.timestamp
                );
            }
            break;

        case ACTION_TYPES.MATCH_RESULT:
            // Revert team points and player contributions
            const matchTeam = gameState.teams?.find(t => t.id === action.teamId);
            if (matchTeam && action.data) {
                // Revert team points
                if (action.data.previousTeamPoints !== undefined) {
                    matchTeam.points = action.data.previousTeamPoints;
                }

                // Revert player contributions
                if (action.data.playerContributions) {
                    for (const [uid, contribution] of Object.entries(action.data.playerContributions)) {
                        const player = matchTeam.players.find(p => p.uid === uid);
                        if (player) {
                            player.pointsContributed = contribution.pointsBefore;

                            // Remove match from player's history
                            if (player.matchesParticipated && action.data.matchId) {
                                player.matchesParticipated = player.matchesParticipated.filter(m => m !== action.data.matchId);
                            }
                        }
                    }
                }

                console.log(`[ActionHistory] Reverted match result: ${matchTeam.name} points ${matchTeam.points} (was ${action.data.newTeamPoints})`);
            }
            break;
    }

    // Update display
    if (typeof updateDisplay === 'function') {
        updateDisplay();
    }

    // Update roster display if available
    if (typeof renderTournamentRoster === 'function') {
        renderTournamentRoster();
    }
}

/**
 * Apply an action (redo logic)
 */
async function applyAction(action) {
    console.log('[ActionHistory] Applying action:', action.type);

    switch (action.type) {
        case ACTION_TYPES.PLACE_PLATE:
            if (gameState.board?.hexes && action.data?.hexId) {
                const hex = gameState.board.hexes[action.data.hexId];
                if (hex) {
                    hex.owner = action.teamId;
                    hex.plateColor = action.data.plateColor;

                    if (typeof boardRenderer !== 'undefined' && boardRenderer.updateHex) {
                        boardRenderer.updateHex(action.data.hexId);
                    }
                }
            }
            break;

        case ACTION_TYPES.CAPTURE_HEART:
            if (gameState.board?.hexes && action.data?.hexId) {
                const heartHex = gameState.board.hexes[action.data.hexId];
                if (heartHex) {
                    heartHex.owner = action.teamId;

                    if (typeof boardRenderer !== 'undefined' && boardRenderer.updateHex) {
                        boardRenderer.updateHex(action.data.hexId);
                    }
                }
            }
            break;

        case ACTION_TYPES.END_TURN:
            if (gameState && action.data?.newCurrentTeam) {
                gameState.currentTeam = action.data.newCurrentTeam;
            }
            break;

        case ACTION_TYPES.USE_SPELL:
            const redoTeam = gameState.teams?.find(t => t.id === action.teamId);
            if (redoTeam && action.data?.spellCard) {
                const spellIndex = redoTeam.spellCards?.findIndex(s => s.id === action.data.spellCard.id);
                if (spellIndex >= 0) {
                    redoTeam.spellCards.splice(spellIndex, 1);
                }
            }

            // Reapply spell effects
            if (action.data?.spellEffects) {
                applySpellEffects(action.data.spellEffects, gameState);
            }

            // Re-add to spell history
            if (action.data?.historyEntry) {
                gameState.spellHistory = gameState.spellHistory || [];
                gameState.spellHistory.push(action.data.historyEntry);
            }
            break;

        case ACTION_TYPES.MATCH_RESULT:
            // Reapply team points and player contributions
            const matchTeam = gameState.teams?.find(t => t.id === action.teamId);
            if (matchTeam && action.data) {
                // Reapply team points
                if (action.data.newTeamPoints !== undefined) {
                    matchTeam.points = action.data.newTeamPoints;
                }

                // Reapply player contributions
                if (action.data.playerContributions) {
                    for (const [uid, contribution] of Object.entries(action.data.playerContributions)) {
                        const player = matchTeam.players.find(p => p.uid === uid);
                        if (player) {
                            player.pointsContributed = contribution.pointsAfter;

                            // Re-add match to player's history
                            if (!player.matchesParticipated) player.matchesParticipated = [];
                            if (action.data.matchId && !player.matchesParticipated.includes(action.data.matchId)) {
                                player.matchesParticipated.push(action.data.matchId);
                            }
                        }
                    }
                }

                console.log(`[ActionHistory] Reapplied match result: ${matchTeam.name} points ${matchTeam.points} (was ${action.data.previousTeamPoints})`);
            }
            break;
    }

    // Update display
    if (typeof updateDisplay === 'function') {
        updateDisplay();
    }

    // Update roster display if available
    if (typeof renderTournamentRoster === 'function') {
        renderTournamentRoster();
    }
}

/**
 * Helper: Get team name by ID
 */
function getTeamName(teamId) {
    if (!teamId || !gameState?.teams) return 'Unknown';
    const team = gameState.teams.find(t => t.id === teamId);
    return team?.name || teamId;
}

/**
 * Helper: Get team color by ID
 */
function getTeamColor(teamId) {
    if (!teamId || !gameState?.teams) return null;
    const team = gameState.teams.find(t => t.id === teamId);
    return team?.color || null;
}

/**
 * Helper: Format action description for display
 */
function formatActionDescription(action) {
    if (!action) return 'Unknown action';

    const teamName = action.teamName || 'Unknown';

    switch (action.type) {
        case ACTION_TYPES.PLACE_PLATE:
            return `${teamName} placed plate at ${action.data?.hexId || 'unknown'}`;
        case ACTION_TYPES.CAPTURE_HEART:
            return `${teamName} captured ${action.data?.heartType || ''} heart`;
        case ACTION_TYPES.USE_SPELL:
            return `${teamName} used spell: ${action.data?.spellCard?.name || 'unknown'}`;
        case ACTION_TYPES.END_TURN:
            return `${teamName} ended turn`;
        case ACTION_TYPES.START_TURN:
            return `${teamName} started turn`;
        case ACTION_TYPES.MATCH_RESULT:
            return `Match result: ${teamName} won`;
        default:
            return `${teamName} performed ${action.type}`;
    }
}

/**
 * Check if undo is available
 */
function canUndo() {
    return gameState?.currentActionIndex != null;
}

/**
 * Check if redo is available
 */
function canRedo() {
    // Check if there are any undone actions after current
    if (!gameState?.tournamentId || !gameState?.matchId) return false;

    // This is a simplified check - actual redo availability is checked when button is clicked
    return true;
}

/**
 * Update undo/redo button states
 */
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const statusSpan = document.getElementById('actionHistoryStatus');

    if (undoBtn) {
        undoBtn.disabled = !canUndo();
    }

    if (redoBtn) {
        // Redo button state will be updated when clicked
        // For now, keep it enabled if there's a game loaded
        redoBtn.disabled = !gameState?.gameId;
    }

    if (statusSpan && gameState?.actions) {
        const total = gameState.actions.length;
        const current = gameState.actions.findIndex(a => a.id === gameState.currentActionIndex) + 1;
        statusSpan.textContent = total > 0 ? `Action ${current || total} of ${total}` : 'No actions yet';
    }
}

/**
 * Update action history display panel
 */
function updateActionHistoryDisplay() {
    const panel = document.getElementById('actionHistoryPanel');
    if (!panel) return;

    const actions = gameState?.actions || [];

    if (actions.length === 0) {
        panel.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 20px;">No actions yet</p>';
        return;
    }

    // Show last 20 actions (most recent first)
    const recentActions = actions.slice(-20).reverse();

    panel.innerHTML = recentActions.map(action => {
        const time = action.timestamp instanceof Date
            ? action.timestamp.toLocaleTimeString()
            : 'Unknown time';

        return `
            <div class="action-item" style="padding: 10px; margin-bottom: 5px; background: rgba(255, 255, 255, 0.05); border-radius: 5px; border-left: 3px solid ${action.undone ? '#ef4444' : '#10b981'};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="opacity: 0.7; font-size: 0.85rem;">${time}</span>
                        <div style="margin-top: 3px;">${formatActionDescription(action)}</div>
                    </div>
                    ${action.undone ? '<span style="color: #ef4444; font-size: 0.85rem;">UNDONE</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Toggle action history panel visibility
 */
function toggleActionHistory() {
    const panel = document.getElementById('actionHistoryPanel');
    const toggle = document.getElementById('actionHistoryToggle');

    if (panel && toggle) {
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        toggle.textContent = isVisible ? '▼' : '▲';
    }
}

/**
 * Reverse spell effects when undoing
 */
function reverseSpellEffects(effects, gameState) {
    if (!effects || !effects.changes) return;

    const changes = effects.changes;

    // Reverse point changes
    if (changes.pointsGained !== undefined && effects.teamId) {
        const team = gameState.teams?.find(t => t.id === effects.teamId);
        if (team) {
            team.points = (team.points || 0) - changes.pointsGained;
        }
    }

    // Restore destroyed tiles
    if (changes.destroyedTiles && Array.isArray(changes.destroyedTiles)) {
        for (const tile of changes.destroyedTiles) {
            if (tile.coord && tile.teamId) {
                gameState.board[tile.coord] = { teamId: tile.teamId };
            }
        }
    }

    // Remove active effects
    if (effects.teamId) {
        const team = gameState.teams?.find(t => t.id === effects.teamId);
        if (team && team.activeEffects) {
            team.activeEffects = team.activeEffects.filter(
                effect => effect.spellId !== effects.spellId
            );
        }
    }

    console.log('[ActionHistory] Reversed spell effects:', effects.spellId);
}

/**
 * Apply spell effects when redoing
 */
function applySpellEffects(effects, gameState) {
    if (!effects || !effects.changes) return;

    const changes = effects.changes;

    // Reapply point changes
    if (changes.pointsGained !== undefined && effects.teamId) {
        const team = gameState.teams?.find(t => t.id === effects.teamId);
        if (team) {
            team.points = (team.points || 0) + changes.pointsGained;
        }
    }

    // Destroy tiles again
    if (changes.destroyedTiles && Array.isArray(changes.destroyedTiles)) {
        for (const tile of changes.destroyedTiles) {
            if (tile.coord && gameState.board) {
                delete gameState.board[tile.coord];
            }
        }
    }

    // Restore active effects
    if (effects.activeEffect) {
        const team = gameState.teams?.find(t => t.id === effects.teamId);
        if (team) {
            team.activeEffects = team.activeEffects || [];
            team.activeEffects.push(effects.activeEffect);
        }
    }

    console.log('[ActionHistory] Reapplied spell effects:', effects.spellId);
}

// Export functions for global use
if (typeof window !== 'undefined') {
    window.ACTION_TYPES = ACTION_TYPES;
    window.initializeActionSystem = initializeActionSystem;
    window.cleanupActionSystem = cleanupActionSystem;
    window.recordAction = recordAction;
    window.undoAction = undoAction;
    window.redoAction = redoAction;
    window.updateUndoRedoButtons = updateUndoRedoButtons;
    window.updateActionHistoryDisplay = updateActionHistoryDisplay;
    window.toggleActionHistory = toggleActionHistory;
}

console.log('[ActionHistory] Module loaded');
