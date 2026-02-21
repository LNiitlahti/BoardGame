/**
 * MASTER PLATFORMS CONFIGURATION
 *
 * Single source of truth for gaming platform definitions.
 * Used by onboarding to show platform ID fields and friend lists.
 *
 * Usage:
 *   <script src="shared/scripts/platforms-config.js"></script>
 *
 *   PLATFORMS_CONFIG.getActivePlatforms()         // platforms where active: true
 *   PLATFORMS_CONFIG.getPlatform('steam').name     // "Steam"
 *   PLATFORMS_CONFIG.getPlatformsForGame('cs2')    // [{ id: 'steam', ... }]
 */

const PLATFORMS_CONFIG = {
    // Master list of all platforms
    platforms: {
        // === CURRENTLY ACTIVE ===
        steam: {
            name: 'Steam',
            icon: '<img src="https://cdn.simpleicons.org/steam/c6d4df" class="platform-logo" alt="Steam">',
            placeholder: 'Steam Friend Code or Profile URL',
            help: 'Find your Friend Code: Steam \u2192 Friends \u2192 Add a Friend \u2192 Your code is shown at top',
            helpUrl: 'https://store.steampowered.com/friends',
            getProfileUrl: function(id) {
                if (id.startsWith('http')) return id;
                if (/^\d+$/.test(id)) return 'https://steamcommunity.com/profiles/' + id;
                return 'https://steamcommunity.com/id/' + id;
            },
            active: true
        },
        battlenet: {
            name: 'Battle.net',
            icon: '<img src="https://cdn.simpleicons.org/battledotnet/00AEFF" class="platform-logo" alt="Battle.net">',
            placeholder: 'BattleTag (e.g., Player#1234)',
            help: 'Find your BattleTag: Battle.net app \u2192 Click your name (top right)',
            helpUrl: 'https://battle.net/account',
            getProfileUrl: null,
            active: true
        },
        xbox: {
            name: 'Xbox / Microsoft',
            icon: '<img src="https://upload.wikimedia.org/wikipedia/commons/f/f9/Xbox_one_logo.svg" class="platform-logo" alt="Xbox">',
            placeholder: 'Xbox Gamertag',
            help: 'Find your Gamertag: Xbox app \u2192 Profile \u2192 Your gamertag is shown',
            helpUrl: 'https://account.xbox.com/profile',
            getProfileUrl: function(id) {
                return 'https://www.xbox.com/play/user/' + encodeURIComponent(id);
            },
            active: true
        },
        discord: {
            name: 'Discord',
            icon: '<img src="https://cdn.simpleicons.org/discord/5865F2" class="platform-logo" alt="Discord">',
            placeholder: 'Username (e.g., player123)',
            help: 'Find your username: Discord \u2192 Settings (gear icon) \u2192 My Account \u2192 Username',
            helpUrl: 'https://discord.com/app',
            getProfileUrl: null,
            active: true
        },

        // === INACTIVE (not needed for current event) ===
        epic: {
            name: 'Epic Games',
            icon: '<img src="https://cdn.simpleicons.org/epicgames/cccccc" class="platform-logo" alt="Epic Games">',
            placeholder: 'Epic Display Name',
            help: 'Find your name: Epic Games Launcher \u2192 Your name (bottom left)',
            helpUrl: 'https://www.epicgames.com/account/personal',
            getProfileUrl: null,
            active: false
        },
        riot: {
            name: 'Riot Games',
            icon: '<img src="https://cdn.simpleicons.org/riotgames/D32936" class="platform-logo" alt="Riot Games">',
            placeholder: 'Riot ID (e.g., Player#TAG)',
            help: 'Find your Riot ID: Open any Riot game \u2192 Profile \u2192 Your Riot ID is shown',
            helpUrl: 'https://account.riotgames.com',
            getProfileUrl: null,
            active: false
        }
    },

    // Game-to-platform mapping (game ID -> array of platform IDs)
    gamePlatforms: {
        // Active games
        'cs2': ['steam'],
        'cod': ['steam'],
        'overwatch2': ['steam'],
        'predecessor': ['steam'],
        'aoe4': ['steam', 'xbox'],
        'wc3': ['battlenet'],
        // Inactive games (kept for reference)
        'spellbreak': ['epic'],
        'spacemarine2': ['steam'],
        'dow2': ['steam'],
        'sc2': ['battlenet'],
        'valorant': ['riot'],
        'dota2': ['steam'],
        'hearthstone': ['battlenet'],
        'rocketleague': ['epic'],
        'tekken8': ['steam']
    },

    /**
     * Get platform config by ID
     */
    getPlatform(id) {
        return this.platforms[id] || null;
    },

    /**
     * Get display name for a platform
     */
    getPlatformName(id) {
        const platform = this.getPlatform(id);
        return platform?.name || id;
    },

    /**
     * Get all active platforms
     */
    getActivePlatforms() {
        return Object.entries(this.platforms)
            .filter(([_, p]) => p.active)
            .map(([id, p]) => ({ id, ...p }));
    },

    /**
     * Get all platforms (active and inactive)
     */
    getAllPlatforms() {
        return Object.entries(this.platforms)
            .map(([id, p]) => ({ id, ...p }));
    },

    /**
     * Get platform objects for a specific game
     */
    getPlatformsForGame(gameId) {
        const platformIds = this.gamePlatforms[gameId] || [];
        return platformIds
            .map(pid => {
                const p = this.platforms[pid];
                return p ? { id: pid, ...p } : null;
            })
            .filter(Boolean);
    },

    /**
     * Get games list for a specific platform (from gamePlatforms mapping)
     */
    getGamesForPlatform(platformId) {
        const gameIds = [];
        for (const [gameId, platforms] of Object.entries(this.gamePlatforms)) {
            if (platforms.includes(platformId)) {
                gameIds.push(gameId);
            }
        }
        return gameIds;
    },

    /**
     * Get game display names for a platform (uses GAMES_CONFIG if available)
     */
    getGameNamesForPlatform(platformId) {
        const gameIds = this.getGamesForPlatform(platformId);
        return gameIds.map(id => {
            if (typeof GAMES_CONFIG !== 'undefined') {
                return GAMES_CONFIG.getGameName(id);
            }
            return id;
        });
    },

    /**
     * Get active game display names for a platform (only games currently in tournament)
     */
    getActiveGameNamesForPlatform(platformId) {
        const gameIds = this.getGamesForPlatform(platformId);
        return gameIds
            .filter(id => {
                if (typeof GAMES_CONFIG !== 'undefined') {
                    const game = GAMES_CONFIG.getGame(id);
                    return game?.active;
                }
                return true;
            })
            .map(id => {
                if (typeof GAMES_CONFIG !== 'undefined') {
                    return GAMES_CONFIG.getGameName(id);
                }
                return id;
            });
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.PLATFORMS_CONFIG = PLATFORMS_CONFIG;
}

// Export for Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PLATFORMS_CONFIG;
}
