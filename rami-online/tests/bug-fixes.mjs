// ═══════════════════════════════════════════════════════
// BUG FIXES 3.15.3 — one check per bug, so none comes back
// Run with: npm test
//
//   A  a computer player's buy answer that arrives after the window was
//      decided must not stall the computer now on turn
//   B  a pending player who reloads after a rematch sees their own seat on
//      the final table, even when chairs before theirs were cleared
//   C  a buy with a penalty card marks only the two new cards as new
//   D  the buy timer picked on the create screen reaches the room
//   E  lay / attach / throw / undo only in the turn's action phase
//   F  A,2…J lays as A-2-…-J, not 2-…-J-A
//   G  in a paid room a buy the declared wallet can't cover is refused
// ═══════════════════════════════════════════════════════
import worker, { Room } from '../src/worker/index.js';
import { G, initGame, mkCard, orderSeq, layoutStart } from '../src/game-core.js';
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
const settle = (ms = 0) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// Everyone passes on the opening card; the player on turn is left to draw.
function toDraw(s) {
  for (const seat of [...(s.buy ? [s.buy.origNext] : [])]) s = G(s, { type: 'SKIP', seat });
  while (s.phase === 'buying') s = G(s, { type: 'SKIP', seat: s.buy.checker });
  return s;
}

// ── A. A late computer buy answer doesn't stall the game ──
{
  const room = new Room({ storage: fakeStorage() }, {});
  room.code = 'AAAA';
  room.started = true;
  room.seats = [
    { name: 'שלו', isAI: false, uid: 'pid:h', connected: false },
    { name: 'מחשב 1', isAI: true, ai: 'medium', uid: 'ai:1' },
    { name: 'מחשב 2', isAI: true, ai: 'medium', uid: 'ai:2' },
  ];
  let s = initGame([{ name: 'שלו' }, { name: 'מחשב 1', isAI: true }, { name: 'מחשב 2', isAI: true }], 0);
  // The window was decided before the scheduled answer ran: bot 1 is on turn to draw.
  room.state = { ...toDraw(s), cur: 1 };
  let threw = false;
  try { room.aiBuy(); } catch { threw = true; }
  check('A: a buy answer for a closed window does nothing', !threw);
  room.scheduleAI(() => room.aiBuy());
  await settle(1500);
  check('A: the computer on turn still plays its turn', room.state.cur !== 1 || room.state.phase !== 'draw');
}

// ── B. After a rematch, a reload shows your own seat ──
{
  const room = new Room({ storage: fakeStorage() }, {});
  room.code = 'BBBB';
  const join = (name, pid, opts = {}) => { const ws = new FakeWS(); room.handleSocket(ws, name, 'BBBB', !!opts.host, pid, !!opts.resume); return ws; };
  const host = join('שלו', 'p-h', { host: true });
  const dana = join('דנה', 'p-d');
  join('יוסי', 'p-y');
  host.msg({ t: 'start' });
  await settle();
  room.state = { ...room.state, phase: 'game_end' };
  dana.close();                         // went home: her chair is cleared
  await settle();
  host.msg({ t: 'rematch' });
  await settle();
  const yossi2 = join('יוסי', 'p-y', { resume: true });
  const fin = yossi2.last('state')?.state;
  const you = fin && fin.players.find(p => p.you);
  check('B: the reload gets the final table', fin && fin.phase === 'game_end');
  check('B: and is himself on it', you && you.name === 'יוסי');
}

// ── C. A paid buy marks two new cards, not three ──
{
  let s = toDraw(initGame([{ name: 'א' }, { name: 'ב' }, { name: 'ג' }], 0));
  s = G(s, { type: 'DRAW' });
  const drawn = s.players[0].newIds[0];
  s = G(s, { type: 'DISCARD', cid: s.players[0].hand.find(c => c.id !== drawn).id });
  // ב is on turn and passes; ג buys.
  s = G(s, { type: 'SKIP', seat: 1 });
  s = G(s, { type: 'BUY', idx: 2 });
  s = G(s, { type: 'DRAW' });
  s = G(s, { type: 'DISCARD', cid: s.players[1].hand[0].id });
  // ג is on turn, draws and keeps the drawn card; then א passes and ב buys from ג.
  s = toDraw(s);
  s = G(s, { type: 'DRAW' });
  const cDrawn = s.players[2].newIds[0];
  s = G(s, { type: 'DISCARD', cid: s.players[2].hand.find(c => c.id !== cDrawn).id });
  s = G(s, { type: 'SKIP', seat: 0 });
  s = G(s, { type: 'BUY', idx: 1 });
  check('C: the buyer has exactly the bought card and the penalty card marked new',
    s.players[1].newIds.length === 2 && s.players[1].newIds.every(id => s.players[1].hand.some(c => c.id === id)));
}

// ── D. /api/new passes the buy timer on to the room ──
{
  let seen = '';
  const env = { ROOMS: {
    idFromName: n => n,
    get: () => ({ fetch: async req => { seen = req.url; return Response.json({ code: 'X' }); } }),
  } };
  await worker.fetch(new Request('https://x/api/new?mode=online&touch=1&buy=10'), env);
  check('D: the room is created with the buy timer', new URL(seen).searchParams.get('buy') === '10');
}

// ── E. Turn moves only in the action phase ──
{
  const room = new Room({ storage: fakeStorage() }, {});
  let s = initGame([{ name: 'א' }, { name: 'ב' }], 0);
  room.state = s;
  const cid = s.players[0].hand[0].id;
  check('E: no throw while the discard is on offer', !room.actionAllowed(0, { type: 'DISCARD', cid }));
  room.state = s = toDraw(s);
  check('E: no throw before drawing', !room.actionAllowed(0, { type: 'DISCARD', cid }));
  check('E: no lay before drawing', !room.actionAllowed(0, { type: 'LAY' }));
  room.state = s = G(s, { type: 'DRAW' });
  check('E: a throw after drawing is fine', room.actionAllowed(0, { type: 'DISCARD', cid }));
  check('E: and only by the player on turn', !room.actionAllowed(1, { type: 'DISCARD', cid }));
  room.state = { ...s, phase: 'round_end' };
  check('E: no undo once the round is scored', !room.actionAllowed(0, { type: 'UNDO' }));
  const won = G({ ...s, players: s.players.map((p, i) => i === 0 ? { ...p, hand: [p.hand[0]], hasLaid: true } : p) },
    { type: 'DISCARD', cid: s.players[0].hand[0].id });
  check('E: a won round keeps no undo snapshot', won.phase === 'round_end' && won.undoBefore === null);
}

// ── F. A run from the ace up to the jack keeps the ace low ──
{
  const run = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(v => mkCard('s', v));
  const o = orderSeq(run);
  check('F: A..J orders as 1..11', o.map(c => c.v).join() === '1,2,3,4,5,6,7,8,9,10,11' && layoutStart(o) === 1);
  const high = orderSeq([mkCard('h', 10), mkCard('j'), mkCard('j'), mkCard('j'), mkCard('h', 1)]);
  check('F: 10,JK,JK,JK,A still goes up to the ace', high[0].v === 10 && high[4].v === 1 && layoutStart(high) === 10);
  const qka = orderSeq([mkCard('c', 1), mkCard('c', 13), mkCard('c', 12)]);
  check('F: Q,K,A stays ace high', qka.map(c => c.v).join() === '12,13,1');
}

// ── G. A paid room refuses a buy the declared wallet can't cover ──
async function paidBuy(coins) {
  const room = new Room({ storage: fakeStorage() }, {});
  await room.fetch(new Request('https://do/create?code=GGGG&mode=online&fee=500&seats=3'));
  const ws = [new FakeWS(), new FakeWS(), new FakeWS()];
  room.handleSocket(ws[0], 'א', 'GGGG', true, 'g1', false, 5000);
  room.handleSocket(ws[1], 'ב', 'GGGG', false, 'g2', false, 5000);
  room.handleSocket(ws[2], 'ג', 'GGGG', false, 'g3', false, coins);
  ws[0].msg({ t: 'start' });
  await settle();
  // The opening card is offered seat by seat; the seats before ג (seat 2)
  // pass, then ג asks to buy it. When ג is the one on turn it would take it
  // for free — nothing to test, so the caller deals again.
  if (room.state.buy.origNext === 2) return null;
  while (room.state.phase === 'buying' && room.state.buy.checker !== 2)
    ws[room.state.buy.checker].msg({ t: 'action', action: { type: 'SKIP' } });
  ws[2].msg({ t: 'action', action: { type: 'BUY', idx: 2 } });
  await settle();
  return { paid: room.state.players[2].paidBuys || 0, err: ws[2].last('error')?.msg || '' };
}
async function paidBuyRetry(coins) {
  for (let i = 0; i < 20; i++) { const r = await paidBuy(coins); if (r) return r; }
  return { paid: -1, err: '' };
}
{
  const poor = await paidBuyRetry(500);
  check('G: only the entry fee in the wallet — the buy is refused', poor.paid === 0 && /אין מספיק מטבעות/.test(poor.err));
  const rich = await paidBuyRetry(5000);
  check('G: enough coins — the buy goes through', rich.paid === 1);
  const old = await paidBuyRetry(null);
  check('G: a client that declares nothing is not blocked', old.paid === 1);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall bug-fix checks passed');
process.exit(0);
