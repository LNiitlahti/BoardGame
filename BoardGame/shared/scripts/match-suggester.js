/**
 * MATCH SUGGESTER - Proven 10-Match Rotation System
 *
 * Based on the ACTUAL LAN tournament rotation pattern that ensures:
 * - Each team is split ("hajotettu") exactly 2 times per 10-match cycle
 * - Fair distribution of splits across all teams
 * - All meaningful team combinations are covered
 *
 * Format: 5v5 matches with 5 teams of 2 players each
 * - 2 full teams per side (4 players)
 * - 1 split team (1 player each side) - does NOT earn team points
 */

class MatchSuggester {
    constructor(gameState) {
        this.gameState = gameState;
        this.teams = gameState.teams || [];
        this.gameHistory = gameState.gameHistory || [];
        this.gameQueue = gameState.gameQueue || [];
    }

    /**
     * The proven 10-match rotation pattern
     * Format: { sideA: [teamIds], sideB: [teamIds], split: teamId }
     *
     * Pattern explanation:
     * - sideA: Teams playing together on Side A (both players)
     * - sideB: Teams playing together on Side B (both players)
     * - split: Team that is "hajotettu" (1 player each side)
     *
     * Each team is split exactly 2 times per 10-match cycle:
     * - Team 1: Split in matches 1, 6
     * - Team 2: Split in matches 3, 8
     * - Team 3: Split in matches 2, 7
     * - Team 4: Split in matches 5, 10
     * - Team 5: Split in matches 4, 9
     */
    static ROTATION_PATTERN = [
        // Match 1:  2,3 vs 4,5 hajotettu 1
        { sideA: [2, 3], sideB: [4, 5], split: 1 },
        // Match 2:  2,1 vs 4,5 hajotettu 3
        { sideA: [2, 1], sideB: [4, 5], split: 3 },
        // Match 3:  1,3 vs 4,5 hajotettu 2
        { sideA: [1, 3], sideB: [4, 5], split: 2 },
        // Match 4:  1,4 vs 2,3 hajotettu 5
        { sideA: [1, 4], sideB: [2, 3], split: 5 },
        // Match 5:  1,2 vs 3,5 hajotettu 4
        { sideA: [1, 2], sideB: [3, 5], split: 4 },
        // Match 6:  2,4 vs 3,5 hajotettu 1
        { sideA: [2, 4], sideB: [3, 5], split: 1 },
        // Match 7:  2,4 vs 1,5 hajotettu 3
        { sideA: [2, 4], sideB: [1, 5], split: 3 },
        // Match 8:  1,4 vs 3,5 hajotettu 2
        { sideA: [1, 4], sideB: [3, 5], split: 2 },
        // Match 9:  1,2 vs 4,3 hajotettu 5
        { sideA: [1, 2], sideB: [4, 3], split: 5 },
        // Match 10: 1,3 vs 2,5 hajotettu 4
        { sideA: [1, 3], sideB: [2, 5], split: 4 }
    ];

    /**
     * Get the current position in the rotation cycle
     * Based on completed + queued matches (not including current)
     * NOTE: Challenge matches are excluded from rotation counting
     */
    getRotationPosition() {
        // Count all matches that have been created (completed + pending + ongoing)
        // EXCLUDE challenge matches - they don't affect rotation
        const normalMatches = this.gameQueue.filter(m => !m.isChallenge);
        const totalMatchesCreated = normalMatches.length;

        // Also check if there's a stored rotation position
        const storedPosition = this.gameState.rotationPosition || 0;

        // Use the higher of the two to ensure we don't repeat
        return Math.max(totalMatchesCreated, storedPosition) % 10;
    }

    /**
     * Get the next match in the rotation
     */
    getNextRotationMatch() {
        const position = this.getRotationPosition();
        return {
            pattern: MatchSuggester.ROTATION_PATTERN[position],
            rotationIndex: position + 1, // 1-indexed for display
            cycleNumber: Math.floor(this.getRotationPosition() / 10) + 1
        };
    }

    /**
     * Get team by ID
     * Uses string comparison to handle type mismatches (string vs number IDs)
     */
    getTeamById(teamId) {
        if (teamId == null) return null;
        return this.teams.find(t => String(t.id) === String(teamId));
    }

    /**
     * Get players from a team
     */
    getPlayersFromTeam(teamId) {
        const team = this.getTeamById(teamId);
        if (!team || !team.players) return [];

        return team.players.map(p => ({
            id: p.id || p.uid,
            name: p.name,
            originalTeamId: team.id,
            originalTeamName: team.name,
            originalTeamColor: team.color || this.getTeamColor(team.id)
        }));
    }

    /**
     * Get team color
     */
    getTeamColor(teamId) {
        const colors = {
            1: '#de392c', // Red
            2: '#2278a3', // Blue
            3: '#2e9158', // Green
            4: '#f7ba32', // Yellow
            5: '#22241d'  // Black
        };
        return colors[teamId] || '#666666';
    }

    /**
     * Generate the match suggestion based on rotation
     * Returns a complete match setup ready for the queue
     */
    generateSuggestion() {
        // Validate we have 5 teams with 2 players each
        if (this.teams.length < 5) {
            return {
                error: true,
                message: `Need exactly 5 teams. Currently have ${this.teams.length}.`,
                teams: this.teams
            };
        }

        // Check each team has 2 players
        const teamsWithWrongPlayerCount = this.teams.filter(t =>
            !t.players || t.players.length !== 2
        );

        if (teamsWithWrongPlayerCount.length > 0) {
            const problemTeams = teamsWithWrongPlayerCount.map(t =>
                `${t.name || 'Team ' + t.id} (${t.players?.length || 0} players)`
            ).join(', ');

            return {
                error: true,
                message: `Each team needs exactly 2 players. Problems: ${problemTeams}`,
                teams: this.teams
            };
        }

        const { pattern, rotationIndex, cycleNumber } = this.getNextRotationMatch();

        // Safety check: ensure split team is not also in sideA or sideB
        if (pattern.sideA.includes(pattern.split) || pattern.sideB.includes(pattern.split)) {
            console.error('Invalid rotation pattern: split team cannot be in sideA or sideB', pattern);
            return {
                error: true,
                message: `Invalid rotation pattern for match ${rotationIndex}: split team ${pattern.split} is also in sideA or sideB. Please report this bug.`,
                pattern
            };
        }

        // Build Side A players (2 full teams + 1 player from split team)
        const sideAPlayers = [];
        pattern.sideA.forEach(teamId => {
            sideAPlayers.push(...this.getPlayersFromTeam(teamId));
        });

        // Add first player from split team to Side A
        const splitTeamPlayers = this.getPlayersFromTeam(pattern.split);
        if (splitTeamPlayers.length >= 1) {
            sideAPlayers.push({
                ...splitTeamPlayers[0],
                isSplit: true // Mark as split player
            });
        }

        // Build Side B players (2 full teams + 1 player from split team)
        const sideBPlayers = [];
        pattern.sideB.forEach(teamId => {
            sideBPlayers.push(...this.getPlayersFromTeam(teamId));
        });

        // Add second player from split team to Side B
        if (splitTeamPlayers.length >= 2) {
            sideBPlayers.push({
                ...splitTeamPlayers[1],
                isSplit: true // Mark as split player
            });
        }

        // Get team names for display
        const sideATeamNames = pattern.sideA.map(id => {
            const team = this.getTeamById(id);
            return team?.name || `Team ${id}`;
        });
        const sideBTeamNames = pattern.sideB.map(id => {
            const team = this.getTeamById(id);
            return team?.name || `Team ${id}`;
        });
        const splitTeam = this.getTeamById(pattern.split);
        const splitTeamName = splitTeam?.name || `Team ${pattern.split}`;

        // Build the match structure
        const matches = [{
            format: '5v5',
            teams: [
                {
                    name: 'TEAM A',
                    players: sideAPlayers,
                    fullTeams: pattern.sideA,
                    fullTeamNames: sideATeamNames
                },
                {
                    name: 'TEAM B',
                    players: sideBPlayers,
                    fullTeams: pattern.sideB,
                    fullTeamNames: sideBTeamNames
                }
            ],
            splitTeamId: pattern.split,
            splitTeamName: splitTeamName
        }];

        return {
            error: false,
            rotationIndex,
            cycleNumber,
            pattern: {
                sideA: pattern.sideA,
                sideB: pattern.sideB,
                split: pattern.split
            },
            description: this.formatMatchDescription(pattern, rotationIndex),
            matches,
            // For display
            sideADescription: `${sideATeamNames.join(' + ')} + 1 from ${splitTeamName}`,
            sideBDescription: `${sideBTeamNames.join(' + ')} + 1 from ${splitTeamName}`,
            splitDescription: `${splitTeamName} is split (hajotettu)`,
            // Fairness info
            fairnessNote: this.getFairnessNote(pattern.split)
        };
    }

    /**
     * Format a human-readable match description
     */
    formatMatchDescription(pattern, rotationIndex) {
        const sideANames = pattern.sideA.map(id => {
            const team = this.getTeamById(id);
            return team?.name || `T${id}`;
        }).join(', ');

        const sideBNames = pattern.sideB.map(id => {
            const team = this.getTeamById(id);
            return team?.name || `T${id}`;
        }).join(', ');

        const splitTeam = this.getTeamById(pattern.split);
        const splitName = splitTeam?.name || `T${pattern.split}`;

        return `Rotation #${rotationIndex}: ${sideANames} vs ${sideBNames} (${splitName} split)`;
    }

    /**
     * Get fairness note about which team is being split
     * NOTE: Challenge matches are excluded from fairness counting
     */
    getFairnessNote(splitTeamId) {
        // Count how many times this team has been split in history
        // EXCLUDE challenge matches
        let splitCount = 0;
        this.gameHistory.forEach(match => {
            if (match.splitTeamId === splitTeamId && !match.isChallenge) {
                splitCount++;
            }
        });

        // Also count pending/ongoing matches (excluding challenges)
        this.gameQueue.forEach(match => {
            if (match.splitTeamId === splitTeamId && match.status !== 'completed' && !match.isChallenge) {
                splitCount++;
            }
        });

        const team = this.getTeamById(splitTeamId);
        const teamName = team?.name || `Team ${splitTeamId}`;

        if (splitCount === 0) {
            return `${teamName} hasn't been split yet this cycle.`;
        } else if (splitCount === 1) {
            return `${teamName} has been split 1 time. (Each team split 2x per 10 matches)`;
        } else {
            return `${teamName} has been split ${splitCount} times.`;
        }
    }

    /**
     * Get rotation status for all teams
     * NOTE: Challenge matches are excluded from rotation counting
     */
    getRotationStatus() {
        const status = {};

        // Filter out challenge matches for counting
        const normalHistory = this.gameHistory.filter(m => !m.isChallenge);
        const normalQueue = this.gameQueue.filter(m => !m.isChallenge);

        this.teams.forEach(team => {
            let splitCount = 0;

            // Count from history (excluding challenges)
            normalHistory.forEach(match => {
                if (match.splitTeamId === team.id) {
                    splitCount++;
                }
            });

            // Count from queue (excluding challenges)
            normalQueue.forEach(match => {
                if (match.splitTeamId === team.id) {
                    splitCount++;
                }
            });

            status[team.id] = {
                teamName: team.name || `Team ${team.id}`,
                splitCount,
                expectedSplits: Math.floor((normalQueue.length + normalHistory.length) / 5) // ~2 per 10 matches
            };
        });

        return status;
    }

    /**
     * Preview the next N matches in the rotation
     */
    previewNextMatches(count = 5) {
        const previews = [];
        const currentPosition = this.getRotationPosition();

        for (let i = 0; i < count; i++) {
            const position = (currentPosition + i) % 10;
            const pattern = MatchSuggester.ROTATION_PATTERN[position];

            const sideANames = pattern.sideA.map(id => {
                const team = this.getTeamById(id);
                return team?.name || `T${id}`;
            });

            const sideBNames = pattern.sideB.map(id => {
                const team = this.getTeamById(id);
                return team?.name || `T${id}`;
            });

            const splitTeam = this.getTeamById(pattern.split);

            previews.push({
                matchInCycle: position + 1,
                sideA: sideANames,
                sideB: sideBNames,
                splitTeam: splitTeam?.name || `Team ${pattern.split}`,
                description: `${sideANames.join('+')} vs ${sideBNames.join('+')} (${splitTeam?.name || 'T' + pattern.split} split)`
            });
        }

        return previews;
    }
}

// Make available globally
window.MatchSuggester = MatchSuggester;
