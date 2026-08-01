/**
 * RenderSignature — cheap change-detection for Firestore snapshot handlers.
 *
 * computeFieldSignature() mirrors the pattern already proven in full/view.html
 * (getViewRelevantSignature): a sorted, JSON-stringified join of top-level
 * document fields, used to skip a full re-render when nothing display-relevant
 * changed. computeBoardSignature() is a narrower variant scoped to just the
 * hex board + rooms, so pages can skip the 91-hex DOM rebuild specifically
 * even when some other field (score, chat, ready-check) did change.
 */
const RenderSignature = {
    // Fields that change at high frequency but never affect what any of the
    // live pages render — same exclusion list view.html already uses.
    EXCLUDED_KEYS: ['onboarding', 'smartMatchState'],

    computeFieldSignature(data, excludeKeys) {
        const excluded = excludeKeys || [];
        const parts = [];
        for (const key of Object.keys(data || {}).sort()) {
            if (excluded.includes(key)) continue;
            try {
                parts.push(key + ':' + JSON.stringify(data[key]));
            } catch {
                parts.push(key + ':' + String(data[key]));
            }
        }
        return parts.join('|');
    },

    computeBoardSignature(board, rooms) {
        let boardPart;
        let roomsPart;
        try { boardPart = JSON.stringify(board || {}); } catch { boardPart = String(board); }
        try { roomsPart = JSON.stringify(rooms || []); } catch { roomsPart = String(rooms); }
        return boardPart + '|' + roomsPart;
    }
};

if (typeof window !== 'undefined') window.RenderSignature = RenderSignature;
if (typeof module !== 'undefined' && module.exports) module.exports = RenderSignature;
