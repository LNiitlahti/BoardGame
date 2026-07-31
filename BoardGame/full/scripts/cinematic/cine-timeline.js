// DOM-free rAF timeline. Tracks: { at, duration, ease, onStart, onUpdate, onComplete }
// (times in ms, `at` absolute from timeline start). Browser use: play() with no
// argument + startRaf(); tests drive tick(now) manually.
// Contract: one instance = one playback. Calling play() again after tracks have
// already started/completed does NOT reset per-track _started/_completed state,
// so onStart/onComplete will not re-fire for tracks already visited — construct a
// fresh CineTimeline for a new playback rather than replaying an existing one.
class CineTimeline {
    constructor() {
        this.tracks = [];
        this.startTime = null;
        this.pausedAt = null;      // playback-time ms when paused
        this.isFinished = false;
        this.onFinished = null;
        this.lastTickAt = null;
        this._rafId = null;
    }

    get duration() {
        return this.tracks.reduce((m, t) => Math.max(m, t.at + t.duration), 0);
    }

    add(track) {
        this.tracks.push({
            ease: p => p,
            onStart: null, onUpdate: null, onComplete: null,
            ...track,
            _started: false,
            _completed: false
        });
        return this;
    }

    play(now) {
        this.startTime = (now !== undefined ? now : performance.now());
        this.pausedAt = null;
        this.isFinished = false;
    }

    pause(now) {
        if (this.pausedAt !== null || this.startTime === null) return;
        this.pausedAt = (now !== undefined ? now : performance.now()) - this.startTime;
    }

    resume(now) {
        if (this.pausedAt === null) return;
        this.startTime = (now !== undefined ? now : performance.now()) - this.pausedAt;
        this.pausedAt = null;
    }

    tick(now) {
        if (this.startTime === null || this.pausedAt !== null || this.isFinished) return;
        this.lastTickAt = now;
        const t = now - this.startTime;

        for (const track of this.tracks) {
            if (track._completed || t < track.at) continue;
            if (!track._started) {
                track._started = true;
                if (track.onStart) track.onStart();
            }
            const raw = track.duration === 0 ? 1 : Math.min(1, (t - track.at) / track.duration);
            if (track.onUpdate) track.onUpdate(track.ease(raw));
            if (raw >= 1) {
                track._completed = true;
                if (track.onComplete) track.onComplete();
            }
        }

        if (t >= this.duration) this._finish();
    }

    skipToEnd() {
        for (const track of this.tracks) {
            if (!track._started) {
                track._started = true;
                if (track.onStart) track.onStart();
            }
            if (!track._completed) {
                if (track.onUpdate) track.onUpdate(track.ease(1));
                track._completed = true;
                if (track.onComplete) track.onComplete();
            }
        }
        this._finish();
    }

    _finish() {
        if (this.isFinished) return;
        this.isFinished = true;
        this.stopRaf();
        if (this.onFinished) this.onFinished();
    }

    startRaf() {
        const loop = (now) => {
            this.tick(now);
            if (!this.isFinished) this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }

    stopRaf() {
        if (this._rafId !== null) cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }
}

if (typeof window !== 'undefined') window.CineTimeline = CineTimeline;
if (typeof module !== 'undefined' && module.exports) module.exports = CineTimeline;
