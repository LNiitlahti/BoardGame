const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../full/scripts/admin-layout.js');

const PM_SRC = fs.readFileSync(path.resolve(__dirname, '../../full/scripts/phase-manager.js'), 'utf8');
const PHASE_ORDER = JSON.parse(
    /const PHASE_ORDER = (\[[\s\S]*?\]);/.exec(PM_SRC)[1].replace(/'/g, '"').replace(/,\s*\]/, ']')
);

const fresh = () => ({ mode: 'match', override: null, lastPhase: undefined, pendingMode: null });

test('every phase in PHASE_ORDER maps to a mode, except break', () => {
    for (const phase of PHASE_ORDER) {
        const mode = L.phaseToMode(phase);
        if (phase === 'break') assert.strictEqual(mode, null);
        else assert.ok(mode === 'board' || mode === 'match', `${phase} has no mode`);
    }
});

test('board phases and match phases map as the spec says', () => {
    ['scoring_vp', 'hex_placement_1', 'spell_window_4', 'challenges', 'board_resolved'].forEach(p =>
        assert.strictEqual(L.phaseToMode(p), 'board', p));
    ['pre_game_setup', 'matches_in_progress', 'challenge_game'].forEach(p =>
        assert.strictEqual(L.phaseToMode(p), 'match', p));
});

test('a phase change switches mode when not busy', () => {
    const s = L.decideMode(fresh(), { phase: 'hex_placement_1', busy: false });
    assert.strictEqual(s.mode, 'board');
    assert.strictEqual(s.pendingMode, null);
});

test('a phase change while busy is held as pending', () => {
    const s = L.decideMode(fresh(), { phase: 'hex_placement_1', busy: true });
    assert.strictEqual(s.mode, 'match');
    assert.strictEqual(s.pendingMode, 'board');
});

test('the pending switch applies once no longer busy', () => {
    let s = L.decideMode(fresh(), { phase: 'hex_placement_1', busy: true });
    s = L.decideMode(s, { phase: 'hex_placement_1', busy: false });
    assert.strictEqual(s.mode, 'board');
    assert.strictEqual(s.pendingMode, null);
});

test('applyPending switches immediately', () => {
    let s = L.decideMode(fresh(), { phase: 'hex_placement_1', busy: true });
    s = L.applyPending(s);
    assert.strictEqual(s.mode, 'board');
    assert.strictEqual(s.pendingMode, null);
});

test('manual toggle holds until the next phase change', () => {
    let s = L.decideMode(fresh(), { phase: 'hex_placement_1', busy: false });
    s = L.toggleOverride(s);
    assert.strictEqual(s.mode, 'match');
    s = L.decideMode(s, { phase: 'hex_placement_1', busy: false });
    assert.strictEqual(s.mode, 'match', 'override must survive re-renders in the same phase');
    s = L.decideMode(s, { phase: 'spell_window_1', busy: false });
    assert.strictEqual(s.mode, 'board', 'override must clear on phase change');
});

test('break keeps the current mode', () => {
    let s = L.decideMode(fresh(), { phase: 'hex_placement_1', busy: false });
    s = L.decideMode(s, { phase: 'break', busy: false });
    assert.strictEqual(s.mode, 'board');
});

test('no phase (tournament not started) keeps the current mode', () => {
    const s = L.decideMode(fresh(), { phase: null, busy: false });
    assert.strictEqual(s.mode, 'match');
});
