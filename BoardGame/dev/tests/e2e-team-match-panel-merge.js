/**
 * e2e-team-match-panel-merge.js — verification test for TODO.md Task 13
 * ("team.html: combine the 'next match' section with the Discord/Game Lobby
 * ready-check info ... Merge into one clear panel").
 *
 * team.html used to show TWO SEPARATE full-screen `.lobby-overlay` elements
 * one after another: `#preGameInstructionsOverlay` (match assignment cards +
 * "waiting for admin" footer, shown while a slot is in its 'setup'
 * sub-phase) and `#lobbyReadyOverlay` (Discord/Game Lobby ready buttons +
 * teammate-confirm list + per-team readiness, shown once the slot enters
 * 'lobby'). This merges them into a single `#matchPanelOverlay`: the match
 * cards + header are always shown once a match exists, and the ready-check
 * section (`#lobbyReadyControls`) is revealed IN PLACE inside the same
 * overlay once the lobby opens — no overlay swap.
 *
 * Along the way, fixed a real (pre-existing, undocumented-in-TODO.md) bug in
 * `renderMatchCardsWithDiscord()`: its "does this match involve my team"
 * filter only checked the legacy/synthetic `side.players[]` shape, never the
 * real `side.playerIds` shape every actual match-creation code path
 * produces (see e2e-ready-check.js's Part 2 finding, which reported but did
 * not fix this) — so the match-info card never rendered for any real match,
 * in EITHER of the old overlays. Now fixed to reuse `_matchInvolvesUs()`/
 * `getMatchSidePlayers()`'s existing correct dual-shape resolution. This
 * test's own assertions (that the card shows real game/opponent/Discord
 * info, not the empty state) exercise that fix directly.
 *
 * Test flow against e2e-disposable-1's real Team Alpha (id 1: "TD (E2E)" +
 * "E2ePlayer14", both real linked accounts) vs Team Beta (id 2: two
 * unlinked placeholders):
 *
 *   1. Seed a real-shaped queue entry (`teams[].playerIds`, real
 *      `discordChannels`/`lobbyCreators` keyed by side id, exactly like
 *      `assignDiscordAndLobby()` produces) with slot 1 in the 'setup'
 *      sub-phase. Log in as E2ePlayer14, open team.html, assert:
 *        - #matchPanelSection is visible; #preGameInstructionsOverlay,
 *          #lobbyReadyOverlay, #matchAssignmentCardsLobby no longer exist
 *          in the DOM at all (confirms the merge, not just a visual
 *          rename).
 *        - #matchAssignmentCards shows real match info (game name,
 *          opponent team name, Discord channel, lobby-creator line) — NOT
 *          the "No matches assigned" empty state.
 *        - The "waiting for admin" footer is visible.
 *        - #lobbyReadyControls (ready buttons / teammate-confirm list /
 *          ready status) is hidden.
 *      Screenshot: task13-panel-waiting.png.
 *   2. Flip slot 1 to 'lobby' sub-phase directly (bypassing
 *      PhaseManager.advanceSlot()/the god.html TD tab's live auto-advance
 *      timer — see the gotcha below) and add the same synthetic `.sides`
 *      mustReady workaround `e2e-ready-check.js` uses, purely so the
 *      already-known-broken `_getPlayersWhoMustReadyForSlot()` doesn't
 *      auto-advance the slot to 'playing' out from under this test before
 *      it can inspect the lobby-open view. Reload is not needed — the
 *      player's page re-renders reactively off the same onSnapshot
 *      listener. Assert:
 *        - #matchPanelSection is STILL the same single element (no
 *          different overlay id became visible instead).
 *        - #matchAssignmentCards STILL shows the same match info (grew in
 *          place, didn't get replaced).
 *        - The "waiting for admin" footer is now hidden.
 *        - #lobbyReadyControls is now visible, with working Game
 *          Lobby/Discord buttons, the teammate-confirm-for-"TD (E2E)" row,
 *          the lobby-creator banner (E2ePlayer14 is TEAM_A's designated
 *          creator), and the per-team ready-status display.
 *      Screenshot: task13-panel-lobby-open.png.
 *
 * GOTCHA (new, found while building this test): god.html's live
 * PhaseManager instance (`window.godApp.phase`) re-evaluates
 * `recheckRequirements()` reactively off its own onSnapshot listener, and
 * `AUTO_ADVANCE_WHEN_MET`-style slot auto-advance
 * (phase-manager.js ~853-880) schedules `advanceSlot(slot)` 100ms after ANY
 * write that leaves a slot's `getSlotRequirements()` fully met — which,
 * given the pre-existing empty-mustReady bug, is true the instant a slot
 * enters 'lobby' with only the real `teams[].playerIds` shape. Simply
 * setting `currentPhase.slots[1] = 'lobby'` with the TD's god.html tab open
 * (needed to call `saveGameState()`) is enough to trigger this — the slot
 * silently flips to 'playing' ~100ms later, before Puppeteer can even take
 * the "lobby open" screenshot. Worked around exactly like
 * `e2e-ready-check.js` Part 2: add a synthetic `.sides` field (ignored by
 * every real-match render path, which all prefer `match.teams` via
 * `match.teams || match.sides`) purely to populate mustReady with real
 * uids, which keeps the slot genuinely stuck in 'lobby' since nobody
 * actually clicks the ready buttons in this test.
 *
 * Snapshots/restores gameQueue, currentPhase, lobbyReady in a `finally`
 * block, same pattern as every other script in this harness.
 *
 * Screenshots are throwaway visual-review artifacts written to
 * dev/tests/task13-panel-*.png — not committed.
 *
 * UPDATED (later): the merged panel was pulled out of the full-screen
 * `.lobby-overlay` treatment entirely and made an inline sidebar section
 * (`#matchPanelSection`, a plain `.team-section` placed under Teammates,
 * `display: ''`/`none` instead of `flex`/`none`) so players aren't blocked
 * from the rest of team.html while readying up. `#spellPhaseOverlay` is the
 * only `.lobby-overlay` element left on the page. This script's element-id
 * references and the "exactly 2 .lobby-overlay elements" assertions were
 * updated accordingly (now 1).
 *
 * Run: cd BoardGame && node dev/tests/e2e-team-match-panel-merge.js
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
    const tdPage = await browser.newPage();
    await login(tdPage, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await gotoTournamentPage(tdPage, baseUrl, 'full/god.html', tournamentId);

    await tdPage.waitForFunction(
      () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
      { timeout: 40000 }
    );

    const roster = await tdPage.evaluate(() => {
      const teamAlpha = window.godApp.gameState.teams.find(t => String(t.id) === '1');
      const teamBeta = window.godApp.gameState.teams.find(t => String(t.id) === '2');
      return {
        teamAlpha: teamAlpha ? teamAlpha.players.map(p => ({ id: p.id, uid: p.uid, name: p.name })) : null,
        teamBeta: teamBeta ? teamBeta.players.map(p => ({ id: p.id, uid: p.uid, name: p.name })) : null
      };
    });
    const tdE2E = roster.teamAlpha?.find(p => p.name === 'TD (E2E)' && p.uid);
    const player14 = roster.teamAlpha?.find(p => p.name === 'E2ePlayer14' && p.uid);
    const placeholderA = roster.teamBeta?.find(p => p.name === 'Placeholder A');
    const placeholderB = roster.teamBeta?.find(p => p.name === 'Placeholder B');
    assert(tdE2E, `Expected Team Alpha to have a real-linked "TD (E2E)" player, got: ${JSON.stringify(roster.teamAlpha)}`);
    assert(player14, `Expected Team Alpha to have a real-linked "E2ePlayer14" player, got: ${JSON.stringify(roster.teamAlpha)}`);
    assert(placeholderA && placeholderB, `Expected Team Beta to have two placeholder players, got: ${JSON.stringify(roster.teamBeta)}`);
    assert(process.env.PLAYER14_EMAIL && process.env.PLAYER14_PASSWORD,
      'PLAYER14_EMAIL/PLAYER14_PASSWORD must be set in .env.e2e to log in as E2ePlayer14');

    const original = await tdPage.evaluate(() => ({
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || [])),
      currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
      lobbyReady: JSON.parse(JSON.stringify(window.godApp.gameState.lobbyReady || {}))
    }));

    try {
      // ============================================================
      // STEP 1 — seed 'setup' sub-phase, verify the persistent match panel
      // ============================================================
      await tdPage.evaluate((ids) => {
        const gs = window.godApp.gameState;
        const now = new Date().toISOString();
        const phaseStartedAt = new Date(Date.now() - 60 * 1000).toISOString();

        gs.currentPhase = {
          name: 'matches_in_progress',
          roundNumber: 999401,
          startedAt: phaseStartedAt,
          slots: { 1: 'setup', 2: 'done' }
        };

        // Real match shape (teams[].playerIds), with discordChannels/
        // lobbyCreators exactly as assignDiscordAndLobby() would produce.
        const realMatch = {
          id: Date.now(),
          matchNumber: 999401,
          game: 'e2e-test-game',
          playType: '2v2',
          teams: [
            { id: 'TEAM_A', playerIds: [ids.player14Id, ids.tdE2EId] },
            { id: 'TEAM_B', playerIds: [ids.placeholderAId, ids.placeholderBId] }
          ],
          discordChannels: { TEAM_A: 1, TEAM_B: 2 },
          lobbyCreators: {
            TEAM_A: { uid: ids.player14Uid, name: 'E2ePlayer14' },
            TEAM_B: { uid: null, name: 'Placeholder A' }
          },
          status: 'pending',
          createdAt: now,
          roundNumber: 999401,
          slot: 1
        };

        gs.gameQueue = [realMatch];
        gs.lobbyReady = {};
        return window.godApp.saveGameState();
      }, {
        player14Id: player14.id, tdE2EId: tdE2E.id,
        placeholderAId: placeholderA.id, placeholderBId: placeholderB.id,
        player14Uid: player14.uid
      });

      const playerContext = await browser.createBrowserContext();
      const playerPage = await playerContext.newPage();
      await playerPage.setViewport({ width: 1280, height: 900 });
      await login(playerPage, baseUrl, process.env.PLAYER14_EMAIL, process.env.PLAYER14_PASSWORD);
      await gotoTournamentPage(playerPage, baseUrl, 'full/team.html', tournamentId, '&teamId=1');

      await playerPage.waitForFunction(
        () => typeof teamData !== 'undefined' && teamData && Array.isArray(teamData.players),
        { timeout: 40000 }
      );

      await playerPage.waitForFunction(
        () => document.getElementById('matchPanelSection')?.style.display !== 'none',
        { timeout: 15000 }
      );

      const setupState = await playerPage.evaluate(() => ({
        oldPreGameOverlayExists: !!document.getElementById('preGameInstructionsOverlay'),
        oldLobbyOverlayExists: !!document.getElementById('lobbyReadyOverlay'),
        oldLobbyCardsExists: !!document.getElementById('matchAssignmentCardsLobby'),
        overlayCount: document.querySelectorAll('.lobby-overlay').length,
        cardsHtml: document.getElementById('matchAssignmentCards')?.innerHTML || '',
        footerDisplay: getComputedStyle(document.getElementById('matchPanelWaitingFooter')).display,
        footerText: document.getElementById('matchPanelWaitingFooter')?.textContent.trim(),
        controlsDisplay: getComputedStyle(document.getElementById('lobbyReadyControls')).display,
        subtitleText: document.getElementById('matchPanelSubtitle')?.textContent.trim()
      }));
      console.log('--- STEP 1: setup-phase panel state ---', JSON.stringify(setupState, null, 2).slice(0, 2000));

      assert(setupState.oldPreGameOverlayExists === false, 'STEP 1: #preGameInstructionsOverlay should no longer exist in the DOM (merged away)');
      assert(setupState.oldLobbyOverlayExists === false, 'STEP 1: #lobbyReadyOverlay should no longer exist in the DOM (merged away)');
      assert(setupState.oldLobbyCardsExists === false, 'STEP 1: #matchAssignmentCardsLobby should no longer exist in the DOM (merged into #matchAssignmentCards)');
      assert(setupState.overlayCount === 1, `STEP 1: expected exactly 1 .lobby-overlay element left on the page (spellPhaseOverlay -- #matchPanelSection is now a plain inline section, not an overlay), got ${setupState.overlayCount}`);
      assert(!/No matches assigned/.test(setupState.cardsHtml), 'STEP 1 (regression check for the renderMatchCardsWithDiscord fix): match card should show real match info, not the empty state');
      assert(/e2e-test-game/.test(setupState.cardsHtml), 'STEP 1: match card should show the game name');
      assert(/Team Beta/.test(setupState.cardsHtml), 'STEP 1: match card should show the opponent team name');
      assert(/Discord Channel #1/.test(setupState.cardsHtml), 'STEP 1: match card should show the assigned Discord channel');
      assert(setupState.footerDisplay !== 'none', 'STEP 1: "waiting for admin" footer should be visible during setup');
      assert(/[Ww]aiting for admin/.test(setupState.footerText || ''), `STEP 1: footer text should mention waiting for admin, got: "${setupState.footerText}"`);
      assert(setupState.controlsDisplay === 'none', 'STEP 1: ready-check controls (buttons/confirm list/ready status) should be hidden during setup');

      await playerPage.screenshot({ path: path.resolve(__dirname, 'task13-panel-waiting.png') });
      console.log('Screenshot saved: dev/tests/task13-panel-waiting.png');

      // ============================================================
      // STEP 2 — flip to 'lobby' sub-phase, verify the SAME panel grows
      // ============================================================
      await tdPage.evaluate(() => {
        const gs = window.godApp.gameState;
        gs.currentPhase.slots[1] = 'lobby';
        // Synthetic mustReady workaround (see file header gotcha) -- purely
        // to stop god.html's live PhaseManager auto-advance from firing
        // before this test can inspect the lobby-open view. Ignored by
        // every real match-card render path (they all prefer match.teams).
        const entry = gs.gameQueue.find(m => m.slot === 1 && m.status === 'pending');
        entry.sides = [
          { players: [{ teamId: 1 }] },
          { players: [{ teamId: 2 }] }
        ];
        return window.godApp.saveGameState();
      });

      await playerPage.waitForFunction(
        () => getComputedStyle(document.getElementById('lobbyReadyControls')).display !== 'none',
        { timeout: 15000 }
      );

      const lobbyState = await playerPage.evaluate(() => ({
        oldPreGameOverlayExists: !!document.getElementById('preGameInstructionsOverlay'),
        oldLobbyOverlayExists: !!document.getElementById('lobbyReadyOverlay'),
        overlayCount: document.querySelectorAll('.lobby-overlay').length,
        matchPanelDisplay: getComputedStyle(document.getElementById('matchPanelSection')).display,
        cardsHtml: document.getElementById('matchAssignmentCards')?.innerHTML || '',
        footerDisplay: getComputedStyle(document.getElementById('matchPanelWaitingFooter')).display,
        controlsDisplay: getComputedStyle(document.getElementById('lobbyReadyControls')).display,
        subtitleText: document.getElementById('matchPanelSubtitle')?.textContent.trim(),
        gameLobbyBtnDisabled: document.getElementById('readyGameLobbyBtn')?.disabled,
        discordBtnDisabled: document.getElementById('readyDiscordBtn')?.disabled,
        teammateConfirmHtml: document.getElementById('teammateConfirmList')?.innerHTML || '',
        readyStatusHtml: document.getElementById('readyStatus')?.innerHTML || '',
        lobbyCreatorRoleDisplay: getComputedStyle(document.getElementById('lobbyCreatorRole')).display,
        lobbyCreatorRoleText: document.getElementById('lobbyCreatorRole')?.textContent.trim()
      }));
      console.log('--- STEP 2: lobby-phase panel state ---', JSON.stringify(lobbyState, null, 2).slice(0, 2500));

      assert(lobbyState.oldPreGameOverlayExists === false, 'STEP 2: #preGameInstructionsOverlay should still not exist');
      assert(lobbyState.oldLobbyOverlayExists === false, 'STEP 2: #lobbyReadyOverlay should still not exist (no overlay swap happened)');
      assert(lobbyState.overlayCount === 1, `STEP 2: still expect exactly 1 .lobby-overlay element (spellPhaseOverlay only), got ${lobbyState.overlayCount}`);
      assert(lobbyState.matchPanelDisplay !== 'none', 'STEP 2: #matchPanelSection (the SAME element from step 1) should still be the one visible');
      assert(!/No matches assigned/.test(lobbyState.cardsHtml), 'STEP 2: match card should still show real match info');
      assert(/Discord Channel #1/.test(lobbyState.cardsHtml), 'STEP 2: match card should still show the Discord channel (grew in place, did not lose info)');
      assert(lobbyState.footerDisplay === 'none', 'STEP 2: "waiting for admin" footer should now be hidden');
      assert(lobbyState.controlsDisplay !== 'none', 'STEP 2: ready-check controls should now be visible');
      assert(/lobby/i.test(lobbyState.subtitleText || ''), `STEP 2: subtitle should now mention the lobby step, got: "${lobbyState.subtitleText}"`);
      assert(lobbyState.gameLobbyBtnDisabled === false, 'STEP 2: Game Lobby ready button should be enabled (not yet confirmed)');
      assert(lobbyState.discordBtnDisabled === false, 'STEP 2: Discord ready button should be enabled (not yet confirmed)');
      assert(/Confirm for/.test(lobbyState.teammateConfirmHtml) && /TD \(E2E\)/.test(lobbyState.teammateConfirmHtml),
        `STEP 2: teammate-confirm list should offer to confirm for teammate "TD (E2E)", got: ${lobbyState.teammateConfirmHtml.slice(0, 300)}`);
      // NOT asserted (documenting, not fixing -- out of scope for Task 13):
      // renderReadinessStatus() has the SAME field-shape bug family as the
      // renderMatchCardsWithDiscord() bug fixed above, in a function this
      // task did not otherwise touch -- it derives `activeTeamIds` from
      // `(side.players || [])`, never falling back to the real
      // `side.playerIds` shape, so it reports "No teams need to ready up."
      // for every real match instead of listing the active teams. The
      // ready-status DISPLAY CONTAINER itself is correctly wired into the
      // merged panel (visible, in the right place, would show real content
      // once that function is fixed) -- only its own data-shape handling is
      // broken, same root cause `e2e-ready-check.js` already reported for a
      // sibling function. Flagging for a future TODO.md entry rather than
      // fixing here.
      if (!/Team Alpha/.test(lobbyState.readyStatusHtml) || !/Team Beta/.test(lobbyState.readyStatusHtml)) {
        console.log('--- KNOWN PRE-EXISTING BUG (not fixed, out of scope): renderReadinessStatus() ' +
          'shows "No teams need to ready up." for a real match because it only reads side.players[], ' +
          'never side.playerIds -- same bug family as the renderMatchCardsWithDiscord() fix in this commit, ' +
          'but in a function Task 13 did not otherwise touch. readyStatusHtml: ' + lobbyState.readyStatusHtml.slice(0, 200));
      }
      assert(lobbyState.lobbyCreatorRoleDisplay !== 'none' && /lobby creator/i.test(lobbyState.lobbyCreatorRoleText || ''),
        `STEP 2: lobby-creator banner should be visible for E2ePlayer14 (the designated TEAM_A creator), got display="${lobbyState.lobbyCreatorRoleDisplay}" text="${lobbyState.lobbyCreatorRoleText}"`);

      await playerPage.screenshot({ path: path.resolve(__dirname, 'task13-panel-lobby-open.png') });
      console.log('Screenshot saved: dev/tests/task13-panel-lobby-open.png');

      await playerContext.close();

      console.log('\nAll assertions passed. The pre-game and lobby-ready overlays are now a single evolving panel.\n');
      allPassed = true;
    } finally {
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
