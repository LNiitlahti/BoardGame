// BoardGame/dev/music-merge-envelopes.js
// Point-wise max merge of two RMS envelopes (see music-analyzer.html's
// computeRmsEnvelope) — used to combine e.g. lead + backing vocal stems into
// one signal before beat detection. Both envelopes are assumed to share the
// same fixed-window sample grid (they do: computeRmsEnvelope always starts
// at t=0 with the same windowMs), so only trailing-length differences need
// handling: the shorter envelope contributes amp=0 past its own end, the
// longer one's tail is preserved as-is.
function mergeEnvelopes(a, b) {
    const len = Math.max(a.length, b.length);
    const merged = [];
    for (let i = 0; i < len; i++) {
        const t = (a[i] || b[i]).t;
        const ampA = a[i] ? a[i].amp : 0;
        const ampB = b[i] ? b[i].amp : 0;
        merged.push({ t, amp: Math.max(ampA, ampB) });
    }
    return merged;
}

if (typeof window !== 'undefined') window.mergeEnvelopes = mergeEnvelopes;
if (typeof module !== 'undefined' && module.exports) module.exports = { mergeEnvelopes };
