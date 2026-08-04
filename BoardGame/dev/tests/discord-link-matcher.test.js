/**
 * Coverage for the pure username-normalisation and suggestion logic behind
 * the god panel's player-link table. Deliberately exact-match-only: see the
 * module's own header for why fuzzy matching is rejected.
 */
const test = require('node:test');
const assert = require('node:assert');
const { normalizeDiscordName, suggestMember } =
    require('../../shared/scripts/discord-link-matcher.js');

test('normalize trims, lowercases, and strips a leading @', () => {
    assert.strictEqual(normalizeDiscordName('  @PlayerOne '), 'playerone');
});

test('normalize strips a legacy #1234 discriminator', () => {
    assert.strictEqual(normalizeDiscordName('Player#1234'), 'player');
});

test('normalize strips a modern #0 discriminator', () => {
    assert.strictEqual(normalizeDiscordName('player#0'), 'player');
});

test('normalize keeps a leading # — that is not a discriminator separator', () => {
    assert.strictEqual(normalizeDiscordName('#weird'), '#weird');
});

test('normalize returns an empty string for anything that is not a string', () => {
    assert.strictEqual(normalizeDiscordName(null), '');
    assert.strictEqual(normalizeDiscordName(undefined), '');
    assert.strictEqual(normalizeDiscordName(42), '');
});

const MEMBERS = [
    { discordUserId: '1', username: 'alpha', displayName: 'Alpha Player' },
    { discordUserId: '2', username: 'beta', displayName: 'Beta' },
    { discordUserId: '3', username: 'gamma', displayName: 'Alpha Player' }
];

test('suggests a member matched on username', () => {
    assert.strictEqual(suggestMember('  @Alpha ', MEMBERS).discordUserId, '1');
});

test('suggests a member matched on display name', () => {
    assert.strictEqual(suggestMember('Beta', MEMBERS).discordUserId, '2');
});

test('returns null when nothing matches', () => {
    assert.strictEqual(suggestMember('nobody', MEMBERS), null);
});

test('returns null for an ambiguous match rather than guessing', () => {
    assert.strictEqual(suggestMember('Alpha Player', MEMBERS), null);
});

test('returns null for an empty or whitespace typed name', () => {
    assert.strictEqual(suggestMember('', MEMBERS), null);
    assert.strictEqual(suggestMember('   ', MEMBERS), null);
});

test('handles a missing members list without throwing', () => {
    assert.strictEqual(suggestMember('alpha', null), null);
    assert.strictEqual(suggestMember('alpha', undefined), null);
});
