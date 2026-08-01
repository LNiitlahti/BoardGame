/**
 * GodApp — Main Orchestrator
 *
 * Initializes all OOP managers via dependency injection, manages
 * Firebase real-time listener, tournament loading/saving, event
 * logging, and exposes all methods as window globals for HTML onclick.
 */

const TOURNAMENT_STATES = ['setup', 'playing', 'finished', 'archived'];

class GodApp {

    constructor() {
        this.gameState = {};
        this._activeListener = null;
        this._currentTournamentId = null;
        this._currentUser = null;
        this._currentUserRole = null;
        this._boardModule = null;
        this._boardRenderer = null;
        this._suppressLoadToast = false;
        this._allTournaments = [];
        this._prevRenderSignature = null;

        // Action logger (created in init)
        this.actionLogger = null;

        // Managers (created in init)
        this.ui = null;
        this.teams = null;
        this.phase = null;
        this.board = null;
        this.queue = null;
        this.creation = null;
        this.result = null;
        this.stats = null;
        this.spells = null;
    }

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    init() {
        const save = (triggerBtn) => this.saveGameState(triggerBtn);
        const refresh = () => this.updateDisplay();

        // Structured action logger
        this.actionLogger = new ActionLogger({
            getFirebaseDB: () => window.firebaseDB,
            getTournamentId: () => this._currentTournamentId,
            getCurrentUser: () => this._currentUser,
            getCurrentUserRole: () => this._currentUserRole,
            getGameState: () => this.gameState
        });

        const logAction = (actionType, category, payload, previousState) =>
            this.actionLogger?.logAction(actionType, category, payload, previousState);

        // Legacy shim — routes old logEvent calls through the structured logger
        const log = (type, data) => this.logEvent(type, data);

        this.ui = new UIManager();

        this.teams = new TeamManager(this.gameState, {
            uiManager: this.ui,
            saveCallback: save,
            logActionCallback: logAction,
            onDisplayRefresh: refresh
        });

        this.phase = new PhaseManager(this.gameState, {
            uiManager: this.ui,
            teamManager: this.teams,
            saveCallback: save,
            logActionCallback: logAction,
            onDisplayRefresh: refresh
        });

        const onPhaseChanged = () => this.phase?.recheckRequirements();

        this.board = new BoardManager(this.gameState, {
            boardModule: this._boardModule,
            boardRenderer: this._boardRenderer,
            uiManager: this.ui,
            teamManager: this.teams,
            saveCallback: save,
            logEventCallback: log,
            logActionCallback: logAction,
            deleteLastTileEventCallback: (coord) => this.deleteLastTileCaptureEvent(coord),
            clearPendingHexWinCallback: (teamId) => this.result?.clearPendingHexWin(teamId),
            onDisplayRefresh: refresh,
            onPhaseRequirementsChanged: onPhaseChanged
        });

        this.queue = new MatchQueueManager(this.gameState, {
            uiManager: this.ui,
            teamManager: this.teams,
            saveCallback: save,
            logEventCallback: log,
            logActionCallback: logAction,
            closeResultConfirm: () => this.result?.closeResultConfirm()
        });

        this.creation = new MatchCreationManager(this.gameState, {
            uiManager: this.ui,
            teamManager: this.teams,
            queueManager: this.queue,
            saveCallback: save,
            logActionCallback: logAction,
            onPhaseRequirementsChanged: onPhaseChanged
        });

        this.result = new ResultManager(this.gameState, {
            uiManager: this.ui,
            teamManager: this.teams,
            queueManager: this.queue,
            boardManager: this.board,
            saveCallback: save,
            logEventCallback: log,
            logActionCallback: logAction,
            onPhaseRequirementsChanged: onPhaseChanged
        });

        this.stats = new StatsManager(this.gameState, {
            boardModule: this._boardModule,
            uiManager: this.ui,
            teamManager: this.teams,
            saveCallback: save,
            logEventCallback: log,
            logActionCallback: logAction,
            onPhaseRequirementsChanged: onPhaseChanged
        });

        // BackupManager — tournament state backups (Phase 2)
        if (typeof BackupManager !== 'undefined') {
            this.backup = new BackupManager(this.gameState, {
                saveCallback: save,
                logActionCallback: logAction,
                uiManager: this.ui,
                refreshCallback: refresh
            });
        }

        // UndoManager — action reversal (Phase 2)
        if (typeof UndoManager !== 'undefined') {
            this.undo = new UndoManager(this.gameState, {
                actionLogger: this.actionLogger,
                uiManager: this.ui,
                teamManager: this.teams,
                saveCallback: save,
                logActionCallback: logAction,
                refreshCallback: refresh
            });
        }

        // SpellEngine — spell card management (Phase 1 Weeks 8-9)
        if (typeof SpellEngine !== 'undefined') {
            this.spells = new SpellEngine(this.gameState, {
                uiManager: this.ui,
                teamManager: this.teams,
                boardManager: this.board,
                saveCallback: save,
                logActionCallback: logAction,
                onPhaseRequirementsChanged: onPhaseChanged,
                onDisplayRefresh: refresh
            });
        }

        // Wire getPendingHexCount into PhaseManager (ResultManager must exist first)
        this.phase._getPendingHexCount = () => this.result?._pendingHexWins?.length || 0;

        // Migrate old phase names if tournament was mid-game with old flow
        if (this.phase.migratePhaseIfNeeded()) {
            this.saveGameState();
        }

        // ScoringCeremony — animated scoring sequence (Phase 3)
        if (typeof ScoringCeremony !== 'undefined') {
            this.ceremony = new ScoringCeremony(this.gameState, {
                saveCallback: (btn) => this.saveGameState(btn),
                logActionCallback: logAction,
                getActionLogEntries: async (round) => {
                    const result = await this.actionLogger.getActions({
                        roundNumber: round,
                        limit: 200
                    });
                    return result.entries || [];
                },
                onStepChanged: (step) => this._renderCeremonyStep(step),
                context: 'god'
            });
        }

        // Wire spell phase hooks into PhaseManager
        this.phase._onSpellPhaseEntered = () => this.spells?.beginSpellPhase();
        this.phase._onRoundStartSpells = () => {
            this.spells?.expireConditions();
            this.backup?.autoBackup();
        };

        // Wire hex territory points award when leaving scoring_hex
        this.phase._onAwardPoints = () => {
            const gs = this.gameState;
            const roundNumber = gs.currentPhase?.roundNumber || 0;
            const history = gs.pointsHistory || [];
            if (!history.some(e => e.round === roundNumber)) {
                const pointsAwarded = this.stats.awardRoundPoints();
                gs.pointsHistory = history;
                gs.pointsHistory.push({
                    round: roundNumber,
                    pointsAwarded: pointsAwarded,
                    timestamp: new Date().toISOString()
                });
                const msg = Object.entries(pointsAwarded)
                    .map(([team, pts]) => `${team}: +${pts}`)
                    .join(', ') || 'No points';
                this.ui.showStatus(`Round ${roundNumber} points: ${msg}`, 'success');
            }
        };

        // Wire scoring ceremony hook into PhaseManager
        this.phase._onScoringCeremony = async () => {
            if (!this.ceremony) return;
            const round = this.gameState.currentPhase?.roundNumber || 0;
            await this.ceremony.queueActions(round);
            this.ceremony.play();
        };

        // Wire room hex spell draw into BoardManager
        this.board._onRoomHexPlacement = (teamId, coord) => {
            if (this.spells) {
                const drawn = this.spells.drawSpell(teamId);
                if (drawn.length > 0) {
                    const names = drawn.map(id => {
                        const def = this.spells.getSpellDef(id);
                        return def?.nameEn || def?.name || id;
                    }).join(', ');
                    this.ui.showStatus(`Team drew spell: ${names}`, 'success');
                    this.saveGameState();
                }
            }
        };

        // Action export (Phase 4)
        if (typeof ActionExport !== 'undefined') {
            this._actionExport = new ActionExport({
                getFirebaseDB: () => window.firebaseDB,
                tournamentId: () => this._currentTournamentId
            });
        }

        // SeasonManager — tournament season grouping
        if (typeof SeasonManager !== 'undefined') {
            this.seasons = new SeasonManager({
                getFirebaseDB: () => window.firebaseDB,
                getCurrentUser: () => this._currentUser,
                getCurrentUserRole: () => this._currentUserRole,
                uiManager: this.ui
            });
        }

        // Wire window globals for HTML onclick handlers
        this._wireGlobalFunctions();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.board?.closeTeamPicker();
                this.result?.closeResultConfirm();
                this.teams?.closePlayerManager();
                this.teams?.closeSeatingOrder();
                this.stats?.closeNextRoundModal();
                this.result?.closeCorrectResultModal();
                this.undo?.closeUndoConfirmModal();
                this.creation?.closeAutoMatchModal();
                this.creation?.closeEditMatchModal();
                this.creation?.closeChallengeSetupModal();
                this.creation?.closeMassImport();
                this.creation?.closeGameManager();
                this.queue?.closeClearQueueModal();
                this.phase?.closeForceAdvanceModal();
            }
        });
    }

    initializeBoardModules() {
        this._boardModule = new BoardModule(1);

        const hexBoardContainer = document.getElementById('hexBoard');
        if (!hexBoardContainer) {
            console.warn('[GodApp] No hex board container found — skipping board init');
            return;
        }
        this._boardRenderer = new BoardRenderer(hexBoardContainer, this._boardModule, {
            responsive: true,
            showHeartImages: true
        });

        this._boardRenderer.render({});

        // Update managers with board references (may be null if called before init())
        if (this.ui) {
            this.ui.setBoardModules(this._boardModule, this._boardRenderer);
        }

        if (this.board) {
            this.board._boardModule = this._boardModule;
            this.board._boardRenderer = this._boardRenderer;
        }
        if (this.stats) {
            this.stats._boardModule = this._boardModule;
        }

        if (this.ui) {
            this.ui.initEffectsPanel();
        }
    }

    // ------------------------------------------------------------------
    // Tournament list filtering & creation
    // ------------------------------------------------------------------

    filterTournaments() {
        const searchInput = document.getElementById('tournamentSearch');
        const statusFilter = document.getElementById('statusFilter');
        const searchTerm = (searchInput?.value || '').toLowerCase().trim();
        const statusValue = statusFilter?.value || 'all';

        const filtered = this._allTournaments.filter(t => {
            const matchesSearch = !searchTerm
                || t.id?.toLowerCase().includes(searchTerm)
                || t.name?.toLowerCase().includes(searchTerm);
            const status = t.status || 'setup';
            const matchesStatus = statusValue === 'all' || status === statusValue;
            return matchesSearch && matchesStatus;
        });

        this.renderTournamentList(filtered);
    }

    renderTournamentList(tournaments) {
        const container = document.getElementById('tournamentList');
        if (!container) return;

        if (tournaments.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 40px 20px;">No tournaments found</p>';
            return;
        }

        const statusEmoji = { setup: '⚙️', playing: '🎮', finished: '🏆', archived: '📦' };

        container.innerHTML = tournaments.map(t => {
            const status = t.status || 'setup';
            const emoji = statusEmoji[status] || '📋';
            const teamCount = t.teams?.length || 0;
            const matchCount = t.gameHistory?.length || 0;
            return `
                <div class="tournament-card ${status}">
                    <div class="tournament-title">${emoji} ${escapeHtml(t.name || t.id)}</div>
                    <div class="tournament-meta">
                        Status: ${escapeHtml(status)} | Teams: ${teamCount} |
                        Round: ${t.currentRound || 0} | Matches played: ${matchCount}
                    </div>
                    <div class="tournament-actions">
                        <button class="btn-view" onclick="window.open('view.html?tournamentId=${encodeURIComponent(t.id)}', '_blank')">👁️ View</button>
                        <button class="btn-small secondary" onclick="openEditTournamentModal('${t.id}')" title="Edit name / win condition">✏️ Edit</button>
                        <button class="btn-small secondary" onclick="duplicateTournamentFromList('${t.id}')" title="Duplicate this tournament">📋 Duplicate</button>
                        <button class="btn-small danger" onclick="deleteTournamentFromList('${t.id}')" title="Permanently delete">🗑️ Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ------------------------------------------------------------------
    // Tournament loading
    // ------------------------------------------------------------------

    async loadTournamentsList() {
        try {
            const tournamentsRef = window.firebaseDB.collection('tournaments');
            const snapshot = await tournamentsRef.get();

            this._allTournaments = [];
            snapshot.forEach(doc => {
                this._allTournaments.push({ id: doc.id, ...doc.data() });
            });
            this._allTournaments.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

            const total = this._allTournaments.length;
            const active = this._allTournaments.filter(t => t.status === 'playing').length;
            const finished = this._allTournaments.filter(t => t.status === 'finished').length;
            const totalEl = document.getElementById('totalTournaments');
            const activeEl = document.getElementById('activeTournaments');
            const finishedEl = document.getElementById('finishedTournaments');
            if (totalEl) totalEl.textContent = total;
            if (activeEl) activeEl.textContent = active;
            if (finishedEl) finishedEl.textContent = finished;

            this.filterTournaments();
        } catch (error) {
            console.error('Error loading tournaments:', error);
            this.ui.showStatus('Error loading tournaments list', 'error');
        }
    }

    async refreshTournaments() {
        this.ui.showStatus('Refreshing tournaments...', 'info');
        await this.loadTournamentsList();
        this.ui.showStatus('Tournaments refreshed', 'success');
    }

    onTournamentSelect(tournamentId) {
        if (tournamentId) {
            this.loadTournament(tournamentId);
            const url = new URL(window.location);
            url.searchParams.delete('tournament'); // legacy alias (see init())
            url.searchParams.set('tournamentId', tournamentId);
            window.history.pushState({}, '', url);
        }
    }

    async loadTournament(tournamentId) {
        if (!tournamentId) return;

        // Cleanup previous listeners
        if (this._activeListener) {
            this._activeListener();
            this._activeListener = null;
        }
        if (this.actionLogger) {
            this.actionLogger.unsubscribe();
        }

        this._currentTournamentId = tournamentId;

        // Tournament chat — mount once, then just re-point it at the new tournament.
        // God isn't on a team, so no teamId is passed.
        if (window.ChatModule) {
            if (window._chatModule) {
                window._chatModule.switchTournament(tournamentId);
            } else {
                window._chatModule = new ChatModule({ tournamentId });
                window._chatModule.mount();
            }
        }

        this.ui.showStatus('Loading tournament...', 'info');

        try {
            const tournamentRef = window.firebaseDB.collection('tournaments').doc(tournamentId);

            this._activeListener = window.firebaseOnSnapshot(tournamentRef, async (docSnapshot) => {
                if (docSnapshot.exists) {
                    this._onFirebaseSnapshot(docSnapshot, tournamentId);

                    // Persist for navbar tournament-name display (matches admin.js convention)
                    const tName = this.gameState.name || tournamentId;
                    sessionStorage.setItem('currentTournamentId', tournamentId);
                    sessionStorage.setItem('currentTournamentName', tName);
                    localStorage.setItem('currentTournamentId', tournamentId);
                    localStorage.setItem('currentTournamentName', tName);

                    // Check if migration needed
                    if (window.PlayerUtils && window.PlayerUtils.needsPlayerMigration(this.gameState)) {
                        console.log('Migrating tournament to normalized player structure...');
                        window.PlayerUtils.migrateToNormalizedPlayers(this.gameState);
                        await this.saveGameState();
                        this.ui.showStatus('Tournament migrated to new format', 'info');
                    }

                    this.ui.updateConnectionStatus('connected');

                    const newSignature = window.RenderSignature.computeFieldSignature(
                        this.gameState, window.RenderSignature.EXCLUDED_KEYS
                    );
                    if (newSignature !== this._prevRenderSignature) {
                        this._prevRenderSignature = newSignature;
                        this.updateDisplay();
                        this.teams.applyTeamColors();
                    }

                    // Initialize SmartMatchGenerator
                    if (typeof SmartMatchGenerator !== 'undefined') {
                        window.smartMatchGenerator = new SmartMatchGenerator(this.gameState);
                    }

                    if (this._suppressLoadToast) {
                        this._suppressLoadToast = false;
                    } else if (this.gameState.status === 'archived') {
                        this.ui.showStatus('This tournament is archived. Changes are blocked by the server.', 'warning');
                    } else {
                        this.ui.showStatus('Tournament loaded', 'success');
                    }
                } else {
                    this.ui.showStatus('Tournament not found', 'error');
                }
            }, (error) => {
                console.error('Listener error:', error);
                this.ui.updateConnectionStatus('disconnected');
                this.ui.showStatus('Connection error', 'error');
            });
        } catch (error) {
            console.error('Error loading tournament:', error);
            this.ui.showStatus('Error loading tournament', 'error');
        }
    }

    // ------------------------------------------------------------------
    // gameState reference stability
    // ------------------------------------------------------------------

    _onFirebaseSnapshot(docSnap, tournamentId) {
        const newData = docSnap.data();

        // Remove keys no longer in snapshot (except internal fields)
        for (const key of Object.keys(this.gameState)) {
            if (key === 'tournamentId') continue;
            if (!(key in newData)) delete this.gameState[key];
        }

        // Merge new data in-place
        Object.assign(this.gameState, newData);
        this.gameState.tournamentId = tournamentId;
    }

    // ------------------------------------------------------------------
    // Tournament state management
    // ------------------------------------------------------------------

    updateTournamentStateButton() {
        const btn = document.getElementById('tournamentStateBtn');
        if (!btn) return;

        if (!this.gameState?.teams) {
            btn.style.display = 'none';
            return;
        }

        const state = this.gameState.status || 'setup';
        btn.textContent = state;
        btn.style.display = 'inline-block';
        btn.className = 'btn-small tournament-state-btn state-' + state;
    }

    openStateChangeModal() {
        if (!this.gameState?.teams || !this._currentTournamentId) {
            this.ui.showStatus('Load a tournament first', 'warning');
            return;
        }

        const currentState = this.gameState.status || 'setup';
        const options = document.querySelectorAll('#stateOptions .state-option');
        options.forEach(opt => {
            const state = opt.dataset.state;
            opt.classList.toggle('current', state === currentState);

            if (state === 'archived') {
                opt.style.display = (currentState === 'finished' || currentState === 'archived') ? '' : 'none';
            }
            if (currentState === 'archived' && state !== 'archived') {
                opt.style.display = (this._currentUserRole === 'god') ? '' : 'none';
            }
        });

        const warningEl = document.getElementById('archivedWarning');
        if (warningEl) {
            warningEl.style.display = (currentState === 'archived' && this._currentUserRole !== 'god') ? 'block' : 'none';
        }

        const modal = document.getElementById('stateChangeModal');
        if (modal) modal.style.display = 'flex';
    }

    closeStateChangeModal() {
        const modal = document.getElementById('stateChangeModal');
        if (modal) modal.style.display = 'none';
    }

    async confirmStateChange(newState) {
        if (!this.gameState || !this._currentTournamentId) return;

        const currentState = this.gameState.status || 'setup';
        if (newState === currentState) { this.closeStateChangeModal(); return; }

        if (newState === 'archived') {
            if (!confirm('Archive this tournament? Archived tournaments are protected from edits.')) return;
            this.gameState.archivedAt = new Date().toISOString();
        }

        if (currentState === 'archived') {
            if (this._currentUserRole !== 'god') {
                this.ui.showStatus('Only God users can unarchive tournaments', 'error');
                return;
            }
            this.gameState.archivedAt = null;
        }

        const oldState = currentState;
        this.gameState.status = newState;

        // Auto-initialize phase system when entering "playing"
        if (newState === 'playing' && !this.gameState.currentPhase) {
            this.phase?.initializePhase();
        }

        await this.saveGameState();
        this.actionLogger?.logAction('phase_advanced', 'phase', {
            fromPhase: oldState,
            toPhase: newState
        }, { status: oldState });
        this.updateTournamentStateButton();
        this.closeStateChangeModal();
        this.ui.showStatus(`Tournament state changed to ${newState}`, 'success');
        this.loadTournamentsList();
    }

    // ------------------------------------------------------------------
    // Tournament list actions (edit / duplicate / delete) — operate
    // directly on a tournament's Firestore doc by id, independent of
    // whichever tournament is currently active/loaded.
    // ------------------------------------------------------------------

    openEditTournamentModal(tournamentId) {
        const t = this._allTournaments.find(x => x.id === tournamentId);
        if (!t) { this.ui.showStatus('Tournament not found', 'error'); return; }

        this._editingTournamentId = tournamentId;
        const form = document.getElementById('editTournamentForm');
        if (!form) return;

        form.innerHTML = `
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="editTournamentName" value="${escapeHtml(t.name || '')}" style="width: 100%; padding: 10px; background: rgba(11, 13, 16, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; color: white;">
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label>Win Condition (points)</label>
                <input type="number" id="editTournamentWinCondition" value="${t.winCondition || 50}" min="1" max="500" style="width: 100%; padding: 10px; background: rgba(11, 13, 16, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; color: white;">
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="editTournamentSpellsActive" ${t.spellsActive === true ? 'checked' : ''} style="width: 18px; height: 18px;">
                    Spells Active (players see digital spell cards on team.html)
                </label>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
                <button class="btn secondary" onclick="closeEditModal()">Cancel</button>
                <button class="btn primary" onclick="saveTournamentEdits()">Save Changes</button>
            </div>
        `;

        const modal = document.getElementById('editTournamentModal');
        if (modal) modal.style.display = 'flex';
    }

    closeEditModal() {
        const modal = document.getElementById('editTournamentModal');
        if (modal) modal.style.display = 'none';
        this._editingTournamentId = null;
    }

    async saveTournamentEdits() {
        if (!this._editingTournamentId) return;

        const nameInput = document.getElementById('editTournamentName');
        const winInput = document.getElementById('editTournamentWinCondition');
        const spellsInput = document.getElementById('editTournamentSpellsActive');
        const name = nameInput?.value?.trim();
        if (!name) { this.ui.showStatus('Name cannot be empty', 'warning'); return; }
        const winCondition = Math.max(1, parseInt(winInput?.value, 10) || 50);
        const spellsActive = !!spellsInput?.checked;

        try {
            await window.firebaseDB.collection('tournaments').doc(this._editingTournamentId).update({
                name, winCondition, spellsActive
            });
            this.ui.showStatus('Tournament updated', 'success');
            this.closeEditModal();
            await this.loadTournamentsList();
        } catch (error) {
            console.error('Error updating tournament:', error);
            this.ui.showStatus('Error updating tournament', 'error');
        }
    }

    async duplicateTournamentFromList(tournamentId) {
        const t = this._allTournaments.find(x => x.id === tournamentId);
        if (!t) { this.ui.showStatus('Tournament not found', 'error'); return; }

        const newName = prompt('Name for the duplicate:', `${t.name || 'Tournament'} (copy)`);
        if (!newName || !newName.trim()) return;

        try {
            const clone = { ...t };
            delete clone.id;
            Object.assign(clone, {
                name: newName.trim(),
                status: 'setup',
                createdAt: new Date().toISOString(),
                currentRound: 0,
                gamesPlayed: 0,
                gameHistory: [],
                board: {},
                matchQueue: [],
                heartHexControl: {},
                currentPhase: null,
                archivedAt: null
            });

            const cleanClone = this._removeUndefined(clone);
            const newRef = window.firebaseDB.collection('tournaments').doc();
            await newRef.set(cleanClone);

            this.ui.showStatus(`Duplicated as "${newName.trim()}"`, 'success');
            await this.loadTournamentsList();
        } catch (error) {
            console.error('Error duplicating tournament:', error);
            this.ui.showStatus('Error duplicating tournament', 'error');
        }
    }

    async deleteTournamentFromList(tournamentId) {
        const t = this._allTournaments.find(x => x.id === tournamentId);
        if (!t) { this.ui.showStatus('Tournament not found', 'error'); return; }
        const name = t.name || tournamentId;

        if (!confirm(`Permanently delete "${name}"?\n\nThis cannot be undone. Teams, match history, and settings for this tournament will be lost.\n\n(Note: backup snapshots for this tournament are not automatically deleted.)`)) return;

        const typed = prompt(`Type the tournament name to confirm deletion:\n"${name}"`);
        if (typed !== name) {
            this.ui.showStatus('Deletion cancelled — name did not match', 'warning');
            return;
        }

        try {
            await window.firebaseDB.collection('tournaments').doc(tournamentId).delete();
            this.ui.showStatus(`Deleted "${name}"`, 'success');

            if (tournamentId === this._currentTournamentId) {
                if (this._activeListener) { this._activeListener(); this._activeListener = null; }
                this._currentTournamentId = null;
                this.gameState = {};
            }

            await this.loadTournamentsList();
        } catch (error) {
            console.error('Error deleting tournament:', error);
            this.ui.showStatus('Error deleting tournament', 'error');
        }
    }

    // ------------------------------------------------------------------
    // Display
    // ------------------------------------------------------------------

    updateDisplay() {
        if (!this.gameState?.teams) return;

        if (this.gameState.rooms && this._boardModule) {
            this._boardModule.setRoomHexes(this.gameState.rooms);
        }

        const navName = document.getElementById('navTournamentLabel');
        if (navName) {
            const navNameText = navName.querySelector('.navbar-tournament-name-text') || navName;
            navNameText.textContent = this.gameState.name || 'Tournament';
            navName.classList.remove('empty');
            navName.title = this.gameState.name || 'Tournament';
        }

        const backupTournamentName = document.getElementById('backupActiveTournamentName');
        if (backupTournamentName) backupTournamentName.textContent = this.gameState.name || this._currentTournamentId || '—';

        const activeTournamentName = document.getElementById('activeTournamentNameLabel');
        if (activeTournamentName) activeTournamentName.textContent = this.gameState.name || this._currentTournamentId || '—';

        this.updateTournamentStateButton();

        const roundEl = document.getElementById('currentRound');
        const gamesEl = document.getElementById('gamesPlayed');
        const hexEl = document.getElementById('hexCount');
        const heartsEl = document.getElementById('heartsControlled');
        if (roundEl) roundEl.textContent = this.gameState.currentRound || 0;
        if (gamesEl) gamesEl.textContent = this.gameState.gamesPlayed || 0;
        if (hexEl) hexEl.textContent = Object.keys(this.gameState.board || {}).length;
        if (heartsEl) heartsEl.textContent = Object.keys(this.gameState.heartHexControl || {}).length;

        this._updateGameTypeDropdown();
        this.teams.renderTeamsList();
        this.board.renderBoard();
        this.queue.renderMatchQueue();
        this.queue.renderOngoingMatches();
        this.queue.renderMatchHistory();
        this.creation.renderMatchCreationZones();

        // Phase indicator
        if (this.phase) {
            this.phase.recheckRequirements();
            this.phase.renderPhaseIndicator();
        }

        // Spell phase turn advancement (detect team.html direct writes)
        if (this.spells && this.gameState.spellPhase?.isActive) {
            this.spells.checkTurnAdvancement();
            this.spells.renderSpellPhaseControls();
        }

        // Ceremony admin panel (compact view during active ceremony)
        this._renderCeremonyPanel();
    }

    /**
     * Render ceremony step in compact admin panel.
     * Called by ScoringCeremony.onStepChanged callback.
     * @param {Object} step
     */
    _renderCeremonyStep(step) {
        const panel = document.getElementById('ceremonyAdminPanel');
        if (!panel) return;

        const container = document.getElementById('ceremonyStepContent');
        if (container && typeof ScoringCeremony !== 'undefined') {
            ScoringCeremony.renderStep(container, step, this.gameState, 'compact');
        }
    }

    /**
     * Show/hide the ceremony admin panel based on ceremony state.
     */
    _renderCeremonyPanel() {
        const panel = document.getElementById('ceremonyAdminPanel');
        if (!panel) return;

        const cs = this.gameState.ceremonyState;
        if (cs?.isActive) {
            panel.style.display = 'flex';
            const progress = document.getElementById('ceremonyProgressText');
            if (progress) {
                progress.textContent = `Step ${(cs.currentStepIndex || 0) + 1} / ${cs.totalSteps || 0}`;
            }
            const pauseBtn = document.getElementById('ceremonyPauseBtn');
            if (pauseBtn) {
                pauseBtn.textContent = cs.isPaused ? '\u25B6 Resume' : '\u23F8 Pause';
                pauseBtn.onclick = cs.isPaused
                    ? () => this.ceremony?.play()
                    : () => this.ceremony?.pause();
            }
        } else {
            panel.style.display = 'none';
        }
    }

    _updateGameTypeDropdown() {
        const select = document.getElementById('gameType');
        if (!select) return;
        const selectedGames = this.gameState?.selectedGames || [];

        if (selectedGames.length === 0) {
            select.innerHTML = '<option value="">No games defined in tournament</option>';
            return;
        }

        select.innerHTML = selectedGames.map(gameId => {
            const displayName = this.teams.getGameDisplayName(gameId);
            return `<option value="${gameId}">${displayName}</option>`;
        }).join('');
    }

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------

    async saveGameState(triggerBtn) {
        if (!this.gameState?.teams || !this._currentTournamentId) {
            this.ui.showStatus('No game state to save', 'warning');
            return;
        }

        if (window._isOffline) {
            if (typeof showToast === 'function') showToast('Cannot save while offline.', 'warning');
            return;
        }

        const stopLoading = (typeof btnLoading === 'function' && triggerBtn) ? btnLoading(triggerBtn) : null;

        try {
            const tournamentRef = window.firebaseDB.collection('tournaments').doc(this._currentTournamentId);

            const saveData = { ...this.gameState };
            delete saveData.tournamentId;
            delete saveData.onboarding;

            const cleanData = this._removeUndefined(saveData);
            this._suppressLoadToast = true;
            await tournamentRef.set(cleanData, { merge: true });

            this.ui.updateConnectionStatus('connected');
        } catch (error) {
            console.error('Error saving game state:', error);
            this.ui.updateConnectionStatus('disconnected');
            this.ui.showStatus('Error saving to Firebase', 'error');
        } finally {
            if (stopLoading) stopLoading();
        }
    }

    _removeUndefined(obj) {
        if (obj === null || obj === undefined) return null;
        if (typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            return obj.map(item => this._removeUndefined(item)).filter(item => item !== undefined);
        }
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
                cleaned[key] = this._removeUndefined(value);
            }
        }
        return cleaned;
    }

    // ------------------------------------------------------------------
    // Event logging
    // ------------------------------------------------------------------

    async logEvent(type, data = {}) {
        if (!this._currentTournamentId) return;

        try {
            const eventRef = window.firebaseDB
                .collection('tournaments')
                .doc(this._currentTournamentId)
                .collection('eventLog')
                .doc();

            const eventData = {
                type,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            Object.entries(data).forEach(([key, value]) => {
                if (value !== undefined) eventData[key] = value;
            });

            await eventRef.set(eventData);
        } catch (error) {
            console.error('[EventLog] Error logging event:', error);
        }
    }

    async deleteLastTileCaptureEvent(hexCoord) {
        if (!this._currentTournamentId || !hexCoord) return;

        try {
            const eventLogRef = window.firebaseDB
                .collection('tournaments')
                .doc(this._currentTournamentId)
                .collection('eventLog')
                .where('type', '==', 'tile_capture')
                .where('hexCoord', '==', hexCoord);

            const snapshot = await eventLogRef.get();
            if (!snapshot.empty) {
                let mostRecent = null;
                let mostRecentTime = 0;

                snapshot.docs.forEach(doc => {
                    const ts = doc.data().timestamp?.toMillis?.() || 0;
                    if (ts > mostRecentTime) { mostRecentTime = ts; mostRecent = doc; }
                });

                if (mostRecent) await mostRecent.ref.delete();
            }
        } catch (error) {
            console.error('[EventLog] Error deleting tile_capture event:', error);
        }
    }

    // ------------------------------------------------------------------
    // Utility
    // ------------------------------------------------------------------

    exportGameState() {
        if (!this.gameState?.teams) {
            this.ui.showStatus('No game to export', 'error');
            return;
        }
        const dataStr = JSON.stringify(this.gameState, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tournament-${this._currentTournamentId || 'export'}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ui.showStatus('Game state exported', 'success');
    }

    async importGameStateFromFile(fileInput) {
        const file = fileInput?.files?.[0];
        fileInput.value = '';
        if (!file) return;

        if (!this._currentTournamentId) {
            this.ui.showStatus('Load a tournament before importing', 'warning');
            return;
        }

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.teams)) {
                this.ui.showStatus('Not a valid backup file (missing teams array)', 'error');
                return;
            }

            if (!confirm(`Import "${file.name}" into this tournament?\nThis will overwrite the current tournament state. A pre-import backup will be created first.`)) {
                return;
            }

            await this.backup?.createBackup('pre_import', `Auto-backup before importing ${file.name}`);

            const tournamentId = this._currentTournamentId;
            Object.keys(this.gameState).forEach(key => {
                if (key !== 'tournamentId') delete this.gameState[key];
            });
            Object.assign(this.gameState, parsed, { tournamentId });

            await this.saveGameState();
            this.updateDisplay();

            this.ui.showStatus(`Imported backup: ${file.name}`, 'success');
        } catch (error) {
            console.error('Error importing backup:', error);
            this.ui.showStatus('Error importing backup (invalid JSON?)', 'error');
        }
    }

    logout() {
        firebase.auth().signOut().then(() => {
            window.location.href = (window.BOARDGAME_BASE || '.') + '/login.html';
        }).catch(error => {
            console.error('Logout error:', error);
            this.ui.showStatus('Error logging out', 'error');
        });
    }

    openViewWindow() {
        if (!this._currentTournamentId) { this.ui.showStatus('Load a tournament first', 'warning'); return; }
        window.open(`view.html?tournamentId=${encodeURIComponent(this._currentTournamentId)}`, '_blank', 'width=1920,height=1080');
    }

    openReplayWindow() {
        if (!this._currentTournamentId) { this.ui.showStatus('Load a tournament first', 'warning'); return; }
        window.open(`replay.html?tournamentId=${encodeURIComponent(this._currentTournamentId)}`, '_blank');
    }

    openStatsWindow() {
        if (!this._currentTournamentId) { this.ui.showStatus('Load a tournament first', 'warning'); return; }
        window.open(`statistics.html?tournamentId=${encodeURIComponent(this._currentTournamentId)}`, '_blank');
    }

    openOnboardingWindow() {
        if (!this._currentTournamentId) { this.ui.showStatus('Load a tournament first', 'warning'); return; }
        window.open(`onboarding.html?tournamentId=${encodeURIComponent(this._currentTournamentId)}&view=true`, '_blank');
    }

    // ------------------------------------------------------------------
    // Wire all manager methods as window globals for HTML onclick
    // ------------------------------------------------------------------

    _wireGlobalFunctions() {
        const app = this;

        // Expose shared gameState for legacy scripts (user-management.js etc.)
        window.gameState = this.gameState;

        // UIManager
        window.showStatus = (m, t) => app.ui.showStatus(m, t);
        window.addLog = (m, t) => app.ui.addLog(m, t);

        // TeamManager
        window.getTeamColor = (id) => app.teams.getTeamColor(id);
        window.getGameDisplayName = (id) => app.teams.getGameDisplayName(id);
        window.getMatchTeamPlayers = (t) => app.teams.getMatchTeamPlayers(t);
        window.adjustTeamPoints = (id, d, e) => app.teams.adjustTeamPoints(id, d, e);
        window.setTeamPoints = (id, v) => app.teams.setTeamPoints(id, v);
        window.openPlayerManager = () => app.teams.openPlayerManager();
        window.closePlayerManager = () => app.teams.closePlayerManager();
        window.addPlayerToTeam = (id) => app.teams.addPlayerToTeam(id);
        window.removePlayerFromTeam = (id, i) => app.teams.removePlayerFromTeam(id, i);
        window.updatePlayerName = (id, i, n) => app.teams.updatePlayerName(id, i, n);
        window.updateTeamName = (id, n) => app.teams.updateTeamName(id, n);
        window.updateTeamColor = (id, c) => app.teams.updateTeamColor(id, c);
        window.openSeatingOrder = () => app.teams.openSeatingOrder();
        window.closeSeatingOrder = () => app.teams.closeSeatingOrder();
        window.resetSeatingOrder = () => app.teams.resetSeatingOrder();
        window.escapeHtml = (s) => app.teams.escapeHtml(s);

        // PhaseManager
        window.advancePhase = () => app.phase?.advancePhase(false);
        window.forceAdvancePhase = () => app.phase?.openForceAdvanceModal();
        window.confirmForceAdvance = async () => {
            await app.phase?.advancePhase(true);
            app.phase?.closeForceAdvanceModal();
        };
        window.closeForceAdvanceModal = () => app.phase?.closeForceAdvanceModal();
        window.getCurrentPhase = () => app.phase?.getCurrentPhase();
        window.getPhaseRequirements = () => app.phase?.getPhaseRequirements();
        window.insertBreak = () => app.phase?.insertBreak();
        window.endBreak = () => app.phase?.endBreak();
        window.openBreakSettings = () => app.phase?.openBreakSettings();
        window.closeBreakSettings = () => app.phase?.closeBreakSettings();
        window.saveBreakSettings = (btn) => app.phase?.saveBreakSettings(btn);
        window.resetBreakCounter = () => app.phase?.resetBreakCounter();
        window.skipNextBreak = () => app.phase?.skipNextBreak();
        window.endTournament = () => {
            if (confirm('End this tournament? This will move to the Tournament End state.')) {
                app.phase?.endTournament();
            }
        };
        window.forceAllReady = async (slot) => {
            app.phase?.forceAllReadyForSlot(slot);
            await app.saveGameState();
            app.updateDisplay();
        };
        window.beginSpells = () => app.phase?.beginSpells();
        window.loopBack = () => app.phase?.loopBack();
        window.advanceSlot = (slot) => app.phase?.advanceSlot(slot, false);
        window.forceAdvanceSlot = (slot) => app.phase?.advanceSlot(slot, true);

        // BoardManager
        window.renderBoard = () => app.board?.renderBoard();
        window.assignTeamToHex = (c, t) => app.board.assignTeamToHex(c, t);
        window.toggleRoomHex = (c) => app.board.toggleRoomHex(c);
        window.closeTeamPicker = () => app.board.closeTeamPicker();
        window.highlightValidPlacements = () => app.board.highlightValidPlacements();
        window.clearHighlights = () => app.board.clearHighlights();
        window.saveDefaultRooms = () => app.board.saveDefaultRooms();
        window.loadDefaultRooms = () => app.board.loadDefaultRooms();

        // MatchQueueManager
        window.startMatch = (id) => app.queue.startMatch(id);
        window.moveMatchToTop = (id) => app.queue.moveMatchToTop(id);
        window.removeFromQueue = (id) => app.queue.removeFromQueue(id);
        window.dragQueueItem = (e, id) => app.queue.dragQueueItem(e, id);
        window.allowQueueDrop = (e) => app.queue.allowQueueDrop(e);
        window.leaveQueueDrop = (e) => app.queue.leaveQueueDrop(e);
        window.dropQueueItem = (e, id) => app.queue.dropQueueItem(e, id);
        window.endQueueDrag = (e) => app.queue.endQueueDrag(e);
        window.toggleBreakMenu = () => app.queue.toggleBreakMenu();
        window.addBreakToQueue = (t) => app.queue.addBreakToQueue(t);
        window.completeBreak = (id) => app.queue.completeBreak(id);
        window.openClearQueueModal = () => app.queue.openClearQueueModal();
        window.closeClearQueueModal = () => app.queue.closeClearQueueModal();
        window.confirmClearQueue = (btn) => app.queue.confirmClearQueue(btn);
        window.filterAllMatches = () => app.queue.renderMatchHistory();

        // MatchCreationManager
        window.dragTeam = (e, id) => app.creation.dragTeam(e, id);
        window.dragPlayer = (e, tid, idx) => app.creation.dragPlayer(e, tid, idx);
        window.dragEnd = (e) => app.creation.dragEnd(e);
        window.allowDrop = (e) => app.creation.allowDrop(e);
        window.dragLeave = (e) => app.creation.dragLeave(e);
        window.dropToSide = (e, idx) => app.creation.dropToSide(e, idx);
        window.removeFromSide = (si, pi) => app.creation.removeFromSide(si, pi);
        window.clearMatchSetup = () => app.creation.clearMatchSetup();
        window.addMatchSide = () => app.creation.addMatchSide();
        window.removeMatchSide = () => app.creation.removeMatchSide();
        window.addMatchToQueue = (btn) => app.creation.addMatchToQueue(btn);
        window.addChallengeToQueue = () => app.creation.addChallengeToQueue();
        window.updateChallengeSelectColor = (id) => app.creation.updateChallengeSelectColor(id);
        window.closeChallengeSetupModal = () => app.creation.closeChallengeSetupModal();
        window.confirmChallengeSetup = (btn) => app.creation.confirmChallengeSetup(btn);
        window.openMassImport = () => app.creation.openMassImport();
        window.handleImportFile = (e) => app.creation.handleImportFile(e);
        window.confirmMassImport = (btn) => app.creation.confirmMassImport(btn);
        window.closeMassImport = () => app.creation.closeMassImport();
        window.openEditMatchModal = (id) => app.creation.openEditMatchModal(id);
        window.addPlayerToEditSide = (idx) => app.creation.addPlayerToEditSide(idx);
        window.removePlayerFromEdit = (si, pi) => app.creation.removePlayerFromEdit(si, pi);
        window.movePlayerInEdit = (f, t, p) => app.creation.movePlayerInEdit(f, t, p);
        window.addEditMatchSide = () => app.creation.addEditMatchSide();
        window.removeEditMatchSide = () => app.creation.removeEditMatchSide();
        window.saveMatchEdits = (btn) => app.creation.saveMatchEdits(btn);
        window.closeEditMatchModal = () => app.creation.closeEditMatchModal();
        window.generateSuggestedMatches = () => app.creation.generateSuggestedMatches();
        window.confirmAutoMatch = () => app.creation.confirmAutoMatch();
        window.closeAutoMatchModal = () => app.creation.closeAutoMatchModal();
        window.openGameManager = () => app.creation.openGameManager();
        window.closeGameManager = () => app.creation.closeGameManager();
        window.switchGameManagerTab = (t) => app.creation.switchGameManagerTab(t);
        window.addCatalogGameToTournament = (id) => app.creation.addCatalogGameToTournament(id);
        window.addCustomGameToTournament = (btn) => app.creation.addCustomGameToTournament(btn);
        window.removeGameFromTournament = (id) => app.creation.removeGameFromTournament(id);

        // ResultManager
        window.openQuickConfirm = (id) => app.result.openQuickConfirm(id);
        window.closeResultConfirm = () => app.result.closeResultConfirm();
        window.quickConfirmResult = (id, idx) => app.result.quickConfirmResult(id, idx);
        window.dismissPendingHexBanner = () => app.result.dismissPendingHexBanner();
        window.openCorrectResultModal = (id) => app.result.openCorrectResultModal(id);
        window.closeCorrectResultModal = () => app.result.closeCorrectResultModal();
        window.selectCorrectedWinner = (id, idx) => app.result.selectCorrectedWinner(id, idx);
        window.confirmCorrectResult = () => app.result.confirmCorrectResult();

        // StatsManager
        window.recalculateTeamStats = () => app.stats.recalculateTeamStats();
        window.advanceRound = () => app.stats.advanceRound();
        window.closeNextRoundModal = () => app.stats.closeNextRoundModal();
        window.confirmAdvanceRound = (btn) => app.stats.confirmAdvanceRound(btn);
        window.adjustPointsWithReason = (id, delta) => app.stats.adjustPointsWithReason(id, delta);
        window.setTeamPointsWithReason = (id, value) => app.stats.setTeamPointsWithReason(id, value);

        // BackupManager
        window.createManualBackup = () => app.backup?.createBackup('manual', 'Manual backup');
        window.refreshBackups = () => app.backup?.listBackups();
        window.restoreFromBackup = (id) => app.backup?.restoreFromBackup(id);

        // UndoManager
        window.openUndoConfirmModal = (entry) => app.undo?.openUndoConfirmModal(entry);
        window.closeUndoConfirmModal = () => app.undo?.closeUndoConfirmModal();
        window.confirmUndoAction = () => app.undo?.confirmUndoAction();

        // GodApp
        window.onTournamentSelect = (id) => app.onTournamentSelect(id);
        window.refreshTournaments = () => app.refreshTournaments();
        window.openStateChangeModal = () => app.openStateChangeModal();
        window.closeStateChangeModal = () => app.closeStateChangeModal();
        window.confirmStateChange = (s) => app.confirmStateChange(s);
        window.saveGameState = (btn) => app.saveGameState(btn);
        window.exportGameState = () => app.exportGameState();
        window.importGameStateFromFile = (fileInput) => app.importGameStateFromFile(fileInput);
        window.logout = () => app.logout();
        window.openViewWindow = () => app.openViewWindow();
        window.openStatsWindow = () => app.openStatsWindow();
        window.openOnboardingWindow = () => app.openOnboardingWindow();
        window.updateDisplay = () => app.updateDisplay();
        window.initializeBoardModules = () => app.initializeBoardModules();

        // Broadcast message
        window.setBroadcastMessage = async () => {
            const input = document.getElementById('broadcastInput');
            const text = input?.value?.trim();
            if (!text) return;
            app.gameState.broadcastMessage = {
                text: text,
                sentAt: new Date().toISOString(),
                sentBy: 'admin'
            };
            await app.saveGameState();
            app.ui?.showStatus('Broadcast message sent.', 'success');
        };
        window.clearBroadcastMessage = async () => {
            app.gameState.broadcastMessage = null;
            const input = document.getElementById('broadcastInput');
            if (input) input.value = '';
            await app.saveGameState();
            app.ui?.showStatus('Broadcast message cleared.', 'success');
        };

        // ScoringCeremony controls (Phase 3)
        window.pauseCeremony = () => app.ceremony?.pause();
        window.resumeCeremony = () => app.ceremony?.play();
        window.skipCeremony = () => app.ceremony?.skip();

        // Display controls (Phase 3)
        window.setDisplayOverride = async (mode) => {
            if (!mode) {
                app.gameState.displayOverride = null;
            } else {
                app.gameState.displayOverride = app.gameState.displayOverride || {};
                app.gameState.displayOverride.mode = mode;
            }
            await app.saveGameState();
            app.ui?.showStatus(mode ? `Display forced to: ${mode}` : 'Display set to auto', 'success');
        };

        window.setRotationInterval = async (seconds) => {
            app.gameState.displayOverride = app.gameState.displayOverride || {};
            app.gameState.displayOverride.rotationInterval = parseInt(seconds, 10);
            await app.saveGameState();
        };

        window.clearDisplayOverride = async () => {
            app.gameState.displayOverride = null;
            const modeSelect = document.getElementById('displayModeOverride');
            if (modeSelect) modeSelect.value = '';
            const intervalSelect = document.getElementById('displayRotationInterval');
            if (intervalSelect) intervalSelect.value = '15';
            await app.saveGameState();
            app.ui?.showStatus('Display override cleared.', 'success');
        };

        // Replay & Export (Phase 4)
        window.openReplayWindow = () => app.openReplayWindow();
        window.exportActionLogJSON = () => app._actionExport?.exportJSON();
        window.exportActionLogCSV = () => app._actionExport?.exportCSV();

        // Expose gameState for user-management.js compatibility
        Object.defineProperty(window, 'gameState', {
            get: () => app.gameState,
            set: (v) => { if (v && typeof v === 'object') Object.assign(app.gameState, v); },
            configurable: true
        });

        // Expose tournamentId
        Object.defineProperty(window, 'currentTournamentId', {
            get: () => app._currentTournamentId,
            configurable: true
        });

        // ---- Compatibility aliases for HTML onclick handlers ----

        // Tournament management (old god-scripts.js names)
        window.filterTournaments = () => app.filterTournaments();
        window.openEditTournamentModal = (id) => app.openEditTournamentModal(id);
        window.closeEditModal = () => app.closeEditModal();
        window.saveTournamentEdits = () => app.saveTournamentEdits();
        window.duplicateTournamentFromList = (id) => app.duplicateTournamentFromList(id);
        window.deleteTournamentFromList = (id) => app.deleteTournamentFromList(id);

        // Match creation (old god-scripts.js → new MatchCreationManager)
        window.addGameToQueue = (btn) => app.creation?.addMatchToQueue(btn);
        window.clearManualGameSetup = () => app.creation?.clearMatchSetup();
        window.generateMatchSuggestion = () => app.creation?.generateSuggestedMatches();

        // Match confirmation (old god-scripts.js → new ResultManager)
        window.confirmGameResult = () => {
            console.warn('[Compat] confirmGameResult() — use openQuickConfirm() on ongoing matches');
        };

        // Match queue (old god-scripts.js → new MatchQueueManager)
        window.loadQueuedGame = (idx) => {
            console.warn('[Compat] loadQueuedGame() — queue is rendered automatically');
        };

        // Old sub-tab switching within Matches tab
        window.switchTab = (tabName) => {
            document.querySelectorAll('.match-sub-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.match-sub-panel').forEach(p => p.classList.remove('active'));
            const tab = document.querySelector(`[data-subtab="${tabName}"]`);
            const panel = document.getElementById(`${tabName}Panel`) || document.getElementById(`${tabName}-panel`);
            if (tab) tab.classList.add('active');
            if (panel) panel.classList.add('active');
        };

        // Old drag-drop (god-scripts.js dropPlayer → new dropToSide)
        window.dropPlayer = (e, side) => {
            const sideIdx = side === 'teamA' ? 0 : side === 'teamB' ? 1 : 0;
            app.creation?.dropToSide(e, sideIdx);
        };

        // Board (undo/redo from deprecated action-history.js — stubs)
        window.undoAction = () => {
            app.ui?.showStatus('Undo not available in this version', 'info');
        };
        window.redoAction = () => {
            app.ui?.showStatus('Redo not available in this version', 'info');
        };
        window.toggleActionHistory = () => {
            const panel = document.getElementById('actionHistoryPanel');
            if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        };

        // SpellEngine
        window.loadAllSpells = () => app.spells?.loadSpellDefinitions().then(() => app.spells?.renderSpellsTab());
        window.updateTeamSpellInventory = () => app.spells?.updateTeamSpellInventory();
        window.distributeSpellToTeam = () => app.spells?.distributeSpellToTeam();
        window.distributeRandomSpells = () => app.spells?.distributeRandomSpells();
        window.filterSpells = () => app.spells?.filterSpells();
        window.initializeSpellPiles = (n) => app.spells?.initializeSpellPiles(n);
        window.removeSpellFromTeam = (tid, idx) => app.spells?.removeSpellFromTeam(tid, idx);
        window.showSpellPreview = (id) => app.spells?.showSpellPreview(id);
        window.removeActiveEffect = (id) => app.spells?.removeActiveEffect(id);
        window.skipSpellTurn = (tid) => app.spells?.skipTeamTurn(tid);
        window.forceEndSpellPhase = () => app.spells?.forceEndSpellPhase();

        // Misc stubs
        window.loadBackup = () => {
            app.ui?.showStatus('Backup loading not available in this version', 'info');
        };

        // ActionLogger
        window.startActivityLogListener = () => {
            if (!app.actionLogger || !app._currentTournamentId) return;
            app.actionLogger.subscribe((entries) => {
                if (typeof renderActivityLogEntries === 'function') {
                    renderActivityLogEntries(entries);
                }
            }, { limit: 50 });
        };
        window.stopActivityLogListener = () => app.actionLogger?.unsubscribe();
        window.loadMoreActivityLog = async (startAfter) => {
            if (!app.actionLogger) return { entries: [], lastDoc: null };
            return app.actionLogger.getActions({ limit: 50, startAfter });
        };

        // SeasonManager
        window.loadSeasons = () => app.seasons?.loadSeasons();
        window.openCreateSeasonModal = () => {
            document.getElementById('createSeasonModal').style.display = 'flex';
        };
        window.closeCreateSeasonModal = () => {
            document.getElementById('createSeasonModal').style.display = 'none';
        };
        window.confirmCreateSeason = () => app.seasons?.createSeasonFromModal();
        window.openEditSeasonModal = (id) => app.seasons?.openEditModal(id);
        window.closeEditSeasonModal = () => {
            document.getElementById('editSeasonModal').style.display = 'none';
        };
        window.confirmEditSeason = (id) => app.seasons?.confirmEdit(id);
        window.deleteSeasonById = (id) => app.seasons?.deleteSeason(id);
        window.addTournamentToSeason = (sid, tid) => app.seasons?.addTournamentToSeason(sid, tid);
        window.removeTournamentFromSeason = (sid, tid) => app.seasons?.removeTournamentFromSeason(sid, tid);
        window.addSelectedTournamentToSeason = (seasonId) => {
            const select = document.getElementById(`seasonAddTournament-${seasonId}`);
            const tid = select?.value;
            if (tid) app.seasons?.addTournamentToSeason(seasonId, tid);
        };

        // Expose board references for compatibility
        Object.defineProperty(window, 'boardRenderer', {
            get: () => app._boardRenderer,
            configurable: true
        });
        Object.defineProperty(window, 'boardModule', {
            get: () => app._boardModule,
            configurable: true
        });
    }
}

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------

const godApp = new GodApp();

document.addEventListener('firebase-ready', async function () {
    console.log('Firebase ready, initializing God Mode...');

    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user || user.isAnonymous) {
            window.location.href = (window.BOARDGAME_BASE || '.') + '/login.html';
            return;
        }

        godApp._currentUser = user;

        try {
            const userDoc = await window.firebaseDB.collection('users').doc(user.uid).get();
            const userData = userDoc.data();

            if (!userData || (!userData.isGod && !userData.isAdmin)) {
                if (typeof showToast === 'function') showToast('Access denied. God or Admin role required.', 'error', 4000);
                setTimeout(() => {
                    window.location.href = (window.BOARDGAME_BASE || '.') + '/full/home.html';
                }, 1500);
                return;
            }

            godApp._currentUserRole = userData.isGod ? 'god' : 'admin';

            // Apply tab restrictions based on role
            if (typeof applyRoleTabRestrictions === 'function') {
                applyRoleTabRestrictions(godApp._currentUserRole);
            }

            const userNameEl = document.getElementById('userName');
            const roleBadgeEl = document.getElementById('roleBadge');
            if (userNameEl) userNameEl.textContent = userData.displayName || user.email;
            if (roleBadgeEl) {
                roleBadgeEl.textContent = userData.isGod ? 'GOD' : 'ADMIN';
                roleBadgeEl.className = `navbar-role-badge ${userData.isGod ? 'god' : 'admin'}`;
            }

            // Initialize board modules first (needed by managers)
            godApp.initializeBoardModules();

            // Initialize all OOP managers
            godApp.init();

            // Wire board modules into UI (ui created by init())
            godApp.ui.setBoardModules(godApp._boardModule, godApp._boardRenderer);
            godApp.ui.initEffectsPanel();

            // Connection monitoring
            godApp.ui.initConnectionMonitor();

            // Load tournaments
            await godApp.loadTournamentsList();

            // Auto-load from URL (navbar uses 'tournament', other links may use 'tournamentId')
            const urlParams = new URLSearchParams(window.location.search);
            const tournamentId = urlParams.get('tournament') || urlParams.get('tournamentId');
            if (tournamentId) {
                await godApp.loadTournament(tournamentId);
            }

        } catch (error) {
            console.error('Error checking user role:', error);
            if (godApp.ui) godApp.ui.showStatus('Error loading user data', 'error');
        } finally {
            // Always hide the loading overlay — it covers the whole page
            // (including the navbar) at z-index 2000, so leaving it up after
            // an error silently blocks every click, not just this page's UI.
            document.getElementById('loadingOverlay')?.classList.add('hidden');
        }
    });
});

window.GodApp = GodApp;
window.godApp = godApp;
