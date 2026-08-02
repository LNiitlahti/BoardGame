/**
 * e2e-hex-placement-gate.js — re-verification test for the hex_placement_1/2
 * phase gate (TODO.md: "'Match 1 hex placed'/'Match 2 hex placed'
 * requirements... felt too loosely satisfied during smoke testing — it
 * passed instantly with no real placement action... needs re-verification
 * ... to confirm the gate does its job once there's something real to
 * place").
 *
 * WHAT THE GATE ACTUALLY IS (read from source, not guessed):
 *   - phase-manager.js's `_calculateRequirements('hex_placement_1' |
 *     'hex_placement_2')` (lines ~1094-1104) is gated entirely by
 *     `this._getPendingHexCount()`: `met: pendingHex === 0`. Identical logic
 *     for both phases — there is only one counter, no per-phase/per-match
 *     split (see admin-improved-adapter.js's own comment at line ~196-200
 *     about this being a known simplification versus the admin.html fork,
 *     which DOES split pendingHexWins by round/slot — not relevant to
 *     god.html, which this test drives).
 *   - On god.html (god-app.js:171) `_getPendingHexCount` is wired to
 *     `this.result._pendingHexWins.length` — the length of ResultManager's
 *     internal pending-hex-win array, NOT the sum of teamIds inside it. Each
 *     array entry is one match's yet-unplaced win notification (pushed once
 *     per `confirmResult()` call for a non-challenge match, holding the
 *     `teamIds` of whichever team(s) got full credit — see result-manager.js
 *     lines 634-651).
 *   - `_pendingHexWins` is an in-memory instance field on ResultManager,
 *     never written into `gameState` / Firestore. It always starts empty on
 *     a fresh page load, so this test needs no cross-run snapshot/restore
 *     for it (there is nothing in Firestore to restore).
 *   - Placing a hex via `BoardManager.assignTeamToHex(coord, teamId)` (the
 *     same function the "assign team to hex" UI button calls) ends with
 *     `this._clearPendingHexWin(teamId)`, which removes `teamId` from the
 *     FIRST matching win entry's `teamIds` and then filters out any entry
 *     whose `teamIds` is now empty — that's what actually drops the pending
 *     count and re-opens the gate (via the `onPhaseRequirementsChanged` ->
 *     `PhaseManager.recheckRequirements()` chain wired in god-app.js).
 *
 * GENUINE PENDING WIN, NOT A SYNTHETIC ONE: this test does NOT push directly
 * onto `_pendingHexWins` or otherwise fake the count. It seeds a match queue
 * entry (synthetic queue entry, same pattern as e2e-round-advance.js) with
 * REAL player ids drawn from e2e-disposable-1's actual Team Alpha / Team
 * Beta rosters (2 players per side, so both sides get "full credit" per
 * confirmResult's teamsWithFullCredit logic — exercises the real per-team
 * teamId match in `_clearPendingHexWin`, not the degenerate empty-teamIds
 * case that would filter out regardless of which teamId is passed), then
 * calls `ResultManager.quickConfirmResult()` — the exact function the
 * "Confirm Result" popup button calls — to generate the pending hex win for
 * real. Placement uses the real `BoardManager.assignTeamToHex()`, and the
 * gate check uses the real `PhaseManager.advancePhase()` (the exact function
 * the "Next Phase" button calls), not a hand-rolled requirements read.
 *
 * Asserts, against live data in e2e-disposable-1:
 *   1. BEFORE placing the hex: pending count is 1, requirements report
 *      "need to place plates" (met: false), and `advancePhase()` returns
 *      `false` and leaves `currentPhase.name` as 'hex_placement_1' (does
 *      NOT advance).
 *   2. AFTER placing the hex for the winning team: pending count is 0,
 *      requirements report "All hex plates placed" (met: true), and
 *      `advancePhase()` returns `true` and moves `currentPhase.name` to
 *      'spell_window_1' (the real next phase in PHASE_ORDER).
 *
 * Only tests hex_placement_1 — hex_placement_2 shares the exact same
 * `_getPendingHexCount() === 0` gate condition (see source excerpt above;
 * there is no phase-specific branching in the gate logic itself), so a
 * second run against hex_placement_2 would exercise identical code with no
 * additional coverage.
 *
 * Snapshots/restores gameQueue, currentPhase, teams (win/loss/points stats
 * get mutated by confirmResult), gamesPlayed, and gameHistory in a `finally`
 * block. The placed hex is cleared via the real `assignTeamToHex(coord,
 * null)` "Clear Hex" code path rather than by restoring a `board` snapshot —
 * `saveGameState()` does a Firestore `set(..., {merge:true})`, which merges
 * nested map fields key-by-key rather than replacing them wholesale, so
 * simply writing back an old `board` object would NOT delete the coord this
 * test adds; `assignTeamToHex(coord, null)` issues the explicit
 * `FieldValue.delete()` the real "Clear Hex" button uses, which is the
 * correct way to remove it. This call is unconditional and idempotent-safe
 * even if the test never got as far as placing anything.
 *
 * Run: cd BoardGame && node dev/tests/e2e-hex-placement-gate.js
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
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    // Sanity-check the fixture: need 2 teams, each with >=2 real player ids,
    // so confirmResult() gives both sides "full credit" and the pending hex
    // win's teamIds is genuinely populated (not the degenerate empty-array
    // case). Fail fast with a clear message if the fixture drifted instead
    // of a confusing downstream assertion.
    const roster = await page.evaluate(() => {
      const gs = window.godApp.gameState;
      const teamA = gs.teams[0];
      const teamB = gs.teams[1];
      return {
        teamA: teamA ? { id: teamA.id, playerIds: (teamA.players || []).map(p => p.id).filter(Boolean) } : null,
        teamB: teamB ? { id: teamB.id, playerIds: (teamB.players || []).map(p => p.id).filter(Boolean) } : null
      };
    });
    assert(roster.teamA && roster.teamA.playerIds.length >= 2,
      `Expected teams[0] to have >=2 real player ids, got: ${JSON.stringify(roster.teamA)}`);
    assert(roster.teamB && roster.teamB.playerIds.length >= 2,
      `Expected teams[1] to have >=2 real player ids, got: ${JSON.stringify(roster.teamB)}`);

    // Find a free, plain ('normal' — not room/heart/starting-location) hex
    // coordinate up front, read-only, before any mutation, so the `finally`
    // block always knows which coord to clear even if a later step throws.
    const coord = await page.evaluate(() => {
      const gs = window.godApp.gameState;
      const bm = window.godApp._boardModule;
      const board = gs.board || {};
      for (const [q, r] of bm.generateHexCoordinates()) {
        const c = `q${q}r${r}`;
        if (board[c]) continue;
        if (bm.getHexType(q, r) !== 'normal') continue;
        return c;
      }
      return null;
    });
    assert(coord, 'Could not find a free normal hex coordinate on the board to test placement with');
    console.log(`Using free hex coordinate: ${coord}`);

    // Snapshot original state so we can restore it afterward, regardless of
    // pass/fail.
    const original = await page.evaluate(() => ({
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
      teams: JSON.parse(JSON.stringify(window.godApp.gameState.teams || [])),
      gamesPlayed: window.godApp.gameState.gamesPlayed || 0,
      gameHistory: JSON.parse(JSON.stringify(window.godApp.gameState.gameHistory || []))
    }));

    const matchId = Date.now();

    let outcome;
    try {
      outcome = await page.evaluate(async (matchId, coord) => {
        const gs = window.godApp.gameState;
        const phase = window.godApp.phase;
        const result = window.godApp.result;
        const board = window.godApp.board;

        const teamA = gs.teams[0];
        const teamB = gs.teams[1];
        const teamAPlayerIds = (teamA.players || []).map(p => p.id).filter(Boolean);
        const teamBPlayerIds = (teamB.players || []).map(p => p.id).filter(Boolean);

        // ── Synthetic queue entry (same pattern as e2e-round-advance.js) ──
        const matchEntry = {
          id: matchId,
          matchNumber: 990301,
          game: 'e2e-hex-gate-test',
          playType: '1v1',
          teams: [
            { id: teamA.id, playerIds: teamAPlayerIds },
            { id: teamB.id, playerIds: teamBPlayerIds }
          ],
          status: 'ongoing',
          createdAt: new Date().toISOString()
        };
        gs.gameQueue = [...(gs.gameQueue || []), matchEntry];
        await window.godApp.saveGameState();

        const pendingBeforeWin = phase._getPendingHexCount();

        // ── REAL confirm-result API — same function the "Confirm Result"
        // popup button calls. Team A (index 0) wins. ──
        await result.quickConfirmResult(matchId, 0);

        const pendingAfterWin = phase._getPendingHexCount();
        const winEntries = JSON.parse(JSON.stringify(result._pendingHexWins));

        // ── Enter hex_placement_1 (synthetic — directly setting the phase
        // the way a test-only seed does; the gate logic under test doesn't
        // care how we got here, only what _getPendingHexCount() reports) ──
        gs.currentPhase = {
          name: 'hex_placement_1',
          roundNumber: 999301,
          startedAt: new Date().toISOString()
        };
        phase.recheckRequirements();

        const reqsBeforePlacement = phase.getPhaseRequirements();
        const advanceBeforePlacement = await phase.advancePhase();
        const phaseAfterBlockedAttempt = phase.getCurrentPhase();

        // ── REAL hex placement — same function the board's team-picker
        // "assign team to hex" button calls. ──
        await board.assignTeamToHex(coord, teamA.id);

        const pendingAfterPlacement = phase._getPendingHexCount();
        const reqsAfterPlacement = phase.getPhaseRequirements();
        const advanceAfterPlacement = await phase.advancePhase();
        const phaseAfterSuccessfulAdvance = phase.getCurrentPhase();

        return {
          pendingBeforeWin, pendingAfterWin, winEntries,
          reqsBeforePlacement, advanceBeforePlacement, phaseAfterBlockedAttempt,
          pendingAfterPlacement, reqsAfterPlacement, advanceAfterPlacement, phaseAfterSuccessfulAdvance,
          teamAId: teamA.id
        };
      }, matchId, coord);

      console.log('--- Pending hex count before/after confirming the match win ---');
      console.log(`before: ${outcome.pendingBeforeWin}, after: ${outcome.pendingAfterWin}`);
      console.log('winEntries:', JSON.stringify(outcome.winEntries, null, 2));
      console.log('--- BEFORE placing the hex: phase requirements / advance attempt ---');
      console.log(JSON.stringify(outcome.reqsBeforePlacement, null, 2));
      console.log(`advancePhase() returned: ${outcome.advanceBeforePlacement}, currentPhase after: ${outcome.phaseAfterBlockedAttempt}`);
      console.log('--- AFTER placing the hex: phase requirements / advance attempt ---');
      console.log(JSON.stringify(outcome.reqsAfterPlacement, null, 2));
      console.log(`advancePhase() returned: ${outcome.advanceAfterPlacement}, currentPhase after: ${outcome.phaseAfterSuccessfulAdvance}`);

      // ── Assertions: pending-hex bookkeeping ──
      assert(outcome.pendingBeforeWin === 0,
        `Expected a fresh page session to start with 0 pending hex wins, got ${outcome.pendingBeforeWin}`);
      assert(outcome.pendingAfterWin === 1,
        `Confirming one non-challenge match should push exactly 1 pending hex win, got ${outcome.pendingAfterWin}`);
      assert(outcome.winEntries.length === 1 && outcome.winEntries[0].teamIds.map(String).includes(String(outcome.teamAId)),
        `Pending win entry should carry the winning team's id (${outcome.teamAId}), got: ${JSON.stringify(outcome.winEntries)}`);

      // ── Assertions: gate BLOCKS before the hex is placed ──
      assert(outcome.reqsBeforePlacement.allMet === false,
        `Before placing the hex, hex_placement_1 requirements should NOT be met, got: ${JSON.stringify(outcome.reqsBeforePlacement)}`);
      assert(outcome.reqsBeforePlacement.items.some(r => /need to place plates/.test(r.label) && r.met === false),
        `Before placing the hex, requirements should report an unmet "need to place plates" item, got: ${JSON.stringify(outcome.reqsBeforePlacement.items)}`);
      assert(outcome.advanceBeforePlacement === false,
        'advancePhase() should return false (blocked) while a hex win is still pending');
      assert(outcome.phaseAfterBlockedAttempt === 'hex_placement_1',
        `currentPhase should remain 'hex_placement_1' after a blocked advance attempt, got '${outcome.phaseAfterBlockedAttempt}'`);

      // ── Assertions: gate ALLOWS after the hex is placed ──
      assert(outcome.pendingAfterPlacement === 0,
        `After placing the hex, pending count should be 0, got ${outcome.pendingAfterPlacement}`);
      assert(outcome.reqsAfterPlacement.allMet === true,
        `After placing the hex, hex_placement_1 requirements should be met, got: ${JSON.stringify(outcome.reqsAfterPlacement)}`);
      assert(outcome.reqsAfterPlacement.items.some(r => /All hex plates placed/.test(r.label) && r.met === true),
        `After placing the hex, requirements should report "All hex plates placed", got: ${JSON.stringify(outcome.reqsAfterPlacement.items)}`);
      assert(outcome.advanceAfterPlacement === true,
        'advancePhase() should return true (allowed) once the pending hex win is placed');
      assert(outcome.phaseAfterSuccessfulAdvance === 'spell_window_1',
        `currentPhase should advance to 'spell_window_1' (the real next phase after hex_placement_1) once the gate opens, got '${outcome.phaseAfterSuccessfulAdvance}'`);

      console.log('\nAll assertions passed.');
      allPassed = true;
    } finally {
      // Clear the hex via the real "Clear Hex" code path (explicit Firestore
      // FieldValue.delete(), not a wholesale board overwrite — see the
      // header comment on why a merge-set can't remove it by itself).
      // Unconditional and safe even if placement never happened.
      await page.evaluate((coord) => window.godApp.board.assignTeamToHex(coord, null), coord);

      // Restore gameQueue/currentPhase/teams/gamesPlayed/gameHistory — runs
      // even if an assertion above threw, so no synthetic match/phase/stat
      // mutation is left behind in the shared disposable tournament.
      await page.evaluate((orig) => {
        const gs = window.godApp.gameState;
        gs.gameQueue = orig.gameQueue;
        gs.currentPhase = orig.currentPhase;
        gs.teams = orig.teams;
        gs.gamesPlayed = orig.gamesPlayed;
        gs.gameHistory = orig.gameHistory;
        return window.godApp.saveGameState();
      }, original);
      console.log('Cleared test hex and restored original gameQueue/currentPhase/teams/gamesPlayed/gameHistory.');
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
