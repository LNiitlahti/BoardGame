const test = require('node:test');
const assert = require('node:assert');
const { shouldClearUserAssignment } = require('../../shared/scripts/user-assignment.js');

test('clears when the assignment still points at the tournament/player being removed', () => {
    const userData = { assignedTournamentId: 't1', assignedPlayerId: 'p_1' };
    assert.strictEqual(shouldClearUserAssignment(userData, { tournamentId: 't1', playerId: 'p_1' }), true);
});

test('does NOT clear when the user has since been linked into a different tournament', () => {
    // e.g. removed from an old tournament's roster after they were already
    // linked into a newer one — their pointer now belongs to the newer one.
    const userData = { assignedTournamentId: 't2', assignedPlayerId: 'p_9' };
    assert.strictEqual(shouldClearUserAssignment(userData, { tournamentId: 't1', playerId: 'p_1' }), false);
});

test('does NOT clear when the tournament matches but the player slot does not (swapped to a new slot in the same tournament)', () => {
    const userData = { assignedTournamentId: 't1', assignedPlayerId: 'p_new' };
    assert.strictEqual(shouldClearUserAssignment(userData, { tournamentId: 't1', playerId: 'p_old' }), false);
});

test('does NOT clear when there is no assignment data at all', () => {
    assert.strictEqual(shouldClearUserAssignment(null, { tournamentId: 't1', playerId: 'p_1' }), false);
    assert.strictEqual(shouldClearUserAssignment(undefined, { tournamentId: 't1', playerId: 'p_1' }), false);
});

test('does NOT clear when assignedTournamentId/assignedPlayerId are already null', () => {
    const userData = { assignedTournamentId: null, assignedPlayerId: null };
    assert.strictEqual(shouldClearUserAssignment(userData, { tournamentId: 't1', playerId: 'p_1' }), false);
});
