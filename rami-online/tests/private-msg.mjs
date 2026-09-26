// ═══════════════════════════════════════════════════════
// PRIVATE MESSAGES & BUY NOTICE — regression checks
// Run with: npm test
//
// A hint or refusal ("invalid group", "one more group to lay") goes only to
// the player whose move produced it. A buy out of turn, on the other hand, is
// announced to everyone until the player on turn discards.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { G } from '../src/game-core.js';
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
const settle = () => new Promise(r => setTimeout(r, 0));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const room = new Room({ storage: fakeStorage(new Map()) }, {});
room.code = 'ABCD';
const a = new FakeWS(), b = new FakeWS();
room.handleSocket(a, 'א', 'ABCD', true, 'p-a', false);
room.handleSocket(b, 'ב', 'ABCD', false, 'p-b', false);
a.msg({ t: 'start', fillAI: false, minPlayers: 2 });
await settle();

// The opener (drawn at random) passes the opening card, the other skips too →
// the opener draws.
const f = room.state.cur, ws = [a, b], me = ws[f], them = ws[1 - f];
me.msg({ t: 'action', action: { type: 'SKIP' } }); await settle();
them.msg({ t: 'action', action: { type: 'SKIP' } }); await settle();
me.msg({ t: 'action', action: { type: 'DRAW' } }); await settle();

// The opener tries to lay an invalid group: the refusal is theirs alone.
const hand = me.last('state').state.players[f].hand;
for (const c of hand.slice(0, 2)) me.msg({ t: 'action', action: { type: 'SEL', id: c.id } });
await settle();
me.msg({ t: 'action', action: { type: 'LAY' } }); await settle();
const own = me.last('state').state.msg, other = them.last('state').state.msg;
check('the acting player sees their message', !!room.state.msg && own === room.state.msg);
check('the opponent does not see it', other === '');
check('the message owner is never sent out', me.last('state').state.msgSeat === undefined);

// A paid buy is announced publicly and cleared on the next discard.
let st = { ...room.state, sivuv: 2, phase: 'buying', cur: 1, buy: { checker: 0, origNext: 1, prev: 0 }, msg: '' };
st = G(st, { type: 'BUY', idx: 0 });
check('buying records a public notice', st.buyNote && st.buyNote.seat === 0 && st.buyNote.paid);
st = G(st, { type: 'DRAW' });
st = G(st, { type: 'DISCARD', cid: st.players[1].hand[0].id });
check('the notice clears once the player on turn discards', st.buyNote === null);

// Taking the discard on your turn is announced too; drawing from the deck is not.
st = { ...room.state, sivuv: 2, phase: 'buying', cur: 1, buy: { checker: 1, origNext: 1, prev: 0 }, msg: '', buyNote: null };
st = G(st, { type: 'TAKE_FREE' });
check('taking from the discard records a public notice',
  st.buyNote && st.buyNote.seat === 1 && !st.buyNote.paid && st.buyNote.onTurn);
st = G(st, { type: 'DISCARD', cid: st.players[1].hand[0].id });
check('the take notice clears on the discard', st.buyNote === null);
st = { ...room.state, sivuv: 2, phase: 'draw', cur: 1, buy: null, msg: '', buyNote: null };
st = G(st, { type: 'DRAW' });
check('drawing from the deck records no notice', st.buyNote === null);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall private-msg checks passed');
