# SpellsActive Tournament Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tournament `spellsActive` boolean flag, editable from god.html and admin.html, that hides the digital spell UI (sidebar card list + spell-casting overlay) on team.html when off, without touching the underlying `spell_window_*` phase flow.

**Architecture:** `spellsActive` is a plain field on the tournament document (`tournaments/{tournamentId}`), same doc every page (`god.html`, `admin.html`, `team.html`) already reads/writes wholesale. god.html and admin.html each get a small edit UI writing that field through their existing save mechanisms. team.html reads it live off its existing `onSnapshot` listener and branches two render functions on it — no new listeners, no new Firestore paths.

**Tech Stack:** Vanilla JS, Firebase Firestore (compat SDK), no bundler, no test framework. This repo has no automated test suite — verification for every task below is manual, via a local static server (e.g. VS Code Live Server on `http://127.0.0.1:5500/`) against a real tournament document in Firestore. Each task ends with an explicit manual check instead of a test run.

---

### Task 1: god.html — add "Spells Active" checkbox to Edit Tournament modal

**Files:**
- Modify: `BoardGame/full/scripts/god-app.js:657-701` (`editTournament`, `saveTournamentEdits`)

- [ ] **Step 1: Add the checkbox to the generated form**

In `editTournament(tournamentId)`, the `form.innerHTML` template currently ends its two `form-group` blocks with Name and Win Condition (`BoardGame/full/scripts/god-app.js:658-665`). Add a third `form-group` for the checkbox right after the Win Condition block and before the button row:

```js
        form.innerHTML = `
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="editTournamentName" value="${escapeHtml(t.name || '')}" style="width: 100%; padding: 10px; background: rgba(11, 13, 16, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; color: white;">
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label>Win Condition (points)</label>
                <input type="number" id="editTournamentWinCondition" value="${t.winCondition || 50}" min="1" max="500" style="width: 100%; padding: 10px; background: rgba(11, 13, 16, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; color: white;">
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="editTournamentSpellsActive" ${t.spellsActive === true ? 'checked' : ''} style="width: 18px; height: 18px;">
                    Spells Active (players see digital spell cards on team.html)
                </label>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
                <button class="btn secondary" onclick="closeEditModal()">Cancel</button>
                <button class="btn primary" onclick="saveTournamentEdits()">Save Changes</button>
            </div>
        `;
```

- [ ] **Step 2: Read and save the checkbox value**

In `saveTournamentEdits()` (`BoardGame/full/scripts/god-app.js:682-702`), read the checkbox and include it in the Firestore update:

```js
    async saveTournamentEdits() {
        if (!this._editingTournamentId) return;

        const nameInput = document.getElementById('editTournamentName');
        const winInput = document.getElementById('editTournamentWinCondition');
        const spellsInput = document.getElementById('editTournamentSpellsActive');
        const name = nameInput?.value?.trim();
        if (!name) { this.ui.showStatus('Name cannot be empty', 'warning'); return; }
        const winCondition = Math.max(1, parseInt(winInput?.value, 10) || 50);
        const spellsActive = !!spellsInput?.checked;

        try {
            await window.firebaseDB.collection('tournaments').doc(this._editingTournamentId).update({
                name, winCondition, spellsActive
            });
            this.ui.showStatus('Tournament updated', 'success');
            this.closeEditModal();
            await this.loadTournamentsList();
        } catch (error) {
            console.error('Error updating tournament:', error);
            this.ui.showStatus('Error updating tournament', 'error');
        }
    }
```

- [ ] **Step 3: Manual verification**

1. Serve the repo locally (e.g. VS Code Live Server) and open `http://127.0.0.1:5500/BoardGame/full/god.html`.
2. Log in as god, open the tournament list, click Edit on any tournament (e.g. `raakatesti2026`).
3. Confirm the "Spells Active" checkbox appears, unchecked by default (since the field doesn't exist yet on this tournament doc).
4. Check it, click Save Changes. Confirm the success toast and that the modal closes.
5. In the Firebase console (or by reopening Edit on the same tournament), confirm `spellsActive: true` is now set on the doc and the checkbox reopens checked.
6. Uncheck it, save again, confirm it persists as `false`.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/god-app.js
git commit -m "Add Spells Active toggle to god.html Edit Tournament modal"
```

---

### Task 2: admin.html — add "Spells" stat badge + modal (mirrors "Win At")

**Files:**
- Modify: `BoardGame/full/admin.html:170-174` (top bar stat badges)
- Modify: `BoardGame/full/admin.html:644-667` (modals, add new one after Win Condition modal)

- [ ] **Step 1: Add the badge next to "Win At"**

In the `.stat-badges` block (`BoardGame/full/admin.html:148-175`), add a new badge after the "Win At" one:

```html
                <div class="stat-sep"></div>
                <div class="stat-badge stat-badge-editable" onclick="openWinConditionModal()" title="Change the tournament win condition (victory points needed)">
                    <span class="stat-label">Win At</span>
                    <span class="stat-value" id="winConditionValue">50</span>
                    <span class="stat-edit-icon">&#9998;</span>
                </div>
                <div class="stat-sep"></div>
                <div class="stat-badge stat-badge-editable" onclick="openSpellsActiveModal()" title="Toggle whether players see digital spell cards on team.html">
                    <span class="stat-label">Spells</span>
                    <span class="stat-value" id="spellsActiveValue">Off</span>
                    <span class="stat-edit-icon">&#9998;</span>
                </div>
            </div>
```

- [ ] **Step 2: Add the modal**

Right after the Win Condition modal (`BoardGame/full/admin.html:644-667`), add:

```html
    <!-- Spells Active Modal -->
    <div id="spellsActiveModal" class="phase-modal" style="display: none;">
        <div class="phase-modal-content" style="max-width: 400px;">
            <div class="phase-modal-header">
                <h2>Spells</h2>
                <button onclick="closeSpellsActiveModal()" style="background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;">&times;</button>
            </div>
            <div class="phase-modal-body">
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 12px;">
                    Controls whether players see digital spell cards and the spell-casting overlay in team.html. Spell windows in the phase flow still run either way — turn this off when spells are being played physically at the table.
                </p>
                <div class="form-group">
                    <label style="color: var(--text-secondary); font-size: 0.9rem; display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="spellsActiveInput" style="width: 18px; height: 18px;">
                        Spells active (players see digital spell UI)
                    </label>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;">
                    <button class="btn secondary" onclick="closeSpellsActiveModal()">Cancel</button>
                    <button class="btn primary" onclick="saveSpellsActive(this)">Save</button>
                </div>
            </div>
        </div>
    </div>
```

- [ ] **Step 3: Manual verification (markup only, JS not wired yet)**

1. Open `http://127.0.0.1:5500/BoardGame/full/admin.html?tournamentId=raakatesti2026`.
2. Confirm a "Spells: Off" badge renders next to "Win At" in the top bar.
3. Click it — since `openSpellsActiveModal` doesn't exist yet, expect a console error (`openSpellsActiveModal is not defined`) and nothing visible happens. This is expected at this point; Task 3 wires the JS.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/admin.html
git commit -m "Add Spells badge and modal markup to admin.html top bar"
```

---

### Task 3: admin.html — wire the Spells badge/modal to `gameState.spellsActive`

**Files:**
- Modify: `BoardGame/full/scripts/admin-improved-adapter.js:1327-1333` (`window._onAdminDisplayUpdate`)
- Modify: `BoardGame/full/scripts/admin-improved-adapter.js:1605-1689` (win condition section — add spells section right after it)

- [ ] **Step 1: Add the render + modal functions**

Immediately after the win-condition block ends (`BoardGame/full/scripts/admin-improved-adapter.js`, right after the closing of `_checkWinCondition()` at line 1688, before the `HEX PLACEMENT POPUP` section comment at line 1690), add:

```js
    // ══════════════════════════════════════════════════════════════
    //  SPELLS ACTIVE — toggle whether team.html shows digital spell UI
    // ══════════════════════════════════════════════════════════════
    //
    // Spell windows (spell_window_1..4) still run in the phase flow either
    // way — this only controls whether players see the spell cards sidebar
    // and the spell-casting overlay on team.html. Defaults to false/off:
    // spells are now resolved physically at the table unless an admin
    // opts a tournament in.

    function _renderSpellsActiveBadge() {
        const el = document.getElementById('spellsActiveValue');
        if (el) el.textContent = gameState?.spellsActive === true ? 'On' : 'Off';
    }

    window.openSpellsActiveModal = () => {
        const modal = document.getElementById('spellsActiveModal');
        if (!modal) return;
        const input = document.getElementById('spellsActiveInput');
        if (input) input.checked = gameState?.spellsActive === true;
        modal.style.display = 'flex';
    };

    window.closeSpellsActiveModal = () => {
        const modal = document.getElementById('spellsActiveModal');
        if (modal) modal.style.display = 'none';
    };

    window.saveSpellsActive = async (triggerBtn) => {
        const input = document.getElementById('spellsActiveInput');
        const value = !!input?.checked;
        const prev = gameState.spellsActive === true;
        gameState.spellsActive = value;
        await saveGameState(triggerBtn);
        _actionLogger?.logAction('spells_active_changed', 'admin', {
            newValue: value, previousValue: prev
        }, { spellsActive: prev });
        showStatus(`Spells ${value ? 'enabled' : 'disabled'} for players.`, 'success');
        window.closeSpellsActiveModal();
        _renderSpellsActiveBadge();
    };
```

- [ ] **Step 2: Hook the badge render into the display-update cycle**

In `window._onAdminDisplayUpdate` (`BoardGame/full/scripts/admin-improved-adapter.js:1327-1333`), render the new badge alongside the win-condition one:

```js
    window._onAdminDisplayUpdate = function () {
        // Win condition badge/check doesn't depend on the phase system being
        // initialized — render it regardless so it's visible from pre_game_setup
        if (gameState?.teams) {
            _renderWinConditionBadge();
            _checkWinCondition();
            _renderSpellsActiveBadge();
        }
```

- [ ] **Step 3: Manual verification**

1. Reload `http://127.0.0.1:5500/BoardGame/full/admin.html?tournamentId=raakatesti2026`.
2. Confirm the "Spells" badge shows "Off" (matches Task 1's default, and matches whatever you last set via god.html — if you left it `true` at the end of Task 1, reset it to `false` via god.html first so this task starts from a known state, or just verify it matches whatever the doc currently has).
3. Click the badge, confirm the modal opens with the checkbox reflecting current state.
4. Toggle it, click Save. Confirm: success toast, modal closes, badge updates to "On"/"Off" immediately.
5. Reopen the god.html Edit Tournament modal for the same tournament — confirm the checkbox there now matches what you just set via admin.html (proves both pages read/write the same field).
6. Refresh admin.html — confirm the badge still shows the saved value (proves it persisted to Firestore, not just local state).

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/admin-improved-adapter.js
git commit -m "Wire Spells badge/modal in admin.html to gameState.spellsActive"
```

---

### Task 4: team.html — hide the Spell Cards sidebar section when spells are inactive

**Files:**
- Modify: `BoardGame/full/team.html:125-130` (Spell Cards section markup)
- Modify: `BoardGame/full/scripts/team-controls.js:347-378` (`renderSpellCards`)

- [ ] **Step 1: Give the sidebar section an id**

In `BoardGame/full/team.html`, the Spell Cards section currently has no wrapping id:

```html
                <div class="team-section">
                    <div class="team-section-header">Spell Cards (<span id="spellCardsCount">0</span>)</div>
                    <div class="spell-cards-grid" id="spellCardsList">
                        <p class="empty-state-inline">No spell cards available</p>
                    </div>
                </div>
```

Change the wrapping `div` to add `id="spellCardsSection"`:

```html
                <div class="team-section" id="spellCardsSection">
                    <div class="team-section-header">Spell Cards (<span id="spellCardsCount">0</span>)</div>
                    <div class="spell-cards-grid" id="spellCardsList">
                        <p class="empty-state-inline">No spell cards available</p>
                    </div>
                </div>
```

- [ ] **Step 2: Branch `renderSpellCards()` on `gameData.spellsActive`**

In `BoardGame/full/scripts/team-controls.js:347-378`, add an early check that hides the whole section when the flag is off, and restores it (and continues normal rendering) when on:

```js
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
```

- [ ] **Step 3: Manual verification**

1. Using god.html or admin.html, set `spellsActive: false` on tournament `raakatesti2026` (or leave the default, since it's `false` unless you set it in earlier tasks).
2. Open `http://127.0.0.1:5500/BoardGame/full/team.html?tournamentId=raakatesti2026&teamId=1`.
3. Confirm the "Spell Cards" section does not appear in the left sidebar at all (Teammates and Active Conditions sections still show normally).
4. Toggle `spellsActive: true` via god.html or admin.html, without reloading team.html — confirm the section appears live (proves the `onSnapshot` listener drives this, not just a page-load check). If it's a team with spell cards in `spellPiles`, confirm they render as before.
5. Toggle back to `false` live — confirm the section disappears again without a page reload.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/team.html BoardGame/full/scripts/team-controls.js
git commit -m "Hide team.html Spell Cards sidebar when tournament spellsActive is off"
```

---

### Task 5: team.html — replace the interactive Spell Phase overlay with a static message when spells are inactive

**Files:**
- Modify: `BoardGame/full/scripts/team-controls.js:406-454` (`renderSpellPhaseOverlay`)

- [ ] **Step 1: Branch on `gameData.spellsActive` before rendering the interactive hand**

The overlay must still appear during `spell_window_*` phases (so players know a spell window is happening) but show a static, non-interactive message instead of the hand-of-cards UI when the flag is off:

```js
function renderSpellPhaseOverlay() {
    const overlay = document.getElementById('spellPhaseOverlay');
    if (!overlay) return;

    const phaseName = gameData?.currentPhase?.name;
    if (!phaseName || !phaseName.startsWith('spell_window')) {
        overlay.style.display = 'none';
        return;
    }

    overlay.style.display = 'flex';

    if (!gameData.spellsActive) {
        document.getElementById('spellPhaseTurnStatus').textContent = 'Spell phase — resolved by the tournament admin.';
        document.getElementById('spellHandCards').innerHTML = '';
        document.getElementById('spellPhaseActions').style.display = 'none';
        document.getElementById('spellTurnCompletedMsg').style.display = 'none';
        return;
    }

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
```

- [ ] **Step 2: Manual verification**

This phase is normally reached through match flow, which is slow to set up end-to-end. Verify by direct state injection via the browser console instead:

1. With `spellsActive: false` on the tournament, open team.html for a team in that tournament.
2. Open the browser devtools console and run:
   ```js
   gameData.currentPhase = { name: 'spell_window_1' };
   renderSpellPhaseOverlay();
   ```
3. Confirm the overlay appears with the text "Spell phase — resolved by the tournament admin.", no hand cards, and no "Pass (No Spell)" button.
4. In the console, run `gameData.spellsActive = true; renderSpellPhaseOverlay();` and confirm it now falls through to the normal turn-status logic (e.g. "Spell phase starting..." if `gameData.spellPhase` is unset, or the turn-order text if it is set) — i.e. confirm you haven't broken the on-path.
5. Run `gameData.currentPhase = { name: 'board_resolved' }; renderSpellPhaseOverlay();` and confirm the overlay hides again regardless of `spellsActive` — the phase-name gate above still works.

- [ ] **Step 3: Commit**

```bash
git add BoardGame/full/scripts/team-controls.js
git commit -m "Show static message instead of spell-casting overlay when spellsActive is off"
```

---

### Task 6: End-to-end verification across all three pages

**Files:** none (verification only)

- [ ] **Step 1: Full flow check on a real tournament**

1. Pick a real (or test) tournament with at least one team that has cards in `spellPiles`.
2. In god.html, open Edit Tournament, confirm the current `spellsActive` state, and set it to `false` if not already.
3. Open team.html for a team in that tournament — confirm no Spell Cards section.
4. In admin.html for the same tournament, confirm the "Spells" badge shows "Off", click it and turn it "On".
5. Back in team.html (already open, no reload) — confirm the Spell Cards section appears live with that team's hand.
6. In god.html, reopen Edit Tournament for the same tournament — confirm the checkbox now shows checked, matching admin.html's change.
7. Turn it back off from god.html's modal, save.
8. Confirm team.html's Spell Cards section disappears live again.

- [ ] **Step 2: Regression check on a tournament that never gets touched**

1. Pick a second tournament whose doc has no `spellsActive` field at all (i.e. don't run any of the above steps against it).
2. Open team.html for a team in it — confirm the Spell Cards section is absent (default-off behavior), and that everything else on the page (Teammates, board, match info, etc.) renders exactly as before this change.

No commit for this task — it's a verification pass only.
