/**
 * e2e-navbar-primary-switch.js — regression test for TODO.md Task 11:
 * "navbar.js buildNavUrl() reads stale cached tournament/team".
 *
 * Root cause: navbar.js's buildNavUrl() (shared/scripts/navbar.js:105-132)
 * builds every nav link's href (including "My Team") purely from
 * sessionStorage/localStorage's cached currentTournamentId/currentTeamId —
 * it never re-reads Firestore. getCurrentTournamentId() (navbar.js:504-512)
 * only falls back to the user doc's fresh assignedTournamentId when the
 * cache is completely EMPTY; once a value is cached, it wins forever, even
 * after the user's real primary tournament/team changes server-side.
 *
 * home.html's "Set as primary" handler (window.setPrimaryTournament,
 * home.html ~1395-1423) writes the new assignedTournamentId/assignedTeamId
 * to Firestore and already re-synced sessionStorage/localStorage's
 * currentTournamentId + currentTournamentName — but never currentTeamId.
 * So after switching primary tournaments, the navbar's cached
 * currentTeamId silently keeps pointing at the OLD tournament's team,
 * while currentTournamentId correctly points at the new one — a mismatched
 * pair. Clicking "My Team" then sends the user to
 * `team.html?tournamentId=<NEW>&teamId=<OLD>`, a combination that either
 * shows the wrong team or (if the old numeric id doesn't exist in the new
 * tournament) team-controls.js's own "Team not found in tournament" guard
 * kicks the user back out to index.html.
 *
 * This test drives the REAL UI: logs in as a disposable player account
 * linked into TWO tournaments (a team in each, with DIFFERENT numeric team
 * ids so a stale-teamId bug is observable, not masked by both tournaments
 * coincidentally using team id 1), clicks the real "Set as primary" button
 * for the second tournament, reloads the page (forcing navbar.js to
 * re-render from whatever ended up cached — this is what actually exercises
 * buildNavUrl(), not the one-time render from before the switch), then
 * clicks the real "My Team" nav link and asserts the resulting navigation's
 * tournamentId/teamId query params match the NEW primary, not the old one.
 *
 * Test fixture: reuses `e2e-disposable-1` (PLAYER14 is already linked into
 * its Team Alpha, id 1 — see E2E_HARNESS.md) as tournament A, and creates
 * (idempotently) a second minimal disposable tournament,
 * `e2e-navbar-secondary`, with a single team (id 55) containing PLAYER14,
 * as tournament B. `e2e-navbar-secondary` is a lasting fixture (like
 * `e2e-disposable-1`), not deleted after the run — safe for later tasks to
 * reuse per the harness convention. PLAYER14's own user doc
 * (assignedTournamentId/assignedTeamId/etc, the actual "primary" pointer
 * mutated by clicking "Set as primary") IS snapshotted/restored in a
 * `finally` block, since other scripts (e2e-ready-check.js) depend on its
 * baseline state pointing at e2e-disposable-1/Team Alpha.
 *
 * Run: cd BoardGame && node dev/tests/e2e-navbar-primary-switch.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, newLoggedInPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const SECONDARY_TOURNAMENT_ID = 'e2e-navbar-secondary';
const SECONDARY_TEAM_ID = 55;
const PRIMARY_TOURNAMENT_ID = 'e2e-disposable-1';
const PRIMARY_TEAM_ID = 1;

async function main() {
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });
  let allPassed = false;

  try {
    // TD/admin session — used to seed the secondary tournament and to
    // snapshot/restore PLAYER14's user doc.
    const tdPage = await browser.newPage();
    await login(tdPage, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);

    const player14Uid = await tdPage.evaluate(async (email) => {
      const snap = await firebase.firestore().collection('users').where('email', '==', email).limit(1).get();
      return snap.empty ? null : snap.docs[0].id;
    }, process.env.PLAYER14_EMAIL);
    assert(player14Uid, 'PLAYER14_EMAIL must resolve to a real user doc (check .env.e2e)');

    // Snapshot PLAYER14's user doc so we can fully restore it afterward —
    // clicking "Set as primary" overwrites assignedTournamentId/
    // assignedTeamId/assignedTeamName/assignedPlayerId/isPlayer/appointedAt/
    // appointedBy, all pre-existing top-level fields, so a plain `.set()`
    // with the original snapshot (no merge) restores exactly.
    const originalUserDoc = await tdPage.evaluate(async (uid) => {
      const doc = await firebase.firestore().collection('users').doc(uid).get();
      return doc.data();
    }, player14Uid);
    assert(originalUserDoc, `PLAYER14's user doc (uid ${player14Uid}) must exist`);
    assert(originalUserDoc.assignedTournamentId === PRIMARY_TOURNAMENT_ID,
      `Expected PLAYER14's baseline primary to be ${PRIMARY_TOURNAMENT_ID}, got ${originalUserDoc.assignedTournamentId} — ` +
      `harness assumption changed, update this test's PRIMARY_TOURNAMENT_ID/PRIMARY_TEAM_ID constants.`);

    // Idempotently ensure the secondary tournament exists with PLAYER14 on
    // a team whose id is DIFFERENT from their team id in the primary
    // tournament (1) — a same-valued id would hide a stale-teamId bug.
    await tdPage.evaluate(async (tournamentId, teamId, uid) => {
      const db = firebase.firestore();
      const ref = db.collection('tournaments').doc(tournamentId);
      const existing = await ref.get();
      if (existing.exists) return; // already seeded by a previous run
      const playerId = 'p_navsec_1';
      await ref.set({
        name: 'E2E Navbar Secondary',
        status: 'setup',
        createdAt: new Date().toISOString(),
        teams: [
          { id: teamId, name: 'Team NavSecondary', players: [{ id: playerId, uid, name: 'E2ePlayer14' }] }
        ],
        players: {
          [playerId]: { id: playerId, uid, name: 'E2ePlayer14', teamId, createdAt: new Date().toISOString() }
        }
      });
    }, SECONDARY_TOURNAMENT_ID, SECONDARY_TEAM_ID, player14Uid);

    let allAssertionsPassed = false;
    try {
      // Player session — the actual UI flow under test. A desktop-sized
      // viewport is required: below navbar.css's mobile breakpoint, nav
      // links collapse into an off-screen slide-out menu (only reachable
      // via the hamburger toggle) and Puppeteer refuses to click a
      // non-visible element.
      const page = await newLoggedInPage(browser, baseUrl, process.env.PLAYER14_EMAIL, process.env.PLAYER14_PASSWORD);
      await page.setViewport({ width: 1280, height: 900 });

      await page.goto(`${baseUrl}/full/home.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });

      // Wait for both tournament cards to render.
      await page.waitForSelector(`#tcard-${PRIMARY_TOURNAMENT_ID}`, { timeout: 20000 });
      await page.waitForSelector(`#tcard-${SECONDARY_TOURNAMENT_ID}`, { timeout: 20000 });

      // Baseline sanity: cached storage should reflect the original primary
      // (tournament A / team 1) after the first real page load.
      const baseline = await page.evaluate(() => ({
        tournamentId: sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId'),
        teamId: sessionStorage.getItem('currentTeamId') || localStorage.getItem('currentTeamId')
      }));
      console.log('Baseline cached nav context:', baseline);
      assert(baseline.tournamentId === PRIMARY_TOURNAMENT_ID, `Baseline currentTournamentId should be ${PRIMARY_TOURNAMENT_ID}, got ${baseline.tournamentId}`);
      assert(String(baseline.teamId) === String(PRIMARY_TEAM_ID), `Baseline currentTeamId should be ${PRIMARY_TEAM_ID}, got ${baseline.teamId}`);

      // Click "Set as primary" on the SECONDARY tournament's card. Must be
      // scoped to the title attribute, not just "any enabled button in the
      // card" — each card also has an "Enter" button before the star button
      // in document order (home.html ~1337-1338), and for a player role with
      // a teamId, "Enter" does a full-page navigation straight to
      // team.html, which would blow past this whole test.
      await page.click(`#tcard-${SECONDARY_TOURNAMENT_ID} button[title="Set as your primary tournament"]`);

      // Wait for the card to re-render as primary (loadRecentTournaments()
      // re-runs at the end of setPrimaryTournament, after the Firestore
      // write + storage sync have both completed).
      await page.waitForSelector(`#tcard-${SECONDARY_TOURNAMENT_ID} button[disabled]`, { timeout: 20000 });

      const cacheImmediatelyAfterSwitch = await page.evaluate(() => ({
        tournamentId: sessionStorage.getItem('currentTournamentId') || localStorage.getItem('currentTournamentId'),
        teamId: sessionStorage.getItem('currentTeamId') || localStorage.getItem('currentTeamId')
      }));
      console.log('Cached nav context immediately after Set as primary:', cacheImmediatelyAfterSwitch);

      // Reload — this is what actually exercises buildNavUrl() against
      // whatever ended up in storage; the pre-switch navbar render (still
      // showing the OLD href) is not itself the bug under test.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
      await page.waitForSelector('.navbar-link[data-page="team"]', { timeout: 20000 });

      const myTeamHref = await page.$eval('.navbar-link[data-page="team"]', a => a.getAttribute('href'));
      console.log('"My Team" nav link href after reload:', myTeamHref);

      // Click it and capture the resulting URL right after navigation
      // commits — before team-controls.js's async "team not found"/"not a
      // member" guard (which fires after a Firestore round trip) can redirect
      // away, so we're asserting exactly what buildNavUrl() produced.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('.navbar-link[data-page="team"]')
      ]);
      const resultUrl = new URL(page.url());
      console.log('Navigated to:', resultUrl.href);

      const gotTournamentId = resultUrl.searchParams.get('tournamentId');
      const gotTeamId = resultUrl.searchParams.get('teamId');

      assert(gotTournamentId === SECONDARY_TOURNAMENT_ID,
        `"My Team" link should navigate with the NEW primary tournamentId (${SECONDARY_TOURNAMENT_ID}), got ${gotTournamentId}`);
      assert(String(gotTeamId) === String(SECONDARY_TEAM_ID),
        `"My Team" link should navigate with the NEW primary teamId (${SECONDARY_TEAM_ID}), got ${gotTeamId} — ` +
        `this is the stale-cache bug: currentTeamId in storage still points at the OLD tournament's team.`);

      console.log('\nAll assertions passed — navbar correctly used the NEW primary tournament/team after Set as primary + reload.');
      allAssertionsPassed = true;
    } finally {
      // Restore PLAYER14's user doc to its exact original state regardless
      // of pass/fail, so a caught bug (or a deliberate pre-fix repro run)
      // never leaves the shared disposable account pointed at the
      // synthetic secondary tournament for other scripts to trip over.
      await tdPage.evaluate(async (uid, original) => {
        await firebase.firestore().collection('users').doc(uid).set(original);
      }, player14Uid, originalUserDoc);
      console.log("Restored PLAYER14's original user doc (assignedTournamentId/assignedTeamId/etc).");
    }

    allPassed = allAssertionsPassed;
  } finally {
    await browser.close();
    server.close();
  }

  if (!allPassed) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
