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

test('charged_removal (Glock 17) active effect never gets a round-based expiry', () => {
    const gs = makeGameState();
    const engine = makeSpellEngine(gs);

    const def = byId['sarja2-k1']; // Glock 17: charged_removal, charges: 10
    assert.strictEqual(def.effect.type, 'charged_removal');

    const result = engine.executeSpellEffect(def.id, 1, {});
    assert.strictEqual(result.success, true);

    const effect = gs.activeEffects.find(e => e.id === result.effectId);
    assert.ok(effect, 'active effect should have been created');
    assert.strictEqual(effect.expiresAfterRound, null,
        'charged_removal must not round-expire — only usesRemaining <= 0 should end it');
});
