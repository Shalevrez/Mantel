// ═══════════════════════════════════════════════════════
// PAID GAME — a whole game for coins, start to finish
// Run with: npm test
//
// Three people in a 500-coin room (with two, nobody is ever left to buy out
// of turn: once the next player passes, the offer is over) play all six mishkakonim through the real
// server and reducer (the moves themselves are picked by the AI's own logic,
// driven from the players' seats). They buy with a penalty card whenever the
// offer comes, so the pot grows along the way. At the end every coin must be
// accounted for: three entry fees plus 10 per paid buy, all of it paid out.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';
import { settle, buyPrice } from '../src/economy.js';

class FakeWS {
  constructor() { this.sent = []; this.listeners = {}; this.closed = false; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { if (this.closed) return; this.closed = true; (this.listeners.close || []).forEach(f => f()); }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  last(t) { return [...this.sent].reverse().find(m => m.t === t); }
}
const tick = () => new Promise(r => setTimeout(r, 0));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const room = new Room({ storage: fakeStorage() }, {});
await room.fetch(new Request('https://do/create?code=PAID&mode=online&fee=500&seats=3'));
const ws = [new FakeWS(), new FakeWS(), new FakeWS()];
room.handleSocket(ws[0], 'שלו', 'PAID', true, 'p1', false);
room.handleSocket(ws[1], 'דנה', 'PAID', false, 'p2', false);
room.handleSocket(ws[2], 'יוסי', 'PAID', false, 'p3', false);
ws[0].msg({ t: 'start' });
await tick();
check('the game starts with the room terms', room.started && room.state.room.fee === 500);

let buysSent = 0, freeBuys = 0, steps = 0, offers = 0;
while (room.state.phase !== 'game_end' && steps++ < 20000) {
  const st = room.state;
  if (st.phase === 'round_end') {
    ws[0].msg({ t: 'action', action: { type: 'NEXT_MK' } });
  } else if (st.phase === 'buying') {
    const c = st.buy.checker;
    const onLast = st.players[c].hand.length === 1;
    // The player on turn passes on the discard every other time, so the offer
    // moves on to the others — who then buy it.
    if (c === st.buy.origNext) ws[c].msg({ t: 'action', action: { type: onLast || (offers++ % 2) ? 'SKIP' : 'TAKE_FREE' } });
    else if (!onLast && st.deck.length > 2) {
      if (st.buy.free) freeBuys++; else buysSent++;
      ws[c].msg({ t: 'action', action: { type: 'BUY', idx: c } });
    } else ws[c].msg({ t: 'action', action: { type: 'SKIP' } });
  } else if (st.phase === 'draw') {
    ws[st.cur].msg({ t: 'action', action: { type: 'DRAW' } });
  } else if (st.phase === 'action') {
    // Let the AI's logic pick the lay/attach/discard for this human seat.
    room.aiAction();
  }
  await tick();
}

const st = room.state;
check('the game reached its end', st.phase === 'game_end');
check('all six mishkakonim were played', st.history.length >= 6);
const counted = st.players.reduce((a, p) => a + p.paidBuys, 0);
check(`every paid buy was counted (${counted})`, counted === buysSent && counted > 0);
check(`the ${freeBuys} penalty-free opening buys were not`, counted === buysSent);

const res = settle(st);
const price = buyPrice(500);
check('the pot is three fees plus the buys', res.pot === 1500 + price * counted);
check('every coin in the pot is paid out', res.seats.reduce((a, s) => a + s.prize, 0) === res.pot);
const best = Math.min(...st.players.map(p => p.totalScore));
check('the lowest total wins', st.players.every((p, i) => (p.totalScore === best) === (res.seats[i].place === 1)));
for (let i = 0; i < 3; i++) {
  const s = res.seats[i];
  check(`seat ${i}: put in fee + its own buys`, s.paid === 500 + price * st.players[i].paidBuys);
}
// What both wallets end up with, all told, is what they started with: coins
// only move between the players.
const net = res.seats.reduce((a, s) => a + s.prize - s.paid, 0);
check('no coin is made or lost between the three wallets', net === 0);
// And each player's own screen sees the same result.
const views = ws.map(w => w.last('state').state);
check('both players see the same game over', views.every(v => v.phase === 'game_end' && settle(v).pot === res.pot));

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log(`\nall paid-game checks passed (${counted} paid buys, pot ${res.pot})`);
