/**
 * TEAM CONTROLS SCRIPT
 * Handles all functionality for the team.html page
 * - Team member authentication and verification
 * - Real-time tournament/match data loading
 * - Team name editing
 * - Spell cards display
 * - Board state rendering
 * - Match result voting (90% consensus system)
 */

let currentUser = null;
let currentGameId = null;
let currentTeamId = null;
let gameData = null;
let teamData = null;
let boardRenderer = null;
let unsubscribeGameListener = null;
let selectedVote = null;

/**
 * Initialize team controls when Firebase is ready
 */
document.addEventListener('firebase-ready', function() {
    console.log('[Team Controls] Firebase ready, initializing...');

    const auth = firebase.auth();

    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            console.log('[Team Controls] Not authenticated, redirecting to login');
            alert('You must be logged in to access team controls');
            window.location.href = 'login.html';
            return;
        }

        console.log('[Team Controls] User authenticated:', user.uid);
        currentUser = user;

        // Get gameId and teamId from URL params
        const urlParams = new URLSearchParams(window.location.search);
        currentGameId = urlParams.get('gameId');
        currentTeamId = parseInt(urlParams.get('teamId'));

        console.log('[Team Controls] Game ID:', currentGameId, 'Team ID:', currentTeamId);

        if (!currentGameId || isNaN(currentTeamId)) {
            console.warn('[Team Controls] Missing gameId or teamId in URL');

            // Try to get from user document
            try {
                const db = firebase.firestore();
                const userDoc = await db.collection('users').doc(user.uid).get();

                if (userDoc.exists) {
                    const userData = userDoc.data();
                    currentGameId = userData.assignedGameId;
                    currentTeamId = userData.assignedTeamId;

                    if (currentGameId && currentTeamId) {
                        // Redirect with proper params
                        window.location.href = `team.html?gameId=${currentGameId}&teamId=${currentTeamId}`;
                        return;
                    }
                }
            } catch (error) {
                console.error('[Team Controls] Error fetching user data:', error);
            }

            alert('No team assignment found. Please contact an administrator.');
            window.location.href = 'index.html';
            return;
        }

        // Load tournament and verify team membership
        await loadTournamentData();
    });
});

/**
 * Load tournament data and verify user is a team member
 */
async function loadTournamentData() {
    try {
        const db = firebase.firestore();
        const tournamentRef = db.collection('tournaments').doc(currentGameId);

        console.log('[Team Controls] Loading tournament:', currentGameId);

        // Set up real-time listener
        unsubscribeGameListener = tournamentRef.onSnapshot((doc) => {
            if (!doc.exists) {
                console.error('[Team Controls] Tournament not found');
                alert('Tournament not found');
                window.location.href = 'index.html';
                return;
            }

            gameData = doc.data();
            console.log('[Team Controls] Tournament data loaded:', gameData);

            // Find team
            teamData = gameData.teams?.find(t => t.id === currentTeamId);

            if (!teamData) {
                console.error('[Team Controls] Team not found in tournament');
                alert('Team not found in tournament');
                window.location.href = 'index.html';
                return;
            }

            // Verify user is on this team
            const isTeamMember = teamData.players?.some(p => p.uid === currentUser.uid);

            if (!isTeamMember) {
                console.error('[Team Controls] User is not a member of this team');
                alert('You are not a member of this team');
                window.location.href = 'index.html';
                return;
            }

            console.log('[Team Controls] Team membership verified');

            // Render all sections
            renderTeamHeader();
            renderTeammates();
            renderTeamStats();
            renderSpellCards();
            renderBoard();
            renderCurrentMatch();
            renderUpcomingMatches();
            renderRecentEvents();
            checkForVoting();
        }, (error) => {
            console.error('[Team Controls] Error loading tournament:', error);
            showStatus('Error loading tournament data: ' + error.message, 'error');
        });

    } catch (error) {
        console.error('[Team Controls] Error in loadTournamentData:', error);
        showStatus('Error loading tournament: ' + error.message, 'error');
    }
}

/**
 * Render team header (name and points)
 */
function renderTeamHeader() {
    const teamColor = getHexColor(teamData.color);
    const teamNameElement = document.getElementById('teamNameDisplay');
    const teamPointsElement = document.getElementById('teamPointsDisplay');

    teamNameElement.textContent = teamData.name || `Team ${currentTeamId}`;
    teamPointsElement.textContent = teamData.points || 0;

    // Add team color indicator to the header
    teamNameElement.style.borderLeft = `6px solid ${teamColor}`;
    teamNameElement.style.paddingLeft = '15px';
    teamNameElement.style.color = teamColor;

    // Also add a color badge
    const existingBadge = document.querySelector('.team-color-badge');
    if (existingBadge) {
        existingBadge.remove();
    }

    const colorBadge = document.createElement('span');
    colorBadge.className = 'team-color-badge';
    colorBadge.style.cssText = `
        display: inline-block;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: ${teamColor};
        border: 2px solid ${teamColor};
        box-shadow: 0 0 10px ${teamColor}80;
        margin-left: 10px;
        vertical-align: middle;
    `;
    teamNameElement.appendChild(colorBadge);

    // Apply team color border to all team panels
    document.querySelectorAll('.team-panel').forEach(panel => {
        panel.style.borderTop = `4px solid ${teamColor}`;
        panel.style.boxShadow = `0 0 15px ${teamColor}20`;
    });

    // Apply team color to the main header
    const teamHeader = document.querySelector('.team-header');
    if (teamHeader) {
        teamHeader.style.borderBottom = `3px solid ${teamColor}`;
    }
}

/**
 * Render teammates list
 */
function renderTeammates() {
    const container = document.getElementById('teammatesList');

    if (!teamData.players || teamData.players.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">No teammates assigned</p>';
        return;
    }

    container.innerHTML = teamData.players.map(player => {
        const isYou = player.uid === currentUser.uid;
        return `
            <div class="teammate-item ${isYou ? 'you' : ''}">
                <div class="teammate-name">
                    ${player.name || player.email || 'Unknown Player'}
                    ${isYou ? '<span class="you-badge">YOU</span>' : ''}
                </div>
                ${player.email && !isYou ? `<div style="font-size: 0.85rem; opacity: 0.7;">${player.email}</div>` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Render team statistics
 */
function renderTeamStats() {
    // Calculate stats from game history
    let wins = 0;
    let losses = 0;

    if (gameData.gameHistory && Array.isArray(gameData.gameHistory)) {
        gameData.gameHistory.forEach(game => {
            const winners = Array.isArray(game.winner) ? game.winner : [game.winner];
            const losers = Array.isArray(game.loser) ? game.loser : [game.loser];

            // Check if this team won or lost
            const teamWon = winners.some(w =>
                w === teamData.name ||
                (teamData.players && teamData.players.some(p => p.name === w))
            );

            const teamLost = losers.some(l =>
                l === teamData.name ||
                (teamData.players && teamData.players.some(p => p.name === l))
            );

            if (teamWon) wins++;
            if (teamLost) losses++;
        });
    }

    const gamesPlayed = wins + losses;

    // Count heart hexes controlled by this team
    let heartsControlled = 0;
    if (gameData.heartHexControl) {
        Object.values(gameData.heartHexControl).forEach(controller => {
            if (controller === teamData.color || controller === teamData.name) {
                heartsControlled++;
            }
        });
    }

    document.getElementById('teamWins').textContent = wins;
    document.getElementById('teamLosses').textContent = losses;
    document.getElementById('teamGamesPlayed').textContent = gamesPlayed;
    document.getElementById('teamHeartsControlled').textContent = heartsControlled;
}

/**
 * Render spell cards
 */
function renderSpellCards() {
    const container = document.getElementById('spellCardsList');
    const countDisplay = document.getElementById('spellCardsCount');

    // Check if team has spell cards
    const spellCards = teamData.spellCards || teamData.hand || [];

    countDisplay.textContent = `${spellCards.length} card${spellCards.length !== 1 ? 's' : ''} available`;

    if (spellCards.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5; grid-column: 1 / -1;">No spell cards available</p>';
        return;
    }

    // Check if it's this team's turn
    const isOurTurn = checkIfOurTurn();

    container.innerHTML = spellCards.map((card, index) => {
        const cardName = typeof card === 'string' ? card : (card.name || 'Unknown Card');
        const cardDesc = typeof card === 'object' ? (card.description || 'Special ability') : 'Special ability';

        return `
            <div class="spell-card ${!isOurTurn ? 'disabled' : ''}"
                 onclick="${isOurTurn ? `useSpellCard(${index})` : ''}">
                <div class="spell-card-name">${cardName}</div>
                <div class="spell-card-desc">${cardDesc}</div>
            </div>
        `;
    }).join('');
}

/**
 * Check if it's currently this team's turn
 */
function checkIfOurTurn() {
    if (!gameData.currentTurn) return false;

    // Check if current match involves this team
    const currentMatch = gameData.selectedGames?.find(
        g => g.game === gameData.currentTurn.game || g.gameNumber === gameData.currentTurn.game
    );

    if (!currentMatch) return false;

    // Check if any player from this team is in the current match
    return currentMatch.sides?.some(side =>
        side.players?.some(p => teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name))
    );
}

/**
 * Use a spell card
 */
async function useSpellCard(cardIndex) {
    if (!teamData || !gameData) {
        showStatus('Game data not loaded', 'error');
        return;
    }

    const spellCards = teamData.spellCards || teamData.hand || [];
    const spell = spellCards[cardIndex];

    if (!spell) {
        showStatus('Spell card not found', 'error');
        return;
    }

    const spellId = typeof spell === 'string' ? spell : spell.id;

    try {
        // Initialize spell manager if needed
        if (!window.spellManager) {
            window.spellManager = new SpellManager();
            await window.spellManager.loadSpellDefinitions();
        }

        const spellDef = window.spellManager.getSpell(spellId);
        if (!spellDef) {
            showStatus('Spell definition not found', 'error');
            return;
        }

        // Show confirmation modal
        const confirmed = await showSpellConfirmation(spellDef);
        if (!confirmed) return;

        // Get target data if needed
        let targetData = {};
        if (requiresTarget(spellDef)) {
            targetData = await getSpellTarget(spellDef, gameData);
            if (!targetData) return; // User cancelled
        }

        // Cast the spell
        const result = await window.spellManager.castSpell(
            spellId,
            teamData.id,
            gameData,
            targetData
        );

        // Save to Firebase
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentGameId);
        await window.firebaseSetDoc(tournamentRef, gameData);

        // Update UI
        renderSpellCards();

        showStatus(`✨ ${spellDef.name} cast successfully!`, 'success');
        console.log('[Team Controls] Spell cast result:', result);

    } catch (error) {
        console.error('[Team Controls] Error casting spell:', error);
        showStatus('Error casting spell: ' + error.message, 'error');
    }
}

/**
 * Check if spell requires target selection
 */
function requiresTarget(spell) {
    const targetTypes = ['opponent-card', 'opponent-team', 'opponent-player', 'board', 'adjacent-enemies'];
    return targetTypes.includes(spell.targetType);
}

/**
 * Show spell confirmation dialog
 */
function showSpellConfirmation(spell) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: #2a2a2a; padding: 30px; border-radius: 12px; max-width: 500px; color: white;">
                <h2 style="color: #00d4ff; margin-top: 0;">🔮 Cast Spell</h2>
                <h3 style="color: #fff;">${spell.name}</h3>
                <p style="color: #aaa; font-size: 14px;">${spell.type} • ${spell.rarity}</p>
                <p style="margin: 20px 0;">${spell.description}</p>
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="confirmSpell" style="flex: 1; background: #00d4ff; color: #1a1a1a; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Cast Spell
                    </button>
                    <button id="cancelSpell" style="flex: 1; background: #555; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('confirmSpell').onclick = () => {
            document.body.removeChild(modal);
            resolve(true);
        };

        document.getElementById('cancelSpell').onclick = () => {
            document.body.removeChild(modal);
            resolve(false);
        };
    });
}

/**
 * Get spell target selection
 */
async function getSpellTarget(spell, gameData) {
    // This will be expanded based on spell type
    // For now, return empty object
    return {};
}

/**
 * Render game board
 */
function renderBoard() {
    const hexBoardContainer = document.getElementById('hexBoard');

    if (!boardRenderer) {
        const boardModule = new BoardModule();
        boardRenderer = new BoardRenderer(hexBoardContainer, boardModule, {
            responsive: true
        });
    }

    boardRenderer.render(gameData);
}

/**
 * Render current match information
 */
function renderCurrentMatch() {
    const container = document.getElementById('currentMatchDisplay');

    console.log('[Team Controls] Rendering current match:', {
        currentTurn: gameData.currentTurn,
        selectedGames: gameData.selectedGames?.length || 0,
        gameQueue: gameData.gameQueue?.length || 0
    });

    // Check for matches in multiple sources
    const matchesSource = gameData.gameQueue || gameData.selectedGames || [];

    if (matchesSource.length === 0) {
        container.innerHTML = '<div class="match-status waiting">⏳ No matches scheduled</div>';
        return;
    }

    let currentMatch = null;

    // Strategy 1: If there's a currentTurn, find that match
    if (gameData.currentTurn) {
        currentMatch = matchesSource.find(
            g => g.game === gameData.currentTurn.game || g.gameNumber === gameData.currentTurn.game
        );
    }

    // Strategy 2: If no currentTurn or match not found, use the first pending/waiting match as "current"
    if (!currentMatch) {
        currentMatch = matchesSource.find(m =>
            m.status === 'pending' || m.status === 'waiting' || m.status === 'upcoming' || m.status === 'scheduled' || !m.status
        );
        console.log('[Team Controls] No active match, using first pending match as current:', currentMatch);
    }

    console.log('[Team Controls] Found current match:', currentMatch);

    if (!currentMatch) {
        container.innerHTML = '<div class="match-status waiting">⏳ No active match. Waiting for next game...</div>';
        return;
    }

    // Check if this team is playing in current match - try multiple methods
    let isPlaying = false;

    if (currentMatch.sides && Array.isArray(currentMatch.sides)) {
        isPlaying = currentMatch.sides.some(side =>
            side.players?.some(p =>
                teamData.players?.some(tp =>
                    tp.uid === p.uid ||
                    tp.name === p.name ||
                    tp.email === p.email
                )
            )
        );
    }

    // Fallback: Check if team name is in the match
    if (!isPlaying && teamData.name) {
        const matchStr = JSON.stringify(currentMatch).toLowerCase();
        isPlaying = matchStr.includes(teamData.name.toLowerCase());
    }

    console.log('[Team Controls] Is team playing in current match:', isPlaying);

    // Determine match status text
    const isActiveMatch = gameData.currentTurn && (currentMatch.game === gameData.currentTurn.game || currentMatch.gameNumber === gameData.currentTurn.game);
    const statusText = isActiveMatch && isPlaying ? '🎮 IT\'S YOUR TURN!' : isActiveMatch ? '⏳ Match in progress...' : '📋 NEXT MATCH';
    const statusClass = isActiveMatch && isPlaying ? 'active' : isActiveMatch ? 'waiting' : 'upcoming';

    if (!isPlaying) {
        // Show the match info anyway but indicate team involvement
        const sidesData = currentMatch.sides || currentMatch.teams || [];
        console.log('[Team Controls] Rendering sides (not playing):', sidesData);

        let sidesHTML = '';
        if (sidesData.length === 0) {
            sidesHTML = '<div style="opacity: 0.5;">No sides configured</div>';
        } else {
            const sideElements = sidesData.map((side, index) => {
                const playersHTML = (side.players || []).map(p => {
                    const playerColor = getHexColor(p.color || p.teamColor || p.originalTeamColor);
                    return `<div class="player-chip" style="border-color: ${playerColor}; color: ${playerColor};">${p.name || 'Player'}</div>`;
                }).join('');

                return `
                    <div class="match-side">
                        <div style="font-weight: 600; font-size: 0.75rem; color: var(--accent-primary); margin-bottom: 2px;">
                            Side ${String.fromCharCode(65 + index)}
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 1px;">
                            ${playersHTML || '<div style="opacity: 0.5; font-size: 0.75rem;">No players</div>'}
                        </div>
                    </div>
                `;
            });

            // Add VS dividers between all sides
            sidesHTML = sideElements.reduce((acc, side, index) => {
                acc.push(side);
                if (index < sideElements.length - 1) {
                    acc.push('<div class="vs-divider">VS</div>');
                }
                return acc;
            }, []).join('');
        }

        container.innerHTML = `
            <div class="match-status ${statusClass}">${statusText}</div>
            <div style="text-align: center; font-weight: bold; font-size: 0.9rem; margin: 8px 0 6px 0; color: var(--accent-primary);">
                Game ${currentMatch.game || currentMatch.gameNumber} - ${currentMatch.gameType || 'Match'}
            </div>
            <div class="match-details">
                <div class="match-sides">
                    ${sidesHTML}
                </div>
                ${currentMatch.notes ? `<div style="margin-top: 8px; font-size: 0.85rem; opacity: 0.7; font-style: italic; text-align: center;">${currentMatch.notes}</div>` : ''}
            </div>
        `;
        return;
    }

    // Find which side we're on
    const sidesData = currentMatch.sides || currentMatch.teams || [];
    console.log('[Team Controls] Rendering sides (playing):', sidesData);

    let ourSideIndex = -1;
    sidesData.forEach((side, index) => {
        if ((side.players || []).some(p => teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name || tp.email === p.email))) {
            ourSideIndex = index;
        }
    });

    let sidesHTML = '';
    if (sidesData.length === 0) {
        sidesHTML = '<div style="opacity: 0.5;">No sides configured</div>';
    } else {
        const sideElements = sidesData.map((side, index) => {
            const isOurSide = index === ourSideIndex;
            const playersHTML = (side.players || []).map(p => {
                const playerColor = getHexColor(p.color || p.teamColor || p.originalTeamColor);
                return `<div class="player-chip" style="border-color: ${playerColor}; color: ${playerColor};">${p.name || 'Player'}</div>`;
            }).join('');

            return `
                <div class="match-side ${isOurSide ? 'your-side' : ''}">
                    <div style="font-weight: 600; font-size: 0.75rem; color: var(--accent-primary); margin-bottom: 2px;">
                        ${isOurSide ? '⭐ Your Side' : `Side ${String.fromCharCode(65 + index)}`}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 1px;">
                        ${playersHTML || '<div style="opacity: 0.5; font-size: 0.75rem;">No players</div>'}
                    </div>
                </div>
            `;
        });

        // Add VS dividers between all sides
        sidesHTML = sideElements.reduce((acc, side, index) => {
            acc.push(side);
            if (index < sideElements.length - 1) {
                acc.push('<div class="vs-divider">VS</div>');
            }
            return acc;
        }, []).join('');
    }

    const matchHTML = `
        <div class="match-status ${statusClass}">${statusText}</div>
        <div style="text-align: center; font-weight: bold; font-size: 0.9rem; margin: 8px 0 6px 0; color: var(--accent-primary);">
            Game ${currentMatch.game || currentMatch.gameNumber} - ${currentMatch.gameType || 'Match'}
        </div>
        <div class="match-details">
            <div class="match-sides">
                ${sidesHTML}
            </div>
            ${currentMatch.notes ? `<div style="margin-top: 8px; font-size: 0.85rem; opacity: 0.7; font-style: italic; text-align: center;">${currentMatch.notes}</div>` : ''}
        </div>
    `;

    container.innerHTML = matchHTML;

    // Store the current match so upcoming matches can skip it
    window.currentDisplayedMatchId = currentMatch.game || currentMatch.gameNumber;
}

/**
 * Render upcoming matches
 */
function renderUpcomingMatches() {
    const container = document.getElementById('upcomingMatchesList');

    // Check multiple possible sources for matches (same as view.html)
    const matchesData = gameData.gameQueue || gameData.selectedGames || gameData.upcomingMatches || gameData.matches || [];

    console.log('[Team Controls] Checking upcoming matches:', {
        gameQueue: gameData.gameQueue?.length || 0,
        selectedGames: gameData.selectedGames?.length || 0,
        upcomingMatches: gameData.upcomingMatches?.length || 0,
        matches: gameData.matches?.length || 0,
        totalMatchesData: matchesData.length,
        teamData: teamData,
        gameData: gameData
    });

    if (matchesData.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">No upcoming matches scheduled</p>';
        return;
    }

    // Filter upcoming matches that involve this team
    const upcomingMatches = matchesData.filter(match => {
        // Skip completed matches
        if (match.status === 'completed') return false;

        // Skip the match being shown as current
        const matchId = match.game || match.gameNumber;
        if (window.currentDisplayedMatchId && matchId === window.currentDisplayedMatchId) {
            console.log('[Team Controls] Skipping match shown as current:', matchId);
            return false;
        }

        // Also skip if there's a currentTurn and this is that match
        if (gameData.currentTurn && (match.game === gameData.currentTurn.game || match.gameNumber === gameData.currentTurn.game)) {
            return false;
        }

        // Check if this team is involved - try multiple methods
        let isInvolved = false;

        // Method 1: Check sides with player matching
        if (match.sides && Array.isArray(match.sides)) {
            isInvolved = match.sides.some(side =>
                side.players?.some(p =>
                    teamData.players?.some(tp =>
                        tp.uid === p.uid ||
                        tp.name === p.name ||
                        tp.email === p.email
                    )
                )
            );
        }

        // Method 2: Check if team name is mentioned
        if (!isInvolved && teamData.name) {
            const matchStr = JSON.stringify(match).toLowerCase();
            isInvolved = matchStr.includes(teamData.name.toLowerCase());
        }

        // Method 3: For pending/waiting matches, show all (like view.html does)
        if (!isInvolved && (match.status === 'pending' || match.status === 'waiting' || match.status === 'upcoming' || match.status === 'scheduled')) {
            console.log('[Team Controls] Including match due to pending status:', match);
            isInvolved = true;
        }

        console.log('[Team Controls] Match check:', {
            game: match.game || match.gameNumber,
            status: match.status,
            isInvolved: isInvolved,
            sides: match.sides,
            teamPlayers: teamData.players
        });

        return isInvolved;
    });

    console.log('[Team Controls] Filtered upcoming matches:', upcomingMatches.length);

    // If no team-specific matches, show all upcoming matches
    const displayMatches = upcomingMatches.length > 0 ? upcomingMatches : matchesData.filter(m =>
        m.status === 'pending' || m.status === 'waiting' || m.status === 'upcoming' || m.status === 'scheduled' || !m.status
    );

    console.log('[Team Controls] Display matches:', displayMatches.length);

    if (displayMatches.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">No upcoming matches scheduled</p>';
        return;
    }

    container.innerHTML = displayMatches.slice(0, 5).map(match => {
        // Get opponent info
        let opponentInfo = '';
        if (match.sides && match.sides.length >= 2) {
            const opponentSide = match.sides.find(side =>
                !side.players?.some(p => teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name))
            );
            if (opponentSide && opponentSide.players) {
                const opponentNames = opponentSide.players.map(p => {
                    const playerColor = getHexColor(p.color || p.teamColor || p.originalTeamColor);
                    return `<span style="color: ${playerColor};">${p.name || 'Player'}</span>`;
                }).join(', ');
                opponentInfo = `<div style="font-size: 0.85rem; opacity: 0.7; margin-top: 4px;">vs ${opponentNames}</div>`;
            }
        }

        return `
            <div style="background: var(--cream-alpha-1); padding: 10px; border-radius: var(--radius-md); margin-bottom: 10px;">
                <div style="font-weight: bold; color: var(--accent-primary);">Game ${match.game || match.gameNumber}</div>
                <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 4px;">
                    ${match.gameType || 'Match'} - ${match.playType || 'Unknown format'}
                </div>
                ${opponentInfo}
            </div>
        `;
    }).join('');
}

/**
 * Get hex color from team color property
 * Converts legacy color names to hex codes
 */
function getHexColor(color) {
    // If already a hex code, return it
    if (color && color.startsWith('#')) {
        return color;
    }

    // Map legacy color names to hex codes
    const colorMap = {
        'blue': '#3b82f6',
        'red': '#ef4444',
        'green': '#10b981',
        'yellow': '#f59e0b',
        'amber': '#f59e0b',
        'purple': '#a855f7',
        'pink': '#ec4899',
        'teal': '#14b8a6',
        'orange': '#f97316',
        'cyan': '#06b6d4',
        'lime': '#84cc16',
        'indigo': '#6366f1'
    };

    return colorMap[color?.toLowerCase()] || '#3b82f6'; // Default to blue
}

/**
 * Render recent events
 */
function renderRecentEvents() {
    const container = document.getElementById('recentEventsList');

    const events = gameData.events || gameData.gameHistory || [];

    if (events.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5;">No recent events</p>';
        return;
    }

    const recentEvents = events.slice(-10).reverse();

    container.innerHTML = recentEvents.map(event => {
        let message = event.text || event.message || event.description || '';

        // Format game history entries
        if (event.gameNumber || event.game) {
            const gameNum = event.gameNumber || event.game;
            const winner = Array.isArray(event.winner) ? event.winner.join(', ') : event.winner;
            const loser = Array.isArray(event.loser) ? event.loser.join(', ') : event.loser;
            message = `Game ${gameNum}: ${winner} defeated ${loser}`;
        }

        let timestamp = '';
        if (event.timestamp) {
            timestamp = new Date(event.timestamp).toLocaleTimeString();
        } else if (event.date) {
            timestamp = new Date(event.date).toLocaleTimeString();
        }

        return `
            <div style="background: var(--cream-alpha-05); padding: 8px; border-radius: var(--radius-sm); margin-bottom: 8px; font-size: 0.85rem;">
                ${timestamp ? `<div style="opacity: 0.5; font-size: 0.75rem;">${timestamp}</div>` : ''}
                <div>${message}</div>
            </div>
        `;
    }).join('');
}

/**
 * Check if voting is needed for any completed match
 */
function checkForVoting() {
    if (!gameData.selectedGames) return;

    // Find completed matches that need voting
    const matchNeedingVote = gameData.selectedGames.find(match => {
        // Must be completed
        if (match.status !== 'completed') return false;

        // Must involve this team
        const involvesTeam = match.sides?.some(side =>
            side.players?.some(p => teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name))
        );
        if (!involvesTeam) return false;

        // Check if user already voted
        const votes = match.votes || [];
        const userVoted = votes.some(v => v.uid === currentUser.uid);
        if (userVoted) {
            // Show progress but don't allow new vote
            showVotingProgress(match);
            return false;
        }

        // Check if already confirmed by admin
        if (match.adminConfirmed) return false;

        return true;
    });

    if (matchNeedingVote) {
        showVotingSection(matchNeedingVote);
    } else {
        document.getElementById('votingSection').style.display = 'none';
    }
}

/**
 * Show voting section for a match
 */
function showVotingSection(match) {
    const section = document.getElementById('votingSection');
    const infoDiv = document.getElementById('votingMatchInfo');
    const optionsDiv = document.getElementById('voteOptions');

    section.style.display = 'block';
    section.classList.add('active');

    infoDiv.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: bold; color: var(--accent-primary);">
            Game ${match.game || match.gameNumber} - ${match.gameType || 'Match'} has finished!
        </div>
        <div style="margin-top: 8px;">Who won this match?</div>
    `;

    // Create vote options for each side
    const sides = match.sides || [];
    optionsDiv.innerHTML = sides.map((side, index) => {
        const sideLabel = side.name || `Side ${String.fromCharCode(65 + index)}`;
        const players = side.players?.map(p => p.name || 'Player').join(', ') || 'Unknown players';

        return `
            <div class="vote-option" onclick="selectVote('side_${index}_won', ${index})">
                <input type="radio" name="vote" value="side_${index}_won" id="vote_${index}">
                <label for="vote_${index}" style="cursor: pointer;">
                    <div style="font-weight: bold;">${sideLabel} Won</div>
                    <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 4px;">${players}</div>
                </label>
            </div>
        `;
    }).join('') + `
        <div class="vote-option" onclick="selectVote('draw', -1)">
            <input type="radio" name="vote" value="draw" id="vote_draw">
            <label for="vote_draw" style="cursor: pointer;">
                <div style="font-weight: bold;">Draw / Tie</div>
                <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 4px;">No clear winner</div>
            </label>
        </div>
    `;

    // Show existing votes if any
    if (match.votes && match.votes.length > 0) {
        showVotingProgress(match);
    }
}

/**
 * Select a vote option
 */
function selectVote(voteValue, sideIndex) {
    selectedVote = voteValue;

    // Update UI
    document.querySelectorAll('.vote-option').forEach(el => {
        el.classList.remove('selected');
    });

    event.currentTarget.classList.add('selected');

    // Check the radio button
    const radio = event.currentTarget.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
}

/**
 * Submit vote
 */
async function submitVote() {
    if (!selectedVote) {
        showStatus('Please select a vote option', 'error');
        return;
    }

    try {
        const db = firebase.firestore();
        const tournamentRef = db.collection('tournaments').doc(currentGameId);

        // Find the match index
        const matchIndex = gameData.selectedGames.findIndex(m =>
            m.status === 'completed' &&
            !m.adminConfirmed &&
            m.sides?.some(side =>
                side.players?.some(p => teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name))
            )
        );

        if (matchIndex === -1) {
            showStatus('Match not found', 'error');
            return;
        }

        const vote = {
            uid: currentUser.uid,
            playerName: currentUser.displayName || currentUser.email,
            result: selectedVote,
            votedAt: new Date().toISOString()
        };

        // Add vote to the match
        const match = gameData.selectedGames[matchIndex];
        const votes = match.votes || [];
        votes.push(vote);

        await tournamentRef.update({
            [`selectedGames.${matchIndex}.votes`]: votes
        });

        showStatus('Vote submitted successfully!', 'success');
        selectedVote = null;

        // Check if consensus reached
        calculateVoteConsensus(matchIndex);

    } catch (error) {
        console.error('[Team Controls] Error submitting vote:', error);
        showStatus('Error submitting vote: ' + error.message, 'error');
    }
}

/**
 * Show voting progress
 */
function showVotingProgress(match) {
    const progressDiv = document.getElementById('voteProgress');
    const listDiv = document.getElementById('voteProgressList');

    progressDiv.style.display = 'block';

    const votes = match.votes || [];
    const totalPlayers = getTotalPlayersInMatch(match);
    const voteCounts = {};

    votes.forEach(vote => {
        voteCounts[vote.result] = (voteCounts[vote.result] || 0) + 1;
    });

    const maxVotes = Math.max(...Object.values(voteCounts));
    const agreementPercentage = totalPlayers > 0 ? (maxVotes / totalPlayers * 100).toFixed(0) : 0;

    listDiv.innerHTML = `
        <div style="margin-bottom: 15px; padding: 10px; background: var(--cream-alpha-05); border-radius: var(--radius-md);">
            <div style="font-weight: bold; color: var(--accent-primary);">
                ${votes.length} / ${totalPlayers} players voted (${agreementPercentage}% agreement)
            </div>
            ${agreementPercentage >= 90 ?
                '<div style="color: #4ade80; margin-top: 5px;">✅ Consensus reached! Awaiting admin confirmation.</div>' :
                '<div style="opacity: 0.7; margin-top: 5px;">Need 90% agreement to auto-submit</div>'
            }
        </div>
        ${votes.map(vote => `
            <div class="vote-item">
                <span>${vote.playerName}</span>
                <span style="color: var(--accent-primary);">${formatVoteResult(vote.result)}</span>
            </div>
        `).join('')}
    `;
}

/**
 * Get total players in a match
 */
function getTotalPlayersInMatch(match) {
    let count = 0;
    match.sides?.forEach(side => {
        count += side.players?.length || 0;
    });
    return count;
}

/**
 * Format vote result for display
 */
function formatVoteResult(result) {
    if (result === 'draw') return 'Draw/Tie';
    if (result.startsWith('side_')) {
        const sideIndex = parseInt(result.split('_')[1]);
        return `Side ${String.fromCharCode(65 + sideIndex)} Won`;
    }
    return result;
}

/**
 * Calculate vote consensus and auto-submit if threshold reached
 */
async function calculateVoteConsensus(matchIndex) {
    const match = gameData.selectedGames[matchIndex];
    const votes = match.votes || [];
    const totalPlayers = getTotalPlayersInMatch(match);

    if (totalPlayers === 0) return;

    const voteCounts = {};
    votes.forEach(vote => {
        voteCounts[vote.result] = (voteCounts[vote.result] || 0) + 1;
    });

    const maxVotes = Math.max(...Object.values(voteCounts));
    const agreedResult = Object.keys(voteCounts).find(result => voteCounts[result] === maxVotes);
    const agreementPercentage = (maxVotes / totalPlayers) * 100;

    if (agreementPercentage >= 90) {
        // Consensus reached!
        try {
            const db = firebase.firestore();
            const tournamentRef = db.collection('tournaments').doc(currentGameId);

            await tournamentRef.update({
                [`selectedGames.${matchIndex}.voteConsensus`]: {
                    result: agreedResult,
                    percentage: agreementPercentage,
                    passedThreshold: true,
                    submittedToAdmin: true,
                    submittedAt: new Date().toISOString()
                }
            });

            showStatus('🎉 Vote consensus reached! Result submitted to admin for approval.', 'success');
        } catch (error) {
            console.error('[Team Controls] Error updating consensus:', error);
        }
    }
}

/**
 * Save team name
 */
async function saveTeamName() {
    const newName = document.getElementById('newTeamNameInput').value.trim();

    if (!newName) {
        showStatus('Please enter a team name', 'error');
        return;
    }

    if (newName === teamData.name) {
        closeEditTeamNameModal();
        return;
    }

    try {
        const db = firebase.firestore();
        const tournamentRef = db.collection('tournaments').doc(currentGameId);

        // Find team index
        const teamIndex = gameData.teams.findIndex(t => t.id === currentTeamId);

        if (teamIndex === -1) {
            showStatus('Team not found', 'error');
            return;
        }

        await tournamentRef.update({
            [`teams.${teamIndex}.name`]: newName
        });

        showStatus('Team name updated successfully!', 'success');
        closeEditTeamNameModal();

        // Also update all user documents with new team name
        if (teamData.players) {
            const batch = db.batch();
            teamData.players.forEach(player => {
                if (player.uid) {
                    const userRef = db.collection('users').doc(player.uid);
                    batch.update(userRef, {
                        assignedTeamName: newName
                    });
                }
            });
            await batch.commit();
        }

    } catch (error) {
        console.error('[Team Controls] Error updating team name:', error);
        showStatus('Error updating team name: ' + error.message, 'error');
    }
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');

    statusEl.textContent = message;
    statusEl.style.display = 'block';

    // Remove previous type classes
    statusEl.classList.remove('success', 'error', 'info', 'warning');
    statusEl.classList.add(type);

    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 5000);
}

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    if (unsubscribeGameListener) {
        unsubscribeGameListener();
    }
});
