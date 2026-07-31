const test = require('node:test');
const assert = require('node:assert');
const CineMusic = require('../../full/scripts/cinematic/cine-music.js');

const ENVELOPE = [
    { t: 0, amp: 0.1 },
    { t: 100, amp: 0.3 },
    { t: 200, amp: 0.9 },
    { t: 300, amp: 0.2 }
];

test('envelopeAt: returns the exact sample at an exact timestamp', () => {
    const music = new CineMusic({ envelope: ENVELOPE, beats: [], durationMs: 300 });
    assert.strictEqual(music.envelopeAt(0), 0.1);
    assert.strictEqual(music.envelopeAt(100), 0.3);
    assert.strictEqual(music.envelopeAt(200), 0.9);
    assert.strictEqual(music.envelopeAt(300), 0.2);
});

test('envelopeAt: linearly interpolates between two samples', () => {
    const music = new CineMusic({ envelope: ENVELOPE, beats: [], durationMs: 300 });
    // Halfway between t=100 (0.3) and t=200 (0.9) -> 0.6
    assert.ok(Math.abs(music.envelopeAt(150) - 0.6) < 1e-9);
    // Quarter of the way between t=200 (0.9) and t=300 (0.2) -> 0.725
    assert.ok(Math.abs(music.envelopeAt(225) - 0.725) < 1e-9);
});

test('envelopeAt: clamps to the first sample before the track starts', () => {
    const music = new CineMusic({ envelope: ENVELOPE, beats: [], durationMs: 300 });
    assert.strictEqual(music.envelopeAt(-500), 0.1);
});

test('envelopeAt: clamps to the last sample after the track ends', () => {
    const music = new CineMusic({ envelope: ENVELOPE, beats: [], durationMs: 300 });
    assert.strictEqual(music.envelopeAt(99999), 0.2);
});

test('envelopeAt: returns 0 for an empty envelope', () => {
    const music = new CineMusic({ envelope: [], beats: [], durationMs: 0 });
    assert.strictEqual(music.envelopeAt(0), 0);
    assert.strictEqual(music.envelopeAt(500), 0);
});

test('envelopeAt: a single-sample envelope always returns that sample', () => {
    const music = new CineMusic({ envelope: [{ t: 500, amp: 0.42 }], beats: [], durationMs: 500 });
    assert.strictEqual(music.envelopeAt(0), 0.42);
    assert.strictEqual(music.envelopeAt(500), 0.42);
    assert.strictEqual(music.envelopeAt(9999), 0.42);
});

test('constructor: tolerates a null/undefined doc entirely (load failure path)', () => {
    const music = new CineMusic(null);
    assert.deepStrictEqual(music.envelope, []);
    assert.deepStrictEqual(music.beats, []);
    assert.strictEqual(music.durationMs, 0);
    assert.strictEqual(music.envelopeAt(0), 0);
});

test('constructor: tolerates a doc with fields missing entirely', () => {
    const music = new CineMusic({ durationMs: 1000 });
    assert.deepStrictEqual(music.envelope, []);
    assert.deepStrictEqual(music.beats, []);
    assert.strictEqual(music.durationMs, 1000);
});

test('load(): never rejects — a fetch failure degrades to an inert CineMusic', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('network down'); };
    try {
        const music = await CineMusic.load('http://example.invalid/music-cues.json');
        assert.deepStrictEqual(music.envelope, []);
        assert.deepStrictEqual(music.beats, []);
        assert.strictEqual(music.durationMs, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('load(): parses a successful response into a working CineMusic', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        json: async () => ({ version: 1, durationMs: 300, envelope: ENVELOPE, beats: [100, 250] })
    });
    try {
        const music = await CineMusic.load('http://example.invalid/music-cues.json');
        assert.strictEqual(music.durationMs, 300);
        assert.deepStrictEqual(music.beats, [100, 250]);
        assert.strictEqual(music.envelopeAt(100), 0.3);
    } finally {
        global.fetch = originalFetch;
    }
});
