/**
 * Visual regression for view.html's matches_in_progress screen.
 *
 * Guards the two things the 2026-08-05 Discord thread asked for:
 *   1. Player names are large enough to read across a LAN room (Wustra).
 *   2. A lone active match slot expands instead of sitting in a 50/50
 *      split with a finished one (Inffi).
 *
 * Uses window.__devPreviewSnapshot -- no login, no Firestore, no tournament.
 * Run: cd BoardGame && node dev/tests/e2e-view-dual-slot-layout.js [--headed]
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server');
const { assert, screenshot, VIEWPORT } = require('./e2e-harness');

const PORT = 8085;
const MIN_NAME_PX = 36; // The whole point of the feature. Below this it is unreadable from the back of the room.

function baseData(slots) {
    const teams = [1, 2].map(id => ({
        id,
        name: `Tiimi ${id}`,
        color: id === 1 ? '#de392c' : '#2278a3',
        points: 3,
        players: [
            { id: `p_t${id}a`, uid: `uid_t${id}a`, name: `Player${id}A` },
            { id: `p_t${id}b`, uid: `uid_t${id}b`, name: `Player${id}B` }
        ]
    }));

    const players = {};
    teams.forEach(t => t.players.forEach(p => { players[p.id] = { uid: p.uid, name: p.name, teamId: t.id }; }));

    const match = (matchNumber, slot, status) => ({
        id: `m${matchNumber}`,
        matchNumber,
        game: 'aoe4',
        status,
        slot,
        roundNumber: 4,
        createdAt: 2_000_000,
        winnerIndex: status === 'completed' ? 0 : undefined,
        teams: [
            { id: 1, playerIds: ['p_t1a', 'p_t1b'] },
            { id: 2, playerIds: ['p_t2a', 'p_t2b'] }
        ]
    });

    return {
        name: 'layout-test',
        teams,
        players,
        board: {},
        rooms: {},
        lobbyReady: {},
        gameQueue: [
            match(1, 1, slots[1] === 'done' ? 'completed' : 'ongoing'),
            match(2, 2, slots[2] === 'done' ? 'completed' : 'ongoing')
        ],
        currentPhase: { name: 'matches_in_progress', roundNumber: 4, startedAt: 1_000_000, slots }
    };
}

async function pushSnapshot(page, data) {
    await page.evaluate(d => window.__devPreviewSnapshot(d), data);
    // One frame for the innerHTML swap plus layout to settle.
    await new Promise(resolve => setTimeout(resolve, 400));
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
        // Check 1 — both slots live: even split, readable names
        // ============================================================
        await pushSnapshot(page, baseData({ 1: 'playing', 2: 'playing' }));

        await page.waitForFunction(() => document.querySelectorAll('.dm-dual-ready-name').length > 0, { timeout: 10000 });

        const dual = await page.evaluate(() => {
            const name = document.querySelector('.dm-dual-ready-name');
            const panels = [...document.querySelectorAll('.dm-dual-slot-panel')];
            return {
                nameFontPx: parseFloat(getComputedStyle(name).fontSize),
                panelCount: panels.length,
                widths: panels.map(p => p.getBoundingClientRect().width),
                hasFocusWrapper: !!document.querySelector('.dm-matches-dual--focus')
            };
        });
        console.log('--- both slots live ---', JSON.stringify(dual));

        assert(dual.panelCount === 2, `expected 2 slot panels, got ${dual.panelCount}`);
        assert(!dual.hasFocusWrapper, 'two active slots must NOT trigger focus mode');
        assert(
            dual.nameFontPx >= MIN_NAME_PX,
            `player names are ${dual.nameFontPx}px, must be >= ${MIN_NAME_PX}px to read across the room`
        );
        // Even split: neither panel more than 15% wider than the other.
        const [wA, wB] = dual.widths;
        assert(
            Math.abs(wA - wB) / Math.max(wA, wB) < 0.15,
            `two live slots should split evenly, got widths ${wA} and ${wB}`
        );

        await screenshot(page, 'dual-slot-both-live', 'view-layout');

        // ============================================================
        // Check 2 — slot 1 done: slot 2 expands
        // ============================================================
        await pushSnapshot(page, baseData({ 1: 'done', 2: 'playing' }));

        await page.waitForFunction(() => !!document.querySelector('.dm-dual-slot-panel--focus'), { timeout: 10000 });

        const focus = await page.evaluate(() => {
            const focusPanel = document.querySelector('.dm-dual-slot-panel--focus');
            const minorPanel = document.querySelector('.dm-dual-slot-panel--minor');
            const focusName = focusPanel.querySelector('.dm-dual-ready-name');
            return {
                focusWidth: focusPanel.getBoundingClientRect().width,
                minorWidth: minorPanel.getBoundingClientRect().width,
                focusNameFontPx: parseFloat(getComputedStyle(focusName).fontSize),
                focusTitle: focusPanel.querySelector('.dm-dual-slot-title').textContent.trim(),
                minorTitle: minorPanel.querySelector('.dm-dual-slot-title').textContent.trim()
            };
        });
        console.log('--- slot 1 done, slot 2 playing ---', JSON.stringify(focus));

        assert(focus.focusTitle === 'Match 2', `the LIVE slot must be the focused one, got "${focus.focusTitle}"`);
        assert(focus.minorTitle === 'Match 1', `the DONE slot must be the minor one, got "${focus.minorTitle}"`);
        assert(
            focus.focusWidth > focus.minorWidth * 2,
            `focused panel (${focus.focusWidth}px) should be far wider than the finished one (${focus.minorWidth}px)`
        );
        assert(
            focus.focusNameFontPx >= MIN_NAME_PX,
            `focused-mode names are ${focus.focusNameFontPx}px, must be >= ${MIN_NAME_PX}px`
        );

        await screenshot(page, 'dual-slot-focus', 'view-layout');

        console.log('\nPASS — both layout checks held.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(err => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
});
