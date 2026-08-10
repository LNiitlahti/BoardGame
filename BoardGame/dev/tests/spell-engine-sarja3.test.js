/**
 * Coverage for the Sarja3 physical spell-card series (see docs/SPELLS.md).
 *
 * Cards covered:
 *   sarja3-k1  Jäljitys                extra_placement w/ must_touch_opponent + precondition
 *   sarja3-k2  Tiedä vihollisesi       reminder (info demand, no digital hook)
 *   sarja3-k3  Parempi reitti          reposition (new: move up to 5 own tiles)
 *   sarja3-k4  Taitava vastaisku       counter (multi-use, linked to 3.6 outcome 3)
 *   sarja3-k5  Kysy yrteiltä           reveal_hands (new: one-time hand snapshot)
 *   sarja3-k6  Kaikki alkoi kivestä    first_heart_roll (new: d6 table, 2 of 6 outcomes automated)
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
        teams: [{ id: 1, name: 'Red', points: 5 }, { id: 2, name: 'Blue', points: 3 }],
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

test('all 6 Sarja3 cards exist in spells.json', () => {
    for (const id of ['sarja3-k1', 'sarja3-k2', 'sarja3-k3', 'sarja3-k4', 'sarja3-k5', 'sarja3-k6']) {
        assert.ok(byId[id], `${id} should exist`);
    }
});

// ------------------------------------------------------------------
// sarja3-k1 — Jäljitys
// ------------------------------------------------------------------

test('Jäljitys refuses to resolve when the caster has no tile touching an opponent yet', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k1', 1, { coords: ['q9r9', 'q9r8'] });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /touch an opponent/);
});

test('Jäljitys places tiles only adjacent to the target opponent, once the touching precondition is met', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } }); // caster touches team 2
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k1', 1, {
        coords: ['q1r-1', 'q9r9'] // q1r-1 touches q1r0 (opponent); q9r9 touches nothing
    });

    assert.deepStrictEqual(result.placed, ['q1r-1']);
    assert.strictEqual(result.rejected.length, 1);
    assert.strictEqual(result.rejected[0].coord, 'q9r9');
});

// ------------------------------------------------------------------
// sarja3-k2 — Tiedä vihollisesi (reminder)
// ------------------------------------------------------------------

test('Tiedä vihollisesi is an informational reminder with no board mutation', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja3-k2', 1, { targetTeamId: 2 });

    assert.strictEqual(gs.activeEffects.length, 1);
    assert.deepStrictEqual(gs.board, { 'q0r0': 1 });
});

// ------------------------------------------------------------------
// sarja3-k3 — Parempi reitti (reposition)
// ------------------------------------------------------------------

test('Parempi reitti moves owned tiles to new empty hexes', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k3', 1, {
        moves: [{ from: 'q0r0', to: 'q5r5' }, { from: 'q1r0', to: 'q6r6' }]
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.applied.length, 2);
    assert.strictEqual(gs.board['q0r0'], undefined);
    assert.strictEqual(gs.board['q1r0'], undefined);
    assert.strictEqual(gs.board['q5r5'], 1);
    assert.strictEqual(gs.board['q6r6'], 1);
});

test('reposition rejects moving a tile you do not own', () => {
    const gs = makeGameState({ board: { 'q0r0': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k3', 1, { moves: [{ from: 'q0r0', to: 'q5r5' }] });

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q0r0'], 2);
});

test('reposition rejects moving onto an occupied destination', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q5r5': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k3', 1, { moves: [{ from: 'q0r0', to: 'q5r5' }] });

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q0r0'], 1, 'unmoved — source tile stays put on rejection');
    assert.strictEqual(gs.board['q5r5'], 2);
});

test('reposition caps at 5 moves even if more are supplied', () => {
    const board = { 'q0r0': 1 };
    for (let i = 1; i <= 6; i++) board[`q${i}r0`] = 1;
    const gs = makeGameState({ board });
    const engine = makeSpellEngine(gs);

    const moves = [1, 2, 3, 4, 5, 6].map(i => ({ from: `q${i}r0`, to: `q${i}r9` }));
    const result = engine.executeSpellEffect('sarja3-k3', 1, { moves });

    assert.strictEqual(result.applied.length, 5);
    assert.strictEqual(gs.board['q6r0'], 1, '6th move was never attempted');
});

test('reposition vacates heart control at the source hex', () => {
    const gs = makeGameState({
        board: { 'q0r0': 1 },
        heartHexControl: { 'q0r0': 1 }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja3-k3', 1, { moves: [{ from: 'q0r0', to: 'q5r5' }] });

    assert.strictEqual(gs.heartHexControl['q0r0'], undefined);
});

// ------------------------------------------------------------------
// sarja3-k4 — Taitava vastaisku (counter, multi-use)
// ------------------------------------------------------------------

test('Taitava vastaisku starts with 1 use tracked on its active effect', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k4', 1, {});

    assert.strictEqual(result.usesRemaining, 1);
    assert.strictEqual(gs.activeEffects[0].usesRemaining, 1);
    assert.strictEqual(gs.activeEffects[0].category, 'reactive');
});

test('addChargesToEffect boosts an active counter effect\'s uses', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('sarja3-k4', 1, {});

    const result = engine.addChargesToEffect(cast.effectId, 1);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.usesRemaining, 2);
});

test('addChargesToEffect fails cleanly for an unknown or expired effect', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.addChargesToEffect('does-not-exist', 1).success, false);

    const cast = engine.executeSpellEffect('sarja3-k4', 1, {});
    gs.activeEffects[0].isExpired = true;
    assert.strictEqual(engine.addChargesToEffect(cast.effectId, 1).success, false);
});

// ------------------------------------------------------------------
// sarja3-k5 — Kysy yrteiltä (reveal_hands)
// ------------------------------------------------------------------

test('Kysy yrteiltä snapshots every team\'s current hand onto the active effect', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] },
            2: { hand: ['sarja1-k2', 'sarja1-k4'], drawPile: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k5', 1, {});

    assert.deepStrictEqual(result.revealed, { '1': ['sarja1-k1'], '2': ['sarja1-k2', 'sarja1-k4'] });
    assert.deepStrictEqual(gs.activeEffects[0].revealedData, result.revealed);
});

test('Kysy yrteiltä does not mutate the actual hands, only reads them', () => {
    const gs = makeGameState({
        spellPiles: { 1: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja3-k5', 1, {});

    assert.deepStrictEqual(gs.spellPiles[1].hand, ['sarja1-k1']);
});

// ------------------------------------------------------------------
// sarja3-k6 — Kaikki alkoi kivestä (first_heart_roll, d6 table)
// ------------------------------------------------------------------

test('roll 3 boosts an active Taitava vastaisku by 1 use', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    const vastaisku = engine.executeSpellEffect('sarja3-k4', 1, {});

    const result = engine.executeSpellEffect('sarja3-k6', 1, { roll: 3 });

    assert.strictEqual(result.roll, 3);
    assert.strictEqual(result.boostedEffectId, vastaisku.effectId);
    assert.strictEqual(result.usesRemaining, 2);
});

test('roll 3 with no active Taitava vastaisku notes there was nothing to boost, without crashing', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k6', 1, { roll: 3 });

    assert.strictEqual(result.roll, 3);
    assert.ok(result.note);
});

test('roll 6 transfers every side-heart (not the mountain heart) to the caster', () => {
    const gs = makeGameState({
        heartHexControl: { 'q0r0': 2, 'q9r9': 3 }
    });
    const boardManager = { getHexType: (q, r) => (q === 0 && r === 0 ? 'mountain-heart' : 'side-heart') };
    const engine = makeSpellEngine(gs, { boardManager });

    const result = engine.executeSpellEffect('sarja3-k6', 1, { roll: 6 });

    assert.strictEqual(result.roll, 6);
    assert.deepStrictEqual(result.transferred, [{ coord: 'q9r9', previousOwner: 3 }]);
    assert.strictEqual(gs.heartHexControl['q9r9'], 1);
    assert.strictEqual(gs.heartHexControl['q0r0'], 2, 'mountain heart is never transferred by this card');
});

test('roll 6 without a boardManager wired treats every heart as unknown type and transfers nothing (safe default)', () => {
    const gs = makeGameState({ heartHexControl: { 'q0r0': 2 } });
    const engine = makeSpellEngine(gs); // no boardManager

    const result = engine.executeSpellEffect('sarja3-k6', 1, { roll: 6 });

    assert.deepStrictEqual(result.transferred, []);
    assert.strictEqual(gs.heartHexControl['q0r0'], 2, 'left untouched when hex type cannot be confirmed');
});

test('rolls 1, 2, 4, 5 are tracked as a reminder buff without crashing or mutating board state', () => {
    for (const roll of [1, 2, 4, 5]) {
        const gs = makeGameState({ board: { 'q0r0': 1 } });
        const engine = makeSpellEngine(gs);
        const result = engine.executeSpellEffect('sarja3-k6', 1, { roll });

        assert.strictEqual(result.roll, roll);
        assert.deepStrictEqual(gs.board, { 'q0r0': 1 });
    }
});

test('without an explicit roll override, the engine actually rolls a d6 (1-6 inclusive)', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja3-k6', 1, {});

    assert.ok(Number.isInteger(result.roll) && result.roll >= 1 && result.roll <= 6, `roll was ${result.roll}`);
});
