/**
 * Visual check for view.html's read-only chat overlay.
 *
 * Asserts the three things the 2026-08-05 Discord thread asked for: the
 * message appears, it carries the sender's name in their team colour, and it
 * goes away on its own.
 *
 * Drives window.__devPushChatMessage -- no login, no Firestore, no real chat
 * message. Run: cd BoardGame && node dev/tests/e2e-view-chat-overlay.js [--headed]
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server');
const { assert, sleep, screenshot, VIEWPORT } = require('./e2e-harness');

const PORT = 8086;
const DISPLAY_MS = 9000; // must match ChatOverlay's default displayMs

function previewData() {
    return {
        name: 'chat-overlay-test',
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
        currentPhase: { name: 'matches_in_progress', roundNumber: 1, startedAt: 1_000_000, slots: { 1: 'playing', 2: 'playing' } }
    };
}

(async () => {
    const server = await startServer(path.resolve(__dirname, '../..'), PORT);
    const browser = await puppeteer.launch({ headless: !process.argv.includes('--headed') });

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);
        await page.goto(`http://localhost:${PORT}/full/view.html?tournamentId=__dev_preview__`, { waitUntil: 'domcontentloaded' });

        await page.waitForFunction(
            () => typeof window.__devPreviewSnapshot === 'function' && typeof window.__devPushChatMessage === 'function',
            { timeout: 20000 }
        );

        await page.evaluate(d => window.__devPreviewSnapshot(d), previewData());
        await sleep(400);

        // ============================================================
        // A linked player's message: name + team colour
        // ============================================================
        await page.evaluate(() => window.__devPushChatMessage({
            text: 'Hyvä peli!', senderId: 'uid_t2a', senderName: 'stale name'
        }));

        await page.waitForFunction(
            () => !!document.querySelector('.chat-overlay-toast--in'),
            { timeout: 5000 }
        );

        const shown = await page.evaluate(() => {
            const toast = document.querySelector('.chat-overlay-toast');
            const sender = toast.querySelector('.chat-overlay-sender');
            return {
                sender: sender.textContent.trim(),
                senderColor: getComputedStyle(sender).color,
                text: toast.querySelector('.chat-overlay-text').textContent.trim(),
                opacity: parseFloat(getComputedStyle(toast).opacity)
            };
        });
        console.log('--- toast shown ---', JSON.stringify(shown));

        // Roster name wins over the stale senderName frozen into the message.
        assert(shown.sender === 'Touch', `expected sender "Touch", got "${shown.sender}"`);
        assert(shown.text === 'Hyvä peli!', `expected the message text, got "${shown.text}"`);
        // #2278a3 === rgb(34, 120, 163)
        assert(
            shown.senderColor === 'rgb(34, 120, 163)',
            `sender should be painted in team 2's colour rgb(34, 120, 163), got ${shown.senderColor}`
        );
        assert(shown.opacity > 0.9, `toast should be fully visible, opacity was ${shown.opacity}`);

        await screenshot(page, 'chat-overlay-visible', 'view-chat');

        // ============================================================
        // An unlinked sender falls back to neutral
        // ============================================================
        await page.evaluate(() => window.__devPushChatMessage({
            text: 'Admin here', senderId: 'uid_nobody', senderName: 'Inffi (GOD)'
        }));
        await sleep(500);

        const fallback = await page.evaluate(() => {
            const toasts = [...document.querySelectorAll('.chat-overlay-toast')];
            const last = toasts[toasts.length - 1];
            const sender = last.querySelector('.chat-overlay-sender');
            return { sender: sender.textContent.trim(), color: getComputedStyle(sender).color };
        });
        console.log('--- unlinked sender ---', JSON.stringify(fallback));

        assert(fallback.sender === 'Inffi (GOD)', `unlinked sender should keep its stored name, got "${fallback.sender}"`);
        // #c8b37e === rgb(200, 179, 126)
        assert(
            fallback.color === 'rgb(200, 179, 126)',
            `unlinked sender should use the neutral colour rgb(200, 179, 126), got ${fallback.color}`
        );

        // ============================================================
        // It goes away on its own
        // ============================================================
        await sleep(DISPLAY_MS + 2000);

        const after = await page.evaluate(() => document.querySelectorAll('.chat-overlay-toast').length);
        console.log('--- toasts remaining after display window ---', after);
        assert(after === 0, `toasts should have faded and been removed, ${after} still in the DOM`);

        await screenshot(page, 'chat-overlay-faded', 'view-chat');

        console.log('\nPASS — chat overlay appears, colours correctly, and clears itself.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(err => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
});
