# Design Doc: Discord Voice Moves via Cloud Functions

**Status:** designed, not yet built
**Supersedes the transport half of:** `discord-bot-review-and-killswitch.md` (the always-on
bot design). The identity-review and kill-switch goals from that doc survive here in
changed form; the persistent Node bot does not.

## Context / problem

Players sit in a Discord "Waiting Room" voice channel. When a match lobby opens they must
move themselves into their side's channel, and after the match they drift back. This is
manual, slow, and the single biggest source of dead time between matches — the lobby
ready-check can't complete until everyone has found the right channel.

The earlier design solved this with an always-on Discord bot holding a gateway connection,
running on a laptop at the event. That has two problems this project can't absorb:

- **Nowhere to run it.** Hosting is "any static file server" (`README.md`) — files uploaded
  to a host, Firestore as the entire backend, no Node runtime in the deploy. A static host
  cannot hold a WebSocket gateway connection, cannot keep a process alive between requests,
  and cannot store a bot token outside a publicly-fetchable webroot.
- **The laptop is a single point of failure.** A bot on the event machine depends on that
  machine staying awake and on venue wifi staying up, mid-event, with no remote recovery.

Moving a member between voice channels is a single REST call. It does not need a gateway.

## Goals

- Move players from Waiting Room into their match's voice channels when a lobby opens.
- Move them back to Waiting Room when the match result is confirmed.
- Never move the wrong person.
- Let a human stop all automatic moves from the web UI, and correct a bad player→Discord
  link mid-event without a redeploy or restart.
- Run with no always-on process anywhere.

## Non-goals (this round)

- Not building OAuth-based Discord account linking. Usernames typed at onboarding, plus a
  human confirmation step, are the chosen tradeoff.
- Not reacting to Discord-side events (someone joining voice, slash commands, DMs). Those
  need a gateway connection; this design deliberately has none.
- Not moving players who are not already connected to a voice channel — see Constraints.
- No retroactive undo: disabling the bot mid-match does not move already-placed players back.

## Approach

Nothing triggers off the tournament document. All moves are requested by writing a command
doc to a dedicated collection; one Cloud Function triggers on that collection and is the only
thing that ever moves anyone.

```
admin.html client code
  -> slot enters `lobby`            -> writes discordCommands/{id} { type: 'pull', slot }
  -> match result confirmed          -> writes discordCommands/{id} { type: 'return', slot }
  (god.html "move now" button        -> writes the same doc, manually)

Cloud Function onDiscordCommand (Firestore onCreate)
  -> checks discordConfig/state.enabled          (kill switch)
  -> checks the command is still current         (staleness)
  -> resolves match sides -> playerUids -> discordLinks
  -> PATCH /guilds/{gid}/members/{uid} { channel_id }
  -> writes per-player outcomes back onto the command doc

god.html Discord tab
  -> edits discordConfig, confirms discordLinks, reads command results
```

### Why a command collection rather than a tournament-doc trigger

The tournament doc is written constantly — `lobbyReady`, `spellPiles`, `teams`, board state,
on every gameplay action (`firestore.rules` `isPlayerGameplayUpdate`). A trigger there would
fire on every one of those writes and would need careful diffing to no-op cheaply. Worse, the
function writes back to that same doc (setting `lobbyReady[uid].discord`), which would
re-trigger itself — an unbounded recursion, and the standard way people generate surprise
Firebase bills.

Triggering on `discordCommands` makes that failure mode structurally absent: the function is
triggered by a collection it never writes to, and writes to collections that never trigger it.

## Components

Three units, separated so the logic is testable without network or Firestore.

**`discord-move-planner.js`** — pure, no I/O.
`(match, links, config, direction) -> [{ uid, discordUserId, channelId }]`
Owns all "who goes where" logic: side→channel mapping, mixed-roster sides, skipping unlinked
players. Depends on nothing. Fully unit-testable.

**`discord-rest.js`** — thin wrapper over the Discord HTTP API. Two operations: move a member,
list guild members. Injectable, so tests substitute a fake. Owns auth headers, 429 handling,
and error classification.

**Cloud Function** — the glue. One function, `onDiscordCommand`, a Firestore `onCreate`
trigger on `discordCommands`. The only thing that moves anyone.

It handles three command types: `pull`, `return`, and `refresh-members`. The last one fetches
the guild member list and writes it to `discordConfig/memberCache` for the link dropdown to
read.

Routing the member list through a command rather than a callable function keeps this to a
single function, avoids adding the `firebase-functions-compat` SDK to the page loader (which
today loads only app, firestore, and auth), and persists the member list so the dropdown
still works when the function is cold. It also gives the operator an explicit refresh button,
which matters because guild membership changes during an event — anyone who joins after the
last refresh would otherwise be missing from the dropdown exactly when someone needs to link
them.

## Data model

All under `tournaments/{tid}`.

```
discordConfig/state
  { enabled: true,
    guildId, waitingRoomChannelId,
    slotChannels: { "1": [chA, chB], "2": [chC, chD], "challenge": [chE, chF] } }

discordLinks/{playerUid}
  { discordUserId, discordUsername, displayName,
    confirmedBy, confirmedAt, source: 'auto-suggested' | 'manual' }

discordConfig/memberCache
  { members: [{ discordUserId, username, displayName }], refreshedAt, count }

discordCommands/{cmdId}
  { type: 'pull' | 'return' | 'refresh-members', slot, matchId,
    requestedBy, requestedAt, force: false,
    status: 'pending' | 'done' | 'skipped', reason,
    results: [{ uid, outcome, discordUserId, channelId, error }] }
```

Modelling channels as `slotChannels[slot][sideIndex]` makes challenge matches nearly free —
`challenge` is just another slot key through the same code path, matching how
`_getPlayersWhoMustReadyForSlot` already treats it as a pseudo-slot.

Command docs are kept permanently as the audit trail. A few dozen per event is negligible
storage, and it is what actually makes every automatic move auditable after the fact.

## Identity: confirmed links, not runtime matching

The function moves **only players with a confirmed Discord link**. It never matches usernames
at move time.

Before the first match, the god panel shows each roster player with the bot's best-guess
match pre-selected (normalised comparison against the guild member list: trimmed, `@`
stripped, lowercased, legacy `#0` discriminator stripped). A human confirms the roster in one
pass — mostly clicking through correct guesses — and the confirmed `discordUserId` is stored.
Unconfirmed players are skipped by the function and listed as unlinked.

This converts the dangerous failure mode into the safe one. With runtime matching, a wrong
match silently moves the wrong human mid-event and nothing looks broken. With confirmed
links, the worst case is "player X wasn't moved and is shown as unlinked" — self-announcing,
and fixable in seconds from the same panel, taking effect on the very next move with no
restart. It also keeps the function simple: a stored ID lookup, no fuzzy matching or
confidence scoring in the hot path.

The link table stays editable during the event.

## Behaviour

**Pull** (slot enters `lobby`):

1. Client writes one command doc.
2. Function reads `discordConfig/state`. If `enabled === false`, writes
   `status: 'skipped', reason: 'disabled'` and stops. That is the entire kill switch.
3. Staleness check: the slot must still be in `lobby` and `matchId` must still match. Stops a
   delayed or duplicated command from yanking people out of a match that already started.
   Commands carrying `force: true` skip this check — the god panel's "move now" button sets
   it, because its whole purpose is the case the check would reject: a straggler who turns up
   after the lobby phase has moved on. Automatic commands never set it.
4. Resolves the match's sides to `playerUid`s, then to `discordLinks`. Side index *i* targets
   `slotChannels[slot][i]`.
5. Moves each linked player.
6. Writes per-player outcomes back onto the command doc.

**Return** (result confirmed — `queueEntry.status = 'completed'` in `result-manager.js`):
identical, target is `waitingRoomChannelId`, staleness check inverted.

**On a successful move**, the function sets `lobbyReady[uid].discord = true` via a targeted
dot-path field update. The flag means "player is in the right voice channel"; if the bot just
put them there, that is verified rather than self-reported, and it removes a click per player
per round. A dot-path update composes with the tombstone-reset logic in
`_resetLobbyReadyForSlot` rather than fighting it. This write does not re-trigger the
function.

### Retry schedule

Attempts at t = 0, 1, 3, 7, 15, 31, 63, 120 seconds — doubling waits of 1, 2, 4, 8, 16, 32s,
then a final attempt at the 2-minute ceiling. Eight attempts, hard stop at 120s.

- Only players **not yet placed** are retried. A successful move is final — nobody is dragged
  back after leaving deliberately. This is the main reason the window is bounded at all: an
  unbounded loop would fight players who step away on purpose.
- The same schedule covers both `not_in_voice` and transient errors, so the retry logic does
  not need to distinguish them.
- `forbidden` and `not_in_guild` are **terminal** — no amount of retrying fixes a permissions
  error or a wrong ID. They fail immediately. This also stops a misconfigured bot from
  hammering 403s eight times per player.
- Exits the moment everyone is placed, so the normal case is one pass.
- A 429 is retried after `retry_after`, absorbing the brief ~8 req/s burst a full side
  produces on the fast early attempts.

Cost of a held instance for the full 2 minutes is ~30 GB-seconds, against 400,000 free
per month.

### Outcomes

| Outcome | Cause | Terminal |
|---|---|---|
| `moved` | Success (Discord returns 200 with the member object) | yes |
| `unlinked` | No confirmed link, or roster player has no account | yes |
| `no_channel` | `slotChannels` has no channel for this slot/side — config error | yes |
| `not_in_voice` | Player isn't connected to any voice channel | retried |
| `not_in_guild` | Left the server, or wrong ID | yes |
| `forbidden` | Bot lacks MOVE_MEMBERS, or can't see the channel | yes |
| `error` | Anything else, with the Discord message | retried |

## Constraints

**Discord cannot move a member who is not already connected to voice.** The API rejects it.
"Everyone waits in the Waiting Room" is therefore a hard precondition, not a convention.
Anyone who joins late, or is connected on mobile without voice, cannot be pulled — the panel
reporting "3 not in voice" is the design working correctly.

**Guild Members is a privileged intent.** It must be enabled in the Discord developer portal
or `listGuildMembers` returns an empty list and every link suggestion is blank.

**Event triggers are at-least-once.** The same command doc can fire the function twice. Moves
are idempotent — moving someone to a channel they're already in is a no-op — so this is
harmless. The design relies on that rather than attempting exactly-once delivery.

**Blaze plan required.** Cloud Functions cannot deploy on Spark. Expected cost at this scale
is single-digit cents per month, dominated by Artifact Registry image storage rather than
execution. `maxInstances: 3` and a budget alert are set regardless.

## UI

New `god.html` tab, `data-role="god"`, scoped to the tournament already selected via
`_currentTournamentId`. Four sections:

1. **Setup** — guild ID, Waiting Room channel, six slot channel IDs. Entered once.
2. **Player links** — roster rows: player name, the username they typed at onboarding, the
   bot's suggestion, a guild-member dropdown fed from `discordConfig/memberCache`. "Confirm
   all suggestions" for the common case, per-row correction otherwise. Unlinked players
   visually obvious. A "refresh members" button queues a `refresh-members` command.
3. **Kill switch** — toggle bound to `discordConfig/state.enabled`. Disabling is instant;
   re-enabling takes a confirmation click, so nobody accidentally moves people mid-break.
4. **Activity** — recent commands with per-player outcomes, plus a "move now" retry per slot.

## Security

Three new blocks inside `match /tournaments/{tournamentId}`:

```
match /discordConfig/{docId}    { allow read: if isAdmin(); allow write: if isGod(); }
match /discordLinks/{playerUid} { allow read: if isAdmin(); allow write: if isGod(); }
match /discordCommands/{cmdId}  { allow read: if isAdmin(); allow create: if isAdmin();
                                  allow update, delete: if false; }
```

`update: false` means no client can forge a result — only the function writes outcomes, via
the Admin SDK, which bypasses rules. `create: isAdmin` is required because the automatic
commands are written from admin.html's flow code even though the panel lives in god.html.

`DISCORD_BOT_TOKEN` lives in Cloud Secret Manager via `defineSecret`. Never in the repo,
never in client JS.

## Testing

**Unit** — `discord-move-planner.test.js` in `BoardGame/dev/tests/`, matching the existing
`node:test` + `node:assert` style. Covers side→channel mapping, unlinked exclusion,
mixed-roster sides, the challenge pseudo-slot, and both staleness checks.

**Handler integration** — the command handler takes `db`, `rest`, and `sleep` as injected
dependencies, so its whole flow is tested against plain in-memory fakes: disabled kill
switch, staleness and `force`, the `not_in_voice` retry schedule, terminal errors not being
retried, and 429 backoff. A fake `sleep` runs the two-minute retry window in microseconds.

No Firestore emulator. The only untested code is `firestore-adapter.js`, whose methods are
one-liners over the Admin SDK — an emulator would add a heavyweight dependency to cover
almost nothing, and the manual smoke test exercises the real thing anyway.

**Manual smoke** — a throwaway test guild with two alt accounts, before it touches a real
event.

## Risks / open questions

- **Panel is god-only by choice.** An admin who spots a bad link mid-event needs a god to fix
  it or to flip the kill switch. Accepted: this is a nice-to-have feature, not load-bearing.
- **Both automatic triggers fire from admin.html client code.** No admin page open means no
  moves. Acceptable given someone always drives the event, but it is a real property.
- **Players not in voice cannot be pulled** (see Constraints). Expect a nonzero count every
  round.
- **A confirmed link can still be wrong** if the human confirming clicks through a bad
  suggestion. The confirmation step reduces this to human error on a reviewed list rather
  than silent runtime guessing, but does not eliminate it.
- **Cold starts** add 1–3s to the first move of an event. Harmless here — the retry schedule
  absorbs it.

## Success criteria

- Every roster player is either confirmed-linked or visibly unlinked before Match 1.
- Lobby opens → linked players in voice are in their side's channel without touching Discord.
- Result confirmed → those players are back in Waiting Room.
- Every move, and every failure to move, is recorded in `discordCommands` and readable after
  the event.
- A god can stop all moves from the web UI, and no move happens while stopped.
