/**
 * MatchQueueManager
 *
 * Owns queue rendering, drag-reorder, match start, break management,
 * clear queue, ongoing matches display, and persistent match numbering.
 */

const BREAK_TYPES = {
    piss:      { label: 'Piss Break',     emoji: iconSvg('toilet', '#9ca3af') },
    cigarette: { label: 'Cigarette Break', emoji: iconSvg('cigarette', '#fef9c3') },
    food:      { label: 'Food Break',      emoji: iconSvg('pizza', '#f97316') },
    sleep:     { label: 'Sleep',           emoji: iconSvg('moon', '#818cf8') }
};

if (typeof SIDE_LABELS === 'undefined') {
    var SIDE_LABELS = ['A', 'B', 'C', 'D', 'E'];
}

/**
 * Set of player IDs currently on ANY ongoing/live match in the given queue.
 * Used to exclude a player's OTHER queued matches from "next up"/NEXT-badge
 * selection — a player can't be starting a second match while already live
 * in one (see TODO.md's "Next up match selection" writeup: match #122 was
 * live with two players, and a slot's Next-up + the queue's NEXT badge both
 * picked a different pending match that ALSO had those same two players on
 * it, skipping a genuinely available match with zero overlap).
 *
 * admin.html's guided Next-up/NEXT-badge selection (admin-improved-
 * adapter.js) needs the identical logic but cannot import this file
 * directly — admin.html doesn't load match-queue-manager.js, and can't
 * safely be made to, since this file's top-level `const BREAK_TYPES` would
 * collide (SyntaxError) with admin.js's own top-level `const BREAK_TYPES`
 * once both scripts share admin.html's global scope. admin-improved-
 * adapter.js therefore keeps a local copy of this same function. Keep both
 * in sync if the live-match/team data shape ever changes.
 */
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
window.getPlayersInLiveMatches = getPlayersInLiveMatches;

class MatchQueueManager {

    /**
     * @param {Object} gameState
     * @param {Object} deps
     * @param {UIManager}  deps.uiManager
     * @param {TeamManager} deps.teamManager
     * @param {Function}   deps.saveCallback       - (triggerBtn?) => Promise<void>
     * @param {Function}   deps.logEventCallback    - (type, data) => void
     * @param {Function}   [deps.closeResultConfirm] - closes result modal
     */
    /**
     * @param {Object} gameState
     * @param {Object} deps
     * @param {UIManager}  deps.uiManager
     * @param {TeamManager} deps.teamManager
     * @param {Function}   deps.saveCallback       - (triggerBtn?) => Promise<void>
     * @param {Function}   deps.logEventCallback    - (type, data) => void (legacy)
     * @param {Function}   [deps.logActionCallback] - (actionType, category, payload, previousState) => void
     * @param {Function}   [deps.closeResultConfirm] - closes result modal
     */
    constructor(gameState, { uiManager, teamManager, saveCallback, logEventCallback, logActionCallback, closeResultConfirm }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._teams = teamManager;
        this._save = saveCallback;
        this._logEvent = logEventCallback || (() => {});
        this._logAction = logActionCallback || (() => {});
        this._closeResultConfirm = closeResultConfirm || (() => {});
        this._draggedQueueId = null;
        this._asyncBusy = false;
        this._breakMenuCloseHandler = null;
    }

    // ------------------------------------------------------------------
    // Persistent match numbering
    // ------------------------------------------------------------------

    getNextMatchNumber() {
        const allMatches = this._gameState?.gameQueue || [];
        if (allMatches.length === 0) return 1;
        const maxNumber = Math.max(...allMatches.map(m => m.matchNumber || 0));
        return maxNumber + 1;
    }

    // ------------------------------------------------------------------
    // Queue rendering (admin.js patterns)
    // ------------------------------------------------------------------

    renderMatchQueue(containerId = 'matchQueue', countId = 'queueCount') {
        const container = document.getElementById(containerId);
        const countEl = document.getElementById(countId);

        const allGames = (this._gameState?.gameQueue || []).filter(g => g.status !== 'completed');
        const ongoingGames = allGames.filter(g => g.status === 'ongoing');
        const queuedGames = allGames.filter(g =>
            g.status === 'pending' || g.status === undefined || g.status === 'queued'
        );

        if (countEl) countEl.textContent = allGames.length;

        const allToRender = [...ongoingGames, ...queuedGames];

        if (allToRender.length === 0) {
            if (container) container.innerHTML = '<p class="queue-empty">No matches in queue</p>';
            return;
        }

        if (!container) return;

        container.innerHTML = allToRender.map(game => {
            const isOngoing = game.status === 'ongoing';

            if (game.isBreak === true) {
                return this._renderBreakItem(game, isOngoing);
            }
            return this._renderMatchItem(game, isOngoing);
        }).join('');
    }

    renderOngoingMatches(containerId = 'ongoingMatchesList') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const ongoing = (this._gameState?.gameQueue || []).filter(g => g.status === 'ongoing');

        if (ongoing.length === 0) {
            container.innerHTML = '<p class="queue-empty">No matches in progress</p>';
            return;
        }

        container.innerHTML = ongoing.map(game => {
            if (game.isBreak === true) {
                const breakDef = BREAK_TYPES[game.breakType] || { label: game.breakLabel || 'Break', emoji: ICON_SVGS.pause };
                return `
                    <div class="ongoing-match break" onclick="openQuickConfirm(${game.id})">
                        <div class="ongoing-game-name"><span class="break-badge">BREAK</span> ${breakDef.emoji} ${breakDef.label}</div>
                        <div class="ongoing-actions">
                            <button class="btn team-win-btn" onclick="event.stopPropagation(); completeBreak(${game.id})">Done</button>
                        </div>
                    </div>`;
            }

            const teams = game.teams || [];
            const gameName = this._teams.getGameDisplayName(game.game || game.gameType);
            const matchNumDisplay = game.matchNumber ? `#${game.matchNumber} ` : '';
            const isChallenge = game.isChallenge === true;
            const challengeBadge = isChallenge ? '<span class="challenge-badge">CHALLENGE</span> ' : '';

            const teamNamesHtml = teams.map((team, idx) => {
                const label = SIDE_LABELS[idx] || (idx + 1);
                const players = this._teams.getMatchTeamPlayers(team);
                let names = `Team ${label}`;
                if (players.length > 0) {
                    names = players.map(p => p.name || 'Unknown').join(', ');
                } else if (team.name) {
                    names = team.name;
                }
                return `<span class="ongoing-team">${names}</span>`;
            }).join('<span class="ongoing-vs">vs</span>');

            const winButtonsHtml = teams.map((_, idx) => {
                const label = SIDE_LABELS[idx] || (idx + 1);
                return `<button class="btn team-win-btn" onclick="event.stopPropagation(); quickConfirmResult(${game.id}, ${idx})">${label} Wins</button>`;
            }).join('');

            return `
                <div class="ongoing-match ${isChallenge ? 'challenge' : ''}" onclick="openQuickConfirm(${game.id})">
                    <div class="ongoing-game-name">${challengeBadge}${matchNumDisplay}${gameName}</div>
                    <div class="ongoing-teams">${teamNamesHtml}</div>
                    <div class="ongoing-actions">${winButtonsHtml}</div>
                </div>`;
        }).join('');
    }

    // ------------------------------------------------------------------
    // Match start
    // ------------------------------------------------------------------

    async startMatch(gameId) {
        if (this._asyncBusy) return;
        this._asyncBusy = true;
        try {
            const game = (this._gameState?.gameQueue || []).find(g => g.id === gameId);
            if (!game) {
                this._ui.showStatus('Match not found', 'error');
                return;
            }

            game.status = 'ongoing';
            game.startedAt = new Date().toISOString();
            await this._save();

            const gameName = this._teams.getGameDisplayName(game.game || game.gameType);
            const matchNum = game.matchNumber ? `#${game.matchNumber}` : '';
            this._logEvent('match_start', {
                gameName,
                matchNumber: game.matchNumber,
                playType: game.playType,
                isChallenge: game.isChallenge || false,
                message: `${matchNum} ${gameName} started`
            });
            this._logAction('match_started', 'match', {
                matchId: game.id, matchNumber: game.matchNumber,
                game: game.game, gameName, playType: game.playType,
                isChallenge: game.isChallenge || false
            }, { matchId: game.id, status: 'pending', startedAt: null });

            this._ui.showStatus('Match started!', 'success');
        } finally { this._asyncBusy = false; }
    }

    // ------------------------------------------------------------------
    // Queue reordering (drag-drop)
    // ------------------------------------------------------------------

    dragQueueItem(event, gameId) {
        this._draggedQueueId = gameId;
        const queueItem = event.target.closest('.queue-item');
        if (queueItem) queueItem.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
    }

    allowQueueDrop(event) {
        event.preventDefault();
        const item = event.currentTarget;
        if (parseInt(item.dataset.queueId) !== this._draggedQueueId) {
            item.classList.add('drag-over');
        }
    }

    leaveQueueDrop(event) {
        event.currentTarget.classList.remove('drag-over');
    }

    endQueueDrag(event) {
        const queueItem = event.target.closest('.queue-item');
        if (queueItem) queueItem.classList.remove('dragging');
        this._draggedQueueId = null;
        document.querySelectorAll('.queue-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    async dropQueueItem(event, targetId) {
        event.preventDefault();
        event.currentTarget.classList.remove('drag-over');
        if (this._draggedQueueId === targetId) return;

        const queue = this._gameState.gameQueue || [];
        const ongoingGames = queue.filter(g => g.status === 'ongoing');
        const pendingGames = queue.filter(g => g.status === 'pending' || g.status === undefined || g.status === 'queued');
        const completedGames = queue.filter(g => g.status === 'completed');

        const draggedIndex = pendingGames.findIndex(g => g.id === this._draggedQueueId);
        const targetIndex = pendingGames.findIndex(g => g.id === targetId);
        if (draggedIndex === -1 || targetIndex === -1) return;

        const [draggedGame] = pendingGames.splice(draggedIndex, 1);
        pendingGames.splice(targetIndex, 0, draggedGame);

        this._gameState.gameQueue = [...ongoingGames, ...pendingGames, ...completedGames];
        await this._save();
        this._ui.showStatus('Queue reordered', 'success');
    }

    async moveMatchToTop(gameId) {
        if (this._asyncBusy) return;
        this._asyncBusy = true;
        try {
            const queue = this._gameState.gameQueue || [];
            const ongoingGames = queue.filter(g => g.status === 'ongoing');
            const pendingGames = queue.filter(g => g.status === 'pending' || g.status === undefined || g.status === 'queued');
            const completedGames = queue.filter(g => g.status === 'completed');

            const idx = pendingGames.findIndex(g => g.id === gameId);
            if (idx <= 0) return;

            const [match] = pendingGames.splice(idx, 1);
            pendingGames.unshift(match);

            this._gameState.gameQueue = [...ongoingGames, ...pendingGames, ...completedGames];
            await this._save();
            this._ui.showStatus('Match moved to play next', 'success');
        } finally { this._asyncBusy = false; }
    }

    async removeFromQueue(gameId) {
        if (!confirm('Remove this match from the queue?')) return;
        const removed = (this._gameState.gameQueue || []).find(g => g.id === gameId);
        const removedSnapshot = removed ? JSON.parse(JSON.stringify(removed)) : null;
        this._gameState.gameQueue = (this._gameState.gameQueue || []).filter(g => g.id !== gameId);
        await this._save();
        this._logAction('match_removed', 'match', {
            matchId: gameId, matchNumber: removed?.matchNumber,
            game: removed?.game
        }, { removedEntry: removedSnapshot });
        this._ui.showStatus('Match removed from queue', 'success');
    }

    // ------------------------------------------------------------------
    // Clear queue
    // ------------------------------------------------------------------

    openClearQueueModal() {
        if (!this._gameState?.gameQueue) {
            this._ui.showStatus('No matches in queue to clear', 'warning');
            return;
        }

        const allGames = (this._gameState.gameQueue || []).filter(g => g.status !== 'completed');
        if (allGames.length === 0) {
            this._ui.showStatus('No matches in queue to clear', 'warning');
            return;
        }

        const ongoingCount = allGames.filter(g => g.status === 'ongoing').length;
        const pendingCount = allGames.filter(g => g.status !== 'ongoing').length;

        const previewContainer = document.getElementById('clearQueuePreview');
        if (previewContainer) {
            previewContainer.innerHTML = `
                <p><strong>${allGames.length}</strong> match${allGames.length !== 1 ? 'es' : ''} will be removed:</p>
                <ul style="margin: 8px 0; padding-left: 20px; color: var(--text-secondary);">
                    ${ongoingCount > 0 ? `<li>${ongoingCount} ongoing match${ongoingCount !== 1 ? 'es' : ''}</li>` : ''}
                    ${pendingCount > 0 ? `<li>${pendingCount} pending match${pendingCount !== 1 ? 'es' : ''}</li>` : ''}
                </ul>`;
        }

        document.getElementById('clearQueueModal')?.classList.add('active');
    }

    closeClearQueueModal() {
        document.getElementById('clearQueueModal')?.classList.remove('active');
    }

    async confirmClearQueue(triggerBtn) {
        this.closeClearQueueModal();

        const removedCount = (this._gameState.gameQueue || []).filter(g => g.status !== 'completed').length;
        this._gameState.gameQueue = (this._gameState.gameQueue || []).filter(g => g.status === 'completed');

        await this._save(triggerBtn);

        this._logEvent('queue_cleared', {
            matchesRemoved: removedCount,
            message: `Cleared ${removedCount} matches from queue`
        });
        this._logAction('queue_cleared', 'admin', { removedCount }, { removedCount });

        this._ui.showStatus(`Cleared ${removedCount} match${removedCount !== 1 ? 'es' : ''} from queue`, 'success');
    }

    // ------------------------------------------------------------------
    // Break management
    // ------------------------------------------------------------------

    toggleBreakMenu() {
        const menu = document.getElementById('breakMenu');
        if (!menu) return;

        if (this._breakMenuCloseHandler) {
            document.removeEventListener('click', this._breakMenuCloseHandler);
            this._breakMenuCloseHandler = null;
        }

        menu.classList.toggle('active');

        if (menu.classList.contains('active')) {
            this._breakMenuCloseHandler = (e) => {
                if (!e.target.closest('.break-dropdown')) {
                    menu.classList.remove('active');
                    document.removeEventListener('click', this._breakMenuCloseHandler);
                    this._breakMenuCloseHandler = null;
                }
            };
            setTimeout(() => document.addEventListener('click', this._breakMenuCloseHandler), 0);
        }
    }

    async addBreakToQueue(breakType) {
        const def = BREAK_TYPES[breakType];
        if (!def) return;

        document.getElementById('breakMenu')?.classList.remove('active');

        const breakEntry = {
            id: Date.now(),
            isBreak: true,
            breakType,
            breakLabel: def.label,
            breakEmoji: def.emoji,
            status: 'pending',
            teams: [],
            createdAt: new Date().toISOString()
        };

        this._gameState.gameQueue = this._gameState.gameQueue || [];

        const queue = this._gameState.gameQueue;
        const firstPendingIndex = queue.findIndex(g =>
            g.status === 'pending' || g.status === undefined || g.status === 'queued'
        );
        if (firstPendingIndex === -1) {
            queue.push(breakEntry);
        } else {
            queue.splice(firstPendingIndex, 0, breakEntry);
        }

        await this._save();
        this._logAction('break_started', 'phase', { breakType, breakLabel: def.label, breakId: breakEntry.id }, { breakId: breakEntry.id });
        this._ui.showStatus(`${def.label} added \u2014 playing next`, 'success');
    }

    async completeBreak(breakId) {
        if (this._asyncBusy) return;
        this._asyncBusy = true;
        try {
            const breakEntry = (this._gameState?.gameQueue || []).find(g => g.id === breakId && g.isBreak);
            if (!breakEntry) {
                this._ui.showStatus('Break not found', 'error');
                return;
            }

            breakEntry.status = 'completed';
            breakEntry.completedAt = new Date().toISOString();
            await this._save();

            this._logEvent('break_completed', {
                breakType: breakEntry.breakType,
                breakLabel: breakEntry.breakLabel,
                message: `${breakEntry.breakLabel} completed`
            });
            this._logAction('break_ended', 'phase', {
                breakType: breakEntry.breakType, breakLabel: breakEntry.breakLabel,
                breakId: breakEntry.id
            }, { breakId: breakEntry.id, status: 'ongoing' });

            this._ui.showStatus(`${breakEntry.breakLabel} completed!`, 'success');
            this._closeResultConfirm();
        } finally { this._asyncBusy = false; }
    }

    // ------------------------------------------------------------------
    // Private rendering helpers
    // ------------------------------------------------------------------

    _renderBreakItem(game, isOngoing) {
        const breakDef = BREAK_TYPES[game.breakType] || { label: game.breakLabel || 'Break', emoji: ICON_SVGS.pause };
        return `
            <div class="queue-item ${isOngoing ? 'ongoing' : ''} break"
                 draggable="${!isOngoing}"
                 data-queue-id="${game.id}"
                 onclick="openQuickConfirm(${game.id})"
                 ondragstart="dragQueueItem(event, ${game.id})"
                 ondragover="allowQueueDrop(event)"
                 ondragleave="leaveQueueDrop(event)"
                 ondrop="dropQueueItem(event, ${game.id})"
                 ondragend="endQueueDrag(event)">
                <span class="drag-handle">${isOngoing ? ICON_SVGS.play : ICON_SVGS.menu}</span>
                <div class="game-info">
                    <div class="game-type-row">
                        <div class="game-type"><span class="break-badge">BREAK</span>${breakDef.emoji} ${breakDef.label}</div>
                        <div class="match-actions">
                            ${!isOngoing ? `<button class="start-btn" onclick="event.stopPropagation(); startMatch(${game.id})" title="Start break">${ICON_SVGS.play}</button>` : ''}
                            ${!isOngoing ? `<button class="move-top-btn" onclick="event.stopPropagation(); moveMatchToTop(${game.id})" title="Play next">${ICON_SVGS.arrowUpToLine}</button>` : ''}
                            <button class="delete-btn" onclick="event.stopPropagation(); removeFromQueue(${game.id})" title="Remove">${ICON_SVGS.x}</button>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    _renderMatchItem(game, isOngoing) {
        const teams = game.teams || game.sides || [];

        const matchupHtml = teams.map((team, tIdx) => {
            const players = this._teams.getMatchTeamPlayers(team);
            const playersHtml = players.map(p => {
                const name = p.name || 'Unknown';
                const color = p.teamColor || p.originalTeamColor || this._teams.getTeamColor(p.teamId || p.originalTeamId) || '#666';
                const teamName = p.teamName || p.originalTeamName || '';
                return `<span class="queue-player" style="--player-color: ${color}" title="${teamName}">${name}</span>`;
            }).join('');

            const teamBox = `<div class="queue-team">${playersHtml}</div>`;
            const vs = tIdx < teams.length - 1 ? '<span class="queue-vs">VS</span>' : '';
            return teamBox + vs;
        }).join('');

        let fallbackMatchup = '';
        if (teams.length === 0 && game.teamA && game.teamB) {
            fallbackMatchup = `${game.teamA.name || game.teamA} vs ${game.teamB.name || game.teamB}`;
        }

        const gameName = this._teams.getGameDisplayName(game.game || game.gameType || 'Unknown');
        const playType = game.playType || game.format || '';
        const isChallenge = game.isChallenge === true;
        const matchNumber = game.matchNumber ? `#${game.matchNumber} ` : '';
        const challengeBadge = isChallenge ? '<span class="challenge-badge">CHALLENGE</span>' : '';

        return `
            <div class="queue-item ${isOngoing ? 'ongoing' : ''} ${isChallenge ? 'challenge' : ''}"
                 draggable="${!isOngoing}"
                 data-queue-id="${game.id}"
                 onclick="openQuickConfirm(${game.id})"
                 ondragstart="dragQueueItem(event, ${game.id})"
                 ondragover="allowQueueDrop(event)"
                 ondragleave="leaveQueueDrop(event)"
                 ondrop="dropQueueItem(event, ${game.id})"
                 ondragend="endQueueDrag(event)">
                <span class="drag-handle">${isOngoing ? ICON_SVGS.play : ICON_SVGS.menu}</span>
                <div class="game-info">
                    <div class="game-type-row">
                        <div class="game-type">${challengeBadge}${matchNumber}${gameName}${playType ? ' (' + playType + ')' : ''}</div>
                        <div class="match-actions">
                            ${!isOngoing ? `<button class="start-btn" onclick="event.stopPropagation(); startMatch(${game.id})" title="Start match">${ICON_SVGS.play}</button>` : ''}
                            ${!isOngoing ? `<button class="edit-btn" onclick="event.stopPropagation(); openEditMatchModal(${game.id})" title="Edit match">${ICON_SVGS.settings}</button>` : ''}
                            ${!isOngoing ? `<button class="move-top-btn" onclick="event.stopPropagation(); moveMatchToTop(${game.id})" title="Play next">${ICON_SVGS.arrowUpToLine}</button>` : ''}
                            <button class="delete-btn" onclick="event.stopPropagation(); removeFromQueue(${game.id})" title="Remove">${ICON_SVGS.x}</button>
                        </div>
                    </div>
                    <div class="matchup-players">${matchupHtml || fallbackMatchup || 'TBD'}</div>
                </div>
            </div>`;
    }
    // ------------------------------------------------------------------
    // Match History (completed matches display)
    // ------------------------------------------------------------------

    renderMatchHistory(containerId = 'allMatchesList') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const queue = this._gameState?.gameQueue || [];
        const history = this._gameState?.gameHistory || [];

        // Combine completed queue entries and history entries
        const completedQueue = queue.filter(g => g.status === 'completed');

        // Build unified list: queue completed + history (deduplicated by matchNumber)
        const seenMatchNumbers = new Set();
        const allMatches = [];

        // Queue completed entries first (they have full team data)
        completedQueue.forEach(m => {
            if (m.matchNumber) seenMatchNumbers.add(m.matchNumber);
            allMatches.push({ source: 'queue', data: m });
        });

        // Add history entries not already represented
        history.forEach(h => {
            if (h.matchNumber && seenMatchNumbers.has(h.matchNumber)) return;
            allMatches.push({ source: 'history', data: h });
        });

        // Also add ongoing and pending for full view
        const ongoing = queue.filter(g => g.status === 'ongoing' && !g.isBreak);
        const pending = queue.filter(g =>
            (g.status === 'pending' || g.status === undefined || g.status === 'queued') && !g.isBreak
        );

        ongoing.forEach(m => allMatches.push({ source: 'ongoing', data: m }));
        pending.forEach(m => allMatches.push({ source: 'pending', data: m }));

        // Sort: most recent first (by matchNumber descending)
        allMatches.sort((a, b) => (b.data.matchNumber || 0) - (a.data.matchNumber || 0));

        // Apply filters
        const statusFilter = document.getElementById('allMatchesStatusFilter')?.value || 'all';
        const searchText = (document.getElementById('allMatchesSearch')?.value || '').toLowerCase().trim();

        const filtered = allMatches.filter(entry => {
            const m = entry.data;
            const status = entry.source === 'queue' ? 'completed' : entry.source;

            // Status filter
            if (statusFilter !== 'all' && status !== statusFilter) return false;

            // Search filter
            if (searchText) {
                const matchNum = String(m.matchNumber || '');
                const gameName = (m.game || m.gameType || m.gameName || '').toLowerCase();
                const teams = (m.teams || []);
                const playerNames = teams.flatMap(t =>
                    (t.players || t.playerIds || []).map(p => (typeof p === 'string' ? p : p.name || '').toLowerCase())
                ).join(' ');
                const winner = (m.winnerLabel || m.winningSide || '').toLowerCase();
                const searchable = `${matchNum} ${gameName} ${playerNames} ${winner}`;
                if (!searchable.includes(searchText)) return false;
            }

            return true;
        });

        if (filtered.length === 0) {
            container.innerHTML = '<p class="queue-empty">No matches found</p>';
            return;
        }

        container.innerHTML = filtered.map(entry => {
            const m = entry.data;
            const status = entry.source === 'queue' ? 'completed' : entry.source;
            return this._renderHistoryItem(m, status);
        }).join('');
    }

    _renderHistoryItem(match, status) {
        const teams = match.teams || match.sides || [];
        const gameName = this._teams.getGameDisplayName(match.game || match.gameType || 'Unknown');
        const matchNumber = match.matchNumber ? `#${match.matchNumber}` : '';
        const isChallenge = match.isChallenge === true;
        const isCorrected = match.corrected === true;
        const playType = match.playType || match.format || '';

        // Status badge
        let statusBadge = '';
        let statusClass = status;
        if (status === 'completed') {
            const winnerLabel = match.winningSide || match.winnerLabel || '';
            statusBadge = `<span class="history-status completed">${winnerLabel ? winnerLabel + ' Won' : 'Completed'}</span>`;
        } else if (status === 'ongoing') {
            statusBadge = '<span class="history-status ongoing">In Progress</span>';
        } else if (status === 'pending') {
            statusBadge = '<span class="history-status pending">Queued</span>';
        } else if (status === 'history') {
            const winnerLabel = match.winningSide || match.winnerLabel || '';
            statusBadge = `<span class="history-status completed">${winnerLabel ? winnerLabel + ' Won' : 'Completed'}</span>`;
            statusClass = 'completed';
        }

        // Challenge and corrected badges
        const challengeBadge = isChallenge ? '<span class="challenge-badge">CHALLENGE</span>' : '';
        const correctedBadge = isCorrected ? '<span class="history-corrected-badge">CORRECTED</span>' : '';

        // Players display
        const matchupHtml = teams.map((team, tIdx) => {
            const players = this._teams.getMatchTeamPlayers(team);
            const playersHtml = players.map(p => {
                const name = p.name || 'Unknown';
                const color = p.teamColor || p.originalTeamColor || this._teams.getTeamColor(p.teamId || p.originalTeamId) || '#666';
                return `<span class="queue-player" style="--player-color: ${color}">${name}</span>`;
            }).join('');
            const vs = tIdx < teams.length - 1 ? '<span class="queue-vs">VS</span>' : '';
            return `<div class="queue-team">${playersHtml}</div>${vs}`;
        }).join('');

        // Action buttons
        let actionsHtml = '';
        if (statusClass === 'completed') {
            actionsHtml = `
                <button class="btn-small secondary" onclick="event.stopPropagation(); openCorrectResultModal(${match.id})" title="Correct result">Correct</button>
                <button class="btn-small secondary" onclick="event.stopPropagation(); openEditMatchModal(${match.id})" title="Edit details">Edit</button>
            `;
        } else if (statusClass === 'ongoing') {
            actionsHtml = `
                <button class="btn-small primary" onclick="event.stopPropagation(); openQuickConfirm(${match.id})" title="Confirm result">Result</button>
            `;
        }

        return `
            <div class="history-item ${statusClass} ${isChallenge ? 'challenge' : ''} ${isCorrected ? 'corrected' : ''}">
                <div class="history-item-header">
                    <div class="history-item-title">
                        ${challengeBadge}${correctedBadge}
                        <span class="history-match-num">${matchNumber}</span>
                        <span class="history-game-name">${gameName}${playType ? ' (' + playType + ')' : ''}</span>
                    </div>
                    <div class="history-item-meta">
                        ${statusBadge}
                        <span class="history-item-actions">${actionsHtml}</span>
                    </div>
                </div>
                <div class="matchup-players">${matchupHtml || 'TBD'}</div>
            </div>`;
    }
}

window.MatchQueueManager = MatchQueueManager;
