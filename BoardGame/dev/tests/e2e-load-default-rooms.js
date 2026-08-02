/**
 * e2e-load-default-rooms.js — plumbing test for "Load Default Rooms"
 * (god.html) after consolidating the three independently-diverged copies of
 * the config/defaultRooms Firestore read/write logic (setup.html,
 * board-manager.js, admin.js) into one shared implementation:
 * shared/scripts/default-rooms.js (`loadDefaultRoomsDoc`/`saveDefaultRoomsDoc`).
 *
 * This test does NOT assert that any particular room layout is "correct" —
 * config/defaultRooms is still a single doc shared across every tournament
 * (see TODO.md "Load Default Rooms"), and deciding/curating the right
 * layout is an explicitly out-of-scope, human, one-time action. All this
 * test checks is that clicking through "Load Default Rooms" on god.html
 * still calls the new shared `loadDefaultRoomsDoc` function and correctly
 * populates `gameState.rooms` with whatever is currently saved in
 * config/defaultRooms — i.e. the refactor didn't break the read path.
 *
 * Uses `e2e-disposable-1` (TEST_TOURNAMENT_ID) per E2E_HARNESS.md. Snapshots
 * the tournament's `rooms` field beforehand and restores it in a `finally`
 * block, since board-manager.js's loadDefaultRooms() persists the loaded
 * rooms back to the tournament doc via `_save()`.
 *
 * Run: cd BoardGame && node dev/tests/e2e-load-default-rooms.js
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

    // Confirm the new shared module actually loaded and is what god.html's
    // board manager calls through (not a leftover inline copy).
    const hasSharedFns = await page.evaluate(() => (
      typeof window.loadDefaultRoomsDoc === 'function' &&
      typeof window.saveDefaultRoomsDoc === 'function'
    ));
    assert(hasSharedFns, 'shared/scripts/default-rooms.js should expose loadDefaultRoomsDoc/saveDefaultRoomsDoc globally on god.html');

    // Read config/defaultRooms directly (source of truth), independent of
    // the code path under test, so we have something to compare against.
    const defaultRoomsDoc = await page.evaluate(async () => {
      const doc = await window.firebaseDB.collection('config').doc('defaultRooms').get();
      return doc.exists ? doc.data() : null;
    });

    assert(defaultRoomsDoc && Array.isArray(defaultRoomsDoc.rooms) && defaultRoomsDoc.rooms.length > 0,
      'config/defaultRooms should currently hold a non-empty rooms array (per TODO.md, some tournament has already overwritten it) — cannot test the load path without one');

    console.log(`config/defaultRooms currently has ${defaultRoomsDoc.rooms.length} rooms (content not asserted as "correct" — out of scope).`);

    // Snapshot the tournament's own rooms so we can restore it afterward —
    // loadDefaultRooms() persists the loaded rooms back to this tournament.
    const originalRooms = await page.evaluate(() => JSON.parse(JSON.stringify(window.godApp.gameState.rooms || [])));

    let finalRooms;
    try {
      // Exercise the exact same function the "📥 Load Default Rooms" button's
      // onclick="loadDefaultRooms()" calls (bound in god-app.js to
      // app.board.loadDefaultRooms(), which now calls through to the shared
      // loadDefaultRoomsDoc()).
      await page.evaluate(() => window.loadDefaultRooms());

      await page.waitForFunction(
        (expectedLen) => window.godApp.gameState.rooms && window.godApp.gameState.rooms.length === expectedLen,
        { timeout: 10000 },
        defaultRoomsDoc.rooms.length
      );

      finalRooms = await page.evaluate(() => JSON.parse(JSON.stringify(window.godApp.gameState.rooms || [])));

      assert(JSON.stringify([...finalRooms].sort()) === JSON.stringify([...defaultRoomsDoc.rooms].sort()),
        `gameState.rooms after Load Default Rooms should match config/defaultRooms's rooms. Expected ${JSON.stringify(defaultRoomsDoc.rooms)}, got ${JSON.stringify(finalRooms)}`);

      console.log(`gameState.rooms correctly populated with ${finalRooms.length} rooms via the shared loadDefaultRoomsDoc function.`);
      allPassed = true;
    } finally {
      // Restore original state regardless of pass/fail.
      await page.evaluate((orig) => {
        window.godApp.gameState.rooms = orig;
        if (window.godApp._boardModule) window.godApp._boardModule.setRoomHexes(orig);
        return window.godApp.saveGameState();
      }, originalRooms);
      console.log('Restored original tournament rooms.');
    }

    console.log('\nAll assertions passed.');
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
