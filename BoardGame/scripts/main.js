/**
 * BOARD GAME SYSTEM - MAIN GAME LOOP (Firebase Version)
 * =====================================================
 * Core JavaScript engine for turn-based board game system
 * Handles game state, board logic, turn management, and persistence
 * Now uses Firebase Firestore instead of localStorage
 */

class BoardGameEngine {
    constructor() {
        this.gameState = {
            gameId: null,
            players: [],
            teams: [],
            board: new Map(),
            heartHexes: new Set(['q2r-4', 'q4r-2', 'q2r2', 'q-2r4', 'q-4r2', 'q-2r-2']),
            heartHexControl: new Map(),
            currentRound: 0,
            gamesPlayed: 0,
            winCondition: 50,
            gameHistory: [],
            currentTurn: null,
            gamePhase: 'setup',
            gameTypes: ['CS2', 'Dota2', 'Valorant', 'StarCraft2', 'Predecessor'],
            playTypes: ['1v1', '2v2', '3v3', '5v5'],
            createdAt: null,
            initialized: false
        };

        this.eventListeners = new Map();
        this.autoSaveInterval = null;
    }

    // ================================
    // CORE GAME MANAGEMENT
    // ================================

    initializeGame(config) {
        const { gameId, playerNames, winCondition, gameTypes, playTypes, heartHexes } = config;

        if (!gameId || !playerNames || playerNames.length < 2) {
            throw new Error('Invalid game configuration');
        }

        this.gameState = {
            gameId: gameId,
            players: playerNames.map((name, index) => ({
                id: index + 1,
                name: name.trim(),
                team: Math.floor(index / Math.ceil(playerNames.length / 5)) + 1,
                points: 0
            })),
            teams: [],
            board: new Map(),
            heartHexes: new Set(heartHexes || ['q2r-4', 'q4r-2', 'q2r2', 'q-2r4', 'q-4r2', 'q-2r-2']),
            heartHexControl: new Map(),
            currentRound: 0,
            gamesPlayed: 0,
            winCondition: winCondition || 50,
            gameHistory: [],
            currentTurn: null,
            gamePhase: 'playing',
            gameTypes: gameTypes || ['CS2', 'Dota2', 'Valorant', 'StarCraft2', 'Predecessor'],
            playTypes: playTypes || ['1v1', '2v2', '3v3', '5v5'],
            createdAt: new Date().toISOString(),
            initialized: true
        };

        this.createTeams();
        this.saveToStorage();
        this.emit('gameInitialized', this.gameState);
        return this.gameState;
    }

    async loadGame(gameId) {
        try {
            const gameRef = window.firebaseDoc(window.firebaseDB, "games", gameId);

            window.firebaseOnSnapshot(gameRef, (docSnap) => {
                if (docSnap.exists()) {
                    const loadedState = docSnap.data();

                    this.gameState = {
                        ...loadedState,
                        board: new Map(Object.entries(loadedState.board || {})),
                        heartHexes: new Set(loadedState.heartHexes || []),
                        heartHexControl: new Map(Object.entries(loadedState.heartHexControl || {}))
                    };

                    this.emit('gameLoaded', this.gameState);
                } else {
                    console.error(`Game \"${gameId}\" not found`);
                }
            });

            return this.gameState;
        } catch (error) {
            this.emit('error', { message: 'Failed to load game from Firebase', error });
            throw error;
        }
    }

    resetGame() {
        const gameId = this.gameState.gameId;
        const players = [...this.gameState.players];
        const winCondition = this.gameState.winCondition;
        const gameTypes = [...this.gameState.gameTypes];
        const playTypes = [...this.gameState.playTypes];
        const heartHexes = [...this.gameState.heartHexes];

        this.initializeGame({
            gameId,
            playerNames: players.map(p => p.name),
            winCondition,
            gameTypes,
            playTypes,
            heartHexes
        });

        this.emit('gameReset', this.gameState);
    }

    // ================================
    // TEAM MANAGEMENT
    // ================================

    createTeams() {
        const teamCount = Math.min(5, Math.ceil(this.gameState.players.length / 2));
        const teams = [];
        for (let i = 1; i <= teamCount; i++) {
            const teamPlayers = this.gameState.players.filter(p => p.team === i);
            teams.push({ id: i, name: `Team ${i}`, players: teamPlayers, points: 0, gamesWon: 0, heartHexes: [], plates: [] });
        }
        this.gameState.teams = teams;
    }

    getTeam(teamId) { return this.gameState.teams.find(t => t.id === teamId); }

    getTeamRankings() { return [...this.gameState.teams].sort((a, b) => b.points - a.points); }

    // ================================
    // HEX GRID & BOARD LOGIC
    // ================================

    generateHexCoordinates() {
        const coordinates = [];
        for (let q = -5; q <= 5; q++) {
            const r1 = Math.max(-5, -q - 5);
            const r2 = Math.min(5, -q + 5);
            for (let r = r1; r <= r2; r++) {
                coordinates.push([q, r]);
            }
        }
        return coordinates;
    }

    hexToPixel(q, r, size = 20, centerX = 300, centerY = 300) {
        const x = size * 3/2 * q;
        const y = size * Math.sqrt(3) * (r + q/2);
        return [x + centerX, y + centerY];
    }

    getHexType(q, r) {
        const coord = `q${q}r${r}`;
        const startingLocs = ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0'];
        if (startingLocs.includes(coord)) return 'starting-location';
        if (this.gameState.heartHexes.has(coord)) return 'heart-hex';
        const highValueLocs = ['q2r-4', 'q4r-2', 'q2r2', 'q-2r4', 'q-4r2', 'q-2r-2'];
        if (highValueLocs.includes(coord)) return 'high-value';
        if (coord === 'q0r0') return 'center';
        return 'normal';
    }

    getHexNeighbors(q, r) {
        const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        return directions.map(([dq, dr]) => {
            const nq = q + dq;
            const nr = r + dr;
            return `q${nq}r${nr}`;
        }).filter(coord => {
            const [nq, nr] = coord.match(/-?\d+/g).map(Number);
            return Math.abs(nq) <= 5 && Math.abs(nr) <= 5 && Math.abs(nq + nr) <= 5;
        });
    }

    canPlaceAt(q, r, teamId) {
        const coord = `q${q}r${r}`;
        if (this.gameState.board.has(coord)) return false;
        const teamPlates = [];
        this.gameState.board.forEach((occupier, hexCoord) => { if (occupier === teamId) teamPlates.push(hexCoord); });
        if (teamPlates.length === 0) {
            const startingLocs = ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0'];
            return startingLocs.includes(coord);
        }
        const neighbors = this.getHexNeighbors(q, r);
        return neighbors.some(neighborCoord => teamPlates.includes(neighborCoord));
    }

    getValidPlacements(teamId) {
        const validPlacements = [];
        const coordinates = this.generateHexCoordinates();
        coordinates.forEach(([q, r]) => { if (this.canPlaceAt(q, r, teamId)) validPlacements.push({ q, r, coord: `q${q}r${r}` }); });
        return validPlacements;
    }

    placePlate(q, r, teamId) {
        const coord = `q${q}r${r}`;
        if (!this.canPlaceAt(q, r, teamId)) throw new Error(`Cannot place plate at ${coord} for Team ${teamId}`);
        this.gameState.board.set(coord, teamId);
        if (this.gameState.heartHexes.has(coord)) {
            this.gameState.heartHexControl.set(coord, teamId);
            this.emit('heartHexCaptured', { coord, teamId });
        }
        this.calculatePoints();
        this.checkWinCondition();
        this.saveToStorage();
        this.emit('platePlaced', { coord, teamId, gameState: this.gameState });
        return true;
    }

    // ================================
    // TURN MANAGEMENT
    // ================================

    startTurn(teamId, gameResultId = null) {
        if (this.gameState.gamePhase !== 'playing') throw new Error('Game is not in playing phase');
        this.gameState.currentTurn = { teamId, needsPlacement: true, gameResultId, startTime: new Date().toISOString(), actions: [] };
        this.saveToStorage();
        this.emit('turnStarted', { teamId, currentTurn: this.gameState.currentTurn });
    }

    completeTurn() {
        if (!this.gameState.currentTurn) throw new Error('No active turn to complete');
        const completedTurn = { ...this.gameState.currentTurn };
        this.gameState.currentTurn = null;
        this.saveToStorage();
        this.emit('turnCompleted', { completedTurn });
    }

    skipTurn() {
        if (!this.gameState.currentTurn) throw new Error('No active turn to skip');
        const skippedTurn = { ...this.gameState.currentTurn };
        this.gameState.currentTurn = null;
        this.saveToStorage();
        this.emit('turnSkipped', { skippedTurn });
    }

    // ================================
    // GAME RESULTS & SCORING
    // ================================

    addGameResult(gameResult) {
        const { game, playType, winningTeamId, notes } = gameResult;
        if (!game || !playType || !winningTeamId) throw new Error('Invalid game result data');
        const result = { id: this.gameState.gameHistory.length + 1, game, playType, winningTeamId, notes: notes || '', timestamp: new Date().toISOString() };
        this.gameState.gameHistory.push(result);
        this.gameState.gamesPlayed++;
        this.gameState.currentRound = Math.ceil(this.gameState.gamesPlayed / this.gameState.teams.length);
        const winningTeam = this.getTeam(winningTeamId);
        if (winningTeam) winningTeam.gamesWon++;
        this.startTurn(winningTeamId, result.id);
        this.saveToStorage();
        this.emit('gameResultAdded', { result, winningTeam });
        return result;
    }

    calculatePoints() {
        this.gameState.teams.forEach(team => {
            let points = 0;
            this.gameState.board.forEach((occupier, coord) => {
                if (occupier === team.id) {
                    const [q, r] = coord.match(/-?\d+/g).map(Number);
                    const hexType = this.getHexType(q, r);
                    if (hexType === 'high-value' || hexType === 'center') points += 2; else points += 1;
                }
            });
            this.gameState.heartHexControl.forEach((controllingTeam, heartHex) => { if (controllingTeam === team.id) points += heartHex === 'q0r0' ? 2 : 1; });
            team.points = points;
        });
        this.emit('pointsCalculated', { teams: this.gameState.teams });
    }

    checkWinCondition() {
        if (this.gameState.gamePhase !== 'playing') return false;
        const winner = this.gameState.teams.find(team => team.points >= this.gameState.winCondition);
        if (winner) { this.endGame(winner); return true; }
        return false;
    }

    endGame(winningTeam) {
        this.gameState.gamePhase = 'finished';
        this.gameState.currentTurn = null;
        this.gameState.finishedAt = new Date().toISOString();
        this.saveToStorage();
        this.emit('gameEnded', { winner: winningTeam, gameState: this.gameState });
    }

    // ================================
    // DATA PERSISTENCE (Firebase)
    // ================================

    async saveToStorage() {
        if (!this.gameState.gameId) return;
        try {
            const saveData = {
                ...this.gameState,
                board: Object.fromEntries(this.gameState.board),
                heartHexes: Array.from(this.gameState.heartHexes),
                heartHexControl: Object.fromEntries(this.gameState.heartHexControl)
            };
            const gameRef = window.firebaseDoc(window.firebaseDB, "games", this.gameState.gameId);
            await window.firebaseSetDoc(gameRef, saveData);
            this.emit('gameSaved', { gameId: this.gameState.gameId });
        } catch (error) {
            this.emit('error', { message: 'Failed to save game to Firebase', error });
        }
    }

    exportGameState() {
        const saveData = {
            ...this.gameState,
            board: Object.fromEntries(this.gameState.board),
            heartHexes: Array.from(this.gameState.heartHexes),
            heartHexControl: Object.fromEntries(this.gameState.heartHexControl),
            exportedAt: new Date().toISOString()
        };
        return JSON.stringify(saveData, null, 2);
    }

    startAutoSave(interval = 30000) {
        if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = setInterval(() => { if (this.gameState.initialized) this.saveToStorage(); }, interval);
    }

    stopAutoSave() {
        if (this.autoSaveInterval) { clearInterval(this.autoSaveInterval); this.autoSaveInterval = null; }
    }

    // ================================
    // UTILITY FUNCTIONS
    // ================================

    getGameStats() {
        const rankings = this.getTeamRankings();
        const leadingTeam = rankings[0];
        return { gamesPlayed: this.gameState.gamesPlayed, currentRound: this.gameState.currentRound, totalPlayers: this.gameState.players.length, totalTeams: this.gameState.teams.length, leadingTeam: leadingTeam, gamePhase: this.gameState.gamePhase, activeTurns: this.gameState.currentTurn ? 1 : 0, winCondition: this.gameState.winCondition };
    }

    getRecentGames(limit = 5) { return this.gameState.gameHistory.slice(-limit).reverse(); }

    validateGameState() {
        const errors = [];
        if (!this.gameState.gameId) errors.push('Missing game ID');
        if (!this.gameState.teams || this.gameState.teams.length === 0) errors.push('No teams defined');
        if (!this.gameState.players || this.gameState.players.length === 0) errors.push('No players defined');
        this.gameState.teams.forEach(team => { if (!team.players || team.players.length === 0) errors.push(`Team ${team.id} has no players`); });
        this.gameState.board.forEach((teamId, coord) => { if (!this.getTeam(teamId)) errors.push(`Invalid team ${teamId} on board at ${coord}`); });
        return { valid: errors.length === 0, errors };
    }

    // ================================
    // EVENT SYSTEM
    // ================================

    /**
     * Register an event listener for a custom event.
     * @param {string} event - Event name.
     * @param {function} callback - Callback function to execute when event is emitted.
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
        this.eventListeners.get(event).push(callback);
    }

    /**
     * Remove an event listener for a custom event.
     * @param {string} event - Event name.
     * @param {function} callback - Callback function to remove.
     */
    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index !== -1) listeners.splice(index, 1);
        }
    }
}


