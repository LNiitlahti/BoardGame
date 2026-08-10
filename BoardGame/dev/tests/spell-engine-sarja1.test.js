/**
 * Coverage for the Sarja1 physical spell-card series (see docs/SPELLS.md),
 * the first batch of the real 43-card deck digitized from Juha's printable
 * cards. Same require/helper pattern as spell-engine-rematch.test.js.
 *
 * Cards covered:
 *   sarja1-k1  Vuori Puhuu        replay_used_pile (new effect type)
 *   sarja1-k2  harkittu agressio  destroy_adjacent (existing handler, new card)
 *   sarja1-k3  Juho Puhuu         reminder (new effect type — informational only)
 *   sarja1-k4  Sabotaasia         ban (existing handler, new card)
 *   sarja1-k5  Kiven Muisti       modifier / double_draw (shares _checkDoubleDraw
 *                                 with the placeholder 'double-bid' card)
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

const sarja1Ids = ['sarja1-k1', 'sarja1-k2', 'sarja1-k3', 'sarja1-k4', 'sarja1-k5'];

// ------------------------------------------------------------------
// spells.json shape
// ------------------------------------------------------------------

test('all 5 Sarja1 cards exist in spells.json with unique ids', () => {
    for (const id of sarja1Ids) {
        assert.ok(byId[id], `${id} should exist`);
    }
    const allIds = spellsData.spells.map(s => s.id);
    assert.strictEqual(new Set(allIds).size, allIds.length, 'no duplicate spell ids');
});

test('sarja1-k1 (Vuori Puhuu) is a well-formed replay_used_pile entry', () => {
    const def = byId['sarja1-k1'];
    assert.strictEqual(def.name, 'Vuori Puhuu');
    assert.strictEqual(def.effect.type, 'replay_used_pile');
});

test('sarja1-k2 (harkittu agressio) reuses the destroy_adjacent effect shape', () => {
    const def = byId['sarja1-k2'];
    assert.strictEqual(def.effect.type, 'destroy_adjacent');
    assert.strictEqual(def.effect.trigger, 'on_placement');
});

test('sarja1-k3 (Juho Puhuu) is a well-formed reminder entry', () => {
    const def = byId['sarja1-k3'];
    assert.strictEqual(def.effect.type, 'reminder');
});

test('sarja1-k4 (Sabotaasia) reuses the ban effect shape', () => {
    const def = byId['sarja1-k4'];
    assert.strictEqual(def.effect.type, 'ban');
});

test('sarja1-k5 (Kiven Muisti) is a double_draw modifier, distinct id from double-bid', () => {
    const def = byId['sarja1-k5'];
    assert.strictEqual(def.effect.type, 'modifier');
    assert.strictEqual(def.effect.modifier, 'double_draw');
    assert.notStrictEqual(def.id, 'double-bid');
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeGameState(overrides = {}) {
    return {
        spellDefinitions: byId,
        teams: [
            { id: 1, name: 'Red', points: 5 },
            { id: 2, name: 'Blue', points: 3 },
            { id: 3, name: 'Green', points: 1 }
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
// sarja1-k2 — harkittu agressio (destroy_adjacent)
// ------------------------------------------------------------------

test('sarja1-k2 destroys adjacent opponent tiles on dispatch, same handler as calculated-aggression', () => {
    const gs = makeGameState({
        board: {
            'q0r0': 1,   // caster's tile
            'q1r0': 2,   // adjacent enemy — should be destroyed
            'q0r-1': 3,  // adjacent enemy — should be destroyed
            'q2r0': 2    // not adjacent to caster — survives
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k2', 1, {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.board['q1r0'], undefined);
    assert.strictEqual(gs.board['q0r-1'], undefined);
    assert.strictEqual(gs.board['q2r0'], 2, 'non-adjacent enemy tile is untouched');
    assert.strictEqual(gs.board['q0r0'], 1, "caster's own tile is untouched");
});

// ------------------------------------------------------------------
// sarja1-k4 — Sabotaasia (ban) — just needs to route to the existing
// generic condition-effect path, no board mutation.
// ------------------------------------------------------------------

test('sarja1-k4 creates a tracked ban condition effect, no board mutation', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k4', 1, {
        targetTeamId: 2, bannedElement: 'Sniper'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.activeEffects.length, 1);
    assert.strictEqual(gs.activeEffects[0].category, 'condition');
    assert.strictEqual(gs.activeEffects[0].spellId, 'sarja1-k4');
});

// ------------------------------------------------------------------
// sarja1-k3 — Juho Puhuu (reminder)
// ------------------------------------------------------------------

test('sarja1-k3 (reminder) creates a condition-category active effect with no board/point mutation', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k3', 1, { targetPlayerName: 'Aku' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.activeEffects.length, 1);
    assert.strictEqual(gs.activeEffects[0].category, 'condition');
    assert.deepStrictEqual(gs.board, {});
    // Board and team points must be untouched — this card is purely informational.
    assert.strictEqual(gs.teams[0].points, 5);
    assert.strictEqual(gs.teams[1].points, 3);
});

test('reminder effect display text names the targeted player when provided', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja1-k3', 1, { targetPlayerName: 'Aku' });

    assert.match(gs.activeEffects[0].displayText, /Aku/);
});

// ------------------------------------------------------------------
// sarja1-k5 / double-bid — shared double_draw modifier consumption
// ------------------------------------------------------------------

test('sarja1-k5 (Kiven Muisti) doubles the next spell draw for the casting team', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { drawPile: ['sarja1-k1', 'sarja1-k2', 'sarja1-k4'], hand: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja1-k5', 1, {});
    assert.strictEqual(gs.activeEffects.length, 1, 'modifier is tracked as an active effect');

    const drawn = engine.drawSpell(1, 1);
    assert.strictEqual(drawn.length, 2, 'one draw call pulls 2 cards while the modifier is active');
    assert.strictEqual(gs.activeEffects[0].isExpired, true, 'modifier is consumed after use');
});

test('the pre-existing double-bid card still works after generalizing _checkDoubleDraw', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { drawPile: ['a', 'b', 'c'], hand: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('double-bid', 1, {});
    const drawn = engine.drawSpell(1, 1);
    assert.strictEqual(drawn.length, 2);
});

test('double_draw modifier only benefits the casting team, not others', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { drawPile: ['a', 'b'], hand: [], usedPile: [] },
            2: { drawPile: ['x', 'y'], hand: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja1-k5', 1, {});
    const drawnByOther = engine.drawSpell(2, 1);
    assert.strictEqual(drawnByOther.length, 1, "team 2's draw is unaffected by team 1's modifier");

    const drawnByCaster = engine.drawSpell(1, 1);
    assert.strictEqual(drawnByCaster.length, 2, "caster's draw is still doubled");
});

// ------------------------------------------------------------------
// sarja1-k1 — Vuori Puhuu (replay_used_pile)
// ------------------------------------------------------------------

test('replay_used_pile replays no-input-required entries from the used pile', () => {
    const gs = makeGameState({
        board: { 'q0r0': 1, 'q1r0': 2 },
        spellPiles: {
            1: { drawPile: [], hand: [], usedPile: ['sarja1-k4'] } // Sabotaasia — ban, no extra input needed
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k1', 1, {});

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.replayed, ['sarja1-k4']);
    assert.deepStrictEqual(result.skipped, []);
    // The replayed ban creates a second active effect (first is Vuori Puhuu's own record).
    assert.strictEqual(gs.activeEffects.length, 2);
    assert.ok(gs.activeEffects.some(e => e.spellId === 'sarja1-k4'));
});

test('replay_used_pile skips entries that need a target/choice the handler cannot supply', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { drawPile: [], hand: [], usedPile: ['sarja1-k2', 'sarja1-k4'] } // destroy_adjacent needs a target, ban doesn't
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k1', 1, {});

    assert.deepStrictEqual(result.replayed, ['sarja1-k4']);
    assert.strictEqual(result.skipped.length, 1);
    assert.strictEqual(result.skipped[0].spellId, 'sarja1-k2');
});

test('replay_used_pile never recurses into another replay_used_pile card', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { drawPile: [], hand: [], usedPile: ['sarja1-k1'] }
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k1', 1, {});

    assert.deepStrictEqual(result.replayed, []);
    assert.strictEqual(result.skipped.length, 1);
    assert.strictEqual(result.skipped[0].spellId, 'sarja1-k1');
});

test('replay_used_pile handles an empty or missing used pile cleanly', () => {
    const gs = makeGameState(); // no spellPiles at all for team 1
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k1', 1, {});

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.replayed, []);
    assert.deepStrictEqual(result.skipped, []);
});

test('replay_used_pile logs a spell_used_pile_replayed action for auditability', () => {
    const gs = makeGameState({
        spellPiles: { 1: { drawPile: [], hand: [], usedPile: ['sarja1-k4'] } }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja1-k1', 1, {});

    const logged = engine.__logged.find(([type]) => type === 'spell_used_pile_replayed');
    assert.ok(logged, 'spell_used_pile_replayed action should be logged');
    assert.strictEqual(logged[2].castByTeamId, 1);
});

test('replay_used_pile treats an unknown spell id in the used pile as skipped, not a crash', () => {
    const gs = makeGameState({
        spellPiles: { 1: { drawPile: [], hand: [], usedPile: ['does-not-exist'] } }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja1-k1', 1, {});

    assert.strictEqual(result.skipped.length, 1);
    assert.strictEqual(result.skipped[0].spellId, 'does-not-exist');
});
