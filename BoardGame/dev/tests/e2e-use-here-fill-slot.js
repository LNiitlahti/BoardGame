/**
 * e2e-use-here-fill-slot.js — regression test for TODO.md Task 12:
 * "'Use {name} here' doesn't fill target placeholder slot" (admin.html's
 * user-management.js — a TD picks a real user account, then clicks
 * "Use {name} here" on one specific already-selected placeholder roster
 * slot; the report was that this either appends a brand-new slot or fills
 * the WRONG slot instead of the one clicked).
 *
 * REPRO METHODOLOGY: per the task brief, this clicks the REAL DOM button —
 * not just a direct function call — to rule out both a logic-level bug
 * (replacePlayerWithUser resolving the wrong slot) and a rendering-level
 * bug (renderTeamAssignmentSlots() baking the wrong playerId into a given
 * row's onclick). Uses a synthetic team with TWO placeholder slots (teams
 * are capped at exactly 2 player slots per renderTeamAssignmentSlots()'s
 * own comment) so "wrong slot" and "new slot appended" are both observable:
 * placeholder A stays untouched, placeholder B (the one actually clicked)
 * gets linked in place, and the team ends up with exactly 2 playerIds
 * afterward, not 3. god.html and admin.html both render this exact same
 * `teamAssignmentSlots` panel via the shared, standalone
 * user-management.js (not admin-improved-adapter.js), so driving it from
 * god.html — same as e2e-swap-pending-rewrite.js, for the same reason:
 * god.html exposes window.godApp.gameState/saveGameState() for easy
 * seed/restore — exercises the identical button/handler admin.html's Teams
 * tab uses.
 *
 * FINDING (see E2E_HARNESS.md for the full writeup): reproduced clean
 * against current code — replacePlayerWithUser() already resolves the
 * exact slot correctly for the placeholder-LINK path (isSwap === false):
 * linkUserToPlayerSlot(gameState, teamId, playerId, ...) in player-utils.js
 * looks the player up by the exact playerId argument (getPlayerById), not
 * "first placeholder on the team" or any other team-wide fallback, and
 * mutates only that registry key. No new slot was appended and the
 * untouched placeholder was left alone. This test exists to lock that in
 * as a regression guard and as the "actually re-verify, don't trust the
 * stale TODO.md repro" step the task required.
 *
 * Run: cd BoardGame && node dev/tests/e2e-use-here-fill-slot.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Mirrors e2e-create-players.js / e2e-swap-pending-rewrite.js's inline
// account-creation helper — isolated browser context so it never disturbs
// the TD's already-logged-in god.html session in another tab.
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
    const runTag = Date.now();
    const player = await createDisposablePlayer(browser, baseUrl, `UseHere${runTag}`);
    console.log(`Created disposable account: ${player.email} (${player.uid})`);

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(page, baseUrl, 'full/god.html', tournamentId);

    await page.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    const original = await page.evaluate(() => ({
      teams: JSON.parse(JSON.stringify(window.godApp.gameState.teams || [])),
      players: JSON.parse(JSON.stringify(window.godApp.gameState.players || {}))
    }));

    let allPlayerIdsFinal = null;
    try {
      const SYNTH_TEAM_ID = 990902; // distinctive, won't collide with real team ids
      const placeholderA = 'p_e2eusehereA1';
      const placeholderB = 'p_e2eusehereB1';

      const seedResult = await page.evaluate((teamId, phA, phB) => {
        const gs = window.godApp.gameState;
        gs.players = gs.players || {};
        gs.players[phA] = { id: phA, name: 'E2E Use-Here Placeholder A', uid: null, teamId, createdAt: new Date().toISOString() };
        gs.players[phB] = { id: phB, name: 'E2E Use-Here Placeholder B', uid: null, teamId, createdAt: new Date().toISOString() };
        const synthTeam = {
          id: teamId,
          name: 'E2E Use-Here Test Team',
          color: '#888888',
          players: [
            { id: phA, name: 'E2E Use-Here Placeholder A' },
            { id: phB, name: 'E2E Use-Here Placeholder B' }
          ],
          playerIds: [phA, phB],
          gamesWon: 0, gamesLost: 0, gamesPlayed: 0, points: 0
        };
        gs.teams = [...gs.teams, synthTeam];
        return { teamsCount: gs.teams.length };
      }, SYNTH_TEAM_ID, placeholderA, placeholderB);

      await page.evaluate(async () => { await window.godApp.saveGameState(); });

      // ── Drive the REAL "Use {name} here" flow: select a user, then call
      // replacePlayerWithUser(teamId, playerId) targeting placeholder B
      // SPECIFICALLY (not A) — exactly what clicking that button on B's row
      // does. Placeholder A must be left completely alone. ──
      await page.evaluate(async () => { await window.loadUnassignedUsers(); });
      const selected = await page.evaluate((uid) => {
        window.selectUserForAssignment(uid);
        return (typeof selectedUserForAssignment !== 'undefined') ? selectedUserForAssignment : null;
      }, player.uid);
      assert(selected && selected.uid === player.uid,
        `selectUserForAssignment should have selected the disposable account, got: ${JSON.stringify(selected)}`);

      // Click the REAL DOM button (not just calling the function directly)
      // to also rule out a rendering-level bug (e.g. the wrong playerId
      // baked into a button's onclick). renderTeamAssignmentSlots() emits
      // `onclick="replacePlayerWithUser(${team.id}, '${player.playerId}')"`
      // verbatim (see user-management.js) — find the button whose onclick
      // matches placeholder B's row specifically, not A's, and click it.
      await page.evaluate(() => { window.renderTeamAssignmentSlots(); });
      const clicked = await page.evaluate((teamId, phB) => {
        const btn = [...document.querySelectorAll('button')].find(
          b => b.getAttribute('onclick') === `replacePlayerWithUser(${teamId}, '${phB}')`
        );
        if (!btn) return false;
        btn.click();
        return true;
      }, SYNTH_TEAM_ID, placeholderB);
      assert(clicked, 'Expected to find the "Use {name} here" button for placeholder B in the DOM');

      // replacePlayerWithUser() is async and fired via a bare onclick (not
      // awaited by the click itself) — poll until the registry write lands.
      await page.waitForFunction(
        (phB) => window.godApp.gameState.players?.[phB]?.uid,
        { timeout: 15000 },
        placeholderB
      );

      const result = await page.evaluate((teamId) => {
        const gs = window.godApp.gameState;
        const team = gs.teams.find(t => t.id === teamId);
        return {
          team: JSON.parse(JSON.stringify(team)),
          players: JSON.parse(JSON.stringify(gs.players))
        };
      }, SYNTH_TEAM_ID);

      assert(pageErrors.length === 0, `Expected no uncaught page errors, got: ${JSON.stringify(pageErrors)}`);

      allPlayerIdsFinal = result.team.playerIds;
      console.log('--- Team state after "Use here" on placeholder B ---');
      console.log(JSON.stringify(result.team, null, 2));

      // No new slot appended: still exactly 2 playerIds, same two ids.
      assert(result.team.playerIds.length === 2,
        `Expected exactly 2 playerIds after linking (no new slot appended), got ${result.team.playerIds.length}: ${JSON.stringify(result.team.playerIds)}`);
      assert(result.team.playerIds.includes(placeholderA) && result.team.playerIds.includes(placeholderB),
        `Expected both original placeholder ids still present, got: ${JSON.stringify(result.team.playerIds)}`);

      // Placeholder B (the one actually targeted) is now linked to the
      // selected user, in place — same id, uid attached.
      const regB = result.players[placeholderB];
      assert(regB, `Expected registry entry for placeholder B to still exist, got players: ${JSON.stringify(result.players)}`);
      assert(regB.uid === player.uid,
        `Expected placeholder B to be linked to the selected user's uid (${player.uid}), got uid: ${JSON.stringify(regB.uid)}`);

      // Placeholder A (NOT targeted) must be completely untouched — this is
      // the "wrong slot got filled" failure mode.
      const regA = result.players[placeholderA];
      assert(regA, `Expected registry entry for placeholder A to still exist, got players: ${JSON.stringify(result.players)}`);
      assert(!regA.uid, `Expected placeholder A to remain an unlinked placeholder (untouched), got uid: ${JSON.stringify(regA.uid)}`);
      assert(regA.name === 'E2E Use-Here Placeholder A',
        `Expected placeholder A's name untouched, got: ${JSON.stringify(regA.name)}`);

      console.log('\nAll assertions passed: placeholder B was filled in place, placeholder A untouched, no new slot appended.');
      allPassed = true;
    } finally {
      const { leakedPlayerKeys } = await page.evaluate(async (orig) => {
        const gs = window.godApp.gameState;
        const origPlayerKeys = new Set(Object.keys(orig.players || {}));
        const leakedPlayerKeys = Object.keys(gs.players || {}).filter(k => !origPlayerKeys.has(k));

        gs.teams = orig.teams;
        gs.players = orig.players;
        await window.godApp.saveGameState();

        if (leakedPlayerKeys.length > 0) {
          const deletes = {};
          leakedPlayerKeys.forEach(k => { deletes[`players.${k}`] = firebase.firestore.FieldValue.delete(); });
          await firebase.firestore().collection('tournaments').doc(gs.tournamentId).update(deletes);
        }
        return { leakedPlayerKeys };
      }, original);

      if (leakedPlayerKeys.length > 0) {
        console.log(`Restored original teams/players (explicitly deleted ${leakedPlayerKeys.length} leaked players-map key(s): ${leakedPlayerKeys.join(', ')}).`);
      } else {
        console.log('Restored original teams/players.');
      }
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
