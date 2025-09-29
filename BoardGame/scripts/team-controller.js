/**
 * TEAM CONTROLLER
 * Handles team-specific functionality and team management
 */

class TeamController {
    constructor() {
        this.gameEngine = new BoardGameEngine();
        this.gameId = this.getGameIdFromUrl();
        this.teamId = this.getTeamIdFromUrl();
        
        // DOM elements
        this.teamInfoContainer = document.getElementById('teamInfo');
        this.gameStatusContainer = document.getElementById('gameStatus');
        this.gameActionContainer = document.getElementById('gameActions');
        this.teamHistoryContainer = document.getElementById('teamHistory');
        
        // Initialize
        this.init();
    }
    
    async init() {
        if (!this.gameId) {
            alert('No game ID specified. Please go back to the setup page.');
            return;
        }
        
        try {
            // Load game data from Firebase
            await this.gameEngine.loadGame(this.gameId);
            
            // Update UI when game is loaded
            this.gameEngine.on('gameLoaded', (data) => {
                // If no team ID is specified yet, show team selection
                if (!this.teamId) {
                    this.showTeamSelection();
                } else {
                    this.updateTeamInfo();
                    this.updateGameStatus();
                    this.updateTeamHistory();
                }
            });
            
            // Set up other event listeners after game is loaded
            this.setupEventListeners();
            
            // Handle other game events
            this.gameEngine.on('gameResultAdded', (data) => {
                this.updateTeamInfo();
                this.updateGameStatus();
                this.updateTeamHistory();
            });
            
            this.gameEngine.on('turnStarted', () => {
                this.updateGameStatus();
                if (this.isMyTurn()) {
                    this.showTurnActions();
                }
            });
            
            this.gameEngine.on('turnCompleted', () => {
                this.updateGameStatus();
                this.hideTurnActions();
            });
            
            this.gameEngine.on('gameEnded', (data) => {
                this.updateGameStatus();
                alert(`Game over! Team ${data.winner.id} wins!`);
                this.hideTurnActions();
            });
            
        } catch (error) {
            console.error('Failed to initialize team view:', error);
            alert(`Failed to load game: ${error.message}`);
        }
    }
    
    getGameIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('gameId');
    }
    
    getTeamIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const teamId = urlParams.get('teamId');
        return teamId ? parseInt(teamId) : null;
    }
    
    setupEventListeners() {
        // Handle team selection
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('select-team-btn')) {
                const teamId = parseInt(e.target.getAttribute('data-team-id'));
                this.setTeam(teamId);
            }
        });
        
        // Handle end turn button
        document.getElementById('endTurnBtn')?.addEventListener('click', () => {
            if (this.isMyTurn()) {
                this.gameEngine.completeTurn();
                this.hideTurnActions();
            }
        });
        
        // Handle view board button
        document.getElementById('viewBoardBtn')?.addEventListener('click', () => {
            window.location.href = `game.html?gameId=${this.gameId}&teamId=${this.teamId}`;
        });
    }
    
    isMyTurn() {
        if (!this.gameEngine.gameState.currentTurn) return false;
        return this.gameEngine.gameState.currentTurn.teamId === this.teamId;
    }
    
    setTeam(teamId) {
        this.teamId = teamId;
        
        // Update URL without reloading page
        const url = new URL(window.location);
        url.searchParams.set('teamId', teamId);
        window.history.pushState({}, '', url);
        
        // Update UI for selected team
        this.updateTeamInfo();
        this.updateGameStatus();
        this.updateTeamHistory();
    }
    
    showTeamSelection() {
        const teams = this.gameEngine.gameState.teams;
        
        this.teamInfoContainer.innerHTML = `
            <h2>Select Your Team</h2>
            <div class="team-selection">
                ${teams.map(team => `
                    <div class="team-card team-${team.id}">
                        <h3>${team.name}</h3>
                        <div class="team-points">${team.points} points</div>
                        <div class="team-wins">${team.gamesWon} games won</div>
                        <div class="team-players">
                            <strong>Players:</strong>
                            <ul>
                                ${team.players.map(player => `<li>${player.name}</li>`).join('')}
                            </ul>
                        </div>
                        <button class="select-team-btn" data-team-id="${team.id}">Select Team</button>
                    </div>
                `).join('')}
            </div>
        `;
        
        this.gameStatusContainer.innerHTML = `<p>Please select a team to continue</p>`;
        this.gameActionContainer.innerHTML = '';
    }
    
    updateTeamInfo() {
        if (!this.teamId) return;
        
        const team = this.gameEngine.getTeam(this.teamId);
        if (!team) {
            alert('Invalid team ID');
            this.teamId = null;
            this.showTeamSelection();
            return;
        }
        
        this.teamInfoContainer.innerHTML = `
            <h2>${team.name}</h2>
            <div class="team-details">
                <div class="team-stats">
                    <div><strong>Points:</strong> ${team.points}</div>
                    <div><strong>Games Won:</strong> ${team.gamesWon}</div>
                    <div><strong>Plates:</strong> ${team.plates?.length || 0}</div>
                    <div><strong>Heart Hexes Controlled:</strong> ${team.heartHexes?.length || 0}</div>
                </div>
                <div class="team-players">
                    <h3>Team Members</h3>
                    <ul>
                        ${team.players.map(player => `<li>${player.name}</li>`).join('')}
                    </ul>
                </div>
            </div>
            <button id="viewBoardBtn" class="btn">View Game Board</button>
        `;
    }
    
    updateGameStatus() {
        if (!this.teamId) return;
        
        const gameState = this.gameEngine.gameState;
        const stats = this.gameEngine.getGameStats();
        
        let statusHtml = `
            <h3>Game Status</h3>
            <div class="game-stats">
                <div><strong>Game:</strong> ${gameState.gameId}</div>
                <div><strong>Round:</strong> ${stats.currentRound}</div>
                <div><strong>Win Condition:</strong> ${stats.winCondition} points</div>
            </div>
        `;
        
        // Current turn info
        if (gameState.gamePhase === 'finished') {
            statusHtml += `<p class="game-over">Game Over! Team ${stats.leadingTeam.id} wins!</p>`;
        } else if (gameState.currentTurn) {
            if (gameState.currentTurn.teamId === this.teamId) {
                statusHtml += `<p class="your-turn">It's your team's turn!</p>`;
            } else {
                const currentTeam = this.gameEngine.getTeam(gameState.currentTurn.teamId);
                statusHtml += `<p>Current Turn: ${currentTeam ? currentTeam.name : `Team ${gameState.currentTurn.teamId}`}</p>`;
            }
        } else {
            statusHtml += `<p>Waiting for next turn</p>`;
        }
        
        // Team rankings
        const rankings = this.gameEngine.getTeamRankings();
        statusHtml += `
            <div class="team-rankings">
                <h3>Current Standings</h3>
                <ol>
                    ${rankings.map(team => `
                        <li class="${team.id === this.teamId ? 'my-team' : ''}">
                            ${team.name}: ${team.points} points
                        </li>
                    `).join('')}
                </ol>
            </div>
        `;
        
        this.gameStatusContainer.innerHTML = statusHtml;
        
        // Show/hide turn actions
        if (this.isMyTurn()) {
            this.showTurnActions();
        } else {
            this.hideTurnActions();
        }
    }
    
    showTurnActions() {
        this.gameActionContainer.innerHTML = `
            <div class="turn-actions">
                <h3>Your Turn</h3>
                <p>Go to the game board to place your plate:</p>
                <button id="viewBoardBtn" class="btn primary">Go to Game Board</button>
                <button id="endTurnBtn" class="btn">End Turn</button>
            </div>
        `;
    }
    
    hideTurnActions() {
        this.gameActionContainer.innerHTML = '';
    }
    
    updateTeamHistory() {
        if (!this.teamId) return;
        
        const team = this.gameEngine.getTeam(this.teamId);
        const gameHistory = this.gameEngine.gameState.gameHistory.filter(
            result => result.winningTeamId === this.teamId
        );
        
        if (gameHistory.length === 0) {
            this.teamHistoryContainer.innerHTML = '<h3>Team History</h3><p>No games won yet</p>';
            return;
        }
        
        this.teamHistoryContainer.innerHTML = `
            <h3>Games Won</h3>
            <table class="game-history-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Game</th>
                        <th>Type</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${gameHistory.map(result => `
                        <tr>
                            <td>${result.id}</td>
                            <td>${result.game}</td>
                            <td>${result.playType}</td>
                            <td>${new Date(result.timestamp).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const teamController = new TeamController();
});
