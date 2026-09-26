// ═══════════════════════════════════════════════════════
// DECK REFILL — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// When the deck runs out, the discard pile is shuffled back in as the new deck,
// except the last card thrown, which stays face up on the pile. Drawing, taking
// and buying then go on as before. The round only ends on the deck when there is
// nothing left to reshuffle.
// ═══════════════════════════════════════════════════════
import { initGame, mkCard, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const ids = cards => cards.map(c => c.id).sort().join(',');
const pile = k => Array.from({ length: k }, (_, i) => mkCard('s', (i % 13) + 1));

// Three players; seat 1 is about to draw. `deck` and `discard` are set by hand.
function table(deck, discard) {
  const st = initGame(['א', 'ב', 'ג'].map(name => ({ name, isAI: false })), 0);
  return {
    ...st, phase: 'draw', cur: 1, buy: null, deck, discard,
    players: st.players.map(p => ({ ...p, hand: pile(5) })),
  };
}

// ── 1. Drawing from an empty deck reshuffles the pile, keeping the top card ──
{
  const discard = pile(6);
  const top = discard[5];
  const st = G(table([], discard), { type: 'DRAW' });
  check('the round goes on', st.phase === 'action');
  check('the player drew a card', st.players[1].hand.length === 6);
  check('the last card thrown stays on the pile', st.discard.length === 1 && st.discard[0].id === top.id);
  check('the rest of the pile became the deck (one drawn)', st.deck.length === 4);
  check('no card is lost or duplicated',
    ids([...st.deck, ...st.discard, st.players[1].hand[5]]) === ids(discard));
  check('the reshuffle is logged', st.log.some(l => l.includes('האשפה עורבבה')));
}

// ── 2. Drawing the deck's last card refills it right away ──
{
  const last = mkCard('h', 7);
  const discard = pile(4);
  const st = G(table([last], discard), { type: 'DRAW' });
  check('the last deck card is drawn', st.players[1].hand.some(c => c.id === last.id));
  check('the deck is refilled at once', st.deck.length === 3);
  check('the pile keeps only its top card', st.discard.length === 1 && st.discard[0].id === discard[3].id);
  // The next draw comes from the new deck.
  const next = G({ ...st, phase: 'draw', cur: 2 }, { type: 'DRAW' });
  check('drawing goes on from the new deck', next.phase === 'action' && next.deck.length === 2);
}

// ── 3. Nothing to reshuffle: the round ends on the deck as before ──
{
  const st = G(table([], [mkCard('h', 2)]), { type: 'DRAW' });
  check('an empty deck with a single pile card ends the round', st.phase === 'round_end' && st.result.empty);
}

// ── 4. A paid buy on an empty deck takes its penalty from the reshuffled pile ──
{
  const discard = pile(5);
  const top = discard[4];
  const st = {
    ...table([], discard), phase: 'buying',
    buy: { checker: 2, origNext: 1, prev: 0, free: false },
  };
  const out = G(st, { type: 'BUY', idx: 2 });
  check('the buyer gets the top card and a penalty card', out.players[2].hand.length === 7 &&
    out.players[2].hand.some(c => c.id === top.id));
  check('the buy is a paid one', out.players[2].paidBuys === 1);
  check('the turn goes on to the draw', out.phase === 'draw');
  check('no card is lost or duplicated',
    ids([...out.deck, ...out.discard, ...out.players[2].hand.slice(5)]) === ids(discard));
  check('the rest stays in the new deck', out.deck.length === 3 && out.discard.length === 0);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall deck-refill checks passed');
