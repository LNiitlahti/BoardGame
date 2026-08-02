/**
 * e2e-next-up-availability.js — regression test for the "Next up" match
 * selection bug (see TODO.md's "HIGHER PRIORITY" entry).
 *
 * Bug: neither a Match slot's "Next up" pick (admin-improved-adapter.js's
 * _computeSlotStep) nor the global Match Queue panel's "NEXT" badge
 * (_highlightNextQueueItem) checked whether a candidate match's players
 * were already occupied in a currently-ongoing ('status: ongoing') match
 * elsewhere. Real repro from TODO.md: with #122 StarCraft II live (Demo +
 * Inffi(GOD) playing), Match 2's slot picked "#7 Age of Empires IV" as Next
 * Up — which ALSO had Demo + Inffi(GOD) on it — skipping over "#8", which
 * had zero player overlap with the live match and was clearly available.
 * The queue's own NEXT badge disagreed too (pointed at "#2", also
 * conflicting) — neither indicator filtered for player availability.
 *
 * Fix: admin-improved-adapter.js now excludes any pending match sharing a
 * player with a live/ongoing match from BOTH selection points via a shared
 * _excludeLiveConflicts()/getPlayersInLiveMatches() helper (see that file
 * and match-queue-manager.js), instead of blindly taking queue-order [0].
 *
 * This test drives full/admin.html directly (not god.html) because both
 * buggy functions live only in admin-improved-adapter.js, which admin.html
 * loads and god.html does not. It seeds gameState.gameQueue/currentPhase
 * IN-MEMORY ONLY (no saveGameState() call — this test never persists to
 * Firestore) via the page's bare `gameState` binding, the same "stable
 * object reference kept in sync by Object.assign" pattern documented in
 * E2E_HARNESS.md for god.html's window.godApp.gameState. It then calls the
 * page's global updateDisplay() (normally invoked by the Firestore
 * onSnapshot listener) to force a synchronous re-render, and inspects the
 * resulting DOM:
 *   - Match 2's slot card's ".match-slot-guidance" text (the "Next up: ..."
 *     line) must reference the non-conflicting candidate match, not the
 *     conflicting one.
 *   - The Match Queue panel's ".next-up" highlighted item must be the
 *     non-conflicting candidate's data-queue-id, not the conflicting one's
 *     or the live match's.
 *
 * Scenario seeded (mirrors the TODO.md repro):
 *   - Match #990101 (slot 1): status 'ongoing', players P_A + P_B live.
 *   - Match #990102 (slot 2, listed FIRST in queue order): pending, shares
 *     player P_A with the live match — must be SKIPPED as "next".
 *   - Match #990103 (slot 2, listed SECOND): pending, players P_D + P_E,
 *     zero overlap with the live match — must be picked as "next" even
 *     though it's not queue-order-first.
 *
 * Restores the original in-memory gameState.gameQueue/currentPhase in a
 * `finally` block (belt-and-suspenders — no Firestore write ever happens,
 * so there is nothing to leave behind in e2e-disposable-1 regardless, but
 * this keeps the live page's own state consistent if anything after this
 * script were to inspect it before closing).
 *
 * Run: cd BoardGame && node dev/tests/e2e-next-up-availability.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const tournamentId = process.env.TEST_TOURNAMENT_ID || 'e2e-disposable-1';

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });
  let allPassed = false;

  try {
    const page = await browser.newPage();
    await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(page, baseUrl, 'full/admin.html', tournamentId);

    // gameState is a bare top-level `let` in admin.js (not window.gameState),
    // but page.evaluate/waitForFunction execute in the same page realm, so
    // referencing it as a bare identifier works — same trick E2E_HARNESS.md
    // documents for god.html's window.godApp.gameState, just without the
    // `window.` prefix here.
    await page.waitForFunction(
      () => typeof gameState !== 'undefined' && gameState && Array.isArray(gameState.teams) && gameState.teams.length > 0,
      { timeout: 40000 }
    );
    // Give the flow panel adapter (admin-improved-adapter.js) a moment to
    // run its first _onAdminDisplayUpdate() off the initial snapshot, so
    // its internal _phaseManager is initialized before we seed anything.
    await page.waitForFunction(
      () => !!document.getElementById('flowPanel'),
      { timeout: 20000 }
    );

    const original = await page.evaluate(() => ({
      gameQueue: JSON.parse(JSON.stringify(gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(gameState.currentPhase || null))
    }));

    let outcome;
    try {
      outcome = await page.evaluate(async () => {
        const ROUND = 999002; // distinctive round number, won't collide with real data
        const now = new Date().toISOString();
        const phaseStartedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        gameState.currentPhase = {
          name: 'matches_in_progress',
          roundNumber: ROUND,
          startedAt: phaseStartedAt,
          slots: { 1: 'playing', 2: 'playing' }
        };

        const liveMatch = {
          id: 990101001,
          matchNumber: 990101,
          game: 'e2e-test-game-live',
          playType: '1v1',
          teams: [
            { id: 'TEAM_A', playerIds: ['e2e_p_A'] },
            { id: 'TEAM_B', playerIds: ['e2e_p_B'] }
          ],
          status: 'ongoing',
          createdAt: now,
          roundNumber: ROUND,
          slot: 1
        };

        // Listed FIRST (queue-order priority) but conflicts with the live
        // match via player e2e_p_A — must be SKIPPED.
        const conflictingCandidate = {
          id: 990102001,
          matchNumber: 990102,
          game: 'e2e-test-game-conflict',
          playType: '1v1',
          teams: [
            { id: 'TEAM_A', playerIds: ['e2e_p_A'] },
            { id: 'TEAM_C', playerIds: ['e2e_p_C'] }
          ],
          status: 'pending',
          createdAt: now,
          roundNumber: ROUND,
          slot: 2
        };

        // Listed SECOND but has zero player overlap with the live match —
        // must be the one actually picked as "next".
        const availableCandidate = {
          id: 990103001,
          matchNumber: 990103,
          game: 'e2e-test-game-available',
          playType: '1v1',
          teams: [
            { id: 'TEAM_D', playerIds: ['e2e_p_D'] },
            { id: 'TEAM_E', playerIds: ['e2e_p_E'] }
          ],
          status: 'pending',
          createdAt: now,
          roundNumber: ROUND,
          slot: 2
        };

        gameState.gameQueue = [liveMatch, conflictingCandidate, availableCandidate];

        // Force a synchronous re-render (same call the real Firestore
        // onSnapshot listener makes) without touching Firestore at all.
        updateDisplay();

        // --- Read back Match 2's slot card guidance text ---
        const slotPanels = Array.from(document.querySelectorAll('#matchSlotCards .match-slot-panel'));
        const slot2Panel = slotPanels.find(el => {
          const nameEl = el.querySelector('.match-slot-name');
          return nameEl && nameEl.textContent.includes('Match 2');
        });
        const slot2GuidanceText = slot2Panel
          ? slot2Panel.querySelector('.match-slot-guidance')?.textContent || ''
          : null;

        // --- Read back the global Match Queue panel's NEXT-badge target ---
        const nextUpItems = Array.from(document.querySelectorAll('#matchQueue .queue-item.next-up'));
        const nextUpQueueIds = nextUpItems.map(el => el.dataset.queueId);

        return {
          slot2Panel: !!slot2Panel,
          slot2GuidanceText,
          nextUpQueueIds,
          matchIds: {
            live: String(liveMatch.id),
            conflicting: String(conflictingCandidate.id),
            available: String(availableCandidate.id)
          },
          matchNumbers: {
            conflicting: conflictingCandidate.matchNumber,
            available: availableCandidate.matchNumber
          }
        };
      });

      console.log('--- Slot 2 guidance text ---');
      console.log(outcome.slot2GuidanceText);
      console.log('--- NEXT-badge queue-item id(s) ---');
      console.log(outcome.nextUpQueueIds);

      assert(outcome.slot2Panel, 'Match 2 slot card should be present in #matchSlotCards');

      assert(
        outcome.slot2GuidanceText.includes(String(outcome.matchNumbers.available)),
        `Slot 2's Next-up guidance should reference the non-conflicting match (#${outcome.matchNumbers.available}), got: "${outcome.slot2GuidanceText}"`
      );
      assert(
        !outcome.slot2GuidanceText.includes(String(outcome.matchNumbers.conflicting)),
        `Slot 2's Next-up guidance should NOT reference the player-conflicting match (#${outcome.matchNumbers.conflicting}), got: "${outcome.slot2GuidanceText}"`
      );

      assert(
        outcome.nextUpQueueIds.includes(outcome.matchIds.available),
        `The Match Queue panel's NEXT badge should highlight the non-conflicting match (id ${outcome.matchIds.available}), got: ${JSON.stringify(outcome.nextUpQueueIds)}`
      );
      assert(
        !outcome.nextUpQueueIds.includes(outcome.matchIds.conflicting),
        `The Match Queue panel's NEXT badge should NOT highlight the player-conflicting match (id ${outcome.matchIds.conflicting}), got: ${JSON.stringify(outcome.nextUpQueueIds)}`
      );
      assert(
        !outcome.nextUpQueueIds.includes(outcome.matchIds.live),
        `The Match Queue panel's NEXT badge should never highlight an already-live match (id ${outcome.matchIds.live}), got: ${JSON.stringify(outcome.nextUpQueueIds)}`
      );

      console.log('\nAll assertions passed.');
      allPassed = true;
    } finally {
      // Restore in-memory state. No Firestore write ever happened in this
      // test (seeding + assertions are pure in-memory + DOM), so there is
      // nothing in e2e-disposable-1 to clean up server-side — this is just
      // hygiene for the live page object before the browser closes.
      await page.evaluate((orig) => {
        gameState.gameQueue = orig.gameQueue;
        gameState.currentPhase = orig.currentPhase;
        if (typeof updateDisplay === 'function') updateDisplay();
      }, original);
      console.log('Restored original in-memory gameQueue/currentPhase (no Firestore write was made).');
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
