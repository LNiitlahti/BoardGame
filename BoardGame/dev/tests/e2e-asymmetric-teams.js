/**
 * e2e-asymmetric-teams.js — coverage for asymmetric team-size matches (TODO.md:
 * "Need more testing for asymmetric team-size matches, e.g. Match 1 as a
 * 3v3 + 2v2 combined/split match — unclear how slot logic and scoring handle
 * that shape." User confirmed this shape genuinely occurs at the event.
 *
 * WHAT "3v3 + 2v2 COMBINED/SPLIT" ACTUALLY IS (read from source, not guessed
 * from the TODO wording): it's a real, already-built feature, not a one-off.
 * `shared/scripts/games-config.js` marks aoe4/wc3/sc2/dow2 as
 * `format: '3v3+2v2', splitFormat: true`. `shared/scripts/balance-optimizer.js`'s
 * `enumerate3v3_2v2Partitions()`/`selectOptimal3v3_2v2()` and
 * `shared/scripts/smart-match-generator.js`'s `generate3v3_2v2Match()` turn
 * ONE "combined" round slot into TWO linked gameQueue entries — one `playType:
 * '3v3'`, one `playType: '2v2'` — both `isSimultaneous: true`. Of the 5 teams
 * in a pod: 1 team is "split" (contributes exactly 1 player to EACH side of
 * the 3v3 leg — its own two players end up on OPPOSING sides — and 0 players
 * to the 2v2 leg), 2 teams each field a full 2-player side of the 3v3, and
 * the remaining 2 teams field the 2v2 entirely. Each individual queue entry
 * is internally SYMMETRIC (3-vs-3, or 2-vs-2) — the asymmetry is ACROSS the
 * linked pair (3-a-side vs 2-a-side), not within either match's two sides.
 * admin-improved-adapter.js's own comment on `_tagImportedBatch` confirms
 * this reading: "A linked split-format pair (3v3+2v2 playing simultaneously)
 * is ONE slot, not two."
 *
 * Because the split team never puts 2+ players on one side of either leg,
 * result-manager.js's `confirmResult()` "teamsWithFullCredit"/
 * "teamsWithFullLoss" logic (only credits a win/loss to a team with 2+
 * players on the winning/losing side — see lines ~358-385) gives it NEITHER
 * a win nor a loss from the combined match, only a `splitCount` increment
 * (tagged only on the 3v3 leg, since `generate3v3_2v2Match()` explicitly sets
 * the 2v2 leg's `splitTeamId: null` — "2v2 has no split"). That's the
 * concrete asymmetric-attribution behavior this test verifies end-to-end —
 * by design, not a bug, but never previously exercised live.
 *
 * PART 0 — CONFIRMED BUG, REPORTED NOT FIXED (Task 7 is test-writing, not
 * fix-work): god-app.js:1190-1191 wires `window.confirmAutoMatch` /
 * `window.generateSuggestedMatches` on god.html straight to
 * MatchCreationManager's methods, but those methods' completion path
 * unconditionally does `document.getElementById('autoMatchModal').classList...`
 * (`closeAutoMatchModal()`) — and `#autoMatchModal`/`#autoMatchContent` only
 * exist in full/admin.html (lines 366-368), NOT god.html. Calling
 * `window.confirmAutoMatch()` on god.html throws
 * "Cannot read properties of null (reading 'classList')" — confirmed live
 * below (diagnostic only, not a pass/fail gate: asserting it MUST throw
 * would turn a future admin.html/god.html DOM fix into a spurious failure of
 * an unrelated scoring test). Because of this, the rest of the test can't
 * drive match creation through the real `confirmAutoMatch()` on god.html —
 * it calls the same non-DOM-dependent methods that function delegates to
 * (`BalanceOptimizer.selectOptimal3v3_2v2()` / `SmartMatchGenerator
 * .generate3v3_2v2Match()`) and builds the resulting queue entries exactly
 * the way match-creation-manager.js's `confirmAutoMatch()` source does
 * (lines ~1687-1723), rather than routing through the broken wrapper.
 *
 * TEAM SETUP: e2e-disposable-1 only has 2 real teams (Team Alpha id 1, Team
 * Beta id 2), but `BalanceOptimizer`/`SmartMatchGenerator` hard-require
 * exactly 5 teams of exactly 2 players each to compute a 3v3+2v2 partition
 * (`generateNext()` errors below 5 teams). This test temporarily adds 3
 * synthetic teams (ids 3/4/5) built from REAL player accounts already sitting
 * unassigned (`teamId: null`) in this tournament's player registry — leftover
 * disposable accounts from earlier tasks, not fabricated data — so the real
 * optimizer math runs against real player ids. `gameState.teams` is restored
 * to its original 2-team roster in the `finally` block (array field, replaced
 * wholesale on merge-set restore — same pattern as every sibling script).
 *
 * ASSERTIONS:
 *   - No crash anywhere in the real pipeline: BalanceOptimizer partition
 *     selection, queue-entry construction, PhaseManager.getSlotRequirements/
 *     advanceSlot, ResultManager.quickConfirmResult (x2).
 *   - Slot logic treats the linked 3v3+2v2 pair as ONE slot: requirements are
 *     NOT met while either leg is still ongoing/pending, confirming only the
 *     3v3 leg still leaves the slot blocked (the 2v2 leg is still playing),
 *     and only after BOTH legs are confirmed does the slot's requirements
 *     report met and `advanceSlot(1)` succeed (sub-phase -> 'done').
 *   - Win/loss/points attribution is correct for every team regardless of
 *     its representation size in this match: the two full-side teams in the
 *     3v3 leg and the two full-side teams in the 2v2 leg each get exactly
 *     the win/loss/points/gamesPlayed delta their leg's result implies; the
 *     split team (1 player per side, never 2+) gets NO win/loss/points delta
 *     from either leg, only `splitCount + 1`.
 *
 * Snapshots/restores gameState.teams, gameState.players, gameQueue,
 * currentPhase, gamesPlayed, gameHistory in a `finally` block. Never touches
 * `smartMatchState` (the generator instance here is local, not assigned to
 * `window.smartMatchGenerator`, so nothing persists it) or `board`/
 * `lobbyReady` (this test stays in the 'playing' sub-phase throughout,
 * skipping 'lobby' — same simplification e2e-round-advance.js uses).
 *
 * PLAYER-REGISTRY GOTCHA DISCOVERED WHILE BUILDING THIS TEST (also now in
 * E2E_HARNESS.md): adding a team whose `players` roster references real
 * player ids without also updating those players' `teamId` in
 * `gameState.players` trips `PlayerUtils.needsPlayerMigration()` on the next
 * Firestore onSnapshot callback, which auto-runs `migrateToNormalizedPlayers()`
 * — that PRUNES every registry entry not referenced by ANY team's roster.
 * An early version of this test left 12 real free-agent players in
 * e2e-disposable-1 stamped with orphaned `teamId: 3/4/5` after the synthetic
 * teams were removed again (repaired manually before this file was
 * committed). Fixed by keeping the registry's `teamId` in sync when building
 * the synthetic teams, plus the `players` snapshot/restore above as a second
 * safety net.
 *
 * Run: cd BoardGame && node dev/tests/e2e-asymmetric-teams.js
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
    await gotoTournamentPage(page, baseUrl, 'full/god.html', tournamentId);

    await page.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    // ── PART 0: diagnostic-only confirmation of the god.html confirmAutoMatch
    // DOM bug (see header). Not a pass/fail gate for this test. ──
    const bugCheck = await page.evaluate(async () => {
      const hasModal = !!document.getElementById('autoMatchModal');
      let threw = null;
      try {
        window.godApp.creation._pendingAutoMatch = null;
        await window.confirmAutoMatch();
      } catch (e) {
        threw = e.message;
      }
      return { hasModal, threw };
    });
    console.log('--- PART 0 (diagnostic): god.html confirmAutoMatch() DOM bug ---');
    console.log(`autoMatchModal present on god.html: ${bugCheck.hasModal}, confirmAutoMatch() threw: ${bugCheck.threw || '(nothing)'}`);

    // Snapshot original state so we can restore it afterward, regardless of
    // pass/fail.
    const original = await page.evaluate(() => ({
      teams: JSON.parse(JSON.stringify(window.godApp.gameState.teams || [])),
      players: JSON.parse(JSON.stringify(window.godApp.gameState.players || {})),
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
      gamesPlayed: window.godApp.gameState.gamesPlayed || 0,
      gameHistory: JSON.parse(JSON.stringify(window.godApp.gameState.gameHistory || []))
    }));

    let outcome;
    try {
      outcome = await page.evaluate(async () => {
        const gs = window.godApp.gameState;
        const phase = window.godApp.phase;
        const result = window.godApp.result;

        // ── Build 3 synthetic teams (ids 3/4/5) from REAL, currently
        // unassigned player accounts in this tournament's registry, so
        // BalanceOptimizer/SmartMatchGenerator (hard-require 5 teams x 2
        // players) can run for real. ──
        const freePlayers = Object.values(gs.players || {}).filter(p => p.id && !p.teamId);
        if (freePlayers.length < 6) {
          throw new Error(`Need >=6 free (unassigned) player accounts to build 3 synthetic teams, found ${freePlayers.length}`);
        }
        const pick = freePlayers.slice(0, 6);
        const synthTeams = [3, 4, 5].map((id, i) => ({
          id,
          name: `E2E Synthetic Team ${id}`,
          color: ['#2e9158', '#f7ba32', '#9b59b6'][i],
          players: [pick[i * 2], pick[i * 2 + 1]].map(p => ({ id: p.id, uid: p.uid || null, name: p.name })),
          gamesWon: 0, gamesLost: 0, gamesPlayed: 0, points: 0, splitCount: 0
        }));
        // IMPORTANT: also point the registry entries themselves at the new
        // team ids (matching what any real "assign player to team" flow
        // does via player-utils.js's updatePlayerInRegistry). Skipping this
        // leaves the registry's teamId disagreeing with the roster, which
        // trips PlayerUtils.needsPlayerMigration()'s check (player-utils.js
        // ~line 602) on the next Firestore onSnapshot callback — that
        // auto-runs migrateToNormalizedPlayers(), which recomputes every
        // team's playerIds AND PRUNES any registry entry not referenced by
        // any team's roster. Discovered the hard way: an earlier version of
        // this test left 12 real free-agent players in e2e-disposable-1
        // stamped with teamId 3/4/5 after the synthetic teams were removed
        // again — repaired manually. Keeping the registry consistent here
        // avoids ever triggering that migration in the first place; the
        // `players` snapshot/restore in the finally block is a second,
        // independent safety net in case anything still triggers it.
        pick.forEach((p, i) => { p.teamId = synthTeams[Math.floor(i / 2)].id; });
        gs.teams = [...gs.teams, ...synthTeams];

        // ── Real BalanceOptimizer/SmartMatchGenerator partition selection —
        // the same math confirmAutoMatch() would have used, called directly
        // to avoid its broken DOM-dependent completion path on god.html. ──
        const generator = new SmartMatchGenerator(gs); // local instance, not window.smartMatchGenerator — nothing persists smartMatchState
        const genResult = generator.generate3v3_2v2Match('e2e-asymmetric-test-game');
        if (genResult.error) throw new Error(`generate3v3_2v2Match failed: ${genResult.message}`);

        const match3v3 = genResult.matches[0];
        const match2v2 = genResult.matches[1];
        assertLocal(match3v3.format === '3v3', `Expected first leg format '3v3', got '${match3v3.format}'`);
        assertLocal(match2v2.format === '2v2', `Expected second leg format '2v2', got '${match2v2.format}'`);
        assertLocal(match3v3.teams[0].players.length === 3 && match3v3.teams[1].players.length === 3,
          `3v3 leg should have 3 players per side, got ${match3v3.teams[0].players.length}/${match3v3.teams[1].players.length}`);
        assertLocal(match2v2.teams[0].players.length === 2 && match2v2.teams[1].players.length === 2,
          `2v2 leg should have 2 players per side, got ${match2v2.teams[0].players.length}/${match2v2.teams[1].players.length}`);

        function assertLocal(cond, msg) { if (!cond) throw new Error('ASSERTION FAILED (in-page): ' + msg); }

        // ── Build queue entries exactly as confirmAutoMatch() does
        // (match-creation-manager.js ~1687-1723), bypassing only its final
        // DOM-touching closeAutoMatchModal() call. ──
        const ROUND = 999401;
        const baseId = Date.now();
        function buildEntry(match, matchNumber, idOffset) {
          return {
            id: baseId + idOffset,
            matchNumber,
            game: genResult.gameId,
            playType: match.format,
            teams: [
              { id: 'TEAM_A', name: 'TEAM A', players: match.teams[0].players, fullTeams: match.teams[0].fullTeams, fullTeamNames: match.teams[0].fullTeamNames },
              { id: 'TEAM_B', name: 'TEAM B', players: match.teams[1].players, fullTeams: match.teams[1].fullTeams, fullTeamNames: match.teams[1].fullTeamNames }
            ],
            splitTeamId: match.splitTeamId || null,
            splitTeamName: match.splitTeamName || null,
            isSimultaneous: match.isSimultaneous || false,
            status: 'pending',
            createdAt: new Date().toISOString(),
            autoGenerated: true,
            // Tagged as ONE slot for the linked pair — mirrors what
            // admin-improved-adapter.js's _tagNewQueueEntries would stamp on
            // both entries from a single confirmAutoMatch() batch (god.html
            // itself never tags — see E2E_HARNESS.md gotcha).
            slot: 1,
            roundNumber: ROUND
          };
        }
        const entry3v3Id = baseId + 0;
        const entry2v2Id = baseId + 1;
        const entry3v3 = buildEntry(match3v3, 990401, 0);
        const entry2v2 = buildEntry(match2v2, 990402, 1);

        gs.currentPhase = {
          name: 'matches_in_progress',
          roundNumber: ROUND,
          startedAt: new Date().toISOString(),
          slots: { 1: 'playing', 2: 'playing' }
        };
        gs.gameQueue = [...(gs.gameQueue || []), entry3v3, entry2v2];
        await window.godApp.saveGameState();

        // ── Slot logic, step 1: neither leg started yet ──
        const reqsBeforeStart = phase.getSlotRequirements(1);

        // "Start Match" on both legs. IMPORTANT: look the entries up FRESH
        // from gs.gameQueue by id rather than mutating the captured
        // entry3v3/entry2v2 references directly — after the saveGameState()
        // above, the Firestore onSnapshot listener replaces gs.gameQueue
        // wholesale with freshly-deserialized objects (same data, NEW object
        // identity), silently orphaning any previously-held entry reference.
        // (Discovered while writing this test — see E2E_HARNESS.md gotcha.)
        const findEntry = (id) => gs.gameQueue.find(e => e.id === id);
        findEntry(entry3v3Id).status = 'ongoing';
        findEntry(entry2v2Id).status = 'ongoing';
        await window.godApp.saveGameState();
        const reqsBothOngoing = phase.getSlotRequirements(1);

        // ── Snapshot all 5 teams' stats BEFORE any result confirmation ──
        const statsBefore = {};
        gs.teams.forEach(t => {
          statsBefore[t.id] = {
            gamesWon: t.gamesWon || 0, gamesLost: t.gamesLost || 0,
            gamesPlayed: t.gamesPlayed || 0, points: t.points || 0,
            splitCount: t.splitCount || 0
          };
        });
        const gamesPlayedBefore = gs.gamesPlayed || 0;

        // ── Confirm the 3v3 leg only (Side A wins, index 0) — slot should
        // still NOT be fully met (2v2 leg still ongoing). This is the core
        // "does slot logic treat the linked pair as one slot" check. ──
        await result.quickConfirmResult(entry3v3Id, 0);
        const reqsAfterOnlyOneLegConfirmed = phase.getSlotRequirements(1);

        // ── Confirm the 2v2 leg (Side B wins, index 1 — deliberately the
        // OTHER index, so win/loss attribution per leg can't be confused
        // with "always index 0 wins"). ──
        await result.quickConfirmResult(entry2v2Id, 1);
        const reqsAfterBothConfirmed = phase.getSlotRequirements(1);

        const advanceResult = await phase.advanceSlot(1);
        const subPhaseAfterAdvance = phase.getSlotSubPhase(1);

        const statsAfter = {};
        gs.teams.forEach(t => {
          statsAfter[t.id] = {
            gamesWon: t.gamesWon || 0, gamesLost: t.gamesLost || 0,
            gamesPlayed: t.gamesPlayed || 0, points: t.points || 0,
            splitCount: t.splitCount || 0
          };
        });
        const gamesPlayedAfter = gs.gamesPlayed || 0;

        const finalQueue = JSON.parse(JSON.stringify(gs.gameQueue));
        const finalHistory = JSON.parse(JSON.stringify(gs.gameHistory || []));

        return {
          genResult: {
            splitTeamId: genResult.splitTeamId,
            match3v3: { sideATeam: match3v3.teams[0].fullTeams[0], sideBTeam: match3v3.teams[1].fullTeams[0] },
            match2v2: { sideATeam: match2v2.teams[0].fullTeams[0], sideBTeam: match2v2.teams[1].fullTeams[0] }
          },
          entry3v3Id, entry2v2Id,
          reqsBeforeStart, reqsBothOngoing, reqsAfterOnlyOneLegConfirmed, reqsAfterBothConfirmed,
          advanceResult, subPhaseAfterAdvance,
          statsBefore, statsAfter, gamesPlayedBefore, gamesPlayedAfter,
          finalQueue, finalHistory
        };
      });

      console.log('--- Partition selected ---');
      console.log(JSON.stringify(outcome.genResult, null, 2));
      console.log('--- Slot 1 requirements: before start / both ongoing / only 3v3 confirmed / both confirmed ---');
      console.log(JSON.stringify({
        reqsBeforeStart: outcome.reqsBeforeStart,
        reqsBothOngoing: outcome.reqsBothOngoing,
        reqsAfterOnlyOneLegConfirmed: outcome.reqsAfterOnlyOneLegConfirmed,
        reqsAfterBothConfirmed: outcome.reqsAfterBothConfirmed
      }, null, 2));
      console.log(`advanceSlot(1) returned: ${outcome.advanceResult}, sub-phase after: ${outcome.subPhaseAfterAdvance}`);

      // ── Assertions: no crash ──
      assert(pageErrors.length === 0, `Expected no uncaught page errors, got: ${JSON.stringify(pageErrors)}`);

      // ── Assertions: slot logic treats the linked 3v3+2v2 pair as ONE slot ──
      assert(outcome.reqsBeforeStart.every(r => r.met === false),
        `Before either leg starts, slot 1 requirements should not be met, got: ${JSON.stringify(outcome.reqsBeforeStart)}`);
      assert(outcome.reqsBothOngoing.some(r => /2 matches? still playing/.test(r.label) && r.met === false),
        `With both legs ongoing, slot 1 should report 2 matches still playing, got: ${JSON.stringify(outcome.reqsBothOngoing)}`);
      assert(outcome.reqsAfterOnlyOneLegConfirmed.every(r => r.met === false),
        `With only the 3v3 leg confirmed, slot 1 should still NOT be fully met (2v2 leg still ongoing) — got: ${JSON.stringify(outcome.reqsAfterOnlyOneLegConfirmed)}`);
      assert(outcome.reqsAfterOnlyOneLegConfirmed.some(r => /1 match still playing/.test(r.label)),
        `With only the 3v3 leg confirmed, slot 1 should report exactly 1 match still playing, got: ${JSON.stringify(outcome.reqsAfterOnlyOneLegConfirmed)}`);
      assert(outcome.reqsAfterBothConfirmed.every(r => r.met === true),
        `With both legs confirmed, slot 1 requirements should ALL be met, got: ${JSON.stringify(outcome.reqsAfterBothConfirmed)}`);
      assert(outcome.advanceResult === true, 'advanceSlot(1) should succeed once both linked legs are confirmed');
      assert(outcome.subPhaseAfterAdvance === 'done', `Slot 1 sub-phase should be 'done' after advanceSlot, got '${outcome.subPhaseAfterAdvance}'`);

      // ── Assertions: win/loss/points attribution, per team, regardless of
      // that team's representation size in this combined match ──
      const { splitTeamId } = outcome.genResult;
      const { sideATeam: team3v3A, sideBTeam: team3v3B } = outcome.genResult.match3v3;
      const { sideATeam: team2v2A, sideBTeam: team2v2B } = outcome.genResult.match2v2;
      const delta = (teamId, field) => (outcome.statsAfter[teamId]?.[field] || 0) - (outcome.statsBefore[teamId]?.[field] || 0);

      // 3v3 leg: Side A (team3v3A) won.
      assert(delta(team3v3A, 'gamesWon') === 1, `3v3 winning full team ${team3v3A} should gain exactly 1 win, got delta ${delta(team3v3A, 'gamesWon')}`);
      assert(delta(team3v3A, 'points') === 1, `3v3 winning full team ${team3v3A} should gain exactly 1 point, got delta ${delta(team3v3A, 'points')}`);
      assert(delta(team3v3A, 'gamesLost') === 0, `3v3 winning full team ${team3v3A} should gain 0 losses, got delta ${delta(team3v3A, 'gamesLost')}`);
      assert(delta(team3v3B, 'gamesLost') === 1, `3v3 losing full team ${team3v3B} should gain exactly 1 loss, got delta ${delta(team3v3B, 'gamesLost')}`);
      assert(delta(team3v3B, 'gamesWon') === 0, `3v3 losing full team ${team3v3B} should gain 0 wins, got delta ${delta(team3v3B, 'gamesWon')}`);

      // Split team: present on both sides of the 3v3 leg with only 1 player
      // each, and not in the 2v2 leg at all — should get NO win/loss/points
      // credit from either leg, only a splitCount increment.
      assert(delta(splitTeamId, 'gamesWon') === 0, `Split team ${splitTeamId} should gain 0 wins (never 2+ players on one side), got delta ${delta(splitTeamId, 'gamesWon')}`);
      assert(delta(splitTeamId, 'gamesLost') === 0, `Split team ${splitTeamId} should gain 0 losses (never 2+ players on one side), got delta ${delta(splitTeamId, 'gamesLost')}`);
      assert(delta(splitTeamId, 'points') === 0, `Split team ${splitTeamId} should gain 0 points, got delta ${delta(splitTeamId, 'points')}`);
      assert(delta(splitTeamId, 'splitCount') === 1, `Split team ${splitTeamId} should gain exactly 1 splitCount (from the 3v3 leg only — 2v2 leg has splitTeamId:null), got delta ${delta(splitTeamId, 'splitCount')}`);

      // 2v2 leg: Side B (team2v2B) won (deliberately the other index).
      assert(delta(team2v2B, 'gamesWon') === 1, `2v2 winning full team ${team2v2B} should gain exactly 1 win, got delta ${delta(team2v2B, 'gamesWon')}`);
      assert(delta(team2v2B, 'points') === 1, `2v2 winning full team ${team2v2B} should gain exactly 1 point, got delta ${delta(team2v2B, 'points')}`);
      assert(delta(team2v2A, 'gamesLost') === 1, `2v2 losing full team ${team2v2A} should gain exactly 1 loss, got delta ${delta(team2v2A, 'gamesLost')}`);
      assert(delta(team2v2A, 'gamesWon') === 0, `2v2 losing full team ${team2v2A} should gain 0 wins, got delta ${delta(team2v2A, 'gamesWon')}`);

      // gamesPlayed (per team) — every one of the 4 full-representation
      // teams played exactly 1 game via this combined match; split team 0.
      [team3v3A, team3v3B, team2v2A, team2v2B].forEach(id => {
        assert(delta(id, 'gamesPlayed') === 1, `Team ${id} (full representation) should gain exactly 1 gamesPlayed, got delta ${delta(id, 'gamesPlayed')}`);
      });
      assert(delta(splitTeamId, 'gamesPlayed') === 0, `Split team ${splitTeamId} should gain 0 gamesPlayed (no full-representation leg), got delta ${delta(splitTeamId, 'gamesPlayed')}`);

      // Global gamesPlayed counter: +2 (one per confirmResult call, 3v3 and 2v2 both count).
      assert(outcome.gamesPlayedAfter - outcome.gamesPlayedBefore === 2,
        `gameState.gamesPlayed should increase by 2 (one per leg), got delta ${outcome.gamesPlayedAfter - outcome.gamesPlayedBefore}`);

      // Both queue entries marked completed with the expected winning side.
      const finalEntry3v3 = outcome.finalQueue.find(m => m.id === outcome.entry3v3Id);
      const finalEntry2v2 = outcome.finalQueue.find(m => m.id === outcome.entry2v2Id);
      assert(finalEntry3v3 && finalEntry3v3.status === 'completed' && finalEntry3v3.winnerIndex === 0,
        `3v3 queue entry should be completed with winnerIndex 0, got: ${JSON.stringify(finalEntry3v3)}`);
      assert(finalEntry2v2 && finalEntry2v2.status === 'completed' && finalEntry2v2.winnerIndex === 1,
        `2v2 queue entry should be completed with winnerIndex 1, got: ${JSON.stringify(finalEntry2v2)}`);

      // Two new gameHistory entries with the right playType/winning side.
      const hist3v3 = outcome.finalHistory.find(h => h.queuedGameId === outcome.entry3v3Id);
      const hist2v2 = outcome.finalHistory.find(h => h.queuedGameId === outcome.entry2v2Id);
      assert(hist3v3 && hist3v3.playType === '3v3', `Expected a 3v3 gameHistory entry, got: ${JSON.stringify(hist3v3)}`);
      assert(hist2v2 && hist2v2.playType === '2v2', `Expected a 2v2 gameHistory entry, got: ${JSON.stringify(hist2v2)}`);

      console.log('\nAll assertions passed.');
      allPassed = true;
    } finally {
      // Restore original teams/players/gameQueue/currentPhase/gamesPlayed/
      // gameHistory — runs even if an assertion above threw, so no synthetic
      // team, registry teamId pollution, or match/stat mutation is left
      // behind in the shared disposable tournament. `players` restore is a
      // second, independent safety net alongside the registry-consistency
      // fix above (see the comment where synthTeams are built) — belt and
      // braces, since this test discovered live that letting the registry
      // and team rosters disagree silently deletes unrelated free-agent
      // players via PlayerUtils' auto-migration-on-snapshot.
      await page.evaluate((orig) => {
        const gs = window.godApp.gameState;
        gs.teams = orig.teams;
        gs.players = orig.players;
        gs.gameQueue = orig.gameQueue;
        gs.currentPhase = orig.currentPhase;
        gs.gamesPlayed = orig.gamesPlayed;
        gs.gameHistory = orig.gameHistory;
        return window.godApp.saveGameState();
      }, original);
      console.log('Restored original teams/players/gameQueue/currentPhase/gamesPlayed/gameHistory.');
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
