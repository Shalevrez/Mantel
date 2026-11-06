// ═══════════════════════════════════════════════════════
// BENCHMARK HARNESS — plays whole games between AI policies, locally.
//
// Seeded: Math.random is replaced by a seeded generator for the length of a
// game, so a seed fixes the deal, the opener and every reshuffle (until the
// players' different choices make the decks diverge). Games are run as
// duplicate pairs: the same seed twice, with the seat assignment swapped, so
// both sides get the same cards.
//
// Nothing here runs in production or touches Cloudflare.
// ═══════════════════════════════════════════════════════
import { initGame, G } from '../../src/game-core.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cardCount = st => st.deck.length + st.discard.length + (st.beit ? 1 : 0) +
  st.board.reduce((n, g) => n + g.cards.length, 0) +
  st.players.reduce((n, p) => n + p.hand.length, 0);

// Plays one game. `seats` is an array of policies (one per seat). Returns
// per-seat results and any integrity problems found.
export function playGame(seats, seed, { format = 'mega', maxSteps = 200000 } = {}) {
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const problems = [];
  try {
    let st = initGame(seats.map((p, i) => ({ name: `s${i}`, isAI: true, ai: 'hard' })), undefined, { format });
    st = { ...st, buyTimer: 0 };
    const total = cardCount(st);
    const rounds = [];
    let steps = 0;
    while (st.phase !== 'game_end') {
      if (++steps > maxSteps) { problems.push('step limit (deadlock?)'); break; }
      if (st.phase === 'round_end') {
        const r = st.result;
        rounds.push({ w: r.w, isAnt: r.isAnt, empty: r.empty, scores: st.players.map(p => p.lastScore) });
        st = G(st, { type: 'NEXT_MK' });
        if (st.phase !== 'game_end' && cardCount(st) !== total) problems.push('card count at deal');
        continue;
      }
      const before = st;
      if (st.phase === 'buying') {
        const seat = st.buy.checker;
        st = seats[seat].buy(st, seat);
      } else if (st.phase === 'draw') {
        st = seats[st.cur].draw(st, st.cur);
      } else if (st.phase === 'action') {
        const seat = st.cur;
        st = seats[seat].turn(st, seat);
        if (st.phase === 'action' && st.cur === seat) { problems.push('turn did not end'); break; }
      }
      if (st === before) { problems.push(`stuck in ${st.phase}`); break; }
      if (cardCount(st) !== total) { problems.push(`card count ${cardCount(st)} != ${total} after ${before.phase}`); break; }
    }
    return {
      totals: st.players.map(p => p.totalScore),
      rounds, problems, steps,
    };
  } finally {
    Math.random = realRandom;
  }
}

// Runs `pairs` duplicate pairs of `a` vs `b` at an n-seat table (a in the
// even seats first, then in the odd ones) and aggregates.
// With `layout` (e.g. 'ABBB') each seed is played once per rotation of it,
// so every side sits in every chair on the same deal.
export function duel(makeA, makeB, { pairs = 50, players = 2, seed0 = 1, format = 'mega', onGame, layout = null } = {}) {
  const A = makeA(), B = makeB();
  const agg = side => ({ name: side.name, games: 0, wins: 0, total: 0, rounds: 0, roundPen: 0, outs: 0, ants: 0 });
  const res = { A: agg(A), B: agg(B), problems: [], games: 0 };
  for (let k = 0; k < pairs; k++) {
    const rots = layout ? layout.length : 2;
    for (let flip = 0; flip < rots; flip++) {
      const seats = layout
        ? Array.from({ length: layout.length }, (_, i) => (layout[(i + flip) % layout.length] === 'A' ? A : B))
        : Array.from({ length: players }, (_, i) => ((i + flip) % 2 === 0 ? A : B));
      const g = playGame(seats, seed0 + k, { format });
      res.games++;
      if (g.problems.length) res.problems.push({ seed: seed0 + k, flip, problems: g.problems });
      const best = Math.min(...g.totals);
      const winners = g.totals.map((t, i) => t === best ? i : -1).filter(i => i >= 0);
      seats.forEach((p, i) => {
        const r = p === A ? res.A : res.B;
        r.games++;
        r.total += g.totals[i];
        if (winners.includes(i)) r.wins += 1 / winners.length;
        for (const rd of g.rounds) {
          r.rounds++;
          r.roundPen += rd.scores[i];
          if (rd.w === i) { r.outs++; if (rd.isAnt) r.ants++; }
        }
      });
      if (onGame) onGame(res, k, flip === rots - 1);
    }
  }
  res.A.stats = A.stats; res.B.stats = B.stats;
  return res;
}
