/**
 * MATCH SCHEDULER - Template Generator
 * Generates match templates without specific player assignments
 * Admin assigns players manually in god.html
 */

class MatchScheduler {
    constructor(teams, games) {
        this.teams = teams || [];
        this.games = games || []; // Array of {name, format, icon}
        this.templates = [];
    }

    /**
     * Generate match templates based on game rotation
     * No player assignment - just placeholders
     */
    generateMatchTemplates(options = {}) {
        const {
            totalMatches = 15,
            maxConsecutiveGames = 3
        } = options;

        if (this.games.length === 0) {
            throw new Error('Need at least 1 game');
        }

        this.templates = [];
        
        let templateId = 1;
        let currentGameIndex = 0;
        let gameSequenceCount = 0;

        for (let round = 1; round <= totalMatches; round++) {
            const gameConfig = this.games[currentGameIndex];
            const gameName = typeof gameConfig === 'string' ? gameConfig : gameConfig.name || gameConfig;
            const format = gameConfig.format || '5v5';
            const icon = gameConfig.icon || '🎮';
            
            gameSequenceCount++;

            // Determine how many sub-matches this creates
            let subMatches = 1;
            if (format === '2v2x2') subMatches = 2;
            if (format === '3v3+2v2') subMatches = 2;

            for (let sub = 0; sub < subMatches; sub++) {
                const template = {
                    id: templateId++,
                    round,
                    subMatch: subMatches > 1 ? String.fromCharCode(65 + sub) : null, // A, B, C...
                    game: gameName,
                    gameIcon: icon,
                    format: format,
                    gameSequence: gameSequenceCount,
                    
                    // Player slots - to be filled by admin
                    teamA: {
                        name: 'TEAM_A',
                        players: [],
                        requiredPlayers: this.getRequiredPlayers(format, 'A')
                    },
                    teamB: {
                        name: 'TEAM_B',
                        players: [],
                        requiredPlayers: this.getRequiredPlayers(format, 'B')
                    },
                    
                    // Suggested assignment (for admin convenience)
                    suggestedPlayers: this.suggestPlayers(format, round),
                    
                    status: 'template', // template → planned → playing → completed
                    winner: null,
                    actualPlayers: null, // Filled when admin confirms
                    notes: ''
                };

                this.templates.push(template);
            }

            // Rotate game after maxConsecutiveGames
            if (gameSequenceCount >= maxConsecutiveGames) {
                currentGameIndex = (currentGameIndex + 1) % this.games.length;
                gameSequenceCount = 0;
            }
        }

        return this.templates;
    }

    /**
     * Get required number of players per side based on format
     */
    getRequiredPlayers(format, side) {
        const formats = {
            '5v5': { A: 5, B: 5 },
            '3v3': { A: 3, B: 3 },
            '2v2': { A: 2, B: 2 },
            '2v2x2': { A: 2, B: 2 },
            '3v3+2v2': { A: 3, B: 3 } // This would need sub-match logic
        };
        return formats[format]?.[side] || 5;
    }

    /**
     * Suggest player assignments based on fairness and rotation
     * This is just a suggestion - admin can override
     */
    suggestPlayers(format, round) {
        if (!this.teams || this.teams.length === 0) {
            return { teamA: [], teamB: [], note: 'No teams available' };
        }

        // Simple rotation: alternate which team gets split
        const splitTeamIndex = (this.teams.length - (round % this.teams.length)) % this.teams.length;
        
        if (format === '5v5') {
            return this.suggest5v5Split(splitTeamIndex);
        } else if (format === '2v2') {
            return this.suggest2v2();
        }
        
        return { teamA: [], teamB: [], note: 'Manual assignment needed' };
    }

    /**
     * Suggest 5v5 split-team assignment
     */
    suggest5v5Split(splitTeamIndex) {
        const suggestion = {
            teamA: [],
            teamB: [],
            splitTeam: this.teams[splitTeamIndex]?.name,
            note: `Suggested split: ${this.teams[splitTeamIndex]?.name}`
        };

        const otherTeams = this.teams.filter((_, idx) => idx !== splitTeamIndex);
        const teamsPerSide = Math.floor(otherTeams.length / 2);

        // Team A gets first half of other teams + player 1 from split team
        for (let i = 0; i < teamsPerSide; i++) {
            const team = otherTeams[i];
            team.players?.forEach(p => suggestion.teamA.push({
                name: p.name,
                teamName: team.name,
                teamColor: team.color
            }));
        }
        
        // Add split player 1
        if (this.teams[splitTeamIndex]?.players?.[0]) {
            suggestion.teamA.push({
                name: this.teams[splitTeamIndex].players[0].name,
                teamName: this.teams[splitTeamIndex].name,
                teamColor: this.teams[splitTeamIndex].color,
                split: true
            });
        }

        // Team B gets second half + player 2 from split team
        for (let i = teamsPerSide; i < otherTeams.length; i++) {
            const team = otherTeams[i];
            team.players?.forEach(p => suggestion.teamB.push({
                name: p.name,
                teamName: team.name,
                teamColor: team.color
            }));
        }
        
        // Add split player 2
        if (this.teams[splitTeamIndex]?.players?.[1]) {
            suggestion.teamB.push({
                name: this.teams[splitTeamIndex].players[1].name,
                teamName: this.teams[splitTeamIndex].name,
                teamColor: this.teams[splitTeamIndex].color,
                split: true
            });
        }

        return suggestion;
    }

    /**
     * Suggest 2v2 assignment
     */
    suggest2v2() {
        const suggestion = {
            teamA: [],
            teamB: [],
            note: 'Suggested 2v2 matchup'
        };

        if (this.teams.length >= 2) {
            // Team A = Team 1
            this.teams[0].players?.forEach(p => suggestion.teamA.push({
                name: p.name,
                teamName: this.teams[0].name,
                teamColor: this.teams[0].color
            }));

            // Team B = Team 2
            this.teams[1].players?.forEach(p => suggestion.teamB.push({
                name: p.name,
                teamName: this.teams[1].name,
                teamColor: this.teams[1].color
            }));
        }

        return suggestion;
    }

    /**
     * Validate templates
     */
    validate() {
        return {
            valid: this.templates.length > 0,
            errors: this.templates.length === 0 ? ['No templates generated'] : [],
            warnings: [],
            stats: {
                totalTemplates: this.templates.length,
                byFormat: this.getFormatDistribution()
            }
        };
    }

    getFormatDistribution() {
        const dist = {};
        this.templates.forEach(t => {
            dist[t.format] = (dist[t.format] || 0) + 1;
        });
        return dist;
    }

    /**
     * Preview schedule
     */
    previewSchedule() {
        let preview = '=== MATCH SCHEDULE (TEMPLATES) ===\n\n';
        preview += `Total Templates: ${this.templates.length}\n`;
        preview += 'Player assignments will be made by admin\n\n';

        this.templates.forEach(template => {
            const subMatch = template.subMatch ? ` (${template.subMatch})` : '';
            preview += `Round ${template.round}${subMatch}: ${template.game} (${template.format})\n`;
            preview += `  Match #${template.id} - Sequence: ${template.gameSequence}\n`;
            
            if (template.suggestedPlayers?.splitTeam) {
                preview += `  Suggested split: ${template.suggestedPlayers.splitTeam}\n`;
            }
            
            preview += `  TEAM_A needs: ${template.teamA.requiredPlayers} players\n`;
            preview += `  TEAM_B needs: ${template.teamB.requiredPlayers} players\n\n`;
        });

        return preview;
    }

    /**
     * Export for Firebase
     */
    exportForFirebase() {
        return {
            templates: this.templates,
            teams: this.teams,
            games: this.games,
            schedulerType: 'template-based',
            generatedAt: new Date().toISOString(),
            validation: this.validate()
        };
    }
}

// Export
if (typeof window !== 'undefined') {
    window.MatchScheduler = MatchScheduler;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MatchScheduler;
}