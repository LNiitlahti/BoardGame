# Live-Screen Chat Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player posts to the existing tournament chat, the message pops onto `view.html` — the big-screen spectator display — tagged with the sender's name in their team colour, holds for a few seconds, then fades away.

**Architecture:** A new read-only module, `ChatOverlay`, subscribes to the tournament chat collection that `ChatModule` already writes to (`tournaments/{tid}/chatTournament`) and renders each newly-arriving message as a transient toast in a bottom-left stack. It is display-only: no input, no send path, no auth requirement beyond the anonymous session `view.html` already establishes. Sender identity (display name + team colour) is resolved from the `gameData` snapshot `DisplayManager` is already receiving, so colours stay correct across roster swaps and renames. The two decisions worth getting wrong — *which* messages are new, and *whose* colour to use — are pure functions with unit tests; the DOM and Firestore work around them is thin.

**Tech Stack:** Vanilla JS (no build step), Firebase v9 compat SDK (`onSnapshot` + `docChanges()`), `node:test` for the pure helpers, Puppeteer + `dev/tests/e2e-server.js` for the visual check.

**Source:** [`../../notes/2026-08-05-discord-feature-requests.md`](../../notes/2026-08-05-discord-feature-requests.md) item 2. Developer note: *"the chat module has tournament chat feature already implemented — we would only need those chat messages to show up on the big screen if someone sends a message. I would say the message should only be shown for lets say 5-10 seconds and fade away or move off screen. These messages should clearly indicate the playername who sent it, also their team colour."*

**Explicitly out of scope:** item 4 (a Discord bot relaying messages into this feed) was closed — *"we wont implement this, atleast not yet, end of discussion."* Do not add a Discord ingestion path. The feed's only source is the existing in-app tournament chat.

---

## Background an engineer needs before touching this

**The data already exists and is already being written.** `BoardGame/shared/scripts/chat-module.js` is mounted on `admin.html`, `god.html`, `home.html` and `team.html`. Its `_sendMessage()` (`chat-module.js:180-204`) writes to `tournaments/{tid}/chatTournament` with exactly this shape:

```js
{ text: string, senderId: <firebase auth uid>, senderName: string, createdAt: <serverTimestamp> }
```

Nothing in this plan writes to that collection. `view.html` only reads.

**Anonymous spectators can read it.** `firebase-loader.js:139-140` signs unknown sessions in anonymously, and the Firestore rule for `chatTournament` is `allow read: if isAuthenticated()` — which anonymous sessions satisfy. Only *posting* requires `!isAnonymous()`. So the overlay works on an unattended display with nobody logged in, and **no Firestore rules change is needed for this plan.**

**`senderId` is a Firebase Auth uid, not a player-registry id.** Team colour lives on `gameData.teams[].color`, and the uid↔player link is `gameData.teams[].players[].uid`. That is the same join `discord-move-planner.js`'s `buildUidByPlayerId()` does server-side. A sender with no linked roster entry (an admin, a god, a spectator who signed in properly) is normal and must render with a neutral fallback colour, not crash and not get miscoloured.

**`view.html` is a fixed 1920×1080 canvas** scaled by a `transform` on `<body>` (`view.html:2020-2028`). That transform makes `<body>` the containing block for `position: fixed` descendants, so fixed coordinates are in design space — the same reason `.score-strip` and `#broadcastTicker` position correctly today. Existing z-index neighbours: `.score-strip` is `60`, `#broadcastTicker` is `999999`. The overlay sits at `500`: above the display content, below a broadcast takeover.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `BoardGame/full/scripts/chat-overlay.js` | The whole feature: pure statics, Firestore subscription, toast DOM + styles |
| `BoardGame/dev/tests/chat-overlay.test.js` | Unit tests for the two pure statics |
| `BoardGame/dev/tests/e2e-view-chat-overlay.js` | Puppeteer check: toast appears, is coloured, then disappears |

**Modify:**

| File | Change |
|---|---|
| `BoardGame/full/view.html` | One `<script>` tag, mount on `firebase-ready`, feed `gameData` from `updateDisplay()`, dev hook |
| `BoardGame/dev/view-preview.html` | A "push test message" control for manual QA |

**Test commands:**
- Unit: `node --test "BoardGame/dev/tests/*.test.js"` — **165 passing as of 2026-08-05**; this plan adds 9, for 174. (If a sibling plan from the same triage batch — the live-screen pass or the drink counter — was executed first, the baseline is higher by that plan's additions. Take the number you measure before starting as the baseline.)
- Visual: `cd BoardGame && node dev/tests/e2e-view-chat-overlay.js`

---

## Task 1: The pure statics

Two decisions carry all the risk. `newMessagesFrom()` decides which snapshot changes are genuinely new — get it wrong and the screen either bursts ten toasts on every page load or shows nothing at all. `resolveSenderIdentity()` decides whose colour to paint — get it wrong and a message is attributed to the wrong team in front of the whole room.

Both are pure, so both get tested before any Firestore or DOM code exists.

**Files:**
- Create: `BoardGame/full/scripts/chat-overlay.js`
- Test: `BoardGame/dev/tests/chat-overlay.test.js`

- [ ] **Step 1: Write the failing tests**

Create `BoardGame/dev/tests/chat-overlay.test.js`:

```js
/**
 * Unit coverage for the two pure decisions inside chat-overlay.js, the
 * read-only tournament-chat feed on view.html's big screen.
 *
 *   newMessagesFrom()     - which snapshot changes deserve a toast
 *   resolveSenderIdentity() - whose name and team colour to paint it in
 *
 * Everything else in that file is Firestore subscription and DOM, exercised
 * by dev/tests/e2e-view-chat-overlay.js instead.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../../full/scripts/chat-overlay.js');
const ChatOverlay = global.window.ChatOverlay;

// ---------- newMessagesFrom ----------

test('the first snapshot yields nothing — a fresh page load must not burst the backlog', () => {
    const changes = [
        { type: 'added', id: 'a', data: { text: 'old one' } },
        { type: 'added', id: 'b', data: { text: 'old two' } }
    ];
    assert.deepStrictEqual(ChatOverlay.newMessagesFrom(changes, true), []);
});

test('added changes after the first snapshot are returned in order', () => {
    const changes = [
        { type: 'added', id: 'c', data: { text: 'hello' } },
        { type: 'added', id: 'd', data: { text: 'there' } }
    ];
    const result = ChatOverlay.newMessagesFrom(changes, false);
    assert.deepStrictEqual(result.map(m => m.id), ['c', 'd']);
    assert.strictEqual(result[0].data.text, 'hello');
});

test('modified and removed changes never produce a toast', () => {
    const changes = [
        { type: 'modified', id: 'e', data: { text: 'edited' } },
        { type: 'removed', id: 'f', data: { text: 'deleted' } },
        { type: 'added', id: 'g', data: { text: 'real' } }
    ];
    const result = ChatOverlay.newMessagesFrom(changes, false);
    assert.deepStrictEqual(result.map(m => m.id), ['g']);
});

test('an empty or missing change list is handled without throwing', () => {
    assert.deepStrictEqual(ChatOverlay.newMessagesFrom([], false), []);
    assert.deepStrictEqual(ChatOverlay.newMessagesFrom(undefined, false), []);
});

// ---------- resolveSenderIdentity ----------

const GAME_DATA = {
    teams: [
        {
            id: 1,
            name: 'Tiimi 1',
            color: '#de392c',
            players: [{ id: 'p_aaa', uid: 'uid_aaa', name: 'Wustra' }]
        },
        {
            id: 2,
            name: 'Tiimi 2',
            color: '#2278a3',
            players: [{ id: 'p_bbb', uid: 'uid_bbb', name: 'Touch' }]
        }
    ]
};

test('a linked player gets their roster name and their team colour', () => {
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity(GAME_DATA, 'uid_bbb', 'stale stored name'),
        { name: 'Touch', color: '#2278a3' }
    );
});

test('the roster name wins over the name stored on the message', () => {
    // senderName is frozen at send time; a later rename must still show the
    // current name, the same way _getPlayerCurrentName() works for matches.
    const identity = ChatOverlay.resolveSenderIdentity(GAME_DATA, 'uid_aaa', 'OldNickname');
    assert.strictEqual(identity.name, 'Wustra');
});

test('an unlinked sender (admin/god/spectator) falls back to the stored name and a neutral colour', () => {
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity(GAME_DATA, 'uid_nobody', 'Inffi (GOD)'),
        { name: 'Inffi (GOD)', color: '#c8b37e' }
    );
});

test('missing gameData or teams does not throw', () => {
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity(null, 'uid_aaa', 'Someone'),
        { name: 'Someone', color: '#c8b37e' }
    );
    assert.deepStrictEqual(
        ChatOverlay.resolveSenderIdentity({}, 'uid_aaa', undefined),
        { name: 'Player', color: '#c8b37e' }
    );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "BoardGame/dev/tests/chat-overlay.test.js"`
Expected: FAIL — `Cannot find module '../../full/scripts/chat-overlay.js'`

- [ ] **Step 3: Create the file with just the statics**

Create `BoardGame/full/scripts/chat-overlay.js`:

```js
/**
 * ChatOverlay — read-only tournament chat on the big screen.
 *
 * Subscribes to the same tournaments/{tid}/chatTournament collection that
 * shared/scripts/chat-module.js writes to, and renders each newly-arriving
 * message as a transient toast in a bottom-left stack on view.html. Display
 * only: no input, no send path, no posting rights required. An anonymous
 * spectator session can read this collection (the Firestore rule is
 * `allow read: if isAuthenticated()`), so it works on an unattended display.
 *
 * Requested in the 2026-08-05 Discord thread: show a message for 5-10s with
 * the sender's name in their team colour, then fade it away.
 *
 * Usage (view.html):
 *   <script defer src="scripts/chat-overlay.js"></script>
 *   ...
 *   const overlay = new ChatOverlay({ tournamentId });
 *   overlay.mount();
 *   overlay.setGameData(gameState);   // on every snapshot, keeps colours fresh
 */

// Neutral gold, matching --gold-bright on view.html. Used for senders with no
// linked roster entry: admins, gods, and signed-in spectators.
const CHAT_OVERLAY_NEUTRAL = '#c8b37e';

class ChatOverlay {

    /**
     * Which of a snapshot's changes deserve a toast?
     *
     * Only 'added'. Chat messages are immutable by rule (`allow update,
     * delete: if false`), so 'modified'/'removed' should never appear — but
     * filtering explicitly means a future rules change can't start replaying
     * old messages onto the screen.
     *
     * The first snapshot is always suppressed: it delivers the whole existing
     * backlog as 'added', which on a page reload would fire the entire recent
     * history at the room at once.
     *
     * Pure. Tested in dev/tests/chat-overlay.test.js.
     *
     * @param {Array<{type: string, id: string, data: Object}>} changes
     * @param {boolean} isFirstSnapshot
     * @returns {Array<{type: string, id: string, data: Object}>}
     */
    static newMessagesFrom(changes, isFirstSnapshot) {
        if (isFirstSnapshot) return [];
        return (changes || []).filter(change => change.type === 'added');
    }

    /**
     * Who sent this, and in what colour?
     *
     * Resolves the message's Firebase Auth uid against the live roster rather
     * than trusting the senderName frozen into the document at send time —
     * same reasoning as DisplayManager._getPlayerCurrentName(): a rename or a
     * roster swap must not leave a stale name on the big screen.
     *
     * Pure. Tested in dev/tests/chat-overlay.test.js.
     *
     * @param {Object|null} gameData - the tournament snapshot (teams[].players[].uid)
     * @param {string} senderId - Firebase Auth uid from the message
     * @param {string|undefined} fallbackName - the message's own senderName
     * @returns {{name: string, color: string}}
     */
    static resolveSenderIdentity(gameData, senderId, fallbackName) {
        const teams = gameData?.teams || [];
        for (const team of teams) {
            const player = (team.players || []).find(p => p.uid && p.uid === senderId);
            if (player) {
                return {
                    name: player.name || fallbackName || 'Player',
                    color: team.color || CHAT_OVERLAY_NEUTRAL
                };
            }
        }
        return { name: fallbackName || 'Player', color: CHAT_OVERLAY_NEUTRAL };
    }
}

if (typeof window !== 'undefined') {
    window.ChatOverlay = ChatOverlay;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatOverlay;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "BoardGame/dev/tests/chat-overlay.test.js"`
Expected: `# pass 9`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/scripts/chat-overlay.js BoardGame/dev/tests/chat-overlay.test.js
git commit -m "feat: pure sender-identity and new-message helpers for the chat overlay"
```

---

## Task 2: Toast rendering

The visible half. Still no Firestore — `showMessage()` is callable on its own, which is what makes both the preview harness and the e2e test possible without a live chat.

**Files:**
- Modify: `BoardGame/full/scripts/chat-overlay.js`

- [ ] **Step 1: Add the constructor, styles, and toast rendering**

In `BoardGame/full/scripts/chat-overlay.js`, insert the following **inside** the `ChatOverlay` class, after the two static methods:

```js
    /**
     * @param {Object} opts
     * @param {string} opts.tournamentId - required
     * @param {number} [opts.displayMs=9000] - how long a toast stays before fading
     * @param {number} [opts.maxVisible=3] - oldest toasts are evicted past this
     * @param {number} [opts.messageLimit=10] - snapshot window size
     */
    constructor(opts = {}) {
        this.tournamentId = opts.tournamentId;
        this.displayMs = opts.displayMs || 9000;
        this.maxVisible = opts.maxVisible || 3;
        this.messageLimit = opts.messageLimit || 10;

        this.db = null;
        this.stack = null;
        this.unsubscribe = null;
        this._gameData = null;
        this._isFirstSnapshot = true;
        this._mounted = false;
    }

    /** Latest tournament snapshot, so sender colours track roster changes. */
    setGameData(data) {
        this._gameData = data;
    }

    /**
     * Render one message as a toast. Public so the preview harness and the
     * e2e test can drive it without a real chat message existing.
     *
     * @param {{text: string, senderId: string, senderName: string}} msg
     */
    showMessage(msg) {
        if (!msg || !msg.text) return;
        if (!this.stack) this._buildStack();

        const identity = ChatOverlay.resolveSenderIdentity(this._gameData, msg.senderId, msg.senderName);

        const toast = document.createElement('div');
        toast.className = 'chat-overlay-toast';
        toast.style.setProperty('--co-color', identity.color);
        toast.innerHTML = `
            <div class="chat-overlay-sender">${this._escape(identity.name)}</div>
            <div class="chat-overlay-text">${this._escape(msg.text)}</div>
        `;

        this.stack.appendChild(toast);

        // Evict the oldest if the stack is over budget, so a burst of chatter
        // can never march up and cover the whole screen.
        while (this.stack.children.length > this.maxVisible) {
            this.stack.firstElementChild.remove();
        }

        // Next frame, so the enter transition actually runs.
        requestAnimationFrame(() => toast.classList.add('chat-overlay-toast--in'));

        setTimeout(() => {
            toast.classList.remove('chat-overlay-toast--in');
            toast.classList.add('chat-overlay-toast--out');
            setTimeout(() => toast.remove(), 600);
        }, this.displayMs);
    }

    _buildStack() {
        this._injectStyles();
        const stack = document.createElement('div');
        stack.className = 'chat-overlay-stack';
        stack.id = 'chatOverlayStack';
        document.body.appendChild(stack);
        this.stack = stack;
    }

    _escape(str) {
        const div = document.createElement('div');
        div.textContent = str ?? '';
        return div.innerHTML;
    }

    _injectStyles() {
        if (document.getElementById('chat-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'chat-overlay-styles';
        // Sizes are in view.html's 1920x1080 design space -- body is scaled by
        // a transform, which also makes it the containing block for these
        // fixed-position elements (same mechanism .score-strip relies on).
        // z-index sits above the display content (score strip is 60) but well
        // below a broadcast takeover (999999).
        style.textContent = `
            .chat-overlay-stack {
                position: fixed; left: 40px; z-index: 500;
                bottom: calc(var(--score-strip-h, 56px) + 24px);
                display: flex; flex-direction: column; gap: 12px;
                width: 620px; pointer-events: none;
            }
            .chat-overlay-toast {
                opacity: 0; transform: translateX(-40px);
                transition: opacity 0.35s ease, transform 0.35s ease;
                background: rgba(10, 10, 14, 0.88);
                border-left: 6px solid var(--co-color, #c8b37e);
                border-radius: 10px; padding: 14px 20px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.45);
            }
            .chat-overlay-toast--in { opacity: 1; transform: translateX(0); }
            .chat-overlay-toast--out { opacity: 0; transform: translateX(-40px); }
            .chat-overlay-sender {
                font-family: 'Russo One', sans-serif; font-size: 24px;
                text-transform: uppercase; letter-spacing: 1px;
                color: var(--co-color, #c8b37e); margin-bottom: 4px;
            }
            .chat-overlay-text {
                font-family: 'Quantico', sans-serif; font-size: 30px; font-weight: 700;
                color: #f2f2f2; overflow-wrap: anywhere;
            }
        `;
        document.head.appendChild(style);
    }
```

- [ ] **Step 2: Verify the file still parses**

Run: `node --check BoardGame/full/scripts/chat-overlay.js`
Expected: no output (exit 0)

- [ ] **Step 3: Confirm the unit tests still pass**

Run: `node --test "BoardGame/dev/tests/chat-overlay.test.js"`
Expected: `# pass 9`, `# fail 0`

The tests `require()` this file in Node where there is no DOM — that keeps working because nothing outside a method body touches `document`.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/scripts/chat-overlay.js
git commit -m "feat: transient toast rendering for the chat overlay"
```

---

## Task 3: The Firestore subscription

**Files:**
- Modify: `BoardGame/full/scripts/chat-overlay.js`

- [ ] **Step 1: Add mount and destroy**

Add these methods to the `ChatOverlay` class, after `setGameData()`:

```js
    /**
     * Start listening. Call once, after 'firebase-ready'.
     *
     * Ordered createdAt-descending with a small limit so the query stays
     * cheap; ordering only decides which window of documents is watched,
     * not display order -- each new message is appended to the stack as it
     * arrives, so the newest is always at the bottom.
     */
    mount() {
        if (this._mounted) return;
        if (!this.tournamentId) {
            console.error('ChatOverlay: tournamentId is required, overlay will not be shown.');
            return;
        }
        if (!window.firebaseDB) {
            console.error('ChatOverlay: window.firebaseDB not found. Load firebase-loader.js first and wait for "firebase-ready".');
            return;
        }

        this.db = window.firebaseDB;
        this._buildStack();

        const ref = this.db
            .collection('tournaments').doc(this.tournamentId)
            .collection('chatTournament')
            .orderBy('createdAt', 'desc')
            .limit(this.messageLimit);

        this.unsubscribe = ref.onSnapshot(snapshot => {
            const changes = snapshot.docChanges().map(change => ({
                type: change.type,
                id: change.doc.id,
                data: change.doc.data()
            }));

            const fresh = ChatOverlay.newMessagesFrom(changes, this._isFirstSnapshot);
            this._isFirstSnapshot = false;

            // Newest-first from the query; show oldest-first so a burst reads
            // in the order it was actually typed.
            fresh.reverse().forEach(change => this.showMessage(change.data));
        }, err => {
            console.error('ChatOverlay: chat listener error', err);
        });

        this._mounted = true;
    }

    /** Stop listening and remove the stack. */
    destroy() {
        if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
        if (this.stack) { this.stack.remove(); this.stack = null; }
        this._mounted = false;
    }
```

- [ ] **Step 2: Verify it parses and the units still pass**

Run: `node --check BoardGame/full/scripts/chat-overlay.js && node --test "BoardGame/dev/tests/chat-overlay.test.js"`
Expected: no parse output, then `# pass 9`, `# fail 0`

- [ ] **Step 3: Commit**

```bash
git add BoardGame/full/scripts/chat-overlay.js
git commit -m "feat: subscribe the chat overlay to the tournament chat collection"
```

---

## Task 4: Wire it into view.html

Four small edits. Note that `chat-overlay.js` lives in `full/scripts/`, not `shared/scripts/` — it is view-specific, unlike `chat-module.js`.

**Files:**
- Modify: `BoardGame/full/view.html` (script tag ~line 2039; `updateDisplay()` ~line 2422; `firebase-ready` handler ~line 2523; unload handler ~line 2529)

- [ ] **Step 1: Add the script tag**

In `BoardGame/full/view.html`, add the overlay immediately after the `display-manager.js` tag at line 2039:

```html
    <script defer src="scripts/display-manager.js"></script>
    <script defer src="scripts/chat-overlay.js"></script>
```

- [ ] **Step 2: Declare the instance and feed it snapshots**

Find `updateDisplay()` (`view.html:2422-2426`) and replace it, along with the `displayManager` declaration just above it, with:

```js
    let displayManager = null;
    let chatOverlay = null;

    function updateDisplay() {
        if (!gameState) return;
        if (!displayManager) initDisplayManager();
        displayManager.onFirebaseSnapshot(gameState);
        // Keep sender colours tracking the live roster (renames, swaps).
        if (chatOverlay) chatOverlay.setGameData(gameState);
    }
```

- [ ] **Step 3: Mount on firebase-ready**

Replace the `firebase-ready` handler (`view.html:2523-2526`) with:

```js
    document.addEventListener('firebase-ready', () => {
        setupTournamentListener();
        setupOnboardingListener();

        // Read-only tournament chat feed on the big screen. Works on an
        // unattended display: firebase-loader signs anonymous sessions in,
        // and chatTournament allows reads to any authenticated user.
        chatOverlay = new ChatOverlay({ tournamentId });
        chatOverlay.mount();
        if (gameState) chatOverlay.setGameData(gameState);
    });
```

- [ ] **Step 4: Clean up on unload**

Replace the `beforeunload` handler (`view.html:2529-2533`) with:

```js
    // Clean up Firebase listeners on page unload to prevent zombie callbacks
    window.addEventListener('beforeunload', () => {
        if (activeListener) { activeListener(); activeListener = null; }
        if (resultLogListener) { resultLogListener(); resultLogListener = null; }
        if (onboardingListener) { onboardingListener(); onboardingListener = null; }
        if (chatOverlay) { chatOverlay.destroy(); chatOverlay = null; }
    });
```

- [ ] **Step 5: Add the dev hook**

Immediately after the `window.__devSetResultLog` definition (`view.html:2445-2447`), add:

```js
    // Dev-only hook for dev/view-preview.html and
    // dev/tests/e2e-view-chat-overlay.js: renders a toast without a real chat
    // message existing. Inert unless something explicitly calls it.
    window.__devPushChatMessage = function (msg) {
        if (!chatOverlay) {
            chatOverlay = new ChatOverlay({ tournamentId });
            // No mount() -- that would open a Firestore listener the preview
            // does not want. showMessage() works standalone.
        }
        chatOverlay.setGameData(window.__devLastPreviewData || null);
        chatOverlay.showMessage(msg);
    };
```

Then, so the hook can resolve team colours from whatever the preview last pushed, record it in `__devPreviewSnapshot` (`view.html:2434-2437`):

```js
    window.__devPreviewSnapshot = function (mockData) {
        if (!displayManager) initDisplayManager();
        window.__devLastPreviewData = mockData;
        displayManager.onFirebaseSnapshot(mockData);
    };
```

- [ ] **Step 6: Smoke-test it by hand**

Serve the pages and open the preview:

```bash
cd BoardGame
node -e "require('./dev/tests/e2e-server').startServer(process.cwd(), 8080).then(() => console.log('serving on 8080'))"
```

Open `http://localhost:8080/dev/view-preview.html`, pick any `matches_in_progress` scenario, then in the **browser console of the iframe** run:

```js
document.getElementById('previewFrame').contentWindow.__devPushChatMessage({
  text: 'Hello from the big screen', senderId: 'uid_t1a', senderName: 'Wustra'
});
```

Expected: a toast slides in bottom-left, sender name in the team's colour, and it fades out after ~9 seconds.

- [ ] **Step 7: Commit**

```bash
git add BoardGame/full/view.html
git commit -m "feat: mount the read-only chat overlay on view.html"
```

---

## Task 5: A preview-harness control

Typing into the console works but nobody will remember the incantation. The preview harness is where every other display state gets QA'd, so the overlay belongs there too.

**Files:**
- Modify: `BoardGame/dev/view-preview.html`

- [ ] **Step 1: Add the control markup**

In `BoardGame/dev/view-preview.html`, find the broadcast controls (the `broadcastText` input used by `setBroadcast()`, around line 365) and add this block immediately after that control's container:

```html
        <div class="control-group">
            <label>Chat overlay</label>
            <input type="text" id="chatOverlayText" placeholder="Message text" value="Hyvä peli!" />
            <input type="text" id="chatOverlaySender" placeholder="Sender uid" value="uid_t1a" />
            <button onclick="pushChatMessage()">Push message</button>
        </div>
```

- [ ] **Step 2: Add the handler**

In the same file's script block, next to `setBroadcast()`:

```js
function pushChatMessage() {
    const text = document.getElementById('chatOverlayText').value.trim();
    const senderId = document.getElementById('chatOverlaySender').value.trim();
    if (!text) return;
    if (typeof frame.contentWindow.__devPushChatMessage !== 'function') {
        statusEl.textContent = 'ERROR: __devPushChatMessage not found (check view.html)';
        return;
    }
    frame.contentWindow.__devPushChatMessage({ text, senderId, senderName: 'Preview Sender' });
}
```

- [ ] **Step 3: Verify**

Reload `view-preview.html`, select a `matches_in_progress` scenario, and click **Push message**.
Expected: a toast appears in the sender's team colour and fades after ~9s.

Change the sender uid to something unmatched (e.g. `uid_nobody`) and push again.
Expected: the toast renders in neutral gold with the name `Preview Sender` — the unlinked-sender fallback.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/dev/view-preview.html
git commit -m "test: preview-harness control for pushing chat overlay messages"
```

---

## Task 6: Puppeteer visual check

**Files:**
- Create: `BoardGame/dev/tests/e2e-view-chat-overlay.js`

- [ ] **Step 1: Write the test script**

Create `BoardGame/dev/tests/e2e-view-chat-overlay.js`:

```js
/**
 * Visual check for view.html's read-only chat overlay.
 *
 * Asserts the three things the 2026-08-05 Discord thread asked for: the
 * message appears, it carries the sender's name in their team colour, and it
 * goes away on its own.
 *
 * Drives window.__devPushChatMessage -- no login, no Firestore, no real chat
 * message. Run: cd BoardGame && node dev/tests/e2e-view-chat-overlay.js [--headed]
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server');
const { assert, sleep, screenshot, VIEWPORT } = require('./e2e-harness');

const PORT = 8086;
const DISPLAY_MS = 9000; // must match ChatOverlay's default displayMs

function previewData() {
    return {
        name: 'chat-overlay-test',
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
        currentPhase: { name: 'matches_in_progress', roundNumber: 1, startedAt: 1_000_000, slots: { 1: 'playing', 2: 'playing' } }
    };
}

(async () => {
    const server = await startServer(path.resolve(__dirname, '../..'), PORT);
    const browser = await puppeteer.launch({ headless: !process.argv.includes('--headed') });

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);
        await page.goto(`http://localhost:${PORT}/full/view.html?tournamentId=__dev_preview__`, { waitUntil: 'domcontentloaded' });

        await page.waitForFunction(
            () => typeof window.__devPreviewSnapshot === 'function' && typeof window.__devPushChatMessage === 'function',
            { timeout: 20000 }
        );

        await page.evaluate(d => window.__devPreviewSnapshot(d), previewData());
        await sleep(400);

        // ============================================================
        // A linked player's message: name + team colour
        // ============================================================
        await page.evaluate(() => window.__devPushChatMessage({
            text: 'Hyvä peli!', senderId: 'uid_t2a', senderName: 'stale name'
        }));

        await page.waitForFunction(
            () => !!document.querySelector('.chat-overlay-toast--in'),
            { timeout: 5000 }
        );

        const shown = await page.evaluate(() => {
            const toast = document.querySelector('.chat-overlay-toast');
            const sender = toast.querySelector('.chat-overlay-sender');
            return {
                sender: sender.textContent.trim(),
                senderColor: getComputedStyle(sender).color,
                text: toast.querySelector('.chat-overlay-text').textContent.trim(),
                opacity: parseFloat(getComputedStyle(toast).opacity)
            };
        });
        console.log('--- toast shown ---', JSON.stringify(shown));

        // Roster name wins over the stale senderName frozen into the message.
        assert(shown.sender === 'Touch', `expected sender "Touch", got "${shown.sender}"`);
        assert(shown.text === 'Hyvä peli!', `expected the message text, got "${shown.text}"`);
        // #2278a3 === rgb(34, 120, 163)
        assert(
            shown.senderColor === 'rgb(34, 120, 163)',
            `sender should be painted in team 2's colour rgb(34, 120, 163), got ${shown.senderColor}`
        );
        assert(shown.opacity > 0.9, `toast should be fully visible, opacity was ${shown.opacity}`);

        await screenshot(page, 'chat-overlay-visible', 'view-chat');

        // ============================================================
        // An unlinked sender falls back to neutral
        // ============================================================
        await page.evaluate(() => window.__devPushChatMessage({
            text: 'Admin here', senderId: 'uid_nobody', senderName: 'Inffi (GOD)'
        }));
        await sleep(500);

        const fallback = await page.evaluate(() => {
            const toasts = [...document.querySelectorAll('.chat-overlay-toast')];
            const last = toasts[toasts.length - 1];
            const sender = last.querySelector('.chat-overlay-sender');
            return { sender: sender.textContent.trim(), color: getComputedStyle(sender).color };
        });
        console.log('--- unlinked sender ---', JSON.stringify(fallback));

        assert(fallback.sender === 'Inffi (GOD)', `unlinked sender should keep its stored name, got "${fallback.sender}"`);
        // #c8b37e === rgb(200, 179, 126)
        assert(
            fallback.color === 'rgb(200, 179, 126)',
            `unlinked sender should use the neutral colour rgb(200, 179, 126), got ${fallback.color}`
        );

        // ============================================================
        // It goes away on its own
        // ============================================================
        await sleep(DISPLAY_MS + 2000);

        const after = await page.evaluate(() => document.querySelectorAll('.chat-overlay-toast').length);
        console.log('--- toasts remaining after display window ---', after);
        assert(after === 0, `toasts should have faded and been removed, ${after} still in the DOM`);

        await screenshot(page, 'chat-overlay-faded', 'view-chat');

        console.log('\nPASS — chat overlay appears, colours correctly, and clears itself.');
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

Run: `cd BoardGame && node dev/tests/e2e-view-chat-overlay.js`
Expected: three `---` dumps, then `PASS — chat overlay appears, colours correctly, and clears itself.` The run takes ~15s because it genuinely waits out the display window.

- [ ] **Step 3: Commit**

```bash
git add BoardGame/dev/tests/e2e-view-chat-overlay.js
git commit -m "test: guard chat overlay appearance, team colour, and auto-dismiss"
```

---

## Task 7: End-to-end check against real chat

Everything so far drives a dev hook. This proves the Firestore subscription itself works — the one part no synthetic test covers.

**Files:** none (verification only)

- [ ] **Step 1: Open both ends**

Serve the pages:

```bash
cd BoardGame
node -e "require('./dev/tests/e2e-server').startServer(process.cwd(), 8080).then(() => console.log('serving on 8080'))"
```

Open two browser windows against a real tournament id:
- `http://localhost:8080/full/view.html?tournamentId=<real-id>` — leave it on the live match screen
- `http://localhost:8080/full/team.html?tournamentId=<real-id>&teamId=<your-team>` — signed in as a real player

- [ ] **Step 2: Send a message**

On `team.html`, open the chat FAB, stay on the **Tournament** tab, and send a message.

Expected on `view.html`, within about a second: a toast with your roster name in your team's colour, fading after ~9 seconds.

- [ ] **Step 3: Check the reload behaviour**

With several messages already in the room's history, hard-reload `view.html`.

Expected: **no** toasts fire on load. The screen stays quiet until the next genuinely new message. If the backlog bursts onto the screen, `_isFirstSnapshot` is not doing its job — check that `newMessagesFrom()` is being passed it *before* it is flipped to `false`.

- [ ] **Step 4: Check the team-chat room is not leaking**

On `team.html`, switch to the **My Team** tab and send a message there.

Expected: **nothing** appears on `view.html`. The overlay subscribes only to `chatTournament`; private team chat must never reach the big screen. If it does, the collection path in `mount()` is wrong.

- [ ] **Step 5: Record the result**

Note the outcome in the source notes file's item 2 developer-notes block. If anything failed, fix it and re-run Tasks 6 and 7 before considering this plan complete.

---

## Self-Review

**Spec coverage.** "Show tournament chat messages on the big screen when someone sends one" → Tasks 3 and 4. "Only shown for 5-10 seconds, then fade away or move off screen" → `displayMs: 9000` plus the slide-out transition in Task 2, asserted in Task 6. "Clearly indicate the playername who sent it, also their team colour" → `resolveSenderIdentity()` in Task 1, rendered in Task 2, asserted in Task 6.

**Naming consistency.** `ChatOverlay.newMessagesFrom(changes, isFirstSnapshot)` and `ChatOverlay.resolveSenderIdentity(gameData, senderId, fallbackName)` are defined in Task 1 and called with those exact signatures in Tasks 2 and 3. `showMessage()`, `setGameData()`, `mount()`, `destroy()` are used consistently across Tasks 2–4 and the two harnesses. CSS classes `chat-overlay-stack`, `chat-overlay-toast`, `chat-overlay-toast--in`, `chat-overlay-sender`, `chat-overlay-text` are emitted in Task 2 and asserted in Task 6.

**No Firestore rules change.** Confirmed against `BoardGame/firestore.rules:181-183`: `chatTournament` reads are open to any authenticated session, anonymous included. This plan adds no write path, so the ruleset is untouched — worth knowing, because `firestore.rules` is gitignored and changing it is a manual deploy step this plan deliberately avoids.

**Deliberate design choice worth flagging.** `resolveSenderIdentity()` prefers the *live roster* name over the `senderName` frozen into the message. That means a player who is renamed mid-tournament has their old messages attributed to their new name. This matches `DisplayManager._getPlayerCurrentName()`'s existing behaviour for match displays, so the screen stays internally consistent — but it is a choice, not a neutral default. Revisit it if that ever looks wrong on screen.
