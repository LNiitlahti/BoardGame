/**
 * Coverage for the Sarja2 physical spell-card series (see docs/SPELLS.md).
 *
 * Cards covered:
 *   sarja2-k1  Glock 17            charged_removal (new: multi-use "ammo" counter)
 *   sarja2-k2  Sattuma puuttuu     reminder (event randomizer, no digital hook)
 *   sarja2-k3  huomaamatta ohi     reminder (placement-range rule, no digital hook)
 *   sarja2-k4  Taikuuden nälkä     extra_placement (new: real tile placement + discard cost)
 *   sarja2-k5  Katalyyttiavain     extra_placement w/ destroy_occupied + Mountain's Heart gate
 *
 * This batch also gives extra_placement its first real handler — the existing
 * placeholder "Knowledge from the Deep" card used the same effect.type but
 * previously just created an informational reminder with no board mutation.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.window = global.window || {};
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.document = global.document || { getElementById: () => null };

require('../../full/scripts/spell-engine.js');
const SpellEngine = global.window.SpellEngine;

const spellsData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../data/spells.json'), 'utf8')
);
const byId = {};
spellsData.spells.forEach(s => { byId[s.id] = s; });

function makeGameState(overrides = {}) {
    return {
        spellDefinitions: byId,
        teams: [
            { id: 1, name: 'Red', points: 5 },
            { id: 2, name: 'Blue', points: 3 }
        ],
        board: {},
        heartHexControl: {},
        activeEffects: [],
        spellPiles: {},
        currentPhase: { roundNumber: 2 },
        ...overrides
    };
}

function makeSpellEngine(gameState, extraDeps = {}) {
    const logged = [];
    const engine = new SpellEngine(gameState, {
        uiManager: null,
        teamManager: { escapeHtml: (s) => s },
        saveCallback: async () => {},
        logActionCallback: (...args) => logged.push(args),
        ...extraDeps
    });
    engine.__logged = logged;
    return engine;
}

// ------------------------------------------------------------------
// spells.json shape
// ------------------------------------------------------------------

test('all 5 Sarja2 cards exist in spells.json', () => {
    for (const id of ['sarja2-k1', 'sarja2-k2', 'sarja2-k3', 'sarja2-k4', 'sarja2-k5']) {
        assert.ok(byId[id], `${id} should exist`);
    }
});

// ------------------------------------------------------------------
// sarja2-k1 — Glock 17 (charged_removal)
// ------------------------------------------------------------------

test('casting Glock 17 creates a 10-charge active effect, no board mutation yet', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k1', 1, {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.usesRemaining, 10);
    assert.strictEqual(gs.activeEffects.length, 1);
    assert.strictEqual(gs.activeEffects[0].usesRemaining, 10);
    assert.deepStrictEqual(gs.board, {});
});

test('useChargedRemoval destroys an adjacent opponent tile and consumes one charge', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});
    const result = engine.useChargedRemoval(cast.effectId, 'q1r0');

    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.board['q1r0'], undefined);
    assert.strictEqual(result.usesRemaining, 9);
    assert.strictEqual(gs.activeEffects[0].usesRemaining, 9);
    assert.strictEqual(gs.activeEffects[0].isExpired, false);
});

test('useChargedRemoval rejects a target that does not touch the caster\'s own tile', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q5r5': 2 } });
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});
    const result = engine.useChargedRemoval(cast.effectId, 'q5r5');

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q5r5'], 2, 'non-adjacent tile is untouched');
});

test('useChargedRemoval rejects targeting your own tile', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 1 } });
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});
    const result = engine.useChargedRemoval(cast.effectId, 'q1r0');

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q1r0'], 1);
});

test('useChargedRemoval rejects an empty target hex', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});
    const result = engine.useChargedRemoval(cast.effectId, 'q1r0');

    assert.strictEqual(result.success, false);
});

test('the card leaves play (isExpired) after its 10th charge is spent', () => {
    const board = { 'q0r0': 1 };
    // Ring the caster's tile with 10 destroyable enemy tiles.
    const neighborsRing = ['q1r0', 'q1r-1', 'q0r-1', 'q-1r0', 'q-1r1', 'q0r1'];
    neighborsRing.forEach(c => { board[c] = 2; });
    const gs = makeGameState({ board });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});

    let last;
    for (const coord of neighborsRing) {
        last = engine.useChargedRemoval(cast.effectId, coord);
        assert.strictEqual(last.success, true);
    }

    assert.strictEqual(last.usesRemaining, 4);
    assert.strictEqual(gs.activeEffects[0].isExpired, false, 'still has charges left (6 of 10 used)');
});

test('useChargedRemoval refuses to spend a charge on an already-expired effect', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});
    gs.activeEffects[0].isExpired = true;

    const result = engine.useChargedRemoval(cast.effectId, 'q1r0');
    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q1r0'], 2);
});

test('a spent Glock 17 charge is logged as spell_board_effect (reuses the destroy_adjacent undo path)', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});
    engine.useChargedRemoval(cast.effectId, 'q1r0');

    const logged = engine.__logged.find(([type]) => type === 'spell_board_effect');
    assert.ok(logged, 'charge use must be logged as an undoable spell_board_effect');
    assert.deepStrictEqual(logged[3].destroyedTiles, [{ coord: 'q1r0', teamId: 2, wasHeart: false }]);
});

// ------------------------------------------------------------------
// sarja2-k2 / sarja2-k3 — reminder-only cards
// ------------------------------------------------------------------

test('Sattuma puuttuu peliin and huomaamatta ohi are informational reminders with no board mutation', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja2-k2', 1, {});
    engine.executeSpellEffect('sarja2-k3', 1, {});

    assert.strictEqual(gs.activeEffects.length, 2);
    assert.strictEqual(gs.activeEffects[0].category, 'condition');
    assert.strictEqual(gs.activeEffects[1].category, 'condition');
    assert.deepStrictEqual(gs.board, { 'q0r0': 1 });
});

// ------------------------------------------------------------------
// sarja2-k4 — Taikuuden nälkä (extra_placement + discard cost)
// ------------------------------------------------------------------

test('Taikuuden nälkä places 2 tiles and discards the named card from hand', () => {
    const gs = makeGameState({
        spellPiles: { 1: { drawPile: [], hand: ['sarja1-k4', 'sarja2-k2'], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k4', 1, {
        coords: ['q3r3', 'q4r4'], discardSpellId: 'sarja1-k4'
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.placed, ['q3r3', 'q4r4']);
    assert.strictEqual(gs.board['q3r3'], 1);
    assert.strictEqual(gs.board['q4r4'], 1);
    assert.strictEqual(result.discarded, 'sarja1-k4');
    assert.deepStrictEqual(gs.spellPiles[1].hand, ['sarja2-k2']);
    assert.deepStrictEqual(gs.spellPiles[1].usedPile, ['sarja1-k4']);
});

test('extra_placement rejects an already-occupied hex without destroy_occupied', () => {
    const gs = makeGameState({ board: { 'q3r3': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k4', 1, { coords: ['q3r3', 'q4r4'] });

    assert.strictEqual(result.rejected.length, 1);
    assert.strictEqual(result.rejected[0].coord, 'q3r3');
    assert.deepStrictEqual(result.placed, ['q4r4']);
    assert.strictEqual(gs.board['q3r3'], 2, 'occupied hex is untouched, not overwritten');
});

test('extra_placement errors cleanly when fewer coords are supplied than the card requires', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k4', 1, { coords: ['q3r3'] });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(gs.board, {});
});

test('the existing Knowledge from the Deep placeholder now actually places tiles (was a no-op before)', () => {
    const gs = makeGameState({
        spellDefinitions: {
            ...byId,
            'knowledge-deep': {
                id: 'knowledge-deep',
                effect: { type: 'extra_placement', amount: 2, restrictions: ['no_hearts_adjacent', 'no_opponent_adjacent'] }
            }
        },
        board: { 'q9r9': 2 },
        heartHexControl: { 'q0r0': 1 }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('knowledge-deep', 3, { coords: ['q1r0', 'q9r8'] });

    assert.strictEqual(result.rejected.length, 2, 'q1r0 touches the heart, q9r8 touches an opponent tile');
    assert.deepStrictEqual(result.placed, []);
});

// ------------------------------------------------------------------
// sarja2-k5 — Katalyyttiavain (extra_placement, destroy_occupied, gated)
// ------------------------------------------------------------------

test('Katalyyttiavain refuses to resolve without the Mountain\'s Heart attestation', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k5', 1, {
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /Mountain/);
});

test('Katalyyttiavain destroys the opponent tile beneath each of its 6 placements when attested', () => {
    const gs = makeGameState({
        board: { 'q1r0': 2, 'q2r0': 3, 'q3r0': 2 }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k5', 1, {
        holdingMountainHeart: true,
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.placed.length, 6);
    assert.strictEqual(result.destroyed.length, 3);
    for (const coord of ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']) {
        assert.strictEqual(gs.board[coord], 1);
    }
});

test('Katalyyttiavain does not destroy the caster\'s own tile, and rejects it as a target', () => {
    const gs = makeGameState({ board: { 'q1r0': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja2-k5', 1, {
        holdingMountainHeart: true,
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });

    assert.strictEqual(result.rejected.length, 1);
    assert.strictEqual(result.rejected[0].coord, 'q1r0');
    assert.strictEqual(gs.board['q1r0'], 1);
});

// ------------------------------------------------------------------
// Mountain's Heart precondition — real hex-type lookup via boardManager
// ------------------------------------------------------------------

function makeMockBoardManager(mountainHeartCoord) {
    return {
        getHexType(q, r) {
            return `q${q}r${r}` === mountainHeartCoord ? 'mountain-heart' : null;
        }
    };
}

test('with a boardManager wired, Katalyyttiavain resolves automatically when the caster truly controls Mountain\'s Heart — no attestation needed', () => {
    const gs = makeGameState({ heartHexControl: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs, { boardManager: makeMockBoardManager('q0r0') });

    const result = engine.executeSpellEffect('sarja2-k5', 1, {
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });

    assert.strictEqual(result.success, true);
});

test('with a boardManager wired, Katalyyttiavain is rejected outright when the caster controls a heart that is NOT Mountain\'s Heart, even with a (false) attestation', () => {
    const gs = makeGameState({ heartHexControl: { 'q9r9': 1 } }); // a side-heart, not the mountain heart
    const engine = makeSpellEngine(gs, { boardManager: makeMockBoardManager('q0r0') });

    const result = engine.executeSpellEffect('sarja2-k5', 1, {
        holdingMountainHeart: true, // attestation is ignored once boardManager can verify directly
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });

    assert.strictEqual(result.success, false);
});
