/**
 * Coverage for view.html's spell-window slide helpers
 * (docs/superpowers/specs/2026-08-06-view-spell-window-design.md).
 *
 * Same require pattern as display-manager-slot-requirements.test.js: stub
 * global.window, require the plain-script file, read the class back off it.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/display-manager.js');
const DisplayManager = global.window.DisplayManager;

function makeDisplayManager() {
    return new DisplayManager({ container: null, boardModule: null, boardRenderer: null });
}

test('current team is the first in turnOrder not yet completed', () => {
    const dm = makeDisplayManager();
    const data = {
        spellPhase: {
            isActive: true,
            turnOrder: ['t5', 't4', 't3', 't2', 't1'],
            currentTeamIndex: 0,
            teamsCompleted: ['t5', 't4']
        }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), 't3');
});

test('a stale currentTeamIndex does NOT decide the current team', () => {
    // The team.html cast/pass paths never advance currentTeamIndex, so it
    // sits at 0 while teamsCompleted grows. Reading the index would wrongly
    // report t5 as still choosing.
    const dm = makeDisplayManager();
    const data = {
        spellPhase: {
            isActive: true,
            turnOrder: ['t5', 't4'],
            currentTeamIndex: 0,
            teamsCompleted: ['t5']
        }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), 't4');
});

test('numeric team ids in turnOrder match string ids in teamsCompleted', () => {
    const dm = makeDisplayManager();
    const data = {
        spellPhase: { isActive: true, turnOrder: [5, 4, 3], teamsCompleted: ['5', 4] }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), 3);
});

test('returns null when every team has completed', () => {
    const dm = makeDisplayManager();
    const data = {
        spellPhase: { isActive: true, turnOrder: ['t1', 't2'], teamsCompleted: ['t1', 't2'] }
    };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), null);
});

test('returns null when the spell phase is not active', () => {
    const dm = makeDisplayManager();
    const data = { spellPhase: { isActive: false, turnOrder: ['t1'], teamsCompleted: [] } };

    assert.strictEqual(dm._spellWindowCurrentTeamId(data), null);
});

test('returns null when there is no spellPhase at all', () => {
    const dm = makeDisplayManager();

    assert.strictEqual(dm._spellWindowCurrentTeamId({}), null);
});

test('spellHistory entries from before this window are excluded', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_2', startedAt: '2026-08-06T12:00:00.000Z' },
        spellHistory: [
            { timestamp: '2026-08-06T11:00:00.000Z', spellName: 'Old Spell', teamId: 't1', teamName: 'Tiimi 1' },
            { timestamp: '2026-08-06T12:05:00.000Z', spellName: 'New Spell', teamId: 't2', teamName: 'Tiimi 2' }
        ]
    };

    const casts = dm._collectSpellWindowCasts(data);

    assert.strictEqual(casts.length, 1);
    assert.strictEqual(casts[0].spellName, 'New Spell');
});

test('manual spellWindowLog entries are merged in and sorted by time', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_2', startedAt: '2026-08-06T12:00:00.000Z' },
        spellHistory: [
            { timestamp: '2026-08-06T12:06:00.000Z', spellName: 'In-App Cast', teamId: 't2', teamName: 'Tiimi 2' }
        ],
        spellWindowLog: [
            { id: 'sl_1', addedAt: '2026-08-06T12:03:00.000Z', spellName: 'Table Cast', teamId: 't1', teamName: 'Tiimi 1' }
        ]
    };

    const casts = dm._collectSpellWindowCasts(data);

    assert.deepStrictEqual(casts.map(c => c.spellName), ['Table Cast', 'In-App Cast']);
    assert.deepStrictEqual(casts.map(c => c.teamId), ['t1', 't2']);
});

test('with no startedAt, spellHistory is excluded entirely but the manual log survives', () => {
    // Without a window boundary there is no way to tell this window's casts
    // from the whole tournament's, so the cumulative source is dropped
    // rather than dumping every spell ever cast onto the room display.
    // spellWindowLog is per-window by construction, so it is always safe.
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { name: 'spell_window_2' },
        spellHistory: [{ timestamp: '2026-08-06T12:05:00.000Z', spellName: 'Unbounded', teamId: 't1' }],
        spellWindowLog: [{ id: 'sl_1', addedAt: '2026-08-06T12:03:00.000Z', spellName: 'Table Cast', teamId: 't1' }]
    };

    assert.deepStrictEqual(dm._collectSpellWindowCasts(data).map(c => c.spellName), ['Table Cast']);
});

test('falls back to spellId when a history entry has no spellName', () => {
    const dm = makeDisplayManager();
    const data = {
        currentPhase: { startedAt: '2026-08-06T12:00:00.000Z' },
        spellHistory: [{ timestamp: '2026-08-06T12:05:00.000Z', spellId: 'spell_fireball', teamId: 't1' }]
    };

    assert.strictEqual(dm._collectSpellWindowCasts(data)[0].spellName, 'spell_fireball');
});

test('returns an empty array when neither source has anything', () => {
    const dm = makeDisplayManager();

    assert.deepStrictEqual(dm._collectSpellWindowCasts({ currentPhase: {} }), []);
});
