// ═══════════════════════════════════════════════════════
// LAST CARD — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// A player holding a single card may not take from the discard pile — neither
// the free take as the next player nor a paid buy out of turn. The buying round
// passes over them without asking, and on their own turn they draw from the deck.
// ═══════════════════════════════════════════════════════
import { initGame, mkCard, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// Three players; seat 0 is on turn and about to discard. `sizes` sets each
// seat's hand size after that discard (seat 0 keeps one extra to throw).
function table(sizes) {
  let st = initGame(['א', 'ב', 'ג'].map(name => ({ name, isAI: false })));
  const hand = (k) => Array.from({ length: k }, (_, i) => mkCard('h', (i % 13) + 1));
  st = {
    ...st, phase: 'action', cur: 0, buy: null, tookBeit: false, mustUseJoker: null,
    players: st.players.map((p, i) => ({ ...p, hasLaid: true, hand: hand(i === 0 ? sizes[0] + 1 : sizes[i]) })),
  };
  return G(st, { type: 'DISCARD', cid: st.players[0].hand[0].id });
}

// Next player on their last card: no free offer, the buy passes on to seat 2.
let st = table([5, 1, 5]);
check('next player on one card is not offered the discard', st.phase === 'buying' && st.buy.checker === 2);
check('TAKE_FREE is refused for a one-card player',
  G({ ...st, buy: { ...st.buy, checker: 1 } }, { type: 'TAKE_FREE' }).players[1].hand.length === 1);
const after = G(st, { type: 'SKIP' });
check('once the others pass, the one-card player draws', after.phase === 'draw' && after.cur === 1);
const drawn = G(after, { type: 'DRAW' });
check('drawing from the deck still works', drawn.phase === 'action' && drawn.players[1].hand.length === 2);

// A one-card player further round the table is never asked to buy.
st = table([5, 5, 1]);
check('next player with a full hand still gets the free offer', st.buy.checker === 1);
st = G(st, { type: 'SKIP' });
check('the buy skips the one-card player and goes to draw', st.phase === 'draw' && !st.buy);

// Everyone else is down to one card: straight to the draw.
st = table([5, 1, 1]);
check('no one may take — straight to the draw', st.phase === 'draw' && st.cur === 1);

// A direct BUY from a one-card seat is refused.
st = table([5, 5, 1]);
const bought = G({ ...st, buy: { ...st.buy, checker: 2 } }, { type: 'BUY', idx: 2 });
check('BUY is refused for a one-card player', bought.players[2].hand.length === 1 && bought.phase === 'buying');

// Two cards is not the last card: buying still works.
st = table([5, 5, 2]);
st = G(st, { type: 'SKIP' });
check('a two-card player is still offered the buy', st.phase === 'buying' && st.buy.checker === 2);
st = G(st, { type: 'BUY', idx: 2 });
check('and can buy (card + penalty)', st.players[2].hand.length === 4);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall last-card checks passed');
