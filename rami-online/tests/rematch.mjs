// ═══════════════════════════════════════════════════════
// REMATCH — another game in the same room, same code
// Run with: npm test
//
// Once a game is over any player may open another. Only they go back to the
// lobby; the others stay on the final scoreboard as pending until they join or
// leave, and whoever hasn't answered when the host deals is left out. Anyone
// who hung up is cleared. A practice table deals at once.
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

function makeRoom(mode = 'online') {
  const r = new Room({ storage: fakeStorage() }, {});
  r.code = 'ABCD';
  r.mode = mode;
  return r;
}
function join(room, { name, pid, host = false, resume = false }) {
  const ws = new FakeWS();
  room.handleSocket(ws, name, 'ABCD', host, pid, resume);
  return ws;
}
const settle = () => new Promise(r => setTimeout(r, 0));
const finish = room => { room.state = { ...room.state, phase: 'game_end' }; };

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. Not before the game is over ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  join(room, { name: 'דנה', pid: 'p-dana' });
  host.msg({ t: 'start' });
  await settle();
  host.msg({ t: 'rematch' });
  await settle();
  check('a game in progress is left alone', room.started && room.state.phase !== 'game_end');
}

// ── 2. Opening the next game takes only you to the lobby ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  const yossi = join(room, { name: 'יוסי', pid: 'p-yossi' });
  const avi = join(room, { name: 'אבי', pid: 'p-avi' });
  host.msg({ t: 'addAI' });
  host.msg({ t: 'start' });
  await settle();
  const firstId = room.state.room.gameId;
  finish(room);
  yossi.close();                       // went home from the final scoreboard
  await settle();
  dana.msg({ t: 'rematch' });          // any player may open it
  await settle();
  check('the room is back in the lobby', !room.started && !room.state && dana.last('lobby').started === false);
  check('same code', dana.last('lobby').code === 'ABCD');
  check('whoever hung up is cleared, bots stay',
    room.seats.map(s => s.name).join() === 'שלו,דנה,אבי,מחשב 1');
  check('the opener is in', dana.last('lobby').youPending === false);
  check('the others are pending, not in', host.last('lobby').youPending === true && avi.last('lobby').youPending === true);
  check('the lobby shows who has not answered',
    dana.last('lobby').players.filter(p => p.pending).map(p => p.name).join() === 'שלו,אבי');
  check('while the host is pending, the opener holds the crown', dana.last('lobby').youHost === true);
  check('the finished-game clock is off', room.endedAt === null);

  // A pending player who reloads gets the final scoreboard back.
  const avi2 = join(room, { name: 'אבי', pid: 'p-avi', resume: true });
  check('a reload still shows the final table', avi2.last('state')?.state.phase === 'game_end');

  // The host joins and takes the crown back; the host can start.
  host.msg({ t: 'rematch' });
  await settle();
  check('the host joins', host.last('lobby').youPending === false && host.last('lobby').youHost === true);

  // אבי never answers: the new game is dealt without them.
  host.msg({ t: 'start' });
  await settle();
  check('the host deals a new game to whoever is in',
    room.started && room.state.players.map(p => p.name).join() === 'שלו,דנה,מחשב 1');
  check('with a new game id', room.state.room.gameId !== firstId);
  check('everyone in it gets it', dana.last('state').state.room.gameId === room.state.room.gameId);
  check('the one who did not answer is told the game went on without them', avi2.last('closed')?.reason === 'missed');
}

// ── 2b. A pending player may leave instead ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  host.msg({ t: 'start' });
  await settle();
  finish(room);
  host.msg({ t: 'rematch' });
  await settle();
  dana.msg({ t: 'leave' });
  await settle();
  check('the leaver gives up the chair', room.seats.map(s => s.name).join() === 'שלו');
  host.msg({ t: 'start' });
  await settle();
  check('one player alone cannot start', !room.started && /לפחות 2/.test(host.last('error').msg));
}

// ── 3. A practice table deals the next game at once ──
{
  const room = makeRoom('practice');
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  host.msg({ t: 'start', fillAI: true, minPlayers: 3 });
  await settle();
  finish(room);
  host.msg({ t: 'rematch' });
  await settle();
  check('a new practice game is under way', room.started && room.state.phase !== 'game_end');
  check('same table', room.state.players.length === 3);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall rematch checks passed');
process.exit(0);
