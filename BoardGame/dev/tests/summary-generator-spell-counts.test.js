/**
 * Coverage for SummaryGenerator's spell counting.
 *
 * Two action types record a spell being used: spell_cast (god.html's digital
 * casting flow) and spell_used_manual (admin.html's spell-log bar, finalized
 * into the action log by PhaseManager._clearSpellPhaseState() when the spell
 * window closes). Spells are physical-at-the-table by default, so a summary
 * that only counts spell_cast reports 0 spells for every admin-run
 * tournament — that was the shipped behaviour until 2026-08.
 *
 * Same require pattern as the other browser-script tests: stub
 * global.window, require the file, read the class back off window.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || { location: { search: '' } };
require('../../full/scripts/summary-generator.js');
const SummaryGenerator = global.window.SummaryGenerator;

const FINAL_STATE = {
    teams: [
        { id: 1, name: 'Tiimi 1', points: 10 },
        { id: 2, name: 'Tiimi 2', points: 5 }
    ],
    currentPhase: { name: 'matches_in_progress', roundNumber: 2 }
};

test('team stats count manual spell-log entries alongside digital casts', () => {
    const gen = new SummaryGenerator({
        actions: [
            { sequenceNumber: 1, actionType: 'spell_cast', roundNumber: 1, payload: { teamId: 1, spellId: 'fireball' } },
            { sequenceNumber: 2, actionType: 'spell_used_manual', roundNumber: 1, payload: { teamId: '1', spellName: 'Frost Nova', roundNumber: 1 } },
            { sequenceNumber: 3, actionType: 'spell_used_manual', roundNumber: 1, payload: { teamId: '2', spellName: 'Haste', roundNumber: 1 } }
        ],
        backups: [],
        finalState: FINAL_STATE
    });

    const stats = gen.generate().teamStats;
    const team1 = stats.find(t => t.id === 1);
    const team2 = stats.find(t => t.id === 2);
    assert.strictEqual(team1.spellsCast, 2);
    assert.strictEqual(team2.spellsCast, 1);
});

test('undone spell entries are excluded from team spell counts', () => {
    const gen = new SummaryGenerator({
        actions: [
            { sequenceNumber: 1, actionType: 'spell_used_manual', roundNumber: 1, payload: { teamId: '1', spellName: 'Haste', roundNumber: 1 } },
            { sequenceNumber: 2, actionType: 'spell_used_manual', roundNumber: 1, undone: true, payload: { teamId: '1', spellName: 'Oops', roundNumber: 1 } }
        ],
        backups: [],
        finalState: FINAL_STATE
    });

    const team1 = gen.generate().teamStats.find(t => t.id === 1);
    assert.strictEqual(team1.spellsCast, 1);
});

test('round summaries attribute manual entries by payload round, not stamp round', () => {
    const gen = new SummaryGenerator({
        actions: [
            // Digital cast, logged in the moment — stamp round is correct.
            { sequenceNumber: 1, actionType: 'spell_cast', roundNumber: 1, payload: { teamId: 1 } },
            // Manual entry finalized late via setPhaseDirect: stamped round 2,
            // but the window it belongs to was round 1 (payload.roundNumber).
            { sequenceNumber: 2, actionType: 'spell_used_manual', roundNumber: 2, payload: { teamId: '2', spellName: 'Haste', roundNumber: 1 } }
        ],
        backups: [],
        finalState: FINAL_STATE
    });

    const rounds = gen.generate().roundSummaries;
    assert.strictEqual(rounds.find(r => r.round === 1).spellsCast, 2);
    assert.strictEqual(rounds.find(r => r.round === 2).spellsCast, 0);
});

test('manual entry without payload round falls back to the stamp round', () => {
    const gen = new SummaryGenerator({
        actions: [
            { sequenceNumber: 1, actionType: 'spell_used_manual', roundNumber: 2, payload: { teamId: '1', spellName: 'Haste' } }
        ],
        backups: [],
        finalState: FINAL_STATE
    });

    const rounds = gen.generate().roundSummaries;
    assert.strictEqual(rounds.find(r => r.round === 1).spellsCast, 0);
    assert.strictEqual(rounds.find(r => r.round === 2).spellsCast, 1);
});
