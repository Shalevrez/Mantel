// ═══════════════════════════════════════════════════════
// ATTACH FIT — the table's drop targets match what ATTACH accepts
// Run with: npm test
//
// While a card is dragged, only the board groups it fits light up, and a drop
// near one of them attaches there. Those groups come from canAttach, so it must
// say yes exactly when the ATTACH action would take the cards — for every card
// against runs, sets, runs with a joker inside (the swap) and jokers.
// ═══════════════════════════════════════════════════════
import { initGame, G, canAttach, mkCard, SUITS } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const card = (id, suit, v) => ({ id, suit, v, j: suit === 'j' });
const BOARD = [
  { id: 'run',  type: 'seq', cards: [card('5h', 'h', 5), card('6h', 'h', 6), card('7h', 'h', 7)] },
  { id: 'set',  type: 'set', cards: [card('8c', 'c', 8), card('8d', 'd', 8), card('8s', 's', 8)] },
  { id: 'jrun', type: 'seq', cards: [card('9s', 's', 9), card('jk1', 'j', 0), card('js', 's', 11)] },
  { id: 'top',  type: 'seq', cards: [card('js2', 's', 11), card('qs', 's', 12), card('ks', 's', 13)] },
  { id: 'jset', type: 'set', cards: [card('4c', 'c', 4), card('4d', 'd', 4), card('jk2', 'j', 0)] },
];

// Every card there is, plus a joker; and a spare card so the hand never empties.
const deck = [...SUITS.flatMap(s => Array.from({ length: 13 }, (_, i) => mkCard(s, i + 1))), mkCard('j', 0)];
const spare = card('spare', 'c', 2);

function stateWith(hand, sel = []) {
  const st = initGame(['א', 'ב'].map(name => ({ name, isAI: false })), 0);
  return {
    ...st, phase: 'action', cur: 0, canLay: true, board: BOARD, sel,
    players: st.players.map((p, i) => ({ ...p, hasLaid: true, hand: i === 0 ? hand : [card('x', 'd', 3)] })),
  };
}
const took = (before, after, gid) =>
  after.board.find(g => g.id === gid).cards !== before.board.find(g => g.id === gid).cards;

// ── 1. One card at a time, against every group ──
let single = 0, agree = 0, fits = 0;
for (const c of deck) {
  for (const g of BOARD) {
    const st = stateWith([c, spare]);
    const ok = took(st, G(st, { type: 'ATTACH', gid: g.id, cid: c.id }), g.id);
    single++;
    if (ok === canAttach(g, [c])) agree++;
    else console.log(`        mismatch: ${c.j ? 'JK' : c.v + c.suit} → ${g.id} (ATTACH ${ok})`);
    if (ok) fits++;
  }
}
check(`canAttach agrees with ATTACH for all ${single} card/group pairs`, agree === single);
check('and some of them do fit', fits > 5);
check('4♥ and 8♥ fit the 5–7♥ run', canAttach(BOARD[0], [mkCard('h', 4)]) && canAttach(BOARD[0], [mkCard('h', 8)]));
check('9♥ does not', !canAttach(BOARD[0], [mkCard('h', 9)]));
check('10♠ swaps out the joker in 9♠ JK J♠', canAttach(BOARD[2], [mkCard('s', 10)]));
check('8♥ joins the set of eights', canAttach(BOARD[1], [mkCard('h', 8)]));

// ── 2. A selection of two cards, as a drag of a selected card carries ──
let pairs = 0, pairAgree = 0;
const some = deck.filter(c => c.j || [3, 4, 8, 9, 10].includes(c.v));
for (let i = 0; i < some.length; i++) for (let k = i + 1; k < some.length; k++) {
  const a = some[i], b = some[k];
  for (const g of BOARD) {
    const st = stateWith([a, b, spare], [a.id, b.id]);
    const ok = took(st, G(st, { type: 'ATTACH', gid: g.id }), g.id);
    pairs++;
    if (ok === canAttach(g, [a, b])) pairAgree++;
  }
}
check(`canAttach agrees with ATTACH for all ${pairs} two-card selections`, pairAgree === pairs);
check('3♥ 4♥ go onto the run together', canAttach(BOARD[0], [mkCard('h', 3), mkCard('h', 4)]));
check('nothing fits with no cards', !canAttach(BOARD[0], []));

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall attach-fit checks passed');
