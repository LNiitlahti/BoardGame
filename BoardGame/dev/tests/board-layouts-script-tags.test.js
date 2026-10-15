const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function htmlFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('\.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...htmlFiles(full));
        else if (entry.name.endsWith('.html')) out.push(full);
    }
    return out;
}

function scriptTagIndex(html, file) {
    const m = new RegExp(`<script[^>]*\\bsrc="[^"]*${file.replace('.', '\\.')}"`).exec(html);
    return m ? m.index : -1;
}

test('every page that loads board-module.js loads board-layouts.js before it', () => {
    const offenders = [];
    for (const file of htmlFiles(ROOT)) {
        const html = fs.readFileSync(file, 'utf8');
        const moduleAt = scriptTagIndex(html, 'board-module.js');
        if (moduleAt === -1) continue;
        const layoutsAt = scriptTagIndex(html, 'board-layouts.js');
        if (layoutsAt === -1 || layoutsAt > moduleAt) offenders.push(path.relative(ROOT, file));
    }
    assert.deepStrictEqual(offenders, []);
});

test('every page that loads pdf-generator.js also loads board-layouts.js', () => {
    const offenders = [];
    for (const file of htmlFiles(ROOT)) {
        const html = fs.readFileSync(file, 'utf8');
        if (scriptTagIndex(html, 'pdf-generator.js') === -1) continue;
        if (scriptTagIndex(html, 'board-layouts.js') === -1) offenders.push(path.relative(ROOT, file));
    }
    assert.deepStrictEqual(offenders, []);
});
