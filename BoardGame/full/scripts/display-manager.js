/**
 * DisplayManager — Smart Display Engine for view.html (Full Version)
 *
 * Renders the lightweight-quality 1920×1080 infoscreen layout:
 * dual arena matches, territory map, hex board, queue, results, score strip.
 *
 * Phase 3 overlay features: phase-aware display modes (auto = follow the
 * phase manager's state; god.html can force a mode via displayOverride),
 * scoring ceremony sync, broadcast messages, active spell conditions.
 *
 * v2.0 — Rewritten to produce lightweight-quality HTML into lightweight DOM.
 */

// Display mode definitions — maps phase names to display configurations.
// `slide: null` means "no fullscreen takeover" (the normal dashboard stays
// visible; only the phase banner / hex overlay react to those phases).
// Selection is snapshot-driven: displayOverride.mode (god's manual pick)
// wins, otherwise the current phase name decides — there is no timed
// rotation; the screen changes exactly when the tournament state does.
const DISPLAY_MODES = {
    break: {
        name: 'Break',
        slide: 'break_screen'
    },
    // ── Scoring phases ──
    scoring_vp: {
        name: 'Scoring: Victory Points',
        slide: 'results_large'
    },
    scoring_hex: {
        name: 'Scoring: Hex',
        slide: 'board_focus'
    },
    // ── Hex placement phases ──
    hex_placement_1: {
        name: 'Hex Placement — Game 1',
        slide: null
    },
    hex_placement_2: {
        name: 'Hex Placement — Game 2',
        slide: null
    },
    // ── Spell windows ──
    spell_window_1: { name: 'Spell Window', slide: null },
    spell_window_2: { name: 'Spell Window', slide: null },
    spell_window_3: { name: 'Spell Window', slide: null },
    spell_window_4: { name: 'Spell Window', slide: null },
    // ── Challenge phases ──
    challenges: {
        name: 'Challenges Issued',
        slide: null
    },
    challenge_game: {
        name: 'Challenge Game',
        slide: 'live_matches_large'
    },
    // ── Board resolved ──
    board_resolved: {
        name: 'Board Resolved',
        slide: 'board_focus'
    },
    // ── Matches In Progress — Match 1 / Match 2 run independently now, so
    // any of setup/lobby/playing can be true for either slot at once.
    // Shown side-by-side in a single dual-slot slide. ──
    matches_in_progress: {
        name: 'Matches In Progress',
        slide: 'matches_dual_slot'
    },
    // ── Round advance ──
    round_advance: {
        name: 'Round Advance',
        slide: 'results_large'
    },
    // ── Tournament end ──
    tournament_end: {
        name: 'Tournament End',
        slide: 'winner_celebration'
    },
    // ── Manual-only (no phase is ever named 'standings'; reachable only
    // via god.html's display override dropdown) ──
    standings: {
        name: 'Standings',
        slide: 'standings_large'
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
        this._matchStartTimes = options.matchStartTimes || { match1: null, match2: null };
        this._prevArenaSignatures = options.prevArenaSignatures || { match1: null, match2: null };
        this._prevQueueSignature = options.prevQueueSignature || { value: null };
        this._prevResultIds = options.prevResultIds || { value: [] };
        this._gameData = null;

        // Display mode state
        this._currentMode = null;

        this._prevBoardSignature = null;
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

        // 9. Board (skip the 91-hex rebuild when board/rooms didn't change)
        const boardSignature = window.RenderSignature.computeBoardSignature(gameData.board, gameData.rooms);
        if (boardSignature !== this._prevBoardSignature) {
            this._prevBoardSignature = boardSignature;
            if (this._renderBoardFn) {
                this._renderBoardFn();
            } else if (this._boardRenderer && gameData.board) {
                this._boardRenderer.render(gameData);
            }
        }

        // 10. Live indicator dot
        const dot = document.querySelector('.h-dot');
        if (dot) dot.style.background = '#10b981';

        // 11. Ceremony overlay (takes priority over display modes)
        this._renderCeremonyOverlay(gameData);

        // 11b. Hex-phase overlay (scoring_hex / hex_placement_1/2) -- deliberately
        // independent of the display-mode/slide system below (see its own
        // doc comment for why).
        this._renderHexPhaseOverlay(gameData);

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

    /**
     * Whose spell turn it is, derived from teamsCompleted rather than from
     * spellPhase.currentTeamIndex.
     *
     * currentTeamIndex is NOT reliable: team.html's castSpellViaFirestore()
     * and endSpellTurn() (team-controls.js) both arrayUnion the team into
     * spellPhase.teamsCompleted but never advance the index — only
     * spell-engine.js's completeTeamTurn() does. Reading the index therefore
     * keeps naming the first team long after it has acted.
     *
     * @returns {*|null} the team id whose turn it is, or null if the phase
     *   isn't active / every team has already acted.
     */
    _spellWindowCurrentTeamId(data) {
        const sp = data?.spellPhase;
        if (!sp || !sp.isActive) return null;
        const done = (sp.teamsCompleted || []).map(String);
        for (const id of (sp.turnOrder || [])) {
            if (!done.includes(String(id))) return id;
        }
        return null;
    }

    /**
     * Every spell cast during the CURRENT spell window, merged from the two
     * independent sources that record them, oldest first:
     *
     *   spellHistory[]   — in-app casts written by team.html. Cumulative for
     *                      the whole tournament, so filtered to entries at or
     *                      after currentPhase.startedAt. Both fields are ISO
     *                      8601 strings, so a lexical compare is correct.
     *   spellWindowLog[] — the admin's manual entries for cards played
     *                      physically at the table. Already scoped to one
     *                      window (phase-manager.js nulls it on exit), so it
     *                      is used whole.
     *
     * The two sources are disjoint by construction — nothing writes both —
     * so no deduplication is needed.
     *
     * @returns {Array<{teamId, teamName, spellName, at}>}
     */
    _collectSpellWindowCasts(data) {
        const startedAt = data?.currentPhase?.startedAt || null;

        // No window boundary => no way to tell this window's casts from the
        // whole tournament's. Drop the cumulative source rather than dumping
        // every spell ever cast onto the room display.
        const fromHistory = !startedAt ? [] : (data?.spellHistory || [])
            .filter(e => e && e.timestamp && e.timestamp >= startedAt)
            .map(e => ({
                teamId: e.teamId,
                teamName: e.teamName,
                spellName: e.spellName || e.spellId,
                at: e.timestamp
            }));

        const fromManual = (data?.spellWindowLog || []).map(e => ({
            teamId: e.teamId,
            teamName: e.teamName,
            spellName: e.spellName,
            at: e.addedAt || ''
        }));

        return [...fromHistory, ...fromManual]
            .sort((a, b) => String(a.at).localeCompare(String(b.at)));
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
                // playerId here is the PLAYER REGISTRY key (e.g. "p_zcqiaf93"),
                // never the linked Firebase Auth uid -- lobbyReady, however,
                // is keyed by the real uid (set by team.html's
                // setReadyStatus()). Resolve it from the registry entry
                // (gameState.players[playerId].uid, null until linked) so
                // callers can actually look up this player's readiness.
                const uid = this._gameData?.players?.[playerId]?.uid || null;
                if (window.PlayerUtils) {
                    const info = window.PlayerUtils.getPlayerDisplayInfo(this._gameData, playerId);
                    return {
                        id: playerId,
                        uid,
                        name: info.name,
                        originalTeamId: info.teamId,
                        originalTeamColor: info.teamId ? this._getTeamColor(info.teamId) : '#666666'
                    };
                }
                if (this._gameData?.players?.[playerId]) {
                    const p = this._gameData.players[playerId];
                    return {
                        id: playerId,
                        uid,
                        name: p.name || 'Unknown',
                        originalTeamId: p.teamId,
                        originalTeamColor: p.teamId ? this._getTeamColor(p.teamId) : '#666666'
                    };
                }
                return { id: playerId, uid, name: 'Unknown', originalTeamId: null, originalTeamColor: '#666666' };
            });
        }

        // Old format: players array
        if (matchTeam.players && Array.isArray(matchTeam.players)) {
            return matchTeam.players.map(p => ({
                id: p.id || null,
                uid: p.uid || null,
                name: p.name || 'Unknown',
                originalTeamId: p.originalTeamId,
                originalTeamColor: p.originalTeamColor || this._getTeamColor(p.originalTeamId) || '#666666'
            }));
        }

        return [];
    }

    _getTeamTotalPoints(team) {
        // `points` already includes the +1 awarded per match win (see
        // confirmResult() in admin.js and result-manager.js) plus heart-hex
        // income. Adding gamesWon here counted every win TWICE and made the
        // spectator screen disagree with admin.html's own Teams column.
        return (team.points || 0);
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
        // `winCondition` is the real field (setup.html writes it, admin's
        // "Win At" badge edits it). `victoryCondition` was read here and
        // written nowhere, so these bars always scaled to 50.
        const victoryCondition = data.winCondition || 50;
        const sorted = [...teams].sort((a, b) => this._getTeamTotalPoints(b) - this._getTeamTotalPoints(a));
        const ticks = '<div class="tm-ticks"><div class="tm-tick" style="left:20%;"></div><div class="tm-tick" style="left:40%;"></div><div class="tm-tick" style="left:60%;"></div><div class="tm-tick" style="left:80%;"></div></div>';

        const rowsHtml = sorted.map(team => {
            const color = team.color || (window.TEAM_COLORS || {})[team.id];
            // `points` is the whole score — it ALREADY contains +1 per match
            // win as well as heart income. Adding gamesWon on top counted
            // every win twice (a team with one win and no hearts showed 2).
            // The bar still splits into a win segment and a heart segment,
            // but by DERIVING the split from the total rather than summing
            // two sources: each win is worth exactly +1, so the rest is heart
            // income. Clamped so a corrupted state can't emit a negative flex.
            const totalPts = team.points || 0;
            const wins = Math.min(team.gamesWon || 0, totalPts);
            const hexPts = Math.max(0, totalPts - wins);
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
            const breakEmoji = match.breakEmoji || ICON_SVGS.pause;

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
                    <span class="a-timer">${ICON_SVGS.timer} <span id="elapsed${slotNum}">00:00</span></span>
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
                    <span class="a-timer">${ICON_SVGS.timer} <span id="elapsed${slotNum}">00:00</span></span>
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
                    <span class="a-timer">${ICON_SVGS.timer} <span id="elapsed${slotNum}">00:00</span></span>
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
                const breakEmoji = match.breakEmoji || ICON_SVGS.pause;
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
                                <span class="q-next-game">${isChallenge ? ICON_SVGS.swords + ' ' : ''}${gameName}</span>
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
                            <span class="q-next-game">${isChallenge ? ICON_SVGS.swords + ' ' : ''}${gameName}</span>
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
                            <span class="qc-game">${isChallenge ? ICON_SVGS.swords + ' ' : ''}${this._getGameDisplayName(match.game)}${playType ? ' \u00B7 ' + playType : ''}</span>
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
                        <span class="qc-game">${isChallenge ? ICON_SVGS.swords + ' ' : ''}${this._getGameDisplayName(match.game)}${playType ? ' \u00B7 ' + playType : ''}</span>
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
                        <span class="r-game">${isChallenge ? ICON_SVGS.swords + ' ' : ''}${gameName}${playType ? ' \u00B7 ' + playType : ''}</span>
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
                    <span class="r-game">${isChallenge ? ICON_SVGS.swords + ' ' : ''}${gameName}${playType ? ' \u00B7 ' + playType : ''}</span>
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
            // `points` is the whole score — match wins AND heart income. The
            // strip shows the two apart, so DERIVE the split instead of
            // summing two sources: each win is worth exactly +1, so whatever
            // is left over is heart income. Adding gamesWon to points here
            // showed a team with one win and no hearts as 1 + 1 = 2.
            const totalPts = team.points || 0;
            const victoryPts = Math.min(team.gamesWon || 0, totalPts);
            const hexPts = Math.max(0, totalPts - victoryPts);

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

        if (phaseName === 'pre_game_setup') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(0,212,255,0.08)';
            phaseBanner.style.color = '#00d4ff';
            phaseBanner.style.borderBottom = '2px solid rgba(0,212,255,0.3)';
            phaseBanner.textContent = 'PRE-GAME SETUP \u2014 Tournament has not started yet';
        } else if (phaseName === 'round_advance') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(59,130,246,0.08)';
            phaseBanner.style.color = '#3b82f6';
            phaseBanner.style.borderBottom = '2px solid rgba(59,130,246,0.3)';
            phaseBanner.textContent = 'ADVANCING TO NEXT ROUND';
        } else if (phaseName === 'tournament_end') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(247,186,50,0.08)';
            phaseBanner.style.color = '#f7ba32';
            phaseBanner.style.borderBottom = '2px solid rgba(247,186,50,0.3)';
            phaseBanner.textContent = 'TOURNAMENT CONCLUDED \u2014 Thanks for playing!';
        } else if (phaseName === 'break') {
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(247,186,50,0.08)';
            phaseBanner.style.color = '#f7ba32';
            phaseBanner.style.borderBottom = '2px solid rgba(247,186,50,0.3)';
            const autoFlag = data.currentPhase?.autoInserted ? ' (Scheduled)' : '';
            phaseBanner.textContent = 'BREAK TIME' + autoFlag;
        } else if (phaseName === 'challenge_game') {
            // Mirrors matches_in_progress's lobby-aware treatment below —
            // challengeLobbyState is 'lobby' during the ready-check, 'ready'
            // once everyone's in and the admin just needs to hit Start, or
            // unset while the challenge match itself is queued/being played.
            phaseBanner.style.display = 'block';
            phaseBanner.style.background = 'rgba(16,185,129,0.08)';
            phaseBanner.style.color = '#10b981';
            phaseBanner.style.borderBottom = '2px solid rgba(16,185,129,0.3)';
            const challengeLobbyState = data.currentPhase?.challengeLobbyState;
            if (challengeLobbyState === 'lobby') {
                phaseBanner.textContent = 'CHALLENGE GAME — LOBBY: Waiting for all players';
            } else if (challengeLobbyState === 'ready') {
                phaseBanner.textContent = 'CHALLENGE GAME — READY: Starting shortly';
            } else {
                phaseBanner.textContent = 'CHALLENGE GAME';
            }
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
            phaseBanner.textContent = 'CHALLENGES \u2014 Teams disputing control of heart hexes';
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

    /**
     * Broadcast banner: sizing/z-index/colors all live in view.html's
     * #broadcastTicker CSS now (needed transitions, which don't work well
     * built purely from an inline cssText string). This just choreographs
     * the open/close sequence via class toggling:
     *   open:  draw a line (collapsed scaleY) -> expand to the full band
     *          -> fade the text in once the expand transition finishes
     *   close: fade the text out -> collapse back to a line
     * `_broadcastTimer` debounces against onFirebaseSnapshot firing again
     * mid-animation (e.g. an unrelated field changing) so the sequence
     * doesn't restart or race itself.
     */
    renderBroadcastMessage(data) {
        let ticker = document.getElementById('broadcastTicker');
        let textEl;
        if (!ticker) {
            ticker = document.createElement('div');
            ticker.id = 'broadcastTicker';
            textEl = document.createElement('div');
            textEl.className = 'bt-text';
            ticker.appendChild(textEl);
            document.body.appendChild(ticker);
        } else {
            textEl = ticker.querySelector('.bt-text');
        }

        const msg = data.broadcastMessage;
        const newText = (msg && msg.text) || null;
        const isOpen = ticker.classList.contains('bt-open');

        clearTimeout(this._broadcastTimer);

        if (newText && !isOpen) {
            // Opening: line -> expand -> fade text in (500ms matches the
            // CSS transform transition's duration).
            textEl.textContent = newText;
            ticker.classList.remove('bt-text-visible');
            ticker.classList.add('bt-open');
            this._broadcastTimer = setTimeout(() => ticker.classList.add('bt-text-visible'), 500);
        } else if (newText && isOpen && textEl.textContent !== newText) {
            // Already open, message text changed -- quick cross-fade
            // instead of replaying the whole line/expand entrance.
            ticker.classList.remove('bt-text-visible');
            this._broadcastTimer = setTimeout(() => {
                textEl.textContent = newText;
                ticker.classList.add('bt-text-visible');
            }, 350);
        } else if (!newText && isOpen) {
            // Closing: fade text out -> collapse back to a line.
            ticker.classList.remove('bt-text-visible');
            this._broadcastTimer = setTimeout(() => ticker.classList.remove('bt-open'), 350);
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
                <span style="margin-right:6px;">${eff.icon || ICON_SVGS.wandSparkles}</span>${text}${expiryNote}
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

        const phaseName = gameData.currentPhase?.name;
        if (phaseName && DISPLAY_MODES[phaseName] && DISPLAY_MODES[phaseName].slide) {
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
        const primary = document.getElementById('displayPrimary');
        const slide = modeKey ? DISPLAY_MODES[modeKey]?.slide : null;

        if (!slide) {
            if (primary) primary.classList.remove('active');
            this._container.removeAttribute('data-display-mode');
            return;
        }

        if (primary) primary.classList.add('active');
        this._renderSlide(slide, gameData);
    }

    _refreshCurrentSlide(gameData) {
        if (!this._currentMode) return;
        const slide = DISPLAY_MODES[this._currentMode]?.slide;
        if (slide) {
            this._renderSlide(slide, gameData);
        }
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
            case 'standings_large':
                this._renderStandingsLarge(primary, data);
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
            case 'break_screen':
                this._renderBreakScreen(primary, data);
                break;
            case 'matches_dual_slot':
                this._renderMatchesDualSlot(primary, data);
                break;
            default:
                primary.innerHTML = '';
                break;
        }
    }

    /**
     * Explicit "ON BREAK" slide. Previously DISPLAY_MODES.break just
     * reused ordinary phase-agnostic slides (next_match_large,
     * standings_large, board_focus) -- none of which say anything about a
     * break being active, so a break looked like a completely normal
     * rotation to anyone watching view.html. The small phaseBanner text
     * strip (renderPhaseDisplay) was the only break indicator anywhere,
     * easy to miss. Found live during smoke testing, 2026-08-03.
     */
    _renderBreakScreen(container, data) {
        const auto = data.currentPhase?.autoInserted;
        container.innerHTML = `
            <div class="dm-break-screen">
                <div class="dm-break-icon">${ICON_SVGS.pause}</div>
                <div class="dm-break-title">On Break</div>
                <div class="dm-break-subtitle">${auto ? 'Scheduled break — ' : ''}The tournament resumes shortly</div>
            </div>
        `;
    }

    /**
     * Does this queue entry belong to the given match slot (1 or 2), for
     * display purposes? Mirrors phase-manager.js's getSlotRequirements
     * belongsToSlot helper, including its createdAt >= phaseStartedAt gate
     * for untagged matches (entries created via a path that bypasses slot
     * tagging, e.g. the queue's own ▶ start buttons instead of the flow
     * manager). Without that gate, any stale untagged entry left in the
     * queue counts for BOTH slots forever — harmless while both slots are
     * still open, but once one slot reaches 'done' its panel stops
     * rendering pending/ongoing entries while the other slot's panel keeps
     * pulling in the whole untagged backlog, which is exactly what
     * happened here: Match 1 (done) looked fine while Match 2 (still live)
     * accumulated every stray untagged queue entry. Keep in sync with
     * admin-improved-adapter.js's `_belongsToCurrentSlot` and
     * phase-manager.js's `getSlotRequirements`.
     */
    _matchBelongsToSlot(match, slot, currentRoundNumber, phaseStartedAt) {
        if (match.isBreak || match.isChallenge === true) return false;
        if (match.slot !== undefined) {
            return match.slot === slot &&
                (match.roundNumber === undefined || match.roundNumber === currentRoundNumber);
        }
        if (!match.createdAt || !phaseStartedAt) return false;
        return match.createdAt >= phaseStartedAt;
    }

    /**
     * Renders one queue match as two (or more) stacked player columns
     * separated by a VS divider, each player shown with the game-lobby/
     * Discord ready-dot pair. Used for every matches_in_progress sub-phase
     * (setup/lobby/playing) so who-plays-whom stays visible the whole
     * time, in the same readable stacked-names look throughout — not just
     * during the lobby ready-check. Labeled with the match number (e.g.
     * "#6 Age of Empires IV") matching admin.html's own match cards, so
     * whoever's running admin can find the right card from the big screen.
     *
     * A slot's own sub-phase badge (Setup/Lobby/Live/Done) is per-SLOT, not
     * per-match — a split-format slot (e.g. linked 3v3+2v2) holds two
     * matches that can each be in a different actual state (one started,
     * the other still waiting on the admin to hit Start), which the slot
     * badge alone can't show. Each match card gets its own LIVE/WAITING
     * tag straight from that queue entry's own `status`.
     */
    _renderMatchGroup(m, data) {
        const lobbyReady = data.lobbyReady || {};
        const dotSvg = (ready) => `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" style="color:${ready ? '#22c55e' : '#ef4444'}"><circle cx="12" cy="12" r="8"/></svg>`;

        const gameName = this._getGameDisplayName(m.game || m.gameType);
        const gameLabel = m.matchNumber ? `#${m.matchNumber} ${gameName}` : gameName;
        const isLive = m.status === 'ongoing';
        const liveTagHTML = `<span class="dm-dual-live-tag dm-dual-live-tag--${isLive ? 'live' : 'waiting'}">${isLive ? 'Live' : 'Waiting'}</span>`;
        const teams = m.teams || m.sides || [];
        const sidesHTML = teams.map((t, i) => {
            const players = this._getMatchTeamPlayers(t);
            const playersHTML = players.map(p => {
                const color = this._getPlayerCurrentColor(p);
                const name = this._getPlayerCurrentName(p);
                const r = lobbyReady[p.uid] || {};
                const gl = r.gameLobby === true || r.ready === true;
                const dc = r.discord === true || r.ready === true;
                return `
                    <div class="dm-dual-ready-row">
                        <span class="dm-dual-ready-name" style="color:${color};">${name}</span>
                        <span class="dm-dual-ready-indicator">${dotSvg(gl)}${ICON_SVGS.gamepad2}</span>
                        <span class="dm-dual-ready-indicator">${dotSvg(dc)}${ICON_SVGS.headphones}</span>
                    </div>`;
            }).join('');
            const side = `<div class="dm-dual-ready-side">${playersHTML}</div>`;
            return (i > 0 ? '<div class="dm-dual-vs">VS</div>' : '') + side;
        }).join('');

        return `<div class="dm-dual-live-match"><div class="dm-dual-game-name">${gameLabel} ${liveTagHTML}</div><div class="dm-dual-ready-sides">${sidesHTML}</div></div>`;
    }

    /**
     * Renders a completed queue match's result: same stacked-columns/VS
     * layout as _renderMatchGroup, but with the winning side (queue entry's
     * own `winnerIndex`, set by ResultManager.confirmResult()) highlighted
     * instead of ready-dots (the match is over, readiness is moot). Used so
     * a slot that finished stays informative — "who won" — instead of
     * collapsing to a bare "Complete" label while the other slot is still
     * playing.
     */
    _renderMatchResult(m) {
        const gameName = this._getGameDisplayName(m.game || m.gameType);
        const gameLabel = m.matchNumber ? `#${m.matchNumber} ${gameName}` : gameName;
        const teams = m.teams || m.sides || [];

        const sidesHTML = teams.map((t, i) => {
            const isWinner = i === m.winnerIndex;
            const players = this._getMatchTeamPlayers(t);
            const playersHTML = players.map(p => {
                const color = this._getPlayerCurrentColor(p);
                const name = this._getPlayerCurrentName(p);
                return `<div class="dm-dual-ready-row">
                        <span class="dm-dual-ready-name" style="color:${color};">${name}</span>
                    </div>`;
            }).join('');
            // Always reserve the label's row on both sides (hidden when not
            // the winner) so the two columns' player rows stay vertically
            // aligned instead of the winning side's rows sitting lower.
            const label = `<div class="dm-dual-winner-label"${isWinner ? '' : ' style="visibility:hidden;"'}>${ICON_SVGS.crown} Winner</div>`;
            const side = `<div class="dm-dual-ready-side${isWinner ? ' dm-dual-winner-side' : ''}">${label}${playersHTML}</div>`;
            return (i > 0 ? '<div class="dm-dual-vs">VS</div>' : '') + side;
        }).join('');

        return `<div class="dm-dual-live-match"><div class="dm-dual-game-name">${gameLabel}</div><div class="dm-dual-ready-sides">${sidesHTML}</div></div>`;
    }

    /**
     * Match 1 / Match 2 side-by-side, replacing the old
     * live_matches_large/readiness_large/next_match_large rotation for
     * matches_in_progress. The two slots can be in completely different
     * sub-phases at once (one live while the other's still lobby-ready),
     * so this is the one phase a single "pick the best existing slide"
     * choice can't represent — it needs both shown together.
     *
     * A slot can hold more than one simultaneous match (e.g. a linked
     * 3v3+2v2 split-format pair counts as one slot but is two queue
     * entries) — every active match for the slot renders as its own
     * matchup group, not just the first one.
     */
    _renderMatchesDualSlot(container, data) {
        const currentRoundNumber = data.currentPhase?.roundNumber;
        const phaseStartedAt = data.currentPhase?.startedAt;
        const slots = data.currentPhase?.slots || {};
        const queue = data.gameQueue || [];

        const panelHTML = [1, 2].map(slot => {
            const sub = slots[slot] || 'setup';
            const subLabel = { setup: 'Setup', lobby: 'Lobby', playing: 'Live', done: 'Done' }[sub] || sub;

            const slotMatches = m => this._matchBelongsToSlot(m, slot, currentRoundNumber, phaseStartedAt);
            const ongoing = queue.filter(m => m.status === 'ongoing' && slotMatches(m));
            const pending = queue.filter(m => (m.status === 'pending' || m.status === undefined) && slotMatches(m));
            const active = [...ongoing, ...pending];

            let bodyHTML = '';

            if (sub === 'done') {
                // Keep showing who won this slot's match(es) instead of
                // collapsing to a bare "Complete" label -- stays visible
                // through the whole matches_in_progress phase, including
                // while the OTHER slot is still playing, until the admin
                // advances past this phase entirely.
                const completed = queue.filter(m => m.status === 'completed' && slotMatches(m));
                bodyHTML = completed.length > 0
                    ? completed.map(m => this._renderMatchResult(m)).join('')
                    : `<div class="dm-dual-slot-status">Complete</div>`;
            } else if (active.length > 0) {
                bodyHTML = active.map(m => this._renderMatchGroup(m, data)).join('');
            } else if (sub === 'lobby') {
                bodyHTML = `<div class="dm-dual-slot-status">Waiting for players...</div>`;
            } else {
                bodyHTML = `<div class="dm-dual-slot-status">No match queued yet</div>`;
            }

            return `
                <div class="dm-dual-slot-panel">
                    <div class="dm-dual-slot-header">
                        <span class="dm-dual-slot-title">Match ${slot}</span>
                        <span class="dm-dual-slot-badge dm-dual-slot-badge--${sub}">${subLabel}</span>
                    </div>
                    ${bodyHTML}
                </div>`;
        }).join('');

        container.innerHTML = `<div class="dm-matches-dual">${panelHTML}</div>`;
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
            const medals = [iconSvg('medal', '#eab308'), iconSvg('medal', '#cbd5e1'), iconSvg('medal', '#b45309')];
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
                <div class="dm-winner-trophy">${ICON_SVGS.trophy}</div>
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

    /**
     * Hex-phase info overlay -- covers BOTH scoring_hex (live preview of
     * what each team is about to score) and hex_placement_1/2 (the pending
     * placement queue for that match slot). Replaces the dual-arena's two
     * "VS" boxes (#match1/#match2) for the duration, since neither phase
     * ever has a live match to show there anyway -- reuses that already-
     * prominent, otherwise-idle space instead of floating a panel over the
     * hex board.
     *
     * Called unconditionally every onFirebaseSnapshot tick, independent of
     * the DISPLAY_MODES slide system entirely -- board_focus's
     * slide renderer used to own this, but hex_placement_1/2 have
     * `slide: null` (no slide at all), so _applyDisplayMode short-circuits
     * before ever reaching a slide renderer for them. That left the overlay
     * with no code path to hide itself when scoring_hex handed off to
     * hex_placement_1: found while adding the placement-queue view below.
     */
    _renderHexPhaseOverlay(data) {
        const overlay = document.getElementById('hexPhaseOverlay');
        const arena = document.querySelector('.dual-arena');
        if (!overlay) return;

        const phase = data.currentPhase?.name;
        if (phase === 'scoring_hex') {
            overlay.innerHTML = this._buildHexScoringHTML(data);
        } else if (phase === 'hex_placement_1' || phase === 'hex_placement_2') {
            overlay.innerHTML = this._buildHexPlacementHTML(data, phase);
        } else {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
            if (arena) arena.style.display = '';
            return;
        }
        if (arena) arena.style.display = 'none';
        overlay.style.display = '';
    }

    /**
     * Live preview of what each team is ABOUT to score from heart hexes.
     * Reads calculateHeartIncome() in board-module.js — the same function the
     * payout uses — so this panel can never disagree with what admin awards.
     * Read-only: the award itself fires when the admin leaves scoring_hex.
     */
    _buildHexScoringHTML(data) {
        // Heart income settles the round that just ended; scoring_hex sits at
        // the top of the new one.
        const resolvingRound = (data.currentPhase?.roundNumber || 0) - 1;
        const { matchesPlayed, byTeam } =
            calculateHeartIncome(data, this._boardModule, resolvingRound);

        const pending = (data.teams || [])
            .map(team => ({ team, ...(byTeam[team.id] || { points: 0, mountainCount: 0, sideCount: 0 }) }))
            .filter(t => t.points > 0)
            .sort((a, b) => b.points - a.points);

        const rowsHTML = pending.length > 0
            ? pending.map(({ team, points, mountainCount, sideCount }) => {
                const color = team.color || '#888';
                const breakdown = [
                    mountainCount > 0 ? `${mountainCount} × Mountain Heart` : '',
                    sideCount > 0 ? `${sideCount} × Side Heart` : ''
                ].filter(Boolean).join(' + ');
                return `
                    <div class="dm-hex-score-row" style="--c:${color};">
                        <span class="dm-hex-score-team" style="color:${color};">${team.name || 'Team'}</span>
                        <span class="dm-hex-score-breakdown">${breakdown}</span>
                        <span class="dm-hex-score-pts">+${points}</span>
                    </div>`;
            }).join('')
            : (matchesPlayed === 0
                ? '<div class="dm-hex-score-empty">No matches played this round — heart income pays nothing</div>'
                : '<div class="dm-hex-score-empty">No heart hexes controlled this round</div>');

        return `
            <div class="dm-hex-score-title">${ICON_SVGS.hexagon} Hex Scoring</div>
            <div class="dm-hex-score-rows">${rowsHTML}</div>
        `;
    }

    /**
     * Pending hex-placement queue for one match slot, shown throughout
     * hex_placement_1/2. Mirrors admin-improved-adapter.js's
     * _relevantPendingWinsForPhase() (untagged .slot counts for either
     * phase, matching how a match created before slot-tagging existed
     * still needs to gate SOMETHING rather than silently vanish) and
     * flattens each win's teamIds into individual queue entries -- a
     * split-credit win naming two teams is two separate placements owed,
     * not one. The whole queue stays visible the entire phase (not just
     * "next"), with the first entry (earliest-pushed = next to place)
     * highlighted.
     */
    _buildHexPlacementHTML(data, phase) {
        const teams = data.teams || [];
        const slot = phase === 'hex_placement_1' ? 1 : 2;
        const slotLabel = slot === 1 ? 'Match 1' : 'Match 2';

        const relevant = (data.pendingHexWins || [])
            .filter(w => w.teamIds && w.teamIds.length > 0)
            .filter(w => w.slot === undefined || w.slot === slot);

        const entries = relevant.flatMap(win =>
            (win.teamIds || []).map((teamId, idx) => ({
                teamId,
                teamName: win.teamNames?.[idx] || `Team ${teamId}`,
                matchNumber: win.matchNumber
            }))
        );

        if (entries.length === 0) {
            return `
                <div class="dm-hex-score-title">${ICON_SVGS.hexagon} ${slotLabel} Hex Placement</div>
                <div class="dm-hex-score-empty">No pending hex placements</div>
            `;
        }

        const rowsHTML = entries.map((entry, i) => {
            const team = teams.find(t => String(t.id) === String(entry.teamId));
            const color = team?.color || '#888';
            const isNext = i === 0;
            return `
                <div class="dm-hex-placement-row${isNext ? ' dm-hex-placement-next' : ''}" style="--c:${color};">
                    ${isNext ? '<span class="dm-hex-placement-badge">Up Next</span>' : ''}
                    <span class="dm-hex-placement-team" style="color:${color};">${team?.name || entry.teamName}</span>
                    <span class="dm-hex-placement-match">#${entry.matchNumber || '?'}</span>
                </div>`;
        }).join('');

        return `
            <div class="dm-hex-score-title">${ICON_SVGS.hexagon} ${slotLabel} Hex Placement</div>
            <div class="dm-hex-score-rows">${rowsHTML}</div>
        `;
    }

    _ensurePrimaryActive() {
        const primary = document.getElementById('displayPrimary');
        if (primary && !primary.classList.contains('active')) {
            primary.classList.add('active');
        }
        this._container.removeAttribute('data-display-mode');
    }

    /**
     * Shared by the ordinary live-matches slide AND challenge_game -- a
     * challenge match previously looked identical to a normal one here
     * (same LIVE badge, same bare player names), with no indication it was
     * a heart-hex challenge at all, let alone which TEAMS were involved --
     * only individual player names showed, so a spectator had no quick way
     * to tell who was challenging whom without already knowing every
     * player's team by heart.
     */
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
            const isChallenge = !!match.isChallenge;
            // A challenge isn't an ordinary "LIVE" match -- it's a
            // heart-hex dispute duel, so it gets its own big banner instead
            // of the generic green LIVE pill, and the TEAM names (not just
            // player names) become the headline, sized to match the game
            // name rather than a small label easy to miss.
            const topBanner = isChallenge
                ? `<div class="dm-challenge-title">${ICON_SVGS.swords} Challenge Game ${ICON_SVGS.swords}</div>`
                : `<div class="dm-live-badge">\u25CF LIVE</div>`;

            // What's at stake: the disputed heart hex, when tagged on the
            // entry (team-raised disputes always tag challengeHexCoord).
            let stakesHTML = '';
            if (isChallenge && match.challengeHexCoord && this._boardModule) {
                const hm = match.challengeHexCoord.match(/q(-?\d+)r(-?\d+)/);
                if (hm) {
                    const hexType = this._boardModule.getHexType(parseInt(hm[1]), parseInt(hm[2]));
                    const hexLabel = hexType === 'mountain-heart' ? 'Mountain Heart (2 pts/round)'
                        : hexType === 'side-heart' ? 'Side Heart (1 pt/round)'
                        : 'Hex';
                    stakesHTML = `<div class="dm-challenge-stakes">${ICON_SVGS.hexagon} Disputing: ${hexLabel}</div>`;
                }
            }

            let sidesHTML = '';
            teams.forEach((teamData, i) => {
                // Side 0 is always the team that RAISED the dispute
                // (team-controls.js's challenge creation puts the raising
                // team's roster first; e2e-team-challenge-button.js asserts
                // this ordering) -- so the separator reads left-to-right as
                // a sentence: "<challenger> CHALLENGES <owner>".
                if (i > 0) sidesHTML += `<div class="dm-vs">${isChallenge && i === 1 ? 'CHALLENGES' : 'VS'}</div>`;
                sidesHTML += '<div class="dm-side">';
                const players = this._getMatchTeamPlayers(teamData);
                if (isChallenge) {
                    const roleLabel = i === 0 ? 'Challenger' : 'Defending';
                    sidesHTML += `<div class="dm-side-role dm-side-role--${i === 0 ? 'challenger' : 'defender'}">${roleLabel}</div>`;
                    // A side isn't necessarily one team -- the same
                    // mixed-roster reality as a regular match side (see the
                    // team.html match-card fix earlier this session).
                    // Collapsing to just players[0]'s team silently hid a
                    // second team sharing the same side. Show one badge per
                    // DISTINCT team actually present, each in that team's
                    // own real color -- never a single side-wide color.
                    const seenTeamIds = new Set();
                    const teamBadges = [];
                    players.forEach(p => {
                        const tid = p.originalTeamId;
                        if (tid == null || seenTeamIds.has(tid)) return;
                        seenTeamIds.add(tid);
                        const teamName = this._getCurrentTeamName(tid);
                        if (!teamName) return;
                        const teamColor = this._getTeamColor(tid);
                        teamBadges.push(`<span class="dm-side-team-name" style="color: ${teamColor}; border-color: ${teamColor};">${teamName}</span>`);
                    });
                    if (teamBadges.length > 0) {
                        sidesHTML += `<div class="dm-side-team-names">${teamBadges.join('')}</div>`;
                    }
                }
                if (isChallenge) {
                    // Challenge rosters run up to 5-a-side across possibly
                    // more than one team. A flat wrapped list interleaved
                    // different teams' players into the same row (e.g. one
                    // team1 box next to one team3 box) -- individually
                    // colored correctly, but with nothing visually
                    // clustering "these are team1's players" vs "these are
                    // team3's". Group into one sub-cluster per team,
                    // matching the badge order above, instead of one flat
                    // wrapped grid.
                    const byTeam = new Map();
                    players.forEach(p => {
                        const tid = p.originalTeamId;
                        if (!byTeam.has(tid)) byTeam.set(tid, []);
                        byTeam.get(tid).push(p);
                    });
                    sidesHTML += '<div class="dm-side-players">';
                    byTeam.forEach(teamPlayers => {
                        sidesHTML += '<div class="dm-side-team-group">';
                        teamPlayers.forEach(p => {
                            const color = this._getPlayerCurrentColor(p);
                            sidesHTML += `<div class="dm-player-name dm-player-name--sub" style="border-color: ${color}; color: ${color};">${this._getPlayerCurrentName(p)}</div>`;
                        });
                        sidesHTML += '</div>';
                    });
                    sidesHTML += '</div>';
                } else {
                    players.forEach(p => {
                        const color = this._getPlayerCurrentColor(p);
                        sidesHTML += `<div class="dm-player-name" style="border-color: ${color}; color: ${color};">${this._getPlayerCurrentName(p)}</div>`;
                    });
                }
                sidesHTML += '</div>';
            });

            matchesHTML += `
                <div class="dm-live-match-large${isChallenge ? ' dm-live-match-large--challenge' : ''}">
                    ${topBanner}
                    <div class="dm-game-header">${logoHtml}<span class="dm-game-name">${gameName}</span></div>
                    ${stakesHTML}
                    <div class="dm-sides">${sidesHTML}</div>
                </div>
            `;
        });

        container.innerHTML = `<div class="dm-live-matches-wrapper">${matchesHTML}</div>`;
    }

    /**
     * Latest Results slide. Used to show only the winning side's names and
     * a static "Winner" badge -- no match number, no opponent, no way to
     * tell which specific game a result belonged to. Rebuilt to match the
     * matches_dual_slot look: match number + game name, both sides shown
     * VS-style with the winning side highlighted (same .dm-dual-* classes
     * as _renderMatchResult, for visual consistency and the same big
     * on-screen sizing).
     */
    _renderResultsLarge(container, data) {
        const resultLogCache = this._getResultLogCache();
        // 4, not 5 -- the screen is a fixed 1920x1080 with a title above and
        // the score strip below, no scrolling, and real matches here can run
        // up to 5-a-side, so the safe budget is tighter than it looks.
        const recent = resultLogCache.slice(0, 4);

        if (recent.length === 0) {
            container.innerHTML = '<div class="dm-results-large"><div class="dm-results-title">No Results Yet</div></div>';
            return;
        }

        const sideFields = ['sideAPlayers', 'sideBPlayers', 'sideCPlayers'];
        const sideLetters = ['A', 'B', 'C'];

        let rowsHTML = '';
        recent.forEach(event => {
            const gameName = event.gameName || 'Match';
            const gameLabel = event.matchNumber ? `#${event.matchNumber} ${gameName}` : gameName;

            // Prefer the full per-side arrays (every game_win event logs
            // these) so both winner AND loser show; fall back to the
            // flat winningPlayers/losingPlayers lists for older cached
            // events logged before sideAPlayers/sideBPlayers existed.
            let sides = sideFields
                .map((field, i) => ({ players: event[field] || [], isWinner: sideLetters[i] === event.winningSide }))
                .filter(s => s.players.length > 0);
            if (sides.length === 0) {
                const winners = event.winningPlayers || [];
                const losers = event.losingPlayers || [];
                if (winners.length > 0) sides.push({ players: winners, isWinner: true });
                if (losers.length > 0) sides.push({ players: losers, isWinner: false });
            }

            const sidesHTML = sides.map((side, i) => {
                const rows = side.players.map(p => {
                    const color = this._getTeamColor(p.originalTeamId) || p.originalTeamColor || '#888';
                    return `<div class="dm-dual-ready-row"><span class="dm-dual-ready-name" style="color:${color};">${p.name || '?'}</span></div>`;
                }).join('');
                const label = `<div class="dm-dual-winner-label"${side.isWinner ? '' : ' style="visibility:hidden;"'}>${ICON_SVGS.crown} Winner</div>`;
                const col = `<div class="dm-dual-ready-side${side.isWinner ? ' dm-dual-winner-side' : ''}">${label}${rows}</div>`;
                return (i > 0 ? '<div class="dm-dual-vs">VS</div>' : '') + col;
            }).join('');

            rowsHTML += `
                <div class="dm-result-card">
                    <div class="dm-result-game">${gameLabel}</div>
                    <div class="dm-dual-ready-sides">${sidesHTML}</div>
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
