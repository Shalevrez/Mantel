// ═══════════════════════════════════════════════════════
// PARALLEL BUY — regression checks
// Run with: npm test
//
// A discard is offered to everyone who may take it at once. Each seat answers
// "want" / "don't want" on its own, whenever it likes; the card still goes by
// turn order — the player on turn first (free), then the seats after them —
// to the first one that wants it once everyone before it said no. Seats that
// wanted it but were beaten to it are told so (and, in a paid room, get the
// coins they put aside back). The window closes on its own after BUY_MS.
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

// ── 1. Everyone but the thrower is offered the card at once ──
{
  const st = table();
  check('the window is open', st.phase === 'buying' && st.cur === 1);
  check('offered to everyone but the thrower, in turn order', buyOffered(st).join() === '1,2,3');
}

// ── 2. A "want" further down waits for the seats before it ──
{
  let st = table();
  st = G(st, { type: 'BUY', idx: 3 });
  check('seat 3 wants it — still waiting on the seats before', st.phase === 'buying' && len(st, 3) === 5);
  st = G(st, { type: 'SKIP', seat: 1 });
  check('seat 1 passes — still waiting on seat 2', st.phase === 'buying' && st.buy.checker === 2);
  st = G(st, { type: 'SKIP', seat: 2 });
  check('seat 2 passes — seat 3 gets it with a penalty card', len(st, 3) === 7 && st.players[3].paidBuys === 1);
  check('and the player on turn draws', st.phase === 'draw' && st.cur === 1);
}

// ── 3. Once everyone before you said no, a "want" wins at once ──
{
  let st = table();
  st = G(st, { type: 'SKIP', seat: 1 });
  st = G(st, { type: 'BUY', idx: 2 });
  check('seat 2 gets it without waiting for seat 3', len(st, 2) === 7 && st.phase === 'draw');
}

// ── 4. The earlier seat wins; the later one is beaten to it ──
{
  let st = table();
  st = G(st, { type: 'BUY', idx: 3 });
  st = G(st, { type: 'BUY', idx: 2 });
  check('seat 2 waits on seat 1', st.phase === 'buying');
  st = G(st, { type: 'SKIP', seat: 1 });
  check('seat 2 gets it, not seat 3', len(st, 2) === 7 && len(st, 3) === 5);
  check('only seat 2 pays', st.players[2].paidBuys === 1 && !st.players[3].paidBuys);
  check('seat 3 is recorded as beaten to it', st.buyNote.seat === 2 && st.buyNote.outbid.join() === '3');
  check('each seat only learns about itself',
    viewFor(st, 3).buyNote.outbidYou === true && viewFor(st, 2).buyNote.outbidYou === false &&
    viewFor(st, 1).buyNote.outbid === undefined);
}

// ── 5. The player on turn comes first, and takes it free ──
{
  let st = table();
  st = G(st, { type: 'BUY', idx: 2 });
  st = G(st, { type: 'TAKE_FREE' });
  check('the player on turn takes it free and plays', st.phase === 'action' && len(st, 1) === 6 && !st.players[1].paidBuys);
  check('the buyer behind is beaten to it', len(st, 2) === 5 && st.buyNote.outbid.join() === '2');
}

// ── 6. An answer can change until the card is decided ──
{
  let st = table();
  st = G(st, { type: 'BUY', idx: 3 });
  st = G(st, { type: 'SKIP', seat: 3 });
  st = G(st, { type: 'SKIP', seat: 1 });
  st = G(st, { type: 'SKIP', seat: 2 });
  check('seat 3 took the "want" back: nobody gets it', st.phase === 'draw' && len(st, 3) === 5);
  st = table();
  st = G(st, { type: 'SKIP', seat: 1 });
  st = G(st, { type: 'TAKE_FREE' });
  check('the player on turn may still take it after passing', st.phase === 'action' && len(st, 1) === 6);
}

// ── 7. Time runs out: the unanswered don't want it ──
{
  let st = table();
  st = G(st, { type: 'BUY', idx: 3 });
  check('a timeout for another window does nothing', G(st, { type: 'BUY_CLOSE', id: st.buy.id + 1 }) === st);
  st = G(st, { type: 'BUY_CLOSE', id: st.buy.id });
  check('seats 1 and 2 never answered — seat 3 gets it', len(st, 3) === 7 && st.phase === 'draw');
  st = G(table(), { type: 'BUY_CLOSE', id: table().buy.id });
  check('nobody answered — the player on turn draws', st.phase === 'draw' && st.cur === 1);
}

// ── 8. The view hides who wants it ──
{
  let st = table();
  st = G(st, { type: 'BUY', idx: 3 });
  const v2 = viewFor(st, 2), v3 = viewFor(st, 3);
  check('nobody is sent the answers', v2.buy.picks === undefined && v3.buy.picks === undefined);
  check('a seat sees its own answer', v3.buy.mine === true && v2.buy.mine === undefined);
  check('and who is still to answer', v2.buy.waiting.join() === '1,2' && v2.buy.offered.join() === '1,2,3');
}

// ── 9. Through the server: anyone answers any time; the clock; the bots ──
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
  await room.fetch(new Request('https://do/create?code=PBUY&mode=online&fee=500&seats=3'));
  const ws = [new FakeWS(), new FakeWS(), new FakeWS()];
  ws.forEach((w, i) => room.handleSocket(w, 'p' + i, 'PBUY', i === 0, 'u' + i, false));
  ws[0].msg({ t: 'start' });
  await tick();
  const st = room.state;
  const order = buyOffered(st);
  const last = order[order.length - 1], first = order[0];
  check('the window starts its clock when it goes out', st.buy.deadline > Date.now() &&
    ws[last].last('state').state.buy.msLeft > BUY_MS - 1000);
  ws[last].msg({ t: 'action', action: { type: 'BUY', idx: last } });
  await tick();
  check('the last seat in line may answer before its turn', room.state.buy.picks[last] === true);
  ws[first].msg({ t: 'action', action: { type: 'BUY', idx: first } });
  ws[first].msg({ t: 'action', action: { type: 'BUY_CLOSE', id: room.state.buy.id } });
  await tick();
  check('the player on turn cannot buy with a penalty, nor close the window', room.state.phase === 'buying' &&
    room.state.buy.picks[first] === undefined);
  await room.closeBuy(room.state.buy.id);
  check('time up: the seats before never answered, so the last seat gets it',
    room.state.phase === 'draw' && room.state.players[last].paidBuys === 1);
}
{
  // A person and three bots: the bots all answer at once, in one step.
  const room = new Room({ storage: fakeStorage() }, {});
  await room.fetch(new Request('https://do/create?code=PBOT&mode=practice&seats=4'));
  const w = new FakeWS();
  room.handleSocket(w, 'אני', 'PBOT', true, 'me', false);
  for (let i = 0; i < 3; i++) w.msg({ t: 'addAI' });
  await tick();
  // The person opens the game, so every bot is offered the opening card
  // behind them — and the window can't be decided until the person answers.
  room.state = { ...initGame(room.seats.map(s => ({ name: s.name, isAI: s.isAI })), 0),
                 room: { mode: 'practice', gameId: 'g' } };
  check('three bots are waiting to answer', room.aiBuyers(room.state).join() === '1,2,3');
  room.aiBuy();
  check('every bot answered in one go while the person decides', room.state.phase === 'buying' &&
    [1, 2, 3].every(s => room.state.buy.picks[s] !== undefined) && room.state.buy.picks[0] === undefined);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall parallel-buy checks passed');
