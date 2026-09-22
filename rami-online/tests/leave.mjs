// ═══════════════════════════════════════════════════════
// LEAVE ROOM — a player gives up their seat on purpose
// Run with: npm test
//
// A dropped connection keeps the seat warm for a comeback; the leave button
// does not. Before the game the chair simply empties. Once the cards are dealt
// a computer player takes over the hand so the others can play on. The host's
// crown passes on at once, and a room left with nobody but bots closes.
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
  const r = new Room({ storage: fakeStorage() }, {});
  r.code = 'ABCD';
  return r;
}
function join(room, { name, pid, host = false, resume = false }) {
  const ws = new FakeWS();
  room.handleSocket(ws, name, 'ABCD', host, pid, resume);
  return ws;
}
const settle = () => new Promise(r => setTimeout(r, 0));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. Leaving the lobby frees the chair ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  join(room, { name: 'יוסי', pid: 'p-yossi' });
  dana.msg({ t: 'leave' });
  await settle();
  check('the chair is gone', room.seats.length === 2 && !room.seats.some(s => s.name === 'דנה'));
  check('the leaver is hung up on', dana.closed);
  check('the others see the smaller lobby', host.last('lobby').players.length === 2);
  check('seats after it shift down', host.last('lobby').players[1].name === 'יוסי');
}

// ── 2. The host leaving the lobby hands the crown on at once ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  host.msg({ t: 'addAI' });
  host.msg({ t: 'leave' });
  await settle();
  check('the next human is host, no grace period', dana.last('lobby').youHost === true);
  check('the new host can start', (dana.msg({ t: 'start' }), room.started));
}

// ── 3. Leaving mid-game: a bot takes over, the game goes on ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  host.msg({ t: 'start' });
  await settle();
  const handBefore = room.state.players[1].hand.length;
  dana.msg({ t: 'leave' });
  await settle();
  check('the seat stays in the game', room.state.players.length === 2);
  check('it is a computer player now', room.seats[1].isAI && room.state.players[1].isAI);
  check('it keeps the hand', room.state.players[1].hand.length === handBefore);
  check('the table is told', /יצא מהחדר/.test(host.last('state').state.log.at(-1)));
  check('the host keeps the crown', host.last('lobby').youHost === true);
  const back = join(room, { name: 'דנה', pid: 'p-dana', resume: true });
  check('the leaver is not handed the seat back', !!back.last('noseat'));
}

// ── 4. The player on turn leaves after taking the beit: rolled back ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  join(room, { name: 'דנה', pid: 'p-dana' });
  host.msg({ t: 'start' });
  await settle();
  const cur = room.state.cur;
  room.state = { ...room.state, phase: 'action', tookBeit: true,
                 undoBefore: { hand: room.state.players[cur].hand, board: [], hasLaid: false,
                               beit: room.state.beit, deck: room.state.deck,
                               discard: room.state.discard, fromBeit: true } };
  const ws = room.seats[cur].ws;
  ws.msg({ t: 'leave' });
  await settle();
  check('the beit attempt is undone', !room.state.tookBeit && room.state.phase === 'draw');
  check('the bot is on turn in its place', room.seats[cur].isAI);
}

// ── 5. The last human leaving closes the room ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  host.msg({ t: 'addAI' });
  host.msg({ t: 'start' });
  await settle();
  host.msg({ t: 'leave' });
  await settle();
  check('nothing is left of the room', room.seats.length === 0 && room.state === null);
}

// Let any AI move scheduled above run out before exiting.
await new Promise(r => setTimeout(r, 600));
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall leave checks passed');
