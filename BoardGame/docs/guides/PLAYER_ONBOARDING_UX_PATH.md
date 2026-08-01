# Player Onboarding — Real UI Path (verified by automated walkthrough)

Captured by driving the actual production app (not reading code) via Puppeteer against `login.html` and `full/home.html`. Useful as the source for a player-facing "how to join" manual.

## For the God/Admin: generating an invite

1. Log in at `login.html` with a God or Admin account.
2. You land on `full/home.html`.
3. Find the **"🎫 Referral Codes"** card. Click **"Generate Code"**.
4. An 8-character code (e.g. `H39GLZJX`) is created, shown in a success toast, and auto-copied to your clipboard.
5. Click **"View All"** to see every code's status (used/unused, who used it) if you need to resend one or check usage.
6. Share the code with the player directly, or use the "copy referral URL" action to give them a pre-filled link (`login.html?referralCode=CODE`).

Each code is single-use — once a player registers with it, it's marked used and cannot register a second account.

## For the Player: registering an account

1. Open `login.html`.
2. Click **"Register here"**.
3. Fill in: First Name, Last Name, Email, Password (6+ characters), Referral Code.
4. Click **"Create Account"**.
5. On success: "Registration successful! Redirecting..." then automatic redirect to `full/home.html`, now signed in.
6. The account has no role and no team yet — that's expected. An admin assigns the team next (see `TOURNAMENT_DRY_RUN_SCRIPT.md` Stage 3).

### What used to go wrong here (fixed 2026-08-01)
Two real, reproducible bugs existed in this exact flow and have been fixed and re-verified (including under simulated slow venue wifi):
1. The account could be created in Firebase Auth while the matching Firestore profile silently failed to save — the player would see "success" but be invisible to admin's team-assignment screen. Root cause: the app's own login-redirect fired before the registration writes had finished and aborted them. Fixed in `login.html` by making the redirect explicit and only firing after all registration writes complete.
2. On a slow connection, clicking "Create Account" before the page finished loading could silently reload the page and discard everything typed, with no error shown. Fixed by disabling both submit buttons until Firebase has actually finished initializing.

## Known dead-end (not yet fixed, flag to players verbally)
If a player's registration fails partway (e.g. genuinely offline), their email is already consumed in Firebase Auth even though no profile exists — retrying registration with the same email will say "already in use" with no self-serve recovery. If this happens at the LAN, an admin needs to either delete the orphaned Auth account (Firebase Console → Authentication) or use a different email/alias for that player.

## For the Admin/God: creating a tournament with teams

There are **two different "create tournament" entry points** in the app — worth knowing which to use:

- **`god.html` → Tournaments tab → "+ Create New Tournament"**: a bare quick-create (just asks for a name via a prompt popup). Produces a tournament with **no teams, no games, no rooms**. There is currently no UI anywhere to add a team to a tournament afterward — teams can only be created through the wizard below. Treat this quick-create as effectively unfinished/not useful for a real event; if you want a placeholder tournament to test with, use it, but don't use it to run a real event.
- **`full/setup.html`** (linked from home.html's "🎮 New Game" button): the real multi-step wizard — Select Games → Create Teams (min. 3, both player names required) → Room Hexes → Spell Cards → Summary/Launch. This is the flow that actually produces a usable tournament with a full roster, board, and pre-generated match schedule. **This is the one to use for the real event.**

Note the wizard's UI is partly in Finnish (e.g. "Luo Tiimit" = Create Teams, "Lisää Tiimi" = Add Team, "Seuraava"/"Edellinen" = Next/Previous) — worth a heads-up for admins if they haven't seen it before.

## For the Admin/God: assigning a real player account to a team

Location: `god.html` → **Teams tab** ("Player Assignment" panel).

1. Left column ("Available Users") lists every registered-but-unassigned account. Click one to select it (highlighted green).
2. Right column shows each team's roster. Team setup pre-fills two named placeholder slots per team ("Player A"/"Player B" with orange "Placeholder" tags).
3. With a user selected, each placeholder slot shows a **"Link [name]"** button — click it to bind that real account to that named slot. This preserves match history/points tied to the slot; the player's name in the roster updates to the account's display name.
4. If a team genuinely has an empty slot (fewer than 2 players), an **"Assign [name]"** button appears instead, adding them fresh rather than replacing a placeholder.
5. Verified: attempting to link an already-assigned user to a second team's slot is silently blocked (button logic + the function's internal check) — it does not throw an error, it just no-ops, so don't rely on an error message to confirm nothing happened; check the roster.
6. Verified end-to-end: linking updates both `users/{uid}` (assignedTeamId, assignedTeamName, assignedTournamentId) and the tournament's team roster in one batched write, and the player sees "You've been added to Team {N}! Start onboarding to get set up." on their own device on next load — no manual refresh needed. The public `view.html` board reflects the correct team roster immediately too.

---
*Match/phase-flow UI paths (admin.html's guided round flow, match queue, scoring) are not yet walked and documented here — next candidate for a follow-up pass.*
