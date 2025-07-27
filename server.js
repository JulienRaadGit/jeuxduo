const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the client directory
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// When visiting root path, serve index.html explicitly. Without this,
// deep routes would work but it's clearer to return the landing page.
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

/*
 * Game state management
 *
 * The server keeps simple in‑memory state for each game room. Each room
 * holds a list of players (sockets), game specific boards and turn
 * information. When a user disconnects mid‑game the opponent is
 * notified and the room is reset. Since this data lives purely in
 * memory it will be lost if the server restarts, but for a demo
 * website this is acceptable. Clients are responsible for updating
 * persistent user data such as coin balances via Firebase.
 */

const games = {
  tictactoe: {},
  connect4: {}
};

// Helper to generate a simple room id. In a production system you
// might use a library like nanoid to avoid collisions.
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8);
}

// Creates or joins a room for a given game type. Returns an object
// describing the room and assigned player symbol/colour.
function assignRoom(gameType, socket, user) {
  const rooms = games[gameType];
  // Try to find an existing room with only one player (waiting room)
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.players.length === 1) {
      room.players.push({ socket, user });
      return { roomId, playerIndex: 1 };
    }
  }
  // Otherwise create a new room
  const roomId = generateRoomId();
  rooms[roomId] = {
    players: [{ socket, user }],
    // game specific state initialised lazily
    state: null,
    currentTurn: 0,
    finished: false
  };
  return { roomId, playerIndex: 0 };
}

// Check for a winner in tic tac toe. Returns 'X', 'O' or null.
function checkTicTacToeWinner(board) {
  const lines = [
    // rows
    [board[0][0], board[0][1], board[0][2]],
    [board[1][0], board[1][1], board[1][2]],
    [board[2][0], board[2][1], board[2][2]],
    // columns
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

// Check for a winner in Connect4. Returns 'R' (red) or 'Y' (yellow) or null.
function checkConnect4Winner(board) {
  const rows = board.length;
  const cols = board[0].length;
  const directions = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal down right
    [1, -1] // diagonal down left
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
        if (count >= 4) {
          return cell;
        }
      }
    }
  }
  return null;
}

// Listen for socket connections
io.on('connection', socket => {
  console.log('User connected:', socket.id);
  // Current room the socket is in
  let currentGame = null;
  let currentRoomId = null;
  let playerIndex = null;

  // Join a game: payload contains game type (tictactoe or connect4) and user info
  socket.on('joinGame', ({ game, user }) => {
    if (!games[game]) {
      socket.emit('errorMessage', 'Unknown game type');
      return;
    }
    // Assign room and index
    const { roomId, playerIndex: idx } = assignRoom(game, socket, user);
    currentGame = game;
    currentRoomId = roomId;
    playerIndex = idx;
    const room = games[game][roomId];
    socket.join(`${game}-${roomId}`);
    // If state is not yet initialised, create initial board
    if (!room.state) {
      if (game === 'tictactoe') {
        room.state = [
          ['', '', ''],
          ['', '', ''],
          ['', '', '']
        ];
        room.currentTurn = 0;
      } else if (game === 'connect4') {
        const rows = 6;
        const cols = 7;
        const board = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            row.push('');
          }
          board.push(row);
        }
        room.state = board;
        room.currentTurn = 0;
      }
      room.finished = false;
    }
    // Notify players of current players and start when two players present
    const playerSymbols = game === 'tictactoe' ? ['X', 'O'] : ['R', 'Y'];
    const assignedSymbol = playerSymbols[idx];
    socket.emit('gameJoined', {
      roomId,
      playerIndex: idx,
      symbol: assignedSymbol,
      state: room.state,
      currentTurn: room.currentTurn
    });
    // If both players present, inform both and send start
    if (room.players.length === 2) {
      const playerInfo = room.players.map(p => ({ id: p.socket.id, user: p.user }));
      io.to(`${game}-${roomId}`).emit('gameStart', { playerInfo });
    }
  });

  // Handle moves for tic tac toe
  socket.on('tttMove', ({ row, col }) => {
    if (!currentGame || currentGame !== 'tictactoe') return;
    const room = games[currentGame][currentRoomId];
    if (!room || room.finished) return;
    const symbol = playerIndex === 0 ? 'X' : 'O';
    // Check turn
    if (room.currentTurn !== playerIndex) return;
    // Validate move
    if (row < 0 || row > 2 || col < 0 || col > 2) return;
    if (room.state[row][col]) return;
    // Make move
    room.state[row][col] = symbol;
    // Check for winner
    const winner = checkTicTacToeWinner(room.state);
    let draw = false;
    if (!winner) {
      // Check for draw
      draw = room.state.flat().every(cell => cell);
    }
    if (winner || draw) {
      room.finished = true;
    } else {
      room.currentTurn = 1 - room.currentTurn;
    }
    // Broadcast updated state
    io.to(`${currentGame}-${currentRoomId}`).emit('tttUpdate', {
      state: room.state,
      currentTurn: room.currentTurn,
      winner: winner || null,
      draw
    });
  });

  // Handle moves for connect4
  socket.on('connect4Move', ({ col }) => {
    if (!currentGame || currentGame !== 'connect4') return;
    const room = games[currentGame][currentRoomId];
    if (!room || room.finished) return;
    const symbol = playerIndex === 0 ? 'R' : 'Y';
    // Check turn
    if (room.currentTurn !== playerIndex) return;
    // Validate column
    const board = room.state;
    if (col < 0 || col >= board[0].length) return;
    // Find lowest empty row in column
    let placedRow = -1;
    for (let r = board.length - 1; r >= 0; r--) {
      if (!board[r][col]) {
        board[r][col] = symbol;
        placedRow = r;
        break;
      }
    }
    if (placedRow === -1) return; // column full
    // Check for winner
    const winner = checkConnect4Winner(board);
    let draw = false;
    if (!winner) {
      // Draw if no empty cell left
      draw = board.every(row => row.every(cell => cell));
    }
    if (winner || draw) {
      room.finished = true;
    } else {
      room.currentTurn = 1 - room.currentTurn;
    }
    io.to(`${currentGame}-${currentRoomId}`).emit('connect4Update', {
      state: board,
      currentTurn: room.currentTurn,
      winner: winner || null,
      draw
    });
  });

  // Chat messages
  socket.on('chat', ({ message, user }) => {
    if (!currentGame || !currentRoomId) return;
    io.to(`${currentGame}-${currentRoomId}`).emit('chatMessage', {
      message: message.substring(0, 300), // limit length
      user
    });
  });

  // Handle player disconnect
  socket.on('disconnect', () => {
    if (!currentGame || !currentRoomId) return;
    const room = games[currentGame][currentRoomId];
    if (!room) return;
    // Remove player
    room.players = room.players.filter(p => p.socket.id !== socket.id);
    // Notify the other player
    socket.to(`${currentGame}-${currentRoomId}`).emit('opponentLeft');
    // If no players left, delete room
    if (room.players.length === 0) {
      delete games[currentGame][currentRoomId];
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});