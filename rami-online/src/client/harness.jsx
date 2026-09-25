// Dev-only harness: renders <Game> against a real, server-shaped state so the
// layout can be inspected at any viewport without a Worker or a second player.
import { createRoot } from "react-dom/client";
import { initGame, startHand, mkCard, G, MK } from "../game-core.js";
import { viewFor } from "../worker/index.js";
import { Game, RoundEnd, GameEnd, ScoreModal } from "./ui.jsx";
import { RewardStrip } from "./account.jsx";
import { settle } from "../economy.js";

const params = new URLSearchParams(location.search);
const seats = Number(params.get('seats') || 4);

let st = startHand(initGame(
  Array.from({ length: seats }, (_, i) => ({
    name: i === 0 ? 'שלו' : `מחשב ${i}`, isAI: i !== 0, ai: 'medium',
  }))
));

// Put it in the state the player actually spends the turn in: my action phase,
// a few groups already on the board, a couple of cards selected.
st = {
  ...st,
  phase: 'action',
  cur: 0,
  buy: null,
  canLay: true,
  board: [
    { id: 'g1', type: 'seq', cards: [mkCard('h', 5), mkCard('h', 6), mkCard('h', 7)] },
    { id: 'g2', type: 'set', cards: [mkCard('c', 8), mkCard('d', 8), mkCard('s', 8)] },
    { id: 'g3', type: 'seq', cards: [mkCard('s', 9), mkCard('s', 10), mkCard('s', 11), mkCard('s', 12)] },
  ],
  players: st.players.map((p, i) => i === 0 ? { ...p, hasLaid: true } : p),
};
// A group someone just attached to, so the attach mark is on screen.
st.board[1] = { ...st.board[1], att: { by: 1, ids: [st.board[1].cards[2].id] } };
st = { ...st, sel: [st.players[0].hand[0].id, st.players[0].hand[1].id] };

const view = viewFor(st, 0);

const screen = params.get('screen') || 'game';

// The buying phase puts a decision panel on screen; it has its own grid area.
const buying = viewFor({
  ...st, phase: 'buying', cur: 1,
  buy: { checker: 0, origNext: 0, prev: -1 },
}, 0);
// A few rounds already in the books, so the leaderboard has columns to draw.
// Totals are accumulated from the per-round scores, exactly as the server does
// it — a table built on numbers that don't add up teaches nothing.
const n = view.players.length;
const running = Array(n).fill(0);
const history = [
  { mk: 0, w: 0, isAnt: false },
  { mk: 0, w: 2 % n, isAnt: false },
  { mk: 1, w: 1 % n, isAnt: true },
  { mk: 2, w: null, isAnt: false, empty: true },
].map((r, idx) => {
  const scores = Array.from({ length: n }, (_, i) =>
    i === r.w ? (r.isAnt ? -50 : 0) : 6 + ((i * 9 + idx * 7) % 28));
  scores.forEach((v, i) => { running[i] += v; });
  return {
    n: idx + 1, mk: r.mk, mkName: MK[r.mk].name, sivuv: 1,
    w: r.w, isAnt: !!r.isAnt, empty: !!r.empty,
    scores, totals: [...running],
  };
});

const withHistory = { ...view, history };

const ended = {
  ...withHistory,
  result: { w: 1 % n, isAnt: true, empty: false },
  players: view.players.map((p, i) => ({
    ...p, totalScore: running[i], lastScore: history[history.length - 1].scores[i],
  })),
};

createRoot(document.getElementById('root')).render(
  screen === 'buying' ? <Game state={buying} dispatch={(a) => console.log('dispatch', a)} />
  // ?screen=buypaid / buybroke — a buy with a penalty card in a 500-coin room,
  // with enough coins for it, and without.
  : screen === 'buypaid' || screen === 'buybroke' ? (
      <Game state={viewFor({ ...st, phase: 'buying', cur: 1, buy: { checker: 0, origNext: 2 % n, prev: 1, free: false } }, 0)}
            wallet={{ coins: screen === 'buybroke' ? 5 : 1500, buyPrice: 10 }}
            dispatch={(a) => console.log('dispatch', a)} onLeave={() => {}} />
    )
  : screen === 'round' ? <RoundEnd state={ended} dispatch={() => {}} onLeave={() => {}} />
  : screen === 'end' ? <GameEnd state={ended} onRestart={() => {}} />
  // ?screen=paid — the game-over screen of a paid online room, with the rewards strip.
  : screen === 'paid' ? (() => {
      const paid = { ...ended, room: { mode: 'online', fee: 500, gameId: 'harness' } };
      const res = settle(paid);
      return <GameEnd state={paid} onRestart={() => {}} extra={<RewardStrip r={res.seats[0]} fee={res.fee} />} />;
    })()
  : screen === 'score' ? <ScoreModal state={ended} onClose={() => {}} />
  : <Game state={{ ...withHistory, msg: params.get('msg') || '' }} dispatch={(a) => console.log('dispatch', a)} onLeave={() => {}} />
);
