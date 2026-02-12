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

        // Restore state from gameState if available
        this.restoreState();
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

        // Build rotation with smart repeat counts
        // Split format games (3v3+2v2) create 2 matches per "rotation", so they get lower repeat
        this.gameRotation.games = selectedGames.map(gameId => {
            const format = this.getGameFormat(gameId);
            const isSplitFormat = format === '3v3+2v2';

            return {
                gameId,
                format,
                // Split format games repeat 1-2 times, regular games 2-3 times
                // This balances the total match count per game
                repeatMin: isSplitFormat ? 1 : 2,
                repeatMax: isSplitFormat ? 2 : 3,
                repeatCount: isSplitFormat ? 2 : 3  // Default to max
            };
        });
    }

    /**
     * Restore optimizer and rotation state from gameState
     */
    restoreState() {
        const saved = this.gameState?.smartMatchState;

        if (saved) {
            // Restore optimizer matrices
            if (saved.optimizer) {
                this.optimizer.W = saved.optimizer.W || {};
                this.optimizer.A = saved.optimizer.A || {};
                this.optimizer.splitCounts = saved.optimizer.splitCounts || {};
                this.optimizer.lastSplitMatch = saved.optimizer.lastSplitMatch || {};
                this.optimizer.currentMatchNumber = saved.optimizer.currentMatchNumber || 0;
                this.optimizer.totalMatches = saved.optimizer.totalMatches || { '5v5': 0, '3v3': 0, '2v2': 0 };
            }

            // Restore game rotation
            if (saved.gameRotation) {
                this.gameRotation = saved.gameRotation;
            } else {
                this.initializeGameRotation();
            }
        } else {
            // First time - initialize from scratch
            this.initializeGameRotation();

            // Rebuild optimizer state from existing match history
            this.rebuildFromHistory();
        }
    }

    /**
     * Rebuild optimizer matrices from existing match history
     */
    rebuildFromHistory() {
        const gameQueue = this.gameState?.gameQueue || [];

        // Find completed matches to rebuild state
        const completedMatches = gameQueue.filter(m => m.status === 'completed' && !m.isChallenge);

        if (completedMatches.length > 0) {
            console.log(`SmartMatchGenerator: Rebuilding state from ${completedMatches.length} completed matches`);

            completedMatches.forEach(match => {
                // Try to extract player assignments from match
                if (match.teams && match.teams.length >= 2) {
                    const sideAPlayers = this.extractPlayerIds(match.teams[0]);
                    const sideBPlayers = this.extractPlayerIds(match.teams[1]);

                    if (sideAPlayers.length > 0 && sideBPlayers.length > 0) {
                        this.optimizer.applyPartition(sideAPlayers, sideBPlayers);
                    }
                }

                // Track split team
                if (match.splitTeamId) {
                    this.optimizer.splitCounts[match.splitTeamId] =
                        (this.optimizer.splitCounts[match.splitTeamId] || 0) + 1;
                }

                // Track match type
                if (match.playType) {
                    this.optimizer.totalMatches[match.playType] =
                        (this.optimizer.totalMatches[match.playType] || 0) + 1;
                }
            });

            this.optimizer.currentMatchNumber = completedMatches.length;
        }

        // Also count pending/ongoing matches for rotation position
        const allNormalMatches = gameQueue.filter(m => !m.isChallenge);
        this.gameRotation.totalMatchesGenerated = allNormalMatches.length;
    }

    /**
     * Extract player IDs from a match team in various formats
     */
    extractPlayerIds(matchTeam) {
        if (!matchTeam) return [];

        // Format 1: players array with originalTeamId
        if (matchTeam.players && Array.isArray(matchTeam.players)) {
            return matchTeam.players.map(p => {
                // Convert to optimizer format: "1a", "1b", "2a", etc.
                const teamId = p.originalTeamId || p.teamId;
                const playerIdx = this.getPlayerIndexInTeam(p, teamId);
                return `${teamId}${String.fromCharCode(97 + playerIdx)}`;
            }).filter(id => /^\d[a-z]$/.test(id));
        }

        // Format 2: playerIds array
        if (matchTeam.playerIds && Array.isArray(matchTeam.playerIds)) {
            return matchTeam.playerIds.map(pid => {
                const player = this.gameState?.players?.[pid];
                if (player) {
                    const teamId = player.teamId;
                    const team = this.teams.find(t => t.id === teamId);
                    const playerIdx = team?.players?.findIndex(p => p.id === pid) || 0;
                    return `${teamId}${String.fromCharCode(97 + playerIdx)}`;
                }
                return null;
            }).filter(Boolean);
        }

        return [];
    }

    /**
     * Get player index within their team (0 or 1)
     */
    getPlayerIndexInTeam(player, teamId) {
        const team = this.teams.find(t => String(t.id) === String(teamId));
        if (!team || !team.players) return 0;

        const idx = team.players.findIndex(p =>
            p.id === player.id || p.name === player.name
        );
        return Math.max(0, idx);
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

        // Check if we should move to next game
        // Dynamically choose repeat count between min and max for variety
        const targetRepeat = this.calculateTargetRepeat(currentGame);

        if (this.gameRotation.currentRepeat >= targetRepeat) {
            this.gameRotation.currentIndex++;
            this.gameRotation.currentRepeat = 0;
        }
    }

    /**
     * Calculate target repeat count for current position
     * Varies between min and max to create natural-feeling rotation
     */
    calculateTargetRepeat(game) {
        const { repeatMin, repeatMax } = game;

        // Use total matches to create a pattern: 3, 2, 3, 2, 2, 3...
        // This prevents predictable repetition while staying in range
        const totalGames = this.gameRotation.games.length;
        const cyclePosition = Math.floor(this.gameRotation.totalMatchesGenerated / totalGames) % 3;

        if (cyclePosition === 1) {
            return repeatMin;
        }
        return repeatMax;
    }

    /**
     * Generate the next match using smart optimization
     * Returns match data ready for the queue
     */
    generateNext() {
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
     * Preview the next N matches without applying them
     */
    previewNext(count = 5) {
        // Save current state
        const savedState = JSON.parse(JSON.stringify(this.getState()));

        const previews = [];
        for (let i = 0; i < count; i++) {
            const result = this.generateNext();
            if (result.error) break;

            previews.push({
                index: i + 1,
                gameId: result.gameId,
                format: result.format,
                splitTeam: result.splitTeamName,
                matchCount: result.matches.length
            });
        }

        // Restore state
        this.optimizer.W = savedState.optimizer.W;
        this.optimizer.A = savedState.optimizer.A;
        this.optimizer.splitCounts = savedState.optimizer.splitCounts;
        this.optimizer.lastSplitMatch = savedState.optimizer.lastSplitMatch;
        this.optimizer.currentMatchNumber = savedState.optimizer.currentMatchNumber;
        this.optimizer.totalMatches = savedState.optimizer.totalMatches;
        this.gameRotation = savedState.gameRotation;

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
