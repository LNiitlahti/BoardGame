/**
 * Coverage for the Sarja4 physical spell-card series (see docs/SPELLS.md).
 *
 * Cards covered:
 *   sarja4-k1  Ylimielistä tietoa   conditional_bonus (new: admin-attested condition, fixed points+tiles reward)
 *   sarja4-k2  Älä tule lähemmäs    placement_lockout (new: tracked hex lock, enforcement is a documented follow-up)
 *   sarja4-k3  Epävakaa loitsu      random_mass_removal (new: d6 table, reuses spell_board_effect undo)
 *   sarja4-k4  Mielen siirto        reminder (seat swap, no digital hook)
 *   sarja4-k5  Magian keskittymä    conditional_card_grab (new: admin-attested trial, cross-team card transfer)
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
            { id: 1, name: 'Red', points: 5 }, { id: 2, name: 'Blue', points: 3 },
            { id: 3, name: 'Green', points: 1 }, { id: 4, name: 'Yellow', points: 0 },
            { id: 5, name: 'Purple', points: 0 }
        ],
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

test('all 5 Sarja4 cards exist in spells.json', () => {
    for (const id of ['sarja4-k1', 'sarja4-k2', 'sarja4-k3', 'sarja4-k4', 'sarja4-k5']) {
        assert.ok(byId[id], `${id} should exist`);
    }
});

// ------------------------------------------------------------------
// sarja4-k1 — Ylimielistä tietoa (conditional_bonus)
// ------------------------------------------------------------------

test('conditional_bonus refuses to award anything without conditionMet', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k1', 1, { coords: ['q1r0', 'q2r0'] });

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.teams[0].points, 5);
});

test('conditional_bonus awards points and places the bonus tiles once confirmed', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k1', 1, {
        conditionMet: true, coords: ['q1r0', 'q2r0']
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pointsAwarded, 2);
    assert.strictEqual(gs.teams[0].points, 7);
    assert.deepStrictEqual(result.placement.placed, ['q1r0', 'q2r0']);
    assert.strictEqual(gs.board['q1r0'], 1);
    assert.strictEqual(gs.board['q2r0'], 1);
});

test('conditional_bonus still awards points even if the tile coords are short (partial success, not a crash)', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k1', 1, { conditionMet: true, coords: ['q1r0'] });

    assert.strictEqual(result.pointsAwarded, 2);
    assert.strictEqual(gs.teams[0].points, 7);
    assert.ok(result.error);
});

// ------------------------------------------------------------------
// sarja4-k2 — Älä tule lähemmäs (placement_lockout)
// ------------------------------------------------------------------

test('placement_lockout tracks locked hexes on the active effect and via isHexLocked()', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k2', 1, { coords: ['q1r0', 'q2r0', 'q3r0'] });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.lockedHexes, ['q1r0', 'q2r0', 'q3r0']);
    assert.strictEqual(engine.isHexLocked('q1r0'), true);
    assert.strictEqual(engine.isHexLocked('q9r9'), false);
});

test('isHexLocked ignores expired lockout effects', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('sarja4-k2', 1, { coords: ['q1r0'] });
    gs.activeEffects[0].isExpired = true;

    assert.strictEqual(engine.isHexLocked('q1r0'), false);
});

// ------------------------------------------------------------------
// sarja4-k3 — Epävakaa loitsu (random_mass_removal)
// ------------------------------------------------------------------

test('roll 1-5 removes up to 3 tiles from the correspondingly-numbered team only', () => {
    const gs = makeGameState({
        board: { 'a': 2, 'b': 2, 'c': 2, 'd': 2, 'e': 3 }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k3', 1, {
        roll: 2, teamOrder: [1, 2, 3, 4, 5], coords: ['a', 'b', 'c', 'd', 'e']
    });

    assert.strictEqual(result.roll, 2);
    assert.deepStrictEqual(result.targetTeamIds, [2]);
    assert.strictEqual(result.destroyed.length, 3, 'capped at 3 even though 4 team-2 tiles were offered');
    assert.strictEqual(gs.board['e'], 3, 'team 3 tile untouched — not the rolled target');
});

test('roll 6 removes up to 2 tiles from every team except the caster', () => {
    const gs = makeGameState({
        board: { 'a': 2, 'b': 2, 'c': 3, 'd': 3, 'e': 1, 'f': 1 }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k3', 1, {
        roll: 6, coords: ['a', 'b', 'c', 'd', 'e', 'f']
    });

    assert.deepStrictEqual(result.targetTeamIds.sort(), [2, 3, 4, 5]);
    assert.strictEqual(result.destroyed.length, 4, '2 from team2, 2 from team3; teams 4/5 have no tiles offered');
    assert.strictEqual(gs.board['e'], 1, "caster's own tiles are never eligible targets");
    assert.strictEqual(gs.board['f'], 1);
});

test('random_mass_removal errors cleanly when the rolled number has no team assigned', () => {
    const gs = makeGameState({ board: { 'a': 3 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k3', 1, { roll: 3, teamOrder: [1, 2], coords: ['a'] });

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['a'], 3, 'nothing destroyed when the roll cannot resolve to a team');
});

test('random_mass_removal reuses spell_board_effect for undo support', () => {
    const gs = makeGameState({ board: { 'a': 2 } });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja4-k3', 1, { roll: 1, teamOrder: [2], coords: ['a'] });

    const logged = engine.__logged.find(([type]) => type === 'spell_board_effect');
    assert.ok(logged, 'must log as an undoable spell_board_effect');
});

// ------------------------------------------------------------------
// sarja4-k4 — Mielen siirto (reminder)
// ------------------------------------------------------------------

test('Mielen siirto is an informational reminder with no board or hand mutation', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja4-k4', 1, {});

    assert.deepStrictEqual(gs.board, { 'q0r0': 1 });
});

// ------------------------------------------------------------------
// sarja4-k5 — Magian keskittymä (conditional_card_grab)
// ------------------------------------------------------------------

test('conditional_card_grab refuses to take anything without succeeded=true', () => {
    const gs = makeGameState({
        spellPiles: { 1: { hand: [], drawPile: [], usedPile: [] }, 2: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k5', 1, {
        picks: [{ teamId: 2, spellId: 'sarja1-k1', source: 'hand' }]
    });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(gs.spellPiles[2].hand, ['sarja1-k1']);
});

test('conditional_card_grab moves cards from other teams\' piles into the caster\'s hand once confirmed', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { hand: [], drawPile: [], usedPile: [] },
            2: { hand: ['sarja1-k1'], drawPile: [], usedPile: ['sarja1-k4'] },
            3: { hand: [], drawPile: ['sarja2-k1'], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k5', 1, {
        succeeded: true,
        picks: [
            { teamId: 2, spellId: 'sarja1-k1', source: 'hand' },
            { teamId: 2, spellId: 'sarja1-k4', source: 'usedPile' },
            { teamId: 3, spellId: 'sarja2-k1', source: 'drawPile' }
        ]
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.taken.length, 3);
    assert.deepStrictEqual(gs.spellPiles[1].hand.sort(), ['sarja1-k1', 'sarja1-k4', 'sarja2-k1'].sort());
    assert.deepStrictEqual(gs.spellPiles[2].hand, []);
    assert.deepStrictEqual(gs.spellPiles[2].usedPile, []);
    assert.deepStrictEqual(gs.spellPiles[3].drawPile, []);
});

test('conditional_card_grab rejects a pick that is not actually at the named source', () => {
    const gs = makeGameState({
        spellPiles: { 1: { hand: [], drawPile: [], usedPile: [] }, 2: { hand: [], drawPile: [], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja4-k5', 1, {
        succeeded: true,
        picks: [{ teamId: 2, spellId: 'does-not-exist', source: 'hand' }]
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.rejected.length, 1);
});

test('conditional_card_grab caps picks at the card\'s amount (6), ignoring extras', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { hand: [], drawPile: [], usedPile: [] },
            2: { hand: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], drawPile: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    const picks = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ teamId: 2, spellId: id, source: 'hand' }));
    const result = engine.executeSpellEffect('sarja4-k5', 1, { succeeded: true, picks });

    assert.strictEqual(result.taken.length, 6);
    assert.deepStrictEqual(gs.spellPiles[2].hand, ['g']);
});
