/**
 * Coverage for the Sarja5 physical spell-card series (see docs/SPELLS.md).
 * Unlike Sarja1-4, four of these five cards map onto EXISTING placeholder
 * ids in spells.json (get-away, elf-protection, all-according-plan,
 * echo-silence) — per the earlier decision, physical card text wins over
 * placeholder wording wherever they conflict, but the ids themselves were
 * NOT renamed (renaming would break spellId lookups for any already-cast
 * instances in the two stored tournaments).
 *
 * Cards covered:
 *   get-away (sarja5-k3)          destroy_adjacent — text updated, mechanic unchanged
 *   elf-protection (sarja5-k2)    shield — NOW ACTUALLY ENFORCED (was purely informational before)
 *   all-according-plan (sarja5-k1) copy_spell — NOW ACTUALLY RE-EXECUTES the copied spell
 *   echo-silence (sarja5-k4)      silence — text updated, mechanic unchanged
 *   sarja5-k5 Muinaiset puolustusmekanismit  fill_adjacent_to_heart (new)
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

// Synthetic fixture: mountain-purification was a legacy pre-illustration
// placeholder card (bonus_points effect) retired from spells.json — it had
// no equivalent in the final 43-card illustrated deck, and no other real
// card uses the bonus_points effect type. Injected here (rather than
// relying on spells.json) so copy_spell's ability to re-execute a
// bonus_points spell stays covered even though no real card exercises it.
byId['mountain-purification'] = {
    id: 'mountain-purification',
    name: 'Vuoren puhdistus',
    nameEn: 'Mountain Purification',
    type: 'instant',
    rarity: 'common',
    description: 'Voitte pelata tämän heti, kun olette asettaneet laatan laudalle. Saatte yhden voittopisteen jokaisesta vuoren sydämestä (myös sivusydämet), jotka ovat hallussanne sillä hetkellä.',
    descriptionEn: 'You may play this immediately after placing a tile on the board. You get one victory point for each mountain heart (including side hearts) you control at that moment.',
    timing: 'after-placement',
    targetType: 'self',
    effect: { type: 'bonus_points', calculation: 'controlled_hearts' }
};

function makeGameState(overrides = {}) {
    return {
        spellDefinitions: byId,
        teams: [{ id: 1, name: 'Red', points: 5 }, { id: 2, name: 'Blue', points: 3 }, { id: 3, name: 'Green', points: 1 }],
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

test('the 4 overlapping placeholder ids kept their original ids, just updated text/metadata', () => {
    for (const id of ['get-away', 'elf-protection', 'all-according-plan', 'echo-silence']) {
        assert.ok(byId[id], `${id} must still exist under its original id`);
        assert.strictEqual(byId[id].deck, 'sarja5');
    }
});

test('sarja5-k5 (Muinaiset puolustusmekanismit) exists as a genuinely new card', () => {
    assert.ok(byId['sarja5-k5']);
});

// ------------------------------------------------------------------
// elf-protection — shield is now actually enforced
// ------------------------------------------------------------------

test('a shielded team\'s tiles survive destroy_adjacent', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {}); // team 2 shields itself

    const result = engine.executeSpellEffect('get-away', 1, {});

    assert.deepStrictEqual(result.destroyed, [], 'shielded tile is not destroyed');
    assert.strictEqual(gs.board['q1r0'], 2);
});

test('an unshielded team is destroyed as normal — shield only protects its own caster', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2, 'q-1r0': 3 } });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {}); // only team 2 is shielded

    const result = engine.executeSpellEffect('get-away', 1, {});

    assert.strictEqual(result.destroyed.length, 1);
    assert.strictEqual(result.destroyed[0].coord, 'q-1r0');
    assert.strictEqual(gs.board['q1r0'], 2, 'team 2 still protected');
    assert.strictEqual(gs.board['q-1r0'], undefined, 'team 3 still destroyed');
});

test('shield also protects against useChargedRemoval', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {});
    const glock = engine.executeSpellEffect('sarja2-k1', 1, {});

    const result = engine.useChargedRemoval(glock.effectId, 'q1r0');

    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q1r0'], 2);
});

test('shield also protects against random_mass_removal', () => {
    const gs = makeGameState({ board: { 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {});

    const result = engine.executeSpellEffect('sarja4-k3', 1, { roll: 2, teamOrder: [1, 2, 3], coords: ['q1r0'] });

    assert.deepStrictEqual(result.destroyed, []);
    assert.strictEqual(gs.board['q1r0'], 2);
});

test('shield also protects against extra_placement\'s destroy_occupied restriction (Katalyyttiavain)', () => {
    const gs = makeGameState({ board: { 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {});

    const result = engine.executeSpellEffect('sarja2-k5', 1, {
        holdingMountainHeart: true,
        coords: ['q1r0', 'q2r0', 'q3r0', 'q4r0', 'q5r0', 'q6r0']
    });

    assert.strictEqual(result.rejected.some(r => r.coord === 'q1r0'), true);
    assert.strictEqual(gs.board['q1r0'], 2);
});

test('an expired shield no longer protects', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {});
    gs.activeEffects[0].isExpired = true;

    const result = engine.executeSpellEffect('get-away', 1, {});

    assert.strictEqual(result.destroyed.length, 1);
});

// ------------------------------------------------------------------
// all-according-plan — copy_spell now actually re-executes
// ------------------------------------------------------------------

test('copy_spell re-executes a used bonus_points spell for the copying team', () => {
    const gs = makeGameState({ heartHexControl: { 'q0r0': 1, 'q1r0': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('all-according-plan', 1, { spellId: 'mountain-purification' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.copiedResult.pointsAwarded, 2);
    assert.strictEqual(gs.teams[0].points, 7);
});

test('copy_spell forwards extra targetData through to the copied spell\'s own handler', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('all-according-plan', 1, {
        spellId: 'sarja3-k5', // Kysy yrteiltä / reveal_hands — takes no extra input, simplest to verify passthrough
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.copiedResult.effectId !== undefined, true);
});

test('copy_spell refuses to copy another copy_spell card (no recursive copying)', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('all-according-plan', 1, { spellId: 'all-according-plan' });

    assert.strictEqual(result.success, false);
});

test('copy_spell errors cleanly with no spellId or an unknown one', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.executeSpellEffect('all-according-plan', 1, {}).success, false);
    assert.strictEqual(engine.executeSpellEffect('all-according-plan', 1, { spellId: 'nope' }).success, false);
});

test('copy_spell logs an auditable spell_copied entry', () => {
    const gs = makeGameState({ heartHexControl: {} });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('all-according-plan', 1, { spellId: 'mountain-purification' });

    const logged = engine.__logged.find(([type]) => type === 'spell_copied');
    assert.ok(logged);
    assert.strictEqual(logged[2].copiedSpellId, 'mountain-purification');
});

// ------------------------------------------------------------------
// sarja5-k5 — Muinaiset puolustusmekanismit (fill_adjacent_to_heart)
// ------------------------------------------------------------------

test('fill_adjacent_to_heart fills every empty hex around a heart the caster controls', () => {
    const gs = makeGameState({
        heartHexControl: { 'q0r0': 1 },
        board: { 'q1r0': 2 } // one neighbor already occupied by an opponent
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja5-k5', 1, { heartCoord: 'q0r0' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.placed.length, 5, '5 of the 6 neighbors were empty');
    assert.strictEqual(gs.board['q1r0'], 2, 'the already-occupied neighbor is untouched, not destroyed');
    for (const coord of ['q1r-1', 'q0r-1', 'q-1r0', 'q-1r1', 'q0r1']) {
        assert.strictEqual(gs.board[coord], 1);
    }
});

test('fill_adjacent_to_heart refuses to resolve for a heart the caster does not control', () => {
    const gs = makeGameState({ heartHexControl: { 'q0r0': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja5-k5', 1, { heartCoord: 'q0r0' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(gs.board, {});
});

test('fill_adjacent_to_heart errors cleanly with no heartCoord', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.executeSpellEffect('sarja5-k5', 1, {}).success, false);
});
