// ═══════════════════════════════════════════════════════
// SCOREBOARD — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// The leaderboard is only as good as `state.history`: one record per finished
// round, carrying that round's scores and the totals they produced. It has to
// survive a new deal and a move to the next mishkakon, it has to agree with the
// per-player totals, and — since it rides out to every client with the state —
// it must never carry a card.
// ═══════════════════════════════════════════════════════
import { initGame, endWin, endDeck, handScore, mkCard, G, cSc } from '../src/game-core.js';
import { viewFor } from '../src/worker/index.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const game = () => initGame([
  { name: 'שלו', isAI: false },
  { name: 'דנה', isAI: false },
], 0);

// Give each seat a hand we know the value of, so the arithmetic is checkable.
function withHands(st, hands) {
  return { ...st, players: st.players.map((p, i) => ({ ...p, hand: hands[i] })) };
}

// ── 1. handScore is the scoring rule, not a second opinion ──
{
  const hand = [mkCard('h', 5), mkCard('s', 13), mkCard('j', 0), mkCard('d', 1)];
  check('handScore sums card values (5 + K10 + JK10 + A10 = 35)', handScore(hand) === 35);
  check('handScore agrees with cSc card by card',
    handScore(hand) === hand.reduce((s, c) => s + cSc(c), 0));
  check('an empty hand is worth nothing', handScore([]) === 0);
  check('a missing hand is worth nothing', handScore(undefined) === 0);
}

// ── 2. A round that ends on the deck records one row ──
{
  const st = withHands(game(), [
    [mkCard('h', 5), mkCard('h', 6)],   // 11
    [mkCard('s', 13)],                  // 10
  ]);
  const done = endDeck(st);
  check('one round recorded', done.history.length === 1);
  const h = done.history[0];
  check('numbered from 1', h.n === 1);
  check('scores are this round only', h.scores[0] === 11 && h.scores[1] === 10);
  check('totals match the players', h.totals[0] === done.players[0].totalScore);
  check('the deck-out has no winner', h.w === null && h.empty === true);
  check('the mishkakon is named for the column header', h.mkName === 'שלישייה');
  check('the row carries no cards', JSON.stringify(h).includes('suit') === false);
}

// ── 3. Going out, and going out with an ant ──
{
  const st = withHands({ ...game(), cur: 0 }, [[], [mkCard('s', 13), mkCard('h', 4)]]);
  const plain = endWin(st, st.players, [], false);
  check('the winner scores nothing for an empty hand', plain.history[0].scores[0] === 0);
  check('everyone else is charged their hand', plain.history[0].scores[1] === 14);
  check('the winner seat is recorded', plain.history[0].w === 0 && plain.history[0].isAnt === false);

  const ant = endWin(st, st.players, [], true);
  check('an ant is recorded as one', ant.history[0].isAnt === true);
  check('and pays −50', ant.history[0].scores[0] === -50);
  check('the row agrees with the totals it produced',
    ant.history[0].totals[0] === ant.players[0].totalScore);
}

// ── 4. History survives the next deal and the next mishkakon ──
{
  let st = withHands(game(), [[mkCard('h', 5)], [mkCard('s', 13)]]);
  st = endDeck(st);
  st = G(st, { type: 'NEW_HAND' });          // same mishkakon, another deal
  check('a new deal keeps the round already played', st.history.length === 1);
  check('and deals fresh hands anyway', st.players[0].hand.length === 14);

  st = withHands(st, [[mkCard('c', 9)], [mkCard('d', 2)]]);
  st = endDeck(st);
  check('the second round is appended, not replaced', st.history.length === 2);
  check('rounds are numbered in order', st.history.map(h => h.n).join() === '1,2');
  check('totals accumulate across rounds',
    st.history[1].totals[0] === st.history[0].totals[0] + st.history[1].scores[0]);

  st = G(st, { type: 'NEXT_MK' });           // on to the next mishkakon
  check('moving to the next mishkakon keeps the table', st.history.length === 2);
  check('and the new round will be recorded under it', st.mk === 1);

  st = withHands(st, [[mkCard('h', 3)], [mkCard('s', 7)]]);
  st = endDeck(st);
  check('the third row names the new mishkakon', st.history[2].mkName === 'שתי שלישיות');
  check("a player's total is the sum of their column",
    st.players[0].totalScore === st.history.reduce((s, h) => s + h.scores[0], 0));
}

// ── 5. The table reaches the client, the hands still don't ──
{
  let st = withHands(game(), [[mkCard('h', 5)], [mkCard('s', 13)]]);
  st = endDeck(st);
  const view = viewFor(st, 0);
  check('the client is sent the history', Array.isArray(view.history) && view.history.length === 1);
  check('with the same numbers the server has', view.history[0].scores[1] === 10);
  check('my own hand is still mine to see', Array.isArray(view.players[0].hand));
  check("an opponent's hand is still hidden", view.players[1].hand === undefined);
  check('and the deck is still hidden', view.deck === undefined);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
