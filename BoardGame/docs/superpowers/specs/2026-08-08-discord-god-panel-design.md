# Design Doc: god.html Discord Panel

**Status:** designed, not yet built
**Supersedes:** the "Follow-up (separate plan)" section of
`2026-08-04-discord-voice-moves-design.md`, which deferred this exact panel.

## Context / problem

The Discord voice-move backend (Cloud Function, planner, REST client, automatic triggers) is
built, deployed, and smoke-tested. But `discordConfig`, `discordLinks`, and the guild's channel
IDs currently have no UI at all — every value has to be hand-typed into the Firestore console,
one field at a time, including nested maps of arrays for `slotChannels`. Seeding one player's
Discord link this way took a long back-and-forth to get right; seeding a full roster of
30+ players this way is not viable.

This was a known, explicit gap: the original design's "Follow-up" section named exactly this
panel and exactly this scope. This doc is that follow-up.

## Goals

- Let a god configure a tournament's Discord guild/channel IDs without touching the Firestore
  console.
- Let a god confirm player→Discord links for the whole roster in one pass, not one console
  document at a time.
- Let a god flip the kill switch and see recent move activity from the app.

## Non-goals (this round)

- Not extending any of this to the `admin` role — matches the original design's `god`-only
  decision for config/links.
- Not building Discord-side server/channel *creation* — the guild and its voice channels must
  already exist; this panel only reads and references them.
- Not adding automated DOM tests for the panel itself — matches this codebase's existing
  convention of manual verification for admin-panel UI code.

## Approach

A fifth `god.html` tab, `data-role="god"`, new script `BoardGame/full/scripts/discord-panel.js`,
following the same tab/script pattern as the existing Users/Spells tabs. Scoped to whichever
tournament is currently selected via `_currentTournamentId`.

Two Firestore-backed lookups the panel needs — the guild's member list and its channel list —
are both fetched via new one-shot commands through the existing `discordCommands` pipeline,
mirroring the pattern already built and tested for `refresh-members`:

```
discord-panel.js
  -> "Refresh channels" -> DiscordCommands.request('refresh-channels')
  -> "Refresh members"  -> DiscordCommands.request('refresh-members')  (already exists)

onDiscordCommand (existing trigger, no change to its registration)
  -> refresh-channels: rest.listGuildChannels(guildId) -> discordConfig/channelCache
  -> refresh-members:  rest.listGuildMembers(guildId)  -> discordConfig/memberCache  (existing)

discord-panel.js reads discordConfig/channelCache + memberCache to populate dropdowns
```

## Backend addition: `refresh-channels`

New, additive to the already-shipped, already-reviewed backend — no changes to existing
tested behavior, only new code paths.

- **`discord-rest.js`** gains `listGuildChannels({ guildId })`: calls `GET /guilds/{id}/channels`,
  filters to voice channels (`type === 2`), returns
  `{ outcome: 'ok', channels: [{ channelId, name }] }` on success or
  `{ outcome: 'error', error }` on failure — same shape and error-handling style as the
  existing `listGuildMembers`.
- **`command-handler.js`** gains a `refresh-channels` branch, handled identically to
  `refresh-members`: before the staleness/pull/return logic, no retry loop (it's a one-shot
  fetch, not a move), always "current" (no staleness check applies).
- **`firestore-adapter.js`** gains `writeChannelCache(data)`, writing to
  `discordConfig/channelCache` — a sibling document to the existing `discordConfig/memberCache`.

```
discordConfig/channelCache
  { channels: [{ channelId, name }], count, refreshedAt }
```

No new Firestore rules needed — `match /discordConfig/{docId}` already covers any document
under that collection.

## Suggestion matching

Normalized exact match only, not fuzzy matching. For each roster player, normalize their
onboarding-entered Discord username (trim, strip a leading `@`, lowercase, strip a trailing
`#0`-style discriminator) and compare against the same normalization applied to each cached
guild member's username and display name. A match pre-selects that member in the row's
dropdown; no match leaves the dropdown on a blank/"unlinked" option.

Fuzzy matching (Levenshtein-style closeness) was considered and rejected: the entire reason
the backend uses confirmed links instead of runtime matching is to eliminate the
silent-wrong-match failure mode. A fuzzy suggestion that's subtly wrong and gets rubber-stamped
during a fast "confirm all" pass reintroduces exactly that risk. Exact-or-nothing keeps the
human's confirmation meaningful.

This normalization/comparison logic is pure and gets extracted into its own small function
(same pattern as `resolve-tournament-id.js`) so it can be unit-tested directly, rather than
buried inline in DOM-manipulation code.

## The four panel sections

**1. Setup**
- Text input for `guildId` (stays manual — there's no practical Discord API for "list servers
  this bot is in" that fits this flow, and it's a once-per-tournament value).
- "Refresh channels" button, queues `refresh-channels`, panel listens on
  `discordConfig/channelCache` and populates dropdowns once it updates.
- Five dropdowns, populated with channel names from the cache: Waiting Room, Slot 1 side A,
  Slot 1 side B, Slot 2 side A, Slot 2 side B.
- "Save" assembles and writes `discordConfig/state`. `enabled` defaults to `false` on first
  save — a fresh setup should not go live automatically.

**2. Player Links**
- One row per roster player (from the tournament's `teams[].players[]`): player name, the
  username they typed at onboarding, the suggested match (blank if none), a `<select>` of all
  cached guild members defaulting to the suggestion.
- "Refresh members" button (existing command, now surfaced in UI for the first time).
- "Confirm all suggestions" — writes a `discordLinks/{uid}` document for every row that has a
  suggestion, in one pass.
- Per-row "Confirm" for manual picks/corrections.
- Rows with neither a suggestion nor a manual pick are visually flagged (e.g. a red-tinted
  row) — these players will not be moved, and the flag makes that obvious before the first
  match starts.

**3. Kill Switch**
- Toggle bound to `discordConfig/state.enabled`.
- Disabling writes immediately, no confirmation — the safe direction should never have
  friction.
- Enabling reuses the existing confirmation-modal pattern from `showSpellConfirmation` in
  `team-controls.js` (dark overlay, Confirm/Cancel buttons): "Re-enable Discord moves? Players
  will start being moved automatically again." This matches the original design's stated
  intent — re-enabling should take a deliberate click so nobody accidentally reactivates moves
  mid-break.

**4. Activity**
- Reads the most recent ~30 `discordCommands` documents (ordered by `requestedAt` descending),
  each row showing type, slot, status, and an expandable per-player `results` list.
- A "move now" button per active slot, calling
  `DiscordCommands.request('pull', { slot, force: true })` — the manual retry path the backend
  was already built to support.

## Testing

- **Backend additions** (`listGuildChannels`, the `refresh-channels` handler branch): same
  TDD/unit-test discipline as the rest of `functions/` — failing test, implementation, passing
  test, folded into the existing suite.
- **Suggestion-matching normalization**: extracted as a pure function, unit-tested directly
  (trim/lowercase/`@`-strip/discriminator-strip cases, no-match case).
- **Panel DOM/rendering code** (`discord-panel.js` itself): no automated test, matching this
  codebase's existing convention for admin-panel UI (`user-management.js`,
  `discord-commands.js`, etc. are all manually verified, not unit tested — there's no DOM test
  harness for this class of code in this project). Verified manually: open god.html, walk
  through all four sections against a real test tournament and Discord server.

## Success criteria

- A god can configure a tournament's Discord settings entirely from god.html, with zero
  Firestore console interaction.
- Confirming a full roster's links takes a single "confirm all" click for the common case
  (exact username matches), with per-row correction only for the exceptions.
- The kill switch and recent move activity are both visible and operable from the app.
