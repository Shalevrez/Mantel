// Extreme hands through the room's real code paths (local only): 18–34 cards
// (what repeated buying produces), up to 6 jokers, boards of up to 14 groups,
// every phase. Checks the move is legal and the turn ends; reports CPU.
//   node tests/bench/bighands.mjs [--cases 300] [--seed 123]
import { initGame, makeDeck, isGroup, G } from '../../src/game-core.js';
import { Room } from '../../src/worker/index.js';
import { fakeStorage } from '../fake-storage.mjs';
import { mulberry32 } from './harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const cases = Number(args.cases || 300), seed = Number(args.seed || 123);
const rnd = mulberry32(seed);
const realRandom = Math.random; Math.random = rnd;
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const times = { buy: [], draw: [], turn: [] };
let bad = 0, total = 0, budgetHits = 0;
for (let k = 0; k < cases; k++) {
  const n = 2 + (k % 5);
  const deck = shuffle(makeDeck(n >= 5 ? 3 : 2));
  const size = 18 + Math.floor(rnd() * 17);
  const jokers = deck.filter(c => c.j).slice(0, Math.floor(rnd() * 7));
  const hand = [...jokers, ...deck.filter(c => !c.j).slice(0, size - jokers.length)];
  const rest = deck.filter(c => !hand.includes(c));
  // A board: runs of 3–5 cut from what is left.
  const board = [];
  for (const c of rest) {
    if (board.length >= 2 + (k % 13)) break;
    if (c.j || c.v > 9) continue;
    const run = [c, ...[1, 2].map(d => rest.find(x => !x.j && x.suit === c.suit && x.v === c.v + d))];
    if (run.every(Boolean) && run.every(x => !board.some(g => g.cards.includes(x)))) board.push({ id: 'b' + board.length, type: 'seq', owner: 1, cards: run });
  }
  const used = new Set(board.flatMap(g => g.cards).concat(hand));
  const pile = rest.filter(c => !used.has(c));
  const st0 = initGame(Array.from({ length: n }, (_, i) => ({ name: 's' + i, isAI: true, ai: 'hard' })), 0, { format: 'single', mk: k % 6 });
  const laid = k % 3 === 0;
  // Opponents get what the deck can spare (a real table never runs dry: the
  // pile is reshuffled), keeping at least a pile, a beit and a discard.
  const per = Math.max(1, Math.min(14, Math.floor((pile.length - 8) / (n - 1))));
  const others = Array.from({ length: n - 1 }, () => pile.splice(0, per));
  const st = {
    ...st0, mk: k % 6, canLay: true, turnsPlayed: 20, board, beit: pile.shift(), discard: [pile.shift(), pile.shift()], deck: pile,
    players: st0.players.map((p, i) => ({ ...p, hand: i === 0 ? hand : others[i - 1], hasLaid: i === 0 ? laid : k % 2 === 0 })),
    track: [], undoBefore: null, mustUseJoker: null, tookBeit: false, attachedThisTurn: false, laidAtTurnStart: laid,
  };
  const kind = ['buy', 'buyPaid', 'draw', 'turn'][k % 4];
  const room = new Room({ storage: fakeStorage() }, {});
  room.seats = st.players.map(() => ({ isAI: true, ai: 'hard' }));
  let s = st;
  if (kind === 'buy') s = { ...st, phase: 'buying', cur: 0, buy: { id: 1, origNext: 0, prev: n - 1, checker: 0, picks: {} } };
  else if (kind === 'buyPaid') s = { ...st, phase: 'buying', cur: 1, buy: { id: 1, origNext: 1, prev: n - 1, checker: 0, picks: { 1: false } } };
  else if (kind === 'draw') s = { ...st, phase: 'draw', cur: 0 };
  else s = { ...st, phase: 'action', cur: 0 };
  room.state = s;
  const cards0 = JSON.stringify([...s.players.flatMap(p => p.hand), ...s.board.flatMap(g => g.cards), ...s.discard, ...s.deck, s.beit].filter(Boolean).map(c => c.id).sort());
  const t0 = cpu();
  if (kind.startsWith('buy')) room.aiBuy(); else if (kind === 'draw') room.aiDraw(); else room.aiAction();
  const dt = cpu() - t0;
  times[kind.startsWith('buy') ? 'buy' : kind].push(dt);
  if (args.slow && dt > Number(args.slow)) console.error('slow', { k, kind, dt: +dt.toFixed(1), hand: hand.length, jokers: jokers.length, board: board.length, diag: room.aiDiag });
  total++;
  const r = room.state;
  const cards1 = JSON.stringify([...r.players.flatMap(p => p.hand), ...r.board.flatMap(g => g.cards), ...r.discard, ...r.deck, r.beit].filter(Boolean).map(c => c.id).sort());
  const moved = r !== s && (kind !== 'turn' || r.phase !== 'action' || r.cur !== 0);
  const legalBoard = r.board.every(g => isGroup(g.cards));
  if (!moved || !legalBoard || cards0 !== cards1 || (room.aiDiag && (room.aiDiag.errors || room.aiDiag.refused))) {
    bad++; console.error('BAD case', k, kind, { moved, legalBoard, cards: cards0 === cards1, diag: room.aiDiag });
  }
  if (room.aiDiag) budgetHits += room.aiDiag.budget;
}
Math.random = realRandom;
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(q * s.length))] || 0).toFixed(2); };
console.log(JSON.stringify({ cases: total, bad, budgetExhausted: budgetHits,
  cpuMs: Object.fromEntries(Object.entries(times).map(([k, a]) => [k, { n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: pct(a, 1) }])) }, null, 1));
process.exit(bad ? 1 : 0);
