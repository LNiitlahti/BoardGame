#!/usr/bin/env node
// Offline renderer for the view.html cinematic.
//   node dev/tools/cinematic-render/render.js --board=2
//   node dev/tools/cinematic-render/render.js --board=2 --preview=10
//   node dev/tools/cinematic-render/render.js --check
// Output: full/video/cinematic.mp4 + full/video/cinematic-meta.json
// (gitignored; upload both to the web host next to view.html's video/ dir).
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const puppeteer = require('puppeteer');
const { startServer } = require('../../tests/e2e-server.js');
const { fixture } = require('./fixtures.js');
const { sourceHash } = require('./source-hash.js');

const ROOT = path.resolve(__dirname, '../../..'); // BoardGame/
const FPS = 60;
const W = 1920, H = 1080;
const FRAME_MS = 1000 / FPS;
const FADE_S = 0.6;

function arg(name, def) {
    const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return def;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function die(msg) { console.error(`\n[render] ${msg}`); process.exit(1); }

function checkMode(outDir) {
    const metaPath = path.join(outDir, 'cinematic-meta.json');
    if (!fs.existsSync(metaPath)) die(`no ${metaPath} — nothing rendered yet`);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const now = sourceHash(ROOT);
    if (meta.sourceHash === now) { console.log('[render] video is UP TO DATE'); process.exit(0); }
    console.log('[render] video is STALE — art, music, timings or cinematic code changed since it was rendered');
    process.exit(2);
}

async function main() {
    const outDir = path.resolve(ROOT, arg('out', 'full/video'));
    if (arg('check', false)) return checkMode(outDir);

    const board = String(arg('board', '2'));
    if (board !== '1' && board !== '2') die('--board must be 1 or 2');
    const previewS = arg('preview', false) ? Number(arg('preview')) : null;
    const headless = !!arg('headless', false);
    const port = Number(arg('port', 5531));

    if (spawnSync('ffmpeg', ['-version']).status !== 0) die('ffmpeg not found on PATH');
    fs.mkdirSync(outDir, { recursive: true });

    const clockSrc = fs.readFileSync(
        path.join(ROOT, 'full/scripts/cinematic/cine-virtual-clock.js'), 'utf8');

    const server = await startServer(ROOT, port);
    const browser = await puppeteer.launch({
        headless,
        // The installed Google Chrome (real GPU path); Puppeteer's bundled
        // download is not required.
        channel: 'chrome',
        defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
        args: [`--window-size=${W},${H + 140}`, '--autoplay-policy=no-user-gesture-required',
               '--force-color-profile=srgb', '--hide-scrollbars']
    });
    let ffmpeg = null;
    try {
        const page = await browser.newPage();
        page.on('pageerror', e => console.error('[page error]', e.message));
        await page.evaluateOnNewDocument(
            `${clockSrc}\nwindow.__cineClock = createVirtualClock(window, { seed: 1 });\nwindow.__cineClock.install();`);

        const url = `http://localhost:${port}/full/view.html?tournamentId=__dev_preview__&cinematic=1&render=1`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // The page's own timers are virtual now: keep stepping (and give real
        // time to network/script loading) until each condition holds.
        async function stepUntil(fnSrc, label, maxIter = 3000) {
            for (let i = 0; i < maxIter; i++) {
                if (await page.evaluate(fnSrc)) return;
                await page.evaluate(() => window.__cineClock.step(16));
                await sleep(10);
            }
            die(`timed out waiting for ${label}`);
        }

        await stepUntil(() => typeof window.__devPreviewSnapshot === 'function'
            && !!window.CINEMATIC, 'view.html + cinematic scripts');
        await page.evaluate(d => window.__devPreviewSnapshot(d), fixture(board));
        await stepUntil(() => !!(window.CINEMATIC.render && window.CINEMATIC.render.armed),
            'cinematic to arm (config/music fetch)');

        // Pre-decode every tile image so no frame shows a half-loaded board.
        await page.evaluate(async () => {
            const css = (document.getElementById('hex-images-dynamic-css') || {}).textContent || '';
            const urls = [...new Set([...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1]))];
            await Promise.all(urls.map(u => { const img = new Image(); img.src = u; return img.decode().catch(() => {}); }));
        });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 60000 }).catch(() => {});

        const info = await page.evaluate(() => window.CINEMATIC.render);
        const fullS = info.durationMs / 1000;
        const lengthS = previewS ? Math.min(previewS, fullS) : fullS;
        const totalFrames = Math.ceil(lengthS * FPS);
        const mp4 = path.join(outDir, 'cinematic.mp4');
        console.log(`[render] board ${board}, ${lengthS.toFixed(1)} s, ${totalFrames} frames -> ${mp4}`);

        const vf = previewS ? 'format=yuv420p'
            : `fade=t=out:st=${(lengthS - FADE_S).toFixed(3)}:d=${FADE_S},format=yuv420p`;
        ffmpeg = spawn('ffmpeg', [
            '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
            '-i', path.join(ROOT, 'full/audio/cinematic-music.mp3'),
            '-map', '0:v', '-map', '1:a', '-t', lengthS.toFixed(3),
            '-vf', vf,
            '-c:v', 'libx264', '-preset', previewS ? 'veryfast' : 'slow', '-crf', '18',
            '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart', mp4
        ], { stdio: ['pipe', 'inherit', 'inherit'] });
        const ffmpegDone = new Promise((res, rej) => ffmpeg.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))));

        const cdp = await page.createCDPSession();
        const t0 = Date.now();
        for (let f = 0; f < totalFrames; f++) {
            if (f > 0) await page.evaluate(ms => window.__cineClock.step(ms), FRAME_MS);
            const err = await page.evaluate(() => window.CINEMATIC.render.error);
            if (err) die(`page error during render at frame ${f}: ${err}`);
            const { data } = await cdp.send('Page.captureScreenshot',
                { format: 'jpeg', quality: 95, optimizeForSpeed: true });
            if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
                await new Promise(r => ffmpeg.stdin.once('drain', r));
            }
            if (f % 60 === 0 || f === totalFrames - 1) {
                const el = (Date.now() - t0) / 1000;
                const eta = f > 0 ? (el / f) * (totalFrames - f) : 0;
                process.stdout.write(`\r[render] frame ${f + 1}/${totalFrames}  ${(f / Math.max(el, 0.001)).toFixed(1)} fps  ETA ${Math.round(eta)} s   `);
            }
        }
        ffmpeg.stdin.end();
        await ffmpegDone;
        process.stdout.write('\n');

        const meta = {
            version: 1,
            boardVersion: board,
            durationMs: Math.round(lengthS * 1000),
            fps: FPS, width: W, height: H,
            script: 'classic',
            preview: !!previewS,
            nameWindows: info.nameWindows,
            renderedAt: new Date().toISOString(),
            sourceHash: sourceHash(ROOT)
        };
        fs.writeFileSync(path.join(outDir, 'cinematic-meta.json'), JSON.stringify(meta, null, 2));
        console.log(`[render] done in ${Math.round((Date.now() - t0) / 1000)} s -> ${outDir}`);
    } finally {
        if (ffmpeg && ffmpeg.exitCode === null) ffmpeg.kill();
        await browser.close();
        server.close();
    }
}

main().catch(e => die(e.stack || e.message));
