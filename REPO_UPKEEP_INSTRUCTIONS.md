# Repository Upkeep Instructions

> Rules for maintaining this codebase. Follow these when making changes.
> Last reviewed: February 2026

---

## 1. Architecture Diagrams

Full logic maps live in `BoardGame/docs/architecture/`. **These must stay in sync with the code.**

| When you... | Update this file |
|---|---|
| Change `lightweight/scripts/admin.js` | `docs/architecture/admin-lightweight.md` |
| Change `lightweight/scripts/smart-match-generator.js` | `docs/architecture/smart-match-generator.md` |
| Change `lightweight/scripts/balance-optimizer.js` | `docs/architecture/balance-optimizer.md` |
| Change `shared/scripts/match-suggester.js` | `docs/architecture/match-suggester.md` |
| Change `shared/scripts/games-config.js` | `docs/architecture/games-config.md` |
| Change `shared/scripts/platforms-config.js` | `docs/architecture/platforms-config.md` |
| Change `lightweight/scripts/statistics.js` | `docs/architecture/statistics.md` |
| Change `lightweight/scripts/onboarding.js` | `docs/architecture/onboarding-lightweight.md` |
| Change `shared/scripts/board-renderer.js` | `docs/architecture/board-renderer.md` |
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
- Lightweight app: `BoardGame/lightweight/` (admin, setup, view, statistics, onboarding)
- Full version app: `BoardGame/full/` (app, home, profile, setup, view, team, god + modules/)
- Shared scripts: `BoardGame/shared/scripts/` (firebase, config, board, games-config, etc.)
- Shared CSS: `BoardGame/shared/css/` (brand-theme, navbar, fantasy-mountain-theme, etc.)
- Shared images: `BoardGame/shared/images/` (favicon, game-logos, hexes, backgrounds)
- Lightweight CSS: `BoardGame/lightweight/css/`
- Lightweight scripts: `BoardGame/lightweight/scripts/`
- Full version CSS: `BoardGame/full/css/`
- Full version scripts: `BoardGame/full/scripts/`
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
| 5 teams | `lightweight/scripts/smart-match-generator.js`, `lightweight/scripts/balance-optimizer.js`, `shared/scripts/match-suggester.js` |
| 2 players per team | `lightweight/scripts/smart-match-generator.js`, `lightweight/scripts/balance-optimizer.js`, `shared/scripts/match-suggester.js` |
| 10 players total | ~~`lightweight/scripts/onboarding.js`~~ RESOLVED: now uses dynamic player IDs from team data |
| 10-match rotation cycle | `shared/scripts/match-suggester.js` (ROTATION_PATTERN array) |
| Win rate thresholds (60/40) | `lightweight/scripts/statistics.js` (used 8+ places, not extracted to function) |
| Leaderboard min games (3) | `lightweight/scripts/statistics.js` (winrate leaderboard filter) |

---

## 6. Known Technical Debt

Track these. Fix when touching nearby code:

- [ ] `lightweight/scripts/statistics.js`: Result filter only works when team filter is also set (nested bug)
- [ ] `lightweight/scripts/admin.js`: DOM listeners accumulate on repeated modal opens (no cleanup)
- [ ] `lightweight/scripts/admin.js`: `pendingHexWins` only clears first matching entry per team
- [ ] `lightweight/scripts/statistics.js`: Win rate classification (60/40 thresholds) duplicated in 8+ places
- [ ] `lightweight/scripts/admin.js`: No XSS sanitization on player name input to innerHTML
- [ ] `lightweight/scripts/onboarding.js`: No rate limiting on Firebase writes from rapid checkbox toggles

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
