const test = require('node:test');
const assert = require('node:assert');
const CineCamera = require('../../full/scripts/cinematic/cine-camera.js');

const POSES = [
    { fov: 900, tilt: 62, spin: -18, zoom: 0.9 },
    { fov: 1400, tilt: 45, spin: -8, zoom: 0.7 },
    { fov: 3500, tilt: 0, spin: 0, zoom: 1 }
];
const TIMES = [0, 53000, 83000];

test('splinePose: passes exactly through every keyframe at its own time', () => {
    for (let i = 0; i < POSES.length; i++) {
        const result = CineCamera.splinePose(POSES, TIMES, TIMES[i]);
        for (const key of ['fov', 'tilt', 'spin', 'zoom']) {
            assert.ok(Math.abs(result[key] - POSES[i][key]) < 1e-6,
                `keyframe ${i} field ${key}: expected ${POSES[i][key]}, got ${result[key]}`);
        }
    }
});

test('splinePose: clamps to the first/last pose outside the time range', () => {
    const before = CineCamera.splinePose(POSES, TIMES, -5000);
    assert.deepStrictEqual(before, POSES[0]);
    const after = CineCamera.splinePose(POSES, TIMES, 999999);
    assert.deepStrictEqual(after, POSES[2]);
});

test('splinePose: reproduces exactly linear data (no overshoot/undershoot)', () => {
    // If every field is exactly linear in time, a well-formed Catmull-Rom /
    // cubic Hermite spline must reproduce that line exactly at any query
    // point -- this is the classic sanity check for spline correctness.
    const linearPoses = [
        { fov: 0, tilt: 0, spin: 0, zoom: 0 },
        { fov: 10, tilt: 20, spin: -10, zoom: 5 },
        { fov: 30, tilt: 60, spin: -30, zoom: 15 }
    ];
    const linearTimes = [0, 10, 30];
    for (const t of [0, 3, 7, 10, 15, 22, 30]) {
        const result = CineCamera.splinePose(linearPoses, linearTimes, t);
        assert.ok(Math.abs(result.fov - t) < 1e-6, `fov at t=${t}: expected ${t}, got ${result.fov}`);
        assert.ok(Math.abs(result.tilt - t * 2) < 1e-6, `tilt at t=${t}: expected ${t * 2}, got ${result.tilt}`);
        assert.ok(Math.abs(result.spin - -t) < 1e-6, `spin at t=${t}: expected ${-t}, got ${result.spin}`);
        assert.ok(Math.abs(result.zoom - t * 0.5) < 1e-6, `zoom at t=${t}: expected ${t * 0.5}, got ${result.zoom}`);
    }
});

test('splinePose: two keyframes degenerates to plain linear interpolation', () => {
    const twoPoses = [POSES[0], POSES[2]];
    const twoTimes = [0, 100];
    for (const t of [0, 25, 50, 75, 100]) {
        const spline = CineCamera.splinePose(twoPoses, twoTimes, t);
        const lerp = CineCamera.lerpPose(POSES[0], POSES[2], t / 100);
        for (const key of ['fov', 'tilt', 'spin', 'zoom']) {
            assert.ok(Math.abs(spline[key] - lerp[key]) < 1e-6,
                `t=${t} field ${key}: spline ${spline[key]} vs lerp ${lerp[key]}`);
        }
    }
});

test('splinePose: continuous across an interior knot (no jump at the boundary)', () => {
    const justBefore = CineCamera.splinePose(POSES, TIMES, TIMES[1] - 0.01);
    const atKnot = CineCamera.splinePose(POSES, TIMES, TIMES[1]);
    const justAfter = CineCamera.splinePose(POSES, TIMES, TIMES[1] + 0.01);
    for (const key of ['fov', 'tilt', 'spin', 'zoom']) {
        assert.ok(Math.abs(justBefore[key] - atKnot[key]) < 0.5,
            `${key} jumped approaching the knot from before: ${justBefore[key]} vs ${atKnot[key]}`);
        assert.ok(Math.abs(justAfter[key] - atKnot[key]) < 0.5,
            `${key} jumped approaching the knot from after: ${justAfter[key]} vs ${atKnot[key]}`);
    }
});

test('splinePose: velocity at the interior keyframe is non-zero (camera keeps moving through it)', () => {
    // The whole point of using a spline instead of chained lerps: at an
    // interior keyframe the camera should NOT come to a stop. Approximate
    // the derivative numerically at TIMES[1] and confirm it's not ~0 for a
    // field that actually changes across the keyframe sequence (fov goes
    // 900 -> 1400 -> 3500, clearly not flat around the middle keyframe).
    const dt = 1;
    const before = CineCamera.splinePose(POSES, TIMES, TIMES[1] - dt);
    const after = CineCamera.splinePose(POSES, TIMES, TIMES[1] + dt);
    const velocity = (after.fov - before.fov) / (2 * dt);
    assert.ok(Math.abs(velocity) > 0.001, `expected non-zero velocity through the interior keyframe, got ${velocity}`);
});

test('randomOffset: magnitude 0 always returns zero offset regardless of rng', () => {
    const amp = { tiltAmp: 2.5, spinAmp: 3, zoomAmp: 0.03 };
    const result = CineCamera.randomOffset(amp, 0, () => 0.999);
    assert.deepStrictEqual(result, { tilt: 0, spin: 0, zoom: 0 });
});

test('randomOffset: rng() = 1 gives +amp*magnitude on every axis', () => {
    const amp = { tiltAmp: 2.5, spinAmp: 3, zoomAmp: 0.03 };
    const result = CineCamera.randomOffset(amp, 1, () => 1);
    assert.strictEqual(result.tilt, 2.5);
    assert.strictEqual(result.spin, 3);
    assert.strictEqual(result.zoom, 0.03);
});

test('randomOffset: rng() = 0 gives -amp*magnitude on every axis', () => {
    const amp = { tiltAmp: 2.5, spinAmp: 3, zoomAmp: 0.03 };
    const result = CineCamera.randomOffset(amp, 1, () => 0);
    assert.strictEqual(result.tilt, -2.5);
    assert.strictEqual(result.spin, -3);
    assert.strictEqual(result.zoom, -0.03);
});

test('randomOffset: magnitude scales linearly', () => {
    const amp = { tiltAmp: 10, spinAmp: 10, zoomAmp: 10 };
    const full = CineCamera.randomOffset(amp, 1, () => 1);
    const half = CineCamera.randomOffset(amp, 0.5, () => 1);
    assert.strictEqual(half.tilt, full.tilt / 2);
});

test('setShake: two named shakes sum in the rendered transform', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 0, spin: 0, zoom: 1 });
    cam.setShake('impact', { tilt: 2, spin: 3, zoom: 0.01 });
    cam.setShake('music', { tilt: 1, spin: -1, zoom: 0.02 });
    assert.strictEqual(rigEl.style.transform, 'scale(1.03) rotateX(3deg) rotateY(2deg)');
});

test('applyPose with no shakes set reproduces the no-shake transform exactly', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 10, spin: -5, zoom: 1.2 });
    assert.strictEqual(sceneEl.style.perspective, '3500px');
    assert.strictEqual(rigEl.style.transform, 'scale(1.2) rotateX(10deg) rotateY(-5deg)');
});

test('clearTo2D resets shake state as well as inline styles', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 0, spin: 0, zoom: 1 });
    cam.setShake('impact', { tilt: 5, spin: 5, zoom: 0.1 });
    cam.clearTo2D();
    cam.applyPose({ fov: 1000, tilt: 0, spin: 0, zoom: 1 });
    // If clearTo2D had NOT reset _shakes, this second applyPose's _render()
    // would still add the stale impact offset back in.
    assert.strictEqual(rigEl.style.transform, 'scale(1) rotateX(0deg) rotateY(0deg)');
});

test('applyBassScale: multiplies zoom on top of pose and shake, does not overwrite them', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 0, spin: 0, zoom: 1 });
    cam.setShake('music', { tilt: 0, spin: 0, zoom: 0.02 });
    cam.applyBassScale(1); // amp=1 -> bassScale = 1.03
    assert.strictEqual(rigEl.style.transform, 'scale(1.0506) rotateX(0deg) rotateY(0deg)');
});

test('applyBassScale: amp=0 leaves zoom unchanged', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 0, spin: 0, zoom: 1 });
    cam.applyBassScale(0);
    assert.strictEqual(rigEl.style.transform, 'scale(1) rotateX(0deg) rotateY(0deg)');
});

test('applyDrift: amp=0 contributes zero offset regardless of speedFactor/time', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 10, spin: -5, zoom: 1 });
    cam.applyDrift(0, 1.6, 12345);
    assert.strictEqual(rigEl.style.transform, 'scale(1) rotateX(10deg) rotateY(-5deg)');
});

test('applyDrift: composes additively with pose, not overwriting it', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 10, spin: -5, zoom: 1 });
    cam.applyDrift(1, 1, 1500); // period=6000ms, phase = 1500/6000*2*PI = PI/2
    const expectedTilt = 10 + Math.sin(Math.PI / 2) * 1 * 1.2;
    const expectedSpin = -5 + Math.cos(Math.PI / 2 * 0.7) * 1 * 1.5;
    const gotTilt = parseFloat(rigEl.style.transform.match(/rotateX\((-?[\d.]+)deg\)/)[1]);
    const gotSpin = parseFloat(rigEl.style.transform.match(/rotateY\((-?[\d.]+)deg\)/)[1]);
    assert.ok(Math.abs(gotTilt - expectedTilt) < 1e-6, `tilt: expected ${expectedTilt}, got ${gotTilt}`);
    assert.ok(Math.abs(gotSpin - expectedSpin) < 1e-6, `spin: expected ${expectedSpin}, got ${gotSpin}`);
});

test('clearTo2D resets bass scale and drift as well as shakes', () => {
    const sceneEl = { style: {} };
    const rigEl = { style: {} };
    const cam = new CineCamera(sceneEl, rigEl);
    cam.applyPose({ fov: 3500, tilt: 0, spin: 0, zoom: 1 });
    cam.applyBassScale(1);
    cam.applyDrift(1, 1, 1500);
    cam.clearTo2D();
    cam.applyPose({ fov: 1000, tilt: 0, spin: 0, zoom: 1 });
    assert.strictEqual(rigEl.style.transform, 'scale(1) rotateX(0deg) rotateY(0deg)');
});
