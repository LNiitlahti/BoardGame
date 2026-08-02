const test = require('node:test');
const assert = require('node:assert');
const PlayerUtils = require('../../shared/scripts/player-utils.js');

function makeGameState() {
    return {
        players: {
            p_alice: { id: 'p_alice', name: 'Alice', teamId: 1, uid: 'uid_alice', createdAt: 't0' },
            p_slot2: { id: 'p_slot2', name: 'Slot 2', teamId: 1, uid: null, createdAt: 't0' }
        },
        teams: [
            {
                id: 1,
                name: 'Team A',
                playerIds: ['p_alice', 'p_slot2'],
                players: [
                    { id: 'p_alice', name: 'Alice', uid: 'uid_alice' },
                    { id: 'p_slot2', name: 'Slot 2', uid: null }
                ]
            }
        ]
    };
}

// ---- isPlayerLinked ----

test('isPlayerLinked is true for a slot with a uid', () => {
    const gs = makeGameState();
    assert.strictEqual(PlayerUtils.isPlayerLinked(gs, 'p_alice'), true);
});

test('isPlayerLinked is false for a placeholder slot', () => {
    const gs = makeGameState();
    assert.strictEqual(PlayerUtils.isPlayerLinked(gs, 'p_slot2'), false);
});

// ---- linkUserToPlayerSlot ----

test('linkUserToPlayerSlot links a placeholder in place, preserving the id', () => {
    const gs = makeGameState();
    const result = PlayerUtils.linkUserToPlayerSlot(gs, 1, 'p_slot2', { uid: 'uid_bob', name: 'Bob', email: 'bob@x.com' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(gs.players.p_slot2.uid, 'uid_bob');
    assert.strictEqual(gs.players.p_slot2.name, 'Bob');
    assert.deepStrictEqual(gs.teams[0].playerIds, ['p_alice', 'p_slot2']);
    const mirrored = gs.teams[0].players.find(p => p.id === 'p_slot2');
    assert.strictEqual(mirrored.uid, 'uid_bob');
    assert.strictEqual(mirrored.name, 'Bob');
});

test('linkUserToPlayerSlot refuses to touch an already-linked slot', () => {
    const gs = makeGameState();
    const before = JSON.parse(JSON.stringify(gs));
    const result = PlayerUtils.linkUserToPlayerSlot(gs, 1, 'p_alice', { uid: 'uid_bob', name: 'Bob' });

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(gs, before);
});

// ---- swapPlayerInSlot ----

test('swapPlayerInSlot mints a new id for the new occupant, at the same slot position', () => {
    const gs = makeGameState();
    const result = PlayerUtils.swapPlayerInSlot(gs, 1, 'p_alice', { uid: 'uid_carol', name: 'Carol', email: 'carol@x.com' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.oldPlayerId, 'p_alice');
    assert.notStrictEqual(result.newPlayerId, 'p_alice');

    assert.deepStrictEqual(gs.teams[0].playerIds, [result.newPlayerId, 'p_slot2']);
    assert.strictEqual(gs.teams[0].players[0].id, result.newPlayerId);
    assert.strictEqual(gs.teams[0].players[0].name, 'Carol');
    assert.strictEqual(gs.teams[0].players[0].uid, 'uid_carol');
});

test('swapPlayerInSlot leaves the old registry entry untouched (name/uid) so history keeps resolving', () => {
    const gs = makeGameState();
    PlayerUtils.swapPlayerInSlot(gs, 1, 'p_alice', { uid: 'uid_carol', name: 'Carol' });

    assert.strictEqual(gs.players.p_alice.name, 'Alice');
    assert.strictEqual(gs.players.p_alice.uid, 'uid_alice');
});

test('swapPlayerInSlot clears the retired entry\'s teamId so team-lookup helpers do not still report it as a member', () => {
    const gs = makeGameState();
    PlayerUtils.swapPlayerInSlot(gs, 1, 'p_alice', { uid: 'uid_carol', name: 'Carol' });

    assert.strictEqual(gs.players.p_alice.teamId, null);
    assert.strictEqual(PlayerUtils.getPlayerTeamId(gs, 'p_alice'), null);
});

test('swapPlayerInSlot refuses a slot that is not currently linked', () => {
    const gs = makeGameState();
    const before = JSON.parse(JSON.stringify(gs));
    const result = PlayerUtils.swapPlayerInSlot(gs, 1, 'p_slot2', { uid: 'uid_carol', name: 'Carol' });

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(gs, before);
});

// ---- deletePlayerSlot ----

test('deletePlayerSlot removes the slot from registry, playerIds, and legacy players[]', () => {
    const gs = makeGameState();
    const removed = PlayerUtils.deletePlayerSlot(gs, 1, 'p_alice');

    assert.strictEqual(removed.id, 'p_alice');
    assert.strictEqual(removed.uid, 'uid_alice');
    assert.strictEqual(gs.players.p_alice, undefined);
    assert.deepStrictEqual(gs.teams[0].playerIds, ['p_slot2']);
    assert.strictEqual(gs.teams[0].players.find(p => p.id === 'p_alice'), undefined);
});

test('deletePlayerSlot returns null for a playerId not on the team', () => {
    const gs = makeGameState();
    const removed = PlayerUtils.deletePlayerSlot(gs, 1, 'p_does_not_exist');
    assert.strictEqual(removed, null);
});
