/**
 * God-panel UI for the Discord voice-move integration.
 *
 * Four sections — kill switch, setup, player links, activity — all scoped to
 * the tournament currently selected in god.html.
 *
 * Nothing here talks to Discord directly: the bot token lives in Cloud
 * Secret Manager and must never reach client JS. The guild's member and
 * channel lists are fetched by the Cloud Function via the discordCommands
 * queue and read back out of discordConfig/memberCache and
 * discordConfig/channelCache.
 */

const DiscordPanel = {

    _config: null,
    _members: [],
    _channels: [],
    _links: {},
    _activityUnsub: null,

    // ── Shared helpers ──────────────────────────────────────────

    _tournamentId() {
        return window.godApp?._currentTournamentId || null;
    },

    /** Firestore ref for the selected tournament, or null if none. */
    _ref() {
        const tid = this._tournamentId();
        if (!tid || !window.firebaseDB) return null;
        return window.firebaseDB.collection('tournaments').doc(tid);
    },

    _escape(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    _toast(message, type) {
        if (typeof window.showToast === 'function') window.showToast(message, type);
        else console.log(`[Discord Panel] ${message}`);
    },

    // ── Entry point ─────────────────────────────────────────────

    /** Called by switchGodTab when the Discord tab is opened. */
    async load() {
        const body = document.getElementById('discordPanelBody');
        const empty = document.getElementById('discordNoTournament');

        if (!this._ref()) {
            if (body) body.style.display = 'none';
            if (empty) empty.style.display = '';
            return;
        }
        if (body) body.style.display = '';
        if (empty) empty.style.display = 'none';

        await this.reload();
    },

    /** Re-read everything from Firestore and re-render all sections. */
    async reload() {
        await this._loadData();
        this.renderKillSwitch();
        this.renderSetup();
        this.renderLinks();
        this.watchActivity();
    },

    async _loadData() {
        const ref = this._ref();
        if (!ref) return;
        try {
            const [configSnap, memberSnap, channelSnap, linkSnap] = await Promise.all([
                ref.collection('discordConfig').doc('state').get(),
                ref.collection('discordConfig').doc('memberCache').get(),
                ref.collection('discordConfig').doc('channelCache').get(),
                ref.collection('discordLinks').get()
            ]);

            this._config = configSnap.exists ? configSnap.data() : null;
            this._members = memberSnap.exists ? (memberSnap.data().members || []) : [];
            this._channels = channelSnap.exists ? (channelSnap.data().channels || []) : [];
            this._links = {};
            linkSnap.forEach(doc => { this._links[doc.id] = doc.data(); });
        } catch (err) {
            console.error('[Discord Panel] Load failed:', err);
            this._toast(`Could not load Discord settings: ${err.message}`, 'error');
        }
    },

    // ── Setup ───────────────────────────────────────────────────

    /** <option> list for one channel dropdown, marking `selectedId` chosen. */
    _channelOptions(selectedId) {
        const blank = `<option value="">— not set —</option>`;
        const options = this._channels.map(channel => {
            const chosen = String(channel.channelId) === String(selectedId) ? ' selected' : '';
            return `<option value="${this._escape(channel.channelId)}"${chosen}>${this._escape(channel.name)}</option>`;
        }).join('');
        return blank + options;
    },

    renderSetup() {
        const host = document.getElementById('discordSetup');
        if (!host) return;

        const config = this._config || {};
        const slots = config.slotChannels || {};
        const slot1 = slots['1'] || [];
        const slot2 = slots['2'] || [];

        const noChannels = this._channels.length === 0
            ? `<p style="color: var(--text-tertiary); font-size: 0.85rem;">
                   No channels cached yet — enter the Guild ID, save, then click "Refresh channels".
               </p>`
            : '';

        const field = (label, id, selected) => `
            <div>
                <label style="display:block; font-size:0.8rem; color:var(--text-tertiary); margin-bottom:4px;">${label}</label>
                <select id="${id}" style="width:100%; padding:8px; background:rgba(11,13,16,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:white;">
                    ${this._channelOptions(selected)}
                </select>
            </div>`;

        host.innerHTML = `
            <h4 style="margin-bottom:10px;">Setup</h4>
            ${noChannels}
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                <div>
                    <label style="display:block; font-size:0.8rem; color:var(--text-tertiary); margin-bottom:4px;">Guild (server) ID</label>
                    <input type="text" id="discordGuildId" value="${this._escape(config.guildId || '')}"
                           placeholder="e.g. 1520510940724854925"
                           style="width:100%; padding:8px; background:rgba(11,13,16,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:white;">
                </div>
                ${field('Waiting Room', 'discordWaitingRoom', config.waitingRoomChannelId)}
                ${field('Match 1 — side A', 'discordSlot1A', slot1[0])}
                ${field('Match 1 — side B', 'discordSlot1B', slot1[1])}
                ${field('Match 2 — side A', 'discordSlot2A', slot2[0])}
                ${field('Match 2 — side B', 'discordSlot2B', slot2[1])}
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn primary" onclick="DiscordPanel.saveSetup()">Save setup</button>
                <button class="btn secondary" onclick="DiscordPanel.refreshChannels()">Refresh channels</button>
            </div>
        `;
    },

    async saveSetup() {
        const ref = this._ref();
        if (!ref) return;

        const value = id => document.getElementById(id)?.value.trim() || '';
        const guildId = value('discordGuildId');
        if (!guildId) {
            this._toast('Guild ID is required.', 'error');
            return;
        }

        // enabled is preserved if the doc already exists, and defaults to
        // false on a fresh setup — a newly configured tournament should not
        // start moving people the moment it is saved.
        const payload = {
            enabled: this._config?.enabled === true,
            guildId,
            waitingRoomChannelId: value('discordWaitingRoom'),
            slotChannels: {
                '1': [value('discordSlot1A'), value('discordSlot1B')],
                '2': [value('discordSlot2A'), value('discordSlot2B')]
            }
        };

        try {
            await ref.collection('discordConfig').doc('state').set(payload, { merge: true });
            this._toast('Discord setup saved.', 'success');
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Save failed:', err);
            this._toast(`Could not save: ${err.message}`, 'error');
        }
    },

    async refreshChannels() {
        const id = await window.DiscordCommands?.request('refresh-channels');
        if (!id) {
            this._toast('Could not queue the channel refresh.', 'error');
            return;
        }
        this._toast('Fetching channels from Discord…', 'info');
        this._awaitCommand(id, 'Channels refreshed.');
    },

    /**
     * Watch one queued command until the Cloud Function writes its result,
     * then reload. Gives up after 30s so a dead function does not leave the
     * listener hanging forever.
     */
    _awaitCommand(commandId, successMessage) {
        const ref = this._ref();
        if (!ref) return;

        const doc = ref.collection('discordCommands').doc(commandId);
        const timeout = setTimeout(() => {
            unsub();
            this._toast('Discord command timed out — check the function logs.', 'error');
        }, 30000);

        const unsub = doc.onSnapshot(snap => {
            const data = snap.data();
            if (!data || data.status === 'pending') return;
            clearTimeout(timeout);
            unsub();
            if (data.status === 'done') {
                this._toast(successMessage, 'success');
            } else {
                this._toast(`Discord command ${data.status}: ${data.reason || ''} ${data.error || ''}`.trim(), 'error');
            }
            this.reload();
        }, err => {
            clearTimeout(timeout);
            console.error('[Discord Panel] Command watch failed:', err);
        });
    }
};

if (typeof window !== 'undefined') window.DiscordPanel = DiscordPanel;
