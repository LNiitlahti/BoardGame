/**
 * PhaseManager — Tournament Phase State Machine
 *
 * Owns the tournament phase flow. Calculates advancement requirements
 * from gameState, provides UI rendering for the persistent phase
 * indicator bar, and logs all phase transitions via ActionLogger.
 *
 * Firestore field:
 *   gameState.currentPhase = { name, roundNumber, startedAt, returnToPhase? }
 *
 * Requirements and canAdvance are computed client-side only (not persisted).
 *
 * Phase flow per round:
 *   PRE_GAME_SETUP → ROUND_START (auto) → CHALLENGE_SELECTION
 *   → PRE_GAME_INSTRUCTIONS (manual) → LOBBY_READY (auto when all ready)
 *   → [BREAK?] → MATCHES_IN_PROGRESS → SCORING_AND_PLACEMENT
 *   → SPELL_PHASE → ROUND_END → (loop to ROUND_START or TOURNAMENT_END)
 *
 * Lobby readiness (Week 6):
 *   gameState.lobbyReady = { [playerUid]: { ready, readyAt, teamId, name } }
 *   Reset to {} when entering lobby_ready. Auto-advances when all playing
 *   players are ready.
 */

// ── Phase constants ──────────────────────────────────────────────

const PHASE_ORDER = [
    'pre_game_setup',
    'round_start',
    'challenge_selection',
    'pre_game_instructions',
    'lobby_ready',
    'break',
    'matches_in_progress',
    'scoring_and_placement',
    'spell_phase',
    'round_end',
    'tournament_end'
];

const PHASE_DISPLAY = {
    pre_game_setup:        { name: 'Pre-Game Setup',         icon: '\u2699' },
    round_start:           { name: 'Round Start',            icon: '\u{1F3C1}' },
    challenge_selection:   { name: 'Challenge Selection',    icon: '\u2694' },
    pre_game_instructions: { name: 'Pre-Game Instructions',  icon: '\u{1F4CB}' },
    lobby_ready:           { name: 'Lobby Ready',            icon: '\u{1F3AE}' },
    break:                 { name: 'Break',                  icon: '\u23F8' },
    matches_in_progress:   { name: 'Matches In Progress',    icon: '\u{1F3AE}' },
    scoring_and_placement: { name: 'Scoring & Placement',    icon: '\u{1F3AF}' },
    spell_phase:           { name: 'Spell Phase',            icon: '\u{1F52E}' },
    round_end:             { name: 'Round End',              icon: '\u{1F4CA}' },
    tournament_end:        { name: 'Tournament End',         icon: '\u{1F3C6}' }
};

/** Phases that auto-advance immediately (no admin interaction needed) */
const AUTO_ADVANCE_PHASES = ['round_start'];

/** Phases that auto-advance only when all requirements are met */
const AUTO_ADVANCE_WHEN_MET = ['lobby_ready', 'round_end', 'spell_phase'];

/** Phases skipped in normal linear flow (only entered via dedicated methods) */
const SKIP_IN_LINEAR_FLOW = ['break'];

// ── PhaseManager class ───────────────────────────────────────────

class PhaseManager {

    /**
     * @param {Object} gameState  Shared mutable game state reference
     * @param {Object} deps
     * @param {UIManager}  deps.uiManager
     * @param {TeamManager} deps.teamManager
     * @param {Function}   deps.saveCallback        (triggerBtn?) => Promise<void>
     * @param {Function}   [deps.logActionCallback]  (actionType, category, payload, prev) => void
     * @param {Function}   [deps.onDisplayRefresh]   () => void
     */
    constructor(gameState, {
        uiManager,
        teamManager,
        saveCallback,
        logActionCallback,
        onDisplayRefresh
    }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._teams = teamManager;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._refresh = onDisplayRefresh || (() => {});

        // Injected later by GodApp (after ResultManager is created)
        this._getPendingHexCount = () => 0;

        // Cached requirements for the current phase
        this._cachedReqs = { items: [], allMet: false };

        // Guard flag to prevent duplicate auto-advance calls
        this._autoAdvancePending = false;
    }

    // ── Core API ─────────────────────────────────────────────────

    /** Current phase name string, or null */
    getCurrentPhase() {
        return this._gameState.currentPhase?.name || null;
    }

    /** Display name for current phase */
    getCurrentPhaseDisplayName() {
        const phase = this.getCurrentPhase();
        return phase ? (PHASE_DISPLAY[phase]?.name || phase) : '---';
    }

    /** Icon for current phase */
    getCurrentPhaseIcon() {
        const phase = this.getCurrentPhase();
        return phase ? (PHASE_DISPLAY[phase]?.icon || '') : '';
    }

    /** Next phase in sequence (skipping auto-skip phases) */
    getNextPhase() {
        const current = this.getCurrentPhase();
        if (!current) return null;
        return this._getEffectiveNextPhase(current);
    }

    /** Display name for the next phase */
    getNextPhaseDisplayName() {
        const next = this.getNextPhase();
        return next ? (PHASE_DISPLAY[next]?.name || next) : null;
    }

    /**
     * Initialize phase for a tournament that has no currentPhase yet.
     * Called when admin transitions tournament status to 'playing'.
     */
    initializePhase() {
        const gs = this._gameState;
        if (gs.currentPhase) return;

        gs.currentPhase = {
            name: 'pre_game_setup',
            roundNumber: 0,
            startedAt: new Date().toISOString()
        };

        // Initialize break settings if not present
        if (!gs.breakSettings) {
            gs.breakSettings = {
                intervalRounds: 2,
                roundsSinceLastBreak: 0,
                lastBreakAt: null
            };
        }
    }

    /**
     * Advance to the next phase.
     * @param {boolean} force  Skip requirements check (emergency override)
     * @returns {Promise<boolean>}  true if advanced
     */
    async advancePhase(force = false) {
        const gs = this._gameState;
        const current = this.getCurrentPhase();
        if (!current) {
            this._ui.showStatus('No active phase. Load a tournament first.', 'warning');
            return false;
        }

        if (current === 'tournament_end') {
            this._ui.showStatus('Tournament has ended. Cannot advance further.', 'warning');
            return false;
        }

        // Requirements gate
        if (!force) {
            const reqs = this.getPhaseRequirements();
            if (!reqs.allMet) {
                this._ui.showStatus('Requirements not met. Use force advance to override.', 'warning');
                return false;
            }
        }

        const nextPhase = this._getEffectiveNextPhase(current);
        if (!nextPhase) {
            this._ui.showStatus('No next phase available.', 'warning');
            return false;
        }

        // Break interval check: when advancing FROM lobby_ready, auto-insert break if due
        if (current === 'lobby_ready' && this._isBreakDue()) {
            await this._autoInsertBreak('matches_in_progress');
            return true;
        }

        // Round number logic
        let newRound = gs.currentPhase?.roundNumber || 0;
        if (current === 'pre_game_setup' || current === 'round_end') {
            newRound += 1;
        }

        // Increment break interval counter when completing a round
        if (current === 'round_end' && gs.breakSettings) {
            gs.breakSettings.roundsSinceLastBreak =
                (gs.breakSettings.roundsSinceLastBreak || 0) + 1;
        }

        const previousPhase = { ...gs.currentPhase };

        // Update gameState
        gs.currentPhase = {
            name: nextPhase,
            roundNumber: newRound,
            startedAt: new Date().toISOString()
        };

        // Reset lobby readiness when entering lobby_ready
        if (nextPhase === 'lobby_ready') {
            const prevLobbyReady = { ...(gs.lobbyReady || {}) };
            this._resetLobbyReady();
            this._logAction('lobby_reset', 'phase', {
                roundNumber: newRound
            }, { lobbyReady: prevLobbyReady });
        }

        // Initialize spell phase when entering spell_phase
        if (nextPhase === 'spell_phase' && this._onSpellPhaseEntered) {
            this._onSpellPhaseEntered();
        }

        // Start scoring ceremony when entering scoring_and_placement
        if (nextPhase === 'scoring_and_placement' && this._onScoringCeremony) {
            this._onScoringCeremony();
        }

        // Expire spell conditions at round start
        if (nextPhase === 'round_start' && this._onRoundStartSpells) {
            this._onRoundStartSpells();
        }

        // Keep top-level status in sync
        if (nextPhase !== 'pre_game_setup' && nextPhase !== 'tournament_end') {
            if (gs.status !== 'playing') gs.status = 'playing';
        }
        if (nextPhase === 'tournament_end') {
            gs.status = 'finished';
        }

        // Persist
        await this._save();

        // Log
        this._logAction('phase_advanced', 'phase', {
            fromPhase: current,
            toPhase: nextPhase,
            roundNumber: newRound,
            forced: !!force
        }, { currentPhase: previousPhase, status: this._gameState.status });

        if (force) {
            this._ui.showStatus(
                `Phase force-advanced to ${PHASE_DISPLAY[nextPhase]?.name || nextPhase}`,
                'warning'
            );
        } else {
            this._ui.showStatus(
                `Phase: ${PHASE_DISPLAY[nextPhase]?.name || nextPhase} (Round ${newRound})`,
                'success'
            );
        }

        // Auto-advance if this is a transitional phase
        if (AUTO_ADVANCE_PHASES.includes(nextPhase)) {
            await this._handleAutoAdvance(nextPhase);
        }

        this.recheckRequirements();
        this.renderPhaseIndicator();
        return true;
    }

    /**
     * Insert a break. Saves the current phase as returnToPhase.
     */
    async insertBreak() {
        const gs = this._gameState;
        const current = this.getCurrentPhase();
        if (!current || current === 'break' || current === 'tournament_end') {
            this._ui.showStatus('Cannot insert break in current state.', 'warning');
            return;
        }

        const previousPhase = { ...gs.currentPhase };
        gs.currentPhase = {
            name: 'break',
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString(),
            returnToPhase: current
        };

        await this._save();
        this._logAction('break_started', 'phase', {
            fromPhase: current,
            roundNumber: gs.currentPhase.roundNumber
        }, { currentPhase: previousPhase, status: this._gameState.status });

        this._ui.showStatus('Break started.', 'info');
        this.recheckRequirements();
        this.renderPhaseIndicator();
    }

    /**
     * End break and return to the interrupted phase.
     */
    async endBreak() {
        const gs = this._gameState;
        if (gs.currentPhase?.name !== 'break') return;

        const returnTo = gs.currentPhase.returnToPhase || 'challenge_selection';
        const previousPhase = { ...gs.currentPhase };

        // Reset break interval counter
        if (gs.breakSettings) {
            gs.breakSettings.roundsSinceLastBreak = 0;
            gs.breakSettings.lastBreakAt = new Date().toISOString();
        }

        gs.currentPhase = {
            name: returnTo,
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString()
        };

        await this._save();
        this._logAction('break_ended', 'phase', {
            toPhase: returnTo,
            roundNumber: gs.currentPhase.roundNumber
        }, { currentPhase: previousPhase, status: this._gameState.status });

        this._ui.showStatus('Break ended.', 'success');
        this.recheckRequirements();
        this.renderPhaseIndicator();
    }

    // ── Break Interval System ──────────────────────────────────────

    /**
     * Check if an automatic break is due based on break interval settings.
     * @returns {boolean}
     */
    _isBreakDue() {
        const s = this._gameState.breakSettings;
        if (!s || !s.intervalRounds || s.intervalRounds <= 0) return false;
        return (s.roundsSinceLastBreak || 0) >= s.intervalRounds;
    }

    /**
     * Auto-insert a break (triggered by interval system).
     * @param {string} returnToPhase  Phase to return to after break ends
     */
    async _autoInsertBreak(returnToPhase) {
        const gs = this._gameState;
        const previousPhase = { ...gs.currentPhase };

        gs.currentPhase = {
            name: 'break',
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString(),
            returnToPhase: returnToPhase,
            autoInserted: true
        };

        await this._save();
        this._logAction('break_auto_inserted', 'phase', {
            fromPhase: previousPhase.name,
            returnToPhase: returnToPhase,
            roundsSinceLastBreak: gs.breakSettings?.roundsSinceLastBreak || 0,
            intervalRounds: gs.breakSettings?.intervalRounds || 0,
            roundNumber: gs.currentPhase.roundNumber
        }, { currentPhase: previousPhase, status: this._gameState.status });

        this._ui.showStatus(
            `Automatic break — ${gs.breakSettings?.roundsSinceLastBreak || 0} rounds since last break.`,
            'info'
        );
        this.recheckRequirements();
        this.renderPhaseIndicator();
    }

    /**
     * Open the break settings modal.
     */
    openBreakSettings() {
        const gs = this._gameState;
        const modal = document.getElementById('breakSettingsModal');
        if (!modal) return;

        const input = document.getElementById('breakIntervalInput');
        if (input) input.value = gs.breakSettings?.intervalRounds ?? 2;

        const counterEl = document.getElementById('roundsSinceBreak');
        if (counterEl) counterEl.textContent = gs.breakSettings?.roundsSinceLastBreak ?? 0;

        modal.style.display = 'flex';
    }

    /**
     * Close the break settings modal.
     */
    closeBreakSettings() {
        const modal = document.getElementById('breakSettingsModal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * Save break settings from the modal.
     */
    async saveBreakSettings(triggerBtn) {
        const gs = this._gameState;
        const input = document.getElementById('breakIntervalInput');
        const newInterval = parseInt(input?.value) || 0;

        if (!gs.breakSettings) {
            gs.breakSettings = { intervalRounds: 0, roundsSinceLastBreak: 0, lastBreakAt: null };
        }

        const prev = gs.breakSettings.intervalRounds;
        gs.breakSettings.intervalRounds = Math.max(0, newInterval);

        await this._save(triggerBtn);
        this._logAction('break_settings_changed', 'admin', {
            intervalRounds: gs.breakSettings.intervalRounds,
            previousInterval: prev
        }, { intervalRounds: prev });

        this.closeBreakSettings();
        this._ui.showStatus(
            newInterval > 0
                ? `Break every ${newInterval} round(s).`
                : 'Automatic breaks disabled.',
            'success'
        );
        this.renderPhaseIndicator();
    }

    /**
     * Reset the rounds-since-last-break counter to 0.
     */
    async resetBreakCounter() {
        const gs = this._gameState;
        if (!gs.breakSettings) return;
        gs.breakSettings.roundsSinceLastBreak = 0;
        await this._save();
        this._ui.showStatus('Break counter reset to 0.', 'success');
        this.renderPhaseIndicator();

        const counterEl = document.getElementById('roundsSinceBreak');
        if (counterEl) counterEl.textContent = '0';
    }

    /**
     * Skip the next scheduled break by resetting the counter.
     */
    async skipNextBreak() {
        const gs = this._gameState;
        if (!gs.breakSettings) return;
        const prevCounter = gs.breakSettings.roundsSinceLastBreak;
        gs.breakSettings.roundsSinceLastBreak = 0;
        await this._save();
        this._logAction('break_skipped', 'admin', {
            intervalRounds: gs.breakSettings.intervalRounds
        }, { roundsSinceLastBreak: prevCounter });
        this._ui.showStatus('Next scheduled break will be skipped.', 'info');
        this.renderPhaseIndicator();
    }

    /**
     * End the tournament immediately. Direct jump to tournament_end.
     */
    async endTournament() {
        const gs = this._gameState;
        const current = this.getCurrentPhase();
        if (!current || current === 'tournament_end') return;

        const previousPhase = { ...gs.currentPhase };
        gs.currentPhase = {
            name: 'tournament_end',
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString()
        };
        gs.status = 'finished';

        await this._save();
        this._logAction('phase_advanced', 'phase', {
            fromPhase: current,
            toPhase: 'tournament_end',
            tournamentEnded: true,
            roundNumber: gs.currentPhase.roundNumber
        }, { currentPhase: previousPhase, status: 'playing' });

        this._ui.showStatus('Tournament ended.', 'info');
        this.recheckRequirements();
        this.renderPhaseIndicator();
    }

    // ── Requirements ─────────────────────────────────────────────

    /**
     * Recalculate requirements for the current phase and cache them.
     * Call from GodApp.updateDisplay() and after any manager state change.
     */
    recheckRequirements() {
        const phase = this.getCurrentPhase();
        if (!phase) {
            this._cachedReqs = { items: [], allMet: false };
            return;
        }
        const items = this._calculateRequirements(phase);
        this._cachedReqs = {
            items,
            allMet: items.length === 0 || items.every(r => r.met)
        };

        // Auto-advance lobby_ready when all players are ready
        if (AUTO_ADVANCE_WHEN_MET.includes(phase) && this._cachedReqs.allMet && !this._autoAdvancePending) {
            this._autoAdvancePending = true;
            setTimeout(async () => {
                if (this.getCurrentPhase() === phase) {
                    await this.advancePhase();
                }
                this._autoAdvancePending = false;
            }, 100);
        }
    }

    /**
     * Get cached requirements for current phase.
     * @returns {{ items: Array<{label: string, met: boolean}>, allMet: boolean }}
     */
    getPhaseRequirements() {
        return this._cachedReqs;
    }

    /**
     * Calculate requirements for a specific phase.
     * @param {string} phaseName
     * @returns {Array<{label: string, met: boolean}>}
     */
    _calculateRequirements(phaseName) {
        const gs = this._gameState;
        const teams = gs.teams || [];
        const queue = gs.gameQueue || [];
        const players = gs.players || {};

        switch (phaseName) {
            case 'pre_game_setup':
                return [
                    {
                        label: 'Room hexes marked on board',
                        met: (gs.rooms || []).length >= 1
                    },
                    {
                        label: 'All teams have players',
                        met: teams.length > 0 && teams.every(t => {
                            const count = Object.values(players)
                                .filter(p => String(p.teamId) === String(t.id)).length;
                            return count >= 2;
                        })
                    }
                ];

            case 'challenge_selection':
                return [
                    {
                        label: 'At least one match queued',
                        met: queue.some(m =>
                            !m.isBreak && (m.status === 'pending' || m.status === 'ongoing')
                        )
                    }
                ];

            case 'pre_game_instructions':
                return [
                    {
                        label: 'Match assignments displayed to teams',
                        met: queue.some(m =>
                            !m.isBreak && (m.status === 'pending' || m.status === 'ongoing')
                        )
                    }
                ];

            case 'lobby_ready': {
                const lobbyReady = gs.lobbyReady || {};
                const mustReady = this._getPlayersWhoMustReady();

                if (mustReady.length === 0) {
                    return [{ label: 'No players need to ready up', met: true }];
                }

                const readyCount = mustReady.filter(uid => lobbyReady[uid]?.ready).length;
                const allReady = readyCount === mustReady.length;

                return [
                    {
                        label: `${readyCount}/${mustReady.length} players ready`,
                        met: allReady
                    }
                ];
            }

            case 'break':
                // Admin ends break manually — never auto-met
                return [
                    { label: 'Admin ends break', met: false }
                ];

            case 'matches_in_progress':
                return [
                    {
                        label: 'All match results confirmed',
                        met: !queue.some(m =>
                            !m.isBreak && m.status === 'ongoing'
                        )
                    }
                ];

            case 'scoring_and_placement':
                return [
                    {
                        label: 'All winning teams placed plates',
                        met: this._getPendingHexCount() === 0
                    }
                ];

            case 'spell_phase': {
                const sp = gs.spellPhase;
                // No spell system or no active spell phase → auto-met (backward compatible)
                if (!sp || !sp.isActive) return [];
                const allDone = sp.turnOrder && sp.turnOrder.length > 0 &&
                    sp.teamsCompleted && sp.teamsCompleted.length >= sp.turnOrder.length;
                return [{
                    label: allDone
                        ? 'All teams completed spell phase'
                        : `Spell turns: ${sp.teamsCompleted?.length || 0}/${sp.turnOrder?.length || 0} teams done`,
                    met: allDone
                }];
            }

            case 'round_end': {
                const currentRound = gs.currentPhase?.roundNumber || 0;
                const history = gs.pointsHistory || [];
                return [
                    {
                        label: 'Round points awarded',
                        met: history.some(e => e.round === currentRound)
                    }
                ];
            }

            case 'round_start':
                // Auto-advance: always met
                return [];

            case 'tournament_end':
                // Terminal
                return [];

            default:
                return [];
        }
    }

    // ── Phase transition helpers ─────────────────────────────────

    /**
     * Get the effective next phase, skipping break and auto-advance phases.
     * Special: round_end loops back to round_start (not tournament_end).
     */
    _getEffectiveNextPhase(currentPhaseName) {
        if (currentPhaseName === 'round_end') {
            return 'round_start';
        }

        const idx = PHASE_ORDER.indexOf(currentPhaseName);
        if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;

        let nextIdx = idx + 1;
        while (nextIdx < PHASE_ORDER.length && SKIP_IN_LINEAR_FLOW.includes(PHASE_ORDER[nextIdx])) {
            nextIdx++;
        }
        return PHASE_ORDER[nextIdx] || null;
    }

    /**
     * Handle phases that auto-advance immediately.
     */
    async _handleAutoAdvance(phaseName) {
        if (phaseName === 'round_start') {
            // Brief pause for logging, then advance
            await this.advancePhase();
        }
        // spell_phase is now interactive (Weeks 8-9) — uses AUTO_ADVANCE_WHEN_MET
        // pre_game_instructions is a manual admin phase (Week 6)
        // lobby_ready uses AUTO_ADVANCE_WHEN_MET (handled in recheckRequirements)
    }

    // ── Lobby Ready ─────────────────────────────────────────────

    /**
     * Get UIDs of all players who must confirm ready in lobby phase.
     * Only players on teams that have pending/ongoing matches this round.
     * @returns {string[]}
     */
    _getPlayersWhoMustReady() {
        const gs = this._gameState;
        const queue = gs.gameQueue || [];
        const teams = gs.teams || [];

        // Collect team IDs that have pending/ongoing matches
        const activeTeamIds = new Set();
        queue.forEach(match => {
            if (match.isBreak || match.status === 'completed') return;
            (match.sides || []).forEach(side => {
                (side.players || []).forEach(player => {
                    if (player.teamId !== undefined) {
                        activeTeamIds.add(String(player.teamId));
                    }
                });
            });
        });

        // Collect player UIDs from those teams
        const playerUids = [];
        teams.forEach(team => {
            if (!activeTeamIds.has(String(team.id))) return;
            (team.players || []).forEach(player => {
                if (player.uid) {
                    playerUids.push(player.uid);
                }
            });
        });

        return playerUids;
    }

    /**
     * Reset the lobbyReady map. Called when entering lobby_ready phase.
     */
    _resetLobbyReady() {
        this._gameState.lobbyReady = {};
    }

    /**
     * Force all required players to ready status (admin override).
     */
    forceAllReady() {
        if (this.getCurrentPhase() !== 'lobby_ready') return;

        const gs = this._gameState;
        if (!gs.lobbyReady) gs.lobbyReady = {};

        const mustReady = this._getPlayersWhoMustReady();
        const teams = gs.teams || [];
        const prevLobbyState = { ...(gs.lobbyReady || {}) };

        mustReady.forEach(uid => {
            if (gs.lobbyReady[uid]?.ready) return;
            // Find player name and team
            let playerName = uid;
            let teamId = null;
            for (const team of teams) {
                const player = (team.players || []).find(p => p.uid === uid);
                if (player) {
                    playerName = player.name || player.email || uid;
                    teamId = team.id;
                    break;
                }
            }
            gs.lobbyReady[uid] = {
                ready: true,
                readyAt: new Date().toISOString(),
                teamId: teamId,
                name: playerName
            };
        });

        this._logAction('force_all_ready', 'admin', {
            playerCount: mustReady.length,
            roundNumber: gs.currentPhase?.roundNumber
        }, { lobbyReady: prevLobbyState });
    }

    // ── UI Rendering ─────────────────────────────────────────────

    /**
     * Render/update the phase indicator bar in the DOM.
     * Called from GodApp.updateDisplay() and after phase changes.
     */
    renderPhaseIndicator() {
        const bar = document.getElementById('phaseIndicatorBar');
        if (!bar) return;

        const gs = this._gameState;
        const phase = this.getCurrentPhase();

        const broadcastBar = document.getElementById('broadcastBar');
        const displayControlBar = document.getElementById('displayControlBar');

        // Show only when a tournament is loaded and has a currentPhase
        if (!phase || !gs.teams) {
            bar.style.display = 'none';
            if (broadcastBar) broadcastBar.style.display = 'none';
            if (displayControlBar) displayControlBar.style.display = 'none';
            return;
        }

        bar.style.display = '';
        if (broadcastBar) {
            broadcastBar.style.display = 'flex';
            // Sync broadcast input with current value
            const broadcastInput = document.getElementById('broadcastInput');
            if (broadcastInput && gs.broadcastMessage?.text && !broadcastInput.value) {
                broadcastInput.value = gs.broadcastMessage.text;
            }
        }
        if (displayControlBar) {
            displayControlBar.style.display = 'flex';
            // Sync display override dropdown with current value
            const modeSelect = document.getElementById('displayModeOverride');
            if (modeSelect) {
                modeSelect.value = gs.displayOverride?.mode || '';
            }
            const intervalSelect = document.getElementById('displayRotationInterval');
            if (intervalSelect && gs.displayOverride?.rotationInterval) {
                intervalSelect.value = String(gs.displayOverride.rotationInterval);
            }
        }

        // Break styling
        bar.classList.toggle('phase-break', phase === 'break');
        bar.classList.toggle('phase-ended', phase === 'tournament_end');

        // Phase name + icon
        const nameEl = document.getElementById('phaseIndicatorName');
        const iconEl = document.getElementById('phaseIndicatorIcon');
        const roundEl = document.getElementById('phaseIndicatorRound');
        if (nameEl) nameEl.textContent = this.getCurrentPhaseDisplayName();
        if (iconEl) iconEl.textContent = this.getCurrentPhaseIcon();
        if (roundEl) {
            const round = gs.currentPhase?.roundNumber || 0;
            roundEl.textContent = round > 0 ? `Round ${round}` : '';
            roundEl.style.display = round > 0 ? '' : 'none';
        }

        // Requirements checklist
        const listEl = document.getElementById('phaseRequirementsList');
        if (listEl) {
            const reqs = this._cachedReqs;
            if (reqs.items.length === 0) {
                listEl.innerHTML = '';
            } else {
                listEl.innerHTML = reqs.items.map(r =>
                    `<span class="phase-req-item ${r.met ? 'met' : 'unmet'}" title="${r.label}">` +
                    `<span class="phase-req-check">${r.met ? '\u2713' : '\u2717'}</span> ` +
                    `${this._escHtml(r.label)}</span>`
                ).join('');
            }
        }

        // Buttons
        const advBtn = document.getElementById('advancePhaseBtn');
        const forceBtn = document.getElementById('forceAdvanceBtn');
        const breakBtn = document.getElementById('insertBreakBtn');

        if (advBtn) {
            const isBreak = phase === 'break';
            const isEnd = phase === 'tournament_end';
            advBtn.textContent = isBreak ? 'End Break \u25B6' : 'Next Phase \u25B6';
            advBtn.disabled = isEnd || (!isBreak && !this._cachedReqs.allMet);
            advBtn.onclick = isBreak
                ? () => window.endBreak()
                : () => window.advancePhase();
        }
        if (forceBtn) {
            forceBtn.style.display = (phase === 'tournament_end' || phase === 'break') ? 'none' : '';
        }
        if (breakBtn) {
            breakBtn.style.display = (phase === 'break' || phase === 'tournament_end' || phase === 'pre_game_setup') ? 'none' : '';
        }

        // Lobby ready admin controls
        const lobbyControls = document.getElementById('lobbyAdminControls');
        if (lobbyControls) {
            if (phase === 'lobby_ready') {
                lobbyControls.style.display = '';
                lobbyControls.innerHTML =
                    `<button class="btn-small secondary" onclick="forceAllReady()" title="Mark all players as ready">Force All Ready</button>`;
            } else {
                lobbyControls.style.display = 'none';
                lobbyControls.innerHTML = '';
            }
        }

        // Break interval badge
        const breakBadge = document.getElementById('breakIntervalBadge');
        if (breakBadge) {
            const bs = gs.breakSettings;
            if (bs && bs.intervalRounds > 0 && phase !== 'break' && phase !== 'tournament_end' && phase !== 'pre_game_setup') {
                const since = bs.roundsSinceLastBreak || 0;
                const interval = bs.intervalRounds;
                breakBadge.textContent = `\u23F8 ${since}/${interval}`;
                breakBadge.style.display = '';
                breakBadge.className = 'break-interval-badge' + (since >= interval ? ' break-due' : '');
            } else {
                breakBadge.style.display = 'none';
            }
        }
    }

    // ── Force Advance Modal ──────────────────────────────────────

    openForceAdvanceModal() {
        const modal = document.getElementById('forceAdvanceModal');
        if (!modal) return;

        // Populate unmet requirements list
        const listEl = document.getElementById('forceAdvanceRequirements');
        if (listEl) {
            const reqs = this._cachedReqs;
            listEl.innerHTML = reqs.items.map(r =>
                `<div class="force-advance-req ${r.met ? 'met' : 'unmet'}">` +
                `<span>${r.met ? '\u2713' : '\u2717'}</span> ${this._escHtml(r.label)}</div>`
            ).join('');
        }

        const nextEl = document.getElementById('forceAdvanceNextPhase');
        if (nextEl) {
            nextEl.textContent = this.getNextPhaseDisplayName() || '---';
        }

        modal.style.display = 'flex';
    }

    closeForceAdvanceModal() {
        const modal = document.getElementById('forceAdvanceModal');
        if (modal) modal.style.display = 'none';
    }

    // ── Utilities ────────────────────────────────────────────────

    /** Escape HTML to prevent XSS in dynamic content */
    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

window.PhaseManager = PhaseManager;
