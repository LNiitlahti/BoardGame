/**
 * Pure helpers behind view.html's "frame" layout (spec:
 * docs/superpowers/specs/2026-11-19-view-frame-design.md):
 *   _frameSceneFor(mode)       which region layout a display mode uses
 *   _buildNowLine(data)        the header's "who acts now" sentence
 *   _buildUpNextModel(data)    queue rows + the spell-window divider
 *   _broadcastDockDelay(...)   arrive -> docked timing from sentAt
 *
 * Same require pattern as the other display-manager tests.
 */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
require('../../full/scripts/display-manager.js');
const DisplayManager = global.window.DisplayManager;

function dm(data) {
    const d = new DisplayManager({ container: null, boardModule: null, boardRenderer: null });
    d._gameData = data || null;
    return d;
}

const teams = [
    { id: 1, name: 'Tiimi 1', color: '#de392c', points: 5, players: [{ id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }] },
    { id: 2, name: 'Tiimi 2', color: '#2278a3', points: 3, players: [{ id: 'b1', name: 'B1' }, { id: 'b2', name: 'B2' }] }
];
const players = {
    a1: { name: 'A1', teamId: 1, uid: 'ua1' }, a2: { name: 'A2', teamId: 1, uid: 'ua2' },
    b1: { name: 'B1', teamId: 2, uid: 'ub1' }, b2: { name: 'B2', teamId: 2, uid: 'ub2' }
};
const match = (n, extra) => Object.assign({
    id: 'm' + n, matchNumber: n, game: 'aoe4', status: 'pending', playType: '2v2',
    teams: [{ id: 1, playerIds: ['a1', 'a2'] }, { id: 2, playerIds: ['b1', 'b2'] }]
}, extra);

// ── _frameSceneFor ───────────────────────────────────────────────

test('scene: no slide and board_focus phases use the board scene', () => {
    const d = dm();
    assert.strictEqual(d._frameSceneFor(null), 'board');
    assert.strictEqual(d._frameSceneFor('hex_placement_1'), 'board');
    assert.strictEqual(d._frameSceneFor('challenges'), 'board');
    assert.strictEqual(d._frameSceneFor('scoring_hex'), 'board');
    assert.strictEqual(d._frameSceneFor('board_resolved'), 'board');
});

test('scene: matches, challenge game, results and standings use the match scene', () => {
    const d = dm();
    for (const m of ['matches_in_progress', 'challenge_game', 'scoring_vp', 'round_advance', 'standings']) {
        assert.strictEqual(d._frameSceneFor(m), 'match', m);
    }
});

test('scene: spell windows, break and winner stay full-screen', () => {
    const d = dm();
    for (const m of ['spell_window_1', 'spell_window_4', 'break', 'tournament_end']) {
        assert.strictEqual(d._frameSceneFor(m), 'full', m);
    }
});

test('scene: unknown mode falls back to the board scene', () => {
    assert.strictEqual(dm()._frameSceneFor('nonsense'), 'board');
});

// ── _buildNowLine ────────────────────────────────────────────────

test('now line: hex placement names the first pending team for that slot', () => {
    const data = {
        teams, players,
        currentPhase: { name: 'hex_placement_2', roundNumber: 3 },
        pendingHexWins: [
            { teamIds: [1], slot: 1, matchNumber: 4 },
            { teamIds: [2], slot: 2, matchNumber: 5 }
        ]
    };
    const line = dm(data)._buildNowLine(data);
    assert.deepStrictEqual(line, { text: '{team} places a hex', teamId: 2 });
});

test('now line: hex placement with nothing pending says all placed', () => {
    const data = { teams, currentPhase: { name: 'hex_placement_1' }, pendingHexWins: [] };
    assert.strictEqual(dm(data)._buildNowLine(data).text, 'All hexes placed');
});

test('now line: lobby counts players not ready on both game lobby and Discord', () => {
    const data = {
        teams, players,
        currentPhase: { name: 'matches_in_progress', roundNumber: 2, slots: { 1: 'lobby', 2: 'setup' } },
        gameQueue: [match(7, { slot: 1, roundNumber: 2 }), match(8, { slot: 2, roundNumber: 2 })],
        lobbyReady: { ua1: { gameLobby: true, discord: true }, ua2: { gameLobby: true }, ub1: { ready: true } }
    };
    assert.strictEqual(dm(data)._buildNowLine(data).text,
        'Match 1 waiting for 2 players · Match 2 being set up');
});

test('now line: one player missing uses the singular', () => {
    const data = {
        teams, players,
        currentPhase: { name: 'matches_in_progress', roundNumber: 2, slots: { 1: 'lobby', 2: 'done' } },
        gameQueue: [match(7, { slot: 1, roundNumber: 2 })],
        lobbyReady: { ua1: { ready: true }, ua2: { ready: true }, ub1: { ready: true } }
    };
    assert.strictEqual(dm(data)._buildNowLine(data).text, 'Match 1 waiting for 1 player');
});

test('now line: both slots done', () => {
    const data = { teams, currentPhase: { name: 'matches_in_progress', slots: { 1: 'done', 2: 'done' } }, gameQueue: [] };
    assert.strictEqual(dm(data)._buildNowLine(data).text, 'Matches complete');
});

test('now line: playing slot reads live', () => {
    const data = { teams, currentPhase: { name: 'matches_in_progress', slots: { 1: 'playing', 2: 'done' } }, gameQueue: [] };
    assert.strictEqual(dm(data)._buildNowLine(data).text, 'Match 1 live');
});

test('now line: challenge lobby counts unready challenge players', () => {
    const data = {
        teams, players,
        currentPhase: { name: 'challenge_game', challengeLobbyState: 'lobby' },
        gameQueue: [match(9, { isChallenge: true })],
        lobbyReady: {}
    };
    assert.strictEqual(dm(data)._buildNowLine(data).text, 'Challenge: waiting for 4 players');
});

test('now line: fixed phrases for the other phases', () => {
    const cases = {
        pre_game_setup: 'Tournament starts soon',
        scoring_vp: 'Scoring victory points',
        scoring_hex: 'Scoring heart hexes',
        spell_window_3: 'Spell window open: gather at the board',
        challenges: 'Teams may challenge heart hexes',
        board_resolved: 'Board resolved: admin is checking',
        round_advance: 'Round complete',
        break: 'On break',
        tournament_end: 'Tournament over'
    };
    for (const [phase, text] of Object.entries(cases)) {
        const data = { teams, currentPhase: { name: phase } };
        assert.strictEqual(dm(data)._buildNowLine(data).text, text, phase);
    }
});

test('now line: no phase is empty', () => {
    const data = { teams, currentPhase: { name: null } };
    assert.strictEqual(dm(data)._buildNowLine(data).text, '');
});

// ── _buildUpNextModel ────────────────────────────────────────────

test('up next: skips ongoing and completed, keeps queue order, first is next', () => {
    const data = { teams, players, gameQueue: [
        match(1, { status: 'completed' }), match(2, { status: 'ongoing' }), match(3), match(4)
    ] };
    const model = dm(data)._buildUpNextModel(data);
    assert.deepStrictEqual(model.rows.map(r => r.match && r.match.matchNumber), [3, 4]);
    assert.strictEqual(model.rows[0].isNext, true);
    assert.strictEqual(model.rows[1].isNext, false);
    assert.strictEqual(model.more, 0);
});

test('up next: divider before the first match of a later round', () => {
    const data = { teams, players, gameQueue: [
        match(3, { roundNumber: 2, slot: 1 }), match(4, { roundNumber: 2, slot: 2 }), match(5, { roundNumber: 3, slot: 1 })
    ] };
    const kinds = dm(data)._buildUpNextModel(data).rows.map(r => r.kind);
    assert.deepStrictEqual(kinds, ['match', 'match', 'divider', 'match']);
});

test('up next: no divider when rounds are untagged', () => {
    const data = { teams, players, gameQueue: [match(3), match(4)] };
    const kinds = dm(data)._buildUpNextModel(data).rows.map(r => r.kind);
    assert.deepStrictEqual(kinds, ['match', 'match']);
});

test('up next: at most 4 matches, the rest counted as more', () => {
    const data = { teams, players, gameQueue: [1, 2, 3, 4, 5, 6].map(n => match(n)) };
    const model = dm(data)._buildUpNextModel(data);
    assert.strictEqual(model.rows.filter(r => r.kind === 'match').length, 4);
    assert.strictEqual(model.more, 2);
});

test('up next: breaks are their own row and do not count toward the 4', () => {
    const data = { teams, players, gameQueue: [match(1), { id: 'b', isBreak: true, breakLabel: 'Pizza' }, match(2), match(3), match(4)] };
    const model = dm(data)._buildUpNextModel(data);
    assert.deepStrictEqual(model.rows.map(r => r.kind), ['match', 'break', 'match', 'match', 'match']);
    assert.strictEqual(model.more, 0);
});

// ── _broadcastDockDelay ──────────────────────────────────────────

test('broadcast: fresh message arrives for the remaining part of 10 s', () => {
    const now = Date.parse('2026-11-19T20:00:04.000Z');
    assert.strictEqual(dm()._broadcastDockDelay('2026-11-19T20:00:00.000Z', now), 6000);
});

test('broadcast: an old message docks immediately', () => {
    const now = Date.parse('2026-11-19T20:05:00.000Z');
    assert.strictEqual(dm()._broadcastDockDelay('2026-11-19T20:00:00.000Z', now), 0);
});

test('broadcast: missing or bad sentAt gets the full arrival', () => {
    assert.strictEqual(dm()._broadcastDockDelay(undefined, Date.now()), 10000);
    assert.strictEqual(dm()._broadcastDockDelay('garbage', Date.now()), 10000);
});

test('broadcast: a sentAt in the future (clock skew) is capped at 10 s', () => {
    const now = Date.parse('2026-11-19T20:00:00.000Z');
    assert.strictEqual(dm()._broadcastDockDelay('2026-11-19T20:01:00.000Z', now), 10000);
});
