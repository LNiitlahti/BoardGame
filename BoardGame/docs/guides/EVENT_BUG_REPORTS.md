# Live Event Bug Reports

Bugs reported by admins/players during real tournament events (as opposed to `docs/guides/TOURNAMENT_FLOW_BUG_TRACKER.md`, which is a QA testing-pass log against a synthetic test tournament). Each entry starts as a raw report and gets filled in with investigation notes as someone picks it up. Tick `[x]` once fixed and verified.

---

## Sota Jatkuu 2026-2 (2026-08-05 – 2026-08-09)

### [ ] Discord bot does not work during challenge matches
**Reported:** Discord integration (channel creation/notifications) doesn't function for challenge matches — the flow where two teams contest a hex and play a decider match — even though it works for regular rotation matches.
**Relevant files:** `full/scripts/discord-commands.js`, `full/scripts/discord-panel.js`, `shared/scripts/discord-link-matcher.js`; challenge creation in `full/scripts/admin.js` `confirmChallengeSetup()` (~2414-2514) and `assignDiscordAndLobby()` (~2525); the pull request in `full/scripts/phase-manager.js:1688` (`openChallengeLobby`); channel resolution in `functions/lib/discord-move-planner.js` `planMoves()` (~line 54).
**Investigation so far:** Challenge creation itself isn't skipped — `confirmChallengeSetup()` builds the queue entry with `isChallenge: true` and `assignDiscordAndLobby()` does assign `discordChannels` per team, and `openChallengeLobby()` does fire a move-command request with `slot: 'challenge'`. The likely break is downstream: `planMoves()` resolves the destination channel via `config.slotChannels[String(slot)]`, but `DiscordPanel`'s setup UI (`discord-panel.js` ~121-199) only ever builds/persists `slotChannels['1']` and `slotChannels['2']` (the Match 1 / Match 2 side-A/side-B dropdowns) — there's no field or code path that ever writes `slotChannels['challenge']`. So a challenge pull likely resolves to an empty channel list and every player gets recorded `skipped` / `no_channel`. Not confirmed — `functions/test/discord-move-planner.test.js` doesn't cover `planMoves()` with a real challenge-slot config, so this gap is untested either way.
**Status:** Root cause suspected, not yet fixed or verified.

### [ ] "Rematch" spell breaks tournament state
**Reported:** Using the Rematch spell corrupts something in the running tournament ("breaks everything") — reporter didn't specify the exact symptom.
**Investigation so far:** No spell named "Rematch" (or a Finnish equivalent like "Uusinta") exists in the current spell data (`data/spells.json`, 15 spells total) or in the effect dispatcher (`full/scripts/spell-engine.js`, `switch(effect.type)` ~lines 496-524, which covers exactly those 15 effect types) — none of the current effects touch `gameHistory`, `gameQueue`, or `currentPhase` directly. Closest conceptual match is `all-according-plan` ("Kaikki on minun suunnitelmaani"), effect `copy_spell` (~line 505), which replays an opponent's already-used card — but that's a guess, not a match.
**Status:** Blocked — need to confirm with the reporter which card they mean (possibly a spell added/renamed after this data snapshot, or a card known by a different in-game name) and get a repro of what broke. Note: the current spell roster (`data/spells.json`) is still a work-in-progress placeholder set, not finalized — "Rematch" may simply not exist yet, or may get renamed/redesigned before it does, so this report may become moot rather than get root-caused.

### [ ] `team.html` doesn't clearly show upcoming vs. past matches
**Reported:** The team dashboard page doesn't present a team's scheduled/upcoming matches and completed/past matches clearly enough — players had trouble telling them apart or finding what's next.
**Relevant files:** `full/team.html`, `full/scripts/team-controls.js`.
**Investigation so far:** The "Your Next Match" panel (html ~89-92) *is* correctly team- and round-scoped, via `renderMatchCardsWithDiscord()` (team-controls.js:2009), which filters by `_matchInvolvesUs()` + `_belongsToCurrentRound()`. But the other two match-list sections aren't: "Current Match" / sidebar (html ~174-175, `renderCurrentMatch()` team-controls.js:1138) and "Upcoming Matches" (html ~183-184, `renderUpcomingMatches()` team-controls.js:1353) both read `gameData.gameQueue` filtered only by `status`/`currentTurn` — no team filter at all, so they can show every team's matches, not just this one's. "Recent Events" (html:191, `renderRecentEvents()` team-controls.js:1443) is the closest thing to a past-matches list (last 10 `gameData.gameHistory` entries, reversed) but is likewise tournament-wide and generically labeled rather than "Past Matches." That mismatch — one genuinely team-scoped card plus two tournament-wide lists sharing the page — plausibly explains the "not clear enough" complaint.
**Status:** Root cause identified (missing team-scoping on two of three match-list sections), not yet fixed.

### [ ] Match queue / game-flow management doesn't feel natural to run
**Reported:** General UX friction on the admin side — queueing matches and progressing the tournament through its phases isn't intuitive. Not a single discrete bug, more a broad "this is harder to operate than it should be" complaint.
**Relevant files:** `full/scripts/match-queue-manager.js`, `full/scripts/match-creation-manager.js`, `full/scripts/phase-manager.js`, and the guided flow panel in `admin.js`/`admin.html` — the pieces that drive queueing matches and advancing phases.
**Status:** Not yet investigated. Too vague to scope into a concrete fix as-is — needs follow-up with whoever reported it on which specific screen/step felt unnatural (queueing a match? reading the flow panel's next-step prompt? phase advancement? something else) before this can turn into actionable items.

### [ ] Challenge matches can't run concurrently, and can only be logged against one contested hex
**Reported:** When multiple challenges need to be played at the same time (e.g. a 2v2 and a 3v3 challenge happening together), the system only allows one challenge match at a time. Separately, a single challenge dispute can actually be about more than one contested hex — up to all 7 heart hexes (6 side hearts + the mountain heart) — but there's no way to log more than one hex per challenge when it happens.
**Confirmed in code (both are by-design limitations, not incidental bugs):**
- **Concurrency:** `challenge_game` is an intentional "flat phase" with only one challenge in flight at a time — see the explicit design comment at `full/scripts/phase-manager.js:1621-1633` ("only one challenge is ever in flight at a time"). Unlike `matches_in_progress`, which has two independent slots (1 and 2) for concurrent matches, there's no equivalent slot concept for challenges.
- **Single-hex limitation:** challenge creation reads exactly one value from a single `<select id="challengeHexSelect">` (`full/scripts/admin.js:2462`) and stores it as one `challengeHexCoord` string (or `null`) on the queue entry (`admin.js:2473`, carried through to `gameHistory` at `admin.js:4681`) — there's no field or code path that supports associating a challenge with more than one hex.
**Decision (2026-08-09):** Concurrent challenges are wanted — at least 2 challenges running at once, in any format combination (e.g. 2v2 + 3v3, or 2v2 + 2v2), mirroring the existing `matches_in_progress` two-slot model.
**Clarification on multi-hex (2026-08-09):** The multi-hex case is broader than one team disputing several hexes from a single opponent — separate, unrelated disputes (different challenger, different defender, different hex) can be bundled into and resolved by a *single* challenge game, if the admin decides to combine them and the affected teams accept. Example: Team1 challenges a side-heart Team2 holds, Team2 separately challenges the mountain-heart Team3 holds, and Team5 separately challenges two side-hearts Team1 holds — all three disputes settled by the outcome of one game, admin's call, contingent on player acceptance.
**Resolution mechanic worked out (2026-08-09):** The open question above is answered. Treat the bundled disputes as a graph (edge = "challenger disputes defender's hex"); split the disputing teams into two sides such that every disputing pair lands on opposite sides — a bipartition of that graph. For the 3-dispute example (Team5→Team1, Team1→Team2, Team2→Team3), the bipartition is **{Team1, Team3} vs {Team2, Team5}**, and every one of the three disputes checks out as opposite-sides under that split. Whichever side wins the single game: every dispute whose *challenger* was on the winning side succeeds (challenger takes the hex), every dispute whose *defender* was on the winning side fails (defender keeps the hex) — one consistent outcome for every bundled hex, decided by one game.
Rosters get filled out to the match's format (e.g. 5v5) using players from teams *not* party to any bundled dispute, split one per side — this is the same "split team" (hajotettu) mechanic the normal 10-match rotation already uses (2 full teams + 1 split team providing one player per side, see `shared/scripts/match-suggester.js`), just reused here with an uninvolved team instead of a rotation-scheduled one.
**Constraint:** this only works when the bundled disputes don't form an odd cycle (e.g. Team1 challenges Team2, Team2 challenges Team3, Team3 challenges Team1 — a 3-way loop has no valid 2-way split). Needs either a validation check when the admin tries to bundle disputes, or a documented rule that odd-cycle disputes must be played as separate games.
**Status:** Concurrency — decided, not yet implemented (needs `challenge_game` extended from its current flat/single-challenge design to a 2-slot model like `matches_in_progress`). Multi-hex bundling — resolution mechanic and roster-fill approach both worked out above; still needs UI for the admin to build a bundle, the bipartite/odd-cycle validation, and the actual hex-transfer logic tied to a bundled game's result.

### [ ] Admin needs a visual way to pick the contested hex — coordinate names alone aren't enough
**Reported:** When selecting a contested hex for a challenge, the admin has to identify it by its raw coordinate name (e.g. `q2r-4`) rather than clicking it directly on the board. Coordinates aren't visible on the board by default — only after disabling visual overlays, and that's hard to do/find.
**Confirmed in code:**
- The challenge-hex picker (`updateChallengeHexPicker()`, `full/scripts/admin.js:2345`) is a plain text `<select>` listing `"{Heart type} ({coord}) — {team}"` (e.g. "Side Heart (q2r-4) — Tiimi 2") — not a clickable board, so the admin has to mentally map a coordinate string back onto the physical board.
- Every hex's `qXrY` label *is* rendered by default in the underlying renderer (`shared/scripts/board-renderer.js:298-316`). But `admin.js:292` initializes the admin board with `showHeartImages: true`, and admin.html's "Visual Effects" panel (`admin.html:240-244`: Map / Glow / Pulse / Rooms / Hearts) has all five toggles **on by default**. The renderer explicitly layers heart-image artwork "above hexes and effects" (`board-renderer.js:148`) — for heart hexes specifically, the only hexes challenges ever care about, that artwork most likely covers the coordinate label underneath. This matches the report exactly: coordinates only become visible once the admin finds and disables the right effect toggle(s).
**Suggested direction:** Add a click-to-pick mode directly on the rendered board instead of (or in addition to) the text dropdown — every hex is already tagged `data-coord` (`board-renderer.js:288`), so wiring "click a hex to select it as the contested hex" is plausible without needing to touch coordinate visibility at all.
**Status:** Not yet implemented.

### [ ] Mobile/tablet support is limited — an iPad-friendly admin build worth scoping (even as a test-only build)
**Reported:** Mobile support is currently limited. Running admin from just a touchpad/touchscreen (e.g. an iPad) could work really well in a real event environment — suggested as a scope item, even just as a test/experimental build.
**Confirmed in code:**
- A responsive viewport meta tag is present and identical across `admin.html`, `god.html`, and `team.html` — not the gap.
- `admin.html`'s CSS has only one breakpoint that does anything structural: `admin.css:2957` `@media (max-width: 900px)` collapses the 3-column layout to one column. An iPad in landscape (~1024–1194px logical width) falls *between* that and the next breakpoint up (`admin.css:2948`, 1200px), so it lands on the squeezed desktop layout, not a touch-adapted one.
- The bigger blocker isn't layout, it's interaction: `admin.js` uses **native HTML5 drag-and-drop** throughout, with no touch/pointer fallback and no DnD library — seating order (`admin.js:1322-1370`), team/player assignment (`admin.js:748-764`), match-side drop zones (`admin.js:1950-2074`), and match-queue reordering (`admin.js:3957-4116`). Native HTML5 DnD does not fire at all on iOS/iPadOS Safari, so all four of those would be completely unusable on an iPad as it exists today — not just awkward, non-functional.
- By contrast, `team.html` (player-facing) already has real mobile breakpoints (`team-modern.css`, 768px and others) and no drag-and-drop dependency — so this gap is specifically **admin tooling**, not the project as a whole.
**Scope note:** Requested as at minimum a test-only iPad-friendly build. Since the actual blocker is the drag-and-drop dependency rather than layout, the real scope is bigger than responsive CSS tweaks — it needs touch-compatible replacements for those four interactions (e.g. tap-to-select + tap-to-place, or swapping to a pointer-events-based DnD library) before an iPad build would be usable, not just prettier.
**Status:** Not yet implemented. Scoping only for now.

### [ ] Referral code management is harder than it should be for god — no bulk generation or pre-labeling
**Reported:** Managing referral codes as god is harder than it should be. Creating and tracking multiple codes at tournament start is challenging — generating one code at a time and sending each to a new player individually takes too much time.
**Confirmed in code:**
- `generateReferralCode()` (`full/home.html:1639`) creates exactly one code per click — there's no bulk-generate option anywhere in the file.
- Every code is written with `assignedTo: null, assignedEmail: null, assignedAt: null` (`home.html:1661-1663`) — the schema already has fields for pre-labeling a code with its intended recipient, but `generateReferralCode()` never populates them and there's no UI to set them at creation time. Those fields only get filled in *after the fact*, once a player actually registers with the code (`viewReferralCodes()` reads `assignedName`/`assignedEmail` back at `home.html:1699-1700`, written by the registration flow, not by god).
- Sharing is also one-at-a-time: `copyReferralUrl(code)` (`home.html:1815`) copies a single code's URL per click, with no multi-select or "copy all unused" action in the codes modal.
- Net effect: onboarding N players at tournament start means clicking Generate N separate times, then separately copying and sending each URL — with no way to label which code was meant for which player, so tracking who got which code is entirely on the admin (memory, a chat log, a spreadsheet), not something the tool tracks at all.
**Suggested direction:** A "generate N codes" bulk action, plus letting the existing `assignedTo`/`assignedEmail` fields be filled in *at generation time* (e.g. paste a list of intended player names/emails, get one labeled code per name back) so codes are self-tracking instead of relying on the admin's memory.
**Status:** Not yet implemented.

### [x] Referral code URLs included an incorrect `/BoardGame/` path segment
**Reported:** At the event, referral URLs copied from god's code-generation UI didn't work as-is — had to manually edit the URL to remove `/BoardGame` before it would load.
**Confirmed in code:** `copyReferralUrl()` (`full/home.html:1820`, plus its clipboard-failure fallback at `home.html:1845`) hardcoded `` `${protocol}//${host}/BoardGame/login.html?referralCode=${code}` ``, but the site is served from the domain root — no other URL construction anywhere else in `full/` includes a `/BoardGame` segment.
**Fix:** Dropped the hardcoded `/BoardGame` segment from both URL templates; referral links now point to `${protocol}//${host}/login.html?referralCode=${code}`.
**Status:** Fixed, not yet verified live.

### [ ] Discord bot should confirm its actions by posting a status message to a channel
**Reported:** It would help if the Discord bot posted a message to a specific channel confirming what it did (e.g. that it moved players) — that channel should be configurable from the Discord section in `god.html`.
**Confirmed in code:**
- The Discord tab in `god.html` (Tab 9, `full/god.html:504-517`, backed by `full/scripts/discord-panel.js`) currently only configures per-slot *voice* channels for moving players — there's no "status/log channel" concept anywhere in it.
- Its "Activity" section (`discordActivity`, `discord-panel.js:567-593`) only renders a web-page log built from Firestore data — that's a UI element, not something the bot itself posts into Discord.
- The bot's Discord REST wrapper (`functions/lib/discord-rest.js:165`) only exposes `moveMember`, `listGuildMembers`, `listGuildChannels` — there's currently no capability at all to send a text message to a channel. This would be genuinely new functionality, not a disconnected existing feature.
**Suggested direction:** Add a `sendMessage({ channelId, content })` method to `discord-rest.js` (Discord's `POST /channels/{channel.id}/messages`), a configurable "status channel" field alongside the existing per-slot channel config in the Discord tab, and a call to it after each move-command batch completes (success/partial/failure). Bonus: this would also make the earlier "Discord doesn't work in challenges" bug (above) immediately visible *in Discord itself* instead of only in the web UI's activity log.
**Status:** Not yet implemented — new capability, not a wiring fix.

---

## Template for future events

```
### [ ] Short title
**Reported:** What the reporter said, generalized.
**Where to look:** File paths / functions likely involved.
**Status:** Not yet investigated / investigating / root-caused / fixed.
```
