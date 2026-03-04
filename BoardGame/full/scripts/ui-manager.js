/**
 * UIManager
 *
 * Handles status messages, game logging, connection monitoring,
 * and visual effects panel. Leaf module with no custom dependencies.
 */
class UIManager {

    constructor() {
        this._boardModule = null;
        this._boardRenderer = null;
    }

    // ------------------------------------------------------------------
    // Board references (set after BoardModule/Renderer are created)
    // ------------------------------------------------------------------

    setBoardModules(boardModule, boardRenderer) {
        this._boardModule = boardModule;
        this._boardRenderer = boardRenderer;
    }

    // ------------------------------------------------------------------
    // Status messages
    // ------------------------------------------------------------------

    showStatus(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
            return;
        }
        const statusEl = document.getElementById('statusMessage');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = `status-message ${type} visible`;
        setTimeout(() => { statusEl.classList.remove('visible'); }, 3000);
    }

    // ------------------------------------------------------------------
    // Game log
    // ------------------------------------------------------------------

    addLog(message, type = 'info') {
        const log = document.getElementById('gameLog');
        if (!log) {
            console.log(`[Log] ${message}`);
            return;
        }
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const timestamp = new Date().toLocaleTimeString();
        entry.innerHTML = `<span style="opacity: 0.7;">[${timestamp}]</span> ${message}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    clearLog() {
        const log = document.getElementById('gameLog');
        if (log) {
            log.innerHTML = '<div class="log-entry">Log cleared...</div>';
        }
    }

    // ------------------------------------------------------------------
    // Connection monitoring
    // ------------------------------------------------------------------

    updateConnectionStatus(status) {
        const indicator = document.getElementById('connectionStatus');
        if (!indicator) return;
        indicator.classList.remove('connected', 'disconnected', 'warning');
        indicator.classList.add(status);
        indicator.title = `Firebase: ${status}`;

        if (status === 'disconnected') {
            if (typeof showConnectionBanner === 'function') showConnectionBanner();
        } else {
            if (typeof hideConnectionBanner === 'function') hideConnectionBanner();
        }
    }

    initConnectionMonitor() {
        if (!navigator.onLine) {
            this.updateConnectionStatus('disconnected');
        }
        window.addEventListener('online', () => {
            this.updateConnectionStatus('connected');
        });
        window.addEventListener('offline', () => {
            this.updateConnectionStatus('disconnected');
        });
    }

    // ------------------------------------------------------------------
    // Visual effects panel
    // ------------------------------------------------------------------

    applyHexImages(enabled) {
        let styleEl = document.getElementById('hex-images-dynamic-css');

        if (!enabled) {
            if (styleEl) styleEl.remove();
            return;
        }

        if (!this._boardModule) return;

        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'hex-images-dynamic-css';
            document.head.appendChild(styleEl);
        }

        const hexCoords = this._boardModule.generateHexCoordinates();
        let css = '';
        hexCoords.forEach(([q, r]) => {
            const coord = `q${q}r${r}`;
            css += `body.effect-hex-images .board-hex[data-coord="${coord}"]::before {
                background-image: url('${(window.BOARDGAME_BASE || '.')}/shared/images/hexes/coords/${coord}.png');
            }\n`;
        });
        styleEl.textContent = css;
    }

    initEffectsPanel() {
        document.querySelectorAll('.effect-btn').forEach(btn => {
            const effectName = btn.dataset.effect;

            if (btn.classList.contains('active')) {
                document.body.classList.add(`effect-${effectName}`);
                if (effectName === 'hex-images') this.applyHexImages(true);
                if (effectName === 'heart-images' && this._boardRenderer) {
                    this._boardRenderer.toggleHeartImages(true);
                }
            }

            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                const isActive = btn.classList.contains('active');
                document.body.classList.toggle(`effect-${effectName}`, isActive);

                if (effectName === 'hex-images') this.applyHexImages(isActive);
                if (effectName === 'heart-images' && this._boardRenderer) {
                    this._boardRenderer.toggleHeartImages(isActive);
                }
            });
        });
    }
}

window.UIManager = UIManager;
