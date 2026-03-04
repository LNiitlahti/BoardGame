/**
 * BackupManager
 *
 * Manages tournament state backups: manual create, auto-backup on round start,
 * list backups, and restore from backup.
 * Backups stored in Firestore subcollection: /tournaments/{id}/backups/{backupId}
 */
class BackupManager {

    /**
     * @param {Object} gameState - Shared mutable game state reference
     * @param {Object} deps
     * @param {Function}   deps.saveCallback       - () => Promise<void>
     * @param {Function}   deps.logActionCallback   - (actionType, category, payload, previousState) => void
     * @param {UIManager}  deps.uiManager
     * @param {Function}   deps.refreshCallback     - () => void (refresh display after restore)
     */
    constructor(gameState, { saveCallback, logActionCallback, uiManager, refreshCallback }) {
        this._gameState = gameState;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._ui = uiManager;
        this._refresh = refreshCallback || (() => {});
        this._backups = [];
    }

    // ------------------------------------------------------------------
    // Create Backup
    // ------------------------------------------------------------------

    /**
     * Create a backup snapshot of the current game state.
     * @param {string} trigger - What caused the backup ('manual', 'auto_round_start', etc.)
     * @param {string} [description] - Optional description
     */
    async createBackup(trigger, description) {
        const gs = this._gameState;
        if (!gs?.tournamentId) {
            this._ui?.showStatus('No tournament loaded', 'warning');
            return;
        }

        try {
            const tournamentRef = window.firebaseDB.collection('tournaments').doc(gs.tournamentId);
            const backupsRef = tournamentRef.collection('backups');

            // Create a clean snapshot (exclude transient fields)
            const snapshot = this._createCleanSnapshot(gs);

            const backupDoc = {
                snapshot,
                trigger,
                description: description || `${trigger} backup`,
                createdAt: new Date().toISOString(),
                roundNumber: gs.currentPhase?.roundNumber || gs.currentRound || 0,
                phaseName: gs.currentPhase?.name || 'unknown',
                gamesPlayed: gs.gamesPlayed || 0,
                teamCount: gs.teams?.length || 0
            };

            const docRef = await backupsRef.add(backupDoc);

            this._logAction('backup_created', 'admin', {
                backupId: docRef.id,
                trigger,
                description: backupDoc.description,
                roundNumber: backupDoc.roundNumber
            }, { backupId: docRef.id });

            this._ui?.showStatus(`Backup created: ${backupDoc.description}`, 'success');
            await this.listBackups(); // Refresh list
            return docRef.id;
        } catch (error) {
            console.error('Error creating backup:', error);
            this._ui?.showStatus('Error creating backup', 'error');
        }
    }

    /**
     * Auto-backup called at round_start.
     */
    async autoBackup() {
        const round = this._gameState.currentPhase?.roundNumber || 0;
        return this.createBackup('auto_round_start', `Round ${round} auto-backup`);
    }

    // ------------------------------------------------------------------
    // List Backups
    // ------------------------------------------------------------------

    async listBackups() {
        const gs = this._gameState;
        if (!gs?.tournamentId) return [];

        try {
            const tournamentRef = window.firebaseDB.collection('tournaments').doc(gs.tournamentId);
            const snapshot = await tournamentRef.collection('backups')
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();

            this._backups = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            this.renderBackupPanel();
            return this._backups;
        } catch (error) {
            console.error('Error listing backups:', error);
            return [];
        }
    }

    // ------------------------------------------------------------------
    // Restore from Backup
    // ------------------------------------------------------------------

    async restoreFromBackup(backupId) {
        const gs = this._gameState;
        if (!gs?.tournamentId) return;

        const backup = this._backups.find(b => b.id === backupId);
        if (!backup) {
            this._ui?.showStatus('Backup not found', 'error');
            return;
        }

        if (!confirm(`Restore from backup "${backup.description}"?\nThis will overwrite the current tournament state.`)) {
            return;
        }

        try {
            // Create a pre-restore backup first
            await this.createBackup('pre_restore', 'Auto-backup before restore');

            // Apply the snapshot
            const snapshot = backup.snapshot;
            if (!snapshot) {
                this._ui?.showStatus('Backup has no snapshot data', 'error');
                return;
            }

            // Merge snapshot into gameState (preserve tournamentId)
            const tournamentId = gs.tournamentId;
            Object.keys(gs).forEach(key => {
                if (key !== 'tournamentId') delete gs[key];
            });
            Object.assign(gs, snapshot, { tournamentId });

            await this._save();

            this._logAction('backup_restored', 'admin', {
                backupId,
                description: backup.description,
                restoredFromRound: backup.roundNumber
            }, { backupId });

            this._ui?.showStatus(`Restored from: ${backup.description}`, 'success');
            this._refresh();
        } catch (error) {
            console.error('Error restoring backup:', error);
            this._ui?.showStatus('Error restoring backup', 'error');
        }
    }

    // ------------------------------------------------------------------
    // Render Backup Panel
    // ------------------------------------------------------------------

    renderBackupPanel(containerId = 'backupPanel') {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this._backups.length === 0) {
            container.innerHTML = '<p class="queue-empty">No backups yet</p>';
            return;
        }

        container.innerHTML = this._backups.map(backup => {
            const date = new Date(backup.createdAt);
            const timeStr = date.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });
            const triggerBadge = backup.trigger === 'auto_round_start'
                ? '<span class="backup-badge auto">AUTO</span>'
                : backup.trigger === 'pre_restore'
                    ? '<span class="backup-badge pre-restore">PRE-RESTORE</span>'
                    : '<span class="backup-badge manual">MANUAL</span>';

            return `
                <div class="backup-item">
                    <div class="backup-item-info">
                        ${triggerBadge}
                        <span class="backup-item-desc">${backup.description || 'Backup'}</span>
                        <span class="backup-item-meta">R${backup.roundNumber || 0} | ${timeStr} ${dateStr}</span>
                    </div>
                    <button class="btn-small secondary" onclick="restoreFromBackup('${backup.id}')">Restore</button>
                </div>
            `;
        }).join('');
    }

    // ------------------------------------------------------------------
    // Clean Snapshot
    // ------------------------------------------------------------------

    _createCleanSnapshot(gs) {
        // Deep copy, excluding transient/computed fields
        const snapshot = JSON.parse(JSON.stringify(gs));

        // Remove fields that shouldn't be in backups
        delete snapshot.tournamentId;
        delete snapshot.onboarding; // Lives in subcollection
        delete snapshot.smartMatchState; // Session-specific

        return snapshot;
    }
}

window.BackupManager = BackupManager;
