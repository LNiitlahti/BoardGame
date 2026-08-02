require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { newLoggedInPage, puppeteer } = require('./e2e-harness');

(async () => {
  const server = await startServer(path.resolve(__dirname, '..', '..'), 8080);
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await newLoggedInPage(browser, process.env.BASE_URL, process.env.TD_EMAIL, process.env.TD_PASSWORD);
    await page.waitForNetworkIdle({ idleTime: 1000 });
    await page.screenshot({ path: __dirname + '/smoke-home.png' });
    console.log('LOGIN OK, screenshot saved');
  } finally {
    await browser.close();
    server.close();
  }
})();
