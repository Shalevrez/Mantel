// ═══════════════════════════════════════════════════════
// ROOM MODE — practice vs online, entry fee and table size
// Run with: npm test
//
// The creator picks the room's terms; the server keeps them, shows them in
// the lobby, holds the table to its size, and stamps them on the game so the
// game-over screen can settle it (see economy.settle).
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';
import { settle } from '../src/economy.js';

class FakeWS {
  constructor() { this.sent = []; this.listeners = {}; this.closed = false; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { if (this.closed) return; this.closed = true; (this.listeners.close || []).forEach(f => f()); }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  last(t) { return [...this.sent].reverse().find(m => m.t === t); }
}

async function makeRoom(query, store) {
  const r = new Room({ storage: fakeStorage(store) }, {});
  await r.fetch(new Request(`https://do/create?code=ABCD&${query}`));
  return r;
}
function join(room, { name, pid, host = false }) {
  const ws = new FakeWS();
  room.handleSocket(ws, name, 'ABCD', host, pid, false);
  return ws;
}
const settle0 = () => new Promise(r => setTimeout(r, 0));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. An online room with a fee and a 3-seat table ──
{
  const store = new Map();
  const room = await makeRoom('mode=online&fee=500&seats=3', store);
  const host = join(room, { name: 'שלו', pid: 'p1', host: true });
  const lobby = host.last('lobby');
  check('the lobby shows the terms', lobby.mode === 'online' && lobby.fee === 500 && lobby.maxSeats === 3);
  check('bots are capped to the table', lobby.maxAI === 2);
  join(room, { name: 'דנה', pid: 'p2' });
  join(room, { name: 'יוסי', pid: 'p3' });
  const late = join(room, { name: 'רון', pid: 'p4' });
  check('a 4th player is turned away from a 3-seat table', late.closed && /החדר מלא \(3/.test(late.last('error').msg));
  host.msg({ t: 'start' });
  await settle0();
  const st = host.last('state').state;
  check('the game carries the terms', st.room.mode === 'online' && st.room.fee === 500 && !!st.room.gameId);

  // The terms survive an eviction.
  const again = new Room({ storage: fakeStorage(store) }, {});
  await again.load();
  check('mode, fee and size are persisted', again.mode === 'online' && again.fee === 500 && again.cap === 3);

  // Settle as the game-over screen would.
  const done = { ...st, players: st.players.map((p, i) => ({ ...p, totalScore: [30, 10, 90][i] })) };
  const s = settle(done);
  check('the pot is 3 × 500, 70/30', s.pot === 1500 && s.seats[1].prize === 1050 && s.seats[0].prize === 450 && s.seats[2].prize === 0);
}

// ── 2. Practice is free whatever the fee says ──
{
  const room = await makeRoom('mode=practice&fee=5000&seats=4');
  const host = join(room, { name: 'שלו', pid: 'p1', host: true });
  check('practice has no fee', host.last('lobby').mode === 'practice' && host.last('lobby').fee === 0);
  host.msg({ t: 'aiLevel', level: 'easy' });
  host.msg({ t: 'start', fillAI: true, minPlayers: 4 });
  await settle0();
  check('practice fills the table with bots and starts', room.started && room.seats.length === 4 && room.seats.slice(1).every(s => s.isAI && s.ai === 'easy'));
  check('practice settles nothing', settle(room.state) === null);
}

// ── 3. An unlisted fee is snapped to a listed one; no terms = free friendly room ──
{
  const odd = await makeRoom('mode=online&fee=333');
  check('an odd fee is not kept', odd.fee !== 333 && odd.fee > 0);
  const plain = await makeRoom('');
  check('a room with no terms is a free 6-seat online room', plain.mode === 'online' && plain.fee === 0 && plain.cap === 6);
}

// ── 4. Closing the room forgets its terms ──
{
  const room = await makeRoom('mode=online&fee=1000&seats=2');
  join(room, { name: 'שלו', pid: 'p1', host: true });
  await room.closeRoom('idle');
  check('a closed room is back to the defaults', room.mode === 'online' && room.fee === 0 && room.cap === 6);
}

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall room-mode checks passed');
