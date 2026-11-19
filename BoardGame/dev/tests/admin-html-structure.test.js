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
