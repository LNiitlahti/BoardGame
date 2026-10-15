/**
 * Board Layouts - registry of the supported gameboard versions.
 *
 * Version 1 ("Legacy"): 91 hexes, radius 5.
 * Version 2:            169 hexes, radius 7 (default for new tournaments).
 *
 * A tournament doc stores `boardVersion`. A MISSING field means Legacy:
 * archived tournaments are write-blocked and are never migrated, so old
 * docs simply don't have it. This file is the only place that knows what
 * each version looks like; board-module.js, board-renderer.js and the
 * pages read from it instead of hardcoding a radius.
 *
 * Rules shared by every version:
 *   - starting locations: the six corners of the outermost ring
 *   - mountain heart:     the centre, q0r0
 *   - side hearts:        the midpoints of the sides of the
 *                         second-outermost ring (radius - 1)
 *
 * Dual-export (window.BoardLayouts / module.exports) like board-module.js.
 */
(function (root) {
    'use strict';

    const LEGACY_VERSION = 1;
    const DEFAULT_VERSION = 2; // what setup pre-selects for NEW tournaments

    // shared/images/hexes/coords/ holds sliced tiles for radius 5 only.
    // Hexes beyond it (Version 2's outer two rings) get a placeholder
    // style until real art is added.
    const ART_RADIUS = 5;

    const PLACEHOLDER_BACKGROUND = 'linear-gradient(135deg, #4a5166 0%, #2c3140 100%)';

    function ringOf(q, r) {
        return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    }

    // The six corners of the ring at `radius`, in the order the game has
    // always listed them (top, top-right, bottom-right, bottom, ...).
    function cornersOf(radius) {
        const R = radius;
        return [`q0r-${R}`, `q${R}r-${R}`, `q${R}r0`, `q0r${R}`, `q-${R}r${R}`, `q-${R}r0`];
    }

    // Midpoints of the six sides of ring (radius - 1). Needs an even ring
    // number so the midpoint lands on a whole hex (4 for Legacy, 6 for v2).
    function sideHeartsOf(radius) {
        const k = radius - 1;
        if (k % 2 !== 0) {
            throw new Error(`[BoardLayouts] radius ${radius}: ring ${k} has no side midpoints on whole hexes`);
        }
        const h = k / 2;
        return [`q${-k}r${h}`, `q${-h}r${-h}`, `q${h}r${-k}`, `q${k}r${-h}`, `q${h}r${h}`, `q${-h}r${k}`];
    }

    function makeLayout(spec) {
        return Object.freeze({
            version: spec.version,
            name: spec.name,
            radius: spec.radius,
            hexCount: 3 * spec.radius * (spec.radius + 1) + 1,
            // Half the native (unscaled) board box in px. Hex size in px is
            // the same for every version, so a bigger board needs a bigger box.
            nativeHalf: spec.nativeHalf,
            startingLocations: Object.freeze(cornersOf(spec.radius)),
            mountainHeartLocation: 'q0r0',
            sideHeartLocations: Object.freeze(sideHeartsOf(spec.radius)),
            artRadius: ART_RADIUS,
            // config/defaultRooms (Firestore) and LOCAL_DEFAULT_ROOMS are
            // Legacy coordinates. Version 2 must never read or write them.
            usesSharedDefaultRooms: spec.usesSharedDefaultRooms
        });
    }

    const LEGACY = makeLayout({
        version: 1, name: 'legacy', radius: 5, nativeHalf: 375, usesSharedDefaultRooms: true
    });
    const V2 = makeLayout({
        version: 2, name: 'v2', radius: 7, nativeHalf: 500, usesSharedDefaultRooms: false
    });
    const LAYOUTS = { 1: LEGACY, 2: V2 };

    /** Layout for a version number/string. Unknown, missing or garbage -> Legacy. */
    function get(version) {
        return LAYOUTS[Number(version)] || LEGACY;
    }

    /** Layout for a tournament doc. No boardVersion field -> Legacy. */
    function forTournament(tournamentDoc) {
        return get(tournamentDoc && tournamentDoc.boardVersion);
    }

    /** All [q, r] pairs of the layout, q ascending then r ascending. */
    function coordinates(layout) {
        const R = layout.radius;
        const coords = [];
        for (let q = -R; q <= R; q++) {
            const r1 = Math.max(-R, -q - R);
            const r2 = Math.min(R, -q + R);
            for (let r = r1; r <= r2; r++) {
                coords.push([q, r]);
            }
        }
        return coords;
    }

    function isValid(layout, q, r) {
        const R = layout.radius;
        return Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R;
    }

    /** True when shared/images/hexes/coords/<coord>.png exists for this hex. */
    function hasArt(layout, coord) {
        const m = /^q(-?\d+)r(-?\d+)$/.exec(coord);
        if (!m) return false;
        return ringOf(parseInt(m[1], 10), parseInt(m[2], 10)) <= layout.artRadius;
    }

    /**
     * CSS for the per-hex terrain art, scoped to body.effect-hex-images.
     * Hexes with art get their tile image; hexes without get a flat
     * placeholder, so no request is ever made for a file that doesn't exist.
     * @param {Object} layout
     * @param {string} base - site base path, normally window.BOARDGAME_BASE || '.'
     */
    function hexImagesCss(layout, base) {
        return coordinates(layout).map(([q, r]) => {
            const coord = `q${q}r${r}`;
            const background = hasArt(layout, coord)
                ? `background-image: url('${base}/shared/images/hexes/coords/${coord}.png');`
                : `background-image: ${PLACEHOLDER_BACKGROUND};`;
            return `body.effect-hex-images .board-hex[data-coord="${coord}"]::before {\n    ${background}\n}`;
        }).join('\n');
    }

    /**
     * Point a page's existing BoardModule/BoardRenderer at the tournament's
     * layout. Safe to call on every render: it does nothing when the layout
     * already matches. Switches the module IN PLACE (other modules hold a
     * reference to it), re-sizes the renderer, and rewrites the hex-image
     * stylesheet if the page already created one.
     * @returns {boolean} true when the layout changed (caller should re-render
     *   and drop any "board unchanged" render cache)
     */
    function sync(boardModule, boardRenderer, tournamentDoc) {
        if (!boardModule) return false;
        const layout = forTournament(tournamentDoc);
        if (boardModule.layout === layout) return false;

        boardModule.setLayout(layout);
        if (boardRenderer && typeof boardRenderer.refreshLayout === 'function') {
            boardRenderer.refreshLayout();
        }
        if (typeof document !== 'undefined') {
            const styleEl = document.getElementById('hex-images-dynamic-css');
            if (styleEl) {
                styleEl.textContent = hexImagesCss(layout, (root && root.BOARDGAME_BASE) || '.');
            }
        }
        return true;
    }

    const api = {
        LEGACY_VERSION,
        DEFAULT_VERSION,
        get,
        forTournament,
        coordinates,
        isValid,
        ringOf,
        hasArt,
        hexImagesCss,
        sync
    };

    if (typeof window !== 'undefined') {
        window.BoardLayouts = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : undefined);
