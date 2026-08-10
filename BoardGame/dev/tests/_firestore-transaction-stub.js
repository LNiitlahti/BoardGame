/**
 * Shared test stub for window.firebaseDB, covering the two Firestore shapes
 * undo-manager.js needs: runTransaction() (executeUndo's transactional
 * revert, see docs/superpowers/specs/2026-08-10-atomic-array-writes-design.md)
 * and the actionLog collection().doc().update() chain (_markAsUndone).
 *
 * The transaction's transaction.get() returns a JSON-cloned snapshot of
 * `getGameState()`'s CURRENT value (there's no real separate server state in
 * a unit test), and transaction.update() records the write and applies it
 * back onto the real gameState object via Object.assign -- mirroring what
 * undo-manager.js itself does after a real transaction commits, so existing
 * assertions against the test's own `gs` object keep working unchanged.
 *
 * @param {Object} gameState - the SAME object the test holds as `gs`
 * @param {Object} [opts]
 * @param {Function} [opts.actionLogUpdateSpy] - (docId, data) => void, for
 *   _markAsUndone's write
 * @returns {Object} a window.firebaseDB-shaped stub
 */
function makeFakeFirebaseDB(gameState, { actionLogUpdateSpy } = {}) {
    const spy = actionLogUpdateSpy || (() => {});
    // Generic no-op doc ref: covers logEvent()'s eventLog writes and any
    // other incidental subcollection write a converted function's existing
    // (unrelated) side effects might make -- only actionLog's update() is
    // ever asserted on, via actionLogUpdateSpy.
    const genericDocRef = { update: () => {}, set: () => {}, get: async () => ({ exists: false, data: () => null }) };
    return {
        collection: (name) => {
            if (name !== 'tournaments') throw new Error(`Unexpected top-level collection: ${name}`);
            return {
                doc: () => ({
                    collection: (subName) => ({
                        doc: (id) => subName === 'actionLog'
                            ? { update: (data) => spy(id, data) }
                            : genericDocRef
                    })
                })
            };
        },
        runTransaction: async (fn) => {
            const snapshot = JSON.parse(JSON.stringify(gameState));
            const transaction = {
                get: async () => ({ data: () => snapshot }),
                update: (ref, data) => { Object.assign(gameState, data); }
            };
            return fn(transaction);
        }
    };
}

module.exports = { makeFakeFirebaseDB };
