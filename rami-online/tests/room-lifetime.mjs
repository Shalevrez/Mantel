// ═══════════════════════════════════════════════════════
// ROOM LIFETIME — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// A room used to live forever: the durable object kept the game state — hands
// included — long after everyone had gone, and every code minted by /api/new
// stayed allocated even if nobody joined. The Room now closes itself on three
// deadlines. These checks drive each one, plus the cases that must NOT close a
// room: a move during a long game, and a player coming back in time.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';

const MIN = 60_000;

class FakeWS {
  constructor(tag) { this.tag = tag; this.sent = []; this.listeners = {}; this.closed = null; }
  accept() {}
  send(s) { if (this.closed) throw new Error('socket closed'); this.sent.push(JSON.parse(s)); }
  close(code, reason) {
    if (this.closed) return;
    this.closed = { code, reason };
    (this.listeners.close || []).forEach(f => f());
  }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  of(t) { return this.sent.filter(m => m.t === t); }
}

function makeRoom() {
  const storage = fakeStorage();
  const room = new Room({ storage }, {});
  return { room, storage };
}
function join(room, { name, pid, host = false }) {
  const ws = new FakeWS(`${name}/${pid}`);
  room.handleSocket(ws, name, 'ABCD', host, pid);
  return ws;
}
// A room with a code, two players, and (optionally) a game under way.
async function busyRoom({ start = false } = {}) {
  const { room, storage } = makeRoom();
  await room.fetch(new Request('https://do/create?code=ABCD'));
  const a = join(room, { name: 'שלו', pid: 'p-a', host: true });
  const b = join(room, { name: 'דנה', pid: 'p-b' });
  if (start) a.msg({ t: 'start', fillAI: false, minPlayers: 2 });
  return { room, storage, a, b };
}
// Every deadline is measured from a stored timestamp, so "an hour passed" is
// just an older timestamp — no clock stubbing, no waiting.
const ago = ms => Date.now() - ms;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. Created, never joined → closes on the empty deadline ──
{
  const { room, storage } = makeRoom();
  const res = await room.fetch(new Request('https://do/create?code=WXYZ'));
  check('create returns the code', (await res.json()).code === 'WXYZ');
  check('an alarm is armed at creation', (await storage.getAlarm()) != null);

  room.emptySince = ago(5 * MIN);
  await room.alarm();
  check('still open five minutes in', storage.store.has('room'));
  check('alarm re-armed when nothing is due', (await storage.getAlarm()) != null);

  room.emptySince = ago(11 * MIN);
  await room.alarm();
  check('abandoned code is released after ten minutes', !storage.store.has('room'));
  check('alarm cleared, so the empty object stops waking up', (await storage.getAlarm()) == null);
  check('room reset in memory too', room.code === null && room.seats.length === 0);
}

// ── 2. Players connected → the empty clock is off, the idle clock runs ──
{
  const { room, storage, a, b } = await busyRoom();
  check('nobody-here clock is off while sockets are on', room.emptySince === null);

  room.lastSeen = ago(20 * MIN);
  await room.alarm();
  check('twenty quiet minutes is not enough to close', storage.store.has('room'));

  room.lastSeen = ago(46 * MIN);
  await room.alarm();
  check('forty-five quiet minutes closes the room', !storage.store.has('room'));
  check('both players are told', a.of('closed').length === 1 && b.of('closed').length === 1);
  check('and told why', a.of('closed')[0].reason === 'idle');
  check('sockets hung up cleanly', a.closed && a.closed.code === 1000);

  // Hanging up fires each socket's close handler mid-shutdown.
  await new Promise(r => setTimeout(r, 20));
  check('close handlers did not write the room back', !storage.store.has('room'));
  check('close handlers did not re-arm an alarm', (await storage.getAlarm()) == null);
  check('the object can host a fresh room', room.closing === false);
}

// ── 3. A move resets the idle clock ──
{
  const { room, storage, a } = await busyRoom({ start: true });
  check('game started', room.started && !!room.state);
  room.lastSeen = ago(44 * MIN);
  const seat = room.state.cur;
  room.seats[seat].ws.msg({ t: 'action', action: { type: 'SORT' } });
  await new Promise(r => setTimeout(r, 0));
  check('the move refreshed the idle clock', Date.now() - room.lastSeen < MIN);
  await room.alarm();
  check('a room being played is left alone', storage.store.has('room'));
  check('nobody was told it closed', a.of('closed').length === 0);
}

// ── 4. Everyone leaves mid-game → closes on the empty deadline ──
{
  const { room, storage, a, b } = await busyRoom({ start: true });
  a.close();
  check('one player left, the other is still on', room.emptySince === null);
  b.close();
  check('the last player out starts the empty clock', room.emptySince !== null);

  room.emptySince = ago(11 * MIN);
  await room.alarm();
  check('an abandoned game is cleaned up', !storage.store.has('room'));
}

// ── 5. …but someone coming back in time stops that clock ──
{
  const { room, storage, a, b } = await busyRoom({ start: true });
  a.close(); b.close();
  room.emptySince = ago(9 * MIN);

  const back = join(room, { name: 'שלו', pid: 'p-a' });
  check('a returning player stops the empty clock', room.emptySince === null);
  await room.alarm();
  check('the room is kept for them', storage.store.has('room'));
  check('and they are back in their own seat', back.sent.some(m => m.t === 'lobby' && m.youSeat === 0));
}

// ── 6. Game over → closes once the scoreboard has been read ──
{
  const { room, storage, a } = await busyRoom({ start: true });
  check('no end time while the game is live', room.endedAt === null);

  room.state = { ...room.state, phase: 'game_end' };
  room.touch();
  check('reaching game_end starts the countdown', room.endedAt !== null);

  room.endedAt = ago(2 * MIN);
  await room.alarm();
  check('the final scores stay up for the first few minutes', storage.store.has('room'));

  room.endedAt = ago(6 * MIN);
  await room.alarm();
  check('a finished room closes after the grace period', !storage.store.has('room'));
  check('and says the game ended', a.of('closed')[0].reason === 'finished');
}

// ── 7. A refused connection must not keep the room looking busy ──
{
  const { room, a, b } = await busyRoom({ start: true });
  const late = new FakeWS('late');
  room.handleSocket(late, 'מאחר', 'ABCD', false, 'p-late');
  check('a late joiner is refused', late.of('error').length === 1);

  a.close(); b.close();
  check('no phantom socket is left behind', room.sockets.size === 0);
  check('the empty clock starts despite the refused connection', room.emptySince !== null);
}

// ── 8. The deadlines are persisted, not just held in memory ──
{
  const { room, storage } = await busyRoom({ start: true });
  await room.persist();
  const saved = storage.store.get('room');
  check('lastSeen is stored', typeof saved.lastSeen === 'number');

  // …the durable object is evicted; the alarm wakes a brand-new instance.
  const revived = new Room({ storage }, {});
  await revived.load();
  check('the code came back with it', revived.code === 'ABCD');
  check('revived with no sockets, so it counts as empty', revived.emptySince !== null);

  revived.emptySince = ago(11 * MIN);
  await revived.alarm();
  check('the revived instance still closes the room', !storage.store.has('room'));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
