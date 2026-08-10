/**
 * Unit coverage for shared/scripts/drink-counter.js — the pure derivations
 * behind the LAN drink counter (team.html button, view.html break-screen
 * leaderboard, statistics.html post-tournament report).
 *
 * Deliberately drink-GENERIC: a soft drink and a beer, summed into one
 * "drinks" total. Per the 2026-08-05 developer note this is not an
 * alcohol-specific feature, and it never touches scoring.
 */
const test = require('node:test');
const assert = require('node:assert');

const DrinkCounter = require('../../shared/scripts/drink-counter.js');

const GAME_DATA = {
    teams: [
        {
            id: 1, name: 'Tiimi 1', color: '#de392c',
            players: [
                { id: 'p_aaa', uid: 'uid_aaa', name: 'Wustra' },
                { id: 'p_bbb', uid: 'uid_bbb', name: 'Touch' }
            ]
        },
        {
            id: 2, name: 'Tiimi 2', color: '#2278a3',
            players: [{ id: 'p_ccc', uid: 'uid_ccc', name: 'Inffi' }]
        }
    ],
    players: {
        p_aaa: { uid: 'uid_aaa', name: 'Wustra', teamId: 1 },
        p_bbb: { uid: 'uid_bbb', name: 'Touch', teamId: 1 },
        p_ccc: { uid: 'uid_ccc', name: 'Inffi', teamId: 2 }
    },
    drinkCounts: {
        uid_aaa: { soft: 2, beer: 5 },
        uid_bbb: { soft: 4, beer: 0 },
        uid_ccc: { beer: 1 }
    },
    gameQueue: [
        {
            id: 'm1', status: 'completed', winnerIndex: 0,
            teams: [{ playerIds: ['p_aaa'] }, { playerIds: ['p_ccc'] }]
        },
        {
            id: 'm2', status: 'completed', winnerIndex: 1,
            teams: [{ playerIds: ['p_aaa'] }, { playerIds: ['p_bbb'] }]
        },
        // Not finished — must not count toward anyone's played/won.
        {
            id: 'm3', status: 'ongoing',
            teams: [{ playerIds: ['p_aaa'] }, { playerIds: ['p_ccc'] }]
        }
    ]
};

// ---------- totalFor ----------

test('totalFor sums every drink type', () => {
    assert.strictEqual(DrinkCounter.totalFor({ soft: 2, beer: 5 }), 7);
});

test('totalFor treats a missing type as zero', () => {
    assert.strictEqual(DrinkCounter.totalFor({ beer: 3 }), 3);
});

test('totalFor on a missing or empty entry is zero, not NaN', () => {
    assert.strictEqual(DrinkCounter.totalFor(undefined), 0);
    assert.strictEqual(DrinkCounter.totalFor({}), 0);
});

// ---------- buildDrinkLeaderboard ----------

test('buildDrinkLeaderboard ranks by total, descending, with name and team colour', () => {
    const board = DrinkCounter.buildDrinkLeaderboard(GAME_DATA);
    assert.deepStrictEqual(
        board.map(r => [r.name, r.total]),
        [['Wustra', 7], ['Touch', 4], ['Inffi', 1]]
    );
    assert.strictEqual(board[0].color, '#de392c');
    assert.strictEqual(board[2].color, '#2278a3');
});

test('buildDrinkLeaderboard honours its limit', () => {
    const board = DrinkCounter.buildDrinkLeaderboard(GAME_DATA, 2);
    assert.strictEqual(board.length, 2);
    assert.strictEqual(board[0].name, 'Wustra');
});

test('buildDrinkLeaderboard skips players with no drinks logged', () => {
    const data = { ...GAME_DATA, drinkCounts: { uid_aaa: { beer: 1 } } };
    const board = DrinkCounter.buildDrinkLeaderboard(data);
    assert.strictEqual(board.length, 1);
    assert.strictEqual(board[0].name, 'Wustra');
});

test('buildDrinkLeaderboard on a tournament with no drinkCounts returns an empty list', () => {
    assert.deepStrictEqual(DrinkCounter.buildDrinkLeaderboard({ teams: [] }), []);
    assert.deepStrictEqual(DrinkCounter.buildDrinkLeaderboard(null), []);
});

test('buildDrinkLeaderboard ignores counts for a uid that is not on any roster', () => {
    // A god/admin tapping the button, or a player removed from the roster
    // after logging. Nothing to attribute it to, so it is dropped.
    const data = { ...GAME_DATA, drinkCounts: { uid_ghost: { beer: 99 }, uid_ccc: { beer: 1 } } };
    const board = DrinkCounter.buildDrinkLeaderboard(data);
    assert.deepStrictEqual(board.map(r => r.name), ['Inffi']);
});

// ---------- buildDrinkPerformanceReport ----------

test('buildDrinkPerformanceReport pairs drinks with completed-match record', () => {
    const report = DrinkCounter.buildDrinkPerformanceReport(GAME_DATA);
    const wustra = report.find(r => r.name === 'Wustra');

    assert.strictEqual(wustra.drinks, 7);
    assert.strictEqual(wustra.played, 2, 'the ongoing match must not count as played');
    assert.strictEqual(wustra.wons, 1, 'won m1 (winnerIndex 0), lost m2 (winnerIndex 1)');
    assert.strictEqual(wustra.winRate, 50);
});

test('buildDrinkPerformanceReport includes players who logged nothing', () => {
    // The report is the whole roster — "drank nothing and won everything" is
    // exactly the kind of row that makes the correlation readable.
    const data = { ...GAME_DATA, drinkCounts: {} };
    const report = DrinkCounter.buildDrinkPerformanceReport(data);
    assert.strictEqual(report.length, 3);
    assert.ok(report.every(r => r.drinks === 0));
});

test('buildDrinkPerformanceReport gives a player with no completed matches a null win rate', () => {
    const data = { ...GAME_DATA, gameQueue: [] };
    const report = DrinkCounter.buildDrinkPerformanceReport(data);
    assert.ok(report.every(r => r.played === 0));
    assert.ok(report.every(r => r.winRate === null), 'no matches played means no win rate, not 0%');
});
