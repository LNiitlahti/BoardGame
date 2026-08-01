# Tournament Flow — Bug Tracker & Testing Log

Living document from the automated + manual testing pass on "Claude Automatic dev test 2026". Each item has enough detail (file:line, repro steps, root cause) to pick up and fix without re-investigating from scratch. Tick `[x]` as items get fixed/verified.

---

## 🔴 Confirmed bugs — not yet fixed

### 0. [FIXED] [MOST SEVERE] Auto-inserted break corrupts next round's match slots — can silently skip an entire round
**Fix applied:** `_autoInsertBreak()` (`phase-manager.js:700-728`) now explicitly sets `returnSlots: { 1: 'setup', 2: 'setup' }` when `returnToPhase === 'matches_in_progress'`, so `endBreak()`'s existing `if (returnTo === 'matches_in_progress' && returnSlots)` branch writes a clean fresh-round `slots` object instead of leaving the field unmentioned (which let Firestore's `{merge:true}` preserve the previous round's stale `done` slots).
**Files:** `phase-manager.js:700-728` (`_autoInsertBreak`), `phase-manager.js:656-690` (`endBreak`), `admin.js:4799` (`saveGameState`, uses `.set(data, {merge:true})`)
**Root cause:** `_autoInsertBreak()` — the path taken when a break is due right as the tournament advances into `matches_in_progress` (`phase-manager.js:376-379`, `_isBreakDue()`) — never captures `returnSlots`. Compare to the *manual* "Insert Break" path (`insertBreak()`, line 621-651), which correctly saves `returnSlots: {...previousPhase.slots}` for exactly this reason (see its own comment at line 635-637: *"a break taken mid-match... must resume exactly where it was, not reset both slots to setup"*) — the auto-insert path just doesn't do the equivalent. Then `endBreak()` only restores `slots` if `returnSlots` exists (line 677-679); when it doesn't, `slots` is simply never mentioned in the new `currentPhase` object. Because `saveGameState()` persists via Firestore's recursive merge (`{merge:true}`), an unmentioned nested field is **not cleared** — the *previous* round's stale `slots: {1:'done', 2:'done'}` silently survives into the freshly-entered round.
**Impact — verified live, reproducibly:** Round 2 completed normally (both slots `done`). Round 3 became break-due exactly at the `matches_in_progress` boundary (expected — break intervals are round-based, this is the *normal* case, not an edge case). After ending that break, Round 3's match cards showed **"MATCH 1 — DONE" / "MATCH 2 — DONE" / Both matches complete"** with the primary action ready to "Continue ▶" straight to Round Advance — despite zero Round 3 matches ever being created, started, or played. An admin trusting the guided flow here would skip the entire round's actual gameplay with no warning of any kind.
**Fix:** Either (a) make `_autoInsertBreak()` capture `returnSlots` the same way `insertBreak()` does, and additionally have it/`endBreak()` explicitly set `slots: {1:'setup', 2:'setup'}` when re-entering `matches_in_progress` fresh (i.e., when `returnSlots` reflects a *pre*-match state, not persist stale post-match state) — needs care to distinguish "break interrupted mid-match, resume where left off" (should preserve) from "break happened at the round boundary, before this round's matches existed" (should reset). The cleanest fix is likely: have `_autoInsertBreak()` explicitly write `slots: { 1: 'setup', 2: 'setup' }` into its `currentPhase`, since by construction it only fires exactly at the moment of entering a fresh `matches_in_progress` for a new round, before any slot state should exist yet.
**Priority:** highest-severity item on this whole tracker — silently drops real gameplay, not just a UX/safety-net gap.

### 1. [FIXED] "Out-of-Flow Match Start" warning fires on every normal match start
**Fix applied:** Replaced both `PLAYING_PHASES.includes(...)` call sites (the guard at line ~1570 and the post-start advancement loop at line ~1537) with `_phaseManager.isPlayingPhase(...)`, and removed the now-unused `PLAYING_PHASES` constant.
**File:** `full/scripts/admin-improved-adapter.js:1567-1572`
**Root cause:** The check `if (PLAYING_PHASES.includes(phase))` uses `PLAYING_PHASES = ['challenge_game']` (line 89) — it never includes `'matches_in_progress'`. The correct, slot-aware check already exists elsewhere in the same codebase: `phase-manager.js`'s `isPlayingPhase(phase)` (lines 264-269), which correctly checks each match slot's own sub-phase (`getSlotSubPhase(1) === 'playing' || getSlotSubPhase(2) === 'playing'`). This call site just doesn't use it.
**Impact:** Every single `startMatch()` call during the normal guided `matches_in_progress` phase shows a scary "Out-of-Flow Match Start — the Flow Panel may no longer match reality" confirmation dialog, even when everything is completely in-order. Reproduced consistently, 2/2 match starts in live testing.
**Fix:** Replace `PLAYING_PHASES.includes(phase)` at line 1570 with `_phaseManager.isPlayingPhase(phase)`.
**Repro:** Queue a match via Auto-Generate during `matches_in_progress`, open its lobby, force-ready, then call `startMatch(id)` (or click "▶ Start #N"). Dialog appears every time.

### 2. [FIXED] Duplicate match numbers on split-format (3v3+2v2) auto-generated matches
**Fix applied:** `confirmAutoMatch()` now computes `getNextMatchNumber()` once before the loop and assigns `baseMatchNumber + i` per entry, instead of re-calling `getNextMatchNumber()` (which reads the not-yet-updated `gameState.gameQueue`) inside the loop.
**File:** `full/scripts/admin.js:3524-3563` (`confirmAutoMatch()`)
**Root cause:** `getNextMatchNumber()` (admin.js:2364, computes `max(existing matchNumber) + 1` from local `gameState.gameQueue`) is called *inside* the `for` loop over `result.matches`, but the actual `gameState.gameQueue.push()` for all entries happens *after* the loop completes (line 3563). When a single generation produces more than one queue entry — which happens for the `3v3+2v2` split format — every entry in that batch reads the same stale "next number" and gets stamped identically.
**Impact:** Two genuinely different, simultaneous matches both display as "Match #4" (or whatever number). Confusing for admin, spectators, and anything cross-referencing by match number. Verified live: `id 1785614108067` (3v3) and `id 1785614108068` (2v2), both `matchNumber: 4`, both `isSimultaneous: true`.
**Fix:** Compute each entry's `matchNumber` incrementally within the loop — either push each `queueEntry` to `gameState.gameQueue` immediately after building it (before computing the next one's number), or compute all numbers up front as `baseNumber + i` before the loop starts.
**Repro:** Auto-Generate a match when the resulting format is `3v3+2v2` (happens when one team needs to be split across two simultaneous games to balance the round) — both resulting queue entries share a match number.

---

## 🔴 Other confirmed bugs — fixed this session

### 5a. [FIXED] Two admin devices adjusting the same team's points simultaneously silently drops one edit
**Fix applied:** `adjustTeamPoints()` now runs a Firestore `runTransaction()` that re-reads the current `teams` array from the server, applies the delta to just that team, and writes the array back within the transaction — so concurrent deltas correctly accumulate (Firestore retries the transaction on write conflict) instead of racing via two independent full-document `saveGameState()` calls. Local `gameState.teams` is updated from the transaction's result afterward so the UI stays in sync. `setTeamPoints` (absolute value) was left as-is per the original analysis — it's inherently last-write-wins by nature, not additive, so there's nothing to lose.
**File:** `admin.js:687-708` (`adjustTeamPoints`/`setTeamPoints`)
**Root cause:** Point adjustment is a non-atomic client-side read-modify-write — each device reads its own in-memory `gameState.teams[id].points`, adds its delta locally, then `saveGameState()`s the whole document with `{merge:true}`. No Firestore transaction is used, so there's no server-side conflict detection.
**Impact — verified live with two real, separately-authenticated browser sessions on the same tournament:** Device A applied `+5` to Team 1 (2→7, saved). Device B, using its own stale locally-cached value of 2, applied `+3` (2→5, saved *after* A). Final Firestore value: **5** — Device A's entire `+5` adjustment silently vanished, with no error, no warning, and Device A's own screen kept showing "7" (the value it thinks it saved) until its next data refresh quietly corrects it back to 5 with no explanation.
**Impact for the event:** directly relevant to your original "admin on laptop + phone simultaneously" scenario (checklist item A8) — if two people (or one person on two devices) both adjust points around the same time, one adjustment can vanish without either device indicating anything went wrong.
**Fix:** switch `adjustTeamPoints`'s delta path to a Firestore transaction (`runTransaction`) so concurrent deltas correctly accumulate instead of racing; `setTeamPoints` (absolute value) is inherently last-write-wins by nature and probably fine as-is since it's not additive.
**Priority:** medium — narrow window (near-simultaneous edits to the *same* team), but silent data loss with no error is exactly the kind of failure mode worth closing before relying on multi-device operation.

### 6. [FIXED] Generic "Player Onboarding" home-page link is broken for real assigned players
**Fix applied:** The Resources-section link now calls a new `window.goToOnboarding()` (`full/home.html`) that reads `appState.get('userProfile')` (already populated on page load) and builds `onboarding.html?tournamentId=...&player=...` exactly like the banner does, falling back to an `errorHandler.showInfo(...)` message when the player has no assignment yet instead of letting `onboarding.js` show its raw error.
**Files:** `home.html:870` (the link), `onboarding.js:39-59` (where it fails)
**Root cause:** Two separate entry points into onboarding exist on `home.html`:
- The **contextual banner** ("You've been added to Team X! Start onboarding to get set up," shown once per new assignment, `checkNewAssignment()` at line 978) correctly links to `onboarding.html?tournamentId=...&player=...` with the player's real IDs.
- The **always-visible Resources-section link** ("🧭 Player Onboarding," line 870) just calls `goToPage('onboarding.html')` — no query params at all, and doesn't look up the player's `assignedTournamentId`/`assignedPlayerId` first.

`onboarding.js:51-59` requires `tournamentId` (and `player`, for non-admin view) or immediately shows an error and stops.
**Impact — verified live** with a real assigned player account: clicking the persistent Resources link produces a bare, unhelpful page: *"Error — No tournament ID specified. Use ?tournamentId=xxx."* Any player who dismissed the one-time banner (or never saw it — e.g. logged in on a second device) and later goes looking for onboarding via the obvious, always-there link hits a dead end.
**Fix:** have the Resources-section link build the same URL the banner uses — read the current user's `assignedTournamentId`/`assignedPlayerId` (already fetched into `userData` on page load) and construct `onboarding.html?tournamentId=...&player=...`, falling back to a clear "you're not assigned to a tournament yet" message instead of the raw onboarding.js error if those fields are empty.
**Priority:** medium-high — it's the second-most-discoverable path into onboarding (after the one-time banner) and currently just doesn't work.

### 7. Steam/Discord/Xbox platform IDs don't carry forward when saved from the Settings page — only from onboarding.html itself
**Files:** `profile.html:1376-1401` (`saveOnboardingChanges`), `onboarding.js:234-244` (`saveProfilePlatformId`), `onboarding.js:191-205` (`loadProfilePlatformIds`)
**Root cause:** There are two different places a player can edit their Steam/Discord/Xbox IDs, and only one of them writes to the field that actually enables carry-forward:
- `onboarding.html`'s own platform-ID form calls `saveProfilePlatformId()`, which writes to **both** the tournament-scoped record (`tournaments/{tid}/onboarding/state`) **and** the cross-tournament `users/{uid}.platformIds` field. This is what `loadProfilePlatformIds()`/`carryForwardProfilePlatformIds()` reads on a *future* tournament to pre-fill for a returning player — a real, working, well-designed feature.
- `profile.html`'s "Settings" page has its own near-identical platform-ID form (`saveOnboardingChanges()`), but it **only** writes to the current tournament's onboarding record (`updates['players.{id}.platformIds.{platform}']`) — it never touches `users/{uid}.platformIds`.
**Impact:** a player who only ever manages their platform IDs through Settings (a very plausible habit — it's the generic "manage my account" page) will have their IDs correctly saved for *this* event, but the carry-forward-to-next-tournament feature silently never gets fed, because its only real data source is a different page.
**Fix:** make `profile.html`'s `saveOnboardingChanges()` also call the equivalent of `saveProfilePlatformId()` for each field (or factor it into one shared function both pages call), so wherever a player saves their platform IDs, it consistently reaches the cross-tournament profile.
**Priority:** low-medium — not data loss (current-event data is fine either way), just a missed convenience for returning players in a future season, and inconsistent behavior between two UI surfaces that look identical to a player.

### 5. [FIXED] Top-bar "ROUND N" stat can briefly disagree with the actual phase round
**Fix applied:** The round-sync block in `updateDisplay()` now calls `saveGameState()` immediately when it detects and corrects `gameState.currentRound !== phaseRound`, instead of relying on some unrelated future save to persist it.
**File:** `admin-improved-adapter.js:1349-1353`
**Root cause:** `gameState.currentRound` (the legacy top-level field driving the top stat bar's "ROUND" number) is only synced from `currentPhase.roundNumber` inside the render-time `updateDisplay()` path, and only in-memory (`gameState.currentRound = phaseRound`) — it's not explicitly persisted at that point. It rides along on whatever the *next* save happens to be.
**Impact — verified live via Force Advance:** immediately after advancing into Round 4, the big "CURRENT PHASE" panel correctly showed "VP SCORING — Round 4" while the top stat bar simultaneously showed "ROUND 3" — two round indicators disagreeing on the same screen. Low severity (self-heals on the next action that triggers a save) but a confusing, visible glitch right at every round boundary — exactly the moment an admin is most likely to be cross-checking round number against something else (a bracket sheet, a stream overlay, etc.).
**Fix:** have the round-sync in `updateDisplay()` trigger (or piggyback on) an explicit `saveGameState()` when it detects `gameState.currentRound !== phaseRound`, instead of waiting for an unrelated future save.
**Priority:** low — cosmetic/timing, not a data-integrity issue like items 0-2.

---

## 🟡 Scoped, not yet built

### 4. `admin.html` has no Undo/Redo at all — needs planning before implementation, bigger than originally scoped
**Verified there is no UI for it whatsoever:** grepped `admin.html` for "undo"/"redo" (case-insensitive) — zero matches. No button, no modal, nothing in the markup. This isn't a hidden/disabled feature, it plain doesn't exist on the page actually used to run a live event.
**`UndoManager` itself is real and works — just only on `god.html`:** `god-app.js:144-154` instantiates `new UndoManager(...)` with full dependencies, and `god.html` has a working ↩-per-entry UI in the activity log (`god.html:1054-1058`, gated by `undo.canUndo(entry)`) plus a confirm modal (`god.html:641-659`). `god.html` is off-limits once the tournament is live per earlier decision, so this doesn't help during the event.
**New finding (this session) — the fix is two layers, not one:** `UndoManager.canUndo()` requires the action-log entry to carry a `previousState` snapshot (`undo-manager.js:52`), written only when something calls `ActionLogger.logAction(...)`. On `admin.html`, that only happens for `phase_advanced`, `win_condition_changed`, `spells_active_changed` (all from `admin-improved-adapter.js`). The actual gameplay mutations — `confirmResult()` (admin.js:4145), `awardRoundPoints()`, `assignTeamToHex()`, `adjustTeamPoints()` — never call `logAction()`; they only call a *different* function, `logEvent()` (admin.js:4870), which writes to a separate public-display `eventLog` subcollection with no `previousState` and isn't read by `UndoManager` at all. So even after loading the script and wiring a button, there would be almost nothing undoable — the things item #4 exists for (bad match result, bad points award, bad hex assignment) still wouldn't have the state snapshot undo depends on.
**Scope for a real fix, once planned:**
1. Load `undo-manager.js` on `admin.html`, wire an Undo button/modal into the flow panel (mirrors god.html's integration).
2. Add `logAction(...)` calls with `previousState` snapshots to `confirmResult()`, `awardRoundPoints()`, `assignTeamToHex()`, and `adjustTeamPoints()` in `admin.js` — without this, step 1 alone is nearly useless.
**Recovery today is limited to:** manual point +/- per team, "Clear Hex," and `deleteLastTileCaptureEvent(hexCoord)` (admin.js:4881, reverses only the *most recent* capture on *one specific hex*). Everything else requires the admin to manually reconstruct state by hand.
**Priority:** highest-impact open item on this tracker — directly answers the original "safety net if admin misclicks live" concern — but needs a planning pass (brainstorming/writing-plans) before implementation given the two-layer scope above, not a straight pickup-and-fix.

### 3. Hex placement has no ownership/ordering enforcement, and the reminder isn't persisted
Full write-up and recommended approach: [`docs/superpowers/specs/2026-08-01-hex-placement-enforcement-design.md`](../superpowers/specs/2026-08-01-hex-placement-enforcement-design.md).
Short version: any team can be assigned to any hex via the team-picker regardless of who actually won the placement right (`admin.js:1561-1574`, `assignTeamToHex` at `admin.js:1580` has zero validation), and the "who still owes a placement" reminder list (`pendingHexWins`, `admin.js:46`) is a plain in-memory variable — never written to Firestore, so it's wiped by any page refresh and invisible across devices.

### 8. Cannot confirm which Firestore rules file is actually deployed — `firestore.rules` vs the permissive `firestore.rules.temp`
**Files:** `firestore.rules` (269 lines — the real, structured production rules: role tiers, privilege-escalation guards, per-collection checks) vs `firestore.rules.temp` (15 lines — `allow read, write: if request.auth != null;` on `/{document=**}`, i.e. any authenticated user can read/write *anything*).
**Why this matters:** every client-side role check verified elsewhere in this tracker (admin-only writes, God-only unarchive, privilege-escalation prevention on `users/{uid}`, the 2-player-per-team cap, etc.) only actually holds if `firestore.rules` — not `.rules.temp` — is the ruleset live on the Firebase project. If `.rules.temp` is deployed, every one of those protections is bypassable by any authenticated user going through devtools instead of the UI.
**Blocked from resolving locally:** no Firebase CLI is available in this environment (`firebase` not found) and there's no `.firebaserc` in the repo to inspect. Which ruleset is live can only be confirmed via `firebase deploy --only firestore:rules` history or the Firebase console → Firestore → Rules tab for project `boardgame-7b9f0`.
**Also relevant:** per saved memory, `firestore.rules.temp` is being *intentionally* kept in the repo as a reminder for final-step security rules work, not dead weight to delete — but per that same memory, "later" needs to land before the tournament goes live, not during it.
**Action needed (not something I can verify from here):** check the Firebase console/CLI to confirm `firestore.rules` is the deployed ruleset. This is the checklist's item B5, still unticked.
**Priority:** high — it's the precondition for every access-control claim already marked "verified" elsewhere in this document being true in production, not just in the client UI.

### 9. [FIXED] Stale header comment in `admin.html` calls the live admin page an "experimental fork" of itself
**File:** `full/admin.html:3-42`
**Root cause:** The file's top doc-comment still reads "ADMIN IMPROVED (full) — EXPERIMENTAL... Experimental fork of full/admin.html. The original stays untouched... USAGE: URL parameter: full/admin_improved.html?tournamentId=xxx" — self-referential and wrong. There is no separate `admin_improved.html` or a distinct "original" `admin.html` in the repo (confirmed: `full/admin*.html` matches only `admin.html`). At some point the experimental fork was promoted to be the one and only `admin.html` — the interface this entire tracker is about — and the header comment was never updated to say so.
**Impact:** low on its own (doesn't affect behavior), but actively misleading to read while working on "the page actually used to run a live event" — it suggests a safer separate original exists to fall back to, which it doesn't.
**Fix applied:** rewrote the header comment to describe `admin.html` as the live guided tournament-management page, removed the "experimental fork"/"original stays untouched" framing and the dead `admin_improved.html` URL reference, kept the LAYOUT/USAGE diagram since that part is still accurate.

---

## ✅ Verified working correctly (no action needed)

- **Registration flow** (fixed this session, see below) — clean end-to-end, including under simulated slow venue wifi.
- **Team assignment / linking a real account to a placeholder** (`god.html` Teams tab) — Firestore writes correct, real-time sync to player's own device and public `view.html` board confirmed with no manual refresh needed.
- **Duplicate-assignment guard** — attempting to link an already-assigned player to a second team silently no-ops (doesn't throw, but doesn't corrupt state either — verify by checking the roster, not by expecting an error).
- **Full match lifecycle**: Auto-Generate → balance-checked confirmation modal → Add to Queue → Open Lobby → Force Ready (auto-advances to Playing) → Start Match → Confirm Result → Mark Match Done. Walked through twice (Round 1 and Round 2), all state transitions and Firestore writes correct.
- **`gamesWon`/`gamesLost`/`gamesPlayed` tracking** and the rich `gameHistory` snapshot (players, teams, duration, split-team info) — all correct on every confirmed result.
- **VP scoring (`awardRoundPoints()`, admin.js:4573)** — correctly awards points based on controlled heart hexes (2 pts mountain-heart, 1 pt side-heart), via a two-step confirm ("Award Points" → preview modal → "Award & Continue"). Verified the full round-trip: captured 2 heart hexes, confirmed +1/+1 landed correctly and only after the second click, exactly as designed.
- **Action log / audit trail** — rich structured entries (actor, timestamp, full previous-state snapshot, sequence number) for every phase and slot transition. Good foundation for post-event dispute resolution.
- **Phase-driven guided flow** — walked two complete rounds (Setup → VP Scoring → Hex Scoring → Hex 1 → Spells → Hex 2 → Challenges → Board Check → Spells → Matches → Round Advance) with no phase-machine bugs found in the underlying `phase-manager.js` sequencing itself.
- **Begin Spells** — registers correctly (top-bar phase badge appears), no errors.
- **Challenge match flow** — created a real Team 1 vs Team 2 challenge over a contested heart hex (`addChallengeToQueue()` → `confirmChallengeSetup()`), started it, confirmed a result. Verified: challenge matches correctly do NOT affect `gamesWon`/`gamesLost` (matches the code's own intent). Note: resolving a challenge does NOT automatically transfer the contested hex to the winner — same manual-reassignment gap as regular hex placement (see item 3 above); worth knowing operationally even though it's not separately broken.
- **Archive / un-archive role enforcement** (client-side) — plain admin can archive a `finished` tournament; plain admin attempting to un-archive is correctly blocked (`confirmStateChange`, admin.js:486-490 — options hidden in the UI *and* a JS-level guard blocks the write attempt with "Only God users can unarchive tournaments"); god can un-archive cleanly. Verified all three cases live with real accounts. Note: this is client-side enforcement only — can't verify the matching server-side `firestore.rules` block (line 109-114) until the permissive temp rules are swapped out before the real event, per earlier discussion.
- **New-assignment onboarding banner** (`home.html:978-1012`, `checkNewAssignment()`) — correctly detects a genuinely new assignment (`appointedAt` newer than `onboardingPromptSeenAt`), shows a one-time banner with the right team name, links to `onboarding.html` with the correct `tournamentId`+`player` params, and correctly marks itself seen (via dismiss *or* clicking through) so it won't nag again. This is the right entry point — see bug #6 for the *other* onboarding link, which isn't.
- **Cross-tournament platform-ID carry-forward mechanism itself** (`onboarding.js:191-232`) — well-designed and correctly implemented *when fed*: only mirrors IDs for the authenticated owner of that player record (`isAuthedOwner`), only fills in fields the player hasn't already set for the current tournament, doesn't touch friend/game-test checklist data (intentionally per-tournament). The only issue is the second, disconnected write path — see bug #7.
- **Room hex toggle + default-rooms save/load** (`admin.js:1663-1722`) — toggling a hex as a room, saving it as the global default (`config/defaultRooms`), clearing local state, and reloading defaults all round-tripped correctly with no data loss.
- **Mass import — malformed data handling** (`admin.js:2392-2409`, `2463-2476`) — verified safe: JSON syntax errors are caught cleanly; a `matches` array containing bad entries (`null`, wrong-typed fields) throws inside `normalizeImportedMatch`, but that throw is caught by `handleImportFile`'s own try/catch, so nothing crashes and nothing gets committed to the queue (verified queue length unchanged before/after). One minor UX note: the resulting error always says *"Invalid JSON file: ..."* even when the JSON was syntactically valid and the real problem is a bad match entry inside it — mildly misleading if an admin is troubleshooting a bad match-scheduler export, but not a functional bug.
- **Point adjustment edge cases** (`adjustTeamPoints`/`setTeamPoints`, admin.js:687-708) — both correctly `Math.max(0, ...)`-clamp: large negative deltas, direct negative values, and invalid non-numeric input (`parseInt('not-a-number') || 0`) all land safely at 0, no crash, negative points impossible.
- **Force Advance** — works correctly as the panic-button escape hatch; opens a warning modal, and on confirm correctly advances the phase (including incrementing the round) even when normal requirements aren't met.
- **Manual "⏸ Break" insertion** (`insertBreak()`) — correctly captures and restores each match slot's exact sub-phase across the break (unlike the auto-inserted path, see bug #0).
- **Auto-break-when-due** (`_isBreakDue()`) — correctly triggers right at the configured round interval and correctly resets the interval counter on End Break (the match-slot corruption is a separate, already-documented issue — see bug #0).
- **god.html quick-create removed** — the dead-end "+ Create New Tournament" button (no teams, no way to add any) has been deleted from `god.html` and `god-app.js`; `setup.html` (the real wizard) is the only creation path now.

---

## Fixed & verified this session

- **Registration race condition** (`login.html`) — the post-login redirect could fire before the Firestore profile write + referral-code update finished, silently orphaning the player (Auth account exists, no Firestore doc, invisible to admin's assignment screen). Fixed by making the redirect explicit and only firing after all registration writes complete. Verified 4/4 clean runs, 2 under simulated slow wifi.
- **Slow-load form race** (`login.html`) — clicking submit before Firebase finished initializing could fall through to a native HTML form GET-submit, silently wiping the form. Fixed by disabling both submit buttons until `firebase-ready` fires.

---

## Still untested — candidates for the next pass

- [ ] Player-side spell casting UI (team.html) — only the admin-side "Begin Spells" trigger was tested here
- [ ] Two admin devices making *different* kinds of edits simultaneously (e.g., one confirming a match result while the other advances the phase) — only same-field point-adjustment races have been tested so far (see item 5a)

---

## Test tournament state note

`claude-automatic-dev-test-2026` is currently mid-Round-4 (status `playing`, briefly toggled through `finished`/`archived`/back to `playing` while testing role enforcement — fully intentional, see item "Archive / un-archive role enforcement" above). Its scoreboard is pure test noise from this whole session (manual double-awards, concurrent-write races, forced advances past a round with no real matches) — do not treat any current point value as a real match record. Safe to keep using for further testing, or reset via god.html's Duplicate/Delete if a clean slate is preferred.
