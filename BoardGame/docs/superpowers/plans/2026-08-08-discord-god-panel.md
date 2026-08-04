# Discord God Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a god a `god.html` tab that configures Discord voice-move settings, confirms player→Discord links for a whole roster in one pass, toggles the kill switch, and shows recent move activity — replacing all hand-editing of Firestore documents.

**Architecture:** One new god.html tab backed by one new script (`discord-panel.js`), reading and writing the three Firestore subcollections the already-deployed Cloud Function uses. The guild's member and channel lists are fetched by the Cloud Function through the existing `discordCommands` queue (a new `refresh-channels` command mirrors the existing `refresh-members`) and cached in Firestore for the panel to read — the browser never talks to Discord directly, because the bot token must never reach client JS.

**Tech Stack:** Vanilla JS (no build step, no framework), Firebase v9 compat SDK, `node:test` for unit tests, Cloud Functions v2 for the backend addition.

**Spec:** [`../specs/2026-08-08-discord-god-panel-design.md`](../specs/2026-08-08-discord-god-panel-design.md)

**Prerequisite:** the backend from `2026-08-04-discord-voice-moves-backend.md` is built, deployed, and live. This plan is purely additive to it.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `BoardGame/shared/scripts/discord-link-matcher.js` | **Pure.** Username normalization + roster→member suggestion. No DOM, no Firestore. |
| `BoardGame/dev/tests/discord-link-matcher.test.js` | Unit tests for the above |
| `BoardGame/full/scripts/discord-panel.js` | The whole god panel: data loading + four section renderers |

**Modified:**

| File | Change |
|---|---|
| `functions/lib/discord-rest.js` | Add `listGuildChannels()` |
| `functions/lib/command-handler.js` | Add `refresh-channels` branch |
| `functions/lib/firestore-adapter.js` | Add `writeChannelCache()` |
| `functions/test/discord-rest.test.js` | Tests for `listGuildChannels` |
| `functions/test/command-handler.test.js` | Tests for `refresh-channels`; extend fakes |
| `BoardGame/full/god.html` | Nav tab, panel markup, 2 script tags, `switchGodTab` hook |

**Test commands:**
- Functions: `cd functions; npm test` → 41 passing before this plan
- Browser: `node --test "BoardGame/dev/tests/*.test.js"` → 139 passing before this plan

---

## Task 1: `listGuildChannels` in the Discord REST client

The panel's Setup dropdowns need channel names, not raw IDs. Discord channel type `2` is `GUILD_VOICE`; text channels, categories, and stage channels are filtered out because a player can only be moved into a voice channel — offering anything else would just invite a misconfiguration that fails later at move time.

**Files:**
- Modify: `functions/lib/discord-rest.js`
- Test: `functions/test/discord-rest.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/discord-rest.test.js`:

```js
test('listGuildChannels returns only voice channels, normalised', async () => {
    const { rest, calls } = restWith([{
        status: 200,
        body: [
            { id: '1', name: 'general', type: 0 },
            { id: '2', name: 'Waiting Room', type: 2 },
            { id: '3', name: 'Alpha', type: 2 },
            { id: '4', name: 'Voice Channels', type: 4 }
        ]
    }]);
    const result = await rest.listGuildChannels({ guildId: 'g' });
    assert.deepStrictEqual(result, {
        outcome: 'ok',
        channels: [
            { channelId: '2', name: 'Waiting Room' },
            { channelId: '3', name: 'Alpha' }
        ]
    });
    assert.match(calls[0].url, /\/guilds\/g\/channels$/);
    assert.strictEqual(calls[0].options.method, 'GET');
});

test('listGuildChannels surfaces a failure instead of an empty list', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Access' } }]);
    const result = await rest.listGuildChannels({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.strictEqual(result.channels, undefined);
});

test('listGuildChannels handles a thrown network error', async () => {
    const { rest } = restWith([new Error('ECONNRESET')]);
    const result = await rest.listGuildChannels({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /ECONNRESET/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions; npm test`
Expected: FAIL — `rest.listGuildChannels is not a function`

- [ ] **Step 3: Implement**

In `functions/lib/discord-rest.js`, add this constant directly below the existing `ERR_NOT_IN_VOICE` declaration:

```js
/** Discord channel type for a voice channel (GUILD_VOICE). */
const CHANNEL_TYPE_VOICE = 2;
```

Add this function inside `createDiscordRest`, immediately after `listGuildMembers`:

```js
    /**
     * List the guild's voice channels for the setup dropdowns.
     *
     * Filtered to voice channels only: a member can only be moved into one,
     * so listing text channels or categories would just let an operator
     * pick something that fails at move time instead of at setup time.
     *
     * Like listGuildMembers, a failure is reported as an error rather than
     * an empty list — "no channels" and "the call failed" must not look
     * identical to the panel.
     */
    async function listGuildChannels({ guildId }) {
        let res;
        try {
            res = await request('GET', `/guilds/${guildId}/channels`);
        } catch (err) {
            return { outcome: 'error', error: String(err && err.message ? err.message : err) };
        }

        const body = await readJson(res);

        if (res.status !== 200 || !Array.isArray(body)) {
            return {
                outcome: 'error',
                error: `HTTP ${res.status}: ${(body && body.message) || 'unexpected response'}`
            };
        }

        return {
            outcome: 'ok',
            channels: body
                .filter(channel => channel.type === CHANNEL_TYPE_VOICE)
                .map(channel => ({ channelId: channel.id, name: channel.name }))
        };
    }
```

Change the module's return statement from `return { moveMember, listGuildMembers };` to:

```js
    return { moveMember, listGuildMembers, listGuildChannels };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions; npm test`
Expected: PASS — 44 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/discord-rest.js functions/test/discord-rest.test.js
git commit -m "feat: list guild voice channels for Discord setup UI"
```

---

## Task 2: `refresh-channels` command

Mirrors the existing `refresh-members` branch exactly. No retry loop — this is a one-shot fetch, not a move.

**Files:**
- Modify: `functions/lib/firestore-adapter.js`
- Modify: `functions/lib/command-handler.js`
- Test: `functions/test/command-handler.test.js`

- [ ] **Step 1: Extend the test fakes**

In `functions/test/command-handler.test.js`, the `fakeDb` helper currently tracks `updates` and `configWrites`. Add channel-cache tracking. Replace the whole `fakeDb` function with:

```js
function fakeDb({ config = CONFIG, gameState = GAME_STATE, links = {}, match = MATCH } = {}) {
    const updates = [];
    const configWrites = [];
    const channelWrites = [];
    return {
        updates,
        configWrites,
        channelWrites,
        tournament(tid) {
            return {
                async getGameState() { return gameState; },
                async getConfig() { return config; },
                async getLinks() { return links; },
                async getMatch() { return match; },
                async updateGameState(patch) { updates.push(patch); },
                async writeMemberCache(data) { configWrites.push(data); },
                async writeChannelCache(data) { channelWrites.push(data); }
            };
        }
    };
}
```

In the same file, the `fakeRest` helper needs a `listGuildChannels`. Add this method to the object `fakeRest` returns, alongside the existing `listGuildMembers`:

```js
        async listGuildChannels() {
            return { outcome: 'ok', channels: [{ channelId: 'c1', name: 'Waiting Room' }] };
        },
```

- [ ] **Step 2: Write the failing tests**

Append to `functions/test/command-handler.test.js`:

```js
test('refresh-channels writes the channel cache', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(db.channelWrites.length, 1);
    assert.strictEqual(db.channelWrites[0].count, 1);
    assert.strictEqual(db.channelWrites[0].channels[0].channelId, 'c1');
    assert.ok(db.channelWrites[0].refreshedAt);
});

test('a failed channel list is reported, not silently cached', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    rest.listGuildChannels = async () => ({ outcome: 'error', error: 'Missing Access' });
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'channel-list-failed');
    assert.strictEqual(db.channelWrites.length, 0);
});

test('refresh-channels respects the kill switch', async () => {
    const db = fakeDb({ config: { ...CONFIG, enabled: false } });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-channels' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(db.channelWrites.length, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd functions; npm test`
Expected: FAIL — `refresh-channels` falls through to the unknown-type branch, so `status` is `skipped` with `reason: 'unknown-type'` instead of `done`.

- [ ] **Step 4: Implement the adapter method**

In `functions/lib/firestore-adapter.js`, add this method immediately after the existing `writeMemberCache`:

```js
                async writeChannelCache(data) {
                    await ref.collection('discordConfig').doc('channelCache').set(data);
                }
```

Note the existing `writeMemberCache` has no trailing comma (it is the last method). Add a comma after its closing brace when appending this one.

- [ ] **Step 5: Implement the handler branch**

In `functions/lib/command-handler.js`, add this block immediately after the closing brace of the existing `if (command.type === 'refresh-members') { ... }` block and before the `if (command.type !== 'pull' && command.type !== 'return')` check:

```js
    if (command.type === 'refresh-channels') {
        const listed = await rest.listGuildChannels({ guildId: config.guildId });
        if (listed.outcome !== 'ok') {
            return { status: 'skipped', reason: 'channel-list-failed', error: listed.error, results: [] };
        }
        await tournament.writeChannelCache({
            channels: listed.channels,
            count: listed.channels.length,
            refreshedAt: new Date().toISOString()
        });
        return { status: 'done', results: [] };
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd functions; npm test`
Expected: PASS — 47 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add functions/lib/command-handler.js functions/lib/firestore-adapter.js functions/test/command-handler.test.js
git commit -m "feat: refresh-channels command caches guild voice channels"
```

---

## Task 3: Pure link-suggestion matcher

Lives in `shared/scripts/` (not `functions/`) because it runs in the browser, and follows the same dual-export pattern as `resolve-tournament-id.js` so it can be unit tested under `node:test`.

**Files:**
- Create: `BoardGame/shared/scripts/discord-link-matcher.js`
- Test: `BoardGame/dev/tests/discord-link-matcher.test.js`

- [ ] **Step 1: Write the failing tests**

`BoardGame/dev/tests/discord-link-matcher.test.js`:

```js
/**
 * Coverage for the pure username-normalisation and suggestion logic behind
 * the god panel's player-link table. Deliberately exact-match-only: see the
 * module's own header for why fuzzy matching is rejected.
 */
const test = require('node:test');
const assert = require('node:assert');
const { normalizeDiscordName, suggestMember } =
    require('../../shared/scripts/discord-link-matcher.js');

test('normalize trims, lowercases, and strips a leading @', () => {
    assert.strictEqual(normalizeDiscordName('  @PlayerOne '), 'playerone');
});

test('normalize strips a legacy #1234 discriminator', () => {
    assert.strictEqual(normalizeDiscordName('Player#1234'), 'player');
});

test('normalize strips a modern #0 discriminator', () => {
    assert.strictEqual(normalizeDiscordName('player#0'), 'player');
});

test('normalize keeps a leading # — that is not a discriminator separator', () => {
    assert.strictEqual(normalizeDiscordName('#weird'), '#weird');
});

test('normalize returns an empty string for anything that is not a string', () => {
    assert.strictEqual(normalizeDiscordName(null), '');
    assert.strictEqual(normalizeDiscordName(undefined), '');
    assert.strictEqual(normalizeDiscordName(42), '');
});

const MEMBERS = [
    { discordUserId: '1', username: 'alpha', displayName: 'Alpha Player' },
    { discordUserId: '2', username: 'beta', displayName: 'Beta' },
    { discordUserId: '3', username: 'gamma', displayName: 'Alpha Player' }
];

test('suggests a member matched on username', () => {
    assert.strictEqual(suggestMember('  @Alpha ', MEMBERS).discordUserId, '1');
});

test('suggests a member matched on display name', () => {
    assert.strictEqual(suggestMember('Beta', MEMBERS).discordUserId, '2');
});

test('returns null when nothing matches', () => {
    assert.strictEqual(suggestMember('nobody', MEMBERS), null);
});

test('returns null for an ambiguous match rather than guessing', () => {
    assert.strictEqual(suggestMember('Alpha Player', MEMBERS), null);
});

test('returns null for an empty or whitespace typed name', () => {
    assert.strictEqual(suggestMember('', MEMBERS), null);
    assert.strictEqual(suggestMember('   ', MEMBERS), null);
});

test('handles a missing members list without throwing', () => {
    assert.strictEqual(suggestMember('alpha', null), null);
    assert.strictEqual(suggestMember('alpha', undefined), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: FAIL — `Cannot find module '../../shared/scripts/discord-link-matcher.js'`

- [ ] **Step 3: Implement**

`BoardGame/shared/scripts/discord-link-matcher.js`:

```js
/**
 * Suggests which guild member a roster player probably is, by comparing the
 * Discord username they typed at onboarding against the cached guild member
 * list.
 *
 * Pure and dependency-free: no DOM, no Firestore, no network. Runs in the
 * browser (god panel) and under node:test unchanged.
 *
 * EXACT match after normalisation only — fuzzy/closest-match suggestion is
 * deliberately not implemented. The whole reason the mover uses confirmed
 * links instead of matching usernames at move time is to eliminate silent
 * wrong matches. A near-miss suggestion is exactly what a human
 * rubber-stamps during a fast "confirm all" pass, which would reintroduce
 * that failure through the back door.
 */

/**
 * Reduce a Discord username to a comparable form: trimmed, no leading '@',
 * no trailing discriminator, lowercased.
 *
 * Handles both the legacy 'name#1234' format and the modern 'name#0'
 * that Discord still emits in some payloads.
 */
function normalizeDiscordName(value) {
    if (typeof value !== 'string') return '';

    let name = value.trim();
    if (name.startsWith('@')) name = name.slice(1);

    // lastIndexOf > 0 so a name that legitimately STARTS with '#' is left
    // alone — only a separator with something before it is a discriminator.
    const hashIndex = name.lastIndexOf('#');
    if (hashIndex > 0) name = name.slice(0, hashIndex);

    return name.trim().toLowerCase();
}

/**
 * Find the single guild member whose username or display name normalises to
 * the same string as `typedName`.
 *
 * Returns null when nothing matches AND when more than one member matches.
 * An ambiguous match is not a suggestion, it is a coin flip — surfacing it
 * as a confident pre-selection is precisely the silent-wrong-match risk this
 * module exists to avoid. The operator picks manually in that case.
 *
 * @param {string} typedName  What the player entered at onboarding
 * @param {Array<{discordUserId: string, username: string, displayName: string}>} members
 * @returns {object|null} the matched member object, or null
 */
function suggestMember(typedName, members) {
    const target = normalizeDiscordName(typedName);
    if (!target) return null;

    const matches = (members || []).filter(member =>
        normalizeDiscordName(member.username) === target ||
        normalizeDiscordName(member.displayName) === target
    );

    return matches.length === 1 ? matches[0] : null;
}

if (typeof window !== 'undefined') {
    window.DiscordLinkMatcher = { normalizeDiscordName, suggestMember };
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeDiscordName, suggestMember };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: PASS — 150 tests, 0 failures (139 pre-existing + 11 new).

- [ ] **Step 5: Commit**

```bash
git add BoardGame/shared/scripts/discord-link-matcher.js BoardGame/dev/tests/discord-link-matcher.test.js
git commit -m "feat: pure Discord link suggestion matcher"
```

---

## Task 4: god.html tab scaffolding

Markup and wiring only — no behaviour yet. After this task the tab exists and is empty; `discord-panel.js` fills it in Tasks 5–7.

**Files:**
- Modify: `BoardGame/full/god.html`

- [ ] **Step 1: Add the nav tab button**

In `BoardGame/full/god.html`, find the Users nav button (around line 47) and add this immediately after its closing `</button>`:

```html
            <button class="god-nav-tab" data-tab="discord" data-role="god" onclick="switchGodTab('discord')">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> Discord
            </button>
```

- [ ] **Step 2: Add the panel markup**

Find the closing `</div>` of the Users panel (`<div id="usersPanel" class="god-tab-panel">`, which starts around line 444) and add this complete new panel immediately after it:

```html
    <!-- Tab 9: Discord Panel -->
    <div id="discordPanel" class="god-tab-panel">
        <div class="panel">
            <h3><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> Discord Voice Moves</h3>

            <div id="discordNoTournament" style="padding: 20px; color: var(--text-tertiary);">
                Select a tournament on the Tournaments tab first.
            </div>

            <div id="discordPanelBody" style="display: none;">
                <div id="discordKillSwitch" style="margin-bottom: 20px;"></div>
                <div id="discordSetup" style="margin-bottom: 25px;"></div>
                <div id="discordLinksSection" style="margin-bottom: 25px;"></div>
                <div id="discordActivity"></div>
            </div>
        </div>
    </div>
```

- [ ] **Step 3: Add the script tags**

Find `<script defer src="../shared/scripts/resolve-tournament-id.js"></script>` (around line 790) and add this immediately after it:

```html
    <script defer src="../shared/scripts/discord-link-matcher.js"></script>
```

Find `<script defer src="scripts/discord-commands.js"></script>` (around line 814) and add this immediately after it:

```html
    <script defer src="scripts/discord-panel.js"></script>
```

Order matters: `discord-panel.js` calls `window.DiscordCommands` and `window.DiscordLinkMatcher`, so both must load first.

- [ ] **Step 4: Add the tab-switch load hook**

In the `switchGodTab` function, find the Seasons hook:

```js
            // If switching to Seasons tab, load seasons
            if (tabName === 'seasons') {
                window.godApp?.seasons?.loadSeasons();
            }
```

Add immediately after it:

```js
            // If switching to Discord tab, load its config/links/activity
            if (tabName === 'discord') {
                window.DiscordPanel?.load();
            }
```

- [ ] **Step 5: Verify the wiring**

Run:
```bash
node -e "const s=require('fs').readFileSync('BoardGame/full/god.html','utf8');['data-tab=\"discord\"','id=\"discordPanel\"','id=\"discordPanelBody\"','id=\"discordKillSwitch\"','id=\"discordSetup\"','id=\"discordLinksSection\"','id=\"discordActivity\"','discord-link-matcher.js','discord-panel.js','DiscordPanel?.load()'].forEach(n=>console.log(s.includes(n)?'ok   '+n:'MISS '+n))"
```
Expected: every line prints `ok`.

- [ ] **Step 6: Confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: PASS — 150 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add BoardGame/full/god.html
git commit -m "feat: Discord tab scaffolding in god.html"
```

---

## Task 5: Panel core and Setup section

Creates `discord-panel.js` with its shared state, data loading, and the Setup section. Tasks 6 and 7 add the remaining renderers to this same file.

**Files:**
- Create: `BoardGame/full/scripts/discord-panel.js`

- [ ] **Step 1: Create the file**

`BoardGame/full/scripts/discord-panel.js`:

```js
/**
 * God-panel UI for the Discord voice-move integration.
 *
 * Four sections — kill switch, setup, player links, activity — all scoped to
 * the tournament currently selected in god.html.
 *
 * Nothing here talks to Discord directly: the bot token lives in Cloud
 * Secret Manager and must never reach client JS. The guild's member and
 * channel lists are fetched by the Cloud Function via the discordCommands
 * queue and read back out of discordConfig/memberCache and
 * discordConfig/channelCache.
 */

const DiscordPanel = {

    _config: null,
    _members: [],
    _channels: [],
    _links: {},
    _activityUnsub: null,

    // ── Shared helpers ──────────────────────────────────────────

    _tournamentId() {
        return window.godApp?._currentTournamentId || null;
    },

    /** Firestore ref for the selected tournament, or null if none. */
    _ref() {
        const tid = this._tournamentId();
        if (!tid || !window.firebaseDB) return null;
        return window.firebaseDB.collection('tournaments').doc(tid);
    },

    _escape(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    _toast(message, type) {
        if (typeof window.showToast === 'function') window.showToast(message, type);
        else console.log(`[Discord Panel] ${message}`);
    },

    // ── Entry point ─────────────────────────────────────────────

    /** Called by switchGodTab when the Discord tab is opened. */
    async load() {
        const body = document.getElementById('discordPanelBody');
        const empty = document.getElementById('discordNoTournament');

        if (!this._ref()) {
            if (body) body.style.display = 'none';
            if (empty) empty.style.display = '';
            return;
        }
        if (body) body.style.display = '';
        if (empty) empty.style.display = 'none';

        await this.reload();
    },

    /** Re-read everything from Firestore and re-render all sections. */
    async reload() {
        await this._loadData();
        this.renderKillSwitch();
        this.renderSetup();
        this.renderLinks();
        this.watchActivity();
    },

    async _loadData() {
        const ref = this._ref();
        if (!ref) return;
        try {
            const [configSnap, memberSnap, channelSnap, linkSnap] = await Promise.all([
                ref.collection('discordConfig').doc('state').get(),
                ref.collection('discordConfig').doc('memberCache').get(),
                ref.collection('discordConfig').doc('channelCache').get(),
                ref.collection('discordLinks').get()
            ]);

            this._config = configSnap.exists ? configSnap.data() : null;
            this._members = memberSnap.exists ? (memberSnap.data().members || []) : [];
            this._channels = channelSnap.exists ? (channelSnap.data().channels || []) : [];
            this._links = {};
            linkSnap.forEach(doc => { this._links[doc.id] = doc.data(); });
        } catch (err) {
            console.error('[Discord Panel] Load failed:', err);
            this._toast(`Could not load Discord settings: ${err.message}`, 'error');
        }
    },

    // ── Setup ───────────────────────────────────────────────────

    /** <option> list for one channel dropdown, marking `selectedId` chosen. */
    _channelOptions(selectedId) {
        const blank = `<option value="">— not set —</option>`;
        const options = this._channels.map(channel => {
            const chosen = String(channel.channelId) === String(selectedId) ? ' selected' : '';
            return `<option value="${this._escape(channel.channelId)}"${chosen}>${this._escape(channel.name)}</option>`;
        }).join('');
        return blank + options;
    },

    renderSetup() {
        const host = document.getElementById('discordSetup');
        if (!host) return;

        const config = this._config || {};
        const slots = config.slotChannels || {};
        const slot1 = slots['1'] || [];
        const slot2 = slots['2'] || [];

        const noChannels = this._channels.length === 0
            ? `<p style="color: var(--text-tertiary); font-size: 0.85rem;">
                   No channels cached yet — enter the Guild ID, save, then click "Refresh channels".
               </p>`
            : '';

        const field = (label, id, selected) => `
            <div>
                <label style="display:block; font-size:0.8rem; color:var(--text-tertiary); margin-bottom:4px;">${label}</label>
                <select id="${id}" style="width:100%; padding:8px; background:rgba(11,13,16,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:white;">
                    ${this._channelOptions(selected)}
                </select>
            </div>`;

        host.innerHTML = `
            <h4 style="margin-bottom:10px;">Setup</h4>
            ${noChannels}
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                <div>
                    <label style="display:block; font-size:0.8rem; color:var(--text-tertiary); margin-bottom:4px;">Guild (server) ID</label>
                    <input type="text" id="discordGuildId" value="${this._escape(config.guildId || '')}"
                           placeholder="e.g. 1520510940724854925"
                           style="width:100%; padding:8px; background:rgba(11,13,16,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:white;">
                </div>
                ${field('Waiting Room', 'discordWaitingRoom', config.waitingRoomChannelId)}
                ${field('Match 1 — side A', 'discordSlot1A', slot1[0])}
                ${field('Match 1 — side B', 'discordSlot1B', slot1[1])}
                ${field('Match 2 — side A', 'discordSlot2A', slot2[0])}
                ${field('Match 2 — side B', 'discordSlot2B', slot2[1])}
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn primary" onclick="DiscordPanel.saveSetup()">Save setup</button>
                <button class="btn secondary" onclick="DiscordPanel.refreshChannels()">Refresh channels</button>
            </div>
        `;
    },

    async saveSetup() {
        const ref = this._ref();
        if (!ref) return;

        const value = id => document.getElementById(id)?.value.trim() || '';
        const guildId = value('discordGuildId');
        if (!guildId) {
            this._toast('Guild ID is required.', 'error');
            return;
        }

        // enabled is preserved if the doc already exists, and defaults to
        // false on a fresh setup — a newly configured tournament should not
        // start moving people the moment it is saved.
        const payload = {
            enabled: this._config?.enabled === true,
            guildId,
            waitingRoomChannelId: value('discordWaitingRoom'),
            slotChannels: {
                '1': [value('discordSlot1A'), value('discordSlot1B')],
                '2': [value('discordSlot2A'), value('discordSlot2B')]
            }
        };

        try {
            await ref.collection('discordConfig').doc('state').set(payload, { merge: true });
            this._toast('Discord setup saved.', 'success');
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Save failed:', err);
            this._toast(`Could not save: ${err.message}`, 'error');
        }
    },

    async refreshChannels() {
        const id = await window.DiscordCommands?.request('refresh-channels');
        if (!id) {
            this._toast('Could not queue the channel refresh.', 'error');
            return;
        }
        this._toast('Fetching channels from Discord…', 'info');
        this._awaitCommand(id, 'Channels refreshed.');
    },

    /**
     * Watch one queued command until the Cloud Function writes its result,
     * then reload. Gives up after 30s so a dead function does not leave the
     * listener hanging forever.
     */
    _awaitCommand(commandId, successMessage) {
        const ref = this._ref();
        if (!ref) return;

        const doc = ref.collection('discordCommands').doc(commandId);
        const timeout = setTimeout(() => {
            unsub();
            this._toast('Discord command timed out — check the function logs.', 'error');
        }, 30000);

        const unsub = doc.onSnapshot(snap => {
            const data = snap.data();
            if (!data || data.status === 'pending') return;
            clearTimeout(timeout);
            unsub();
            if (data.status === 'done') {
                this._toast(successMessage, 'success');
            } else {
                this._toast(`Discord command ${data.status}: ${data.reason || ''} ${data.error || ''}`.trim(), 'error');
            }
            this.reload();
        }, err => {
            clearTimeout(timeout);
            console.error('[Discord Panel] Command watch failed:', err);
        });
    }
};

if (typeof window !== 'undefined') window.DiscordPanel = DiscordPanel;
```

- [ ] **Step 2: Verify it parses**

Run: `node --check BoardGame/full/scripts/discord-panel.js`
Expected: no output (a syntax error would print one).

- [ ] **Step 3: Confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: PASS — 150 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/discord-panel.js
git commit -m "feat: Discord panel core and setup section"
```

---

## Task 6: Player Links section

The section that replaces hand-creating `discordLinks` documents one at a time.

**Files:**
- Modify: `BoardGame/full/scripts/discord-panel.js`

- [ ] **Step 1: Add the roster reader and renderer**

In `BoardGame/full/scripts/discord-panel.js`, add these methods immediately after `_awaitCommand` (add a comma after `_awaitCommand`'s closing brace):

```js
    // ── Player links ────────────────────────────────────────────

    /**
     * Flatten the tournament roster into link-table rows.
     *
     * Roster entries in `teams[].players[]` carry only `{id, name, uid}` —
     * the Discord username a player typed at onboarding lives in the
     * tournament document's top-level `players` map, keyed by the same
     * player id (that is where onboarding.js writes platformIds). So the
     * two have to be joined here.
     *
     * Players with no `uid` are included but cannot be linked: links are
     * keyed by Firebase uid, and an account-less onboarding player has none.
     * They are shown greyed out rather than hidden, so it is obvious why
     * they will never be auto-moved.
     */
    _rosterRows() {
        const gameState = window.godApp?.gameState || {};
        const teams = gameState.teams || [];
        const playersById = gameState.players || {};
        const rows = [];

        teams.forEach(team => {
            (team.players || []).forEach(player => {
                const onboarding = playersById[player.id] || {};
                rows.push({
                    uid: player.uid || null,
                    name: player.name || player.id || '(unnamed)',
                    teamName: team.name || `Team ${team.id}`,
                    typed: onboarding.platformIds?.discord || '',
                    linked: player.uid ? this._links[player.uid] : null
                });
            });
        });
        return rows;
    },

    /** <option> list of guild members for one row's dropdown. */
    _memberOptions(selectedId, suggestedId) {
        const blank = `<option value="">— not linked —</option>`;
        const options = this._members.map(member => {
            const chosen = String(member.discordUserId) === String(selectedId) ? ' selected' : '';
            const isSuggested = String(member.discordUserId) === String(suggestedId);
            const label = isSuggested
                ? `${member.displayName} (suggested)`
                : `${member.displayName} — ${member.username}`;
            return `<option value="${this._escape(member.discordUserId)}"${chosen}>${this._escape(label)}</option>`;
        }).join('');
        return blank + options;
    },

    renderLinks() {
        const host = document.getElementById('discordLinksSection');
        if (!host) return;

        const rows = this._rosterRows();
        const matcher = window.DiscordLinkMatcher;

        if (this._members.length === 0) {
            host.innerHTML = `
                <h4 style="margin-bottom:10px;">Player Links</h4>
                <p style="color: var(--text-tertiary); font-size:0.85rem;">
                    No guild members cached yet. Save the setup above, then click "Refresh members".
                </p>
                <button class="btn secondary" onclick="DiscordPanel.refreshMembers()">Refresh members</button>
            `;
            return;
        }

        let suggestionCount = 0;

        const body = rows.map((row, index) => {
            const suggested = (row.uid && !row.linked && matcher)
                ? matcher.suggestMember(row.typed, this._members)
                : null;
            if (suggested) suggestionCount++;

            const selectedId = row.linked?.discordUserId || suggested?.discordUserId || '';
            const unlinked = !row.linked && !suggested;
            const rowStyle = row.uid
                ? (unlinked ? 'background: rgba(239,68,68,0.08);' : '')
                : 'opacity: 0.45;';

            const control = row.uid
                ? `<select id="discordLinkSelect-${index}" style="width:100%; padding:6px; background:rgba(11,13,16,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:white;">
                       ${this._memberOptions(selectedId, suggested?.discordUserId)}
                   </select>`
                : `<span style="font-size:0.8rem; color:var(--text-tertiary);">no account</span>`;

            const action = row.uid
                ? `<button class="btn-small primary" onclick="DiscordPanel.saveLink('${this._escape(row.uid)}', ${index})">Save</button>`
                : '';

            const status = row.linked
                ? '<span style="color:#22c55e;">linked</span>'
                : (suggested ? '<span style="color:#eab308;">suggested</span>' : '<span style="color:#ef4444;">unlinked</span>');

            return `
                <tr style="${rowStyle}">
                    <td>${this._escape(row.name)}</td>
                    <td style="color:var(--text-tertiary);">${this._escape(row.teamName)}</td>
                    <td style="color:var(--text-tertiary);">${this._escape(row.typed || '—')}</td>
                    <td>${control}</td>
                    <td>${status}</td>
                    <td>${action}</td>
                </tr>`;
        }).join('');

        host.innerHTML = `
            <h4 style="margin-bottom:10px;">Player Links</h4>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <button class="btn primary" onclick="DiscordPanel.confirmAllSuggestions()"
                        ${suggestionCount === 0 ? 'disabled' : ''}>
                    Confirm all suggestions (${suggestionCount})
                </button>
                <button class="btn secondary" onclick="DiscordPanel.refreshMembers()">Refresh members</button>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                <thead>
                    <tr style="text-align:left; color:var(--text-tertiary); font-size:0.8rem;">
                        <th>Player</th><th>Team</th><th>Typed at onboarding</th>
                        <th>Discord account</th><th>Status</th><th></th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
        `;
    },

    async refreshMembers() {
        const id = await window.DiscordCommands?.request('refresh-members');
        if (!id) {
            this._toast('Could not queue the member refresh.', 'error');
            return;
        }
        this._toast('Fetching members from Discord…', 'info');
        this._awaitCommand(id, 'Members refreshed.');
    },

    async saveLink(uid, index) {
        const ref = this._ref();
        if (!ref) return;

        const discordUserId = document.getElementById(`discordLinkSelect-${index}`)?.value || '';

        try {
            if (!discordUserId) {
                await ref.collection('discordLinks').doc(uid).delete();
                this._toast('Link removed.', 'success');
            } else {
                const member = this._members.find(m => String(m.discordUserId) === String(discordUserId));
                await ref.collection('discordLinks').doc(uid).set({
                    discordUserId,
                    discordUsername: member?.username || '',
                    displayName: member?.displayName || '',
                    confirmedBy: window.firebase?.auth?.().currentUser?.uid || null,
                    confirmedAt: new Date().toISOString(),
                    source: 'manual'
                });
                this._toast('Link saved.', 'success');
            }
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Link save failed:', err);
            this._toast(`Could not save link: ${err.message}`, 'error');
        }
    },

    /**
     * Write a link for every row that has a suggestion and is not already
     * linked, in one batch. This is the whole point of the panel: a roster
     * of thirty is one click, not thirty console documents.
     */
    async confirmAllSuggestions() {
        const ref = this._ref();
        const matcher = window.DiscordLinkMatcher;
        if (!ref || !matcher) return;

        const batch = window.firebaseDB.batch();
        const now = new Date().toISOString();
        const confirmedBy = window.firebase?.auth?.().currentUser?.uid || null;
        let count = 0;

        this._rosterRows().forEach(row => {
            if (!row.uid || row.linked) return;
            const suggested = matcher.suggestMember(row.typed, this._members);
            if (!suggested) return;

            batch.set(ref.collection('discordLinks').doc(row.uid), {
                discordUserId: suggested.discordUserId,
                discordUsername: suggested.username || '',
                displayName: suggested.displayName || '',
                confirmedBy,
                confirmedAt: now,
                source: 'auto-suggested'
            });
            count++;
        });

        if (count === 0) {
            this._toast('No suggestions to confirm.', 'info');
            return;
        }

        try {
            await batch.commit();
            this._toast(`Linked ${count} player(s).`, 'success');
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Batch link failed:', err);
            this._toast(`Could not confirm links: ${err.message}`, 'error');
        }
    }
```

- [ ] **Step 2: Verify it parses**

Run: `node --check BoardGame/full/scripts/discord-panel.js`
Expected: no output.

- [ ] **Step 3: Confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: PASS — 150 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/discord-panel.js
git commit -m "feat: Discord panel player-link table with batch confirm"
```

---

## Task 7: Kill Switch and Activity sections

**Files:**
- Modify: `BoardGame/full/scripts/discord-panel.js`

- [ ] **Step 1: Add both renderers**

In `BoardGame/full/scripts/discord-panel.js`, add these methods immediately after `confirmAllSuggestions` (add a comma after its closing brace):

```js
    // ── Kill switch ─────────────────────────────────────────────

    renderKillSwitch() {
        const host = document.getElementById('discordKillSwitch');
        if (!host) return;

        const enabled = this._config?.enabled === true;
        const configured = !!this._config?.guildId;

        host.innerHTML = `
            <div style="display:flex; align-items:center; gap:14px; padding:14px;
                        border-radius:10px; border:1px solid ${enabled ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'};
                        background:${enabled ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'};">
                <div style="flex:1;">
                    <div style="font-weight:600; color:${enabled ? '#22c55e' : '#ef4444'};">
                        Automatic moves are ${enabled ? 'ENABLED' : 'DISABLED'}
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-tertiary);">
                        ${enabled
                            ? 'Players are moved when a lobby opens and returned when a result is confirmed.'
                            : 'The bot will not move anyone. Nothing else is affected.'}
                    </div>
                </div>
                <button class="btn ${enabled ? 'secondary' : 'primary'}"
                        onclick="DiscordPanel.toggleEnabled()"
                        ${configured ? '' : 'disabled title="Save the setup first"'}>
                    ${enabled ? 'Disable' : 'Enable'}
                </button>
            </div>
        `;
    },

    /**
     * Disabling is instant — the safe direction should never have friction.
     * Enabling asks first, so nobody reactivates moves mid-break by
     * mis-clicking.
     */
    async toggleEnabled() {
        const ref = this._ref();
        if (!ref) return;

        const enabling = this._config?.enabled !== true;
        if (enabling) {
            const ok = await this._confirmEnable();
            if (!ok) return;
        }

        try {
            await ref.collection('discordConfig').doc('state')
                .set({ enabled: enabling }, { merge: true });
            this._toast(enabling ? 'Automatic moves enabled.' : 'Automatic moves disabled.', 'success');
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Toggle failed:', err);
            this._toast(`Could not change the kill switch: ${err.message}`, 'error');
        }
    },

    /** Modal confirm, matching the pattern used by team-controls.js. */
    _confirmEnable() {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';
            modal.innerHTML = `
                <div style="background: var(--bg-panel, rgba(20, 22, 30, 0.95)); padding:25px; border-radius:12px; max-width:430px; width:90%; color:white; border:2px solid rgba(34,197,94,0.4);">
                    <h3 style="color:#22c55e; margin-top:0;">Enable automatic moves?</h3>
                    <p style="line-height:1.6; color:#cbd5e1;">
                        Players will start being moved between voice channels automatically
                        when lobbies open and results are confirmed.
                    </p>
                    <div style="display:flex; gap:10px; margin-top:20px;">
                        <button id="discordEnableYes" class="btn primary" style="flex:1;">Enable</button>
                        <button id="discordEnableNo" class="btn secondary" style="flex:1;">Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#discordEnableYes').onclick = () => { modal.remove(); resolve(true); };
            modal.querySelector('#discordEnableNo').onclick = () => { modal.remove(); resolve(false); };
            modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(false); } });
        });
    },

    // ── Activity ────────────────────────────────────────────────

    /**
     * Live view of recent commands. Subscribed rather than fetched so a move
     * fired from admin.html shows up here without a manual refresh.
     */
    watchActivity() {
        const ref = this._ref();
        const host = document.getElementById('discordActivity');
        if (!ref || !host) return;

        if (this._activityUnsub) {
            this._activityUnsub();
            this._activityUnsub = null;
        }

        this._activityUnsub = ref.collection('discordCommands')
            .orderBy('requestedAt', 'desc')
            .limit(30)
            .onSnapshot(
                snap => {
                    const commands = [];
                    snap.forEach(doc => commands.push({ id: doc.id, ...doc.data() }));
                    this.renderActivity(commands);
                },
                err => {
                    console.error('[Discord Panel] Activity watch failed:', err);
                    host.innerHTML = `<h4>Activity</h4>
                        <p style="color:#ef4444; font-size:0.85rem;">Could not load activity: ${this._escape(err.message)}</p>`;
                }
            );
    },

    renderActivity(commands) {
        const host = document.getElementById('discordActivity');
        if (!host) return;

        const statusColour = status =>
            status === 'done' ? '#22c55e' : (status === 'pending' ? '#eab308' : '#ef4444');

        const rows = commands.map(command => {
            const results = (command.results || [])
                .map(r => `${this._escape(r.uid || r.playerId || '?')}: ${this._escape(r.outcome)}`)
                .join(', ');

            return `
                <tr>
                    <td style="color:var(--text-tertiary); white-space:nowrap;">
                        ${this._escape((command.requestedAt || '').replace('T', ' ').slice(0, 19))}
                    </td>
                    <td>${this._escape(command.type)}${command.slot ? ` (slot ${this._escape(command.slot)})` : ''}</td>
                    <td style="color:${statusColour(command.status)};">
                        ${this._escape(command.status || 'pending')}${command.reason ? ` — ${this._escape(command.reason)}` : ''}
                    </td>
                    <td style="color:var(--text-tertiary); font-size:0.8rem;">${results || '—'}</td>
                </tr>`;
        }).join('');

        host.innerHTML = `
            <h4 style="margin-bottom:10px;">Activity</h4>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <button class="btn secondary" onclick="DiscordPanel.moveNow('1')">Move now — match 1</button>
                <button class="btn secondary" onclick="DiscordPanel.moveNow('2')">Move now — match 2</button>
                <button class="btn secondary" onclick="DiscordPanel.moveNow('challenge')">Move now — challenge</button>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                <thead>
                    <tr style="text-align:left; color:var(--text-tertiary); font-size:0.8rem;">
                        <th>When</th><th>Command</th><th>Status</th><th>Results</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="4" style="color:var(--text-tertiary); padding:12px;">No commands yet.</td></tr>'}</tbody>
            </table>
        `;
    },

    /**
     * Manual re-fire for stragglers. force:true skips the staleness check —
     * its whole purpose is the case that check would reject, someone
     * arriving after the lobby phase moved on.
     */
    async moveNow(slot) {
        const id = await window.DiscordCommands?.request('pull', { slot, force: true });
        if (!id) {
            this._toast('Could not queue the move.', 'error');
            return;
        }
        this._toast(`Move queued for slot ${slot}.`, 'info');
    }
```

- [ ] **Step 2: Verify it parses**

Run: `node --check BoardGame/full/scripts/discord-panel.js`
Expected: no output.

- [ ] **Step 3: Confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: PASS — 150 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/discord-panel.js
git commit -m "feat: Discord panel kill switch and activity view"
```

---

## Task 8: Deploy and verify

Not automatable — needs the live Firebase project and a real Discord server.

- [ ] **Step 1: Deploy the backend changes**

Run: `firebase deploy --only functions`
Expected: `onDiscordCommand` updates successfully. The new `refresh-channels` branch ships with it.

- [ ] **Step 2: Publish the security rules**

The three Discord rule blocks already exist in the local `BoardGame/firestore.rules` (untracked by design). Paste that file's contents into Firebase console → Firestore → Rules → Publish.

**This is required before the panel can write anything** — `discordConfig`, `discordLinks`, and `discordCommands` are all default-denied until these rules are live, so every Save button will fail with a permission error.

- [ ] **Step 3: Verify the tab loads**

Open `god.html`, select a tournament, click the **Discord** tab.
Expected: the panel renders. With no config yet, Setup shows an empty Guild ID and the kill switch shows DISABLED with its button greyed out.

- [ ] **Step 4: Verify setup round-trips**

Enter the guild ID, click **Save setup**, then **Refresh channels**.
Expected: a toast confirms the save; after a few seconds the channel dropdowns populate with real voice-channel names. If it reports `channel-list-failed`, the bot lacks View Channels permission in that guild.

- [ ] **Step 5: Verify member refresh and linking**

Pick the five channels, save again, then click **Refresh members** in Player Links.
Expected: the table fills with roster players, each with a member dropdown. Players whose onboarding username exactly matches a guild member show "suggested"; the rest show "unlinked" on a red-tinted row.
Click **Confirm all suggestions** → those rows flip to "linked".

If members come back empty with `member-list-failed`, the **Server Members Intent** is not enabled in the Discord developer portal (Bot tab → Privileged Gateway Intents).

- [ ] **Step 6: Verify the kill switch**

Click **Enable** → the confirmation modal appears → confirm.
Expected: the banner turns green. Click **Disable** → it turns red immediately with no prompt.

- [ ] **Step 7: Verify a real move**

With the switch enabled and at least one player linked, have that player join the Waiting Room voice channel, then click **Move now — match 1**.
Expected: within a couple of seconds they are moved into the match-1 side-A channel, and a new row appears in Activity with `status: done` and `outcome: moved`.

Note: a Discord bot can never move the **server owner**, regardless of permissions. If the linked account owns the guild, expect `forbidden` — test with a non-owner account.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: corrections found during Discord panel verification"
```

---

## Out of scope

- Extending the panel to the `admin` role — stays `god`-only, matching the backend's `write: if isGod()` rules.
- Editing `slotChannels` for the `challenge` pseudo-slot: the backend supports it, but Setup exposes only slots 1 and 2. A challenge-slot pair can still be added by hand in Firestore if needed.
