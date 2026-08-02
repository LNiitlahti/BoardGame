/**
 * e2e-ready-check.js — verification test for the Discord/Game Lobby
 * ready-check confirm-button flow (TODO.md: "Verify the Discord/Game Lobby
 * ready-check confirm buttons actually work end-to-end with a real linked
 * player...").
 *
 * ROOT CAUSE FOUND (this is a confirmed bug, not just "unverified"):
 * `_getPlayersWhoMustReadyForSlot()` in phase-manager.js derives `mustReady`
 * by reading `match.sides[].players[].teamId`. But NO real match-creation
 * code path (match-creation-manager.js's addMatchToQueue / confirmMassImport,
 * admin.js's manual queue builders) ever writes a `.sides` field shaped that
 * way — every real queue entry only ever has `.teams: [{id, playerIds:
 * [<plain id strings>]}]` (confirmed by reading match-creation-manager.js
 * lines ~528-547, ~1022-1081). So `(match.sides || [])` is `[]` for every
 * real match that has ever existed, `activeTeamIds` stays empty, and
 * `mustReady` is UNCONDITIONALLY EMPTY regardless of whether real linked
 * accounts are on the roster. This is why cl32-smoke-test's Match 1
 * auto-advanced straight through setup->lobby->playing — not because that
 * specific match happened to lack real accounts (as TODO.md speculated),
 * but because NO match, ever, via any real creation path, can populate
 * mustReady.
 *
 * This script proves that with three parts, run against e2e-disposable-1's
 * real Team Alpha (has two real linked accounts: "TD (E2E)" and
 * "E2ePlayer14" — see e2e-inspect-tournament.js):
 *
 *   PART 1 — root-cause proof, 100% real match shape, no workarounds.
 *   Seed a queue entry using the EXACT shape addMatchToQueue() produces,
 *   tagged to slot 1, with real-linked-account E2ePlayer14 on one side.
 *   Advance setup->lobby via the actual PhaseManager.advanceSlot(). Assert
 *   getSlotRequirements(1) reports "No players need to ready up" (mustReady
 *   empty) DESPITE the real linked account being in that very match, and
 *   that the slot silently auto-advances all the way to 'playing' within
 *   ~2s with zero player interaction — reproducing the exact cl32-smoke-test
 *   symptom on demand.
 *
 *   PART 2 — confirm-button mechanics verified in isolation. To check
 *   whether there's a SECOND bug stacked on top of the first (i.e. would the
 *   buttons/Firestore-writes/auto-advance-gate work correctly if mustReady
 *   were populated?), seed a queue entry that additionally carries the
 *   `.sides` shape the current (buggy) code expects — clearly a synthetic
 *   workaround for the confirmed bug above, NOT how any real match looks.
 *   Log in as the real player (E2ePlayer14) in an isolated browser context,
 *   open team.html, confirm the ready-check overlay is visible with the
 *   right match card, click both the Discord and Game Lobby buttons, assert
 *   the UI updates (buttons disabled + checkmarked) and Firestore's
 *   `lobbyReady.{uid}` is correctly written. Then have that player confirm
 *   on behalf of their teammate too (the "confirm for teammate" buttons),
 *   completing mustReady, and confirm the slot THEN legitimately
 *   auto-advances to 'playing' — proving the auto-advance gate and the
 *   button/Firestore plumbing are correct; only the mustReady population
 *   source (Part 1) is broken.
 *
 *   PART 3 — the "retroactive confirm in playing" gap (also flagged in
 *   TODO.md as unverified). With the slot now in 'playing', wipe
 *   `lobbyReady` (simulating a player who never confirmed before the slot
 *   went live) and reload team.html for that player. Assert BOTH surfaces
 *   that could offer a confirm control while playing stay non-interactive:
 *   the lobby overlay (`#lobbyReadyOverlay`) never becomes visible, and the
 *   Teammates sidebar falls back to read-only status dots instead of
 *   clickable ready buttons. Confirms the gap is real and still present.
 *
 * Snapshots/restores gameQueue, currentPhase, lobbyReady in a `finally`
 * block so no synthetic data is left behind in e2e-disposable-1.
 *
 * Run: cd BoardGame && node dev/tests/e2e-ready-check.js
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
  const findings = [];

  try {
    const tdPage = await browser.newPage();
    await login(tdPage, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(tdPage, baseUrl, 'full/god.html', tournamentId);

    await tdPage.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    // Confirm the real linked players we expect are present (Team Alpha:
    // "TD (E2E)" and "E2ePlayer14"). Fail fast with a clear message instead
    // of a confusing downstream assertion if the fixture data drifted.
    const roster = await tdPage.evaluate(() => {
      const teamAlpha = window.godApp.gameState.teams.find(t => String(t.id) === '1');
      return {
        teamAlpha: teamAlpha ? teamAlpha.players.map(p => ({ id: p.id, uid: p.uid, name: p.name })) : null
      };
    });
    const tdE2E = roster.teamAlpha?.find(p => p.name === 'TD (E2E)' && p.uid);
    const player14 = roster.teamAlpha?.find(p => p.name === 'E2ePlayer14' && p.uid);
    assert(tdE2E, `Expected Team Alpha to have a real-linked "TD (E2E)" player, got: ${JSON.stringify(roster.teamAlpha)}`);
    assert(player14, `Expected Team Alpha to have a real-linked "E2ePlayer14" player, got: ${JSON.stringify(roster.teamAlpha)}`);
    assert(process.env.PLAYER14_EMAIL && process.env.PLAYER14_PASSWORD,
      'PLAYER14_EMAIL/PLAYER14_PASSWORD must be set in .env.e2e to log in as E2ePlayer14');

    // Snapshot original state so we can restore it afterward, regardless of
    // pass/fail.
    const original = await tdPage.evaluate(() => ({
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
      lobbyReady: JSON.parse(JSON.stringify(window.godApp.gameState.lobbyReady || {}))
    }));

    try {
      // ============================================================
      // PART 1 — root-cause proof (real match shape, no workarounds)
      // ============================================================
      const part1 = await tdPage.evaluate(async (playerIds) => {
        const gs = window.godApp.gameState;
        const now = new Date().toISOString();
        const phaseStartedAt = new Date(Date.now() - 60 * 1000).toISOString();

        gs.currentPhase = {
          name: 'matches_in_progress',
          roundNumber: 999101,
          startedAt: phaseStartedAt,
          slots: { 1: 'setup', 2: 'done' }
        };

        // EXACT shape match-creation-manager.js's addMatchToQueue() produces
        // — no `.sides` field at all, just `.teams: [{id, playerIds}]`.
        const realMatch = {
          id: Date.now(),
          matchNumber: 999101,
          game: 'e2e-test-game',
          playType: '1v1',
          teams: [
            { id: 'TEAM_A', playerIds: [playerIds.player14Id] }, // real linked E2ePlayer14
            { id: 'TEAM_B', playerIds: [playerIds.placeholderId] } // unlinked placeholder
          ],
          status: 'pending',
          createdAt: now,
          roundNumber: 999101,
          slot: 1
        };

        gs.gameQueue = [realMatch];
        gs.lobbyReady = {};
        await window.godApp.saveGameState();

        const setupReqs = window.godApp.phase.getSlotRequirements(1);
        const advanced = await window.godApp.phase.advanceSlot(1); // setup -> lobby
        const subRightAfter = window.godApp.phase.getSlotSubPhase(1);
        const lobbyReqsRightAfter = window.godApp.phase.getSlotRequirements(1);
        const mustReadyDirect = window.godApp.phase._getPlayersWhoMustReadyForSlot(1);

        return { setupReqs, advanced, subRightAfter, lobbyReqsRightAfter, mustReadyDirect };
      }, { player14Id: player14.id, placeholderId: 'p_krttm023' });

      console.log('--- PART 1: setup requirements ---', JSON.stringify(part1.setupReqs));
      console.log('--- PART 1: advanceSlot(1) setup->lobby result ---', part1.advanced, '| sub right after:', part1.subRightAfter);
      console.log('--- PART 1: lobby requirements right after advancing ---', JSON.stringify(part1.lobbyReqsRightAfter));
      console.log('--- PART 1: mustReady (direct) ---', JSON.stringify(part1.mustReadyDirect));

      assert(part1.advanced === true, 'PART 1: advanceSlot(1) setup->lobby should succeed');
      assert(part1.subRightAfter === 'lobby', 'PART 1: slot 1 should be in lobby sub-phase right after advancing');
      assert(Array.isArray(part1.mustReadyDirect) && part1.mustReadyDirect.length === 0,
        `PART 1 BUG CONFIRMED CHECK: expected mustReady to be (incorrectly) empty despite a real linked player in this match, got: ${JSON.stringify(part1.mustReadyDirect)}`);
      assert(part1.lobbyReqsRightAfter.length === 1 && part1.lobbyReqsRightAfter[0].met === true &&
        /No players need to ready up/.test(part1.lobbyReqsRightAfter[0].label),
        `PART 1: expected getSlotRequirements to report "No players need to ready up", got: ${JSON.stringify(part1.lobbyReqsRightAfter)}`);

      // Wait past the 100ms auto-advance timer and confirm the slot slipped
      // straight through to 'playing' with zero player interaction.
      await new Promise(r => setTimeout(r, 1000));
      const subAfterWait = await tdPage.evaluate(() => window.godApp.phase.getSlotSubPhase(1));
      console.log('--- PART 1: slot 1 sub-phase ~1s later (no player interaction) ---', subAfterWait);
      assert(subAfterWait === 'playing',
        `PART 1 BUG CONFIRMED: expected slot to have auto-advanced to 'playing' with zero player interaction (mustReady bug), got sub-phase '${subAfterWait}'`);

      findings.push('PART 1 CONFIRMED: mustReady is unconditionally empty for real match data ' +
        '(match.sides[].players[].teamId is read, but real matches only ever have match.teams[].playerIds) ' +
        '— slot auto-advanced setup->lobby->playing in under 1.1s with a real linked player present and zero confirmation clicks.');

      // ============================================================
      // PART 2 — confirm-button mechanics verified in isolation
      // ============================================================
      const part2Setup = await tdPage.evaluate(async (playerIds) => {
        const gs = window.godApp.gameState;
        const now = new Date().toISOString();
        const phaseStartedAt = new Date(Date.now() - 60 * 1000).toISOString();

        gs.currentPhase = {
          name: 'matches_in_progress',
          roundNumber: 999102,
          startedAt: phaseStartedAt,
          slots: { 1: 'setup', 2: 'done' }
        };

        const matchWithSidesWorkaround = {
          id: Date.now() + 1,
          matchNumber: 999102,
          game: 'e2e-test-game',
          playType: '1v1',
          teams: [
            { id: 'TEAM_A', playerIds: [playerIds.player14Id] },
            { id: 'TEAM_B', playerIds: [playerIds.placeholderId] }
          ],
          // SYNTHETIC WORKAROUND for the confirmed PART 1 bug: real matches
          // never carry a `.sides` field. Adding it here ONLY so mustReady
          // becomes non-empty, to test the confirm-button/Firestore-write
          // mechanics independently of the population bug.
          sides: [
            { players: [{ teamId: 1 }] },
            { players: [{ teamId: 2 }] }
          ],
          status: 'pending',
          createdAt: now,
          roundNumber: 999102,
          slot: 1
        };

        gs.gameQueue = [matchWithSidesWorkaround];
        gs.lobbyReady = {};
        await window.godApp.saveGameState();

        const mustReady = window.godApp.phase._getPlayersWhoMustReadyForSlot(1);
        const advanced = await window.godApp.phase.advanceSlot(1); // setup -> lobby
        const subRightAfter = window.godApp.phase.getSlotSubPhase(1);

        return { mustReady, advanced, subRightAfter };
      }, { player14Id: player14.id, placeholderId: 'p_krttm023' });

      console.log('--- PART 2: mustReady (with workaround) ---', JSON.stringify(part2Setup.mustReady));
      assert(part2Setup.advanced === true, 'PART 2: advanceSlot(1) setup->lobby should succeed');
      assert(part2Setup.mustReady.includes(tdE2E.uid) && part2Setup.mustReady.includes(player14.uid),
        `PART 2: expected mustReady to include both real Team Alpha uids, got: ${JSON.stringify(part2Setup.mustReady)}`);

      // Confirm it does NOT auto-advance now that mustReady is genuinely non-empty and unconfirmed.
      await new Promise(r => setTimeout(r, 1000));
      const subStillLobby = await tdPage.evaluate(() => window.godApp.phase.getSlotSubPhase(1));
      assert(subStillLobby === 'lobby', `PART 2: slot should remain in 'lobby' while mustReady is unconfirmed, got '${subStillLobby}'`);

      // --- Real player logs in and interacts with the actual UI ---
      const playerContext = await browser.createBrowserContext();
      const playerPage = await playerContext.newPage();
      await login(playerPage, baseUrl, process.env.PLAYER14_EMAIL, process.env.PLAYER14_PASSWORD);
      await gotoTournamentPage(playerPage, baseUrl, 'full/team.html', tournamentId, '&teamId=1');

      await playerPage.waitForFunction(
        () => typeof teamData !== 'undefined' && teamData && Array.isArray(teamData.players),
        { timeout: 40000 }
      );

      // Confirm the ready-check overlay is visible.
      await playerPage.waitForFunction(
        () => document.getElementById('lobbyReadyOverlay')?.style.display === 'flex',
        { timeout: 15000 }
      );
      const overlayVisible = await playerPage.evaluate(() => document.getElementById('lobbyReadyOverlay').style.display);
      console.log('--- PART 2: team.html lobbyReadyOverlay display ---', overlayVisible);
      assert(overlayVisible === 'flex', 'PART 2: lobby ready overlay should be visible for the player in this slot\'s lobby sub-phase');

      // RELATED BUG FOUND (separate from Part 1's mustReady bug, same root
      // cause family): renderMatchCardsWithDiscord()'s "does this match
      // involve my team" filter checks `side.players[].uid/.name/.email`,
      // but real queue entries only ever have `side.playerIds` (plain id
      // strings) — no `.players` objects at all (confirmed in
      // match-creation-manager.js). So the match-info card inside the lobby
      // overlay (game name, opponent, Discord channel, lobby creator) NEVER
      // renders for any real match; it always falls back to the empty
      // state. _matchInvolvesUs() (used for phase/slot detection elsewhere
      // in this same file) already has the correct `side.players ||
      // side.playerIds` fallback — renderMatchCardsWithDiscord() just never
      // got it. Documenting as-is rather than fixing (broader than a
      // one-line change; affects renderMatchCardsInto() too). This does NOT
      // block the ready-check buttons themselves — those are static markup
      // keyed off currentUser.uid, not the match card.
      const cardHtml = await playerPage.evaluate(() => document.getElementById('matchAssignmentCardsLobby')?.innerHTML || '');
      console.log('--- PART 2: matchAssignmentCardsLobby innerHTML ---', cardHtml.slice(0, 200));
      const cardShowsEmptyState = /No matches assigned/.test(cardHtml);

      // Click own Discord + Game Lobby confirm buttons.
      await playerPage.waitForSelector('#readyDiscordBtn:not([disabled])', { timeout: 10000 });
      await playerPage.click('#readyDiscordBtn');
      await playerPage.waitForFunction(() => document.getElementById('readyDiscordBtn')?.disabled === true, { timeout: 10000 });

      await playerPage.waitForSelector('#readyGameLobbyBtn:not([disabled])', { timeout: 10000 });
      await playerPage.click('#readyGameLobbyBtn');
      await playerPage.waitForFunction(() => document.getElementById('readyGameLobbyBtn')?.disabled === true, { timeout: 10000 });

      const uiAfterOwnConfirm = await playerPage.evaluate(() => ({
        discordText: document.getElementById('readyDiscordBtn')?.textContent.trim(),
        lobbyText: document.getElementById('readyGameLobbyBtn')?.textContent.trim()
      }));
      console.log('--- PART 2: button UI after own confirm ---', JSON.stringify(uiAfterOwnConfirm));
      assert(/✓/.test(uiAfterOwnConfirm.discordText), 'PART 2: Discord button should show a checkmark after confirming');
      assert(/✓/.test(uiAfterOwnConfirm.lobbyText), 'PART 2: Game Lobby button should show a checkmark after confirming');

      // Verify Firestore actually got the write (read back via TD's live godApp.gameState).
      await tdPage.waitForFunction(
        (uid) => window.godApp.gameState.lobbyReady?.[uid]?.discord === true && window.godApp.gameState.lobbyReady?.[uid]?.gameLobby === true,
        { timeout: 15000 },
        player14.uid
      );
      const firestoreLobbyReadyForPlayer = await tdPage.evaluate((uid) => window.godApp.gameState.lobbyReady[uid], player14.uid);
      console.log('--- PART 2: Firestore lobbyReady for E2ePlayer14 ---', JSON.stringify(firestoreLobbyReadyForPlayer));
      assert(firestoreLobbyReadyForPlayer.discord === true && firestoreLobbyReadyForPlayer.gameLobby === true,
        'PART 2: Firestore lobbyReady should show this player as discord+gameLobby ready');

      // Now confirm on behalf of the teammate ("TD (E2E)") using the
      // teammate-confirm buttons, completing mustReady entirely.
      await playerPage.waitForSelector('#teammateConfirmList .teammate-ready-btn', { timeout: 10000 });
      const teammateBtnCount = await playerPage.evaluate(() => document.querySelectorAll('#teammateConfirmList .teammate-ready-btn').length);
      assert(teammateBtnCount === 2, `PART 2: expected 2 teammate-confirm buttons (Discord + Lobby) for "TD (E2E)", got ${teammateBtnCount}`);
      // Click both teammate buttons (discord first, then lobby) as rendered.
      // Re-query fresh each time: clicking triggers a Firestore write, which
      // round-trips through onSnapshot and re-renders #teammateConfirmList's
      // innerHTML, detaching any previously-queried element handle.
      for (let i = 0; i < 2; i++) {
        await playerPage.waitForSelector('#teammateConfirmList .teammate-ready-btn:not([disabled])', { timeout: 10000 });
        const btn = await playerPage.$('#teammateConfirmList .teammate-ready-btn:not([disabled])');
        await btn.click();
        await new Promise(r => setTimeout(r, 500));
      }

      await tdPage.waitForFunction(
        (uid) => window.godApp.gameState.lobbyReady?.[uid]?.discord === true && window.godApp.gameState.lobbyReady?.[uid]?.gameLobby === true,
        { timeout: 15000 },
        tdE2E.uid
      );
      const firestoreLobbyReadyForTeammate = await tdPage.evaluate((uid) => window.godApp.gameState.lobbyReady[uid], tdE2E.uid);
      console.log('--- PART 2: Firestore lobbyReady for TD (E2E), confirmed-by-teammate ---', JSON.stringify(firestoreLobbyReadyForTeammate));
      assert(firestoreLobbyReadyForTeammate.discord === true && firestoreLobbyReadyForTeammate.gameLobby === true,
        'PART 2: Firestore lobbyReady should show the teammate as discord+gameLobby ready (confirmed on their behalf)');
      assert(firestoreLobbyReadyForTeammate.discordBy === player14.uid || firestoreLobbyReadyForTeammate.gameLobbyBy === player14.uid,
        `PART 2: expected teammate's ready record to note it was confirmed by E2ePlayer14, got: ${JSON.stringify(firestoreLobbyReadyForTeammate)}`);

      // With mustReady now genuinely fully met, the slot should legitimately
      // auto-advance to 'playing' (proving the auto-advance MECHANISM is
      // correct — only the mustReady population source in Part 1 is broken).
      await tdPage.waitForFunction(() => window.godApp.phase.getSlotSubPhase(1) === 'playing', { timeout: 10000 });
      console.log('--- PART 2: slot 1 legitimately auto-advanced to playing once mustReady was fully confirmed ---');

      findings.push('PART 2 CONFIRMED: the confirm-button UI, Firestore writes (lobbyReady.{uid}.discord/gameLobby), ' +
        'the "confirm for teammate" flow, and the auto-advance gate all work correctly once mustReady is populated — ' +
        'the ONLY defect is the population source demonstrated in Part 1.');
      if (cardShowsEmptyState) {
        findings.push('PART 2 RELATED BUG (new, minor): the lobby overlay\'s own match-info card ' +
          '(renderMatchCardsWithDiscord in team-controls.js — game name, opponent, Discord channel, lobby creator) ' +
          'never renders for a real match; it always falls back to "No matches assigned this round." This is the same ' +
          'field-shape bug family as Part 1 (checks side.players[].uid/.name/.email, but real queue entries only ever ' +
          'have side.playerIds — plain id strings, no .players objects). _matchInvolvesUs() elsewhere in the same file ' +
          'already has the correct `side.players || side.playerIds` fallback; renderMatchCardsWithDiscord() (and ' +
          'renderMatchCardsInto(), used for the pre-lobby "Your Match Assignments" overlay) never got it. Does not ' +
          'block the ready-check buttons themselves (they key off currentUser.uid, not the match card) — reporting, not fixing.');
      }

      // ============================================================
      // PART 3 — retroactive-confirm-in-playing gap
      // ============================================================
      // Slot 1 is now 'playing' (from Part 2). Wipe lobbyReady to simulate a
      // player who never confirmed before the match went live, then reload
      // team.html and check whether anything lets them confirm retroactively.
      await tdPage.evaluate(async () => {
        window.godApp.gameState.lobbyReady = {};
        await window.godApp.saveGameState();
      });

      await playerPage.reload({ waitUntil: 'domcontentloaded' });
      await playerPage.waitForFunction(
        () => typeof teamData !== 'undefined' && teamData && Array.isArray(teamData.players),
        { timeout: 40000 }
      );
      // Give the onSnapshot listener a moment to render post-reload.
      await new Promise(r => setTimeout(r, 1000));

      const part3 = await playerPage.evaluate(() => {
        const overlay = document.getElementById('lobbyReadyOverlay');
        const teammatesHtml = document.getElementById('teammatesList')?.innerHTML || '';
        return {
          overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
          hasClickableReadyButtons: /onclick="[^"]*setReadyStatus/.test(teammatesHtml),
          hasReadOnlyIndicatorsOnly: /teammate-ready-indicators/.test(teammatesHtml)
        };
      });
      console.log('--- PART 3: team.html state while slot 1 is playing and lobbyReady is empty ---', JSON.stringify(part3));

      assert(part3.overlayDisplay === 'none', `PART 3: lobby ready overlay should NOT be visible while the slot is in 'playing', got display='${part3.overlayDisplay}'`);
      assert(part3.hasClickableReadyButtons === false, 'PART 3: Teammates sidebar should NOT render clickable setReadyStatus buttons while the slot is in \'playing\'');
      assert(part3.hasReadOnlyIndicatorsOnly === true, 'PART 3: Teammates sidebar should fall back to read-only status dots while the slot is in \'playing\'');

      findings.push('PART 3 CONFIRMED (gap is real, still present): once a slot reaches \'playing\', there is genuinely ' +
        'no UI path to retroactively confirm Discord/Game Lobby readiness — team-controls.js gates both the lobby overlay ' +
        '(renderPhaseOverlays, sub === \'lobby\' only) and the Teammates sidebar\'s clickable buttons (renderTeammates, ' +
        'canClick = isLobbyPhase) strictly on the slot\'s sub-phase being \'lobby\'.');

      await playerContext.close();

      console.log('\nAll assertions passed.\n');
      console.log('=== FINDINGS ===');
      findings.forEach(f => console.log('- ' + f));
      allPassed = true;
    } finally {
      // Restore original state regardless of pass/fail.
      await tdPage.evaluate((orig) => {
        window.godApp.gameState.gameQueue = orig.gameQueue;
        window.godApp.gameState.currentPhase = orig.currentPhase;
        window.godApp.gameState.lobbyReady = orig.lobbyReady;
        return window.godApp.saveGameState();
      }, original);
      console.log('Restored original gameQueue/currentPhase/lobbyReady.');
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
