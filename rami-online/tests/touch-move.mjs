// ═══════════════════════════════════════════════════════
// TOUCH-MOVE (נגעת נסעת) — a room rule picked when the room is created
// Run with: npm test
//
// On (the default): what went down on the table stays there — "undo" is
// refused. A taken beit can still be given back, groups still waiting on the
// opening requirement can still be cleared, and an invalid group never goes
// down at all. Off: undo works as before.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';
import { initGame, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const card = (id, suit, v) => ({ id, suit, v, j: false });
const HAND = [card('3s', 's', 3), card('4s', 's', 4), card('5s', 's', 5),
              card('6s', 's', 6), card('9s', 's', 9), card('kh', 'h', 13)];

// Player 0, already opened this round, drew and is in the action phase.
function setup(touchMove, extra = {}) {
  let st = initGame(['א', 'ב'].map(name => ({ name, isAI: false })), 0);
  st = {
    ...st, touchMove, phase: 'action', cur: 0, canLay: true, mk: 0, board: [],
    laidAtTurnStart: true, attachedThisTurn: false, tookBeit: false,
    players: st.players.map((p, i) => ({ ...p, hasLaid: true, hand: i === 0 ? HAND : [card('2c', 'c', 2)] })),
    ...extra,
  };
  return { ...st, undoBefore: { hand: HAND, board: [], hasLaid: true, beit: st.beit } };
}
const sel = (st, ...ids) => ids.reduce((s, id) => G(s, { type: 'SEL', id }), st);

// ── 1. On: a laid group stays on the table ──
{
  let st = G(sel(setup(true), '3s', '4s', '5s'), { type: 'LAY' });
  check('the run is laid', st.board.length === 1 && st.players[0].hand.length === 3);
  const after = G(st, { type: 'UNDO' });
  check('undo is refused', after.board.length === 1 && after.players[0].hand.length === 3);
  check('with a touch-move message', /נגעת נסעת/.test(after.msg));
  const att = G(st, { type: 'ATTACH', gid: st.board[0].id, cid: '6s' });
  check('an attach stays too', G(att, { type: 'UNDO' }).board[0].cards.length === 4);
}

// ── 2. Off: undo returns the cards to the hand ──
{
  let st = G(sel(setup(false), '3s', '4s', '5s'), { type: 'LAY' });
  st = G(st, { type: 'UNDO' });
  check('undo returns the run to the hand', st.board.length === 0 && st.players[0].hand.length === 6);
}

// ── 3. An invalid group never goes down, rule or no rule ──
{
  const st = G(sel(setup(true), '3s', '4s', 'kh'), { type: 'LAY' });
  check('an invalid group is not laid', st.board.length === 0 && st.players[0].hand.length === 6);
}

// ── 4. Groups waiting on the opening requirement can still be cleared ──
{
  let st = setup(true, { mk: 1 });  // needs two runs
  st = { ...st, players: st.players.map((p, i) => i === 0 ? { ...p, hasLaid: false } : p),
         undoBefore: { ...st.undoBefore, hasLaid: false } };
  st = G(sel(st, '3s', '4s', '5s'), { type: 'LAY' });
  check('a lone run waits in staging', st.board.length === 0 && st.staging.length === 1);
  st = G(st, { type: 'CLEAR_STAGE' });
  check('and can be cleared', st.staging.length === 0 && st.players[0].hand.length === 6);
}

// ── 5. A taken beit can still be given back ──
{
  let st = initGame(['א', 'ב'].map(name => ({ name, isAI: false })), 0);
  st = { ...st, touchMove: true, phase: 'draw', cur: 0,
         players: st.players.map((p, i) => i === 0 ? { ...p, hasLaid: false } : p) };
  const beit = st.beit;
  st = G(st, { type: 'TAKE_BEIT' });
  check('beit taken', st.tookBeit && st.beit === null);
  st = G(st, { type: 'UNDO' });
  check('the beit goes back', st.phase === 'draw' && st.beit && st.beit.id === beit.id);
}

// ── 6. The room: on by default, the host switches it, it rides on the game ──
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
for (const [q, want] of [['', true], ['&touch=1', true], ['&touch=0', false]]) {
  const store = new Map();
  const room = new Room({ storage: fakeStorage(store) }, {});
  await room.fetch(new Request(`https://do/create?code=ABCD&mode=online&fee=0&seats=3${q}`));
  const host = new FakeWS();
  room.handleSocket(host, 'שלו', 'ABCD', true, 'p1', false);
  const guest = new FakeWS();
  room.handleSocket(guest, 'דנה', 'ABCD', false, 'p2', false);
  const tag = q || '(not given)';
  check(`created with ${tag}: everyone sees ${want}`, guest.last('lobby').touchMove === want);
  host.msg({ t: 'touchMove', on: !want });
  await tick();
  check(`${tag}: the lobby can no longer change it`, room.touchMove === want);
  const again = new Room({ storage: fakeStorage(store) }, {});
  await again.load();
  check(`${tag}: the setting is persisted`, again.touchMove === want);
  host.msg({ t: 'start' });
  await tick();
  check(`${tag}: the game carries it`, host.last('state').state.touchMove === want);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall touch-move checks passed');
