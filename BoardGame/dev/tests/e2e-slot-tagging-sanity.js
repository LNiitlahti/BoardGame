/**
 * e2e-slot-tagging-sanity.js — standing sanity check that a GENUINELY FRESH
 * gameQueue's `slot` tags come out consistent, re-run-able before every real
 * event on the real event tournament (see TODO.md's "RESOLVED (was NOT a
 * CL-32 regression...)" entry).
 *
 * BACKGROUND: a prior investigation found `cl32-smoke-test`'s ~117 leftover
 * pending matches had scrambled/arbitrary `slot` tags (first 10 sampled:
 * 1,1,1,2,2,1,2,1,2,1 — no obvious pattern) and concluded this was almost
 * certainly residue from repeated past test-data generation on a heavily-
 * reused scratch tournament, NOT a logic bug in the tagging code itself. This
 * script proves that conclusion by generating a truly fresh batch through the
 * REAL match-creation flow and checking the resulting tags are sane — it does
 * NOT hand-construct queue entries with pre-set `slot` values (that would
 * test nothing; the whole point is exercising the tagging LOGIC itself).
 *
 * WHERE THE TAGGING LOGIC ACTUALLY LIVES (read from source, not guessed):
 * `admin-improved-adapter.js`'s `_tagNewQueueEntries()` — wired onto
 * `window.addMatchToQueue`/`confirmChallengeSetup`/`confirmAutoMatch` (and
 * `_tagImportedBatch()` onto `confirmMassImport`). It stamps `{roundNumber,
 * slot}` onto any queue entry added since a `beforeIds` snapshot taken right
 * before the real creation call, based on `_computeCurrentSlot()`: `slot` is
 * whichever Match-slot the admin most recently selected via "Set Target"
 * (`window.setTargetMatchSlot(1|2)`, tracked in the closure var `_targetSlot`
 * — defaults to 1), current phase must be `matches_in_progress`. Per
 * E2E_HARNESS.md's existing gotcha, this tagging step lives ONLY in
 * admin-improved-adapter.js — god.html's match creation has no tagging step
 * at all — so this test drives **full/admin.html**, not god.html.
 *
 * WHAT "CONSISTENT WITH ON-SCREEN GROUPING" CONCRETELY MEANS (read from
 * source, not assumed): the guided-flow "Match 1"/"Match 2" slot cards
 * (`_renderMatchSlotCards()` -> `_computeSlotStep()` -> `_pendingSlotMatches
 * (slot)`) filter `gameState.gameQueue` by `_belongsToCurrentSlot(m, slot)`
 * — i.e. `m.slot === slot && (m.roundNumber === undefined || m.roundNumber
 * === currentRoundNumber)` — and render "`N` matches queued." per slot
 * (phase-manager.js's `getSlotRequirements()` computes the identical
 * `belongsToSlot` filter independently, for the same purpose). So the
 * concrete claim under test is: for a batch created while the admin had
 * Match 1 targeted, then a second batch created while Match 2 was targeted,
 * every entry's raw `.slot` field must equal the slot that was actually
 * targeted when it was created (grouped cleanly by insertion order — NOT
 * alternating/scrambled the way cl32-smoke-test's residue was), AND the
 * on-screen slot-card text (read from the live DOM, not re-derived in JS)
 * must report the matching count for each slot.
 *
 * SCENARIO: starting from a fresh `matches_in_progress` phase (round tagged
 * with a distinctive round number so it can never collide with real data),
 * with both slots in their initial 'setup' sub-phase:
 *   1. Target Match 1, add 2 real matches (via the actual `addMatchToQueue()`
 *      guided-flow function — same one the "Add to Queue" button calls) using
 *      real player ids from e2e-disposable-1's Team Alpha / Team Beta rosters
 *      (2 players each, so both matches are distinct real pairings, not
 *      identical entries).
 *   2. Target Match 2, add 2 more real matches the same way.
 *   3. Read back `gameState.gameQueue` (the same binding god-app.js /
 *      admin.js expose, per E2E_HARNESS.md) for the 4 new entries and assert
 *      the `slot` tags partition cleanly: first 2 -> slot 1, last 2 -> slot
 *      2, all four share the same `roundNumber`.
 *   4. Force a render (`updateDisplay()`) and read the ACTUAL on-screen
 *      "Match 1 — setup" / "Match 2 — setup" slot-card guidance text,
 *      asserting each says "2 matches queued." — i.e. the UI's own grouping
 *      of the same data agrees with the raw `slot` field, not just that the
 *      raw field looks sane in isolation.
 *
 * Never touches `gameState.teams`/`players` (only reads existing player ids
 * into throwaway `{id}` stand-ins for `manualGameSetup.sides` — the shape
 * `addMatchToQueue()` actually reads), so none of the player-registry/
 * `needsPlayerMigration()` gotchas apply here. Snapshots/restores
 * `gameState.gameQueue`/`currentPhase` in a `finally` block, same convention
 * as every sibling script (e.g. e2e-round-advance.js, e2e-next-up-
 * availability.js) — real Firestore writes DO happen here (`addMatchToQueue`
 * calls the real `saveGameState()` internally, same as clicking "Add to
 * Queue"), so unlike e2e-next-up-availability.js's in-memory-only variant,
 * the restore step here is a real Firestore write too, not just page hygiene.
 *
 * RE-RUN THIS BEFORE THE REAL EVENT: this is a standing sanity check, not a
 * one-off. Once the real event tournament exists, re-run it against that
 * tournament id (`TEST_TOURNAMENT_ID=<real-event-id> node
 * dev/tests/e2e-slot-tagging-sanity.js`) before trusting any "Next up"/slot
 * mismatch reported live as a real bug — per TODO.md's own instruction to
 * "re-verify slot-tagging is sane on a freshly-generated queue before
 * trusting any... mismatch as a real bug going forward." It needs at least 2
 * teams with >=1 player each in whatever tournament it targets.
 *
 * Run: cd BoardGame && node dev/tests/e2e-slot-tagging-sanity.js
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
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(page, baseUrl, 'full/admin.html', tournamentId);

    // gameState is a bare top-level `let` in admin.js (not window.gameState),
    // but page.evaluate/waitForFunction execute in the same page realm — see
    // E2E_HARNESS.md's gotcha (also used by e2e-next-up-availability.js).
    await page.waitForFunction(
      () => typeof gameState !== 'undefined' && gameState && Array.isArray(gameState.teams) && gameState.teams.length >= 2,
      { timeout: 40000 }
    );
    await page.waitForFunction(
      () => !!document.getElementById('flowPanel') &&
            !!document.getElementById('gameType') &&
            (gameState.selectedGames || []).length > 0,
      { timeout: 20000 }
    );

    const original = await page.evaluate(() => ({
      gameQueue: JSON.parse(JSON.stringify(gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(gameState.currentPhase || null))
    }));

    let outcome;
    try {
      outcome = await page.evaluate(async () => {
        const ROUND = 999801; // distinctive round number, won't collide with real data
        const gameId = (gameState.selectedGames || [])[0];
        if (!gameId) throw new Error('Tournament has no selectedGames — cannot pick a game for the Add Match form');

        const teamA = gameState.teams[0];
        const teamB = gameState.teams[1];
        const playersA = (teamA.players || []).map(p => p.id).filter(Boolean);
        const playersB = (teamB.players || []).map(p => p.id).filter(Boolean);
        if (playersA.length === 0 || playersB.length === 0) {
          throw new Error(`Need >=1 player on each of the first two teams, got ${playersA.length}/${playersB.length}`);
        }
        // Use a second distinct player per side if available, so the two
        // matches created for the same slot are distinct real pairings
        // rather than exact duplicates — falls back to reusing player 0.
        const a0 = playersA[0], a1 = playersA[1] || playersA[0];
        const b0 = playersB[0], b1 = playersB[1] || playersB[0];

        // Enter a fresh matches_in_progress phase, both slots in 'setup' —
        // the real phase state new queue entries get tagged against. Same
        // in-memory-seed pattern e2e-round-advance.js / e2e-next-up-
        // availability.js use to jump straight past the earlier phases.
        gameState.currentPhase = {
          name: 'matches_in_progress',
          roundNumber: ROUND,
          startedAt: new Date().toISOString(),
          slots: { 1: 'setup', 2: 'setup' }
        };

        const gameTypeSelect = document.getElementById('gameType');

        // Drives the REAL guided-flow match-creation function
        // (window.addMatchToQueue, the same one "Add to Queue" calls) —
        // seeds its input state (manualGameSetup.sides / #gameType) rather
        // than constructing a queue entry by hand, so the resulting `slot`
        // tag is genuinely produced by _tagNewQueueEntries(), not asserted
        // into existence.
        async function addOneRealMatch(targetSlot, sideAPlayerId, sideBPlayerId) {
          window.setTargetMatchSlot(targetSlot);
          manualGameSetup.sides = [[{ id: sideAPlayerId }], [{ id: sideBPlayerId }]];
          gameTypeSelect.value = gameId;
          await window.addMatchToQueue();
        }

        const before = new Set((gameState.gameQueue || []).map(e => e.id));

        // Real admin usage order: target Match 1, add its matches; then
        // target Match 2, add its matches.
        await addOneRealMatch(1, a0, b0);
        await addOneRealMatch(1, a1, b1);
        await addOneRealMatch(2, a0, b1);
        await addOneRealMatch(2, a1, b0);

        const created = (gameState.gameQueue || [])
          .filter(e => !before.has(e.id))
          .sort((x, y) => x.id - y.id); // insertion order (ids are Date.now()-based, monotonic)

        // Force a synchronous re-render (same call the real Firestore
        // onSnapshot listener makes) so the on-screen slot cards reflect
        // this batch before we read them.
        if (typeof updateDisplay === 'function') updateDisplay();

        const slotPanels = Array.from(document.querySelectorAll('#matchSlotCards .match-slot-panel'));
        const panelGuidanceText = (labelSubstr) => {
          const el = slotPanels.find(p => (p.querySelector('.match-slot-name')?.textContent || '').includes(labelSubstr));
          return el ? (el.querySelector('.match-slot-guidance')?.textContent || '') : null;
        };

        return {
          created: created.map(e => ({ id: e.id, matchNumber: e.matchNumber, slot: e.slot, roundNumber: e.roundNumber, status: e.status })),
          slotPanelCount: slotPanels.length,
          slot1Text: panelGuidanceText('Match 1'),
          slot2Text: panelGuidanceText('Match 2'),
          round: ROUND
        };
      });

      console.log('--- Freshly-created queue entries (in creation order) ---');
      console.log(JSON.stringify(outcome.created, null, 2));
      console.log('--- On-screen Match Slot card guidance text ---');
      console.log(`Match 1: "${outcome.slot1Text}"`);
      console.log(`Match 2: "${outcome.slot2Text}"`);

      // ── No crash anywhere in the real match-creation pipeline ──
      assert(pageErrors.length === 0, `Expected no uncaught page errors, got: ${JSON.stringify(pageErrors)}`);

      // ── Exactly 4 entries created, all tagged for this round ──
      assert(outcome.created.length === 4, `Expected 4 freshly-created queue entries, got ${outcome.created.length}`);
      outcome.created.forEach(e => {
        assert(e.roundNumber === outcome.round, `Entry ${e.matchNumber} (id ${e.id}) should be tagged roundNumber ${outcome.round}, got ${e.roundNumber}`);
        assert(e.slot === 1 || e.slot === 2, `Entry ${e.matchNumber} (id ${e.id}) should have slot 1 or 2, got ${JSON.stringify(e.slot)}`);
      });

      // ── THE core sanity check: slot tags partition cleanly by creation
      // batch — first 2 (created while Match 1 was targeted) all slot 1,
      // last 2 (created while Match 2 was targeted) all slot 2. NOT an
      // alternating/arbitrary pattern like cl32-smoke-test's leftover data
      // (sampled 1,1,1,2,2,1,2,1,2,1). ──
      const [m1, m2, m3, m4] = outcome.created;
      assert(m1.slot === 1 && m2.slot === 1, `First 2 matches (created while Match 1 was targeted) should both be slot 1, got [${m1.slot}, ${m2.slot}]`);
      assert(m3.slot === 2 && m4.slot === 2, `Last 2 matches (created while Match 2 was targeted) should both be slot 2, got [${m3.slot}, ${m4.slot}]`);

      // ── On-screen grouping agrees with the raw `slot` field: the live
      // guided-flow slot cards (reading gameQueue through the SAME
      // _pendingSlotMatches()/_belongsToCurrentSlot() filter phase-manager.js
      // uses for getSlotRequirements) must report 2 queued matches for each
      // slot — not just that the raw field looks sane in isolation. ──
      assert(outcome.slotPanelCount === 2, `Expected 2 match-slot panels rendered, got ${outcome.slotPanelCount}`);
      assert(outcome.slot1Text !== null, 'Match 1 slot-card panel should be present in #matchSlotCards');
      assert(outcome.slot2Text !== null, 'Match 2 slot-card panel should be present in #matchSlotCards');
      assert(/2 matches queued/.test(outcome.slot1Text), `Match 1 slot card should read "2 matches queued.", got: "${outcome.slot1Text}"`);
      assert(/2 matches queued/.test(outcome.slot2Text), `Match 2 slot card should read "2 matches queued.", got: "${outcome.slot2Text}"`);

      console.log('\nAll assertions passed — fresh queue entries are tagged consistently, matching on-screen grouping.');
      allPassed = true;
    } finally {
      // Restore original gameQueue/currentPhase — runs even if an assertion
      // above threw. Real Firestore writes happened during this test (each
      // addMatchToQueue() call saves for real, same as clicking "Add to
      // Queue"), so this restore is a real write too, not just page hygiene
      // (contrast e2e-next-up-availability.js, which never touches
      // Firestore at all).
      await page.evaluate(async (orig) => {
        gameState.gameQueue = orig.gameQueue;
        gameState.currentPhase = orig.currentPhase;
        await saveGameState();
        if (typeof updateDisplay === 'function') updateDisplay();
      }, original);
      console.log('Restored original gameQueue/currentPhase in Firestore.');
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
