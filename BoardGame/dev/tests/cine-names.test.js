const test = require('node:test');
const assert = require('node:assert');
const CineNames = require('../../full/scripts/cinematic/cine-names.js');

test('single window reproduces the old live behaviour', () => {
    const ev = CineNames.schedule({
        windows: [{ startMs: 1000, endMs: 10000 }],
        intervalMs: 4000, title: 'Sota Jatkuu', names: ['A', 'B'],
        vocalBeats: [500, 1000, 7000, 10000, 12000]
    });
    assert.deepStrictEqual(ev, [
        { at: 1000, type: 'text', text: 'Sota Jatkuu' },
        { at: 1000, type: 'flicker' },
        { at: 5000, type: 'text', text: 'A' },
        { at: 7000, type: 'flicker' },
        { at: 9000, type: 'text', text: 'B' },
        { at: 10000, type: 'flicker' },
        { at: 10000, type: 'clear' }
    ]);
});

test('two windows: the cycle continues across windows; beats outside windows ignored', () => {
    const ev = CineNames.schedule({
        windows: [{ startMs: 0, endMs: 5000 }, { startMs: 20000, endMs: 22000 }],
        intervalMs: 4000, title: 'T', names: ['A', 'B'],
        vocalBeats: [15000, 21000]
    });
    assert.deepStrictEqual(ev.filter(e => e.type === 'text').map(e => [e.at, e.text]),
        [[0, 'T'], [4000, 'A'], [20000, 'B']]);
    assert.deepStrictEqual(ev.filter(e => e.type === 'flicker').map(e => e.at), [21000]);
    assert.deepStrictEqual(ev.filter(e => e.type === 'clear').map(e => e.at), [5000, 22000]);
});

test('no names -> title only; empty windows -> no events', () => {
    const ev = CineNames.schedule({
        windows: [{ startMs: 0, endMs: 9000 }], intervalMs: 4000, title: 'T', names: [], vocalBeats: []
    });
    assert.deepStrictEqual(ev.filter(e => e.type === 'text').map(e => e.text), ['T', 'T', 'T']);
    assert.deepStrictEqual(CineNames.schedule({ windows: [], intervalMs: 4000, title: 'T', names: [], vocalBeats: [1] }), []);
});

test('namesFromGameState flattens team players and drops empties', () => {
    assert.deepStrictEqual(CineNames.namesFromGameState({
        teams: [{ players: [{ name: 'Wustra' }, { name: '' }] }, { players: [{ name: 'Touch' }] }, {}]
    }), ['Wustra', 'Touch']);
    assert.deepStrictEqual(CineNames.namesFromGameState(null), []);
});

test('apply dispatches to the text object', () => {
    const calls = [];
    const text = { setText: s => calls.push(['set', s]), triggerFlicker: f => calls.push(['flicker', f]) };
    CineNames.apply(text, { at: 0, type: 'text', text: 'X' }, () => 1.5);
    CineNames.apply(text, { at: 0, type: 'flicker' }, () => 1.5);
    CineNames.apply(text, { at: 0, type: 'clear' }, () => 1.5);
    assert.deepStrictEqual(calls, [['set', 'X'], ['flicker', 1.5], ['set', '']]);
});
