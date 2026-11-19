// BoardGame/full/scripts/match-dialog.js
/**
 * MATCH POP-UP (admin.html #matchDialog)
 *
 * A thin layer over admin.js's existing match-building code:
 *   - sides:   manualGameSetup + renderMatchCreationZones (drag/tap targets)
 *   - picker:  buildMatchPickerHTML() (drag/tap sources) + tap-to-select
 *   - manual:  addMatchToQueue      (adapter-wrapped: tags round/slot)
 *   - auto:    SmartMatchGenerator + confirmAutoMatch (adapter-wrapped)
 *   - challenge step 2: addChallengeToQueue -> #challengeSetupModal
 *
 * Match tab: build a match by hand, or ⚡ Auto-fill it from the balance
 * generator. A 5v5 suggestion fills the sides (still editable); queued
 * unchanged, it goes through confirmAutoMatch so it keeps the generator's
 * split metadata. A 3v3+2v2 pair can't be shown as one set of sides, so the
 * pop-up shows the pair preview and "Add both".
 *
 * Challenge tab: the same builder is step 1 (game + the players who play
 * the challenge game, which confirmChallengeSetup reads from
 * manualGameSetup); "Next" opens #challengeSetupModal for the disputes.
 *
 * Must load after admin.js. manualGameSetup / smartMatchGenerator /
 * pendingAutoMatch are top-level `let`s in admin.js: shared by bare name
 * across classic scripts, but NOT window properties.
 */
(function () {
    let tab = 'match';
    let pairMode = false;      // showing a generated 3v3+2v2 pair
    let suggestion = null;     // { result, key } of the last 5v5 Auto-fill

    function el(id) { return document.getElementById(id); }

    function setStatus(text) {
        const s = el('matchDialogStatus');
        if (s) s.textContent = text || '';
    }

    function sidesKey() {
        return JSON.stringify(manualGameSetup.sides.map(side => side.map(p => String(p.id)).sort()));
    }

    /** Blocking problem ('' when the match can be queued). */
    function blockingProblem() {
        const counts = manualGameSetup.sides.map(s => s.length);
        if (counts.some(c => c === 0)) return 'Every side needs at least one player';
        if (!el('gameType')?.value) return 'Pick a game';
        return '';
    }

    /** Status line: the blocking problem, else a non-blocking warning. */
    function currentStatus() {
        const problem = blockingProblem();
        if (problem) return problem;
        const counts = manualGameSetup.sides.map(s => s.length);
        if (!counts.every(c => c === counts[0])) return `Uneven sides (${counts.join('v')})`;
        return '';
    }

    function renderPicker() {
        const picker = el('matchDialogPicker');
        if (picker) picker.innerHTML = buildMatchPickerHTML();
        setupMatchAssignmentTapToSelect();
    }

    function renderTab() {
        const isChallenge = tab === 'challenge';
        document.querySelectorAll('#matchDialog [data-match-tab]').forEach(btn => {
            const active = btn.dataset.matchTab === tab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });
        el('matchDialogTitle').textContent = isChallenge ? 'Create challenge' : 'Create match';
        el('matchDialogChallengeHint').hidden = !isChallenge;
        el('matchDialogAutoFillBtn').hidden = isChallenge;
        if (isChallenge) {
            el('matchDialogAddBtn').textContent = 'Next: disputes →';
        } else {
            el('matchDialogAddBtn').textContent = pairMode ? 'Add both' : 'Add to queue';
        }
    }

    function matchDialogResetPair() {
        pairMode = false;
        suggestion = null;
        el('autoMatchContent').hidden = true;
        el('autoMatchContent').innerHTML = '';
        el('matchDialogBuilder').hidden = false;
        el('matchDialogReason').textContent = '';
        renderTab();
        setStatus(currentStatus());
    }

    function show(nextTab) {
        tab = nextTab === 'challenge' ? 'challenge' : 'match';
        updateGameTypeDropdown();
        renderPicker();
        renderMatchCreationZones();
        matchDialogResetPair();
        el('matchDialog').classList.add('active');
    }

    window.openMatchDialog = function (nextTab = 'match') {
        show(nextTab);
    };

    window.closeMatchDialog = function () {
        el('matchDialog')?.classList.remove('active');
        window.AdminLayout?.refresh();
    };

    /** Tabs in either pop-up (#matchDialog or #challengeSetupModal). */
    window.switchMatchDialogTab = function (nextTab) {
        if (el('challengeSetupModal')?.classList.contains('active')) closeChallengeSetupModal();
        if (el('matchDialog')?.classList.contains('active') && !pairMode) {
            tab = nextTab === 'challenge' ? 'challenge' : 'match';
            renderTab();
            setStatus(currentStatus());
            return;
        }
        show(nextTab);
    };

    /** Challenge step 2 -> back to step 1, keeping the chosen players. */
    window.matchDialogBackToPlayers = function () {
        closeChallengeSetupModal();
        show('challenge');
    };

    window.matchDialogResetPair = matchDialogResetPair;

    window.matchDialogAutoFill = function () {
        if (typeof SmartMatchGenerator === 'undefined' || !gameState?.teams) {
            setStatus('Load a tournament first');
            return;
        }
        if (!smartMatchGenerator) smartMatchGenerator = new SmartMatchGenerator(gameState);
        smartMatchGenerator.gameState = gameState;
        const result = smartMatchGenerator.generateNext();
        if (result.error) { setStatus(result.message); return; }

        const gameName = getGameDisplayName(result.gameId);
        const gameSelect = el('gameType');
        if (gameSelect) gameSelect.value = result.gameId;
        el('matchDialogReason').textContent = result.splitDescription || '';

        if (result.matches.length > 1) {
            pendingAutoMatch = { result, gameName };
            const pair = el('autoMatchContent');
            pair.innerHTML = buildSplitFormatModal(result, gameName);
            // The preview template carries its own Add/Cancel row for the old
            // modal; the pop-up footer owns those actions now.
            pair.querySelectorAll('.auto-match-actions').forEach(n => n.remove());
            pair.hidden = false;
            el('matchDialogBuilder').hidden = true;
            pairMode = true;
            suggestion = null;
            renderTab();
            setStatus('');
            return;
        }

        const match = result.matches[0];
        manualGameSetup = {
            sides: match.teams.map(side => side.players.map(p => ({
                id: p.id,
                name: p.name,
                originalTeamId: p.originalTeamId,
                originalTeamName: p.originalTeamName,
                originalTeamColor: p.originalTeamColor
            })))
        };
        renderMatchCreationZones();
        suggestion = { result, gameName, key: sidesKey() };
        setStatus(currentStatus());
    };

    window.matchDialogSubmit = async function (btn) {
        if (tab === 'challenge') {
            if (manualGameSetup.sides.some(s => s.length === 0)) { setStatus('Every side needs at least one player'); return; }
            if (!el('gameType')?.value) { setStatus('Pick a game'); return; }
            el('matchDialog').classList.remove('active');
            addChallengeToQueue(); // opens #challengeSetupModal (step 2)
            return;
        }
        if (pairMode) {
            await window.confirmAutoMatch(); // adapter-wrapped: tags the pair
            matchDialogResetPair();
            window.closeMatchDialog();
            return;
        }
        const problem = blockingProblem();
        if (problem) { setStatus(problem); return; }

        const unchangedSuggestion = suggestion &&
            suggestion.key === sidesKey() &&
            el('gameType')?.value === suggestion.result.gameId;
        if (unchangedSuggestion) {
            pendingAutoMatch = { result: suggestion.result, gameName: suggestion.gameName };
            await window.confirmAutoMatch();
            clearMatchSetup();
        } else {
            await window.addMatchToQueue(btn); // adapter-wrapped: tags the match
        }
        suggestion = null;
        window.closeMatchDialog();
    };

    /**
     * ⚡ Queue next: generate the next balanced match and queue it in one
     * click, through the same confirmAutoMatch path (and adapter tagging)
     * as the pop-up, then offer Undo.
     */
    window.queueNextMatch = async function () {
        if (typeof SmartMatchGenerator === 'undefined' || !gameState?.teams) {
            showStatus('Load a tournament first', 'warning');
            return;
        }
        if (!smartMatchGenerator) smartMatchGenerator = new SmartMatchGenerator(gameState);
        smartMatchGenerator.gameState = gameState;
        const result = smartMatchGenerator.generateNext();
        if (result.error) { showStatus(result.message, 'error'); return; }

        const before = new Set((gameState.gameQueue || []).map(e => e.id));
        pendingAutoMatch = { result, gameName: getGameDisplayName(result.gameId) };
        await window.confirmAutoMatch(); // adapter-wrapped: tags round/slot
        const added = (gameState.gameQueue || []).filter(e => !before.has(e.id)).map(e => e.id);
        if (added.length === 0) return;
        const label = `${getGameDisplayName(result.gameId)} queued — ${result.splitDescription || ''}`;
        showActionStatus(label, 'Undo', () => removeQueueEntriesSilently(added));
    };

    // The old "Auto" entry point (also used by the adapter's slot cards):
    // open the pop-up and Auto-fill it.
    window.generateSuggestedMatches = async function () {
        show('match');
        window.matchDialogAutoFill();
    };

    // A created challenge used the builder's players: clear them so the
    // next match starts empty.
    const originalConfirmChallenge = window.confirmChallengeSetup;
    window.confirmChallengeSetup = async function (...args) {
        const before = (gameState?.gameQueue || []).length;
        const out = await originalConfirmChallenge.apply(this, args);
        if ((gameState?.gameQueue || []).length > before) clearMatchSetup();
        return out;
    };

    // Keep the status line current while sides change.
    const originalRender = window.renderMatchCreationZones;
    window.renderMatchCreationZones = function () {
        originalRender();
        if (el('matchDialog')?.classList.contains('active') && !pairMode) setStatus(currentStatus());
    };

    document.addEventListener('change', (e) => {
        if (e.target?.id === 'gameType' && !pairMode) setStatus(currentStatus());
    });
})();
