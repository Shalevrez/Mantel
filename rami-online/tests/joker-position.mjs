// ═══════════════════════════════════════════════════════
// JOKER POSITION — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// A joker that could stand at either end of a sequence goes where the player
// chose (4♥,5♥,6♥+JK → the 3♥ or the 7♥), and it stays there: later attaches
// and a joker swap read its spot from the group's card order.
// ═══════════════════════════════════════════════════════
import { initGame, G, seqLayouts, jokerValues } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const card = (id, suit, v) => ({ id, suit, v, j: false });
const joker = id => ({ id, suit: null, v: 0, j: true });
const jv = cards => jokerValues(cards).map(x => x.v).join();

// Options
const run = [card('4h', 'h', 4), card('5h', 'h', 5), card('6h', 'h', 6), joker('jk')];
check('4-5-6+JK offers the joker as 3 or 7', seqLayouts(run).map(o => jv(o.cards)).join('|') === '3|7');
check('a gap joker has one spot only', seqLayouts([card('4h', 'h', 4), joker('jk'), card('6h', 'h', 6)]).length === 1);
check('Q-K+JK: the joker is J or A', seqLayouts([card('qh', 'h', 12), card('kh', 'h', 13), joker('jk')]).map(o => jv(o.cards)).join('|') === '11|1');
check('A+JK+JK: 2,3 or Q,K', seqLayouts([card('ah', 'h', 1), joker('j1'), joker('j2')]).map(o => jv(o.cards)).join('|') === '2,3|12,13');

// Lay with a chosen spot
let st = initGame(['א', 'ב'].map(name => ({ name, isAI: false })));
const hand0 = [...run, card('9c', 'c', 9), card('7h', 'h', 7), card('3h', 'h', 3), card('8h', 'h', 8)];
st = {
  ...st, phase: 'action', cur: 0, canLay: true, board: [], mk: 0,
  players: st.players.map((p, i) => ({ ...p, hasLaid: false, hand: i === 0 ? hand0 : [card('2s', 's', 2), card('ks', 's', 13)] })),
};
st = { ...st, undoBefore: { hand: hand0, board: [], hasLaid: false, beit: st.beit } };
const low = G({ ...st, sel: ['4h', '5h', '6h', 'jk'] }, { type: 'LAY', start: 3 });
check('laid with start 3 → joker is the 3', jv(low.board[0].cards) === '3');
const high = G({ ...st, sel: ['4h', '5h', '6h', 'jk'] }, { type: 'LAY', start: 4 });
check('laid with start 4 → joker is the 7', jv(high.board[0].cards) === '7');
const dflt = G({ ...st, sel: ['4h', '5h', '6h', 'jk'] }, { type: 'LAY' });
check('no choice → joker on top as before', jv(dflt.board[0].cards) === '7');

// The spot holds through an attach on the other end
const att = G({ ...low, sel: ['7h'] }, { type: 'ATTACH', gid: low.board[0].id });
check('attaching the 7 keeps the joker as the 3', jv(att.board[0].cards) === '3' && att.board[0].cards.length === 5);

// Joker swap uses the chosen spot
const swapped = G({ ...low, sel: ['3h'] }, { type: 'ATTACH', gid: low.board[0].id });
check('the 3♥ swaps out a joker laid as the 3', swapped.mustUseJoker === 'jk');
const noSwap = G({ ...low, sel: ['8h'] }, { type: 'ATTACH', gid: low.board[0].id });
check('the 8♥ does not fit a 3-6 run', noSwap.board[0].cards.length === 4);

// Attaching a joker: either end, by choice
const g = { id: 'g', type: 'seq', cards: [card('4h', 'h', 4), card('5h', 'h', 5), card('6h', 'h', 6)] };
let st2 = { ...st, board: [g], players: st.players.map((p, i) => i === 0 ? { ...p, hasLaid: true } : p) };
check('attach a joker below', jv(G({ ...st2, sel: ['jk'] }, { type: 'ATTACH', gid: 'g', start: 3 }).board[0].cards) === '3');
check('attach a joker above by default', jv(G({ ...st2, sel: ['jk'] }, { type: 'ATTACH', gid: 'g' }).board[0].cards) === '7');

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall joker-position checks passed');
