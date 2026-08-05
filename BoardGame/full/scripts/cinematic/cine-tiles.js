// BoardGame/full/scripts/cinematic/cine-tiles.js
// Per-hex drop animation. Tiles start high on the 3D Z axis (toward camera),
// invisible; each drop animates translateZ dropHeight→0 with spin, then
// settles to the exact stylesheet transform so the final board is untouched.

// Particle sub-element counts/class per material — only created for hexes
// that actually use them, so DOM size stays proportional to the board, not
// 4x every hex. Water has no discrete particles (its look is a glow +
// sweeping sheen, both pure CSS pseudo-elements, no extra nodes needed).
//
// These counts are a performance knob: every particle is a DOM node running
// an infinite CSS animation, and dust covers 56 of the board's 91 hexes, so
// its count dominates the total. Raising them back up is safe — view.html
// positions particles with :nth-of-type rules that go up to 3 (embers/motes)
// and 4 (sparks), so counts above those would stack unpositioned nodes.
const MATERIAL_PARTICLES = {
    lava: { className: 'ember', count: 2 },
    magic: { className: 'spark', count: 2 },
    dust: { className: 'mote', count: 1 },
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

    // Effect 3 (music sync): one-shot re-triggerable glow on a single hex,
    // fired per beat for whichever ring is "on" this beat (see
    // cinematic-controller.js's buildTimeline). Distinct from
    // _triggerLanding's one-shot .flash (that one never repeats; this one
    // must replay every time it's called).
    //
    // Restarted via the Web Animations API rather than the usual
    // remove-reflow-readd trick: this runs once per hex for a whole ring on
    // every beat, so `void pulse.offsetWidth` meant up to 30 forced layout
    // flushes in a single frame, each recomputing layout across ~600
    // clip-path'd nodes in a 3D subtree. Rewinding the animation in place
    // reads no layout at all.
    triggerBeatPulse(coord) {
        const hex = this.hexByCoord.get(coord);
        if (!hex) return;
        const pulse = hex.querySelector(':scope > .material-fx > .beat-pulse');
        if (!pulse) return;
        if (!pulse.classList.contains('flash')) {
            pulse.classList.add('flash'); // first application starts it naturally
            return;
        }
        for (const anim of pulse.getAnimations()) { anim.currentTime = 0; anim.play(); }
    }

    // Hide every hex (and heart images) before the cascade begins. Note this
    // deliberately does NOT set will-change: promoting all 91 hexes to their
    // own compositor layer at once is a GPU-memory thrash on integrated
    // chips. makeDropTrack sets it per tile instead — only a handful are ever
    // falling at the same time.
    hideAll() {
        for (const hex of this.hexByCoord.values()) {
            hex.style.visibility = 'hidden';
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
                hex.style.willChange = 'transform, opacity'; // cleared in onComplete
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
        this.showHearts();
    }
}

if (typeof window !== 'undefined') window.CineTiles = CineTiles;
if (typeof module !== 'undefined' && module.exports) module.exports = CineTiles;
