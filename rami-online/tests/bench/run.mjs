// Benchmark CLI — local only.
//   node tests/bench/run.mjs [--a hard] [--b legacy] [--pairs 100] [--players 2] [--seed 1]
//                            [--format mega|mini] [--budget 60000] [--json out.json]
import { duel } from './harness.mjs';
import { makePolicy } from './policies.mjs';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const a = args.a || 'hard', b = args.b || 'legacy';
const pairs = Number(args.pairs || 50), players = Number(args.players || 2), seed0 = Number(args.seed || 1);
const format = args.format || 'mega';
const budget = args.budget ? Number(args.budget) : undefined;
// --tuneA / --tuneB: JSON overrides of the engine's TUNE for one side only.
const { TUNE } = await import('../../src/ai/hard.js');
const tuneOf = j => (j ? { ...TUNE, ...JSON.parse(j) } : undefined);
const mk = (name, t, bud) => () => makePolicy(name, { budget: bud ? Number(bud) : budget, tune: tuneOf(t), loud: !!args.loud });

const t0 = Date.now();
const layout = args.layout || null;
const res = duel(mk(a, args.tuneA, args.budgetA), mk(b, args.tuneB, args.budgetB), {
  pairs, players: layout ? layout.length : players, seed0, format, layout,
  onGame: (r, k, flip) => { if (flip && (k + 1) % 10 === 0) process.stderr.write(`  ${k + 1}/${pairs} pairs\n`); },
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

// Wilson-free quick stats: per duplicate pair, the side's score difference.
function report(side) {
  const s = side.stats;
  const perGame = side.games / (res.games);   // seats per game for this side
  return {
    policy: side.name,
    seats: side.games,
    winShare: +(side.wins / res.games).toFixed(3),
    avgGameTotalPerSeat: +(side.total / side.games).toFixed(1),
    avgRoundPenalty: +(side.roundPen / side.rounds).toFixed(2),
    outRatePerSeatRound: +(side.outs / side.rounds).toFixed(3),
    antsPerSeatRound: +(side.ants / side.rounds).toFixed(4),
    ants: side.ants,
    refused: s.refused, fallbacks: s.fallbacks,
    decisions: s.decisions,
    avgMs: +(s.ms / s.decisions).toFixed(3),
    maxMs: +s.maxMs.toFixed(1),
    ...(() => { const a = [...(s.samples || [])].sort((x, y) => x - y); const q = f => +(a[Math.min(a.length - 1, Math.floor(f * a.length))] || 0).toFixed(2); return { p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), p999Ms: q(0.999) }; })(),
    byKind: Object.fromEntries(Object.entries(s.byKind).map(([k, v]) => [k, { n: v.n, avgMs: +(v.ms / v.n).toFixed(3), maxMs: +v.max.toFixed(1), avgNodes: v.nodes ? Math.round(v.nodes / v.n) : undefined, maxNodes: v.maxNodes }])),
    seatsPerGame: perGame,
  };
}
const out = {
  setup: { a, b, pairs, games: res.games, players: layout ? layout.length : players, layout, format, seed0, budget: budget ?? 'default', secs },
  A: report(res.A), B: report(res.B), problems: res.problems.slice(0, 10), problemCount: res.problems.length,
};
console.log(JSON.stringify(out, null, 2));
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 2));
