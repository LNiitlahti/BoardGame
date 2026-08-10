/**
 * e2e-team-challenge-button.js — verification test for TODO.md Task 19
 * ("team.html: add a team-facing CHALLENGE button so teams can request a
 * heart-hex dispute themselves during the 'challenges' phase, instead of
 * only the TD being able to create one from admin.html's ⚔ button").
 *
 * The TD-side ⚔ button (admin.js's addChallengeToQueue/
 * updateChallengeHexPicker/confirmChallengeSetup, ~admin.js:2182-2403) is a
 * full manual match-setup modal: up to 2 teams per side, a hex picker, and
 * player-by-player roster assembly via manualGameSetup.sides. That flow is
 * untouched by this task — this test only exercises the NEW, deliberately
 * simplified team-facing flow added to team.html/team-controls.js:
 *
 *   - `#challengeSection` (team.html left sidebar) is visible only during
 *     `currentPhase.name === 'challenges'` (renderChallengePanel(),
 *     team-controls.js).
 *   - Eligibility = a heart hex in `gameState.heartHexControl` NOT controlled
 *     by the requesting team, AND persistently flagged eligible for that team
 *     in `gameState.heartHexChallengeEligibility[coord][teamId]`
 *     (`_getEligibleChallengeHexes()`). That flag is normally set by the
 *     adjacency trigger in admin.js/board-manager.js's
 *     markAdjacentHeartHexesEligible() when a plate is placed next to an
 *     opponent-controlled heart hex; this test seeds it directly (synthetic
 *     hexes have no real board position to trigger adjacency from).
 *   - 0 eligible hexes → disabled button + explanation, no modal reachable.
 *   - 1 eligible hex → clicking "⚔ CHALLENGE" skips the picker and shows a
 *     direct confirm summary.
 *   - 2+ eligible hexes → a `<select>` picker appears; confirming submits
 *     whichever hex is currently selected.
 *   - Submitting creates a `gameQueue` entry via `submitChallenge()`
 *     (Firestore transaction) with the SAME shape and insertion-position
 *     logic as `confirmChallengeSetup()`: `disputingSideA`/`disputingSideB`
 *     reduced to [requesting team] vs [controlling team], `teams[].playerIds`
 *     built from each side's FULL roster
 *     (`PlayerUtils.getTeamPlayerIds()` — the same helper used for normal
 *     roster resolution elsewhere in the codebase) rather than a manual pick,
 *     `challengeHexCoord` set to the disputed hex, `isChallenge: true`,
 *     `status: 'pending'`.
 *
 * Uses synthetic, non-board-shaped `heartHexControl` keys
 * ("e2e_test_hex_a"/"e2e_test_hex_b") instead of real `qXrY` board
 * coordinates specifically so this test can never collide with or corrupt
 * real board state — `_getEligibleChallengeHexes()`'s coord regex simply
 * fails to match and falls back to the generic "Heart" type label, which is
 * fine for this test's purposes (it never asserts on the hex TYPE label).
 *
 * Test flow against e2e-disposable-1's real Team Alpha (id 1, includes
 * real-linked "E2ePlayer14") / Team Beta (id 2):
 *
 *   PART 1 — zero eligible hexes: heartHexControl seeded with nothing (or
 *   only entries owned by Team Alpha itself). Logs in as E2ePlayer14, opens
 *   team.html, asserts #challengeSection is visible (challenges phase) but
 *   its CHALLENGE button is disabled and the body explains why.
 *
 *   PART 2 — exactly one eligible hex (owned by Team Beta): asserts the
 *   panel shows the "1 contested hex" summary, clicking CHALLENGE opens the
 *   modal with the picker hidden and a direct confirm summary naming Team
 *   Beta, and confirming creates a real gameQueue entry with the exact
 *   shape described above. Verifies teams[].playerIds against
 *   PlayerUtils.getTeamPlayerIds() computed independently on the TD side.
 *
 *   PART 3 — two eligible hexes (both owned by Team Beta, two different
 *   synthetic coords): asserts the panel shows the "2 contested hexes"
 *   summary and the modal's picker is visible with 2 options; selects the
 *   second option and confirms, asserting the resulting queue entry's
 *   `challengeHexCoord` matches the SECOND hex (proves the picker's
 *   selection, not just the first option, drives the submission).
 *
 *   PART 4 — rapid double-submit must not create two queue entries. Code
 *   review flagged that, unlike `submitVote()` (self-deduped by uid, so a
 *   double-click there is a harmless no-op), `submitChallenge()`'s
 *   transaction only re-verifies `heartHexControl` — which QUEUING a
 *   challenge never mutates (only later RESOLVING one does) — so nothing in
 *   the transaction itself would stop a fast double-click from creating two
 *   real duplicate dispute matches. Fix: `#submitChallengeBtn` (team.html)
 *   is disabled synchronously at the top of `submitChallenge()`, before any
 *   `await`, and re-enabled only on a non-success outcome (stale hex, wrong
 *   phase, thrown error) or the next `openChallengeModal()` call. Real click
 *   timing in Puppeteer can't reliably reproduce a same-tick double-click,
 *   so this part calls `submitChallenge()` twice back-to-back in one
 *   `page.evaluate` without awaiting the first — since the function runs
 *   synchronously up to its first `await`, this reproduces the exact race a
 *   fast double-click would hit. Asserts the button is synchronously
 *   disabled after the first call (before its transaction resolves) and
 *   that exactly one `isChallenge` queue entry exists after both calls
 *   settle.
 *
 * Snapshots/restores `heartHexControl`, `currentPhase`, `gameQueue` in a
 * `finally` block. `heartHexControl` is a Firestore MAP field (same gotcha
 * category as `board`/`players` — merge:true does not delete omitted map
 * keys), so the restore explicitly `FieldValue.delete()`s the two synthetic
 * keys this test adds, in addition to reassigning the snapshot.
 *
 * Run: cd BoardGame && node dev/tests/e2e-team-challenge-button.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const HEX_A = 'e2e_test_hex_a';
const HEX_B = 'e2e_test_hex_b';

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

    assert(process.env.PLAYER14_EMAIL && process.env.PLAYER14_PASSWORD,
      'PLAYER14_EMAIL/PLAYER14_PASSWORD must be set in .env.e2e to log in as E2ePlayer14');

    const rosterInfo = await tdPage.evaluate(() => {
      const gs = window.godApp.gameState;
      const teamAlpha = gs.teams.find(t => String(t.id) === '1');
      const teamBeta = gs.teams.find(t => String(t.id) === '2');
      const player14 = teamAlpha?.players?.find(p => p.name === 'E2ePlayer14' && p.uid);
      return {
        teamAlphaName: teamAlpha?.name || null,
        teamBetaName: teamBeta?.name || null,
        player14: player14 ? { id: player14.id, uid: player14.uid } : null,
        alphaPlayerIds: window.PlayerUtils.getTeamPlayerIds(gs, teamAlpha.id),
        betaPlayerIds: window.PlayerUtils.getTeamPlayerIds(gs, teamBeta.id)
      };
    });
    assert(rosterInfo.player14, `Expected Team Alpha to have a real-linked "E2ePlayer14" player. Got roster info: ${JSON.stringify(rosterInfo)}`);
    assert(rosterInfo.alphaPlayerIds.length > 0, 'Expected Team Alpha to have a non-empty roster');
    assert(rosterInfo.betaPlayerIds.length > 0, 'Expected Team Beta to have a non-empty roster');
    console.log('Roster:', JSON.stringify(rosterInfo));

    const original = await tdPage.evaluate(() => ({
      heartHexControl: JSON.parse(JSON.stringify(window.godApp.gameState.heartHexControl || {})),
      heartHexChallengeEligibility: JSON.parse(JSON.stringify(window.godApp.gameState.heartHexChallengeEligibility || {})),
      currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
      gameQueue: JSON.parse(JSON.stringify(window.godApp.gameState.gameQueue || []))
    }));

    let playerContext;
    try {
      // ============================================================
      // PART 1 — zero eligible hexes: disabled button + explanation
      // ============================================================
      await tdPage.evaluate(() => {
        const gs = window.godApp.gameState;
        gs.heartHexControl = {}; // nothing contested yet
        gs.heartHexChallengeEligibility = {};
        gs.currentPhase = { name: 'challenges', roundNumber: 999901 };
        gs.gameQueue = [];
        return window.godApp.saveGameState();
      });

      playerContext = await browser.createBrowserContext();
      const playerPage = await playerContext.newPage();
      await playerPage.setViewport({ width: 1280, height: 900 });
      await login(playerPage, baseUrl, process.env.PLAYER14_EMAIL, process.env.PLAYER14_PASSWORD);
      await gotoTournamentPage(playerPage, baseUrl, 'full/team.html', tournamentId, '&teamId=1');

      await playerPage.waitForFunction(
        () => typeof teamData !== 'undefined' && teamData && Array.isArray(teamData.players),
        { timeout: 40000 }
      );

      await playerPage.waitForFunction(
        () => document.getElementById('challengeSection')?.style.display !== 'none',
        { timeout: 15000 }
      );

      const part1 = await playerPage.evaluate(() => {
        const body = document.getElementById('challengePanelBody');
        const btn = body?.querySelector('button');
        return {
          bodyText: body?.textContent || '',
          btnDisabled: btn?.disabled,
          btnExists: !!btn
        };
      });
      console.log('--- PART 1: zero-eligible-hex panel state ---', JSON.stringify(part1));
      assert(part1.btnExists, 'PART 1: CHALLENGE button should exist even with zero eligible hexes');
      assert(part1.btnDisabled === true, 'PART 1: CHALLENGE button should be disabled with zero eligible hexes');
      assert(/no contested hexes/i.test(part1.bodyText), `PART 1: panel should explain why the button is disabled, got: "${part1.bodyText}"`);

      // ============================================================
      // PART 2 — exactly one eligible hex: direct confirm, no picker
      // ============================================================
      await tdPage.evaluate((coord) => {
        const gs = window.godApp.gameState;
        gs.heartHexControl = { [coord]: 2 }; // Team Beta controls it
        // Synthetic hex has no real board position to trigger the adjacency
        // rule from, so seed the persisted eligibility flag directly (this
        // is what markAdjacentHeartHexesEligible() would have set).
        gs.heartHexChallengeEligibility = { [coord]: { 1: true } }; // Team Alpha (id 1) is eligible
        return window.godApp.saveGameState();
      }, HEX_A);

      await playerPage.waitForFunction(
        (expected) => {
          const body = document.getElementById('challengePanelBody');
          return body && new RegExp(expected, 'i').test(body.textContent || '');
        },
        { timeout: 15000 },
        '1 contested hex'
      );

      const part2Panel = await playerPage.evaluate(() => ({
        bodyText: document.getElementById('challengePanelBody')?.textContent || '',
        btnDisabled: document.getElementById('challengePanelBody')?.querySelector('button')?.disabled
      }));
      console.log('--- PART 2: one-eligible-hex panel state ---', JSON.stringify(part2Panel));
      assert(part2Panel.btnDisabled !== true, 'PART 2: CHALLENGE button should be enabled with 1 eligible hex');
      assert(/team beta/i.test(part2Panel.bodyText), `PART 2: panel summary should name the controlling team, got: "${part2Panel.bodyText}"`);

      await playerPage.click('#challengeSection button');
      await playerPage.waitForFunction(
        () => document.getElementById('challengeModal')?.style.display === 'flex',
        { timeout: 10000 }
      );

      const part2Modal = await playerPage.evaluate(() => ({
        pickerDisplay: getComputedStyle(document.getElementById('challengeHexPickerWrap')).display,
        confirmText: document.getElementById('challengeConfirmText')?.textContent || ''
      }));
      console.log('--- PART 2: modal state (1 eligible hex) ---', JSON.stringify(part2Modal));
      assert(part2Modal.pickerDisplay === 'none', 'PART 2: hex picker should be hidden when there is only 1 eligible hex (skip straight to confirm)');
      assert(/team beta/i.test(part2Modal.confirmText), `PART 2: confirm summary should name Team Beta, got: "${part2Modal.confirmText}"`);

      await playerPage.click('#challengeModal button.primary');

      await playerPage.waitForFunction(
        () => document.getElementById('challengeModal')?.style.display === 'none',
        { timeout: 10000 }
      );

      // Read the resulting queue entry fresh from the TD's live listener.
      await tdPage.waitForFunction(
        () => (window.godApp.gameState.gameQueue || []).some(m => m.isChallenge === true),
        { timeout: 15000 }
      );

      const part2Entry = await tdPage.evaluate(() => {
        const gs = window.godApp.gameState;
        return gs.gameQueue.find(m => m.isChallenge === true) || null;
      });
      console.log('--- PART 2: created queue entry ---', JSON.stringify(part2Entry));

      assert(part2Entry, 'PART 2: expected a new isChallenge:true gameQueue entry to have been created');
      assert(part2Entry.status === 'pending', `PART 2: entry.status should be 'pending', got '${part2Entry.status}'`);
      assert(part2Entry.challengeHexCoord === HEX_A, `PART 2: entry.challengeHexCoord should be '${HEX_A}', got '${part2Entry.challengeHexCoord}'`);
      assert(JSON.stringify(part2Entry.disputingSideA) === JSON.stringify([1]), `PART 2: disputingSideA should be [1], got ${JSON.stringify(part2Entry.disputingSideA)}`);
      assert(JSON.stringify(part2Entry.disputingSideB) === JSON.stringify([2]), `PART 2: disputingSideB should be [2], got ${JSON.stringify(part2Entry.disputingSideB)}`);
      assert(JSON.stringify(part2Entry.disputingTeamIds) === JSON.stringify([1, 2]), `PART 2: disputingTeamIds should be [1,2], got ${JSON.stringify(part2Entry.disputingTeamIds)}`);
      assert(part2Entry.teams?.length === 2, `PART 2: entry.teams should have 2 sides, got ${JSON.stringify(part2Entry.teams)}`);
      assert(part2Entry.teams[0].id === 'TEAM_A' && part2Entry.teams[1].id === 'TEAM_B',
        `PART 2: teams[].id should be TEAM_A/TEAM_B labels, got ${JSON.stringify(part2Entry.teams.map(t => t.id))}`);
      assert(JSON.stringify([...part2Entry.teams[0].playerIds].sort()) === JSON.stringify([...rosterInfo.alphaPlayerIds].sort()),
        `PART 2: TEAM_A playerIds should be Team Alpha's full roster (${JSON.stringify(rosterInfo.alphaPlayerIds)}), got ${JSON.stringify(part2Entry.teams[0].playerIds)}`);
      assert(JSON.stringify([...part2Entry.teams[1].playerIds].sort()) === JSON.stringify([...rosterInfo.betaPlayerIds].sort()),
        `PART 2: TEAM_B playerIds should be Team Beta's full roster (${JSON.stringify(rosterInfo.betaPlayerIds)}), got ${JSON.stringify(part2Entry.teams[1].playerIds)}`);
      assert(part2Entry.discordChannels && typeof part2Entry.discordChannels.TEAM_A === 'number' && typeof part2Entry.discordChannels.TEAM_B === 'number',
        `PART 2: entry.discordChannels should assign a channel to both sides (team.html-local assignDiscordAndLobby equivalent), got ${JSON.stringify(part2Entry.discordChannels)}`);
      assert(typeof part2Entry.matchNumber === 'number', 'PART 2: entry.matchNumber should be a number');
      assert(typeof part2Entry.game === 'string' && part2Entry.game.length > 0, 'PART 2: entry.game should default to some non-empty game id');
      assert(part2Entry.playType === `${rosterInfo.alphaPlayerIds.length}v${rosterInfo.betaPlayerIds.length}`,
        `PART 2: entry.playType should reflect both full rosters, got '${part2Entry.playType}'`);

      const toastText = await playerPage.evaluate(() => document.getElementById('statusMessage')?.textContent || '');
      assert(/challenge/i.test(toastText) && /submitted/i.test(toastText), `PART 2: expected a submitted-challenge toast, got: "${toastText}"`);

      // ============================================================
      // PART 3 — two eligible hexes: picker appears, selection drives result
      // ============================================================
      await tdPage.evaluate((coords) => {
        const gs = window.godApp.gameState;
        gs.heartHexControl = { [coords.a]: 2, [coords.b]: 2 }; // both held by Team Beta
        gs.heartHexChallengeEligibility = { [coords.a]: { 1: true }, [coords.b]: { 1: true } };
        gs.gameQueue = gs.gameQueue.filter(m => !m.isChallenge); // clear PART 2's entry so matchNumber math stays simple
        return window.godApp.saveGameState();
      }, { a: HEX_A, b: HEX_B });

      await playerPage.waitForFunction(
        () => /2 contested hexes/i.test(document.getElementById('challengePanelBody')?.textContent || ''),
        { timeout: 15000 }
      );

      await playerPage.click('#challengeSection button');
      await playerPage.waitForFunction(
        () => document.getElementById('challengeModal')?.style.display === 'flex',
        { timeout: 10000 }
      );

      const part3ModalOpen = await playerPage.evaluate(() => {
        const select = document.getElementById('challengeHexPicker');
        return {
          pickerDisplay: getComputedStyle(document.getElementById('challengeHexPickerWrap')).display,
          optionCount: select?.options.length,
          optionValues: select ? Array.from(select.options).map(o => o.value) : []
        };
      });
      console.log('--- PART 3: modal state (2 eligible hexes) ---', JSON.stringify(part3ModalOpen));
      assert(part3ModalOpen.pickerDisplay !== 'none', 'PART 3: hex picker should be VISIBLE when there are 2+ eligible hexes');
      assert(part3ModalOpen.optionCount === 2, `PART 3: picker should have exactly 2 options, got ${part3ModalOpen.optionCount}`);
      assert(part3ModalOpen.optionValues.includes(HEX_A) && part3ModalOpen.optionValues.includes(HEX_B),
        `PART 3: picker options should be the two synthetic hexes, got ${JSON.stringify(part3ModalOpen.optionValues)}`);

      // Select the SECOND hex explicitly, to prove selection (not just the
      // first option) drives what gets submitted.
      await playerPage.select('#challengeHexPicker', HEX_B);
      await playerPage.evaluate(() => document.getElementById('challengeHexPicker').dispatchEvent(new Event('change')));

      await playerPage.click('#challengeModal button.primary');
      await playerPage.waitForFunction(
        () => document.getElementById('challengeModal')?.style.display === 'none',
        { timeout: 10000 }
      );

      await tdPage.waitForFunction(
        () => (window.godApp.gameState.gameQueue || []).some(m => m.isChallenge === true),
        { timeout: 15000 }
      );
      const part3Entry = await tdPage.evaluate(() => {
        const gs = window.godApp.gameState;
        return gs.gameQueue.find(m => m.isChallenge === true) || null;
      });
      console.log('--- PART 3: created queue entry ---', JSON.stringify(part3Entry));
      assert(part3Entry, 'PART 3: expected a new isChallenge:true gameQueue entry to have been created');
      assert(part3Entry.challengeHexCoord === HEX_B,
        `PART 3: entry.challengeHexCoord should be the SELECTED hex '${HEX_B}' (not the first option '${HEX_A}'), got '${part3Entry.challengeHexCoord}'`);

      // ============================================================
      // PART 4 — rapid double-submit must not create two queue entries.
      // Unlike submitVote() (self-deduped by uid), the transaction's only
      // guard checks heartHexControl, which queuing a challenge never
      // mutates -- so this is a client-side (button-disable) guard, not a
      // server-side one. Real click timing in Puppeteer can't reliably
      // reproduce a same-tick double-click, so this calls submitChallenge()
      // twice back-to-back without awaiting the first -- since the function
      // is synchronous up to its first `await` (the disable happens before
      // any network call), this reproduces the exact race a fast double-click
      // would hit.
      // ============================================================
      // heartHexControl is a Firestore MAP field -- merge:true (what
      // godApp.saveGameState() uses) does NOT delete keys omitted from a
      // plain reassign+save, only adds/overwrites the ones present. Going
      // from PART 3's {a, b} down to just {a} here needs an explicit
      // FieldValue.delete() for 'b', not a bare reassign -- same gotcha the
      // final restore below already accounts for, just hit mid-test this
      // time. (First attempt at this test used a bare reassign+saveGameState
      // here and the leftover 'b' key silently kept the panel showing "2
      // contested hexes" instead of "1", caught by the diagnostic added
      // below.) Written as a single raw Firestore update so the two
      // heartHexControl key changes and the gameQueue clear land atomically.
      await tdPage.evaluate(async (coord) => {
        const db = firebase.firestore();
        const tid = new URLSearchParams(window.location.search).get('tournamentId');
        const gs = window.godApp.gameState;
        const queue = (gs.gameQueue || []).filter(m => !m.isChallenge); // clear PART 3's entry
        await db.collection('tournaments').doc(tid).update({
          'heartHexControl.e2e_test_hex_a': 2, // Team Beta controls it again
          'heartHexControl.e2e_test_hex_b': firebase.firestore.FieldValue.delete(),
          // Eligibility for hex_a persists indefinitely from PART 2/3 (never
          // cleared by ownership changes), but set it explicitly too so this
          // part doesn't depend on that carry-over.
          'heartHexChallengeEligibility.e2e_test_hex_a.1': true,
          gameQueue: queue
        });
      }, HEX_A);

      try {
        await playerPage.waitForFunction(
          () => /1 contested hex/i.test(document.getElementById('challengePanelBody')?.textContent || ''),
          { timeout: 15000 }
        );
      } catch (waitErr) {
        const diag = await playerPage.evaluate(() => ({
          panelText: document.getElementById('challengePanelBody')?.textContent || null,
          sectionDisplay: document.getElementById('challengeSection')?.style.display,
          gameDataHeartHexControl: typeof gameData !== 'undefined' ? gameData.heartHexControl : 'gameData undefined',
          currentTeamId: typeof currentTeamId !== 'undefined' ? currentTeamId : 'undefined'
        }));
        console.error('PART 4 diagnostic (panel never showed "1 contested hex"):', JSON.stringify(diag));
        throw waitErr;
      }
      await playerPage.click('#challengeSection button');
      await playerPage.waitForFunction(
        () => document.getElementById('challengeModal')?.style.display === 'flex',
        { timeout: 10000 }
      );

      const doubleSubmit = await playerPage.evaluate(() => {
        const btn = document.getElementById('submitChallengeBtn');
        const disabledBefore = btn.disabled;
        const p1 = submitChallenge();
        const disabledAfterFirstCall = btn.disabled;
        const p2 = submitChallenge(); // should short-circuit on the disabled guard
        return Promise.all([p1, p2]).then(() => ({ disabledBefore, disabledAfterFirstCall }));
      });
      console.log('--- PART 4: double-submit guard state ---', JSON.stringify(doubleSubmit));
      assert(doubleSubmit.disabledBefore === false, 'PART 4: button should start enabled');
      assert(doubleSubmit.disabledAfterFirstCall === true, 'PART 4: button should be synchronously disabled by the first submitChallenge() call, before its transaction resolves (this is what makes the second call a no-op)');

      await playerPage.waitForFunction(
        () => document.getElementById('challengeModal')?.style.display === 'none',
        { timeout: 10000 }
      );
      await tdPage.waitForFunction(
        () => (window.godApp.gameState.gameQueue || []).some(m => m.isChallenge === true),
        { timeout: 15000 }
      );
      // Give a moment for any errant second write to land before counting.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const part4Entries = await tdPage.evaluate(() => (window.godApp.gameState.gameQueue || []).filter(m => m.isChallenge === true));
      console.log('--- PART 4: challenge entries after double-submit ---', JSON.stringify(part4Entries.map(e => e.id)));
      assert(part4Entries.length === 1, `PART 4: a rapid double-submit should create exactly ONE queue entry, got ${part4Entries.length}`);

      console.log('\nAll assertions passed. Team self-service CHALLENGE button creates TD-shaped gameQueue entries correctly, and a rapid double-submit only creates one.\n');
      allPassed = true;
    } finally {
      if (playerContext) await playerContext.close();
      await tdPage.evaluate(async (orig) => {
        const gs = window.godApp.gameState;
        gs.gameQueue = orig.gameQueue;
        gs.currentPhase = orig.currentPhase;
        gs.heartHexControl = orig.heartHexControl;
        gs.heartHexChallengeEligibility = orig.heartHexChallengeEligibility;
        await window.godApp.saveGameState();
        // heartHexControl/heartHexChallengeEligibility are Firestore MAP
        // fields -- merge:true does not delete keys omitted from a plain
        // reassign+save. Explicitly delete the synthetic keys this test may
        // have added, in addition to the reassign above (same pattern as the
        // board/players gotchas).
        const db = firebase.firestore();
        const tid = new URLSearchParams(window.location.search).get('tournamentId');
        await db.collection('tournaments').doc(tid).update({
          'heartHexControl.e2e_test_hex_a': firebase.firestore.FieldValue.delete(),
          'heartHexControl.e2e_test_hex_b': firebase.firestore.FieldValue.delete(),
          'heartHexChallengeEligibility.e2e_test_hex_a': firebase.firestore.FieldValue.delete(),
          'heartHexChallengeEligibility.e2e_test_hex_b': firebase.firestore.FieldValue.delete()
        });
      }, original);
      console.log('Restored original heartHexControl/currentPhase/gameQueue.');
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
