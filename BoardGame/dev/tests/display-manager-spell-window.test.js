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
