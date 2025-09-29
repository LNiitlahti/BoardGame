// scripts/firebase-loader.js

// Load Firebase compatibility scripts
document.addEventListener('DOMContentLoaded', function() {
    // First, load the CDN scripts
    loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js')
        .then(() => loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'))
        .then(() => loadScript('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'))
        .then(() => {
            console.log('Firebase SDK loaded successfully');
            
            // Create a replacement for the firebase.js functionality
            // This avoids the module loading issue but still leverages your existing firebase.js config
            const firebaseConfigScript = document.createElement('script');
            firebaseConfigScript.textContent = `
                // Fetch the Firebase config from your existing firebase.js file and initialize Firebase
                fetch('scripts/firebase.js')
                    .then(response => response.text())
                    .then(content => {
                        // Extract the firebaseConfig object from the file content
                        const configMatch = content.match(/const\\s+firebaseConfig\\s*=\\s*({[\\s\\S]*?});/);
                        if (configMatch && configMatch[1]) {
                            const configString = configMatch[1].replace(/\\s+/g, ' ');
                            const firebaseConfig = JSON.parse(configString.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":'));
                            
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
                            window.firebaseOnSnapshot = function(docRef, callback) {
                                return docRef.onSnapshot(callback);
                            };
                            window.firebaseCollection = function(db, collection) {
                                return db.collection(collection);
                            };
                            
                            console.log("Firebase initialized successfully");
                            
                            // Dispatch an event so we know Firebase is ready
                            document.dispatchEvent(new CustomEvent('firebase-ready'));
                            
                            // Update status if it exists
                            const status = document.getElementById('connectionStatus');
                            if (status) {
                                status.textContent = 'Firebase connected successfully!';
                                if (status.classList) {
                                    status.classList.remove('warning');
                                    status.classList.add('success');
                                }
                            }
                        } else {
                            throw new Error('Could not extract Firebase config from firebase.js');
                        }
                    })
                    .catch(error => {
                        console.error('Error loading Firebase config:', error);
                        const status = document.getElementById('connectionStatus');
                        if (status) {
                            status.textContent = 'Error initializing Firebase: ' + error.message;
                            if (status.classList) {
                                status.classList.remove('warning');
                                status.classList.add('error');
                            }
                        }
                    });
            `;
            document.head.appendChild(firebaseConfigScript);
        })
        .catch(error => {
            console.error('Error loading Firebase:', error);
            const status = document.getElementById('connectionStatus');
            if (status) {
                status.textContent = 'Error connecting to Firebase: ' + error.message;
                if (status.classList) {
                    status.classList.remove('warning');
                    status.classList.add('error');
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