# Theme Unification & Navbar Tournament Switcher — Design

## Background

An audit of the three experience tiers (regular user, admin, god) found:

- **No consistent theme.** Pages mix `fantasy-mountain-theme.css`, `brand-theme.css`, and a third unrelated `dark-theme.css` system (`full/setup.html`, `full/replay.html`). `shared/css/void-gold-theme.css` — despite living in `shared/` — is currently only linked from `full/god.html`.
- `void-gold-theme.css`'s own header states it is a variable-override layer designed to match `lightweight/css/admin.css`'s "Dark Void / Gold Accent" palette. `full/home.html`'s inline `<style>` independently hardcodes the same gold (`#c8b37e`) / dark (`#050710`-ish) palette. So the app already converges on one intended look; it just isn't consistently wired up.
- A unified navbar (`shared/scripts/navbar.js`) exists and is used by 9 pages. It renders the current tournament as a static, non-interactive `<span id="navTournamentLabel">`.
- Tournament switching is fragmented: 4+ independent `<select id="tournamentSelect">` dropdowns (`full/admin.html`, `lightweight/admin.html`, `lightweight/admin_old.html`, `lightweight/statistics.html`), each with its own `onTournamentSelect` handler, plus a dual "Select Active"/"View" card-picker on `full/home.html`, plus the read-only navbar label. No single switcher component exists.
- Roles are God > Admin > Player > User, derived from Firestore `users/{uid}` flags (`isGod`, `isAdmin`, `isPlayer`), duplicated in ~3 places.
- Some likely-orphaned files: `full/scripts/navbar.js` (superseded by `shared/scripts/navbar.js`, no page references it) and `lightweight/admin_old.html` (superseded by `lightweight/admin.html`).

## Goals

1. Make every authenticated app page (excluding kiosk/spectator pages and pre-auth pages) visually consistent under one theme.
2. Give admin/god users a single way to switch tournaments — click the tournament name in the navbar — and remove the scattered per-page selectors.
3. Clean up confirmed-dead files along the way.

## Out of scope

- Kiosk/spectator pages (`full/view.html`, `full/replay.html`, `lightweight/view.html`, `lightweight/onboarding*.html`, `lightweight/view-onboarding*.html`): left navbar-free and untouched, by design (public display screens shouldn't show admin chrome).
- Pre-auth pages (`login.html`, `index.html`): keep their separate `auth-modern.css` system.
- Any deeper reconciliation of `full/` vs `lightweight/` parallel implementations beyond what's listed here (e.g. the `full/admin.html` vs `lightweight/admin.html` near-duplication) — noted as a follow-up candidate, not tackled now.
- Firestore security rules / server-side role enforcement — audit found role gating is client-side only today; unchanged by this work.

## 1. Theme unification

`void-gold-theme.css` becomes the canonical override, loaded last (after `brand-theme.css` / `fantasy-mountain-theme.css`) on every in-scope page:

- Add the missing `<link rel="stylesheet" href=".../shared/css/void-gold-theme.css">` to: `full/admin.html`, `full/team.html`, `full/profile.html`, `full/home.html`, `full/setup.html`, `lightweight/admin.html`, `lightweight/statistics.html`, `development-landing-page.html`.
- `full/setup.html` currently loads `dark-theme.css` (a different, unrelated theme system) — replace with the standard `brand-theme.css` + `fantasy-mountain-theme.css` + `void-gold-theme.css` stack used elsewhere.
- `full/home.html`'s inline `<style>` block already hand-codes the void-gold palette (`#c8b37e` gold, `#050710` dark background) — no rewrite needed, just add the stylesheet link so shared components (buttons, badges, panels) sourced from `brand-theme.css`/`fantasy-mountain-theme.css` variables resolve to the same palette as the rest of the page.
- `full/replay.html` keeps `dark-theme.css` (out of scope, kiosk page).

## 2. Navbar tournament switcher

Extends `shared/scripts/navbar.js`. Behavior branches by role:

**Admin/god:**
- `#navTournamentLabel` becomes a clickable control (cursor pointer, hover affordance, small chevron) instead of a plain `<span>`.
- Click opens a dropdown panel anchored below the label:
  - Search input at top; filters the list client-side as the admin/god types (case-insensitive substring match on tournament name).
  - Filtered list of tournaments, sourced from the same Firestore `tournaments` collection query `full/home.html` already uses. Each row shows tournament name + status badge (active/upcoming/completed — reuse `home.html`'s existing status logic).
  - A "+ Create new tournament" row, pinned at the bottom of the list regardless of the search filter, navigating to `full/setup.html`.
- Selecting a tournament row:
  1. Writes `currentTournamentId` / `currentTournamentName` to both `localStorage` and `sessionStorage` (the existing storage contract other pages already read).
  2. If the current page's URL carries a tournament param (`tournament`, `tournamentId`, `gameId`, or `game`), updates it to match.
  3. Calls `location.reload()`.
- Click-outside or Escape closes the dropdown without changes.
- `full/god.html` gets this same switcher — it currently has no visible/clickable tournament-name element at all (only a URL param), so this is new functionality there, not a replacement.

**Regular user/player:**
- `#navTournamentLabel` stays exactly as today: plain, non-interactive text. No dropdown, no click handler attached.

## 3. Removal & cleanup

- Remove `<select id="tournamentSelect">` and its associated `onTournamentSelect`/init JS from `full/admin.html`, `lightweight/admin.html`, `lightweight/statistics.html`. These pages read tournament context from the shared storage contract instead (same mechanism other consumer pages already use).
- `full/home.html`'s tournament cards drop their dual "Select Active" / "View" actions in favor of one "Enter" action per card, which performs the same set-storage-and-navigate logic as the navbar dropdown's row-select (just reused from the card grid instead of the navbar). Cards remain useful as a browse/overview list; they're no longer a separate "set active" toggle.
- Delete `lightweight/admin_old.html`, after confirming no page links to it.
- Delete `full/scripts/navbar.js` (orphaned, unreferenced by any page today), after re-confirming via grep that nothing loads it.

## Testing notes

- Manual verification across at least one page per role (god.html for god, full/admin.html for admin, full/team.html or full/profile.html for regular user) that the navbar label is clickable only where intended.
- Verify switching tournament via the new dropdown correctly reloads the page with the new context on at least: full/admin.html, full/god.html, lightweight/statistics.html.
- Verify deleted files have zero remaining references (grep) before removal.
