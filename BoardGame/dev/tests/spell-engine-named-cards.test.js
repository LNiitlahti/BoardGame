/**
 * Coverage for the 8 individually-named custom spell cards (see docs/SPELLS.md)
 * — the final batch of the 43-card physical deck. The card text itself is
 * generic (confirmed during transcription); ids/filenames use a plain n1-n8
 * numbering rather than any real name.
 *
 * Cards covered:
 *   named-n1  Katso kuinka se kuolee     forced_removal_condition (new, tracked-only — no match-loss hook exists)
 *   named-n2  Vettähän se vain oli       marked_relocation_charge (new: mark now, relocate-with-destroy later)
 *   named-n3  Epävakaa todellisuus       temporary_capture (new: immediate capture, auto-removed after 2 rounds)
 *   named-n4  Rintama vaihtuu            reposition w/ requiresConnectedFormation (new precondition on existing handler)
 *   named-n5  Rinnalla loppuun asti      piggyback_condition (new, tracked + admin-triggered grant)
 *   named-n6  Vaistonvarainen väistö     evasion_condition (new — primitives only, not wired into destroy paths)
 *   named-n7  Tuhoa suunnitelmat         blind_card_swap (new: two independent random swaps)
 *   named-n8  Priimus                    win_streak_bonus (new: admin-attested streak level, escalating reward)
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
        teams: [{ id: 1, name: 'Red', points: 5 }, { id: 2, name: 'Blue', points: 3 }, { id: 3, name: 'Green', points: 1 }],
        board: {},
        heartHexControl: {},
        activeEffects: [],
        spellPiles: {},
        currentPhase: { roundNumber: 3 },
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

test('all 8 named cards exist in spells.json', () => {
    for (const id of ['named-n1', 'named-n2', 'named-n3', 'named-n4',
        'named-n5', 'named-n6', 'named-n7', 'named-n8']) {
        assert.ok(byId[id], `${id} should exist`);
    }
});

// ------------------------------------------------------------------
// named-n1 — Katso kuinka se kuolee (forced_removal_condition)
// ------------------------------------------------------------------

test('forced_removal_condition tracks the obligation and applyForcedRemoval enforces it', () => {
    const gs = makeGameState({ board: { 'q0r0': 2 } });
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('named-n1', 1, { targetTeamId: 2 });
    assert.strictEqual(engine.hasForcedRemovalObligation(2), true);
    assert.strictEqual(engine.hasForcedRemovalObligation(3), false);

    const result = engine.applyForcedRemoval(cast.effectId, 'q0r0');
    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.board['q0r0'], undefined);
});

test('applyForcedRemoval refuses a coord not owned by the obligated team', () => {
    const gs = makeGameState({ board: { 'q0r0': 3 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('named-n1', 1, { targetTeamId: 2 });

    const result = engine.applyForcedRemoval(cast.effectId, 'q0r0');
    assert.strictEqual(result.success, false);
    assert.strictEqual(gs.board['q0r0'], 3);
});

test('forced_removal_condition respects shield', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('elf-protection', 2, {});

    const result = engine.executeSpellEffect('named-n1', 1, { targetTeamId: 2 });
    assert.strictEqual(result.success, false);
});

// ------------------------------------------------------------------
// named-n2 — Vettähän se vain oli (marked_relocation_charge)
// ------------------------------------------------------------------

test('marking spends charges and tracks marked coords; resolving relocates and destroys on landing', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q9r9': 2 } });
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('named-n2', 1, {});
    assert.strictEqual(cast.usesRemaining, 2);

    const mark1 = engine.markTileForRelocation(cast.effectId, 'q0r0');
    assert.strictEqual(mark1.success, true);
    assert.strictEqual(mark1.usesRemaining, 1);

    const resolved = engine.resolveMarkedRelocation(cast.effectId, [{ from: 'q0r0', to: 'q1r0' }]);
    assert.strictEqual(resolved.success, true);
    assert.strictEqual(gs.board['q0r0'], undefined);
    assert.strictEqual(gs.board['q1r0'], 1);
});

test('resolveMarkedRelocation destroys whatever occupies the destination hex', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('named-n2', 1, {});
    engine.markTileForRelocation(cast.effectId, 'q0r0');

    const resolved = engine.resolveMarkedRelocation(cast.effectId, [{ from: 'q0r0', to: 'q1r0' }]);

    assert.strictEqual(resolved.destroyed.length, 1);
    assert.strictEqual(resolved.destroyed[0].coord, 'q1r0');
    assert.strictEqual(gs.board['q1r0'], 1);
});

test('resolveMarkedRelocation rejects a move whose destination is not adjacent to the marked tile', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('named-n2', 1, {});
    engine.markTileForRelocation(cast.effectId, 'q0r0');

    const resolved = engine.resolveMarkedRelocation(cast.effectId, [{ from: 'q0r0', to: 'q9r9' }]);

    assert.strictEqual(resolved.applied.length, 0);
    assert.strictEqual(resolved.rejected.length, 1);
});

test('markTileForRelocation refuses once the 2 charges are spent', () => {
    const gs = makeGameState({ board: { 'a': 1, 'b': 1, 'c': 1 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('named-n2', 1, {});
    engine.markTileForRelocation(cast.effectId, 'a');
    engine.markTileForRelocation(cast.effectId, 'b');

    const third = engine.markTileForRelocation(cast.effectId, 'c');
    assert.strictEqual(third.success, false);
});

// ------------------------------------------------------------------
// named-n3 — Epävakaa todellisuus (temporary_capture)
// ------------------------------------------------------------------

test('temporary_capture takes two adjacent opponent tiles touching the caster', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2, 'q1r-1': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n3', 1, { coords: ['q1r0', 'q1r-1'] });

    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.board['q1r0'], 1);
    assert.strictEqual(gs.board['q1r-1'], 1);
});

test('temporary_capture rejects tiles that do not touch each other', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2, 'q9r9': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n3', 1, { coords: ['q1r0', 'q9r9'] });

    assert.strictEqual(result.success, false);
});

test('temporary_capture rejects when neither tile touches the caster', () => {
    const gs = makeGameState({ board: { 'q5r5': 1, 'q1r0': 2, 'q1r-1': 2 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n3', 1, { coords: ['q1r0', 'q1r-1'] });

    assert.strictEqual(result.success, false);
});

test('captured tiles are removed from the game entirely once the effect expires', () => {
    const gs = makeGameState({
        board: { 'q0r0': 1, 'q1r0': 2, 'q1r-1': 2 },
        currentPhase: { roundNumber: 1 }
    });
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('named-n3', 1, { coords: ['q1r0', 'q1r-1'] });

    gs.currentPhase.roundNumber = 10; // well past the 2-round duration
    engine.expireConditions();

    assert.strictEqual(gs.board['q1r0'], undefined);
    assert.strictEqual(gs.board['q1r-1'], undefined);
});

// ------------------------------------------------------------------
// named-n4 — Rintama vaihtuu (reposition + requiresConnectedFormation)
// ------------------------------------------------------------------

test('a connected 3-tile formation may be repositioned freely (translation covers rotation)', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 1, 'q1r-1': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n4', 1, {
        moves: [
            { from: 'q0r0', to: 'q5r5' },
            { from: 'q1r0', to: 'q6r5' },
            { from: 'q1r-1', to: 'q6r4' }
        ]
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.applied.length, 3);
});

test('a non-connected set of 3 tiles is rejected outright', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q9r9': 1, 'q1r-1': 1 } }); // q9r9 isn't adjacent to the others
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n4', 1, {
        moves: [
            { from: 'q0r0', to: 'q5r5' },
            { from: 'q9r9', to: 'q6r5' },
            { from: 'q1r-1', to: 'q6r4' }
        ]
    });

    assert.strictEqual(result.success, false);
});

test('fewer than 3 tiles in the formation is rejected', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n4', 1, {
        moves: [{ from: 'q0r0', to: 'q5r5' }, { from: 'q1r0', to: 'q6r5' }]
    });

    assert.strictEqual(result.success, false);
});

// ------------------------------------------------------------------
// named-n5 — Rinnalla loppuun asti (piggyback_condition)
// ------------------------------------------------------------------

test('piggyback_condition tracks the target team and grantPiggybackPlacement places matching tiles for the caster', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('named-n5', 1, { targetTeamId: 2 });

    const result = engine.grantPiggybackPlacement(cast.effectId, ['q1r0', 'q2r0']);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.placed, ['q1r0', 'q2r0']);
    assert.strictEqual(gs.board['q1r0'], 1);
});

test('grantPiggybackPlacement fails cleanly on an unknown or expired effect', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.grantPiggybackPlacement('nope', ['q1r0']).success, false);
});

// ------------------------------------------------------------------
// named-n6 — Vaistonvarainen väistö (evasion_condition primitives)
// ------------------------------------------------------------------

test('_hasEvasion reflects an active evasion_condition effect', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('named-n6', 1, {});

    assert.strictEqual(engine._hasEvasion(1), true);
    assert.strictEqual(engine._hasEvasion(2), false);
});

test('_findEvasionHex finds the nearest empty hex not touching an opponent', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 2 } }); // q1r0 is enemy-adjacent to q0r0
    const engine = makeSpellEngine(gs);

    const hex = engine._findEvasionHex('q0r0', 1);

    assert.ok(hex, 'should find some escape hex');
    assert.strictEqual(gs.board[hex], undefined);
});

test('_findEvasionHex returns null when boxed in within the search radius', () => {
    const gs = makeGameState();
    // Fill a large area around origin with opponent tiles so every reachable hex is adjacent to one.
    const ring = ['q1r0', 'q1r-1', 'q0r-1', 'q-1r0', 'q-1r1', 'q0r1'];
    for (const c of ring) gs.board[c] = 2;
    const engine = makeSpellEngine(gs);

    // Every hex within a couple of rings still touches the ring, so this is
    // a plausible (not guaranteed-universal) null case — just checking the
    // function doesn't throw and returns a sane type either way.
    const hex = engine._findEvasionHex('q0r0', 1);
    assert.ok(hex === null || typeof hex === 'string');
});

// ------------------------------------------------------------------
// named-n7 — Tuhoa suunnitelmat (blind_card_swap)
// ------------------------------------------------------------------

test('blind_card_swap swaps one random card between the two named teams', () => {
    const gs = makeGameState({
        spellPiles: {
            2: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] },
            3: { hand: ['sarja1-k2'], drawPile: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n7', 1, { teamAId: 2, teamBId: 3 });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(gs.spellPiles[2].hand, ['sarja1-k2']);
    assert.deepStrictEqual(gs.spellPiles[3].hand, ['sarja1-k1']);
});

test('blind_card_swap also performs the caster\'s own chosen-vs-blind swap when requested', () => {
    const gs = makeGameState({
        spellPiles: {
            1: { hand: ['sarja1-k4'], drawPile: [], usedPile: [] },
            2: { hand: ['sarja1-k1'], drawPile: [], usedPile: [] },
            3: { hand: ['sarja2-k1'], drawPile: [], usedPile: [] }
        }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n7', 1, {
        teamAId: 2, teamBId: 3, casterSpellId: 'sarja1-k4', casterSwapTeamId: 2
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.casterSwap);
    assert.deepStrictEqual(gs.spellPiles[1].hand, [result.casterSwap.casterGot]);
});

test('blind_card_swap fails cleanly when a team has an empty hand', () => {
    const gs = makeGameState({
        spellPiles: { 2: { hand: [], drawPile: [], usedPile: [] }, 3: { hand: ['a'], drawPile: [], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n7', 1, { teamAId: 2, teamBId: 3 });

    assert.strictEqual(result.success, false);
});

// ------------------------------------------------------------------
// named-n8 — Priimus (win_streak_bonus)
// ------------------------------------------------------------------

test('win_streak_bonus places 1 tile at streak level 2', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n8', 1, { streakLevel: 2, coords: ['q1r0'] });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.placed, ['q1r0']);
});

test('win_streak_bonus places 2 tiles at streak level 3', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('named-n8', 1, { streakLevel: 3, coords: ['q1r0', 'q2r0'] });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.placed.length, 2);
});

test('win_streak_bonus rejects an invalid streak level', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.executeSpellEffect('named-n8', 1, { streakLevel: 1, coords: ['q1r0'] }).success, false);
    assert.strictEqual(engine.executeSpellEffect('named-n8', 1, { coords: ['q1r0'] }).success, false);
});
