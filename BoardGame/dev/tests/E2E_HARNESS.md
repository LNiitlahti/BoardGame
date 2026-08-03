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
  **`e2e-inspect-tournament.js` ignores any CLI positional argument** — it
  only ever reads `process.env.TEST_TOURNAMENT_ID` (defaults to
  `e2e-disposable-1` in `.env.e2e`). Run it as
  `TEST_TOURNAMENT_ID=<id> node dev/tests/e2e-inspect-tournament.js`, not
  `node dev/tests/e2e-inspect-tournament.js <id>` — the latter silently
  dumps `e2e-disposable-1` (or whatever `.env.e2e` defaults to) regardless
  of what you typed. Found while building `e2e-navbar-primary-switch.js`:
  two "inspect a different tournament" calls with a positional arg both
  silently returned `e2e-disposable-1` again.
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
  **Only run this while the target tournament is quiet — no active TD
  session, no live spectator/big-screen display open.** The restore is a
  plain client-side read-modify-write (`gameState.gameQueue = ...; await
  saveGameState()`), not a Firestore transaction: while it runs, any
  connected viewer briefly sees the fake `roundNumber: 999801` queue/reset
  slot state, and any real concurrent write landing in the snapshot-restore
  window is silently lost (last-write-wins). Never run this against a
  tournament during active play, including to "just check" a live slot
  mismatch — recreate the suspected scenario on a disposable tournament
  instead.
- `e2e-swap-pending-rewrite.js` — regression test for TODO.md's "Pending
  (unplayed) matches keep showing retired player after a swap" finding, plus
  TODO.md Task 10's follow-up decision that mid-match (`'ongoing'`) swaps
  should ALSO reassign credit to the new occupant, not stay pinned to
  whoever was there at match-start. Root cause (confirmed):
  `getMatchTeamPlayers()` (team-manager.js:69-87) resolves a match's players
  via a live `PlayerUtils.getPlayerDisplayInfo()` lookup — correct and
  intentional, since that's what protects COMPLETED match history from ever
  being retroactively relabeled — but a PENDING (not-yet-played) queue
  entry's `teams[].playerIds` still holds the concrete old player id frozen
  in at queue-creation time, since nothing previously re-targeted
  already-queued-but-unplayed matches to a slot's new occupant after a swap.
  Fix: `user-management.js`'s `replacePlayerWithUser` now calls a new
  helper, `rewritePendingQueueReferences(gameState, oldPlayerId,
  newPlayerId)`, right after a successful `PlayerUtils.swapPlayerInSlot()` —
  it rewrites `gameQueue` entries' `teams[].playerIds` from old to new id,
  for every match whose status is NOT `'completed'` — pending, queued, AND
  ongoing all get rewritten (as of Task 10; the original Task 9 cut of this
  fix excluded `'ongoing'` too, pending that follow-up decision). Completed
  match history is the one exclusion that stays forever: it must never be
  retroactively reattributed. Task 10 also checked whether rewriting an
  ongoing match's `playerIds` mid-play could desync anything a
  currently-playing user's screen or the result-confirmation flow depends
  on — it can't: `result-manager.js`'s confirm-result path resolves
  `playerIds` live off the queue entry at confirmation time (not a
  match-start snapshot), `display-manager.js`'s live-match rendering does
  the same and its change-detection signature includes `playerIds` so it
  re-renders correctly, and turn state (`board-manager.js`'s `currentTurn`)
  is keyed by `teamId`, not `playerId`. This test drives the REAL
  `replacePlayerWithUser()` end-to-end (not a reimplementation): seeds a
  temporary synthetic team with one slot pre-linked to a freshly created
  disposable account, seeds 4 `gameQueue` entries referencing that slot's
  player id (`'pending'`, `'queued'`, `'ongoing'`, `'completed'`), then calls
  the real `loadUnassignedUsers()`/`selectUserForAssignment()`/
  `replacePlayerWithUser()` functions (auto-accepting the native `confirm()`
  dialog the swap path shows, same technique as `e2e-multitab-freeze.js`) to
  swap the slot to a second freshly created disposable account. Asserts both
  the positive case (pending, queued, AND ongoing entries all rewritten to
  the new id) and the negative case (the completed entry left untouched,
  still pointing at the old id) — the negative case is the scope boundary
  the whole fix's safety depends on. Uses two never-before-used disposable
  accounts created inline with timestamped names every run (see the
  burned-uid gotcha below — a fixed pair reused across runs would fail on
  the second run). Confirmed passing against live `e2e-disposable-1` with
  the Task 10 scope change (ongoing now a positive case). Snapshots/restores
  `teams`, `players`, `gameQueue` in a `finally` block — see the
  `players`-is-a-map-field gotcha below, found and fixed the hard way on
  this test's very first live run (two registry entries briefly leaked into
  `e2e-disposable-1` and were manually repaired before this file was
  committed).
- `e2e-navbar-primary-switch.js` — regression test for TODO.md Task 11
  ("navbar.js `buildNavUrl()` reads stale cached tournament/team"). Root
  cause: `buildNavUrl()` (`shared/scripts/navbar.js:105-132`) builds every
  nav link href purely from `sessionStorage`/`localStorage`'s cached
  `currentTournamentId`/`currentTeamId` and never re-reads Firestore;
  `getCurrentTournamentId()` (navbar.js:504-512) only falls back to the
  user doc's fresh `assignedTournamentId` when the cache is completely
  empty, so once cached, a value wins forever even after the real primary
  changes server-side. `home.html`'s `window.setPrimaryTournament` ("Set as
  primary" button, ~line 1395) already re-synced `currentTournamentId`/
  `currentTournamentName` after its Firestore write but never
  `currentTeamId` — so after switching primary tournaments the cached
  tournament id and team id silently pointed at two DIFFERENT tournaments
  (new tournament, OLD team), and the "My Team" nav link would send the
  user to `team.html?tournamentId=<NEW>&teamId=<OLD-numeric-id>`, which
  team-controls.js's own "Team not found in tournament" guard usually
  bounces straight back out to `index.html`. Fix: `setPrimaryTournament`
  now also writes `currentTeamId` to both storages
  (`full/home.html` ~1422-1423, guarded like sibling `enterTournament`).
  This test drives the real UI end-to-end
  with a disposable player account (`PLAYER14`, already linked into
  `e2e-disposable-1`'s Team Alpha, id 1) linked into a SECOND tournament
  too (created idempotently by the script itself: `e2e-navbar-secondary`,
  a minimal one-team tournament, team id 55 — deliberately a DIFFERENT
  numeric id than 1, so a stale-teamId bug is observable and not
  accidentally masked by both tournaments coincidentally using the same
  id). Clicks the real "Set as primary" button for the second tournament,
  **reloads the page** (this is what actually exercises `buildNavUrl()`
  against whatever ended up cached — the pre-switch navbar render still
  shows the old href regardless of any storage fix, since nothing
  re-renders the navbar in place after a same-page click), then clicks the
  real "My Team" nav link and asserts the resulting navigation's
  `tournamentId`/`teamId` query params match the NEW primary. Confirmed
  reproducing the bug against the pre-fix code (`teamId` stayed `1` after
  switching to the tournament where PLAYER14's real team id is `55`) before
  applying the fix. `e2e-navbar-secondary` is a lasting fixture (like
  `e2e-disposable-1`), not deleted after the run — safe for later tasks to
  reuse. PLAYER14's own user doc (the actual primary pointer:
  `assignedTournamentId`/`assignedTeamId`/etc) IS snapshotted/restored in a
  `finally` block, since other scripts (`e2e-ready-check.js`) depend on its
  baseline pointing at `e2e-disposable-1`/Team Alpha.
- `e2e-use-here-fill-slot.js` — **verification test, not a fix** (TODO.md
  Task 12: "`replacePlayerWithUser` doesn't fill target placeholder slot").
  TODO.md's original repro didn't reproduce against current code — there is
  no corresponding fix commit for this one, deliberately, so don't go
  looking for one. Root cause investigation: `replacePlayerWithUser`
  (`user-management.js:652-826`)'s placeholder-link path calls
  `PlayerUtils.linkUserToPlayerSlot(gameState, team.id, playerId, ...)`
  (`player-utils.js:297-318`), which resolves the target slot via
  `getPlayerById(gameState, playerId)` — an exact registry-key lookup keyed
  off the specific `playerId` argument passed in, not a team-wide or
  "first placeholder" fallback — and mutates only that one registry entry.
  The "Use {name} here" button's `onclick` (`renderTeamAssignmentSlots()`,
  `user-management.js:567`) bakes in that same specific `player.playerId`
  per row. Both were already correctly scoped by the time this task ran;
  most likely already fixed as a side effect of the `e1d9aea` "bulletproof
  player link/swap/remove" rewrite, which postdates TODO.md's original bug
  report. This test seeds a synthetic team with TWO placeholder slots (A
  and B — teams are capped at exactly 2 player slots per
  `renderTeamAssignmentSlots()`'s own comment) so both failure modes from
  the original report are independently observable: "fills the wrong slot"
  (asserts placeholder A stays untouched — still no `uid` — after the
  click) and "appends a new slot instead" (asserts the team still has
  exactly 2 `playerIds` afterward, not 3). Unlike every other script here
  that drives a target function directly via `page.evaluate`, this one
  **clicks the real DOM button** — found by matching the literal rendered
  `onclick="replacePlayerWithUser(<teamId>, '<playerId>')"` attribute for
  placeholder B's row specifically — to also rule out a rendering-level bug
  (the wrong `playerId` baked into the wrong row), not just a logic-level
  one; `replacePlayerWithUser()` is async and the bare `onclick` doesn't
  await it, so the test polls `gameState.players[phB].uid` via
  `page.waitForFunction` rather than assuming completion right after the
  click. Confirmed passing against live `e2e-disposable-1`. Drives god.html
  (same reasoning as `e2e-swap-pending-rewrite.js`: god.html and admin.html
  both render the identical `teamAssignmentSlots` panel via the shared,
  standalone `user-management.js` — not `admin-improved-adapter.js` — so
  god.html's `window.godApp.gameState`/`saveGameState()` convenience for
  seed/restore exercises the same button/handler admin.html's Teams tab
  uses). Snapshots/restores `teams`/`players` in a `finally` block,
  including the explicit `FieldValue.delete()` for leaked
  `players`-map keys (same pattern as `e2e-swap-pending-rewrite.js`, per
  the map-field gotcha below).
- `e2e-team-match-panel-merge.js` — verification test for TODO.md Task 13
  ("team.html: combine the 'next match' section with the Discord/Game Lobby
  ready-check info ... Merge into one clear panel"). team.html used to show
  TWO SEPARATE full-screen `.lobby-overlay` elements one after another:
  `#preGameInstructionsOverlay` (match cards + "waiting for admin" footer,
  shown during a slot's 'setup' sub-phase) and `#lobbyReadyOverlay` (Discord/
  Game Lobby ready buttons + teammate-confirm list + per-team readiness,
  shown once the slot enters 'lobby'). Merged into a single
  `#matchPanelOverlay` (team.html ~line 55): the match-assignment cards +
  header are always shown once a match exists, and `#lobbyReadyControls`
  (ready buttons/teammate-confirm list/ready status/lobby-creator banner) is
  revealed IN PLACE inside the same overlay once the lobby opens — no
  overlay swap, one panel that grows. `team-controls.js`'s
  `renderPhaseOverlays()`/new `renderMatchPanel(isLobbyPhase)` (replacing the
  old `renderPreGameInstructions()`/`renderLobbyReady()` pair) drive this.
  Also fixed a real, pre-existing bug found while consolidating the two
  match-card population functions into one: `renderMatchCardsWithDiscord()`'s
  "does this match involve my team" filter only checked the legacy/synthetic
  `side.players[]` shape, never the real `side.playerIds` shape every actual
  match-creation path produces (already reported, not fixed, by
  `e2e-ready-check.js`'s Part 2) — so the match-info card never rendered for
  any real match, in EITHER of the old overlays. Now reuses the same
  dual-shape resolution `_matchInvolvesUs()`/`getMatchSidePlayers()` already
  had. This test seeds a real-shaped queue entry (`teams[].playerIds`, real
  `discordChannels`/`lobbyCreators`) against `e2e-disposable-1`'s Team Alpha
  (real linked "TD (E2E)" + "E2ePlayer14") vs Team Beta (placeholders), logs
  in as E2ePlayer14, and asserts: the old overlay/container ids no longer
  exist in the DOM at all (confirms the merge, not just a rename); the match
  card shows real game/opponent/Discord/creator info (not the empty state);
  the waiting footer is visible and ready-controls hidden during 'setup';
  then flips slot 1 to 'lobby' and re-asserts the SAME `#matchPanelOverlay`
  element is still the one visible (still exactly 2 `.lobby-overlay`
  elements on the page total, counting `#spellPhaseOverlay`), the match card
  info persisted (grew in place, wasn't replaced), the footer is now hidden,
  and the ready buttons/teammate-confirm-for-"TD (E2E)"/lobby-creator banner
  are now visible. **Gotcha found while building this test**: god.html's
  live `window.godApp.phase` (PhaseManager) reactively auto-advances a slot
  from 'lobby' to 'playing' ~100ms after any write that leaves
  `getSlotRequirements()` fully met — which, given the still-unfixed
  `_getPlayersWhoMustReadyForSlot()` bug (empty mustReady for any real
  match), is true the instant a slot enters 'lobby'. Simply setting
  `currentPhase.slots[1] = 'lobby'` with the TD's god.html tab open (needed
  to call `saveGameState()`) is enough to trigger this and flip the slot to
  'playing' before Puppeteer can screenshot the lobby-open state. Worked
  around exactly like `e2e-ready-check.js` Part 2: add a synthetic `.sides`
  field (ignored by every real-match render path, which all prefer
  `match.teams` via `match.teams || match.sides`) purely to populate
  mustReady with real uids, keeping the slot genuinely stuck in 'lobby'
  since the test never clicks the ready buttons. Also documents (without
  fixing, logged as a console finding rather than a failing assertion) a
  third instance of the same field-shape bug family in
  `renderReadinessStatus()` (`side.players[]` only, no `side.playerIds`
  fallback) — the ready-status container is correctly wired into the merged
  panel, its own data-shape handling just isn't fixed. Confirmed passing
  against live `e2e-disposable-1`. Takes throwaway visual-review screenshots
  (`task13-panel-waiting.png`/`task13-panel-lobby-open.png`, not committed).
  Snapshots/restores `gameQueue`/`currentPhase`/`lobbyReady` in a `finally`
  block. **Updated (later)**: the panel was pulled out of the full-screen
  `.lobby-overlay` treatment entirely and made an inline sidebar section
  (renamed `#matchPanelSection`, a plain `.team-section` placed under
  Teammates, `display: ''`/`none` instead of `flex`/`none`) so players
  aren't blocked from the rest of team.html while readying up —
  `#spellPhaseOverlay` is now the only `.lobby-overlay` element left on the
  page, and this test's assertions were updated to match (1 overlay, not 2;
  "not 'none'" instead of "'flex'"). **Updated again (later, dedup)**:
  `#readyGameLobbyBtn`/`#readyDiscordBtn`/`#teammateConfirmList` were
  removed from the match panel entirely — `renderTeammates()` already
  rendered the identical Discord/Game Lobby toggle buttons per player in
  the Teammates sidebar (own row under `.teammate-item.you`, teammate rows
  under `.teammate-item:not(.you)`), so the match-panel copy was a straight
  duplicate. Both this test and `e2e-ready-check.js` now click the
  Teammates-sidebar buttons directly instead.
- `e2e-vote-toast-position.js` — regression test for TODO.md Task 14
  ("team.html: the vote-submitted notification/toast overlaps the team
  scores section"). Root cause: team.html's vote-submitted message is NOT
  the shared `shared/scripts/toast.js` component (that file isn't loaded by
  team.html at all — only statistics.html/onboarding.html/god.html/
  admin.html load it) — it's a page-local `showStatus()` function
  (`full/scripts/team-controls.js` ~2179) that toggles a single always-
  present `#statusMessage` element (`full/team.html` ~line 49). Its CSS,
  `.team-status-message` (`full/css/team-modern.css`, was ~227-233), was
  `position: fixed; top: 4.5rem` (72px) — directly on top of `#scoreStrip`
  (~84-140px from viewport top: 60px fixed navbar + `body.team-page`'s
  `padding-top: 4rem` + `.team-container`'s own 20px padding), since the
  score strip is always the first thing rendered on team.html regardless of
  match/phase state. Fix: `.team-status-message` now anchors to the BOTTOM
  of the viewport (`bottom: 24px`) instead, so it can never overlap
  anything living at the top of the page; the `slideIn` keyframe was
  flipped to slide up (from `translateY(8px)`) instead of down, to match.
  Confirmed page-scoped and safe: `team-status-message` as a selector
  appears nowhere else except an inapplicable `body.dark-mode
  .team-status-message` rule in `shared/css/dark-theme.css` (only
  replay.html loads that file, and team.html's body never has a
  `dark-mode` class) — no risk to god.html/admin.html's actual shared
  toast.js component. This test seeds a real 'ongoing' `gameQueue` match
  (`e2e-disposable-1`'s Team Alpha id 1, real-linked "TD (E2E)" +
  "E2ePlayer14", vs Team Beta's two placeholders — same roster
  `e2e-team-match-panel-merge.js` uses) with no `votes` yet, logs in as
  E2ePlayer14, clicks a vote option and Submit Vote (single vote out of 4
  match players = 25%, below the 90% consensus threshold, so `submitVote()`
  takes the plain "Vote submitted successfully!" path matching TODO.md's
  exact repro), and asserts via `getBoundingClientRect()` that the toast's
  box does not intersect the score-strip's box — confirmed this genuinely
  catches the regression by temporarily `git stash`-ing the CSS fix and
  re-running (toast top=64/bottom=108 vs score-strip top=80/bottom=136 —
  intersecting, assertion correctly failed) before restoring the fix and
  confirming green again. Also asserts non-intersection with the phase
  banner and navbar, as a self-review check that the fix didn't just
  relocate the overlap onto some OTHER top-of-page element (the navbar
  check first asserts its selector resolved at all, so a renamed/missing
  selector fails loudly instead of silently no-op'ing the check).
  **Follow-up found in code review of the first cut**: moving the toast to
  the bottom exposed a second, TODO.md-unmentioned overlap candidate —
  `shared/scripts/chat-module.js`'s `.chat-module-wrap`, a `position:
  fixed; right: 20px; bottom: 20px` 56px floating action button, mounted
  unconditionally for every verified team member
  (`team-controls.js:129-131`) — sitting in the same bottom-right corner.
  The toast's old `width: calc(100% - 40px)` (capped at `max-width: 520px`)
  nearly fills phone-width viewports, so its right edge could reach into
  the FAB's zone while visible (5s per vote). Fixed by changing `width` to
  `min(calc(100% - 40px), calc(100% - 192px), 520px)` plus `box-sizing:
  border-box` (the box also has padding/a border, and content-box sizing
  was quietly eating ~36px out of the intended clearance — first attempt
  without `border-box` left only a ~2px real gap from the FAB, caught by
  rerunning the test rather than trusting the formula) — guarantees a
  20px+ horizontal gap from the FAB on any viewport, which alone is enough
  to prevent intersection regardless of message height. The test now runs
  the full seed → vote → assert flow at TWO viewport sizes, each against
  its own freshly seeded (never-voted) match: desktop (1280×900,
  matchNumber 999501, matching this harness's usual size) and phone
  (390×844 — iPhone 12/13-class, matchNumber 999502 — the width that
  actually exercises the FAB fix; the pre-fix width would have put the
  toast's right edge well inside the FAB's zone at this size) — asserting
  the toast doesn't intersect the FAB too (same selector-resolved guard as
  the navbar check). Each viewport run creates/tears down its own player
  browser context in its own `finally`, so a thrown assertion still cleans
  up rather than leaking the context until the outer `browser.close()`.
  Confirmed passing against live `e2e-disposable-1` at both viewports.
  Takes throwaway visual-review screenshots
  (`task14-vote-toast-{desktop,phone}-{before,after}.png`, not committed).
  Snapshots/restores `gameQueue` (array field, plain reassign+save is
  sufficient) in a `finally` block.
- `e2e-pending-hex-persistence.js` — regression test for TODO.md Task 15
  ("during hex_placement_1/2 it's not clear which team has a pending hex
  placement; the old notification disappears on refresh"). Investigation
  found this was a real gate-bypass bug, not just cosmetic:
  `pendingHexWins` (admin.js's bare global) / `ResultManager._pendingHexWins`
  (god.html) is the SOLE gate for advancing past hex_placement_1/2
  (phase-manager.js's `_getPendingHexCount()`), and it was a plain in-memory
  array with zero Firestore persistence — a refresh mid-hex-placement reset
  it to `[]`, so the gate silently reported "all clear" regardless of true
  state. Fix: both are now backed by `gameState.pendingHexWins`, persisted
  via the normal `saveGameState()`/`this._save()` pattern — a `window`
  accessor pair in admin.js (so every existing bare `pendingHexWins`
  reference in admin.js AND admin-improved-adapter.js keeps working
  unchanged) and a `get`/`set _pendingHexWins` accessor pair on
  `ResultManager` (result-manager.js). The standing `#pendingHexBanner` is
  now re-rendered on every display update instead of only right after a
  hex-related action — god.html's `GodApp.updateDisplay()` calls it
  directly; admin-improved-adapter.js used to unconditionally REMOVE the
  banner on every Flow Panel render ("Flow Panel handles it now" — it
  didn't, outside hex_placement_1/2 there was no replacement indication at
  all), now it calls `updatePendingHexNotification()` instead, which itself
  only removes the banner once nothing is pending — making it visible across
  every phase, not just hex_placement_1/2. The data-destroying "dismiss"
  button/function (`dismissPendingHexBanner()`, which just did
  `_pendingHexWins = []`, wiping every team's pending record) was removed
  entirely on both pages — the banner can now only disappear via a real
  `clearPendingHexWin(teamId)` call, itself only reachable from a genuine
  `assignTeamToHex()` placement. Also found and fixed, live, while building
  this test: `ResultManager.updatePendingHexNotification()`'s banner-anchor
  selector (`.top-bar`) matches admin.html's markup but god.html (this
  class's only consumer) has no such element — the banner was being created
  but never appended to the DOM at all on god.html, unconditionally, even
  before this fix (confirmed by testing, not by reading — pending counts and
  the phase gate were always correct, nothing was ever visible); now falls
  back to `#phaseIndicatorBar` (god.html's equivalent top bar) with a final
  `document.body.prepend()` fallback. Drives BOTH pages: Part 1 (god.html) is
  thorough — confirms 2 real match results via `ResultManager
  .quickConfirmResult()` awarding hex wins to Team Alpha and Team Beta
  simultaneously (asserts the banner shows both), places Team Alpha's hex via
  `BoardManager.assignTeamToHex()` (asserts Team Alpha clears, Team Beta
  still shows — multi-team correctness), does a REAL `page.reload()` while
  Team Beta's hex is still pending (asserts the banner reappears AND
  `advancePhase()` still returns `false`/`currentPhase` stays
  `hex_placement_1` — the core regression check), moves `currentPhase` to
  `spell_window_1` with Team Beta still pending (asserts the banner stays
  visible outside hex_placement_1/2), places Team Beta's hex there (asserts
  it clears and the banner disappears), and confirms no dismiss path exists
  anywhere. Part 2 (admin.html) is lighter — the underlying persistence
  mechanism is structurally identical to Part 1's, already proven there — and
  focuses on what's unique to admin.html: the Flow Panel suppression fix
  (banner stays visible during `spell_window_1`, not just hex_placement_1/2)
  and refresh persistence through admin.js's own separate `pendingHexWins`
  accessor (admin.html never loads result-manager.js — confirmed by grep, so
  this is a genuinely separate implementation, not shared code). Confirmed
  passing against live `e2e-disposable-1`. Snapshots/restores `gameQueue`,
  `currentPhase`, `teams`, `gamesPlayed`, `gameHistory`, and `pendingHexWins`
  on both pages in `finally` blocks — `pendingHexWins` is now a real
  persisted array field, so (unlike before this fix) leaving it unrestored
  would leak synthetic pending-hex data into `e2e-disposable-1` permanently,
  not just for the page session. Test hexes are cleared via the real
  `assignTeamToHex(coord, null)` "Clear Hex" path (explicit
  `FieldValue.delete()`), same reasoning as `e2e-hex-placement-gate.js`.
  That older test's own snapshot/restore was also updated to include
  `pendingHexWins` now that it's persisted, for the same reason.
- `e2e-team-added-banner.js` — regression test for TODO.md Task 16
  ("home.html team-added banner missing tournament name + dismissable
  check"). Reading the current code (not TODO.md's paraphrase) found the "×"
  close button (`dismissNewAssignmentBanner()`, home.html) was already fully
  functional and already persisted its dismissal correctly — it calls
  `markAssignmentSeen()`, which writes `onboardingPromptSeenAt` to the
  user's Firestore doc, and `checkNewAssignment()`'s re-show guard
  (`isNew = !seenAt || new Date(seenAt) < new Date(userData.appointedAt)`)
  is naturally scoped per-appointment: dismissing only suppresses the
  appointment it was shown for, and a later genuine re-appointment (a fresh,
  newer `appointedAt`, same team or a different one) reopens it, corroborated
  by `docs/guides/TOURNAMENT_FLOW_BUG_TRACKER.md`'s pre-existing note this
  banner "correctly marks itself seen... so it won't nag again". The one real
  gap: the banner text only interpolated `assignedTeamName`, never which
  tournament the assignment was for — ambiguous for a player linked into more
  than one tournament. Fix: `checkNewAssignment()` (`full/home.html` ~984)
  is now `async` and fetches `tournaments/{assignedTournamentId}` for its
  `.name` before rendering, so the banner now reads "You've been added to
  {team} in {tournament}! ...". This test seeds PLAYER14's user doc with a
  fresh appointment into `e2e-navbar-secondary` (Task 11's lasting fixture —
  deliberately NOT `e2e-disposable-1`, whose tournament `.name` happens to
  equal its id, which would make a fallback-to-id bug pass undetected) and
  asserts: the banner text contains both the team name and the real
  tournament name; clicking the real "×" button hides it and persists
  `onboardingPromptSeenAt` to Firestore; the dismissal survives a real
  `page.reload()`; and — the self-review/over-matching check — bumping
  `appointedAt` forward again (simulating a later, genuinely new assignment)
  correctly REOPENS the banner rather than staying suppressed forever.
  Confirmed passing against live `e2e-disposable-1`/PLAYER14/
  `e2e-navbar-secondary`, deterministic across repeated runs. Snapshots/
  restores PLAYER14's whole user doc via a full (no-merge) `.set()` in a
  `finally` block, same pattern as `e2e-navbar-primary-switch.js` — confirmed
  the restore lands back on that script's same baseline assumption
  (`assignedTournamentId === 'e2e-disposable-1'`, team 1 "Team Alpha").
- `e2e-force-advance-parity.js` — regression/verification test for TODO.md
  Task 18 ("'⚠ Force' label rename + per-slot Force parity"). Found a THIRD
  "⚠ Force" label the original scoping missed: besides the global button in
  `admin-improved-adapter.js:1257` (JS-built copy, used by
  `_restoreFlowPanelDOM()`) and the per-slot button in `phase-manager.js:1513`
  (rendered into `#phaseIndicatorBar`, which only exists on god.html — so
  that button was previously reachable only there), `full/admin.html:120`
  has its own STATIC copy of the same global-button markup baked directly
  into the page's initial HTML — all three now read "⚠ Force Advance" (kept
  the emoji, matching the pre-existing Force Advance confirmation modal's own
  "⚠ Force Advance Phase" heading at `admin.html:600`). Also added the actual
  parity feature: `_renderMatchSlotCards()` (admin-improved-adapter.js
  ~line 644) now renders a per-slot "⚠ Force Advance" button on admin.html's
  match slot cards, wired to the already-existing (previously unwired)
  `window.forceAdvanceSlot(slot)` handler (admin-improved-adapter.js:1516),
  hidden once that slot is `done` — same convention phase-manager.js's own
  per-slot button already used. Part 1 (admin.html) seeds `matches_in_progress`
  with both slots in 'setup' and zero queued matches for either (so slot 1's
  sole requirement is unmet and the normal "Open Lobby ▶" button doesn't even
  render — only "⚡ Auto-Generate" does), confirms the new button is present/
  visible/labeled correctly, clicks it (real DOM click) and asserts slot 1
  force-advances past 'setup' despite the unmet requirement while slot 2
  (never clicked) stays untouched, and non-destructively verifies the
  EXISTING global Force button still opens/cancels its modal correctly
  without touching phase state, THEN (added after code review flagged that
  nothing in dev/tests/ actually exercised the global button's CONFIRM
  action) opens the modal a second time against a freshly-seeded
  `hex_placement_1` with a genuinely unmet requirement (a synthetic
  `pendingHexWins` entry — the same gate e2e-hex-placement-gate.js proves
  BLOCKS a normal, unforced `advancePhase()`) and clicks the real "Force
  Advance" confirm button (`confirmForceAdvance()` ->
  `_phaseManager.advancePhase(true)`), asserting `currentPhase` actually
  bypasses the gate and lands on `spell_window_1` (the real next phase) —
  closing the "per-slot force is tested, whole-phase force-bypass itself
  isn't" gap. Part 2 (god.html) repeats the seed/click/assert shape (per-slot
  only — god.html has no global Force button/modal to test, per the
  investigation above) against the pre-existing per-slot button in
  `#phaseIndicatorBar` to confirm the rename didn't break it. **Auto-advance
  gotcha found while building this test**: force-advancing a slot with zero
  queued matches from 'setup' to 'lobby' means `_getPlayersWhoMustReadyForSlot()`
  has nobody to wait for, so the slot's 'lobby' requirements report `met:
  true` immediately and `recheckRequirements()`'s existing 100ms lobby-auto-
  advance timer pushes it on to 'playing' right after — a second real
  Firestore write from the app's own reactive logic, not something the test
  triggers. The test tolerates either resulting state (`!== 'setup'`, not a
  specific value) and waits 2s of quiet time before restoring so that
  trailing write can't clobber the restore. **A second race found building
  the confirm-path scenario**: `confirmForceAdvance()` is async and awaits
  `advancePhase(true)` (which flips `gameState.currentPhase` synchronously,
  well before its own internal Firestore save resolves) BEFORE calling
  `closeForceAdvanceModal()` — polling on the phase change alone races the
  modal-close call, which only runs once the whole `advancePhase(true)`
  promise (save + logAction + re-render) has settled. Fixed by polling on
  the modal's `display` becoming `'none'` instead (the last thing
  `confirmForceAdvance()` does), which transitively guarantees the phase
  change already landed too. Also hit and fixed a render crash while seeding
  the synthetic `pendingHexWins` entry: `_renderActionItems()`
  (admin-improved-adapter.js ~line 1009) unconditionally reads
  `win.teamNames[idx]` for every relevant pending win with no fallback for a
  missing `teamNames` array — a synthetic entry needs both `teamIds` AND a
  same-length `teamNames` array or the very next display update throws and
  aborts admin.js's render pass (same failure shape as the
  `getGameDisplayName()` bug `e2e-ready-check.js` found). Confirmed passing
  (multiple runs, deterministic) against live `e2e-disposable-1`. Snapshots/
  restores `currentPhase`/`lobbyReady` on both pages, plus `pendingHexWins`
  on admin.html (Scenario B only), in `finally` blocks — plain reassign +
  `saveGameState()` is safe for all three here (unlike `board`/`players`)
  since the test only ever writes back the exact same key set each field
  already had, never adds a new key.
- `e2e-team-challenge-button.js` — verification test for TODO.md Task 19
  ("team.html: add a team-facing CHALLENGE button so teams can request a
  heart-hex dispute themselves during the 'challenges' phase, instead of
  only the TD being able to create one from admin.html's ⚔ button"). The
  TD-side ⚔ button (`admin.js`'s `addChallengeToQueue`/
  `updateChallengeHexPicker`/`confirmChallengeSetup`, ~admin.js:2182-2403) is
  a full manual match-setup modal — up to 2 teams per side, a hex picker,
  player-by-player roster assembly via `manualGameSetup.sides` — and is
  completely untouched by this task. Investigation while scoping this task
  also found `full/scripts/match-creation-manager.js` has its own
  `addChallengeToQueue`/`confirmChallengeSetup` (used by god.html via
  `god-app.js`'s `MatchCreationManager`), but god.html has **no**
  `challengeSetupModal` markup or "Challenge" button at all — that code path
  is currently unreachable from any real UI (admin.html is the only page
  with a working ⚔ button), also untouched. The new team-facing flow lives
  entirely in `full/team.html` (`#challengeSection` sidebar panel,
  `#challengeModal` confirm dialog) and `full/scripts/team-controls.js`
  (`renderChallengePanel`, `_getEligibleChallengeHexes`, `openChallengeModal`,
  `submitChallenge`, `_assignChallengeDiscordAndLobby` — the "CHALLENGE
  (self-service heart-hex dispute)" section near the bottom of the file),
  deliberately NOT a port of the TD's multi-team/multi-player picker: a team
  can only ever raise a dispute as itself against whichever other team
  currently controls a contested heart hex, with each side's FULL roster
  auto-included via `PlayerUtils.getTeamPlayerIds()` (same helper used for
  normal roster resolution elsewhere) instead of manual player picking.
  **Flagged assumption** (no written dispute-eligibility rule found anywhere
  in `docs/` or the hex-control code): a team may dispute ANY heart hex it
  doesn't currently control, no adjacency/standing requirement — this
  mirrors `updateChallengeHexPicker()`'s own lack of an adjacency check, but
  should be confirmed with the tournament rules owner. Also flagged: the
  created entry's `game` field defaults to `GAMES_CONFIG.getActiveGames()[0].id`
  (currently `'predecessor'`) since there's no "any"/"unspecified" game
  convention anywhere in `games-config.js` and a team has no game-type
  picker of its own — the TD can change it later via admin.html's Edit
  Match. `renderChallengePanel()` is gated on
  `gameData?.currentPhase?.name === 'challenges'`, the same pattern as every
  other phase-gated UI block in this file (`renderPhaseBanner`,
  `renderTeammates`, `renderPhaseOverlays`). With 0 eligible hexes the panel
  shows a disabled button + explanation; with exactly 1, `openChallengeModal()`
  skips the `<select>` picker and shows a direct confirm summary; with 2+, the
  picker appears. `submitChallenge()` runs as a Firestore transaction (same
  pattern as this file's pre-existing `submitVote()`) that re-reads
  `heartHexControl`/`currentPhase` fresh before writing, so a hex that gets
  resolved/placed (or a phase that moves on) between opening the modal and
  clicking Submit fails gracefully instead of creating a stale/invalid
  dispute; it also replicates `confirmChallengeSetup()`'s exact insertion
  position (after ongoing games + the first pending match) and its own
  team.html-local equivalent of `assignDiscordAndLobby()` (channel
  assignment + lobby-creator designation), since team.html doesn't load
  admin.js. This test drives the real UI end-to-end (real DOM clicks, not
  direct function calls) against `e2e-disposable-1`'s Team Alpha (id 1,
  real-linked "E2ePlayer14") vs Team Beta (id 2), using synthetic
  `heartHexControl` keys (`"e2e_test_hex_a"`/`"e2e_test_hex_b"`, not real
  `qXrY` board coordinates) so it can never collide with real board state.
  Part 1 seeds zero eligible hexes and asserts the button is disabled with
  an explanation. Part 2 seeds exactly one (owned by Team Beta), asserts the
  panel/modal skip the picker, clicks through to submit, and asserts the
  resulting `gameQueue` entry matches the TD-created shape field-for-field
  (`isChallenge: true`, `disputingSideA: [1]`, `disputingSideB: [2]`,
  `disputingTeamIds: [1,2]`, `teams: [{id:'TEAM_A', playerIds: <Team Alpha's
  full roster>}, {id:'TEAM_B', playerIds: <Team Beta's full roster>}]`,
  `challengeHexCoord`, `playType` derived from both roster sizes, real
  `discordChannels`) — roster ids are cross-checked against
  `PlayerUtils.getTeamPlayerIds()` computed independently on the TD side, not
  hardcoded. Part 3 seeds two eligible hexes (both owned by Team Beta),
  asserts the picker renders both options, explicitly selects the SECOND
  one, and asserts the created entry's `challengeHexCoord` is the selected
  hex (not just the first option) — proving the picker's selection actually
  drives submission. Confirmed passing against live `e2e-disposable-1`
  (verified via a one-off inline Firestore read after the test's own restore
  step: `heartHexControl: {}`, `currentPhase: null`, `gameQueue: []`,
  matching the tournament's known baseline). Snapshots/restores
  `heartHexControl`, `currentPhase`, `gameQueue` in a `finally` block —
  `heartHexControl` is a Firestore MAP field (same gotcha category as
  `board`/`players`: `merge:true` doesn't delete omitted map keys), so the
  restore explicitly `FieldValue.delete()`s the two synthetic hex keys in
  addition to the normal reassign-and-save.
- `e2e-tournament-param-unify.js` — regression test for TODO.md Task 20
  ("Unify `tournament` vs `tournamentId` query param naming across pages").
  Live investigation found the split was much bigger than the plan's
  original 3 files (admin.js/god-app.js/view.html): `navbar.js`'s
  `buildNavUrl()` special-cased `href === 'god.html'` to emit `?tournament=`
  while every other generated link got `?tournamentId=` — the actual live
  source of god.html links using the old name — plus `getUrlTournamentParamName()`/
  `getCurrentTournamentId()` (navbar.js) and 8 more pages
  (`team-controls.js`, `onboarding-status.html`, `match-queue.html`,
  `replay.html`, `view-onboarding-layout.html`, `view-onboarding.html`,
  `onboarding.js`, `statistics.js`) independently accepted
  `tournament`/`gameId`/`game` as silent aliases, plus three `home.html`
  button handlers (`manageTournament`, `enterTournament`,
  `manageTeams`'s numbered-list redirect) that generated `god.html?tournament=`
  links themselves — found via a repo-wide grep for `[?&](tournament|gameId|game)=`
  after fixing navbar.js, not in the original scoping. Fix: `tournamentId` is
  now the only accepted param everywhere; `resolve-tournament-id.js`'s
  `resolveTournamentId()` grew an optional `legacyParamNames` list — if
  present in the URL it's ignored for resolution (falls through to
  `cached`/null exactly as if absent, never a UI toast/banner) and logs a
  dev-facing `console.warn`. This test drives admin.html, god.html, and
  view.html against live `e2e-disposable-1`: confirms `?tournamentId=<id>`
  alone still resolves and loads the tournament (golden-path regression
  check) with zero legacy warnings, and confirms a legacy-only
  `?tournament=`/`?gameId=` (using an obviously-fake sentinel id,
  `e2e-legacy-value-should-be-ignored`, in the URL) never gets its value
  read as the tournament id — asserted by `!== sentinel` rather than
  `=== null`, since the TD test account has its own `assignedTournamentId`
  fallback (a separate, legitimate resolution path via navbar.js) that
  independently resolves to `e2e-disposable-1` even with URL/cache both
  empty, which would make a strict-null assertion flaky/misleading — plus
  the expected `console.warn`. **Gotcha found building this test**:
  view.html has no fallback like admin/god.html's cache, so the legacy-only
  case resolves to a falsy `tournamentId` and its own `DOMContentLoaded`
  handler immediately redirects to home.html, destroying the page's JS
  context before `tournamentId` can be read directly — worked around by
  treating the redirect itself as the proof (it only fires when
  `tournamentId` is falsy) and waiting for `location.pathname` to land on
  `/home.html` instead of reading the variable. Read-only against
  Firestore tournament data (only ever GETs the tournament doc/list via the
  pages' own normal load code) — nothing to snapshot/restore. Confirmed
  passing (7/7 scenarios) against live `e2e-disposable-1`.
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
- **`gameState.players` is a Firestore MAP field (`{ [playerId]: {...} }`),
  same category as `board` — NOT an array like `teams`/`gameQueue`/
  `gameHistory`, and the "`merge:true` doesn't delete omitted map keys"
  gotcha documented above for `board` applies to it too.** A test that adds
  entries to `gs.players` (e.g. a synthetic player linked to a temporary
  team), then "restores" by reassigning `gs.players` back to a pre-mutation
  snapshot and calling `saveGameState()`, does NOT actually remove the added
  entries — `saveGameState()`'s `set(data, {merge:true})` merges the
  `players` map key-by-key, leaving remote keys absent from the snapshot
  untouched. Found the hard way while building `e2e-swap-pending-rewrite.js`:
  its first live run left two registry entries (a retired synthetic player
  and the new id minted by the swap it was testing) sitting in
  `e2e-disposable-1` after the "restore" step reported success; required a
  manual `FieldValue.delete()` repair. Fix: compute which `gameState.players`
  keys exist after the test's mutations but were NOT in the original
  snapshot, and explicitly `firebase.firestore().collection('tournaments')
  .doc(tournamentId).update({ [\`players.\${key}\`]:
  firebase.firestore.FieldValue.delete() })` for each one, in addition to
  (not instead of) the normal snapshot/reassign/`saveGameState()` restore —
  same pattern `assignTeamToHex(coord, null)` uses for `board`, just without
  a ready-made helper function for `players`.
- **A tournament card's "Enter" button and its "Set as primary" button are
  BOTH plain non-disabled `<button>`s in the same card** (`full/home.html`'s
  `displayTournaments()`, ~line 1337-1338: `<button class="btn-enter">Enter
  </button>${starBtn}`) — `page.click('#tcard-<id> button:not([disabled])')`
  clicks "Enter" (document order), not "Set as primary", and for a player
  role with a team, "Enter" does a full-page navigation straight to
  `team.html`, silently blowing past whatever the test expected to happen
  next on `home.html`. Scope the selector to the button's `title` attribute
  (`button[title="Set as your primary tournament"]`) instead. Found while
  building `e2e-navbar-primary-switch.js`.
- **Puppeteer's default viewport (800×600) is below the unified navbar's
  mobile breakpoint** (`shared/css/navbar.css`), which collapses
  `.navbar-nav`'s links into an off-screen slide-out menu only reachable via
  the hamburger toggle — `page.click('.navbar-link[data-page="..."]')` then
  fails with "Node is either not clickable or not an Element" even though
  `waitForSelector` found it (it exists in the DOM, just not visible/in
  the viewport). Any test that clicks a navbar link needs
  `await page.setViewport({ width: 1280, height: 900 })` (or similar) right
  after creating the page. Found while building
  `e2e-navbar-primary-switch.js`.
