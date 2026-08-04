/**
 * Queues Discord move commands for the Cloud Function to execute.
 *
 * Deliberately fire-and-forget: a failure to queue is logged and swallowed.
 * Discord moves are a convenience, and must never prevent a match from
 * advancing.
 */

const DiscordCommands = {

    /**
     * The active tournament, resolved the same way admin.js and god-app.js
     * persist it (both write these keys when a tournament is loaded).
     */
    _tournamentId() {
        try {
            return sessionStorage.getItem('currentTournamentId')
                || localStorage.getItem('currentTournamentId')
                || null;
        } catch {
            return null;
        }
    },

    /**
     * Queue one command.
     *
     * @param {'pull'|'return'|'refresh-members'} type
     * @param {object} options
     * @param {string|number} [options.slot]    Match slot ('1', '2', 'challenge')
     * @param {string} [options.matchId]        Queue entry id, when known
     * @param {boolean} [options.force]         Skip the staleness check
     * @returns {Promise<string|null>} command id, or null if it could not be queued
     */
    async request(type, options) {
        const { slot = null, matchId = null, force = false } = options || {};
        const db = window.firebaseDB;
        const tournamentId = this._tournamentId();
        if (!db || !tournamentId) return null;

        try {
            const ref = await db.collection('tournaments').doc(tournamentId)
                .collection('discordCommands').add({
                    type,
                    slot: slot === null ? null : String(slot),
                    matchId,
                    force: !!force,
                    requestedBy: window.firebase?.auth?.().currentUser?.uid || null,
                    requestedAt: new Date().toISOString(),
                    status: 'pending'
                });
            console.log(`[Discord] Queued ${type} command ${ref.id}`);
            return ref.id;
        } catch (err) {
            console.warn(`[Discord] Could not queue ${type} command:`, err.message);
            return null;
        }
    }
};

if (typeof window !== 'undefined') window.DiscordCommands = DiscordCommands;
if (typeof module !== 'undefined' && module.exports) module.exports = DiscordCommands;
