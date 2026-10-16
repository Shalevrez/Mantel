// ═══════════════════════════════════════════════════════
// SEQUENTIAL BUY — regression checks
// Run with: npm test
//
// A discard is offered one seat at a time, in turn order: the player on turn
// first (free), then the seats after them (with a penalty card). Only the
// seat being asked (buy.checker) may answer, and its answer is final; a pass
// hands the question to the next seat. In a room with a buy timer each seat
// gets the whole time when the question reaches it.
// ═══════════════════════════════════════════════════════
import { initGame, mkCard, buyOffered, G } from '../src/game-core.js';
import { Room, viewFor, BUY_MS } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// Four players; seat 0 throws, so seat 1 is on turn and the order is 1, 2, 3.
function table() {
  let st = initGame(['א', 'ב', 'ג', 'ד'].map(name => ({ name, isAI: false })), 0);
  const hand = (k) => Array.from({ length: k }, (_, i) => mkCard('h', (i % 13) + 1));
  st = {
    ...st, phase: 'action', cur: 0, buy: null, tookBeit: false, mustUseJoker: null,
    players: st.players.map((p, i) => ({ ...p, hasLaid: true, hand: hand(i === 0 ? 6 : 5) })),
  };
  return G(st, { type: 'DISCARD', cid: st.players[0].hand[0].id });
}
const len = (st, s) => st.players[s].hand.length;

// ── 1. Offered in turn order, starting with the player on turn ──
{
  const st = table();
  check('the window is open', st.phase === 'buying' && st.cur === 1);
  check('offered to everyone but the thrower, in turn order', buyOffered(st).join() === '1,2,3');
  check('the player on turn is asked first', st.buy.checker === 1);
}

// ── 2. A seat further down can't answer before the question reaches it ──
{
  let st = table();
  check('seat 3 can\'t buy out of order', G(st, { type: 'BUY', idx: 3 }) === st);
  check('nor pass out of order', G(st, { type: 'SKIP', seat: 2 }) === st);
  st = G(st, { type: 'SKIP', seat: 1 });
  check('seat 1 passes — seat 2 is asked', st.phase === 'buying' && st.buy.checker === 2);
  check('seat 1 can\'t take it back now', G(st, { type: 'TAKE_FREE' }) === st);
  st = G(st, { type: 'SKIP', seat: 2 });
  check('seat 2 passes — seat 3 is asked', st.buy.checker === 3);
  st = G(st, { type: 'BUY', idx: 3 });
  check('seat 3 gets it with a penalty card', len(st, 3) === 7 && st.players[3].paidBuys === 1);
  check('and the player on turn draws', st.phase === 'draw' && st.cur === 1);
}

// ── 3. The first "want" wins at once ──
{
  let st = table();
  st = G(st, { type: 'SKIP', seat: 1 });
  st = G(st, { type: 'BUY', idx: 2 });
  check('seat 2 gets it without asking seat 3', len(st, 2) === 7 && len(st, 3) === 5 && st.phase === 'draw');
}

// ── 4. The player on turn takes it free ──
{
  let st = table();
  st = G(st, { type: 'TAKE_FREE' });
  check('the player on turn takes it free and plays', st.phase === 'action' && len(st, 1) === 6 && !st.players[1].paidBuys);
}

// ── 5. Nobody wants it ──
{
  let st = table();
  for (const s of [1, 2, 3]) st = G(st, { type: 'SKIP', seat: s });
  check('everyone passed — the player on turn draws', st.phase === 'draw' && st.cur === 1 && len(st, 3) === 5);
}

// ── 6. Time runs out for the seat being asked: the question moves on ──
{
  let st = table();
  check('a timeout for another window does nothing', G(st, { type: 'BUY_CLOSE', id: st.buy.id + 1, checker: 1 }) === st);
  check('a timeout for another seat does nothing', G(st, { type: 'BUY_CLOSE', id: st.buy.id, checker: 2 }) === st);
  st = { ...st, buy: { ...st.buy, deadline: 123 } };
  st = G(st, { type: 'BUY_CLOSE', id: st.buy.id, checker: 1 });
  check('seat 1 ran out of time — seat 2 is asked', st.phase === 'buying' && st.buy.checker === 2 && st.buy.picks[1] === false);
  check('with a fresh clock of its own', st.buy.deadline === undefined);
}

// ── 7. The view says who is being asked ──
{
  let st = table();
  st = G(st, { type: 'SKIP', seat: 1 });
  const v3 = viewFor(st, 3);
  check('everyone sees who is being asked', v3.buy.checker === 2 && v3.buy.offered.join() === '1,2,3');
  check('nobody is sent the answers', v3.buy.picks === undefined);
}

// ── 8. Through the server: only the seat being asked; a clock per seat; the bots ──
class FakeWS {
  constructor() { this.sent = []; this.listeners = {}; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() {}
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  last(t) { return [...this.sent].reverse().find(m => m.t === t); }
}
const tick = () => new Promise(r => setTimeout(r, 0));
{
  const room = new Room({ storage: fakeStorage() }, {});
  await room.fetch(new Request('https://do/create?code=PBUY&mode=online&fee=500&seats=3&buy=10'));
  const ws = [new FakeWS(), new FakeWS(), new FakeWS()];
  ws.forEach((w, i) => room.handleSocket(w, 'p' + i, 'PBUY', i === 0, 'u' + i, false));
  ws[0].msg({ t: 'start' });
  await tick();
  const st = room.state;
  const [first, second] = buyOffered(st);
  check('the clock starts for the seat being asked', st.buy.checker === first && st.buy.deadline > Date.now() &&
    ws[first].last('state').state.buy.msLeft > BUY_MS - 1000);
  ws[second].msg({ t: 'action', action: { type: 'BUY', idx: second } });
  await tick();
  check('the next seat can\'t answer before its turn', room.state.buy.picks[second] === undefined);
  ws[first].msg({ t: 'action', action: { type: 'BUY_CLOSE', id: room.state.buy.id } });
  await tick();
  check('nor can a player close the window', room.state.phase === 'buying' && room.state.buy.checker === first);
  await room.closeBuy(room.state.buy.id, first);
  check('time up for the first seat: the second is asked', room.state.phase === 'buying' && room.state.buy.checker === second);
  const left = room.state.buy.deadline - Date.now();
  check('and gets the whole 10 seconds', left > BUY_MS - 1000 && left <= BUY_MS);
  ws[second].msg({ t: 'action', action: { type: 'BUY', idx: second } });
  await tick();
  check('now it may buy', room.state.phase === 'draw' && room.state.players[second].paidBuys === 1);
}
{
  // A person and three bots: the bots wait for the question to reach them.
  const room = new Room({ storage: fakeStorage() }, {});
  await room.fetch(new Request('https://do/create?code=PBOT&mode=practice&seats=4'));
  const w = new FakeWS();
  room.handleSocket(w, 'אני', 'PBOT', true, 'me', false);
  for (let i = 0; i < 3; i++) w.msg({ t: 'addAI' });
  await tick();
  room.state = { ...initGame(room.seats.map(s => ({ name: s.name, isAI: s.isAI })), 0),
                 room: { mode: 'practice', gameId: 'g' } };
  check('the person is asked first, so no bot answers yet', room.state.buy.checker === 0 && room.aiBuyers(room.state).length === 0);
  room.state = G(room.state, { type: 'SKIP', seat: 0 });
  check('the person passed: the next bot is asked', room.aiBuyers(room.state).join() === String(room.state.buy.checker));
  room.aiBuy();
  check('it answers alone', room.state.phase !== 'buying' || room.state.buy.checker !== 1);
}

// ── 9. The buy timer is the room's choice: none, 10, 20 or 30 seconds ──
async function timedRoom(q) {
  const room = new Room({ storage: fakeStorage() }, {});
  await room.fetch(new Request(`https://do/create?code=TIME&mode=practice&seats=2${q}`));
  const ws = [new FakeWS(), new FakeWS()];
  ws.forEach((w, i) => room.handleSocket(w, 'p' + i, 'TIME', i === 0, 't' + i, false));
  ws[0].msg({ t: 'start' });
  await tick();
  return { room, ws };
}
{
  const { room, ws } = await timedRoom('');
  check('a room asks for no timer unless one is chosen', room.buySecs === 0 && room.state.buyTimer === 0);
  check('without a timer the window has no deadline', room.state.phase === 'buying' && !room.state.buy.deadline &&
    ws[0].last('state').state.buy.msLeft === null);
  check('and the waiting room says so', ws[0].last('lobby').buySecs === 0);
}
{
  const { room } = await timedRoom('&buy=20');
  const left = room.state.buy.deadline - Date.now();
  check('a 20-second room gives the window 20 seconds', room.buySecs === 20 && left > 19000 && left <= 20000);
}
{
  const { room } = await timedRoom('&buy=7');
  check('an unlisted timer falls back to none', room.buySecs === 0);
}
{
  // A game saved before the choice existed keeps the 10-second window.
  const room = new Room({ storage: fakeStorage() }, {});
  await room.fetch(new Request('https://do/create?code=OLD1&mode=practice&seats=2'));
  const saved = await room.ctx.storage.get('room');
  delete saved.buySecs;
  await room.ctx.storage.put('room', saved);
  const again = new Room({ storage: room.ctx.storage }, {});
  await again.load();
  check('a room saved before the choice keeps the 10-second timer', again.buySecs === 10);
  const st = initGame(['א', 'ב'].map(name => ({ name, isAI: false })), 0);
  again.state = st;
  again.started = true;
  again.buyClock();
  const left = again.state.buy.deadline - Date.now();
  check('so does a game saved before it', left > 9000 && left <= 10000);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall sequential-buy checks passed');
