// Smoke test for dev/tools/cinematic-render/render.js. Needs ffmpeg/ffprobe.
//   node dev/tests/e2e-cinematic-render.js
// Renders the first 2 s twice and compares them frame by frame (determinism).
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const RENDER = path.join(ROOT, 'dev/tools/cinematic-render/render.js');

function render(outDir, port) {
    const r = spawnSync('node', [RENDER, '--board=2', '--preview=2', '--headless',
        `--out=${outDir}`, `--port=${port}`], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) throw new Error(`render failed:\n${r.stdout}\n${r.stderr}`);
}

function probe(mp4) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
        'stream=codec_type,width,height,r_frame_rate,nb_read_frames', '-of', 'json', mp4], { encoding: 'utf8' });
    return JSON.parse(r.stdout).streams;
}

// Per-frame PSNR between two renders. GPU rasterisation dithers gradients
// slightly differently run to run (~50 dB), so "deterministic" here means
// visually identical (>= 40 dB on every frame), not bit-exact.
function framePsnrs(base) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'a/cinematic.mp4', '-i', 'b/cinematic.mp4',
        '-lavfi', '[0:v][1:v]psnr=stats_file=psnr.txt', '-f', 'null', '-'],
        { cwd: base, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return fs.readFileSync(path.join(base, 'psnr.txt'), 'utf8').trim().split('\n')
        .map(l => { const m = l.match(/psnr_avg:(\S+)/); return m[1] === 'inf' ? Infinity : Number(m[1]); });
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-det-'));
const a = path.join(base, 'a');
const b = path.join(base, 'b');
render(a, 5541);
render(b, 5542);

const streams = probe(path.join(a, 'cinematic.mp4'));
const v = streams.find(s => s.codec_type === 'video');
assert.ok(v, 'has a video stream');
assert.ok(streams.some(s => s.codec_type === 'audio'), 'has an audio stream');
assert.strictEqual(v.width, 1920);
assert.strictEqual(v.height, 1080);
assert.strictEqual(v.r_frame_rate, '60/1');
assert.strictEqual(Number(v.nb_read_frames), 120);

const meta = JSON.parse(fs.readFileSync(path.join(a, 'cinematic-meta.json'), 'utf8'));
assert.strictEqual(meta.version, 1);
assert.strictEqual(meta.boardVersion, '2');
assert.strictEqual(meta.preview, true);
assert.strictEqual(meta.script, 'expansion');
assert.ok(Array.isArray(meta.nameWindows) && meta.nameWindows.length === 2);
assert.match(meta.sourceHash, /^[0-9a-f]{64}$/);

const psnrs = framePsnrs(base);
assert.strictEqual(psnrs.length, 120);
const worst = Math.min(...psnrs);
assert.ok(worst >= 40, `two renders are visually identical (worst frame PSNR ${worst} dB)`);

console.log('e2e-cinematic-render: PASS');
