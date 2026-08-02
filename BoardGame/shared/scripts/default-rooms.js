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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadDefaultRoomsDoc, saveDefaultRoomsDoc };
}
