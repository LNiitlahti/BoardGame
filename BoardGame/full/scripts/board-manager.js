/**
 * BoardManager
 *
 * Owns hex board rendering, click handling, team-to-hex assignment,
 * room toggles, plate placement, point calculation, and win condition.
 */
class BoardManager {

    /**
     * @param {Object} gameState
     * @param {Object} deps
     * @param {BoardModule}   deps.boardModule
     * @param {BoardRenderer} deps.boardRenderer
     * @param {UIManager}     deps.uiManager
     * @param {TeamManager}   deps.teamManager
     * @param {Function}      deps.saveCallback      - () => Promise<void>
     * @param {Function}      deps.logEventCallback   - (type, data) => void (legacy)
     * @param {Function}      [deps.logActionCallback] - (actionType, category, payload, previousState) => void
     * @param {Function}      deps.deleteLastTileEventCallback - (coord) => void
     * @param {Function}      [deps.clearPendingHexWinCallback] - (teamId) => Promise<void>
     * @param {Function}      [deps.onDisplayRefresh] - Called after board changes
     * @param {Function}      [deps.onPhaseRequirementsChanged] - Notifies PhaseManager
     */
    constructor(gameState, {
        boardModule,
        boardRenderer,
        uiManager,
        teamManager,
        saveCallback,
        logEventCallback,
        logActionCallback,
        deleteLastTileEventCallback,
        clearPendingHexWinCallback,
        onDisplayRefresh,
        onPhaseRequirementsChanged
    }) {
        this._gameState = gameState;
        this._boardModule = boardModule;
        this._boardRenderer = boardRenderer;
        this._ui = uiManager;
        this._teams = teamManager;
        this._save = saveCallback;
        this._logEvent = logEventCallback || (() => {});
        this._logAction = logActionCallback || (() => {});
        this._deleteLastTileEvent = deleteLastTileEventCallback || (() => {});
        this._clearPendingHexWin = clearPendingHexWinCallback || (() => {});
        this._onDisplayRefresh = onDisplayRefresh || (() => {});
        this._onPhaseChanged = onPhaseRequirementsChanged || (() => {});
        this._selectedHexCoord = null;
        this._prevBoardSignature = null;
    }

    /**
     * Public passthrough to the injected BoardModule's hex-type lookup
     * ('mountain-heart' | 'side-heart' | null/other). Added so other
     * managers that only receive `boardManager` as a dependency (currently
     * SpellEngine — see Katalyyttiavain's Mountain's Heart precondition and
     * "Kaikki alkoi kivestä"'s side-heart-only outcome in spell-engine.js)
     * don't need their own BoardModule reference just to ask this one
     * question.
     */
    getHexType(q, r) {
        return this._boardModule ? this._boardModule.getHexType(q, r) : null;
    }

    // ------------------------------------------------------------------
    // Board rendering (admin.js patterns)
    // ------------------------------------------------------------------

    renderBoard() {
        if (!this._boardRenderer || !this._boardModule) return;

        const signature = window.RenderSignature.computeBoardSignature(
            this._gameState?.board, this._gameState?.rooms
        );
        if (signature === this._prevBoardSignature) return;
        this._prevBoardSignature = signature;

        this._boardRenderer.render(this._gameState || {});

        const hexes = document.querySelectorAll('.board-hex');
        hexes.forEach(hex => {
            const coord = hex.dataset.coord;

            hex.classList.remove('team-1', 'team-2', 'team-3', 'team-4', 'team-5');

            if (this._gameState?.board && this._gameState.board[coord]) {
                const teamId = this._gameState.board[coord];
                hex.classList.add(`team-${teamId}`);
            }

            hex.onclick = () => this.handleHexClick(coord);
        });
    }

    // ------------------------------------------------------------------
    // Hex click & team picker modal (admin.js patterns)
    // ------------------------------------------------------------------

    handleHexClick(coord) {
        this._selectedHexCoord = coord;

        const currentOwner = this._gameState?.board?.[coord];
        const modal = document.getElementById('teamPickerModal');
        const coordSpan = document.getElementById('pickerHexCoord');
        const optionsContainer = document.getElementById('teamPickerOptions');
        if (!modal || !optionsContainer) return;

        if (coordSpan) coordSpan.textContent = coord;

        // Determine hex type
        const matches = coord.match(/q(-?\d+)r(-?\d+)/);
        let canBeRoom = true;
        let hexType = 'normal';
        if (matches) {
            const [, q, r] = matches;
            hexType = this._boardModule.getHexType(parseInt(q), parseInt(r));
            if (hexType === 'mountain-heart' || hexType === 'side-heart') {
                canBeRoom = false;
            }
        }

        const isRoom = (this._gameState?.rooms && this._gameState.rooms.includes(coord)) ||
                       (this._boardModule.roomHexes && this._boardModule.roomHexes.includes(coord));

        let optionsHtml = '';

        // Room toggle
        if (canBeRoom) {
            optionsHtml += `
                <button class="team-picker-btn ${isRoom ? 'room-active' : ''}"
                        onclick="toggleRoomHex('${coord}')"
                        style="border-left: 4px solid #8b5cf6;">
                    ${isRoom ? ICON_SVGS.doorOpen + ' Remove Room' : ICON_SVGS.doorOpen + ' Mark as Room'}
                </button>`;
        } else {
            optionsHtml += `
                <div class="team-picker-hint" style="padding: 8px; color: var(--text-tertiary); font-size: 0.8rem;">
                    ${hexType === 'mountain-heart' ? ICON_SVGS.heart + ICON_SVGS.heart + ' Mountain Heart' :
                      hexType === 'side-heart' ? ICON_SVGS.heart + ' Side Heart' :
                      ICON_SVGS.star + ' Starting Location'} - Cannot be a room
                </div>`;
        }

        optionsHtml += '<div style="border-top: 1px solid var(--border-color); margin: 8px 0;"></div>';

        // Clear option
        optionsHtml += `
            <button class="team-picker-btn clear-btn" onclick="assignTeamToHex('${coord}', null)">
                Clear Hex (No Owner)
            </button>`;

        // Team options
        if (this._gameState?.teams) {
            this._gameState.teams.forEach(team => {
                const isCurrentOwner = currentOwner === team.id;
                const teamColor = team.color || this._teams.getTeamColor(team.id);
                optionsHtml += `
                    <button class="team-picker-btn"
                            onclick="assignTeamToHex('${coord}', ${team.id})"
                            style="border-left: 4px solid ${teamColor}; ${isCurrentOwner ? 'background: var(--bg-elevated);' : ''}">
                        ${team.name || 'Team ' + team.id}
                        ${isCurrentOwner ? ' (current)' : ''}
                    </button>`;
            });
        }

        optionsContainer.innerHTML = optionsHtml;
        // Support both modal patterns: .active class (lightweight) and display (full)
        if (modal.classList.contains('modal-overlay')) {
            modal.classList.add('active');
        } else {
            modal.style.display = 'flex';
        }
    }

    closeTeamPicker() {
        const modal = document.getElementById('teamPickerModal');
        if (!modal) return;
        if (modal.classList.contains('modal-overlay')) {
            modal.classList.remove('active');
        } else {
            modal.style.display = 'none';
        }
        this._selectedHexCoord = null;
    }

    // ------------------------------------------------------------------
    // Assign team to hex (admin.js pattern)
    // ------------------------------------------------------------------

    async assignTeamToHex(coord, teamId) {
        this._gameState.board = this._gameState.board || {};

        if (teamId === null) {
            const oldTeamId = this._gameState.board[coord];
            delete this._gameState.board[coord];

            if (this._gameState.heartHexControl?.[coord]) {
                delete this._gameState.heartHexControl[coord];
            }

            this.closeTeamPicker();
            try {
                const tournamentRef = window.firebaseDB.collection('tournaments').doc(this._gameState.tournamentId);
                const deleteUpdate = {
                    [`board.${coord}`]: firebase.firestore.FieldValue.delete()
                };
                if (this._gameState.heartHexControl !== undefined) {
                    deleteUpdate[`heartHexControl.${coord}`] = firebase.firestore.FieldValue.delete();
                }
                await tournamentRef.update(deleteUpdate);
                this._deleteLastTileEvent(coord);
                this._logAction('plate_removed', 'board', {
                    hexCoord: coord, teamId: oldTeamId
                }, { board: { [coord]: oldTeamId } });
                this._ui.showStatus(`Cleared hex ${coord}`, 'success');
            } catch (error) {
                console.error('Error clearing hex:', error);
                this._ui.showStatus('Error clearing hex', 'error');
            }
            this.renderBoard();
            return;
        }

        // Assign team
        const oldOccupier = this._gameState.board[coord] || null;
        this._gameState.board[coord] = teamId;

        // Heart hex capture
        const matches = coord.match(/q(-?\d+)r(-?\d+)/);
        let isHeartHex = false;
        if (matches) {
            const [, q, r] = matches;
            const hexType = this._boardModule.getHexType(parseInt(q), parseInt(r));
            if (hexType === 'side-heart' || hexType === 'mountain-heart') {
                this._gameState.heartHexControl = this._gameState.heartHexControl || {};
                this._gameState.heartHexControl[coord] = teamId;
                isHeartHex = true;
            }

            // Heart-hex dispute eligibility trigger -- mirrors admin.js's
            // markAdjacentHeartHexesEligible(). See team-controls.js's
            // _getEligibleChallengeHexes() for the read side.
            this._markAdjacentHeartHexesEligible(parseInt(q), parseInt(r), teamId);
        }

        this.closeTeamPicker();
        await this._save();

        const team = this._gameState.teams?.find(t => t.id === teamId);
        this._logEvent('tile_capture', {
            teamName: team?.name || `Team ${teamId}`,
            teamId: teamId,
            teamColor: team?.color || this._teams.getTeamColor(teamId),
            hexCoord: coord,
            isHeart: isHeartHex
        });
        this._logAction('plate_placed', 'board', {
            teamId, teamName: team?.name || `Team ${teamId}`, hexCoord: coord, isHeart: isHeartHex
        }, oldOccupier ? { board: { [coord]: oldOccupier } } : null);

        if (isHeartHex) {
            this._logAction('heart_hex_captured', 'board', {
                hexCoord: coord, newOwnerTeamId: teamId,
                previousOwnerTeamId: oldOccupier || null
            }, { heartHexControl: { [coord]: oldOccupier || null } });
        }

        await this._clearPendingHexWin(teamId);

        // Room hex spell draw (SpellEngine integration)
        const isRoomHex = (this._gameState.rooms || []).includes(coord);
        if (isRoomHex && teamId !== null && this._onRoomHexPlacement) {
            this._onRoomHexPlacement(teamId, coord);
        }

        this.renderBoard();
        this._onPhaseChanged();
    }

    /**
     * Trigger heart-hex dispute eligibility for `teamId` against any heart
     * hex adjacent to the plate it just placed at (q, r) that's currently
     * controlled by a DIFFERENT team. See admin.js's
     * markAdjacentHeartHexesEligible() for the full rationale -- kept in
     * sync with it since this class is an alternate assignTeamToHex path
     * (used by god.html) covering the same board mutation.
     */
    _markAdjacentHeartHexesEligible(q, r, teamId) {
        if (!this._boardModule?.getHexNeighbors || !this._gameState) return;

        const neighbors = this._boardModule.getHexNeighbors(q, r);
        neighbors.forEach(neighborCoord => {
            const nm = neighborCoord.match(/q(-?\d+)r(-?\d+)/);
            if (!nm) return;
            const [, nq, nr] = nm;
            const neighborType = this._boardModule.getHexType(parseInt(nq), parseInt(nr));
            if (neighborType !== 'side-heart' && neighborType !== 'mountain-heart') return;

            const ownerId = this._gameState.heartHexControl?.[neighborCoord];
            if (ownerId == null || String(ownerId) === String(teamId)) return;

            this._gameState.heartHexChallengeEligibility = this._gameState.heartHexChallengeEligibility || {};
            this._gameState.heartHexChallengeEligibility[neighborCoord] =
                this._gameState.heartHexChallengeEligibility[neighborCoord] || {};
            this._gameState.heartHexChallengeEligibility[neighborCoord][teamId] = true;
        });
    }

    // ------------------------------------------------------------------
    // Room toggle (admin.js pattern)
    // ------------------------------------------------------------------

    async toggleRoomHex(coord) {
        this._gameState.rooms = this._gameState.rooms || [];

        const roomIndex = this._gameState.rooms.indexOf(coord);
        if (roomIndex >= 0) {
            this._gameState.rooms.splice(roomIndex, 1);
            this._ui.showStatus(`Removed room: ${coord}`, 'info');
            this._logAction('room_hex_removed', 'board', { hexCoord: coord }, { wasRoom: true });
        } else {
            this._gameState.rooms.push(coord);
            this._ui.showStatus(`Added room: ${coord}`, 'success');
            this._logAction('room_hex_assigned', 'board', { hexCoord: coord }, { wasRoom: false });
        }

        this._boardModule.setRoomHexes(this._gameState.rooms);
        this.closeTeamPicker();
        await this._save();
        this.renderBoard();
        this._onPhaseChanged();
    }

    // ------------------------------------------------------------------
    // Default rooms (save/load from Firebase config)
    // ------------------------------------------------------------------

    async saveDefaultRooms() {
        const rooms = this._gameState.rooms || [];
        try {
            // config/defaultRooms is ONE doc shared across every tournament -
            // confirm before silently clobbering whatever another tournament
            // (possibly a throwaway/test one) last saved there.
            const existing = await loadDefaultRoomsMeta(window.firebaseDB);
            const tournamentLabel = this._gameState.tournamentId || 'tuntematon turnaus';
            const authIdentity = firebase.auth().currentUser?.email || firebase.auth().currentUser?.uid;
            const savedBy = authIdentity ? `${authIdentity} (${tournamentLabel})` : `god.html (${tournamentLabel})`;
            if (existing) {
                const savedAt = existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : 'unknown time';
                const savedByPrev = existing.updatedBy || 'unknown';
                const confirmed = confirm(
                    `The shared default room layout (used by ALL tournaments) currently has ${existing.rooms.length} rooms, ` +
                    `last saved by "${savedByPrev}" (${savedAt}).\n\n` +
                    `This will PERMANENTLY overwrite it with the current layout (${rooms.length} rooms, saved by "${savedBy}").\n\n` +
                    `Continue?`
                );
                if (!confirmed) return;
            }
            await saveDefaultRoomsDoc(window.firebaseDB, rooms, savedBy);
            this._ui.showStatus(`Saved ${rooms.length} default rooms`, 'success');
        } catch (error) {
            console.error('Error saving default rooms:', error);
            this._ui.showStatus('Error saving default rooms', 'error');
        }
    }

    async loadDefaultRooms() {
        try {
            const rooms = await loadDefaultRoomsDoc(window.firebaseDB);
            if (!rooms) {
                this._ui.showStatus('No default rooms found', 'error');
                return;
            }
            this._gameState.rooms = rooms;
            this._boardModule.setRoomHexes(this._gameState.rooms);
            await this._save();
            this.renderBoard();
            this._onPhaseChanged();
            this._ui.showStatus(`Loaded ${rooms.length} default rooms`, 'success');
        } catch (error) {
            console.error('Error loading default rooms:', error);
            this._ui.showStatus('Error loading default rooms', 'error');
        }
    }

    // ------------------------------------------------------------------
    // Plate placement & points (ported from god-scripts.js)
    // ------------------------------------------------------------------

    canPlaceAt(q, r, teamId) {
        if (!this._gameState || !this._boardModule) return false;

        const teamPlates = Object.entries(this._gameState.board || {})
            .filter(([, occupier]) => occupier === teamId)
            .map(([coord]) => coord);

        const occupiedHexes = Object.keys(this._gameState.board || {});
        return this._boardModule.canPlaceAt(q, r, teamPlates, occupiedHexes);
    }

    // placePlate() / calculatePoints() / checkWinCondition() were DELETED
    // 2026-08-04. All three were unreachable (no callers, not exposed on
    // window, no button on god.html or admin.html) AND actively dangerous:
    // calculatePoints() REPLACED team.points with a board-derived total
    // (sum of hex heart-values over owned hexes, then heart hexes added a
    // second time from heartHexControl — so it also double-counted hearts),
    // which would have erased every match-win point. Live hex placement goes
    // through assignTeamToHex() above; the live win-condition banner is
    // _checkWinCondition() in admin-improved-adapter.js.
    // See docs/architecture/scoring.md.

    highlightValidPlacements() {
        if (!this._gameState?.currentTurn) {
            this._ui.showStatus('No active turn', 'error');
            return;
        }

        this.clearHighlights();

        const teamId = this._gameState.currentTurn.teamId;
        const coordinates = this._boardModule.generateHexCoordinates();

        coordinates.forEach(([q, r]) => {
            if (this.canPlaceAt(q, r, teamId)) {
                const coord = `q${q}r${r}`;
                const hexElement = document.querySelector(`[data-coord="${coord}"]`);
                if (hexElement) hexElement.classList.add('can-place-highlight');
            }
        });

        this._ui.addLog(`Showing valid placements for Team ${teamId}`);
    }

    clearHighlights() {
        document.querySelectorAll('.board-hex.can-place-highlight').forEach(hex => {
            hex.classList.remove('can-place-highlight');
        });
    }
}

window.BoardManager = BoardManager;
