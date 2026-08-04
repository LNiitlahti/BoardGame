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
    _toggling: false,
    _movingSlots: new Set(),
    _refreshingChannels: false,
    _refreshingMembers: false,

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
        this._safeRender('renderKillSwitch');
        this._safeRender('renderSetup');
        this._safeRender('renderLinks');
        this._safeRender('watchActivity');
    },

    /** Run one render step in isolation so a failure in one section can't silently prevent the others from running (most importantly, can't silently kill the live Activity listener). */
    _safeRender(methodName) {
        try {
            this[methodName]();
        } catch (err) {
            console.error(`[Discord Panel] ${methodName} failed:`, err);
            this._toast(`Discord panel: ${methodName} failed — ${err.message}`, 'error');
        }
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
        if (this._refreshingChannels) return;
        this._refreshingChannels = true;
        try {
            const id = await window.DiscordCommands?.request('refresh-channels');
            if (!id) {
                this._toast('Could not queue the channel refresh.', 'error');
                return;
            }
            this._toast('Fetching channels from Discord…', 'info');
            this._awaitCommand(id, 'Channels refreshed.');
        } finally {
            // _awaitCommand's own listener resolves asynchronously (up to
            // its 30s timeout), so this flag can't wait for that — it only
            // needs to survive long enough to absorb an accidental
            // rapid double-click on the button itself.
            setTimeout(() => { this._refreshingChannels = false; }, 3000);
        }
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
    },

    // ── Player links ────────────────────────────────────────────

    /**
     * Flatten the tournament roster into link-table rows.
     *
     * Roster entries in `teams[].players[]` carry only `{id, name, uid}` —
     * the Discord username a player typed at onboarding lives in the
     * tournament document's top-level `players` map, keyed by the same
     * player id (that is where onboarding.js writes platformIds). So the
     * two have to be joined here.
     *
     * Players with no `uid` are included but cannot be linked: links are
     * keyed by Firebase uid, and an account-less onboarding player has none.
     * They are shown greyed out rather than hidden, so it is obvious why
     * they will never be auto-moved.
     */
    _rosterRows() {
        const gameState = window.godApp?.gameState || {};
        const teams = gameState.teams || [];
        const playersById = gameState.players || {};
        const rows = [];

        teams.forEach(team => {
            (team.players || []).forEach(player => {
                const onboarding = playersById[player.id] || {};
                rows.push({
                    uid: player.uid || null,
                    name: player.name || player.id || '(unnamed)',
                    teamName: team.name || `Team ${team.id}`,
                    typed: onboarding.platformIds?.discord || '',
                    linked: player.uid ? this._links[player.uid] : null
                });
            });
        });
        return rows;
    },

    /** <option> list of guild members for one row's dropdown. */
    _memberOptions(selectedId, suggestedId) {
        const blank = `<option value="">— not linked —</option>`;
        const options = this._members.map(member => {
            const chosen = String(member.discordUserId) === String(selectedId) ? ' selected' : '';
            const isSuggested = String(member.discordUserId) === String(suggestedId);
            const label = isSuggested
                ? `${member.displayName} (suggested)`
                : `${member.displayName} — ${member.username}`;
            return `<option value="${this._escape(member.discordUserId)}"${chosen}>${this._escape(label)}</option>`;
        }).join('');
        return blank + options;
    },

    renderLinks() {
        const host = document.getElementById('discordLinksSection');
        if (!host) return;

        const rows = this._rosterRows();
        const matcher = window.DiscordLinkMatcher;

        if (this._members.length === 0) {
            host.innerHTML = `
                <h4 style="margin-bottom:10px;">Player Links</h4>
                <p style="color: var(--text-tertiary); font-size:0.85rem;">
                    No guild members cached yet. Save the setup above, then click "Refresh members".
                </p>
                <button class="btn secondary" onclick="DiscordPanel.refreshMembers()">Refresh members</button>
            `;
            return;
        }

        let suggestionCount = 0;

        const body = rows.map((row, index) => {
            const suggested = (row.uid && !row.linked && matcher)
                ? matcher.suggestMember(row.typed, this._members)
                : null;
            if (suggested) suggestionCount++;

            const selectedId = row.linked?.discordUserId || suggested?.discordUserId || '';
            const unlinked = !row.linked && !suggested;
            const rowStyle = row.uid
                ? (unlinked ? 'background: rgba(239,68,68,0.08);' : '')
                : 'opacity: 0.45;';

            const control = row.uid
                ? `<select id="discordLinkSelect-${index}" style="width:100%; padding:6px; background:rgba(11,13,16,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:white;">
                       ${this._memberOptions(selectedId, suggested?.discordUserId)}
                   </select>`
                : `<span style="font-size:0.8rem; color:var(--text-tertiary);">no account</span>`;

            const action = row.uid
                ? `<button class="btn-small primary" onclick="DiscordPanel.saveLink('${this._escape(row.uid)}', ${index})">Save</button>`
                : '';

            const status = row.linked
                ? '<span style="color:#22c55e;">linked</span>'
                : (suggested ? '<span style="color:#eab308;">suggested</span>' : '<span style="color:#ef4444;">unlinked</span>');

            return `
                <tr style="${rowStyle}">
                    <td>${this._escape(row.name)}</td>
                    <td style="color:var(--text-tertiary);">${this._escape(row.teamName)}</td>
                    <td style="color:var(--text-tertiary);">${this._escape(row.typed || '—')}</td>
                    <td>${control}</td>
                    <td>${status}</td>
                    <td>${action}</td>
                </tr>`;
        }).join('');

        host.innerHTML = `
            <h4 style="margin-bottom:10px;">Player Links</h4>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <button class="btn primary" onclick="DiscordPanel.confirmAllSuggestions()"
                        ${suggestionCount === 0 ? 'disabled' : ''}>
                    Confirm all suggestions (${suggestionCount})
                </button>
                <button class="btn secondary" onclick="DiscordPanel.refreshMembers()">Refresh members</button>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                <thead>
                    <tr style="text-align:left; color:var(--text-tertiary); font-size:0.8rem;">
                        <th>Player</th><th>Team</th><th>Typed at onboarding</th>
                        <th>Discord account</th><th>Status</th><th></th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
        `;
    },

    async refreshMembers() {
        if (this._refreshingMembers) return;
        this._refreshingMembers = true;
        try {
            const id = await window.DiscordCommands?.request('refresh-members');
            if (!id) {
                this._toast('Could not queue the member refresh.', 'error');
                return;
            }
            this._toast('Fetching members from Discord…', 'info');
            this._awaitCommand(id, 'Members refreshed.');
        } finally {
            setTimeout(() => { this._refreshingMembers = false; }, 3000);
        }
    },

    async saveLink(uid, index) {
        const ref = this._ref();
        if (!ref) return;

        const discordUserId = document.getElementById(`discordLinkSelect-${index}`)?.value || '';

        try {
            if (!discordUserId) {
                await ref.collection('discordLinks').doc(uid).delete();
                this._toast('Link removed.', 'success');
            } else {
                const member = this._members.find(m => String(m.discordUserId) === String(discordUserId));
                await ref.collection('discordLinks').doc(uid).set({
                    discordUserId,
                    discordUsername: member?.username || '',
                    displayName: member?.displayName || '',
                    confirmedBy: window.firebase?.auth?.().currentUser?.uid || null,
                    confirmedAt: new Date().toISOString(),
                    source: 'manual'
                });
                this._toast('Link saved.', 'success');
            }
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Link save failed:', err);
            this._toast(`Could not save link: ${err.message}`, 'error');
        }
    },

    /**
     * Write a link for every row that has a suggestion and is not already
     * linked, in one batch. This is the whole point of the panel: a roster
     * of thirty is one click, not thirty console documents.
     */
    async confirmAllSuggestions() {
        const ref = this._ref();
        const matcher = window.DiscordLinkMatcher;
        if (!ref || !matcher) return;

        const batch = window.firebaseDB.batch();
        const now = new Date().toISOString();
        const confirmedBy = window.firebase?.auth?.().currentUser?.uid || null;
        let count = 0;

        this._rosterRows().forEach(row => {
            if (!row.uid || row.linked) return;
            const suggested = matcher.suggestMember(row.typed, this._members);
            if (!suggested) return;

            batch.set(ref.collection('discordLinks').doc(row.uid), {
                discordUserId: suggested.discordUserId,
                discordUsername: suggested.username || '',
                displayName: suggested.displayName || '',
                confirmedBy,
                confirmedAt: now,
                source: 'auto-suggested'
            });
            count++;
        });

        if (count === 0) {
            this._toast('No suggestions to confirm.', 'info');
            return;
        }

        try {
            await batch.commit();
            this._toast(`Linked ${count} player(s).`, 'success');
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Batch link failed:', err);
            this._toast(`Could not confirm links: ${err.message}`, 'error');
        }
    },

    // ── Kill switch ─────────────────────────────────────────────

    renderKillSwitch() {
        const host = document.getElementById('discordKillSwitch');
        if (!host) return;

        const enabled = this._config?.enabled === true;
        const configured = !!this._config?.guildId;

        host.innerHTML = `
            <div style="display:flex; align-items:center; gap:14px; padding:14px;
                        border-radius:10px; border:1px solid ${enabled ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'};
                        background:${enabled ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'};">
                <div style="flex:1;">
                    <div style="font-weight:600; color:${enabled ? '#22c55e' : '#ef4444'};">
                        Automatic moves are ${enabled ? 'ENABLED' : 'DISABLED'}
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-tertiary);">
                        ${enabled
                            ? 'Players are moved when a lobby opens and returned when a result is confirmed.'
                            : 'The bot will not move anyone. Nothing else is affected.'}
                    </div>
                </div>
                <button class="btn ${enabled ? 'secondary' : 'primary'}"
                        onclick="DiscordPanel.toggleEnabled()"
                        ${configured ? '' : 'disabled title="Save the setup first"'}>
                    ${enabled ? 'Disable' : 'Enable'}
                </button>
            </div>
        `;
    },

    /**
     * Disabling is instant — the safe direction should never have friction.
     * Enabling asks first, so nobody reactivates moves mid-break by
     * mis-clicking.
     */
    async toggleEnabled() {
        if (this._toggling) return;
        this._toggling = true;
        try {
            const ref = this._ref();
            if (!ref) return;

            const enabling = this._config?.enabled !== true;
            if (enabling) {
                const ok = await this._confirmEnable();
                if (!ok) return;
            }

            await ref.collection('discordConfig').doc('state')
                .set({ enabled: enabling }, { merge: true });
            this._toast(enabling ? 'Automatic moves enabled.' : 'Automatic moves disabled.', 'success');
            await this.reload();
        } catch (err) {
            console.error('[Discord Panel] Toggle failed:', err);
            this._toast(`Could not change the kill switch: ${err.message}`, 'error');
        } finally {
            this._toggling = false;
        }
    },

    /** Modal confirm, matching the pattern used by team-controls.js. */
    _confirmEnable() {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';
            modal.innerHTML = `
                <div style="background: var(--bg-panel, rgba(20, 22, 30, 0.95)); padding:25px; border-radius:12px; max-width:430px; width:90%; color:white; border:2px solid rgba(34,197,94,0.4);">
                    <h3 style="color:#22c55e; margin-top:0;">Enable automatic moves?</h3>
                    <p style="line-height:1.6; color:#cbd5e1;">
                        Players will start being moved between voice channels automatically
                        when lobbies open and results are confirmed.
                    </p>
                    <div style="display:flex; gap:10px; margin-top:20px;">
                        <button id="discordEnableYes" class="btn primary" style="flex:1;">Enable</button>
                        <button id="discordEnableNo" class="btn secondary" style="flex:1;">Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#discordEnableYes').onclick = () => { modal.remove(); resolve(true); };
            modal.querySelector('#discordEnableNo').onclick = () => { modal.remove(); resolve(false); };
            modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(false); } });
        });
    },

    // ── Activity ────────────────────────────────────────────────

    /**
     * Live view of recent commands. Subscribed rather than fetched so a move
     * fired from admin.html shows up here without a manual refresh.
     */
    watchActivity() {
        const ref = this._ref();
        const host = document.getElementById('discordActivity');
        if (!ref || !host) return;

        if (this._activityUnsub) {
            this._activityUnsub();
            this._activityUnsub = null;
        }

        this._activityUnsub = ref.collection('discordCommands')
            .orderBy('requestedAt', 'desc')
            .limit(30)
            .onSnapshot(
                snap => {
                    const commands = [];
                    snap.forEach(doc => commands.push({ id: doc.id, ...doc.data() }));
                    this.renderActivity(commands);
                },
                err => {
                    console.error('[Discord Panel] Activity watch failed:', err);
                    host.innerHTML = `<h4>Activity</h4>
                        <p style="color:#ef4444; font-size:0.85rem;">Could not load activity: ${this._escape(err.message)}</p>`;
                }
            );
    },

    renderActivity(commands) {
        const host = document.getElementById('discordActivity');
        if (!host) return;

        const statusColour = status =>
            status === 'done' ? '#22c55e' : (status === 'pending' ? '#eab308' : '#ef4444');

        const rows = commands.map(command => {
            const results = (command.results || [])
                .map(r => `${this._escape(r.uid || r.playerId || '?')}: ${this._escape(r.outcome)}`)
                .join(', ');

            return `
                <tr>
                    <td style="color:var(--text-tertiary); white-space:nowrap;">
                        ${this._escape((command.requestedAt || '').replace('T', ' ').slice(0, 19))}
                    </td>
                    <td>${this._escape(command.type)}${command.slot ? ` (slot ${this._escape(command.slot)})` : ''}</td>
                    <td style="color:${statusColour(command.status)};">
                        ${this._escape(command.status || 'pending')}${command.reason ? ` — ${this._escape(command.reason)}` : ''}
                    </td>
                    <td style="color:var(--text-tertiary); font-size:0.8rem;">${results || '—'}</td>
                </tr>`;
        }).join('');

        host.innerHTML = `
            <h4 style="margin-bottom:10px;">Activity</h4>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <button class="btn secondary" onclick="DiscordPanel.moveNow('1')">Move now — match 1</button>
                <button class="btn secondary" onclick="DiscordPanel.moveNow('2')">Move now — match 2</button>
                <button class="btn secondary" onclick="DiscordPanel.moveNow('challenge')">Move now — challenge</button>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                <thead>
                    <tr style="text-align:left; color:var(--text-tertiary); font-size:0.8rem;">
                        <th>When</th><th>Command</th><th>Status</th><th>Results</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="4" style="color:var(--text-tertiary); padding:12px;">No commands yet.</td></tr>'}</tbody>
            </table>
        `;
    },

    /**
     * Manual re-fire for stragglers. force:true skips the staleness check —
     * its whole purpose is the case that check would reject, someone
     * arriving after the lobby phase moved on.
     */
    async moveNow(slot) {
        if (this._movingSlots.has(slot)) return;
        this._movingSlots.add(slot);
        try {
            const id = await window.DiscordCommands?.request('pull', { slot, force: true });
            if (!id) {
                this._toast('Could not queue the move.', 'error');
                return;
            }
            this._toast(`Move queued for slot ${slot}.`, 'info');
        } finally {
            setTimeout(() => this._movingSlots.delete(slot), 3000);
        }
    }
};

if (typeof window !== 'undefined') window.DiscordPanel = DiscordPanel;
