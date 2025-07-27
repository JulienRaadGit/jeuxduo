// Tic‑Tac‑Toe page using Firebase Firestore for real‑time synchronisation.
// This version avoids the need for a custom WebSocket server. Players
// join or create a game document in the 'tictactoeGames' collection. The
// game state (board, current turn, winner/draw) is stored in the
// document. Chat messages are stored in a subcollection of the game.

const firebaseConfig = {
  apiKey: "AIzaSyCCcUs3B8BlYNXbzPvdInDm2aZn2Rzk6pk",
  authDomain: "jeuxduo-d4835.firebaseapp.com",
  projectId: "jeuxduo-d4835",
  storageBucket: "jeuxduo-d4835.appspot.com",   // vérifie ce champ dans la console
  messagingSenderId: "458838128456",
  appId: "1:458838128456:web:f1762fd1721d3f15ef257d",
  measurementId: "G-19R5FBDFQ9"
};


if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// DOM elements
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

// Retrieve user data
const uid = localStorage.getItem('duoUserId');
const displayName = localStorage.getItem('duoDisplayName');
const selectedColor = localStorage.getItem('duoSelectedColor') || '#0084ff';
if (!uid) {
  window.location.href = '/';
}

// Display user info
userNameSpan.textContent = displayName;
const initialCoins = parseInt(localStorage.getItem('duoCoins') || '0', 10);
userCoinsSpan.textContent = ` — Pièces: ${initialCoins}`;
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

// Generate the board grid
function initBoard() {
  boardDiv.innerHTML = '';
  boardDiv.style.gridTemplateColumns = 'repeat(3, 60px)';
  boardDiv.style.gridTemplateRows = 'repeat(3, 60px)';
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
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
let myIndex = null; // 0 or 1
let symbol = null; // 'X' or 'O'
let rewarded = false;
let unsubGame = null;
let unsubChat = null;

// Helper to determine winner
function checkWinner(board) {
  const lines = [
    // rows
    [board[0][0], board[0][1], board[0][2]],
    [board[1][0], board[1][1], board[1][2]],
    [board[2][0], board[2][1], board[2][2]],
    // cols
    [board[0][0], board[1][0], board[2][0]],
    [board[0][1], board[1][1], board[2][1]],
    [board[0][2], board[1][2], board[2][2]],
    // diagonals
    [board[0][0], board[1][1], board[2][2]],
    [board[0][2], board[1][1], board[2][0]]
  ];
  for (const line of lines) {
    if (line[0] && line[0] === line[1] && line[1] === line[2]) {
      return line[0];
    }
  }
  return null;
}

// Join or create a game
async function joinGame() {
  const gamesRef = db.collection('tictactoeGames');
  try {
    // Find waiting game
    const waiting = await gamesRef.where('status', '==', 'waiting').orderBy('createdAt').limit(1).get();
    if (!waiting.empty) {
      const doc = waiting.docs[0];
      gameId = doc.id;
      myIndex = 1;
      symbol = 'O';
      await doc.ref.update({
        secondPlayerId: uid,
        secondPlayerName: displayName,
        status: 'playing'
      });
    } else {
      // Create new game
      const newDoc = await gamesRef.add({
        firstPlayerId: uid,
        firstPlayerName: displayName,
        status: 'waiting',
        board: [
          ['', '', ''],
          ['', '', ''],
          ['', '', '']
        ],
        currentTurn: 0,
        winner: null,
        draw: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      gameId = newDoc.id;
      myIndex = 0;
      symbol = 'X';
    }
    subscribeToGame();
    subscribeToChat();
  } catch (err) {
    console.error('Erreur lors de la jonction du jeu:', err);
  }
}

// Subscribe to game document updates
function subscribeToGame() {
  const gameRef = db.collection('tictactoeGames').doc(gameId);
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

// Subscribe to chat messages
function subscribeToChat() {
  const messagesRef = db.collection('tictactoeGames').doc(gameId).collection('messages').orderBy('timestamp');
  unsubChat = messagesRef.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const m = change.doc.data();
        addChatMessage(m.message, { id: m.userId, name: m.name, color: m.color });
      }
    });
  });
}

// Board click handler
boardDiv.addEventListener('click', async e => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const row = parseInt(cell.dataset.row, 10);
  const col = parseInt(cell.dataset.col, 10);
  await makeMove(row, col);
});

async function makeMove(row, col) {
  if (rewarded) return;
  const gameRef = db.collection('tictactoeGames').doc(gameId);
  try {
    await db.runTransaction(async tx => {
      const doc = await tx.get(gameRef);
      const data = doc.data();
      if (!data) return;
      if (data.winner || data.draw) return;
      if (data.currentTurn !== myIndex) return;
      const board = data.board.map(r => r.slice());
      if (board[row][col]) return;
      board[row][col] = symbol;
      const winner = checkWinner(board);
      let draw = false;
      let nextTurn = data.currentTurn;
      if (!winner) {
        draw = board.flat().every(v => v);
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

// Update the board UI
function updateBoard(state) {
  const cells = boardDiv.children;
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    const val = state[r][c];
    const cell = cells[i];
    cell.textContent = val;
    cell.classList.toggle('taken', !!val);
  }
}

// Update turn status
function updateTurnInfo(currentTurn, winner, draw) {
  if (winner || draw) {
    return;
  }
  if (currentTurn === myIndex) {
    statusDiv.textContent = `C'est votre tour (${symbol}).`;
  } else {
    statusDiv.textContent = `Tour de l'adversaire.`;
  }
}

// Handle end of game and award coins
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
  const msgRef = db.collection('tictactoeGames').doc(gameId).collection('messages');
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

// Join game at startup
joinGame();