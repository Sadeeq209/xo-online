const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const rooms = {};

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  let file = 'index.html', type = 'text/html; charset=utf-8';
  if (url === '/escape') file = 'escape.html';
  else if (/^\/mission\d{1,2}\.(jpg|jpeg|png|webp)$/.test(url)) {
    file = url.slice(1);
    type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[url.split('.').pop()];
  }
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

function newRoom() {
  return {
    board: Array(9).fill(''), turn: 'X', winner: '', line: [],
    A: null, M: null,            // A = Abubakar (starter), M = Maryam (joiner)
    markA: 'X',                  // Abubakar's mark, random each game
    scores: { A: 0, M: 0, draws: 0 },
    chat: [],
    streak: { A: 0, M: 0 },
    clients: new Set()
  };
}
function randomMarks(room) { room.markA = Math.random() < 0.5 ? 'X' : 'O'; }

function check(b) {
  for (const l of WINS) {
    if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { winner: b[l[0]], line: l };
  }
  return b.every(Boolean) ? { winner: 'draw', line: [] } : { winner: '', line: [] };
}

function send(ws, room) {
  const isA = room.A === ws, isM = room.M === ws;
  const markM = room.markA === 'X' ? 'O' : 'X';
  const role = isA ? room.markA : isM ? markM : '';
  const me = isA ? 'Abubakar' : isM ? 'Maryam' : '';
  ws.send(JSON.stringify({
    board: room.board, turn: room.turn, winner: room.winner, line: room.line,
    role, me,
    xName: room.markA === 'X' ? 'Abubakar' : 'Maryam',
    oName: room.markA === 'O' ? 'Abubakar' : 'Maryam',
    ready: !!(room.A && room.M),
    scores: room.scores,
    chat: room.chat,
    streak: room.streak
  }));
}
function broadcast(room) { room.clients.forEach(c => send(c, room)); }

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', ws => {
  let room = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join') {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return;
      room = rooms[code] || (rooms[code] = newRoom());
      room.clients.add(ws);
      if (!room.A) room.A = ws;
      else if (!room.M) { room.M = ws; randomMarks(room); }
      broadcast(room);
    } else if (!room) {
      return;
    } else if (m.type === 'move') {
      const isA = room.A === ws, isM = room.M === ws;
      const role = isA ? room.markA : isM ? (room.markA === 'X' ? 'O' : 'X') : '';
      const i = m.i;
      if (!role || role !== room.turn || !(room.A && room.M) || room.winner) return;
      if (!Number.isInteger(i) || i < 0 || i > 8 || room.board[i]) return;
      room.board[i] = role;
      const r = check(room.board);
      room.winner = r.winner; room.line = r.line;
      if (r.winner === 'draw') room.scores.draws++;
      else if (r.winner) {
        if (r.winner === room.markA) { room.scores.A++; room.streak.A++; room.streak.M = 0; }
        else { room.scores.M++; room.streak.M++; room.streak.A = 0; }
      }
      room.turn = role === 'X' ? 'O' : 'X';
      broadcast(room);
    } else if (m.type === 'react') {
      const name = room.A === ws ? 'Abubakar' : room.M === ws ? 'Maryam' : '';
      if (!name || !['😂', '❤️', '👏', '😮'].includes(m.emoji)) return;
      room.clients.forEach(c => c.send(JSON.stringify({ event: 'react', emoji: m.emoji, from: name })));
    } else if (m.type === 'chat') {
      const name = room.A === ws ? 'Abubakar' : room.M === ws ? 'Maryam' : '';
      const text = String(m.text || '').trim().slice(0, 200);
      if (!name || !text) return;
      room.chat.push({ name, text });
      if (room.chat.length > 50) room.chat.shift();
      broadcast(room);
    } else if (m.type === 'reset') {
      if (room.A !== ws && room.M !== ws) return;
      room.board = Array(9).fill(''); room.turn = 'X'; room.winner = ''; room.line = [];
      randomMarks(room);
      broadcast(room);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(ws);
    if (room.A === ws) room.A = null;
    if (room.M === ws) room.M = null;
    if (room.clients.size === 0) {
      for (const k in rooms) if (rooms[k] === room) delete rooms[k];
    } else broadcast(room);
  });
});

const wssEscape = new WebSocketServer({ noServer: true });
require('./escape').attach(wssEscape);
server.on('upgrade', (req, sock, head) => {
  const w = (req.url || '').startsWith('/escape-ws') ? wssEscape : wss;
  w.handleUpgrade(req, sock, head, ws => w.emit('connection', ws, req));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('X and O running on port ' + PORT));
