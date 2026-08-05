const test = require('node:test');
const assert = require('node:assert');
const { deleteUser, setUserDisabled, createUser, roleFlags } = require('../lib/user-admin');

/**
 * Minimal in-memory stand-in for the Firestore users surface. `docs` maps
 * uid -> document data; every mutation is recorded so tests can assert that a
 * rejected operation wrote nothing at all.
 */
function fakeDb(docs = {}) {
    const calls = [];
    return {
        calls,
        users: {
            async get(uid) { return docs[uid] || null; },
            async set(uid, data) { calls.push(['set', uid, data]); docs[uid] = data; },
            async update(uid, patch) { calls.push(['update', uid, patch]); docs[uid] = { ...(docs[uid] || {}), ...patch }; },
            async delete(uid) { calls.push(['delete', uid]); delete docs[uid]; },
            async listGodUids() { return Object.keys(docs).filter(uid => docs[uid].isGod === true); }
        }
    };
}

/**
 * Stand-in for the Admin SDK auth surface. `missing` lists uids that behave as
 * already-deleted, so we can exercise the auth/user-not-found path. `failOn`
 * names a method that should throw, for the compensation tests.
 */
function fakeAuth({ missing = [], failOn = null, newUid = 'uidNew' } = {}) {
    const calls = [];
    return {
        calls,
        async createUser(args) {
            calls.push(['createUser', args]);
            if (failOn === 'createUser') throw new Error('boom');
            return { uid: newUid };
        },
        async deleteUser(uid) {
            calls.push(['deleteUser', uid]);
            if (missing.includes(uid)) {
                const err = new Error('no user record');
                err.code = 'auth/user-not-found';
                throw err;
            }
            if (failOn === 'deleteUser') throw new Error('boom');
        },
        async setDisabled(uid, disabled) {
            calls.push(['setDisabled', uid, disabled]);
            if (failOn === 'setDisabled') throw new Error('boom');
        },
        async revokeRefreshTokens(uid) {
            calls.push(['revokeRefreshTokens', uid]);
            if (failOn === 'revokeRefreshTokens') throw new Error('boom');
        }
    };
}

const GOD = { isGod: true, isAdmin: true, isPlayer: true, displayName: 'God' };
const PLAYER = { isPlayer: true, displayName: 'Player' };

// =============================================================================
// deleteUser
// =============================================================================

test('deleteUser rejects an unauthenticated caller', async () => {
    const db = fakeDb({ uidTarget: PLAYER });
    const auth = fakeAuth();

    const result = await deleteUser({ auth, db, callerUid: null, input: { uid: 'uidTarget' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'unauthenticated');
    assert.deepStrictEqual(auth.calls, []);
    assert.deepStrictEqual(db.calls, []);
});

test('deleteUser rejects a caller who is not god', async () => {
    const db = fakeDb({ uidCaller: PLAYER, uidTarget: PLAYER });
    const auth = fakeAuth();

    const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'permission-denied');
    assert.deepStrictEqual(auth.calls, []);
    assert.deepStrictEqual(db.calls, []);
});

test('deleteUser rejects a caller with no user document', async () => {
    const db = fakeDb({ uidTarget: PLAYER });
    const auth = fakeAuth();

    const result = await deleteUser({ auth, db, callerUid: 'uidGhost', input: { uid: 'uidTarget' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'permission-denied');
});

test('deleteUser rejects a missing or non-string target uid', async () => {
    const db = fakeDb({ uidCaller: GOD });
    const auth = fakeAuth();

    for (const uid of [undefined, '', 42, {}]) {
        const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid } });
        assert.strictEqual(result.ok, false, `uid ${JSON.stringify(uid)} should be rejected`);
        assert.strictEqual(result.code, 'invalid-argument');
    }
    assert.deepStrictEqual(auth.calls, []);
    assert.deepStrictEqual(db.calls, []);
});

test('deleteUser refuses to let a god delete themselves', async () => {
    const db = fakeDb({ uidCaller: GOD, uidOther: GOD });
    const auth = fakeAuth();

    const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidCaller' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'failed-precondition');
    assert.deepStrictEqual(auth.calls, []);
    assert.deepStrictEqual(db.calls, []);
});

test('deleteUser refuses to delete the last remaining god', async () => {
    // The caller must be a god to get past authorization at all, so this is
    // the case where a god deletes a *different* account that happens to be
    // the only one holding god rights — e.g. the caller was demoted in another
    // tab. listGodUids is stubbed directly to describe exactly that state.
    const db = fakeDb({ uidCaller: GOD, uidTarget: GOD });
    db.users.listGodUids = async () => ['uidTarget'];
    const auth = fakeAuth();

    const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'failed-precondition');
    assert.deepStrictEqual(auth.calls, []);
    assert.deepStrictEqual(db.calls, []);
});

test('deleteUser deletes the Auth account and then the Firestore document', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: PLAYER });
    const auth = fakeAuth();

    const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget' } });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(auth.calls, [['deleteUser', 'uidTarget']]);
    assert.deepStrictEqual(db.calls, [['delete', 'uidTarget']]);
});

test('deleteUser still deletes the document when the Auth account is already gone', async () => {
    const db = fakeDb({ uidCaller: GOD, user_1234_abc: PLAYER });
    const auth = fakeAuth({ missing: ['user_1234_abc'] });

    const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid: 'user_1234_abc' } });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.authAccountMissing, true);
    assert.deepStrictEqual(db.calls, [['delete', 'user_1234_abc']]);
});

test('deleteUser reports an Auth failure that is not user-not-found without deleting the document', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: PLAYER });
    const auth = fakeAuth({ failOn: 'deleteUser' });

    const result = await deleteUser({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'internal');
    assert.deepStrictEqual(db.calls, []);
});

// =============================================================================
// setUserDisabled
// =============================================================================

test('setUserDisabled disables Auth, revokes tokens, and mirrors to Firestore', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: PLAYER });
    const auth = fakeAuth();

    const result = await setUserDisabled({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget', disabled: true } });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(auth.calls, [
        ['setDisabled', 'uidTarget', true],
        ['revokeRefreshTokens', 'uidTarget']
    ]);
    assert.strictEqual(db.calls.length, 1);
    assert.strictEqual(db.calls[0][0], 'update');
    assert.strictEqual(db.calls[0][1], 'uidTarget');
    assert.strictEqual(db.calls[0][2].disabled, true);
    assert.strictEqual(typeof db.calls[0][2].updatedAt, 'string');
});

test('setUserDisabled re-enabling does not revoke tokens', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: { ...PLAYER, disabled: true } });
    const auth = fakeAuth();

    const result = await setUserDisabled({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget', disabled: false } });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(auth.calls, [['setDisabled', 'uidTarget', false]]);
    assert.strictEqual(db.calls[0][2].disabled, false);
});

test('setUserDisabled rejects a non-boolean disabled flag', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: PLAYER });
    const auth = fakeAuth();

    const result = await setUserDisabled({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget', disabled: 'yes' } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'invalid-argument');
    assert.deepStrictEqual(auth.calls, []);
});

test('setUserDisabled refuses to disable the last remaining god', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: GOD });
    db.users.listGodUids = async () => ['uidTarget'];
    const auth = fakeAuth();

    const result = await setUserDisabled({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget', disabled: true } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'failed-precondition');
    assert.deepStrictEqual(auth.calls, []);
});

test('setUserDisabled refuses to disable yourself', async () => {
    const db = fakeDb({ uidCaller: GOD, uidOther: GOD });
    const auth = fakeAuth();

    const result = await setUserDisabled({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidCaller', disabled: true } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'failed-precondition');
});

test('setUserDisabled reports an Auth failure without mirroring to Firestore', async () => {
    const db = fakeDb({ uidCaller: GOD, uidTarget: PLAYER });
    const auth = fakeAuth({ failOn: 'setDisabled' });

    const result = await setUserDisabled({ auth, db, callerUid: 'uidCaller', input: { uid: 'uidTarget', disabled: true } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'internal');
    assert.deepStrictEqual(db.calls, []);
});

// =============================================================================
// createUser
// =============================================================================

test('roleFlags computes hierarchical flags', () => {
    assert.deepStrictEqual(roleFlags('god'), { isGod: true, isAdmin: true, isPlayer: true });
    assert.deepStrictEqual(roleFlags('admin'), { isGod: false, isAdmin: true, isPlayer: true });
    assert.deepStrictEqual(roleFlags('player'), { isGod: false, isAdmin: false, isPlayer: true });
    assert.deepStrictEqual(roleFlags('user'), { isGod: false, isAdmin: false, isPlayer: false });
});

test('createUser creates the Auth account then writes the document', async () => {
    const db = fakeDb({ uidCaller: GOD });
    const auth = fakeAuth({ newUid: 'uidReal' });

    const result = await createUser({
        auth, db, callerUid: 'uidCaller',
        input: { email: 'new@example.com', password: 'hunter22', displayName: 'New Person', role: 'admin', enabled: true }
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.uid, 'uidReal');
    assert.deepStrictEqual(auth.calls, [
        ['createUser', { email: 'new@example.com', password: 'hunter22', displayName: 'New Person' }]
    ]);

    assert.strictEqual(db.calls.length, 1);
    const [op, uid, data] = db.calls[0];
    assert.strictEqual(op, 'set');
    assert.strictEqual(uid, 'uidReal');
    assert.strictEqual(data.email, 'new@example.com');
    assert.strictEqual(data.displayName, 'New Person');
    assert.strictEqual(data.disabled, false);
    assert.strictEqual(data.isGod, false);
    assert.strictEqual(data.isAdmin, true);
    assert.strictEqual(data.isPlayer, true);
    assert.strictEqual(typeof data.createdAt, 'string');
    assert.strictEqual(typeof data.updatedAt, 'string');
});

test('createUser disables the Auth account when enabled is false', async () => {
    const db = fakeDb({ uidCaller: GOD });
    const auth = fakeAuth({ newUid: 'uidReal' });

    const result = await createUser({
        auth, db, callerUid: 'uidCaller',
        input: { email: 'new@example.com', password: 'hunter22', displayName: 'New Person', role: 'user', enabled: false }
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(auth.calls[1], ['setDisabled', 'uidReal', true]);
    assert.strictEqual(db.calls[0][2].disabled, true);
});

test('createUser rejects a caller who is not god', async () => {
    const db = fakeDb({ uidCaller: PLAYER });
    const auth = fakeAuth();

    const result = await createUser({
        auth, db, callerUid: 'uidCaller',
        input: { email: 'new@example.com', password: 'hunter22', displayName: 'New Person', role: 'user', enabled: true }
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'permission-denied');
    assert.deepStrictEqual(auth.calls, []);
});

test('createUser rejects bad input before touching Auth', async () => {
    const db = fakeDb({ uidCaller: GOD });
    const base = { email: 'new@example.com', password: 'hunter22', displayName: 'New Person', role: 'user', enabled: true };

    const cases = [
        { ...base, email: '' },
        { ...base, email: 'not-an-email' },
        { ...base, password: 'short' },
        { ...base, password: 12345678 },
        { ...base, displayName: '   ' },
        { ...base, role: 'wizard' }
    ];

    for (const input of cases) {
        const auth = fakeAuth();
        const result = await createUser({ auth, db, callerUid: 'uidCaller', input });
        assert.strictEqual(result.ok, false, `${JSON.stringify(input)} should be rejected`);
        assert.strictEqual(result.code, 'invalid-argument');
        assert.deepStrictEqual(auth.calls, []);
    }
});

test('createUser deletes the Auth account when the Firestore write fails', async () => {
    const db = fakeDb({ uidCaller: GOD });
    db.users.set = async () => { throw new Error('firestore down'); };
    const auth = fakeAuth({ newUid: 'uidReal' });

    const result = await createUser({
        auth, db, callerUid: 'uidCaller',
        input: { email: 'new@example.com', password: 'hunter22', displayName: 'New Person', role: 'user', enabled: true }
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'internal');
    assert.deepStrictEqual(auth.calls, [
        ['createUser', { email: 'new@example.com', password: 'hunter22', displayName: 'New Person' }],
        ['deleteUser', 'uidReal']
    ]);
});

test('createUser reports an Auth creation failure', async () => {
    const db = fakeDb({ uidCaller: GOD });
    const auth = fakeAuth({ failOn: 'createUser' });

    const result = await createUser({
        auth, db, callerUid: 'uidCaller',
        input: { email: 'new@example.com', password: 'hunter22', displayName: 'New Person', role: 'user', enabled: true }
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'internal');
    assert.deepStrictEqual(db.calls, []);
});
