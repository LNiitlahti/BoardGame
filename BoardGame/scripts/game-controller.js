/**
 * GAME CONTROLLER
 * Handles gameplay, board rendering, and user interactions during gameplay
 */

class GameController {
    constructor() {
        this.gameEngine = new BoardGameEngine();
        this.gameId = this.getGameIdFromUrl();
        this.currentTeamId = null;
        this.selectedCoord = null;
        this.actionMode = null;
        
        // DOM elements
        this.boardContainer = document.getElementById('gameBoard');
        this.gameInfoContainer = document.getElementById('gameInfo');
        this.teamSelector = document.getElementById('teamSelector');
        this.actionButtons = document.getElementById('actionButtons');
        this.gameStatus = document.getElementById('gameStatus');
        this.gameLog = document.getElementById('gameLog');
        
        // Initialize
        this.init();
    }
    
    async init() {
        if (!this.gameId) {
            alert('No game ID specified. Please go back to the setup page.');
            return;
        }
        
        // Set up event listeners for game events
        this.setupEventListeners();
        
        try {
            // Load game data from Firebase
            await this.gameEngine.loadGame(this.gameId);
            
            // Update UI when game is loaded
            this.gameEngine.on('gameLoaded', (data) => {
                this.renderBoard();
                this.updateGameInfo();
                this.populateTeamSelector();
                this.updateGameLog('Game loaded successfully');
            });
            
            // Handle other game events
            this.gameEngine.on('platePlaced', (data) => {
                this.renderBoard();
                this.updateGameInfo();
                this.updateGameLog(`Team ${data.teamId} placed a plate at ${data.coord}`);
            });
            
            this.gameEngine.on('heartHexCaptured', (data) => {
                this.updateGameLog(`Team ${data.teamId} captured heart hex at ${data.coord}!`, true);
            });
            
            this.gameEngine.on('turnStarted', (data) => {
                this.updateGameStatus(`Team ${data.teamId}'s turn`);
                this.updateGameLog(`Team ${data.teamId}'s turn has started`);
            });
            
            this.gameEngine.on('turnCompleted', (data) => {
                this.updateGameStatus('Waiting for next turn');
                this.updateGameLog(`Team ${data.completedTurn.teamId}'s turn has completed`);
            });
            
            this.gameEngine.on('gameEnded', (data) => {
                this.updateGameStatus(`Game over! Team ${data.winner.id} wins!`);
                this.updateGameLog(`Game over! Team ${data.winner.id} wins with ${data.winner.points} points!`, true);
                this.disableGameControls();
            });
            
            this.gameEngine.on('error', (data) => {
                console.error(data.message, data.error);
                this.updateGameLog(`Error: ${data.message}`, true);
            });
            
            // Start auto-save
            this.gameEngine.startAutoSave();
            
        } catch (error) {
            console.error('Failed to initialize game:', error);
            this.updateGameStatus('Failed to load game');
        }
    }
    
    getGameIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('gameId');
    }
    
    setupEventListeners() {
        // Team selection
        this.teamSelector.addEventListener('change', (e) => {
            this.currentTeamId = parseInt(e.target.value);
            this.updateActionButtons();
        });
        
        // End turn button
        document.getElementById('endTurnBtn').addEventListener('click', () => {
            this.gameEngine.completeTurn();
        });
        
        // Action buttons
        document.getElementById('placePlateBtn').addEventListener('click', () => {
            this.setActionMode('place');
        });
        
        document.getElementById('skipTurnBtn').addEventListener('click', () => {
            this.gameEngine.skipTurn();
        });
    }
    
    setActionMode(mode) {
        this.actionMode = mode;
        
        // Update button states
        const buttons = this.actionButtons.querySelectorAll('button');
        buttons.forEach(btn => btn.classList.remove('active'));
        
        if (mode) {
            document.getElementById(`${mode}PlateBtn`).classList.add('active');
            this.updateGameLog(`Action mode: ${mode}`);
        }
    }
    
    renderBoard() {
        if (!this.gameEngine.gameState.initialized) return;
        
        this.boardContainer.innerHTML = '';
        const hexCoords = this.gameEngine.generateHexCoordinates();
        const size = 30; // hex size
        
        // Create SVG for the board
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute('width', '600');
        svg.setAttribute('height', '600');
        svg.setAttribute('viewBox', '0 0 600 600');
        this.boardContainer.appendChild(svg);
        
        // Draw hexagons
        hexCoords.forEach(([q, r]) => {
            const coord = `q${q}r${r}`;
            const [x, y] = this.gameEngine.hexToPixel(q, r, size);
            const hexType = this.gameEngine.getHexType(q, r);
            
            // Create hexagon points
            const points = this.calculateHexPoints(x, y, size);
            
            // Create polygon
            const hex = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            hex.setAttribute('points', points);
            hex.setAttribute('data-coord', coord);
            hex.setAttribute('data-q', q);
            hex.setAttribute('data-r', r);
            
            // Set class based on type
            hex.classList.add('hex', `hex-${hexType}`);
            
            // If hex is occupied, set team color
            if (this.gameEngine.gameState.board.has(coord)) {
                const teamId = this.gameEngine.gameState.board.get(coord);
                hex.classList.add(`team-${teamId}`);
            }
            
            // Highlight if this is a valid placement for current team
            if (this.currentTeamId && this.gameEngine.canPlaceAt(q, r, this.currentTeamId)) {
                hex.classList.add('valid-placement');
            }
            
            // Highlight if selected
            if (coord === this.selectedCoord) {
                hex.classList.add('selected');
            }
            
            // Add click event
            hex.addEventListener('click', () => this.handleHexClick(coord, q, r));
            
            // Add to SVG
            svg.appendChild(hex);
            
            // Add coordinate text (optional - for debugging)
            if (size >= 25) { // Only add text if hexes are large enough
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute('x', x);
                text.setAttribute('y', y);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-size', '8');
                text.textContent = coord;
                svg.appendChild(text);
            }
        });
    }
    
    calculateHexPoints(x, y, size) {
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const px = x + size * Math.cos(angle);
            const py = y + size * Math.sin(angle);
            points.push(`${px},${py}`);
        }
        return points.join(' ');
    }
    
    handleHexClick(coord, q, r) {
        // If no team selected, show message
        if (!this.currentTeamId) {
            this.updateGameLog('Please select a team first', true);
            return;
        }
        
        // If no action mode, just select the hex
        if (!this.actionMode) {
            this.selectedCoord = coord;
            this.renderBoard();
            this.updateGameLog(`Selected hex: ${coord}`);
            return;
        }
        
        // Handle actions based on mode
        if (this.actionMode === 'place') {
            try {
                if (this.gameEngine.placePlate(q, r, this.currentTeamId)) {
                    this.selectedCoord = null;
                    this.setActionMode(null);
                }
            } catch (error) {
                this.updateGameLog(`Cannot place plate: ${error.message}`, true);
            }
        }
    }
    
    updateGameInfo() {
        if (!this.gameEngine.gameState.initialized) return;
        
        const gameState = this.gameEngine.gameState;
        const stats = this.gameEngine.getGameStats();
        
        this.gameInfoContainer.innerHTML = `
            <h2>Game: ${gameState.gameId}</h2>
            <div class="game-stats">
                <div>Round: ${stats.currentRound}</div>
                <div>Games Played: ${stats.gamesPlayed}</div>
                <div>Win Condition: ${stats.winCondition} points</div>
                <div>Phase: ${stats.gamePhase}</div>
            </div>
            <div class="team-standings">
                <h3>Team Standings</h3>
                <ul>
                    ${gameState.teams.map(team => `
                        <li class="team-${team.id}">
                            <span class="team-name">${team.name}</span>: 
                            <span class="team-points">${team.points} points</span>
                            (${team.gamesWon} games won)
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
        
        // Update game status
        if (gameState.currentTurn) {
            this.updateGameStatus(`Team ${gameState.currentTurn.teamId}'s turn`);
        } else if (gameState.gamePhase === 'finished') {
            const winner = stats.leadingTeam;
            this.updateGameStatus(`Game over! Team ${winner.id} wins!`);
        } else {
            this.updateGameStatus('Waiting for next turn');
        }
    }
    
    populateTeamSelector() {
        if (!this.gameEngine.gameState.initialized) return;
        
        this.teamSelector.innerHTML = '<option value="">-- Select Team --</option>';
        
        this.gameEngine.gameState.teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            this.teamSelector.appendChild(option);
        });
    }
    
    updateActionButtons() {
        // Enable/disable action buttons based on current team
        if (this.currentTeamId) {
            this.actionButtons.querySelectorAll('button').forEach(btn => {
                btn.disabled = false;
            });
        } else {
            this.actionButtons.querySelectorAll('button').forEach(btn => {
                btn.disabled = true;
            });
        }
        
        // Reset action mode
        this.setActionMode(null);
    }
    
    updateGameStatus(message) {
        this.gameStatus.textContent = message;
    }
    
    updateGameLog(message, isImportant = false) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        if (isImportant) logEntry.classList.add('important');
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `<span class="timestamp">${timestamp}</span> ${message}`;
        
        this.gameLog.appendChild(logEntry);
        this.gameLog.scrollTop = this.gameLog.scrollHeight;
    }
    
    disableGameControls() {
        this.actionButtons.querySelectorAll('button').forEach(btn => {
            btn.disabled = true;
        });
        document.getElementById('endTurnBtn').disabled = true;
    }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const gameController = new GameController();
});
