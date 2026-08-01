// Shared "tempo" signal for the cinematic: counts beats across all loaded
// stems in a trailing 2s window and maps that count to a speedFactor. Pure
// function of (stems, t) -- no persistent state, mirrors cine-camera.js's
// splinePose/lerpPose pure-function style. `stems` may contain null/inert
// entries (a stem that failed to load) -- those are skipped, not errors.

const TEMPO_WINDOW_MS = 2000;
const TEMPO_MAX_BEATS = 8;
const TEMPO_MAX_SPEED = 1.6;

// tempoCfg optionally overrides the window/clamp/max-speed constants above
// (wired to cinematic-scene.json's "tempo" section so the tuning harness can
// adjust the curve live) -- omitted or partial fields fall back to the
// module defaults, so every existing call site/test keeps working unchanged.
function computeTempo(stems, t, tempoCfg) {
    const windowMs = (tempoCfg && tempoCfg.windowMs) || TEMPO_WINDOW_MS;
    const maxBeats = (tempoCfg && tempoCfg.maxBeats) || TEMPO_MAX_BEATS;
    const maxSpeedFactor = (tempoCfg && tempoCfg.maxSpeedFactor) || TEMPO_MAX_SPEED;

    let count = 0;
    for (const stem of stems) {
        if (!stem || !stem.beats) continue;
        for (const beatMs of stem.beats) {
            if (beatMs > t - windowMs && beatMs <= t) count++;
        }
    }
    const clamped = Math.min(count, maxBeats);
    return 1 + (clamped / maxBeats) * (maxSpeedFactor - 1);
}

if (typeof window !== 'undefined') window.CineTempo = { computeTempo };
if (typeof module !== 'undefined' && module.exports) module.exports = { computeTempo };
