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
