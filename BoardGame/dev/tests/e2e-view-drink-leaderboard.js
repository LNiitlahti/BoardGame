/**
 * Visual check for the break-screen drink leaderboard on view.html.
 *
 * Two things matter: it ranks correctly in team colours, and it renders
 * NOTHING when nobody has logged a drink (an empty box on the big screen
 * during an early break would look broken).
 *
 * Drives window.__devPreviewSnapshot -- no login, no Firestore.
 * Run: cd BoardGame && node dev/tests/e2e-view-drink-leaderboard.js [--headed]
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server');
const { assert, sleep, screenshot, VIEWPORT } = require('./e2e-harness');

const PORT = 8087;

function breakData(drinkCounts) {
    return {
        name: 'drink-test',
        teams: [
            {
                id: 1, name: 'Tiimi 1', color: '#de392c', points: 0,
                players: [{ id: 'p_t1a', uid: 'uid_t1a', name: 'Wustra' }]
            },
            {
                id: 2, name: 'Tiimi 2', color: '#2278a3', points: 0,
                players: [{ id: 'p_t2a', uid: 'uid_t2a', name: 'Touch' }]
            }
        ],
        players: {
            p_t1a: { uid: 'uid_t1a', name: 'Wustra', teamId: 1 },
            p_t2a: { uid: 'uid_t2a', name: 'Touch', teamId: 2 }
        },
        board: {}, rooms: {}, lobbyReady: {}, gameQueue: [],
        drinkCounts,
        currentPhase: { name: 'break', roundNumber: 2, autoInserted: false }
    };
}

(async () => {
    const server = await startServer(path.resolve(__dirname, '../..'), PORT);
    const browser = await puppeteer.launch({ headless: !process.argv.includes('--headed') });

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);
        await page.goto(`http://localhost:${PORT}/full/view.html?tournamentId=__dev_preview__`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.__devPreviewSnapshot === 'function', { timeout: 20000 });

        // ============================================================
        // Nobody has logged anything: no board at all
        // ============================================================
        await page.evaluate(d => window.__devPreviewSnapshot(d), breakData({}));
        await sleep(400);

        const empty = await page.evaluate(() => ({
            hasBreakScreen: !!document.querySelector('.dm-break-screen'),
            hasBoard: !!document.querySelector('.dm-drink-board')
        }));
        console.log('--- break, no drinks logged ---', JSON.stringify(empty));

        assert(empty.hasBreakScreen, 'the break screen itself should render');
        assert(!empty.hasBoard, 'with no drinks logged the leaderboard must not render at all');

        await screenshot(page, 'drink-board-empty', 'view-drinks');

        // ============================================================
        // With drinks: ranked, team-coloured
        // ============================================================
        await page.evaluate(
            d => window.__devPreviewSnapshot(d),
            breakData({ uid_t1a: { beer: 2, soft: 1 }, uid_t2a: { beer: 6 } })
        );
        await sleep(400);

        await page.waitForFunction(() => !!document.querySelector('.dm-drink-board'), { timeout: 5000 });

        const board = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.dm-drink-row')];
            return rows.map(row => {
                const name = row.querySelector('.dm-drink-name');
                return {
                    rank: row.querySelector('.dm-drink-rank').textContent.trim(),
                    name: name.textContent.trim(),
                    color: getComputedStyle(name).color,
                    total: row.querySelector('.dm-drink-total').textContent.trim()
                };
            });
        });
        console.log('--- break, with drinks ---', JSON.stringify(board));

        assert(board.length === 2, `expected 2 rows, got ${board.length}`);
        assert(board[0].name === 'Touch', `highest total should rank first, got "${board[0].name}"`);
        assert(board[0].total === '6', `expected 6, got ${board[0].total}`);
        assert(board[1].name === 'Wustra' && board[1].total === '3', 'second row should be Wustra with 2 beer + 1 soft = 3');
        // #2278a3 === rgb(34, 120, 163)
        assert(
            board[0].color === 'rgb(34, 120, 163)',
            `top row should carry team 2's colour rgb(34, 120, 163), got ${board[0].color}`
        );

        await screenshot(page, 'drink-board-populated', 'view-drinks');

        console.log('\nPASS — leaderboard ranks, colours, and stays hidden when empty.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(err => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
});
