// ═══════════════════════════════════════════════════════
// ATTACH MARK — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// When a card is attached to a group already on the board, the group is marked
// (`att`: who attached, which cards are new) so every player sees where the table
// changed. The mark stays up for a full go-around and clears as the attacher's
// next turn begins.
// ═══════════════════════════════════════════════════════
import { initGame, G } from '../src/game-core.js';
import { viewFor } from '../src/worker/index.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const card = (id, suit, v) => ({ id, suit, v, j: false });
const set7 = { id: 'g1', type: 'set', cards: [card('7h', 'h', 7), card('7d', 'd', 7), card('7c', 'c', 7)] };
const seq = { id: 'g2', type: 'seq', cards: [card('3s', 's', 3), card('4s', 's', 4), card('5s', 's', 5)] };

let st = initGame(['א', 'ב', 'ג'].map(name => ({ name, isAI: false })));
st = {
  ...st, phase: 'action', cur: 0, canLay: true, board: [set7, seq],
  players: st.players.map((p, i) => ({
    ...p, hasLaid: true,
    hand: i === 0 ? [card('7s', 's', 7), card('6s', 's', 6), card('kh', 'h', 13), card('qc', 'c', 12)]
      : i === 1 ? [card('2s', 's', 2), card('qd', 'd', 12), card('ks', 's', 13)]
      : [card('9c', 'c', 9), card('jd', 'd', 11)],
  })),
};
st = { ...st, undoBefore: { hand: st.players[0].hand, board: st.board, hasLaid: true, beit: st.beit } };

// Player 0 attaches to both groups.
st = G(st, { type: 'ATTACH', gid: 'g1', cid: '7s' });
st = G(st, { type: 'ATTACH', gid: 'g2', cid: '6s' });
const g1 = st.board.find(g => g.id === 'g1'), g2 = st.board.find(g => g.id === 'g2');
check('attached set is marked by the attacher', g1.att && g1.att.by === 0);
check('mark names the attached card', g1.att.ids.join() === '7s');
check('attach to a sequence marks it too', g2.att && g2.att.ids.join() === '6s');
check('mark is public (reaches other seats)', viewFor(st, 2).board.find(g => g.id === 'g1').att?.by === 0);

// Undo wipes the attaches, and their marks with them.
const undone = G(st, { type: 'UNDO' });
check('undo drops the mark', undone.board.every(g => !g.att));

// Player 0 discards; player 1 attaches to the same sequence.
st = G(st, { type: 'DISCARD', cid: 'kh' });
check('mark survives into the next turn', st.board.find(g => g.id === 'g1').att?.by === 0);
st = { ...st, phase: 'action', buy: null };
st = G(st, { type: 'ATTACH', gid: 'g2', cid: '2s' });
const g2b = st.board.find(g => g.id === 'g2');
check('a new attacher takes the mark over', g2b.att.by === 1 && g2b.att.ids.join() === '2s');

// Player 1 → 2: player 0's set mark is still shown to player 2.
st = G(st, { type: 'DISCARD', cid: 'qd' });
check("still marked on the third player's turn", st.board.find(g => g.id === 'g1').att?.by === 0);

// Player 2 → 0: a full go-around, player 0's mark clears; player 1's stays.
st = { ...st, phase: 'action', buy: null };
st = G(st, { type: 'DISCARD', cid: 'jd' });
check("mark clears when the attacher's turn comes back", !st.board.find(g => g.id === 'g1').att);
check("other players' marks stay", st.board.find(g => g.id === 'g2').att?.by === 1);

// AI attaches mark the group the same way.
let ai = { ...st, phase: 'action', buy: null, cur: 1,
  players: st.players.map((p, i) => i === 1 ? { ...p, hand: [card('8s', 's', 8), card('x', 'd', 12)] } : p) };
ai = { ...ai, board: ai.board.map(g => g.id === 'g2' ? { ...g, cards: [...g.cards, card('7x', 's', 7)] } : g) };
ai = G(ai, { type: 'AI_ATTACH', gid: 'g2', cid: '8s' });
check('AI attach marks the group', ai.board.find(g => g.id === 'g2').att?.ids.includes('8s'));

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall attach-mark checks passed');
