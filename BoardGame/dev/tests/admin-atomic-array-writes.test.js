/**
 * Coverage for admin.js's atomic-write conversions (pendingHexWins,
 * selectedGames, rooms) -- see
 * docs/superpowers/specs/2026-08-10-atomic-array-writes-design.md.
 *
 * admin.js has no module export surface and no prior unit-test coverage
 * anywhere in this codebase (everything else in it is verified via
 * Puppeteer/manual QA) -- window.__setAdminTestState and the extra
 * window.X exports at the bottom of admin.js exist purely so these tests
 * can reach clearPendingHexWin/toggleRoomHex/addCatalogGameToTournament/
 * removeGameFromTournament directly. A generic fake DOM element is used
 * for every document.getElementById() call, since several call paths
 * (showStatus in particular) assume a non-null element with no guard.
 */
const test = require('node:test');
const assert = require('node:assert');
const { makeFakeFirebaseDB } = require('./_firestore-transaction-stub');

function fakeElement() {
    return {
        textContent: '', className: '', innerHTML: '', style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, appendChild() {}, remove() {},
        querySelector: () => null, querySelectorAll: () => []
    };
}

global.window = global.window || {};
global.document = {
    getElementById: () => fakeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => fakeElement()
};
global.firebase = {
    firestore: {
        FieldValue: {
            arrayUnion: (v) => ({ __op: 'arrayUnion', value: v }),
            arrayRemove: (v) => ({ __op: 'arrayRemove', value: v }),
            serverTimestamp: () => ({ __op: 'serverTimestamp' })
        }
    }
};
global.GAMES_CONFIG = require('../../shared/scripts/games-config.js');

require('../../shared/scripts/icon-svgs.js');
global.ICON_SVGS = global.window.ICON_SVGS;
global.iconSvg = global.window.iconSvg;

require('../../full/scripts/action-logger.js');
// admin.js references ActionLogger as a bare identifier (not window.ActionLogger)
// -- action-logger.js only attaches it to our fake `window` object, so mirror
// it onto Node's actual global scope too.
global.ActionLogger = global.window.ActionLogger;
require('../../full/scripts/admin.js');
// admin.js defines pendingHexWins as an accessor on `window` so bare
// references inside its own functions resolve the same way a real browser's
// window-is-the-global-object would -- mirror the same accessor onto Node's
// actual global scope for the same reason ActionLogger/GAMES_CONFIG/iconSvg
// needed mirroring above.
Object.defineProperty(global, 'pendingHexWins', {
    configurable: true,
    get: () => global.window.pendingHexWins,
    set: (value) => { global.window.pendingHexWins = value; }
});
const clearPendingHexWin = global.window.clearPendingHexWin;
const toggleRoomHex = global.window.toggleRoomHex;
const addCatalogGameToTournament = global.window.addCatalogGameToTournament;
const removeGameFromTournament = global.window.removeGameFromTournament;
const setAdminTestState = global.window.__setAdminTestState;

function makeGameState(overrides = {}) {
    return {
        teams: [{ id: 1, name: 'Red' }, { id: 2, name: 'Blue' }],
        pendingHexWins: [],
        selectedGames: [],
        gameDefinitions: {},
        rooms: [],
        ...overrides
    };
}

function setupAdminState(gs, { boardModule } = {}) {
    setAdminTestState({
        gameState: gs,
        currentTournamentId: 'tid-1',
        boardModule: boardModule || { setRoomHexes: () => {} }
    });
    global.window.firebaseDB = makeFakeFirebaseDB(gs);
    return gs;
}

// ---------- clearPendingHexWin (transaction) ----------

test('clearPendingHexWin removes the oldest matching entry for a team via a transaction', async () => {
    const gs = makeGameState({
        pendingHexWins: [
            { matchNumber: 1, teamIds: [1, 2], teamNames: ['Red', 'Blue'] },
            { matchNumber: 2, teamIds: [1], teamNames: ['Red'] }
        ]
    });
    setupAdminState(gs);

    await clearPendingHexWin(1);

    // Removed from the FIRST (oldest) matching entry only.
    assert.deepStrictEqual(gs.pendingHexWins[0].teamIds, [2]);
    assert.deepStrictEqual(gs.pendingHexWins[1].teamIds, [1]);
    assert.strictEqual(gs.pendingHexWins.length, 2, 'second entry still has team 1, must not be pruned');
});

test('clearPendingHexWin prunes an entry once its last team is removed', async () => {
    const gs = makeGameState({
        pendingHexWins: [{ matchNumber: 1, teamIds: [1], teamNames: ['Red'] }]
    });
    setupAdminState(gs);

    await clearPendingHexWin(1);

    assert.strictEqual(gs.pendingHexWins.length, 0);
});

test('clearPendingHexWin is a no-op when the team has no pending win', async () => {
    const gs = makeGameState({
        pendingHexWins: [{ matchNumber: 1, teamIds: [2], teamNames: ['Blue'] }]
    });
    setupAdminState(gs);

    await clearPendingHexWin(1);

    assert.strictEqual(gs.pendingHexWins.length, 1);
    assert.deepStrictEqual(gs.pendingHexWins[0].teamIds, [2]);
});

// ---------- waivePendingHexWin (transaction) ----------

test('waivePendingHexWin removes a specific match+team entry via a transaction', async () => {
    const gs = makeGameState({
        pendingHexWins: [{ matchNumber: 5, teamIds: [1, 2], teamNames: ['Red', 'Blue'] }]
    });
    setupAdminState(gs);

    await window.waivePendingHexWin(5, 1);

    assert.deepStrictEqual(gs.pendingHexWins[0].teamIds, [2]);
});

// ---------- toggleRoomHex (arrayUnion/arrayRemove) ----------

test('toggleRoomHex adds a coord via arrayUnion and records the write shape', async () => {
    const gs = makeGameState();
    let capturedUpdate = null;
    setupAdminState(gs);
    global.window.firebaseDB = {
        collection: () => ({ doc: () => ({ update: (data) => { capturedUpdate = data; } }) })
    };

    await toggleRoomHex('q1r1');

    assert.deepStrictEqual(gs.rooms, ['q1r1'], 'local state updated for immediate render');
    assert.strictEqual(capturedUpdate.rooms.__op, 'arrayUnion');
    assert.strictEqual(capturedUpdate.rooms.value, 'q1r1');
});

test('toggleRoomHex removes an existing coord via arrayRemove', async () => {
    const gs = makeGameState({ rooms: ['q1r1', 'q2r2'] });
    let capturedUpdate = null;
    setupAdminState(gs);
    global.window.firebaseDB = {
        collection: () => ({ doc: () => ({ update: (data) => { capturedUpdate = data; } }) })
    };

    await toggleRoomHex('q1r1');

    assert.deepStrictEqual(gs.rooms, ['q2r2']);
    assert.strictEqual(capturedUpdate.rooms.__op, 'arrayRemove');
    assert.strictEqual(capturedUpdate.rooms.value, 'q1r1');
});

// ---------- selectedGames (arrayUnion/arrayRemove + dotted-path gameDefinitions) ----------

test('addCatalogGameToTournament adds via arrayUnion plus a dotted-path gameDefinitions write', async () => {
    const gs = makeGameState({ selectedGames: ['dota2'] });
    setupAdminState(gs);
    let capturedUpdate = null;
    const originalDb = global.window.firebaseDB;
    global.window.firebaseDB = {
        ...originalDb,
        collection: () => ({
            doc: () => ({
                update: (data) => { capturedUpdate = data; }
            })
        })
    };

    await addCatalogGameToTournament('cs2');

    assert.deepStrictEqual(gs.selectedGames, ['dota2', 'cs2']);
    assert.strictEqual(gs.gameDefinitions.cs2.name, 'Counter-Strike 2');
    assert.strictEqual(capturedUpdate.selectedGames.__op, 'arrayUnion');
    assert.strictEqual(capturedUpdate.selectedGames.value, 'cs2');
    assert.strictEqual(capturedUpdate['gameDefinitions.cs2'].name, 'Counter-Strike 2');
});

test('addCatalogGameToTournament refuses a duplicate without writing', async () => {
    const gs = makeGameState({ selectedGames: ['cs2'] });
    setupAdminState(gs);
    let updateCalled = false;
    global.window.firebaseDB = {
        collection: () => ({ doc: () => ({ update: () => { updateCalled = true; } }) })
    };

    await addCatalogGameToTournament('cs2');

    assert.strictEqual(updateCalled, false);
    assert.deepStrictEqual(gs.selectedGames, ['cs2']);
});

test('removeGameFromTournament removes via arrayRemove and keeps gameDefinitions', async () => {
    const gs = makeGameState({
        selectedGames: ['cs2', 'dota2'],
        gameDefinitions: { cs2: { name: 'Counter-Strike 2' } }
    });
    setupAdminState(gs);
    let capturedUpdate = null;
    global.window.firebaseDB = {
        collection: () => ({ doc: () => ({ update: (data) => { capturedUpdate = data; } }) })
    };

    await removeGameFromTournament('cs2');

    assert.deepStrictEqual(gs.selectedGames, ['dota2']);
    assert.ok(gs.gameDefinitions.cs2, 'gameDefinitions entry kept for historical matches display');
    assert.strictEqual(capturedUpdate.selectedGames.__op, 'arrayRemove');
    assert.strictEqual(capturedUpdate.selectedGames.value, 'cs2');
});
