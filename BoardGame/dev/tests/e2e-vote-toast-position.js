/**
 * e2e-vote-toast-position.js — regression test for TODO.md Task 14
 * ("team.html: the vote-submitted notification/toast overlaps the team
 * scores section. Move it lower on the screen ... Purely visual — vote
 * itself registered correctly, no console errors.").
 *
 * Root cause (confirmed by reading, not guessed from the wording):
 * team.html's vote-submitted message is NOT the shared `shared/scripts/
 * toast.js` `showToast()` (that file isn't even loaded by team.html — only
 * statistics.html/onboarding.html/god.html/admin.html load it). It's a
 * page-local function, `showStatus()` (full/scripts/team-controls.js
 * ~2179), which just sets text/class on a single already-in-the-DOM
 * `#statusMessage` element (`full/team.html` ~line 49,
 * `<div class="team-status-message" id="statusMessage">`) and toggles
 * `display: block`. `submitVote()` (team-controls.js ~1573) calls
 * `showStatus('Vote submitted successfully!', 'success')` on the
 * non-consensus path (the common case — see below).
 *
 * The overlap: `.team-status-message` (full/css/team-modern.css, was line
 * 227-233) was `position: fixed; top: 4.5rem` (72px), centered
 * horizontally. `.score-strip` (`#scoreStrip`, team-modern.css ~107) is the
 * FIRST element inside `.team-container`, which sits right below the fixed
 * 60px navbar (`body.team-page { padding-top: 4rem }` = 64px) plus the
 * container's own 20px padding — so the score strip starts at ~84px from
 * the top of the viewport and is 56px tall (84-140px). The toast's fixed
 * 72px top put it directly on top of that range on every page load, since
 * the score strip is always the first thing rendered on team.html
 * (regardless of match/phase state), while the toast's own height varies
 * with message length. This is NOT the shared toast.js component (unlike
 * god.html/admin.html's `showStatus()`, which delegates to
 * `shared/scripts/toast.js`'s `showToast()` per an existing harness
 * gotcha) — team.html's `showStatus`/`#statusMessage`/`.team-status-message`
 * are entirely local to this one page (confirmed: `team-status-message` as
 * a selector appears nowhere else except a dead, inapplicable
 * `body.dark-mode .team-status-message` rule in shared/css/dark-theme.css,
 * which only replay.html loads and only applies under a `dark-mode` body
 * class team.html's body never has) — so the fix below is safe to make
 * page-scoped without any risk of regressing god.html/admin.html's actual
 * shared toast.js component or its CSS.
 *
 * Fix: `.team-status-message` now anchors to the BOTTOM of the viewport
 * (`bottom: 24px` instead of `top: 4.5rem`), so it can never overlap the
 * score strip (or the phase banner, or the match-panel overlay header)
 * that all live at the TOP of the page, regardless of message length or
 * page state. The `slideIn` keyframe (previously sliding down from -8px)
 * was flipped to slide up from +8px to match the new bottom anchor. No
 * fixed-bottom UI exists anywhere else on team.html (checked: only other
 * `position: fixed` rules in team-modern.css are the navbar import,
 * `.modal` (full-viewport centered overlay), and `.lobby-overlay`
 * (full-viewport centered overlay) — none anchor content to the bottom
 * edge), and the voting section itself (`#votingSection`/`#submitVoteBtn`)
 * sits near the TOP of the right sidebar column, not the bottom, so the
 * bottom-anchored toast doesn't cover the very button the player just
 * clicked either.
 *
 * Test flow against e2e-disposable-1's real Team Alpha (id 1: "TD (E2E)" +
 * "E2ePlayer14", both real linked accounts) vs Team Beta (id 2: two
 * unlinked placeholders) — same roster e2e-team-match-panel-merge.js (Task
 * 13) uses:
 *
 *   1. Seed one real-shaped `gameQueue` entry: `status: 'ongoing'`,
 *      `adminConfirmed: false`, `teams: [{id:'TEAM_A', playerIds:[player14,
 *      tdE2E]}, {id:'TEAM_B', playerIds:[placeholderA, placeholderB]}]`,
 *      `votes: []`. This alone is enough for `checkForVoting()` to show the
 *      voting section for E2ePlayer14 — no `currentPhase`/slot state needs
 *      touching at all (unlike the Task 13 test), since `checkForVoting()`
 *      only looks at `gameQueue` directly.
 *   2. Log in as E2ePlayer14, open team.html?teamId=1, wait for the voting
 *      section to show real vote options (2 sides = 4 total match players,
 *      so a single vote is 25% — below the 90% consensus threshold, so
 *      `submitVote()` takes the plain "Vote submitted successfully!"
 *      success path, matching TODO.md's exact repro).
 *   3. Screenshot BEFORE (voting section open, no toast yet).
 *   4. Click a vote option, click Submit Vote, wait for `#statusMessage`
 *      to become visible with the expected text.
 *   5. Screenshot AFTER (toast visible).
 *   6. Assert via `getBoundingClientRect()` that the toast's box and the
 *      score-strip's box do not intersect — the actual regression check,
 *      not just an eyeball of the screenshots.
 *   7. Self-review check baked into the assertions: also grab the phase
 *      banner's and the navbar's rects and confirm the toast doesn't
 *      intersect those either (proving the fix didn't just relocate the
 *      overlap onto some OTHER top-of-page element).
 *
 * Snapshots/restores `gameQueue` in a `finally` block (array field — plain
 * reassign+save restore is sufficient, no map-field leak risk here).
 *
 * Screenshots are throwaway visual-review artifacts written to
 * dev/tests/task14-vote-toast-*.png — not committed (gitignored alongside
 * every other dev/tests/*.png in this harness).
 *
 * Run: cd BoardGame && node dev/tests/e2e-vote-toast-position.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function rectsIntersect(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function main() {
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const tournamentId = process.env.TEST_TOURNAMENT_ID || 'e2e-disposable-1';

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });
  let allPassed = false;

  try {
    const tdPage = await browser.newPage();
    await login(tdPage, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(tdPage, baseUrl, 'full/god.html', tournamentId);

    await tdPage.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    const roster = await tdPage.evaluate(() => {
      const teamAlpha = window.godApp.gameState.teams.find(t => String(t.id) === '1');
      const teamBeta = window.godApp.gameState.teams.find(t => String(t.id) === '2');
      return {
        teamAlpha: teamAlpha ? teamAlpha.players.map(p => ({ id: p.id, uid: p.uid, name: p.name })) : null,
        teamBeta: teamBeta ? teamBeta.players.map(p => ({ id: p.id, uid: p.uid, name: p.name })) : null
      };
    });
    const tdE2E = roster.teamAlpha?.find(p => p.name === 'TD (E2E)' && p.uid);
    const player14 = roster.teamAlpha?.find(p => p.name === 'E2ePlayer14' && p.uid);
    const placeholderA = roster.teamBeta?.find(p => p.name === 'Placeholder A');
    const placeholderB = roster.teamBeta?.find(p => p.name === 'Placeholder B');
    assert(tdE2E, `Expected Team Alpha to have a real-linked "TD (E2E)" player, got: ${JSON.stringify(roster.teamAlpha)}`);
    assert(player14, `Expected Team Alpha to have a real-linked "E2ePlayer14" player, got: ${JSON.stringify(roster.teamAlpha)}`);
    assert(placeholderA && placeholderB, `Expected Team Beta to have two placeholder players, got: ${JSON.stringify(roster.teamBeta)}`);
    assert(process.env.PLAYER14_EMAIL && process.env.PLAYER14_PASSWORD,
      'PLAYER14_EMAIL/PLAYER14_PASSWORD must be set in .env.e2e to log in as E2ePlayer14');

    const originalQueue = await tdPage.evaluate(() =>
      JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || []))
    );

    try {
      // ============================================================
      // Seed a real 'ongoing' match with no votes yet
      // ============================================================
      await tdPage.evaluate((ids) => {
        const gs = window.godApp.gameState;
        const now = new Date().toISOString();

        const match = {
          id: Date.now(),
          matchNumber: 999501,
          game: 'e2e-test-game',
          playType: '2v2',
          teams: [
            { id: 'TEAM_A', playerIds: [ids.player14Id, ids.tdE2EId] },
            { id: 'TEAM_B', playerIds: [ids.placeholderAId, ids.placeholderBId] }
          ],
          votes: [],
          adminConfirmed: false,
          status: 'ongoing',
          createdAt: now,
          roundNumber: 999501,
          slot: 1
        };

        gs.gameQueue = [match];
        return window.godApp.saveGameState();
      }, {
        player14Id: player14.id, tdE2EId: tdE2E.id,
        placeholderAId: placeholderA.id, placeholderBId: placeholderB.id
      });

      const playerContext = await browser.createBrowserContext();
      const playerPage = await playerContext.newPage();
      await playerPage.setViewport({ width: 1280, height: 900 });
      await login(playerPage, baseUrl, process.env.PLAYER14_EMAIL, process.env.PLAYER14_PASSWORD);
      await gotoTournamentPage(playerPage, baseUrl, 'full/team.html', tournamentId, '&teamId=1');

      await playerPage.waitForFunction(
        () => typeof teamData !== 'undefined' && teamData && Array.isArray(teamData.players),
        { timeout: 40000 }
      );

      // Voting section should show real options for our seeded match
      await playerPage.waitForFunction(
        () => {
          const opts = document.getElementById('voteOptions');
          return opts && opts.querySelectorAll('.vote-option').length === 2;
        },
        { timeout: 15000 }
      );

      const beforeState = await playerPage.evaluate(() => ({
        statusDisplay: getComputedStyle(document.getElementById('statusMessage')).display,
        scoreStripRect: document.getElementById('scoreStrip').getBoundingClientRect().toJSON()
      }));
      console.log('--- BEFORE vote submit ---', JSON.stringify(beforeState));
      assert(beforeState.statusDisplay === 'none', 'BEFORE: toast should not be visible before submitting a vote');

      await playerPage.screenshot({ path: path.resolve(__dirname, 'task14-vote-toast-before.png') });
      console.log('Screenshot saved: dev/tests/task14-vote-toast-before.png');

      // ============================================================
      // Click a vote option, submit, wait for the toast
      // ============================================================
      await playerPage.click('#voteOptions .vote-option:first-of-type');
      await playerPage.click('#submitVoteBtn');

      await playerPage.waitForFunction(
        () => {
          const el = document.getElementById('statusMessage');
          return el && getComputedStyle(el).display !== 'none' && /vote submitted/i.test(el.textContent || '');
        },
        { timeout: 15000 }
      );

      const afterState = await playerPage.evaluate(() => {
        const toastEl = document.getElementById('statusMessage');
        const scoreStripEl = document.getElementById('scoreStrip');
        const phaseBannerEl = document.getElementById('phaseBanner');
        const navbarEl = document.querySelector('.unified-navbar');
        return {
          toastText: toastEl.textContent.trim(),
          toastRect: toastEl.getBoundingClientRect().toJSON(),
          scoreStripRect: scoreStripEl.getBoundingClientRect().toJSON(),
          phaseBannerRect: phaseBannerEl ? phaseBannerEl.getBoundingClientRect().toJSON() : null,
          phaseBannerDisplay: phaseBannerEl ? getComputedStyle(phaseBannerEl).display : null,
          navbarRect: navbarEl ? navbarEl.getBoundingClientRect().toJSON() : null
        };
      });
      console.log('--- AFTER vote submit ---', JSON.stringify(afterState, null, 2));

      await playerPage.screenshot({ path: path.resolve(__dirname, 'task14-vote-toast-after.png') });
      console.log('Screenshot saved: dev/tests/task14-vote-toast-after.png');

      assert(/vote submitted successfully/i.test(afterState.toastText),
        `Expected the plain non-consensus success message (a single vote out of 4 match players = 25%, below the 90% consensus threshold), got: "${afterState.toastText}"`);

      // The actual regression check: toast box must not intersect the score strip
      assert(!rectsIntersect(afterState.toastRect, afterState.scoreStripRect),
        `REGRESSION: toast rect ${JSON.stringify(afterState.toastRect)} intersects score-strip rect ${JSON.stringify(afterState.scoreStripRect)}`);

      // Self-review: confirm the fix didn't just relocate the overlap onto
      // the phase banner or the navbar instead.
      if (afterState.phaseBannerDisplay !== 'none' && afterState.phaseBannerRect) {
        assert(!rectsIntersect(afterState.toastRect, afterState.phaseBannerRect),
          `REGRESSION: toast rect ${JSON.stringify(afterState.toastRect)} intersects phase-banner rect ${JSON.stringify(afterState.phaseBannerRect)}`);
      }
      assert(!rectsIntersect(afterState.toastRect, afterState.navbarRect),
        `REGRESSION: toast rect ${JSON.stringify(afterState.toastRect)} intersects navbar rect ${JSON.stringify(afterState.navbarRect)}`);

      console.log('\nAll assertions passed. Vote-submitted toast no longer overlaps the score strip (or the phase banner / navbar).\n');
      allPassed = true;

      await playerContext.close();
    } finally {
      await tdPage.evaluate((orig) => {
        window.godApp.gameState.gameQueue = orig;
        return window.godApp.saveGameState();
      }, originalQueue);
      console.log('Restored original gameQueue.');
    }
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
