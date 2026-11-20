// BoardGame/full/scripts/cinematic/cine-video.js
// Plays the pre-rendered cinematic (full/video/cinematic.mp4, rendered by
// dev/tools/cinematic-render/render.js) instead of the live DOM cinematic,
// with the title/player names drawn live on top from the same CineNames
// schedule the live timeline uses. Any problem before playback starts ->
// tryStart() resolves false and the caller runs the live cinematic.

(function () {
    'use strict';
    const VIDEO_DIR = 'video/';
    const LOAD_TIMEOUT_MS = 30000;

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.json();
    }

    // Whole file into memory first: playback must never stream over venue Wi-Fi.
    async function fetchBlobUrl(url, timeoutMs) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
            return URL.createObjectURL(await res.blob());
        } finally {
            clearTimeout(timer);
        }
    }

    async function startPlayback(video) {
        try { await video.play(); return true; } catch (e) { /* autoplay with sound blocked */ }
        video.muted = true;
        try { await video.play(); return true; } catch (e) { return false; }
    }

    /**
     * @param {object} o
     * @param {object} o.gameState      tournament doc (board version + names)
     * @param {number} o.volume         0..1
     * @param {object} o.config         cinematic-scene.json (text.title, text.displayIntervalMs, tempo)
     * @param {number[]} o.vocalBeats   music-cues-vocals beats (ms)
     * @param {object[]} o.tempoStems   CineMusic stems for CineTempo
     * @param {Function} o.onDone       called on end / skip (fade + go to dashboard)
     * @param {Function} o.onFailMidPlay called if the video errors after starting
     * @returns {Promise<boolean>} true if the video took over
     */
    async function tryStart(o) {
        let meta;
        try { meta = await fetchJson(VIDEO_DIR + 'cinematic-meta.json'); }
        catch (e) { console.info('[CineVideo] no pre-rendered video, using live cinematic'); return false; }
        if (!window.CineVideoMeta.isUsable(meta, o.gameState)) {
            console.info('[CineVideo] video meta not usable for this tournament, using live cinematic', meta);
            return false;
        }

        let blobUrl;
        try { blobUrl = await fetchBlobUrl(VIDEO_DIR + 'cinematic.mp4', LOAD_TIMEOUT_MS); }
        catch (e) { console.warn('[CineVideo] video load failed, using live cinematic:', e); return false; }

        const video = document.createElement('video');
        video.id = 'cineVideo';
        video.src = blobUrl;
        video.playsInline = true;
        video.volume = o.volume;
        video.style.cssText =
            'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;' +
            'background:#000;z-index:10001;';
        document.body.appendChild(video);

        const host = document.createElement('div');
        host.id = 'cineVideoTextHost';
        host.style.cssText = 'position:fixed;inset:0;z-index:10001;pointer-events:none;';
        document.body.appendChild(host);
        const text = new window.CineText(host);

        const events = window.CineNames.schedule({
            windows: meta.nameWindows,
            intervalMs: o.config.text.displayIntervalMs,
            title: o.config.text.title,
            names: window.CineNames.namesFromGameState(o.gameState),
            vocalBeats: o.vocalBeats
        });
        const speedAt = ms => window.CineTempo.computeTempo(o.tempoStems, ms, o.config.tempo);

        let idx = 0, rafId = null, finished = false;
        function loop() {
            const tMs = video.currentTime * 1000;
            while (idx < events.length && events[idx].at <= tMs) {
                window.CineNames.apply(text, events[idx++], speedAt);
            }
            rafId = requestAnimationFrame(loop);
        }

        function cleanup() {
            if (rafId !== null) cancelAnimationFrame(rafId);
            document.removeEventListener('keydown', onKey);
            video.pause();
            video.remove();
            host.remove();
            URL.revokeObjectURL(blobUrl);
        }
        function finish() {
            if (finished) return;
            finished = true;
            if (rafId !== null) cancelAnimationFrame(rafId);
            document.removeEventListener('keydown', onKey);
            video.pause();
            o.onDone(); // fades to black over the frozen last frame, then navigates
        }
        function onKey(e) {
            if (e.key === 's' || e.key === 'S' || e.key === 'Escape') finish();
        }

        if (!(await startPlayback(video))) {
            console.warn('[CineVideo] video would not play, using live cinematic');
            cleanup();
            return false;
        }

        video.addEventListener('ended', finish);
        video.addEventListener('error', () => {
            if (finished) return;
            finished = true;
            console.error('[CineVideo] playback error, switching to live cinematic');
            cleanup();
            o.onFailMidPlay();
        });
        document.addEventListener('keydown', onKey);
        rafId = requestAnimationFrame(loop);
        return true;
    }

    window.CineVideo = { tryStart };
})();
