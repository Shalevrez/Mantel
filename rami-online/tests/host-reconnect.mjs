// ═══════════════════════════════════════════════════════
// HOST / RECONNECT — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// Drives the real Room durable object through every way a player can leave and
// come back: a dropped socket, a refresh, closing the browser, the room being
// evicted from memory. The host must come back a host — the "start game"
// button used to disappear for good, because the host was remembered by
// connection id and a reconnect always mints a new one.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';

class FakeWS {
  constructor(tag) { this.tag = tag; this.sent = []; this.listeners = {}; this.closed = false; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { if (this.closed) return; this.closed = true; (this.listeners.close || []).forEach(f => f()); }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  lastLobby() { return [...this.sent].reverse().find(m => m.t === 'lobby'); }
  lastState() { return [...this.sent].reverse().find(m => m.t === 'state'); }
}

function makeRoom() {
  const store = new Map();
  const ctx = { storage: fakeStorage(store) };
  const r = new Room(ctx, {});
  r.code = 'ABCD';
  return { room: r, store };
}

// Connect a socket the way the DO's fetch() does.
function join(room, { name, pid, host = false }) {
  const ws = new FakeWS(`${name}/${pid}`);
  room.handleSocket(ws, name, 'ABCD', host, pid);
  return ws;
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. Host reconnects (dropped socket / refresh / browser restart) ──
{
  const { room } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: 'p-host', host: true });
  check('host is host on first connect', host1.lastLobby().youHost === true);

  join(room, { name: 'דנה', pid: 'p-dana' });

  host1.close();                                    // browser closed
  const host2 = join(room, { name: 'שלו', pid: 'p-host' });   // …and reopened, host=0
  check('host keeps the crown after reconnecting', host2.lastLobby().youHost === true);
  check('host reclaims the same seat', host2.lastLobby().youSeat === 0);
  check('room still has 2 seats (no ghost player)', room.seats.length === 2);
  check('lobby shows exactly one host', host2.lastLobby().players.filter(p => p.host).length === 1);

  host2.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  check('reconnected host can start the game', room.started === true);
}

// ── 2. A non-host cannot steal the crown while the host is briefly away ──
{
  const { room } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const other = join(room, { name: 'דנה', pid: 'p-dana', host: true });  // asks for host
  check('second player does not become host', other.lastLobby().youHost === false);

  host1.close();
  const after = join(room, { name: 'עוד', pid: 'p-3' });                 // some event re-broadcasts
  check('crown stays with the absent host during grace', after.lastLobby().players[0].host === true);
  other.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  check('non-host cannot start during grace', room.started === false);
}

// ── 3. Host never comes back: the room is not left stuck ──
{
  const { room } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const other = join(room, { name: 'דנה', pid: 'p-dana' });
  host1.close();
  room.seats[0].downAt = Date.now() - 10 * 60 * 1000;   // gone for ten minutes
  room.broadcastLobby();
  check('someone still in the room becomes host', other.lastLobby().youHost === true);
  other.msg({ t: 'start', fillAI: true, minPlayers: 2 });
  check('the new host can start the game', room.started === true);
}

// ── 4. Reconnect mid-game keeps the seat and its hand ──
{
  const { room } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  host1.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  const handBefore = room.state.players[1].hand.map(c => c.id).join(',');
  dana.close();
  const dana2 = join(room, { name: 'דנה', pid: 'p-dana' });
  check('seat reclaimed after the game started', dana2.lastState().state.players[1].you === true);
  check('hand survives the reconnect',
        room.state.players[1].hand.map(c => c.id).join(',') === handBefore);
  check('no extra seat was created', room.seats.length === 2);
}

// ── 5. Old client with no pid still reclaims by name ──
{
  const { room } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: '', host: true });
  host1.close();
  const host2 = join(room, { name: 'שלו', pid: '' });
  check('name-only client keeps host across reconnect', host2.lastLobby().youHost === true);
  check('name-only client keeps its seat', room.seats.length === 1);
}

// ── 6. Persisted room survives eviction with the host intact ──
{
  const { room, store } = makeRoom();
  const host1 = join(room, { name: 'שלו', pid: 'p-host', host: true });
  join(room, { name: 'דנה', pid: 'p-dana' });
  await room.persist();
  host1.close();

  const ctx2 = { storage: fakeStorage(store) };
  const revived = new Room(ctx2, {});
  await revived.load();
  const host2 = join(revived, { name: 'שלו', pid: 'p-host' });
  check('host survives a durable-object eviction', host2.lastLobby().youHost === true);
  check('seats survive the eviction', revived.seats.length === 2);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
