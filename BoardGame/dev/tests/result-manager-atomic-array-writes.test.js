/**
 * Coverage for result-manager.js's (god.html's) atomic-write conversions of
 * pendingHexWins -- the parallel implementation to admin.js's, see
 * docs/superpowers/specs/2026-08-10-atomic-array-writes-design.md and
 * dev/tests/admin-atomic-array-writes.test.js for admin.html's side.
 */
const test = require('node:test');
const assert = require('node:assert');
const { makeFakeFirebaseDB } = require('./_firestore-transaction-stub');

function fakeElement() {
    return {
        textContent: '', className: '', innerHTML: '', style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, appendChild() {}, remove() {}, insertBefore() {}, prepend() {}, after() {},
        querySelector: () => null, querySelectorAll: () => []
    };
}

global.window = global.window || {};
global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    body: fakeElement()
};
require('../../shared/scripts/icon-svgs.js');
global.ICON_SVGS = global.window.ICON_SVGS;
global.iconSvg = global.window.iconSvg;

require('../../full/scripts/result-manager.js');
const ResultManager = global.window.ResultManager;

function makeGameState(overrides = {}) {
    return {
        tournamentId: 'tid-1',
        teams: [{ id: 1, name: 'Red' }, { id: 2, name: 'Blue' }],
        pendingHexWins: [],
        ...overrides
    };
}

function makeResultManager(gs) {
    global.window.firebaseDB = makeFakeFirebaseDB(gs);
    return new ResultManager(gs, {
        uiManager: { showStatus: () => {} },
        teamManager: { getTeamColor: () => '#c8b37e' },
        queueManager: null,
        boardManager: null,
        saveCallback: async () => {},
        logEventCallback: () => {},
        logActionCallback: () => {},
        onPhaseRequirementsChanged: () => {}
    });
}

test('clearPendingHexWin removes the oldest matching entry for a team via a transaction', async () => {
    const gs = makeGameState({
        pendingHexWins: [
            { matchNumber: 1, teamIds: [1, 2], teamNames: ['Red', 'Blue'] },
            { matchNumber: 2, teamIds: [1], teamNames: ['Red'] }
        ]
    });
    const rm = makeResultManager(gs);

    await rm.clearPendingHexWin(1);

    assert.deepStrictEqual(gs.pendingHexWins[0].teamIds, [2]);
    assert.deepStrictEqual(gs.pendingHexWins[1].teamIds, [1]);
});

test('clearPendingHexWin prunes an entry once its last team is removed', async () => {
    const gs = makeGameState({
        pendingHexWins: [{ matchNumber: 1, teamIds: [1], teamNames: ['Red'] }]
    });
    const rm = makeResultManager(gs);

    await rm.clearPendingHexWin(1);

    assert.strictEqual(gs.pendingHexWins.length, 0);
});

test('clearPendingHexWin is a no-op when the team has no pending win', async () => {
    const gs = makeGameState({
        pendingHexWins: [{ matchNumber: 1, teamIds: [2], teamNames: ['Blue'] }]
    });
    const rm = makeResultManager(gs);

    await rm.clearPendingHexWin(1);

    assert.strictEqual(gs.pendingHexWins.length, 1);
});

test('clearPendingHexWin does nothing without a tournamentId', async () => {
    const gs = makeGameState({ tournamentId: undefined, pendingHexWins: [{ matchNumber: 1, teamIds: [1], teamNames: ['Red'] }] });
    const rm = makeResultManager(gs);

    await rm.clearPendingHexWin(1);

    assert.strictEqual(gs.pendingHexWins.length, 1, 'unchanged -- no tournamentId to build a doc ref from');
});
