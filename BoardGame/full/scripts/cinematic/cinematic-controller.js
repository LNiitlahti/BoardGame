// BoardGame/full/scripts/cinematic/cinematic-controller.js
// Orchestrates the Phase-1 cinematic on view.html. Loaded only when
// window.CINE_MODE is set by the head bootstrap script.
//
// Lifecycle: wait for first data render → arm (defer renders, hide tiles,
// dramatic camera, black cover owned by us) → run timeline (drops → camera
// pull → reveal fade) → teardown (identical to a normal page).
// Safety: S/Esc skips; any error or a stalled timeline bails to the end state.

(function () {
    'use strict';
    if (!window.CINE_MODE) return;

    const state = {
        active: false,
        renderQueued: false,
        timeline: null,
        camera: null,
        tiles: null,
        config: null,
        coverEl: null,
        watchdogId: null,
        dataWaitId: null,
        voidId: null
    };

    window.CINEMATIC = {
        shouldDeferRenders: () => state.active,
        queueRender: () => { state.renderQueued = true; }
    };

    function makeCover() {
        const el = document.createElement('div');
        el.id = 'cineCover';
        el.style.cssText =
            'position:fixed;inset:0;background:#000;z-index:9999;pointer-events:none;';
        document.body.appendChild(el);
        return el;
    }

    function teardown() {
        if (!state.active) return;
        state.active = false;
        clearInterval(state.watchdogId);
        clearTimeout(state.dataWaitId);
        clearTimeout(state.voidId); // skip during the void must not resurrect the timeline

        // Each of these calls into tile/camera/timeline code that a bail()
        // triggered by a global error may itself be the source of the failure
        // in. Isolate them so one throwing can't skip the guaranteed cleanup
        // below (classes, cover, listeners) and leave the venue screen stuck.
        if (state.timeline) {
            try { state.timeline.stopRaf(); } catch (e) { console.error('[Cinematic] stopRaf failed:', e); }
            state.timeline = null;
        }
        if (state.tiles) {
            try { state.tiles.restoreAll(); } catch (e) { console.error('[Cinematic] tiles.restoreAll failed:', e); }
        }
        if (state.camera) {
            try { state.camera.clearTo2D(); } catch (e) { console.error('[Cinematic] camera.clearTo2D failed:', e); }
        }

        // Guaranteed cleanup: must happen no matter what went wrong above.
        document.body.classList.remove('cine-active');
        document.documentElement.classList.remove('cine-pending');
        if (state.coverEl) { state.coverEl.remove(); state.coverEl = null; }
        document.removeEventListener('keydown', onKeydown);
        window.removeEventListener('error', bail);

        if (state.renderQueued) {
            state.renderQueued = false;
            try { window.CineView.renderBoard(); } catch (e) { console.error('[Cinematic] deferred renderBoard failed:', e); }
        }
    }

    function bail() {
        // Same end state as a completed cinematic; never leave the venue
        // screen stuck. Safe to call from any point, including mid-error.
        try {
            if (state.timeline) state.timeline.skipToEnd(); // fires teardown via onFinished
            else teardown();
        } catch (e) {
            teardown();
        }
    }

    function onKeydown(e) {
        if (e.key === 's' || e.key === 'S' || e.key === 'Escape') bail();
    }

    function buildTimeline() {
        const cfg = state.config;
        const easing = window.CineEasing;
        const tl = new window.CineTimeline();

        const boardModule = window.CineView.getBoardModule();
        const order = window.CineBoardOrder.buildLandingOrder(
            boardModule.generateHexCoordinates()
        );

        // --- Tile drops ---
        // S2: mountain heart alone; S3: ring 1 spaced; S4: rings 2-5 compressed.
        let t = 0;
        const first = order[0]; // q0r0 (guaranteed by buildLandingOrder)
        tl.add(state.tiles.makeDropTrack(first, t, cfg.firstImpact.fallDurationMs, easing.easeInQuad));
        t += cfg.firstImpact.fallDurationMs + cfg.firstImpact.holdAfterMs;

        const ring1 = order.filter(e => e.ring === 1);
        for (const entry of ring1) {
            tl.add(state.tiles.makeDropTrack(entry, t, cfg.earlyImpacts.fallDurationMs, easing.easeInQuad));
            t += cfg.earlyImpacts.intervalMs;
        }

        const rest = order.filter(e => e.ring >= 2);
        const cascadeStart = t;
        const spacing = (cfg.cascade.totalDurationMs - cfg.cascade.fallDurationMs) / rest.length;
        rest.forEach((entry, i) => {
            tl.add(state.tiles.makeDropTrack(
                entry, cascadeStart + i * spacing, cfg.cascade.fallDurationMs, easing.easeInQuad));
        });
        const cascadeEnd = cascadeStart + cfg.cascade.totalDurationMs;

        // --- Camera: dramatic → pulled during cascade, → rest during reveal ---
        const cam = cfg.camera;
        const pullAt = cascadeStart + cfg.cascade.totalDurationMs * cfg.cascade.cameraStartFraction;
        tl.add({
            at: pullAt,
            duration: cascadeEnd - pullAt,
            ease: easing.easeInOutCubic,
            onUpdate: p => state.camera.applyPose(
                window.CineCamera.lerpPose(cam.dramatic, cam.pulled, p))
        });

        // --- Lock-in (Phase 1: hearts reappear + a quiet beat) ---
        tl.add({
            at: cascadeEnd,
            duration: cfg.lockIn.durationMs,
            onStart: () => state.tiles.showHearts(),
            onUpdate: () => {}
        });

        // --- Reveal: camera to rest + cover fades out ---
        const revealAt = cascadeEnd + cfg.lockIn.durationMs;
        tl.add({
            at: revealAt,
            duration: cfg.reveal.durationMs,
            ease: easing.easeInOutCubic,
            onUpdate: p => {
                state.camera.applyPose(window.CineCamera.lerpPose(cam.pulled, cam.rest, p));
                state.coverEl.style.opacity = String(1 - p);
            },
            onComplete: () => state.camera.clearTo2D()
        });

        // --- Signage (Phase 1: simple settle window; choreography is Phase 4) ---
        tl.add({
            at: revealAt + cfg.reveal.durationMs,
            duration: cfg.signage.durationMs,
            onUpdate: () => {}
        });

        tl.onFinished = teardown;
        return tl;
    }

    function arm() {
        state.active = true;
        document.body.classList.add('cine-active');
        state.coverEl = makeCover();
        document.documentElement.classList.remove('cine-pending'); // our cover took over

        const scene = document.getElementById('cineScene');
        const rig = document.getElementById('cineRig');
        state.camera = new window.CineCamera(scene, rig);
        state.camera.applyPose(state.config.camera.dramatic);

        state.tiles = new window.CineTiles(
            document.getElementById('hexBoard'),
            state.config.tiles
        );
        state.tiles.hideAll();

        document.addEventListener('keydown', onKeydown);
        window.addEventListener('error', bail);

        // Void: hold darkness for minDurationMs, then roll.
        state.voidId = setTimeout(() => {
            state.timeline = buildTimeline();
            state.timeline.play();
            state.timeline.startRaf();
            // Watchdog: rAF must tick steadily; a 4s gap means we're wedged.
            state.watchdogId = setInterval(() => {
                if (state.timeline && state.timeline.lastTickAt !== null &&
                    performance.now() - state.timeline.lastTickAt > 4000) {
                    bail();
                }
            }, 2000);
        }, state.config.void.minDurationMs);
    }

    async function init() {
        try {
            const res = await fetch('data/cinematic-scene.json');
            state.config = await res.json();
        } catch (e) {
            console.error('[Cinematic] Config load failed, bailing:', e);
            document.documentElement.classList.remove('cine-pending');
            return;
        }

        // Arm on the first data-driven board render…
        const onRendered = () => {
            document.removeEventListener('view-board-rendered', onRendered);
            clearTimeout(state.dataWaitId);
            arm();
        };
        document.addEventListener('view-board-rendered', onRendered);

        // Race guard: renderBoard() may have already fired — and set this
        // flag — during the config fetch's async gap above, before this
        // listener existed to catch its event. Don't fall through to the
        // 20s "no data" timeout when data actually already arrived.
        if (window.__cineHadRender) {
            onRendered();
        } else {
            // …but never wait forever (bad tournament id, Firestore down).
            state.dataWaitId = setTimeout(() => {
                document.removeEventListener('view-board-rendered', onRendered);
                console.warn('[Cinematic] No board data within 20s — showing dashboard.');
                document.documentElement.classList.remove('cine-pending');
            }, 20000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
