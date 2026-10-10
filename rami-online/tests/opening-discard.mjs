// ═══════════════════════════════════════════════════════
// OPENING DISCARD — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// The card turned up on the discard pile at the start of a round behaves like
// any discard: the first player may take it, or pass and draw. If they pass,
// the other players may buy it — with a penalty card, in every round.
// ═══════════════════════════════════════════════════════
import { initGame, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

for (const n of [2, 3]) {
  const names = ['א', 'ב', 'ג'].slice(0, n);
  const fresh = () => initGame(names.map(name => ({ name, isAI: false })), 0);

  // The first player takes it, as on a regular turn.
  {
    let st = fresh();
    const top = st.discard[st.discard.length - 1];
    check(`${n} players: the round opens on the first player's offer`,
      st.phase === 'buying' && st.buy.checker === 0 && st.buy.origNext === 0);
    st = G(st, { type: 'TAKE_FREE' });
    check(`${n} players: the first player takes the opening card and plays`,
      st.phase === 'action' && st.cur === 0 && st.players[0].hand.some(c => c.id === top.id));
  }

  // The first player passes: everyone else gets a buy round, with a penalty card.
  {
    let st = fresh();
    const top = st.discard[st.discard.length - 1];
    const deckLen = st.deck.length;
    st = G(st, { type: 'SKIP' });
    check(`${n} players: after the first player passes, seat 1 decides`, st.phase === 'buying' && st.buy.checker === 1);
    check(`${n} players: the first player can't buy it with a penalty card`,
      G(st, { type: 'BUY', idx: 0 }) === st);
    check(`${n} players: the first player may change their mind and take it`,
      G(st, { type: 'TAKE_FREE' }).phase === 'action');
    st = G(st, { type: 'BUY', idx: 1 });
    check(`${n} players: seat 1 gets the opening card and a penalty card`, st.players[1].hand.length === 16 &&
      st.players[1].hand.some(c => c.id === top.id) && st.deck.length === deckLen - 1);
    check(`${n} players: the buy is counted as paid`, st.players[1].paidBuys === 1 && st.buyNote.paid);
    check(`${n} players: the first player still draws`, st.phase === 'draw' && st.cur === 0);
  }

  // Nobody wants it: every other seat is asked once, then the first player draws.
  {
    let st = fresh();
    st = G(st, { type: 'SKIP' });
    const asked = [];
    while (st.phase === 'buying') { asked.push(st.buy.checker); st = G(st, { type: 'SKIP' }); }
    check(`${n} players: every other seat gets a buy round`,
      asked.join() === Array.from({ length: n - 1 }, (_, i) => i + 1).join());
    check(`${n} players: then the first player draws`, st.phase === 'draw' && st.cur === 0);
  }
}

// Later rounds open the same way.
{
  let st = initGame(['א', 'ב'].map(name => ({ name, isAI: false })), 0);
  st = G({ ...st, phase: 'round_end' }, { type: 'NEW_HAND' });
  st = G(st, { type: 'SKIP' });
  const deckLen = st.deck.length;
  st = G(st, { type: 'BUY', idx: st.buy.checker });
  check('round 2: buying the opening card costs a penalty card', st.deck.length === deckLen - 1);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall opening-discard checks passed');
