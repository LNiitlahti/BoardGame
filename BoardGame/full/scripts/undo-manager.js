/**
 * UndoManager
 *
 * Provides undo capability for admin actions. Reads previousState from action log
 * entries and reverses mutations. Only specific action types are undoable.
 */

const UNDOABLE_TYPES = new Set([
    'plate_placed', 'plate_removed',
    'match_result_confirmed', 'match_started', 'match_removed',
    'points_awarded', 'points_corrected',
    'match_result_corrected', 'match_details_edited'
]);

class UndoManager {

    /**
     * @param {Object} gameState
     * @param {Object} deps
     * @param {ActionLogger}    deps.actionLogger
     * @param {UIManager}       deps.uiManager
     * @param {TeamManager}     deps.teamManager
     * @param {Function}        deps.saveCallback
     * @param {Function}        deps.logActionCallback
     * @param {Function}        deps.refreshCallback
     */
    constructor(gameState, { actionLogger, uiManager, teamManager, saveCallback, logActionCallback, refreshCallback }) {
        this._gameState = gameState;
        this._logger = actionLogger;
        this._ui = uiManager;
        this._teams = teamManager;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._refresh = refreshCallback || (() => {});
    }

    // ------------------------------------------------------------------
    // Can Undo?
    // ------------------------------------------------------------------

    /**
     * Check if a log entry can be undone.
     * @param {Object} entry - Action log entry
     * @returns {{ canUndo: boolean, reason: string }}
     */
    canUndo(entry) {
        if (!entry) return { canUndo: false, reason: 'No entry' };
        if (entry.undone) return { canUndo: false, reason: 'Already undone' };
        if (!UNDOABLE_TYPES.has(entry.actionType)) {
            return { canUndo: false, reason: 'Action type not undoable' };
        }
        if (!entry.previousState || Object.keys(entry.previousState).length === 0) {
            return { canUndo: false, reason: 'No previous state captured' };
        }
        return { canUndo: true, reason: '' };
    }

    // ------------------------------------------------------------------
    // Preview Undo
    // ------------------------------------------------------------------

    /**
     * Preview what changes undo will make.
     * @param {Object} entry
     * @returns {{ changes: Array, warnings: string[] }}
     */
    previewUndo(entry) {
        const changes = [];
        const warnings = [];
        const prev = entry.previousState || {};
        const p = entry.payload || {};

        switch (entry.actionType) {
            case 'match_result_confirmed': {
                if (prev.teamStats) {
                    const gs = this._gameState;
                    Object.entries(prev.teamStats).forEach(([teamId, stats]) => {
                        const team = gs.teams?.find(t => String(t.id) === String(teamId));
                        if (team) {
                            if ((team.gamesWon || 0) !== stats.gamesWon) {
                                changes.push({ field: `${team.name} gamesWon`, from: team.gamesWon, to: stats.gamesWon });
                            }
                            if ((team.gamesLost || 0) !== stats.gamesLost) {
                                changes.push({ field: `${team.name} gamesLost`, from: team.gamesLost, to: stats.gamesLost });
                            }
                        }
                    });
                }
                if (prev.gamesPlayed !== undefined) {
                    changes.push({ field: 'gamesPlayed', from: this._gameState.gamesPlayed, to: prev.gamesPlayed });
                }
                warnings.push('Match will be moved back to ongoing status');
                break;
            }
            case 'match_result_corrected': {
                if (prev.teamStats) {
                    const gs = this._gameState;
                    Object.entries(prev.teamStats).forEach(([teamId, stats]) => {
                        const team = gs.teams?.find(t => String(t.id) === String(teamId));
                        if (team) {
                            changes.push({ field: `${team.name} gamesWon`, from: team.gamesWon, to: stats.gamesWon });
                            changes.push({ field: `${team.name} gamesLost`, from: team.gamesLost, to: stats.gamesLost });
                        }
                    });
                }
                warnings.push('Match result will revert to original winner');
                break;
            }
            case 'plate_placed': {
                changes.push({ field: `Board ${p.hexCoord}`, from: `Team ${p.teamId}`, to: prev.board?.[p.hexCoord] || 'empty' });
                break;
            }
            case 'plate_removed': {
                changes.push({ field: `Board ${p.hexCoord}`, from: 'empty', to: `Team ${prev.board?.[p.hexCoord] || '?'}` });
                break;
            }
            case 'points_awarded':
            case 'points_corrected': {
                if (prev.points !== undefined) {
                    const team = this._gameState.teams?.find(t => String(t.id) === String(p.teamId));
                    changes.push({ field: `${team?.name || 'Team'} points`, from: team?.points, to: prev.points });
                }
                if (prev.teamPoints) {
                    Object.entries(prev.teamPoints).forEach(([tid, pts]) => {
                        const team = this._gameState.teams?.find(t => String(t.id) === String(tid));
                        changes.push({ field: `${team?.name || 'Team'} points`, from: team?.points, to: pts });
                    });
                }
                break;
            }
            case 'match_started': {
                changes.push({ field: 'Match status', from: 'ongoing', to: 'pending' });
                break;
            }
            case 'match_removed': {
                changes.push({ field: 'Match', from: 'removed', to: 'restored to queue' });
                break;
            }
            default:
                changes.push({ field: entry.actionType, from: 'current', to: 'previous' });
        }

        return { changes, warnings };
    }

    // ------------------------------------------------------------------
    // Execute Undo
    // ------------------------------------------------------------------

    /**
     * Execute undo for a log entry.
     * @param {Object} entry - Action log entry with previousState
     */
    async executeUndo(entry) {
        const { canUndo, reason } = this.canUndo(entry);
        if (!canUndo) {
            this._ui?.showStatus(`Cannot undo: ${reason}`, 'warning');
            return false;
        }

        const gs = this._gameState;
        const prev = entry.previousState;
        const p = entry.payload || {};

        try {
            switch (entry.actionType) {
                case 'match_result_confirmed':
                    this._undoMatchResult(gs, prev, p);
                    break;
                case 'match_result_corrected':
                    this._undoResultCorrection(gs, prev, p);
                    break;
                case 'plate_placed':
                    this._undoPlatePlaced(gs, prev, p);
                    break;
                case 'plate_removed':
                    this._undoPlateRemoved(gs, prev, p);
                    break;
                case 'points_awarded':
                case 'points_corrected':
                    this._undoPointsChange(gs, prev, p);
                    break;
                case 'match_started':
                    this._undoMatchStarted(gs, prev, p);
                    break;
                case 'match_removed':
                    this._undoMatchRemoved(gs, prev, p);
                    break;
                case 'match_details_edited':
                    this._undoMatchEdited(gs, prev, p);
                    break;
                default:
                    this._ui?.showStatus('Undo not implemented for this action type', 'warning');
                    return false;
            }

            await this._save();

            // Mark the original entry as undone in Firestore
            await this._markAsUndone(entry);

            this._logAction('action_undone', 'admin', {
                originalActionType: entry.actionType,
                originalLogId: entry.id || entry.logId,
                originalTimestamp: entry.timestamp
            }, { undoneEntry: { actionType: entry.actionType, payload: p } });

            this._ui?.showStatus(`Undone: ${entry.actionType}`, 'success');
            this._refresh();
            return true;
        } catch (error) {
            console.error('Error executing undo:', error);
            this._ui?.showStatus('Error executing undo', 'error');
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Type-specific undo handlers
    // ------------------------------------------------------------------

    _undoMatchResult(gs, prev, p) {
        // Restore team stats
        if (prev.teamStats) {
            Object.entries(prev.teamStats).forEach(([teamId, stats]) => {
                const team = gs.teams?.find(t => String(t.id) === String(teamId));
                if (team) {
                    Object.assign(team, stats);
                }
            });
        }

        // Restore gamesPlayed
        if (prev.gamesPlayed !== undefined) {
            gs.gamesPlayed = prev.gamesPlayed;
        }

        // Remove the last history entry for this match
        if (prev.gameHistoryLength !== undefined && gs.gameHistory) {
            gs.gameHistory = gs.gameHistory.slice(0, prev.gameHistoryLength);
        }

        // Move queue entry back to ongoing
        if (prev.queueEntry) {
            const queueEntry = (gs.gameQueue || []).find(g => g.id === (p.matchId || prev.queueEntry.id));
            if (queueEntry) {
                queueEntry.status = prev.queueEntry.status || 'ongoing';
                delete queueEntry.completedAt;
                delete queueEntry.winningSide;
                delete queueEntry.winnerIndex;
                // admin.html's confirmResult() (unlike god.html's) also stamps
                // these two — harmless no-op delete when they were never set.
                delete queueEntry.adminConfirmed;
                delete queueEntry.adminConfirmedAt;
            }
        }
    }

    _undoResultCorrection(gs, prev, p) {
        // Restore team stats from pre-correction snapshot
        if (prev.teamStats) {
            Object.entries(prev.teamStats).forEach(([teamId, stats]) => {
                const team = gs.teams?.find(t => String(t.id) === String(teamId));
                if (team) {
                    Object.assign(team, stats);
                }
            });
        }

        // Restore queue entry winner
        if (prev.queueEntry) {
            const queueEntry = (gs.gameQueue || []).find(g => g.id === p.matchId);
            if (queueEntry) {
                queueEntry.winnerIndex = prev.queueEntry.winnerIndex;
                queueEntry.winningSide = prev.queueEntry.winningSide;
                delete queueEntry.corrected;
                delete queueEntry.correctedAt;
                delete queueEntry.correctionReason;
                delete queueEntry.originalWinnerIndex;
            }
        }

        // Restore history entry
        const historyEntry = (gs.gameHistory || []).find(h =>
            h.matchNumber === p.matchNumber || h.queuedGameId === p.matchId
        );
        if (historyEntry && prev.queueEntry) {
            historyEntry.winnerIndex = prev.queueEntry.winnerIndex;
            historyEntry.winningSide = prev.queueEntry.winningSide;
            delete historyEntry.corrected;
            delete historyEntry.correctedAt;
            delete historyEntry.correctionReason;
            delete historyEntry.originalWinnerIndex;
        }
    }

    _undoPlatePlaced(gs, prev, p) {
        if (p.hexCoord && prev.board) {
            const oldValue = prev.board[p.hexCoord];
            if (oldValue === null || oldValue === undefined) {
                delete gs.board[p.hexCoord];
            } else {
                gs.board[p.hexCoord] = oldValue;
            }
        }
        // Restore heart hex control
        if (p.isHeart && p.hexCoord && gs.heartHexControl) {
            delete gs.heartHexControl[p.hexCoord];
        }
    }

    _undoPlateRemoved(gs, prev, p) {
        if (p.hexCoord && prev.board) {
            gs.board = gs.board || {};
            gs.board[p.hexCoord] = prev.board[p.hexCoord];
        }
    }

    _undoPointsChange(gs, prev, p) {
        // Single team points
        if (prev.points !== undefined && p.teamId) {
            const team = gs.teams?.find(t => String(t.id) === String(p.teamId));
            if (team) team.points = prev.points;
        }
        // Multi-team points (round advance)
        if (prev.teamPoints) {
            Object.entries(prev.teamPoints).forEach(([tid, pts]) => {
                const team = gs.teams?.find(t => String(t.id) === String(tid));
                if (team) team.points = pts;
            });
        }
        // Restore round number
        if (prev.currentRound !== undefined) {
            gs.currentRound = prev.currentRound;
        }
    }

    _undoMatchStarted(gs, prev, p) {
        const queueEntry = (gs.gameQueue || []).find(g => g.id === (p.matchId || prev.matchId));
        if (queueEntry) {
            queueEntry.status = 'pending';
            delete queueEntry.startedAt;
        }
    }

    _undoMatchRemoved(gs, prev, p) {
        if (prev.removedEntry) {
            gs.gameQueue = gs.gameQueue || [];
            gs.gameQueue.push(prev.removedEntry);
        }
    }

    _undoMatchEdited(gs, prev, p) {
        if (prev.matchEntry) {
            const queueEntry = (gs.gameQueue || []).find(g => g.id === (p.matchId || prev.matchEntry.id));
            if (queueEntry) {
                Object.assign(queueEntry, prev.matchEntry);
            }
        }
    }

    // ------------------------------------------------------------------
    // Mark entry as undone in Firestore
    // ------------------------------------------------------------------

    async _markAsUndone(entry) {
        const gs = this._gameState;
        if (!gs.tournamentId || !entry.id) return;

        try {
            const tournamentRef = window.firebaseDB.collection('tournaments').doc(gs.tournamentId);
            await tournamentRef.collection('actionLog').doc(entry.id).update({
                undone: true,
                undoneAt: new Date().toISOString()
            });
        } catch (error) {
            console.warn('Could not mark log entry as undone:', error);
        }
    }

    // ------------------------------------------------------------------
    // UI: Undo Confirmation Modal
    // ------------------------------------------------------------------

    openUndoConfirmModal(entry) {
        const { canUndo, reason } = this.canUndo(entry);
        if (!canUndo) {
            this._ui?.showStatus(`Cannot undo: ${reason}`, 'warning');
            return;
        }

        this._pendingUndoEntry = entry;
        const preview = this.previewUndo(entry);

        const descEl = document.getElementById('undoActionDesc');
        const changesEl = document.getElementById('undoChangesPreview');
        const warningsEl = document.getElementById('undoWarnings');

        if (descEl) {
            const desc = ActionLogger.describeAction(entry, this._gameState);
            descEl.textContent = desc;
        }

        if (changesEl) {
            changesEl.innerHTML = preview.changes.map(c =>
                `<div class="undo-change-row">
                    <span class="undo-change-field">${c.field}</span>
                    <span class="undo-change-from">${c.from ?? '—'}</span>
                    <span class="undo-change-arrow">→</span>
                    <span class="undo-change-to">${c.to ?? '—'}</span>
                </div>`
            ).join('');
        }

        if (warningsEl) {
            if (preview.warnings.length > 0) {
                warningsEl.innerHTML = preview.warnings.map(w =>
                    `<div class="undo-warning">${w}</div>`
                ).join('');
                warningsEl.style.display = 'block';
            } else {
                warningsEl.style.display = 'none';
            }
        }

        const modal = document.getElementById('undoConfirmModal');
        if (modal) modal.style.display = 'flex';
    }

    closeUndoConfirmModal() {
        const modal = document.getElementById('undoConfirmModal');
        if (modal) modal.style.display = 'none';
        this._pendingUndoEntry = null;
    }

    async confirmUndoAction() {
        if (!this._pendingUndoEntry) return;
        const entry = this._pendingUndoEntry;
        this.closeUndoConfirmModal();
        await this.executeUndo(entry);
    }
}

window.UndoManager = UndoManager;
