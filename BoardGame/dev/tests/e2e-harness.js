const puppeteer = require('puppeteer');

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
  await login(page, baseUrl, email, password);
  return page;
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

module.exports = { login, newLoggedInPage, gotoTournamentPage, puppeteer };
