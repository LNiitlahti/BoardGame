const CineEasing = {
    linear: t => t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    // Falling tiles: accelerate in (gravity)
    easeInQuad: t => t * t,
    // Landing settle: slight overshoot then rest
    easeOutBack: t => {
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
};

if (typeof window !== 'undefined') window.CineEasing = CineEasing;
if (typeof module !== 'undefined' && module.exports) module.exports = CineEasing;
