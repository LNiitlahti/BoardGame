  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
  import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-analytics.js";

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyDpt6oBgSLbTU-H-_7t_UC-Z4VzAJYHOwg",
    authDomain: "online-board-game-f6edd.firebaseapp.com",
    projectId: "online-board-game-f6edd",
    storageBucket: "online-board-game-f6edd.appspot.com",
    messagingSenderId: "846645349633",
    appId: "1:846645349633:web:6104a8f53299b5711a9f00",
    measurementId: "G-LBQKPS0TQ3"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const analytics = getAnalytics(app);
  // Expose Firestore helpers so main.js can use them
  window.firebaseDB = db;
  window.firebaseDoc = doc;
  window.firebaseSetDoc = setDoc;
  window.firebaseGetDoc = getDoc;
  window.firebaseOnSnapshot = onSnapshot;