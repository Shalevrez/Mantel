// Dev-only harness: renders <Game> against a real, server-shaped state so the
// layout can be inspected at any viewport without a Worker or a second player.
import { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/rubik";
import { initGame, startHand, mkCard, G, MK } from "../game-core.js";
import { viewFor } from "../worker/index.js";
import { Game, RoundEnd, GameEnd, ScoreModal, CardView } from "./ui.jsx";
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
// ?cur=N puts seat N on turn instead, to see the hand while waiting.
st = {
  ...st,
  phase: 'action',
  cur: Number(params.get('cur') || 0) % seats,
  buy: null,
  canLay: true,
  board: [
    { id: 'g1', type: 'seq', owner: 0, cards: [mkCard('h', 5), mkCard('h', 6), mkCard('h', 7)] },
    { id: 'g2', type: 'set', owner: 1, cards: [mkCard('c', 8), mkCard('d', 8), mkCard('s', 8)] },
    { id: 'g3', type: 'seq', owner: 2, cards: [mkCard('s', 9), mkCard('s', 10), mkCard('s', 11), mkCard('s', 12)] },
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
  // ?w=0 — I won (the confetti case).
  result: { w: params.has('w') ? Number(params.get('w')) % n : 1 % n, isAnt: params.get('ant') !== '0', empty: false },
  players: view.players.map((p, i) => ({
    ...p, totalScore: running[i], lastScore: history[history.length - 1].scores[i],
  })),
};

// ?screen=live — a tiny local stand-in for the server, so the animations can be
// watched: draw (Space or the deck), select a card and throw it (X or drag),
// and the computer seats draw and throw in turn. window.__deal() deals a new
// hand, as at the start of a round.
const SUITS4 = ['h', 'd', 'c', 's'];
const randCard = () => mkCard(SUITS4[Math.floor(Math.random() * 4)], 1 + Math.floor(Math.random() * 13));
function Live() {
  const [v, setV] = useState({ ...withHistory, phase: 'action', cur: 0, sel: [] });
  const timers = useRef([]);
  const later = (ms, f) => timers.current.push(setTimeout(f, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const setMe = (st, f) => ({ ...st, players: st.players.map((p, i) => i === 0 ? f(p) : p) });
  const opponents = (seat) => {
    later(700, () => setV(st => ({ ...st, deckCount: st.deckCount - 1,
      players: st.players.map((p, i) => i === seat ? { ...p, handCount: p.handCount + 1 } : p) })));
    later(1500, () => setV(st => {
      const next = (seat + 1) % st.players.length;
      return { ...st, discard: [...st.discard, randCard()], cur: next, phase: next === 0 ? 'draw' : 'draw',
        players: st.players.map((p, i) => i === seat ? { ...p, handCount: p.handCount - 1 } : p) };
    }));
    if ((seat + 1) % v.players.length !== 0) later(1600, () => opponents((seat + 1) % v.players.length));
  };
  window.__deal = () => setV(st => setMe({ ...st, sel: [], phase: 'draw', cur: 0 },
    p => ({ ...p, hand: Array.from({ length: 14 }, randCard) })));
  const dispatch = (a) => {
    console.log('dispatch', a);
    if (a.type === 'SEL') setV(st => ({ ...st, sel: st.sel.includes(a.id) ? st.sel.filter(x => x !== a.id) : [...st.sel, a.id] }));
    if (a.type === 'DRAW') setV(st => setMe({ ...st, phase: 'action', deckCount: st.deckCount - 1 }, p => ({ ...p, hand: [...p.hand, randCard()] })));
    if (a.type === 'DISCARD') {
      setV(st => {
        const card = st.players[0].hand.find(c => c.id === a.cid);
        return setMe({ ...st, discard: [...st.discard, card], sel: [], cur: 1, phase: 'draw' },
          p => ({ ...p, hand: p.hand.filter(c => c.id !== a.cid) }));
      });
      opponents(1);
    }
  };
  return <Game state={v} dispatch={dispatch} onLeave={() => {}} />;
}

// ?screen=decks — the whole deck on one sheet: each suit from ace to king, the
// joker, at the desktop hand size and, on the rail below, at phone and board
// sizes (where the court cards drop their illustration).
const SUIT_ROWS = ['s', 'h', 'd', 'c'];
function Decks() {
  const row = (suit) => Array.from({ length: 13 }, (_, i) => ({ id: `d${suit}${i + 1}`, suit, v: i + 1 }));
  const joker = { id: 'djk', suit: 'j', v: 0, j: true };
  return (
    <div className="felt" style={{ minHeight: '100vh', minWidth: '100%', width: 'max-content', padding: '24px 28px',
                                   direction: 'ltr', color: '#fdf8f0', fontFamily: '"Rubik Variable", system-ui, sans-serif' }}>
      <h1 style={{ margin: '0 0 16px', color: '#f3d48c', fontSize: 26, direction: 'rtl' }}>החפיסה</h1>
      {SUIT_ROWS.map(suit => (
        <div key={suit} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 6, ['--card-w']: '98px', ['--card-h']: '138px' }}>
            {row(suit).map(c => <CardView key={c.id} card={c} />)}
            {suit === 's' && <CardView card={joker} />}
          </div>
          <div className="wood" style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '8px 12px', marginTop: 6, borderRadius: 10 }}>
            <div style={{ display: 'flex', ['--card-w']: '47px', ['--card-h']: '66px' }}>
              {row(suit).map(c => <CardView key={c.id} card={c} />)}
              {suit === 's' && <CardView card={joker} />}
            </div>
            <div style={{ display: 'flex', ['--card-w']: '34px', ['--card-h']: '48px' }}>
              {row(suit).map(c => <CardView key={c.id} card={c} sm={false} />)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  screen === 'decks' ? <Decks />
  : screen === 'live' ? <Live />
  : screen === 'buying' ? <Game state={buying} dispatch={(a) => console.log('dispatch', a)} />
  // ?screen=buypaid / buybroke — a buy with a penalty card in a 500-coin room,
  // with enough coins for it, and without.
  : screen === 'buypaid' || screen === 'buybroke' ? (
      <Game state={viewFor({ ...st, phase: 'buying', cur: 1, buy: { checker: 0, origNext: 2 % n, prev: 1, free: false } }, 0)}
            wallet={{ coins: screen === 'buybroke' ? 5 : 1500, buyPrice: 10 }}
            dispatch={(a) => console.log('dispatch', a)} onLeave={() => {}} />
    )
  : screen === 'round' ? <RoundEnd state={ended} dispatch={() => {}} onLeave={() => {}} />
  : screen === 'end' ? <GameEnd state={ended} onRestart={() => {}} onExit={() => {}} />
  // ?screen=paid — the game-over screen of a paid online room, with the rewards strip.
  : screen === 'paid' ? (() => {
      const paid = { ...ended, room: { mode: 'online', fee: 500, gameId: 'harness' } };
      const res = settle(paid);
      return <GameEnd state={paid} onRestart={() => {}} onExit={() => {}} extra={<RewardStrip r={res.seats[0]} fee={res.fee} />} />;
    })()
  : screen === 'score' ? <ScoreModal state={ended} onClose={() => {}} />
  : <Game state={{ ...withHistory, msg: params.get('msg') || '' }} dispatch={(a) => console.log('dispatch', a)} onLeave={() => {}} />
);
