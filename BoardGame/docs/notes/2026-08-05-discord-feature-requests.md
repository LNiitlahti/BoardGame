---
title: Discord feature requests — status review
date: 2026-08-05
source: Discord thread (Wustra, Touch, Inffi, Ruska)
status: awaiting developer comments
tags: [feature-requests, triage, view-html, discord, lan]
---

# Discord Feature Requests — Status Review

Nine features requested in the Discord thread, each checked against the codebase on
2026-08-05. Every item has an empty **💬 Developer notes** block — write your comment
there, one per item. Nothing else in this file needs editing.

Legend: ✅ done · 🟡 partial · ⬜ not started

**Quick index**

| # | Feature | Status |
|---|---|---|
| [[#1. Bigger name display for ongoing/starting matches]] | Bigger names on the live screen | 🟡 |
| [[#2. Live chat / comment field]] | Chat/comment box on the live view | 🟡 |
| [[#3. Improved spotlight flow for the live/info screen]] | Match spotlight / expand to fill screen | 🟡 |
| [[#4. Discord bot for live comments]] | Discord channel → live comment feed | ⬜ |
| [[#5. Automated player routing to Discord voice channels]] | Auto-move players to match channels | ✅ |
| [[#6. Per-player alcohol/drink counter]] | Tap-to-log drink counter | ⬜ |
| [[#7. "Most drinks" leaderboard]] | Fun stat from the drink counter | ⬜ |
| [[#8. Breathalyzer → victory point multiplier]] | Promille as a VP multiplier | ⬜ |

---

## 1. Bigger name display for ongoing/starting matches

> [!quote] Requested by Wustra
> On-screen name lists are hard to read from across the room, especially for older
> eyes. Wants larger text for match participant names.

> [!warning] Status: 🟡 Not done — and it regressed
> The old `live_matches_large` slide renders player names at **44px**
> (`BoardGame/full/view.html:1828`), but that slide is now only used for
> `challenge_game`. Regular matches go through the newer dual-slot slide, where names
> are **24px** (`.dm-dual-ready-name`, `BoardGame/full/view.html:1676`) on a 1920×1080
> room display. That is what Wustra is squinting at.

**Where it lives**
- `BoardGame/full/view.html:1676` — `.dm-dual-ready-name`, 24px (the live path)
- `BoardGame/full/view.html:1828` — `.dm-live-match-large .dm-player-name`, 44px (the challenge-only path)
- `BoardGame/full/scripts/display-manager.js:1456` — `_renderMatchGroup()`, emits the rows

**Effort:** small. This is a CSS block, not new logic. Overlaps heavily with item 3 —
if the panels are being re-laid-out anyway, do both in one pass.

### 💬 Developer notes

<!-- Lets fix this, it should be pretty simple. Do changes, confirm on big screen. Iterate if necessary -->

---

## 2. Live chat / comment field

> [!quote] Requested by Touch
> Asked about adding a chat or comment box to the live view.

> [!info] Status: 🟡 Module exists, `view.html` isn't wired to it
> `BoardGame/shared/scripts/chat-module.js` is a complete 367-line floating chat with
> tournament + team rooms. It is mounted on `admin.html`, `god.html`, `home.html` and
> `team.html` — and its own header comment lists `view.html` as an intended host — but
> `view.html` has no `<script>` tag for it.

> [!caution] Design question, not just wiring
> `ChatModule` is a **participant** UI: a floating action button that opens a panel you
> type into. The live/info screen is a passive spectator display with no keyboard.
> What Touch is describing is closer to a **read-only comment feed** rendering the same
> Firestore collection, not the existing chat widget dropped in as-is. This also
> overlaps with item 4 — a Discord relay would feed the same surface.

**Where it lives**
- `BoardGame/shared/scripts/chat-module.js` — the module (mount API documented in its header)
- `BoardGame/full/admin.html:797`, `god.html:824`, `home.html:29`, `team.html:262` — existing mounts
- `BoardGame/full/view.html` — no mount

**Effort:** small if it's literally the existing widget; medium if it's a new
spectator-feed render. **Needs a decision before it can be scoped.**

### 💬 Developer notes

<!-- Pretty simple fix, the chat module has tournament chat feature already implemented - we would only need those chat messages to show up on the big screen if someone sends a message. I would say the message should only be shown for lets say 5-10 seconds and fade away or move off screen. These messages should clearly indicate the playername who sent it, also their team colour. It would be fun visual thing on top of the big screen :) -->

---

## 3. Improved spotlight flow for the live/info screen

> [!quote] Requested by Inffi — marked accepted ("otetaan työstettäväksi")
> When a match (or two, e.g. 3v3 + 2v2) is queued up to be played live, it should
> expand to take up as much of the screen as possible. During lobby/setup the board
> and team scores don't need to be shown — focus should shift to match info instead.

> [!success] Status: 🟡 The hard half already exists
> `matches_in_progress` uses a dedicated `matches_dual_slot` slide with
> `hidePanels: true` (`display-manager.js:64-71`), so the board, queue and score panels
> **are already hidden** and both match slots show side by side through setup → lobby →
> live, with per-player ready dots. That is exactly the "hide the board, focus on match
> info" half of the request.

> [!todo] What's actually missing
> It never **expands**. The two slot panels are a fixed 50/50 flex pair capped at 900px
> each (`view.html:1643`), so a single active match wastes half the screen. A 3v3+2v2
> pair just stacks two match groups inside one panel rather than getting a layout of its
> own. Combined with item 1's 24px names, the screen reads as small and cramped even
> though the phase logic is right.

**Where it lives**
- `BoardGame/full/scripts/display-manager.js:64-71` — `DISPLAY_MODES.matches_in_progress`
- `BoardGame/full/scripts/display-manager.js:1535` — `_renderMatchesDualSlot()`
- `BoardGame/full/scripts/display-manager.js:1456` — `_renderMatchGroup()` (one match's rows)
- `BoardGame/full/view.html:1643` — `.dm-dual-slot-panel` layout
- `BoardGame/dev/view-preview.html` — harness for visually QAing every display state

**Effort:** medium. Layout work, no new data. Bundle with item 1.

### 💬 Developer notes

<!--Lets fix it, should not be to hard -->

---

## 4. Discord bot for live comments

> [!quote] Requested by Inffi/Touch — marked accepted for planning
> A bot that listens to a specific Discord channel and pipes messages into the live
> comment feed. Related to item 2.

> [!failure] Status: ⬜ Not started, and architecturally new
> The existing Cloud Function handles exactly four command types — `refresh-members`,
> `refresh-channels`, `pull`, `return` (`functions/lib/command-handler.js`) — and is
> `onDocumentCreated`-triggered **outbound REST only**. It talks *to* Discord when the
> tournament writes a command doc.
>
> Reading messages *from* a channel is the opposite direction and needs either a
> persistent gateway (WebSocket) connection or a Discord webhook/interaction endpoint.
> Neither fits the current fire-and-forget function shape. This is not an extension of
> the voice-move backend; it's a second integration.

**Where it lives (for context, not reuse)**
- `functions/index.js` — the single `onDiscordCommand` trigger
- `functions/lib/command-handler.js` — the four supported command types
- `functions/lib/discord-rest.js` — outbound REST client

**Depends on:** item 2 (there has to be a feed to pipe into).

**Effort:** large. Needs a hosting decision (gateway connection ≠ Cloud Functions'
request/response model), plus moderation/spam thinking for anything shown on a room
projector.

### 💬 Developer notes

<!-- we wont implement this, atleast not yet, end of discussion-->

---

## 5. Automated player routing to Discord voice channels

> [!quote] Requested — added to worklist, potential test at next LAN
> A Discord bot feature to automatically move/assign players to the right channels
> based on their match.
>
> Ruska mentioned they already run an automated channel-move solution at their LANs —
> worth checking as a reference rather than building from scratch.

> [!success] Status: ✅ Built, deployed, and partly verified live
> This is done. Full backend plus a god-facing admin panel.

**What shipped**
- `functions/lib/discord-move-planner.js` — pure move planning (who goes where), fully unit-tested
- `functions/lib/discord-rest.js` — REST client with outcome classification
- `functions/lib/command-handler.js` — command handling with a bounded retry window
- `functions/lib/firestore-adapter.js` + `functions/index.js` — the `onDiscordCommand` trigger
- Moves queue automatically on **lobby open** and **result confirmation** (commit `49b6c1e`)
- `god.html` Discord tab: setup, player↔Discord link table with batch confirm, kill switch, move activity (commits `9bbe67c` → `7bb5743`)

> [!bug] The plan file understates this badly
> `BoardGame/docs/superpowers/plans/2026-08-08-discord-god-panel.md` still has **every
> `- [ ]` checkbox unticked**, even though Tasks 1–7 are all committed. Only Task 8
> (deploy & verify) is genuinely open — and even that is partly done: a real move test
> ran and corrected the plan's wrong claim that a bot can never move the server owner
> (it can; role-hierarchy immunity doesn't apply to `MOVE_MEMBERS`). That correction is
> currently **uncommitted** in the working tree.

**Open:** tick the checkboxes, commit the owner-move correction, finish Task 8's
remaining verification steps. Ruska's solution is worth a look only if something turns
out to be missing at the LAN — there's no reason to replace working code.

### 💬 Developer notes

<!-- This should be functional and verified.-->

---

## 6. Per-player alcohol/drink counter

> [!quote] Requested by Touch; Inffi called it easy, addable ~a week before a LAN
> A simple counter where players tap to log each drink.

> [!failure] Status: ⬜ Nothing exists
> Searched the whole tree for `kalja` / `karhu` / `eversti` / `drink` / `juoma`. The
> only hits are a **"Beer Drinking" tournament game type** in
> `BoardGame/shared/scripts/games-config.js:146` (a competitive event on the schedule)
> and its onboarding video link — completely unrelated to a personal drink tally.

**Rough shape if built:** a per-player counter is a new Firestore field or subcollection
keyed by player, a tap target on `team.html` (the page a player already has open on
their phone), and nothing else. Genuinely small — Inffi's "easy" read is right, provided
it stays a private tally and doesn't try to touch scoring.

### 💬 Developer notes

<!--  Simple button a player can press, pepsi or coke can, generic beer icon, we dont want this to be alcohol specific, although we could generate a report after the tournament of how many  drinks a player drank and how it affected their performance, valuable information but just a fun addon or a feature. Non critical-->

---

## 7. "Most drinks" leaderboard / honorable mention

> [!quote] Requested by Wustra
> Surface a fun stat from the drink counter — who drank the most beers ("karhuja") or
> shots ("everstejä") during the LAN.

> [!failure] Status: ⬜ Not started
> Blocked on item 6 — there's no data to rank.

**Rough shape if built:** once item 6 stores counts, this is a sort and a render. The
natural home is the existing stats surface (`BoardGame/full/statistics.html` /
`scripts/statistics.js`) or a rotation slide on the live screen. Keep it visibly
separate from tournament standings so it can never be confused with real points.

### 💬 Developer notes

<!-- fun stat counter, nice idea to show these drink statistics maybe when a break is occurring-->

---

## 8. Breathalyzer (promille) → victory point multiplier

> [!quote] Requested by Inffi — read as joking/tongue-in-cheek
> A blood-alcohol reading giving a multiplier to victory points.

> [!failure] Status: ⬜ Not started
> Logged for completeness because it was discussed, not because it's queued.

> [!danger] If this were ever taken seriously
> Scoring has exactly one source of truth — `confirmResult()` / `awardRoundPoints()` in
> `BoardGame/full/scripts/admin.js`, documented at
> `BoardGame/docs/architecture/scoring.md`. That doc exists *because* three
> contradictory scoring specs were found and deleted. Anything that multiplies victory
> points touches the most fragile, most recently repaired part of the system. A
> display-only novelty stat (item 7's shape) carries none of that risk.

### 💬 Developer notes

<!-- we wont implement this, end of discussion -->

---

## Cross-cutting notes

> [!note] None of these are tracked anywhere yet
> `TODO.md` is ~700 lines of tournament-flow bugs and contains **no trace** of this
> Discord thread. If any of these nine should survive this document, they need adding
> there.

**Natural bundles**
- **Live-screen pass:** items 1 + 3 — same files (`view.html` CSS, `display-manager.js`), same QA harness (`dev/view-preview.html`). Highest visible payoff per hour.
- **Comment feed:** items 2 → 4 — 2 is the surface, 4 is a source for it. 2 is worth doing alone; 4 is not worth doing without 2.
- **Drink track:** items 6 → 7 (→ 8) — self-contained, no interaction with tournament logic as long as 8 stays a joke.

**Related plans**
- `BoardGame/docs/superpowers/plans/2026-08-08-discord-god-panel.md`
- `BoardGame/docs/superpowers/plans/2026-08-04-discord-voice-moves-backend.md`
- `BoardGame/docs/architecture/scoring.md`

### 💬 Developer notes

<!-- comment here -->
