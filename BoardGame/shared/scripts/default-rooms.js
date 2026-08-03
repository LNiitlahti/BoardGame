/**
 * ============================================================================
 * DEFAULT-ROOMS.JS - Shared Firestore config/defaultRooms read/write
 * ============================================================================
 *
 * "Load Default Rooms" / "Save as Default" (setup.html, god.html via
 * board-manager.js, admin.js) all read/write the SAME global Firestore doc:
 * config/defaultRooms, shaped as { rooms: string[], updatedAt: ISOString }.
 *
 * Previously each of those three files had its own copy of this get/set
 * logic (independently drifted over time). This file is the single shared
 * implementation - it only deduplicates the Firestore read/write, it does
 * NOT change the fact that config/defaultRooms is one doc shared across every
 * tournament (see TODO.md "Load Default Rooms" for that separate, deliberately
 * out-of-scope problem).
 *
 * Callers keep their own page-specific behavior around this (updating local
 * gameState, re-rendering the board, persisting to the tournament doc,
 * showing UI feedback) - this module is just the doc get/set.
 */

/**
 * @param {firebase.firestore.Firestore} db
 * @returns {Promise<string[]|null>} room hex coordinates (e.g. "q1r-2"), or
 *   null if no default has been saved yet (doc missing, or its rooms array
 *   is missing/empty).
 */
async function loadDefaultRoomsDoc(db) {
    const doc = await db.collection('config').doc('defaultRooms').get();
    if (!doc.exists || !doc.data().rooms?.length) {
        return null;
    }
    return [...doc.data().rooms];
}

/**
 * @param {firebase.firestore.Firestore} db
 * @param {string[]} rooms - room hex coordinates to save as the new default
 */
async function saveDefaultRoomsDoc(db, rooms) {
    await db.collection('config').doc('defaultRooms').set({
        rooms: [...rooms],
        updatedAt: new Date().toISOString()
    });
}

/**
 * LOCAL fallback room layout — lives in the codebase, not Firestore, so it
 * can't be silently overwritten by "Save as Default" on some other
 * (possibly throwaway/test) tournament the way config/defaultRooms can (see
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadDefaultRoomsDoc, saveDefaultRoomsDoc, LOCAL_DEFAULT_ROOMS };
}
