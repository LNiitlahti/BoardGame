// scripts/firebase-loader.js

// Load Firebase compatibility scripts
document.addEventListener('DOMContentLoaded', function() {
    // First, load the CDN scripts
    loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js')
        .then(() => loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'))
        .then(() => loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'))
        .then(() => {
            console.log('Firebase SDK loaded successfully');
            
            // Fetch the Firebase config from your existing firebase.js file and initialize Firebase
            fetch('scripts/firebase.js')
                .then(response => response.text())
                .then(content => {
                    // Extract the firebaseConfig object from the file content
                    const configMatch = content.match(/const\s+firebaseConfig\s*=\s*({[\s\S]*?});/);
                    if (!configMatch || !configMatch[1]) {
                        throw new Error('Could not find Firebase configuration in the file');
                    }
                    
                    // Extract each field individually using regex (same as game.html approach)
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
                    
                    // Dispatch an event so we know Firebase is ready
                    document.dispatchEvent(new CustomEvent('firebase-ready'));
                    
                    // Update status if it exists
                    const status = document.getElementById('connectionStatus');
                    if (status) {
                        status.title = 'Firebase: Connected';
                        if (status.classList) {
                            status.classList.remove('disconnected', 'warning');
                            status.classList.add('connected');
                        }
                    }
                })
                .catch(error => {
                    console.error('Error loading Firebase config:', error);
                    const status = document.getElementById('connectionStatus');
                    if (status) {
                        status.title = 'Firebase: Error - ' + error.message;
                        if (status.classList) {
                            status.classList.remove('connected', 'warning');
                            status.classList.add('disconnected');
                        }
                    }
                });
        })
        .catch(error => {
            console.error('Error loading Firebase:', error);
            const status = document.getElementById('connectionStatus');
            if (status) {
                status.title = 'Firebase: Connection Error - ' + error.message;
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