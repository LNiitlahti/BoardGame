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
