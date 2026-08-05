/**
 * Unit coverage for the single heart-income calculation in board-module.js.
 *
 * Heart income used to be `value × matchesPlayedInRound`, written out in four
 * separate files. That multiplier made the Mountain Heart pay +4 a round while
 * the constant at the call site read `2`, and the four copies could drift.
 * Both are gone: the values live in HEART_INCOME, the calculation lives in
 * calculateHeartIncome(), and the match count is now only a yes/no gate.
 *
 * See docs/architecture/scoring.md.
 */
const test = require('node:test');
const assert = require('node:assert');

const BoardModule = require('../../shared/scripts/board-module.js');
const { calculateHeartIncome, HEART_INCOME } = require('../../shared/scripts/board-module.js');

const boardModule = new BoardModule();

// q0r0 is the mountain heart; q-4r2 and q2r2 are side hearts; q3r0 is normal.
function makeState(overrides = {}) {
    return {
        teams: [{ id: 1, name: 'Ravens' }, { id: 2, name: 'Wolves' }],
        heartHexControl: {},
        gameQueue: [],
        gameHistory: [
            { roundNumber: 3 },
            { roundNumber: 3 }
        ],
        currentPhase: { name: 'scoring_hex', roundNumber: 4 },
        ...overrides
    };
}

test('mountain heart pays +2 for the round, NOT +2 per match', () => {
    const gs = makeState({ heartHexControl: { q0r0: 1 } });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.matchesPlayed, 2, 'the round had two matches');
    assert.strictEqual(result.byTeam[1].points, 2,
        'flat +2 — a x2 here is the multiplier regression');
    assert.strictEqual(result.byTeam[1].mountainCount, 1);
    assert.strictEqual(result.byTeam[2].points, 0);
});

test('side heart pays +1 for the round regardless of match count', () => {
    const gs = makeState({ heartHexControl: { 'q-4r2': 1 } });
    assert.strictEqual(calculateHeartIncome(gs, boardModule, 3).byTeam[1].points, 1);
});

test('a mixed holding sums flat values and reports both counts', () => {
    const gs = makeState({ heartHexControl: { q0r0: 1, 'q-4r2': 1, q2r2: 1 } });
    const entry = calculateHeartIncome(gs, boardModule, 3).byTeam[1];

    assert.strictEqual(entry.points, 4, '2 (mountain) + 1 + 1 (sides)');
    assert.strictEqual(entry.mountainCount, 1);
    assert.strictEqual(entry.sideCount, 2);
});

test('a round with no played matches pays nothing (the zero-match gate)', () => {
    const gs = makeState({ heartHexControl: { q0r0: 1 }, gameHistory: [] });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.roundPlayed, false);
    assert.strictEqual(result.matchesPlayed, 0);
    assert.strictEqual(result.byTeam[1].points, 0,
        'without the multiplier, the empty-round rule must be an explicit gate');
});

test('challenge and break entries do not open the gate on their own', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 1 },
        gameHistory: [
            { roundNumber: 3, isChallenge: true },
            { roundNumber: 3, isBreak: true }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.roundPlayed, false);
    assert.strictEqual(result.byTeam[1].points, 0);
});

test('untagged history entries never count toward round 0 (Number(null) === 0)', () => {
    // Real data from a test tournament: matches confirmed before phase-flow
    // tagging existed carry `roundNumber: null`. The previews call this with
    // resolvingRound 0 during round 1, and Number(null) === 0 used to match
    // every one of them.
    const gs = makeState({
        heartHexControl: { q0r0: 1 },
        gameHistory: [
            { roundNumber: null }, { roundNumber: null }, { roundNumber: null }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 0);

    assert.strictEqual(result.matchesPlayed, 0, 'untagged entries belong to no round');
    assert.strictEqual(result.roundPlayed, false);
    assert.strictEqual(result.byTeam[1].points, 0);
});

test('a contested heart pays nobody', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 1, 'q-4r2': 1 },
        gameQueue: [{ isChallenge: true, challengeHexCoord: 'q0r0', status: 'pending' }]
    });
    const entry = calculateHeartIncome(gs, boardModule, 3).byTeam[1];

    assert.strictEqual(entry.points, 1, 'only the uncontested side heart pays');
    assert.strictEqual(entry.mountainCount, 0);
});

test('a resolved challenge does not freeze the heart', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 1 },
        gameQueue: [{ isChallenge: true, challengeHexCoord: 'q0r0', status: 'completed' }]
    });
    assert.strictEqual(calculateHeartIncome(gs, boardModule, 3).byTeam[1].points, 2);
});

test('non-heart hexes and unknown owners pay nothing, and every team gets an entry', () => {
    const gs = makeState({ heartHexControl: { q3r0: 1, 'q2r-4': 99 } });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.byTeam[1].points, 0, 'a normal hex is not income');
    assert.strictEqual(result.byTeam[2].points, 0);
    assert.deepStrictEqual(Object.keys(result.byTeam).sort(), ['1', '2'],
        'callers index byTeam by team id and must not hit undefined');
});

test('a missing boardModule returns zeros instead of throwing', () => {
    const gs = makeState({ heartHexControl: { q0r0: 1 } });
    const result = calculateHeartIncome(gs, null, 3);

    assert.strictEqual(result.byTeam[1].points, 0);
});

// ── projectRoundsToWin ────────────────────────────────────────────────────

const { projectRoundsToWin } = require('../../shared/scripts/board-module.js');

test('projects rounds to the win target from heart income alone', () => {
    const gs = makeState({
        winCondition: 50,
        teams: [
            { id: 1, name: 'Ravens', points: 40 },   // mountain = +2/round → 5 rounds
            { id: 2, name: 'Wolves', points: 46 }    // one side heart = +1/round → 4 rounds
        ],
        heartHexControl: { q0r0: 1, 'q-4r2': 2 }
    });
    const projection = projectRoundsToWin(gs, boardModule);

    assert.strictEqual(projection[0].teamName, 'Wolves', 'sorted by soonest to win');
    assert.strictEqual(projection[0].roundsToWin, 4);
    assert.strictEqual(projection[1].teamName, 'Ravens');
    assert.strictEqual(projection[1].incomePerRound, 2);
    assert.strictEqual(projection[1].roundsToWin, 5);
});

test('a team holding no hearts has no projection, and sorts last', () => {
    const gs = makeState({
        winCondition: 50,
        teams: [
            { id: 1, name: 'Ravens', points: 48 },
            { id: 2, name: 'Wolves', points: 10 }
        ],
        heartHexControl: { q0r0: 2 }
    });
    const projection = projectRoundsToWin(gs, boardModule);

    assert.strictEqual(projection[0].teamName, 'Wolves', 'the only team with income comes first');
    assert.strictEqual(projection[1].teamName, 'Ravens');
    assert.strictEqual(projection[1].roundsToWin, null, 'no hearts → no projectable pace');
});

test('a team already at the target needs zero more rounds', () => {
    const gs = makeState({
        winCondition: 50,
        teams: [{ id: 1, name: 'Ravens', points: 50 }],
        heartHexControl: { q0r0: 1 }
    });
    assert.strictEqual(projectRoundsToWin(gs, boardModule)[0].roundsToWin, 0);
});

test('the projection ignores the contested-heart freeze (it is about steady state)', () => {
    const gs = makeState({
        winCondition: 50,
        teams: [{ id: 1, name: 'Ravens', points: 40 }],
        heartHexControl: { q0r0: 1 },
        gameQueue: [{ isChallenge: true, challengeHexCoord: 'q0r0', status: 'pending' }]
    });
    assert.strictEqual(projectRoundsToWin(gs, boardModule)[0].incomePerRound, 2);
});

test('no win target or no boardModule yields an empty projection', () => {
    assert.deepStrictEqual(projectRoundsToWin(makeState(), boardModule), []);
    assert.deepStrictEqual(projectRoundsToWin(makeState({ winCondition: 50 }), null), []);
});

test('HEART_INCOME is the single source of the values, and getHexValue reads it', () => {
    assert.strictEqual(HEART_INCOME['mountain-heart'], 2);
    assert.strictEqual(HEART_INCOME['side-heart'], 1);
    assert.strictEqual(boardModule.getHexValue(0, 0), 2);
    assert.strictEqual(boardModule.getHexValue(-4, 2), 1);
    assert.strictEqual(boardModule.getHexValue(3, 0), 0);
});
