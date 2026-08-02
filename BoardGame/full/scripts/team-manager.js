/**
 * TeamManager
 *
 * Owns team/player CRUD, team rendering, colors, seating order,
 * and the player-name resolution utilities used by other modules.
 */
class TeamManager {

    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {UIManager} deps.uiManager
     * @param {Function} deps.saveCallback  - () => Promise<void>
     * @param {Function} [deps.logActionCallback] - (actionType, category, payload, previousState) => void
     * @param {Function} [deps.onDisplayRefresh] - Called after changes that affect other panels
     */
    constructor(gameState, { uiManager, saveCallback, logActionCallback, onDisplayRefresh }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._onDisplayRefresh = onDisplayRefresh || (() => {});
        this._seatingDragAbort = null;
    }

    // ------------------------------------------------------------------
    // Utility — shared across modules
    // ------------------------------------------------------------------

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    getTeamColor(teamId) {
        if (teamId == null) return '#666666';

        if (this._gameState?.teams) {
            const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
            if (team?.color) return team.color;
        }

        const fallback = { 1: '#de392c', 2: '#2278a3', 3: '#2e9158', 4: '#f7ba32', 5: '#22241d' };
        return fallback[teamId] || '#666666';
    }

    /**
     * Resolve game display name through the standard fallback chain.
     */
    getGameDisplayName(gameId) {
        if (this._gameState?.gameDefinitions && this._gameState.gameDefinitions[gameId]) {
            return this._gameState.gameDefinitions[gameId].name;
        }
        if (typeof GAMES_CONFIG !== 'undefined') {
            return GAMES_CONFIG.getGameName(gameId);
        }
        return gameId;
    }

    /**
     * Get players from a match team, supporting both old and new data formats.
     * @param {Object} matchTeam - A team entry from a queue item
     * @returns {Object[]} Normalized player objects
     */
    getMatchTeamPlayers(matchTeam) {
        if (!matchTeam) return [];

        // New format: playerIds
        if (matchTeam.playerIds && Array.isArray(matchTeam.playerIds)) {
            return matchTeam.playerIds.map(playerId => {
                if (window.PlayerUtils) {
                    const info = window.PlayerUtils.getPlayerDisplayInfo(this._gameState, playerId);
                    return {
                        id: playerId,
                        name: info.name,
                        teamId: info.teamId,
                        originalTeamId: info.teamId,
                        teamColor: info.teamColor,
                        originalTeamColor: info.teamColor,
                        teamName: info.teamName,
                        originalTeamName: info.teamName
                    };
                }
                const player = this._gameState?.players?.[playerId];
                const team = player
                    ? this._gameState?.teams?.find(t => t.id === player.teamId)
                    : null;
                return {
                    id: playerId,
                    name: player?.name || 'Unknown',
                    teamId: player?.teamId,
                    originalTeamId: player?.teamId,
                    teamColor: team?.color || '#666666',
                    originalTeamColor: team?.color || '#666666',
                    teamName: team?.name,
                    originalTeamName: team?.name
                };
            });
        }

        // Old format: players array
        if (matchTeam.players && Array.isArray(matchTeam.players)) {
            return matchTeam.players.map(p => {
                let currentName = p.name;
                const teamId = p.originalTeamId || p.teamId;
                if (p.id && teamId && this._gameState?.teams) {
                    const team = this._gameState.teams.find(t => t.id === teamId);
                    if (team?.players) {
                        const rosterPlayer = team.players.find(tp => tp.id === p.id);
                        if (rosterPlayer?.name) currentName = rosterPlayer.name;
                    }
                }
                return {
                    id: p.id || null,
                    name: currentName,
                    teamId: teamId,
                    originalTeamId: teamId,
                    teamColor: p.originalTeamColor || p.teamColor,
                    originalTeamColor: p.originalTeamColor || p.teamColor,
                    teamName: p.originalTeamName || p.teamName,
                    originalTeamName: p.originalTeamName || p.teamName
                };
            });
        }

        return [];
    }

    /**
     * Look up a player's current name from team roster by ID.
     */
    getPlayerCurrentName(player) {
        if (!player) return 'Unknown';
        const teamId = player.originalTeamId || player.teamId;
        if (player.id && teamId && this._gameState?.teams) {
            const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
            if (team?.players) {
                const current = team.players.find(p => p.id === player.id);
                if (current?.name) return current.name;
            }
        }
        return player.name || 'Unknown';
    }

    // ------------------------------------------------------------------
    // Team list rendering
    // ------------------------------------------------------------------

    renderTeamsList(containerId = 'teamsList') {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!this._gameState?.teams || this._gameState.teams.length === 0) {
            container.innerHTML = '<p class="queue-empty">No teams found</p>';
            return;
        }

        container.innerHTML = this._gameState.teams.map(team => {
            const teamColor = team.color || this.getTeamColor(team.id);
            const players = team.players || [];

            const playerItems = players.map((p, idx) => `
                <div class="player-item"
                     draggable="true"
                     ondragstart="dragPlayer(event, ${team.id}, ${idx})"
                     ondragend="dragEnd(event)">
                    <span class="player-drag-handle">\u22ee\u22ee</span>
                    <span class="player-name">${this.escapeHtml(p.name)}</span>
                </div>
            `).join('');

            const splitCount = team.splitCount || 0;
            const challengeSplitCount = team.challengeSplitCount || 0;

            return `
                <div class="team-card" style="--team-color: ${teamColor}">
                    <div class="team-header"
                         draggable="true"
                         ondragstart="dragTeam(event, ${team.id})"
                         ondragend="dragEnd(event)"
                         title="Drag to add entire team">
                        <span class="team-name" style="color: ${teamColor}">${team.name || 'Team ' + team.id}</span>
                        <span class="team-wins">${team.gamesWon || 0} wins</span>
                    </div>
                    <div class="team-points-row">
                        <label>Points:</label>
                        <button class="btn secondary points-btn" onclick="adjustTeamPoints(${team.id}, -1, event)">-</button>
                        <input type="number" class="points-input" value="${team.points || 0}"
                               onchange="setTeamPoints(${team.id}, this.value)"
                               onclick="event.stopPropagation()">
                        <button class="btn secondary points-btn" onclick="adjustTeamPoints(${team.id}, 1, event)">+</button>
                    </div>
                    <div class="team-split-count">
                        <span title="Times this team has been split in matches"><span class="split-label">Split:</span> <span class="split-value">${splitCount}</span></span>
                        <span class="split-separator">|</span>
                        <span title="Times this team has been involved in challenges"><span class="challenge-split-label">Challenge:</span> <span class="challenge-split-value">${challengeSplitCount}</span></span>
                    </div>
                    <div class="team-players-list">${playerItems}</div>
                </div>
            `;
        }).join('');
    }

    // ------------------------------------------------------------------
    // Team colors
    // ------------------------------------------------------------------

    applyTeamColors() {
        if (!this._gameState?.teams) return;

        const root = document.documentElement;
        this._gameState.teams.forEach(team => {
            if (team.color) {
                root.style.setProperty(`--team-${team.id}-color`, team.color);
                const hex = team.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                root.style.setProperty(`--team-${team.id}-alpha`, `rgba(${r}, ${g}, ${b}, 1)`);
            }
        });
    }

    // ------------------------------------------------------------------
    // Points
    // ------------------------------------------------------------------

    async adjustTeamPoints(teamId, delta, e) {
        if (e) e.stopPropagation();
        if (!this._gameState?.teams) return;

        const team = this._gameState.teams.find(t => t.id === teamId);
        if (team) {
            const oldPoints = team.points || 0;
            team.points = Math.max(0, oldPoints + delta);
            await this._save();
            this._logAction('points_awarded', 'points', {
                teamId, teamName: team.name, amount: delta, reason: 'manual_adjust'
            }, { points: oldPoints });
            this.renderTeamsList();
        }
    }

    async setTeamPoints(teamId, value) {
        if (!this._gameState?.teams) return;

        const team = this._gameState.teams.find(t => t.id === teamId);
        if (team) {
            const oldPoints = team.points || 0;
            const newPoints = Math.max(0, parseInt(value) || 0);
            team.points = newPoints;
            await this._save();
            this._logAction('points_corrected', 'points', {
                teamId, teamName: team.name, oldPoints, newPoints
            }, { points: oldPoints });
        }
    }

    // ------------------------------------------------------------------
    // Player manager modal
    // ------------------------------------------------------------------

    openPlayerManager() {
        if (!this._gameState?.teams) {
            this._ui.showStatus('Load a tournament first', 'warning');
            return;
        }
        this.renderPlayerManager();
        document.getElementById('playerManagerModal').classList.add('active');
    }

    closePlayerManager() {
        document.getElementById('playerManagerModal').classList.remove('active');
    }

    renderPlayerManager() {
        const container = document.getElementById('playerManagerTeams');
        if (!container) return;

        if (!this._gameState?.teams || this._gameState.teams.length === 0) {
            container.innerHTML = '<p class="queue-empty">No teams in this tournament</p>';
            return;
        }

        const MAX_PLAYERS_PER_TEAM = 2;

        container.innerHTML = this._gameState.teams.map(team => {
            const teamColor = team.color || this.getTeamColor(team.id);
            const players = team.players || [];
            const canAddMore = players.length < MAX_PLAYERS_PER_TEAM;

            const playersList = players.map((player, idx) => {
                const isLinked = !!player.uid;
                const swapHint = isLinked
                    ? `<button class="btn-link" title="Swap this linked player for someone else (Users tab)"
                               onclick="closePlayerManager(); window.switchGodTab && window.switchGodTab('users')"
                               style="background:none;border:none;color:var(--text-tertiary);font-size:0.7rem;cursor:pointer;text-decoration:underline;">
                          Swap
                      </button>`
                    : '';
                return `
                <div class="pm-player">
                    <div class="pm-player-info" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                        <input type="text" value="${this.escapeHtml(player.name || '')}"
                               onchange="updatePlayerName(${team.id}, ${idx}, this.value)"
                               placeholder="Player name">
                        <span class="pm-player-badge" style="font-size:0.7rem;color:${isLinked ? '#10b981' : '#f59e0b'};">
                            ${isLinked ? '\u25cf Linked' : '\u25cb Placeholder'}
                        </span>
                    </div>
                    ${swapHint}
                    <button class="btn-remove" onclick="removePlayerFromTeam(${team.id}, ${idx})" title="Delete this slot">\u2715</button>
                </div>
            `;
            }).join('');

            const addPlayerSection = canAddMore ? `
                <div class="pm-add-player">
                    <input type="text" id="newPlayer-${team.id}" placeholder="New player name..."
                           onkeypress="if(event.key === 'Enter') addPlayerToTeam(${team.id})">
                    <button class="btn secondary" onclick="addPlayerToTeam(${team.id})">Add</button>
                </div>
            ` : '';

            return `
                <div class="pm-team" style="--team-color: ${teamColor}">
                    <div class="pm-team-header">
                        <input type="text" class="pm-team-name" value="${team.name || 'Team ' + team.id}"
                               onchange="updateTeamName(${team.id}, this.value)"
                               style="color: ${teamColor}">
                        <span class="team-wins">${players.length}/${MAX_PLAYERS_PER_TEAM} players</span>
                    </div>
                    <div class="pm-team-color">
                        <label style="font-size: 0.75rem; color: var(--text-tertiary);">Team Color:</label>
                        <input type="color" value="${teamColor}"
                               onchange="updateTeamColor(${team.id}, this.value)"
                               style="width: 40px; height: 28px; cursor: pointer; border: none; background: none;">
                        <span style="font-size: 0.7rem; color: var(--text-tertiary); font-family: monospace;">${teamColor}</span>
                    </div>
                    <div class="pm-players-list">
                        ${playersList || '<p class="queue-empty" style="padding: 8px;">No players yet</p>'}
                    </div>
                    ${addPlayerSection}
                </div>
            `;
        }).join('');
    }

    async addPlayerToTeam(teamId) {
        const input = document.getElementById(`newPlayer-${teamId}`);
        const playerName = input.value.trim();

        if (!playerName) {
            this._ui.showStatus('Enter a player name', 'warning');
            return;
        }

        const team = this._gameState.teams.find(t => t.id === teamId);
        if (!team) return;

        let playerId;
        if (window.PlayerUtils) {
            playerId = window.PlayerUtils.addPlayerToTeam(this._gameState, teamId, { name: playerName });
        } else {
            playerId = `p_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
            this._gameState.players = this._gameState.players || {};
            this._gameState.players[playerId] = {
                id: playerId,
                name: playerName,
                teamId: teamId,
                createdAt: new Date().toISOString()
            };
            team.playerIds = team.playerIds || [];
            team.playerIds.push(playerId);
        }

        // Maintain legacy players array
        team.players = team.players || [];
        team.players.push({ id: playerId, name: playerName });

        await this._save();
        this._logAction('player_added', 'admin', {
            teamId, teamName: team.name, playerName, playerId
        }, { playerId, teamId });
        input.value = '';
        this.renderPlayerManager();
        this.renderTeamsList();
        this._ui.showStatus(`Added ${playerName} to ${team.name}`, 'success');
    }

    async removePlayerFromTeam(teamId, playerIndex) {
        const team = this._gameState.teams.find(t => t.id === teamId);
        if (!team?.players) return;

        const player = team.players[playerIndex];
        const playerName = player?.name || 'Player';
        const playerId = player?.id;
        const isLinked = !!player?.uid;

        const confirmMsg = isLinked
            ? `Delete "${playerName}"'s slot from ${team.name}? This permanently removes their match history attribution and cannot be undone — if you're replacing this player, use Swap instead.`
            : `Delete this empty slot from ${team.name}? This cannot be undone.`;
        if (!confirm(confirmMsg)) return;

        if (playerId && window.PlayerUtils) {
            window.PlayerUtils.deletePlayerSlot(this._gameState, teamId, playerId);
        } else {
            team.players.splice(playerIndex, 1);
            if (playerId && team.playerIds) {
                team.playerIds = team.playerIds.filter(id => id !== playerId);
            }
        }

        // Linked players need their Firestore user doc unhooked too, or a
        // stale assignedTeamId strands them on a team they've been removed
        // from (home.html's banner and team-controls.js's bootstrap both
        // trust that field directly, with no roster check).
        if (isLinked && window.firebaseDB) {
            try {
                if (!team.formerPlayers) team.formerPlayers = [];
                team.formerPlayers.push({
                    uid: player.uid, playerId, name: playerName,
                    leftAt: new Date().toISOString(), pointsWhenLeft: team.points || 0
                });
                // Only clear if their account still points at this exact
                // slot — they may have since been linked into a different
                // tournament, whose assignment must not get wiped out here.
                const userRef = window.firebaseDB.collection('users').doc(player.uid);
                const userSnap = await userRef.get();
                if (window.UserAssignment.shouldClearUserAssignment(userSnap.data(), { tournamentId: this._gameState.tournamentId, playerId })) {
                    await userRef.update({
                        assignedTournamentId: null, assignedTeamId: null, assignedTeamName: null,
                        assignedPlayerId: null, isPlayer: false,
                        unassignedAt: new Date().toISOString(),
                        unassignedBy: firebase.auth().currentUser?.uid || 'admin'
                    });
                }
            } catch (error) {
                console.error('[TeamManager] Failed to clear removed player\'s user doc:', error);
            }
        }

        await this._save();
        this._logAction('player_removed', 'admin', {
            teamId, teamName: team.name, playerName, playerId, wasLinked: isLinked
        }, { player });
        this.renderPlayerManager();
        this.renderTeamsList();
        this._ui.showStatus(`Removed ${playerName}`, 'success');
    }

    async updatePlayerName(teamId, playerIndex, newName) {
        const team = this._gameState.teams.find(t => t.id === teamId);
        if (!team?.players?.[playerIndex]) return;

        const trimmedName = newName.trim();
        const oldName = team.players[playerIndex].name;
        const playerId = team.players[playerIndex].id;

        team.players[playerIndex].name = trimmedName;

        if (playerId && this._gameState.players?.[playerId]) {
            this._gameState.players[playerId].name = trimmedName;
        }

        await this._save();
        this._logAction('player_renamed', 'admin', {
            teamId, teamName: team.name, oldName, newName: trimmedName, playerId
        }, { playerName: oldName });
        this._onDisplayRefresh();
    }

    async updateTeamName(teamId, newName) {
        const team = this._gameState.teams.find(t => t.id === teamId);
        if (!team) return;

        const trimmed = newName.trim();
        if (!trimmed || trimmed === team.name) return;

        const oldName = team.name;

        // Name history
        if (!team.nameHistory) team.nameHistory = [];
        team.nameHistory.push({
            oldName,
            newName: trimmed,
            changedAt: new Date().toISOString(),
            changedBy: firebase.auth().currentUser?.uid || 'unknown'
        });

        team.name = trimmed;
        await this._save();
        this._logAction('team_renamed', 'admin', {
            teamId, oldName, newName: trimmed
        }, { name: oldName });

        // Update user docs with new team name
        this._updatePlayerTeamNames(team);

        this.renderTeamsList();
        this.renderPlayerManager();
    }

    /**
     * Update assignedTeamName on user docs for all players in a team
     */
    async _updatePlayerTeamNames(team) {
        try {
            const db = window.firebaseDB;
            if (!db || !team.players) return;
            const batch = db.batch();
            let hasBatchOps = false;
            for (const player of team.players) {
                if (player.uid) {
                    batch.update(db.collection('users').doc(player.uid), {
                        assignedTeamName: team.name
                    });
                    hasBatchOps = true;
                }
            }
            if (hasBatchOps) await batch.commit();
        } catch (e) {
            console.warn('[TeamManager] Failed to update user docs with new team name:', e);
        }
    }

    async updateTeamColor(teamId, newColor) {
        const team = this._gameState.teams.find(t => t.id === teamId);
        if (!team) return;

        const oldColor = team.color;
        team.color = newColor;
        await this._save();
        this._logAction('team_color_changed', 'admin', {
            teamId, teamName: team.name, newColor, oldColor
        }, { color: oldColor });

        this.applyTeamColors();
        this.renderTeamsList();
        this.renderPlayerManager();
        this._onDisplayRefresh();

        this._ui.showStatus(`Team color updated to ${newColor}`, 'success');
    }

    // ------------------------------------------------------------------
    // Seating order
    // ------------------------------------------------------------------

    getSeatingOrder() {
        const order = this._gameState?.seatingOrder;
        if (!Array.isArray(order) || order.length !== 10) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        const sorted = [...order].sort((a, b) => a - b);
        const isValid = sorted.every((val, idx) => val === idx + 1);
        if (!isValid) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        return [...order];
    }

    getAllPlayersInOrder() {
        const players = [];
        const teams = this._gameState?.teams || [];
        let playerNum = 1;

        for (const team of teams) {
            for (const player of (team.players || [])) {
                if (playerNum <= 10) {
                    players.push({
                        playerNum,
                        name: player.name || 'Player ' + playerNum,
                        teamId: team.id,
                        teamName: team.name || 'Team ' + team.id,
                        teamColor: team.color || '#666666'
                    });
                    playerNum++;
                }
            }
        }

        while (playerNum <= 10) {
            const teamIndex = Math.floor((playerNum - 1) / 2);
            const team = teams[teamIndex] || {};
            players.push({
                playerNum,
                name: 'Player ' + playerNum,
                teamId: team.id || teamIndex + 1,
                teamName: team.name || 'Team ' + (teamIndex + 1),
                teamColor: team.color || '#666666'
            });
            playerNum++;
        }

        return players;
    }

    openSeatingOrder() {
        if (!this._gameState?.teams) {
            this._ui.showStatus('Load a tournament first', 'warning');
            return;
        }
        this.renderSeatingOrder();
        document.getElementById('seatingOrderModal').classList.add('active');
    }

    closeSeatingOrder() {
        const modal = document.getElementById('seatingOrderModal');
        if (modal) modal.classList.remove('active');
    }

    renderSeatingOrder() {
        const order = this.getSeatingOrder();
        const allPlayers = this.getAllPlayersInOrder();
        const playerLookup = {};
        for (const p of allPlayers) playerLookup[p.playerNum] = p;

        const leftWall = document.getElementById('seatingLeftWall');
        const rightWall = document.getElementById('seatingRightWall');
        if (!leftWall || !rightWall) return;

        let leftHtml = '';
        for (let seat = 1; seat <= 5; seat++) {
            const pNum = order[seat - 1];
            leftHtml += this._buildSeatItemHTML(seat, pNum, playerLookup[pNum]);
        }
        leftWall.innerHTML = leftHtml;

        let rightHtml = '';
        for (let seat = 6; seat <= 10; seat++) {
            const pNum = order[seat - 1];
            rightHtml += this._buildSeatItemHTML(seat, pNum, playerLookup[pNum]);
        }
        rightWall.innerHTML = rightHtml;

        this._setupSeatingDragDrop();
    }

    async swapSeatingPositions(seatA, seatB) {
        const oldOrder = this.getSeatingOrder();
        const order = [...oldOrder];
        const temp = order[seatA - 1];
        order[seatA - 1] = order[seatB - 1];
        order[seatB - 1] = temp;

        this._gameState.seatingOrder = order;
        await this._save();
        this._logAction('seating_changed', 'admin', {
            seatA, seatB
        }, { seatingOrder: oldOrder });
        this.renderSeatingOrder();
    }

    async resetSeatingOrder() {
        const oldOrder = this.getSeatingOrder();
        this._gameState.seatingOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        await this._save();
        this._logAction('seating_reset', 'admin', {}, { seatingOrder: oldOrder });
        this.renderSeatingOrder();
        this._ui.showStatus('Seating order reset to default', 'success');
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    _buildSeatItemHTML(seatNum, playerNum, info) {
        const name = info ? this.escapeHtml(info.name) : 'Player ' + playerNum;
        const color = info ? info.teamColor : '#666666';

        return `<div class="seating-item" draggable="true" data-seat="${seatNum}">
            <span class="seating-drag-handle">&#9776;</span>
            <span class="seating-seat-num">${seatNum}</span>
            <span class="seating-team-dot" style="background: ${color}"></span>
            <span class="seating-player-name">${name}</span>
        </div>`;
    }

    _setupSeatingDragDrop() {
        if (this._seatingDragAbort) this._seatingDragAbort.abort();
        this._seatingDragAbort = new AbortController();
        const signal = this._seatingDragAbort.signal;

        const items = document.querySelectorAll('.seating-item');
        let draggedSeat = null;

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedSeat = parseInt(item.dataset.seat);
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            }, { signal });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedSeat = null;
                items.forEach(el => el.classList.remove('drag-over'));
            }, { signal });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (parseInt(item.dataset.seat) !== draggedSeat) {
                    item.classList.add('drag-over');
                }
            }, { signal });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-over');
            }, { signal });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('drag-over');
                const targetSeat = parseInt(item.dataset.seat);
                if (draggedSeat !== null && draggedSeat !== targetSeat) {
                    this.swapSeatingPositions(draggedSeat, targetSeat);
                }
            }, { signal });
        });
    }
}

window.TeamManager = TeamManager;
