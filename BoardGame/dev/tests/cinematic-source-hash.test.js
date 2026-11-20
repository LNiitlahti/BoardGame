const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashFiles, sourceFiles } = require('../tools/cinematic-render/source-hash.js');

test('hashFiles is stable, order-independent and content-sensitive', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinehash-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two');
    const h1 = hashFiles(dir, ['a.txt', 'b.txt']);
    const h2 = hashFiles(dir, ['b.txt', 'a.txt']);
    assert.strictEqual(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'TWO');
    assert.notStrictEqual(hashFiles(dir, ['a.txt', 'b.txt']), h1);
});

test('sourceFiles lists real inputs from the repo', () => {
    const root = path.resolve(__dirname, '../..');
    const files = sourceFiles(root);
    for (const must of [
        'full/data/cinematic-scene.json',
        'full/audio/cinematic-music.mp3',
        'shared/data/hex-materials.json',
        'shared/scripts/board-layouts.js',
        'full/scripts/cinematic/cinematic-controller.js'
    ]) assert.ok(files.includes(must), `missing ${must}`);
    assert.ok(files.some(f => f.startsWith('shared/images/hexes/coords/')), 'tile art missing');
    assert.ok(files.every(f => fs.existsSync(path.join(root, f))));
});
