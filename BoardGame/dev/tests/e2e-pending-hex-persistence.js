/**
 * e2e-pending-hex-persistence.js — regression test for TODO.md Task 15
 * ("During hex_placement_1/2, it's not clear to the TD which team currently
 * has a pending hex placement... needs a persistent (non-toast) indicator").
 *
 * WHY THIS IS A GATE-BYPASS BUG, NOT JUST A COSMETIC NOTIFICATION GAP
 * (confirmed by reading the code, not guessed from the TODO wording):
 *   - `pendingHexWins` is the SOLE gate for advancing past hex_placement_1/2
 *     — phase-manager.js's `_calculateRequirements('hex_placement_1'|
 *     'hex_placement_2')` (~line 1094) returns `met: pendingHex === 0` where
 *     `pendingHex = this._getPendingHexCount()`.
 *   - Before this fix, `_getPendingHexCount()` read a plain in-memory array
 *     with NO Firestore persistence: `full/scripts/admin.js`'s bare
 *     `pendingHexWins` (legacy admin.js path) and
 *     `full/scripts/result-manager.js`'s `ResultManager._pendingHexWins`
 *     (god.html path, wired at god-app.js:171). Both reset to `[]` on every
 *     page load — so a TD refreshing mid-hex-placement (or a second admin/god
 *     device loading fresh) saw the gate silently report "All hex plates
 *     placed" (met: true) regardless of whether a hex had actually been
 *     placed, letting them advance past a phase that should still be
 *     blocked.
 *
 * THE FIX (see result-manager.js / admin.js / admin-improved-adapter.js /
 * board-manager.js / god-app.js diffs for the full rationale):
 *   - `pendingHexWins` is now backed by `gameState.pendingHexWins`, persisted
 *     the same way `gameQueue`/`teams` are (via the existing
 *     saveGameState()/`this._save()` pattern) — a get/set accessor pair on
 *     `ResultManager` (god.html) and a `window` accessor (admin.html, so
 *     every existing bare `pendingHexWins` reference in admin.js AND
 *     admin-improved-adapter.js keeps working with zero call-site changes).
 *   - The standing `#pendingHexBanner` (built by `updatePendingHexNotification()`,
 *     inserted after `.top-bar`) is now re-rendered on EVERY display update —
 *     god.html's `GodApp.updateDisplay()` now calls it directly; admin.html's
 *     `admin-improved-adapter.js` used to unconditionally REMOVE it on every
 *     Flow Panel render ("Flow Panel handles it now") — now it calls
 *     `updatePendingHexNotification()` instead, which itself only removes the
 *     banner once nothing is actually pending. This makes the banner visible
 *     across EVERY phase, not just hex_placement_1/2, and makes it survive a
 *     refresh (since re-rendering on load now happens automatically).
 *   - The data-destroying "dismiss" button/function
 *     (`dismissPendingHexBanner()`, which used to just do
 *     `_pendingHexWins = []`) has been removed entirely on both pages — the
 *     banner can now only disappear via a real `clearPendingHexWin(teamId)`
 *     call, itself only reachable from a genuine `assignTeamToHex()`
 *     placement (board-manager.js:252 / admin.js's assignTeamToHex).
 *
 * GENUINE DATA, NOT SYNTHETIC: like e2e-hex-placement-gate.js, this test does
 * NOT push directly onto `pendingHexWins`/`_pendingHexWins`. It seeds real
 * queue entries (same synthetic-queue-entry pattern e2e-round-advance.js and
 * e2e-hex-placement-gate.js use) with REAL player ids from e2e-disposable-1's
 * actual Team Alpha / Team Beta rosters, confirms results through the real
 * `ResultManager.quickConfirmResult()` (god.html) / `quickConfirmResult()`
 * (admin.html, which resolves to the admin-improved-adapter.js-WRAPPED
 * `confirmResult` by the time the page has loaded — exercising the real
 * slot/roundNumber-tagging + persistence fix too, not a bypass of it), and
 * places hexes through the real `BoardManager.assignTeamToHex()` /
 * `assignTeamToHex()`.
 *
 * PART 1 (god.html) — thorough, covers all 6 points from the task spec:
 *   1. Confirm 2 real match results awarding hex wins to 2 different teams
 *      (Team Alpha, Team Beta) — both pending simultaneously; assert the
 *      indicator shows both.
 *   2. Place Team Alpha's hex — assert Alpha's entry clears, Beta's entry
 *      still shows (multi-team correctness).
 *   3. REAL page reload while Team Beta's hex is still pending — assert the
 *      indicator STILL shows Beta's pending entry, AND the phase gate
 *      (`_getPendingHexCount()`/`getPhaseRequirements()`/`advancePhase()`)
 *      still correctly reports Beta as pending, not "all clear". This is the
 *      core regression test for the gate-bypass bug.
 *   4. Move `currentPhase` to a phase OTHER than hex_placement_1/2 (simulating
 *      "team places late, during spell phase or a board-check phase" — the
 *      exact scenario from the task write-up) with Beta's hex still
 *      outstanding — assert the persistent indicator is STILL visible, not
 *      suppressed by the phase change.
 *   5. Place Team Beta's hex during that later phase — assert it clears
 *      correctly and the indicator disappears once nothing is pending.
 *   6. Confirm no "dismiss" path exists that can wipe data without a real
 *      placement: `window.dismissPendingHexBanner` is gone, and no
 *      `.pending-hex-dismiss` element is ever rendered into the banner.
 *
 * PART 2 (admin.html) — lighter, focused specifically on the two things that
 * are unique to admin.html's code path (the underlying persistence mechanism
 * is structurally identical, already proven thoroughly in Part 1):
 *   a. The admin-improved-adapter.js Flow Panel fix — banner stays visible
 *      during a phase OTHER than hex_placement_1/2 (it used to be
 *      unconditionally removed on every Flow Panel render regardless of
 *      phase).
 *   b. Refresh persistence through admin.js's own `pendingHexWins` window
 *      accessor (a separate implementation from ResultManager's, since
 *      admin.html never loads result-manager.js — confirmed by grep).
 *   c. No dismiss path on admin.html either.
 *
 * Snapshots/restores gameQueue, currentPhase, teams, gamesPlayed,
 * gameHistory, pendingHexWins on BOTH tournament pages' gameState in
 * `finally` blocks (pendingHexWins is now a real persisted array field, so —
 * unlike before this fix — leaving it unrestored would leak synthetic
 * pending-hex data into e2e-disposable-1 permanently, not just for the
 * current page session).
 *
 * Run: cd BoardGame && node dev/tests/e2e-pending-hex-persistence.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function part1_godHtml(browser, baseUrl, tournamentId) {
  console.log('\n========== PART 1: god.html ==========\n');
  const page = await browser.newPage();
  await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
  await gotoTournamentPage(page, baseUrl, 'full/god.html', tournamentId);

  await page.waitForFunction(
    () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
    { timeout: 40000 }
  );

  const roster = await page.evaluate(() => {
    const gs = window.godApp.gameState;
    const teamA = gs.teams[0];
    const teamB = gs.teams[1];
    return {
      teamA: teamA ? { id: teamA.id, name: teamA.name, playerIds: (teamA.players || []).map(p => p.id).filter(Boolean) } : null,
      teamB: teamB ? { id: teamB.id, name: teamB.name, playerIds: (teamB.players || []).map(p => p.id).filter(Boolean) } : null
    };
  });
  assert(roster.teamA && roster.teamA.playerIds.length >= 2,
    `Expected teams[0] to have >=2 real player ids, got: ${JSON.stringify(roster.teamA)}`);
  assert(roster.teamB && roster.teamB.playerIds.length >= 2,
    `Expected teams[1] to have >=2 real player ids, got: ${JSON.stringify(roster.teamB)}`);
  console.log(`Roster: ${roster.teamA.name} (id ${roster.teamA.id}) vs ${roster.teamB.name} (id ${roster.teamB.id})`);

  const coords = await page.evaluate(() => {
    const gs = window.godApp.gameState;
    const bm = window.godApp._boardModule;
    const board = gs.board || {};
    const found = [];
    for (const [q, r] of bm.generateHexCoordinates()) {
      const c = `q${q}r${r}`;
      if (board[c]) continue;
      if (bm.getHexType(q, r) !== 'normal') continue;
      found.push(c);
      if (found.length >= 2) break;
    }
    return found;
  });
  assert(coords.length === 2, `Could not find 2 free normal hex coordinates, got: ${JSON.stringify(coords)}`);
  const [coordA, coordB] = coords;
  console.log(`Using free hex coordinates: ${coordA} (Team A), ${coordB} (Team B)`);

  const original = await page.evaluate(() => ({
    gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || [])),
    currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
    teams: JSON.parse(JSON.stringify(window.godApp.gameState.teams || [])),
    gamesPlayed: window.godApp.gameState.gamesPlayed || 0,
    gameHistory: JSON.parse(JSON.stringify(window.godApp.gameState.gameHistory || [])),
    pendingHexWins: JSON.parse(JSON.stringify(window.godApp.gameState.pendingHexWins || []))
  }));

  const matchIdA = Date.now();
  const matchIdB = matchIdA + 1;

  try {
    // ── Seed 2 real-shaped queue entries + enter hex_placement_1 ──
    await page.evaluate(async (matchIdA, matchIdB, teamA, teamB) => {
      const gs = window.godApp.gameState;
      const mk = (id, matchNumber) => ({
        id, matchNumber, game: 'e2e-pending-hex-test', playType: '1v1',
        teams: [
          { id: teamA.id, playerIds: teamA.playerIds },
          { id: teamB.id, playerIds: teamB.playerIds }
        ],
        status: 'ongoing', createdAt: new Date().toISOString()
      });
      gs.gameQueue = [...(gs.gameQueue || []), mk(matchIdA, 990401), mk(matchIdB, 990402)];
      gs.currentPhase = { name: 'hex_placement_1', roundNumber: 999401, startedAt: new Date().toISOString() };
      await window.godApp.saveGameState();
    }, matchIdA, matchIdB, roster.teamA, roster.teamB);

    // ── CHECKPOINT 1: confirm both results (Alpha wins A, Beta wins B) ──
    const afterBothWins = await page.evaluate(async (matchIdA, matchIdB) => {
      const result = window.godApp.result;
      const phase = window.godApp.phase;
      await result.quickConfirmResult(matchIdA, 0); // Team A (index 0) wins match A
      await result.quickConfirmResult(matchIdB, 1); // Team B (index 1) wins match B
      const banner = document.getElementById('pendingHexBanner');
      return {
        pendingCount: phase._getPendingHexCount(),
        entries: JSON.parse(JSON.stringify(result._pendingHexWins)),
        bannerText: banner ? banner.innerText : null,
        bannerHasDismiss: !!document.querySelector('.pending-hex-dismiss')
      };
    }, matchIdA, matchIdB);

    console.log('--- Checkpoint 1: both wins confirmed ---');
    console.log(JSON.stringify(afterBothWins, null, 2));

    assert(afterBothWins.pendingCount === 2,
      `Expected 2 pending hex-win entries after confirming both matches, got ${afterBothWins.pendingCount}`);
    assert(afterBothWins.entries.length === 2,
      `Expected 2 entries in _pendingHexWins, got ${afterBothWins.entries.length}`);
    const allTeamIds = afterBothWins.entries.flatMap(e => e.teamIds.map(String));
    assert(allTeamIds.includes(String(roster.teamA.id)) && allTeamIds.includes(String(roster.teamB.id)),
      `Expected pending entries to cover both teams, got teamIds: ${JSON.stringify(allTeamIds)}`);
    assert(afterBothWins.bannerText, 'Expected #pendingHexBanner to exist and have text after 2 wins');
    assert(afterBothWins.bannerText.includes(roster.teamA.name) && afterBothWins.bannerText.includes(roster.teamB.name),
      `Expected banner to mention BOTH team names simultaneously, got: "${afterBothWins.bannerText}"`);
    assert(!afterBothWins.bannerHasDismiss,
      'Expected no .pending-hex-dismiss element on the banner (checkpoint 6, part A) — the data-destroying dismiss path must not exist');

    // ── CHECKPOINT 2: place Team A's hex — A clears, B still shows ──
    const afterAPlaced = await page.evaluate(async (coordA, teamAId) => {
      const board = window.godApp.board;
      const result = window.godApp.result;
      const phase = window.godApp.phase;
      await board.assignTeamToHex(coordA, teamAId);
      const banner = document.getElementById('pendingHexBanner');
      return {
        pendingCount: phase._getPendingHexCount(),
        entries: JSON.parse(JSON.stringify(result._pendingHexWins)),
        bannerText: banner ? banner.innerText : null
      };
    }, coordA, roster.teamA.id);

    console.log('--- Checkpoint 2: Team A hex placed ---');
    console.log(JSON.stringify(afterAPlaced, null, 2));

    assert(afterAPlaced.pendingCount === 1,
      `Expected 1 pending entry left after placing Team A's hex, got ${afterAPlaced.pendingCount}`);
    const remainingTeamIds = afterAPlaced.entries.flatMap(e => e.teamIds.map(String));
    assert(!remainingTeamIds.includes(String(roster.teamA.id)),
      `Team A's id should no longer appear in any pending entry, got: ${JSON.stringify(afterAPlaced.entries)}`);
    assert(remainingTeamIds.includes(String(roster.teamB.id)),
      `Team B's entry should be untouched by Team A's placement (multi-team correctness), got: ${JSON.stringify(afterAPlaced.entries)}`);
    assert(afterAPlaced.bannerText && afterAPlaced.bannerText.includes(roster.teamB.name) && !afterAPlaced.bannerText.includes(roster.teamA.name),
      `Banner should now mention only Team B, got: "${afterAPlaced.bannerText}"`);

    // ── CHECKPOINT 3: REAL page reload — core gate-bypass regression check ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );
    // Banner is rendered by GodApp.updateDisplay(), which the onSnapshot
    // handler calls once teams are populated — poll rather than assume
    // it's synchronous with the waitForFunction above.
    await page.waitForFunction(() => !!document.getElementById('pendingHexBanner'), { timeout: 20000 });

    const afterReload = await page.evaluate(async () => {
      const gs = window.godApp.gameState;
      const phase = window.godApp.phase;
      const result = window.godApp.result;
      const banner = document.getElementById('pendingHexBanner');
      const reqs = phase.getPhaseRequirements();
      const advanceResult = await phase.advancePhase();
      const phaseAfterBlockedAttempt = phase.getCurrentPhase();
      return {
        currentPhaseName: gs.currentPhase && gs.currentPhase.name,
        pendingCount: phase._getPendingHexCount(),
        entries: JSON.parse(JSON.stringify(result._pendingHexWins)),
        bannerText: banner ? banner.innerText : null,
        reqs, advanceResult, phaseAfterBlockedAttempt
      };
    });

    console.log('--- Checkpoint 3: after REAL page reload ---');
    console.log(JSON.stringify(afterReload, null, 2));

    assert(afterReload.currentPhaseName === 'hex_placement_1',
      `Expected currentPhase to still be hex_placement_1 after reload, got '${afterReload.currentPhaseName}'`);
    assert(afterReload.pendingCount === 1,
      `CORE REGRESSION CHECK: after reload, pending count should STILL be 1 (Team B), not reset to 0 by the refresh. Got ${afterReload.pendingCount}`);
    const reloadTeamIds = afterReload.entries.flatMap(e => e.teamIds.map(String));
    assert(reloadTeamIds.includes(String(roster.teamB.id)) && !reloadTeamIds.includes(String(roster.teamA.id)),
      `After reload, only Team B should still be pending, got: ${JSON.stringify(afterReload.entries)}`);
    assert(afterReload.bannerText && afterReload.bannerText.includes(roster.teamB.name),
      `CORE REGRESSION CHECK: banner should reappear after reload showing Team B, got: "${afterReload.bannerText}"`);
    assert(afterReload.reqs.allMet === false,
      `CORE REGRESSION CHECK: phase requirements must NOT be met after reload (Team B still owes a placement), got: ${JSON.stringify(afterReload.reqs)}`);
    assert(afterReload.advanceResult === false,
      'CORE REGRESSION CHECK: advancePhase() must return false (blocked) after reload — this is the actual gate-bypass bug this fix closes');
    assert(afterReload.phaseAfterBlockedAttempt === 'hex_placement_1',
      `currentPhase should remain hex_placement_1 after a blocked advance attempt post-reload, got '${afterReload.phaseAfterBlockedAttempt}'`);

    // ── CHECKPOINT 4: move to a LATER phase with Team B still pending —
    // indicator must stay visible (simulates "team places late, during
    // spell phase or a board-check phase") ──
    await page.evaluate(async () => {
      const gs = window.godApp.gameState;
      gs.currentPhase = { name: 'spell_window_1', roundNumber: 999401, startedAt: new Date().toISOString() };
      await window.godApp.saveGameState();
      window.godApp.updateDisplay();
    });

    const afterPhaseChange = await page.evaluate(() => {
      const banner = document.getElementById('pendingHexBanner');
      return {
        currentPhaseName: window.godApp.gameState.currentPhase.name,
        pendingCount: window.godApp.phase._getPendingHexCount(),
        bannerText: banner ? banner.innerText : null
      };
    });

    console.log('--- Checkpoint 4: moved to spell_window_1 with Team B still pending ---');
    console.log(JSON.stringify(afterPhaseChange, null, 2));

    assert(afterPhaseChange.currentPhaseName === 'spell_window_1',
      `Expected to be in spell_window_1 (not a hex_placement phase), got '${afterPhaseChange.currentPhaseName}'`);
    assert(afterPhaseChange.pendingCount === 1, 'Team B should still be pending in the new phase');
    assert(afterPhaseChange.bannerText && afterPhaseChange.bannerText.includes(roster.teamB.name),
      `Indicator must remain visible outside hex_placement_1/2 while a team is still owed a placement, got: "${afterPhaseChange.bannerText}"`);

    // ── CHECKPOINT 5: place Team B's hex during that later phase — clears,
    // indicator disappears ──
    const afterBPlaced = await page.evaluate(async (coordB, teamBId) => {
      const board = window.godApp.board;
      const result = window.godApp.result;
      const phase = window.godApp.phase;
      await board.assignTeamToHex(coordB, teamBId);
      window.godApp.updateDisplay();
      const banner = document.getElementById('pendingHexBanner');
      return {
        pendingCount: phase._getPendingHexCount(),
        entries: result._pendingHexWins,
        bannerExists: !!banner
      };
    }, coordB, roster.teamB.id);

    console.log('--- Checkpoint 5: Team B hex placed in spell_window_1 ---');
    console.log(JSON.stringify(afterBPlaced, null, 2));

    assert(afterBPlaced.pendingCount === 0, `Expected 0 pending entries after placing Team B's hex, got ${afterBPlaced.pendingCount}`);
    assert(afterBPlaced.entries.length === 0, `Expected _pendingHexWins to be empty, got: ${JSON.stringify(afterBPlaced.entries)}`);
    assert(!afterBPlaced.bannerExists, 'Expected #pendingHexBanner to be removed from the DOM once nothing is pending');

    // ── CHECKPOINT 6 (part B): no dismiss path exists anywhere ──
    const dismissCheck = await page.evaluate(() => ({
      windowFnExists: typeof window.dismissPendingHexBanner !== 'undefined',
      methodExists: typeof (window.godApp.result && window.godApp.result.dismissPendingHexBanner) !== 'undefined'
        && window.godApp.result.dismissPendingHexBanner !== undefined
    }));
    console.log('--- Checkpoint 6: dismiss path removed ---');
    console.log(JSON.stringify(dismissCheck, null, 2));
    assert(dismissCheck.windowFnExists === false, 'window.dismissPendingHexBanner must not exist (removed from god-app.js)');
    assert(dismissCheck.methodExists === false, 'ResultManager.dismissPendingHexBanner must not exist (removed from result-manager.js)');

    console.log('\nPART 1 (god.html): all assertions passed.');
  } finally {
    // Clear both test hexes via the real "Clear Hex" path (explicit
    // FieldValue.delete(), not a wholesale board overwrite — merge-set can't
    // remove board map keys by itself). Unconditional/idempotent-safe.
    await page.evaluate((coordA, coordB) => Promise.all([
      window.godApp.board.assignTeamToHex(coordA, null),
      window.godApp.board.assignTeamToHex(coordB, null)
    ]), coordA, coordB);

    await page.evaluate((orig) => {
      const gs = window.godApp.gameState;
      gs.gameQueue = orig.gameQueue;
      gs.currentPhase = orig.currentPhase;
      gs.teams = orig.teams;
      gs.gamesPlayed = orig.gamesPlayed;
      gs.gameHistory = orig.gameHistory;
      gs.pendingHexWins = orig.pendingHexWins;
      return window.godApp.saveGameState();
    }, original);
    console.log('Cleared test hexes and restored original gameQueue/currentPhase/teams/gamesPlayed/gameHistory/pendingHexWins (god.html).');

    await page.close();
  }
}

async function part2_adminHtml(browser, baseUrl, tournamentId) {
  console.log('\n========== PART 2: admin.html ==========\n');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
  await gotoTournamentPage(page, baseUrl, 'full/admin.html', tournamentId);

  await page.waitForFunction(
    () => typeof gameState !== 'undefined' && gameState && Array.isArray(gameState.teams) && gameState.teams.length > 0,
    { timeout: 40000 }
  );

  const roster = await page.evaluate(() => {
    const teamA = gameState.teams[0];
    const teamB = gameState.teams[1];
    return {
      teamA: teamA ? { id: teamA.id, name: teamA.name, playerIds: (teamA.players || []).map(p => p.id).filter(Boolean) } : null,
      teamB: teamB ? { id: teamB.id, name: teamB.name, playerIds: (teamB.players || []).map(p => p.id).filter(Boolean) } : null
    };
  });
  assert(roster.teamA && roster.teamA.playerIds.length >= 2,
    `Expected teams[0] to have >=2 real player ids, got: ${JSON.stringify(roster.teamA)}`);
  assert(roster.teamB && roster.teamB.playerIds.length >= 2,
    `Expected teams[1] to have >=2 real player ids, got: ${JSON.stringify(roster.teamB)}`);
  console.log(`Roster: ${roster.teamA.name} (id ${roster.teamA.id}) vs ${roster.teamB.name} (id ${roster.teamB.id})`);

  const coord = await page.evaluate(() => {
    const board = gameState.board || {};
    for (const [q, r] of boardModule.generateHexCoordinates()) {
      const c = `q${q}r${r}`;
      if (board[c]) continue;
      if (boardModule.getHexType(q, r) !== 'normal') continue;
      return c;
    }
    return null;
  });
  assert(coord, 'Could not find a free normal hex coordinate on admin.html');
  console.log(`Using free hex coordinate: ${coord}`);

  const original = await page.evaluate(() => ({
    gameQueue: JSON.parse(JSON.stringify(gameState.gameQueue || [])),
    currentPhase: JSON.parse(JSON.stringify(gameState.currentPhase || null)),
    teams: JSON.parse(JSON.stringify(gameState.teams || [])),
    gamesPlayed: gameState.gamesPlayed || 0,
    gameHistory: JSON.parse(JSON.stringify(gameState.gameHistory || [])),
    pendingHexWins: JSON.parse(JSON.stringify(gameState.pendingHexWins || []))
  }));

  const matchId = Date.now();

  try {
    // Seed a real-shaped queue entry, enter a phase OTHER than
    // hex_placement_1/2 up front (spell_window_1) — directly targets the
    // admin-improved-adapter.js Flow Panel suppression bug: the banner used
    // to be unconditionally removed on every render regardless of phase.
    await page.evaluate(async (matchId, teamA, teamB) => {
      gameState.gameQueue = [...(gameState.gameQueue || []), {
        id: matchId, matchNumber: 990501, game: 'e2e-pending-hex-test-admin', playType: '1v1',
        teams: [
          { id: teamA.id, playerIds: teamA.playerIds },
          { id: teamB.id, playerIds: teamB.playerIds }
        ],
        status: 'ongoing', createdAt: new Date().toISOString()
      }];
      gameState.currentPhase = { name: 'spell_window_1', roundNumber: 999501, startedAt: new Date().toISOString() };
      await saveGameState();
      // Force a render pass so admin-improved-adapter.js's phase adapter
      // initializes (it's lazy — only kicks in from the first
      // _onAdminDisplayUpdate() call) and the Flow Panel actually mounts.
      updateDisplay();
    }, matchId, roster.teamA, roster.teamB);

    // Confirm the result via the REAL quickConfirmResult() — which by page
    // load time resolves confirmResult() to the admin-improved-adapter.js
    // WRAPPED version (slot/roundNumber tagging + persistence), not a bypass.
    await page.evaluate(async (matchId) => {
      await quickConfirmResult(matchId, 0); // Team A wins
      updateDisplay(); // second render pass — proves the banner SURVIVES it
    }, matchId);

    const afterWin = await page.evaluate(() => {
      const banner = document.getElementById('pendingHexBanner');
      return {
        currentPhaseName: gameState.currentPhase.name,
        pendingCount: pendingHexWins.length,
        bannerText: banner ? banner.innerText : null,
        bannerHasDismiss: !!document.querySelector('.pending-hex-dismiss')
      };
    });

    console.log('--- admin.html: Team A win confirmed, phase = spell_window_1 ---');
    console.log(JSON.stringify(afterWin, null, 2));

    assert(afterWin.currentPhaseName === 'spell_window_1',
      `Expected to still be in spell_window_1 (not hex_placement_1/2), got '${afterWin.currentPhaseName}'`);
    assert(afterWin.pendingCount === 1, `Expected 1 pending hex win, got ${afterWin.pendingCount}`);
    assert(afterWin.bannerText && afterWin.bannerText.includes(roster.teamA.name),
      `admin.html Flow Panel fix: banner must stay visible outside hex_placement_1/2 (used to be unconditionally removed every render), got: "${afterWin.bannerText}"`);
    assert(!afterWin.bannerHasDismiss, 'Expected no .pending-hex-dismiss element on admin.html either');

    // ── Real page reload — proves admin.js's own pendingHexWins accessor
    // persists too (a separate implementation from ResultManager's, since
    // admin.html never loads result-manager.js) ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof gameState !== 'undefined' && gameState && Array.isArray(gameState.teams) && gameState.teams.length > 0,
      { timeout: 40000 }
    );
    await page.waitForFunction(() => !!document.getElementById('pendingHexBanner'), { timeout: 20000 });

    const afterReload = await page.evaluate(() => {
      const banner = document.getElementById('pendingHexBanner');
      return {
        currentPhaseName: gameState.currentPhase && gameState.currentPhase.name,
        pendingCount: pendingHexWins.length,
        entries: JSON.parse(JSON.stringify(pendingHexWins)),
        bannerText: banner ? banner.innerText : null
      };
    });

    console.log('--- admin.html: after REAL page reload ---');
    console.log(JSON.stringify(afterReload, null, 2));

    assert(afterReload.currentPhaseName === 'spell_window_1',
      `Expected phase to persist across reload as spell_window_1, got '${afterReload.currentPhaseName}'`);
    assert(afterReload.pendingCount === 1,
      `CORE REGRESSION CHECK (admin.html): pending count should survive reload as 1, got ${afterReload.pendingCount}`);
    assert(afterReload.bannerText && afterReload.bannerText.includes(roster.teamA.name),
      `Banner should reappear after reload on admin.html too, got: "${afterReload.bannerText}"`);

    // No dismiss path on admin.html either
    const dismissCheck = await page.evaluate(() => ({
      windowFnExists: typeof window.dismissPendingHexBanner !== 'undefined',
      globalFnExists: typeof dismissPendingHexBanner !== 'undefined'
    }));
    assert(dismissCheck.windowFnExists === false, 'window.dismissPendingHexBanner must not exist on admin.html');
    assert(dismissCheck.globalFnExists === false, 'Bare dismissPendingHexBanner() must not exist on admin.html (removed from admin.js)');

    // ── Place Team A's hex — clears, banner disappears ──
    const afterPlaced = await page.evaluate(async (coord, teamAId) => {
      await assignTeamToHex(coord, teamAId);
      updateDisplay();
      const banner = document.getElementById('pendingHexBanner');
      return { pendingCount: pendingHexWins.length, bannerExists: !!banner };
    }, coord, roster.teamA.id);

    console.log('--- admin.html: Team A hex placed ---');
    console.log(JSON.stringify(afterPlaced, null, 2));
    assert(afterPlaced.pendingCount === 0, `Expected 0 pending entries after placement, got ${afterPlaced.pendingCount}`);
    assert(!afterPlaced.bannerExists, 'Expected banner removed once nothing pending (admin.html)');

    console.log('\nPART 2 (admin.html): all assertions passed.');
  } finally {
    await page.evaluate((coord) => assignTeamToHex(coord, null), coord);

    await page.evaluate((orig) => {
      gameState.gameQueue = orig.gameQueue;
      gameState.currentPhase = orig.currentPhase;
      gameState.teams = orig.teams;
      gameState.gamesPlayed = orig.gamesPlayed;
      gameState.gameHistory = orig.gameHistory;
      gameState.pendingHexWins = orig.pendingHexWins;
      return saveGameState();
    }, original);
    console.log('Cleared test hex and restored original gameQueue/currentPhase/teams/gamesPlayed/gameHistory/pendingHexWins (admin.html).');

    await page.close();
  }
}

async function main() {
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const tournamentId = process.env.TEST_TOURNAMENT_ID || 'e2e-disposable-1';

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });
  let allPassed = false;

  try {
    await part1_godHtml(browser, baseUrl, tournamentId);
    await part2_adminHtml(browser, baseUrl, tournamentId);
    allPassed = true;
  } finally {
    await browser.close();
    server.close();
  }

  if (!allPassed) process.exitCode = 1;
  else console.log('\n=== ALL PARTS PASSED ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
