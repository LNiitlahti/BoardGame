# Discord Voice Moves — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tournament players between Discord voice channels automatically when a match lobby opens and when a result is confirmed, driven by a Cloud Function with no always-on process.

**Architecture:** Client code writes a command doc to `tournaments/{tid}/discordCommands`. One Firestore-triggered Cloud Function reads it, checks a kill switch, plans the moves from stored player→Discord links, and calls the Discord REST API with a bounded retry schedule. Nothing triggers off the tournament document, so the function can write back to it without re-triggering itself.

**Tech Stack:** Node 20, `firebase-functions` v6 (2nd gen), `firebase-admin`, Discord REST API v10, `node:test` for unit tests. No new client dependencies.

**Spec:** [`../specs/2026-08-04-discord-voice-moves-design.md`](../specs/2026-08-04-discord-voice-moves-design.md)

**Scope:** This plan delivers the working backend plus the automatic client triggers. The feature is functional after this plan — moves happen on lobby open and result confirmation — but player→Discord links must be seeded by hand in the Firebase console. The god.html panel that manages links, the kill switch, and the activity log is a **separate follow-up plan**.

---

## File Structure

**New — Cloud Functions package** (must live under `functions/`; `firebase deploy` only uploads that directory, so these files cannot be shared with `BoardGame/shared/`):

| File | Responsibility |
|---|---|
| `functions/package.json` | Package manifest, Node 20 engine, test script |
| `functions/.gitignore` | Ignore `node_modules/` |
| `functions/lib/discord-move-planner.js` | **Pure.** Who moves where; whether a command is still current. No I/O. |
| `functions/lib/discord-rest.js` | Discord HTTP API wrapper. Injectable `fetch`. Owns status→outcome mapping. |
| `functions/lib/command-handler.js` | Orchestration: kill switch, staleness, retry loop, result writing. Injectable deps. |
| `functions/index.js` | Firebase trigger registration + secret binding. Thin. |
| `functions/test/discord-move-planner.test.js` | Unit tests for the planner |
| `functions/test/discord-rest.test.js` | Unit tests for status→outcome mapping |
| `functions/test/command-handler.test.js` | Unit tests for orchestration with fakes |

**New — repo root:**

| File | Responsibility |
|---|---|
| `firebase.json` | Firebase CLI config. **Functions only** — deliberately no `firestore` block, see Task 1. |

**New — client:**

| File | Responsibility |
|---|---|
| `BoardGame/full/scripts/discord-commands.js` | Fire-and-forget helper that queues a command doc |

**Modified:**

| File | Change |
|---|---|
| `BoardGame/firestore.rules` | Three new subcollection rule blocks |
| `BoardGame/full/scripts/phase-manager.js:1158` | Queue a `pull` when a slot enters `lobby` |
| `BoardGame/full/scripts/result-manager.js:515` | Queue a `return` when a match completes |
| `BoardGame/full/admin.html`, `BoardGame/full/god.html` | Add the `discord-commands.js` script tag |

**Baseline test commands** (this repo has no root `package.json`):

- Browser-code tests: `node --test "BoardGame/dev/tests/*.test.js"` → 139 passing before this plan.
- Functions tests: `cd functions; npm test`

---

## Task 1: Functions package scaffold

**Files:**
- Create: `functions/package.json`
- Create: `functions/.gitignore`
- Create: `firebase.json`

- [ ] **Step 1: Create the functions package manifest**

`functions/package.json`:

```json
{
  "name": "boardgame-functions",
  "description": "Discord voice-channel moves for the BoardGame tournament system",
  "private": true,
  "main": "index.js",
  "engines": {
    "node": "20"
  },
  "scripts": {
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "firebase-admin": "^12.6.0",
    "firebase-functions": "^6.1.0"
  }
}
```

- [ ] **Step 2: Ignore installed dependencies**

`functions/.gitignore`:

```
node_modules/
```

- [ ] **Step 3: Create the Firebase CLI config**

`firebase.json`:

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "test",
        "*.local"
      ]
    }
  ]
}
```

**Do not add a `firestore` block.** Firestore rules are currently deployed by hand through the console, and the repo copy of `BoardGame/firestore.rules` is not guaranteed to match what is live. A `firestore` block would let a stray `firebase deploy` overwrite live security rules with a possibly-stale file. Rules stay a manual, deliberate step (Task 8).

- [ ] **Step 4: Install dependencies**

Run: `cd functions; npm install`
Expected: `node_modules/` created, no errors. `npm ls firebase-functions` shows v6.x.

- [ ] **Step 5: Verify the test script runs with no tests yet**

Run: `cd functions; npm test`
Expected: exits non-zero with "Could not find" — there are no test files yet. This confirms the script is wired. Proceed.

- [ ] **Step 6: Commit**

```bash
git add functions/package.json functions/.gitignore functions/package-lock.json firebase.json
git commit -m "chore: scaffold Cloud Functions package for Discord voice moves"
```

---

## Task 2: Pure move planner

The planner answers two questions with no I/O: *who moves where*, and *is this command still current*. Everything else in the system depends on it, so it is built first and tested hardest.

Player identity needs care. A match side lists player **ids** (roster slot ids like `"1a"`, or numeric ids). Discord links are keyed by **uid** (Firebase account id). Team rosters carry both, and `uid` is optional — `phase-manager.js:1407` shows roster players without an account are skipped from ready checks. The planner bridges id→uid via the team rosters and treats a missing uid as `unlinked`.

**Files:**
- Create: `functions/lib/discord-move-planner.js`
- Test: `functions/test/discord-move-planner.test.js`

- [ ] **Step 1: Write the failing tests**

`functions/test/discord-move-planner.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { planMoves, isCommandCurrent } = require('../lib/discord-move-planner');

const CONFIG = {
    waitingRoomChannelId: 'chWait',
    slotChannels: { '1': ['chAlpha', 'chBravo'], '2': ['chCharlie', 'chDelta'] }
};

const TEAMS = [
    { id: 1, players: [{ id: '1a', uid: 'uidA' }, { id: '1b', uid: 'uidB' }] },
    { id: 2, players: [{ id: '2a', uid: 'uidC' }, { id: '2b' }] }
];

const LINKS = {
    uidA: { discordUserId: 'dA' },
    uidB: { discordUserId: 'dB' },
    uidC: { discordUserId: 'dC' }
};

const MATCH = {
    id: 'm1',
    sides: [{ playerIds: ['1a', '1b'] }, { playerIds: ['2a', '2b'] }]
};

test('pull maps each side to its slot channel by side index', () => {
    const { moves } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => [m.discordUserId, m.channelId]), [
        ['dA', 'chAlpha'], ['dB', 'chAlpha'], ['dC', 'chBravo']
    ]);
});

test('slot 2 uses the second channel pair', () => {
    const { moves } = planMoves({
        match: MATCH, teams: TEAMS, slot: '2', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual([...new Set(moves.map(m => m.channelId))], ['chCharlie', 'chDelta']);
});

test('return sends everyone to the waiting room regardless of side', () => {
    const { moves } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'return', links: LINKS, config: CONFIG
    });
    assert.strictEqual(moves.length, 3);
    assert.ok(moves.every(m => m.channelId === 'chWait'));
});

test('roster player without a uid is skipped as unlinked', () => {
    const { skipped } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(skipped, [{ playerId: '2b', uid: null, outcome: 'unlinked' }]);
});

test('player with a uid but no confirmed link is skipped as unlinked', () => {
    const { moves, skipped } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull',
        links: { uidA: { discordUserId: 'dA' } }, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => m.uid), ['uidA']);
    assert.deepStrictEqual(skipped.map(s => s.uid), ['uidB', 'uidC', null]);
});

test('missing channel for a side yields no_channel, not a crash', () => {
    const { moves, skipped } = planMoves({
        match: MATCH, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS,
        config: { waitingRoomChannelId: 'chWait', slotChannels: { '1': ['chAlpha'] } }
    });
    assert.deepStrictEqual(moves.map(m => m.uid), ['uidA', 'uidB']);
    assert.deepStrictEqual(
        skipped.filter(s => s.outcome === 'no_channel').map(s => s.uid), ['uidC']
    );
});

test('reads the legacy `teams` key on a match as well as `sides`', () => {
    const legacy = { id: 'm2', teams: [{ playerIds: ['1a'] }, { playerIds: ['2a'] }] };
    const { moves } = planMoves({
        match: legacy, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => m.channelId), ['chAlpha', 'chBravo']);
});

test('mixed-roster side collects players from more than one team', () => {
    const mixed = { id: 'm3', sides: [{ playerIds: ['1a', '2a'] }, { playerIds: ['1b'] }] };
    const { moves } = planMoves({
        match: mixed, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => [m.uid, m.channelId]), [
        ['uidA', 'chAlpha'], ['uidC', 'chAlpha'], ['uidB', 'chBravo']
    ]);
});

test('side.players[].id is read when playerIds is absent', () => {
    const objSide = { id: 'm4', sides: [{ players: [{ id: '1a' }] }, { players: [{ id: '2a' }] }] };
    const { moves } = planMoves({
        match: objSide, teams: TEAMS, slot: '1', direction: 'pull', links: LINKS, config: CONFIG
    });
    assert.deepStrictEqual(moves.map(m => m.uid), ['uidA', 'uidC']);
});

test('pull is current only while its slot is in lobby', () => {
    const gs = { currentPhase: { name: 'matches_in_progress', slots: { 1: 'lobby', 2: 'setup' } } };
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: '1' }), true);
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: '2' }), false);
});

test('pull for the challenge slot keys off the challenge phase', () => {
    const gs = { currentPhase: { name: 'challenge_game' } };
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: 'challenge' }), true);
    assert.strictEqual(
        isCommandCurrent({ currentPhase: { name: 'break' } }, { type: 'pull', slot: 'challenge' }),
        false
    );
});

test('return is current only once the match is completed', () => {
    const gs = { gameQueue: [{ id: 'm1', status: 'ongoing' }] };
    assert.strictEqual(isCommandCurrent(gs, { type: 'return', matchId: 'm1' }), false);
    assert.strictEqual(
        isCommandCurrent({ gameQueue: [{ id: 'm1', status: 'completed' }] },
            { type: 'return', matchId: 'm1' }),
        true
    );
});

test('force bypasses every staleness check', () => {
    const gs = { currentPhase: { name: 'break' }, gameQueue: [] };
    assert.strictEqual(isCommandCurrent(gs, { type: 'pull', slot: '1', force: true }), true);
    assert.strictEqual(isCommandCurrent(gs, { type: 'return', matchId: 'zzz', force: true }), true);
});

test('refresh-members is always current', () => {
    assert.strictEqual(isCommandCurrent({}, { type: 'refresh-members' }), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions; npm test`
Expected: FAIL — `Cannot find module '../lib/discord-move-planner'`

- [ ] **Step 3: Implement the planner**

`functions/lib/discord-move-planner.js`:

```js
/**
 * Pure planning decisions for Discord voice moves. No I/O, no Firestore,
 * no network — everything here is a function of its arguments so it can be
 * tested exhaustively without a harness.
 *
 * Two responsibilities:
 *   planMoves()      — who moves to which channel
 *   isCommandCurrent() — whether a queued command still reflects reality
 */

/**
 * Map roster player id -> Firebase uid across every team.
 *
 * Roster players may have no `uid` at all (onboarding-created players who
 * never registered an account). Those are simply absent from the map, and
 * planMoves treats them as unlinked — the same way
 * _getPlayersWhoMustReadyForSlot skips them for ready checks.
 */
function buildUidByPlayerId(teams) {
    const map = new Map();
    (teams || []).forEach(team => {
        (team.players || []).forEach(player => {
            if (player.id !== undefined && player.uid) {
                map.set(String(player.id), player.uid);
            }
        });
    });
    return map;
}

/**
 * Player ids on one side of a match, de-duplicated. Sides carry ids in
 * `playerIds`, in `players[].id`, or both depending on how the match was
 * created (auto-generated vs. hand-built vs. challenge).
 */
function sidePlayerIds(side) {
    const ids = new Set();
    (side.playerIds || []).forEach(id => ids.add(String(id)));
    (side.players || []).forEach(player => {
        if (player.id !== undefined) ids.add(String(player.id));
    });
    return [...ids];
}

/**
 * Plan the moves for one command.
 *
 * @returns {{moves: Array, skipped: Array}} `moves` are actionable;
 *   `skipped` carry a terminal outcome and are reported without an API call.
 */
function planMoves({ match, teams, slot, direction, links, config }) {
    const sides = match.sides || match.teams || [];
    const uidByPlayerId = buildUidByPlayerId(teams);
    const slotChannels = (config.slotChannels || {})[String(slot)] || [];

    const moves = [];
    const skipped = [];

    sides.forEach((side, sideIndex) => {
        const channelId = direction === 'return'
            ? config.waitingRoomChannelId
            : slotChannels[sideIndex];

        sidePlayerIds(side).forEach(playerId => {
            const uid = uidByPlayerId.get(playerId) || null;

            if (!uid || !links[uid]?.discordUserId) {
                skipped.push({ playerId, uid, outcome: 'unlinked' });
                return;
            }
            if (!channelId) {
                skipped.push({ playerId, uid, outcome: 'no_channel' });
                return;
            }
            moves.push({
                playerId,
                uid,
                discordUserId: links[uid].discordUserId,
                channelId
            });
        });
    });

    return { moves, skipped };
}

/**
 * Is this command still worth acting on?
 *
 * Commands are queued by client code and executed asynchronously, so a slow
 * function start or a duplicate delivery can arrive after the world moved
 * on. Pulling players into a match that already started would yank them
 * mid-game, so `pull` requires its slot to still be in lobby.
 *
 * `force: true` (set only by the manual "move now" control) skips the check
 * entirely — its whole purpose is the straggler case this would reject.
 */
function isCommandCurrent(gameState, command) {
    if (command.force) return true;

    const phase = (gameState && gameState.currentPhase) || {};

    if (command.type === 'pull') {
        if (String(command.slot) === 'challenge') {
            return phase.name === 'challenge_game';
        }
        return phase.name === 'matches_in_progress'
            && (phase.slots || {})[command.slot] === 'lobby';
    }

    if (command.type === 'return') {
        const entry = ((gameState && gameState.gameQueue) || [])
            .find(m => String(m.id) === String(command.matchId));
        return !!entry && entry.status === 'completed';
    }

    return true;
}

module.exports = { planMoves, isCommandCurrent };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions; npm test`
Expected: PASS — 14 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/discord-move-planner.js functions/test/discord-move-planner.test.js
git commit -m "feat: pure move planner for Discord voice moves"
```

---

## Task 3: Discord REST client

Wraps two endpoints and — the part that matters — maps HTTP responses onto the outcome vocabulary the rest of the system reasons about. Getting `400 code 40032` classified as `not_in_voice` rather than a generic error is what makes the retry loop behave correctly.

**Files:**
- Create: `functions/lib/discord-rest.js`
- Test: `functions/test/discord-rest.test.js`

- [ ] **Step 1: Write the failing tests**

`functions/test/discord-rest.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createDiscordRest } = require('../lib/discord-rest');

function fakeResponse({ status, body }) {
    return {
        status,
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

function restWith(responses) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra fetch call');
        if (next instanceof Error) throw next;
        return fakeResponse(next);
    };
    return { rest: createDiscordRest({ token: 'tok', fetchImpl }), calls };
}

test('204 is a successful move', async () => {
    const { rest, calls } = restWith([{ status: 204, body: null }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.deepStrictEqual(result, { outcome: 'moved' });
    assert.strictEqual(calls[0].url, 'https://discord.com/api/v10/guilds/g/members/u');
    assert.strictEqual(calls[0].options.method, 'PATCH');
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bot tok');
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), { channel_id: 'c' });
});

test('400 with code 40032 is not_in_voice', async () => {
    const { rest } = restWith([
        { status: 400, body: { code: 40032, message: 'Target user is not connected to voice.' } }
    ]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'not_in_voice');
});

test('400 with any other code is a generic error, not not_in_voice', async () => {
    const { rest } = restWith([{ status: 400, body: { code: 50035, message: 'Invalid Form Body' } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /Invalid Form Body/);
});

test('403 is forbidden', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Permissions' } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'forbidden');
});

test('404 is not_in_guild', async () => {
    const { rest } = restWith([{ status: 404, body: { message: 'Unknown Member' } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'not_in_guild');
});

test('429 reports retry_after in milliseconds', async () => {
    const { rest } = restWith([{ status: 429, body: { retry_after: 1.5 } }]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'rate_limited');
    assert.strictEqual(result.retryAfterMs, 1500);
});

test('a thrown network error becomes a retryable error outcome', async () => {
    const { rest } = restWith([new Error('ECONNRESET')]);
    const result = await rest.moveMember({ guildId: 'g', discordUserId: 'u', channelId: 'c' });
    assert.strictEqual(result.outcome, 'error');
    assert.match(result.error, /ECONNRESET/);
});

test('listGuildMembers normalises the member shape', async () => {
    const { rest, calls } = restWith([{
        status: 200,
        body: [
            { user: { id: '1', username: 'alpha', global_name: 'Alpha' }, nick: 'AlphaNick' },
            { user: { id: '2', username: 'beta', global_name: null }, nick: null }
        ]
    }]);
    const result = await rest.listGuildMembers({ guildId: 'g' });
    assert.deepStrictEqual(result, {
        outcome: 'ok',
        members: [
            { discordUserId: '1', username: 'alpha', displayName: 'AlphaNick' },
            { discordUserId: '2', username: 'beta', displayName: 'beta' }
        ]
    });
    assert.match(calls[0].url, /\/guilds\/g\/members\?limit=1000$/);
});

test('listGuildMembers surfaces a failure instead of pretending the guild is empty', async () => {
    const { rest } = restWith([{ status: 403, body: { message: 'Missing Access' } }]);
    const result = await rest.listGuildMembers({ guildId: 'g' });
    assert.strictEqual(result.outcome, 'error');
    assert.strictEqual(result.members, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions; npm test`
Expected: FAIL — `Cannot find module '../lib/discord-rest'`

- [ ] **Step 3: Implement the REST client**

`functions/lib/discord-rest.js`:

```js
/**
 * Thin wrapper over the Discord HTTP API.
 *
 * Owns exactly one piece of judgement: translating HTTP responses into the
 * outcome vocabulary the rest of the system uses. Everything downstream
 * decides retry-vs-give-up from that outcome, so the mapping lives in one
 * place rather than being re-derived from status codes at each call site.
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */

const API_BASE = 'https://discord.com/api/v10';

/** Discord's error code for "Target user is not connected to voice." */
const ERR_NOT_IN_VOICE = 40032;

function createDiscordRest({ token, fetchImpl = fetch }) {

    async function request(method, path, body) {
        return fetchImpl(API_BASE + path, {
            method,
            headers: {
                Authorization: `Bot ${token}`,
                'Content-Type': 'application/json'
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    }

    async function readJson(res) {
        try {
            return await res.json();
        } catch {
            return null;
        }
    }

    /**
     * Move one member into a voice channel.
     *
     * Discord requires the member to ALREADY be connected to some voice
     * channel — you cannot pull someone who is not in voice at all. That
     * case comes back as 400/40032 and is mapped to `not_in_voice`, which
     * the caller retries, because it is a condition that changes over time
     * as people join.
     */
    async function moveMember({ guildId, discordUserId, channelId }) {
        let res;
        try {
            res = await request('PATCH', `/guilds/${guildId}/members/${discordUserId}`, {
                channel_id: channelId
            });
        } catch (err) {
            return { outcome: 'error', error: String(err && err.message ? err.message : err) };
        }

        if (res.status === 204) return { outcome: 'moved' };

        const body = await readJson(res);

        if (res.status === 429) {
            const retryAfter = Number(body && body.retry_after);
            return {
                outcome: 'rate_limited',
                retryAfterMs: Math.ceil((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000)
            };
        }
        if (res.status === 403) {
            return { outcome: 'forbidden', error: (body && body.message) || 'Missing Permissions' };
        }
        if (res.status === 404) {
            return { outcome: 'not_in_guild', error: (body && body.message) || 'Unknown Member' };
        }
        if (res.status === 400 && body && body.code === ERR_NOT_IN_VOICE) {
            return { outcome: 'not_in_voice', error: body.message };
        }
        return {
            outcome: 'error',
            error: `HTTP ${res.status}: ${(body && body.message) || 'unknown error'}`
        };
    }

    /**
     * List guild members for the link dropdown.
     *
     * Requires the GUILD_MEMBERS privileged intent to be enabled in the
     * Discord developer portal. Without it this returns an error rather
     * than an empty list — an empty list would look like "this guild has no
     * members", which is indistinguishable from a working call and would
     * silently produce a blank dropdown.
     */
    async function listGuildMembers({ guildId, limit = 1000 }) {
        let res;
        try {
            res = await request('GET', `/guilds/${guildId}/members?limit=${limit}`);
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
            members: body.map(member => ({
                discordUserId: member.user.id,
                username: member.user.username,
                displayName: member.nick || member.user.global_name || member.user.username
            }))
        };
    }

    return { moveMember, listGuildMembers };
}

module.exports = { createDiscordRest };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions; npm test`
Expected: PASS — 23 tests total (14 planner + 9 REST), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/discord-rest.js functions/test/discord-rest.test.js
git commit -m "feat: Discord REST client with outcome classification"
```

---

## Task 4: Command handler — kill switch, staleness, and move execution

The orchestrator. Every dependency is injected (`db`, `rest`, `sleep`) so the whole thing is testable without Firestore or network, including the retry schedule — a fake `sleep` makes a two-minute retry window run in microseconds.

**Retry schedule:** attempts at t = 0, 1, 3, 7, 15, 31, 63, 120 seconds. That is waits of 1, 2, 4, 8, 16, 32, then 57 to land exactly on the 2-minute ceiling. Eight attempts total.

**Files:**
- Create: `functions/lib/command-handler.js`
- Test: `functions/test/command-handler.test.js`

- [ ] **Step 1: Write the failing tests**

`functions/test/command-handler.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { handleCommand, RETRY_DELAYS_MS } = require('../lib/command-handler');

const CONFIG = {
    enabled: true,
    guildId: 'g1',
    waitingRoomChannelId: 'chWait',
    slotChannels: { '1': ['chAlpha', 'chBravo'] }
};

const GAME_STATE = {
    currentPhase: { name: 'matches_in_progress', slots: { 1: 'lobby' } },
    gameQueue: [{ id: 'm1', status: 'ongoing' }],
    teams: [{ id: 1, players: [{ id: '1a', uid: 'uidA' }, { id: '2a', uid: 'uidB' }] }]
};

const MATCH = { id: 'm1', sides: [{ playerIds: ['1a'] }, { playerIds: ['2a'] }] };

/**
 * Minimal in-memory stand-in for the Firestore surface handleCommand uses.
 * Records tournament updates so tests can assert on lobbyReady writes.
 */
function fakeDb({ config = CONFIG, gameState = GAME_STATE, links = {} } = {}) {
    const updates = [];
    const configWrites = [];
    return {
        updates,
        configWrites,
        tournament(tid) {
            return {
                async getGameState() { return gameState; },
                async getConfig() { return config; },
                async getLinks() { return links; },
                async getMatch() { return MATCH; },
                async updateGameState(patch) { updates.push(patch); },
                async writeMemberCache(data) { configWrites.push(data); }
            };
        }
    };
}

function fakeRest(moveResults) {
    const calls = [];
    return {
        calls,
        async moveMember(args) {
            calls.push(args);
            const next = moveResults.shift();
            return next || { outcome: 'moved' };
        },
        async listGuildMembers() {
            return { outcome: 'ok', members: [{ discordUserId: 'd1', username: 'u', displayName: 'U' }] };
        }
    };
}

const noSleep = async () => {};

test('a disabled kill switch skips everything and moves nobody', async () => {
    const db = fakeDb({ config: { ...CONFIG, enabled: false } });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(rest.calls.length, 0);
});

test('a stale pull is skipped without moving anyone', async () => {
    const db = fakeDb({
        gameState: { ...GAME_STATE, currentPhase: { name: 'matches_in_progress', slots: { 1: 'playing' } } }
    });
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'stale');
    assert.strictEqual(rest.calls.length, 0);
});

test('force overrides staleness and moves linked players', async () => {
    const db = fakeDb({
        gameState: { ...GAME_STATE, currentPhase: { name: 'break' } },
        links: { uidA: { discordUserId: 'dA' } }
    });
    const rest = fakeRest([{ outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1', force: true }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(rest.calls.length, 1);
    assert.strictEqual(rest.calls[0].channelId, 'chAlpha');
});

test('unlinked players are reported without any API call', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 1);
    const byUid = Object.fromEntries(result.results.map(r => [r.uid, r.outcome]));
    assert.deepStrictEqual(byUid, { uidA: 'moved', uidB: 'unlinked' });
});

test('not_in_voice is retried on the backoff schedule then reported', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest(Array(RETRY_DELAYS_MS.length + 1).fill({ outcome: 'not_in_voice' }));
    const waits = [];
    const result = await handleCommand({
        db, rest, sleep: async ms => { waits.push(ms); },
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, RETRY_DELAYS_MS.length + 1);
    assert.deepStrictEqual(waits, RETRY_DELAYS_MS);
    assert.strictEqual(result.results.find(r => r.uid === 'uidA').outcome, 'not_in_voice');
});

test('a player who joins voice mid-window is moved and not retried again', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'not_in_voice' }, { outcome: 'moved' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 2);
    assert.strictEqual(result.results.find(r => r.uid === 'uidA').outcome, 'moved');
});

test('forbidden is terminal and never retried', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'forbidden', error: 'Missing Permissions' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 1);
    assert.strictEqual(result.results.find(r => r.uid === 'uidA').outcome, 'forbidden');
});

test('not_in_guild is terminal and never retried', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'not_in_guild', error: 'Unknown Member' }]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls.length, 1);
});

test('rate_limited waits the retry_after the API asked for', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'rate_limited', retryAfterMs: 250 }, { outcome: 'moved' }]);
    const waits = [];
    await handleCommand({
        db, rest, sleep: async ms => { waits.push(ms); },
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.deepStrictEqual(waits, [250]);
});

test('a successful pull marks the player Discord-ready', async () => {
    const db = fakeDb({ links: { uidA: { discordUserId: 'dA' } } });
    const rest = fakeRest([{ outcome: 'moved' }]);
    await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'pull', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(db.updates.length, 1);
    assert.strictEqual(db.updates[0]['lobbyReady.uidA.discord'], true);
});

test('a return does NOT mark anyone Discord-ready', async () => {
    const db = fakeDb({
        gameState: { ...GAME_STATE, gameQueue: [{ id: 'm1', status: 'completed' }] },
        links: { uidA: { discordUserId: 'dA' } }
    });
    const rest = fakeRest([{ outcome: 'moved' }]);
    await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'return', slot: '1', matchId: 'm1' }
    });
    assert.strictEqual(rest.calls[0].channelId, 'chWait');
    assert.strictEqual(db.updates.length, 0);
});

test('refresh-members writes the member cache', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'refresh-members' }
    });
    assert.strictEqual(result.status, 'done');
    assert.strictEqual(db.configWrites.length, 1);
    assert.strictEqual(db.configWrites[0].count, 1);
    assert.strictEqual(db.configWrites[0].members[0].discordUserId, 'd1');
});

test('an unknown command type is skipped rather than throwing', async () => {
    const db = fakeDb();
    const rest = fakeRest([]);
    const result = await handleCommand({
        db, rest, sleep: noSleep,
        tournamentId: 't1',
        command: { type: 'explode' }
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'unknown-type');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions; npm test`
Expected: FAIL — `Cannot find module '../lib/command-handler'`

- [ ] **Step 3: Implement the command handler**

`functions/lib/command-handler.js`:

```js
/**
 * Orchestration for one Discord command.
 *
 * All I/O is injected (`db`, `rest`, `sleep`) so the whole flow — including
 * the two-minute retry window — is testable in microseconds with fakes.
 */

const { planMoves, isCommandCurrent } = require('./discord-move-planner');

/**
 * Waits between move attempts, in ms. Produces attempts at
 * t = 0, 1, 3, 7, 15, 31, 63, 120 seconds: aggressive early (someone who is
 * three seconds late gets pulled almost immediately), sparse later, hard
 * stop at two minutes.
 *
 * Bounded deliberately. An unbounded loop would drag back a player who left
 * the channel on purpose.
 */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 57000];

/**
 * Outcomes that will never change by trying again: either it worked, or
 * retrying cannot fix it (bad permissions, wrong id, no link, no channel).
 * Everything else — not_in_voice, transient errors, rate limits — is worth
 * another attempt inside the window.
 */
const TERMINAL_OUTCOMES = new Set([
    'moved', 'unlinked', 'no_channel', 'forbidden', 'not_in_guild'
]);

async function handleCommand({ db, rest, sleep, tournamentId, command }) {
    const tournament = db.tournament(tournamentId);

    const config = await tournament.getConfig();
    if (!config || config.enabled === false) {
        return { status: 'skipped', reason: 'disabled', results: [] };
    }

    if (command.type === 'refresh-members') {
        const listed = await rest.listGuildMembers({ guildId: config.guildId });
        if (listed.outcome !== 'ok') {
            return { status: 'skipped', reason: 'member-list-failed', error: listed.error, results: [] };
        }
        await tournament.writeMemberCache({
            members: listed.members,
            count: listed.members.length,
            refreshedAt: new Date().toISOString()
        });
        return { status: 'done', results: [] };
    }

    if (command.type !== 'pull' && command.type !== 'return') {
        return { status: 'skipped', reason: 'unknown-type', results: [] };
    }

    const gameState = await tournament.getGameState();
    if (!isCommandCurrent(gameState, command)) {
        return { status: 'skipped', reason: 'stale', results: [] };
    }

    const match = await tournament.getMatch(command.matchId, command.slot);
    if (!match) {
        return { status: 'skipped', reason: 'match-not-found', results: [] };
    }

    const links = await tournament.getLinks();
    const { moves, skipped } = planMoves({
        match,
        teams: gameState.teams,
        slot: command.slot,
        direction: command.type === 'return' ? 'return' : 'pull',
        links,
        config
    });

    // Skipped players already carry a terminal outcome — report, never call.
    const results = skipped.map(s => ({
        uid: s.uid, playerId: s.playerId, outcome: s.outcome
    }));

    // Pending work, mutated in place as players succeed and drop out.
    let pending = moves.map(move => ({ ...move, outcome: null, error: null }));

    for (let attempt = 0; pending.length > 0; attempt++) {
        for (const item of pending) {
            const res = await rest.moveMember({
                guildId: config.guildId,
                discordUserId: item.discordUserId,
                channelId: item.channelId
            });
            item.outcome = res.outcome;
            item.error = res.error || null;
            item.retryAfterMs = res.retryAfterMs;
        }

        const done = pending.filter(i => TERMINAL_OUTCOMES.has(i.outcome));
        done.forEach(i => results.push({
            uid: i.uid, playerId: i.playerId, discordUserId: i.discordUserId,
            channelId: i.channelId, outcome: i.outcome, error: i.error
        }));

        // A successful move IS the confirmation the player is in the right
        // channel — better evidence than the self-reported checkbox.
        if (command.type === 'pull') {
            const moved = done.filter(i => i.outcome === 'moved');
            if (moved.length > 0) {
                const patch = {};
                const now = new Date().toISOString();
                moved.forEach(i => {
                    patch[`lobbyReady.${i.uid}.discord`] = true;
                    patch[`lobbyReady.${i.uid}.discordAt`] = now;
                });
                await tournament.updateGameState(patch);
            }
        }

        pending = pending.filter(i => !TERMINAL_OUTCOMES.has(i.outcome));
        if (pending.length === 0) break;

        if (attempt >= RETRY_DELAYS_MS.length) {
            // Window exhausted — report whoever is still missing.
            pending.forEach(i => results.push({
                uid: i.uid, playerId: i.playerId, discordUserId: i.discordUserId,
                channelId: i.channelId, outcome: i.outcome, error: i.error
            }));
            break;
        }

        // A 429 tells us exactly how long to wait; otherwise use the schedule.
        const rateLimited = pending
            .map(i => i.retryAfterMs)
            .filter(ms => Number.isFinite(ms));
        const wait = rateLimited.length > 0
            ? Math.max(...rateLimited)
            : RETRY_DELAYS_MS[attempt];
        await sleep(wait);
    }

    return { status: 'done', results };
}

module.exports = { handleCommand, RETRY_DELAYS_MS, TERMINAL_OUTCOMES };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions; npm test`
Expected: PASS — 36 tests total, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/command-handler.js functions/test/command-handler.test.js
git commit -m "feat: Discord command handler with bounded retry window"
```

---

## Task 5: Firestore adapter and function entry point

Wires the tested core to real Firestore and registers the trigger. Kept deliberately thin — logic that could be tested belongs in Tasks 2–4, not here.

**Files:**
- Create: `functions/lib/firestore-adapter.js`
- Create: `functions/index.js`

- [ ] **Step 1: Write the Firestore adapter**

`functions/lib/firestore-adapter.js`:

```js
/**
 * Adapts real Firestore to the narrow surface command-handler expects.
 * Exists so the handler can be tested against a plain object; every method
 * here is a one-liner over the Admin SDK.
 */

function createFirestoreDb(firestore) {
    return {
        tournament(tournamentId) {
            const ref = firestore.collection('tournaments').doc(tournamentId);

            return {
                async getGameState() {
                    const snap = await ref.get();
                    return snap.exists ? snap.data() : null;
                },

                async getConfig() {
                    const snap = await ref.collection('discordConfig').doc('state').get();
                    return snap.exists ? snap.data() : null;
                },

                async getLinks() {
                    const snap = await ref.collection('discordLinks').get();
                    const links = {};
                    snap.forEach(doc => { links[doc.id] = doc.data(); });
                    return links;
                },

                /**
                 * Matches live inside the tournament doc's gameQueue array,
                 * not in their own collection. `matchId` is preferred; the
                 * slot fallback covers commands queued before an id was
                 * known (a slot entering lobby knows its slot, not yet which
                 * queue entry the admin will start).
                 */
                async getMatch(matchId, slot) {
                    const snap = await ref.get();
                    if (!snap.exists) return null;
                    const queue = snap.data().gameQueue || [];

                    if (matchId) {
                        const byId = queue.find(m => String(m.id) === String(matchId));
                        if (byId) return byId;
                    }
                    if (String(slot) === 'challenge') {
                        return queue.find(m => m.isChallenge === true && m.status !== 'completed') || null;
                    }
                    return queue.find(m =>
                        m.isChallenge !== true &&
                        !m.isBreak &&
                        m.status !== 'completed' &&
                        String(m.slot) === String(slot)
                    ) || null;
                },

                async updateGameState(patch) {
                    await ref.update(patch);
                },

                async writeMemberCache(data) {
                    await ref.collection('discordConfig').doc('memberCache').set(data);
                }
            };
        }
    };
}

module.exports = { createFirestoreDb };
```

- [ ] **Step 2: Write the function entry point**

`functions/index.js`:

```js
/**
 * Discord voice-channel moves.
 *
 * Triggers ONLY on tournaments/{tid}/discordCommands/{cmdId}. It must never
 * trigger on the tournament document: that doc is written on every gameplay
 * action, and this function writes back to it (lobbyReady), which would be
 * an unbounded self-retrigger loop.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const { createDiscordRest } = require('./lib/discord-rest');
const { createFirestoreDb } = require('./lib/firestore-adapter');
const { handleCommand } = require('./lib/command-handler');

admin.initializeApp();

const DISCORD_BOT_TOKEN = defineSecret('DISCORD_BOT_TOKEN');

// Cost backstop. This workload is a handful of invocations per match; a
// cap this low makes a runaway impossible while never throttling real use.
setGlobalOptions({ maxInstances: 3, region: 'europe-north1' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.onDiscordCommand = onDocumentCreated(
    {
        document: 'tournaments/{tournamentId}/discordCommands/{commandId}',
        secrets: [DISCORD_BOT_TOKEN],
        // The retry window is 2 minutes; allow headroom for it plus API latency.
        timeoutSeconds: 300,
        memory: '256MiB'
    },
    async event => {
        const snap = event.data;
        if (!snap) return;

        const command = snap.data();
        const { tournamentId } = event.params;

        const db = createFirestoreDb(admin.firestore());
        const rest = createDiscordRest({ token: DISCORD_BOT_TOKEN.value() });

        let outcome;
        try {
            outcome = await handleCommand({ db, rest, sleep, tournamentId, command });
        } catch (err) {
            console.error('[Discord] Command failed', err);
            outcome = { status: 'skipped', reason: 'error', error: String(err.message || err), results: [] };
        }

        await snap.ref.update({
            status: outcome.status,
            reason: outcome.reason || null,
            error: outcome.error || null,
            results: outcome.results || [],
            completedAt: new Date().toISOString()
        });
    }
);
```

- [ ] **Step 3: Verify the module loads without syntax errors**

Run: `cd functions; node -e "require('./lib/firestore-adapter'); console.log('adapter ok')"`
Expected: `adapter ok`

- [ ] **Step 4: Re-run the test suite to confirm nothing regressed**

Run: `cd functions; npm test`
Expected: PASS — 36 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/firestore-adapter.js functions/index.js
git commit -m "feat: Firestore adapter and onDiscordCommand trigger"
```

---

## Task 6: Firestore security rules

**Files:**
- Modify: `BoardGame/firestore.rules` — insert after the `chatTeams` block, before the closing brace of `match /tournaments/{tournamentId}` (currently line 215)

- [ ] **Step 1: Add the three rule blocks**

Insert immediately after the closing `}` of the `chatTeams/{teamId}/messages/{messageId}` block:

```
      // -------------------------------------------------------------------
      // 2g. DISCORD CONFIG — tournaments/{tid}/discordConfig/{docId}
      // -------------------------------------------------------------------
      // Guild/channel ids, the bot kill switch, and the cached guild member
      // list. God-only writes: this is where the kill switch lives.
      match /discordConfig/{docId} {
        allow read:  if isAdmin();
        allow write: if isGod();
      }


      // -------------------------------------------------------------------
      // 2h. DISCORD LINKS — tournaments/{tid}/discordLinks/{playerUid}
      // -------------------------------------------------------------------
      // Confirmed player -> Discord account links. Only linked players are
      // ever moved, so write access here is effectively "who can the bot
      // move" — god-only.
      match /discordLinks/{playerUid} {
        allow read:  if isAdmin();
        allow write: if isGod();
      }


      // -------------------------------------------------------------------
      // 2i. DISCORD COMMANDS — tournaments/{tid}/discordCommands/{cmdId}
      // -------------------------------------------------------------------
      // Move requests. Admin-created because the automatic triggers fire
      // from admin.html's phase/result flow. Results are written back by the
      // Cloud Function via the Admin SDK, which bypasses these rules — so
      // update is closed to every client and no one can forge an outcome.
      // Commands are the permanent audit trail; nothing deletes them.
      match /discordCommands/{cmdId} {
        allow read:   if isAdmin();
        allow create: if isAdmin();
        allow update, delete: if false;
      }
```

- [ ] **Step 2: Verify the braces still balance**

Run: `node -e "const s=require('fs').readFileSync('BoardGame/firestore.rules','utf8');const o=(s.match(/{/g)||[]).length,c=(s.match(/}/g)||[]).length;console.log(o===c?'balanced':'MISMATCH '+o+' vs '+c)"`
Expected: `balanced`

- [ ] **Step 3: Commit**

```bash
git add BoardGame/firestore.rules
git commit -m "feat: Firestore rules for Discord config, links, and commands"
```

**Note:** these rules are NOT auto-deployed (see Task 1, Step 3). They must be pasted into the Firebase console alongside deploying the function, or nothing will be able to read `discordConfig` and every command will be skipped as disabled.

---

## Task 7: Client command helper

Fire-and-forget. If queueing a command fails for any reason, the tournament flow must continue untouched — a Discord problem must never block a match from starting.

**Files:**
- Create: `BoardGame/full/scripts/discord-commands.js`
- Modify: `BoardGame/full/admin.html`, `BoardGame/full/god.html`

- [ ] **Step 1: Write the helper**

`BoardGame/full/scripts/discord-commands.js`:

```js
/**
 * Queues Discord move commands for the Cloud Function to execute.
 *
 * Deliberately fire-and-forget: a failure to queue is logged and swallowed.
 * Discord moves are a convenience, and must never prevent a match from
 * advancing.
 */

const DiscordCommands = {

    /**
     * The active tournament, resolved the same way admin.js and god-app.js
     * persist it (both write these keys when a tournament is loaded).
     */
    _tournamentId() {
        try {
            return sessionStorage.getItem('currentTournamentId')
                || localStorage.getItem('currentTournamentId')
                || null;
        } catch {
            return null;
        }
    },

    /**
     * Queue one command.
     *
     * @param {'pull'|'return'|'refresh-members'} type
     * @param {object} options
     * @param {string|number} [options.slot]    Match slot ('1', '2', 'challenge')
     * @param {string} [options.matchId]        Queue entry id, when known
     * @param {boolean} [options.force]         Skip the staleness check
     * @returns {Promise<string|null>} command id, or null if it could not be queued
     */
    async request(type, { slot = null, matchId = null, force = false } = {}) {
        const db = window.firebaseDB;
        const tournamentId = this._tournamentId();
        if (!db || !tournamentId) return null;

        try {
            const ref = await db.collection('tournaments').doc(tournamentId)
                .collection('discordCommands').add({
                    type,
                    slot: slot === null ? null : String(slot),
                    matchId,
                    force: !!force,
                    requestedBy: window.firebase?.auth?.().currentUser?.uid || null,
                    requestedAt: new Date().toISOString(),
                    status: 'pending'
                });
            console.log(`[Discord] Queued ${type} command ${ref.id}`);
            return ref.id;
        } catch (err) {
            console.warn(`[Discord] Could not queue ${type} command:`, err.message);
            return null;
        }
    }
};

if (typeof window !== 'undefined') window.DiscordCommands = DiscordCommands;
if (typeof module !== 'undefined' && module.exports) module.exports = DiscordCommands;
```

- [ ] **Step 2: Load it on both admin pages**

Add this line immediately **before** the `scripts/phase-manager.js` tag in each file — `BoardGame/full/admin.html:811` and `BoardGame/full/god.html:814`:

```html
    <script defer src="scripts/discord-commands.js"></script>
```

- [ ] **Step 3: Verify both pages reference it**

Run: `node -e "['admin','god'].forEach(p=>{const s=require('fs').readFileSync('BoardGame/full/'+p+'.html','utf8');console.log(p, s.includes('scripts/discord-commands.js')?'ok':'MISSING')})"`
Expected: `admin ok` then `god ok`

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/discord-commands.js BoardGame/full/admin.html BoardGame/full/god.html
git commit -m "feat: client helper for queueing Discord commands"
```

---

## Task 8: Automatic triggers

Two call sites, both one line, both fire-and-forget.

**Files:**
- Modify: `BoardGame/full/scripts/phase-manager.js:1158-1165`
- Modify: `BoardGame/full/scripts/result-manager.js:508-515`

- [ ] **Step 1: Queue a pull when a slot enters lobby**

In `phase-manager.js`, inside `_advanceSlotInner`, the existing block reads:

```js
        if (next === 'lobby') {
            const prevLobbyReady = { ...(gs.lobbyReady || {}) };
            this._resetLobbyReadyForSlot(slot);
            this._logAction('lobby_reset', 'phase', {
                roundNumber: gs.currentPhase.roundNumber,
                matchSlot: slot
            }, { lobbyReady: prevLobbyReady });
        }
```

Replace it with:

```js
        if (next === 'lobby') {
            const prevLobbyReady = { ...(gs.lobbyReady || {}) };
            this._resetLobbyReadyForSlot(slot);
            this._logAction('lobby_reset', 'phase', {
                roundNumber: gs.currentPhase.roundNumber,
                matchSlot: slot
            }, { lobbyReady: prevLobbyReady });

            // Pull this slot's players into their voice channels. Queued
            // after the readiness reset so the function's `discord: true`
            // writes land on the fresh tombstones, not the old ones.
            // Not awaited — a Discord failure must never stall the phase.
            window.DiscordCommands?.request('pull', { slot });
        }
```

- [ ] **Step 2: Queue a return when a match completes**

In `result-manager.js`, the existing block reads:

```js
        const queueEntry = this._gameState.gameQueue.find(g => g.id === this._selectedQueuedGame.id);
        if (queueEntry) {
            queueEntry.status = 'completed';
            queueEntry.completedAt = new Date().toISOString();
            queueEntry.winningSide = winningSideLabel;
            queueEntry.winnerIndex = winnerIndex;
        }
```

Replace it with:

```js
        const queueEntry = this._gameState.gameQueue.find(g => g.id === this._selectedQueuedGame.id);
        if (queueEntry) {
            queueEntry.status = 'completed';
            queueEntry.completedAt = new Date().toISOString();
            queueEntry.winningSide = winningSideLabel;
            queueEntry.winnerIndex = winnerIndex;

            // Send this match's players back to the waiting room. Not
            // awaited — a Discord failure must never block result saving.
            window.DiscordCommands?.request('return', {
                slot: queueEntry.isChallenge ? 'challenge' : queueEntry.slot,
                matchId: queueEntry.id
            });
        }
```

- [ ] **Step 3: Run the existing browser-code suite to confirm no regression**

Run: `node --test "BoardGame/dev/tests/*.test.js"`
Expected: PASS — 139 tests, 0 failures. (`window.DiscordCommands` is undefined under `node:test`; the `?.` makes both call sites no-ops there, which is exactly the intended behaviour.)

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/phase-manager.js BoardGame/full/scripts/result-manager.js
git commit -m "feat: queue Discord moves on lobby open and result confirmation"
```

---

## Task 9: Deploy and smoke test

Not automatable — it needs a real Discord guild and a real Firebase project. Do it against a throwaway test guild before any real event.

- [ ] **Step 1: Create the Discord application**

1. https://discord.com/developers/applications → New Application.
2. Bot → Reset Token → copy it. This is `DISCORD_BOT_TOKEN`.
3. Bot → Privileged Gateway Intents → enable **Server Members Intent**. Without it, `listGuildMembers` returns an error and the link dropdown stays empty.
4. OAuth2 → URL Generator → scope `bot`, permissions **Move Members** and **View Channels**. Open the generated URL and add the bot to your test guild.

- [ ] **Step 2: Store the token as a secret**

Run: `firebase functions:secrets:set DISCORD_BOT_TOKEN`
Paste the token when prompted. It is never written to the repo.

- [ ] **Step 3: Deploy the function**

Run: `firebase deploy --only functions`
Expected: `onDiscordCommand` deploys successfully. First deploy enables required APIs and may take several minutes.

- [ ] **Step 4: Publish the security rules**

Paste `BoardGame/firestore.rules` into Firebase console → Firestore → Rules → Publish.
Expected: no syntax errors reported.

- [ ] **Step 5: Seed config by hand**

In the Firebase console, create `tournaments/{yourTestTid}/discordConfig/state`:

```
enabled              (boolean) true
guildId              (string)  <your test guild id>
waitingRoomChannelId (string)  <voice channel id>
slotChannels         (map)     { "1": ["<chId>", "<chId>"], "2": ["<chId>", "<chId>"] }
```

Channel and guild ids come from right-clicking in Discord with Developer Mode enabled (Settings → Advanced → Developer Mode).

- [ ] **Step 6: Refresh the member cache**

Create a doc in `tournaments/{tid}/discordCommands` with `type: "refresh-members"`.
Expected: within seconds the doc gains `status: "done"`, and `discordConfig/memberCache` appears with a populated `members` array. If `status` is `skipped` with reason `member-list-failed`, the Server Members Intent is not enabled — go back to Step 1.

- [ ] **Step 7: Seed one link and test a live move**

1. Create `tournaments/{tid}/discordLinks/{yourUid}` with `discordUserId` set to your own Discord id.
2. Join the Waiting Room voice channel.
3. Create a command doc: `{ type: "pull", slot: "1", force: true }`.

Expected: you are moved into the slot-1 side-A channel within a couple of seconds, and the command doc gains `status: "done"` with a `results` entry showing `outcome: "moved"`.

- [ ] **Step 8: Verify the kill switch**

1. Set `discordConfig/state.enabled` to `false`.
2. Rejoin the Waiting Room and create the same `pull` command again.

Expected: the command doc gains `status: "skipped"`, `reason: "disabled"`, and you are NOT moved.

- [ ] **Step 9: Verify the not-in-voice path**

With `enabled` back to `true`, leave voice entirely and create a `pull` command.
Expected: the command runs for ~2 minutes, then completes with `outcome: "not_in_voice"`. Joining Waiting Room partway through should instead move you and complete early.

- [ ] **Step 10: Commit any config corrections**

```bash
git add -A
git commit -m "docs: record verified Discord setup steps"
```

---

## Follow-up (separate plan)

The god.html Discord tab: link management UI with suggestion matching, the kill-switch toggle with re-enable confirmation, the member-refresh button, and the activity/results view. Write that plan once this one is green and deployed.

Until then the feature works, but links and config are managed by hand in the Firebase console.
