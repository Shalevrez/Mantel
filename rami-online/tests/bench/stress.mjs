// ═══════════════════════════════════════════════════════
// STRESS / FUZZ — local only.
//
// Whole games at 2–6 seats with mixed levels, deterministic seeds. On top of
// the harness's checks (cards conserved every step, the game always
// advances, no step limit) it checks, at sampled hard decisions:
//
//   fairness    re-dealing every hidden card (opponents' hands and the
//               deck, sizes kept) never changes the decision
//   fidelity    the turn the engine planned on its public copy plays out on
//               the real state with the same result (own hand, board, phase)
//   legality    every planned move is accepted by the reducer
//
//   node tests/bench/stress.mjs [--seeds 20] [--seed0 7000] [--sample 0.15]
// ═══════════════════════════════════════════════════════
import { G } from '../../src/game-core.js';
import { decideBuy, decideDraw, planTurn, applyIntents, sanitize, BUDGET } from '../../src/ai/hard.js';
import { playGame, mulberry32 } from './harness.mjs';
import { makePolicy } from './policies.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const seeds = Number(args.seeds || 20), seed0 = Number(args.seed0 || 7000), sample = Number(args.sample || 0.15);

const issues = [];
const counts = { fairChecks: 0, fidelityChecks: 0, decisions: 0, budget: 0 };

// Re-deal every card this seat can't see, keeping every size.
function reshuffleHidden(st, seat, rnd) {
  const pool = [...st.deck];
  st.players.forEach((p, i) => { if (i !== seat) pool.push(...p.hand); });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return {
    ...st,
    players: st.players.map((p, i) => i === seat ? p : { ...p, hand: pool.splice(0, p.hand.length) }),
    deck: pool,
  };
}
const ownView = (st, seat) => JSON.stringify({
  hand: st.players[seat].hand.map(c => c.id).sort(),
  board: st.board.map(g => g.cards.map(c => c.id)),
  phase: st.phase, cur: st.cur, laid: st.players[seat].hasLaid,
});

function checkedHard() {
  const base = makePolicy('hard');
  const rnd = mulberry32(99);
  const audit = (kind, st, seat, decide) => {
    counts.decisions++;
    if (rnd() > sample) return;
    counts.fairChecks++;
    // Running out of budget is an outcome too, and must not depend on hidden cards either.
    const run = s => { try { return JSON.stringify(decide(s)); } catch (e) { if (e === BUDGET) { counts.budget++; return 'BUDGET'; } throw e; } };
    const a = run(st);
    const b = run(reshuffleHidden(st, seat, rnd));
    if (a !== b) issues.push({ kind: `fairness/${kind}`, seat, phase: st.phase, a, b });
  };
  return {
    ...base,
    buy: (st, seat) => { audit('buy', st, seat, s => decideBuy(s, seat)); return base.buy(st, seat); },
    draw: (st, seat) => { audit('draw', st, seat, s => decideDraw(s, seat)); return base.draw(st, seat); },
    turn: (st, seat) => {
      audit('turn', st, seat, s => planTurn(s, seat));
      if (rnd() < sample) {
        let intents = null;
        try { intents = planTurn(st, seat); } catch (e) { if (e !== BUDGET) throw e; }
        if (!intents) return base.turn(st, seat);
        counts.fidelityChecks++;
        const onPub = applyIntents(sanitize(st, seat), intents);
        const onReal = applyIntents(st, intents);
        if (!onReal.ok || !onPub.ok) issues.push({ kind: 'legality', seat, okReal: onReal.ok, okPub: onPub.ok });
        else if (ownView(onPub.state, seat) !== ownView(onReal.state, seat)) issues.push({ kind: 'fidelity', seat });
        else if (onReal.state.phase === 'action' && onReal.state.cur === seat) issues.push({ kind: 'turn-not-ended', seat });
      }
      return base.turn(st, seat);
    },
  };
}

const tables = [
  [2, ['H', 'H']], [2, ['H', 'M']], [3, ['H', 'M', 'E']], [3, ['H', 'H', 'H']],
  [4, ['H', 'M', 'H', 'M']], [4, ['H', 'L', 'L', 'L']], [5, ['H', 'H', 'M', 'E', 'H']],
  [6, ['H', 'H', 'H', 'H', 'H', 'H']], [6, ['H', 'M', 'E', 'H', 'M', 'E']],
];
const pols = { M: makePolicy('medium'), E: makePolicy('easy'), L: makePolicy('legacy') };
const hard = checkedHard();
let games = 0, rounds = 0, problems = 0, empty = 0;
const t0 = Date.now();
for (const [n, layout] of tables) {
  for (let k = 0; k < seeds; k++) {
    const seats = layout.map(c => (c === 'H' ? hard : pols[c]));
    const r = playGame(seats, seed0 + 1000 * n + k, { format: k % 3 === 0 ? 'mega' : 'mini' });
    games++; rounds += r.rounds.length; empty += r.rounds.filter(x => x.empty).length;
    if (r.problems.length) { problems++; issues.push({ kind: 'game', n, layout: layout.join(''), seed: seed0 + 1000 * n + k, problems: r.problems }); }
  }
  process.stderr.write(`  ${n} seats ${layout.join('')} done\n`);
}
console.log(JSON.stringify({
  games, rounds, roundsEndedByDeckLimit: empty, gamesWithProblems: problems,
  ...counts, refused: hard.stats.refused, fallbacks: hard.stats.fallbacks,
  issues: issues.slice(0, 20), issueCount: issues.length, secs: ((Date.now() - t0) / 1000).toFixed(0),
}, null, 1));
process.exit(issues.length ? 1 : 0);
