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

`.env.e2e` currently holds one TD/god-admin account
(`lniitlahti+demoadmin@gmail.com`). Player test accounts (`PLAYER1_*`/`PLAYER2_*`)
are intentionally blank — per-task scripts create disposable player accounts
programmatically rather than relying on pre-existing ones.

## Test tournament

No shared scratch tournament is reused across tasks (decided 2026-08-02): each
task that needs one creates its own fresh disposable tournament via script and
records the ID in that task's script/commit, rather than writing to
`cl32-smoke-test` or `fast-test-2`.
