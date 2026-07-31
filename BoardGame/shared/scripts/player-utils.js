/**
 * ============================================================================
 * PLAYER-UTILS.JS - Normalized Player Data Utilities
 * ============================================================================
 *
 * Provides helper functions for managing players in a normalized data structure.
 * Players are stored in a central registry and referenced by ID throughout
 * the system (matches, history, queue, etc.)
 *
 * Data Structure:
 * - tournament.players: { [playerId]: { id, name, teamId, uid?, createdAt } }
 * - tournament.teams[].playerIds: [playerId, playerId, ...]
 * - gameHistory[].winningPlayerIds: [playerId, ...]
 * - gameQueue[].teams[].playerIds: [playerId, ...]
 */

// =============================================================================
// PLAYER ID GENERATION
// =============================================================================

/**
 * Generate a unique player ID
 * Format: p_<random8chars>
 * @returns {string} Unique player ID
 */
function generatePlayerId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'p_';
    for (let i = 0; i < 8; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

/**
 * Ensure a player has a valid ID, generating one if needed
 * @param {Object} player - Player object
 * @returns {string} Player ID
 */
function ensurePlayerId(player) {
    if (player.id && typeof player.id === 'string' && player.id.startsWith('p_')) {
        return player.id;
    }
    return generatePlayerId();
}

// =============================================================================
// PLAYERS REGISTRY MANAGEMENT
// =============================================================================

/**
 * Initialize or get the players registry from gameState
 * @param {Object} gameState - Tournament game state
 * @returns {Object} Players registry
 */
function getPlayersRegistry(gameState) {
    if (!gameState.players) {
        gameState.players = {};
    }
    return gameState.players;
}

/**
 * Add a player to the registry
 * @param {Object} gameState - Tournament game state
 * @param {Object} playerData - { name, teamId, uid? }
 * @returns {string} The player's ID
 */
function addPlayerToRegistry(gameState, playerData) {
    const registry = getPlayersRegistry(gameState);
    const playerId = playerData.id || generatePlayerId();

    registry[playerId] = {
        id: playerId,
        name: playerData.name || 'Unknown Player',
        teamId: playerData.teamId,
        uid: playerData.uid || null,
        createdAt: playerData.createdAt || new Date().toISOString()
    };

    return playerId;
}

/**
 * Update a player's information in the registry
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @param {Object} updates - Fields to update (name, teamId, etc.)
 */
function updatePlayerInRegistry(gameState, playerId, updates) {
    const registry = getPlayersRegistry(gameState);
    if (registry[playerId]) {
        Object.assign(registry[playerId], updates);
    }
}

/**
 * Remove a player from the registry
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID to remove
 */
function removePlayerFromRegistry(gameState, playerId) {
    const registry = getPlayersRegistry(gameState);
    delete registry[playerId];
}

// =============================================================================
// PLAYER LOOKUP
// =============================================================================

/**
 * Get a player by ID from the registry
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @returns {Object|null} Player object or null
 */
function getPlayerById(gameState, playerId) {
    const registry = getPlayersRegistry(gameState);
    return registry[playerId] || null;
}

/**
 * Get player name by ID, with fallback
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @param {string} fallback - Fallback name if not found
 * @returns {string} Player name
 */
function getPlayerName(gameState, playerId, fallback = 'Unknown') {
    const player = getPlayerById(gameState, playerId);
    return player?.name || fallback;
}

/**
 * Get player's team ID
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @returns {number|null} Team ID or null
 */
function getPlayerTeamId(gameState, playerId) {
    const player = getPlayerById(gameState, playerId);
    return player?.teamId || null;
}

/**
 * Get player's team object
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @returns {Object|null} Team object or null
 */
function getPlayerTeam(gameState, playerId) {
    const teamId = getPlayerTeamId(gameState, playerId);
    if (teamId === null) return null;
    return gameState.teams?.find(t => t.id === teamId) || null;
}

/**
 * Get player's team color
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @returns {string} Team color or default
 */
function getPlayerTeamColor(gameState, playerId) {
    const team = getPlayerTeam(gameState, playerId);
    return team?.color || '#666666';
}

/**
 * Resolve player IDs to full player objects
 * @param {Object} gameState - Tournament game state
 * @param {string[]} playerIds - Array of player IDs
 * @returns {Object[]} Array of player objects with team info
 */
function resolvePlayerIds(gameState, playerIds) {
    if (!playerIds || !Array.isArray(playerIds)) return [];

    return playerIds.map(playerId => {
        const player = getPlayerById(gameState, playerId);
        const team = player ? getPlayerTeam(gameState, playerId) : null;

        return {
            id: playerId,
            name: player?.name || 'Unknown',
            teamId: player?.teamId || null,
            teamName: team?.name || null,
            teamColor: team?.color || '#666666'
        };
    });
}

// =============================================================================
// TEAM-PLAYER MANAGEMENT
// =============================================================================

/**
 * Get all players for a team
 * @param {Object} gameState - Tournament game state
 * @param {number} teamId - Team ID
 * @returns {Object[]} Array of player objects
 */
function getTeamPlayers(gameState, teamId) {
    const team = gameState.teams?.find(t => t.id === teamId);
    if (!team) return [];

    // Support both old format (players array) and new format (playerIds)
    if (team.playerIds) {
        return team.playerIds.map(id => getPlayerById(gameState, id)).filter(Boolean);
    }

    // Legacy: players stored directly on team
    if (team.players) {
        return team.players;
    }

    return [];
}

/**
 * Get player IDs for a team
 * @param {Object} gameState - Tournament game state
 * @param {number} teamId - Team ID
 * @returns {string[]} Array of player IDs
 */
function getTeamPlayerIds(gameState, teamId) {
    const team = gameState.teams?.find(t => t.id === teamId);
    if (!team) return [];

    // New format
    if (team.playerIds) {
        return team.playerIds;
    }

    // Legacy: derive from players array if they have IDs
    if (team.players) {
        return team.players.map(p => p.id).filter(Boolean);
    }

    return [];
}

/**
 * Add a player to a team
 * @param {Object} gameState - Tournament game state
 * @param {number} teamId - Team ID
 * @param {Object} playerData - { name, uid? }
 * @returns {string} The new player's ID
 */
function addPlayerToTeam(gameState, teamId, playerData) {
    const team = gameState.teams?.find(t => t.id === teamId);
    if (!team) return null;

    // Add to registry
    const playerId = addPlayerToRegistry(gameState, {
        ...playerData,
        teamId: teamId
    });

    // Add to team's playerIds
    if (!team.playerIds) {
        team.playerIds = [];
    }
    team.playerIds.push(playerId);

    return playerId;
}

/**
 * Remove a player from a team (and registry)
 * @param {Object} gameState - Tournament game state
 * @param {number} teamId - Team ID
 * @param {string} playerId - Player ID
 */
function removePlayerFromTeam(gameState, teamId, playerId) {
    const team = gameState.teams?.find(t => t.id === teamId);
    if (team && team.playerIds) {
        team.playerIds = team.playerIds.filter(id => id !== playerId);
    }

    // Also remove from registry
    removePlayerFromRegistry(gameState, playerId);
}

/**
 * Move a player to a different team
 * @param {Object} gameState - Tournament game state
 * @param {string} playerId - Player ID
 * @param {number} newTeamId - New team ID
 */
function movePlayerToTeam(gameState, playerId, newTeamId) {
    const player = getPlayerById(gameState, playerId);
    if (!player) return;

    const oldTeamId = player.teamId;

    // Remove from old team's playerIds
    if (oldTeamId) {
        const oldTeam = gameState.teams?.find(t => t.id === oldTeamId);
        if (oldTeam && oldTeam.playerIds) {
            oldTeam.playerIds = oldTeam.playerIds.filter(id => id !== playerId);
        }
    }

    // Add to new team's playerIds
    const newTeam = gameState.teams?.find(t => t.id === newTeamId);
    if (newTeam) {
        if (!newTeam.playerIds) {
            newTeam.playerIds = [];
        }
        if (!newTeam.playerIds.includes(playerId)) {
            newTeam.playerIds.push(playerId);
        }
    }

    // Update player's teamId in registry
    updatePlayerInRegistry(gameState, playerId, { teamId: newTeamId });
}

// =============================================================================
// MIGRATION UTILITIES
// =============================================================================

/**
 * Migrate a tournament from old format (players inline) to new format (registry)
 * @param {Object} gameState - Tournament game state to migrate
 * @returns {Object} Migrated game state
 */
function migrateToNormalizedPlayers(gameState) {
    if (!gameState) return gameState;

    // Initialize registry if needed
    if (!gameState.players) {
        gameState.players = {};
    }

    // Name -> ID map used only as a best-effort lookup for migrating legacy
    // name-based gameHistory records below. It must NOT be used to reuse IDs
    // across team rosters: two different teams can legitimately have players
    // with the same (often placeholder, e.g. "Player 1") name, and reusing an
    // ID in that case merges two distinct players into one registry entry,
    // silently dropping one of them from their team's player count.
    const nameToIdMap = {};

    // IDs already claimed by an earlier roster slot in this pass. A slot whose
    // existing id was already claimed (duplicate, e.g. from an earlier corrupt
    // migration) gets a fresh one instead of reusing it — same for an id that
    // isn't in the registry at all (orphaned reference). Slots that are fine
    // are left completely untouched.
    const seenIds = new Set();

    // Migrate team players
    if (gameState.teams) {
        gameState.teams.forEach(team => {
            if (team.players && Array.isArray(team.players)) {
                const playerIds = [];

                team.players.forEach(player => {
                    const normalizedName = player.name?.trim().toLowerCase();
                    const hasValidUnclaimedId = player.id
                        && player.id.startsWith('p_')
                        && !seenIds.has(player.id);
                    const playerId = hasValidUnclaimedId ? player.id : generatePlayerId();
                    player.id = playerId;
                    seenIds.add(playerId);

                    if (normalizedName && !nameToIdMap[normalizedName]) {
                        nameToIdMap[normalizedName] = playerId;
                    }

                    // Add/update in registry, preserving the original creation time
                    // across re-runs instead of stamping a new one every load.
                    gameState.players[playerId] = {
                        id: playerId,
                        name: player.name || 'Unknown',
                        teamId: team.id,
                        uid: player.uid || null,
                        createdAt: player.joinedAt || player.createdAt || gameState.players[playerId]?.createdAt || new Date().toISOString()
                    };

                    playerIds.push(playerId);
                });

                // Set playerIds on team
                team.playerIds = playerIds;
            }
        });

        // Drop registry entries no longer referenced by any team (e.g. a player
        // removed from a roster, or an orphan left behind by earlier corruption).
        const referencedIds = new Set(gameState.teams.flatMap(t => t.playerIds || []));
        Object.keys(gameState.players).forEach(id => {
            if (!referencedIds.has(id)) delete gameState.players[id];
        });
    }

    // Migrate gameHistory to use player IDs
    if (gameState.gameHistory) {
        gameState.gameHistory = gameState.gameHistory.map(match => {
            const migratedMatch = { ...match };

            // Migrate winningPlayers
            if (match.winningPlayers && Array.isArray(match.winningPlayers)) {
                migratedMatch.winningPlayerIds = match.winningPlayers.map(p => {
                    const normalizedName = p.name?.trim().toLowerCase();
                    return nameToIdMap[normalizedName] || p.id || null;
                }).filter(Boolean);
            }

            // Migrate losingPlayers
            if (match.losingPlayers && Array.isArray(match.losingPlayers)) {
                migratedMatch.losingPlayerIds = match.losingPlayers.map(p => {
                    const normalizedName = p.name?.trim().toLowerCase();
                    return nameToIdMap[normalizedName] || p.id || null;
                }).filter(Boolean);
            }

            // Migrate matchup
            if (match.matchup) {
                const migratedMatchup = {};
                Object.keys(match.matchup).forEach(side => {
                    const players = match.matchup[side];
                    if (Array.isArray(players)) {
                        migratedMatchup[side] = players.map(p => {
                            if (typeof p === 'string') return p; // Already an ID
                            const normalizedName = p.name?.trim().toLowerCase();
                            return nameToIdMap[normalizedName] || p.id || null;
                        }).filter(Boolean);
                    }
                });
                migratedMatch.matchup = migratedMatchup;
            }

            return migratedMatch;
        });
    }

    // Mark as migrated
    gameState.playersMigrated = true;
    gameState.playersMigratedAt = new Date().toISOString();

    return gameState;
}

/**
 * Check if a tournament needs migration
 * @param {Object} gameState - Tournament game state
 * @returns {boolean} True if migration needed
 */
function needsPlayerMigration(gameState) {
    if (!gameState) return false;

    // Note: deliberately NOT gated on gameState.playersMigrated. A team or
    // player added after the first migration run would otherwise never get
    // backfilled into the registry, since that flag is set once and never
    // cleared. Re-scanning every load is cheap (a handful of teams/players)
    // and migrateToNormalizedPlayers() is idempotent for already-migrated ones.
    if (!gameState.teams) return false;

    const registry = gameState.players || {};
    const seenIds = new Set();

    for (const team of gameState.teams) {
        if (!team.players || team.players.length === 0) continue;

        for (const p of team.players) {
            // Missing/malformed id
            if (!p.id || !p.id.startsWith('p_')) return true;
            // Duplicate id reused across roster slots (the corruption pattern
            // a stale cross-team name-dedup once produced)
            if (seenIds.has(p.id)) return true;
            seenIds.add(p.id);
            // Slot points at an id that was never actually saved to the registry
            if (!registry[p.id]) return true;
            // Registry disagrees about which team owns this id
            if (String(registry[p.id].teamId) !== String(team.id)) return true;
        }
    }

    return false;
}

// =============================================================================
// BACKWARD COMPATIBILITY
// =============================================================================

/**
 * Get player display info, supporting both old and new formats
 * Works whether player is stored as object or referenced by ID
 * @param {Object} gameState - Tournament game state
 * @param {Object|string} playerOrId - Player object or player ID
 * @returns {Object} { id, name, teamId, teamName, teamColor }
 */
function getPlayerDisplayInfo(gameState, playerOrId) {
    // If it's already an object with name, use it directly (legacy support)
    if (typeof playerOrId === 'object' && playerOrId.name) {
        const teamId = playerOrId.teamId || playerOrId.originalTeamId;
        const team = teamId ? gameState.teams?.find(t => t.id === teamId) : null;

        return {
            id: playerOrId.id || null,
            name: playerOrId.name,
            teamId: teamId,
            teamName: playerOrId.originalTeamName || team?.name || null,
            teamColor: playerOrId.originalTeamColor || team?.color || '#666666'
        };
    }

    // It's an ID string - look up from registry
    if (typeof playerOrId === 'string') {
        const player = getPlayerById(gameState, playerOrId);
        const team = player ? getPlayerTeam(gameState, playerOrId) : null;

        return {
            id: playerOrId,
            name: player?.name || 'Unknown',
            teamId: player?.teamId || null,
            teamName: team?.name || null,
            teamColor: team?.color || '#666666'
        };
    }

    return {
        id: null,
        name: 'Unknown',
        teamId: null,
        teamName: null,
        teamColor: '#666666'
    };
}

// =============================================================================
// EXPORTS (for non-module usage, attach to window)
// =============================================================================

if (typeof window !== 'undefined') {
    window.PlayerUtils = {
        // ID Generation
        generatePlayerId,
        ensurePlayerId,

        // Registry Management
        getPlayersRegistry,
        addPlayerToRegistry,
        updatePlayerInRegistry,
        removePlayerFromRegistry,

        // Player Lookup
        getPlayerById,
        getPlayerName,
        getPlayerTeamId,
        getPlayerTeam,
        getPlayerTeamColor,
        resolvePlayerIds,

        // Team-Player Management
        getTeamPlayers,
        getTeamPlayerIds,
        addPlayerToTeam,
        removePlayerFromTeam,
        movePlayerToTeam,

        // Migration
        migrateToNormalizedPlayers,
        needsPlayerMigration,

        // Backward Compatibility
        getPlayerDisplayInfo
    };
}
