/**
 * ChatOverlay — read-only tournament chat on the big screen.
 *
 * Subscribes to the same tournaments/{tid}/chatTournament collection that
 * shared/scripts/chat-module.js writes to, and renders each newly-arriving
 * message as a transient toast in a bottom-left stack on view.html. Display
 * only: no input, no send path, no posting rights required. An anonymous
 * spectator session can read this collection (the Firestore rule is
 * `allow read: if isAuthenticated()`), so it works on an unattended display.
 *
 * Requested in the 2026-08-05 Discord thread: show a message for 5-10s with
 * the sender's name in their team colour, then fade it away.
 *
 * Usage (view.html):
 *   <script defer src="scripts/chat-overlay.js"></script>
 *   ...
 *   const overlay = new ChatOverlay({ tournamentId });
 *   overlay.mount();
 *   overlay.setGameData(gameState);   // on every snapshot, keeps colours fresh
 */

// Neutral gold, matching --gold-bright on view.html. Used for senders with no
// linked roster entry: admins, gods, and signed-in spectators.
const CHAT_OVERLAY_NEUTRAL = '#c8b37e';

class ChatOverlay {

    /**
     * Which of a snapshot's changes deserve a toast?
     *
     * Only 'added'. Chat messages are immutable by rule (`allow update,
     * delete: if false`), so 'modified'/'removed' should never appear — but
     * filtering explicitly means a future rules change can't start replaying
     * old messages onto the screen.
     *
     * The first snapshot is always suppressed: it delivers the whole existing
     * backlog as 'added', which on a page reload would fire the entire recent
     * history at the room at once.
     *
     * Pure. Tested in dev/tests/chat-overlay.test.js.
     *
     * @param {Array<{type: string, id: string, data: Object}>} changes
     * @param {boolean} isFirstSnapshot
     * @returns {Array<{type: string, id: string, data: Object}>}
     */
    static newMessagesFrom(changes, isFirstSnapshot) {
        if (isFirstSnapshot) return [];
        return (changes || []).filter(change => change.type === 'added');
    }

    /**
     * Who sent this, and in what colour?
     *
     * Resolves the message's Firebase Auth uid against the live roster rather
     * than trusting the senderName frozen into the document at send time —
     * same reasoning as DisplayManager._getPlayerCurrentName(): a rename or a
     * roster swap must not leave a stale name on the big screen.
     *
     * Pure. Tested in dev/tests/chat-overlay.test.js.
     *
     * @param {Object|null} gameData - the tournament snapshot (teams[].players[].uid)
     * @param {string} senderId - Firebase Auth uid from the message
     * @param {string|undefined} fallbackName - the message's own senderName
     * @returns {{name: string, color: string}}
     */
    static resolveSenderIdentity(gameData, senderId, fallbackName) {
        const teams = gameData?.teams || [];
        for (const team of teams) {
            const player = (team.players || []).find(p => p.uid && p.uid === senderId);
            if (player) {
                return {
                    name: player.name || fallbackName || 'Player',
                    color: team.color || CHAT_OVERLAY_NEUTRAL
                };
            }
        }
        return { name: fallbackName || 'Player', color: CHAT_OVERLAY_NEUTRAL };
    }

    /**
     * @param {Object} opts
     * @param {string} opts.tournamentId - required
     * @param {number} [opts.displayMs=9000] - how long a toast stays before fading
     * @param {number} [opts.maxVisible=3] - oldest toasts are evicted past this
     * @param {number} [opts.messageLimit=10] - snapshot window size
     */
    constructor(opts = {}) {
        this.tournamentId = opts.tournamentId;
        this.displayMs = opts.displayMs || 9000;
        this.maxVisible = opts.maxVisible || 3;
        this.messageLimit = opts.messageLimit || 10;

        this.db = null;
        this.stack = null;
        this.unsubscribe = null;
        this._gameData = null;
        this._isFirstSnapshot = true;
        this._mounted = false;
    }

    /** Latest tournament snapshot, so sender colours track roster changes. */
    setGameData(data) {
        this._gameData = data;
    }

    /**
     * Render one message as a toast. Public so the preview harness and the
     * e2e test can drive it without a real chat message existing.
     *
     * @param {{text: string, senderId: string, senderName: string}} msg
     */
    showMessage(msg) {
        if (!msg || !msg.text) return;
        if (!this.stack) this._buildStack();

        const identity = ChatOverlay.resolveSenderIdentity(this._gameData, msg.senderId, msg.senderName);

        const toast = document.createElement('div');
        toast.className = 'chat-overlay-toast';
        toast.style.setProperty('--co-color', identity.color);
        toast.innerHTML = `
            <div class="chat-overlay-sender">${this._escape(identity.name)}</div>
            <div class="chat-overlay-text">${this._escape(msg.text)}</div>
        `;

        this.stack.appendChild(toast);

        // Evict the oldest if the stack is over budget, so a burst of chatter
        // can never march up and cover the whole screen.
        while (this.stack.children.length > this.maxVisible) {
            this.stack.firstElementChild.remove();
        }

        // Next frame, so the enter transition actually runs.
        requestAnimationFrame(() => toast.classList.add('chat-overlay-toast--in'));

        setTimeout(() => {
            toast.classList.remove('chat-overlay-toast--in');
            toast.classList.add('chat-overlay-toast--out');
            setTimeout(() => toast.remove(), 600);
        }, this.displayMs);
    }

    _buildStack() {
        this._injectStyles();
        const stack = document.createElement('div');
        stack.className = 'chat-overlay-stack';
        stack.id = 'chatOverlayStack';
        document.body.appendChild(stack);
        this.stack = stack;
    }

    _escape(str) {
        const div = document.createElement('div');
        div.textContent = str ?? '';
        return div.innerHTML;
    }

    _injectStyles() {
        if (document.getElementById('chat-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'chat-overlay-styles';
        // Sizes are in view.html's 1920x1080 design space -- body is scaled by
        // a transform, which also makes it the containing block for these
        // fixed-position elements (same mechanism .score-strip relies on).
        // z-index sits above the display content (score strip is 60) but well
        // below a broadcast takeover (999999).
        style.textContent = `
            .chat-overlay-stack {
                position: fixed; left: 40px; z-index: 500;
                bottom: calc(var(--score-strip-h, 56px) + 24px);
                display: flex; flex-direction: column; gap: 12px;
                width: 620px; pointer-events: none;
            }
            .chat-overlay-toast {
                opacity: 0; transform: translateX(-40px);
                transition: opacity 0.35s ease, transform 0.35s ease;
                background: rgba(10, 10, 14, 0.88);
                border-left: 6px solid var(--co-color, #c8b37e);
                border-radius: 10px; padding: 14px 20px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.45);
            }
            .chat-overlay-toast--in { opacity: 1; transform: translateX(0); }
            .chat-overlay-toast--out { opacity: 0; transform: translateX(-40px); }
            .chat-overlay-sender {
                font-family: 'Russo One', sans-serif; font-size: 24px;
                text-transform: uppercase; letter-spacing: 1px;
                color: var(--co-color, #c8b37e); margin-bottom: 4px;
            }
            .chat-overlay-text {
                font-family: 'Quantico', sans-serif; font-size: 30px; font-weight: 700;
                color: #f2f2f2; overflow-wrap: anywhere;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Start listening. Call once, after 'firebase-ready'.
     *
     * Ordered createdAt-descending with a small limit so the query stays
     * cheap; ordering only decides which window of documents is watched,
     * not display order -- each new message is appended to the stack as it
     * arrives, so the newest is always at the bottom.
     */
    mount() {
        if (this._mounted) return;
        if (!this.tournamentId) {
            console.error('ChatOverlay: tournamentId is required, overlay will not be shown.');
            return;
        }
        if (!window.firebaseDB) {
            console.error('ChatOverlay: window.firebaseDB not found. Load firebase-loader.js first and wait for "firebase-ready".');
            return;
        }

        this.db = window.firebaseDB;
        this._buildStack();

        const ref = this.db
            .collection('tournaments').doc(this.tournamentId)
            .collection('chatTournament')
            .orderBy('createdAt', 'desc')
            .limit(this.messageLimit);

        this.unsubscribe = ref.onSnapshot(snapshot => {
            const changes = snapshot.docChanges().map(change => ({
                type: change.type,
                id: change.doc.id,
                data: change.doc.data()
            }));

            const fresh = ChatOverlay.newMessagesFrom(changes, this._isFirstSnapshot);
            this._isFirstSnapshot = false;

            // Newest-first from the query; show oldest-first so a burst reads
            // in the order it was actually typed.
            fresh.reverse().forEach(change => this.showMessage(change.data));
        }, err => {
            console.error('ChatOverlay: chat listener error', err);
        });

        this._mounted = true;
    }

    /** Stop listening and remove the stack. */
    destroy() {
        if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
        if (this.stack) { this.stack.remove(); this.stack = null; }
        this._mounted = false;
    }
}

if (typeof window !== 'undefined') {
    window.ChatOverlay = ChatOverlay;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatOverlay;
}
