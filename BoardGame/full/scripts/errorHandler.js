/**
 * ===========================
 * GLOBAL ERROR HANDLER WITH TOAST NOTIFICATIONS
 * ===========================
 * Centralized error handling for the entire application
 * Provides user-friendly error messages and toast notifications
 * Based on best practices from Juhlakaveri project
 */

class ErrorHandler {
  constructor() {
    this.toastElement = null;
    this.toastQueue = [];
    this.isShowingToast = false;
    this.initToast();
    this.setupGlobalErrorHandlers();
  }

  // ===========================
  // INITIALIZATION
  // ===========================

  /**
   * Initialize toast notification element
   * Creates the DOM element if it doesn't exist
   */
  initToast() {
    // Check if toast already exists
    this.toastElement = document.getElementById('toast');

    if (!this.toastElement) {
      // Create toast element
      this.toastElement = document.createElement('div');
      this.toastElement.id = 'toast';
      this.toastElement.className = 'toast';
      document.body.appendChild(this.toastElement);
    }

    console.log('[ErrorHandler] Toast notification system initialized');
  }

  /**
   * Setup global error handlers
   * Catches unhandled errors and promise rejections
   */
  setupGlobalErrorHandlers() {
    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      console.error('[ErrorHandler] Uncaught error:', event.error);
      this.showError('An unexpected error occurred. Please try again.');

      // Prevent default browser error handling
      return false;
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[ErrorHandler] Unhandled promise rejection:', event.reason);
      this.showError('An unexpected error occurred. Please try again.');

      // Prevent default browser error handling
      event.preventDefault();
    });

    console.log('[ErrorHandler] Global error handlers installed');
  }

  // ===========================
  // TOAST NOTIFICATIONS
  // ===========================

  /**
   * Show a toast notification
   * @param {string} message - Message to display
   * @param {string} type - Type: 'info', 'success', 'warning', 'error'
   * @param {number} duration - Display duration in milliseconds
   */
  showToast(message, type = 'info', duration = 3000) {
    this.toastQueue.push({ message, type, duration });

    if (!this.isShowingToast) {
      this.processToastQueue();
    }
  }

  /**
   * Process toast queue (show toasts one by one)
   */
  processToastQueue() {
    if (this.toastQueue.length === 0) {
      this.isShowingToast = false;
      return;
    }

    this.isShowingToast = true;
    const { message, type, duration } = this.toastQueue.shift();

    // Ensure toast element exists
    if (!this.toastElement) {
      this.initToast();
    }

    // Update toast content and style
    this.toastElement.textContent = message;
    this.toastElement.className = `toast toast-${type}`;
    this.toastElement.classList.add('show');

    console.log(`[ErrorHandler] Toast (${type}): ${message}`);

    // Hide after duration
    setTimeout(() => {
      this.toastElement.classList.remove('show');

      // Wait for fade-out animation before showing next
      setTimeout(() => this.processToastQueue(), 300);
    }, duration);
  }

  /**
   * Show error toast
   * @param {string} message - Error message
   * @param {number} duration - Display duration (default 4s)
   */
  showError(message, duration = 4000) {
    this.showToast(message, 'error', duration);
  }

  /**
   * Show success toast
   * @param {string} message - Success message
   * @param {number} duration - Display duration (default 3s)
   */
  showSuccess(message, duration = 3000) {
    this.showToast(message, 'success', duration);
  }

  /**
   * Show warning toast
   * @param {string} message - Warning message
   * @param {number} duration - Display duration (default 3.5s)
   */
  showWarning(message, duration = 3500) {
    this.showToast(message, 'warning', duration);
  }

  /**
   * Show info toast
   * @param {string} message - Info message
   * @param {number} duration - Display duration (default 3s)
   */
  showInfo(message, duration = 3000) {
    this.showToast(message, 'info', duration);
  }

  // ===========================
  // FIREBASE ERROR HANDLING
  // ===========================

  /**
   * Handle Firebase-specific errors
   * Maps Firebase error codes to user-friendly messages
   * @param {Error} error - Firebase error object
   * @param {string} context - Context where error occurred
   * @returns {string} User-friendly error message
   */
  handleFirebaseError(error, context = '') {
    console.error(`[ErrorHandler] Firebase error in ${context}:`, error);

    // Firebase error code mapping
    const errorMessages = {
      // Authentication errors
      'auth/user-not-found': 'No account found with this email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/email-already-in-use': 'This email is already registered.',
      'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
      'auth/invalid-email': 'Invalid email address.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/too-many-requests': 'Too many failed attempts. Please try again later.',

      // Firestore errors
      'permission-denied': 'You don\'t have permission to perform this action.',
      'unavailable': 'Service temporarily unavailable. Please try again.',
      'not-found': 'Requested data not found.',
      'already-exists': 'This item already exists.',
      'deadline-exceeded': 'Request timed out. Please try again.',
      'unauthenticated': 'Please log in to continue.',
      'cancelled': 'Operation was cancelled.',
      'data-loss': 'Data loss detected. Please contact support.',
      'failed-precondition': 'Operation cannot be performed in current state.',
      'out-of-range': 'Invalid value provided.',
      'unimplemented': 'Operation is not implemented.',
      'internal': 'Internal server error. Please try again.',
      'resource-exhausted': 'Resource limit exceeded. Please try again later.',

      // Network errors
      'network-request-failed': 'Network error. Please check your connection.',
    };

    // Get user-friendly message
    const message = errorMessages[error.code] || 'An error occurred. Please try again.';

    // Show error toast
    this.showError(message);

    return message;
  }

  // ===========================
  // CUSTOM ERROR DISPLAY
  // ===========================

  /**
   * Display error in a specific element
   * @param {string} elementId - ID of element to show error in
   * @param {string} message - Error message
   * @param {string} type - Type: 'error', 'warning', 'info'
   */
  showInElement(elementId, message, type = 'error') {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`[ErrorHandler] Element ${elementId} not found`);
      return;
    }

    element.textContent = message;
    element.className = `message message-${type}`;
    element.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
      element.style.display = 'none';
    }, 5000);
  }

  /**
   * Clear error from element
   * @param {string} elementId - ID of element to clear
   */
  clearElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = '';
      element.style.display = 'none';
    }
  }

  // ===========================
  // VALIDATION HELPERS
  // ===========================

  /**
   * Validate required fields
   * @param {Object} fields - Object with {fieldName: value}
   * @returns {Object} {valid: boolean, missing: Array}
   */
  validateRequired(fields) {
    const missing = [];

    for (const [name, value] of Object.entries(fields)) {
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      this.showError(`Please fill in: ${missing.join(', ')}`);
      return { valid: false, missing };
    }

    return { valid: true, missing: [] };
  }

  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} Valid or not
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email);

    if (!isValid) {
      this.showError('Please enter a valid email address');
    }

    return isValid;
  }
}

// ===========================
// FIREBASE RETRY WRAPPER
// ===========================

/**
 * Retry a Firebase operation with exponential backoff
 * @param {Function} operation - Async operation to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Initial delay in milliseconds
 * @returns {Promise} Result of operation
 */
export async function retryFirebaseOperation(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`[ErrorHandler] Attempt ${attempt} failed:`, error);

      // Don't retry on certain errors
      if (error.code === 'permission-denied' ||
          error.code === 'not-found' ||
          error.code === 'unauthenticated') {
        throw error;
      }

      // If last attempt, give up
      if (attempt === maxRetries) {
        errorHandler.handleFirebaseError(error, 'retryOperation');
        throw error;
      }

      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
}

// ===========================
// EXPORTS
// ===========================

// Create global instance
export const errorHandler = new ErrorHandler();

// Make available globally for HTML onclick handlers
if (typeof window !== 'undefined') {
  window.errorHandler = errorHandler;
  window.retryFirebaseOperation = retryFirebaseOperation;
}

// Log initialization
console.log('[ErrorHandler] Module loaded and ready');
