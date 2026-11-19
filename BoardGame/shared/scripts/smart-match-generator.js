/**
 * SMART MATCH GENERATOR
 *
 * Combines BalanceOptimizer with intelligent game rotation to create
 * statistically balanced matches across an entire tournament.
 *
 * Features:
 * - Greedy variance minimization for player pairings (W and A matrices)
 * - No team split twice in a row (heavy penalty)
 * - Game rotation with configurable repeat counts (1-3 per game)
 * - Supports both 5v5 and 3v3+2v2 formats
 * - Persistent state for session continuity
 */

class SmartMatchGenerator {
    constructor(gameState) {
        this.gameState = gameState;
        this.teams = gameState?.teams || [];

        // Initialize or restore the BalanceOptimizer
        this.optimizer = new BalanceOptimizer(5, 2);

        // Game rotation state
        this.gameRotation = {
            games: [],           // Array of { gameId, format, repeatCount }
            currentIndex: 0,     // Current position in the rotation
            currentRepeat: 0,    // How many times we've played the current game
            totalMatchesGenerated: 0
        };

        // Default game formats (can be overridden by gameState.gameDefinitions)
        this.defaultFormats = {
            'cs2': '5v5',
            'predecessor': '5v5',
            'valorant': '5v5',
            'dota2': '5v5',
            'aoe4': '3v3+2v2',
            'sc2': '3v3+2v2',
            'starcraft2': '3v3+2v2',
            'rocketleague': '3v3'
        };

        // All state is derived from gameState.gameQueue (see rebuildFromQueue);
        // nothing is persisted between generations.
        this.initializeGameRotation();
        this.rebuildFromQueue();
    }

    /**
     * Get the format for a game (5v5, 3v3+2v2, etc.)
     */
    getGameFormat(gameId) {
        // First check tournament's gameDefinitions
        if (this.gameState?.gameDefinitions?.[gameId]?.format) {
            return this.gameState.gameDefinitions[gameId].format;
        }
        // Fall back to defaults
        return this.defaultFormats[gameId] || '5v5';
    }

    /**
     * Initialize game rotation from tournament's selectedGames
     */
    initializeGameRotation() {
        const selectedGames = this.gameState?.selectedGames || ['cs2'];

        // Each game gets 3 full sets before rotating to the next game
        // For 5v5: 3 matches. For 3v3+2v2: 3 pairs = 6 individual matches.
        this.gameRotation.games = selectedGames.map(gameId => {
            const format = this.getGameFormat(gameId);
            return {
                gameId,
                format,
                repeatCount: 3
            };
        });
    }

    /**
     * Rebuild game rotation position by analyzing the existing queue.
     * Collapses simultaneous 3v3+2v2 pairs into single "sets" and
     * counts consecutive sets of the last game to determine currentIndex/currentRepeat.
     */
    rebuildRotationPosition(gameQueue) {
        const allNormalMatches = gameQueue.filter(m => !m.isChallenge && !m.isBreak);

        if (allNormalMatches.length === 0 || this.gameRotation.games.length === 0) {
            this.gameRotation.totalMatchesGenerated = 0;
            return;
        }

        // Collapse simultaneous pairs into "sets" (each set = one rotation step)
        const sets = [];
        let i = 0;
        while (i < allNormalMatches.length) {
            const match = allNormalMatches[i];
            sets.push(match.game);

            // If simultaneous, skip its paired match
            if (match.isSimultaneous && i + 1 < allNormalMatches.length) {
                const next = allNormalMatches[i + 1];
                if (next.game === match.game && next.isSimultaneous) {
                    i++;
                }
            }
            i++;
        }

        this.gameRotation.totalMatchesGenerated = sets.length;

        // Count consecutive sets of the same game at the tail of the queue
        const lastGame = sets[sets.length - 1];
        let consecutiveCount = 0;
        for (let j = sets.length - 1; j >= 0; j--) {
            if (sets[j] === lastGame) {
                consecutiveCount++;
            } else {
                break;
            }
        }

        // Find this game in the rotation
        const gameIdx = this.gameRotation.games.findIndex(g => g.gameId === lastGame);

        if (gameIdx >= 0) {
            const game = this.gameRotation.games[gameIdx];

            if (consecutiveCount >= game.repeatCount) {
                // Last game's rotation is complete → next game
                this.gameRotation.currentIndex = gameIdx + 1;
                this.gameRotation.currentRepeat = 0;
            } else {
                // Still in this game's rotation
                this.gameRotation.currentIndex = gameIdx;
                this.gameRotation.currentRepeat = consecutiveCount;
            }
        }

        console.log(`SmartMatchGenerator: Rebuilt rotation from ${sets.length} sets. ` +
            `Position: game[${this.gameRotation.currentIndex % this.gameRotation.games.length}] ` +
            `(${this.getCurrentGame()?.gameId}), repeat ${this.gameRotation.currentRepeat}`);
    }

    /**
     * The team with players on both sides is the split ("hajotettu") team.
     * Optimizer ids are "<teamId><a|b>", e.g. "3a".
     */
    static deriveSplitTeamId(sideAIds, sideBIds) {
        const teamsA = new Set(sideAIds.map(id => id.charAt(0)));
        const both = [...new Set(sideBIds.map(id => id.charAt(0)))].filter(t => teamsA.has(t));
        return both.length === 1 ? parseInt(both[0], 10) : null;
    }

    /**
     * Map one side of a queue entry to optimizer ids. Handles both stored
     * shapes: `players` objects (auto-generated matches) and `playerIds`
     * (manual and imported matches, resolved via gameState.players).
     * Players that can't be resolved are skipped, never mapped to a bogus id.
     */
    resolveOptimizerIds(matchTeam) {
        if (!matchTeam) return [];
        const out = [];
        const teamOf = (teamId) => this.teams.find(t => String(t.id) === String(teamId));
        const push = (team, idx) => {
            if (!team || idx < 0) return;
            const id = `${team.id}${String.fromCharCode(97 + idx)}`;
            if (/^\d[a-z]$/.test(id)) out.push(id);
        };

        if (Array.isArray(matchTeam.players)) {
            matchTeam.players.forEach(p => {
                const team = teamOf(p.originalTeamId ?? p.teamId);
                if (!team) return;
                const idx = (team.players || []).findIndex(tp =>
                    (p.id && tp.id === p.id) || (p.name && tp.name === p.name));
                push(team, idx);
            });
        } else if (Array.isArray(matchTeam.playerIds)) {
            matchTeam.playerIds.forEach(pid => {
                const reg = this.gameState?.players?.[pid];
                const team = reg
                    ? teamOf(reg.teamId)
                    : this.teams.find(t => (t.players || []).some(tp => tp.id === pid));
                if (!team) return;
                push(team, (team.players || []).findIndex(tp => tp.id === pid));
            });
        }
        return out;
    }

    /**
     * Rebuild ALL generator state from gameState.gameQueue: pairing matrices
     * (W/A), split counts, last-split positions and the game-rotation
     * position. Counts every non-challenge, non-break entry whatever its
     * status, so manual, edited and deleted matches are always reflected.
     * A simultaneous pair (3v3+2v2) is one set, i.e. one optimizer match.
     */
    rebuildFromQueue() {
        this.teams = this.gameState?.teams || [];
        this.optimizer.reset();
        this.initializeGameRotation();
        this.gameRotation.currentIndex = 0;
        this.gameRotation.currentRepeat = 0;
        this.gameRotation.totalMatchesGenerated = 0;

        const queue = this.gameState?.gameQueue || [];
        const normal = queue.filter(m => !m.isChallenge && !m.isBreak);

        let i = 0;
        while (i < normal.length) {
            const set = [normal[i]];
            const next = normal[i + 1];
            if (normal[i].isSimultaneous && next && next.isSimultaneous && next.game === normal[i].game) {
                set.push(next);
                i++;
            }
            i++;

            this.optimizer.advanceMatch();
            let splitTeam = null;
            set.forEach(match => {
                const sides = match.teams || [];
                if (sides.length < 2) return;
                const a = this.resolveOptimizerIds(sides[0]);
                const b = this.resolveOptimizerIds(sides[1]);
                if (a.length === 0 || b.length === 0) return;
                this.optimizer.applyPartition(a, b);
                if (match.playType && this.optimizer.totalMatches[match.playType] !== undefined) {
                    this.optimizer.totalMatches[match.playType]++;
                }
                const s = match.splitTeamId ?? SmartMatchGenerator.deriveSplitTeamId(a, b);
                if (s !== null && s !== undefined && splitTeam === null) splitTeam = s;
            });
            if (splitTeam !== null && this.optimizer.splitCounts[splitTeam] !== undefined) {
                this.optimizer.recordSplit(splitTeam);
            }
        }

        this.rebuildRotationPosition(queue);
    }

    /**
     * Get the current game in the rotation
     */
    getCurrentGame() {
        if (this.gameRotation.games.length === 0) {
            this.initializeGameRotation();
        }

        const idx = this.gameRotation.currentIndex % this.gameRotation.games.length;
        return this.gameRotation.games[idx];
    }

    /**
     * Advance to the next game in rotation (called after repeat count reached)
     */
    advanceGameRotation() {
        this.gameRotation.currentRepeat++;

        const currentGame = this.getCurrentGame();

        // Move to next game after repeatCount full sets
        if (this.gameRotation.currentRepeat >= currentGame.repeatCount) {
            this.gameRotation.currentIndex++;
            this.gameRotation.currentRepeat = 0;
        }
    }

    /**
     * Generate the next match. Rebuilds from the live queue first, so the
     * suggestion always reflects manual, edited and deleted matches.
     */
    generateNext() {
        this.rebuildFromQueue();
        return this._generateFromCurrentState();
    }

    /**
     * Generate the next match from the generator's current in-memory state
     * (used by generateNext after a rebuild, and by previewNext to step
     * forward several matches). Returns match data ready for the queue.
     */
    _generateFromCurrentState() {
        // Validate teams
        if (this.teams.length < 5) {
            return {
                error: true,
                message: `Need exactly 5 teams. Currently have ${this.teams.length}.`
            };
        }

        // Check each team has 2 players
        const invalidTeams = this.teams.filter(t => !t.players || t.players.length !== 2);
        if (invalidTeams.length > 0) {
            return {
                error: true,
                message: `Each team needs exactly 2 players. Problems: ${invalidTeams.map(t => t.name).join(', ')}`
            };
        }

        // Get current game in rotation
        const currentGame = this.getCurrentGame();
        const format = currentGame.format;

        // Advance optimizer match counter
        this.optimizer.advanceMatch();

        let result;

        if (format === '3v3+2v2') {
            result = this.generate3v3_2v2Match(currentGame.gameId);
        } else {
            result = this.generate5v5Match(currentGame.gameId);
        }

        // Advance game rotation
        this.advanceGameRotation();
        this.gameRotation.totalMatchesGenerated++;

        // Add metadata
        result.rotationInfo = {
            gameIndex: this.gameRotation.currentIndex,
            repeatNumber: this.gameRotation.currentRepeat,
            totalGenerated: this.gameRotation.totalMatchesGenerated,
            gamesInRotation: this.gameRotation.games.length
        };

        return result;
    }

    /**
     * Generate a 5v5 match
     */
    generate5v5Match(gameId) {
        const selection = this.optimizer.selectOptimal5v5();
        const partition = selection.partition;

        // Apply to optimizer matrices
        this.optimizer.applyPartition(partition.sideA, partition.sideB);
        this.optimizer.recordSplit(partition.splitTeam);
        this.optimizer.totalMatches['5v5']++;

        // Convert optimizer player IDs to actual player objects
        const sideAPlayers = this.convertToPlayerObjects(partition.sideA, partition.splitTeam, 'A');
        const sideBPlayers = this.convertToPlayerObjects(partition.sideB, partition.splitTeam, 'B');

        // Get team names
        const sideATeamNames = partition.sideATeams.map(id => this.getTeamName(id));
        const sideBTeamNames = partition.sideBTeams.map(id => this.getTeamName(id));
        const splitTeamName = this.getTeamName(partition.splitTeam);

        return {
            error: false,
            format: '5v5',
            gameId,
            matches: [{
                format: '5v5',
                teams: [
                    {
                        name: 'TEAM A',
                        players: sideAPlayers,
                        fullTeams: partition.sideATeams,
                        fullTeamNames: sideATeamNames
                    },
                    {
                        name: 'TEAM B',
                        players: sideBPlayers,
                        fullTeams: partition.sideBTeams,
                        fullTeamNames: sideBTeamNames
                    }
                ],
                splitTeamId: partition.splitTeam,
                splitTeamName
            }],
            splitTeamId: partition.splitTeam,
            splitTeamName,
            sideADescription: `${sideATeamNames.join(' + ')} + 1 from ${splitTeamName}`,
            sideBDescription: `${sideBTeamNames.join(' + ')} + 1 from ${splitTeamName}`,
            splitDescription: `${splitTeamName} is split`,
            costDelta: selection.costDelta,
            balanceStats: this.optimizer.getBalanceStats(),
            splitStats: this.optimizer.getSplitStats()
        };
    }

    /**
     * Generate a 3v3+2v2 match pair
     */
    generate3v3_2v2Match(gameId) {
        const selection = this.optimizer.selectOptimal3v3_2v2();
        const partition = selection.partition;

        // Apply both matches to optimizer matrices
        this.optimizer.applyPartition(partition.match3v3.sideA, partition.match3v3.sideB);
        this.optimizer.applyPartition(partition.match2v2.sideA, partition.match2v2.sideB);
        this.optimizer.recordSplit(partition.splitTeam);
        this.optimizer.totalMatches['3v3']++;
        this.optimizer.totalMatches['2v2']++;

        // Convert optimizer player IDs to actual player objects
        const match3v3SideA = this.convertToPlayerObjects(partition.match3v3.sideA, partition.splitTeam, 'A');
        const match3v3SideB = this.convertToPlayerObjects(partition.match3v3.sideB, partition.splitTeam, 'B');
        const match2v2SideA = this.convertToPlayerObjects(partition.match2v2.sideA, null, 'A');
        const match2v2SideB = this.convertToPlayerObjects(partition.match2v2.sideB, null, 'B');

        // Get team names
        const team3v3A = this.getTeamName(partition.match3v3.sideATeam);
        const team3v3B = this.getTeamName(partition.match3v3.sideBTeam);
        const team2v2A = this.getTeamName(partition.match2v2.sideATeam);
        const team2v2B = this.getTeamName(partition.match2v2.sideBTeam);
        const splitTeamName = this.getTeamName(partition.splitTeam);

        return {
            error: false,
            format: '3v3+2v2',
            gameId,
            matches: [
                {
                    format: '3v3',
                    teams: [
                        {
                            name: 'TEAM A',
                            players: match3v3SideA,
                            fullTeams: [partition.match3v3.sideATeam],
                            fullTeamNames: [team3v3A]
                        },
                        {
                            name: 'TEAM B',
                            players: match3v3SideB,
                            fullTeams: [partition.match3v3.sideBTeam],
                            fullTeamNames: [team3v3B]
                        }
                    ],
                    splitTeamId: partition.splitTeam,
                    splitTeamName,
                    isSimultaneous: true
                },
                {
                    format: '2v2',
                    teams: [
                        {
                            name: 'TEAM A',
                            players: match2v2SideA,
                            fullTeams: [partition.match2v2.sideATeam],
                            fullTeamNames: [team2v2A]
                        },
                        {
                            name: 'TEAM B',
                            players: match2v2SideB,
                            fullTeams: [partition.match2v2.sideBTeam],
                            fullTeamNames: [team2v2B]
                        }
                    ],
                    splitTeamId: null, // 2v2 has no split
                    isSimultaneous: true
                }
            ],
            splitTeamId: partition.splitTeam,
            splitTeamName,
            sideADescription: `3v3: ${team3v3A} + 1 from ${splitTeamName} | 2v2: ${team2v2A}`,
            sideBDescription: `3v3: ${team3v3B} + 1 from ${splitTeamName} | 2v2: ${team2v2B}`,
            splitDescription: `${splitTeamName} is split (in 3v3 match)`,
            costDelta: selection.costDelta,
            balanceStats: this.optimizer.getBalanceStats(),
            splitStats: this.optimizer.getSplitStats()
        };
    }

    /**
     * Convert optimizer player IDs (like "1a", "2b") to actual player objects
     */
    convertToPlayerObjects(playerIds, splitTeamId, side) {
        return playerIds.map(pid => {
            const teamId = parseInt(pid.charAt(0));
            const playerIdx = pid.charCodeAt(1) - 97; // 'a' = 0, 'b' = 1

            const team = this.teams.find(t => t.id === teamId || String(t.id) === String(teamId));
            if (!team || !team.players || !team.players[playerIdx]) {
                return {
                    id: pid,
                    name: `Player ${pid}`,
                    originalTeamId: teamId,
                    originalTeamName: `Team ${teamId}`,
                    originalTeamColor: this.getTeamColor(teamId),
                    isSplit: teamId === splitTeamId
                };
            }

            const player = team.players[playerIdx];
            return {
                id: player.id || player.uid || pid,
                name: player.name,
                originalTeamId: teamId,
                originalTeamName: team.name || `Team ${teamId}`,
                originalTeamColor: team.color || this.getTeamColor(teamId),
                isSplit: teamId === splitTeamId
            };
        });
    }

    /**
     * Get team name by ID
     */
    getTeamName(teamId) {
        const team = this.teams.find(t => t.id === teamId || String(t.id) === String(teamId));
        return team?.name || `Team ${teamId}`;
    }

    /**
     * Get team color by ID
     */
    getTeamColor(teamId) {
        const colors = {
            1: '#de392c', // Red
            2: '#2278a3', // Blue
            3: '#2e9158', // Green
            4: '#f7ba32', // Yellow
            5: '#22241d'  // Black
        };
        const team = this.teams.find(t => t.id === teamId || String(t.id) === String(teamId));
        return team?.color || colors[teamId] || '#666666';
    }

    /**
     * Get current state for persistence
     */
    getState() {
        return {
            optimizer: {
                W: this.optimizer.W,
                A: this.optimizer.A,
                splitCounts: this.optimizer.splitCounts,
                lastSplitMatch: this.optimizer.lastSplitMatch,
                currentMatchNumber: this.optimizer.currentMatchNumber,
                totalMatches: this.optimizer.totalMatches
            },
            gameRotation: this.gameRotation
        };
    }

    /**
     * Reset all state (for new tournament)
     */
    reset() {
        this.optimizer.reset();
        this.initializeGameRotation();
        this.gameRotation.currentIndex = 0;
        this.gameRotation.currentRepeat = 0;
        this.gameRotation.totalMatchesGenerated = 0;
    }

    /**
     * Get statistics about current balance
     */
    getStats() {
        return {
            balance: this.optimizer.getBalanceStats(),
            splits: this.optimizer.getSplitStats(),
            rotation: {
                currentGame: this.getCurrentGame()?.gameId,
                currentRepeat: this.gameRotation.currentRepeat,
                totalGenerated: this.gameRotation.totalMatchesGenerated,
                gamesInRotation: this.gameRotation.games.map(g => g.gameId)
            }
        };
    }

    /**
     * Preview the next N matches without changing anything. Steps forward
     * from the current queue N times, then rebuilds so no state leaks.
     */
    previewNext(count = 5) {
        this.rebuildFromQueue();
        const previews = [];
        for (let i = 0; i < count; i++) {
            const result = this._generateFromCurrentState();
            if (result.error) break;
            previews.push({
                index: i + 1,
                gameId: result.gameId,
                format: result.format,
                splitTeam: result.splitTeamName,
                matchCount: result.matches.length
            });
        }
        this.rebuildFromQueue();
        return previews;
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.SmartMatchGenerator = SmartMatchGenerator;
}

// Export for Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmartMatchGenerator;
}
