// restrict-access.js

document.addEventListener('firebase-ready', () => {
  const auth = firebase.auth();
  const content = document.getElementById('content');

  // Hide content initially
  if (content) content.style.display = 'none';

  auth.onAuthStateChanged(user => {
    if (!user) {
      // Redirect logged-out users immediately
      window.location.href = 'index.html';
    } else {
      // Show page content for logged-in users
      if (content) content.style.display = 'block';
    }
  });
});
