/**
 * SPELLS GOD MODE MODULE
 * Handles spell management functions for god.html admin panel
 */

let allSpellDefinitions = [];
let spellManager = null;

/**
 * Initialize spell manager
 */
async function initializeSpellManager() {
    if (!spellManager) {
        spellManager = new SpellManager();
        await spellManager.loadSpellDefinitions();
        allSpellDefinitions = spellManager.spells;
    }
}

/**
 * Load all spell definitions from Firebase
 */
async function loadAllSpells() {
    try {
        showStatus('Loading spell definitions...', 'info');

        await initializeSpellManager();

        // Update stats
        document.getElementById('totalSpellsDef').textContent = allSpellDefinitions.length;
        updateSpellStats();

        // Populate spell library
        renderSpellsLibrary(allSpellDefinitions);

        // Populate spell selection dropdown
        populateSpellDropdown();

        // Populate team dropdown
        populateTeamDropdownForSpells();

        showStatus(`Loaded ${allSpellDefinitions.length} spell definitions`, 'success');
    } catch (error) {
        console.error('[Spells God] Error loading spells:', error);
        showStatus('Error loading spells: ' + error.message, 'error');
    }
}

/**
 * Update spell statistics
 */
function updateSpellStats() {
    if (!gameState || !gameState.teams) {
        document.getElementById('totalSpellsHeld').textContent = '0';
        document.getElementById('totalSpellsCast').textContent = '0';
        return;
    }

    // Count spells in team hands
    let totalHeld = 0;
    for (const team of gameState.teams) {
        const spells = team.spellCards || team.hand || [];
        totalHeld += spells.length;
    }
    document.getElementById('totalSpellsHeld').textContent = totalHeld;

    // Count spells cast
    const spellHistory = gameState.spellHistory || [];
    document.getElementById('totalSpellsCast').textContent = spellHistory.length;

    // Render spell history
    renderSpellHistory();
}

/**
 * Render spell library cards
 */
function renderSpellsLibrary(spells) {
    const container = document.getElementById('spellsLibrary');

    if (!spells || spells.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 40px; grid-column: 1/-1;">No spells available</p>';
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
                    ${spell.name}
                </div>
                <div style="background: rgba(168, 85, 247, 0.2); padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; color: #c4b5fd;">
                    ${spell.rarity || 'common'}
                </div>
            </div>
            <div style="font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">
                ${spell.type} • ${spell.timing}
            </div>
            <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; margin-bottom: 10px;">
                ${spell.description}
            </div>
            <div style="font-size: 0.75rem; color: #64748b; font-style: italic;">
                Target: ${spell.targetType}
            </div>
        </div>
    `).join('');
}

/**
 * Filter spells based on search and type
 */
function filterSpells() {
    const searchTerm = document.getElementById('spellSearchInput').value.toLowerCase();
    const typeFilter = document.getElementById('spellTypeFilter').value;

    let filtered = allSpellDefinitions;

    // Filter by search term
    if (searchTerm) {
        filtered = filtered.filter(spell =>
            spell.name.toLowerCase().includes(searchTerm) ||
            spell.nameEn.toLowerCase().includes(searchTerm) ||
            spell.description.toLowerCase().includes(searchTerm)
        );
    }

    // Filter by type
    if (typeFilter !== 'all') {
        filtered = filtered.filter(spell => spell.type === typeFilter);
    }

    renderSpellsLibrary(filtered);
}

/**
 * Populate spell dropdown for distribution
 */
function populateSpellDropdown() {
    const select = document.getElementById('spellToDistribute');
    select.innerHTML = '<option value="">-- Choose Spell --</option>';

    allSpellDefinitions.forEach(spell => {
        const option = document.createElement('option');
        option.value = spell.id;
        option.textContent = `${spell.name} (${spell.type})`;
        select.appendChild(option);
    });

    // Add change handler
    select.onchange = function() {
        const spellId = this.value;
        if (spellId) {
            showSpellPreview(spellId);
            document.getElementById('distributeBtn').disabled = !document.getElementById('spellDistTeam').value;
        } else {
            document.getElementById('spellPreview').style.display = 'none';
            document.getElementById('distributeBtn').disabled = true;
        }
    };
}

/**
 * Show spell preview
 */
function showSpellPreview(spellId) {
    const spell = allSpellDefinitions.find(s => s.id === spellId);
    if (!spell) return;

    const preview = document.getElementById('spellPreview');
    preview.style.display = 'block';
    preview.innerHTML = `
        <h4 style="margin: 0 0 8px 0; color: #a855f7;">${spell.name}</h4>
        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px;">
            ${spell.type} • ${spell.rarity} • ${spell.timing}
        </div>
        <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5;">
            ${spell.description}
        </div>
    `;
}

/**
 * Populate team dropdown
 */
function populateTeamDropdownForSpells() {
    if (!gameState || !gameState.teams) return;

    const select = document.getElementById('spellDistTeam');
    select.innerHTML = '<option value="">-- Choose Team --</option>';

    gameState.teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = `${team.name} (${team.spellCards?.length || 0} spells)`;
        select.appendChild(option);
    });
}

/**
 * Update team spell inventory display
 */
function updateTeamSpellInventory() {
    const teamId = parseInt(document.getElementById('spellDistTeam').value);
    if (!teamId || !gameState) return;

    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    const container = document.getElementById('teamSpellsList');
    const spells = team.spellCards || team.hand || [];

    if (spells.length === 0) {
        container.innerHTML = '<p style="opacity: 0.5; font-size: 0.85rem;">No spells in hand</p>';
        return;
    }

    container.innerHTML = spells.map((spell, index) => {
        const spellId = typeof spell === 'string' ? spell : spell.id;
        const spellDef = allSpellDefinitions.find(s => s.id === spellId);
        const spellName = spellDef ? spellDef.name : spellId;

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

    // Enable distribute button if spell is selected
    const spellSelected = document.getElementById('spellToDistribute').value;
    document.getElementById('distributeBtn').disabled = !spellSelected;
}

/**
 * Distribute selected spell to selected team
 */
async function distributeSpellToTeam() {
    const teamId = parseInt(document.getElementById('spellDistTeam').value);
    const spellId = document.getElementById('spellToDistribute').value;

    if (!teamId || !spellId) {
        showStatus('Please select both team and spell', 'error');
        return;
    }

    try {
        const team = gameState.teams.find(t => t.id === teamId);
        if (!team) {
            showStatus('Team not found', 'error');
            return;
        }

        // Add spell to team
        team.spellCards = team.spellCards || [];
        team.spellCards.push(spellId);

        // Save to Firebase
        await saveGameState();

        // Update UI
        updateTeamSpellInventory();
        populateTeamDropdownForSpells();
        updateSpellStats();

        const spell = allSpellDefinitions.find(s => s.id === spellId);
        showStatus(`Added "${spell.name}" to ${team.name}`, 'success');
        addLog(`🔮 Distributed spell "${spell.name}" to ${team.name}`, 'success');

    } catch (error) {
        console.error('[Spells God] Error distributing spell:', error);
        showStatus('Error distributing spell: ' + error.message, 'error');
    }
}

/**
 * Remove spell from team
 */
async function removeSpellFromTeam(teamId, spellIndex) {
    if (!confirm('Remove this spell from team?')) return;

    try {
        const team = gameState.teams.find(t => t.id === teamId);
        if (!team) return;

        const spells = team.spellCards || team.hand || [];
        const removedSpell = spells[spellIndex];
        spells.splice(spellIndex, 1);

        await saveGameState();

        updateTeamSpellInventory();
        populateTeamDropdownForSpells();
        updateSpellStats();

        showStatus('Spell removed from team', 'success');
        addLog(`🗑️ Removed spell from ${team.name}`, 'info');

    } catch (error) {
        console.error('[Spells God] Error removing spell:', error);
        showStatus('Error removing spell: ' + error.message, 'error');
    }
}

/**
 * Distribute random spells to all teams
 */
async function distributeRandomSpells() {
    if (!gameState || !gameState.teams || allSpellDefinitions.length === 0) {
        showStatus('Load spells and game first', 'error');
        return;
    }

    const count = prompt('How many spells per team?', '3');
    if (!count) return;

    const spellsPerTeam = parseInt(count);
    if (isNaN(spellsPerTeam) || spellsPerTeam < 1) {
        showStatus('Invalid number', 'error');
        return;
    }

    try {
        for (const team of gameState.teams) {
            team.spellCards = team.spellCards || [];

            // Give random spells
            for (let i = 0; i < spellsPerTeam; i++) {
                const randomSpell = allSpellDefinitions[Math.floor(Math.random() * allSpellDefinitions.length)];
                team.spellCards.push(randomSpell.id);
            }
        }

        await saveGameState();

        populateTeamDropdownForSpells();
        updateSpellStats();

        showStatus(`Distributed ${spellsPerTeam} random spells to each team`, 'success');
        addLog(`🎲 Distributed ${spellsPerTeam} random spells to all teams`, 'success');

    } catch (error) {
        console.error('[Spells God] Error distributing random spells:', error);
        showStatus('Error: ' + error.message, 'error');
    }
}

/**
 * Render spell cast history
 */
function renderSpellHistory() {
    const container = document.getElementById('spellHistory');
    const history = gameState?.spellHistory || [];

    if (history.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.7;">No spells cast yet</p>';
        return;
    }

    container.innerHTML = history.slice().reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        return `
            <div style="padding: 10px; background: rgba(168, 85, 247, 0.1); border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #a855f7;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 5px;">
                    <strong style="color: #a855f7;">${entry.spellName}</strong>
                    <span style="font-size: 0.75rem; color: #64748b;">${time}</span>
                </div>
                <div style="font-size: 0.85rem; color: #cbd5e1;">
                    Cast by <strong>${entry.teamName}</strong>
                </div>
                ${entry.result?.changes?.note ? `
                    <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 5px; font-style: italic;">
                        ${entry.result.changes.note}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Auto-load spells when switching to spells tab
document.addEventListener('DOMContentLoaded', () => {
    // Hook into tab switching
    const originalSwitchGodTab = window.switchGodTab;
    window.switchGodTab = function(tabName) {
        originalSwitchGodTab(tabName);

        if (tabName === 'spells' && allSpellDefinitions.length === 0) {
            loadAllSpells();
        }
    };
});
