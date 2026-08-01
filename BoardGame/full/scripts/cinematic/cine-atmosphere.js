// BoardGame/full/scripts/cinematic/cine-atmosphere.js
// Scene-wide ambient VFX: fog, floating particles, ghost lights, flying
// embers. Active for the whole cinematic (void through outro), distinct
// from and layered alongside the per-hex material particles in
// cine-tiles.js/cine-materials.js. Same shape as cine-tiles.js: one file,
// one class, owns its own DOM subtree.

class CineAtmosphere {
    // config: { particleCount, emberCount, ghostLightCount, fog: { enabled } }
    constructor(hostEl, config) {
        this.config = config;
        this.el = document.createElement('div');
        this.el.id = 'cineAtmosphere';
        hostEl.appendChild(this.el);
        this._buildFog();
        this._buildParticles();
        this._buildGhostLights();
        this._buildEmbers();
    }

    _buildFog() {
        if (!this.config.fog || !this.config.fog.enabled) return;
        for (const layer of ['layer-1', 'layer-2']) {
            const el = document.createElement('div');
            el.className = `atmo-fog ${layer}`;
            this.el.appendChild(el);
        }
    }

    _buildParticles() {
        for (let i = 0; i < this.config.particleCount; i++) {
            const el = document.createElement('div');
            el.className = 'atmo-mote';
            el.style.setProperty('--x', `${Math.random() * 100}%`);
            el.style.setProperty('--delay', `${Math.random() * 8}s`);
            el.style.setProperty('--duration', `${8 + Math.random() * 6}s`);
            this.el.appendChild(el);
        }
    }

    _buildGhostLights() {
        for (let i = 0; i < this.config.ghostLightCount; i++) {
            const el = document.createElement('div');
            el.className = 'atmo-ghost';
            el.style.setProperty('--x', `${Math.random() * 100}%`);
            el.style.setProperty('--y', `${Math.random() * 100}%`);
            el.style.setProperty('--delay', `${Math.random() * 6}s`);
            el.style.setProperty('--duration', `${14 + Math.random() * 8}s`);
            this.el.appendChild(el);
        }
    }

    _buildEmbers() {
        for (let i = 0; i < this.config.emberCount; i++) {
            const el = document.createElement('div');
            el.className = 'atmo-ember';
            el.style.setProperty('--x', `${Math.random() * 100}%`);
            el.style.setProperty('--delay', `${Math.random() * 6}s`);
            el.style.setProperty('--duration', `${6 + Math.random() * 5}s`);
            this.el.appendChild(el);
        }
    }

    // Sets --atmo-intensity, read by CSS to nudge brightness/opacity — same
    // pattern as the existing --beat-intensity custom property
    // (cine-tiles.js's applyBeatIntensity).
    applyIntensity(amp) {
        this.el.style.setProperty('--atmo-intensity', String(amp));
    }

    remove() {
        this.el.remove();
    }
}

if (typeof window !== 'undefined') window.CineAtmosphere = CineAtmosphere;
if (typeof module !== 'undefined' && module.exports) module.exports = CineAtmosphere;
