# E2E Puppeteer harness

Reusable login + navigation helpers for testing tournament-flow bugs against the
real production Firebase project (`boardgame-7b9f0` — there is no staging/emulator).
Built once here; don't recreate it in future sessions, just reuse these files.

## Files

- `e2e-server.js` — static file server (`startServer(rootDir, port)`), serves the
  `BoardGame/` directory so pages can be loaded via `http://localhost:8080/...`.
- `e2e-harness.js` — `login(page, baseUrl, email, password)`,
  `newLoggedInPage(browser, baseUrl, email, password)`,
  `gotoTournamentPage(page, baseUrl, pageName, tournamentId, extraParams)`.
- `e2e-smoke.js` — minimal script proving login works end-to-end; run it any time
  to sanity-check the harness still works (e.g. after a login.html change).
- `e2e-create-players.js` — creates N disposable player accounts (auth user +
  `users/{uid}` doc), bypassing the referral-code-gated signup UI. Each account
  runs in its own isolated browser context so it never disturbs an
  already-logged-in TD session in another tab. Usage:
  `node dev/tests/e2e-create-players.js Name1 Name2 ...` — prints
  email/password/uid for each; add them to `.env.e2e` yourself.
- `e2e-inspect-tournament.js` / `e2e-inspect-user.js` — quick read-only Firestore
  dumps (tournament team/player registry; a single user doc by email) for
  debugging test state without opening the app UI by hand.
- `.env.e2e` (gitignored, not in git) — real credentials. Copy `.env.e2e.example`
  to create it if missing.

## One-time local setup (per machine/checkout)

The harness needs two gitignored files that are NOT tracked by git and won't be
present in a fresh worktree/clone:

1. `BoardGame/shared/scripts/firebase.js` — Firebase config (API keys). Copy it
   from an existing checkout; without it the app never leaves the
   "Authenticating..." screen.
2. `BoardGame/dev/tests/.env.e2e` — credentials, see below.
3. `npm install` inside `BoardGame/dev/` (installs `puppeteer` + `dotenv` into
   `BoardGame/dev/node_modules/`, also gitignored).

## Running

```bash
cd BoardGame
node dev/tests/e2e-smoke.js
```

Kills needed: if a previous run's static server didn't shut down cleanly, port
8080 may still be bound — check with `netstat -ano | findstr :8080` and stop the
stale process before rerunning.

## Credentials

`.env.e2e` currently holds one TD/god-admin account (see the repo owner for the
address — not written here since this file is committed to git). Player test
accounts (`PLAYER1_*`/`PLAYER2_*`) are intentionally blank — per-task scripts
create disposable player accounts programmatically rather than relying on
pre-existing ones.

## Test tournament

No shared scratch tournament is reused across tasks (decided 2026-08-02): each
task that needs one creates its own fresh disposable tournament via script and
records the ID in that task's script/commit, rather than writing to
`cl32-smoke-test` or `fast-test-2`. `e2e-disposable-1` was created for Task 1
and is safe for later tasks to keep reusing/mutating.

## Hard-won gotchas (read before writing a new script)

- **Don't use `networkidle0` for tournament pages.** god/admin/team/view all
  open persistent Firestore realtime-listener connections that never let the
  network go idle — `page.goto(..., {waitUntil: 'networkidle0'})` can hang or
  resolve inconsistently. Use `domcontentloaded` + an explicit
  `page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB)`
  instead (`gotoTournamentPage` and `login` in `e2e-harness.js` already do this
  — use them, don't hand-roll `page.goto`).
- **A roster swap permanently burns the incoming user's uid in that
  tournament's player registry**, even after they're later swapped back out
  (protects completed-match history from ever pointing at a reused id).
  `replacePlayerWithUser` checks "is this uid anywhere in `gameState.players`"
  and refuses with "User is already assigned in this tournament" if so — it
  does NOT check team assignment, just registry presence. Any repro that
  measures N separate swap operations needs N never-before-used disposable
  accounts (`e2e-create-players.js`), not 2 accounts toggled back and forth.
- **god.html's `showStatus()` delegates to `shared/scripts/toast.js`'s
  `showToast()`** (since god.html loads toast.js) — `#statusMessage` is never
  touched on that page. Wait for `.toast-container .toast-content` text, not
  `#statusMessage`, when asserting a god.html action's result.
