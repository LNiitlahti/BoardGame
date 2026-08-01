// BoardGame/dev/music-merge-envelopes.js
// Point-wise max merge of two RMS envelopes (see music-analyzer.html's
// computeRmsEnvelope) — used to combine e.g. lead + backing vocal stems into
// one signal before beat detection. Merges purely by array index, assuming
// both envelopes share the same time grid (both start at t=0 with the same
// windowMs). This holds for "nice" sample rates (44100, 48000, 22050, etc.)
// where computeRmsEnvelope's Math.round()-based window math lines up exactly
// between files, but two files at different/unusual sample rates could drift
// slightly out of alignment over a long track — this function has no way to
// detect that and will silently merge misaligned windows. In practice, feed
// it stems from the same source recording/export settings. Aside from that
// alignment assumption, only trailing-length differences are handled: the
// shorter envelope contributes amp=0 past its own end, the longer one's tail
// is preserved as-is.
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
