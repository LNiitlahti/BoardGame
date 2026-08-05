// e2e-full-flow.js — the first END-TO-END run of an entire tournament.
//
// Every other e2e-*.js script in this directory is a narrow single-feature or
// single-bug test that seeds synthetic state, pokes one function, asserts, and
// restores. None of them ever creates a tournament, links a player through the
// UI, advances a round, or finishes. This one does the whole arc:
//
//   accounts -> setup.html wizard -> link players (god.html) -> onboarding
//   -> round 1 (admin.html) -> round 2 (real earned-hex gating) -> undo
//   -> finish -> winner celebration (view.html)
//
// TWO PURPOSES:
//   1. Regression safety — one command proves the gameflow still works.
//   2. Documentation — screenshots at every meaningful state, on all five
//      pages, numbered so they sort into reading order for manuals/tutorials.
//      They land in dev/tests/screenshots/full-flow/ (gitignored).
//
// Runs against the REAL production Firebase project (no emulator), creating a
// fresh throwaway tournament `e2e-fullflow-<timestamp>` each run and LEAVING IT
// BEHIND for inspection. Nothing is deleted — deleting a tournament currently
// orphans its season references (see TODO.md), and keeping the artifact is what
// makes a failed run debuggable.
//
// USAGE (from BoardGame/):
//   node dev/tests/e2e-full-flow.js
//   node dev/tests/e2e-full-flow.js --rounds=3 --teams=5
//   node dev/tests/e2e-full-flow.js --headed --keep-open
//
// FLAGS:
//   --rounds=N     rounds to play (default 2; 2 is the minimum that exercises
//                  round-2 earned-hex gating, which round 1 cannot reach)
//   --teams=N      teams to create (default 5; wizard enforces >= 3, and
//                  .env.e2e's 14 standing accounts cap this at 7)
//   --fresh-accounts  mint brand-new disposable accounts instead of reusing
//                  PLAYER1-14 from .env.e2e. Rarely needed — see below — and
//                  Firebase Auth rate-limits rapid creation, so it is slow.
//   --headed       show the browser
//   --keep-open    on failure, leave the browser open for live inspection
//   --skip-undo    skip the undo chapter
//
// ON ACCOUNTS: this reuses the standing PLAYER1-14 accounts by default. The
// "burned uid" rule that forces other tests to mint fresh accounts
// ("User is already assigned in this tournament") is scoped to a SINGLE
// tournament's player registry — and this script creates a brand-new
// tournament every run, whose registry starts empty. So the standing accounts
// are always eligible here, and minting new ones just burns real auth users.
//
// EXPECT FAILURES ON THE FIRST RUN. This reaches states nothing has ever
// reached automatically; several TODO.md entries predict bugs exactly here
// (round-2 hex gating, the never-yet-run Undo path, view.html's blank phases).
// A failure in chapters 6-8 is a FINDING, not necessarily a test defect.

require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const {
  login, gotoTournamentPage, puppeteer,
  assert, sleep, screenshot, createDisposablePlayer, VIEWPORT
} = require('./e2e-harness');

// ── Config ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const ROUNDS = Number(flag('rounds', 2));
const TEAM_COUNT = Number(flag('teams', 5));
const HEADED = has('headed');
const KEEP_OPEN = has('keep-open');
const SKIP_UNDO = has('skip-undo');
const FRESH_ACCOUNTS = has('fresh-accounts');

const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TD_EMAIL = process.env.TD_EMAIL;
const TD_PASSWORD = process.env.TD_PASSWORD;

const RUN_TAG = Date.now();
const TOURNAMENT_ID = `e2e-fullflow-${RUN_TAG}`;

if (!TD_EMAIL || !TD_PASSWORD) {
  console.error('TD_EMAIL / TD_PASSWORD missing from dev/tests/.env.e2e');
  process.exit(1);
}
if (TEAM_COUNT < 3) {
  console.error('--teams must be >= 3 (setup.html wizard enforces this)');
  process.exit(1);
}
if (TEAM_COUNT > 7) {
  console.error('--teams must be <= 7 (.env.e2e provides 14 standing player accounts)');
  process.exit(1);
}
if (TEAM_COUNT !== 5) {
  // Not fatal — the wizard genuinely allows 3+ — but Auto-Generate will
  // refuse, so the match chapters cannot run. Worth saying up front rather
  // than failing five minutes in.
  console.warn(
    `\nWARNING: --teams=${TEAM_COUNT}. SmartMatchGenerator requires EXACTLY 5 teams\n` +
    `(smart-match-generator.js:302), so Auto-Generate will fail and this run will\n` +
    `stop at the first match slot. Use --teams=5 for a complete pass.\n`
  );
}

// Phase labels as rendered in #flowPhaseName (PHASE_LABELS in
// admin-improved-adapter.js). Used to know where the walker is.
const PHASE = {
  SETUP: 'Setup',
  VP: 'VP Scoring',
  HEX_SCORING: 'Hex Scoring',
  HEX1: 'Hex 1',
  SPELL1: 'Spells 1/4',
  HEX2: 'Hex 2',
  CHALLENGES: 'Challenges',
  BOARD: 'Board Check',
  MATCHES: 'Matches',
  ROUND_END: 'Round End',
  FINISHED: 'Finished'
};

let shotSeq = 0;
const shot = async (page, slug) => {
  shotSeq += 1;
  return screenshot(page, `${String(shotSeq).padStart(2, '0')}-${slug}`);
};

const log = (msg) => console.log(msg);
const chapter = (n, title) => console.log(`\n${'='.repeat(64)}\n  CH${n} — ${title}\n${'='.repeat(64)}`);

// ── Page helpers ──────────────────────────────────────────────────────────

/** Native dialogs appear in: setup upload alert, roster swap confirm,
 *  force-advance-slot, and finish-tournament. Must be registered before any
 *  navigation or the page hangs waiting for a human. */
function autoAcceptDialogs(page) {
  page.on('dialog', async (d) => {
    log(`    [dialog accepted] ${d.type()}: ${d.message().slice(0, 90)}`);
    try { await d.accept(); } catch { /* already handled */ }
  });
}

function trackPageErrors(page, label, sink) {
  page.on('pageerror', (err) => {
    sink.push(`${label}: ${err.message}`);
    log(`    [pageerror ${label}] ${err.message}`);
  });
}

// Firestore quota exhaustion (HTTP 429 / 'resource-exhausted') makes writes
// fail silently: adjustTeamPoints, saveGameState and friends catch the error
// and just showStatus(). Symptoms look exactly like a product bug ("points
// didn't apply", "phase won't advance") but the app is fine — the project is
// simply out of daily quota, which repeated runs of THIS script will do.
// Detect it so a quota wall never gets misreported as a regression.
const quotaHits = { count: 0 };
function trackQuotaErrors(page) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('resource-exhausted') || text.includes('RESOURCE_EXHAUSTED')) {
      quotaHits.count += 1;
    }
  });
}
function quotaBanner() {
  if (!quotaHits.count) return '';
  return `\n  !! FIRESTORE QUOTA EXHAUSTED (${quotaHits.count} resource-exhausted responses).\n` +
         `     Writes are being silently rejected, so failures above are very likely\n` +
         `     quota, NOT product bugs. Wait for the daily quota reset before re-running.\n`;
}

const flowPhase = (page) =>
  page.$eval('#flowPhaseName', el => el.textContent.trim()).catch(() => null);

const primaryLabel = (page) =>
  page.$eval('#flowPrimaryBtn', el => el.textContent.trim()).catch(() => null);

const primaryDisabled = (page) =>
  page.$eval('#flowPrimaryBtn', el => el.disabled).catch(() => true);

async function isModalOpen(page, id) {
  return page.evaluate((mid) => {
    const m = document.getElementById(mid);
    if (!m) return false;
    if (m.classList.contains('modal-overlay')) return m.classList.contains('active');
    return getComputedStyle(m).display !== 'none';
  }, id);
}

/** Most flow primaries route through #flowConfirmModal. Returns true if one
 *  was open and got confirmed. */
async function resolveFlowConfirm(page) {
  if (!(await isModalOpen(page, 'flowConfirmModal'))) return false;
  const title = await page.$eval('#flowConfirmTitle', el => el.textContent.trim()).catch(() => '');
  log(`    [confirm] ${title}`);
  await page.click('#flowConfirmBtn');
  await sleep(700);
  return true;
}

async function clickPrimary(page) {
  await page.waitForSelector('#flowPrimaryBtn:not([disabled])', { timeout: 15000 });
  const label = await primaryLabel(page);
  await page.click('#flowPrimaryBtn');
  await sleep(600);
  await resolveFlowConfirm(page);
  return label;
}

/**
 * Click the flow primary until #flowPhaseName reads `target`.
 *
 * The primary's real action is a JS closure (_primaryAction) that is not
 * inspectable from the DOM, so the only way to know where we are is to read
 * the rendered phase name. `onPhase` lets a caller do work (e.g. place hexes)
 * when a gate blocks the primary.
 */
async function walkToPhase(page, target, { maxSteps = 30, onPhase = null } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    const phase = await flowPhase(page);
    if (phase === target) return phase;

    if (onPhase) await onPhase(phase, page);

    if (await primaryDisabled(page)) {
      const pills = await page.$$eval('#flowActions .phase-req-item, #flowActions .req-unmet',
        els => els.map(e => e.textContent.trim())).catch(() => []);
      throw new Error(
        `Flow stuck at "${phase}" heading for "${target}": primary is disabled. Requirements: ${JSON.stringify(pills)}`
      );
    }

    const label = await clickPrimary(page);
    const now = await flowPhase(page);
    log(`    ${phase} --[${label}]--> ${now}`);
    if (now === phase) await sleep(800); // some transitions settle async
  }
  throw new Error(`walkToPhase: never reached "${target}" within ${maxSteps} steps (stuck at "${await flowPhase(page)}")`);
}

// ── CH1: disposable player accounts ───────────────────────────────────────

async function ch1CreatePlayers(browser, tdPage) {
  chapter(1, 'Player accounts');

  // One authentic capture of the real registration form for the manual...
  const reg = await browser.newPage();
  await reg.setViewport(VIEWPORT);
  await reg.goto(`${BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
  await reg.waitForSelector('#loginBtn:not([disabled])', { timeout: 20000 });
  await reg.evaluate(() => window.showRegister && window.showRegister());
  await sleep(400);
  await shot(reg, 'login-register-form');
  await reg.close();

  const needed = TEAM_COUNT * 2;
  const players = [];

  if (!FRESH_ACCOUNTS) {
    // Reuse the standing accounts. Their uids must be resolved from Firestore
    // (the env file only carries email/password), which the TD's already-
    // authenticated page can query directly.
    for (let i = 1; i <= needed; i++) {
      const email = process.env[`PLAYER${i}_EMAIL`];
      const password = process.env[`PLAYER${i}_PASSWORD`];
      assert(email && password,
        `PLAYER${i}_EMAIL/PASSWORD missing from .env.e2e — need ${needed} accounts for ${TEAM_COUNT} teams (max 7 teams)`);
      players.push({ name: `E2ePlayer${i}`, email, password, uid: null, envIndex: i });
    }

    // login() lands on index.html, which then redirects onward on its own.
    // Querying from there races the redirect and destroys the execution
    // context mid-evaluate — park on a stable authenticated page first.
    await tdPage.goto(`${BASE_URL}/full/home.html`, { waitUntil: 'domcontentloaded' });
    await tdPage.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
    await sleep(1200);

    const resolved = await tdPage.evaluate(async (emails) => {
      const db = firebase.firestore();
      const out = {};
      for (const email of emails) {
        const snap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!snap.empty) {
          const d = snap.docs[0].data();
          out[email] = { uid: snap.docs[0].id, displayName: d.displayName || d.firstName || null };
        }
      }
      return out;
    }, players.map(p => p.email));

    for (const p of players) {
      const hit = resolved[p.email];
      assert(hit && hit.uid, `no users/ doc found for ${p.email} — account may not be registered`);
      p.uid = hit.uid;
      if (hit.displayName) p.name = hit.displayName;
      log(`  reusing ${p.name} <${p.email}> (${p.uid})`);
    }
    log(`  ${players.length} standing accounts resolved`);
    return players;
  }

  // --fresh-accounts: mint new ones. Firebase Auth rate-limits rapid
  // creation, so this is paced deliberately.
  for (let i = 1; i <= needed; i++) {
    const p = await createDisposablePlayer(browser, BASE_URL, `Ff${RUN_TAG}p${i}`);
    players.push(p);
    log(`  created ${p.name} (${p.uid})`);
    await sleep(1500);
  }
  log(`  ${players.length} disposable accounts ready`);
  return players;
}

// ── CH2: tournament creation via the setup.html wizard ────────────────────

async function ch2CreateTournament(page, players) {
  chapter(2, 'Tournament creation (setup.html wizard)');

  await page.goto(`${BASE_URL}/full/setup.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#gamesGrid .game-card').length > 0, { timeout: 15000 });

  // Step 1 — games
  await page.evaluate(() => {
    const cards = document.querySelectorAll('#gamesGrid .game-card');
    for (let i = 0; i < Math.min(3, cards.length); i++) cards[i].click();
  });
  await sleep(300);
  await shot(page, 'setup-step1-games');
  await page.click('#nextBtn');
  await sleep(400);

  // Step 2 — teams (2 named players each; wizard requires >= 3 teams, all named)
  await page.evaluate((count) => {
    for (let i = 0; i < count; i++) window.addTeam();
  }, TEAM_COUNT);
  await sleep(400);
  await page.evaluate((names) => {
    // updateTeam(idx, field, value) is the wizard's own state setter — driving
    // it directly is equivalent to typing, and immune to re-render races that
    // would drop keystrokes when renderTeams() rebuilds the inputs.
    names.forEach((pair, idx) => {
      window.updateTeam(idx, 'name', pair.teamName);
      window.updateTeam(idx, 'player1', pair.p1);
      window.updateTeam(idx, 'player2', pair.p2);
    });
  }, Array.from({ length: TEAM_COUNT }, (_, i) => ({
    teamName: `E2E Team ${i + 1}`,
    p1: players[i * 2].name,
    p2: players[i * 2 + 1].name
  })));
  await sleep(400);
  await shot(page, 'setup-step2-teams');
  await page.click('#nextBtn');
  await sleep(600);

  // Step 3 — rooms. Local default deliberately: the Firestore-backed
  // "Lataa Oletushuoneet" reads one GLOBAL config/defaultRooms doc shared by
  // every tournament ever created, which TODO.md flags as unreliable.
  await page.waitForSelector('#roomSetupBoard [data-coord]', { timeout: 15000 });
  await page.evaluate(() => window.loadLocalDefaultRoomsSetup());
  await sleep(600);
  const roomCount = await page.$eval('#roomCountBadge', el => el.textContent.trim());
  log(`  rooms: ${roomCount}`);
  await shot(page, 'setup-step3-rooms');
  await page.click('#nextBtn');
  await sleep(400);

  // Step 4 — spells (review only)
  await shot(page, 'setup-step4-spells');
  await page.click('#nextBtn');
  await sleep(400);

  // Step 5 — create
  await page.type('#tournamentId', TOURNAMENT_ID);
  await page.evaluate(() => { document.getElementById('winCondition').value = '15'; });
  await shot(page, 'setup-step5-summary');

  // uploadTournament() alerts on success then redirects to admin.html.
  // The dialog handler is already attached (autoAcceptDialogs).
  await page.evaluate(() => window.uploadTournament());
  await page.waitForFunction(
    (tid) => window.location.pathname.endsWith('/admin.html') && window.location.search.includes(tid),
    { timeout: 30000 }, TOURNAMENT_ID
  );
  log(`  tournament created: ${TOURNAMENT_ID}`);

  await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
  await sleep(2500);
  await shot(page, 'admin-fresh-tournament');
  return TOURNAMENT_ID;
}

// ── CH3: link real accounts into team slots (god.html) ────────────────────

async function ch3LinkPlayers(page, players) {
  chapter(3, 'Linking player accounts to team slots (god.html)');

  await gotoTournamentPage(page, BASE_URL, 'full/god.html', TOURNAMENT_ID);
  await page.waitForFunction(() => window.godApp && window.godApp.gameState && (window.godApp.gameState.teams || []).length > 0, { timeout: 25000 });

  await page.evaluate(() => window.switchGodTab('teams'));
  await sleep(800);
  await page.evaluate(() => window.loadUnassignedUsers && window.loadUnassignedUsers());
  await sleep(2500);
  await shot(page, 'god-teams-tab-unassigned');

  // Map each seeded placeholder slot to its intended real account, in the same
  // team/slot order the wizard created them.
  const slots = await page.evaluate(() => {
    const gs = window.godApp.gameState;
    return (gs.teams || []).map(t => ({
      teamId: t.id,
      teamName: t.name,
      playerIds: (t.players || []).map(p => p.id || p.playerId).filter(Boolean)
    }));
  });

  let linked = 0;
  for (let ti = 0; ti < slots.length; ti++) {
    for (let si = 0; si < slots[ti].playerIds.length; si++) {
      const player = players[ti * 2 + si];
      if (!player) continue;
      const playerId = slots[ti].playerIds[si];

      await page.evaluate((uid) => window.selectUserForAssignment(uid), player.uid);
      await sleep(250);

      if (linked === 0) {
        await shot(page, 'god-user-selected-for-assignment');
      }

      // The "Use X here" button is a bare onclick on an ASYNC function, so
      // page.click() returns before the Firestore write lands. Awaiting the
      // function directly is what the two existing tests that touch this do.
      await page.evaluate(
        async (teamId, pid) => { await window.replacePlayerWithUser(teamId, pid); },
        slots[ti].teamId, playerId
      );
      await sleep(900);
      linked++;
    }
  }
  log(`  linked ${linked} accounts`);

  await page.evaluate(() => window.loadUnassignedUsers && window.loadUnassignedUsers());
  await sleep(1500);
  await shot(page, 'god-teams-fully-linked');

  const check = await page.evaluate(() => {
    const gs = window.godApp.gameState;
    return {
      teams: (gs.teams || []).length,
      registryLinked: Object.values(gs.players || {}).filter(p => p.uid).length
    };
  });
  assert(check.registryLinked >= TEAM_COUNT * 2,
    `expected >= ${TEAM_COUNT * 2} linked registry players, got ${check.registryLinked}`);
  log(`  verified: ${check.teams} teams, ${check.registryLinked} linked players`);
}

// ── CH4: the player's own view ────────────────────────────────────────────

async function ch4PlayerView(browser, players, errorSink) {
  chapter(4, 'Player-facing pages (onboarding.html, team.html)');

  const p = players[0];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(VIEWPORT);
  autoAcceptDialogs(page);
  trackPageErrors(page, 'player', errorSink);

  try {
    await login(page, BASE_URL, p.email, p.password);
    await sleep(1500);
    await shot(page, 'player-home-after-login');

    await gotoTournamentPage(page, BASE_URL, 'full/team.html', TOURNAMENT_ID);
    await sleep(3000);
    await shot(page, 'team-page-pre-tournament');

    // Onboarding is public (no auth gate) and keyed by the player's registry id.
    const playerId = await page.evaluate(async (tid, uid) => {
      const doc = await firebase.firestore().collection('tournaments').doc(tid).get();
      const players = (doc.data() || {}).players || {};
      const hit = Object.values(players).find(pl => pl.uid === uid);
      return hit ? hit.id : null;
    }, TOURNAMENT_ID, p.uid);

    if (playerId) {
      await page.goto(`${BASE_URL}/full/onboarding.html?tournamentId=${TOURNAMENT_ID}&player=${playerId}`,
        { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      await shot(page, 'player-onboarding-checklist');
    } else {
      log('  WARN: could not resolve player registry id — onboarding shot skipped');
    }
    return { ctx, page, player: p, playerId };
  } catch (err) {
    await ctx.close();
    throw err;
  }
}

// ── Match slot cycle ──────────────────────────────────────────────────────

/** Latest user-facing status text, from either surface admin.html uses. */
async function statusText(page) {
  return page.evaluate(() => {
    const toast = document.querySelector('.toast-container .toast-content');
    if (toast && toast.textContent.trim()) return toast.textContent.trim();
    const el = document.getElementById('statusMessage');
    return el ? el.textContent.trim() : '(no status shown)';
  });
}

async function queueSize(page) {
  return page.evaluate(() => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    return gs && gs.gameQueue ? gs.gameQueue.length : 0;
  });
}

async function slotSubPhase(page, slot) {
  return page.evaluate((s) => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    return gs && gs.currentPhase && gs.currentPhase.slots ? gs.currentPhase.slots[s] : null;
  }, slot);
}

/**
 * Drive one match slot from `setup` all the way to `done`:
 *   Auto-Generate -> Open Lobby -> Force Ready -> Start -> Confirm -> Mark Done
 * Each step is the slot card's own primary button, whose label changes per
 * sub-phase (_computeSlotStep in admin-improved-adapter.js).
 */
async function runMatchSlot(page, slot, round, { screenshots = true } = {}) {
  log(`  -- slot ${slot} --`);

  for (let guard = 0; guard < 14; guard++) {
    const sub = await slotSubPhase(page, slot);
    if (sub === 'done') { log(`    slot ${slot}: done`); return; }

    const btnSel = `button[onclick="runSlotPrimaryAction(${slot})"]`;
    const btn = await page.$(btnSel);
    if (!btn) {
      await sleep(900);
      continue;
    }
    const label = await page.$eval(btnSel, el => el.textContent.trim());
    const disabled = await page.$eval(btnSel, el => el.disabled);

    // 'playing' with everything confirmed still needs the result recorded
    // first; the slot card only offers "Mark Done" once nothing is ongoing.
    if (sub === 'playing' && /start/i.test(label) === false && /done/i.test(label) === false) {
      await sleep(900);
      continue;
    }

    if (disabled) {
      // In 'playing', a live match must be resolved before the card advances.
      const resolved = await confirmAnyOngoingMatch(page, round, slot);
      if (resolved) continue;
      throw new Error(`slot ${slot} stuck in "${sub}" — primary "${label}" disabled with nothing to confirm`);
    }

    log(`    slot ${slot} [${sub}] -> ${label}`);

    if (screenshots && sub === 'setup' && guard === 0) await shot(page, `r${round}-slot${slot}-setup`);

    const queueBefore = await queueSize(page);
    await page.click(btnSel);
    await sleep(900);

    // Auto-Generate opens the balance-preview modal
    if (await isModalOpen(page, 'autoMatchModal')) {
      if (screenshots && guard === 0) await shot(page, `r${round}-slot${slot}-automatch-preview`);
      await page.evaluate(() => window.confirmAutoMatch());
      await sleep(1600);
    } else if (/auto-generate/i.test(label)) {
      // No preview modal means generateSuggestedMatches() bailed via
      // showStatus() — surface the real reason instead of silently retrying.
      // The most common cause is SmartMatchGenerator's hard "exactly 5 teams"
      // requirement (smart-match-generator.js:302).
      await sleep(700);
      if (await queueSize(page) === queueBefore) {
        throw new Error(`Auto-Generate produced no match for slot ${slot}. App said: "${await statusText(page)}"`);
      }
    }
    await resolveFlowConfirm(page);
    await sleep(700);

    if (screenshots && sub === 'lobby') await shot(page, `r${round}-slot${slot}-lobby-ready`);

    // Once started, record a winner so the slot can reach 'done'.
    const nowSub = await slotSubPhase(page, slot);
    if (nowSub === 'playing') {
      await confirmAnyOngoingMatch(page, round, slot, { screenshots });
    }
  }
  throw new Error(`slot ${slot} never reached 'done' (last sub-phase: ${await slotSubPhase(page, slot)})`);
}

/** Confirms the first ongoing match found, alternating the winning side by
 *  round so points spread across teams rather than piling onto side A. */
async function confirmAnyOngoingMatch(page, round, slot, { screenshots = false } = {}) {
  const ongoing = await page.evaluate(() => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    const live = (gs && gs.gameQueue || []).filter(m => m.status === 'ongoing' && !m.isBreak);
    return live.map(m => ({ id: m.id, matchNumber: m.matchNumber, sides: (m.teams || []).length }));
  });
  if (!ongoing.length) return false;

  const match = ongoing[0];
  const winnerIdx = (round + slot) % Math.max(1, match.sides);
  log(`    confirming match #${match.matchNumber} winner side ${winnerIdx}`);

  await page.evaluate((id) => window.openQuickConfirm(id), match.id);
  await sleep(800);
  if (screenshots) await shot(page, `r${round}-slot${slot}-confirm-result`);

  await page.evaluate(async (id, idx) => { await window.quickConfirmResult(id, idx); }, match.id, winnerIdx);
  await sleep(1800);
  await resolveFlowConfirm(page);
  await sleep(600);
  return true;
}

// ── Hex placement (the round-2+ gate) ─────────────────────────────────────

/**
 * Pending hex credits that the CURRENT phase can actually clear.
 *
 * Mirrors _relevantPendingWinsForPhase() in admin-improved-adapter.js:590 —
 * during hex_placement_1 only slot-1 (Match 1) credits are in scope, and
 * hex_placement_2 only sees slot-2. Getting this wrong is not a no-op: the
 * team picker routes an out-of-scope team down its "Wrong Team? / Assign
 * Anyway" path, which assigns the hex but deliberately does NOT clear the
 * credit — so the gate never opens and a hex is wasted.
 */
async function pendingHexWins(page, phaseLabel) {
  const slot = phaseLabel === PHASE.HEX1 ? 1 : phaseLabel === PHASE.HEX2 ? 2 : null;
  return page.evaluate((wantSlot) => (window.pendingHexWins || [])
    .filter(w => (w.teamIds || []).length > 0)
    .filter(w => wantSlot === null || w.slot === undefined || w.slot === wantSlot)
    .map(w => ({
      matchNumber: w.matchNumber,
      slot: w.slot === undefined ? null : w.slot,
      teamIds: (w.teamIds || []).map(String),
      teamNames: w.teamNames || []
    })), slot);
}

/**
 * Place every owed hex through the REAL team-picker UI, using the
 * "This Is Their Earned Placement — Assign" path. That path is the only one
 * that calls clearPendingHexWin() and therefore the only one that actually
 * clears the hex_placement gate — the sibling "Spell / Admin Claim" button
 * assigns the hex but deliberately keeps the credit.
 */
async function placePendingHexes(page, round, phaseLabel, { screenshots = true } = {}) {
  // A single pendingHexWins ENTRY can owe several teams at once (a match won
  // by a full team credits every team on the winning side), and
  // clearPendingHexWin() retires exactly one team per call. So progress has to
  // be measured in owed TEAMS, not entries — the entry survives until its last
  // team has placed.
  const owedTeams = (list) => list.reduce((n, w) => n + w.teamIds.length, 0);

  let pending = await pendingHexWins(page, phaseLabel);
  let owed = owedTeams(pending);
  if (!owed) { log(`    no pending hex placements in scope for ${phaseLabel}`); return 0; }

  log(`    ${owed} owed placement(s) in scope for ${phaseLabel}, across ${pending.length} match(es)`);
  let placed = 0;

  for (let guard = 0; guard < 16 && owed > 0; guard++) {
    const win = pending.find(w => w.teamIds.length > 0);
    if (!win) break;
    const teamId = win.teamIds[0];
    if (!teamId) break;

    const coord = await page.evaluate(() => {
      const hexes = Array.from(document.querySelectorAll('#hexBoard [data-coord]'));
      const free = hexes.find(h =>
        !h.classList.contains('occupied') &&
        !h.classList.contains('side-heart') &&
        !h.classList.contains('mountain-heart') &&
        !h.classList.contains('starting-location'));
      return free ? free.dataset.coord : null;
    });
    if (!coord) throw new Error('no free hex left on the board to place into');

    await page.evaluate((c) => window.handleHexClick(c), coord);
    await sleep(900);

    if (screenshots && placed === 0) await shot(page, `r${round}-hex-team-picker-earned`);

    // _augmentTeamPicker rewrites the owed team's button onclick to open the
    // earned/spell-claim confirm rather than assigning directly.
    const clicked = await page.evaluate((tid) => {
      const btns = Array.from(document.querySelectorAll('#teamPickerOptions .team-picker-btn'));
      const target = btns.find(b => (b.getAttribute('onclick') || '').includes(`, ${tid})`))
        || btns.find(b => b.querySelector('.pending-badge'));
      if (!target) return false;
      target.click();
      return true;
    }, teamId);
    if (!clicked) throw new Error(`team picker had no button for owed team ${teamId}`);
    await sleep(800);

    if (!(await isModalOpen(page, 'flowConfirmModal'))) {
      throw new Error(`no confirm modal after picking team ${teamId} — the picker did not treat it as owed`);
    }
    const confirmTitle = await page.$eval('#flowConfirmTitle', el => el.textContent.trim()).catch(() => '');
    // "Wrong Team?" means we picked a team this phase cannot clear; confirming
    // it would assign the hex and silently keep the credit.
    assert(/earned placement/i.test(confirmTitle),
      `expected the earned-placement prompt for team ${teamId}, got "${confirmTitle}"`);
    if (screenshots && placed === 0) await shot(page, `r${round}-hex-earned-placement-confirm`);
    await page.click('#flowConfirmBtn'); // "This Is Their Earned Placement — Assign"
    await sleep(1800);
    await page.evaluate(() => window.closeTeamPicker && window.closeTeamPicker());
    await sleep(600);

    placed++;
    pending = await pendingHexWins(page, phaseLabel);
    const nowOwed = owedTeams(pending);
    if (nowOwed >= owed) {
      throw new Error(
        `earned-placement did not clear the credit: still ${nowOwed} owed after placing for team ${teamId} ` +
        `(was ${owed}). The "This Is Their Earned Placement" path should call clearPendingHexWin().`
      );
    }
    owed = nowOwed;
  }

  log(`    placed ${placed} hex(es); ${owed} still owed`);
  return placed;
}

// ── CH5/6: play a round ───────────────────────────────────────────────────

async function playRound(page, viewPage, round) {
  chapter(round === 1 ? 5 : 5 + (round - 1), `Round ${round}`);

  const captureView = async (slug) => {
    if (!viewPage) return;
    try {
      await viewPage.bringToFront();
      await sleep(1200);
      await shot(viewPage, `r${round}-view-${slug}`);
      await page.bringToFront();
      await sleep(300);
    } catch (err) {
      log(`    WARN: view capture "${slug}" failed: ${err.message}`);
    }
  };

  // Walk the pre-match phases, handling the hex gates when they block.
  await walkToPhase(page, PHASE.MATCHES, {
    maxSteps: 30,
    onPhase: async (phase) => {
      const slug = phase.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await shot(page, `r${round}-admin-${slug}`);
      await captureView(slug);

      if ((phase === PHASE.HEX1 || phase === PHASE.HEX2) && await primaryDisabled(page)) {
        log(`    ${phase}: gate is blocking — placing earned hexes`);
        await placePendingHexes(page, round, phase);
      }
    }
  });

  await shot(page, `r${round}-admin-matches`);
  await captureView('matches');

  for (const slot of [1, 2]) {
    await runMatchSlot(page, slot, round);
  }
  await shot(page, `r${round}-admin-matches-both-done`);
  await captureView('matches-done');

  // Matches -> Round End -> (auto) -> VP Scoring of round N+1
  const phaseNow = await flowPhase(page);
  if (phaseNow === PHASE.MATCHES) {
    await clickPrimary(page);
    await sleep(2500);
  }
  log(`  round ${round} complete — now at "${await flowPhase(page)}"`);
}

// ── CH7: undo verification ────────────────────────────────────────────────

async function teamPoints(page, teamId) {
  return page.evaluate((tid) => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    const t = gs && (gs.teams || []).find(x => String(x.id) === String(tid));
    return t ? (t.points || 0) : null;
  }, teamId);
}

async function ch7Undo(page) {
  chapter(7, 'Undo Last Action');

  // Reload first. The round-advance that just ran leaves saveGameState()
  // writes in flight, and one of those landing on top of a points
  // transaction silently reverts it — which makes this chapter flaky and,
  // worse, would misreport as "undo is broken" when undo was never reached.
  await gotoTournamentPage(page, BASE_URL, 'full/admin.html', TOURNAMENT_ID);
  await page.waitForSelector('#flowPrimaryBtn', { timeout: 25000 });
  await sleep(4000);

  const before = await page.evaluate(() => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    const t = (gs.teams || [])[0];
    return t ? { id: t.id, points: t.points || 0 } : null;
  });
  assert(before, 'no team available for the undo test');

  // Click the real "+" button on the team card — a points adjustment is the
  // cleanest undo subject (single scalar, no cascade into history/queue).
  const plusSel = `button[onclick="adjustTeamPoints(${before.id}, 1, event)"]`;
  await page.waitForSelector(plusSel, { timeout: 15000 });
  await page.click(plusSel);

  const expectPoints = before.points + 1;
  await page.waitForFunction((teamId, want) => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    const t = gs && (gs.teams || []).find(x => String(x.id) === String(teamId));
    return t && (t.points || 0) === want;
  }, { timeout: 25000, polling: 300 }, before.id, expectPoints)
    .catch(async () => {
      const actual = await teamPoints(page, before.id);
      throw new Error(
        `points did not apply: expected ${expectPoints}, got ${actual}. ` +
        `App said: "${await statusText(page)}"${quotaHits.count ? ' — NOTE: Firestore quota is exhausted, this is almost certainly quota, not undo.' : ''}`
      );
    });
  const bumped = await teamPoints(page, before.id);
  log(`  points ${before.points} -> ${bumped}`);
  await shot(page, 'undo-before');

  await page.evaluate(() => window.undoLastAction());
  await sleep(2500);

  const modalOpen = await isModalOpen(page, 'undoConfirmModal');
  assert(modalOpen, 'undoConfirmModal did not open — Undo could not find an undoable action');
  await shot(page, 'undo-confirm-modal');

  await page.click('#undoConfirmModal .btn.danger');
  await page.waitForFunction((teamId, want) => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    const t = gs && (gs.teams || []).find(x => String(x.id) === String(teamId));
    return t && (t.points || 0) === want;
  }, { timeout: 20000, polling: 300 }, before.id, before.points)
    .catch(() => { /* fall through to the assertion below for a clearer message */ });

  const after = await teamPoints(page, before.id);
  await shot(page, 'undo-after');
  assert(after === before.points,
    `UNDO DID NOT REVERT: expected ${before.points}, got ${after}`);
  log(`  undo verified: points reverted ${bumped} -> ${after}`);
}

// ── CH8: finish + winner ──────────────────────────────────────────────────

async function ch8Finish(page, viewPage) {
  chapter(8, 'Finish tournament + winner celebration');

  // Every ranking surface sorts by `points` ALONE — it already contains the
  // +1 per match win as well as heart income (_getTeamTotalPoints() in
  // display-manager.js). This used to reproduce a `points + gamesWon` formula
  // to match the display; that formula was the double-count bug, fixed
  // 2026-08-05. Reproduce the display's real formula or this assertion
  // compares two different things.
  const standings = await page.evaluate(() => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    return (gs.teams || [])
      .map(t => ({
        name: t.name,
        points: t.points || 0,
        gamesWon: t.gamesWon || 0,
        total: t.points || 0
      }))
      .sort((a, b) => b.total - a.total);
  });
  log(`  standings:`);
  standings.forEach(s => log(`    ${s.name}: ${s.points} pts (${s.gamesWon} wins)`));

  // Each match win awards exactly +1 point (confirmResult in admin.js and
  // result-manager.js), so points can never be BELOW the win count. If it is,
  // admin.html has drifted back to incrementing gamesWon without points.
  standings.forEach(s => assert(s.points >= s.gamesWon,
    `${s.name} has ${s.points} pts but ${s.gamesWon} wins — a win did not award its +1 point`));

  // Heart income pays per match held through: side +1, mountain +2, per
  // scoring match, judged by each match's confirm-time control snapshot.
  // All seven hearts is 8 per match, so no payout can exceed 8 × the number
  // of scoring matches in the round it settles. A higher figure means income
  // is being paid more than once per heart-match.
  //
  // This is a bound, not an exact reconciliation: heartHexControl has moved on
  // since those payouts fired, so the exact per-round figure can't be replayed
  // from the final state. Exactness is covered by dev/tests/heart-income.test.js.
  const payouts = await page.evaluate(() => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    // Mirror calculateHeartIncome(): a match is a SLOT — a slot split into
    // several games still counts once. Untagged entries count individually.
    const matchesIn = (r) => {
      const keys = new Set();
      (gs?.gameHistory || []).forEach((e, i) => {
        if (!e || e.isChallenge || e.isBreak) return;
        if (e.roundNumber === null || e.roundNumber === undefined) return;
        if (Number(e.roundNumber) !== Number(r)) return;
        keys.add(e.slot !== null && e.slot !== undefined
          ? `slot:${e.slot}` : `entry:${e.matchNumber ?? i}`);
      });
      return keys.size;
    };
    return (gs?.pointsHistory || []).map(e => ({
      round: e.round,
      paid: e.pointsAwarded || {},
      // pointsHistory[].round is the round the payout FIRED in; it settles
      // the previous one (scoring_hex sits at the top of the new round).
      settledMatches: matchesIn((e.round || 0) - 1),
    }));
  });

  payouts.forEach(({ round, paid, settledMatches }) => {
    const cap = 8 * settledMatches;
    Object.entries(paid).forEach(([team, pts]) => {
      assert(pts <= cap,
        `round ${round}: ${team} was paid ${pts} heart income but the settled ` +
        `round had ${settledMatches} matches (all-hearts cap ${cap}) — income ` +
        `is being paid more than once per heart-match`);
    });
  });
  log(`  heart income within per-match bounds across ${payouts.length} payouts`);

  // view.html's live Hex Scoring panel must show what admin will actually
  // award. Both read calculateHeartIncome(); this proves they still agree.
  const adminPreview = await page.evaluate(() => {
    const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
    const bm = window.boardModule || (typeof boardModule !== 'undefined' ? boardModule : null);
    if (!gs || !bm || typeof calculateHeartIncome !== 'function') return null;
    const resolving = (gs.currentPhase?.roundNumber || 0) - 1;
    const { byTeam } = calculateHeartIncome(gs, bm, resolving);
    return Object.values(byTeam).reduce((sum, e) => sum + (e.points || 0), 0);
  });

  if (adminPreview !== null && viewPage) {
    const viewTotal = await viewPage.$$eval('.dm-hex-score-pts',
      els => els.reduce((sum, el) => sum + (parseInt(el.textContent.replace(/[^\d]/g, ''), 10) || 0), 0)
    ).catch(() => null);
    if (viewTotal !== null) {
      assert(viewTotal === adminPreview,
        `view.html's Hex Scoring panel shows ${viewTotal} total but admin computes ${adminPreview} — ` +
        `the preview and the payout have drifted apart`);
      log(`  view.html hex-scoring preview matches admin (${adminPreview})`);
    }
  }

  const topTotal = standings[0].total;
  const leaders = standings.filter(s => s.total === topTotal);
  const expectedWinner = standings[0];
  if (leaders.length > 1) {
    log(`  NOTE: ${leaders.length}-way tie at ${topTotal} — winner is whichever the display's sort settles on`);
  }

  // Nothing auto-ends a tournament: round_advance loops back to scoring_vp
  // forever, and admin's _checkWinCondition only raises a banner (its own
  // comment says it deliberately does not end the tournament). The TD ends it.
  await page.evaluate(() => window.endTournamentViaPhase());
  await sleep(3000);

  const phase = await flowPhase(page);
  assert(phase === PHASE.FINISHED, `expected phase "${PHASE.FINISHED}", got "${phase}"`);
  await shot(page, 'admin-tournament-finished');

  if (viewPage) {
    await viewPage.bringToFront();
    await sleep(3000);
    await shot(viewPage, 'view-winner-celebration');

    const winnerName = await viewPage.$eval('.dm-winner-name', el => el.textContent.trim()).catch(() => null);
    if (winnerName) {
      log(`  view.html winner: "${winnerName}"`);
      // With a tie at the top, any tied leader is a legitimate render — only
      // a winner from OUTSIDE the leader set is a real defect.
      assert(leaders.some(l => l.name === winnerName),
        `winner mismatch: view shows "${winnerName}", but leaders at ${topTotal} pts are ` +
        `[${leaders.map(l => l.name).join(', ')}]`);
      log(`  winner is a legitimate leader (${leaders.length > 1 ? 'tied' : 'outright'})`);

      // The spectator screen must show the SAME number admin's Teams column
      // shows. This is the regression guard for the double-count bug where
      // view.html ranked by points + gamesWon while admin showed raw points.
      const shownPts = await viewPage.$eval('.dm-winner-points', el => el.textContent.trim()).catch(() => null);
      if (shownPts !== null) {
        const shownNum = parseInt(String(shownPts).replace(/[^\d-]/g, ''), 10);
        const adminPts = standings.find(s => s.name === winnerName)?.points;
        log(`  view shows "${shownPts}" for ${winnerName}; admin has ${adminPts} pts`);
        assert(shownNum === adminPts,
          `SPECTATOR/ADMIN SCORE MISMATCH: view.html shows ${shownNum} for "${winnerName}" ` +
          `but admin gameState has ${adminPts}. Display code is adding gamesWon on top of points again.`);
        log('  spectator screen agrees with admin standings');
      }
    } else {
      log('  WARN: .dm-winner-name not found on view.html at tournament_end');
    }
  }

  // Stats page as a final documentation asset
  try {
    await page.goto(`${BASE_URL}/full/statistics.html?tournamentId=${TOURNAMENT_ID}`, { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    await shot(page, 'statistics-final');
  } catch (err) {
    log(`  WARN: statistics capture failed: ${err.message}`);
  }

  return expectedWinner;
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  log(`\nFULL FLOW E2E`);
  log(`  tournament : ${TOURNAMENT_ID}`);
  log(`  teams      : ${TEAM_COUNT}   rounds: ${ROUNDS}`);
  log(`  base url   : ${BASE_URL}\n`);

  const server = await startServer(path.resolve(__dirname, '..', '..'), PORT);
  const browser = await puppeteer.launch({
    headless: HEADED ? false : 'new',
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
    // Several evaluate() calls await real Firestore round-trips (account
    // lookups, saveGameState). The 180s default is tight enough to trip on a
    // slow connection mid-run and abort an otherwise-healthy pass.
    protocolTimeout: 300000
  });

  const pageErrors = [];
  let playerSession = null;
  let viewPage = null;
  let ok = false;

  const tdPage = await browser.newPage();
  await tdPage.setViewport(VIEWPORT);
  autoAcceptDialogs(tdPage);
  trackPageErrors(tdPage, 'admin', pageErrors);
  trackQuotaErrors(tdPage);

  try {
    chapter(0, 'Bootstrap');
    await login(tdPage, BASE_URL, TD_EMAIL, TD_PASSWORD);
    log('  TD logged in');

    const players = await ch1CreatePlayers(browser, tdPage);
    await ch2CreateTournament(tdPage, players);
    await ch3LinkPlayers(tdPage, players);
    playerSession = await ch4PlayerView(browser, players, pageErrors);

    // Spectator display, kept open in its own tab for per-phase capture.
    viewPage = await browser.newPage();
    await viewPage.setViewport(VIEWPORT);
    autoAcceptDialogs(viewPage);
    trackPageErrors(viewPage, 'view', pageErrors);
  trackQuotaErrors(viewPage);
    await gotoTournamentPage(viewPage, BASE_URL, 'full/view.html', TOURNAMENT_ID);
    await sleep(2500);

    // Back to admin and start the tournament proper.
    await tdPage.bringToFront();
    await gotoTournamentPage(tdPage, BASE_URL, 'full/admin.html', TOURNAMENT_ID);
    await sleep(3000);

    // #flowPrimaryBtn does not exist until the phase system is initialized —
    // before that the panel renders an init prompt instead.
    const needsInit = await tdPage.$('button[onclick="initializePhaseSystem()"]');
    if (needsInit) {
      log('  initializing phase system');
      await shot(tdPage, 'admin-initialize-flow-prompt');
      await tdPage.click('button[onclick="initializePhaseSystem()"]');
      await sleep(3000);
    }
    await tdPage.waitForSelector('#flowPrimaryBtn', { timeout: 20000 });
    await shot(tdPage, 'admin-flow-panel-ready');

    for (let round = 1; round <= ROUNDS; round++) {
      await playRound(tdPage, viewPage, round);
    }

    if (!SKIP_UNDO) {
      await ch7Undo(tdPage);
    } else {
      log('\n  (undo chapter skipped via --skip-undo)');
    }

    const winner = await ch8Finish(tdPage, viewPage);

    log(`\n${'='.repeat(64)}`);
    log(`  PASS — ${ROUNDS} round(s) played, winner: ${winner.name} (${winner.points} pts)`);
    log(`  tournament left behind for inspection: ${TOURNAMENT_ID}`);
    log(`  screenshots: dev/tests/screenshots/full-flow/ (${shotSeq} captured)`);
    if (quotaHits.count) log(quotaBanner());
    if (pageErrors.length) {
      log(`\n  ${pageErrors.length} page error(s) observed (non-fatal):`);
      pageErrors.slice(0, 15).forEach(e => log(`    - ${e}`));
    }
    log(`${'='.repeat(64)}\n`);
    ok = true;
  } catch (err) {
    console.error(`\nFAILED: ${err.message}\n`);
    if (quotaHits.count) console.error(quotaBanner());
    // A 10-minute run that dies at minute 8 must not lose its diagnostic state.
    for (const [label, pg] of [['admin', tdPage], ['view', viewPage], ['player', playerSession && playerSession.page]]) {
      if (!pg) continue;
      try { await screenshot(pg, `FAIL-${label}`); } catch { /* page may be dead */ }
    }
    try {
      const phase = await flowPhase(tdPage);
      const round = await tdPage.evaluate(() => {
        const gs = window.gameState || (typeof gameState !== 'undefined' ? gameState : null);
        return gs && gs.currentPhase ? gs.currentPhase.roundNumber : null;
      });
      console.error(`  state at failure: phase="${phase}" round=${round} tournament=${TOURNAMENT_ID}`);
    } catch { /* ignore */ }
    if (pageErrors.length) {
      console.error(`  page errors:\n${pageErrors.map(e => `    - ${e}`).join('\n')}`);
    }
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (playerSession) { try { await playerSession.ctx.close(); } catch { /* noop */ } }
    if (!(KEEP_OPEN && !ok)) {
      await browser.close();
    } else {
      log('  --keep-open: browser left running for inspection (ctrl-C to exit)');
    }
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
