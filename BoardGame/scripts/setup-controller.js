/**
 * SETUP CONTROLLER
 * Handles game initialization and setup page functionality
 */

class SetupController {
    constructor() {
        // Wait for Firebase to be ready before initializing
        document.addEventListener('firebase-ready', () => {
            this.initializeController();
        });
        
        // Fallback - if firebase-ready doesn't fire within 5 seconds, try to initialize anyway
        setTimeout(() => {
            if (!this.gameEngine && window.firebaseDB) {
                this.initializeController();
            }
        }, 5000);
    }
    
    initializeController() {
        this.gameEngine = new BoardGameEngine();
        this.setupForm = document.getElementById('setupForm');
        this.playerInputContainer = document.getElementById('playerInputs');
        this.numPlayersInput = document.getElementById('numPlayers');
        this.gameTypeSelect = document.getElementById('gameType');
        this.gameIdInput = document.getElementById('gameId');
        this.winConditionInput = document.getElementById('winCondition');
        this.existingGamesContainer = document.getElementById('existingGames');
        this.connectionStatus = document.getElementById('connectionStatus');

        this.setupEventListeners();
        this.updatePlayerInputs();
        this.loadExistingGames();
        
        console.log('Setup controller initialized');
    }

    setupEventListeners() {
        // Dynamic player input fields
        this.numPlayersInput.addEventListener('change', () => this.updatePlayerInputs());
        
        // Form submission
        this.setupForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        
        // Load existing games
        document.getElementById('loadExistingBtn').addEventListener('click', () => this.loadExistingGames());
        
        // Generate random game ID
        document.getElementById('generateIdBtn').addEventListener('click', () => this.generateRandomGameId());
    }

    checkFirebaseConnection() {
        // Wait for Firebase to initialize
        const checkInterval = setInterval(() => {
            if (window.firebaseDB) {
                clearInterval(checkInterval);
                this.connectionStatus.textContent = 'Connected to Firebase';
                this.connectionStatus.className = 'success';
                this.loadExistingGames();
            }
        }, 500);
        
        // Timeout after 10 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.firebaseDB) {
                this.connectionStatus.textContent = 'Failed to connect to Firebase';
                this.connectionStatus.className = 'error';
            }
        }, 10000);
    }

    updatePlayerInputs() {
        const numPlayers = parseInt(this.numPlayersInput.value);
        this.playerInputContainer.innerHTML = '';
        
        for (let i = 1; i <= numPlayers; i++) {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-input';
            playerDiv.innerHTML = `
                <label for="player${i}">Player ${i} Name:</label>
                <input type="text" id="player${i}" name="player${i}" required>
            `;
            this.playerInputContainer.appendChild(playerDiv);
        }
    }

    generateRandomGameId() {
        const randomId = 'game_' + Math.random().toString(36).substring(2, 10);
        this.gameIdInput.value = randomId;
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        const gameId = this.gameIdInput.value.trim();
        const numPlayers = parseInt(this.numPlayersInput.value);
        const winCondition = parseInt(this.winConditionInput.value);
        
        // Collect player names
        const playerNames = [];
        for (let i = 1; i <= numPlayers; i++) {
            const playerName = document.getElementById(`player${i}`).value.trim();
            playerNames.push(playerName);
        }
        
        // Validate
        if (playerNames.some(name => name === '')) {
            alert('All player names are required');
            return;
        }
        
        // Game configuration
        const gameConfig = {
            gameId: gameId,
            playerNames: playerNames,
            winCondition: winCondition,
            gameTypes: this.getSelectedGameTypes(),
            playTypes: ['1v1', '2v2', '3v3', '5v5'] // Default play types
        };
        
        try {
            // Initialize game
            this.gameEngine.initializeGame(gameConfig);
            
            // Redirect to admin page
            window.location.href = `admin.html?gameId=${gameId}`;
        } catch (error) {
            alert(`Error creating game: ${error.message}`);
            console.error(error);
        }
    }
    
    getSelectedGameTypes() {
        const options = this.gameTypeSelect.selectedOptions;
        const selectedTypes = [];
        for (let i = 0; i < options.length; i++) {
            selectedTypes.push(options[i].value);
        }
        return selectedTypes.length > 0 ? selectedTypes : ['CS2', 'Dota2', 'Valorant', 'StarCraft2', 'Predecessor'];
    }

    async loadExistingGames() {
        if (!window.firebaseDB) {
            alert('Firebase is not initialized yet');
            return;
        }
        
        try {
            // Get games collection from Firestore
            const gamesCollection = await window.firebaseGetDocs(
                window.firebaseCollection(window.firebaseDB, "games")
            );
            
            if (gamesCollection.empty) {
                this.existingGamesContainer.innerHTML = '<p>No existing games found</p>';
                return;
            }
            
            // Display games
            this.existingGamesContainer.innerHTML = '<h3>Existing Games</h3><ul class="games-list"></ul>';
            const gamesList = this.existingGamesContainer.querySelector('ul');
            
            gamesCollection.forEach(doc => {
                const game = doc.data();
                const listItem = document.createElement('li');
                
                const createdDate = game.createdAt ? new Date(game.createdAt).toLocaleDateString() : 'Unknown date';
                
                listItem.innerHTML = `
                    <strong>${game.gameId}</strong>
                    <div class="game-info">Created: ${createdDate}</div>
                    <div class="game-actions">
                        <a href="game.html?gameId=${game.gameId}" class="btn">Play</a>
                        <a href="admin.html?gameId=${game.gameId}" class="btn admin">Admin</a>
                    </div>
                `;
                gamesList.appendChild(listItem);
            });
            
        } catch (error) {
            console.error('Error loading games:', error);
            this.existingGamesContainer.innerHTML = `<p class="error">Error loading games: ${error.message}</p>`;
        }
    }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const setupController = new SetupController();
    
    // Update player inputs initially
    setupController.updatePlayerInputs();
});