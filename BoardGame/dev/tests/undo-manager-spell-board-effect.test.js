/**
 * Coverage for reverting a destroy_adjacent spell effect (Get Away From Me,
 * Calculated Aggression, sarja1-k2, or any future card sharing that effect
 * shape) via the standard "Undo Last Action" path.
 *
 * Found while implementing the Sarja1 physical card series: _handleDestroyAdjacent
 * in spell-engine.js logs its board mutation as 'spell_board_effect', but that
 * action type was never added to undo-manager.js's UNDOABLE_TYPES — so the
 * board destruction those cards cause was silently un-revertible, breaking the
 * "every spell resolution must be reversible through the existing undo path"
 * requirement for the whole destroy_adjacent family, not just the new card.
 */
const test = require('node:test');
const assert = require('node:assert');
const { makeFakeFirebaseDB } = require('./_firestore-transaction-stub');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.document = global.document || { getElementById: () => null };

require('../../full/scripts/spell-engine.js');
require('../../full/scripts/undo-manager.js');
const SpellEngine = global.window.SpellEngine;
const UndoManager = global.window.UndoManager;

const GET_AWAY_DEF = {
    id: 'get-away', name: 'Irti minusta!', effect: { type: 'destroy_adjacent' }
};

function makeGameState(board, heartHexControl = {}) {
    return {
        spellDefinitions: { 'get-away': GET_AWAY_DEF },
        teams: [{ id: 1, name: 'Red' }, { id: 2, name: 'Blue' }],
        board,
        heartHexControl,
        activeEffects: []
    };
}

function makeSpellEngine(gs) {
    return new SpellEngine(gs, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        saveCallback: async () => {},
        logActionCallback: () => {}
    });
}

function makeUndoManager(gs) {
    global.window.firebaseDB = makeFakeFirebaseDB(gs);
    return new UndoManager(gs, { saveCallback: async () => {}, logActionCallback: () => {} });
}

test('spell_board_effect is now a recognized undoable action type', () => {
    const gs = makeGameState({ 'q0r0': 1, 'q1r0': 2 });
    const undo = makeUndoManager(gs);

    const entry = {
        actionType: 'spell_board_effect',
        undone: false,
        payload: { spellId: 'get-away', castByTeamId: 1, destroyedTiles: [{ coord: 'q1r0', teamId: 2, wasHeart: false }] },
        previousState: { destroyedTiles: [{ coord: 'q1r0', teamId: 2, wasHeart: false }] }
    };

    const { canUndo, reason } = undo.canUndo(entry);
    assert.strictEqual(canUndo, true, reason);
});

test('executeUndo restores a destroyed non-heart tile to its original owner', async () => {
    const gs = makeGameState({ 'q0r0': 1, 'q1r0': 2 });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    const result = engine.executeSpellEffect('get-away', 1, {});
    assert.deepStrictEqual(result.destroyed, [{ coord: 'q1r0', teamId: 2, wasHeart: false }]);
    assert.strictEqual(gs.board['q1r0'], undefined, 'tile is destroyed');

    const entry = {
        actionType: 'spell_board_effect',
        undone: false,
        payload: { spellId: 'get-away', castByTeamId: 1, destroyedTiles: result.destroyed },
        previousState: { destroyedTiles: result.destroyed }
    };
    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.board['q1r0'], 2, 'destroyed tile is restored to its original owner');
});

test('executeUndo restores heart control when the destroyed tile was a heart hex', async () => {
    const gs = makeGameState(
        { 'q0r0': 1, 'q1r0': 2 },
        { 'q1r0': 2 }
    );
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    const result = engine.executeSpellEffect('get-away', 1, {});
    assert.strictEqual(result.destroyed[0].wasHeart, true);
    assert.strictEqual(gs.heartHexControl['q1r0'], undefined, 'heart control cleared on destroy');

    const entry = {
        actionType: 'spell_board_effect',
        undone: false,
        payload: {},
        previousState: { destroyedTiles: result.destroyed }
    };
    await undo.executeUndo(entry);

    assert.strictEqual(gs.board['q1r0'], 2);
    assert.strictEqual(gs.heartHexControl['q1r0'], 2, 'heart control restored to its original owner');
});

test('undoing a multi-tile destroy_adjacent restores every tile', async () => {
    const gs = makeGameState({ 'q0r0': 1, 'q1r0': 2, 'q0r-1': 3, 'q5r5': 2 });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    const result = engine.executeSpellEffect('get-away', 1, {});
    assert.strictEqual(result.destroyed.length, 2, 'q1r0 and q0r-1 are adjacent to q0r0');

    const entry = {
        actionType: 'spell_board_effect', undone: false,
        payload: {}, previousState: { destroyedTiles: result.destroyed }
    };
    await undo.executeUndo(entry);

    assert.strictEqual(gs.board['q1r0'], 2);
    assert.strictEqual(gs.board['q0r-1'], 3);
    assert.strictEqual(gs.board['q5r5'], 2, 'tile that was never destroyed is untouched');
});

test('canUndo rejects a spell_board_effect entry that has already been undone', () => {
    const gs = makeGameState({});
    const undo = makeUndoManager(gs);
    const entry = {
        actionType: 'spell_board_effect', undone: true,
        previousState: { destroyedTiles: [{ coord: 'q1r0', teamId: 2, wasHeart: false }] }
    };
    assert.strictEqual(undo.canUndo(entry).canUndo, false);
});

test('an empty destroyedTiles list (no-op cast) undoes cleanly without touching the board', async () => {
    const gs = makeGameState({ 'q0r0': 1 });
    const undo = makeUndoManager(gs);
    const before = JSON.stringify(gs.board);

    const entry = {
        actionType: 'spell_board_effect', undone: false,
        payload: {}, previousState: { destroyedTiles: [] }
    };
    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(JSON.stringify(gs.board), before);
});
