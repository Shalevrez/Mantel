// ═══════════════════════════════════════════════════════
// LATE JOIN — once the game starts, the table is closed
// Run with: npm test
//
// Only the players who started the game carry on. Someone who opens the
// invite link or types the code after the deal is turned away — even when a
// player is disconnected and the newcomer happens to use the same name —
// while the players already seated still get their chairs back.
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

function makeRoom() {
  const r = new Room({ storage: fakeStorage(new Map()) }, {});
  r.code = 'ABCD';
  return r;
}

function join(room, { name, pid, host = false }) {
  const ws = new FakeWS();
  room.handleSocket(ws, name, 'ABCD', host, pid);
  return ws;
}

const settle = () => new Promise(r => setTimeout(r, 0));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

async function startedRoom() {
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  host.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  await settle();
  return { room, host, dana };
}

// ── 1. A newcomer after the deal is turned away, and told to stop trying ──
{
  const { room } = await startedRoom();
  const late = join(room, { name: 'מאחר', pid: 'p-late' });
  const err = late.last('error');
  check('newcomer is refused', !!err && err.refused === true);
  check('newcomer is closed', late.closed);
  check('newcomer gets no lobby or state', !late.last('lobby') && !late.last('state'));
  check('no seat was added', room.seats.length === 2);
  check('the refused socket does not linger', room.sockets.size === 2);
}

// ── 2. Same name as a dropped player doesn't take their chair ──
{
  const { room, dana } = await startedRoom();
  dana.close();                                         // דנה lost the network
  const imposter = join(room, { name: 'דנה', pid: 'p-other' });
  check('same-name newcomer is refused', imposter.last('error') && imposter.closed);
  check('דנה\'s seat is still hers', room.seats[1].uid === 'pid:p-dana' && !room.seats[1].connected);

  const back = join(room, { name: 'דנה', pid: 'p-dana' });
  check('the real דנה gets her seat back', back.last('lobby').youSeat === 1 && !!back.last('state'));
}

// ── 3. Before the deal, joining by link still works ──
{
  const room = makeRoom();
  join(room, { name: 'שלו', pid: 'p-host', host: true });
  const friend = join(room, { name: 'חבר', pid: 'p-friend' });
  check('joining a lobby is allowed', friend.last('lobby') && !friend.closed);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nlate-join: all good');
