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
    const data = await page.evaluate(async (email) => {
      const snap = await firebase.firestore().collection('users').where('email', '==', email).limit(1).get();
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    }, process.env.PLAYER1_EMAIL);
    console.log(JSON.stringify(data, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})();
