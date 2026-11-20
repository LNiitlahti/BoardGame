// BoardGame/full/scripts/cinematic/cine-script-expansion.js
// The "expansion" cinematic: the familiar 91-hex board builds, unrest grows
// along its rim, then on the song's drop the outer rings 6-7 erupt outward
// and the camera pulls back to the new 169-hex scale. Times come from
// cinematic-scene-expansion.json (absolute song ms); the tile schedule from
// CineExpansionPlan. Music-reactive layers shared with the classic script
// (board pulse, fog, bass, sparks, drift, synth) are added by the controller.

(function () {
    'use strict';

    /**
     * Adds the expansion choreography to `tl`.
     * @param {object} o
     * @param {CineTimeline} o.tl
     * @param {object} o.xcfg       cinematic-scene-expansion.json
     * @param {object} o.cfg        cinematic-scene.json (shake, tiles)
     * @param {object} o.plan       CineExpansionPlan.planExpansion() result
     * @param {CineTiles} o.tiles
     * @param {CineCamera} o.camera
     * @param {CineExpansionFx} o.fx
     * @param {CineMusic} o.drums
     * @param {CineMusic} o.strings
     * @param {Function} o.triggerWash
     * @returns {number} the script's end time (ms)
     */
    function build(o) {
        const { tl, xcfg, cfg, plan, tiles, camera, fx, drums, strings, triggerWash } = o;
        const A = xcfg.acts, X = xcfg.effects;
        const easing = window.CineEasing;
        const Cam = window.CineCamera;

        // --- Camera: one spline through every act pose.
        const keys = xcfg.camera.keys;
        const poses = keys.map(k => k.pose), times = keys.map(k => k.at);
        tl.add({ at: 0, duration: A.end, onUpdate: p => camera.applyPose(Cam.splinePose(poses, times, p * A.end)) });

        function shake(atMs, amp) {
            tl.add({
                at: atMs, duration: amp.durationMs,
                onUpdate: p => camera.setShake('impact', Cam.randomOffset(amp, 1 - p)),
                onComplete: () => camera.setShake('impact', { tilt: 0, spin: 0, zoom: 0 })
            });
        }

        // --- Act 1: the void. Glow where the heart will land, swelling with the strings.
        tl.add({
            at: 0, duration: A.heartDrop,
            onUpdate: p => {
                const t = p * A.heartDrop;
                const strings01 = strings ? strings.envelopeAt(t) : 0;
                const ramp = Math.min(1, t / A.heartDrop);
                fx.setHeartGlow(X.voidGlowMax * Math.max(ramp * 0.5, strings01) * ramp);
            }
        });
        // After the heart lands the glow eases off over the first ring.
        tl.add({
            at: A.heartDrop, duration: 6000,
            onUpdate: p => fx.setHeartGlow(X.voidGlowMax * (1 - p))
        });

        // --- Act 2: drops (rings 0-5). Ring 0/1 landings punch the camera.
        for (const d of plan.drops.filter(x => x.kind === 'drop')) {
            const ease = d.ring === 0 ? easing.easeInQuad : easing.easeInQuad;
            tl.add(tiles.makeDropTrack({ coord: d.coord }, d.at, d.duration, ease));
            if (d.ring <= 1) shake(d.landAt, cfg.shake.impact);
        }
        tl.add({ at: A.heartDrop, duration: 0, onStart: () => triggerWash() });

        // --- Act 3: as we knew it. Mountain heart ignites.
        tl.add({
            at: A.familiarDone, duration: 0,
            onStart: () => { fx.showMountainHeartOnly(); triggerWash(); }
        });

        // --- Act 4: something is wrong. Cracks creep round the rim, tremor builds.
        const unrestLen = A.breath - A.unrest;
        tl.add({
            at: A.unrest, duration: unrestLen,
            onUpdate: p => {
                fx.setCracks(p, X.crackBrightnessUnrest * Math.min(1, 0.25 + p));
                fx.setTremor(p * 0.6, A.unrest + p * unrestLen);
            }
        });

        // --- Act 5: the breath. Everything still; cracks blaze; dust pours.
        const breathLen = A.break - A.breath;
        tl.add({
            at: A.breath, duration: breathLen,
            onUpdate: p => {
                fx.setCracks(1, X.crackBrightnessUnrest + (X.crackBrightnessBreath - X.crackBrightnessUnrest) * p);
                // Tremor dies down to a held breath, then surges in the last 2 s.
                const t = A.breath + p * breathLen;
                const toBreak = A.break - t;
                const surge = toBreak < 2000 ? 1 - toBreak / 2000 : 0;
                fx.setTremor(Math.max(0.6 * (1 - p * 1.5), 0) + surge, t);
            }
        });

        // Dust: steady trickle in Act 4, heavy in Act 5.
        let rngState = 12345;
        const rng = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
        for (let t = A.unrest + 4000; t < A.breath; t += X.dustEveryMsUnrest) {
            tl.add({ at: t, duration: 0, onStart: () => fx.spawnDust(rng) });
        }
        for (let t = A.breath; t < A.break; t += X.dustEveryMsBreath) {
            tl.add({ at: t, duration: 0, onStart: () => fx.spawnDust(rng) });
        }

        // --- Act 6: THE BREAK.
        tl.add({
            at: A.break, duration: 0,
            onStart: () => { fx.clearTremor(); fx.setCracks(0, 0); triggerWash(); }
        });
        tl.add({
            at: A.break, duration: X.breakFlashMs,
            onUpdate: p => fx.setFlash(p < 0.08 ? p / 0.08 : (1 - p) / 0.92)
        });
        tl.add({ at: A.break, duration: X.shockwaveMs, onUpdate: p => fx.setShockwave(p), onComplete: () => fx.setShockwave(1) });
        shake(A.break, X.breakShake);
        for (const d of plan.drops.filter(x => x.kind === 'erupt')) {
            tl.add(fx.makeEruptTrack(d, easing.easeOutCubic || (p => 1 - Math.pow(1 - p, 3))));
        }
        const allLanded = Math.max(...plan.drops.map(d => d.landAt));
        tl.add({ at: allLanded, duration: 0, onStart: () => { fx.showAllHearts(); triggerWash(); } });

        // --- Act 7: the new world. Beat waves roll outward across every ring.
        const maxRing = plan.drops.reduce((m, d) => Math.max(m, d.ring), 0);
        const byRing = new Map();
        for (const d of plan.drops) {
            if (!byRing.has(d.ring)) byRing.set(d.ring, []);
            byRing.get(d.ring).push(d.coord);
        }
        // Before the break the classic-style single-ring pulse keeps the old
        // board alive (rings 0-5 only); after it, full outward waves.
        drums.beats.forEach((beatMs, i) => {
            if (beatMs < A.familiarDone || beatMs >= A.settle) return;
            if (beatMs < A.break) {
                if (beatMs >= A.breath) return; // the breath is still
                const ring = i % 6;
                tl.add({ at: beatMs, duration: 0, onStart: () => byRing.get(ring).forEach(c => tiles.triggerBeatPulse(c)) });
                return;
            }
            if (beatMs < allLanded) return;
            for (let r = 0; r <= maxRing; r++) {
                const coords = byRing.get(r) || [];
                tl.add({ at: beatMs + r * X.waveRingDelayMs, duration: 0, onStart: () => coords.forEach(c => tiles.triggerBeatPulse(c)) });
            }
        });

        // --- Act 8: settle (camera spline already eases to the flat rest pose).
        tl.add({ at: A.end, duration: 0, onStart: () => {} });
        return A.end;
    }

    window.CineScriptExpansion = { build };
})();
