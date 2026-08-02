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
// USER APPOINTMENT SYSTEM — Click-to-Assign with Player Registry
// =============================================================================

let unassignedUsers = [];
let unassignedUsersSearchTerm = '';
let selectedUserForAssignment = null; // { uid, displayName, email }

/**
 * Load all registered users available for assignment.
 * Includes users not assigned to the current tournament.
 * Also loads users already assigned to this tournament (for the roster).
 */
async function loadUnassignedUsers() {
    if (!window.gameState || !window.gameState.tournamentId) {
        if (typeof showStatus === 'function') {
            showStatus('Load a tournament first', 'error');
        }
        return;
    }

    try {
        const usersSnapshot = await window.firebaseDB.collection('users').get();
        unassignedUsers = [];

        // Collect UIDs already linked in the tournament player registry
        const assignedUids = new Set();
        const registry = window.gameState.players || {};
        Object.values(registry).forEach(p => {
            if (p.uid) assignedUids.add(p.uid);
        });

        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            const uid = doc.id;

            unassignedUsers.push({
                uid,
                displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown User',
                email: userData.email || 'No email',
                fullName: userData.fullName || null,
                alreadyInTournament: assignedUids.has(uid),
                currentAssignment: (userData.assignedTournamentId && userData.assignedTournamentId !== window.gameState.tournamentId) ? {
                    tournamentId: userData.assignedTournamentId,
                    teamName: userData.assignedTeamName
                } : null
            });
        });

        window.unassignedUsers = unassignedUsers;
        selectedUserForAssignment = null;
        renderUnassignedUsers();
        renderTeamAssignmentSlots();

        if (typeof showStatus === 'function') {
            showStatus(`Found ${unassignedUsers.length} available users`, 'success');
        }
    } catch (error) {
        console.error('[User Appointment] Error loading users:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error loading users', 'error');
        }
    }
}

/**
 * Filter unassigned users based on search term
 */
function filterUnassignedUsers() {
    const searchInput = document.getElementById('unassignedUsersSearch');
    if (searchInput) {
        unassignedUsersSearchTerm = searchInput.value.toLowerCase();
    }
    renderUnassignedUsers();
}

/**
 * Select a user for assignment (click-to-select)
 */
function selectUserForAssignment(uid) {
    if (selectedUserForAssignment?.uid === uid) {
        // Deselect
        selectedUserForAssignment = null;
    } else {
        selectedUserForAssignment = unassignedUsers.find(u => u.uid === uid) || null;
    }
    renderUnassignedUsers();
    renderTeamAssignmentSlots();
}

/**
 * Render the list of available users as clickable cards
 */
function renderUnassignedUsers() {
    const container = document.getElementById('unassignedUsersList');
    if (!container) return;

    let availableUsers = [...unassignedUsers];

    if (unassignedUsersSearchTerm) {
        availableUsers = availableUsers.filter(user =>
            user.displayName.toLowerCase().includes(unassignedUsersSearchTerm) ||
            user.email.toLowerCase().includes(unassignedUsersSearchTerm)
        );
    }

    if (availableUsers.length === 0) {
        container.innerHTML = unassignedUsersSearchTerm
            ? `<p style="text-align: center; opacity: 0.5;">No users found matching "${unassignedUsersSearchTerm}"</p>`
            : '<p style="text-align: center; opacity: 0.5;">No available users. Click Refresh to reload.</p>';
        return;
    }

    // Sort: unassigned first, then already-in-tournament
    availableUsers.sort((a, b) => (a.alreadyInTournament ? 1 : 0) - (b.alreadyInTournament ? 1 : 0));

    container.innerHTML = availableUsers.map(user => {
        const isSelected = selectedUserForAssignment?.uid === user.uid;
        const borderColor = isSelected ? '#10b981' : user.alreadyInTournament ? '#6b7280' : '#06b6d4';
        const bgColor = isSelected ? 'rgba(16, 185, 129, 0.15)' : user.alreadyInTournament ? 'rgba(107, 114, 128, 0.15)' : 'rgba(51, 65, 85, 0.5)';
        const assignmentNote = user.alreadyInTournament
            ? `<div style="font-size: 0.75rem; color: #8b5cf6; margin-top: 4px;">Already linked in this tournament</div>`
            : user.currentAssignment
                ? `<div style="font-size: 0.75rem; color: #f59e0b; margin-top: 4px;">Assigned elsewhere: ${user.currentAssignment.teamName || user.currentAssignment.tournamentId}</div>`
                : '';

        return `
            <div onclick="selectUserForAssignment('${user.uid}')"
                 style="background: ${bgColor}; padding: 10px; margin-bottom: 8px; border-radius: 5px; border-left: 3px solid ${borderColor}; cursor: pointer; transition: background 0.15s;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600;">${user.displayName}</div>
                        <div style="font-size: 0.85rem; opacity: 0.8;">${user.email}</div>
                        ${assignmentNote}
                    </div>
                    ${isSelected ? '<div style="color: #10b981; font-weight: bold; font-size: 1.2rem;">&#10003;</div>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render team assignment slots.
 * Uses the normalized player registry (PlayerUtils) to show current roster.
 * Placeholder players (no uid) show "Link" button when a user is selected.
 * Teams are limited to exactly 2 player slots.
 */
function renderTeamAssignmentSlots() {
    const container = document.getElementById('teamAssignmentSlots');
    if (!container) return;

    if (!window.gameState || !window.gameState.teams) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">Load a tournament to see teams</p>';
        return;
    }

    const getColor = (teamId) => {
        if (window.godApp?.teams) return window.godApp.teams.getTeamColor(teamId);
        if (typeof getTeamColor === 'function') return getTeamColor(teamId);
        return '#666';
    };

    container.innerHTML = window.gameState.teams.map(team => {
        const playerIds = window.PlayerUtils
            ? window.PlayerUtils.getTeamPlayerIds(window.gameState, team.id)
            : (team.playerIds || []);
        const players = playerIds.map((pid, idx) => {
            const p = window.PlayerUtils?.getPlayerById(window.gameState, pid);
            return p ? { ...p, playerId: pid, slotIndex: idx } : null;
        }).filter(Boolean);

        const teamFull = players.length >= 2;

        // Only show "Assign" if team has fewer than 2 players AND a user is selected
        const assignBtnHtml = (selectedUserForAssignment && !teamFull)
            ? `<button onclick="assignSelectedUserToTeam(${team.id})" class="btn-small primary" style="margin-top: 8px; width: 100%;">
                   + Assign ${escapeHtml(selectedUserForAssignment.displayName)}
               </button>`
            : '';

        return `
            <div style="background: rgba(51, 65, 85, 0.3); padding: 12px; margin-bottom: 12px; border-radius: 8px; border-left: 4px solid ${getColor(team.id)};">
                <div style="font-weight: 600; color: #ffd700; margin-bottom: 8px;">
                    ${escapeHtml(team.name)} <span style="font-weight: 400; opacity: 0.6; font-size: 0.85rem;">(${players.length}/2 players)</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${players.length > 0 ? players.map(player => {
                        const isPlaceholder = !player.uid;
                        const slotLabel = player.slotIndex === 0 ? 'Player A' : 'Player B';
                        const borderColor = isPlaceholder ? '#f59e0b' : '#10b981';
                        const bgColor = isPlaceholder ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)';

                        // "Use {name} here" links a placeholder or swaps an already-linked
                        // slot for whoever is currently selected in the user picker —
                        // replacePlayerWithUser() decides which underneath.
                        const useBtnHtml = selectedUserForAssignment
                            ? `<button onclick="replacePlayerWithUser(${team.id}, '${player.playerId}')"
                                      style="background: ${isPlaceholder ? '#10b981' : '#d97706'}; color: white; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.8rem;">
                                  Use ${escapeHtml(selectedUserForAssignment.displayName)} here
                              </button>`
                            : '';

                        return `
                            <div style="background: ${bgColor}; padding: 8px 10px; border-radius: 5px; border-left: 3px solid ${borderColor}; display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600; font-size: 0.95rem;">${escapeHtml(player.name)}</div>
                                    <div style="font-size: 0.75rem; opacity: 0.6;">
                                        ${slotLabel} ${isPlaceholder ? '- Placeholder' : '- Linked'}
                                    </div>
                                </div>
                                <div style="display: flex; gap: 4px;">
                                    ${useBtnHtml}
                                    <button onclick="unassignUserFromTeam(${team.id}, '${player.playerId}')"
                                            style="background: rgba(239, 68, 68, 0.6); color: white; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.75rem; margin-left: 6px;">
                                        Delete slot
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('') : `
                        <div style="background: rgba(71, 85, 105, 0.3); padding: 10px; border-radius: 5px; border: 2px dashed #475569; text-align: center;">
                            <div style="font-style: italic; opacity: 0.5;">No players assigned</div>
                        </div>
                    `}
                    ${assignBtnHtml}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Use the selected user for a roster slot — either a first-time link
 * (slot is a placeholder) or a swap (slot is already linked to someone
 * else). Both share one button/verb ("Use {name} here") since from the
 * admin's point of view it's the same action; underneath, linking is an
 * in-place update (no identity changes) while swapping mints a fresh
 * player ID for the new person so the previous occupant's match history
 * stays theirs — see PlayerUtils.swapPlayerInSlot for why.
 */
async function replacePlayerWithUser(teamId, playerId) {
    if (!selectedUserForAssignment) {
        if (typeof showStatus === 'function') showStatus('Select a user first', 'warning');
        return;
    }
    if (!window.gameState || !window.gameState.tournamentId) {
        if (typeof showStatus === 'function') showStatus('No tournament loaded', 'error');
        return;
    }

    const user = selectedUserForAssignment;
    const team = window.gameState.teams.find(t => String(t.id) === String(teamId));
    if (!team) {
        if (typeof showStatus === 'function') showStatus('Team not found', 'error');
        return;
    }

    const player = window.PlayerUtils?.getPlayerById(window.gameState, playerId);
    if (!player) {
        if (typeof showStatus === 'function') showStatus('Player not found in registry', 'error');
        return;
    }

    // Check if user is already in the registry for this tournament
    const registry = window.gameState.players || {};
    for (const pid of Object.keys(registry)) {
        if (registry[pid].uid === user.uid) {
            if (typeof showStatus === 'function') showStatus('User is already assigned in this tournament', 'error');
            return;
        }
    }

    const isSwap = window.PlayerUtils.isPlayerLinked(window.gameState, playerId);
    const oldName = player.name;

    if (isSwap) {
        const confirmed = confirm(
            `"${oldName}"'s completed games stay on their own record. ${user.displayName} takes over this slot starting now.`
        );
        if (!confirmed) return;
    }

    try {
        const mutation = isSwap
            ? window.PlayerUtils.swapPlayerInSlot(window.gameState, team.id, playerId, {
                uid: user.uid, name: user.displayName, email: user.email
            })
            : window.PlayerUtils.linkUserToPlayerSlot(window.gameState, team.id, playerId, {
                uid: user.uid, name: user.displayName, email: user.email
            });

        if (!mutation.ok) {
            if (typeof showStatus === 'function') showStatus(`Could not link user: ${mutation.reason}`, 'error');
            return;
        }

        const newPlayerId = isSwap ? mutation.newPlayerId : playerId;

        // Save to Firestore
        const batch = window.firebaseDB.batch();

        // Update the new occupant's user document with the assignment
        const userRef = window.firebaseDB.collection('users').doc(user.uid);
        batch.update(userRef, {
            assignedTournamentId: window.gameState.tournamentId,
            assignedTeamId: team.id,
            assignedTeamName: team.name,
            assignedPlayerId: newPlayerId,
            isPlayer: true,
            appointedAt: new Date().toISOString(),
            appointedBy: firebase.auth().currentUser?.uid || 'admin'
        });

        // On a swap, the OLD occupant is no longer on this team — clear
        // their assignment so home.html's "you're on a team" banner and
        // team-controls.js's bootstrap redirect don't point them at a
        // slot they no longer control (onboarding.js's own access check
        // is roster-based and already correctly locks them out regardless).
        if (isSwap && player.uid) {
            if (!team.formerPlayers) team.formerPlayers = [];
            team.formerPlayers.push({
                uid: player.uid,
                playerId,
                name: oldName,
                leftAt: new Date().toISOString(),
                pointsWhenLeft: team.points || 0
            });

            const oldUserRef = window.firebaseDB.collection('users').doc(player.uid);
            // Same guard as unassignUserFromTeam: only clear if their
            // account still points at this exact slot — they may have been
            // linked into a different tournament since.
            const oldUserSnap = await oldUserRef.get();
            if (window.UserAssignment.shouldClearUserAssignment(oldUserSnap.data(), { tournamentId: window.gameState.tournamentId, playerId })) {
                batch.update(oldUserRef, {
                    assignedTournamentId: null,
                    assignedTeamId: null,
                    assignedTeamName: null,
                    assignedPlayerId: null,
                    isPlayer: false,
                    unassignedAt: new Date().toISOString(),
                    unassignedBy: firebase.auth().currentUser?.uid || 'admin'
                });
            }
        }

        // Save tournament data
        const cleanData = JSON.parse(JSON.stringify({
            teams: window.gameState.teams,
            players: window.gameState.players || {},
            lastModified: new Date().toISOString()
        }, (_key, value) => value === undefined ? null : value));

        const tournamentRef = window.firebaseDB.collection('tournaments').doc(window.gameState.tournamentId);
        batch.update(tournamentRef, cleanData);

        await batch.commit();

        if (typeof showStatus === 'function') {
            showStatus(
                isSwap
                    ? `${user.displayName} now plays "${oldName}"'s slot on ${team.name}`
                    : `Linked "${oldName}" -> ${user.displayName} on ${team.name}`,
                'success'
            );
        }

        if (isSwap) {
            window.godApp?.actionLogger?.logAction('player_swapped', 'admin', {
                teamId: team.id, teamName: team.name,
                oldPlayerId: playerId, oldPlayerName: oldName,
                newPlayerId, newPlayerName: user.displayName
            });
            console.log(`[User Management] Swapped "${oldName}" (${playerId}) for "${user.displayName}" (${newPlayerId}) on ${team.name}`);
        } else {
            window.godApp?.actionLogger?.logAction('player_linked', 'admin', {
                teamId: team.id, teamName: team.name,
                playerId, playerName: oldName, userName: user.displayName
            });
            console.log(`[User Management] Replaced placeholder "${oldName}" (${playerId}) with user "${user.displayName}" (${user.uid})`);
        }

        // Remove from unassigned list and clear selection
        unassignedUsers = unassignedUsers.filter(u => u.uid !== user.uid);
        selectedUserForAssignment = null;

        renderUnassignedUsers();
        renderTeamAssignmentSlots();
        renderTournamentRoster();

    } catch (error) {
        console.error('[User Management] Error replacing player:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error linking user: ' + error.message, 'error');
        }
    }
}

/**
 * Assign the currently selected user to a team.
 * Creates a player registry entry linked to the Firebase user.
 */
async function assignSelectedUserToTeam(teamId) {
    if (!selectedUserForAssignment) {
        if (typeof showStatus === 'function') showStatus('Select a user first', 'warning');
        return;
    }
    if (!window.gameState || !window.gameState.tournamentId) {
        if (typeof showStatus === 'function') showStatus('No tournament loaded', 'error');
        return;
    }

    const user = selectedUserForAssignment;
    const team = window.gameState.teams.find(t => String(t.id) === String(teamId));
    if (!team) {
        if (typeof showStatus === 'function') showStatus('Team not found', 'error');
        return;
    }

    // Enforce 2-player limit
    const currentPlayerIds = window.PlayerUtils
        ? window.PlayerUtils.getTeamPlayerIds(window.gameState, team.id)
        : (team.playerIds || []);
    if (currentPlayerIds.length >= 2) {
        if (typeof showStatus === 'function') showStatus('Team already has 2 players. Use "Link" to replace a placeholder.', 'warning');
        return;
    }

    // Check if user is already in the registry for this tournament
    const registry = window.gameState.players || {};
    for (const pid of Object.keys(registry)) {
        if (registry[pid].uid === user.uid) {
            if (typeof showStatus === 'function') showStatus('User is already assigned in this tournament', 'error');
            return;
        }
    }

    try {
        // Add to normalized player registry via PlayerUtils
        const playerId = window.PlayerUtils
            ? window.PlayerUtils.addPlayerToTeam(window.gameState, team.id, { name: user.displayName, uid: user.uid })
            : null;

        if (!playerId) {
            if (typeof showStatus === 'function') showStatus('Error: PlayerUtils not available', 'error');
            return;
        }

        // Also maintain legacy players[] array for backward compatibility
        if (!team.players) team.players = [];
        team.players.push({
            id: playerId,
            name: user.displayName,
            uid: user.uid,
            email: user.email,
            pointsContributed: 0,
            joinedAt: new Date().toISOString(),
            pointsWhenJoined: team.points || 0,
            active: true
        });

        // Update user document with assignment
        const batch = window.firebaseDB.batch();
        const userRef = window.firebaseDB.collection('users').doc(user.uid);
        batch.update(userRef, {
            assignedTournamentId: window.gameState.tournamentId,
            assignedTeamId: team.id,
            assignedTeamName: team.name,
            isPlayer: true,
            appointedAt: new Date().toISOString(),
            appointedBy: firebase.auth().currentUser?.uid || 'admin'
        });

        // Save tournament data (players registry + teams)
        const cleanData = JSON.parse(JSON.stringify({
            teams: window.gameState.teams,
            players: window.gameState.players || {},
            lastModified: new Date().toISOString()
        }, (_key, value) => value === undefined ? null : value));

        const tournamentRef = window.firebaseDB.collection('tournaments').doc(window.gameState.tournamentId);
        batch.update(tournamentRef, cleanData);

        await batch.commit();

        if (typeof showStatus === 'function') {
            showStatus(`${user.displayName} assigned to ${team.name}`, 'success');
        }

        // Remove from unassigned list and clear selection
        unassignedUsers = unassignedUsers.filter(u => u.uid !== user.uid);
        selectedUserForAssignment = null;

        renderUnassignedUsers();
        renderTeamAssignmentSlots();
        renderTournamentRoster();

    } catch (error) {
        console.error('[User Appointment] Error assigning user:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error assigning user: ' + error.message, 'error');
        }
    }
}

/**
 * Load tournament data for user appointment system
 */
async function loadTournamentForAppointment(tournamentId) {
    console.log('[User Appointment] Loading tournament:', tournamentId);
    await loadUnassignedUsers();
    renderTeamAssignmentSlots();
    renderTournamentRoster();
}

/**
 * Render the complete tournament roster using the normalized player registry
 */
function renderTournamentRoster() {
    const container = document.getElementById('tournamentRosterDisplay');
    if (!container) return;

    if (!window.gameState || !window.gameState.teams) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5; grid-column: 1 / -1;">Load a tournament to see roster</p>';
        return;
    }

    const getColor = (teamId) => {
        if (window.godApp?.teams) return window.godApp.teams.getTeamColor(teamId);
        if (typeof getTeamColor === 'function') return getTeamColor(teamId);
        return '#666';
    };

    container.innerHTML = window.gameState.teams.map(team => {
        // Use normalized registry
        const playerIds = window.PlayerUtils
            ? window.PlayerUtils.getTeamPlayerIds(window.gameState, team.id)
            : (team.playerIds || []);
        const players = playerIds.map(pid => {
            const p = window.PlayerUtils?.getPlayerById(window.gameState, pid);
            return p ? { ...p, playerId: pid } : null;
        }).filter(Boolean);

        return `
            <div style="background: rgba(51, 65, 85, 0.3); padding: 15px; border-radius: 8px; border-left: 4px solid ${getColor(team.id)};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div id="teamName-display-${team.id}" style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: 600; color: #ffd700; font-size: 1.1rem;">${team.name}</span>
                            <button onclick="startEditTeamName(${team.id})"
                                    style="background: rgba(255, 255, 255, 0.1); border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; color: #9aa1ad; font-size: 0.75rem;"
                                    title="Edit team name">
                                ✏️
                            </button>
                        </div>
                        <div id="teamName-edit-${team.id}" style="display: none; margin-bottom: 8px;">
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <input type="text" id="teamName-input-${team.id}" value="${team.name}"
                                       style="flex: 1; padding: 6px 10px; background: rgba(11, 13, 16, 0.6); border: 1px solid #10b981; border-radius: 5px; color: white; font-size: 1rem;"
                                       onkeydown="handleTeamNameKeydown(event, ${team.id})">
                                <button onclick="saveTeamName(${team.id})"
                                        style="background: #10b981; color: white; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 0.85rem;">
                                    Save
                                </button>
                                <button onclick="cancelEditTeamName(${team.id})"
                                        style="background: #475569; color: white; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 0.85rem;">
                                    Cancel
                                </button>
                            </div>
                        </div>
                        <div style="font-size: 0.85rem; opacity: 0.7;">${team.points || 0} points</div>
                    </div>
                    <div style="text-align: right; font-size: 0.85rem;">
                        <div style="color: #10b981;">${players.length} players</div>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${players.length > 0 ? players.map((player, idx) => {
                        const isPlaceholder = !player.uid;
                        const slotLabel = idx === 0 ? 'Player A' : 'Player B';
                        const borderColor = isPlaceholder ? '#f59e0b' : '#10b981';
                        const bgColor = isPlaceholder ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)';
                        return `
                            <div style="background: ${bgColor}; padding: 10px; border-radius: 5px; border-left: 3px solid ${borderColor}; display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600;">${escapeHtml(player.name)}</div>
                                    <div style="font-size: 0.75rem; opacity: 0.6;">${slotLabel} ${isPlaceholder ? '- Placeholder' : '- Linked'}</div>
                                </div>
                                <button onclick="unassignUserFromTeam(${team.id}, '${player.playerId}')"
                                        style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 0.85rem;">
                                    Delete slot
                                </button>
                            </div>
                        `;
                    }).join('') : `
                        <div style="background: rgba(71, 85, 105, 0.3); padding: 10px; border-radius: 5px; border: 2px dashed #475569;">
                            <div style="font-style: italic; opacity: 0.5;">No players assigned yet</div>
                        </div>
                    `}
                </div>

                ${team.formerPlayers && team.formerPlayers.length > 0 ? `
                    <details style="margin-top: 12px;">
                        <summary style="cursor: pointer; opacity: 0.7; font-size: 0.85rem;">Former Players (${team.formerPlayers.length})</summary>
                        <div style="margin-top: 8px; padding-left: 10px;">
                            ${team.formerPlayers.map(fp => `
                                <div style="font-size: 0.8rem; opacity: 0.6; margin: 4px 0;">
                                    ${fp.name} - ${fp.pointsContributed || 0} pts contributed
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Unassign a user from a team.
 * Removes from player registry and clears user doc assignment.
 * @param {number} teamId
 * @param {string} playerId - Normalized player ID (p_xxxx)
 */
async function unassignUserFromTeam(teamId, playerId) {
    if (!window.gameState || !window.gameState.tournamentId) {
        if (typeof showStatus === 'function') showStatus('No tournament loaded', 'error');
        return;
    }

    const team = window.gameState.teams.find(t => String(t.id) === String(teamId));
    if (!team) {
        if (typeof showStatus === 'function') showStatus('Team not found', 'error');
        return;
    }

    const player = window.PlayerUtils?.getPlayerById(window.gameState, playerId);
    if (!player) {
        if (typeof showStatus === 'function') showStatus('Player not found in registry', 'error');
        return;
    }

    const confirmMsg = player.uid
        ? `Delete "${player.name}"'s slot from ${team.name}? This permanently removes their match history attribution and cannot be undone — if you're replacing this player, select their replacement above and click "Use ... here" instead of deleting.`
        : `Delete this empty slot from ${team.name}? This cannot be undone.`;
    if (!confirm(confirmMsg)) {
        return;
    }

    try {
        const batch = window.firebaseDB.batch();

        // Preserve in formerPlayers history
        if (!team.formerPlayers) team.formerPlayers = [];
        const existingIdx = team.formerPlayers.findIndex(fp => fp.uid === player.uid);
        const formerData = {
            uid: player.uid || null,
            playerId: playerId,
            name: player.name || '',
            leftAt: new Date().toISOString(),
            pointsWhenLeft: team.points || 0,
            removalCount: 1
        };
        if (existingIdx !== -1) {
            formerData.removalCount = (team.formerPlayers[existingIdx].removalCount || 1) + 1;
            team.formerPlayers[existingIdx] = formerData;
        } else {
            team.formerPlayers.push(formerData);
        }

        // Remove from registry + team.playerIds + legacy team.players[]
        window.PlayerUtils.deletePlayerSlot(window.gameState, team.id, playerId);

        // Save tournament data
        const cleanData = JSON.parse(JSON.stringify({
            teams: window.gameState.teams,
            players: window.gameState.players || {},
            lastModified: new Date().toISOString()
        }, (_key, value) => value === undefined ? null : value));

        const tournamentRef = window.firebaseDB.collection('tournaments').doc(window.gameState.tournamentId);
        batch.update(tournamentRef, cleanData);

        // Clear user doc assignment if player had a linked uid
        if (player.uid) {
            const userRef = window.firebaseDB.collection('users').doc(player.uid);
            // Only clear the account's assignment pointer if it still points
            // at THIS tournament/slot — they may have since been linked into
            // a different tournament, whose assignment must not be wiped out
            // by removing them from this older one.
            const userSnap = await userRef.get();
            if (window.UserAssignment.shouldClearUserAssignment(userSnap.data(), { tournamentId: window.gameState.tournamentId, playerId })) {
                batch.update(userRef, {
                    assignedTournamentId: null,
                    assignedTeamId: null,
                    assignedTeamName: null,
                    assignedPlayerId: null,
                    isPlayer: false,
                    unassignedAt: new Date().toISOString(),
                    unassignedBy: firebase.auth().currentUser?.uid || 'admin'
                });
            }
        }

        await batch.commit();

        if (typeof showStatus === 'function') {
            showStatus(`${player.name} removed from ${team.name}`, 'success');
        }

        window.godApp?.actionLogger?.logAction('player_removed', 'admin', {
            teamId: team.id, teamName: team.name, playerName: player.name, playerId, wasLinked: !!player.uid
        }, { player });

        // Refresh displays
        await loadUnassignedUsers();
        renderTeamAssignmentSlots();
        renderTournamentRoster();

    } catch (error) {
        console.error('[User Appointment] Error unassigning user:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error removing user: ' + error.message, 'error');
        }
    }
}

// =============================================================================
// TEAM NAME EDITING
// =============================================================================

/**
 * Start editing a team name
 * @param {number} teamId - Team ID
 */
function startEditTeamName(teamId) {
    // Hide display, show edit
    const displayEl = document.getElementById(`teamName-display-${teamId}`);
    const editEl = document.getElementById(`teamName-edit-${teamId}`);
    const inputEl = document.getElementById(`teamName-input-${teamId}`);

    if (displayEl) displayEl.style.display = 'none';
    if (editEl) editEl.style.display = 'block';
    if (inputEl) {
        inputEl.focus();
        inputEl.select();
    }
}

/**
 * Cancel editing a team name
 * @param {number} teamId - Team ID
 */
function cancelEditTeamName(teamId) {
    const team = window.gameState?.teams?.find(t => t.id === teamId);
    if (!team) return;

    // Reset input to original value
    const inputEl = document.getElementById(`teamName-input-${teamId}`);
    if (inputEl) inputEl.value = team.name;

    // Hide edit, show display
    const displayEl = document.getElementById(`teamName-display-${teamId}`);
    const editEl = document.getElementById(`teamName-edit-${teamId}`);

    if (displayEl) displayEl.style.display = 'flex';
    if (editEl) editEl.style.display = 'none';
}

/**
 * Handle keydown in team name input
 * @param {KeyboardEvent} event
 * @param {number} teamId - Team ID
 */
function handleTeamNameKeydown(event, teamId) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveTeamName(teamId);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditTeamName(teamId);
    }
}

/**
 * Save a team name change
 * Records the old name in nameHistory for historical accuracy
 * @param {number} teamId - Team ID
 */
async function saveTeamName(teamId) {
    if (!window.gameState || !window.gameState.tournamentId) {
        if (typeof showStatus === 'function') {
            showStatus('No tournament loaded', 'error');
        }
        return;
    }

    const team = window.gameState.teams?.find(t => t.id === teamId);
    if (!team) {
        if (typeof showStatus === 'function') {
            showStatus('Team not found', 'error');
        }
        return;
    }

    const inputEl = document.getElementById(`teamName-input-${teamId}`);
    if (!inputEl) return;

    const newName = inputEl.value.trim();

    if (!newName) {
        if (typeof showStatus === 'function') {
            showStatus('Team name cannot be empty', 'error');
        }
        return;
    }

    if (newName === team.name) {
        // No change, just close the edit
        cancelEditTeamName(teamId);
        return;
    }

    try {
        const oldName = team.name;

        // Record name change in history
        if (!team.nameHistory) {
            team.nameHistory = [];
        }
        team.nameHistory.push({
            oldName: oldName,
            newName: newName,
            changedAt: new Date().toISOString(),
            changedBy: firebase.auth().currentUser?.uid || 'unknown'
        });

        // Update the team name
        team.name = newName;

        // Save to Firebase
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(window.gameState.tournamentId);
        await tournamentRef.update({
            teams: window.gameState.teams,
            lastModified: new Date().toISOString()
        });

        if (typeof showStatus === 'function') {
            showStatus(`Team renamed: "${oldName}" → "${newName}"`, 'success');
        }
        if (typeof addLog === 'function') {
            addLog(`📝 Team renamed: "${oldName}" → "${newName}"`, 'info');
        }

        console.log(`[User Management] Team ${teamId} renamed from "${oldName}" to "${newName}"`);

        // Re-render the roster to show updated name
        renderTournamentRoster();

        // Also update team assignment slots if visible
        if (typeof renderTeamAssignmentSlots === 'function') {
            renderTeamAssignmentSlots();
        }

        // Update other displays that might show team names
        if (typeof updateTeamsList === 'function') {
            updateTeamsList();
        }
        if (typeof updateTeamPool === 'function') {
            updateTeamPool();
        }

    } catch (error) {
        console.error('[User Management] Error saving team name:', error);
        if (typeof showStatus === 'function') {
            showStatus('Error saving team name: ' + error.message, 'error');
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

// Expose functions to window for module access
window.loadUsers = loadAllUsers;
window.loadAllUsers = loadAllUsers;
window.loadUnassignedUsers = loadUnassignedUsers;
window.filterUnassignedUsers = filterUnassignedUsers;
window.selectUserForAssignment = selectUserForAssignment;
window.assignSelectedUserToTeam = assignSelectedUserToTeam;
window.replacePlayerWithUser = replacePlayerWithUser;
window.unassignUserFromTeam = unassignUserFromTeam;
window.renderTeamAssignmentSlots = renderTeamAssignmentSlots;
window.renderTournamentRoster = renderTournamentRoster;

// Team name editing functions
window.startEditTeamName = startEditTeamName;
window.cancelEditTeamName = cancelEditTeamName;
window.saveTeamName = saveTeamName;
window.handleTeamNameKeydown = handleTeamNameKeydown;
