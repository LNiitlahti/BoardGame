/**
 * admin-phase-adapter.js
 *
 * Bridges lightweight admin.js with OOP PhaseManager + ActionLogger.
 * Loaded AFTER admin.js, phase-manager.js, and action-logger.js.
 *
 * Renders the unified Flow Panel on full/admin.html, replacing the
 * old phase indicator bar with a richer, guidance-oriented UI that
 * shows timeline, action items, pending hex placements, and contextual
 * admin guidance.
 *
 * Only activates on full/admin.html -- the hook callbacks are no-ops
 * unless this script sets them.
 */

(function () {
    'use strict';

    let _actionLogger = null;
    let _phaseManager = null;
    let _initialized = false;

    // ── Phase constants (mirror phase-manager.js for timeline) ──

    /** Phases shown in the admin timeline track (simplified view) */
    const ADMIN_PHASE_ORDER = [
        'scoring_vp',
        'hex_placement_1',
        'challenges',
        'challenge_game',
        'board_resolved',
        'match_1_playing',
        'match_2_playing'
    ];

    const PHASE_LABELS = {
        pre_game_setup:   'Setup',
        scoring_vp:       'VP Scoring',
        scoring_hex:      'Hex Scoring',
        hex_placement_1:  'Hex 1',
        spell_window_1:   'Spells',
        hex_placement_2:  'Hex 2',
        challenges:       'Challenges',
        spell_window_2:   'Spells',
        challenge_game:   'Challenge Game',
        spell_window_3:   'Spells',
        board_resolved:   'Board Check',
        spell_window_4:   'Spells',
        match_1_setup:    'Match 1 Setup',
        match_1_lobby:    'Lobby 1',
        match_1_playing:  'Match 1',
        match_2_setup:    'Match 2 Setup',
        match_2_lobby:    'Lobby 2',
        match_2_playing:  'Match 2',
        round_advance:    'Round End',
        break:            'Break',
        tournament_end:   'Finished'
    };

    const PHASE_ICONS = {
        pre_game_setup:   '\u2699',
        scoring_vp:       '\u{1F3C6}',
        scoring_hex:      '\u2B22',
        hex_placement_1:  '\u{1F5FA}',
        spell_window_1:   '\u2728',
        hex_placement_2:  '\u{1F5FA}',
        challenges:       '\u2694',
        spell_window_2:   '\u2728',
        challenge_game:   '\u{1F3AE}',
        spell_window_3:   '\u2728',
        board_resolved:   '\u{1F6E1}',
        spell_window_4:   '\u2728',
        match_1_setup:    '\u{1F3DF}',
        match_1_lobby:    '\u{1F3AE}',
        match_1_playing:  '\u{1F3AE}',
        match_2_setup:    '\u{1F3DF}',
        match_2_lobby:    '\u{1F3AE}',
        match_2_playing:  '\u{1F3AE}',
        round_advance:    '\u23ED',
        break:            '\u23F8',
        tournament_end:   '\u{1F3C6}'
    };

    // Guidance text per phase — tells admin what to do NOW
    const PHASE_GUIDANCE = {
        pre_game_setup:   'Set up teams and configure tournament settings before starting.',
        scoring_vp:       'Review victory points awarded from match wins. VPs are granted instantly when results are confirmed.',
        scoring_hex:      'Hex territory points will be awarded when you advance. Review the board first.',
        hex_placement_1:  'Teams place hex plates for History Game 1 results.',
        spell_window_1:   'Optional spell window. Begin spells or skip to continue.',
        hex_placement_2:  'Teams place hex plates for History Game 2 results.',
        challenges:       'Create challenge matches for this round.',
        spell_window_2:   'Optional spell window. Begin spells or skip to continue.',
        challenge_game:   'Challenge game in progress. Confirm results when done.',
        spell_window_3:   'Optional spell window. Loop back for another challenge game or continue.',
        board_resolved:   'Verify the board is correct. This runs once after all challenge games.',
        spell_window_4:   'Optional spell window. Loop back to challenges or continue to matches.',
        match_1_setup:    'Create matches for Match Slot 1.',
        match_1_lobby:    'Waiting for all players to confirm ready for Match 1.',
        match_1_playing:  'Match 1 in progress. Confirm results as they finish.',
        match_2_setup:    'Create matches for Match Slot 2.',
        match_2_lobby:    'Waiting for all players to confirm ready for Match 2.',
        match_2_playing:  'Match 2 in progress. Confirm results as they finish.',
        round_advance:    'Round complete. Advancing to next round...',
        break:            'Break in progress. Click <strong>End Break</strong> when ready to continue.',
        tournament_end:   'Tournament is complete! View final standings and replay.'
    };

    // ── Minimal UIManager shim (PhaseManager only uses showStatus) ──

    const _uiShim = {
        showStatus(msg, type) {
            if (typeof showStatus === 'function') showStatus(msg, type);
        }
    };

    // ── Minimal TeamManager shim ──

    const _teamShim = {};

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

        // PhaseManager
        _phaseManager = new PhaseManager(gameState, {
            uiManager: _uiShim,
            teamManager: _teamShim,
            saveCallback: (btn) => saveGameState(btn),
            logActionCallback: logAction,
            onDisplayRefresh: () => {
                if (typeof updateDisplay === 'function') updateDisplay();
            }
        });

        // Wire pending hex count (used by phase requirements)
        _phaseManager._getPendingHexCount = () => (window.pendingHexWins || []).length;

        // Migrate old phase names if tournament was mid-game with old flow
        if (_phaseManager.migratePhaseIfNeeded()) {
            saveGameState();
        }

        // Wire hex territory points award when leaving scoring_hex
        _phaseManager._onAwardPoints = () => {
            _awardPointsForRound();
        };

        console.log('[admin-phase-adapter] PhaseManager + Flow Panel initialized');
    }

    // ── Escape HTML ──

    function _esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
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

        _renderTimeline(phase);
        _renderPhaseHeader(phase);
        _renderGuidance(phase);
        _renderActionItems(phase);
        _renderControls(phase);
        _renderBroadcastBar();
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
            match_1_setup: 5,       // part of match 1
            match_1_lobby: 5,       // part of match 1
            match_2_setup: 6,       // part of match 2
            match_2_lobby: 6,       // part of match 2
            round_advance: 7        // past end
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
            html = '<span class="flow-tl-step active"><span class="flow-tl-dot"></span><span class="flow-tl-label">\u23F8 Break</span></span>' +
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

        if (iconEl) iconEl.textContent = PHASE_ICONS[phase] || '';
        if (nameEl) nameEl.textContent = PHASE_LABELS[phase] || phase;

        if (roundEl) {
            const round = gameState.currentPhase?.roundNumber || 0;
            roundEl.textContent = round > 0 ? `Round ${round}` : '';
            roundEl.style.display = round > 0 ? '' : 'none';
        }
    }

    // ── Guidance Text ──

    function _renderGuidance(phase) {
        const el = document.getElementById('flowGuidance');
        if (!el) return;

        let text = PHASE_GUIDANCE[phase] || '';

        // Add contextual detail based on game state
        const queue = gameState.gameQueue || [];

        if (_phaseManager.isPlayingPhase(phase)) {
            const ongoing = queue.filter(m => !m.isBreak && m.status === 'ongoing').length;
            const pending = queue.filter(m => !m.isBreak && m.status === 'pending').length;
            if (ongoing > 0 || pending > 0) {
                const parts = [];
                if (ongoing > 0) parts.push(`<strong>${ongoing}</strong> match${ongoing !== 1 ? 'es' : ''} live`);
                if (pending > 0) parts.push(`<strong>${pending}</strong> pending`);
                text += ' ' + parts.join(', ') + '.';
            }
        } else if (phase === 'hex_placement_1' || phase === 'hex_placement_2') {
            const hexCount = (window.pendingHexWins || []).length;
            if (hexCount > 0) {
                text = `<strong>${hexCount}</strong> team${hexCount !== 1 ? 's' : ''} need to place hex plates. Click on the board to assign.`;
            } else {
                text = 'All hex plates placed. Ready to advance.';
            }
        } else if (_phaseManager.isLobbyPhase(phase)) {
            const lobbyReady = gameState.lobbyReady || {};
            const entries = Object.values(lobbyReady);
            const total = entries.length;
            if (total > 0) {
                const glCount = entries.filter(v => v?.gameLobby === true || v?.ready === true).length;
                const dcCount = entries.filter(v => v?.discord === true || v?.ready === true).length;
                text += ` \uD83C\uDFAE <strong>${glCount}/${total}</strong> game lobby, \uD83C\uDFA7 <strong>${dcCount}/${total}</strong> Discord.`;
            }
        } else if (_phaseManager.isSpellWindow(phase)) {
            const sp = gameState.spellPhase;
            if (sp?.isActive) {
                const done = sp.teamsCompleted?.length || 0;
                const total = sp.turnOrder?.length || 0;
                text = `Spell phase active: <strong>${done}/${total}</strong> teams completed.`;
            }
            // Show challenge game counter for spell_window_3
            if (phase === 'spell_window_3') {
                const gamesPlayed = gameState.currentPhase?.challengeGamesPlayed || 0;
                text += ` Challenge games this round: <strong>${gamesPlayed}</strong>/7.`;
            }
        }

        el.innerHTML = text;
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
            const icon = r.met ? '\u2713' : '\u2717';
            html += `<span class="flow-action-item ${cls}">` +
                    `<span class="flow-action-icon">${icon}</span> ${_esc(r.label)}</span>`;
        });

        // 2) Pending hex placements
        const pendingHex = window.pendingHexWins || [];
        pendingHex.forEach(win => {
            const matchLabel = win.matchNumber ? `#${win.matchNumber}` : '';
            win.teamIds.forEach((teamId, idx) => {
                const teamName = win.teamNames[idx] || `Team ${teamId}`;
                const team = gameState?.teams?.find(t => String(t.id) === String(teamId));
                const color = team?.color || 'var(--accent-warning)';
                html += `<span class="flow-action-item action-pending" title="Match ${matchLabel}: ${teamName} needs to place a hex plate">` +
                        `<span class="flow-action-icon">\u2B22</span> ` +
                        `<span class="flow-action-team" style="color: ${color}">${_esc(teamName)}</span> hex</span>`;
            });
        });

        // 3) Voted matches awaiting admin confirmation
        const queue = gameState.gameQueue || [];
        const votedMatches = queue.filter(m => m.votes && m.votes.length > 0 && !m.adminConfirmed && m.status === 'ongoing');
        votedMatches.forEach(m => {
            const gameName = (typeof getGameDisplayName === 'function') ? getGameDisplayName(m.gameId) : (m.gameId || 'Match');
            html += `<span class="flow-action-item action-vote" title="Players voted on result for ${gameName}">` +
                    `<span class="flow-action-icon">\u{1F5F3}</span> Vote: ${_esc(gameName)}</span>`;
        });

        container.innerHTML = html;
    }

    // ── Controls (Next Phase, Force, Break, Spells, Loop) ──

    function _renderControls(phase) {
        const advBtn = document.getElementById('advancePhaseBtn');
        const forceBtn = document.getElementById('forceAdvanceBtn');
        const breakBtn = document.getElementById('insertBreakBtn');
        const lobbyControls = document.getElementById('lobbyAdminControls');
        const breakBadge = document.getElementById('breakIntervalBadge');

        const reqs = _phaseManager.getPhaseRequirements();

        if (advBtn) {
            const isBreak = phase === 'break';
            const isEnd = phase === 'tournament_end';
            advBtn.textContent = isBreak ? 'End Break \u25B6' : 'Next Phase \u25B6';
            advBtn.disabled = isEnd || (!isBreak && !reqs.allMet);
            advBtn.onclick = isBreak
                ? () => window.endBreak()
                : () => window.advancePhase();
        }

        if (forceBtn) {
            forceBtn.style.display = (phase === 'tournament_end' || phase === 'break' || phase === 'pre_game_setup') ? 'none' : '';
        }

        if (breakBtn) {
            breakBtn.style.display = (phase === 'break' || phase === 'tournament_end' || phase === 'pre_game_setup') ? 'none' : '';
        }

        // Lobby ready admin controls
        if (lobbyControls) {
            if (_phaseManager.isLobbyPhase(phase)) {
                lobbyControls.style.display = '';
                lobbyControls.innerHTML =
                    '<button class="btn-small secondary" onclick="forceAllReady()" title="Mark all players as ready">Force All Ready</button>';
            } else {
                lobbyControls.style.display = 'none';
                lobbyControls.innerHTML = '';
            }
        }

        // Spell window controls (Begin Spells + Loop)
        _renderSpellWindowControls(phase);

        // Break interval badge
        if (breakBadge) {
            const bs = gameState.breakSettings;
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

    function _renderSpellWindowControls(phase) {
        // Try to find or create a spell controls container
        let container = document.getElementById('spellWindowControls');
        if (!container) {
            // Create it dynamically next to lobby controls
            const lobbyControls = document.getElementById('lobbyAdminControls');
            if (lobbyControls) {
                container = document.createElement('span');
                container.id = 'spellWindowControls';
                lobbyControls.parentElement.insertBefore(container, lobbyControls.nextSibling);
            }
        }
        if (!container) return;

        if (!_phaseManager.isSpellWindow(phase)) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        container.style.display = '';
        let html = '';

        const sp = gameState.spellPhase;
        if (!sp?.isActive) {
            html += '<button class="btn-small primary" onclick="beginSpells()" title="Start spell casting phase">\u2728 Begin Spells</button> ';
        }

        const loopInfo = _phaseManager.getLoopInfo();
        if (loopInfo.canLoop) {
            html += `<button class="btn-small secondary" onclick="loopBack()" title="${_esc(loopInfo.label)}">${_esc(loopInfo.label)}</button>`;
        } else if (loopInfo.target && !loopInfo.canLoop) {
            html += `<span style="font-size: 0.75rem; color: var(--text-tertiary);">${_esc(loopInfo.label)}</span>`;
        }

        container.innerHTML = html;
    }

    // ── Broadcast Bar ──

    function _renderBroadcastBar() {
        const broadcastBar = document.getElementById('broadcastBar');
        if (broadcastBar) {
            broadcastBar.style.display = 'flex';
            const broadcastInput = document.getElementById('broadcastInput');
            if (broadcastInput && gameState.broadcastMessage?.text && !broadcastInput.value) {
                broadcastInput.value = gameState.broadcastMessage.text;
            }
        }
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
                        '<span class="flow-phase-icon">\u2699</span>' +
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
                    '<p id="flowGuidance" class="flow-guidance"></p>' +
                '</div>' +
                '<div class="flow-actions" id="flowActions"></div>' +
                '<div class="flow-controls">' +
                    '<button class="btn primary" id="advancePhaseBtn" onclick="advancePhase()" disabled>Next Phase \u25B6</button>' +
                    '<div class="flow-controls-secondary">' +
                        '<button class="btn-small secondary" id="forceAdvanceBtn" onclick="forceAdvancePhase()" title="Force advance (skip requirements)">\u26A0 Force</button>' +
                        '<button class="btn-small secondary" id="insertBreakBtn" onclick="insertBreak()" title="Insert break">\u23F8 Break</button>' +
                        '<span id="breakIntervalBadge" class="break-interval-badge" onclick="openBreakSettings()" title="Break interval settings" style="display: none;"></span>' +
                    '</div>' +
                    '<span id="lobbyAdminControls" style="display: none;"></span>' +
                    '<span id="spellWindowControls" style="display: none;"></span>' +
                '</div>' +
            '</div>' +
            '<div class="broadcast-bar" id="broadcastBar" style="display: none;">' +
                '<span style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">Broadcast</span>' +
                '<input type="text" id="broadcastInput" placeholder="Message shown on view page..." maxlength="200" ' +
                    'style="flex: 1; padding: 6px 12px; background: rgba(11, 13, 16, 0.6); border: 1px solid var(--border-soft, rgba(255, 255, 255, 0.08)); border-radius: 6px; color: white; font-size: 0.85rem;">' +
                '<button class="btn-small primary" onclick="setBroadcastMessage()">Send</button>' +
                '<button class="btn-small secondary" onclick="clearBroadcastMessage()">Clear</button>' +
            '</div>';
    }

    // ══════════════════════════════════════════════════════════════
    //  HOOK INTO ADMIN.JS DISPLAY UPDATE CYCLE
    // ══════════════════════════════════════════════════════════════

    window._onAdminDisplayUpdate = function () {
        if (!_initialized) _initPhaseAdapter();
        if (!_phaseManager) return;

        if (!gameState.currentPhase) {
            _renderPhaseInitPrompt();
            return;
        }

        // Keep gameState.currentRound in sync with phase system roundNumber
        const phaseRound = gameState.currentPhase.roundNumber || 0;
        if (gameState.currentRound !== phaseRound) {
            gameState.currentRound = phaseRound;
        }

        _phaseManager.recheckRequirements();
        _renderFlowPanel();

        // Suppress the old pendingHexBanner (Flow Panel handles it now)
        const oldBanner = document.getElementById('pendingHexBanner');
        if (oldBanner) oldBanner.remove();
    };

    // ══════════════════════════════════════════════════════════════
    //  WINDOW GLOBALS FOR ONCLICK HANDLERS
    // ══════════════════════════════════════════════════════════════

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
        _phaseManager.advancePhase(false);
    };

    window.forceAdvancePhase = () => {
        _initPhaseAdapter();
        _phaseManager?.openForceAdvanceModal();
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

    window.forceAllReady = async () => {
        _phaseManager?.forceAllReady();
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
    };

    window.clearBroadcastMessage = async () => {
        gameState.broadcastMessage = null;
        const input = document.getElementById('broadcastInput');
        if (input) input.value = '';
        await saveGameState();
        showStatus('Broadcast message cleared.', 'success');
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
        showStatus(`Round ${roundNumber} points: ${msg}`, 'success');
    }

    // ── Override startMatch to advance phase when needed ──

    const _origStartMatch = window.startMatch;
    window.startMatch = async function (gameId) {
        // Call original startMatch first
        await _origStartMatch(gameId);

        // If phase system is active and we're in a setup/lobby phase,
        // auto-advance through intermediate phases to a playing phase
        if (_phaseManager && gameState.currentPhase) {
            const current = _phaseManager.getCurrentPhase();
            const setupPhases = [
                'challenges', 'match_1_setup', 'match_1_lobby',
                'match_2_setup', 'match_2_lobby'
            ];
            const playingPhases = [
                'challenge_game', 'match_1_playing', 'match_2_playing'
            ];
            if (setupPhases.includes(current)) {
                showStatus('Match started \u2014 advancing to playing phase...', 'success');
                // Advance until we reach a playing phase, break, or tournament end
                let safety = 10;
                while (safety-- > 0 &&
                       !playingPhases.includes(_phaseManager.getCurrentPhase()) &&
                       _phaseManager.getCurrentPhase() !== 'break' &&
                       _phaseManager.getCurrentPhase() !== 'tournament_end') {
                    await _phaseManager.advancePhase(true);
                }
            }
        }
    };

    // ── Override old advanceRound to use phase system when available ──

    const _origAdvanceRound = window.advanceRound;
    window.advanceRound = async function () {
        if (_phaseManager && gameState.currentPhase) {
            await window.advancePhase();
            return;
        }
        if (_origAdvanceRound) _origAdvanceRound();
    };

})();
