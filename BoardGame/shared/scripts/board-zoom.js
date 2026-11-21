/**
 * board-zoom.js: pinch-zoom, pan and tap-a-hex for the board on phones.
 *
 *   BoardZoom.attach(boardRenderer, { onHexTap(hexEl) { ... } })
 *
 * Active only where BoardRenderer uses its compact (<= 900px) fit; desktop
 * and TV boards are untouched.
 *
 *   - two fingers: zoom (1x - 4x) around the fingers
 *   - one finger while zoomed: pan (at 1x it scrolls the page as normal)
 *   - double-tap: zoom in on that spot / back out (opts.doubleTap !== false;
 *     admin turns it off because its first tap would already act on a hex)
 *   - "Reset" button while zoomed
 *
 * A tap that ended a pan or pinch is swallowed (capture-phase click), so
 * admin hex placement (hex.onclick) only fires on a deliberate tap. A plain
 * tap on a hex calls onHexTap when given (team page info sheet).
 *
 * BoardZoom.showSheet(html) / hideSheet(): small bottom sheet for details.
 */
(function (root) {
    'use strict';

    const MIN = 1, MAX = 4, DOUBLE_TAP_SCALE = 2.5;
    const MOVE_SLOP = 8;          // px before a touch counts as a drag
    const DOUBLE_TAP_MS = 300;

    /** Keep the zoomed board covering its box: no panning off the edge. */
    function clampPan(scale, x, y, w, h) {
        const mx = Math.max(0, (scale - 1) * w / 2);
        const my = Math.max(0, (scale - 1) * h / 2);
        // "+ 0" turns -0 into 0
        return { x: Math.min(mx, Math.max(-mx, x)) + 0, y: Math.min(my, Math.max(-my, y)) + 0 };
    }

    /**
     * Zoom to newScale keeping the point (ax, ay) - screen px relative to
     * the board centre - under the finger.
     */
    function zoomAt(state, newScale, ax, ay, w, h) {
        const s = Math.min(MAX, Math.max(MIN, newScale));
        const k = s / state.scale;
        const x = ax - (ax - state.x) * k;
        const y = ay - (ay - state.y) * k;
        const p = s === 1 ? { x: 0, y: 0 } : clampPan(s, x, y, w, h);
        return { scale: s, x: p.x, y: p.y };
    }

    function attach(renderer, opts = {}) {
        const board = renderer.container;
        const wrapper = board.parentElement;
        if (!wrapper || wrapper.__boardZoom) return wrapper && wrapper.__boardZoom;

        let state = { scale: 1, x: 0, y: 0 };
        const pointers = new Map();
        let gesture = null;     // { kind: 'pan'|'pinch', ... }
        let moved = false, multi = false;
        let lastTap = { t: 0, x: 0, y: 0 };
        let swallowClick = false;
        let tapTimer = null;
        const doubleTap = opts.doubleTap !== false;

        // Positioning and touch-action come from mobile.css (<= 900px only),
        // so desktop layouts that position things against an outer box are untouched.
        wrapper.classList.add('board-zoom-host');

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'board-zoom-reset';
        resetBtn.textContent = 'Reset zoom';
        resetBtn.hidden = true;
        resetBtn.addEventListener('click', e => { e.stopPropagation(); apply({ scale: 1, x: 0, y: 0 }); });
        wrapper.appendChild(resetBtn);

        const drawn = () => renderer.compactDrawnSize();
        const active = () => !!drawn();

        function apply(next) {
            state = next;
            renderer.setUserZoom(state.scale, state.x, state.y);
            const zoomed = state.scale > 1;
            resetBtn.hidden = !zoomed;
            wrapper.classList.toggle('board-zoomed', zoomed);
        }

        /** Board centre on screen, ignoring transforms. */
        function centre() {
            const op = board.offsetParent || wrapper;
            const r = op.getBoundingClientRect();
            return {
                x: r.left + op.clientLeft + board.offsetLeft + board.offsetWidth / 2,
                y: r.top + op.clientTop + board.offsetTop + board.offsetHeight / 2,
            };
        }

        function rel(x, y) { const c = centre(); return { x: x - c.x, y: y - c.y }; }

        function onDown(e) {
            if (e.pointerType === 'mouse' || !active()) return;
            if (e.target === resetBtn) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
            if (pointers.size === 1) { moved = false; multi = false; }
            if (pointers.size === 2) {
                multi = true;
                const [a, b] = [...pointers.values()];
                gesture = {
                    kind: 'pinch', start: { ...state },
                    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                    mid: rel((a.x + b.x) / 2, (a.y + b.y) / 2),
                };
            } else if (pointers.size === 1 && state.scale > 1) {
                gesture = { kind: 'pan', start: { ...state }, x0: e.clientX, y0: e.clientY };
            }
        }

        function onMove(e) {
            const p = pointers.get(e.pointerId);
            if (!p) return;
            p.x = e.clientX; p.y = e.clientY;
            if (Math.hypot(p.x - p.x0, p.y - p.y0) > MOVE_SLOP) moved = true;
            const d = drawn();
            if (!gesture || !d) return;
            if (gesture.kind === 'pinch' && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                const mid = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
                const z = zoomAt(gesture.start, gesture.start.scale * dist / gesture.dist,
                    gesture.mid.x, gesture.mid.y, d.width, d.height);
                // Follow the fingers' midpoint as it moves too
                const pan = z.scale === 1 ? { x: 0, y: 0 } : clampPan(z.scale,
                    z.x + mid.x - gesture.mid.x, z.y + mid.y - gesture.mid.y, d.width, d.height);
                apply({ scale: z.scale, x: pan.x, y: pan.y });
                e.preventDefault();
            } else if (gesture.kind === 'pan' && moved) {
                const pan = clampPan(state.scale, gesture.start.x + e.clientX - gesture.x0,
                    gesture.start.y + e.clientY - gesture.y0, d.width, d.height);
                apply({ scale: state.scale, x: pan.x, y: pan.y });
                e.preventDefault();
            }
        }

        function onUp(e) {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            if (e.type === 'pointercancel') { moved = true; }
            if (pointers.size === 1 && gesture && gesture.kind === 'pinch') {
                // One finger lifted: continue as a pan from here
                const [p] = [...pointers.values()];
                gesture = state.scale > 1 ? { kind: 'pan', start: { ...state }, x0: p.x, y0: p.y } : null;
                return;
            }
            if (pointers.size > 0) return;
            gesture = null;
            if (moved || multi) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 400); return; }

            // Double-tap: zoom in on the spot, or back out
            const now = Date.now();
            const d = drawn();
            if (doubleTap && d && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
                lastTap.t = 0;
                clearTimeout(tapTimer);
                swallowClick = true; setTimeout(() => { swallowClick = false; }, 400);
                if (state.scale > 1) apply({ scale: 1, x: 0, y: 0 });
                else { const a = rel(e.clientX, e.clientY); apply(zoomAt(state, DOUBLE_TAP_SCALE, a.x, a.y, d.width, d.height)); }
                return;
            }
            lastTap = { t: now, x: e.clientX, y: e.clientY };
        }

        // Capture phase: runs before hex.onclick
        wrapper.addEventListener('click', e => {
            if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; return; }
            if (!opts.onHexTap || !active()) return;
            const hex = e.target.closest && e.target.closest('.board-hex');
            if (!hex || !wrapper.contains(hex)) return;
            // Wait out a possible second tap (double-tap zooms instead)
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => opts.onHexTap(hex), doubleTap ? DOUBLE_TAP_MS : 0);
        }, true);

        wrapper.addEventListener('pointerdown', onDown);
        wrapper.addEventListener('pointermove', onMove, { passive: false });
        wrapper.addEventListener('pointerup', onUp);
        wrapper.addEventListener('pointercancel', onUp);
        // iOS Safari: stop its own page pinch while two fingers are on the board
        wrapper.addEventListener('touchmove', e => { if (e.touches.length > 1 && active()) e.preventDefault(); }, { passive: false });

        // Leaving the compact layout (rotate a tablet, resize): drop the zoom
        const mq = window.matchMedia('(max-width: 900px)');
        const onMq = () => apply({ scale: 1, x: 0, y: 0 });
        if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);

        apply(state);
        const api = { reset: () => apply({ scale: 1, x: 0, y: 0 }), get state() { return { ...state }; } };
        wrapper.__boardZoom = api;
        return api;
    }

    // ── Bottom sheet ──
    let sheet = null;
    function showSheet(html) {
        if (!sheet) {
            sheet = document.createElement('div');
            sheet.className = 'board-sheet';
            sheet.setAttribute('role', 'dialog');
            sheet.innerHTML = '<div class="board-sheet-panel"><button type="button" class="board-sheet-close" aria-label="Close">&times;</button><div class="board-sheet-body"></div></div>';
            sheet.addEventListener('click', e => {
                if (e.target === sheet || e.target.closest('.board-sheet-close')) hideSheet();
            });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') hideSheet(); });
            document.body.appendChild(sheet);
        }
        sheet.querySelector('.board-sheet-body').innerHTML = html;
        sheet.classList.add('open');
    }
    function hideSheet() { if (sheet) sheet.classList.remove('open'); }

    const BoardZoom = { attach, showSheet, hideSheet, clampPan, zoomAt, MIN, MAX };
    root.BoardZoom = BoardZoom;
    if (typeof module !== 'undefined' && module.exports) module.exports = BoardZoom;
})(typeof window !== 'undefined' ? window : globalThis);
