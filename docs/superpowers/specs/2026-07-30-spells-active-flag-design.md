# SpellsActive Tournament Flag

## Context

The tournament organizers decided spells will be played physically (outside the
digital app) going forward. The board and match flow still route through the
existing `spell_window_1..4` phases — god/admin still runs those phases and
manually adjusts the board to reflect spells cast at the table — but players no
longer need to see or interact with digital spell cards in `team.html`.

This adds a per-tournament `spellsActive` flag, editable by the global admin
(god) and the tournament admin, that controls only what players *see and can
click* in `team.html`. It does not change the phase system, the spell engine,
or any admin-side spell tooling.

## Data model

- New field `spellsActive: boolean` on the tournament document
  (`tournaments/{tournamentId}`), the same document `god.html`, `admin.html`,
  and `team.html` already read/write in full.
- **Default:** missing/undefined is treated as `false`. This applies to every
  existing tournament (nothing has this field set today) as well as newly
  created tournaments — spells are hidden until an admin explicitly turns them
  on for a given tournament.

## god.html — Edit Tournament modal

`god-app.js`'s existing `editTournament`/`saveTournamentEdits` flow (the modal
that already edits Name and Win Condition) gets a third field: a "Spells
Active" checkbox.

- `editTournament(tournamentId)`: checkbox initialized from
  `t.spellsActive === true`.
- `saveTournamentEdits()`: reads the checkbox and includes `spellsActive` in
  the `tournaments.doc(id).update({ name, winCondition, spellsActive })` call
  already made there.

## admin.html — top bar "Spells" badge

Follows the existing "Win At" stat-badge pattern in `admin-improved-adapter.js`
(`_renderWinConditionBadge` / `openWinConditionModal` / `saveWinCondition`)
exactly:

- New stat badge in the top bar, next to "Win At": label "Spells", value
  "On"/"Off", editable (click opens a modal).
- `openSpellsActiveModal()` / `closeSpellsActiveModal()` / `saveSpellsActive()`
  mirror the win-condition modal functions. Saving sets
  `gameState.spellsActive = value` and calls the existing `saveGameState()`,
  which merge-writes the whole `gameState` object (including this field) back
  to the tournament doc — same mechanism already used for win condition.
- `_renderSpellsActiveBadge()` mirrors `_renderWinConditionBadge()`, called
  wherever the win-condition badge is currently refreshed (initial load,
  after save, after tournament switch).

## team.html — conditional rendering

Driven by `gameData.spellsActive` (already kept live via the existing
`tournamentRef.onSnapshot` listener in `team-controls.js`).

1. **Spell Cards sidebar section** (`team-section` containing
   `#spellCardsList`): hidden entirely (`display: none` on the section) when
   `spellsActive` is falsy. `renderSpellCards()` gets an early check that
   toggles the section's visibility before doing its normal render.

2. **Spell Phase overlay** (`#spellPhaseOverlay`, shown during
   `spell_window_*` phases): still appears when a spell-window phase is active
   (players should know a spell window is happening), but when `spellsActive`
   is falsy it renders a non-interactive state instead of the hand-of-cards
   casting UI:
   - No `spellHandCards` grid, no "Pass (No Spell)" button.
   - A static message, e.g. "Spell phase — resolved by the tournament admin."
   - `renderSpellPhaseOverlay()` branches on `gameData.spellsActive` near the
     top: if falsy, render the waiting message and return before reaching the
     turn-order / hand-rendering logic (`_renderSpellPhaseHand`,
     `selectSpellToCast`, etc. are simply not invoked).

## Explicitly out of scope

- The `spell_window_1..4` phase definitions, timeline, and advancement logic
  in `phase-manager.js` / `admin-phase-adapter.js` /
  `admin-improved-adapter.js` are unchanged — god/admin still runs these
  phases and manually resolves board effects regardless of the flag.
- The spell engine, spell casting Firestore writes (`castSpellViaFirestore`),
  spell history, and active-effects logic are unchanged and unused code paths
  when the flag is off — they simply aren't triggered because the UI that
  calls them is hidden.
- No changes to `view.html` or any spectator-facing page (not mentioned by the
  user; can be revisited separately if needed).

## Testing

- Toggle `spellsActive` off/on in god.html's edit modal; confirm it persists
  and reflects in admin.html's badge.
- Toggle via admin.html's badge/modal; confirm it persists and reflects in
  god.html's edit modal on reopen.
- With `spellsActive` false: load `team.html` for a team in a tournament with
  spell cards in hand — confirm the sidebar section is absent, and that
  entering a `spell_window_*` phase shows the static waiting message with no
  clickable cards.
- With `spellsActive` true: confirm both team.html surfaces behave exactly as
  they do today (no regression).
- A tournament with no `spellsActive` field at all (pre-existing data):
  confirm it behaves the same as `spellsActive: false`.
