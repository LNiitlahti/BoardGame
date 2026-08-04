# Drink Counter & Fun Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player tap a button on their phone to log a drink, show a "most drinks" leaderboard on the big screen during breaks, and produce a post-tournament drinks-vs-performance report on the statistics page.

**Architecture:** Counts live in a `drinkCounts` map on the tournament document, keyed by Firebase Auth uid — deliberately the same shape and the same write path as the existing `lobbyReady` map, so it inherits a pattern that already works under the Firestore rules, the offline cache, and multi-tab use. All derivation (totals, ranking, the win correlation) is pure code in one shared module with unit tests; the three UI surfaces are thin renderers over it.

**Tech Stack:** Vanilla JS (no build step), Firebase v9 compat SDK, `node:test` for the pure module, Puppeteer + `dev/tests/e2e-server.js` for the visual check.

**Source:** [`../../notes/2026-08-05-discord-feature-requests.md`](../../notes/2026-08-05-discord-feature-requests.md) items 6 and 7.

Item 6's developer note: *"Simple button a player can press, pepsi or coke can, generic beer icon, we dont want this to be alcohol specific, although we could generate a report after the tournament of how many drinks a player drank and how it affected their performance, valuable information but just a fun addon or a feature. Non critical."*

Item 7's developer note: *"fun stat counter, nice idea to show these drink statistics maybe when a break is occurring."*

---

## Two constraints that shape everything below

**1. This must never touch scoring.** Item 8 (a breathalyzer reading multiplying victory points) was closed — *"we wont implement this, end of discussion."* Nothing in this plan may read from or write to `team.points`, `gamesWon`, or anything in `confirmResult()` / `awardRoundPoints()`. `drinkCounts` is a parallel, display-only dataset. The scoring path documented in `BoardGame/docs/architecture/scoring.md` was rebuilt recently after three contradictory specs were found and deleted; keep this feature well clear of it.

**2. It is drink-generic, not alcohol-specific.** Per the developer note: two drink types, a soft drink and a beer, counted together as one "drinks" total. No spirits, no shots, no "everstejä", no branding. The Discord thread's original framing was alcohol-specific; the note deliberately walks that back and the implementation follows the note.

---

## Background an engineer needs before touching this

**Player writes to the tournament document are whitelisted.** `BoardGame/firestore.rules`'s `isPlayerGameplayUpdate()` (around line 123) allows a signed-in non-anonymous player to update *only* these fields:

```
['lobbyReady', 'gameQueue', 'selectedGames', 'spellPiles', 'spellPhase',
 'spellHistory', 'activeEffects', 'teams', 'lastModified']
```

A write to any other field is rejected. `drinkCounts` must be added to that list or Task 3's button silently fails. That is Task 2.

> **`BoardGame/firestore.rules` is gitignored** (`BoardGame/.gitignore:177`). It cannot be committed, so the rules change is a manual local edit plus a deploy, and it will not travel with the branch. Whoever runs this plan on another machine must repeat Task 2 there.

**There is a second, dangerous ruleset in the tree.** `BoardGame/firestore.rules.temp` is a 15-line permissive file (`allow read, write: if request.auth != null`) kept **on purpose** as a reminder for final-step security work — do not delete it, and do not deploy it. It matters here for one specific reason: if the temp ruleset happens to be what is live in Firebase, Task 3's write will succeed *whether or not* Task 2 was done, and the verification in Task 2 Step 4 will be meaningless. Confirm which ruleset is deployed before trusting that step.

**The write pattern to copy.** `setReadyStatus()` (`team-controls.js:2052-2101`) is the model: dotted field paths in a single `update()`, guarded by `currentUser` and `currentTournamentId`, wrapped in try/catch with `showStatus()` on failure. Follow it exactly.

**Failures are silent under quota.** When the Firebase project hits its daily quota, Firestore returns 429 `resource-exhausted` and writes fail without a visible error — the button just appears not to work. Task 3's error handling surfaces that rather than swallowing it.

**Match result shape, for the correlation report.** A completed queue entry carries `status: 'completed'`, a `winnerIndex`, and `teams[].playerIds` holding player-registry ids. Player-registry id → uid is `gameData.players[playerId].uid`. This is the same join `DisplayManager._renderMatchResult()` and `discord-move-planner.js` already rely on, so the shape is verified.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `BoardGame/shared/scripts/drink-counter.js` | **Pure.** Drink types, totals, leaderboard, win correlation. No DOM, no Firestore. |
| `BoardGame/dev/tests/drink-counter.test.js` | Unit tests for the above |
| `BoardGame/dev/tests/e2e-view-drink-leaderboard.js` | Puppeteer check for the break-screen leaderboard |

**Modify:**

| File | Change |
|---|---|
| `BoardGame/firestore.rules` | Add `drinkCounts` to the player-writable whitelist (**local only, gitignored, needs deploy**) |
| `BoardGame/full/team.html` | Drinks section markup + script tag |
| `BoardGame/full/scripts/team-controls.js` | `renderDrinkCounter()` + `logDrink()` write path |
| `BoardGame/full/scripts/display-manager.js` | Break-screen leaderboard in `_renderBreakScreen()` |
| `BoardGame/full/view.html` | Leaderboard CSS + script tag |
| `BoardGame/full/statistics.html` | "Drinks" tab button + pane |
| `BoardGame/full/scripts/statistics.js` | `renderDrinkReport()` wired into `renderAllStatistics()` |

**Test commands:**
- Unit: `node --test "BoardGame/dev/tests/*.test.js"` — **165 passing as of 2026-08-05**; this plan adds 11, for 176. (If a sibling plan from the same triage batch — the live-screen pass or the chat overlay — was executed first, the baseline is higher by that plan's additions. Take the number you measure before starting as the baseline.)
- Visual: `cd BoardGame && node dev/tests/e2e-view-drink-leaderboard.js`

---

## Task 1: The pure drink module

Every derived number in this feature — totals, ranking, win correlation — is a pure function of the tournament snapshot. Building them first means the three UI surfaces are all thin renderers over one tested source, instead of three slightly different loops.

**Files:**
- Create: `BoardGame/shared/scripts/drink-counter.js`
- Test: `BoardGame/dev/tests/drink-counter.test.js`

- [ ] **Step 1: Write the failing tests**

Create `BoardGame/dev/tests/drink-counter.test.js`:

```js
/**
 * Unit coverage for shared/scripts/drink-counter.js — the pure derivations
 * behind the LAN drink counter (team.html button, view.html break-screen
 * leaderboard, statistics.html post-tournament report).
 *
 * Deliberately drink-GENERIC: a soft drink and a beer, summed into one
 * "drinks" total. Per the 2026-08-05 developer note this is not an
 * alcohol-specific feature, and it never touches scoring.
 */
const test = require('node:test');
const assert = require('node:assert');

const DrinkCounter = require('../../shared/scripts/drink-counter.js');

const GAME_DATA = {
    teams: [
        {
            id: 1, name: 'Tiimi 1', color: '#de392c',
            players: [
                { id: 'p_aaa', uid: 'uid_aaa', name: 'Wustra' },
                { id: 'p_bbb', uid: 'uid_bbb', name: 'Touch' }
            ]
        },
        {
            id: 2, name: 'Tiimi 2', color: '#2278a3',
            players: [{ id: 'p_ccc', uid: 'uid_ccc', name: 'Inffi' }]
        }
    ],
    players: {
        p_aaa: { uid: 'uid_aaa', name: 'Wustra', teamId: 1 },
        p_bbb: { uid: 'uid_bbb', name: 'Touch', teamId: 1 },
        p_ccc: { uid: 'uid_ccc', name: 'Inffi', teamId: 2 }
    },
    drinkCounts: {
        uid_aaa: { soft: 2, beer: 5 },
        uid_bbb: { soft: 4, beer: 0 },
        uid_ccc: { beer: 1 }
    },
    gameQueue: [
        {
            id: 'm1', status: 'completed', winnerIndex: 0,
            teams: [{ playerIds: ['p_aaa'] }, { playerIds: ['p_ccc'] }]
        },
        {
            id: 'm2', status: 'completed', winnerIndex: 1,
            teams: [{ playerIds: ['p_aaa'] }, { playerIds: ['p_bbb'] }]
        },
        // Not finished — must not count toward anyone's played/won.
        {
            id: 'm3', status: 'ongoing',
            teams: [{ playerIds: ['p_aaa'] }, { playerIds: ['p_ccc'] }]
        }
    ]
};

// ---------- totalFor ----------

test('totalFor sums every drink type', () => {
    assert.strictEqual(DrinkCounter.totalFor({ soft: 2, beer: 5 }), 7);
});

test('totalFor treats a missing type as zero', () => {
    assert.strictEqual(DrinkCounter.totalFor({ beer: 3 }), 3);
});

test('totalFor on a missing or empty entry is zero, not NaN', () => {
    assert.strictEqual(DrinkCounter.totalFor(undefined), 0);
    assert.strictEqual(DrinkCounter.totalFor({}), 0);
});

// ---------- buildDrinkLeaderboard ----------

test('buildDrinkLeaderboard ranks by total, descending, with name and team colour', () => {
    const board = DrinkCounter.buildDrinkLeaderboard(GAME_DATA);
    assert.deepStrictEqual(
        board.map(r => [r.name, r.total]),
        [['Wustra', 7], ['Touch', 4], ['Inffi', 1]]
    );
    assert.strictEqual(board[0].color, '#de392c');
    assert.strictEqual(board[2].color, '#2278a3');
});

test('buildDrinkLeaderboard honours its limit', () => {
    const board = DrinkCounter.buildDrinkLeaderboard(GAME_DATA, 2);
    assert.strictEqual(board.length, 2);
    assert.strictEqual(board[0].name, 'Wustra');
});

test('buildDrinkLeaderboard skips players with no drinks logged', () => {
    const data = { ...GAME_DATA, drinkCounts: { uid_aaa: { beer: 1 } } };
    const board = DrinkCounter.buildDrinkLeaderboard(data);
    assert.strictEqual(board.length, 1);
    assert.strictEqual(board[0].name, 'Wustra');
});

test('buildDrinkLeaderboard on a tournament with no drinkCounts returns an empty list', () => {
    assert.deepStrictEqual(DrinkCounter.buildDrinkLeaderboard({ teams: [] }), []);
    assert.deepStrictEqual(DrinkCounter.buildDrinkLeaderboard(null), []);
});

test('buildDrinkLeaderboard ignores counts for a uid that is not on any roster', () => {
    // A god/admin tapping the button, or a player removed from the roster
    // after logging. Nothing to attribute it to, so it is dropped.
    const data = { ...GAME_DATA, drinkCounts: { uid_ghost: { beer: 99 }, uid_ccc: { beer: 1 } } };
    const board = DrinkCounter.buildDrinkLeaderboard(data);
    assert.deepStrictEqual(board.map(r => r.name), ['Inffi']);
});

// ---------- buildDrinkPerformanceReport ----------

test('buildDrinkPerformanceReport pairs drinks with completed-match record', () => {
    const report = DrinkCounter.buildDrinkPerformanceReport(GAME_DATA);
    const wustra = report.find(r => r.name === 'Wustra');

    assert.strictEqual(wustra.drinks, 7);
    assert.strictEqual(wustra.played, 2, 'the ongoing match must not count as played');
    assert.strictEqual(wustra.wons, 1, 'won m1 (winnerIndex 0), lost m2 (winnerIndex 1)');
    assert.strictEqual(wustra.winRate, 50);
});

test('buildDrinkPerformanceReport includes players who logged nothing', () => {
    // The report is the whole roster — "drank nothing and won everything" is
    // exactly the kind of row that makes the correlation readable.
    const data = { ...GAME_DATA, drinkCounts: {} };
    const report = DrinkCounter.buildDrinkPerformanceReport(data);
    assert.strictEqual(report.length, 3);
    assert.ok(report.every(r => r.drinks === 0));
});

test('buildDrinkPerformanceReport gives a player with no completed matches a null win rate', () => {
    const data = { ...GAME_DATA, gameQueue: [] };
    const report = DrinkCounter.buildDrinkPerformanceReport(data);
    assert.ok(report.every(r => r.played === 0));
    assert.ok(report.every(r => r.winRate === null), 'no matches played means no win rate, not 0%');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "BoardGame/dev/tests/drink-counter.test.js"`
Expected: FAIL — `Cannot find module '../../shared/scripts/drink-counter.js'`

- [ ] **Step 3: Implement the module**

Create `BoardGame/shared/scripts/drink-counter.js`:

```js
/**
 * DrinkCounter — pure derivations for the LAN drink counter.
 *
 * Counts live in a `drinkCounts` map on the tournament document, keyed by
 * Firebase Auth uid, mirroring the shape and write path of `lobbyReady`:
 *
 *   drinkCounts: {
 *     "<uid>": { soft: 3, beer: 2, name: "Wustra", teamId: 1, updatedAt: "<iso>" }
 *   }
 *
 * `name` and `teamId` are written for debuggability only. Everything
 * displayed resolves through the live roster instead, so a rename or a
 * roster swap never leaves a stale name on the big screen.
 *
 * DELIBERATELY DRINK-GENERIC. Two types — a soft drink and a beer — summed
 * into one total. Not an alcohol tracker (2026-08-05 developer note), and it
 * never reads or writes anything scoring-related.
 *
 * Pure: no DOM, no Firestore, no globals. Tested in
 * dev/tests/drink-counter.test.js.
 */

const DRINK_TYPES = [
    { id: 'soft', label: 'Soft drink', icon: '🥤' },
    { id: 'beer', label: 'Beer', icon: '🍺' }
];

/**
 * Total drinks in one drinkCounts entry, across every type.
 * @param {Object|undefined} entry
 * @returns {number}
 */
function totalFor(entry) {
    if (!entry) return 0;
    return DRINK_TYPES.reduce((sum, type) => sum + (Number(entry[type.id]) || 0), 0);
}

/**
 * Build a uid -> {name, color, teamName} map from the live roster.
 * @param {Object|null} gameData
 * @returns {Map<string, {name: string, color: string, teamName: string}>}
 */
function _rosterByUid(gameData) {
    const map = new Map();
    (gameData?.teams || []).forEach(team => {
        (team.players || []).forEach(player => {
            if (player.uid) {
                map.set(player.uid, {
                    name: player.name || 'Player',
                    color: team.color || '#c8b37e',
                    teamName: team.name || `Team ${team.id}`
                });
            }
        });
    });
    return map;
}

/**
 * Who has logged the most drinks? Highest first.
 *
 * Players with nothing logged are omitted — this is the break-screen "top
 * drinkers" list, and a tail of zeroes says nothing. (The statistics report
 * keeps them; see buildDrinkPerformanceReport.)
 *
 * @param {Object|null} gameData
 * @param {number} [limit] - omit for the whole list
 * @returns {Array<{uid: string, name: string, color: string, teamName: string, total: number}>}
 */
function buildDrinkLeaderboard(gameData, limit) {
    const roster = _rosterByUid(gameData);
    const counts = gameData?.drinkCounts || {};

    const rows = Object.keys(counts)
        .filter(uid => roster.has(uid))
        .map(uid => ({ uid, ...roster.get(uid), total: totalFor(counts[uid]) }))
        .filter(row => row.total > 0)
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return limit ? rows.slice(0, limit) : rows;
}

/**
 * Drinks against match record, for the post-tournament report.
 *
 * Counts every COMPLETED queue entry a player appears in — challenge matches
 * and split-format matches included. That is intentionally looser than the
 * scoring rules in docs/architecture/scoring.md, which exclude some of those
 * from points. This is a fun stat, not a standings table, and it must never
 * be read as one.
 *
 * The whole roster is included, drinkers or not: "logged nothing, won
 * everything" is a row worth seeing.
 *
 * @param {Object|null} gameData
 * @returns {Array<{uid, name, color, teamName, drinks, played, wons, winRate}>}
 *          sorted by drinks descending; winRate is a 0-100 number, or null
 *          when the player has no completed matches.
 */
function buildDrinkPerformanceReport(gameData) {
    const roster = _rosterByUid(gameData);
    const counts = gameData?.drinkCounts || {};
    const registry = gameData?.players || {};

    const record = new Map(); // uid -> { played, wons }
    (gameData?.gameQueue || []).forEach(match => {
        if (match.status !== 'completed') return;
        (match.teams || []).forEach((side, sideIndex) => {
            (side.playerIds || []).forEach(playerId => {
                const uid = registry[playerId]?.uid;
                if (!uid || !roster.has(uid)) return;
                const current = record.get(uid) || { played: 0, wons: 0 };
                current.played += 1;
                if (sideIndex === match.winnerIndex) current.wons += 1;
                record.set(uid, current);
            });
        });
    });

    return [...roster.entries()]
        .map(([uid, info]) => {
            const { played = 0, wons = 0 } = record.get(uid) || {};
            return {
                uid,
                ...info,
                drinks: totalFor(counts[uid]),
                played,
                wons,
                winRate: played > 0 ? Math.round((wons / played) * 100) : null
            };
        })
        .sort((a, b) => b.drinks - a.drinks || a.name.localeCompare(b.name));
}

const DrinkCounter = { DRINK_TYPES, totalFor, buildDrinkLeaderboard, buildDrinkPerformanceReport };

if (typeof window !== 'undefined') {
    window.DrinkCounter = DrinkCounter;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DrinkCounter;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "BoardGame/dev/tests/drink-counter.test.js"`
Expected: `# pass 11`, `# fail 0`

- [ ] **Step 5: Confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: `# pass 176`, `# fail 0` (165 before + 11 new)

- [ ] **Step 6: Commit**

```bash
git add BoardGame/shared/scripts/drink-counter.js BoardGame/dev/tests/drink-counter.test.js
git commit -m "feat: pure drink-counter derivations (totals, leaderboard, win correlation)"
```

---

## Task 2: Allow the write in the Firestore rules

Without this, Task 3's button fails with `permission-denied` and nothing else in this plan can be verified.

> **This file is gitignored and cannot be committed.** The change lives only on the machine that makes it, plus whatever is deployed. Anyone else running this plan repeats this task locally.

**Files:**
- Modify: `BoardGame/firestore.rules` (the `isPlayerGameplayUpdate()` function, around line 123) — **local only, not committed**

- [ ] **Step 1: Confirm which ruleset is actually deployed**

Open the Firebase console → Firestore → Rules for project `boardgame-7b9f0`.

Expected: the full ~269-line ruleset with role tiers and per-collection checks. If instead you see the 15-line permissive `firestore.rules.temp` content (`allow read, write: if request.auth != null` on `/{document=**}`), **stop and flag it** — under those rules every write succeeds regardless, so Step 4's verification proves nothing and the whole role model is bypassable. This is a known standing pre-LAN check owned by Lassi.

Do not delete `firestore.rules.temp` — it is kept on purpose as a reminder for final-step security work.

- [ ] **Step 2: Add the field to the whitelist**

In `BoardGame/firestore.rules`, find `isPlayerGameplayUpdate()` and add `'drinkCounts'` to the `hasOnly` list:

```
      function isPlayerGameplayUpdate() {
        return isAuthenticated() && !isAnonymous()
          && resource.data.status != 'archived'
          && request.resource.data.diff(resource.data).affectedKeys()
               .hasOnly(['lobbyReady', 'gameQueue', 'selectedGames',
                         'spellPiles', 'spellPhase', 'spellHistory',
                         'activeEffects', 'teams', 'drinkCounts', 'lastModified']);
      }
```

Field-level granularity is the limit of what Firestore rules can express here — the same as for `lobbyReady`, any signed-in player can write *any* uid's entry, and per-player ownership is enforced client-side. That is an accepted property of the existing design, and for a fun counter the stakes are low. Do not try to tighten it here; that would mean restructuring `drinkCounts` into a subcollection, which buys nothing for this feature.

- [ ] **Step 3: Deploy**

Run: `firebase deploy --only firestore:rules`
Expected: `+ firestore: released rules firestore.rules to cloud.firestore`

- [ ] **Step 4: Verify the rule actually landed**

Open any page signed in as a real (non-anonymous) player and run in the browser console, substituting a real tournament id:

```js
await firebase.firestore().collection('tournaments').doc('<real-id>')
  .update({ 'drinkCounts.__ruletest.beer': 1 });
```

Expected: resolves without throwing. If it throws `permission-denied`, the deploy did not take — re-check Step 2 and redeploy.

Then clean up the probe:

```js
await firebase.firestore().collection('tournaments').doc('<real-id>')
  .update({ 'drinkCounts.__ruletest': firebase.firestore.FieldValue.delete() });
```

- [ ] **Step 5: Record it — there is nothing to commit**

No `git add`. Instead, note in `TODO.md` that `drinkCounts` must be in the player-writable whitelist of any future `firestore.rules` rebuild, since the file itself is gitignored and this change is invisible to the repo.

---

## Task 3: The button on team.html

**Files:**
- Modify: `BoardGame/full/team.html` (section markup ~line 113, before `spellCardsSection`; script tag ~line 262)
- Modify: `BoardGame/full/scripts/team-controls.js` (render function; `logDrink()`; snapshot wiring at line 149-160)

- [ ] **Step 1: Add the script tag**

In `BoardGame/full/team.html`, add the module before `team-controls.js` (line 265), next to the other shared scripts:

```html
    <script defer src="../shared/scripts/chat-module.js"></script>
    <script defer src="../shared/scripts/drink-counter.js"></script>
```

- [ ] **Step 2: Add the section markup**

In `BoardGame/full/team.html`, insert this immediately **before** the `spellCardsSection` div (line 113):

```html
                <div class="team-section" id="drinkCounterSection">
                    <div class="team-section-header">Drinks</div>
                    <div id="drinkCounterBody"></div>
                </div>
```

- [ ] **Step 3: Add the renderer and the write path**

In `BoardGame/full/scripts/team-controls.js`, append these two functions at the end of the file:

```js
// =============================================================================
// DRINK COUNTER
// =============================================================================
// A fun, non-competitive tally: tap a button, a count goes up. Deliberately
// drink-generic (soft drink / beer), never alcohol-specific, and completely
// separate from scoring -- see docs/superpowers/plans/2026-08-05-drink-counter.md.

/**
 * Render the current player's own counters plus their running total.
 * Called from the same snapshot callback as every other team.html renderer,
 * so the numbers update live as teammates log their own.
 */
function renderDrinkCounter() {
    const container = document.getElementById('drinkCounterBody');
    if (!container || !currentUser) return;

    const entry = (gameData?.drinkCounts || {})[currentUser.uid] || {};
    const total = window.DrinkCounter.totalFor(entry);

    const buttonsHTML = window.DrinkCounter.DRINK_TYPES.map(type => `
        <button class="btn drink-btn" onclick="logDrink('${type.id}')">
            <span class="drink-btn-icon">${type.icon}</span>
            <span class="drink-btn-label">${type.label}</span>
            <span class="drink-btn-count">${Number(entry[type.id]) || 0}</span>
        </button>
    `).join('');

    container.innerHTML = `
        <div class="drink-btn-row">${buttonsHTML}</div>
        <div class="drink-total">Your total: <strong>${total}</strong></div>
    `;
}

/**
 * Log one drink for the signed-in player.
 *
 * Uses FieldValue.increment so two taps from two devices (or a double-tap
 * over a slow connection) can never clobber each other the way a
 * read-modify-write would.
 *
 * Requires 'drinkCounts' in isPlayerGameplayUpdate()'s whitelist in
 * firestore.rules -- that file is gitignored, so if this starts failing with
 * permission-denied on a fresh machine, that is why.
 *
 * @param {string} typeId - a DRINK_TYPES id ('soft' | 'beer')
 */
async function logDrink(typeId) {
    if (!currentUser || !currentTournamentId) return;
    if (!window.DrinkCounter.DRINK_TYPES.some(t => t.id === typeId)) {
        console.warn(`[Team Controls] logDrink('${typeId}') ignored — unknown drink type`);
        return;
    }

    try {
        const db = firebase.firestore();
        const uid = currentUser.uid;

        await db.collection('tournaments').doc(currentTournamentId).update({
            [`drinkCounts.${uid}.${typeId}`]: firebase.firestore.FieldValue.increment(1),
            [`drinkCounts.${uid}.name`]: _nickForUid(uid, currentUser.displayName),
            [`drinkCounts.${uid}.teamId`]: currentTeamId,
            [`drinkCounts.${uid}.updatedAt`]: new Date().toISOString()
        });

        console.log(`[Team Controls] Logged a ${typeId}`);
    } catch (error) {
        console.error('[Team Controls] Error logging drink:', error);
        // Surface it rather than letting the button look merely unresponsive.
        // A quota wall (429 resource-exhausted) reads exactly like a dead
        // button otherwise.
        showStatus('Could not log that drink: ' + error.message, 'error');
    }
}
```

- [ ] **Step 4: Call the renderer on every snapshot**

In `BoardGame/full/scripts/team-controls.js`, add `renderDrinkCounter();` to the render block at lines 149-160, after `renderSpellCards();`:

```js
                renderScoreStrip();
                renderPhaseBanner();
                renderTeammates();
                renderSpellCards();
                renderDrinkCounter();
                renderActiveConditions();
```

- [ ] **Step 5: Add the styles**

In `BoardGame/full/css/team-modern.css`, append:

```css
/* Drink counter — a fun, non-competitive tally. Big tap targets: this gets
   used one-handed, on a phone, at a LAN party. */
.drink-btn-row { display: flex; gap: 12px; flex-wrap: wrap; }
.drink-btn {
    flex: 1 1 140px; display: flex; flex-direction: column; align-items: center;
    gap: 4px; padding: 16px 12px; min-height: 88px;
}
.drink-btn-icon { font-size: 28px; line-height: 1; }
.drink-btn-label { font-size: 13px; opacity: 0.8; }
.drink-btn-count { font-size: 22px; font-weight: 700; }
.drink-total { margin-top: 12px; text-align: center; opacity: 0.8; }
```

- [ ] **Step 6: Verify it parses**

Run: `node --check BoardGame/full/scripts/team-controls.js`
Expected: no output (exit 0)

- [ ] **Step 7: Try it for real**

Serve the pages and open `team.html` signed in as a real player on a real tournament:

```bash
cd BoardGame
node -e "require('./dev/tests/e2e-server').startServer(process.cwd(), 8080).then(() => console.log('serving on 8080'))"
```

Open `http://localhost:8080/full/team.html?tournamentId=<real-id>&teamId=<your-team>`.

Check all four:
1. The Drinks section renders with two buttons, both showing `0`.
2. Tapping **Beer** increments its count within a second (the snapshot round-trips and re-renders).
3. Reloading the page keeps the count.
4. The browser console shows no `permission-denied`. If it does, Task 2 did not take.

- [ ] **Step 8: Commit**

```bash
git add BoardGame/full/team.html BoardGame/full/scripts/team-controls.js BoardGame/full/css/team-modern.css
git commit -m "feat: per-player drink counter on team.html"
```

---

## Task 4: Break-screen leaderboard

Item 7's note asks for these stats "maybe when a break is occurring" — which is exactly where the break screen already has empty room. `_renderBreakScreen()` currently shows an icon, a title and a subtitle on an otherwise blank 1920×1080.

**Files:**
- Modify: `BoardGame/full/scripts/display-manager.js:1402-1411` (`_renderBreakScreen`)
- Modify: `BoardGame/full/view.html` (script tag ~line 2039; CSS in the main `<style>` block)

- [ ] **Step 1: Add the script tag**

In `BoardGame/full/view.html`, next to the other shared scripts (around line 2037):

```html
    <script defer src="../shared/scripts/player-utils.js"></script>
    <script defer src="../shared/scripts/drink-counter.js"></script>
```

- [ ] **Step 2: Render the leaderboard on the break screen**

Replace `_renderBreakScreen()` (`display-manager.js:1402-1411`) with:

```js
    _renderBreakScreen(container, data) {
        const auto = data.currentPhase?.autoInserted;

        // Fun stat, break-only: who has logged the most drinks. Purely
        // display -- drinkCounts has nothing to do with standings or points
        // (see docs/superpowers/plans/2026-08-05-drink-counter.md). Renders
        // nothing at all until someone has actually logged something, so an
        // early-tournament break stays clean.
        const leaders = window.DrinkCounter
            ? window.DrinkCounter.buildDrinkLeaderboard(data, 5)
            : [];

        const leaderboardHTML = leaders.length > 0 ? `
            <div class="dm-drink-board">
                <div class="dm-drink-title">Most Drinks</div>
                ${leaders.map((row, i) => `
                    <div class="dm-drink-row">
                        <span class="dm-drink-rank">${i + 1}</span>
                        <span class="dm-drink-name" style="color:${row.color};">${row.name}</span>
                        <span class="dm-drink-total">${row.total}</span>
                    </div>
                `).join('')}
            </div>` : '';

        container.innerHTML = `
            <div class="dm-break-screen">
                <div class="dm-break-icon">${ICON_SVGS.pause}</div>
                <div class="dm-break-title">On Break</div>
                <div class="dm-break-subtitle">${auto ? 'Scheduled break — ' : ''}The tournament resumes shortly</div>
                ${leaderboardHTML}
            </div>
        `;
    }
```

- [ ] **Step 3: Add the styles**

In `BoardGame/full/view.html`, append to the `<style>` block, next to the other `.dm-` rules:

```css
        /* Break-screen drink leaderboard — a fun stat, deliberately styled
           apart from the standings so nobody reads it as tournament points. */
        .dm-drink-board {
            margin-top: 56px; width: 720px;
            background: var(--bg-glass); border-radius: 16px; padding: 32px 40px;
        }
        .dm-drink-title {
            font-family: 'Russo One', sans-serif; font-size: 34px;
            color: var(--gold-bright); text-transform: uppercase;
            letter-spacing: 2px; text-align: center; margin-bottom: 24px;
        }
        .dm-drink-row {
            display: flex; align-items: center; gap: 20px;
            padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .dm-drink-row:last-child { border-bottom: none; }
        .dm-drink-rank {
            font-family: 'Russo One', sans-serif; font-size: 28px;
            color: var(--text-muted); width: 44px;
        }
        .dm-drink-name {
            font-family: 'Quantico', sans-serif; font-size: 32px; font-weight: 700;
            flex: 1; overflow-wrap: anywhere;
        }
        .dm-drink-total {
            font-family: 'Russo One', sans-serif; font-size: 32px; color: var(--gold);
        }
```

- [ ] **Step 4: Verify it parses and nothing regressed**

Run: `node --check BoardGame/full/scripts/display-manager.js && node --test "BoardGame/dev/tests/*.test.js"`
Expected: no parse output, then `# pass 176`, `# fail 0`

- [ ] **Step 5: Eyeball both states in the preview harness**

Open `BoardGame/dev/view-preview.html` and select **"On Break (manual)"**.

Expected: the break screen as before, with **no** leaderboard — the preview's synthetic data has no `drinkCounts`, and the empty state must render nothing rather than an empty box.

Then, in the iframe console:

```js
const f = document.getElementById('previewFrame').contentWindow;
f.__devPreviewSnapshot(Object.assign({}, f.__devLastPreviewData, {
  drinkCounts: { uid_t1a: { beer: 5, soft: 2 }, uid_t2a: { beer: 3 } }
}));
```

(uids must match the preview roster — check `view-preview.html`'s player builder around line 107 for the ids it generates.)

Expected: a "Most Drinks" board appears under the break subtitle, names in team colours, highest first.

- [ ] **Step 6: Commit**

```bash
git add BoardGame/full/scripts/display-manager.js BoardGame/full/view.html
git commit -m "feat: most-drinks leaderboard on the break screen"
```

---

## Task 5: Puppeteer check for the leaderboard

**Files:**
- Create: `BoardGame/dev/tests/e2e-view-drink-leaderboard.js`

- [ ] **Step 1: Write the test script**

Create `BoardGame/dev/tests/e2e-view-drink-leaderboard.js`:

```js
/**
 * Visual check for the break-screen drink leaderboard on view.html.
 *
 * Two things matter: it ranks correctly in team colours, and it renders
 * NOTHING when nobody has logged a drink (an empty box on the big screen
 * during an early break would look broken).
 *
 * Drives window.__devPreviewSnapshot -- no login, no Firestore.
 * Run: cd BoardGame && node dev/tests/e2e-view-drink-leaderboard.js [--headed]
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server');
const { assert, sleep, screenshot, VIEWPORT } = require('./e2e-harness');

const PORT = 8087;

function breakData(drinkCounts) {
    return {
        name: 'drink-test',
        teams: [
            {
                id: 1, name: 'Tiimi 1', color: '#de392c', points: 0,
                players: [{ id: 'p_t1a', uid: 'uid_t1a', name: 'Wustra' }]
            },
            {
                id: 2, name: 'Tiimi 2', color: '#2278a3', points: 0,
                players: [{ id: 'p_t2a', uid: 'uid_t2a', name: 'Touch' }]
            }
        ],
        players: {
            p_t1a: { uid: 'uid_t1a', name: 'Wustra', teamId: 1 },
            p_t2a: { uid: 'uid_t2a', name: 'Touch', teamId: 2 }
        },
        board: {}, rooms: {}, lobbyReady: {}, gameQueue: [],
        drinkCounts,
        currentPhase: { name: 'break', roundNumber: 2, autoInserted: false }
    };
}

(async () => {
    const server = await startServer(path.resolve(__dirname, '../..'), PORT);
    const browser = await puppeteer.launch({ headless: !process.argv.includes('--headed') });

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);
        await page.goto(`http://localhost:${PORT}/full/view.html?tournamentId=__dev_preview__`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.__devPreviewSnapshot === 'function', { timeout: 20000 });

        // ============================================================
        // Nobody has logged anything: no board at all
        // ============================================================
        await page.evaluate(d => window.__devPreviewSnapshot(d), breakData({}));
        await sleep(400);

        const empty = await page.evaluate(() => ({
            hasBreakScreen: !!document.querySelector('.dm-break-screen'),
            hasBoard: !!document.querySelector('.dm-drink-board')
        }));
        console.log('--- break, no drinks logged ---', JSON.stringify(empty));

        assert(empty.hasBreakScreen, 'the break screen itself should render');
        assert(!empty.hasBoard, 'with no drinks logged the leaderboard must not render at all');

        await screenshot(page, 'drink-board-empty', 'view-drinks');

        // ============================================================
        // With drinks: ranked, team-coloured
        // ============================================================
        await page.evaluate(
            d => window.__devPreviewSnapshot(d),
            breakData({ uid_t1a: { beer: 2, soft: 1 }, uid_t2a: { beer: 6 } })
        );
        await sleep(400);

        await page.waitForFunction(() => !!document.querySelector('.dm-drink-board'), { timeout: 5000 });

        const board = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.dm-drink-row')];
            return rows.map(row => {
                const name = row.querySelector('.dm-drink-name');
                return {
                    rank: row.querySelector('.dm-drink-rank').textContent.trim(),
                    name: name.textContent.trim(),
                    color: getComputedStyle(name).color,
                    total: row.querySelector('.dm-drink-total').textContent.trim()
                };
            });
        });
        console.log('--- break, with drinks ---', JSON.stringify(board));

        assert(board.length === 2, `expected 2 rows, got ${board.length}`);
        assert(board[0].name === 'Touch', `highest total should rank first, got "${board[0].name}"`);
        assert(board[0].total === '6', `expected 6, got ${board[0].total}`);
        assert(board[1].name === 'Wustra' && board[1].total === '3', 'second row should be Wustra with 2 beer + 1 soft = 3');
        // #2278a3 === rgb(34, 120, 163)
        assert(
            board[0].color === 'rgb(34, 120, 163)',
            `top row should carry team 2's colour rgb(34, 120, 163), got ${board[0].color}`
        );

        await screenshot(page, 'drink-board-populated', 'view-drinks');

        console.log('\nPASS — leaderboard ranks, colours, and stays hidden when empty.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(err => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `cd BoardGame && node dev/tests/e2e-view-drink-leaderboard.js`
Expected: two `---` dumps, then `PASS — leaderboard ranks, colours, and stays hidden when empty.`

- [ ] **Step 3: Commit**

```bash
git add BoardGame/dev/tests/e2e-view-drink-leaderboard.js
git commit -m "test: guard the break-screen drink leaderboard"
```

---

## Task 6: The post-tournament report

The "how it affected their performance" half of item 6's note. A new tab on `statistics.html` — the page that already exists for exactly this kind of after-the-fact look.

**Files:**
- Modify: `BoardGame/full/statistics.html` (tab button ~line 84; tab pane ~line 252; script tag)
- Modify: `BoardGame/full/scripts/statistics.js` (`renderAllStatistics()` at line 346; new renderer)

- [ ] **Step 1: Add the script tag**

In `BoardGame/full/statistics.html`, add the module alongside the other shared scripts, before `statistics.js`:

```html
    <script defer src="../shared/scripts/drink-counter.js"></script>
```

- [ ] **Step 2: Add the tab button**

In `BoardGame/full/statistics.html`, after the "Game Analysis" button (line 84):

```html
            <button class="tab-btn" data-tab="games" onclick="switchTab('games')">Game Analysis</button>
            <button class="tab-btn" data-tab="drinks" onclick="switchTab('drinks')">Drinks</button>
```

- [ ] **Step 3: Add the tab pane**

After the `tab-games` pane closes (around line 252 onward), add:

```html
            <div class="tab-pane" id="tab-drinks">
                <h2>Drinks &amp; Performance</h2>
                <p class="stat-note">
                    A fun stat, not a standings table. Drink counts are self-reported
                    by each player and have no effect on points, hexes, or placement.
                </p>
                <div id="drinkReportTable"></div>
            </div>
```

- [ ] **Step 4: Add the renderer**

In `BoardGame/full/scripts/statistics.js`, append:

```js
// =============================================================================
// DRINKS & PERFORMANCE
// =============================================================================
// Self-reported drink counts against each player's completed-match record.
// Purely a fun after-the-fact read -- see the note in the tab pane, and
// docs/superpowers/plans/2026-08-05-drink-counter.md for why this is kept
// well clear of anything scoring-related.

function renderDrinkReport() {
    const container = document.getElementById('drinkReportTable');
    if (!container || !gameState) return;

    const rows = window.DrinkCounter.buildDrinkPerformanceReport(gameState);

    if (rows.length === 0) {
        container.innerHTML = '<p class="empty-state">No players on the roster yet.</p>';
        return;
    }

    const anyLogged = rows.some(row => row.drinks > 0);
    if (!anyLogged) {
        container.innerHTML = '<p class="empty-state">Nobody logged a drink this tournament.</p>';
        return;
    }

    container.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>Team</th>
                    <th>Drinks</th>
                    <th>Played</th>
                    <th>Won</th>
                    <th>Win rate</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td style="color:${row.color}; font-weight: 600;">${row.name}</td>
                        <td>${row.teamName}</td>
                        <td>${row.drinks}</td>
                        <td>${row.played}</td>
                        <td>${row.wons}</td>
                        <td>${row.winRate === null ? '—' : row.winRate + '%'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}
```

- [ ] **Step 5: Wire it into the render pass**

In `renderAllStatistics()` (`statistics.js:346-362`), add the call after `renderGameAnalysis();`:

```js
    renderMatches();
    renderHeadToHead();
    renderGameAnalysis();
    renderDrinkReport();
```

- [ ] **Step 6: Verify**

Run: `node --check BoardGame/full/scripts/statistics.js`
Expected: no output (exit 0)

Then open `http://localhost:8080/full/statistics.html?tournamentId=<real-id>` (with the server from Task 3 Step 7 running) and click the **Drinks** tab.

Expected on a tournament where somebody logged drinks: a table sorted by drinks descending, names in team colours, a `—` in the win-rate column for anyone with no completed matches.
Expected on a tournament where nobody did: "Nobody logged a drink this tournament." — not an empty table, not a crash.

- [ ] **Step 7: Commit**

```bash
git add BoardGame/full/statistics.html BoardGame/full/scripts/statistics.js
git commit -m "feat: drinks-and-performance report on the statistics page"
```

---

## Task 7: Decide who can see the report

Deferred deliberately from the earlier discussion, and it needs a person, not a subagent.

The report correlates a named individual's self-reported drinking with their competitive performance. Everything else in this plan is either private to the player (their own counter) or aggregate and playful (a top-5 board during a break). This table is neither: it is per-person, permanent, and sits on a page that anyone with the tournament link can open.

**Files:**
- Modify (only if the answer is "restrict"): `BoardGame/full/statistics.html`, `BoardGame/full/scripts/statistics.js`

- [ ] **Step 1: Ask**

Put the question to whoever owns the event: should the Drinks tab be visible to everyone who can open `statistics.html`, or only to admin/god sessions?

There is no default worth guessing at here. It is a social call about a real group of named people, and it costs one question.

- [ ] **Step 2: If "everyone", do nothing**

Task 6 already ships that. Note the decision in the source notes file and move on.

- [ ] **Step 3: If "restrict", gate the tab**

`statistics.js` does not currently do role checks, so this means reading the signed-in user's role the way other pages do (`users/{uid}.role`) and hiding both the tab button and the pane unless the role is admin or god. Hide the button — do not merely skip rendering the table, or the empty tab still advertises that the data exists.

- [ ] **Step 4: Commit if anything changed**

```bash
git add BoardGame/full/statistics.html BoardGame/full/scripts/statistics.js
git commit -m "feat: restrict the drinks report to admin/god sessions"
```

---

## Self-Review

**Spec coverage.** Item 6's "simple button a player can press" → Task 3. "Pepsi or coke can, generic beer icon, not alcohol specific" → `DRINK_TYPES` in Task 1, two generic types summed into one total, no spirits anywhere. "Report after the tournament of how many drinks a player drank and how it affected their performance" → Tasks 1 and 6. Item 7's "show these drink statistics maybe when a break is occurring" → Tasks 4 and 5.

**Naming consistency.** `DrinkCounter.totalFor()`, `.buildDrinkLeaderboard()`, `.buildDrinkPerformanceReport()`, `.DRINK_TYPES` are defined in Task 1 and called with those exact names in Tasks 3, 4 and 6. The report's per-row fields (`drinks`, `played`, `wons`, `winRate`, `color`, `teamName`) are produced in Task 1 and consumed in Task 6 unchanged. CSS classes `dm-drink-board`, `dm-drink-row`, `dm-drink-rank`, `dm-drink-name`, `dm-drink-total` are emitted in Task 4 and asserted in Task 5.

**Two things a reviewer should push on.**

*The report counts matches more loosely than scoring does.* `buildDrinkPerformanceReport()` counts every completed queue entry a player appears in, including challenge and split-format matches that `scoring.md` excludes from points. That is intentional — it is a fun stat, and matching the real scoring rules would mean duplicating logic that lives in `confirmResult()` and inevitably drifting from it. But it does mean a player's "won" here will not always equal their contribution to the standings. The tab's own note says as much; if that is not enough separation, the fix is to rename the columns, not to import scoring logic.

*Task 2 cannot be verified if the wrong ruleset is live.* Under `firestore.rules.temp`'s permissive rules every write succeeds, so a green result in Task 2 Step 4 does not prove the whitelist edit landed. Step 1 exists to catch that, and it is the one step in this plan that must not be skipped on the grounds that "the write worked".
