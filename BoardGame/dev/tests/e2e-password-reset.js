/**
 * e2e-password-reset.js — coverage for the forgot-password flow on login.html.
 *
 * Before this, login.html had no recovery path at all: the sign-in card went
 * straight from the password field to the Sign In button, and no file in the
 * repo called sendPasswordResetEmail. A player who forgot their password had
 * no self-serve route and admins had none either (user-management.js only
 * accepts a password at user CREATION — the field is hidden when editing an
 * existing user), so the only fix was the Firebase Console. That matters now
 * that these are real personal accounts rather than shared placeholder links.
 *
 * What this test drives is the WIRING, not delivery. It stubs
 * `firebase.auth().sendPasswordResetEmail` so no real mail is sent and the
 * test stays hermetic — which means a green run does NOT prove a player will
 * actually receive anything. Deliverability depends on the Firebase Console's
 * password-reset template being enabled and the sender address surviving spam
 * filters; both are outside the code and must be confirmed by sending one real
 * email before the event.
 *
 * Stubbing works by replacing the method on the Auth instance after
 * firebase-ready has fired: login.html's inline script holds `auth` from
 * `firebase.auth()`, and that returns the same singleton, so patching the
 * instance is visible to the page's own reference.
 *
 * Assertions:
 *   1. The "Forgot password?" link exists in the login card.
 *   2. Clicking it swaps to the reset card and carries over the email already
 *      typed into #loginEmail (a player who just failed a sign-in shouldn't
 *      retype it — this is the whole point of the prefill).
 *   3. Submitting calls sendPasswordResetEmail with exactly that address.
 *   4. The confirmation is the deliberately GENERIC wording. With email
 *      enumeration protection on (the Firebase default) the call resolves for
 *      unknown addresses too, so a message asserting the account exists would
 *      be wrong a good share of the time. Asserted explicitly so a later
 *      "friendlier" rewrite that leaks account existence fails here.
 *   5. auth/too-many-requests renders its specific message rather than the
 *      generic fallback — the realistic failure at a venue, where a flustered
 *      player mashes the button and Firebase rate-limits them.
 *   6. "Back to sign in" returns to the login card.
 *
 * Needs no Firebase credentials and no seeded fixture: every path is stubbed
 * and the page is reachable logged-out. Unlike the other e2e scripts here it
 * does not require .env.e2e.
 *
 * Run: cd BoardGame && node dev/tests/e2e-password-reset.js
 */
const path = require('path');
const { startServer } = require('./e2e-server');
const { puppeteer, assert, VIEWPORT } = require('./e2e-harness');

const TYPED_EMAIL = 'forgetful.player@example.com';

async function run() {
  const port = Number(process.env.PORT) || 8093;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

  const server = await startServer(path.resolve(__dirname, '..', '..'), port);
  const browser = await puppeteer.launch({ headless: 'new' });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });

    // The submit buttons stay disabled until firebase-ready fires, so this
    // doubles as the "Firebase is up" signal the other tests wait for.
    await page.waitForFunction(
      () => !document.getElementById('resetBtn').disabled,
      { timeout: 20000 }
    );

    // 1. The link exists at all.
    const linkText = await page.$$eval('#loginSection a', els =>
      els.map(e => e.textContent.trim())
    );
    assert(
      linkText.some(t => /forgot password/i.test(t)),
      `login card has no "Forgot password?" link (found: ${JSON.stringify(linkText)})`
    );

    // 2. Prefill: type an address on the login form, then switch over.
    await page.type('#loginEmail', TYPED_EMAIL);
    await page.evaluate(() => showReset());

    const afterSwitch = await page.evaluate(() => ({
      loginVisible: document.getElementById('loginSection').style.display !== 'none',
      resetVisible: document.getElementById('resetSection').style.display !== 'none',
      resetEmail: document.getElementById('resetEmail').value,
    }));
    assert(!afterSwitch.loginVisible, 'login card should be hidden on the reset view');
    assert(afterSwitch.resetVisible, 'reset card should be visible after clicking Forgot password');
    assert(
      afterSwitch.resetEmail === TYPED_EMAIL,
      `reset form should prefill the typed email, got "${afterSwitch.resetEmail}"`
    );

    // 3 + 4. Success path. Stub records the address instead of sending mail.
    await page.evaluate(() => {
      window.__resetCalls = [];
      firebase.auth().sendPasswordResetEmail = function (email) {
        window.__resetCalls.push(email);
        return Promise.resolve();
      };
    });

    await page.click('#resetBtn');
    await page.waitForFunction(
      () => window.__resetCalls.length > 0,
      { timeout: 10000 }
    );

    const calls = await page.evaluate(() => window.__resetCalls);
    assert(calls.length === 1, `expected exactly 1 reset call, got ${calls.length}`);
    assert(
      calls[0] === TYPED_EMAIL,
      `reset sent to the wrong address: "${calls[0]}"`
    );

    await page.waitForFunction(
      () => document.getElementById('statusMessage').className.includes('success'),
      { timeout: 10000 }
    );
    const successText = await page.$eval('#statusMessage', el => el.textContent);
    assert(
      /if an account exists/i.test(successText),
      `confirmation must stay generic about whether the account exists, got: "${successText}"`
    );
    assert(
      !successText.includes(TYPED_EMAIL),
      `confirmation must not echo the address back as registered, got: "${successText}"`
    );

    // 5. Rate-limit path — the realistic venue failure.
    await page.evaluate(() => {
      firebase.auth().sendPasswordResetEmail = function () {
        const err = new Error('too many requests');
        err.code = 'auth/too-many-requests';
        return Promise.reject(err);
      };
    });

    await page.click('#resetBtn');
    await page.waitForFunction(
      () => document.getElementById('statusMessage').className.includes('error'),
      { timeout: 10000 }
    );
    const errorText = await page.$eval('#statusMessage', el => el.textContent);
    assert(
      /too many attempts/i.test(errorText),
      `auth/too-many-requests should get its own message, got: "${errorText}"`
    );

    // 6. Way back.
    await page.evaluate(() => showLogin());
    const backHome = await page.evaluate(() => ({
      loginVisible: document.getElementById('loginSection').style.display !== 'none',
      resetVisible: document.getElementById('resetSection').style.display !== 'none',
    }));
    assert(backHome.loginVisible, '"Back to sign in" should return to the login card');
    assert(!backHome.resetVisible, 'reset card should be hidden after going back');

    console.log('PASS — password reset flow is wired up on login.html');
    console.log('NOTE: sending was stubbed. Confirm real deliverability with one');
    console.log('      manual reset to a real inbox before the event.');

  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
