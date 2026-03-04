/**
 * ============================================================================
 * MATCH CREATION MANAGER
 * ============================================================================
 * Owns match creation (drag-drop), challenge matches, mass import,
 * match editing, auto-generation, and game catalog management.
 *
 * Extracted from lightweight/scripts/admin.js into an ES6 class for the
 * full/GodApp architecture.
 * ============================================================================
 */

// Side labels for display (shared with match-queue-manager.js — only declare if not already defined)
if (typeof SIDE_LABELS === 'undefined') {
    var SIDE_LABELS = ['A', 'B', 'C', 'D', 'E'];
}

// 5v5 rotation pattern for reconstructing teams from splitTeamId
const ROTATION_5V5_PATTERN = [
    { splitTeamId: 1, sideA: [2, 3], sideB: [4, 5] },
    { splitTeamId: 3, sideA: [2, 1], sideB: [4, 5] },
    { splitTeamId: 2, sideA: [1, 3], sideB: [4, 5] },
    { splitTeamId: 5, sideA: [1, 4], sideB: [2, 3] },
    { splitTeamId: 4, sideA: [1, 2], sideB: [3, 5] },
    { splitTeamId: 1, sideA: [2, 4], sideB: [3, 5] },
    { splitTeamId: 3, sideA: [2, 4], sideB: [1, 5] },
    { splitTeamId: 2, sideA: [1, 4], sideB: [3, 5] },
    { splitTeamId: 5, sideA: [1, 2], sideB: [4, 3] },
    { splitTeamId: 4, sideA: [1, 3], sideB: [2, 5] }
];

// 3v3+2v2 rotation pattern (for 3v3 and 2v2 matches)
const ROTATION_3V3_2V2_PATTERN = [
    { splitTeamId: 5, match3v3: { sideA: [1, 2], sideB: [3, 4] }, match2v2: { sideA: [5, 1], sideB: [5, 2] } },
    { splitTeamId: 4, match3v3: { sideA: [1, 3], sideB: [2, 5] }, match2v2: { sideA: [4, 1], sideB: [4, 3] } },
    { splitTeamId: 3, match3v3: { sideA: [2, 4], sideB: [1, 5] }, match2v2: { sideA: [3, 2], sideB: [3, 4] } },
    { splitTeamId: 1, match3v3: { sideA: [3, 5], sideB: [2, 4] }, match2v2: { sideA: [1, 3], sideB: [1, 5] } },
    { splitTeamId: 2, match3v3: { sideA: [1, 4], sideB: [3, 5] }, match2v2: { sideA: [2, 1], sideB: [2, 4] } },
    { splitTeamId: 3, match3v3: { sideA: [2, 5], sideB: [1, 4] }, match2v2: { sideA: [3, 2], sideB: [3, 5] } },
    { splitTeamId: 1, match3v3: { sideA: [3, 4], sideB: [2, 5] }, match2v2: { sideA: [1, 3], sideB: [1, 4] } },
    { splitTeamId: 2, match3v3: { sideA: [1, 5], sideB: [3, 4] }, match2v2: { sideA: [2, 1], sideB: [2, 5] } },
    { splitTeamId: 1, match3v3: { sideA: [2, 3], sideB: [4, 5] }, match2v2: { sideA: [1, 2], sideB: [1, 3] } },
    { splitTeamId: 3, match3v3: { sideA: [1, 2], sideB: [4, 5] }, match2v2: { sideA: [3, 1], sideB: [3, 2] } }
];

class MatchCreationManager {
    /**
     * @param {Object} gameState - The shared game state object
     * @param {Object} deps
     * @param {Object} deps.uiManager - UI manager for showStatus, etc.
     * @param {Object} deps.teamManager - Team manager for getMatchTeamPlayers, getTeamColor, etc.
     * @param {Object} deps.queueManager - Queue manager for getNextMatchNumber
     * @param {Function} deps.saveCallback - Save function (triggerBtn) => Promise
     * @param {Function} [deps.logActionCallback] - (actionType, category, payload, previousState) => void
     */
    constructor(gameState, { uiManager, teamManager, queueManager, saveCallback, logActionCallback, onPhaseRequirementsChanged }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._teams = teamManager;
        this._queue = queueManager;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._onPhaseChanged = onPhaseRequirementsChanged || (() => {});

        // Instance state
        this._manualGameSetup = { sides: [[], []] };
        this._pendingAutoMatch = null;
        this._editMatchState = { gameId: null, game: '', sides: [], isChallenge: false };
        this._pendingImportData = null;
    }

    // =========================================================================
    // GAME MANAGER
    // =========================================================================

    openGameManager() {
        if (!this._gameState) {
            this._ui.showStatus('Load a tournament first', 'warning');
            return;
        }

        this.renderGameManagerList();
        this.renderGameCatalog();
        document.getElementById('gameManagerModal').classList.add('active');
    }

    closeGameManager() {
        document.getElementById('gameManagerModal').classList.remove('active');
    }

    switchGameManagerTab(tab) {
        document.getElementById('gmTabCatalog').classList.toggle('active', tab === 'catalog');
        document.getElementById('gmTabCustom').classList.toggle('active', tab === 'custom');
        document.getElementById('gmCatalogTab').style.display = tab === 'catalog' ? '' : 'none';
        document.getElementById('gmCustomTab').style.display = tab === 'custom' ? '' : 'none';
    }

    countMatchesForGame(gameId) {
        if (!this._gameState?.gameQueue) return 0;
        return this._gameState.gameQueue.filter(m =>
            (m.game === gameId || m.gameType === gameId) &&
            (m.status === 'pending' || m.status === 'queued' || m.status === 'ongoing')
        ).length;
    }

    renderGameManagerList() {
        const container = document.getElementById('gmGamesList');
        const selectedGames = this._gameState?.selectedGames || [];

        if (selectedGames.length === 0) {
            container.innerHTML = '<p class="queue-empty">No games in this tournament</p>';
            return;
        }

        container.innerHTML = selectedGames.map(gameId => {
            const name = this._teams.getGameDisplayName(gameId);
            const def = this._gameState?.gameDefinitions?.[gameId] || {};
            const configGame = (typeof GAMES_CONFIG !== 'undefined') ? GAMES_CONFIG.getGame(gameId) : null;
            const format = def.format || configGame?.format || '5v5';
            const icon = def.icon || configGame?.icon || '\u{1F3AE}';
            const image = def.image || configGame?.image || '';
            const resolvedImage = (typeof GAMES_CONFIG !== 'undefined' && image) ? GAMES_CONFIG.resolveImagePath(image) : image;
            const matchCount = this.countMatchesForGame(gameId);

            const imageHtml = image
                ? `<img src="${resolvedImage}" alt="${name}" class="gm-game-icon-img" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
                : '';
            const iconFallback = image
                ? `<span class="gm-game-icon-emoji" style="display:none">${icon}</span>`
                : `<span class="gm-game-icon-emoji">${icon}</span>`;

            return `
                <div class="gm-game-item">
                    <div class="gm-game-icon">${imageHtml}${iconFallback}</div>
                    <div class="gm-game-info">
                        <span class="gm-game-name">${name}</span>
                        <span class="gm-game-meta">${format}${matchCount > 0 ? ` \u00B7 ${matchCount} queued` : ''}</span>
                    </div>
                    <button class="btn-small danger" onclick="removeGameFromTournament('${gameId}')" title="Remove from tournament">Remove</button>
                </div>
            `;
        }).join('');
    }

    renderGameCatalog() {
        const container = document.getElementById('gmCatalogList');
        const selectedGames = this._gameState?.selectedGames || [];

        if (typeof GAMES_CONFIG === 'undefined') {
            container.innerHTML = '<p class="queue-empty">Games catalog not loaded</p>';
            return;
        }

        const allGames = GAMES_CONFIG.getAllGames();
        const available = allGames.filter(g => !selectedGames.includes(g.id));

        if (available.length === 0) {
            container.innerHTML = '<p class="queue-empty">All catalog games are already added</p>';
            return;
        }

        container.innerHTML = available.map(game => {
            const resolvedCatalogImage = game.image ? GAMES_CONFIG.resolveImagePath(game.image) : '';
            const imageHtml = game.image
                ? `<img src="${resolvedCatalogImage}" alt="${game.name}" class="gm-game-icon-img" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
                : '';
            const iconFallback = game.image
                ? `<span class="gm-game-icon-emoji" style="display:none">${game.icon || '\u{1F3AE}'}</span>`
                : `<span class="gm-game-icon-emoji">${game.icon || '\u{1F3AE}'}</span>`;

            return `
                <div class="gm-game-item gm-catalog-item">
                    <div class="gm-game-icon">${imageHtml}${iconFallback}</div>
                    <div class="gm-game-info">
                        <span class="gm-game-name">${game.name}</span>
                        <span class="gm-game-meta">${game.format}</span>
                    </div>
                    <button class="btn-small primary" onclick="addCatalogGameToTournament('${game.id}')">Add</button>
                </div>
            `;
        }).join('');
    }

    async addCatalogGameToTournament(gameId) {
        if (!this._gameState) return;

        const game = GAMES_CONFIG.getGame(gameId);
        if (!game) {
            this._ui.showStatus('Game not found in catalog', 'error');
            return;
        }

        // Check if already added
        if (this._gameState.selectedGames && this._gameState.selectedGames.includes(gameId)) {
            this._ui.showStatus('Game is already in the tournament', 'warning');
            return;
        }

        // Add to selectedGames
        if (!this._gameState.selectedGames) this._gameState.selectedGames = [];
        this._gameState.selectedGames.push(gameId);

        // Add to gameDefinitions
        if (!this._gameState.gameDefinitions) this._gameState.gameDefinitions = {};
        this._gameState.gameDefinitions[gameId] = {
            name: game.name,
            shortName: game.shortName || game.name,
            format: game.format,
            icon: game.icon || '\u{1F3AE}',
            image: game.image || '',
            splitFormat: game.splitFormat || false,
            custom: false
        };

        await this._save();
        this._logAction('game_added', 'admin', { gameId, gameName: game.name }, { gameId });
        this.reinitializeMatchGenerator();
        this.renderGameManagerList();
        this.renderGameCatalog();
        this._ui.showStatus(`Added ${game.name} to tournament`, 'success');
    }

    async addCustomGameToTournament(triggerBtn) {
        if (!this._gameState) return;

        const id = document.getElementById('gmCustomId').value.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
        const name = document.getElementById('gmCustomName').value.trim();
        const shortName = document.getElementById('gmCustomShortName').value.trim() || name;
        const format = document.getElementById('gmCustomFormat').value;
        const icon = document.getElementById('gmCustomIcon').value.trim() || '\u{1F3AE}';
        const image = document.getElementById('gmCustomImage').value.trim();

        if (!id) {
            this._ui.showStatus('Game ID is required', 'error');
            return;
        }
        if (!name) {
            this._ui.showStatus('Game name is required', 'error');
            return;
        }

        // Check for duplicate
        if (this._gameState.selectedGames && this._gameState.selectedGames.includes(id)) {
            this._ui.showStatus('A game with this ID already exists in the tournament', 'warning');
            return;
        }

        // Add to selectedGames
        if (!this._gameState.selectedGames) this._gameState.selectedGames = [];
        this._gameState.selectedGames.push(id);

        // Add to gameDefinitions
        if (!this._gameState.gameDefinitions) this._gameState.gameDefinitions = {};
        this._gameState.gameDefinitions[id] = {
            name,
            shortName,
            format,
            icon,
            image,
            splitFormat: format === '3v3+2v2',
            custom: true
        };

        await this._save(triggerBtn);
        this._logAction('game_added', 'admin', { gameId: id, gameName: name, custom: true }, { gameId: id });
        this.reinitializeMatchGenerator();
        this.renderGameManagerList();
        this.renderGameCatalog();

        // Clear the form
        document.getElementById('gmCustomId').value = '';
        document.getElementById('gmCustomName').value = '';
        document.getElementById('gmCustomShortName').value = '';
        document.getElementById('gmCustomFormat').value = '5v5';
        document.getElementById('gmCustomIcon').value = '';
        document.getElementById('gmCustomImage').value = '';

        this._ui.showStatus(`Added ${name} to tournament`, 'success');
    }

    async removeGameFromTournament(gameId) {
        if (!this._gameState || !this._gameState.selectedGames) return;

        const name = this._teams.getGameDisplayName(gameId);
        const matchCount = this.countMatchesForGame(gameId);

        if (matchCount > 0) {
            if (!confirm(`"${name}" has ${matchCount} queued/ongoing match(es). Remove it anyway?`)) {
                return;
            }
        }

        // Remove from selectedGames
        this._gameState.selectedGames = this._gameState.selectedGames.filter(id => id !== gameId);

        // Keep gameDefinitions entry for historical matches display

        await this._save();
        this._logAction('game_removed', 'admin', { gameId, gameName: name }, { gameId, wasInSelectedGames: true });
        this.reinitializeMatchGenerator();
        this.renderGameManagerList();
        this.renderGameCatalog();
        this._ui.showStatus(`Removed ${name} from tournament`, 'success');
    }

    reinitializeMatchGenerator() {
        if (window.smartMatchGenerator) {
            window.smartMatchGenerator.initializeGameRotation();
        }
    }

    // =========================================================================
    // MATCH CREATION (DRAG-DROP)
    // =========================================================================

    dragTeam(event, teamId) {
        event.stopPropagation();
        event.dataTransfer.setData('application/json', JSON.stringify({
            type: 'team',
            teamId: teamId
        }));
        event.target.classList.add('dragging');
    }

    dragPlayer(event, teamId, playerIndex) {
        event.stopPropagation();
        const team = this._gameState?.teams?.find(t => t.id === teamId);
        if (!team || !team.players || !team.players[playerIndex]) return;

        const player = team.players[playerIndex];
        event.dataTransfer.setData('application/json', JSON.stringify({
            type: 'player',
            teamId: teamId,
            playerIndex: playerIndex,
            player: {
                id: player.id || player.uid,
                name: player.name,
                originalTeamId: teamId,
                originalTeamName: team.name,
                originalTeamColor: team.color || this._teams.getTeamColor(teamId)
            }
        }));
        event.target.classList.add('dragging');
    }

    dragEnd(event) {
        event.target.classList.remove('dragging');
    }

    allowDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.add('drag-over');
    }

    dragLeave(event) {
        event.currentTarget.classList.remove('drag-over');
    }

    dropToSide(event, sideIndex) {
        event.preventDefault();
        event.currentTarget.classList.remove('drag-over');

        try {
            const data = JSON.parse(event.dataTransfer.getData('application/json'));

            if (data.type === 'team') {
                const team = this._gameState?.teams?.find(t => t.id === data.teamId);
                if (!team) return;

                // Check if team is already on this side
                const alreadyOnThisSide = this._manualGameSetup.sides[sideIndex].some(p => p.originalTeamId === team.id);
                if (alreadyOnThisSide) {
                    this._ui.showStatus('Team already on this side', 'warning');
                    return;
                }

                // Add all players from the team
                const players = (team.players || []).map(p => ({
                    id: p.id || p.uid,
                    name: p.name,
                    originalTeamId: team.id,
                    originalTeamName: team.name,
                    originalTeamColor: team.color || this._teams.getTeamColor(team.id)
                }));

                this._manualGameSetup.sides[sideIndex].push(...players);
                this.renderMatchCreationZones();
            } else if (data.type === 'player') {
                // Single player drop
                const player = data.player;
                if (!player) return;

                // Check if player is already on this side
                const alreadyOnSide = this._manualGameSetup.sides[sideIndex].some(
                    p => p.name === player.name && p.originalTeamId === player.originalTeamId
                );

                if (alreadyOnSide) {
                    this._ui.showStatus('Player already on this side', 'warning');
                    return;
                }

                // Remove player from any other side
                this._manualGameSetup.sides.forEach((side, idx) => {
                    if (idx !== sideIndex) {
                        const existingIndex = side.findIndex(
                            p => p.name === player.name && p.originalTeamId === player.originalTeamId
                        );
                        if (existingIndex !== -1) {
                            side.splice(existingIndex, 1);
                        }
                    }
                });

                this._manualGameSetup.sides[sideIndex].push(player);
                this.renderMatchCreationZones();
            }
        } catch (error) {
            console.error('Drop error:', error);
        }
    }

    renderMatchCreationZones() {
        const container = document.getElementById('sidesContainer');
        if (!container) return;

        const escapeHtml = (str) => this._teams.escapeHtml(str);

        // Build HTML for each side
        const sidesHtml = this._manualGameSetup.sides.map((side, idx) => {
            const label = SIDE_LABELS[idx] || (idx + 1);
            const hasPlayers = side.length > 0;

            const playersHtml = side.map((p, playerIdx) => `
                <div class="dropped-player" style="--team-color: ${p.originalTeamColor || 'var(--text-secondary)'}">
                    <span>${escapeHtml(p.name)} (${escapeHtml(p.originalTeamName || 'Unknown')})</span>
                    <button class="remove-btn" onclick="removeFromSide(${idx}, ${playerIdx})">x</button>
                </div>
            `).join('');

            return `
                <div class="drop-zone ${hasPlayers ? 'has-players' : ''}" id="side${idx}Zone"
                     ondrop="dropToSide(event, ${idx})"
                     ondragover="allowDrop(event)"
                     ondragleave="dragLeave(event)">
                    <span class="placeholder">Drop Team/Player ${label}</span>
                    <div class="side-players">${playersHtml}</div>
                </div>
                ${idx < this._manualGameSetup.sides.length - 1 ? '<div class="vs-divider">VS</div>' : ''}
            `;
        }).join('');

        container.innerHTML = sidesHtml;

        // Update auto-calculated format display
        this.updateAutoFormat();
    }

    updateAutoFormat() {
        const formatDisplay = document.getElementById('autoFormat');
        const counts = this._manualGameSetup.sides.map(s => s.length);
        const allEmpty = counts.every(c => c === 0);
        const allEqual = counts.every(c => c === counts[0]);

        if (allEmpty) {
            formatDisplay.textContent = '--';
            formatDisplay.style.color = 'var(--text-tertiary)';
        } else if (!allEqual) {
            // Uneven teams - show warning
            formatDisplay.textContent = counts.join('v');
            formatDisplay.style.color = 'var(--accent-warning, #f7ba32)';
        } else {
            formatDisplay.textContent = counts.join('v');
            formatDisplay.style.color = 'var(--accent-primary)';
        }
    }

    getCalculatedPlayType() {
        return this._manualGameSetup.sides.map(s => s.length).join('v');
    }

    removeFromSide(sideIndex, playerIndex) {
        this._manualGameSetup.sides[sideIndex].splice(playerIndex, 1);
        this.renderMatchCreationZones();
    }

    clearMatchSetup() {
        this._manualGameSetup = { sides: [[], []] }; // Reset to 2 empty sides
        this.renderMatchCreationZones();
    }

    addMatchSide() {
        if (this._manualGameSetup.sides.length >= SIDE_LABELS.length) {
            this._ui.showStatus(`Maximum ${SIDE_LABELS.length} sides allowed`, 'warning');
            return;
        }
        this._manualGameSetup.sides.push([]);
        this.renderMatchCreationZones();
    }

    removeMatchSide() {
        if (this._manualGameSetup.sides.length <= 2) {
            this._ui.showStatus('Minimum 2 sides required', 'warning');
            return;
        }
        this._manualGameSetup.sides.pop();
        this.renderMatchCreationZones();
    }

    async addMatchToQueue(triggerBtn) {
        // Check all sides have at least one player
        const emptySides = this._manualGameSetup.sides.filter(s => s.length === 0);
        if (emptySides.length > 0) {
            this._ui.showStatus('All sides need at least one player', 'warning');
            return;
        }

        const playType = this.getCalculatedPlayType();

        // Build teams array from sides - store player IDs for normalized structure
        const teams = this._manualGameSetup.sides.map((side, idx) => ({
            id: `TEAM_${SIDE_LABELS[idx]}`,
            playerIds: side.map(p => p.id).filter(Boolean)
        }));

        // Get next match number (persistent, doesn't change with reordering)
        const matchNumber = this._queue.getNextMatchNumber();

        const queueEntry = {
            id: Date.now(),
            matchNumber: matchNumber,
            game: document.getElementById('gameType').value,
            playType: playType,
            teams: teams,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        this._gameState.gameQueue = this._gameState.gameQueue || [];
        this._gameState.gameQueue.push(queueEntry);

        await this._save(triggerBtn);
        this._logAction('match_created', 'match', {
            matchId: queueEntry.id, matchNumber, game: queueEntry.game, format: playType,
            sides: teams.map(t => ({ id: t.id, playerIds: t.playerIds }))
        }, { matchId: queueEntry.id });
        this.clearMatchSetup();
        this._ui.showStatus(`Match #${matchNumber} (${playType}) added to queue!`, 'success');
        this._onPhaseChanged();
    }

    // =========================================================================
    // CHALLENGE MATCHES
    // =========================================================================

    addChallengeToQueue() {
        // Check all sides have at least one player
        const emptySides = this._manualGameSetup.sides.filter(s => s.length === 0);
        if (emptySides.length > 0) {
            this._ui.showStatus('All sides need at least one player', 'warning');
            return;
        }

        if (!this._gameState?.teams || this._gameState.teams.length < 2) {
            this._ui.showStatus('Need at least 2 teams for a challenge', 'warning');
            return;
        }

        // Build team options with color indicators (required fields)
        const teamOptionsRequired = this._gameState.teams.map(team => {
            const color = team.color || this._teams.getTeamColor(team.id) || '#666';
            const name = team.name || 'Team ' + team.id;
            return `<option value="${team.id}" data-color="${color}">\u25CF ${name}</option>`;
        }).join('');

        // Optional fields have "None" option
        const teamOptionsOptional = `<option value="" data-color="">\u2014 None \u2014</option>` + teamOptionsRequired;

        // Populate all dropdowns
        document.getElementById('challengeSideA1').innerHTML = teamOptionsRequired;
        document.getElementById('challengeSideA2').innerHTML = teamOptionsOptional;
        document.getElementById('challengeSideB1').innerHTML = teamOptionsRequired;
        document.getElementById('challengeSideB2').innerHTML = teamOptionsOptional;

        // Default: select different teams for Side A and Side B primary disputes
        if (this._gameState.teams.length >= 2) {
            document.getElementById('challengeSideA1').value = this._gameState.teams[0].id;
            document.getElementById('challengeSideB1').value = this._gameState.teams[1].id;
        }

        // Apply color styling to all dropdowns (use onchange to avoid listener accumulation)
        ['challengeSideA1', 'challengeSideA2', 'challengeSideB1', 'challengeSideB2'].forEach(id => {
            const select = document.getElementById(id);
            select.onchange = () => this.updateChallengeSelectColor(id);
            this.updateChallengeSelectColor(id);
        });

        document.getElementById('challengeSetupModal').classList.add('active');
    }

    updateChallengeSelectColor(selectId) {
        const select = document.getElementById(selectId);
        const selectedOption = select.options[select.selectedIndex];
        const color = selectedOption?.dataset?.color || '';

        if (select.value && color) {
            select.style.borderLeft = `4px solid ${color}`;
            select.style.paddingLeft = '8px';
        } else {
            select.style.borderLeft = '1px solid var(--border-color)';
            select.style.paddingLeft = '10px';
        }
    }

    closeChallengeSetupModal() {
        document.getElementById('challengeSetupModal').classList.remove('active');
    }

    async confirmChallengeSetup(triggerBtn) {
        // Get teams from each side
        const sideA1 = document.getElementById('challengeSideA1').value;
        const sideA2 = document.getElementById('challengeSideA2').value;
        const sideB1 = document.getElementById('challengeSideB1').value;
        const sideB2 = document.getElementById('challengeSideB2').value;

        // Build arrays of disputing teams per side
        const sideATeams = [sideA1, sideA2].filter(Boolean).map(id => parseInt(id) || id);
        const sideBTeams = [sideB1, sideB2].filter(Boolean).map(id => parseInt(id) || id);

        // Validate: need at least 1 team per side
        if (sideATeams.length === 0 || sideBTeams.length === 0) {
            this._ui.showStatus('Each side needs at least one team', 'warning');
            return;
        }

        // Validate: no team should appear on both sides
        const overlap = sideATeams.filter(id => sideBTeams.some(bid => String(bid) === String(id)));
        if (overlap.length > 0) {
            this._ui.showStatus('A team cannot be on both sides', 'warning');
            return;
        }

        // Validate: no duplicate teams on same side
        if (sideATeams.length === 2 && String(sideATeams[0]) === String(sideATeams[1])) {
            this._ui.showStatus('Cannot select the same team twice on Side A', 'warning');
            return;
        }
        if (sideBTeams.length === 2 && String(sideBTeams[0]) === String(sideBTeams[1])) {
            this._ui.showStatus('Cannot select the same team twice on Side B', 'warning');
            return;
        }

        this.closeChallengeSetupModal();

        const playType = this.getCalculatedPlayType();

        // Build teams array from sides - store player IDs for normalized structure
        const teams = this._manualGameSetup.sides.map((side, idx) => ({
            id: `TEAM_${SIDE_LABELS[idx]}`,
            playerIds: side.map(p => p.id).filter(Boolean)
        }));

        // Get next match number (persistent, doesn't change with reordering)
        const matchNumber = this._queue.getNextMatchNumber();

        // Store disputing teams per side for proper hex placement logic
        const queueEntry = {
            id: Date.now(),
            matchNumber: matchNumber,
            game: document.getElementById('gameType').value,
            playType: playType,
            teams: teams,
            status: 'pending',
            isChallenge: true,
            // New structure: teams grouped by side
            disputingSideA: sideATeams,
            disputingSideB: sideBTeams,
            // Legacy field for backward compatibility
            disputingTeamIds: [...sideATeams, ...sideBTeams],
            createdAt: new Date().toISOString()
        };

        this._gameState.gameQueue = this._gameState.gameQueue || [];

        // Find insertion position: after ongoing games + first pending match
        const queue = this._gameState.gameQueue;
        const ongoingCount = queue.filter(g => g.status === 'ongoing').length;
        const firstPendingIndex = queue.findIndex(g =>
            g.status === 'pending' || g.status === undefined || g.status === 'queued'
        );

        let insertIndex;
        if (firstPendingIndex === -1) {
            insertIndex = ongoingCount;
        } else {
            insertIndex = firstPendingIndex + 1;
        }

        queue.splice(insertIndex, 0, queueEntry);

        // Build status message showing all disputes
        const getTeamName = (id) => {
            const team = this._gameState.teams.find(t => String(t.id) === String(id));
            return team?.name || `Team ${id}`;
        };
        const sideANames = sideATeams.map(getTeamName).join(' & ');
        const sideBNames = sideBTeams.map(getTeamName).join(' & ');
        const disputeCount = Math.max(sideATeams.length, sideBTeams.length);
        const disputeLabel = disputeCount > 1 ? `${disputeCount} disputes` : '1 dispute';

        await this._save(triggerBtn);
        this._logAction('match_created', 'match', {
            matchId: queueEntry.id, matchNumber, game: queueEntry.game, format: playType,
            isChallenge: true, disputingSideA: sideATeams, disputingSideB: sideBTeams,
            sides: teams.map(t => ({ id: t.id, playerIds: t.playerIds }))
        }, { matchId: queueEntry.id });
        this.clearMatchSetup();
        this._ui.showStatus(`\u2694\uFE0F CHALLENGE #${matchNumber}: ${sideANames} vs ${sideBNames} (${disputeLabel})`, 'success');
        this._onPhaseChanged();
    }

    // =========================================================================
    // MASS IMPORT
    // =========================================================================

    openMassImport() {
        if (!this._gameState || !this._gameState.teams) {
            this._ui.showStatus('Load a tournament first', 'warning');
            return;
        }
        document.getElementById('importFileInput').click();
    }

    handleImportFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this._validateAndPreviewImport(data);
            } catch (err) {
                this._ui.showStatus('Invalid JSON file: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);

        // Reset file input so same file can be selected again
        event.target.value = '';
    }

    _normalizeImportedMatch(m) {
        // Check if it's minimal format (short keys)
        if (m.n !== undefined) {
            return {
                matchNumber: m.n,
                game: m.g,
                playType: m.t,
                splitTeamId: m.s || null,
                rotationIndex: m.r || null,
                sideA: m.a || null,        // short key for sideA
                sideB: m.b || null,        // short key for sideB
                linkedMatch: m.l || null   // short key for linkedMatch
            };
        }
        // Already full format
        return m;
    }

    _validateAndPreviewImport(data) {
        if (!data.matches || !Array.isArray(data.matches)) {
            this._ui.showStatus('Invalid format: missing matches array', 'error');
            return;
        }

        if (data.matches.length === 0) {
            this._ui.showStatus('No matches in import file', 'warning');
            return;
        }

        // Normalize all matches
        const normalizedMatches = data.matches.map(m => this._normalizeImportedMatch(m));
        this._pendingImportData = { ...data, matches: normalizedMatches };

        // Build preview HTML
        const preview = document.getElementById('importPreview');
        const matchCount = normalizedMatches.length;
        const games = [...new Set(normalizedMatches.map(m => m.game))];
        const formats = [...new Set(normalizedMatches.map(m => m.playType))];

        // Count splits per team
        const splitCounts = {};
        normalizedMatches.forEach(m => {
            if (m.splitTeamId) {
                splitCounts[m.splitTeamId] = (splitCounts[m.splitTeamId] || 0) + 1;
            }
        });

        // Sample matches for preview
        const sampleMatches = normalizedMatches.slice(0, 5);

        preview.innerHTML = `
            <div class="import-summary">
                <div class="import-stat">
                    <span class="import-stat-label">Total Matches:</span>
                    <span class="import-stat-value">${matchCount}</span>
                </div>
                <div class="import-stat">
                    <span class="import-stat-label">Games:</span>
                    <span class="import-stat-value">${games.join(', ')}</span>
                </div>
                <div class="import-stat">
                    <span class="import-stat-label">Formats:</span>
                    <span class="import-stat-value">${formats.join(', ')}</span>
                </div>
                <div class="import-stat">
                    <span class="import-stat-label">Generated:</span>
                    <span class="import-stat-value">${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'Unknown'}</span>
                </div>
            </div>

            <h5>Sample Matches (first 5):</h5>
            <div class="import-samples">
                ${sampleMatches.map(m => `
                    <div class="import-sample-match">
                        <span class="sample-num">#${m.matchNumber}</span>
                        <span class="sample-game">${this._teams.getGameDisplayName(m.game)}</span>
                        <span class="sample-format">${m.playType}</span>
                        ${m.splitTeamId ? `<span class="sample-split">Split: T${m.splitTeamId}</span>` : ''}
                    </div>
                `).join('')}
                ${matchCount > 5 ? `<div class="import-more">... and ${matchCount - 5} more matches</div>` : ''}
            </div>

            <div class="import-warning">
                <strong>Warning:</strong> This will add ${matchCount} matches to the queue.
                Existing queue items will NOT be removed.
            </div>
        `;

        // Show modal
        document.getElementById('massImportModal').classList.add('active');
    }

    _getPlayersFromTeam(teamId) {
        // Use PlayerUtils if available (handles both formats properly)
        if (window.PlayerUtils) {
            return window.PlayerUtils.getTeamPlayerIds(this._gameState, teamId);
        }

        // Fallback: handle both formats manually
        const team = this._gameState.teams?.find(t => t.id === teamId || String(t.id) === String(teamId));
        if (!team) return [];

        // New format: playerIds array
        if (team.playerIds && Array.isArray(team.playerIds)) {
            return team.playerIds;
        }

        // Old format: players array with id/uid
        if (team.players && Array.isArray(team.players)) {
            return team.players.map(p => p.id || p.uid).filter(Boolean);
        }

        return [];
    }

    _buildTeamsFromRotation(rotationIndex, splitTeamId) {
        // Find the rotation pattern (1-indexed, so subtract 1)
        const patternIdx = ((rotationIndex || 1) - 1) % 10;
        const pattern = ROTATION_5V5_PATTERN[patternIdx];

        // Build Side A: full teams + first player from split team
        const sideAPlayerIds = [];
        pattern.sideA.forEach(teamId => {
            sideAPlayerIds.push(...this._getPlayersFromTeam(teamId));
        });
        // Add first player from split team
        const splitPlayers = this._getPlayersFromTeam(splitTeamId || pattern.splitTeamId);
        if (splitPlayers[0]) sideAPlayerIds.push(splitPlayers[0]);

        // Build Side B: full teams + second player from split team
        const sideBPlayerIds = [];
        pattern.sideB.forEach(teamId => {
            sideBPlayerIds.push(...this._getPlayersFromTeam(teamId));
        });
        // Add second player from split team
        if (splitPlayers[1]) sideBPlayerIds.push(splitPlayers[1]);

        return [
            { id: 'TEAM_A', playerIds: sideAPlayerIds },
            { id: 'TEAM_B', playerIds: sideBPlayerIds }
        ];
    }

    _buildTeamsFromPlayerLists(match) {
        // Support both full format (sideAPlayers) and minimal format (ap)
        const sideASlots = match.sideAPlayers || match.ap || [];
        const sideBSlots = match.sideBPlayers || match.bp || [];

        /**
         * Convert a player slot (e.g., "2a") to actual player ID from tournament
         * Slot format: "<teamId><playerIndex>" where playerIndex is 'a' (0) or 'b' (1)
         */
        const slotToPlayerId = (slot) => {
            if (!slot || typeof slot !== 'string') return null;

            // Parse slot: "2a" -> teamId=2, playerIndex=0
            const teamId = parseInt(slot.charAt(0));
            const playerIndex = slot.charCodeAt(1) - 97; // 'a'=0, 'b'=1

            if (isNaN(teamId) || playerIndex < 0) return null;

            // Get players from the team
            const teamPlayers = this._getPlayersFromTeam(teamId);
            if (!teamPlayers || teamPlayers.length <= playerIndex) return null;

            return teamPlayers[playerIndex];
        };

        const sideAPlayerIds = sideASlots.map(slotToPlayerId).filter(Boolean);
        const sideBPlayerIds = sideBSlots.map(slotToPlayerId).filter(Boolean);

        return [
            { id: 'TEAM_A', playerIds: sideAPlayerIds },
            { id: 'TEAM_B', playerIds: sideBPlayerIds }
        ];
    }

    _buildTeamsFor3v3(match) {
        const sideA = match.sideA || [];
        const sideB = match.sideB || [];
        const splitTeamId = match.splitTeamId;

        // 3v3: Each side needs 3 players
        // sideA/sideB contain team IDs - take 1 player from each + split contribution
        const sideAPlayerIds = [];
        const sideBPlayerIds = [];

        // For each team in sideA, take first player
        sideA.forEach(teamId => {
            const players = this._getPlayersFromTeam(teamId);
            if (players[0]) sideAPlayerIds.push(players[0]);
        });

        // For each team in sideB, take first player
        sideB.forEach(teamId => {
            const players = this._getPlayersFromTeam(teamId);
            if (players[0]) sideBPlayerIds.push(players[0]);
        });

        // If we don't have 3 players per side, add from split team or remaining players
        const splitPlayers = splitTeamId ? this._getPlayersFromTeam(splitTeamId) : [];
        if (sideAPlayerIds.length < 3 && splitPlayers[0]) {
            sideAPlayerIds.push(splitPlayers[0]);
        }
        if (sideBPlayerIds.length < 3 && splitPlayers[1]) {
            sideBPlayerIds.push(splitPlayers[1]);
        }

        return [
            { id: 'TEAM_A', playerIds: sideAPlayerIds },
            { id: 'TEAM_B', playerIds: sideBPlayerIds }
        ];
    }

    _buildTeamsFor2v2(match) {
        const sideA = match.sideA || [];
        const sideB = match.sideB || [];

        // 2v2: Each side needs 2 players
        const sideAPlayerIds = [];
        const sideBPlayerIds = [];

        // Take second player from teams in sideA (first player is in 3v3)
        sideA.forEach(teamId => {
            const players = this._getPlayersFromTeam(teamId);
            if (players[1]) sideAPlayerIds.push(players[1]);
            else if (players[0]) sideAPlayerIds.push(players[0]);
        });

        // Take second player from teams in sideB
        sideB.forEach(teamId => {
            const players = this._getPlayersFromTeam(teamId);
            if (players[1]) sideBPlayerIds.push(players[1]);
            else if (players[0]) sideBPlayerIds.push(players[0]);
        });

        return [
            { id: 'TEAM_A', playerIds: sideAPlayerIds },
            { id: 'TEAM_B', playerIds: sideBPlayerIds }
        ];
    }

    async confirmMassImport(triggerBtn) {
        if (!this._pendingImportData || !this._pendingImportData.matches) {
            this._ui.showStatus('No import data', 'error');
            this.closeMassImport();
            return;
        }

        const matches = this._pendingImportData.matches;
        let imported = 0;
        let startMatchNumber = this._queue.getNextMatchNumber();

        // Initialize queue if needed
        this._gameState.gameQueue = this._gameState.gameQueue || [];

        for (const match of matches) {
            let teams = [];

            // If match has explicit teams with players, use them
            if (match.teams && Array.isArray(match.teams)) {
                teams = match.teams.map(team => {
                    const playerIds = [];

                    if (team.players && Array.isArray(team.players)) {
                        team.players.forEach(importPlayer => {
                            const playerName = importPlayer.name || importPlayer;
                            const foundPlayer = this._findPlayerByName(playerName);
                            if (foundPlayer) {
                                playerIds.push(foundPlayer.id);
                            }
                        });
                    } else if (team.playerIds && Array.isArray(team.playerIds)) {
                        playerIds.push(...team.playerIds);
                    }

                    return { id: team.id, playerIds };
                });
            }
            // NEW: For matches with sideAPlayers/sideBPlayers (v3.0 format from balance optimizer)
            else if (match.sideAPlayers || match.sideBPlayers || match.ap || match.bp) {
                teams = this._buildTeamsFromPlayerLists(match);
            }
            // For 5v5 matches with rotation info, build teams from pattern (legacy)
            else if (match.playType === '5v5' && (match.rotationIndex || match.splitTeamId)) {
                teams = this._buildTeamsFromRotation(match.rotationIndex, match.splitTeamId);
            }
            // For 3v3 matches with sideA/sideB info
            else if (match.playType === '3v3' && (match.sideA || match.sideB)) {
                teams = this._buildTeamsFor3v3(match);
            }
            // For 2v2 matches with sideA/sideB info
            else if (match.playType === '2v2' && (match.sideA || match.sideB)) {
                teams = this._buildTeamsFor2v2(match);
            }
            // Default: empty teams (admin will need to assign manually)
            else {
                teams = [
                    { id: 'TEAM_A', playerIds: [] },
                    { id: 'TEAM_B', playerIds: [] }
                ];
            }

            const queueEntry = {
                id: Date.now() + imported,
                matchNumber: startMatchNumber + imported,
                game: match.game,
                playType: match.playType,
                teams: teams,
                status: 'pending',
                splitTeamId: match.splitTeamId || null,
                splitTeamName: match.splitTeamId ? this._getTeamNameById(match.splitTeamId) : null,
                rotationIndex: match.rotationIndex || null,
                linkedMatch: match.linkedMatch || null,
                isSimultaneous: match.isSimultaneous || (match.linkedMatch ? true : false),
                autoGenerated: true,
                importedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            this._gameState.gameQueue.push(queueEntry);
            imported++;
        }

        await this._save(triggerBtn);
        this._logAction('match_created', 'match', {
            importBatch: true, matchCount: imported, startMatchNumber: startMatchNumber
        }, { queueLengthBefore: this._gameState.gameQueue.length - imported });
        this.closeMassImport();
        this._ui.showStatus(`Imported ${imported} matches to queue!`, 'success');
        this._onPhaseChanged();
    }

    _findPlayerByName(name) {
        if (!this._gameState?.playerRegistry) return null;

        const normalizedName = name.toLowerCase().trim();
        for (const [id, player] of Object.entries(this._gameState.playerRegistry)) {
            if (player.name && player.name.toLowerCase().trim() === normalizedName) {
                return { id, ...player };
            }
        }
        return null;
    }

    _getTeamNameById(teamId) {
        if (!this._gameState?.teams) return null;
        const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
        return team?.name || `Team ${teamId}`;
    }

    closeMassImport() {
        document.getElementById('massImportModal').classList.remove('active');
        this._pendingImportData = null;
    }

    // =========================================================================
    // MATCH EDITING
    // =========================================================================

    openEditMatchModal(gameId) {
        const game = (this._gameState?.gameQueue || []).find(g => g.id === gameId);
        if (!game) {
            this._ui.showStatus('Match not found', 'warning');
            return;
        }

        // Don't allow editing ongoing matches
        if (game.status === 'ongoing') {
            this._ui.showStatus('Cannot edit an ongoing match', 'warning');
            return;
        }

        // Completed matches: redirect to correct result
        if (game.status === 'completed') {
            if (typeof window.openCorrectResultModal === 'function') {
                window.openCorrectResultModal(gameId);
            } else {
                this._ui.showStatus('Result correction not yet available', 'warning');
            }
            return;
        }

        // Initialize edit state from the match data
        this._editMatchState.gameId = gameId;
        this._editMatchState.game = game.game || game.gameType || '';
        this._editMatchState.isChallenge = game.isChallenge || false;

        // Convert teams to sides with full player info
        const teams = game.teams || game.sides || [];
        this._editMatchState.sides = teams.map(team => {
            return this._teams.getMatchTeamPlayers(team);
        });

        // Ensure at least 2 sides
        while (this._editMatchState.sides.length < 2) {
            this._editMatchState.sides.push([]);
        }

        // Update modal title
        const matchNumber = game.matchNumber ? `#${game.matchNumber}` : '';
        document.getElementById('editMatchNumber').textContent = matchNumber;

        // Populate game type dropdown
        this._populateEditGameTypeDropdown();

        // Render the sides
        this._renderEditMatchModal();

        // Show modal
        document.getElementById('editMatchModal').classList.add('active');
    }

    _populateEditGameTypeDropdown() {
        const select = document.getElementById('editGameType');
        const selectedGames = this._gameState?.selectedGames || [];

        if (selectedGames.length === 0) {
            select.innerHTML = '<option value="">No games available</option>';
            return;
        }

        select.innerHTML = selectedGames.map(gameId => {
            const displayName = this._teams.getGameDisplayName(gameId);
            const selected = gameId === this._editMatchState.game ? 'selected' : '';
            return `<option value="${gameId}" ${selected}>${displayName}</option>`;
        }).join('');
    }

    _renderEditMatchModal() {
        const container = document.getElementById('editSidesContainer');
        const escapeHtml = (str) => this._teams.escapeHtml(str);

        container.innerHTML = this._editMatchState.sides.map((side, sideIdx) => {
            const label = SIDE_LABELS[sideIdx] || (sideIdx + 1);

            // Render players in this side
            const playersHtml = side.map((player, playerIdx) => {
                const color = player.teamColor || player.originalTeamColor || '#666';
                const teamName = player.teamName || player.originalTeamName || '';

                // Build move buttons for other sides
                const moveOptions = this._editMatchState.sides
                    .map((_, otherIdx) => {
                        if (otherIdx === sideIdx) return '';
                        const otherLabel = SIDE_LABELS[otherIdx] || (otherIdx + 1);
                        return `<button class="edit-player-move" onclick="movePlayerInEdit(${sideIdx}, ${otherIdx}, ${playerIdx})" title="Move to Side ${otherLabel}">\u2192${otherLabel}</button>`;
                    })
                    .filter(Boolean)
                    .join('');

                return `
                    <div class="edit-player-row" style="--player-color: ${color}">
                        <span class="edit-player-name">${escapeHtml(player.name || 'Unknown')}</span>
                        <span class="edit-player-team">${teamName}</span>
                        <div class="edit-player-actions">
                            ${moveOptions}
                            <button class="edit-player-remove" onclick="removePlayerFromEdit(${sideIdx}, ${playerIdx})" title="Remove">\u2715</button>
                        </div>
                    </div>
                `;
            }).join('');

            // Build player add dropdown - show all available players
            const availablePlayersHtml = this._buildAvailablePlayersDropdown(sideIdx);

            return `
                <div class="edit-side">
                    <div class="edit-side-header">
                        <span class="edit-side-label">Side ${label}</span>
                        <span class="edit-side-count">${side.length} player${side.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="edit-side-players">
                        ${playersHtml || '<p style="color: var(--text-tertiary); font-size: 0.8rem; margin: 4px 0;">No players</p>'}
                    </div>
                    <div class="edit-add-player">
                        <select id="editAddPlayer_${sideIdx}">
                            <option value="">Add player...</option>
                            ${availablePlayersHtml}
                        </select>
                        <button class="btn-small primary" onclick="addPlayerToEditSide(${sideIdx})">Add</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    _buildAvailablePlayersDropdown(forSideIdx) {
        if (!this._gameState?.teams) return '';

        const escapeHtml = (str) => this._teams.escapeHtml(str);

        // Collect all player IDs currently in any side
        const usedPlayerIds = new Set();
        this._editMatchState.sides.forEach(side => {
            side.forEach(p => {
                if (p.id) usedPlayerIds.add(p.id);
            });
        });

        // Build options grouped by team
        let optionsHtml = '';
        this._gameState.teams.forEach(team => {
            const teamPlayers = (team.players || [])
                .filter(p => !usedPlayerIds.has(p.id))
                .map(p => `<option value="${p.id}" data-team="${team.id}">${escapeHtml(p.name)} (${escapeHtml(team.name)})</option>`)
                .join('');

            if (teamPlayers) {
                optionsHtml += `<optgroup label="${team.name}">${teamPlayers}</optgroup>`;
            }
        });

        return optionsHtml;
    }

    addPlayerToEditSide(sideIdx) {
        const select = document.getElementById(`editAddPlayer_${sideIdx}`);
        const playerId = select.value;

        if (!playerId) {
            this._ui.showStatus('Select a player to add', 'warning');
            return;
        }

        // Get full player info
        let playerInfo = null;
        if (window.PlayerUtils) {
            const info = window.PlayerUtils.getPlayerDisplayInfo(this._gameState, playerId);
            playerInfo = {
                id: playerId,
                name: info.name,
                teamId: info.teamId,
                originalTeamId: info.teamId,
                teamColor: info.teamColor,
                originalTeamColor: info.teamColor,
                teamName: info.teamName,
                originalTeamName: info.teamName
            };
        } else {
            // Fallback
            const player = this._gameState?.players?.[playerId];
            const team = player ? this._gameState?.teams?.find(t => t.id === player.teamId) : null;
            playerInfo = {
                id: playerId,
                name: player?.name || 'Unknown',
                teamId: player?.teamId,
                originalTeamId: player?.teamId,
                teamColor: team?.color || '#666666',
                originalTeamColor: team?.color || '#666666',
                teamName: team?.name,
                originalTeamName: team?.name
            };
        }

        this._editMatchState.sides[sideIdx].push(playerInfo);
        this._renderEditMatchModal();
    }

    removePlayerFromEdit(sideIdx, playerIdx) {
        this._editMatchState.sides[sideIdx].splice(playerIdx, 1);
        this._renderEditMatchModal();
    }

    movePlayerInEdit(fromSideIdx, toSideIdx, playerIdx) {
        const player = this._editMatchState.sides[fromSideIdx][playerIdx];
        this._editMatchState.sides[fromSideIdx].splice(playerIdx, 1);
        this._editMatchState.sides[toSideIdx].push(player);
        this._renderEditMatchModal();
    }

    addEditMatchSide() {
        if (this._editMatchState.sides.length >= SIDE_LABELS.length) {
            this._ui.showStatus(`Maximum ${SIDE_LABELS.length} sides allowed`, 'warning');
            return;
        }
        this._editMatchState.sides.push([]);
        this._renderEditMatchModal();
    }

    removeEditMatchSide() {
        if (this._editMatchState.sides.length <= 2) {
            this._ui.showStatus('Minimum 2 sides required', 'warning');
            return;
        }

        const lastSide = this._editMatchState.sides[this._editMatchState.sides.length - 1];
        if (lastSide.length > 0) {
            if (!confirm(`Side ${SIDE_LABELS[this._editMatchState.sides.length - 1]} has ${lastSide.length} player(s). Remove anyway?`)) {
                return;
            }
        }

        this._editMatchState.sides.pop();
        this._renderEditMatchModal();
    }

    async saveMatchEdits(triggerBtn) {
        // Validate - at least 2 sides with players
        const sidesWithPlayers = this._editMatchState.sides.filter(s => s.length > 0);
        if (sidesWithPlayers.length < 2) {
            this._ui.showStatus('At least 2 sides need players', 'warning');
            return;
        }

        // Find and update the match
        const matchIdx = (this._gameState?.gameQueue || []).findIndex(g => g.id === this._editMatchState.gameId);
        if (matchIdx === -1) {
            this._ui.showStatus('Match not found in queue', 'error');
            this.closeEditMatchModal();
            return;
        }

        const match = this._gameState.gameQueue[matchIdx];
        const prevMatchSnapshot = JSON.parse(JSON.stringify(match));

        // Update game type
        match.game = document.getElementById('editGameType').value;
        match.gameType = match.game;

        // Calculate play type from sides
        const playType = this._editMatchState.sides.map(s => s.length).join('v');
        match.playType = playType;

        // Update teams - store player IDs for normalized structure
        match.teams = this._editMatchState.sides.map((side, idx) => ({
            id: `TEAM_${SIDE_LABELS[idx]}`,
            playerIds: side.map(p => p.id).filter(Boolean)
        }));

        // Remove old format fields if present
        delete match.sides;
        delete match.teamA;
        delete match.teamB;

        await this._save(triggerBtn);
        this._logAction('match_details_edited', 'match', {
            matchId: match.id, matchNumber: match.matchNumber,
            game: match.game, format: playType,
            sides: match.teams.map(t => ({ id: t.id, playerIds: t.playerIds }))
        }, { matchEntry: prevMatchSnapshot });
        this.closeEditMatchModal();
        this._ui.showStatus('Match updated successfully', 'success');
    }

    closeEditMatchModal() {
        document.getElementById('editMatchModal').classList.remove('active');
        this._editMatchState = {
            gameId: null,
            game: '',
            sides: [],
            isChallenge: false
        };
    }

    // =========================================================================
    // AUTO-GENERATION
    // =========================================================================

    async generateSuggestedMatches() {
        if (!this._gameState || !this._gameState.teams) {
            this._ui.showStatus('Load a tournament first', 'warning');
            return;
        }

        // Check if SmartMatchGenerator is available
        if (typeof SmartMatchGenerator === 'undefined') {
            this._ui.showStatus('SmartMatchGenerator not loaded', 'error');
            return;
        }

        try {
            // Initialize or update the smart generator
            if (!window.smartMatchGenerator) {
                window.smartMatchGenerator = new SmartMatchGenerator(this._gameState);
            } else {
                // Update with latest gameState (teams may have changed)
                window.smartMatchGenerator.gameState = this._gameState;
                window.smartMatchGenerator.teams = this._gameState.teams || [];
            }

            // Generate the next optimized match(es)
            const result = window.smartMatchGenerator.generateNext();

            // Check for errors (e.g., not enough teams/players)
            if (result.error) {
                this._ui.showStatus(result.message, 'error');
                return;
            }

            const gameName = this._teams.getGameDisplayName(result.gameId);

            // Store pending match for confirmation
            this._pendingAutoMatch = {
                result,
                gameName
            };

            // Build modal content based on format
            let modalContent;

            if (result.format === '3v3+2v2') {
                modalContent = this._buildSplitFormatModal(result, gameName);
            } else {
                modalContent = this._build5v5Modal(result, gameName);
            }

            document.getElementById('autoMatchContent').innerHTML = modalContent;
            document.getElementById('autoMatchModal').classList.add('active');

        } catch (error) {
            console.error('Error generating matches:', error);
            this._ui.showStatus('Error generating matches: ' + error.message, 'error');
        }
    }

    _build5v5Modal(result, gameName) {
        const match = result.matches[0];
        const escapeHtml = (str) => this._teams.escapeHtml(str);

        const sideAHtml = match.teams[0].players.map(p => {
            const color = p.originalTeamColor || this._teams.getTeamColor(p.originalTeamId) || '#666';
            const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
            return `<div class="auto-match-player" style="--player-color: ${color}">
                <span class="player-name">${escapeHtml(p.name)}</span>
                <span class="player-team">${escapeHtml(p.originalTeamName)}</span>
                ${splitBadge}
            </div>`;
        }).join('');

        const sideBHtml = match.teams[1].players.map(p => {
            const color = p.originalTeamColor || this._teams.getTeamColor(p.originalTeamId) || '#666';
            const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
            return `<div class="auto-match-player" style="--player-color: ${color}">
                <span class="player-name">${escapeHtml(p.name)}</span>
                <span class="player-team">${escapeHtml(p.originalTeamName)}</span>
                ${splitBadge}
            </div>`;
        }).join('');

        // Build balance stats display
        const balanceInfo = result.balanceStats ? this._buildBalanceInfo(result.balanceStats) : '';
        const splitInfo = result.splitStats ? this._buildSplitInfo(result.splitStats) : '';

        return `
            <h4>Auto-Generated Match</h4>
            <div class="auto-match-header">
                <span class="rotation-badge">Match #${result.rotationInfo?.totalGenerated || '?'}</span>
                <span class="format-badge">${result.format}</span>
            </div>
            <div class="auto-match-game">
                <span class="game-name">${gameName}</span>
                <span class="play-type">${result.format}</span>
            </div>

            <div class="auto-match-sides">
                <div class="auto-match-side">
                    <div class="side-label">Side A</div>
                    <div class="side-desc">${result.sideADescription}</div>
                    <div class="side-players">${sideAHtml}</div>
                </div>
                <div class="auto-match-vs">VS</div>
                <div class="auto-match-side">
                    <div class="side-label">Side B</div>
                    <div class="side-desc">${result.sideBDescription}</div>
                    <div class="side-players">${sideBHtml}</div>
                </div>
            </div>

            <div class="auto-match-info">
                <div class="split-info">${result.splitDescription}</div>
                ${balanceInfo}
                ${splitInfo}
            </div>

            <div class="auto-match-actions">
                <button class="btn primary" onclick="confirmAutoMatch()">Add to Queue</button>
                <button class="btn secondary" onclick="closeAutoMatchModal()">Cancel</button>
            </div>
        `;
    }

    _buildSplitFormatModal(result, gameName) {
        const match3v3 = result.matches[0];
        const match2v2 = result.matches[1];
        const escapeHtml = (str) => this._teams.escapeHtml(str);

        // Build 3v3 players
        const match3v3SideA = match3v3.teams[0].players.map(p => {
            const color = p.originalTeamColor || this._teams.getTeamColor(p.originalTeamId) || '#666';
            const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
            return `<div class="auto-match-player small" style="--player-color: ${color}">
                <span class="player-name">${escapeHtml(p.name)}</span>
                ${splitBadge}
            </div>`;
        }).join('');

        const match3v3SideB = match3v3.teams[1].players.map(p => {
            const color = p.originalTeamColor || this._teams.getTeamColor(p.originalTeamId) || '#666';
            const splitBadge = p.isSplit ? '<span class="split-badge">SPLIT</span>' : '';
            return `<div class="auto-match-player small" style="--player-color: ${color}">
                <span class="player-name">${escapeHtml(p.name)}</span>
                ${splitBadge}
            </div>`;
        }).join('');

        // Build 2v2 players
        const match2v2SideA = match2v2.teams[0].players.map(p => {
            const color = p.originalTeamColor || this._teams.getTeamColor(p.originalTeamId) || '#666';
            return `<div class="auto-match-player small" style="--player-color: ${color}">
                <span class="player-name">${escapeHtml(p.name)}</span>
            </div>`;
        }).join('');

        const match2v2SideB = match2v2.teams[1].players.map(p => {
            const color = p.originalTeamColor || this._teams.getTeamColor(p.originalTeamId) || '#666';
            return `<div class="auto-match-player small" style="--player-color: ${color}">
                <span class="player-name">${escapeHtml(p.name)}</span>
            </div>`;
        }).join('');

        // Build balance stats display
        const balanceInfo = result.balanceStats ? this._buildBalanceInfo(result.balanceStats) : '';
        const splitInfo = result.splitStats ? this._buildSplitInfo(result.splitStats) : '';

        return `
            <h4>Auto-Generated Matches (Simultaneous)</h4>
            <div class="auto-match-header">
                <span class="rotation-badge">Match #${result.rotationInfo?.totalGenerated || '?'}</span>
                <span class="format-badge">${result.format}</span>
                <span class="simultaneous-badge">2 MATCHES</span>
            </div>
            <div class="auto-match-game">
                <span class="game-name">${gameName}</span>
                <span class="play-type">${result.format}</span>
            </div>

            <div class="split-format-matches">
                <div class="split-match-block">
                    <div class="match-label">3v3 Match</div>
                    <div class="auto-match-sides compact">
                        <div class="auto-match-side">
                            <div class="side-label">A</div>
                            <div class="side-players">${match3v3SideA}</div>
                        </div>
                        <div class="auto-match-vs">VS</div>
                        <div class="auto-match-side">
                            <div class="side-label">B</div>
                            <div class="side-players">${match3v3SideB}</div>
                        </div>
                    </div>
                </div>
                <div class="split-match-block">
                    <div class="match-label">2v2 Match</div>
                    <div class="auto-match-sides compact">
                        <div class="auto-match-side">
                            <div class="side-label">A</div>
                            <div class="side-players">${match2v2SideA}</div>
                        </div>
                        <div class="auto-match-vs">VS</div>
                        <div class="auto-match-side">
                            <div class="side-label">B</div>
                            <div class="side-players">${match2v2SideB}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="auto-match-info">
                <div class="split-info">${result.splitDescription}</div>
                ${balanceInfo}
                ${splitInfo}
            </div>

            <div class="auto-match-actions">
                <button class="btn primary" onclick="confirmAutoMatch()">Add Both to Queue</button>
                <button class="btn secondary" onclick="closeAutoMatchModal()">Cancel</button>
            </div>
        `;
    }

    _buildBalanceInfo(stats) {
        if (!stats) return '';

        const withRange = stats.with?.range ?? 0;
        const againstRange = stats.against?.range ?? 0;
        const isBalanced = withRange <= 2 && againstRange <= 2;

        const statusClass = isBalanced ? 'good' : 'warn';
        const statusIcon = isBalanced ? '\u2713' : '\u26A0';

        return `
            <div class="balance-info ${statusClass}">
                ${statusIcon} Balance: W\u00B1${withRange} A\u00B1${againstRange}
            </div>
        `;
    }

    _buildSplitInfo(stats) {
        if (!stats || !stats.splitCounts) return '';

        const counts = Object.entries(stats.splitCounts)
            .map(([teamId, count]) => `T${teamId}:${count}`)
            .join(' ');

        return `
            <div class="fairness-note">
                Splits: ${counts} (range: ${stats.range})
            </div>
        `;
    }

    async confirmAutoMatch() {
        if (!this._pendingAutoMatch) {
            this._ui.showStatus('No pending match', 'error');
            this.closeAutoMatchModal();
            return;
        }

        const { result, gameName } = this._pendingAutoMatch;

        this._gameState.gameQueue = this._gameState.gameQueue || [];

        const addedMatches = [];

        // Add each match from the result (1 for 5v5, 2 for 3v3+2v2)
        for (let i = 0; i < result.matches.length; i++) {
            const match = result.matches[i];
            const matchNumber = this._queue.getNextMatchNumber();

            // Create the queue entry
            const queueEntry = {
                id: Date.now() + i, // Ensure unique IDs for simultaneous matches
                matchNumber: matchNumber,
                game: result.gameId,
                playType: match.format,
                teams: [
                    {
                        id: 'TEAM_A',
                        name: 'TEAM A',
                        players: match.teams[0].players,
                        fullTeams: match.teams[0].fullTeams,
                        fullTeamNames: match.teams[0].fullTeamNames
                    },
                    {
                        id: 'TEAM_B',
                        name: 'TEAM B',
                        players: match.teams[1].players,
                        fullTeams: match.teams[1].fullTeams,
                        fullTeamNames: match.teams[1].fullTeamNames
                    }
                ],
                splitTeamId: match.splitTeamId || null,
                splitTeamName: match.splitTeamName || null,
                isSimultaneous: match.isSimultaneous || false,
                status: 'pending',
                createdAt: new Date().toISOString(),
                autoGenerated: true
            };

            this._gameState.gameQueue.push(queueEntry);
            addedMatches.push({ number: matchNumber, format: match.format });
        }

        // Save smart match generator state for session continuity
        if (window.smartMatchGenerator) {
            this._gameState.smartMatchState = window.smartMatchGenerator.getState();
        }

        await this._save();

        for (const m of addedMatches) {
            this._logAction('match_created', 'match', {
                matchNumber: m.number, format: m.format,
                game: result.gameId, autoGenerated: true
            }, { matchNumber: m.number });
        }

        // Build success message
        let statusMessage;
        if (addedMatches.length === 1) {
            statusMessage = `Match #${addedMatches[0].number} (${addedMatches[0].format}) added! ${result.splitDescription}`;
        } else {
            const matchNums = addedMatches.map(m => `#${m.number}`).join(' & ');
            statusMessage = `Matches ${matchNums} added! (${result.format}) ${result.splitDescription}`;
        }

        this._ui.showStatus(statusMessage, 'success');
        this.closeAutoMatchModal();
        this._onPhaseChanged();
    }

    closeAutoMatchModal() {
        document.getElementById('autoMatchModal').classList.remove('active');
        this._pendingAutoMatch = null;
    }
}

// Expose on window for global access
window.MatchCreationManager = MatchCreationManager;
