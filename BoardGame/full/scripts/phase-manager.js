/**
 * PhaseManager — Tournament Phase State Machine
 *
 * Owns the tournament phase flow. Calculates advancement requirements
 * from gameState, provides UI rendering for the persistent phase
 * indicator bar, and logs all phase transitions via ActionLogger.
 *
 * Firestore field:
 *   gameState.currentPhase = { name, roundNumber, startedAt, returnToPhase?,
 *                              challengeGamesPlayed? }
 *
 * Requirements and canAdvance are computed client-side only (not persisted).
 *
 * Phase flow per round:
 *   SCORING_VP → SCORING_HEX → HEX_PLACEMENT_1 → SPELL_WINDOW_1
 *   → HEX_PLACEMENT_2 → CHALLENGES → SPELL_WINDOW_2 → CHALLENGE_GAME
 *   → SPELL_WINDOW_3 (loop→CHALLENGE_GAME up to 7×) → BOARD_RESOLVED
 *   → SPELL_WINDOW_4 (loop→CHALLENGES) → MATCH_1_SETUP → MATCH_1_LOBBY
 *   → MATCH_1_PLAYING → MATCH_2_SETUP → MATCH_2_LOBBY → MATCH_2_PLAYING
 *   → ROUND_ADVANCE → (loop to SCORING_VP)
 *
 * Lobby readiness:
 *   gameState.lobbyReady = { [playerUid]: { gameLobby, discord, ... } }
 *   Two-status readiness: game lobby + Discord channel. Both must be true.
 *   Reset to {} when entering match_1_lobby or match_2_lobby.
 *   Auto-advances when all playing players are ready.
 *
 * Spell windows:
 *   Optional phases where admin can begin spell casting or skip.
 *   If spellPhase.isActive, requirements track turn completion.
 *   Admin calls beginSpells() to start, or just advances to skip.
 */

// ── Phase constants ──────────────────────────────────────────────

const PHASE_ORDER = [
    'pre_game_setup',
    'scoring_vp',
    'scoring_hex',
    'hex_placement_1',
    'spell_window_1',
    'hex_placement_2',
    'challenges',
    'spell_window_2',
    'challenge_game',
    'spell_window_3',
    'board_resolved',
    'spell_window_4',
    'matches_in_progress',
    'round_advance',
    'break',
    'tournament_end'
];

const PHASE_DISPLAY = {
    pre_game_setup:   { name: 'Pre-Game Setup',       icon: ICON_SVGS.settings },
    scoring_vp:       { name: 'Scoring: Victory Points', icon: ICON_SVGS.trophy },
    scoring_hex:      { name: 'Scoring: Hex',         icon: ICON_SVGS.hexagon },
    hex_placement_1:  { name: 'Hex Placement — Game 1', icon: ICON_SVGS.map },
    spell_window_1:   { name: 'Spell Window',         icon: ICON_SVGS.sparkles },
    hex_placement_2:  { name: 'Hex Placement — Game 2', icon: ICON_SVGS.map },
    challenges:       { name: 'Challenges Issued',    icon: ICON_SVGS.swords },
    spell_window_2:   { name: 'Spell Window',         icon: ICON_SVGS.sparkles },
    challenge_game:   { name: 'Challenge Game',       icon: ICON_SVGS.gamepad2 },
    spell_window_3:   { name: 'Spell Window',         icon: ICON_SVGS.sparkles },
    board_resolved:   { name: 'Board Resolved',       icon: ICON_SVGS.shield },
    spell_window_4:   { name: 'Spell Window',         icon: ICON_SVGS.sparkles },
    matches_in_progress: { name: 'Matches In Progress', icon: ICON_SVGS.gamepad2 },
    round_advance:    { name: 'Round Advance',        icon: ICON_SVGS.skipForward },
    break:            { name: 'Break',                icon: ICON_SVGS.pause },
    tournament_end:   { name: 'Tournament End',       icon: ICON_SVGS.trophy }
};

/** Phases that auto-advance immediately (no admin interaction needed) */
const AUTO_ADVANCE_PHASES = ['round_advance'];

/**
 * Phases that auto-advance only when all requirements are met. Slot lobby
 * readiness auto-advance is handled per-slot inside recheckRequirements()/
 * advanceSlot(), not through this generic whole-phase mechanism.
 */
const AUTO_ADVANCE_WHEN_MET = [];

/**
 * Match 1 and Match 2 progress independently within 'matches_in_progress'
 * (players don't overlap between the round's two match slots, so there's
 * no reason to force one to fully finish before the other can even start).
 * Each slot walks this same sub-phase sequence on its own.
 */
const SLOT_SUB_PHASES = ['setup', 'lobby', 'playing', 'done'];

const SLOT_SUB_PHASE_DISPLAY = {
    setup:   { name: 'Setup',   icon: ICON_SVGS.settings },
    lobby:   { name: 'Lobby',   icon: ICON_SVGS.gamepad2 },
    playing: { name: 'Playing', icon: ICON_SVGS.gamepad2 },
    done:    { name: 'Done',    icon: ICON_SVGS.circleCheck }
};

/** Phases skipped in normal linear flow (only entered via dedicated methods) */
const SKIP_IN_LINEAR_FLOW = ['break'];

/** Valid loop-back targets from spell windows */
const LOOP_TARGETS = {
    spell_window_3: 'challenge_game',   // Loop back for another challenge game
    spell_window_4: 'challenges'        // Loop back for another challenge round
};

/** Maximum challenge games per round */
const MAX_CHALLENGE_GAMES = 7;

// Match ids we've already warned about for missing .slot tags. getSlotRequirements()
// is called from render loops (potentially on every state update/poll), so this
// dedupes the console.warn per match id instead of spamming it on every re-render.
const _warnedUntaggedSlotMatchIds = new Set();

function _warnUntaggedSlotMatch(m) {
    if (_warnedUntaggedSlotMatchIds.has(m.id)) return;
    _warnedUntaggedSlotMatchIds.add(m.id);
    console.warn(`[PhaseManager] Match ${m.id} has no .slot tag — counted toward BOTH slot 1 and slot 2 (ambiguous, by design — see getSlotRequirements()'s doc comment). Run e2e-cleanup-stale-queue.js to retag or purge stale queue entries.`);
}

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

        // Re-entrancy guards: one in-flight advance at a time (a double-click
        // during the save used to re-pass the requirements gate against the
        // previous phase's cached allMet and skip a phase).
        this._advanceInFlight = false;
        this._slotAdvanceInFlight = false;
        this._pendingAutoAdvance = null;

        // ── Hooks (wired by GodApp) ──
        // this._onAwardPoints        — fire when leaving scoring_hex
        // this._onScoringCeremony    — fire when entering scoring_vp
        // this._onSpellPhaseEntered  — fire when admin begins spells
        // this._onRoundStartSpells   — fire at start of round (expire conditions, backup)
        // this._onRoundStartBackup   — fire at start of round
    }

    // ── Legacy phase migration ──────────────────────────────────

    /**
     * Migrate old phase names to new ones. Call once on load.
     * Handles tournaments mid-game with the old phase flow.
     */
    migratePhaseIfNeeded() {
        const gs = this._gameState;
        if (!gs.currentPhase?.name) return false;

        const oldName = gs.currentPhase.name;

        // Ancient single-phase 'matches_in_progress' (from before per-slot
        // tracking existed) happens to share its name with the current
        // slots-based phase — the only way to tell them apart is that the
        // ancient one has no `slots` object yet.
        if (oldName === 'matches_in_progress' && !gs.currentPhase.slots) {
            console.warn('[PhaseManager] Migrating ancient "matches_in_progress" phase to slot-based model');
            gs.currentPhase.slots = { 1: 'playing', 2: 'setup' };
            return true;
        }

        const MIGRATION_MAP = {
            'round_start':           'scoring_vp',
            'challenge_selection':   'challenges',
            'pre_game_instructions': 'match_1_setup',
            'lobby_ready':           'match_1_lobby',
            'scoring_and_placement': 'scoring_vp',
            'spell_phase':           'spell_window_1',
            'round_end':             'round_advance'
        };

        // The six now-retired per-slot linear phase names collapse onto the
        // single 'matches_in_progress' phase + a `slots` object reflecting
        // where the tournament actually was (e.g. mid Match 1 playing, Match
        // 2 not started yet -> {1:'playing', 2:'setup'}).
        const OLD_MATCH_PHASE_SLOTS = {
            'match_1_setup':   { 1: 'setup',   2: 'setup' },
            'match_1_lobby':   { 1: 'lobby',   2: 'setup' },
            'match_1_playing': { 1: 'playing', 2: 'setup' },
            'match_2_setup':   { 1: 'done',    2: 'setup' },
            'match_2_lobby':   { 1: 'done',    2: 'lobby' },
            'match_2_playing': { 1: 'done',    2: 'playing' }
        };

        const resolvedName = MIGRATION_MAP[oldName] || oldName;

        if (OLD_MATCH_PHASE_SLOTS[resolvedName]) {
            console.warn(`[PhaseManager] Migrating phase "${oldName}" → "matches_in_progress" (slots)`);
            gs.currentPhase.name = 'matches_in_progress';
            gs.currentPhase.slots = OLD_MATCH_PHASE_SLOTS[resolvedName];
            return true;
        }

        if (MIGRATION_MAP[oldName]) {
            console.warn(`[PhaseManager] Migrating phase "${oldName}" → "${resolvedName}"`);
            gs.currentPhase.name = resolvedName;
            return true;
        }

        return false;
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

    // ── Phase identity helpers ───────────────────────────────────

    /**
     * Is the current phase a lobby phase? With independent match slots,
     * "lobby" isn't a single whole-tournament phase anymore — true if
     * EITHER slot is currently in its own lobby sub-phase.
     */
    isLobbyPhase(phase) {
        const p = phase || this.getCurrentPhase();
        if (p !== 'matches_in_progress') return false;
        return this.getSlotSubPhase(1) === 'lobby' || this.getSlotSubPhase(2) === 'lobby';
    }

    /** Is the current phase a playing/match-in-progress phase? */
    isPlayingPhase(phase) {
        const p = phase || this.getCurrentPhase();
        if (p === 'challenge_game') return true;
        if (p !== 'matches_in_progress') return false;
        return this.getSlotSubPhase(1) === 'playing' || this.getSlotSubPhase(2) === 'playing';
    }

    /** Is the current phase a spell window? */
    isSpellWindow(phase) {
        const p = phase || this.getCurrentPhase();
        return p && p.startsWith('spell_window');
    }

    /** Is the current phase a match setup phase? */
    isMatchSetup(phase) {
        const p = phase || this.getCurrentPhase();
        if (p === 'challenges') return true;
        if (p !== 'matches_in_progress') return false;
        return this.getSlotSubPhase(1) === 'setup' || this.getSlotSubPhase(2) === 'setup';
    }

    // ── Slot (Match 1 / Match 2) state ───────────────────────────
    //
    // Match 1 and Match 2 progress independently while currentPhase.name
    // is 'matches_in_progress': gameState.currentPhase.slots = { 1: sub,
    // 2: sub }, each sub one of SLOT_SUB_PHASES. round_advance only
    // becomes reachable once both slots reach 'done' (see
    // _calculateRequirements('matches_in_progress') below).

    /** Sub-phase for one slot (1 or 2): 'setup' | 'lobby' | 'playing' | 'done' */
    getSlotSubPhase(slot) {
        return this._gameState.currentPhase?.slots?.[slot] || 'setup';
    }

    /** {name, icon} for a slot's current sub-phase, e.g. "Match 1 — Lobby" */
    getSlotDisplayInfo(slot) {
        const sub = this.getSlotSubPhase(slot);
        const info = SLOT_SUB_PHASE_DISPLAY[sub] || SLOT_SUB_PHASE_DISPLAY.setup;
        return { name: `Match ${slot} — ${info.name}`, icon: info.icon, subPhase: sub };
    }

    isSlotLobby(slot) {
        return this.getCurrentPhase() === 'matches_in_progress' && this.getSlotSubPhase(slot) === 'lobby';
    }

    isSlotPlaying(slot) {
        return this.getCurrentPhase() === 'matches_in_progress' && this.getSlotSubPhase(slot) === 'playing';
    }

    /** Are both match slots done? (the gate for leaving matches_in_progress) */
    bothSlotsDone() {
        return this.getSlotSubPhase(1) === 'done' && this.getSlotSubPhase(2) === 'done';
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
        if (this._advanceInFlight) return false;
        this._advanceInFlight = true;
        try {
            return await this._advancePhaseInner(force);
        } finally {
            this._advanceInFlight = false;
            // Auto-advance (round_advance) runs AFTER the guard is released
            // so its recursive advancePhase() call isn't swallowed by it.
            const auto = this._pendingAutoAdvance;
            this._pendingAutoAdvance = null;
            if (auto) await this._handleAutoAdvance(auto);
        }
    }

    /** Body of advancePhase — only ever called via the guarded wrapper above. */
    async _advancePhaseInner(force = false) {
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

        // Requirements gate — computed FRESH, never from _cachedReqs (the
        // cache can still describe the previous phase mid-save).
        if (!force) {
            const items = this._calculateRequirements(current);
            const allMet = items.length === 0 || items.every(r => r.met);
            if (!allMet) {
                this._ui.showStatus('Requirements not met. Use force advance to override.', 'warning');
                return false;
            }
        }

        const nextPhase = this._getEffectiveNextPhase(current);
        if (!nextPhase) {
            this._ui.showStatus('No next phase available.', 'warning');
            return false;
        }

        // Break interval check: when advancing into the matches segment, auto-insert break if due
        if (nextPhase === 'matches_in_progress' && this._isBreakDue()) {
            await this._autoInsertBreak('matches_in_progress');
            return true;
        }

        // ── Round number logic ──
        let newRound = gs.currentPhase?.roundNumber || 0;
        if (current === 'pre_game_setup' || current === 'round_advance') {
            newRound += 1;
        }

        // ── Preserve challenge game counter across phases within a round ──
        let challengeGamesPlayed = gs.currentPhase?.challengeGamesPlayed || 0;

        // Reset challenge counter at start of new round
        if (current === 'pre_game_setup' || current === 'round_advance') {
            challengeGamesPlayed = 0;
        }

        // Increment counter when entering challenge_game via linear flow
        // (loopBack from spell_window_3 handles its own increment separately)
        if (nextPhase === 'challenge_game') {
            challengeGamesPlayed++;
        }

        // ── Phase exit hooks ──

        // Award hex territory points when leaving scoring_hex (skip round 1 — no previous round)
        if (current === 'scoring_hex' && this._onAwardPoints && newRound > 1) {
            this._onAwardPoints();
        }

        // Clear spell phase state when leaving any spell window
        if (this.isSpellWindow(current)) {
            this._clearSpellPhaseState();
        }

        // Increment break interval counter when completing a round
        if (current === 'round_advance' && gs.breakSettings) {
            gs.breakSettings.roundsSinceLastBreak =
                (gs.breakSettings.roundsSinceLastBreak || 0) + 1;
        }

        const previousPhase = { ...gs.currentPhase };

        // ── Update gameState ──
        gs.currentPhase = {
            name: nextPhase,
            roundNumber: newRound,
            startedAt: new Date().toISOString(),
            challengeGamesPlayed: challengeGamesPlayed
        };

        // ── Phase enter hooks ──

        // Match 1 and Match 2 start out independently in their own 'setup'
        // sub-phase; each progresses on its own via advanceSlot() from here on.
        if (nextPhase === 'matches_in_progress') {
            gs.currentPhase.slots = { 1: 'setup', 2: 'setup' };
        }

        // Scoring ceremony when entering scoring_vp (skip round 1 — nothing to celebrate)
        if (nextPhase === 'scoring_vp' && this._onScoringCeremony && newRound > 1) {
            this._onScoringCeremony();
        }

        // Round start hooks (expire conditions, auto-backup)
        if (nextPhase === 'scoring_vp' && newRound > 0) {
            if (this._onRoundStartSpells) this._onRoundStartSpells();
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

        // Auto-advance (round_advance) is deferred to the wrapper's finally
        // block so it runs after the in-flight guard is released.
        if (AUTO_ADVANCE_PHASES.includes(nextPhase)) {
            this._pendingAutoAdvance = nextPhase;
        }

        this.recheckRequirements();
        this.renderPhaseIndicator();
        return true;
    }

    // ── Spell Window Control ────────────────────────────────────

    /**
     * Begin the spell casting phase during a spell window.
     * Called by admin when they want teams to cast spells.
     * Can only be called during spell_window_* phases.
     */
    async beginSpells() {
        const phase = this.getCurrentPhase();
        if (!this.isSpellWindow(phase)) {
            this._ui.showStatus('Can only begin spells during a spell window.', 'warning');
            return;
        }

        if (this._onSpellPhaseEntered) {
            this._onSpellPhaseEntered();
            await this._save();
            this.recheckRequirements();
            this.renderPhaseIndicator();
            this._ui.showStatus('Spell phase started! Teams can now cast spells.', 'success');
        }
    }

    /**
     * Clear spell phase active state (called when leaving a spell window).
     */
    _clearSpellPhaseState() {
        const gs = this._gameState;
        if (gs.spellPhase?.isActive) {
            gs.spellPhase.isActive = false;
        }
    }

    // ── Challenge Game Loop ─────────────────────────────────────

    /**
     * Loop back from the current spell window to its loop target.
     * Only valid from spell_window_3 (→ challenge_game) and
     * spell_window_4 (→ challenges).
     * @returns {Promise<boolean>}
     */
    async loopBack() {
        const current = this.getCurrentPhase();
        const target = LOOP_TARGETS[current];

        if (!target) {
            this._ui.showStatus('Cannot loop from this phase.', 'warning');
            return false;
        }

        const gs = this._gameState;
        const previousPhase = { ...gs.currentPhase };
        let challengeGamesPlayed = gs.currentPhase?.challengeGamesPlayed || 0;

        // Challenge game loop: check max, then increment for the next game
        if (current === 'spell_window_3') {
            // challengeGamesPlayed = games already played (including the one just finished)
            // Block if we've already played the max
            if (challengeGamesPlayed >= MAX_CHALLENGE_GAMES) {
                this._ui.showStatus(
                    `Maximum ${MAX_CHALLENGE_GAMES} challenge games per round reached.`,
                    'warning'
                );
                return false;
            }
            // Counter will be incremented by advancePhase when entering challenge_game next
            // But since loopBack sets phase directly (not via advancePhase),
            // we must increment here
            challengeGamesPlayed++;
        }

        // Challenge phase loop: reset game counter for new cycle
        if (current === 'spell_window_4') {
            challengeGamesPlayed = 0;
        }

        // Clear spell phase state before looping
        this._clearSpellPhaseState();

        gs.currentPhase = {
            name: target,
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString(),
            challengeGamesPlayed: challengeGamesPlayed
        };

        await this._save();

        this._logAction('phase_loop', 'phase', {
            fromPhase: current,
            toPhase: target,
            challengeGamesPlayed: challengeGamesPlayed,
            roundNumber: gs.currentPhase.roundNumber
        }, { currentPhase: previousPhase });

        this._ui.showStatus(
            `Looped back to ${PHASE_DISPLAY[target]?.name || target}`,
            'info'
        );

        this.recheckRequirements();
        this.renderPhaseIndicator();
        return true;
    }

    /**
     * Can the current phase loop back?
     * @returns {{ canLoop: boolean, target: string|null, label: string|null }}
     */
    getLoopInfo() {
        const current = this.getCurrentPhase();
        const target = LOOP_TARGETS[current];
        if (!target) return { canLoop: false, target: null, label: null };

        const gs = this._gameState;
        const gamesPlayed = gs.currentPhase?.challengeGamesPlayed || 0;

        if (current === 'spell_window_3' && gamesPlayed >= MAX_CHALLENGE_GAMES) {
            return { canLoop: false, target, label: `Max ${MAX_CHALLENGE_GAMES} challenge games reached` };
        }

        const targetName = PHASE_DISPLAY[target]?.name || target;
        if (current === 'spell_window_3') {
            return { canLoop: true, target, label: `\u{1F501} Loop to ${targetName} (${gamesPlayed + 1}/${MAX_CHALLENGE_GAMES})` };
        }
        return { canLoop: true, target, label: `\u{1F504} Loop to ${targetName}` };
    }

    // ── Break System ────────────────────────────────────────────

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
            returnToPhase: current,
            // Preserve each slot's progress across the break — a break taken
            // mid-match (e.g. Match 1 playing, Match 2 still in lobby) must
            // resume exactly where it was, not reset both slots to setup.
            returnSlots: current === 'matches_in_progress' ? { ...previousPhase.slots } : undefined,
            challengeGamesPlayed: gs.currentPhase?.challengeGamesPlayed || 0
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

        const returnTo = gs.currentPhase.returnToPhase || 'scoring_vp';
        const returnSlots = gs.currentPhase.returnSlots;
        const challengeGamesPlayed = gs.currentPhase.challengeGamesPlayed || 0;
        const previousPhase = { ...gs.currentPhase };

        // Reset break interval counter — but only for a real break. A
        // misclicked Insert Break + immediate End Break must not silently
        // cancel the next scheduled auto-break.
        const breakLastedMs = Date.now() - (Date.parse(gs.currentPhase.startedAt) || 0);
        if (gs.breakSettings && breakLastedMs >= 2 * 60 * 1000) {
            gs.breakSettings.roundsSinceLastBreak = 0;
            gs.breakSettings.lastBreakAt = new Date().toISOString();
        }

        gs.currentPhase = {
            name: returnTo,
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString(),
            challengeGamesPlayed: challengeGamesPlayed
        };
        if (returnTo === 'matches_in_progress' && returnSlots) {
            gs.currentPhase.slots = returnSlots;
        }

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

    _isBreakDue() {
        const s = this._gameState.breakSettings;
        if (!s || !s.intervalRounds || s.intervalRounds <= 0) return false;
        return (s.roundsSinceLastBreak || 0) >= s.intervalRounds;
    }

    async _autoInsertBreak(returnToPhase) {
        const gs = this._gameState;
        const previousPhase = { ...gs.currentPhase };

        gs.currentPhase = {
            name: 'break',
            roundNumber: gs.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString(),
            returnToPhase: returnToPhase,
            autoInserted: true,
            // This path only fires when advancing INTO a fresh matches_in_progress
            // (see the call site's `nextPhase === 'matches_in_progress'` guard) —
            // no match slots exist yet. Explicitly seed 'setup' (rather than
            // leaving returnSlots undefined) so endBreak() writes a clean
            // { 1: 'setup', 2: 'setup' } instead of letting Firestore's merge
            // leave the previous round's stale 'done' slots in place (bug #0).
            returnSlots: returnToPhase === 'matches_in_progress' ? { 1: 'setup', 2: 'setup' } : undefined,
            challengeGamesPlayed: gs.currentPhase?.challengeGamesPlayed || 0
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
            `Automatic break \u2014 ${gs.breakSettings?.roundsSinceLastBreak || 0} rounds since last break.`,
            'info'
        );
        this.recheckRequirements();
        this.renderPhaseIndicator();
    }

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

    closeBreakSettings() {
        const modal = document.getElementById('breakSettingsModal');
        if (modal) modal.style.display = 'none';
    }

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

        // Auto-advance lobby phases when all players are ready
        if (AUTO_ADVANCE_WHEN_MET.includes(phase) && this._cachedReqs.allMet && !this._autoAdvancePending) {
            this._autoAdvancePending = true;
            setTimeout(async () => {
                if (this.getCurrentPhase() === phase) {
                    await this.advancePhase();
                }
                this._autoAdvancePending = false;
            }, 100);
        }

        // Match slots auto-advance independently: each slot's own lobby ->
        // playing fires as soon as THAT slot's players are ready, regardless
        // of where the other slot currently is.
        if (phase === 'matches_in_progress') {
            [1, 2].forEach(slot => {
                if (this.getSlotSubPhase(slot) !== 'lobby') return;
                const guardKey = slot === 1 ? '_autoAdvanceSlot1Pending' : '_autoAdvanceSlot2Pending';
                if (this[guardKey]) return;
                if (!this.getSlotRequirements(slot).every(r => r.met)) return;
                this[guardKey] = true;
                setTimeout(async () => {
                    if (this.getSlotSubPhase(slot) === 'lobby') {
                        await this.advanceSlot(slot);
                    }
                    this[guardKey] = false;
                }, 100);
            });
        }
    }

    getPhaseRequirements() {
        return this._cachedReqs;
    }

    /**
     * Requirements for one match slot's current sub-phase (setup/lobby/
     * playing/done). Mirrors the old per-phase match_N_setup/lobby/playing
     * logic, generalized by slot and filtered to that slot's own queue
     * entries (entry.slot === slot).
     *
     * Tagged entries (entry.slot set) are trusted for the slot number, but
     * ONLY for the round they were tagged for (entry.roundNumber undefined,
     * or equal to the round in progress) — otherwise a match tagged "slot 2"
     * in a long-past round that was left pending/ongoing and never resolved
     * would block every future round's slot 2 forever.
     *
     * Untagged entries (created before slot tagging existed, or via a path
     * that never tags — e.g. god.html's match creation has no tagging step
     * at all) count for either slot — safer than silently hiding a real
     * match — but ONLY if they were created at/after the CURRENT round's
     * matches phase began (entry.createdAt >= currentPhase.startedAt).
     * Checking "roundNumber is undefined" alone is NOT a safe stand-in for
     * "created this round": it's true forever for legacy leftovers with no
     * roundNumber field at all, so it would let an indefinitely-growing
     * pool of untagged matches count as pending for every future round
     * forever — a slot could never reach 'done' (see TODO.md's "match slot
     * never reaches done" writeup: ~61 leftover queued matches from before
     * slot-tagging existed kept a round from ever reaching round_advance).
     * Comparing createdAt against the CURRENT phase's startedAt correctly
     * lets genuinely-ambiguous matches created THIS round still count for
     * both slots (preserving the safe-by-default behavior for new
     * ambiguous cases) while excluding anything older. This deliberately
     * accepts a narrower risk (a single untagged match created this round
     * could double-satisfy both slots) in exchange for avoiding the much
     * more common stuck-forever failure — mirrors
     * admin-improved-adapter.js's `_belongsToCurrentSlot`, which applies
     * the identical gate for the identical reason; keep both in sync if
     * this policy ever changes. A console.warn (deduped per match id, see
     * _warnUntaggedSlotMatch above) fires the first time each untagged
     * match is encountered, for dev visibility into the ambiguity.
     */
    getSlotRequirements(slot) {
        const gs = this._gameState;
        const queue = gs.gameQueue || [];
        const sub = this.getSlotSubPhase(slot);
        const currentRoundNumber = gs.currentPhase?.roundNumber;
        const phaseStartedAt = gs.currentPhase?.startedAt;

        const belongsToSlot = m => {
            if (m.isBreak || m.isChallenge === true) return false;
            if (m.slot !== undefined) {
                return m.slot === slot &&
                    (m.roundNumber === undefined || m.roundNumber === currentRoundNumber);
            }
            if (!m.createdAt || !phaseStartedAt) return false;
            if (m.createdAt >= phaseStartedAt) {
                _warnUntaggedSlotMatch(m);
                return true;
            }
            return false;
        };
        const pendingMatches = () => queue.filter(m => belongsToSlot(m) &&
            (m.status === 'pending' || m.status === undefined || m.status === 'queued'));
        const ongoingMatches = () => queue.filter(m => belongsToSlot(m) && m.status === 'ongoing');

        switch (sub) {
            case 'setup': {
                const pending = pendingMatches();
                return [{
                    label: pending.length > 0
                        ? `${pending.length} match${pending.length !== 1 ? 'es' : ''} queued`
                        : `Create a match for Match ${slot}`,
                    met: pending.length > 0
                }];
            }

            case 'lobby': {
                const lobbyReady = gs.lobbyReady || {};
                const mustReady = this._getPlayersWhoMustReadyForSlot(slot);

                if (mustReady.length === 0) {
                    return [{ label: 'No players need to ready up', met: true }];
                }

                const lobbyCount = mustReady.filter(uid => {
                    const r = lobbyReady[uid];
                    return r?.gameLobby === true || r?.ready === true;
                }).length;
                const discordCount = mustReady.filter(uid => {
                    const r = lobbyReady[uid];
                    return r?.discord === true || r?.ready === true;
                }).length;

                return [
                    { label: `Game lobby: ${lobbyCount}/${mustReady.length}`, met: lobbyCount === mustReady.length },
                    { label: `Discord: ${discordCount}/${mustReady.length}`, met: discordCount === mustReady.length }
                ];
            }

            case 'playing': {
                const ongoing = ongoingMatches();
                const pending = pendingMatches();
                const hasStarted = queue.some(m => belongsToSlot(m) &&
                    (m.status === 'ongoing' || m.status === 'completed'));

                if (!hasStarted) {
                    return [{ label: 'Start the match first', met: false }];
                }
                const reqs = [];
                if (ongoing.length > 0) {
                    reqs.push({ label: `${ongoing.length} match${ongoing.length !== 1 ? 'es' : ''} still playing`, met: false });
                }
                if (pending.length > 0) {
                    reqs.push({ label: `${pending.length} match${pending.length !== 1 ? 'es' : ''} not started`, met: false });
                }
                if (reqs.length === 0) {
                    reqs.push({ label: 'Match result confirmed', met: true });
                }
                return reqs;
            }

            case 'done':
            default:
                return [{ label: `Match ${slot} complete`, met: true }];
        }
    }

    /**
     * Advance one match slot to its next sub-phase (setup -> lobby ->
     * playing -> done), independently of the other slot.
     * @param {number} slot  1 or 2
     * @param {boolean} force  Skip requirements check
     */
    async advanceSlot(slot, force = false) {
        if (this._slotAdvanceInFlight) return false;
        this._slotAdvanceInFlight = true;
        try {
            return await this._advanceSlotInner(slot, force);
        } finally {
            this._slotAdvanceInFlight = false;
        }
    }

    /** Body of advanceSlot — only ever called via the guarded wrapper above. */
    async _advanceSlotInner(slot, force = false) {
        const gs = this._gameState;
        if (this.getCurrentPhase() !== 'matches_in_progress') {
            this._ui.showStatus('Not currently in the matches segment.', 'warning');
            return false;
        }
        const current = this.getSlotSubPhase(slot);
        if (current === 'done') {
            this._ui.showStatus(`Match ${slot} is already done.`, 'warning');
            return false;
        }
        if (!force) {
            const reqs = this.getSlotRequirements(slot);
            if (!reqs.every(r => r.met)) {
                this._ui.showStatus(`Match ${slot} requirements not met. Use force to override.`, 'warning');
                return false;
            }
        }
        const idx = SLOT_SUB_PHASES.indexOf(current);
        const next = SLOT_SUB_PHASES[idx + 1];
        if (!next) return false;

        const prevSlots = { ...(gs.currentPhase.slots || {}) };
        gs.currentPhase.slots = { ...(gs.currentPhase.slots || {}), [slot]: next };

        // Reset lobby readiness scoped to THIS slot's players only — the
        // other slot may already be mid-lobby or mid-play and must not be
        // disturbed by this slot entering its own lobby.
        if (next === 'lobby') {
            const prevLobbyReady = { ...(gs.lobbyReady || {}) };
            this._resetLobbyReadyForSlot(slot);
            this._logAction('lobby_reset', 'phase', {
                roundNumber: gs.currentPhase.roundNumber,
                matchSlot: slot
            }, { lobbyReady: prevLobbyReady });
        }

        await this._save();
        this._logAction('slot_advanced', 'phase', {
            slot, fromSubPhase: current, toSubPhase: next,
            roundNumber: gs.currentPhase.roundNumber, forced: !!force
        }, { currentPhase: { ...gs.currentPhase, slots: prevSlots } });

        this._ui.showStatus(
            `Match ${slot}: ${SLOT_SUB_PHASE_DISPLAY[next]?.name || next}`,
            force ? 'warning' : 'success'
        );

        this.recheckRequirements();
        this.renderPhaseIndicator();
        return true;
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

            // ── Setup ──
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

            // ── Scoring phases — manual admin confirmation ──
            case 'scoring_vp':
                return []; // Admin reviews VP and clicks Next
            case 'scoring_hex':
                return []; // Admin reviews hex scoring and clicks Next

            // ── Hex placement phases ──
            case 'hex_placement_1':
            case 'hex_placement_2': {
                const pendingHex = this._getPendingHexCount();
                if (pendingHex === 0) {
                    return [{ label: 'All hex plates placed', met: true }];
                }
                return [{
                    label: `${pendingHex} team${pendingHex !== 1 ? 's' : ''} need to place plates`,
                    met: false
                }];
            }

            // ── Spell windows — optional, dynamic ──
            case 'spell_window_1':
            case 'spell_window_2':
            case 'spell_window_3':
            case 'spell_window_4': {
                const sp = gs.spellPhase;
                // If spell phase not started → no requirements (admin can skip or begin)
                if (!sp || !sp.isActive) return [];
                // If spell phase active → wait for all teams
                const allDone = sp.turnOrder && sp.turnOrder.length > 0 &&
                    sp.teamsCompleted && sp.teamsCompleted.length >= sp.turnOrder.length;
                return [{
                    label: allDone
                        ? 'All teams completed spells'
                        : `Spell turns: ${sp.teamsCompleted?.length || 0}/${sp.turnOrder?.length || 0} teams done`,
                    met: allDone
                }];
            }

            // ── Challenge phases ──
            case 'challenges': {
                const pendingMatches = queue.filter(m => !m.isBreak && m.status === 'pending');
                return [{
                    label: pendingMatches.length > 0
                        ? `${pendingMatches.length} challenge${pendingMatches.length !== 1 ? 's' : ''} queued`
                        : 'Create challenge matches',
                    met: pendingMatches.length > 0
                }];
            }

            case 'challenge_game': {
                const ongoing = queue.filter(m => !m.isBreak && m.status === 'ongoing');
                const pending = queue.filter(m => !m.isBreak && m.status === 'pending');
                const hasStarted = queue.some(m => !m.isBreak && (m.status === 'ongoing' || m.status === 'completed'));

                if (!hasStarted) {
                    return [{ label: 'Start challenge matches', met: false }];
                }
                const reqs = [];
                if (ongoing.length > 0) {
                    reqs.push({
                        label: `${ongoing.length} match${ongoing.length !== 1 ? 'es' : ''} still playing`,
                        met: false
                    });
                }
                if (pending.length > 0) {
                    reqs.push({
                        label: `${pending.length} match${pending.length !== 1 ? 'es' : ''} not started`,
                        met: false
                    });
                }
                if (reqs.length === 0) {
                    reqs.push({ label: 'All challenge results confirmed', met: true });
                }
                return reqs;
            }

            // ── Board resolved — manual admin check ──
            case 'board_resolved':
                return []; // Admin verifies board correctness, clicks Next

            // ── Matches In Progress — Match 1 and Match 2 progress
            // independently (see getSlotRequirements/getSlotSubPhase). The
            // outer gate (for the Next Phase button, round_advance) is simply
            // "both slots done" — the per-slot detail used by the dual-panel
            // UI comes from getSlotRequirements(slot), not this list.
            case 'matches_in_progress': {
                return [1, 2].map(slot => {
                    const sub = this.getSlotSubPhase(slot);
                    return {
                        label: `Match ${slot}: ${SLOT_SUB_PHASE_DISPLAY[sub]?.name || sub}`,
                        met: sub === 'done'
                    };
                });
            }

            // ── Break — admin ends manually ──
            case 'break':
                return [{ label: 'Admin ends break', met: false }];

            // ── Auto-advance / terminal ──
            case 'round_advance':
            case 'tournament_end':
                return [];

            default:
                return [];
        }
    }

    // ── Phase transition helpers ─────────────────────────────────

    /**
     * Get the effective next phase, skipping break and other skip-in-linear phases.
     * round_advance loops back to scoring_vp.
     */
    _getEffectiveNextPhase(currentPhaseName) {
        // Round advance loops back to scoring_vp
        if (currentPhaseName === 'round_advance') {
            return 'scoring_vp';
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
        if (phaseName === 'round_advance') {
            await this.advancePhase();
        }
    }

    // ── Lobby Ready ─────────────────────────────────────────────

    /**
     * Players who must ready up for one slot's match(es), by uid.
     * Shape-tolerant: modern queue entries store teams[].playerIds; legacy
     * entries store sides[].players[].teamId — both are supported, resolving
     * the WHOLE roster of every team with a player on the match (existing
     * semantics). Matches tagged for a different slot, or for a round other
     * than the one in progress, are excluded (a mass-imported future round
     * must not inflate this round's ready list). Untagged matches count for
     * either slot, matching getSlotRequirements' policy.
     * @returns {string[]}
     */
    _getPlayersWhoMustReadyForSlot(slot) {
        const gs = this._gameState;
        const queue = gs.gameQueue || [];
        const teams = gs.teams || [];
        const currentRoundNumber = gs.currentPhase?.roundNumber;

        const activeTeamIds = new Set();
        const activePlayerIds = new Set();
        queue.forEach(match => {
            if (match.isBreak || match.status === 'completed' || match.isChallenge) return;
            if (match.slot !== undefined && match.slot !== slot) return;
            if (match.roundNumber !== undefined && currentRoundNumber !== undefined &&
                match.roundNumber !== currentRoundNumber) return;
            (match.teams || match.sides || []).forEach(side => {
                (side.playerIds || []).forEach(pid => activePlayerIds.add(String(pid)));
                (side.players || []).forEach(player => {
                    if (player.teamId !== undefined) activeTeamIds.add(String(player.teamId));
                    if (player.id !== undefined) activePlayerIds.add(String(player.id));
                });
            });
        });

        const playerUids = [];
        teams.forEach(team => {
            const roster = team.players || [];
            const involved = activeTeamIds.has(String(team.id)) ||
                roster.some(p => p.id !== undefined && activePlayerIds.has(String(p.id)));
            if (!involved) return;
            roster.forEach(player => {
                if (player.uid) playerUids.push(player.uid);
            });
        });

        return playerUids;
    }

    /**
     * Reset lobbyReady for exactly this slot's players (leaves the other
     * slot's entries untouched). Writes explicit `false` TOMBSTONES instead
     * of deleting keys: every client persists gameState via
     * set({merge:true}), and Firestore's merge never removes absent map
     * keys — a plain `delete` stays local-only, the next snapshot
     * resurrects last round's `true` flags, and the slot's lobby
     * auto-advance fires instantly (lobby check silently skipped from
     * round 2 onward). `ready: false` also kills the legacy single-flag
     * field, which every reader still ORs in.
     */
    _resetLobbyReadyForSlot(slot) {
        const gs = this._gameState;
        if (!gs.lobbyReady) gs.lobbyReady = {};
        this._getPlayersWhoMustReadyForSlot(slot).forEach(uid => {
            gs.lobbyReady[uid] = {
                gameLobby: false,
                discord: false,
                ready: false,
                resetAt: new Date().toISOString()
            };
        });
    }

    /**
     * Force all of one slot's required players to ready status (admin override).
     */
    forceAllReadyForSlot(slot) {
        if (!this.isSlotLobby(slot)) return;

        const gs = this._gameState;
        if (!gs.lobbyReady) gs.lobbyReady = {};

        const mustReady = this._getPlayersWhoMustReadyForSlot(slot);
        const teams = gs.teams || [];
        const prevLobbyState = { ...(gs.lobbyReady || {}) };

        const now = new Date().toISOString();
        mustReady.forEach(uid => {
            const existing = gs.lobbyReady[uid];
            if (existing?.gameLobby && existing?.discord) return;
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
                gameLobby: true,
                discord: true,
                gameLobbyAt: existing?.gameLobbyAt || now,
                discordAt: existing?.discordAt || now,
                teamId: teamId,
                name: playerName
            };
        });

        this._logAction('force_all_ready', 'admin', {
            playerCount: mustReady.length,
            roundNumber: gs.currentPhase?.roundNumber,
            matchSlot: slot
        }, { lobbyReady: prevLobbyState });
    }

    // ── UI Rendering ─────────────────────────────────────────────

    renderPhaseIndicator() {
        const bar = document.getElementById('phaseIndicatorBar');
        if (!bar) return;

        const gs = this._gameState;
        const phase = this.getCurrentPhase();

        const broadcastBar = document.getElementById('broadcastBar');
        const displayControlBar = document.getElementById('displayControlBar');

        if (!phase || !gs.teams) {
            bar.style.display = 'none';
            if (broadcastBar) broadcastBar.style.display = 'none';
            if (displayControlBar) displayControlBar.style.display = 'none';
            return;
        }

        bar.style.display = '';
        if (broadcastBar) {
            broadcastBar.style.display = 'flex';
            const broadcastInput = document.getElementById('broadcastInput');
            if (broadcastInput && gs.broadcastMessage?.text && !broadcastInput.value) {
                broadcastInput.value = gs.broadcastMessage.text;
            }
        }
        if (displayControlBar) {
            displayControlBar.style.display = 'flex';
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

        // Challenge games counter badge
        const challengeBadge = document.getElementById('challengeGamesBadge');
        if (challengeBadge) {
            const gamesPlayed = gs.currentPhase?.challengeGamesPlayed || 0;
            const showBadge = (phase === 'challenge_game' || phase === 'spell_window_3') && gamesPlayed > 0;
            challengeBadge.textContent = showBadge ? `Game ${gamesPlayed + 1}/${MAX_CHALLENGE_GAMES}` : '';
            challengeBadge.style.display = showBadge ? '' : 'none';
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
                    `<span class="phase-req-check">${r.met ? ICON_SVGS.check : ICON_SVGS.x}</span> ` +
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
            advBtn.innerHTML = (isBreak ? 'End Break ' : 'Next Phase ') + ICON_SVGS.play;
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

        // Lobby ready admin controls — one "Force All Ready" per slot
        // currently in its own lobby sub-phase (both can be shown at once).
        const lobbyControls = document.getElementById('lobbyAdminControls');
        if (lobbyControls) {
            if (this.isLobbyPhase(phase)) {
                lobbyControls.style.display = '';
                lobbyControls.innerHTML = [1, 2]
                    .filter(slot => this.isSlotLobby(slot))
                    .map(slot =>
                        `<button class="btn-small secondary" onclick="forceAllReady(${slot})" title="Mark all Match ${slot} players as ready">Force Ready (M${slot})</button>`)
                    .join('');
            } else {
                lobbyControls.style.display = 'none';
                lobbyControls.innerHTML = '';
            }
        }

        // Match slot panels — Match 1 / Match 2 progress independently.
        // Rendered dynamically inside the existing bar since neither slot
        // corresponds to a single whole-tournament phase anymore.
        this._renderSlotPanels(phase);

        // Spell window controls
        const spellControls = document.getElementById('spellWindowControls');
        if (spellControls) {
            if (this.isSpellWindow(phase)) {
                const sp = gs.spellPhase;
                const isActive = sp?.isActive;
                let html = '';
                if (!isActive) {
                    html += `<button class="btn-small primary" onclick="beginSpells()" title="Start spell casting phase">${ICON_SVGS.sparkles} Begin Spells</button>`;
                }
                // Loop button
                const loopInfo = this.getLoopInfo();
                if (loopInfo.canLoop) {
                    html += `<button class="btn-small secondary" onclick="loopBack()" title="${loopInfo.label}">${loopInfo.label}</button>`;
                } else if (loopInfo.target && !loopInfo.canLoop) {
                    html += `<span class="phase-req-item unmet" style="font-size: 0.75rem">${this._escHtml(loopInfo.label)}</span>`;
                }
                spellControls.style.display = '';
                spellControls.innerHTML = html;
            } else {
                spellControls.style.display = 'none';
                spellControls.innerHTML = '';
            }
        }

        // Break interval badge
        const breakBadge = document.getElementById('breakIntervalBadge');
        if (breakBadge) {
            const bs = gs.breakSettings;
            if (bs && bs.intervalRounds > 0 && phase !== 'break' && phase !== 'tournament_end' && phase !== 'pre_game_setup') {
                const since = bs.roundsSinceLastBreak || 0;
                const interval = bs.intervalRounds;
                breakBadge.innerHTML = `${ICON_SVGS.pause} ${since}/${interval}`;
                breakBadge.style.display = '';
                breakBadge.className = 'break-interval-badge' + (since >= interval ? ' break-due' : '');
            } else {
                breakBadge.style.display = 'none';
            }
        }
    }

    /**
     * Render the Match 1 / Match 2 slot panels inside the phase bar. Each
     * slot shows its own sub-phase, requirements, and an advance button —
     * independent of the other slot and of the outer phase's Next Phase
     * button (which only gates leaving 'matches_in_progress' once both
     * slots are done).
     */
    _renderSlotPanels(phase) {
        const bar = document.getElementById('phaseIndicatorBar');
        if (!bar) return;

        let container = document.getElementById('matchSlotPanels');
        if (phase !== 'matches_in_progress') {
            if (container) container.style.display = 'none';
            return;
        }
        if (!container) {
            container = document.createElement('div');
            container.id = 'matchSlotPanels';
            container.className = 'match-slot-panels';
            bar.appendChild(container);
        }
        container.style.display = '';

        container.innerHTML = [1, 2].map(slot => {
            const info = this.getSlotDisplayInfo(slot);
            const reqs = this.getSlotRequirements(slot);
            const allMet = reqs.every(r => r.met);
            const isDone = info.subPhase === 'done';

            const reqsHtml = reqs.map(r =>
                `<span class="phase-req-item ${r.met ? 'met' : 'unmet'}">` +
                `<span class="phase-req-check">${r.met ? ICON_SVGS.check : ICON_SVGS.x}</span> ${this._escHtml(r.label)}</span>`
            ).join('');

            return `
                <div class="match-slot-panel${isDone ? ' slot-done' : ''}">
                    <div class="match-slot-header">
                        <span class="match-slot-icon">${info.icon}</span>
                        <span class="match-slot-name">${this._escHtml(info.name)}</span>
                    </div>
                    <div class="match-slot-reqs">${reqsHtml}</div>
                    ${isDone ? '' : `<button class="btn-small primary" ${allMet ? '' : 'disabled'} onclick="advanceSlot(${slot})">Advance Match ${slot} ${ICON_SVGS.play}</button>`}
                    <button class="btn-small secondary" onclick="forceAdvanceSlot(${slot})" title="Force advance (skip requirements)" ${isDone ? 'style="display:none"' : ''}>${ICON_SVGS.triangleAlert} Force Advance</button>
                </div>`;
        }).join('');
    }

    // ── Force Advance Modal ──────────────────────────────────────

    openForceAdvanceModal() {
        const modal = document.getElementById('forceAdvanceModal');
        if (!modal) return;

        const listEl = document.getElementById('forceAdvanceRequirements');
        if (listEl) {
            const reqs = this._cachedReqs;
            listEl.innerHTML = reqs.items.map(r =>
                `<div class="force-advance-req ${r.met ? 'met' : 'unmet'}">` +
                `<span>${r.met ? ICON_SVGS.check : ICON_SVGS.x}</span> ${this._escHtml(r.label)}</div>`
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

    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

window.PhaseManager = PhaseManager;
