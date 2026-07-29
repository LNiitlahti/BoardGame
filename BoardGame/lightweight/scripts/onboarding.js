/**
 * ============================================================================
 * ONBOARDING-LIGHTWEIGHT.JS - Tournament Player Readiness System
 * ============================================================================
 *
 * Handles both player and admin views for tournament onboarding checklist.
 * Players confirm they've added friends and tested games.
 * Admins see overall progress and can edit player status.
 *
 * Player IDs: Uses real player IDs (e.g. "p_fml4z1tp") as keys everywhere —
 * URL params, Firebase data keys, friend references. Legacy number-keyed data
 * is auto-migrated on first load.
 */

// =============================================================================
// GLOBAL STATE
// =============================================================================

let gameState = null;
let onboardingState = null;  // Separate state from subcollection
let tournamentId = null;
let currentPlayerId = null;
let isAdminView = false;
let isPlatformOnly = false;
let editingPlayerId = null;
let unsubscribe = null;
let onboardingUnsubscribe = null;
let urlSecret = null;
let secretValidated = false;
let onboardingReady = false;
let profilePlatformIds = null; // cross-tournament platformIds from users/{uid}, when known

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    tournamentId = urlParams.get('tournamentId') || urlParams.get('tournament');
    const playerParam = urlParams.get('player');
    const viewParam = urlParams.get('view');
    urlSecret = urlParams.get('secret') || '';

    // Determine mode
    isAdminView = viewParam === 'true';
    isPlatformOnly = urlParams.get('platform-only') === '1';
    currentPlayerId = playerParam || null;

    // Validate parameters
    if (!tournamentId) {
        showError('No tournament ID specified. Use ?tournamentId=xxx');
        return;
    }

    if (!isAdminView && !currentPlayerId) {
        showError('Invalid player link. Check the URL sent to you.');
        return;
    }
});

document.addEventListener('firebase-ready', function() {
    if (!tournamentId) return;

    // Anonymous auth is handled by firebase-loader.js
    setupTournamentListener();
});

// =============================================================================
// FIREBASE LISTENER
// =============================================================================

function setupTournamentListener() {
    const db = window.firebaseDB;
    const tournamentRef = db.collection('tournaments').doc(tournamentId);

    unsubscribe = window.firebaseOnSnapshot(tournamentRef, async (docSnapshot) => {
        if (docSnapshot.exists) {
            gameState = docSnapshot.data();
            gameState.id = tournamentId;

            // One-time setup: migrate and start onboarding subcollection listener
            if (!onboardingUnsubscribe) {
                await migrateOnboardingToSubcollection();
                setupOnboardingListener();
            }

            renderCurrentView();
        } else {
            showError('Tournament not found: ' + tournamentId);
        }
    }, (error) => {
        console.error('Firebase listener error:', error);
        showError('Failed to load tournament data');
    });
}

function setupOnboardingListener() {
    const db = window.firebaseDB;
    const onboardingRef = db.collection('tournaments').doc(tournamentId)
        .collection('onboarding').doc('state');

    onboardingUnsubscribe = window.firebaseOnSnapshot(onboardingRef, (docSnapshot) => {
        if (docSnapshot.exists) {
            onboardingState = docSnapshot.data();
        } else {
            onboardingState = null;
        }
        onboardingReady = true;
        renderCurrentView();
    }, (error) => {
        console.error('Onboarding listener error:', error);
    });
}

async function renderCurrentView() {
    if (!gameState || !onboardingReady) return;

    // Initialize default onboarding structure if subcollection was empty
    if (!onboardingState) {
        onboardingState = createDefaultOnboardingData();
    }

    // Migrate legacy number-keyed data to player ID keys
    await migrateNumberKeysToPlayerIds();

    // Ensure current player has an entry (handles new players added after initial creation)
    if (!isAdminView && currentPlayerId && !onboardingState.players[currentPlayerId]) {
        onboardingState.players[currentPlayerId] = {
            friendsAdded: {},
            gamesTested: {},
            lastUpdated: null,
            completedAt: null
        };
    }

    // Validate player ID exists in team data (player view only)
    if (!isAdminView && currentPlayerId) {
        const allIds = getAllPlayerIds();
        if (!allIds.includes(currentPlayerId)) {
            showError('Player not found in this tournament. Check the link sent to you.');
            return;
        }
    }

    // Validate secret before rendering (player view only)
    if (!secretValidated) {
        await validateSecretAccess();
        return; // validateSecretAccess calls renderCurrentView again on success
    }

    // Load cross-tournament platform IDs once we know who the player really is
    if (!isAdminView && profilePlatformIds === null) {
        await loadProfilePlatformIds();
    }

    // Show appropriate view
    hideLoading();
    if (isAdminView) {
        document.getElementById('adminView').style.display = 'block';
        renderAdminView();
    } else {
        document.getElementById('playerView').style.display = 'block';
        renderPlayerView();
    }
}

function getPlayerUid(playerId) {
    const teams = gameState?.teams || [];
    for (const team of teams) {
        const player = (team.players || []).find(p => p.id === playerId);
        if (player) return player.uid || null;
    }
    return null;
}

// True when the browser is authenticated (non-anonymously) as the real
// account linked to this player record — i.e. we can safely read/write
// their cross-tournament user profile.
function isAuthedOwner(playerId) {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser || currentUser.isAnonymous) return false;
    const playerUid = getPlayerUid(playerId);
    return !!playerUid && playerUid === currentUser.uid;
}

// Platform IDs (Steam/BattleTag/Xbox/Discord) rarely change, so — only when
// we know who the player really is — we mirror them onto users/{uid} and
// pre-fill from there for a returning player in a later tournament. Friend
// and game-test checklists deliberately stay per-tournament.
async function loadProfilePlatformIds() {
    if (!isAuthedOwner(currentPlayerId)) {
        profilePlatformIds = null;
        return;
    }
    try {
        const uid = firebase.auth().currentUser.uid;
        const userDoc = await window.firebaseDB.collection('users').doc(uid).get();
        profilePlatformIds = userDoc.exists ? (userDoc.data().platformIds || {}) : {};
        await carryForwardProfilePlatformIds();
    } catch (error) {
        console.error('Failed to load profile platform IDs:', error);
        profilePlatformIds = null;
    }
}

// Copy any profile-level platform IDs the player hasn't already set for THIS
// tournament into the tournament's onboarding record, so returning players
// show up to teammates immediately without re-typing anything.
async function carryForwardProfilePlatformIds() {
    if (!profilePlatformIds || Object.keys(profilePlatformIds).length === 0) return;
    const playerData = onboardingState?.players?.[currentPlayerId];
    if (!playerData) return;
    const existing = playerData.platformIds || {};

    const updates = {};
    for (const [key, value] of Object.entries(profilePlatformIds)) {
        if (value && !existing[key]) {
            updates[`players.${currentPlayerId}.platformIds.${key}`] = value;
            existing[key] = value;
        }
    }
    if (Object.keys(updates).length === 0) return;

    playerData.platformIds = existing;
    updates[`players.${currentPlayerId}.lastUpdated`] = new Date().toISOString();
    try {
        await getOnboardingRef().update(updates);
    } catch (error) {
        console.error('Failed to carry forward platform IDs:', error);
    }
}

async function saveProfilePlatformId(platformKey, value) {
    if (!isAuthedOwner(currentPlayerId)) return;
    try {
        const uid = firebase.auth().currentUser.uid;
        await window.firebaseDB.collection('users').doc(uid).update({
            [`platformIds.${platformKey}`]: value
        });
    } catch (error) {
        console.error('Failed to save profile platform ID:', error);
    }
}

async function validateSecretAccess() {
    const storedHash = onboardingState?.secretHash || '';
    const legacySecret = onboardingState?.secret || '';

    // Admin view doesn't need secret validation
    if (!isAdminView && (storedHash || legacySecret)) {
        // Authenticated-owner bypass: a logged-in (non-anonymous) user whose uid
        // matches this player's linked account can reach their own onboarding
        // page without the shared secret.
        const currentUser = firebase.auth().currentUser;
        if (currentUser && !currentUser.isAnonymous) {
            const playerUid = getPlayerUid(currentPlayerId);
            if (playerUid && playerUid === currentUser.uid) {
                secretValidated = true;
                renderCurrentView();
                return;
            }
        }

        const urlSecretHash = await hashSecret(urlSecret);
        const validHash = storedHash && urlSecretHash === storedHash;
        const validLegacy = legacySecret && urlSecret === legacySecret;

        if (!validHash && !validLegacy) {
            showError('ACCESS DENIED - Invalid or missing secret in URL');
            return;
        }
    }

    secretValidated = true;
    renderCurrentView();
}

// =============================================================================
// PLAYER ID HELPERS
// =============================================================================

/**
 * Get ordered array of all real player IDs from team data.
 * Order: teams in order, players within each team in order.
 */
function getAllPlayerIds() {
    const ids = [];
    const teams = gameState?.teams || [];
    for (const team of teams) {
        for (const player of (team.players || [])) {
            if (player.id) ids.push(player.id);
        }
    }
    return ids;
}

/**
 * Build mapping keyed by real player ID.
 * Returns: { "p_abc123": { id, name, teamId, teamName, teamColor }, ... }
 */
function getPlayerMapping() {
    const mapping = {};
    const teams = gameState?.teams || [];

    for (const team of teams) {
        for (const player of (team.players || [])) {
            if (!player.id) continue;
            mapping[player.id] = {
                id: player.id,
                name: player.name || player.id,
                teamId: team.id,
                teamName: team.name || `Team ${team.id}`,
                teamColor: team.color || '#666666'
            };
        }
    }

    return mapping;
}

// =============================================================================
// ONBOARDING DATA MANAGEMENT
// =============================================================================

function createDefaultOnboardingData() {
    const data = { players: {} };
    const allIds = getAllPlayerIds();
    for (const playerId of allIds) {
        data.players[playerId] = {
            friendsAdded: {},
            gamesTested: {},
            lastUpdated: null,
            completedAt: null
        };
    }
    return data;
}

/**
 * Migrate onboarding data from main tournament doc to subcollection.
 * Idempotent — safe to call from multiple tabs.
 */
async function migrateOnboardingToSubcollection() {
    const db = window.firebaseDB;
    const onboardingRef = db.collection('tournaments').doc(tournamentId)
        .collection('onboarding').doc('state');

    try {
        const onboardingDoc = await onboardingRef.get();

        if (onboardingDoc.exists) {
            // Already migrated — subcollection is authoritative
            return;
        }

        // Check if main doc has onboarding data to migrate
        if (gameState.onboarding && Object.keys(gameState.onboarding).length > 0) {
            const onboardingData = { ...gameState.onboarding };
            delete onboardingData._plainSecret; // Memory-only, never persist

            await onboardingRef.set(onboardingData);

            // Delete from main tournament doc
            const tournamentRef = db.collection('tournaments').doc(tournamentId);
            await tournamentRef.update({
                onboarding: firebase.firestore.FieldValue.delete()
            });

            console.log('Migrated onboarding data to subcollection');
        } else if (!gameState.onboarding) {
            // No existing data — create fresh structure in subcollection
            await onboardingRef.set(createDefaultOnboardingData());
        }
    } catch (error) {
        console.error('Migration error:', error);
    }
}

/**
 * Migrate onboarding data from number-keyed ("1"-"10") to player-ID-keyed ("p_xxx").
 * Also migrates friendsAdded references. Stores backup of original data.
 * Idempotent — guarded by _migrated_to_ids flag.
 */
async function migrateNumberKeysToPlayerIds() {
    if (!onboardingState || onboardingState._migrated_to_ids) return;

    const allIds = getAllPlayerIds();
    if (allIds.length === 0) return; // No team data yet, skip

    // Check if data actually uses number keys
    const playerKeys = Object.keys(onboardingState.players || {});
    const hasNumberKeys = playerKeys.some(k => /^\d+$/.test(k));

    if (!hasNumberKeys) {
        // Already using ID keys or empty — just mark migrated
        onboardingState._migrated_to_ids = true;
        return;
    }

    // Build number-to-ID mapping: { "1": "p_abc", "2": "p_def", ... }
    const numToId = {};
    let playerNum = 1;
    const teams = gameState?.teams || [];
    for (const team of teams) {
        for (const player of (team.players || [])) {
            if (player.id) {
                numToId[String(playerNum)] = player.id;
                playerNum++;
            }
        }
    }

    // Safety check: every existing number key must map to a player ID
    const numberKeys = playerKeys.filter(k => /^\d+$/.test(k));
    for (const numKey of numberKeys) {
        if (!numToId[numKey]) {
            console.warn(`Migration aborted: no player ID mapping for key "${numKey}". Team data may be incomplete.`);
            return;
        }
    }

    // Back up original data before migration
    const backup = JSON.parse(JSON.stringify(onboardingState.players));

    // Build new players object with ID keys
    const newPlayers = {};
    for (const [numStr, playerId] of Object.entries(numToId)) {
        const oldData = onboardingState.players[numStr];
        if (!oldData) {
            newPlayers[playerId] = {
                friendsAdded: {},
                gamesTested: {},
                lastUpdated: null,
                completedAt: null
            };
            continue;
        }

        // Migrate friendsAdded: convert number keys to player ID keys
        const newFriendsAdded = {};
        for (const [friendNum, value] of Object.entries(oldData.friendsAdded || {})) {
            const friendId = numToId[friendNum];
            if (friendId) {
                newFriendsAdded[friendId] = value;
            }
        }

        newPlayers[playerId] = {
            ...oldData,
            friendsAdded: newFriendsAdded
        };
    }

    // Write migrated data to Firebase (atomic write with backup)
    try {
        const onboardingRef = getOnboardingRef();
        await onboardingRef.set({
            ...onboardingState,
            players: newPlayers,
            _migrated_to_ids: true,
            _pre_migration_backup: backup
        });

        // Update local state
        onboardingState.players = newPlayers;
        onboardingState._migrated_to_ids = true;
        onboardingState._pre_migration_backup = backup;

        console.log('Migrated onboarding data from number keys to player ID keys');
    } catch (error) {
        console.error('Failed to migrate onboarding keys:', error);
    }
}

function getOnboardingRef() {
    const db = window.firebaseDB;
    return db.collection('tournaments').doc(tournamentId)
        .collection('onboarding').doc('state');
}

function getSelectedGames() {
    // Get games from tournament's selectedGames array
    const selectedGames = gameState?.selectedGames || [];

    return selectedGames.map(gameId => {
        // Check GAMES_CONFIG first
        if (typeof GAMES_CONFIG !== 'undefined') {
            const game = GAMES_CONFIG.getGame(gameId);
            if (game) {
                return { id: gameId, ...game };
            }
        }

        // Check tournament's custom gameDefinitions
        if (gameState?.gameDefinitions?.[gameId]) {
            return { id: gameId, ...gameState.gameDefinitions[gameId] };
        }

        // Fallback
        return { id: gameId, name: gameId, icon: '🎮' };
    });
}

async function toggleFriendStatus(otherPlayerId, forPlayerId = currentPlayerId) {
    const playerData = onboardingState.players[forPlayerId];
    if (!playerData) return;

    const currentStatus = playerData.friendsAdded[otherPlayerId] || false;
    playerData.friendsAdded[otherPlayerId] = !currentStatus;
    playerData.lastUpdated = new Date().toISOString();

    // Check completion
    checkPlayerCompletion(forPlayerId);

    await savePlayerField(forPlayerId, {
        [`friendsAdded.${otherPlayerId}`]: !currentStatus,
        completedAt: playerData.completedAt || null
    });
}

async function toggleGameStatus(gameId, forPlayerId = currentPlayerId) {
    const playerData = onboardingState.players[forPlayerId];
    if (!playerData) return;

    const currentStatus = playerData.gamesTested[gameId] || false;
    playerData.gamesTested[gameId] = !currentStatus;
    playerData.lastUpdated = new Date().toISOString();

    // Check completion
    checkPlayerCompletion(forPlayerId);

    await savePlayerField(forPlayerId, {
        [`gamesTested.${gameId}`]: !currentStatus,
        completedAt: playerData.completedAt || null
    });
}

function checkPlayerCompletion(playerId) {
    const playerData = onboardingState.players[playerId];
    if (!playerData) return;

    const games = getSelectedGames();
    const allIds = getAllPlayerIds();
    const otherIds = allIds.filter(id => id !== playerId);
    const totalFriends = otherIds.length;
    const totalGames = games.length;

    // Count completed
    let friendsComplete = 0;
    for (const otherId of otherIds) {
        if (playerData.friendsAdded[otherId]) {
            friendsComplete++;
        }
    }

    let gamesComplete = 0;
    for (const game of games) {
        if (playerData.gamesTested[game.id]) {
            gamesComplete++;
        }
    }

    // Mark complete if all done
    if (friendsComplete >= totalFriends && gamesComplete >= totalGames) {
        if (!playerData.completedAt) {
            playerData.completedAt = new Date().toISOString();
        }
    } else {
        playerData.completedAt = null;
    }
}

// Debounced save: batches rapid checkbox toggles into a single Firebase write
const _pendingSaves = {};
const _saveTimers = {};
const SAVE_DEBOUNCE_MS = 500;

async function savePlayerField(playerId, fields) {
    // Merge fields into pending batch for this player
    if (!_pendingSaves[playerId]) _pendingSaves[playerId] = {};
    for (const [key, value] of Object.entries(fields)) {
        _pendingSaves[playerId][`players.${playerId}.${key}`] = value;
    }

    // Reset the debounce timer
    if (_saveTimers[playerId]) clearTimeout(_saveTimers[playerId]);

    _saveTimers[playerId] = setTimeout(async () => {
        const update = { ..._pendingSaves[playerId] };
        update[`players.${playerId}.lastUpdated`] = new Date().toISOString();
        delete _pendingSaves[playerId];
        delete _saveTimers[playerId];

        try {
            const onboardingRef = getOnboardingRef();
            await onboardingRef.update(update);
        } catch (error) {
            console.error('Failed to save onboarding status:', error);
        }
    }, SAVE_DEBOUNCE_MS);
}

// =============================================================================
// PLAYER VIEW RENDERING
// =============================================================================

function renderPlayerView() {
    const playerMapping = getPlayerMapping();
    const currentPlayer = playerMapping[currentPlayerId];

    // Update header
    document.getElementById('tournamentName').textContent = gameState.name || 'Tournament';
    document.getElementById('playerInfo').textContent = `Welcome, ${currentPlayer.name}`;

    // Render status buttons
    renderStatusButtons(currentPlayerId);

    // Render platform IDs form
    renderPlatformIdsForm(currentPlayerId);

    if (isPlatformOnly) {
        // Hide friends and games sections
        document.querySelectorAll('.checklist-section:not(.platform-section)').forEach(s => s.style.display = 'none');
    } else {
        // Render checklists
        renderFriendsChecklist(playerMapping, currentPlayerId, 'friendsChecklist');
        renderGamesChecklist(currentPlayerId, 'gamesChecklist');
    }

    // Update progress
    updateProgress(currentPlayerId);
}

function renderPlatformIdsForm(forPlayerId) {
    const container = document.getElementById('platformIdsForm');
    if (!container) return;

    const playerData = onboardingState?.players?.[forPlayerId] || {};
    const platformIds = playerData.platformIds || {};

    const activePlatforms = PLATFORMS_CONFIG.getActivePlatforms();
    let html = '';
    for (const platform of activePlatforms) {
        const currentValue = platformIds[platform.id] || '';
        const hasValue = currentValue.length > 0;

        html += `
            <div class="platform-id-row ${hasValue ? 'has-value' : ''}">
                <div class="platform-id-header">
                    <span class="platform-icon">${platform.icon}</span>
                    <span class="platform-name">${platform.name}</span>
                </div>
                <div class="platform-id-input-row">
                    <input type="text"
                           id="platform-${platform.id}"
                           placeholder="${platform.placeholder}"
                           value="${currentValue}"
                           onchange="savePlatformId('${platform.id}', this.value)">
                </div>
                <div class="platform-help">
                    ${platform.help}
                    ${platform.helpUrl ? ` <a href="${platform.helpUrl}" target="_blank">Open →</a>` : ''}
                </div>
            </div>
        `;
    }

    html += `<button class="btn primary save-all-btn" onclick="saveAllPlatformIds()">Save All</button>`;

    container.innerHTML = html;
}

function renderFriendsChecklist(playerMapping, forPlayerId, containerId) {
    const container = document.getElementById(containerId);
    const playerData = onboardingState?.players?.[forPlayerId] || {};
    const friendsAdded = playerData.friendsAdded || {};
    const isEditMode = containerId.includes('edit');
    const allIds = getAllPlayerIds();

    let html = '';
    for (const otherId of allIds) {
        if (otherId === forPlayerId) continue; // Skip self

        const info = playerMapping[otherId];
        if (!info) continue;
        const isChecked = friendsAdded[otherId] || false;
        const friendData = onboardingState?.players?.[otherId] || {};
        const friendPlatformIds = friendData.platformIds || {};

        // Build platform IDs display
        let platformIdsHtml = '';
        let hasPlatformIds = false;
        const activePlatforms = PLATFORMS_CONFIG.getActivePlatforms();
        for (const platform of activePlatforms) {
            const platformId = friendPlatformIds[platform.id];
            if (platformId) {
                hasPlatformIds = true;
                const escapedId = platformId.replace(/'/g, "\\'");
                platformIdsHtml += `
                    <span class="friend-platform-id-group">
                        <span class="friend-platform-id" onclick="copyPlatformId(this, '${escapedId}')" title="Click to copy">
                            <span class="platform-label">${platform.icon}</span>
                            ${platformId}
                        </span>
                    </span>
                `;
            }
        }

        if (!hasPlatformIds) {
            platformIdsHtml = '<span class="no-ids-message">No platform IDs added yet</span>';
        }

        html += `
            <div class="friend-card ${isChecked ? 'checked' : ''}">
                <div class="friend-card-header">
                    <input type="checkbox"
                           ${isChecked ? 'checked' : ''}
                           onchange="${isEditMode ? `toggleFriendStatusEdit('${otherId}')` : `toggleFriendStatus('${otherId}')`}">
                    <span class="team-dot" style="background: ${info.teamColor}"></span>
                    <span class="player-name">${info.name}</span>
                    <span class="team-name">${info.teamName}</span>
                </div>
                <div class="friend-platform-ids">
                    ${platformIdsHtml}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Game tutorial links (hardcoded for current event)
const GAME_TUTORIALS = {
    'predecessor': { url: 'https://www.youtube.com/watch?v=Wdf4sEEg2h0&t=47s', label: 'How to Play' },
    'wc3':         { url: 'https://youtu.be/5ygNDJdUVnY', label: 'How to Play' },
    'aoe4':        { url: 'https://youtu.be/V-XbTO0TZN4', label: 'How to Play' },
    'overwatch2':  { url: 'https://youtu.be/u2mMbSKf6iE', label: 'How to Play' },
    'cs2':         { text: 'Mouse1 to shoot.' },
    'cod':         { text: 'Also Mouse1 to shoot.' },
    'spellbreak':  { url: 'https://www.youtube.com/watch?v=ZqyoxdEY1PY', label: 'How to Play' },
    'beerdrinking': { url: 'https://www.youtube.com/watch?v=iyNmwu1R21c&si=URDInlLZG4vU4eVX', label: 'How to Drink' }
};

function renderGamesChecklist(forPlayerId, containerId) {
    const container = document.getElementById(containerId);
    const games = getSelectedGames();
    const playerData = onboardingState?.players?.[forPlayerId] || {};
    const gamesTested = playerData.gamesTested || {};
    const isEditMode = containerId.includes('edit');

    if (games.length === 0) {
        container.innerHTML = '<p style="color: var(--text-tertiary); padding: var(--spacing-md);">No games configured for this tournament.</p>';
        return;
    }

    let html = '';
    for (const game of games) {
        const isChecked = gamesTested[game.id] || false;
        const resolvedImage = game.image ? GAMES_CONFIG.resolveImagePath(game.image) : '';
        const imageHtml = game.image
            ? `<img src="${resolvedImage}" alt="${game.name}" onerror="this.parentNode.innerHTML='${game.icon || '🎮'}'">`
            : (game.icon || '🎮');

        const tutorial = GAME_TUTORIALS[game.id];
        let tutorialHtml = '';
        if (tutorial) {
            if (tutorial.url) {
                tutorialHtml = `<a class="game-tutorial-link" href="${tutorial.url}" target="_blank" onclick="event.stopPropagation();">${tutorial.label} \u2192</a>`;
            } else if (tutorial.text) {
                tutorialHtml = `<span class="game-tutorial-text">${tutorial.text}</span>`;
            }
        }

        html += `
            <label class="checklist-item game-item ${isChecked ? 'checked' : ''}">
                <input type="checkbox"
                       ${isChecked ? 'checked' : ''}
                       onchange="${isEditMode ? `toggleGameStatusEdit('${game.id}')` : `toggleGameStatus('${game.id}')`}">
                <span class="game-icon">${imageHtml}</span>
                <span class="game-name">${game.name}</span>
                ${tutorialHtml}
            </label>
        `;
    }

    container.innerHTML = html;
}

function updateProgress(playerId) {
    const playerData = onboardingState?.players?.[playerId] || {};
    const games = getSelectedGames();

    let totalTasks, completed;

    if (isPlatformOnly) {
        // Only count platform IDs
        const activePlatforms = typeof PLATFORMS_CONFIG !== 'undefined' ? PLATFORMS_CONFIG.getActivePlatforms() : [];
        totalTasks = activePlatforms.length;
        completed = 0;
        const platformIds = playerData.platformIds || {};
        for (const platform of activePlatforms) {
            if (platformIds[platform.id]?.trim()) completed++;
        }
    } else {
        const allIds = getAllPlayerIds();
        const otherIds = allIds.filter(id => id !== playerId);
        totalTasks = otherIds.length + games.length;
        completed = 0;

        // Count friends
        for (const otherId of otherIds) {
            if (playerData.friendsAdded?.[otherId]) {
                completed++;
            }
        }

        // Count games
        for (const game of games) {
            if (playerData.gamesTested?.[game.id]) {
                completed++;
            }
        }
    }

    const percent = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;

    // Update progress ring
    const progressRing = document.getElementById('progressRing');
    const progressPercent = document.getElementById('progressPercent');

    progressRing.style.setProperty('--progress', percent);
    progressPercent.textContent = `${percent}%`;

    if (percent === 100) {
        progressRing.classList.add('complete');
    } else {
        progressRing.classList.remove('complete');
    }

    // Update footer
    const footer = document.getElementById('completionFooter');
    const message = document.getElementById('completionMessage');

    if (percent === 100) {
        footer.classList.add('complete');
        message.textContent = 'All Ready!';
    } else {
        footer.classList.remove('complete');
        message.textContent = `Complete all tasks above (${completed}/${totalTasks})`;
    }
}

// =============================================================================
// ADMIN VIEW RENDERING
// =============================================================================

function renderAdminView() {
    const playerMapping = getPlayerMapping();
    const hasSecretHash = !!onboardingState?.secretHash;
    const hasLegacySecret = !!onboardingState?.secret;
    const plainSecret = onboardingState?._plainSecret || onboardingState?.secret || '';

    // Update header
    document.getElementById('adminTournamentName').textContent = gameState.name || 'Tournament';

    // Update secret button to show status
    const secretBtn = document.querySelector('.header-actions .btn:first-child');
    if (secretBtn) {
        if (hasSecretHash) {
            secretBtn.textContent = plainSecret ? `Secret: ${plainSecret.substring(0, 8)}...` : 'Secret Set (enter to copy links)';
            secretBtn.classList.add('btn-success');
        } else if (hasLegacySecret) {
            secretBtn.textContent = `Secret: ${onboardingState.secret.substring(0, 8)}...`;
            secretBtn.classList.add('btn-success');
        } else {
            secretBtn.textContent = 'Set Secret';
            secretBtn.classList.remove('btn-success');
        }
    }

    // Render summary grid
    renderSummaryGrid(playerMapping);

    // Render links list
    renderLinksList(playerMapping);
}

function renderSummaryGrid(playerMapping) {
    const container = document.getElementById('summaryGrid');
    const games = getSelectedGames();
    const allIds = getAllPlayerIds();

    let html = '';
    for (const playerId of allIds) {
        const info = playerMapping[playerId];
        if (!info) continue;
        const playerData = onboardingState?.players?.[playerId] || {};

        // Calculate progress
        const otherIds = allIds.filter(id => id !== playerId);
        let friendsComplete = 0;
        for (const otherId of otherIds) {
            if (playerData.friendsAdded?.[otherId]) {
                friendsComplete++;
            }
        }

        let gamesComplete = 0;
        for (const game of games) {
            if (playerData.gamesTested?.[game.id]) {
                gamesComplete++;
            }
        }

        const totalTasks = otherIds.length + games.length;
        const completedTasks = friendsComplete + gamesComplete;
        const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        // Determine status
        let statusClass = 'not-started';
        let statusText = 'Not Started';
        if (percent === 100) {
            statusClass = 'complete';
            statusText = 'DONE';
        } else if (percent > 0) {
            statusClass = 'in-progress';
            statusText = `${percent}%`;
        }

        html += `
            <div class="player-card ${statusClass}">
                <div class="team-indicator" style="background: ${info.teamColor}"></div>
                <div class="player-name">${info.name}</div>
                <div class="team-name">${info.teamName}</div>
                <div class="player-status-icons">${getPlayerStatusIcons(playerId)}</div>
                <div class="progress-stats">
                    <div>Friends: ${friendsComplete}/${otherIds.length}</div>
                    <div>Games: ${gamesComplete}/${games.length}</div>
                </div>
                <div class="status-badge ${statusClass}">${statusText}</div>
                <button class="btn secondary edit-btn" onclick="openEditModal('${playerId}')">Edit</button>
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderLinksList(playerMapping) {
    const container = document.getElementById('linksList');
    const baseUrl = window.location.origin + window.location.pathname;
    const hasSecretHash = !!onboardingState?.secretHash;
    const plainSecret = onboardingState?._plainSecret || onboardingState?.secret || '';
    const allIds = getAllPlayerIds();

    let html = '';

    // Warning if secret is set but we don't have the plain text
    if (hasSecretHash && !plainSecret) {
        html += `
            <div class="status-message warning" style="margin-bottom: var(--spacing-md);">
                Secret is set but not available. Click "Set Secret" and enter the secret phrase to generate working links.
            </div>
        `;
    }

    for (const playerId of allIds) {
        const info = playerMapping[playerId];
        if (!info) continue;
        let playerUrl = `${baseUrl}?tournamentId=${encodeURIComponent(tournamentId)}&player=${encodeURIComponent(playerId)}`;
        if (plainSecret) {
            playerUrl += `&secret=${encodeURIComponent(plainSecret)}`;
        }

        html += `
            <div class="link-row">
                <span class="team-dot" style="background: ${info.teamColor}"></span>
                <span class="player-label">${info.name}</span>
                <input type="text" class="link-input" value="${playerUrl}" readonly id="link-${playerId}">
                <button class="btn secondary copy-btn" onclick="copyLink('${playerId}')">Copy</button>
            </div>
        `;
    }

    container.innerHTML = html;
}

// =============================================================================
// ADMIN EDIT MODAL
// =============================================================================

function openEditModal(playerId) {
    editingPlayerId = playerId;
    const playerMapping = getPlayerMapping();
    const info = playerMapping[playerId];

    // Update modal title
    document.getElementById('editModalTitle').textContent = `Edit: ${info.name}`;

    // Render checklists
    renderFriendsChecklist(playerMapping, playerId, 'editFriendsChecklist');
    renderGamesChecklist(playerId, 'editGamesChecklist');

    // Show modal
    document.getElementById('editPlayerModal').classList.remove('hidden');
}

function closeEditModal() {
    editingPlayerId = null;
    document.getElementById('editPlayerModal').classList.add('hidden');
}

// Edit mode toggle functions
function toggleFriendStatusEdit(otherPlayerId) {
    if (editingPlayerId) {
        toggleFriendStatus(otherPlayerId, editingPlayerId);
    }
}

function toggleGameStatusEdit(gameId) {
    if (editingPlayerId) {
        toggleGameStatus(gameId, editingPlayerId);
    }
}

// Close modals on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (editingPlayerId) {
            closeEditModal();
        }
        if (!document.getElementById('secretModal').classList.contains('hidden')) {
            closeSecretModal();
        }
    }
});

// =============================================================================
// LINK COPY FUNCTIONS
// =============================================================================

function copyLink(playerId) {
    const input = document.getElementById(`link-${playerId}`);
    input.select();
    document.execCommand('copy');

    // Visual feedback
    const btn = input.nextElementSibling;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
        btn.textContent = originalText;
    }, 1500);
}

function copyAllLinks() {
    const playerMapping = getPlayerMapping();
    const baseUrl = window.location.origin + window.location.pathname;
    const hasSecretHash = !!onboardingState?.secretHash;
    const plainSecret = onboardingState?._plainSecret || onboardingState?.secret || '';

    // Warn if secret is set but not available
    if (hasSecretHash && !plainSecret) {
        showToast('Secret is set but not available. Click "Set Secret" and enter the secret phrase first.', 'warning', 5000);
        return;
    }

    const allIds = getAllPlayerIds();
    let allLinks = '';
    for (const playerId of allIds) {
        const info = playerMapping[playerId];
        if (!info) continue;
        let playerUrl = `${baseUrl}?tournamentId=${encodeURIComponent(tournamentId)}&player=${encodeURIComponent(playerId)}`;
        if (plainSecret) {
            playerUrl += `&secret=${encodeURIComponent(plainSecret)}`;
        }
        allLinks += `${info.name}: ${playerUrl}\n`;
    }

    navigator.clipboard.writeText(allLinks).then(() => {
        // Visual feedback
        const btn = document.querySelector('.header-actions .btn:last-child');
        const originalText = btn.textContent;
        btn.textContent = 'Copied All!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// =============================================================================
// PLAYER STATUS EMOJIS
// =============================================================================

const STATUS_EMOJIS = {
    eating: '🍔',
    smoking: '🚬',
    wc: '🚽',
    sleeping: '😴',
    alert: '❗',
    question: '❓'
};

function renderStatusButtons(playerId) {
    const playerData = onboardingState?.players?.[playerId] || {};
    const activeStatuses = playerData.statuses || {};

    document.querySelectorAll('#statusEmojis .status-btn').forEach(btn => {
        const status = btn.dataset.status;
        btn.classList.toggle('active', !!activeStatuses[status]);
    });
}

async function togglePlayerStatus(statusKey) {
    const playerData = onboardingState.players[currentPlayerId];
    if (!playerData) return;

    if (!playerData.statuses) playerData.statuses = {};
    const wasActive = playerData.statuses[statusKey] || false;

    // Exclusive: clear all statuses, then set the new one (unless toggling off)
    const updates = {};
    for (const key of Object.keys(STATUS_EMOJIS)) {
        playerData.statuses[key] = false;
        updates[`statuses.${key}`] = false;
    }
    if (!wasActive) {
        playerData.statuses[statusKey] = true;
        updates[`statuses.${statusKey}`] = true;
    }

    // Update buttons immediately
    document.querySelectorAll('#statusEmojis .status-btn').forEach(btn => {
        btn.classList.toggle('active', !!playerData.statuses[btn.dataset.status]);
    });

    await savePlayerField(currentPlayerId, updates);
}

function openStatusPopup() {
    const baseUrl = window.location.pathname.replace('onboarding.html', 'onboarding-status.html');
    let popupUrl = `${baseUrl}?tournamentId=${encodeURIComponent(tournamentId)}&player=${encodeURIComponent(currentPlayerId)}`;
    if (urlSecret) popupUrl += `&secret=${encodeURIComponent(urlSecret)}`;
    window.open(popupUrl, 'statusPopup',
        'width=240,height=200,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no');
}

function getPlayerStatusIcons(playerId) {
    const playerData = onboardingState?.players?.[playerId] || {};
    const statuses = playerData.statuses || {};
    let icons = '';
    for (const [key, emoji] of Object.entries(STATUS_EMOJIS)) {
        if (statuses[key]) icons += emoji;
    }
    return icons;
}

// =============================================================================
// PLATFORM ID MANAGEMENT
// =============================================================================

async function savePlatformId(platformKey, value) {
    const trimmedValue = value.trim();

    // Update local state
    const playerData = onboardingState.players[currentPlayerId];
    if (!playerData.platformIds) {
        playerData.platformIds = {};
    }
    playerData.platformIds[platformKey] = trimmedValue;
    playerData.lastUpdated = new Date().toISOString();

    // Save to Firebase (subcollection)
    try {
        const onboardingRef = getOnboardingRef();
        await onboardingRef.update({
            [`players.${currentPlayerId}.platformIds.${platformKey}`]: trimmedValue,
            [`players.${currentPlayerId}.lastUpdated`]: playerData.lastUpdated
        });

        // Visual feedback - update the row styling
        const row = document.getElementById(`platform-${platformKey}`)?.closest('.platform-id-row');
        if (row) {
            row.classList.toggle('has-value', trimmedValue.length > 0);
        }

        await saveProfilePlatformId(platformKey, trimmedValue);
    } catch (error) {
        console.error('Failed to save platform ID:', error);
        showToast('Failed to save. Please try again.', 'error');
    }
}

async function saveAllPlatformIds() {
    const activePlatforms = PLATFORMS_CONFIG.getActivePlatforms();
    const playerData = onboardingState.players[currentPlayerId];
    if (!playerData.platformIds) playerData.platformIds = {};

    const updates = {};
    for (const platform of activePlatforms) {
        const input = document.getElementById(`platform-${platform.id}`);
        if (!input) continue;
        const val = input.value.trim();
        playerData.platformIds[platform.id] = val;
        updates[`players.${currentPlayerId}.platformIds.${platform.id}`] = val;
    }

    playerData.lastUpdated = new Date().toISOString();
    updates[`players.${currentPlayerId}.lastUpdated`] = playerData.lastUpdated;

    try {
        await getOnboardingRef().update(updates);
        // Update row styling
        for (const platform of activePlatforms) {
            const row = document.getElementById(`platform-${platform.id}`)?.closest('.platform-id-row');
            if (row) row.classList.toggle('has-value', !!playerData.platformIds[platform.id]);
        }

        if (isAuthedOwner(currentPlayerId)) {
            await Promise.all(activePlatforms.map(p => saveProfilePlatformId(p.id, playerData.platformIds[p.id])));
        }

        showToast('All platform IDs saved!', 'success');
    } catch (error) {
        console.error('Failed to save platform IDs:', error);
        showToast('Failed to save. Please try again.', 'error');
    }
}

function copyPlatformId(element, value) {
    navigator.clipboard.writeText(value).then(() => {
        // Visual feedback
        element.classList.add('copied');
        const originalHtml = element.innerHTML;
        const isButton = element.classList.contains('platform-action-btn');
        element.innerHTML = isButton ? '✓' : '<span class="platform-label">✓</span> Copied!';
        setTimeout(() => {
            element.innerHTML = originalHtml;
            element.classList.remove('copied');
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// =============================================================================
// SECRET MANAGEMENT (Admin only)
// =============================================================================

/**
 * Hash a string using SHA-256
 * Returns a hex string
 */
async function hashSecret(secret) {
    if (!secret) return '';
    const encoder = new TextEncoder();
    const data = encoder.encode(secret);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function openSecretModal() {
    // Don't show the hash - show placeholder if secret is set
    const hasSecretHash = !!onboardingState?.secretHash;
    const hasPlainSecret = !!onboardingState?._plainSecret;

    document.getElementById('secretInput').value = '';
    document.getElementById('secretInput').placeholder = hasSecretHash ? 'Enter secret to verify or set new' : 'e.g. tournament2025';

    // Show verify button only if hash exists but plain secret not available
    const verifyBtn = document.getElementById('verifySecretBtn');
    if (verifyBtn) {
        verifyBtn.style.display = (hasSecretHash && !hasPlainSecret) ? 'inline-flex' : 'none';
    }

    if (hasSecretHash && hasPlainSecret) {
        document.getElementById('currentSecretDisplay').textContent = 'Secret active (links ready)';
    } else if (hasSecretHash) {
        document.getElementById('currentSecretDisplay').textContent = 'Secret set (enter to enable links)';
    } else {
        document.getElementById('currentSecretDisplay').textContent = 'Not set';
    }

    document.getElementById('secretModal').classList.remove('hidden');
}

function closeSecretModal() {
    document.getElementById('secretModal').classList.add('hidden');
}

async function verifySecret() {
    const enteredSecret = document.getElementById('secretInput').value.trim();
    if (!enteredSecret) {
        showToast('Please enter the secret phrase.', 'warning');
        return;
    }

    const storedHash = onboardingState?.secretHash || '';
    const enteredHash = await hashSecret(enteredSecret);

    if (enteredHash === storedHash) {
        // Secret matches - store in memory for link generation
        onboardingState._plainSecret = enteredSecret;
        closeSecretModal();
        renderAdminView();
        showToast('Secret verified! Links are now ready to copy.', 'success');
    } else {
        showToast('Secret does not match. Please check and try again.', 'error');
    }
}

async function saveSecret() {
    const newSecret = document.getElementById('secretInput').value.trim();

    // Update local state
    const secretHash = await hashSecret(newSecret);
    onboardingState.secretHash = secretHash;
    // Store the plain secret temporarily for link generation (only in memory, not in Firebase)
    onboardingState._plainSecret = newSecret;
    // Remove old plain text secret if it exists
    delete onboardingState.secret;

    // Save to Firebase subcollection (hash + plain text for admin reference)
    try {
        const onboardingRef = getOnboardingRef();
        await onboardingRef.update({
            'secretHash': secretHash,
            'secret': newSecret || null
        });

        closeSecretModal();

        // Re-render links with new secret
        renderAdminView();

        if (newSecret) {
            showToast('Secret saved!', 'success');
        }
    } catch (error) {
        console.error('Failed to save secret:', error);
        showToast('Failed to save secret. Please try again.', 'error');
    }
}

// =============================================================================
// UI HELPERS
// =============================================================================

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
}

function showError(message) {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');

    const errorContainer = document.getElementById('errorContainer');
    const errorText = document.getElementById('errorText');
    errorText.textContent = message;
    errorContainer.style.display = 'flex';
}

// =============================================================================
// EXPOSE FUNCTIONS GLOBALLY
// =============================================================================

window.toggleFriendStatus = toggleFriendStatus;
window.toggleGameStatus = toggleGameStatus;
window.toggleFriendStatusEdit = toggleFriendStatusEdit;
window.toggleGameStatusEdit = toggleGameStatusEdit;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.copyLink = copyLink;
window.copyAllLinks = copyAllLinks;
window.openSecretModal = openSecretModal;
window.closeSecretModal = closeSecretModal;
window.saveSecret = saveSecret;
window.verifySecret = verifySecret;
window.savePlatformId = savePlatformId;
window.saveAllPlatformIds = saveAllPlatformIds;
window.copyPlatformId = copyPlatformId;
window.togglePlayerStatus = togglePlayerStatus;
window.openStatusPopup = openStatusPopup;
