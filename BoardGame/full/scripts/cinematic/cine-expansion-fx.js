// BoardGame/full/scripts/cinematic/cine-expansion-fx.js
// DOM effects for the "expansion" cinematic (cine-script-expansion.js):
// heart glow in the void, rim cracks, rim tremor, dust off the edges, the
// break flash + shockwave, the outward eruption of rings 6-7, and showing
// the mountain heart before the side hearts. Board-plane effects are
// children of #hexBoard so they follow the 3D camera exactly. Every setter
// is a pure function of the value it is given (no internal clocks), so the
// effects are frame-exact under the offline renderer's virtual clock.

class CineExpansionFx {
    /**
     * @param {HTMLElement} boardEl  #hexBoard
     * @param {HTMLElement} stageEl  .board-wrap (screen-space overlays)
     * @param {CineTiles} tiles
     * @param {object} cfg  cinematic-scene-expansion.json
     */
    constructor(boardEl, stageEl, tiles, cfg) {
        this.boardEl = boardEl;
        this.stageEl = stageEl;
        this.tiles = tiles;
        this.cfg = cfg;
        this.created = [];

        const center = tiles.hexByCoord.get('q0r0');
        this.cx = center ? parseFloat(center.style.left) || 0 : boardEl.offsetWidth / 2;
        this.cy = center ? parseFloat(center.style.top) || 0 : boardEl.offsetHeight / 2;
        this.hexSize = center ? center.offsetWidth : 80;

        this.byRing = new Map();
        for (const [coord, hex] of tiles.hexByCoord) {
            const m = /^q(-?\d+)r(-?\d+)$/.exec(coord);
            if (!m) continue;
            const q = +m[1], r = +m[2];
            const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
            const x = parseFloat(hex.style.left) || 0, y = parseFloat(hex.style.top) || 0;
            const info = { coord, hex, q, r, ring, x, y, angle: Math.atan2(y - this.cy, x - this.cx), seed: (q * 73856093) ^ (r * 19349663) };
            if (!this.byRing.has(ring)) this.byRing.set(ring, []);
            this.byRing.get(ring).push(info);
        }
        for (const list of this.byRing.values()) list.sort((a, b) => a.angle - b.angle);
        this.rimRing = 5;

        this.heartGlow = this._add(boardEl, 'xp-heart-glow', this.cx, this.cy);
        this.shockwave = this._add(boardEl, 'xp-shockwave', this.cx, this.cy);
        this.flash = this._add(stageEl, 'xp-flash');

        this.cracks = (this.byRing.get(this.rimRing) || []).map(info => {
            const el = document.createElement('div');
            el.className = 'xp-crack';
            info.hex.appendChild(el);
            this.created.push(el);
            return el;
        });
        this.dustIndex = 0;
    }

    _add(parent, className, x, y) {
        const el = document.createElement('div');
        el.className = className;
        if (x !== undefined) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
        parent.appendChild(el);
        this.created.push(el);
        return el;
    }

    // 0..1: glow on the spot where the mountain heart will land.
    setHeartGlow(a) {
        this.heartGlow.style.opacity = String(Math.max(0, Math.min(1, a)));
    }

    // progress 0..1 sweeps the cracks around the rim; brightness 0..1.
    setCracks(progress, brightness) {
        const n = this.cracks.length;
        this.cracks.forEach((el, i) => {
            const local = Math.max(0, Math.min(1, progress * n * 1.25 - i * 1.0));
            el.style.opacity = String(local * brightness);
        });
    }

    // intensity 0..1, tMs = timeline time. Rim (ring 5) shakes most, ring 4 less.
    setTremor(intensity, tMs) {
        const max = this.cfg.effects.tremorMaxPx;
        for (const ring of [this.rimRing - 1, this.rimRing]) {
            const factor = ring === this.rimRing ? 1 : this.cfg.effects.tremorRing4Factor;
            for (const info of this.byRing.get(ring) || []) {
                if (intensity <= 0) { info.hex.style.transform = ''; continue; }
                const amp = max * factor * intensity;
                const s = info.seed % 1000;
                const dx = amp * Math.sin(tMs * 0.043 + s);
                const dy = amp * Math.sin(tMs * 0.057 + s * 1.7);
                info.hex.style.transform = `translate(-50%, -50%) translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
            }
        }
    }

    clearTremor() { this.setTremor(0, 0); }

    // One dust puff sliding off the rim, outward, and falling below the board.
    spawnDust(rng) {
        const rim = this.byRing.get(this.rimRing) || [];
        if (!rim.length) return;
        const info = rim[Math.floor(rng() * rim.length)];
        const el = document.createElement('div');
        el.className = 'xp-dust';
        const ox = (info.x - this.cx), oy = (info.y - this.cy);
        const len = Math.hypot(ox, oy) || 1;
        el.style.left = `${info.x + (ox / len) * this.hexSize * 0.45}px`;
        el.style.top = `${info.y + (oy / len) * this.hexSize * 0.45}px`;
        el.style.setProperty('--dx', `${(ox / len) * (40 + rng() * 60)}px`);
        el.style.setProperty('--dy', `${(oy / len) * (40 + rng() * 60)}px`);
        el.style.setProperty('--s', String(0.6 + rng() * 0.9));
        this.boardEl.appendChild(el);
        setTimeout(() => el.remove(), 1700);
    }

    // p 0..1 over effects.shockwaveMs.
    setShockwave(p) {
        if (p <= 0 || p >= 1) { this.shockwave.style.opacity = '0'; return; }
        const scale = 0.2 + p * 14;
        this.shockwave.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        this.shockwave.style.opacity = String((1 - p) * (1 - p));
    }

    setFlash(a) {
        this.flash.style.opacity = String(Math.max(0, Math.min(1, a)));
    }

    // Track bursting one outer-ring tile from under the old edge out to its slot.
    makeEruptTrack(drop, ease) {
        const E = this.cfg.eruption;
        const hex = this.tiles.hexByCoord.get(drop.coord);
        const info = (this.byRing.get(drop.ring) || []).find(i => i.coord === drop.coord);
        const fromFrac = this.rimRing / drop.ring; // start tucked under the old rim
        const ox = info ? (info.x - this.cx) : 0, oy = info ? (info.y - this.cy) : 0;
        return {
            at: drop.at,
            duration: drop.duration,
            ease,
            onStart: () => { if (hex) hex.style.visibility = 'visible'; },
            onUpdate: p => {
                if (!hex) return;
                const back = (1 - p) * (1 - fromFrac);
                const z = E.startDepthPx * (1 - p) + E.arcHeightPx * Math.sin(Math.PI * p);
                const spin = E.spinDegrees * (1 - p);
                hex.style.transform =
                    `translate(-50%, -50%) translate(${(-ox * back).toFixed(2)}px, ${(-oy * back).toFixed(2)}px) ` +
                    `translateZ(${z.toFixed(2)}px) rotateZ(${spin.toFixed(2)}deg)`;
                hex.style.opacity = String(Math.min(1, p * 5));
            },
            onComplete: () => {
                if (!hex) return;
                hex.style.transform = '';
                hex.style.opacity = '';
                hex.style.willChange = '';
                if (this.tiles.materials) this.tiles._triggerLanding(hex);
            }
        };
    }

    // Mountain heart image only (side hearts sit on the not-yet-erupted ring).
    showMountainHeartOnly() {
        const overlay = this.tiles.heartOverlay;
        if (!overlay) return;
        overlay.style.visibility = 'visible';
        for (const img of overlay.querySelectorAll('[data-coord]')) img.style.visibility = 'hidden';
    }

    showAllHearts() {
        const overlay = this.tiles.heartOverlay;
        if (!overlay) return;
        overlay.style.visibility = '';
        for (const img of overlay.querySelectorAll('[data-coord]')) img.style.visibility = '';
    }

    remove() {
        this.clearTremor();
        for (const el of this.created) el.remove();
        this.created = [];
        for (const el of this.boardEl.querySelectorAll('.xp-dust')) el.remove();
        this.showAllHearts();
    }
}

if (typeof window !== 'undefined') window.CineExpansionFx = CineExpansionFx;
if (typeof module !== 'undefined' && module.exports) module.exports = CineExpansionFx;
