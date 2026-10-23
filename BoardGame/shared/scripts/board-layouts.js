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
 * Tile art: shared/images/hexes/coords/ holds one tile per hex of the
 * radius-5 board. Until real art exists for a bigger board, its outer rings
 * MIRROR the inner tiles (each side of the radius-5 hexagon acts as a
 * mirror, see mirrorIntoArt). Raising `artRadius` to the board radius and
 * adding the files makes the mirroring stop automatically. The art of the
 * Legacy side-heart hexes moves to the Version 2 side hearts; see artSwaps.
 *
 * Dual-export (window.BoardLayouts / module.exports) like board-module.js.
 */
(function (root) {
    'use strict';

    const LEGACY_VERSION = 1;
    const DEFAULT_VERSION = 2; // what setup pre-selects for NEW tournaments

    // shared/images/hexes/coords/ holds sliced tiles for radius 5 only.
    // Hexes beyond it (Version 2's outer two rings) reuse them by mirroring.
    const ART_RADIUS = 5;

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

    // Cube-coordinate reflection of an outer hex back into the art area.
    // Returns the coord string of the tile whose art the hex displays.
    function mirrorIntoArt(layout, coord) {
        const m = /^q(-?\d+)r(-?\d+)$/.exec(coord);
        if (!m) return null;
        const A = layout.artRadius;
        let x = [parseInt(m[1], 10), parseInt(m[2], 10)];
        x.push(-x[0] - x[1]);
        for (let guard = 0; guard < 8 && Math.max(Math.abs(x[0]), Math.abs(x[1]), Math.abs(x[2])) > A; guard++) {
            let i = 0;
            for (let k = 1; k < 3; k++) if (Math.abs(x[k]) > Math.abs(x[i])) i = k;
            const c0 = Math.sign(x[i]) * A;
            const d = x[i] - c0;
            x = x.map((v, k) => (k === i ? 2 * c0 - v : v + d));
        }
        return `q${x[0]}r${x[1]}`;
    }

    // Which tile file a hex displays: its own (ring <= artRadius, except
    // spots listed in artSwaps), otherwise its mirror source.
    function artCoordFor(layout, coord) {
        const m = /^q(-?\d+)r(-?\d+)$/.exec(coord);
        if (!m) return null;
        if (ringOf(parseInt(m[1], 10), parseInt(m[2], 10)) <= layout.artRadius) {
            return (layout.artSwaps && layout.artSwaps[coord]) || coord;
        }
        return mirrorIntoArt(layout, coord);
    }

    const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

    // The Legacy side-heart tiles move to the Version 2 side hearts (they are
    // reached by mirroring), so the old heart spots need another tile. This
    // is a deliberate, easily changed choice: each old heart spot shows the
    // tile of its inward neighbour (smallest ring, ties -> first direction).
    function computeArtSwaps(legacyHearts) {
        const swaps = {};
        for (const h of legacyHearts) {
            const m = /^q(-?\d+)r(-?\d+)$/.exec(h);
            const q = parseInt(m[1], 10), r = parseInt(m[2], 10);
            let best = null, bestRing = Infinity;
            for (const [dq, dr] of DIRS) {
                const ring = ringOf(q + dq, r + dr);
                if (ring < bestRing) { bestRing = ring; best = `q${q + dq}r${r + dr}`; }
            }
            swaps[h] = best;
        }
        return Object.freeze(swaps);
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
            artSwaps: spec.artSwaps || Object.freeze({}),
            // Firestore doc id under config/ holding this board's default
            // rooms. One doc per board version: coordinates of one board are
            // not valid on the other, so they must never share a doc.
            defaultRoomsDocId: spec.defaultRoomsDocId
        });
    }

    const LEGACY = makeLayout({
        version: 1, name: 'legacy', radius: 5, nativeHalf: 375, defaultRoomsDocId: 'defaultRooms'
    });
    const V2 = makeLayout({
        artSwaps: computeArtSwaps(LEGACY.sideHeartLocations),
        version: 2, name: 'v2', radius: 7, nativeHalf: 500, defaultRoomsDocId: 'defaultRoomsV2'
    });
    const LAYOUTS = { 1: LEGACY, 2: V2 };

    /** Layout for a version number/string. Unknown, missing or garbage -> Legacy. */
    function get(version) {
        if (version !== 1 && version !== 2 && version !== '1' && version !== '2') return LEGACY;
        return LAYOUTS[version] || LEGACY;
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

    /** True when this hex has its OWN tile file (shared/images/hexes/coords/<coord>.png). */
    function hasArt(layout, coord) {
        const m = /^q(-?\d+)r(-?\d+)$/.exec(coord);
        if (!m) return false;
        return ringOf(parseInt(m[1], 10), parseInt(m[2], 10)) <= layout.artRadius;
    }

    /**
     * CSS for the per-hex terrain art, scoped to body.effect-hex-images.
     * Every hex shows artCoordFor(): its own tile, or a mirrored/swapped one.
     * @param {Object} layout
     * @param {string} base - site base path, normally window.BOARDGAME_BASE || '.'
     */
    function hexImagesCss(layout, base) {
        return coordinates(layout).map(([q, r]) => {
            const coord = `q${q}r${r}`;
            const background = `background-image: url('${base}/shared/images/hexes/coords/${artCoordFor(layout, coord)}.png');`;
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
        if (typeof boardModule.setLayout !== 'function') return false;

        boardModule.setLayout(layout);
        // Pages may have run setRoomHexes() on the pre-switch (Legacy) module,
        // which drops Version 2 rooms that lie outside radius 5. Re-apply them
        // now that the module knows the real board.
        if (typeof boardModule.setRoomHexes === 'function' && tournamentDoc && Array.isArray(tournamentDoc.rooms)) {
            boardModule.setRoomHexes(tournamentDoc.rooms);
        }
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
        mirrorIntoArt,
        artCoordFor,
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
