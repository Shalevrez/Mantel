// ═══════════════════════════════════════════════════════
// GAME CORE — pure logic shared by server (authoritative)
// and client. No React, no DOM. Runs identically in the
// Cloudflare Worker and in the browser.
// ═══════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const SUITS = ['h', 'd', 'c', 's'];
const SYM   = { h:'♥', d:'♦', c:'♣', s:'♠', j:'★' };
const COL   = { h:'#b91c1c', d:'#b91c1c', c:'#1e1b4b', s:'#1e1b4b', j:'#7c3aed' };
const VD    = v => ({ 1:'A', 11:'J', 12:'Q', 13:'K' }[v] ?? String(v));
const cSc   = c => c.j ? 10 : (c.v === 1 || c.v >= 11 ? 10 : c.v);
const cTxt  = c => c.j ? 'JK' : VD(c.v) + SYM[c.suit];

const MK = [
  { name:'שלישייה',      seqs:1, min:3 },
  { name:'שתי שלישיות',  seqs:2, min:3 },
  { name:'רביעייה',      seqs:1, min:4 },
  { name:'שתי רביעיות',  seqs:2, min:4 },
  { name:'חמישייה',      seqs:1, min:5 },
  { name:'שתי חמישיות',  seqs:2, min:5 },
];

const FELT  = '#1a5230';
const FELTD = '#0d2e1a';
const GOLD  = '#c9973a';
const CREAM = '#fdf8f0';

let _uid = 1;
const uid = () => `${Date.now()}-${(_uid++).toString(36)}`;

// Sort order: hearts, diamonds, clubs, spades, jokers — then by value
const SUIT_ORD = { h: 0, d: 1, c: 2, s: 3, j: 4 };
const sortHand = hand =>
  [...hand].sort((a, b) => {
    const so = SUIT_ORD[a.suit] - SUIT_ORD[b.suit];
    return so !== 0 ? so : a.v - b.v;
  });

// ═══════════════════════════════════════════════════════
// CARD UTILS
// ═══════════════════════════════════════════════════════

const mkCard = (suit, v) => ({ id: uid(), suit, v: suit === 'j' ? 0 : v, j: suit === 'j' });

function makeDeck() {
  const d = [];
  for (let i = 0; i < 2; i++) {
    for (const s of SUITS) for (let v = 1; v <= 13; v++) d.push(mkCard(s, v));
    d.push(mkCard('j', 0));
    d.push(mkCard('j', 0));
  }
  return d;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ═══════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════

// Order-independent: sorts real cards internally, uses joker count for gap-filling
function isSeq(cards) {
  if (!cards || cards.length < 3) return false;
  const real = [...cards.filter(c => !c.j)].sort((a, b) => a.v - b.v);
  const jokers = cards.filter(c => c.j).length;
  if (!real.length) return false;
  const suit = real[0].suit;
  if (real.some(c => c.suit !== suit)) return false;
  const vs = real.map(c => c.v);
  if (new Set(vs).size !== vs.length) return false; // duplicate values

  // Check if vals can form a consecutive run with `jokers` wild cards
  const ok = (vals, maxV) => {
    if (vals[0] < 1 || vals[vals.length - 1] > maxV) return false;
    let gaps = 0;
    for (let i = 1; i < vals.length; i++) gaps += vals[i] - vals[i - 1] - 1;
    if (gaps > jokers) return false; // not enough jokers to fill internal gaps
    const ext = jokers - gaps; // leftover jokers extend at the ends
    const maxExt = (vals[0] - 1) + (maxV - vals[vals.length - 1]);
    return ext <= maxExt;
  };

  if (ok(vs, 13)) return true;
  // Try Ace as 14
  if (vs.includes(1)) {
    const v14 = vs.map(v => v === 1 ? 14 : v).sort((a, b) => a - b);
    if (ok(v14, 14)) return true;
  }
  return false;
}

function isSet(cards) {
  if (!cards || cards.length < 3) return false;
  const real = cards.filter(c => !c.j);
  const jokers = cards.filter(c => c.j).length;
  if (!real.length) return false;
  if (real.some(c => c.v !== real[0].v)) return false;
  const suits = real.map(c => c.suit);
  // real + jokers ≤ 4 (one per suit max)
  return new Set(suits).size === suits.length && (real.length + jokers) <= 4;
}

const isGroup = cs => isSeq(cs) || isSet(cs);

// Orders a valid sequence's cards by value, placing jokers in their gap positions
function orderSeq(cards) {
  const jokers = cards.filter(c => c.j);
  let real = cards.filter(c => !c.j);
  if (real.length < 1) return cards;

  const vals = real.map(c => c.v);
  const aceHigh = vals.includes(1) && vals.some(v => v >= 11);
  const sv = c => (aceHigh && c.v === 1) ? 14 : c.v;
  real = [...real].sort((a, b) => sv(a) - sv(b));

  const seq = [];
  const pool = [...jokers];
  for (let i = 0; i < real.length; i++) {
    seq.push(real[i]);
    if (i < real.length - 1) {
      let gap = sv(real[i + 1]) - sv(real[i]) - 1;
      while (gap-- > 0 && pool.length) seq.push(pool.shift());
    }
  }
  // Leftover jokers extend upward from the top, else at the start
  const maxV = aceHigh ? 14 : 13;
  let canExtendEnd = maxV - sv(real[real.length - 1]);
  while (pool.length && canExtendEnd-- > 0) seq.push(pool.shift());
  while (pool.length) seq.unshift(pool.shift());
  return seq;
}

// Normalizes a group's card order for display (sequences sorted, sets left as-is)
function orderGroup(cards) {
  return isSeq(cards) ? orderSeq(cards) : cards;
}

// For a board sequence, returns what real card each joker stands in for
// e.g. [6♦,7♦,JK,9♦] → [{ suit:'d', v:8, jokerId:... }]
function jokerValues(cards) {
  if (!isSeq(cards)) return [];
  const ordered = orderSeq(cards);
  const real = ordered.filter(c => !c.j);
  if (!real.length) return [];
  const suit = real[0].suit;
  const vals = real.map(c => c.v);
  const aceHigh = vals.includes(1) && vals.some(v => v >= 11);
  const sv = c => (aceHigh && c.v === 1) ? 14 : c.v;
  let startV = null;
  for (let i = 0; i < ordered.length; i++) {
    if (!ordered[i].j) { startV = sv(ordered[i]) - i; break; }
  }
  if (startV === null) return [];
  const out = [];
  ordered.forEach((c, i) => {
    if (c.j) {
      let v = startV + i;
      if (v === 14) v = 1; // ace-high position → ace
      out.push({ suit, v, jokerId: c.id });
    }
  });
  return out;
}

function attachPos(gCards, card) {
  const combined = [...gCards, card];
  if (isSeq(combined)) return 'seq';
  if (isSet(gCards) && isSet(combined)) return 'set';
  return null;
}

function meetsReq(groups, mIdx) {
  const { seqs, min } = MK[mIdx];
  return groups.filter(g => isSeq(g.cards) && g.cards.length >= min).length >= seqs;
}

// ═══════════════════════════════════════════════════════
// GAME INIT
// ═══════════════════════════════════════════════════════

function startHand(base) {
  const deck = shuffle(makeDeck());
  const n = base.players.length;
  const hands = Array.from({ length: n }, () => []);
  for (let i = 0; i < 14; i++)
    for (let p = 0; p < n; p++) hands[p].push(deck.shift());

  const beitIdx = deck.findIndex(c => !c.j);
  const beit = deck[beitIdx];
  deck.splice(beitIdx, 1);
  const firstDiscard = deck.shift();
  const sivuv = (base.sivuv || 0) + 1;

  return {
    ...base, sivuv, deck,
    discard: [firstDiscard], beit, board: [],
    canLay: sivuv > 1,        // sivuv 2+: lay immediately; sivuv 1: opens after first go-around
    turnsPlayed: 0,
    players: base.players.map((p, i) => ({ ...p, hand: p.isAI ? hands[i] : sortHand(hands[i]), hasLaid: false, newIds: [] })),
    phase: 'buying',
    cur: 0,
    buy: { checker: 0, origNext: 0, prev: -1 },
    sel: [], staging: [], msg: '', undoBefore: null, mustUseJoker: null,
    laidAtTurnStart: false, attachedThisTurn: false, tookBeit: false,
    log: [...(base.log || []), `— ${MK[base.mk].name} • סיבוב ${sivuv} —`],
  };
}

function initGame(configs) {
  const players = configs.map((c, i) => ({
    id: i, name: c.name, isAI: c.isAI, ai: c.ai || 'medium',
    hand: [], hasLaid: false, totalScore: 0,
  }));
  return startHand({ players, mk: 0, sivuv: 0, log: ['🃏 המשחק התחיל!'] });
}

// ═══════════════════════════════════════════════════════
// REDUCER HELPERS
// ═══════════════════════════════════════════════════════

function endWin(state, players, board, isAnt) {
  const w = state.cur;
  const up = players.map((p, i) => {
    const hs = p.hand.reduce((s, c) => s + cSc(c), 0);
    const bonus = (i === w && isAnt) ? -50 : 0;
    return { ...p, totalScore: p.totalScore + hs + bonus, lastScore: hs + bonus };
  });
  return {
    ...state, phase: 'round_end', board, players: up, staging: [], sel: [], msg: '',
    result: { w, isAnt, empty: false },
    log: [...state.log, `✓ ${state.players[w].name} ${isAnt ? 'אנט! (−50)' : 'סיים!'}`],
  };
}

function endDeck(state) {
  const up = state.players.map(p => ({
    ...p,
    totalScore: p.totalScore + p.hand.reduce((s, c) => s + cSc(c), 0),
    lastScore: p.hand.reduce((s, c) => s + cSc(c), 0),
  }));
  return {
    ...state, phase: 'round_end', players: up, staging: [], sel: [], msg: '',
    result: { w: null, isAnt: false, empty: true },
    log: [...state.log, '📦 החבילה נגמרה'],
  };
}

function nextCk(buy, n) {
  let nc = (buy.checker + 1) % n;
  if (nc === buy.prev) nc = (nc + 1) % n;
  return nc;
}

// ═══════════════════════════════════════════════════════
// REDUCER
// ═══════════════════════════════════════════════════════

function G(state, action) {
  const { type } = action;

  if (type === '__INIT__') return initGame(action.players);

  // ── Buying phase ──────────────────────────────────
  if (type === 'TAKE_FREE') {
    // Free take is allowed ONLY as the next-player's first offer. Once you pass
    // (skip) or move past it, you can no longer take that discard for free.
    if (state.phase !== 'buying' || !state.buy || state.buy.checker !== state.buy.origNext)
      return { ...state, msg: '🚫 כבר ויתרת על קלף האשפה — שלוף מהחבילה' };
    const top = state.discard[state.discard.length - 1];
    if (!top) return state;
    const p = state.players[state.cur];
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: [...pl.hand, top], newIds: [top.id] } : pl
    );
    return {
      ...state, phase: 'action', buy: null,
      discard: state.discard.slice(0, -1), // remove only the taken (top) card; rest of pile stays
      players, sel: [], staging: [], msg: '',
      laidAtTurnStart: p.hasLaid, attachedThisTurn: false, tookBeit: false,
      undoBefore: { hand: [...p.hand, top], board: state.board, hasLaid: p.hasLaid, beit: state.beit },
      log: [...state.log, `↑ ${state.players[state.cur].name} לקח מהאשפה`],
    };
  }

  if (type === 'BUY') {
    const top = state.discard[state.discard.length - 1];
    const pen = state.deck[0];
    if (!top || !pen) {
      // Can't buy (nothing to take, or deck has no penalty card) — treat as a skip
      const n = state.players.length;
      const nc = nextCk(state.buy, n);
      if (nc === state.buy.origNext) return { ...state, phase: 'draw', buy: null };
      return { ...state, buy: { ...state.buy, checker: nc } };
    }
    const players = state.players.map((p, i) =>
      i === action.idx
        ? { ...p, hand: [...p.hand, top, pen], newIds: [...(p.newIds || []), top.id, pen.id] }
        : p
    );
    return {
      ...state, phase: 'draw', buy: null,
      deck: state.deck.slice(1),
      discard: state.discard.slice(0, -1),
      players,
      log: [...state.log, `💰 ${state.players[action.idx].name} קנה`],
    };
  }

  if (type === 'SKIP') {
    const n = state.players.length;
    const nc = nextCk(state.buy, n);
    if (nc === state.buy.origNext)
      return { ...state, phase: 'draw', buy: null };
    return { ...state, buy: { ...state.buy, checker: nc } };
  }

  // ── Draw ──────────────────────────────────────────
  if (type === 'DRAW') {
    if (!state.deck.length) return endDeck(state);
    const card = state.deck[0];
    const p = state.players[state.cur];
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: [...pl.hand, card], newIds: [card.id] } : pl
    );
    return {
      ...state, phase: 'action',
      deck: state.deck.slice(1),
      // Discard pile is cumulative: the untaken card stays and the pile grows
      players, sel: [], staging: [],
      laidAtTurnStart: p.hasLaid, attachedThisTurn: false, tookBeit: false,
      undoBefore: { hand: [...p.hand, card], board: state.board, hasLaid: p.hasLaid, beit: state.beit },
    };
  }

  // ── Take beit card (for ANT) ───────────────────────
  if (type === 'TAKE_BEIT') {
    const beit = state.beit;
    if (!beit || state.phase !== 'draw' || state.players[state.cur].isAI) return state;
    const p = state.players[state.cur];
    // The beit is only for an ANT attempt. If you've already laid down this round,
    // an ant is impossible, so taking it is blocked.
    if (p.hasLaid)
      return { ...state, msg: '🏠 אי אפשר לקחת בית אחרי שכבר הורדת — הבית הוא לאנט בלבד' };
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: [...pl.hand, beit], newIds: [beit.id] } : pl
    );
    return {
      ...state, phase: 'action', beit: null, buy: null,
      players, sel: [], staging: [], msg: '🏠 לקחת בית — חובה לסיים באנט בתור הזה (או "↩️ החזר בית")',
      laidAtTurnStart: p.hasLaid, attachedThisTurn: false, tookBeit: true,
      undoBefore: { hand: p.hand, board: state.board, hasLaid: p.hasLaid, beit: state.beit, deck: state.deck, discard: state.discard, fromBeit: true },
      log: [...state.log, `🏠 ${state.players[state.cur].name} לקח קלף הבית`],
    };
  }

  // ── Selection ─────────────────────────────────────
  if (type === 'SEL') {
    const s = state.sel;
    return {
      ...state,
      sel: s.includes(action.id) ? s.filter(x => x !== action.id) : [...s, action.id],
      msg: '',
    };
  }

  if (type === 'CLEAR_SEL') return { ...state, sel: [], msg: '' };

  if (type === 'CLEAR_STAGE') return { ...state, staging: [], sel: [] };

  // ── Manual hand arrangement ───────────────────────
  // Move a card to sit just before another card in the hand (drag-to-reorder).
  if (type === 'REORDER') {
    const p = state.players[state.cur];
    if (p.isAI) return state;
    const { cid, targetId } = action;
    if (cid === targetId) return state;
    const hand = [...p.hand];
    const from = hand.findIndex(c => c.id === cid);
    if (from < 0) return state;
    const [moved] = hand.splice(from, 1);
    let to = hand.findIndex(c => c.id === targetId);
    if (to < 0) hand.push(moved); else hand.splice(to, 0, moved);
    const players = state.players.map((pl, i) => i === state.cur ? { ...pl, hand } : pl);
    return { ...state, players };
  }

  // Auto-sort the current player's hand (by suit then value).
  if (type === 'SORT') {
    const players = state.players.map((pl, i) =>
      i === state.cur && !pl.isAI ? { ...pl, hand: sortHand(pl.hand) } : pl
    );
    return { ...state, players };
  }

  // ── Undo all lays this turn ────────────────────────
  if (type === 'UNDO') {
    const ub = state.undoBefore;
    if (!ub) return state;
    if (ub.fromBeit) {
      // Beit was a blind ANT attempt: full turn reset — return the beit, restore the
      // deck/discard, undo all lays, and go back to the draw decision.
      const players = state.players.map((pl, i) =>
        i === state.cur ? { ...pl, hand: ub.hand, hasLaid: ub.hasLaid, newIds: [] } : pl
      );
      return {
        ...state, phase: 'draw',
        deck: ub.deck, discard: ub.discard, beit: ub.beit, board: ub.board,
        players, laidAtTurnStart: ub.hasLaid,
        staging: [], sel: [], msg: '↩️ הבית הוחזר — בחר שליפה מחדש',
        undoBefore: null, mustUseJoker: null, attachedThisTurn: false, tookBeit: false,
      };
    }
    // Normal draw/take: undo only the lays/attaches this turn; the drawn card stays
    // in hand and the turn continues (you can't un-draw from the deck).
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: ub.hand, hasLaid: ub.hasLaid } : pl
    );
    return {
      ...state, board: ub.board, players, beit: ub.beit,
      staging: [], sel: [], msg: '↩️ ההורדות בוטלו', undoBefore: null,
      mustUseJoker: null, attachedThisTurn: false,
    };
  }

  // ── Lay (combined stage + lay in one action) ───────
  // Each press of "הורד" validates selected cards as a group, adds to staging,
  // then lays EVERYTHING at once when the mishkakon requirement is met.
  // ANT is detected automatically when the hand empties on first-ever laydown.
  if (type === 'LAY') {
    const p = state.players[state.cur];
    if (!state.canLay) return { ...state, msg: '⚠️ אי אפשר להוריד בסבב הראשון' };

    const stagedIds = new Set(state.staging.flatMap(g => g.cards.map(c => c.id)));
    const selCards = p.hand.filter(c => state.sel.includes(c.id) && !stagedIds.has(c.id));

    // Build the group. It's valid either on its own (3+ real cards), or by completing
    // it with the must-use joker (works for both sequences with a gap and sets).
    const mj = state.mustUseJoker &&
      p.hand.find(c => c.id === state.mustUseJoker && !state.sel.includes(c.id) && !stagedIds.has(c.id));
    let group = selCards;
    let autoJoker = false;
    if (selCards.length >= 3 && isGroup(selCards)) {
      // valid as selected
    } else if (mj && selCards.length >= 2 && isGroup([...selCards, mj])) {
      group = [...selCards, mj]; autoJoker = true;
    } else if (selCards.length < 3) {
      return { ...state, msg: '❌ בחר לפחות 3 קלפים' };
    } else {
      return { ...state, msg: '❌ קבוצה לא חוקית' };
    }

    // Accumulate into staging
    const newStaging = [...state.staging, { id: uid(), cards: group }];

    // Can we lay now? Either already opened, or accumulated groups meet requirement
    if (!p.hasLaid && !meetsReq(newStaging, state.mk)) {
      // Not enough yet — just accumulate and tell the user what's missing
      const missing = MK[state.mk].seqs - newStaging.filter(g => isSeq(g.cards) && g.cards.length >= MK[state.mk].min).length;
      return {
        ...state, staging: newStaging, sel: [],
        msg: `✓ קבוצה נוספה — עוד ${missing} רצף${missing > 1 ? 'ים' : ''} דרוש${missing > 1 ? 'ים' : ''}`,
      };
    }

    // Ready to lay all staged groups to the board
    const usedIds = new Set(newStaging.flatMap(g => g.cards.map(c => c.id)));
    const newHand = p.hand.filter(c => !usedIds.has(c.id));
    const newGroups = newStaging.map(g => ({
      id: uid(), type: isSeq(g.cards) ? 'seq' : 'set', cards: orderGroup(g.cards),
    }));
    // You must always keep at least one card to discard — going out happens on the
    // discard, never by laying your whole hand. Reject a lay that would empty it.
    if (newHand.length === 0)
      return { ...state, msg: '⚠️ השאר קלף אחד ביד לזריקה' };
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: newHand, hasLaid: true } : pl
    );
    return {
      ...state, board: [...state.board, ...newGroups],
      players, staging: [], sel: [],
      msg: autoJoker ? '🃏✓ הורדה בוצעה — הג׳וקר שובץ בקבוצה' : '✓ הורדה בוצעה',
      mustUseJoker: newHand.some(c => c.id === state.mustUseJoker) ? state.mustUseJoker : null,
      log: [...state.log, `⬇ ${p.name} הוריד`],
    };
  }

  // ── Attach (also handles joker swap) ──────────────
  if (type === 'ATTACH') {
    const p = state.players[state.cur];
    if (!p.hasLaid) return { ...state, msg: 'יש להוריד תחילה' };
    // Cards to attach: a single card from drag (cid), or one-or-more from selection.
    let cards;
    if (action.cid) {
      const c = p.hand.find(x => x.id === action.cid);
      cards = c ? [c] : [];
    } else {
      cards = p.hand.filter(c => state.sel.includes(c.id));
    }
    if (!cards.length) return { ...state, msg: 'בחר קלף/ים להצמדה' };
    const grp = state.board.find(g => g.id === action.gid);
    if (!grp) return state;

    // Joker swap: only for a single real card that matches a joker's spot in a sequence.
    // The freed joker returns to the hand and MUST be used this turn.
    if (cards.length === 1 && grp.type === 'seq' && !cards[0].j) {
      const card = cards[0];
      const match = jokerValues(grp.cards).find(jv => jv.suit === card.suit && jv.v === card.v);
      if (match) {
        const joker = grp.cards.find(c => c.id === match.jokerId);
        const swapped = orderGroup(grp.cards.map(c => c.id === match.jokerId ? card : c));
        const board = state.board.map(g => g.id === grp.id ? { ...g, cards: swapped } : g);
        const newHand = [...p.hand.filter(c => c.id !== card.id), joker];
        const players = state.players.map((pl, i) =>
          i === state.cur ? { ...pl, hand: newHand } : pl
        );
        return {
          ...state, board, players, sel: [],
          mustUseJoker: joker.id, attachedThisTurn: true,
          msg: '🃏 קיבלת ג׳וקר — חובה להשתמש בו לפני הזריקה',
          log: [...state.log, `🃏 ${p.name} לקח ג׳וקר`],
        };
      }
    }

    // Normal attach of one OR more cards: the whole combined group must stay valid
    // (a sequence stays a sequence, a set stays a set).
    const combined = [...grp.cards, ...cards];
    const ok = (isSeq(grp.cards) && isSeq(combined)) || (isSet(grp.cards) && isSet(combined));
    if (!ok) return { ...state, msg: '❌ לא ניתן להצמיד את הקלפים האלה' };
    const newCards = orderGroup(combined);
    const board = state.board.map(g => g.id === action.gid ? { ...g, cards: newCards } : g);
    const attachedIds = new Set(cards.map(c => c.id));
    const newHand = p.hand.filter(c => !attachedIds.has(c.id));
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: newHand } : pl
    );
    const mustUseJoker = newHand.some(c => c.id === state.mustUseJoker) ? state.mustUseJoker : null;
    if (newHand.length === 0)
      return { ...state, msg: '⚠️ השאר קלף אחד ביד לזריקה' };
    return {
      ...state, board, players, sel: [],
      msg: cards.length > 1 ? `✓ הוצמדו ${cards.length} קלפים` : '✓ הצמדה',
      mustUseJoker, attachedThisTurn: true,
    };
  }

  // ── AI actions (bypass staging) ───────────────────
  if (type === 'AI_LAY') {
    const p = state.players[state.cur];
    const { groups } = action;
    if (!p.hasLaid && !meetsReq(groups, state.mk)) return state;
    const usedIds = new Set(groups.flatMap(g => g.cards.map(c => c.id)));
    const newHand = p.hand.filter(c => !usedIds.has(c.id));
    if (newHand.length === 0) return state; // must keep a card to discard
    const newGroups = groups.map(g => ({
      id: uid(), type: isSeq(g.cards) ? 'seq' : 'set', cards: orderGroup(g.cards),
    }));
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: newHand, hasLaid: true } : pl
    );
    return {
      ...state, board: [...state.board, ...newGroups],
      players, staging: [], sel: [],
      log: [...state.log, `⬇ ${p.name} הוריד`],
    };
  }

  if (type === 'AI_ATTACH') {
    const p = state.players[state.cur];
    if (!p.hasLaid) return state;
    const card = p.hand.find(c => c.id === action.cid);
    const grp = state.board.find(g => g.id === action.gid);
    if (!card || !grp) return state;
    const pos = attachPos(grp.cards, card);
    if (!pos) return state;
    const newHand = p.hand.filter(c => c.id !== card.id);
    if (newHand.length === 0) return state; // must keep a card to discard
    const newCards = orderGroup([...grp.cards, card]);
    const board = state.board.map(g => g.id === action.gid ? { ...g, cards: newCards } : g);
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: newHand } : pl
    );
    return { ...state, board, players, attachedThisTurn: true };
  }

  // ── Discard ───────────────────────────────────────
  if (type === 'DISCARD') {
    const p = state.players[state.cur];
    if (state.mustUseJoker && p.hand.some(c => c.id === state.mustUseJoker))
      return { ...state, msg: '🃏 חובה להשתמש בג׳וקר שלקחת לפני הזריקה' };
    const card = p.hand.find(c => c.id === action.cid);
    if (!card) return state;
    const newHand = p.hand.filter(c => c.id !== card.id);
    const players = state.players.map((pl, i) =>
      i === state.cur ? { ...pl, hand: newHand } : pl
    );
    // Going out: discarding the last card ends the round. It's an ANT (−50) only if
    // the player laid their entire hand in their own new groups within this single turn
    // (hadn't laid before this turn AND didn't attach to anyone's existing groups).
    if (newHand.length === 0 && p.hasLaid) {
      const isAnt = !state.laidAtTurnStart && !state.attachedThisTurn;
      // If the beit was taken this turn, going out is allowed ONLY as an ant.
      if (state.tookBeit && !isAnt)
        return { ...state, msg: '🏠 לקחת בית — מותר לסיים רק באנט. החזר את הבית (↩️) או השלם אנט.' };
      return endWin({ ...state, discard: [...state.discard, card] }, players, state.board, isAnt);
    }
    // Took the beit but not going out as an ant → not allowed. Must complete the ant
    // or return the beit.
    if (state.tookBeit)
      return { ...state, msg: '🏠 לקחת בית — חובה להשלים אנט בתור הזה, או ללחוץ "↩️ החזר בית".' };
    const nextIdx = (state.cur + 1) % state.players.length;
    // Track turns; open laying once everyone has had one turn (end of first go-around)
    const turnsPlayed = (state.turnsPlayed || 0) + 1;
    const canLay = state.canLay || turnsPlayed >= state.players.length;
    // Safety net: if a round runs far beyond normal length (stale take-free cycle
    // where nobody can go out and the deck isn't depleting), end it by deck rules.
    if (turnsPlayed > 50 * state.players.length) {
      return endDeck({ ...state, players, discard: [...state.discard, card] });
    }
    return {
      ...state, phase: 'buying',
      discard: [...state.discard, card],
      players, cur: nextIdx, sel: [], staging: [],
      undoBefore: null, turnsPlayed, canLay, mustUseJoker: null, tookBeit: false,
      buy: { checker: nextIdx, origNext: nextIdx, prev: state.cur },
      log: [...state.log, `↓ ${p.name} זרק ${cTxt(card)}`],
    };
  }

  if (type === 'NEW_HAND') return startHand(state);
  if (type === 'NEXT_MK') {
    if (state.mk >= 5) return { ...state, phase: 'game_end' };
    return startHand({ ...state, mk: state.mk + 1, sivuv: 0 });
  }
  if (type === 'GAME_END') return { ...state, phase: 'game_end' };

  return state;
}

// ═══════════════════════════════════════════════════════
// AI LOGIC
// ═══════════════════════════════════════════════════════

function aiWantCard(hand, card) {
  if (!card || card.j) return false;
  // Only worth taking if the card actually joins/forms a real group (3+),
  // not merely sits "near" another card. This prevents grabbing the discard
  // every turn only to throw it back.
  const before = findAIGroups(hand).groups.reduce((n, g) => n + g.cards.length, 0);
  const withCard = findAIGroups([...hand, card]);
  const after = withCard.groups.reduce((n, g) => n + g.cards.length, 0);
  const used = withCard.groups.some(g => g.cards.some(c => c.id === card.id));
  return used && (after - before) >= 2;
}

function findAIGroups(hand) {
  const used = new Set();
  const groups = [];
  let jPool = hand.filter(c => c.j);

  // Sequences per suit
  const bySuit = {};
  for (const c of hand) {
    if (c.j || used.has(c.id)) continue;
    (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  }

  for (const suit in bySuit) {
    const sorted = [...bySuit[suit]].sort((a, b) => a.v - b.v);
    let run = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const lastReal = [...run].reverse().find(c => !c.j);
      const lastV = lastReal ? lastReal.v : 0;
      if (sorted[i].v === lastV) continue;
      const gap = sorted[i].v - lastV - 1;
      if (gap === 0) {
        run.push(sorted[i]);
      } else if (gap > 0 && gap <= jPool.length) {
        const js = jPool.splice(0, gap);
        run.push(...js, sorted[i]);
      } else {
        if (run.filter(c => !c.j).length > 0 && run.length >= 3) {
          run.forEach(c => used.add(c.id));
          groups.push({ cards: run });
        }
        run = [sorted[i]];
      }
    }
    if (run.filter(c => !c.j).length > 0 && run.length >= 3) {
      run.forEach(c => used.add(c.id));
      groups.push({ cards: run });
    }
  }

  // Sets
  const byVal = {};
  for (const c of hand) {
    if (c.j || used.has(c.id)) continue;
    (byVal[c.v] = byVal[c.v] || []).push(c);
  }
  for (const val in byVal) {
    const cs = byVal[val];
    const uniq = []; const seen = new Set();
    for (const c of cs) if (!seen.has(c.suit)) { seen.add(c.suit); uniq.push(c); }
    if (uniq.length >= 3) {
      uniq.slice(0, 4).forEach(c => used.add(c.id));
      groups.push({ cards: uniq.slice(0, 4) });
    }
  }

  const unused = hand.map(c => c.id).filter(id => !used.has(id));
  return { groups, unused };
}

function aiDiscard(hand) {
  const { unused } = findAIGroups(hand);
  const cands = unused.length ? hand.filter(c => unused.includes(c.id)) : hand;
  return cands.sort((a, b) => cSc(b) - cSc(a))[0] || hand[0];
}

// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════

export {
  SUITS, SYM, COL, VD, cSc, cTxt, MK, FELT, FELTD, GOLD, CREAM,
  uid, sortHand, mkCard, makeDeck, shuffle,
  isSeq, isSet, isGroup, orderSeq, orderGroup, jokerValues, attachPos, meetsReq,
  startHand, initGame, endWin, endDeck, nextCk,
  G, aiWantCard, findAIGroups, aiDiscard,
};
