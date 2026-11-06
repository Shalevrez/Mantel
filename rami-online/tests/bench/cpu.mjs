// ═══════════════════════════════════════════════════════
// CPU COST — local only. Measures CPU time (process.cpuUsage: user+system,
// not wall clock) the way a room spends it:
//
//   per decision  one aiBuy / aiDraw / aiAction call on a Room
//   per step      that call plus what the room does after every AI move:
//                 serialize the state for storage (structuredClone stands in
//                 for the storage write's serialization) and the per-seat
//                 redacted view sent to the connected human (viewFor + JSON)
//   per chain     every AI step between two moves of the one human at the
//                 table — the work that follows a single incoming WebSocket
//                 message (the unit Cloudflare's per-message CPU allowance
//                 resets on)
//
// Table: one human seat (played by the medium routine, applied straight to
// the state, as the client's messages would be) and n−1 computer seats.
//
//   node tests/bench/cpu.mjs [--level hard|medium|legacy] [--players 6] [--games 4] [--seed 40000]
// ═══════════════════════════════════════════════════════
import { initGame, G } from '../../src/game-core.js';
import { Room, viewFor } from '../../src/worker/index.js';
import { fakeStorage } from '../fake-storage.mjs';
import { mulberry32 } from './harness.mjs';
import { oldBuy, oldDraw, oldAction } from './policies.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const level = args.level || 'hard', players = Number(args.players || 6), games = Number(args.games || 4);
const seed0 = Number(args.seed || 40000);
const budget = args.budget ? Number(args.budget) : undefined;

const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };   // ms
const steps = [], chains = [], decisions = { buy: [], draw: [], turn: [] };
let maxHand = 0;

const realRandom = Math.random;
for (let g = 0; g < games; g++) {
  Math.random = mulberry32(seed0 + g);
  const room = new Room({ storage: fakeStorage() }, budget ? { AI_BUDGET: String(budget) } : {});
  room.seats = Array.from({ length: players }, (_, i) => ({
    name: 's' + i, isAI: i !== 0, ai: level === 'legacy' ? 'hard' : level, connected: i === 0, ws: null,
  }));
  // The "legacy" level is the old hard code: route the room's hard seats to it.
  if (level === 'legacy') {
    room.aiBuy = function () { const st = this.state; const s = st.buy.checker; this.state = oldBuy(st, s, 'hard'); };
    room.aiDraw = function () { this.state = oldDraw(this.state, this.state.cur, 'hard'); };
    room.aiAction = function () { this.state = oldAction(this.state, this.state.cur, 'hard'); };
  }
  room.started = true;
  room.state = initGame(room.seats.map(s => ({ name: s.name, isAI: s.isAI, ai: s.ai })), undefined, { format: 'mega' });
  let chain = 0;
  let guard = 0;
  while (room.state.phase !== 'game_end' && guard++ < 100000) {
    const st = room.state;
    if (st.phase === 'round_end') { room.state = G(st, { type: 'NEXT_MK' }); continue; }
    const humanToAct = st.phase === 'buying' ? st.buy.checker === 0 : st.cur === 0;
    if (humanToAct) {
      if (chain) { chains.push(chain); chain = 0; }
      // The human's own move (not measured): the medium routine.
      if (st.phase === 'buying') room.state = oldBuy(st, 0, 'medium');
      else if (st.phase === 'draw') room.state = oldDraw(st, 0, 'medium');
      else room.state = oldAction(st, 0, 'medium');
      continue;
    }
    const kind = st.phase === 'buying' ? 'buy' : st.phase === 'draw' ? 'draw' : 'turn';
    const seat = kind === 'buy' ? st.buy.checker : st.cur;
    maxHand = Math.max(maxHand, st.players[seat].hand.length);
    const t0 = cpu();
    if (kind === 'buy') room.aiBuy(); else if (kind === 'draw') room.aiDraw(); else room.aiAction();
    const t1 = cpu();
    // What the room does after each AI move: storage serialization and the
    // update sent to the connected human.
    structuredClone(room.state);
    JSON.stringify({ t: 'state', state: viewFor(room.state, 0) });
    const t2 = cpu();
    decisions[kind].push(t1 - t0);
    steps.push(t2 - t0);
    chain += t2 - t0;
    if (room.state === st) { console.error('AI made no progress', kind); break; }
  }
  if (chain) chains.push(chain);
}
Math.random = realRandom;

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2) : 0; };
const summ = a => ({ n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(2), p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: pct(a, 1) });
console.log(JSON.stringify({
  level, players, games, seed0, budget: budget || 'default', maxHandSeen: maxHand,
  decisionCpuMs: Object.fromEntries(Object.entries(decisions).map(([k, v]) => [k, summ(v)])),
  stepCpuMs: summ(steps),
  chainCpuMs: summ(chains),
  chainsOver10ms: chains.filter(x => x > 10).length,
  chainsOver30ms: chains.filter(x => x > 30).length,
}, null, 1));
