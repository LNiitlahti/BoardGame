/**
 * SummaryGenerator — Post-Tournament Analytics
 *
 * Computes tournament statistics from action log entries and final state.
 * Generates: overview, team stats, key moments, round summaries, hex analysis.
 * Renders into DOM and exports as JSON/Markdown.
 */

class SummaryGenerator {

    /**
     * @param {Object} options
     * @param {Array}  options.actions     - All action log entries (sorted by sequenceNumber)
     * @param {Array}  options.backups     - All backup snapshots
     * @param {Object} options.finalState  - Final tournament document
     * @param {Object} [options.boardModule] - BoardModule instance for hex type lookups
     */
    constructor({ actions, backups, finalState, boardModule }) {
        this._actions = (actions || []).filter(a => !a.undone);
        this._allActions = actions || [];
        this._backups = backups || [];
        this._finalState = finalState || {};
        this._boardModule = boardModule || null;
        this._summary = null;
    }

    // ------------------------------------------------------------------
    // Main Generate
    // ------------------------------------------------------------------

    generate() {
        if (this._summary) return this._summary;

        this._summary = {
            overview: this._computeOverview(),
            teamStats: this._computeTeamStats(),
            keyMoments: this._computeKeyMoments(),
            roundSummaries: this._computeRoundSummaries(),
            hexAnalysis: this._computeHexAnalysis()
        };

        return this._summary;
    }

    // ------------------------------------------------------------------
    // Overview
    // ------------------------------------------------------------------

    _computeOverview() {
        const teams = this._finalState.teams || [];
        const history = this._finalState.gameHistory || [];
        const winner = [...teams].sort((a, b) => (b.points || 0) - (a.points || 0))[0];

        // Duration from first to last action timestamp
        let startTime = null, endTime = null;
        for (const a of this._allActions) {
            const t = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
            if (!isNaN(t.getTime())) {
                if (!startTime || t < startTime) startTime = t;
                if (!endTime || t > endTime) endTime = t;
            }
        }

        const durationMs = startTime && endTime ? endTime - startTime : 0;
        const durationMinutes = Math.round(durationMs / 60000);

        return {
            tournamentName: this._finalState.name || 'Unknown',
            totalRounds: this._finalState.currentPhase?.roundNumber || this._finalState.currentRound || 0,
            totalMatches: history.length,
            totalActions: this._allActions.length,
            totalTeams: teams.length,
            durationMinutes,
            startTime: startTime?.toISOString() || null,
            endTime: endTime?.toISOString() || null,
            winner: winner ? { name: winner.name, points: winner.points || 0, color: winner.color } : null,
            status: this._finalState.status || 'unknown'
        };
    }

    // ------------------------------------------------------------------
    // Team Stats
    // ------------------------------------------------------------------

    _computeTeamStats() {
        const teams = this._finalState.teams || [];

        return teams.map(team => {
            const played = team.gamesPlayed || 0;
            const won = team.gamesWon || 0;
            const lost = team.gamesLost || 0;
            const winRate = played > 0 ? Math.round((won / played) * 100) : 0;

            // Count hexes controlled in final state
            const board = this._finalState.board || {};
            const hexCount = Object.values(board).filter(tid => String(tid) === String(team.id)).length;

            // Count heart hexes
            const hearts = this._finalState.heartHexControl || {};
            const heartCount = Object.values(hearts).filter(tid => String(tid) === String(team.id)).length;

            // Count spells cast
            const spellsCast = this._actions.filter(a =>
                a.actionType === 'spell_cast' && String(a.payload?.teamId) === String(team.id)
            ).length;

            // Points history (per-round points)
            const pointsHistory = (this._finalState.pointsHistory || []).map(entry => ({
                round: entry.round,
                points: entry.pointsAwarded?.[team.name] || 0
            }));

            return {
                id: team.id,
                name: team.name || `Team ${team.id}`,
                color: team.color || '#888',
                points: team.points || 0,
                gamesPlayed: played,
                gamesWon: won,
                gamesLost: lost,
                winRate,
                hexesControlled: hexCount,
                heartHexes: heartCount,
                spellsCast,
                pointsHistory
            };
        }).sort((a, b) => b.points - a.points);
    }

    // ------------------------------------------------------------------
    // Key Moments
    // ------------------------------------------------------------------

    _computeKeyMoments() {
        const moments = [];

        for (const action of this._actions) {
            const p = action.payload || {};

            // Heart hex captures
            if (action.actionType === 'heart_hex_captured') {
                moments.push({
                    type: 'heart_capture',
                    severity: 'high',
                    sequenceNumber: action.sequenceNumber,
                    roundNumber: action.roundNumber,
                    description: `Heart hex ${p.hexCoord} captured by ${p.newOwnerTeamId}`,
                    action
                });
            }

            // Plate placement on heart hex
            if (action.actionType === 'plate_placed' && p.isHeart) {
                moments.push({
                    type: 'heart_placement',
                    severity: 'high',
                    sequenceNumber: action.sequenceNumber,
                    roundNumber: action.roundNumber,
                    description: `${p.teamName || 'Team'} placed on heart hex ${p.hexCoord}`,
                    action
                });
            }

            // Big point swings (any team gaining 3+ in a round)
            if (action.actionType === 'points_awarded') {
                const awarded = p.pointsAwarded || {};
                for (const [teamName, pts] of Object.entries(awarded)) {
                    if (pts >= 3) {
                        moments.push({
                            type: 'big_points',
                            severity: 'medium',
                            sequenceNumber: action.sequenceNumber,
                            roundNumber: action.roundNumber,
                            description: `${teamName} gained ${pts} points in round ${action.roundNumber}`,
                            action
                        });
                    }
                }
            }

            // Spell board effects
            if (action.actionType === 'spell_board_effect') {
                const destroyed = (p.destroyedTiles || []).length;
                if (destroyed > 0) {
                    moments.push({
                        type: 'spell_effect',
                        severity: 'medium',
                        sequenceNumber: action.sequenceNumber,
                        roundNumber: action.roundNumber,
                        description: `Spell destroyed ${destroyed} tile${destroyed > 1 ? 's' : ''} on the board`,
                        action
                    });
                }
            }

            // Result corrections
            if (action.actionType === 'match_result_corrected') {
                moments.push({
                    type: 'correction',
                    severity: 'low',
                    sequenceNumber: action.sequenceNumber,
                    roundNumber: action.roundNumber,
                    description: `Match result corrected${p.reason ? ': ' + p.reason : ''}`,
                    action
                });
            }
        }

        return moments.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    }

    // ------------------------------------------------------------------
    // Round Summaries
    // ------------------------------------------------------------------

    _computeRoundSummaries() {
        const summaries = [];
        const maxRound = this._finalState.currentPhase?.roundNumber || this._finalState.currentRound || 0;

        for (let round = 1; round <= maxRound; round++) {
            const roundActions = this._actions.filter(a => a.roundNumber === round);

            const matchesPlayed = roundActions.filter(a => a.actionType === 'match_result_confirmed').length;
            const hexesPlaced = roundActions.filter(a => a.actionType === 'plate_placed').length;
            const spellsCast = roundActions.filter(a => a.actionType === 'spell_cast').length;

            // Points awarded this round
            const pointsAction = roundActions.find(a => a.actionType === 'points_awarded');
            const pointsAwarded = pointsAction?.payload?.pointsAwarded || {};

            summaries.push({
                round,
                matchesPlayed,
                hexesPlaced,
                spellsCast,
                pointsAwarded,
                totalActions: roundActions.length
            });
        }

        return summaries;
    }

    // ------------------------------------------------------------------
    // Hex Analysis
    // ------------------------------------------------------------------

    _computeHexAnalysis() {
        // Track ownership changes per hex
        const hexChanges = {}; // coord → { changes: number, owners: [{ teamId, seq }] }

        for (const action of this._actions) {
            const p = action.payload || {};
            const coord = p.hexCoord || p.coord;

            if (action.actionType === 'plate_placed' && coord) {
                hexChanges[coord] = hexChanges[coord] || { changes: 0, owners: [] };
                hexChanges[coord].changes++;
                hexChanges[coord].owners.push({
                    teamId: p.teamId,
                    seq: action.sequenceNumber
                });
            }

            if (action.actionType === 'plate_removed' && coord) {
                hexChanges[coord] = hexChanges[coord] || { changes: 0, owners: [] };
                hexChanges[coord].changes++;
            }

            if (action.actionType === 'spell_board_effect') {
                for (const c of (p.destroyedTiles || [])) {
                    hexChanges[c] = hexChanges[c] || { changes: 0, owners: [] };
                    hexChanges[c].changes++;
                }
            }
        }

        // Sort by most contested
        const sorted = Object.entries(hexChanges)
            .map(([coord, data]) => ({
                coord,
                changes: data.changes,
                uniqueOwners: [...new Set(data.owners.map(o => o.teamId))].length
            }))
            .sort((a, b) => b.changes - a.changes);

        return {
            totalHexesUsed: sorted.length,
            mostContested: sorted.slice(0, 10),
            hexChanges
        };
    }

    // ------------------------------------------------------------------
    // Render HTML
    // ------------------------------------------------------------------

    renderHTML(container) {
        const data = this.generate();
        const ov = data.overview;

        let html = '';

        // Overview
        html += `<div class="summary-section">
            <h4>Overview</h4>
            <div class="summary-overview-grid">
                <div class="overview-card">
                    <div class="value">${ov.totalRounds}</div>
                    <div class="label">Rounds</div>
                </div>
                <div class="overview-card">
                    <div class="value">${ov.totalMatches}</div>
                    <div class="label">Matches</div>
                </div>
                <div class="overview-card">
                    <div class="value">${ov.totalTeams}</div>
                    <div class="label">Teams</div>
                </div>
                <div class="overview-card">
                    <div class="value">${ov.durationMinutes}m</div>
                    <div class="label">Duration</div>
                </div>
                <div class="overview-card">
                    <div class="value">${ov.totalActions}</div>
                    <div class="label">Actions</div>
                </div>
                ${ov.winner ? `<div class="overview-card">
                    <div class="value" style="color:${ov.winner.color}">${this._esc(ov.winner.name)}</div>
                    <div class="label">Winner (${ov.winner.points}pts)</div>
                </div>` : ''}
            </div>
        </div>`;

        // Team Performance
        html += `<div class="summary-section">
            <h4>Team Performance</h4>
            <table class="summary-table">
                <tr>
                    <th>Team</th><th>Points</th><th>Win Rate</th>
                    <th>W/L</th><th>Hexes</th><th>Hearts</th><th>Spells</th>
                </tr>
                ${data.teamStats.map(t => `
                    <tr>
                        <td><span style="color:${t.color};font-weight:700">${this._esc(t.name)}</span></td>
                        <td style="font-weight:700">${t.points}</td>
                        <td>${t.winRate}%</td>
                        <td>${t.gamesWon}/${t.gamesLost}</td>
                        <td>${t.hexesControlled}</td>
                        <td>${t.heartHexes}</td>
                        <td>${t.spellsCast}</td>
                    </tr>
                `).join('')}
            </table>
        </div>`;

        // Points Progression Chart
        if (data.roundSummaries.length > 0 && data.teamStats.length > 0) {
            html += `<div class="summary-section">
                <h4>Points Per Round</h4>
                <div class="points-chart">
                    ${data.roundSummaries.map(rs => {
                        const maxPts = Math.max(1, ...data.teamStats.map(t => {
                            const rh = t.pointsHistory.find(ph => ph.round === rs.round);
                            return rh?.points || 0;
                        }));

                        const bars = data.teamStats.map(t => {
                            const rh = t.pointsHistory.find(ph => ph.round === rs.round);
                            const pts = rh?.points || 0;
                            const height = Math.max(2, (pts / maxPts) * 100);
                            return `<div class="chart-bar" style="height:${height}%;background:${t.color}" title="${t.name}: ${pts}pts"></div>`;
                        }).join('');

                        return `<div class="chart-round-group">
                            ${bars}
                            <div class="chart-round-label">R${rs.round}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Key Moments
        if (data.keyMoments.length > 0) {
            const icons = {
                heart_capture: '&#9829;', heart_placement: '&#9829;',
                big_points: '&#9733;', spell_effect: '&#10024;', correction: '&#9998;'
            };
            html += `<div class="summary-section">
                <h4>Key Moments (${data.keyMoments.length})</h4>
                ${data.keyMoments.slice(0, 30).map(m => `
                    <div class="key-moment" onclick="closeSummary(); seekToIndex(${this._seqToFeedIndex(m.sequenceNumber)})">
                        <span class="moment-seq">#${m.sequenceNumber}</span>
                        <span class="moment-icon">${icons[m.type] || '&#8226;'}</span>
                        <span class="moment-desc">${this._esc(m.description)}</span>
                    </div>
                `).join('')}
            </div>`;
        }

        // Most Contested Hexes
        if (data.hexAnalysis.mostContested.length > 0) {
            html += `<div class="summary-section">
                <h4>Most Contested Hexes</h4>
                <table class="summary-table">
                    <tr><th>Hex</th><th>Changes</th><th>Unique Owners</th></tr>
                    ${data.hexAnalysis.mostContested.map(h => `
                        <tr>
                            <td style="font-family:monospace">${h.coord}</td>
                            <td>${h.changes}</td>
                            <td>${h.uniqueOwners}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>`;
        }

        container.innerHTML = html;
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    toJSON() {
        return this.generate();
    }

    toMarkdown() {
        const data = this.generate();
        const ov = data.overview;
        let md = '';

        md += `# Tournament Summary: ${ov.tournamentName}\n\n`;
        md += `**Date:** ${ov.startTime ? new Date(ov.startTime).toLocaleDateString() : 'Unknown'}  \n`;
        md += `**Duration:** ${ov.durationMinutes} minutes  \n`;
        md += `**Rounds:** ${ov.totalRounds} | **Matches:** ${ov.totalMatches} | **Teams:** ${ov.totalTeams}  \n`;
        if (ov.winner) md += `**Winner:** ${ov.winner.name} (${ov.winner.points} points)  \n`;
        md += '\n---\n\n';

        // Team stats
        md += '## Team Performance\n\n';
        md += '| Team | Points | Win Rate | W/L | Hexes | Hearts |\n';
        md += '|------|--------|----------|-----|-------|--------|\n';
        for (const t of data.teamStats) {
            md += `| ${t.name} | ${t.points} | ${t.winRate}% | ${t.gamesWon}/${t.gamesLost} | ${t.hexesControlled} | ${t.heartHexes} |\n`;
        }
        md += '\n';

        // Key moments
        if (data.keyMoments.length > 0) {
            md += '## Key Moments\n\n';
            for (const m of data.keyMoments) {
                md += `- **#${m.sequenceNumber}** (Round ${m.roundNumber}): ${m.description}\n`;
            }
            md += '\n';
        }

        // Round summaries
        if (data.roundSummaries.length > 0) {
            md += '## Round Summaries\n\n';
            md += '| Round | Matches | Hexes Placed | Spells | Actions |\n';
            md += '|-------|---------|-------------|--------|--------|\n';
            for (const rs of data.roundSummaries) {
                md += `| ${rs.round} | ${rs.matchesPlayed} | ${rs.hexesPlaced} | ${rs.spellsCast} | ${rs.totalActions} |\n`;
            }
            md += '\n';
        }

        md += '\n---\n*Generated from tournament action log*\n';
        return md;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Find the action feed index for a given sequence number (for clickable moments).
     */
    _seqToFeedIndex(seqNum) {
        return this._allActions.findIndex(a => a.sequenceNumber === seqNum);
    }
}

window.SummaryGenerator = SummaryGenerator;
