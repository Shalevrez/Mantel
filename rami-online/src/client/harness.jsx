// Dev-only harness: renders <Game> against a real, server-shaped state so the
// layout can be inspected at any viewport without a Worker or a second player.
import { createRoot } from "react-dom/client";
import { initGame, startHand, mkCard, G } from "../game-core.js";
import { viewFor } from "../worker/index.js";
import { Game, RoundEnd, GameEnd } from "./ui.jsx";

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
st = { ...st, sel: [st.players[0].hand[0].id, st.players[0].hand[1].id] };

const view = viewFor(st, 0);

const screen = params.get('screen') || 'game';
const ended = {
  ...view,
  result: { w: 1, isAnt: true, empty: false },
  players: view.players.map((p, i) => ({ ...p, totalScore: i * 37, lastScore: i * 12 })),
};

createRoot(document.getElementById('root')).render(
  screen === 'round' ? <RoundEnd state={ended} dispatch={() => {}} />
  : screen === 'end' ? <GameEnd state={ended} onRestart={() => {}} />
  : <Game state={view} dispatch={(a) => console.log('dispatch', a)} />
);
