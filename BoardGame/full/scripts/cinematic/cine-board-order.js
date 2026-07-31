// Pure landing-order logic for the cinematic tile cascade.
// Ring = axial hex distance from center: max(|q|, |r|, |q+r|).
// Order: ring by ring outward; within a ring, swept by angle so the
// cascade reads as a spiral rather than random popping.

function ringOf(q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

function buildLandingOrder(coordPairs) {
    return coordPairs
        .map(([q, r]) => ({
            q,
            r,
            coord: `q${q}r${r}`,
            ring: ringOf(q, r),
            // Pointy-axial pixel-ish angle for a stable in-ring sweep
            angle: Math.atan2(r + q / 2, q * 0.866)
        }))
        .sort((a, b) => (a.ring - b.ring) || (a.angle - b.angle))
        .map(({ q, r, coord, ring }) => ({ q, r, coord, ring }));
}

if (typeof window !== 'undefined') {
    window.CineBoardOrder = { ringOf, buildLandingOrder };
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ringOf, buildLandingOrder };
}
