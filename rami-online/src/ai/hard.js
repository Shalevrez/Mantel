// ═══════════════════════════════════════════════════════
// HARD COMPUTER PLAYER — decision engine
//
// Every decision is "pick the option with the lowest expected penalty":
//
//   take the discard or draw?   expected value of the turn either way, the
//                               draw averaged over every card still unseen
//   buy out of turn?            hand + card + an unknown penalty card,
//                               against the hand as it is
//   open now or wait for an ant?  one turn of lookahead with recourse: the
//                               risk of holding everything for a round, the
//                               exact chance the next card completes an ant,
//                               and the value of opening next turn instead
//   what to lay / attach?       the solver's best split, executed through the
//                               real reducer, joker swaps tried both ways
//   what to throw?              the hand that is worth most afterwards, plus
//                               what the card is worth to the opponents
//
// Values come from the hand solver (./hand.js), whose probabilities are fed
// by what is public: cards not yet seen anywhere, the board, and a model of
// how close each opponent is to going out (their hand size and whether they
// have opened). The engine never reads a hidden card: it first builds a copy
// of the game where every opponent's hand and the deck are blank cards of the
// right count (sanitize), and only ever looks at — and simulates moves on —
// that copy. Whatever it decides could have been decided by a person sitting
// in that chair.
//
// All work is bounded by a node budget per decision. Out of budget, a buy or
// draw decision degrades to the safe default (pass / draw blind) and reports
// it in `diag`; planTurn throws BUDGET and the room finishes that turn with
// the medium routine. Pass a `diag` object to learn what happened:
//   { nodes, budget: 'ok' | 'exhausted' }
// ═══════════════════════════════════════════════════════

import {
  G, MK, cSc, attachPos, decksFor, lastMk, swapJoker, onLastCard, nextActive, isGroup,
} from '../game-core.js';
import { makeCtx, Solver, bindPlan, typeOf, typePts, typeCard, posType, INF, BUDGET } from './hand.js';

export { BUDGET };

// Production budget: search nodes per decision (CPU per node varies with the
// hand; see tests/bench/README.md for measured CPU). A hand big enough to need
// more falls back.
export const DEFAULT_BUDGET = 25000;

// Search nodes the last decision used (for the benchmark's cost report).
export const lastWork = { budget: null, get nodes() { return this.budget ? this.budget.n : 0; } };

// Counters for the benchmark: how often a plan the solver proved could not be
// carried out move by move (then another plan is tried, or the turn goes on
// without going out). Never read by the game.
export const engineStats = { outPlans: 0, outPlanOK: 0 };

// ── Tunables ─────────────────────────────────────────
// Kept together so the benchmark can sweep them. Values were picked from
// self-play measurements (see tests/bench/README.md).
export const TUNE = {
  slotK: 0.55,          // cost of a missing opening run, as a share of hand points
  dangerW: 1.6,         // weight of what a discard is worth to the opponents
  takeMargin: 0.3,      // a free take must beat the draw by this much
  buyMargin: 2.0,       // a paid buy must beat passing by this much
  holdMargin: 1.0,      // waiting for an ant must beat opening by this much
  antValue: -50,
  access: 1.35,
  // A paid buy is only averaged over every possible penalty card when the
  // card alone (no penalty card) already comes within this much of paying
  // off. Measured: skips ~77% of the full averages and changes ~0.4% of the
  // decisions (tests/bench/README.md).
  buyPrefilter: 3,
};

// Chance an opponent goes out on their next turn, by the hand size they
// start it with, for one who has opened and one who hasn't. Measured from
// self-play (tests/bench/calibrate.mjs, 2- and 4-player tables, blended).
// Odd sizes are the dangerous ones: with the draw they can put down a fresh
// three-card group and throw; an even hand needs two separate attaches.
const HAZ_LAID = [0, 0.36, 0.05, 0.17, 0.03, 0.012, 0.006, 0.006, 0.003];
const HAZ_CLOSED = [0, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.025, 0.025];
export function hazard(n, laid) {
  if (n <= 0) return 0;
  const t = laid ? HAZ_LAID : HAZ_CLOSED;
  return t[Math.min(n, t.length - 1)];
}

// ── The public view ──────────────────────────────────
const blank = id => ({ id, suit: 'h', v: 2, j: false });
// A copy of the game holding exactly what `seat` can see. Opponents' hands
// and the deck become blank cards; the rollback snapshot keeps only this
// seat's own cards. Logs are dropped (nothing reads them; it keeps the
// reducer's copies cheap).
export function sanitize(state, seat) {
  // The rollback snapshot belongs to the player on turn: only ever this
  // seat's own (its hand, the public board and pile); anyone else's is dropped.
  const ub = state.cur === seat ? state.undoBefore : null;
  return {
    ...state,
    log: [],
    msg: '', msgSeat: undefined,
    sel: state.cur === seat ? state.sel : [],
    staging: state.cur === seat ? state.staging : [],
    // Who else wanted a card someone took is private to each seat.
    buyNote: state.buyNote ? { ...state.buyNote, outbid: [] } : state.buyNote,
    deck: state.deck.map((_, k) => blank(`?d${k}`)),
    undoBefore: ub ? { ...ub, deck: ub.deck ? ub.deck.map((_, k) => blank(`?u${k}`)) : ub.deck } : null,
    players: state.players.map((p, i) => i === seat ? p
      : { ...p, hand: p.hand.map((_, k) => blank(`?${i}.${k}`)), newIds: [] }),
  };
}

// ── What is known ────────────────────────────────────
// Cards not visible anywhere (still in the deck or in an unknown part of an
// opponent's hand), and the cards each opponent is known to hold because they
// took them face up and haven't laid or thrown them since.
export function knowledge(pub, seat) {
  const decks = decksFor(pub.players.length);
  const unseen = new Int16Array(52).fill(decks);
  let unseenJ = 2 * decks;
  const see = c => { if (!c) return; if (c.j) unseenJ--; else unseen[typeOf(c)]--; };
  for (const c of pub.players[seat].hand) see(c);
  for (const g of pub.board) for (const c of g.cards) see(c);
  for (const c of pub.discard) see(c);
  see(pub.beit);
  // Who holds what, from the face-up record.
  const holder = new Map();
  for (const e of pub.track || []) {
    if (e.k === 'd') holder.delete(e.c.id);
    else holder.set(e.c.id, { s: e.s, c: e.c });
  }
  const onTable = new Set();
  for (const g of pub.board) for (const c of g.cards) if (c) onTable.add(c.id);
  for (const c of pub.discard) if (c) onTable.add(c.id);
  const known = pub.players.map(() => []);
  for (const { s, c } of holder.values()) {
    if (s === seat || onTable.has(c.id) || !known[s]) continue;
    known[s].push(c);
    see(c);
  }
  for (let t = 0; t < 52; t++) if (unseen[t] < 0) unseen[t] = 0;
  return { unseen, unseenJ: Math.max(0, unseenJ), known };
}

// ── The table ────────────────────────────────────────
// Which card types attach to some group on the board. A group can only ever
// take a card of a suit (a run) or a value (a set) it already holds, so only
// those are put to the reducer's attachPos — the same answers as testing all
// 52, for a fraction of the work.
function attachFlags(board) {
  const attach = new Uint8Array(52);
  let attachJ = false;
  if (!board.length) return { attach, attachJ };
  const J = { id: '?j', suit: 'j', v: 0, j: true };
  for (const g of board) {
    if (!attachJ && attachPos(g.cards, J)) attachJ = true;
    const cand = new Set();
    for (const c of g.cards) {
      if (c.j) continue;
      const t = typeOf(c), si = (t / 13) | 0, r = t % 13;
      for (let k = 0; k < 13; k++) cand.add(si * 13 + k);
      for (let sj = 0; sj < 4; sj++) cand.add(sj * 13 + r);
    }
    for (const t of cand) {
      if (attach[t]) continue;
      if (attachPos(g.cards, { id: '?c', ...typeCard(t) })) attach[t] = 1;
    }
  }
  return { attach, attachJ };
}

// The planning frame for one decision: the public view, what is known, the
// threat level, and solvers (with their memos) per board state.
export class Frame {
  constructor(state, seat, budgetMax = DEFAULT_BUDGET, tune = TUNE, budget = null) {
    this.seat = seat;
    this.pub = sanitize(state, seat);
    this.tune = tune || TUNE;
    // `budget` lets one decision that plans in two steps share one allowance.
    // An oversized hand (repeated buying) costs several times more CPU per
    // search node and often runs out anyway, so it gets a smaller allowance:
    // it falls back sooner instead of burning CPU first.
    const size = state.players[seat].hand.length;
    const scale = size > 20 ? (20 / size) ** 2 : 1;
    this.budget = budget || { n: 0, max: Math.round((budgetMax || DEFAULT_BUDGET) * scale) };
    lastWork.budget = this.budget;
    this.know = knowledge(this.pub, seat);
    const pub = this.pub;
    // Chance the round survives one full trip round the table back to us.
    let s = 1;
    pub.players.forEach((p, i) => {
      if (i === seat || p.out) return;
      if (!pub.canLay && (pub.turnsPlayed || 0) < pub.players.length - 1) return;
      s *= 1 - hazard(p.hand.length, p.hasLaid);
    });
    this.s = Math.min(0.96, s);
    this.mk = MK[pub.mk];
    this.cache = new Map();
    // Appetite for the ant's −50: a player well behind late in the game needs
    // the swing more; one well ahead needs it less.
    const me = pub.players[seat];
    const rivals = pub.players.filter((p, i) => i !== seat && !p.out).map(p => p.totalScore || 0);
    const best = rivals.length ? Math.min(...rivals) : 0;
    const deficit = (me.totalScore || 0) - best;
    const left = lastMk(pub) - pub.mk;
    let app = 1 + Math.max(0, Math.min(0.5, deficit / 200)) * (left <= 1 ? 1 : 0.5);
    if (deficit < -100) app *= 0.9;
    this.antValue = this.tune.antValue * app;
  }

  me(st = this.pub) { return st.players[this.seat]; }

  // Attach flags for a board, computed once per board state.
  flags(board) {
    const bkey = 'A|' + board.map(g => g.id + ':' + g.cards.length).join(',');
    let f = this.cache.get(bkey);
    if (!f) { f = attachFlags(board); this.cache.set(bkey, f); }
    return f;
  }

  // Solvers for a board / opened state. `now`: melds can still be laid this
  // turn (the action phase); otherwise they wait for the next turn.
  solver(mode, { board, laid, now, freeNeed = 1 }) {
    const bkey = board.map(g => g.id + ':' + g.cards.length).join(',');
    const key = `${mode}|${laid ? 1 : 0}|${now ? 1 : 0}|${freeNeed}|${bkey}`;
    let sv = this.cache.get(key);
    if (sv) return sv;
    const { attach, attachJ } = this.flags(board);
    const hand = this.me().hand;
    const h0 = Math.min(120, hand.reduce((n, c) => n + cSc(c), 0));
    const ctx = makeCtx({
      need: laid ? 0 : this.mk.seqs, min: this.mk.min,
      openOK: now ? !!this.pub.canLay : true, layNow: !!now,
      s: this.s, unseen: this.know.unseen, unseenJ: this.know.unseenJ,
      attach, attachJ, slotCost: Math.max(15, h0 * this.tune.slotK), access: this.tune.access,
    });
    ctx.freeNeed = freeNeed;
    sv = new Solver(ctx, mode, this.budget);
    this.cache.set(key, sv);
    return sv;
  }

  // What a discard is worth to the opponents, in our penalty points: the
  // chance someone takes it and how much closer that brings them to going
  // out, times what we stand to lose if they do.
  danger(card, board, stake) {
    if (card.j) return 0;
    const pub = this.pub, seat = this.seat;
    const next = nextActive(pub, seat);
    const fits = !!this.flags(board).attach[typeOf(card)];
    let sum = 0;
    pub.players.forEach((p, i) => {
      if (i === seat || p.out || onLastCard(p)) return;
      let want = 0;
      if (p.hasLaid && fits) want = 0.9;
      else if (this.know.known[i].some(k => !k.j && (
        (k.v === card.v && k.suit !== card.suit) ||
        (k.suit === card.suit && Math.abs(k.v - card.v) <= 2 && k.v !== card.v)))) want = 0.55;
      if (!want) return;
      if (i !== next) want *= 0.5;
      const n = p.hand.length;
      const gain = Math.max(0, hazard(Math.max(1, n - 1), p.hasLaid) - hazard(n, p.hasLaid)) + 0.01;
      sum += want * gain;
    });
    return this.tune.dangerW * sum * stake;
  }
}

const without = (cards, card) => { const i = cards.indexOf(card); return i < 0 ? cards : [...cards.slice(0, i), ...cards.slice(i + 1)]; };
const handPts = cards => cards.reduce((n, c) => n + cSc(c), 0);
// One representative card per type (copies are interchangeable), jokers once.
function distinct(cards) {
  const seen = new Set(), out = [];
  for (const c of cards) {
    const k = c.j ? 'j' : typeOf(c);
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}

// ── Discard ──────────────────────────────────────────
// The card whose absence leaves the best hand, danger included. `ctxArgs`
// picks the frame the remaining hand is valued in (after the turn: melds wait
// for the next one).
function chooseDiscard(F, st, { forbid = null } = {}) {
  const me = F.me(st);
  const hand = me.hand;
  const sv = F.solver('eval', { board: st.board, laid: me.hasLaid, now: false });
  const stake = handPts(hand);
  let best = null;
  for (const d of distinct(hand)) {
    if (forbid && d.id === forbid) continue;
    const rest = without(hand, d);
    const v = sv.evaluate(rest).v + F.danger(d, st.board, stake);
    if (!best || v < best.v - 1e-9 || (Math.abs(v - best.v) < 1e-9 && cSc(d) > cSc(best.card))) best = { card: d, v };
  }
  return best;
}

// ── Running moves through the reducer ────────────────
// Board groups are named by their index: groups laid this turn get fresh ids
// in every copy of the state, but they are always appended, so an index
// means the same group on the real table.
function step(st, intent) {
  const a = { ...intent };
  if (a.gidx !== undefined) { const g = st.board[a.gidx]; if (!g) return null; a.gid = g.id; delete a.gidx; }
  const next = G(st, a);
  return progressed(st, next, a) ? next : null;
}
function progressed(st, next, a) {
  if (!next || next === st) return false;
  const seat = st.cur;
  switch (a.type) {
    case 'DISCARD': return next.phase !== 'action' || next.cur !== st.cur;
    case 'ATTACH': return next.players[seat].hand !== st.players[seat].hand && next.board !== st.board;
    case 'UNDO': return next.phase === 'draw';
    default: return true;
  }
}
// Applies intents to a real state. Returns { state, ok } — ok false when one
// was refused (the state then stops at the last good step).
export function applyIntents(state, intents) {
  let st = state;
  for (const it of intents) {
    const next = step(st, it);
    if (!next) return { state: st, ok: false };
    st = next;
  }
  return { state: st, ok: true };
}

class Sim {
  constructor(F, st) { this.F = F; this.st = st; this.intents = []; }
  fork() { const s = new Sim(this.F, this.st); s.intents = [...this.intents]; return s; }
  do(intent) { const n = step(this.st, intent); if (!n) return false; this.st = n; this.intents.push(intent); return true; }
  get me() { return this.st.players[this.F.seat]; }
  groupFor(card) {
    const b = this.st.board;
    // Prefer a group that keeps a set open and a run extendable: the first fit.
    for (let i = 0; i < b.length; i++) if (attachPos(b[i].cards, card)) return i;
    return -1;
  }
  lay(groups) {
    if (!groups.length) return true;
    return this.do({ type: 'AI_LAY', groups: groups.map(cards => ({ cards: cards.map(c => ({ id: c.id })) })) });
  }
  attach(card) {
    const gi = this.groupFor(card);
    return gi >= 0 && this.do({ type: 'AI_ATTACH', cid: card.id, gidx: gi });
  }
  ended() { return this.st.phase !== 'action'; }
}

// ── Going out this turn ──────────────────────────────
function tryGoOut(F, sim) {
  const me = sim.me, st = sim.st;
  const hand = me.hand;
  const tries = [];
  if (!me.hasLaid && st.canLay) tries.push('ant');
  if (me.hasLaid || st.canLay) tries.push('out');
  for (const mode of tries) {
    const sv = F.solver(mode, { board: st.board, laid: me.hasLaid, now: true });
    if (sv.evaluate(hand).o !== 0) continue;
    const items = sv.plan('o', hand);
    if (!items) continue;
    engineStats.outPlans++;
    const bound = bindPlan(items, hand);
    const s = sim.fork();
    const melds = bound.filter(b => b.kind === 'seq' || b.kind === 'set').map(b => b.cards);
    if (!melds.every(isGroup) || !s.lay(melds)) continue;
    let ok = true;
    for (const b of bound.filter(b => b.kind === 'attach')) if (!s.attach(b.cards[0])) { ok = false; break; }
    if (!ok) continue;
    attachAll(s, null);
    if (s.me.hand.length !== 1) continue;
    if (s.do({ type: 'DISCARD', cid: s.me.hand[0].id }) && s.ended()) { engineStats.outPlanOK++; return s; }
  }
  return null;
}

// Attach whatever still fits, keeping `keep` (the planned discard) in hand.
function attachAll(sim, keep) {
  for (let guard = 0; guard < 20; guard++) {
    let moved = false;
    for (const c of sim.me.hand) {
      if (keep && c.id === keep.id) continue;
      if (sim.me.hand.length <= 1) return;
      if (sim.attach(c)) { moved = true; break; }
    }
    if (!moved) return;
  }
}

// ── An opened hand's turn ────────────────────────────
// Choose the discard first, then lay and attach everything the best split of
// the rest says to, repeat while the board keeps opening new spots, and throw.
function laidCore(F, sim) {
  for (let iter = 0; iter < 8; iter++) {
    const me = sim.me;
    if (me.hand.length <= 1) break;
    const forbid = sim.st.mustUseJoker;
    const pick = chooseDiscard(F, sim.st, { forbid });
    if (!pick) break;
    const rest = without(me.hand, pick.card);
    const sv = F.solver('eval', { board: sim.st.board, laid: true, now: true });
    const items = sv.plan(sv.evaluate(rest).o <= sv.evaluate(rest).c ? 'o' : 'c', rest);
    if (!items) break;
    const bound = bindPlan(items, rest);
    const before = sim.intents.length;
    const melds = bound.filter(b => (b.kind === 'seq' || b.kind === 'set') && isGroup(b.cards)).map(b => b.cards);
    if (melds.length) sim.lay(melds);
    for (const b of bound) if (b.kind === 'attach' && sim.me.hand.length > 1) sim.attach(b.cards[0]);
    if (sim.intents.length === before) break;
  }
  // A joker freed by a swap must be used before the throw.
  const mj = sim.st.mustUseJoker && sim.me.hand.find(c => c.id === sim.st.mustUseJoker);
  if (mj && !sim.attach(mj)) return null;
  if (sim.me.hand.length === 1) {
    sim.do({ type: 'DISCARD', cid: sim.me.hand[0].id });
    return sim.ended() ? { sim, v: sim.st.phase === 'round_end' ? 0 : 0 } : null;
  }
  const pick = chooseDiscard(F, sim.st);
  if (!pick || !sim.do({ type: 'DISCARD', cid: pick.card.id })) return null;
  return { sim, v: pick.v };
}

function laidPhase(F, sim) {
  let best = laidCore(F, sim.fork());
  // Joker swaps: a real card that a board joker stands for brings the joker
  // back to the hand (to be used this turn). Try each, keep what's best.
  const b = sim.st.board;
  let tries = 0;
  for (let gi = 0; gi < b.length && tries < 3; gi++) {
    if (!b[gi].cards.some(c => c.j)) continue;
    for (const c of distinct(sim.me.hand)) {
      if (c.j || !swapJoker(b[gi], c)) continue;
      tries++;
      const s = sim.fork();
      if (!s.do({ type: 'ATTACH', cid: c.id, gidx: gi })) continue;
      const r = laidCore(F, s);
      if (r && (!best || r.v < best.v - 0.01)) best = r;
      break;
    }
  }
  return best;
}

// ── Ant chances ──────────────────────────────────────
// Probability that one more card (the next draw, or a usable discard) lets
// `hand` go out as an ant.
function antChance(F, hand, board) {
  const svA = F.solver('ant', { board, laid: false, now: true });
  const sv0 = F.solver('ant', { board, laid: false, now: true, freeNeed: 0 });
  const { unseen, unseenJ } = F.know;
  let N = unseenJ, hit = 0;
  for (let t = 0; t < 52; t++) N += unseen[t];
  if (!N) return 0;
  // A card that touches nothing can only be thrown straight back: it works
  // exactly when the hand itself is already complete.
  const full = sv0.evaluate(hand).o === 0;
  const touch = touchSet(hand);
  for (let t = 0; t < 52; t++) {
    const u = unseen[t];
    if (!u) continue;
    if (!touch.all && !touch.types[t]) { if (full) hit += u; continue; }
    const c = { id: '?a', ...typeCard(t) };
    if (svA.evaluate([...hand, c]).o === 0) hit += u;
  }
  if (unseenJ && svA.evaluate([...hand, { id: '?aj', suit: 'j', v: 0, j: true }]).o === 0) hit += unseenJ;
  let q = hit / N;
  q = 1 - Math.pow(1 - q, F.tune.access);
  const beit = F.pub.beit;
  if (beit && svA.evaluate([...hand, beit]).o === 0) q = Math.max(q, 0.9);
  return q;
}

// Card types that can combine with something in the hand.
function touchSet(hand) {
  const types = new Uint8Array(52);
  let J = 0;
  for (const c of hand) {
    if (c.j) { J++; continue; }
    const t = typeOf(c), si = (t / 13) | 0;
    for (let sj = 0; sj < 4; sj++) types[sj * 13 + (t % 13)] = 1;
    const vs = c.v === 1 ? [1, 14] : [c.v];
    for (const v of vs) for (let d = -2; d <= 2; d++) {
      const p = v + d;
      if (p >= 1 && p <= 14) types[posType(si, p)] = 1;
    }
  }
  // Two jokers make a run out of any card, but spending both on one stray
  // card is rarely the play: such cards are valued as strays.
  return { types, all: false };
}

// ── The turn ─────────────────────────────────────────
// Returns the list of intents for the action phase.
export function planTurn(state, seat, budgetMax, tune, diag = null, budget = null) {
  const F = new Frame(state, seat, budgetMax, tune, budget);
  if (diag) diag.budgetRef = F.budget;
  return finish(diag, F, planTurnIn(F));
}

// Records how much work a decision took.
function finish(diag, F, result) {
  if (diag) { diag.nodes = F.budget.n; diag.budget = F.budget.n > F.budget.max ? 'exhausted' : 'ok'; }
  return result;
}

function planTurnIn(F) {
  const seat = F.seat;
  const sim = new Sim(F, F.pub);
  const me = sim.me;

  // Took the beit: go out as an ant now, or hand it back.
  if (sim.st.tookBeit) {
    const out = tryGoOut(F, sim);
    return out ? out.intents : [{ type: 'UNDO' }];
  }

  const out = tryGoOut(F, sim);
  if (out) return out.intents;

  if (me.hasLaid) {
    const r = laidPhase(F, sim);
    if (r) return r.sim.intents;
    const pick = chooseDiscard(F, sim.st);
    return [{ type: 'DISCARD', cid: pick.card.id }];
  }

  const hold = () => {
    const pick = chooseDiscard(F, sim.st);
    return { intents: [{ type: 'DISCARD', cid: pick.card.id }], card: pick.card, v: pick.v };
  };

  if (!sim.st.canLay) return hold().intents;

  // Can it open?
  const svNow = F.solver('eval', { board: sim.st.board, laid: false, now: true });
  const root = svNow.evaluate(me.hand);
  if (root.o >= INF) return hold().intents;
  const items = svNow.plan('o', me.hand);
  if (!items) return hold().intents;
  const bound = bindPlan(items, me.hand);
  const melds = bound.filter(b => b.kind === 'seq' || b.kind === 'set').map(b => b.cards);
  const opened = sim.fork();
  let layRes = null;
  if (melds.every(isGroup) && opened.lay(melds)) layRes = laidPhase(F, opened);
  if (!layRes) return hold().intents;

  // Open now, or keep everything back for a shot at the ant? One turn of
  // lookahead: holding risks the whole hand for a round; next turn it either
  // completes the ant or opens anyway (worth about what opening is worth now).
  const h = hold();
  const rest = without(me.hand, h.card);
  const q = antChance(F, rest, sim.st.board);
  if (q > 0) {
    const s = F.s;
    const evHold = (1 - s) * handPts(rest) + s * (q * F.antValue + (1 - q) * layRes.v);
    if (evHold < layRes.v - F.tune.holdMargin) return h.intents;
  }
  return layRes.sim.intents;
}

// ── Turn value for "take or draw" ────────────────────
// What a turn holding `cards` (the hand plus the new card) is worth: an ant
// or going out if it can, else the best discard after laying what it would.
function turnValue(F, cards, cand = null) {
  const me = F.me(), st = F.pub;
  const laid = me.hasLaid;
  if (!laid && st.canLay && F.solver('ant', { board: st.board, laid, now: true }).evaluate(cards).o === 0) return F.antValue;
  if ((laid || st.canLay) && F.solver('out', { board: st.board, laid, now: true }).evaluate(cards).o === 0) return 0;
  const sv = F.solver('eval', { board: st.board, laid, now: true });
  let best = INF;
  for (const d of cand || distinct(cards)) {
    const v = sv.evaluate(without(cards, d)).v;
    if (v < best) best = v;
  }
  return best;
}

// Expected turn value of drawing blind.
function drawValue(F) {
  const me = F.me(), st = F.pub, hand = me.hand;
  const laid = me.hasLaid;
  const { unseen, unseenJ } = F.know;
  let N = unseenJ;
  for (let t = 0; t < 52; t++) N += unseen[t];
  if (!N) return INF;
  const sv = F.solver('eval', { board: st.board, laid, now: true });
  const base = sv.evaluate(hand);   // the drawn card thrown straight back
  // Can it go out with nothing but a card to throw?
  let fullOut = null;
  if (!laid && st.canLay && F.solver('ant', { board: st.board, laid, now: true, freeNeed: 0 }).evaluate(hand).o === 0) fullOut = F.antValue;
  else if ((laid || st.canLay) && F.solver('out', { board: st.board, laid, now: true, freeNeed: 0 }).evaluate(hand).o === 0) fullOut = 0;
  // Each discard's remaining hand, for cards that combine with nothing.
  const perD = distinct(hand).map(d => ({ d, r: sv.evaluate(without(hand, d)) }));
  perD.sort((a, b) => a.r.v - b.r.v);
  const top = perD.slice(0, 2).map(x => x.d);
  const ctx = sv.ctx;
  const touch = touchSet(hand);
  let acc = 0;
  const lone = (t) => {
    const pts = typePts(t);
    let best = base.v;
    if (ctx.attach[t] && (laid || st.canLay)) {
      // It attaches for free: as good as the best other discard.
      for (const { r } of perD) best = Math.min(best, Math.min(r.o, r.c + pts * ctx.risk));
    }
    return best;
  };
  for (let t = 0; t < 52; t++) {
    const u = unseen[t];
    if (!u) continue;
    let v;
    if (fullOut !== null && !(touch.all || touch.types[t])) v = fullOut;
    else if (!touch.all && !touch.types[t] && !ctx.attach[t]) v = lone(t);
    else {
      const c = { id: '?dr', ...typeCard(t) };
      v = turnValue(F, [...hand, c], [c, ...top]);
    }
    acc += u * v;
  }
  if (unseenJ) {
    const c = { id: '?drj', suit: 'j', v: 0, j: true };
    acc += unseenJ * turnValue(F, [...hand, c], [c, ...top]);
  }
  return acc / N;
}

// ── Taking, buying ───────────────────────────────────
export function decideBuy(state, seat, budgetMax, tune, diag = null) {
  const F = new Frame(state, seat, budgetMax, tune);
  try { return finish(diag, F, decideBuyIn(F, seat)); }
  catch (e) { if (e !== BUDGET) throw e; return finish(diag, F, { type: 'SKIP', seat }); }   // out of budget: pass (draw blind)
}

function decideBuyIn(F, seat) {
  const st = F.pub, me = F.me();
  const top = st.discard[st.discard.length - 1];
  if (!top) return { type: 'SKIP', seat };
  if (seat === st.buy.origNext) {
    // Free: the card instead of a blind draw. A card that combines with
    // nothing (and attaches nowhere) is never better than a blind draw: it
    // would be thrown straight back, which is also the draw's worst case.
    const skip = { type: 'SKIP', seat };
    const laidOrCan = me.hasLaid || st.canLay;
    if (!top.j && !touchSet(me.hand).types[typeOf(top)]) {
      if (!(laidOrCan && F.flags(st.board).attach[typeOf(top)])) return skip;
    }
    const vTake = turnValue(F, [...me.hand, top]);
    if (vTake <= F.antValue) return { type: 'TAKE_FREE' };
    // The draw is worth at most what the hand is worth with the drawn card
    // thrown back; a take that can't beat even that is a pass.
    const base = F.solver('eval', { board: st.board, laid: me.hasLaid, now: true }).evaluate(me.hand).v;
    if (vTake >= base - F.tune.takeMargin) return skip;
    let vDraw;
    try { vDraw = drawValue(F); }
    catch (e) {
      if (e !== BUDGET) throw e;
      // Out of budget mid-average (a huge hand): take only a clear gain.
      return vTake < base - 3 * F.tune.takeMargin - 1 ? { type: 'TAKE_FREE' } : skip;
    }
    if (st.beit && !me.hasLaid && st.canLay &&
        F.solver('ant', { board: st.board, laid: false, now: true }).evaluate([...me.hand, st.beit]).o === 0) vDraw = Math.min(vDraw, F.antValue);
    return vTake < vDraw - F.tune.takeMargin ? { type: 'TAKE_FREE' } : { type: 'SKIP', seat };
  }
  // Paid: the card plus an unknown penalty card, and the turn still to come.
  try { return paidBuy(F, top, seat); }
  catch (e) { if (e !== BUDGET) throw e; return { type: 'SKIP', seat }; }
}

function paidBuy(F, top, seat) {
  const st = F.pub, me = F.me();
  if (!top.j && !touchSet(me.hand).types[typeOf(top)] && !F.flags(st.board).attach[typeOf(top)]) return { type: 'SKIP', seat };
  const sv = F.solver('eval', { board: st.board, laid: me.hasLaid, now: false });
  const pass = sv.evaluate(me.hand).v;
  const withTop = [...me.hand, top];
  // An unknown extra card almost never helps on average, so a card that
  // doesn't pay off on its own won't with a penalty card added.
  if (sv.evaluate(withTop).v >= pass - F.tune.buyMargin + F.tune.buyPrefilter) return { type: 'SKIP', seat };
  const { unseen, unseenJ } = F.know;
  let N = 0, acc = 0;
  const touch = touchSet(withTop);
  const baseTop = sv.evaluate(withTop);
  const ctx = sv.ctx;
  for (let t = 0; t < 52; t++) {
    const u = unseen[t];
    if (!u) continue;
    N += u;
    let v;
    if (!touch.all && !touch.types[t]) {
      const pts = typePts(t);
      const co = ctx.attach[t] ? pts * ctx.risk : pts * (1 - ctx.pSingle[t]);
      const cc = ctx.attach[t] ? pts * ctx.risk : co;
      v = Math.min(baseTop.o + co, baseTop.c + cc);
    } else {
      v = sv.evaluate([...withTop, { id: '?p', ...typeCard(t) }]).v;
    }
    acc += u * v;
  }
  if (unseenJ) { N += unseenJ; acc += unseenJ * sv.evaluate([...withTop, { id: '?pj', suit: 'j', v: 0, j: true }]).v; }
  const vBuy = N ? acc / N : INF;
  return vBuy < pass - F.tune.buyMargin ? { type: 'BUY', idx: seat } : { type: 'SKIP', seat };
}

// The draw phase: the beit only for a certain ant, else the deck.
export function decideDraw(state, seat, budgetMax, tune, diag = null) {
  const F = new Frame(state, seat, budgetMax, tune);
  try { return finish(diag, F, decideDrawIn(F, seat, budgetMax, tune)); }
  catch (e) { if (e !== BUDGET) throw e; return finish(diag, F, { type: 'DRAW' }); }
}

function decideDrawIn(F, seat, budgetMax, tune) {
  const me = F.me();
  const st = F.pub;
  if (st.beit && st.canLay && !me.hasLaid && !onLastCard(me)) {
    const sv = F.solver('ant', { board: F.pub.board, laid: false, now: true });
    if (sv.evaluate([...F.me().hand, F.pub.beit]).o === 0) {
      // Prove it through the reducer before committing to it.
      const took = G(F.pub, { type: 'TAKE_BEIT' });
      if (took.phase === 'action' && took.tookBeit) {
        // Same allowance as the rest of this decision.
        const intents = planTurn(took, seat, budgetMax, tune, null, F.budget);
        const r = applyIntents(took, intents);
        if (r.ok && r.state.phase === 'round_end') return { type: 'TAKE_BEIT' };
      }
    }
  }
  return { type: 'DRAW' };
}
