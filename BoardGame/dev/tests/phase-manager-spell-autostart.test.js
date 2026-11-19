/**
 * Digital spells (tournament spellsActive === true) start their turn order
 * automatically when a spell window opens — no "Begin Spells" click.
 * Physical spells (spellsActive off) start nothing: the admin logs used
 * spells in the Spell Log instead.
 */
const test = require('node:test');
const assert = require('node:assert');

global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.window = global.window || {};
global.document = global.document || {
    getElementById: () => null,
    createElement: () => ({ textContent: '', innerHTML: '' }),
    querySelectorAll: () => []
};
require('../../full/scripts/phase-manager.js');
const PhaseManager = global.window.PhaseManager;

function setup(spellsActive) {
    const gs = {
        status: 'playing', spellsActive,
        currentPhase: { name: 'hex_placement_1', roundNumber: 3, startedAt: '2026-11-19T10:00:00.000Z' },
        teams: [], gameQueue: []
    };
    const pm = new PhaseManager(gs, { uiManager: { showStatus() {} }, saveCallback: async () => {} });
    pm._getPendingHexCount = () => 0;
    let started = 0;
    pm._onSpellPhaseEntered = () => { started++; };
    return { gs, pm, started: () => started };
}

test('entering a spell window starts spell turns when spells are digital', async () => {
    const { gs, pm, started } = setup(true);
    await pm.advancePhase(true);
    assert.strictEqual(gs.currentPhase.name, 'spell_window_1');
    assert.strictEqual(started(), 1);
});

test('physical spells (spellsActive off) start nothing', async () => {
    const { gs, pm, started } = setup(false);
    await pm.advancePhase(true);
    assert.strictEqual(gs.currentPhase.name, 'spell_window_1');
    assert.strictEqual(started(), 0);
});

test('leaving a spell window does not start spell turns', async () => {
    const { gs, pm, started } = setup(true);
    gs.currentPhase.name = 'spell_window_1';
    await pm.advancePhase(true);
    assert.strictEqual(gs.currentPhase.name, 'hex_placement_2');
    assert.strictEqual(started(), 0);
});
