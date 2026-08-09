/**
 * admin-improved-adapter.js  (EXPERIMENTAL)
 *
 * Fork of admin-phase-adapter.js for full/admin_improved.html.
 * The original adapter and admin.html stay untouched.
 *
 * Bridges lightweight admin.js with OOP PhaseManager + ActionLogger,
 * and renders a GUIDED Flow Panel:
 *
 *   - "NEXT STEP" prompt with ONE contextual primary action per phase
 *     (Begin Tournament, Award Points, Open Lobby, Start Match #N,
 *     Skip Spells, End Break, ...). Next Phase / Force / Break remain
 *     as secondary controls.
 *   - Points preview + confirmation before territory points are awarded
 *     when leaving scoring_hex (the original awarded them silently).
 *   - Warning modals when starting a queue match would skip the
 *     Lobby Ready check or a Spell Window, or would desync the flow.
 *   - "Skip to Board Check" escape for rounds with no challenges
 *     (previously required repeated Force presses).
 *   - Next-up highlight on the first queued match.
 *   - Broadcast bar collapsed behind a toggle; the duplicate top-bar
 *     "Next Round" button is hidden while the phase system is active.
 *
 * Loaded AFTER admin.js, phase-manager.js, and action-logger.js.
 */

(function () {
    'use strict';

    let _actionLogger = null;
    let _phaseManager = null;
    let _undoManager = null;
    let _backupManager = null;
    let _initialized = false;
    let _primaryAction = null;
    let _broadcastOpen = false;
    let _spellLogOpen = false;
    let _spellLogTeamId = null;
    let _flowConfirmAction = null;

    // ── Phase constants (mirror phase-manager.js for timeline) ──

    /** Phases shown in the admin timeline track (simplified view) */
    const ADMIN_PHASE_ORDER = [
        'scoring_vp',
        'hex_placement_1',
        'challenges',
        'challenge_game',
        'board_resolved',
        'matches_in_progress'
    ];

    const PHASE_LABELS = {
        pre_game_setup:      'Setup',
        scoring_vp:          'VP Scoring',
        scoring_hex:         'Hex Scoring',
        hex_placement_1:     'Hex 1',
        spell_window_1:      'Spells 1/4',
        hex_placement_2:     'Hex 2',
        challenges:          'Challenges',
        spell_window_2:      'Spells 2/4',
        challenge_game:      'Challenge Game',
        spell_window_3:      'Spells 3/4',
        board_resolved:      'Board Check',
        spell_window_4:      'Spells 4/4',
        matches_in_progress: 'Matches',
        round_advance:       'Round End',
        break:               'Break',
        tournament_end:      'Finished'
    };

    const PHASE_ICONS = {
        pre_game_setup:      ICON_SVGS.settings,
        scoring_vp:          ICON_SVGS.trophy,
        scoring_hex:         ICON_SVGS.hexagon,
        hex_placement_1:     ICON_SVGS.map,
        spell_window_1:      ICON_SVGS.sparkles,
        hex_placement_2:     ICON_SVGS.map,
        challenges:          ICON_SVGS.swords,
        spell_window_2:      ICON_SVGS.sparkles,
        challenge_game:      ICON_SVGS.gamepad2,
        spell_window_3:      ICON_SVGS.sparkles,
        board_resolved:      ICON_SVGS.shield,
        spell_window_4:      ICON_SVGS.sparkles,
        matches_in_progress: ICON_SVGS.gamepad2,
        round_advance:       ICON_SVGS.skipForward,
        break:               ICON_SVGS.pause,
        tournament_end:      ICON_SVGS.trophy
    };

    const SETUP_PHASES = ['challenges'];
    const LOBBY_PHASES = [];

    /** Which Match slot new queue entries get tagged with (admin-selected — see _renderMatchSlotCards) */
    let _targetSlot = 1;

    // ── Minimal UIManager shim (PhaseManager only uses showStatus) ──

    const _uiShim = {
        showStatus(msg, type) {
            if (typeof showStatus === 'function') showStatus(msg, type);
        }
    };

    // ── Minimal TeamManager shim ──

    const _teamShim = {};

    // ── Undo Last Action ──

    /**
     * Find the most recent undoable action log entry and open the confirm
     * modal for it. One button, always undoes the single most recent
     * undoable thing — mirrors god.html's per-entry undo but collapsed to
     * "last action" since admin.html has no activity-log list UI to pick
     * a specific older entry from.
     */
    async function undoLastAction() {
        if (!_actionLogger || !_undoManager) {
            if (typeof showStatus === 'function') showStatus('Nothing to undo yet', 'info');
            return;
        }
        const { entries } = await _actionLogger.getActions({ limit: 15 });
        const target = (entries || []).find(e => _undoManager.canUndo(e).canUndo);
        if (!target) {
            if (typeof showStatus === 'function') showStatus('No recent action can be undone', 'info');
            return;
        }
        _undoManager.openUndoConfirmModal(target);
    }
    window.undoLastAction = undoLastAction;

    // ── Lazy initialization ──

    function _initPhaseAdapter() {
        if (_initialized) return;
        if (!gameState || !gameState.teams) return;
        _initialized = true;

        // ActionLogger
        _actionLogger = new ActionLogger({
            getFirebaseDB: () => window.firebaseDB,
            getTournamentId: () => currentTournamentId,
            getCurrentUser: () => currentUser,
            getCurrentUserRole: () => currentUserRole,
            getGameState: () => gameState
        });

        const logAction = (actionType, category, payload, previousState) =>
            _actionLogger?.logAction(actionType, category, payload, previousState);

        // Exposed so admin.js's flat mutation functions (confirmResult,
        // adjustTeamPoints, assignTeamToHex, ...) can log an undo snapshot
        // without needing a reference into this IIFE's closure.
        window.logAction = logAction;

        // UndoManager — same generic engine god.html already uses (reads
        // previousState off the action log and reverses it); admin.html
        // just never wired a button to it. One "Undo Last Action" button
        // instead of god.html's per-entry activity-log list, since that's
        // the level of control asked for here.
        if (typeof UndoManager !== 'undefined') {
            _undoManager = new UndoManager(gameState, {
                actionLogger: _actionLogger,
                uiManager: _uiShim,
                teamManager: _teamShim,
                saveCallback: (btn) => saveGameState(btn),
                logActionCallback: logAction,
                refreshCallback: () => {
                    if (typeof updateDisplay === 'function') updateDisplay();
                }
            });
            window.openUndoConfirmModal = (entry) => _undoManager?.openUndoConfirmModal(entry);
            window.closeUndoConfirmModal = () => _undoManager?.closeUndoConfirmModal();
            window.confirmUndoAction = () => _undoManager?.confirmUndoAction();
        }

        // PhaseManager
        _phaseManager = new PhaseManager(gameState, {
            uiManager: _uiShim,
            teamManager: _teamShim,
            saveCallback: (btn) => saveGameState(btn),
            logActionCallback: logAction,
            onDisplayRefresh: () => {
                if (typeof updateDisplay === 'function') updateDisplay();
            },
            resolveDiscordChannelName: (slot, sideId) =>
                typeof resolveDiscordChannelName === 'function' ? resolveDiscordChannelName(slot, sideId) : null
        });

        // BackupManager — round-boundary snapshots that replay.html uses as
        // keyframes. god.html has always wired this via _onRoundStartSpells;
        // admin.html never did, so every admin-run tournament replayed in
        // "no round-boundary backups" degraded mode. The hook fires on
        // advancing into scoring_vp with roundNumber > 0 (phase-manager.js).
        // Spells are physical on admin.html, so unlike god.html there are no
        // digital conditions to expire here — the backup is the whole job.
        if (typeof BackupManager !== 'undefined') {
            _backupManager = new BackupManager(gameState, {
                saveCallback: (btn) => saveGameState(btn),
                logActionCallback: logAction,
                uiManager: _uiShim,
                refreshCallback: () => {
                    if (typeof updateDisplay === 'function') updateDisplay();
                }
            });
            _phaseManager._onRoundStartSpells = () => _backupManager.autoBackup();
        }

        // Wire pending hex count (used by phase requirements)
        _phaseManager._getPendingHexCount = () => (pendingHexWins || []).length;

        // Migrate old phase names if tournament was mid-game with old flow
        if (_phaseManager.migratePhaseIfNeeded()) {
            saveGameState();
        }

        // Wire hex territory points award when leaving scoring_hex
        _phaseManager._onAwardPoints = () => {
            _awardPointsForRound();
        };

        // Patch phase requirements: the stock implementation counted EVERY
        // pending queue item, so challenge_game jammed whenever the round's
        // scheduled matches were already queued (and vice versa), and the
        // challenges phase demanded a challenge match even when no team
        // requested one. Challenges are optional and admin-created — the
        // phases must pass through cleanly when none exist.
        const origCalcReqs = _phaseManager._calculateRequirements.bind(_phaseManager);
        _phaseManager._calculateRequirements = function (phaseName) {
            const queue = gameState.gameQueue || [];

            switch (phaseName) {

                // Optional: zero challenges is a valid state (phase gets skipped)
                case 'challenges': {
                    const pendingCh = _pendingChallengeMatches();
                    return [{
                        label: pendingCh.length > 0
                            ? `${pendingCh.length} challenge${pendingCh.length !== 1 ? 's' : ''} queued`
                            : 'No challenges requested',
                        met: true
                    }];
                }

                // Only challenge matches gate this phase
                case 'challenge_game': {
                    const ongoingCh = _ongoingChallengeMatches();
                    const pendingCh = _pendingChallengeMatches();
                    const completedCh = queue.some(m => !m.isBreak && m.isChallenge === true && m.status === 'completed');
                    const reqs = [];
                    if (ongoingCh.length > 0) {
                        reqs.push({ label: `${ongoingCh.length} challenge${ongoingCh.length !== 1 ? 's' : ''} still playing`, met: false });
                    }
                    if (pendingCh.length > 0) {
                        reqs.push({ label: `${pendingCh.length} challenge${pendingCh.length !== 1 ? 's' : ''} not started`, met: false });
                    }
                    if (reqs.length === 0) {
                        reqs.push(completedCh
                            ? { label: 'All challenge results confirmed', met: true }
                            : { label: 'No challenge games — continue', met: true });
                    }
                    return reqs;
                }

                // matches_in_progress: Match 1 / Match 2 requirements are now
                // computed natively by PhaseManager.getSlotRequirements(), fed
                // by the SAME entry.slot tagging this adapter applies below —
                // no override needed here, falls through to origCalcReqs.

                // Only THIS round's slot-specific hex win(s) gate each phase —
                // previously both shared the same global pendingHexWins count,
                // so hex_placement_1 silently required BOTH matches' winners
                // to place before advancing, and hex_placement_2 had nothing
                // left to actually gate.
                case 'hex_placement_1':
                case 'hex_placement_2': {
                    const slotLabel = phaseName === 'hex_placement_1' ? 'Match 1' : 'Match 2';
                    const relevant = _relevantPendingWinsForPhase(phaseName);
                    const count = relevant.reduce((sum, w) => sum + w.teamIds.length, 0);
                    if (count === 0) {
                        // Not "hex placed" — this phase gates the PREVIOUS
                        // round's Match N win (hex_placement_1/2 run before
                        // this round's own matches_in_progress). Zero
                        // pending is equally true in round 1 (nothing has
                        // ever existed to place) as after a real placement —
                        // "hex placed" wrongly implies the former is the
                        // latter, which read as a bug on a fresh round 1.
                        return [{ label: `No pending ${slotLabel} hex placement`, met: true }];
                    }
                    return [{
                        label: `${count} team${count !== 1 ? 's' : ''} (${slotLabel}) need to place plates`,
                        met: false
                    }];
                }

                default:
                    return origCalcReqs(phaseName);
            }
        };

        console.log('[admin-improved-adapter] PhaseManager + Guided Flow Panel initialized');
    }

    // ── Escape HTML ──

    function _esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ── Queue helpers ──

    function _queuePending() {
        return (gameState.gameQueue || []).filter(m =>
            m.status === 'pending' || m.status === undefined || m.status === 'queued');
    }

    function _queuePendingMatches() {
        return _queuePending().filter(m => !m.isBreak);
    }

    function _queueOngoingMatches() {
        return (gameState.gameQueue || []).filter(m => !m.isBreak && m.status === 'ongoing');
    }

    // ── Live-player conflict exclusion ──
    //
    // TODO.md "Next up" bug: neither the slot cards' Next-up pick nor the
    // Match Queue panel's NEXT badge checked whether a pending match's
    // players were already tied up in a currently-ongoing match elsewhere.
    // Real repro: match #122 (StarCraft II) was live with Demo + Inffi(GOD)
    // playing; Match 2's slot picked "#7" as Next Up — which ALSO had
    // Demo + Inffi(GOD) on it — skipping over "#8", which had zero overlap
    // with the live match and was actually available. The queue's own NEXT
    // badge disagreed too (pointed at "#2", also conflicting) — neither
    // indicator filtered for player availability at all.
    //
    // getPlayersInLiveMatches() mirrors the same-named helper documented in
    // the implementation plan, but is defined locally here (rather than
    // imported from match-queue-manager.js) because admin.html does not
    // load that script — and can't safely be made to, since
    // match-queue-manager.js declares top-level `const BREAK_TYPES`, which
    // collides (SyntaxError) with admin.js's own top-level `const
    // BREAK_TYPES` once both scripts share admin.html's global scope.

    /** Set of player IDs currently on ANY ongoing/live match in the queue. */
    function getPlayersInLiveMatches(gameQueue) {
        const liveIds = new Set();
        for (const match of gameQueue || []) {
            if (match.status !== 'ongoing') continue;
            for (const team of match.teams || []) {
                for (const pid of (team.playerIds || [])) liveIds.add(pid);
            }
        }
        return liveIds;
    }

    /**
     * Filters a list of candidate matches down to ones that don't share any
     * player with a currently-live match — used right before picking "the
     * next match" so a queue-order pick never proposes starting a match
     * whose players are already mid-game elsewhere. Preserves the original
     * relative order (skip-to-next-eligible, not a reorder/re-sort).
     */
    function _excludeLiveConflicts(matches) {
        const liveIds = getPlayersInLiveMatches(gameState.gameQueue);
        if (liveIds.size === 0) return matches;
        return matches.filter(m =>
            !(m.teams || []).some(team => (team.playerIds || []).some(pid => liveIds.has(pid)))
        );
    }

    function _matchShortLabel(game) {
        if (game.isBreak === true) return 'Break';
        const gameName = (typeof getGameDisplayName === 'function')
            ? getGameDisplayName(game.game || game.gameType)
            : (game.game || 'match');
        return (game.matchNumber ? `#${game.matchNumber} ` : '') + gameName;
    }

    // Challenge matches and regular (slot) matches are tracked separately:
    // challenge phases must never be blocked by queued slot matches & vice versa
    function _pendingChallengeMatches() {
        return _queuePendingMatches().filter(m => m.isChallenge === true);
    }

    function _ongoingChallengeMatches() {
        return _queueOngoingMatches().filter(m => m.isChallenge === true);
    }

    /**
     * Regular (non-challenge) pending matches, optionally narrowed to one
     * round slot (1 or 2). Matches tagged with `slot` by _tagNewQueueEntries
     * are trusted for the slot number, but only for the round they were
     * tagged for (roundNumber undefined, or equal to the round in progress)
     * — otherwise a match tagged "slot 2" in a long-past round that was
     * left pending/ongoing would block every future round's slot 2 forever.
     *
     * Untagged matches (created before slot tagging existed, or created
     * outside a recognizable match/setup phase) count for either slot —
     * safer than silently hiding a real match — but ONLY if they were
     * created at/after the CURRENT matches-in-progress phase began
     * (createdAt >= currentPhase.startedAt). "roundNumber is undefined"
     * alone is NOT a safe stand-in for "created this round": it's true
     * forever for legacy leftovers with no roundNumber field at all, which
     * is exactly what let ~61 leftover queued matches keep a round from
     * ever reaching round_advance (see TODO.md's "match slot never reaches
     * done" writeup). This mirrors phase-manager.js's getSlotRequirements,
     * which applies the identical gate.
     */
    function _belongsToCurrentSlot(m, slot) {
        const currentRoundNumber = gameState.currentPhase?.roundNumber;
        const phaseStartedAt = gameState.currentPhase?.startedAt;
        if (m.slot !== undefined) {
            return m.slot === slot &&
                (m.roundNumber === undefined || m.roundNumber === currentRoundNumber);
        }
        if (!m.createdAt || !phaseStartedAt) return false;
        return m.createdAt >= phaseStartedAt;
    }

    function _pendingSlotMatches(slot) {
        const all = _queuePendingMatches().filter(m => m.isChallenge !== true);
        if (slot === undefined) return all;
        return all.filter(m => _belongsToCurrentSlot(m, slot));
    }

    function _ongoingSlotMatches(slot) {
        const all = _queueOngoingMatches().filter(m => m.isChallenge !== true);
        if (slot === undefined) return all;
        return all.filter(m => _belongsToCurrentSlot(m, slot));
    }

    /**
     * Player coverage for a slot: which roster players of the teams involved
     * in this slot's COMPLETED matches actually played. User's rule: a slot
     * only truly completes once ALL the involved teams' players have played
     * (a full 5v5, or both halves of a 3v3+2v2 pair). Counting queue entries
     * alone can't catch a never-created second half — rosters can.
     */
    function _slotPlayerCoverage(slot) {
        const queue = gameState.gameQueue || [];
        const completed = queue.filter(m => !m.isBreak && m.isChallenge !== true &&
            m.status === 'completed' && _belongsToCurrentSlot(m, slot));
        const playedIds = new Set();
        const teamIds = new Set();
        completed.forEach(m => {
            (m.teams || m.sides || []).forEach(side => {
                (side.playerIds || []).forEach(pid => playedIds.add(String(pid)));
                (side.players || []).forEach(p => {
                    if (p.id !== undefined) playedIds.add(String(p.id));
                    if (p.teamId !== undefined) teamIds.add(String(p.teamId));
                });
            });
        });
        const missing = [];
        let total = 0;
        (gameState.teams || []).forEach(team => {
            const roster = team.players || [];
            const involved = teamIds.has(String(team.id)) ||
                roster.some(p => p.id !== undefined && playedIds.has(String(p.id)));
            if (!involved) return;
            roster.forEach(p => {
                total++;
                if (!(p.id !== undefined && playedIds.has(String(p.id)))) {
                    missing.push(p.name || p.email || String(p.id));
                }
            });
        });
        return { total, played: total - missing.length, missing };
    }

    // ══════════════════════════════════════════════════════════════
    //  ROUND + SLOT TAGGING
    // ══════════════════════════════════════════════════════════════
    //
    // Queue items previously carried no association with "Slot 1" vs
    // "Slot 2" of a round, so match_1_setup/match_2_setup (and the hex
    // placement phases below) couldn't tell which pending match or which
    // pending hex win belonged to which slot. This tags every match with
    // {roundNumber, slot} at creation time, based on whatever phase the
    // admin was in when they created it.

    /**
     * slot: 1, 2, 'challenge', or null (created outside a recognizable phase).
     * Match 1 and Match 2 both live under the single 'matches_in_progress'
     * phase and can be open at the same time, so — unlike every other
     * phase — there's no phase name to infer the slot from. The admin picks
     * the target slot explicitly (see _renderMatchSlotCards / _targetSlot);
     * it defaults to whichever slot is still in 'setup', or Slot 1.
     */
    function _computeCurrentSlot() {
        const phase = _phaseManager?.getCurrentPhase() || null;
        const roundNumber = gameState.currentPhase?.roundNumber || 0;
        let slot = null;
        if (phase === 'challenges' || phase === 'challenge_game' ||
            phase === 'spell_window_2' || phase === 'spell_window_3') {
            slot = 'challenge';
        } else if (phase === 'matches_in_progress') {
            slot = _targetSlot;
        }
        return { roundNumber, slot };
    }

    /** Admin explicitly selects which Match slot the next created match(es) belong to. */
    function _setTargetSlot(slot) {
        _targetSlot = slot;
        _renderFlowPanel();
    }
    window.setTargetMatchSlot = _setTargetSlot;

    /**
     * Exposes {roundNumber, slot} for whatever the admin is currently
     * targeting — same computation _tagNewQueueEntries uses to stamp newly
     * created matches. admin.js's moveMatchToTop() (queue-jump / "Play
     * next") reads this to bind the jumped match to the intended slot,
     * instead of leaving it untagged where _belongsToCurrentSlot would let
     * it surface on either slot's card.
     */
    window.getTargetMatchSlot = () => _computeCurrentSlot();

    /** Snapshot of queue entry ids, taken right before calling a creation function. */
    function _snapshotQueueIds() {
        return new Set((gameState.gameQueue || []).map(e => e.id));
    }

    /**
     * Stamp round/slot ONLY onto entries added since `beforeIds` was taken —
     * i.e. exactly the match(es) this specific creation call just added.
     *
     * Originally this tagged every untagged entry in the whole queue on
     * every call, which is wrong: this tournament has been used for testing
     * throughout the whole build-out, so the queue likely already has a
     * backlog of old leftover pending matches from before slot-tagging
     * existed. Sweeping ALL of them in on the next match creation stamped
     * that entire backlog as "this round's Slot 2," and since Slot 2 has no
     * escape hatch (by design — it's the last phase before the round ends),
     * the Start button just kept working through that backlog one at a
     * time, looking like it would never reach scoring.
     */
    async function _tagNewQueueEntries(beforeIds) {
        const { roundNumber, slot } = _computeCurrentSlot();
        if (slot === null) return; // ambiguous phase — leave untagged, treated as "always relevant"

        let changed = false;
        (gameState.gameQueue || []).forEach(entry => {
            if (entry.isBreak) return;
            if (entry.roundNumber === undefined && !beforeIds.has(entry.id)) {
                entry.roundNumber = roundNumber;
                entry.slot = entry.isChallenge ? 'challenge' : slot;
                changed = true;
            }
        });
        if (changed) await saveGameState();
    }

    /**
     * Tag a MASS-IMPORTED batch by sequence, not by "whatever phase is active
     * right now." Mass Import (via the Match Scheduler dev tool's exported
     * JSON) typically brings in matches for MANY future rounds in one go —
     * tagging the whole batch with the current phase's slot would repeat the
     * exact "Slot 2 never runs out" bug, just via a different door.
     *
     * The exported format has no round number, but it does preserve
     * matchNumber order and linkedMatch/isSimultaneous for split-format
     * pairs (AoE4/WC3 3v3+2v2) — enough to alternate Slot 1 / Slot 2 per
     * round, treating a linked pair as ONE slot (they play simultaneously).
     */
    async function _tagImportedBatch(beforeIds) {
        const newEntries = (gameState.gameQueue || [])
            .filter(e => !e.isBreak && !beforeIds.has(e.id))
            .sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0));
        if (newEntries.length === 0) return;

        let slotCursor = 1;
        let roundCursor = (gameState.currentPhase?.roundNumber || 0) + 1;
        const handled = new Set();

        newEntries.forEach(entry => {
            if (handled.has(entry.id) || entry.roundNumber !== undefined) return;

            entry.roundNumber = roundCursor;
            entry.slot = entry.isChallenge ? 'challenge' : slotCursor;
            handled.add(entry.id);

            // A linked split-format pair (3v3+2v2 playing simultaneously) is
            // ONE slot, not two — tag the partner match to match.
            if (entry.linkedMatch !== undefined && entry.linkedMatch !== null) {
                const partner = newEntries.find(e => e.matchNumber === entry.linkedMatch);
                if (partner && !handled.has(partner.id)) {
                    partner.roundNumber = entry.roundNumber;
                    partner.slot = entry.slot;
                    handled.add(partner.id);
                }
            }

            if (!entry.isChallenge) {
                slotCursor = slotCursor === 1 ? 2 : 1;
                if (slotCursor === 1) roundCursor++;
            }
        });

        await saveGameState();
    }

    /**
     * Pending hex wins relevant to a given phase, with teams already fully
     * placed filtered out. During hex_placement_1/2, narrows to that slot
     * so Match 1's placement no longer blocks on (or gets confused with)
     * Match 2's — untagged entries (created before this feature existed)
     * always count as relevant.
     *
     * Deliberately NOT filtered by roundNumber: a win is tagged with the
     * round it was created in (e.g. round N, during match_1_playing), but
     * by the time hex_placement_1/2 consumes it, round_advance has already
     * incremented gameState.currentPhase.roundNumber to N+1 — comparing
     * against the *current* round would never match and silently drop
     * every real entry. Slot alone is enough: hex_placement phases only
     * ever hold the immediately-preceding round's leftover wins, since
     * they gate on clearing before the round can advance again.
     */
    function _relevantPendingWinsForPhase(phaseName) {
        const all = (pendingHexWins || []).filter(w => w.teamIds.length > 0);

        if (phaseName === 'hex_placement_1' || phaseName === 'hex_placement_2') {
            const slot = phaseName === 'hex_placement_1' ? 1 : 2;
            return all.filter(w => w.slot === undefined || w.slot === slot);
        }
        return all;
    }

    // ══════════════════════════════════════════════════════════════
    //  FLOW PANEL RENDERER
    // ══════════════════════════════════════════════════════════════

    function _renderFlowPanel() {
        const panel = document.getElementById('flowPanel');
        if (!panel) return;

        const phase = _phaseManager.getCurrentPhase();

        if (!phase || !gameState.teams) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = '';
        panel.classList.toggle('phase-break', phase === 'break');
        panel.classList.toggle('phase-ended', phase === 'tournament_end');

        // If the init prompt replaced the panel DOM (e.g. phases were
        // initialized from another client), rebuild it before rendering
        if (!document.getElementById('flowTimeline')) {
            _restoreFlowPanelDOM();
        }

        const step = _computeNextStep(phase);

        _renderTimeline(phase);
        _renderPhaseHeader(phase);
        _renderNextStepText(step);
        _renderActionItems(phase);
        _renderControls(phase, step);
        _renderBroadcastBar();
        // Must run AFTER _renderControls (its _renderSpellWindowControls closes
        // the bar when the phase isn't a spell window) — keeps the entry list
        // alive across live Firestore updates and _restoreFlowPanelDOM rebuilds.
        _renderSpellLogBar();
        _renderMatchSlotCards(phase);
    }

    // ── Match Slot Cards (Match 1 / Match 2 progress independently) ──

    /**
     * Compute the guided step for ONE match slot — same shape as
     * _computeNextStep's per-phase result, generalized by slot and that
     * slot's own sub-phase (setup/lobby/playing/done) instead of a global
     * phase name.
     */
    function _computeSlotStep(slot) {
        const sub = _phaseManager.getSlotSubPhase(slot);
        const pendingSlot = _pendingSlotMatches(slot);
        const ongoingSlot = _ongoingSlotMatches(slot);

        if (sub === 'done') {
            return { text: 'Complete.', primary: null };
        }

        if (sub === 'setup') {
            if (pendingSlot.length === 0) {
                return {
                    text: `Create a match for Match ${slot} — drag players into sides, or auto-generate.`,
                    primary: { label: '⚡ Auto-Generate', action: () => { _setTargetSlot(slot); window.generateSuggestedMatches(); } }
                };
            }
            return {
                text: `${pendingSlot.length} match${pendingSlot.length !== 1 ? 'es' : ''} queued.`,
                primary: { label: 'Open Lobby ▶', action: () => window.advanceSlot(slot) }
            };
        }

        if (sub === 'lobby') {
            return {
                text: 'Waiting for players to ready up (auto-advances when done).',
                primary: {
                    label: 'Force Ready',
                    action: () => _openFlowConfirm({
                        title: `Force Match ${slot} Ready?`,
                        bodyHtml: '<p>All players are marked ready <strong>without</strong> confirming Discord or the game lobby, and the match moves straight to playing. There is no un-ready.</p>',
                        confirmLabel: 'Force Ready',
                        danger: true,
                        onConfirm: () => window.forceAllReady(slot)
                    })
                }
            };
        }

        // playing — a slot can hold a simultaneous PAIR (3v3+2v2): keep
        // offering Start for remaining pending matches even while one is
        // live, so the second game of the pair is never hidden behind
        // "wait for the result".
        const available = _excludeLiveConflicts(pendingSlot);
        if (available.length > 0) {
            const next = available[0];
            const label = _matchShortLabel(next);
            const liveNote = ongoingSlot.length > 0
                ? `${ongoingSlot.length} live · ` : '';
            return {
                text: `${liveNote}Next up: ${_esc(label)}.`,
                primary: { label: `▶ Start ${label}`, action: () => window.startMatch(next.id) }
            };
        }
        if (ongoingSlot.length > 0) {
            return {
                text: `${ongoingSlot.length} match${ongoingSlot.length !== 1 ? 'es' : ''} live — click its card to record the result.`,
                primary: null
            };
        }
        if (pendingSlot.length > 0) {
            return {
                text: `${pendingSlot.length} match${pendingSlot.length !== 1 ? 'es' : ''} queued, but all share a player with a live match — resolve that match first.`,
                primary: null
            };
        }
        return {
            text: 'All results confirmed.',
            primary: {
                label: `Mark Match ${slot} Done ▶`,
                action: () => {
                    const cov = _slotPlayerCoverage(slot);
                    if (cov.missing.length > 0) {
                        _openFlowConfirm({
                            title: 'Not Everyone Has Played',
                            bodyHtml: `<p><strong>${cov.played}/${cov.total}</strong> players played in Match ${slot}.</p>` +
                                      `<p>Didn't play: <strong>${_esc(cov.missing.join(', '))}</strong>.</p>` +
                                      `<p>A slot normally completes only when all players have played — e.g. BOTH halves of a 3v3+2v2 pair. Missing a second match? Create it instead of marking done.</p>`,
                            confirmLabel: 'Mark Done Anyway',
                            danger: true,
                            onConfirm: () => window.advanceSlot(slot)
                        });
                    } else {
                        window.advanceSlot(slot);
                    }
                }
            }
        };
    }

    /** Holds the live closure for each slot's primary button (same pattern as _primaryAction/runFlowPrimaryAction) */
    const _slotPrimaryActions = { 1: null, 2: null };
    window.runSlotPrimaryAction = (slot) => {
        const fn = _slotPrimaryActions[slot];
        if (fn) fn();
    };

    function _renderMatchSlotCards(phase) {
        let container = document.getElementById('matchSlotCards');
        const panel = document.getElementById('flowPanel');
        if (phase !== 'matches_in_progress') {
            if (container) container.style.display = 'none';
            _slotPrimaryActions[1] = null;
            _slotPrimaryActions[2] = null;
            return;
        }
        if (!container && panel) {
            container = document.createElement('div');
            container.id = 'matchSlotCards';
            container.className = 'match-slot-panels';
            panel.appendChild(container);
        }
        if (!container) return;
        container.style.display = '';

        // Auto-follow (documented at _computeCurrentSlot but never
        // implemented): if the admin's target slot is no longer in setup,
        // snap the target to whichever slot still is — new matches then tag
        // correctly without a manual "Set Target" click every round. An
        // explicit admin pick still wins while that slot remains in setup.
        if (_phaseManager.getSlotSubPhase(_targetSlot) !== 'setup') {
            if (_phaseManager.getSlotSubPhase(1) === 'setup') _targetSlot = 1;
            else if (_phaseManager.getSlotSubPhase(2) === 'setup') _targetSlot = 2;
        }

        container.innerHTML = [1, 2].map(slot => {
            const sub = _phaseManager.getSlotSubPhase(slot);
            const step = _computeSlotStep(slot);
            const isDone = sub === 'done';
            const isTarget = sub === 'setup' && _targetSlot === slot;

            _slotPrimaryActions[slot] = step.primary && !step.primary.disabled ? step.primary.action : null;
            const btnHtml = step.primary
                ? `<button class="btn-small primary" ${step.primary.disabled ? 'disabled' : ''} onclick="runSlotPrimaryAction(${slot})">${_esc(step.primary.label)}</button>`
                : '';

            // While a match is live, show what's ACTUALLY being played (game +
            // matchup) instead of just a generic "N match(es) live" count, and
            // let the admin confirm the result directly from the slot card —
            // previously the only way in was to go find the same match's card
            // in the separate Match Queue panel below.
            const liveMatchesHtml = sub === 'playing'
                ? _ongoingSlotMatches(slot).map(game => {
                    const gameName = (typeof getGameDisplayName === 'function')
                        ? getGameDisplayName(game.game || game.gameType) : (game.game || 'Match');
                    const matchup = (game.teams || game.sides || [])
                        .map(side => getMatchTeamPlayers(side).map(p => p.name).filter(Boolean).join(', ') || 'TBD')
                        .join(' vs ');
                    return `
                        <div class="live-match-card">
                            <div class="live-match-info">
                                <span class="live-match-game">${_esc(game.matchNumber ? '#' + game.matchNumber + ' ' : '')}${_esc(gameName)}</span>
                                <span class="live-match-players">${_esc(matchup)}</span>
                            </div>
                            <button class="btn-small primary" onclick="event.stopPropagation(); openQuickConfirm(${game.id})">${ICON_SVGS.check} Confirm Game Result</button>
                        </div>`;
                }).join('')
                : '';

            // Match + player detail (game, teams, Discord channels; in
            // lobby also each player's ready state) — playing keeps its
            // richer live-match-card instead.
            const detailsHtml = (sub === 'setup' || sub === 'lobby')
                ? _phaseManager.renderSlotDetailsHtml(slot, { players: sub === 'lobby' })
                : '';

            return `
                <div class="match-slot-panel${isDone ? ' slot-done' : ''}${isTarget ? ' slot-target' : ''}">
                    <div class="match-slot-header">
                        <span class="match-slot-icon">${PHASE_ICONS.matches_in_progress}</span>
                        <span class="match-slot-name">Match ${slot} — ${_esc(sub)}</span>
                        ${sub === 'setup' ? `<button class="btn-small secondary" onclick="setTargetMatchSlot(${slot})" title="New matches go to this slot">${isTarget ? ICON_SVGS.check + ' Target' : 'Set Target'}</button>` : ''}
                    </div>
                    <div class="match-slot-guidance">${_esc(step.text)}</div>
                    ${detailsHtml}
                    ${liveMatchesHtml}
                    ${btnHtml}
                    <button class="btn-small secondary" onclick="forceAdvanceSlot(${slot})" title="Force advance (skip requirements)" ${isDone ? 'style="display:none"' : ''}>${ICON_SVGS.triangleAlert} Force Advance</button>
                </div>`;
        }).join('');
    }

    // ── Timeline Track ──

    /**
     * Map any phase to its position in the simplified admin timeline.
     * Spell windows and sub-phases map to the nearest main phase.
     */
    function _getTimelineIndex(phase) {
        // Direct match
        const directIdx = ADMIN_PHASE_ORDER.indexOf(phase);
        if (directIdx >= 0) return directIdx;

        // Map sub-phases to their parent timeline step
        const mapping = {
            scoring_hex: 0,         // part of scoring block
            spell_window_1: 1,      // between hex1 and hex2
            hex_placement_2: 1,     // part of hex block
            spell_window_2: 2,      // part of challenges block
            spell_window_3: 3,      // after challenge_game
            spell_window_4: 4,      // after board_resolved
            round_advance: 6        // past end
        };
        return mapping[phase] ?? -1;
    }

    function _renderTimeline(currentPhase) {
        const container = document.getElementById('flowTimeline');
        if (!container) return;

        // For pre_game_setup and tournament_end, show simplified timeline
        if (currentPhase === 'pre_game_setup') {
            container.innerHTML = '<span class="flow-tl-step active"><span class="flow-tl-dot"></span><span class="flow-tl-label">Setup</span></span>';
            return;
        }
        if (currentPhase === 'tournament_end') {
            container.innerHTML = '<span class="flow-tl-step active"><span class="flow-tl-dot"></span><span class="flow-tl-label">Tournament Complete</span></span>';
            return;
        }

        // Break: show break step highlighted
        if (currentPhase === 'break') {
            let html = '';
            ADMIN_PHASE_ORDER.forEach((p, i) => {
                if (i > 0) html += '<span class="flow-tl-connector done"></span>';
                html += `<span class="flow-tl-step done"><span class="flow-tl-dot"></span><span class="flow-tl-label">${PHASE_LABELS[p] || p}</span></span>`;
            });
            html = '<span class="flow-tl-step active"><span class="flow-tl-dot"></span><span class="flow-tl-label">' + ICON_SVGS.pause + ' Break</span></span>' +
                   '<span class="flow-tl-connector"></span>' + html;
            container.innerHTML = html;
            return;
        }

        const effectiveIdx = _getTimelineIndex(currentPhase);

        let html = '';
        ADMIN_PHASE_ORDER.forEach((p, i) => {
            if (i > 0) {
                const connDone = i <= effectiveIdx;
                html += `<span class="flow-tl-connector${connDone ? ' done' : ''}"></span>`;
            }

            let state = 'future';
            if (i < effectiveIdx) state = 'done';
            else if (i === effectiveIdx || p === currentPhase) state = 'active';

            html += `<span class="flow-tl-step ${state}">` +
                    `<span class="flow-tl-dot"></span>` +
                    `<span class="flow-tl-label">${PHASE_LABELS[p] || p}</span>` +
                    `</span>`;
        });

        container.innerHTML = html;
    }

    // ── Phase Header (icon + name + round) ──

    function _renderPhaseHeader(phase) {
        const iconEl = document.getElementById('flowPhaseIcon');
        const nameEl = document.getElementById('flowPhaseName');
        const roundEl = document.getElementById('flowRoundBadge');

        if (iconEl) iconEl.innerHTML = PHASE_ICONS[phase] || '';
        if (nameEl) nameEl.textContent = PHASE_LABELS[phase] || phase;

        if (roundEl) {
            const round = gameState.currentPhase?.roundNumber || 0;
            roundEl.textContent = round > 0 ? `Round ${round}` : '';
            roundEl.style.display = round > 0 ? '' : 'none';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  NEXT STEP — one contextual prompt + primary action per phase
    // ══════════════════════════════════════════════════════════════

    /**
     * Compute the guided next step for the current phase.
     * @returns {{
     *   text: string,                       // HTML guidance shown in the prompt
     *   primary: {label, action, disabled, title}|null,  // the ONE primary button
     *   primaryIsAdvance: boolean           // true → hide the small Next Phase button
     * }}
     */
    function _computeNextStep(phase) {
        const gs = gameState;
        const reqs = _phaseManager.getPhaseRequirements();
        const round = gs.currentPhase?.roundNumber || 0;
        const advance = () => window.advancePhase();

        switch (phase) {

            case 'pre_game_setup':
                return {
                    text: 'Mark room hexes on the board and give every team at least 2 players. Then begin the tournament.',
                    primary: {
                        label: 'Begin Tournament ▶',
                        action: () => _openFlowConfirm({
                            title: 'Begin Tournament?',
                            bodyHtml: '<p>This starts <strong>Round 1</strong>. The flow only moves forward — there is no going back to setup.</p>',
                            confirmLabel: 'Begin ' + ICON_SVGS.play,
                            onConfirm: advance
                        }),
                        disabled: !reqs.allMet,
                        title: reqs.allMet ? '' : 'Complete the setup requirements first'
                    },
                    primaryIsAdvance: true
                };

            case 'scoring_vp':
                return {
                    text: round <= 1
                        ? 'First round — no victory points to review yet.'
                        : 'Review victory points from last round’s match wins (VPs were granted when results were confirmed).',
                    primary: { label: 'Continue ▶', action: advance },
                    primaryIsAdvance: true
                };

            case 'scoring_hex': {
                if (round <= 1) {
                    return {
                        text: 'First round — no territory points yet.',
                        primary: { label: 'Continue ▶', action: advance },
                        primaryIsAdvance: true
                    };
                }
                const alreadyAwarded = (gs.pointsHistory || []).some(e => e.round === round);
                if (alreadyAwarded) {
                    return {
                        text: 'Territory points for this round are already awarded.',
                        primary: { label: 'Continue ▶', action: advance },
                        primaryIsAdvance: true
                    };
                }
                const preview = _computeRoundPointsPreview();
                if (preview.total <= 0) {
                    return {
                        text: 'No heart hexes are controlled — no territory points this round.',
                        primary: { label: 'Continue ▶', action: advance },
                        primaryIsAdvance: true
                    };
                }
                return {
                    text: `Heart-hex territory points are ready: <strong>${preview.total}</strong> pts total.` +
                          (preview.frozenCount > 0 ? ` (${preview.frozenCount} contested hex(es) frozen.)` : '') +
                          ' You’ll see a preview before anything is committed.',
                    primary: { label: 'Award Points ▶', action: () => window.confirmScoringHexAdvance() },
                    primaryIsAdvance: true
                };
            }

            case 'hex_placement_1':
            case 'hex_placement_2': {
                const slotLabel = phase === 'hex_placement_1' ? 'Match 1' : 'Match 2';
                const relevant = _relevantPendingWinsForPhase(phase);
                const hexCount = relevant.reduce((sum, w) => sum + w.teamIds.length, 0);
                if (hexCount > 0) {
                    const names = relevant.flatMap(w => w.teamNames || []).join(', ');
                    return {
                        text: `<strong>${hexCount}</strong> team${hexCount !== 1 ? 's' : ''} (${slotLabel}: <strong>${_esc(names)}</strong>) must place hex plates — click hexes on the board to assign them.`,
                        primary: { label: 'Waiting for placements…', action: null, disabled: true },
                        primaryIsAdvance: true
                    };
                }
                return {
                    text: `No pending ${slotLabel} hex placement.`,
                    primary: { label: 'Continue ▶', action: advance },
                    primaryIsAdvance: true
                };
            }

            case 'spell_window_1':
            case 'spell_window_2':
            case 'spell_window_3':
            case 'spell_window_4': {
                const sp = gs.spellPhase;
                let extra = '';
                if (phase === 'spell_window_3') {
                    const gamesPlayed = gs.currentPhase?.challengeGamesPlayed || 0;
                    extra = ` Challenge games this round: <strong>${gamesPlayed}</strong>/7.`;
                }
                if (sp?.isActive) {
                    const done = sp.teamsCompleted?.length || 0;
                    const total = sp.turnOrder?.length || 0;
                    const allDone = total > 0 && done >= total;
                    if (allDone) {
                        return {
                            text: 'All teams finished casting spells.' + extra,
                            primary: { label: 'Continue ▶', action: advance },
                            primaryIsAdvance: true
                        };
                    }
                    return {
                        text: `Spell phase active — <strong>${done}/${total}</strong> teams done.` + extra,
                        primary: { label: `Spells ${done}/${total}…`, action: null, disabled: true },
                        primaryIsAdvance: true
                    };
                }
                return {
                    text: 'Spell window — give teams time to cast at the table, then continue. (Digital spell casting is driven from the GOD view.)' + extra,
                    primary: { label: 'Continue ▶', action: advance },
                    primaryIsAdvance: true
                };
            }

            case 'challenges': {
                const pendingCh = _pendingChallengeMatches();
                if (pendingCh.length > 0) {
                    return {
                        text: `<strong>${pendingCh.length}</strong> challenge match${pendingCh.length !== 1 ? 'es' : ''} queued. Continue to play ${pendingCh.length !== 1 ? 'them' : 'it'}.`,
                        primary: { label: 'Continue ▶', action: advance },
                        primaryIsAdvance: true
                    };
                }
                return {
                    text: 'Challenges are optional — create one if a team requests a heart-hex dispute (⚔ button). Otherwise continue and the challenge step is skipped this round.',
                    primary: {
                        label: 'Continue — No Challenges ▶',
                        action: () => _openFlowConfirm({
                            title: 'Skip Challenges?',
                            bodyHtml: '<p>No team has requested a heart-hex dispute this round?</p>' +
                                      '<p>The challenge step is skipped. The only way back this round is the Spell Window loop after Board Check.</p>',
                            confirmLabel: 'Skip — No Challenges ' + ICON_SVGS.play,
                            onConfirm: advance
                        })
                    },
                    primaryIsAdvance: true
                };
            }

            case 'challenge_game': {
                const ongoingCh = _ongoingChallengeMatches();
                const pendingCh = _pendingChallengeMatches();
                const queueCg = gs.gameQueue || [];

                if (ongoingCh.length > 0) {
                    return {
                        text: 'Challenge game live — click the match card to record the result.' +
                              (pendingCh.length > 0 ? ` <strong>${pendingCh.length}</strong> more challenge${pendingCh.length !== 1 ? 's' : ''} waiting.` : ''),
                        primary: { label: 'Waiting for result…', action: null, disabled: true },
                        primaryIsAdvance: true
                    };
                }
                if (pendingCh.length > 0) {
                    const next = pendingCh[0];
                    const label = _matchShortLabel(next);
                    // Challenges now get the same ready-check step as the
                    // two planned matches, instead of going straight from
                    // queued to playing.
                    if (_phaseManager.isChallengeLobbyActive()) {
                        return {
                            text: `Waiting for players to ready up for <strong>${_esc(label)}</strong> (auto-advances when done).` +
                                _phaseManager.renderSlotDetailsHtml('challenge', { players: true }),
                            primary: {
                                label: 'Force Ready',
                                action: () => _openFlowConfirm({
                                    title: 'Force Challenge Ready?',
                                    bodyHtml: '<p>All challenge players are marked ready <strong>without</strong> confirming Discord or the game lobby. There is no un-ready.</p>',
                                    confirmLabel: 'Force Ready',
                                    danger: true,
                                    onConfirm: () => window.forceAllChallengeReady()
                                })
                            },
                            primaryIsAdvance: false
                        };
                    }
                    if (_phaseManager.getChallengeLobbyState() === 'ready') {
                        return {
                            text: `Next challenge: <strong>${_esc(label)}</strong>. Challenges play one at a time, before other board changes.`,
                            primary: { label: `▶ Start ${label}`, action: () => window.startMatch(next.id) },
                            primaryIsAdvance: false
                        };
                    }
                    return {
                        text: `Next challenge: <strong>${_esc(label)}</strong>.`,
                        primary: { label: 'Open Lobby ▶', action: () => window.openChallengeLobby() },
                        primaryIsAdvance: false
                    };
                }
                const completedCh = queueCg.some(m => !m.isBreak && m.isChallenge === true && m.status === 'completed');
                return {
                    text: completedCh ? 'All challenge results confirmed.' : 'No challenge games pending.',
                    primary: { label: 'Continue ▶', action: advance },
                    primaryIsAdvance: true
                };
            }

            // Match 1 and Match 2 progress independently now, so there's no
            // single "the" primary action for this phase — each slot gets
            // its own action button, rendered by _renderMatchSlotCards().
            // This just supplies the guidance text and the Next Phase
            // button, which only enables once PhaseManager reports both
            // slots done (see phase-manager.js getSlotRequirements).
            case 'matches_in_progress': {
                const summaries = [1, 2].map(slot => {
                    const sub = _phaseManager.getSlotSubPhase(slot);
                    return `Match ${slot}: ${sub}`;
                });
                const bothDone = _phaseManager.bothSlotsDone();
                return {
                    text: bothDone
                        ? 'Both matches complete.'
                        : `${summaries.join(' · ')} — see the match cards below.`,
                    primary: bothDone ? {
                        label: 'End Round ▶',
                        action: () => _openFlowConfirm({
                            title: `End Round ${round}?`,
                            bodyHtml: '<p>Both matches are complete. This ends the round and begins the next one — there is no way back.</p>',
                            confirmLabel: 'End Round ' + ICON_SVGS.play,
                            onConfirm: advance
                        })
                    } : null,
                    primaryIsAdvance: true
                };
            }

            case 'board_resolved':
                return {
                    text: 'Check that hex control on the board matches reality. Resolve any disputes before continuing.',
                    primary: { label: 'Board Verified ▶', action: advance },
                    primaryIsAdvance: true
                };

            case 'round_advance':
                return {
                    text: 'Round complete. Advancing…',
                    primary: null,
                    primaryIsAdvance: true
                };

            case 'break': {
                const returnTo = gs.currentPhase?.returnToPhase;
                const returnLabel = returnTo ? (PHASE_LABELS[returnTo] || returnTo) : null;
                return {
                    text: 'Break in progress.' + (returnLabel ? ` Ends back at <strong>${_esc(returnLabel)}</strong>.` : ''),
                    primary: { label: 'End Break ▶', action: () => window.endBreak() },
                    primaryIsAdvance: true
                };
            }

            case 'tournament_end':
                return {
                    text: 'Tournament complete! View final standings on the View and Stats pages.',
                    primary: null,
                    primaryIsAdvance: true
                };

            default:
                return {
                    text: '',
                    primary: { label: 'Continue ▶', action: advance, disabled: !reqs.allMet },
                    primaryIsAdvance: true
                };
        }
    }

    function _renderNextStepText(step) {
        const el = document.getElementById('flowGuidance');
        if (el) el.innerHTML = step.text || '';
    }

    // ── Action Items (requirements + pending hex + voted matches) ──

    function _renderActionItems(phase) {
        const container = document.getElementById('flowActions');
        if (!container) return;

        let html = '';

        // 1) Phase requirements from PhaseManager
        const reqs = _phaseManager.getPhaseRequirements();
        reqs.items.forEach(r => {
            const cls = r.met ? 'req-met' : 'req-unmet';
            const icon = r.met ? ICON_SVGS.check : ICON_SVGS.x;
            html += `<span class="flow-action-item ${cls}">` +
                    `<span class="flow-action-icon">${icon}</span> ${_esc(r.label)}</span>`;
        });

        // 2) Pending hex placements (scoped to this phase's slot, if applicable)
        const pendingHex = _relevantPendingWinsForPhase(phase);
        pendingHex.forEach(win => {
            const matchLabel = win.matchNumber ? `#${win.matchNumber}` : '';
            win.teamIds.forEach((teamId, idx) => {
                const teamName = win.teamNames[idx] || `Team ${teamId}`;
                const team = gameState?.teams?.find(t => String(t.id) === String(teamId));
                const color = team?.color || 'var(--accent-warning)';
                html += `<span class="flow-action-item action-pending" title="Match ${matchLabel}: ${teamName} needs to place a hex plate">` +
                        `<span class="flow-action-icon">${ICON_SVGS.hexagon}</span> ` +
                        `<span class="flow-action-team" style="color: ${color}">${_esc(teamName)}</span> hex` +
                        `<button class="flow-waive-btn" onclick="confirmWaiveHex(${win.matchNumber || 0}, '${String(teamId)}')" title="Waive this placement (team absent/declined)">&times;</button></span>`;
            });
        });

        // 3) Voted matches awaiting admin confirmation
        // (votes currently arrive on completed matches — don't filter to ongoing
        // like the original adapter did, or the pills never show)
        const queue = gameState.gameQueue || [];
        const votedMatches = queue.filter(m => !m.isBreak && m.votes && m.votes.length > 0 && !m.adminConfirmed);
        votedMatches.forEach(m => {
            const gameName = (typeof getGameDisplayName === 'function') ? getGameDisplayName(m.game) : (m.game || 'Match');
            const label = m.matchNumber ? `#${m.matchNumber} ${gameName}` : gameName;
            html += `<span class="flow-action-item action-vote" title="Players voted on result for ${label}">` +
                    `<span class="flow-action-icon">${ICON_SVGS.vote}</span> Vote: ${_esc(label)}</span>`;
        });

        container.innerHTML = html;
    }

    // ── Controls (primary action + Next Phase, Force, Break, Spells, Loop) ──

    function _renderControls(phase, step) {
        const primaryBtn = document.getElementById('flowPrimaryBtn');
        const advBtn = document.getElementById('advancePhaseBtn');
        const forceBtn = document.getElementById('forceAdvanceBtn');
        const breakBtn = document.getElementById('insertBreakBtn');
        const lobbyControls = document.getElementById('lobbyAdminControls');
        const breakBadge = document.getElementById('breakIntervalBadge');
        const extraControls = document.getElementById('phaseExtraControls');

        const reqs = _phaseManager.getPhaseRequirements();

        // Primary contextual action
        if (primaryBtn) {
            if (!step.primary) {
                primaryBtn.style.display = 'none';
                _primaryAction = null;
            } else {
                primaryBtn.style.display = '';
                primaryBtn.textContent = step.primary.label;
                primaryBtn.disabled = !!step.primary.disabled;
                primaryBtn.title = step.primary.title || '';
                _primaryAction = step.primary.disabled ? null : step.primary.action;
            }
        }

        // Small Next Phase button — only when the primary action is NOT advancement
        if (advBtn) {
            const show = !step.primaryIsAdvance &&
                         phase !== 'break' && phase !== 'tournament_end' && phase !== 'round_advance';
            advBtn.style.display = show ? '' : 'none';
            advBtn.innerHTML = 'Next Phase ' + ICON_SVGS.play;
            advBtn.disabled = !reqs.allMet;
            advBtn.onclick = () => window.advancePhase();
        }

        if (forceBtn) {
            forceBtn.style.display = (phase === 'tournament_end' || phase === 'break' || phase === 'pre_game_setup') ? 'none' : '';
        }

        if (breakBtn) {
            breakBtn.style.display = (phase === 'break' || phase === 'tournament_end' || phase === 'pre_game_setup') ? 'none' : '';
        }

        // God-only Set Phase corrector button
        let setPhaseBtn = document.getElementById('setPhaseBtn');
        const isGod = typeof currentUserRole !== 'undefined' && currentUserRole === 'god';
        if (isGod && !setPhaseBtn && breakBtn && breakBtn.parentElement) {
            setPhaseBtn = document.createElement('button');
            setPhaseBtn.id = 'setPhaseBtn';
            setPhaseBtn.className = 'btn-small secondary';
            setPhaseBtn.title = 'Set phase directly (god-only recovery tool)';
            setPhaseBtn.innerHTML = ICON_SVGS.settings + ' Set Phase';
            setPhaseBtn.onclick = () => window.openSetPhaseModal();
            breakBtn.parentElement.appendChild(setPhaseBtn);
        }
        if (setPhaseBtn) setPhaseBtn.style.display = isGod ? '' : 'none';

        // Phase-specific extra controls (Create Challenge shortcut)
        if (extraControls) {
            if (phase === 'challenges') {
                extraControls.style.display = '';
                extraControls.innerHTML =
                    '<button class="btn-small challenge" onclick="addChallengeToQueue()" title="Create a challenge match (heart-hex dispute)">' + ICON_SVGS.swords + ' Challenge</button>';
            } else {
                extraControls.style.display = 'none';
                extraControls.innerHTML = '';
            }
        }

        // Lobby ready admin controls — for matches_in_progress, each slot's
        // own "Force Ready" button already lives on its match slot card
        // (_renderMatchSlotCards), since the two slots' lobby state differs.
        if (lobbyControls) {
            lobbyControls.style.display = 'none';
            lobbyControls.innerHTML = '';
        }

        // Spell window controls (Begin Spells + Loop)
        _renderSpellWindowControls(phase);

        // Break interval badge
        if (breakBadge) {
            const bs = gameState.breakSettings;
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

    function _renderSpellWindowControls(phase) {
        const container = document.getElementById('spellWindowControls');
        if (!container) return;

        if (!_phaseManager.isSpellWindow(phase)) {
            container.style.display = 'none';
            container.innerHTML = '';
            _spellLogOpen = false;
            const bar = document.getElementById('spellLogBar');
            const entriesEl = document.getElementById('spellLogEntries');
            if (bar) bar.style.display = 'none';
            if (entriesEl) entriesEl.style.display = 'none';
            return;
        }

        container.style.display = '';
        let html = '';

        // "Begin Spells" is deliberately absent here: on admin.html the
        // _onSpellPhaseEntered hook is never wired (only god-app.js wires
        // digital spell casting), so the button used to be a silent no-op —
        // it looked like it started something and did nothing. Spells are
        // played physically at the table by default; this window is a
        // manual timing checkpoint (see _computeNextStep's spell_window
        // case for the Continue guidance).

        const loopInfo = _phaseManager.getLoopInfo();
        // spell_window_4 -> challenges has no "anything pending?" gate in
        // phase-manager.js (unlike spell_window_3's max-games check) — it's
        // unconditionally offered as a "let a team add a late challenge"
        // escape hatch. But you can't actually CREATE a challenge from the
        // spell window itself (the ⚔ button only exists on the challenges
        // phase screen), so showing an always-on "Loop" button here when
        // nothing is pending reads as something needing attention when it
        // isn't. Hide it in that case on admin.html specifically — the
        // capability isn't lost, a god user can still reach `challenges`
        // via Set Phase if a team decides late.
        const hasChallengeToLoopTo = phase !== 'spell_window_4' ||
            _pendingChallengeMatches().length > 0 || _ongoingChallengeMatches().length > 0;
        if (loopInfo.canLoop && hasChallengeToLoopTo) {
            html += `<button class="btn-small secondary" onclick="loopBack()" title="${_esc(loopInfo.label)}">${_esc(loopInfo.label)}</button>`;
        } else if (loopInfo.target && !loopInfo.canLoop) {
            html += `<span style="font-size: 0.75rem; color: var(--text-tertiary);">${_esc(loopInfo.label)}</span>`;
        }

        html += `<button class="btn-small secondary" onclick="toggleSpellLogBar()" title="Log which team used which spell">📜 Spell Log</button>`;

        container.innerHTML = html;
    }

    // ── Broadcast Bar (collapsed behind the 📢 toggle) ──

    function _renderBroadcastBar() {
        const bar = document.getElementById('broadcastBar');
        const toggle = document.getElementById('broadcastToggleBtn');
        if (!bar) return;

        const hasMessage = !!gameState.broadcastMessage?.text;
        if (toggle) toggle.classList.toggle('active', hasMessage);

        bar.style.display = _broadcastOpen ? 'flex' : 'none';

        const broadcastInput = document.getElementById('broadcastInput');
        if (broadcastInput && hasMessage && !broadcastInput.value) {
            broadcastInput.value = gameState.broadcastMessage.text;
        }
    }

    // ── Spell Log Bar (collapsed behind the 📜 toggle, visible only during spell windows) ──

    function _renderSpellLogBar() {
        const bar = document.getElementById('spellLogBar');
        const entriesEl = document.getElementById('spellLogEntries');
        if (!bar || !entriesEl) return;

        bar.style.display = _spellLogOpen ? 'flex' : 'none';
        entriesEl.style.display = _spellLogOpen ? '' : 'none';
        if (!_spellLogOpen) return;

        const teams = gameState.teams || [];

        // Team chips are rebuilt on EVERY render (unlike the old lazily-filled
        // <select>) so renames and colour edits show up immediately. The
        // selection is pure local UI state: keep it across renders, but fall
        // back to the first team when it was never set or its team is gone.
        if (!teams.some(t => String(t.id) === String(_spellLogTeamId))) {
            _spellLogTeamId = teams.length ? teams[0].id : null;
        }

        const teamsEl = document.getElementById('spellLogTeams');
        if (teamsEl) {
            teamsEl.innerHTML = teams.map(team => {
                const color = _spellLogTeamColor(team);
                const selected = String(team.id) === String(_spellLogTeamId);
                // Selected = solid fill, unselected = outline only
                const style = selected
                    ? `background: ${color}; border-color: ${color}; color: #0b0d10;`
                    : `background: transparent; border-color: ${color}; color: ${color};`;
                return `<button type="button" class="spell-log-team-chip${selected ? ' selected' : ''}" ` +
                       `style="${style}" onclick="selectSpellLogTeam('${_esc(_jsStr(team.id))}')">` +
                       `${_esc(team.name || 'Team ' + team.id)}</button>`;
            }).join('');
        }

        const log = gameState.spellWindowLog || [];
        entriesEl.innerHTML = log.length === 0
            ? '<p style="font-size: 0.8rem; color: var(--text-tertiary); padding: 4px 0;">No spells logged yet.</p>'
            : log.map(entry => {
                // entry.teamId is stored as a string; team.id may be numeric
                const team = teams.find(t => String(t.id) === String(entry.teamId));
                const color = _spellLogTeamColor(team);
                return `<div class="spell-log-entry" style="border-left: 3px solid ${color};">` +
                    `<span>${_esc(entry.teamName)} — ${_esc(entry.spellName)}</span>` +
                    `<button class="remove-btn" onclick="removeSpellLogEntry('${_esc(entry.id)}')" title="Remove">✕</button>` +
                `</div>`;
            }).join('');
    }

    /** Escape a value for embedding inside a single-quoted JS string literal. */
    function _jsStr(value) {
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    const _HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

    /**
     * Team colour for spell-log chips/rows, sanitized so it is safe to
     * interpolate into an inline style attribute. Anything that isn't a plain
     * hex colour falls back to the adapter's usual neutral grey.
     */
    function _spellLogTeamColor(team) {
        let color = team?.color;
        if (!color && team && typeof getTeamColor === 'function') {
            try { color = getTeamColor(team.id); } catch (e) { color = null; }
        }
        return (typeof color === 'string' && _HEX_COLOR_RE.test(color)) ? color : '#888';
    }

    // ── Next-up queue highlight ──

    /**
     * Highlight the match the flow expects next: during challenge phases the
     * first pending challenge, during match phases the first pending regular
     * match, otherwise the first pending queue item.
     */
    function _highlightNextQueueItem() {
        const phase = _phaseManager?.getCurrentPhase() || '';
        let target = null;
        // Same live-player-conflict exclusion as _computeSlotStep: never
        // highlight a queued match as "next" if its players are already
        // tied up in a currently-ongoing match elsewhere (TODO.md — the
        // NEXT badge disagreeing with the slot's own Next-up pick, and both
        // being wrong, was this exact bug).
        if (phase === 'challenges' || phase === 'challenge_game' ||
            phase === 'spell_window_2' || phase === 'spell_window_3') {
            target = _excludeLiveConflicts(_pendingChallengeMatches())[0];
        } else if (phase === 'matches_in_progress') {
            // Per-slot pick, playing slots first — the panel's NEXT badge and
            // the slot card's own Next-up must agree. (The old branches keyed
            // on retired match_1_*/match_2_* phase names — dead since the
            // slot migration — and fell through to "first pending in the
            // whole queue", badging future-round imports.)
            const pick = slot => _excludeLiveConflicts(_pendingSlotMatches(slot))[0];
            target = (_phaseManager.isSlotPlaying(1) ? pick(1) : null) ||
                     (_phaseManager.isSlotPlaying(2) ? pick(2) : null) ||
                     pick(1) || pick(2) || null;
        }
        // Outside match/challenge phases nothing is "next to start" — badge
        // nothing rather than an arbitrary (possibly future-round) entry.

        const items = document.querySelectorAll('#matchQueue .queue-item');
        items.forEach(el => {
            el.classList.toggle('next-up',
                !!target && String(el.dataset.queueId) === String(target.id) &&
                !el.classList.contains('ongoing'));
        });
    }

    // ── Show "Initialize Phases" prompt when currentPhase is missing ──

    function _renderPhaseInitPrompt() {
        const panel = document.getElementById('flowPanel');
        if (!panel) return;

        if (!gameState.teams) {
            panel.style.display = 'none';
            return;
        }

        if (gameState.currentPhase) return; // Phase system already active

        panel.style.display = '';
        panel.innerHTML =
            '<div class="flow-body" style="justify-content: center; padding: 18px 24px;">' +
                '<div class="flow-current" style="max-width: none;">' +
                    '<div class="flow-phase-header">' +
                        '<span class="flow-phase-icon">' + ICON_SVGS.settings + '</span>' +
                        '<div class="flow-phase-info">' +
                            '<span class="flow-phase-label">TOURNAMENT FLOW</span>' +
                            '<span class="flow-phase-name">Not initialized</span>' +
                        '</div>' +
                    '</div>' +
                    '<p class="flow-guidance">Initialize the phase system to guide tournament flow step by step.</p>' +
                '</div>' +
                '<div class="flow-controls">' +
                    '<button class="btn primary" onclick="initializePhaseSystem()">Initialize Flow</button>' +
                '</div>' +
            '</div>';
    }

    // ── Restore full Flow Panel DOM after init prompt replaced innerHTML ──

    function _restoreFlowPanelDOM() {
        const panel = document.getElementById('flowPanel');
        if (!panel) return;
        panel.innerHTML =
            '<!-- Phase Timeline Track -->' +
            '<div class="flow-timeline" id="flowTimeline"></div>' +
            '<!-- Main Flow Content -->' +
            '<div class="flow-body">' +
                '<div class="flow-current">' +
                    '<div class="flow-phase-header">' +
                        '<span id="flowPhaseIcon" class="flow-phase-icon"></span>' +
                        '<div class="flow-phase-info">' +
                            '<span class="flow-phase-label">CURRENT PHASE</span>' +
                            '<span id="flowPhaseName" class="flow-phase-name">---</span>' +
                        '</div>' +
                        '<span id="flowRoundBadge" class="flow-round-badge" style="display: none;"></span>' +
                    '</div>' +
                '</div>' +
                '<div class="flow-next-step">' +
                    '<span class="next-step-label">Next Step</span>' +
                    '<p id="flowGuidance" class="next-step-text"></p>' +
                    '<div class="flow-actions" id="flowActions"></div>' +
                '</div>' +
                '<div class="flow-controls">' +
                    '<button class="btn primary flow-primary-btn" id="flowPrimaryBtn" onclick="runFlowPrimaryAction()" disabled>---</button>' +
                    '<div class="flow-controls-secondary">' +
                        '<button class="btn-small secondary" id="advancePhaseBtn" onclick="advancePhase()" disabled>Next Phase ' + ICON_SVGS.play + '</button>' +
                        '<span id="phaseExtraControls" style="display: none;"></span>' +
                        '<span id="lobbyAdminControls" style="display: none;"></span>' +
                        '<span id="spellWindowControls" style="display: none;"></span>' +
                        '<button class="btn-small secondary" id="forceAdvanceBtn" onclick="forceAdvancePhase()" title="Force advance (skip requirements)">' + ICON_SVGS.triangleAlert + ' Force Advance</button>' +
                        '<button class="btn-small secondary" id="insertBreakBtn" onclick="insertBreak()" title="Insert break">' + ICON_SVGS.pause + ' Break</button>' +
                        '<button class="btn-small secondary" id="broadcastToggleBtn" onclick="toggleBroadcastBar()" title="Broadcast a message to view screens">' + ICON_SVGS.megaphone + '</button>' +
                        '<span id="breakIntervalBadge" class="break-interval-badge" onclick="openBreakSettings()" title="Break interval settings" style="display: none;"></span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="broadcast-bar" id="broadcastBar" style="display: none;">' +
                '<span style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">Broadcast</span>' +
                '<input type="text" id="broadcastInput" placeholder="Message shown on view page..." maxlength="200" ' +
                    'style="flex: 1; padding: 6px 12px; background: rgba(11, 13, 16, 0.6); border: 1px solid var(--border-soft, rgba(255, 255, 255, 0.08)); border-radius: 6px; color: white; font-size: 0.85rem;">' +
                '<button class="btn-small primary" onclick="setBroadcastMessage()">Send</button>' +
                '<button class="btn-small secondary" onclick="clearBroadcastMessage()">Clear</button>' +
            '</div>' +
            '<div class="broadcast-bar" id="spellLogBar" style="display: none;">' +
                '<span style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">Spell Log</span>' +
                '<div class="spell-log-teams" id="spellLogTeams"></div>' +
                '<input type="text" id="spellLogSpellInput" placeholder="Spell name..." maxlength="60" ' +
                    'onkeydown="if (event.key === \'Enter\') addSpellLogEntry()" ' +
                    'style="flex: 1; min-width: 220px; padding: 8px 12px; background: rgba(11, 13, 16, 0.6); border: 1px solid var(--border-soft, rgba(255, 255, 255, 0.08)); border-radius: 6px; color: white; font-size: 0.95rem;">' +
                '<button class="btn-small primary" onclick="addSpellLogEntry()">+ Add</button>' +
            '</div>' +
            '<div class="spell-log-entries" id="spellLogEntries" style="display: none;"></div>';
    }

    // ══════════════════════════════════════════════════════════════
    //  FLOW CONFIRM MODAL (generic guided-flow prompt)
    // ══════════════════════════════════════════════════════════════

    function _openFlowConfirm({ title, bodyHtml, confirmLabel, danger, onConfirm, secondaryLabel, onSecondary }) {
        const modal = document.getElementById('flowConfirmModal');
        if (!modal) {
            // Fallback: never block the admin if the modal is missing
            if (onConfirm) onConfirm();
            return;
        }
        const titleEl = document.getElementById('flowConfirmTitle');
        const bodyEl = document.getElementById('flowConfirmBody');
        const btn = document.getElementById('flowConfirmBtn');
        const secondaryBtn = document.getElementById('flowConfirmSecondaryBtn');

        if (titleEl) titleEl.textContent = title || 'Confirm';
        if (bodyEl) bodyEl.innerHTML = bodyHtml || '';
        if (btn) {
            btn.innerHTML = confirmLabel || 'Confirm';
            btn.className = danger ? 'btn danger' : 'btn primary';
            btn.onclick = () => {
                const fn = _flowConfirmAction;
                window.closeFlowConfirm();
                if (fn) fn();
            };
        }
        // Optional third action, for the rare case a confirm has a genuine
        // middle-ground choice (neither "do it" nor "cancel") — e.g. waive
        // + assign in one step instead of forcing the admin through two
        // separate modals. Hidden/cleared whenever not supplied, so every
        // other _openFlowConfirm call site is unaffected.
        if (secondaryBtn) {
            if (secondaryLabel && onSecondary) {
                secondaryBtn.style.display = '';
                secondaryBtn.innerHTML = secondaryLabel;
                secondaryBtn.onclick = () => {
                    window.closeFlowConfirm();
                    onSecondary();
                };
            } else {
                secondaryBtn.style.display = 'none';
                secondaryBtn.onclick = null;
            }
        }
        _flowConfirmAction = onConfirm || null;
        modal.style.display = 'flex';
    }

    window.closeFlowConfirm = () => {
        const modal = document.getElementById('flowConfirmModal');
        if (modal) modal.style.display = 'none';
        _flowConfirmAction = null;
    };

    // ══════════════════════════════════════════════════════════════
    //  POINTS PREVIEW (scoring_hex confirmation)
    // ══════════════════════════════════════════════════════════════

    /**
     * Compute the heart income each team would receive right now.
     *
     * Reads calculateHeartIncome() in board-module.js — the same function the
     * payout uses. It previously had its own copy of the +2/+1 values with no
     * multiplier, while awardRoundPoints() multiplied by the round's match
     * count: this dialog promised +2 for the mountain heart and the payout
     * then delivered +4. Both now come from one place, so what the TD is
     * shown is what the TD gets.
     */
    function _computeRoundPointsPreview() {
        const resolvingRound = (gameState.currentPhase?.roundNumber || 0) - 1;
        const { matchesPlayed, byTeam } =
            calculateHeartIncome(gameState, boardModule, resolvingRound);

        // Frozen hexes are excluded by calculateHeartIncome(); count them
        // here purely so the dialog can say how many are withheld.
        const contested = new Set();
        (gameState.gameQueue || []).forEach(m => {
            if (m.isChallenge && m.challengeHexCoord &&
                (m.status === 'pending' || m.status === 'ongoing')) {
                contested.add(m.challengeHexCoord);
            }
        });

        const teamIds = new Set((gameState.teams || []).map(t => String(t.id)));
        let frozenCount = 0;
        Object.entries(gameState.heartHexControl || {}).forEach(([coord, ownerId]) => {
            if (contested.has(coord) && teamIds.has(String(ownerId))) frozenCount++;
        });

        const rows = [];
        let total = 0;
        (gameState.teams || []).forEach(team => {
            const pts = byTeam[team.id]?.points || 0;
            total += pts;
            rows.push({ team, pts });
        });

        return { rows, frozenCount, total, matchesPlayed };
    }

    window.confirmScoringHexAdvance = () => {
        const { rows, frozenCount } = _computeRoundPointsPreview();
        const round = gameState.currentPhase?.roundNumber || 0;

        let body = '<p>Territory points from controlled heart hexes will be added to team totals. <strong>This cannot be undone.</strong></p>';
        body += rows.map(({ team, pts }) => {
            const color = team.color || '#888';
            return `<div class="points-preview-row">` +
                   `<span class="team-cell"><span class="dot" style="background:${color}"></span>${_esc(team.name || ('Team ' + team.id))}</span>` +
                   `<span class="pts ${pts > 0 ? '' : 'zero'}">+${pts}</span>` +
                   `</div>`;
        }).join('');
        if (frozenCount > 0) {
            body += `<p class="modal-warning-line" style="margin-top:10px;">${ICON_SVGS.triangleAlert} ${frozenCount} contested hex(es) frozen by active challenges — not scored.</p>`;
        }

        _openFlowConfirm({
            title: `Award Round ${round} Points`,
            bodyHtml: body,
            confirmLabel: 'Award & Continue ' + ICON_SVGS.play,
            onConfirm: () => window.advancePhase()
        });
    };

    // ══════════════════════════════════════════════════════════════
    //  SKIP CHALLENGES (no-challenge rounds no longer need Force spam)
    // ══════════════════════════════════════════════════════════════

    /**
     * Jump from `challenges` directly to `board_resolved`, skipping the
     * challenge-game phases entirely. Called automatically by advancePhase()
     * when no team requested a challenge — no modal, this IS the normal path.
     */
    async function _skipChallengePhases() {
        if (_phaseManager?.getCurrentPhase() !== 'challenges') return;
        const gs = gameState;
        const prev = { ...gs.currentPhase };
        gs.currentPhase = {
            name: 'board_resolved',
            roundNumber: prev.roundNumber || 0,
            startedAt: new Date().toISOString(),
            challengeGamesPlayed: 0
        };
        await saveGameState();
        _actionLogger?.logAction('phase_advanced', 'phase', {
            fromPhase: prev.name,
            toPhase: 'board_resolved',
            skippedChallenges: true,
            roundNumber: gs.currentPhase.roundNumber
        }, { currentPhase: prev });
        _uiShim.showStatus('No challenges this round — continuing to Board Check.', 'info');
        _phaseManager.recheckRequirements();
        if (typeof updateDisplay === 'function') updateDisplay();
    }

    window.skipChallenges = () => {
        _skipChallengePhases();
    };

    // ══════════════════════════════════════════════════════════════
    //  HOOK INTO ADMIN.JS DISPLAY UPDATE CYCLE
    // ══════════════════════════════════════════════════════════════

    window._onAdminDisplayUpdate = function () {
        // Win condition badge/check doesn't depend on the phase system being
        // initialized — render it regardless so it's visible from pre_game_setup
        if (gameState?.teams) {
            _renderWinConditionBadge();
            _checkWinCondition();
            _renderSpellsActiveBadge();
        }

        if (!_initialized) _initPhaseAdapter();
        if (!_phaseManager) return;

        // The Flow Panel owns advancement — hide the duplicate top-bar button
        // (it silently mapped to advancePhase anyway, with a misleading label)
        const legacyBtn = document.getElementById('legacyNextRoundBtn');
        if (legacyBtn) legacyBtn.style.display = gameState.currentPhase ? 'none' : '';

        if (!gameState.currentPhase) {
            _renderPhaseInitPrompt();
            return;
        }

        // Keep gameState.currentRound in sync with phase system roundNumber
        const phaseRound = gameState.currentPhase.roundNumber || 0;
        if (gameState.currentRound !== phaseRound) {
            gameState.currentRound = phaseRound;
            // Persist immediately instead of waiting on some unrelated future
            // save — otherwise the top-bar "ROUND" stat can show a stale
            // number (read from Firestore on next load) even though the
            // in-memory value here is already correct (bug #5).
            if (typeof saveGameState === 'function') saveGameState();
        }

        _phaseManager.recheckRequirements();

        // Stranded round_advance recovery: a crash between the two chained
        // saves can persist this auto-phase, whose UI has no advance button.
        // advancePhase()'s in-flight guard makes duplicates harmless.
        if (_phaseManager.getCurrentPhase() === 'round_advance') {
            _phaseManager.advancePhase();
        }

        _renderFlowPanel();
        _highlightNextQueueItem();
        _injectLiveMatchControls();

        // Keep the standing pendingHexBanner in sync on every render, across
        // EVERY phase — not just hex_placement_1/2 (TODO.md Task 15). It used
        // to be unconditionally removed here with a "Flow Panel handles it
        // now" comment, but the Flow Panel's own inline hex_placement_1/2
        // text (_computeNextStep) and action-item pills (_renderActionItems)
        // only ever appear for that one phase's/action's own rendering —
        // there was no indication left anywhere once the admin moved on to a
        // later phase (spell_window, board_resolved, ...) while a team's hex
        // was still outstanding. updatePendingHexNotification() itself
        // already no-ops into removing the banner once pendingHexWins is
        // empty, so this call is safe to run on every render regardless of
        // phase or whether anything is actually pending.
        if (typeof updatePendingHexNotification === 'function') updatePendingHexNotification();
    };

    // ══════════════════════════════════════════════════════════════
    //  WINDOW GLOBALS FOR ONCLICK HANDLERS
    // ══════════════════════════════════════════════════════════════

    window.runFlowPrimaryAction = () => {
        if (_primaryAction) _primaryAction();
    };

    window.toggleBroadcastBar = () => {
        _broadcastOpen = !_broadcastOpen;
        _renderBroadcastBar();
        if (_broadcastOpen) {
            document.getElementById('broadcastInput')?.focus();
        }
    };

    window.toggleSpellLogBar = () => {
        _spellLogOpen = !_spellLogOpen;
        _renderSpellLogBar();
        if (_spellLogOpen) {
            document.getElementById('spellLogSpellInput')?.focus();
        }
    };

    /** Pure local UI state — deliberately does NOT persist anything. */
    window.selectSpellLogTeam = (id) => {
        _spellLogTeamId = id;
        _renderSpellLogBar();
    };

    window.addSpellLogEntry = async () => {
        const input = document.getElementById('spellLogSpellInput');
        const teamId = _spellLogTeamId == null ? '' : String(_spellLogTeamId);
        const spellName = input?.value?.trim();
        if (!teamId || !spellName) return;

        const team = (gameState.teams || []).find(t => String(t.id) === String(teamId));
        gameState.spellWindowLog = gameState.spellWindowLog || [];
        gameState.spellWindowLog.push({
            id: `sl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            teamId,
            teamName: team?.name || `Team ${teamId}`,
            spellName,
            addedAt: new Date().toISOString()
        });

        if (input) input.value = '';
        await saveGameState();
        _renderSpellLogBar();
    };

    window.removeSpellLogEntry = async (id) => {
        gameState.spellWindowLog = (gameState.spellWindowLog || []).filter(e => e.id !== id);
        await saveGameState();
        _renderSpellLogBar();
    };

    window.initializePhaseSystem = async () => {
        _initPhaseAdapter();
        if (!_phaseManager) return;
        _phaseManager.initializePhase();
        await saveGameState();
        showStatus('Phase system initialized! Starting at Pre-Game Setup.', 'success');
        _restoreFlowPanelDOM();
        if (typeof updateDisplay === 'function') updateDisplay();
    };

    window.advancePhase = async () => {
        _initPhaseAdapter();
        if (!_phaseManager) return;
        // Challenges are optional: advancing with none queued skips the
        // challenge-game phases entirely instead of walking into them
        if (_phaseManager.getCurrentPhase() === 'challenges' &&
            _pendingChallengeMatches().length === 0 &&
            _ongoingChallengeMatches().length === 0) {
            await _skipChallengePhases();
            return;
        }
        _phaseManager.advancePhase(false);
    };

    window.forceAdvancePhase = () => {
        _initPhaseAdapter();
        _phaseManager?.openForceAdvanceModal();

        // Phase-specific consequence note (the requirements list alone
        // doesn't say what force-advancing DOES).
        document.getElementById('forceConsequenceNote')?.remove();
        const phase = _phaseManager?.getCurrentPhase();
        const reqList = document.getElementById('forceAdvanceRequirements');
        let note = '';
        if (phase === 'scoring_hex') {
            note = 'Territory points WILL still be awarded on force-advance (without the preview).';
        } else if (phase === 'matches_in_progress') {
            const leftovers = _pendingSlotMatches().length + _ongoingSlotMatches().length;
            if (leftovers > 0) note = `${leftovers} pending/ongoing match(es) will be left behind in the queue and may confuse later rounds.`;
        } else if (_phaseManager?.isSpellWindow(phase) && gameState.spellPhase?.isActive) {
            note = 'The active spell phase will be cleared.';
        } else if (phase === 'hex_placement_1' || phase === 'hex_placement_2') {
            note = 'Unplaced hex wins stay pending and will re-gate a future round — consider Waive instead.';
        }
        if (note && reqList) {
            reqList.insertAdjacentHTML('afterend',
                `<p id="forceConsequenceNote" class="modal-warning-line">${ICON_SVGS.triangleAlert} ${_esc(note)}</p>`);
        }
    };

    window.advanceSlot = async (slot) => {
        _initPhaseAdapter();
        await _phaseManager?.advanceSlot(slot, false);
    };

    window.forceAdvanceSlot = async (slot) => {
        _initPhaseAdapter();
        if (!_phaseManager) return;

        // Unlike forceAdvancePhase() (which opens a full confirmation modal
        // with a consequence note), this used to fire immediately with zero
        // confirmation -- a single misclick could skip a slot straight to
        // 'done' with matches still ongoing/unstarted, leaving them orphaned
        // in the queue while the display treats the slot as finished. Found
        // live: an accidental click cleared an in-progress Match 2.
        const reqs = _phaseManager.getSlotRequirements(slot) || [];
        const unmet = reqs.filter(r => !r.met).map(r => r.label);
        const lines = [`Force-advance Match ${slot} to its next stage, skipping its requirements?`];
        if (unmet.length > 0) {
            lines.push('', 'Currently unmet:', ...unmet.map(l => `• ${l}`));
        }
        lines.push('', 'Any ongoing or not-yet-started match in this slot will be left behind in the queue instead of being resolved.');
        if (!window.confirm(lines.join('\n'))) return;

        await _phaseManager.advanceSlot(slot, true);
    };

    window.confirmForceAdvance = async () => {
        await _phaseManager?.advancePhase(true);
        _phaseManager?.closeForceAdvanceModal();
    };

    window.closeForceAdvanceModal = () => {
        _phaseManager?.closeForceAdvanceModal();
    };

    window.insertBreak = () => {
        _phaseManager?.insertBreak();
    };

    window.endBreak = () => {
        _phaseManager?.endBreak();
    };

    window.endTournamentViaPhase = async () => {
        _initPhaseAdapter();
        await _phaseManager?.endTournament();
    };

    window.confirmWaiveHex = (matchNumber, teamId) => {
        _openFlowConfirm({
            title: 'Waive Hex Placement?',
            bodyHtml: '<p>The team’s earned hex placement is dismissed and the phase gate clears.</p>' +
                      '<p>This cannot be restored automatically (a hex can still be assigned manually on the board).</p>',
            confirmLabel: 'Waive',
            danger: true,
            onConfirm: () => window.waivePendingHexWin(matchNumber, teamId)
        });
    };

    const SET_PHASE_CHOICES = [
        'pre_game_setup', 'scoring_vp', 'scoring_hex', 'hex_placement_1',
        'spell_window_1', 'hex_placement_2', 'challenges', 'spell_window_2',
        'challenge_game', 'spell_window_3', 'board_resolved', 'spell_window_4',
        'matches_in_progress', 'tournament_end'
    ];

    window.openSetPhaseModal = () => {
        const modal = document.getElementById('setPhaseModal');
        if (!modal || !_phaseManager) return;
        const sel = document.getElementById('setPhaseSelect');
        if (sel && sel.options.length === 0) {
            SET_PHASE_CHOICES.forEach(p => sel.add(new Option(PHASE_LABELS[p] || p, p)));
        }
        if (sel) sel.value = _phaseManager.getCurrentPhase() || 'scoring_vp';
        const r = document.getElementById('setPhaseRound');
        if (r) r.value = gameState.currentPhase?.roundNumber || 1;
        const s1 = document.getElementById('setPhaseSlot1');
        const s2 = document.getElementById('setPhaseSlot2');
        if (s1) s1.value = _phaseManager.getSlotSubPhase(1);
        if (s2) s2.value = _phaseManager.getSlotSubPhase(2);
        modal.style.display = 'flex';
    };

    window.closeSetPhaseModal = () => {
        const modal = document.getElementById('setPhaseModal');
        if (modal) modal.style.display = 'none';
    };

    window.confirmSetPhase = async () => {
        const name = document.getElementById('setPhaseSelect')?.value;
        const roundNumber = document.getElementById('setPhaseRound')?.value;
        const slots = {
            1: document.getElementById('setPhaseSlot1')?.value || 'setup',
            2: document.getElementById('setPhaseSlot2')?.value || 'setup'
        };
        await _phaseManager?.setPhaseDirect({ name, roundNumber, slots });
        window.closeSetPhaseModal();
    };

    window.openBreakSettings = () => {
        _phaseManager?.openBreakSettings();
    };

    window.closeBreakSettings = () => {
        _phaseManager?.closeBreakSettings();
    };

    window.saveBreakSettings = (btn) => {
        _phaseManager?.saveBreakSettings(btn);
    };

    window.resetBreakCounter = () => {
        _phaseManager?.resetBreakCounter();
    };

    window.skipNextBreak = () => {
        _phaseManager?.skipNextBreak();
    };

    window.forceAllReady = async (slot) => {
        _phaseManager?.forceAllReadyForSlot(slot);
        await saveGameState();
        if (typeof updateDisplay === 'function') updateDisplay();
    };

    window.openChallengeLobby = async () => {
        _initPhaseAdapter();
        await _phaseManager?.openChallengeLobby();
    };

    window.forceAllChallengeReady = async () => {
        _phaseManager?.forceAllChallengeReady();
        await saveGameState();
        if (typeof updateDisplay === 'function') updateDisplay();
    };

    window.beginSpells = async () => {
        _phaseManager?.beginSpells();
    };

    window.loopBack = async () => {
        _phaseManager?.loopBack();
    };

    // ── Broadcast message handlers ──

    window.setBroadcastMessage = async () => {
        const input = document.getElementById('broadcastInput');
        const text = input?.value?.trim();
        if (!text) return;
        gameState.broadcastMessage = {
            text: text,
            sentAt: new Date().toISOString(),
            sentBy: 'admin'
        };
        await saveGameState();
        showStatus('Broadcast message sent.', 'success');
        _renderBroadcastBar();
    };

    window.clearBroadcastMessage = async () => {
        gameState.broadcastMessage = null;
        const input = document.getElementById('broadcastInput');
        if (input) input.value = '';
        await saveGameState();
        showStatus('Broadcast message cleared.', 'success');
        _renderBroadcastBar();
    };

    // ── Award round points and record history (used by phase advancement) ──

    function _awardPointsForRound() {
        const roundNumber = gameState.currentPhase?.roundNumber || 0;
        const history = gameState.pointsHistory || [];

        // Don't double-award
        if (history.some(e => e.round === roundNumber)) return;

        const pointsAwarded = (typeof awardRoundPoints === 'function')
            ? awardRoundPoints()
            : {};

        gameState.pointsHistory = history;
        gameState.pointsHistory.push({
            round: roundNumber,
            pointsAwarded: pointsAwarded,
            timestamp: new Date().toISOString()
        });

        // No explicit save — advancePhase() saves after all hooks run

        const msg = Object.entries(pointsAwarded)
            .map(([team, pts]) => `${team}: +${pts}`)
            .join(', ') || 'No points awarded';

        // A round in which nothing was played pays no heart income at all.
        // Surface it, so an unpaid round (or a round-tagging bug) is never
        // silent. awardRoundPoints() stamps these after each run.
        const played = (typeof awardRoundPoints === 'function')
            ? awardRoundPoints.lastMatchesPlayed : undefined;
        const resolved = (typeof awardRoundPoints === 'function')
            ? awardRoundPoints.lastResolvingRound : undefined;

        // Lead with the round being PAID FOR, not the round we're now in.
        // scoring_hex sits at the top of the new round, so "Round 2 points"
        // for round 1's income read as though round 2 had already scored.
        const playedNote = played === 0
            ? ' — no matches played, hearts pay nothing'
            : (played === undefined ? '' : ` (${played} match${played === 1 ? '' : 'es'} played)`);

        showStatus(`Round ${resolved ?? roundNumber} heart income${playedNote}: ${msg}`,
            played === 0 ? 'warning' : 'success');
    }

    // ══════════════════════════════════════════════════════════════
    //  START MATCH OVERRIDE — with skip warnings instead of silence
    // ══════════════════════════════════════════════════════════════

    const _origStartMatch = window.startMatch;

    async function _startMatchThenAdvance(gameId) {
        await _origStartMatch(gameId);
        if (!_phaseManager || !gameState.currentPhase) return;
        showStatus('Match started — advancing to playing phase...', 'success');
        // Advance until we reach a playing phase, break, or tournament end
        let safety = 10;
        while (safety-- > 0 &&
               !_phaseManager.isPlayingPhase() &&
               _phaseManager.getCurrentPhase() !== 'break' &&
               _phaseManager.getCurrentPhase() !== 'tournament_end') {
            await _phaseManager.advancePhase(true);
        }
    }

    window.startMatch = async function (gameId, skipPlacementCheck) {
        if (!_initialized) _initPhaseAdapter();
        const game = (gameState?.gameQueue || []).find(g => g.id === gameId);

        // Queue breaks and non-phase tournaments keep the original behavior
        if (!game || game.isBreak === true || !_phaseManager || !gameState.currentPhase) {
            return _origStartMatch(gameId);
        }

        // Hex placement is deliberately DEFERRED to next round: hex_placement_1/2
        // gate the PREVIOUS round's match win, not the current one (see
        // phase-manager.js's PHASE_ORDER doc comment) -- a win from THIS round's
        // Match 1 is not due until next round's hex_placement_1, so it is NOT
        // "not yet placed" in any actionable sense while Match 2 is starting.
        // Only count wins tagged for a round BEFORE this one: those already had
        // their placement window (this round's own hex_placement_1/2, already
        // passed by the time matches_in_progress is running) and are genuinely
        // overdue -- almost always because an earlier gate got force-advanced
        // past instead of placed or Waived. (Found live: this warning fired on
        // the completely routine "start match 2 right after confirming match
        // 1" sequence when it counted ALL pending wins with no round scoping.)
        const currentRoundNumber = gameState.currentPhase?.roundNumber;
        const overduePlacements = (pendingHexWins || []).filter(w =>
            w.roundNumber === undefined || currentRoundNumber === undefined ||
            w.roundNumber < currentRoundNumber
        ).length;
        if (overduePlacements > 0 && !skipPlacementCheck) {
            _openFlowConfirm({
                title: 'Hex Tiles Not Placed',
                bodyHtml: `<p><strong>${overduePlacements}</strong> hex placement${overduePlacements !== 1 ? 's are' : ' is'} still pending from an earlier round — teams should place ${overduePlacements !== 1 ? 'those' : 'that'} tile${overduePlacements !== 1 ? 's' : ''} before the next match starts.</p>`,
                confirmLabel: 'Start Anyway ' + ICON_SVGS.play,
                danger: true,
                onConfirm: () => window.startMatch(gameId, true)
            });
            return;
        }

        const phase = _phaseManager.getCurrentPhase();

        // Slot-aware guard: during the matches segment, a match belonging to
        // NEITHER current slot (future-round import, stale tag) used to start
        // silently just because some slot was in 'playing'. It can play, but
        // it won't count toward Match 1 or Match 2 — say so first.
        if (phase === 'matches_in_progress' && game.isChallenge !== true &&
            !_belongsToCurrentSlot(game, 1) && !_belongsToCurrentSlot(game, 2)) {
            const foreignLabel = _matchShortLabel(game);
            const tagDesc = game.roundNumber !== undefined
                ? `tagged Round ${game.roundNumber}${game.slot !== undefined ? ' · Match ' + game.slot : ''}`
                : 'untagged (created in an earlier phase)';
            _openFlowConfirm({
                title: 'Not This Round’s Match',
                bodyHtml: `<p><strong>${_esc(foreignLabel)}</strong> is ${_esc(tagDesc)} — it belongs to neither of this round’s match slots.</p>` +
                          `<p>It can play, but it will <strong>not</strong> count toward Match 1 or Match 2. To play it as this round’s match, retag it first (Edit Match → Round/Slot).</p>`,
                confirmLabel: 'Start Anyway',
                danger: true,
                onConfirm: () => _origStartMatch(gameId)
            });
            return;
        }

        // Playing phases: this is the expected place to start matches
        if (_phaseManager.isPlayingPhase(phase)) {
            return _origStartMatch(gameId);
        }

        const phaseLabel = PHASE_LABELS[phase] || phase;
        const matchLabel = _matchShortLabel(game);

        // Setup phases: starting now jumps ahead — tell the admin what gets skipped
        if (SETUP_PHASES.includes(phase)) {
            const skips = phase === 'challenges'
                ? 'the <strong>Spell Window</strong>'
                : 'the <strong>Lobby Ready</strong> check (players confirming game lobby + Discord)';
            _openFlowConfirm({
                title: 'Start Match Early?',
                bodyHtml: `<p>You are in <strong>${_esc(phaseLabel)}</strong>. Starting <strong>${_esc(matchLabel)}</strong> now skips ${skips} and jumps straight to the playing phase.</p>`,
                confirmLabel: 'Start & Skip ' + ICON_SVGS.play,
                onConfirm: () => _startMatchThenAdvance(gameId)
            });
            return;
        }

        // Lobby phases: show readiness status before skipping the wait
        if (LOBBY_PHASES.includes(phase)) {
            const reqs = _phaseManager.getPhaseRequirements();
            const summary = reqs.items.map(r => _esc(r.label)).join(' · ');
            _openFlowConfirm({
                title: 'Players Not Ready Yet',
                bodyHtml: `<p>Lobby status: <strong>${summary || 'unknown'}</strong>.</p>` +
                          `<p>Start <strong>${_esc(matchLabel)}</strong> anyway? The remaining ready checks will be skipped.</p>`,
                confirmLabel: 'Start Anyway ' + ICON_SVGS.play,
                onConfirm: () => _startMatchThenAdvance(gameId)
            });
            return;
        }

        // Any other phase (scoring, hex placement, spell window, board check, break):
        // starting a match here desyncs the flow — warn, and do NOT auto-advance.
        _openFlowConfirm({
            title: 'Out-of-Flow Match Start',
            bodyHtml: `<p>The tournament is in <strong>${_esc(phaseLabel)}</strong> — matches normally start during a playing phase.</p>` +
                      `<p><strong>${_esc(matchLabel)}</strong> will start, but the phase will <strong>not</strong> advance. The Flow Panel may no longer match reality.</p>`,
            confirmLabel: 'Start Anyway',
            danger: true,
            onConfirm: () => _origStartMatch(gameId)
        });
    };

    // ══════════════════════════════════════════════════════════════
    //  WIN CONDITION — editable after setup (experimental)
    // ══════════════════════════════════════════════════════════════
    //
    // setup.html writes gameState.winCondition once and nothing in the
    // full/admin.html + phase-manager flow ever reads it again — the only
    // code that checks it (board-manager.js) is loaded by god.html, not by
    // admin.html. So today it's a number nobody can see or change after
    // setup, and nothing enforces it in this flow either. This adds an
    // editable "Win At" badge plus a lightweight leader-vs-target check.

    function _renderWinConditionBadge() {
        const el = document.getElementById('winConditionValue');
        if (el) el.textContent = gameState?.winCondition ?? 50;
        _renderWinPaceBadge();
    }

    /**
     * "N rounds" until the front-runner reaches the win target on heart
     * income alone. A floor, not a forecast — match wins and hearts not yet
     * captured are excluded because they can't be known. Hidden entirely
     * until at least one team holds a heart.
     */
    function _renderWinPaceBadge() {
        const badge = document.getElementById('winPaceBadge');
        const value = document.getElementById('winPaceValue');
        if (!badge || !value) return;

        if (typeof projectRoundsToWin !== 'function' || !boardModule) {
            badge.style.display = 'none';
            return;
        }

        const leader = projectRoundsToWin(gameState, boardModule)
            .find(t => t.roundsToWin !== null);

        if (!leader) {
            badge.style.display = 'none';
            return;
        }

        badge.style.display = '';
        value.textContent = leader.roundsToWin === 0
            ? `${leader.teamName} — target reached`
            : `${leader.teamName} in ~${leader.roundsToWin} rd`;
    }

    window.openWinConditionModal = () => {
        const modal = document.getElementById('winConditionModal');
        if (!modal) return;
        const input = document.getElementById('winConditionInput');
        if (input) input.value = gameState?.winCondition ?? 50;

        const note = document.getElementById('winConditionLeaderNote');
        if (note) {
            const teams = gameState?.teams || [];
            const leader = teams.reduce((a, b) => ((b?.points || 0) > (a?.points || 0) ? b : a), teams[0]);
            const pace = (typeof projectRoundsToWin === 'function' && boardModule)
                ? projectRoundsToWin(gameState, boardModule).find(t => t.roundsToWin !== null)
                : null;
            const paceNote = (pace && pace.roundsToWin > 0)
                ? ` At current heart income (${pace.incomePerRound}/round, match wins not counted), ` +
                  `${pace.teamName} reaches ${gameState?.winCondition ?? 50} in ~${pace.roundsToWin} rounds.`
                : '';
            note.textContent = leader
                ? `Current leader: ${leader.name || 'Team ' + leader.id} with ${leader.points || 0} points.${paceNote}`
                : '';
        }
        modal.style.display = 'flex';
    };

    window.closeWinConditionModal = () => {
        const modal = document.getElementById('winConditionModal');
        if (modal) modal.style.display = 'none';
    };

    window.saveWinCondition = async (triggerBtn) => {
        const input = document.getElementById('winConditionInput');
        const value = parseInt(input?.value, 10);
        if (!value || value < 1) {
            showStatus('Enter a valid win condition.', 'warning');
            return;
        }
        const prev = gameState.winCondition;
        gameState.winCondition = value;
        await saveGameState(triggerBtn);
        _actionLogger?.logAction('win_condition_changed', 'admin', {
            newValue: value, previousValue: prev
        }, { winCondition: prev });
        showStatus(`Win condition set to ${value} points.`, 'success');
        window.closeWinConditionModal();
        _renderWinConditionBadge();
        _checkWinCondition();
    };

    /**
     * Lightweight win-condition check — the modern phase flow has no
     * equivalent to god.html's checkWinCondition(), so a team could sail
     * past the target with nothing but the Win At badge changing color.
     * This only surfaces a one-time banner; it does NOT auto-end the
     * tournament (that stays a deliberate admin action via the state
     * change modal / phase system, matching how tournament_end works).
     */
    let _winConditionAlertShown = false;
    function _checkWinCondition() {
        const target = gameState?.winCondition;
        if (!target || !gameState?.teams) return;
        const winner = gameState.teams.find(t => (t.points || 0) >= target);
        const badge = document.getElementById('winConditionValue')?.closest('.stat-badge');

        if (winner) {
            if (badge) badge.classList.add('win-reached');
            if (!_winConditionAlertShown) {
                _winConditionAlertShown = true;
                showStatus(`${winner.name || 'A team'} reached ${target} points — win condition met!`, 'success');
            }
        } else {
            if (badge) badge.classList.remove('win-reached');
            _winConditionAlertShown = false;
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  SPELLS ACTIVE — toggle whether team.html shows digital spell UI
    // ══════════════════════════════════════════════════════════════
    //
    // Spell windows (spell_window_1..4) still run in the phase flow either
    // way — this only controls whether players see the spell cards sidebar
    // and the spell-casting overlay on team.html. Defaults to false/off:
    // spells are now resolved physically at the table unless an admin
    // opts a tournament in.

    function _renderSpellsActiveBadge() {
        const el = document.getElementById('spellsActiveValue');
        if (el) el.textContent = gameState?.spellsActive === true ? 'On' : 'Off';
    }

    window.openSpellsActiveModal = () => {
        const modal = document.getElementById('spellsActiveModal');
        if (!modal) return;
        const input = document.getElementById('spellsActiveInput');
        if (input) input.checked = gameState?.spellsActive === true;
        modal.style.display = 'flex';
    };

    window.closeSpellsActiveModal = () => {
        const modal = document.getElementById('spellsActiveModal');
        if (modal) modal.style.display = 'none';
    };

    window.saveSpellsActive = async (triggerBtn) => {
        const input = document.getElementById('spellsActiveInput');
        const value = !!input?.checked;
        const prev = gameState.spellsActive === true;
        gameState.spellsActive = value;
        await saveGameState(triggerBtn);
        _actionLogger?.logAction('spells_active_changed', 'admin', {
            newValue: value, previousValue: prev
        }, { spellsActive: prev });
        showStatus(`Spells ${value ? 'enabled' : 'disabled'} for players.`, 'success');
        window.closeSpellsActiveModal();
        _renderSpellsActiveBadge();
    };

    // ══════════════════════════════════════════════════════════════
    //  HEX PLACEMENT POPUP — show which match it's for, gate the wrong team
    // ══════════════════════════════════════════════════════════════
    //
    // The stock popup (admin.js handleHexClick) renders one identical button
    // per team with zero reference to pendingHexWins — an admin at 3am can
    // place a hex for any team with no indication of who actually won the
    // match. This augments the already-rendered popup in place: adds a
    // "who's owed a placement" banner, badges the correct team button(s),
    // and gates every OTHER team behind a skippable warning.

    function _pendingTeamIdsSet(pending) {
        const ids = new Set();
        pending.forEach(win => {
            (win.teamIds || []).forEach(id => ids.add(String(id)));
        });
        return ids;
    }

    function _augmentTeamPicker(coord) {
        const container = document.getElementById('teamPickerOptions');
        if (!container) return;

        // Scoped to the current phase's slot during hex_placement_1/2, so
        // Match 2's still-pending winner doesn't show up (or get badged) as
        // "owed" while the admin is specifically placing Match 1's hex, and
        // vice versa. Outside those phases, every outstanding win is relevant.
        const phase = _phaseManager?.getCurrentPhase() || '';
        const pending = _relevantPendingWinsForPhase(phase);

        // Remove a stale banner from a previous popup open
        const oldInfo = container.querySelector('.hex-pending-info');
        if (oldInfo) oldInfo.remove();

        if (pending.length > 0) {
            const rows = pending.map(win => {
                const label = win.matchNumber ? `Match #${win.matchNumber}` : 'A match';
                const names = (win.teamNames || []).join(', ') || 'a team';
                return `<div class="hex-pending-row">${_esc(label)}: <strong>${_esc(names)}</strong> still needs to place a hex</div>`;
            }).join('');
            const info = document.createElement('div');
            info.className = 'hex-pending-info';
            info.innerHTML = rows;
            container.insertBefore(info, container.firstChild);
        }

        const pendingIds = _pendingTeamIdsSet(pending);
        if (pendingIds.size === 0) return; // no outstanding win — free-form editing, no gating

        container.querySelectorAll('.team-picker-btn').forEach(btn => {
            const onclickAttr = btn.getAttribute('onclick') || '';
            const m = onclickAttr.match(/assignTeamToHex\('([^']*)',\s*(-?\d+|null)\)/);
            if (!m) return; // room toggle button etc — leave untouched
            const btnCoord = m[1];
            const teamIdStr = m[2];
            if (teamIdStr === 'null') return; // "Clear Hex" button — leave untouched

            if (pendingIds.has(teamIdStr)) {
                btn.classList.add('team-picker-pending');
                const badge = document.createElement('span');
                badge.className = 'pending-badge';
                badge.innerHTML = ICON_SVGS.hourglass + ' owed';
                btn.appendChild(badge);

                // There's no way to detect "this is a spell-claimed hex, not
                // their earned placement" from the coordinate alone (earned
                // placements have no fixed target hex) — so make the admin
                // say which one it is. assignTeamToHex() itself no longer
                // auto-consumes a team's pending credit (see its comment in
                // admin.js); credit consumption is this modal's job, and
                // only on the explicit "earned placement" path below. The
                // other path is a plain assignment — their credit stays
                // fully intact, available for a LATER hex click through
                // this same modal.
                btn.onclick = (e) => {
                    e.preventDefault();
                    const team = gameState?.teams?.find(t => String(t.id) === teamIdStr);
                    const teamName = team?.name || `Team ${teamIdStr}`;
                    _openFlowConfirm({
                        title: 'Earned Placement, or Spell Claim?',
                        bodyHtml: `<p><strong>${_esc(teamName)}</strong> has an unplaced match-win hex credit.</p>` +
                                  `<p>Is <strong>this</strong> hex their <strong>earned placement</strong>? Assigning it below will also mark their credit as fulfilled.</p>` +
                                  `<p>Is this hex from a <strong>spell or an admin ruling</strong> instead? Use the button below — it assigns the hex but leaves their earned credit untouched, so they can still place it separately later.</p>`,
                        confirmLabel: 'This Is Their Earned Placement — Assign',
                        onConfirm: async () => {
                            await window.assignTeamToHex(btnCoord, parseInt(teamIdStr, 10));
                            await window.clearPendingHexWin(teamIdStr);
                        },
                        secondaryLabel: `${ICON_SVGS.hexagon} Spell / Admin Claim — Assign, Keep Credit`,
                        onSecondary: () => window.assignTeamToHex(btnCoord, parseInt(teamIdStr, 10))
                    });
                };
                return;
            }

            // Not the team that won — allow it, but make the admin confirm first
            btn.onclick = (e) => {
                e.preventDefault();
                const team = gameState?.teams?.find(t => String(t.id) === teamIdStr);
                const teamName = team?.name || `Team ${teamIdStr}`;
                const owedNames = pending.flatMap(w => w.teamNames || []).join(', ') || 'another team';
                _openFlowConfirm({
                    title: 'Wrong Team?',
                    bodyHtml: `<p><strong>${_esc(owedNames)}</strong> still owe${
                        pending.length === 1 && (pending[0].teamNames || []).length === 1 ? 's' : ''
                    } a hex placement from a recent match win. Assign this hex to <strong>${_esc(teamName)}</strong> instead?</p>`,
                    confirmLabel: 'Assign Anyway',
                    danger: true,
                    onConfirm: () => window.assignTeamToHex(btnCoord, parseInt(teamIdStr, 10))
                });
            };
        });
    }

    const _origHandleHexClick = window.handleHexClick;
    window.handleHexClick = function (coord) {
        _origHandleHexClick(coord);
        _augmentTeamPicker(coord);
    };

    // ══════════════════════════════════════════════════════════════
    //  PLAYER VOTES IN RESULT CONFIRM — who voted what, highlighted
    // ══════════════════════════════════════════════════════════════

    const _origOpenQuickConfirm = window.openQuickConfirm;
    window.openQuickConfirm = function (gameId) {
        _origOpenQuickConfirm(gameId);
        _injectVoteInfoIntoConfirm(gameId);
    };

    /**
     * Augment the stock result-confirm popup with the player vote tally:
     * per-option rows (count, percentage, voter names) plus a highlight on
     * the team card the players consider the likely winner.
     */
    function _injectVoteInfoIntoConfirm(gameId) {
        const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
        if (!game || game.isBreak === true) return;
        const votes = game.votes || [];
        if (votes.length === 0) return;
        const content = document.getElementById('resultConfirmContent');
        if (!content || content.querySelector('.confirm-votes-block')) return;

        const SIDE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
        const counts = {};
        votes.forEach(v => { counts[v.result] = (counts[v.result] || 0) + 1; });
        const total = votes.length;
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const [bestResult, bestCount] = sorted[0];
        const bestPct = Math.round((bestCount / total) * 100);
        const isTie = sorted.filter(([, c]) => c === bestCount).length > 1;

        const labelFor = (result) => {
            const m = result.match(/side_(\d+)_won/);
            if (m) return `Side ${SIDE_LETTERS[parseInt(m[1])] || m[1]} wins`;
            return result === 'draw' ? 'Draw' : result;
        };

        const rowsHtml = sorted.map(([result, count]) => {
            const pct = Math.round((count / total) * 100);
            const names = votes.filter(v => v.result === result)
                .map(v => _esc(v.playerName || 'Player')).join(', ');
            const favored = !isTie && result === bestResult;
            return `<div class="vote-row${favored ? ' favored' : ''}">` +
                   `<span class="vote-row-label">${labelFor(result)}</span>` +
                   `<span class="vote-row-bar"><span style="width:${pct}%"></span></span>` +
                   `<span class="vote-row-count">${count}/${total} &middot; ${pct}%</span>` +
                   `<div class="vote-row-names">${names}</div>` +
                   `</div>`;
        }).join('');

        const badge = isTie
            ? '<span class="vote-badge disputed">SPLIT VOTE</span>'
            : (game.voteConsensus?.passedThreshold
                ? '<span class="vote-badge consensus">CONSENSUS</span>'
                : `<span class="vote-badge leading">LEADING ${bestPct}%</span>`);

        const block = document.createElement('div');
        block.className = 'confirm-votes-block';
        block.innerHTML = `<div class="confirm-votes-title">Player votes ${badge}</div>${rowsHtml}`;

        const actions = content.querySelector('.confirm-actions');
        if (actions) content.insertBefore(block, actions);
        else content.appendChild(block);

        // Highlight the team card the players picked as the likely winner
        if (!isTie) {
            const m = bestResult.match(/side_(\d+)_won/);
            if (m) {
                const card = content.querySelectorAll('.confirm-team')[parseInt(m[1])];
                if (card) {
                    card.classList.add('vote-favored');
                    const pick = document.createElement('div');
                    pick.className = 'vote-favored-badge';
                    pick.textContent = `PLAYERS' PICK · ${bestPct}%`;
                    card.insertBefore(pick, card.firstChild);
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  LIVE MATCH EDITING — change players/game on an ongoing match
    // ══════════════════════════════════════════════════════════════
    //
    // The stock openEditMatchModal refuses ongoing matches, but at a LAN
    // matches change mid-flight (player swap on a restart, broken game
    // replaced). saveMatchEdits() is status-agnostic, so editing live is
    // safe — we re-implement the modal init without the "ongoing" block.

    const _origOpenEditMatchModal = window.openEditMatchModal;
    window.openEditMatchModal = function (gameId) {
        const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
        if (!game || game.status !== 'ongoing') {
            return _origOpenEditMatchModal(gameId);
        }

        // Same init as the original, minus the ongoing rejection
        editMatchState.gameId = gameId;
        editMatchState.game = game.game || game.gameType || '';
        editMatchState.isChallenge = game.isChallenge || false;
        const teams = game.teams || game.sides || [];
        editMatchState.sides = teams.map(team => getMatchTeamPlayers(team));
        while (editMatchState.sides.length < 2) {
            editMatchState.sides.push([]);
        }

        const numEl = document.getElementById('editMatchNumber');
        if (numEl) numEl.textContent = (game.matchNumber ? `#${game.matchNumber}` : '') + ' — LIVE';

        // Round/slot retag fields (hidden for challenges — mirrors the
        // stock openEditMatchModal population in admin.js)
        const tagRow = document.getElementById('editMatchTagRow');
        if (tagRow) tagRow.style.display = game.isChallenge ? 'none' : 'flex';
        const roundInput = document.getElementById('editMatchRoundInput');
        if (roundInput) roundInput.value = game.roundNumber !== undefined ? game.roundNumber : '';
        const slotSelect = document.getElementById('editMatchSlotSelect');
        if (slotSelect && (game.slot === 1 || game.slot === 2)) slotSelect.value = String(game.slot);

        populateEditGameTypeDropdown();
        renderEditMatchModal();
        document.getElementById('editMatchModal').classList.add('active');
    };

    /** Send a mis-started match back to the queue as not started. */
    window.revertMatchToQueue = function (gameId) {
        const game = (gameState?.gameQueue || []).find(g => g.id === gameId);
        if (!game || game.status !== 'ongoing') return;
        _openFlowConfirm({
            title: 'Move Match Back to Queue',
            bodyHtml: `<p><strong>${_esc(_matchShortLabel(game))}</strong> will return to the queue as not started. Use this when a match was started by mistake or needs a full restart.</p>`,
            confirmLabel: 'Back to Queue ' + ICON_SVGS.rewind,
            onConfirm: async () => {
                game.status = 'pending';
                delete game.startedAt;
                await saveGameState();
                showStatus('Match moved back to queue.', 'info');
            }
        });
    };

    /**
     * The shared renderers omit edit controls on ongoing matches — inject
     * ⚙ (edit live) and ⏪ (back to queue) after every display update.
     */
    function _injectLiveMatchControls() {
        // Ongoing entries in the queue list (have data-queue-id)
        document.querySelectorAll('#matchQueue .queue-item.ongoing').forEach(el => {
            const actions = el.querySelector('.match-actions');
            if (!actions || actions.querySelector('.live-edit-btn')) return;
            const game = (gameState?.gameQueue || []).find(g => String(g.id) === String(el.dataset.queueId));
            if (!game || game.isBreak === true) return;

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn live-edit-btn';
            editBtn.title = 'Edit live match (players / game)';
            editBtn.innerHTML = ICON_SVGS.settings;
            editBtn.onclick = (e) => { e.stopPropagation(); window.openEditMatchModal(game.id); };

            const revertBtn = document.createElement('button');
            revertBtn.className = 'move-top-btn live-revert-btn';
            revertBtn.title = 'Move back to queue (undo start)';
            revertBtn.innerHTML = ICON_SVGS.rewind;
            revertBtn.onclick = (e) => { e.stopPropagation(); window.revertMatchToQueue(game.id); };

            actions.insertBefore(revertBtn, actions.firstChild);
            actions.insertBefore(editBtn, actions.firstChild);
        });

        // Ongoing match cards above the queue (id only available via onclick attr)
        document.querySelectorAll('#ongoingMatchesList .ongoing-match').forEach(el => {
            if (el.querySelector('.live-edit-btn')) return;
            const m = (el.getAttribute('onclick') || '').match(/openQuickConfirm\((\d+)\)/);
            if (!m) return;
            const game = (gameState?.gameQueue || []).find(g => g.id === parseInt(m[1]));
            if (!game || game.isBreak === true) return;
            const actions = el.querySelector('.ongoing-actions');
            if (!actions) return;

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-small secondary live-edit-btn';
            editBtn.title = 'Edit live match (players / game)';
            editBtn.innerHTML = ICON_SVGS.settings;
            editBtn.onclick = (e) => { e.stopPropagation(); window.openEditMatchModal(game.id); };
            actions.appendChild(editBtn);
        });
    }

    // ── Override old advanceRound to use phase system when available ──

    const _origAdvanceRound = window.advanceRound;
    window.advanceRound = async function () {
        if (_phaseManager && gameState.currentPhase) {
            await window.advancePhase();
            return;
        }
        if (_origAdvanceRound) _origAdvanceRound();
    };

    // ── Tag every match-creation entry point with round/slot metadata ──
    // All four are top-level async function declarations in admin.js, so
    // window.X already exists for each — same override pattern as startMatch.

    const _origAddMatchToQueue = window.addMatchToQueue;
    window.addMatchToQueue = async function (triggerBtn) {
        const beforeIds = _snapshotQueueIds();
        await _origAddMatchToQueue(triggerBtn);
        await _tagNewQueueEntries(beforeIds);
    };

    const _origConfirmChallengeSetup = window.confirmChallengeSetup;
    window.confirmChallengeSetup = async function (triggerBtn) {
        const beforeIds = _snapshotQueueIds();
        await _origConfirmChallengeSetup(triggerBtn);
        await _tagNewQueueEntries(beforeIds);
    };

    const _origConfirmMassImport = window.confirmMassImport;
    window.confirmMassImport = async function (triggerBtn) {
        const beforeIds = _snapshotQueueIds();
        await _origConfirmMassImport(triggerBtn);
        await _tagImportedBatch(beforeIds); // sequence-based — see comment above
    };

    const _origConfirmAutoMatch = window.confirmAutoMatch;
    window.confirmAutoMatch = async function () {
        const beforeIds = _snapshotQueueIds();
        await _origConfirmAutoMatch();
        await _tagNewQueueEntries(beforeIds);
    };

    // ── Carry the match's round/slot tag onto its pendingHexWins entry ──
    // confirmResult() (called by quickConfirmResult) is where
    // pendingHexWins.push() happens, deep inside a large function —
    // wrapping it here is simpler than duplicating that logic.

    const _origConfirmResult = window.confirmResult;
    window.confirmResult = async function (winnerIndex) {
        const game = selectedQueuedGame; // capture before the original may clear related state
        const matchNumber = game?.matchNumber;
        const roundNumber = game?.roundNumber;
        const slot = game?.slot;

        await _origConfirmResult(winnerIndex);

        if (matchNumber !== undefined && roundNumber !== undefined) {
            const win = (pendingHexWins || []).find(w =>
                w.matchNumber === matchNumber && w.roundNumber === undefined);
            if (win) {
                win.roundNumber = roundNumber;
                win.slot = slot;
                // _origConfirmResult() already persisted the pushed entry
                // (see admin.js confirmResult), but that save ran BEFORE
                // this slot/roundNumber tagging — without this second save,
                // the tag would only reach Firestore incidentally, on
                // whatever unrelated save happens to run next. Since
                // _relevantPendingWinsForPhase() depends on `.slot` to keep
                // Match 1 / Match 2's hex_placement gates independent, this
                // needs to be reliably persisted too.
                await saveGameState();
            }
        }
    };

})();
