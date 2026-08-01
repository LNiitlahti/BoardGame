// BoardGame/full/scripts/cinematic/cine-text.js
// Black/white glitch-flicker text overlay, vocal-onset-driven. Mirrors the
// existing module shape (cine-tiles.js, cine-camera.js): one file, one
// class, DOM-owning.

class CineText {
    constructor(hostEl) {
        this.el = document.createElement('div');
        this.el.id = 'cineText';
        hostEl.appendChild(this.el);
    }

    setText(str) {
        this.el.textContent = str;
    }

    // Restarts the glitch-flicker CSS animation (remove-reflow-readd, same
    // trick as triggerBeatPulse/triggerWash) on whatever text is currently
    // set. speedFactor (from CineTempo.computeTempo) shortens the flicker
    // under high tempo -- feels snappier when the music is busy. Defaults to
    // 1 so the method stays usable standalone.
    triggerFlicker(speedFactor = 1) {
        this.el.classList.remove('flicker');
        void this.el.offsetWidth; // force reflow so re-adding the class restarts the animation
        this.el.style.animationDuration = `${180 / speedFactor}ms`;
        this.el.classList.add('flicker');
    }

    remove() {
        this.el.remove();
    }
}

if (typeof window !== 'undefined') window.CineText = CineText;
if (typeof module !== 'undefined' && module.exports) module.exports = CineText;
