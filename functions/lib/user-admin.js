/**
 * Decision logic for the Admin SDK-backed user management callables.
 *
 * Everything that can be wrong lives here and depends on nothing
 * Firebase-shaped: `auth` and `db` are the narrow interfaces supplied by
 * lib/auth-adapter.js and lib/firestore-adapter.js, so this module is tested
 * against plain objects. index.js translates the returned codes into
 * HttpsError.
 *
 * Nothing the client claims about its own privileges is trusted: the caller's
 * rights are read from users/{callerUid}.isGod server-side. That document
 * field — not a custom claim — is deliberately the authority, because
 * firestore.rules already treats it as such and a second authority could
 * silently disagree with the first.
 */

const ROLES = ['user', 'player', 'admin', 'god'];

function fail(code, message) {
    return { ok: false, code, message };
}

/**
 * Shared gate for all three operations. Returns null when the caller may
 * proceed, or a failure result to return verbatim.
 *
 * `selfCheck` is off for create (there is no existing target) and on for
 * delete/disable, where operating on yourself is how an admin locks
 * themselves out.
 */
async function authorize({ db, callerUid, targetUid, selfCheck }) {
    if (!callerUid) {
        return fail('unauthenticated', 'You must be signed in.');
    }

    const caller = await db.users.get(callerUid);
    if (!caller || caller.isGod !== true) {
        return fail('permission-denied', 'Only god-level accounts can manage users.');
    }

    if (selfCheck) {
        if (typeof targetUid !== 'string' || targetUid.length === 0) {
            return fail('invalid-argument', 'A target user id is required.');
        }
        if (targetUid === callerUid) {
            return fail('failed-precondition', 'You cannot do this to your own account.');
        }

        const godUids = await db.users.listGodUids();
        const remainingGods = godUids.filter(uid => uid !== targetUid);
        if (godUids.includes(targetUid) && remainingGods.length === 0) {
            return fail('failed-precondition', 'This is the last god account. Promote someone else first.');
        }
    }

    return null;
}

/**
 * Deletes the Auth account, then the Firestore document.
 *
 * An Auth account that is already gone is not an error: that is exactly the
 * state of the fabricated `user_<timestamp>_<random>` documents the old
 * client-side create left behind, and refusing to clean those up would be
 * wrong. Any other Auth failure aborts before the document is touched, so the
 * two halves do not drift apart silently.
 *
 * Tournament data is left alone on purpose — match history and roster entries
 * keep the uid as a dead reference so the record stays truthful.
 */
async function deleteUser({ auth, db, callerUid, input }) {
    const uid = input && input.uid;
    const denial = await authorize({ db, callerUid, targetUid: uid, selfCheck: true });
    if (denial) return denial;

    let authAccountMissing = false;
    try {
        await auth.deleteUser(uid);
    } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
            authAccountMissing = true;
        } else {
            return fail('internal', `Could not delete the Auth account: ${err.message || err}`);
        }
    }

    try {
        await db.users.delete(uid);
    } catch (err) {
        return fail('internal', `Auth account deleted, but the user document could not be removed: ${err.message || err}`);
    }

    return { ok: true, uid, authAccountMissing };
}

/**
 * Sets the disabled flag where it actually enforces something — the Auth
 * account — and mirrors it to Firestore only so the status badge in the admin
 * table stays correct. The old Firestore-only version enforced nothing at all.
 *
 * On disable we also revoke refresh tokens: without that, someone already
 * signed in keeps a valid ID token for up to an hour after being locked out.
 * Re-enabling has nothing to revoke.
 */
async function setUserDisabled({ auth, db, callerUid, input }) {
    const uid = input && input.uid;
    const disabled = input && input.disabled;

    if (typeof disabled !== 'boolean') {
        // Authorization runs first even for a malformed flag, so an
        // unprivileged caller never learns anything from the difference
        // between "bad flag" and "bad uid". selfCheck is off here because the
        // only thing worth reporting at this point is the flag itself.
        const denial = await authorize({ db, callerUid, targetUid: uid, selfCheck: false });
        if (denial) return denial;
        return fail('invalid-argument', 'disabled must be true or false.');
    }

    const denial = await authorize({ db, callerUid, targetUid: uid, selfCheck: true });
    if (denial) return denial;

    try {
        await auth.setDisabled(uid, disabled);
        if (disabled) {
            await auth.revokeRefreshTokens(uid);
        }
    } catch (err) {
        return fail('internal', `Could not update the Auth account: ${err.message || err}`);
    }

    try {
        await db.users.update(uid, { disabled, updatedAt: new Date().toISOString() });
    } catch (err) {
        return fail('internal', `Auth account updated, but the user document could not be mirrored: ${err.message || err}`);
    }

    return { ok: true, uid, disabled };
}

/**
 * The hierarchical role model the admin form has always used: a god is also an
 * admin and a player, an admin is also a player. Kept identical to the
 * client's update branch so create and edit cannot drift apart.
 */
function roleFlags(role) {
    return {
        isGod: role === 'god',
        isAdmin: role === 'admin' || role === 'god',
        isPlayer: role === 'player' || role === 'admin' || role === 'god'
    };
}

/**
 * Creates a real Auth account and its user document.
 *
 * If the document write fails, the Auth account is deleted again: a half
 * created user — an account that can sign in but has no document, so no role
 * and no visibility in the admin table — is worse than a clean failure. The
 * compensating delete is best-effort; if it also fails the error message says
 * so, because at that point a human has to look.
 */
async function createUser({ auth, db, callerUid, input }) {
    const denial = await authorize({ db, callerUid, selfCheck: false });
    if (denial) return denial;

    const email = typeof input?.email === 'string' ? input.email.trim() : '';
    const password = input?.password;
    const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
    const role = input?.role;
    const enabled = input?.enabled !== false;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return fail('invalid-argument', 'A valid email address is required.');
    }
    if (typeof password !== 'string' || password.length < 6) {
        // Firebase Auth's own minimum; rejecting here gives a clearer message
        // than the SDK's auth/weak-password after an account attempt.
        return fail('invalid-argument', 'Password must be at least 6 characters.');
    }
    if (!displayName) {
        return fail('invalid-argument', 'A display name is required.');
    }
    if (!ROLES.includes(role)) {
        return fail('invalid-argument', `Role must be one of: ${ROLES.join(', ')}.`);
    }

    let uid;
    try {
        const created = await auth.createUser({ email, password, displayName });
        uid = created.uid;
        if (!enabled) {
            await auth.setDisabled(uid, true);
        }
    } catch (err) {
        if (uid) {
            // The account exists but could not be disabled as asked. Roll it
            // back rather than hand back an account that is live when the
            // admin explicitly said it should not be.
            try { await auth.deleteUser(uid); } catch (_) { /* the original error is the useful one */ }
        }
        return fail('internal', `Could not create the Auth account: ${err.message || err}`);
    }

    const now = new Date().toISOString();
    try {
        await db.users.set(uid, {
            email,
            displayName,
            disabled: !enabled,
            ...roleFlags(role),
            createdAt: now,
            updatedAt: now
        });
    } catch (err) {
        try {
            await auth.deleteUser(uid);
        } catch (cleanupErr) {
            return fail('internal', `Could not write the user document (${err.message || err}) and the orphaned Auth account ${uid} could not be removed either (${cleanupErr.message || cleanupErr}). Delete it by hand in the Firebase console.`);
        }
        return fail('internal', `Could not write the user document, so the Auth account was rolled back: ${err.message || err}`);
    }

    return { ok: true, uid };
}

module.exports = { authorize, deleteUser, setUserDisabled, createUser, roleFlags };
