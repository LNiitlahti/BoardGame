// scripts/firebase-loader.js

// Dynamically load Firebase SDKs
function loadFirebaseSDKs() {
    const sdks = [
        'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
        'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'
    ];
    
    return Promise.all(sdks.map(src => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }));
}

// Load SDKs then initialize Firebase
loadFirebaseSDKs().then(() => {
    // Now load your firebase.js config
    const configScript = document.createElement('script');
    configScript.src = 'scripts/firebase.js';
    document.head.appendChild(configScript);
}).catch(error => {
    console.error('Failed to load Firebase SDKs:', error);
});