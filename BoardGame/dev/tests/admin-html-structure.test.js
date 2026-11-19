const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_HTML = fs.readFileSync(path.resolve(__dirname, '../../full/admin.html'), 'utf8');

function scriptIndex(file) {
    const m = new RegExp(`<script[^>]*\\bsrc="[^"]*${file.replace(/\./g, '\\.')}"`).exec(ADMIN_HTML);
    return m ? m.index : -1;
}

test('admin.html loads match-slot-tags.js before admin-improved-adapter.js', () => {
    const tags = scriptIndex('match-slot-tags.js');
    const adapter = scriptIndex('admin-improved-adapter.js');
    assert.ok(tags !== -1, 'match-slot-tags.js is not loaded');
    assert.ok(tags < adapter, 'match-slot-tags.js must load before admin-improved-adapter.js');
});

function modalBlocks() {
    // Every pop-up root: 13 `.modal-overlay` + 8 `.phase-modal`.
    const ids = [];
    const re = /<div[^>]*class="(?:modal-overlay|phase-modal)"[^>]*id="([^"]+)"|<div[^>]*id="([^"]+)"[^>]*class="(?:modal-overlay|phase-modal)"/g;
    let m;
    while ((m = re.exec(ADMIN_HTML))) ids.push(m[1] || m[2]);
    return ids;
}

function blockFor(id) {
    const start = ADMIN_HTML.indexOf(`id="${id}"`);
    const rest = ADMIN_HTML.slice(start);
    const next = rest.slice(1).search(/<div[^>]*class="(?:modal-overlay|phase-modal)"|<script/);
    return next === -1 ? rest : rest.slice(0, next + 1);
}

test('admin.html links admin-dialog.css after admin.css', () => {
    const a = ADMIN_HTML.indexOf('css/admin.css');
    const d = ADMIN_HTML.indexOf('css/admin-dialog.css');
    assert.ok(d !== -1 && d > a);
});

test('every admin pop-up has a dialog size class and a .dialog-footer', () => {
    const ids = modalBlocks();
    assert.ok(ids.length >= 21, `expected at least 21 pop-ups, found ${ids.length}`);
    const missing = ids.filter(id => {
        const block = blockFor(id);
        return !/class="[^"]*\bdialog-(sm|md|lg)\b/.test(block) || !/class="[^"]*\bdialog-footer\b/.test(block);
    });
    assert.deepStrictEqual(missing, []);
});

test('admin.html has the shell, a flow panel template and the three columns', () => {
    for (const id of ['adminShell', 'flowPanelTemplate', 'flowPanel', 'statsStrip', 'shellLeft', 'shellCenter', 'shellRight', 'currentTaskCard', 'modeToggleBtn', 'modeHint']) {
        assert.ok(ADMIN_HTML.includes(`id="${id}"`), `missing #${id}`);
    }
    assert.ok(!ADMIN_HTML.includes('class="admin-container"'), 'old .admin-container still present');
});

test('admin.html loads admin-layout.js and admin-shell.css', () => {
    assert.ok(scriptIndex('admin-layout.js') !== -1);
    assert.ok(ADMIN_HTML.includes('css/admin-shell.css'));
});

test('every id the adapter looks up exists in admin.html (page or template)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../full/scripts/admin-improved-adapter.js'), 'utf8');
    const ids = new Set([...src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
    // Elements the adapter creates itself, or that only exist on god.html.
    const createdAtRuntime = new Set(['setPhaseBtn', 'phaseInitPrompt', 'matchSlotCards', 'challengeSlotCards', 'forceConsequenceNote']);
    const missing = [...ids].filter(id => !createdAtRuntime.has(id) && !ADMIN_HTML.includes(`id="${id}"`));
    assert.deepStrictEqual(missing, []);
});

test('the adapter no longer carries a hand-copied flow panel HTML string', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../full/scripts/admin-improved-adapter.js'), 'utf8');
    assert.ok(src.includes("getElementById('flowPanelTemplate')"));
    assert.ok(!src.includes("'<div class=\"flow-timeline\" id=\"flowTimeline\"></div>'"));
});

test('admin.html loads admin-command-bar.js', () => {
    assert.ok(scriptIndex('admin-command-bar.js') !== -1);
});

test('the match pop-up holds the match-building fields', () => {
    const block = blockFor('matchDialog');
    for (const id of ['gameType', 'autoFormat', 'sidesContainer', 'matchDialogPicker', 'autoMatchContent', 'matchDialogStatus']) {
        assert.ok(block.includes(`id="${id}"`), `#${id} must be inside #matchDialog`);
    }
    assert.ok(!ADMIN_HTML.includes('id="autoMatchModal"'), '#autoMatchModal should be gone');
});

test('admin.html loads match-dialog.js after admin.js', () => {
    assert.ok(scriptIndex('match-dialog.js') > scriptIndex('scripts/admin.js'));
});

// ── The queue is for planning; live actions belong to the flow cards ──
const ADMIN_JS = fs.readFileSync(path.resolve(__dirname, '../../full/scripts/admin.js'), 'utf8');
function fnSource(src, name) {
    const plain = src.indexOf(`\nfunction ${name}(`);
    const start = plain !== -1 ? plain : src.indexOf(`\nasync function ${name}(`);
    assert.ok(start !== -1, `${name} not found`);
    const next = src.slice(start + 1).search(/\n(async )?function \w+\(/);
    return src.slice(start, next === -1 ? undefined : start + 1 + next);
}

test('queue rows cannot start or score a match (only breaks keep Start)', () => {
    const src = fnSource(ADMIN_JS, 'renderMatchQueue');
    assert.ok(!/quickConfirmResult/.test(src), 'queue rows must not record results');
    const starts = src.match(/startMatch\(/g) || [];
    assert.strictEqual(starts.length, 1, 'only the break row may have a Start button');
    assert.ok(/const allToRender = queuedGames;/.test(src), 'live matches are not listed in the queue');
});

test('the result buttons in the match pop-up exist only for a live match', () => {
    const src = fnSource(ADMIN_JS, 'openQuickConfirm');
    assert.ok(/\$\{isOngoing \? `<button class="btn confirm-win-btn"/.test(src));
    assert.ok(!/Start Match \(No Result Yet\)/.test(src));
});
