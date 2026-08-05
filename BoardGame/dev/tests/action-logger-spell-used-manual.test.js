/**
 * Regression coverage for ActionLogger.describeAction()'s spell_used_manual
 * case (docs/superpowers/specs/2026-08-05-manual-spell-log-design.md).
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../../full/scripts/action-logger.js');
const ActionLogger = global.window.ActionLogger;

function makeGameState(teams = []) {
    return { teams };
}

test('describeAction formats spell_used_manual with team name and round', () => {
    const gameState = makeGameState([{ id: 't1', name: 'Red Team' }]);
    const entry = {
        actionType: 'spell_used_manual',
        payload: { teamId: 't1', teamName: 'Red Team', spellName: 'Fireball', roundNumber: 4 }
    };

    const text = ActionLogger.describeAction(entry, gameState);

    assert.strictEqual(text, 'Red Team used "Fireball" (Round 4)');
});

test('describeAction omits the round suffix when roundNumber is absent', () => {
    const gameState = makeGameState();
    const entry = {
        actionType: 'spell_used_manual',
        payload: { teamId: 't1', teamName: 'Red Team', spellName: 'Shield' }
    };

    const text = ActionLogger.describeAction(entry, gameState);

    assert.strictEqual(text, 'Red Team used "Shield"');
});
