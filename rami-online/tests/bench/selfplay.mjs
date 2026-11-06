// Self-play integrity run: n seats of one policy, whole games, checking card
// conservation every step, deadlocks, and how rounds end.
//   node tests/bench/selfplay.mjs [--games 10] [--players 6] [--policy hard]
import { playGame } from './harness.mjs';
import { makePolicy } from './policies.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const games = Number(args.games || 10), players = Number(args.players || 6), policy = args.policy || 'hard';
let rounds = 0, empty = 0, ants = 0, steps = 0, problems = 0;
const pol = makePolicy(policy, { loud: !!args.loud });
for (let g = 0; g < games; g++) {
  const r = playGame(Array.from({ length: players }, () => pol), 5000 + g);
  problems += r.problems.length;
  if (r.problems.length) console.log('seed', 5000 + g, r.problems);
  steps += r.steps;
  for (const rd of r.rounds) { rounds++; if (rd.empty) empty++; if (rd.isAnt) ants++; }
}
const s = pol.stats;
console.log(JSON.stringify({ policy, players, games, rounds, roundsEndedByDeckLimit: empty, ants,
  avgStepsPerRound: Math.round(steps / rounds), problems, refused: s.refused, fallbacks: s.fallbacks,
  avgMs: +(s.ms / s.decisions).toFixed(3), maxMs: +s.maxMs.toFixed(1) }, null, 1));
