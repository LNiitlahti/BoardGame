/**
 * ===========================
 * UTILITY FUNCTIONS
 * ===========================
 * Common helper functions used throughout the application
 * Based on best practices from Juhlakaveri project
 */

// ===========================
// XSS PROTECTION
// ===========================

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return str;

  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  return str.replace(/[&<>"'/]/g, char => escapeMap[char]);
}

/**
 * Sanitize HTML (allow only safe tags)
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html) {
  const temp = document.createElement('div');
  temp.textContent = html;
  return temp.innerHTML;
}

// ===========================
// DATE & TIME FORMATTING
// ===========================

/**
 * Format timestamp to relative time (e.g., "2 hours ago")
 * @param {string|Date|number} timestamp - Timestamp to format
 * @returns {string} Relative time string
 */
export function timeAgo(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days ago`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months ago`;
  return `${Math.floor(seconds / 31536000)} years ago`;
}

/**
 * Format date to readable string
 * @param {string|Date|number} timestamp - Timestamp to format
 * @param {boolean} includeTime - Include time in output
 * @returns {string} Formatted date string
 */
export function formatDate(timestamp, includeTime = false) {
  const date = new Date(timestamp);

  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };

  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return date.toLocaleDateString('en-US', options);
}

/**
 * Format timestamp to ISO date string (YYYY-MM-DD)
 * @param {string|Date|number} timestamp - Timestamp to format
 * @returns {string} ISO date string
 */
export function toISODate(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10);
}

// ===========================
// DOM HELPERS
// ===========================

/**
 * Get element by ID with error handling
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} Element or null
 */
export function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`[Utils] Element with id "${id}" not found`);
  }
  return element;
}

/**
 * Create element with attributes
 * @param {string} tag - HTML tag name
 * @param {Object} attributes - Attributes to set
 * @param {string} content - Inner HTML content
 * @returns {HTMLElement} Created element
 */
export function createElement(tag, attributes = {}, content = '') {
  const element = document.createElement(tag);

  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else {
      element.setAttribute(key, value);
    }
  });

  if (content) {
    element.innerHTML = content;
  }

  return element;
}

/**
 * Toggle element visibility
 * @param {string|HTMLElement} element - Element or ID
 * @param {boolean} visible - Force visible/hidden (optional)
 */
export function toggle(element, visible = null) {
  const el = typeof element === 'string' ? getElement(element) : element;
  if (!el) return;

  if (visible === null) {
    el.style.display = el.style.display === 'none' ? '' : 'none';
  } else {
    el.style.display = visible ? '' : 'none';
  }
}

/**
 * Show element
 * @param {string|HTMLElement} element - Element or ID
 */
export function show(element) {
  const el = typeof element === 'string' ? getElement(element) : element;
  if (el) el.style.display = '';
}

/**
 * Hide element
 * @param {string|HTMLElement} element - Element or ID
 */
export function hide(element) {
  const el = typeof element === 'string' ? getElement(element) : element;
  if (el) el.style.display = 'none';
}

/**
 * DOM cache for frequently accessed elements
 */
export class DOMCache {
  constructor() {
    this.cache = {};
  }

  get(id) {
    if (!this.cache[id]) {
      this.cache[id] = document.getElementById(id);
    }
    return this.cache[id];
  }

  clear() {
    this.cache = {};
  }
}

// ===========================
// STRING HELPERS
// ===========================

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate string with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
export function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Generate random ID
 * @param {number} length - Length of ID
 * @returns {string} Random ID
 */
export function generateId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Slugify string (convert to URL-safe format)
 * @param {string} str - String to slugify
 * @returns {string} Slugified string
 */
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ===========================
// OBJECT HELPERS
// ===========================

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
export function deepMerge(target, source) {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

/**
 * Check if value is a plain object
 * @param {*} item - Value to check
 * @returns {boolean} True if plain object
 */
function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Clean object for Firebase (remove undefined values)
 * @param {*} obj - Object to clean
 * @returns {*} Cleaned object
 */
export function cleanObject(obj) {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => cleanObject(item)).filter(item => item !== undefined);
  }

  if (typeof obj === 'object') {
    const cleaned = {};
    for (const key in obj) {
      const value = cleanObject(obj[key]);
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  return obj;
}

// ===========================
// ARRAY HELPERS
// ===========================

/**
 * Shuffle array (Fisher-Yates algorithm)
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
export function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Get random item from array
 * @param {Array} array - Array to pick from
 * @returns {*} Random item
 */
export function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Chunk array into smaller arrays
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array} Array of chunks
 */
export function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Group array by key
 * @param {Array} array - Array to group
 * @param {string|Function} key - Key or function to group by
 * @returns {Object} Grouped object
 */
export function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = typeof key === 'function' ? key(item) : item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
}

// ===========================
// NUMBER HELPERS
// ===========================

/**
 * Clamp number between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation
 * @param {number} start - Start value
 * @param {number} end - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(start, end, t) {
  return start + (end - start) * t;
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
export function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ===========================
// ASYNC HELPERS
// ===========================

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// ===========================
// COLOR HELPERS
// ===========================

/**
 * Get team color by ID
 * @param {number} teamId - Team ID
 * @returns {string} Hex color code
 */
export function getTeamColor(teamId) {
  const colors = {
    1: '#ef4444', // Red
    2: '#10b981', // Green
    3: '#3b82f6', // Blue
    4: '#f59e0b', // Yellow/Orange
    5: '#a855f7'  // Purple
  };
  return colors[teamId] || '#6b7280'; // Default gray
}

/**
 * Convert hex color to RGB
 * @param {string} hex - Hex color (e.g., "#ff0000")
 * @returns {Object} {r, g, b}
 */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// ===========================
// LOCAL STORAGE HELPERS
// ===========================

/**
 * Safe localStorage get with JSON parsing
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Parsed value or default
 */
export function storageGet(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`[Utils] Error reading from localStorage:`, error);
    return defaultValue;
  }
}

/**
 * Safe localStorage set with JSON stringify
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 */
export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`[Utils] Error writing to localStorage:`, error);
  }
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 */
export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`[Utils] Error removing from localStorage:`, error);
  }
}

// ===========================
// EXPORTS & GLOBAL ACCESS
// ===========================

// Make utilities available globally for HTML onclick handlers
if (typeof window !== 'undefined') {
  window.utils = {
    escapeHtml,
    sanitizeHtml,
    timeAgo,
    formatDate,
    toISODate,
    getElement,
    createElement,
    toggle,
    show,
    hide,
    capitalize,
    truncate,
    generateId,
    slugify,
    deepClone,
    deepMerge,
    cleanObject,
    shuffle,
    randomItem,
    chunk,
    groupBy,
    clamp,
    lerp,
    formatNumber,
    sleep,
    debounce,
    throttle,
    getTeamColor,
    hexToRgb,
    storageGet,
    storageSet,
    storageRemove
  };

  // Also export DOMCache
  window.DOMCache = DOMCache;
}

// Log initialization
console.log('[Utils] Module loaded and ready');
