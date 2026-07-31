/**
 * ReplayEngine — Backup-Anchored Forward Replay
 *
 * Reconstructs tournament state at any point in time using:
 * 1. Backup snapshots as keyframes (full gameState at round boundaries)
 * 2. Action log entries forward-applied between keyframes
 *
 * DI: Receives Firebase getter + tournamentId + callbacks.
 * Read-only: never writes to Firestore.
 */

class ReplayEngine {

    /**
     * @param {Object} options
     * @param {Function} options.getFirebaseDB    - () => Firestore instance
     * @param {string}   options.tournamentId     - Tournament ID
     * @param {Function} [options.onStateChanged] - (state, currentAction, progress) => void
     * @param {Function} [options.onLoadProgress] - (phase, percent) => void
     */
    constructor({ getFirebaseDB, tournamentId, onStateChanged, onLoadProgress }) {
        this._getDB = getFirebaseDB;
        this._tournamentId = tournamentId;
        this._onStateChanged = onStateChanged || (() => {});
        this._onLoadProgress = onLoadProgress || (() => {});

        // Loaded data
        this._tournamentDoc = null;   // Final tournament document
        this._backups = [];           // Sorted by createdAt ASC: { id, snapshot, roundNumber, createdAt, mappedSeq }
        this._actions = [];           // Sorted by sequenceNumber ASC: { id, sequenceNumber, ... }

        // Timeline index
        this._roundBoundaries = [];   // [{ roundNumber, startSeq, endSeq, backupId, backupIndex }]

        // Playback state
        this._currentIndex = -1;      // Index into _actions array
        this._currentState = null;    // Reconstructed state at current position
        this._isPlaying = false;
        this._speed = 1;
        this._playTimer = null;

        // LRU state cache for stepBackward performance
        this._stateCache = new Map();
        this._stateCacheOrder = [];
        this._stateCacheMax = 20;

        this._loaded = false;
    }

    // ------------------------------------------------------------------
    // Data Loading
    // ------------------------------------------------------------------

    async loadTournamentData() {
        const db = this._getDB();
        if (!db || !this._tournamentId) throw new Error('No database or tournament ID');

        const tournamentRef = db.collection('tournaments').doc(this._tournamentId);

        // Load tournament doc
        this._onLoadProgress('tournament', 0);
        const docSnap = await tournamentRef.get();
        if (!docSnap.exists) throw new Error('Tournament not found');
        this._tournamentDoc = docSnap.data();
        this._onLoadProgress('tournament', 100);

        // Load backups
        this._onLoadProgress('backups', 0);
        await this._loadBackups(tournamentRef);
        this._onLoadProgress('backups', 100);

        // Load all action log entries
        this._onLoadProgress('actions', 0);
        await this._loadAllActions(tournamentRef);
        this._onLoadProgress('actions', 100);

        // Build timeline
        this._onLoadProgress('timeline', 0);
        this._buildTimeline();
        this._onLoadProgress('timeline', 100);

        this._loaded = true;
    }

    async _loadBackups(tournamentRef) {
        const snapshot = await tournamentRef.collection('backups')
            .orderBy('createdAt', 'asc')
            .get();

        this._backups = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.snapshot) {
                this._backups.push({
                    id: doc.id,
                    snapshot: data.snapshot,
                    roundNumber: data.roundNumber || 0,
                    phaseName: data.phaseName || 'unknown',
                    createdAt: data.createdAt,
                    trigger: data.trigger,
                    mappedSeq: -1  // Filled in _buildTimeline
                });
            }
        });
    }

    async _loadAllActions(tournamentRef) {
        this._actions = [];
        let lastDoc = null;
        const batchSize = 500;
        let loaded = 0;
        // Counter may be on tournament doc (legacy) or in meta/actionLogCounter subcollection
        let total = this._tournamentDoc.actionLogSequence || 0;
        if (!total) {
            try {
                const counterDoc = await tournamentRef.collection('meta').doc('actionLogCounter').get();
                total = counterDoc.exists ? (counterDoc.data()?.seq || 0) : 0;
            } catch (e) { /* fallback to 0 */ }
        }

        while (true) {
            let query = tournamentRef.collection('actionLog')
                .orderBy('sequenceNumber', 'asc')
                .limit(batchSize);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            if (snapshot.empty) break;

            snapshot.forEach(doc => {
                this._actions.push({ id: doc.id, ...doc.data() });
                lastDoc = doc;
            });

            loaded += snapshot.size;
            if (total > 0) {
                this._onLoadProgress('actions', Math.min(99, Math.round((loaded / total) * 100)));
            }

            if (snapshot.size < batchSize) break;
        }
    }

    /**
     * Build timeline: map backups to sequence numbers and compute round boundaries.
     */
    _buildTimeline() {
        // Map each backup to its nearest action sequence number
        for (const backup of this._backups) {
            backup.mappedSeq = this._findSequenceForBackup(backup);
        }

        // Sort backups by mapped sequence (should already be in order)
        this._backups.sort((a, b) => a.mappedSeq - b.mappedSeq);

        // Build round boundaries from phase_advanced actions
        this._roundBoundaries = [];
        let currentRound = 0;
        let roundStartSeq = 0;

        for (let i = 0; i < this._actions.length; i++) {
            const action = this._actions[i];
            if (action.actionType === 'phase_advanced' && action.payload?.toPhase === 'scoring_vp') {
                // Close previous round
                if (currentRound > 0) {
                    const lastBoundary = this._roundBoundaries[this._roundBoundaries.length - 1];
                    if (lastBoundary) lastBoundary.endSeq = action.sequenceNumber - 1;
                }

                currentRound = action.payload.roundNumber || (currentRound + 1);
                roundStartSeq = action.sequenceNumber;

                // Find matching backup
                const matchingBackup = this._backups.find(b =>
                    b.roundNumber === currentRound && b.trigger === 'auto_round_start'
                );

                this._roundBoundaries.push({
                    roundNumber: currentRound,
                    startSeq: roundStartSeq,
                    endSeq: null, // Filled when next round starts
                    backupId: matchingBackup?.id || null,
                    backupIndex: matchingBackup ? this._backups.indexOf(matchingBackup) : -1
                });
            }
        }

        // Close final round
        if (this._roundBoundaries.length > 0 && this._actions.length > 0) {
            const lastBoundary = this._roundBoundaries[this._roundBoundaries.length - 1];
            if (lastBoundary && lastBoundary.endSeq === null) {
                lastBoundary.endSeq = this._actions[this._actions.length - 1].sequenceNumber;
            }
        }
    }

    /**
     * Find the sequence number closest to when a backup was created.
     */
    _findSequenceForBackup(backup) {
        if (!backup.createdAt || this._actions.length === 0) return 0;

        const backupTime = new Date(backup.createdAt).getTime();

        // Find the action with timestamp closest to (but not after) backup creation
        // Also consider scoring_vp actions matching the backup's round number
        let bestMatch = 0;
        let bestTimeDiff = Infinity;

        for (const action of this._actions) {
            // Prefer exact round match with scoring_vp phase (start of round)
            if (action.actionType === 'phase_advanced' &&
                action.payload?.toPhase === 'scoring_vp' &&
                (action.payload?.roundNumber === backup.roundNumber ||
                 action.roundNumber === backup.roundNumber)) {
                return action.sequenceNumber;
            }

            // Fallback: closest timestamp
            const actionTime = action.timestamp?.toDate?.()
                ? action.timestamp.toDate().getTime()
                : new Date(action.timestamp).getTime();

            if (!isNaN(actionTime)) {
                const diff = Math.abs(actionTime - backupTime);
                if (diff < bestTimeDiff) {
                    bestTimeDiff = diff;
                    bestMatch = action.sequenceNumber;
                }
            }
        }

        return bestMatch;
    }

    // ------------------------------------------------------------------
    // Timeline API
    // ------------------------------------------------------------------

    get loaded() { return this._loaded; }
    get totalActions() { return this._actions.length; }
    get currentIndex() { return this._currentIndex; }
    get currentAction() { return this._actions[this._currentIndex] || null; }
    get currentState() { return this._currentState; }
    get maxSequenceNumber() {
        return this._actions.length > 0
            ? this._actions[this._actions.length - 1].sequenceNumber
            : 0;
    }
    get minSequenceNumber() {
        return this._actions.length > 0 ? this._actions[0].sequenceNumber : 0;
    }
    get isPlaying() { return this._isPlaying; }
    get speed() { return this._speed; }
    get actions() { return this._actions; }
    get roundBoundaries() { return this._roundBoundaries; }
    get tournamentName() { return this._tournamentDoc?.name || 'Unknown Tournament'; }
    get tournamentDoc() { return this._tournamentDoc; }
    get backups() { return this._backups; }

    /**
     * Get the action at a given index (0-based into _actions array).
     */
    getActionAtIndex(index) {
        return this._actions[index] || null;
    }

    /**
     * Find the index in _actions for a given sequence number.
     */
    _seqToIndex(seqNum) {
        // Binary search since actions are sorted by sequenceNumber
        let lo = 0, hi = this._actions.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const midSeq = this._actions[mid].sequenceNumber;
            if (midSeq === seqNum) return mid;
            if (midSeq < seqNum) lo = mid + 1;
            else hi = mid - 1;
        }
        // Return closest index at or before seqNum
        return Math.max(0, hi);
    }

    // ------------------------------------------------------------------
    // Playback Controls
    // ------------------------------------------------------------------

    /**
     * Seek to a specific sequence number. Reconstructs state at that point.
     */
    seekToAction(sequenceNumber) {
        if (!this._loaded || this._actions.length === 0) return;

        const index = this._seqToIndex(sequenceNumber);
        this._currentIndex = index;
        this._currentState = this._getStateAtIndex(index);

        const action = this._actions[index];
        this._onStateChanged(this._currentState, action, this._getProgress());
    }

    /**
     * Seek to the start of a round (uses backup keyframe if available).
     */
    seekToRound(roundNumber) {
        const boundary = this._roundBoundaries.find(b => b.roundNumber === roundNumber);
        if (boundary) {
            this.seekToAction(boundary.startSeq);
        }
    }

    /**
     * Step forward one action.
     */
    stepForward() {
        if (!this._loaded) return;
        const nextIndex = this._currentIndex + 1;
        if (nextIndex >= this._actions.length) return;

        this._currentIndex = nextIndex;
        this._currentState = this._getStateAtIndex(nextIndex);

        const action = this._actions[nextIndex];
        this._onStateChanged(this._currentState, action, this._getProgress());
    }

    /**
     * Step backward one action.
     */
    stepBackward() {
        if (!this._loaded) return;
        const prevIndex = this._currentIndex - 1;
        if (prevIndex < 0) return;

        this._currentIndex = prevIndex;
        this._currentState = this._getStateAtIndex(prevIndex);

        const action = this._actions[prevIndex];
        this._onStateChanged(this._currentState, action, this._getProgress());
    }

    /**
     * Start auto-playback at current speed.
     */
    play() {
        if (this._isPlaying) return;
        this._isPlaying = true;
        this._scheduleNextStep();
    }

    /**
     * Pause auto-playback.
     */
    pause() {
        this._isPlaying = false;
        if (this._playTimer) {
            clearTimeout(this._playTimer);
            this._playTimer = null;
        }
    }

    /**
     * Set playback speed multiplier.
     * @param {number} multiplier - 1, 2, 5, or 10
     */
    setSpeed(multiplier) {
        this._speed = multiplier;
        // If playing, restart timer with new interval
        if (this._isPlaying) {
            if (this._playTimer) clearTimeout(this._playTimer);
            this._scheduleNextStep();
        }
    }

    /**
     * Toggle play/pause.
     * @returns {boolean} New isPlaying state
     */
    togglePlayback() {
        if (this._isPlaying) {
            this.pause();
        } else {
            this.play();
        }
        return this._isPlaying;
    }

    _scheduleNextStep() {
        if (!this._isPlaying) return;

        const interval = Math.round(1500 / this._speed);
        this._playTimer = setTimeout(() => {
            if (!this._isPlaying) return;

            if (this._currentIndex >= this._actions.length - 1) {
                // Reached end
                this.pause();
                return;
            }

            this.stepForward();
            this._scheduleNextStep();
        }, interval);
    }

    _getProgress() {
        const total = this._actions.length;
        if (total === 0) return { index: 0, total: 0, percent: 0, sequenceNumber: 0 };
        const action = this._actions[this._currentIndex];
        return {
            index: this._currentIndex,
            total,
            percent: Math.round((this._currentIndex / (total - 1)) * 100),
            sequenceNumber: action?.sequenceNumber || 0,
            roundNumber: action?.roundNumber || 0,
            phase: action?.phaseAtTime || ''
        };
    }

    // ------------------------------------------------------------------
    // State Reconstruction (Core Algorithm)
    // ------------------------------------------------------------------

    /**
     * Get reconstructed state at a given action index.
     * Uses LRU cache and backup-anchored forward replay.
     */
    _getStateAtIndex(targetIndex) {
        // Check cache
        const cached = this._stateCache.get(targetIndex);
        if (cached) return this._deepClone(cached);

        // Find nearest backup at or before targetIndex
        const { baseState, startIndex } = this._findBaseState(targetIndex);

        // Forward-apply actions from startIndex+1 to targetIndex
        const state = baseState;
        for (let i = startIndex + 1; i <= targetIndex; i++) {
            const action = this._actions[i];
            if (action && !action.undone) {
                this._applyAction(state, action);
            }
        }

        // Cache the result
        this._cacheState(targetIndex, state);

        return this._deepClone(state);
    }

    /**
     * Find the best base state to start forward-applying from.
     * Priority: cached state > backup snapshot > initial empty state.
     */
    _findBaseState(targetIndex) {
        // Check cache for nearest prior state
        let bestCacheIndex = -1;
        for (const cachedIndex of this._stateCacheOrder) {
            if (cachedIndex <= targetIndex && cachedIndex > bestCacheIndex) {
                bestCacheIndex = cachedIndex;
            }
        }

        // Check backups for nearest prior snapshot
        let bestBackup = null;
        let bestBackupActionIndex = -1;
        const targetSeq = this._actions[targetIndex]?.sequenceNumber || 0;

        for (const backup of this._backups) {
            if (backup.mappedSeq <= targetSeq) {
                const backupActionIndex = this._seqToIndex(backup.mappedSeq);
                if (backupActionIndex > bestBackupActionIndex) {
                    bestBackupActionIndex = backupActionIndex;
                    bestBackup = backup;
                }
            }
        }

        // Pick whichever is closer to target
        if (bestCacheIndex >= 0 && bestCacheIndex >= bestBackupActionIndex) {
            return {
                baseState: this._deepClone(this._stateCache.get(bestCacheIndex)),
                startIndex: bestCacheIndex
            };
        }

        if (bestBackup) {
            return {
                baseState: this._deepClone(bestBackup.snapshot),
                startIndex: bestBackupActionIndex
            };
        }

        // No backup available — start from empty state (degraded mode)
        return {
            baseState: this._createInitialState(),
            startIndex: -1
        };
    }

    /**
     * Create an initial empty state for tournaments without backups.
     */
    _createInitialState() {
        return {
            teams: [],
            board: {},
            heartHexControl: {},
            rooms: [],
            gameQueue: [],
            gameHistory: [],
            currentPhase: { name: 'pre_game_setup', roundNumber: 0, startedAt: '' },
            currentRound: 0,
            gamesPlayed: 0,
            status: 'setup',
            lobbyReady: {},
            breakSettings: { intervalRounds: 2, roundsSinceLastBreak: 0 },
            pointsHistory: [],
            spellPiles: {},
            spellPhase: {},
            activeEffects: [],
            spellHistory: [],
            selectedGames: [],
            gameDefinitions: {},
            players: {},
            seatingOrder: [],
            smartMatchState: {},
            broadcastMessage: null,
            ceremonyState: null,
            displayOverride: null,
            spellDefinitions: {}
        };
    }

    // ------------------------------------------------------------------
    // LRU State Cache
    // ------------------------------------------------------------------

    _cacheState(index, state) {
        if (this._stateCache.has(index)) {
            // Move to end of order
            this._stateCacheOrder = this._stateCacheOrder.filter(i => i !== index);
        } else if (this._stateCacheOrder.length >= this._stateCacheMax) {
            // Evict oldest
            const evict = this._stateCacheOrder.shift();
            this._stateCache.delete(evict);
        }
        this._stateCache.set(index, this._deepClone(state));
        this._stateCacheOrder.push(index);
    }

    // ------------------------------------------------------------------
    // Forward-Apply Dispatch
    // ------------------------------------------------------------------

    /**
     * Apply a single action's mutations to the state object.
     */
    _applyAction(state, action) {
        const p = action.payload || {};

        switch (action.actionType) {
            // Board
            case 'plate_placed':
                this._applyPlatePlaced(state, p);
                break;
            case 'plate_removed':
                this._applyPlateRemoved(state, p);
                break;
            case 'room_hex_assigned':
                this._applyRoomHexAssigned(state, p);
                break;
            case 'room_hex_removed':
                this._applyRoomHexRemoved(state, p);
                break;
            case 'heart_hex_captured':
                this._applyHeartHexCaptured(state, p);
                break;

            // Match
            case 'match_created':
                this._applyMatchCreated(state, p);
                break;
            case 'match_started':
                this._applyMatchStarted(state, p);
                break;
            case 'match_result_confirmed':
                this._applyMatchResultConfirmed(state, p);
                break;
            case 'match_removed':
                this._applyMatchRemoved(state, p);
                break;
            case 'match_result_corrected':
                this._applyMatchResultCorrected(state, p, action.previousState);
                break;
            case 'match_details_edited':
                // Descriptive — payload doesn't carry full edit data
                break;

            // Points
            case 'points_awarded':
                this._applyPointsAwarded(state, p, action);
                break;
            case 'points_corrected':
                this._applyPointsCorrected(state, p);
                break;

            // Phase
            case 'phase_advanced':
                this._applyPhaseAdvanced(state, p);
                break;
            case 'break_started':
                this._applyBreakStarted(state, p, action.previousState);
                break;
            case 'break_ended':
                this._applyBreakEnded(state, p);
                break;
            case 'break_auto_inserted':
                this._applyBreakAutoInserted(state, p);
                break;
            case 'lobby_reset':
                state.lobbyReady = {};
                break;
            case 'slot_advanced':
                this._applySlotAdvanced(state, p);
                break;

            // Team / Admin
            case 'team_renamed':
                this._applyTeamRenamed(state, p);
                break;
            case 'team_color_changed':
                this._applyTeamColorChanged(state, p);
                break;
            case 'player_added':
                this._applyPlayerAdded(state, p);
                break;
            case 'player_removed':
                this._applyPlayerRemoved(state, p);
                break;
            case 'queue_cleared':
                state.gameQueue = (state.gameQueue || []).filter(m =>
                    m.status === 'ongoing' || m.status === 'completed'
                );
                break;

            // Spell
            case 'spell_piles_initialized':
                this._applySpellPilesInitialized(state, p);
                break;
            case 'spell_drawn_from_pile':
                this._applySpellDrawn(state, p);
                break;
            case 'spell_phase_started':
                this._applySpellPhaseStarted(state, p);
                break;
            case 'spell_board_effect':
                this._applySpellBoardEffect(state, p);
                break;
            case 'condition_expired':
            case 'condition_removed':
                this._applyConditionRemoved(state, p);
                break;
            case 'spell_turn_skipped':
                this._applySpellTurnSkipped(state, p);
                break;
            case 'spell_phase_forced_end':
                if (state.spellPhase) state.spellPhase.isActive = false;
                break;

            // All other types are descriptive-only (no state mutation needed)
            default:
                break;
        }
    }

    // ------------------------------------------------------------------
    // Board Action Handlers
    // ------------------------------------------------------------------

    _applyPlatePlaced(state, p) {
        const coord = p.hexCoord || p.coord;
        if (!coord) return;
        state.board = state.board || {};
        state.board[coord] = p.teamId;

        if (p.isHeart) {
            state.heartHexControl = state.heartHexControl || {};
            state.heartHexControl[coord] = p.teamId;
        }
    }

    _applyPlateRemoved(state, p) {
        const coord = p.hexCoord || p.coord;
        if (!coord) return;
        if (state.board) delete state.board[coord];
        if (state.heartHexControl?.[coord]) delete state.heartHexControl[coord];
    }

    _applyRoomHexAssigned(state, p) {
        state.rooms = state.rooms || [];
        const coord = p.hexCoord || p.coord;
        if (coord && !state.rooms.includes(coord)) {
            state.rooms.push(coord);
        }
    }

    _applyRoomHexRemoved(state, p) {
        const coord = p.hexCoord || p.coord;
        if (coord) {
            state.rooms = (state.rooms || []).filter(c => c !== coord);
        }
    }

    _applyHeartHexCaptured(state, p) {
        state.heartHexControl = state.heartHexControl || {};
        if (p.hexCoord) {
            state.heartHexControl[p.hexCoord] = p.newOwnerTeamId;
        }
    }

    // ------------------------------------------------------------------
    // Match Action Handlers
    // ------------------------------------------------------------------

    _applyMatchCreated(state, p) {
        state.gameQueue = state.gameQueue || [];
        // Reconstruct a minimal queue entry from payload
        const entry = {
            id: p.matchId || Date.now(),
            matchNumber: p.matchNumber,
            game: p.game,
            playType: p.playType,
            isChallenge: p.isChallenge || false,
            teams: p.sides || p.teams || [],
            status: 'pending',
            createdAt: p.createdAt || new Date().toISOString()
        };
        state.gameQueue.push(entry);
    }

    _applyMatchStarted(state, p) {
        const match = (state.gameQueue || []).find(m =>
            m.id === p.matchId || m.matchNumber === p.matchNumber
        );
        if (match) {
            match.status = 'ongoing';
            match.startedAt = p.startedAt || new Date().toISOString();
        }
    }

    _applyMatchResultConfirmed(state, p) {
        // Find the queue entry
        const match = (state.gameQueue || []).find(m =>
            m.id === p.matchId || m.matchNumber === p.matchNumber
        );

        if (match) {
            match.status = 'completed';
            match.completedAt = new Date().toISOString();
            match.winningSide = p.winningSide;
            match.winnerIndex = p.winnerIndex;
        }

        // Add to game history
        state.gameHistory = state.gameHistory || [];
        state.gameHistory.push({
            id: p.historyEntryId || p.matchId,
            matchNumber: p.matchNumber,
            game: p.game || p.gameName,
            isChallenge: p.isChallenge || false,
            winningSide: p.winningSide,
            winnerIndex: p.winnerIndex,
            winningTeamIds: p.winningTeamIds || [],
            losingTeamIds: p.losingTeamIds || [],
            timestamp: new Date().toISOString()
        });

        // Update team stats
        this._updateTeamStats(state, p.winningTeamIds, 'won');
        this._updateTeamStats(state, p.losingTeamIds, 'lost');

        // Increment games played
        state.gamesPlayed = (state.gamesPlayed || 0) + 1;
    }

    _applyMatchRemoved(state, p) {
        state.gameQueue = (state.gameQueue || []).filter(m =>
            m.id !== p.matchId && m.matchNumber !== p.matchNumber
        );
    }

    _applyMatchResultCorrected(state, p, previousState) {
        // Reverse old stats and apply new ones using previousState
        if (previousState?.teamStats) {
            const teams = state.teams || [];
            for (const [teamId, stats] of Object.entries(previousState.teamStats)) {
                const team = teams.find(t => String(t.id) === String(teamId));
                if (team) {
                    team.gamesWon = stats.gamesWon ?? team.gamesWon;
                    team.gamesLost = stats.gamesLost ?? team.gamesLost;
                    team.gamesPlayed = stats.gamesPlayed ?? team.gamesPlayed;
                }
            }
        }

        // Update the queue entry
        if (previousState?.queueEntry && p.matchId) {
            const match = (state.gameQueue || []).find(m => m.id === p.matchId);
            if (match) {
                match.winnerIndex = p.newWinnerIndex;
                match.winningSide = p.newWinningSide;
                match.corrected = true;
            }
        }

        // Update history entry
        const historyEntry = (state.gameHistory || []).find(h =>
            h.id === p.matchId || h.matchNumber === p.matchNumber
        );
        if (historyEntry) {
            historyEntry.winningSide = p.newWinningSide;
            historyEntry.winnerIndex = p.newWinnerIndex;
            historyEntry.corrected = true;
            historyEntry.originalWinner = {
                side: p.oldWinningSide,
                index: p.oldWinnerIndex
            };
        }
    }

    _updateTeamStats(state, teamIds, result) {
        if (!Array.isArray(teamIds)) return;
        const teams = state.teams || [];
        for (const tid of teamIds) {
            const team = teams.find(t => String(t.id) === String(tid));
            if (!team) continue;
            team.gamesPlayed = (team.gamesPlayed || 0) + 1;
            if (result === 'won') team.gamesWon = (team.gamesWon || 0) + 1;
            if (result === 'lost') team.gamesLost = (team.gamesLost || 0) + 1;
        }
    }

    // ------------------------------------------------------------------
    // Points Action Handlers
    // ------------------------------------------------------------------

    _applyPointsAwarded(state, p, action) {
        const awarded = p.pointsAwarded || {};
        const teams = state.teams || [];

        // pointsAwarded uses team NAME as key (not ID)
        for (const [teamName, points] of Object.entries(awarded)) {
            const team = teams.find(t => t.name === teamName || String(t.id) === String(teamName));
            if (team) {
                team.points = (team.points || 0) + points;
            }
        }

        // Add to points history
        state.pointsHistory = state.pointsHistory || [];
        state.pointsHistory.push({
            round: p.roundNumber || action?.roundNumber || 0,
            pointsAwarded: awarded,
            timestamp: new Date().toISOString()
        });

        // Update currentRound
        if (p.roundNumber) {
            state.currentRound = p.roundNumber;
        }
    }

    _applyPointsCorrected(state, p) {
        const team = (state.teams || []).find(t =>
            String(t.id) === String(p.teamId) || t.name === p.teamName
        );
        if (team && p.newPoints !== undefined) {
            team.points = p.newPoints;
        } else if (team && p.delta !== undefined) {
            team.points = (team.points || 0) + p.delta;
        }
    }

    // ------------------------------------------------------------------
    // Phase Action Handlers
    // ------------------------------------------------------------------

    _applyPhaseAdvanced(state, p) {
        const newRound = p.roundNumber || state.currentPhase?.roundNumber || 0;

        state.currentPhase = {
            name: p.toPhase,
            roundNumber: newRound,
            startedAt: new Date().toISOString()
        };

        // Update status
        if (p.toPhase === 'tournament_end') {
            state.status = 'finished';
        } else if (p.toPhase !== 'pre_game_setup') {
            if (state.status !== 'playing') state.status = 'playing';
        }

        // Reset lobby on entry to lobby phases (old per-slot linear phases, pre-dates slot tracking)
        if (p.toPhase === 'match_1_lobby' || p.toPhase === 'match_2_lobby') {
            state.lobbyReady = {};
        }

        // Match 1 / Match 2 start out independently in their own 'setup'
        // sub-phase; subsequent slot_advanced actions move them forward.
        if (p.toPhase === 'matches_in_progress') {
            state.currentPhase.slots = { 1: 'setup', 2: 'setup' };
        }

        // Increment break counter on round_advance
        if (p.fromPhase === 'round_advance' && state.breakSettings) {
            state.breakSettings.roundsSinceLastBreak =
                (state.breakSettings.roundsSinceLastBreak || 0) + 1;
        }
    }

    /**
     * Match 1 / Match 2 advance independently within 'matches_in_progress'
     * (see phase-manager.js advanceSlot). Reconstructs which sub-phase
     * (setup/lobby/playing/done) each slot was in at this point in history.
     */
    _applySlotAdvanced(state, p) {
        if (!state.currentPhase) return;
        if (!state.currentPhase.slots) state.currentPhase.slots = {};
        state.currentPhase.slots[p.slot] = p.toSubPhase;
    }

    _applyBreakStarted(state, p, previousState) {
        if (p.toPhase === 'break' || p.returnToPhase) {
            state.currentPhase = {
                name: 'break',
                roundNumber: state.currentPhase?.roundNumber || 0,
                startedAt: new Date().toISOString(),
                returnToPhase: p.returnToPhase || p.toPhase,
                autoInserted: p.autoInserted || false
            };
        }
    }

    _applyBreakEnded(state, p) {
        if (p.toPhase) {
            state.currentPhase = {
                name: p.toPhase,
                roundNumber: p.roundNumber || state.currentPhase?.roundNumber || 0,
                startedAt: new Date().toISOString()
            };
        }
        // Reset break counter
        if (state.breakSettings) {
            state.breakSettings.roundsSinceLastBreak = 0;
        }
    }

    _applyBreakAutoInserted(state, p) {
        state.currentPhase = {
            name: 'break',
            roundNumber: p.roundNumber || state.currentPhase?.roundNumber || 0,
            startedAt: new Date().toISOString(),
            returnToPhase: p.returnToPhase,
            autoInserted: true
        };
    }

    // ------------------------------------------------------------------
    // Team / Admin Action Handlers
    // ------------------------------------------------------------------

    _applyTeamRenamed(state, p) {
        const team = (state.teams || []).find(t =>
            t.name === p.oldName || String(t.id) === String(p.teamId)
        );
        if (team && p.newName) team.name = p.newName;
    }

    _applyTeamColorChanged(state, p) {
        const team = (state.teams || []).find(t => String(t.id) === String(p.teamId));
        if (team && p.newColor) team.color = p.newColor;
    }

    _applyPlayerAdded(state, p) {
        const team = (state.teams || []).find(t => String(t.id) === String(p.teamId));
        if (team) {
            team.playerIds = team.playerIds || [];
            if (p.playerId && !team.playerIds.includes(p.playerId)) {
                team.playerIds.push(p.playerId);
            }
        }
        // Add to player registry
        if (p.playerId) {
            state.players = state.players || {};
            state.players[p.playerId] = {
                id: p.playerId,
                name: p.playerName || 'Unknown',
                teamId: p.teamId
            };
        }
    }

    _applyPlayerRemoved(state, p) {
        const team = (state.teams || []).find(t => String(t.id) === String(p.teamId));
        if (team && p.playerId) {
            team.playerIds = (team.playerIds || []).filter(id => id !== p.playerId);
        }
        if (p.playerId && state.players) {
            delete state.players[p.playerId];
        }
    }

    // ------------------------------------------------------------------
    // Spell Action Handlers
    // ------------------------------------------------------------------

    _applySpellPilesInitialized(state, p) {
        // Spell piles set up — can't fully reconstruct from payload alone,
        // but we know piles exist now
        if (p.piles) {
            state.spellPiles = p.piles;
        }
    }

    _applySpellDrawn(state, p) {
        if (!p.teamId || !state.spellPiles?.[p.teamId]) return;
        const pile = state.spellPiles[p.teamId];
        const drawn = p.spellIds || [];

        // Remove from draw pile, add to hand
        pile.drawPile = (pile.drawPile || []).filter(id => !drawn.includes(id));
        pile.hand = (pile.hand || []).concat(drawn);
    }

    _applySpellPhaseStarted(state, p) {
        state.spellPhase = {
            isActive: true,
            turnOrder: p.turnOrder || [],
            currentTeamIndex: 0,
            teamsCompleted: []
        };
    }

    _applySpellBoardEffect(state, p) {
        // Remove destroyed tiles from board
        const destroyed = p.destroyedTiles || [];
        for (const coord of destroyed) {
            if (state.board) delete state.board[coord];
            if (state.heartHexControl?.[coord]) delete state.heartHexControl[coord];
        }
    }

    _applyConditionRemoved(state, p) {
        state.activeEffects = (state.activeEffects || []).filter(e =>
            e.spellName !== p.spellName && e.id !== p.effectId
        );
    }

    _applySpellTurnSkipped(state, p) {
        if (state.spellPhase) {
            state.spellPhase.teamsCompleted = state.spellPhase.teamsCompleted || [];
            if (p.teamId && !state.spellPhase.teamsCompleted.includes(p.teamId)) {
                state.spellPhase.teamsCompleted.push(p.teamId);
            }
            state.spellPhase.currentTeamIndex = (state.spellPhase.currentTeamIndex || 0) + 1;
        }
    }

    // ------------------------------------------------------------------
    // Utility
    // ------------------------------------------------------------------

    _deepClone(obj) {
        if (obj === null || obj === undefined) return obj;
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Clean up timers on destroy.
     */
    destroy() {
        this.pause();
        this._stateCache.clear();
        this._stateCacheOrder = [];
    }
}

window.ReplayEngine = ReplayEngine;
