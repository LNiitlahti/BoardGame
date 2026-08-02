// scripts/firebase-loader.js

// Load Firebase compatibility scripts
document.addEventListener('DOMContentLoaded', function() {
    // Load app-compat first (dependency), then firestore + auth + config fetch in PARALLEL
    loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js')
        .then(() => Promise.all([
            loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'),
            loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'),
            fetch((window.BOARDGAME_BASE || '.') + '/shared/scripts/firebase.js').then(r => r.text())
        ]))
        .then(([_fs, _auth, content]) => {
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

            // Serve reads from the local IndexedDB cache when the data is
            // already there instead of always hitting the network — cuts
            // read cost on page reloads and repeated one-time get() calls
            // for data that hasn't changed. persistentMultipleTabManager lets
            // it work even when a device has more than one tab of this app
            // open (e.g. admin.html + god.html side by side) instead of just
            // failing for every tab after the first.
            //
            // Migrated off the deprecated enableMultiTabIndexedDbPersistence-
            // style enablePersistence({synchronizeTabs:true}) call: it was
            // implicated in multi-second (10-39s) UI freezes on player-swap/
            // delete actions with several tabs open, coinciding with
            // "Failed to obtain primary lease" console errors — the old
            // API's single-primary-tab lease contention. settings({cache})
            // is the SDK's own suggested replacement.
            try {
                db.settings({
                    cache: {
                        kind: 'persistent',
                        tabManager: firebase.firestore.persistentMultipleTabManager()
                    }
                });
            } catch (err) {
                console.warn('[Firebase] Persistent multi-tab cache unavailable, falling back to memory cache:', err.message);
            }

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
