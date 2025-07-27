// Connect 4 page using Firebase Firestore for real‑time matchmaking and game
// state. Like the Tic‑Tac‑Toe page, this implementation relies
// entirely on Firestore: each game is stored as a document in
// 'connect4Games' with the board, turn, winner/draw etc. A
// subcollection 'messages' holds chat messages.

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

// DOM references
const backBtn = document.getElementById('back-btn');
const statusDiv = document.getElementById('status');
const boardDiv = document.getElementById('board');
const chatMessagesDiv = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send');
const userInfoDiv = document.getElementById('user-info');
const userNameSpan = document.getElementById('user-name');
const userCoinsSpan = document.getElementById('user-coins');
const logoutBtn = document.getElementById('logout-btn');

// User data
const uid = localStorage.getItem('duoUserId');
const displayName = localStorage.getItem('duoDisplayName');
const selectedColor = localStorage.getItem('duoSelectedColor') || '#0084ff';
if (!uid) {
  window.location.href = '/';
}
userNameSpan.textContent = displayName;
const initialCoins2 = parseInt(localStorage.getItem('duoCoins') || '0', 10);
userCoinsSpan.textContent = ` — Pièces: ${initialCoins2}`;
userInfoDiv.classList.remove('hidden');

// Logout and navigation
logoutBtn.addEventListener('click', async () => {
  try {
    await auth.signOut();
    window.location.href = '/';
  } catch (err) {
    alert('Erreur lors de la déconnexion: ' + err.message);
  }
});
backBtn.addEventListener('click', () => {
  window.location.href = '/';
});

// Board dimensions
const rows = 6;
const cols = 7;
function initBoard() {
  boardDiv.innerHTML = '';
  boardDiv.style.gridTemplateColumns = `repeat(${cols}, 60px)`;
  boardDiv.style.gridTemplateRows = `repeat(${rows}, 60px)`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.row = r;
      cell.dataset.col = c;
      boardDiv.appendChild(cell);
    }
  }
}
initBoard();

// Game variables
let gameId = null;
let myIndex = null;
let symbol = null; // 'R' or 'Y'
let rewarded = false;
let unsubGame = null;
let unsubChat = null;

// Helper to check for connect‑4 winner
function checkConnect4Winner(board) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      for (const [dr, dc] of directions) {
        let count = 1;
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
          if (board[nr][nc] === cell) {
            count++;
          } else {
            break;
          }
        }
        if (count >= 4) return cell;
      }
    }
  }
  return null;
}

// Join or create game
async function joinGame() {
  const gamesRef = db.collection('connect4Games');
  try {
    const waiting = await gamesRef.where('status', '==', 'waiting').orderBy('createdAt').limit(1).get();
    if (!waiting.empty) {
      const doc = waiting.docs[0];
      gameId = doc.id;
      myIndex = 1;
      symbol = 'Y';
      await doc.ref.update({
        secondPlayerId: uid,
        secondPlayerName: displayName,
        status: 'playing'
      });
    } else {
      // create board
      const board = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push('');
        board.push(row);
      }
      const newDoc = await gamesRef.add({
        firstPlayerId: uid,
        firstPlayerName: displayName,
        status: 'waiting',
        board: board,
        currentTurn: 0,
        winner: null,
        draw: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      gameId = newDoc.id;
      myIndex = 0;
      symbol = 'R';
    }
    subscribeToGame();
    subscribeToChat();
  } catch (err) {
    console.error('Erreur lors de la jonction du jeu:', err);
  }
}

function subscribeToGame() {
  const gameRef = db.collection('connect4Games').doc(gameId);
  unsubGame = gameRef.onSnapshot(doc => {
    const data = doc.data();
    if (!data) return;
    updateBoard(data.board);
    if (data.status === 'waiting') {
      statusDiv.textContent = "En attente d'un adversaire...";
    } else {
      updateTurnInfo(data.currentTurn, data.winner, data.draw);
    }
    if ((data.winner || data.draw) && !rewarded) {
      handleGameEnd(data.winner, data.draw);
    }
  });
}

function subscribeToChat() {
  const msgRef = db.collection('connect4Games').doc(gameId).collection('messages').orderBy('timestamp');
  unsubChat = msgRef.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const m = change.doc.data();
        addChatMessage(m.message, { id: m.userId, name: m.name, color: m.color });
      }
    });
  });
}

// Handle board click: determine column and attempt move
boardDiv.addEventListener('click', async e => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const col = parseInt(cell.dataset.col, 10);
  await makeMove(col);
});

async function makeMove(col) {
  if (rewarded) return;
  const gameRef = db.collection('connect4Games').doc(gameId);
  try {
    await db.runTransaction(async tx => {
      const doc = await tx.get(gameRef);
      const data = doc.data();
      if (!data) return;
      if (data.winner || data.draw) return;
      if (data.currentTurn !== myIndex) return;
      const board = data.board.map(r => r.slice());
      // Find lowest empty row in this column
      let placedRow = -1;
      for (let r = rows - 1; r >= 0; r--) {
        if (!board[r][col]) {
          board[r][col] = symbol;
          placedRow = r;
          break;
        }
      }
      if (placedRow === -1) return; // column full
      const winner = checkConnect4Winner(board);
      let draw = false;
      let nextTurn = data.currentTurn;
      if (!winner) {
        draw = board.every(row => row.every(cell => cell));
        if (!draw) {
          nextTurn = data.currentTurn === 0 ? 1 : 0;
        }
      }
      tx.update(gameRef, {
        board: board,
        currentTurn: nextTurn,
        winner: winner || null,
        draw: draw
      });
    });
  } catch (err) {
    console.error('Erreur lors du déplacement:', err);
  }
}

function updateBoard(state) {
  const cells = boardDiv.children;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      const cell = cells[index];
      const val = state[r][c];
      cell.innerHTML = '';
      cell.classList.toggle('taken', !!val);
      if (val === 'R' || val === 'Y') {
        const disc = document.createElement('span');
        disc.classList.add('disc');
        disc.classList.add(val === 'R' ? 'red' : 'yellow');
        cell.appendChild(disc);
      }
    }
  }
}

function updateTurnInfo(currentTurn, winner, draw) {
  if (winner || draw) return;
  const colourName = symbol === 'R' ? 'Rouge' : 'Jaune';
  if (currentTurn === myIndex) {
    statusDiv.textContent = `C'est votre tour (${colourName}).`;
  } else {
    statusDiv.textContent = `Tour de l'adversaire.`;
  }
}

async function handleGameEnd(winner, draw) {
  if (rewarded) return;
  rewarded = true;
  if (draw) {
    statusDiv.textContent = 'Match nul.';
  } else if (winner === symbol) {
    statusDiv.textContent = 'Vous avez gagné !';
  } else {
    statusDiv.textContent = 'Vous avez perdu.';
  }
  let reward = 1;
  if (draw) reward = 2;
  else if (winner === symbol) reward = 5;
  try {
    await db
      .runTransaction(async tx => {
        const userRef = db.collection('users').doc(uid);
        const userDoc = await tx.get(userRef);
        const data = userDoc.data();
        const newCoins = (data.coins || 0) + reward;
        tx.update(userRef, { coins: newCoins });
        return newCoins;
      })
      .then(newCoins => {
        localStorage.setItem('duoCoins', newCoins.toString());
        userCoinsSpan.textContent = ` — Pièces: ${newCoins}`;
      });
  } catch (err) {
    console.error('Erreur lors de l\'attribution des pièces:', err);
  }
}

// Chat functions
function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  const msgRef = db.collection('connect4Games').doc(gameId).collection('messages');
  msgRef.add({
    userId: uid,
    name: displayName,
    color: selectedColor,
    message: text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
  chatInput.value = '';
}
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});

function addChatMessage(text, user) {
  const bubble = document.createElement('div');
  const isSelf = user.id === uid;
  bubble.classList.add('chat-bubble');
  bubble.classList.add(isSelf ? 'self' : 'other');
  if (isSelf) {
    bubble.style.background = selectedColor;
    bubble.style.color = '#fff';
  }
  const nameSpanEl = document.createElement('strong');
  nameSpanEl.textContent = user.name + ': ';
  bubble.appendChild(nameSpanEl);
  const messageSpan = document.createElement('span');
  messageSpan.textContent = text;
  bubble.appendChild(messageSpan);
  chatMessagesDiv.appendChild(bubble);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Start: join the game
joinGame();