/**
 * MATCH SCHEDULER
 * Handles tournament match generation with Rotating Split-Team System
 * 
 * System: One team is always split between two sides (TEAM_A and TEAM_B)
 * The split team rotates each round for fair distribution
 */

class MatchScheduler {
    constructor(teams, games) {
        this.teams = teams || [];
        this.games = games || [];
        this.matches = [];
        this.currentSplitTeamIndex = 0;
    }

    /**
     * Generate matches using Rotating Split-Team System
     * 
     * Pattern for 5 teams:
     * Round 1: Team5 splits → TEAM_A: [1,2,5a] vs TEAM_B: [3,4,5b]
     * Round 2: Team4 splits → TEAM_A: [1,2,4a] vs TEAM_B: [3,5,4b]
     * Round 3: Team3 splits → TEAM_A: [1,2,3a] vs TEAM_B: [4,5,3b]
     * Round 4: Team2 splits → TEAM_A: [1,4,2a] vs TEAM_B: [3,5,2b]
     * Round 5: Team1 splits → TEAM_A: [2,4,1a] vs TEAM_B: [3,5,1b]
     * 
     * Game rotation: Max 3 of same game consecutively, then rotate
     * Example: CS2, CS2, CS2, Dota2, Dota2, Dota2, Valorant...
     * 
     * @param {Object} options - Configuration options
     * @returns {Array} Array of match objects
     */
    generateRotatingSplitTeam(options = {}) {
        const {
            maxConsecutiveGames = 3,  // Max same game in a row
            startFromTeam = null,
            totalMatches = null  // If null, generates full rotation cycle
        } = options;

        if (this.teams.length < 3) {
            throw new Error('Need at least 3 teams for Rotating Split-Team System');
        }

        if (this.games.length === 0) {
            throw new Error('Need at least 1 game');
        }

        this.matches = [];
        
        // Calculate how many matches to generate
        const matchCount = totalMatches || (this.teams.length * this.games.length * maxConsecutiveGames);
        
        // Determine starting split team
        this.currentSplitTeamIndex = startFromTeam !== null 
            ? startFromTeam 
            : this.teams.length - 1; // Start with last team by default

        let matchId = 1;
        let currentGameIndex = 0;
        let consecutiveGameCount = 0;

        // Generate matches
        for (let i = 0; i < matchCount; i++) {
            // Get current game
            const game = this.games[currentGameIndex];
            
            // Get current split team
            const splitTeamIndex = this.currentSplitTeamIndex;
            const splitTeam = this.teams[splitTeamIndex];
            
            // Validate split team has 2 players
            if (!splitTeam.players || splitTeam.players.length < 2) {
                throw new Error(`Team ${splitTeam.name} must have at least 2 players`);
            }

            const [playerA, playerB] = splitTeam.players;

            // Build TEAM_A and TEAM_B
            const teamA = this.buildTeamA(splitTeamIndex, playerA);
            const teamB = this.buildTeamB(splitTeamIndex, playerB);

            // Calculate round number (each full team rotation = 1 round)
            const round = Math.floor(i / this.teams.length) + 1;
            const subRound = (i % this.teams.length) + 1;

            // Create match object
            const match = {
                id: matchId++,
                round: round,
                subRound: subRound,
                game: game,
                gameSequence: consecutiveGameCount + 1, // Which occurrence of this game (1st, 2nd, 3rd)
                splitTeam: {
                    id: splitTeam.id,
                    name: splitTeam.name,
                    color: splitTeam.color
                },
                teamA: teamA,
                teamB: teamB,
                status: 'waiting',
                winner: null,
                timestamp: null
            };

            this.matches.push(match);

            // Rotate split team (backwards through team list)
            this.currentSplitTeamIndex = (this.currentSplitTeamIndex - 1 + this.teams.length) % this.teams.length;

            // Handle game rotation
            consecutiveGameCount++;
            
            // After maxConsecutiveGames of same game, rotate to next game
            if (consecutiveGameCount >= maxConsecutiveGames) {
                currentGameIndex = (currentGameIndex + 1) % this.games.length;
                consecutiveGameCount = 0;
            }
        }

        return this.matches;
    }

    /**
     * Build TEAM_A composition
     * Default: Team1 + Team2 + one player from split team
     */
    buildTeamA(splitTeamIndex, splitPlayer) {
        const team = {
            name: 'TEAM_A',
            players: [],
            teams: []
        };

        // Add full teams (excluding split team)
        for (let i = 0; i < Math.ceil(this.teams.length / 2) - 1; i++) {
            if (i !== splitTeamIndex) {
                const fullTeam = this.teams[i];
                team.teams.push({
                    id: fullTeam.id,
                    name: fullTeam.name,
                    color: fullTeam.color
                });
                team.players.push(...fullTeam.players);
            }
        }

        // Add one player from split team
        team.players.push({
            ...splitPlayer,
            fromSplitTeam: true
        });

        return team;
    }

    /**
     * Build TEAM_B composition
     * Default: Team3 + Team4 + one player from split team
     */
    buildTeamB(splitTeamIndex, splitPlayer) {
        const team = {
            name: 'TEAM_B',
            players: [],
            teams: []
        };

        // Add full teams (excluding split team)
        const halfPoint = Math.ceil(this.teams.length / 2) - 1;
        for (let i = halfPoint; i < this.teams.length; i++) {
            if (i !== splitTeamIndex) {
                const fullTeam = this.teams[i];
                team.teams.push({
                    id: fullTeam.id,
                    name: fullTeam.name,
                    color: fullTeam.color
                });
                team.players.push(...fullTeam.players);
            }
        }

        // Add one player from split team
        team.players.push({
            ...splitPlayer,
            fromSplitTeam: true
        });

        return team;
    }

    /**
     * Generate traditional Round-Robin schedule
     * Every team plays every other team
     */
    generateRoundRobin() {
        this.matches = [];
        let matchId = 1;

        for (const game of this.games) {
            for (let i = 0; i < this.teams.length; i++) {
                for (let j = i + 1; j < this.teams.length; j++) {
                    this.matches.push({
                        id: matchId++,
                        game: game,
                        team1: this.teams[i],
                        team2: this.teams[j],
                        status: 'waiting',
                        winner: null,
                        timestamp: null
                    });
                }
            }
        }

        return this.matches;
    }

    /**
     * Validate the generated schedule
     * Check for balance, fairness, and edge cases
     */
    validate() {
        const validation = {
            valid: true,
            errors: [],
            warnings: [],
            stats: {}
        };

        if (this.matches.length === 0) {
            validation.valid = false;
            validation.errors.push('No matches generated');
            return validation;
        }

        // Validate game rotation (max 3 consecutive)
        const gameRotation = this.validateGameRotation(3);
        if (!gameRotation.valid) {
            validation.warnings.push(gameRotation.message);
            validation.stats.gameRotationViolations = gameRotation.violations;
        }

        // Count how many times each team is split
        const splitCounts = {};
        this.teams.forEach(team => {
            splitCounts[team.id] = 0;
        });

        this.matches.forEach(match => {
            if (match.splitTeam) {
                splitCounts[match.splitTeam.id]++;
            }
        });

        // Check if splits are balanced
        const splitValues = Object.values(splitCounts);
        const maxSplits = Math.max(...splitValues);
        const minSplits = Math.min(...splitValues);

        if (maxSplits - minSplits > 1) {
            validation.warnings.push(`Uneven split distribution: ${minSplits}-${maxSplits} splits per team`);
        }

        // Check each team appears fair number of times
        const appearances = {};
        this.teams.forEach(team => {
            appearances[team.id] = 0;
        });

        this.matches.forEach(match => {
            if (match.teamA) {
                match.teamA.teams?.forEach(t => appearances[t.id]++);
            }
            if (match.teamB) {
                match.teamB.teams?.forEach(t => appearances[t.id]++);
            }
        });

        // Check game distribution
        const gameDistribution = {};
        this.matches.forEach(match => {
            if (!gameDistribution[match.game]) {
                gameDistribution[match.game] = 0;
            }
            gameDistribution[match.game]++;
        });

        validation.stats = {
            totalMatches: this.matches.length,
            totalRounds: Math.max(...this.matches.map(m => m.round || 0)),
            splitDistribution: splitCounts,
            appearances: appearances,
            gameDistribution: gameDistribution,
            gameRotationPattern: this.getGameRotationPattern()
        };

        return validation;
    }

    /**
     * Get matches for a specific round
     */
    getMatchesForRound(round) {
        return this.matches.filter(m => m.round === round);
    }

    /**
     * Get next unplayed match
     */
    getNextMatch() {
        return this.matches.find(m => m.status === 'waiting');
    }

    /**
     * Record match result
     */
    recordMatchResult(matchId, winner) {
        const match = this.matches.find(m => m.id === matchId);
        if (!match) {
            throw new Error(`Match ${matchId} not found`);
        }

        match.status = 'completed';
        match.winner = winner;
        match.timestamp = new Date().toISOString();

        return match;
    }

    /**
     * Export schedule to Firebase format
     */
    exportForFirebase() {
        return {
            matches: this.matches,
            teams: this.teams,
            games: this.games,
            schedulerType: 'rotating-split-team',
            generatedAt: new Date().toISOString(),
            validation: this.validate()
        };
    }

    /**
     * Get schedule statistics
     */
    getStats() {
        const totalGames = this.matches.length;
        const completedGames = this.matches.filter(m => m.status === 'completed').length;
        const remainingGames = totalGames - completedGames;

        return {
            totalMatches: totalGames,
            completed: completedGames,
            remaining: remainingGames,
            progress: totalGames > 0 ? (completedGames / totalGames * 100).toFixed(1) : 0,
            currentRound: this.getCurrentRound()
        };
    }

    /**
     * Get current round number
     */
    getCurrentRound() {
        const nextMatch = this.getNextMatch();
        return nextMatch ? nextMatch.round : this.matches.length > 0 ? Math.max(...this.matches.map(m => m.round)) : 0;
    }

    /**
     * Preview match schedule as text
     */
    previewSchedule() {
        let preview = '=== MATCH SCHEDULE ===\n\n';
        preview += `Total Matches: ${this.matches.length}\n`;
        preview += `Game Rotation: Max 3 consecutive games\n\n`;

        const rounds = [...new Set(this.matches.map(m => m.round))];
        
        rounds.forEach(round => {
            preview += `ROUND ${round}\n`;
            preview += '─'.repeat(50) + '\n';

            const roundMatches = this.getMatchesForRound(round);
            roundMatches.forEach(match => {
                const gameSeq = match.gameSequence ? `(#${match.gameSequence})` : '';
                preview += `Match ${match.id}: ${match.game} ${gameSeq}\n`;
                
                if (match.splitTeam) {
                    preview += `  Split Team: ${match.splitTeam.name}\n`;
                    preview += `  TEAM_A: ${match.teamA.teams.map(t => t.name).join(' + ')} + Split Player\n`;
                    preview += `  TEAM_B: ${match.teamB.teams.map(t => t.name).join(' + ')} + Split Player\n`;
                } else if (match.team1 && match.team2) {
                    preview += `  ${match.team1.name} vs ${match.team2.name}\n`;
                }
                
                preview += '\n';
            });
            preview += '\n';
        });

        return preview;
    }

    /**
     * Get game rotation visualization
     * Shows how games are distributed across matches
     */
    getGameRotationPattern() {
        const pattern = {
            sequence: [],
            distribution: {}
        };

        this.matches.forEach((match, index) => {
            pattern.sequence.push({
                matchId: match.id,
                game: match.game,
                gameSequence: match.gameSequence || 1
            });

            if (!pattern.distribution[match.game]) {
                pattern.distribution[match.game] = [];
            }
            pattern.distribution[match.game].push(match.id);
        });

        return pattern;
    }

    /**
     * Validate game rotation (no more than maxConsecutive in a row)
     */
    validateGameRotation(maxConsecutive = 3) {
        let currentGame = null;
        let consecutiveCount = 0;
        const violations = [];

        this.matches.forEach((match, index) => {
            if (match.game === currentGame) {
                consecutiveCount++;
                if (consecutiveCount > maxConsecutive) {
                    violations.push({
                        matchId: match.id,
                        game: match.game,
                        consecutiveCount: consecutiveCount,
                        position: index + 1
                    });
                }
            } else {
                currentGame = match.game;
                consecutiveCount = 1;
            }
        });

        return {
            valid: violations.length === 0,
            violations: violations,
            message: violations.length === 0 
                ? 'Game rotation is valid' 
                : `Found ${violations.length} violations of max ${maxConsecutive} consecutive games`
        };
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MatchScheduler = MatchScheduler;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MatchScheduler;
}