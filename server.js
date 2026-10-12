const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const rooms = {}; // code -> { board, turn, winner, line, X, O, clients:Set }

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

function newRoom() {
  return { board: Array(9).fill(''), turn: 'X', winner: '', line: [], X: null, O: null, clients: new Set() };
}

function check(b) {
  for (const l of WINS) {
    if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { winner: b[l[0]], line: l };
  }
  return b.every(Boolean) ? { winner: 'draw', line: [] } : { winner: '', line: [] };
}

function send(ws, room) {
  const role = room.X === ws ? 'X' : room.O === ws ? 'O' : '';
  ws.send(JSON.stringify({
    board: room.board, turn: room.turn, winner: room.winner, line: room.line,
    role, hasO: !!room.O
  }));
}
function broadcast(room) { room.clients.forEach(c => send(c, room)); }

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let room = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join') {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return;
      room = rooms[code] || (rooms[code] = newRoom());
      room.clients.add(ws);
      if (!room.X) room.X = ws; else if (!room.O) room.O = ws;
      broadcast(room);
    } else if (!room) {
      return;
    } else if (m.type === 'move') {
      const role = room.X === ws ? 'X' : room.O === ws ? 'O' : '';
      const i = m.i;
      if (!role || role !== room.turn || !room.O || room.winner) return;
      if (!Number.isInteger(i) || i < 0 || i > 8 || room.board[i]) return;
      room.board[i] = role;
      const r = check(room.board);
      room.winner = r.winner; room.line = r.line;
      room.turn = role === 'X' ? 'O' : 'X';
      broadcast(room);
    } else if (m.type === 'reset') {
      if (room.X !== ws && room.O !== ws) return;
      room.board = Array(9).fill(''); room.turn = 'X'; room.winner = ''; room.line = [];
      broadcast(room);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(ws);
    if (room.X === ws) room.X = null;
    if (room.O === ws) room.O = null;
    if (room.clients.size === 0) {
      for (const k in rooms) if (rooms[k] === room) delete rooms[k];
    } else broadcast(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('X and O running on port ' + PORT));
