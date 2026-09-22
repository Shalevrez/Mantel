// ═══════════════════════════════════════════════════════
// RESUME — a page reloaded mid-game goes back to its seat
// Run with: npm test
//
// A reload (to pick up a new version, or by accident) reconnects with
// resume=1. It must hand back the seat this player already holds, and must
// never seat anyone new — least of all open a fresh, empty room under the code
// of one that has already closed.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';

class FakeWS {
  constructor() { this.sent = []; this.listeners = {}; this.closed = false; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { if (this.closed) return; this.closed = true; (this.listeners.close || []).forEach(f => f()); }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  last(t) { return [...this.sent].reverse().find(m => m.t === t); }
}

function makeRoom(store = new Map()) {
  const r = new Room({ storage: fakeStorage(store) }, {});
  r.code = 'ABCD';
  return { room: r, store };
}

function join(room, { name, pid, host = false, resume = false }) {
  const ws = new FakeWS();
  room.handleSocket(ws, name, 'ABCD', host, pid, resume);
  return ws;
}

// onMessage is async (it persists before broadcasting); let it finish.
const settle = () => new Promise(r => setTimeout(r, 0));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. Reload mid-game: same seat, same hand, host still host ──
{
  const { room } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: 'p-host', host: true });
  join(room, { name: 'דנה', pid: 'p-dana' });
  host1.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  await settle();
  const handBefore = host1.last('state').state.players[0].hand.map(c => c.id).join();

  host1.close();                                              // the reload
  const host2 = join(room, { name: 'שלו', pid: 'p-host', resume: true });
  check('resume is not turned away', !host2.last('noseat') && !host2.closed);
  check('resume gets the same seat', host2.last('lobby').youSeat === 0);
  check('resume keeps the host role', host2.last('lobby').youHost === true);
  check('resume gets the game state straight away', !!host2.last('state'));
  check('resume gets the same hand back',
        host2.last('state').state.players[0].hand.map(c => c.id).join() === handBefore);
  check('no extra seat appears', room.seats.length === 2);
}

// ── 2. Resume into a room that closed (blank object) seats nobody ──
{
  const store = new Map();
  const blank = new Room({ storage: fakeStorage(store) }, {});
  await blank.load();
  const ws = join(blank, { name: 'שלו', pid: 'p-host', resume: true });
  check('closed room answers noseat', !!ws.last('noseat'));
  check('socket is closed', ws.closed === true);
  check('no seat is created', blank.seats.length === 0);
  check('socket is not left in the room', blank.sockets.size === 0);
  check('nothing is persisted', store.size === 0);
}

// ── 3. Resume by someone who never sat here seats nobody ──
{
  const { room } = makeRoom();
  join(room, { name: 'שלו', pid: 'p-host', host: true });
  const ws = join(room, { name: 'זר', pid: 'p-stranger', resume: true });
  check('stranger gets noseat', !!ws.last('noseat'));
  check('lobby still has one seat', room.seats.length === 1);
}

// ── 4. Resume after the room was evicted from memory ──
{
  const { room, store } = makeRoom();
  const a = join(room, { name: 'שלו', pid: 'p-host', host: true });
  join(room, { name: 'דנה', pid: 'p-dana' });
  a.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  await settle();
  await room.persist();
  a.close();

  const revived = new Room({ storage: fakeStorage(store) }, {});
  await revived.load();
  const b = join(revived, { name: 'שלו', pid: 'p-host', resume: true });
  check('resume works after eviction', b.last('lobby')?.youSeat === 0 && !!b.last('state'));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
