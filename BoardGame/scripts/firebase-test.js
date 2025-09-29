/**
 * FIREBASE CONNECTION TEST
 * Simple test script to verify Firebase connection
 */

// Wait for DOMContentLoaded to ensure all scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    const connectionStatus = document.getElementById('connectionStatus') || document.createElement('div');
    connectionStatus.textContent = 'Testing Firebase connection...';
    
    // Wait for Firebase to initialize
    const checkFirebase = setInterval(() => {
        if (window.firebase && window.firebaseDB) {
            clearInterval(checkFirebase);
            
            // Successfully initialized
            connectionStatus.textContent = 'Firebase successfully connected!';
            connectionStatus.className = 'status success';
            
            // Try accessing Firestore
            testFirestore();
        }
    }, 500);
    
    // Timeout after 10 seconds
    setTimeout(() => {
        clearInterval(checkFirebase);
        if (!window.firebase || !window.firebaseDB) {
            connectionStatus.textContent = 'Failed to connect to Firebase within timeout period';
            connectionStatus.className = 'status error';
            
            // Log diagnostic information
            console.error('Firebase Connection Diagnostics:');
            console.error('window.firebase exists:', !!window.firebase);
            console.error('window.firebaseDB exists:', !!window.firebaseDB);
            
            if (window.firebase) {
                console.error('Firebase SDK Version:', window.firebase.SDK_VERSION);
            }
        }
    }, 10000);
    
    // Test Firestore access
    function testFirestore() {
        try {
            // Try to get a test document
            const testDoc = window.firebaseDoc(window.firebaseDB, 'test', 'connection_test');
            
            // Try to read/write
            window.firebaseGetDoc(testDoc)
                .then(docSnap => {
                    console.log('Successfully read from Firestore');
                    
                    // Update timestamp
                    return window.firebaseSetDoc(testDoc, {
                        timestamp: new Date().toISOString(),
                        test: 'Connection test successful'
                    });
                })
                .then(() => {
                    console.log('Successfully wrote to Firestore');
                    
                    // Show success
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'status success';
                    resultDiv.textContent = 'Firebase read/write test successful!';
                    document.body.appendChild(resultDiv);
                })
                .catch(error => {
                    console.error('Firestore read/write error:', error);
                    
                    // Show error
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'status error';
                    resultDiv.textContent = `Firestore error: ${error.message}`;
                    document.body.appendChild(resultDiv);
                });
        } catch (error) {
            console.error('Firebase test error:', error);
            
            // Show error
            const resultDiv = document.createElement('div');
            resultDiv.className = 'status error';
            resultDiv.textContent = `Firebase test error: ${error.message}`;
            document.body.appendChild(resultDiv);
        }
    }
});
