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

        // Fog behind the board: separate host inserted before the board's
        // own DOM position, with negative z-index (see CSS) so it paints
        // under the (non-positioned) .scene-3d in .board-wrap's stacking
        // context. this.el above stays in front, dimmed, as a depth echo.
        this.backEl = document.createElement('div');
        this.backEl.id = 'cineAtmosphereBack';
        hostEl.insertBefore(this.backEl, hostEl.firstChild);

        this._buildFog(this.backEl);
        this._buildFog(this.el, /* front */ true);
        this._buildParticles();
        this._buildGhostLights();
        this._buildEmbers();
        this._buildSynthGlow();
    }

    _buildFog(container, front) {
        if (!this.config.fog || !this.config.fog.enabled) return;
        for (const layer of ['layer-1', 'layer-2']) {
            const el = document.createElement('div');
            el.className = `atmo-fog ${layer}${front ? ' front' : ''}`;
            container.appendChild(el);
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

    _buildSynthGlow() {
        this.glowEl = document.createElement('div');
        this.glowEl.id = 'cineGlow';
        this.el.appendChild(this.glowEl);
    }

    // Sets --atmo-intensity, read by CSS to nudge brightness/opacity — same
    // pattern as the existing --beat-intensity custom property
    // (cine-tiles.js's applyBeatIntensity).
    applyIntensity(amp) {
        this.el.style.setProperty('--atmo-intensity', String(amp));
    }

    // Backing-vocals-driven fog/ghost-light intensity -- a separate channel
    // from the drums-driven applyIntensity()/--atmo-intensity above (that one
    // stays wired to the drums envelope block in cinematic-controller.js,
    // which is out of scope for multi-stem work -- see that file's comment).
    applyFogIntensity(amp) {
        this.el.style.setProperty('--atmo-fog-intensity', String(amp));
        this.backEl.style.setProperty('--atmo-fog-intensity', String(amp));
    }

    // "Other" stem: baseline motes/embers brightness, independent of the fog
    // channel above.
    applyBaseIntensity(amp) {
        this.el.style.setProperty('--atmo-base-intensity', String(amp));
    }

    // Synth stem: full-screen glow overlay opacity, proportional to synth
    // amplitude.
    applySynthGlow(amp) {
        this.glowEl.style.setProperty('--atmo-synth-intensity', String(amp));
    }

    // Percussion-driven one-shot spark burst at a random position. Same
    // remove-reflow-readd restart trick as triggerBeatPulse/triggerWash
    // elsewhere in the cinematic, but this element is spawned fresh per call
    // (not pre-existing in the DOM) and removed after its animation finishes
    // so repeated bursts don't pile up unremoved elements. Duration shrinks
    // as speedFactor grows -- snappier under high tempo. baseDurationMs is
    // tunable (wired to cinematic-scene.json's "percussion" section).
    triggerSpark(speedFactor = 1, baseDurationMs = 600) {
        const durationMs = baseDurationMs / speedFactor;
        const spark = document.createElement('div');
        spark.className = 'atmo-spark';
        spark.style.setProperty('--x', `${Math.random() * 100}%`);
        spark.style.setProperty('--y', `${Math.random() * 100}%`);
        spark.style.animationDuration = `${durationMs}ms`;
        this.el.appendChild(spark);
        setTimeout(() => spark.remove(), durationMs);
    }

    remove() {
        this.el.remove();
        this.backEl.remove();
    }
}

if (typeof window !== 'undefined') window.CineAtmosphere = CineAtmosphere;
if (typeof module !== 'undefined' && module.exports) module.exports = CineAtmosphere;
