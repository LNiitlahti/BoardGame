/**
 * SeasonManager — Tournament Season Management
 *
 * Manages seasons that group multiple LAN tournaments together.
 * Each season has a configurable max tournaments (default 4).
 * Only GOD can create/edit/delete seasons.
 *
 * Firestore: seasons/{seasonId}
 * {
 *   name, tournamentIds[], maxTournaments, status,
 *   createdAt, updatedAt
 * }
 *
 * Tournament docs get a `seasonId` field when linked.
 */

class SeasonManager {

    constructor({ getFirebaseDB, getCurrentUser, getCurrentUserRole, uiManager }) {
        this._db = getFirebaseDB;
        this._getUser = getCurrentUser;
        this._getRole = getCurrentUserRole;
        this._ui = uiManager;
        this._seasons = [];
        this._tournamentNames = {}; // cache: tid -> name
    }

    // ------------------------------------------------------------------
    // CRUD
    // ------------------------------------------------------------------

    async loadSeasons() {
        try {
            const db = this._db();
            if (!db) return;

            const snapshot = await db.collection('seasons').orderBy('createdAt', 'desc').get();
            this._seasons = [];
            snapshot.forEach(doc => {
                this._seasons.push({ id: doc.id, ...doc.data() });
            });

            // Load tournament names for display
            await this._loadTournamentNames();

            this.renderSeasonsList('seasonsList');
        } catch (error) {
            console.error('[SeasonManager] Error loading seasons:', error);
            if (this._ui?.showStatus) this._ui.showStatus('Error loading seasons', 'error');
        }
    }

    async createSeason(name, maxTournaments, status) {
        if (!name?.trim()) return;

        try {
            const db = this._db();
            const now = new Date().toISOString();

            await db.collection('seasons').add({
                name: name.trim(),
                tournamentIds: [],
                maxTournaments: maxTournaments || 4,
                status: status || 'upcoming',
                createdAt: now,
                updatedAt: now
            });

            if (this._ui?.showStatus) this._ui.showStatus(`Season "${name}" created`, 'success');
            await this.loadSeasons();
        } catch (error) {
            console.error('[SeasonManager] Error creating season:', error);
            if (this._ui?.showStatus) this._ui.showStatus('Error creating season', 'error');
        }
    }

    async updateSeason(seasonId, updates) {
        try {
            const db = this._db();
            await db.collection('seasons').doc(seasonId).update({
                ...updates,
                updatedAt: new Date().toISOString()
            });

            if (this._ui?.showStatus) this._ui.showStatus('Season updated', 'success');
            await this.loadSeasons();
        } catch (error) {
            console.error('[SeasonManager] Error updating season:', error);
            if (this._ui?.showStatus) this._ui.showStatus('Error updating season', 'error');
        }
    }

    async deleteSeason(seasonId) {
        const season = this._seasons.find(s => s.id === seasonId);
        if (!season) return;

        if (season.tournamentIds && season.tournamentIds.length > 0) {
            if (this._ui?.showStatus) {
                this._ui.showStatus('Remove all tournaments from the season before deleting', 'error');
            }
            return;
        }

        if (!confirm(`Delete season "${season.name}"? This cannot be undone.`)) return;

        try {
            const db = this._db();
            await db.collection('seasons').doc(seasonId).delete();

            if (this._ui?.showStatus) this._ui.showStatus(`Season "${season.name}" deleted`, 'success');
            await this.loadSeasons();
        } catch (error) {
            console.error('[SeasonManager] Error deleting season:', error);
            if (this._ui?.showStatus) this._ui.showStatus('Error deleting season', 'error');
        }
    }

    // ------------------------------------------------------------------
    // Tournament-Season linking
    // ------------------------------------------------------------------

    async addTournamentToSeason(seasonId, tournamentId) {
        if (!seasonId || !tournamentId) return;

        const season = this._seasons.find(s => s.id === seasonId);
        if (!season) return;

        if (season.tournamentIds?.includes(tournamentId)) {
            if (this._ui?.showStatus) this._ui.showStatus('Tournament already in this season', 'warning');
            return;
        }

        if (season.tournamentIds?.length >= (season.maxTournaments || 4)) {
            if (this._ui?.showStatus) this._ui.showStatus(`Season is full (max ${season.maxTournaments || 4} tournaments)`, 'error');
            return;
        }

        try {
            const db = this._db();
            const batch = db.batch();

            // Add to season's tournamentIds
            const seasonRef = db.collection('seasons').doc(seasonId);
            batch.update(seasonRef, {
                tournamentIds: firebase.firestore.FieldValue.arrayUnion(tournamentId),
                updatedAt: new Date().toISOString()
            });

            // Set seasonId on tournament doc
            const tournamentRef = db.collection('tournaments').doc(tournamentId);
            batch.update(tournamentRef, { seasonId: seasonId });

            await batch.commit();

            if (this._ui?.showStatus) this._ui.showStatus('Tournament added to season', 'success');
            await this.loadSeasons();
        } catch (error) {
            console.error('[SeasonManager] Error adding tournament to season:', error);
            if (this._ui?.showStatus) this._ui.showStatus('Error adding tournament', 'error');
        }
    }

    async removeTournamentFromSeason(seasonId, tournamentId) {
        if (!seasonId || !tournamentId) return;

        try {
            const db = this._db();
            const batch = db.batch();

            // Remove from season's tournamentIds
            const seasonRef = db.collection('seasons').doc(seasonId);
            batch.update(seasonRef, {
                tournamentIds: firebase.firestore.FieldValue.arrayRemove(tournamentId),
                updatedAt: new Date().toISOString()
            });

            // Clear seasonId on tournament doc
            const tournamentRef = db.collection('tournaments').doc(tournamentId);
            batch.update(tournamentRef, { seasonId: null });

            await batch.commit();

            if (this._ui?.showStatus) this._ui.showStatus('Tournament removed from season', 'success');
            await this.loadSeasons();
        } catch (error) {
            console.error('[SeasonManager] Error removing tournament from season:', error);
            if (this._ui?.showStatus) this._ui.showStatus('Error removing tournament', 'error');
        }
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    renderSeasonsList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this._seasons.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.5;">No seasons created yet</p>';
            return;
        }

        const statusColors = {
            upcoming: '#f59e0b',
            active: '#10b981',
            completed: '#6366f1'
        };

        container.innerHTML = this._seasons.map(season => {
            const color = statusColors[season.status] || '#666';
            const tournamentCount = season.tournamentIds?.length || 0;
            const maxT = season.maxTournaments || 4;

            const tournamentChips = (season.tournamentIds || []).map(tid => {
                const name = this._tournamentNames[tid] || tid.substring(0, 8) + '...';
                return `
                    <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(51, 65, 85, 0.5); padding: 4px 10px; border-radius: 12px; font-size: 0.8rem;">
                        <span>${name}</span>
                        <button onclick="removeTournamentFromSeason('${season.id}', '${tid}')"
                                style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.9rem; padding: 0 2px;"
                                title="Remove from season">&times;</button>
                    </div>
                `;
            }).join('');

            return `
                <div style="background: rgba(51, 65, 85, 0.3); padding: 16px; margin-bottom: 12px; border-radius: 8px; border-left: 4px solid ${color};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                        <div>
                            <div style="font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">${season.name}</div>
                            <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                                <span style="background: ${color}22; color: ${color}; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: 600;">${season.status}</span>
                                <span style="font-size: 0.85rem; opacity: 0.6;">${tournamentCount}/${maxT} tournaments</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="openEditSeasonModal('${season.id}')" class="btn-small secondary">Edit</button>
                            <button onclick="deleteSeasonById('${season.id}')" class="btn-small danger">Delete</button>
                        </div>
                    </div>

                    ${tournamentCount > 0 ? `
                        <div style="margin-top: 8px;">
                            <div style="font-size: 0.8rem; opacity: 0.6; margin-bottom: 6px;">Tournaments:</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 6px;">${tournamentChips}</div>
                        </div>
                    ` : `
                        <div style="margin-top: 8px; font-size: 0.85rem; opacity: 0.5; font-style: italic;">No tournaments added yet</div>
                    `}

                    ${tournamentCount < maxT ? `
                        <div style="margin-top: 10px;">
                            <select id="seasonAddTournament-${season.id}" style="padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-primary); font-size: 0.85rem; margin-right: 6px;">
                                <option value="">Select tournament to add...</option>
                                ${this._getAvailableTournamentOptions(season)}
                            </select>
                            <button onclick="addSelectedTournamentToSeason('${season.id}')" class="btn-small primary">Add</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * Render a season selector dropdown for tournament creation
     */
    renderSeasonSelector(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = '<option value="">No season</option>';
        this._seasons.filter(s => s.status !== 'completed').forEach(season => {
            const count = season.tournamentIds?.length || 0;
            const max = season.maxTournaments || 4;
            if (count < max) {
                const opt = document.createElement('option');
                opt.value = season.id;
                opt.textContent = `${season.name} (${count}/${max})`;
                select.appendChild(opt);
            }
        });
    }

    // ------------------------------------------------------------------
    // Edit Season Modal
    // ------------------------------------------------------------------

    openEditModal(seasonId) {
        const season = this._seasons.find(s => s.id === seasonId);
        if (!season) return;

        const body = document.getElementById('editSeasonModalBody');
        if (!body) return;

        body.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
                <label style="font-size: 0.85rem; color: var(--text-secondary);">Season Name</label>
                <input type="text" id="editSeasonName" value="${season.name}"
                       style="padding: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">

                <label style="font-size: 0.85rem; color: var(--text-secondary);">Max Tournaments</label>
                <input type="number" id="editSeasonMaxT" value="${season.maxTournaments || 4}" min="1" max="20"
                       style="padding: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">

                <label style="font-size: 0.85rem; color: var(--text-secondary);">Status</label>
                <select id="editSeasonStatus" style="padding: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary);">
                    <option value="upcoming" ${season.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                    <option value="active" ${season.status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="completed" ${season.status === 'completed' ? 'selected' : ''}>Completed</option>
                </select>
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn secondary" onclick="closeEditSeasonModal()">Cancel</button>
                <button class="btn primary" onclick="confirmEditSeason('${seasonId}')">Save Changes</button>
            </div>
        `;

        document.getElementById('editSeasonModal').style.display = 'flex';
    }

    async confirmEdit(seasonId) {
        const name = document.getElementById('editSeasonName')?.value?.trim();
        const maxT = parseInt(document.getElementById('editSeasonMaxT')?.value) || 4;
        const status = document.getElementById('editSeasonStatus')?.value || 'upcoming';

        if (!name) {
            if (this._ui?.showStatus) this._ui.showStatus('Season name cannot be empty', 'error');
            return;
        }

        await this.updateSeason(seasonId, { name, maxTournaments: maxT, status });
        document.getElementById('editSeasonModal').style.display = 'none';
    }

    // ------------------------------------------------------------------
    // Modal helpers (called from god.html)
    // ------------------------------------------------------------------

    async createSeasonFromModal() {
        const name = document.getElementById('seasonNameInput')?.value?.trim();
        const maxT = parseInt(document.getElementById('seasonMaxTournaments')?.value) || 4;
        const status = document.getElementById('seasonStatusInput')?.value || 'upcoming';

        if (!name) {
            if (this._ui?.showStatus) this._ui.showStatus('Enter a season name', 'error');
            return;
        }

        await this.createSeason(name, maxT, status);
        document.getElementById('createSeasonModal').style.display = 'none';

        // Clear inputs
        const nameInput = document.getElementById('seasonNameInput');
        if (nameInput) nameInput.value = '';
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    async _loadTournamentNames() {
        try {
            const db = this._db();
            if (!db) return;

            // Collect all tournament IDs referenced by seasons
            const allTids = new Set();
            this._seasons.forEach(s => {
                (s.tournamentIds || []).forEach(tid => allTids.add(tid));
            });

            // Also load all tournaments for the "add" dropdown
            const snapshot = await db.collection('tournaments').orderBy('createdAt', 'desc').limit(50).get();
            this._allTournaments = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                this._tournamentNames[doc.id] = data.name || doc.id;
                this._allTournaments.push({ id: doc.id, name: data.name, status: data.status, seasonId: data.seasonId });
            });
        } catch (error) {
            console.error('[SeasonManager] Error loading tournament names:', error);
        }
    }

    _getAvailableTournamentOptions(season) {
        if (!this._allTournaments) return '';

        // Filter out tournaments already in this season or in another season
        return this._allTournaments
            .filter(t => {
                if (season.tournamentIds?.includes(t.id)) return false;
                if (t.seasonId && t.seasonId !== season.id) return false;
                return true;
            })
            .map(t => `<option value="${t.id}">${t.name || t.id} (${t.status || 'unknown'})</option>`)
            .join('');
    }
}
