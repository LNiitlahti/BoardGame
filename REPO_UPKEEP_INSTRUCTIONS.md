# Repository Upkeep Instructions

> Rules for maintaining this codebase. Follow these when making changes.
> Last reviewed: 2026-07-31

---

## 1. Architecture Diagrams

Full logic maps live in `BoardGame/docs/architecture/`. **These must stay in sync with the code.**

| When you... | Update this file |
|---|---|
| Change `shared/scripts/smart-match-generator.js` | `docs/architecture/smart-match-generator.md` |
| Change `shared/scripts/balance-optimizer.js` | `docs/architecture/balance-optimizer.md` |
| Change `shared/scripts/match-suggester.js` | `docs/architecture/match-suggester.md` |
| Change `shared/scripts/games-config.js` | `docs/architecture/games-config.md` |
| Change `shared/scripts/platforms-config.js` | `docs/architecture/platforms-config.md` |
| Change `shared/scripts/board-renderer.js` | `docs/architecture/board-renderer.md` |
| Change `full/scripts/god-app.js` or any God module | `docs/architecture/god-modules.md` |
| Change `full/scripts/replay-engine.js`, `summary-generator.js`, or `action-export.js` | `docs/architecture/replay-analytics.md` |
| Change how files interact with each other | `docs/architecture/cross-system.md` |
| Add a new JS file | Create a new `.md` in `docs/architecture/` and add it to `index.md` |

Only update diagrams that are actually affected by the code change. No need to touch all of them.

---

## 2. Coding Patterns

Follow existing patterns. Don't introduce new ones without reason.

### CSS
- Use CSS variables: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--border-color`, `--text-primary/secondary/tertiary`, `--accent-primary`, `--accent-danger`
- Modals: `.modal-overlay` + `.modal-content` with `.active` class toggle
- Buttons: `.btn primary/secondary/danger` or `.btn-small primary/secondary/danger`

### JavaScript
- Game name resolution always follows the fallback chain: `gameState.gameDefinitions` -> `GAMES_CONFIG` -> `GAME_NAME_MAP` -> raw ID
- Team/player ID lookups use `String(t.id) === String(teamId)` coercion (IDs can be number or string)
- Player data supports both old format (`matchTeam.players[]`) and new format (`matchTeam.playerIds[]`) — keep both paths working
- Challenge matches are excluded from rotation counting everywhere: `.filter(m => !m.isChallenge)`
- Firebase saves use `tournamentRef.set(cleanData, { merge: true })` — always merge, never overwrite

### New functions
- Add guard clauses at the top (validate inputs, return early)
- Use fallback chains for data lookups (never assume a field exists)
- If adding a game-related lookup, go through `GAMES_CONFIG` methods, not raw data

---

## 3. File Organization

### Where things go
- Auth/hub pages: `BoardGame/` root (index.html, login.html, development-landing-page.html, rulebook.html)
- The game: `BoardGame/full/` (app, home, profile, setup, view, team, god + modules/) — the only version, `lightweight/` was retired and deleted 2026-07-31
- Shared scripts: `BoardGame/shared/scripts/` (firebase, config, board, games-config, etc.)
- Shared CSS: `BoardGame/shared/css/` (brand-theme, navbar, fantasy-mountain-theme, etc.)
- Shared images: `BoardGame/shared/images/` (favicon, game-logos, hexes, backgrounds)
- CSS: `BoardGame/full/css/`
- Scripts: `BoardGame/full/scripts/`
- Dev/test pages: `BoardGame/dev/`
- Utility tools: `BoardGame/tools/`
- Architecture diagrams: `BoardGame/docs/architecture/`
- Guides & references: `BoardGame/docs/guides/`
- Dev notes & tracking: `BoardGame/docs/notes/`

### Path resolution
- Shared scripts use `window.BOARDGAME_BASE` for dynamic paths (images, redirects)
- Root pages set `BOARDGAME_BASE = '.'`, subdirectory pages set `BOARDGAME_BASE = '..'`
- Add `<script>window.BOARDGAME_BASE = '.';</script>` before loading shared scripts

---

## 4. Firebase & Data

- Never commit `shared/scripts/firebase.js` (contains API keys) — use `shared/scripts/firebase.example.js` as template
- The `.gitignore` files handle this, but double-check before committing
- `gameState` is the single source of truth — mutate it locally then `saveGameState()` to sync
- All pages use real-time Firestore listeners — changes propagate automatically
- Event logging is fire-and-forget (failures are silent, don't break the UI)

---

## 5. Hardcoded Constraints

These are baked into multiple files. Changing them requires updates across the codebase:

| Constraint | Where it's hardcoded |
|---|---|
| 5 teams | `shared/scripts/smart-match-generator.js`, `shared/scripts/balance-optimizer.js`, `shared/scripts/match-suggester.js` |
| 2 players per team | `shared/scripts/smart-match-generator.js`, `shared/scripts/balance-optimizer.js`, `shared/scripts/match-suggester.js` |
| 10 players total | ~~`full/scripts/onboarding.js`~~ RESOLVED: now uses dynamic player IDs from team data |
| 10-match rotation cycle | `shared/scripts/match-suggester.js` (ROTATION_PATTERN array) |
| Win rate thresholds (60/40) | `full/scripts/statistics.js` (used 11 places, not extracted to function) |
| Leaderboard min games (3) | `full/scripts/statistics.js` (winrate leaderboard filter) |

---

## 6. Known Technical Debt

Track these. Fix when touching nearby code:

- [ ] `full/scripts/statistics.js`: Result filter only works when team filter is also set (nested bug)
- [x] `full/scripts/admin.js`: DOM listeners accumulate on repeated modal opens (no cleanup) — fixed
- [ ] `full/scripts/admin.js`: `pendingHexWins` only clears first matching entry per team
- [ ] `full/scripts/statistics.js`: Win rate classification (60/40 thresholds) duplicated in 11 places
- [ ] `full/scripts/admin.js`: No XSS sanitization on player name input to innerHTML
- [x] `full/scripts/onboarding.js`: No rate limiting on Firebase writes from rapid checkbox toggles — fixed for onboarding (500ms debounce), not yet extended to chat/ready-check/rename

---

## 7. README & Documentation

- `README.md` at repo root — update the project structure section when adding/removing files
- `.plan/` directory is gitignored — it's for local planning docs only
- `BoardGame/docs/architecture/index.md` — update the file table when adding new architecture docs
- Dates in docs — update "Last Updated" when making significant changes

---

## 8. Before Committing

1. Check `git status` — make sure no firebase credentials or `.env` files are staged
2. If you changed JS logic, check if the matching architecture diagram needs updating
3. If you added a new file, check if `README.md` project structure needs updating
4. Don't commit editor/tool config directories (already in `.gitignore`)
