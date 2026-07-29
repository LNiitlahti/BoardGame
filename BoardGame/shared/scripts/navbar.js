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
        if (path.includes('/lightweight/')) return '../full';
        return base + '/full';
    }

    /**
     * Get base path to /lightweight/ directory from current page location
     */
    function getLightweightBasePath() {
        const base = window.BOARDGAME_BASE || '.';
        const path = window.location.pathname.replace(/\\/g, '/');
        if (path.includes('/lightweight/')) return '.';
        if (path.includes('/full/')) return '../lightweight';
        return base + '/lightweight';
    }

    /**
     * Build URL with current tournament context
     */
    function buildNavUrl(href, item) {
        const currentTournamentId = sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId');
        const currentTeamId = sessionStorage.getItem('currentTeamId') || localStorage.getItem('currentTeamId');

        // Most nav targets live in /full/, lightweight-flagged ones in /lightweight/
        let url = (item && item.lightweight ? getLightweightBasePath() : getFullBasePath()) + '/' + href;
        const params = new URLSearchParams();

        if (currentTournamentId) {
            // Each page expects a different param name
            if (href === 'god.html') {
                params.set('tournament', currentTournamentId);
            } else if (href === 'admin.html') {
                params.set('tournamentId', currentTournamentId);
            } else {
                params.set('tournamentId', currentTournamentId);
            }
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
    function createNavbarHTML(userRole, userName, avatarUrl) {
        const currentPage = getCurrentPage();
        const navItems = getNavItemsForRole(userRole);

        const navLinksHTML = navItems.map(item => {
            const isActive = currentPage === item.id;
            const href = buildNavUrl(item.href, item);
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
        const brandName = window.NAVBAR_BRAND_NAME || 'Board Game';

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
                        <div class="navbar-connection-status" id="connectionStatus" title="Firebase: Connecting..."></div>
                        ${avatarUrl
                            ? `<img class="navbar-avatar" id="navbarAvatar" src="${avatarUrl}" alt="Avatar" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'navbar-avatar-placeholder',id:'navbarAvatar',textContent:'${(userName || 'U').charAt(0).toUpperCase()}'}))">`
                            : `<span class="navbar-avatar-placeholder" id="navbarAvatar">${(userName || 'U').charAt(0).toUpperCase()}</span>`
                        }
                        <span class="navbar-role-badge ${roleClass}" id="roleBadge">${roleBadge}</span>
                        <div class="navbar-user-info">
                            <span class="navbar-user-name" id="userName">${userName || 'User'}</span>
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
    }

    /**
     * Save navbar state to localStorage for instant rendering on next page load
     */
    function saveNavbarCache(userRole, userName, avatarUrl) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ role: userRole, name: userName, avatarUrl: avatarUrl || null }));
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

        const html = createNavbarHTML(cached.role, cached.name, cached.avatarUrl);
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

            // Determine user role
            const userRole = userData.isGod ? 'god' :
                            userData.isSuperAdmin ? 'god' :
                            userData.isAdmin ? 'admin' :
                            userData.assignedTeamId !== undefined ? 'player' : 'user';

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

            // Cache for instant rendering on next page load
            saveNavbarCache(userRole, userName, avatarUrl);

            // Insert navbar into page
            const navbarHTML = createNavbarHTML(userRole, userName, avatarUrl);
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
        return urlParams.get('tournament') ||
               urlParams.get('tournamentId') ||
               urlParams.get('gameId') ||  // backward compat
               urlParams.get('game') ||   // backward compat
               sessionStorage.getItem('currentTournamentId') ||
               localStorage.getItem('currentTournamentId');
    }

    /**
     * Logout function
     */
    window.navbarLogout = async function() {
        try {
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
