/**
 * e2e-force-advance-parity.js — regression/verification test for TODO.md
 * Task 18 ("'⚠ Force' label rename + per-slot Force parity").
 *
 * INVESTIGATION (confirmed by reading source, not guessed):
 *   There were exactly THREE "⚠ Force" button-label strings in the
 *   codebase, not two — the third was missed by the original scoping pass
 *   and found while building this test:
 *     1. `full/admin.html:120` — a STATIC copy of the Flow Panel markup
 *        baked directly into admin.html's own HTML (the page's initial
 *        DOM before any JS runs), containing the GLOBAL force-advance-the-
 *        whole-phase button (`id="forceAdvanceBtn"`,
 *        `onclick="forceAdvancePhase()"`).
 *     2. `full/scripts/admin-improved-adapter.js:1257` — a SECOND, JS-built
 *        copy of the identical Flow Panel markup, used by
 *        `_restoreFlowPanelDOM()` to rebuild the panel if the "phases not
 *        yet initialized" prompt ever replaced `#flowPanel`'s innerHTML.
 *        Both (1) and (2) must stay in sync since they're two independent
 *        copies of the same button.
 *     3. `full/scripts/phase-manager.js:1513` — the PER-SLOT force button,
 *        rendered by `_renderSlotPanels(phase)` into `#phaseIndicatorBar`.
 *        That element only exists in god.html's markup (`full/god.html:62`)
 *        — admin.html has no `#phaseIndicatorBar` at all — so this button
 *        has only ever been reachable on god.html.
 *   All three now read "⚠ Force Advance" (kept the warning emoji — it's the
 *   established convention for danger/caution affordances elsewhere in this
 *   UI: the Force Advance confirmation MODAL itself already said "⚠ Force
 *   Advance Phase" / "Force Advance" pre-existing (`full/admin.html:600,613`
 *   — untouched by this change), and `⚠` is used the same way for the
 *   pending-hex banner and the balance-warning icon in admin.js).
 *
 *   Separately, `window.forceAdvanceSlot(slot)` was ALREADY correctly wired
 *   in admin-improved-adapter.js:1516 (`_phaseManager.advanceSlot(slot,
 *   true)`, identical semantics to god.html's own
 *   `window.forceAdvanceSlot` at god-app.js:1142) — it just had no visible
 *   button on admin.html. Fix: `_renderMatchSlotCards()`
 *   (admin-improved-adapter.js ~line 644) now renders a per-slot "⚠ Force
 *   Advance" button next to each slot's primary action button, hidden once
 *   that slot is `done` — mirroring phase-manager.js's own per-slot button
 *   convention (`${isDone ? 'style="display:none"' : ''}`) exactly.
 *
 * WHAT THIS TEST PROVES (against live e2e-disposable-1):
 *   PART 1 (admin.html) — the new per-slot parity:
 *     - Seeds `currentPhase` = 'matches_in_progress', both slots in 'setup'
 *       with ZERO queued matches for either slot — i.e. slot 1's sole
 *       'setup' requirement ("Create a match for Match 1") is UNMET
 *       (`getSlotRequirements(1)` -> `met: false`), so the normal "Open
 *       Lobby ▶" primary button never even appears (only "⚡ Auto-Generate"
 *       does, per `_computeSlotStep`) — there is no other UI path to
 *       advance slot 1 out of 'setup' at all without this button.
 *     - Confirms the new per-slot "⚠ Force Advance" button is present,
 *       visible (not `display:none`), and reads the new label.
 *     - Clicks it (real DOM `.click()`, not a direct JS call) and asserts
 *       slot 1 advances out of 'setup' (to 'lobby', or straight through to
 *       'playing' if it auto-advances further — see the auto-advance note
 *       below) DESPITE the unmet requirement, while slot 2 (never clicked)
 *       stays exactly at 'setup' — proving the button is correctly scoped
 *       per-slot, not a whole-phase force.
 *     - Also opens + closes the EXISTING global "⚠ Force Advance" button's
 *       modal (non-destructively — Cancel, not Confirm) to prove that
 *       button/its label still work unchanged after the rename, without
 *       actually force-advancing the whole phase.
 *     - Scenario B (added after code review flagged the gap: no test in
 *       dev/tests/ exercised the whole-phase force CONFIRM action at all —
 *       only the per-slot force and this modal's open/cancel path were
 *       covered): seeds `hex_placement_1` with a genuinely unmet requirement
 *       (a synthetic `pendingHexWins` entry — the same gate
 *       e2e-hex-placement-gate.js proves BLOCKS a normal advancePhase()),
 *       opens the modal again, clicks its real "Force Advance" CONFIRM
 *       button (`confirmForceAdvance()` -> `_phaseManager.advancePhase(true)`),
 *       and asserts `currentPhase` actually moves off `hex_placement_1` to
 *       `spell_window_1` (the real next phase) DESPITE the pending-hex gate
 *       — proving the whole-phase force-bypass mechanism itself, not just
 *       its modal's open/close chrome, still works after the rename.
 *   PART 2 (god.html) — the pre-existing per-slot button is untouched:
 *     - Same seed/click/assert shape as Part 1, but against god.html's
 *       stock `_renderSlotPanels()` button (`#phaseIndicatorBar
 *       .match-slot-panel button[onclick="forceAdvanceSlot(1)"]`) — proves
 *       the rename didn't break the original per-slot button's behavior on
 *       the page it's always lived on.
 *
 * AUTO-ADVANCE GOTCHA (found while building this test, not a bug — existing
 * behavior, just worth documenting): forcing a slot with ZERO queued matches
 * from 'setup' straight to 'lobby' means `_getPlayersWhoMustReadyForSlot()`
 * has nobody to wait for (no match assigned to the slot), so
 * `getSlotRequirements(slot)` for 'lobby' reports `met: true` immediately,
 * and `recheckRequirements()`'s existing lobby-auto-advance timer (100ms)
 * fires and pushes the slot straight on to 'playing' right after — a SECOND
 * real Firestore write from the app's own reactive logic, not something
 * this test triggers directly. This test tolerates either resulting state
 * (asserts `!== 'setup'`, not a specific next value) and waits 2s of quiet
 * time before restoring, so the restore write is guaranteed to be the last
 * one and isn't clobbered by that trailing auto-advance save.
 *
 * Snapshots/restores `currentPhase` and `lobbyReady` on BOTH pages'
 * gameState in `finally` blocks (plain reassign + saveGameState — safe here
 * per the established e2e-hex-placement-gate.js precedent: this test only
 * ever writes back the exact same key set `currentPhase` already had, never
 * adds a new key that would need an explicit FieldValue.delete() the way
 * `board`/`players` map-field leaks do). Part 1 (admin.html) additionally
 * snapshots/restores `pendingHexWins` (a plain array field, same safe-to-
 * reassign category as `gameQueue`/`teams` — see the map-field-vs-array-
 * field distinction documented lower in E2E_HARNESS.md), used only by
 * Scenario B.
 *
 * Run: cd BoardGame && node dev/tests/e2e-force-advance-parity.js
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer } = require('./e2e-harness');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function part1_adminHtml(browser, baseUrl, tournamentId) {
  console.log('\n========== PART 1: admin.html — per-slot Force Advance parity ==========\n');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
  await gotoTournamentPage(page, baseUrl, 'full/admin.html', tournamentId);

  // gameState/saveGameState/updateDisplay are bare top-level `let`/function
  // declarations in admin.js, accessible from page.evaluate the same way
  // e2e-next-up-availability.js documents.
  await page.waitForFunction(
    () => typeof gameState !== 'undefined' && gameState && Array.isArray(gameState.teams) && gameState.teams.length > 0,
    { timeout: 40000 }
  );
  await page.waitForFunction(
    () => !!document.getElementById('flowPanel'),
    { timeout: 20000 }
  );

  const original = await page.evaluate(() => ({
    currentPhase: JSON.parse(JSON.stringify(gameState.currentPhase || null)),
    lobbyReady: JSON.parse(JSON.stringify(gameState.lobbyReady || {})),
    pendingHexWins: JSON.parse(JSON.stringify(gameState.pendingHexWins || []))
  }));

  let allPassed = false;
  try {
    const ROUND = 999821; // distinctive round number, won't collide with real data
    const seeded = await page.evaluate(async (ROUND) => {
      gameState.currentPhase = {
        name: 'matches_in_progress',
        roundNumber: ROUND,
        startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        slots: { 1: 'setup', 2: 'setup' }
      };
      await saveGameState();
      updateDisplay();

      const globalBtn = document.getElementById('forceAdvanceBtn');
      const globalLabel = globalBtn ? globalBtn.textContent.trim() : null;

      const slot1Panel = Array.from(document.querySelectorAll('#matchSlotCards .match-slot-panel'))
        .find(el => el.querySelector('.match-slot-name')?.textContent.includes('Match 1'));
      const forceBtn1 = slot1Panel ? slot1Panel.querySelector('button[onclick="forceAdvanceSlot(1)"]') : null;

      return {
        globalLabel,
        slot1PanelFound: !!slot1Panel,
        forceBtn1Found: !!forceBtn1,
        forceBtn1Label: forceBtn1 ? forceBtn1.textContent.trim() : null,
        forceBtn1Visible: forceBtn1 ? forceBtn1.style.display !== 'none' : false,
        subPhase1: gameState.currentPhase.slots[1],
        subPhase2: gameState.currentPhase.slots[2]
      };
    }, ROUND);

    console.log('--- Seeded state / DOM check ---');
    console.log(JSON.stringify(seeded, null, 2));

    assert(seeded.subPhase1 === 'setup' && seeded.subPhase2 === 'setup', 'Both slots should start in setup');
    assert(seeded.globalLabel && seeded.globalLabel.includes('Force Advance'),
      `Global Force button should read "Force Advance", got: "${seeded.globalLabel}"`);
    assert(seeded.slot1PanelFound, 'Match 1 slot card should be present in #matchSlotCards');
    assert(seeded.forceBtn1Found, 'Match 1 slot card should now have a per-slot Force Advance button (the new parity feature)');
    assert(seeded.forceBtn1Label && seeded.forceBtn1Label.includes('Force Advance'),
      `Per-slot Force button should read "Force Advance", got: "${seeded.forceBtn1Label}"`);
    assert(seeded.forceBtn1Visible, 'Per-slot Force button should be visible (slot is not done)');

    // ── Non-destructively verify the EXISTING global Force button still works:
    //    open its modal, then Cancel (not Confirm) — proves the rename didn't
    //    break its wiring without actually force-advancing the whole phase. ──
    const modalCheck = await page.evaluate(() => {
      const globalBtn = document.getElementById('forceAdvanceBtn');
      globalBtn.click();
      const modal = document.getElementById('forceAdvanceModal');
      const openedDisplay = modal ? modal.style.display : null;
      window.closeForceAdvanceModal();
      const closedDisplay = modal ? modal.style.display : null;
      return {
        openedDisplay, closedDisplay,
        phaseStillUntouched: gameState.currentPhase.slots[1] === 'setup' && gameState.currentPhase.slots[2] === 'setup'
      };
    });
    console.log('--- Global Force button open/cancel check ---');
    console.log(JSON.stringify(modalCheck, null, 2));
    assert(modalCheck.openedDisplay === 'flex', `Clicking the global Force button should open its modal, got display: "${modalCheck.openedDisplay}"`);
    assert(modalCheck.closedDisplay === 'none', `Cancelling should close the modal again, got display: "${modalCheck.closedDisplay}"`);
    assert(modalCheck.phaseStillUntouched, 'Opening/cancelling the global Force modal must not touch slot state');

    // ── Click the NEW per-slot Force Advance button for slot 1 ──
    await page.evaluate(() => {
      const slot1Panel = Array.from(document.querySelectorAll('#matchSlotCards .match-slot-panel'))
        .find(el => el.querySelector('.match-slot-name')?.textContent.includes('Match 1'));
      slot1Panel.querySelector('button[onclick="forceAdvanceSlot(1)"]').click();
    });

    // forceAdvanceSlot() is async and the bare onclick doesn't await it, so
    // poll the in-memory gameState (mutated synchronously inside
    // advanceSlot(), before its own await this._save()) rather than
    // assuming completion right after the click.
    await page.waitForFunction(
      () => gameState.currentPhase && gameState.currentPhase.slots && gameState.currentPhase.slots['1'] !== 'setup',
      { timeout: 10000 }
    );

    const after = await page.evaluate(() => ({
      subPhase1: gameState.currentPhase.slots[1],
      subPhase2: gameState.currentPhase.slots[2]
    }));
    console.log('--- After clicking per-slot Force Advance (slot 1) ---');
    console.log(JSON.stringify(after, null, 2));

    assert(after.subPhase1 !== 'setup',
      `Slot 1 should have force-advanced past 'setup' despite the unmet requirement, got '${after.subPhase1}'`);
    assert(after.subPhase2 === 'setup',
      `Slot 2 was never clicked and must stay at 'setup', got '${after.subPhase2}'`);

    // ── Scenario B: the GLOBAL Force Advance button's CONFIRM action ──
    // Nothing in dev/tests/ previously exercised confirmForceAdvance() ->
    // _phaseManager.advancePhase(true) — every existing script either drives
    // advancePhase() unforced (e.g. e2e-hex-placement-gate.js, which proves
    // the gate correctly BLOCKS) or, above, only opens+cancels this same
    // modal. Reuses e2e-hex-placement-gate.js's well-understood gate
    // (hex_placement_1 blocked by a nonzero pendingHexWins count) as the
    // "genuinely unmet requirement" — but here seeds it directly (a single
    // synthetic pendingHexWins entry) rather than driving a real
    // confirmResult() flow, since the point of this scenario is proving
    // force BYPASSES the gate, not re-proving the gate itself (already
    // covered elsewhere).
    const confirmSeed = await page.evaluate(async () => {
      gameState.currentPhase = {
        name: 'hex_placement_1',
        roundNumber: 999823,
        startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      };
      // admin.js's `pendingHexWins` is a window accessor backed by
      // gameState.pendingHexWins (see E2E_HARNESS.md's Task 15 note) — this
      // is the sole gate _getPendingHexCount()/_calculateRequirements()
      // checks for hex_placement_1, so a nonzero synthetic entry is enough
      // to make the phase requirement genuinely unmet.
      pendingHexWins = [{ teamIds: ['e2e-force-confirm-test'], teamNames: ['E2E Force Confirm Test Team'], matchNumber: 999823 }];
      await saveGameState();
      updateDisplay();
      return { phaseBefore: gameState.currentPhase.name, pendingCountBefore: pendingHexWins.length };
    });
    console.log('--- Seeded hex_placement_1 with an unmet (pending hex) requirement ---');
    console.log(JSON.stringify(confirmSeed, null, 2));
    assert(confirmSeed.phaseBefore === 'hex_placement_1', 'Should have seeded hex_placement_1');
    assert(confirmSeed.pendingCountBefore === 1, 'Should have seeded exactly 1 pending hex win (unmet gate)');

    // Open the modal again (real click) and this time click CONFIRM.
    const confirmClick = await page.evaluate(() => {
      const globalBtn = document.getElementById('forceAdvanceBtn');
      globalBtn.click();
      const modal = document.getElementById('forceAdvanceModal');
      const openedDisplay = modal ? modal.style.display : null;
      const confirmBtn = document.querySelector('#forceAdvanceModal button[onclick="confirmForceAdvance()"]');
      const confirmBtnFound = !!confirmBtn;
      if (confirmBtn) confirmBtn.click();
      return { openedDisplay, confirmBtnFound };
    });
    console.log('--- Global Force button open/CONFIRM check ---');
    console.log(JSON.stringify(confirmClick, null, 2));
    assert(confirmClick.openedDisplay === 'flex', `Clicking the global Force button should open its modal, got display: "${confirmClick.openedDisplay}"`);
    assert(confirmClick.confirmBtnFound, 'Modal should have a "Force Advance" confirm button wired to confirmForceAdvance()');

    // confirmForceAdvance() is async (awaits advancePhase(true) THEN closes
    // the modal) and the bare onclick doesn't await it. gameState.currentPhase
    // flips synchronously inside advancePhase(), well before its own `await
    // this._save()` resolves — polling on that alone races
    // closeForceAdvanceModal(), which only runs after the whole
    // advancePhase(true) promise (save + logAction + re-render included) has
    // settled. Poll on the modal closing instead — it's the LAST thing
    // confirmForceAdvance() does, so by the time it's 'none' the phase change
    // is guaranteed to have already landed too.
    await page.waitForFunction(
      () => document.getElementById('forceAdvanceModal')?.style.display === 'none',
      { timeout: 10000 }
    );

    const confirmResult = await page.evaluate(() => ({
      phaseAfter: gameState.currentPhase.name,
      modalDisplayAfter: document.getElementById('forceAdvanceModal')?.style.display
    }));
    console.log('--- After clicking CONFIRM on the global Force Advance modal ---');
    console.log(JSON.stringify(confirmResult, null, 2));

    assert(confirmResult.phaseAfter !== 'hex_placement_1',
      `Whole-phase force-advance should have moved off 'hex_placement_1' despite the pending-hex gate, got '${confirmResult.phaseAfter}'`);
    assert(confirmResult.phaseAfter === 'spell_window_1',
      `hex_placement_1's real next phase is 'spell_window_1' (per PHASE_ORDER), got '${confirmResult.phaseAfter}'`);
    assert(confirmResult.modalDisplayAfter === 'none',
      `confirmForceAdvance() should close the modal after advancing, got display: "${confirmResult.modalDisplayAfter}"`);

    console.log('\nPart 1 (admin.html) assertions passed — including the global Force Advance CONFIRM path.');
    allPassed = true;
  } finally {
    // Let any trailing lobby-auto-advance timer (see header comment) finish
    // its own save before we issue the restore write, so ours is the last
    // one and isn't clobbered.
    await wait(2000);
    await page.evaluate((orig) => {
      gameState.currentPhase = orig.currentPhase;
      gameState.lobbyReady = orig.lobbyReady;
      pendingHexWins = orig.pendingHexWins;
      return saveGameState();
    }, original);
    console.log('Restored original currentPhase/lobbyReady/pendingHexWins on admin.html.');
  }
  await page.close();
  return allPassed;
}

async function part2_godHtml(browser, baseUrl, tournamentId) {
  console.log('\n========== PART 2: god.html — pre-existing per-slot Force button still works ==========\n');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);
  await gotoTournamentPage(page, baseUrl, 'full/god.html', tournamentId);

  await page.waitForFunction(
    () => !!(window.godApp && window.godApp.gameState && Array.isArray(window.godApp.gameState.teams) && window.godApp.gameState.teams.length > 0),
    { timeout: 40000 }
  );

  const original = await page.evaluate(() => ({
    currentPhase: JSON.parse(JSON.stringify(window.godApp.gameState.currentPhase || null)),
    lobbyReady: JSON.parse(JSON.stringify(window.godApp.gameState.lobbyReady || {}))
  }));

  let allPassed = false;
  try {
    const ROUND = 999822;
    const seeded = await page.evaluate(async (ROUND) => {
      const gs = window.godApp.gameState;
      gs.currentPhase = {
        name: 'matches_in_progress',
        roundNumber: ROUND,
        startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        slots: { 1: 'setup', 2: 'setup' }
      };
      await window.godApp.saveGameState();
      updateDisplay(); // window.updateDisplay = () => app.updateDisplay() — triggers phase.renderPhaseIndicator()

      const slot1Panel = Array.from(document.querySelectorAll('#phaseIndicatorBar .match-slot-panel'))
        .find(el => el.querySelector('.match-slot-name')?.textContent.includes('Match 1'));
      const forceBtn1 = slot1Panel ? slot1Panel.querySelector('button[onclick="forceAdvanceSlot(1)"]') : null;

      return {
        slot1PanelFound: !!slot1Panel,
        forceBtn1Found: !!forceBtn1,
        forceBtn1Label: forceBtn1 ? forceBtn1.textContent.trim() : null,
        forceBtn1Visible: forceBtn1 ? forceBtn1.style.display !== 'none' : false,
        subPhase1: gs.currentPhase.slots[1],
        subPhase2: gs.currentPhase.slots[2]
      };
    }, ROUND);

    console.log('--- Seeded state / DOM check ---');
    console.log(JSON.stringify(seeded, null, 2));

    assert(seeded.subPhase1 === 'setup' && seeded.subPhase2 === 'setup', 'Both slots should start in setup');
    assert(seeded.slot1PanelFound, 'Match 1 slot panel should be present in #phaseIndicatorBar');
    assert(seeded.forceBtn1Found, 'Match 1 slot panel should have its pre-existing per-slot Force Advance button');
    assert(seeded.forceBtn1Label && seeded.forceBtn1Label.includes('Force Advance'),
      `Per-slot Force button should read "Force Advance" (renamed from "⚠ Force"), got: "${seeded.forceBtn1Label}"`);
    assert(seeded.forceBtn1Visible, 'Per-slot Force button should be visible (slot is not done)');

    await page.evaluate(() => {
      const slot1Panel = Array.from(document.querySelectorAll('#phaseIndicatorBar .match-slot-panel'))
        .find(el => el.querySelector('.match-slot-name')?.textContent.includes('Match 1'));
      slot1Panel.querySelector('button[onclick="forceAdvanceSlot(1)"]').click();
    });

    await page.waitForFunction(
      () => {
        const gs = window.godApp.gameState;
        return gs.currentPhase && gs.currentPhase.slots && gs.currentPhase.slots['1'] !== 'setup';
      },
      { timeout: 10000 }
    );

    const after = await page.evaluate(() => {
      const gs = window.godApp.gameState;
      return { subPhase1: gs.currentPhase.slots[1], subPhase2: gs.currentPhase.slots[2] };
    });
    console.log('--- After clicking per-slot Force Advance (slot 1) ---');
    console.log(JSON.stringify(after, null, 2));

    assert(after.subPhase1 !== 'setup',
      `Slot 1 should have force-advanced past 'setup' despite the unmet requirement, got '${after.subPhase1}'`);
    assert(after.subPhase2 === 'setup',
      `Slot 2 was never clicked and must stay at 'setup', got '${after.subPhase2}'`);

    console.log('\nPart 2 (god.html) assertions passed.');
    allPassed = true;
  } finally {
    await wait(2000);
    await page.evaluate((orig) => {
      const gs = window.godApp.gameState;
      gs.currentPhase = orig.currentPhase;
      gs.lobbyReady = orig.lobbyReady;
      return window.godApp.saveGameState();
    }, original);
    console.log('Restored original currentPhase/lobbyReady on god.html.');
  }
  await page.close();
  return allPassed;
}

async function main() {
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const tournamentId = process.env.TEST_TOURNAMENT_ID || 'e2e-disposable-1';

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });
  let allPassed = false;

  try {
    const part1Passed = await part1_adminHtml(browser, baseUrl, tournamentId);
    const part2Passed = await part2_godHtml(browser, baseUrl, tournamentId);
    allPassed = part1Passed && part2Passed;
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
