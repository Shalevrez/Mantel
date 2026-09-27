// ═══════════════════════════════════════════════════════
// ANT WITH OWN ATTACH — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// Laying a run and then adding to that same run in the same turn is the same
// as laying it longer to begin with, so going out that way is still an ant.
// Adding to someone else's group is not. Every player also gets a color of
// their own, and the groups they lay remember who laid them.
// ═══════════════════════════════════════════════════════
import { initGame, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const card = (id, suit, v) => ({ id, suit, v, j: false });
const other = { id: 'gx', type: 'set', owner: 1, cards: [card('9h', 'h', 9), card('9d', 'd', 9), card('9c', 'c', 9)] };

// Player 0 holds 3♠4♠5♠ + 6♠ + 9♠ + K♥ and hasn't laid this round.
function setup(extra = {}) {
  let st = initGame(['א', 'ב', 'ג'].map(name => ({ name, isAI: false })), 0);
  const hand = [card('3s', 's', 3), card('4s', 's', 4), card('5s', 's', 5),
                card('6s', 's', 6), card('9s', 's', 9), card('kh', 'h', 13)];
  st = {
    ...st, phase: 'action', cur: 0, canLay: true, mk: 0, board: [other],
    laidAtTurnStart: false, attachedThisTurn: false, tookBeit: false,
    players: st.players.map((p, i) => ({ ...p, hasLaid: false, hand: i === 0 ? hand : [card('2c' + i, 'c', 2)] })),
    ...extra,
  };
  st = { ...st, undoBefore: { hand, board: st.board, hasLaid: false, beit: st.beit } };
  // Lay 3♠4♠5♠.
  st = G(st, { type: 'SEL', id: '3s' });
  st = G(st, { type: 'SEL', id: '4s' });
  st = G(st, { type: 'SEL', id: '5s' });
  return G(st, { type: 'LAY' });
}

// 1. Lay, attach 6♠ to my own new run, go out.
let st = setup();
const mine = st.board.find(g => g.id !== 'gx');
check('a laid group records its owner', mine && mine.owner === 0);
st = G(st, { type: 'ATTACH', gid: mine.id, cid: '6s' });
check('attaching to my own new run is not an attach', st.attachedThisTurn === false);
// Drop the 9♠ so K♥ is the last card and discarding it goes out.
st = { ...st, players: st.players.map((p, i) => i === 0 ? { ...p, hand: p.hand.filter(c => c.id !== '9s') } : p) };
st = G(st, { type: 'DISCARD', cid: 'kh' });
check('going out after attaching to my own run is an ant', st.phase === 'round_end' && st.result.isAnt === true);
check('the ant bonus is −50', st.players[0].lastScore === -50);

// 2. Lay, then attach to someone else's group → not an ant.
st = setup();
st = G(st, { type: 'ATTACH', gid: 'gx', cid: '9s' });
check("attaching to another player's group counts", st.attachedThisTurn === true);
const m2 = st.board.find(g => g.owner === 0);
st = G(st, { type: 'ATTACH', gid: m2.id, cid: '6s' });
check('a later own attach does not undo it', st.attachedThisTurn === true);
st = G(st, { type: 'DISCARD', cid: 'kh' });
check('going out that way is a plain finish', st.phase === 'round_end' && st.result.isAnt === false);

// 3. Beit taken, lay, attach to my own run, go out → allowed, and an ant.
st = setup({ tookBeit: true });
const m3 = st.board.find(g => g.owner === 0);
st = G(st, { type: 'ATTACH', gid: m3.id, cid: '6s' });
st = { ...st, players: st.players.map((p, i) => i === 0 ? { ...p, hand: p.hand.filter(c => c.id !== '9s') } : p) };
st = G(st, { type: 'DISCARD', cid: 'kh' });
check('with the beit, own attach still completes the ant', st.phase === 'round_end' && st.result.isAnt === true);

// 4. Colors: every player gets one, and no two share it.
for (let n = 2; n <= 6; n++) {
  const g = initGame(Array.from({ length: n }, (_, i) => ({ name: 'p' + i, isAI: false })), 0);
  const cols = g.players.map(p => p.color);
  check(`${n} players: each has a distinct color`, cols.every(Boolean) && new Set(cols).size === n);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall ant-own-attach checks passed');
