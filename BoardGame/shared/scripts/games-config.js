/**
 * MASTER GAMES CONFIGURATION
 *
 * Single source of truth for all game definitions.
 * Import this file in setup, admin, dev-matchscheduler, etc.
 *
 * Usage:
 *   <script src="scripts/games-config.js"></script>
 *
 *   // Access games
 *   GAMES_CONFIG.games['cs2'].name  // "Counter-Strike 2"
 *   GAMES_CONFIG.getGameName('cs2') // "Counter-Strike 2"
 *   GAMES_CONFIG.getGameFormat('aoe4') // "3v3+2v2"
 */

const GAMES_CONFIG = {
    // Master list of all games with full configuration
    games: {
        // === CURRENTLY ACTIVE IN TOURNAMENT ===
        'predecessor': {
            name: 'Predecessor',
            shortName: 'Predecessor',
            format: '5v5',
            icon: '🏆',
            image: 'shared/images/game-logos/Predecessor/Predecessor_icon.png',
            active: true
        },
        'aoe4': {
            name: 'Age of Empires IV',
            shortName: 'AoE4',
            format: '3v3+2v2',
            splitFormat: true,
            icon: '🏰',
            image: 'shared/images/game-logos/Age_of_Empires_IV/Age_of_Empires_IV_icon.png',
            active: true
        },
        'overwatch2': {
            name: 'Overwatch 2',
            shortName: 'OW2',
            format: '5v5',
            icon: '🎮',
            image: 'shared/images/game-logos/Overwatch_2/Overwatch_2_icon.png',
            active: true
        },
        'cs2': {
            name: 'Counter-Strike 2',
            shortName: 'CS2',
            format: '5v5',
            icon: '🎯',
            image: 'shared/images/game-logos/Counter-Strike_2/Counter-Strike_2_icon.png',
            active: true
        },
        'wc3': {
            name: 'Warcraft 3',
            shortName: 'WC3',
            format: '3v3+2v2',
            splitFormat: true,
            icon: '⚔️',
            image: 'shared/images/game-logos/Warcraft_3/Warcraft_3_icon.png',
            active: true
        },
        'cod': {
            name: 'Call of Duty',
            shortName: 'COD',
            format: '5v5',
            icon: '🔫',
            image: 'shared/images/game-logos/Call_of_Duty/Call_of_Duty_icon.png',
            active: true
        },

        // === OTHER AVAILABLE GAMES ===
        'spellbreak': {
            name: 'Spellbreak',
            shortName: 'Spellbreak',
            format: '5v5',
            icon: '✨',
            image: 'shared/images/game-logos/Spellbreak/Spellbreak_icon.png',
            active: false
        },
        'spacemarine2': {
            name: 'Space Marine 2',
            shortName: 'SM2',
            format: '5v5',
            icon: '⚔️',
            image: 'shared/images/game-logos/Space_Marine_2/Space_Marine_2_icon.png',
            active: false
        },
        'dow2': {
            name: 'Dawn of War 2',
            shortName: 'DoW2',
            format: '3v3+2v2',
            splitFormat: true,
            icon: '💀',
            image: 'shared/images/game-logos/Dawn_of_War_2/Dawn_of_War_2_icon.png',
            active: false
        },
        'sc2': {
            name: 'StarCraft II',
            shortName: 'SC2',
            format: '3v3+2v2',
            splitFormat: true,
            icon: '⚔️',
            image: 'shared/images/game-logos/StarCraft_II/StarCraft_II_icon.png',
            active: false
        },
        'valorant': {
            name: 'Valorant',
            shortName: 'Valorant',
            format: '5v5',
            icon: '🔫',
            image: 'shared/images/game-logos/Valorant/Valorant_icon.png',
            active: false
        },
        'dota2': {
            name: 'Dota 2',
            shortName: 'Dota 2',
            format: '5v5',
            icon: '🗡️',
            image: 'shared/images/game-logos/Dota_2/Dota_2_icon.png',
            active: false
        },
        'hearthstone': {
            name: 'Hearthstone',
            shortName: 'HS',
            format: '1v1',
            icon: '🃏',
            image: 'shared/images/game-logos/Hearthstone/Hearthstone_icon.png',
            active: false
        },
        'rocketleague': {
            name: 'Rocket League',
            shortName: 'RL',
            format: '3v3',
            icon: '🚗',
            image: 'shared/images/game-logos/Rocket_League/Rocket_League_icon.png',
            active: false
        },
        'tekken8': {
            name: 'Tekken 8',
            shortName: 'Tekken 8',
            format: '1v1',
            icon: '👊',
            image: 'shared/images/game-logos/Tekken_8/Tekken_8_icon.png',
            active: false
        }
    },

    // Aliases for backward compatibility (maps various spellings to canonical ID)
    aliases: {
        'CS2': 'cs2',
        'counter-strike': 'cs2',
        'counter-strike 2': 'cs2',
        'Dota2': 'dota2',
        'DOTA2': 'dota2',
        'dota 2': 'dota2',
        'Valorant': 'valorant',
        'VALORANT': 'valorant',
        'StarCraft2': 'sc2',
        'starcraft2': 'sc2',
        'starcraft': 'sc2',
        'Predecessor': 'predecessor',
        'AoE4': 'aoe4',
        'aoe 4': 'aoe4',
        'age of empires': 'aoe4',
        'Age of Empires IV': 'aoe4',
        'OW2': 'overwatch2',
        'ow2': 'overwatch2',
        'overwatch': 'overwatch2',
        'Overwatch 2': 'overwatch2',
        'WC3': 'wc3',
        'warcraft': 'wc3',
        'warcraft 3': 'wc3',
        'Warcraft 3': 'wc3',
        'SM2': 'spacemarine2',
        'space marine': 'spacemarine2',
        'Space Marine 2': 'spacemarine2',
        'DoW2': 'dow2',
        'dow 2': 'dow2',
        'dawn of war': 'dow2',
        'Dawn of War 2': 'dow2',
        'COD': 'cod',
        'call of duty': 'cod',
        'Call of Duty': 'cod',
        'HS': 'hearthstone',
        'Hearthstone': 'hearthstone',
        'RL': 'rocketleague',
        'Rocket League': 'rocketleague',
        'Tekken8': 'tekken8',
        'Tekken 8': 'tekken8',
        'Spellbreak': 'spellbreak',
        'SPELLBREAK': 'spellbreak'
    },

    /**
     * Get canonical game ID (resolves aliases)
     */
    resolveGameId(id) {
        if (!id) return null;
        // Check if it's already a canonical ID
        if (this.games[id]) return id;
        // Check aliases
        return this.aliases[id] || id;
    },

    /**
     * Get game configuration by ID
     */
    getGame(id) {
        const canonicalId = this.resolveGameId(id);
        return this.games[canonicalId] || null;
    },

    /**
     * Get display name for a game
     */
    getGameName(id) {
        const game = this.getGame(id);
        return game?.name || id;
    },

    /**
     * Get short name for a game (for compact displays)
     */
    getShortName(id) {
        const game = this.getGame(id);
        return game?.shortName || game?.name || id;
    },

    /**
     * Get format for a game (5v5, 3v3+2v2, etc.)
     */
    getFormat(id) {
        const game = this.getGame(id);
        return game?.format || '5v5';
    },

    /**
     * Check if game uses split format (3v3+2v2)
     */
    isSplitFormat(id) {
        const game = this.getGame(id);
        return game?.splitFormat === true;
    },

    /**
     * Get all active games (for current tournament)
     */
    getActiveGames() {
        return Object.entries(this.games)
            .filter(([_, game]) => game.active)
            .map(([id, game]) => ({ id, ...game }));
    },

    /**
     * Get all games (active and inactive)
     */
    getAllGames() {
        return Object.entries(this.games)
            .map(([id, game]) => ({ id, ...game }));
    },

    /**
     * Get games as array for dropdowns/selects
     */
    getGamesForSelect(activeOnly = false) {
        const games = activeOnly ? this.getActiveGames() : this.getAllGames();
        return games.map(g => ({
            value: g.id,
            label: g.name,
            format: g.format
        }));
    },

    /**
     * Resolve an image path relative to BOARDGAME_BASE
     */
    resolveImagePath(imagePath) {
        if (!imagePath || imagePath.startsWith('http')) return imagePath;
        return (window.BOARDGAME_BASE || '.') + '/' + imagePath;
    },

    /**
     * Build a GAME_NAME_MAP compatible object (for backward compatibility)
     */
    buildNameMap() {
        const map = {};
        // Add all canonical IDs
        Object.entries(this.games).forEach(([id, game]) => {
            map[id] = game.name;
        });
        // Add all aliases
        Object.entries(this.aliases).forEach(([alias, id]) => {
            map[alias] = this.games[id]?.name || id;
        });
        return map;
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.GAMES_CONFIG = GAMES_CONFIG;
}

// Export for Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GAMES_CONFIG;
}
