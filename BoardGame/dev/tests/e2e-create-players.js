// Creates additional disposable player accounts (auth user + users/{uid} doc)
// directly via Firestore/Auth calls, bypassing the referral-code-gated UI
// registration form (this is dev/test tooling, not exercising that flow).
// Runs each account creation in its own isolated incognito-style browser
// context so it never touches the TD's already-logged-in session/storage.
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const { startServer } = require('./e2e-server');
const { puppeteer } = require('./e2e-harness');

const NAMES = process.argv.slice(2);
if (NAMES.length === 0) {
  console.error('Usage: node e2e-create-players.js <displayName1> [displayName2] ...');
  process.exit(1);
}

(async () => {
  const server = await startServer(path.resolve(__dirname, '..', '..'), Number(process.env.E2E_PORT) || 8080);
  const browser = await puppeteer.launch({ headless: 'new' });
  const results = [];
  try {
    for (const name of NAMES) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const email = `lniitlahti+${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@gmail.com`;
      const password = `!E2e${name}Pass1`;
      await page.goto(`${process.env.BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
      const uid = await page.evaluate(async (email, password, name) => {
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;
        await firebase.firestore().collection('users').doc(uid).set({
          uid, email,
          firstName: name, lastName: 'E2E',
          displayName: name, fullName: `${name} E2E`,
          isAdmin: false, isSuperAdmin: false, isGod: false,
          assignedTournamentId: null, assignedTeamId: null, assignedTeamName: null,
          appointedAt: null, appointedBy: null,
          createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(),
          referralCode: 'e2e-disposable-script'
        });
        return uid;
      }, email, password, name);
      results.push({ name, email, password, uid });
      console.log(`Created ${name}: ${email} (${uid})`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + JSON.stringify(results, null, 2));
})();
