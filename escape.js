const MISSIONS = require('./missions');
const SLOTS = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) SLOTS.push([8 + c * 31, 6 + r * 23, 26, 18]);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const rooms = {};

function newRoom() {
  return { A: null, M: null, phase: 'welcome', mission: null, step: 0,
    unlocked: new Set([0, 1]), chat: [], clients: new Set(), timer: null };
}
function hotspots(m) {
  const all = [];
  m.A.forEach((h, i) => all.push({ id: 'a' + i, who: 'A', h }));
  m.M.forEach((h, i) => all.push({ id: 'm' + i, who: 'M', h }));
  return all.map((x, i) => ({ id: x.id, who: x.who, e: x.h[0], label: x.h[1], text: x.h[2], s: x.h[3], pos: x.h[4] || SLOTS[i] }));
}
function stateFor(room, role) {
  const s = { phase: room.phase, role, ready: !!(room.A && room.M), chat: room.chat,
    unlocked: [...room.unlocked].sort((a, b) => a - b),
    list: MISSIONS.map(m => ({ id: m.id, title: m.title })) };
  if (room.mission !== null) {
    const m = MISSIONS[room.mission];
    s.mission = { id: m.id, title: m.title, icon: m.icon, c: m.c, total: m.steps.length };
    s.step = room.step;
    if (room.phase === 'play' || room.phase === 'passed') {
      s.hotspots = hotspots(m).filter(h => room.phase === 'passed' || h.s <= room.step)
        .map(h => ({ id: h.id, e: h.e, label: h.label, pos: h.pos, text: h.who === role ? h.text : null }));
      const st = m.steps[Math.min(room.step, m.steps.length - 1)];
      s.lock = { mine: st.who === role, ask: st.ask, wait: st.who === 'A' ? 'Abubakar' : 'Maryam' };
    }
  }
  return s;
}
function broadcast(room) {
  room.clients.forEach(c => c.send(JSON.stringify(stateFor(room, room.A === c ? 'A' : room.M === c ? 'M' : ''))));
}

function attach(wss) {
  wss.on('connection', ws => {
    let room = null;
    const role = () => (room && room.A === ws ? 'A' : room && room.M === ws ? 'M' : '');
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'ping') return;
      if (m.type === 'join') {
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (!code) return;
        room = rooms[code] || (rooms[code] = newRoom());
        const want = m.as === 'maryam' ? 'M' : 'A';
        if (want === 'A' && !room.A) room.A = ws; else if (want === 'M' && !room.M) room.M = ws;
        room.clients.add(ws);
        if (role() === 'A' && Array.isArray(m.unlocked)) {
          m.unlocked.forEach(n => { if (Number.isInteger(n) && n >= 0 && n <= 10) room.unlocked.add(n); });
        }
        if (!role()) { ws.send(JSON.stringify({ phase: 'full', role: '', full: true, chat: [], unlocked: [], list: [] })); return; }
        broadcast(room); return;
      }
      if (!room) return;
      const r = role();
      if (m.type === 'chat') {
        const text = String(m.text || '').trim().slice(0, 200);
        if (!r || !text) return;
        room.chat.push({ name: r === 'A' ? 'Abubakar' : 'Maryam', text });
        if (room.chat.length > 50) room.chat.shift();
        broadcast(room);
      } else if (m.type === 'start' && r === 'A' && room.phase === 'welcome' && room.A && room.M) {
        room.phase = 'menu'; broadcast(room);
      } else if (m.type === 'pick' && r === 'A' && room.phase === 'menu' && room.A && room.M) {
        if (!room.unlocked.has(m.id) || !MISSIONS[m.id]) return;
        room.mission = m.id; room.step = 0; room.phase = 'loading'; broadcast(room);
        clearTimeout(room.timer);
        room.timer = setTimeout(() => { if (room.phase === 'loading') { room.phase = 'play'; broadcast(room); } }, 3800);
      } else if (m.type === 'back' && r === 'A' && room.phase === 'play') {
        room.phase = 'menu'; room.mission = null; room.step = 0; broadcast(room);
      } else if ((m.type === 'answer' || m.type === 'skip') && room.phase === 'play') {
        const mi = MISSIONS[room.mission], step = mi.steps[room.step];
        const good = m.type === 'skip' ? r === 'A' : step.who === r && step.ok.some(a => norm(a) === norm(m.text));
        if (!good) { if (m.type === 'answer') ws.send(JSON.stringify({ event: 'wrong' })); return; }
        room.step++;
        if (room.step >= mi.steps.length) {
          room.phase = 'passed';
          if (mi.id >= 1 && mi.id < 10) room.unlocked.add(mi.id + 1);
          broadcast(room);
          clearTimeout(room.timer);
          room.timer = setTimeout(() => { room.phase = 'menu'; room.mission = null; room.step = 0; broadcast(room); }, 5500);
        } else broadcast(room);
      }
    });
    ws.on('close', () => {
      if (!room) return;
      room.clients.delete(ws);
      if (room.A === ws) room.A = null;
      if (room.M === ws) room.M = null;
      if (room.clients.size === 0) {
        clearTimeout(room.timer);
        for (const k in rooms) if (rooms[k] === room) delete rooms[k];
      } else broadcast(room);
    });
  });
}
module.exports = { attach };
