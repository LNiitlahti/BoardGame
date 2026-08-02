# E2E Puppeteer harness

Reusable login + navigation helpers for testing tournament-flow bugs against the
real production Firebase project (`boardgame-7b9f0` — there is no staging/emulator).
Built once here; don't recreate it in future sessions, just reuse these files.

## Files

- `e2e-server.js` — static file server (`startServer(rootDir, port)`), serves the
  `BoardGame/` directory so pages can be loaded via `http://localhost:8080/...`.
- `e2e-harness.js` — `login(page, baseUrl, email, password)`,
  `newLoggedInPage(browser, baseUrl, email, password)`,
  `gotoTournamentPage(page, baseUrl, pageName, tournamentId, extraParams)`.
- `e2e-smoke.js` — minimal script proving login works end-to-end; run it any time
  to sanity-check the harness still works (e.g. after a login.html change).
- `e2e-create-players.js` — creates N disposable player accounts (auth user +
  `users/{uid}` doc), bypassing the referral-code-gated signup UI. Each account
  runs in its own isolated browser context so it never disturbs an
  already-logged-in TD session in another tab. Usage:
  `node dev/tests/e2e-create-players.js Name1 Name2 ...` — prints
  email/password/uid for each; add them to `.env.e2e` yourself.
- `e2e-inspect-tournament.js` / `e2e-inspect-user.js` — quick read-only Firestore
  dumps (tournament team/player registry; a single user doc by email) for
  debugging test state without opening the app UI by hand.
- `e2e-round-advance.js` — regression test for the "match slot never reaches
  done" bug (stale/untagged gameQueue entries blocking a slot forever — see
  TODO.md and phase-manager.js's `getSlotRequirements`). Seeds Match Slot 2 via
  `window.godApp` on god.html with one real tagged match + 3 decoy stale/
  untagged matches, confirms the real match through the actual
  `ResultManager.quickConfirmResult` API, and asserts the slot reaches 'done'
  without the decoys blocking it. Snapshots/restores `e2e-disposable-1`'s
  `gameQueue`/`currentPhase` in a `finally` block so it never leaves synthetic
  test data behind, even if an assertion throws.
- `e2e-cleanup-stale-queue.js` — reusable one-time-per-tournament cleanup
  utility for the same bug: `node dev/tests/e2e-cleanup-stale-queue.js
  <tournamentId> [--apply] [--mode=retag|purge]`. Dry-run by default; refuses
  to run against `cl32-smoke-test`/`fast-test-2` (hardcoded blocklist, checked
  before touching Firestore).
- `e2e-next-up-availability.js` — regression test for the "Next up" match
  selection bug (see TODO.md's "HIGHER PRIORITY" entry, and the fix in
  admin-improved-adapter.js's `_excludeLiveConflicts`/
  `getPlayersInLiveMatches`): a slot's Next-up pick and the Match Queue
  panel's NEXT badge could both propose starting a match whose players were
  already live in a currently-ongoing match elsewhere. Unlike the other
  scripts here, this one drives **full/admin.html**, not god.html — both
  buggy selection functions live only in admin-improved-adapter.js, which
  admin.html loads and god.html does not. Seeds `gameState.gameQueue`/
  `currentPhase` **in-memory only** (via the page's bare `gameState`
  binding — admin.js declares it as a top-level `let`, not
  `window.gameState`, but it's accessible the same way from
  page.evaluate/waitForFunction since they share the page's global scope)
  and calls the page's global `updateDisplay()` to force a synchronous
  re-render — no `saveGameState()` call, so it never touches Firestore at
  all, nothing to restore server-side.
- `e2e-load-default-rooms.js` — plumbing test for "Load Default Rooms" on
  god.html, written after consolidating the three independently-diverged
  copies of the `config/defaultRooms` Firestore get/set logic (setup.html,
  board-manager.js, admin.js) into one shared implementation:
  `shared/scripts/default-rooms.js` (`loadDefaultRoomsDoc`/
  `saveDefaultRoomsDoc`). Only asserts the plumbing still works end-to-end
  through the shared function (`gameState.rooms` ends up matching whatever
  is currently in `config/defaultRooms`) — deliberately does NOT assert any
  particular room layout is "correct", since `config/defaultRooms` is still
  a single doc shared across every tournament and curating the right
  default is an explicitly out-of-scope manual step (see TODO.md "Load
  Default Rooms"). Snapshots/restores the tournament's `rooms` field in a
  `finally` block, since `loadDefaultRooms()` persists the loaded rooms
  back to the tournament doc via `_save()`.
- `e2e-ready-check.js` — verification test for the Discord/Game Lobby
  ready-check confirm-button flow (see TODO.md's "Verify the Discord/Game
  Lobby ready-check confirm buttons..." entry). Found and confirms a real bug
  while doing so: `_getPlayersWhoMustReadyForSlot()` in phase-manager.js reads
  `match.sides[].players[].teamId`, but no real match-creation code path
  (match-creation-manager.js) ever writes a `.sides` field shaped that way —
  every real queue entry only has `.teams: [{id, playerIds: [...]}]`. So
  `mustReady` is unconditionally empty for every real match ever created,
  regardless of linked accounts — not just a data-setup fluke in
  cl32-smoke-test as TODO.md speculated. Part 1 proves this live with 100%
  real match-creation shape (setup->lobby->playing in under 1.1s, zero player
  interaction). Part 2 seeds a synthetic `.sides` workaround (clearly marked
  as such) purely to verify the confirm-button/Firestore-write/auto-advance
  mechanics work correctly in isolation from the population bug — confirmed
  they do (only the population source is broken) — using a real disposable
  player account (`PLAYER14` in `.env.e2e`, already linked into
  `e2e-disposable-1`'s Team Alpha). Along the way this also found and fixed a
  trivial one-line bug blocking the test itself:
  `getGameDisplayName()` in team-controls.js called `GAMES_CONFIG.games.find(...)`
  treating the games registry (a plain object keyed by id) as an array, which
  threw a TypeError on every call and silently aborted team.html's whole
  render pass for that snapshot (since the render loop has no per-call
  try/catch and marks its signature as "rendered" before running); fixed to
  do the direct `GAMES_CONFIG.games[gameId]` lookup, matching the already-
  correct `GAMES_CONFIG.getGame()`/`getGameName()` pattern used elsewhere in
  the same file. Also reports (without fixing) a related, separate bug:
  `renderMatchCardsWithDiscord()`'s "does this match involve my team" filter
  checks `side.players[]` (uid/name/email objects) and never falls back to
  the real `side.playerIds` (plain id string) shape the way `_matchInvolvesUs()`
  elsewhere in the same file correctly does — so the lobby overlay's own
  match-info card (game name, opponent, Discord channel, lobby creator) never
  renders for any real match. Part 3 confirms TODO.md's other open question
  ("once live in playing, is there a way to retroactively confirm?") is a
  real, still-present gap: `renderPhaseOverlays()` and `renderTeammates()`
  both gate their confirm UI strictly on the slot's sub-phase being `'lobby'`
  — once a slot reaches `'playing'`, there is genuinely no UI path left to
  confirm Discord/lobby readiness. Snapshots/restores `gameQueue`,
  `currentPhase`, and `lobbyReady` in a `finally` block.
- `.env.e2e` (gitignored, not in git) — real credentials. Copy `.env.e2e.example`
  to create it if missing.

## One-time local setup (per machine/checkout)

The harness needs two gitignored files that are NOT tracked by git and won't be
present in a fresh worktree/clone:

1. `BoardGame/shared/scripts/firebase.js` — Firebase config (API keys). Copy it
   from an existing checkout; without it the app never leaves the
   "Authenticating..." screen.
2. `BoardGame/dev/tests/.env.e2e` — credentials, see below.
3. `npm install` inside `BoardGame/dev/` (installs `puppeteer` + `dotenv` into
   `BoardGame/dev/node_modules/`, also gitignored).

## Running

```bash
cd BoardGame
node dev/tests/e2e-smoke.js
```

Kills needed: if a previous run's static server didn't shut down cleanly, port
8080 may still be bound — check with `netstat -ano | findstr :8080` and stop the
stale process before rerunning.

## Credentials

`.env.e2e` currently holds one TD/god-admin account (see the repo owner for the
address — not written here since this file is committed to git). Player test
accounts (`PLAYER1_*`/`PLAYER2_*`) are intentionally blank — per-task scripts
create disposable player accounts programmatically rather than relying on
pre-existing ones.

## Test tournament

No shared scratch tournament is reused across tasks (decided 2026-08-02): each
task that needs one creates its own fresh disposable tournament via script and
records the ID in that task's script/commit, rather than writing to
`cl32-smoke-test` or `fast-test-2`. `e2e-disposable-1` was created for Task 1
and is safe for later tasks to keep reusing/mutating.

## Hard-won gotchas (read before writing a new script)

- **Don't use `networkidle0` for tournament pages.** god/admin/team/view all
  open persistent Firestore realtime-listener connections that never let the
  network go idle — `page.goto(..., {waitUntil: 'networkidle0'})` can hang or
  resolve inconsistently. Use `domcontentloaded` + an explicit
  `page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB)`
  instead (`gotoTournamentPage` and `login` in `e2e-harness.js` already do this
  — use them, don't hand-roll `page.goto`).
- **A roster swap permanently burns the incoming user's uid in that
  tournament's player registry**, even after they're later swapped back out
  (protects completed-match history from ever pointing at a reused id).
  `replacePlayerWithUser` checks "is this uid anywhere in `gameState.players`"
  and refuses with "User is already assigned in this tournament" if so — it
  does NOT check team assignment, just registry presence. Any repro that
  measures N separate swap operations needs N never-before-used disposable
  accounts (`e2e-create-players.js`), not 2 accounts toggled back and forth.
- **god.html's `showStatus()` delegates to `shared/scripts/toast.js`'s
  `showToast()`** (since god.html loads toast.js) — `#statusMessage` is never
  touched on that page. Wait for `.toast-container .toast-content` text, not
  `#statusMessage`, when asserting a god.html action's result.
- **`admin.html`/`god.html` live under `full/`, not at the repo root** (unlike
  `login.html`) — pass `full/god.html` / `full/admin.html` as the `pageName`
  to `gotoTournamentPage`, not bare `god.html` (which 404s and hangs
  `waitForFunction` for the full timeout with a confusing error).
- **`window.godApp` (god.html) exposes `gameState`, `phase` (PhaseManager),
  `result` (ResultManager), etc. directly** — `godApp.gameState` is the SAME
  mutable object instance the Firestore `onSnapshot` listener updates via
  `Object.assign` (not reassigned), so mutating
  `window.godApp.gameState.gameQueue`/`.currentPhase` in a `page.evaluate` and
  then calling `await window.godApp.saveGameState()` is a reliable way to seed
  a scenario without hand-rolling Firestore writes. `admin.html`'s equivalent
  (`admin-improved-adapter.js`) does NOT expose its `PhaseManager` instance on
  `window` — use god.html for anything that needs to call PhaseManager/
  ResultManager methods directly from a test.
- **god.html's match creation has no slot/round-tagging step at all** (that
  logic — `_tagNewQueueEntries`/`_computeCurrentSlot` — lives only in
  `admin-improved-adapter.js`, admin.html's newer guided-flow adapter). Any
  match created through god.html's UI is permanently untagged
  (`slot`/`roundNumber` both undefined) unless a test stamps those fields
  itself when constructing the queue entry.
- **admin.html requires `action-logger.js` to load BEFORE `admin.js`.**
  admin.js instantiates `new ActionLogger(...)` eagerly at its own top level
  (not lazily). If action-logger.js loads after admin.js, that throws a
  ReferenceError which aborts the rest of admin.js's top-level execution —
  including its `document.addEventListener('firebase-ready', ...)`
  registration — so the tournament silently never loads (`gameState.teams`
  stays `undefined` forever, no visible error unless you have a
  `page.on('pageerror', ...)` listener attached). This actually regressed in
  commit e1d9aea and was caught/fixed while building
  `e2e-next-up-availability.js`; if a future admin.html test hangs on
  `waitForFunction(() => gameState.teams.length > 0)`, check this script
  order first before assuming your test's own logic is wrong.
- **When deliberately reproducing a bug by temporarily reverting a fix
  (`git stash push -- <file>`) and running a test against it, wrap the test's
  cleanup/restore step in `try/finally`.** An assertion failure (the expected
  outcome when proving the bug still reproduces) otherwise skips the restore
  and leaves synthetic test data sitting in the shared disposable tournament
  for the next script to trip over — this happened once during Task 2's work
  and required a manual Firestore fix to `e2e-disposable-1`
  (`gameQueue: []`, `currentPhase` field deleted — that tournament's true
  baseline, confirmed via the tournament-list view showing
  `Status: setup | Round: 0 | Matches played: 0` before any test touched it).
