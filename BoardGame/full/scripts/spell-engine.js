/**
 * SpellEngine — Spell Card Management System
 *
 * Handles spell definitions loading, draw pile management, spell distribution,
 * casting, effect tracking, spell phase turn order, and admin controls.
 *
 * Follows the DI pattern: receives gameState + deps via constructor.
 * Sits between StatsManager and GodApp in the init order.
 *
 * Firestore fields managed:
 *   gameState.spellDefinitions  — cached spell defs from spellCards collection
 *   gameState.spellPiles        — per-team { drawPile, hand, usedPile }
 *   gameState.spellPhase        — turn order state during spell_phase
 *   gameState.activeEffects     — tracked conditions/buffs
 *   gameState.spellHistory      — cast history log
 */

// Effect types whose board/point mutation is NOT applied at cast time — they
// need an explicit admin "Process" trigger (god.html spell-history Process
// button -> processPendingSpellCast() -> executeSpellEffect()), same pattern
// established for 'rematch'. Everything else (ban, silence, shield,
// multiplier, streak_bonus, permanent_buff, modifier, counter, reminder,
// challenge) is informational/needs additional admin-entered input and is
// only ever recorded as an activeEffects reminder card by
// team-controls.js's castSpellViaFirestore.
const PROCESSABLE_EFFECT_TYPES = new Set([
    'rematch', 'replay_used_pile', 'destroy_adjacent', 'bonus_points',
    'extra_placement', 'charged_removal', 'reposition', 'reveal_hands',
    'first_heart_roll', 'conditional_bonus', 'placement_lockout',
    'random_mass_removal', 'conditional_card_grab', 'copy_spell',
    'fill_adjacent_to_heart', 'heart_lock', 'force_redraw', 'bet',
    'temporary_capture', 'forced_removal_condition', 'marked_relocation_charge',
    'piggyback_condition', 'evasion_condition', 'blind_card_swap', 'win_streak_bonus'
]);
const PROCESS_BUTTON_LABELS = {
    rematch: 'Process Rematch (revert match)',
    replay_used_pile: 'Process Replay (used pile)',
    destroy_adjacent: 'Process (destroy adjacent tiles)',
    bonus_points: 'Process (award heart points)',
    extra_placement: 'Process (place tiles)',
    charged_removal: 'Process (start charge counter)',
    reposition: 'Process (move tiles)',
    reveal_hands: 'Process (reveal hands)',
    first_heart_roll: 'Process (roll d6)',
    conditional_bonus: 'Process (confirm condition & award)',
    placement_lockout: 'Process (lock hexes)',
    random_mass_removal: 'Process (roll d6)',
    conditional_card_grab: 'Process (confirm trial & take cards)',
    copy_spell: 'Process (copy & cast)',
    fill_adjacent_to_heart: 'Process (fill adjacent hexes)',
    heart_lock: 'Process (lock heart)',
    force_redraw: 'Process (force redraw)',
    bet: 'Process (resolve bet)',
    temporary_capture: 'Process (capture tiles)',
    forced_removal_condition: 'Process (apply condition)',
    marked_relocation_charge: 'Process (mark tile)',
    piggyback_condition: 'Process (apply condition)',
    evasion_condition: 'Process (apply condition)',
    blind_card_swap: 'Process (blind swap)',
    win_streak_bonus: 'Process (confirm streak & award)'
};

class SpellEngine {

    /**
     * @param {Object} gameState  Shared mutable game state reference
     * @param {Object} deps
     * @param {UIManager}     deps.uiManager
     * @param {TeamManager}   deps.teamManager
     * @param {BoardManager}  [deps.boardManager]
     * @param {Function}      deps.saveCallback           - (triggerBtn?) => Promise<void>
     * @param {Function}      [deps.logActionCallback]     - (type, cat, payload, prev) => void
     * @param {Function}      [deps.onPhaseRequirementsChanged] - () => void
     * @param {Function}      [deps.onDisplayRefresh]     - () => void
     * @param {Function}      [deps.revertMatchByGameId]  - (gameId) => {success, error?} | Promise<{success, error?}>
     *   Reverts a confirmed match's result (points/hex claims/queue status)
     *   back to its pre-confirmation state, reusing the same undo mechanism
     *   as "Undo Last Action" (see undo-manager.js). Only wired on pages
     *   that also construct an UndoManager (currently god.html only) — see
     *   _handleRematch(), which fails cleanly when this isn't provided.
     */
    constructor(gameState, {
        uiManager,
        teamManager,
        boardManager,
        saveCallback,
        logActionCallback,
        onPhaseRequirementsChanged,
        onDisplayRefresh,
        revertMatchByGameId
    }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._teams = teamManager;
        this._board = boardManager || null;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._onPhaseChanged = onPhaseRequirementsChanged || (() => {});
        this._refresh = onDisplayRefresh || (() => {});
        this._revertMatch = typeof revertMatchByGameId === 'function' ? revertMatchByGameId : null;

        /** @type {Object[]} Spell definitions from Firestore spellCards collection */
        this._spellDefs = [];
    }

    // ==================================================================
    // Spell definitions
    // ==================================================================

    /**
     * Load all spell definitions from Firestore spellCards collection.
     * Caches in this._spellDefs and in gameState.spellDefinitions (id-keyed map).
     */
    async loadSpellDefinitions() {
        try {
            this._ui?.showStatus('Loading spell definitions...', 'info');
            const snapshot = await window.firebaseDB.collection('spellCards').get();
            this._spellDefs = [];
            const defsMap = {};

            snapshot.forEach(doc => {
                const spell = { id: doc.id, ...doc.data() };
                this._spellDefs.push(spell);
                defsMap[doc.id] = spell;
            });

            this._gameState.spellDefinitions = defsMap;
            console.log('[SpellEngine] Loaded', this._spellDefs.length, 'spell definitions');
            this._ui?.showStatus(`Loaded ${this._spellDefs.length} spell definitions`, 'success');
            return this._spellDefs;
        } catch (error) {
            console.error('[SpellEngine] Error loading spells:', error);
            this._ui?.showStatus('Error loading spells: ' + error.message, 'error');
            throw error;
        }
    }

    /** Get spell definition by ID */
    getSpellDef(spellId) {
        return this._spellDefs.find(s => s.id === spellId)
            || this._gameState.spellDefinitions?.[spellId]
            || null;
    }

    /** Ensure definitions are loaded (lazy init) */
    async _ensureDefs() {
        if (this._spellDefs.length === 0) {
            // Try to recover from gameState cache
            const cached = this._gameState.spellDefinitions;
            if (cached && Object.keys(cached).length > 0) {
                this._spellDefs = Object.values(cached);
            } else {
                await this.loadSpellDefinitions();
            }
        }
    }

    // ==================================================================
    // Draw pile management (Task 1.15)
    // ==================================================================

    /**
     * Initialize shuffled per-team draw piles.
     * Each team gets a shuffled copy of ALL spell IDs as their draw pile,
     * then draws `cardsPerTeam` into their hand.
     * @param {number} [cardsPerTeam=3]
     */
    async initializeSpellPiles(cardsPerTeam) {
        await this._ensureDefs();

        if (this._spellDefs.length === 0) {
            this._ui?.showStatus('No spell definitions loaded', 'error');
            return;
        }

        const teams = this._gameState.teams || [];
        if (teams.length === 0) {
            this._ui?.showStatus('No teams in tournament', 'error');
            return;
        }

        const count = cardsPerTeam || 3;
        const allSpellIds = this._spellDefs.map(s => s.id);
        const piles = {};

        for (const team of teams) {
            const shuffled = this._shuffleArray([...allSpellIds]);
            const hand = shuffled.splice(0, Math.min(count, shuffled.length));
            piles[String(team.id)] = {
                drawPile: shuffled,
                hand: hand,
                usedPile: []
            };
        }

        this._gameState.spellPiles = piles;

        // Also save definitions map for team.html / view.html access
        if (!this._gameState.spellDefinitions || Object.keys(this._gameState.spellDefinitions).length === 0) {
            const defsMap = {};
            this._spellDefs.forEach(s => { defsMap[s.id] = s; });
            this._gameState.spellDefinitions = defsMap;
        }

        await this._save();

        this._logAction('spell_piles_initialized', 'spell', {
            teamsCount: teams.length,
            cardsPerTeam: count,
            totalSpells: allSpellIds.length
        }, { hadPilesBefore: false });

        this._ui?.showStatus(`Draw piles created: ${count} cards per team`, 'success');
        this.renderSpellsTab();
    }

    /**
     * Draw spell(s) from a team's draw pile into their hand.
     * Recycles used pile if draw pile is empty.
     * @param {number|string} teamId
     * @param {number} [count=1]
     * @returns {string[]} IDs of drawn spells
     */
    drawSpell(teamId, count) {
        const key = String(teamId);
        const piles = this._gameState.spellPiles;
        if (!piles || !piles[key]) {
            console.warn('[SpellEngine] No spell pile for team', teamId);
            return [];
        }

        const pile = piles[key];
        const drawCount = count || 1;

        // Check for "Double Bid" active effect (draws 2 instead of 1)
        const actualCount = this._checkDoubleDraw(teamId) ? drawCount * 2 : drawCount;

        const drawn = [];
        for (let i = 0; i < actualCount; i++) {
            // Recycle if empty
            if (pile.drawPile.length === 0) {
                if (pile.usedPile.length === 0) break; // No cards left at all
                pile.drawPile = this._shuffleArray([...pile.usedPile]);
                pile.usedPile = [];

                this._logAction('spell_pile_recycled', 'spell', {
                    teamId, cardsRecycled: pile.drawPile.length
                }, { drawPileEmpty: true, usedPileCount: pile.drawPile.length });
            }

            const spellId = pile.drawPile.shift();
            if (spellId) {
                pile.hand.push(spellId);
                drawn.push(spellId);
            }
        }

        if (drawn.length > 0) {
            this._logAction('spell_drawn_from_pile', 'spell', {
                teamId, spellIds: drawn, drawCount: drawn.length
            }, { handBefore: [...(pile.hand.filter(id => !drawn.includes(id)))] });
        }

        return drawn;
    }

    /** Check if team has an active double-draw modifier (double-bid, sarja1-k5, or any future card sharing this effect shape) */
    _checkDoubleDraw(teamId) {
        const effects = this._gameState.activeEffects || [];
        const idx = effects.findIndex(e => {
            if (e.isExpired || String(e.castByTeamId) !== String(teamId) || e.category !== 'modifier') return false;
            const def = this.getSpellDef(e.spellId);
            return def?.effect?.modifier === 'double_draw';
        });

        if (idx >= 0) {
            // Consume the modifier
            effects[idx].isExpired = true;
            return true;
        }
        return false;
    }

    /** Fisher-Yates shuffle */
    _shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ==================================================================
    // Admin distribution
    // ==================================================================

    /** Distribute a spell to a team (reads from god.html DOM selects) */
    async distributeSpellToTeam() {
        const teamIdStr = document.getElementById('spellDistTeam')?.value;
        const spellId = document.getElementById('spellToDistribute')?.value;

        if (!teamIdStr || !spellId) {
            this._ui?.showStatus('Select both team and spell', 'error');
            return;
        }

        const teamId = parseInt(teamIdStr);
        const gs = this._gameState;

        // Initialize spellPiles if not present
        gs.spellPiles = gs.spellPiles || {};
        const key = String(teamId);
        if (!gs.spellPiles[key]) {
            gs.spellPiles[key] = { drawPile: [], hand: [], usedPile: [] };
        }

        gs.spellPiles[key].hand.push(spellId);

        await this._save();

        const def = this.getSpellDef(spellId);
        const team = gs.teams?.find(t => t.id === teamId);

        this._logAction('spell_distributed', 'spell', {
            spellId, teamId, teamName: team?.name,
            method: 'admin_manual'
        }, { handBefore: gs.spellPiles[key].hand.slice(0, -1) });

        this._ui?.showStatus(`Added "${def?.name || spellId}" to ${team?.name || 'Team ' + teamId}`, 'success');
        this.updateTeamSpellInventory();
        this.renderSpellStats();
        this._populateTeamDropdown();
    }

    /** Remove spell from a team's hand by index */
    async removeSpellFromTeam(teamId, spellIndex) {
        if (!confirm('Remove this spell from team?')) return;

        const key = String(teamId);
        const pile = this._gameState.spellPiles?.[key];
        if (!pile || !pile.hand[spellIndex]) return;

        const removed = pile.hand.splice(spellIndex, 1)[0];
        await this._save();

        this._logAction('spell_removed_admin', 'spell', {
            teamId, spellId: removed, spellIndex
        }, { removedSpellId: removed });

        this._ui?.showStatus('Spell removed from team', 'success');
        this.updateTeamSpellInventory();
        this.renderSpellStats();
        this._populateTeamDropdown();
    }

    /** Distribute random spells to all teams */
    async distributeRandomSpells() {
        await this._ensureDefs();

        if (this._spellDefs.length === 0 || !this._gameState.teams?.length) {
            this._ui?.showStatus('Load spells and game first', 'error');
            return;
        }

        const count = prompt('How many spells per team?', '3');
        if (!count) return;

        const spellsPerTeam = parseInt(count);
        if (isNaN(spellsPerTeam) || spellsPerTeam < 1) {
            this._ui?.showStatus('Invalid number', 'error');
            return;
        }

        const gs = this._gameState;
        gs.spellPiles = gs.spellPiles || {};

        for (const team of gs.teams) {
            const key = String(team.id);
            if (!gs.spellPiles[key]) {
                gs.spellPiles[key] = { drawPile: [], hand: [], usedPile: [] };
            }

            for (let i = 0; i < spellsPerTeam; i++) {
                const randomSpell = this._spellDefs[Math.floor(Math.random() * this._spellDefs.length)];
                gs.spellPiles[key].hand.push(randomSpell.id);
            }
        }

        await this._save();

        this._logAction('spell_distributed', 'spell', {
            method: 'admin_random', spellsPerTeam
        }, { bulkDistribution: true });

        this._ui?.showStatus(`Distributed ${spellsPerTeam} random spells to each team`, 'success');
        this.renderSpellsTab();
    }

    // ==================================================================
    // Spell Phase Turn Management (Task 1.17)
    // ==================================================================

    /**
     * Begin the spell phase: calculate turn order (reverse standings),
     * set spellPhase state, and save.
     */
    beginSpellPhase() {
        const gs = this._gameState;
        const teams = gs.teams || [];

        // Check if any team has spells
        const piles = gs.spellPiles || {};
        const anyHand = Object.values(piles).some(p => p.hand && p.hand.length > 0);
        if (!anyHand) {
            // No team has spells — auto-complete the spell phase
            gs.spellPhase = {
                isActive: false,
                turnOrder: [],
                currentTeamIndex: 0,
                teamsCompleted: [],
                roundStartTeam: null
            };
            this._save();
            this._onPhaseChanged();
            return;
        }

        // Turn order: reverse standings (last place goes first — catch-up mechanic)
        const sorted = [...teams].sort((a, b) => (a.points || 0) - (b.points || 0));
        const turnOrder = sorted.map(t => t.id);

        const prevSpellPhase = gs.spellPhase ? { ...gs.spellPhase } : null;

        gs.spellPhase = {
            isActive: true,
            turnOrder: turnOrder,
            currentTeamIndex: 0,
            teamsCompleted: [],
            roundStartTeam: turnOrder[0]
        };

        this._save();
        this._logAction('spell_phase_started', 'spell', {
            turnOrder, roundNumber: gs.currentPhase?.roundNumber
        }, { spellPhaseBefore: prevSpellPhase });
    }

    /** Get the team ID whose turn it currently is */
    getCurrentSpellTeam() {
        const sp = this._gameState.spellPhase;
        if (!sp || !sp.isActive) return null;
        return sp.turnOrder?.[sp.currentTeamIndex] || null;
    }

    /**
     * Mark a team's spell turn as completed and advance to next.
     * @param {number|string} teamId
     */
    completeTeamTurn(teamId) {
        const sp = this._gameState.spellPhase;
        if (!sp || !sp.isActive) return;

        const tid = typeof teamId === 'string' ? parseInt(teamId) : teamId;
        if (!sp.teamsCompleted.includes(tid)) {
            sp.teamsCompleted.push(tid);
        }

        // Advance to next uncompleted team
        this._advanceTurnIndex();

        this._save();
        this._onPhaseChanged(); // Will auto-advance phase if all done
    }

    /** Admin: force-skip a team's spell turn */
    skipTeamTurn(teamId) {
        this._logAction('spell_turn_skipped', 'spell', { teamId }, { currentTeamIndex: this._gameState.spellPhase?.currentTeamIndex });
        this.completeTeamTurn(teamId);
    }

    /** Admin: force end the entire spell phase */
    forceEndSpellPhase() {
        const sp = this._gameState.spellPhase;
        if (!sp) return;

        const prevSpellPhase = { ...sp, teamsCompleted: [...sp.teamsCompleted] };
        sp.teamsCompleted = [...(sp.turnOrder || [])];
        sp.isActive = false;

        this._logAction('spell_phase_forced_end', 'spell', {}, { spellPhase: prevSpellPhase });
        this._save();
        this._onPhaseChanged();
    }

    /** Advance currentTeamIndex to next uncompleted team */
    _advanceTurnIndex() {
        const sp = this._gameState.spellPhase;
        if (!sp || !sp.isActive) return;

        for (let i = sp.currentTeamIndex + 1; i < sp.turnOrder.length; i++) {
            if (!sp.teamsCompleted.includes(sp.turnOrder[i])) {
                sp.currentTeamIndex = i;
                return;
            }
        }
        // All done
        sp.currentTeamIndex = sp.turnOrder.length;
    }

    /**
     * Called from GodApp.updateDisplay() — detect when a team completed
     * via team.html direct Firestore write and advance turn index.
     */
    checkTurnAdvancement() {
        const sp = this._gameState.spellPhase;
        if (!sp || !sp.isActive) return;

        const currentTeam = sp.turnOrder?.[sp.currentTeamIndex];
        if (currentTeam !== undefined && sp.teamsCompleted?.includes(currentTeam)) {
            this._advanceTurnIndex();
            this._save();
            this._onPhaseChanged();
        }
    }

    // ==================================================================
    // Spell Casting (admin side — from god.html)
    // ==================================================================

    /**
     * Execute a spell's effect. Called after a team casts a spell.
     * Dispatches to the appropriate handler based on effect type.
     * @param {string} spellId
     * @param {number|string} castByTeamId
     * @param {Object} targetData
     * @returns {Object} result
     */
    executeSpellEffect(spellId, castByTeamId, targetData) {
        const def = this.getSpellDef(spellId);
        if (!def) return { success: false, error: 'Unknown spell' };

        const effect = def.effect;
        if (!effect) return { success: false, error: 'No effect defined' };

        const gs = this._gameState;
        gs.activeEffects = gs.activeEffects || [];

        switch (effect.type) {
            case 'multiplier':
                return this._createActiveEffect(def, castByTeamId, targetData, 'buff');
            case 'destroy_adjacent':
                return this._handleDestroyAdjacent(def, castByTeamId, targetData);
            case 'streak_bonus':
                return this._createActiveEffect(def, castByTeamId, targetData, 'buff');
            case 'shield':
                return this._createActiveEffect(def, castByTeamId, targetData, 'buff');
            case 'copy_spell':
                return this._handleCopySpell(def, castByTeamId, targetData);
            case 'challenge':
                return this._createActiveEffect(def, castByTeamId, targetData, 'special');
            case 'bonus_points':
                return this._handleBonusPoints(def, castByTeamId, targetData);
            case 'ban':
                return this._createActiveEffect(def, castByTeamId, targetData, 'condition');
            case 'modifier':
                return this._createActiveEffect(def, castByTeamId, targetData, 'modifier');
            case 'permanent_buff':
                return this._createActiveEffect(def, castByTeamId, targetData, 'buff');
            case 'extra_placement':
                return this._handleExtraPlacement(def, castByTeamId, targetData);
            case 'charged_removal':
                return this._handleChargedRemoval(def, castByTeamId, targetData);
            case 'silence':
                return this._createActiveEffect(def, castByTeamId, targetData, 'condition');
            case 'bet':
                return this._handleBet(def, castByTeamId, targetData);
            case 'counter':
                return this._handleCounter(def, castByTeamId, targetData);
            case 'reposition':
                return this._handleReposition(def, castByTeamId, targetData);
            case 'reveal_hands':
                return this._handleRevealHands(def, castByTeamId, targetData);
            case 'first_heart_roll':
                return this._handleFirstHeartRoll(def, castByTeamId, targetData);
            case 'conditional_bonus':
                return this._handleConditionalBonus(def, castByTeamId, targetData);
            case 'placement_lockout':
                return this._handlePlacementLockout(def, castByTeamId, targetData);
            case 'random_mass_removal':
                return this._handleRandomMassRemoval(def, castByTeamId, targetData);
            case 'conditional_card_grab':
                return this._handleConditionalCardGrab(def, castByTeamId, targetData);
            case 'fill_adjacent_to_heart':
                return this._handleFillAdjacentToHeart(def, castByTeamId, targetData);
            case 'heart_lock':
                return this._handleHeartLock(def, castByTeamId, targetData);
            case 'force_redraw':
                return this._handleForceRedraw(def, castByTeamId, targetData);
            case 'temporary_capture':
                return this._handleTemporaryCapture(def, castByTeamId, targetData);
            case 'forced_removal_condition':
                return this._handleForcedRemovalCondition(def, castByTeamId, targetData);
            case 'marked_relocation_charge':
                return this._handleMarkedRelocationCharge(def, castByTeamId, targetData);
            case 'piggyback_condition':
                return this._handlePiggybackCondition(def, castByTeamId, targetData);
            case 'evasion_condition':
                return this._handleEvasionCondition(def, castByTeamId, targetData);
            case 'blind_card_swap':
                return this._handleBlindCardSwap(def, castByTeamId, targetData);
            case 'win_streak_bonus':
                return this._handleWinStreakBonus(def, castByTeamId, targetData);
            case 'rematch':
                return this._handleRematch(def, castByTeamId, targetData);
            case 'replay_used_pile':
                return this._handleReplayUsedPile(def, castByTeamId, targetData);
            case 'reminder':
                return this._createActiveEffect(def, castByTeamId, targetData, 'condition');
            default:
                return this._createActiveEffect(def, castByTeamId, targetData, 'condition');
        }
    }

    /**
     * @param {number|string} teamId
     * @returns {boolean} true if `teamId` currently has an active,
     *   unexpired 'shield' effect (Haltiasuoja / Elf Protection — see Sarja5).
     *   Checked by every tile-destruction path (_handleDestroyAdjacent,
     *   useChargedRemoval, _handleRandomMassRemoval, and extra_placement's
     *   destroy_occupied restriction) so the card actually protects, rather
     *   than being purely informational like it was before Sarja5.
     */
    _isShielded(teamId) {
        return (this._gameState.activeEffects || []).some(e => {
            if (e.isExpired || String(e.castByTeamId) !== String(teamId)) return false;
            return this.getSpellDef(e.spellId)?.effect?.type === 'shield';
        });
    }

    /** Handle destroy_adjacent — immediately removes enemy tiles from board */
    _handleDestroyAdjacent(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const board = gs.board || {};
        const destroyed = [];

        // Find all tiles owned by the casting team
        for (const [coord, tileTeamId] of Object.entries(board)) {
            if (String(tileTeamId) === String(castByTeamId)) {
                const neighbors = this._getHexNeighbors(coord);
                for (const nCoord of neighbors) {
                    if (board[nCoord] !== undefined
                        && String(board[nCoord]) !== String(castByTeamId)
                        && !this._isShielded(board[nCoord])) {
                        const wasHeart = !!gs.heartHexControl?.[nCoord];
                        destroyed.push({ coord: nCoord, teamId: board[nCoord], wasHeart });
                        delete board[nCoord];
                        // Also clear heart control
                        if (wasHeart) {
                            delete gs.heartHexControl[nCoord];
                        }
                    }
                }
            }
        }

        if (destroyed.length > 0) {
            this._logAction('spell_board_effect', 'spell', {
                spellId: def.id, castByTeamId,
                destroyedTiles: destroyed
            }, { destroyedTiles: destroyed });
        }

        // Also create an active effect record for history
        this._createActiveEffect(def, castByTeamId, targetData, 'board');

        return { success: true, destroyed };
    }

    /** Handle bonus_points — award points per controlled heart */
    _handleBonusPoints(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const control = gs.heartHexControl || {};
        let hearts = 0;

        for (const owner of Object.values(control)) {
            if (String(owner) === String(castByTeamId)) hearts++;
        }

        if (hearts > 0) {
            const team = gs.teams?.find(t => String(t.id) === String(castByTeamId));
            if (team) {
                const prevPoints = team.points || 0;
                team.points = prevPoints + hearts;

                this._logAction('points_awarded', 'points', {
                    teamId: castByTeamId,
                    teamName: team.name,
                    amount: hearts,
                    reason: `Spell: ${def.name} (${hearts} hearts controlled)`
                }, { points: prevPoints });
            }
        }

        this._createActiveEffect(def, castByTeamId, targetData, 'board');
        return { success: true, heartsControlled: hearts, pointsAwarded: hearts };
    }

    /**
     * Handle extra_placement — places one or more tiles directly onto the
     * board for the casting team. Used by both the existing "Knowledge from
     * the Deep" placeholder card (2 tiles, no_hearts_adjacent/no_opponent_adjacent
     * restrictions) and Taikuuden nälkä / Katalyyttiavain (sarja2-k4, sarja2-k5).
     *
     * @param {Object} targetData
     * @param {string[]} targetData.coords        Hex coordinates to place on,
     *   admin-supplied (this card family always needs a placement choice —
     *   there's no way to infer "where" from board state alone).
     * @param {string}  [targetData.discardSpellId] Optional: a card id to
     *   discard from the caster's hand as part of this cast (Taikuuden nälkä).
     * @param {boolean} [targetData.holdingMountainHeart] Fallback attestation
     *   used only when def.effect.requiresMountainHeart is set AND no
     *   boardManager was injected (so hex types can't be looked up directly)
     *   — see _isControllingMountainHeart().
     */
    _handleExtraPlacement(def, castByTeamId, targetData) {
        const gs = this._gameState;
        gs.board = gs.board || {};

        if (def.effect?.requiresMountainHeart) {
            const controlling = this._isControllingMountainHeart(castByTeamId);
            if (controlling === false) {
                return { success: false, error: "Must be holding Mountain's Heart to cast this" };
            }
            if (controlling === null && !targetData?.holdingMountainHeart) {
                return { success: false, error: "Must be holding Mountain's Heart to cast this (unverified — no board module wired, admin must attest)" };
            }
        }

        // Jäljitys / sarja3-k1: only castable while at least one of the
        // caster's tiles already touches an opponent's.
        if (def.effect?.requiresTouchingOpponentTile) {
            const teamIdForCheck = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
            const gsBoard = gs.board || {};
            const alreadyTouching = Object.entries(gsBoard).some(([coord, owner]) =>
                String(owner) === String(teamIdForCheck) && this._isAdjacentToOpponent(coord, teamIdForCheck)
            );
            if (!alreadyTouching) {
                return { success: false, error: 'None of your tiles touch an opponent tile yet' };
            }
        }

        const amount = def.effect?.amount || 1;
        const restrictions = def.effect?.restrictions || [];
        const destroyOccupied = restrictions.includes('destroy_occupied');
        const coords = Array.isArray(targetData?.coords) ? targetData.coords.slice(0, amount) : [];

        if (coords.length < amount) {
            return { success: false, error: `Need ${amount} hex coordinate(s), got ${coords.length}` };
        }

        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const { placed, destroyed, rejected } = this._placeTilesAt(coords, teamId, restrictions, destroyOccupied);

        // Optional discard cost (Taikuuden nälkä / sarja2-k4)
        let discarded = null;
        if (targetData?.discardSpellId) {
            const pile = gs.spellPiles?.[String(teamId)];
            const idx = pile?.hand?.indexOf(targetData.discardSpellId) ?? -1;
            if (idx >= 0) {
                discarded = pile.hand.splice(idx, 1)[0];
                pile.usedPile = pile.usedPile || [];
                pile.usedPile.push(discarded);
            }
        }

        if (placed.length > 0) {
            this._logAction('spell_tiles_placed', 'spell', {
                spellId: def.id, castByTeamId: teamId, placed, destroyed, discarded
            }, { placed, destroyed, discarded });
        }

        this._createActiveEffect(def, castByTeamId, targetData, 'board');
        return { success: placed.length > 0, placed, destroyed, rejected, discarded };
    }

    _isAdjacentToAnyHeart(coord) {
        const gs = this._gameState;
        return this._getHexNeighbors(coord).some(n => gs.heartHexControl?.[n] !== undefined);
    }

    _isAdjacentToOpponent(coord, castByTeamId) {
        const gs = this._gameState;
        return this._getHexNeighbors(coord).some(n =>
            gs.board?.[n] !== undefined && String(gs.board[n]) !== String(castByTeamId)
        );
    }

    /**
     * Compute the coords eligible for a hex-picker field on the Process
     * modal / Active Effects action buttons, for the field types wired up
     * so far. `formState` carries in-progress picks from the same field set
     * (e.g. reposition's `to` step needs the `from` hex already chosen).
     * Reuses the same algorithm BoardManager.highlightValidPlacements()
     * uses (generateHexCoordinates() -> canPlaceAt(q, r, teamId)), exposed
     * as pure data instead of DOM highlighting.
     * @returns {string[]} coords in "qXrY" format
     */
    getValidHexesForField(effectType, fieldKey, def, castByTeamId, formState = {}) {
        const gs = this._gameState;
        const board = gs.board || {};
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;

        if (effectType === 'extra_placement' && fieldKey === 'coords') {
            if (!this._board) return [];
            return this._board.generateHexCoordinates()
                .filter(([q, r]) => this._board.canPlaceAt(q, r, teamId))
                .map(([q, r]) => `q${q}r${r}`);
        }

        if (effectType === 'reposition' && fieldKey === 'moves') {
            if (formState.from) {
                // "to" step: neighbors of the already-chosen "from" hex.
                return this._getHexNeighbors(formState.from);
            }
            // "from" step: hexes the casting team currently occupies.
            return Object.entries(board)
                .filter(([, owner]) => String(owner) === String(teamId))
                .map(([coord]) => coord);
        }

        return [];
    }

    /**
     * Pure placement loop shared by _handleExtraPlacement and
     * _handleConditionalBonus (Ylimielistä tietoa / sarja4-k1 — a fixed
     * points+tiles reward, not a restriction-gated placement). Does not log
     * or create an active effect itself — callers own that, since the two
     * callers need different log shapes/messages.
     */
    _placeTilesAt(coords, teamId, restrictions, destroyOccupied) {
        const gs = this._gameState;
        gs.board = gs.board || {};
        const placed = [];
        const destroyed = [];
        const rejected = [];

        for (const coord of coords) {
            const occupant = gs.board[coord];
            if (occupant !== undefined) {
                if (String(occupant) === String(teamId)) {
                    rejected.push({ coord, reason: 'Already your own tile' });
                    continue;
                }
                if (!destroyOccupied) {
                    rejected.push({ coord, reason: 'Hex already occupied' });
                    continue;
                }
                if (this._isShielded(occupant)) {
                    rejected.push({ coord, reason: 'Target team is shielded (Haltiasuoja)' });
                    continue;
                }
                const wasHeart = !!gs.heartHexControl?.[coord];
                destroyed.push({ coord, teamId: occupant, wasHeart });
                if (wasHeart) delete gs.heartHexControl[coord];
            } else {
                if (restrictions.includes('no_hearts_adjacent') && this._isAdjacentToAnyHeart(coord)) {
                    rejected.push({ coord, reason: 'Adjacent to a heart hex' });
                    continue;
                }
                if (restrictions.includes('no_opponent_adjacent') && this._isAdjacentToOpponent(coord, teamId)) {
                    rejected.push({ coord, reason: 'Adjacent to an opponent tile' });
                    continue;
                }
                if (restrictions.includes('must_touch_opponent') && !this._isAdjacentToOpponent(coord, teamId)) {
                    rejected.push({ coord, reason: 'Must be adjacent to an opponent tile' });
                    continue;
                }
            }

            gs.board[coord] = teamId;
            placed.push(coord);
        }

        return { placed, destroyed, rejected };
    }

    /**
     * Handle charged_removal — creates a multi-use active effect. Covers
     * both Glock 17 / sarja2-k1 (10 charges, requires the target to touch
     * one of the caster's own tiles) and Perus poisto / sarja6-k8 (2
     * charges, no adjacency requirement at all — set
     * def.effect.requiresAdjacency: false). The cast itself just puts the
     * tracked charge counter into play; each actual tile removal happens
     * later via useChargedRemoval(), one admin-triggered use at a time,
     * since which enemy tile to remove isn't known at cast time.
     */
    _handleChargedRemoval(def, castByTeamId, targetData) {
        const charges = def.effect?.charges || 1;
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'charged');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) {
            effect.usesRemaining = charges;
            effect.requiresAdjacency = def.effect?.requiresAdjacency !== false;
        }
        return { success: true, effectId: result.effectId, usesRemaining: charges };
    }

    /**
     * Admin: spend one charge of an active charged_removal effect to destroy
     * a single opponent tile — adjacent to one of the casting team's own
     * tiles unless the effect was created with requiresAdjacency: false
     * (Perus poisto / sarja6-k8, which can remove any tile on the board).
     * Reuses the exact same 'spell_board_effect' log shape _handleDestroyAdjacent
     * uses, so this gets the same undo-manager.js revert support for free.
     * @param {string} effectId
     * @param {string} targetCoord  The opponent tile to remove
     */
    useChargedRemoval(effectId, targetCoord) {
        const gs = this._gameState;
        const effect = (gs.activeEffects || []).find(e => e.id === effectId);
        if (!effect || effect.isExpired) return { success: false, error: 'Effect not found or already expired' };
        if (!(effect.usesRemaining > 0)) return { success: false, error: 'No charges remaining' };

        const board = gs.board || {};
        const occupant = board[targetCoord];
        if (occupant === undefined) return { success: false, error: 'Target hex is empty' };
        if (String(occupant) === String(effect.castByTeamId)) {
            return { success: false, error: "Can't target your own tile" };
        }
        if (this._isShielded(occupant)) {
            return { success: false, error: 'Target team is shielded (Haltiasuoja)' };
        }
        if (effect.requiresAdjacency !== false) {
            const touchesOwnTile = this._getHexNeighbors(targetCoord).some(n =>
                String(board[n]) === String(effect.castByTeamId)
            );
            if (!touchesOwnTile) {
                return { success: false, error: "Target must be adjacent to one of your own tiles" };
            }
        }

        const wasHeart = !!gs.heartHexControl?.[targetCoord];
        const destroyed = [{ coord: targetCoord, teamId: occupant, wasHeart }];
        delete board[targetCoord];
        if (wasHeart) delete gs.heartHexControl[targetCoord];

        effect.usesRemaining -= 1;
        if (effect.usesRemaining <= 0) effect.isExpired = true;

        this._logAction('spell_board_effect', 'spell', {
            spellId: effect.spellId, castByTeamId: effect.castByTeamId, destroyedTiles: destroyed
        }, { destroyedTiles: destroyed });

        return { success: true, destroyed, usesRemaining: effect.usesRemaining };
    }

    /**
     * Handle reposition — moves up to N of the casting team's own tiles to
     * new (empty) hexes, without adding or destroying any tiles overall
     * (Parempi reitti / sarja3-k3, up to 5; also used by the named cards
     * Rintama vaihtuu / Epävakaa todellisuus).
     * @param {Object} targetData
     * @param {{from: string, to: string}[]} targetData.moves
     */
    _handleReposition(def, castByTeamId, targetData) {
        const gs = this._gameState;
        gs.board = gs.board || {};
        const maxMoves = def.effect?.amount || 1;
        const moves = Array.isArray(targetData?.moves) ? targetData.moves.slice(0, maxMoves) : [];
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;

        // Rintama vaihtuu / N.4: the moved tiles must be a single connected
        // formation before the move (an arbitrary rotation/translation is
        // fine — the admin/team just states each tile's new hex directly,
        // which naturally covers "rotate" without any hex-rotation math).
        if (def.effect?.requiresConnectedFormation) {
            const fromCoords = moves.map(m => m?.from).filter(Boolean);
            if (fromCoords.length < maxMoves || !this._isConnectedFormation(fromCoords)) {
                return { success: false, error: `Need ${maxMoves} mutually-adjacent tiles you own` };
            }
        }

        const applied = [];
        const rejected = [];
        for (const move of moves) {
            const { from, to } = move || {};
            if (!from || !to) { rejected.push({ from, to, reason: 'Missing from/to' }); continue; }
            if (String(gs.board[from]) !== String(teamId)) {
                rejected.push({ from, to, reason: 'You do not own the from-tile' });
                continue;
            }
            if (gs.board[to] !== undefined) {
                rejected.push({ from, to, reason: 'Destination hex already occupied' });
                continue;
            }
            const wasHeart = !!gs.heartHexControl?.[from];
            delete gs.board[from];
            if (wasHeart) delete gs.heartHexControl[from];
            gs.board[to] = teamId;
            applied.push({ from, to, wasHeart });
        }

        if (applied.length > 0) {
            this._logAction('spell_tiles_repositioned', 'spell', {
                spellId: def.id, castByTeamId: teamId, applied
            }, { applied });
        }

        this._createActiveEffect(def, castByTeamId, targetData, 'board');
        return { success: applied.length > 0, applied, rejected };
    }

    /**
     * Handle counter — same tracked-reactive-effect shape as before, but now
     * also attaches a usesRemaining counter (default 1) so multi-use counter
     * cards (Taitava vastaisku / sarja3-k4, whose uses can be incremented
     * later by Kaikki alkoi kivestä / sarja3-k6's outcome 3) and single-use
     * ones (Rift of Deep Knowledge) share one consistent shape.
     */
    _handleCounter(def, castByTeamId, targetData) {
        const uses = def.effect?.uses || 1;
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'reactive');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.usesRemaining = uses;
        return { success: true, effectId: result.effectId, usesRemaining: uses };
    }

    /**
     * Admin: add extra uses to an already-active counter effect (used by
     * Kaikki alkoi kivestä / sarja3-k6's outcome 3, which grants Taitava
     * vastaisku +1 use — see _handleFirstHeartRoll()).
     */
    addChargesToEffect(effectId, amount) {
        const effect = (this._gameState.activeEffects || []).find(e => e.id === effectId);
        if (!effect || effect.isExpired) return { success: false, error: 'Effect not found or already expired' };
        effect.usesRemaining = (effect.usesRemaining || 0) + amount;
        this._logAction('spell_effect_charges_added', 'spell', {
            effectId, amount, spellId: effect.spellId
        }, { usesRemaining: effect.usesRemaining - amount });
        return { success: true, usesRemaining: effect.usesRemaining };
    }

    /**
     * Handle reveal_hands (Kysy yrteiltä / sarja3-k5) — snapshots every
     * team's current spell hand into the active-effect record. A one-time
     * reveal rather than a sustained "can see hands" permission: matches the
     * card's flavor (an instant look), and avoids needing a new always-on
     * visibility feature in team.html for what the physical card describes
     * as a single glance.
     */
    _handleRevealHands(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const piles = gs.spellPiles || {};
        const revealed = {};
        for (const [teamId, pile] of Object.entries(piles)) {
            revealed[teamId] = [...(pile.hand || [])];
        }
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'special');
        const effect = gs.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.revealedData = revealed;
        return { success: true, effectId: result.effectId, revealed };
    }

    /**
     * Handle first_heart_roll (Kaikki alkoi kivestä / sarja3-k6) — rolls a
     * d6 and applies one of 6 outcomes. Two outcomes are directly
     * implementable game-state changes (3: buff an active Taitava vastaisku
     * counter; 6: sweep every side-heart — never the mountain heart — to the
     * caster's control). The other four (placement range +1, draw-instead-
     * of-place, destroy-on-placement, free heart challenge) aren't backed by
     * any enforced rule elsewhere in the codebase yet, so they're recorded
     * as a tracked reminder buff rather than silently doing nothing.
     * @param {Object} [targetData]
     * @param {number} [targetData.roll] Admin/test override for the d6 roll;
     *   omitted in normal play, where the engine rolls for itself — this is
     *   a real random game event, not a judgment call, so there's nothing
     *   for an admin to attest to here.
     */
    _handleFirstHeartRoll(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const roll = Number.isInteger(targetData?.roll)
            ? targetData.roll
            : Math.floor(Math.random() * 6) + 1;

        const result = this._createActiveEffect(def, castByTeamId, { ...targetData, roll }, 'special');
        const effect = gs.activeEffects.find(e => e.id === result.effectId);

        const outcome = { roll };

        if (roll === 3) {
            const target = (gs.activeEffects || []).find(e =>
                !e.isExpired && e.spellId === 'sarja3-k4' && String(e.castByTeamId) === String(castByTeamId)
            );
            if (target) {
                const bump = this.addChargesToEffect(target.id, 1);
                outcome.boostedEffectId = target.id;
                outcome.usesRemaining = bump.usesRemaining;
            } else {
                outcome.note = 'No active Taitava vastaisku to boost';
            }
        } else if (roll === 6) {
            const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
            const control = gs.heartHexControl || {};
            const transferred = [];
            for (const coord of Object.keys(control)) {
                // Require an affirmative 'side-heart' match rather than just
                // excluding 'mountain-heart' — _getHexType() returns null
                // when no boardManager is wired, and treating "unknown" as
                // "safe to transfer" would risk sweeping the mountain heart
                // (or anything else) whenever hex-type lookup isn't available.
                if (this._getHexType(coord) !== 'side-heart') continue;
                const previousOwner = control[coord];
                if (String(previousOwner) === String(teamId)) continue;
                control[coord] = teamId;
                transferred.push({ coord, previousOwner });
            }
            outcome.transferred = transferred;
            if (transferred.length > 0) {
                this._logAction('spell_hearts_transferred', 'spell', {
                    spellId: def.id, castByTeamId: teamId, transferred
                }, { transferred });
            }
        }

        if (effect) effect.outcome = outcome;
        return { success: true, effectId: result.effectId, ...outcome };
    }

    /**
     * Handle conditional_bonus (Ylimielistä tietoa / sarja4-k1) — a fixed
     * points+tiles reward gated on a real-world condition (placement within
     * the winning side of a specific match) that spell-engine can't verify
     * itself, same category of judgment call as Sarja2/3's other
     * admin-attested preconditions.
     * @param {Object} targetData
     * @param {boolean} targetData.conditionMet  Admin attestation that the
     *   card's placement condition was actually met.
     * @param {string[]} [targetData.coords]      Required when the bonus
     *   includes tiles — reuses the same placement loop as extra_placement.
     */
    _handleConditionalBonus(def, castByTeamId, targetData) {
        if (!targetData?.conditionMet) {
            return { success: false, error: 'Condition not confirmed as met' };
        }

        const gs = this._gameState;
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const bonus = def.effect?.bonus || {};
        let pointsAwarded = 0;

        if (bonus.points) {
            const team = gs.teams?.find(t => String(t.id) === String(teamId));
            if (team) {
                const prevPoints = team.points || 0;
                team.points = prevPoints + bonus.points;
                pointsAwarded = bonus.points;
                this._logAction('points_awarded', 'points', {
                    teamId, teamName: team.name, amount: bonus.points,
                    reason: `Spell: ${def.name} (condition met)`
                }, { points: prevPoints });
            }
        }

        let placement = null;
        if (bonus.tiles) {
            const coords = Array.isArray(targetData?.coords) ? targetData.coords.slice(0, bonus.tiles) : [];
            if (coords.length < bonus.tiles) {
                return { success: pointsAwarded > 0, pointsAwarded, error: `Need ${bonus.tiles} hex coordinate(s) for the tile bonus, got ${coords.length}` };
            }
            placement = this._placeTilesAt(coords, teamId, [], false);
            if (placement.placed.length > 0) {
                this._logAction('spell_tiles_placed', 'spell', {
                    spellId: def.id, castByTeamId: teamId, placed: placement.placed, destroyed: [], discarded: null
                }, { placed: placement.placed, destroyed: [], discarded: null });
            }
        }

        this._createActiveEffect(def, castByTeamId, targetData, 'board');
        return { success: true, pointsAwarded, placement };
    }

    /**
     * Handle placement_lockout (Älä tule lähemmäs / sarja4-k2) — records
     * which hexes are locked and for how long as an active-effect reminder.
     * NOTE: this does not yet block actual placement — board-manager.js's
     * click-to-place flow has no hook into SpellEngine today, so enforcement
     * is manual (the admin/players honor the lock by eye) until that
     * validation hook is built. isHexLocked() is exposed so that follow-up
     * wiring has something to call.
     */
    _handlePlacementLockout(def, castByTeamId, targetData) {
        const coords = Array.isArray(targetData?.coords) ? targetData.coords : [];
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'condition');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.lockedHexes = coords;
        return { success: true, effectId: result.effectId, lockedHexes: coords };
    }

    /** @returns {boolean} true if `coord` is currently locked by an unexpired placement_lockout effect */
    isHexLocked(coord) {
        return (this._gameState.activeEffects || []).some(e =>
            !e.isExpired && Array.isArray(e.lockedHexes) && e.lockedHexes.includes(coord)
        );
    }

    /**
     * Handle random_mass_removal (Epävakaa loitsu / sarja4-k3) — rolls a d6:
     * 1-5 removes 3 tiles from the correspondingly-numbered team, 6 removes
     * 2 tiles from every OTHER team. Reuses the same 'spell_board_effect'
     * log shape as destroy_adjacent, so it gets undo support for free.
     * @param {Object} targetData
     * @param {number[]} targetData.teamOrder  Team ids in roll-number order
     *   1-5 (teamOrder[0] = "team 1", etc.) — there's no inherent 1-5
     *   numbering of teams in gameState, so the admin supplies it.
     * @param {string[]} targetData.coords     Which specific tiles to
     *   remove from the rolled target(s) — "remove 3 tiles" doesn't say
     *   which, so (consistent with every other other-team tile-removal
     *   card in this deck) the admin picks.
     */
    _handleRandomMassRemoval(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const roll = Number.isInteger(targetData?.roll) ? targetData.roll : Math.floor(Math.random() * 6) + 1;
        const casterTeamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const teamOrder = Array.isArray(targetData?.teamOrder) ? targetData.teamOrder : [];

        let targetTeamIds;
        let perTeamCap;
        if (roll <= 5) {
            const targetTeamId = teamOrder[roll - 1];
            if (targetTeamId === undefined) {
                return { success: false, error: `No team numbered ${roll} supplied in teamOrder`, roll };
            }
            targetTeamIds = [targetTeamId];
            perTeamCap = 3;
        } else {
            targetTeamIds = (gs.teams || []).map(t => t.id).filter(id => String(id) !== String(casterTeamId));
            perTeamCap = 2;
        }

        const coords = Array.isArray(targetData?.coords) ? targetData.coords : [];
        const destroyed = [];
        const rejected = [];
        const perTeamCount = {};

        for (const coord of coords) {
            const owner = gs.board?.[coord];
            if (owner === undefined) { rejected.push({ coord, reason: 'Empty hex' }); continue; }
            if (!targetTeamIds.some(id => String(id) === String(owner))) {
                rejected.push({ coord, reason: 'Not an eligible target-team tile' });
                continue;
            }
            if (this._isShielded(owner)) {
                rejected.push({ coord, reason: 'Target team is shielded (Haltiasuoja)' });
                continue;
            }
            const key = String(owner);
            perTeamCount[key] = perTeamCount[key] || 0;
            if (perTeamCount[key] >= perTeamCap) {
                rejected.push({ coord, reason: `Already removed ${perTeamCap} from this team` });
                continue;
            }
            const wasHeart = !!gs.heartHexControl?.[coord];
            destroyed.push({ coord, teamId: owner, wasHeart });
            delete gs.board[coord];
            if (wasHeart) delete gs.heartHexControl[coord];
            perTeamCount[key] += 1;
        }

        if (destroyed.length > 0) {
            this._logAction('spell_board_effect', 'spell', {
                spellId: def.id, castByTeamId, destroyedTiles: destroyed
            }, { destroyedTiles: destroyed });
        }

        const result = this._createActiveEffect(def, castByTeamId, { ...targetData, roll }, 'special');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.outcome = { roll, targetTeamIds, destroyed };

        return { success: true, roll, targetTeamIds, destroyed, rejected, effectId: result.effectId };
    }

    /**
     * Handle conditional_card_grab (Magian keskittymä / sarja4-k5) — a
     * 5-turn "hold Mountain's Heart for 2 turns" trial. Whether the trial
     * succeeded isn't something spell-engine can determine on its own (it
     * would need a hook that fires on every round boundary, checking heart
     * control continuity across turns — a bigger piece of infrastructure
     * than this one card justifies building alone), so success/failure is
     * an admin attestation, same as Ylimielistä tietoa's placement condition.
     * @param {Object} targetData
     * @param {boolean} targetData.succeeded
     * @param {{teamId: number|string, spellId: string, source: 'hand'|'usedPile'|'drawPile'}[]} targetData.picks
     */
    _handleConditionalCardGrab(def, castByTeamId, targetData) {
        if (!targetData?.succeeded) {
            return { success: false, error: 'Trial not confirmed as succeeded' };
        }

        const gs = this._gameState;
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const amount = def.effect?.amount || 1;
        const picks = Array.isArray(targetData?.picks) ? targetData.picks.slice(0, amount) : [];

        const casterPile = gs.spellPiles?.[String(teamId)];
        if (!casterPile) return { success: false, error: 'Caster has no spell pile' };
        casterPile.hand = casterPile.hand || [];

        const taken = [];
        const rejected = [];
        for (const pick of picks) {
            const { teamId: fromTeamId, spellId, source } = pick || {};
            const pile = gs.spellPiles?.[String(fromTeamId)];
            const list = pile?.[source];
            const idx = Array.isArray(list) ? list.indexOf(spellId) : -1;
            if (idx < 0) { rejected.push({ ...pick, reason: 'Not found at that source' }); continue; }
            list.splice(idx, 1);
            casterPile.hand.push(spellId);
            taken.push({ teamId: fromTeamId, spellId, source });
        }

        if (taken.length > 0) {
            this._logAction('spell_cards_taken', 'spell', {
                spellId: def.id, castByTeamId: teamId, taken
            }, { taken });
        }

        this._createActiveEffect(def, castByTeamId, targetData, 'special');
        return { success: taken.length > 0, taken, rejected };
    }

    /**
     * Handle copy_spell (Kaikki on minun suunnitelmaani / sarja5-k1, matches
     * the existing "All According to My Plan" placeholder) — admin picks a
     * card from any team's used pile and this actually re-executes that
     * spell's effect for the casting team, right now, with fresh targetData.
     * Before this, copy_spell only ever created an informational reminder;
     * the physical card text ("pelaa se välittömästi omana korttinasi" —
     * "play it immediately as your own card") means it has to really run.
     * @param {Object} targetData
     * @param {string} targetData.spellId  The used-pile spell id to copy —
     *   everything else in targetData is passed straight through to that
     *   spell's own handler (e.g. coords for an extra_placement copy).
     */
    _handleCopySpell(def, castByTeamId, targetData) {
        const copiedSpellId = targetData?.spellId;
        if (!copiedSpellId) return { success: false, error: 'No spell selected to copy' };

        const copiedDef = this.getSpellDef(copiedSpellId);
        if (!copiedDef) return { success: false, error: 'Unknown spell to copy' };
        if (copiedDef.effect?.type === 'copy_spell') {
            return { success: false, error: "Can't copy another copy_spell card" };
        }

        const { spellId: _drop, ...copyTargetData } = targetData || {};
        const copiedResult = this.executeSpellEffect(copiedSpellId, castByTeamId, copyTargetData);

        this._logAction('spell_copied', 'spell', {
            spellId: def.id, castByTeamId, copiedSpellId
        }, { note: `Copied ${copiedDef.name} via ${def.name}` });

        this._createActiveEffect(def, castByTeamId, targetData, 'special');
        return { success: copiedResult?.success !== false, copiedSpellId, copiedResult };
    }

    /**
     * Handle fill_adjacent_to_heart (Muinaiset puolustusmekanismit /
     * sarja5-k5) — fills every currently-empty hex adjacent to a heart the
     * caster just captured with their own tiles. Reuses _placeTilesAt with
     * no restrictions, since every candidate hex is pre-filtered to empty.
     * @param {Object} targetData
     * @param {string} targetData.heartCoord  The heart hex just captured —
     *   must currently be controlled by the casting team.
     */
    _handleFillAdjacentToHeart(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const heartCoord = targetData?.heartCoord;
        if (!heartCoord) return { success: false, error: 'No heart hex specified' };
        if (String(gs.heartHexControl?.[heartCoord]) !== String(castByTeamId)) {
            return { success: false, error: 'You do not currently control that heart hex' };
        }

        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const emptyNeighbors = this._getHexNeighbors(heartCoord).filter(c => (gs.board || {})[c] === undefined);
        const { placed, destroyed, rejected } = this._placeTilesAt(emptyNeighbors, teamId, [], false);

        if (placed.length > 0) {
            this._logAction('spell_tiles_placed', 'spell', {
                spellId: def.id, castByTeamId: teamId, placed, destroyed: [], discarded: null
            }, { placed, destroyed: [], discarded: null });
        }

        this._createActiveEffect(def, castByTeamId, targetData, 'board');
        return { success: true, placed, rejected, heartCoord };
    }

    /**
     * Handle heart_lock (Lukossa / sarja6-k2) — locks a specific heart hex
     * (challenge/capture/points/spell-advancement all blocked while locked,
     * per the card text) for a fixed duration. Same scope decision as
     * placement_lockout: this records the lock and exposes isHeartLocked()
     * for other code to query, but doesn't itself reach into
     * board-manager.js's challenge/capture flow or result-manager.js's
     * heart-income scoring — wiring enforcement into those is a larger,
     * higher-blast-radius change than a single card justifies making
     * unreviewed.
     * @param {Object} targetData
     * @param {string} targetData.heartCoord
     */
    _handleHeartLock(def, castByTeamId, targetData) {
        const heartCoord = targetData?.heartCoord;
        if (!heartCoord) return { success: false, error: 'No heart hex specified' };

        const result = this._createActiveEffect(def, castByTeamId, targetData, 'condition');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.lockedHeartCoord = heartCoord;
        return { success: true, effectId: result.effectId, heartCoord };
    }

    /** @returns {boolean} true if `coord` is currently locked by an unexpired heart_lock effect */
    isHeartLocked(coord) {
        return (this._gameState.activeEffects || []).some(e =>
            !e.isExpired && e.lockedHeartCoord === coord
        );
    }

    /**
     * Handle force_redraw (Vaihtoon / sarja6-k4) — pulls a named card out of
     * a team's hand, shuffles it back into their draw pile, and has them
     * draw a replacement (via the existing drawSpell(), so this correctly
     * interacts with any active double-draw modifier or an empty-pile
     * recycle exactly like a normal draw would). Snapshots the whole target
     * pile before mutating it so undo can restore exact pre-shuffle state
     * rather than trying to reverse a shuffle.
     * @param {Object} targetData
     * @param {number|string} targetData.teamId  Whose hand to pull from
     * @param {string} targetData.spellId        Which card to exchange
     */
    _handleForceRedraw(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const targetTeamId = targetData?.teamId;
        const spellId = targetData?.spellId;
        if (targetTeamId === undefined || targetTeamId === null || !spellId) {
            return { success: false, error: 'Need a target team and card' };
        }

        const pile = gs.spellPiles?.[String(targetTeamId)];
        if (!pile) return { success: false, error: 'No spell pile for that team' };
        const idx = (pile.hand || []).indexOf(spellId);
        if (idx < 0) return { success: false, error: "Card not found in that team's hand" };

        const handBefore = [...(pile.hand || [])];
        const drawPileBefore = [...(pile.drawPile || [])];
        const usedPileBefore = [...(pile.usedPile || [])];

        // Card text order matters here: "sen omistaja nostaa uuden kortin
        // pakastaan, laittaa valitun kortin nostopakkaan ja sekoittaa sen" —
        // draw the replacement FIRST, then shuffle the exchanged card back
        // in. Doing it the other way around would let the team draw the
        // very card they just gave up right back out of the shuffle.
        pile.hand.splice(idx, 1);
        const drawn = this.drawSpell(targetTeamId, 1);
        pile.drawPile = this._shuffleArray([...(pile.drawPile || []), spellId]);

        this._logAction('spell_forced_redraw', 'spell', {
            spellId: def.id, castByTeamId, targetTeamId, exchangedSpellId: spellId, drawn
        }, { targetTeamId, handBefore, drawPileBefore, usedPileBefore });

        this._createActiveEffect(def, castByTeamId, targetData, 'special');
        return { success: true, exchangedSpellId: spellId, drawn };
    }

    /**
     * Handle temporary_capture (Epävakaa todellisuus / N.3 named card) —
     * takes control of two mutually-adjacent opponent tiles (at least one
     * of which must touch the caster's own board presence), then removes
     * both from the game entirely after 2 rounds via expireConditions()'s
     * removeCoordsOnExpiry handling — not returned to the original owner.
     * @param {Object} targetData
     * @param {string[]} targetData.coords  Exactly 2 adjacent opponent hexes
     */
    _handleTemporaryCapture(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const coords = Array.isArray(targetData?.coords) ? targetData.coords.slice(0, 2) : [];
        if (coords.length < 2) return { success: false, error: 'Need exactly 2 opponent tile coordinates' };
        const [c1, c2] = coords;

        const owner1 = gs.board?.[c1];
        const owner2 = gs.board?.[c2];
        if (owner1 === undefined || owner2 === undefined) {
            return { success: false, error: 'Both hexes must currently be occupied' };
        }
        if (String(owner1) === String(teamId) || String(owner2) === String(teamId)) {
            return { success: false, error: "Can't target your own tiles" };
        }
        if (this._isShielded(owner1) || this._isShielded(owner2)) {
            return { success: false, error: 'Target team is shielded (Haltiasuoja)' };
        }
        if (!this._getHexNeighbors(c1).includes(c2)) {
            return { success: false, error: 'The two tiles must be adjacent to each other' };
        }
        const touchesCaster = this._getHexNeighbors(c1).some(n => String(gs.board?.[n]) === String(teamId))
            || this._getHexNeighbors(c2).some(n => String(gs.board?.[n]) === String(teamId));
        if (!touchesCaster) return { success: false, error: 'Neither tile touches one of your own' };

        const captured = [
            { coord: c1, previousOwner: owner1, wasHeart: !!gs.heartHexControl?.[c1] },
            { coord: c2, previousOwner: owner2, wasHeart: !!gs.heartHexControl?.[c2] }
        ];
        for (const cap of captured) {
            gs.board[cap.coord] = teamId;
            if (cap.wasHeart) gs.heartHexControl[cap.coord] = teamId;
        }

        this._logAction('spell_tiles_captured', 'spell', {
            spellId: def.id, castByTeamId: teamId, captured
        }, { captured });

        const result = this._createActiveEffect(def, castByTeamId, targetData, 'board');
        const effect = gs.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.removeCoordsOnExpiry = [c1, c2];

        return { success: true, captured, effectId: result.effectId };
    }

    /**
     * Handle forced_removal_condition (Katso kuinka se kuolee / N.1 named
     * card) — tracks a 2-round obligation on a target team ("must remove
     * one of their own tiles after every game they lose"). Enforcement
     * needs a hook into future match-loss events that doesn't exist yet
     * (same scope decision as heart_lock/placement_lockout): this records
     * the condition and exposes hasForcedRemovalObligation() +
     * applyForcedRemoval() for whoever is running the tournament to check
     * and act on when a qualifying loss actually happens.
     */
    _handleForcedRemovalCondition(def, castByTeamId, targetData) {
        const targetTeamId = targetData?.targetTeamId;
        if (targetTeamId === undefined || targetTeamId === null) {
            return { success: false, error: 'No target team specified' };
        }
        if (this._isShielded(targetTeamId)) {
            return { success: false, error: 'Target team is shielded (Haltiasuoja)' };
        }
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'condition');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.conditionTargetTeamId = targetTeamId;
        return { success: true, effectId: result.effectId, targetTeamId };
    }

    /** @returns {boolean} true if `teamId` currently owes a forced-removal obligation */
    hasForcedRemovalObligation(teamId) {
        return (this._gameState.activeEffects || []).some(e =>
            !e.isExpired
            && e.conditionTargetTeamId !== undefined
            && String(e.conditionTargetTeamId) === String(teamId)
            && this.getSpellDef(e.spellId)?.effect?.type === 'forced_removal_condition'
        );
    }

    /** Admin: enforce the obligation — remove one of the obligated team's own tiles after a qualifying loss. */
    applyForcedRemoval(effectId, coord) {
        const gs = this._gameState;
        const effect = (gs.activeEffects || []).find(e => e.id === effectId);
        if (!effect || effect.isExpired) return { success: false, error: 'Effect not found or already expired' };

        const targetTeamId = effect.conditionTargetTeamId;
        const occupant = gs.board?.[coord];
        if (String(occupant) !== String(targetTeamId)) {
            return { success: false, error: 'Coordinate is not owned by the obligated team' };
        }

        const wasHeart = !!gs.heartHexControl?.[coord];
        const destroyed = [{ coord, teamId: occupant, wasHeart }];
        delete gs.board[coord];
        if (wasHeart) delete gs.heartHexControl[coord];

        this._logAction('spell_board_effect', 'spell', {
            spellId: effect.spellId, castByTeamId: effect.castByTeamId, destroyedTiles: destroyed
        }, { destroyedTiles: destroyed });

        return { success: true, destroyed };
    }

    /**
     * Handle marked_relocation_charge (Vettähän se vain oli / N.2 named
     * card) — the "mark up to 2 tiles" phase. Marking is real and
     * immediate; the actual relocation happens later via
     * resolveMarkedRelocation(), triggered by the "game-win tile-removal"
     * event the card refers to, which (like the other future-trigger cards
     * in this deck) has no automatic hook — an admin calls it when that
     * moment comes.
     */
    _handleMarkedRelocationCharge(def, castByTeamId, targetData) {
        const charges = def.effect?.charges || 1;
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'charged');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) { effect.usesRemaining = charges; effect.markedCoords = []; }
        return { success: true, effectId: result.effectId, usesRemaining: charges };
    }

    /** Admin: mark any occupied tile (own or opponent's) for later relocation, spending one charge. */
    markTileForRelocation(effectId, coord) {
        const gs = this._gameState;
        const effect = (gs.activeEffects || []).find(e => e.id === effectId);
        if (!effect || effect.isExpired) return { success: false, error: 'Effect not found or already expired' };
        if (!(effect.usesRemaining > 0)) return { success: false, error: 'No marks remaining' };
        if (gs.board?.[coord] === undefined) return { success: false, error: 'Hex is empty' };

        effect.markedCoords.push(coord);
        effect.usesRemaining -= 1;
        return { success: true, markedCoords: [...effect.markedCoords], usesRemaining: effect.usesRemaining };
    }

    /**
     * Admin: resolve a marked-tile relocation once the triggering event
     * occurs — each marked tile moves to an adjacent hex, destroying
     * (respecting shield) whatever's there.
     * @param {string} effectId
     * @param {{from: string, to: string}[]} moves
     */
    resolveMarkedRelocation(effectId, moves) {
        const gs = this._gameState;
        const effect = (gs.activeEffects || []).find(e => e.id === effectId);
        if (!effect) return { success: false, error: 'Effect not found' };

        const applied = [];
        const destroyed = [];
        const rejected = [];
        for (const move of (moves || [])) {
            const { from, to } = move || {};
            if (!effect.markedCoords?.includes(from)) {
                rejected.push({ from, to, reason: 'Tile was not marked' });
                continue;
            }
            if (!this._getHexNeighbors(from).includes(to)) {
                rejected.push({ from, to, reason: 'Destination must be adjacent to the marked tile' });
                continue;
            }
            const owner = gs.board?.[from];
            if (owner === undefined) {
                rejected.push({ from, to, reason: 'Marked tile is no longer on the board' });
                continue;
            }

            const destOccupant = gs.board?.[to];
            if (destOccupant !== undefined) {
                if (this._isShielded(destOccupant)) {
                    rejected.push({ from, to, reason: 'Destination team is shielded (Haltiasuoja)' });
                    continue;
                }
                const destWasHeart = !!gs.heartHexControl?.[to];
                destroyed.push({ coord: to, teamId: destOccupant, wasHeart: destWasHeart });
                if (destWasHeart) delete gs.heartHexControl[to];
            }

            const fromWasHeart = !!gs.heartHexControl?.[from];
            delete gs.board[from];
            if (fromWasHeart) delete gs.heartHexControl[from];
            gs.board[to] = owner;
            applied.push({ from, to, owner, wasHeart: fromWasHeart });
        }

        if (applied.length > 0 || destroyed.length > 0) {
            this._logAction('spell_marked_tiles_relocated', 'spell', {
                spellId: effect.spellId, castByTeamId: effect.castByTeamId, applied, destroyed
            }, { applied, destroyed });
        }

        effect.isExpired = true;
        return { success: applied.length > 0, applied, destroyed, rejected };
    }

    /**
     * Handle piggyback_condition (Rinnalla loppuun asti / N.5 named card) —
     * tracks a 2-round condition on a target team. Whenever that team
     * places tiles (an event with no digital hook — same category as every
     * other cross-turn trigger in this deck), an admin calls
     * grantPiggybackPlacement() to let the caster place a matching number.
     */
    _handlePiggybackCondition(def, castByTeamId, targetData) {
        const targetTeamId = targetData?.targetTeamId;
        if (targetTeamId === undefined || targetTeamId === null) {
            return { success: false, error: 'No target team specified' };
        }
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'condition');
        const effect = this._gameState.activeEffects.find(e => e.id === result.effectId);
        if (effect) effect.piggybackOnTeamId = targetTeamId;
        return { success: true, effectId: result.effectId, targetTeamId };
    }

    /** Admin: grant the caster a matching placement after the piggyback-condition's target team places tiles. */
    grantPiggybackPlacement(effectId, coords) {
        const gs = this._gameState;
        const effect = (gs.activeEffects || []).find(e => e.id === effectId);
        if (!effect || effect.isExpired) return { success: false, error: 'Effect not found or already expired' };

        const teamId = effect.castByTeamId;
        const { placed, destroyed, rejected } = this._placeTilesAt(coords || [], teamId, [], false);
        if (placed.length > 0) {
            this._logAction('spell_tiles_placed', 'spell', {
                spellId: effect.spellId, castByTeamId: teamId, placed, destroyed: [], discarded: null
            }, { placed, destroyed: [], discarded: null });
        }
        return { success: placed.length > 0, placed, rejected };
    }

    /**
     * Handle evasion_condition (Vaistonvarainen väistö / N.6 named card) —
     * tracks a 3-round "your tiles dodge instead of dying" condition and
     * exposes the detection primitives (_hasEvasion, _findEvasionHex) other
     * code would need to actually redirect a destruction into a relocation.
     * Deliberately NOT wired into _handleDestroyAdjacent / useChargedRemoval
     * / _handleRandomMassRemoval in this pass — those three paths are
     * already shipped, tested, and exercised by many other cards; retrofitting
     * a relocate-instead-of-destroy branch into all three risked a subtle
     * regression that a single unattended pass isn't the right place to
     * introduce. The primitives are real and tested on their own; wiring
     * them into the destroy paths is a good, bounded follow-up.
     */
    _handleEvasionCondition(def, castByTeamId, targetData) {
        const result = this._createActiveEffect(def, castByTeamId, targetData, 'buff');
        return { success: true, effectId: result.effectId };
    }

    /** @returns {boolean} true if `teamId` currently has an active, unexpired evasion_condition effect */
    _hasEvasion(teamId) {
        return (this._gameState.activeEffects || []).some(e => {
            if (e.isExpired || String(e.castByTeamId) !== String(teamId)) return false;
            return this.getSpellDef(e.spellId)?.effect?.type === 'evasion_condition';
        });
    }

    /**
     * Breadth-first search outward from `origin` (up to 4 rings) for the
     * nearest empty hex not itself adjacent to any of `teamId`'s opponents
     * — a reasonable, simplified stand-in for the card's "farther from the
     * remover's tiles" (true opponent-distance-maximizing placement would
     * need to know which specific tiles are "the remover's," which isn't
     * available at this layer).
     * @returns {string|null}
     */
    _findEvasionHex(origin, teamId) {
        const gs = this._gameState;
        const visited = new Set([origin]);
        let frontier = [origin];
        for (let ring = 0; ring < 4; ring++) {
            const next = [];
            for (const coord of frontier) {
                for (const n of this._getHexNeighbors(coord)) {
                    if (visited.has(n)) continue;
                    visited.add(n);
                    next.push(n);
                    if (gs.board?.[n] === undefined && !this._isAdjacentToOpponent(n, teamId)) {
                        return n;
                    }
                }
            }
            frontier = next;
        }
        return null;
    }

    /**
     * Handle blind_card_swap (Tuhoa suunnitelmat / N.7 named card) — two
     * independent random swaps: (1) two chosen teams blindly trade a random
     * card with each other, and (2) optionally, the caster trades a card
     * they choose with a random card from a team of their choice. "Blind"
     * here is genuinely random (Math.random-based index pick), not an
     * admin judgment call — there's nothing to attest to.
     * @param {Object} targetData
     * @param {number|string} targetData.teamAId
     * @param {number|string} targetData.teamBId
     * @param {string} [targetData.casterSpellId]     Caster's own card to offer, if doing swap 2
     * @param {number|string} [targetData.casterSwapTeamId]  Who the caster swaps with, if doing swap 2
     */
    _handleBlindCardSwap(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const { teamAId, teamBId, casterSpellId, casterSwapTeamId } = targetData || {};
        if (teamAId === undefined || teamBId === undefined) {
            return { success: false, error: 'Need two teams for the blind swap' };
        }
        const pileA = gs.spellPiles?.[String(teamAId)];
        const pileB = gs.spellPiles?.[String(teamBId)];
        if (!pileA?.hand?.length || !pileB?.hand?.length) {
            return { success: false, error: 'Both teams need at least one card in hand' };
        }

        const idxA = Math.floor(Math.random() * pileA.hand.length);
        const idxB = Math.floor(Math.random() * pileB.hand.length);
        const cardA = pileA.hand[idxA];
        const cardB = pileB.hand[idxB];
        pileA.hand[idxA] = cardB;
        pileB.hand[idxB] = cardA;

        let casterSwap = null;
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        if (casterSpellId && casterSwapTeamId !== undefined) {
            const casterPile = gs.spellPiles?.[String(teamId)];
            const targetPile = gs.spellPiles?.[String(casterSwapTeamId)];
            const casterIdx = casterPile?.hand?.indexOf(casterSpellId) ?? -1;
            if (casterIdx >= 0 && targetPile?.hand?.length) {
                const targetIdx = Math.floor(Math.random() * targetPile.hand.length);
                const targetCard = targetPile.hand[targetIdx];
                casterPile.hand[casterIdx] = targetCard;
                targetPile.hand[targetIdx] = casterSpellId;
                casterSwap = {
                    casterTeamId: teamId, casterIdx, casterGave: casterSpellId,
                    withTeamId: casterSwapTeamId, targetIdx, casterGot: targetCard
                };
            }
        }

        this._logAction('spell_blind_swap', 'spell', {
            spellId: def.id, castByTeamId: teamId,
            teamASwap: { teamAId, teamBId, idxA, idxB, cardA, cardB },
            casterSwap
        }, {
            teamASwap: { teamAId, teamBId, idxA, idxB, cardA, cardB },
            casterSwap
        });

        this._createActiveEffect(def, castByTeamId, targetData, 'special');
        return { success: true, teamASwap: { cardA, cardB }, casterSwap };
    }

    /**
     * Handle win_streak_bonus (Priimus / N.8 named card) — awards escalating
     * bonus tiles for consecutive wins (1 tile from the 2nd win, 2 from the
     * 3rd). Which win-streak level the team has reached isn't something
     * spell-engine tracks on its own (same "admin confirms it, one shot"
     * treatment the very first design round settled on for Domination x3's
     * near-identical streak-tracking problem, rather than building
     * per-game increment UI).
     * @param {Object} targetData
     * @param {2|3} targetData.streakLevel
     * @param {string[]} targetData.coords  1 coord for streakLevel 2, 2 for streakLevel 3
     */
    _handleWinStreakBonus(def, castByTeamId, targetData) {
        const streakLevel = targetData?.streakLevel;
        if (streakLevel !== 2 && streakLevel !== 3) {
            return { success: false, error: 'streakLevel must be 2 or 3' };
        }
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const tileAmount = streakLevel === 2 ? 1 : 2;
        const coords = Array.isArray(targetData?.coords) ? targetData.coords.slice(0, tileAmount) : [];
        if (coords.length < tileAmount) {
            return { success: false, error: `Need ${tileAmount} hex coordinate(s) for this streak level` };
        }

        const { placed, destroyed, rejected } = this._placeTilesAt(coords, teamId, [], false);
        if (placed.length > 0) {
            this._logAction('spell_tiles_placed', 'spell', {
                spellId: def.id, castByTeamId: teamId, placed, destroyed: [], discarded: null
            }, { placed, destroyed: [], discarded: null });
        }

        this._createActiveEffect(def, castByTeamId, { ...targetData, streakLevel }, 'board');
        return { success: placed.length > 0, streakLevel, placed, rejected };
    }

    /**
     * Handle bet (Vedonlyöntiä syvyyksissä / sarja6-k7, matches the existing
     * "Betting from the Depths" placeholder) — resolves a pre-written
     * betting slip. How many of the predictions came true isn't something
     * spell-engine can verify (they're about the underlying video-game
     * match, same category as every other admin-attested condition in this
     * deck), so the admin reports the count and this awards/penalizes
     * accordingly. Reuses points_awarded / spell_tiles_placed /
     * spell_board_effect for every mutation, so all of it is undoable
     * through the existing paths with no new undo type needed.
     * @param {Object} targetData
     * @param {number} targetData.correctCount  0..def.effect.predictions
     * @param {string[]} [targetData.coords]           Bonus-tile placements, if any correct guesses award tiles
     * @param {string[]} [targetData.selfDestroyCoords] Which of the caster's own tiles to destroy on a 0/N result
     */
    _handleBet(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const teamId = typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId;
        const predictions = def.effect?.predictions || 1;
        const correctCount = Number.isInteger(targetData?.correctCount) ? targetData.correctCount : null;
        if (correctCount === null || correctCount < 0 || correctCount > predictions) {
            return { success: false, error: `correctCount must be an integer 0-${predictions}` };
        }

        let pointsAwarded = 0;
        let placement = null;
        let destroyed = [];

        if (correctCount > 0) {
            const perCorrect = def.effect?.reward_per_correct || {};
            pointsAwarded = (perCorrect.points || 0) * correctCount;
            if (pointsAwarded > 0) {
                const team = gs.teams?.find(t => String(t.id) === String(teamId));
                if (team) {
                    const prevPoints = team.points || 0;
                    team.points = prevPoints + pointsAwarded;
                    this._logAction('points_awarded', 'points', {
                        teamId, teamName: team.name, amount: pointsAwarded,
                        reason: `Spell: ${def.name} (${correctCount}/${predictions} correct)`
                    }, { points: prevPoints });
                }
            }

            const tileAmount = (perCorrect.tiles || 0) * correctCount;
            if (tileAmount > 0) {
                const coords = Array.isArray(targetData?.coords) ? targetData.coords.slice(0, tileAmount) : [];
                placement = this._placeTilesAt(coords, teamId, [], false);
                if (placement.placed.length > 0) {
                    this._logAction('spell_tiles_placed', 'spell', {
                        spellId: def.id, castByTeamId: teamId, placed: placement.placed, destroyed: [], discarded: null
                    }, { placed: placement.placed, destroyed: [], discarded: null });
                }
            }
        } else if (def.effect?.penalty_all_wrong?.destroy_tiles) {
            const n = def.effect.penalty_all_wrong.destroy_tiles;
            const coords = Array.isArray(targetData?.selfDestroyCoords) ? targetData.selfDestroyCoords.slice(0, n) : [];
            for (const coord of coords) {
                if (String(gs.board?.[coord]) !== String(teamId)) continue;
                const wasHeart = !!gs.heartHexControl?.[coord];
                destroyed.push({ coord, teamId, wasHeart });
                delete gs.board[coord];
                if (wasHeart) delete gs.heartHexControl[coord];
            }
            if (destroyed.length > 0) {
                this._logAction('spell_board_effect', 'spell', {
                    spellId: def.id, castByTeamId, destroyedTiles: destroyed
                }, { destroyedTiles: destroyed });
            }
        }

        this._createActiveEffect(def, castByTeamId, { ...targetData, correctCount }, 'special');
        return { success: true, correctCount, pointsAwarded, placement, destroyed };
    }

    /**
     * Handle rematch — fully reverts a confirmed match's result (points,
     * hex claims, queue status) and puts it back into a replayable state.
     *
     * Does NOT reimplement any revert logic itself: it delegates to the
     * injected deps.revertMatchByGameId callback, which (on the page(s)
     * where it's wired) runs the exact same undo path "Undo Last Action"
     * uses for a 'match_result_confirmed' log entry (see undo-manager.js).
     * This keeps SpellEngine free of any direct UndoManager/action-log
     * knowledge, consistent with the rest of this file's DI pattern.
     *
     * @param {Object} def          Spell definition
     * @param {number|string} castByTeamId
     * @param {Object} targetData   Expects { gameId } — the queue-entry /
     *   match id (matchId) of the confirmed match to revert. Also accepts
     *   { matchId } as an alias.
     * @returns {Object|Promise<Object>} result — a Promise when the
     *   callback itself returns one (reverting a match requires an async
     *   Firestore/action-log lookup on the pages where this is wired), a
     *   plain object otherwise. Callers must be prepared to `await` the
     *   return value of executeSpellEffect('rematch', ...).
     */
    _handleRematch(def, castByTeamId, targetData) {
        const gameId = targetData?.gameId ?? targetData?.matchId;
        if (gameId === undefined || gameId === null || gameId === '') {
            return { success: false, error: 'No match selected for rematch' };
        }

        if (!this._revertMatch) {
            return {
                success: false,
                error: 'Rematch is not available on this page (no revert capability wired)'
            };
        }

        const finish = (result) => {
            if (result && result.success) {
                this._logAction('spell_rematch_triggered', 'spell', {
                    spellId: def.id, castByTeamId, gameId
                }, { note: 'Match result reverted via Rematch spell' });

                this._createActiveEffect(def, castByTeamId, targetData, 'special');
                return { success: true, gameId };
            }
            return { success: false, error: result?.error || 'Rematch failed: could not revert match' };
        };

        const outcome = this._revertMatch(gameId);
        if (outcome && typeof outcome.then === 'function') {
            return outcome.then(finish);
        }
        return finish(outcome);
    }

    /**
     * Handle replay_used_pile (Vuori Puhuu / "The Mountain Speaks", sarja1-k1) —
     * immediately re-executes every spell currently in the casting team's
     * usedPile, EXCEPT entries whose effect needs additional input this
     * handler can't supply on its own (a target hex, a challenge outcome, a
     * betting-slip result, a card to copy, a match to revert, or another
     * replay_used_pile — the last excluded to avoid recursive replay loops).
     * Those are returned as `skipped` for the admin to resolve individually
     * via their own Process controls, same as any other card of that type.
     * @returns {Object} result with { replayed: string[], skipped: {spellId, reason}[] }
     */
    _handleReplayUsedPile(def, castByTeamId, targetData) {
        const NEEDS_INPUT = new Set([
            'challenge', 'bet', 'copy_spell', 'rematch', 'extra_placement',
            'destroy_adjacent', 'replay_used_pile'
        ]);

        const gs = this._gameState;
        const pile = gs.spellPiles?.[String(castByTeamId)];
        const usedPile = pile?.usedPile || [];

        const replayed = [];
        const skipped = [];

        for (const spellId of usedPile) {
            const usedDef = this.getSpellDef(spellId);
            const effectType = usedDef?.effect?.type;
            if (!usedDef || !effectType) {
                skipped.push({ spellId, reason: 'Unknown spell definition' });
                continue;
            }
            if (NEEDS_INPUT.has(effectType)) {
                skipped.push({ spellId, reason: 'Needs a target/choice — process manually' });
                continue;
            }
            this.executeSpellEffect(spellId, castByTeamId, {});
            replayed.push(spellId);
        }

        this._logAction('spell_used_pile_replayed', 'spell', {
            spellId: def.id, castByTeamId, replayed, skipped
        }, { note: 'Vuori Puhuu replay' });

        this._createActiveEffect(def, castByTeamId, targetData, 'special');
        return { success: true, replayed, skipped };
    }

    /**
     * Admin: process a spell-history entry whose effect needs an explicit
     * admin-side trigger (currently only 'rematch' — casting writes the
     * cast to Firestore via team-controls.js's castSpellViaFirestore, but
     * nothing calls executeSpellEffect() automatically; this is the god.html
     * "Process" button's handler). Idempotent on SUCCESS only: an entry
     * already marked result.processed is skipped rather than re-executed
     * (reverting the same match twice would hit UndoManager's "Already
     * undone" guard anyway, but this avoids even trying). A FAILED attempt
     * is deliberately left unmarked/retriable — most failure reasons here
     * are deterministic (already undone, no match selected) so a retry is
     * harmless, and a transient Firestore hiccup shouldn't permanently
     * strand the admin without a way to retry mid-event.
     * @param {string} timestamp  entry.timestamp — used to locate the entry
     *   in gameState.spellHistory (entries have no other stable id)
     * @returns {Promise<Object>} the executeSpellEffect() result
     */
    async processPendingSpellCast(timestamp) {
        const gs = this._gameState;
        const history = gs.spellHistory || [];
        const entry = history.find(h => h.timestamp === timestamp);

        if (!entry) return { success: false, error: 'Spell cast not found' };
        if (entry.result?.processed) return { success: false, error: 'Already processed' };

        const outcome = await this.executeSpellEffect(entry.spellId, entry.teamId, entry.targetData);

        entry.result = outcome?.success
            ? { ...(entry.result || {}), ...outcome, processed: true }
            : { ...(entry.result || {}), ...outcome, processed: false };
        await this._save();
        this.renderSpellHistory();
        this._ui?.showStatus(
            outcome?.success ? `${entry.spellName || entry.spellId} processed` : (outcome?.error || 'Processing failed'),
            outcome?.success ? 'success' : 'error'
        );
        return outcome;
    }

    /**
     * Create an active effect entry (covers Type B conditions and tracked buffs).
     * @returns {Object} result with effectId
     */
    _createActiveEffect(def, castByTeamId, targetData, category) {
        const gs = this._gameState;
        gs.activeEffects = gs.activeEffects || [];

        const effectEntry = {
            id: `eff_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            spellId: def.id,
            spellName: def.name,
            spellNameEn: def.nameEn,
            category: category, // 'condition', 'buff', 'modifier', 'reactive', 'board', 'special'
            castByTeamId: typeof castByTeamId === 'string' ? parseInt(castByTeamId) : castByTeamId,
            castInRound: gs.currentPhase?.roundNumber || 0,
            target: targetData || {},
            displayText: this._buildDisplayText(def, castByTeamId, targetData),
            icon: this._getEffectIcon(def),
            expiresAfterRound: this._calculateExpiry(def),
            isExpired: false
        };

        gs.activeEffects.push(effectEntry);
        return { success: true, effectId: effectEntry.id };
    }

    /** Build human-readable display text for an active effect */
    _buildDisplayText(def, castByTeamId, targetData) {
        const gs = this._gameState;
        const casterTeam = gs.teams?.find(t => String(t.id) === String(castByTeamId));
        const casterName = casterTeam?.name || 'Team ' + castByTeamId;

        const effectType = def.effect?.type;

        if (effectType === 'ban' && targetData?.bannedElement) {
            const targetTeam = gs.teams?.find(t => String(t.id) === String(targetData.targetTeamId));
            return `${targetTeam?.name || 'Team'} cannot use "${targetData.bannedElement}" next match`;
        }

        if (effectType === 'silence' && targetData?.targetPlayerName) {
            return `${targetData.targetPlayerName} cannot speak or use mic next match`;
        }

        if (effectType === 'shield') {
            return `${casterName}'s tiles are protected until next round`;
        }

        if (effectType === 'multiplier') {
            return `${casterName}: 2x points & tiles if top 2 finish`;
        }

        if (effectType === 'streak_bonus') {
            return `${casterName}: 3 wins in a row = +2 tiles +2 points`;
        }

        if (effectType === 'permanent_buff') {
            return `${casterName}: each heart capture = +1 bonus point`;
        }

        if (effectType === 'charged_removal') {
            const charges = def.effect?.charges || 0;
            return `${casterName}: ${charges} charges to destroy an adjacent enemy tile`;
        }

        if (effectType === 'counter') {
            // Generic — this shape now covers both Rift of Deep Knowledge
            // (blocks an opponent's draw) and Taitava vastaisku / sarja3-k4
            // (blocks an opponent's played spell from resolving), which
            // read very differently; fall back to the card's own text
            // rather than assuming either meaning.
            return `${casterName}: ${def.nameEn || def.name} ready`;
        }

        if (effectType === 'modifier') {
            return `${casterName}: next room hex draw = double cards`;
        }

        if (effectType === 'reminder' && targetData?.targetPlayerName) {
            return `${targetData.targetPlayerName}: ${def.nameEn || def.name} in effect next match`;
        }

        if (effectType === 'replay_used_pile') {
            return `${casterName} replayed spells from their used pile`;
        }

        if (effectType === 'reposition') {
            return `${casterName} repositioned tiles on the board`;
        }

        if (effectType === 'reveal_hands') {
            return `${casterName} revealed every team's hand`;
        }

        if (effectType === 'first_heart_roll') {
            const roll = targetData?.roll;
            return `${casterName} rolled ${roll ?? '?'} on their first side-heart capture`;
        }

        if (effectType === 'conditional_bonus') {
            return `${casterName}: ${def.nameEn || def.name} condition confirmed`;
        }

        if (effectType === 'placement_lockout') {
            const n = targetData?.coords?.length || 0;
            return `${casterName} locked ${n} hex(es) from placement`;
        }

        if (effectType === 'random_mass_removal') {
            const roll = targetData?.roll;
            return `${casterName} rolled ${roll ?? '?'} on ${def.nameEn || def.name}`;
        }

        if (effectType === 'conditional_card_grab') {
            return `${casterName}: ${def.nameEn || def.name} trial confirmed`;
        }

        if (effectType === 'copy_spell') {
            const copiedName = targetData?.spellId ? this.getSpellDef(targetData.spellId)?.name : null;
            return `${casterName} copied ${copiedName || 'an opponent\'s used spell'}`;
        }

        if (effectType === 'fill_adjacent_to_heart') {
            return `${casterName} filled the hexes around a captured heart`;
        }

        if (effectType === 'heart_lock') {
            return `${casterName} locked ${targetData?.heartCoord || 'a heart'} for 2 turns`;
        }

        if (effectType === 'force_redraw') {
            return `${casterName} forced a card exchange`;
        }

        if (effectType === 'bet') {
            const c = targetData?.correctCount;
            return `${casterName}: bet resolved (${c ?? '?'}/${def.effect?.predictions ?? '?'} correct)`;
        }

        if (effectType === 'rematch') {
            const matchLabel = targetData?.matchNumber ? `Match ${targetData.matchNumber}` : 'the match';
            return `${casterName} reverted ${matchLabel} for a rematch`;
        }

        // Generic fallback
        return `${casterName} cast ${def.nameEn || def.name}`;
    }

    /** Get emoji icon for effect type */
    _getEffectIcon(def) {
        const type = def.effect?.type;
        const icons = {
            multiplier: ICON_SVGS.sparkles,
            destroy_adjacent: ICON_SVGS.bomb,
            streak_bonus: ICON_SVGS.flame,
            shield: ICON_SVGS.shield,
            copy_spell: ICON_SVGS.copy,
            challenge: ICON_SVGS.swords,
            bonus_points: ICON_SVGS.star,
            ban: ICON_SVGS.ban,
            modifier: ICON_SVGS.dices,
            permanent_buff: ICON_SVGS.gem,
            extra_placement: ICON_SVGS.puzzle,
            silence: ICON_SVGS.volumeX,
            bet: ICON_SVGS.coins,
            counter: ICON_SVGS.shield,
            rematch: ICON_SVGS.undo2,
            replay_used_pile: ICON_SVGS.undo2,
            reminder: ICON_SVGS.wandSparkles,
            charged_removal: ICON_SVGS.bomb,
            reposition: ICON_SVGS.puzzle,
            reveal_hands: ICON_SVGS.copy,
            first_heart_roll: ICON_SVGS.dices,
            conditional_bonus: ICON_SVGS.star,
            placement_lockout: ICON_SVGS.ban,
            random_mass_removal: ICON_SVGS.dices,
            conditional_card_grab: ICON_SVGS.gem,
            fill_adjacent_to_heart: ICON_SVGS.puzzle,
            heart_lock: ICON_SVGS.ban,
            force_redraw: ICON_SVGS.dices,
            temporary_capture: ICON_SVGS.swords,
            forced_removal_condition: ICON_SVGS.ban,
            marked_relocation_charge: ICON_SVGS.puzzle,
            piggyback_condition: ICON_SVGS.copy,
            evasion_condition: ICON_SVGS.shield,
            blind_card_swap: ICON_SVGS.dices,
            win_streak_bonus: ICON_SVGS.flame
        };
        return icons[type] || ICON_SVGS.wandSparkles;
    }

    /** Calculate when an effect expires */
    _calculateExpiry(def) {
        const timing = def.timing;
        const currentRound = this._gameState.currentPhase?.roundNumber || 0;

        if (def.effect?.type === 'permanent_buff') return null;   // Permanent
        if (def.effect?.type === 'counter') return null;          // Until used
        if (def.effect?.type === 'streak_bonus') return null;     // Until streak breaks
        if (def.effect?.type === 'charged_removal') return null;  // Until usesRemaining <= 0

        // Most effects expire after next round
        if (timing === 'pre-game' || timing === 'post-game' || timing === 'placement') {
            return currentRound + 1;
        }

        if (def.effect?.type === 'shield') return currentRound + 1;
        if (def.effect?.type === 'modifier') return currentRound + 2; // Lasts until used

        // Cards with an explicit effect.duration (in rounds/turns) — e.g.
        // placement_lockout (2), heart_lock (2) — use it directly instead
        // of the generic +1 default.
        if (Number.isInteger(def.effect?.duration)) {
            return currentRound + def.effect.duration;
        }

        return currentRound + 1; // Default: expire after current + 1 round
    }

    // ==================================================================
    // Condition Expiry
    // ==================================================================

    /** Expire active effects whose round has passed. Called at round_start. */
    expireConditions() {
        const gs = this._gameState;
        if (!gs.activeEffects || gs.activeEffects.length === 0) return;

        const currentRound = gs.currentPhase?.roundNumber || 0;
        let changed = false;

        for (const eff of gs.activeEffects) {
            if (!eff.isExpired && eff.expiresAfterRound != null && currentRound > eff.expiresAfterRound) {
                eff.isExpired = true;
                changed = true;

                // Epävakaa todellisuus / sarja-N.3 (temporary_capture): the
                // captured tiles are removed from the game entirely once the
                // effect's duration runs out, not returned to their
                // original owner — see _handleTemporaryCapture().
                let removed = null;
                if (Array.isArray(eff.removeCoordsOnExpiry) && eff.removeCoordsOnExpiry.length > 0) {
                    gs.board = gs.board || {};
                    removed = eff.removeCoordsOnExpiry
                        .filter(coord => gs.board[coord] !== undefined)
                        .map(coord => {
                            const teamId = gs.board[coord];
                            const wasHeart = !!gs.heartHexControl?.[coord];
                            delete gs.board[coord];
                            if (wasHeart) delete gs.heartHexControl[coord];
                            return { coord, teamId, wasHeart };
                        });
                    if (removed.length > 0) {
                        this._logAction('spell_board_effect', 'spell', {
                            spellId: eff.spellId, castByTeamId: eff.castByTeamId, destroyedTiles: removed
                        }, { destroyedTiles: removed });
                    }
                }

                this._logAction('condition_expired', 'spell', {
                    effectId: eff.id, spellName: eff.spellName
                }, { effect: { ...eff, isExpired: false } });
            }
        }

        // Clean up old expired effects (keep recent 2 rounds for history)
        gs.activeEffects = gs.activeEffects.filter(eff =>
            !eff.isExpired || (eff.expiresAfterRound != null && currentRound - eff.expiresAfterRound <= 2)
        );

        if (changed) this._save();
    }

    /** Admin: remove an active effect by ID */
    async removeActiveEffect(effectId) {
        const gs = this._gameState;
        const idx = (gs.activeEffects || []).findIndex(e => e.id === effectId);
        if (idx < 0) return;

        const removed = gs.activeEffects.splice(idx, 1)[0];

        this._logAction('condition_removed', 'spell', {
            effectId, spellName: removed.spellName
        }, { removedEffect: removed });

        await this._save();
        this._ui?.showStatus('Effect removed', 'success');
        this.renderActiveEffectsAdmin();
    }

    // ==================================================================
    // Hex neighbor utility
    // ==================================================================

    _getHexNeighbors(coordString) {
        const match = coordString.match(/q(-?\d+)r(-?\d+)/);
        if (!match) return [];

        const q = parseInt(match[1]);
        const r = parseInt(match[2]);

        const directions = [
            [1, 0], [1, -1], [0, -1],
            [-1, 0], [-1, 1], [0, 1]
        ];

        return directions.map(([dq, dr]) => `q${q + dq}r${r + dr}`);
    }

    /**
     * Hex-type lookup ('mountain-heart' | 'side-heart' | other/null) via the
     * injected boardManager (see BoardManager.getHexType() — a thin
     * passthrough to its own BoardModule). Returns null when boardManager
     * wasn't injected (e.g. admin.html contexts, or tests that don't need
     * it) — callers must treat null as "unknown", not "not a heart".
     */
    _getHexType(coordString) {
        if (!this._board?.getHexType) return null;
        const match = coordString.match(/q(-?\d+)r(-?\d+)/);
        if (!match) return null;
        return this._board.getHexType(parseInt(match[1]), parseInt(match[2]));
    }

    /**
     * @param {number|string} teamId
     * @returns {boolean|null} true/false when boardManager is wired and can
     *   confirm; null when it isn't, meaning "can't determine" — callers
     *   fall back to an admin attestation in that case rather than silently
     *   treating unknown as either true or false.
     */
    _isControllingMountainHeart(teamId) {
        if (!this._board?.getHexType) return null;
        const control = this._gameState.heartHexControl || {};
        for (const [coord, ownerId] of Object.entries(control)) {
            if (String(ownerId) === String(teamId) && this._getHexType(coord) === 'mountain-heart') {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {string[]} coords
     * @returns {boolean} true if every coord in `coords` is reachable from
     *   the others via adjacency-only steps within the same set (a single
     *   connected formation, not scattered tiles) — used by Rintama vaihtuu
     *   / N.4's "3 vierekkäistä" (3 mutually-adjacent tiles) requirement.
     */
    _isConnectedFormation(coords) {
        if (coords.length === 0) return false;
        const remaining = new Set(coords);
        const start = coords[0];
        const stack = [start];
        remaining.delete(start);
        while (stack.length > 0) {
            const current = stack.pop();
            for (const n of this._getHexNeighbors(current)) {
                if (remaining.has(n)) {
                    remaining.delete(n);
                    stack.push(n);
                }
            }
        }
        return remaining.size === 0;
    }

    // ==================================================================
    // Admin UI Rendering (god.html Spells tab)
    // ==================================================================

    /** Refresh all sections of the Spells tab */
    renderSpellsTab() {
        this.renderSpellStats();
        this.renderSpellLibrary();
        this._populateSpellDropdown();
        this._populateTeamDropdown();
        this.renderSpellHistory();
        this.renderActiveEffectsAdmin();
    }

    /** Update the stats counters at top of Spells tab */
    renderSpellStats() {
        const defEl = document.getElementById('totalSpellsDef');
        const heldEl = document.getElementById('totalSpellsHeld');
        const castEl = document.getElementById('totalSpellsCast');

        if (defEl) defEl.textContent = this._spellDefs.length || Object.keys(this._gameState.spellDefinitions || {}).length;

        if (heldEl) {
            let totalHeld = 0;
            const piles = this._gameState.spellPiles || {};
            for (const pile of Object.values(piles)) {
                totalHeld += (pile.hand || []).length;
            }
            heldEl.textContent = totalHeld;
        }

        if (castEl) {
            castEl.textContent = (this._gameState.spellHistory || []).length;
        }
    }

    /** Render spell library grid */
    renderSpellLibrary(filteredSpells) {
        const container = document.getElementById('spellsLibrary');
        if (!container) return;

        const spells = filteredSpells || this._spellDefs;
        if (!spells || spells.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 40px; grid-column: 1/-1;">No spells available. Click "Load Spell Definitions" to load.</p>';
            return;
        }

        container.innerHTML = spells.map(spell => `
            <div class="spell-card-display" style="
                background: rgba(168, 85, 247, 0.1);
                border: 2px solid rgba(168, 85, 247, 0.3);
                border-radius: 10px;
                padding: 15px;
                transition: all 0.3s ease;
                cursor: pointer;
            " onmouseover="this.style.transform='translateY(-5px)'; this.style.borderColor='#a855f7';"
               onmouseout="this.style.transform='translateY(0)'; this.style.borderColor='rgba(168, 85, 247, 0.3)';">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div style="font-weight: bold; color: #a855f7; font-size: 1.1rem;">
                        ${this._teams?.escapeHtml(spell.name) || spell.name}
                    </div>
                    <div style="background: rgba(168, 85, 247, 0.2); padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; color: #c4b5fd;">
                        ${spell.rarity || 'common'}
                    </div>
                </div>
                <div style="font-size: 0.75rem; color: #9aa1ad; text-transform: uppercase; margin-bottom: 8px;">
                    ${spell.type} &bull; ${spell.timing}
                </div>
                <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; margin-bottom: 10px;">
                    ${this._teams?.escapeHtml(spell.descriptionEn || spell.description) || spell.description}
                </div>
                <div style="font-size: 0.75rem; color: #64748b; font-style: italic;">
                    Target: ${spell.targetType}
                </div>
            </div>
        `).join('');
    }

    /** Filter spells by search + type */
    filterSpells() {
        const searchTerm = (document.getElementById('spellSearchInput')?.value || '').toLowerCase();
        const typeFilter = document.getElementById('spellTypeFilter')?.value || 'all';

        let filtered = this._spellDefs;

        if (searchTerm) {
            filtered = filtered.filter(s =>
                (s.name || '').toLowerCase().includes(searchTerm) ||
                (s.nameEn || '').toLowerCase().includes(searchTerm) ||
                (s.description || '').toLowerCase().includes(searchTerm) ||
                (s.descriptionEn || '').toLowerCase().includes(searchTerm)
            );
        }

        if (typeFilter !== 'all') {
            filtered = filtered.filter(s => s.type === typeFilter);
        }

        this.renderSpellLibrary(filtered);
    }

    /** Populate spell dropdown for distribution */
    _populateSpellDropdown() {
        const select = document.getElementById('spellToDistribute');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose Spell --</option>';
        this._spellDefs.forEach(spell => {
            const option = document.createElement('option');
            option.value = spell.id;
            option.textContent = `${spell.name} (${spell.type})`;
            select.appendChild(option);
        });

        select.onchange = () => {
            const spellId = select.value;
            if (spellId) {
                this.showSpellPreview(spellId);
                document.getElementById('distributeBtn').disabled = !document.getElementById('spellDistTeam')?.value;
            } else {
                const preview = document.getElementById('spellPreview');
                if (preview) preview.style.display = 'none';
                const btn = document.getElementById('distributeBtn');
                if (btn) btn.disabled = true;
            }
        };
    }

    /** Populate team dropdown for distribution */
    _populateTeamDropdown() {
        const select = document.getElementById('spellDistTeam');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose Team --</option>';
        const teams = this._gameState.teams || [];
        const piles = this._gameState.spellPiles || {};

        teams.forEach(team => {
            const pile = piles[String(team.id)];
            const handCount = pile?.hand?.length || 0;
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = `${team.name} (${handCount} spells)`;
            select.appendChild(option);
        });
    }

    /** Show spell preview for selected spell */
    showSpellPreview(spellId) {
        const spell = this.getSpellDef(spellId);
        if (!spell) return;

        const preview = document.getElementById('spellPreview');
        if (!preview) return;

        preview.style.display = 'block';
        preview.innerHTML = `
            <h4 style="margin: 0 0 8px 0; color: #a855f7;">${this._teams?.escapeHtml(spell.name) || spell.name}</h4>
            <div style="font-size: 0.75rem; color: #9aa1ad; margin-bottom: 8px;">
                ${spell.type} &bull; ${spell.rarity} &bull; ${spell.timing}
            </div>
            <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5;">
                ${this._teams?.escapeHtml(spell.descriptionEn || spell.description) || spell.description}
            </div>
        `;
    }

    /** Update team spell inventory display */
    updateTeamSpellInventory() {
        const teamIdStr = document.getElementById('spellDistTeam')?.value;
        if (!teamIdStr) return;

        const teamId = parseInt(teamIdStr);
        const container = document.getElementById('teamSpellsList');
        if (!container) return;

        const pile = this._gameState.spellPiles?.[String(teamId)];
        const hand = pile?.hand || [];

        if (hand.length === 0) {
            container.innerHTML = '<p style="opacity: 0.5; font-size: 0.85rem;">No spells in hand</p>';
            // Enable distribute button if spell is selected
            const spellSelected = document.getElementById('spellToDistribute')?.value;
            const btn = document.getElementById('distributeBtn');
            if (btn) btn.disabled = !spellSelected;
            return;
        }

        container.innerHTML = hand.map((spellId, index) => {
            const def = this.getSpellDef(spellId);
            const spellName = def ? (this._teams?.escapeHtml(def.name) || def.name) : spellId;

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: rgba(168, 85, 247, 0.1); border-radius: 6px; margin-bottom: 6px;">
                    <span style="font-size: 0.85rem;">${spellName}</span>
                    <button onclick="removeSpellFromTeam(${teamId}, ${index})"
                            style="padding: 4px 8px; background: #ef4444; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 0.75rem;">
                        Remove
                    </button>
                </div>
            `;
        }).join('');

        const spellSelected = document.getElementById('spellToDistribute')?.value;
        const btn = document.getElementById('distributeBtn');
        if (btn) btn.disabled = !spellSelected;
    }

    /** Render spell cast history */
    renderSpellHistory() {
        const container = document.getElementById('spellHistory');
        if (!container) return;

        const history = this._gameState.spellHistory || [];
        if (history.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.7;">No spells cast yet</p>';
            return;
        }

        container.innerHTML = history.slice().reverse().map(entry => {
            const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
            const def = this.getSpellDef(entry.spellId);
            // Spells whose effect needs an explicit admin trigger get a Process
            // button — casting itself only writes the Firestore cast record, it
            // doesn't call executeSpellEffect() on its own.
            const effectType = def?.effect?.type;
            const needsProcessing = PROCESSABLE_EFFECT_TYPES.has(effectType) && !entry.result?.processed;
            const processLabel = PROCESS_BUTTON_LABELS[effectType] || 'Process';
            return `
                <div style="padding: 10px; background: rgba(168, 85, 247, 0.1); border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #a855f7;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 5px;">
                        <strong style="color: #a855f7;">${this._teams?.escapeHtml(entry.spellName) || entry.spellName || ''}</strong>
                        <span style="font-size: 0.75rem; color: #64748b;">${time}</span>
                    </div>
                    <div style="font-size: 0.85rem; color: #cbd5e1;">
                        Cast by <strong>${this._teams?.escapeHtml(entry.teamName) || entry.teamName || ''}</strong>
                        ${entry.roundNumber ? ` (Round ${entry.roundNumber})` : ''}
                    </div>
                    ${entry.result?.changes?.note ? `
                        <div style="font-size: 0.75rem; color: #9aa1ad; margin-top: 5px; font-style: italic;">
                            ${this._teams?.escapeHtml(entry.result.changes.note) || ''}
                        </div>
                    ` : ''}
                    ${needsProcessing ? `
                        <button class="btn-small primary" style="margin-top: 8px; font-size: 0.75rem;"
                                onclick="processSpellCast('${entry.timestamp}')">
                            ${processLabel}
                        </button>
                    ` : ''}
                    ${entry.result?.processed ? `
                        <div style="font-size: 0.75rem; margin-top: 5px; color: ${entry.result.success ? '#22c55e' : '#ef4444'};">
                            ${entry.result.success ? 'Processed' : ('Failed: ' + (this._teams?.escapeHtml(entry.result.error) || entry.result.error || 'unknown error'))}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    /** Render admin active effects panel with remove buttons */
    renderActiveEffectsAdmin() {
        const container = document.getElementById('activeEffectsAdmin');
        if (!container) return;

        const effects = (this._gameState.activeEffects || []).filter(e => !e.isExpired);

        if (effects.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.7;">No active effects</p>';
            return;
        }

        const gs = this._gameState;
        container.innerHTML = effects.map(eff => {
            const team = gs.teams?.find(t => String(t.id) === String(eff.castByTeamId));
            const teamColor = team?.color || '#a855f7';
            return `
                <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px;
                            margin-bottom: 6px; border-left: 3px solid ${teamColor};
                            background: rgba(168, 85, 247, 0.08); border-radius: 6px;">
                    <span style="font-size: 20px;">${eff.icon || ICON_SVGS.wandSparkles}</span>
                    <div style="flex: 1;">
                        <div style="font-size: 0.85rem; color: var(--text-primary);">
                            <strong>${this._teams?.escapeHtml(eff.spellName) || eff.spellName}</strong>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">
                            ${this._teams?.escapeHtml(eff.displayText) || eff.displayText}
                            ${eff.expiresAfterRound != null ? ` (until R${eff.expiresAfterRound})` : ' (permanent)'}
                        </div>
                    </div>
                    <button class="btn-small danger" onclick="removeActiveEffect('${eff.id}')"
                            style="font-size: 0.7rem;">Remove</button>
                    ${this.getSpellDef(eff.spellId)?.effect?.type === 'charged_removal' && eff.usesRemaining > 0 ? `
                        <button class="btn-small primary" onclick="spendChargedRemoval('${eff.id}')"
                                style="font-size: 0.7rem;">Spend charge (${eff.usesRemaining} left)</button>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    /** Render spell phase controls in the phase indicator bar */
    renderSpellPhaseControls() {
        const container = document.getElementById('spellPhaseAdminControls');
        if (!container) return;

        const gs = this._gameState;
        const phase = gs.currentPhase?.name;

        if (!phase || !phase.startsWith('spell_window') || !gs.spellPhase?.isActive) {
            container.style.display = 'none';
            return;
        }

        const sp = gs.spellPhase;
        const currentTeamId = sp.turnOrder?.[sp.currentTeamIndex];
        const team = gs.teams?.find(t => t.id === currentTeamId);
        const completed = sp.teamsCompleted?.length || 0;
        const total = sp.turnOrder?.length || 0;

        container.style.display = 'flex';
        container.innerHTML = `
            <span style="color: var(--text-secondary); font-size: 0.85rem;">
                Turn: <strong style="color: ${team?.color || '#a855f7'}">${this._teams?.escapeHtml(team?.name) || 'Team ' + currentTeamId}</strong>
                (${completed}/${total})
            </span>
            <button class="btn-small secondary" onclick="skipSpellTurn(${currentTeamId})">Skip Turn</button>
            <button class="btn-small danger" onclick="forceEndSpellPhase()">End Spell Phase</button>
        `;
    }
}

// Export
if (typeof window !== 'undefined') {
    window.SpellEngine = SpellEngine;
}
