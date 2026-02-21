/**
 * ============================================================================
 * TOAST.JS - Non-blocking toast notifications + connection banner + loading states
 * ============================================================================
 * Shared across all lightweight pages. Replaces browser alert() calls.
 *
 * Usage:
 *   showToast('Message', 'success');           // Auto-dismiss in 3s
 *   showToast('Error!', 'error', 5000);        // Custom duration
 *   showToast('Important', 'warning', 0);      // No auto-dismiss (manual close)
 *
 * Connection banner:
 *   showConnectionBanner();   // Show offline warning
 *   hideConnectionBanner();   // Hide it
 *   window._isOffline         // Check if offline (for save guards)
 *
 * Loading states:
 *   const done = btnLoading(buttonElement);  // Start loading
 *   done();                                  // Stop loading
 * ============================================================================
 */

(function () {
    'use strict';

    // --- Toast Container ---
    let container = null;

    function ensureContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    const ICONS = {
        success: '\u2714',  // checkmark
        error: '\u2716',    // x mark
        warning: '\u26A0',  // warning triangle
        info: '\u2139'      // info circle
    };

    /**
     * Show a non-blocking toast notification
     * @param {string} message - Text to display
     * @param {string} [type='info'] - success | error | warning | info
     * @param {number} [duration=3000] - Auto-dismiss ms (0 = manual close only)
     */
    function showToast(message, type, duration) {
        if (type === undefined) type = 'info';
        if (duration === undefined) {
            duration = type === 'error' ? 5000 : 3000;
        }

        ensureContainer();

        var toast = document.createElement('div');
        toast.className = 'toast ' + type;

        var icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.textContent = ICONS[type] || ICONS.info;

        var content = document.createElement('span');
        content.className = 'toast-content';
        content.textContent = message;

        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = function () { removeToast(toast); };

        toast.appendChild(icon);
        toast.appendChild(content);
        toast.appendChild(closeBtn);

        // Progress bar for auto-dismiss
        if (duration > 0) {
            var progress = document.createElement('div');
            progress.className = 'toast-progress';
            progress.style.width = '100%';
            toast.appendChild(progress);

            // Start progress animation after paint
            requestAnimationFrame(function () {
                progress.style.transitionDuration = duration + 'ms';
                progress.style.width = '0%';
            });
        }

        // Click anywhere on toast to dismiss
        toast.addEventListener('click', function (e) {
            if (e.target !== closeBtn) removeToast(toast);
        });

        container.appendChild(toast);

        // Trigger enter animation
        requestAnimationFrame(function () {
            toast.classList.add('visible');
        });

        // Auto-dismiss
        if (duration > 0) {
            toast._timeout = setTimeout(function () {
                removeToast(toast);
            }, duration);
        }

        // Limit max visible toasts
        var toasts = container.querySelectorAll('.toast');
        if (toasts.length > 5) {
            removeToast(toasts[0]);
        }

        return toast;
    }

    function removeToast(toast) {
        if (!toast || toast._removing) return;
        toast._removing = true;

        if (toast._timeout) clearTimeout(toast._timeout);
        toast.classList.remove('visible');
        toast.classList.add('removing');

        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }


    // --- Connection Banner ---

    var banner = null;
    window._isOffline = false;

    function ensureBanner() {
        if (banner && document.body.contains(banner)) return banner;
        banner = document.createElement('div');
        banner.className = 'connection-banner';
        banner.innerHTML = '<span class="banner-dot"></span> Connection lost. Changes may not be saved.';
        document.body.appendChild(banner);
        return banner;
    }

    function showConnectionBanner() {
        window._isOffline = true;
        ensureBanner();
        banner.classList.add('active');
    }

    function hideConnectionBanner() {
        window._isOffline = false;
        if (banner) banner.classList.remove('active');
    }


    // --- Button Loading State ---

    /**
     * Put a button into loading state. Returns a function to stop loading.
     * @param {HTMLElement} btn - The button element
     * @returns {Function} Call this to restore the button
     */
    function btnLoading(btn) {
        if (!btn) return function () {};
        var origText = btn.textContent;
        var origDisabled = btn.disabled;
        btn.disabled = true;
        btn.classList.add('btn-loading');

        return function () {
            btn.disabled = origDisabled;
            btn.classList.remove('btn-loading');
            btn.textContent = origText;
        };
    }


    // --- Expose globally ---
    window.showToast = showToast;
    window.showConnectionBanner = showConnectionBanner;
    window.hideConnectionBanner = hideConnectionBanner;
    window.btnLoading = btnLoading;

})();
