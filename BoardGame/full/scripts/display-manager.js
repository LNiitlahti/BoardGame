/**
 * DisplayManager — Smart Display Engine for view.html (Full Version)
 *
 * Renders the lightweight-quality 1920×1080 infoscreen layout:
 * dual arena matches, territory map, hex board, queue, results, score strip.
 *
 * Phase 3 overlay features: phase-aware display modes with auto-rotation,
 * scoring ceremony sync, broadcast messages, active spell conditions.
 *
 * v2.0 — Rewritten to produce lightweight-quality HTML into lightweight DOM.
 */

// Display mode definitions — maps phase names to display configurations
const DISPLAY_MODES = {
    break: {
        name: 'Break',
        slides: ['next_match_large', 'standings_large', 'board_focus'],
        hidePanels: true
    },
    // ── Scoring phases ──
    scoring_vp: {
        name: 'Scoring: Victory Points',
        slides: ['results_large', 'standings_large'],
        hidePanels: true
    },
    scoring_hex: {
        name: 'Scoring: Hex',
        slides: ['board_focus', 'standings_large'],
        hidePanels: true
    },
    // ── Hex placement phases ──
    hex_placement_1: {
        name: 'Hex Placement — Game 1',
        slides: null,
        hidePanels: false
    },
    hex_placement_2: {
        name: 'Hex Placement — Game 2',
        slides: null,
        hidePanels: false
    },
    // ── Spell windows ──
    spell_window_1: { name: 'Spell Window', slides: null, hidePanels: false },
    spell_window_2: { name: 'Spell Window', slides: null, hidePanels: false },
    spell_window_3: { name: 'Spell Window', slides: null, hidePanels: false },
    spell_window_4: { name: 'Spell Window', slides: null, hidePanels: false },
    // ── Challenge phases ──
    challenges: {
        name: 'Challenges Issued',
        slides: null,
        hidePanels: false
    },
    challenge_game: {
        name: 'Challenge Game',
        slides: ['live_matches_large'],
        hidePanels: true
    },
    // ── Board resolved ──
    board_resolved: {
        name: 'Board Resolved',
        slides: ['board_focus'],
        hidePanels: true
    },
    // ── Matches In Progress — Match 1 / Match 2 run independently now, so
    // any of setup/lobby/playing can be true for either slot at once.
    // Rotate through all three slide types rather than picking one. ──
    matches_in_progress: {
        name: 'Matches In Progress',
        slides: ['live_matches_large', 'readiness_large', 'next_match_large'],
        hidePanels: true
    },
    // ── Round advance ──
    round_advance: {
        name: 'Round Advance',
        slides: ['results_large', 'standings_large'],
        hidePanels: true
    },
    // ── Tournament end ──
    tournament_end: {
        name: 'Tournament End',
        slides: ['winner_celebration', 'standings_large'],
        hidePanels: true
    }
};

class DisplayManager {

    /**
     * @param {Object} options
     * @param {HTMLElement} options.container        - Root container (document.body)
     * @param {BoardModule} options.boardModule      - Hex board math module
     * @param {BoardRenderer} options.boardRenderer  - SVG board renderer
     * @param {Function} [options.renderBoard]       - Board render callback (applies team colors to hexes)
     * @param {Function} [options.getResultLogCache] - Returns resultLogCache array
     * @param {Function} [options.getOnboardingState]- Returns onboardingState object
     * @param {Object} [options.matchStartTimes]     - Shared match start time tracker { match1, match2 }
     * @param {Object} [options.prevArenaSignatures]  - Shared arena diff signatures { match1, match2 }
     * @param {Object} [options.prevQueueSignature]   - Shared queue diff signature { value }
     * @param {Object} [options.prevResultIds]        - Shared result ids tracker { value }
     */
    constructor(options) {
        this._container = options.container;
        this._boardModule = options.boardModule;
        this._boardRenderer = options.boardRenderer;
        this._renderBoardFn = options.renderBoard || null;
        this._getResultLogCache = options.getResultLogCache || (() => []);
        this._getOnboardingState = options.getOnboardingState || (() => null);
        this._matchStartTimes = options.matchStartTimes || { match1: null, match2: null };
        this._prevArenaSignatures = options.prevArenaSignatures || { match1: null, match2: null };
        this._prevQueueSignature = options.prevQueueSignature || { value: null };
        this._prevResultIds = options.prevResultIds || { value: [] };
        this._gameData = null;

        // Display mode state
        this._currentMode = null;
        this._currentSlideIndex = 0;
        this._rotationTimer = null;
        this._rotationInterval = 15000;

        // URL param override for rotation interval
        const urlInterval = new URLSearchParams(window.location.search).get('rotateInterval');
        if (urlInterval) this._rotationInterval = parseInt(urlInterval, 10) || 15000;
    }

    // ==================================================================
    // Firebase snapshot handler
    // ==================================================================

    /**
     * Called on every Firestore snapshot. Orchestrates all rendering.
     * @param {Object} gameData - The tournament document data
     */
    onFirebaseSnapshot(gameData) {
        if (!gameData) {
            const title = document.getElementById('hTitle');
            if (title) title.textContent = 'Tournament Not Found';
            return;
        }

        this._gameData = gameData;

        // 1. Title
        const titleEl = document.getElementById('hTitle');
        if (titleEl) {
            titleEl.textContent = gameData.name || `Tournament ${this._tournamentId || ''}`;
        }

        // 2. Header stats
        this._updateHeaderStats(gameData);

        // 3. Team CSS variables
        this._applyTeamColors(gameData.teams);

        // 4. Score bars (territory map)
        this._renderScoreBars(gameData);

        // 5. Arena matches + queue
        this._renderArenaMatches(gameData);
        this._renderQueue(gameData);

        // 6. Results (from result log cache)
        this._renderResults();

        // 7. Score strip
        this._renderScoreStrip(gameData);

        // 8. Status strip — handled by local renderStatusStrip() in view.html
        //    (called directly by the onboarding listener)

        // 9. Board
        if (this._renderBoardFn) {
            this._renderBoardFn();
        } else if (this._boardRenderer && gameData.board) {
            this._boardRenderer.render(gameData);
        }

        // 10. Live indicator dot
        const dot = document.querySelector('.h-dot');
        if (dot) dot.style.background = '#10b981';

        // 11. Ceremony overlay (takes priority over display modes)
        this._renderCeremonyOverlay(gameData);

        // 12. Display mode engine
        const newMode = this._determineDisplayMode(gameData);
        if (newMode !== this._currentMode) {
            this._currentMode = newMode;
            this._applyDisplayMode(newMode, gameData);
        } else {
            this._refreshCurrentSlide(gameData);
        }

        // 13. Phase banner + conditions + broadcast
        this.renderPhaseDisplay(gameData);
        this._renderActiveConditions(gameData);
        this.renderBroadcastMessage(gameData);
    }

    setTournamentId(id) {
        this._tournamentId = id;
    }

    // ==================================================================
    // Utility methods (ported from lightweight view.html)
    // ==================================================================

    _getGameDisplayName(gameId) {
        if (window.GAMES_CONFIG) {
            return window.GAMES_CONFIG.getGameName(gameId);
        }
        if (this._gameData?.gameDefinitions?.[gameId]?.name) {
            return this._gameData.gameDefinitions[gameId].name;
        }
        return gameId || 'Unknown';
    }

    _getGameShortName(gameId) {
        if (window.GAMES_CONFIG) {
            return window.GAMES_CONFIG.getShortName(gameId);
        }
        if (this._gameData?.gameDefinitions?.[gameId]?.shortName) {
            return this._gameData.gameDefinitions[gameId].shortName;
        }
        return gameId ? gameId.substring(0, 4).toUpperCase() : '?';
    }

    _getGameImagePath(gameId) {
        if (window.GAMES_CONFIG) {
            const game = window.GAMES_CONFIG.games[gameId];
            if (game?.image) return window.GAMES_CONFIG.resolveImagePath(game.image);
        }
        if (this._gameData?.gameDefinitions?.[gameId]?.image) {
            const img = this._gameData.gameDefinitions[gameId].image;
            return img.startsWith('http') ? img : (window.BOARDGAME_BASE || '.') + '/' + img;
        }
        return null;
    }

    _getTeamColor(teamId) {
        if (teamId == null) return '#666666';
        if (this._gameData?.teams) {
            const team = this._gameData.teams.find(t => String(t.id) === String(teamId));
            if (team?.color) return team.color;
        }
        const TEAM_COLORS = window.TEAM_COLORS || {};
        return TEAM_COLORS[teamId] || '#666666';
    }

    _getCurrentTeamName(teamId) {
        if (teamId && this._gameData?.teams) {
            const team = this._gameData.teams.find(t => String(t.id) === String(teamId));
            if (team?.name) return team.name;
        }
        return '';
    }

    _getPlayerCurrentName(player) {
        if (!player) return 'Unknown';
        if (player.id && player.originalTeamId && this._gameData?.teams) {
            const team = this._gameData.teams.find(t => String(t.id) === String(player.originalTeamId));
            if (team?.players) {
                const currentPlayer = team.players.find(p => p.id === player.id);
                if (currentPlayer?.name) return currentPlayer.name;
            }
        }
        return player.name || 'Unknown';
    }

    _getPlayerCurrentColor(player) {
        if (!player) return '#666666';
        if (player.originalTeamId && this._gameData?.teams) {
            const team = this._gameData.teams.find(t => String(t.id) === String(player.originalTeamId));
            if (team?.color) return team.color;
        }
        return player.originalTeamColor || this._getTeamColor(player.originalTeamId) || '#666666';
    }

    _getMatchTeamPlayers(matchTeam) {
        if (!matchTeam) return [];

        // New format: playerIds array
        if (matchTeam.playerIds && Array.isArray(matchTeam.playerIds)) {
            return matchTeam.playerIds.map(playerId => {
                if (window.PlayerUtils) {
                    const info = window.PlayerUtils.getPlayerDisplayInfo(this._gameData, playerId);
                    return {
                        id: playerId,
                        name: info.name,
                        originalTeamId: info.teamId,
                        originalTeamColor: info.teamId ? this._getTeamColor(info.teamId) : '#666666'
                    };
                }
                if (this._gameData?.players?.[playerId]) {
                    const p = this._gameData.players[playerId];
                    return {
                        id: playerId,
                        name: p.name || 'Unknown',
                        originalTeamId: p.teamId,
                        originalTeamColor: p.teamId ? this._getTeamColor(p.teamId) : '#666666'
                    };
                }
                return { id: playerId, name: 'Unknown', originalTeamId: null, originalTeamColor: '#666666' };
            });
        }

        // Old format: players array
        if (matchTeam.players && Array.isArray(matchTeam.players)) {
            return matchTeam.players.map(p => ({
                id: p.id || null,
                name: p.name || 'Unknown',
                originalTeamId: p.originalTeamId,
                originalTeamColor: p.originalTeamColor || this._getTeamColor(p.originalTeamId) || '#666666'
            }));
        }

        return [];
    }

    _getTeamTotalPoints(team) {
        return (team.points || 0) + (team.gamesWon || 0);
    }

    _getPlayerWinCounts() {
        const wins = {};
        (this._gameData?.gameHistory || []).forEach(match => {
            (match.winningPlayerIds || []).forEach(id => {
                wins[id] = (wins[id] || 0) + 1;
            });
        });
        return wins;
    }

    _getMatchSignature(match) {
        if (!match) return null;
        const parts = [
            match.id, match.matchNumber, match.game, match.playType,
            match.status, match.winningSide || '',
            match.isBreak ? 'break' : '', match.breakLabel || ''
        ];
        if (match.teams) {
            match.teams.forEach(t => {
                parts.push(t.id);
                parts.push((t.playerIds || []).join(','));
            });
        }
        return parts.join('|');
    }

    // ==================================================================
    // Header stats
    // ==================================================================

    _updateHeaderStats(data) {
        const roundEl = document.getElementById('hRound');
        const gamesEl = document.getElementById('hGames');
        const queueEl = document.getElementById('hQueue');

        if (roundEl) {
            roundEl.textContent = data.currentPhase?.roundNumber || data.currentRound || '-';
        }

        const queue = data.gameQueue || [];
        const completed = queue.filter(m => m.status === 'completed' && !m.isBreak).length;
        const pending = queue.filter(m => m.status !== 'completed' && !m.isBreak).length;

        if (gamesEl) gamesEl.textContent = completed;
        if (queueEl) queueEl.textContent = pending;
    }

    // ==================================================================
    // Team colors (CSS variables)
    // ==================================================================

    _applyTeamColors(teams) {
        if (!teams) return;
        const root = document.documentElement;
        const TEAM_COLORS = window.TEAM_COLORS || {};

        teams.forEach(team => {
            const color = team.color || TEAM_COLORS[team.id];
            if (color) {
                root.style.setProperty(`--t${team.id}`, color);
                const hex = color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                root.style.setProperty(`--t${team.id}-hex`, `rgba(${r}, ${g}, ${b}, 1)`);
            }
        });
    }

    // ==================================================================
    // Score bars (territory map)
    // ==================================================================

    _renderScoreBars(data) {
        const container = document.getElementById('territoryMap');
        if (!container) return;

        const teams = data.teams || [];
        const victoryCondition = data.victoryCondition || 50;
        const sorted = [...teams].sort((a, b) => this._getTeamTotalPoints(b) - this._getTeamTotalPoints(a));
        const ticks = '<div class="tm-ticks"><div class="tm-tick" style="left:20%;"></div><div class="tm-tick" style="left:40%;"></div><div class="tm-tick" style="left:60%;"></div><div class="tm-tick" style="left:80%;"></div></div>';

        const rowsHtml = sorted.map(team => {
            const color = team.color || (window.TEAM_COLORS || {})[team.id];
            const hexPts = team.points || 0;
            const wins = team.gamesWon || 0;
            const totalPts = hexPts + wins;
            const pct = Math.min((totalPts / victoryCondition) * 100, 100);

            const segs = [];
            if (wins > 0) segs.push(`<div class="tm-seg w" style="flex:${wins};"></div>`);
            if (hexPts > 0) segs.push(`<div class="tm-seg h" style="flex:${hexPts};"></div>`);

            return `
                <div class="tm-row" style="--c: ${color};">
                    <div class="tm-name" style="color:${color};">${team.name || 'Team ' + team.id}</div>
                    <div class="tm-track">
                        <div class="tm-fill" style="width: ${pct}%;">${segs.join('')}</div>
                        ${ticks}
                    </div>
                    <div class="tm-pts">${totalPts}</div>
                </div>`;
        }).join('');

        // Preserve the header row, replace team rows
        const header = container.querySelector('.tm-header-row');
        container.innerHTML = '';
        if (header) container.appendChild(header);
        container.insertAdjacentHTML('beforeend', rowsHtml);
    }

    // ==================================================================
    // Arena matches (#match1, #match2)
    // ==================================================================

    _renderArenaMatches(data) {
        const queue = (data.gameQueue || []).filter(g => g.status !== 'completed');
        const sorted = [...queue].sort((a, b) => {
            if (a.status === 'ongoing' && b.status !== 'ongoing') return -1;
            if (a.status !== 'ongoing' && b.status === 'ongoing') return 1;
            return 0;
        });

        const ongoingMatches = sorted.filter(m => m.status === 'ongoing').slice(0, 2);
        this._renderArenaMatch('match1', ongoingMatches[0], 1);
        this._renderArenaMatch('match2', ongoingMatches[1], 2);
    }

    _renderArenaMatch(matchId, match, slotNum) {
        const matchEl = document.getElementById(matchId);
        if (!matchEl) return;

        // Skip rebuild if match hasn't structurally changed
        const newSig = this._getMatchSignature(match);
        if (newSig === this._prevArenaSignatures[matchId]) {
            if (match && match.startedAt) {
                this._matchStartTimes[matchId] = match.startedAt?.toDate
                    ? match.startedAt.toDate().getTime()
                    : new Date(match.startedAt).getTime();
            }
            return;
        }
        this._prevArenaSignatures[matchId] = newSig;

        if (!match) {
            matchEl.innerHTML = `
                <div class="match-complete-overlay">
                    <span class="match-complete-text">Match Complete</span>
                </div>
                <div class="a-side left" style="--side-color:var(--text-dim)">
                    <div class="a-players">
                        <div class="a-player" style="--pc:var(--text-dim)">
                            <span class="a-dot" style="background:var(--text-dim)"></span>
                            <div class="a-info"><span class="a-name" style="color:var(--text-dim)">Waiting...</span></div>
                        </div>
                    </div>
                </div>
                <div class="a-center">
                    <span class="a-game-name">No Match</span>
                    <span class="a-vs">VS</span>
                    <span class="a-format">\u2014</span>
                </div>
                <div class="a-side right" style="--side-color:var(--text-dim)">
                    <div class="a-players">
                        <div class="a-player" style="--pc:var(--text-dim)">
                            <span class="a-dot" style="background:var(--text-dim)"></span>
                            <div class="a-info"><span class="a-name" style="color:var(--text-dim)">Waiting...</span></div>
                        </div>
                    </div>
                </div>
            `;
            this._matchStartTimes[matchId] = null;
            return;
        }

        // Break entries
        if (match.isBreak === true) {
            const breakLabel = match.breakLabel || 'Break';
            const breakEmoji = match.breakEmoji || '\u23F8';

            if (match.startedAt?.toDate) {
                this._matchStartTimes[matchId] = match.startedAt.toDate().getTime();
            } else if (match.startedAt) {
                this._matchStartTimes[matchId] = new Date(match.startedAt).getTime();
            } else {
                this._matchStartTimes[matchId] = Date.now();
            }

            matchEl.classList.remove('three-team');
            matchEl.innerHTML = `
                <div class="match-complete-overlay">
                    <span class="match-complete-text">Break Over</span>
                </div>
                <div class="a-side left" style="--side-color:#f7ba32"></div>
                <div class="a-center">
                    <span class="a-live-badge" style="background:rgba(247,186,50,0.2);color:#f7ba32;border-color:rgba(247,186,50,0.4);">\u25CF BREAK</span>
                    <span class="a-game-name" style="font-size:48px;">${breakEmoji}</span>
                    <span class="a-vs" style="color:#f7ba32;">${breakLabel}</span>
                    <span class="a-timer">\u23F1 <span id="elapsed${slotNum}">00:00</span></span>
                </div>
                <div class="a-side right" style="--side-color:#f7ba32"></div>
            `;
            return;
        }

        const teams = match.teams || [];
        const gameName = this._getGameDisplayName(match.game);
        const playType = match.playType || '';

        // Set match start time
        if (match.startedAt?.toDate) {
            this._matchStartTimes[matchId] = match.startedAt.toDate().getTime();
        } else if (match.startedAt) {
            this._matchStartTimes[matchId] = new Date(match.startedAt).getTime();
        } else {
            this._matchStartTimes[matchId] = Date.now();
        }

        const buildSidePlayers = (teamData) => {
            const players = this._getMatchTeamPlayers(teamData);
            return players.map(p => {
                const color = this._getPlayerCurrentColor(p);
                const teamName = this._getCurrentTeamName(p.originalTeamId);
                return `
                    <div class="a-player" style="--pc:${color}">
                        <span class="a-dot" style="background:${color};color:${color}"></span>
                        <div class="a-info">
                            <span class="a-name" style="color:${color}">${this._getPlayerCurrentName(p)}</span>
                            <span class="a-team">${teamName}</span>
                        </div>
                    </div>
                `;
            }).join('');
        };

        const getDominantColor = (teamData) => {
            const players = this._getMatchTeamPlayers(teamData);
            if (players.length === 0) return 'var(--text-dim)';
            return this._getPlayerCurrentColor(players[0]);
        };

        const leftColor = getDominantColor(teams[0]);
        const rightColor = getDominantColor(teams[1]);
        const isThreeTeam = teams.length >= 3;

        matchEl.classList.toggle('three-team', isThreeTeam);

        if (isThreeTeam) {
            const thirdColor = getDominantColor(teams[2]);
            matchEl.innerHTML = `
                <div class="match-complete-overlay">
                    <span class="match-complete-text">Match Complete</span>
                </div>
                <div class="a-side left" style="--side-color:${leftColor}">
                    <div class="a-players">${buildSidePlayers(teams[0])}</div>
                </div>
                <div class="a-vs-divider"><span class="a-vs-small">VS</span></div>
                <div class="a-side center" style="--side-color:${rightColor}">
                    <div class="a-players">${buildSidePlayers(teams[1])}</div>
                </div>
                <div class="a-vs-divider"><span class="a-vs-small">VS</span></div>
                <div class="a-side right" style="--side-color:${thirdColor}">
                    <div class="a-players">${buildSidePlayers(teams[2])}</div>
                </div>
                <div style="position:absolute;top:calc(50% - 75px);left:50%;transform:translate(-50%,-50%);z-index:10;">
                    <span class="a-live-badge">\u25CF LIVE</span>
                </div>
                <div class="a-center" style="position:absolute;top:calc(50% + 100px);left:50%;transform:translate(-50%,-50%);width:auto;">
                    <span class="a-game-name">${gameName}</span>
                    <span class="a-format">${playType}</span>
                    <span class="a-timer">\u23F1 <span id="elapsed${slotNum}">00:00</span></span>
                </div>
            `;
        } else {
            matchEl.innerHTML = `
                <div class="match-complete-overlay">
                    <span class="match-complete-text">Match Complete</span>
                </div>
                <div class="a-side left" style="--side-color:${leftColor}">
                    <div class="a-players">${buildSidePlayers(teams[0])}</div>
                </div>
                <div class="a-center">
                    <span class="a-live-badge">\u25CF LIVE</span>
                    <span class="a-game-name">${gameName}</span>
                    <span class="a-vs">VS</span>
                    <span class="a-format">${playType}</span>
                    <span class="a-timer">\u23F1 <span id="elapsed${slotNum}">00:00</span></span>
                </div>
                <div class="a-side right" style="--side-color:${rightColor}">
                    <div class="a-players">${buildSidePlayers(teams[1])}</div>
                </div>
            `;
        }
    }

    // ==================================================================
    // Queue panel (#queueList)
    // ==================================================================

    _renderQueue(data) {
        const container = document.getElementById('queueList');
        if (!container) return;

        const queue = (data.gameQueue || []).filter(g => g.status !== 'completed');
        const pendingMatches = queue.filter(m => m.status !== 'ongoing');

        // Skip rebuild if queue hasn't changed
        const newQueueSig = pendingMatches.length === 0
            ? '__empty__'
            : pendingMatches.map(m => this._getMatchSignature(m)).join('||');
        if (newQueueSig === this._prevQueueSignature.value) return;
        this._prevQueueSignature.value = newQueueSig;

        if (pendingMatches.length === 0) {
            container.innerHTML = '<div class="q-card q-compact" style="opacity:0.5;text-align:center;padding:20px;">No upcoming matches</div>';
            return;
        }

        container.innerHTML = pendingMatches.map((match, idx) => {
            const isNext = idx === 0;

            // Break entries
            if (match.isBreak === true) {
                const breakLabel = match.breakLabel || 'Break';
                const breakEmoji = match.breakEmoji || '\u23F8';
                if (isNext) {
                    return `
                        <div class="q-card q-next break">
                            <div class="q-next-top">
                                <span class="q-next-game">${breakEmoji} ${breakLabel}</span>
                                <span class="q-next-badge">NEXT</span>
                            </div>
                            <div class="q-next-matchup" style="justify-content:center;">
                                <span style="font-size:36px;">${breakEmoji}</span>
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="q-card q-compact break">
                        <div class="qc-top">
                            <span class="qc-game">${breakEmoji} ${breakLabel}</span>
                        </div>
                    </div>
                `;
            }

            const isChallenge = match.isChallenge === true;
            const teams = match.teams || [];
            const gameName = this._getGameDisplayName(match.game);
            const playType = match.playType || '';
            const isThreeTeam = teams.length >= 3;

            if (isNext) {
                const buildNextSide = (teamData, sideClass) => {
                    const players = this._getMatchTeamPlayers(teamData);
                    const borderProp = sideClass === 'a' ? 'border-right-color' : 'border-left-color';
                    return players.map(p => {
                        const color = this._getPlayerCurrentColor(p);
                        return `<span class="q-next-name" style="color:${color};${borderProp}:${color}">${this._getPlayerCurrentName(p)}</span>`;
                    }).join('');
                };

                if (isThreeTeam) {
                    return `
                        <div class="q-card q-next ${isChallenge ? 'challenge' : ''}">
                            <div class="q-next-top">
                                <span class="q-next-game">${isChallenge ? '\u2694 ' : ''}${gameName}</span>
                                <span class="q-next-badge">NEXT</span>
                            </div>
                            <div class="q-next-matchup">
                                <div class="q-next-side a">${buildNextSide(teams[0], 'a')}</div>
                                <span class="q-next-vs">VS</span>
                                <div class="q-next-side" style="align-items:center">${buildNextSide(teams[1], 'b')}</div>
                                <span class="q-next-vs">VS</span>
                                <div class="q-next-side b">${buildNextSide(teams[2], 'b')}</div>
                            </div>
                        </div>
                    `;
                }

                return `
                    <div class="q-card q-next ${isChallenge ? 'challenge' : ''}">
                        <div class="q-next-top">
                            <span class="q-next-game">${isChallenge ? '\u2694 ' : ''}${gameName}</span>
                            <span class="q-next-badge">NEXT</span>
                        </div>
                        <div class="q-next-matchup">
                            <div class="q-next-side a">${buildNextSide(teams[0], 'a')}</div>
                            <span class="q-next-vs">VS</span>
                            <div class="q-next-side b">${buildNextSide(teams[1], 'b')}</div>
                        </div>
                    </div>
                `;
            }

            // Compact queued card
            const buildCompactSide = (teamData, sideClass) => {
                const players = this._getMatchTeamPlayers(teamData);
                const borderProp = sideClass === 'a' ? 'border-right-color' : 'border-left-color';
                return players.map(p => {
                    const color = this._getPlayerCurrentColor(p);
                    return `<span class="qc-name" style="color:${color};${borderProp}:${color}">${this._getPlayerCurrentName(p)}</span>`;
                }).join('');
            };

            if (isThreeTeam) {
                return `
                    <div class="q-card q-compact ${isChallenge ? 'challenge' : ''}">
                        <div class="qc-top">
                            <span class="qc-game">${isChallenge ? '\u2694 ' : ''}${this._getGameDisplayName(match.game)}${playType ? ' \u00B7 ' + playType : ''}</span>
                        </div>
                        <div class="qc-matchup">
                            <div class="qc-side a">${buildCompactSide(teams[0], 'a')}</div>
                            <span class="qc-vs">VS</span>
                            <div class="qc-side" style="align-items:center">${buildCompactSide(teams[1], 'b')}</div>
                            <span class="qc-vs">VS</span>
                            <div class="qc-side b">${buildCompactSide(teams[2], 'b')}</div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="q-card q-compact ${isChallenge ? 'challenge' : ''}">
                    <div class="qc-top">
                        <span class="qc-game">${isChallenge ? '\u2694 ' : ''}${this._getGameDisplayName(match.game)}${playType ? ' \u00B7 ' + playType : ''}</span>
                    </div>
                    <div class="qc-matchup">
                        <div class="qc-side a">${buildCompactSide(teams[0], 'a')}</div>
                        <span class="qc-vs">VS</span>
                        <div class="qc-side b">${buildCompactSide(teams[1], 'b')}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==================================================================
    // Results panel (#resultsList)
    // ==================================================================

    _renderResults() {
        const container = document.getElementById('resultsList');
        if (!container) return;

        const resultLogCache = this._getResultLogCache();
        const currentResults = resultLogCache.slice(0, 6);
        const formatTimeAgo = window.formatTimeAgo || ((d) => 'Just now');

        if (currentResults.length === 0) {
            if (this._prevResultIds.value.length > 0 || container.children.length === 0) {
                container.innerHTML = '<div class="r-card" style="opacity:0.5;text-align:center;padding:20px;">No results yet</div>';
                this._prevResultIds.value = [];
            }
            return;
        }

        const newIds = currentResults.map(e => e.id);

        // If results haven't changed, only refresh time-ago labels
        if (JSON.stringify(newIds) === JSON.stringify(this._prevResultIds.value)) {
            currentResults.forEach(event => {
                const card = container.querySelector('[data-result-id="' + event.id + '"]');
                if (!card) return;
                const timeEl = card.querySelector('.r-time');
                if (timeEl) {
                    timeEl.textContent = event.timestamp instanceof Date
                        ? formatTimeAgo(event.timestamp) : 'Just now';
                }
            });
            return;
        }

        // Find how many new results appeared at the front
        let newCount = 0;
        for (let i = 0; i < newIds.length; i++) {
            if (!this._prevResultIds.value.includes(newIds[i])) {
                newCount++;
            } else {
                break;
            }
        }

        if (newCount > 0 && newCount < currentResults.length && this._prevResultIds.value.length > 0) {
            // Prepend only the new cards
            const newCardsHTML = currentResults.slice(0, newCount)
                .map(event => this._buildResultCardHTML(event)).join('');

            const temp = document.createElement('div');
            temp.innerHTML = newCardsHTML;

            const fragment = document.createDocumentFragment();
            while (temp.firstChild) {
                fragment.appendChild(temp.firstChild);
            }
            container.insertBefore(fragment, container.firstChild);

            while (container.children.length > 6) {
                container.removeChild(container.lastChild);
            }
        } else {
            container.innerHTML = currentResults.map(event => this._buildResultCardHTML(event)).join('');
        }

        this._prevResultIds.value = newIds;
    }

    _buildResultCardHTML(event) {
        const formatTimeAgo = window.formatTimeAgo || ((d) => 'Just now');
        const time = event.timestamp instanceof Date
            ? formatTimeAgo(event.timestamp) : 'Just now';

        const gameName = event.gameName || 'Game';
        const isChallenge = event.isChallenge === true;

        const winningPlayers = event.winningPlayers || [];
        const losingPlayers = event.losingPlayers || [];
        const winningSide = event.winningSide || 'A';

        const playTypeRaw = event.playType || '';
        const hasThreeTeamFormat = /\d+v\d+v\d+/i.test(playTypeRaw);
        const hasSideCPlayers = event.sideCPlayers && event.sideCPlayers.length > 0;
        const isThreeTeam = event.teamsCount >= 3 || event.isThreeTeam || hasSideCPlayers || hasThreeTeamFormat;

        const playerCount = winningPlayers.length;
        const playType = playTypeRaw || (playerCount > 0 ? (isThreeTeam ? `${playerCount}v${playerCount}v${playerCount}` : `${playerCount}v${playerCount}`) : '');

        const buildResultPlayers = (players) => {
            if (!players || players.length === 0) {
                return '<span class="r-player" style="opacity:0.4">\u2014</span>';
            }
            return players.map(p => {
                const color = this._getTeamColor(p.originalTeamId) || p.originalTeamColor || '#888';
                const name = p.name || 'Player';
                return `<span class="r-player" style="color:${color}; border-bottom: 2px solid ${color}">${name}</span>`;
            }).join('');
        };

        const aWin = winningSide?.toUpperCase() === 'A';
        const bWin = winningSide?.toUpperCase() === 'B';
        const cWin = winningSide?.toUpperCase() === 'C';

        if (isThreeTeam) {
            const sideAPlayers = event.sideAPlayers || (aWin ? winningPlayers : losingPlayers);
            const sideBPlayers = event.sideBPlayers || (bWin ? winningPlayers : losingPlayers);
            const sideCPlayers = event.sideCPlayers || (cWin ? winningPlayers : []);

            return `
                <div class="r-card" data-result-id="${event.id}" ${isChallenge ? 'style="border-left: 3px solid var(--danger)"' : ''}>
                    <div class="r-top">
                        <span class="r-game">${isChallenge ? '\u2694 ' : ''}${gameName}${playType ? ' \u00B7 ' + playType : ''}</span>
                        <span class="r-time">${time}</span>
                    </div>
                    <div class="r-matchup" style="gap:4px;align-items:flex-start;">
                        <div class="r-side a ${aWin ? 'winner' : 'loser'}" style="flex:1;flex-direction:column;align-items:flex-end;gap:4px;">
                            <div class="r-names">${buildResultPlayers(sideAPlayers)}</div>
                            ${aWin ? '<span class="r-badge win">WIN</span>' : ''}
                        </div>
                        <div class="r-vs"><span class="r-score-sep">VS</span></div>
                        <div class="r-side ${bWin ? 'winner' : 'loser'}" style="flex:1;flex-direction:column;align-items:center;gap:4px;">
                            <div class="r-names" style="align-items:center;">${buildResultPlayers(sideBPlayers)}</div>
                            ${bWin ? '<span class="r-badge win">WIN</span>' : ''}
                        </div>
                        <div class="r-vs"><span class="r-score-sep">VS</span></div>
                        <div class="r-side b ${cWin ? 'winner' : 'loser'}" style="flex:1;flex-direction:column;align-items:flex-start;gap:4px;">
                            <div class="r-names">${buildResultPlayers(sideCPlayers)}</div>
                            ${cWin ? '<span class="r-badge win">WIN</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        const sideAPlayers = aWin ? winningPlayers : losingPlayers;
        const sideBPlayers = bWin ? winningPlayers : losingPlayers;

        return `
            <div class="r-card" data-result-id="${event.id}" ${isChallenge ? 'style="border-left: 3px solid var(--danger)"' : ''}>
                <div class="r-top">
                    <span class="r-game">${isChallenge ? '\u2694 ' : ''}${gameName}${playType ? ' \u00B7 ' + playType : ''}</span>
                    <span class="r-time">${time}</span>
                </div>
                <div class="r-matchup">
                    <div class="r-side a ${aWin ? 'winner' : 'loser'}">
                        ${aWin ? '<span class="r-badge win">WIN</span>' : ''}
                        <div class="r-names">${buildResultPlayers(sideAPlayers)}</div>
                        ${!aWin ? '<span class="r-badge loss">LOSS</span>' : ''}
                    </div>
                    <div class="r-vs">
                        <span class="r-score-sep">VS</span>
                    </div>
                    <div class="r-side b ${bWin ? 'winner' : 'loser'}">
                        ${!bWin ? '<span class="r-badge loss">LOSS</span>' : ''}
                        <div class="r-names">${buildResultPlayers(sideBPlayers)}</div>
                        ${bWin ? '<span class="r-badge win">WIN</span>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // ==================================================================
    // Score strip (#scoreStrip)
    // ==================================================================

    _renderScoreStrip(data) {
        const teams = data.teams || [];
        const container = document.getElementById('scoreStrip');
        if (!container) return;

        const playerWins = this._getPlayerWinCounts();

        container.innerHTML = teams.map(team => {
            const color = team.color || (window.TEAM_COLORS || {})[team.id];
            const players = team.players || [];
            const hexPts = team.points || 0;
            const victoryPts = team.gamesWon || 0;
            const totalPts = hexPts + victoryPts;

            const playersHtml = players.map((p, i) => {
                const w = p.id ? (playerWins[p.id] || 0) : 0;
                const sep = i < players.length - 1 ? '<span class="sc-psep">&middot;</span>' : '';
                return `<div class="sc-player"><span class="sc-pname">${p.name || 'Player'}</span><span class="sc-pstar"><span class="star">\u2605</span><span class="pcount">${w}</span></span></div>${sep}`;
            }).join('');

            return `
                <div class="sc" style="--c: ${color};">
                    <div class="sc-tname-area"><span class="sc-tname">${team.name || 'Team ' + team.id}</span></div>
                    <div class="sc-players-area">${playersHtml}</div>
                    <div class="sc-score-area">
                        <span class="sc-score-num w">${victoryPts}</span>
                        <span class="sc-score-num pts">${hexPts}</span>
                        <span class="sc-score-num total">${totalPts}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==================================================================
    // Status strip (#statusStrip — onboarding emojis)
    // ==================================================================

    _renderStatusStrip() {
        const strip = document.getElementById('statusStrip');
        if (!strip) return;

        const onboardingState = this._getOnboardingState();
        if (!onboardingState?.statuses) {
            strip.innerHTML = '';
            return;
        }

        const STATUS_EMOJIS = { eating: '\uD83C\uDF54', smoking: '\uD83D\uDEAC', wc: '\uD83D\uDEBD', sleeping: '\uD83D\uDE34', alert: '\u2757', question: '\u2753' };
        const teams = this._gameData?.teams || [];

        let html = '';
        for (const [playerId, statusObj] of Object.entries(onboardingState.statuses)) {
            const status = statusObj?.status;
            if (!status || status === 'available') continue;

            const emoji = STATUS_EMOJIS[status] || '\u2753';

            // Find player name and team color
            let playerName = playerId;
            let teamColor = '#888';
            for (const team of teams) {
                const player = (team.players || []).find(p =>
                    String(p.id) === String(playerId) || String(p.uid) === String(playerId)
                );
                if (player) {
                    playerName = player.name || playerId;
                    teamColor = team.color || '#888';
                    break;
                }
            }

            html += `<span class="ss-item" style="color:${teamColor}">${emoji} ${playerName}</span>`;
        }

        strip.innerHTML = html;
    }

    // ==================================================================
    // Phase display (banner injected after header)
    // ==================================================================

    renderPhaseDisplay(data) {
        const phaseName = data.currentPhase?.name;

        let phaseBanner = document.getElementById('phaseBanner');
        if (!phaseBanner) {
            phaseBanner = document.createElement('div');
            phaseBanner.id = 'phaseBanner';
            phaseBanner.style.cssText = 'text-align:center; padding:12px; font-family:"Russo One",sans-serif; font-size:18px; font-weight:700; letter-spacing:2px; text-transform:uppercase; display:none;';
            const header = document.querySelector('.header');
            if (header && header.parentNode) {
                header.parentNode.insertBefore(phaseBanner, header.nextSibling);
            }
        }

        if (phaseName === 'pre_game_instructions') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(0,212,255,0.08)';
            phaseBanner.style.color = '#00d4ff';
            phaseBanner.style.borderBottom = '2px solid rgba(0,212,255,0.3)';
            phaseBanner.textContent = 'PRE-GAME INSTRUCTIONS \u2014 Review Your Matches';
        } else if (phaseName === 'lobby_ready') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(16,185,129,0.08)';
            phaseBanner.style.color = '#10b981';
            phaseBanner.style.borderBottom = '2px solid rgba(16,185,129,0.3)';
            phaseBanner.textContent = 'LOBBY READY \u2014 Waiting for all players';
        } else if (phaseName === 'break') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(247,186,50,0.08)';
            phaseBanner.style.color = '#f7ba32';
            phaseBanner.style.borderBottom = '2px solid rgba(247,186,50,0.3)';
            const autoFlag = data.currentPhase?.autoInserted ? ' (Scheduled)' : '';
            phaseBanner.textContent = 'BREAK TIME' + autoFlag;
        } else if (phaseName === 'challenge_game') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(16,185,129,0.08)';
            phaseBanner.style.color = '#10b981';
            phaseBanner.style.borderBottom = '2px solid rgba(16,185,129,0.3)';
            phaseBanner.textContent = 'CHALLENGE GAME';
        } else if (phaseName === 'matches_in_progress') {
            // Match 1 and Match 2 progress independently — show both statuses
            // at once instead of picking one to display.
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(16,185,129,0.08)';
            phaseBanner.style.color = '#10b981';
            phaseBanner.style.borderBottom = '2px solid rgba(16,185,129,0.3)';
            const slots = data.currentPhase?.slots || {};
            const subLabel = { setup: 'SETUP', lobby: 'LOBBY', playing: 'LIVE', done: 'DONE' };
            const parts = [1, 2]
                .filter(slot => slots[slot] !== 'done')
                .map(slot => `MATCH ${slot}: ${subLabel[slots[slot]] || 'SETUP'}`);
            phaseBanner.textContent = parts.length > 0 ? parts.join('   ·   ') : 'MATCHES COMPLETE';
        } else if (phaseName === 'scoring_vp' || phaseName === 'scoring_hex') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(168,85,247,0.08)';
            phaseBanner.style.color = '#a855f7';
            phaseBanner.style.borderBottom = '2px solid rgba(168,85,247,0.3)';
            phaseBanner.textContent = phaseName === 'scoring_vp' ? 'SCORING: VICTORY POINTS' : 'SCORING: HEX';
        } else if (phaseName === 'hex_placement_1' || phaseName === 'hex_placement_2') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(168,85,247,0.08)';
            phaseBanner.style.color = '#a855f7';
            phaseBanner.style.borderBottom = '2px solid rgba(168,85,247,0.3)';
            phaseBanner.textContent = phaseName === 'hex_placement_1' ? 'HEX PLACEMENT \u2014 Game 1' : 'HEX PLACEMENT \u2014 Game 2';
        } else if (phaseName === 'challenges') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(245,158,11,0.08)';
            phaseBanner.style.color = '#f59e0b';
            phaseBanner.style.borderBottom = '2px solid rgba(245,158,11,0.3)';
            phaseBanner.textContent = 'CHALLENGES \u2014 Teams choosing opponents';
        } else if (phaseName === 'board_resolved') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(59,130,246,0.08)';
            phaseBanner.style.color = '#3b82f6';
            phaseBanner.style.borderBottom = '2px solid rgba(59,130,246,0.3)';
            phaseBanner.textContent = 'BOARD RESOLVED \u2014 Admin verification';
        } else if (phaseName && phaseName.startsWith('spell_window')) {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(168,85,247,0.08)';
            phaseBanner.style.color = '#a855f7';
            phaseBanner.style.borderBottom = '2px solid rgba(168,85,247,0.3)';
            const sp = data.spellPhase;
            if (sp && sp.isActive) {
                const currentTeam = (data.teams || []).find(
                    t => t.id === sp.turnOrder?.[sp.currentTeamIndex]
                );
                const teamName = currentTeam?.name ||
                    'Team ' + (sp.turnOrder?.[sp.currentTeamIndex] || '?');
                phaseBanner.textContent = 'SPELL WINDOW \u2014 ' + teamName + ' is choosing...';
            } else {
                phaseBanner.textContent = 'SPELL WINDOW';
            }
        } else {
            phaseBanner.style.display = 'none';
        }
    }

    // ==================================================================
    // Broadcast message
    // ==================================================================

    renderBroadcastMessage(data) {
        let ticker = document.getElementById('broadcastTicker');
        if (!ticker) {
            ticker = document.createElement('div');
            ticker.id = 'broadcastTicker';
            ticker.style.cssText = 'position:absolute; left:0; right:0; z-index:39; text-align:center; padding:10px 20px; font-family:"Quantico",sans-serif; font-size:18px; font-weight:600; background:rgba(0,212,255,0.12); color:#00d4ff; display:none; border-bottom:1px solid rgba(0,212,255,0.3); letter-spacing:0.5px;';
            // Position below header (or phaseBanner if present)
            const phaseBanner = document.getElementById('phaseBanner');
            const ref = phaseBanner || document.querySelector('.header');
            if (ref) {
                const refBottom = (ref.offsetTop || 0) + (ref.offsetHeight || 56);
                ticker.style.top = refBottom + 'px';
            } else {
                ticker.style.top = '56px';
            }
            document.body.appendChild(ticker);
        }

        const msg = data.broadcastMessage;
        if (msg && msg.text) {
            ticker.textContent = msg.text;
            ticker.style.display = 'block';
        } else {
            ticker.style.display = 'none';
        }
    }

    // ==================================================================
    // Active spell conditions
    // ==================================================================

    _renderActiveConditions(data) {
        let container = document.getElementById('activeConditionsBanner');
        if (!container) {
            container = document.createElement('div');
            container.id = 'activeConditionsBanner';
            container.style.cssText = 'display:none; padding:6px 20px; background:rgba(168,85,247,0.04); border-bottom:1px solid rgba(168,85,247,0.15);';
            const ref = document.getElementById('broadcastTicker') ||
                document.getElementById('phaseBanner') ||
                document.querySelector('.header');
            if (ref && ref.parentNode) {
                ref.parentNode.insertBefore(container, ref.nextSibling);
            }
        }

        const effects = (data.activeEffects || []).filter(e => !e.isExpired);
        if (effects.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = effects.map(eff => {
            const casterTeam = (data.teams || []).find(t => t.id === eff.castByTeamId);
            const borderColor = casterTeam?.color || '#a855f7';
            const text = (eff.displayText || eff.spellName || '').replace(/</g, '&lt;');
            const expiryNote = eff.expiresAfterRound != null
                ? ` <span style="color:var(--text-dim);">(until R${eff.expiresAfterRound})</span>`
                : '';
            return `<div style="padding:5px 12px; margin:3px 0; border-left:4px solid ${borderColor}; background:rgba(168,85,247,0.06); border-radius:4px; font-family:'Quantico',sans-serif; font-size:16px; font-weight:500; color:var(--text-bright);">
                <span style="margin-right:6px;">${eff.icon || '\uD83D\uDD2E'}</span>${text}${expiryNote}
            </div>`;
        }).join('');
    }

    // ==================================================================
    // Display mode engine
    // ==================================================================

    _determineDisplayMode(gameData) {
        if (gameData.displayOverride?.mode) {
            return gameData.displayOverride.mode;
        }

        if (gameData.displayOverride?.rotationInterval) {
            this._rotationInterval = gameData.displayOverride.rotationInterval * 1000;
        }

        const phaseName = gameData.currentPhase?.name;
        if (phaseName && DISPLAY_MODES[phaseName] && DISPLAY_MODES[phaseName].slides) {
            return phaseName;
        }

        // Fallback: if there are ongoing matches, show live display regardless of phase
        const queue = gameData.gameQueue || [];
        if (queue.some(m => m.status === 'ongoing' && !m.isBreak)) {
            return 'matches_in_progress';
        }

        return null;
    }

    _applyDisplayMode(modeKey, gameData) {
        this._stopRotation();

        const primary = document.getElementById('displayPrimary');
        const indicators = document.getElementById('slideIndicators');

        if (!modeKey || !DISPLAY_MODES[modeKey]) {
            if (primary) primary.classList.remove('active');
            if (indicators) indicators.classList.remove('active');
            this._container.removeAttribute('data-display-mode');
            return;
        }

        const mode = DISPLAY_MODES[modeKey];
        const slides = mode.slides || [];

        if (slides.length === 0) {
            if (primary) primary.classList.remove('active');
            if (indicators) indicators.classList.remove('active');
            this._container.removeAttribute('data-display-mode');
            return;
        }

        if (primary) primary.classList.add('active');

        if (indicators && slides.length > 1) {
            indicators.innerHTML = slides.map((_, i) =>
                `<div class="slide-dot${i === 0 ? ' active' : ''}"></div>`
            ).join('');
            indicators.classList.add('active');
        } else if (indicators) {
            indicators.classList.remove('active');
        }

        this._currentSlideIndex = 0;
        this._renderSlide(slides[0], gameData);

        if (slides.length > 1) {
            this._startRotation(slides, gameData);
        }
    }

    _startRotation(slides, gameData) {
        this._stopRotation();
        this._rotationSlides = slides;

        this._rotationTimer = setInterval(() => {
            this._currentSlideIndex = (this._currentSlideIndex + 1) % slides.length;

            const primary = document.getElementById('displayPrimary');
            if (primary) {
                primary.style.opacity = '0';
                setTimeout(() => {
                    this._renderSlide(slides[this._currentSlideIndex], this._gameData);
                    primary.style.opacity = '1';
                }, 300);
            }

            this._updateSlideIndicators();
        }, this._rotationInterval);
    }

    _stopRotation() {
        if (this._rotationTimer) {
            clearInterval(this._rotationTimer);
            this._rotationTimer = null;
        }
        this._rotationSlides = null;
    }

    _refreshCurrentSlide(gameData) {
        if (!this._currentMode || !DISPLAY_MODES[this._currentMode]) return;
        const slides = DISPLAY_MODES[this._currentMode].slides;
        if (!slides || slides.length === 0) return;

        const slideKey = slides[this._currentSlideIndex];
        if (slideKey) {
            this._renderSlide(slideKey, gameData);
        }
    }

    _updateSlideIndicators() {
        const indicators = document.getElementById('slideIndicators');
        if (!indicators) return;
        const dots = indicators.querySelectorAll('.slide-dot');
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === this._currentSlideIndex);
        });
    }

    // ==================================================================
    // Slide renderers
    // ==================================================================

    _renderSlide(slideKey, data) {
        const primary = document.getElementById('displayPrimary');
        if (!primary) return;

        if (slideKey === 'board_focus') {
            this._renderBoardFocusSlide(primary, data);
            return;
        }

        this._ensurePrimaryActive();

        switch (slideKey) {
            case 'next_match_large':
                this._renderNextMatchLarge(primary, data);
                break;
            case 'standings_large':
                this._renderStandingsLarge(primary, data);
                break;
            case 'readiness_large':
                this._renderReadinessLarge(primary, data);
                break;
            case 'live_matches_large':
                this._renderLiveMatchesLarge(primary, data);
                break;
            case 'results_large':
                this._renderResultsLarge(primary, data);
                break;
            case 'winner_celebration':
                this._renderWinnerCelebration(primary, data);
                break;
            default:
                primary.innerHTML = '';
                break;
        }
    }

    _renderNextMatchLarge(container, data) {
        const queue = data.gameQueue || [];
        const nextMatch = queue.find(m =>
            (m.status === 'pending' || m.status === 'waiting') && !m.isBreak
        );

        if (!nextMatch) {
            container.innerHTML = '<div class="dm-next-match-large"><div class="dm-label">No Upcoming Matches</div></div>';
            return;
        }

        const gameName = this._getGameDisplayName(nextMatch.game);
        const teams = nextMatch.teams || [];

        let sidesHTML = '';
        teams.forEach((teamData, i) => {
            if (i > 0) sidesHTML += '<div class="dm-vs">VS</div>';
            sidesHTML += '<div class="dm-side">';
            const players = this._getMatchTeamPlayers(teamData);
            players.forEach(p => {
                const color = this._getPlayerCurrentColor(p);
                sidesHTML += `<div class="dm-player-name" style="border-color: ${color}; color: ${color};">${this._getPlayerCurrentName(p)}</div>`;
            });
            sidesHTML += '</div>';
        });

        container.innerHTML = `
            <div class="dm-next-match-large">
                <div class="dm-label">Next Match</div>
                <div class="dm-game-name">${gameName}</div>
                <div class="dm-sides">${sidesHTML}</div>
            </div>
        `;
    }

    _renderStandingsLarge(container, data) {
        const teams = [...(data.teams || [])].sort((a, b) =>
            this._getTeamTotalPoints(b) - this._getTeamTotalPoints(a)
        );

        let rowsHTML = '';
        teams.forEach((team, idx) => {
            const color = team.color || '#888';
            const totalPts = this._getTeamTotalPoints(team);
            rowsHTML += `
                <div class="dm-standings-row" style="border-left-color: ${color};">
                    <span class="dm-rank">${idx + 1}</span>
                    <span class="dm-team-name" style="color: ${color};">${team.name || 'Team'}</span>
                    <span class="dm-team-points">${totalPts} pts</span>
                    <span class="dm-team-record">${team.gamesWon || 0}W\u2013${team.gamesLost || 0}L</span>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="dm-standings-large">
                <div class="dm-standings-title">Standings</div>
                ${rowsHTML}
            </div>
        `;
    }

    _renderWinnerCelebration(container, data) {
        const teams = [...(data.teams || [])].sort((a, b) =>
            this._getTeamTotalPoints(b) - this._getTeamTotalPoints(a)
        );
        if (teams.length === 0) {
            container.innerHTML = '<div class="dm-standings-title">Tournament Complete</div>';
            return;
        }

        const winner = teams[0];
        const winnerColor = winner.color || '#f7ba32';

        let standingsHTML = '';
        teams.forEach((team, idx) => {
            const color = team.color || '#888';
            const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
            const medal = idx < 3 ? medals[idx] : `${idx + 1}.`;
            const totalPts = this._getTeamTotalPoints(team);
            standingsHTML += `
                <div class="dm-celebration-row${idx === 0 ? ' dm-celebration-winner-row' : ''}" style="border-left-color: ${color};">
                    <span class="dm-celebration-medal">${medal}</span>
                    <span class="dm-celebration-name" style="color: ${color};">${team.name || 'Team'}</span>
                    <span class="dm-celebration-pts">${totalPts} pts</span>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="dm-winner-celebration">
                <div class="dm-confetti-container" id="confettiContainer"></div>
                <div class="dm-winner-trophy">\uD83C\uDFC6</div>
                <div class="dm-winner-name" style="color: ${winnerColor}; text-shadow: 0 0 30px ${winnerColor}40;">${winner.name || 'Winner'}</div>
                <div class="dm-winner-subtitle">Tournament Champion</div>
                <div class="dm-winner-points">${this._getTeamTotalPoints(winner)} points</div>
                <div class="dm-celebration-standings">
                    ${standingsHTML}
                </div>
            </div>
        `;

        this._spawnConfetti(document.getElementById('confettiContainer'), teams);
    }

    _spawnConfetti(container, teams) {
        if (!container) return;
        const colors = teams.map(t => t.color || '#f7ba32');
        const count = 40;

        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'dm-confetti-piece';
            el.style.left = `${Math.random() * 100}%`;
            el.style.backgroundColor = colors[i % colors.length];
            el.style.animationDelay = `${Math.random() * 3}s`;
            el.style.animationDuration = `${2 + Math.random() * 3}s`;
            container.appendChild(el);
        }
    }

    _renderBoardFocusSlide(container, data) {
        container.innerHTML = '';
        container.classList.remove('active');
        this._container.setAttribute('data-display-mode', 'board_focus');
    }

    _ensurePrimaryActive() {
        const primary = document.getElementById('displayPrimary');
        if (primary && !primary.classList.contains('active')) {
            primary.classList.add('active');
        }
        this._container.removeAttribute('data-display-mode');
    }

    _renderReadinessLarge(container, data) {
        const lobbyReady = data.lobbyReady || {};
        const teams = data.teams || [];
        const queue = data.gameQueue || [];

        const activeTeamIds = new Set();
        // Build Discord channel map per team
        const teamDiscordChannels = {};
        queue.forEach(match => {
            if (match.isBreak || match.status === 'completed') return;
            (match.teams || []).forEach(team => {
                const players = this._getMatchTeamPlayers(team);
                players.forEach(p => {
                    if (p.originalTeamId != null) activeTeamIds.add(String(p.originalTeamId));
                });
            });
            // Map Discord channels to original team IDs
            if (match.discordChannels) {
                (match.teams || []).forEach(side => {
                    const ch = match.discordChannels[side.id];
                    if (ch == null) return;
                    const players = this._getMatchTeamPlayers(side);
                    players.forEach(p => {
                        if (p.originalTeamId != null) {
                            teamDiscordChannels[String(p.originalTeamId)] = ch;
                        }
                    });
                });
            }
        });

        // Build lobby creator set
        const lobbyCreatorUids = new Set();
        queue.forEach(match => {
            if (match.isBreak || match.status === 'completed') return;
            Object.values(match.lobbyCreators || {}).forEach(c => {
                if (c?.uid) lobbyCreatorUids.add(c.uid);
            });
        });

        let rowsHTML = '';
        teams.filter(t => activeTeamIds.size === 0 || activeTeamIds.has(String(t.id))).forEach(team => {
            const players = team.players || [];
            const teamColor = team.color || '#888';
            const discordCh = teamDiscordChannels[String(team.id)];

            // Per-player readiness matrix
            let playersHTML = '';
            players.forEach(p => {
                const r = lobbyReady[p.uid] || {};
                const gl = r.gameLobby === true || r.ready === true;
                const dc = r.discord === true || r.ready === true;
                const isCreator = lobbyCreatorUids.has(p.uid);
                const creatorIcon = isCreator ? '<span style="margin-right: 4px;">\u2B50</span>' : '';

                playersHTML += `
                    <div class="dm-ready-player-row">
                        <span class="dm-ready-indicator" style="color: ${gl ? '#10b981' : '#ef4444'};">${gl ? '\uD83D\uDFE2' : '\uD83D\uDD34'}\uD83C\uDFAE</span>
                        <span class="dm-ready-indicator" style="color: ${dc ? '#10b981' : '#ef4444'};">${dc ? '\uD83D\uDFE2' : '\uD83D\uDD34'}\uD83C\uDFA7</span>
                        ${creatorIcon}<span class="dm-ready-player-name">${p.name || 'Player'}</span>
                    </div>
                `;
            });

            const discordLabel = discordCh ? ` \u2014 Discord #${discordCh}` : '';

            rowsHTML += `
                <div class="dm-team-ready-row" style="border-left-color: ${teamColor};">
                    <div style="flex: 1;">
                        <span class="dm-team-name" style="color: ${teamColor}; font-size: 20px; font-weight: 700;">${team.name || 'Team'}${discordLabel}</span>
                        <div class="dm-ready-players-grid">${playersHTML}</div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="dm-readiness-large">
                <div class="dm-readiness-title">Ready Check</div>
                <div class="dm-readiness-legend" style="text-align: center; font-size: 14px; color: #9aa1ad; margin-bottom: 12px;">
                    \uD83C\uDFAE = Game Lobby &nbsp; \uD83C\uDFA7 = Discord &nbsp; \u2B50 = Lobby Creator
                </div>
                ${rowsHTML}
            </div>
        `;
    }

    _renderLiveMatchesLarge(container, data) {
        const queue = data.gameQueue || [];
        const ongoing = queue.filter(m => m.status === 'ongoing' && !m.isBreak);

        if (ongoing.length === 0) {
            // No ongoing matches — hide overlay so normal dashboard shows
            container.classList.remove('active');
            container.innerHTML = '';
            return;
        }

        let matchesHTML = '';
        ongoing.forEach(match => {
            const gameName = this._getGameDisplayName(match.game);
            const gameImage = this._getGameImagePath(match.game);
            const logoHtml = gameImage ? `<img class="dm-game-logo" src="${gameImage}" alt="${gameName}">` : '';
            const teams = match.teams || [];

            let sidesHTML = '';
            teams.forEach((teamData, i) => {
                if (i > 0) sidesHTML += '<div class="dm-vs">VS</div>';
                sidesHTML += '<div class="dm-side">';
                const players = this._getMatchTeamPlayers(teamData);
                players.forEach(p => {
                    const color = this._getPlayerCurrentColor(p);
                    sidesHTML += `<div class="dm-player-name" style="border-color: ${color}; color: ${color};">${this._getPlayerCurrentName(p)}</div>`;
                });
                sidesHTML += '</div>';
            });

            matchesHTML += `
                <div class="dm-live-match-large">
                    <div class="dm-live-badge">\u25CF LIVE</div>
                    <div class="dm-game-header">${logoHtml}<span class="dm-game-name">${gameName}</span></div>
                    <div class="dm-sides">${sidesHTML}</div>
                </div>
            `;
        });

        container.innerHTML = `<div class="dm-live-matches-wrapper">${matchesHTML}</div>`;
    }

    _renderResultsLarge(container, data) {
        const resultLogCache = this._getResultLogCache();
        const recent = resultLogCache.slice(0, 5);

        if (recent.length === 0) {
            container.innerHTML = '<div class="dm-results-large"><div class="dm-results-title">No Results Yet</div></div>';
            return;
        }

        const formatTimeAgo = window.formatTimeAgo || (() => '');

        let rowsHTML = '';
        recent.forEach(event => {
            const gameName = event.gameName || 'Match';
            const winningSide = event.winningSide?.toUpperCase();
            const winningPlayers = event.winningPlayers || [];

            let winnerText = 'Completed';
            if (winningPlayers.length > 0) {
                const names = winningPlayers.map(p => {
                    const color = this._getTeamColor(p.originalTeamId) || p.originalTeamColor || '#888';
                    return `<span style="color: ${color};">${p.name || '?'}</span>`;
                });
                winnerText = names.join(', ');
            }

            rowsHTML += `
                <div class="dm-result-card">
                    <span class="dm-result-game">${gameName}</span>
                    <span class="dm-result-winner">${winnerText}</span>
                    <span class="dm-result-badge">Winner</span>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="dm-results-large">
                <div class="dm-results-title">Latest Results</div>
                ${rowsHTML}
            </div>
        `;
    }

    // ==================================================================
    // Ceremony overlay
    // ==================================================================

    _renderCeremonyOverlay(gameData) {
        const overlay = document.getElementById('ceremonyOverlay');
        if (!overlay) return;

        const cs = gameData.ceremonyState;
        if (!cs?.isActive) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'flex';

        const content = document.getElementById('ceremonyContent');
        if (content && cs.currentStep && typeof ScoringCeremony !== 'undefined') {
            ScoringCeremony.renderStep(content, cs.currentStep, gameData, 'full');
        }

        const progressBar = document.getElementById('ceremonyProgressBar');
        if (progressBar && cs.totalSteps > 0) {
            const pct = ((cs.currentStepIndex + 1) / cs.totalSteps) * 100;
            progressBar.style.width = `${pct}%`;
        }
    }
}

window.DisplayManager = DisplayManager;
