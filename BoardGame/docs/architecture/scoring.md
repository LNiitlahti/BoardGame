# Scoring — how `team.points` is calculated

> **Written 2026-08-04 by reading the code, not from design docs.**
>
> Three earlier scoring specs existed in `.plan/` and **all three were wrong**
> (a cluster-`n²` formula, and twice "+1 victory point per tile placed").
> They have been deleted. This file is the only scoring documentation, and it
> describes what the code actually does. If you change any function named
> below, update this file in the same commit.

---

## The formula

A team's score is the single field **`team.points`**. It accumulates from
exactly **two** sources:

| Source | Amount | When |
|---|---|---|
| **Match win** | **+1** | The moment the TD confirms a match result |
| **Heart hex income** | **+1** per side heart, **+2** for the mountain heart | Once per round, on leaving the `scoring_hex` phase — in rounds where at least one match was played |

**Win condition:** first team to reach `gameState.winCondition` points.
Default **50**, set in the setup wizard (`setup.html` `#winCondition`) and
editable live from admin.html's "Win At" badge.

> Heart income halved on 2026-08-05 when the multiplier was removed, and the
> 50 default was deliberately **not** changed — the tournament simply runs
> longer. Retune from admin's "Win At" badge if that turns out wrong; the Pace
> badge beside it shows what the current target costs in rounds.

`points` is the **single source of truth for standings everywhere**. Nothing
that displays a ranking may add anything on top of it.

---

## 1. Match win: +1

**Where:** `confirmResult()` in `full/scripts/admin.js`, and the mirrored
`ResultManager.confirmResult()` / result-correction path in
`full/scripts/result-manager.js` (god.html).

```js
teamsWithFullCredit.forEach(teamId => {
    team.gamesWon    = (team.gamesWon || 0) + 1;
    team.gamesPlayed = (team.gamesPlayed || 0) + 1;
    team.points      = (team.points || 0) + 1;   // the victory point
});
```

Three conditions gate it:

- **Challenge matches award nothing.** `if (!isChallenge)` wraps the whole
  block — a heart-hex dispute changes who controls the hex, not the score, and
  does not touch `gamesWon`/`gamesLost` either.
- **The team's FULL roster must be on the winning side** to get credit
  (`teamsWithFullCredit` = teams with `count >= 2`). This is the split-team
  rule: if a team is split across both sides, it earns neither the win nor the
  point. The same threshold applies to losses (`teamsWithFullLoss`).

  > `count >= 2` is a **proxy** for "the full team", exact only because
  > `MAX_PLAYERS_PER_TEAM = 2` (duplicated in `team-manager.js` and
  > `admin.js`). Raising that cap without revisiting the literal `2` would let
  > a 2-of-3 split team collect full credit — the exact case the rule exists to
  > deny. The literal appears in `admin.js` (`confirmResult()` and
  > `recalculateTeamStats()`), `result-manager.js` (`confirmResult()` and the
  > four filters in the result-correction path), `stats-manager.js`
  > (`recalculateTeamStats()`), and `phase-manager.js` (the "All teams have
  > players" gate). Do not read "2+ players" as the rule; the rule is "all of
  > them".

  A practical consequence at the current roster size: because both match slots
  run in parallel with non-overlapping players, a 2-player team cannot field
  both players in both matches, so **a team's maximum match-win income is +1
  per round**, not +2.
- Losing teams get `gamesLost`/`gamesPlayed` only — no point change.

> **History note:** until 2026-08-04 admin.html incremented `gamesWon` **without**
> awarding the point, while god.html awarded both. The same match win was worth
> a different amount depending on which page confirmed it. Both now award +1.

---

## 2. Heart hex income: +1 / +2, flat, per round

**Where:** `calculateHeartIncome()` in `shared/scripts/board-module.js` — the
one shared script all four pages (admin/god/view/replay) load. Everything that
awards or previews heart income calls it; nothing recomputes it. The payout
itself is `awardRoundPoints()` in `full/scripts/admin.js`, invoked via
`_awardPointsForRound()` in `admin-improved-adapter.js`, which is wired to
PhaseManager's `_onAwardPoints` hook.

```js
const HEART_INCOME = Object.freeze({
    'mountain-heart': 2,
    'side-heart': 1
});
// → { roundPlayed, matchesPlayed, byTeam: { [id]: { points, mountainCount, sideCount } } }
```

**The payout is once per round and does not scale with anything.** A team
holding the mountain heart through a round gets +2, whether the round
contained one match or four. Holding every heart is +8.

> **History note:** until 2026-08-05 income was `value × matchesPlayed`, so the
> mountain heart actually paid +4 a round while the constant at the call site
> read `2`. The multiplier was deliberate (it arrived on its own branch,
> `feat/heart-income-per-match`) but unreadable, the rulebook contradicted
> itself about the resulting totals, and the calculation was duplicated in four
> files. All three are fixed.

Timing and edge cases that are easy to get wrong:

- **Fires on leaving `scoring_hex`**, once per round — `phase-manager.js`:
  `if (current === 'scoring_hex' && this._onAwardPoints && newRound > 1)`.
- **The round paid for is `currentPhase.roundNumber - 1`.** `scoring_hex` sits
  at the *top* of the new round, so the payout settles the round that just
  ended. Both status messages lead with *that* round number, not the one the
  TD has just entered.
- **Round 1 awards no heart income.** The `newRound > 1` guard is deliberate:
  income is paid for a *completed* round, and at the start of round 1 no round
  has been played.
- **A round where nothing was played pays nothing.** This is an explicit gate
  (`roundPlayed === false`), not arithmetic. `countScoringMatchesInRound()`
  supplies the count; challenge matches and breaks don't count toward it, so a
  round of nothing but challenge games pays nobody. Both status messages and
  view.html's live panel say so out loud, so an unpaid round is never silent.
- **Untagged history entries belong to no round.** Matches confirmed before
  phase-flow tagging existed carry `roundNumber: null`, and `Number(null) === 0`
  would otherwise match them all whenever the round being counted is 0 — which
  is exactly what the previews pass during round 1.
- **Control is read after the round's results are confirmed**, so a heart lost
  during the round pays its new holder, not the old one.
- **Contested hearts are frozen.** Any heart hex that is the subject of a
  `pending` or `ongoing` challenge match is skipped for that round — its income
  is withheld until the dispute resolves, rather than paid to the current
  holder. A frozen heart contributes nothing, and the team's other hearts pay
  normally.
- **Double-award guard.** `_awardPointsForRound()` records each payout in
  `gameState.pointsHistory` keyed by round number and returns early if that
  round is already present, so re-entering the phase cannot pay twice.

### Where the match count comes from

`countScoringMatchesInRound(gameState, roundNumber)` in
`shared/scripts/board-module.js`. It counts non-challenge, non-break,
round-tagged entries in `gameState.gameHistory` whose `roundNumber` matches.
It is called from exactly one place — inside `calculateHeartIncome()` — and
its result is a **gate**, not a factor.

`roundNumber` is stamped onto each history entry at confirm time, in **both**
`confirmResult()` (admin.js) and `ResultManager.confirmResult()`
(result-manager.js), copied from the queue entry's own `{roundNumber, slot}`
tag. The pre-existing `tournamentRound` field on history entries is **not**
usable for this: it reads the legacy `gameState.currentRound` counter, which
phase-managed tournaments deliberately never advance.

### Callers

| File | Function | Role |
|---|---|---|
| `full/scripts/admin.js` | `awardRoundPoints()` | the payout (admin.html) |
| `full/scripts/stats-manager.js` | `awardRoundPoints()` | the payout (god.html) |
| `full/scripts/stats-manager.js` | `advanceRound()` | Next Round modal preview |
| `full/scripts/display-manager.js` | `_buildHexScoringHTML()` | view.html live preview |

None of them contains the values or the loop — they call
`calculateHeartIncome()` and render or accumulate `byTeam`. **Keep it that
way.** An earlier version of this file had to warn "four places must agree on
this formula"; the point of the shared function is that no such warning is
needed. If you find yourself writing `+= 2` in one of these files, stop.

`replay-engine.js` needs no change: it replays the logged `points_awarded`
payload rather than recomputing heart income.

### Pace projection

`projectRoundsToWin(gameState, boardModule)` in the same file estimates how
many rounds each team needs to reach `winCondition` **on heart income alone**.
Match wins and future heart captures are excluded, so it is a floor rather than
a forecast; the contested-heart freeze is ignored because a projection is about
steady state. Rendered on admin.html's Pace badge and in the Win Condition
modal. Display-only — it never touches `team.points`.

---

## What does NOT award points

- **Placing a hex/tile.** Placement is the *reward* for winning (and can draw a
  spell card in a room hex), but carries no points of its own. Two deleted
  design docs claimed "+1 per tile placed" — that was never implemented and is
  not the rule.
- **Cluster adjacency.** The `n²` connected-cluster formula in the deleted
  `phase-4-point-calculation.md` was never implemented anywhere.
- **Winning a challenge match.** Transfers heart-hex control (and therefore
  future income), but awards no points directly.
- **Being split across both sides of a match.** See the 2+ player rule above.

---

## Display rules

Every ranking surface must sort by **`points` alone**. `gamesWon` may be used
as a **tiebreaker**, never added into the total — doing so double-counts every
win, because the win's point is already inside `points`.

| File | Function |
|---|---|
| `full/scripts/display-manager.js` | `_getTeamTotalPoints()` — returns `team.points` |
| `full/scripts/statistics.js` | standings sort, trend chart datasets |
| `full/scripts/stats-manager.js` | standings sort, chart datasets |
| `shared/scripts/pdf-generator.js` | standings table |

> This was a live bug: every one of these summed `points + gamesWon` while
> admin.html's own Teams column showed raw `points`, so the spectator screen
> disagreed with the TD's screen. Fixed 2026-08-04.

**Regression guards:**
- `dev/tests/heart-income.test.js` — unit coverage for `calculateHeartIncome()`
  and `projectRoundsToWin()`: flat values, the zero-match gate, the untagged-
  entry guard, the contested freeze, and view.html's panel rendering the same
  numbers as the payout.
- `dev/tests/e2e-full-flow.js` —
  1. every team must satisfy `points >= gamesWon` (proves each win awarded its +1);
  2. no heart payout may exceed +8 (all seven hearts held) — a higher figure
     means a multiplier is back;
  3. the number rendered in `.dm-winner-points` on view.html is compared
     directly against admin's `gameState`.

---

## Manual adjustment and undo

- `adjustTeamPoints(teamId, delta)` — the ± buttons on admin.html's team cards.
  Runs inside a Firestore **transaction** so two admins adjusting the same team
  concurrently accumulate instead of clobbering each other. Clamped at 0.
- `setTeamPoints(teamId, value)` — absolute set; inherently last-write-wins.
- Both log to the action log, so **Undo Last Action** on admin.html can revert
  them, as it can a confirmed match result (which restores the full pre-match
  `teamStats` snapshot including `points`).

## Recalculation — deliberately absent

There is **no** "recalculate all points" function. `calculateAllPoints()`
existed in both `admin.js` and `stats-manager.js` and was **deleted 2026-08-04**:
it rebuilt `points` from heart-hex control alone, which silently erased every
match-win point. It had no callers and no button.

If a rebuild tool is ever needed, it must replay **both** sources — match wins
from `gameState.gameHistory` **and** heart income for each completed round —
not just the board state.

### Board-derived scoring: deleted 2026-08-04

An alternative, board-derived scoring path used to exist alongside the real one
and has been removed:

| Deleted | File |
|---|---|
| `BoardManager.placePlate()` | `full/scripts/board-manager.js` |
| `BoardManager.calculatePoints()` | `full/scripts/board-manager.js` |
| `BoardManager.checkWinCondition()` | `full/scripts/board-manager.js` |
| `BoardModule.calculateTeamPoints()` | `shared/scripts/board-module.js` |

All four were verified unreachable before removal — no callers, not exposed on
`window`, no button on god.html or admin.html. They were also wrong twice over:
`calculatePoints()` **replaced** `team.points` with a board-derived total (which
would have erased every match-win point), and it counted heart hexes twice —
once via `calculateTeamPoints()` summing `getHexValue()` over owned hexes, then
again from `heartHexControl`.

Kept deliberately: `BoardManager.canPlaceAt()` and `highlightValidPlacements()`
(the latter is wired to god.html's "Valid Placements" button), and
`BoardModule.getHexValue()` (used by `getValidPlacements()` and
`tools/spell-generator.html`).

If board-driven scoring is ever genuinely wanted, write it against this document
rather than resurrecting the old functions from git history.
