// Shared "tempo" signal for the cinematic: counts beats across all loaded
// stems in a trailing 2s window and maps that count to a speedFactor. Pure
// function of (stems, t) -- no persistent state, mirrors cine-camera.js's
// splinePose/lerpPose pure-function style. `stems` may contain null/inert
// entries (a stem that failed to load) -- those are skipped, not errors.

const TEMPO_WINDOW_MS = 2000;
const TEMPO_MAX_BEATS = 8;
const TEMPO_MAX_SPEED = 1.6;

function computeTempo(stems, t) {
    let count = 0;
    for (const stem of stems) {
        if (!stem || !stem.beats) continue;
        for (const beatMs of stem.beats) {
            if (beatMs > t - TEMPO_WINDOW_MS && beatMs <= t) count++;
        }
    }
    const clamped = Math.min(count, TEMPO_MAX_BEATS);
    return 1 + (clamped / TEMPO_MAX_BEATS) * (TEMPO_MAX_SPEED - 1);
}

if (typeof window !== 'undefined') window.CineTempo = { computeTempo };
if (typeof module !== 'undefined' && module.exports) module.exports = { computeTempo };
