/**
 * ============================================================================
 * DEFAULT-ROOMS.JS - Shared Firestore config/defaultRooms read/write
 * ============================================================================
 *
 * "Load Default Rooms" / "Save as Default" (setup.html, god.html via
 * board-manager.js, admin.js) all read/write the SAME global Firestore doc:
 * config/defaultRooms, shaped as
 * { rooms: string[], updatedAt: ISOString, updatedBy: string }.
 *
 * config/defaultRooms is deliberately ONE doc shared across every
 * tournament (not per-tournament) - that's a feature, not the bug: it's
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
 * Like loadDefaultRoomsDoc, but returns the full doc (including who/when it
 * was last saved) instead of just the rooms array. Callers use this to show
 * an admin what they're about to overwrite before calling saveDefaultRoomsDoc
 * - see setup.html's saveDefaultRoomsSetup() for the confirmation flow this
 * enables.
 *
 * @param {firebase.firestore.Firestore} db
 * @returns {Promise<{rooms: string[], updatedAt: string|null, updatedBy: string|null}|null>}
 *   null if no default has been saved yet (doc missing, or its rooms array
 *   is missing/empty).
 */
async function loadDefaultRoomsMeta(db) {
    const doc = await db.collection('config').doc('defaultRooms').get();
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
 */
async function saveDefaultRoomsDoc(db, rooms, updatedBy) {
    await db.collection('config').doc('defaultRooms').set({
        rooms: [...rooms],
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || 'unknown'
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
    module.exports = { loadDefaultRoomsDoc, loadDefaultRoomsMeta, saveDefaultRoomsDoc, LOCAL_DEFAULT_ROOMS };
}
