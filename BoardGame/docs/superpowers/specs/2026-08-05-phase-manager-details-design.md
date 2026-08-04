# Phase Manager Match/Player Details + Discord Confirm Removal — Design

**Date:** 2026-08-05
**Status:** Approved

## Problem

1. During `matches_in_progress`, the admin phase manager's slot panels show only
   "Match N — Lobby" with bare counters ("Game lobby: 2/4, Discord: 2/4").
   The admin cannot see which game is queued, which teams play, or **who**
   specifically hasn't readied up.
2. Players still have manual "Discord" confirm buttons in the team view, but
   the Discord bot now moves players into voice channels automatically and the
   backend writes `lobbyReady[uid].discord = true` on their behalf. The manual
   buttons are redundant.

## Part A — Slot panels show match & player details (`phase-manager.js`)

### New helper: `_getSlotMatchDetails(slot)`

Resolves the slot's active (non-completed, non-break) matches from
`gameState.gameQueue`, using the same slot/round tagging rules as
`_getPlayersWhoMustReadyForSlot` (untagged matches count for either slot;
matches for other rounds are excluded). Accepts pseudo-slot `'challenge'`.

Returns per match: game display name, match number, sides (team id + team
name resolved from `gameState.teams` rosters), and each side's Discord
channel (`match.discordChannels[sideId]`). Per-player names/readiness are
resolved separately by the sibling `getLobbyPlayerStatuses(slot)` helper,
not embedded in each side.

### Rendering (`_renderSlotPanels`)

Per slot, depending on sub-phase:

- **setup:** queued match's game + team names (falls back to the existing
  "Create a match for Match N" requirement when none queued).
- **lobby:** header with game name, teams and Discord channels, then a
  per-player readiness list: each required player's name with two indicators —
  game lobby (manual confirm) and Discord (auto-written by the bot pull).
  Not-ready players are visually flagged. The existing "Game lobby: X/N /
  Discord: X/N" requirement counters remain the advance gate.
- **playing:** game + teams + ongoing/pending match status (existing
  requirement labels stay).

The **challenge lobby** requirements block gets the same per-player list via
the shared rendering helper.

Player names resolve from team rosters (`team.players[].name` keyed by `uid`);
unknown uids render as a shortened uid.

### CSS

Small additions to the admin stylesheet for the match-details header and the
player readiness grid (compact chips, met/unmet coloring reusing the existing
`phase-req-item` palette).

## Part B — Remove manual Discord confirm from player view (`team-controls.js`)

- Remove the Discord confirm buttons (self-confirm and vouch-for-teammate) and
  the `setReadyStatus('discord')` entry points.
- Keep the game-lobby confirm button unchanged.
- Teammate list keeps a **read-only** Discord indicator (shows whether the bot
  has moved the player).
- Copy: "join Discord and the game lobby, then confirm both" → "You'll be
  moved into Discord automatically — confirm once you're in the game lobby."
- Admin side unchanged: "Discord: X/N" requirement remains (fed by
  automation); Force Ready stays as the admin override.

## Out of scope

- No changes to the Discord bot/backend pull flow.
- No changes to lobbyReady data shape or Firestore writes.
- No backward-compat handling beyond the existing dual-shape queue support.

## Testing

- Extend the phase-manager node tests to cover `_getSlotMatchDetails`
  (slot/round filtering, dual queue shapes, challenge pseudo-slot, name
  resolution).
- Update `e2e-ready-check.js` if it interacts with the removed Discord
  buttons.
