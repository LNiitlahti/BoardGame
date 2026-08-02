/**
 * UserPicker — reusable "search and pick a real account" helper.
 *
 * Pure/parameterized (no reads of window.gameState) so it works both
 * post-creation (god.html's Users tab, where a tournament and its player
 * registry already exist) and pre-creation (setup.html's wizard, where
 * neither does yet) — callers supply whatever context they have.
 */

/**
 * @param {Object} firebaseDB - Firestore instance
 * @param {Object} [opts]
 * @param {string|null} [opts.currentTournamentId] - Pass null when no
 *   tournament exists yet (setup.html); a truthy assignedTournamentId on a
 *   user then always means "assigned elsewhere," full stop.
 * @param {Set<string>} [opts.alreadyLinkedUids] - UIDs to mark as already
 *   claimed for the caller's current context (e.g. this tournament's
 *   registry, or this in-progress setup session).
 * @returns {Promise<Array<{uid, displayName, email, alreadyLinked, assignedElsewhere}>>}
 */
async function fetchAvailableUsers(firebaseDB, { currentTournamentId = null, alreadyLinkedUids = new Set() } = {}) {
    const snapshot = await firebaseDB.collection('users').get();
    const users = [];

    snapshot.forEach(doc => {
        const data = doc.data();
        const uid = doc.id;
        const assignedTournamentId = data.assignedTournamentId || null;

        users.push({
            uid,
            displayName: data.displayName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown User',
            email: data.email || 'No email',
            alreadyLinked: alreadyLinkedUids.has(uid),
            assignedElsewhere: !!assignedTournamentId && assignedTournamentId !== currentTournamentId
                ? { tournamentId: assignedTournamentId, teamName: data.assignedTeamName || null }
                : null
        });
    });

    return users;
}

function escapeHtmlForPicker(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Render a searchable user list into `containerId`. Pure DOM write — the
 * caller owns fetching (fetchAvailableUsers) and re-rendering on search
 * input.
 *
 * @param {string} containerId
 * @param {Array} users - as returned by fetchAvailableUsers
 * @param {string|null} selectedUid
 * @param {(user: Object) => void} onSelect
 * @param {Object} [opts]
 * @param {string} [opts.searchTerm]
 */
function renderPickerList(containerId, users, selectedUid, onSelect, { searchTerm = '' } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const term = searchTerm.trim().toLowerCase();
    const filtered = term
        ? users.filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
        : users;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="user-picker-empty" style="opacity:0.6;font-size:0.85rem;padding:8px;">No matching users</div>';
        return;
    }

    container.innerHTML = filtered.map(user => {
        const isSelected = user.uid === selectedUid;
        const warning = user.alreadyLinked
            ? '<span style="color:#f59e0b;font-size:0.7rem;"> - already linked here</span>'
            : user.assignedElsewhere
                ? `<span style="color:#9aa1ad;font-size:0.7rem;"> - assigned elsewhere (${escapeHtmlForPicker(user.assignedElsewhere.teamName || 'another tournament')})</span>`
                : '';

        return `
            <div class="user-picker-row" data-uid="${escapeHtmlForPicker(user.uid)}"
                 style="padding:6px 10px;border-radius:5px;cursor:pointer;background:${isSelected ? 'rgba(16,185,129,0.15)' : 'transparent'};">
                <div style="font-weight:600;font-size:0.85rem;">${escapeHtmlForPicker(user.displayName)}${warning}</div>
                <div style="font-size:0.75rem;opacity:0.6;">${escapeHtmlForPicker(user.email)}</div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.user-picker-row').forEach(row => {
        row.addEventListener('click', () => {
            const user = filtered.find(u => u.uid === row.dataset.uid);
            if (user) onSelect(user);
        });
    });
}

const UserPicker = { fetchAvailableUsers, renderPickerList };

if (typeof window !== 'undefined') window.UserPicker = UserPicker;
if (typeof module !== 'undefined' && module.exports) module.exports = UserPicker;
