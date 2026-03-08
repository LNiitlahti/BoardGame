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
     */
    constructor(gameState, {
        uiManager,
        teamManager,
        boardManager,
        saveCallback,
        logActionCallback,
        onPhaseRequirementsChanged,
        onDisplayRefresh
    }) {
        this._gameState = gameState;
        this._ui = uiManager;
        this._teams = teamManager;
        this._board = boardManager || null;
        this._save = saveCallback;
        this._logAction = logActionCallback || (() => {});
        this._onPhaseChanged = onPhaseRequirementsChanged || (() => {});
        this._refresh = onDisplayRefresh || (() => {});

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

    /** Check if team has active Double Bid modifier */
    _checkDoubleDraw(teamId) {
        const effects = this._gameState.activeEffects || [];
        const idx = effects.findIndex(e =>
            !e.isExpired &&
            e.spellId === 'double-bid' &&
            String(e.castByTeamId) === String(teamId) &&
            e.category === 'modifier'
        );

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
                return this._createActiveEffect(def, castByTeamId, targetData, 'special');
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
                return this._createActiveEffect(def, castByTeamId, targetData, 'buff');
            case 'silence':
                return this._createActiveEffect(def, castByTeamId, targetData, 'condition');
            case 'bet':
                return this._createActiveEffect(def, castByTeamId, targetData, 'special');
            case 'counter':
                return this._createActiveEffect(def, castByTeamId, targetData, 'reactive');
            default:
                return this._createActiveEffect(def, castByTeamId, targetData, 'condition');
        }
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
                    if (board[nCoord] !== undefined && String(board[nCoord]) !== String(castByTeamId)) {
                        destroyed.push({ coord: nCoord, teamId: board[nCoord] });
                        delete board[nCoord];
                        // Also clear heart control
                        if (gs.heartHexControl?.[nCoord]) {
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

        if (effectType === 'counter') {
            return `${casterName} can block an opponent's spell draw`;
        }

        if (effectType === 'modifier') {
            return `${casterName}: next room hex draw = double cards`;
        }

        // Generic fallback
        return `${casterName} cast ${def.nameEn || def.name}`;
    }

    /** Get emoji icon for effect type */
    _getEffectIcon(def) {
        const type = def.effect?.type;
        const icons = {
            multiplier: '\u2728',      // ✨
            destroy_adjacent: '\u{1F4A5}', // 💥
            streak_bonus: '\u{1F525}',  // 🔥
            shield: '\u{1F6E1}',        // 🛡️
            copy_spell: '\u{1F4CB}',    // 📋
            challenge: '\u2694',        // ⚔
            bonus_points: '\u2B50',     // ⭐
            ban: '\u{1F6AB}',          // 🚫
            modifier: '\u{1F3B2}',     // 🎲
            permanent_buff: '\u{1F48E}', // 💎
            extra_placement: '\u{1F9E9}', // 🧩
            silence: '\u{1F507}',      // 🔇
            bet: '\u{1F3B0}',          // 🎰
            counter: '\u{1F6E1}'       // 🛡️
        };
        return icons[type] || '\u{1F52E}'; // 🔮 default
    }

    /** Calculate when an effect expires */
    _calculateExpiry(def) {
        const timing = def.timing;
        const currentRound = this._gameState.currentPhase?.roundNumber || 0;

        if (def.effect?.type === 'permanent_buff') return null; // Permanent
        if (def.effect?.type === 'counter') return null;        // Until used
        if (def.effect?.type === 'streak_bonus') return null;   // Until streak breaks

        // Most effects expire after next round
        if (timing === 'pre-game' || timing === 'post-game' || timing === 'placement') {
            return currentRound + 1;
        }

        if (def.effect?.type === 'shield') return currentRound + 1;
        if (def.effect?.type === 'modifier') return currentRound + 2; // Lasts until used

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
                    <span style="font-size: 20px;">${eff.icon || '\u{1F52E}'}</span>
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
