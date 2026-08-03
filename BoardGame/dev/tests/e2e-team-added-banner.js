/**
 * e2e-team-added-banner.js — regression test for TODO.md Task 16:
 * "home.html team-added banner missing tournament name + dismissable check".
 *
 * Root cause (confirmed by reading the current code, not TODO.md's
 * paraphrase — see E2E_HARNESS.md's "read current state" convention):
 * `checkNewAssignment()` (full/home.html ~978-1021) rendered its banner as
 * `You've been added to ${userData.assignedTeamName}! Start onboarding...` —
 * team name only, no tournament name, ambiguous for a player linked into
 * more than one tournament at once. The "×" close button
 * (`dismissNewAssignmentBanner()`, home.html ~1017-1021) was ALREADY fully
 * functional and already persisted the dismissal correctly: it calls
 * `markAssignmentSeen()`, which writes `onboardingPromptSeenAt` to the
 * user's Firestore doc, and `checkNewAssignment()`'s own re-show guard
 * (`isNew = !seenAt || new Date(seenAt) < new Date(userData.appointedAt)`)
 * is scoped per-appointment: a dismissal only suppresses THIS appointment
 * (`appointedAt` stays in the past relative to the new `seenAt`), and a
 * genuinely new assignment (appointedAt stamped forward again, whether same
 * team re-assigned or a different one) naturally reopens the banner because
 * seenAt is now older than the new appointedAt. This was independently
 * corroborated by docs/guides/TOURNAMENT_FLOW_BUG_TRACKER.md's existing
 * note that this banner "correctly marks itself seen... so it won't nag
 * again". So this test's fix is scoped to the actual gap: banner text now
 * also resolves and shows the tournament's display name (fetched via a
 * `tournaments/{assignedTournamentId}` read, independent of any other
 * concurrent load — see the comment above `checkNewAssignment()`).
 *
 * This test:
 *  1. Seeds PLAYER14's user doc with a fresh appointment into
 *     `e2e-navbar-secondary` (a lasting fixture from Task 11's
 *     e2e-navbar-primary-switch.js — PLAYER14 already has a real roster
 *     slot there: team id 55 "Team NavSecondary", player id "p_navsec_1").
 *     Deliberately NOT `e2e-disposable-1`, whose tournament doc's `name`
 *     field happens to equal its id — asserting on that would pass even if
 *     the fix silently fell back to interpolating the id instead of a real
 *     `.name` lookup. `e2e-navbar-secondary`'s name ("E2E Navbar Secondary")
 *     is visibly different from its id, so the assertion only passes if the
 *     Firestore `.name` field is genuinely being read.
 *  2. Logs in as PLAYER14, loads home.html, asserts the banner becomes
 *     visible with text containing BOTH the team name and the tournament
 *     name.
 *  3. Clicks the real "×" close button, asserts the banner disappears.
 *  4. Reloads the page, asserts the banner stays gone (proves the Firestore
 *     dismissal persisted and is read back correctly on the next load).
 *  5. Self-review / scoping check: bumps `appointedAt` forward again
 *     (simulating a second, later re-assignment) and reloads, asserting the
 *     banner DOES reappear — proving the dismissal persistence is scoped to
 *     the specific appointment, not a blanket "never show this user a
 *     banner again" flag that would incorrectly suppress a future genuine
 *     reassignment.
 *
 * PLAYER14's user doc is snapshotted/restored in a `finally` block (same
 * pattern as e2e-navbar-primary-switch.js), since e2e-ready-check.js depends
 * on its baseline pointing at e2e-disposable-1/Team Alpha.
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

    // Snapshot PLAYER14's user doc for a full, exact restore regardless of
    // pass/fail.
    const originalUserDoc = await tdPage.evaluate(async (uid) => {
      const doc = await firebase.firestore().collection('users').doc(uid).get();
      return doc.data();
    }, player14Uid);
    assert(originalUserDoc, `PLAYER14's user doc (uid ${player14Uid}) must exist`);

    let allAssertionsPassed = false;
    try {
      // Seed a fresh "just appointed" state: assignedTeamId/Name/PlayerId/
      // TournamentId pointing at the secondary fixture, appointedAt just
      // now, onboardingPromptSeenAt cleared (never dismissed).
      const firstAppointedAt = new Date().toISOString();
      await tdPage.evaluate(async (uid, data) => {
        await firebase.firestore().collection('users').doc(uid).update({
          assignedTournamentId: data.tournamentId,
          assignedTeamId: data.teamId,
          assignedTeamName: data.teamName,
          assignedPlayerId: data.playerId,
          appointedAt: data.appointedAt,
          onboardingPromptSeenAt: firebase.firestore.FieldValue.delete()
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

      // dismissNewAssignmentBanner() fires an async markAssignmentSeen()
      // Firestore write it does not await from the onclick handler — poll
      // the user doc via the TD session rather than racing a fixed sleep.
      await new Promise(resolve => setTimeout(resolve, 250));
      let seenAtAfterDismiss = null;
      for (let i = 0; i < 20; i++) {
        seenAtAfterDismiss = await tdPage.evaluate(async (uid) => {
          const doc = await firebase.firestore().collection('users').doc(uid).get();
          return doc.data().onboardingPromptSeenAt || null;
        }, player14Uid);
        if (seenAtAfterDismiss) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert(seenAtAfterDismiss, 'onboardingPromptSeenAt should be persisted to Firestore after clicking close.');
      assert(new Date(seenAtAfterDismiss) >= new Date(firstAppointedAt),
        `Persisted onboardingPromptSeenAt (${seenAtAfterDismiss}) should be at/after appointedAt (${firstAppointedAt}).`);

      // Reload — the core "stays dismissed" regression check.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
      // Give checkNewAssignment() a moment to run (it's invoked from
      // loadUserProfile, awaited inside the page's own Promise.all) and
      // confirm it does NOT show the banner again.
      await page.waitForFunction(() => !!document.getElementById('homeUserName')?.textContent && document.getElementById('homeUserName').textContent !== '...', { timeout: 20000 });
      await new Promise(resolve => setTimeout(resolve, 1500));
      state = await getBannerState(page);
      assert(!state.visible, `Banner should stay dismissed after reload, but was visible with text: "${state.text}"`);
      console.log('Banner correctly stayed dismissed after reload.');

      // Self-review / scoping check: a genuinely NEW appointment (appointedAt
      // moved forward again) must still reopen the banner — the persisted
      // dismissal must be scoped to the specific appointment it was shown
      // for, not a blanket "never show this user any team-added banner
      // again" flag.
      const secondAppointedAt = new Date(Date.now() + 5000).toISOString();
      await tdPage.evaluate(async (uid, appointedAt) => {
        await firebase.firestore().collection('users').doc(uid).update({ appointedAt });
      }, player14Uid, secondAppointedAt);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
      await page.waitForFunction(() => {
        const b = document.getElementById('newAssignmentBanner');
        return !!b && b.style.display === 'flex';
      }, { timeout: 20000 });
      state = await getBannerState(page);
      console.log('Banner text after a second, later re-appointment:', state.text);
      assert(state.visible, 'Banner should reappear for a genuinely new (later) appointment, even though the previous one was dismissed.');
      assert(state.text.includes(SECONDARY_TEAM_NAME) && state.text.includes(SECONDARY_TOURNAMENT_NAME),
        `Re-shown banner text should still include both names, got: "${state.text}"`);

      console.log('\nAll assertions passed:');
      console.log('  - banner text includes both tournament name and team name');
      console.log('  - close button hides the banner and persists the dismissal to Firestore');
      console.log('  - dismissal survives a reload');
      console.log('  - dismissal is scoped per-appointment: a later re-appointment still re-shows the banner');
      allAssertionsPassed = true;
    } finally {
      await tdPage.evaluate(async (uid, original) => {
        await firebase.firestore().collection('users').doc(uid).set(original);
      }, player14Uid, originalUserDoc);
      console.log("Restored PLAYER14's original user doc (assignedTournamentId/assignedTeamId/appointedAt/onboardingPromptSeenAt/etc).");
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
