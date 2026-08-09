// e2e-readme-shots.js — one-off extra captures for README screenshots that
// e2e-full-flow.js doesn't take: a clean sign-in view (full-flow only ever
// shows the register tab, reached via a referralCode link) and the room
// layout page (view-onboarding-layout.html), against a tournament already
// left behind by a prior full-flow run.
//
// USAGE (from BoardGame/):
//   node dev/tests/e2e-readme-shots.js --tournamentId=e2e-fullflow-<id>

require('dotenv').config({ path: __dirname + '/.env.e2e' });
const { startServer } = require('./e2e-server');
const { login, gotoTournamentPage, puppeteer, screenshot, sleep, VIEWPORT } = require('./e2e-harness');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const TOURNAMENT_ID = flag('tournamentId');
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TD_EMAIL = process.env.TD_EMAIL;
const TD_PASSWORD = process.env.TD_PASSWORD;

if (!TOURNAMENT_ID) {
  console.error('--tournamentId=... required');
  process.exit(1);
}

(async () => {
  const server = await startServer(require('path').resolve(__dirname, '..', '..'), PORT);
  const browser = await puppeteer.launch({ headless: true });
  try {
    // Clean sign-in view — no referralCode param, so it stays on the
    // default "Sign In" tab instead of jumping to "Create Account".
    const loginPage = await browser.newPage();
    await loginPage.setViewport(VIEWPORT);
    await loginPage.goto(`${BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
    await loginPage.waitForSelector('#loginBtn:not([disabled])', { timeout: 20000 });
    await sleep(500);
    await screenshot(loginPage, '52-login-signin-clean', 'full-flow');
    await loginPage.close();

    // Room layout — view-onboarding-layout.html, logged in as TD.
    const tdPage = await browser.newPage();
    await tdPage.setViewport(VIEWPORT);
    await login(tdPage, BASE_URL, TD_EMAIL, TD_PASSWORD);
    await gotoTournamentPage(tdPage, BASE_URL, 'full/view-onboarding-layout.html', TOURNAMENT_ID);
    await sleep(2000);
    await screenshot(tdPage, '53-room-layout', 'full-flow');
    await tdPage.close();

    console.log('done');
  } finally {
    await browser.close();
    server.close();
  }
})();
