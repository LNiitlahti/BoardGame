/**
 * =============================================================================
 * BOARDGAME CONFIGURATION
 * Central configuration file for game-wide settings
 * =============================================================================
 *
 * This is the SINGLE SOURCE OF TRUTH for all configuration values.
 * All pages and scripts should import/reference this file.
 *
 * IMPORTANT: Do not define team colors anywhere else!
 */

/**
 * DEFAULT TEAM COLORS
 * Used as defaults when creating new teams.
 * Once a team is created, its color is stored in Firebase and loaded from there.
 *
 * Flow:
 * 1. New team created → gets color from this array
 * 2. Team saved to Firebase with that color
 * 3. On load → team color comes from Firebase (team.color property)
 * 4. If team.color is missing → fallback to this array
 */
const TEAM_COLORS = [
    '#ff4444', // Red - Team 1 default
    '#44ff44', // Green - Team 2 default
    '#4444ff', // Blue - Team 3 default
    '#ffff44', // Yellow - Team 4 default
    '#ff44ff', // Magenta - Team 5 default
    '#44ffff', // Cyan - Team 6 default
    '#ff8844', // Orange - Team 7 default
    '#8844ff'  // Purple - Team 8 default
];

/**
 * DEFAULT COLOR - Used when team color is not found
 */
const DEFAULT_COLOR = '#888888'; // Gray

/**
 * Get team color by team ID
 * Priority:
 * 1. If gameState exists and team has a color → use team.color from Firebase
 * 2. Otherwise → use default color from TEAM_COLORS array
 *
 * @param {number} teamId - The team's ID (1-based)
 * @param {Object} gameState - Optional game state object with teams
 * @returns {string} - Hex color code
 */
function getTeamColor(teamId, gameState = null) {
    // Try to get color from loaded team data (Firebase)
    if (gameState && gameState.teams) {
        const team = gameState.teams.find(t => t.id === teamId);
        if (team && team.color) {
            return team.color;
        }
    }

    // Try to get from global gameState if not passed
    if (typeof window !== 'undefined' && window.gameState && window.gameState.teams) {
        const team = window.gameState.teams.find(t => t.id === teamId);
        if (team && team.color) {
            return team.color;
        }
    }

    // Fallback to default colors (1-based indexing)
    return TEAM_COLORS[(teamId - 1) % TEAM_COLORS.length] || DEFAULT_COLOR;
}

/**
 * Get default color for a new team being created
 * Used in setup wizards and team creation forms
 *
 * @param {number} teamIndex - 0-based index in the teams array
 * @returns {string} - Hex color code
 */
function getDefaultTeamColor(teamIndex) {
    return TEAM_COLORS[teamIndex % TEAM_COLORS.length] || DEFAULT_COLOR;
}

/**
 * Inject team colors as CSS variables
 * This allows CSS to use the configured colors
 * Call this on page load after config is loaded
 */
function injectTeamColorsCSS() {
    const root = document.documentElement;
    TEAM_COLORS.forEach((color, index) => {
        const teamNumber = index + 1;
        root.style.setProperty(`--team${teamNumber}-color`, color);
    });
    root.style.setProperty(`--default-team-color`, DEFAULT_COLOR);
    console.log('[Config] Team colors injected as CSS variables');
}

/**
 * Get all team colors
 * @returns {Array<string>} - Array of hex color codes
 */
function getAllTeamColors() {
    return [...TEAM_COLORS];
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

// ES6 Module export (for modern scripts using import/export)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TEAM_COLORS,
        DEFAULT_COLOR,
        getTeamColor,
        getDefaultTeamColor,
        injectTeamColorsCSS,
        getAllTeamColors
    };
}

// Browser global export (for scripts loaded via <script> tag)
if (typeof window !== 'undefined') {
    window.TEAM_COLORS = TEAM_COLORS;
    window.DEFAULT_COLOR = DEFAULT_COLOR;
    window.getTeamColor = getTeamColor;
    window.getDefaultTeamColor = getDefaultTeamColor;
    window.injectTeamColorsCSS = injectTeamColorsCSS;
    window.getAllTeamColors = getAllTeamColors;

    console.log('[Config] Loaded - Team colors available globally');

    // Auto-inject CSS variables on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectTeamColorsCSS);
    } else {
        injectTeamColorsCSS();
    }
}
