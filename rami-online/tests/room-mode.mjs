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
import { G, initGame } from '../src/game-core.js';
import { viewFor } from '../src/worker/index.js';

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
  check('a paid room takes no bots', lobby.maxAI === 0);
  host.msg({ t: 'addAI' });
  check('adding a bot to a paid room is refused', room.seats.length === 1 && /רק מול אנשים/.test(host.last('error').msg));
  host.msg({ t: 'start', fillAI: true, minPlayers: 3 });
  check('and the old fill-with-bots start adds none either', !room.started && room.seats.length === 1);
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

// ── 5. Buys with a penalty card are counted, free takes are not ──
{
  const base = initGame([{ name: 'א', isAI: false }, { name: 'ב', isAI: false }, { name: 'ג', isAI: false }]);
  check('a new game counts no buys', base.players.every(p => p.paidBuys === 0));
  const buying = { ...base, phase: 'buying', cur: 0, buy: { checker: 2, origNext: 1, prev: 0, free: false } };
  const paid = G(buying, { type: 'BUY', idx: 2 });
  check('a buy with a penalty card is counted', paid.players[2].paidBuys === 1 && paid.players[2].hand.length === base.players[2].hand.length + 2);
  const freeBuy = G({ ...buying, buy: { ...buying.buy, free: true } }, { type: 'BUY', idx: 2 });
  check('the penalty-free opening buy is not counted', freeBuy.players[2].paidBuys === 0);
  const take = G({ ...buying, cur: 1, buy: { checker: 1, origNext: 1, prev: 0, free: false } }, { type: 'TAKE_FREE' });
  check('a free take is not counted', take.players[1].paidBuys === 0);
  check('everyone sees how many times a player bought', viewFor(paid, 0).players[2].paidBuys === 1);
}

// ── 6. Taking a card at the start of your own turn never costs coins ──
// Only a buy with a penalty card is counted (and so charged). Drawing from the
// deck, taking the discard on your turn, or taking the beit are all free.
{
  const base = initGame([{ name: 'א', isAI: false }, { name: 'ב', isAI: false }, { name: 'ג', isAI: false }]);
  const room = { mode: 'online', fee: 500, gameId: 'g' };
  const potOf = st => settle({ ...st, room }).pot;
  const fresh = { ...base, room, sivuv: 2, cur: 1 };
  const draw = G({ ...fresh, phase: 'draw', buy: null }, { type: 'DRAW' });
  check('drawing from the deck is free', draw.players[1].hand.length === base.players[1].hand.length + 1 &&
        draw.players.every(p => p.paidBuys === 0) && potOf(draw) === 1500);
  // The player on turn is offered the discard first (checker === origNext),
  // and not only in the first round: here it's round 2, where buys cost.
  const offer = { ...fresh, phase: 'buying', buy: { checker: 1, origNext: 1, prev: 0, free: false } };
  const took = G(offer, { type: 'TAKE_FREE' });
  check('taking the discard on your turn is free', took.phase === 'action' &&
        took.players.every(p => p.paidBuys === 0) && potOf(took) === 1500);
  const beit = G({ ...fresh, phase: 'draw', buy: null, canLay: true }, { type: 'TAKE_BEIT' });
  check('taking the beit is free', beit.players.every(p => p.paidBuys === 0));
  // ...and after passing it on, the next seat's buy is the one that costs.
  const passed = G(offer, { type: 'SKIP' });
  const bought = G(passed, { type: 'BUY', idx: passed.buy.checker });
  check('only a buy out of turn costs (10 coins into the pot)', bought.players[passed.buy.checker].paidBuys === 1 &&
        bought.players[1].paidBuys === 0 && potOf(bought) === 1510);
}

// ── 7. Walking out of a paid game: no bot, the fee stays in the pot ──
{
  const room = await makeRoom('mode=online&fee=500&seats=4');
  const host = join(room, { name: 'שלו', pid: 'p1', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p2' });
  const yossi = join(room, { name: 'יוסי', pid: 'p3' });
  const rina = join(room, { name: 'רינה', pid: 'p4' });
  host.msg({ t: 'start' });
  await settle0();
  // Put it on Dana's turn, then she leaves.
  room.state = { ...room.state, phase: 'draw', buy: null, cur: 1 };
  dana.msg({ t: 'leave' });
  await settle0();
  const st = room.state;
  check('no bot takes the chair', !room.seats[1].isAI && room.seats[1].left && !st.players[1].isAI);
  check('the seat is out, its hand off the table', st.players[1].out && st.players[1].hand.length === 0);
  check('her turn passes to the next player', st.cur === 2 && ['buying', 'draw'].includes(st.phase));
  check('the table is told', /יצא מהמשחק/.test(host.last('state').state.log.at(-1)));
  check('the others see her as out', host.last('state').state.players[1].out === true);
  check('she cannot come back to the seat', (join(room, { name: 'דנה', pid: 'p2' }), room.seats[1].left && !room.seats[1].connected));

  // The out seat is skipped from now on: a full go-around never lands on it.
  let s2 = { ...room.state, phase: 'action', cur: 0, buy: null, undoBefore: null, tookBeit: false, mustUseJoker: null };
  const after = G(s2, { type: 'DISCARD', cid: s2.players[0].hand[0].id });
  check('the turn after seat 0 skips the out seat', after.cur === 2);
  check('and so does the buying round', !after.buy || after.buy.checker !== 1);

  // A new round deals her nothing.
  const { startHand } = await import('../src/game-core.js');
  const next = startHand({ ...room.state, sivuv: 1 });
  check('a new round deals the out seat no cards', next.players[1].hand.length === 0 && next.players[0].hand.length === 14);

  // Two more leave: one player is left and the game is over.
  yossi.msg({ t: 'leave' });
  rina.msg({ t: 'leave' });
  await settle0();
  check('with one player left the game ends', room.state.phase === 'game_end');
  const res = settle(room.state);
  check('the one who stayed takes the whole pot', res.pot === 2000 && res.seats[0].prize === 2000 && res.seats[0].place === 1);
  check('those who left win nothing and finish last', [1, 2, 3].every(i => res.seats[i].prize === 0 && res.seats[i].place === 2));
}

// ── 8. A free room (no fee) or practice settles nothing: no coins, XP or trophies ──
{
  const free = { players: [{ totalScore: 5 }, { totalScore: 50 }], room: { mode: 'online', fee: 0, gameId: 'f' } };
  check('a free online game gives no XP or trophies', settle(free) === null);
}

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall room-mode checks passed');
