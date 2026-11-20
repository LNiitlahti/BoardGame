const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../../full/scripts/cinematic/cine-expansion-plan.js');

const ROOT = path.resolve(__dirname, '../..');
const xcfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'full/data/cinematic-scene-expansion.json'), 'utf8'));
const drums = JSON.parse(fs.readFileSync(path.join(ROOT, 'full/data/music-cues-drums.json'), 'utf8'));

function hexCoords(radius) {
    const out = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) out.push([q, r]);
    }
    return out;
}

test('shipped acts are ordered and inside the song', () => {
    assert.deepStrictEqual(P.validateActs(xcfg.acts, drums.durationMs), []);
});

test('validateActs reports out-of-order and past-the-song acts', () => {
    const bad = { ...xcfg.acts, break: 100 };
    assert.ok(P.validateActs(bad, drums.durationMs).some(p => p.includes('break')));
    assert.ok(P.validateActs({ ...xcfg.acts, end: 999999 }, drums.durationMs).includes('end is past the song'));
});

test('169-hex plan: 91 drops, 78 eruptions, every hex exactly once', () => {
    const { drops } = P.planExpansion(xcfg, hexCoords(7), drums.beats);
    assert.strictEqual(drops.length, 169);
    assert.strictEqual(new Set(drops.map(d => d.coord)).size, 169);
    assert.strictEqual(drops.filter(d => d.kind === 'drop').length, 91);
    assert.strictEqual(drops.filter(d => d.kind === 'erupt').length, 78);
    assert.ok(drops.filter(d => d.kind === 'erupt').every(d => d.ring >= 6));
});

test('mountain heart lands exactly on the drum entry; old board done by familiarDone', () => {
    const { drops } = P.planExpansion(xcfg, hexCoords(7), drums.beats);
    const heart = drops.find(d => d.coord === 'q0r0');
    assert.strictEqual(heart.landAt, xcfg.acts.heartDrop);
    const old = drops.filter(d => d.kind === 'drop');
    assert.ok(old.every(d => d.landAt <= xcfg.acts.familiarDone), 'rings 0-5 land by familiarDone');
    assert.ok(old.every(d => d.at >= xcfg.acts.void));
    // Rings land in order: no ring-3 tile before the last ring-2 tile starts.
    const lastRing1 = Math.max(...old.filter(d => d.ring === 1).map(d => d.landAt));
    assert.ok(old.filter(d => d.ring >= 2).every(d => d.landAt > lastRing1));
});

test('eruption starts on the drop, near side first, all landed by eruptionEnd', () => {
    const { drops } = P.planExpansion(xcfg, hexCoords(7), drums.beats);
    const erupt = drops.filter(d => d.kind === 'erupt');
    assert.ok(erupt.every(d => d.at >= xcfg.acts.break));
    assert.ok(erupt.every(d => d.landAt <= P.eruptionEnd(xcfg)));
    const first = erupt.reduce((a, b) => (a.at <= b.at ? a : b));
    assert.strictEqual(first.at, xcfg.acts.break + 0, 'nearest hex starts on the drop');
    assert.ok(P.eruptionEnd(xcfg) < xcfg.acts.settle);
});

test('name windows are exported from the config', () => {
    const { nameWindows } = P.planExpansion(xcfg, hexCoords(7), drums.beats);
    assert.deepStrictEqual(nameWindows, [
        { startMs: 79000, endMs: 185000 }, { startMs: 200800, endMs: 267000 }
    ]);
});

test('snapToBeat snaps within range only', () => {
    assert.strictEqual(P.snapToBeat(1000, [900, 1300], 150), 900);
    assert.strictEqual(P.snapToBeat(1000, [500, 1600], 150), 1000);
});

test('planExpansion is pure (same input -> same output)', () => {
    const a = P.planExpansion(xcfg, hexCoords(7), drums.beats);
    const b = P.planExpansion(xcfg, hexCoords(7), drums.beats);
    assert.deepStrictEqual(a, b);
});
