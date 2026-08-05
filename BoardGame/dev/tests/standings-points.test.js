/**
 * Regression coverage for the "every win counts twice" display bug.
 *
 * `team.points` is the single source of truth for standings: it already
 * contains +1 per match win (confirmResult in admin.js / result-manager.js)
 * AND heart income. Any display that adds `gamesWon` on top of it counts
 * every win twice — a team with one win and no hearts shows 2.
 *
 * This was fixed in _getTeamTotalPoints() on 2026-08-04, but two other copies
 * survived and were found by manual testing on 2026-08-05:
 *   - display-manager.js _renderScoreBars()  (view.html territory score bars)
 *   - stats-manager.js points-over-time chart (god.html)
 *
 * _renderScoreBars() also read `data.victoryCondition`, a field nothing in the
 * codebase ever writes — so the bars always scaled to 50 regardless of the
 * tournament's real winCondition.
 */
const test = require('node:test');
const assert = require('node:assert');

const BoardModule = require('../../shared/scripts/board-module.js');
const { calculateHeartIncome } = require('../../shared/scripts/board-module.js');

const boardModule = new BoardModule();

global.window = global.window || { location: { search: '' } };
global.ICON_SVGS = global.ICON_SVGS || new Proxy({}, { get: () => '' });
global.countScoringMatchesInRound = BoardModule.countScoringMatchesInRound;
global.calculateHeartIncome = calculateHeartIncome;
require('../../full/scripts/display-manager.js');
const DisplayManager = global.window.DisplayManager;

// _renderScoreBars preserves a header row and appends the team rows via
// insertAdjacentHTML, so the stub needs more than a bare innerHTML holder.
function renderScoreBars(data) {
    let appended = '';
    const fake = {
        innerHTML: '',
        querySelector: () => null,
        appendChild: () => {},
        insertAdjacentHTML: (_where, html) => { appended += html; }
    };
    global.document = { getElementById: (id) => (id === 'territoryMap' ? fake : null) };
    const dm = new DisplayManager({ container: null, boardModule, boardRenderer: null });
    dm._renderScoreBars(data);
    return appended;
}

function renderScoreStrip(data) {
    const fake = { innerHTML: '' };
    global.document = { getElementById: (id) => (id === 'scoreStrip' ? fake : null) };
    const dm = new DisplayManager({ container: null, boardModule, boardRenderer: null });
    dm._renderScoreStrip(data);
    return fake.innerHTML;
}

test('score strip: one win and no hearts reads 1 win / 0 hex / 1 total', () => {
    const html = renderScoreStrip({
        teams: [{ id: 4, name: 'Tiimi 4', points: 1, gamesWon: 1, players: [] }]
    });

    assert.match(html, /sc-score-num w">1</, 'one match win');
    assert.match(html, /sc-score-num pts">0</,
        'the pts column is HEART income — the win must not be counted here too');
    assert.match(html, /sc-score-num total">1</,
        'total is team.points, which already contains the win');
});

test('score strip: wins and heart income split out of the single total', () => {
    // 3 points = 1 match win + 2 from the mountain heart.
    const html = renderScoreStrip({
        teams: [{ id: 4, name: 'Tiimi 4', points: 3, gamesWon: 1, players: [] }]
    });

    assert.match(html, /sc-score-num w">1</);
    assert.match(html, /sc-score-num pts">2</);
    assert.match(html, /sc-score-num total">3</);
});

test('score strip: never shows a negative hex figure', () => {
    const html = renderScoreStrip({
        teams: [{ id: 4, name: 'Tiimi 4', points: 1, gamesWon: 3, players: [] }]
    });

    assert.doesNotMatch(html, /sc-score-num pts">-/);
    assert.match(html, /sc-score-num total">1</);
});

test('score bars show points alone — one win is 1 point, not 2', () => {
    const html = renderScoreBars({
        teams: [{ id: 1, name: 'Ravens', points: 1, gamesWon: 1, gamesLost: 0 }],
        winCondition: 50
    });

    assert.match(html, /class="tm-pts">1</,
        'points already includes the win; adding gamesWon shows 2');
});

test('score bars split the total into wins and heart income without inflating it', () => {
    // 3 points total: 1 from a match win, 2 from the mountain heart.
    const html = renderScoreBars({
        teams: [{ id: 1, name: 'Ravens', points: 3, gamesWon: 1, gamesLost: 0 }],
        winCondition: 50
    });

    assert.match(html, /class="tm-pts">3</, 'total is points, unmodified');
    assert.match(html, /tm-seg w" style="flex:1;/, 'win segment = gamesWon');
    assert.match(html, /tm-seg h" style="flex:2;/, 'heart segment = points - gamesWon');
});

test('score bars scale to the tournament winCondition, not a hardcoded 50', () => {
    const html = renderScoreBars({
        teams: [{ id: 1, name: 'Ravens', points: 5, gamesWon: 0, gamesLost: 0 }],
        winCondition: 10
    });

    assert.match(html, /width: 50%/, '5 of 10 is half the bar');
});

test('score bars fall back to 50 when no winCondition is set', () => {
    const html = renderScoreBars({
        teams: [{ id: 1, name: 'Ravens', points: 25, gamesWon: 0, gamesLost: 0 }],
    });

    assert.match(html, /width: 50%/, '25 of the default 50');
});

test('a team with more wins than points cannot produce a negative heart segment', () => {
    // Shouldn't happen (points >= gamesWon is an invariant), but a corrupted
    // or hand-edited state must not emit flex:-1 and break the layout.
    const html = renderScoreBars({
        teams: [{ id: 1, name: 'Ravens', points: 1, gamesWon: 3, gamesLost: 0 }],
        winCondition: 50
    });

    assert.doesNotMatch(html, /flex:-/, 'no negative flex');
    assert.match(html, /class="tm-pts">1</, 'total still reads points');
});
