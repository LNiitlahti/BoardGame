// scripts/spell-system.js
/**
 * SPELL SYSTEM - All spell card functionality
 * Handles both logic and display for spell cards
 */

class SpellSystem {
    constructor(gameEngine) {
        this.gameEngine = gameEngine;
        this.spellDeck = [];
        this.activeEffects = [];
        this.initialized = false;
    }
    
    // ============================================
    // INITIALIZATION
    // ============================================
    
    initializeDeck() {
        // Define all spell cards with their effects
        this.spellDeck = [
            {
                id: 'spell-1',
                name: 'Minä voitin, eikun minä voitin!',
                nameEn: 'I won, no I won!',
                type: 'pre-game',
                duration: null,
                canPlay: (gameState, teamId) => {
                    // Can play before game if "Rats" are on different teams
                    // You'll need to implement rat detection logic
                    return true; // Simplified for now
                },
                effect: (gameState, teamId, targets) => {
                    // Grant extra plate placement + 1 victory point
                    const team = gameState.teams.find(t => t.id === teamId);
                    if (team) {
                        team.bonusPlates = (team.bonusPlates || 0) + 1;
                        team.points += 1;
                        console.log(`Spell effect: Team ${teamId} gains +1 plate and +1 point`);
                    }
                    return {
                        success: true,
                        message: `${team.name} gains 1 bonus plate and 1 point!`
                    };
                }
            },
            {
                id: 'spell-2',
                name: 'Me halutaan pelata omia pelejä',
                nameEn: 'We want to play our own games',
                type: 'pre-game',
                duration: null,
                canPlay: (gameState, teamId) => {
                    // Can be played before next game starts
                    return !gameState.currentTurn;
                },
                effect: (gameState, teamId, targets) => {
                    // Rats get to choose next game and team distribution
                    gameState.nextGameChoice = {
                        chooserTeam: teamId,
                        canChooseGame: true,
                        canChooseTeams: true
                    };
                    return {
                        success: true,
                        message: `Team ${teamId} will choose the next game and teams!`
                    };
                }
            },
            {
                id: 'spell-3',
                name: 'Hyi saatana, rottia!',
                nameEn: 'Oh damn, rats!',
                type: 'persistent',
                duration: 3,
                canPlay: (gameState, teamId) => {
                    return true;
                },
                effect: (gameState, teamId, targets) => {
                    // Lasts 3 games - can remove adjacent opponent plates
                    return {
                        success: true,
                        message: `Persistent effect: Next 3 plate placements can destroy adjacent enemy plates!`,
                        persistent: true,
                        duration: 3
                    };
                }
            },
            {
                id: 'spell-4',
                name: 'Kortin varastus',
                nameEn: 'Card theft',
                type: 'instant',
                duration: null,
                canPlay: (gameState, teamId) => {
                    // Can play on your turn
                    return gameState.currentTurn?.teamId === teamId;
                },
                effect: (gameState, teamId, targets) => {
                    // Steal random card from target team
                    if (!targets || !targets.targetTeamId) {
                        return { success: false, message: 'No target team selected' };
                    }
                    
                    const targetTeam = gameState.teams.find(t => t.id === targets.targetTeamId);
                    if (!targetTeam || !targetTeam.spellCards || targetTeam.spellCards.length === 0) {
                        return { success: false, message: 'Target team has no cards' };
                    }
                    
                    // Steal random card
                    const randomIndex = Math.floor(Math.random() * targetTeam.spellCards.length);
                    const stolenCard = targetTeam.spellCards.splice(randomIndex, 1)[0];
                    
                    const yourTeam = gameState.teams.find(t => t.id === teamId);
                    yourTeam.spellCards.push(stolenCard);
                    
                    return {
                        success: true,
                        message: `Stole "${stolenCard.name}" from ${targetTeam.name}!`,
                        stolenCard: stolenCard
                    };
                }
            },
            {
                id: 'spell-5',
                name: 'VITTU TÄÄLÄKIN ON ROTTIA',
                nameEn: 'FUCK, RATS HERE TOO',
                type: 'challenge',
                duration: null,
                canPlay: (gameState, teamId) => {
                    // Can play before next game
                    return !gameState.currentTurn;
                },
                effect: (gameState, teamId, targets) => {
                    // Challenge for any side heart hex control
                    if (!targets || !targets.heartHex) {
                        return { success: false, message: 'No heart hex selected' };
                    }
                    
                    const heartHex = targets.heartHex;
                    const currentOwner = gameState.heartHexControl?.[heartHex];
                    
                    if (!currentOwner || currentOwner === teamId) {
                        return { success: false, message: 'Cannot challenge uncontrolled or own heart hex' };
                    }
                    
                    // Set up challenge
                    gameState.pendingChallenge = {
                        challenger: teamId,
                        defender: currentOwner,
                        prize: heartHex,
                        type: 'heart-hex'
                    };
                    
                    return {
                        success: true,
                        message: `Challenge initiated for ${heartHex}! Next game decides ownership.`
                    };
                }
            }
        ];
        
        this.initialized = true;
        console.log('Spell deck initialized with', this.spellDeck.length, 'cards');
    }
    
    // ============================================
    // CARD MANAGEMENT
    // ============================================
    
    drawCard(teamId) {
        if (this.spellDeck.length === 0) {
            this.reshuffleDeck();
        }
        
        if (this.spellDeck.length === 0) {
            return null; // No cards available
        }
        
        // Draw from top of deck
        const card = this.spellDeck.pop();
        
        // Add to team's hand
        const team = this.gameEngine.getTeam(teamId);
        if (team) {
            if (!team.spellCards) team.spellCards = [];
            team.spellCards.push(card);
            
            // Show visual
            this.showDrawAnimation(card, team);
        }
        
        return card;
    }
    
    reshuffleDeck() {
        // Collect all cards back
        console.log('Reshuffling spell deck...');
        this.initializeDeck();
        this.shuffleDeck();
    }
    
    shuffleDeck() {
        // Fisher-Yates shuffle
        for (let i = this.spellDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.spellDeck[i], this.spellDeck[j]] = [this.spellDeck[j], this.spellDeck[i]];
        }
    }
    
    // ============================================
    // PLAYING CARDS
    // ============================================
    
    canPlayCard(cardId, teamId) {
        const card = this.findCard(cardId);
        if (!card) return false;
        
        // Check if team has this card
        const team = this.gameEngine.getTeam(teamId);
        if (!team || !team.spellCards) return false;
        
        const hasCard = team.spellCards.some(c => c.id === cardId);
        if (!hasCard) return false;
        
        // Check card-specific conditions
        return card.canPlay(this.gameEngine.gameState, teamId);
    }
    
    playCard(cardId, teamId, targets = null) {
        const card = this.findCard(cardId);
        
        if (!card) {
            throw new Error('Card not found');
        }
        
        if (!this.canPlayCard(cardId, teamId)) {
            throw new Error('Cannot play this card right now');
        }
        
        // Execute the card effect
        const result = card.effect(this.gameEngine.gameState, teamId, targets);
        
        if (!result.success) {
            throw new Error(result.message || 'Card effect failed');
        }
        
        // Remove card from hand
        const team = this.gameEngine.getTeam(teamId);
        team.spellCards = team.spellCards.filter(c => c.id !== cardId);
        
        // Add to discard pile
        if (!this.discardPile) this.discardPile = [];
        this.discardPile.push(card);
        
        // Show visual
        this.showCardPlayedAnimation(card, team, result);
        
        // Add to active effects if persistent
        if (result.persistent) {
            this.activeEffects.push({
                cardId: card.id,
                cardName: card.name,
                teamId: teamId,
                remainingTurns: result.duration || card.duration,
                effect: card.effect
            });
        }
        
        // Log to game history
        this.gameEngine.emit('spellPlayed', {
            cardId,
            teamId,
            cardName: card.name,
            result
        });
        
        return result;
    }
    
    findCard(cardId) {
        // Search in deck
        let card = this.spellDeck.find(c => c.id === cardId);
        if (card) return card;
        
        // Search in all team hands
        for (const team of this.gameEngine.gameState.teams) {
            if (team.spellCards) {
                card = team.spellCards.find(c => c.id === cardId);
                if (card) return card;
            }
        }
        
        // Search in discard pile
        if (this.discardPile) {
            card = this.discardPile.find(c => c.id === cardId);
            if (card) return card;
        }
        
        return null;
    }
    
    // ============================================
    // PERSISTENT EFFECTS
    // ============================================
    
    processTurnEffects(gameState) {
        // Process and update all active effects
        this.activeEffects = this.activeEffects.filter(effect => {
            effect.remainingTurns--;
            
            if (effect.remainingTurns <= 0) {
                // Effect expires
                console.log(`Spell effect expired: ${effect.cardName}`);
                this.showEffectExpiredNotification(effect);
                return false; // Remove from active effects
            }
            
            // Keep effect active
            return true;
        });
    }
    
    hasActiveEffect(cardId) {
        return this.activeEffects.some(e => e.cardId === cardId);
    }
    
    getActiveEffectsForTeam(teamId) {
        return this.activeEffects.filter(e => e.teamId === teamId);
    }
    
    // ============================================
    // VISUAL FUNCTIONS
    // ============================================
    
    showCardPlayedAnimation(card, team, result) {
        // Create sparkle effect
        const notification = document.createElement('div');
        notification.className = 'spell-notification spell-played';
        notification.innerHTML = `
            <div class="spell-icon">✨</div>
            <div class="spell-details">
                <div class="spell-title">${team.name} played:</div>
                <div class="spell-name">${card.name}</div>
                <div class="spell-effect">${result.message}</div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Fade out after 4 seconds
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 4000);
    }
    
    showDrawAnimation(card, team) {
        // Show "Card drawn!" notification
        const notification = document.createElement('div');
        notification.className = 'spell-notification spell-drawn';
        notification.innerHTML = `
            <div class="spell-icon">🎴</div>
            <div class="spell-details">
                <div class="spell-title">${team.name} drew:</div>
                <div class="spell-name">${card.name}</div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }
    
    showEffectExpiredNotification(effect) {
        const notification = document.createElement('div');
        notification.className = 'spell-notification spell-expired';
        notification.innerHTML = `
            <div class="spell-icon">⏰</div>
            <div class="spell-details">
                <div class="spell-title">Effect expired:</div>
                <div class="spell-name">${effect.cardName}</div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }
    
    renderHandCards(teamId, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const team = this.gameEngine.getTeam(teamId);
        if (!team || !team.spellCards || team.spellCards.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#666;">No spell cards in hand</p>';
            return;
        }
        
        container.innerHTML = team.spellCards.map(card => {
            const canPlay = this.canPlayCard(card.id, teamId);
            
            return `
                <div class="spell-card-hand ${canPlay ? 'playable' : 'disabled'}" 
                     data-card-id="${card.id}"
                     onclick="${canPlay ? `spellSystem.promptPlayCard('${card.id}', ${teamId})` : ''}">
                    <div class="spell-card-type-badge ${card.type}">${card.type}</div>
                    <h3>${card.name}</h3>
                    <p class="spell-card-desc">${card.nameEn || ''}</p>
                    ${canPlay ? '<div class="play-indicator">✨ Can Play</div>' : ''}
                </div>
            `;
        }).join('');
    }
    
    promptPlayCard(cardId, teamId) {
        const card = this.findCard(cardId);
        if (!card) return;
        
        // Check if card needs targets
        if (card.id === 'spell-4') {
            // Card theft - need to select target team
            this.showTeamSelector(cardId, teamId);
        } else if (card.id === 'spell-5') {
            // Challenge - need to select heart hex
            this.showHeartHexSelector(cardId, teamId);
        } else {
            // Play immediately
            if (confirm(`Play "${card.name}"?`)) {
                try {
                    const result = this.playCard(cardId, teamId);
                    alert(result.message);
                    this.gameEngine.saveToStorage();
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
        }
    }
    
    showTeamSelector(cardId, teamId) {
        // Simple prompt for team selection (can be improved with modal)
        const teams = this.gameEngine.gameState.teams
            .filter(t => t.id !== teamId)
            .map((t, i) => `${i + 1}. ${t.name}`)
            .join('\n');
        
        const selection = prompt(`Select target team:\n${teams}\n\nEnter number:`);
        
        if (selection) {
            const targetIdx = parseInt(selection) - 1;
            const targetTeam = this.gameEngine.gameState.teams.filter(t => t.id !== teamId)[targetIdx];
            
            if (targetTeam) {
                try {
                    const result = this.playCard(cardId, teamId, { targetTeamId: targetTeam.id });
                    alert(result.message);
                    this.gameEngine.saveToStorage();
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
        }
    }
    
    showHeartHexSelector(cardId, teamId) {
        // Simple prompt for heart hex selection (can be improved with modal)
        const controlledHearts = Object.entries(this.gameEngine.gameState.heartHexControl || {})
            .filter(([hex, owner]) => owner !== teamId)
            .map(([hex, owner], i) => {
                const ownerTeam = this.gameEngine.getTeam(owner);
                return `${i + 1}. ${hex} (controlled by ${ownerTeam?.name})`;
            })
            .join('\n');
        
        if (!controlledHearts) {
            alert('No heart hexes available to challenge');
            return;
        }
        
        const selection = prompt(`Select heart hex to challenge:\n${controlledHearts}\n\nEnter number:`);
        
        if (selection) {
            const targetIdx = parseInt(selection) - 1;
            const heartHex = Object.keys(this.gameEngine.gameState.heartHexControl)
                .filter(hex => this.gameEngine.gameState.heartHexControl[hex] !== teamId)[targetIdx];
            
            if (heartHex) {
                try {
                    const result = this.playCard(cardId, teamId, { heartHex });
                    alert(result.message);
                    this.gameEngine.saveToStorage();
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
        }
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.SpellSystem = SpellSystem;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpellSystem;
}