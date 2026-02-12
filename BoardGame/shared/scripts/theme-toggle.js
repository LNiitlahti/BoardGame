/**
 * GLOBAL THEME TOGGLE
 * Dark/Light mode toggle that works across all pages
 * Remembers user preference in localStorage
 */

(function() {
    'use strict';

    const THEME_KEY = 'theme-preference';
    const DARK_MODE_CLASS = 'dark-mode';

    /**
     * Initialize theme on page load
     */
    function initTheme() {
        // Check localStorage for saved preference
        const savedTheme = localStorage.getItem(THEME_KEY);

        // If no saved preference, check system preference
        if (!savedTheme) {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (prefersDark) {
                enableDarkMode();
            }
        } else if (savedTheme === 'dark') {
            enableDarkMode();
        }

        // Theme toggle button is now in the navbar (navbar.js handles creation)
        // Just update any existing navbar button
        updateToggleButton();

        console.log('[Theme] Initialized with theme:', isDarkMode() ? 'dark' : 'light');
    }

    /**
     * Check if dark mode is currently active
     */
    function isDarkMode() {
        return document.body.classList.contains(DARK_MODE_CLASS);
    }

    /**
     * Enable dark mode
     */
    function enableDarkMode() {
        document.body.classList.add(DARK_MODE_CLASS);
        localStorage.setItem(THEME_KEY, 'dark');
    }

    /**
     * Disable dark mode (enable light mode)
     */
    function disableDarkMode() {
        document.body.classList.remove(DARK_MODE_CLASS);
        localStorage.setItem(THEME_KEY, 'light');
    }

    /**
     * Toggle between dark and light mode
     */
    function toggleTheme() {
        if (isDarkMode()) {
            disableDarkMode();
        } else {
            enableDarkMode();
        }

        // Update toggle button appearance
        updateToggleButton();

        console.log('[Theme] Toggled to:', isDarkMode() ? 'dark' : 'light');
    }

    /**
     * Update toggle button icon
     */
    function updateToggleButton(button = null) {
        try {
            const btn = button || document.getElementById('themeToggle');
            const navbarBtn = document.getElementById('themeToggleNavbar');

            if (isDarkMode()) {
                // Sun icon for light mode
                if (btn) {
                    btn.innerHTML = '☀️';
                    btn.title = 'Switch to light mode';
                }
                if (navbarBtn) {
                    navbarBtn.innerHTML = '☀️';
                    navbarBtn.title = 'Switch to light mode';
                }
            } else {
                // Moon icon for dark mode
                if (btn) {
                    btn.innerHTML = '🌙';
                    btn.title = 'Switch to dark mode';
                }
                if (navbarBtn) {
                    navbarBtn.innerHTML = '🌙';
                    navbarBtn.title = 'Switch to dark mode';
                }
            }
        } catch (error) {
            console.error('[Theme] Error updating toggle button:', error);
        }
    }

    /**
     * Listen for system theme changes
     */
    function setupSystemThemeListener() {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

        darkModeQuery.addEventListener('change', (e) => {
            // Only auto-switch if user hasn't set a preference
            if (!localStorage.getItem(THEME_KEY)) {
                if (e.matches) {
                    enableDarkMode();
                } else {
                    disableDarkMode();
                }
                updateToggleButton();
            }
        });
    }

    // Initialize when DOM is ready
    function safeInit() {
        try {
            initTheme();
        } catch (error) {
            console.error('[Theme] Error during initialization:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeInit);
    } else {
        // Wait a tick to ensure body is available
        setTimeout(safeInit, 0);
    }

    // Setup system theme listener
    setupSystemThemeListener();

    // Expose toggle function globally for manual calls
    window.toggleTheme = toggleTheme;
    window.isDarkMode = isDarkMode;

})();
