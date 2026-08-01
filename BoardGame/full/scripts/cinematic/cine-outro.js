// Computes how much longer the cinematic's timeline must run past its own
// authored end (revealEnd + signage) so the loaded music track plays to
// completion instead of being cut off by teardown(). Driven entirely by the
// music's actual durationMs so it stays correct if the track is swapped.
// Zero-floored: a shorter/failed-load track (CineMusic.load never rejects,
// see cine-music.js) or one already shorter than the cinematic's own length
// adds no outro — behavior is then identical to not having this module.

function computeOutro(cinematicOwnEnd, musicDurationMs) {
    const outroDurationMs = Math.max(0, musicDurationMs - cinematicOwnEnd);
    return { outroDurationMs, finalEnd: cinematicOwnEnd + outroDurationMs };
}

if (typeof window !== 'undefined') window.CineOutro = { computeOutro };
if (typeof module !== 'undefined' && module.exports) module.exports = { computeOutro };
