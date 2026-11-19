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
