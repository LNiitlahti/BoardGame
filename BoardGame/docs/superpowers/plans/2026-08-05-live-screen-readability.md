# Live-Screen Readability & Match Spotlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player names on `view.html`'s live match screen readable from across a LAN room, and let a single active match slot expand to fill the screen instead of always sitting in a 50/50 split.

**Architecture:** `view.html` is a fixed 1920×1080 design canvas scaled to the display by a CSS `transform` on `<body>` (`view.html:2020-2028`) — every px value in its CSS is in that 1920-wide design space, so "make it bigger" is a pure CSS-number change, not responsive work. The `matches_in_progress` phase renders through `DisplayManager._renderMatchesDualSlot()`, which unconditionally emits two equal panels. This plan adds one pure layout-decision helper (`_dualSlotLayout()`), uses its result to stamp modifier classes on the wrapper and panels, and drives all the size changes from CSS on those classes. No data-flow changes.

**Tech Stack:** Vanilla JS (no build step), `node:test` for the pure helper, Puppeteer + the existing `dev/tests/e2e-server.js` static server for the visual regression check, `dev/view-preview.html` for manual QA.

**Source:** [`../../notes/2026-08-05-discord-feature-requests.md`](../../notes/2026-08-05-discord-feature-requests.md) items 1 and 3. Item 1's developer note asks explicitly to "confirm on big screen, iterate if necessary" — Task 5 is that loop and is not optional.

---

## Background an engineer needs before touching this

**Three different slides can render player names.** Only one of them is on screen during a normal match:

| Slide | Used by | Name size today |
|---|---|---|
| `matches_dual_slot` | `matches_in_progress` — **the live path** | 24px (`.dm-dual-ready-name`) |
| `live_matches_large` | `challenge_game` only | 44px (`.dm-live-match-large .dm-player-name`) |
| `results_large` | `scoring_vp`, `round_advance` | 15px (`.dm-results-large .dm-dual-ready-name`) |

This plan changes **only the first**. The 44px challenge slide is already fine. The 15px results override at `view.html:1870` is a more-specific selector that deliberately shrinks the same class for a dense results list — it must keep winning, so do not touch it and do not raise base sizes expecting it to follow.

**Slot sub-states.** `data.currentPhase.slots` is `{1: 'setup'|'lobby'|'playing'|'done', 2: ...}`. A `done` slot deliberately keeps rendering its winner (`_renderMatchResult`) instead of collapsing — that behaviour stays. "Expand" means: when exactly one slot is still non-`done`, that slot gets the space.

**Firestore key coercion.** `slots` comes back from Firestore with string keys. `slots[1]` works anyway (JS coerces the number to `'1'`), which is what the existing code at `display-manager.js:1542` already relies on. Keep that idiom.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `BoardGame/dev/tests/display-manager-dual-slot-layout.test.js` | Unit tests for the pure layout helper |
| `BoardGame/dev/tests/e2e-view-dual-slot-layout.js` | Puppeteer visual regression: name size + focus-panel width |

**Modify:**

| File | Change |
|---|---|
| `BoardGame/full/scripts/display-manager.js` | Add `_dualSlotLayout()`; stamp modifier classes in `_renderMatchesDualSlot()` |
| `BoardGame/full/view.html` | Readability size bump + focus-mode CSS |

**Test commands:**
- Unit: `node --test "BoardGame/dev/tests/*.test.js"` — **165 passing as of 2026-08-05**; this plan adds 6, for 171. (If a sibling plan from the same triage batch — the chat overlay or the drink counter — was executed first, the baseline is higher by that plan's additions. Take the number you measure before starting as the baseline.)
- Visual: `cd BoardGame && node dev/tests/e2e-view-dual-slot-layout.js`
- Manual: open `BoardGame/dev/view-preview.html` in a browser, use the `matches_in_progress` scenarios.

---

## Task 1: Pure `_dualSlotLayout()` helper

The decision "should one panel take the whole width?" is a pure function of the slots map. Extracting it means the layout rule is unit-tested without a browser, matching how `_matchBelongsToSlot()` is already tested in `display-manager-slot-requirements.test.js`.

**Files:**
- Modify: `BoardGame/full/scripts/display-manager.js` (add method next to `_renderMatchesDualSlot`, ~line 1535)
- Test: `BoardGame/dev/tests/display-manager-dual-slot-layout.test.js`

- [ ] **Step 1: Write the failing test**

Create `BoardGame/dev/tests/display-manager-dual-slot-layout.test.js`:

```js
/**
 * Coverage for display-manager.js's _dualSlotLayout(), which decides whether
 * view.html's matches_in_progress screen shows two equal match panels or
 * expands one of them to fill the display.
 *
 * The rule: a slot is "active" while its sub-state is anything other than
 * 'done'. Exactly one active slot => focus mode (that slot takes the room,
 * the finished one shrinks to a results column). Zero or two => the normal
 * 50/50 dual layout.
 *
 * Requested by Inffi in the 2026-08-05 Discord thread: "when a match is
 * queued up to be played live, it should expand to take up as much of the
 * screen as possible."
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/display-manager.js');
const DisplayManager = global.window.DisplayManager;

function makeDisplayManager() {
    return new DisplayManager({ container: null, boardModule: null, boardRenderer: null });
}

test('both slots live => dual layout, no focus', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'playing', 2: 'lobby' }),
        { mode: 'dual', focusSlot: null }
    );
});

test('slot 1 done while slot 2 plays => slot 2 gets focus', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'done', 2: 'playing' }),
        { mode: 'focus', focusSlot: 2 }
    );
});

test('slot 2 done while slot 1 is still in setup => slot 1 gets focus', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'setup', 2: 'done' }),
        { mode: 'focus', focusSlot: 1 }
    );
});

test('both slots done => dual layout (two results columns, neither is "live")', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'done', 2: 'done' }),
        { mode: 'dual', focusSlot: null }
    );
});

test('missing slots map defaults both slots to setup => dual layout, no crash', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout(undefined),
        { mode: 'dual', focusSlot: null }
    );
});

test('Firestore string keys behave the same as numeric ones', () => {
    const dm = makeDisplayManager();
    // Firestore hands back {'1': 'done', '2': 'playing'}; the lookup must
    // not care which form it got.
    assert.deepStrictEqual(
        dm._dualSlotLayout({ '1': 'done', '2': 'playing' }),
        { mode: 'focus', focusSlot: 2 }
    );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "BoardGame/dev/tests/display-manager-dual-slot-layout.test.js"`
Expected: all 6 FAIL with `TypeError: dm._dualSlotLayout is not a function`

- [ ] **Step 3: Implement the helper**

In `BoardGame/full/scripts/display-manager.js`, insert this method immediately **before** `_renderMatchesDualSlot()` (currently at line 1535, right after its doc comment block ends):

```js
    /**
     * Should one match panel expand to fill the screen?
     *
     * A slot stays "active" until it reaches 'done'. With exactly one active
     * slot there is nothing to share the width with — the finished slot only
     * needs enough room for its winner column — so the active one takes the
     * room. With two active (or two finished) slots the even 50/50 split is
     * still correct.
     *
     * Pure: depends only on its argument. Tested in
     * dev/tests/display-manager-dual-slot-layout.test.js.
     *
     * @param {Object|undefined} slots - currentPhase.slots, keys 1/2 (string
     *        or number — Firestore returns strings), values setup|lobby|
     *        playing|done
     * @returns {{mode: 'dual'|'focus', focusSlot: 1|2|null}}
     */
    _dualSlotLayout(slots) {
        const stateOf = slot => (slots && slots[slot]) || 'setup';
        const active = [1, 2].filter(slot => stateOf(slot) !== 'done');
        if (active.length === 1) {
            return { mode: 'focus', focusSlot: active[0] };
        }
        return { mode: 'dual', focusSlot: null };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "BoardGame/dev/tests/display-manager-dual-slot-layout.test.js"`
Expected: `# pass 6`, `# fail 0`

- [ ] **Step 5: Confirm no regression in the sibling suite**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: `# pass 171`, `# fail 0` (165 before + 6 new)

- [ ] **Step 6: Commit**

```bash
git add BoardGame/full/scripts/display-manager.js BoardGame/dev/tests/display-manager-dual-slot-layout.test.js
git commit -m "feat: pure layout helper deciding when one match slot takes the screen"
```

---

## Task 2: Stamp the layout onto the rendered markup

The helper decides; this task makes the DOM reflect it. No sizes change yet — this task is pure plumbing, so a CSS mistake in Task 3 can't be confused with a wiring mistake here.

**Files:**
- Modify: `BoardGame/full/scripts/display-manager.js:1535-1581` (`_renderMatchesDualSlot`)

- [ ] **Step 1: Add the modifier classes**

Replace the body of `_renderMatchesDualSlot()` (`display-manager.js:1535-1581`) with this. Two changes only: `layout` is computed up front, and the two `class="..."` attributes gain conditional modifiers.

```js
    _renderMatchesDualSlot(container, data) {
        const currentRoundNumber = data.currentPhase?.roundNumber;
        const phaseStartedAt = data.currentPhase?.startedAt;
        const slots = data.currentPhase?.slots || {};
        const queue = data.gameQueue || [];
        const layout = this._dualSlotLayout(slots);

        const panelHTML = [1, 2].map(slot => {
            const sub = slots[slot] || 'setup';
            const subLabel = { setup: 'Setup', lobby: 'Lobby', playing: 'Live', done: 'Done' }[sub] || sub;

            const slotMatches = m => this._matchBelongsToSlot(m, slot, currentRoundNumber, phaseStartedAt);
            const ongoing = queue.filter(m => m.status === 'ongoing' && slotMatches(m));
            const pending = queue.filter(m => (m.status === 'pending' || m.status === undefined) && slotMatches(m));
            const active = [...ongoing, ...pending];

            let bodyHTML = '';

            if (sub === 'done') {
                // Keep showing who won this slot's match(es) instead of
                // collapsing to a bare "Complete" label -- stays visible
                // through the whole matches_in_progress phase, including
                // while the OTHER slot is still playing, until the admin
                // advances past this phase entirely.
                const completed = queue.filter(m => m.status === 'completed' && slotMatches(m));
                bodyHTML = completed.length > 0
                    ? completed.map(m => this._renderMatchResult(m)).join('')
                    : `<div class="dm-dual-slot-status">Complete</div>`;
            } else if (active.length > 0) {
                bodyHTML = active.map(m => this._renderMatchGroup(m, data)).join('');
            } else if (sub === 'lobby') {
                bodyHTML = `<div class="dm-dual-slot-status">Waiting for players...</div>`;
            } else {
                bodyHTML = `<div class="dm-dual-slot-status">No match queued yet</div>`;
            }

            // In focus mode the one active slot takes the room and the
            // finished slot shrinks to a narrow winner column. In dual mode
            // neither modifier is applied and the panels stay even.
            let panelModifier = '';
            if (layout.mode === 'focus') {
                panelModifier = layout.focusSlot === slot
                    ? ' dm-dual-slot-panel--focus'
                    : ' dm-dual-slot-panel--minor';
            }

            return `
                <div class="dm-dual-slot-panel${panelModifier}">
                    <div class="dm-dual-slot-header">
                        <span class="dm-dual-slot-title">Match ${slot}</span>
                        <span class="dm-dual-slot-badge dm-dual-slot-badge--${sub}">${subLabel}</span>
                    </div>
                    ${bodyHTML}
                </div>`;
        }).join('');

        const wrapModifier = layout.mode === 'focus' ? ' dm-matches-dual--focus' : '';
        container.innerHTML = `<div class="dm-matches-dual${wrapModifier}">${panelHTML}</div>`;
    }
```

- [ ] **Step 2: Verify the file still parses**

Run: `node --check BoardGame/full/scripts/display-manager.js`
Expected: no output (exit 0)

- [ ] **Step 3: Confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: `# pass 171`, `# fail 0`

- [ ] **Step 4: Eyeball the classes in the preview harness**

Open `BoardGame/dev/view-preview.html` in a browser. Click the scenario **"Match 1 done, Match 2 playing"**. In devtools, inspect the rendered markup inside the primary slide container.

Expected: the wrapper carries `dm-matches-dual dm-matches-dual--focus`, the Match 2 panel carries `dm-dual-slot-panel--focus`, the Match 1 panel carries `dm-dual-slot-panel--minor`. Nothing looks different yet — no CSS targets these classes until Task 3. That is correct at this point.

Then click **"Match 1 lobby, Match 2 playing"** and confirm the wrapper has **no** `--focus` modifier and neither panel has one.

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/scripts/display-manager.js
git commit -m "feat: stamp focus/minor modifier classes on the dual-slot match panels"
```

---

## Task 3: The readability and expansion CSS

This is the task that actually answers both requests. All edits are inside the single `<style>` block in `BoardGame/full/view.html`.

Remember the design space is 1920×1080 — a 38px font here really is 38px on a 1080p room display.

**Files:**
- Modify: `BoardGame/full/view.html:1643-1700` (the dual-slot CSS block)

- [ ] **Step 1: Raise the base sizes**

In `BoardGame/full/view.html`, replace the existing declarations listed below with the new ones. Each is an in-place edit of a rule that already exists in the `1643-1700` block — do not add duplicates.

`.dm-dual-slot-title` (currently `font-size: 36px`) → `44px`:
```css
        .dm-dual-slot-title {
            font-family: 'Russo One', sans-serif; font-size: 44px;
            color: var(--gold-bright); text-transform: uppercase; letter-spacing: 1px;
        }
```

`.dm-dual-slot-badge` (currently `20px`) → `24px`:
```css
        .dm-dual-slot-badge {
            font-family: 'Quantico', sans-serif; font-size: 24px; font-weight: 700;
            padding: 8px 20px; border-radius: 20px; text-transform: uppercase;
        }
```

`.dm-dual-slot-status` (currently `26px`) → `34px`:
```css
        .dm-dual-slot-status {
            font-family: 'Quantico', sans-serif; font-size: 34px; color: var(--text-muted);
            text-align: center; padding: 32px 0;
        }
```

`.dm-dual-ready-side` (currently `min-width: 220px`) → `300px`:
```css
        .dm-dual-ready-side { display: flex; flex-direction: column; gap: 14px; min-width: 300px; }
```

`.dm-dual-ready-row` — more breathing room around the bigger text:
```css
        .dm-dual-ready-row {
            display: flex; align-items: center; gap: 16px;
            padding: 14px 18px; background: rgba(255,255,255,0.03); border-radius: 8px;
        }
```

`.dm-dual-ready-name` — **the headline change**, 24px → 38px. `overflow-wrap: anywhere` stops a long nickname from bleeding out of the row now that the font is larger:
```css
        .dm-dual-ready-name {
            font-family: 'Quantico', sans-serif; font-size: 38px; font-weight: 700; flex: 1;
            overflow-wrap: anywhere;
        }
```

`.dm-dual-ready-indicator svg` (currently `22px`) → `30px`, so the ready dots stay proportional to the name:
```css
        .dm-dual-ready-indicator svg { width: 30px; height: 30px; }
```

`.dm-dual-game-name` (currently `30px`) → `38px`:
```css
        .dm-dual-game-name {
            font-family: 'Quantico', sans-serif; font-size: 38px; font-weight: 800;
            color: var(--gold-bright); margin-bottom: 20px;
        }
```

`.dm-dual-vs` (currently `28px`) → `36px`:
```css
        .dm-dual-vs {
            font-family: 'Russo One', sans-serif; font-size: 36px; font-weight: 800; color: var(--gold);
            padding: 0 16px;
        }
```

`.dm-dual-winner-label` (currently `18px`) → `24px`, with a matching icon bump:
```css
        .dm-dual-winner-label {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            font-family: 'Russo One', sans-serif; font-size: 24px; font-weight: 800;
            color: #f7ba32; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;
        }
        .dm-dual-winner-label svg { width: 26px; height: 26px; }
```

- [ ] **Step 2: Add the focus-mode rules**

Append this block immediately **after** the `.dm-dual-live-tag` rule that closes the dual-slot section (around `view.html:1700`), so it overrides the base sizes by source order:

```css
        /* ── Focus mode ──────────────────────────────────────────────────
           Applied by DisplayManager._dualSlotLayout() when exactly one match
           slot is still active. The live slot takes the room; the finished
           one shrinks to a narrow winner column rather than disappearing,
           so "who won match 1" stays on screen while match 2 plays out.
           Requested by Inffi, 2026-08-05 Discord thread. */
        .dm-matches-dual--focus { gap: 24px; align-items: flex-start; }

        .dm-matches-dual--focus .dm-dual-slot-panel--focus {
            flex: 1 1 auto; max-width: 1480px; padding: 40px;
        }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-slot-title { font-size: 52px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-game-name { font-size: 46px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-ready-name { font-size: 52px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-ready-side { min-width: 380px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-ready-indicator svg { width: 36px; height: 36px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-vs { font-size: 48px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--focus .dm-dual-ready-sides { gap: 32px; }

        .dm-matches-dual--focus .dm-dual-slot-panel--minor {
            flex: 0 0 400px; max-width: 400px; padding: 24px; opacity: 0.75;
        }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-slot-title { font-size: 30px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-slot-badge { font-size: 18px; padding: 5px 14px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-game-name { font-size: 24px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-ready-name { font-size: 26px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-ready-side { min-width: 150px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-vs { font-size: 22px; }
        .dm-matches-dual--focus .dm-dual-slot-panel--minor .dm-dual-winner-label { font-size: 18px; }
```

- [ ] **Step 3: Check the results slide did not inherit the bump**

Run: `grep -n "dm-results-large .dm-dual-ready-name" BoardGame/full/view.html`
Expected: still exactly one hit, `font-size: 15px`, at roughly line 1870.

That override is what keeps `scoring_vp` / `round_advance` dense. If it were ever removed, the results list would suddenly render at 38px and overflow. Leave it alone.

- [ ] **Step 4: Verify both layouts in the preview harness**

Open `BoardGame/dev/view-preview.html`. Step through these four scenarios and confirm each:

| Scenario | Expect |
|---|---|
| `Match 1 lobby, Match 2 lobby` | Two even panels, names clearly larger than before, nothing clipped or overflowing its row |
| `Match 1 lobby, Match 2 playing` | Still two even panels (both active — no focus) |
| `Match 1 done, Match 2 playing` | Match 2 wide and large, Match 1 a narrow dimmed winner column on the side |
| `Match 1 done, Match 2 done` | Two even panels of results, no focus mode |

Also open the `Latest Results` and `Round Advance` scenarios and confirm the results list still renders small and dense — that is the 15px override doing its job.

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/view.html
git commit -m "feat: bigger match names on the live screen, expand a lone active slot"
```

---

## Task 4: Puppeteer visual regression

The sizes are the whole point of the feature, so they need a guard. A future refactor that silently reverts `.dm-dual-ready-name` to 24px must fail a test, not go unnoticed until someone squints at the projector.

This test needs **no login and no tournament** — it drives `window.__devPreviewSnapshot`, the same dev hook `view-preview.html` uses, which feeds `DisplayManager` directly and never touches Firestore.

**Files:**
- Create: `BoardGame/dev/tests/e2e-view-dual-slot-layout.js`

- [ ] **Step 1: Write the test script**

Create `BoardGame/dev/tests/e2e-view-dual-slot-layout.js`:

```js
/**
 * Visual regression for view.html's matches_in_progress screen.
 *
 * Guards the two things the 2026-08-05 Discord thread asked for:
 *   1. Player names are large enough to read across a LAN room (Wustra).
 *   2. A lone active match slot expands instead of sitting in a 50/50
 *      split with a finished one (Inffi).
 *
 * Uses window.__devPreviewSnapshot -- no login, no Firestore, no tournament.
 * Run: cd BoardGame && node dev/tests/e2e-view-dual-slot-layout.js [--headed]
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server');
const { assert, screenshot, VIEWPORT } = require('./e2e-harness');

const PORT = 8085;
const MIN_NAME_PX = 36; // The whole point of the feature. Below this it is unreadable from the back of the room.

function baseData(slots) {
    const teams = [1, 2].map(id => ({
        id,
        name: `Tiimi ${id}`,
        color: id === 1 ? '#de392c' : '#2278a3',
        points: 3,
        players: [
            { id: `p_t${id}a`, uid: `uid_t${id}a`, name: `Player${id}A` },
            { id: `p_t${id}b`, uid: `uid_t${id}b`, name: `Player${id}B` }
        ]
    }));

    const players = {};
    teams.forEach(t => t.players.forEach(p => { players[p.id] = { uid: p.uid, name: p.name, teamId: t.id }; }));

    const match = (matchNumber, slot, status) => ({
        id: `m${matchNumber}`,
        matchNumber,
        game: 'aoe4',
        status,
        slot,
        roundNumber: 4,
        createdAt: 2_000_000,
        winnerIndex: status === 'completed' ? 0 : undefined,
        teams: [
            { id: 1, playerIds: ['p_t1a', 'p_t1b'] },
            { id: 2, playerIds: ['p_t2a', 'p_t2b'] }
        ]
    });

    return {
        name: 'layout-test',
        teams,
        players,
        board: {},
        rooms: {},
        lobbyReady: {},
        gameQueue: [
            match(1, 1, slots[1] === 'done' ? 'completed' : 'ongoing'),
            match(2, 2, slots[2] === 'done' ? 'completed' : 'ongoing')
        ],
        currentPhase: { name: 'matches_in_progress', roundNumber: 4, startedAt: 1_000_000, slots }
    };
}

async function pushSnapshot(page, data) {
    await page.evaluate(d => window.__devPreviewSnapshot(d), data);
    // One frame for the innerHTML swap plus layout to settle.
    await new Promise(resolve => setTimeout(resolve, 400));
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
        // Check 1 — both slots live: even split, readable names
        // ============================================================
        await pushSnapshot(page, baseData({ 1: 'playing', 2: 'playing' }));

        await page.waitForFunction(() => document.querySelectorAll('.dm-dual-ready-name').length > 0, { timeout: 10000 });

        const dual = await page.evaluate(() => {
            const name = document.querySelector('.dm-dual-ready-name');
            const panels = [...document.querySelectorAll('.dm-dual-slot-panel')];
            return {
                nameFontPx: parseFloat(getComputedStyle(name).fontSize),
                panelCount: panels.length,
                widths: panels.map(p => p.getBoundingClientRect().width),
                hasFocusWrapper: !!document.querySelector('.dm-matches-dual--focus')
            };
        });
        console.log('--- both slots live ---', JSON.stringify(dual));

        assert(dual.panelCount === 2, `expected 2 slot panels, got ${dual.panelCount}`);
        assert(!dual.hasFocusWrapper, 'two active slots must NOT trigger focus mode');
        assert(
            dual.nameFontPx >= MIN_NAME_PX,
            `player names are ${dual.nameFontPx}px, must be >= ${MIN_NAME_PX}px to read across the room`
        );
        // Even split: neither panel more than 15% wider than the other.
        const [wA, wB] = dual.widths;
        assert(
            Math.abs(wA - wB) / Math.max(wA, wB) < 0.15,
            `two live slots should split evenly, got widths ${wA} and ${wB}`
        );

        await screenshot(page, 'dual-slot-both-live', 'view-layout');

        // ============================================================
        // Check 2 — slot 1 done: slot 2 expands
        // ============================================================
        await pushSnapshot(page, baseData({ 1: 'done', 2: 'playing' }));

        await page.waitForFunction(() => !!document.querySelector('.dm-dual-slot-panel--focus'), { timeout: 10000 });

        const focus = await page.evaluate(() => {
            const focusPanel = document.querySelector('.dm-dual-slot-panel--focus');
            const minorPanel = document.querySelector('.dm-dual-slot-panel--minor');
            const focusName = focusPanel.querySelector('.dm-dual-ready-name');
            return {
                focusWidth: focusPanel.getBoundingClientRect().width,
                minorWidth: minorPanel.getBoundingClientRect().width,
                focusNameFontPx: parseFloat(getComputedStyle(focusName).fontSize),
                focusTitle: focusPanel.querySelector('.dm-dual-slot-title').textContent.trim(),
                minorTitle: minorPanel.querySelector('.dm-dual-slot-title').textContent.trim()
            };
        });
        console.log('--- slot 1 done, slot 2 playing ---', JSON.stringify(focus));

        assert(focus.focusTitle === 'Match 2', `the LIVE slot must be the focused one, got "${focus.focusTitle}"`);
        assert(focus.minorTitle === 'Match 1', `the DONE slot must be the minor one, got "${focus.minorTitle}"`);
        assert(
            focus.focusWidth > focus.minorWidth * 2,
            `focused panel (${focus.focusWidth}px) should be far wider than the finished one (${focus.minorWidth}px)`
        );
        assert(
            focus.focusNameFontPx >= MIN_NAME_PX,
            `focused-mode names are ${focus.focusNameFontPx}px, must be >= ${MIN_NAME_PX}px`
        );

        await screenshot(page, 'dual-slot-focus', 'view-layout');

        console.log('\nPASS — both layout checks held.');
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

Run: `cd BoardGame && node dev/tests/e2e-view-dual-slot-layout.js`
Expected: two `---` state dumps, then `PASS — both layout checks held.`, plus two screenshots under `dev/tests/screenshots/view-layout/`.

> **Gotcha if widths look wrong:** `view.html` scales `<body>` with a CSS `transform`, so `getBoundingClientRect()` returns *scaled* pixels while `getComputedStyle().fontSize` returns *unscaled* design-space pixels. The assertions above are written accordingly — widths are only ever compared to each other (ratios survive scaling), never to an absolute number. Keep it that way if you add checks.

- [ ] **Step 3: Prove the guard actually guards**

Temporarily set `.dm-dual-ready-name`'s `font-size` back to `24px` in `view.html` and re-run the script.
Expected: `FAILED: ASSERTION FAILED: player names are 24px, must be >= 36px to read across the room`

Restore the `38px` value and re-run to confirm it passes again. A regression test that cannot fail is worth nothing — this step is how you know it works.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/dev/tests/e2e-view-dual-slot-layout.js
git commit -m "test: guard live-screen name size and single-slot expansion"
```

---

## Task 5: Confirm on the real screen and iterate

Item 1's developer note is explicit: *"Do changes, confirm on big screen. Iterate if necessary."* The numbers in Task 3 are a considered first pass, not a measured one — 38px/52px is the starting point, and the room is the judge. **Do not skip this task or treat the plan as finished without it.**

**Files:**
- Modify (only if the room says so): `BoardGame/full/view.html`

- [ ] **Step 1: Put it on the actual display**

Serve the pages and open `view.html` on the real LAN screen at its real resolution and real viewing distance:

```bash
cd BoardGame
node -e "require('./dev/tests/e2e-server').startServer(process.cwd(), 8080).then(() => console.log('http://localhost:8080/full/view.html?tournamentId=<a-real-tournament-id>'))"
```

If no live tournament is running, open `dev/view-preview.html` on that screen instead and select the `matches_in_progress` scenarios — it renders the identical markup through the same code path.

- [ ] **Step 2: Judge it from the back of the room**

Stand where players actually stand. Check, in order:

1. Can you read a player's name without moving closer? (the original complaint)
2. Do the ready dots still read as two distinct indicators, or have they become a blur?
3. With a full 5-team roster and the longest real nickname, does any row wrap awkwardly or clip?
4. In focus mode, does the finished slot's winner column still register, or has it faded too far at `opacity: 0.75`?

- [ ] **Step 3: Adjust and re-verify**

If anything fails, change the relevant `font-size` / `min-width` / `opacity` in the Task 3 CSS block and reload. Iterate until it reads cleanly.

If you raise `.dm-dual-ready-name` above 38px, no test changes are needed — `MIN_NAME_PX` is a floor, not an equality. If you ever need to *lower* it below 36px, that contradicts the feature; re-read Wustra's request before touching `MIN_NAME_PX`.

After any change, re-run both guards:

```bash
node --test "BoardGame/dev/tests/*.test.js"
cd BoardGame && node dev/tests/e2e-view-dual-slot-layout.js
```

- [ ] **Step 4: Commit whatever the room decided**

```bash
git add BoardGame/full/view.html
git commit -m "fix: tune live-screen sizes against the real display"
```

If Step 2 passed with no changes, skip this commit and say so in the handoff — "confirmed on the real screen, no adjustment needed" is a result worth recording.

---

## Self-Review

**Spec coverage.** Item 1 (bigger names) → Tasks 3 and 5, guarded by Task 4. Item 3 (expand to fill screen, hide board/scores during lobby) → Tasks 1–3; the hide-the-board half already ships via `DISPLAY_MODES.matches_in_progress`'s `hidePanels: true` and needs no work, which is why no task touches it.

**Naming consistency.** `_dualSlotLayout()` returns `{mode, focusSlot}` in Task 1 and is destructured as `layout.mode` / `layout.focusSlot` in Task 2. Class names `dm-matches-dual--focus`, `dm-dual-slot-panel--focus`, `dm-dual-slot-panel--minor` are emitted in Task 2, styled in Task 3, and asserted in Task 4 — all three match.

**Known limitation, deliberately out of scope.** A split-format slot (linked 3v3 + 2v2) still stacks both matches vertically inside one panel. Inffi's note mentions that shape, but stacking is already correct behaviour — the panel is simply taller. If the LAN shows it reads badly, that is a follow-up, not a defect in this plan.
