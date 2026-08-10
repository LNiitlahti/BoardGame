/**
 * Coverage for display-manager.js's _dualSlotLayout(), which decides whether
 * view.html's matches_in_progress screen shows two equal match panels or
 * expands one of them to fill the display.
 *
 * The rule: a slot is "active" while its sub-state is anything other than
 * 'done'. Exactly one active slot => focus mode (that slot takes the room,
 * the finished one shrinks to a results column). Zero or two => the normal
 * 50/50 dual layout.
 *
 * Requested by Inffi in the 2026-08-05 Discord thread: "when a match is
 * queued up to be played live, it should expand to take up as much of the
 * screen as possible."
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

test('both slots live => dual layout, no focus', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'playing', 2: 'lobby' }),
        { mode: 'dual', focusSlot: null }
    );
});

test('slot 1 done while slot 2 plays => slot 2 gets focus', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'done', 2: 'playing' }),
        { mode: 'focus', focusSlot: 2 }
    );
});

test('slot 2 done while slot 1 is still in setup => slot 1 gets focus', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'setup', 2: 'done' }),
        { mode: 'focus', focusSlot: 1 }
    );
});

test('both slots done => dual layout (two results columns, neither is "live")', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout({ 1: 'done', 2: 'done' }),
        { mode: 'dual', focusSlot: null }
    );
});

test('missing slots map defaults both slots to setup => dual layout, no crash', () => {
    const dm = makeDisplayManager();
    assert.deepStrictEqual(
        dm._dualSlotLayout(undefined),
        { mode: 'dual', focusSlot: null }
    );
});

test('Firestore string keys behave the same as numeric ones', () => {
    const dm = makeDisplayManager();
    // Firestore hands back {'1': 'done', '2': 'playing'}; the lookup must
    // not care which form it got.
    assert.deepStrictEqual(
        dm._dualSlotLayout({ '1': 'done', '2': 'playing' }),
        { mode: 'focus', focusSlot: 2 }
    );
});
