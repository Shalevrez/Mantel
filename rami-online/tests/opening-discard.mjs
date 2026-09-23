// ═══════════════════════════════════════════════════════
// OPENING DISCARD — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// The card turned up on the discard pile when a round is dealt carries no
// penalty for anyone: if the first player passes on it, whoever takes it after
// them gets it without a penalty card. Later discards still cost one.
// ═══════════════════════════════════════════════════════
import { initGame, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

for (const n of [2, 3]) {
  const names = ['א', 'ב', 'ג'].slice(0, n);
  let st = initGame(names.map(name => ({ name, isAI: false })));
  const top = st.discard[st.discard.length - 1];
  const deckLen = st.deck.length;
  check(`${n} players: the round opens on a free offer`, st.phase === 'buying' && st.buy.free);

  st = G(st, { type: 'SKIP' });
  check(`${n} players: after the first player passes, seat 1 decides`, st.phase === 'buying' && st.buy.checker === 1);
  st = G(st, { type: 'BUY', idx: 1 });
  check(`${n} players: seat 1 gets only the opening card`, st.players[1].hand.length === 15 &&
    st.players[1].hand.some(c => c.id === top.id));
  check(`${n} players: no penalty card leaves the deck`, st.deck.length === deckLen);
  check(`${n} players: the first player still draws`, st.phase === 'draw' && st.cur === 0);

  // A later discard is back to a paid buy.
  st = G(st, { type: 'DRAW' });
  st = G(st, { type: 'DISCARD', cid: st.players[0].hand[0].id });
  check(`${n} players: a later discard is not free`, !st.buy.free);
  st = G(st, { type: 'SKIP' });
  const nextBuyer = st.buy?.checker;
  if (st.phase === 'buying') {
    const before = st.players[nextBuyer].hand.length;
    st = G(st, { type: 'BUY', idx: nextBuyer });
    check(`${n} players: buying a later discard costs a penalty card`, st.players[nextBuyer].hand.length === before + 2);
  }
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall opening-discard checks passed');
