/**
 * Shared-player rule for match slots.
 *
 * With 5 teams x 2 players every normal match (5v5 or a 3v3+2v2 pair) uses
 * all ten players, so Match 1 and Match 2 share everyone and must run one
 * after the other. Rule: a slot can open its lobby only when none of its
 * players is in another slot's lobby/playing stage or in a live match.
 * Slots with disjoint players still run in parallel.
 *
 * Also covers PhaseManager.matchPlayerIds(), which must read BOTH stored
 * shapes: `playerIds` (manual/imported) and `players` objects
 * (auto-generated) — the live-conflict check used to miss the latter.
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

const ALL = ['p1a', 'p1b', 'p2a', 'p2b', 'p3a', 'p3b', 'p4a', 'p4b', 'p5a', 'p5b'];

function makePM(gameState) {
    return new PhaseManager(gameState, {
        uiManager: { showStatus() {} },
        saveCallback: async () => {}
    });
}

// Manual shape: playerIds
const manual = (id, slot, status, a, b) => ({
    id, slot, roundNumber: 3, status, game: 'cs2', playType: '5v5',
    teams: [{ id: 'TEAM_A', playerIds: a }, { id: 'TEAM_B', playerIds: b }]
});
// Auto-generated shape: players objects
const auto = (id, slot, status, a, b, extra = {}) => ({
    id, slot, roundNumber: 3, status, game: 'cs2', playType: '5v5', ...extra,
    teams: [{ id: 'TEAM_A', players: a.map(pid => ({ id: pid })) }, { id: 'TEAM_B', players: b.map(pid => ({ id: pid })) }]
});

function state(slots, queue) {
    return {
        status: 'playing',
        currentPhase: { name: 'matches_in_progress', roundNumber: 3, startedAt: '2026-11-19T10:00:00.000Z', slots },
        teams: [], players: {}, gameQueue: queue
    };
}

test('matchPlayerIds reads playerIds and players objects', () => {
    assert.deepStrictEqual([...PhaseManager.matchPlayerIds(manual(1, 1, 'pending', ['p1a'], ['p2a']))].sort(), ['p1a', 'p2a']);
    assert.deepStrictEqual([...PhaseManager.matchPlayerIds(auto(2, 1, 'pending', ['p3a'], ['p4b']))].sort(), ['p3a', 'p4b']);
    assert.strictEqual(PhaseManager.matchPlayerIds({ id: 3, isBreak: true, teams: [] }).size, 0);
});

test('Match 2 cannot open its lobby while Match 1 (same players) is playing', async () => {
    const gs = state({ 1: 'playing', 2: 'setup' }, [
        auto(1, 1, 'ongoing', ALL.slice(0, 5), ALL.slice(5)),
        auto(2, 2, 'pending', ALL.slice(0, 5), ALL.slice(5))
    ]);
    const pm = makePM(gs);
    const reqs = pm.getSlotRequirements(2);
    assert.ok(reqs.some(r => !r.met && /Match 1/.test(r.label)), JSON.stringify(reqs));
    assert.strictEqual(await pm.advanceSlot(2), false);
    assert.strictEqual(gs.currentPhase.slots[2], 'setup');
});

test('Match 2 also waits while Match 1 is only in its lobby', () => {
    const gs = state({ 1: 'lobby', 2: 'setup' }, [
        manual(1, 1, 'pending', ALL.slice(0, 5), ALL.slice(5)),
        manual(2, 2, 'pending', ALL.slice(0, 5), ALL.slice(5))
    ]);
    assert.strictEqual(makePM(gs).getSlotPlayerConflicts(2).length, 1);
});

test('once Match 1 is done, Match 2 can open its lobby', async () => {
    const gs = state({ 1: 'done', 2: 'setup' }, [
        auto(1, 1, 'completed', ALL.slice(0, 5), ALL.slice(5)),
        auto(2, 2, 'pending', ALL.slice(0, 5), ALL.slice(5))
    ]);
    const pm = makePM(gs);
    assert.deepStrictEqual(pm.getSlotPlayerConflicts(2), []);
    assert.strictEqual(await pm.advanceSlot(2), true);
    assert.strictEqual(gs.currentPhase.slots[2], 'lobby');
});

test('slots with no shared players still run in parallel', () => {
    const gs = state({ 1: 'playing', 2: 'setup' }, [
        manual(1, 1, 'ongoing', ['p1a', 'p2a'], ['p3a', 'p4a']),
        manual(2, 2, 'pending', ['p1b', 'p2b'], ['p3b', 'p4b'])
    ]);
    const pm = makePM(gs);
    assert.deepStrictEqual(pm.getSlotPlayerConflicts(2), []);
    assert.ok(pm.getSlotRequirements(2).every(r => r.met));
});

test('a 3v3+2v2 pair in Match 1 blocks a 3v3+2v2 pair in Match 2 until done', () => {
    const pair = (ids, slot, status) => [
        auto(ids[0], slot, status, ['p1a', 'p1b', 'p5a'], ['p2a', 'p2b', 'p5b'], { playType: '3v3', isSimultaneous: true, game: 'aoe4' }),
        auto(ids[1], slot, status, ['p3a', 'p3b'], ['p4a', 'p4b'], { playType: '2v2', isSimultaneous: true, game: 'aoe4' })
    ];
    const gs = state({ 1: 'playing', 2: 'setup' }, [...pair([1, 2], 1, 'ongoing'), ...pair([3, 4], 2, 'pending')]);
    assert.strictEqual(makePM(gs).getSlotPlayerConflicts(2).length, 1);
});

test('force still opens the lobby (explicit admin override)', async () => {
    const gs = state({ 1: 'playing', 2: 'setup' }, [
        auto(1, 1, 'ongoing', ALL.slice(0, 5), ALL.slice(5)),
        auto(2, 2, 'pending', ALL.slice(0, 5), ALL.slice(5))
    ]);
    assert.strictEqual(await makePM(gs).advanceSlot(2, true), true);
    assert.strictEqual(gs.currentPhase.slots[2], 'lobby');
});

test('both slots in setup do not block each other', () => {
    const gs = state({ 1: 'setup', 2: 'setup' }, [
        manual(1, 1, 'pending', ALL.slice(0, 5), ALL.slice(5)),
        manual(2, 2, 'pending', ALL.slice(0, 5), ALL.slice(5))
    ]);
    const pm = makePM(gs);
    assert.deepStrictEqual(pm.getSlotPlayerConflicts(1), []);
    assert.deepStrictEqual(pm.getSlotPlayerConflicts(2), []);
});
