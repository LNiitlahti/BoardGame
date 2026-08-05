/**
 * Dump a tournament's actionLog subcollection plus the scoring-relevant
 * slice of its gameState, so scoring incidents can be diagnosed from the
 * actual event record instead of console-paste archaeology.
 *
 * Usage:  node dev/tests/e2e-inspect-actionlog.js <tournamentId>
 *         (defaults to TEST_TOURNAMENT_ID from .env.e2e)
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, puppeteer } = require('./e2e-harness');

const TOURNAMENT_ID = process.argv[2] || process.env.TEST_TOURNAMENT_ID;

(async () => {
  const server = await startServer(path.resolve(__dirname, '..', '..'), 8080);
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await login(page, process.env.BASE_URL, process.env.TD_EMAIL, process.env.TD_PASSWORD);

    const data = await page.evaluate(async (tid) => {
      const ref = firebase.firestore().collection('tournaments').doc(tid);
      const doc = await ref.get();
      if (!doc.exists) return { error: `tournament "${tid}" not found` };
      const gs = doc.data();

      const logSnap = await ref.collection('actionLog')
        .orderBy('sequence', 'asc')
        .get();
      const actionLog = logSnap.docs.map(d => {
        const a = d.data();
        return {
          seq: a.sequence,
          at: a.timestamp?.toDate ? a.timestamp.toDate().toISOString() : a.timestamp,
          type: a.actionType,
          category: a.category,
          payload: a.payload,
        };
      });

      return {
        actionLog,
        teams: (gs.teams || []).map(t => ({
          id: t.id, name: t.name, color: t.color, points: t.points || 0,
          gamesWon: t.gamesWon || 0, gamesLost: t.gamesLost || 0,
        })),
        phase: gs.currentPhase,
        heartHexControl: gs.heartHexControl || {},
        pointsHistory: gs.pointsHistory || [],
        gameHistory: (gs.gameHistory || []).map(e => ({
          match: e.matchNumber, round: e.roundNumber, slot: e.slot,
          challenge: !!e.isChallenge, winners: e.winningTeamIds, losers: e.losingTeamIds,
          at: e.timestamp,
        })),
      };
    }, TOURNAMENT_ID);

    console.log(JSON.stringify(data, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})();
