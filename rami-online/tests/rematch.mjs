// ═══════════════════════════════════════════════════════
// REMATCH — another game in the same room, same code
// Run with: npm test
//
// Once a game is over any player may ask for another. The room goes back to
// the lobby with the players still at the table (anyone who hung up is
// cleared), and the host deals the new game. A practice table deals at once.
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
function join(room, { name, pid, host = false }) {
  const ws = new FakeWS();
  room.handleSocket(ws, name, 'ABCD', host, pid);
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

// ── 2. After the game: back to the lobby, same code, then a new deal ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  const yossi = join(room, { name: 'יוסי', pid: 'p-yossi' });
  host.msg({ t: 'addAI' });
  host.msg({ t: 'start' });
  await settle();
  const firstId = room.state.room.gameId;
  finish(room);
  yossi.close();                       // went home from the final scoreboard
  await settle();
  dana.msg({ t: 'rematch' });          // any player may ask
  await settle();
  const lobby = host.last('lobby');
  check('the room is back in the lobby', !room.started && !room.state && lobby.started === false);
  check('same code', lobby.code === 'ABCD');
  check('whoever hung up is cleared, bots stay',
    room.seats.map(s => s.name).join() === 'שלו,דנה,מחשב 1');
  check('the host is still the host', lobby.players[0].host && host.last('lobby').youHost);
  check('the finished-game clock is off', room.endedAt === null);
  host.msg({ t: 'start' });
  await settle();
  check('the host deals a new game', room.started && room.state.players.length === 3);
  check('with a new game id', room.state.room.gameId !== firstId);
  check('everyone at the table gets it', dana.last('state').state.room.gameId === room.state.room.gameId);
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
