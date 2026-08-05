# Tournament Readiness Checklist (LAN in 1 week)

How to use: tick `[x]` on any item you agree is worth testing/fixing before the tournament. Leave unticked = "not critical this time." Add notes inline if you want changes. I'll turn ticked items into concrete test/fix tasks.

Legend: 🔴 = risk if broken, 🟡 = annoying but recoverable, ⚪ = nice-to-have

---

## PART A — Tournament flow (admin.html) — Risk #1

### A1. State machine (setup → playing → finished → archived)
- [x] 🔴 Create a new tournament from scratch, walk it through setup → playing without errors
- [ ] 🔴 Confirm `admin` role is correctly blocked from editing an `archived` tournament (rules + UI)
- [ ] 🔴 Confirm only `god` role can un-archive a tournament, and that it actually works when needed
- [x] 🟡 Accidentally clicking "archive" mid-tournament — is there a confirm step, can it be undone by god?
- [x] 🔴 Switching between multiple tournaments in the dropdown doesn't leak/mix state (teams, board, queue) from the previous one

### A2. Phase-driven flow (phase-manager.js) — this is the guided flow the admin will follow all night
- [x] 🔴 Walk one full round through every phase in order: pre_game_setup → scoring_vp → scoring_hex → hex_placement_1 → spell_window_1 → hex_placement_2 → challenges → spell_window_2 → challenge_game → spell_window_3 → board_resolved → spell_window_4 → matches_in_progress → round_advance → break
- [x] 🔴 "Next Phase" button — does it ever get stuck / not advance when requirements are met?
- [x] 🟡 "Force Advance" (skips requirement checks) — verify it doesn't corrupt state when used as an escape hatch (this is your panic button if something's stuck — make sure it actually works)
- [x] 🟡 Break insertion mid-flow (piss/food/sleep breaks) doesn't desync the phase after resuming
- [x] 🟡 Break interval settings / skip-next-break work as expected
- [ ] ⚪ Broadcast message to view screens shows up correctly on the TV/view display

### A3. Match queue & scoring — the core loop, happens dozens of times per night
- [x] 🔴 Manually add a match, assign teams/players to sides, start it, confirm result with correct winner + points
- [x] 🔴 Quick-confirm result flow doesn't misattribute points to the wrong team
- [ ] 🔴 Auto-generate suggested matches produces sane, non-duplicate matches
- [ ] 🟡 Mass import matches from JSON — validate a malformed/partial JSON doesn't corrupt the queue
- [x] 🔴 Edit an already-queued match (swap players/teams) before it starts
- [x] 🔴 Reorder queue (drag/drop, move-to-top) doesn't lose or duplicate matches
- [x] 🔴 "Clear queue" — confirm this is guarded (it's described as irreversible), and admin can't fat-finger it mid-tournament
- [x] 🔴 Challenge match creation for contested hexes — the full challenge → confirm → resolve loop

### A4. Board / hex control
- [x] 🔴 Assign team to hex via team-picker modal, confirm it reflects live on view.html/TV instantly
- [ ] 🟡 Toggle room hexes / default rooms save-load
- [x] 🟡 `deleteLastTileCaptureEvent` (undo a board event) actually removes the right event, not a random one

### A5. Undo / recovery — your safety net if admin misclicks live
- [ ] 🔴 Test the Undo Manager on at least: a wrong match result, a wrong point adjustment, a wrong hex assignment
- [ ] 🔴 Confirm undo doesn't cascade-break phase state (e.g. undoing a result during `round_advance` phase)
- [ ] 🟡 Action log / action export — can you actually find out "what happened" after the fact if a dispute comes up

### A6. Teams / players / points (manual overrides admin will reach for under pressure)
- [x] 🔴 Manual point adjustment (`adjustTeamPoints`/`setTeamPoints`) applies instantly and correctly to standings and adds log entry that can be audited later if needed
- [x] 🟡 Add/remove player from team respects the 2-player-per-team cap and doesn't silently fail
- [x] 🟡 Team name / color edit doesn't break existing match history or board state
- [x] ⚪ Seating order drag-and-drop / reset

### A7. Round advance (legacy, non-phase path — check if still used)
- [ ] 🟡 If this path is still reachable, confirm the "cannot go back" warning is accurate and admin understands it before clicking
- [x]  🔴 Round advance happens using the game flow manager. It should automatically asks for round advance when appropriate
- [ ] ⚪ Consider whether this legacy path should be hidden/disabled if the phase-driven flow fully replaces it, to remove a footgun

### A8. Cross-cutting / stress conditions
- [ ] 🔴 Two admin devices open simultaneously (e.g. laptop + phone) — do writes conflict or overwrite each other?
- [x] 🔴 Admin's browser refreshes/crashes mid-round — does reload restore the exact phase/queue state?
- [x] 🟡 Slow/flaky venue wifi — does the UI show an offline/pending-write state rather than silently failing?
- [x] 🔴 god.html (older parallel super-admin console) — decide: is it used this event or fully retired? If used, needs its own pass; if not, admins should be told not to touch it -> Confirmed that one user (GOD) will use this if needed, but once the tournament is ongoing it shouldnt be touched by anyone

---

## PART B — Player onboarding & team assignment — Risk #2

### B1. Registration (login.html) — now using real personal accounts + referral codes, not shared placeholder links
- [x] 🔴 Generate a referral code, confirm a brand-new player can register with it end-to-end
- [x] 🔴 Confirm a referral code can't be reused after `used: true` (someone else tries the same code/link)
- [x] 🔴 Confirm a player cannot self-grant `isGod`/`isAdmin`/`isSuperAdmin` via the client (rules-level check, not just UI)
- [x] 🟡 Password reset / forgot-password path exists and works, since these are now real personal accounts -> Was ticked prematurely the first time: no reset path existed at all. Implemented since: "Forgot password?" on login.html + a per-user "Reset Password" button in the admin console, both calling `sendPasswordResetEmail`. Wiring covered by `dev/tests/e2e-password-reset.js` (sending stubbed there). No Firebase Console setup needed — the reset email has no separate toggle, it's active whenever the Email/Password provider is on. Deliverability verified 2026-08-05 with two real sends: both landed in the Gmail INBOX (not spam) within a minute, auto-localized to Finnish. Sender was then moved off the default `noreply@boardgame-7b9f0.firebaseapp.com` onto a verified custom domain, `boardgame.niitlahti.fi` — a SUBDOMAIN deliberately, so the apex `niitlahti.fi` SPF protecting the euronic business mailbox is never touched. DNS (at domainkeskus, zone served by dnssec1/2/3.euronic.fi): one merged SPF `v=spf1 ip4:185.168.212.77 include:_spf.firebasemail.com ~all`, a `firebase=boardgame-7b9f0` ownership TXT, and two DKIM CNAMEs at `firebase1/2._domainkey.boardgame`.
  - Gotcha for future DNS work on this domain: the registrar panel is far over its per-type record quota (TXT was 65/20), so it silently refuses to CREATE new records — an edit that renames a record deletes it instead. Records had to be added from a separate zone-editor page. Never add a second `v=spf1` record to a name; merge into the existing one.
  - NOTE for anyone debugging this later: the project has email enumeration protection ON, so `sendPasswordResetEmail` resolves successfully even for addresses with no account, and login returns `auth/invalid-credential` rather than `auth/wrong-password`. The green "if an account exists…" message therefore proves nothing about delivery — only the inbox does.
  - CAUTION: do not use a reset link for the TD account (`lniitlahti+demoadmin@gmail.com`). Its password is `TD_PASSWORD` in `dev/tests/.env.e2e` and every e2e script logs in with it; resetting it breaks the suite until that file is updated.
- [x] 🟡 Registering with an email that's already in use gives a clear error, not a silent failure

### B2. Team assignment (admin-driven, user-management.js)
- [x] 🔴 Admin assigns a newly-registered user to a team, confirm `users/{uid}` and `tournaments/{tid}` both update correctly
- [x] 🔴 The 2-players-per-team cap is enforced when assigning via this path too
- [x] 🔴 "Replace placeholder with real user" flow (linking an account to an existing named slot) preserves history and doesn't create a duplicate player
- [x] 🟡 Un-assigning a player (setting assignedTeamId back to null) cleanly removes them from the team view everywhere
- [x] 🔴 Test the actual mixed scenario you'll have this event: some players pre-registered, admin assigning teams live as people arrive

### B3. Real-time sync — "does everyone actually see the update"
- [x] 🔴 After admin assigns a team, does the player's own device (team.html / index.html) update without a manual refresh?
- [x] 🔴 Board/view/TV screens reflect team assignments and scores live, tested from a second physical device, not just two browser tabs
- [ ] 🟡 Team chat / tournament chat messages appear on all devices promptly

### B4. Onboarding checklist (onboarding.html) — separate from account creation
- [x] 🟡 Player can fill in platform IDs / mark friends-added / mark games-tested and it persists
- [x] 🟡 Admin's 10-player summary grid view reflects live status
- [x] 🔴 Known gap: the onboarding status doc has no per-player write isolation — two players toggling status at once can overwrite each other. Decide if this matters for your event (low stakes) or needs a quick fix
- [ ] ⚪ Live status pings (eating/smoking/bathroom/etc.) work correctly, including rapid double-taps

### B5. Security check
- [ ] 🔴 Confirm which firestore rules file is actually deployed — `firestore.rules` vs the more-permissive `firestore.rules.temp` — before trusting any of the above rule-based protections. (Note: memory says `.rules.temp` is being intentionally kept for later — but "later" needs to not be "during the tournament.")

---

## PART C — No existing automated coverage (context, not action items)

For awareness: all current automated tests (`dev/tests/*.test.js`) only cover the cinematic/replay/music subsystem. Nothing above is automated — `docs/guides/TESTING_GUIDE.md` is the only existing manual checklist and it's a good starting skeleton but doesn't cover phase-manager, undo, or the new real-account onboarding flow. Everything ticked above will need either a manual dry-run session or a quick automated test, your call per item.

---

## Suggested next step once you've ticked boxes

Once you mark priorities, I'll propose: (1) a manual dry-run script for a full mock tournament (fastest way to catch real problems before the LAN), and (2) targeted automated tests for the highest-risk pure-logic pieces (e.g. team-assignment cap enforcement, referral code reuse, undo-manager correctness) that don't need a live Firestore to run.
