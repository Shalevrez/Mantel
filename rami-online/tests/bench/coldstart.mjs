// Cold vs warm CPU for one decision (local only). Run in a fresh process: the
// first decision pays for the JIT warming up, as in a newly started isolate.
//   node tests/bench/coldstart.mjs [--seed 5]
import { initGame } from '../../src/game-core.js';
import { decideBuy, planTurn } from '../../src/ai/hard.js';
import { mulberry32 } from './harness.mjs';
const seed = Number(process.argv[process.argv.indexOf('--seed') + 1] || 5);
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
Math.random = mulberry32(seed);
const st0 = initGame([0, 1, 2, 3].map(i => ({ name: 's' + i, isAI: true })), 0);
const take = { ...st0, canLay: true, turnsPlayed: 8, phase: 'buying', buy: { id: 1, origNext: 0, prev: 3, checker: 0, picks: {} } };
const act = { ...st0, canLay: true, turnsPlayed: 8, phase: 'action', cur: 0 };
const out = [];
for (let i = 0; i < 6; i++) {
  let t = cpu(); decideBuy(take, 0); const a = cpu() - t;
  t = cpu(); planTurn(act, 0); const b = cpu() - t;
  out.push([+a.toFixed(2), +b.toFixed(2)]);
}
console.log(JSON.stringify({ seed, takeThenTurnMs: out }));
