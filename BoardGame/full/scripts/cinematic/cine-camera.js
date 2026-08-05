// BoardGame/full/scripts/cinematic/cine-camera.js
// Applies camera poses to the .scene-3d (perspective) / .rig-3d (rotation+zoom)
// pair wrapping the live board. Pose: { fov, tilt, spin, zoom }.
//
// Shake: named, summed offsets layered on top of the base pose (impact jolts,
// continuous music rumble). Neither shake source touches applyPose/splinePose/
// lerpPose — they only ever change what _render() adds on top.

const ZERO_SHAKE = { tilt: 0, spin: 0, zoom: 0 };

class CineCamera {
    constructor(sceneEl, rigEl) {
        this.sceneEl = sceneEl;
        this.rigEl = rigEl;
        this._basePose = { fov: 3500, tilt: 0, spin: 0, zoom: 1 }; // matches CSS rest default
        this._shakes = { impact: ZERO_SHAKE, music: ZERO_SHAKE };
        this._bassScale = 1;
        this._drift = { tilt: 0, spin: 0 };
    }

    applyPose(pose) {
        this._basePose = pose;
        this._render();
    }

    // name: 'impact' | 'music'. Offsets from different sources are summed,
    // not overwritten — an impact jolt and the music rumble can be in-flight
    // at the same time without one clobbering the other.
    setShake(name, offset) {
        this._shakes[name] = offset;
        this._render();
    }

    // Effect (music sync): board-wide scale pulse driven by bass amplitude,
    // multiplicative on top of pose/shake zoom so it composes rather than
    // overwrites -- same non-overwriting contract as setShake's named
    // channels, just multiplicative instead of additive (a scale pulse reads
    // as "punchier" multiplicative than additive at these small amplitudes).
    applyBassScale(amp, scaleAmp = 0.03) {
        this._bassScale = 1 + amp * scaleAmp;
        this._render();
    }

    // Effect (music sync): slow, smoothly-eased camera drift driven by
    // strings amplitude -- distinct from setShake's per-frame random jitter.
    // Stateless (a pure function of tMs), matching splinePose/lerpPose's
    // pure-function style, so no per-frame delta-time bookkeeping is needed
    // in the timeline's onUpdate callbacks. period shrinks as speedFactor
    // grows (faster tempo => faster drift cycle). tiltAmp/spinAmp/periodBaseMs
    // are tunable (wired to cinematic-scene.json's "strings" section); the
    // defaults reproduce the original hardcoded values.
    applyDrift(amp, speedFactor, tMs, { tiltAmp = 1.2, spinAmp = 1.5, periodBaseMs = 6000 } = {}) {
        const period = periodBaseMs / speedFactor;
        const phase = (tMs / period) * Math.PI * 2;
        this._drift = { tilt: Math.sin(phase) * amp * tiltAmp, spin: Math.cos(phase * 0.7) * amp * spinAmp };
        this._render();
    }

    _render() {
        const p = this._basePose;
        let tilt = p.tilt, spin = p.spin, zoom = p.zoom;
        for (const s of Object.values(this._shakes)) {
            tilt += s.tilt; spin += s.spin; zoom += s.zoom;
        }
        tilt += this._drift.tilt; spin += this._drift.spin;
        zoom *= this._bassScale;
        this.sceneEl.style.perspective = `${p.fov}px`;
        this.rigEl.style.transform = `scale(${zoom}) rotateX(${tilt}deg) rotateY(${spin}deg)`;
    }

    // Effect 1 (music sync): whole-board brightness, driven every frame by
    // music.envelopeAt(). amp is 0-1; subtle at rest, a noticeable glow at
    // the track's peak. Applied to sceneEl (not rigEl): rigEl needs
    // transform-style: preserve-3d to stay intact for the tile-drop
    // cascade's translateZ depth (cine-tiles.js), and a non-none `filter`
    // on an element forces that element's own transform-style to flatten
    // per the CSS spec — sceneEl has no 3D-transformed children of its own,
    // so it isn't part of that preserve-3d chain and is safe to filter.
    applyBoardPulse(amp) {
        this.sceneEl.style.filter = `brightness(${1 + amp * 0.35})`;
    }

    // magnitude: 0-1. 0 = no shake. 1 = full amplitude. Caller supplies an
    // `rng` (defaults to Math.random) purely so tests can inject a
    // deterministic one instead of asserting on random output.
    static randomOffset(amp, magnitude, rng = Math.random) {
        const jitter = (a) => a * magnitude * (rng() * 2 - 1);
        return { tilt: jitter(amp.tiltAmp), spin: jitter(amp.spinAmp), zoom: jitter(amp.zoomAmp) };
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
    // pixel-identical to a non-cinematic load. Also resets shake state so a
    // skip/teardown mid-shake never leaves residue in a reused instance.
    clearTo2D() {
        this.sceneEl.style.perspective = '';
        this.rigEl.style.transform = '';
        this.sceneEl.style.filter = '';
        this._shakes = { impact: ZERO_SHAKE, music: ZERO_SHAKE };
        this._bassScale = 1;
        this._drift = { tilt: 0, spin: 0 };
    }
}

if (typeof window !== 'undefined') window.CineCamera = CineCamera;
if (typeof module !== 'undefined' && module.exports) module.exports = CineCamera;
