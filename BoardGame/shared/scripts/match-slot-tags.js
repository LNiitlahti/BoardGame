/**
 * MATCH SLOT TAGS
 *
 * Every normal (non-challenge) match belongs to a round and to Match slot 1
 * or 2 of that round. admin-improved-adapter.js's _belongsToCurrentSlot()
 * and phase-manager.js's getSlotRequirements() key off these tags. An
 * untagged match falls back to a createdAt check and counts toward BOTH
 * slots, so new matches should always get a tag.
 *
 * nextFreeSlotTag() returns the first free {roundNumber, slot} in the order
 * (R,1), (R,2), (R+1,1), ... where R is the current round (minimum 1: play
 * starts at round 1, pre_game_setup is round 0).
 */
(function () {
    function isNormalMatch(entry) {
        return !!entry && entry.isBreak !== true && entry.isChallenge !== true;
    }

    function nextFreeSlotTag(gameQueue, roundNumber) {
        const start = Math.max(1, Number.isFinite(roundNumber) ? roundNumber : 0);
        const used = new Set();
        (gameQueue || []).forEach(entry => {
            if (!isNormalMatch(entry)) return;
            if (entry.roundNumber === undefined || entry.roundNumber === null) return;
            if (entry.slot === undefined || entry.slot === null) return;
            used.add(`${entry.roundNumber}:${String(entry.slot)}`);
        });
        for (let round = start; round < start + 10000; round++) {
            for (const slot of [1, 2]) {
                if (!used.has(`${round}:${slot}`)) return { roundNumber: round, slot };
            }
        }
        return { roundNumber: start, slot: 1 };
    }

    const MatchSlotTags = { nextFreeSlotTag };
    if (typeof window !== 'undefined') window.MatchSlotTags = MatchSlotTags;
    if (typeof module !== 'undefined' && module.exports) module.exports = MatchSlotTags;
})();
