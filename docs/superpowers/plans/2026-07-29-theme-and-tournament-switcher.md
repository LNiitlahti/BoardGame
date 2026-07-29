# Theme Unification & Navbar Tournament Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the app's visual theme onto `void-gold-theme.css` across all authenticated pages, and replace every scattered per-page tournament `<select>` with a single searchable dropdown built into the shared navbar's tournament-name label, available to admin/god roles only.

**Architecture:** This is a static HTML/JS/Firebase app with no build step and no automated test runner (a Puppeteer dependency exists in `BoardGame/package.json` but is not wired to any test suite). Verification in this plan is therefore manual: open each page in a browser via a local static server and check the described behavior, in place of automated tests.

**Tech Stack:** Vanilla JS, Firebase Firestore (compat SDK), plain CSS (no preprocessor/bundler).

**Spec:** `docs/superpowers/specs/2026-07-29-theme-and-tournament-switcher-design.md`

---

## Task 1: Roll out `void-gold-theme.css` to all in-scope pages

**Files:**
- Modify: `BoardGame/full/admin.html:49-53`
- Modify: `BoardGame/full/team.html:27-29`
- Modify: `BoardGame/full/profile.html:21-22`
- Modify: `BoardGame/full/home.html:22-23`
- Modify: `BoardGame/full/setup.html:22-27`, `:1294`
- Modify: `BoardGame/lightweight/admin.html:49-52`
- Modify: `BoardGame/lightweight/statistics.html` (stylesheet block, currently missing `void-gold-theme.css`)
- Modify: `BoardGame/development-landing-page.html:18-20`

- [ ] **Step 1: Add `void-gold-theme.css` to `full/admin.html`**

Current (lines 48-53):
```html
    <!-- CSS: navbar base → fantasy atmosphere → toast → v2 admin (final authority) -->
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/toast.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="../lightweight/css/admin.css">
    <link rel="stylesheet" href="css/phase-indicator.css">
```

Replace with:
```html
    <!-- CSS: navbar base → fantasy atmosphere → toast → void/gold overrides → v2 admin (final authority) -->
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/toast.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
    <link rel="stylesheet" href="../lightweight/css/admin.css">
    <link rel="stylesheet" href="css/phase-indicator.css">
```

- [ ] **Step 2: Add `void-gold-theme.css` to `lightweight/admin.html`**

Current (lines 49-52):
```html
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/toast.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="css/admin.css">
```

Replace with:
```html
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/toast.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
    <link rel="stylesheet" href="css/admin.css">
```

- [ ] **Step 3: Add `void-gold-theme.css` to `full/team.html`**

Current (lines 27-29):
```html
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="css/team-modern.css">
```

Replace with:
```html
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
    <link rel="stylesheet" href="css/team-modern.css">
```

- [ ] **Step 4: Add `void-gold-theme.css` to `full/profile.html`**

Current (lines 21-22):
```html
  <link rel="stylesheet" href="../shared/css/navbar.css">
```

Replace with:
```html
  <link rel="stylesheet" href="../shared/css/navbar.css">
  <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
```

- [ ] **Step 5: Add `void-gold-theme.css` to `full/home.html`**

Current (line 23):
```html
  <link rel="stylesheet" href="../shared/css/navbar.css">
```

Replace with:
```html
  <link rel="stylesheet" href="../shared/css/navbar.css">
  <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
```

- [ ] **Step 6: Add `void-gold-theme.css` to `development-landing-page.html`**

Current (lines 18-20):
```html
    <link rel="stylesheet" href="shared/css/brand-theme.css">
    <link rel="stylesheet" href="shared/css/navbar.css">
    <link rel="stylesheet" href="shared/css/fantasy-mountain-theme.css">
```

Replace with:
```html
    <link rel="stylesheet" href="shared/css/brand-theme.css">
    <link rel="stylesheet" href="shared/css/navbar.css">
    <link rel="stylesheet" href="shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="shared/css/void-gold-theme.css">
```

- [ ] **Step 7: Add `void-gold-theme.css` to `lightweight/statistics.html`**

Read the current stylesheet block first:

Run: `grep -n "stylesheet" "BoardGame/lightweight/statistics.html"`

It currently loads `brand-theme.css`, `navbar.css`, `toast.css`, and `css/statistics.css` (no `fantasy-mountain-theme.css`, no `void-gold-theme.css`). Add `void-gold-theme.css` immediately after `brand-theme.css` and before `css/statistics.css`, e.g.:
```html
    <link rel="stylesheet" href="../shared/css/brand-theme.css">
    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/toast.css">
    <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
    <link rel="stylesheet" href="css/statistics.css">
```
(Match against the exact existing line order found by the grep above — insert `void-gold-theme.css` right before the page-specific `css/statistics.css` line, keep every other line unchanged.)

- [ ] **Step 8: Switch `full/setup.html` off the `dark-theme.css` system**

Current (lines 22-27):
```html
    <link href="https://fonts.googleapis.com/css2?family=Dosis:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet">

    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/theme-toggle-button.css">
    <link rel="stylesheet" href="../shared/css/dark-theme.css">
```

Replace with:
```html
    <link href="https://fonts.googleapis.com/css2?family=Dosis:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet">

    <link rel="stylesheet" href="../shared/css/navbar.css">
    <link rel="stylesheet" href="../shared/css/brand-theme.css">
    <link rel="stylesheet" href="../shared/css/fantasy-mountain-theme.css">
    <link rel="stylesheet" href="../shared/css/void-gold-theme.css">
```

- [ ] **Step 9: Remove the now-orphaned theme-toggle script tag from `full/setup.html`**

The `theme-toggle-button.css`/`theme-toggle.js` pair implements a light/dark toggle that only makes sense with `dark-theme.css`'s variable system, which Step 8 just removed. Since no other in-scope page has this toggle, remove it here too for consistency.

Current (line 1294, exact line number may shift slightly after Step 8 — locate via grep):

Run: `grep -n "theme-toggle" "BoardGame/full/setup.html"`

Delete the matching line:
```html
    <script src="../shared/scripts/theme-toggle.js"></script>
```

- [ ] **Step 10: Manually verify the theme rollout**

Serve the app locally (e.g. `npx serve BoardGame` or any static file server) and open each of these pages in a browser, confirming: no visibly broken/unstyled elements, no console errors about missing stylesheets, and the gold/dark palette (`#c8b37e` gold accents on a near-black background) is visually present:
- `full/admin.html`
- `full/team.html`
- `full/profile.html`
- `full/home.html`
- `full/setup.html`
- `lightweight/admin.html`
- `lightweight/statistics.html`
- `development-landing-page.html`

- [ ] **Step 11: Commit**

```bash
git add BoardGame/full/admin.html BoardGame/full/team.html BoardGame/full/profile.html BoardGame/full/home.html BoardGame/full/setup.html BoardGame/lightweight/admin.html BoardGame/lightweight/statistics.html BoardGame/development-landing-page.html
git commit -m "Roll out void-gold-theme.css to all in-scope pages"
```

---

## Task 2: Build the navbar tournament switcher dropdown

**Files:**
- Modify: `BoardGame/shared/scripts/navbar.js:142-212` (add switcher markup + wiring)
- Modify: `BoardGame/shared/css/navbar.css` (append switcher styles)

- [ ] **Step 1: Replace the tournament-context block in `createNavbarHTML`**

In `BoardGame/shared/scripts/navbar.js`, current (lines 164-170):
```js
        // Active tournament context
        const tournamentName = sessionStorage.getItem('currentTournamentName') || localStorage.getItem('currentTournamentName');
        const tournamentId = sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId');
        const hasTournament = tournamentId && tournamentName;
        const tournamentCtxHTML = hasTournament
            ? `<span class="navbar-tournament-name" id="navTournamentLabel" title="${tournamentName}">${tournamentName}</span>`
            : `<span class="navbar-tournament-name empty" id="navTournamentLabel" title="No tournament selected">No tournament</span>`;
```

Replace with:
```js
        // Active tournament context
        const tournamentName = sessionStorage.getItem('currentTournamentName') || localStorage.getItem('currentTournamentName');
        const tournamentId = sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId');
        const hasTournament = tournamentId && tournamentName;
        const canSwitch = hasRoleLevel(userRole, 'admin');
        const labelText = hasTournament ? tournamentName : 'No tournament';
        const labelTitle = hasTournament ? tournamentName : 'No tournament selected';

        const tournamentCtxHTML = canSwitch
            ? `
                <div class="navbar-tournament-switcher" id="navTournamentSwitcher">
                    <button type="button" class="navbar-tournament-name clickable ${hasTournament ? '' : 'empty'}" id="navTournamentLabel" title="${labelTitle}">
                        <span class="navbar-tournament-name-text">${labelText}</span>
                        <span class="navbar-tournament-chevron">&#9662;</span>
                    </button>
                    <div class="navbar-tournament-dropdown" id="navTournamentDropdown" hidden>
                        <input type="text" class="navbar-tournament-search" id="navTournamentSearch" placeholder="Search tournaments...">
                        <div class="navbar-tournament-list" id="navTournamentList"><div class="navbar-tournament-list-empty">Loading...</div></div>
                        <button type="button" class="navbar-tournament-create" id="navTournamentCreate">+ Create new tournament</button>
                    </div>
                </div>
              `
            : `<span class="navbar-tournament-name ${hasTournament ? '' : 'empty'}" id="navTournamentLabel" title="${labelTitle}">${labelText}</span>`;
```

- [ ] **Step 2: Add the switcher logic functions**

Still in `BoardGame/shared/scripts/navbar.js`, add these functions directly above the `/** * Insert navbar HTML into the page */` comment (i.e. right before `function insertNavbar(html) {` at line 217 in the current file):

```js
    /**
     * Tournament switcher state
     */
    let tournamentListCache = null;
    let tournamentListFetchedAt = 0;
    const TOURNAMENT_LIST_TTL_MS = 60000;
    let documentSwitcherListenersAttached = false;

    function getUrlTournamentParamName() {
        const params = new URLSearchParams(window.location.search);
        if (params.has('tournament')) return 'tournament';
        if (params.has('gameId')) return 'gameId';
        if (params.has('game')) return 'game';
        return 'tournamentId';
    }

    async function fetchTournamentList(forceRefresh) {
        const now = Date.now();
        if (!forceRefresh && tournamentListCache && (now - tournamentListFetchedAt) < TOURNAMENT_LIST_TTL_MS) {
            return tournamentListCache;
        }
        const db = firebase.firestore();
        const snapshot = await db.collection('tournaments').get();
        tournamentListCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        tournamentListFetchedAt = now;
        return tournamentListCache;
    }

    function renderTournamentDropdownList(tournaments, filterText) {
        const listEl = document.getElementById('navTournamentList');
        if (!listEl) return;

        const filtered = filterText
            ? tournaments.filter(t => (t.name || t.id).toLowerCase().includes(filterText.toLowerCase()))
            : tournaments;

        if (filtered.length === 0) {
            listEl.innerHTML = '<div class="navbar-tournament-list-empty">No tournaments found</div>';
            return;
        }

        listEl.innerHTML = filtered.map(t => {
            const status = t.status || 'setup';
            const name = t.name || t.id;
            return `
                <button type="button" class="navbar-tournament-item" data-tournament-id="${t.id}" data-tournament-name="${name.replace(/"/g, '&quot;')}">
                    <span class="navbar-tournament-item-status ${status}"></span>
                    <span class="navbar-tournament-item-name">${name}</span>
                </button>
            `;
        }).join('');
    }

    function closeTournamentDropdown() {
        const dropdown = document.getElementById('navTournamentDropdown');
        if (dropdown) dropdown.hidden = true;
    }

    async function openTournamentDropdown() {
        const dropdown = document.getElementById('navTournamentDropdown');
        if (!dropdown) return;
        dropdown.hidden = false;

        const searchInput = document.getElementById('navTournamentSearch');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }

        try {
            const tournaments = await fetchTournamentList(false);
            renderTournamentDropdownList(tournaments, '');
        } catch (error) {
            console.error('Error loading tournament list for switcher:', error);
            const listEl = document.getElementById('navTournamentList');
            if (listEl) listEl.innerHTML = '<div class="navbar-tournament-list-empty">Error loading tournaments</div>';
        }
    }

    function selectTournament(tournamentId, tournamentName) {
        localStorage.setItem('currentTournamentId', tournamentId);
        sessionStorage.setItem('currentTournamentId', tournamentId);
        localStorage.setItem('currentTournamentName', tournamentName);
        sessionStorage.setItem('currentTournamentName', tournamentName);

        const url = new URL(window.location.href);
        url.searchParams.set(getUrlTournamentParamName(), tournamentId);
        window.location.href = url.toString();
    }

    function wireTournamentSwitcher() {
        const switcherEl = document.getElementById('navTournamentSwitcher');
        if (!switcherEl) return;

        const labelBtn = document.getElementById('navTournamentLabel');
        const searchInput = document.getElementById('navTournamentSearch');
        const listEl = document.getElementById('navTournamentList');
        const createBtn = document.getElementById('navTournamentCreate');

        labelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('navTournamentDropdown');
            if (dropdown.hidden) {
                openTournamentDropdown();
            } else {
                closeTournamentDropdown();
            }
        });

        searchInput.addEventListener('input', () => {
            if (tournamentListCache) {
                renderTournamentDropdownList(tournamentListCache, searchInput.value);
            }
        });

        listEl.addEventListener('click', (e) => {
            const item = e.target.closest('.navbar-tournament-item');
            if (!item) return;
            selectTournament(item.dataset.tournamentId, item.dataset.tournamentName);
        });

        createBtn.addEventListener('click', () => {
            window.location.href = getFullBasePath() + '/setup.html';
        });

        if (!documentSwitcherListenersAttached) {
            documentSwitcherListenersAttached = true;
            document.addEventListener('click', (e) => {
                const el = document.getElementById('navTournamentSwitcher');
                if (el && !el.contains(e.target)) closeTournamentDropdown();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeTournamentDropdown();
            });
        }
    }
```

- [ ] **Step 3: Call `wireTournamentSwitcher()` after every navbar render**

In `insertNavbar`, current (lines 217-226):
```js
    function insertNavbar(html) {
        let container = document.getElementById('navbar-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'navbar-container';
            document.body.insertBefore(container, document.body.firstChild);
        }
        container.innerHTML = html;
        document.body.style.paddingTop = '60px';
    }
```

Replace with:
```js
    function insertNavbar(html) {
        let container = document.getElementById('navbar-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'navbar-container';
            document.body.insertBefore(container, document.body.firstChild);
        }
        container.innerHTML = html;
        document.body.style.paddingTop = '60px';
        wireTournamentSwitcher();
    }
```

(`wireTournamentSwitcher` is defined above `insertNavbar` per Step 2, so this call is valid; `insertNavbar` is the single call site used by both `renderFromCache()` and `renderNavbar()`, so both paths get the switcher wired automatically.)

- [ ] **Step 4: Append switcher styles to `navbar.css`**

Add to the end of `BoardGame/shared/css/navbar.css`:
```css
/* ==================== TOURNAMENT SWITCHER ==================== */
.navbar-tournament-switcher {
    position: relative;
}

.navbar-tournament-name.clickable {
    cursor: pointer;
    background: none;
    border: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    font: inherit;
    color: var(--nav-gold);
}

.navbar-tournament-name.clickable:hover {
    color: var(--nav-gold-bright);
}

.navbar-tournament-chevron {
    font-size: 0.6rem;
    opacity: 0.7;
}

.navbar-tournament-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: 260px;
    background: var(--nav-bg-active);
    border: 1px solid var(--nav-border);
    border-radius: 8px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
    padding: 10px;
    z-index: 1100;
}

.navbar-tournament-search {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 10px;
    margin-bottom: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--nav-border);
    border-radius: 6px;
    color: var(--nav-text);
    font-family: 'Quantico', sans-serif;
    font-size: 0.85rem;
}

.navbar-tournament-list {
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.navbar-tournament-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 7px 8px;
    background: none;
    border: none;
    border-radius: 5px;
    color: var(--nav-text);
    font-family: 'Quantico', sans-serif;
    font-size: 0.85rem;
    cursor: pointer;
}

.navbar-tournament-item:hover {
    background: var(--nav-gold-dim);
}

.navbar-tournament-item-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--nav-text-muted);
    flex-shrink: 0;
}

.navbar-tournament-item-status.playing { background: var(--nav-live); }
.navbar-tournament-item-status.finished { background: #5898cc; }
.navbar-tournament-item-status.archived { background: var(--nav-text-muted); }

.navbar-tournament-list-empty {
    padding: 10px 8px;
    color: var(--nav-text-muted);
    font-size: 0.8rem;
    text-align: center;
}

.navbar-tournament-create {
    width: 100%;
    margin-top: 8px;
    padding: 7px 8px;
    background: var(--nav-gold-dim);
    border: 1px solid var(--nav-border);
    border-radius: 6px;
    color: var(--nav-gold);
    font-family: 'Quantico', sans-serif;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
}

.navbar-tournament-create:hover {
    background: var(--nav-gold-glow);
}
```

- [ ] **Step 5: Manually verify the switcher**

Serve the app locally, log in as a user with `isAdmin: true` or `isGod: true` in their `users/{uid}` Firestore doc, and on any page that shows the navbar (`full/admin.html`, `full/god.html`, `full/home.html`, `full/team.html`, `full/profile.html`, `lightweight/admin.html`, `lightweight/statistics.html`):
- Confirm the tournament name in the navbar now shows a chevron and a pointer cursor on hover.
- Click it — dropdown opens, showing a search box and a list of tournaments with status dots, plus a "+ Create new tournament" row at the bottom.
- Type a partial tournament name into the search box — list filters live.
- Click a tournament row — page reloads with the new tournament's name in the navbar and the URL's tournament param updated.
- Click "+ Create new tournament" — navigates to `setup.html`.
- Click outside the dropdown, and separately press Escape while it's open — both close it without changing the current tournament.
- Log in as a plain user/player (no `isAdmin`/`isGod`) and confirm the tournament name is plain text with no chevron, hover effect, or click behavior.

- [ ] **Step 6: Commit**

```bash
git add BoardGame/shared/scripts/navbar.js BoardGame/shared/css/navbar.css
git commit -m "Add searchable tournament switcher to navbar for admin/god roles"
```

---

## Task 3: Remove the old per-page tournament `<select>` dropdowns

**Files:**
- Modify: `BoardGame/full/admin.html:118-129`
- Modify: `BoardGame/lightweight/admin.html:71-82`
- Modify: `BoardGame/lightweight/scripts/admin.js:309-346` (shared by both admin.html pages)
- Modify: `BoardGame/lightweight/statistics.html:62-77`
- Modify: `BoardGame/lightweight/scripts/statistics.js:39-67, 76-133, 216-218`

- [ ] **Step 1: Remove the `<select>` markup from `full/admin.html`**

Current (lines 118-129):
```html
    <div class="admin-container">
        <!-- Top Bar -->
        <div class="top-bar">
            <!-- Left: Tournament selector -->
            <div class="tournament-selector">
                <label for="tournamentSelect">Tournament</label>
                <select id="tournamentSelect" onchange="onTournamentSelect(this.value)">
                    <option value="">Select a tournament...</option>
                </select>
                <button class="btn-small tournament-state-btn" id="tournamentStateBtn" onclick="openStateChangeModal()" title="Change tournament state">setup</button>
                <button class="btn secondary" onclick="refreshTournaments()">Refresh</button>
            </div>
```

Replace with:
```html
    <div class="admin-container">
        <!-- Top Bar -->
        <div class="top-bar">
            <!-- Left: Tournament state + refresh (switching now happens via the navbar) -->
            <div class="tournament-selector">
                <button class="btn-small tournament-state-btn" id="tournamentStateBtn" onclick="openStateChangeModal()" title="Change tournament state">setup</button>
                <button class="btn secondary" onclick="refreshCurrentTournament()">Refresh</button>
            </div>
```

- [ ] **Step 2: Remove the `<select>` markup from `lightweight/admin.html`**

Current (lines 73-82):
```html
        <div class="top-bar">
            <!-- Left: Tournament selector -->
            <div class="tournament-selector">
                <label for="tournamentSelect">Tournament</label>
                <select id="tournamentSelect" onchange="onTournamentSelect(this.value)">
                    <option value="">Select a tournament...</option>
                </select>
                <button class="btn-small tournament-state-btn" id="tournamentStateBtn" onclick="openStateChangeModal()" title="Change tournament state">setup</button>
                <button class="btn secondary" onclick="refreshTournaments()">Refresh</button>
            </div>
```

Replace with:
```html
        <div class="top-bar">
            <!-- Left: Tournament state + refresh (switching now happens via the navbar) -->
            <div class="tournament-selector">
                <button class="btn-small tournament-state-btn" id="tournamentStateBtn" onclick="openStateChangeModal()" title="Change tournament state">setup</button>
                <button class="btn secondary" onclick="refreshCurrentTournament()">Refresh</button>
            </div>
```

- [ ] **Step 3: Replace list-loading logic in `lightweight/scripts/admin.js` with direct URL/storage-driven loading**

This file is shared by both `full/admin.html` and `lightweight/admin.html` (both load `scripts/admin.js` / `../lightweight/scripts/admin.js`, same file). Current (lines 187-211, the init sequence):
```js
            // Initialize modules
            initializeBoardModules();

            // Monitor Firebase connection status
            initConnectionMonitor();

            // Load tournaments
            await loadTournamentsList();

            // Check URL for tournament ID
            const urlParams = new URLSearchParams(window.location.search);
            const tournamentId = urlParams.get('tournamentId');

            if (tournamentId) {
                document.getElementById('tournamentSelect').value = tournamentId;
                await loadTournament(tournamentId);
            }

            // Hide loading overlay
            document.getElementById('loadingOverlay').classList.add('hidden');

        } catch (error) {
            console.error('Error checking user role:', error);
            showStatus('Error loading user data', 'error');
        }
    });
});
```

Replace with:
```js
            // Initialize modules
            initializeBoardModules();

            // Monitor Firebase connection status
            initConnectionMonitor();

            // Tournament context comes from the navbar switcher: URL param first,
            // falling back to the shared storage contract it maintains.
            const urlParams = new URLSearchParams(window.location.search);
            const tournamentId = urlParams.get('tournamentId') ||
                sessionStorage.getItem('currentTournamentId') ||
                localStorage.getItem('currentTournamentId');

            if (tournamentId) {
                await loadTournament(tournamentId);
            }

            // Hide loading overlay
            document.getElementById('loadingOverlay').classList.add('hidden');

        } catch (error) {
            console.error('Error checking user role:', error);
            showStatus('Error loading user data', 'error');
        }
    });
});
```

- [ ] **Step 4: Replace `loadTournamentsList`/`refreshTournaments`/`onTournamentSelect` with `refreshCurrentTournament`**

Current (lines 305-346 of `lightweight/scripts/admin.js`):
```js
// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

async function loadTournamentsList() {
    try {
        const tournamentsRef = window.firebaseDB.collection('tournaments');
        const snapshot = await tournamentsRef.get();

        const select = document.getElementById('tournamentSelect');
        select.innerHTML = '<option value="">Select a tournament...</option>';

        snapshot.forEach(doc => {
            const data = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `${data.name || doc.id} (${data.status || 'unknown'})`;
            select.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading tournaments:', error);
        showStatus('Error loading tournaments list', 'error');
    }
}

async function refreshTournaments() {
    showStatus('Refreshing tournaments...', 'info');
    await loadTournamentsList();
    showStatus('Tournaments refreshed', 'success');
}

function onTournamentSelect(tournamentId) {
    if (tournamentId) {
        loadTournament(tournamentId);

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('tournamentId', tournamentId);
        window.history.pushState({}, '', url);
    }
}
```

Replace with:
```js
// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

async function refreshCurrentTournament() {
    if (!currentTournamentId) {
        showStatus('No tournament selected', 'error');
        return;
    }
    showStatus('Refreshing tournament...', 'info');
    await loadTournament(currentTournamentId);
    showStatus('Tournament refreshed', 'success');
}
```

(`loadTournament(tournamentId)` itself — the function immediately following this block — is unchanged; it already sets `currentTournamentId`, caches the tournament name to storage, and updates `#navTournamentLabel` directly, all of which remain correct with the navbar switcher.)

- [ ] **Step 5: Remove the `<select>` markup from `lightweight/statistics.html`**

Current (lines 62-71):
```html
    <div class="stats-container">
        <!-- Top Bar -->
        <div class="top-bar">
            <div class="tournament-selector">
                <label for="tournamentSelect">Tournament:</label>
                <select id="tournamentSelect" onchange="onTournamentSelect(this.value)">
                    <option value="">Select a tournament...</option>
                </select>
                <button class="btn secondary" id="refreshBtn" onclick="refreshTournaments()">Refresh</button>
            </div>
```

Replace with:
```html
    <div class="stats-container">
        <!-- Top Bar -->
        <div class="top-bar">
            <div class="tournament-selector">
                <button class="btn secondary" id="refreshBtn" onclick="refreshCurrentTournament()">Refresh</button>
            </div>
```

- [ ] **Step 6: Replace `statistics.js` init sequence to drop the select dependency**

Current (lines 43-67):
```js
document.addEventListener('firebase-ready', async () => {
    console.log('Firebase ready');
    updateConnectionStatus('connected');

    await loadTournamentsList(true); // bypass cooldown on initial load

    // Check URL for tournament ID
    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = urlParams.get('tournamentId') || urlParams.get('tournament');

    if (tournamentId) {
        document.getElementById('tournamentSelect').value = tournamentId;
        await loadTournament(tournamentId);

        // Check for player param — auto-select player and switch to Players tab
        const playerId = urlParams.get('player');
        if (playerId && gameState?.players?.[playerId]) {
            switchTab('players');
            document.getElementById('playerSelect').value = playerId;
            onPlayerSelect(playerId);
        }
    }

    document.getElementById('loadingOverlay').classList.add('hidden');
});
```

Replace with:
```js
document.addEventListener('firebase-ready', async () => {
    console.log('Firebase ready');
    updateConnectionStatus('connected');

    // Tournament context comes from the navbar switcher: URL param first,
    // falling back to the shared storage contract it maintains.
    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = urlParams.get('tournamentId') || urlParams.get('tournament') ||
        sessionStorage.getItem('currentTournamentId') ||
        localStorage.getItem('currentTournamentId');

    if (tournamentId) {
        await loadTournament(tournamentId);

        // Check for player param — auto-select player and switch to Players tab
        const playerId = urlParams.get('player');
        if (playerId && gameState?.players?.[playerId]) {
            switchTab('players');
            document.getElementById('playerSelect').value = playerId;
            onPlayerSelect(playerId);
        }
    }

    document.getElementById('loadingOverlay').classList.add('hidden');
});
```

- [ ] **Step 7: Replace `loadTournamentsList`/`renderTournamentSelector`/`onTournamentSelect`/`refreshTournaments` in `statistics.js`**

Current (lines 69-152, spanning the tournament-loading block through `onTournamentSelect`):
```js
// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

/**
 * Load list of all tournaments for the selector
 */
async function loadTournamentsList(bypassCooldown = false) {
    const now = Date.now();
    if (!bypassCooldown && now - lastListFetchAt < LIST_COOLDOWN_MS) {
        const remaining = Math.ceil((LIST_COOLDOWN_MS - (now - lastListFetchAt)) / 1000);
        showToast(`Please wait ${remaining}s before refreshing`, 'warning');
        return;
    }

    lastListFetchAt = now;

    try {
        const db = window.firebaseDB;
        const snapshot = await db.collection('tournaments')
            .orderBy('createdAt', 'desc')
            .get();

        tournamentsList = [];
        snapshot.forEach(doc => {
            tournamentsList.push({
                id: doc.id,
                ...doc.data()
            });
        });

        renderTournamentSelector();
        startRefreshCooldown();
    } catch (error) {
        console.error('Error loading tournaments:', error);
    }
}

/**
 * Render tournament dropdown options
 */
function renderTournamentSelector() {
    const select = document.getElementById('tournamentSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select a tournament...</option>';

    tournamentsList.forEach(tournament => {
        const option = document.createElement('option');
        option.value = tournament.id;

        const status = tournament.status || 'unknown';
        const statusIcon = status === 'finished' ? ' [Finished]' :
                          status === 'playing' ? ' [Active]' :
                          status === 'archived' ? ' [Archived]' : '';

        option.textContent = `${tournament.name || tournament.gameId || tournament.id}${statusIcon}`;
        select.appendChild(option);
    });

    // Restore selection if any
    if (currentValue) {
        select.value = currentValue;
    }
}

/**
 * Handle tournament selection change
 */
async function onTournamentSelect(tournamentId) {
    if (!tournamentId) {
        gameState = null;
        window.gameState = null;
        clearAllDisplays();
        return;
    }

    await loadTournament(tournamentId);

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('tournamentId', tournamentId);
    window.history.pushState({}, '', url);
}
```

Replace with:
```js
// =============================================================================
// TOURNAMENT LOADING
// =============================================================================

async function refreshCurrentTournament() {
    const tournamentId = gameState?.tournamentId;
    if (!tournamentId) {
        showToast('No tournament selected', 'warning');
        return;
    }
    const now = Date.now();
    if (now - lastListFetchAt < LIST_COOLDOWN_MS) {
        const remaining = Math.ceil((LIST_COOLDOWN_MS - (now - lastListFetchAt)) / 1000);
        showToast(`Please wait ${remaining}s before refreshing`, 'warning');
        return;
    }
    lastListFetchAt = now;
    await loadTournament(tournamentId);
    startRefreshCooldown();
}
```

- [ ] **Step 8: Remove the now-unused `refreshTournaments` call in `loadTournament`'s cooldown wiring**

Current (line 216-218 area, the old standalone `refreshTournaments` wrapper):
```js
/**
 * Refresh tournament list
 */
async function refreshTournaments() {
    await loadTournamentsList();
}
```

Delete this function entirely — `refreshCurrentTournament` (Step 7) replaces it, and `loadTournament`'s `startRefreshCooldown()` call site is preserved inside the new function.

- [ ] **Step 9: Manually verify**

Serve the app locally, log in as admin/god, and confirm:
- `full/admin.html` and `lightweight/admin.html` load with no `<select>` visible, the "Refresh" button reloads the current tournament's live data (check the Firestore console or make a change from another tab and click Refresh), and the tournament-state button still works.
- `lightweight/statistics.html` loads with no `<select>` visible and its "Refresh" button reloads current stats.
- Navigating to any of these three pages directly via a navbar link (which appends `tournamentId=...`) or with a stale URL missing the param (relying on the storage fallback) both load the correct tournament.
- No console errors referencing `tournamentSelect`, `onTournamentSelect`, `loadTournamentsList`, or `renderTournamentSelector`.

- [ ] **Step 10: Commit**

```bash
git add BoardGame/full/admin.html BoardGame/lightweight/admin.html BoardGame/lightweight/scripts/admin.js BoardGame/lightweight/statistics.html BoardGame/lightweight/scripts/statistics.js
git commit -m "Remove per-page tournament selectors in favor of the navbar switcher"
```

---

## Task 4: Simplify `home.html` tournament cards to a single "Enter" action

**Files:**
- Modify: `BoardGame/full/home.html:1336-1439`

- [ ] **Step 1: Replace `displayTournaments` card markup**

Current (lines 1336-1393):
```js
    function displayTournaments(tournaments) {
      const container = document.getElementById('recentTournaments');

      if (tournaments.length === 0) {
        container.innerHTML = `
          <div class="empty-state fade-in">
            <p>No tournaments found</p>
          </div>
        `;
        return;
      }

      container.innerHTML = tournaments.map((tournament, index) => {
        const status = tournament.status || 'setup';
        const createdDate = tournament.createdAt ? new Date(tournament.createdAt).toLocaleDateString() : 'Unknown';
        const tournamentId = tournament.tournamentId || tournament.id;

        // Find user's team in this tournament
        let userTeamName = null;
        if (tournament.teams && Array.isArray(tournament.teams) && currentUser) {
          const userTeam = tournament.teams.find(team =>
            team.players && team.players.some(player => player.uid === currentUser.uid)
          );
          if (userTeam) {
            userTeamName = userTeam.name;
          }
        }

        const isActive = currentActiveTournament === tournamentId;
        const escapedName = (tournament.name || tournamentId).replace(/'/g, "\\'");

        // Compact info line
        const infoParts = [];
        if (tournament.teams) infoParts.push(`${tournament.teams.length} teams`);
        if (tournament.currentRound) infoParts.push(`Round ${tournament.currentRound}`);
        if (userTeamName) infoParts.push(`Your team: ${userTeamName}`);
        const infoLine = infoParts.length > 0 ? infoParts.join(' · ') : createdDate;

        return `
          <div class="tournament-card fade-in ${isActive ? 'active-tournament' : ''}" id="tcard-${tournamentId}" style="animation-delay: ${index * 0.06}s;">
            <div class="tournament-header">
              <h4>${tournament.name || tournamentId}</h4>
              <div style="display: flex; gap: 6px; align-items: center;">
                <span class="active-badge">Active</span>
                <span class="tournament-status ${status}">${status}</span>
              </div>
            </div>
            <div class="tournament-info">
              <div>${infoLine}</div>
            </div>
            <div class="tournament-actions">
              <button class="btn-small ${isActive ? 'btn-secondary' : 'btn-enter'}" onclick="enterTournament('${tournamentId}', '${escapedName}')">${isActive ? 'Selected' : 'Select Active'}</button>
              <button class="btn-small btn-secondary" onclick="viewTournament('${tournamentId}')">View</button>
            </div>
          </div>
        `;
      }).join('');
    }
```

Replace with:
```js
    function displayTournaments(tournaments) {
      const container = document.getElementById('recentTournaments');

      if (tournaments.length === 0) {
        container.innerHTML = `
          <div class="empty-state fade-in">
            <p>No tournaments found</p>
          </div>
        `;
        return;
      }

      container.innerHTML = tournaments.map((tournament, index) => {
        const status = tournament.status || 'setup';
        const createdDate = tournament.createdAt ? new Date(tournament.createdAt).toLocaleDateString() : 'Unknown';
        const tournamentId = tournament.tournamentId || tournament.id;

        // Find user's team in this tournament
        let userTeamName = null;
        let userTeamId = null;
        if (tournament.teams && Array.isArray(tournament.teams) && currentUser) {
          const userTeam = tournament.teams.find(team =>
            team.players && team.players.some(player => player.uid === currentUser.uid)
          );
          if (userTeam) {
            userTeamName = userTeam.name;
            userTeamId = userTeam.id;
          }
        }

        const escapedName = (tournament.name || tournamentId).replace(/'/g, "\\'");

        // Compact info line
        const infoParts = [];
        if (tournament.teams) infoParts.push(`${tournament.teams.length} teams`);
        if (tournament.currentRound) infoParts.push(`Round ${tournament.currentRound}`);
        if (userTeamName) infoParts.push(`Your team: ${userTeamName}`);
        const infoLine = infoParts.length > 0 ? infoParts.join(' · ') : createdDate;

        return `
          <div class="tournament-card fade-in" id="tcard-${tournamentId}" style="animation-delay: ${index * 0.06}s;">
            <div class="tournament-header">
              <h4>${tournament.name || tournamentId}</h4>
              <span class="tournament-status ${status}">${status}</span>
            </div>
            <div class="tournament-info">
              <div>${infoLine}</div>
            </div>
            <div class="tournament-actions">
              <button class="btn-small btn-enter" onclick="enterTournament('${tournamentId}', '${escapedName}', ${userTeamId !== null ? `'${userTeamId}'` : 'null'})">Enter</button>
            </div>
          </div>
        `;
      }).join('');
    }
```

- [ ] **Step 2: Replace `enterTournament` to navigate by role instead of just toggling card state**

Current (lines 1445-roughly 1465, find the exact end by reading the function — it ends where the next top-level function/comment begins). Read it first:

Run: `grep -n "window.enterTournament" -A 25 "BoardGame/full/home.html"`

Replace the whole `window.enterTournament` function body with:
```js
    window.enterTournament = function(tournamentId, tournamentName, teamId) {
      currentActiveTournament = tournamentId;
      sessionStorage.setItem('currentTournamentId', tournamentId);
      localStorage.setItem('currentTournamentId', tournamentId);
      sessionStorage.setItem('currentTournamentName', tournamentName);
      localStorage.setItem('currentTournamentName', tournamentName);

      if (teamId) {
        sessionStorage.setItem('currentTeamId', teamId);
        localStorage.setItem('currentTeamId', teamId);
      }

      if (userRole === 'god') {
        window.location.href = `god.html?tournament=${tournamentId}`;
      } else if (userRole === 'admin') {
        window.location.href = `admin.html?tournamentId=${tournamentId}`;
      } else if (teamId) {
        window.location.href = `team.html?tournamentId=${tournamentId}&teamId=${teamId}`;
      } else {
        window.location.href = `view.html?tournamentId=${tournamentId}`;
      }
    };
```

- [ ] **Step 3: Remove the now-unused `viewTournament` global and `.active-tournament`/`.active-badge` CSS if nothing else references them**

Run: `grep -rn "viewTournament\|active-tournament\|active-badge" "BoardGame/full/home.html"`

If the only remaining matches are the CSS rule definitions themselves (no other JS call sites), delete:
- The `window.viewTournament` function (previously at line 1428-1430).
- The `.active-tournament` and `.active-badge` CSS rules in the `<style>` block.

If `grep` turns up other call sites (e.g. elsewhere in the god/admin dashboard sections), leave those rules and functions in place and only remove the reference from `displayTournaments`/`enterTournament` that Steps 1-2 already handled.

- [ ] **Step 4: Manually verify**

Serve the app locally and, for each role (god, admin, player with a team, plain user with no team), log in and click "Enter" on a tournament card on `full/home.html`. Confirm:
- God → navigates to `god.html?tournament=...`.
- Admin → navigates to `admin.html?tournamentId=...`.
- Player with a team in that tournament → navigates to `team.html?tournamentId=...&teamId=...`.
- Plain user with no team → navigates to `view.html?tournamentId=...`.
- In every case, the navbar on the destination page shows the correct tournament name.

- [ ] **Step 5: Commit**

```bash
git add BoardGame/full/home.html
git commit -m "Simplify home.html tournament cards to a single role-aware Enter action"
```

---

## Task 5: Delete confirmed-orphaned files

**Files:**
- Delete: `BoardGame/full/scripts/navbar.js`
- Delete: `BoardGame/lightweight/admin_old.html`

- [ ] **Step 1: Re-confirm no references before deleting**

Run:
```bash
grep -rn "full/scripts/navbar.js\|scripts/navbar.js\"" "BoardGame" --include="*.html" | grep -v "shared/scripts/navbar.js"
grep -rn "admin_old" "BoardGame" --include="*.html" --include="*.js"
```
Expected: no output from either command (both files are confirmed unreferenced anywhere in the app — this was already checked during planning; this step re-verifies nothing changed since).

- [ ] **Step 2: Delete the files**

```bash
git rm BoardGame/full/scripts/navbar.js BoardGame/lightweight/admin_old.html
```

- [ ] **Step 3: Verify the app still boots**

Serve the app locally and load `full/admin.html`, `full/god.html`, and `lightweight/admin.html` (the pages nearest the deleted files) to confirm no 404s or console errors appeared as a result of the deletion.

- [ ] **Step 4: Commit**

```bash
git commit -m "Delete orphaned full/scripts/navbar.js and lightweight/admin_old.html"
```

---

## Task 6: Full cross-role smoke test

**Files:** none (verification only)

- [ ] **Step 1: God-role walkthrough**

Log in as a user with `isGod: true`. From `full/home.html`, click "Enter" on a tournament card — confirm landing on `god.html?tournament=...` with the navbar tournament switcher visible and functional (per Task 2 Step 5). Use the switcher to change to a different tournament and confirm `god.html` reloads with the new tournament's data.

- [ ] **Step 2: Admin-role walkthrough**

Log in as a user with `isAdmin: true`. From `full/home.html`, click "Enter" — confirm landing on `admin.html?tournamentId=...` with no `<select>` visible, the switcher present in the navbar, and the "Refresh" button reloading current data. Repeat on `lightweight/admin.html` and `lightweight/statistics.html` directly (navigate via the navbar's Admin link).

- [ ] **Step 3: Player-role walkthrough**

Log in as a user with `assignedTeamId` and `assignedTournamentId` set. Confirm the navbar tournament name is plain text (no chevron, not clickable). Confirm `full/team.html` loads the assigned tournament/team correctly.

- [ ] **Step 4: Plain user walkthrough**

Log in as a user with no admin/player flags. Confirm the navbar tournament name is plain text and non-interactive on every page they can reach.

- [ ] **Step 5: Final check — no dead references**

```bash
grep -rn "tournamentSelect\|onTournamentSelect\|loadTournamentsList\|renderTournamentSelector\|refreshTournaments\b" "BoardGame" --include="*.html" --include="*.js"
```
Expected: no matches remaining anywhere in the app (the old per-page selector API surface should be fully gone; only `refreshCurrentTournament` should remain as its replacement).
