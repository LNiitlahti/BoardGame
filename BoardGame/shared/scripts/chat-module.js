/**
 * Chat Module - Floating tournament & team chat
 * Reuse this file (like board-module.js) on every game page:
 * setup.html, admin.html, team.html, game.html, god.html, view.html
 *
 * Requires (already true on every page that loads firebase-loader.js):
 *   - window.firebaseDB is set after the 'firebase-ready' event fires
 *   - firebase.auth() has a signed-in user (for senderId / senderName)
 *
 * Usage (add near the end of <body>, after firebase-loader.js):
 *   <script src="scripts/chat-module.js"></script>
 *   <script>
 *     document.addEventListener('firebase-ready', () => {
 *       const chat = new ChatModule({
 *         tournamentId: new URLSearchParams(location.search).get('tournamentId'),
 *         teamId: new URLSearchParams(location.search).get('teamId') // null on admin/god pages is fine
 *       });
 *       chat.mount();
 *     });
 *   </script>
 */

class ChatModule {
    /**
     * @param {Object} opts
     * @param {string} opts.tournamentId - required, id of the tournament document
     * @param {string|null} opts.teamId - optional, if present a "Team chat" tab is shown
     * @param {number} opts.messageLimit - how many recent messages to load (default 100)
     */
    constructor(opts = {}) {
        this.tournamentId = opts.tournamentId;
        this.teamId = opts.teamId != null ? String(opts.teamId) : null;
        this.messageLimit = opts.messageLimit || 100;

        this.db = null;
        this.auth = null;
        this.currentUser = null;

        this.activeRoom = 'tournament'; // 'tournament' | 'team'
        this.unsubscribers = {}; // room -> unsubscribe function
        this.messagesByRoom = { tournament: [], team: [] };

        this._mounted = false;
    }

    /** Call this once Firebase is ready. Builds the DOM and starts listening. */
    mount() {
        if (this._mounted) return;
        if (!this.tournamentId) {
            console.error('ChatModule: tournamentId is required, chat will not be shown.');
            return;
        }
        if (!window.firebaseDB) {
            console.error('ChatModule: window.firebaseDB not found. Load firebase-loader.js first and wait for "firebase-ready".');
            return;
        }

        this.db = window.firebaseDB;
        this.auth = firebase.auth();
        this.currentUser = this.auth.currentUser;

        // Keep currentUser fresh (in case chat mounts before auth resolves)
        this.auth.onAuthStateChanged(user => {
            this.currentUser = user;
            this._updateInputState();
        });

        this._injectStyles();
        this._buildDom();
        this._attachEvents();
        this._updateInputState();
        this._listenToRoom('tournament');
        if (this.teamId) this._listenToRoom('team');

        this._mounted = true;
    }

    /**
     * Anonymous sessions (spectator/onboarding pages) can read chat but not
     * post — enforced server-side by the Firestore rules; this just keeps
     * the UI from offering a send button that will always fail.
     */
    _updateInputState() {
        if (!this.input) return;
        const isAnon = this.currentUser?.isAnonymous === true;
        this.input.disabled = isAnon;
        this.input.placeholder = isAnon ? 'Sign in to chat' : 'Type a message…';
        const sendBtn = this.form?.querySelector('.chat-send');
        if (sendBtn) sendBtn.disabled = isAnon;
    }

    /** Stop all Firestore listeners (call on page unload if you want to be tidy). */
    destroy() {
        Object.values(this.unsubscribers).forEach(unsub => unsub && unsub());
        this.unsubscribers = {};
        if (this.container) this.container.remove();
        this._mounted = false;
    }

    /**
     * Call this whenever the nav dropdown switches the active tournament
     * WITHOUT a page reload. Tears down old listeners and re-subscribes
     * to the new tournamentId/teamId. Safe to call even if chat panel is open.
     *
     * @param {string} newTournamentId
     * @param {string|null} newTeamId
     */
    switchTournament(newTournamentId, newTeamId = null) {
        if (!newTournamentId) {
            console.error('ChatModule.switchTournament: newTournamentId is required');
            return;
        }

        Object.values(this.unsubscribers).forEach(unsub => unsub && unsub());
        this.unsubscribers = {};

        this.tournamentId = newTournamentId;
        this.teamId = newTeamId != null ? String(newTeamId) : null;
        this.messagesByRoom = { tournament: [], team: [] };
        this.activeRoom = 'tournament';

        const tabsWrap = this.container.querySelector('.chat-tabs');
        tabsWrap.innerHTML = `
            <button class="chat-tab active" data-room="tournament">Tournament</button>
            ${this.teamId ? `<button class="chat-tab" data-room="team">My Team</button>` : ''}
        `;
        this.tabs = this.container.querySelectorAll('.chat-tab');
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.activeRoom = tab.dataset.room;
                tab.querySelector('.chat-unread-dot')?.remove();
                this._renderMessages();
            });
        });

        this._listenToRoom('tournament');
        if (this.teamId) this._listenToRoom('team');

        this._renderMessages();
    }

    // ---------- Firestore paths ----------

    _tournamentRoomRef() {
        return this.db.collection('tournaments').doc(this.tournamentId)
            .collection('chatTournament');
    }

    _teamRoomRef() {
        return this.db.collection('tournaments').doc(this.tournamentId)
            .collection('chatTeams').doc(String(this.teamId))
            .collection('messages');
    }

    _roomRef(room) {
        return room === 'team' ? this._teamRoomRef() : this._tournamentRoomRef();
    }

    // ---------- Firestore logic ----------

    _listenToRoom(room) {
        const ref = this._roomRef(room)
            .orderBy('createdAt', 'desc')
            .limit(this.messageLimit);

        this.unsubscribers[room] = ref.onSnapshot(snapshot => {
            const msgs = [];
            snapshot.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
            msgs.reverse(); // oldest first for display
            this.messagesByRoom[room] = msgs;
            if (this.activeRoom === room) this._renderMessages();
            if (room !== this.activeRoom) this._bumpUnread(room);
        }, err => {
            console.error(`ChatModule: listener error on room "${room}"`, err);
        });
    }

    async _sendMessage(text) {
        text = text.trim();
        if (!text) return;
        if (!this.currentUser || this.currentUser.isAnonymous) {
            alert('You need to be signed in to chat.');
            return;
        }

        const payload = {
            text: text,
            senderId: this.currentUser.uid,
            senderName: this.currentUser.displayName || this.currentUser.email || 'Player',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (this.activeRoom === 'team') {
            payload.teamId = this.teamId;
        }

        try {
            await this._roomRef(this.activeRoom).add(payload);
        } catch (err) {
            console.error('ChatModule: failed to send message', err);
            alert('Message failed to send: ' + err.message);
        }
    }

    // ---------- DOM ----------

    _buildDom() {
        const wrap = document.createElement('div');
        wrap.className = 'chat-module-wrap';
        wrap.innerHTML = `
            <button class="chat-fab" title="Chat" aria-label="Open chat">💬</button>
            <div class="chat-panel" hidden>
                <div class="chat-header">
                    <div class="chat-tabs">
                        <button class="chat-tab active" data-room="tournament">Tournament</button>
                        ${this.teamId ? `<button class="chat-tab" data-room="team">My Team</button>` : ''}
                    </div>
                    <button class="chat-close" aria-label="Close chat">✕</button>
                </div>
                <div class="chat-messages"></div>
                <form class="chat-input-row">
                    <input type="text" class="chat-input" placeholder="Type a message…" autocomplete="off" maxlength="500" />
                    <button type="submit" class="chat-send">Send</button>
                </form>
            </div>
        `;
        document.body.appendChild(wrap);
        this.container = wrap;

        this.fab = wrap.querySelector('.chat-fab');
        this.panel = wrap.querySelector('.chat-panel');
        this.messagesEl = wrap.querySelector('.chat-messages');
        this.form = wrap.querySelector('.chat-input-row');
        this.input = wrap.querySelector('.chat-input');
        this.tabs = wrap.querySelectorAll('.chat-tab');
    }

    _attachEvents() {
        this.fab.addEventListener('click', () => this._togglePanel());
        this.container.querySelector('.chat-close').addEventListener('click', () => this._togglePanel(false));

        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.activeRoom = tab.dataset.room;
                tab.querySelector('.chat-unread-dot')?.remove();
                this._renderMessages();
            });
        });

        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this._sendMessage(this.input.value);
            this.input.value = '';
        });
    }

    _togglePanel(force) {
        const show = force !== undefined ? force : this.panel.hidden;
        this.panel.hidden = !show;
        if (show) {
            this._renderMessages();
            setTimeout(() => this.input.focus(), 50);
        }
    }

    _bumpUnread(room) {
        const tab = [...this.tabs].find(t => t.dataset.room === room);
        if (tab && !tab.querySelector('.chat-unread-dot')) {
            const dot = document.createElement('span');
            dot.className = 'chat-unread-dot';
            tab.appendChild(dot);
        }
    }

    _renderMessages() {
        const msgs = this.messagesByRoom[this.activeRoom] || [];
        const me = this.currentUser?.uid;

        this.messagesEl.innerHTML = msgs.map(m => {
            const mine = m.senderId === me;
            const time = m.createdAt?.toDate ? m.createdAt.toDate() : null;
            const timeStr = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="chat-msg ${mine ? 'mine' : ''}">
                    <div class="chat-msg-meta">
                        <span class="chat-msg-sender">${this._escape(m.senderName || 'Player')}</span>
                        <span class="chat-msg-time">${timeStr}</span>
                    </div>
                    <div class="chat-msg-text">${this._escape(m.text)}</div>
                </div>
            `;
        }).join('');

        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    _escape(str) {
        const div = document.createElement('div');
        div.textContent = str ?? '';
        return div.innerHTML;
    }

    _injectStyles() {
        if (document.getElementById('chat-module-styles')) return;
        const style = document.createElement('style');
        style.id = 'chat-module-styles';
        style.textContent = `
            .chat-module-wrap { position: fixed; right: 20px; bottom: 20px; z-index: 9999; font-family: inherit; }
            .chat-fab {
                width: 56px; height: 56px; border-radius: 50%;
                border: none; cursor: pointer; font-size: 24px;
                background: var(--brand-red, #e63946); color: #fff;
                box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            }
            .chat-fab:hover { filter: brightness(1.1); }
            .chat-panel {
                position: absolute; right: 0; bottom: 70px;
                width: 320px; max-width: 90vw; height: 420px; max-height: 70vh;
                background: var(--brand-cream, #fdf6e3); color: var(--brand-charcoal, #222);
                border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                display: flex; flex-direction: column; overflow: hidden;
            }
            .chat-panel[hidden] { display: none; }
            .chat-header { display: flex; align-items: center; justify-content: space-between;
                background: var(--brand-charcoal, #222); padding: 6px 8px; }
            .chat-tabs { display: flex; gap: 4px; }
            .chat-tab {
                position: relative; background: transparent; border: none; color: #ccc;
                padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px;
            }
            .chat-tab.active { background: rgba(255,255,255,0.15); color: #fff; font-weight: 600; }
            .chat-unread-dot {
                position: absolute; top: 2px; right: 2px; width: 7px; height: 7px;
                border-radius: 50%; background: var(--brand-yellow, #f4c542);
            }
            .chat-close { background: transparent; border: none; color: #ccc; cursor: pointer; font-size: 14px; }
            .chat-messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
            .chat-msg { max-width: 85%; }
            .chat-msg.mine { align-self: flex-end; text-align: right; }
            .chat-msg-meta { font-size: 11px; opacity: 0.6; margin-bottom: 2px; }
            .chat-msg-sender { font-weight: 600; margin-right: 6px; }
            .chat-msg-text {
                display: inline-block; padding: 6px 10px; border-radius: 10px;
                background: #fff; word-wrap: break-word;
            }
            .chat-msg.mine .chat-msg-text { background: var(--brand-green, #6fbf73); color: #fff; }
            .chat-input-row { display: flex; border-top: 1px solid rgba(0,0,0,0.1); }
            .chat-input { flex: 1; border: none; padding: 10px; font-size: 14px; outline: none; }
            .chat-send {
                border: none; background: var(--brand-blue, #3a7bd5); color: #fff;
                padding: 0 16px; cursor: pointer; font-size: 14px;
            }
            .chat-send:hover { filter: brightness(1.1); }
        `;
        document.head.appendChild(style);
    }
}

if (typeof window !== 'undefined') {
    window.ChatModule = ChatModule;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatModule;
}
