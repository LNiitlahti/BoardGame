/**
 * ====================================
 * UNIFIED NAVBAR COMPONENT
 * ====================================
 * Shared navigation bar for all authenticated pages
 * Dynamically shows links based on user role
 *
 * Renders instantly from localStorage cache, then
 * silently updates when Firebase confirms user data.
 */

(function() {
    'use strict';

    let currentUserData = null;
    const CACHE_KEY = 'navbarCache';

    // Navigation items configuration
    const NAV_ITEMS = {
        // Available to all authenticated users
        common: [
            { id: 'home', label: 'Home', icon: '🏠', href: 'home.html' }
        ],
        // Player and above
        player: [
            { id: 'team', label: 'My Team', icon: '👥', href: 'team.html' }
        ],
        // Admin and above
        admin: [
            { id: 'admin', label: 'Admin', icon: '⚙️', href: 'admin.html' },
            { id: 'view', label: 'Spectator', icon: '📺', href: 'view.html' }
        ],
        // God only
        god: [
            { id: 'god', label: 'God Mode', icon: '👑', href: 'god.html' }
        ]
    };

    /**
     * Player status options for the navbar status menu.
     *
     * Keys and write shape must stay in sync with STATUS_EMOJIS in
     * full/scripts/onboarding.js and the grid in full/onboarding-status.html —
     * all three write the same `players.<id>.statuses.<key>` map, and
     * view-onboarding-layout.html renders the first truthy key in this order.
     *
     * Icons are Lucide (ISC, https://lucide.dev), inlined rather than pulled
     * from icon-svgs.js so the navbar stays self-contained — not every page
     * that loads the navbar loads the icon set.
     */
    const STATUS_ICON_PATHS = {
        idle: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
        eating: '<path d="m12 14-1 1" /><path d="m13.75 18.25-1.25 1.42" /><path d="M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12" /><path d="M18.8 9.3a1 1 0 0 0 2.1 7.7" /><path d="M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z" />',
        smoking: '<path d="M17 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h14" /><path d="M18 8c0-2.5-2-2.5-2-5" /><path d="M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M22 8c0-2.5-2-2.5-2-5" /><path d="M7 12v4" />',
        wc: '<path d="M7 12h13a1 1 0 0 1 1 1 5 5 0 0 1-5 5h-.598a.5.5 0 0 0-.424.765l1.544 2.47a.5.5 0 0 1-.424.765H5.402a.5.5 0 0 1-.424-.765L7 18" /><path d="M8 18a5 5 0 0 1-5-5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8" />',
        sleeping: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />',
        alert: '<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />',
        question: '<circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />'
    };

    /*
     * `hsl`/`hslDark` are the same colours as `color`, as bare HSL components
     * so the dial can build both solid fills and translucent glows from one
     * value — hsl(var(--code)) and hsl(var(--code) / 0.5).
     */
    const STATUS_OPTIONS = [
        { key: 'eating',   label: 'Eating',         color: '#f97316', hsl: '25 95% 53%',  hslDark: '25 95% 43%' },
        { key: 'smoking',  label: 'Smoke break',    color: '#fef9c3', hsl: '55 92% 88%',  hslDark: '55 80% 76%' },
        { key: 'wc',       label: 'Bathroom',       color: '#9ca3af', hsl: '218 11% 65%', hslDark: '218 11% 54%' },
        { key: 'sleeping', label: 'Sleeping',       color: '#818cf8', hsl: '239 84% 74%', hslDark: '239 70% 63%' },
        { key: 'alert',    label: 'Need attention', color: '#ef4444', hsl: '0 84% 60%',   hslDark: '0 74% 50%' },
        { key: 'question', label: 'Question',       color: '#f59e0b', hsl: '38 92% 50%',  hslDark: '38 92% 41%' }
    ];

    function statusIconSvg(name) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATUS_ICON_PATHS[name] || ''}</svg>`;
    }

    /**
     * Same icon as a data: URI — the dial paints its icons as background-image
     * (they need to sit under the ring's stacking order), which can't reach
     * currentColor, so the stroke is baked in.
     */
    function statusIconDataUri(name, color) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${STATUS_ICON_PATHS[name] || ''}</svg>`;
        // Single-quoted url(): this lands inside a double-quoted style="…"
        // attribute, and encodeURIComponent turns the SVG's own double quotes
        // into %22 while leaving no apostrophes behind to close it early.
        return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
    }

    // Role hierarchy for permission checking
    const ROLE_HIERARCHY = {
        'god': 4,
        'admin': 3,
        'player': 2,
        'user': 1
    };

    /**
     * Get current page identifier from URL
     */
    function getCurrentPage() {
        const path = window.location.pathname;
        const filename = path.substring(path.lastIndexOf('/') + 1).replace('.html', '');
        return filename || 'home';
    }

    /**
     * Escape a string for safe interpolation into innerHTML
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Check if user has required role level
     */
    function hasRoleLevel(userRole, requiredRole) {
        const userLevel = ROLE_HIERARCHY[userRole] || 0;
        const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
        return userLevel >= requiredLevel;
    }

    /**
     * Get navigation items based on user role
     */
    function getNavItemsForRole(role) {
        const items = [...NAV_ITEMS.common];

        if (hasRoleLevel(role, 'player')) {
            items.push(...NAV_ITEMS.player);
        }
        if (hasRoleLevel(role, 'admin')) {
            items.push(...NAV_ITEMS.admin);
        }
        if (hasRoleLevel(role, 'god')) {
            items.push(...NAV_ITEMS.god);
        }

        return items;
    }

    /**
     * Get base path to /full/ directory from current page location
     */
    function getFullBasePath() {
        const base = window.BOARDGAME_BASE || '.';
        const path = window.location.pathname.replace(/\\/g, '/');
        if (path.includes('/full/')) return '.';
        return base + '/full';
    }

    /**
     * Build URL with current tournament context
     */
    function buildNavUrl(href) {
        const currentTournamentId = sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId');
        const currentTeamId = sessionStorage.getItem('currentTeamId') || localStorage.getItem('currentTeamId');

        let url = getFullBasePath() + '/' + href;
        const params = new URLSearchParams();

        if (currentTournamentId) {
            params.set('tournamentId', currentTournamentId);
        }
        if (currentTeamId && (href === 'team.html')) {
            params.set('teamId', currentTeamId);
        }

        const paramString = params.toString();
        if (paramString) {
            url += '?' + paramString;
        }

        return url;
    }

    /**
     * Create the navbar HTML
     */
    function createNavbarHTML(userRole, userName, avatarUrl, assignedTournamentId, assignedPlayerId) {
        const currentPage = getCurrentPage();
        const navItems = getNavItemsForRole(userRole);

        const navLinksHTML = navItems.map(item => {
            const isActive = currentPage === item.id;
            const href = buildNavUrl(item.href);
            return `
                <a href="${href}" class="navbar-link ${isActive ? 'active' : ''}" data-page="${item.id}">
                    <span class="navbar-link-icon">${item.icon}</span>
                    <span class="navbar-link-label">${item.label}</span>
                </a>
            `;
        }).join('');

        const roleClass = userRole || 'user';
        const roleBadge = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : 'User';

        const base = window.BOARDGAME_BASE || '.';
        const logoPath = base + '/shared/images/favicon/android-chrome-192x192.png';
        const defaultAvatarPath = base + '/shared/images/default_avatar.png';
        const brandName = window.NAVBAR_BRAND_NAME || 'Board Game';

        // Active tournament context
        const tournamentName = sessionStorage.getItem('currentTournamentName') || localStorage.getItem('currentTournamentName');
        const tournamentId = sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId');
        const hasTournament = tournamentId && tournamentName;
        const canSwitch = hasRoleLevel(userRole, 'admin');
        const labelText = hasTournament ? tournamentName : 'No tournament';
        const labelTitle = hasTournament ? tournamentName : 'No tournament selected';

        // Status menu — only for players with a confirmed tournament assignment.
        // Each <li> is one spoke of the dial; CSS rotates them into a ring and
        // the radio inputs are the (invisible, full-spoke) hit targets.
        const dialItemsHTML = STATUS_OPTIONS.map(opt => `
            <li style="--dial-item-icon:${statusIconDataUri(opt.key, opt.color)}">
                <input type="radio" name="navStatusChoice" data-status-key="${opt.key}" aria-label="${opt.label}" title="${opt.label}">
            </li>
        `).join('');

        // Per-position accent colours the dial's :has() rules select between
        const dialAccentVars = STATUS_OPTIONS
            .map((opt, i) => `--dial-accent-${i + 1}:${opt.hsl};--dial-accent-${i + 1}-dark:${opt.hslDark};`)
            .join('');

        const statusBtnHTML = (assignedTournamentId && assignedPlayerId)
            ? `<div class="navbar-status" id="navStatus" data-tournament-id="${escapeHtml(assignedTournamentId)}" data-player-id="${escapeHtml(assignedPlayerId)}">
                    <button type="button" class="navbar-status-btn" id="navStatusBtn" title="Change my status" aria-haspopup="true" aria-expanded="false">
                        <span class="navbar-status-icon" id="navStatusIcon">${statusIconSvg('idle')}</span>
                        <span class="navbar-status-label" id="navStatusLabel">Change status</span>
                        <span class="navbar-status-chevron">&#9662;</span>
                    </button>
                    <div class="navbar-status-dial-wrap" id="navStatusDropdown" hidden>
                        <div class="navbar-status-dial-stage">
                            <div class="navbar-status-dial" id="navStatusDial" style="${dialAccentVars}" role="radiogroup" aria-label="My status">
                                <div class="navbar-status-knob" id="navStatusKnob" title="Close" aria-hidden="true"></div>
                                <ul>${dialItemsHTML}</ul>
                            </div>
                        </div>
                        <div class="navbar-status-caption" id="navStatusCaption">No status</div>
                        <button type="button" class="navbar-status-clear" id="navStatusClear" hidden>Clear status</button>
                    </div>
               </div>`
            : '';

        const tournamentCtxHTML = canSwitch
            ? `
                <div class="navbar-tournament-switcher" id="navTournamentSwitcher">
                    <button type="button" class="navbar-tournament-name clickable ${hasTournament ? '' : 'empty'}" id="navTournamentLabel" title="${escapeHtml(labelTitle)}">
                        <span class="navbar-tournament-name-text">${escapeHtml(labelText)}</span>
                        <span class="navbar-tournament-chevron">&#9662;</span>
                    </button>
                    <div class="navbar-tournament-dropdown" id="navTournamentDropdown" hidden>
                        <input type="text" class="navbar-tournament-search" id="navTournamentSearch" placeholder="Search tournaments...">
                        <div class="navbar-tournament-list" id="navTournamentList"><div class="navbar-tournament-list-empty">Loading...</div></div>
                        <button type="button" class="navbar-tournament-create" id="navTournamentCreate">+ Create new tournament</button>
                    </div>
                </div>
              `
            : (hasTournament
                ? `<span class="navbar-tournament-name has-clear" id="navTournamentLabel" title="${escapeHtml(labelTitle)}">
                        <span class="navbar-tournament-name-text">${escapeHtml(labelText)}</span>
                        <button type="button" class="navbar-tournament-clear" id="navTournamentClear" title="Clear active tournament" aria-label="Clear active tournament">&times;</button>
                   </span>`
                : `<span class="navbar-tournament-name empty" id="navTournamentLabel" title="${escapeHtml(labelTitle)}">${escapeHtml(labelText)}</span>`);

        return `
            <nav class="unified-navbar" id="unifiedNavbar">
                <div class="navbar-container">
                    <!-- Logo + Tournament Context -->
                    <div class="navbar-brand">
                        <img src="${logoPath}" alt="Logo" class="navbar-logo">
                        <div class="navbar-brand-text">
                            <span class="navbar-brand-name">${brandName}</span>
                            ${tournamentCtxHTML}
                        </div>
                    </div>

                    <!-- Navigation Links -->
                    <div class="navbar-nav">
                        ${navLinksHTML}
                    </div>

                    <!-- User Section -->
                    <div class="navbar-user">
                        ${statusBtnHTML}
                        <div class="navbar-connection-status" id="connectionStatus" title="Firebase: Connecting..."></div>
                        <img class="navbar-avatar" id="navbarAvatar" src="${avatarUrl || defaultAvatarPath}" alt="Avatar" onerror="this.onerror=null;this.src='${defaultAvatarPath}';">
                        <span class="navbar-role-badge ${roleClass}" id="roleBadge">${roleBadge}</span>
                        <div class="navbar-user-info">
                            <a class="navbar-user-name" id="userName" href="${getFullBasePath()}/profile.html" title="My Profile">${userName || 'User'}</a>
                            <button class="navbar-logout-btn" onclick="window.navbarLogout()" title="Logout">Exit</button>
                        </div>
                    </div>

                    <!-- Mobile Menu Toggle -->
                    <button class="navbar-mobile-toggle" onclick="window.toggleNavbarMobile()">
                        <span></span>
                        <span></span>
                        <span></span>
                    </button>
                </div>
            </nav>
        `;
    }

    /**
     * Tournament switcher state
     */
    let tournamentListCache = null;
    let tournamentListFetchedAt = 0;
    const TOURNAMENT_LIST_TTL_MS = 60000;
    let documentSwitcherListenersAttached = false;

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
                <button type="button" class="navbar-tournament-item" data-tournament-id="${escapeHtml(t.id)}" data-tournament-name="${escapeHtml(name)}">
                    <span class="navbar-tournament-item-status ${escapeHtml(status)}"></span>
                    <span class="navbar-tournament-item-name">${escapeHtml(name)}</span>
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
        url.searchParams.delete('tournament');
        url.searchParams.delete('gameId');
        url.searchParams.delete('game');
        url.searchParams.set('tournamentId', tournamentId);
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

    /**
     * Clear the active-tournament context for roles that can't use the full
     * switcher (see wireTournamentSwitcher) — the only way out for a
     * non-admin account whose currentTournamentId got set to a tournament
     * they aren't actually assigned to (e.g. via home.html's "Enter" on a
     * Recent Tournaments card).
     */
    function wireTournamentClear() {
        const btn = document.getElementById('navTournamentClear');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sessionStorage.removeItem('currentTournamentId');
            localStorage.removeItem('currentTournamentId');
            sessionStorage.removeItem('currentTournamentName');
            localStorage.removeItem('currentTournamentName');
            sessionStorage.removeItem('currentTeamId');
            localStorage.removeItem('currentTeamId');
            window.location.href = getFullBasePath() + '/home.html';
        });
    }

    /**
     * Insert navbar HTML into the page
     */
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
        wireTournamentClear();
        wireStatusMenu();
    }

    /**
     * Status menu state.
     *
     * Scoped to the viewer's own tournament assignment rather than whatever
     * tournament happens to be in context — so it works from any page.
     */
    let statusUnsubscribe = null;
    let currentStatusKey = null;
    let documentStatusListenersAttached = false;

    let statusCloseTimer = null;

    function openStatusDropdown() {
        const dropdown = document.getElementById('navStatusDropdown');
        const dial = document.getElementById('navStatusDial');
        const btn = document.getElementById('navStatusBtn');
        if (!dropdown) return;

        clearTimeout(statusCloseTimer);
        dropdown.hidden = false;
        if (btn) btn.setAttribute('aria-expanded', 'true');
        // Next frame, so the browser has a collapsed state to animate from
        requestAnimationFrame(() => {
            if (!dropdown.hidden && dial) dial.classList.add('active');
        });
    }

    function closeStatusDropdown() {
        const dropdown = document.getElementById('navStatusDropdown');
        const dial = document.getElementById('navStatusDial');
        const btn = document.getElementById('navStatusBtn');
        if (!dropdown || dropdown.hidden) return;

        if (dial) dial.classList.remove('active');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        // Let the ring collapse before removing it from the layout
        clearTimeout(statusCloseTimer);
        statusCloseTimer = setTimeout(() => { dropdown.hidden = true; }, 400);
    }

    function isStatusDropdownOpen() {
        const dropdown = document.getElementById('navStatusDropdown');
        return !!dropdown && !dropdown.hidden;
    }

    /**
     * Reflect the active status on the trigger button and the menu items.
     * `key` is null when no status is set.
     */
    function renderStatusState(key) {
        currentStatusKey = key;

        const option = STATUS_OPTIONS.find(o => o.key === key) || null;
        const root = document.getElementById('navStatus');
        const iconEl = document.getElementById('navStatusIcon');
        const labelEl = document.getElementById('navStatusLabel');

        if (iconEl) {
            iconEl.innerHTML = statusIconSvg(option ? option.key : 'idle');
            iconEl.style.color = option ? option.color : '';
        }
        if (labelEl) labelEl.textContent = option ? option.label : 'Change status';
        if (root) root.classList.toggle('has-status', !!option);

        // The dial reads its angle and accent straight off :checked
        document.querySelectorAll('#navStatusDial input[type="radio"]').forEach(radio => {
            radio.checked = radio.dataset.statusKey === key;
        });

        const captionEl = document.getElementById('navStatusCaption');
        if (captionEl) captionEl.textContent = option ? option.label : 'No status';

        const clearBtn = document.getElementById('navStatusClear');
        if (clearBtn) clearBtn.hidden = !option;
    }

    /**
     * Live-follow the viewer's own status so the navbar stays correct when it
     * is changed elsewhere (onboarding page, the standalone popup, an admin).
     */
    function subscribeToStatus(tournamentId, playerId) {
        if (statusUnsubscribe) {
            statusUnsubscribe();
            statusUnsubscribe = null;
        }

        if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
            // Cache render can beat Firebase; retry once it announces itself.
            document.addEventListener('firebase-ready', () => subscribeToStatus(tournamentId, playerId), { once: true });
            return;
        }

        statusUnsubscribe = firebase.firestore()
            .collection('tournaments').doc(tournamentId)
            .collection('onboarding').doc('state')
            .onSnapshot(snap => {
                const statuses = (snap.exists && snap.data()?.players?.[playerId]?.statuses) || {};
                // First truthy key wins, matching view-onboarding-layout.html
                const active = STATUS_OPTIONS.find(o => statuses[o.key]);
                renderStatusState(active ? active.key : null);
            }, error => {
                console.error('[navbar] Status listener failed:', error);
            });
    }

    /**
     * Write the status exclusively — clear every key, then set the chosen one.
     * Mirrors togglePlayerStatus() in onboarding.js.
     */
    async function setPlayerStatus(tournamentId, playerId, key) {
        const previousKey = currentStatusKey;
        renderStatusState(key); // optimistic; the snapshot confirms it

        const updates = {};
        for (const opt of STATUS_OPTIONS) {
            updates[`players.${playerId}.statuses.${opt.key}`] = false;
        }
        if (key) {
            updates[`players.${playerId}.statuses.${key}`] = true;
        }
        updates[`players.${playerId}.lastUpdated`] = new Date().toISOString();

        try {
            await firebase.firestore()
                .collection('tournaments').doc(tournamentId)
                .collection('onboarding').doc('state')
                .update(updates);
        } catch (error) {
            console.error('[navbar] Failed to save status:', error);
            renderStatusState(previousKey); // roll the optimistic update back
        }
    }

    function wireStatusMenu() {
        const root = document.getElementById('navStatus');
        if (!root) return;

        const btn = document.getElementById('navStatusBtn');
        const dropdown = document.getElementById('navStatusDropdown');
        const knob = document.getElementById('navStatusKnob');
        const clearBtn = document.getElementById('navStatusClear');
        const { tournamentId, playerId } = root.dataset;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isStatusDropdownOpen()) closeStatusDropdown();
            else openStatusDropdown();
        });

        knob.addEventListener('click', (e) => {
            e.stopPropagation();
            closeStatusDropdown();
        });

        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setPlayerStatus(tournamentId, playerId, null);
        });

        // Picking is non-dismissing — the dial stays open so the choice can be
        // changed or undone without reopening. It closes on the trigger, the
        // knob, an outside click, or Escape.
        //
        // Uses change, not click, so keyboard arrow-key selection within the
        // radio group works too.
        dropdown.addEventListener('change', (e) => {
            const input = e.target.closest('input[type="radio"]');
            if (!input || input.dataset.statusKey === currentStatusKey) return;
            setPlayerStatus(tournamentId, playerId, input.dataset.statusKey);
        });

        // Re-picking the already-selected status clears it — a radio fires no
        // change event when it is already checked, so that gesture only shows
        // up as a click. Deferred to the next tick so the write lands after
        // the input's own activation behaviour, which would otherwise re-check
        // it right after we cleared it.
        dropdown.addEventListener('click', (e) => {
            const input = e.target.closest('input[type="radio"]');
            if (!input || input.dataset.statusKey !== currentStatusKey) return;
            setTimeout(() => setPlayerStatus(tournamentId, playerId, null), 0);
        });

        if (!documentStatusListenersAttached) {
            documentStatusListenersAttached = true;
            document.addEventListener('click', (e) => {
                const el = document.getElementById('navStatus');
                if (el && !el.contains(e.target)) closeStatusDropdown();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeStatusDropdown();
            });
        }

        renderStatusState(currentStatusKey);
        subscribeToStatus(tournamentId, playerId);
    }

    /**
     * Save navbar state to localStorage for instant rendering on next page load
     */
    function saveNavbarCache(userRole, userName, avatarUrl, assignedTournamentId, assignedPlayerId) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                role: userRole, name: userName, avatarUrl: avatarUrl || null,
                assignedTournamentId: assignedTournamentId || null, assignedPlayerId: assignedPlayerId || null
            }));
        } catch (e) { /* quota exceeded — ignore */ }
    }

    /**
     * Load cached navbar state
     */
    function loadNavbarCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    /**
     * Render navbar instantly from cache (no Firebase needed)
     */
    function renderFromCache() {
        const cached = loadNavbarCache();
        if (!cached) return false;

        const html = createNavbarHTML(cached.role, cached.name, cached.avatarUrl, cached.assignedTournamentId, cached.assignedPlayerId);
        insertNavbar(html);
        return true;
    }

    /**
     * Initialize the navbar
     */
    async function initNavbar() {
        // Wait for Firebase to be ready
        if (typeof firebase === 'undefined') {
            document.addEventListener('firebase-ready', initNavbar);
            return;
        }

        // Check authentication
        const auth = firebase.auth();
        const user = auth.currentUser;

        if (!user) {
            // Wait for auth state
            auth.onAuthStateChanged(async (authUser) => {
                if (authUser) {
                    await renderNavbar(authUser);
                }
            });
            return;
        }

        await renderNavbar(user);
    }

    /**
     * Render navbar with user data (from Firebase)
     */
    async function renderNavbar(user) {
        try {
            const db = firebase.firestore();

            // Get user profile
            const userDoc = await db.collection('users').doc(user.uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            currentUserData = userData;

            // Determine user role — mirrors profile.html's derivation
            // (isPlayer===true), not presence of assignedTeamId, which is
            // always set (to null) at registration and so was always truthy.
            const userRole = userData.isGod ? 'god' :
                            userData.isSuperAdmin ? 'god' :
                            userData.isAdmin ? 'admin' :
                            userData.isPlayer === true ? 'player' : 'user';

            const userName = userData.displayName || userData.firstName || user.email?.split('@')[0] || 'User';

            // Get current tournament from URL or sessionStorage
            let currentTournamentId = getCurrentTournamentId();

            // If player is assigned to a tournament, use that
            const assignedTournament = userData.assignedTournamentId || userData.assignedGameId; // backward compat
            if (assignedTournament && !currentTournamentId) {
                currentTournamentId = assignedTournament;
                localStorage.setItem('currentTournamentId', currentTournamentId);
                sessionStorage.setItem('currentTournamentId', currentTournamentId);
            }

            // Also store team ID if player has one
            if (userData.assignedTeamId !== undefined) {
                localStorage.setItem('currentTeamId', userData.assignedTeamId);
                sessionStorage.setItem('currentTeamId', userData.assignedTeamId);
            }

            // Store current tournament ID
            if (currentTournamentId) {
                localStorage.setItem('currentTournamentId', currentTournamentId);
                sessionStorage.setItem('currentTournamentId', currentTournamentId);
            }

            const avatarUrl = userData.avatarUrl || null;
            const assignedPlayerId = userData.assignedPlayerId || null;

            // Cache for instant rendering on next page load
            saveNavbarCache(userRole, userName, avatarUrl, assignedTournament, assignedPlayerId);

            // Insert navbar into page
            const navbarHTML = createNavbarHTML(userRole, userName, avatarUrl, assignedTournament, assignedPlayerId);
            insertNavbar(navbarHTML);

            // We just fetched from Firestore, so Firebase is connected
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
                statusEl.classList.add('connected');
                statusEl.title = 'Firebase: Connected';
            }

            // Store role and data for other scripts
            window.currentUserRole = userRole;
            window.currentUserData = userData;

        } catch (error) {
            console.error('Error initializing navbar:', error);
        }
    }

    /**
     * Get current tournament ID from URL or sessionStorage
     */
    function getCurrentTournamentId() {
        const urlParams = new URLSearchParams(window.location.search);
        const legacyName = ['tournament', 'gameId', 'game'].find(name => urlParams.has(name));
        if (legacyName) {
            console.warn(`[navbar] Ignoring legacy query param "${legacyName}" — use "tournamentId" instead.`);
        }
        return urlParams.get('tournamentId') ||
               sessionStorage.getItem('currentTournamentId') ||
               localStorage.getItem('currentTournamentId');
    }

    /**
     * Logout function
     */
    window.navbarLogout = async function() {
        try {
            // Detach first — a live listener outlives sign-out and throws
            // permission-denied into the console on the way down.
            if (statusUnsubscribe) {
                statusUnsubscribe();
                statusUnsubscribe = null;
            }
            await firebase.auth().signOut();
            // Clear both session and local storage for tournament data
            sessionStorage.clear();
            localStorage.removeItem('currentTournamentId');
            localStorage.removeItem('currentTeamId');
            localStorage.removeItem('currentTournamentName');
            localStorage.removeItem(CACHE_KEY);
            window.location.href = (window.BOARDGAME_BASE || '.') + '/login.html';
        } catch (error) {
            console.error('Logout error:', error);
            alert('Error logging out. Please try again.');
        }
    };

    /**
     * Mobile menu toggle
     */
    window.toggleNavbarMobile = function() {
        const navbar = document.getElementById('unifiedNavbar');
        if (navbar) {
            navbar.classList.toggle('mobile-open');
        }
    };

    // ── BOOT SEQUENCE ──
    // 1) Render instantly from cache (synchronous — no flicker)
    // 2) When Firebase is ready, re-render with fresh data (updates silently)

    function boot() {
        // Try cached render first — appears instantly
        renderFromCache();

        // Then kick off Firebase-backed render (will overwrite cache version)
        initNavbar();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Listen for Firebase ready event to update connection status
    document.addEventListener('firebase-ready', function() {
        const status = document.getElementById('connectionStatus');
        if (status) {
            status.classList.remove('disconnected', 'warning');
            status.classList.add('connected');
            status.title = 'Firebase: Connected';
        }
    });

    // Export for manual initialization if needed
    window.initNavbar = initNavbar;

    // Alias for backward compatibility (some pages use onclick="logout()")
    if (!window.logout) {
        window.logout = window.navbarLogout;
    }

})();
