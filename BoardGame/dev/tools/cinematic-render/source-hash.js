// Hash of every file that affects the rendered cinematic's picture or sound.
// Stored in cinematic-meta.json; `render.js --check` recomputes it to tell
// whether an uploaded video is stale.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function listDir(root, rel, filter) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs)
        .filter(f => filter(f) && fs.statSync(path.join(abs, f)).isFile())
        .map(f => `${rel}/${f}`);
}

function sourceFiles(root) {
    return [
        ...listDir(root, 'full/data', f => /^(cinematic-scene.*|music-cues.*)\.json$/.test(f)),
        'full/audio/cinematic-music.mp3',
        'shared/data/hex-materials.json',
        'shared/scripts/board-layouts.js',
        ...listDir(root, 'full/scripts/cinematic', f => f.endsWith('.js')),
        ...listDir(root, 'shared/images/hexes/coords', f => f.endsWith('.png'))
    ].filter(f => fs.existsSync(path.join(root, f))).sort();
}

function hashFiles(root, files) {
    const h = crypto.createHash('sha256');
    for (const f of [...files].sort()) {
        h.update(f + '\0');
        h.update(fs.readFileSync(path.join(root, f)));
        h.update('\0');
    }
    return h.digest('hex');
}

function sourceHash(root) {
    return hashFiles(root, sourceFiles(root));
}

module.exports = { sourceFiles, hashFiles, sourceHash };
