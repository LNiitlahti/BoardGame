const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
global.BalanceOptimizer = require('../../shared/scripts/balance-optimizer.js');
const SmartMatchGenerator = require('../../shared/scripts/smart-match-generator.js');

function makeGameState(queue = []) {
    const teams = [1, 2, 3, 4, 5].map(t => ({
        id: t,
        name: `Tiimi ${t}`,
        color: '#000000',
        players: [{ id: `p${t}a`, name: `T${t}A` }, { id: `p${t}b`, name: `T${t}B` }]
    }));
    const players = {};
    teams.forEach(t => t.players.forEach(p => { players[p.id] = { id: p.id, name: p.name, teamId: t.id }; }));
    return { teams, players, selectedGames: ['cs2'], gameQueue: queue };
}

// Tiimi 2 + Tiimi 3 + one of Tiimi 1  vs  Tiimi 4 + Tiimi 5 + the other of Tiimi 1
const manualSplitTeam1 = (status = 'completed') => ({
    id: 101, game: 'cs2', playType: '5v5', status,
    teams: [
        { id: 'TEAM_A', playerIds: ['p2a', 'p2b', 'p3a', 'p3b', 'p1a'] },
        { id: 'TEAM_B', playerIds: ['p4a', 'p4b', 'p5a', 'p5b', 'p1b'] }
    ]
});

test('deriveSplitTeamId finds the one team with players on both sides', () => {
    assert.strictEqual(SmartMatchGenerator.deriveSplitTeamId(['2a', '2b', '1a'], ['4a', '4b', '1b']), 1);
    assert.strictEqual(SmartMatchGenerator.deriveSplitTeamId(['2a', '2b'], ['4a', '4b']), null);
});

test('resolveOptimizerIds maps registry playerIds and skips unknown players', () => {
    const gen = new SmartMatchGenerator(makeGameState());
    assert.deepStrictEqual(gen.resolveOptimizerIds({ playerIds: ['p2a', 'p2b', 'ghost'] }), ['2a', '2b']);
});

test('resolveOptimizerIds maps player objects by id or name', () => {
    const gen = new SmartMatchGenerator(makeGameState());
    const side = { players: [{ id: 'p3b', originalTeamId: 3 }, { name: 'T4A', originalTeamId: 4 }, { id: 'nope', originalTeamId: 9 }] };
    assert.deepStrictEqual(gen.resolveOptimizerIds(side), ['3b', '4a']);
});

test('a manual match (no splitTeamId) counts as a split of the team on both sides', () => {
    const gen = new SmartMatchGenerator(makeGameState([manualSplitTeam1()]));
    gen.rebuildFromQueue();
    assert.strictEqual(gen.optimizer.splitCounts[1], 1);
    assert.strictEqual(gen.optimizer.lastSplitMatch[1], 1);
    assert.strictEqual(gen.optimizer.currentMatchNumber, 1);
    assert.strictEqual(gen.optimizer.W['2a']['3a'], 1);
    assert.strictEqual(gen.optimizer.A['2a']['4a'], 1);
});

test('queued (not yet played) matches count too', () => {
    const gen = new SmartMatchGenerator(makeGameState([manualSplitTeam1('pending')]));
    gen.rebuildFromQueue();
    assert.strictEqual(gen.optimizer.splitCounts[1], 1);
});

test('a deleted match no longer counts after the next rebuild', () => {
    const gs = makeGameState([manualSplitTeam1()]);
    const gen = new SmartMatchGenerator(gs);
    gen.rebuildFromQueue();
    gs.gameQueue = [];
    gen.rebuildFromQueue();
    assert.strictEqual(gen.optimizer.splitCounts[1], 0);
    assert.strictEqual(gen.optimizer.currentMatchNumber, 0);
});

test('challenges and breaks are ignored', () => {
    const challenge = { ...manualSplitTeam1(), id: 102, isChallenge: true };
    const brk = { id: 103, isBreak: true, teams: [] };
    const gen = new SmartMatchGenerator(makeGameState([challenge, brk]));
    gen.rebuildFromQueue();
    assert.strictEqual(gen.optimizer.currentMatchNumber, 0);
    assert.strictEqual(gen.optimizer.splitCounts[1], 0);
});

test('a simultaneous 3v3+2v2 pair counts as one set with one split', () => {
    const pairA = {
        id: 201, game: 'aoe4', playType: '3v3', isSimultaneous: true, splitTeamId: 5, status: 'completed',
        teams: [{ playerIds: ['p1a', 'p1b', 'p5a'] }, { playerIds: ['p2a', 'p2b', 'p5b'] }]
    };
    const pairB = {
        id: 202, game: 'aoe4', playType: '2v2', isSimultaneous: true, splitTeamId: null, status: 'completed',
        teams: [{ playerIds: ['p3a', 'p3b'] }, { playerIds: ['p4a', 'p4b'] }]
    };
    const gs = makeGameState([pairA, pairB]);
    gs.selectedGames = ['aoe4'];
    const gen = new SmartMatchGenerator(gs);
    gen.rebuildFromQueue();
    assert.strictEqual(gen.optimizer.currentMatchNumber, 1);
    assert.strictEqual(gen.optimizer.splitCounts[5], 1);
    assert.strictEqual(gen.optimizer.totalMatches['3v3'], 1);
    assert.strictEqual(gen.optimizer.totalMatches['2v2'], 1);
});

test('generateNext never splits the team that was split in the previous match (manual match)', () => {
    // The optimizer breaks ties randomly, so check the property over many runs.
    for (let run = 0; run < 25; run++) {
        const gen = new SmartMatchGenerator(makeGameState([manualSplitTeam1()]));
        const result = gen.generateNext();
        assert.strictEqual(result.error, false);
        assert.notStrictEqual(Number(result.splitTeamId), 1, `run ${run} split Tiimi 1 twice in a row`);
    }
});

test('generateNext has no hidden memory: two calls without queueing start from the same state', () => {
    const gen = new SmartMatchGenerator(makeGameState([manualSplitTeam1()]));
    gen.generateNext();
    const afterFirst = gen.optimizer.currentMatchNumber;
    gen.generateNext();
    assert.strictEqual(gen.optimizer.currentMatchNumber, afterFirst);
});

test('generateNext ignores a stale persisted smartMatchState', () => {
    const gs = makeGameState([]);
    gs.smartMatchState = { optimizer: { splitCounts: { 1: 99, 2: 0, 3: 0, 4: 0, 5: 0 } } };
    const gen = new SmartMatchGenerator(gs);
    gen.rebuildFromQueue();
    assert.strictEqual(gen.optimizer.splitCounts[1], 0);
});

test('previewNext returns N distinct steps and leaves state rebuilt from the queue', () => {
    const gen = new SmartMatchGenerator(makeGameState([manualSplitTeam1()]));
    const previews = gen.previewNext(3);
    assert.strictEqual(previews.length, 3);
    assert.strictEqual(gen.optimizer.currentMatchNumber, 1);
});

test('generateNext still refuses anything other than 5 teams of 2', () => {
    const gs = makeGameState([]);
    gs.teams = gs.teams.slice(0, 4);
    const result = new SmartMatchGenerator(gs).generateNext();
    assert.strictEqual(result.error, true);
});
