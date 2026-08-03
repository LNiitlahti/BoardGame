const test = require('node:test');
const assert = require('node:assert');
const { resolveTournamentId } = require('../../shared/scripts/resolve-tournament-id.js');

test('resolves from the first matching URL param', () => {
    const id = resolveTournamentId({
        search: '?tournamentId=abc123',
        paramNames: ['tournament', 'tournamentId'],
        cached: null
    });
    assert.strictEqual(id, 'abc123');
});

test('prefers URL param over cached fallback when both present', () => {
    const id = resolveTournamentId({
        search: '?tournament=fromUrl',
        paramNames: ['tournament', 'tournamentId'],
        cached: 'fromCache'
    });
    assert.strictEqual(id, 'fromUrl');
});

test('falls back to cached value when no URL param matches', () => {
    const id = resolveTournamentId({
        search: '?foo=bar',
        paramNames: ['tournament', 'tournamentId'],
        cached: 'fromCache'
    });
    assert.strictEqual(id, 'fromCache');
});

test('returns null when neither URL param nor cache has a value', () => {
    const id = resolveTournamentId({
        search: '',
        paramNames: ['tournament', 'tournamentId'],
        cached: null
    });
    assert.strictEqual(id, null);
});

test('checks paramNames in order and returns the first match', () => {
    const id = resolveTournamentId({
        search: '?tournamentId=second&tournament=first',
        paramNames: ['tournament', 'tournamentId'],
        cached: null
    });
    assert.strictEqual(id, 'first');
});

test('legacy param name is ignored — falls through to cached, not read as the id', () => {
    const id = resolveTournamentId({
        search: '?tournament=oldStyle',
        paramNames: ['tournamentId'],
        legacyParamNames: ['tournament', 'gameId', 'game'],
        cached: 'fromCache'
    });
    assert.strictEqual(id, 'fromCache');
});

test('legacy param name with no cache falls through to null', () => {
    const id = resolveTournamentId({
        search: '?gameId=oldStyle',
        paramNames: ['tournamentId'],
        legacyParamNames: ['tournament', 'gameId', 'game'],
        cached: null
    });
    assert.strictEqual(id, null);
});

test('legacy param name present triggers a console.warn', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);
    try {
        resolveTournamentId({
            search: '?tournament=oldStyle',
            paramNames: ['tournamentId'],
            legacyParamNames: ['tournament', 'gameId', 'game'],
            cached: null
        });
    } finally {
        console.warn = originalWarn;
    }
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0][0], /legacy query param "tournament"/);
    assert.match(calls[0][0], /use "tournamentId" instead/);
});

test('no console.warn when only the canonical param is present', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);
    try {
        resolveTournamentId({
            search: '?tournamentId=abc123',
            paramNames: ['tournamentId'],
            legacyParamNames: ['tournament', 'gameId', 'game'],
            cached: null
        });
    } finally {
        console.warn = originalWarn;
    }
    assert.strictEqual(calls.length, 0);
});

test('console.warn still fires for a legacy param even when the canonical one also resolves', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);
    try {
        const id = resolveTournamentId({
            search: '?tournamentId=abc123&tournament=stale',
            paramNames: ['tournamentId'],
            legacyParamNames: ['tournament', 'gameId', 'game'],
            cached: null
        });
        assert.strictEqual(id, 'abc123');
    } finally {
        console.warn = originalWarn;
    }
    assert.strictEqual(calls.length, 1);
});

test('no legacyParamNames provided — behaves exactly as before (no warn, no crash)', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);
    try {
        const id = resolveTournamentId({
            search: '?tournament=abc123',
            paramNames: ['tournament', 'tournamentId'],
            cached: null
        });
        assert.strictEqual(id, 'abc123');
    } finally {
        console.warn = originalWarn;
    }
    assert.strictEqual(calls.length, 0);
});
