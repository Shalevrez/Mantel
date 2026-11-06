// Parameter sweep: each variant of TUNE plays duplicate games against the
// default engine, four processes at a time.
//   node tests/bench/sweep.mjs '[{"dangerW":0.8},{"dangerW":2.5}]' [--pairs 30] [--layout AB]
import { spawn } from 'node:child_process';
const variants = JSON.parse(process.argv[2]);
const pairs = process.argv.includes('--pairs') ? process.argv[process.argv.indexOf('--pairs') + 1] : '30';
const layout = process.argv.includes('--layout') ? process.argv[process.argv.indexOf('--layout') + 1] : 'AB';
const seed = process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : '1';
const run = v => new Promise(res => {
  const p = spawn('node', ['tests/bench/run.mjs', '--a', 'hard', '--b', 'hard', '--pairs', pairs, '--layout', layout, '--seed', seed, '--tuneA', JSON.stringify(v)]);
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.on('close', () => { try { const j = JSON.parse(out); res({ v, A: j.A, B: j.B }); } catch { res({ v, err: out.slice(0, 200) }); } });
});
const queue = [...variants], results = [];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) results.push(await run(queue.shift())); }));
for (const r of results) {
  if (r.err) { console.log(JSON.stringify(r.v), 'ERR', r.err); continue; }
  console.log(JSON.stringify(r.v).padEnd(28), 'winShare', r.A.winShare.toFixed(3), ' avgTotal A', r.A.avgGameTotalPerSeat, 'B', r.B.avgGameTotalPerSeat, ' roundPen diff', (r.A.avgRoundPenalty - r.B.avgRoundPenalty).toFixed(2), ' ants', r.A.ants, r.B.ants);
}
