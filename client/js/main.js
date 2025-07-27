// Main script for the home page. Handles authentication, UI updates and
// persistent user data via Firestore. Other pages read user info from
// localStorage, which is populated when a user signs in here.

// TODO: Replace the firebaseConfig object below with your own Firebase
// project configuration. You can obtain this information from the
// Firebase console under Project settings > General > Your apps. Without
// replacing these values authentication will not work.
const firebaseConfig = {
  apiKey: "AIzaSyCCcUs3B8BlYNXbzPvdInDm2aZn2Rzk6pk",
  authDomain: "jeuxduo-d4835.firebaseapp.com",
  projectId: "jeuxduo-d4835",
  storageBucket: "jeuxduo-d4835.appspot.com",   // vérifie ce champ dans la console
  messagingSenderId: "458838128456",
  appId: "1:458838128456:web:f1762fd1721d3f15ef257d",
  measurementId: "G-19R5FBDFQ9"
};


// Initialise Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// DOM elements
const authSection = document.getElementById('auth-section');
const homeSection = document.getElementById('home-section');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfoDiv = document.getElementById('user-info');
const userNameSpan = document.getElementById('user-name');
const userCoinsSpan = document.getElementById('user-coins');

// Sign in using Google provider
loginBtn.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    alert('Erreur lors de la connexion: ' + err.message);
  }
});

// Sign out
logoutBtn.addEventListener('click', async () => {
  try {
    await auth.signOut();
  } catch (err) {
    alert('Erreur lors de la déconnexion: ' + err.message);
  }
});

// Listen for auth changes
auth.onAuthStateChanged(async user => {
  if (user) {
    // User logged in
    authSection.classList.add('hidden');
    homeSection.classList.remove('hidden');
    userInfoDiv.classList.remove('hidden');
    userNameSpan.textContent = user.displayName || 'Utilisateur';

    // Fetch or create user document
    const userDocRef = db.collection('users').doc(user.uid);
    let doc = await userDocRef.get();
    if (!doc.exists) {
      // Create new user with default values
      await userDocRef.set({
        coins: 0,
        purchasedColors: ['#0084ff'],
        selectedColor: '#0084ff'
      });
      doc = await userDocRef.get();
    }
    const data = doc.data();
    // Update coins display
    userCoinsSpan.textContent = ` — Pièces: ${data.coins}`;

    // Store essential data in localStorage so game pages can access it
    localStorage.setItem('duoUserId', user.uid);
    localStorage.setItem('duoDisplayName', user.displayName || 'Utilisateur');
    localStorage.setItem('duoCoins', data.coins.toString());
    localStorage.setItem('duoPurchasedColors', JSON.stringify(data.purchasedColors));
    localStorage.setItem('duoSelectedColor', data.selectedColor);
  } else {
    // User logged out
    authSection.classList.remove('hidden');
    homeSection.classList.add('hidden');
    userInfoDiv.classList.add('hidden');
    // Clear local storage
    localStorage.removeItem('duoUserId');
    localStorage.removeItem('duoDisplayName');
    localStorage.removeItem('duoCoins');
    localStorage.removeItem('duoPurchasedColors');
    localStorage.removeItem('duoSelectedColor');
  }
});