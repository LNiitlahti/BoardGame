// BoardGame/full/scripts/cinematic/cine-virtual-clock.js
// Deterministic clock for offline cinematic rendering
// (dev/tools/cinematic-render/render.js injects this before any page script).
// Replaces performance.now / Date.now / setTimeout / setInterval /
// requestAnimationFrame on the given global and only advances on step(ms).
// After each step, every CSS animation/transition is paused and seeked to the
// same virtual time, so CSS effects (text flicker, sparks, pulses, fades)
// stay frame-locked with the JS timeline. Math.random is seeded so two
// renders produce identical frames. Never loaded in normal page use.

function cineMulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createVirtualClock(g, opts = {}) {
    const startEpoch = opts.startEpoch !== undefined ? opts.startEpoch : 1700000000000;
    let T = 0;
    let nextId = 1;
    const timers = new Map();   // id -> { at, fn, args, interval }
    let rafQueue = new Map();   // id -> fn
    const animStart = new WeakMap();

    function report(e) {
        if (g.console && g.console.error) g.console.error('[VirtualClock] callback threw:', e);
    }

    function addTimer(fn, delay, args, repeat) {
        const id = nextId++;
        if (typeof fn !== 'function') return id;
        const d = Math.max(0, Number(delay) || 0);
        timers.set(id, { at: T + d, fn, args, interval: repeat ? Math.max(1, d) : null });
        return id;
    }

    function install() {
        g.performance.now = () => T;
        g.Date.now = () => startEpoch + T;
        g.setTimeout = (fn, delay, ...args) => addTimer(fn, delay, args, false);
        g.setInterval = (fn, delay, ...args) => addTimer(fn, delay, args, true);
        g.clearTimeout = id => { timers.delete(id); };
        g.clearInterval = id => { timers.delete(id); };
        g.requestAnimationFrame = fn => { const id = nextId++; rafQueue.set(id, fn); return id; };
        g.cancelAnimationFrame = id => { rafQueue.delete(id); };
        g.Math.random = cineMulberry32(opts.seed !== undefined ? opts.seed : 1);
    }

    function nextDue(target) {
        let best = null;
        for (const [id, t] of timers) {
            if (t.at > target) continue;
            if (!best || t.at < best.t.at || (t.at === best.t.at && id < best.id)) best = { id, t };
        }
        return best;
    }

    function syncAnimations() {
        const doc = g.document;
        if (!doc || typeof doc.getAnimations !== 'function') return;
        for (const anim of doc.getAnimations()) {
            try {
                if (!animStart.has(anim)) animStart.set(anim, T);
                const local = T - animStart.get(anim);
                const timing = anim.effect && anim.effect.getComputedTiming
                    ? anim.effect.getComputedTiming() : null;
                const end = timing && Number.isFinite(timing.endTime) ? timing.endTime : Infinity;
                if (local >= end) {
                    anim.finish();
                } else {
                    anim.pause();
                    anim.currentTime = local;
                }
            } catch (e) { report(e); }
        }
    }

    function step(ms) {
        const target = T + ms;
        let due;
        while ((due = nextDue(target))) {
            T = Math.max(T, due.t.at);
            if (due.t.interval) due.t.at += due.t.interval; else timers.delete(due.id);
            try { due.t.fn(...due.t.args); } catch (e) { report(e); }
        }
        T = target;
        const q = rafQueue;
        rafQueue = new Map();
        for (const fn of q.values()) {
            try { fn(T); } catch (e) { report(e); }
        }
        syncAnimations();
    }

    return { install, step, now: () => T };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createVirtualClock };
