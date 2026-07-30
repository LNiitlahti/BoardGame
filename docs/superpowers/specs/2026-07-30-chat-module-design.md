# Chat Module — Wiring & Security

## Context

`BoardGame/shared/scripts/chat-module.js` was added as a first draft of a
floating tournament/team chat widget (a `ChatModule` class with a FAB button,
a slide-up panel, and Firestore-backed real-time messaging). It was written
speculatively and has never been loaded by any page, has no Firestore
security rules, and uses a Firestore schema (`games/{gameId}/...`) that does
not match the app's actual schema (`tournaments/{tournamentId}/...`, per
`firestore.rules` and every other module in the codebase).

This spec fixes the schema mismatch, adds the missing security rules, and
wires the module into four pages so it's actually usable.

**Note on `gameId` terminology:** the codebase has two unrelated existing uses
of "gameId" — (1) a legacy URL-param alias for a tournament id, still honored
as a fallback (e.g. `team-controls.js`: `urlParams.get('tournamentId') ||
urlParams.get('gameId')`), never primary; and (2) the board-game-catalog id
(`cs2`, `cod`, etc. — which game a match is playing), a fully separate and
still-active concept via `GAMES_CONFIG`. `chat-module.js`'s `gameId` field
was neither — it was the module author using the name by loose analogy while
pointing at a Firestore collection (`games`) that doesn't exist. The rename to
`tournamentId` below fixes that mistake; it does not touch either of the two
existing `gameId` usages elsewhere in the app.

## Data model

Two new subcollections under the existing `tournaments/{tournamentId}` document:

- `tournaments/{tournamentId}/chatTournament/{messageId}` — one shared room
  visible to everyone in the tournament (admins, god, all players, and
  read-only for anonymous/spectator sessions).
- `tournaments/{tournamentId}/chatTeams/{teamId}/messages/{messageId}` — a
  private room per team, visible/writable only to that team's players plus
  admins/god.

Message document shape (both rooms):

```js
{
  text: string,          // trimmed, max 500 chars
  senderId: string,      // must equal request.auth.uid
  senderName: string,    // display name/email at send time, not re-validated
  createdAt: Timestamp,  // server timestamp, must equal request.time
  teamId?: string        // only present on chatTeams messages, must equal the room's teamId
}
```

Messages are immutable — no update or delete once created (matches every
other log-like collection in this codebase, e.g. `eventLog`, `actionLog`).

## ChatModule changes (`shared/scripts/chat-module.js`)

- Rename the `gameId` constructor option and all internal references to
  `tournamentId`. Rename `switchGame(newGameId, newTeamId)` to
  `switchTournament(newTournamentId, newTeamId)`. This is a fresh, unused
  file — no backward-compatible alias is needed.
- `_tournamentRoomRef()` / `_teamRoomRef()` read from
  `db.collection('tournaments').doc(this.tournamentId)...` instead of
  `games`.
- Anonymous-user handling: when `this.currentUser.isAnonymous` is true,
  render the input row as a disabled placeholder ("Sign in to chat") instead
  of a working form, and skip attaching the submit handler that would call
  `_sendMessage`. This is a UX nicety — the Firestore rule below is the real
  enforcement.
- No other behavioral changes (FAB/panel/tabs/unread-dot logic stays as-is).

## Firestore rules (`BoardGame/firestore.rules`)

Add one helper alongside the existing `isAuthenticated`/`isAdmin`/`isGod`:

```
function isAnonymous() {
  return request.auth.token.firebase.sign_in_provider == 'anonymous';
}
```

Add two new subcollection matches nested inside the existing
`match /tournaments/{tournamentId} { ... }` block, alongside `eventLog`,
`onboarding`, and `matches`:

```
match /chatTournament/{messageId} {
  allow read: if isAuthenticated();
  allow create: if isAuthenticated() && !isAnonymous()
                && request.resource.data.senderId == request.auth.uid
                && request.resource.data.text is string
                && request.resource.data.text.size() > 0
                && request.resource.data.text.size() <= 500
                && request.resource.data.createdAt == request.time;
  allow update, delete: if false;
}

match /chatTeams/{teamId}/messages/{messageId} {
  allow read: if isAuthenticated()
              && (isAdmin() || getUserData().assignedTeamId == teamId);
  allow create: if isAuthenticated() && !isAnonymous()
                && (isAdmin() || getUserData().assignedTeamId == teamId)
                && request.resource.data.senderId == request.auth.uid
                && request.resource.data.teamId == teamId
                && request.resource.data.text is string
                && request.resource.data.text.size() > 0
                && request.resource.data.text.size() <= 500
                && request.resource.data.createdAt == request.time;
  allow update, delete: if false;
}
```

Update `docs/architecture/firestore-rules.md`'s permission matrix and
tournament-subcollection diagram to include these two new rooms (same
document style as the existing `eventLog`/`onboarding`/`matches` entries).

## Page wiring

`ChatModule` is constructed and mounted once a page knows its
`tournamentId` (and `teamId`, where applicable), following each page's
existing id-resolution convention — no new URL-parsing or localStorage logic
is added to `chat-module.js` itself.

- **admin.html** (`scripts/admin.js`): after `loadTournament(tournamentId)`
  resolves, construct `new ChatModule({ tournamentId })` (no `teamId` — admins
  aren't on a team) and `mount()`. When the admin switches tournaments via
  the existing tournament dropdown, call `chat.switchTournament(newId)`
  instead of re-constructing.
- **god.html** (`scripts/god-app.js`): same pattern as admin.html, hooked
  into `GodApp.loadTournament()`.
- **team.html** (`scripts/team-controls.js`): once both `currentTournamentId`
  and `teamId` are resolved (existing logic already requires both, redirecting
  to normalize the URL if either is missing), construct
  `new ChatModule({ tournamentId, teamId })` and `mount()`. This page shows
  both the Tournament and My Team tabs.
- **home.html**: only mount when the signed-in user has an existing
  assignment (`userProfile.assignedTournamentId` and
  `userProfile.assignedTeamId` both set, per the existing profile-fetch
  logic around line 1102) — a user with no assignment has nothing to chat
  about. Construct the same as team.html when both ids are present.

Each page adds `<script src=".../shared/scripts/chat-module.js"></script>`
(relative path matching that page's existing shared-script includes) after
`firebase-loader.js` and before the page's own init script.

**view.html is explicitly out of scope** — it wasn't selected for this pass.

## Testing

No Firebase emulator is configured in this repo (confirmed by searching for
emulator config), so this cannot be covered by an automated test suite.
Verification is a manual smoke test against the real/dev Firebase project:

1. Sign in as an admin and a team-assigned player in two separate sessions.
   Confirm messages sent in the Tournament room appear live in both.
2. Confirm the player's Team room is only visible/postable from that
   player's session, not from a second team's player.
3. Load view.html or onboarding (anonymous auth) and confirm tournament
   messages are visible but the input is replaced with the disabled
   "Sign in to chat" placeholder, and that a direct Firestore write attempt
   (e.g. via browser console) is rejected by the rules.
4. Deploy rules to a Firebase project (or dry-run via `firebase deploy
   --only firestore:rules --dry-run` if available) before relying on them.
