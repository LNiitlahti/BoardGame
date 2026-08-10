/**
 * Coverage for the Sarja6 physical spell-card series (see docs/SPELLS.md).
 * 9 unique cards (Sarja6k10.pdf is a confirmed byte-identical duplicate of
 * Sarja6k1.pdf, not a distinct 10th card). Four overlap existing placeholder
 * ids (rift-knowledge, betting-depths, rematch) or were already covered
 * elsewhere; this file covers the genuinely new mechanics plus the newly
 * real `bet` handler.
 *
 * Cards covered:
 *   sarja6-k1  Nyt pelataan Spellbreak   reminder (uses:2, game-selection override, no digital hook)
 *   sarja6-k2  Lukossa                   heart_lock (new: tracked lock + isHeartLocked() query)
 *   sarja6-k3  Samat senssit             reminder (mouse settings, no digital hook)
 *   sarja6-k4  Vaihtoon                  force_redraw (new: pull a card, shuffle back, draw replacement)
 *   sarja6-k5  Me halutaan pelata...     reminder (game/roster choice, no digital hook)
 *   sarja6-k6  rift-knowledge            counter — text updated to match physical wording
 *   sarja6-k7  betting-depths            bet — now has a REAL handler (was reminder-only before)
 *   sarja6-k8  Perus poisto              charged_removal, requiresAdjacency:false (2 uses, any tile)
 *   sarja6-k9  rematch                   unchanged mechanic, text/deck metadata updated
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

test('all 9 unique Sarja6 cards exist (no sarja6-k10 — confirmed duplicate)', () => {
    for (const id of ['sarja6-k1', 'sarja6-k2', 'sarja6-k3', 'sarja6-k4', 'sarja6-k5', 'sarja6-k8']) {
        assert.ok(byId[id], `${id} should exist`);
    }
    assert.strictEqual(byId['sarja6-k10'], undefined);
    for (const id of ['rift-knowledge', 'betting-depths', 'rematch']) {
        assert.strictEqual(byId[id].deck, 'sarja6');
    }
});

// ------------------------------------------------------------------
// sarja6-k1, k3, k5 — reminders
// ------------------------------------------------------------------

test('Spellbreak / Samat senssit / Me halutaan pelata are informational reminders, no mutation', () => {
    const gs = makeGameState({ board: { 'q0r0': 1 } });
    const engine = makeSpellEngine(gs);

    for (const id of ['sarja6-k1', 'sarja6-k3', 'sarja6-k5']) {
        engine.executeSpellEffect(id, 1, {});
    }

    assert.strictEqual(gs.activeEffects.length, 3);
    assert.deepStrictEqual(gs.board, { 'q0r0': 1 });
});

// ------------------------------------------------------------------
// sarja6-k2 — Lukossa (heart_lock)
// ------------------------------------------------------------------

test('heart_lock tracks the locked heart coord and via isHeartLocked()', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja6-k2', 1, { heartCoord: 'q0r0' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(engine.isHeartLocked('q0r0'), true);
    assert.strictEqual(engine.isHeartLocked('q9r9'), false);
});

test('heart_lock expires after 2 rounds, not the generic 1-round default', () => {
    const gs = makeGameState({ currentPhase: { roundNumber: 5 } });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja6-k2', 1, { heartCoord: 'q0r0' });

    assert.strictEqual(gs.activeEffects[0].expiresAfterRound, 7);
});

test('heart_lock errors cleanly with no heartCoord', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.executeSpellEffect('sarja6-k2', 1, {}).success, false);
});

test('isHeartLocked ignores expired locks', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);
    engine.executeSpellEffect('sarja6-k2', 1, { heartCoord: 'q0r0' });
    gs.activeEffects[0].isExpired = true;

    assert.strictEqual(engine.isHeartLocked('q0r0'), false);
});

// ------------------------------------------------------------------
// sarja6-k4 — Vaihtoon (force_redraw)
// ------------------------------------------------------------------

test('force_redraw pulls the named card, shuffles it into the draw pile, and draws a replacement', () => {
    const gs = makeGameState({
        spellPiles: { 2: { hand: ['sarja1-k1', 'sarja1-k2'], drawPile: ['sarja1-k4'], usedPile: [] } }
    });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja6-k4', 1, { teamId: 2, spellId: 'sarja1-k1' });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.drawn, ['sarja1-k4']);
    assert.deepStrictEqual(gs.spellPiles[2].hand.sort(), ['sarja1-k2', 'sarja1-k4'].sort());
    assert.ok(gs.spellPiles[2].drawPile.includes('sarja1-k1'), 'exchanged card went into the draw pile');
});

test('force_redraw never lets the team immediately redraw the very card they just gave up', () => {
    // Regression test: draw must happen BEFORE the exchanged card is
    // shuffled back into the pile, per the card's own word order ("draws a
    // new card... [then] puts the chosen card into the draw pile and
    // shuffles it"). Doing it the other way risked a 50/50 chance of
    // immediately drawing the same card back out — run many times since a
    // single run can't rule out a race-condition-shaped bug.
    for (let i = 0; i < 25; i++) {
        const gs = makeGameState({
            spellPiles: { 2: { hand: ['sarja1-k1'], drawPile: ['sarja1-k4'], usedPile: [] } }
        });
        const engine = makeSpellEngine(gs);
        const result = engine.executeSpellEffect('sarja6-k4', 1, { teamId: 2, spellId: 'sarja1-k1' });
        assert.deepStrictEqual(result.drawn, ['sarja1-k4']);
    }
});

test('force_redraw errors cleanly when the card is not in the target team\'s hand', () => {
    const gs = makeGameState({ spellPiles: { 2: { hand: [], drawPile: [], usedPile: [] } } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('sarja6-k4', 1, { teamId: 2, spellId: 'sarja1-k1' });

    assert.strictEqual(result.success, false);
});

test('force_redraw is undoable via a full pile snapshot restore', () => {
    const gs = makeGameState({
        spellPiles: { 2: { hand: ['sarja1-k1'], drawPile: ['a', 'b'], usedPile: ['c'] } }
    });
    const engine = makeSpellEngine(gs);

    engine.executeSpellEffect('sarja6-k4', 1, { teamId: 2, spellId: 'sarja1-k1' });
    const logged = engine.__logged.find(([type]) => type === 'spell_forced_redraw');

    assert.ok(logged);
    assert.deepStrictEqual(logged[3].handBefore, ['sarja1-k1']);
    assert.deepStrictEqual(logged[3].drawPileBefore, ['a', 'b']);
    assert.deepStrictEqual(logged[3].usedPileBefore, ['c']);
});

// ------------------------------------------------------------------
// sarja6-k6 / rift-knowledge — text updated, mechanic unchanged
// ------------------------------------------------------------------

test('rift-knowledge still dispatches through the generic counter handler (usesRemaining tracked)', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('rift-knowledge', 1, {});

    assert.strictEqual(result.usesRemaining, 1);
});

// ------------------------------------------------------------------
// sarja6-k7 / betting-depths — bet now has a real handler
// ------------------------------------------------------------------

test('bet awards points and tiles per correct prediction', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('betting-depths', 1, {
        correctCount: 2, coords: ['q1r0', 'q2r0']
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pointsAwarded, 2);
    assert.strictEqual(gs.teams[0].points, 7);
    assert.deepStrictEqual(result.placement.placed, ['q1r0', 'q2r0']);
});

test('bet destroys the named self-tiles when all predictions are wrong', () => {
    const gs = makeGameState({ board: { 'q0r0': 1, 'q1r0': 1, 'q2r0': 1 } });
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('betting-depths', 1, {
        correctCount: 0, selfDestroyCoords: ['q0r0', 'q1r0']
    });

    assert.strictEqual(result.destroyed.length, 2);
    assert.strictEqual(gs.board['q0r0'], undefined);
    assert.strictEqual(gs.board['q1r0'], undefined);
    assert.strictEqual(gs.board['q2r0'], 1, 'untouched — not named for self-destruction');
});

test('bet refuses a correctCount outside 0..predictions', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    assert.strictEqual(engine.executeSpellEffect('betting-depths', 1, { correctCount: 4 }).success, false);
    assert.strictEqual(engine.executeSpellEffect('betting-depths', 1, {}).success, false);
});

test('bet self-destruction only removes tiles the caster actually owns', () => {
    const gs = makeGameState({ board: { 'q0r0': 2 } }); // owned by team 2, not the caster
    const engine = makeSpellEngine(gs);

    const result = engine.executeSpellEffect('betting-depths', 1, { correctCount: 0, selfDestroyCoords: ['q0r0'] });

    assert.deepStrictEqual(result.destroyed, []);
    assert.strictEqual(gs.board['q0r0'], 2);
});

// ------------------------------------------------------------------
// sarja6-k8 — Perus poisto (charged_removal, no adjacency required)
// ------------------------------------------------------------------

test('Perus poisto removes any tile on the board, no adjacency required', () => {
    const gs = makeGameState({ board: { 'q9r9': 2 } }); // caster has no tiles at all
    const engine = makeSpellEngine(gs);

    const cast = engine.executeSpellEffect('sarja6-k8', 1, {});
    const result = engine.useChargedRemoval(cast.effectId, 'q9r9');

    assert.strictEqual(result.success, true);
    assert.strictEqual(gs.board['q9r9'], undefined);
});

test('Perus poisto starts with exactly 2 charges and expires after both are used', () => {
    const gs = makeGameState({ board: { 'a': 2, 'b': 2 } });
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('sarja6-k8', 1, {});

    assert.strictEqual(cast.usesRemaining, 2);
    engine.useChargedRemoval(cast.effectId, 'a');
    const second = engine.useChargedRemoval(cast.effectId, 'b');

    assert.strictEqual(second.usesRemaining, 0);
    assert.strictEqual(gs.activeEffects[0].isExpired, true);
});

test('Glock 17\'s adjacency requirement is unaffected by adding requiresAdjacency support', () => {
    const gs = makeGameState({ board: { 'q9r9': 2 } }); // not adjacent to any caster tile
    const engine = makeSpellEngine(gs);
    const cast = engine.executeSpellEffect('sarja2-k1', 1, {});

    const result = engine.useChargedRemoval(cast.effectId, 'q9r9');

    assert.strictEqual(result.success, false, 'Glock 17 still requires adjacency (default true)');
});
