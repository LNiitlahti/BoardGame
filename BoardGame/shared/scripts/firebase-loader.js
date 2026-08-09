// scripts/firebase-loader.js

// Load Firebase compatibility scripts
document.addEventListener('DOMContentLoaded', function() {
    // Load app-compat first (dependency), then firestore + auth + config fetch in PARALLEL
    loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js')
        .then(() => Promise.all([
            loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'),
            loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'),
            loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-functions-compat.js'),
            fetch((window.BOARDGAME_BASE || '.') + '/shared/scripts/firebase.js').then(r => r.text())
        ]))
        .then(([_fs, _auth, _fn, content]) => {
            console.log('Firebase SDK loaded successfully');

            // Extract the firebaseConfig object from the file content
            const configMatch = content.match(/const\s+firebaseConfig\s*=\s*({[\s\S]*?});/);
            if (!configMatch || !configMatch[1]) {
                throw new Error('Could not find Firebase configuration in the file');
            }

            // Extract each field individually using regex
            const configText = configMatch[1];
            const apiKeyMatch = configText.match(/apiKey:\s*["']([^"']+)["']/);
            const authDomainMatch = configText.match(/authDomain:\s*["']([^"']+)["']/);
            const projectIdMatch = configText.match(/projectId:\s*["']([^"']+)["']/);
            const storageBucketMatch = configText.match(/storageBucket:\s*["']([^"']+)["']/);
            const messagingSenderIdMatch = configText.match(/messagingSenderId:\s*["']([^"']+)["']/);
            const appIdMatch = configText.match(/appId:\s*["']([^"']+)["']/);
            const measurementIdMatch = configText.match(/measurementId:\s*["']([^"']+)["']/);

            // Create the configuration object manually
            const firebaseConfig = {
                apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
                authDomain: authDomainMatch ? authDomainMatch[1] : '',
                projectId: projectIdMatch ? projectIdMatch[1] : '',
                storageBucket: storageBucketMatch ? storageBucketMatch[1] : '',
                messagingSenderId: messagingSenderIdMatch ? messagingSenderIdMatch[1] : '',
                appId: appIdMatch ? appIdMatch[1] : '',
                measurementId: measurementIdMatch ? measurementIdMatch[1] : ''
            };

            // Initialize Firebase with the extracted config
            firebase.initializeApp(firebaseConfig);

            // Get Firestore instance
            const db = firebase.firestore();

            // Offline/local-cache persistence is intentionally left OFF here —
            // do not re-enable it without reading this comment in full.
            //
            // History: this used to call the deprecated
            // enablePersistence({synchronizeTabs:true}) (== compat's
            // enableMultiTabIndexedDbPersistence()) to serve reads from
            // IndexedDB across multiple open tabs (e.g. admin.html + god.html
            // side by side). That was confirmed via e2e-multitab-freeze.js to
            // cause multi-second (10-39s) UI freezes on player-swap/delete
            // actions with several tabs open, coinciding with "Failed to
            // obtain primary lease" console errors — the old API's
            // single-primary-tab lease contention.
            //
            // A later pass "migrated" this to db.settings({cache: {kind:
            // 'persistent', tabManager: firebase.firestore
            // .persistentMultipleTabManager()}}), believing that to be the
            // SDK's modern FirestoreSettings.cache replacement. That call was
            // silently broken: firebase.firestore.persistentMultipleTabManager
            // does not exist anywhere in the *compat* build (verified against
            // both firebase-firestore-compat.js 9.22.0, the version this app
            // loads, and the current 11.x compat build) — only the modular
            // `firebase/firestore` ESM package exports it. Referencing it
            // threw a TypeError before db.settings() was ever reached, so a
            // try/catch there silently fell back to the default in-memory
            // cache on every load, while a comment right above it claimed
            // multi-tab persistence was active. It never was.
            //
            // The modern cache-config API (persistentLocalCache /
            // persistentMultipleTabManager / FirestoreSettings.cache) is
            // genuinely unavailable to a page built on the compat CDN
            // bundles this app loads (firebase-app-compat.js /
            // firebase-firestore-compat.js — see firebase-loader.js's script
            // loading above). It is a modular-SDK-only API, and the compat
            // and modular CDN bundles each carry their own private component
            // registry (no shared globalThis/Symbol.for registration was
            // found in either bundle), so loading the modular
            // firebase-firestore.js ESM alongside these compat scripts to
            // reach it would NOT actually attach to the same Firestore
            // instance compat's db.collection()/doc() calls use — every
            // helper below (firebaseCollection, firebaseDoc, etc.) is
            // compat-only surface. Getting off this warning for real needs a
            // full migration of this app off the compat SDK, which is a
            // separate, much larger project (see TODO.md), not something
            // fixable with a different settings() call shape.
            //
            // Until then: leaving persistence off avoids both the freeze bug
            // above AND the deprecation warning (compat's only working
            // persistence APIs, enableIndexedDbPersistence() and
            // enableMultiTabIndexedDbPersistence(), both still print the
            // "will be deprecated" warning when called — there's no
            // warning-free way to turn persistence on in compat). This is
            // also what has actually been running in production since the
            // broken migration above landed (the try/catch masked it), and
            // it was the config in place for the 2026 LAN event.

            // Expose Firestore helpers to window
            window.firebaseDB = db;
            window.firebaseDoc = function(db, collection, document) {
                return db.collection(collection).doc(document);
            };
            window.firebaseSetDoc = function(docRef, data) {
                return docRef.set(data);
            };
            window.firebaseGetDoc = function(docRef) {
                return docRef.get();
            };
            window.firebaseGetDocs = function(collectionRef) {
                return collectionRef.get();
            };
            window.firebaseOnSnapshot = function(docRef, callback, errorCallback) {
                return docRef.onSnapshot(callback, errorCallback);
            };
            window.firebaseCollection = function(db, ...pathSegments) {
                // Support both single collection and subcollection paths
                // e.g., firebaseCollection(db, 'games', gameId, 'actions')
                let ref = db;
                for (let i = 0; i < pathSegments.length; i += 2) {
                    ref = ref.collection(pathSegments[i]);
                    if (i + 1 < pathSegments.length) {
                        ref = ref.doc(pathSegments[i + 1]);
                    }
                }
                return ref;
            };
            window.firebaseQuery = function(collectionRef, ...queryConstraints) {
                // Apply query constraints (orderBy, limit, where, etc.)
                let query = collectionRef;
                queryConstraints.forEach(constraint => {
                    if (constraint) {
                        query = constraint(query);
                    }
                });
                return query;
            };
            window.firebaseOrderBy = function(field, direction = 'asc') {
                return (query) => query.orderBy(field, direction);
            };
            window.firebaseLimit = function(count) {
                return (query) => query.limit(count);
            };
            window.firebaseWhere = function(field, operator, value) {
                return (query) => query.where(field, operator, value);
            };

            // Callable Cloud Functions, used by the god-mode user management
            // panel. The region is mandatory: the functions are deployed to
            // europe-north1 (see setGlobalOptions in functions/index.js) and
            // the default us-central1 endpoint would 404.
            window.firebaseFunctions = firebase.app().functions('europe-north1');

            console.log("Firebase initialized successfully");

            // Wait for Firebase to restore any persisted session before
            // deciding whether to sign in anonymously. Using onAuthStateChanged
            // avoids the race where signInAnonymously() overwrites a real
            // email/password session that hasn't loaded yet.
            const auth = firebase.auth();
            let authHandled = false;
            auth.onAuthStateChanged(user => {
                if (authHandled) return; // Only handle the first callback
                authHandled = true;

                if (user) {
                    // Already signed in (persisted session — real or anonymous)
                    firebaseReady();
                } else {
                    // No session at all — sign in anonymously for read-only pages
                    auth.signInAnonymously()
                        .then(() => firebaseReady())
                        .catch(error => {
                            console.error('Anonymous auth failed:', error);
                            firebaseReady(); // Still fire event — let pages handle auth errors
                        });
                }
            });

            function firebaseReady() {
                document.dispatchEvent(new CustomEvent('firebase-ready'));

                const status = document.getElementById('connectionStatus');
                if (status) {
                    status.title = 'Firebase: Connected';
                    if (status.classList) {
                        status.classList.remove('disconnected', 'warning');
                        status.classList.add('connected');
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error loading Firebase:', error);
            const status = document.getElementById('connectionStatus');
            if (status) {
                status.title = 'Firebase: Error - ' + error.message;
                if (status.classList) {
                    status.classList.remove('connected', 'warning');
                    status.classList.add('disconnected');
                }
            }
        });
});

// Helper function to load a script
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}
