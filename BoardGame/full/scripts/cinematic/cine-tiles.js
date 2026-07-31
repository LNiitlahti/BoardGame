// BoardGame/full/scripts/cinematic/cine-tiles.js
// Per-hex drop animation. Tiles start high on the 3D Z axis (toward camera),
// invisible; each drop animates translateZ dropHeight→0 with spin, then
// settles to the exact stylesheet transform so the final board is untouched.

class CineTiles {
    constructor(hexBoardEl, config) {
        this.boardEl = hexBoardEl;
        this.config = config; // { dropHeightPx, spinDegrees }
        this.hexByCoord = new Map();
        for (const hex of hexBoardEl.querySelectorAll('.board-hex')) {
            this.hexByCoord.set(hex.dataset.coord, hex);
        }
        this.heartOverlay = hexBoardEl.querySelector('.heart-overlay-container');
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
            }
        };
    }

    showHearts() {
        if (this.heartOverlay) this.heartOverlay.style.visibility = '';
    }

    // Bail path: instantly restore every hex to its normal state.
    restoreAll() {
        for (const hex of this.hexByCoord.values()) {
            hex.style.visibility = '';
            hex.style.transform = '';
            hex.style.opacity = '';
            hex.style.willChange = '';
        }
        this.showHearts();
    }
}

if (typeof window !== 'undefined') window.CineTiles = CineTiles;
if (typeof module !== 'undefined' && module.exports) module.exports = CineTiles;
