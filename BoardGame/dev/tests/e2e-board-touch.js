/**
 * e2e-board-touch.js: real touch gestures (CDP touch events) on the board
 * at phone size, under the offline mock Firebase (0 Firestore cost).
 *   team:  pinch zooms, drag pans, reset, tap a hex -> details sheet,
 *          double-tap zooms without opening the sheet
 *   admin: pinch + pan never fire a hex click; a deliberate tap still does
 *
 *   node dev/tests/e2e-board-touch.js
 * Screenshots: dev/tests/screenshots/mobile/touch/
 */
const B = __dirname + '/';
const path = require('path');
const { startServer } = require(B + 'e2e-server');
const { launchBrowser } = require(B + 'e2e-harness');
const { installMockFirebase } = require(B + 'mock-firebase');
const OUT = path.join(__dirname, 'screenshots', 'mobile', 'touch');
require('fs').mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

async function setup(b, url, uid) {
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await installMockFirebase(p, { uid });
  p.on('dialog', d => d.dismiss());
  p.on('pageerror', e => console.log('PAGEERR', e.message.split('\n')[0]));
  await p.goto('http://localhost:8094' + url, { waitUntil: 'domcontentloaded' });
  await wait(5000);
  await p.evaluate(() => document.getElementById('hexBoard').scrollIntoView({ block: 'center' }));
  await wait(400);
  return { p, cdp: await p.target().createCDPSession() };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((t, i) => ({ x: t[0], y: t[1], id: i })) });
async function pinch(cdp, cx, cy, from, to) {
  await touch(cdp, 'touchStart', [[cx - from, cy], [cx + from, cy]]);
  for (let i = 1; i <= 8; i++) { const d = from + (to - from) * i / 8; await touch(cdp, 'touchMove', [[cx - d, cy], [cx + d, cy]]); await wait(16); }
  await touch(cdp, 'touchEnd', []);
}
async function drag(cdp, x, y, dx, dy) {
  await touch(cdp, 'touchStart', [[x, y]]);
  for (let i = 1; i <= 8; i++) { await touch(cdp, 'touchMove', [[x + dx * i / 8, y + dy * i / 8]]); await wait(16); }
  await touch(cdp, 'touchEnd', []);
}
async function tap(cdp, x, y) { await touch(cdp, 'touchStart', [[x, y]]); await wait(40); await touch(cdp, 'touchEnd', []); }
const boardRect = p => p.evaluate(() => { const w = document.getElementById('hexBoard').parentElement.getBoundingClientRect(); return { x: w.left + w.width / 2, y: w.top + w.height / 2, w: w.width, h: w.height }; });
const zstate = p => p.evaluate(() => document.getElementById('hexBoard').parentElement.__boardZoom?.state);
// centre of a hex whose centre is on screen and inside the board
const hexAt = (p, sel) => p.evaluate(sel => { const h = [...document.querySelectorAll(sel)].find(h => { const r = h.getBoundingClientRect(); const x = r.left + r.width/2, y = r.top + r.height/2; return document.elementFromPoint(x, y)?.closest('.board-hex') === h; }); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, coord: h.dataset.coord }; }, sel);

(async () => {
  const s = await startServer(path.resolve(B, '..', '..'), 8094);
  const b = await launchBrowser({ protocolTimeout: 60000 });

  // ── Team page ──
  let { p, cdp } = await setup(b, '/full/team.html', 'demo-player');
  let r = await boardRect(p);
  check(!!(await zstate(p)), 'team: zoom attached');
  const scrollBefore = await p.evaluate(() => scrollY);
  await pinch(cdp, r.x, r.y, 40, 120); await wait(200);
  let z = await zstate(p);
  check(z && z.scale > 2, `team: pinch zooms in (scale ${z && z.scale.toFixed(2)})`);
  check(await p.evaluate(() => !document.querySelector('.board-zoom-reset').hidden), 'team: reset button shown');
  check(Math.abs((await p.evaluate(() => scrollY)) - scrollBefore) < 2, 'team: page did not scroll during pinch');
  const zx = z.x;
  await drag(cdp, r.x, r.y, 80, 0); await wait(200);
  z = await zstate(p);
  check(Math.abs(z.x - zx - 80) < 2, `team: one-finger drag pans while zoomed (dx ${(z.x - zx).toFixed(1)})`);
  check(!(await p.evaluate(() => document.querySelector('.board-sheet')?.classList.contains('open'))), 'team: drag did not open hex sheet');
  await p.screenshot({ path: OUT + '/team-zoomed.png' });
  await p.evaluate(() => document.querySelector('.board-zoom-reset').click()); await wait(200);
  check((await zstate(p)).scale === 1, 'team: reset returns to 1x');
  const h = await hexAt(p, '.board-hex.side-heart, .board-hex.mountain-heart');
  await tap(cdp, h.x, h.y); await wait(600);
  const sheet = await p.evaluate(() => { const s = document.querySelector('.board-sheet.open'); return s && s.innerText; });
  check(!!sheet && sheet.includes(h.coord), `team: tapping ${h.coord} opens its details`);
  console.log('   sheet: ' + (sheet || '').replace(/\s+/g, ' '));
  await p.screenshot({ path: OUT + '/team-sheet.png' });
  await p.evaluate(() => BoardZoom.hideSheet()); await wait(300);
  const h2 = await hexAt(p, '.board-hex');
  await tap(cdp, h2.x, h2.y); await wait(80); await tap(cdp, h2.x, h2.y); await wait(600);
  z = await zstate(p);
  check(z.scale > 2, `team: double-tap zooms in (scale ${z.scale})`);
  check(!(await p.evaluate(() => document.querySelector('.board-sheet')?.classList.contains('open'))), 'team: double-tap did not open the sheet');
  await p.close();

  // ── Admin ──
  ({ p, cdp } = await setup(b, '/full/admin.html?tournamentId=demo', 'demo-td'));
  r = await boardRect(p);
  const pickerOpen = () => p.evaluate(() => { const m = document.getElementById('teamPickerModal'); return !!m && (m.classList.contains('active') || getComputedStyle(m).display !== 'none'); });
  check(!(await pickerOpen()), 'admin: picker closed at start');
  await pinch(cdp, r.x, r.y, 40, 110); await wait(200);
  z = await zstate(p);
  check(z && z.scale > 2, `admin: pinch zooms in (scale ${z && z.scale.toFixed(2)})`);
  await drag(cdp, r.x, r.y, -60, 40); await wait(400);
  check(!(await pickerOpen()), 'admin: pinch + pan did not trigger a hex click');
  await p.screenshot({ path: OUT + '/admin-zoomed.png' });
  const ah = await hexAt(p, '.board-hex');
  await tap(cdp, ah.x, ah.y); await wait(500);
  const picked = await p.evaluate(() => document.getElementById('pickerHexCoord')?.textContent);
  check(await pickerOpen(), `admin: a deliberate tap on ${ah.coord} still opens the team picker (${picked})`);
  await p.close();

  await b.close(); s.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
