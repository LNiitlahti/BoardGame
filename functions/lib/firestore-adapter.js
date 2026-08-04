/**
 * Adapts real Firestore to the narrow surface command-handler expects.
 * Exists so the handler can be tested against a plain object; every method
 * here is a one-liner over the Admin SDK.
 */

function createFirestoreDb(firestore) {
    return {
        tournament(tournamentId) {
            const ref = firestore.collection('tournaments').doc(tournamentId);

            return {
                async getGameState() {
                    const snap = await ref.get();
                    return snap.exists ? snap.data() : null;
                },

                async getConfig() {
                    const snap = await ref.collection('discordConfig').doc('state').get();
                    return snap.exists ? snap.data() : null;
                },

                async getLinks() {
                    const snap = await ref.collection('discordLinks').get();
                    const links = {};
                    snap.forEach(doc => { links[doc.id] = doc.data(); });
                    return links;
                },

                /**
                 * Matches live inside the tournament doc's gameQueue array,
                 * not in their own collection. `matchId` is preferred; the
                 * slot fallback covers commands queued before an id was
                 * known (a slot entering lobby knows its slot, not yet which
                 * queue entry the admin will start).
                 *
                 * Safety note: if `matchId` is stale (no longer in the
                 * queue), this falls back to a slot-based search that could
                 * return a different match than originally intended. This is
                 * currently safe only because isCommandCurrent() gates pull
                 * commands to slots still in 'lobby' — don't call getMatch
                 * standalone without an equivalent guard.
                 */
                async getMatch(matchId, slot) {
                    const snap = await ref.get();
                    if (!snap.exists) return null;
                    const queue = snap.data().gameQueue || [];

                    if (matchId) {
                        const byId = queue.find(m => String(m.id) === String(matchId));
                        if (byId) return byId;
                    }
                    if (String(slot) === 'challenge') {
                        return queue.find(m => m.isChallenge === true && m.status !== 'completed') || null;
                    }
                    return queue.find(m =>
                        m.isChallenge !== true &&
                        !m.isBreak &&
                        m.status !== 'completed' &&
                        String(m.slot) === String(slot)
                    ) || null;
                },

                async updateGameState(patch) {
                    await ref.update(patch);
                },

                async writeMemberCache(data) {
                    await ref.collection('discordConfig').doc('memberCache').set(data);
                },

                async writeChannelCache(data) {
                    await ref.collection('discordConfig').doc('channelCache').set(data);
                }
            };
        }
    };
}

module.exports = { createFirestoreDb };
