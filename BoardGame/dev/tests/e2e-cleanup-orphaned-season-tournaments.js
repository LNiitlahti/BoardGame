/**
 * e2e-cleanup-orphaned-season-tournaments.js — one-off cleanup utility for
 * season docs whose `tournamentIds[]` array references tournaments that have
 * since been deleted.
 *
 * Root cause (NOT fixed here — tracked in TODO.md for a later code fix):
 * tournament deletion (god-app.js's deleteTournamentFromList and home.html's
 * deleteTournamentConfirm) does a bare `tournaments/{id}.delete()` and never
 * calls SeasonManager.removeTournamentFromSeason, so a season's
 * `tournamentIds[]` (and the reverse `seasonId` pointer, though that doc is
 * already gone) is left with dangling IDs pointing at nothing. The season UI
 * then falls back to showing a truncated raw doc ID instead of a name for
 * those entries.
 *
 * This script does NOT touch that live deletion logic — it's a standalone
 * reusable tool that inspects every season's `tournamentIds[]`, checks which
 * referenced tournament docs no longer exist, and removes just those dead
 * IDs from the array (arrayRemove), leaving live tournament references
 * untouched.
 *
 * SAFETY: this script NEVER writes to the `tournaments` collection — it
 * only reads tournament docs (to check existence) and only ever calls
 * `.update()` on `seasons/{id}` docs to arrayRemove already-nonexistent
 * IDs. A tournament is only ever "orphaned" if its doc is gone entirely;
 * an archived tournament (status: 'archived') is still a real, existing
 * doc, so it can never be flagged or touched by this script, regardless
 * of mode. Archived tournaments must never be deleted or unlinked by any
 * tool — this script structurally cannot do that, and re-verifies
 * non-existence immediately before each write as a belt-and-suspenders
 * check against race conditions.
 *
 * Usage:
 *   node dev/tests/e2e-cleanup-orphaned-season-tournaments.js [--apply] [--season=<seasonId>]
 *
 * Without --apply this is a dry run: it prints what WOULD change and writes
 * nothing. Use --season=<seasonId> to limit the scan to a single season
 * (matches season doc ID, not name); omit it to scan every season.
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, puppeteer } = require('./e2e-harness');

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const seasonArg = argv.find(a => a.startsWith('--season='));
  const seasonId = seasonArg ? seasonArg.split('=')[1] : null;
  return { apply, seasonId };
}

async function main() {
  const { apply, seasonId } = parseArgs(process.argv);

  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });

  try {
    const page = await browser.newPage();
    await login(page, baseUrl, process.env.TD_EMAIL, process.env.TD_PASSWORD);

    const result = await page.evaluate(async (applyFlag, seasonIdFilter) => {
      const db = firebase.firestore();

      let seasonDocs;
      if (seasonIdFilter) {
        const snap = await db.collection('seasons').doc(seasonIdFilter).get();
        if (!snap.exists) return { error: `Season "${seasonIdFilter}" not found.` };
        seasonDocs = [snap];
      } else {
        const snap = await db.collection('seasons').get();
        seasonDocs = snap.docs;
      }

      const seasons = seasonDocs.map(d => ({ id: d.id, ...d.data() }));

      // Collect every tournamentId referenced by any in-scope season, then
      // check existence in one batch of doc reads.
      const allTids = new Set();
      seasons.forEach(s => (s.tournamentIds || []).forEach(tid => allTids.add(tid)));

      const existence = {};
      await Promise.all([...allTids].map(async tid => {
        const snap = await db.collection('tournaments').doc(tid).get();
        existence[tid] = snap.exists;
      }));

      const report = [];
      for (const season of seasons) {
        const tournamentIds = season.tournamentIds || [];
        const orphaned = tournamentIds.filter(tid => !existence[tid]);
        if (orphaned.length === 0) continue;
        report.push({
          seasonId: season.id,
          seasonName: season.name,
          totalTournamentIds: tournamentIds.length,
          orphanedIds: orphaned
        });
      }

      if (!applyFlag) {
        return { dryRun: true, seasonsScanned: seasons.length, affectedSeasons: report };
      }

      for (const entry of report) {
        // Belt-and-suspenders re-verify immediately before writing: re-check
        // each id still doesn't exist, so a tournament created/restored
        // between the scan and this write is never removed.
        const stillOrphaned = [];
        for (const tid of entry.orphanedIds) {
          const snap = await db.collection('tournaments').doc(tid).get();
          if (!snap.exists) stillOrphaned.push(tid);
        }
        if (stillOrphaned.length === 0) continue;

        const seasonRef = db.collection('seasons').doc(entry.seasonId);
        await seasonRef.update({
          tournamentIds: firebase.firestore.FieldValue.arrayRemove(...stillOrphaned),
          updatedAt: new Date().toISOString()
        });
        entry.actuallyRemoved = stillOrphaned;
      }

      return { dryRun: false, seasonsScanned: seasons.length, affectedSeasons: report };
    }, apply, seasonId);

    if (result.error) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    if (result.dryRun) {
      const orphanedCount = result.affectedSeasons.reduce((sum, s) => sum + s.orphanedIds.length, 0);
      console.log(`\nDry run only — found ${orphanedCount} orphaned tournament ID(s) across ${result.affectedSeasons.length} season(s) (of ${result.seasonsScanned} scanned). Re-run with --apply to write changes.`);
    } else {
      const removedCount = result.affectedSeasons.reduce((sum, s) => sum + (s.actuallyRemoved?.length || 0), 0);
      console.log(`\nApplied: removed ${removedCount} orphaned tournament ID(s) across ${result.affectedSeasons.length} season(s). (Existing/live tournament docs, including any archived ones, are never written to by this script.)`);
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
