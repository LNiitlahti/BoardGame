/**
 * e2e-cleanup-stale-queue.js — one-time-per-tournament cleanup utility for
 * the "match slot never reaches done" bug (see TODO.md's "CONFIRMED (not
 * just a leftover-data caveat anymore)" entry).
 *
 * Root cause (fixed separately in phase-manager.js/admin-improved-adapter.js):
 * a queue entry with no `slot` tag (created before slot-tagging existed, or
 * via a creation path — e.g. god.html — that never tags at all) counted as
 * pending/ongoing for BOTH match slots FOREVER, because "roundNumber is
 * undefined" was treated as "safe, always relevant." A tournament used
 * across a long build-out (e.g. cl32-smoke-test, ~61 leftover matches)
 * accumulates a permanent backlog that blocks every future round.
 *
 * This script does NOT touch that live logic — it's a standalone reusable
 * tool that inspects and cleans up an EXISTING tournament's `gameQueue`,
 * using the identical staleness definition as the code fix:
 *
 *   - Tagged entry (entry.slot !== undefined): stale if entry.roundNumber is
 *     defined and does not match the tournament's current round.
 *   - Untagged entry (entry.slot === undefined): stale if it has no
 *     createdAt, the tournament has no currentPhase.startedAt, or its
 *     createdAt predates the current matches-in-progress phase's startedAt
 *     (i.e. it was NOT created during the round currently in progress).
 *
 * Only entries whose `status` is pending/queued/undefined/ongoing are
 * candidates — completed matches are already harmless and left alone.
 * Breaks (isBreak) and challenge matches (isChallenge === true) are never
 * touched; the slot-blocking bug only affects regular (non-challenge) slot
 * matches.
 *
 * Usage:
 *   node dev/tests/e2e-cleanup-stale-queue.js <tournamentId> [--apply] [--mode=retag|purge]
 *
 * Modes:
 *   retag (default) — leaves stale entries in gameQueue but flips their
 *     status to 'archived_stale' (+ archivedAt/archivedReason), so they stop
 *     matching any pending/ongoing filter anywhere in the app while staying
 *     around for audit/debugging.
 *   purge — removes stale entries from gameQueue entirely.
 *
 * Without --apply this is a dry run: it prints what WOULD change and writes
 * nothing. Safety: refuses to run against cl32-smoke-test or fast-test-2 —
 * this plan's tournament-safety decision keeps real/shared event
 * tournaments out of scope; run it against a disposable test tournament
 * instead (see BoardGame/dev/tests/.env.e2e's TEST_TOURNAMENT_ID /
 * E2E_HARNESS.md).
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, puppeteer } = require('./e2e-harness');

const BLOCKED_TOURNAMENT_IDS = new Set(['cl32-smoke-test', 'fast-test-2']);

function parseArgs(argv) {
  const tournamentId = argv[2];
  const apply = argv.includes('--apply');
  const modeArg = argv.find(a => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'retag';
  return { tournamentId, apply, mode };
}

async function main() {
  const { tournamentId, apply, mode } = parseArgs(process.argv);

  if (!tournamentId) {
    console.error('Usage: node dev/tests/e2e-cleanup-stale-queue.js <tournamentId> [--apply] [--mode=retag|purge]');
    process.exit(1);
  }
  if (BLOCKED_TOURNAMENT_IDS.has(tournamentId)) {
    console.error(`Refusing to run against "${tournamentId}" — this plan explicitly keeps real/shared event tournaments out of scope. Use a disposable test tournament.`);
    process.exit(1);
  }
  if (mode !== 'retag' && mode !== 'purge') {
    console.error(`Unknown --mode="${mode}" (expected "retag" or "purge")`);
    process.exit(1);
  }

  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });

  try {
    const page = await browser.newPage();
    await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);

    const result = await page.evaluate(async (tid, applyFlag, modeArg) => {
      const db = firebase.firestore();
      const ref = db.collection('tournaments').doc(tid);
      const snap = await ref.get();
      if (!snap.exists) {
        return { error: `Tournament "${tid}" not found.` };
      }
      const data = snap.data();
      const queue = data.gameQueue || [];
      const currentRoundNumber = data.currentPhase?.roundNumber;
      const phaseStartedAt = data.currentPhase?.startedAt;

      const ACTIVE_STATUSES = new Set(['pending', 'queued', undefined, 'ongoing']);

      function isStale(m) {
        if (m.isBreak || m.isChallenge === true) return false;
        if (!ACTIVE_STATUSES.has(m.status)) return false;
        if (m.slot !== undefined) {
          return m.roundNumber !== undefined && m.roundNumber !== currentRoundNumber;
        }
        if (!m.createdAt || !phaseStartedAt) return true;
        return m.createdAt < phaseStartedAt;
      }

      const staleEntries = queue.filter(isStale);
      const summary = staleEntries.map(m => ({
        id: m.id, matchNumber: m.matchNumber, game: m.game, status: m.status,
        slot: m.slot, roundNumber: m.roundNumber, createdAt: m.createdAt
      }));

      if (!applyFlag) {
        return {
          dryRun: true,
          currentRoundNumber, phaseStartedAt,
          totalQueueLength: queue.length,
          staleCount: staleEntries.length,
          staleEntries: summary
        };
      }

      let newQueue;
      if (modeArg === 'purge') {
        const staleIds = new Set(staleEntries.map(m => m.id));
        newQueue = queue.filter(m => !staleIds.has(m.id));
      } else {
        const nowIso = new Date().toISOString();
        const staleIds = new Set(staleEntries.map(m => m.id));
        newQueue = queue.map(m => staleIds.has(m.id)
          ? { ...m, status: 'archived_stale', archivedAt: nowIso, archivedReason: 'stale/untagged queue entry from a prior round — cleaned up by e2e-cleanup-stale-queue.js' }
          : m);
      }

      await ref.update({ gameQueue: newQueue });

      return {
        dryRun: false,
        mode: modeArg,
        currentRoundNumber, phaseStartedAt,
        totalQueueLengthBefore: queue.length,
        totalQueueLengthAfter: newQueue.length,
        staleCount: staleEntries.length,
        staleEntries: summary
      };
    }, tournamentId, apply, mode);

    if (result.error) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    if (result.dryRun) {
      console.log(`\nDry run only — found ${result.staleCount} stale entries out of ${result.totalQueueLength}. Re-run with --apply --mode=${mode} to write changes.`);
    } else {
      console.log(`\nApplied (${result.mode}): ${result.staleCount} stale entries handled. Queue length ${result.totalQueueLengthBefore} -> ${result.totalQueueLengthAfter}.`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
