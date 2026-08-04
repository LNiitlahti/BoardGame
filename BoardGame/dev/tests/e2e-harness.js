const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Puppeteer's default 800x600 is below the navbar's mobile breakpoint, which
// silently swaps the desktop nav for a hamburger and breaks any test that
// clicks a nav link. 1920x1080 also matches the venue display resolution, so
// screenshots taken at this size are usable as-is in manuals.
const VIEWPORT = { width: 1920, height: 1080 };

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Screenshots land in dev/tests/screenshots/<subdir>/. That path is already
// covered by .gitignore's `screenshots/` rule, so captures stay local
// artifacts rather than repo bloat.
function screenshotDir(subdir = 'full-flow') {
  const dir = path.resolve(__dirname, 'screenshots', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function screenshot(page, name, subdir = 'full-flow') {
  const file = path.join(screenshotDir(subdir), `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  [shot] ${path.relative(path.resolve(__dirname, '..', '..'), file)}`);
  return file;
}

// networkidle0 is unreliable here too: firebase-loader.js signs in an
// anonymous user and Firestore/Auth can keep connections open, so waiting
// for 0 active network connections can hang intermittently (observed:
// consistent 30s navigation timeouts once several tabs/logins had already
// run in the same process). domcontentloaded + waiting for the actual
// readiness signal (#loginBtn enabling) is the reliable combination.
async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginBtn:not([disabled])', { timeout: 20000 });
  await page.type('#loginEmail', email);
  await page.type('#loginPassword', password);
  await page.click('#loginBtn');
  await page.waitForFunction(
    () => window.location.pathname.endsWith('/index.html'),
    { timeout: 15000 }
  );
}

async function newLoggedInPage(browser, baseUrl, email, password) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await login(page, baseUrl, email, password);
  return page;
}

// Mints a brand-new disposable auth user + users/{uid} doc, in its own
// isolated browser context so it never disturbs an already-logged-in session
// in another tab. Bypasses the register form deliberately: registration
// requires an unused referralCode doc, which would have to be seeded per
// account. Callers should pass a timestamped name — a uid that has ever
// appeared in a tournament's player registry is permanently refused on
// re-link ("User is already assigned in this tournament").
async function createDisposablePlayer(browser, baseUrl, name) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    const email = `lniitlahti+${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@gmail.com`;
    const password = `!E2e${name}Pass1`;
    await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });
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
    return { name, email, password, uid };
  } finally {
    await context.close();
  }
}

// networkidle0 never resolves on tournament pages (god/admin/team/view): they
// open persistent Firestore realtime-listener connections that keep the
// network "busy" forever, so waiting for 0 active connections can hang or
// resolve inconsistently depending on timing. domcontentloaded + an explicit
// wait for the Firebase SDK global is the reliable signal instead.
async function gotoTournamentPage(page, baseUrl, pageName, tournamentId, extraParams = '') {
  await page.goto(`${baseUrl}/${pageName}?tournamentId=${tournamentId}${extraParams}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof firebase !== 'undefined' && !!window.firebaseDB, { timeout: 20000 });
}

module.exports = {
  login, newLoggedInPage, gotoTournamentPage, puppeteer,
  assert, sleep, screenshot, screenshotDir, createDisposablePlayer, VIEWPORT
};
