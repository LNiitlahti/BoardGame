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
        this._cursor = 0; // last segment index returned by envelopeAt
    }

    // Linear interpolation between the two nearest envelope samples, clamped
    // to the first/last sample outside the track's range. Mirrors
    // CineCamera.splinePose's clamp-then-scan structure.
    //
    // The scan resumes from the previous call's segment rather than
    // restarting at 0: playback time is monotonic, and with ~2,874 samples
    // and six per-frame callers a from-zero scan cost ~17k dereferences per
    // frame late in the track. Out-of-order lookups stay correct (the
    // timeline schedules beats by absolute time) — a backward seek resets the
    // cursor before scanning.
    envelopeAt(t) {
        const env = this.envelope;
        const n = env.length;
        if (n === 0) return 0;
        if (n === 1 || t <= env[0].t) { this._cursor = 0; return env[0].amp; }
        if (t >= env[n - 1].t) { this._cursor = n - 2; return env[n - 1].amp; }

        let i = this._cursor;
        if (i > n - 2) i = n - 2;
        if (t < env[i].t) i = 0;
        while (i < n - 2 && t >= env[i + 1].t) i++;
        this._cursor = i;

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
