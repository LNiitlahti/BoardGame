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
- `e2e-hex-placement-gate.js` — re-verification test for the hex_placement_1/2
  phase gate (TODO.md: the "Match N hex placed" requirement "felt too loosely
  satisfied during smoke testing... needs re-verification... once there's
  something real to place"). Read the gate source first: phase-manager.js's
  `_calculateRequirements('hex_placement_1'|'hex_placement_2')` (~line 1094)
  is gated purely by `_getPendingHexCount() === 0`; on god.html that's wired
  (god-app.js:171) to `ResultManager._pendingHexWins.length` — an in-memory
  instance field, never written to Firestore, so it always starts at 0 on a
  fresh page load and needs no snapshot/restore of its own. Seeds a synthetic
  queue entry (same pattern as `e2e-round-advance.js`) using REAL player ids
  from `e2e-disposable-1`'s actual Team Alpha/Team Beta rosters (2 players
  each side, so `confirmResult()` gives both "full credit" and the pending
  win entry's `teamIds` is genuinely populated — exercises the real
  per-teamId match in `_clearPendingHexWin`, not the degenerate
  always-filtered empty-`teamIds` case), then drives everything else through
  the real production functions: `ResultManager.quickConfirmResult()` (same
  as the "Confirm Result" button) to generate a genuine pending hex win,
  `PhaseManager.advancePhase()` (same as "Next Phase") to prove it's blocked
  before placement and allowed after, and `BoardManager.assignTeamToHex()`
  (same as the team-picker "assign team to hex" button) to place it. Confirms
  both gate states against live data: `advancePhase()` returns `false` and
  `currentPhase` stays `hex_placement_1` while the win is pending; once
  placed, `advancePhase()` returns `true` and `currentPhase` moves to
  `spell_window_1` (the real next phase). Only tests hex_placement_1 —
  hex_placement_2 shares the identical `_getPendingHexCount() === 0`
  condition with no phase-specific branching, so a second run would add no
  coverage. Snapshots/restores `gameQueue`, `currentPhase`, `teams` (win/
  loss/points stats get mutated by `confirmResult()`), `gamesPlayed`, and
  `gameHistory` in a `finally` block. The placed hex is cleared via the real
  `assignTeamToHex(coord, null)` "Clear Hex" path rather than by restoring a
  `board` snapshot — `saveGameState()`'s Firestore `set(..., {merge:true})`
  merges nested map fields key-by-key instead of replacing them wholesale, so
  writing back an old `board` object would silently leave the test's added
  coordinate behind forever; `assignTeamToHex(coord, null)` issues the
  explicit `FieldValue.delete()` needed to actually remove it, and is called
  unconditionally (safe even if placement never happened).
- `e2e-asymmetric-teams.js` — coverage for asymmetric team-size matches
  (TODO.md: "Match 1 as a 3v3 + 2v2 combined/split match — unclear how slot
  logic and scoring handle that shape"). Read from source first, not guessed
  from the wording: this maps onto a real, already-built feature —
  `games-config.js`'s `splitFormat`/`format: '3v3+2v2'` games (aoe4/wc3/sc2/
  dow2), implemented by `balance-optimizer.js`'s `selectOptimal3v3_2v2()` and
  `smart-match-generator.js`'s `generate3v3_2v2Match()`. ONE "combined" round
  slot = TWO linked gameQueue entries (`playType: '3v3'` and `'2v2'`,
  `isSimultaneous: true`) sharing the same `slot`/`roundNumber`; each entry
  is internally symmetric (3-vs-3 or 2-vs-2) — the asymmetry is ACROSS the
  pair, not within either match's two sides. Of the 5 teams involved, 1
  "split" team contributes exactly 1 player to EACH side of the 3v3 leg
  (its own two players end up on opposing sides) and 0 players to the 2v2
  leg, so it never has 2+ players on one side of either leg and — per
  result-manager.js's `confirmResult()` "2+ players on a side = full
  credit" rule — gets NEITHER a win nor a loss from the combined match, only
  a `splitCount` increment (tagged on the 3v3 leg only). Since
  e2e-disposable-1 only has 2 real teams but `BalanceOptimizer`/
  `SmartMatchGenerator` hard-require exactly 5 teams of 2 players to compute
  a partition, the test temporarily adds 3 synthetic teams built from real
  already-unassigned player accounts sitting in the registry, runs the real
  optimizer/generator methods directly (not through `confirmAutoMatch()` —
  see below), confirms both linked legs via `ResultManager
  .quickConfirmResult()` with *different* winner indices per leg, and
  asserts: `PhaseManager.getSlotRequirements()` treats the pair as ONE slot
  (not met while either leg is ongoing, met only once both are confirmed);
  each of the 4 full-representation teams gets exactly the right win/loss/
  points/gamesPlayed delta for its leg; the split team gets zero win/loss/
  points delta and exactly `splitCount + 1`. Also found and reports (without
  fixing) a real bug along the way: god-app.js:1190-1191 wires
  `window.confirmAutoMatch`/`window.generateSuggestedMatches` on god.html to
  `MatchCreationManager` methods whose completion path unconditionally
  touches `#autoMatchModal`/`#autoMatchContent` DOM elements that only exist
  in `full/admin.html`, not god.html — calling `confirmAutoMatch()` on
  god.html throws `Cannot read properties of null (reading 'classList')`.
  The test demonstrates this live as a diagnostic (not a pass/fail gate, so
  a future DOM fix on either page doesn't spuriously break this scoring
  test) and works around it by calling the same non-DOM-dependent
  `BalanceOptimizer`/`SmartMatchGenerator` methods `confirmAutoMatch()`
  itself delegates to, building the resulting queue entries the same way its
  source does. Snapshots/restores `teams`, `players`, `gameQueue`,
  `currentPhase`, `gamesPlayed`, `gameHistory` in a `finally` block — see
  the two new gotchas below, both discovered while building this test.
- `e2e-slot-tagging-sanity.js` — **standing sanity check, meant to be re-run,
  not a one-off regression test** (see TODO.md's "RESOLVED (was NOT a CL-32
  regression, false alarm from confusing data)" entry). That investigation
  found `cl32-smoke-test`'s ~117 leftover pending matches had scrambled `slot`
  tags (sampled: 1,1,1,2,2,1,2,1,2,1) and concluded it was residue from
  repeated past test-data generation on a heavily-reused scratch tournament,
  not a bug in the tagging logic itself (`admin-improved-adapter.js`'s
  `_tagNewQueueEntries`/`_computeCurrentSlot`, wired onto the real
  `window.addMatchToQueue`). This script proves that conclusion by driving
  the REAL guided-flow match-creation function on **full/admin.html** (per
  the god.html-has-no-tagging-step gotcha below) — seeding its input state
  (`manualGameSetup.sides` / `#gameType`) with real player ids from
  `e2e-disposable-1`'s Team Alpha/Team Beta rosters rather than hand-
  constructing pre-tagged queue entries — to create 2 matches while Match
  Slot 1 is targeted (`window.setTargetMatchSlot(1)`) and 2 more while Slot 2
  is targeted, then asserts the resulting `slot` tags partition cleanly (not
  alternating) AND that the on-screen "Match 1"/"Match 2" slot-card guidance
  text (`_renderMatchSlotCards`/`_computeSlotStep`/`_pendingSlotMatches`,
  read live from the DOM, not re-derived) agrees with the raw field ("2
  matches queued." for each). Confirmed passing against live `e2e-disposable-1`
  data — fresh queues are NOT scrambled, matching the prior theory. **Intended
  to be re-run before the real event**, against the real event tournament
  once it exists (`TEST_TOURNAMENT_ID=<real-id> node
  dev/tests/e2e-slot-tagging-sanity.js`), before trusting any live "Next
  up"/slot mismatch as a real bug rather than leftover-data confusion — this
  is exactly what TODO.md asked for going forward. Real Firestore writes
  happen (each `addMatchToQueue()` call saves for real); snapshots/restores
  `gameQueue`/`currentPhase` in a `finally` block like every sibling script.
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
- **`saveGameState()`'s Firestore `set(data, {merge: true})` does NOT delete
  nested map keys you simply omit.** For array-valued gameState fields
  (`gameQueue`, `teams`, `gameHistory`, ...) `merge: true` replaces the whole
  array wholesale, so snapshot/restore-by-reassignment works fine and is the
  established pattern in every script above. But `board` (`{ "q1r2": teamId,
  ... }`) is a nested Firestore MAP field, and merge-set on a map field only
  adds/overwrites the keys present in the write — keys that exist remotely
  but are absent from what you write are left untouched, not removed. So if
  a test adds `gameState.board[coord] = teamId` and later "restores" by
  reassigning `gameState.board` back to a pre-mutation snapshot and saving,
  the added coord is silently NOT deleted and leaks into the live tournament
  forever. The real "Clear Hex" UI button avoids this by calling
  `assignTeamToHex(coord, null)`, which issues an explicit
  `firebase.firestore.FieldValue.delete()` for that one field path — use that
  (or the equivalent explicit-delete pattern) to clean up any `board`
  mutation a test makes, not a snapshot/reassign. Found and worked around
  while building `e2e-hex-placement-gate.js`.
- **After `await window.godApp.saveGameState()`, a previously-held reference
  to a `gameState.gameQueue` (or other array-field) entry object can become
  stale.** `godApp.gameState` itself keeps its identity (per the gotcha
  above), but the Firestore `onSnapshot` listener's `Object.assign(gameState,
  snapshotData)` still REPLACES array-valued fields like `gameQueue`/`teams`
  wholesale with freshly-deserialized objects (same data, new object
  identity) — and that listener can fire and process between two `await`
  points in a test, not just at page load. A test that does
  `const entry = {...}; gs.gameQueue.push(entry); await saveGameState();
  entry.status = 'ongoing'; await saveGameState();` can silently no-op the
  second mutation: by the time it runs, `entry` may already be orphaned from
  the live `gs.gameQueue`, so `entry.status = 'ongoing'` mutates a detached
  copy nobody reads. Symptom: `getSlotRequirements()`/similar reads keep
  reporting the OLD value after a mutate-then-save you were sure took effect.
  Fix: don't hold onto entry references across a `saveGameState()` call —
  look the entry up fresh by id (`gs.gameQueue.find(e => e.id === id)`)
  immediately before mutating it, the same way `ResultManager
  .quickConfirmResult(id, ...)` itself does internally (which is exactly why
  calling real API methods by id, rather than passing them a held object
  reference, is the safe pattern used throughout this harness). Found and
  fixed while building `e2e-asymmetric-teams.js`.
- **Adding a team whose `.players` roster references real player ids without
  also updating those players' `teamId` in `gameState.players` can silently
  delete OTHER, unrelated players from the tournament.** `PlayerUtils
  .needsPlayerMigration(gameState)` (player-utils.js) runs on every Firestore
  `onSnapshot` callback (deliberately not gated behind a one-time flag) and
  returns true if any team's roster player has a registry `teamId` that
  disagrees with the team it's rostered on. If so, `migrateToNormalizedPlayers()`
  auto-runs and — as part of legitimately rebuilding `team.playerIds` from
  `team.players` — PRUNES every `gameState.players` registry entry not
  referenced by ANY team's roster (its intended purpose: drop orphans left by
  real roster edits). A test that adds a temporary team by pushing a raw
  `players: [...]` array (pointing at real, currently-unassigned player
  accounts) without also setting `player.teamId` on those registry entries
  will trigger this, and since the prune target is "everyone not on a team,"
  it silently deletes every OTHER unassigned player in the tournament too —
  not just the ones the test is using. This actually happened while building
  `e2e-asymmetric-teams.js`: an early version left 12 real free-agent players
  in `e2e-disposable-1` stamped with orphaned `teamId` values pointing at
  teams the test had already removed again; required a manual repair. Fix:
  when a test adds a team referencing existing player-registry entries, set
  those entries' `teamId` to the new team's id at the same time (mirroring
  what `player-utils.js`'s `updatePlayerInRegistry` does for a real
  "assign player to team" action) — and snapshot/restore `gameState.players`
  in the `finally` block as a second safety net regardless.
