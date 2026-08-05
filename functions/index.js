/**
 * Discord voice-channel moves.
 *
 * Triggers ONLY on tournaments/{tid}/discordCommands/{cmdId}. It must never
 * trigger on the tournament document: that doc is written on every gameplay
 * action, and this function writes back to it (lobbyReady), which would be
 * an unbounded self-retrigger loop.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const { createDiscordRest } = require('./lib/discord-rest');
const { createFirestoreDb } = require('./lib/firestore-adapter');
const { handleCommand } = require('./lib/command-handler');

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createAuthAdmin } = require('./lib/auth-adapter');
const userAdmin = require('./lib/user-admin');

admin.initializeApp();

const DISCORD_BOT_TOKEN = defineSecret('DISCORD_BOT_TOKEN');

// Cost backstop. This workload is a handful of invocations per match; a
// cap this low makes a runaway impossible while never throttling real use.
setGlobalOptions({ maxInstances: 3, region: 'europe-north1' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.onDiscordCommand = onDocumentCreated(
    {
        document: 'tournaments/{tournamentId}/discordCommands/{commandId}',
        secrets: [DISCORD_BOT_TOKEN],
        // The retry window is 2 minutes; allow headroom for it plus API latency.
        timeoutSeconds: 300,
        memory: '256MiB'
    },
    async event => {
        const snap = event.data;
        if (!snap) return;

        const command = snap.data();
        const { tournamentId } = event.params;

        const db = createFirestoreDb(admin.firestore());
        const rest = createDiscordRest({ token: DISCORD_BOT_TOKEN.value() });

        let outcome;
        try {
            outcome = await handleCommand({ db, rest, sleep, tournamentId, command });
        } catch (err) {
            console.error('[Discord] Command failed', err);
            outcome = { status: 'skipped', reason: 'error', error: String(err.message || err), results: [] };
        }

        try {
            await snap.ref.update({
                status: outcome.status,
                reason: outcome.reason || null,
                error: outcome.error || null,
                results: outcome.results || [],
                completedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error('[Discord] Could not write command result', err);
        }
    }
);

// =============================================================================
// ADMIN SDK-BACKED USER MANAGEMENT
// =============================================================================
// The god-mode panel used to do these three things from the browser, where it
// could only reach Firestore: deletes left the Auth account alive, "disable"
// enforced nothing, and "create" invented a uid that matched no real account.
// All of it happens here now, where the Admin SDK is available.

/**
 * Runs one user-admin operation and turns its result into a callable
 * response. Every rejection is already a plain { code, message } from the pure
 * module, so this is the only place HttpsError appears.
 */
async function runUserAdmin(operation, request) {
    const db = createFirestoreDb(admin.firestore());
    const auth = createAuthAdmin(admin.auth());
    const callerUid = request.auth ? request.auth.uid : null;

    const result = await operation({ auth, db, callerUid, input: request.data || {} });

    if (!result.ok) {
        console.warn('[UserAdmin] Rejected:', result.code, result.message);
        throw new HttpsError(result.code, result.message);
    }
    return result;
}

exports.adminCreateUser = onCall(request => runUserAdmin(userAdmin.createUser, request));
exports.adminSetUserDisabled = onCall(request => runUserAdmin(userAdmin.setUserDisabled, request));
exports.adminDeleteUser = onCall(request => runUserAdmin(userAdmin.deleteUser, request));
