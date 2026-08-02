/**
 * e2e-swap-pending-rewrite.js — regression test for TODO.md's "Pending
 * (unplayed) matches keep showing retired player after a swap" finding,
 * plus TODO.md Task 10's follow-up decision that mid-match (ongoing) swaps
 * should ALSO reassign credit to the new occupant.
 *
 * ROOT CAUSE (confirmed, see TODO.md): getMatchTeamPlayers()
 * (team-manager.js:69-87) resolves each match's players via a live
 * PlayerUtils.getPlayerDisplayInfo(gameState, playerId) lookup — correct and
 * intentional, since it's what protects COMPLETED match history from ever
 * being retroactively relabeled. But a PENDING (not-yet-played) queue
 * entry's teams[].playerIds still contains the concrete old player id frozen
 * in at queue-creation time (match-creation-manager.js's addMatchToQueue),
 * since nothing previously re-targeted already-queued-but-unplayed matches
 * to a slot's new occupant after a roster swap.
 *
 * THE FIX (user-management.js): replacePlayerWithUser() now calls a new
 * helper, rewritePendingQueueReferences(gameState, oldPlayerId,
 * newPlayerId), right after a successful swap (PlayerUtils.swapPlayerInSlot
 * succeeds). It walks gameState.gameQueue and rewrites teams[].playerIds
 * entries matching the old id to the new id, for every match whose status
 * is NOT 'completed' — pending, queued, AND ongoing all get rewritten now.
 * Completed match history must keep pointing at whoever actually played;
 * that's the one exclusion. (Task 10 investigated whether rewriting an
 * ongoing match's playerIds mid-play could desync anything — it can't:
 * result-manager.js's confirm-result path resolves playerIds live off the
 * queue entry at confirmation time, not a match-start snapshot, and turn
 * state is keyed by teamId, not playerId.) gameQueue is only included in
 * the Firestore save when at least one entry was actually touched (matches
 * the file's existing minimal-payload style).
 *
 * WHAT THIS TEST DOES: drives the REAL replacePlayerWithUser() on god.html
 * end-to-end (not a reimplementation) —
 *   1. Creates 2 brand-new disposable player accounts inline (timestamped
 *      names, so this test is safely re-runnable — see the burned-uid
 *      gotcha below).
 *   2. Seeds a temporary synthetic team whose single roster slot is
 *      pre-linked to disposable account A (i.e. already "isSwap"-eligible —
 *      swapPlayerInSlot requires the existing occupant to already have a
 *      uid).
 *   3. Seeds 4 gameQueue entries referencing that slot's player id:
 *        - 2 NOT-STARTED entries (status 'pending' and 'queued' — the two
 *          "not started yet" flavors actually produced by real
 *          match-creation-manager.js code)
 *        - 1 'ongoing' entry
 *        - 1 'completed' entry
 *   4. Calls the real loadUnassignedUsers() / selectUserForAssignment() /
 *      replacePlayerWithUser() functions — exactly what clicking "Use
 *      {name} here" in the Teams tab does — to swap the slot from account A
 *      to account B, auto-accepting the native confirm() dialog the swap
 *      path shows (same technique as e2e-multitab-freeze.js).
 *   5. Asserts:
 *        - The pending, queued, AND ongoing entries' playerIds now reference
 *          the NEW player id, not the old one (the fix, positive case,
 *          scope = pending AND ongoing).
 *        - The completed entry's playerIds are UNCHANGED, still referencing
 *          the OLD id (the scope boundary the fix must respect — the
 *          important negative case, since the whole point of NOT touching
 *          completed history depends on this).
 *
 * BURNED-UID GOTCHA (E2E_HARNESS.md): a roster swap permanently burns the
 * incoming user's uid in the tournament's player registry (replacePlayerWithUser
 * refuses "User is already assigned in this tournament" for any uid ever
 * seen in gameState.players, even after being swapped back out). Since this
 * script's synthetic team + registry entries are snapshotted/restored in a
 * `finally` block, disposable account B's uid is NOT left in the live
 * registry after a successful run — but a run that crashes between the swap
 * and the restore could leave it there, which is exactly why every account
 * this script uses is freshly created (timestamped name) rather than reused
 * across runs.
 *
 * Snapshots/restores gameState.teams, .players, .gameQueue in a `finally`
 * block, per every sibling script's convention.
 *
 * Run: cd BoardGame && node dev/tests/e2e-swap-pending-rewrite.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Mirrors e2e-create-players.js's account-creation logic inline (that
// script is a standalone CLI entry point, not a requireable module) — runs
// in its own isolated browser context so it never disturbs the TD's
// already-logged-in god.html session in another tab.
async function createDisposablePlayer(browser, baseUrl, name) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    const email = `lniitlahti+${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@gmail.com`;
    const password = `!E2e${name}Pass1`;
    await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
    const uid = await page.evaluate(async (email, password, name) => {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      await firebase.firestore().collection('users').doc(uid).set({
        uid, email,
        firstName: name, lastName: 'E2E',
        displayName: name, fullName: `${name} E2E`,
        isAdmin: false, isSuperAdmin: false, isGod: false,
        assignedTournamentId: null, assignedTeamId: null, assignedTeamName: null,
        appointedAt: null, appointedBy: null,
        createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(),
        referralCode: 'e2e-disposable-script'
      });
      return uid;
    }, email, password, name);
    return { name, email, password, uid };
  } finally {
    await context.close();
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
    // Timestamped names guarantee a fresh, never-before-used uid every run
    // (required by the burned-uid gotcha — see header).
    const runTag = Date.now();
    const playerA = await createDisposablePlayer(browser, baseUrl, `SwapPendA${runTag}`);
    const playerB = await createDisposablePlayer(browser, baseUrl, `SwapPendB${runTag}`);
    console.log(`Created disposable accounts: A=${playerA.email} (${playerA.uid}), B=${playerB.email} (${playerB.uid})`);

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(page, baseUrl, 'full/god.html', tournamentId);

    await page.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    // Snapshot original state so we can restore it afterward, regardless of
    // pass/fail.
    const original = await page.evaluate(() => ({
      teams: JSON.parse(JSON.stringify(window.godApp.gameState.teams || [])),
      players: JSON.parse(JSON.stringify(window.godApp.gameState.players || {})),
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || []))
    }));

    let outcome;
    try {
      outcome = await page.evaluate(async (playerAArg, playerBArg) => {
        const gs = window.godApp.gameState;

        // ── Seed a temporary synthetic team with ONE roster slot, already
        // linked to disposable account A (a placeholder can't be swapped —
        // PlayerUtils.swapPlayerInSlot requires the existing occupant to
        // already have a .uid; that's the "isSwap" path, distinct from
        // linkUserToPlayerSlot's first-time-link path). Player id must
        // start with 'p_' and the registry teamId must agree with the
        // team's roster, or PlayerUtils.needsPlayerMigration() (which runs
        // on every Firestore onSnapshot) will trigger an unwanted
        // auto-migration — see E2E_HARNESS.md's player-registry gotcha. ──
        const SYNTH_TEAM_ID = 990901; // distinctive, won't collide with real team ids
        const oldPlayerId = 'p_e2eswappend01';
        gs.players = gs.players || {};
        gs.players[oldPlayerId] = {
          id: oldPlayerId, name: 'E2E Swap-Pending Old Player',
          uid: playerAArg.uid, teamId: SYNTH_TEAM_ID,
          createdAt: new Date().toISOString()
        };
        const synthTeam = {
          id: SYNTH_TEAM_ID,
          name: 'E2E Swap-Pending Test Team',
          color: '#888888',
          players: [{ id: oldPlayerId, uid: playerAArg.uid, name: 'E2E Swap-Pending Old Player', email: playerAArg.email }],
          playerIds: [oldPlayerId],
          gamesWon: 0, gamesLost: 0, gamesPlayed: 0, points: 0
        };
        gs.teams = [...gs.teams, synthTeam];

        // ── Seed 4 gameQueue entries referencing oldPlayerId: 2 not-started
        // (the 'pending'/'queued' statuses real match-creation-manager.js
        // actually produces), 1 ongoing, 1 completed. A harmless opposing
        // side placeholder id is used for TEAM_B since no assertion touches
        // it. ──
        const baseId = Date.now();
        const opponentId = 'p_e2eswappendopp';
        const teamsShape = () => ([
          { id: 'TEAM_A', playerIds: [oldPlayerId] },
          { id: 'TEAM_B', playerIds: [opponentId] }
        ]);
        const pendingEntry = { id: baseId + 0, matchNumber: 990601, game: 'e2e-test-game', playType: '1v1', teams: teamsShape(), status: 'pending', createdAt: new Date().toISOString() };
        const queuedEntry = { id: baseId + 1, matchNumber: 990602, game: 'e2e-test-game', playType: '1v1', teams: teamsShape(), status: 'queued', createdAt: new Date().toISOString() };
        const ongoingEntry = { id: baseId + 2, matchNumber: 990603, game: 'e2e-test-game', playType: '1v1', teams: teamsShape(), status: 'ongoing', createdAt: new Date().toISOString() };
        const completedEntry = { id: baseId + 3, matchNumber: 990604, game: 'e2e-test-game', playType: '1v1', teams: teamsShape(), status: 'completed', createdAt: new Date().toISOString(), winnerIndex: 0 };
        gs.gameQueue = [...(gs.gameQueue || []), pendingEntry, queuedEntry, ongoingEntry, completedEntry];

        await window.godApp.saveGameState();

        // ── Drive the REAL swap through the real exported functions —
        // exactly what clicking "Use {name} here" in the Teams tab does. ──
        await window.loadUnassignedUsers();
        window.selectUserForAssignment(playerBArg.uid);

        return {
          selected: (typeof selectedUserForAssignment !== 'undefined') ? selectedUserForAssignment : null,
          pendingId: pendingEntry.id, queuedId: queuedEntry.id, ongoingId: ongoingEntry.id, completedId: completedEntry.id,
          oldPlayerId
        };
      }, playerA, playerB);

      assert(pageErrors.length === 0, `Expected no uncaught page errors before the swap, got: ${JSON.stringify(pageErrors)}`);
      assert(outcome.selected && outcome.selected.uid === playerB.uid,
        `selectUserForAssignment should have selected disposable account B, got: ${JSON.stringify(outcome.selected)}`);

      // Auto-accept the native confirm() dialog replacePlayerWithUser()
      // shows for a swap (see E2E_HARNESS.md's showStatus/toast gotcha and
      // e2e-multitab-freeze.js, which established this pattern first).
      page.once('dialog', async (dialog) => { await dialog.accept(); });

      const swapResult = await page.evaluate(async (synthTeamId, oldPlayerId) => {
        await window.replacePlayerWithUser(synthTeamId, oldPlayerId);
        const gs = window.godApp.gameState;
        return {
          finalQueue: JSON.parse(JSON.stringify(gs.gameQueue)),
          finalPlayers: JSON.parse(JSON.stringify(gs.players))
        };
      }, 990901, outcome.oldPlayerId);

      assert(pageErrors.length === 0, `Expected no uncaught page errors after the swap, got: ${JSON.stringify(pageErrors)}`);

      const newPlayerEntry = Object.values(swapResult.finalPlayers).find(p => p.uid === playerB.uid);
      assert(newPlayerEntry, `Expected a registry entry linked to disposable account B's uid after the swap, got players: ${JSON.stringify(swapResult.finalPlayers)}`);
      const newPlayerId = newPlayerEntry.id;
      assert(newPlayerId !== outcome.oldPlayerId, 'Swap should mint a fresh player id, not reuse the old one');

      const oldPlayerRegistryEntry = swapResult.finalPlayers[outcome.oldPlayerId];
      assert(oldPlayerRegistryEntry, 'Old player registry entry should still exist (retired, not deleted — protects completed-match history resolution)');
      assert(oldPlayerRegistryEntry.teamId === null, `Old player registry entry should be retired (teamId: null), got teamId: ${JSON.stringify(oldPlayerRegistryEntry.teamId)}`);

      const findMatch = (id) => swapResult.finalQueue.find(m => m.id === id);
      const playerIdsFor = (match) => match.teams.find(t => t.id === 'TEAM_A').playerIds;

      // ── POSITIVE CASE: pending, queued, AND ongoing entries must now
      // reference the NEW player id, not the old one. This is the fix's
      // scope as of Task 10 — mid-match swaps reassign credit to the new
      // occupant, same as not-yet-started matches. ──
      const pendingMatch = findMatch(outcome.pendingId);
      const queuedMatch = findMatch(outcome.queuedId);
      const ongoingMatch = findMatch(outcome.ongoingId);
      assert(pendingMatch, 'pending queue entry should still exist');
      assert(queuedMatch, 'queued queue entry should still exist');
      assert(ongoingMatch, 'ongoing queue entry should still exist');
      assert(playerIdsFor(pendingMatch).includes(newPlayerId) && !playerIdsFor(pendingMatch).includes(outcome.oldPlayerId),
        `Pending entry should be rewritten to the new player id, got playerIds: ${JSON.stringify(playerIdsFor(pendingMatch))}`);
      assert(playerIdsFor(queuedMatch).includes(newPlayerId) && !playerIdsFor(queuedMatch).includes(outcome.oldPlayerId),
        `Queued entry should be rewritten to the new player id, got playerIds: ${JSON.stringify(playerIdsFor(queuedMatch))}`);
      assert(playerIdsFor(ongoingMatch).includes(newPlayerId) && !playerIdsFor(ongoingMatch).includes(outcome.oldPlayerId),
        `Ongoing entry should be rewritten to the new player id (Task 10 scope change), got playerIds: ${JSON.stringify(playerIdsFor(ongoingMatch))}`);

      // ── NEGATIVE CASE (the scope boundary the fix depends on): the
      // completed entry must be UNTOUCHED, still referencing the OLD id —
      // completed match history must never be retroactively reattributed.
      // This is the one status the rewrite must never touch. ──
      const completedMatch = findMatch(outcome.completedId);
      assert(completedMatch, 'completed queue entry should still exist');
      assert(playerIdsFor(completedMatch).includes(outcome.oldPlayerId) && !playerIdsFor(completedMatch).includes(newPlayerId),
        `Completed entry must NOT be rewritten (scope boundary), got playerIds: ${JSON.stringify(playerIdsFor(completedMatch))}`);

      console.log('--- Final queue entries after swap ---');
      console.log(JSON.stringify(swapResult.finalQueue.map(m => ({ id: m.id, status: m.status, playerIdsA: playerIdsFor(m) })), null, 2));

      console.log('\nAll assertions passed.');
      allPassed = true;
    } finally {
      // Restore original teams/players/gameQueue — runs even if an
      // assertion above threw, so the synthetic team, registry entries
      // (including disposable account B's now-burned uid), and queue
      // entries are never left behind in the shared disposable tournament.
      //
      // gameState.players is a Firestore MAP field (`{ [playerId]: {...} }`),
      // not an array like teams/gameQueue/gameHistory — same category as
      // `board` (E2E_HARNESS.md's documented gotcha). saveGameState()'s
      // `set(data, {merge:true})` does NOT delete map keys simply omitted
      // from what's written: reassigning gs.players back to the pre-test
      // snapshot and saving leaves any KEY this test added (the retired old
      // player, the freshly-minted new player id from the swap) sitting in
      // the live registry forever, merged in on top of the restored keys.
      // Discovered the hard way on the very first live run of this script:
      // p_e2eswappend01 and the swap's newly minted id both leaked into
      // e2e-disposable-1 and had to be repaired manually. Fix: explicitly
      // FieldValue.delete() any registry key present now that wasn't in the
      // original snapshot, the same way assignTeamToHex(coord, null) does
      // for `board`.
      await page.evaluate(async (orig) => {
        const gs = window.godApp.gameState;
        const origPlayerKeys = new Set(Object.keys(orig.players || {}));
        const leakedPlayerKeys = Object.keys(gs.players || {}).filter(k => !origPlayerKeys.has(k));

        gs.teams = orig.teams;
        gs.players = orig.players;
        gs.gameQueue = orig.gameQueue;
        await window.godApp.saveGameState();

        if (leakedPlayerKeys.length > 0) {
          const deletes = {};
          leakedPlayerKeys.forEach(k => { deletes[`players.${k}`] = firebase.firestore.FieldValue.delete(); });
          await firebase.firestore().collection('tournaments').doc(gs.tournamentId).update(deletes);
        }
        return { leakedPlayerKeys };
      }, original).then(({ leakedPlayerKeys }) => {
        if (leakedPlayerKeys.length > 0) {
          console.log(`Restored original teams/players/gameQueue (explicitly deleted ${leakedPlayerKeys.length} leaked players-map key(s): ${leakedPlayerKeys.join(', ')}).`);
        } else {
          console.log('Restored original teams/players/gameQueue.');
        }
      });
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
