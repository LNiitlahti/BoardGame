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

    // Smooth motion through 2+ keyframe poses at ascending `times` (ms), so
    // the camera is never parked at a fixed pose between them the way
    // chained lerpPose() segments are. Passes exactly through every
    // keyframe with a continuously changing velocity (non-zero at interior
    // keyframes) via piecewise cubic Hermite interpolation, using
    // non-uniform Catmull-Rom tangents (one-sided/clamped at the ends so
    // motion starts and ends exactly at the first/last pose, not
    // overshooting past it). Degenerates to plain lerpPose() for exactly 2
    // keyframes, and reproduces exactly-linear data exactly (both verified
    // in cine-camera.test.js).
    static splinePose(poses, times, t) {
        const n = poses.length;
        if (n === 1 || t <= times[0]) return { ...poses[0] };
        if (t >= times[n - 1]) return { ...poses[n - 1] };

        let i = 0;
        while (i < n - 2 && t >= times[i + 1]) i++;

        const t0 = times[i], t1 = times[i + 1];
        const dt = t1 - t0;
        const s = (t - t0) / dt;
        const s2 = s * s, s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;

        const tangentAt = (idx) => {
            if (idx === 0) {
                return CineCamera._scalePose(
                    CineCamera._subPose(poses[1], poses[0]), 1 / (times[1] - times[0]));
            }
            if (idx === n - 1) {
                return CineCamera._scalePose(
                    CineCamera._subPose(poses[n - 1], poses[n - 2]), 1 / (times[n - 1] - times[n - 2]));
            }
            return CineCamera._scalePose(
                CineCamera._subPose(poses[idx + 1], poses[idx - 1]), 1 / (times[idx + 1] - times[idx - 1]));
        };

        const m0 = tangentAt(i);
        const m1 = tangentAt(i + 1);
        const p0 = poses[i], p1 = poses[i + 1];

        const result = {};
        for (const key of ['fov', 'tilt', 'spin', 'zoom']) {
            result[key] =
                h00 * p0[key] + h10 * dt * m0[key] +
                h01 * p1[key] + h11 * dt * m1[key];
        }
        return result;
    }

    static _subPose(a, b) {
        return { fov: a.fov - b.fov, tilt: a.tilt - b.tilt, spin: a.spin - b.spin, zoom: a.zoom - b.zoom };
    }

    static _scalePose(a, k) {
        return { fov: a.fov * k, tilt: a.tilt * k, spin: a.spin * k, zoom: a.zoom * k };
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
