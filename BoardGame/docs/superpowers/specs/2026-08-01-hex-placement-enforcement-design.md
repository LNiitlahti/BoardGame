# Hex Placement Enforcement — Design Spec (scoping only, not yet planned/built)

## Problem

Confirmed by direct code inspection + live testing (see conversation this doc originates from). Three compounding gaps in `full/scripts/admin.js`:

1. **No ownership check on hex assignment.** `assignTeamToHex(coord, teamId)` (admin.js:1580) and the team-picker it's called from (`handleHexClick`, admin.js:1501) let the admin assign *any* team to *any* hex, regardless of who actually won the match that hex placement is for. There's no validation step, no warning, no confirmation.
2. **No ordering enforcement.** `pendingHexWins` (the reminder list) tracks *that* a team owes a placement, never *when* — any pending team can place in any order, and the phase-manager's requirement check (`phase-manager.js:1057-1067`) only counts `pendingHex === 0`, never which team satisfied it.
3. **Reminder state is not persisted.** `pendingHexWins` is declared `let pendingHexWins = []` at admin.js:46 — a plain in-memory variable, never written to `gameState`/Firestore. A page refresh on the admin's device, or opening a second admin/god device, loses the entire pending-placement list even though the underlying game state hasn't changed. Grepped the full codebase — zero persistence references confirmed.

Net effect: hex placement is 100% honor-system. A misclick assigns real board control (and later, real points) to the wrong team with no system-level safety net beyond manually noticing and using "Clear Hex" / `deleteLastTileCaptureEvent` to undo.

## Why it matters

Hex/heart-hex control is the actual scoring mechanism (`awardRoundPoints()`, admin.js:4573) — territory, not match wins, drives `team.points`. An unenforced placement step sitting directly upstream of scoring is a real integrity risk for a live event, especially under time pressure with multiple simultaneous matches finishing close together (exactly the condition Round 2 of this test tournament reproduced — two winners needing to place around the same time).

## Options

**A. Persist `pendingHexWins` to `gameState`, keep placement unrestricted.**
Smallest change. Fixes the "vanishes on refresh / invisible to second device" problem. Does *not* fix wrong-team-places-first — still honor system, just a reminder that survives reloads.

**B. Restrict the team-picker to pending-eligible teams only, when a pending placement exists for that hex's phase.**
When `pendingHexWins.length > 0`, the hex-click team-picker (admin.js:1561-1574) only lists teams that appear in some pending entry, instead of every team on the roster. Removes the "assign to a team that never won anything" failure mode entirely. Doesn't address ordering between multiple pending teams (probably fine — nothing in the rules says placements must happen in strict order, only that the *right* team places).

**C. Full transactional placement queue** (persisted, ordered, each hex-click validated server-side against whose turn it is).
Most correct, most invasive. Requires Firestore rules changes to actually enforce (client-side checks alone don't stop a determined bad actor, though for this app's threat model — a live LAN event run by a trusted admin — that's likely overkill). Meaningfully larger effort than A+B combined.

## Recommendation (non-binding — revisit when picked up)

**A + B together**, skip C. Persist the pending list (fixes the refresh/multi-device blind spot) and filter the team-picker to pending-eligible teams whenever a pending entry exists for that hex (fixes the wrong-team-assignment failure mode). This directly closes the two gaps that matter most (silent wrong assignment, reminder loss) without the cost/complexity of full server-side turn enforcement, which doesn't fit this app's actual trust model.

## Rough scope if picked up

- `admin.js`: move `pendingHexWins` into `gameState.pendingHexWins`, update all read/write sites (`confirmResult`, `clearPendingHexWin`, `updatePendingHexNotification`, `handleHexClick`) to read/write through `gameState` + `saveGameState()` instead of the local `let`.
- `admin.js`: `handleHexClick` — when `gameState.pendingHexWins` has entries, filter the team option list to `pendingHexWins.flatMap(w => w.teamIds)` (still allow "Clear Hex"); fall back to full team list when nothing's pending (manual/setup use still needs unrestricted access).
- No `firestore.rules` changes needed for A+B (still same-document write, same admin/god actor).
- Testing: re-run the Round 2 two-simultaneous-winners scenario from this session, confirm the picker now excludes non-pending teams, confirm a forced page reload mid-round doesn't lose the pending list.

Not scheduled — logged here so it's not re-discovered from scratch next time it comes up.
