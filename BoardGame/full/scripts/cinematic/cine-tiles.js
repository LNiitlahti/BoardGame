// BoardGame/full/scripts/cinematic/cine-tiles.js
// Per-hex drop animation. Tiles start high on the 3D Z axis (toward camera),
// invisible; each drop animates translateZ dropHeight→0 with spin, then
// settles to the exact stylesheet transform so the final board is untouched.

// Particle sub-element counts/class per material — only created for hexes
// that actually use them, so DOM size stays proportional to the board, not
// 4x every hex. Water has no discrete particles (its look is a glow +
// sweeping sheen, both pure CSS pseudo-elements, no extra nodes needed).
// PERFORMANCE KNOB. Previous counts were lava 3, magic 4, dust 3 (= 266 nodes).
// Every particle is an animated element that gets its own compositor layer, and
// on the target hardware (Intel Iris Xe, 1080p) GPU draw time measures roughly
//     14.8 ms fixed + 0.031 ms per composited layer
// against a 16.7 ms budget per 60 Hz frame. Dropping these from 266 to 0 (with
// the atmosphere counts in cinematic-scene.json) took layers from 809 to 441
// and draw time from 39.6 ms to 28.3 ms, which moved the cinematic from a
// 3-vsync lock (21 fps) to a 2-vsync lock (a steady 31 fps).
//
// There is ~5 ms of headroom left before the 33.3 ms 2-vsync budget, i.e. room
// for roughly 160 layers. Raise these if you want the drifting particles back —
// note view.html positions them with :nth-of-type rules that go up to 3
// (embers/motes) and 4 (sparks), so counts above those stack unpositioned nodes.
const MATERIAL_PARTICLES = {
    lava: { className: 'ember', count: 0 },
    magic: { className: 'spark', count: 0 },
    dust: { className: 'mote', count: 0 },
    water: { className: null, count: 0 }
};

class CineTiles {
    // `materials` is an optional CineMaterials instance. Omitting it (the
    // Task 6/7 behavior) creates no material-fx overlays at all — fully
    // backward compatible with any existing caller that doesn't pass one.
    constructor(hexBoardEl, config, materials) {
        this.boardEl = hexBoardEl;
        this.config = config; // { dropHeightPx, spinDegrees }
        this.materials = materials || null;
        this.hexByCoord = new Map();
        for (const hex of hexBoardEl.querySelectorAll('.board-hex')) {
            this.hexByCoord.set(hex.dataset.coord, hex);
            if (this.materials) this._ensureMaterialFx(hex);
        }
        this.heartOverlay = hexBoardEl.querySelector('.heart-overlay-container');
    }

    // Creates the (inert until 'active') material overlay div for one hex,
    // tagged with the material it resolves to. Idempotent, so constructing
    // a second CineTiles against the same rendered DOM (e.g. a harness
    // "Rebuild & Replay") doesn't stack duplicate overlays.
    _ensureMaterialFx(hex) {
        if (hex.querySelector(':scope > .material-fx')) return;
        const material = this.materials.materialFor(hex.dataset.coord);
        const fx = document.createElement('div');
        fx.className = `material-fx mat-${material}`;

        const particle = MATERIAL_PARTICLES[material];
        if (particle && particle.count > 0) {
            for (let i = 0; i < particle.count; i++) {
                const p = document.createElement('div');
                p.className = particle.className;
                fx.appendChild(p);
            }
        }

        const flash = document.createElement('div');
        flash.className = 'landing-flash';
        fx.appendChild(flash);

        const beatPulse = document.createElement('div');
        beatPulse.className = 'beat-pulse';
        fx.appendChild(beatPulse);

        hex.appendChild(fx);
    }

    // Starts a hex's ambient material loop and plays its one-shot landing
    // flash. Called from makeDropTrack()'s onComplete — never independently,
    // so a hex's effect always starts exactly when its tile lands.
    _triggerLanding(hex) {
        const fx = hex.querySelector(':scope > .material-fx');
        if (!fx) return;
        fx.classList.add('active', 'flash');
    }

    // Effect 2 (music sync): used to feed the material glow layers a CSS custom
    // property they multiplied into a filter: brightness().
    //
    // DISABLED FOR PERFORMANCE, and this one is worth understanding before
    // re-enabling it. --beat-intensity is an *inherited* custom property, so
    // writing it on #hexBoard invalidated the computed style of that element's
    // entire subtree — ~730 nodes (91 hexes plus each one's bevel, material-fx
    // overlay, particles, landing flash and beat pulse) — on every single
    // frame. Measured on the target machine: 302 style recalcs of ~872 elements
    // averaging 16.4 ms, i.e. 5.7 s of a 21.8 s recording. Commenting out this
    // one line halved style recalc time and took the cinematic from 13.9 to
    // 17.4 fps.
    //
    // The per-hex beat brightness is a good effect and worth having back, but
    // not via an inherited custom property on a container. The music envelope is
    // fully precomputed (data/music-cues-*.json), so the honest fix is to bake
    // it into a per-hex keyframe/WAAPI animation started in sync with the audio,
    // which costs zero per-frame style writes.
    applyBeatIntensity(amp) {
        // Intentionally a no-op — see above. Kept so callers need no change.
    }

    // Effect 3 (music sync): one-shot re-triggerable glow on a single hex,
    // fired per beat for whichever ring is "on" this beat (see
    // cinematic-controller.js's buildTimeline). Distinct from
    // _triggerLanding's one-shot .flash (that one never repeats; this one
    // must replay every time it's called) — remove-reflow-readd is the
    // standard trick to restart a CSS animation on an already-flashed class.
    triggerBeatPulse(coord) {
        const hex = this.hexByCoord.get(coord);
        if (!hex) return;
        const pulse = hex.querySelector(':scope > .material-fx > .beat-pulse');
        if (!pulse) return;
        pulse.classList.remove('flash');
        void pulse.offsetWidth; // force reflow so re-adding the class restarts the animation
        pulse.classList.add('flash');
    }

    // Hide every hex (and heart images) before the cascade begins.
    hideAll() {
        for (const hex of this.hexByCoord.values()) {
            hex.style.visibility = 'hidden';
            hex.style.willChange = 'transform';
        }
        if (this.heartOverlay) this.heartOverlay.style.visibility = 'hidden';
    }

    // Timeline track dropping one tile. `entry` from buildLandingOrder.
    makeDropTrack(entry, at, duration, ease) {
        const hex = this.hexByCoord.get(entry.coord);
        const { dropHeightPx, spinDegrees } = this.config;
        return {
            at,
            duration,
            ease,
            onStart: () => {
                if (!hex) return;
                hex.style.visibility = 'visible';
            },
            onUpdate: (p) => {
                if (!hex) return;
                const z = dropHeightPx * (1 - p);
                const spin = spinDegrees * (1 - p);
                hex.style.transform =
                    `translate(-50%, -50%) translateZ(${z}px) rotateZ(${spin}deg)`;
                hex.style.opacity = String(Math.min(1, p * 4)); // fade in over first 25%
            },
            onComplete: () => {
                if (!hex) return;
                // Back to stylesheet values — zero inline residue on the hex.
                hex.style.transform = '';
                hex.style.opacity = '';
                hex.style.willChange = '';
                if (this.materials) this._triggerLanding(hex);
            }
        };
    }

    showHearts() {
        if (this.heartOverlay) this.heartOverlay.style.visibility = '';
    }

    // Bail path: instantly restore every hex to its normal state. Also
    // stops material ambient effects — they're scoped to "while the
    // cinematic is actively running" for now, not an always-on live-board
    // feature (that's a later phase), so the board looks exactly like
    // today's once the cinematic ends or is skipped.
    restoreAll() {
        for (const hex of this.hexByCoord.values()) {
            hex.style.visibility = '';
            hex.style.transform = '';
            hex.style.opacity = '';
            hex.style.willChange = '';
            if (this.materials) {
                const fx = hex.querySelector(':scope > .material-fx');
                if (fx) {
                    fx.classList.remove('active', 'flash');
                    const pulse = fx.querySelector(':scope > .beat-pulse');
                    if (pulse) pulse.classList.remove('flash');
                }
            }
        }
        this.boardEl.style.removeProperty('--beat-intensity');
        this.showHearts();
    }
}

if (typeof window !== 'undefined') window.CineTiles = CineTiles;
if (typeof module !== 'undefined' && module.exports) module.exports = CineTiles;
