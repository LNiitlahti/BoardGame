/**
 * ActionLogger — Structured Action Logging System
 *
 * Records every game-state-changing event to a Firestore subcollection
 * (/tournaments/{tournamentId}/actionLog/{logId}) with sequence numbers,
 * actor info, previous state snapshots, and undo tracking.
 *
 * Foundation for: undo/redo, replay, and audit features.
 *
 * DI: Receives getter functions (not direct refs) because tournamentId,
 * user, and gameState change over the session lifetime.
 */

class ActionLogger {

    /**
     * @param {Object} options
     * @param {Function} options.getFirebaseDB      - () => firestore instance
     * @param {Function} options.getTournamentId     - () => current tournament ID
     * @param {Function} options.getCurrentUser      - () => Firebase auth user
     * @param {Function} options.getCurrentUserRole  - () => 'god' | 'admin'
     * @param {Function} options.getGameState        - () => shared gameState ref
     */
    constructor({ getFirebaseDB, getTournamentId, getCurrentUser, getCurrentUserRole, getGameState }) {
        this._getDB = getFirebaseDB;
        this._getTournamentId = getTournamentId;
        this._getUser = getCurrentUser;
        this._getRole = getCurrentUserRole;
        this._getGameState = getGameState;

        this._unsubscribe = null;
        this._cachedEntries = [];
    }

    // ------------------------------------------------------------------
    // Core API
    // ------------------------------------------------------------------

    /**
     * Log a structured action to Firestore.
     * Uses a transaction to atomically increment the sequence counter.
     * Fire-and-forget: errors are caught and logged, never thrown.
     *
     * @param {string} actionType   - e.g. 'match_result_confirmed', 'plate_placed'
     * @param {string} category     - 'match' | 'board' | 'spell' | 'points' | 'phase' | 'admin'
     * @param {Object} payload      - Action-specific data
     * @param {Object|null} previousState - Snapshot of what was changed (for undo)
     */
    async logAction(actionType, category, payload = {}, previousState = null) {
        const tournamentId = this._getTournamentId();
        const db = this._getDB();
        if (!tournamentId || !db) return;

        try {
            const tournamentRef = db.collection('tournaments').doc(tournamentId);
            const actionLogRef = tournamentRef.collection('actionLog').doc();

            const user = this._getUser();
            const role = this._getRole();
            const gs = this._getGameState();

            const actor = {
                type: role || 'admin',
                userId: user?.uid || null,
                displayName: user?.displayName || user?.email || 'Unknown'
            };

            await db.runTransaction(async (transaction) => {
                const tournamentDoc = await transaction.get(tournamentRef);
                const currentSeq = tournamentDoc.data()?.actionLogSequence || 0;
                const nextSeq = currentSeq + 1;

                const entry = {
                    sequenceNumber: nextSeq,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    actor,
                    actionType,
                    category,
                    payload: this._cleanObject(payload),
                    previousState: previousState ? this._cleanObject(previousState) : null,
                    roundNumber: gs?.currentRound || 0,
                    phaseAtTime: gs?.status || 'unknown',
                    undone: false,
                    undoneBy: null,
                    undoneAt: null
                };

                transaction.update(tournamentRef, { actionLogSequence: nextSeq });
                transaction.set(actionLogRef, entry);
            });
        } catch (error) {
            console.error('[ActionLogger] Error logging action:', error, { actionType, category });
        }
    }

    // ------------------------------------------------------------------
    // Query API
    // ------------------------------------------------------------------

    /**
     * Query actions with optional filters.
     *
     * @param {Object} filters
     * @param {string}  [filters.category]     - Filter by category
     * @param {string}  [filters.actionType]   - Filter by action type
     * @param {number}  [filters.roundNumber]  - Filter by round
     * @param {string}  [filters.teamId]       - Filter payload for team involvement
     * @param {number}  [filters.limit]        - Max entries (default 50)
     * @param {*}       [filters.startAfter]   - Firestore doc snapshot for pagination
     * @returns {Promise<{entries: Array, lastDoc: *}>}
     */
    async getActions(filters = {}) {
        const tournamentId = this._getTournamentId();
        const db = this._getDB();
        if (!tournamentId || !db) return { entries: [], lastDoc: null };

        try {
            let query = db
                .collection('tournaments')
                .doc(tournamentId)
                .collection('actionLog')
                .orderBy('sequenceNumber', 'desc');

            if (filters.category) {
                query = query.where('category', '==', filters.category);
            }
            if (filters.actionType) {
                query = query.where('actionType', '==', filters.actionType);
            }
            if (filters.roundNumber !== undefined) {
                query = query.where('roundNumber', '==', filters.roundNumber);
            }

            const limit = filters.limit || 50;
            query = query.limit(limit);

            if (filters.startAfter) {
                query = query.startAfter(filters.startAfter);
            }

            const snapshot = await query.get();
            const entries = [];
            let lastDoc = null;

            snapshot.forEach(doc => {
                entries.push({ id: doc.id, ...doc.data() });
                lastDoc = doc;
            });

            // Client-side team filter (Firestore can't query inside payload)
            if (filters.teamId) {
                const tid = String(filters.teamId);
                return {
                    entries: entries.filter(e => this._entryInvolvesTeam(e, tid)),
                    lastDoc
                };
            }

            return { entries, lastDoc };
        } catch (error) {
            console.error('[ActionLogger] Error querying actions:', error);
            return { entries: [], lastDoc: null };
        }
    }

    /**
     * Get actions by sequence number range (for replay).
     *
     * @param {number} from - Start sequence number (inclusive)
     * @param {number} to   - End sequence number (inclusive)
     * @returns {Promise<Array>}
     */
    async getActionsBySequence(from, to) {
        const tournamentId = this._getTournamentId();
        const db = this._getDB();
        if (!tournamentId || !db) return [];

        try {
            const snapshot = await db
                .collection('tournaments')
                .doc(tournamentId)
                .collection('actionLog')
                .where('sequenceNumber', '>=', from)
                .where('sequenceNumber', '<=', to)
                .orderBy('sequenceNumber', 'asc')
                .get();

            const entries = [];
            snapshot.forEach(doc => {
                entries.push({ id: doc.id, ...doc.data() });
            });
            return entries;
        } catch (error) {
            console.error('[ActionLogger] Error querying by sequence:', error);
            return [];
        }
    }

    /**
     * Mark an action as undone.
     *
     * @param {string} logId     - ID of the action to mark as undone
     * @param {string} undoLogId - ID of the undo action that reversed it
     */
    async markUndone(logId, undoLogId) {
        const tournamentId = this._getTournamentId();
        const db = this._getDB();
        if (!tournamentId || !db || !logId) return;

        try {
            await db
                .collection('tournaments')
                .doc(tournamentId)
                .collection('actionLog')
                .doc(logId)
                .update({
                    undone: true,
                    undoneBy: undoLogId,
                    undoneAt: firebase.firestore.FieldValue.serverTimestamp()
                });
        } catch (error) {
            console.error('[ActionLogger] Error marking action as undone:', error);
        }
    }

    // ------------------------------------------------------------------
    // Real-time listener (for Activity Log tab)
    // ------------------------------------------------------------------

    /**
     * Subscribe to real-time action log updates.
     *
     * @param {Function} callback - (entries: Array) => void, called on every change
     * @param {Object}   [options]
     * @param {number}   [options.limit=50]     - Max entries to keep
     * @param {string}   [options.category]     - Filter by category
     * @returns {Function} unsubscribe function
     */
    subscribe(callback, options = {}) {
        this.unsubscribe();

        const tournamentId = this._getTournamentId();
        const db = this._getDB();
        if (!tournamentId || !db) return () => {};

        const limit = options.limit || 50;

        let query = db
            .collection('tournaments')
            .doc(tournamentId)
            .collection('actionLog')
            .orderBy('sequenceNumber', 'desc')
            .limit(limit);

        if (options.category) {
            query = query.where('category', '==', options.category);
        }

        this._unsubscribe = window.firebaseOnSnapshot(query, (snapshot) => {
            const entries = [];
            snapshot.forEach(doc => {
                entries.push({ id: doc.id, ...doc.data() });
            });
            this._cachedEntries = entries;
            callback(entries);
        }, (error) => {
            console.error('[ActionLogger] Listener error:', error);
        });

        return this._unsubscribe;
    }

    /**
     * Unsubscribe from real-time updates.
     */
    unsubscribe() {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
    }

    /**
     * Get cached entries from the last listener update.
     * @returns {Array}
     */
    getCachedEntries() {
        return this._cachedEntries;
    }

    // ------------------------------------------------------------------
    // Human-readable descriptions
    // ------------------------------------------------------------------

    /**
     * Convert a log entry into a human-readable description string.
     *
     * @param {Object} entry     - The action log entry
     * @param {Object} gameState - Current gameState (for name lookups)
     * @returns {string}
     */
    static describeAction(entry, gameState) {
        const p = entry.payload || {};
        const teams = gameState?.teams || [];

        const teamName = (id) => {
            if (p.teamName) return p.teamName;
            const t = teams.find(t => String(t.id) === String(id));
            return t?.name || `Team ${id}`;
        };

        const gameName = (id) => {
            if (p.gameName) return p.gameName;
            if (typeof getGameDisplayName === 'function') return getGameDisplayName(id);
            return id || 'Unknown Game';
        };

        switch (entry.actionType) {
            // Match
            case 'match_created':
                return `Match created: ${gameName(p.game)}${p.isChallenge ? ' (challenge)' : ''}${p.autoGenerated ? ' (auto)' : ''}`;
            case 'match_started':
                return `Match started: ${gameName(p.game)}${p.matchNumber ? ` #${p.matchNumber}` : ''}`;
            case 'match_result_confirmed':
                return `${gameName(p.gameName || p.game)} result: ${teamName(p.teamId)} won${p.matchNumber ? ` (Match #${p.matchNumber})` : ''}`;
            case 'match_result_corrected':
                return `Match${p.matchNumber ? ` #${p.matchNumber}` : ''} result corrected: ${p.oldWinningSide || '?'} → ${p.newWinningSide || '?'}${p.reason ? ` (${p.reason})` : ''}`;
            case 'match_details_edited':
                return `Match edited${p.matchId ? ` (${p.matchId})` : ''}`;
            case 'match_removed':
                return `Match removed from queue${p.game ? `: ${gameName(p.game)}` : ''}`;

            // Board
            case 'plate_placed':
                return `${teamName(p.teamId)} placed plate at ${p.hexCoord || p.coord}${p.isHeart ? ' (heart hex!)' : ''}`;
            case 'plate_removed':
                return `Plate removed at ${p.hexCoord || p.coord}`;
            case 'heart_hex_captured':
                return `${teamName(p.newOwnerTeamId)} captured heart hex ${p.hexCoord}`;
            case 'room_hex_assigned':
                return `Room hex assigned: ${p.hexCoord}`;
            case 'room_hex_removed':
                return `Room hex removed: ${p.hexCoord}`;

            // Points
            case 'points_awarded':
                return `${teamName(p.teamId)} ${p.amount >= 0 ? 'gained' : 'lost'} ${Math.abs(p.amount)} points (${p.reason || 'manual'})`;
            case 'points_corrected':
                return `${teamName(p.teamId)} points corrected: ${p.oldPoints} → ${p.newPoints}`;

            // Phase
            case 'phase_advanced':
                return `Phase changed: ${p.fromPhase || '?'} → ${p.toPhase || '?'}`;
            case 'round_started':
                return `Round ${p.roundNumber || '?'} started`;
            case 'break_started':
                return `Break added to queue${p.breakType ? ` (${p.breakType})` : ''}`;
            case 'break_ended':
                return `Break completed`;
            case 'lobby_reset':
                return `Lobby readiness reset for round ${p.roundNumber || '?'}`;
            case 'force_all_ready':
                return `Admin forced all ${p.playerCount || '?'} players ready`;

            // Admin
            case 'tournament_created':
                return `Tournament created: ${p.name || ''}`;
            case 'admin_override':
                return `Admin override: ${p.description || 'stats recalculated'}`;
            case 'queue_cleared':
                return `Match queue cleared (${p.removedCount || '?'} matches removed)`;
            case 'team_renamed':
                return `Team renamed: ${p.oldName || '?'} → ${p.newName || '?'}`;
            case 'team_color_changed':
                return `${teamName(p.teamId)} color changed`;
            case 'player_added':
                return `Player "${p.playerName || '?'}" added to ${teamName(p.teamId)}`;
            case 'player_removed':
                return `Player "${p.playerName || '?'}" removed from ${teamName(p.teamId)}`;
            case 'player_renamed':
                return `Player renamed: ${p.oldName || '?'} → ${p.newName || '?'}`;
            case 'seating_changed':
                return `Seating order changed`;
            case 'seating_reset':
                return `Seating order reset`;
            case 'game_added':
                return `Game added to tournament: ${gameName(p.gameId)}`;
            case 'game_removed':
                return `Game removed from tournament: ${gameName(p.gameId)}`;

            // Spell
            case 'spell_cast':
                return `Spell cast: ${p.spellName || p.spellId || '?'}`;
            case 'spell_piles_initialized':
                return `Spell piles created: ${p.cardsPerTeam || '?'} cards per team`;
            case 'spell_drawn_from_pile':
                return `Team drew ${p.drawCount || 1} spell(s)`;
            case 'spell_distributed':
                return `Spell distributed${p.method === 'admin_random' ? ` (random, ${p.spellsPerTeam}/team)` : ''}`;
            case 'spell_removed_admin':
                return `Spell removed from team by admin`;
            case 'spell_phase_started':
                return `Spell phase started (Round ${p.roundNumber || '?'})`;
            case 'spell_turn_skipped':
                return `Spell turn skipped for ${teamName(p.teamId)}`;
            case 'spell_phase_forced_end':
                return `Spell phase force-ended by admin`;
            case 'spell_board_effect':
                return `Spell board effect: ${p.spellId || '?'} (${(p.destroyedTiles || []).length} tiles destroyed)`;
            case 'spell_pile_recycled':
                return `Spell pile recycled for ${teamName(p.teamId)}`;
            case 'condition_expired':
                return `Condition expired: ${p.spellName || '?'}`;
            case 'condition_removed':
                return `Condition removed: ${p.spellName || '?'}`;

            // Backup
            case 'backup_created':
                return `Backup created: ${p.description || 'manual'}`;
            case 'backup_restored':
                return `Restored from backup: ${p.description || '?'}`;

            // Undo
            case 'action_undone':
                return `Action undone: ${p.originalActionType || '?'}`;

            default:
                return `${entry.actionType || 'Unknown action'}`;
        }
    }

    /**
     * Get a CSS class suffix for a category badge.
     * @param {string} category
     * @returns {string}
     */
    static categoryBadgeClass(category) {
        const map = {
            match: 'match',
            board: 'board',
            spell: 'spell',
            points: 'points',
            phase: 'phase',
            admin: 'admin'
        };
        return map[category] || 'default';
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /**
     * Check if a log entry involves a specific team.
     * Searches common payload fields for the team ID.
     */
    _entryInvolvesTeam(entry, teamId) {
        const p = entry.payload || {};
        const tid = String(teamId);

        if (String(p.teamId) === tid) return true;
        if (String(p.newOwnerTeamId) === tid) return true;
        if (String(p.previousOwnerTeamId) === tid) return true;
        if (String(p.castingTeamId) === tid) return true;
        if (String(p.targetTeamId) === tid) return true;

        if (Array.isArray(p.winningTeamIds) && p.winningTeamIds.some(id => String(id) === tid)) return true;
        if (Array.isArray(p.teamsWithFullCredit) && p.teamsWithFullCredit.some(id => String(id) === tid)) return true;
        if (Array.isArray(p.sides)) {
            for (const side of p.sides) {
                if (Array.isArray(side.teamIds) && side.teamIds.some(id => String(id) === tid)) return true;
            }
        }

        return false;
    }

    /**
     * Remove undefined values from an object (Firestore rejects undefined).
     */
    _cleanObject(obj) {
        if (obj === null || obj === undefined) return null;
        if (typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            return obj.map(item => this._cleanObject(item)).filter(item => item !== undefined);
        }
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
                cleaned[key] = this._cleanObject(value);
            }
        }
        return cleaned;
    }
}

window.ActionLogger = ActionLogger;
