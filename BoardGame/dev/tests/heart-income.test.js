/**
 * Unit coverage for the single heart-income calculation in board-module.js.
 *
 * The rule (decided 2026-08-06, tournament "perseenkulli"): a heart pays for
 * every match it was HELD THROUGH — +1 per side heart, +2 for the mountain
 * heart, per scoring match in the round, judged by the control snapshot taken
 * when each match result was confirmed. Capture a heart mid-round and it pays
 * only for the matches confirmed after the capture.
 *
 * History: income was first `value × matchesPlayed` with control read once at
 * payout (paid teams for matches they had NOT held the heart through), then
 * briefly flat per round (underpaid teams that held a heart all round). Both
 * were wrong in opposite directions; the snapshot rule is the one the game
 * actually means. The values live only in HEART_INCOME, the calculation only
 * in calculateHeartIncome() — all payouts and previews call it.
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
            { roundNumber: 3, heartControlSnapshot: {} },
            { roundNumber: 3, heartControlSnapshot: {} }
        ],
        currentPhase: { name: 'scoring_hex', roundNumber: 4 },
        ...overrides
    };
}

test('a heart held through both matches pays per match: mountain = +4 over a 2-match round', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 1 },
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: { q0r0: 1 } },
            { roundNumber: 3, heartControlSnapshot: { q0r0: 1 } }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.matchesPlayed, 2);
    assert.strictEqual(result.byTeam[1].points, 4, '+2 for each match held through');
    assert.strictEqual(result.byTeam[1].mountainCount, 2, 'credited for two heart-matches');
    assert.strictEqual(result.byTeam[2].points, 0);
});

test('a heart captured mid-round pays only for matches confirmed after the capture', () => {
    // Match 1 confirmed while nobody held q2r-4; Ravens captured it in the
    // placement after match 1, so match 2's snapshot shows them holding it.
    const gs = makeState({
        heartHexControl: { 'q2r-4': 1 },
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: {} },
            { roundNumber: 3, heartControlSnapshot: { 'q2r-4': 1 } }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.byTeam[1].points, 1,
        'held during one match only — +1, not +2');
    assert.strictEqual(result.byTeam[1].sideCount, 1);
});

test('a heart that changed hands mid-round pays each holder for their matches', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 2 },
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: { q0r0: 1 } },
            { roundNumber: 3, heartControlSnapshot: { q0r0: 2 } }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.byTeam[1].points, 2, 'old holder paid for match 1');
    assert.strictEqual(result.byTeam[2].points, 2, 'new holder paid for match 2');
});

test('an entry with no snapshot falls back to current control', () => {
    // Matches confirmed before snapshot stamping existed carry no
    // heartControlSnapshot; they are judged by control as it stands now.
    const gs = makeState({
        heartHexControl: { 'q-4r2': 1 },
        gameHistory: [
            { roundNumber: 3 },
            { roundNumber: 3, heartControlSnapshot: { 'q-4r2': 1 } }
        ]
    });
    assert.strictEqual(calculateHeartIncome(gs, boardModule, 3).byTeam[1].points, 2);
});

test('a mixed holding sums per heart per match and reports both counts', () => {
    const snap = { q0r0: 1, 'q-4r2': 1, q2r2: 1 };
    const gs = makeState({
        heartHexControl: snap,
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: snap },
            { roundNumber: 3, heartControlSnapshot: snap }
        ]
    });
    const entry = calculateHeartIncome(gs, boardModule, 3).byTeam[1];

    assert.strictEqual(entry.points, 8, '(2 mountain + 1 + 1 sides) × 2 matches');
    assert.strictEqual(entry.mountainCount, 2);
    assert.strictEqual(entry.sideCount, 4);
});

test('a split slot counts as ONE match for heart income', () => {
    // Real data from tournament "perseenkulli", round 5: slot 2 was split
    // into two smaller games (matches 10 and 11), so the round had 3 history
    // entries for 2 real match slots. Hearts must pay per SLOT, not per
    // game — the mountain heart here earns 2 × 2 = 4, not 2 × 3 = 6.
    const snap = { q0r0: 1 };
    const gs = makeState({
        heartHexControl: snap,
        gameHistory: [
            { roundNumber: 3, slot: 1, heartControlSnapshot: snap },
            { roundNumber: 3, slot: 2, heartControlSnapshot: snap },
            { roundNumber: 3, slot: 2, heartControlSnapshot: snap }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.matchesPlayed, 2, 'two slots, however many games');
    assert.strictEqual(result.byTeam[1].points, 4, '+2 per slot held through');
});

test('entries without a slot tag each count as their own match', () => {
    // Pre-slot-tagging entries can't be grouped; treat each as one match
    // rather than collapsing them all into a single "undefined" slot.
    const snap = { 'q-4r2': 1 };
    const gs = makeState({
        heartHexControl: snap,
        gameHistory: [
            { roundNumber: 3, matchNumber: 7, heartControlSnapshot: snap },
            { roundNumber: 3, matchNumber: 8, heartControlSnapshot: snap }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.matchesPlayed, 2);
    assert.strictEqual(result.byTeam[1].points, 2);
});

test('a round with no played matches pays nothing (the zero-match gate)', () => {
    const gs = makeState({ heartHexControl: { q0r0: 1 }, gameHistory: [] });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.roundPlayed, false);
    assert.strictEqual(result.matchesPlayed, 0);
    assert.strictEqual(result.byTeam[1].points, 0);
});

test('challenge and break entries neither pay nor open the gate', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 1 },
        gameHistory: [
            { roundNumber: 3, isChallenge: true, heartControlSnapshot: { q0r0: 1 } },
            { roundNumber: 3, isBreak: true, heartControlSnapshot: { q0r0: 1 } }
        ]
    });
    const result = calculateHeartIncome(gs, boardModule, 3);

    assert.strictEqual(result.roundPlayed, false);
    assert.strictEqual(result.byTeam[1].points, 0,
        'challenge games are not matches — holding a heart through one pays nothing');
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

test('a contested heart pays nobody, even for matches it was held through', () => {
    const snap = { q0r0: 1, 'q-4r2': 1 };
    const gs = makeState({
        heartHexControl: snap,
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: snap },
            { roundNumber: 3, heartControlSnapshot: snap }
        ],
        gameQueue: [{ isChallenge: true, challengeHexCoord: 'q0r0', status: 'pending' }]
    });
    const entry = calculateHeartIncome(gs, boardModule, 3).byTeam[1];

    assert.strictEqual(entry.points, 2, 'only the uncontested side heart pays (×2 matches)');
    assert.strictEqual(entry.mountainCount, 0);
});

test('a resolved challenge does not freeze the heart', () => {
    const gs = makeState({
        heartHexControl: { q0r0: 1 },
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: { q0r0: 1 } },
            { roundNumber: 3, heartControlSnapshot: { q0r0: 1 } }
        ],
        gameQueue: [{ isChallenge: true, challengeHexCoord: 'q0r0', status: 'completed' }]
    });
    assert.strictEqual(calculateHeartIncome(gs, boardModule, 3).byTeam[1].points, 4);
});

test('non-heart hexes and unknown owners pay nothing, and every team gets an entry', () => {
    const snap = { q3r0: 1, 'q2r-4': 99 };
    const gs = makeState({
        heartHexControl: snap,
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: snap },
            { roundNumber: 3, heartControlSnapshot: snap }
        ]
    });
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

// ── view.html's live Hex Scoring panel ────────────────────────────────────

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
// display-manager.js calls these as bare globals, the way the browser sees
// board-module.js's window assignments.
global.countScoringMatchesInRound = BoardModule.countScoringMatchesInRound;
global.calculateHeartIncome = calculateHeartIncome;
require('../../full/scripts/display-manager.js');
const DisplayManager = global.window.DisplayManager;

test('the live Hex Scoring panel shows per-match income from the snapshots', () => {
    const dm = new DisplayManager({ container: null, boardModule, boardRenderer: null });
    const snap = { q0r0: 1, 'q-4r2': 1 };
    const gs = makeState({
        heartHexControl: snap,
        gameHistory: [
            { roundNumber: 3, heartControlSnapshot: snap },
            { roundNumber: 3, heartControlSnapshot: snap }
        ]
    });

    const html = dm._buildHexScoringHTML(gs);

    assert.match(html, /\+6</, '(mountain 2 + side 1) × 2 matches held');
});

test('the live panel says nothing pays when no match was played', () => {
    const dm = new DisplayManager({ container: null, boardModule, boardRenderer: null });
    const gs = makeState({ heartHexControl: { q0r0: 1 }, gameHistory: [] });

    assert.match(dm._buildHexScoringHTML(gs), /No matches played this round/);
});

// ── projectRoundsToWin ────────────────────────────────────────────────────

const { projectRoundsToWin } = require('../../shared/scripts/board-module.js');

test('projects rounds to the win target assuming 2 matches per round', () => {
    const gs = makeState({
        winCondition: 50,
        teams: [
            { id: 1, name: 'Ravens', points: 40 },   // mountain = 2×2 = +4/round → 3 rounds
            { id: 2, name: 'Wolves', points: 47 }    // side heart = 1×2 = +2/round → 2 rounds
        ],
        heartHexControl: { q0r0: 1, 'q-4r2': 2 }
    });
    const projection = projectRoundsToWin(gs, boardModule);

    assert.strictEqual(projection[0].teamName, 'Wolves', 'sorted by soonest to win');
    assert.strictEqual(projection[0].roundsToWin, 2);
    assert.strictEqual(projection[1].teamName, 'Ravens');
    assert.strictEqual(projection[1].incomePerRound, 4);
    assert.strictEqual(projection[1].roundsToWin, 3);
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
    assert.strictEqual(projectRoundsToWin(gs, boardModule)[0].incomePerRound, 4);
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
