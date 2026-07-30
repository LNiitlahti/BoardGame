# Chat Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `games/{gameId}` vs `tournaments/{tournamentId}` schema mismatch in the unused `ChatModule` draft, add the missing Firestore security rules for its two chat rooms, and wire it into admin.html, god.html, team.html, and home.html so tournament/team chat actually works.

**Architecture:** `ChatModule` (already written in `BoardGame/shared/scripts/chat-module.js`) becomes a thin, self-contained widget that takes `{ tournamentId, teamId }` and manages its own Firestore listeners/DOM. Each of the four pages constructs and mounts one `ChatModule` instance, once, at the point where that page already knows its current tournament (and team, where relevant) — reusing each page's existing id-resolution code, not adding new URL/localStorage parsing. Security is enforced server-side via two new Firestore rule blocks nested under `tournaments/{tournamentId}`.

**Tech Stack:** Vanilla JS (ES6 class), Firebase Firestore (compat SDK), Firestore Security Rules. No bundler, no test framework, no Firebase emulator configured in this repo — every task ends with a manual verification step against a real/dev Firebase project instead of an automated test run.

**Spec:** `docs/superpowers/specs/2026-07-30-chat-module-design.md`

---

### Task 1: Fix `chat-module.js` schema (`gameId` → `tournamentId`) and anonymous-user handling

**Files:**
- Modify: `BoardGame/shared/scripts/chat-module.js`

- [ ] **Step 1: Update the file header doc comment**

Replace lines 10–20 (the `Usage` example in the top comment block):

```js
 * Usage (add near the end of <body>, after firebase-loader.js):
 *   <script src="scripts/chat-module.js"></script>
 *   <script>
 *     document.addEventListener('firebase-ready', () => {
 *       const chat = new ChatModule({
 *         gameId: new URLSearchParams(location.search).get('gameId'),
 *         teamId: new URLSearchParams(location.search).get('teamId') // null on admin/god pages is fine
 *       });
 *       chat.mount();
 *     });
 *   </script>
 */
```

with:

```js
 * Usage (add near the end of <body>, after firebase-loader.js):
 *   <script src="scripts/chat-module.js"></script>
 *   <script>
 *     document.addEventListener('firebase-ready', () => {
 *       const chat = new ChatModule({
 *         tournamentId: new URLSearchParams(location.search).get('tournamentId'),
 *         teamId: new URLSearchParams(location.search).get('teamId') // null on admin/god pages is fine
 *       });
 *       chat.mount();
 *     });
 *   </script>
 */
```

- [ ] **Step 2: Rename the constructor option and JSDoc**

Replace lines 24–33:

```js
    /**
     * @param {Object} opts
     * @param {string} opts.gameId - required, id of the tournament/game document
     * @param {string|null} opts.teamId - optional, if present a "Team chat" tab is shown
     * @param {number} opts.messageLimit - how many recent messages to load (default 100)
     */
    constructor(opts = {}) {
        this.gameId = opts.gameId;
        this.teamId = opts.teamId || null;
        this.messageLimit = opts.messageLimit || 100;
```

with:

```js
    /**
     * @param {Object} opts
     * @param {string} opts.tournamentId - required, id of the tournament document
     * @param {string|null} opts.teamId - optional, if present a "Team chat" tab is shown
     * @param {number} opts.messageLimit - how many recent messages to load (default 100)
     */
    constructor(opts = {}) {
        this.tournamentId = opts.tournamentId;
        this.teamId = opts.teamId || null;
        this.messageLimit = opts.messageLimit || 100;
```

- [ ] **Step 3: Fix the `mount()` guard and add anonymous-user handling**

Replace lines 46–74 (`mount()`):

```js
    /** Call this once Firebase is ready. Builds the DOM and starts listening. */
    mount() {
        if (this._mounted) return;
        if (!this.gameId) {
            console.error('ChatModule: gameId is required, chat will not be shown.');
            return;
        }
        if (!window.firebaseDB) {
            console.error('ChatModule: window.firebaseDB not found. Load firebase-loader.js first and wait for "firebase-ready".');
            return;
        }

        this.db = window.firebaseDB;
        this.auth = firebase.auth();
        this.currentUser = this.auth.currentUser;

        // Keep currentUser fresh (in case chat mounts before auth resolves)
        this.auth.onAuthStateChanged(user => {
            this.currentUser = user;
        });

        this._injectStyles();
        this._buildDom();
        this._attachEvents();
        this._listenToRoom('tournament');
        if (this.teamId) this._listenToRoom('team');

        this._mounted = true;
    }
```

with:

```js
    /** Call this once Firebase is ready. Builds the DOM and starts listening. */
    mount() {
        if (this._mounted) return;
        if (!this.tournamentId) {
            console.error('ChatModule: tournamentId is required, chat will not be shown.');
            return;
        }
        if (!window.firebaseDB) {
            console.error('ChatModule: window.firebaseDB not found. Load firebase-loader.js first and wait for "firebase-ready".');
            return;
        }

        this.db = window.firebaseDB;
        this.auth = firebase.auth();
        this.currentUser = this.auth.currentUser;

        // Keep currentUser fresh (in case chat mounts before auth resolves)
        this.auth.onAuthStateChanged(user => {
            this.currentUser = user;
            this._updateInputState();
        });

        this._injectStyles();
        this._buildDom();
        this._attachEvents();
        this._updateInputState();
        this._listenToRoom('tournament');
        if (this.teamId) this._listenToRoom('team');

        this._mounted = true;
    }

    /**
     * Anonymous sessions (spectator/onboarding pages) can read chat but not
     * post — enforced server-side by the Firestore rules; this just keeps
     * the UI from offering a send button that will always fail.
     */
    _updateInputState() {
        if (!this.input) return;
        const isAnon = this.currentUser?.isAnonymous === true;
        this.input.disabled = isAnon;
        this.input.placeholder = isAnon ? 'Sign in to chat' : 'Type a message…';
        const sendBtn = this.form?.querySelector('.chat-send');
        if (sendBtn) sendBtn.disabled = isAnon;
    }
```

- [ ] **Step 4: Rename `switchGame` to `switchTournament`**

Replace lines 84–126 (the whole method):

```js
    /**
     * Call this whenever the nav dropdown switches the active tournament
     * WITHOUT a page reload. Tears down old listeners and re-subscribes
     * to the new gameId/teamId. Safe to call even if chat panel is open.
     *
     * @param {string} newGameId
     * @param {string|null} newTeamId
     */
    switchGame(newGameId, newTeamId = null) {
        if (!newGameId) {
            console.error('ChatModule.switchGame: newGameId is required');
            return;
        }

        Object.values(this.unsubscribers).forEach(unsub => unsub && unsub());
        this.unsubscribers = {};

        this.gameId = newGameId;
        this.teamId = newTeamId;
        this.messagesByRoom = { tournament: [], team: [] };
        this.activeRoom = 'tournament';

        const tabsWrap = this.container.querySelector('.chat-tabs');
        tabsWrap.innerHTML = `
            <button class="chat-tab active" data-room="tournament">Tournament</button>
            ${this.teamId ? `<button class="chat-tab" data-room="team">My Team</button>` : ''}
        `;
        this.tabs = this.container.querySelectorAll('.chat-tab');
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.activeRoom = tab.dataset.room;
                tab.querySelector('.chat-unread-dot')?.remove();
                this._renderMessages();
            });
        });

        this._listenToRoom('tournament');
        if (this.teamId) this._listenToRoom('team');

        this._renderMessages();
    }
```

with:

```js
    /**
     * Call this whenever the nav dropdown switches the active tournament
     * WITHOUT a page reload. Tears down old listeners and re-subscribes
     * to the new tournamentId/teamId. Safe to call even if chat panel is open.
     *
     * @param {string} newTournamentId
     * @param {string|null} newTeamId
     */
    switchTournament(newTournamentId, newTeamId = null) {
        if (!newTournamentId) {
            console.error('ChatModule.switchTournament: newTournamentId is required');
            return;
        }

        Object.values(this.unsubscribers).forEach(unsub => unsub && unsub());
        this.unsubscribers = {};

        this.tournamentId = newTournamentId;
        this.teamId = newTeamId;
        this.messagesByRoom = { tournament: [], team: [] };
        this.activeRoom = 'tournament';

        const tabsWrap = this.container.querySelector('.chat-tabs');
        tabsWrap.innerHTML = `
            <button class="chat-tab active" data-room="tournament">Tournament</button>
            ${this.teamId ? `<button class="chat-tab" data-room="team">My Team</button>` : ''}
        `;
        this.tabs = this.container.querySelectorAll('.chat-tab');
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.activeRoom = tab.dataset.room;
                tab.querySelector('.chat-unread-dot')?.remove();
                this._renderMessages();
            });
        });

        this._listenToRoom('tournament');
        if (this.teamId) this._listenToRoom('team');

        this._renderMessages();
    }
```

- [ ] **Step 5: Fix the Firestore collection path**

Replace lines 128–143:

```js
    // ---------- Firestore paths ----------

    _tournamentRoomRef() {
        return this.db.collection('games').doc(this.gameId)
            .collection('chatTournament');
    }

    _teamRoomRef() {
        return this.db.collection('games').doc(this.gameId)
            .collection('chatTeams').doc(String(this.teamId))
            .collection('messages');
    }

    _roomRef(room) {
        return room === 'team' ? this._teamRoomRef() : this._tournamentRoomRef();
    }
```

with:

```js
    // ---------- Firestore paths ----------

    _tournamentRoomRef() {
        return this.db.collection('tournaments').doc(this.tournamentId)
            .collection('chatTournament');
    }

    _teamRoomRef() {
        return this.db.collection('tournaments').doc(this.tournamentId)
            .collection('chatTeams').doc(String(this.teamId))
            .collection('messages');
    }

    _roomRef(room) {
        return room === 'team' ? this._teamRoomRef() : this._tournamentRoomRef();
    }
```

- [ ] **Step 6: Block sends from anonymous users client-side too**

Replace lines 164–171 (start of `_sendMessage`):

```js
    async _sendMessage(text) {
        text = text.trim();
        if (!text) return;
        if (!this.currentUser) {
            alert('You need to be signed in to chat.');
            return;
        }
```

with:

```js
    async _sendMessage(text) {
        text = text.trim();
        if (!text) return;
        if (!this.currentUser || this.currentUser.isAnonymous) {
            alert('You need to be signed in to chat.');
            return;
        }
```

- [ ] **Step 7: Manual verification (syntax only — no page loads this file yet)**

Run a syntax check with Node (doesn't execute browser-only globals, just parses):

```bash
node --check "BoardGame/shared/scripts/chat-module.js"
```

Expected: no output (exit code 0). If it prints a `SyntaxError`, fix it before moving on.

- [ ] **Step 8: Commit**

```bash
git add BoardGame/shared/scripts/chat-module.js
git commit -m "Fix chat-module.js to use tournaments/{tournamentId}, add anonymous-user read-only UI"
```

---

### Task 2: Add Firestore security rules for the two chat rooms

**Files:**
- Modify: `BoardGame/firestore.rules`
- Modify: `BoardGame/docs/architecture/firestore-rules.md`

- [ ] **Step 1: Add the `isAnonymous()` helper**

In `BoardGame/firestore.rules`, right after `isOwner()` (lines 34–37):

```
    /// Checks if the requester owns the document at userId. Free.
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
```

add a new helper immediately after it:

```
    /// Checks if the requester owns the document at userId. Free.
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    /// True for Firebase anonymous auth sessions (spectator/onboarding pages).
    /// Free — reads only the auth token, no Firestore lookup.
    function isAnonymous() {
      return request.auth.token.firebase.sign_in_provider == 'anonymous';
    }
```

- [ ] **Step 2: Add the two chat subcollection rule blocks**

In `BoardGame/firestore.rules`, the `tournaments/{tournamentId}` match block currently ends with the `matches`/`actions` subcollection (lines 127–140) right before the block's closing brace (line 141):

```
      // -------------------------------------------------------------------
      // 2c. MATCHES — tournaments/{tid}/matches/{matchId}
      // -------------------------------------------------------------------
      match /matches/{matchId} {
        allow read:  if isAdmin();
        allow write: if isAdmin();

        // 2d. ACTIONS — .../matches/{mid}/actions/{actionId}
        // Undo/redo history for match state changes.
        match /actions/{actionId} {
          allow read:  if isAdmin();
          allow write: if isAdmin();
        }
      }
    }
```

Add the two new subcollection matches between the `matches` block and the closing brace:

```
      // -------------------------------------------------------------------
      // 2c. MATCHES — tournaments/{tid}/matches/{matchId}
      // -------------------------------------------------------------------
      match /matches/{matchId} {
        allow read:  if isAdmin();
        allow write: if isAdmin();

        // 2d. ACTIONS — .../matches/{mid}/actions/{actionId}
        // Undo/redo history for match state changes.
        match /actions/{actionId} {
          allow read:  if isAdmin();
          allow write: if isAdmin();
        }
      }


      // -------------------------------------------------------------------
      // 2e. TOURNAMENT CHAT — tournaments/{tid}/chatTournament/{messageId}
      // -------------------------------------------------------------------
      // One shared room per tournament. Anonymous (spectator/onboarding)
      // sessions can read but not post. Messages are immutable — no
      // update/delete once created.
      match /chatTournament/{messageId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated() && !isAnonymous()
                      && request.resource.data.senderId == request.auth.uid
                      && request.resource.data.text is string
                      && request.resource.data.text.size() > 0
                      && request.resource.data.text.size() <= 500
                      && request.resource.data.createdAt == request.time;
        allow update, delete: if false;
      }


      // -------------------------------------------------------------------
      // 2f. TEAM CHAT — tournaments/{tid}/chatTeams/{teamId}/messages/{messageId}
      // -------------------------------------------------------------------
      // Private per-team room. Only that team's players (matched via the
      // requester's users/{uid}.assignedTeamId field) plus admins/god can
      // read or post. assignedTeamId may be stored as a number, so it's
      // cast to string before comparing against the path's string teamId.
      match /chatTeams/{teamId}/messages/{messageId} {
        allow read: if isAuthenticated()
                    && (isAdmin() || string(getUserData().assignedTeamId) == teamId);
        allow create: if isAuthenticated() && !isAnonymous()
                      && (isAdmin() || string(getUserData().assignedTeamId) == teamId)
                      && request.resource.data.senderId == request.auth.uid
                      && request.resource.data.teamId == teamId
                      && request.resource.data.text is string
                      && request.resource.data.text.size() > 0
                      && request.resource.data.text.size() <= 500
                      && request.resource.data.createdAt == request.time;
        allow update, delete: if false;
      }
    }
```

- [ ] **Step 3: Update the architecture doc's diagram**

In `BoardGame/docs/architecture/firestore-rules.md`, section 3 (`## 3. Tournaments & Subcollections`), add two new subgraphs to the mermaid diagram right after the `matches/{matchId}` subgraph (currently lines 90–95):

```
    subgraph "matches/{matchId}"
        M_ALL["read/write: isAdmin"]
        subgraph "actions/{actionId}"
            A_ALL["read/write: isAdmin"]
        end
    end
```

becomes:

```
    subgraph "matches/{matchId}"
        M_ALL["read/write: isAdmin"]
        subgraph "actions/{actionId}"
            A_ALL["read/write: isAdmin"]
        end
    end

    subgraph "chatTournament/{messageId}"
        CT_R["read: isAuthenticated"]
        CT_C["create: isAuthenticated, !isAnonymous, senderId==self"]
        CT_UD["update/delete: never — immutable log"]
    end

    subgraph "chatTeams/{teamId}/messages/{messageId}"
        CTeam_R["read: isAdmin OR own assignedTeamId"]
        CTeam_C["create: isAdmin OR own assignedTeamId, !isAnonymous, senderId==self"]
        CTeam_UD["update/delete: never — immutable log"]
    end
```

- [ ] **Step 4: Update the permission matrix table**

In the same file, section 6 (`## 6. Permission Matrix Summary`), add two rows right after the `matches`/`actions` row (currently the table ends its tournament-subcollection rows there):

```
    matches               |   -    |     -     |    -         | CRUD  | CRUD
      actions             |   -    |     -     |    -         | CRUD  | CRUD
  chatTournament          |   -    |    R      |    R         | CR    | CR
  chatTeams (own team)    |   -    |     -     |    R C       | R C†  | CRUD
```

Add a footnote below the table's existing footnotes (after the `*** Registration update only...` line):

```
†   Admin/God bypass the assignedTeamId check and can read/post in any team's chat.
```

- [ ] **Step 5: Manual verification**

Firestore rules can't be evaluated locally without the emulator (not configured in this repo), so verify by deploying to the dev/test Firebase project and checking the Firestore console's Rules Playground:

1. Open the Firebase console → Firestore → Rules → Rules Playground.
2. Simulate a `create` at `tournaments/<real-id>/chatTournament/test1` with an authenticated (non-anonymous) UID and `{ senderId: '<that same uid>', text: 'hi', createdAt: <server timestamp> }` — expect **Allow**.
3. Same simulation but with `senderId` set to a *different* uid — expect **Deny**.
4. Simulate the same `create` with an anonymous auth token (`firebase.sign_in_provider: 'anonymous'`) — expect **Deny**.
5. Simulate a `create` at `tournaments/<real-id>/chatTeams/<teamId>/messages/test1` as a user whose `users/{uid}` doc has `assignedTeamId` equal to `<teamId>` (test with a numeric value in the doc, since that's how some existing docs store it) — expect **Allow**.
6. Same simulation as a user assigned to a *different* team — expect **Deny**.
7. Simulate a `get` (read) on an existing message in `chatTeams/<teamId>/messages/...` as an admin whose `users/{uid}.assignedTeamId` does **not** match `<teamId>` — expect **Allow** (admin bypass).

- [ ] **Step 6: Commit**

```bash
git add BoardGame/firestore.rules BoardGame/docs/architecture/firestore-rules.md
git commit -m "Add Firestore rules for tournament and team chat rooms"
```

---

### Task 3: Wire chat into admin.html

**Files:**
- Modify: `BoardGame/full/admin.html:729-730`
- Modify: `BoardGame/full/scripts/admin.js:328-334`

- [ ] **Step 1: Load the script**

In `BoardGame/full/admin.html`, between the existing `toast.js` include and `scripts/admin.js` (lines 729–730):

```html
    <script src="../shared/scripts/toast.js"></script>
    <script src="scripts/admin.js"></script>
```

becomes:

```html
    <script src="../shared/scripts/toast.js"></script>
    <script src="../shared/scripts/chat-module.js"></script>
    <script src="scripts/admin.js"></script>
```

- [ ] **Step 2: Mount/switch chat inside `loadTournament()`**

In `BoardGame/full/scripts/admin.js`, `loadTournament()` currently reads (lines 328–334):

```js
    currentTournamentId = tournamentId;

    // Cache tournament context for navbar and cross-page navigation
    sessionStorage.setItem('currentTournamentId', tournamentId);
    localStorage.setItem('currentTournamentId', tournamentId);

    showStatus('Loading tournament...', 'info');
```

Add the chat mount/switch call right after the storage writes:

```js
    currentTournamentId = tournamentId;

    // Cache tournament context for navbar and cross-page navigation
    sessionStorage.setItem('currentTournamentId', tournamentId);
    localStorage.setItem('currentTournamentId', tournamentId);

    // Tournament chat — mount once, then just re-point it at the new tournament.
    // Admins aren't on a team, so no teamId is passed.
    if (window.ChatModule) {
        if (window._chatModule) {
            window._chatModule.switchTournament(tournamentId);
        } else {
            window._chatModule = new ChatModule({ tournamentId });
            window._chatModule.mount();
        }
    }

    showStatus('Loading tournament...', 'info');
```

- [ ] **Step 3: Manual verification**

1. Serve the repo locally (e.g. VS Code Live Server) and open `http://127.0.0.1:5500/BoardGame/full/admin.html?tournamentId=<a real tournament id>` signed in as an admin.
2. Confirm a chat FAB (💬) appears fixed in the bottom-right corner.
3. Click it, confirm the panel opens showing only a "Tournament" tab (no "My Team" tab).
4. Type a message and send it. Confirm it appears immediately in the panel, right-aligned (your own message styling).
5. In the Firebase console, confirm a new document was created at `tournaments/<id>/chatTournament/` with your `senderId`, `senderName`, `text`, and a `createdAt` server timestamp.
6. If the page has a tournament-switcher dropdown, switch to a different tournament without reloading — confirm the chat panel clears and starts showing that tournament's messages (proves `switchTournament` is wired, not just initial mount).

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/admin.html BoardGame/full/scripts/admin.js
git commit -m "Wire tournament chat into admin.html"
```

---

### Task 4: Wire chat into god.html

**Files:**
- Modify: `BoardGame/full/god.html:801-802`
- Modify: `BoardGame/full/scripts/god-app.js:479-480`

- [ ] **Step 1: Load the script**

In `BoardGame/full/god.html`, between `toast.js` and `pdf-generator.js` (lines 801–802):

```html
    <script src="../shared/scripts/toast.js"></script>
    <script src="../shared/scripts/pdf-generator.js"></script>
```

becomes:

```html
    <script src="../shared/scripts/toast.js"></script>
    <script src="../shared/scripts/chat-module.js"></script>
    <script src="../shared/scripts/pdf-generator.js"></script>
```

- [ ] **Step 2: Mount/switch chat inside `GodApp.loadTournament()`**

In `BoardGame/full/scripts/god-app.js`, `loadTournament()` currently reads (lines 479–480):

```js
        this._currentTournamentId = tournamentId;
        this.ui.showStatus('Loading tournament...', 'info');
```

Add the chat mount/switch call between them:

```js
        this._currentTournamentId = tournamentId;

        // Tournament chat — mount once, then just re-point it at the new tournament.
        // God isn't on a team, so no teamId is passed.
        if (window.ChatModule) {
            if (window._chatModule) {
                window._chatModule.switchTournament(tournamentId);
            } else {
                window._chatModule = new ChatModule({ tournamentId });
                window._chatModule.mount();
            }
        }

        this.ui.showStatus('Loading tournament...', 'info');
```

- [ ] **Step 3: Manual verification**

1. Open `http://127.0.0.1:5500/BoardGame/full/god.html?tournamentId=<a real tournament id>` signed in as god.
2. Confirm the chat FAB appears and opens a Tournament-only chat panel, same as admin.html.
3. Send a message from god.html, then open admin.html for the **same** tournament in a second browser/profile — confirm the message appears live in admin.html's chat without a reload (proves both pages read the same `chatTournament` subcollection).
4. Switch tournaments via the tournament list/selector — confirm chat re-points to the new tournament (empty until messages exist there).

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/god.html BoardGame/full/scripts/god-app.js
git commit -m "Wire tournament chat into god.html"
```

---

### Task 5: Wire chat into team.html

**Files:**
- Modify: `BoardGame/full/team.html:243-246`
- Modify: `BoardGame/full/scripts/team-controls.js:123-126`

- [ ] **Step 1: Load the script**

In `BoardGame/full/team.html`, between `player-utils.js` and the "Team Controls Script" comment (lines 243–246):

```html
    <script src="../shared/scripts/player-utils.js"></script>

    <!-- Team Controls Script -->
    <script src="scripts/team-controls.js"></script>
```

becomes:

```html
    <script src="../shared/scripts/player-utils.js"></script>
    <script src="../shared/scripts/chat-module.js"></script>

    <!-- Team Controls Script -->
    <script src="scripts/team-controls.js"></script>
```

- [ ] **Step 2: Mount chat once team membership is verified**

In `BoardGame/full/scripts/team-controls.js`, inside the tournament snapshot listener, right after membership is confirmed (lines 123–126):

```js
            console.log('[Team Controls] Team membership verified');

            // Dispatch teamLoaded event for theme application
            window.dispatchEvent(new CustomEvent('teamLoaded', {
                detail: { teamId: currentTeamId }
            }));
```

becomes:

```js
            console.log('[Team Controls] Team membership verified');

            // Tournament + team chat — mount once; later snapshots just update gameData
            if (window.ChatModule && !window._chatModule) {
                window._chatModule = new ChatModule({ tournamentId: currentTournamentId, teamId: currentTeamId });
                window._chatModule.mount();
            }

            // Dispatch teamLoaded event for theme application
            window.dispatchEvent(new CustomEvent('teamLoaded', {
                detail: { teamId: currentTeamId }
            }));
```

- [ ] **Step 3: Manual verification**

1. Open `http://127.0.0.1:5500/BoardGame/full/team.html?tournamentId=<id>&teamId=<a team you're a player on>`.
2. Confirm the chat panel shows **both** "Tournament" and "My Team" tabs.
3. Send a message in "My Team" — confirm it's stored at `tournaments/<id>/chatTeams/<teamId>/messages/` in the Firebase console.
4. Open team.html for a **different** team in the same tournament (different `teamId`, different signed-in player) — confirm that player's "My Team" tab does **not** show the first team's messages, and confirm attempting to read the first team's `chatTeams/<teamId>/messages` collection directly via the browser console (`firebase.firestore().collection('tournaments').doc('<id>').collection('chatTeams').doc('<other teamId>').collection('messages').get()`) throws a `permission-denied` error.
5. Confirm the "Tournament" tab still shows messages sent from admin.html/god.html in Tasks 3–4.

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/team.html BoardGame/full/scripts/team-controls.js
git commit -m "Wire tournament and team chat into team.html"
```

---

### Task 6: Wire chat into home.html

**Files:**
- Modify: `BoardGame/full/home.html:27`
- Modify: `BoardGame/full/home.html:1108-1114` (inside `loadPlayerData()`)

- [ ] **Step 1: Load the script**

In `BoardGame/full/home.html`, right after `navbar.js` (line 27):

```html
  <script src="../shared/scripts/firebase-loader.js"></script>
  <script src="../shared/scripts/navbar.js"></script>
```

becomes:

```html
  <script src="../shared/scripts/firebase-loader.js"></script>
  <script src="../shared/scripts/navbar.js"></script>
  <script src="../shared/scripts/chat-module.js"></script>
```

- [ ] **Step 2: Mount chat only for players with a confirmed team assignment**

In `BoardGame/full/home.html`, `loadPlayerData()` currently reads (lines 1108–1114):

```js
          if (teamData) {
            document.getElementById('playerTeamName').textContent = teamData.name || 'Unknown';
            document.getElementById('playerTeamPoints').textContent = `${teamData.points || 0} points`;
            document.getElementById('playerSpellCards').textContent = tournamentData.spellPiles?.[teamData.id]?.hand?.length || 0;
            document.getElementById('playerWins').textContent = teamData.gamesWon || 0;
            return;
          }
```

becomes:

```js
          if (teamData) {
            document.getElementById('playerTeamName').textContent = teamData.name || 'Unknown';
            document.getElementById('playerTeamPoints').textContent = `${teamData.points || 0} points`;
            document.getElementById('playerSpellCards').textContent = tournamentData.spellPiles?.[teamData.id]?.hand?.length || 0;
            document.getElementById('playerWins').textContent = teamData.gamesWon || 0;

            // Tournament + team chat — only for players with a confirmed assignment
            if (window.ChatModule && !window._chatModule) {
              window._chatModule = new ChatModule({
                tournamentId: userProfile.assignedTournamentId,
                teamId: userProfile.assignedTeamId
              });
              window._chatModule.mount();
            }

            return;
          }
```

- [ ] **Step 3: Manual verification**

1. Sign in as a player who already has `assignedTournamentId`/`assignedTeamId` set on their `users/{uid}` doc, and open `http://127.0.0.1:5500/BoardGame/full/home.html`.
2. Confirm the chat FAB appears with both Tournament and My Team tabs, and that messages sent here match what's visible on team.html for the same tournament/team.
3. Sign in as a player with **no** team assignment (no `assignedTournamentId`/`assignedTeamId` on their user doc) and open home.html — confirm no chat FAB appears at all.
4. Sign in as an admin (not a player) and open home.html — confirm no chat FAB appears here either (admins get chat via admin.html/god.html instead, per the design).

- [ ] **Step 4: Commit**

```bash
git add BoardGame/full/home.html
git commit -m "Wire tournament and team chat into home.html for assigned players"
```

---

### Task 7: End-to-end verification across all four pages

**Files:** none (verification only)

- [ ] **Step 1: Cross-page live sync check**

1. Pick one real tournament with at least two teams, each with a signed-in player available to test with.
2. Open admin.html, god.html, and team.html (for Team A) side by side, all pointed at the same tournament.
3. Send a message from god.html's Tournament room — confirm it appears live (no reload) in admin.html's and team.html's Tournament tabs within a couple seconds.
4. Send a message from Team A's My Team tab in team.html — confirm it does **not** appear in admin.html or god.html's Tournament tab (different room), and confirm it's not visible from a Team B player's team.html session.

- [ ] **Step 2: Anonymous / read-only check**

1. Open `view.html` or the onboarding flow for the same tournament (these use anonymous auth per `firestore-rules.md`) in a private/incognito window.
2. If either page is later wired to `ChatModule` in a future pass this step becomes directly checkable in the UI; for now, verify enforcement is server-side by running this in that anonymous session's browser console:
   ```js
   firebase.firestore().collection('tournaments').doc('<tournament id>')
     .collection('chatTournament').add({
       text: 'test', senderId: firebase.auth().currentUser.uid,
       senderName: 'anon', createdAt: firebase.firestore.FieldValue.serverTimestamp()
     });
   ```
3. Confirm the promise rejects with a `permission-denied` error (rules correctly block anonymous writes), while a plain `.get()` on the same collection succeeds (anonymous reads are allowed).

- [ ] **Step 3: Regression check on unrelated features**

1. On each of the four modified pages, confirm existing functionality still works: admin.html's tournament switching and stat badges, god.html's tournament list and Edit Tournament modal, team.html's board/match rendering, home.html's role sections and referral codes modal.
2. Confirm no new console errors appear on any of the four pages beyond the expected ones already documented (e.g. none related to `ChatModule`).

No commit for this task — it's a verification pass only.
