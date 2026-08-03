/**
 * Regression test for TODO.md Task 20 ("Unify `tournament` vs `tournamentId`
 * query param naming across pages"). Live investigation found the split was
 * much bigger than the plan's original 3 files (admin.js/god-app.js/view.html):
 * navbar.js's buildNavUrl() special-cased god.html to emit `?tournament=`
 * while every other page got `?tournamentId=`, and half a dozen more pages
 * independently accepted `tournament`/`gameId`/`game` as silent aliases.
 *
 * Fix: `tournamentId` is now the ONLY accepted query param everywhere.
 * `shared/scripts/resolve-tournament-id.js`'s `resolveTournamentId()` grew an
 * optional `legacyParamNames` list — if present in the URL, it's ignored for
 * resolution (falls through to `cached`/null exactly as if absent) and a
 * dev-facing `console.warn` fires (never a UI toast/banner).
 *
 * This test proves both halves against live `e2e-disposable-1`:
 *   1. The golden path still works: `?tournamentId=<id>` alone resolves and
 *      loads the tournament on admin.html, god.html, and view.html.
 *   2. The regression is fixed: a legacy `?tournament=` (or `?gameId=` where
 *      accepted) alone does NOT get its VALUE read as the tournament id — it
 *      falls through to whatever cached fallback the page already had
 *      (possibly null, possibly a real id from a completely separate
 *      fallback path, e.g. navbar.js's assignedTournamentId auto-populate —
 *      see LEGACY_SENTINEL_ID below for why the assertion is "the URL value
 *      was never used" rather than "nothing resolved") — AND a console.warn
 *      fires saying so.
 *
 * Read-only against Firestore tournament data (only ever GETs the tournament
 * doc / tournament list, driven by the pages' own normal load code) — nothing
 * to snapshot/restore. Each scenario explicitly clears
 * localStorage/sessionStorage's cached `currentTournamentId` first so a
 * "does NOT resolve from the URL" assertion can't be masked by a leftover
 * cache value from an earlier scenario in the same run.
 */
require('dotenv').config({ path: __dirname + '/.env.e2e' });
const path = require('path');
const assert = require('node:assert');
const { startServer } = require('./e2e-server');
const { newLoggedInPage, puppeteer } = require('./e2e-harness');

const TEST_TOURNAMENT_ID = process.env.TEST_TOURNAMENT_ID || 'e2e-disposable-1';
const BLOCKLIST = ['cl32-smoke-test', 'fast-test-2'];
if (BLOCKLIST.includes(TEST_TOURNAMENT_ID)) {
    throw new Error(`Refusing to run: TEST_TOURNAMENT_ID "${TEST_TOURNAMENT_ID}" is a blocklisted real event tournament.`);
}

// A value that is obviously NOT a real tournament id, used in the "legacy
// param alone" scenarios instead of TEST_TOURNAMENT_ID. Using the real id
// there would be ambiguous: the TD test account may have its own
// assignedTournamentId (a *different*, legitimate fallback path — see
// navbar.js renderNavbar()) that happens to also resolve to
// e2e-disposable-1, which would make "it resolved to e2e-disposable-1" look
// like a pass even if the legacy param were (bug) still being read. Using a
// sentinel value make the assertion unambiguous: if the resolved id ever
// equals this sentinel, the legacy param was read; if it's anything else
// (null, or a real cached fallback id), the legacy param was correctly
// ignored, regardless of what the environment's fallback chain produces.
const LEGACY_SENTINEL_ID = 'e2e-legacy-value-should-be-ignored';

async function clearTournamentStorage(page) {
    await page.evaluate(() => {
        localStorage.removeItem('currentTournamentId');
        sessionStorage.removeItem('currentTournamentId');
        localStorage.removeItem('currentTournamentName');
        sessionStorage.removeItem('currentTournamentName');
    });
}

function attachConsoleCapture(page) {
    const messages = [];
    const handler = (msg) => messages.push(msg.text());
    page.on('console', handler);
    return { messages, detach: () => page.off('console', handler) };
}

async function gotoWithParam(page, baseUrl, pagePath, paramName, tournamentId) {
    const url = `${baseUrl}/${pagePath}?${paramName}=${encodeURIComponent(tournamentId)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => typeof firebase !== 'undefined' && !!window.firebaseDB,
        { timeout: 20000 }
    );
}

function hasLegacyWarningFor(messages, legacyName) {
    return messages.some(m => m.includes('Ignoring legacy query param') && m.includes(`"${legacyName}"`));
}

let passed = 0;
function pass(label) {
    passed++;
    console.log(`PASS: ${label}`);
}

(async () => {
    const server = await startServer(path.resolve(__dirname, '..', '..'), 8080);
    const browser = await puppeteer.launch({ headless: 'new' });
    try {
        const page = await newLoggedInPage(browser, process.env.BASE_URL, process.env.TD_EMAIL, process.env.TD_PASSWORD);

        // ==================================================================
        // Scenario 1: admin.html — canonical ?tournamentId= (golden path)
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await gotoWithParam(page, process.env.BASE_URL, 'full/admin.html', 'tournamentId', TEST_TOURNAMENT_ID);
            // currentTournamentId is set synchronously as soon as loadTournament()
            // starts; gameState.tournamentId is only populated once the Firestore
            // onSnapshot listener actually delivers data — wait for the latter,
            // it's the real "tournament fully loaded" signal.
            await page.waitForFunction(
                (id) => typeof gameState !== 'undefined' && gameState && gameState.tournamentId === id,
                { timeout: 15000 },
                TEST_TOURNAMENT_ID
            );
            const resolvedGameState = await page.evaluate(() => ({
                tournamentId: gameState && gameState.tournamentId,
                hasTeams: !!(gameState && gameState.teams)
            }));
            assert.strictEqual(resolvedGameState.tournamentId, TEST_TOURNAMENT_ID, 'admin.html should load gameState for the canonical tournamentId');
            cap.detach();
            const legacyWarn = cap.messages.filter(m => m.includes('Ignoring legacy query param'));
            assert.strictEqual(legacyWarn.length, 0, `canonical param must not trigger a legacy warning, got: ${JSON.stringify(legacyWarn)}`);
            pass('admin.html?tournamentId=<id> resolves + loads the tournament, no legacy warning');
        }

        // ==================================================================
        // Scenario 2: admin.html — legacy ?tournament= alone (regression check)
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await gotoWithParam(page, process.env.BASE_URL, 'full/admin.html', 'tournament', LEGACY_SENTINEL_ID);
            // Wait for the page's role-check/init flow to have definitely run
            // (roleBadge is populated synchronously, a few lines before the
            // resolveTournamentId() call), then a short settle buffer for that
            // synchronous call itself.
            await page.waitForFunction(
                () => { const el = document.getElementById('roleBadge'); return !!(el && el.textContent && el.textContent.trim()); },
                { timeout: 15000 }
            );
            await new Promise(resolve => setTimeout(resolve, 500));
            const resolved = await page.evaluate(() => typeof currentTournamentId !== 'undefined' ? currentTournamentId : 'MISSING');
            assert.notStrictEqual(resolved, LEGACY_SENTINEL_ID, `legacy-only "tournament" param must NOT be read as the tournament id, but currentTournamentId became the sentinel value: ${resolved}`);
            cap.detach();
            assert.ok(hasLegacyWarningFor(cap.messages, 'tournament'), `expected a console.warn about the legacy "tournament" param, got messages: ${JSON.stringify(cap.messages)}`);
            pass(`admin.html?tournament=<id> (legacy) does NOT resolve the URL value (resolved to: ${resolved}), and warns`);
        }

        // ==================================================================
        // Scenario 3: admin.html — legacy ?gameId= alone (second legacy alias)
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await gotoWithParam(page, process.env.BASE_URL, 'full/admin.html', 'gameId', LEGACY_SENTINEL_ID);
            await page.waitForFunction(
                () => { const el = document.getElementById('roleBadge'); return !!(el && el.textContent && el.textContent.trim()); },
                { timeout: 15000 }
            );
            await new Promise(resolve => setTimeout(resolve, 500));
            const resolved = await page.evaluate(() => typeof currentTournamentId !== 'undefined' ? currentTournamentId : 'MISSING');
            assert.notStrictEqual(resolved, LEGACY_SENTINEL_ID, `legacy-only "gameId" param must NOT be read as the tournament id, but currentTournamentId became the sentinel value: ${resolved}`);
            cap.detach();
            assert.ok(hasLegacyWarningFor(cap.messages, 'gameId'), `expected a console.warn about the legacy "gameId" param, got messages: ${JSON.stringify(cap.messages)}`);
            pass(`admin.html?gameId=<id> (legacy) does NOT resolve the URL value (resolved to: ${resolved}), and warns`);
        }

        // ==================================================================
        // Scenario 4: god.html — canonical ?tournamentId= (golden path)
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await gotoWithParam(page, process.env.BASE_URL, 'full/god.html', 'tournamentId', TEST_TOURNAMENT_ID);
            await page.waitForFunction(
                (id) => window.godApp && window.godApp._currentTournamentId === id,
                { timeout: 20000 },
                TEST_TOURNAMENT_ID
            );
            cap.detach();
            const legacyWarn = cap.messages.filter(m => m.includes('Ignoring legacy query param'));
            assert.strictEqual(legacyWarn.length, 0, `canonical param must not trigger a legacy warning, got: ${JSON.stringify(legacyWarn)}`);
            pass('god.html?tournamentId=<id> resolves + loads the tournament, no legacy warning');
        }

        // ==================================================================
        // Scenario 5: god.html — legacy ?tournament= alone (the actual source
        // of the original bug: navbar.js's buildNavUrl() special-cased
        // god.html to emit this)
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await gotoWithParam(page, process.env.BASE_URL, 'full/god.html', 'tournament', LEGACY_SENTINEL_ID);
            // godApp.loadTournamentsList() awaits a real Firestore read before
            // resolveTournamentId() runs; wait for that to finish, then a
            // short settle buffer for the synchronous resolve call after it.
            await page.waitForFunction(
                () => window.godApp && Array.isArray(window.godApp._allTournaments),
                { timeout: 20000 }
            );
            await new Promise(resolve => setTimeout(resolve, 500));
            const resolved = await page.evaluate(() => window.godApp ? window.godApp._currentTournamentId : 'MISSING');
            assert.notStrictEqual(resolved, LEGACY_SENTINEL_ID, `legacy-only "tournament" param must NOT be read as the tournament id on god.html, but became the sentinel value: ${resolved}`);
            cap.detach();
            assert.ok(hasLegacyWarningFor(cap.messages, 'tournament'), `expected a console.warn about the legacy "tournament" param, got messages: ${JSON.stringify(cap.messages)}`);
            pass(`god.html?tournament=<id> (legacy) does NOT resolve the URL value (resolved to: ${resolved}), and warns`);
        }

        // ==================================================================
        // Scenario 6: view.html — canonical ?tournamentId= (golden path).
        // view.html resolves tournamentId synchronously at parse time (a
        // top-level const, before firebase-ready), so domcontentloaded alone
        // is a sufficient wait.
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await page.goto(`${process.env.BASE_URL}/full/view.html?tournamentId=${encodeURIComponent(TEST_TOURNAMENT_ID)}`, { waitUntil: 'domcontentloaded' });
            const resolved = await page.evaluate(() => tournamentId);
            cap.detach();
            assert.strictEqual(resolved, TEST_TOURNAMENT_ID, 'view.html should resolve the canonical tournamentId synchronously');
            const legacyWarn = cap.messages.filter(m => m.includes('Ignoring legacy query param'));
            assert.strictEqual(legacyWarn.length, 0, `canonical param must not trigger a legacy warning, got: ${JSON.stringify(legacyWarn)}`);
            pass('view.html?tournamentId=<id> resolves synchronously, no legacy warning');
        }

        // ==================================================================
        // Scenario 7: view.html — legacy ?tournament= alone.
        // Unlike admin/god.html, view.html has no other fallback that could
        // resolve the sentinel case: with an empty cache, `resolveTournamentId`
        // (already logging its console.warn by this point, synchronously,
        // before DOMContentLoaded even fires) returns null, and view.html's
        // own `if (!tournamentId)` guard (~line 2265) immediately redirects
        // to home.html — which destroys this page's JS context, so
        // `tournamentId` can no longer be read directly. The redirect
        // itself IS the proof: it only fires when tournamentId is falsy,
        // i.e. definitely not the sentinel URL value. console messages are
        // captured by a Node-side listener attached before navigation, so
        // they survive the context teardown.
        // ==================================================================
        {
            await clearTournamentStorage(page);
            const cap = attachConsoleCapture(page);
            await page.goto(`${process.env.BASE_URL}/full/view.html?tournament=${encodeURIComponent(LEGACY_SENTINEL_ID)}`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.location.pathname.endsWith('/home.html'), { timeout: 10000 });
            cap.detach();
            assert.ok(page.url().includes('home.html'), `expected the "no tournament" redirect to home.html (proving tournamentId was falsy, not the sentinel), landed on: ${page.url()}`);
            assert.ok(hasLegacyWarningFor(cap.messages, 'tournament'), `expected a console.warn about the legacy "tournament" param, got messages: ${JSON.stringify(cap.messages)}`);
            pass('view.html?tournament=<id> (legacy) does NOT resolve the URL value (falls through to the "no tournament" redirect), and warns');
        }

        console.log(`\nAll ${passed} scenarios passed.`);
    } finally {
        await browser.close();
        server.close();
    }
})().catch((err) => {
    console.error('FAIL:', err.message);
    process.exitCode = 1;
});
