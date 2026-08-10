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
    'match_result_corrected', 'match_details_edited',
    'spell_board_effect', 'spell_tiles_placed', 'spell_tiles_repositioned',
    'spell_hearts_transferred', 'spell_effect_charges_added', 'spell_cards_taken',
    'spell_forced_redraw', 'spell_tiles_captured', 'spell_marked_tiles_relocated',
    'spell_blind_swap'
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
                if ((this._gameState.pendingHexWins || []).some(win => String(win.matchNumber) === String(p.matchNumber))) {
                    warnings.push('Pending hex-placement reminder for this match will be removed');
                }
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

        const prev = entry.previousState;
        const p = entry.payload || {};

        // Every _undo* handler below is a pure, synchronous mutation of
        // whatever `gs` object it's handed -- none of them touch Firestore,
        // the DOM, or anything else non-idempotent (the one exception,
        // window.updatePendingHexNotification() inside _undoMatchResult's
        // pendingHexWins branch, is a UI refresh call, moved below so it
        // fires exactly once regardless of transaction retries). That
        // makes it safe to run the whole dispatch against a transaction-
        // scoped fresh read instead of the shared, long-lived
        // this._gameState -- closing the same race class documented in
        // docs/superpowers/specs/2026-08-10-atomic-array-writes-design.md,
        // for every undoable action type at once instead of leaving this
        // one field's revert (which was previously bundled into the same
        // whole-object this._save() as everything else) still exposed.
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(this._gameState.tournamentId);
        let freshState = null;
        let pendingHexNotificationChanged = false;
        let unimplementedType = false;

        try {
            await window.firebaseDB.runTransaction(async (transaction) => {
                const doc = await transaction.get(tournamentRef);
                const gs = doc.data() || {};
                const beforePendingHexCount = (gs.pendingHexWins || []).length;

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
                    case 'spell_board_effect':
                        this._undoSpellBoardEffect(gs, prev, p);
                        break;
                    case 'spell_tiles_placed':
                        this._undoSpellTilesPlaced(gs, prev, p);
                        break;
                    case 'spell_tiles_repositioned':
                        this._undoSpellTilesRepositioned(gs, prev, p);
                        break;
                    case 'spell_hearts_transferred':
                        this._undoSpellHeartsTransferred(gs, prev, p);
                        break;
                    case 'spell_effect_charges_added':
                        this._undoSpellEffectChargesAdded(gs, prev, p);
                        break;
                    case 'spell_cards_taken':
                        this._undoSpellCardsTaken(gs, prev, p);
                        break;
                    case 'spell_forced_redraw':
                        this._undoSpellForcedRedraw(gs, prev, p);
                        break;
                    case 'spell_tiles_captured':
                        this._undoSpellTilesCaptured(gs, prev, p);
                        break;
                    case 'spell_marked_tiles_relocated':
                        this._undoSpellMarkedTilesRelocated(gs, prev, p);
                        break;
                    case 'spell_blind_swap':
                        this._undoSpellBlindSwap(gs, prev, p);
                        break;
                    default:
                        unimplementedType = true;
                        return;
                }

                pendingHexNotificationChanged = (gs.pendingHexWins || []).length !== beforePendingHexCount;
                // JSON round-trip drops any stray `undefined` values the
                // same way saveGameState()'s removeUndefined() does --
                // Firestore rejects documents containing them.
                const cleaned = JSON.parse(JSON.stringify(gs));
                transaction.update(tournamentRef, cleaned);
                freshState = cleaned;
            });
        } catch (error) {
            console.error('Error executing undo:', error);
            this._ui?.showStatus('Error executing undo', 'error');
            return false;
        }

        if (unimplementedType) {
            this._ui?.showStatus('Undo not implemented for this action type', 'warning');
            return false;
        }

        try {
            Object.assign(this._gameState, freshState);
            if (pendingHexNotificationChanged && typeof window !== 'undefined' &&
                typeof window.updatePendingHexNotification === 'function') {
                window.updatePendingHexNotification();
            }

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

        // Retract the pendingHexWins reminder that confirmResult() queued
        // for the winning team(s) — otherwise it lingers after undo,
        // reminding the admin to place a hex for a match that's no longer
        // confirmed. Challenge matches never push an entry, so this is a
        // harmless no-op filter for them. Matched by matchNumber (as
        // recorded in the action-log payload), not team/side, since a
        // corrected re-confirmation could have changed the winning side.
        if (Array.isArray(gs.pendingHexWins) && p.matchNumber !== undefined) {
            // Notification refresh, if the count changed, now happens once
            // in executeUndo() after the transaction commits -- not here,
            // where a transaction retry could fire it more than once.
            gs.pendingHexWins = gs.pendingHexWins.filter(
                win => String(win.matchNumber) !== String(p.matchNumber)
            );
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

    /**
     * Reverts an extra_placement spell effect (Knowledge from the Deep,
     * Taikuuden nälkä / sarja2-k4, Katalyyttiavain / sarja2-k5 — see
     * spell-engine.js's _handleExtraPlacement). Removes every tile the
     * spell placed, restores any tile it destroyed on landing (destroy_occupied
     * restriction), and returns a discarded card (if any) to the caster's hand.
     */
    _undoSpellTilesPlaced(gs, prev, p) {
        const placed = prev.placed || p.placed || [];
        gs.board = gs.board || {};
        for (const coord of placed) {
            delete gs.board[coord];
        }

        const destroyed = prev.destroyed || p.destroyed || [];
        for (const tile of destroyed) {
            gs.board[tile.coord] = tile.teamId;
            if (tile.wasHeart) {
                gs.heartHexControl = gs.heartHexControl || {};
                gs.heartHexControl[tile.coord] = tile.teamId;
            }
        }

        const discarded = prev.discarded || p.discarded;
        const teamId = p.castByTeamId;
        if (discarded && teamId !== undefined) {
            const pile = gs.spellPiles?.[String(teamId)];
            if (pile) {
                const idx = (pile.usedPile || []).lastIndexOf(discarded);
                if (idx >= 0) pile.usedPile.splice(idx, 1);
                pile.hand = pile.hand || [];
                pile.hand.push(discarded);
            }
        }
    }

    /**
     * Reverts a reposition spell effect (Parempi reitti / sarja3-k3, and any
     * card sharing that shape — see spell-engine.js's _handleReposition):
     * moves each repositioned tile back from its `to` hex to its `from` hex,
     * restoring heart control at `from` if it was a heart hex.
     */
    _undoSpellTilesRepositioned(gs, prev, p) {
        const applied = prev.applied || p.applied || [];
        gs.board = gs.board || {};
        for (const move of applied) {
            delete gs.board[move.to];
            gs.board[move.from] = p.castByTeamId;
            if (move.wasHeart) {
                gs.heartHexControl = gs.heartHexControl || {};
                gs.heartHexControl[move.from] = p.castByTeamId;
            }
        }
    }

    /**
     * Reverts a first_heart_roll outcome-6 heart transfer (Kaikki alkoi
     * kivestä / sarja3-k6 — see spell-engine.js's _handleFirstHeartRoll):
     * restores each transferred side-heart to its previous owner.
     */
    _undoSpellHeartsTransferred(gs, prev, p) {
        const transferred = prev.transferred || p.transferred || [];
        gs.heartHexControl = gs.heartHexControl || {};
        for (const t of transferred) {
            gs.heartHexControl[t.coord] = t.previousOwner;
        }
    }

    /**
     * Reverts addChargesToEffect() (used by sarja3-k6's outcome 3 to buff
     * an active Taitava vastaisku counter) — restores usesRemaining to its
     * value before the bump.
     */
    _undoSpellEffectChargesAdded(gs, prev, p) {
        const effect = (gs.activeEffects || []).find(e => e.id === p.effectId);
        if (effect && prev.usesRemaining !== undefined) {
            effect.usesRemaining = prev.usesRemaining;
        }
    }

    /**
     * Reverts a conditional_card_grab spell effect (Magian keskittymä /
     * sarja4-k5 — see spell-engine.js's _handleConditionalCardGrab): removes
     * each taken card from the caster's hand and returns it to its original
     * team's source pile (hand/usedPile/drawPile).
     */
    _undoSpellCardsTaken(gs, prev, p) {
        const taken = prev.taken || p.taken || [];
        const casterTeamId = p.castByTeamId;
        const casterPile = gs.spellPiles?.[String(casterTeamId)];

        for (const t of taken) {
            if (casterPile?.hand) {
                const idx = casterPile.hand.lastIndexOf(t.spellId);
                if (idx >= 0) casterPile.hand.splice(idx, 1);
            }
            const originPile = gs.spellPiles?.[String(t.teamId)];
            if (originPile) {
                originPile[t.source] = originPile[t.source] || [];
                originPile[t.source].push(t.spellId);
            }
        }
    }

    /**
     * Reverts a force_redraw spell effect (Vaihtoon / sarja6-k4 — see
     * spell-engine.js's _handleForceRedraw). Restores the target team's
     * entire spell pile (hand/drawPile/usedPile) to its exact pre-shuffle
     * snapshot rather than trying to reverse the shuffle itself.
     */
    _undoSpellForcedRedraw(gs, prev, p) {
        const targetTeamId = prev.targetTeamId ?? p.targetTeamId;
        if (targetTeamId === undefined) return;
        gs.spellPiles = gs.spellPiles || {};
        gs.spellPiles[String(targetTeamId)] = {
            hand: prev.handBefore || [],
            drawPile: prev.drawPileBefore || [],
            usedPile: prev.usedPileBefore || []
        };
    }

    /**
     * Reverts a temporary_capture spell effect (Epävakaa todellisuus / N.3
     * named card — see spell-engine.js's _handleTemporaryCapture): restores
     * each captured tile to its previous owner. Only meaningful while the
     * capture is still active — once expireConditions() has already
     * deleted the tiles from the board entirely, that deletion is its own
     * separate, independently-undoable 'spell_board_effect' entry.
     */
    _undoSpellTilesCaptured(gs, prev, p) {
        const captured = prev.captured || p.captured || [];
        gs.board = gs.board || {};
        for (const cap of captured) {
            gs.board[cap.coord] = cap.previousOwner;
            if (cap.wasHeart) {
                gs.heartHexControl = gs.heartHexControl || {};
                gs.heartHexControl[cap.coord] = cap.previousOwner;
            }
        }
    }

    /**
     * Reverts resolveMarkedRelocation() (Vettähän se vain oli / N.2 named
     * card): moves each relocated tile back to its origin hex under its
     * original owner, and restores anything destroyed on landing.
     */
    _undoSpellMarkedTilesRelocated(gs, prev, p) {
        const applied = prev.applied || p.applied || [];
        gs.board = gs.board || {};
        for (const move of applied) {
            delete gs.board[move.to];
            gs.board[move.from] = move.owner;
            if (move.wasHeart) {
                gs.heartHexControl = gs.heartHexControl || {};
                gs.heartHexControl[move.from] = move.owner;
            }
        }

        const destroyed = prev.destroyed || p.destroyed || [];
        for (const tile of destroyed) {
            gs.board[tile.coord] = tile.teamId;
            if (tile.wasHeart) {
                gs.heartHexControl = gs.heartHexControl || {};
                gs.heartHexControl[tile.coord] = tile.teamId;
            }
        }
    }

    /**
     * Reverts a blind_card_swap (Tuhoa suunnitelmat / N.7 named card — see
     * spell-engine.js's _handleBlindCardSwap): puts each swapped card back
     * at its original index in its original hand, for both the teamA/teamB
     * swap and the optional caster swap.
     */
    _undoSpellBlindSwap(gs, prev, p) {
        // Reverse in the opposite order they were applied in — the caster
        // swap happens AFTER the teamA/teamB swap during casting (see
        // spell-engine.js's _handleBlindCardSwap), and when withTeamId is
        // the same team as teamAId/teamBId, both swaps touch the same pile.
        // Undoing teamASwap first would get immediately overwritten by
        // undoing casterSwap second (or vice versa, if done in cast order).
        const casterSwap = prev.casterSwap || p.casterSwap;
        if (casterSwap) {
            const casterPile = gs.spellPiles?.[String(casterSwap.casterTeamId)];
            const targetPile = gs.spellPiles?.[String(casterSwap.withTeamId)];
            if (casterPile?.hand) casterPile.hand[casterSwap.casterIdx] = casterSwap.casterGave;
            if (targetPile?.hand) targetPile.hand[casterSwap.targetIdx] = casterSwap.casterGot;
        }

        const teamASwap = prev.teamASwap || p.teamASwap;
        if (teamASwap) {
            const pileA = gs.spellPiles?.[String(teamASwap.teamAId)];
            const pileB = gs.spellPiles?.[String(teamASwap.teamBId)];
            if (pileA?.hand) pileA.hand[teamASwap.idxA] = teamASwap.cardA;
            if (pileB?.hand) pileB.hand[teamASwap.idxB] = teamASwap.cardB;
        }
    }

    /**
     * Reverts a destroy_adjacent spell effect (Get Away From Me, Calculated
     * Aggression, and any card sharing that effect shape — see
     * spell-engine.js's _handleDestroyAdjacent). previousState.destroyedTiles
     * is an array of { coord, teamId, wasHeart } captured at destroy time;
     * restoring each entry re-places the tile (and heart control, if it was
     * one) exactly as it stood before the spell fired.
     */
    _undoSpellBoardEffect(gs, prev, p) {
        const destroyedTiles = prev.destroyedTiles || p.destroyedTiles || [];
        if (!destroyedTiles.length) return;

        gs.board = gs.board || {};
        for (const tile of destroyedTiles) {
            gs.board[tile.coord] = tile.teamId;
            if (tile.wasHeart) {
                gs.heartHexControl = gs.heartHexControl || {};
                gs.heartHexControl[tile.coord] = tile.teamId;
            }
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
        // Pop the matching gameState.pointsHistory entry too, not just
        // team.points/currentRound. Without this, undoing a points award
        // left pointsHistory still showing the round as paid, which (a)
        // kept the "don't double-award" guard (history.some(e => e.round
        // === roundNumber)) permanently tripped for that round even after
        // undo -- silently blocking a legitimate re-award later -- and (b)
        // left summary-generator.js/replay-engine.js, which read
        // pointsHistory directly, disagreeing with the just-restored
        // team.points.
        if (prev.pointsHistoryRound !== undefined && Array.isArray(gs.pointsHistory)) {
            const idx = gs.pointsHistory.findIndex(e => e.round === prev.pointsHistoryRound);
            if (idx !== -1) gs.pointsHistory.splice(idx, 1);
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

    /**
     * @param {Object} entry
     * @param {number} [skippedCount] - How many more-recent log entries were
     *   passed over to reach this one (e.g. by "Undo Last Action" walking
     *   past non-undoable phase changes / spell casts). 0 or omitted means
     *   this is the single most recent log entry, undoable or not.
     */
    openUndoConfirmModal(entry, skippedCount) {
        const { canUndo, reason } = this.canUndo(entry);
        if (!canUndo) {
            this._ui?.showStatus(`Cannot undo: ${reason}`, 'warning');
            return;
        }

        this._pendingUndoEntry = entry;
        const preview = this.previewUndo(entry);
        if (skippedCount > 0) {
            preview.warnings.unshift(
                `This is not the most recent action — ${skippedCount} more recent ` +
                `action${skippedCount === 1 ? '' : 's'} (phase change, spell, etc.) ` +
                `cannot be undone and will stay as-is.`
            );
        }

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
