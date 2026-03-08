/**
 * StatsManager
 *
 * Owns statistics recalculation, point awarding, and round advancement.
 * Ported from lightweight/scripts/admin.js (lines 4227-4549)
 * and full/scripts/god-scripts_deprecated.js (lines 2488-2501).
 */
class StatsManager {

    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {BoardModule}  deps.boardModule       - Board hex type lookups
     * @param {UIManager}    deps.uiManager         - showStatus(), DOM helpers
     * @param {TeamManager}  deps.teamManager        - renderTeamsList(), getTeamColor()
     * @param {Function}     deps.saveCallback       - (triggerBtn?) => Promise<void>
     * @param {Function}     [deps.logEventCallback] - (type, data) => void
     */
    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {BoardModule}  deps.boardModule       - Board hex type lookups
     * @param {UIManager}    deps.uiManager         - showStatus(), DOM helpers
     * @param {TeamManager}  deps.teamManager        - renderTeamsList(), getTeamColor()
     * @param {Function}     deps.saveCallback       - (triggerBtn?) => Promise<void>
     * @param {Function}     [deps.logEventCallback] - (type, data) => void (legacy)
     * @param {Function}     [deps.logActionCallback] - (actionType, category, payload, previousState) => void
     */
    constructor(gameState, { boardModule, uiManager, teamManager, saveCallback, logEventCallback, logActionCallback, onPhaseRequirementsChanged }) {
        this._gameState = gameState;
        this._boardModule = boardModule;
        this._ui = uiManager;
        this._teams = teamManager;
        this._save = saveCallback;
        this._logEvent = logEventCallback || (() => {});
        this._logAction = logActionCallback || (() => {});
        this._onPhaseChanged = onPhaseRequirementsChanged || (() => {});
    }

    // ------------------------------------------------------------------
    // Statistics recalculation
    // ------------------------------------------------------------------

    /**
     * Recalculate every team's gamesWon / gamesLost / gamesPlayed
     * by walking the full gameHistory array.
     * Challenge matches are excluded.
     */
    async recalculateTeamStats() {
        const gs = this._gameState;

        if (!gs?.teams || !gs?.gameHistory) {
            console.error('No game state loaded');
            return;
        }

        console.log('Recalculating team stats from match history...');
        console.log(`Processing ${gs.gameHistory.length} matches for ${gs.teams.length} teams`);

        // Reset all team stats
        gs.teams.forEach(team => {
            team.gamesWon = 0;
            team.gamesLost = 0;
            team.gamesPlayed = 0;
        });

        let processedMatches = 0;
        let skippedSplitWins = 0;
        let skippedSplitLosses = 0;

        // Process each match in history (skip challenge matches — they don't affect team records)
        gs.gameHistory.forEach(match => {
            if (match.isChallenge) return;

            // Get player IDs from the match
            const winningPlayerIds = match.winningPlayerIds || [];
            const losingPlayerIds = match.losingPlayerIds || [];

            // If no player IDs, try legacy format
            if (winningPlayerIds.length === 0 && match.winningPlayers) {
                match.winningPlayers.forEach(p => {
                    if (p.id) winningPlayerIds.push(p.id);
                });
            }
            if (losingPlayerIds.length === 0 && match.losingPlayers) {
                match.losingPlayers.forEach(p => {
                    if (p.id) losingPlayerIds.push(p.id);
                });
            }

            // Count players per team on each side
            const winningTeamCounts = {};
            const losingTeamCounts = {};

            winningPlayerIds.forEach(playerId => {
                const player = this._resolvePlayer(playerId);
                const teamId = player?.teamId;
                if (teamId) {
                    winningTeamCounts[teamId] = (winningTeamCounts[teamId] || 0) + 1;
                }
            });

            losingPlayerIds.forEach(playerId => {
                const player = this._resolvePlayer(playerId);
                const teamId = player?.teamId;
                if (teamId) {
                    losingTeamCounts[teamId] = (losingTeamCounts[teamId] || 0) + 1;
                }
            });

            // Award wins to teams with 2+ players on winning side
            Object.entries(winningTeamCounts).forEach(([teamId, count]) => {
                const team = gs.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    if (count >= 2) {
                        team.gamesWon++;
                        team.gamesPlayed++;
                    } else {
                        skippedSplitWins++;
                    }
                }
            });

            // Award losses to teams with 2+ players on losing side
            Object.entries(losingTeamCounts).forEach(([teamId, count]) => {
                const team = gs.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    if (count >= 2) {
                        team.gamesLost++;
                        team.gamesPlayed++;
                    } else {
                        skippedSplitLosses++;
                    }
                }
            });

            processedMatches++;
        });

        // Calculate totals for verification
        const totalWins = gs.teams.reduce((sum, t) => sum + (t.gamesWon || 0), 0);
        const totalLosses = gs.teams.reduce((sum, t) => sum + (t.gamesLost || 0), 0);

        console.log('=== Recalculation Complete ===');
        console.log(`Processed: ${processedMatches} matches`);
        console.log(`Split wins skipped: ${skippedSplitWins}`);
        console.log(`Split losses skipped: ${skippedSplitLosses}`);
        console.log(`Total wins: ${totalWins}, Total losses: ${totalLosses}`);
        console.log(`Balance check: ${totalWins === totalLosses ? 'BALANCED' : 'IMBALANCED by ' + Math.abs(totalWins - totalLosses)}`);

        // Show updated standings
        console.log('\n=== Updated Team Standings ===');
        gs.teams
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .forEach((team, i) => {
                const winRate = team.gamesPlayed > 0 ? ((team.gamesWon / team.gamesPlayed) * 100).toFixed(0) : 0;
                console.log(`${i + 1}. ${team.name}: ${team.gamesWon}-${team.gamesLost} (${winRate}%)`);
            });

        // Save the corrected state
        await this._save();
        this._logAction('admin_override', 'admin', {
            description: 'Stats recalculated from match history',
            processedMatches, skippedSplitWins, skippedSplitLosses
        }, null);
        console.log('\nStats saved to database');

        // Refresh UI
        this._teams.renderTeamsList();
        this._ui.showStatus('Team stats recalculated from match history', 'success');

        return {
            processedMatches,
            skippedSplitWins,
            skippedSplitLosses,
            totalWins,
            totalLosses,
            balanced: totalWins === totalLosses
        };
    }

    // ------------------------------------------------------------------
    // Round & points system
    // ------------------------------------------------------------------

    /**
     * Award points to teams based on currently controlled heart hexes.
     * Side hearts = +1 point, Mountain heart (center) = +2 points.
     * Returns object with points awarded per team for display.
     */
    awardRoundPoints() {
        const gs = this._gameState;

        if (!gs?.teams || !this._boardModule) {
            return {};
        }

        // Collect hex coords under active challenge (pending/ongoing challenge matches)
        const contestedHexes = new Set();
        (gs.gameQueue || []).forEach(m => {
            if (m.isChallenge && m.challengeHexCoord &&
                (m.status === 'pending' || m.status === 'ongoing')) {
                contestedHexes.add(m.challengeHexCoord);
            }
        });

        const pointsAwarded = {};

        gs.teams.forEach(team => {
            let roundPoints = 0;

            // Count points from controlled heart hexes
            Object.entries(gs.heartHexControl || {}).forEach(([coord, ownerId]) => {
                // Skip hexes under active challenge — points frozen until resolved
                if (contestedHexes.has(coord)) return;

                if (ownerId === team.id) {
                    const matches = coord.match(/q(-?\d+)r(-?\d+)/);
                    if (matches) {
                        const [, q, r] = matches;
                        const hexType = this._boardModule.getHexType(parseInt(q), parseInt(r));

                        if (hexType === 'mountain-heart') {
                            roundPoints += 2; // Center hex = 2 points
                        } else if (hexType === 'side-heart') {
                            roundPoints += 1; // Side hex = 1 point
                        }
                    }
                }
            });

            // ADD points to existing total (not replace)
            if (roundPoints > 0) {
                team.points = (team.points || 0) + roundPoints;
                pointsAwarded[team.name || `Team ${team.id}`] = roundPoints;
            }
        });

        return pointsAwarded;
    }

    /**
     * Recalculate all points from scratch based on current hex control.
     * This REPLACES points — use for manual correction only.
     */
    calculateAllPoints() {
        const gs = this._gameState;

        if (!gs?.teams || !this._boardModule) {
            this._ui.showStatus('No game state to calculate', 'warning');
            return;
        }

        gs.teams.forEach(team => {
            let points = 0;

            // Count points from controlled heart hexes
            Object.entries(gs.heartHexControl || {}).forEach(([coord, ownerId]) => {
                if (ownerId === team.id) {
                    const matches = coord.match(/q(-?\d+)r(-?\d+)/);
                    if (matches) {
                        const [, q, r] = matches;
                        const hexType = this._boardModule.getHexType(parseInt(q), parseInt(r));

                        if (hexType === 'mountain-heart') {
                            points += 2;
                        } else if (hexType === 'side-heart') {
                            points += 1;
                        }
                    }
                }
            });

            team.points = points;
        });

        this._teams.renderTeamsList();
        this._ui.showStatus('Points recalculated from heart hexes', 'success');
    }

    /**
     * Open the Next Round confirmation modal with a preview of points
     * that will be awarded.
     */
    advanceRound() {
        const gs = this._gameState;

        if (!gs?.teams) {
            this._ui.showStatus('Load a tournament first', 'warning');
            return;
        }

        // Preview points that will be awarded
        const previewContainer = document.getElementById('nextRoundPreview');
        let previewHtml = '<h5>Points to be awarded:</h5>';

        let hasAnyPoints = false;

        gs.teams.forEach(team => {
            let roundPoints = 0;

            // Calculate points from controlled heart hexes
            Object.entries(gs.heartHexControl || {}).forEach(([coord, ownerId]) => {
                if (ownerId === team.id) {
                    const matches = coord.match(/q(-?\d+)r(-?\d+)/);
                    if (matches) {
                        const [, q, r] = matches;
                        const hexType = this._boardModule.getHexType(parseInt(q), parseInt(r));

                        if (hexType === 'mountain-heart') {
                            roundPoints += 2;
                        } else if (hexType === 'side-heart') {
                            roundPoints += 1;
                        }
                    }
                }
            });

            if (roundPoints > 0) hasAnyPoints = true;

            const teamColor = team.color || this._teams.getTeamColor(team.id);
            const pointsClass = roundPoints > 0 ? '' : 'no-points';

            previewHtml += `
                <div class="points-preview-item">
                    <div class="points-preview-team">
                        <span class="points-preview-dot" style="background: ${teamColor}"></span>
                        <span class="points-preview-name">${team.name || 'Team ' + team.id}</span>
                    </div>
                    <span class="points-preview-points ${pointsClass}">+${roundPoints}</span>
                </div>
            `;
        });

        if (!hasAnyPoints) {
            previewHtml += '<p style="color: var(--text-tertiary); font-size: 0.8rem; margin-top: 8px;">No heart hexes are controlled by any team.</p>';
        }

        previewContainer.innerHTML = previewHtml;

        // Show modal
        const modal = document.getElementById('nextRoundModal');
        if (modal) modal.style.display = 'flex';
    }

    /**
     * Close the Next Round confirmation modal.
     */
    closeNextRoundModal() {
        const modal = document.getElementById('nextRoundModal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * Confirm and advance to next round, awarding points.
     * @param {HTMLElement} [triggerBtn] - Button element for save feedback
     */
    async confirmAdvanceRound(triggerBtn) {
        const gs = this._gameState;

        this.closeNextRoundModal();

        // Award points BEFORE advancing round
        const pointsAwarded = this.awardRoundPoints();

        // Build message showing points awarded
        let pointsMessage = '';
        const awardedTeams = Object.entries(pointsAwarded);
        if (awardedTeams.length > 0) {
            pointsMessage = awardedTeams
                .map(([team, pts]) => `${team}: +${pts}`)
                .join(', ');
        } else {
            pointsMessage = 'No points awarded (no heart hexes controlled)';
        }

        // Use phase roundNumber as canonical source (PhaseManager handles incrementing)
        const currentPhaseRound = gs.currentPhase?.roundNumber || gs.currentRound || 0;

        // Record points history for this round
        gs.pointsHistory = gs.pointsHistory || [];
        gs.pointsHistory.push({
            round: currentPhaseRound,
            pointsAwarded: pointsAwarded,
            timestamp: new Date().toISOString()
        });

        // Sync top-level currentRound from phase (backward compat with view pages)
        gs.currentRound = currentPhaseRound;

        await this._save(triggerBtn);

        // Log round advance event
        this._logEvent('round_advance', {
            round: currentPhaseRound,
            pointsAwarded: pointsAwarded,
            message: `Round ${currentPhaseRound} points awarded`
        });
        // Snapshot team points before awarding (for undo)
        const prevTeamPoints = {};
        gs.teams.forEach(t => { prevTeamPoints[t.id] = (t.points || 0) - (pointsAwarded[t.name || `Team ${t.id}`] || 0); });

        this._logAction('points_awarded', 'points', {
            roundNumber: currentPhaseRound, pointsAwarded
        }, { teamPoints: prevTeamPoints, currentRound: currentPhaseRound });

        this._ui.showStatus(`Round ${currentPhaseRound} points awarded! ${pointsMessage}`, 'success');
        this._onPhaseChanged(); // Triggers phase requirements recheck
    }

    // ------------------------------------------------------------------
    // UI stat panel update (from god-scripts_deprecated.js)
    // ------------------------------------------------------------------

    /**
     * Update the statistics panel: games played, round, plates, hearts.
     */
    updateStatistics() {
        const gs = this._gameState;

        if (!gs) {
            document.getElementById('statGamesPlayed').textContent = '0';
            document.getElementById('statRound').textContent = '0';
            document.getElementById('statPlates').textContent = '0';
            document.getElementById('statHearts').textContent = '0';
            return;
        }

        document.getElementById('statGamesPlayed').textContent = gs.gamesPlayed || 0;
        document.getElementById('statRound').textContent = gs.currentRound || 0;
        document.getElementById('statPlates').textContent = Object.keys(gs.board || {}).length;
        document.getElementById('statHearts').textContent = Object.keys(gs.heartHexControl || {}).length;
    }
    // ------------------------------------------------------------------
    // Points Correction Panel
    // ------------------------------------------------------------------

    renderPointsCorrectionPanel(containerId = 'pointsCorrectionPanel') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const gs = this._gameState;
        if (!gs?.teams || gs.teams.length === 0) {
            container.innerHTML = '<p class="queue-empty">No teams loaded</p>';
            return;
        }

        container.innerHTML = gs.teams.map(team => {
            const teamColor = team.color || this._teams.getTeamColor(team.id);
            const points = team.points || 0;
            return `
                <div class="points-correction-row">
                    <span class="points-correction-dot" style="background: ${teamColor}"></span>
                    <span class="points-correction-name">${team.name || 'Team ' + team.id}</span>
                    <div class="points-correction-controls">
                        <button class="btn-small danger" onclick="adjustPointsWithReason(${team.id}, -1)">-</button>
                        <input type="number" class="points-correction-input" value="${points}"
                               onchange="setTeamPointsWithReason(${team.id}, this.value)" min="0">
                        <button class="btn-small primary" onclick="adjustPointsWithReason(${team.id}, 1)">+</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async adjustPointsWithReason(teamId, delta, reason) {
        const team = this._gameState?.teams?.find(t => t.id === teamId);
        if (!team) return;

        const oldPoints = team.points || 0;
        team.points = Math.max(0, oldPoints + delta);
        await this._save();

        this._logAction('points_corrected', 'points', {
            teamId, teamName: team.name,
            oldPoints, newPoints: team.points,
            delta, reason: reason || 'admin_correction'
        }, { points: oldPoints });

        this._teams.renderTeamsList();
        this.renderPointsCorrectionPanel();
    }

    async setTeamPointsWithReason(teamId, value, reason) {
        const team = this._gameState?.teams?.find(t => t.id === teamId);
        if (!team) return;

        const oldPoints = team.points || 0;
        const newPoints = Math.max(0, parseInt(value) || 0);
        team.points = newPoints;
        await this._save();

        this._logAction('points_corrected', 'points', {
            teamId, teamName: team.name,
            oldPoints, newPoints,
            reason: reason || 'admin_correction'
        }, { points: oldPoints });

        this._teams.renderTeamsList();
        this.renderPointsCorrectionPanel();
    }

    // ------------------------------------------------------------------
    // Rich Statistics Rendering (ported from lightweight/statistics.js)
    // ------------------------------------------------------------------

    /** Min duration for avg calculation */
    static MIN_DURATION_MINUTES = 5;

    /** Chart.js instance for points chart */
    _pointsChart = null;

    /** Render all stats panels */
    renderAllStats() {
        const gs = this._gameState;
        if (!gs?.teams) return;

        this.renderStandings();
        this.renderSummaryStats();
        this.renderStreaks();
        this.renderPointsChart();
        this.renderMatchHistory();
        this.renderHeadToHead();
        this.renderGameBreakdown();
        this.renderTeamGameStats();
        this.renderFormatBreakdown();
        this._populateMatchFilters();
    }

    // -- Helpers --

    _getTeamById(teamId) {
        return this._gameState?.teams?.find(t => String(t.id) === String(teamId));
    }

    _getTeamName(teamId) {
        const team = this._getTeamById(teamId);
        return team?.name || `Team ${teamId}`;
    }

    _getTeamColor(teamId) {
        const team = this._getTeamById(teamId);
        if (team?.color) return team.color;
        return this._teams?.getTeamColor?.(teamId) || '#666';
    }

    _getGameDisplayName(gameId) {
        if (this._gameState?.gameDefinitions?.[gameId]) {
            return this._gameState.gameDefinitions[gameId].name;
        }
        if (typeof GAMES_CONFIG !== 'undefined') {
            const game = GAMES_CONFIG.getGame(gameId);
            if (game) return game.name;
        }
        return gameId || 'Unknown';
    }

    _getGameIconHtml(gameId, size = 20) {
        const def = this._gameState?.gameDefinitions?.[gameId];
        if (def?.image) {
            const src = (typeof GAMES_CONFIG !== 'undefined' && GAMES_CONFIG.resolveImagePath)
                ? GAMES_CONFIG.resolveImagePath(def.image) : def.image;
            return `<img src="${src}" alt="" class="game-icon" width="${size}" height="${size}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="game-icon-fallback" style="display:none">${def.icon || ''}</span>`;
        }
        if (typeof GAMES_CONFIG !== 'undefined') {
            const game = GAMES_CONFIG.getGame(gameId);
            if (game?.image) {
                const src = GAMES_CONFIG.resolveImagePath(game.image);
                return `<img src="${src}" alt="" class="game-icon" width="${size}" height="${size}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="game-icon-fallback" style="display:none">${game.icon || ''}</span>`;
            }
            if (game?.icon) return `<span class="game-icon-emoji">${game.icon}</span>`;
        }
        return '';
    }

    /**
     * Resolve a player ID (registry key or UID) to a player object.
     */
    _resolvePlayer(playerId) {
        if (!playerId) return null;
        const gs = this._gameState;
        if (gs?.players?.[playerId]) return gs.players[playerId];
        if (gs?.players) {
            for (const p of Object.values(gs.players)) {
                if (p.uid === playerId) return p;
            }
        }
        for (const team of (gs?.teams || [])) {
            for (const p of (team.players || [])) {
                if (p.uid === playerId || p.id === playerId) return p;
            }
        }
        return null;
    }

    _getPlayerName(playerId) {
        if (!playerId) return 'Unknown';
        const player = this._resolvePlayer(playerId);
        return player?.name || 'Unknown';
    }

    _formatDateTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d)) return '';
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        return `${hh}:${mm} ${dd}.${mo}.${d.getFullYear()}`;
    }

    // -- Standings --

    renderStandings() {
        const container = document.getElementById('statsStandingsTable');
        if (!container) return;
        const gs = this._gameState;

        if (!gs?.teams?.length) {
            container.innerHTML = '<p class="no-data">No teams found</p>';
            return;
        }

        const sortedTeams = [...gs.teams].sort((a, b) => {
            const totalA = (a.points || 0) + (a.gamesWon || 0);
            const totalB = (b.points || 0) + (b.gamesWon || 0);
            if (totalB !== totalA) return totalB - totalA;
            return (b.gamesWon || 0) - (a.gamesWon || 0);
        });

        let html = `<table><thead><tr>
            <th>#</th><th>Team</th><th>Total</th><th>Wins</th><th>Hex Pts</th><th>W-L</th><th>Win %</th><th>Hexes</th>
        </tr></thead><tbody>`;

        sortedTeams.forEach((team, index) => {
            const rank = index + 1;
            const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
            const victoryPts = team.gamesWon || 0;
            const hexPts = team.points || 0;
            const totalPts = victoryPts + hexPts;
            const losses = team.gamesLost || 0;
            const played = team.gamesPlayed || (victoryPts + losses);
            const winRate = played > 0 ? ((victoryPts / played) * 100).toFixed(0) : 0;
            const winRateClass = winRate >= 60 ? 'high' : winRate >= 40 ? 'medium' : 'low';
            const hexCount = Object.values(gs.board || {}).filter(t => t === team.id).length;

            html += `<tr>
                <td class="rank ${rankClass}">${rank}</td>
                <td class="team-name"><span class="team-color-dot" style="background:${team.color || '#666'}"></span>${team.name || 'Team ' + team.id}</td>
                <td class="points"><strong>${totalPts}</strong></td>
                <td class="points">${victoryPts}</td>
                <td class="points">${hexPts}</td>
                <td class="record">${victoryPts}-${losses}</td>
                <td class="win-rate ${winRateClass}">${winRate}%</td>
                <td>${hexCount}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // -- Summary Stats --

    renderSummaryStats() {
        const gs = this._gameState;
        const history = (gs?.gameHistory || []).filter(m => !m.isBreak);

        const el = id => document.getElementById(id);
        const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };

        set('statsSummaryMatches', history.length);
        set('statsSummaryRounds', gs?.currentRound || 0);
        set('statsSummaryChallenges', history.filter(m => m.isChallenge).length);

        const allDurations = history
            .filter(m => m.matchDuration?.durationMinutes != null)
            .map(m => m.matchDuration.durationMinutes);
        const durations = allDurations.filter(d => d >= StatsManager.MIN_DURATION_MINUTES);
        if (durations.length > 0) {
            const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
            set('statsSummaryAvgDuration', `${avg} min`);
        } else {
            set('statsSummaryAvgDuration', 'N/A');
        }
    }

    // -- Streaks --

    renderStreaks() {
        const container = document.getElementById('statsStreaksList');
        if (!container) return;
        const gs = this._gameState;
        const history = gs?.gameHistory || [];

        if (!history.length || !gs?.teams) {
            container.innerHTML = '<p class="no-data">No streak data available</p>';
            return;
        }

        const streaks = {};
        gs.teams.forEach(team => { streaks[team.id] = { type: null, count: 0 }; });

        [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(match => {
            (match.winningTeamIds || []).forEach(tid => {
                if (!streaks[tid]) return;
                streaks[tid] = streaks[tid].type === 'win'
                    ? { type: 'win', count: streaks[tid].count + 1 }
                    : { type: 'win', count: 1 };
            });
            (match.losingTeamIds || []).forEach(tid => {
                if (!streaks[tid]) return;
                streaks[tid] = streaks[tid].type === 'loss'
                    ? { type: 'loss', count: streaks[tid].count + 1 }
                    : { type: 'loss', count: 1 };
            });
        });

        const notable = Object.entries(streaks)
            .filter(([, s]) => s.count >= 2)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);

        if (!notable.length) {
            container.innerHTML = '<p class="no-data">No notable streaks yet</p>';
            return;
        }

        container.innerHTML = notable.map(([tid, streak]) => {
            const color = this._getTeamColor(tid);
            return `<div class="streak-item" style="--streak-color:${color}">
                <span class="streak-team" style="color:${color}">${this._getTeamName(tid)}</span>
                <div class="streak-info">
                    <span class="streak-count">${streak.count}</span>
                    <span class="streak-type ${streak.type}">${streak.type === 'win' ? 'Wins' : 'Losses'}</span>
                </div>
            </div>`;
        }).join('');
    }

    // -- Points Chart --

    renderPointsChart() {
        const canvas = document.getElementById('statsPointsChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const ctx = canvas.getContext('2d');
        const gs = this._gameState;

        if (this._pointsChart) { this._pointsChart.destroy(); this._pointsChart = null; }
        if (!gs?.teams?.length || !gs?.gameHistory?.length) return;

        const labels = ['Start'];
        const datasets = gs.teams.map(team => ({
            label: team.name || `Team ${team.id}`,
            data: [0],
            borderColor: team.color || '#666',
            backgroundColor: (team.color || '#666') + '20',
            tension: 0.3,
            fill: false
        }));

        const sorted = [...gs.gameHistory].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        sorted.forEach((match, i) => {
            labels.push(`M${i + 1}`);
            gs.teams.forEach((team, ti) => {
                const snap = match.teamStatsSnapshot?.[team.id];
                datasets[ti].data.push(snap
                    ? (snap.points || 0) + (snap.gamesWon || 0)
                    : datasets[ti].data[datasets[ti].data.length - 1] || 0);
            });
        });

        labels.push('Now');
        gs.teams.forEach((team, ti) => {
            datasets[ti].data.push((team.points || 0) + (team.gamesWon || 0));
        });

        this._pointsChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: '#b0b0c0', usePointStyle: true } } },
                scales: {
                    x: { ticks: { color: '#707080' }, grid: { color: '#2a2a3a' } },
                    y: { beginAtZero: true, ticks: { color: '#707080' }, grid: { color: '#2a2a3a' } }
                }
            }
        });
    }

    // -- Match History --

    _populateMatchFilters() {
        const gs = this._gameState;
        if (!gs) return;

        const teamFilter = document.getElementById('statsFilterTeam');
        if (teamFilter) {
            teamFilter.innerHTML = '<option value="">All Teams</option>';
            (gs.teams || []).forEach(t => {
                teamFilter.innerHTML += `<option value="${t.id}">${t.name || 'Team ' + t.id}</option>`;
            });
        }

        const gameFilter = document.getElementById('statsFilterGame');
        if (gameFilter) {
            gameFilter.innerHTML = '<option value="">All Games</option>';
            const games = new Set();
            (gs.gameHistory || []).forEach(m => { if (m.game) games.add(m.game); });
            games.forEach(g => {
                gameFilter.innerHTML += `<option value="${g}">${this._getGameDisplayName(g)}</option>`;
            });
        }
    }

    renderMatchHistory() {
        const container = document.getElementById('statsMatchesList');
        if (!container) return;
        const gs = this._gameState;
        const history = gs?.gameHistory || [];

        if (!history.length) {
            container.innerHTML = '<p class="no-data">No matches played yet</p>';
            return;
        }

        // Read filters
        const filterTeam = document.getElementById('statsFilterTeam')?.value || '';
        const filterGame = document.getElementById('statsFilterGame')?.value || '';
        const filterResult = document.getElementById('statsFilterResult')?.value || '';
        const filterSearch = (document.getElementById('statsFilterSearch')?.value || '').toLowerCase();

        let filtered = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (filterTeam) {
            const tid = parseInt(filterTeam) || filterTeam;
            filtered = filtered.filter(m =>
                m.winningTeamIds?.includes(tid) || m.losingTeamIds?.includes(tid));
            if (filterResult === 'won') filtered = filtered.filter(m => m.winningTeamIds?.includes(tid));
            else if (filterResult === 'lost') filtered = filtered.filter(m => m.losingTeamIds?.includes(tid));
        }

        if (filterGame) filtered = filtered.filter(m => m.game === filterGame);

        if (filterSearch) {
            filtered = filtered.filter(m => {
                const names = [
                    ...(m.winningPlayerIds || []).map(id => this._getPlayerName(id).toLowerCase()),
                    ...(m.losingPlayerIds || []).map(id => this._getPlayerName(id).toLowerCase())
                ];
                return names.some(n => n.includes(filterSearch));
            });
        }

        if (!filtered.length) {
            container.innerHTML = '<p class="no-data">No matches match the current filters</p>';
            return;
        }

        const resolveMatchPlayers = (match, side) => {
            const playerIds = side === 'winners' ? match.winningPlayerIds : match.losingPlayerIds;
            if (playerIds?.length > 0) {
                return playerIds.map(id => {
                    const player = this._resolvePlayer(id);
                    return { name: player?.name || 'Unknown', color: player ? this._getTeamColor(player.teamId) : '#666' };
                });
            }
            const teamIds = side === 'winners' ? match.winningTeamIds : match.losingTeamIds;
            return (teamIds || []).map(id => ({ name: this._getTeamName(id), color: this._getTeamColor(id) }));
        };

        const renderPlayerList = players => players.map(p =>
            `<span class="match-player"><span class="match-player-dot" style="background:${p.color};box-shadow:0 0 4px ${p.color}"></span>${p.name}</span>`
        ).join('');

        let html = `<div class="matches-table-header">
            <span class="mth-number">#</span>
            <span class="mth-game">Game</span>
            <span class="mth-format">Format</span>
            <span class="mth-winners">Winners</span>
            <span class="mth-losers">Losers</span>
            <span class="mth-duration">Minutes</span>
            <span class="mth-time">Started / Ended</span>
        </div>`;

        html += filtered.map(match => {
            const winners = resolveMatchPlayers(match, 'winners');
            const losers = resolveMatchPlayers(match, 'losers');
            const duration = match.matchDuration?.durationMinutes ? `${match.matchDuration.durationMinutes} min` : '';
            const startStr = this._formatDateTime(match.matchDuration?.startedAt);
            const endStr = this._formatDateTime(match.matchDuration?.endedAt || match.timestamp);
            const timeHtml = startStr
                ? `<span class="match-time-start">${startStr}</span><span class="match-time-end">${endStr}</span>`
                : `<span class="match-time-end">${endStr}</span>`;

            return `<div class="match-item ${match.isChallenge ? 'challenge' : ''}">
                <span class="match-number">#${match.id || match.matchNumber || '?'}</span>
                <span class="match-game">${this._getGameIconHtml(match.game, 18)} ${this._getGameDisplayName(match.game)}</span>
                <span class="match-format">${match.playType || ''}</span>
                <div class="match-players winner">${renderPlayerList(winners)}</div>
                <div class="match-players loser">${renderPlayerList(losers)}</div>
                <span class="match-duration">${duration}</span>
                <div class="match-time">${timeHtml}</div>
            </div>`;
        }).join('');

        container.innerHTML = html;
    }

    // -- Head-to-Head --

    renderHeadToHead() {
        const container = document.getElementById('statsH2HMatrixContainer');
        if (!container) return;
        const gs = this._gameState;
        const teams = gs?.teams || [];
        const history = gs?.gameHistory || [];

        if (!teams.length) {
            container.innerHTML = '<p class="no-data">No teams found</p>';
            return;
        }

        const h2h = {};
        teams.forEach(t1 => {
            h2h[t1.id] = {};
            teams.forEach(t2 => { h2h[t1.id][t2.id] = { wins: 0, losses: 0 }; });
        });

        history.forEach(match => {
            (match.winningTeamIds || []).forEach(wid => {
                (match.losingTeamIds || []).forEach(lid => {
                    if (h2h[wid]?.[lid]) h2h[wid][lid].wins++;
                    if (h2h[lid]?.[wid]) h2h[lid][wid].losses++;
                });
            });
        });

        let html = '<table class="h2h-matrix"><thead><tr><th class="corner"></th>';
        teams.forEach(t => {
            html += `<th><span class="team-header" style="color:${t.color || '#fff'}">${t.name || 'T' + t.id}</span></th>`;
        });
        html += '</tr></thead><tbody>';

        teams.forEach(rowTeam => {
            html += `<tr><th style="color:${rowTeam.color || '#fff'}">${rowTeam.name || 'Team ' + rowTeam.id}</th>`;
            teams.forEach(colTeam => {
                if (rowTeam.id === colTeam.id) {
                    html += '<td class="cell diagonal">-</td>';
                } else {
                    const r = h2h[rowTeam.id][colTeam.id];
                    const cls = r.wins > r.losses ? 'positive' : r.wins < r.losses ? 'negative' : 'neutral';
                    html += `<td class="cell ${cls}" onclick="window.godApp?.stats?.showH2HDetail(${rowTeam.id},${colTeam.id})" title="${rowTeam.name} vs ${colTeam.name}">
                        <span class="h2h-record">${r.wins}-${r.losses}</span>
                    </td>`;
                }
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    showH2HDetail(team1Id, team2Id) {
        const detail = document.getElementById('statsH2HDetail');
        if (!detail) return;
        const t1 = this._getTeamById(team1Id);
        const t2 = this._getTeamById(team2Id);
        const history = this._gameState?.gameHistory || [];

        const matches = history.filter(m => {
            const all = [...(m.winningTeamIds || []), ...(m.losingTeamIds || [])];
            return all.includes(team1Id) && all.includes(team2Id);
        });

        if (!matches.length) {
            detail.innerHTML = `<div class="h2h-detail-content active">
                <div class="h2h-detail-header">
                    <span class="h2h-team-name" style="color:${t1?.color}">${t1?.name}</span>
                    <span class="h2h-vs">vs</span>
                    <span class="h2h-team-name" style="color:${t2?.color}">${t2?.name}</span>
                </div>
                <p class="no-data">No matches between these teams</p>
            </div>`;
            return;
        }

        const matchesHtml = matches.map(m => {
            const t1Won = m.winningTeamIds?.includes(team1Id);
            const color = t1Won ? t1?.color : t2?.color;
            const name = t1Won ? t1?.name : t2?.name;
            return `<div class="match-item" style="border-left:3px solid ${color}">
                <span class="match-number">#${m.id}</span>
                <span class="match-game">${this._getGameIconHtml(m.game, 16)} ${this._getGameDisplayName(m.game)}</span>
                <span style="flex:1;color:${color};font-weight:600">${name} won</span>
            </div>`;
        }).join('');

        detail.innerHTML = `<div class="h2h-detail-content active">
            <div class="h2h-detail-header">
                <span class="h2h-team-name" style="color:${t1?.color}">${t1?.name}</span>
                <span class="h2h-vs">vs</span>
                <span class="h2h-team-name" style="color:${t2?.color}">${t2?.name}</span>
            </div>
            <div class="h2h-matches-list">${matchesHtml}</div>
        </div>`;
    }

    // -- Game Analysis --

    renderGameBreakdown() {
        const container = document.getElementById('statsGameBreakdown');
        if (!container) return;
        const history = this._gameState?.gameHistory || [];

        if (!history.length) {
            container.innerHTML = '<p class="no-data">No game data available</p>';
            return;
        }

        const counts = {};
        const durations = {};
        history.forEach(m => {
            const g = m.game || 'Unknown';
            counts[g] = (counts[g] || 0) + 1;
            if (m.matchDuration?.durationMinutes != null) {
                durations[g] = durations[g] || [];
                durations[g].push(m.matchDuration.durationMinutes);
            }
        });

        container.innerHTML = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([game, count]) => {
                const all = durations[game] || [];
                const valid = all.filter(d => d >= StatsManager.MIN_DURATION_MINUTES);
                const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
                return `<div class="game-stat-card">
                    <div class="game-stat-icon">${this._getGameIconHtml(game, 32)}</div>
                    <div class="game-stat-name">${this._getGameDisplayName(game)}</div>
                    <div class="game-stat-count">${count}</div>
                    <div class="game-stat-label">matches</div>
                    ${avg ? `<div class="game-stat-duration">Avg: ${avg} min</div>` : ''}
                </div>`;
            }).join('');
    }

    renderTeamGameStats() {
        const container = document.getElementById('statsTeamGameStats');
        if (!container) return;
        const gs = this._gameState;
        const teams = gs?.teams || [];
        const history = gs?.gameHistory || [];

        if (!teams.length || !history.length) {
            container.innerHTML = '<p class="no-data">No data available</p>';
            return;
        }

        const games = [...new Set(history.map(m => m.game).filter(Boolean))];
        const stats = {};
        teams.forEach(t => {
            stats[t.id] = {};
            games.forEach(g => { stats[t.id][g] = { won: 0, lost: 0 }; });
        });

        history.forEach(m => {
            if (!m.game) return;
            (m.winningTeamIds || []).forEach(tid => { if (stats[tid]?.[m.game]) stats[tid][m.game].won++; });
            (m.losingTeamIds || []).forEach(tid => { if (stats[tid]?.[m.game]) stats[tid][m.game].lost++; });
        });

        let html = '<table><thead><tr><th>Team</th>';
        games.forEach(g => { html += `<th>${this._getGameIconHtml(g, 16)} ${this._getGameDisplayName(g)}</th>`; });
        html += '</tr></thead><tbody>';

        teams.forEach(t => {
            html += `<tr><td style="color:${t.color}">${t.name}</td>`;
            games.forEach(g => {
                const s = stats[t.id][g];
                const total = s.won + s.lost;
                const wr = total > 0 ? Math.round((s.won / total) * 100) : 0;
                const cls = wr >= 60 ? 'high' : wr >= 40 ? 'medium' : 'low';
                html += `<td>${s.won}-${s.lost} <span class="win-rate ${cls}">(${wr}%)</span></td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    renderFormatBreakdown() {
        const container = document.getElementById('statsFormatBreakdown');
        if (!container) return;
        const history = this._gameState?.gameHistory || [];

        if (!history.length) {
            container.innerHTML = '<p class="no-data">No format data available</p>';
            return;
        }

        const counts = {};
        history.forEach(m => {
            const f = m.playType || 'Unknown';
            counts[f] = (counts[f] || 0) + 1;
        });

        const total = history.length;
        container.innerHTML = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([format, count]) => {
                const pct = Math.round((count / total) * 100);
                return `<div class="format-item">
                    <span class="format-name">${format}</span>
                    <div class="format-bar"><div class="format-bar-fill" style="width:${pct}%"></div></div>
                    <span class="format-count">${count}</span>
                </div>`;
            }).join('');
    }
}

window.StatsManager = StatsManager;
