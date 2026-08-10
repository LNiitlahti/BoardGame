/**
 * Coverage for reverting the newer board/effect-mutating spell action types
 * introduced with the Sarja2/Sarja3 physical card series:
 *   spell_tiles_placed          (extra_placement — Taikuuden nälkä, Katalyyttiavain, Jäljitys, Knowledge from the Deep)
 *   spell_tiles_repositioned    (reposition — Parempi reitti)
 *   spell_hearts_transferred    (first_heart_roll outcome 6 — Kaikki alkoi kivestä)
 *   spell_effect_charges_added  (addChargesToEffect — first_heart_roll outcome 3)
 * All four must be revertible through the standard "Undo Last Action" path,
 * same requirement that surfaced the pre-existing spell_board_effect gap.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeFakeFirebaseDB } = require('./_firestore-transaction-stub');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.document = global.document || { getElementById: () => null };

require('../../full/scripts/spell-engine.js');
require('../../full/scripts/undo-manager.js');
const SpellEngine = global.window.SpellEngine;
const UndoManager = global.window.UndoManager;

const spellsData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../data/spells.json'), 'utf8')
);
const byId = {};
spellsData.spells.forEach(s => { byId[s.id] = s; });

function makeGameState(overrides = {}) {
    return {
        spellDefinitions: byId,
        teams: [{ id: 1, name: 'Red' }, { id: 2, name: 'Blue' }, { id: 3, name: 'Green' }],
        board: {},
        heartHexControl: {},
        activeEffects: [],
        spellPiles: {},
        currentPhase: { roundNumber: 2 },
        ...overrides
    };
}

function makeSpellEngine(gs, extraDeps = {}) {
    const logged = [];
    const engine = new SpellEngine(gs, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        saveCallback: async () => {},
        logActionCallback: (...args) => logged.push(args),
        ...extraDeps
    });
    engine.__logged = logged;
    return engine;
}

function makeUndoManager(gs) {
    global.window.firebaseDB = makeFakeFirebaseDB(gs);
    return new UndoManager(gs, { saveCallback: async () => {}, logActionCallback: () => {} });
}

function entryFor(engine, actionType) {
    const [, , payload, previousState] = engine.__logged.find(([type]) => type === actionType);
    return { actionType, undone: false, payload, previousState };
}

// ------------------------------------------------------------------
// spell_tiles_placed (extra_placement)
// ------------------------------------------------------------------

test('undoing spell_tiles_placed removes the placed tiles and restores any destroyed ones', async () => {
    const gs = makeGameState({ board: { 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('sarja2-k5', 1, {
        holdingMountainHeart: true,
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });
    const entry = entryFor(engine, 'spell_tiles_placed');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    for (const coord of ['q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']) {
        assert.strictEqual(gs.board[coord], undefined, `${coord} placement reverted`);
    }
    assert.strictEqual(gs.board['q1r0'], 2, 'destroyed tile restored to its original owner');
});

test('undoing spell_tiles_placed returns a discarded card back to hand', async () => {
    const gs = makeGameState({
        spellPiles: { 1: { hand: ['sarja1-k4'], drawPile: [], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('sarja2-k4', 1, { coords: ['q3r3', 'q4r4'], discardSpellId: 'sarja1-k4' });
    const entry = entryFor(engine, 'spell_tiles_placed');

    await undo.executeUndo(entry);

    assert.deepStrictEqual(gs.board, {});
    assert.deepStrictEqual(gs.spellPiles[1].hand, ['sarja1-k4']);
    assert.deepStrictEqual(gs.spellPiles[1].usedPile, []);
});

// ------------------------------------------------------------------
// spell_tiles_repositioned
// ------------------------------------------------------------------

test('undoing spell_tiles_repositioned moves tiles back to their original hex', async () => {
    const gs = makeGameState({ board: { 'q0r0': 1 }, heartHexControl: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('sarja3-k3', 1, { moves: [{ from: 'q0r0', to: 'q5r5' }] });
    const entry = entryFor(engine, 'spell_tiles_repositioned');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.board['q5r5'], undefined);
    assert.strictEqual(gs.board['q0r0'], 1);
    assert.strictEqual(gs.heartHexControl['q0r0'], 1, 'heart control restored at the original hex');
});

// ------------------------------------------------------------------
// spell_hearts_transferred
// ------------------------------------------------------------------

test('undoing spell_hearts_transferred restores each heart to its previous owner', async () => {
    const gs = makeGameState({ heartHexControl: { 'q9r9': 3 } });
    const boardManager = { getHexType: () => 'side-heart' };
    const engine = makeSpellEngine(gs, { boardManager });
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('sarja3-k6', 1, { roll: 6 });
    const entry = entryFor(engine, 'spell_hearts_transferred');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.heartHexControl['q9r9'], 3);
});

// ------------------------------------------------------------------
// spell_effect_charges_added
// ------------------------------------------------------------------

test('undoing spell_effect_charges_added restores usesRemaining to its pre-boost value', async () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    const cast = engine.executeSpellEffect('sarja3-k4', 1, {});
    engine.addChargesToEffect(cast.effectId, 1);
    assert.strictEqual(gs.activeEffects[0].usesRemaining, 2);

    const entry = entryFor(engine, 'spell_effect_charges_added');
    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.activeEffects[0].usesRemaining, 1);
});

// ------------------------------------------------------------------
// spell_cards_taken (conditional_card_grab / sarja4-k5)
// ------------------------------------------------------------------

test('undoing spell_cards_taken returns each card to its original team\'s source pile', async () => {
    const gs = makeGameState({
        spellPiles: {
            1: { hand: [], drawPile: [], usedPile: [] },
            2: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('sarja4-k5', 1, {
        succeeded: true,
        picks: [{ teamId: 2, spellId: 'sarja1-k1', source: 'hand' }]
    });
    assert.deepStrictEqual(gs.spellPiles[1].hand, ['sarja1-k1']);

    const entry = entryFor(engine, 'spell_cards_taken');
    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(gs.spellPiles[1].hand, []);
    assert.deepStrictEqual(gs.spellPiles[2].hand, ['sarja1-k1']);
});

// ------------------------------------------------------------------
// spell_forced_redraw (force_redraw / sarja6-k4)
// ------------------------------------------------------------------

test('undoing spell_forced_redraw restores the target team\'s pile to its exact pre-shuffle snapshot', async () => {
    const gs = makeGameState({
        spellPiles: { 2: { hand: ['sarja1-k1'], drawPile: ['a', 'b'], usedPile: ['c'] } }
    });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('sarja6-k4', 1, { teamId: 2, spellId: 'sarja1-k1' });
    const entry = entryFor(engine, 'spell_forced_redraw');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(gs.spellPiles[2].hand, ['sarja1-k1']);
    assert.deepStrictEqual(gs.spellPiles[2].drawPile, ['a', 'b']);
    assert.deepStrictEqual(gs.spellPiles[2].usedPile, ['c']);
});

// ------------------------------------------------------------------
// spell_tiles_captured (temporary_capture / named-luttinen)
// ------------------------------------------------------------------

test('undoing spell_tiles_captured restores each tile to its previous owner', async () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2, 'q1r-1': 2 } });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('named-luttinen', 1, { coords: ['q1r0', 'q1r-1'] });
    const entry = entryFor(engine, 'spell_tiles_captured');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.board['q1r0'], 2);
    assert.strictEqual(gs.board['q1r-1'], 2);
});

// ------------------------------------------------------------------
// spell_marked_tiles_relocated (marked_relocation_charge / named-jussi)
// ------------------------------------------------------------------

test('undoing spell_marked_tiles_relocated moves the tile back and restores anything destroyed on landing', async () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    const cast = engine.executeSpellEffect('named-jussi', 1, {});
    engine.markTileForRelocation(cast.effectId, 'q0r0');
    engine.resolveMarkedRelocation(cast.effectId, [{ from: 'q0r0', to: 'q1r0' }]);
    const entry = entryFor(engine, 'spell_marked_tiles_relocated');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.strictEqual(gs.board['q0r0'], 1);
    assert.strictEqual(gs.board['q1r0'], 2);
});

// ------------------------------------------------------------------
// spell_blind_swap (blind_card_swap / named-teemu)
// ------------------------------------------------------------------

test('undoing spell_blind_swap restores both swapped cards to their original hand slots', async () => {
    const gs = makeGameState({
        spellPiles: {
            1: { hand: ['sarja1-k4'], drawPile: [], usedPile: [] },
            2: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] },
            3: { hand: ['sarja2-k1'], drawPile: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);
    const undo = makeUndoManager(gs);

    engine.executeSpellEffect('named-teemu', 1, {
        teamAId: 2, teamBId: 3, casterSpellId: 'sarja1-k4', casterSwapTeamId: 2
    });
    const entry = entryFor(engine, 'spell_blind_swap');

    const ok = await undo.executeUndo(entry);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(gs.spellPiles[1].hand, ['sarja1-k4']);
    assert.deepStrictEqual(gs.spellPiles[2].hand, ['sarja1-k1']);
    assert.deepStrictEqual(gs.spellPiles[3].hand, ['sarja2-k1']);
});
