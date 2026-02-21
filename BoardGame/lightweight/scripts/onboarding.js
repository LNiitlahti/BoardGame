/**
 * ============================================================================
 * ONBOARDING-LIGHTWEIGHT.JS - Tournament Player Readiness System
 * ============================================================================
 *
 * Handles both player and admin views for tournament onboarding checklist.
 * Players confirm they've added friends and tested games.
 * Admins see overall progress and can edit player status.
 */

// =============================================================================
// GLOBAL STATE
// =============================================================================

let gameState = null;
let onboardingState = null;  // Separate state from subcollection
let tournamentId = null;
let currentPlayerNumber = null;
let isAdminView = false;
let editingPlayerNumber = null;
let unsubscribe = null;
let onboardingUnsubscribe = null;
let urlSecret = null;
let secretValidated = false;
let onboardingReady = false;

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
    currentPlayerNumber = playerParam ? parseInt(playerParam, 10) : null;

    // Validate parameters
    if (!tournamentId) {
        showError('No tournament ID specified. Use ?tournamentId=xxx');
        return;
    }

    if (!isAdminView && (!currentPlayerNumber || currentPlayerNumber < 1 || currentPlayerNumber > 10)) {
        showError('Invalid player number. Use ?player=1 through ?player=10');
        return;
    }
});

document.addEventListener('firebase-ready', function() {
    if (!tournamentId) return;

    // Set up real-time listener
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

    // Validate secret before rendering (player view only)
    if (!secretValidated) {
        await validateSecretAccess();
        return; // validateSecretAccess calls renderCurrentView again on success
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

async function validateSecretAccess() {
    const storedHash = onboardingState?.secretHash || '';
    const legacySecret = onboardingState?.secret || '';

    // Admin view doesn't need secret validation
    if (!isAdminView && (storedHash || legacySecret)) {
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
// ONBOARDING DATA MANAGEMENT
// =============================================================================

function createDefaultOnboardingData() {
    const data = { players: {} };
    for (let i = 1; i <= 10; i++) {
        data.players[String(i)] = {
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

function getOnboardingRef() {
    const db = window.firebaseDB;
    return db.collection('tournaments').doc(tournamentId)
        .collection('onboarding').doc('state');
}

function getPlayerMapping() {
    // Map player numbers 1-10 to player info
    // Player 1-2 = Team 1, Player 3-4 = Team 2, etc.
    const mapping = {};
    const teams = gameState?.teams || [];
    let playerNum = 1;

    for (const team of teams) {
        const players = team.players || [];
        for (const player of players) {
            if (playerNum <= 10) {
                mapping[playerNum] = {
                    id: player.id || `player_${playerNum}`,
                    name: player.name || `Player ${playerNum}`,
                    teamId: team.id,
                    teamName: team.name || `Team ${team.id}`,
                    teamColor: team.color || '#666666'
                };
                playerNum++;
            }
        }
    }

    // Fill remaining slots if not enough players defined
    while (playerNum <= 10) {
        const teamIndex = Math.floor((playerNum - 1) / 2);
        const team = teams[teamIndex] || {};
        mapping[playerNum] = {
            id: `player_${playerNum}`,
            name: `Player ${playerNum}`,
            teamId: team.id || teamIndex + 1,
            teamName: team.name || `Team ${teamIndex + 1}`,
            teamColor: team.color || '#666666'
        };
        playerNum++;
    }

    return mapping;
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

async function toggleFriendStatus(otherPlayerNum, playerNum = currentPlayerNumber) {
    const playerData = onboardingState.players[String(playerNum)];
    if (!playerData) return;

    const currentStatus = playerData.friendsAdded[String(otherPlayerNum)] || false;
    playerData.friendsAdded[String(otherPlayerNum)] = !currentStatus;
    playerData.lastUpdated = new Date().toISOString();

    // Check completion
    checkPlayerCompletion(playerNum);

    await savePlayerField(playerNum, {
        [`friendsAdded.${otherPlayerNum}`]: !currentStatus,
        completedAt: playerData.completedAt || null
    });
}

async function toggleGameStatus(gameId, playerNum = currentPlayerNumber) {
    const playerData = onboardingState.players[String(playerNum)];
    if (!playerData) return;

    const currentStatus = playerData.gamesTested[gameId] || false;
    playerData.gamesTested[gameId] = !currentStatus;
    playerData.lastUpdated = new Date().toISOString();

    // Check completion
    checkPlayerCompletion(playerNum);

    await savePlayerField(playerNum, {
        [`gamesTested.${gameId}`]: !currentStatus,
        completedAt: playerData.completedAt || null
    });
}

function checkPlayerCompletion(playerNum) {
    const playerData = onboardingState.players[String(playerNum)];
    if (!playerData) return;

    const games = getSelectedGames();
    const totalFriends = 9; // All other players
    const totalGames = games.length;

    // Count completed
    let friendsComplete = 0;
    for (let i = 1; i <= 10; i++) {
        if (i !== playerNum && playerData.friendsAdded[String(i)]) {
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

async function savePlayerField(playerNum, fields) {
    try {
        const onboardingRef = getOnboardingRef();
        const update = {};
        for (const [key, value] of Object.entries(fields)) {
            update[`players.${playerNum}.${key}`] = value;
        }
        update[`players.${playerNum}.lastUpdated`] = new Date().toISOString();
        await onboardingRef.update(update);
    } catch (error) {
        console.error('Failed to save onboarding status:', error);
    }
}

// =============================================================================
// PLAYER VIEW RENDERING
// =============================================================================

function renderPlayerView() {
    const playerMapping = getPlayerMapping();
    const currentPlayer = playerMapping[currentPlayerNumber];

    // Update header
    document.getElementById('tournamentName').textContent = gameState.name || 'Tournament';
    document.getElementById('playerInfo').textContent = `Welcome, ${currentPlayer.name}`;

    // Render platform IDs form
    renderPlatformIdsForm(currentPlayerNumber);

    // Render checklists
    renderFriendsChecklist(playerMapping, currentPlayerNumber, 'friendsChecklist');
    renderGamesChecklist(currentPlayerNumber, 'gamesChecklist');

    // Update progress
    updateProgress(currentPlayerNumber);
}

function renderPlatformIdsForm(forPlayerNum) {
    const container = document.getElementById('platformIdsForm');
    if (!container) return;

    const playerData = onboardingState?.players?.[String(forPlayerNum)] || {};
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
                    <button class="btn secondary" onclick="savePlatformId('${platform.id}', document.getElementById('platform-${platform.id}').value)">Save</button>
                </div>
                <div class="platform-help">
                    ${platform.help}
                    ${platform.helpUrl ? ` <a href="${platform.helpUrl}" target="_blank">Open →</a>` : ''}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderFriendsChecklist(playerMapping, forPlayerNum, containerId) {
    const container = document.getElementById(containerId);
    const playerData = onboardingState?.players?.[String(forPlayerNum)] || {};
    const friendsAdded = playerData.friendsAdded || {};
    const isEditMode = containerId.includes('edit');

    let html = '';
    for (let i = 1; i <= 10; i++) {
        if (i === forPlayerNum) continue; // Skip self

        const info = playerMapping[i];
        const isChecked = friendsAdded[String(i)] || false;
        const friendData = onboardingState?.players?.[String(i)] || {};
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
                const profileUrl = platform.getProfileUrl ? platform.getProfileUrl(platformId) : null;
                platformIdsHtml += `
                    <span class="friend-platform-id-group">
                        <span class="friend-platform-id" onclick="copyPlatformId(this, '${escapedId}')" title="Click to copy">
                            <span class="platform-label">${platform.icon}</span>
                            ${platformId}
                        </span>
                        <span class="friend-platform-actions">
                            <button class="platform-action-btn copy-btn" onclick="copyPlatformId(this, '${escapedId}')" title="Copy ${platform.name} ID">📋</button>
                            ${profileUrl ? `<a class="platform-action-btn link-btn" href="${profileUrl}" target="_blank" title="Open ${platform.name} profile">🔗</a>` : ''}
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
                           onchange="${isEditMode ? `toggleFriendStatusEdit(${i})` : `toggleFriendStatus(${i})`}">
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
    'cs2':         { text: 'You shoot.' },
    'cod':         { text: 'You also shoot, but from the left.' }
};

function renderGamesChecklist(forPlayerNum, containerId) {
    const container = document.getElementById(containerId);
    const games = getSelectedGames();
    const playerData = onboardingState?.players?.[String(forPlayerNum)] || {};
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

function updateProgress(playerNum) {
    const playerData = onboardingState?.players?.[String(playerNum)] || {};
    const games = getSelectedGames();

    const totalTasks = 9 + games.length; // 9 friends + games
    let completed = 0;

    // Count friends
    for (let i = 1; i <= 10; i++) {
        if (i !== playerNum && playerData.friendsAdded?.[String(i)]) {
            completed++;
        }
    }

    // Count games
    for (const game of games) {
        if (playerData.gamesTested?.[game.id]) {
            completed++;
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

    let html = '';
    for (let i = 1; i <= 10; i++) {
        const info = playerMapping[i];
        const playerData = onboardingState?.players?.[String(i)] || {};

        // Calculate progress
        let friendsComplete = 0;
        for (let j = 1; j <= 10; j++) {
            if (j !== i && playerData.friendsAdded?.[String(j)]) {
                friendsComplete++;
            }
        }

        let gamesComplete = 0;
        for (const game of games) {
            if (playerData.gamesTested?.[game.id]) {
                gamesComplete++;
            }
        }

        const totalTasks = 9 + games.length;
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
                <div class="progress-stats">
                    <div>Friends: ${friendsComplete}/9</div>
                    <div>Games: ${gamesComplete}/${games.length}</div>
                </div>
                <div class="status-badge ${statusClass}">${statusText}</div>
                <button class="btn secondary edit-btn" onclick="openEditModal(${i})">Edit</button>
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

    let html = '';

    // Warning if secret is set but we don't have the plain text
    if (hasSecretHash && !plainSecret) {
        html += `
            <div class="status-message warning" style="margin-bottom: var(--spacing-md);">
                Secret is set but not available. Click "Set Secret" and enter the secret phrase to generate working links.
            </div>
        `;
    }

    for (let i = 1; i <= 10; i++) {
        const info = playerMapping[i];
        let playerUrl = `${baseUrl}?tournamentId=${tournamentId}&player=${i}`;
        if (plainSecret) {
            playerUrl += `&secret=${encodeURIComponent(plainSecret)}`;
        }

        html += `
            <div class="link-row">
                <span class="team-dot" style="background: ${info.teamColor}"></span>
                <span class="player-label">${info.name}</span>
                <input type="text" class="link-input" value="${playerUrl}" readonly id="link-${i}">
                <button class="btn secondary copy-btn" onclick="copyLink(${i})">Copy</button>
            </div>
        `;
    }

    container.innerHTML = html;
}

// =============================================================================
// ADMIN EDIT MODAL
// =============================================================================

function openEditModal(playerNum) {
    editingPlayerNumber = playerNum;
    const playerMapping = getPlayerMapping();
    const info = playerMapping[playerNum];

    // Update modal title
    document.getElementById('editModalTitle').textContent = `Edit: ${info.name}`;

    // Render checklists
    renderFriendsChecklist(playerMapping, playerNum, 'editFriendsChecklist');
    renderGamesChecklist(playerNum, 'editGamesChecklist');

    // Show modal
    document.getElementById('editPlayerModal').classList.remove('hidden');
}

function closeEditModal() {
    editingPlayerNumber = null;
    document.getElementById('editPlayerModal').classList.add('hidden');
}

// Edit mode toggle functions
function toggleFriendStatusEdit(otherPlayerNum) {
    if (editingPlayerNumber) {
        toggleFriendStatus(otherPlayerNum, editingPlayerNumber);
    }
}

function toggleGameStatusEdit(gameId) {
    if (editingPlayerNumber) {
        toggleGameStatus(gameId, editingPlayerNumber);
    }
}

// Close modals on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (editingPlayerNumber) {
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

function copyLink(playerNum) {
    const input = document.getElementById(`link-${playerNum}`);
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

    let allLinks = '';
    for (let i = 1; i <= 10; i++) {
        const info = playerMapping[i];
        let playerUrl = `${baseUrl}?tournamentId=${tournamentId}&player=${i}`;
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
// PLATFORM ID MANAGEMENT
// =============================================================================

async function savePlatformId(platformKey, value) {
    const trimmedValue = value.trim();

    // Update local state
    const playerData = onboardingState.players[String(currentPlayerNumber)];
    if (!playerData.platformIds) {
        playerData.platformIds = {};
    }
    playerData.platformIds[platformKey] = trimmedValue;
    playerData.lastUpdated = new Date().toISOString();

    // Save to Firebase (subcollection)
    try {
        const onboardingRef = getOnboardingRef();
        await onboardingRef.update({
            [`players.${currentPlayerNumber}.platformIds.${platformKey}`]: trimmedValue,
            [`players.${currentPlayerNumber}.lastUpdated`]: playerData.lastUpdated
        });

        // Visual feedback - update the row styling
        const row = document.getElementById(`platform-${platformKey}`)?.closest('.platform-id-row');
        if (row) {
            row.classList.toggle('has-value', trimmedValue.length > 0);
        }
    } catch (error) {
        console.error('Failed to save platform ID:', error);
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

    // Save to Firebase subcollection (only the hash)
    try {
        const onboardingRef = getOnboardingRef();
        await onboardingRef.update({
            'secretHash': secretHash,
            'secret': null // Remove old plain text field
        });

        closeSecretModal();

        // Re-render links with new secret
        renderAdminView();

        // Show the secret once so admin can copy it
        if (newSecret) {
            showToast(`Secret saved! Your phrase: ${newSecret} — This is the ONLY time you'll see it.`, 'success', 0);
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
window.copyPlatformId = copyPlatformId;
