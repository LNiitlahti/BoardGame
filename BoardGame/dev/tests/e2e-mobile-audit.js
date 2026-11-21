#!/usr/bin/env node
/**
 * Mobile layout audit: renders every phone-facing page at phone/tablet sizes
 * (touch + isMobile emulation) and fails on layout bugs.
 *
 * OFFLINE BY DEFAULT: runs against mock-firebase.js (in-memory Firestore/Auth
 * + synthetic demo tournament), so a run costs 0 Firestore reads/writes. The
 * run fails if any request tries to reach a Google API host.
 *
 *   node dev/tests/e2e-mobile-audit.js                    # all pages, 360/390/820
 *   node dev/tests/e2e-mobile-audit.js --page=team --vp=390
 *   node dev/tests/e2e-mobile-audit.js --live             # real Firestore, phase gates only:
 *                                                         # 390 only, TD + PLAYER1 from .env.e2e
 *
 * FAILS (exit 1) on:
 *   - layout widening: the page is wider than the device (iOS/Android then zoom
 *     the whole page out, which is what hid the hamburger on season-stats)
 *   - any non-fixed element sticking out past the right edge, unless it sits
 *     inside a horizontal scroll container (overflow-x auto/scroll/hidden)
 *   - a single main-thread long task over LONG_TASK_FAIL_MS
 *   - offline mode: any request to a Google API host
 * WARNS on: tap targets < 44px, text < 12px, page JS errors, long tasks > 200ms.
 *
 * Screenshots: dev/tests/screenshots/mobile/<vp>/<page>.png (gitignored).
 */
require('dotenv').config({ path: __dirname + '/.env.e2e', quiet: true });
const path = require('path');
const { startServer } = require('./e2e-server');
const { launchBrowser, login, screenshotDir } = require('./e2e-harness');
const { installMockFirebase, DEMO_TID } = require('./mock-firebase');

const LONG_TASK_FAIL_MS = 3000;
const PORT = 8091;

const VIEWPORTS = {
    360: { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    390: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    820: { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// as: which account loads the page (anon | td | player). {T} = tournament id.
const PAGES = [
    { name: 'login', url: '/login.html', as: 'anon' },
    { name: 'rulebook', url: '/rulebook.html', as: 'anon' },
    { name: 'home', url: '/full/home.html', as: 'player' },
    { name: 'team', url: '/full/team.html', as: 'player', settle: 5000 },
    { name: 'profile', url: '/full/profile.html', as: 'player' },
    { name: 'onboarding', url: '/full/onboarding.html?tournamentId={T}&player=p1', as: 'player' },
    { name: 'statistics', url: '/full/statistics.html?tournamentId={T}', as: 'td', settle: 4000 },
    { name: 'season-stats', url: '/full/season-stats.html', as: 'td', settle: 4000 },
    { name: 'admin', url: '/full/admin.html?tournamentId={T}', as: 'td', settle: 5000 },
    { name: 'match-queue', url: '/full/match-queue.html?tournamentId={T}', as: 'td' },
    { name: 'god', url: '/full/god.html?tournamentId={T}', as: 'td', settle: 4000 },
    { name: 'setup', url: '/full/setup.html', as: 'td' },
    { name: 'replay', url: '/full/replay.html?tournamentId={T}', as: 'td', settle: 4000 },
];

const ACCOUNTS = { td: 'demo-td', player: 'demo-player', anon: null };

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (k) => args.filter(a => a.startsWith(`--${k}=`)).flatMap(a => a.split('=')[1].split(','));
    const live = args.includes('--live');
    const vps = get('vp').map(Number);
    return {
        live,
        pages: get('page'),
        viewports: vps.length ? vps : (live ? [390] : [360, 390, 820]),
    };
}

// Runs in the page before any script: records long tasks.
function installLongTaskProbe() {
    window.__longTasks = [];
    try {
        new PerformanceObserver(list => list.getEntries().forEach(e => window.__longTasks.push(Math.round(e.duration))))
            .observe({ type: 'longtask', buffered: true });
    } catch { /* unsupported */ }
}

// Runs in the page: layout measurements.
function measure() {
    const vw = document.documentElement.clientWidth;
    const deviceW = window.screen.width;
    const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
        (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const clippedByScroller = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') && p.getBoundingClientRect().right <= deviceW + 1) return true;
        }
        return false;
    };
    const fixedAncestor = (el) => {
        for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true;
        return false;
    };
    const overflow = [], small = [];
    let tiny = 0;
    for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > deviceW + 1 && !fixedAncestor(el) && !clippedByScroller(el)) {
            if (!overflow.some(o => o.el.contains(el))) overflow.push({ el, r });
        }
        if (el.matches('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[onclick]') &&
            (r.width < 44 || r.height < 44)) small.push(desc(el));
        // Board hexes carry coordinate labels drawn at board scale; they're
        // part of the board graphic, not page text.
        if (!el.closest('#hexBoard') &&
            [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) tiny++;
    }
    return {
        deviceW, layoutW: Math.max(vw, document.documentElement.scrollWidth, window.innerWidth),
        overflow: overflow.slice(0, 6).map(o => `${desc(o.el)} (w=${Math.round(o.r.width)}, right=${Math.round(o.r.right)})`),
        small: small.length, smallSample: [...new Set(small)].slice(0, 6), tiny,
        longTasks: (window.__longTasks || []).slice(),
        mockLog: (window.__mockLog || []).length,
    };
}

async function auditPage(ctx, page, cfg, vp, live, mock) {
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    // alert()/confirm() block the main thread until dismissed; a test that
    // never answers them looks like a frozen page.
    page.on('dialog', d => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    const url = `http://localhost:${PORT}${cfg.url.replace('{T}', live ? process.env.TEST_TOURNAMENT_ID : DEMO_TID)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, cfg.settle || 3000));
    const m = await page.evaluate(measure);
    const file = path.join(screenshotDir(`mobile/${vp}`), `${cfg.name}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});

    const fails = [], warns = [];
    if (m.layoutW > m.deviceW + 1) fails.push(`layout widened to ${m.layoutW}px on a ${m.deviceW}px device`);
    if (m.overflow.length) fails.push(`overflow: ${m.overflow.join('; ')}`);
    const maxTask = Math.max(0, ...m.longTasks);
    if (maxTask > LONG_TASK_FAIL_MS) fails.push(`main thread blocked ${maxTask}ms`);
    else if (maxTask > 200) warns.push(`longest task ${maxTask}ms`);
    if (mock && mock.blockedGoogleRequests().length) {
        fails.push(`tried to reach Google: ${mock.blockedGoogleRequests().slice(0, 3).join(', ')}`);
    }
    if (m.small) warns.push(`${m.small} tap targets <44px (${m.smallSample.join(', ')})`);
    if (m.tiny) warns.push(`${m.tiny} text nodes <12px`);
    if (dialogs.length) warns.push(`dialogs: ${dialogs.slice(0, 3).join(' | ')}`);
    if (errors.length) warns.push(`JS errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
    if (mock && m.mockLog === 0 && cfg.as !== 'anon') warns.push('page made no Firestore calls (did it load?)');
    return { fails, warns };
}

(async () => {
    const opts = parseArgs();
    const pages = opts.pages.length ? PAGES.filter(p => opts.pages.includes(p.name)) : PAGES;
    const root = path.resolve(__dirname, '..', '..');
    const server = await startServer(root, PORT);
    const browser = await launchBrowser();
    console.log(`Mobile audit: ${opts.live ? 'LIVE Firestore (costs reads!)' : 'offline mock, 0 Firestore cost'} | ` +
        `viewports ${opts.viewports.join(', ')} | ${pages.length} pages\n`);

    let failed = 0;
    try {
        for (const vpKey of opts.viewports) {
            const vp = VIEWPORTS[vpKey];
            if (!vp) throw new Error(`unknown viewport ${vpKey}`);
            // Live mode: one logged-in context per account, reused across pages.
            const liveCtx = {};
            for (const cfg of pages) {
                let ctx = liveCtx[cfg.as], page, mock = null;
                if (opts.live) {
                    if (!ctx) {
                        ctx = liveCtx[cfg.as] = await browser.createBrowserContext();
                        if (cfg.as !== 'anon') {
                            const p = await ctx.newPage();
                            await p.setViewport(vp);
                            const who = cfg.as === 'td' ? 'TD' : 'PLAYER1';
                            await login(p, `http://localhost:${PORT}`, process.env[`${who}_EMAIL`], process.env[`${who}_PASSWORD`]);
                            await p.close();
                        }
                    }
                    page = await ctx.newPage();
                } else {
                    ctx = await browser.createBrowserContext();
                    page = await ctx.newPage();
                    mock = await installMockFirebase(page, { uid: ACCOUNTS[cfg.as] });
                }
                await page.setViewport(vp);
                await page.evaluateOnNewDocument(installLongTaskProbe);
                let res;
                try {
                    res = await auditPage(ctx, page, cfg, vpKey, opts.live, mock);
                } catch (e) {
                    res = { fails: [`audit crashed: ${e.message.split('\n')[0]}`], warns: [] };
                }
                await page.close().catch(() => {});
                if (!opts.live) await ctx.close().catch(() => {});
                const status = res.fails.length ? 'FAIL' : 'ok  ';
                if (res.fails.length) failed++;
                console.log(`[${status}] ${vpKey} ${cfg.name}`);
                res.fails.forEach(f => console.log(`         x ${f}`));
                res.warns.forEach(w => console.log(`         - ${w}`));
            }
            for (const c of Object.values(liveCtx)) await c.close().catch(() => {});
        }
    } finally {
        await browser.close();
        server.close();
    }
    console.log(`\n${failed ? `${failed} page/viewport combination(s) FAILED` : 'All pages passed'}. ` +
        `Screenshots: dev/tests/screenshots/mobile/`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
