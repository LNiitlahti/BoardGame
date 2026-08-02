require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { login, puppeteer } = require('./e2e-harness');

(async () => {
  const server = await startServer(path.resolve(__dirname, '..', '..'), 8080);
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await login(page, process.env.BASE_URL, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    const data = await page.evaluate(async (tid) => {
      const doc = await firebase.firestore().collection('tournaments').doc(tid).get();
      return doc.data();
    }, process.env.TEST_TOURNAMENT_ID);
    console.log(JSON.stringify({
      teams: data.teams?.map(t => ({ id: t.id, name: t.name, players: t.players?.map(p => ({ id: p.id, uid: p.uid, name: p.name })) })),
      playersRegistryCount: Object.keys(data.players || {}).length,
      players: data.players,
    }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})();
