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
