/**
 * Adapts the Admin SDK's Auth surface to the narrow interface user-admin.js
 * expects. Exists so that module can be tested against a plain object; every
 * method here is a one-liner. Mirrors firestore-adapter.js.
 */

function createAuthAdmin(auth) {
    return {
        async createUser({ email, password, displayName }) {
            const record = await auth.createUser({ email, password, displayName });
            return { uid: record.uid };
        },

        async deleteUser(uid) {
            await auth.deleteUser(uid);
        },

        async setDisabled(uid, disabled) {
            await auth.updateUser(uid, { disabled });
        },

        /**
         * Invalidates existing ID tokens so a just-disabled person loses their
         * session at the next token refresh (within the hour) rather than
         * keeping a live token until it happens to expire.
         */
        async revokeRefreshTokens(uid) {
            await auth.revokeRefreshTokens(uid);
        }
    };
}

module.exports = { createAuthAdmin };
