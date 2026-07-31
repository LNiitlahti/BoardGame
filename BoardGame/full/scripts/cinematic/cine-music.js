// BoardGame/full/scripts/cinematic/cine-music.js
// Pure envelope/beat lookup over a precomputed music-cues.json doc (see
// BoardGame/dev/music-analyzer.html for how that doc gets produced). Mirrors
// cine-materials.js's load()/never-rejects contract and cine-camera.js's
// splinePose()'s clamp-then-interpolate structure.

class CineMusic {
    constructor(doc) {
        this.envelope = (doc && doc.envelope) || []; // [{t, amp}], t ms, amp 0-1
        this.beats = (doc && doc.beats) || [];        // [ms, ...]
        this.durationMs = (doc && doc.durationMs) || 0;
    }

    // Linear interpolation between the two nearest envelope samples, clamped
    // to the first/last sample outside the track's range. Mirrors
    // CineCamera.splinePose's clamp-then-scan structure.
    envelopeAt(t) {
        const env = this.envelope;
        const n = env.length;
        if (n === 0) return 0;
        if (n === 1 || t <= env[0].t) return env[0].amp;
        if (t >= env[n - 1].t) return env[n - 1].amp;

        let i = 0;
        while (i < n - 2 && t >= env[i + 1].t) i++;

        const a = env[i], b = env[i + 1];
        const span = b.t - a.t;
        const p = span === 0 ? 0 : (t - a.t) / span;
        return a.amp + (b.amp - a.amp) * p;
    }

    // Never throws: a failed/missing fetch degrades to an empty CineMusic
    // (envelopeAt always returns 0, no beats) rather than blocking the
    // cinematic — the light show is just inert, not a crash.
    static async load(url) {
        try {
            const res = await fetch(url);
            const doc = await res.json();
            return new CineMusic(doc);
        } catch (e) {
            console.error('[CineMusic] Failed to load, falling back to silent/inert:', e);
            return new CineMusic(null);
        }
    }
}

if (typeof window !== 'undefined') window.CineMusic = CineMusic;
if (typeof module !== 'undefined' && module.exports) module.exports = CineMusic;
