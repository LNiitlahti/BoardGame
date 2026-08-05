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
        text: null,
        atmosphere: null,
        config: null,
        materials: null,
        musicDrums: null,
        musicVocals: null,
        musicBackingVocals: null,
        musicBass: null,
        musicPercussion: null,
        musicStrings: null,
        musicSynth: null,
        musicOther: null,
        audioEl: null,
        coverEl: null,
        watchdogId: null,
        dataWaitId: null,
        boardWrapEl: null,
        boardWrapParent: null,
        boardWrapNextSibling: null,
        dimOverlayEl: null,
        pulseEl: null
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

    // Board brightness pulse (effect 1) — see cine-camera.js's
    // applyBoardPulse for why this is an opacity overlay rather than a
    // filter on the scene root. Lives inside .board-wrap so it brightens the
    // board without touching the rest of the page.
    function makePulse() {
        const el = document.createElement('div');
        el.id = 'cinePulse';
        el.style.cssText =
            'position:absolute;inset:0;pointer-events:none;opacity:0;' +
            'background:#fff;will-change:opacity;';
        document.querySelector('.board-wrap').appendChild(el);
        return el;
    }

    // .board-wrap normally lives inside .bottom-zone, which has its own
    // position+z-index (a stacking context). That traps .board-wrap's
    // z-index:10000 so it only ever wins against OTHER .bottom-zone
    // children — #cineCover (z-index:9999, a direct child of body) still
    // paints above the whole .bottom-zone (stacked at z-index:15), hiding
    // the board throughout the cascade. Moving .board-wrap to be a direct
    // sibling of #cineCover is what actually lets its z-index compete.
    function liftBoardWrap() {
        const el = document.querySelector('.board-wrap');
        if (!el) return;
        state.boardWrapEl = el;
        state.boardWrapParent = el.parentNode;
        state.boardWrapNextSibling = el.nextSibling;
        document.body.appendChild(el);
    }

    function restoreBoardWrap() {
        if (!state.boardWrapEl || !state.boardWrapParent) return;
        state.boardWrapParent.insertBefore(state.boardWrapEl, state.boardWrapNextSibling);
        state.boardWrapEl = null;
        state.boardWrapParent = null;
        state.boardWrapNextSibling = null;
    }

    function teardown() {
        if (!state.active) return;
        state.active = false;
        clearInterval(state.watchdogId);
        clearTimeout(state.dataWaitId);

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
        if (state.audioEl) {
            try { state.audioEl.pause(); state.audioEl.src = ''; } catch (e) { console.error('[Cinematic] audio teardown failed:', e); }
            state.audioEl = null;
        }
        if (state.text) {
            try { state.text.remove(); } catch (e) { console.error('[Cinematic] text.remove failed:', e); }
            state.text = null;
        }
        if (state.atmosphere) {
            try { state.atmosphere.remove(); } catch (e) { console.error('[Cinematic] atmosphere.remove failed:', e); }
            state.atmosphere = null;
        }

        // Guaranteed cleanup: must happen no matter what went wrong above.
        document.body.classList.remove('cine-active');
        document.documentElement.classList.remove('cine-pending');
        if (state.coverEl) { state.coverEl.remove(); state.coverEl = null; }
        if (state.pulseEl) { state.pulseEl.remove(); state.pulseEl = null; }
        try { restoreBoardWrap(); } catch (e) { console.error('[Cinematic] restoreBoardWrap failed:', e); }
        document.removeEventListener('keydown', onKeydown);
        window.removeEventListener('error', bail);

        if (state.renderQueued) {
            state.renderQueued = false;
            try { window.CineView.renderBoard(); } catch (e) { console.error('[Cinematic] deferred renderBoard failed:', e); }
        }

        redirectToCleanUrl();
    }

    // The cinematic leaves one-shot state behind (armed camera pose, spent
    // timeline, etc.) that a plain page load doesn't have. Rather than reset
    // it all in place, fade everything (including the board itself) to solid
    // black and reload the same URL minus &cinematic=1 so the page comes
    // back in its normal steady state.
    function redirectToCleanUrl() {
        const fade = document.createElement('div');
        fade.id = 'cineOutroFade';
        // Above .board-wrap (z-index:10000) and the dim veil (9998) — this
        // one has to cover the cinematic itself, not just what's under it.
        fade.style.cssText =
            'position:fixed;inset:0;z-index:10002;background-color:#000;' +
            'opacity:0;transition:opacity 0.6s ease;pointer-events:none;';
        document.body.appendChild(fade);
        requestAnimationFrame(() => { fade.style.opacity = '1'; });

        const url = new URL(location.href);
        url.searchParams.delete('cinematic');
        setTimeout(() => { location.href = url.toString(); }, 2000);
    }

    // Persistent 50%-black/12px-blur veil sitting *under* the cinematic
    // (below .board-wrap's z-index:10000, so the camera/tiles/text/atmosphere
    // stay sharp) but above the rest of the page. Present from arm() through
    // teardown() (see redirectToCleanUrl, which fades it to full black rather
    // than removing it).
    function makeDimOverlay() {
        const el = document.createElement('div');
        el.id = 'cineDimOverlay';
        el.style.cssText =
            'position:fixed;inset:0;z-index:9998;background-color:rgba(0,0,0,0.5);' +
            'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
            'transition:background-color 0.6s ease;pointer-events:none;';
        document.body.appendChild(el);
        state.dimOverlayEl = el;
        return el;
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

    // ?volume=0-100 (percent) sets the cinematic music's playback volume.
    // Missing/invalid/out-of-range values fall back to full volume (1) or
    // clamp into range, never throw.
    function getVolumeFromUrl() {
        const raw = new URLSearchParams(location.search).get('volume');
        if (raw === null) return 1;
        const pct = parseFloat(raw);
        if (Number.isNaN(pct)) return 1;
        return Math.max(0, Math.min(100, pct)) / 100;
    }

    // Effect 4 (music sync): screen-wide color wash on strong beats. See
    // cine-tiles.js's triggerBeatPulse for the same remove-reflow-readd
    // restart trick, needed because .flash may already be set from a
    // previous beat.
    function triggerWash() {
        const wash = document.getElementById('cineWash');
        if (!wash) return;
        wash.classList.remove('flash');
        void wash.offsetWidth; // force reflow so re-adding the class restarts the animation
        wash.classList.add('flash');
    }

    function buildTimeline() {
        const cfg = state.config;
        const easing = window.CineEasing;
        const tl = new window.CineTimeline();

        // Camera shake: a short, punchy, decaying jolt on the first impact
        // and each of the 6 ring-1 landings (not the dense ring2-5 cascade —
        // that would read as jittery rather than violent). Decaying
        // magnitude (1 - p) is a linear decay from full amplitude to zero,
        // a punchy hit rather than a sustained tremor.
        function addImpactShake(landingMs) {
            tl.add({
                at: landingMs,
                duration: cfg.shake.impact.durationMs,
                onUpdate: p => state.camera.setShake('impact',
                    window.CineCamera.randomOffset(cfg.shake.impact, 1 - p)),
                onComplete: () => state.camera.setShake('impact', { tilt: 0, spin: 0, zoom: 0 })
            });
        }

        const boardModule = window.CineView.getBoardModule();
        const order = window.CineBoardOrder.buildLandingOrder(
            boardModule.generateHexCoordinates()
        );

        // --- Tile drops ---
        // Offset by the void span so this timeline's own t=0 lines up with
        // arm()/audio start (see the music-sync tracks below) — the void is
        // now just "no active track yet" on this same shared clock, instead
        // of an external setTimeout gate that delayed the timeline's own
        // existence.
        // S2: mountain heart alone; S3: ring 1 spaced; S4: rings 2-5 compressed.
        const voidMs = cfg.void.minDurationMs;
        let t = voidMs;
        const first = order[0]; // q0r0 (guaranteed by buildLandingOrder)
        tl.add(state.tiles.makeDropTrack(first, t, cfg.firstImpact.fallDurationMs, easing.easeInQuad));
        addImpactShake(t + cfg.firstImpact.fallDurationMs);
        t += cfg.firstImpact.fallDurationMs + cfg.firstImpact.holdAfterMs;

        const ring1 = order.filter(e => e.ring === 1);
        for (const entry of ring1) {
            tl.add(state.tiles.makeDropTrack(entry, t, cfg.earlyImpacts.fallDurationMs, easing.easeInQuad));
            addImpactShake(t + cfg.earlyImpacts.fallDurationMs);
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

        // --- Lock-in (Phase 1: hearts reappear + a quiet beat) ---
        tl.add({
            at: cascadeEnd,
            duration: cfg.lockIn.durationMs,
            onStart: () => state.tiles.showHearts(),
            onUpdate: () => {}
        });

        const revealAt = cascadeEnd + cfg.lockIn.durationMs;
        const revealEnd = revealAt + cfg.reveal.durationMs;

        // --- Camera: one continuous spline through all three keyframes so
        // it's never parked at a fixed pose. The spline's own first keyframe
        // time is voidMs (not 0) so the camera holds exactly at "dramatic"
        // for the whole void span, then starts moving the instant tiles do
        // — same visual result as before this task's refactor, just
        // expressed as a spline clamp instead of an external delay.
        const cam = cfg.camera;
        tl.add({
            at: 0,
            duration: revealEnd,
            onUpdate: p => state.camera.applyPose(
                window.CineCamera.splinePose(
                    [cam.dramatic, cam.pulled, cam.rest],
                    [voidMs, cascadeEnd, revealEnd],
                    p * revealEnd
                ))
        });

        // --- Reveal: cover fades out. The camera's own arrival at "rest"
        // (kept identity-matched to the flat CSS default, see
        // cinematic-scene.json's "Known follow-up" note) is what makes the
        // clearTo2D() handoff below invisible instead of a visible pop.
        tl.add({
            at: revealAt,
            duration: cfg.reveal.durationMs,
            ease: easing.easeInOutCubic,
            onUpdate: p => { state.coverEl.style.opacity = String(1 - p); },
            onComplete: () => state.camera.clearTo2D()
        });

        // --- Signage (Phase 1: simple settle window; choreography is Phase 4) ---
        tl.add({
            at: revealEnd,
            duration: cfg.signage.durationMs,
            onUpdate: () => {}
        });

        const cinematicOwnEnd = revealEnd + cfg.signage.durationMs;
        const { outroDurationMs, finalEnd } = window.CineOutro.computeOutro(
            cinematicOwnEnd, state.musicDrums.durationMs);

        // --- Shared tempo signal: beat density across every loaded stem
        // (including drums/vocals) in a trailing 2s window. Read fresh at
        // each call site below rather than cached, since it's cheap and
        // varies continuously with t.
        const tempoStems = [
            state.musicDrums, state.musicVocals, state.musicBackingVocals,
            state.musicBass, state.musicPercussion, state.musicStrings,
            state.musicSynth, state.musicOther
        ];

        // --- Outro camera drift: when the music runs longer than the
        // cinematic's own choreography (cinematicOwnEnd), extend the
        // timeline to finalEnd so the track can play to completion instead
        // of being cut off when teardown() pauses the <audio> element. The
        // camera drifts from "rest" to "outro" linearly (no easing) over
        // this span — per spec, a multi-minute drift with easing would
        // visibly stall mid-motion long before it reaches the target pose.
        if (outroDurationMs > 0) {
            tl.add({
                at: cinematicOwnEnd,
                duration: outroDurationMs,
                onUpdate: p => state.camera.applyPose(
                    window.CineCamera.lerpPose(cam.rest, cam.outro, p))
            });
        }

        // --- Vocal-synced text: title first, then cycles through
        // team/player names on a fixed schedule, re-flickering on every
        // vocal onset. Runs only during signage+outro (revealEnd → finalEnd).
        const names = (window.CineView.getGameState()?.teams || [])
            .flatMap(team => (team.players || []).map(p => p.name))
            .filter(Boolean);
        const cycle = [cfg.text.title, ...names]; // always at least the title

        const textWindowStart = revealEnd;
        const textWindowEnd = finalEnd;
        const textInterval = cfg.text.displayIntervalMs;

        for (let at = textWindowStart, i = 0; at < textWindowEnd; at += textInterval, i++) {
            const displayText = cycle[i % cycle.length];
            tl.add({
                at, duration: 0,
                onStart: () => state.text.setText(displayText)
            });
        }

        state.musicVocals.beats.forEach(beatMs => {
            if (beatMs < textWindowStart || beatMs > textWindowEnd) return;
            tl.add({
                at: beatMs, duration: 0,
                onStart: () => state.text.triggerFlicker(
                    window.CineTempo.computeTempo(tempoStems, beatMs, cfg.tempo))
            });
        });

        // --- Music sync: envelope pulse (effects 1+2) + beat-triggered hex
        // wave (effect 3) / color wash (effect 4). Same shared clock as
        // everything above (t=0 = arm()/audio start). These now run through
        // finalEnd — the cinematic's own length, extended by the outro
        // drift above when the music runs longer — so a track shorter than
        // finalEnd just goes quiet for the remainder (envelopeAt clamps to
        // the last sample), and a track at or under finalEnd plays to
        // completion instead of being cut off.
        const music = state.musicDrums;
        const envelopeDuration = Math.min(music.durationMs, finalEnd);
        if (envelopeDuration > 0) {
            tl.add({
                at: 0,
                duration: envelopeDuration,
                onUpdate: p => {
                    const amp = music.envelopeAt(p * envelopeDuration);
                    state.camera.applyBoardPulse(amp);
                    state.camera.setShake('music', window.CineCamera.randomOffset(cfg.shake.music, amp));
                    state.atmosphere.applyIntensity(amp);
                }
            });
        }

        const maxRing = order.reduce((m, e) => Math.max(m, e.ring), 0);
        const hexesByRing = new Map();
        for (const entry of order) {
            if (!hexesByRing.has(entry.ring)) hexesByRing.set(entry.ring, []);
            hexesByRing.get(entry.ring).push(entry.coord);
        }
        const washThreshold = cfg.music.washThreshold;
        music.beats.forEach((beatMs, i) => {
            // Past the cinematic's own end: it'll never fire (the timeline
            // finishes and tears down the audio before reaching it), so
            // don't schedule it — scheduling it anyway would silently
            // stretch tl.duration (see the CineTimeline.duration getter)
            // past the cinematic's real length, delaying its own finish.
            if (beatMs > finalEnd) return;

            const ring = i % (maxRing + 1);
            const coords = hexesByRing.get(ring) || [];
            tl.add({
                at: beatMs,
                duration: 250,
                onStart: () => coords.forEach(coord => state.tiles.triggerBeatPulse(coord)),
                onUpdate: () => {}
            });

            if (music.envelopeAt(beatMs) >= washThreshold) {
                tl.add({
                    at: beatMs,
                    duration: 250,
                    onStart: () => triggerWash(),
                    onUpdate: () => {}
                });
            }
        });

        // --- Multi-stem effects: backing vocals, bass, percussion, strings,
        // synth, other. Each stem is independently optional — a missing/
        // failed load yields an inert CineMusic (empty envelope/beats, see
        // cine-music.js), so guarding on envelope/beats length here is what
        // makes a missing stem's effect not fire, without needing a separate
        // null-check path. Continuous-envelope stems run 0..min(duration,
        // finalEnd), same clamping pattern as the drums envelope block above.
        if (state.musicBackingVocals.envelope.length > 0) {
            const dur = Math.min(state.musicBackingVocals.durationMs, finalEnd);
            tl.add({
                at: 0,
                duration: dur,
                onUpdate: p => state.atmosphere.applyFogIntensity(
                    state.musicBackingVocals.envelopeAt(p * dur))
            });
        }

        if (state.musicBass.envelope.length > 0) {
            const dur = Math.min(state.musicBass.durationMs, finalEnd);
            tl.add({
                at: 0,
                duration: dur,
                onUpdate: p => state.camera.applyBassScale(
                    state.musicBass.envelopeAt(p * dur), cfg.bass.scaleAmp)
            });
        }

        if (state.musicPercussion.beats.length > 0) {
            state.musicPercussion.beats.forEach(beatMs => {
                if (beatMs > finalEnd) return; // never fires past the cinematic's own end, see the drums beat loop above
                tl.add({
                    at: beatMs,
                    duration: 0,
                    onStart: () => state.atmosphere.triggerSpark(
                        window.CineTempo.computeTempo(tempoStems, beatMs, cfg.tempo),
                        cfg.percussion.sparkDurationMs)
                });
            });
        }

        if (state.musicStrings.envelope.length > 0) {
            const dur = Math.min(state.musicStrings.durationMs, finalEnd);
            tl.add({
                at: 0,
                duration: dur,
                onUpdate: p => {
                    const t = p * dur;
                    const amp = state.musicStrings.envelopeAt(t);
                    const speedFactor = window.CineTempo.computeTempo(tempoStems, t, cfg.tempo);
                    state.camera.applyDrift(amp, speedFactor, t, {
                        tiltAmp: cfg.strings.driftTiltAmp,
                        spinAmp: cfg.strings.driftSpinAmp,
                        periodBaseMs: cfg.strings.driftPeriodMs
                    });
                }
            });
        }

        if (state.musicSynth.envelope.length > 0) {
            const dur = Math.min(state.musicSynth.durationMs, finalEnd);
            tl.add({
                at: 0,
                duration: dur,
                onUpdate: p => state.atmosphere.applySynthGlow(
                    state.musicSynth.envelopeAt(p * dur))
            });
        }

        if (state.musicOther.envelope.length > 0) {
            const dur = Math.min(state.musicOther.durationMs, finalEnd);
            tl.add({
                at: 0,
                duration: dur,
                onUpdate: p => state.atmosphere.applyBaseIntensity(
                    state.musicOther.envelopeAt(p * dur))
            });
        }

        tl.onFinished = teardown;
        return tl;
    }

    function arm() {
        state.active = true;
        document.body.classList.add('cine-active');
        liftBoardWrap();
        state.coverEl = makeCover();
        makeDimOverlay();
        document.documentElement.classList.remove('cine-pending'); // our cover took over

        const scene = document.getElementById('cineScene');
        const rig = document.getElementById('cineRig');
        state.pulseEl = makePulse();
        state.camera = new window.CineCamera(scene, rig, state.pulseEl);
        state.camera.applyPose(state.config.camera.dramatic);

        state.tiles = new window.CineTiles(
            document.getElementById('hexBoard'),
            state.config.tiles,
            state.materials
        );
        state.tiles.hideAll();

        state.text = new window.CineText(document.querySelector('.board-wrap'));

        state.atmosphere = new window.CineAtmosphere(
            document.querySelector('.board-wrap'), state.config.atmosphere);

        document.addEventListener('keydown', onKeydown);
        window.addEventListener('error', bail);

        // Music starts right here so it plays through the void, exactly like
        // the timeline below (both share the same t=0). Autoplay may be
        // blocked with no prior user gesture — since sync is driven by the
        // precomputed cues, not the actual playing audio, a blocked autoplay
        // just means a silent light show, never a desynced one. The
        // rejection is caught and ignored (not retried/surfaced) for that
        // reason.
        state.audioEl = new Audio('audio/cinematic-music.mp3');
        state.audioEl.volume = getVolumeFromUrl();
        state.audioEl.play().catch(() => {});

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
    }

    async function init() {
        try {
            // CineMaterials.load() never rejects (degrades to an all-default
            // instance internally on its own fetch failure) — so this
            // Promise.all only ever rejects on the scene config side, which
            // is the only failure that should bail the whole cinematic.
            //
            // Each music-cues-*.json is a separate stem feeding a distinct
            // effect (see cine-camera.js/cine-atmosphere.js/cine-text.js for
            // the effect wiring, and buildTimeline() below for where each is
            // scheduled). CineMusic.load() never rejects either (see
            // cine-music.js) — a missing/failed stem file degrades to an
            // inert CineMusic (empty envelope/beats), so every stem beyond
            // drums is independently optional with no extra wrapping needed
            // here. vocals/backingVocals/bass/percussion/strings/synth/other
            // may all ship partially analyzed; drums is the only stem this
            // cinematic treats as required for its own beat-synced staging.
            const [
                config, materials, musicDrums, musicVocals, musicBackingVocals,
                musicBass, musicPercussion, musicStrings, musicSynth, musicOther
            ] = await Promise.all([
                fetch('data/cinematic-scene.json').then(res => res.json()),
                window.CineMaterials.load('../shared/data/hex-materials.json'),
                window.CineMusic.load('data/music-cues-drums.json'),
                window.CineMusic.load('data/music-cues-vocals.json'),
                window.CineMusic.load('data/music-cues-backingVocals.json'),
                window.CineMusic.load('data/music-cues-bass.json'),
                window.CineMusic.load('data/music-cues-percussion.json'),
                window.CineMusic.load('data/music-cues-strings.json'),
                window.CineMusic.load('data/music-cues-synth.json'),
                window.CineMusic.load('data/music-cues-other.json')
            ]);
            state.config = config;
            state.materials = materials;
            state.musicDrums = musicDrums;
            state.musicVocals = musicVocals;
            state.musicBackingVocals = musicBackingVocals;
            state.musicBass = musicBass;
            state.musicPercussion = musicPercussion;
            state.musicStrings = musicStrings;
            state.musicSynth = musicSynth;
            state.musicOther = musicOther;
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
