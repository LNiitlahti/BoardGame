/**
 * e2e-team-added-banner.js — regression test for TODO.md Task 16:
 * "home.html team-added banner missing tournament name + dismissable check".
 *
 * Also covers a follow-up fix: the banner used to persist its dismissal to
 * Firestore (`onboardingPromptSeenAt`) forever, so clicking "×" made it
 * disappear for the rest of that appointment — including after a refresh.
 * That's wrong: the banner's job is to nag the player into onboarding
 * before the tournament starts, so a one-time dismissal shouldn't make it
 * disappear for good. `checkNewAssignment()` (full/home.html) now instead
 * gates purely on the assigned tournament's `status` field: it shows
 * whenever `status === 'setup'` (regardless of any prior dismissal) and
 * stops showing once the tournament leaves setup (e.g. `status: 'playing'`),
 * since onboarding is no longer actionable at that point.
 * `dismissNewAssignmentBanner()` only hides the banner in-memory for the
 * current page view — it no longer writes anything to Firestore.
 *
 * This test:
 *  1. Seeds PLAYER14's user doc with a fresh appointment into
 *     `e2e-navbar-secondary` (a lasting fixture from Task 11's
 *     e2e-navbar-primary-switch.js — PLAYER14 already has a real roster
 *     slot there: team id 55 "Team NavSecondary", player id "p_navsec_1",
 *     tournament status "setup"). Deliberately NOT `e2e-disposable-1`, whose
 *     tournament doc's `name` field happens to equal its id — asserting on
 *     that would pass even if the fix silently fell back to interpolating
 *     the id instead of a real `.name` lookup. `e2e-navbar-secondary`'s name
 *     ("E2E Navbar Secondary") is visibly different from its id, so the
 *     assertion only passes if the Firestore `.name` field is genuinely
 *     being read.
 *  2. Logs in as PLAYER14, loads home.html, asserts the banner becomes
 *     visible with text containing BOTH the team name and the tournament
 *     name.
 *  3. Clicks the real "×" close button, asserts the banner disappears.
 *  4. Reloads the page while the tournament is still in `setup`, asserts the
 *     banner is visible AGAIN — proving the dismissal is not persisted and
 *     the banner keeps nagging until the tournament actually starts.
 *  5. Flips the tournament's `status` to `'playing'` and reloads, asserting
 *     the banner no longer appears — proving the real gate is tournament
 *     phase, not a one-time-seen flag.
 *
 * PLAYER14's user doc AND e2e-navbar-secondary's tournament doc are
 * snapshotted/restored in `finally` blocks (same pattern as
 * e2e-navbar-primary-switch.js), since e2e-ready-check.js depends on
 * PLAYER14's baseline pointing at e2e-disposable-1/Team Alpha, and other
 * tests may depend on e2e-navbar-secondary staying in `setup`.
 *
 * Run: cd BoardGame && node dev/tests/e2e-team-added-banner.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, newLoggedInPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const SECONDARY_TOURNAMENT_ID = 'e2e-navbar-secondary';
const SECONDARY_TOURNAMENT_NAME = 'E2E Navbar Secondary';
const SECONDARY_TEAM_ID = 55;
const SECONDARY_TEAM_NAME = 'Team NavSecondary';
const SECONDARY_PLAYER_ID = 'p_navsec_1';

async function getBannerState(page) {
  return page.evaluate(() => {
    const banner = document.getElementById('newAssignmentBanner');
    const text = document.getElementById('newAssignmentText');
    return {
      visible: !!banner && banner.style.display === 'flex',
      text: text ? text.textContent : null
    };
  });
}

async function main() {
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });
  let allPassed = false;

  try {
    // TD/admin session — used to resolve PLAYER14's uid, confirm
    // e2e-navbar-secondary still exists (seeded by Task 11's script; this
    // test does not recreate it), and to snapshot/restore/re-seed PLAYER14's
    // user doc.
    const tdPage = await browser.newPage();
    await login(tdPage, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);

    const player14Uid = await tdPage.evaluate(async (email) => {
      const snap = await firebase.firestore().collection('users').where('email', '==', email).limit(1).get();
      return snap.empty ? null : snap.docs[0].id;
    }, process.env.PLAYER14_EMAIL);
    assert(player14Uid, 'PLAYER14_EMAIL must resolve to a real user doc (check .env.e2e)');

    const secondaryName = await tdPage.evaluate(async (tournamentId) => {
      const doc = await firebase.firestore().collection('tournaments').doc(tournamentId).get();
      return doc.exists ? doc.data().name : null;
    }, SECONDARY_TOURNAMENT_ID);
    assert(secondaryName === SECONDARY_TOURNAMENT_NAME,
      `Expected ${SECONDARY_TOURNAMENT_ID} (seeded by e2e-navbar-primary-switch.js) to exist with name ` +
      `"${SECONDARY_TOURNAMENT_NAME}", got "${secondaryName}" — run e2e-navbar-primary-switch.js first, or the ` +
      `fixture's name changed and this test's constant needs updating.`);

    // Snapshot PLAYER14's user doc AND the secondary tournament's doc for a
    // full, exact restore regardless of pass/fail (this test flips the
    // tournament's status, which other tests may depend on).
    const originalUserDoc = await tdPage.evaluate(async (uid) => {
      const doc = await firebase.firestore().collection('users').doc(uid).get();
      return doc.data();
    }, player14Uid);
    assert(originalUserDoc, `PLAYER14's user doc (uid ${player14Uid}) must exist`);

    const originalTournamentDoc = await tdPage.evaluate(async (tournamentId) => {
      const doc = await firebase.firestore().collection('tournaments').doc(tournamentId).get();
      return doc.data();
    }, SECONDARY_TOURNAMENT_ID);
    assert(originalTournamentDoc, `${SECONDARY_TOURNAMENT_ID} tournament doc must exist`);
    assert(originalTournamentDoc.status === 'setup',
      `Expected ${SECONDARY_TOURNAMENT_ID} to start this test in 'setup' status, got "${originalTournamentDoc.status}".`);

    let allAssertionsPassed = false;
    try {
      // Seed a fresh "just appointed" state: assignedTeamId/Name/PlayerId/
      // TournamentId pointing at the secondary fixture, appointedAt just
      // now.
      const firstAppointedAt = new Date().toISOString();
      await tdPage.evaluate(async (uid, data) => {
        await firebase.firestore().collection('users').doc(uid).update({
          assignedTournamentId: data.tournamentId,
          assignedTeamId: data.teamId,
          assignedTeamName: data.teamName,
          assignedPlayerId: data.playerId,
          appointedAt: data.appointedAt
        });
      }, player14Uid, {
        tournamentId: SECONDARY_TOURNAMENT_ID,
        teamId: SECONDARY_TEAM_ID,
        teamName: SECONDARY_TEAM_NAME,
        playerId: SECONDARY_PLAYER_ID,
        appointedAt: firstAppointedAt
      });

      const page = await newLoggedInPage(browser, baseUrl, process.env.PLAYER14_EMAIL, process.env.PLAYER14_PASSWORD);
      await page.setViewport({ width: 1280, height: 900 });

      await page.goto(`${baseUrl}/full/home.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });

      // checkNewAssignment() is now async (awaits a tournament-doc fetch
      // before showing the banner), so poll rather than assume it's visible
      // immediately after the page settles.
      await page.waitForFunction(() => {
        const b = document.getElementById('newAssignmentBanner');
        return !!b && b.style.display === 'flex';
      }, { timeout: 20000 });

      let state = await getBannerState(page);
      console.log('Banner text after fresh appointment:', state.text);
      assert(state.text.includes(SECONDARY_TEAM_NAME),
        `Banner text should include the team name "${SECONDARY_TEAM_NAME}", got: "${state.text}"`);
      assert(state.text.includes(SECONDARY_TOURNAMENT_NAME),
        `Banner text should include the tournament name "${SECONDARY_TOURNAMENT_NAME}" (not just the id ` +
        `"${SECONDARY_TOURNAMENT_ID}"), got: "${state.text}" — this is the core Task 16 fix.`);

      // Click the real "×" close button, scoped to this banner specifically
      // (the page also has an unrelated #homeNotice banner with its own
      // .home-notice-close button).
      await page.click('#newAssignmentBanner .home-notice-close');
      state = await getBannerState(page);
      assert(!state.visible, 'Banner should be hidden immediately after clicking the close button.');

      // Reload — dismissal must NOT persist. While the tournament is still
      // in 'setup', the banner should come back on the very next load.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
      await page.waitForFunction(() => {
        const b = document.getElementById('newAssignmentBanner');
        return !!b && b.style.display === 'flex';
      }, { timeout: 20000 });
      state = await getBannerState(page);
      assert(state.visible, `Banner should reappear after reload even though it was dismissed (dismissal is not persisted), but text was: "${state.text}"`);
      assert(state.text.includes(SECONDARY_TEAM_NAME) && state.text.includes(SECONDARY_TOURNAMENT_NAME),
        `Re-shown banner text should still include both names, got: "${state.text}"`);
      console.log('Banner correctly reappeared after reload despite prior dismissal.');

      // Flip the tournament to 'playing' — onboarding is no longer
      // actionable, so the banner must stop appearing even on a fresh load.
      await tdPage.evaluate(async (tournamentId) => {
        await firebase.firestore().collection('tournaments').doc(tournamentId).update({ status: 'playing' });
      }, SECONDARY_TOURNAMENT_ID);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
      await page.waitForFunction(() => !!document.getElementById('homeUserName')?.textContent && document.getElementById('homeUserName').textContent !== '...', { timeout: 20000 });
      await new Promise(resolve => setTimeout(resolve, 1500));
      state = await getBannerState(page);
      assert(!state.visible, `Banner should not show once the tournament has left 'setup' status, but was visible with text: "${state.text}"`);
      console.log("Banner correctly stayed hidden once the tournament's status left 'setup'.");

      console.log('\nAll assertions passed:');
      console.log('  - banner text includes both tournament name and team name');
      console.log('  - close button hides the banner for the current view only (not persisted)');
      console.log('  - banner reappears on reload while the tournament is still in setup');
      console.log("  - banner stops appearing once the tournament's status leaves 'setup'");
      allAssertionsPassed = true;
    } finally {
      await tdPage.evaluate(async (uid, original) => {
        await firebase.firestore().collection('users').doc(uid).set(original);
      }, player14Uid, originalUserDoc);
      await tdPage.evaluate(async (tournamentId, original) => {
        await firebase.firestore().collection('tournaments').doc(tournamentId).set(original);
      }, SECONDARY_TOURNAMENT_ID, originalTournamentDoc);
      console.log("Restored PLAYER14's original user doc and e2e-navbar-secondary's original tournament doc.");
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
