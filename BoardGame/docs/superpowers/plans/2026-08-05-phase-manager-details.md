# Phase Manager Match/Player Details + Discord Confirm Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin phase manager's match-slot cards show the actual queued match (game, teams, Discord channels) and a per-player readiness list during lobby; the player view loses its manual Discord confirm buttons now that the bot moves players automatically.

**Architecture:** Data + HTML builders live on `PhaseManager` (plain browser script, `window.PhaseManager`), so both consumers reuse them: god.html's `_renderSlotPanels` (phase-manager.js itself) and admin.html's flow-panel slot cards (`admin-improved-adapter.js`, which holds a `_phaseManager` instance). Player-view changes are confined to `team-controls.js`. Node tests load phase-manager.js the same way existing tests do (stub `global.window` + `ICON_SVGS` proxy).

**Tech Stack:** Vanilla JS browser scripts, `node:test` for unit tests, Firestore via existing patterns. No new dependencies.

**Spec:** `BoardGame/docs/superpowers/specs/2026-08-05-phase-manager-details-design.md`

**Important context for a zero-context engineer:**
- admin.html renders slot cards via `admin-improved-adapter.js` `_renderMatchSlotCards()` — admin.html has NO `#phaseIndicatorBar`, so `PhaseManager.renderPhaseIndicator()` no-ops there. god.html is the page that uses phase-manager.js's own `_renderSlotPanels()`. Both must be updated.
- Queue entries are shape-tolerant: modern `match.teams[].playerIds` vs legacy `match.sides[].players[]`. `match.discordChannels` is keyed by **team id**. Follow `_getPlayersWhoMustReadyForSlot()`'s filtering exactly (untagged matches count for either slot; other-round matches excluded; `'challenge'` pseudo-slot inverts the `isChallenge` check).
- `lobbyReady[uid] = { gameLobby, discord, ready }` — `ready === true` is a legacy flag that implies both. The Discord bot's pull writes `discord: true` automatically.
- Run tests with: `node --test BoardGame/dev/tests/<file>` from the repo root.

---

### Task 1: `getSlotMatchDetails(slot)` data helper

**Files:**
- Modify: `BoardGame/full/scripts/phase-manager.js` (insert after `_getPlayersWhoMustReadyForSlot`, ~line 1418)
- Test (create): `BoardGame/dev/tests/phase-manager-slot-match-details.test.js`

- [ ] **Step 1: Write the failing test**

```js
/**
 * Coverage for PhaseManager.getSlotMatchDetails() — the admin-display
 * resolver for a slot's active matches (game name, sides' team names,
 * Discord channels). Mirrors _getPlayersWhoMustReadyForSlot's filtering.
 *
 * phase-manager.js is a plain browser script (window.PhaseManager), so
 * stub global.window + ICON_SVGS before requiring it (same as
 * phase-manager-slot-requirements.test.js).
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/phase-manager.js');
const PhaseManager = global.window.PhaseManager;

function makeGs(overrides = {}) {
    return {
        currentPhase: { name: 'matches_in_progress', roundNumber: 3, startedAt: 1_000_000, slots: { 1: 'lobby', 2: 'setup' } },
        teams: [
            { id: 1, name: 'Red Dragons', players: [{ uid: 'u1', name: 'Alice', id: 101 }] },
            { id: 2, name: 'Blue Owls',   players: [{ uid: 'u2', name: 'Bob',   id: 102 }] }
        ],
        gameQueue: [],
        ...overrides
    };
}

test('resolves game name from gameDefinitions, team names, and discord channels (modern teams[] shape)', () => {
    const gs = makeGs({
        gameDefinitions: { cs2: { name: 'Counter-Strike 2' } },
        gameQueue: [{
            id: 'm1', status: 'pending', slot: 1, roundNumber: 3, createdAt: 2_000_000,
            game: 'cs2', matchNumber: 7,
            teams: [{ id: 1, playerIds: [101] }, { id: 2, playerIds: [102] }],
            discordChannels: { 1: 'voice-1', 2: 'voice-2' }
        }]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails(1);

    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].gameName, 'Counter-Strike 2');
    assert.strictEqual(details[0].matchNumber, 7);
    assert.deepStrictEqual(details[0].sides.map(s => s.teamName), ['Red Dragons', 'Blue Owls']);
    assert.deepStrictEqual(details[0].sides.map(s => s.discordChannel), ['voice-1', 'voice-2']);
});

test('legacy sides[].players[].teamId shape resolves team names too', () => {
    const gs = makeGs({
        gameQueue: [{
            id: 'm2', status: 'pending', slot: 1, roundNumber: 3,
            gameType: 'trivia',
            sides: [{ players: [{ id: 101, teamId: 1 }] }, { players: [{ id: 102, teamId: 2 }] }]
        }]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails(1);
    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].gameName, 'trivia'); // no gameDefinitions/getGameDisplayName in node
    assert.deepStrictEqual(details[0].sides.map(s => s.teamName), ['Red Dragons', 'Blue Owls']);
});

test('filters: other slot, other round, completed, breaks, challenges are excluded', () => {
    const gs = makeGs({
        gameQueue: [
            { id: 'other-slot',  status: 'pending', slot: 2, roundNumber: 3 },
            { id: 'other-round', status: 'pending', slot: 1, roundNumber: 2 },
            { id: 'done',        status: 'completed', slot: 1, roundNumber: 3 },
            { id: 'break',       isBreak: true, slot: 1 },
            { id: 'challenge',   status: 'pending', isChallenge: true }
        ]
    });
    const pm = new PhaseManager(gs, {});
    assert.deepStrictEqual(pm.getSlotMatchDetails(1), []);
});

test('untagged match counts for BOTH slots (mirrors ready-list policy)', () => {
    const gs = makeGs({
        gameQueue: [{ id: 'untagged', status: 'pending', teams: [{ id: 1, playerIds: [101] }] }]
    });
    const pm = new PhaseManager(gs, {});
    assert.strictEqual(pm.getSlotMatchDetails(1).length, 1);
    assert.strictEqual(pm.getSlotMatchDetails(2).length, 1);
});

test("pseudo-slot 'challenge' returns only challenge matches", () => {
    const gs = makeGs({
        gameQueue: [
            { id: 'normal', status: 'pending', slot: 1, roundNumber: 3 },
            { id: 'chal', status: 'pending', isChallenge: true, slot: 'challenge', game: 'darts',
              teams: [{ id: 2, playerIds: [102] }] }
        ]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails('challenge');
    assert.strictEqual(details.length, 1);
    assert.strictEqual(details[0].id, 'chal');
    assert.deepStrictEqual(details[0].sides.map(s => s.teamName), ['Blue Owls']);
});

test('unknown team id falls back to side.name then "Team <id>"', () => {
    const gs = makeGs({
        gameQueue: [{
            id: 'm3', status: 'pending', slot: 1, roundNumber: 3,
            teams: [{ id: 99, playerIds: [] }, { id: 1, playerIds: [101] }]
        }]
    });
    const pm = new PhaseManager(gs, {});
    const details = pm.getSlotMatchDetails(1);
    assert.strictEqual(details[0].sides[0].teamName, 'Team 99');
    assert.strictEqual(details[0].sides[1].teamName, 'Red Dragons');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test BoardGame/dev/tests/phase-manager-slot-match-details.test.js`
Expected: FAIL — `pm.getSlotMatchDetails is not a function`

- [ ] **Step 3: Implement `getSlotMatchDetails` in phase-manager.js**

Insert directly after the closing brace of `_getPlayersWhoMustReadyForSlot()` (~line 1418):

```js
    /**
     * Admin-display details of one slot's active (non-completed) matches:
     * game name, match number, and each side's team name + Discord
     * channel. Same slot/round/challenge tagging rules as
     * _getPlayersWhoMustReadyForSlot (untagged matches count for either
     * slot). Accepts the pseudo-slot 'challenge'.
     * @returns {Array<{id, matchNumber, status, gameName,
     *   sides: Array<{teamId, teamName, discordChannel}>}>}
     */
    getSlotMatchDetails(slot) {
        const gs = this._gameState;
        const queue = gs.gameQueue || [];
        const currentRoundNumber = gs.currentPhase?.roundNumber;
        const teamById = new Map((gs.teams || []).map(t => [String(t.id), t]));

        const resolveGameName = (id) => {
            if (!id) return 'Match';
            if (gs.gameDefinitions?.[id]?.name) return gs.gameDefinitions[id].name;
            if (typeof getGameDisplayName === 'function') return getGameDisplayName(id);
            return id;
        };

        return queue.filter(m => {
            if (m.isBreak || m.status === 'completed') return false;
            if (slot === 'challenge' ? m.isChallenge !== true : m.isChallenge === true) return false;
            if (m.slot !== undefined && m.slot !== slot) return false;
            if (m.roundNumber !== undefined && currentRoundNumber !== undefined &&
                m.roundNumber !== currentRoundNumber) return false;
            return true;
        }).map(m => ({
            id: m.id,
            matchNumber: m.matchNumber,
            status: m.status || 'pending',
            gameName: resolveGameName(m.game || m.gameType),
            sides: (m.teams || m.sides || []).map(side => {
                const teamId = side.id ?? side.teamId ?? side.players?.[0]?.teamId;
                const team = teamById.get(String(teamId));
                return {
                    teamId,
                    teamName: team?.name || side.name ||
                        (teamId !== undefined ? `Team ${teamId}` : 'TBD'),
                    discordChannel: m.discordChannels?.[teamId] ?? null
                };
            })
        }));
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test BoardGame/dev/tests/phase-manager-slot-match-details.test.js`
Expected: PASS (6 tests). Also run the existing suite to confirm no regression:
`node --test BoardGame/dev/tests/phase-manager-slot-requirements.test.js`

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/scripts/phase-manager.js BoardGame/dev/tests/phase-manager-slot-match-details.test.js
git commit -m "feat: PhaseManager.getSlotMatchDetails resolves slot match display info"
```

---

### Task 2: `getLobbyPlayerStatuses(slot)` data helper

**Files:**
- Modify: `BoardGame/full/scripts/phase-manager.js` (insert after `getSlotMatchDetails` from Task 1)
- Test: `BoardGame/dev/tests/phase-manager-slot-match-details.test.js` (append)

- [ ] **Step 1: Append failing tests**

```js
// ---- getLobbyPlayerStatuses ----

test('getLobbyPlayerStatuses resolves names from rosters and readiness from lobbyReady', () => {
    const gs = makeGs({
        gameQueue: [{ id: 'm1', status: 'pending', slot: 1, roundNumber: 3,
                      teams: [{ id: 1, playerIds: [101] }, { id: 2, playerIds: [102] }] }],
        lobbyReady: {
            u1: { gameLobby: true, discord: false },
            u2: { ready: true } // legacy flag implies both
        }
    });
    const pm = new PhaseManager(gs, {});
    const statuses = pm.getLobbyPlayerStatuses(1);

    assert.deepStrictEqual(statuses, [
        { uid: 'u1', name: 'Alice', teamName: 'Red Dragons', gameLobby: true,  discord: false },
        { uid: 'u2', name: 'Bob',   teamName: 'Blue Owls',   gameLobby: true,  discord: true }
    ]);
});

test('getLobbyPlayerStatuses falls back to lobbyReady.name, then shortened uid', () => {
    const gs = makeGs({
        teams: [{ id: 1, name: 'Red Dragons', players: [
            { uid: 'u1', name: 'Alice', id: 101 },
            { uid: 'mystery-user-uid', id: 103 } // roster entry with no name
        ] }],
        gameQueue: [{ id: 'm1', status: 'pending', slot: 1, roundNumber: 3,
                      teams: [{ id: 1, playerIds: [101] }] }],
        lobbyReady: { 'mystery-user-uid': { name: 'RecordedName', gameLobby: false, discord: false } }
    });
    const pm = new PhaseManager(gs, {});
    const statuses = pm.getLobbyPlayerStatuses(1);
    const mystery = statuses.find(s => s.uid === 'mystery-user-uid');
    assert.strictEqual(mystery.name, 'RecordedName');
});

test('getLobbyPlayerStatuses returns [] when no players must ready', () => {
    const pm = new PhaseManager(makeGs(), {});
    assert.deepStrictEqual(pm.getLobbyPlayerStatuses(1), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test BoardGame/dev/tests/phase-manager-slot-match-details.test.js`
Expected: FAIL — `pm.getLobbyPlayerStatuses is not a function`

- [ ] **Step 3: Implement**

Insert after `getSlotMatchDetails`:

```js
    /**
     * Per-player readiness for one slot's lobby (admin display). Names
     * resolve from team rosters, then the name recorded on the
     * lobbyReady write, then a shortened uid. `ready: true` is the
     * legacy both-at-once flag every reader ORs in.
     * @param {number|'challenge'} slot
     * @returns {Array<{uid, name, teamName, gameLobby, discord}>}
     */
    getLobbyPlayerStatuses(slot) {
        const gs = this._gameState;
        const lobbyReady = gs.lobbyReady || {};
        const rosterByUid = new Map();
        (gs.teams || []).forEach(team => {
            (team.players || []).forEach(p => {
                if (p.uid) rosterByUid.set(p.uid, { name: p.name, teamName: team.name });
            });
        });
        return this._getPlayersWhoMustReadyForSlot(slot).map(uid => {
            const r = lobbyReady[uid] || {};
            const roster = rosterByUid.get(uid);
            return {
                uid,
                name: roster?.name || r.name || String(uid).slice(0, 8),
                teamName: roster?.teamName || null,
                gameLobby: r.gameLobby === true || r.ready === true,
                discord: r.discord === true || r.ready === true
            };
        });
    }
```

- [ ] **Step 4: Run tests**

Run: `node --test BoardGame/dev/tests/phase-manager-slot-match-details.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/scripts/phase-manager.js BoardGame/dev/tests/phase-manager-slot-match-details.test.js
git commit -m "feat: PhaseManager.getLobbyPlayerStatuses per-player lobby readiness"
```

---

### Task 3: Shared HTML builder + god.html slot panels + CSS

**Files:**
- Modify: `BoardGame/full/scripts/phase-manager.js` (`_renderSlotPanels`, ~line 1764; new method next to it)
- Modify: `BoardGame/full/css/phase-indicator.css` (append before the ANIMATION section)

No node test — DOM rendering, verified manually in Task 8. Keep the builder logic thin: all data comes from the two tested helpers.

- [ ] **Step 1: Add `renderSlotDetailsHtml` method**

Insert in phase-manager.js's "UI Rendering" section, just above `_renderSlotPanels`:

```js
    /**
     * Shared admin HTML for a slot's match details, optionally with the
     * per-player lobby readiness list. Used by god.html's slot panels
     * (below) AND admin.html's flow cards (admin-improved-adapter.js) —
     * change both call sites if the signature changes.
     * @param {number|'challenge'} slot
     * @param {{players?: boolean}} [opts]
     */
    renderSlotDetailsHtml(slot, { players = false } = {}) {
        const matchesHtml = this.getSlotMatchDetails(slot).map(m => {
            const sides = m.sides.map(s =>
                `<span class="slot-detail-team">${this._escHtml(s.teamName)}` +
                (s.discordChannel
                    ? ` <span class="slot-detail-channel">${ICON_SVGS.headphones} #${this._escHtml(String(s.discordChannel))}</span>`
                    : '') +
                `</span>`
            ).join('<span class="slot-detail-vs">vs</span>');
            return `<div class="slot-match-detail">` +
                `<span class="slot-detail-game">${m.matchNumber ? '#' + m.matchNumber + ' ' : ''}${this._escHtml(m.gameName)}</span>` +
                sides + `</div>`;
        }).join('');

        let playersHtml = '';
        if (players) {
            const statuses = this.getLobbyPlayerStatuses(slot);
            if (statuses.length > 0) {
                playersHtml = `<div class="slot-lobby-players">` + statuses.map(p =>
                    `<span class="slot-lobby-player ${p.gameLobby && p.discord ? 'is-ready' : 'not-ready'}"` +
                    ` title="${this._escHtml(p.teamName || '')}">` +
                    `<span class="slot-ready-icon ${p.gameLobby ? 'on' : ''}" title="Game lobby (player-confirmed)">${ICON_SVGS.gamepad2}</span>` +
                    `<span class="slot-ready-icon ${p.discord ? 'on' : ''}" title="Discord (moved automatically)">${ICON_SVGS.headphones}</span>` +
                    this._escHtml(p.name) + `</span>`
                ).join('') + `</div>`;
            }
        }
        return matchesHtml + playersHtml;
    }
```

- [ ] **Step 2: Use it in `_renderSlotPanels`**

In the `container.innerHTML = [1, 2].map(slot => {` block (~line 1781), add after the `reqsHtml` const:

```js
            const sub = info.subPhase;
            const detailsHtml = (sub === 'setup' || sub === 'lobby' || sub === 'playing')
                ? this.renderSlotDetailsHtml(slot, { players: sub === 'lobby' })
                : '';
```

and change the returned template to include it between the header and reqs:

```js
                    <div class="match-slot-header">
                        <span class="match-slot-icon">${info.icon}</span>
                        <span class="match-slot-name">${this._escHtml(info.name)}</span>
                    </div>
                    ${detailsHtml}
                    <div class="match-slot-reqs">${reqsHtml}</div>
```

- [ ] **Step 3: Append CSS to phase-indicator.css**

Insert immediately before the `/* ==================== ANIMATION ==================== */` block:

```css
/* Match details + per-player lobby readiness inside slot cards
   (rendered by PhaseManager.renderSlotDetailsHtml on both god.html's
   slot panels and admin.html's flow cards) */
.slot-match-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 0.8rem;
}
.slot-detail-game {
  font-weight: 700;
  color: var(--text-primary, #f7f0e3);
}
.slot-detail-vs {
  opacity: 0.5;
  font-size: 0.7rem;
}
.slot-detail-team {
  color: var(--text-secondary, rgba(247, 240, 227, 0.8));
}
.slot-detail-channel {
  font-size: 0.7rem;
  opacity: 0.75;
  white-space: nowrap;
}
.slot-lobby-players {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.slot-lobby-player {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.slot-lobby-player.not-ready {
  border-color: rgba(255, 120, 80, 0.45);
  color: var(--warning, #ffb37a);
}
.slot-lobby-player.is-ready {
  border-color: rgba(120, 220, 140, 0.35);
  color: var(--success, #9fdca8);
}
.slot-ready-icon {
  display: inline-flex;
  opacity: 0.3;
}
.slot-ready-icon.on {
  opacity: 1;
}
.slot-ready-icon svg {
  width: 12px;
  height: 12px;
}
```

- [ ] **Step 4: Sanity check — existing tests still pass**

Run: `node --test BoardGame/dev/tests/phase-manager-slot-match-details.test.js BoardGame/dev/tests/phase-manager-slot-requirements.test.js BoardGame/dev/tests/phase-manager-lobby-reset.test.js BoardGame/dev/tests/phase-manager-advance-guard.test.js BoardGame/dev/tests/phase-manager-challenge-lobby.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/scripts/phase-manager.js BoardGame/full/css/phase-indicator.css
git commit -m "feat: god slot panels show match details and per-player lobby readiness"
```

---

### Task 4: admin.html flow cards use the shared builder

**Files:**
- Modify: `BoardGame/full/scripts/admin-improved-adapter.js` (`_renderMatchSlotCards`, ~line 768; challenge branch of `_computeNextStep`, ~line 1084)

- [ ] **Step 1: Add details to the slot cards**

In `_renderMatchSlotCards`'s `container.innerHTML = [1, 2].map(slot => {` block, after the `liveMatchesHtml` const (~line 800), add:

```js
            // Match + player detail (game, teams, Discord channels; in
            // lobby also each player's ready state) — playing keeps its
            // richer live-match-card instead.
            const detailsHtml = (sub === 'setup' || sub === 'lobby')
                ? _phaseManager.renderSlotDetailsHtml(slot, { players: sub === 'lobby' })
                : '';
```

and include it in the returned template right after the guidance line:

```js
                    <div class="match-slot-guidance">${_esc(step.text)}</div>
                    ${detailsHtml}
                    ${liveMatchesHtml}
```

- [ ] **Step 2: Add the player list to the challenge lobby step**

In `_computeNextStep`'s challenge branch (~line 1084), the lobby step currently reads:

```js
                    if (_phaseManager.isChallengeLobbyActive()) {
                        return {
                            text: `Waiting for players to ready up for <strong>${_esc(label)}</strong> (auto-advances when done).`,
```

Change the `text` to append the shared details (this `text` field is already rendered as HTML — it contains `<strong>`):

```js
                            text: `Waiting for players to ready up for <strong>${_esc(label)}</strong> (auto-advances when done).` +
                                _phaseManager.renderSlotDetailsHtml('challenge', { players: true }),
```

- [ ] **Step 3: Manual smoke check (no unit tests cover the adapter)**

Serve the repo (Live Server or `npx http-server`) and open
`/BoardGame/full/admin.html?tournamentId=scratch-tournament1`. Advance a slot to lobby; the card must show game + teams + channels + player chips, and the chips must flip green as `lobbyReady` flags change (use Force Ready or a second browser as a player).

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/admin-improved-adapter.js
git commit -m "feat: admin flow cards show match details and lobby player readiness"
```

---

### Task 5: god.html challenge lobby player list

**Files:**
- Modify: `BoardGame/full/scripts/phase-manager.js` (`renderPhaseIndicator`, after the requirements-checklist block ~line 1671)

- [ ] **Step 1: Render a challenge details container**

In `renderPhaseIndicator`, right after the requirements checklist `if (listEl) {...}` block, add:

```js
        // Challenge lobby: show the queued challenge + per-player readiness
        // under the requirement counters (same shared builder the match
        // slots use).
        let challengeDetails = document.getElementById('challengeLobbyDetails');
        if (this.isChallengeLobbyActive()) {
            if (!challengeDetails) {
                challengeDetails = document.createElement('div');
                challengeDetails.id = 'challengeLobbyDetails';
                challengeDetails.className = 'challenge-lobby-details';
                bar.appendChild(challengeDetails);
            }
            challengeDetails.style.display = '';
            challengeDetails.innerHTML = this.renderSlotDetailsHtml('challenge', { players: true });
        } else if (challengeDetails) {
            challengeDetails.style.display = 'none';
            challengeDetails.innerHTML = '';
        }
```

- [ ] **Step 2: Append CSS**

In `phase-indicator.css`, after the Task 3 block:

```css
.challenge-lobby-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
```

- [ ] **Step 3: Run tests (regression only)**

Run: `node --test BoardGame/dev/tests/phase-manager-challenge-lobby.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/phase-manager.js BoardGame/full/css/phase-indicator.css
git commit -m "feat: god challenge lobby shows queued challenge and player readiness"
```

---

### Task 6: Remove manual Discord confirm from player view

**Files:**
- Modify: `BoardGame/full/scripts/team-controls.js` (lines ~307-316, ~383-393, ~2044-2101)
- Modify: `BoardGame/full/team.html` (comment ~line 98)

- [ ] **Step 1: Phase banner — gameLobby is the only manual confirm**

At ~line 307-316, replace:

```js
        if (sub === 'lobby') {
            const r = (gameData.lobbyReady || {})[currentUser?.uid] || {};
            const confirmed = (r.gameLobby === true || r.ready === true) && (r.discord === true || r.ready === true);
            if (confirmed) {
                desc = 'You are confirmed. Waiting for the remaining players...';
                action = false;
            } else {
                desc = `Match ${mySlot} — join Discord and the game lobby, then confirm both.`;
                action = true;
            }
        }
```

with:

```js
        if (sub === 'lobby') {
            const r = (gameData.lobbyReady || {})[currentUser?.uid] || {};
            // Discord readiness is written automatically when the bot moves
            // the player into voice — the only manual confirm is the game
            // lobby.
            const confirmed = r.gameLobby === true || r.ready === true;
            if (confirmed) {
                desc = 'You are confirmed. Waiting for the remaining players...';
                action = false;
            } else {
                desc = `Match ${mySlot} — you'll be moved into Discord automatically. Confirm once you're in the game lobby.`;
                action = true;
            }
        }
```

- [ ] **Step 2: Teammates list — drop the Discord button, keep a read-only indicator**

At ~line 378-393, replace the `if (isLobbyPhase) { ... readyHTML = ... }` branch's template:

```js
                readyHTML = `
                    <div class="teammate-ready-buttons">
                        <span class="teammate-ready-icon ${dc ? 'on' : ''}" title="Discord — moved automatically by the bot">&#x1F3A7;${dc ? '&#x2713;' : ''}</span>
                        <button class="teammate-ready-btn ${gl ? 'is-ready' : ''}" ${gl ? 'disabled' : ''} ${confirmTitle}
                                onclick="event.stopPropagation(); setReadyStatus('gameLobby'${uidArg})">
                            &#x1F3AE; ${gl ? '&#x2713;' : 'Lobby'}
                        </button>
                    </div>`;
```

(The non-lobby `teammate-ready-indicators` branch already renders read-only icons — leave it.)

- [ ] **Step 3: `setReadyStatus` accepts only gameLobby; delete `toggleReady`**

At ~line 2044, update the JSDoc and add a guard at the top of `setReadyStatus`:

```js
/**
 * Confirm game-lobby readiness for the current player, or on behalf of a
 * teammate (team members vouch for each other being in the lobby).
 * Discord readiness is no longer player-settable — the bot's automated
 * voice move writes lobbyReady.{uid}.discord itself.
 * @param {'gameLobby'} statusType
 * @param {string} [targetUid]  Teammate's uid; defaults to the current player
 */
async function setReadyStatus(statusType, targetUid = null) {
    if (statusType !== 'gameLobby') {
        console.warn(`[Team Controls] setReadyStatus('${statusType}') ignored — only gameLobby is player-settable`);
        return;
    }
    if (!currentUser || !currentTournamentId) return;
```

Delete the `toggleReady` function entirely (~lines 2097-2101 — it has no callers; verify with `grep -rn "toggleReady" BoardGame/full` → only the definition).

- [ ] **Step 4: Update the stale comment in team.html (~line 98)**

Replace the comment mentioning "Self/teammate Discord+Lobby toggle buttons" with:

```html
                    <!-- Self/teammate Game Lobby confirm buttons are NOT duplicated
```

(keep the rest of that comment's lines as-is — only the first line changes).

- [ ] **Step 5: Grep for leftovers**

Run: `grep -rn "setReadyStatus('discord'\|toggleReady" BoardGame/full`
Expected: no matches.

- [ ] **Step 6: Manual smoke check**

On team.html as a player in a lobby: only the Lobby button renders (plus a dimmed 🎧 indicator); clicking it writes `lobbyReady.{uid}.gameLobby` and the banner flips to "You are confirmed…" even while `discord` is still false.

- [ ] **Step 7: Commit**

```bash
git add BoardGame/full/scripts/team-controls.js BoardGame/full/team.html
git commit -m "feat: remove manual Discord confirm - bot voice moves write it automatically"
```

---

### Task 7: Update e2e-ready-check.js for the removed buttons

**Files:**
- Modify: `BoardGame/dev/tests/e2e-ready-check.js` (Part 2, lines ~330-400)

The script currently clicks TWO own-row buttons and TWO teammate buttons and expects `discord` to be set by those clicks. With the Discord button gone, the bot is what sets `discord` — the e2e (which runs without the bot) must simulate that write directly, keeping the auto-advance assertion meaningful.

- [ ] **Step 1: Own-row confirm — one click, then simulate the bot**

Replace the `for (let i = 0; i < 2; i++)` own-button loop and the own-confirm assertions (~lines 337-363) with:

```js
      // Click the single Game Lobby confirm button (the Discord button was
      // removed — the bot's automated voice move writes discord:true, which
      // this bot-less e2e simulates with a direct Firestore write below).
      await playerPage.waitForSelector('.teammate-item.you .teammate-ready-btn:not([disabled])', { timeout: 10000 });
      const ownBtn = await playerPage.$('.teammate-item.you .teammate-ready-btn:not([disabled])');
      await ownBtn.click();
      await playerPage.waitForFunction(
        () => document.querySelectorAll('.teammate-item.you .teammate-ready-btn:not([disabled])').length === 0,
        { timeout: 10000 }
      );

      const uiAfterOwnConfirm = await playerPage.evaluate(() =>
        document.querySelector('.teammate-item.you')?.innerHTML || ''
      );
      console.log('--- PART 2: own teammate-item HTML after own confirm ---', uiAfterOwnConfirm.slice(0, 300));
      assert(/✓/.test(uiAfterOwnConfirm), 'PART 2: own Lobby button should show a checkmark after confirming');

      // Simulate the Discord bot's automated write for this player.
      await tdPage.evaluate((uid) => firebase.firestore()
        .collection('tournaments').doc(window.godApp.tournamentId)
        .update({ [`lobbyReady.${uid}.discord`]: true }), player14.uid);

      await tdPage.waitForFunction(
        (uid) => window.godApp.gameState.lobbyReady?.[uid]?.discord === true && window.godApp.gameState.lobbyReady?.[uid]?.gameLobby === true,
        { timeout: 15000 },
        player14.uid
      );
      const firestoreLobbyReadyForPlayer = await tdPage.evaluate((uid) => window.godApp.gameState.lobbyReady[uid], player14.uid);
      console.log('--- PART 2: Firestore lobbyReady for E2ePlayer14 ---', JSON.stringify(firestoreLobbyReadyForPlayer));
      assert(firestoreLobbyReadyForPlayer.discord === true && firestoreLobbyReadyForPlayer.gameLobby === true,
        'PART 2: Firestore lobbyReady should show gameLobby (button) + discord (simulated bot write)');
```

Note: check how the TD page exposes the tournament id (`window.godApp.tournamentId` — verify the property name in god-app.js and adjust; if unavailable, read it from the page URL query string instead).

- [ ] **Step 2: Teammate confirm — one button, one click, simulate bot for teammate**

Replace the teammate section (~lines 370-394): the count assertion becomes:

```js
      assert(teammateBtnCount === 1, `PART 2: expected 1 teammate-confirm button (Lobby) for "TD (E2E)", got ${teammateBtnCount}`);
```

the click loop becomes a single click (same re-query pattern, no loop), then add the simulated bot write for `tdE2E.uid` before the existing `waitForFunction` that asserts both flags; change the final `discordBy || gameLobbyBy` assertion to check `gameLobbyBy` only:

```js
      assert(firestoreLobbyReadyForTeammate.gameLobbyBy === player14.uid,
        `PART 2: expected teammate's lobby confirm to note it was done by E2ePlayer14, got: ${JSON.stringify(firestoreLobbyReadyForTeammate)}`);
```

- [ ] **Step 3: Skim Parts 1/3 for Discord-button references**

Search the file for `readyDiscordBtn` / `'discord'` in Parts 1 and 3; Part 3's "no UI path to retroactively confirm" finding text stays valid. Update any comment that claims players confirm Discord manually.

- [ ] **Step 4: Run the e2e** (requires the e2e env: credentials live in the todo-triage-e2e worktree's `.env.e2e`; see `BoardGame/dev/tests/E2E_HARNESS.md`)

Run per the harness doc. Expected: Parts 1-3 pass with the new single-button flow.

- [ ] **Step 5: Commit**

```bash
git add BoardGame/dev/tests/e2e-ready-check.js
git commit -m "test: e2e ready-check simulates bot discord write, single lobby button"
```

---

### Task 8: Full verification pass

- [ ] **Step 1: Run the whole unit test suite**

Run: `node --test BoardGame/dev/tests/*.test.js`
Expected: PASS across the board.

- [ ] **Step 2: Manual walkthrough on scratch tournament**

Serve locally, open `/BoardGame/full/admin.html?tournamentId=scratch-tournament1` and `/BoardGame/full/god.html?tournamentId=scratch-tournament1`:
1. Slot in **setup** → card shows queued match's game + team names.
2. Open Lobby → card shows Discord channels + player chips; chips reflect `lobbyReady` live.
3. Player view (team.html): only the Lobby confirm button; 🎧 shown read-only; banner text mentions automatic Discord move.
4. Challenge lobby (god + admin): player list renders under the ready counters.

- [ ] **Step 3: Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch**
