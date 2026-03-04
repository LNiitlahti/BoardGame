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
            { id: 'admin', label: 'Admin', icon: '⚙️', href: 'admin.html', lightweight: true },
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
        const currentGameId = sessionStorage.getItem('currentGameId') || localStorage.getItem('currentGameId');
        const currentTeamId = sessionStorage.getItem('currentTeamId') || localStorage.getItem('currentTeamId');

        // Most nav targets live in /full/, lightweight-flagged ones in /lightweight/
        let url = (item && item.lightweight ? getLightweightBasePath() : getFullBasePath()) + '/' + href;
        const params = new URLSearchParams();

        if (currentGameId) {
            // Each page expects a different param name
            if (href === 'god.html') {
                params.set('tournament', currentGameId);
            } else if (href === 'admin.html') {
                params.set('tournamentId', currentGameId);
            } else {
                params.set('gameId', currentGameId);
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
    function createNavbarHTML(userRole, userName) {
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
        const tournamentId = sessionStorage.getItem('currentGameId') || localStorage.getItem('currentGameId');
        const hasTournament = tournamentId && tournamentName;
        const tournamentCtxHTML = hasTournament
            ? `<span class="navbar-tournament-name" id="navTournamentLabel" title="${tournamentName}">${tournamentName}</span>`
            : `<span class="navbar-tournament-name empty" id="navTournamentLabel" title="No tournament selected">No tournament</span>`;

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
    }

    /**
     * Save navbar state to localStorage for instant rendering on next page load
     */
    function saveNavbarCache(userRole, userName) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ role: userRole, name: userName }));
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

        const html = createNavbarHTML(cached.role, cached.name);
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
            if (userData.assignedGameId && !currentTournamentId) {
                currentTournamentId = userData.assignedGameId;
                localStorage.setItem('currentGameId', currentTournamentId);
                sessionStorage.setItem('currentGameId', currentTournamentId);
            }

            // Also store team ID if player has one
            if (userData.assignedTeamId !== undefined) {
                localStorage.setItem('currentTeamId', userData.assignedTeamId);
                sessionStorage.setItem('currentTeamId', userData.assignedTeamId);
            }

            // Store current tournament ID
            if (currentTournamentId) {
                localStorage.setItem('currentGameId', currentTournamentId);
                sessionStorage.setItem('currentGameId', currentTournamentId);
            }

            // Cache for instant rendering on next page load
            saveNavbarCache(userRole, userName);

            // Insert navbar into page
            const navbarHTML = createNavbarHTML(userRole, userName);
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
               urlParams.get('gameId') ||
               urlParams.get('game') ||
               sessionStorage.getItem('currentGameId') ||
               localStorage.getItem('currentGameId');
    }

    /**
     * Logout function
     */
    window.navbarLogout = async function() {
        try {
            await firebase.auth().signOut();
            // Clear both session and local storage for tournament data
            sessionStorage.clear();
            localStorage.removeItem('currentGameId');
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
