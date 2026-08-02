/**
 * e2e-round-advance.js — regression test for the "match slot never reaches
 * done" bug (see TODO.md's "CONFIRMED (not just a leftover-data caveat
 * anymore)" entry, and the fix in phase-manager.js's getSlotRequirements /
 * admin-improved-adapter.js's _pendingSlotMatches / _ongoingSlotMatches).
 *
 * Root cause: a queue entry with no `slot` tag counted as pending/ongoing
 * for BOTH match slots FOREVER, because "roundNumber is undefined" was
 * treated as "safe, always relevant" with no upper bound. A tournament with
 * a backlog of old untagged/stale-round matches could never get a slot to
 * report 'done', since there was always another stale entry to surface.
 *
 * This test seeds Match Slot 2 (in god.html, via window.godApp) with:
 *   - ONE real match, correctly tagged for the current round/slot, status
 *     'ongoing' (satisfies the "hasStarted" check).
 *   - THREE decoy matches that must NOT block the slot:
 *       1. Fully untagged (no slot, no roundNumber, no createdAt) — the
 *          oldest style of leftover, from before either field existed.
 *       2. Untagged but WITH createdAt, dated to before this round's
 *          matches-in-progress phase began — created-before-tagging-existed
 *          leftover that DOES have a timestamp.
 *       3. Tagged for this exact slot number (2) but from a stale prior
 *          round (roundNumber mismatch) — a match that was queued, never
 *          resolved, and left behind when the round moved on.
 *
 * It then confirms the real match via the actual confirm-result API
 * (ResultManager.quickConfirmResult, the same function the UI's confirm
 * button calls) and asserts:
 *   - BEFORE confirming: slot 2 requirements are NOT all met (the real
 *     match is still 'ongoing').
 *   - AFTER confirming: slot 2 requirements ARE all met, and specifically
 *     do NOT report any of the 3 decoys as "not started" / "still
 *     playing" — this is exactly what the pre-fix code got wrong (an
 *     indefinitely-growing pool of stale entries kept slot 2 from ever
 *     reporting done).
 *   - advanceSlot(2) succeeds and getSlotSubPhase(2) becomes 'done'.
 *
 * Uses `e2e-disposable-1` (TEST_TOURNAMENT_ID) per E2E_HARNESS.md — that
 * tournament is explicitly documented as safe for later tasks to reuse and
 * mutate. This script snapshots gameQueue/currentPhase beforehand and
 * restores them in a `finally` block regardless of pass/fail, so it leaves
 * no lasting mutation for other tests to trip over.
 *
 * Run: cd BoardGame && node dev/tests/e2e-round-advance.js
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
    await gotoTournamentPage(page, baseUrl, 'full/god.html', tournamentId);

    await page.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0 && window.godApp._currentTournamentId),
      { timeout: 40000 }
    );

    // Snapshot original state so we can restore it afterward.
    const original = await page.evaluate(() => ({
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null))
    }));

    // Seed the scenario and run the assertions. Wrapped in try/finally so a
    // failed assertion (or a bug reproduction — deliberately running this
    // against reverted/broken source to confirm the test catches it) still
    // restores the tournament's real gameQueue/currentPhase instead of
    // leaving synthetic test data behind for the next run to trip over.
    let outcome;
    try {
    outcome = await page.evaluate(async () => {
      const gs = window.godApp.gameState;
      const teamA = gs.teams[0];
      const teamB = gs.teams[1] || gs.teams[0];

      const ROUND = 999001; // distinctive round number, won't collide with real data
      const phaseStartedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // "5 min ago"
      const beforePhaseStart = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour before phase start — stale
      const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago — stale

      gs.currentPhase = {
        name: 'matches_in_progress',
        roundNumber: ROUND,
        startedAt: phaseStartedAt,
        slots: { 1: 'done', 2: 'playing' }
      };

      const teamsShape = () => ([
        { id: teamA.id, playerIds: [] },
        { id: teamB.id, playerIds: [] }
      ]);

      const realMatch = {
        id: Date.now(),
        matchNumber: 990001,
        game: 'e2e-test-game',
        playType: '1v1',
        teams: teamsShape(),
        status: 'ongoing',
        createdAt: new Date().toISOString(), // now — within this round
        roundNumber: ROUND,
        slot: 2
      };

      const decoyFullyUntagged = {
        id: Date.now() + 1,
        matchNumber: 990002,
        game: 'e2e-test-game',
        playType: '1v1',
        teams: teamsShape(),
        status: 'pending'
        // no createdAt, no roundNumber, no slot at all — oldest-style leftover
      };

      const decoyUntaggedStaleCreatedAt = {
        id: Date.now() + 2,
        matchNumber: 990003,
        game: 'e2e-test-game',
        playType: '1v1',
        teams: teamsShape(),
        status: 'queued',
        createdAt: beforePhaseStart
        // untagged, but has a createdAt from BEFORE this round's matches
        // phase began — must not count for this round's slot 2
      };

      const decoyTaggedStaleRound = {
        id: Date.now() + 3,
        matchNumber: 990004,
        game: 'e2e-test-game',
        playType: '1v1',
        teams: teamsShape(),
        status: 'pending',
        createdAt: longAgo,
        roundNumber: ROUND - 50, // a long-past round
        slot: 2 // same slot NUMBER, but stale round — must not block
      };

      gs.gameQueue = [realMatch, decoyFullyUntagged, decoyUntaggedStaleCreatedAt, decoyTaggedStaleRound];

      await window.godApp.saveGameState();

      const beforeConfirm = window.godApp.phase.getSlotRequirements(2);

      // Confirm the real match via the actual confirm-result API (same
      // function the UI's confirm button calls).
      await window.godApp.result.quickConfirmResult(realMatch.id, 0);

      const afterConfirm = window.godApp.phase.getSlotRequirements(2);

      const advanced = window.godApp.phase.advanceSlot(2);
      // advanceSlot may be async (returns a Promise) or sync depending on
      // version — normalize.
      const advanceResult = (advanced && typeof advanced.then === 'function') ? await advanced : advanced;

      const subPhaseAfterAdvance = window.godApp.phase.getSlotSubPhase(2);

      const finalQueue = JSON.parse(JSON.stringify(gs.gameQueue));

      return {
        beforeConfirm, afterConfirm, advanceResult, subPhaseAfterAdvance, finalQueue,
        realMatchId: realMatch.id,
        decoyIds: [decoyFullyUntagged.id, decoyUntaggedStaleCreatedAt.id, decoyTaggedStaleRound.id]
      };
    });

    console.log('--- BEFORE confirming real match, slot 2 requirements ---');
    console.log(JSON.stringify(outcome.beforeConfirm, null, 2));
    console.log('--- AFTER confirming real match, slot 2 requirements ---');
    console.log(JSON.stringify(outcome.afterConfirm, null, 2));
    console.log('--- advanceSlot(2) result:', outcome.advanceResult, '| sub-phase after:', outcome.subPhaseAfterAdvance, '---');

    // Assertions
    assert(outcome.beforeConfirm.some(r => r.met === false),
      'Before confirming, slot 2 should NOT be fully met (real match still ongoing)');

    assert(outcome.afterConfirm.every(r => r.met === true),
      `After confirming the real match, slot 2 requirements should ALL be met, got: ${JSON.stringify(outcome.afterConfirm)}`);

    const mentionsDecoyCount = outcome.afterConfirm.some(r => /not started|still playing/.test(r.label));
    assert(!mentionsDecoyCount,
      `After confirming, slot 2 requirements should not surface any leftover "not started"/"still playing" items from decoys, got: ${JSON.stringify(outcome.afterConfirm)}`);

    assert(outcome.advanceResult === true, 'advanceSlot(2) should succeed (return true) once requirements are met');
    assert(outcome.subPhaseAfterAdvance === 'done', `Slot 2 sub-phase should be 'done' after advanceSlot, got '${outcome.subPhaseAfterAdvance}'`);

    // The real match should be 'completed'; decoys must remain untouched
    // (still pending/queued) — proving they were correctly EXCLUDED from
    // slot 2's requirements rather than accidentally consumed/mutated.
    const realEntry = outcome.finalQueue.find(m => m.id === outcome.realMatchId);
    assert(realEntry && realEntry.status === 'completed', 'Real match should be marked completed');
    outcome.decoyIds.forEach(id => {
      const decoy = outcome.finalQueue.find(m => m.id === id);
      assert(decoy && decoy.status !== 'completed', `Decoy ${id} should remain unresolved (not accidentally completed)`);
    });

    console.log('\nAll assertions passed.');
    allPassed = true;
    } finally {
      // Restore original state — runs even if an assertion above threw, so
      // a caught bug (or a deliberate run against reverted source) never
      // leaves synthetic test data sitting in the tournament.
      await page.evaluate((orig) => {
        window.godApp.gameState.gameQueue = orig.gameQueue;
        window.godApp.gameState.currentPhase = orig.currentPhase;
        return window.godApp.saveGameState();
      }, original);
      console.log('Restored original gameQueue/currentPhase.');
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
