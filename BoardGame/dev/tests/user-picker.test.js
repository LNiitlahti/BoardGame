const test = require('node:test');
const assert = require('node:assert');
const { fetchAvailableUsers } = require('../../shared/scripts/user-picker.js');

function fakeDB(usersById) {
    return {
        collection(name) {
            assert.strictEqual(name, 'users');
            return {
                async get() {
                    return {
                        forEach(cb) {
                            Object.entries(usersById).forEach(([id, data]) => cb({ id, data: () => data }));
                        }
                    };
                }
            };
        }
    };
}

test('fetchAvailableUsers shapes each user with displayName/email fallbacks', async () => {
    const db = fakeDB({ u1: { displayName: 'Alice', email: 'alice@x.com' } });
    const users = await fetchAvailableUsers(db);
    assert.strictEqual(users.length, 1);
    assert.strictEqual(users[0].uid, 'u1');
    assert.strictEqual(users[0].displayName, 'Alice');
    assert.strictEqual(users[0].email, 'alice@x.com');
});

test('fetchAvailableUsers falls back to first/last name when displayName is missing', async () => {
    const db = fakeDB({ u1: { firstName: 'Bob', lastName: 'Jones' } });
    const users = await fetchAvailableUsers(db);
    assert.strictEqual(users[0].displayName, 'Bob Jones');
});

test('fetchAvailableUsers marks alreadyLinkedUids', async () => {
    const db = fakeDB({ u1: { displayName: 'Alice' }, u2: { displayName: 'Bob' } });
    const users = await fetchAvailableUsers(db, { alreadyLinkedUids: new Set(['u1']) });
    const alice = users.find(u => u.uid === 'u1');
    const bob = users.find(u => u.uid === 'u2');
    assert.strictEqual(alice.alreadyLinked, true);
    assert.strictEqual(bob.alreadyLinked, false);
});

test('fetchAvailableUsers marks assignedElsewhere when assignedTournamentId differs from currentTournamentId', async () => {
    const db = fakeDB({ u1: { displayName: 'Alice', assignedTournamentId: 'other-tourney', assignedTeamName: 'Red' } });
    const users = await fetchAvailableUsers(db, { currentTournamentId: 'this-tourney' });
    assert.deepStrictEqual(users[0].assignedElsewhere, { tournamentId: 'other-tourney', teamName: 'Red' });
});

test('fetchAvailableUsers does not flag assignedElsewhere when currentTournamentId matches, or when currentTournamentId is null and nothing is assigned', async () => {
    const db = fakeDB({
        u1: { displayName: 'Alice', assignedTournamentId: 'this-tourney' },
        u2: { displayName: 'Bob' }
    });
    const users = await fetchAvailableUsers(db, { currentTournamentId: 'this-tourney' });
    assert.strictEqual(users.find(u => u.uid === 'u1').assignedElsewhere, null);
    assert.strictEqual(users.find(u => u.uid === 'u2').assignedElsewhere, null);
});

test('fetchAvailableUsers treats any assignedTournamentId as "elsewhere" when currentTournamentId is null (pre-creation setup context)', async () => {
    const db = fakeDB({ u1: { displayName: 'Alice', assignedTournamentId: 'some-tourney', assignedTeamName: 'Blue' } });
    const users = await fetchAvailableUsers(db, { currentTournamentId: null });
    assert.deepStrictEqual(users[0].assignedElsewhere, { tournamentId: 'some-tourney', teamName: 'Blue' });
});
