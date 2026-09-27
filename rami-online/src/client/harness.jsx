// Dev-only harness: renders <Game> against a real, server-shaped state so the
// layout can be inspected at any viewport without a Worker or a second player.
import { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/rubik";
import { initGame, startHand, mkCard, G, MK } from "../game-core.js";
import { viewFor } from "../worker/index.js";
import { Game, RoundEnd, GameEnd, ScoreModal, CardView } from "./ui.jsx";
import "./decks.css";
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

// ?screen=decks — the design gallery: the same cards in each candidate deck
// (decks.css), side by side, at the desktop hand size and, below, at phone and
// board sizes on the wooden rail. For choosing a card front; the game itself
// still uses "classic".
const DECKS = [
  { id: 'classic', name: '1 · קלאסי (היום)' },
  { id: 'modern',  name: '2 · מודרני נקי' },
  { id: 'deco',    name: '3 · אר-דקו זהב' },
  { id: 'vintage', name: '4 · וינטג׳ מודפס' },
  { id: 'casino',  name: '5 · קזינו' },
  { id: 'jumbo',   name: '6 · ג׳מבו, ארבעה צבעים' },
];
const G_CARDS = [
  { group: 'מספרים', cards: [{ id: 'g2', suit: 'h', v: 2 }, { id: 'g7', suit: 'c', v: 7 }, { id: 'g10', suit: 'd', v: 10 }] },
  { group: 'אס', cards: [{ id: 'gas', suit: 's', v: 1 }, { id: 'gah', suit: 'h', v: 1 }] },
  { group: 'נסיך · מלכה · מלך', cards: [{ id: 'gj', suit: 'd', v: 11 }, { id: 'gq', suit: 's', v: 12 }, { id: 'gk', suit: 'h', v: 13 }] },
  { group: 'ג׳וקר', cards: [{ id: 'gjk', suit: 'j', v: 0, j: true }] },
];
// ?set=jumbo — the jumbo deck's figure variants (medal / half / mirror).
const JUMBO_ROWS = [
  { id: 'jumbo', v: 'medal',  name: 'A · מדליון' },
  { id: 'jumbo', v: 'half',   name: 'B · חצי גוף' },
  { id: 'jumbo', v: 'mirror', name: 'C · קלאסי משוקף' },
];
const JUMBO_CARDS = [
  { group: 'מספרים', cards: [{ id: 'n2', suit: 'h', v: 2 }, { id: 'n7', suit: 'c', v: 7 }, { id: 'n10', suit: 'd', v: 10 }] },
  { group: 'מלך', cards: [{ id: 'kh', suit: 'h', v: 13 }, { id: 'ks', suit: 's', v: 13 }] },
  { group: 'מלכה', cards: [{ id: 'qd', suit: 'd', v: 12 }, { id: 'qc', suit: 'c', v: 12 }] },
  { group: 'נסיך', cards: [{ id: 'jh', suit: 'h', v: 11 }, { id: 'js', suit: 's', v: 11 }] },
  { group: 'אס', cards: [{ id: 'as', suit: 's', v: 1 }, { id: 'ah', suit: 'h', v: 1 }] },
  { group: 'ג׳וקר', cards: [{ id: 'jk', suit: 'j', v: 0, j: true }] },
];

// ?deck=modern — one deck only; ?cat=2 — one category; ?mini=0 — no small sizes.
function Decks() {
  const jumbo = params.get('set') === 'jumbo';
  const only = params.get('deck');
  const base = jumbo ? JUMBO_ROWS : DECKS;
  const decks = only ? base.filter(d => (d.v || d.id) === only) : base;
  const cats = jumbo ? JUMBO_CARDS : G_CARDS;
  const groups = params.has('cat') ? [cats[Number(params.get('cat'))]] : cats;
  const allCards = groups.flatMap(g => g.cards);
  const mini = params.get('mini') !== '0';
  return (
    <div className="felt" style={{ minHeight: '100vh', minWidth: '100%', width: 'max-content', padding: '24px 28px', direction: 'rtl', color: '#fdf8f0',
                                   fontFamily: '"Rubik Variable", system-ui, sans-serif' }}>
      <h1 style={{ margin: '0 0 4px', color: '#f3d48c', fontSize: 28 }}>עיצובים לחזית הקלפים</h1>
      <div style={{ color: '#c7d2e3', marginBottom: 18, fontSize: 14 }}>כל שורה היא עיצוב, ובכל עמודה אותו קלף. מתחת לכל שורה: אותם קלפים בגודל טלפון ובגודל הלוח.</div>
      <div style={{ display: 'grid', gridTemplateColumns: `170px repeat(${allCards.length}, 104px)`, gap: '0 6px', alignItems: 'end',
                    ['--card-w']: '98px', ['--card-h']: '138px' }}>
        <div />
        {groups.map(g => (
          <div key={g.group} style={{ gridColumn: `span ${g.cards.length}`, textAlign: 'center', color: '#f3d48c', fontWeight: 700,
                                      borderBottom: '1px solid rgba(214,170,84,.5)', paddingBottom: 6, marginBottom: 10 }}>{g.group}</div>
        ))}
        {decks.map(d => (
          <div key={d.v || d.id} data-deck={d.id === 'classic' ? undefined : d.id} data-v={d.v} style={{ display: 'contents' }}>
            <div style={{ alignSelf: 'center', fontWeight: 800, fontSize: 17, color: '#fdf8f0' }}>{d.name}</div>
            {allCards.map(c => <div key={c.id} style={{ padding: '10px 0 4px' }}><CardView card={c} /></div>)}
            {mini && <div />}
            {mini && <div className="wood" data-deck={d.id === 'classic' ? undefined : d.id} data-v={d.v}
                 style={{ gridColumn: `span ${allCards.length}`, display: 'flex', alignItems: 'center', gap: 14,
                          padding: '8px 12px', margin: '2px 0 18px', borderRadius: 10 }}>
              <span style={{ fontSize: 12, color: '#e9d8b4', width: 56 }}>טלפון</span>
              <div style={{ display: 'flex', ['--card-w']: '47px', ['--card-h']: '66px' }}>
                {allCards.map(c => <CardView key={c.id} card={c} />)}
              </div>
              <span style={{ fontSize: 12, color: '#e9d8b4', width: 40, marginInlineStart: 12 }}>לוח</span>
              <div style={{ display: 'flex', ['--card-w']: '34px', ['--card-h']: '48px' }}>
                {allCards.map(c => <CardView key={c.id} card={c} />)}
              </div>
            </div>}
          </div>
        ))}
      </div>
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
