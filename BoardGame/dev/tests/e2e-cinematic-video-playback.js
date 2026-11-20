// view.html plays a pre-rendered cinematic when one matches, else falls back.
//   node dev/tests/e2e-cinematic-video-playback.js [--headed]
// Needs ffmpeg. Temporarily replaces full/video/ (restored afterwards).
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer');
const { startServer } = require('./e2e-server.js');

const ROOT = path.resolve(__dirname, '../..');
const VIDEO_DIR = path.join(ROOT, 'full/video');
const BACKUP = path.join(ROOT, 'full/video.__e2e_backup');
const PORT = 5551;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function snapshot(boardVersion) {
    return {
        tournamentName: 'E2E', ...(boardVersion === 2 ? { boardVersion: 2 } : {}),
        teams: [{ id: 1, name: 'T1', players: [{ name: 'Wustra' }] }, { id: 2, name: 'T2', players: [{ name: 'Touch' }] }],
        players: {}, board: {}, rooms: [], lobbyReady: {}, gameQueue: [],
        currentPhase: { name: 'pre_game_setup', roundNumber: 0 }
    };
}

function writeFakeVideo(meta) {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=30:d=4',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', path.join(VIDEO_DIR, 'cinematic.mp4')]);
    assert.strictEqual(r.status, 0, 'ffmpeg made the fake video');
    fs.writeFileSync(path.join(VIDEO_DIR, 'cinematic-meta.json'), JSON.stringify(meta));
}

async function openCinematic(browser, snap) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://localhost:${PORT}/full/view.html?tournamentId=__dev_preview__&cinematic=1&volume=0`,
        { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__devPreviewSnapshot === 'function' && !!window.CINEMATIC, { timeout: 20000 });
    await sleep(1500); // config + music cue fetches inside the controller's init()
    await page.evaluate(d => window.__devPreviewSnapshot(d), snap);
    return page;
}

(async () => {
    if (fs.existsSync(VIDEO_DIR)) fs.renameSync(VIDEO_DIR, BACKUP);
    const server = await startServer(ROOT, PORT);
    const browser = await puppeteer.launch({
        headless: !process.argv.includes('--headed'),
        channel: 'chrome',
        args: ['--autoplay-policy=no-user-gesture-required']
    });
    try {
        // 1) Matching video: it plays, names are drawn, then it hands off to the dashboard.
        writeFakeVideo({ version: 1, boardVersion: '2', durationMs: 4000, fps: 30, width: 320, height: 180,
            nameWindows: [{ startMs: 500, endMs: 3500 }] });
        let page = await openCinematic(browser, snapshot(2));
        await page.waitForSelector('#cineVideo', { timeout: 15000 });
        await page.waitForFunction(() => {
            const t = document.querySelector('#cineVideoTextHost #cineText');
            return t && t.textContent.length > 0;
        }, { timeout: 5000 });
        const seen = new Set();
        for (let i = 0; i < 25; i++) {
            const s = await page.evaluate(() => (document.querySelector('#cineVideoTextHost #cineText') || {}).textContent || '');
            if (s) seen.add(s);
            await sleep(100);
        }
        assert.ok(seen.has('Sota Jatkuu') || seen.has('Wustra'), `overlay showed title/names, saw ${[...seen]}`);
        assert.strictEqual(await page.evaluate(() => document.body.classList.contains('cine-active')), false,
            'live cinematic did not arm');
        await page.waitForFunction(() => !location.search.includes('cinematic=1'), { timeout: 10000 });
        await page.close();
        console.log('  ok  matching video plays with names and hands off to the dashboard');

        // 2) Board mismatch (Legacy tournament, Version 2 video): live cinematic.
        page = await openCinematic(browser, snapshot(1));
        await page.waitForFunction(() => document.body.classList.contains('cine-active'), { timeout: 10000 });
        assert.strictEqual(await page.$('#cineVideo'), null);
        await page.close();
        console.log('  ok  board-version mismatch falls back to the live cinematic');

        // 3) No video at all: live cinematic.
        fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
        page = await openCinematic(browser, snapshot(2));
        await page.waitForFunction(() => document.body.classList.contains('cine-active'), { timeout: 10000 });
        assert.strictEqual(await page.$('#cineVideo'), null);
        await page.close();
        console.log('  ok  missing video falls back to the live cinematic');

        console.log('e2e-cinematic-video-playback: PASS');
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
        if (fs.existsSync(BACKUP)) fs.renameSync(BACKUP, VIDEO_DIR);
    }
})().catch(e => { console.error(e); process.exit(1); });
