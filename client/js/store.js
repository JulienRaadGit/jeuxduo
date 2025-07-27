// Store page script. Displays available bubble colours and lets users
// purchase and equip them using coins stored in Firestore. Requires
// authentication; redirects to home if not logged in.

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// DOM elements
const backBtn = document.getElementById('back-btn');
const userInfoDiv = document.getElementById('user-info');
const userNameSpan = document.getElementById('user-name');
const userCoinsSpan = document.getElementById('user-coins');
const logoutBtn = document.getElementById('logout-btn');
const storeGrid = document.getElementById('store-grid');

// User data
const uid = localStorage.getItem('duoUserId');
const displayName = localStorage.getItem('duoDisplayName');
if (!uid) {
  window.location.href = '/';
}

// Colours available in store
const colourItems = [
  { color: '#e53935', price: 5, name: 'Rouge' },
  { color: '#d81b60', price: 5, name: 'Rose' },
  { color: '#8e24aa', price: 5, name: 'Violet' },
  { color: '#3949ab', price: 5, name: 'Indigo' },
  { color: '#00897b', price: 5, name: 'Turquoise' },
  { color: '#f4511e', price: 5, name: 'Orange' },
  { color: '#fdd835', price: 5, name: 'Jaune' },
  { color: '#43a047', price: 5, name: 'Vert' },
  { color: '#795548', price: 5, name: 'Brun' }
];

// Initial user data from localStorage (will refresh from Firestore)
let coins = parseInt(localStorage.getItem('duoCoins') || '0', 10);
let purchasedColours = [];
let selectedColour = '#0084ff';

// Render UI
async function loadUserData() {
  userNameSpan.textContent = displayName;
  userInfoDiv.classList.remove('hidden');
  // Load data from Firestore
  try {
    const doc = await db.collection('users').doc(uid).get();
    const data = doc.data();
    coins = data.coins || 0;
    purchasedColours = data.purchasedColors || ['#0084ff'];
    selectedColour = data.selectedColor || '#0084ff';
    // Update localStorage for other pages
    localStorage.setItem('duoCoins', coins.toString());
    localStorage.setItem('duoPurchasedColors', JSON.stringify(purchasedColours));
    localStorage.setItem('duoSelectedColor', selectedColour);
    userCoinsSpan.textContent = ` — Pièces: ${coins}`;
    renderStore();
  } catch (err) {
    console.error('Erreur lors du chargement des données utilisateur:', err);
  }
}

function renderStore() {
  storeGrid.innerHTML = '';
  colourItems.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('store-item');
    const preview = document.createElement('div');
    preview.classList.add('color-preview');
    preview.style.background = item.color;
    wrapper.appendChild(preview);
    const nameEl = document.createElement('div');
    nameEl.textContent = item.name;
    wrapper.appendChild(nameEl);
    const priceEl = document.createElement('div');
    priceEl.textContent = `${item.price} pièces`;
    wrapper.appendChild(priceEl);
    const btn = document.createElement('button');
    let state;
    if (selectedColour === item.color) {
      btn.textContent = 'Équipé';
      btn.disabled = true;
      state = 'equipped';
    } else if (purchasedColours.includes(item.color)) {
      btn.textContent = 'Équiper';
      state = 'owned';
    } else {
      btn.textContent = `Acheter`; // Price shown separately
      state = 'available';
    }
    btn.classList.add('btn');
    btn.classList.add('primary');
    btn.addEventListener('click', () => handleStoreAction(item, state));
    wrapper.appendChild(btn);
    storeGrid.appendChild(wrapper);
  });
}

async function handleStoreAction(item, state) {
  if (state === 'equipped') return;
  if (state === 'owned') {
    // Equip the colour
    try {
      await db.collection('users').doc(uid).update({ selectedColor: item.color });
      selectedColour = item.color;
      localStorage.setItem('duoSelectedColor', selectedColour);
      renderStore();
      alert(`Couleur ${item.name} équipée !`);
    } catch (err) {
      console.error('Erreur lors de l\'équipement:', err);
    }
  } else if (state === 'available') {
    // Purchase
    if (coins < item.price) {
      alert('Vous n\'avez pas assez de pièces.');
      return;
    }
    try {
      await db.runTransaction(async tx => {
        const userRef = db.collection('users').doc(uid);
        const doc = await tx.get(userRef);
        const data = doc.data();
        const newCoins = (data.coins || 0) - item.price;
        const newColours = data.purchasedColors || [];
        if (!newColours.includes(item.color)) newColours.push(item.color);
        tx.update(userRef, {
          coins: newCoins,
          purchasedColors: newColours
        });
        coins = newCoins;
        purchasedColours = newColours;
      });
      localStorage.setItem('duoCoins', coins.toString());
      localStorage.setItem('duoPurchasedColors', JSON.stringify(purchasedColours));
      userCoinsSpan.textContent = ` — Pièces: ${coins}`;
      renderStore();
      alert(`Couleur ${item.name} achetée !`);
    } catch (err) {
      console.error('Erreur lors de l\'achat:', err);
    }
  }
}

// Back and logout handlers
backBtn.addEventListener('click', () => {
  window.location.href = '/';
});
logoutBtn.addEventListener('click', async () => {
  try {
    await auth.signOut();
    window.location.href = '/';
  } catch (err) {
    alert('Erreur lors de la déconnexion: ' + err.message);
  }
});

// Load user data on page load
loadUserData();