/**
 * ActionExport — JSON/CSV Export Utility for Action Logs
 *
 * Downloads tournament action log entries as JSON or CSV files.
 * Read-only: never writes to Firestore.
 */

class ActionExport {

    /**
     * @param {Object} options
     * @param {Function} options.getFirebaseDB     - () => Firestore instance
     * @param {string|Function} options.tournamentId - Tournament ID or getter function
     * @param {Array}    [options.actions]           - Pre-loaded actions (avoids re-fetching)
     */
    constructor({ getFirebaseDB, tournamentId, actions }) {
        this._getDB = getFirebaseDB;
        this._getTournamentId = typeof tournamentId === 'function' ? tournamentId : () => tournamentId;
        this._preloadedActions = actions || null;
    }

    get _tournamentId() { return this._getTournamentId(); }

    // ------------------------------------------------------------------
    // Export Methods
    // ------------------------------------------------------------------

    async exportJSON() {
        const actions = await this._getActions();
        if (!actions.length) return;

        const data = actions.map(a => this._cleanEntry(a));
        const content = JSON.stringify(data, null, 2);
        this._downloadFile(content,
            `action-log-${this._tournamentId}-${Date.now()}.json`,
            'application/json');
    }

    async exportCSV() {
        const actions = await this._getActions();
        if (!actions.length) return;

        const headers = [
            'sequenceNumber', 'timestamp', 'actionType', 'category',
            'actor', 'roundNumber', 'phaseAtTime', 'undone', 'description'
        ];

        const rows = actions.map(a => {
            const ts = this._formatTimestamp(a.timestamp);
            const desc = this._describeAction(a);
            return [
                a.sequenceNumber,
                `"${ts}"`,
                `"${a.actionType || ''}"`,
                `"${a.category || ''}"`,
                `"${a.actor?.displayName || ''}"`,
                a.roundNumber || 0,
                `"${a.phaseAtTime || ''}"`,
                a.undone || false,
                `"${desc.replace(/"/g, '""')}"`
            ].join(',');
        });

        const content = headers.join(',') + '\n' + rows.join('\n');
        this._downloadFile(content,
            `action-log-${this._tournamentId}-${Date.now()}.csv`,
            'text/csv');
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    async _getActions() {
        if (this._preloadedActions) return this._preloadedActions;

        const db = this._getDB();
        if (!db || !this._tournamentId) return [];

        const actions = [];
        let lastDoc = null;

        while (true) {
            let query = db.collection('tournaments')
                .doc(this._tournamentId)
                .collection('actionLog')
                .orderBy('sequenceNumber', 'asc')
                .limit(500);

            if (lastDoc) query = query.startAfter(lastDoc);

            const snapshot = await query.get();
            if (snapshot.empty) break;

            snapshot.forEach(doc => {
                actions.push({ id: doc.id, ...doc.data() });
                lastDoc = doc;
            });

            if (snapshot.size < 500) break;
        }

        return actions;
    }

    _cleanEntry(entry) {
        // Remove Firestore-specific objects for clean JSON
        const clean = { ...entry };
        if (clean.timestamp?.toDate) {
            clean.timestamp = clean.timestamp.toDate().toISOString();
        }
        if (clean.undoneAt?.toDate) {
            clean.undoneAt = clean.undoneAt.toDate().toISOString();
        }
        return clean;
    }

    _formatTimestamp(ts) {
        if (!ts) return '';
        const date = ts.toDate ? ts.toDate() : new Date(ts);
        if (isNaN(date.getTime())) return '';
        return date.toISOString();
    }

    _describeAction(entry) {
        // Use ActionLogger.describeAction if available, otherwise fallback
        if (typeof ActionLogger !== 'undefined' && ActionLogger.describeAction) {
            return ActionLogger.describeAction(entry, {});
        }
        return entry.actionType || 'unknown';
    }

    _downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

window.ActionExport = ActionExport;
