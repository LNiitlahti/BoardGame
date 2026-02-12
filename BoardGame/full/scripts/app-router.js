/**
 * ===========================
 * APP ROUTER - MODULAR SPA
 * ===========================
 * Handles authentication, role detection, and module loading
 * for the unified Board Game application.
 *
 * Architecture:
 * - app.html is the shell/orchestrator
 * - modules/ contains independent components
 * - Firebase Security Rules provide true security
 * - Client-side routing is for UX only
 */

(function() {
  'use strict';

  let auth;
  let db;
  let currentUser = null;
  let userProfile = null;
  let userRole = null; // Current viewing role (can be switched by user)
  let userActualRole = null; // Actual permission role (never changes)
  let currentModule = null;
  let tournaments = [];
  let activeTournamentId = null;
  let loadedScripts = new Set(); // Track loaded external scripts to prevent duplicates

  /**
   * Navigation structure by role
   */
  const NAVIGATION = {
    god: [
      { icon: '🏠', label: 'Dashboard', module: 'dashboard' },
      { icon: '👑', label: 'God Panel', module: 'admin-panel' },
      { icon: '🎮', label: 'Tournaments', module: 'admin-panel', hash: 'tournaments' },
      { icon: '⚔️', label: 'Matches', module: 'admin-panel', hash: 'matches' },
      { icon: '🎲', label: 'Board', module: 'admin-panel', hash: 'board' },
      { icon: '👥', label: 'Teams', module: 'admin-panel', hash: 'teams' },
      { icon: '👤', label: 'Users', module: 'admin-panel', hash: 'users' },
      { icon: '✨', label: 'Spells', module: 'admin-panel', hash: 'spells' },
      { icon: '📊', label: 'Stats', module: 'admin-panel', hash: 'stats' },
      { icon: '📜', label: 'History', module: 'admin-panel', hash: 'history' }
    ],
    admin: [
      { icon: '🏠', label: 'Dashboard', module: 'dashboard' },
      { icon: '🎮', label: 'Tournaments', module: 'admin-panel', hash: 'tournaments' },
      { icon: '⚔️', label: 'Matches', module: 'admin-panel', hash: 'matches' },
      { icon: '👥', label: 'Teams', module: 'admin-panel', hash: 'teams' },
      { icon: '📊', label: 'Stats', module: 'admin-panel', hash: 'stats' }
    ],
    player: [
      { icon: '🏠', label: 'Dashboard', module: 'dashboard' },
      { icon: '🎯', label: 'My Team', module: 'team-dashboard' }
    ],
    user: [
      { icon: '🏠', label: 'Dashboard', module: 'dashboard' }
    ]
  };

  /**
   * Initialize the app when Firebase is ready
   */
  document.addEventListener('firebase-ready', function() {
    console.log('[AppRouter] Firebase ready, initializing app...');

    // Check if running from file:// protocol
    if (window.location.protocol === 'file:') {
      console.warn('[AppRouter] ⚠️ Running from file:// protocol. Module loading may fail due to CORS restrictions.');
      console.warn('[AppRouter] Please use a local web server (e.g., Live Server, Python http.server) or deploy to Firebase Hosting.');
    }

    auth = firebase.auth();
    db = firebase.firestore();

    // Monitor authentication state
    auth.onAuthStateChanged(handleAuthStateChange);
  });

  /**
   * Handle authentication state changes
   */
  async function handleAuthStateChange(user) {
    if (!user) {
      // Not logged in → redirect to index (which will redirect to login)
      console.log('[AppRouter] No user logged in, redirecting to index...');
      window.location.href = '../index.html';
      return;
    }

    console.log('[AppRouter] User logged in:', user.uid);
    currentUser = user;

    try {
      // Load user profile from Firestore
      await loadUserProfile(user.uid);

      // Determine user role
      userRole = determineUserRole(userProfile, user.uid);
      userActualRole = userRole; // Store actual permission role
      console.log('[AppRouter] User role:', userRole);

      // Update UI with user info
      updateUserInfo();

      // Load tournaments and initialize context controls
      await loadTournaments();
      initializeRoleSwitcher();

      // Build sidebar navigation
      buildSidebar();

      // Load initial module (from URL hash or default)
      const initialModule = getInitialModule();
      await loadModule(initialModule);

    } catch (error) {
      console.error('[AppRouter] Error initializing app:', error);
      showError('Error loading your profile. Please try refreshing the page.');
    }
  }

  /**
   * Load user profile from Firestore
   */
  async function loadUserProfile(uid) {
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      throw new Error('User profile not found');
    }

    userProfile = userDoc.data();
    console.log('[AppRouter] User profile loaded:', userProfile);

    // Store in sessionStorage for quick access
    sessionStorage.setItem('userProfile', JSON.stringify(userProfile));
  }

  /**
   * Determine user role based on profile data
   */
  function determineUserRole(userData, uid) {
    // Check for GOD (highest privilege)
    if (userData.isGod === true) {
      return 'god';
    }

    // Check for Admin
    if (userData.isAdmin === true) {
      return 'admin';
    }

    // Check for Player (has team or isPlayer flag)
    if (userData.isPlayer === true || userData.teamId || userData.assignedTeamId !== undefined) {
      return 'player';
    }

    // Default: Regular user
    return 'user';
  }

  /**
   * Update user info in navbar
   */
  function updateUserInfo() {
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');

    if (userNameEl) {
      userNameEl.textContent = userProfile.displayName || userProfile.firstName || 'User';
    }

    if (userRoleEl) {
      userRoleEl.textContent = userRole.toUpperCase();
      userRoleEl.className = `user-role-badge ${userRole}`;
    }
  }

  /**
   * Load tournaments from Firebase
   */
  async function loadTournaments() {
    console.log('[AppRouter] Loading tournaments...');

    try {
      let query;

      // Use actual role for permissions (not viewing role)
      // God/Admin users can see all tournaments they created
      if (userActualRole === 'god' || userActualRole === 'admin') {
        query = db.collection('tournaments');
      } else {
        // Players can only see tournaments they're assigned to
        if (userProfile.assignedGameId) {
          query = db.collection('tournaments').where(firebase.firestore.FieldPath.documentId(), '==', userProfile.assignedGameId);
        } else {
          console.log('[AppRouter] Player has no assigned tournament');
          tournaments = [];
          populateTournamentDropdown();
          return;
        }
      }

      const snapshot = await query.get();
      tournaments = [];

      snapshot.forEach(doc => {
        tournaments.push({
          id: doc.id,
          ...doc.data()
        });
      });

      console.log('[AppRouter] Loaded tournaments:', tournaments.length);

      // Set active tournament (from user profile or first available)
      if (userProfile.assignedGameId) {
        activeTournamentId = userProfile.assignedGameId;
      } else if (tournaments.length > 0) {
        activeTournamentId = tournaments[0].id;
      }

      // Populate the tournament selector dropdown
      populateTournamentDropdown();

    } catch (error) {
      console.error('[AppRouter] Error loading tournaments:', error);
      console.error('[AppRouter] Error details:', error.message, error.code);
      tournaments = [];
      populateTournamentDropdown();
    }
  }

  /**
   * Populate tournament selector dropdown
   */
  function populateTournamentDropdown() {
    const dropdown = document.getElementById('tournamentDropdown');
    const activeTournamentNameEl = document.getElementById('activeTournamentName');

    if (!dropdown) return;

    // Find active tournament
    const activeTournament = tournaments.find(t => t.id === activeTournamentId);

    // Update active tournament name
    if (activeTournamentNameEl) {
      if (activeTournament) {
        activeTournamentNameEl.textContent = activeTournament.name || activeTournament.id || 'Tournament';
      } else if (tournaments.length === 0) {
        activeTournamentNameEl.textContent = 'No Tournaments';
      } else {
        activeTournamentNameEl.textContent = 'Select Tournament';
      }
    }

    // Build dropdown items
    let html = '';

    if (tournaments.length === 0) {
      html = `
        <div style="padding: 20px; text-align: center; color: #94a3b8;">
          <p>No tournaments available</p>
        </div>
      `;
    } else {
      tournaments.forEach(tournament => {
        const isActive = tournament.id === activeTournamentId;
        const displayName = tournament.name || tournament.id || 'Unnamed Tournament';
        html += `
          <button class="tournament-item ${isActive ? 'active' : ''}" onclick="window.appRouter.selectTournament('${tournament.id}', '${escapeHtml(displayName)}')">
            <span class="tournament-item-name">${escapeHtml(displayName)}</span>
            ${isActive ? '<span class="tournament-item-badge">⭐</span>' : ''}
          </button>
        `;
      });
    }

    // Add "Create Tournament" option for admins/gods (based on actual permissions)
    if (userActualRole === 'god' || userActualRole === 'admin') {
      html += `
        <button class="tournament-item create" onclick="window.appRouter.createTournament()">
          <span class="tournament-item-name">➕ Create New Tournament</span>
        </button>
      `;
    }

    dropdown.innerHTML = html;
  }

  /**
   * Initialize role switcher based on user permissions
   */
  function initializeRoleSwitcher() {
    const roleSwitcher = document.getElementById('roleSwitcher');
    if (!roleSwitcher) return;

    const adminBtn = roleSwitcher.querySelector('[data-role="admin"]');
    const playerBtn = roleSwitcher.querySelector('[data-role="player"]');

    // Determine which roles the user can access (based on actual permissions)
    const canBeAdmin = userActualRole === 'god' || userActualRole === 'admin';

    if (canBeAdmin) {
      // Admin/God users can switch between admin and player mode
      roleSwitcher.classList.remove('single-role');

      // Set active based on current viewing role
      if (userRole === 'god' || userRole === 'admin') {
        adminBtn.classList.add('active');
        playerBtn.classList.remove('active');
      } else {
        playerBtn.classList.add('active');
        adminBtn.classList.remove('active');
      }
    } else if (userActualRole === 'player') {
      // Pure players only see player mode (no switching)
      roleSwitcher.classList.add('single-role');
      playerBtn.classList.add('active');
      playerBtn.disabled = true;
      adminBtn.style.display = 'none';
    } else {
      // Regular users with no specific role - hide role switcher
      roleSwitcher.style.display = 'none';
    }
  }

  /**
   * Helper to escape HTML
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Build sidebar navigation based on user role
   */
  function buildSidebar() {
    const sidebar = document.getElementById('appSidebar');
    if (!sidebar) return;

    const navItems = NAVIGATION[userRole] || NAVIGATION.user;

    // Only show sidebar for god/admin/player roles
    if (userRole === 'god' || userRole === 'admin' || userRole === 'player') {
      sidebar.classList.remove('hidden');
    } else {
      sidebar.classList.add('hidden');
      return;
    }

    // Build navigation HTML
    const navHTML = `
      <div class="app-sidebar-section">
        <div class="app-sidebar-title">Navigation</div>
        <ul class="app-sidebar-nav">
          ${navItems.map(item => `
            <li class="app-sidebar-item">
              <a class="app-sidebar-link" data-module="${item.module}" data-hash="${item.hash || ''}" onclick="navigateToModule('${item.module}', '${item.hash || ''}'); return false;">
                <span class="app-sidebar-icon">${item.icon}</span>
                <span>${item.label}</span>
              </a>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    sidebar.innerHTML = navHTML;
  }

  /**
   * Get initial module from URL or default
   */
  function getInitialModule() {
    const urlParams = new URLSearchParams(window.location.search);
    const moduleParam = urlParams.get('module');

    if (moduleParam) {
      return moduleParam;
    }

    // Check URL hash for module routing (e.g., #admin-panel or #team-dashboard)
    const hash = window.location.hash.replace('#', '');
    if (hash && hash.includes('-')) {
      return hash;
    }

    // Default: dashboard
    return 'dashboard';
  }

  /**
   * Load a module into the content area
   */
  async function loadModule(moduleName, moduleHash = '') {
    console.log(`[AppRouter] Loading module: ${moduleName}`, moduleHash ? `with hash: ${moduleHash}` : '');

    const contentEl = document.getElementById('appContent');
    if (!contentEl) {
      console.error('[AppRouter] Content element not found');
      return;
    }

    try {
      // Show loading state
      showLoading();

      // Update active nav item
      updateActiveNavItem(moduleName, moduleHash);

      // Load module content
      let moduleContent;

      if (moduleName === 'dashboard') {
        moduleContent = await loadDashboardModule();
      } else if (moduleName === 'admin-panel') {
        moduleContent = await loadAdminPanelModule(moduleHash);
      } else if (moduleName === 'team-dashboard') {
        moduleContent = await loadTeamDashboardModule();
      } else if (moduleName === 'profile') {
        moduleContent = await loadProfileModule();
      } else if (moduleName === 'settings') {
        moduleContent = await loadSettingsModule();
      } else if (moduleName === 'help') {
        moduleContent = await loadHelpModule();
      } else {
        throw new Error(`Unknown module: ${moduleName}`);
      }

      // Inject module content
      contentEl.innerHTML = `<div class="app-module-container">${moduleContent}</div>`;

      // Execute module scripts (if any)
      executeModuleScripts(contentEl);

      // Update current module
      currentModule = moduleName;

      // Update URL without reload
      updateURL(moduleName, moduleHash);

      console.log(`[AppRouter] Module loaded: ${moduleName}${moduleHash ? ' (hash: ' + moduleHash + ')' : ''}`);

    } catch (error) {
      console.error('[AppRouter] Error loading module:', error);
      showError(`Error loading module: ${moduleName}`);
    }
  }

  /**
   * Load dashboard module (role-based home view)
   */
  async function loadDashboardModule() {
    // For now, return a placeholder
    // Later, we can create a dedicated dashboard module or use home.html content
    return `
      <div class="card">
        <h2>Welcome, ${userProfile.displayName || 'User'}!</h2>
        <p>Role: <strong>${userRole.toUpperCase()}</strong></p>
        <p>Use the sidebar to navigate to different sections.</p>
        ${userRole === 'god' ? '<p><strong>GOD MODE:</strong> You have complete control over the system.</p>' : ''}
        ${userRole === 'admin' ? '<p><strong>ADMIN:</strong> Manage tournaments, matches, and teams.</p>' : ''}
        ${userRole === 'player' ? '<p><strong>PLAYER:</strong> Check "My Team" to view your team dashboard.</p>' : ''}
      </div>
    `;
  }

  /**
   * Load admin panel module (god.html content)
   */
  async function loadAdminPanelModule(hash) {
    try {
      // Fetch the admin panel module HTML
      console.log('[AppRouter] Fetching admin panel module from: modules/admin-panel.html');
      const response = await fetch('modules/admin-panel.html');

      console.log('[AppRouter] Fetch response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`Failed to load admin panel module: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      console.log('[AppRouter] Admin panel module loaded successfully, length:', html.length);

      // Store the active tournament ID for the admin panel to use
      if (activeTournamentId) {
        console.log('[AppRouter] Storing active tournament ID in sessionStorage:', activeTournamentId);
        sessionStorage.setItem('currentGameId', activeTournamentId);
      }

      // Store hash for later use by the module
      if (hash) {
        console.log('[AppRouter] Storing hash in sessionStorage:', hash);
        sessionStorage.setItem('adminPanelHash', hash);
      }

      return html;
    } catch (error) {
      console.error('[AppRouter] Error loading admin panel:', error);
      console.error('[AppRouter] Error details:', error.message, error.stack);

      // Instead of redirecting, return an error message
      // Users can manually navigate to god.html if needed
      return `
        <div class="card" style="border-color: var(--red-500); background: rgba(239, 68, 68, 0.1);">
          <h2 style="color: var(--red-500);">⚠️ Error Loading Admin Panel</h2>
          <p>Failed to load the admin panel module.</p>
          <p><strong>Error:</strong> ${error.message}</p>
          <p style="margin-top: 20px;">
            <a href="god.html${hash ? '#' + hash : ''}" class="btn btn-primary">
              Open Full Admin Panel (god.html)
            </a>
          </p>
        </div>
      `;
    }
  }

  /**
   * Load team dashboard module (team.html content)
   */
  async function loadTeamDashboardModule() {
    // Check if user has team assignment
    if (!userProfile.assignedGameId || userProfile.assignedTeamId === undefined) {
      return `
        <div class="card">
          <h2>No Team Assignment</h2>
          <p>You have not been assigned to a team yet. Contact an administrator to be assigned to a tournament team.</p>
        </div>
      `;
    }

    try {
      // Store team info for the module to use
      sessionStorage.setItem('currentGameId', userProfile.assignedGameId);
      sessionStorage.setItem('currentTeamId', userProfile.assignedTeamId);

      // Fetch the team dashboard module HTML
      console.log('[AppRouter] Fetching team dashboard module from: modules/team-dashboard.html');
      const response = await fetch('modules/team-dashboard.html');

      console.log('[AppRouter] Fetch response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`Failed to load team dashboard module: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      console.log('[AppRouter] Team dashboard module loaded successfully, length:', html.length);
      return html;
    } catch (error) {
      console.error('[AppRouter] Error loading team dashboard:', error);
      console.error('[AppRouter] Error details:', error.message, error.stack);

      // Instead of redirecting, return an error message
      return `
        <div class="card" style="border-color: var(--red-500); background: rgba(239, 68, 68, 0.1);">
          <h2 style="color: var(--red-500);">⚠️ Error Loading Team Dashboard</h2>
          <p>Failed to load the team dashboard module.</p>
          <p><strong>Error:</strong> ${error.message}</p>
          <p style="margin-top: 20px;">
            <a href="team.html?gameId=${userProfile.assignedGameId}&teamId=${userProfile.assignedTeamId}" class="btn btn-primary">
              Open Full Team Dashboard (team.html)
            </a>
          </p>
        </div>
      `;
    }
  }

  /**
   * Load profile module
   */
  async function loadProfileModule() {
    try {
      const response = await fetch('modules/profile.html');
      if (!response.ok) {
        throw new Error('Failed to load profile module');
      }
      return await response.text();
    } catch (error) {
      console.error('[AppRouter] Error loading profile module:', error);
      return `
        <div class="card">
          <h2>My Profile</h2>
          <p>Error loading profile module. Please try again.</p>
        </div>
      `;
    }
  }

  /**
   * Load settings module
   */
  async function loadSettingsModule() {
    try {
      const response = await fetch('modules/settings.html');
      if (!response.ok) {
        throw new Error('Failed to load settings module');
      }
      return await response.text();
    } catch (error) {
      console.error('[AppRouter] Error loading settings module:', error);
      return `
        <div class="card">
          <h2>Settings</h2>
          <p>Error loading settings module. Please try again.</p>
        </div>
      `;
    }
  }

  /**
   * Load help module
   */
  async function loadHelpModule() {
    try {
      const response = await fetch('modules/help.html');
      if (!response.ok) {
        throw new Error('Failed to load help module');
      }
      return await response.text();
    } catch (error) {
      console.error('[AppRouter] Error loading help module:', error);
      return `
        <div class="card">
          <h2>Help & Support</h2>
          <p>Error loading help module. Please try again.</p>
        </div>
      `;
    }
  }

  /**
   * Execute scripts within a module
   */
  function executeModuleScripts(container) {
    const scripts = container.querySelectorAll('script');
    scripts.forEach(oldScript => {
      const scriptSrc = oldScript.getAttribute('src');

      // If this is an external script, check if it's already loaded
      if (scriptSrc) {
        if (loadedScripts.has(scriptSrc)) {
          console.log(`[AppRouter] Skipping already loaded script: ${scriptSrc}`);
          oldScript.remove(); // Remove the script tag to prevent duplicate loading
          return;
        }
        // Mark this script as loaded
        loadedScripts.add(scriptSrc);
        console.log(`[AppRouter] Loading external script: ${scriptSrc}`);
      }

      // Execute the script
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr =>
        newScript.setAttribute(attr.name, attr.value)
      );
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  /**
   * Update active navigation item
   */
  function updateActiveNavItem(moduleName, moduleHash) {
    const navLinks = document.querySelectorAll('.app-sidebar-link');
    navLinks.forEach(link => {
      const linkModule = link.getAttribute('data-module');
      const linkHash = link.getAttribute('data-hash');

      if (linkModule === moduleName && linkHash === moduleHash) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  /**
   * Update URL without reloading the page
   */
  function updateURL(moduleName, moduleHash) {
    const url = new URL(window.location);
    url.searchParams.set('module', moduleName);

    if (moduleHash) {
      url.hash = moduleHash;
    } else {
      url.hash = '';
    }

    window.history.pushState({}, '', url);
  }

  /**
   * Show loading state
   */
  function showLoading() {
    const contentEl = document.getElementById('appContent');
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="app-module-container">
          <div class="app-loading">
            <div class="app-loading-spinner"></div>
            <div class="app-loading-text">Loading module...</div>
          </div>
        </div>
      `;
    }
  }

  /**
   * Show error message
   */
  function showError(message) {
    const contentEl = document.getElementById('appContent');
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="app-module-container">
          <div class="card" style="border-color: var(--red-500); background: rgba(239, 68, 68, 0.1);">
            <h2 style="color: var(--red-500);">⚠️ Error</h2>
            <p>${message}</p>
            <button class="btn btn-primary" onclick="window.location.reload()">Reload Page</button>
          </div>
        </div>
      `;
    }
  }

  /**
   * Global navigation function (called from sidebar links)
   */
  window.navigateToModule = function(moduleName, moduleHash = '') {
    loadModule(moduleName, moduleHash);
  };

  /**
   * Expose appRouter API for global access
   */
  window.appRouter = {
    /**
     * Select a tournament
     */
    selectTournament: function(tournamentId, tournamentName) {
      console.log('[AppRouter] Selecting tournament:', tournamentId, tournamentName);

      activeTournamentId = tournamentId;

      // Store in sessionStorage so modules can access it
      sessionStorage.setItem('currentGameId', tournamentId);
      sessionStorage.setItem('currentGameName', tournamentName);
      console.log('[AppRouter] Stored tournament in sessionStorage:', tournamentId, tournamentName);

      // Update UI
      const label = document.getElementById('activeTournamentName');
      if (label) {
        label.textContent = tournamentName;
      }

      // Close dropdown
      const dropdown = document.getElementById('tournamentDropdown');
      const btn = document.getElementById('tournamentSelectorBtn');
      dropdown?.classList.remove('open');
      btn?.classList.remove('open');

      // Update dropdown to show active tournament
      populateTournamentDropdown();

      // Reload current module with new tournament context
      if (currentModule) {
        loadModule(currentModule);
      }
    },

    /**
     * Switch role (Admin/Player)
     */
    switchRole: function(role) {
      console.log('[AppRouter] Switching to role:', role);

      // Validate user can access this role (based on actual permissions)
      const canBeAdmin = userActualRole === 'god' || userActualRole === 'admin';

      if (role === 'admin' && !canBeAdmin) {
        alert('You do not have admin permissions');
        return;
      }

      // Update active role buttons
      const roleSwitcher = document.getElementById('roleSwitcher');
      if (roleSwitcher) {
        const buttons = roleSwitcher.querySelectorAll('.role-option');
        buttons.forEach(btn => {
          if (btn.getAttribute('data-role') === role) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      }

      // Update userRole variable for UI purposes
      // userActualRole stays the same (preserves permissions)
      if (role === 'admin') {
        userRole = userProfile.isGod ? 'god' : 'admin';
      } else {
        // When viewing as player, set role to 'player' for UI
        // But keep admin permissions in userActualRole
        userRole = 'player';
      }

      // Rebuild sidebar with new role navigation
      buildSidebar();

      // Reload dashboard or appropriate module
      loadModule('dashboard');
    },

    /**
     * Create new tournament
     */
    createTournament: function() {
      console.log('[AppRouter] Creating new tournament...');
      // For now, redirect to setup page
      // Later, we can create a tournament creation module
      window.location.href = 'setup.html';
    },

    /**
     * Navigate to a section
     */
    navigateTo: function(section) {
      console.log('[AppRouter] Navigating to:', section);

      // Map sections to modules
      const sectionMap = {
        'profile': 'profile',
        'settings': 'settings',
        'help': 'help'
      };

      const moduleName = sectionMap[section] || 'dashboard';
      loadModule(moduleName);
    },

    /**
     * Get active tournament ID
     */
    getActiveTournamentId: function() {
      return activeTournamentId;
    },

    /**
     * Get current user role (viewing mode)
     */
    getUserRole: function() {
      return userRole;
    },

    /**
     * Get actual user role (permissions)
     */
    getActualUserRole: function() {
      return userActualRole;
    },

    /**
     * Get user profile
     */
    getUserProfile: function() {
      return userProfile;
    }
  };

  /**
   * Handle browser back/forward buttons
   */
  window.addEventListener('popstate', function(event) {
    const module = getInitialModule();
    loadModule(module);
  });

})();
