/**
 * ====================================
 * UNIFIED NAVBAR COMPONENT
 * ====================================
 * Shared navigation bar for all authenticated pages
 * Dynamically shows links based on user role
 * Includes tournament selector for context-aware navigation
 */

(function() {
    'use strict';

    // Store available tournaments for the selector
    let availableTournaments = [];
    let currentUserData = null;

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
     * Build URL with current tournament context
     */
    function buildNavUrl(href) {
        const currentGameId = sessionStorage.getItem('currentGameId') || localStorage.getItem('currentGameId');
        const currentTeamId = sessionStorage.getItem('currentTeamId') || localStorage.getItem('currentTeamId');

        let url = href;
        const params = new URLSearchParams();

        if (currentGameId) {
            // Use 'tournament' for god.html, 'gameId' for others
            if (href === 'god.html') {
                params.set('tournament', currentGameId);
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
     * Fetch available tournaments for the selector
     */
    async function fetchAvailableTournaments(db, userRole, userData) {
        const tournaments = [];

        try {
            // For god/admin: show all tournaments
            // For players: show assigned tournament + any active ones they can view
            if (userRole === 'god' || userRole === 'admin') {
                // Simple query without compound index requirement
                const snapshot = await db.collection('tournaments')
                    .limit(30)
                    .get();

                snapshot.forEach(doc => {
                    const data = doc.data();
                    // Filter for active tournaments (setup or playing)
                    if (data.status === 'setup' || data.status === 'playing' || !data.status) {
                        tournaments.push({
                            id: doc.id,
                            name: data.name || doc.id,
                            status: data.status || 'setup'
                        });
                    }
                });

                // Sort by name client-side
                tournaments.sort((a, b) => a.name.localeCompare(b.name));
            } else {
                // Regular users/players - show their assigned tournament
                if (userData.assignedGameId) {
                    const doc = await db.collection('tournaments').doc(userData.assignedGameId).get();
                    if (doc.exists) {
                        tournaments.push({
                            id: doc.id,
                            name: doc.data().name || doc.id,
                            status: doc.data().status || 'setup'
                        });
                    }
                }

                // Also try to fetch any "playing" tournaments they might want to view
                try {
                    const activeSnapshot = await db.collection('tournaments')
                        .where('status', '==', 'playing')
                        .limit(5)
                        .get();

                    activeSnapshot.forEach(doc => {
                        // Don't add duplicates
                        if (!tournaments.find(t => t.id === doc.id)) {
                            tournaments.push({
                                id: doc.id,
                                name: doc.data().name || doc.id,
                                status: doc.data().status
                            });
                        }
                    });
                } catch (e) {
                    // Ignore if this query fails
                }
            }
        } catch (error) {
            console.warn('Could not fetch tournaments for selector:', error);

            // Fallback: try simpler query
            try {
                const fallbackSnapshot = await db.collection('tournaments').limit(10).get();
                fallbackSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.status !== 'archived' && data.status !== 'finished') {
                        tournaments.push({
                            id: doc.id,
                            name: data.name || doc.id,
                            status: data.status || 'setup'
                        });
                    }
                });
            } catch (e2) {
                console.error('Fallback tournament fetch also failed:', e2);
            }
        }

        return tournaments;
    }

    /**
     * Handle tournament selection change
     */
    window.onTournamentSelect = function(selectElement) {
        const tournamentId = selectElement.value;

        if (tournamentId) {
            localStorage.setItem('currentGameId', tournamentId);
            sessionStorage.setItem('currentGameId', tournamentId); // Also keep in session for compatibility

            // Find tournament name
            const tournament = availableTournaments.find(t => t.id === tournamentId);
            if (tournament) {
                localStorage.setItem('currentTournamentName', tournament.name);
                sessionStorage.setItem('currentTournamentName', tournament.name);
            }

            // Dispatch event for other scripts to react
            document.dispatchEvent(new CustomEvent('tournament-changed', {
                detail: { tournamentId, tournamentName: tournament?.name }
            }));

            // Update all nav links
            updateNavLinks();

            console.log('[Navbar] Tournament selected:', tournamentId);
        } else {
            localStorage.removeItem('currentGameId');
            localStorage.removeItem('currentTournamentName');
            sessionStorage.removeItem('currentGameId');
            sessionStorage.removeItem('currentTournamentName');
        }
    };

    /**
     * Update navigation links with current tournament
     */
    function updateNavLinks() {
        document.querySelectorAll('.navbar-link').forEach(link => {
            const page = link.dataset.page;
            const item = [...NAV_ITEMS.common, ...NAV_ITEMS.player, ...NAV_ITEMS.admin, ...NAV_ITEMS.god]
                .find(i => i.id === page);
            if (item) {
                link.href = buildNavUrl(item.href);
            }
        });
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
     * Create the navbar HTML
     */
    function createNavbarHTML(userRole, userName, tournaments, currentTournamentId) {
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

        // Build tournament selector HTML
        let tournamentSelectorHTML = '';
        if (tournaments.length > 0) {
            const optionsHTML = tournaments.map(t => {
                const selected = t.id === currentTournamentId ? 'selected' : '';
                const statusIcon = t.status === 'playing' ? '🟢' : t.status === 'setup' ? '🟡' : '⚪';
                return `<option value="${t.id}" ${selected}>${statusIcon} ${t.name}</option>`;
            }).join('');

            tournamentSelectorHTML = `
                <div class="navbar-tournament-selector">
                    <label class="navbar-tournament-label">🏆</label>
                    <select id="navbarTournamentSelect" class="navbar-tournament-select" onchange="window.onTournamentSelect(this)">
                        <option value="">Select Tournament</option>
                        ${optionsHTML}
                    </select>
                </div>
            `;
        } else {
            tournamentSelectorHTML = `
                <div class="navbar-tournament-selector">
                    <span class="navbar-no-tournament">No tournaments</span>
                </div>
            `;
        }

        return `
            <nav class="unified-navbar" id="unifiedNavbar">
                <div class="navbar-container">
                    <!-- Logo Section -->
                    <div class="navbar-brand">
                        <img src="images/favicon/android-chrome-192x192.png" alt="Logo" class="navbar-logo">
                        <span class="navbar-brand-name">BoardGame</span>
                    </div>

                    <!-- Tournament Selector -->
                    ${tournamentSelectorHTML}

                    <!-- Navigation Links -->
                    <div class="navbar-nav">
                        ${navLinksHTML}
                    </div>

                    <!-- User Section -->
                    <div class="navbar-user">
                        <div class="navbar-connection-status ${window.firebaseDB ? 'connected' : 'disconnected'}" id="connectionStatus" title="${window.firebaseDB ? 'Firebase: Connected' : 'Firebase: Connecting...'}"></div>
                        <button class="navbar-theme-toggle" id="themeToggleNavbar" onclick="window.toggleTheme()" title="Toggle dark/light mode">
                            ${document.body.classList.contains('dark-mode') ? '☀️' : '🌙'}
                        </button>
                        <span class="navbar-role-badge ${roleClass}">${roleBadge}</span>
                        <div class="navbar-user-info">
                            <span class="navbar-user-name">${userName || 'User'}</span>
                            <button class="navbar-logout-btn" onclick="window.navbarLogout()" title="Logout">
                                <span>🚪</span>
                            </button>
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
     * Render navbar with user data
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

            // Fetch available tournaments
            availableTournaments = await fetchAvailableTournaments(db, userRole, userData);

            // If we have a tournament ID but it's not in the list, add it
            if (currentTournamentId && !availableTournaments.find(t => t.id === currentTournamentId)) {
                try {
                    const tDoc = await db.collection('tournaments').doc(currentTournamentId).get();
                    if (tDoc.exists) {
                        availableTournaments.unshift({
                            id: tDoc.id,
                            name: tDoc.data().name || tDoc.id,
                            status: tDoc.data().status
                        });
                    }
                } catch (e) {
                    console.warn('Could not fetch current tournament:', e);
                }
            }

            // Store current tournament ID
            if (currentTournamentId) {
                localStorage.setItem('currentGameId', currentTournamentId);
                sessionStorage.setItem('currentGameId', currentTournamentId);
            }

            // Insert navbar into page
            const navbarHTML = createNavbarHTML(userRole, userName, availableTournaments, currentTournamentId);

            // Find or create navbar container
            let container = document.getElementById('navbar-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'navbar-container';
                document.body.insertBefore(container, document.body.firstChild);
            }

            container.innerHTML = navbarHTML;

            // Add body padding to account for fixed navbar
            document.body.style.paddingTop = '60px';

            // Store role and data for other scripts
            window.currentUserRole = userRole;
            window.currentUserData = userData;

        } catch (error) {
            console.error('Error initializing navbar:', error);
        }
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
            window.location.href = 'login.html';
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

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavbar);
    } else {
        initNavbar();
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

})();
