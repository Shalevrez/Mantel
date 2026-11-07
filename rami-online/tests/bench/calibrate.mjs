// Measures, from self-play, how often a player goes out on a turn given the
// hand size they started it with and whether they had opened — the threat
// model the hard engine uses (HAZ_LAID / HAZ_CLOSED in src/ai/hard.js).
//   node tests/bench/calibrate.mjs [--games 40] [--players 4] [--policy hard]
import { initGame, G } from '../../src/game-core.js';
import { mulberry32 } from './harness.mjs';
import { makePolicy } from './policies.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const games = Number(args.games || 40), players = Number(args.players || 4);
const policy = args.policy || 'hard';
const tab = { laid: {}, closed: {} };
const realRandom = Math.random;
for (let g = 0; g < games; g++) {
  Math.random = mulberry32(1000 + g);
  const seats = Array.from({ length: players }, () => makePolicy(policy));
  let st = initGame(seats.map((_, i) => ({ name: 's' + i, isAI: true })), undefined, { format: 'mega' });
  let turnStart = null;
  while (st.phase !== 'game_end') {
    if (st.phase === 'round_end') { st = G(st, { type: 'NEXT_MK' }); turnStart = null; continue; }
    if ((st.phase === 'buying' || st.phase === 'draw') && st.canLay && (!turnStart || turnStart.cur !== st.cur)) {
      const p = st.players[st.cur];
      turnStart = { cur: st.cur, n: p.hand.length, laid: p.hasLaid };
    }
    if (st.phase === 'buying') st = seats[st.buy.checker].buy(st, st.buy.checker);
    else if (st.phase === 'draw') st = seats[st.cur].draw(st, st.cur);
    else {
      const seat = st.cur;
      st = seats[seat].turn(st, seat);
      if (turnStart && turnStart.cur === seat) {
        const t = tab[turnStart.laid ? 'laid' : 'closed'];
        const k = Math.min(turnStart.n, 12);
        const e = t[k] ||= { turns: 0, outs: 0 };
        e.turns++;
        if (st.phase === 'round_end' && st.result.w === seat) e.outs++;
        turnStart = null;
      }
    }
  }
}
Math.random = realRandom;
for (const kind of ['laid', 'closed']) {
  console.log(kind);
  for (const [n, e] of Object.entries(tab[kind])) console.log(`  n=${n}\tturns=${e.turns}\tP(out)=${(e.outs / e.turns).toFixed(3)}`);
}
