// BoardGame/full/scripts/cinematic/cine-expansion-plan.js
// Pure planning for the "expansion" cinematic (cinematic-scene-expansion.json):
// when every tile drops (rings 0-5, Act 2) or erupts outward (rings 6-7,
// Act 6), plus act validation. No DOM; the timeline wiring lives in
// cine-script-expansion.js.

const SQRT3 = Math.sqrt(3);

function ringOf(q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

// Flat-top axial -> pixel-ish (unit hex). y grows downwards (screen space).
function axialToXY(q, r) {
    return { x: 1.5 * q, y: SQRT3 * (r + q / 2) };
}

// Angle in degrees, 0..360, measured like screen space (y down).
function angleOf(q, r) {
    const { x, y } = axialToXY(q, r);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angularDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

const ACT_ORDER = ['void', 'heartDrop', 'familiarDone', 'unrest', 'breath', 'break', 'settle', 'end'];

// Returns a list of problems (empty = valid).
function validateActs(acts, songDurationMs) {
    const problems = [];
    for (const k of ACT_ORDER) {
        if (typeof acts[k] !== 'number') problems.push(`missing act ${k}`);
    }
    for (let i = 1; i < ACT_ORDER.length; i++) {
        if (acts[ACT_ORDER[i]] <= acts[ACT_ORDER[i - 1]]) {
            problems.push(`${ACT_ORDER[i]} must come after ${ACT_ORDER[i - 1]}`);
        }
    }
    if (songDurationMs > 0 && acts.end > songDurationMs) problems.push('end is past the song');
    return problems;
}

// Nearest beat within maxMs of t, else t itself.
function snapToBeat(t, beats, maxMs) {
    let best = t, bestD = Infinity;
    for (const b of beats || []) {
        const d = Math.abs(b - t);
        if (d < bestD) { bestD = d; best = b; }
    }
    return bestD <= maxMs ? best : t;
}

/**
 * @param {object} xcfg  cinematic-scene-expansion.json
 * @param {Array<[number,number]>} coords  board coordinates [[q,r],...]
 * @param {number[]} drumBeats  ms
 * @returns {{ drops: Array<{coord,q,r,ring,at,duration,landAt,kind}>, nameWindows }}
 *   kind: 'drop' (falls from above, Act 2) | 'erupt' (bursts outward, Act 6)
 */
function planExpansion(xcfg, coords, drumBeats) {
    const A = xcfg.acts, D = xcfg.drops, E = xcfg.eruption;
    const hexes = coords.map(([q, r]) => ({
        q, r, coord: `q${q}r${r}`, ring: ringOf(q, r), angle: angleOf(q, r)
    }));
    const drops = [];
    const push = (h, landAt, duration, kind) =>
        drops.push({ coord: h.coord, q: h.q, r: h.r, ring: h.ring, at: landAt - duration, duration, landAt, kind });

    // Ring 0: the mountain heart lands exactly on the drum entry.
    hexes.filter(h => h.ring === 0).forEach(h => push(h, A.heartDrop, D.heartFallMs, 'drop'));

    // Ring 1: one by one, each landing snapped to a nearby drum beat.
    const ring1 = hexes.filter(h => h.ring === 1).sort((a, b) => a.angle - b.angle);
    let lastRing1 = A.heartDrop;
    ring1.forEach((h, i) => {
        const target = A.heartDrop + D.ring1FirstLandMs + i * D.ring1IntervalMs;
        const landAt = snapToBeat(target, drumBeats, D.beatSnapMs);
        lastRing1 = Math.max(lastRing1, landAt);
        push(h, landAt, D.ring1FallMs, 'drop');
    });

    // Rings 2-5: spiral cascade (ring by ring, swept by angle).
    const cascade = hexes.filter(h => h.ring >= 2 && h.ring <= 5)
        .sort((a, b) => (a.ring - b.ring) || (a.angle - b.angle));
    const firstLand = lastRing1 + D.cascadeGapMs;
    const lastLand = A.familiarDone - D.cascadeEndBeforeDoneMs;
    const spacing = cascade.length > 1 ? (lastLand - firstLand) / (cascade.length - 1) : 0;
    cascade.forEach((h, i) => push(h, firstLand + i * spacing, D.cascadeFallMs, 'drop'));

    // Rings 6+: erupt outward on the drop, starting on the camera-near side.
    hexes.filter(h => h.ring >= 6).forEach(h => {
        const delay = (angularDistance(h.angle, E.nearAngleDeg) / 180) * E.staggerMs
            + (h.ring >= 7 ? E.ring7DelayMs : 0);
        const at = A.break + delay;
        drops.push({ coord: h.coord, q: h.q, r: h.r, ring: h.ring, at, duration: E.flightMs, landAt: at + E.flightMs, kind: 'erupt' });
    });

    drops.sort((a, b) => a.at - b.at);
    return { drops, nameWindows: xcfg.nameWindows.map(w => ({ startMs: w.startMs, endMs: w.endMs })) };
}

// Latest time any erupting tile can land (for tests and for showing hearts).
function eruptionEnd(xcfg) {
    const E = xcfg.eruption;
    return xcfg.acts.break + E.staggerMs + E.ring7DelayMs + E.flightMs;
}

const CineExpansionPlan = { ringOf, axialToXY, angleOf, validateActs, snapToBeat, planExpansion, eruptionEnd, ACT_ORDER };
if (typeof window !== 'undefined') window.CineExpansionPlan = CineExpansionPlan;
if (typeof module !== 'undefined' && module.exports) module.exports = CineExpansionPlan;
