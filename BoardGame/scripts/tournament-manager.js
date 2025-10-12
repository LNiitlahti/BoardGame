/**
 * =============================================================================
 * TOURNAMENT-MANAGER.JS
 * Handles tournament CRUD operations and management
 * =============================================================================
 *
 * Extracted from god-scripts.js to improve modularity and maintainability.
 *
 * RESPONSIBILITIES:
 * - Loading tournaments from Firebase
 * - Creating, editing, duplicating, archiving, deleting tournaments
 * - Tournament list rendering and filtering
 * - Tournament statistics
 *
 * DEPENDENCIES:
 * - Firebase (window.firebaseDB, window.firebaseDoc, etc.)
 * - UI functions: showStatus(), addLog() (from god-scripts.js)
 *
 * =============================================================================
 */

class TournamentManager {
    constructor() {
        // Tournament data state
        this.allTournaments = [];
        this.filteredTournaments = [];
        this.editingTournament = null;

        console.log('[TournamentManager] Initialized');
    }

    // =============================================================================
    // LOADING & RETRIEVAL
    // =============================================================================

    /**
     * Load all tournaments from Firebase
     * Loads from 'tournaments' collection
     * @returns {Promise<Array>} Array of tournament objects
     */
    async loadAllTournaments() {
        try {
            console.log('[TournamentManager] Loading tournaments from "tournaments" collection...');

            const snapshot = await window.firebaseDB.collection('tournaments').get();

            console.log('[TournamentManager] Snapshot received. Size:', snapshot.size);
            console.log('[TournamentManager] Empty?', snapshot.empty);

            this.allTournaments = [];
            snapshot.forEach(doc => {
                console.log('[TournamentManager] Found tournament:', doc.id, doc.data());
                this.allTournaments.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            // Sort by created date (newest first)
            this.allTournaments.sort((a, b) => {
                const dateA = new Date(a.createdAt || 0);
                const dateB = new Date(b.createdAt || 0);
                return dateB - dateA;
            });

            this.updateTournamentStats();
            this.filterTournaments();

            if (this.allTournaments.length === 0) {
                showStatus('No tournaments found. Click "➕ Create New" to create one.', 'warning');
            } else {
                showStatus(`Loaded ${this.allTournaments.length} tournaments`, 'success');
            }
            console.log('[TournamentManager] All tournaments loaded:', this.allTournaments);

            return this.allTournaments;

        } catch (error) {
            console.error('[TournamentManager] Error loading tournaments:', error);
            showStatus('Error loading tournaments: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Load a specific tournament by ID
     * @param {string} tournamentId - Tournament ID to load
     * @returns {Promise<void>}
     */
    async loadTournamentById(tournamentId) {
        console.log('[TournamentManager] Loading tournament:', tournamentId);

        // Set the gameId input
        const gameIdInput = document.getElementById('gameId');
        if (gameIdInput) {
            gameIdInput.value = tournamentId;
        }

        // Store in sessionStorage for persistence
        sessionStorage.setItem('godSelectedTournament', tournamentId);

        // Update tournament indicator in header
        if (typeof updateTournamentIndicator === 'function') {
            updateTournamentIndicator(tournamentId);
        }

        // Update URL to include tournament parameter
        const url = new URL(window.location);
        url.searchParams.set('tournament', tournamentId);
        window.history.replaceState({}, '', url);

        // Load the game state (works for all tabs)
        if (typeof loadGame === 'function') {
            await loadGame();
        }

        // Switch to the current tab to refresh the view
        const currentTab = new URLSearchParams(window.location.search).get('tab') || 'matches';
        if (typeof switchGodTab === 'function') {
            switchGodTab(currentTab);
        }
    }

    /**
     * Load tournament for user appointment (Teams tab)
     * @param {string} tournamentId - Tournament ID
     * @returns {Promise<Object>} Tournament data
     */
    async loadTournamentForAppointment(tournamentId) {
        try {
            const docRef = window.firebaseDB.collection('tournaments').doc(tournamentId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                showStatus('Tournament not found', 'error');
                console.error('[TournamentManager] Tournament not found:', tournamentId);
                return null;
            }

            const tournamentData = docSnap.data();

            showStatus(`Tournament "${tournamentId}" loaded`, 'success');
            console.log('[TournamentManager] Loaded tournament for appointment:', tournamentId, tournamentData);

            return {
                gameId: tournamentId,
                tournamentId: tournamentId,
                ...tournamentData
            };

        } catch (error) {
            console.error('[TournamentManager] Error loading tournament:', error);
            showStatus('Error loading tournament: ' + error.message, 'error');
            throw error;
        }
    }

    // =============================================================================
    // FILTERING & STATISTICS
    // =============================================================================

    /**
     * Update tournament statistics display
     */
    updateTournamentStats() {
        const total = this.allTournaments.length;
        const active = this.allTournaments.filter(t => t.status === 'playing').length;
        const finished = this.allTournaments.filter(t => t.status === 'finished').length;

        const totalEl = document.getElementById('totalTournaments');
        const activeEl = document.getElementById('activeTournaments');
        const finishedEl = document.getElementById('finishedTournaments');

        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = active;
        if (finishedEl) finishedEl.textContent = finished;
    }

    /**
     * Filter tournaments based on search and status
     */
    filterTournaments() {
        const searchInput = document.getElementById('tournamentSearch');
        const statusFilter = document.getElementById('statusFilter');

        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const statusValue = statusFilter ? statusFilter.value : 'all';

        this.filteredTournaments = this.allTournaments.filter(tournament => {
            // Search filter
            const matchesSearch = !searchTerm ||
                tournament.gameId?.toLowerCase().includes(searchTerm) ||
                tournament.id?.toLowerCase().includes(searchTerm);

            // Status filter
            const matchesStatus = statusValue === 'all' || tournament.status === statusValue;

            return matchesSearch && matchesStatus;
        });

        this.renderTournamentList();
    }

    /**
     * Render tournament list to the UI
     */
    renderTournamentList() {
        const container = document.getElementById('tournamentList');
        if (!container) return;

        if (this.filteredTournaments.length === 0) {
            container.innerHTML = `
                <p style="text-align: center; opacity: 0.7; padding: 40px 20px;">
                    No tournaments found
                </p>
            `;
            return;
        }

        container.innerHTML = this.filteredTournaments.map(tournament => {
            const statusClass = tournament.status || 'setup';
            const statusEmoji = {
                'setup': '⚙️',
                'playing': '🎮',
                'finished': '🏆',
                'archived': '📦'
            }[statusClass] || '📋';

            return `
                <div class="tournament-card ${statusClass}">
                    <div class="tournament-title">
                        ${statusEmoji} ${tournament.gameId || tournament.id}
                    </div>
                    <div class="tournament-meta">
                        Status: ${tournament.status || 'Unknown'} |
                        Teams: ${tournament.teams?.length || 0} |
                        Round: ${tournament.currentRound || 0}/${tournament.matches?.length || 0}
                    </div>
                    <div class="tournament-actions">
                        <button class="btn-load" onclick="tournamentManager.loadTournamentById('${tournament.id}')">
                            📂 Load
                        </button>
                        <button class="btn-view" onclick="window.location.href='view.html?tournament=${tournament.id}'">
                            👁️ View
                        </button>
                        <button class="btn-edit" onclick="tournamentManager.editTournament('${tournament.id}')">
                            ✏️ Edit
                        </button>
                        <button class="btn-more" onclick="tournamentManager.showTournamentMenu('${tournament.id}')">
                            ⋮ More
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =============================================================================
    // CRUD OPERATIONS
    // =============================================================================

    /**
     * Create a new tournament
     */
    createNewTournament() {
        const choice = confirm('Create new tournament?\n\nOK = Quick Create (simple)\nCancel = Full Setup Wizard');

        if (choice) {
            this.quickCreateTournament();
        } else {
            window.location.href = 'setup.html';
        }
    }

    /**
     * Quick create tournament with minimal setup
     */
    async quickCreateTournament() {
        const gameId = prompt('Enter tournament ID:', `tournament-${new Date().toISOString().slice(0,10)}`);
        if (!gameId) return;

        try {
            const docRef = window.firebaseDoc(window.firebaseDB, 'tournaments', gameId);
            const exists = await window.firebaseGetDoc(docRef);
            if (exists.exists()) {
                showStatus('Tournament with this ID already exists', 'error');
                return;
            }

            const winCondition = prompt('Win condition (points):', '50');

            const tournamentData = {
                gameId,
                teams: [],
                matches: [],
                selectedGames: [],
                winCondition: parseInt(winCondition) || 50,
                createdAt: new Date().toISOString(),
                status: 'setup',
                board: {},
                heartHexes: ['q2r-4', 'q4r-2', 'q2r2', 'q-2r4', 'q-4r2', 'q-2r-2'],
                heartHexControl: {},
                currentRound: 0,
                gamesPlayed: 0,
                gameHistory: [],
                currentTurn: null
            };

            await window.firebaseSetDoc(docRef, tournamentData);
            showStatus(`Tournament "${gameId}" created! Now add teams.`, 'success');
            console.log('[TournamentManager] Created tournament:', gameId);

            await this.loadAllTournaments();
            this.editTournament(gameId);

        } catch (error) {
            console.error('[TournamentManager] Error creating tournament:', error);
            showStatus('Error creating tournament', 'error');
        }
    }

    /**
     * Edit tournament
     * @param {string} tournamentId - Tournament ID to edit
     */
    editTournament(tournamentId) {
        this.editingTournament = this.allTournaments.find(t => t.id === tournamentId);

        if (!this.editingTournament) {
            showStatus('Tournament not found', 'error');
            return;
        }

        // Persist selected tournament
        sessionStorage.setItem('godSelectedTournament', tournamentId);
        console.log('[TournamentManager] Selected tournament for editing:', tournamentId);

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('tournament', tournamentId);
        window.history.replaceState({}, '', url);

        // Load tournament for user appointment in Teams tab
        if (typeof loadTournamentForAppointment === 'function') {
            loadTournamentForAppointment(tournamentId);
        }

        // Populate edit form
        const form = document.getElementById('editTournamentForm');
        if (!form) return;

        form.innerHTML = `
            <div class="form-group">
                <label>Tournament ID</label>
                <input type="text" id="editTournamentId" value="${this.editingTournament.gameId || this.editingTournament.id}" readonly style="background: rgba(255,255,255,0.05);">
            </div>

            <div class="form-group">
                <label>Status</label>
                <select id="editTournamentStatus" class="form-control">
                    <option value="setup" ${this.editingTournament.status === 'setup' ? 'selected' : ''}>Setup</option>
                    <option value="playing" ${this.editingTournament.status === 'playing' ? 'selected' : ''}>Playing</option>
                    <option value="finished" ${this.editingTournament.status === 'finished' ? 'selected' : ''}>Finished</option>
                    <option value="archived" ${this.editingTournament.status === 'archived' ? 'selected' : ''}>Archived</option>
                </select>
            </div>

            <div class="form-group">
                <label>Win Condition (Points)</label>
                <input type="number" id="editWinCondition" value="${this.editingTournament.winCondition || 50}" min="10" max="500" class="form-control">
            </div>

            <div class="form-group">
                <label>Teams (${this.editingTournament.teams?.length || 0})</label>
                <div id="editTeamsList" style="max-height: 200px; overflow-y: auto; background: rgba(15, 23, 42, 0.5); padding: 10px; border-radius: 8px;">
                    ${this.renderEditTeamsList(this.editingTournament.teams || [])}
                </div>
            </div>

            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn" onclick="tournamentManager.saveTournamentEdits()" style="flex: 1;">
                    💾 Save Changes
                </button>
                <button class="btn btn-secondary" onclick="tournamentManager.closeEditModal()" style="flex: 1;">
                    ❌ Cancel
                </button>
            </div>
        `;

        const modal = document.getElementById('editTournamentModal');
        if (modal) modal.style.display = 'flex';
    }

    /**
     * Render teams list for editing
     * @param {Array} teams - Teams array
     * @returns {string} HTML string
     */
    renderEditTeamsList(teams) {
        return teams.map((team, idx) => `
            <div style="background: rgba(51, 65, 85, 0.5); padding: 10px; margin-bottom: 8px; border-radius: 5px; border-left: 3px solid ${team.color || '#666'};">
                <input type="text" value="${team.name}"
                       onchange="tournamentManager.editingTournament.teams[${idx}].name = this.value"
                       style="width: 100%; background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; padding: 8px; border-radius: 5px; color: white; margin-bottom: 5px;">
                <div style="display: flex; gap: 5px;">
                    <input type="text" value="${team.players[0]?.name || ''}"
                           placeholder="Player 1"
                           onchange="tournamentManager.editingTournament.teams[${idx}].players[0].name = this.value"
                           style="flex: 1; background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; padding: 6px; border-radius: 5px; color: white; font-size: 0.9rem;">
                    <input type="text" value="${team.players[1]?.name || ''}"
                           placeholder="Player 2"
                           onchange="tournamentManager.editingTournament.teams[${idx}].players[1].name = this.value"
                           style="flex: 1; background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; padding: 6px; border-radius: 5px; color: white; font-size: 0.9rem;">
                </div>
            </div>
        `).join('');
    }

    /**
     * Save tournament edits
     */
    async saveTournamentEdits() {
        if (!this.editingTournament) return;

        try {
            const updates = {
                status: document.getElementById('editTournamentStatus').value,
                winCondition: parseInt(document.getElementById('editWinCondition').value),
                teams: this.editingTournament.teams,
                lastModified: new Date().toISOString()
            };

            const docRef = window.firebaseDoc(window.firebaseDB, 'tournaments', this.editingTournament.id);
            await window.firebaseSetDoc(docRef, { ...this.editingTournament, ...updates });

            showStatus('Tournament updated successfully!', 'success');
            this.closeEditModal();
            await this.loadAllTournaments();

        } catch (error) {
            console.error('[TournamentManager] Error saving tournament:', error);
            showStatus('Error saving tournament', 'error');
        }
    }

    /**
     * Close edit modal
     */
    closeEditModal() {
        const modal = document.getElementById('editTournamentModal');
        if (modal) modal.style.display = 'none';
        this.editingTournament = null;
    }

    /**
     * Duplicate tournament
     * @param {string} tournamentId - Tournament to duplicate
     */
    async duplicateTournament(tournamentId) {
        const tournament = this.allTournaments.find(t => t.id === tournamentId);
        if (!tournament) return;

        const newId = prompt('Enter new tournament ID:', `${tournament.gameId}-copy`);
        if (!newId) return;

        try {
            const duplicate = {
                ...tournament,
                gameId: newId,
                createdAt: new Date().toISOString(),
                status: 'setup',
                currentRound: 0,
                gamesPlayed: 0,
                gameHistory: [],
                board: {},
                currentTurn: null
            };

            const docRef = window.firebaseDoc(window.firebaseDB, 'games', newId);
            await window.firebaseSetDoc(docRef, duplicate);
            showStatus(`Tournament duplicated as "${newId}"`, 'success');
            await this.loadAllTournaments();

        } catch (error) {
            console.error('[TournamentManager] Error duplicating tournament:', error);
            showStatus('Error duplicating tournament', 'error');
        }
    }

    /**
     * Archive tournament
     * @param {string} tournamentId - Tournament to archive
     */
    async archiveTournament(tournamentId) {
        if (!confirm('Archive this tournament? It will be hidden but not deleted.')) return;

        try {
            const tournament = this.allTournaments.find(t => t.id === tournamentId);
            const updates = {
                ...tournament,
                status: 'archived',
                archivedAt: new Date().toISOString()
            };

            const docRef = window.firebaseDoc(window.firebaseDB, 'games', tournamentId);
            await window.firebaseSetDoc(docRef, updates);

            showStatus('Tournament archived', 'success');
            await this.loadAllTournaments();

        } catch (error) {
            console.error('[TournamentManager] Error archiving tournament:', error);
            showStatus('Error archiving tournament', 'error');
        }
    }

    /**
     * Delete tournament permanently
     * @param {string} tournamentId - Tournament to delete
     */
    async deleteTournament(tournamentId) {
        const tournament = this.allTournaments.find(t => t.id === tournamentId);
        if (!tournament) return;

        if (!confirm(`⚠️ PERMANENTLY DELETE "${tournament.gameId}"?\n\nThis cannot be undone!`)) return;

        const confirmation = prompt(`Type "${tournament.gameId}" to confirm deletion:`);
        if (confirmation !== tournament.gameId) {
            showStatus('Deletion cancelled - name did not match', 'warning');
            return;
        }

        try {
            await window.firebaseDB.collection('tournaments').doc(tournamentId).delete();
            showStatus('Tournament deleted permanently', 'success');
            console.log('[TournamentManager] Deleted tournament:', tournamentId);
            await this.loadAllTournaments();

        } catch (error) {
            console.error('[TournamentManager] Error deleting tournament:', error);
            showStatus('Error deleting tournament', 'error');
        }
    }

    /**
     * Show tournament context menu
     * @param {string} tournamentId - Tournament ID
     */
    showTournamentMenu(tournamentId) {
        const tournament = this.allTournaments.find(t => t.id === tournamentId);
        if (!tournament) return;

        const actions = [
            { label: '📋 Duplicate Tournament', action: () => this.duplicateTournament(tournamentId) },
            { label: '📦 Archive Tournament', action: () => this.archiveTournament(tournamentId) },
            { label: '🗑️ Delete Tournament', action: () => this.deleteTournament(tournamentId) }
        ];

        const menu = prompt(`Select action for "${tournament.gameId}":\n\n` +
            actions.map((a, i) => `${i + 1}. ${a.label}`).join('\n') +
            '\n\nEnter number (or cancel):');

        if (menu) {
            const idx = parseInt(menu) - 1;
            if (idx >= 0 && idx < actions.length) {
                actions[idx].action();
            }
        }
    }

    // =============================================================================
    // UTILITY METHODS
    // =============================================================================

    /**
     * Get all tournaments
     * @returns {Array} All tournaments
     */
    getAllTournaments() {
        return this.allTournaments;
    }

    /**
     * Get filtered tournaments
     * @returns {Array} Filtered tournaments
     */
    getFilteredTournaments() {
        return this.filteredTournaments;
    }

    /**
     * Get tournament by ID
     * @param {string} tournamentId - Tournament ID
     * @returns {Object|null} Tournament object or null
     */
    getTournamentById(tournamentId) {
        return this.allTournaments.find(t => t.id === tournamentId) || null;
    }
}

// Export as global singleton
if (typeof window !== 'undefined') {
    window.TournamentManager = TournamentManager;
    // Create global instance
    window.tournamentManager = new TournamentManager();
    console.log('[TournamentManager] Module loaded, instance created');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TournamentManager;
}
