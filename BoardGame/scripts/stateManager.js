/**
 * ===========================
 * STATE MANAGEMENT SYSTEM
 * ===========================
 * Centralized state management with pub/sub pattern
 * Based on best practices from Juhlakaveri project
 */

// ===========================
// STATE MANAGER CLASS
// ===========================

/**
 * StateManager - Manages application state with reactive updates
 * Uses pub/sub pattern to notify listeners of state changes
 */
export class StateManager {
  constructor() {
    this.state = {};
    this.listeners = {};
  }

  /**
   * Get a state value
   * @param {string} key - State key
   * @returns {*} State value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Set a state value
   * @param {string} key - State key
   * @param {*} value - New value
   */
  set(key, value) {
    const oldValue = this.state[key];
    this.state[key] = value;

    // Only notify if value actually changed
    if (oldValue !== value) {
      this.notifyListeners(key, value, oldValue);
    }
  }

  /**
   * Update multiple state values at once
   * @param {Object} updates - Object with key-value pairs
   */
  update(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch
   * @param {Function} callback - Callback(newValue, oldValue)
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this.listeners[key]) {
      this.listeners[key] = [];
    }
    this.listeners[key].push(callback);

    // Return unsubscribe function
    return () => {
      this.listeners[key] = this.listeners[key].filter(cb => cb !== callback);
    };
  }

  /**
   * Notify all listeners of a state change
   * @param {string} key - State key that changed
   * @param {*} newValue - New value
   * @param {*} oldValue - Old value
   */
  notifyListeners(key, newValue, oldValue) {
    if (this.listeners[key]) {
      this.listeners[key].forEach(callback => {
        try {
          callback(newValue, oldValue);
        } catch (error) {
          console.error(`[StateManager] Error in listener for ${key}:`, error);
        }
      });
    }
  }

  /**
   * Clear all state
   */
  clear() {
    this.state = {};
    this.listeners = {};
  }

  /**
   * Get all state (immutable copy)
   * @returns {Object} Copy of entire state
   */
  getAll() {
    return { ...this.state };
  }

  /**
   * Check if a key exists in state
   * @param {string} key - State key
   * @returns {boolean}
   */
  has(key) {
    return key in this.state;
  }

  /**
   * Remove a key from state
   * @param {string} key - State key to remove
   */
  remove(key) {
    const oldValue = this.state[key];
    delete this.state[key];
    this.notifyListeners(key, undefined, oldValue);
  }
}

// ===========================
// CONNECTION STATUS MANAGER
// ===========================

/**
 * ConnectionStatusManager - Monitors online/offline status
 * Updates UI and state based on network connectivity
 */
export class ConnectionStatusManager {
  constructor() {
    this.isConnected = navigator.onLine;
    this.setupEventListeners();
  }

  /**
   * Setup online/offline event listeners
   */
  setupEventListeners() {
    window.addEventListener('online', () => {
      this.isConnected = true;
      appState.set('isOnline', true);
      appState.set('connectionStatus', 'connected');
      this.updateUI('connected');

      console.log('[ConnectionStatus] Online');

      // Show success toast if errorHandler is available
      if (window.errorHandler) {
        window.errorHandler.showSuccess('Connection restored');
      }
    });

    window.addEventListener('offline', () => {
      this.isConnected = false;
      appState.set('isOnline', false);
      appState.set('connectionStatus', 'disconnected');
      this.updateUI('disconnected');

      console.log('[ConnectionStatus] Offline');

      // Show warning toast if errorHandler is available
      if (window.errorHandler) {
        window.errorHandler.showWarning('Connection lost. Changes will sync when online.');
      }
    });
  }

  /**
   * Start monitoring and set initial status
   */
  start() {
    const status = navigator.onLine ? 'connected' : 'disconnected';
    appState.set('isOnline', navigator.onLine);
    appState.set('connectionStatus', status);
    this.updateUI(status);

    console.log(`[ConnectionStatus] Monitoring started - ${status}`);
  }

  /**
   * Update connection status UI indicator
   * @param {string} status - 'connected' or 'disconnected'
   */
  updateUI(status) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;

    statusEl.className = 'connection-dot';
    statusEl.classList.add(status);
    statusEl.setAttribute('aria-label', status === 'connected' ? 'Connected' : 'Disconnected');
    statusEl.title = status === 'connected' ? 'Connected' : 'Disconnected';
  }

  /**
   * Check current connection status
   * @returns {boolean} True if connected
   */
  isOnline() {
    return this.isConnected;
  }
}

// ===========================
// GLOBAL INSTANCES
// ===========================

/**
 * Global state manager instance
 * Use this throughout the application for state management
 */
export const appState = new StateManager();

/**
 * Global connection status manager instance
 */
export const connectionManager = new ConnectionStatusManager();

// ===========================
// INITIALIZE DEFAULT STATE
// ===========================

appState.update({
  // User state
  currentUser: null,
  userProfile: null,
  isAdmin: false,

  // Game state
  currentGame: null,
  currentMatch: null,
  selectedTeam: null,
  boardState: null,

  // Turn state
  currentTurn: null,

  // Connection state
  connectionStatus: 'disconnected',
  isOnline: navigator.onLine,

  // UI state
  activeTab: 'plan',
  sidebarOpen: false,

  // Loading state
  isLoading: false,
  loadingMessage: ''
});

// ===========================
// STATE HELPERS
// ===========================

/**
 * Create a computed state value
 * Automatically updates when dependencies change
 * @param {string} key - Key to store computed value
 * @param {Array<string>} dependencies - State keys to watch
 * @param {Function} computeFn - Function to compute value
 */
export function createComputed(key, dependencies, computeFn) {
  // Subscribe to all dependencies
  dependencies.forEach(dep => {
    appState.subscribe(dep, () => {
      // Recompute value
      const depValues = dependencies.map(d => appState.get(d));
      const newValue = computeFn(...depValues);
      appState.set(key, newValue);
    });
  });

  // Initial computation
  const depValues = dependencies.map(d => appState.get(d));
  const initialValue = computeFn(...depValues);
  appState.set(key, initialValue);
}

/**
 * Create a persisted state value (localStorage)
 * @param {string} key - State key
 * @param {*} defaultValue - Default value if not in localStorage
 */
export function createPersisted(key, defaultValue) {
  // Load from localStorage
  const stored = localStorage.getItem(`state_${key}`);
  const initialValue = stored ? JSON.parse(stored) : defaultValue;
  appState.set(key, initialValue);

  // Subscribe to changes and save to localStorage
  appState.subscribe(key, (newValue) => {
    localStorage.setItem(`state_${key}`, JSON.stringify(newValue));
  });
}

/**
 * Batch state updates (only notify once at the end)
 * @param {Function} updateFn - Function that makes state updates
 */
export function batchUpdates(updateFn) {
  const updates = {};

  // Temporarily override set method to collect updates
  const originalSet = appState.set.bind(appState);
  appState.set = (key, value) => {
    updates[key] = value;
  };

  // Execute updates
  updateFn();

  // Restore original set method
  appState.set = originalSet;

  // Apply all updates at once
  appState.update(updates);
}

// ===========================
// MAKE AVAILABLE GLOBALLY
// ===========================

if (typeof window !== 'undefined') {
  window.appState = appState;
  window.connectionManager = connectionManager;
  window.createComputed = createComputed;
  window.createPersisted = createPersisted;
  window.batchUpdates = batchUpdates;
}

// Log initialization
console.log('[StateManager] Module loaded and ready');
console.log('[StateManager] Initial state:', appState.getAll());
