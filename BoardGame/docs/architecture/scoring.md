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
| **Heart hex income** | **(+1** per side heart, **+2** for the mountain heart**) × matches played in the round** | Once per round, on leaving the `scoring_hex` phase |

**Win condition:** first team to reach `gameState.winCondition` points.
Default **50**, set in the setup wizard (`setup.html` `#winCondition`) and
editable live from admin.html's "Win At" badge.

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

## 2. Heart hex income: (+1 / +2) × matches played

**Where:** `awardRoundPoints()` in `full/scripts/admin.js`, invoked via
`_awardPointsForRound()` in `admin-improved-adapter.js`, which is wired to
PhaseManager's `_onAwardPoints` hook.

```js
if (hexType === 'mountain-heart')  heartIncome += 2;
else if (hexType === 'side-heart') heartIncome += 1;
...
const roundPoints = heartIncome * matchesPlayed;
team.points = (team.points || 0) + roundPoints;   // ADDs, never replaces
```

**The payout is once per round, but scales with that round's match count.**
A normal round contains two matches, so one side heart held through it is
**+2**, and the mountain heart is **+4**. This is a single lump payment, not
one payment per match — the distinction matters because control is read once,
at payout time.

Timing and edge cases that are easy to get wrong:

- **Fires on leaving `scoring_hex`**, once per round — `phase-manager.js`:
  `if (current === 'scoring_hex' && this._onAwardPoints && newRound > 1)`.
- **The round paid for is `currentPhase.roundNumber - 1`.** `scoring_hex` sits
  at the *top* of the new round, so the payout settles the round that just
  ended. The multiplier counts that round's matches, not the new one's.
- **Round 1 awards no heart income.** The `newRound > 1` guard is deliberate:
  income is paid for a *completed* round, and at the start of round 1 no round
  has been played.
- **Challenge games do not multiply.** `countScoringMatchesInRound()` skips
  `isChallenge` entries. This follows the existing rule that a challenge match
  awards no points at all — it moves hex control, not score. A round with 2
  matches and 5 challenge games still pays ×2.
- **Control is read after the round's results are confirmed**, so a heart lost
  during the round pays its new holder, not the old one.
- **A round where nothing was played pays ×0.** That is the rule, not a bug —
  but both the god.html/admin.html status message and view.html's live Hex
  Scoring panel print the multiplier, so a `×0` is always visible to the TD
  rather than silently zeroing everyone's income.
- **Contested hearts are frozen.** Any heart hex that is the subject of a
  `pending` or `ongoing` challenge match is skipped for that round — its income
  is withheld until the dispute resolves, rather than paid to the current
  holder. The freeze wins over the multiplier: a frozen heart pays 0, not 0×n.
- **Double-award guard.** `_awardPointsForRound()` records each payout in
  `gameState.pointsHistory` keyed by round number and returns early if that
  round is already present, so re-entering the phase cannot pay twice.

### Where the match count comes from

`countScoringMatchesInRound(gameState, roundNumber)` in
`shared/scripts/board-module.js` — the one shared script all four pages
(admin/god/view/replay) load. It counts non-challenge, non-break entries in
`gameState.gameHistory` whose `roundNumber` matches.

`roundNumber` is stamped onto each history entry at confirm time, in **both**
`confirmResult()` (admin.js) and `ResultManager.confirmResult()`
(result-manager.js), copied from the queue entry's own `{roundNumber, slot}`
tag. The pre-existing `tournamentRound` field on history entries is **not**
usable for this: it reads the legacy `gameState.currentRound` counter, which
phase-managed tournaments deliberately never advance.

Four places must agree on this formula. If you change one, change all four:

| File | Function | Role |
|---|---|---|
| `full/scripts/admin.js` | `awardRoundPoints()` | the payout (admin.html) |
| `full/scripts/stats-manager.js` | `awardRoundPoints()` | the payout (god.html) |
| `full/scripts/stats-manager.js` | `advanceRound()` | legacy Next Round modal preview |
| `full/scripts/display-manager.js` | `_buildHexScoringHTML()` | view.html live preview |

`replay-engine.js` needs no change: it replays the logged `points_awarded`
payload rather than recomputing heart income.

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

**Regression guards** in `dev/tests/e2e-full-flow.js`:
1. every team must satisfy `points >= gamesWon` (proves each win awarded its +1);
2. the number rendered in `.dm-winner-points` on view.html is compared directly
   against admin's `gameState`.

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
