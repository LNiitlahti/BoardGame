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
                const player = gs.players?.[playerId];
                const teamId = player?.teamId;
                if (teamId) {
                    winningTeamCounts[teamId] = (winningTeamCounts[teamId] || 0) + 1;
                }
            });

            losingPlayerIds.forEach(playerId => {
                const player = gs.players?.[playerId];
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

        const pointsAwarded = {};

        gs.teams.forEach(team => {
            let roundPoints = 0;

            // Count points from controlled heart hexes
            Object.entries(gs.heartHexControl || {}).forEach(([coord, ownerId]) => {
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
        this._onPhaseChanged(); // Triggers auto-advance from round_end
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
}

window.StatsManager = StatsManager;
