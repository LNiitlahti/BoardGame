/**
 * ScoringCeremony — Animated step-by-step scoring sequence
 *
 * Plays after each round during scoring_and_placement phase.
 * Reads actions from ActionLogger and presents them as animated steps.
 *
 * Runs on god.html (compact admin view, drives ceremony state via Firestore)
 * and view.html (full-screen spectator view, reads ceremony state from Firestore).
 *
 * Phase 3 Sub-Task 3E.
 */

class ScoringCeremony {

    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {Function} deps.saveCallback        - (triggerBtn) => saveGameState
     * @param {Function} [deps.logActionCallback]  - (type, cat, payload, prev) => void
     * @param {Function} [deps.getActionLogEntries] - async (roundNumber) => entries[]
     * @param {Function} [deps.onStepChanged]      - (stepData) => void (for UI)
     * @param {Function} [deps.onComplete]          - () => void
     * @param {string}   deps.context              - 'god' | 'view'
     */
    constructor(gameState, deps = {}) {
        this._gameState = gameState;
        this._save = deps.saveCallback || (() => {});
        this._logAction = deps.logActionCallback || (() => {});
        this._getEntries = deps.getActionLogEntries || (async () => []);
        this._onStepChanged = deps.onStepChanged || (() => {});
        this._onCompleteCallback = deps.onComplete || null;
        this._context = deps.context || 'view';

        this._steps = [];
        this._currentStepIndex = -1;
        this._isActive = false;
        this._isPaused = false;
        this._roundNumber = 0;
        this._stepTimer = null;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Build the ceremony step queue from action log entries for a round.
     * @param {number} roundNumber
     */
    async queueActions(roundNumber) {
        this._roundNumber = roundNumber;
        this._steps = [];
        this._currentStepIndex = -1;

        try {
            const entries = await this._getEntries(roundNumber);
            this._steps = this._buildStepSequence(entries);
        } catch (err) {
            console.error('[Ceremony] Failed to load actions:', err);
            // Always have at least the summary step
            this._steps = [this._createSummaryStep()];
        }
    }

    /**
     * Start or resume playback.
     */
    async play() {
        if (this._steps.length === 0) return;

        this._isPaused = false;
        this._isActive = true;

        if (this._currentStepIndex < 0) {
            this._logAction('ceremony_started', 'phase', {
                roundNumber: this._roundNumber,
                totalSteps: this._steps.length
            }, null);
        }

        this._syncCeremonyState();
        await this._playNextStep();
    }

    /**
     * Pause playback. Can be resumed with play().
     */
    pause() {
        this._isPaused = true;
        clearTimeout(this._stepTimer);
        this._syncCeremonyState();
    }

    /**
     * Skip to the end. Completes the ceremony immediately.
     */
    skip() {
        clearTimeout(this._stepTimer);
        this._currentStepIndex = this._steps.length;
        this._isActive = false;
        this._syncCeremonyState();

        this._logAction('ceremony_skipped', 'admin', {
            roundNumber: this._roundNumber,
            skippedAtStep: this._currentStepIndex
        }, null);

        if (this._onCompleteCallback) this._onCompleteCallback();
    }

    /**
     * Set the completion callback.
     * @param {Function} callback
     */
    onComplete(callback) {
        this._onCompleteCallback = callback;
    }

    /**
     * Check if the ceremony is currently active.
     * @returns {boolean}
     */
    get isActive() {
        return this._isActive;
    }

    // ------------------------------------------------------------------
    // Step sequence builder
    // ------------------------------------------------------------------

    /**
     * Build ordered step sequence from raw action log entries.
     * Groups into: match_victories → plate_placements → points_awarded → spell_effects → summary
     * @param {Array} entries - Action log entries for the round
     * @returns {Array} steps
     */
    _buildStepSequence(entries) {
        const steps = [];

        // 1. Match Victory Points
        const matchResults = entries.filter(e =>
            e.actionType === 'match_result_confirmed' && !e.undone
        );
        matchResults.forEach(entry => {
            const p = entry.payload || {};
            const teams = this._gameState.teams || [];

            // Find winner info
            let winnerName = 'Unknown';
            let winnerColor = '#fff';
            if (p.winningTeamIds?.length > 0) {
                const team = teams.find(t => String(t.id) === String(p.winningTeamIds[0]));
                if (team) {
                    winnerName = team.name;
                    winnerColor = team.color || '#2278a3';
                }
            }

            const gameName = p.gameName || p.game || 'Match';

            steps.push({
                type: 'match_victory',
                icon: '\u{1F3C6}',
                title: `${winnerName} wins ${gameName}`,
                teamColor: winnerColor,
                detail: p.matchId ? `Match #${p.matchNumber || ''}` : null,
                duration: 4000
            });
        });

        // 2. Plate Placements
        const plates = entries.filter(e =>
            e.actionType === 'plate_placed' && !e.undone
        );
        plates.forEach(entry => {
            const p = entry.payload || {};
            const teams = this._gameState.teams || [];
            const team = teams.find(t => String(t.id) === String(p.teamId));
            const teamName = team?.name || p.teamName || 'Team';
            const teamColor = team?.color || '#2278a3';

            steps.push({
                type: 'plate_placement',
                icon: '\u{1F537}',
                title: `${teamName} places hex`,
                teamColor: teamColor,
                detail: p.hexCoord ? `at ${p.hexCoord}` : null,
                duration: 3000
            });
        });

        // 3. Points Awarded (heart hex points, round points)
        const pointsEntries = entries.filter(e =>
            e.actionType === 'points_awarded' && !e.undone
        );
        pointsEntries.forEach(entry => {
            const p = entry.payload || {};
            const pointsMap = p.pointsAwarded || {};

            // Show each team's points as a single combined step
            const pointsList = Object.entries(pointsMap)
                .filter(([_, pts]) => pts > 0)
                .map(([name, pts]) => `${name}: +${pts}`)
                .join(', ');

            if (pointsList) {
                steps.push({
                    type: 'points_awarded',
                    icon: '\u{2764}\u{FE0F}',
                    title: 'Heart Hex Points',
                    teamColor: '#ef4444',
                    detail: pointsList,
                    duration: 4000
                });
            }
        });

        // 4. Spell Effects
        const spellCasts = entries.filter(e =>
            e.actionType === 'spell_cast' && !e.undone
        );
        spellCasts.forEach(entry => {
            const p = entry.payload || {};
            const teams = this._gameState.teams || [];
            const caster = teams.find(t => String(t.id) === String(p.castByTeamId));
            const casterName = caster?.name || 'Team';
            const casterColor = caster?.color || '#a855f7';
            const spellName = p.spellName || p.spellNameEn || 'Spell';

            steps.push({
                type: 'spell_effect',
                icon: '\u{2728}',
                title: `${casterName} casts ${spellName}`,
                teamColor: casterColor,
                detail: p.displayText || null,
                duration: 4000
            });
        });

        // 5. Round Summary (always last)
        steps.push(this._createSummaryStep());

        return steps;
    }

    /**
     * Create the round summary step.
     * @returns {Object} step
     */
    _createSummaryStep() {
        return {
            type: 'round_summary',
            icon: '\u{1F4CA}',
            title: `Round ${this._roundNumber} Complete`,
            teamColor: '#00d4ff',
            detail: null,
            duration: 5000
        };
    }

    // ------------------------------------------------------------------
    // Playback engine
    // ------------------------------------------------------------------

    /**
     * Advance to next step and render it.
     */
    async _playNextStep() {
        if (this._isPaused) return;

        this._currentStepIndex++;

        if (this._currentStepIndex >= this._steps.length) {
            // Ceremony complete
            this._isActive = false;
            this._syncCeremonyState();

            this._logAction('ceremony_completed', 'phase', {
                roundNumber: this._roundNumber,
                totalSteps: this._steps.length
            }, null);

            if (this._onCompleteCallback) this._onCompleteCallback();
            return;
        }

        const step = this._steps[this._currentStepIndex];
        this._onStepChanged(step);
        this._syncCeremonyState();

        this._stepTimer = setTimeout(() => {
            this._playNextStep();
        }, step.duration);
    }

    // ------------------------------------------------------------------
    // Firestore sync (god.html writes, view.html reads)
    // ------------------------------------------------------------------

    /**
     * Sync ceremony state to Firestore for cross-page display.
     * Only god.html context writes; view.html only reads.
     */
    _syncCeremonyState() {
        if (this._context !== 'god') return;

        this._gameState.ceremonyState = {
            isActive: this._isActive,
            roundNumber: this._roundNumber,
            currentStepIndex: this._currentStepIndex,
            currentStep: this._steps[this._currentStepIndex] || null,
            isPaused: this._isPaused,
            totalSteps: this._steps.length
        };

        this._save();
    }

    // ------------------------------------------------------------------
    // Rendering helpers (for view.html ceremony overlay)
    // ------------------------------------------------------------------

    /**
     * Render a ceremony step into a container element.
     * Used by both view.html (full-screen) and god.html (compact).
     *
     * @param {HTMLElement} container
     * @param {Object} step
     * @param {Object} gameState
     * @param {string} mode - 'full' (view.html) or 'compact' (god.html)
     */
    static renderStep(container, step, gameState, mode = 'full') {
        if (!step || !container) return;

        if (mode === 'compact') {
            ScoringCeremony._renderCompactStep(container, step, gameState);
            return;
        }

        // Full-screen rendering
        if (step.type === 'round_summary') {
            ScoringCeremony._renderSummaryStep(container, step, gameState);
            return;
        }

        const colorHex = ScoringCeremony._resolveColor(step.teamColor);

        container.innerHTML = `
            <div class="ceremony-step">
                <div class="ceremony-step-label">${ScoringCeremony._stepLabel(step.type)}</div>
                <div class="ceremony-step-icon">${step.icon || ''}</div>
                <div class="ceremony-step-title">${step.title || ''}</div>
                ${step.detail ? `<div class="ceremony-step-detail">${step.detail}</div>` : ''}
                ${step.type === 'match_victory' ? `<div class="ceremony-team-name ceremony-points" style="color: ${colorHex};">${step.title.split(' wins ')[0] || ''}</div>` : ''}
            </div>
        `;
    }

    /**
     * Render the round summary step with standings.
     */
    static _renderSummaryStep(container, step, gameState) {
        const teams = [...(gameState?.teams || [])].sort((a, b) =>
            (b.points || 0) - (a.points || 0)
        );

        let rowsHTML = '';
        teams.forEach((team, idx) => {
            const color = ScoringCeremony._resolveColor(team.color);
            rowsHTML += `
                <div class="ceremony-summary-row" style="border-left-color: ${color};">
                    <span class="ceremony-summary-rank">${idx + 1}</span>
                    <span class="ceremony-summary-name" style="color: ${color};">${team.name || 'Team'}</span>
                    <span class="ceremony-summary-pts">${team.points || 0} pts</span>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="ceremony-step">
                <div class="ceremony-step-icon">${step.icon || ''}</div>
                <div class="ceremony-summary">
                    <div class="ceremony-summary-title">${step.title}</div>
                    ${rowsHTML}
                </div>
            </div>
        `;
    }

    /**
     * Render a compact step for god.html admin panel.
     */
    static _renderCompactStep(container, step, gameState) {
        const colorHex = ScoringCeremony._resolveColor(step.teamColor);

        container.innerHTML = `
            <span class="step-type">${ScoringCeremony._stepLabel(step.type)}</span>
            <span>${step.icon || ''} ${step.title || ''}</span>
            ${step.detail ? `<span style="color: #9aa1ad; font-size: 0.8rem;"> — ${step.detail}</span>` : ''}
        `;
    }

    /**
     * Human-readable label for step type.
     */
    static _stepLabel(type) {
        const labels = {
            match_victory: 'Match Victory',
            plate_placement: 'Hex Placement',
            points_awarded: 'Points Awarded',
            spell_effect: 'Spell Cast',
            round_summary: 'Round Summary'
        };
        return labels[type] || type;
    }

    /**
     * Resolve a color name or hex value to a hex code.
     */
    static _resolveColor(color) {
        if (color && color.startsWith('#')) return color;
        const map = {
            'blue': '#2278a3', 'red': '#de392c', 'green': '#2e9158',
            'yellow': '#f7ba32', 'purple': '#a855f7', 'orange': '#f97316',
            'teal': '#14b8a6', 'pink': '#ec4899'
        };
        return map[color?.toLowerCase()] || '#2278a3';
    }
}

window.ScoringCeremony = ScoringCeremony;
