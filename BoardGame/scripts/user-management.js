/**
 * User Management Module for God Mode
 * Handles CRUD operations for Firebase Authentication users
 */

// Global variables
let allUsers = [];
let filteredUsers = [];

/**
 * Load all users from Firestore
 */
async function loadAllUsers() {
    try {
        const db = firebase.firestore();

        // Fetch all user documents from Firestore
        const usersSnapshot = await db.collection('users').get();

        allUsers = [];
        usersSnapshot.forEach(doc => {
            allUsers.push({
                uid: doc.id,
                ...doc.data()
            });
        });

        console.log('[User Management] Loaded', allUsers.length, 'users');

        // Update statistics
        updateUserStats();

        // Initial display
        filterUsers();

    } catch (error) {
        console.error('[User Management] Error loading users:', error);
        const tbody = document.getElementById('usersTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: #ef4444; padding: 40px;">
                        Error loading users: ${error.message}
                    </td>
                </tr>
            `;
        }
    }
}

/**
 * Update user statistics
 */
function updateUserStats() {
    const stats = {
        total: allUsers.length,
        god: 0,
        admin: 0,
        player: 0,
        user: 0
    };

    allUsers.forEach(user => {
        const role = getUserRole(user);
        if (stats.hasOwnProperty(role)) {
            stats[role]++;
        }
    });

    document.getElementById('totalUsersCount').textContent = stats.total;
    document.getElementById('godCount').textContent = stats.god;
    document.getElementById('adminCount').textContent = stats.admin;
    document.getElementById('playerCount').textContent = stats.player;
}

/**
 * Determine user role from user data
 * Hierarchy: god > admin > player > user
 */
function getUserRole(user) {
    if (user.isGod === true) return 'god';
    if (user.isAdmin === true) return 'admin';
    if (user.isPlayer === true) return 'player';
    return 'user';
}

/**
 * Filter and display users
 */
function filterUsers() {
    const searchTerm = document.getElementById('userSearch').value.toLowerCase();
    const roleFilter = document.getElementById('roleFilter').value;

    filteredUsers = allUsers.filter(user => {
        // Search filter
        const matchesSearch = !searchTerm ||
            (user.displayName && user.displayName.toLowerCase().includes(searchTerm)) ||
            (user.email && user.email.toLowerCase().includes(searchTerm)) ||
            (user.uid && user.uid.toLowerCase().includes(searchTerm));

        // Role filter
        const userRole = getUserRole(user);
        const matchesRole = roleFilter === 'all' || userRole === roleFilter;

        return matchesSearch && matchesRole;
    });

    displayUsers();
}

/**
 * Display users in the UI (Table Layout)
 */
function displayUsers() {
    const tbody = document.getElementById('usersTableBody');

    if (filteredUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; opacity: 0.7;">
                    No users found matching your criteria
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredUsers.map(user => {
        const role = getUserRole(user);
        const isEnabled = user.disabled !== true;
        const statusClass = isEnabled ? 'enabled' : 'disabled';
        const statusText = isEnabled ? 'Active' : 'Disabled';
        const createdDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown';
        const lastLoginDate = user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never';

        return `
            <tr>
                <td><strong>${user.displayName || 'Unknown'}</strong></td>
                <td>${user.email || 'No email'}</td>
                <td><span class="user-role-badge ${role}">${role.toUpperCase()}</span></td>
                <td><span class="user-status-badge ${statusClass}">${statusText}</span></td>
                <td>${createdDate}</td>
                <td>${lastLoginDate}</td>
                <td>
                    <button class="btn-small btn-edit" onclick="editUser('${user.uid}')">✏️ Edit</button>
                    <button class="btn-small btn-toggle" onclick="toggleUserStatus('${user.uid}', ${!isEnabled})">
                        ${isEnabled ? '🚫 Disable' : '✅ Enable'}
                    </button>
                    <button class="btn-small btn-delete" onclick="deleteUser('${user.uid}', '${escapeHtml(user.displayName || user.email)}')">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show create user modal
 */
function showCreateUserModal() {
    document.getElementById('userModalTitle').textContent = '➕ Create User';
    document.getElementById('userFormUid').value = '';
    document.getElementById('userFormEmail').value = '';
    document.getElementById('userFormEmail').disabled = false;
    document.getElementById('userFormDisplayName').value = '';
    document.getElementById('userFormPassword').value = '';
    document.getElementById('userFormRole').value = 'user';
    document.getElementById('userFormEnabled').checked = true;

    // Show password field for new users
    document.getElementById('passwordGroup').style.display = 'block';
    document.getElementById('userFormPassword').required = true;

    document.getElementById('userManagementModal').style.display = 'flex';
}

/**
 * Edit existing user
 */
function editUser(uid) {
    const user = allUsers.find(u => u.uid === uid);
    if (!user) {
        alert('User not found');
        return;
    }

    document.getElementById('userModalTitle').textContent = '✏️ Edit User';
    document.getElementById('userFormUid').value = uid;
    document.getElementById('userFormEmail').value = user.email || '';
    document.getElementById('userFormEmail').disabled = true; // Cannot change email in Firestore (read-only)
    document.getElementById('userFormDisplayName').value = user.displayName || '';

    // Set role
    const role = getUserRole(user);
    document.getElementById('userFormRole').value = role;

    document.getElementById('userFormEnabled').checked = user.disabled !== true;

    // Hide password field for existing users
    document.getElementById('passwordGroup').style.display = 'none';
    document.getElementById('userFormPassword').required = false;

    document.getElementById('userManagementModal').style.display = 'flex';
}

/**
 * Close user modal
 */
function closeUserModal() {
    document.getElementById('userManagementModal').style.display = 'none';
    document.getElementById('userForm').reset();
}

/**
 * Save user (create or update)
 */
async function saveUser(event) {
    event.preventDefault();

    const uid = document.getElementById('userFormUid').value;
    const email = document.getElementById('userFormEmail').value;
    const displayName = document.getElementById('userFormDisplayName').value;
    const password = document.getElementById('userFormPassword').value;
    const role = document.getElementById('userFormRole').value;
    const enabled = document.getElementById('userFormEnabled').checked;

    try {
        const db = firebase.firestore();

        if (uid) {
            // UPDATE existing user
            const userRef = db.collection('users').doc(uid);

            // Hierarchical role system: god > admin > player > user
            const updateData = {
                displayName: displayName,
                disabled: !enabled,
                isGod: role === 'god',
                isAdmin: role === 'admin' || role === 'god', // Gods are also admins
                isPlayer: role === 'player' || role === 'admin' || role === 'god', // Higher roles include player permissions
                updatedAt: new Date().toISOString()
            };

            await userRef.update(updateData);

            console.log('[User Management] Updated user:', uid);
            alert(`User "${displayName}" updated successfully!`);

        } else {
            // CREATE new user
            // Note: Creating Firebase Auth users requires Firebase Admin SDK on the server
            // This is a CLIENT-SIDE workaround that creates the Firestore document only
            // For production, you should use Firebase Functions with Admin SDK

            alert('⚠️ WARNING: Creating new Firebase Authentication users requires server-side implementation.\n\nThis will only create the Firestore user document.\n\nTo create a full Firebase Auth user, implement a Firebase Cloud Function with Admin SDK.');

            // Generate a pseudo-UID for demonstration (in production, use Auth UID)
            const newUid = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Hierarchical role system: god > admin > player > user
            const newUserData = {
                email: email,
                displayName: displayName,
                disabled: !enabled,
                isGod: role === 'god',
                isAdmin: role === 'admin' || role === 'god', // Gods are also admins
                isPlayer: role === 'player' || role === 'admin' || role === 'god', // Higher roles include player permissions
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await db.collection('users').doc(newUid).set(newUserData);

            console.log('[User Management] Created user document:', newUid);
            alert(`User document created!\n\nUID: ${newUid}\n\nNOTE: This user needs to be created in Firebase Auth separately.`);
        }

        // Close modal and reload users
        closeUserModal();
        await loadAllUsers();

    } catch (error) {
        console.error('[User Management] Error saving user:', error);
        alert(`Error saving user: ${error.message}`);
    }
}

/**
 * Toggle user enabled/disabled status
 */
async function toggleUserStatus(uid, enable) {
    const user = allUsers.find(u => u.uid === uid);
    if (!user) {
        alert('User not found');
        return;
    }

    const action = enable ? 'enable' : 'disable';
    const confirmMessage = `Are you sure you want to ${action} this user?\n\nName: ${user.displayName}\nEmail: ${user.email}`;

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        const db = firebase.firestore();
        await db.collection('users').doc(uid).update({
            disabled: !enable,
            updatedAt: new Date().toISOString()
        });

        console.log('[User Management]', action, 'user:', uid);
        alert(`User ${enable ? 'enabled' : 'disabled'} successfully!`);

        await loadAllUsers();

    } catch (error) {
        console.error('[User Management] Error toggling user status:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Delete user
 */
async function deleteUser(uid, displayName) {
    const confirmMessage = `⚠️ WARNING: You are about to DELETE this user!\n\nName: ${displayName}\nUID: ${uid}\n\nThis will:\n- Delete the Firestore user document\n- NOT delete the Firebase Auth user (requires Admin SDK)\n\nType the user's name to confirm deletion:`;

    const userInput = prompt(confirmMessage);

    if (userInput === null) {
        return; // User cancelled
    }

    if (userInput !== displayName) {
        alert('Name does not match. Deletion cancelled.');
        return;
    }

    // Final confirmation
    if (!confirm(`FINAL CONFIRMATION:\n\nDelete user "${displayName}"?\n\nClick OK to DELETE.`)) {
        return;
    }

    try {
        const db = firebase.firestore();
        await db.collection('users').doc(uid).delete();

        console.log('[User Management] Deleted user:', uid);
        alert(`User "${displayName}" has been deleted from Firestore.\n\nNOTE: The Firebase Auth user still exists and should be deleted separately.`);

        await loadAllUsers();

    } catch (error) {
        console.error('[User Management] Error deleting user:', error);
        alert(`Error deleting user: ${error.message}`);
    }
}

// =============================================================================
// USER APPOINTMENT SYSTEM
// =============================================================================
// Handles assigning registered users to tournament teams

/**
 * Global state for user appointments
 */
let unassignedUsers = [];
let pendingAppointments = {}; // { teamId: { playerIndex: userData } }

/**
 * Load all users without tournament assignments
 * Shows users who are not assigned OR assigned to different tournaments
 */
async function loadUnassignedUsers() {
    // Access gameState from god-scripts.js
    if (!window.gameState || !window.gameState.gameId) {
        if (typeof showStatus === 'function') {
            showStatus('Load a tournament first', 'error');
        }
        return;
    }

    try {
        console.log('[User Appointment] Loading users for tournament:', window.gameState.gameId);
        const usersSnapshot = await window.firebaseDB.collection('users').get();
        unassignedUsers = [];

        console.log('[User Appointment] Total users in database:', usersSnapshot.size);

        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            const uid = doc.id;

            console.log('[User Appointment] Checking user:', uid, {
                email: userData.email,
                displayName: userData.displayName,
                assignedGameId: userData.assignedGameId,
                isPlayer: userData.isPlayer
            });

            // Include users who:
            // 1. Have no assignedGameId
            // 2. Are assigned to a different tournament
            // 3. Are not god or admin (filter out system users)
            const isSystemUser = userData.isGod === true || userData.isAdmin === true;

            if (!isSystemUser && (!userData.assignedGameId || userData.assignedGameId !== window.gameState.gameId)) {
                unassignedUsers.push({
                    uid,
                    displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown User',
                    email: userData.email || 'No email',
                    currentAssignment: userData.assignedGameId ? {
                        gameId: userData.assignedGameId,
                        teamId: userData.assignedTeamId,
                        teamName: userData.assignedTeamName
                    } : null
                });
            }
        });

        console.log('[User Appointment] Unassigned users:', unassignedUsers);
        renderUnassignedUsers();

        if (typeof showStatus === 'function') {
            showStatus(`Found ${unassignedUsers.length} unassigned users`, 'success');
        }
        if (typeof addLog === 'function') {
            addLog(`📋 Found ${unassignedUsers.length} unassigned users`, 'info');
        }

    } catch (error) {
        console.error('[User Appointment] Error loading users:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error loading users', 'error');
        }
    }
}

/**
 * Render the list of unassigned users with drag-and-drop
 * Filters out users who are already in pending appointments
 */
function renderUnassignedUsers() {
    const container = document.getElementById('unassignedUsersList');
    if (!container) return;

    // Get list of assigned user UIDs
    const assignedUIDs = new Set();
    for (const teamId in pendingAppointments) {
        for (const playerIndex in pendingAppointments[teamId]) {
            assignedUIDs.add(pendingAppointments[teamId][playerIndex].uid);
        }
    }

    // Filter out users who are already assigned
    const availableUsers = unassignedUsers.filter(user => !assignedUIDs.has(user.uid));

    if (availableUsers.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">No unassigned users available</p>';
        return;
    }

    container.innerHTML = availableUsers.map(user => {
        const assignmentNote = user.currentAssignment
            ? `<div style="font-size: 0.75rem; opacity: 0.7; margin-top: 4px;">Currently: ${user.currentAssignment.teamName} (${user.currentAssignment.gameId})</div>`
            : '';

        return `
            <div class="user-drag-item"
                 draggable="true"
                 ondragstart="handleUserDragStart(event, '${user.uid}')"
                 ondragend="dragEnd(event)"
                 style="background: rgba(51, 65, 85, 0.5); padding: 10px; margin-bottom: 8px; border-radius: 5px; border-left: 3px solid #06b6d4; cursor: move;">
                <div style="font-weight: 600;">${user.displayName}</div>
                <div style="font-size: 0.85rem; opacity: 0.8;">${user.email}</div>
                ${assignmentNote}
            </div>
        `;
    }).join('');
}

/**
 * Handle drag start for user items
 */
function handleUserDragStart(event, uid) {
    event.target.classList.add('dragging');

    const user = unassignedUsers.find(u => u.uid === uid);
    event.dataTransfer.setData('application/json', JSON.stringify({
        type: 'user',
        uid: uid,
        userData: user
    }));
}

/**
 * Render team assignment slots as drop zones
 * Only shows teams that have empty slots (missing players)
 */
function renderTeamAssignmentSlots() {
    const container = document.getElementById('teamAssignmentSlots');
    if (!container) return;

    if (!window.gameState || !window.gameState.teams) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">Load a tournament to see teams</p>';
        return;
    }

    // Filter teams to only show those with empty slots
    const teamsWithEmptySlots = window.gameState.teams.filter(team => {
        // Check if any player slot is empty (no name or no UID)
        return team.players.some(player => !player.name || !player.uid);
    });

    if (teamsWithEmptySlots.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5; color: #10b981;">✓ All teams are fully assigned!</p>';
        return;
    }

    // Use getTeamColor from god-scripts.js if available
    const getColor = (teamId) => {
        if (typeof getTeamColor === 'function') {
            return getTeamColor(teamId);
        }
        return '#666';
    };

    container.innerHTML = teamsWithEmptySlots.map(team => {
        return `
            <div style="background: rgba(51, 65, 85, 0.3); padding: 12px; margin-bottom: 12px; border-radius: 8px; border-left: 4px solid ${getColor(team.id)};">
                <div style="font-weight: 600; color: #ffd700; margin-bottom: 10px;">
                    ${team.name}
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${team.players.map((player, playerIndex) => {
                        const pendingUser = pendingAppointments[team.id]?.[playerIndex];
                        const hasAssignedPlayer = player.name && player.uid;

                        // Only show slots that are empty or have pending appointments
                        if (hasAssignedPlayer && !pendingUser) {
                            return `
                                <div style="background: rgba(16, 185, 129, 0.1); padding: 10px; border-radius: 5px; border: 2px solid #10b981; opacity: 0.6;">
                                    <div style="font-size: 0.85rem; opacity: 0.8;">Slot ${playerIndex + 1}</div>
                                    <div style="font-weight: 600; color: #10b981;">✓ ${player.name}</div>
                                    <div style="font-size: 0.8rem; opacity: 0.8;">${player.email || 'Already assigned'}</div>
                                </div>
                            `;
                        }

                        return `
                            <div class="team-slot"
                                 ondragover="allowDrop(event)"
                                 ondragleave="dragLeave(event)"
                                 ondrop="handleUserDrop(event, ${team.id}, ${playerIndex})"
                                 style="background: rgba(15, 23, 42, 0.5); padding: 10px; border-radius: 5px; border: 2px dashed ${pendingUser ? '#10b981' : '#475569'}; min-height: 50px; display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-size: 0.85rem; opacity: 0.6;">Slot ${playerIndex + 1}</div>
                                    ${pendingUser
                                        ? `<div style="font-weight: 600; color: #10b981;">✓ ${pendingUser.displayName}</div><div style="font-size: 0.8rem; opacity: 0.8;">${pendingUser.email}</div>`
                                        : `<div style="font-style: italic; opacity: 0.5;">Drop user here</div>`
                                    }
                                </div>
                                ${pendingUser
                                    ? `<button onclick="removeUserAppointment('${pendingUser.uid}')" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer;">Remove</button>`
                                    : ''
                                }
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Handle dropping a user into a team slot
 */
function handleUserDrop(event, teamId, playerIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    const dragData = JSON.parse(event.dataTransfer.getData('application/json'));

    if (dragData.type !== 'user') return;

    const user = dragData.userData;

    // Check if user is already assigned
    for (const tId in pendingAppointments) {
        for (const pIdx in pendingAppointments[tId]) {
            if (pendingAppointments[tId][pIdx].uid === user.uid) {
                if (typeof showStatus === 'function') {
                    showStatus('User already assigned to a slot. Remove first.', 'error');
                }
                return;
            }
        }
    }

    // Add to pending appointments
    if (!pendingAppointments[teamId]) {
        pendingAppointments[teamId] = {};
    }

    pendingAppointments[teamId][playerIndex] = user;

    // Re-render both lists to update UI
    renderUnassignedUsers();
    renderTeamAssignmentSlots();

    if (typeof showStatus === 'function') {
        showStatus(`Assigned ${user.displayName} to slot`, 'success');
    }
}

/**
 * Remove a user appointment
 */
function removeUserAppointment(uid) {
    // Find and remove from pending appointments
    for (const teamId in pendingAppointments) {
        for (const playerIndex in pendingAppointments[teamId]) {
            if (pendingAppointments[teamId][playerIndex].uid === uid) {
                delete pendingAppointments[teamId][playerIndex];

                // Clean up empty objects
                if (Object.keys(pendingAppointments[teamId]).length === 0) {
                    delete pendingAppointments[teamId];
                }

                // Re-render both lists to update UI
                renderUnassignedUsers();
                renderTeamAssignmentSlots();

                if (typeof showStatus === 'function') {
                    showStatus('User appointment removed', 'success');
                }
                return;
            }
        }
    }
}

/**
 * Save all pending user appointments to Firebase
 * Updates both user documents and tournament data
 */
async function saveUserAppointments() {
    if (Object.keys(pendingAppointments).length === 0) {
        if (typeof showStatus === 'function') {
            showStatus('No appointments to save', 'warning');
        }
        return;
    }

    if (!window.gameState || !window.gameState.gameId) {
        if (typeof showStatus === 'function') {
            showStatus('No tournament loaded', 'error');
        }
        return;
    }

    try {
        const batch = window.firebaseDB.batch();

        // Process each appointment
        for (const teamId in pendingAppointments) {
            for (const playerIndex in pendingAppointments[teamId]) {
                const user = pendingAppointments[teamId][playerIndex];
                const team = window.gameState.teams.find(t => t.id === parseInt(teamId));

                if (!team) continue;

                // Update user document
                const userRef = window.firebaseDB.collection('users').doc(user.uid);
                batch.update(userRef, {
                    assignedGameId: window.gameState.gameId,
                    assignedTeamId: parseInt(teamId),
                    assignedTeamName: team.name,
                    appointedAt: new Date().toISOString(),
                    appointedBy: 'admin' // TODO: use actual admin UID
                });

                // Update team player name in tournament with contribution tracking
                team.players[playerIndex].name = user.displayName;
                team.players[playerIndex].uid = user.uid;
                team.players[playerIndex].email = user.email;
                team.players[playerIndex].pointsContributed = 0;
                team.players[playerIndex].matchesParticipated = [];
                team.players[playerIndex].joinedAt = new Date().toISOString();
                team.players[playerIndex].pointsWhenJoined = team.points || 0;
                team.players[playerIndex].active = true;
            }
        }

        // Save updated tournament data
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(window.gameState.gameId);
        batch.update(tournamentRef, {
            teams: window.gameState.teams,
            lastModified: new Date().toISOString()
        });

        // Commit batch
        await batch.commit();

        if (typeof showStatus === 'function') {
            showStatus('All appointments saved successfully!', 'success');
        }
        if (typeof addLog === 'function') {
            addLog(`✅ Saved ${Object.keys(pendingAppointments).length} user appointments`, 'success');
        }

        // Clear pending appointments and refresh
        pendingAppointments = {};
        await loadUnassignedUsers();
        renderTeamAssignmentSlots();

        // Update roster display if function exists
        if (typeof renderTournamentRoster === 'function') {
            renderTournamentRoster();
        }

    } catch (error) {
        console.error('[User Appointment] Error saving appointments:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error saving appointments: ' + error.message, 'error');
        }
    }
}

/**
 * Unassign a user from a team (removes from roster)
 * Updates both the tournament document and the user document
 */
async function unassignUserFromTeam(teamId, playerIndex) {
    if (!window.gameState || !window.gameState.gameId) {
        if (typeof showStatus === 'function') {
            showStatus('No tournament loaded', 'error');
        }
        return;
    }

    const team = window.gameState.teams.find(t => t.id === teamId);
    if (!team || !team.players[playerIndex]) {
        if (typeof showStatus === 'function') {
            showStatus('Team or player not found', 'error');
        }
        return;
    }

    const playerName = team.players[playerIndex].name;

    if (!confirm(`Remove "${playerName}" from ${team.name}?\n\nThey will return to the unassigned users list.`)) {
        return;
    }

    try {
        const batch = window.firebaseDB.batch();

        const player = team.players[playerIndex];

        // Move to former players (preserve history)
        if (!team.formerPlayers) team.formerPlayers = [];

        // Check if this player is already in formerPlayers
        const existingIndex = team.formerPlayers.findIndex(fp => fp.uid === player.uid);

        const formerPlayerData = {
            uid: player.uid || null,
            name: player.name || '',
            email: player.email || '',
            pointsContributed: player.pointsContributed || 0,
            matchesParticipated: player.matchesParticipated || [],
            joinedAt: player.joinedAt || null,
            pointsWhenJoined: player.pointsWhenJoined || 0,
            leftAt: new Date().toISOString(),
            pointsWhenLeft: team.points || 0,
            removalCount: 1
        };

        if (existingIndex !== -1) {
            // Player was removed before - update their entry and increment removal count
            const existing = team.formerPlayers[existingIndex];
            formerPlayerData.removalCount = (existing.removalCount || 1) + 1;
            formerPlayerData.firstJoinedAt = existing.firstJoinedAt || existing.joinedAt;
            team.formerPlayers[existingIndex] = formerPlayerData;
        } else {
            // First time removing this player
            formerPlayerData.firstJoinedAt = player.joinedAt || null;
            team.formerPlayers.push(formerPlayerData);
        }

        // Clear player slot in team
        team.players[playerIndex] = {
            name: '',
            uid: null,
            email: '',
            pointsContributed: 0,
            matchesParticipated: [],
            active: false
        };

        // Clean up undefined values in teams before saving
        const cleanTeams = JSON.parse(JSON.stringify(window.gameState.teams, (_key, value) => {
            return value === undefined ? null : value;
        }));

        // Update tournament document
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(window.gameState.gameId);
        batch.update(tournamentRef, {
            teams: cleanTeams,
            lastModified: new Date().toISOString()
        });

        // Update user document - remove assignment (only if player has a UID)
        if (player.uid) {
            const userRef = window.firebaseDB.collection('users').doc(player.uid);
            batch.update(userRef, {
                assignedGameId: null,
                assignedTeamId: null,
                assignedTeamName: null,
                unassignedAt: new Date().toISOString(),
                unassignedBy: 'admin' // TODO: use actual admin UID
            });
        }

        // Commit changes
        await batch.commit();

        if (typeof showStatus === 'function') {
            showStatus(`${playerName} removed from ${team.name}`, 'success');
        }
        if (typeof addLog === 'function') {
            addLog(`🔄 Unassigned ${playerName} from ${team.name}`, 'info');
        }

        // Refresh all displays
        await loadUnassignedUsers();
        renderTeamAssignmentSlots();

        if (typeof renderTournamentRoster === 'function') {
            renderTournamentRoster();
        }

    } catch (error) {
        console.error('[User Appointment] Error unassigning user:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error removing user: ' + error.message, 'error');
        }
    }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize user management when tab is activated
 */
document.addEventListener('firebase-ready', function() {
    console.log('[User Management] Module loaded');

    // Load users when switching to users tab
    const originalSwitchGodTab = window.switchGodTab;
    window.switchGodTab = function(tabName) {
        originalSwitchGodTab(tabName);

        if (tabName === 'users') {
            loadAllUsers();
        }
    };
});
