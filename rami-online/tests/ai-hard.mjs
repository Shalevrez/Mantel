// ═══════════════════════════════════════════════════════
// HARD COMPUTER PLAYER — the search engine (src/ai/hand.js, src/ai/hard.js)
// Run with: npm test   (plain node, no test runner needed)
//
// Hand analysis (combinations greedy grouping misses, jokers, duplicate
// cards, opening requirements, aces at both ends), the decisions (take, buy,
// beit, discard, open-or-wait-for-an-ant, endgame), rule safety (every move
// goes through the reducer and the turn always ends), fairness (hidden cards
// never change a decision), the work budget, and whole games.
// ═══════════════════════════════════════════════════════
import { initGame, mkCard, G, findAIGroups, isGroup, MK } from '../src/game-core.js';
import { makeCtx, Solver, bindPlan, INF } from '../src/ai/hand.js';
import { decideBuy, decideDraw, planTurn, applyIntents, sanitize, knowledge, Frame } from '../src/ai/hard.js';
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';
import { playGame } from './bench/harness.mjs';
import { makePolicy } from './bench/policies.mjs';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const C = (s, v) => mkCard(s, v);
const JK = () => mkCard('j', 0);
const txt = cs => cs.map(c => (c.j ? 'JK' : c.v + c.suit)).join(',');

// A context with every card still unseen twice and a calm table.
const ctxFor = (mk, o = {}) => makeCtx({
  need: o.laid ? 0 : MK[mk].seqs, min: MK[mk].min, openOK: true, layNow: true,
  unseen: new Int16Array(52).fill(2), unseenJ: 4, s: o.s ?? 0.85, slotCost: 30, ...o,
});
const canAnt = (hand, mk = 0) => new Solver(ctxFor(mk), 'ant').evaluate(hand).o === 0;
const bestPlan = (hand, mk = 0, o = {}) => {
  const sv = new Solver(ctxFor(mk, o), 'eval');
  const r = sv.evaluate(hand);
  const items = sv.plan(r.o <= r.c ? 'o' : 'c', hand);
  return { r, items: items && bindPlan(items, hand) };
};

// A two- (or more) player game, set up by hand, in the given phase.
function craft({ hands, mk = 0, board = [], discard = [C('c', 2)], beit = null, phase = 'action',
                 cur = 0, canLay = true, laid = [], buy = null } = {}) {
  const st = initGame(hands.map((_, i) => ({ name: 'p' + i, isAI: true, ai: 'hard' })), 0);
  return {
    ...st, mk, phase, cur, canLay, board, discard, beit, buy,
    turnsPlayed: 10, laidAtTurnStart: !!laid[cur], attachedThisTurn: false, tookBeit: false,
    mustUseJoker: null, undoBefore: null, track: [],
    players: st.players.map((p, i) => ({ ...p, hand: hands[i], hasLaid: !!laid[i] })),
  };
}
const filler = n => Array.from({ length: n }, (_, k) => C(['h', 'd', 'c', 's'][k % 4], 2 + (k % 11)));
const play = st => applyIntents(st, planTurn(st, st.cur));

// ── 1. Hand analysis ─────────────────────────────────
{
  // Greedy grouping takes 3-4-5-6♥ as one run and strands 6♦ 6♣; the right
  // split is 3-4-5♥ and a set of sixes.
  const hand = [C('h', 3), C('h', 4), C('h', 5), C('h', 6), C('d', 6), C('c', 6), C('s', 13)];
  check('greedy grouping leaves cards behind on this hand', findAIGroups(hand).unused.length > 1);
  check('the solver lays all but the king (an ant)', canAnt(hand));

  // Two copies of the same card (two decks): 6-7-8♥ and 7♥ 7♦ 7♣ need both 7♥.
  const dup = [C('h', 6), C('h', 7), C('h', 8), C('h', 7), C('d', 7), C('c', 7), C('s', 2)];
  check('duplicate cards are both used', canAnt(dup));
  const { items } = bestPlan(dup);
  check('…as a run and a set', items.filter(i => i.kind === 'seq' || i.kind === 'set').length === 2);

  // The joker belongs where it completes the opening, not in the first run.
  // Two runs of three needed: 5♥6♥ and J♣Q♣K♣ — the joker makes 5-6-JK.
  const two = [C('h', 5), C('h', 6), C('c', 11), C('c', 12), C('c', 13), C('c', 10), JK(), C('s', 2)];
  const p2 = bestPlan(two, 1);
  const runs = p2.items.filter(i => i.kind === 'seq');
  check('with two runs required, the joker completes the short one', runs.length === 2 &&
        runs.some(r => r.cards.some(c => c.j) && r.cards.some(c => c.v === 5)));
  check('…and the clubs run keeps its own cards (10-J-Q-K)', runs.some(r => r.cards.length === 4 && !r.cards.some(c => c.j)));

  // A spare joker is kept rather than stretched onto a run that doesn't need it.
  const spare = bestPlan([C('h', 5), C('h', 6), C('h', 7), JK(), C('s', 9), C('d', 2)], 0, { laid: true, layNow: false, s: 0.92 });
  check('a spare joker is not spent on a complete run', spare.items.some(i => i.kind !== 'seq' && i.cards.some(c => c.j)));

  // Opening requirements: a run of four.
  const threes = [C('h', 5), C('h', 6), C('h', 7), C('d', 9), C('c', 9), C('s', 9), C('s', 2)];
  check('runs of three do not open a "run of four" round', new Solver(ctxFor(2), 'eval').evaluate(threes).o >= INF);
  check('…but do open a "run of three" round', new Solver(ctxFor(0), 'eval').evaluate(threes).o < INF);
  check('sets never count towards the opening', !canAnt([C('d', 9), C('c', 9), C('s', 9), C('h', 2)], 0));

  // Aces at both ends, never around the corner.
  check('Q-K-A is a run', canAnt([C('h', 12), C('h', 13), C('h', 1), C('s', 4)]));
  check('A-2-3 is a run', canAnt([C('h', 1), C('h', 2), C('h', 3), C('s', 4)]));
  check('K-A-2 is not', !canAnt([C('h', 13), C('h', 1), C('h', 2), C('s', 4)]));
  check('10 + three jokers + A is 10-J-Q-K-A', canAnt([C('h', 10), JK(), JK(), JK(), C('h', 1), C('s', 4)], 4));

  // Every planned group is a legal group.
  let bad = 0;
  for (let k = 0; k < 200; k++) {
    const deck = [];
    for (let d = 0; d < 2; d++) for (const s of 'hdcs') for (let v = 1; v <= 13; v++) deck.push(C(s, v));
    deck.push(JK(), JK(), JK(), JK());
    for (let i = deck.length - 1; i > 0; i--) { const j = (i * 7919 + k * 104729) % (i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const hand = deck.slice(0, 14 + (k % 6));
    const { items } = bestPlan(hand, k % 6);
    if (!items) { bad++; continue; }
    if (items.reduce((n, i) => n + i.cards.length, 0) !== hand.length) bad++;
    for (const i of items) if ((i.kind === 'seq' || i.kind === 'set') && !isGroup(i.cards)) bad++;
  }
  check('200 random hands: every card accounted for, every group legal', bad === 0);
}

// ── 2. Taking and buying ─────────────────────────────
{
  const buyState = (hand, top, seat) => craft({
    hands: [hand, filler(14), filler(14)], phase: 'buying', cur: 0,
    discard: [C('s', 8), top],
    buy: { id: 1, origNext: 0, prev: 2, checker: seat, picks: seat ? { 0: false } : {} },
  });
  const hand = [C('h', 5), C('h', 6), C('d', 9), C('c', 9), C('s', 12), C('d', 13), C('c', 2), C('s', 4)];
  check('a card that touches nothing is left on the pile', decideBuy(buyState(hand, C('d', 3), 0), 0).type === 'SKIP');
  check('the card that completes the opening run is taken', decideBuy(buyState(hand, C('h', 7), 0), 0).type === 'TAKE_FREE');
  check('a joker is taken', decideBuy(buyState(hand, JK(), 0), 0).type === 'TAKE_FREE');
  // Out of turn a buy costs a penalty card: a weak pairing isn't worth it.
  const weak = buyState([C('h', 5), C('d', 9), C('c', 12), C('s', 2), C('d', 6), C('c', 4)], C('h', 7), 1);
  weak.players = weak.players.map((p, i) => i === 1 ? { ...p, hand: [C('h', 5), C('d', 9), C('c', 12), C('s', 2), C('d', 6), C('c', 4)] } : p);
  check('a weak pairing is not bought with a penalty card', decideBuy(weak, 1).type === 'SKIP');
  const strong = buyState(filler(14), C('h', 7), 1);
  strong.players = strong.players.map((p, i) => i === 1 ? { ...p, hand: [C('h', 5), C('h', 6), C('d', 9), C('c', 9), C('s', 9), C('c', 2), C('s', 4), C('d', 12)] } : p);
  check('the last card of an opening is bought, penalty and all', decideBuy(strong, 1).type === 'BUY');

  // The beit: only for a certain ant.
  const beitOk = craft({ hands: [[C('h', 5), C('h', 6), C('s', 9)], filler(14)], phase: 'draw', beit: C('h', 7) });
  check('the beit is taken when it completes an ant', decideDraw(beitOk, 0).type === 'TAKE_BEIT');
  const beitNo = craft({ hands: [[C('h', 5), C('h', 6), C('s', 9), C('d', 2)], filler(14)], phase: 'draw', beit: C('h', 7) });
  check('…and left alone when it doesn’t', decideDraw(beitNo, 0).type === 'DRAW');
  const took = G(beitOk, { type: 'TAKE_BEIT' });
  const after = play(took);
  check('after the beit the ant is completed', after.ok && after.state.phase === 'round_end' && after.state.players[0].lastScore === -50);
}

// ── 3. The turn ──────────────────────────────────────
{
  // Going out beats everything.
  const out = play(craft({ hands: [[C('h', 3), C('h', 4), C('h', 5), C('h', 6), C('d', 6), C('c', 6), C('s', 13)], filler(14)] }));
  check('an available ant is played at once', out.ok && out.state.phase === 'round_end' && out.state.players[0].lastScore === -50);

  // Open now or wait for the ant: the pair of nines is one card from making
  // the whole hand an ant. A calm table (nobody close) → it waits.
  const antHand = () => [C('h', 5), C('h', 6), C('h', 7), C('s', 9), C('d', 9), C('c', 13), C('d', 2)];
  const calm = play(craft({ hands: [antHand(), filler(14), filler(14)] }));
  check('on a calm table it holds back for the ant', calm.ok && !calm.state.players[0].hasLaid && calm.state.phase === 'buying');
  check('…throwing the king, not a card of the plan', calm.ok && calm.state.discard.at(-1).v === 13);
  // An opponent who has opened and holds one card is likely out next turn:
  // now it lays down to cut its losses.
  const board = [{ id: 'g1', type: 'seq', owner: 1, cards: [C('s', 3), C('s', 4), C('s', 5)] }];
  const tense = play(craft({ hands: [antHand(), [C('d', 4)], filler(14)], laid: [false, true, false], board }));
  check('with an opponent one card from going out it lays now', tense.ok && tense.state.players[0].hasLaid);

  // Discards: keep the near-complete run, throw the lone high card.
  const disc = play(craft({ hands: [[C('h', 6), C('h', 7), C('d', 13), C('s', 9), C('c', 9), C('h', 2), C('c', 4), C('d', 12)], filler(14)], mk: 1 }));
  check('it never throws half of a two-card run when a lone face card is spare',
        disc.ok && ![6, 7].includes(disc.state.discard.at(-1).v) && disc.state.discard.at(-1).suit !== 'h');
  // Danger: the queen of spades is this hand's natural throw. The next
  // player took the Q♦ from the pile earlier (face up, so everyone knows)
  // and still holds it. While they are far from going out the queen goes;
  // once they have opened and hold two cards, it stays.
  const dHand = () => [C('h', 5), C('h', 6), C('d', 9), C('c', 9), C('s', 12), C('d', 3), C('c', 4), C('h', 13), C('c', 13)];
  const dangerRun = (close) => {
    const qd = C('d', 12);
    const st = craft({
      hands: [dHand(), close ? [qd, C('c', 7)] : [qd, ...filler(13)], filler(14)],
      laid: [false, close, false], mk: 1,
      board: [{ id: 'gq', type: 'seq', owner: 1, cards: [C('h', 9), C('h', 10), C('h', 11)] }],
    });
    st.track = [{ s: 1, k: 't', c: { id: qd.id, suit: 'd', v: 12, j: false } }];
    const r = play(st);
    return r.ok && r.state.discard.at(-1);
  };
  const farQ = dangerRun(false), nearQ = dangerRun(true);
  check('with the next player far from out, it throws the Q♠', farQ && farQ.suit === 's' && farQ.v === 12);
  check('with them nearly out (and known to hold Q♦), it keeps it', nearQ && !(nearQ.suit === 's' && nearQ.v === 12));

  // An opened hand dumps everything it can.
  const dump = play(craft({
    hands: [[C('s', 6), C('s', 7), C('d', 10), C('d', 11), C('d', 12), C('h', 2)], filler(14)],
    laid: [true, false], board,
  }));
  check('an opened hand lays and attaches all it can, then throws',
        dump.ok && dump.state.phase === 'round_end' && dump.state.result.w === 0);

  // Joker swap: a board joker that stands for the 6♠ comes back, and goes
  // straight into a new run with two cards that couldn't be laid otherwise.
  const jb = [{ id: 'g2', type: 'seq', owner: 1, cards: [C('s', 4), C('s', 5), JK()] }];
  const swap = play(craft({
    hands: [[C('s', 6), C('c', 9), C('c', 10), C('h', 13), C('d', 2), C('h', 4)], filler(14)],
    laid: [true, false], board: jb,
  }));
  const usedJoker = swap.ok && swap.state.board.some(g => g.cards.some(c => c.j) && g.cards.some(c => c.suit === 'c' && c.v === 9));
  check('it swaps a board joker out and uses it in a new run', usedJoker);
  check('…and no joker is left owed in hand', swap.ok && !swap.state.players[0].hand.some(c => c.j));

  // A beit taken for an ant that can't be completed goes back.
  const strandedBefore = [C('h', 5), C('h', 6), C('s', 9)];
  const sb = C('c', 2);
  const stranded = craft({ hands: [[...strandedBefore, sb], filler(14)] });
  stranded.tookBeit = true;
  stranded.undoBefore = { hand: strandedBefore, board: [], hasLaid: false, beit: sb, deck: [], discard: [], fromBeit: true };
  const back = play(stranded);
  check('a beit that can’t make an ant is handed back', back.ok && back.state.phase === 'draw' && back.state.beit.id === sb.id);
}

// ── 4. Fairness: hidden cards never change a decision ──
{
  let same = 0, total = 0;
  for (let k = 0; k < 12; k++) {
    const st = initGame([{ name: 'a', isAI: true }, { name: 'b', isAI: true }, { name: 'c', isAI: true }], 0);
    const s1 = { ...st, phase: 'action', canLay: true, turnsPlayed: 5 };
    // Same public picture, different hidden cards: opponents' hands and the
    // deck are dealt again from the same pool.
    const pool = [...s1.players[1].hand, ...s1.players[2].hand, ...s1.deck].reverse();
    const s2 = {
      ...s1,
      players: s1.players.map((p, i) => i === 0 ? p : { ...p, hand: pool.splice(0, p.hand.length) }),
      deck: pool,
    };
    total += 3;
    if (JSON.stringify(planTurn(s1, 0)) === JSON.stringify(planTurn(s2, 0))) same++;
    const b1 = { ...s1, phase: 'buying', buy: { id: 1, origNext: 0, prev: 2, checker: 0, picks: {} } };
    const b2 = { ...s2, phase: 'buying', buy: b1.buy };
    if (JSON.stringify(decideBuy(b1, 0)) === JSON.stringify(decideBuy(b2, 0))) same++;
    const d1 = { ...s1, phase: 'draw' }, d2 = { ...s2, phase: 'draw' };
    if (JSON.stringify(decideDraw(d1, 0)) === JSON.stringify(decideDraw(d2, 0))) same++;
  }
  check('decisions are identical whatever the hidden cards are', same === total);
  const st = initGame([{ name: 'a', isAI: true }, { name: 'b', isAI: true }], 0);
  const pub = sanitize(st, 0);
  check('the engine’s view holds no opponent card', pub.players[1].hand.every(c => c.id.startsWith('?')));
  check('…and no deck card', pub.deck.every(c => c.id.startsWith('?')) && pub.deck.length === st.deck.length);
  // Unseen counts come from public cards only.
  const kn = knowledge(pub, 0);
  const counted = kn.unseen.reduce((a, b) => a + b, 0) + kn.unseenJ;
  check('unseen cards = everything not in own hand, pile or beit', counted === 108 - st.players[0].hand.length - st.discard.length - 1);
  // Cards an opponent took face up are remembered as theirs.
  const t = { ...st, track: [{ s: 1, k: 't', c: { id: 'x1', suit: 'h', v: 7, j: false } }] };
  check('a card an opponent took from the pile is remembered', knowledge(sanitize(t, 0), 0).known[1].length === 1);
}

// ── 5. Budget and safety nets ─────────────────────────
{
  // A starved budget never produces an illegal move: the room's fallback
  // finishes the turn.
  const big = [];
  for (const s of 'hdcs') for (let v = 2; v <= 7; v++) big.push(C(s, v));
  big.push(JK(), JK());
  const st = craft({ hands: [big, filler(14)], mk: 3 });
  let threw = false;
  try { planTurn(st, 0, 50); } catch (e) { threw = true; }
  check('a tiny budget stops the search', threw);
  const room = new Room({ storage: fakeStorage() }, {});
  room.seats = [{ ai: 'hard', isAI: true }, { ai: 'medium', isAI: true }];
  room.state = st;
  room.aiAction();
  check('the room still finishes the turn (big hand)', room.state.phase !== 'action');
  const b = craft({ hands: [big, filler(14)], phase: 'buying', discard: [C('s', 13), C('h', 8)],
    buy: { id: 1, origNext: 0, prev: 1, checker: 0, picks: {} } });
  const a = decideBuy(b, 0, 300);
  check('a starved buy decision still answers legally', a.type === 'TAKE_FREE' || a.type === 'SKIP');
}

// ── 6. Whole games ───────────────────────────────────
{
  const hard = makePolicy('hard'), medium = makePolicy('medium');
  let problems = 0, rounds = 0;
  for (const [seed, seats] of [[11, [hard, medium, hard, medium]], [12, [hard, hard, hard]], [13, [medium, hard]]]) {
    const r = playGame(seats, seed, { format: 'mini' });
    problems += r.problems.length;
    rounds += r.rounds.length;
  }
  check('three whole games: no deadlock, no lost or duplicated card', problems === 0 && rounds === 9);
  check('…and no refused move or fallback along the way', hard.stats.refused === 0 && hard.stats.fallbacks === 0);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
