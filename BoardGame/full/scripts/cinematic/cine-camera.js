// BoardGame/full/scripts/cinematic/cine-camera.js
// Applies camera poses to the .scene-3d (perspective) / .rig-3d (rotation+zoom)
// pair wrapping the live board. Pose: { fov, tilt, spin, zoom }.

class CineCamera {
    constructor(sceneEl, rigEl) {
        this.sceneEl = sceneEl;
        this.rigEl = rigEl;
    }

    applyPose(pose) {
        this.sceneEl.style.perspective = `${pose.fov}px`;
        this.rigEl.style.transform =
            `scale(${pose.zoom}) rotateX(${pose.tilt}deg) rotateY(${pose.spin}deg)`;
    }

    static lerpPose(a, b, t) {
        const lerp = (x, y) => x + (y - x) * t;
        return {
            fov: lerp(a.fov, b.fov),
            tilt: lerp(a.tilt, b.tilt),
            spin: lerp(a.spin, b.spin),
            zoom: lerp(a.zoom, b.zoom)
        };
    }

    // Exact normal-mode look: remove all inline 3D so the page is
    // pixel-identical to a non-cinematic load.
    clearTo2D() {
        this.sceneEl.style.perspective = '';
        this.rigEl.style.transform = '';
    }
}

if (typeof window !== 'undefined') window.CineCamera = CineCamera;
if (typeof module !== 'undefined' && module.exports) module.exports = CineCamera;
