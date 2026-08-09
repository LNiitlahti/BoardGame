// Repro for TODO.md's "URGENT — severe perf bug likely from multi-tab
// Firestore persistence contention" entry: confirming a player swap on
// god.html with admin/god/team/view all open on the same tournament produced
// multi-second (up to ~39s) 'click' handler freezes, coinciding with
// "Failed to obtain primary lease" console errors from
// enableMultiTabIndexedDbPersistence()'s single-primary-tab lease contention.
//
// The tester's 2026-08-02 caveat in TODO.md: all three occurrences happened
// while actively switching tabs/windows around the time of the click — so
// tab-focus-change timing, not just raw tab COUNT, may be a contributing or
// alternative factor. This script isolates the two by running 4 variants:
//   (a) 1 tab open (god.html only)
//   (b) 4 tabs open (admin/god/team/view), no focus switch before the click
//   (c) 4 tabs open, switch focus to a different tab then back immediately
//       before the click
//   (d) repeat (c) 3x to check reproducibility
//
// Uses the disposable tournament `e2e-disposable-1` (see .env.e2e) — Team
// Alpha (team id 1) has the TD's own account in slot A (so team.html loads
// for the TD login) and a disposable player account in slot B. Each of the 6
// measured swaps consumes the next never-before-used account from a 6-
// account pool (PLAYER1-6 in .env.e2e) via god.html's Teams tab
// (replacePlayerWithUser -> PlayerUtils.swapPlayerInSlot), and measures
// click-to-completion latency (click dispatched -> a `now plays` toast
// confirms the swap succeeded).
//
// Real writes against the production Firebase project — no emulator.
//
// RESULTS (2026-08-02, after migrating firebase-loader.js off
// enablePersistence({synchronizeTabs:true}) to settings({cache:{kind:
// 'persistent', tabManager: firebase.firestore.persistentMultipleTabManager()
// }})): 11 swap measurements across repeated runs of variants (a)/(b)/(c)/(d),
// spanning 1 tab and 4 tabs (admin+god+team+view) with and without an
// immediate focus-switch before the click: 1514, 1517, 1517, 1525, 1525,
// 1517, 1628, 1526, 1528, 1680, 1535ms. All under 1.7s, no correlation with
// tab count or focus-switching, vs. TODO.md's documented pre-fix occurrences
// of 10.2s, 17.7s, and 38.9s freezes with the old enablePersistence API on
// the exact same swap/delete actions. Confirms the migration resolves the
// freeze.
//
// FOLLOW-UP (2026-08-10): the settings({cache:{...tabManager:
// firebase.firestore.persistentMultipleTabManager()}}) call quoted above
// was later found to be silently broken — that function doesn't exist on
// the compat SDK build this app loads, so the call threw and was swallowed
// by a try/catch, meaning persistence was never actually re-enabled at all
// for this measurement run (see firebase-loader.js and TODO.md). The
// freeze-is-gone RESULT above still holds (no persistence == no lease
// contention == no freeze), but the "confirms the [new API] migration
// resolves the freeze" framing overstates it: this run confirms turning
// persistence OFF resolves the freeze, not that the new cache API is a
// working, non-deprecated multi-tab replacement — compat's SDK doesn't
// have one.

require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

const BASE_URL = process.env.BASE_URL;
const TD_EMAIL = process.env.TD_EMAIL;
const TD_PASSWORD = process.env.TD_PASSWORD;
const TID = process.env.TEST_TOURNAMENT_ID;
const TEAM_ID = process.env.SWAP_TARGET_TEAM_ID || '1';

if (!TID) {
  console.error('TEST_TOURNAMENT_ID is not set in .env.e2e — see task setup notes.');
  process.exit(1);
}

// A swap mints a brand-new permanent registry id for the incoming user, and
// any uid ever linked anywhere in the tournament is permanently blocked from
// being linked/swapped in again ("User is already assigned in this
// tournament" — protects completed-match history from ever pointing at a
// reused id). So each of the 6 measured swaps needs a never-before-used
// disposable account — a pool of 6, consumed in order, not 2 toggled back
// and forth.
const PLAYER_POOL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  .map(n => ({ email: process.env[`PLAYER${n}_EMAIL`], password: process.env[`PLAYER${n}_PASSWORD`] }))
  .filter(p => p.email && p.password);
let poolIndex = 0;

// Read the current slotB player-registry id (the id we're replacing) plus
// the full set of uids already present anywhere in the registry, and hand
// back the next pool account whose uid ISN'T already burned — poolIndex is
// only a starting hint, not authoritative, since earlier interrupted runs
// (crashed after the real Firestore write succeeded but before this script
// saw confirmation) can leave pool accounts already consumed from a
// process's very first index.
async function resolveSwapTarget(page) {
  const info = await page.evaluate(async (tournamentId, teamId) => {
    const doc = await firebase.firestore().collection('tournaments').doc(tournamentId).get();
    const data = doc.data();
    const team = data.teams.find(t => String(t.id) === String(teamId));
    const slotB = team.players[1]; // slot A (index 0) is the TD's own account, untouched
    const usedUids = new Set(Object.values(data.players || {}).map(p => p.uid).filter(Boolean));
    return { slotPlayerId: slotB.id, usedUids: Array.from(usedUids) };
  }, TID, TEAM_ID);
  const usedUids = new Set(info.usedUids);

  while (poolIndex < PLAYER_POOL.length) {
    const candidate = PLAYER_POOL[poolIndex];
    const uid = await getUidFor(page, candidate.email);
    if (!usedUids.has(uid)) {
      poolIndex++;
      return { slotPlayerId: info.slotPlayerId, targetUid: uid, targetEmail: candidate.email };
    }
    console.log(`    [pool] ${candidate.email} already burned in this tournament's registry, skipping`);
    poolIndex++;
  }
  throw new Error(`Player pool exhausted (all ${PLAYER_POOL.length} accounts already used in this tournament) — add more PLAYERn_EMAIL/PASSWORD pairs to .env.e2e.`);
}

const uidCache = {};
async function getUidFor(page, email) {
  if (uidCache[email]) return uidCache[email];
  const uid = await page.evaluate(async (email) => {
    const snap = await firebase.firestore().collection('users').where('email', '==', email).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
  }, email);
  uidCache[email] = uid;
  return uid;
}

// god.html's initial tournament onSnapshot callback (and possibly other
// periodic UI re-inits) can silently reset the active tab away from 'teams'
// at almost any point, including in the narrow gap between confirming the
// panel is active and actually dispatching the click. Rather than chase down
// god.html's own tab-state logic (out of scope for this task), retry the
// click a few times, re-asserting switchGodTab('teams') each time, until it
// goes through.
async function clickWithTabReassert(page, selector, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.evaluate(() => {
      if (!document.getElementById('teamsPanel')?.classList.contains('active')) switchGodTab('teams');
    });
    try {
      await page.click(selector);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 150));
    }
  }
}

// Same idea, but as a non-committing visibility check (no click) so it can
// run *before* starting a latency measurement, without the retry-for-race
// time getting counted as part of the click-to-completion latency itself.
async function ensureClickable(page, selector, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const visible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
    }, selector);
    if (visible) return;
    await page.evaluate(() => {
      if (!document.getElementById('teamsPanel')?.classList.contains('active')) switchGodTab('teams');
    });
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`ensureClickable: "${selector}" never became visible after ${maxAttempts} attempts`);
}

async function openTab(browser, pageName, extraParams = '') {
  const page = await browser.newPage();
  if (process.env.DEBUG_FREEZE_SCRIPT) {
    page.on('console', msg => { if (/User Management|error|Error/i.test(msg.text())) console.log(`    [console:${pageName}]`, msg.text()); });
    page.on('pageerror', err => console.log(`    [pageerror:${pageName}]`, err.message));
    page.on('dialog', d => console.log(`    [dialog:${pageName}]`, d.type(), d.message()));
  }
  await login(page, BASE_URL, TD_EMAIL, TD_PASSWORD);
  // admin.html/god.html/team.html/view.html all live under BoardGame/full/
  // (only login.html/index.html are at the repo root the static server roots).
  await gotoTournamentPage(page, BASE_URL, `full/${pageName}`, TID, extraParams);
  // firebase-loader.js injects the SDK <script> tags dynamically after
  // DOMContentLoaded; networkidle0 can resolve a tick before window.firebase
  // is actually assigned, so wait for the global explicitly.
  await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
  return page;
}

// Perform one swap on the god.html tab and measure click-to-completion time.
// `focusSwitchPage`, if provided, gets bringToFront()'d and the god tab is
// brought back to front immediately before the click (simulating the
// tester's tab-switching-right-before-the-click caveat).
async function measureOneSwap(godPage, focusSwitchPage) {
  const { slotPlayerId, targetUid, targetEmail } = await resolveSwapTarget(godPage);

  // Make sure the tournament data has actually loaded before switching tabs —
  // god.html's initial tournament onSnapshot callback re-asserts a default
  // active tab once data first arrives, which can silently undo an earlier
  // switchGodTab('teams') call made before that first snapshot lands.
  await godPage.waitForFunction(() => !!window.gameState?.tournamentId, { timeout: 20000 });
  await godPage.evaluate(() => switchGodTab('teams'));
  await godPage.waitForFunction(() => document.getElementById('teamsPanel')?.classList.contains('active'), { timeout: 10000 });
  await godPage.waitForSelector('#unassignedUsersList');
  await godPage.evaluate(() => loadUnassignedUsers());
  // Re-assert in case some later async init reset the active tab.
  await godPage.evaluate(() => switchGodTab('teams'));
  await godPage.waitForFunction(
    (uid) => !!document.querySelector(`[onclick*="selectUserForAssignment('${uid}')"]`),
    { timeout: 20000 },
    targetUid
  );

  // Select the target user in the picker.
  if (process.env.DEBUG_FREEZE_SCRIPT) {
    const diag = await godPage.evaluate((uid) => {
      const el = document.querySelector(`[onclick*="selectUserForAssignment('${uid}')"]`);
      const panel = document.getElementById('teamsPanel');
      return {
        found: !!el,
        rect: el ? el.getBoundingClientRect() : null,
        panelActive: panel ? panel.classList.contains('active') : null,
        panelDisplay: panel ? getComputedStyle(panel).display : null,
        tournamentId: window.gameState?.tournamentId,
        unassignedUsersListHtml: document.getElementById('unassignedUsersList')?.innerHTML?.slice(0, 300),
      };
    }, targetUid);
    console.log('    [diag]', JSON.stringify(diag));
  }
  await clickWithTabReassert(godPage, `[onclick*="selectUserForAssignment('${targetUid}')"]`);
  await godPage.waitForFunction(
    (uid) => document.querySelector(`[onclick*="selectUserForAssignment('${uid}')"]`)?.textContent.includes('✓'),
    { timeout: 10000 },
    targetUid
  );

  // showStatus() on god.html (ui-manager.js:27-31) delegates entirely to
  // shared/scripts/toast.js's showToast() when that global exists (it does,
  // god.html loads toast.js) — #statusMessage is NEVER touched on this page.
  // The completion signal is a `.toast .toast-content` element instead. Also
  // auto-accept the native confirm() dialog replacePlayerWithUser() shows for
  // a swap (isSwap === true every time here, since slot B is always already
  // occupied by whoever the previous pool account swapped in).
  await godPage.evaluate(() => {
    document.querySelectorAll('.toast-container .toast').forEach(t => t.remove());
  });
  godPage.once('dialog', async (dialog) => { await dialog.accept(); });

  const swapBtnSelector = `button[onclick*="replacePlayerWithUser(${TEAM_ID}, '${slotPlayerId}')"]`;
  await godPage.waitForSelector(swapBtnSelector, { timeout: 10000 });
  // Settle any tab-visibility race BEFORE starting the latency clock, so the
  // retry time here isn't mistaken for the freeze we're trying to measure.
  await ensureClickable(godPage, swapBtnSelector);

  if (focusSwitchPage) {
    await focusSwitchPage.bringToFront();
    await new Promise(r => setTimeout(r, 200));
    await godPage.bringToFront();
    await ensureClickable(godPage, swapBtnSelector);
  }

  const t0 = Date.now();
  // The teams panel can re-render out from under us at almost any moment
  // (a live onSnapshot listener redraws it), detaching the button between
  // our visibility check and the actual click — retry past that specific
  // transient race rather than treating it as the freeze under test.
  for (let attempt = 1; ; attempt++) {
    try {
      await godPage.click(swapBtnSelector);
      break;
    } catch (err) {
      if (attempt >= 5 || !/not clickable|not an Element|detached/i.test(err.message)) throw err;
      await ensureClickable(godPage, swapBtnSelector);
    }
  }
  // Poll and log every observed toast text (not just the expected "now
  // plays" success text) so a silent error-path toast (e.g. "Team not
  // found" / "already assigned") is visible instead of just timing out
  // looking for text that never appears.
  let lastSeen = '';
  let elapsed = null;
  for (let i = 0; i < 40; i++) {
    const text = await godPage.evaluate(() =>
      Array.from(document.querySelectorAll('.toast-container .toast-content')).map(e => e.textContent).join(' | '));
    if (text !== lastSeen) {
      console.log(`    [debug t+${Date.now() - t0}ms] toast(s):`, JSON.stringify(text));
      lastSeen = text;
    }
    if (text.includes('now plays')) { elapsed = Date.now() - t0; break; }
    await new Promise(r => setTimeout(r, 1500));
  }
  if (elapsed === null) {
    console.log('    [debug] gave up after 60s, final toast(s):', JSON.stringify(lastSeen));
    throw new Error(`Timed out waiting for "now plays" toast after 60s. Last toast(s): ${JSON.stringify(lastSeen)}`);
  }

  console.log(`    swapped in ${targetEmail} -> slot ${slotPlayerId}: ${elapsed}ms`);
  return elapsed;
}

(async () => {
  const server = await startServer(path.resolve(__dirname, '..', '..'), 8080);
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 60000 });
  const results = [];

  try {
    // --- Variant (a): 1 tab (god.html only) ---
    console.log('\n=== Variant (a): 1 tab open (god.html only) ===');
    let god = await openTab(browser, 'god.html');
    let elapsed = await measureOneSwap(god, null);
    results.push({ variant: 'a: 1 tab', elapsed });
    await god.close();

    // --- Variant (b): 4 tabs open, no focus switch ---
    console.log('\n=== Variant (b): 4 tabs open, no focus switch ===');
    let admin = await openTab(browser, 'admin.html');
    god = await openTab(browser, 'god.html');
    let team = await openTab(browser, 'team.html', `&teamId=${TEAM_ID}`);
    let view = await openTab(browser, 'view.html');
    await god.bringToFront();
    elapsed = await measureOneSwap(god, null);
    results.push({ variant: 'b: 4 tabs, no focus switch', elapsed });

    // --- Variant (c): 4 tabs open, focus-switch immediately before click ---
    console.log('\n=== Variant (c): 4 tabs open, focus switch right before click ===');
    elapsed = await measureOneSwap(god, admin);
    results.push({ variant: 'c: 4 tabs, focus switch before click', elapsed });

    // --- Variant (d): repeat (c) 3x for reproducibility ---
    console.log('\n=== Variant (d): repeat (c) 3x ===');
    for (let i = 1; i <= 3; i++) {
      const otherTab = [admin, team, view][i % 3];
      elapsed = await measureOneSwap(god, otherTab);
      results.push({ variant: `d.${i}: 4 tabs, focus switch before click (repeat)`, elapsed });
    }

    await admin.close();
    await god.close();
    await team.close();
    await view.close();

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== Results ===');
  results.forEach(r => console.log(`${r.variant}: ${r.elapsed}ms`));
})();
