/**
 * ============================================================================
 * DEFAULT-ROOMS.JS - Shared Firestore default-rooms read/write
 * ============================================================================
 *
 * "Load Default Rooms" / "Save as Default" (setup.html, god.html via
 * board-manager.js, admin.js) read/write a global Firestore doc shaped as
 * { rooms: string[], updatedAt: ISOString, updatedBy: string }.
 *
 * There is one doc PER BOARD VERSION: config/defaultRooms for Legacy and
 * config/defaultRoomsV2 for Version 2 (BoardLayouts layout.defaultRoomsDocId).
 * They are separate because the coordinates of one board are not valid on the
 * other. Every function takes an optional docId that defaults to
 * 'defaultRooms' (Legacy), so callers that omit it behave as before.
 *
 * Each doc is deliberately ONE doc shared across every tournament of that
 * board version (not per-tournament) - that's a feature, not the bug: it's
 * what lets one curated layout seed every new tournament. The bug was that
 * "Save as Default" silently overwrote it with no visibility into what was
 * being replaced or who was replacing it, so a throwaway/test tournament
 * could clobber the real event's layout without anyone noticing. Fixed by:
 *   - updatedBy: records who/what made each save (e.g. a tournament id),
 *     set via saveDefaultRoomsDoc's optional third argument.
 *   - loadDefaultRoomsMeta(): lets a caller fetch the current default's
 *     rooms/updatedAt/updatedBy BEFORE overwriting it, so the UI can show
 *     "you are about to replace N rooms saved by X at Y" and require
 *     explicit confirmation (see setup.html's saveDefaultRoomsSetup()).
 * This is not multi-version history - only the latest save is kept - just
 * an end to *silent* overwrites.
 *
 * Previously each of those three files had its own copy of this get/set
 * logic (independently drifted over time). This file is the single shared
 * implementation - it only deduplicates the Firestore read/write; callers
 * keep their own page-specific behavior around this (updating local
 * gameState, re-rendering the board, persisting to the tournament doc,
 * showing UI feedback and confirmation) - this module is just the doc
 * get/set.
 */

/**
 * @param {firebase.firestore.Firestore} db
 * @param {string} [docId] - doc under config/ ('defaultRooms' = Legacy,
 *   'defaultRoomsV2' = Version 2)
 * @returns {Promise<string[]|null>} room hex coordinates (e.g. "q1r-2"), or
 *   null if no default has been saved yet (doc missing, or its rooms array
 *   is missing/empty).
 */
async function loadDefaultRoomsDoc(db, docId = 'defaultRooms') {
    const doc = await db.collection('config').doc(docId).get();
    if (!doc.exists || !doc.data().rooms?.length) {
        return null;
    }
    return [...doc.data().rooms];
}

/**
 * Like loadDefaultRoomsDoc, but returns the full doc (including who/when it
 * was last saved) instead of just the rooms array. Callers use this to show
 * an admin what they're about to overwrite before calling saveDefaultRoomsDoc
 * - see setup.html's saveDefaultRoomsSetup() for the confirmation flow this
 * enables.
 *
 * @param {firebase.firestore.Firestore} db
 * @param {string} [docId] - doc under config/, default 'defaultRooms'
 * @returns {Promise<{rooms: string[], updatedAt: string|null, updatedBy: string|null}|null>}
 *   null if no default has been saved yet (doc missing, or its rooms array
 *   is missing/empty).
 */
async function loadDefaultRoomsMeta(db, docId = 'defaultRooms') {
    const doc = await db.collection('config').doc(docId).get();
    if (!doc.exists || !doc.data().rooms?.length) {
        return null;
    }
    const data = doc.data();
    return {
        rooms: [...data.rooms],
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

/**
 * @param {firebase.firestore.Firestore} db
 * @param {string[]} rooms - room hex coordinates to save as the new default
 * @param {string} [updatedBy] - identifies who/what made this save (e.g. a
 *   tournament id), so the next admin can see who last overwrote the shared
 *   default before deciding to overwrite it again themselves. Additive field
 *   - existing readers that don't know about it are unaffected.
 * @param {string} [docId] - doc under config/, default 'defaultRooms'
 */
async function saveDefaultRoomsDoc(db, rooms, updatedBy, docId = 'defaultRooms') {
    await db.collection('config').doc(docId).set({
        rooms: [...rooms],
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || 'unknown'
    });
}

/**
 * LOCAL fallback room layout — lives in the codebase, not Firestore, so it
 * can't be silently overwritten by "Save as Default" on some other
 * (possibly throwaway/test) tournament the way the shared Firestore doc can (see
 * TODO.md "Load Default Rooms" for that shared-doc problem). Use this as
 * the known-good layout once curated; re-export via "Save as Default" if
 * you also want it available as the Firestore default for other tools that
 * read that doc (e.g. god.html's board-manager.js).
 *
 * Snapshot below was pulled from config/defaultRooms on 2026-08-03 via
 * `node BoardGame/dev/tests/e2e-inspect-default-rooms.js` — it may be
 * genuine event data or leftover test data from that session. VERIFY on
 * the board before the event and replace this array with the confirmed
 * layout (setup.html's "Load Local Default Rooms" button reads straight
 * from here — edit this array, no Firestore round-trip needed).
 */
const LOCAL_DEFAULT_ROOMS = [
    'q0r5', 'q1r3', 'q5r0', 'q5r-1', 'q3r0', 'q0r3', 'q-3r5', 'q-1r3',
    'q1r1', 'q2r0', 'q3r-2', 'q5r-3', 'q3r-3', 'q1r-2', 'q0r-2', 'q1r-4',
    'q-3r4', 'q-5r3', 'q-3r-2', 'q-4r1', 'q3r2', 'q-1r-3', 'q-2r-1', 'q-2r0'
];

/**
 * Version 2 (169-hex) local default rooms: 32 rooms, laid out by hand by the
 * owner on 2026-10-23 (orange hexes in the setup room editor). All are valid
 * Version 2 hexes and none sits on a heart, the centre or a starting corner
 * (dev/tests/default-rooms.test.js enforces that). setup.html's "Lataa
 * Paikallinen Oletus" button loads this list on a Version 2 board; the shared
 * Firestore default for that board is config/defaultRoomsV2.
 */
const LOCAL_DEFAULT_ROOMS_V2 = [
    'q-5r-2', 'q-1r-6', 'q-7r2', 'q-1r-4', 'q2r-7', 'q-2r-2', 'q-5r2', 'q-6r4',
    'q-4r2', 'q-3r1', 'q-1r-1', 'q1r-3', 'q4r-6', 'q-6r6', 'q-3r3', 'q2r-2',
    'q4r-4', 'q0r1', 'q2r-1', 'q-4r6', 'q-3r5', 'q-2r4', 'q0r2', 'q3r-1',
    'q5r-3', 'q7r-5', 'q4r0', 'q-2r7', 'q3r2', 'q5r0', 'q2r4', 'q4r3'
];

/** Copy of the local default rooms for a board layout (Legacy if unknown). */
function localDefaultRoomsFor(layout) {
    if (layout && layout.defaultRoomsDocId === 'defaultRoomsV2') {
        return [...LOCAL_DEFAULT_ROOMS_V2];
    }
    return [...LOCAL_DEFAULT_ROOMS];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadDefaultRoomsDoc, loadDefaultRoomsMeta, saveDefaultRoomsDoc,
        LOCAL_DEFAULT_ROOMS, LOCAL_DEFAULT_ROOMS_V2, localDefaultRoomsFor
    };
}
