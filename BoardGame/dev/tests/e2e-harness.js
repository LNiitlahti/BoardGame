const puppeteer = require('puppeteer');

async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#loginBtn:not([disabled])', { timeout: 15000 });
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

async function gotoTournamentPage(page, baseUrl, pageName, tournamentId, extraParams = '') {
  await page.goto(`${baseUrl}/${pageName}?tournamentId=${tournamentId}${extraParams}`, { waitUntil: 'networkidle0' });
}

module.exports = { login, newLoggedInPage, gotoTournamentPage, puppeteer };
