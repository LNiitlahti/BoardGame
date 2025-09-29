/**
 * ADMIN CONTROLLER
 * Handles game administration, result tracking, and game management
 */

class AdminController {
    constructor() {
        this.gameEngine = new BoardGameEngine();
        this.gameId = this.getGameIdFromUrl();
        
        // DOM elements
        this.gameInfoContainer = document.getElementById('gameInfo');
        this.teamInfoContainer = document.getElementById('teamInfo');
        this.gameResultForm = document.getElementById('gameResultForm');
        this.gameHistoryContainer = document.getElementById('gameHistory');
        this.winningTeamSelect = document.getElementById('winningTeam');
        this.gameTypeSelect = document.getElementById('gameType');
        this.playTypeSelect = document.getElementById('playType');
        this.gameNotes = document.getElementById('gameNotes');
        
        // Initialize
        this.init();
    }
    
    async init() {
        if (!this.gameId) {
            alert('No game ID specified. Please go back to the setup page.');
            return;
        }
        
        // Set up event listeners
        this.setupEventListeners();
        
        try {
            // Load game data from Firebase
            await this.gameEngine.loadGame(this.gameId);
            
            // Update UI when game is loaded
            this.gameEngine.on('gameLoaded', (data) => {
                this.updateGameInfo();
                this.updateTeamInfo();
                this.populateTeamSelectors();
                this.updateGameHistory();
            });
            
            // Handle other game events
            this.gameEngine.on('gameResultAdded', (data) => {
                this.updateGameHistory();
                this.updateGameInfo();
                this.resetResultForm();
            });
            
            this.gameEngine.on('turnStarted', () => {
                this.updateGameInfo();
            });
            
            this.gameEngine.on('turnCompleted', () => {
                this.updateGameInfo();
            });
            
            this.gameEngine.on('turnSkipped', () => {
                this.updateGameInfo();
            });
            
            this.gameEngine.on('gameEnded', (data) => {
                this.updateGameInfo();
                alert(`Game over! Team ${data.winner.id} wins!`);
                this.disableGameControls();
            });
            
            this.gameEngine.on('error', (data) => {
                console.error(data.message, data.error);
                alert(`Error: ${data.message}`);
            });
            
        } catch (error) {
            console.error('Failed to initialize admin panel:', error);
            alert(`Failed to load game: ${error.message}`);
        }
    }
    
    getGameIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('gameId');
    }
    
    setupEventListeners() {
        // Game result form submission
        this.gameResultForm.addEventListener('submit', (e) => this.handleGameResultSubmit(e));
        
        // Reset button
        document.getElementById('resetGameBtn').addEventListener('click', () => {
            if (confirm('Are you sure you want to reset the game? This will clear all progress.')) {
                this.gameEngine.resetGame();
                this.updateGameInfo();
                this.updateTeamInfo();
                this.updateGameHistory();
            }
        });
        
        // Skip turn button
        document.getElementById('skipTurnBtn').addEventListener('click', () => {
            if (this.gameEngine.gameState.currentTurn) {
                if (confirm(`Skip turn for Team ${this.gameEngine.gameState.currentTurn.teamId}?`)) {
                    this.gameEngine.skipTurn();
                }
            } else {
                alert('No active turn to skip');
            }
        });
        
        // Export game data button
        document.getElementById('exportGameBtn').addEventListener('click', () => {
            this.exportGameData();
        });
    }
    
    updateGameInfo() {
        if (!this.gameEngine.gameState.initialized) return;
        
        const gameState = this.gameEngine.gameState;
        const stats = this.gameEngine.getGameStats();
        
        this.gameInfoContainer.innerHTML = `
            <h2>Game Management: ${gameState.gameId}</h2>
            <div class="game-stats">
                <div><strong>Round:</strong> ${stats.currentRound}</div>
                <div><strong>Games Played:</strong> ${stats.gamesPlayed}</div>
                <div><strong>Win Condition:</strong> ${stats.winCondition} points</div>
                <div><strong>Game Phase:</strong> ${stats.gamePhase}</div>
                <div><strong>Created At:</strong> ${new Date(gameState.createdAt).toLocaleString()}</div>
                ${gameState.finishedAt ? `<div><strong>Finished At:</strong> ${new Date(gameState.finishedAt).toLocaleString()}</div>` : ''}
            </div>
            <div class="current-turn">
                <h3>Current Turn</h3>
                ${gameState.currentTurn 
                    ? `<p>Team ${gameState.currentTurn.teamId} is currently taking their turn</p>` 
                    : '<p>No active turn</p>'
                }
            </div>
        `;
        
        // Update game controls based on game phase
        if (gameState.gamePhase === 'finished') {
            this.disableGameControls();
        } else {
            this.enableGameControls();
        }
    }
    
    updateTeamInfo() {
        if (!this.gameEngine.gameState.initialized) return;
        
        const teams = this.gameEngine.getTeamRankings();
        
        this.teamInfoContainer.innerHTML = `
            <h3>Team Standings</h3>
            <div class="team-standings">
                ${teams.map((team, index) => `
                    <div class="team-card team-${team.id}">
                        <div class="team-rank">#${index + 1}</div>
                        <div class="team-name">${team.name}</div>
                        <div class="team-points">${team.points} points</div>
                        <div class="team-wins">${team.gamesWon} games won</div>
                        <div class="team-players">
                            <strong>Players:</strong>
                            <ul>
                                ${team.players.map(player => `<li>${player.name}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    populateTeamSelectors() {
        if (!this.gameEngine.gameState.initialized) return;
        
        // Clear existing options
        this.winningTeamSelect.innerHTML = '<option value="">-- Select Team --</option>';
        
        // Add team options
        this.gameEngine.gameState.teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            this.winningTeamSelect.appendChild(option);
        });
    }
    
    updateGameHistory() {
        if (!this.gameEngine.gameState.initialized) return;
        
        const gameHistory = this.gameEngine.gameState.gameHistory;
        
        if (gameHistory.length === 0) {
            this.gameHistoryContainer.innerHTML = '<p>No games recorded yet</p>';
            return;
        }
        
        this.gameHistoryContainer.innerHTML = `
            <h3>Game History</h3>
            <table class="game-history-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Game</th>
                        <th>Type</th>
                        <th>Winner</th>
                        <th>Date</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    ${gameHistory.map(result => {
                        const winningTeam = this.gameEngine.getTeam(result.winningTeamId);
                        return `
                            <tr>
                                <td>${result.id}</td>
                                <td>${result.game}</td>
                                <td>${result.playType}</td>
                                <td class="team-${result.winningTeamId}">${winningTeam ? winningTeam.name : `Team ${result.winningTeamId}`}</td>
                                <td>${new Date(result.timestamp).toLocaleString()}</td>
                                <td>${result.notes}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }
    
    handleGameResultSubmit(e) {
        e.preventDefault();
        
        const gameType = this.gameTypeSelect.value;
        const playType = this.playTypeSelect.value;
        const winningTeamId = parseInt(this.winningTeamSelect.value);
        const notes = this.gameNotes.value;
        
        // Validate
        if (!gameType || !playType || !winningTeamId) {
            alert('Please fill in all required fields');
            return;
        }
        
        try {
            // Add game result
            const result = this.gameEngine.addGameResult({
                game: gameType,
                playType: playType,
                winningTeamId: winningTeamId,
                notes: notes
            });
            
            alert(`Game result recorded! Team ${winningTeamId} gets to place a plate.`);
            
            // Redirect to game page for the winning team's turn
            if (confirm('Go to game board for the winning team to place their plate?')) {
                window.location.href = `game.html?gameId=${this.gameId}`;
            }
        } catch (error) {
            alert(`Error recording game result: ${error.message}`);
            console.error(error);
        }
    }
    
    resetResultForm() {
        this.gameResultForm.reset();
    }
    
    exportGameData() {
        const gameData = this.gameEngine.exportGameState();
        const blob = new Blob([gameData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `game_${this.gameId}_export.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    enableGameControls() {
        document.getElementById('resetGameBtn').disabled = false;
        document.getElementById('skipTurnBtn').disabled = !this.gameEngine.gameState.currentTurn;
        this.gameResultForm.querySelectorAll('button, select, input, textarea').forEach(el => {
            el.disabled = false;
        });
    