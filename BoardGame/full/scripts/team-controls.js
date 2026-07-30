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
let currentTournamentId = null;
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
            window.location.href = '../login.html';
            return;
        }

        console.log('[Team Controls] User authenticated:', user.uid);
        currentUser = user;

        // Get gameId and teamId from URL params
        const urlParams = new URLSearchParams(window.location.search);
        currentTournamentId = urlParams.get('tournamentId') || urlParams.get('gameId');
        currentTeamId = parseInt(urlParams.get('teamId'));

        console.log('[Team Controls] Tournament ID:', currentTournamentId, 'Team ID:', currentTeamId);

        if (!currentTournamentId || isNaN(currentTeamId)) {
            console.warn('[Team Controls] Missing gameId or teamId in URL');

            // Try to get from user document
            try {
                const db = firebase.firestore();
                const userDoc = await db.collection('users').doc(user.uid).get();

                if (userDoc.exists) {
                    const userData = userDoc.data();
                    currentTournamentId = userData.assignedTournamentId || userData.assignedGameId;
                    currentTeamId = userData.assignedTeamId;

                    if (currentTournamentId && currentTeamId) {
                        // Redirect with proper params
                        window.location.href = `team.html?tournamentId=${currentTournamentId}&teamId=${currentTeamId}`;
                        return;
                    }
                }
            } catch (error) {
                console.error('[Team Controls] Error fetching user data:', error);
            }

            // No team assignment — redirect to home where they can pick a tournament
            sessionStorage.setItem('homeNotice', 'You are not assigned to a team yet. Pick a tournament below or contact an administrator.');
            window.location.href = 'home.html';
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
        const tournamentRef = db.collection('tournaments').doc(currentTournamentId);

        console.log('[Team Controls] Loading tournament:', currentTournamentId);

        // Set up real-time listener
        unsubscribeGameListener = tournamentRef.onSnapshot((doc) => {
            if (!doc.exists) {
                console.error('[Team Controls] Tournament not found');
                alert('Tournament not found');
                window.location.href = '../index.html';
                return;
            }

            gameData = doc.data();
            console.log('[Team Controls] Tournament data loaded:', gameData);

            // Find team (use string comparison to handle type mismatches)
            teamData = gameData.teams?.find(t => String(t.id) === String(currentTeamId));

            if (!teamData) {
                console.error('[Team Controls] Team not found in tournament');
                alert('Team not found in tournament');
                window.location.href = '../index.html';
                return;
            }

            // Verify user is on this team
            const isTeamMember = teamData.players?.some(p => p.uid === currentUser.uid);

            if (!isTeamMember) {
                console.error('[Team Controls] User is not a member of this team');
                alert('You are not a member of this team');
                window.location.href = '../index.html';
                return;
            }

            console.log('[Team Controls] Team membership verified');

            // Dispatch teamLoaded event for theme application
            window.dispatchEvent(new CustomEvent('teamLoaded', {
                detail: { teamId: currentTeamId }
            }));

            // Render all sections
            renderScoreStrip();
            renderTeammates();
            renderSpellCards();
            renderActiveConditions();
            renderBoard();
            renderCurrentMatch();
            renderUpcomingMatches();
            renderRecentEvents();
            checkForVoting();
            renderPhaseOverlays();
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
 * Resolve player display name from registry (linked name) with fallback to legacy name
 */
function _resolvePlayerName(player) {
    if (player.id && window.PlayerUtils && gameData?.players) {
        const info = window.PlayerUtils.getPlayerDisplayInfo(gameData, player.id);
        if (info.name && info.name !== 'Unknown') return info.name;
    }
    return player.name || 'Player';
}

/**
 * Get per-player win counts from game history
 */
function _getPlayerWinCounts() {
    const wins = {};
    (gameData?.gameHistory || []).forEach(match => {
        (match.winningPlayerIds || []).forEach(id => {
            wins[id] = (wins[id] || 0) + 1;
        });
    });
    return wins;
}

/**
 * Render score strip showing all teams (matches view.html style)
 */
function renderScoreStrip() {
    const container = document.getElementById('scoreStrip');
    if (!container) return;

    const teams = gameData.teams || [];
    const playerWins = _getPlayerWinCounts();

    container.innerHTML = teams.map(team => {
        const color = getHexColor(team.color);
        const players = team.players || [];
        const hexPts = team.points || 0;
        const victoryPts = team.gamesWon || 0;
        const totalPts = hexPts + victoryPts;
        const isYou = String(team.id) === String(currentTeamId);

        const playersHtml = players.map((p, i) => {
            const name = _resolvePlayerName(p);
            const w = p.id ? (playerWins[p.id] || 0) : 0;
            const sep = i < players.length - 1 ? '<span class="sc-psep">&middot;</span>' : '';
            return `<div class="sc-player"><span class="sc-pname">${name}</span><span class="sc-pstar"><span class="star">\u2605</span><span class="pcount">${w}</span></span></div>${sep}`;
        }).join('');

        return `
            <div class="sc ${isYou ? 'is-you' : ''}" style="--c: ${color};">
                <div class="sc-tname-area"><span class="sc-tname">${team.name || 'Team ' + team.id}</span></div>
                <div class="sc-players-area">${playersHtml}</div>
                <div class="sc-score-area">
                    <span class="sc-score-num w">${victoryPts}</span>
                    <span class="sc-score-num pts">${hexPts}</span>
                    <span class="sc-score-num total">${totalPts}</span>
                </div>
            </div>
        `;
    }).join('');
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

    const isLobbyPhase = gameData?.currentPhase?.name === 'match_1_lobby' || gameData?.currentPhase?.name === 'match_2_lobby';
    const lobbyReady = gameData?.lobbyReady || {};

    // Find match assignment info for this team (discord channel, side label, lobby creator)
    const matchInfo = _getTeamMatchInfo();

    container.innerHTML = teamData.players.map(player => {
        const isYou = player.uid === currentUser.uid;
        const playerName = _escapeHtmlSafe(_resolvePlayerName(player));

        // Lobby ready status for this player
        let readyHTML = '';
        if (player.uid) {
            const r = lobbyReady[player.uid] || {};
            const gl = r.gameLobby === true || r.ready === true;
            const dc = r.discord === true || r.ready === true;
            const canClick = isLobbyPhase;

            if (isYou) {
                // Always show buttons for the current user; only clickable during lobby phase
                const glDisabled = gl || !canClick;
                const dcDisabled = dc || !canClick;
                readyHTML = `
                    <div class="teammate-ready-buttons">
                        <button class="teammate-ready-btn ${dc ? 'is-ready' : ''} ${!canClick ? 'phase-locked' : ''}" ${dcDisabled ? 'disabled' : ''}
                                onclick="event.stopPropagation(); setReadyStatus('discord')">
                            &#x1F3A7; ${dc ? '&#x2713;' : 'Discord'}
                        </button>
                        <button class="teammate-ready-btn ${gl ? 'is-ready' : ''} ${!canClick ? 'phase-locked' : ''}" ${glDisabled ? 'disabled' : ''}
                                onclick="event.stopPropagation(); setReadyStatus('gameLobby')">
                            &#x1F3AE; ${gl ? '&#x2713;' : 'Lobby'}
                        </button>
                    </div>`;
            } else {
                // Always show status indicators for teammates
                readyHTML = `
                    <div class="teammate-ready-indicators">
                        <span class="teammate-ready-icon ${dc ? 'on' : ''}">&#x1F3A7;</span>
                        <span class="teammate-ready-icon ${gl ? 'on' : ''}">&#x1F3AE;</span>
                    </div>`;
            }
        }

        // Check if this player is the lobby creator
        const isCreator = matchInfo.lobbyCreatorUid === player.uid;

        return `
            <div class="teammate-item ${isYou ? 'you' : ''}">
                ${isYou ? '<span class="you-label">YOU</span>' : ''}
                ${isCreator ? '<span class="you-label" style="background: rgba(168,85,247,0.2); color: #a855f7; border-color: rgba(168,85,247,0.3);">LOBBY CREATOR</span>' : ''}
                <div class="teammate-info-row">
                    <div class="teammate-name">${playerName}</div>
                    ${readyHTML}
                </div>
                ${player.email && !isYou ? `<div class="teammate-id">${player.email}</div>` : ''}
            </div>
        `;
    }).join('');

    // Show match assignment details (Discord channel + side) below the player list
    if (matchInfo.hasMatch) {
        let assignmentHTML = '<div class="teammate-assignment-info">';
        if (matchInfo.discordChannel) {
            assignmentHTML += `<div class="assignment-badge discord-badge">&#x1F3A7; Discord Channel <strong>#${matchInfo.discordChannel}</strong></div>`;
        }
        if (matchInfo.sideLabel) {
            assignmentHTML += `<div class="assignment-badge side-badge">&#x1F3AE; Game Lobby <strong>${matchInfo.sideLabel}</strong></div>`;
        }
        assignmentHTML += '</div>';
        container.insertAdjacentHTML('beforeend', assignmentHTML);
    }
}

/**
 * Find the current team's match assignment info (Discord channel, side label, lobby creator).
 */
function _getTeamMatchInfo() {
    const result = { hasMatch: false, discordChannel: null, sideLabel: null, lobbyCreatorUid: null };
    const queue = gameData?.gameQueue || [];

    for (const match of queue) {
        if (match.isBreak || match.status === 'completed') continue;
        const sides = match.teams || match.sides || [];

        const mySide = sides.find(side =>
            (side.players || []).some(p =>
                teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name)
            )
        );

        if (!mySide) continue;

        result.hasMatch = true;
        const mySideId = mySide.id || 'TEAM_A';

        // Discord channel
        if (match.discordChannels?.[mySideId]) {
            result.discordChannel = match.discordChannels[mySideId];
        }

        // Side label: TEAM_A → "Side A", TEAM_B → "Side B"
        const sideIndex = sides.indexOf(mySide);
        const sideLetter = mySideId.replace('TEAM_', '');
        result.sideLabel = sideLetter.length === 1
            ? `Side ${sideLetter}`
            : `Side ${String.fromCharCode(65 + sideIndex)}`;

        // Lobby creator
        if (match.lobbyCreators?.[mySideId]?.uid) {
            result.lobbyCreatorUid = match.lobbyCreators[mySideId].uid;
        }

        break; // Use first active match
    }

    return result;
}

/**
 * Render spell cards sidebar (uses new spellPiles data model)
 */
function renderSpellCards() {
    const section = document.getElementById('spellCardsSection');
    const container = document.getElementById('spellCardsList');
    const countDisplay = document.getElementById('spellCardsCount');
    if (!container || !countDisplay) return;

    if (!gameData?.spellsActive) {
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = '';

    // New data model: spellPiles per team
    const pile = gameData?.spellPiles?.[String(currentTeamId)];
    const hand = pile?.hand || [];

    // Fallback to legacy spellCards
    const cards = hand.length > 0 ? hand : (teamData?.spellCards || []);

    countDisplay.textContent = cards.length;

    if (cards.length === 0) {
        container.innerHTML = '<p class="empty-state-inline">No spell cards available</p>';
        return;
    }

    const defs = gameData?.spellDefinitions || {};
    container.innerHTML = cards.map((spellId, idx) => {
        const def = defs[spellId] || {};
        const name = _escapeHtmlSafe(def.nameEn || def.name || spellId);
        const desc = _escapeHtmlSafe(def.descriptionEn || def.description || '');
        return `
            <div class="spell-card" onclick="viewSpellDetail('${spellId}')">
                <div class="spell-card-name">${name}</div>
                <div class="spell-card-desc">${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}</div>
            </div>
        `;
    }).join('');
}

/** View spell detail in a modal */
function viewSpellDetail(spellId) {
    const defs = gameData?.spellDefinitions || {};
    const def = defs[spellId];
    if (!def) return;

    const name = _escapeHtmlSafe(def.name || spellId);
    const nameEn = _escapeHtmlSafe(def.nameEn || '');
    const desc = _escapeHtmlSafe(def.descriptionEn || def.description || '');

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';
    modal.innerHTML = `
        <div style="background: var(--bg-panel, rgba(20, 22, 30, 0.95)); padding: 25px; border-radius: 12px; max-width: 450px; width: 90%; color: white; border: 2px solid rgba(168,85,247,0.4);">
            <h3 style="color: #a855f7; margin-top: 0;">${name}</h3>
            ${nameEn ? `<p style="color: #9aa1ad; font-size: 0.85rem; margin-top: -10px;">${nameEn}</p>` : ''}
            <p style="font-size: 0.8rem; color: #64748b; text-transform: uppercase;">${def.type || ''} &bull; ${def.rarity || ''} &bull; ${def.timing || ''}</p>
            <p style="line-height: 1.6; color: #cbd5e1;">${desc}</p>
            <button class="btn secondary" onclick="this.closest('div[style]').remove()" style="width: 100%; margin-top: 15px;">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/** Render the spell phase overlay (shown/hidden based on current phase) */
function renderSpellPhaseOverlay() {
    const overlay = document.getElementById('spellPhaseOverlay');
    if (!overlay) return;

    const phaseName = gameData?.currentPhase?.name;
    if (!phaseName || !phaseName.startsWith('spell_window')) {
        overlay.style.display = 'none';
        return;
    }

    overlay.style.display = 'flex';

    const sp = gameData.spellPhase;
    if (!sp || !sp.isActive) {
        // Spell phase but no active turn order — waiting for initialization
        document.getElementById('spellPhaseTurnStatus').textContent = 'Spell phase starting...';
        document.getElementById('spellHandCards').innerHTML = '';
        document.getElementById('spellPhaseActions').style.display = 'none';
        document.getElementById('spellTurnCompletedMsg').style.display = 'none';
        return;
    }

    const currentTurnTeam = sp.turnOrder?.[sp.currentTeamIndex];
    const isOurTurn = currentTurnTeam === currentTeamId;
    const isCompleted = (sp.teamsCompleted || []).includes(currentTeamId);
    const statusEl = document.getElementById('spellPhaseTurnStatus');
    const actionsEl = document.getElementById('spellPhaseActions');
    const completedEl = document.getElementById('spellTurnCompletedMsg');

    if (isCompleted) {
        statusEl.textContent = 'Your turn is complete.';
        actionsEl.style.display = 'none';
        completedEl.style.display = '';
        _renderSpellPhaseHand(false);
    } else if (isOurTurn) {
        statusEl.textContent = 'It is YOUR TURN! Select a spell to cast or pass.';
        statusEl.style.color = '#a855f7';
        actionsEl.style.display = '';
        completedEl.style.display = 'none';
        _renderSpellPhaseHand(true);
    } else {
        const team = gameData.teams?.find(t => t.id === currentTurnTeam);
        statusEl.textContent = `Waiting... ${team?.name || 'Team ' + currentTurnTeam} is choosing...`;
        statusEl.style.color = '';
        actionsEl.style.display = 'none';
        completedEl.style.display = 'none';
        _renderSpellPhaseHand(false);
    }
}

/** Render spell hand as large cards in the spell phase overlay */
function _renderSpellPhaseHand(interactive) {
    const container = document.getElementById('spellHandCards');
    if (!container) return;

    const pile = gameData?.spellPiles?.[String(currentTeamId)];
    const hand = pile?.hand || [];
    const defs = gameData?.spellDefinitions || {};

    if (hand.length === 0) {
        container.innerHTML = '<p style="opacity: 0.5; text-align: center; padding: 20px;">No spell cards in hand</p>';
        return;
    }

    container.innerHTML = hand.map((spellId) => {
        const def = defs[spellId] || {};
        const name = _escapeHtmlSafe(def.name || spellId);
        const nameEn = _escapeHtmlSafe(def.nameEn || '');
        const desc = _escapeHtmlSafe(def.descriptionEn || def.description || '');
        const clickAttr = interactive ? `onclick="selectSpellToCast('${spellId}')"` : '';
        return `
            <div class="spell-phase-card ${interactive ? 'interactive' : 'disabled'}" ${clickAttr}>
                <div class="spell-phase-card-name">${name}</div>
                ${nameEn ? `<div class="spell-phase-card-type">${nameEn}</div>` : ''}
                <div class="spell-phase-card-type">${def.type || ''} &bull; ${def.rarity || ''}</div>
                <div class="spell-phase-card-desc">${desc}</div>
            </div>
        `;
    }).join('');
}

/** Select and cast a spell during the spell phase */
async function selectSpellToCast(spellId) {
    const defs = gameData?.spellDefinitions || {};
    const def = defs[spellId];
    if (!def) { showStatus('Spell not found', 'error'); return; }

    // Confirmation
    const confirmed = await showSpellConfirmation(def);
    if (!confirmed) return;

    // Target selection if needed
    let targetData = {};
    if (requiresTarget(def)) {
        targetData = await getSpellTarget(def);
        if (!targetData) return; // User cancelled
    }

    await castSpellViaFirestore(spellId, targetData);
}

/** Cast a spell by writing directly to Firestore (same pattern as lobbyReady) */
async function castSpellViaFirestore(spellId, targetData) {
    const pile = gameData?.spellPiles?.[String(currentTeamId)];
    if (!pile) { showStatus('No spell pile found', 'error'); return; }

    const handIndex = pile.hand.indexOf(spellId);
    if (handIndex === -1) { showStatus('Card not in hand', 'error'); return; }

    const defs = gameData?.spellDefinitions || {};
    const def = defs[spellId] || {};

    // Build updated hand and used pile
    const newHand = [...pile.hand];
    newHand.splice(handIndex, 1);
    const newUsed = [...(pile.usedPile || []), spellId];

    // Build spell history entry
    const historyEntry = {
        timestamp: new Date().toISOString(),
        spellId,
        spellName: def.name || spellId,
        teamId: currentTeamId,
        teamName: teamData?.name || 'Team ' + currentTeamId,
        targetData: targetData,
        roundNumber: gameData?.currentPhase?.roundNumber || 0,
        result: { success: true }
    };

    // Build active effect if applicable
    const effectEntry = _buildActiveEffect(spellId, def, targetData);

    try {
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentTournamentId);
        const update = {
            [`spellPiles.${currentTeamId}.hand`]: newHand,
            [`spellPiles.${currentTeamId}.usedPile`]: newUsed,
            [`spellPhase.teamsCompleted`]: firebase.firestore.FieldValue.arrayUnion(currentTeamId),
            spellHistory: firebase.firestore.FieldValue.arrayUnion(historyEntry)
        };

        if (effectEntry) {
            update.activeEffects = firebase.firestore.FieldValue.arrayUnion(effectEntry);
        }

        await tournamentRef.update(update);
        showStatus(`Cast ${def.name || spellId}!`, 'success');
    } catch (error) {
        console.error('[Team Controls] Error casting spell:', error);
        showStatus('Error casting spell: ' + error.message, 'error');
    }
}

/** End spell turn without casting (pass) */
async function endSpellTurn() {
    try {
        const tournamentRef = window.firebaseDB.collection('tournaments').doc(currentTournamentId);
        await tournamentRef.update({
            [`spellPhase.teamsCompleted`]: firebase.firestore.FieldValue.arrayUnion(currentTeamId)
        });
        showStatus('Turn passed.', 'info');
    } catch (error) {
        console.error('[Team Controls] Error ending spell turn:', error);
        showStatus('Error: ' + error.message, 'error');
    }
}

/** Build an active effect entry for Type B spells */
function _buildActiveEffect(spellId, def, targetData) {
    const effectType = def.effect?.type;
    if (!effectType) return null;

    // Only create visible effects for condition/buff types
    const conditionTypes = ['ban', 'silence', 'shield', 'multiplier', 'streak_bonus',
        'permanent_buff', 'modifier', 'counter'];
    if (!conditionTypes.includes(effectType)) return null;

    const currentRound = gameData?.currentPhase?.roundNumber || 0;
    const casterName = teamData?.name || 'Team ' + currentTeamId;
    let displayText = `${casterName} cast ${def.nameEn || def.name}`;
    let icon = '\u{1F52E}'; // 🔮

    if (effectType === 'ban' && targetData?.bannedElement) {
        const tTeam = gameData?.teams?.find(t => String(t.id) === String(targetData.targetTeamId));
        displayText = `${tTeam?.name || 'Team'} cannot use "${targetData.bannedElement}" next match`;
        icon = '\u{1F6AB}'; // 🚫
    } else if (effectType === 'silence' && targetData?.targetPlayerName) {
        displayText = `${targetData.targetPlayerName} cannot speak or use mic next match`;
        icon = '\u{1F507}'; // 🔇
    } else if (effectType === 'shield') {
        displayText = `${casterName}'s tiles are protected until next round`;
        icon = '\u{1F6E1}'; // 🛡️
    } else if (effectType === 'multiplier') {
        displayText = `${casterName}: 2x points & tiles if top 2 finish`;
        icon = '\u2728'; // ✨
    } else if (effectType === 'permanent_buff') {
        displayText = `${casterName}: each heart capture = +1 bonus point`;
        icon = '\u{1F48E}'; // 💎
    } else if (effectType === 'modifier') {
        displayText = `${casterName}: next room hex draw = double cards`;
        icon = '\u{1F3B2}'; // 🎲
    } else if (effectType === 'counter') {
        displayText = `${casterName} can block an opponent's spell draw`;
        icon = '\u{1F6E1}'; // 🛡️
    }

    const expiresAfterRound = (effectType === 'permanent_buff' || effectType === 'counter' || effectType === 'streak_bonus')
        ? null : currentRound + 1;

    return {
        id: `eff_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        spellId: spellId,
        spellName: def.name || spellId,
        spellNameEn: def.nameEn || '',
        category: ['ban', 'silence'].includes(effectType) ? 'condition' : 'buff',
        castByTeamId: currentTeamId,
        castInRound: currentRound,
        target: targetData || {},
        displayText: displayText,
        icon: icon,
        expiresAfterRound: expiresAfterRound,
        isExpired: false
    };
}

/** Render active conditions for this team */
function renderActiveConditions() {
    const section = document.getElementById('activeConditionsSection');
    const list = document.getElementById('activeConditionsList');
    if (!section || !list) return;

    const effects = (gameData?.activeEffects || []).filter(e => !e.isExpired);
    const relevant = effects.filter(eff =>
        eff.castByTeamId === currentTeamId ||
        String(eff.target?.teamId) === String(currentTeamId)
    );

    if (relevant.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    list.innerHTML = relevant.map(eff => {
        const isOnUs = String(eff.target?.teamId) === String(currentTeamId) && eff.castByTeamId !== currentTeamId;
        const borderColor = isOnUs ? '#ef4444' : '#a855f7';
        const text = _escapeHtmlSafe(eff.displayText || '');
        const name = _escapeHtmlSafe(eff.spellName || '');
        return `
            <div style="padding: 8px; margin: 4px 0; border-left: 3px solid ${borderColor};
                        background: rgba(168,85,247,0.05); border-radius: 4px; font-size: 0.85rem;">
                <span>${eff.icon || '\u{1F52E}'}</span>
                <strong>${name}</strong>: ${text}
                ${eff.expiresAfterRound != null ? `<span style="color: #9aa1ad;"> (until R${eff.expiresAfterRound})</span>` : ''}
            </div>
        `;
    }).join('');
}

/** Check if spell requires target selection */
function requiresTarget(spell) {
    const targetTypes = ['opponent-card', 'opponent-team', 'opponent-player', 'board', 'adjacent-enemies'];
    return targetTypes.includes(spell.targetType);
}

/** Show spell confirmation dialog */
function showSpellConfirmation(spell) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';
        const name = _escapeHtmlSafe(spell.name || '');
        const desc = _escapeHtmlSafe(spell.descriptionEn || spell.description || '');
        modal.innerHTML = `
            <div style="background: var(--bg-panel, rgba(20, 22, 30, 0.95)); padding: 25px; border-radius: 12px; max-width: 450px; width: 90%; color: white; border: 2px solid rgba(168,85,247,0.4);">
                <h3 style="color: #a855f7; margin-top: 0;">Cast Spell</h3>
                <h4 style="color: white;">${name}</h4>
                <p style="color: #9aa1ad; font-size: 0.85rem;">${spell.type || ''} &bull; ${spell.rarity || ''}</p>
                <p style="line-height: 1.6; color: #cbd5e1;">${desc}</p>
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="confirmSpellBtn" class="btn primary" style="flex: 1;">Cast Spell</button>
                    <button id="cancelSpellBtn" class="btn secondary" style="flex: 1;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#confirmSpellBtn').onclick = () => { modal.remove(); resolve(true); };
        modal.querySelector('#cancelSpellBtn').onclick = () => { modal.remove(); resolve(false); };
        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); resolve(false); } });
    });
}

/** Get spell target selection (team or player picker) */
async function getSpellTarget(spell) {
    const targetType = spell.targetType;

    if (targetType === 'opponent-team' || targetType === 'opponent-card') {
        return _pickTargetTeam(spell);
    }
    if (targetType === 'opponent-player') {
        return _pickTargetPlayer(spell);
    }
    // Other types: return empty (board, self, adjacent handled automatically)
    return {};
}

/** Show modal to pick a target team */
function _pickTargetTeam(spell) {
    return new Promise((resolve) => {
        const teams = (gameData?.teams || []).filter(t => t.id !== currentTeamId);
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10001;';

        const needsBan = spell.effect?.type === 'ban';
        modal.innerHTML = `
            <div style="background: var(--bg-panel, rgba(20, 22, 30, 0.95)); padding: 25px; border-radius: 12px; max-width: 450px; width: 90%; color: white; border: 2px solid rgba(168,85,247,0.4);">
                <h3 style="color: #a855f7; margin-top: 0;">Select Target Team</h3>
                <div id="targetTeamList" style="display: flex; flex-direction: column; gap: 8px; margin: 15px 0;">
                    ${teams.map(t => `
                        <button class="btn secondary target-team-btn" data-team-id="${t.id}"
                                style="text-align: left; border-left: 4px solid ${t.color || '#666'};">
                            ${_escapeHtmlSafe(t.name)}
                        </button>
                    `).join('')}
                </div>
                ${needsBan ? `
                    <div id="banInputSection" style="display: none; margin-top: 10px;">
                        <label style="color: #9aa1ad; font-size: 0.85rem;">What is banned?</label>
                        <input type="text" id="bannedElementInput" placeholder="e.g. AWP, Operator, Sage..."
                               style="width: 100%; padding: 10px; margin-top: 5px; background: rgba(11,13,16,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: white;">
                        <button class="btn primary" id="confirmBanBtn" style="width: 100%; margin-top: 10px;">Confirm Ban</button>
                    </div>
                ` : ''}
                <button class="btn secondary" onclick="this.closest('div[style]').parentElement.remove()" style="width: 100%; margin-top: 10px;">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        let selectedTeamId = null;
        modal.querySelectorAll('.target-team-btn').forEach(btn => {
            btn.onclick = () => {
                selectedTeamId = parseInt(btn.dataset.teamId);
                if (needsBan) {
                    document.getElementById('banInputSection').style.display = '';
                    modal.querySelectorAll('.target-team-btn').forEach(b => b.style.opacity = '0.5');
                    btn.style.opacity = '1';
                } else {
                    modal.remove();
                    resolve({ targetTeamId: selectedTeamId });
                }
            };
        });

        if (needsBan) {
            modal.querySelector('#confirmBanBtn')?.addEventListener('click', () => {
                const banned = document.getElementById('bannedElementInput')?.value?.trim();
                if (!banned) { showStatus('Enter what is banned', 'error'); return; }
                modal.remove();
                resolve({ targetTeamId: selectedTeamId, bannedElement: banned });
            });
        }

        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); resolve(null); } });
    });
}

/** Show modal to pick a target player */
function _pickTargetPlayer(spell) {
    return new Promise((resolve) => {
        const teams = (gameData?.teams || []).filter(t => t.id !== currentTeamId);
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10001;';

        let playersHtml = '';
        teams.forEach(t => {
            const players = t.players || [];
            players.forEach(p => {
                playersHtml += `
                    <button class="btn secondary target-player-btn" data-team-id="${t.id}" data-player-name="${_escapeHtmlSafe(p.name || p.displayName || '')}" data-player-uid="${p.uid || ''}"
                            style="text-align: left; border-left: 4px solid ${t.color || '#666'};">
                        ${_escapeHtmlSafe(p.name || p.displayName || 'Player')} <span style="color:#9aa1ad;">(${_escapeHtmlSafe(t.name)})</span>
                    </button>
                `;
            });
        });

        modal.innerHTML = `
            <div style="background: var(--bg-panel, rgba(20, 22, 30, 0.95)); padding: 25px; border-radius: 12px; max-width: 450px; width: 90%; color: white; border: 2px solid rgba(168,85,247,0.4);">
                <h3 style="color: #a855f7; margin-top: 0;">Select Target Player</h3>
                <div style="display: flex; flex-direction: column; gap: 8px; margin: 15px 0; max-height: 300px; overflow-y: auto;">
                    ${playersHtml}
                </div>
                <button class="btn secondary" onclick="this.closest('div[style]').parentElement.remove()" style="width: 100%; margin-top: 10px;">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.target-player-btn').forEach(btn => {
            btn.onclick = () => {
                modal.remove();
                resolve({
                    targetTeamId: parseInt(btn.dataset.teamId),
                    targetPlayerName: btn.dataset.playerName,
                    targetPlayerId: btn.dataset.playerUid
                });
            };
        });

        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); resolve(null); } });
    });
}

/** Safe HTML escape helper */
function _escapeHtmlSafe(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Render game board with all effects enabled by default
 */
let boardModule = null;

function renderBoard() {
    const hexBoardContainer = document.getElementById('hexBoard');

    if (!boardRenderer) {
        boardModule = new BoardModule();
        boardRenderer = new BoardRenderer(hexBoardContainer, boardModule, {
            responsive: true,
            showHeartImages: true
        });
        // Enable all effects by default (no toggle panel)
        document.body.classList.add('effect-hex-images', 'effect-heart-glow', 'effect-pulse-hearts', 'effect-rooms');
    }

    boardRenderer.render(gameData);
    applyTeamColorsToBoard();
    applyHexImages(true);
}

/**
 * Apply team-N CSS classes to hexes for color overlays
 */
function applyTeamColorsToBoard() {
    document.querySelectorAll('.board-hex').forEach(hex => {
        hex.classList.remove('team-1', 'team-2', 'team-3', 'team-4', 'team-5', 'team-6');
        const coord = hex.dataset.coord;
        if (gameData?.board && gameData.board[coord]) {
            hex.classList.add(`team-${gameData.board[coord]}`);
        }
    });
}

/**
 * Apply hex terrain images dynamically via CSS
 */
function applyHexImages(enabled) {
    let styleEl = document.getElementById('hex-images-dynamic-css');

    if (!enabled) {
        if (styleEl) styleEl.remove();
        return;
    }

    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'hex-images-dynamic-css';
        document.head.appendChild(styleEl);
    }

    const hexCoords = boardModule.generateHexCoordinates();
    let css = '';

    hexCoords.forEach(([q, r]) => {
        const coord = `q${q}r${r}`;
        css += `body.effect-hex-images .board-hex[data-coord="${coord}"]::before {
            background-image: url('${(window.BOARDGAME_BASE || '.')}/shared/images/hexes/coords/${coord}.png');
        }\n`;
    });

    styleEl.textContent = css;
}

/**
 * Render current match information
 */
function renderCurrentMatch() {
    const container = document.getElementById('currentMatchDisplay');
    const matchesSource = gameData.gameQueue || gameData.selectedGames || [];

    if (matchesSource.length === 0) {
        container.innerHTML = '<div class="empty-state">No matches scheduled</div>';
        return;
    }

    // Find current match
    let currentMatch = null;
    if (gameData.currentTurn) {
        currentMatch = matchesSource.find(
            g => g.game === gameData.currentTurn.game || g.gameNumber === gameData.currentTurn.game
        );
    }
    if (!currentMatch) {
        currentMatch = matchesSource.find(m =>
            m.status === 'pending' || m.status === 'waiting' || m.status === 'upcoming' || m.status === 'scheduled' || !m.status
        );
    }

    if (!currentMatch) {
        container.innerHTML = '<div class="empty-state">Waiting for next game...</div>';
        return;
    }

    const isActiveMatch = gameData.currentTurn && (currentMatch.game === gameData.currentTurn.game || currentMatch.gameNumber === gameData.currentTurn.game);
    const gameName = getGameDisplayName(currentMatch.gameId || currentMatch.gameType || currentMatch.game);

    container.innerHTML = renderMatchCard(currentMatch, gameName, isActiveMatch ? 'live' : 'next');

    window.currentDisplayedMatchId = currentMatch.game || currentMatch.gameNumber;
}

/**
 * Render a match card in view.html style
 */
function renderMatchCard(match, gameName, type) {
    const sidesData = match.teams || match.sides || [];
    const statusLabel = type === 'live' ? 'LIVE' : type === 'next' ? 'NEXT' : '';
    const cardClass = type === 'live' ? 'mc-live' : type === 'next' ? 'mc-next' : 'mc-queued';

    let sidesHTML = '';
    if (sidesData.length >= 2) {
        const sideCards = sidesData.map((side) => {
            const players = getMatchSidePlayers(side);
            const isOurSide = players.some(p =>
                teamData.players?.some(tp => tp.id === p.id || tp.uid === p.uid || tp.name === p.name)
            );
            const sideColor = players.length > 0 ? players[0].color : '#8a8fa0';
            const playersHTML = players.map(p =>
                `<span class="mc-player" style="color: ${p.color};">${p.name}</span>`
            ).join('');

            return `<div class="mc-side ${isOurSide ? 'mc-you' : ''}" style="--sc: ${sideColor};">
                ${playersHTML}
            </div>`;
        });

        sidesHTML = sideCards.join('<div class="mc-vs">VS</div>');
    }

    return `
        <div class="mc ${cardClass}">
            <div class="mc-top">
                <span class="mc-game">${gameName}</span>
                ${statusLabel ? `<span class="mc-badge mc-badge-${type}">${statusLabel}</span>` : ''}
            </div>
            <div class="mc-matchup">${sidesHTML}</div>
        </div>
    `;
}

/**
 * Resolve match side to player objects with name and color.
 * Handles both formats:
 *   - New: { id, playerIds: [...] }
 *   - Legacy: { players: [{ name, uid, ... }] }
 */
function getMatchSidePlayers(side) {
    if (!side) return [];

    // New format: playerIds array — resolve via PlayerUtils or gameData
    if (side.playerIds && Array.isArray(side.playerIds)) {
        return side.playerIds.map(playerId => {
            const name = resolveCurrentPlayerName(playerId, null, 'Player');
            // Determine team from registry or slot notation
            let teamId = null;
            if (gameData.players?.[playerId]?.teamId) {
                teamId = gameData.players[playerId].teamId;
            } else if (window.PlayerUtils) {
                const info = window.PlayerUtils.getPlayerDisplayInfo(gameData, playerId);
                teamId = info.teamId;
            } else {
                // Optimizer slot notation fallback
                const slotMatch = typeof playerId === 'string' && playerId.match(/^(\d+)[a-z]$/);
                if (slotMatch) teamId = parseInt(slotMatch[1]);
            }
            const teamColor = teamId ? getTeamColorById(teamId) : '#8a8fa0';
            return { id: playerId, name, color: teamColor, teamId };
        });
    }

    // Legacy format: players array with embedded data
    if (side.players && Array.isArray(side.players)) {
        return side.players.map(p => {
            const playerId = p.id || p.uid;
            const teamId = p.originalTeamId;

            // Resolve current name from live data (embedded name may be stale after player linking)
            let name = resolveCurrentPlayerName(playerId, teamId, p.name);

            const color = p.originalTeamColor ? getHexColor(p.originalTeamColor) :
                          teamId ? getTeamColorById(teamId) : '#8a8fa0';
            return { id: playerId, name, color, teamId };
        });
    }

    return [];
}

/**
 * Get team color by team ID from gameData
 */
function getTeamColorById(teamId) {
    if (!teamId || !gameData?.teams) return '#8a8fa0';
    const team = gameData.teams.find(t => String(t.id) === String(teamId));
    return team?.color ? getHexColor(team.color) : '#8a8fa0';
}

/**
 * Resolve current player name from live data.
 * Queue entries embed player names at creation time, but those become stale
 * when players are linked/replaced. This resolves the current name by checking:
 * 1. PlayerUtils registry (p_xxx IDs)
 * 2. gameData.players registry directly
 * 3. Team players array by ID match
 * 4. Optimizer slot notation (e.g. "1a" = team 1, player index 0)
 */
function resolveCurrentPlayerName(playerId, teamId, fallbackName) {
    const name = fallbackName || 'Player';
    if (!playerId) return name;

    // 1. Try PlayerUtils (handles p_xxx registry IDs)
    if (window.PlayerUtils) {
        const info = window.PlayerUtils.getPlayerDisplayInfo(gameData, playerId);
        if (info.name && info.name !== 'Unknown') return info.name;
    }

    // 2. Direct registry lookup
    if (gameData.players && gameData.players[playerId]?.name) {
        return gameData.players[playerId].name;
    }

    // 3. Search team players by ID — resolve from registry
    for (const team of (gameData.teams || [])) {
        const player = (team.players || []).find(p => p.id === playerId);
        if (player) return _resolvePlayerName(player);
    }

    // 4. Optimizer slot notation (e.g. "1a" → team 1, index 0; "2b" → team 2, index 1)
    const slotMatch = typeof playerId === 'string' && playerId.match(/^(\d+)([a-z])$/);
    if (slotMatch) {
        const slotTeamId = parseInt(slotMatch[1]);
        const slotIdx = slotMatch[2].charCodeAt(0) - 97; // 'a'=0, 'b'=1
        const team = (gameData.teams || []).find(t => String(t.id) === String(slotTeamId));
        if (team?.players?.[slotIdx]) {
            // Resolve from registry first (linked name), fall back to legacy array name
            const p = team.players[slotIdx];
            return _resolvePlayerName(p);
        }
    }

    // 5. If teamId provided, try finding by array position in that team
    if (teamId) {
        const team = (gameData.teams || []).find(t => String(t.id) === String(teamId));
        if (team?.players) {
            // Find the player by matching name (last resort for pre-migration data)
            const tp = team.players.find(p => p.name === name);
            if (tp?.name) return tp.name;
        }
    }

    return name;
}

/**
 * Get display name for a game
 */
function getGameDisplayName(gameId) {
    if (!gameId) return 'Match';
    if (gameData.gameDefinitions && gameData.gameDefinitions[gameId]) {
        return gameData.gameDefinitions[gameId].name || gameId;
    }
    if (typeof GAMES_CONFIG !== 'undefined' && GAMES_CONFIG.games) {
        const game = GAMES_CONFIG.games.find(g => g.id === gameId);
        if (game) return game.name;
    }
    return gameId;
}

/**
 * Render upcoming matches
 */
function renderUpcomingMatches() {
    const container = document.getElementById('upcomingMatchesList');
    const matchesData = gameData.gameQueue || gameData.selectedGames || gameData.upcomingMatches || gameData.matches || [];

    if (matchesData.length === 0) {
        container.innerHTML = '<p class="empty-state-inline">No upcoming matches scheduled</p>';
        return;
    }

    // Filter: not completed, not current
    const displayMatches = matchesData.filter(match => {
        if (match.status === 'completed') return false;
        const matchId = match.game || match.gameNumber;
        if (window.currentDisplayedMatchId && matchId === window.currentDisplayedMatchId) return false;
        if (gameData.currentTurn && (match.game === gameData.currentTurn.game || match.gameNumber === gameData.currentTurn.game)) return false;
        return true;
    });

    if (displayMatches.length === 0) {
        container.innerHTML = '<p class="empty-state-inline">No upcoming matches scheduled</p>';
        return;
    }

    container.innerHTML = displayMatches.slice(0, 5).map(match => {
        const gameName = getGameDisplayName(match.gameId || match.gameType || match.game);
        return renderMatchCard(match, gameName, 'queued');
    }).join('');
}

/**
 * Get hex color from team color property
 * Converts legacy color names to hex codes matching brand-theme.css
 */
function getHexColor(color) {
    // If already a hex code, return it
    if (color && color.startsWith('#')) {
        return color;
    }

    // Map legacy color names to brand theme hex codes
    const colorMap = {
        'red': '#de392c',      // Team 1 - Red
        'blue': '#2278a3',     // Team 2 - Blue
        'green': '#2e9158',    // Team 3 - Green
        'orange': '#f7ba32',   // Team 4 - Orange
        'yellow': '#f7ba32',   // Alias for orange
        'amber': '#f7ba32',    // Alias for orange
        'purple': '#a855f7',   // Team 5 - Purple
        'pink': '#ec4899',     // Legacy support
        'teal': '#14b8a6',     // Legacy support
        'cyan': '#06b6d4',     // Legacy support
        'lime': '#84cc16',     // Legacy support
        'indigo': '#6366f1'    // Legacy support
    };

    return colorMap[color?.toLowerCase()] || '#2278a3'; // Default to team blue
}

/**
 * Render recent events
 */
function renderRecentEvents() {
    const container = document.getElementById('recentEventsList');
    const events = gameData.events || gameData.gameHistory || [];

    if (events.length === 0) {
        container.innerHTML = '<p class="empty-state-inline">No recent events</p>';
        return;
    }

    const recentEvents = events.slice(-10).reverse();

    container.innerHTML = recentEvents.map(event => {
        // Game history entries → result card style
        if (event.gameNumber || event.game) {
            const gameName = getGameDisplayName(event.gameId || event.gameType || event.game);
            const winners = Array.isArray(event.winner) ? event.winner : [event.winner];
            const losers = Array.isArray(event.loser) ? event.loser : [event.loser];

            const winnersHTML = winners.filter(Boolean).map(w =>
                `<span class="rc-player rc-win">${w}</span>`
            ).join('');
            const losersHTML = losers.filter(Boolean).map(l =>
                `<span class="rc-player rc-loss">${l}</span>`
            ).join('');

            return `
                <div class="rc">
                    <div class="rc-top">
                        <span class="rc-game">${gameName}</span>
                    </div>
                    <div class="rc-matchup">
                        <div class="rc-side">${winnersHTML}<span class="rc-badge">WIN</span></div>
                        <div class="rc-vs">vs</div>
                        <div class="rc-side rc-loser">${losersHTML}</div>
                    </div>
                </div>
            `;
        }

        // Generic events
        const message = event.text || event.message || event.description || '';
        return `<div class="rc rc-event"><div class="rc-msg">${message}</div></div>`;
    }).join('');
}

/**
 * Check if voting is needed for any completed match
 */
function checkForVoting() {
    // Use gameQueue (full version) or selectedGames (legacy) as match source
    const matchSource = gameData.gameQueue || gameData.selectedGames || [];
    if (matchSource.length === 0) return;

    // Find completed matches that need voting
    const matchNeedingVote = matchSource.find(match => {
        // Must be completed
        if (match.status !== 'completed') return false;

        // Must involve this player (check teams array for full version, sides for legacy)
        const teams = match.teams || match.sides || [];
        const involvesPlayer = teams.some(side => {
            const players = side.players || side.playerIds || [];
            return players.some(p => {
                const playerId = typeof p === 'string' ? p : (p.id || p.uid);
                const playerName = typeof p === 'string' ? '' : (p.name || '');
                return (currentUser?.uid && playerId === currentUser.uid) ||
                       (teamData?.players?.some(tp => tp.uid === playerId || tp.name === playerName));
            });
        });
        if (!involvesPlayer) return false;

        // Check if user already voted
        const votes = match.votes || [];
        const userVoted = votes.some(v => v.uid === currentUser?.uid);
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
        const tournamentRef = db.collection('tournaments').doc(currentTournamentId);

        // Use gameQueue (full version) or selectedGames (legacy)
        const matchSource = gameData.gameQueue || gameData.selectedGames || [];
        const queueField = gameData.gameQueue ? 'gameQueue' : 'selectedGames';

        // Find the match index
        const matchIndex = matchSource.findIndex(m => {
            if (m.status !== 'completed' || m.adminConfirmed) return false;
            const teams = m.teams || m.sides || [];
            return teams.some(side => {
                const players = side.players || side.playerIds || [];
                return players.some(p => {
                    const pid = typeof p === 'string' ? p : (p.id || p.uid);
                    const pname = typeof p === 'string' ? '' : (p.name || '');
                    return (currentUser?.uid && pid === currentUser.uid) ||
                           teamData?.players?.some(tp => tp.uid === pid || tp.name === pname);
                });
            });
        });

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
        const match = matchSource[matchIndex];
        const votes = match.votes || [];
        votes.push(vote);

        await tournamentRef.update({
            [`${queueField}.${matchIndex}.votes`]: votes
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
    const matchSource = gameData.gameQueue || gameData.selectedGames || [];
    const queueField = gameData.gameQueue ? 'gameQueue' : 'selectedGames';
    const match = matchSource[matchIndex];
    if (!match) return;

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
            const tournamentRef = db.collection('tournaments').doc(currentTournamentId);

            await tournamentRef.update({
                [`${queueField}.${matchIndex}.voteConsensus`]: {
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
        const tournamentRef = db.collection('tournaments').doc(currentTournamentId);

        const team = gameData.teams.find(t => String(t.id) === String(currentTeamId));
        if (!team) {
            showStatus('Team not found', 'error');
            return;
        }

        const oldName = team.name;

        // Name history
        if (!team.nameHistory) team.nameHistory = [];
        team.nameHistory.push({
            oldName,
            newName,
            changedAt: new Date().toISOString(),
            changedBy: firebase.auth().currentUser?.uid || 'unknown'
        });

        team.name = newName;

        await tournamentRef.update({
            teams: gameData.teams,
            lastModified: new Date().toISOString()
        });

        showStatus('Team name updated successfully!', 'success');
        closeEditTeamNameModal();

        // Also update all user documents with new team name
        if (teamData.players) {
            const batch = db.batch();
            let hasBatchOps = false;
            teamData.players.forEach(player => {
                if (player.uid) {
                    batch.update(db.collection('users').doc(player.uid), {
                        assignedTeamName: newName
                    });
                    hasBatchOps = true;
                }
            });
            if (hasBatchOps) await batch.commit();
        }

    } catch (error) {
        console.error('[Team Controls] Error updating team name:', error);
        showStatus('Error updating team name: ' + error.message, 'error');
    }
}

/**
 * Show status message
 */
// ==================== PHASE OVERLAYS (Week 6) ====================

/**
 * Show/hide phase-specific overlays based on current tournament phase.
 */
function renderPhaseOverlays() {
    const currentPhase = gameData.currentPhase?.name;
    const preGameOverlay = document.getElementById('preGameInstructionsOverlay');
    const lobbyOverlay = document.getElementById('lobbyReadyOverlay');
    const spellOverlay = document.getElementById('spellPhaseOverlay');

    // Hide all by default
    if (preGameOverlay) preGameOverlay.style.display = 'none';
    if (lobbyOverlay) lobbyOverlay.style.display = 'none';
    if (spellOverlay) spellOverlay.style.display = 'none';

    if (currentPhase === 'match_1_setup' || currentPhase === 'match_2_setup') {
        renderPreGameInstructions();
        if (preGameOverlay) preGameOverlay.style.display = 'flex';
    } else if (currentPhase === 'match_1_lobby' || currentPhase === 'match_2_lobby') {
        renderLobbyReady();
        if (lobbyOverlay) lobbyOverlay.style.display = 'flex';
    } else if (currentPhase && currentPhase.startsWith('spell_window')) {
        renderSpellPhaseOverlay();
    }
}

/**
 * Render match assignment cards for the pre-game instructions overlay.
 */
function renderPreGameInstructions() {
    const container = document.getElementById('matchAssignmentCards');
    if (!container) return;
    renderMatchCardsInto(container);
}

/**
 * Render match assignment cards into a given container.
 * Shared by both pre-game instructions and lobby ready overlays.
 */
function renderMatchCardsInto(container) {
    const queue = gameData.gameQueue || [];

    // Find matches involving this team that are pending/ongoing
    const teamMatches = queue.filter(match => {
        if (match.isBreak || match.status === 'completed') return false;
        return (match.sides || []).some(side =>
            (side.players || []).some(p =>
                teamData.players?.some(tp =>
                    tp.uid === p.uid || tp.name === p.name || tp.email === p.email
                )
            )
        );
    });

    if (teamMatches.length === 0) {
        container.innerHTML = '<div class="empty-state">No matches assigned this round. Relax!</div>';
        return;
    }

    container.innerHTML = teamMatches.map(match => {
        const gameId = match.gameType || match.game || '';
        const gameName = resolveGameName(gameId);
        const gameImage = resolveGameImage(gameId);

        // Find opponent side
        const opponentSide = (match.sides || []).find(side =>
            !(side.players || []).some(p =>
                teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name)
            )
        );
        const opponentNames = opponentSide
            ? (opponentSide.players || []).map(p => resolveCurrentPlayerName(p.id || p.uid, p.teamId, p.name)).join(', ')
            : 'TBD';

        // Find opponent team
        const opponentTeamId = opponentSide?.players?.[0]?.teamId;
        const opponentTeam = opponentTeamId != null
            ? gameData.teams?.find(t => String(t.id) === String(opponentTeamId))
            : null;
        const opponentTeamName = opponentTeam?.name || 'Opponent';
        const opponentColor = getHexColor(opponentTeam?.color);

        return `
            <div class="match-assignment-card">
                ${gameImage ? `<img src="${gameImage}" class="game-image" alt="${gameName}" onerror="this.style.display='none'">` : ''}
                <div class="game-name">${gameName}</div>
                <div class="opponent-info">
                    vs <span style="color: ${opponentColor}; font-weight: 600;">${opponentTeamName}</span>
                </div>
                <div class="opponent-players">${opponentNames}</div>
            </div>
        `;
    }).join('');
}

/**
 * Render the lobby ready overlay with two-button readiness, Discord info, and lobby creator role.
 */
function renderLobbyReady() {
    const cardsContainer = document.getElementById('matchAssignmentCardsLobby');
    if (cardsContainer) {
        renderMatchCardsWithDiscord(cardsContainer);
    }

    // Update two-button ready state
    const lobbyReady = gameData.lobbyReady || {};
    const myStatus = lobbyReady[currentUser.uid] || {};
    const gameLobbyReady = myStatus.gameLobby === true || myStatus.ready === true;
    const discordReady = myStatus.discord === true || myStatus.ready === true;

    const gameLobbyBtn = document.getElementById('readyGameLobbyBtn');
    const discordBtn = document.getElementById('readyDiscordBtn');

    if (gameLobbyBtn) {
        gameLobbyBtn.textContent = gameLobbyReady ? '\uD83C\uDFAE Game Lobby \u2713' : '\uD83C\uDFAE Game Lobby';
        gameLobbyBtn.classList.toggle('is-ready', gameLobbyReady);
        gameLobbyBtn.disabled = gameLobbyReady;
    }

    if (discordBtn) {
        discordBtn.textContent = discordReady ? '\uD83C\uDFA7 Discord \u2713' : '\uD83C\uDFA7 Discord';
        discordBtn.classList.toggle('is-ready', discordReady);
        discordBtn.disabled = discordReady;
    }

    renderLobbyCreatorRole();
    renderReadinessStatus();
}

/**
 * Render match cards enriched with Discord channel and lobby creator info.
 */
function renderMatchCardsWithDiscord(container) {
    const queue = gameData.gameQueue || [];

    const teamMatches = queue.filter(match => {
        if (match.isBreak || match.status === 'completed') return false;
        const sides = match.teams || match.sides || [];
        return sides.some(side =>
            (side.players || []).some(p =>
                teamData.players?.some(tp =>
                    tp.uid === p.uid || tp.name === p.name || tp.email === p.email
                )
            )
        );
    });

    if (teamMatches.length === 0) {
        container.innerHTML = '<div class="empty-state">No matches assigned this round. Relax!</div>';
        return;
    }

    container.innerHTML = teamMatches.map(match => {
        const gameId = match.gameType || match.game || '';
        const gameName = resolveGameName(gameId);
        const gameImage = resolveGameImage(gameId);
        const matchTeams = match.teams || match.sides || [];

        // Find which side we're on
        const mySide = matchTeams.find(side =>
            (side.players || []).some(p =>
                teamData.players?.some(tp => tp.uid === p.uid || tp.name === p.name)
            )
        );
        const mySideId = mySide?.id || 'TEAM_A';

        // Discord channel for our side
        const discordChannel = match.discordChannels?.[mySideId];
        const discordHTML = discordChannel
            ? `<div class="discord-channel-badge">\uD83C\uDFA7 Discord Channel #${discordChannel}</div>`
            : '';

        // Lobby creator for our side
        const lobbyCreator = match.lobbyCreators?.[mySideId];
        const isCreator = lobbyCreator?.uid === currentUser.uid;
        const creatorHTML = lobbyCreator
            ? `<div class="lobby-creator-info">${isCreator
                ? '<strong>\u2B50 YOU CREATE THE GAME LOBBY</strong>'
                : `Join <strong>${lobbyCreator.name || 'Player'}</strong>'s lobby`
            }</div>`
            : '';

        // Opponent info
        const opponentSide = matchTeams.find(side => side !== mySide);
        const opponentNames = opponentSide
            ? (opponentSide.players || []).map(p => resolveCurrentPlayerName(p.id || p.uid, p.teamId, p.name)).join(', ')
            : 'TBD';
        const opponentTeamId = opponentSide?.players?.[0]?.teamId;
        const opponentTeam = opponentTeamId != null
            ? gameData.teams?.find(t => String(t.id) === String(opponentTeamId))
            : null;
        const opponentTeamName = opponentTeam?.name || 'Opponent';
        const opponentColor = getHexColor(opponentTeam?.color);

        return `
            <div class="match-assignment-card">
                ${gameImage ? `<img src="${gameImage}" class="game-image" alt="${gameName}" onerror="this.style.display='none'">` : ''}
                <div class="game-name">${gameName}</div>
                <div class="opponent-info">
                    vs <span style="color: ${opponentColor}; font-weight: 600;">${opponentTeamName}</span>
                </div>
                <div class="opponent-players">${opponentNames}</div>
                ${discordHTML}
                ${creatorHTML}
            </div>
        `;
    }).join('');
}

/**
 * Show lobby creator role prominently if current user is the designated creator.
 */
function renderLobbyCreatorRole() {
    const roleContainer = document.getElementById('lobbyCreatorRole');
    if (!roleContainer) return;

    const queue = gameData.gameQueue || [];
    let isCreator = false;

    queue.forEach(match => {
        if (match.isBreak || match.status === 'completed') return;
        const lobbyCreators = match.lobbyCreators || {};
        Object.values(lobbyCreators).forEach(creator => {
            if (creator?.uid === currentUser.uid) isCreator = true;
        });
    });

    roleContainer.style.display = isCreator ? '' : 'none';
    if (isCreator) {
        roleContainer.innerHTML = '<span class="lobby-creator-banner">\u2B50 You are the lobby creator \u2014 create the game and invite your team!</span>';
    }
}

/**
 * Show per-team readiness (two-status) in the lobby overlay.
 */
function renderReadinessStatus() {
    const container = document.getElementById('readyStatus');
    if (!container) return;

    const lobbyReady = gameData.lobbyReady || {};
    const teams = gameData.teams || [];
    const queue = gameData.gameQueue || [];

    // Find team IDs with pending/ongoing matches
    const activeTeamIds = new Set();
    queue.forEach(match => {
        if (match.isBreak || match.status === 'completed') return;
        const sides = match.teams || match.sides || [];
        sides.forEach(side => {
            (side.players || []).forEach(p => {
                if (p.teamId !== undefined) activeTeamIds.add(String(p.teamId));
            });
        });
    });

    const teamsHTML = teams
        .filter(team => activeTeamIds.has(String(team.id)))
        .map(team => {
            const players = team.players || [];
            const teamColor = getHexColor(team.color);

            return `
                <div class="ready-team-group">
                    <div class="ready-team-name" style="color: ${teamColor};">
                        ${team.name || 'Team ' + team.id}
                    </div>
                    <div>
                        ${players.map(p => {
                            const r = lobbyReady[p.uid] || {};
                            const gl = r.gameLobby === true || r.ready === true;
                            const dc = r.discord === true || r.ready === true;
                            const isYou = p.uid === currentUser.uid;
                            return `<span class="ready-player ${gl && dc ? 'is-ready' : 'not-ready'}">
                                <span class="ready-icon ${gl ? 'on' : ''}">\uD83C\uDFAE</span>
                                <span class="ready-icon ${dc ? 'on' : ''}">\uD83C\uDFA7</span>
                                ${p.name || 'Player'}${isYou ? ' (you)' : ''}
                            </span>`;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');

    container.innerHTML = teamsHTML || '<p style="color: var(--text-muted);">No teams need to ready up.</p>';
}

/**
 * Set a specific readiness status for the current player.
 * @param {'gameLobby'|'discord'} statusType
 */
async function setReadyStatus(statusType) {
    if (!currentUser || !currentTournamentId) return;

    const lobbyReady = gameData.lobbyReady || {};
    const existing = lobbyReady[currentUser.uid] || {};

    // Already set this status
    if (existing[statusType] === true) return;

    try {
        const db = firebase.firestore();
        const tournamentRef = db.collection('tournaments').doc(currentTournamentId);
        const now = new Date().toISOString();

        await tournamentRef.update({
            [`lobbyReady.${currentUser.uid}.${statusType}`]: true,
            [`lobbyReady.${currentUser.uid}.${statusType}At`]: now,
            [`lobbyReady.${currentUser.uid}.teamId`]: currentTeamId,
            [`lobbyReady.${currentUser.uid}.name`]: currentUser.displayName || currentUser.email || 'Player'
        });

        console.log(`[Team Controls] Player marked ${statusType} ready`);
    } catch (error) {
        console.error(`[Team Controls] Error setting ${statusType} ready:`, error);
        showStatus(`Error confirming ${statusType}: ` + error.message, 'error');
    }
}

/** Legacy: mark both statuses ready at once */
async function toggleReady() {
    await setReadyStatus('gameLobby');
    await setReadyStatus('discord');
}

/**
 * Resolve a game name using the standard fallback chain.
 */
function resolveGameName(gameId) {
    if (gameData.gameDefinitions && gameData.gameDefinitions[gameId]) {
        return gameData.gameDefinitions[gameId].name;
    }
    if (typeof GAMES_CONFIG !== 'undefined' && GAMES_CONFIG.getGameName) {
        return GAMES_CONFIG.getGameName(gameId);
    }
    return gameId || 'Match';
}

/**
 * Resolve a game image URL using the standard fallback chain.
 */
function resolveGameImage(gameId) {
    if (gameData.gameDefinitions && gameData.gameDefinitions[gameId]?.image) {
        const img = gameData.gameDefinitions[gameId].image;
        if (img.startsWith('http')) return img;
        return (window.BOARDGAME_BASE || '..') + '/' + img;
    }
    if (typeof GAMES_CONFIG !== 'undefined' && GAMES_CONFIG.getGame) {
        const game = GAMES_CONFIG.getGame(gameId);
        if (game?.image) {
            return GAMES_CONFIG.resolveImagePath
                ? GAMES_CONFIG.resolveImagePath(game.image)
                : (window.BOARDGAME_BASE || '..') + '/' + game.image;
        }
    }
    return null;
}

// ==================== STATUS ====================

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
