/**
 * Regression coverage for display-manager.js's _matchBelongsToSlot(), which
 * decides which queue entries render under the Match 1 / Match 2 panels on
 * view.html's matches_dual_slot slide.
 *
 * Until this fix, untagged queue entries (created via a path that bypasses
 * the phase manager's slot tagging — e.g. the queue's own ▶ start buttons)
 * counted as belonging to BOTH slots unconditionally, with no gate at all.
 * That's fine while both slots are open, but once one slot reaches 'done'
 * its panel stops rendering pending/ongoing entries while the OTHER slot's
 * panel keeps pulling in the entire untagged backlog — exactly the "Match 2
 * has a pile of unrelated games" bug this test guards against.
 *
 * The fix mirrors phase-manager.js's getSlotRequirements / admin-improved-
 * adapter.js's _belongsToCurrentSlot: untagged entries only count for
 * either slot if created at/after the current matches_in_progress phase
 * began (see phase-manager-slot-requirements.test.js for the identical
 * policy under test on the admin/phase-manager side).
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

test('an untagged match created this round belongs to BOTH slots', () => {
    const dm = makeDisplayManager();
    const match = { id: 'untagged-1', status: 'pending', createdAt: 2_000_000 };

    assert.strictEqual(dm._matchBelongsToSlot(match, 1, 42, 1_000_000), true);
    assert.strictEqual(dm._matchBelongsToSlot(match, 2, 42, 1_000_000), true);
});

test('a stale untagged match (created before the current phase started) belongs to NEITHER slot', () => {
    const dm = makeDisplayManager();
    const match = { id: 'stale-untagged', status: 'pending', createdAt: 500 };

    assert.strictEqual(dm._matchBelongsToSlot(match, 1, 42, 1_000_000), false);
    assert.strictEqual(dm._matchBelongsToSlot(match, 2, 42, 1_000_000), false);
});

test('an untagged match with no createdAt or phaseStartedAt belongs to neither slot (no crash)', () => {
    const dm = makeDisplayManager();
    assert.strictEqual(dm._matchBelongsToSlot({ id: 'no-createdAt' }, 1, 42, 1_000_000), false);
    assert.strictEqual(dm._matchBelongsToSlot({ id: 'no-phaseStartedAt', createdAt: 2_000_000 }, 1, 42, undefined), false);
});

test('a correctly slot-tagged match still belongs only to its own slot', () => {
    const dm = makeDisplayManager();
    const match = { id: 'tagged-slot-1', status: 'pending', createdAt: 2_000_000, slot: 1, roundNumber: 42 };

    assert.strictEqual(dm._matchBelongsToSlot(match, 1, 42, 1_000_000), true);
    assert.strictEqual(dm._matchBelongsToSlot(match, 2, 42, 1_000_000), false);
});

test('a slot-tagged match from a stale prior round does not belong to the current round\'s slot', () => {
    const dm = makeDisplayManager();
    const match = { id: 'stale-round', status: 'pending', createdAt: 500, slot: 2, roundNumber: 1 };

    assert.strictEqual(dm._matchBelongsToSlot(match, 2, 42, 1_000_000), false);
});

test('break and challenge entries never belong to a numbered slot', () => {
    const dm = makeDisplayManager();
    assert.strictEqual(dm._matchBelongsToSlot({ id: 'b', isBreak: true, createdAt: 2_000_000 }, 1, 42, 1_000_000), false);
    assert.strictEqual(dm._matchBelongsToSlot({ id: 'c', isChallenge: true, createdAt: 2_000_000 }, 1, 42, 1_000_000), false);
});
