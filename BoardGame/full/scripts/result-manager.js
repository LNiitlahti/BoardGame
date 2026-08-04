/**
 * ResultManager
 *
 * Owns match result confirmation, quick confirm popup, game history creation,
 * and pending hex win notifications.
 */

const SIDE_LABELS_RM = ['A', 'B', 'C', 'D', 'E'];

const BREAK_TYPES_RM = {
    piss:      { label: 'Piss Break',      emoji: iconSvg('toilet', '#9ca3af') },
    cigarette: { label: 'Cigarette Break',  emoji: iconSvg('cigarette', '#fef9c3') },
    food:      { label: 'Food Break',       emoji: iconSvg('pizza', '#f97316') },
    sleep:     { label: 'Sleep',            emoji: iconSvg('moon', '#818cf8') }
};

class ResultManager {

    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {UIManager}          deps.uiManager
     * @param {TeamManager}        deps.teamManager
     * @param {MatchQueueManager}  deps.queueManager
     * @param {BoardManager}       deps.boardManager
     * @param {Function}           deps.saveCallback      - () => Promise<void>
     * @param {Function}           deps.logEventCallback   - (type, data) => void
     */
    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {UIManager}          deps.uiManager
     * @param {TeamManager}        deps.teamManager
     * @param {MatchQueueManager}  deps.queueManager
     * @param {BoardManager}       deps.boardManager
     * @param {Function}           deps.saveCallback      - () => Promise<void>
     * @param {Function}           deps.logEventCallback   - (type, data) => void (legacy)
     * @param {Function}           [deps.logActionCallback] - (actionType, category, payload, previousState) => void
     */
    constructor(gameState, { uiManager, teamManager, queueManager, boardManager, saveCallback, logEventCallback, logActionCallback, onPhaseRequirementsChanged }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._teams = teamManager;
        this._queue = queueManager;
        this._board = boardManager;
        this._save = saveCallback;
        this._logEvent = logEventCallback || (() => {});
        this._logAction = logActionCallback || (() => {});
        this._onPhaseChanged = onPhaseRequirementsChanged || (() => {});

        this._selectedQueuedGame = null;
        this._asyncBusy = false;
        // _pendingHexWins is NOT a plain instance field — see the
        // get/set _pendingHexWins accessor pair below, which backs it with
        // gameState.pendingHexWins (TODO.md Task 15).
    }

    // ------------------------------------------------------------------
    // Pending hex wins — backed by gameState (see accessor rationale)
    // ------------------------------------------------------------------

    /**
     * `_pendingHexWins` used to be a plain in-memory instance array — reset
     * to [] on every page load, with nothing ever restoring it from
     * Firestore. It's the SOLE gate for advancing past hex_placement_1/2
     * (phase-manager.js's _getPendingHexCount(), wired at god-app.js:171 to
     * `this.result._pendingHexWins.length`), so a refresh mid-hex-placement
     * silently reset the gate to "all clear" regardless of true state.
     *
     * Backing this with a get/set accessor pair (instead of a plain field)
     * means every existing `this._pendingHexWins.push(...)`/`.length`/
     * `.filter(...)` call site throughout this file keeps working exactly
     * as written, but now transparently reads/writes through
     * `this._gameState.pendingHexWins` — persisted the same way every other
     * gameState array field is (via the `saveCallback`/saveGameState()
     * pattern), and naturally re-synced on every Firestore snapshot since
     * `this._gameState` is the same stable object GodApp's onSnapshot
     * handler does `Object.assign(this.gameState, newData)` into.
     */
    get _pendingHexWins() {
        if (!this._gameState.pendingHexWins) this._gameState.pendingHexWins = [];
        return this._gameState.pendingHexWins;
    }

    set _pendingHexWins(value) {
        this._gameState.pendingHexWins = value;
    }

    // ------------------------------------------------------------------
    // Result confirmation modal
    // ------------------------------------------------------------------

    /**
     * Open the quick-confirm popup for a queued match.
     * Break entries get a simplified modal; regular matches show team cards.
     * @param {number} gameId - The game queue entry ID
     */
    openQuickConfirm(gameId) {
        const game = (this._gameState?.gameQueue || []).find(g => g.id === gameId);
        if (!game) return;

        this._selectedQueuedGame = game;

        // Break entries get a simplified confirm modal
        if (game.isBreak === true) {
            const breakDef = BREAK_TYPES_RM[game.breakType] || { label: game.breakLabel || 'Break', emoji: ICON_SVGS.pause };
            const isOngoing = game.status === 'ongoing';
            const modal = document.getElementById('resultConfirmModal');
            const content = document.getElementById('resultConfirmContent');

            content.innerHTML = `
                <h4>${isOngoing ? 'Complete Break' : 'Start Break'}</h4>
                <div class="confirm-game-name"><span class="break-badge" style="margin-right: 8px;">BREAK</span>${breakDef.emoji} ${breakDef.label}</div>

                <div class="confirm-actions">
                    ${isOngoing
                        ? `<button class="btn primary" onclick="completeBreak(${gameId})">Break Over</button>`
                        : `<button class="btn primary" onclick="startMatch(${gameId}); closeResultConfirm();">Start Break</button>`
                    }
                    <button class="btn secondary" onclick="closeResultConfirm()">Cancel</button>
                </div>
            `;

            modal.style.display = 'flex';
            return;
        }

        const gameName = this._teams.getGameDisplayName(game.game || game.gameType);
        const isOngoing = game.status === 'ongoing';
        const isChallenge = game.isChallenge === true;
        const teams = game.teams || [];

        // Default team colors
        const defaultColors = [
            'var(--accent-danger)',
            'var(--accent-primary)',
            '#2e9158',
            '#f7ba32',
            '#9b59b6'
        ];

        // Build team cards (supports both old players and new playerIds format)
        const teamCardsHtml = teams.map((team, idx) => {
            const label = SIDE_LABELS_RM[idx] || (idx + 1);
            const players = this._teams.getMatchTeamPlayers(team);
            let teamNames = `Team ${label}`;
            let primaryColor = defaultColors[idx] || 'var(--text-secondary)';
            let borderStyle = '';
            let buttonStyle = '';

            if (players.length > 0) {
                teamNames = players.map(p => p.name || 'Unknown').join(', ');

                // Count players per original team for proportional coloring
                const teamColorCounts = {};
                players.forEach(p => {
                    const teamId = p.teamId || p.originalTeamId;
                    const color = p.teamColor || p.originalTeamColor || defaultColors[idx];
                    if (teamId) {
                        if (!teamColorCounts[teamId]) {
                            teamColorCounts[teamId] = { color: color, count: 0 };
                        }
                        teamColorCounts[teamId].count++;
                    }
                });

                const colorEntries = Object.values(teamColorCounts);

                if (colorEntries.length === 1) {
                    // Single team - solid color
                    primaryColor = colorEntries[0].color;
                    borderStyle = `border-color: ${primaryColor}`;
                    buttonStyle = `background: ${primaryColor}`;
                } else if (colorEntries.length > 1) {
                    // Multiple teams - create gradient
                    const totalPlayers = players.length;
                    let gradientStops = [];
                    let currentPercent = 0;

                    colorEntries.forEach((entry, i) => {
                        const percent = (entry.count / totalPlayers) * 100;
                        gradientStops.push(`${entry.color} ${currentPercent}%`);
                        gradientStops.push(`${entry.color} ${currentPercent + percent}%`);
                        currentPercent += percent;
                    });

                    const gradient = `linear-gradient(135deg, ${gradientStops.join(', ')})`;
                    borderStyle = `border-image: ${gradient} 1`;
                    buttonStyle = `background: ${gradient}`;
                    primaryColor = colorEntries[0].color; // Fallback for border-left
                }
            } else if (team.name) {
                teamNames = team.name;
                borderStyle = `border-color: ${primaryColor}`;
                buttonStyle = `background: ${primaryColor}`;
            } else {
                borderStyle = `border-color: ${primaryColor}`;
                buttonStyle = `background: ${primaryColor}`;
            }

            return `
                <div class="confirm-team" style="${borderStyle}">
                    <div class="confirm-team-label">Team ${label}</div>
                    <div class="confirm-team-players">${teamNames}</div>
                    <button class="btn confirm-win-btn" style="${buttonStyle}"
                            onclick="quickConfirmResult(${gameId}, ${idx})">
                        Team ${label} Wins
                    </button>
                </div>
            `;
        }).join('<div class="confirm-vs">VS</div>');

        // Build popup content
        const modal = document.getElementById('resultConfirmModal');
        const content = document.getElementById('resultConfirmContent');

        const matchNumDisplay = game.matchNumber ? `Match #${game.matchNumber} - ` : '';
        const challengeBadgeHtml = isChallenge ? '<span class="challenge-badge" style="margin-right: 8px;">CHALLENGE</span>' : '';

        content.innerHTML = `
            <h4>${isOngoing ? 'Confirm Result' : 'Start & Confirm Result'}</h4>
            <div class="confirm-game-name">${challengeBadgeHtml}${matchNumDisplay}${gameName} ${game.playType ? '(' + game.playType + ')' : ''}</div>

            <div class="confirm-matchup ${teams.length > 2 ? 'multi-team' : ''}">
                ${teamCardsHtml}
            </div>

            <div class="confirm-actions">
                ${!isOngoing ? `<button class="btn secondary" onclick="startMatch(${gameId}); closeResultConfirm();">Start Match (No Result Yet)</button>` : ''}
                <button class="btn secondary" onclick="closeResultConfirm()">Cancel</button>
            </div>
        `;

        modal.style.display = 'flex';

        // Player votes — informational only. The admin still picks the
        // winner themselves via the team buttons above; this just shows
        // what the players reported so the admin isn't picking blind.
        this._injectVoteInfo(game, content);
    }

    /**
     * Show what the players voted, inline in the result confirm popup.
     * No-op if nobody has voted. Purely informational: it never blocks or
     * pre-selects a winner, it only highlights the team card the votes
     * currently favor so the admin can compare it against what they saw.
     */
    _injectVoteInfo(game, content) {
        const votes = game.votes || [];
        if (votes.length === 0 || content.querySelector('.confirm-votes-block')) return;

        const esc = (s) => this._teams.escapeHtml(s || '');
        const counts = {};
        votes.forEach(v => { counts[v.result] = (counts[v.result] || 0) + 1; });
        const total = votes.length;
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const [bestResult, bestCount] = sorted[0];
        const bestPct = Math.round((bestCount / total) * 100);
        const isTie = sorted.filter(([, c]) => c === bestCount).length > 1;

        const labelFor = (result) => {
            const m = result.match(/side_(\d+)_won/);
            return m ? `Side ${SIDE_LABELS_RM[parseInt(m[1])] || m[1]} wins` : result;
        };

        const rowsHtml = sorted.map(([result, count]) => {
            const pct = Math.round((count / total) * 100);
            const names = votes.filter(v => v.result === result)
                .map(v => esc(v.playerName || 'Player')).join(', ');
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

    /**
     * Close result confirm popup.
     */
    closeResultConfirm() {
        document.getElementById('resultConfirmModal').style.display = 'none';
        this._selectedQueuedGame = null;
    }

    /**
     * Quick confirm result from popup.
     * @param {number} gameId       - The game queue ID
     * @param {number} winnerIndex  - Index of the winning team (0, 1, 2, etc.)
     */
    async quickConfirmResult(gameId, winnerIndex) {
        if (this._asyncBusy) return;
        this._asyncBusy = true;
        try {
            const game = (this._gameState?.gameQueue || []).find(g => g.id === gameId);
            if (!game) {
                this._ui.showStatus('Match not found', 'error');
                return;
            }

            // Use existing confirmResult logic but with specific game
            this._selectedQueuedGame = game;
            await this.confirmResult(winnerIndex);
            this.closeResultConfirm();
        } finally { this._asyncBusy = false; }
    }

    // ------------------------------------------------------------------
    // CRITICAL: confirm match result
    // ------------------------------------------------------------------

    /**
     * Confirm match result.
     *
     * Records the match result, updates team stats (wins/losses),
     * creates a gameHistory entry, marks queue entry completed,
     * increments gamesPlayed, saves state, and logs the win event.
     *
     * @param {number} winnerIndex - Index of the winning team (0, 1, 2, etc.)
     */
    async confirmResult(winnerIndex) {
        if (!this._selectedQueuedGame) {
            this._ui.showStatus('No match selected', 'warning');
            return;
        }

        const teams = this._selectedQueuedGame.teams || [];
        if (winnerIndex < 0 || winnerIndex >= teams.length) {
            this._ui.showStatus('Invalid winner selection', 'error');
            return;
        }

        // Snapshot team stats BEFORE any mutations (for undo)
        const _prevTeamStats = {};
        this._gameState.teams.forEach(t => {
            _prevTeamStats[t.id] = {
                gamesWon: t.gamesWon || 0, gamesLost: t.gamesLost || 0,
                gamesPlayed: t.gamesPlayed || 0, splitCount: t.splitCount || 0,
                challengeSplitCount: t.challengeSplitCount || 0, points: t.points || 0
            };
        });
        const _prevGamesPlayed = this._gameState.gamesPlayed || 0;
        const _prevHistoryLength = this._gameState.gameHistory?.length || 0;

        const winningTeam = teams[winnerIndex];
        const losingTeams = teams.filter((_, idx) => idx !== winnerIndex);

        // Resolve players from match teams - supports both old (players) and new (playerIds) format
        const winningPlayers = this._teams.getMatchTeamPlayers(winningTeam);
        const losingPlayers = losingTeams.flatMap(t => this._teams.getMatchTeamPlayers(t));

        // Get player IDs for normalized storage
        const winningPlayerIds = winningPlayers.map(p => p.id).filter(Boolean);
        const losingPlayerIds = losingPlayers.map(p => p.id).filter(Boolean);

        // Get unique team IDs
        const winningTeamIds = [...new Set(winningPlayers.map(p => p.teamId || p.originalTeamId).filter(Boolean))];
        const losingTeamIds = [...new Set(losingPlayers.map(p => p.teamId || p.originalTeamId).filter(Boolean))];

        // Count players per team on the winning side
        const winningTeamPlayerCounts = {};
        winningPlayers.forEach(player => {
            const teamId = player.teamId || player.originalTeamId;
            if (teamId) {
                winningTeamPlayerCounts[teamId] = (winningTeamPlayerCounts[teamId] || 0) + 1;
            }
        });

        // Only credit wins to teams with 2+ players on the winning side (full team representation)
        const teamsWithFullCredit = Object.entries(winningTeamPlayerCounts)
            .filter(([_, count]) => count >= 2)
            .map(([teamId]) => parseInt(teamId) || teamId);

        // Count players per team on the losing side
        const losingTeamPlayerCounts = {};
        losingPlayers.forEach(player => {
            const teamId = player.teamId || player.originalTeamId;
            if (teamId) {
                losingTeamPlayerCounts[teamId] = (losingTeamPlayerCounts[teamId] || 0) + 1;
            }
        });

        // Only credit losses to teams with 2+ players on losing side (full team representation)
        // This mirrors the win logic - split teams (with players on both sides) get neither win nor loss
        const teamsWithFullLoss = Object.entries(losingTeamPlayerCounts)
            .filter(([_, count]) => count >= 2)
            .map(([teamId]) => parseInt(teamId) || teamId);

        // Update team win/loss counts - only for non-challenge matches with full representation
        // Challenge matches don't affect team win/loss records
        const isChallenge = this._selectedQueuedGame.isChallenge === true;
        if (!isChallenge) {
            teamsWithFullCredit.forEach(teamId => {
                const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesWon = (team.gamesWon || 0) + 1;
                    team.gamesPlayed = (team.gamesPlayed || 0) + 1;
                    // Award victory point immediately on match win
                    team.points = (team.points || 0) + 1;
                }
            });

            teamsWithFullLoss.forEach(teamId => {
                const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesLost = (team.gamesLost || 0) + 1;
                    team.gamesPlayed = (team.gamesPlayed || 0) + 1;
                }
            });
        }

        // Get winning side label
        const winningSideLabel = `TEAM_${SIDE_LABELS_RM[winnerIndex] || winnerIndex}`;

        // Calculate match duration if match had a start time
        const now = new Date();
        const startedAt = this._selectedQueuedGame.startedAt || this._selectedQueuedGame.ongoingAt;
        let matchDuration = null;
        if (startedAt) {
            const startTime = new Date(startedAt);
            const durationMs = now - startTime;
            matchDuration = {
                startedAt: startedAt,
                endedAt: now.toISOString(),
                durationMinutes: Math.round(durationMs / 60000)
            };
        }

        // Create team stats snapshot for historical tracking
        const teamStatsSnapshot = {};
        this._gameState.teams.forEach(team => {
            const hexCount = Object.values(this._gameState.board || {}).filter(t => t === team.id).length;
            teamStatsSnapshot[team.id] = {
                points: team.points || 0,
                gamesWon: team.gamesWon || 0,
                hexCount: hexCount
            };
        });

        // Create history entry
        const historyEntry = {
            id: (this._gameState.gameHistory?.length || 0) + 1,
            matchNumber: this._selectedQueuedGame.matchNumber,
            game: this._selectedQueuedGame.game,
            playType: this._selectedQueuedGame.playType,
            winningSide: winningSideLabel,
            winnerIndex: winnerIndex,
            winningTeamIds: winningTeamIds,
            losingTeamIds: losingTeamIds,
            // Normalized: store player IDs only (names resolved from registry at display time)
            winningPlayerIds: winningPlayerIds,
            losingPlayerIds: losingPlayerIds,
            queuedGameId: this._selectedQueuedGame.id,
            // Rotation tracking for fairness
            splitTeamId: this._selectedQueuedGame.splitTeamId,
            splitTeamName: this._selectedQueuedGame.splitTeamName,
            rotationIndex: this._selectedQueuedGame.rotationIndex,
            autoGenerated: this._selectedQueuedGame.autoGenerated,
            // Challenge flag and disputing teams - carried over from queue entry
            isChallenge: this._selectedQueuedGame.isChallenge || false,
            disputingTeamIds: this._selectedQueuedGame.disputingTeamIds || null,
            disputingSideA: this._selectedQueuedGame.disputingSideA || null,
            disputingSideB: this._selectedQueuedGame.disputingSideB || null,
            timestamp: now.toISOString(),

            // Enhanced statistics fields
            matchDuration: matchDuration,
            tournamentRound: this._gameState.currentRound || 1,
            matchNumberInRound: ((this._gameState.gameHistory?.length || 0) % (this._gameState.teams?.length || 5)) + 1,
            teamStatsSnapshot: teamStatsSnapshot,
            challengeHexCoord: this._selectedQueuedGame.challengeHexCoord || null
        };

        this._gameState.gameHistory = this._gameState.gameHistory || [];
        this._gameState.gameHistory.push(historyEntry);

        // Mark queue entry as completed
        const queueEntry = this._gameState.gameQueue.find(g => g.id === this._selectedQueuedGame.id);
        if (queueEntry) {
            queueEntry.status = 'completed';
            queueEntry.completedAt = new Date().toISOString();
            queueEntry.winningSide = winningSideLabel;
            queueEntry.winnerIndex = winnerIndex;

            // Send this match's players back to the waiting room. Not
            // awaited — a Discord failure must never block result saving.
            window.DiscordCommands?.request('return', {
                slot: queueEntry.isChallenge ? 'challenge' : queueEntry.slot,
                matchId: queueEntry.id
            });
        }

        // Update games played
        this._gameState.gamesPlayed = (this._gameState.gamesPlayed || 0) + 1;

        // Increment split count for the team that was split in this match
        // (only for non-challenge matches, as challenges don't follow rotation)
        if (this._selectedQueuedGame.splitTeamId && !this._selectedQueuedGame.isChallenge) {
            const splitTeam = this._gameState.teams.find(t => String(t.id) === String(this._selectedQueuedGame.splitTeamId));
            if (splitTeam) {
                splitTeam.splitCount = (splitTeam.splitCount || 0) + 1;
            }
        }

        // For challenge matches, detect and increment challengeSplitCount for teams with players on both sides
        if (this._selectedQueuedGame.isChallenge) {
            // Find teams that have players on both winning and losing sides (split teams)
            const challengeSplitTeamIds = winningTeamIds.filter(teamId =>
                losingTeamIds.some(losingId => String(losingId) === String(teamId))
            );

            challengeSplitTeamIds.forEach(teamId => {
                const splitTeam = this._gameState.teams.find(t => String(t.id) === String(teamId));
                if (splitTeam) {
                    splitTeam.challengeSplitCount = (splitTeam.challengeSplitCount || 0) + 1;
                }
            });
        }

        // Save match number before resetting
        const confirmedMatchNumber = queueEntry?.matchNumber;

        // Reset selection
        const logMatchNumber = queueEntry?.matchNumber;
        const logGameName = this._teams.getGameDisplayName(queueEntry?.game || 'game');
        const logIsChallenge = queueEntry?.isChallenge || false;

        this._selectedQueuedGame = null;

        await this._save();

        // Log game win event
        // Get team names only for teams that got full credit (2+ players on winning side)
        const creditedTeamNames = teamsWithFullCredit.map(teamId => {
            const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
            return team?.name || `Team ${teamId}`;
        });
        const displayTeamName = creditedTeamNames.length > 0
            ? creditedTeamNames.join(' & ')
            : `Team ${SIDE_LABELS_RM[winnerIndex]} (mixed)`;
        const firstWinnerTeamId = winningPlayers[0]?.teamId || winningPlayers[0]?.originalTeamId;
        const teamColor = winningPlayers[0]?.teamColor || winningPlayers[0]?.originalTeamColor || this._teams.getTeamColor(firstWinnerTeamId);

        // Build winningPlayers array for event log display
        const winningPlayersForLog = winningPlayers.map(p => ({
            id: p.id,
            name: p.name,
            originalTeamId: p.teamId || p.originalTeamId,
            originalTeamName: p.teamName || p.originalTeamName,
            originalTeamColor: p.teamColor || p.originalTeamColor
        }));

        // Build losingPlayers array for event log display (for view results)
        const losingPlayersForLog = losingPlayers.map(p => ({
            id: p.id,
            name: p.name,
            originalTeamId: p.teamId || p.originalTeamId,
            originalTeamName: p.teamName || p.originalTeamName,
            originalTeamColor: p.teamColor || p.originalTeamColor
        }));

        // Identify split team (team with only 1 player on winning side)
        const splitTeamIds = Object.entries(winningTeamPlayerCounts)
            .filter(([_, count]) => count === 1)
            .map(([teamId]) => parseInt(teamId) || teamId);

        const splitTeamNames = splitTeamIds.map(teamId => {
            const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
            return team?.name || `Team ${teamId}`;
        });

        // Build all teams' player data for 3-team matches (stored as separate fields to avoid nested arrays)
        const matchTeams = queueEntry?.teams || [];
        const sideAPlayers = matchTeams[0] ? this._teams.getMatchTeamPlayers(matchTeams[0]).map(p => ({
            id: p.id,
            name: p.name,
            originalTeamId: p.teamId || p.originalTeamId,
            originalTeamName: p.teamName || p.originalTeamName,
            originalTeamColor: p.teamColor || p.originalTeamColor
        })) : [];
        const sideBPlayers = matchTeams[1] ? this._teams.getMatchTeamPlayers(matchTeams[1]).map(p => ({
            id: p.id,
            name: p.name,
            originalTeamId: p.teamId || p.originalTeamId,
            originalTeamName: p.teamName || p.originalTeamName,
            originalTeamColor: p.teamColor || p.originalTeamColor
        })) : [];
        const sideCPlayers = matchTeams[2] ? this._teams.getMatchTeamPlayers(matchTeams[2]).map(p => ({
            id: p.id,
            name: p.name,
            originalTeamId: p.teamId || p.originalTeamId,
            originalTeamName: p.teamName || p.originalTeamName,
            originalTeamColor: p.teamColor || p.originalTeamColor
        })) : [];

        this._logEvent('game_win', {
            teamName: displayTeamName,
            teamId: teamsWithFullCredit[0] || winningTeamIds[0],
            teamColor: teamColor,
            gameName: logGameName,
            matchNumber: logMatchNumber,
            isChallenge: logIsChallenge,
            winningSide: SIDE_LABELS_RM[winnerIndex],
            playType: queueEntry?.playType || '',
            // Include full player arrays for view results display
            winningPlayers: winningPlayersForLog,
            losingPlayers: losingPlayersForLog,
            winningPlayerIds: winningPlayerIds,
            losingPlayerIds: losingPlayerIds,
            teamsWithFullCredit: teamsWithFullCredit,
            // Split team info for "with the help of" message
            splitTeamIds: splitTeamIds,
            splitTeamNames: splitTeamNames,
            // All teams data for 3-team matches (separate fields to avoid nested arrays)
            teamsCount: matchTeams.length || 2,
            sideAPlayers: sideAPlayers,
            sideBPlayers: sideBPlayers,
            sideCPlayers: sideCPlayers.length > 0 ? sideCPlayers : undefined
        });

        this._logAction('match_result_confirmed', 'match', {
            matchId: queueEntry?.id, matchNumber: confirmedMatchNumber,
            game: logGameName, gameName: logGameName,
            winningSide: SIDE_LABELS_RM[winnerIndex],
            winningTeamIds, losingTeamIds, teamsWithFullCredit, teamsWithFullLoss,
            teamId: teamsWithFullCredit[0] || winningTeamIds[0],
            teamName: displayTeamName,
            isChallenge: logIsChallenge,
            playType: queueEntry?.playType || '',
            historyEntryId: historyEntry.id
        }, {
            queueEntry: { id: queueEntry?.id, status: 'ongoing', winnerIndex: undefined },
            teamStats: _prevTeamStats,
            gamesPlayed: _prevGamesPlayed,
            gameHistoryLength: _prevHistoryLength
        });

        const matchNumMsg = confirmedMatchNumber ? ` (Match #${confirmedMatchNumber})` : '';
        this._ui.showStatus(`Result confirmed! Team ${SIDE_LABELS_RM[winnerIndex] || winnerIndex} wins${matchNumMsg}!`, 'success');

        // Track pending hex win - remind admin to place hex
        // Challenge matches don't grant hex placement
        if (!logIsChallenge) {
            const pendingHexTeamIds = teamsWithFullCredit.length > 0 ? teamsWithFullCredit : winningTeamIds;
            const pendingHexTeamNames = pendingHexTeamIds.map(teamId => {
                const team = this._gameState.teams.find(t => String(t.id) === String(teamId));
                return team?.name || `Team ${teamId}`;
            });

            this._pendingHexWins.push({
                matchNumber: confirmedMatchNumber,
                teamNames: pendingHexTeamNames.length > 0 ? pendingHexTeamNames : [`Team ${SIDE_LABELS_RM[winnerIndex]}`],
                teamIds: pendingHexTeamIds.length > 0 ? pendingHexTeamIds : winningTeamIds,
                isChallenge: false,
                timestamp: new Date().toISOString()
            });

            // Show persistent reminder
            this.updatePendingHexNotification();

            // Persist immediately — the `await this._save()` earlier in this
            // method runs BEFORE this push, so without this second save the
            // pending win would only ever live in memory (see the
            // _pendingHexWins accessor doc above for why that's the actual
            // gate-bypass bug, not just a cosmetic notification gap).
            await this._save();
        }

        this._onPhaseChanged();
    }

    // ------------------------------------------------------------------
    // Pending hex notifications
    // ------------------------------------------------------------------

    /**
     * Update the pending hex notification banner.
     * Shows when teams have won matches but haven't placed their hex yet.
     */
    updatePendingHexNotification() {
        let banner = document.getElementById('pendingHexBanner');

        if (this._pendingHexWins.length === 0) {
            if (banner) banner.remove();
            return;
        }

        // Create banner if it doesn't exist
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'pendingHexBanner';
            banner.className = 'pending-hex-banner';

            // Insert after the page's top status/phase bar. admin.html has
            // `.top-bar` (admin.js's own near-identical copy of this
            // function uses that selector, correctly, since it only ever
            // runs on admin.html) — but god.html (this ResultManager class's
            // only consumer) has no `.top-bar` element at all, so this
            // selector never matched here and the banner was being created
            // in memory but never actually appended to the DOM, silently,
            // on every call. Found while building
            // e2e-pending-hex-persistence.js (TODO.md Task 15): pending
            // counts/gate state were correct, but nothing was ever visible.
            // `#phaseIndicatorBar` is god.html's equivalent top bar; fall
            // back to prepending to <body> if even that's missing so the
            // banner is never silently dropped again.
            const anchor = document.querySelector('.top-bar') || document.getElementById('phaseIndicatorBar');
            if (anchor) {
                anchor.after(banner);
            } else {
                document.body.prepend(banner);
            }
        }

        // Build banner content with team colors
        const pendingList = this._pendingHexWins.map(win => {
            const matchNum = win.matchNumber ? `Match #${win.matchNumber}` : 'Match';

            // Build colored team names
            const coloredTeams = win.teamIds.map((teamId, idx) => {
                const teamName = win.teamNames[idx] || `Team ${teamId}`;
                const team = this._gameState?.teams?.find(t => String(t.id) === String(teamId));
                const color = team?.color || this._teams.getTeamColor(teamId) || 'var(--accent-primary)';
                return `<span class="pending-hex-team" style="color: ${color}; border-left-color: ${color}">${teamName}</span>`;
            }).join('');

            return `<span class="pending-hex-item">${matchNum}: ${coloredTeams}</span>`;
        }).join('');

        banner.innerHTML = `
            <span class="pending-hex-icon">${ICON_SVGS.triangleAlert}</span>
            <span class="pending-hex-text">Pending hex placement:</span>
            ${pendingList}
        `;
    }

    /**
     * Clear a pending hex win when a team places their hex.
     * Called from assignTeamToHex when a hex is assigned.
     * Only removes ONE notification per hex placed (the oldest one for this team).
     * @param {string|number} teamId
     */
    async clearPendingHexWin(teamId) {
        let changed = false;

        // Find the FIRST (oldest) pending hex win that includes this team
        // Only remove from one entry per hex placed
        for (let i = 0; i < this._pendingHexWins.length; i++) {
            const win = this._pendingHexWins[i];
            const idx = win.teamIds.findIndex(id => String(id) === String(teamId));
            if (idx !== -1) {
                win.teamIds.splice(idx, 1);
                // Also remove the corresponding team name
                if (win.teamNames && win.teamNames[idx] !== undefined) {
                    win.teamNames.splice(idx, 1);
                }
                changed = true;
                break; // Only remove from the first matching entry
            }
        }

        // Remove entries where all teams have placed their hexes
        const beforeCount = this._pendingHexWins.length;
        this._pendingHexWins = this._pendingHexWins.filter(win => win.teamIds.length > 0);

        if (changed || this._pendingHexWins.length !== beforeCount) {
            this.updatePendingHexNotification();
            this._onPhaseChanged();
            // Persist the clear \u2014 see the persistence note on the
            // _pendingHexWins accessor above.
            await this._save();
        }
    }

    // ------------------------------------------------------------------
    // Result Correction
    // ------------------------------------------------------------------

    /**
     * Open the Correct Result modal for a completed match.
     * @param {number} matchId - Queue entry ID
     */
    openCorrectResultModal(matchId) {
        const gs = this._gameState;
        const queueEntry = (gs.gameQueue || []).find(g => g.id === matchId);
        if (!queueEntry) {
            this._ui.showStatus('Match not found', 'warning');
            return;
        }
        if (queueEntry.status !== 'completed') {
            this._ui.showStatus('Only completed matches can be corrected', 'warning');
            return;
        }

        const teams = queueEntry.teams || [];
        const gameName = this._teams.getGameDisplayName(queueEntry.game || 'Unknown');
        const matchNum = queueEntry.matchNumber ? `#${queueEntry.matchNumber}` : '';
        const currentWinner = queueEntry.winnerIndex;

        // Build modal content
        const matchInfoEl = document.getElementById('correctResultMatchInfo');
        const teamsEl = document.getElementById('correctResultTeams');

        if (matchInfoEl) {
            matchInfoEl.innerHTML = `
                <span class="history-match-num">${matchNum}</span>
                <span class="history-game-name">${gameName}</span>
                ${queueEntry.isChallenge ? '<span class="challenge-badge">CHALLENGE</span>' : ''}
            `;
        }

        if (teamsEl) {
            teamsEl.innerHTML = teams.map((team, idx) => {
                const players = this._teams.getMatchTeamPlayers(team);
                const playersHtml = players.map(p => {
                    const color = p.teamColor || p.originalTeamColor || this._teams.getTeamColor(p.teamId || p.originalTeamId) || '#666';
                    return `<span class="queue-player" style="--player-color: ${color}">${p.name || 'Unknown'}</span>`;
                }).join('');

                const label = SIDE_LABELS_RM[idx] || (idx + 1);
                const isCurrent = idx === currentWinner;

                return `
                    <div class="correct-result-team ${isCurrent ? 'current-winner' : ''}"
                         onclick="selectCorrectedWinner(${matchId}, ${idx})">
                        <div class="correct-result-team-header">
                            <span class="correct-result-side">Team ${label}</span>
                            ${isCurrent ? '<span class="correct-result-current">Current Winner</span>' : ''}
                        </div>
                        <div class="correct-result-players">${playersHtml}</div>
                    </div>
                `;
            }).join('');
        }

        // Store match ID and reset reason
        const reasonInput = document.getElementById('correctResultReason');
        if (reasonInput) reasonInput.value = '';
        this._correctMatchId = matchId;
        this._correctNewWinner = null;

        const modal = document.getElementById('correctResultModal');
        if (modal) modal.style.display = 'flex';
    }

    /**
     * Select a new winner in the correction modal.
     */
    selectCorrectedWinner(matchId, winnerIndex) {
        this._correctNewWinner = winnerIndex;

        // Update visual selection
        const teamsEl = document.getElementById('correctResultTeams');
        if (teamsEl) {
            teamsEl.querySelectorAll('.correct-result-team').forEach((el, idx) => {
                el.classList.toggle('selected', idx === winnerIndex);
            });
        }

        // Enable confirm button
        const confirmBtn = document.getElementById('confirmCorrectResultBtn');
        if (confirmBtn) confirmBtn.disabled = false;
    }

    closeCorrectResultModal() {
        const modal = document.getElementById('correctResultModal');
        if (modal) modal.style.display = 'none';
        this._correctMatchId = null;
        this._correctNewWinner = null;
    }

    /**
     * Apply the result correction: reverse old stats, apply new stats,
     * update queue entry + history entry, save, and log.
     */
    async confirmCorrectResult() {
        const matchId = this._correctMatchId;
        const newWinnerIndex = this._correctNewWinner;
        const reason = document.getElementById('correctResultReason')?.value?.trim() || '';

        if (matchId == null || newWinnerIndex == null) {
            this._ui.showStatus('Select a new winner first', 'warning');
            return;
        }

        const gs = this._gameState;
        const queueEntry = (gs.gameQueue || []).find(g => g.id === matchId);
        if (!queueEntry || queueEntry.status !== 'completed') {
            this._ui.showStatus('Match not found or not completed', 'error');
            this.closeCorrectResultModal();
            return;
        }

        const oldWinnerIndex = queueEntry.winnerIndex;
        if (oldWinnerIndex === newWinnerIndex) {
            this._ui.showStatus('Same winner selected — no change needed', 'info');
            this.closeCorrectResultModal();
            return;
        }

        const teams = queueEntry.teams || [];
        const isChallenge = queueEntry.isChallenge === true;

        // --- Snapshot pre-correction state ---
        const prevTeamStats = {};
        gs.teams.forEach(t => {
            prevTeamStats[t.id] = {
                gamesWon: t.gamesWon || 0, gamesLost: t.gamesLost || 0,
                gamesPlayed: t.gamesPlayed || 0, points: t.points || 0
            };
        });

        // --- Reverse old result (only for non-challenge) ---
        if (!isChallenge) {
            const oldWinningTeam = teams[oldWinnerIndex];
            const oldLosingTeams = teams.filter((_, idx) => idx !== oldWinnerIndex);

            // Get old winning team IDs with 2+ player credit
            const oldWinPlayers = this._teams.getMatchTeamPlayers(oldWinningTeam);
            const oldWinCounts = {};
            oldWinPlayers.forEach(p => {
                const tid = p.teamId || p.originalTeamId;
                if (tid) oldWinCounts[tid] = (oldWinCounts[tid] || 0) + 1;
            });
            const oldFullCreditTeams = Object.entries(oldWinCounts)
                .filter(([_, c]) => c >= 2).map(([tid]) => parseInt(tid) || tid);

            // Get old losing team IDs with 2+ player loss
            const oldLosePlayers = oldLosingTeams.flatMap(t => this._teams.getMatchTeamPlayers(t));
            const oldLoseCounts = {};
            oldLosePlayers.forEach(p => {
                const tid = p.teamId || p.originalTeamId;
                if (tid) oldLoseCounts[tid] = (oldLoseCounts[tid] || 0) + 1;
            });
            const oldFullLossTeams = Object.entries(oldLoseCounts)
                .filter(([_, c]) => c >= 2).map(([tid]) => parseInt(tid) || tid);

            // Reverse old wins (and VP)
            oldFullCreditTeams.forEach(teamId => {
                const team = gs.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesWon = Math.max(0, (team.gamesWon || 0) - 1);
                    team.gamesPlayed = Math.max(0, (team.gamesPlayed || 0) - 1);
                    team.points = Math.max(0, (team.points || 0) - 1);
                }
            });

            // Reverse old losses
            oldFullLossTeams.forEach(teamId => {
                const team = gs.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesLost = Math.max(0, (team.gamesLost || 0) - 1);
                    team.gamesPlayed = Math.max(0, (team.gamesPlayed || 0) - 1);
                }
            });

            // --- Apply new result ---
            const newWinningTeam = teams[newWinnerIndex];
            const newLosingTeams = teams.filter((_, idx) => idx !== newWinnerIndex);

            const newWinPlayers = this._teams.getMatchTeamPlayers(newWinningTeam);
            const newWinCounts = {};
            newWinPlayers.forEach(p => {
                const tid = p.teamId || p.originalTeamId;
                if (tid) newWinCounts[tid] = (newWinCounts[tid] || 0) + 1;
            });
            const newFullCreditTeams = Object.entries(newWinCounts)
                .filter(([_, c]) => c >= 2).map(([tid]) => parseInt(tid) || tid);

            const newLosePlayers = newLosingTeams.flatMap(t => this._teams.getMatchTeamPlayers(t));
            const newLoseCounts = {};
            newLosePlayers.forEach(p => {
                const tid = p.teamId || p.originalTeamId;
                if (tid) newLoseCounts[tid] = (newLoseCounts[tid] || 0) + 1;
            });
            const newFullLossTeams = Object.entries(newLoseCounts)
                .filter(([_, c]) => c >= 2).map(([tid]) => parseInt(tid) || tid);

            // Apply new wins (and VP)
            newFullCreditTeams.forEach(teamId => {
                const team = gs.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesWon = (team.gamesWon || 0) + 1;
                    team.gamesPlayed = (team.gamesPlayed || 0) + 1;
                    team.points = (team.points || 0) + 1;
                }
            });

            // Apply new losses
            newFullLossTeams.forEach(teamId => {
                const team = gs.teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesLost = (team.gamesLost || 0) + 1;
                    team.gamesPlayed = (team.gamesPlayed || 0) + 1;
                }
            });
        }

        // --- Update queue entry ---
        const newSideLabel = `TEAM_${SIDE_LABELS_RM[newWinnerIndex] || newWinnerIndex}`;
        queueEntry.winnerIndex = newWinnerIndex;
        queueEntry.winningSide = newSideLabel;
        queueEntry.corrected = true;
        queueEntry.correctedAt = new Date().toISOString();
        queueEntry.correctionReason = reason;
        queueEntry.originalWinnerIndex = oldWinnerIndex;

        // --- Update history entry ---
        const historyEntry = (gs.gameHistory || []).find(h =>
            h.matchNumber === queueEntry.matchNumber || h.queuedGameId === matchId
        );
        if (historyEntry) {
            historyEntry.winnerIndex = newWinnerIndex;
            historyEntry.winningSide = newSideLabel;
            historyEntry.corrected = true;
            historyEntry.correctedAt = new Date().toISOString();
            historyEntry.correctionReason = reason;
            historyEntry.originalWinnerIndex = oldWinnerIndex;

            // Re-resolve player IDs for new winner
            const newWinTeam = teams[newWinnerIndex];
            const newLoseTeams = teams.filter((_, idx) => idx !== newWinnerIndex);
            historyEntry.winningPlayerIds = this._teams.getMatchTeamPlayers(newWinTeam).map(p => p.id).filter(Boolean);
            historyEntry.losingPlayerIds = newLoseTeams.flatMap(t => this._teams.getMatchTeamPlayers(t)).map(p => p.id).filter(Boolean);
            historyEntry.winningTeamIds = [...new Set(this._teams.getMatchTeamPlayers(newWinTeam).map(p => p.teamId || p.originalTeamId).filter(Boolean))];
            historyEntry.losingTeamIds = [...new Set(newLoseTeams.flatMap(t => this._teams.getMatchTeamPlayers(t)).map(p => p.teamId || p.originalTeamId).filter(Boolean))];
        }

        await this._save();

        this._logAction('match_result_corrected', 'match', {
            matchId, matchNumber: queueEntry.matchNumber,
            game: queueEntry.game,
            oldWinnerIndex, newWinnerIndex,
            oldWinningSide: `TEAM_${SIDE_LABELS_RM[oldWinnerIndex]}`,
            newWinningSide: newSideLabel,
            reason, isChallenge
        }, { teamStats: prevTeamStats, queueEntry: { winnerIndex: oldWinnerIndex, winningSide: `TEAM_${SIDE_LABELS_RM[oldWinnerIndex]}` } });

        this.closeCorrectResultModal();
        this._teams.renderTeamsList();
        this._ui.showStatus(
            `Match ${queueEntry.matchNumber ? '#' + queueEntry.matchNumber : ''} result corrected: Team ${SIDE_LABELS_RM[newWinnerIndex]} now wins`,
            'success'
        );
    }
}

window.ResultManager = ResultManager;
