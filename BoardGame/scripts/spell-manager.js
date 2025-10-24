/**
 * SPELL MANAGER MODULE
 * Handles spell card operations, validation, and effects
 */

class SpellManager {
    constructor() {
        this.spells = [];
        this.activeSpells = new Map(); // Track active spell effects
    }

    /**
     * Load all spell definitions from Firebase
     */
    async loadSpellDefinitions() {
        try {
            const snapshot = await window.firebaseDB.collection('spellCards').get();
            this.spells = [];
            snapshot.forEach(doc => {
                this.spells.push({ id: doc.id, ...doc.data() });
            });
            console.log('[Spell Manager] Loaded', this.spells.length, 'spell definitions');
            return this.spells;
        } catch (error) {
            console.error('[Spell Manager] Error loading spells:', error);
            throw error;
        }
    }

    /**
     * Get spell by ID
     */
    getSpell(spellId) {
        return this.spells.find(s => s.id === spellId);
    }

    /**
     * Validate if a spell can be cast
     */
    canCastSpell(spell, team, gameState) {
        if (!spell || !team) return { valid: false, reason: 'Missing spell or team' };

        // Check timing
        const currentPhase = gameState.gamePhase || 'idle';
        const timing = spell.timing;

        const timingMap = {
            'pre-game': ['setup', 'pre-game'],
            'post-game': ['post-game', 'result-confirmation'],
            'anytime': ['setup', 'pre-game', 'playing', 'post-game'],
            'placement': ['playing'],
            'after-placement': ['playing'],
            'persistent': ['setup', 'pre-game', 'playing', 'post-game'],
            'reactive': ['playing', 'post-game']
        };

        const validPhases = timingMap[timing] || [];
        if (!validPhases.includes(currentPhase)) {
            return {
                valid: false,
                reason: `Cannot cast ${timing} spell during ${currentPhase} phase`
            };
        }

        // Check if team has the spell
        const teamSpells = team.spellCards || team.hand || [];
        const hasSpell = teamSpells.some(s =>
            (typeof s === 'string' && s === spell.id) ||
            (typeof s === 'object' && s.id === spell.id)
        );

        if (!hasSpell) {
            return { valid: false, reason: 'Team does not have this spell' };
        }

        return { valid: true };
    }

    /**
     * Cast a spell
     */
    async castSpell(spellId, teamId, gameState, targetData = {}) {
        const spell = this.getSpell(spellId);
        const team = gameState.teams.find(t => t.id === teamId);

        // Validate
        const validation = this.canCastSpell(spell, team, gameState);
        if (!validation.valid) {
            throw new Error(validation.reason);
        }

        // Remove spell from team's hand
        this.removeSpellFromTeam(team, spellId);

        // Apply effect based on spell type
        const result = await this.applySpellEffect(spell, team, gameState, targetData);

        // Log the spell cast
        gameState.spellHistory = gameState.spellHistory || [];
        gameState.spellHistory.push({
            timestamp: new Date().toISOString(),
            spellId: spellId,
            teamId: teamId,
            teamName: team.name,
            spellName: spell.name,
            targetData: targetData,
            result: result
        });

        console.log('[Spell Manager] Cast spell:', spell.name, 'by', team.name);
        return result;
    }

    /**
     * Apply spell effect
     */
    async applySpellEffect(spell, team, gameState, targetData) {
        const effect = spell.effect;
        const result = { success: true, changes: {} };

        switch (effect.type) {
            case 'multiplier':
                // Store for later (applied when match ends)
                this.activeSpells.set(`${team.id}-${spell.id}`, {
                    spell: spell,
                    team: team,
                    appliedAt: new Date().toISOString()
                });
                result.changes.note = 'Multiplier will apply when match completes';
                break;

            case 'destroy_adjacent':
                result.changes = this.handleDestroyAdjacent(team, gameState, targetData);
                break;

            case 'streak_bonus':
                team.activeEffects = team.activeEffects || [];
                team.activeEffects.push({
                    type: 'streak_bonus',
                    spellId: spell.id,
                    wins: 0,
                    required: 3
                });
                result.changes.note = 'Win streak tracker activated';
                break;

            case 'shield':
                team.activeEffects = team.activeEffects || [];
                team.activeEffects.push({
                    type: 'shield',
                    spellId: spell.id,
                    duration: effect.duration,
                    until: 'next_game'
                });
                result.changes.note = 'Protection activated until next game';
                break;

            case 'copy_spell':
                result.changes.note = 'Spell copy requires target selection';
                result.requiresTarget = true;
                break;

            case 'challenge':
                result.changes.note = 'Challenge initiated - awaits resolution';
                result.requiresResolution = true;
                break;

            case 'bonus_points':
                const hearts = this.countControlledHearts(team, gameState);
                team.points = (team.points || 0) + hearts;
                result.changes.pointsGained = hearts;
                break;

            case 'ban':
                result.changes = this.handleBan(targetData, gameState);
                break;

            case 'modifier':
                team.activeEffects = team.activeEffects || [];
                team.activeEffects.push({
                    type: effect.modifier,
                    trigger: effect.trigger,
                    uses: effect.uses || 1
                });
                result.changes.note = 'Modifier activated';
                break;

            case 'permanent_buff':
                team.activeEffects = team.activeEffects || [];
                team.activeEffects.push({
                    type: 'permanent_buff',
                    trigger: effect.trigger,
                    bonus: effect.bonus,
                    permanent: true
                });
                result.changes.note = 'Permanent buff activated';
                break;

            case 'extra_placement':
                result.changes.note = 'Extra placement granted';
                result.extraPlacements = effect.amount;
                result.restrictions = effect.restrictions;
                break;

            case 'silence':
                result.changes = this.handleSilence(targetData, gameState);
                break;

            case 'bet':
                result.changes.note = 'Bet recorded - will resolve after game';
                result.requiresBetData = true;
                break;

            case 'counter':
                team.activeEffects = team.activeEffects || [];
                team.activeEffects.push({
                    type: 'counter',
                    trigger: effect.trigger,
                    action: effect.action,
                    active: true
                });
                result.changes.note = 'Counter ready';
                break;

            default:
                result.changes.note = 'Effect type not yet implemented: ' + effect.type;
        }

        return result;
    }

    /**
     * Remove spell from team's hand
     */
    removeSpellFromTeam(team, spellId) {
        if (!team.spellCards && !team.hand) return;

        const cards = team.spellCards || team.hand || [];
        const index = cards.findIndex(s =>
            (typeof s === 'string' && s === spellId) ||
            (typeof s === 'object' && s.id === spellId)
        );

        if (index !== -1) {
            cards.splice(index, 1);
        }

        // Move to used pile
        team.usedSpells = team.usedSpells || [];
        team.usedSpells.push(spellId);
    }

    /**
     * Handle destroy adjacent tiles
     */
    handleDestroyAdjacent(team, gameState, targetData) {
        const changes = { destroyedTiles: [] };
        const board = gameState.board || {};

        // Find team's tiles
        for (const [coord, tile] of Object.entries(board)) {
            if (tile.teamId === team.id) {
                // Get adjacent hexes
                const neighbors = this.getHexNeighbors(coord);

                for (const neighborCoord of neighbors) {
                    const neighborTile = board[neighborCoord];
                    if (neighborTile && neighborTile.teamId !== team.id) {
                        // Destroy this tile
                        delete board[neighborCoord];
                        changes.destroyedTiles.push({
                            coord: neighborCoord,
                            teamId: neighborTile.teamId
                        });
                    }
                }
            }
        }

        return changes;
    }

    /**
     * Count controlled hearts
     */
    countControlledHearts(team, gameState) {
        const heartHexes = gameState.heartHexes || [];
        const control = gameState.heartHexControl || {};

        let count = 0;
        for (const heart of heartHexes) {
            if (control[heart] === team.id) {
                count++;
            }
        }

        return count;
    }

    /**
     * Handle ban effect
     */
    handleBan(targetData, gameState) {
        gameState.activeBans = gameState.activeBans || [];
        gameState.activeBans.push({
            teamId: targetData.targetTeamId,
            banned: targetData.bannedElement,
            until: 'next_game'
        });

        return {
            bannedTeam: targetData.targetTeamId,
            bannedElement: targetData.bannedElement
        };
    }

    /**
     * Handle silence effect
     */
    handleSilence(targetData, gameState) {
        gameState.silencedPlayers = gameState.silencedPlayers || [];
        gameState.silencedPlayers.push({
            playerId: targetData.targetPlayerId,
            playerName: targetData.targetPlayerName,
            until: 'game_end'
        });

        return {
            silencedPlayer: targetData.targetPlayerName
        };
    }

    /**
     * Get hex neighbors (using board module logic)
     */
    getHexNeighbors(coordString) {
        const match = coordString.match(/q(-?\d+)r(-?\d+)/);
        if (!match) return [];

        const q = parseInt(match[1]);
        const r = parseInt(match[2]);

        const directions = [
            [1, 0], [1, -1], [0, -1],
            [-1, 0], [-1, 1], [0, 1]
        ];

        return directions.map(([dq, dr]) => {
            return `q${q + dq}r${r + dr}`;
        });
    }

    /**
     * Distribute spells to teams
     */
    async distributeSpells(gameState, distribution) {
        // distribution = { teamId: [spellId1, spellId2, ...], ... }
        for (const [teamId, spellIds] of Object.entries(distribution)) {
            const team = gameState.teams.find(t => t.id === parseInt(teamId));
            if (!team) continue;

            team.spellCards = team.spellCards || [];
            team.spellCards.push(...spellIds);
        }

        console.log('[Spell Manager] Distributed spells to teams');
    }

    /**
     * Check and apply post-game spell effects
     */
    applyPostGameEffects(gameState, matchResult) {
        const effects = [];

        for (const team of gameState.teams) {
            if (!team.activeEffects) continue;

            for (let i = team.activeEffects.length - 1; i >= 0; i--) {
                const effect = team.activeEffects[i];

                // Handle multipliers
                if (effect.type === 'streak_bonus') {
                    if (matchResult.winnerId === team.id) {
                        effect.wins = (effect.wins || 0) + 1;
                        if (effect.wins >= effect.required) {
                            // Award bonus
                            team.points = (team.points || 0) + 2;
                            effects.push({
                                team: team.name,
                                effect: 'Domination streak completed! +2 points, +2 tiles'
                            });
                            team.activeEffects.splice(i, 1);
                        }
                    } else {
                        // Reset streak
                        team.activeEffects.splice(i, 1);
                    }
                }

                // Remove expired shields
                if (effect.type === 'shield' && effect.duration === 'next_game') {
                    team.activeEffects.splice(i, 1);
                    effects.push({
                        team: team.name,
                        effect: 'Shield expired'
                    });
                }
            }
        }

        return effects;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.SpellManager = SpellManager;
}
