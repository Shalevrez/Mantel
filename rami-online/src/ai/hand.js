// ═══════════════════════════════════════════════════════
// HAND SOLVER — the core of the hard computer player.
//
// Pure, deterministic, no game state: it sees a multiset of cards and a
// context (what the table makes possible, how much time is probably left in
// the round, which cards are still unseen) and answers "what is this hand
// worth, and how should it be split up?".
//
// A hand is kept as counts per card type (52 types + a joker count), so the
// duplicate physical cards of a two- or three-deck game are the same thing to
// it — two 7♥ are simply "7♥ ×2". The solver splits the hand into items:
//
//   meld     a complete sequence or set (jokers allowed)
//   partial  two real cards one card short of a meld (a pair of a value, or
//            two cards of a suit next to / one apart from each other)
//   single   a card on its own (it may still attach to the board)
//
// Every item has a cost: the penalty points it is expected to leave in the
// hand when the round ends. A meld that will be laid costs nothing; a partial
// costs its points times the chance it never completes, which comes from how
// many of its completing cards are still unseen and how long the round is
// expected to last. The best split is the one with the lowest total — found
// exactly by a memoized depth-first search over "the first card left".
//
// The opening requirement (the mishkakon's N sequences of length ≥ min) is
// part of the search: it tracks how many qualifying sequences the split
// already has. Two answers come back for every hand:
//   o (open)   — the hand opens now and lays its melds
//   c (closed) — it keeps everything in hand (not able, or not willing, to open)
//
// Strict modes answer yes/no questions exactly ("can this hand go out this
// turn?", "can it go out as an ant?") with the same search.
//
// Work is bounded by a node budget shared by the whole decision; when it runs
// out the search throws BUDGET and the caller falls back to a cheaper move.
// ═══════════════════════════════════════════════════════

export const INF = 1e9;
export const BUDGET = new Error('ai budget exhausted');

// ── Card types ───────────────────────────────────────
// type = suit*13 + rank, rank 0..11 = values 2..K, rank 12 = ace. Putting the
// ace last in its suit is what lets the search treat it as either end of a run.
export const SUIT_IDX = { h: 0, d: 1, c: 2, s: 3 };
export const SUIT_OF = ['h', 'd', 'c', 's'];
export const typeOf = c => SUIT_IDX[c.suit] * 13 + (c.v === 1 ? 12 : c.v - 2);
export const typeValue = t => { const r = t % 13; return r === 12 ? 1 : r + 2; };
export const typePts = t => { const r = t % 13; return r >= 8 ? 10 : r + 2; };
// The type sitting at run position `pos` (1..14) of suit `si`; 1 and 14 are both the ace.
export const posType = (si, pos) => si * 13 + (pos === 1 || pos === 14 ? 12 : pos - 2);
export const typeCard = t => ({ suit: SUIT_OF[(t / 13) | 0], v: typeValue(t), j: false });

// ── Zobrist hashing (deterministic) ──────────────────
let seed = 0x9e3779b9;
const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
const ZA = new Uint32Array(52 * 8), ZB = new Uint32Array(52 * 8);
for (let i = 0; i < ZA.length; i++) { if (i % 8) { ZA[i] = rnd32(); ZB[i] = rnd32(); } }
const ZJA = new Uint32Array(32), ZJB = new Uint32Array(32);
for (let i = 1; i < 32; i++) { ZJA[i] = rnd32(); ZJB[i] = rnd32(); }
const ZQA = new Uint32Array(64), ZQB = new Uint32Array(64);
for (let i = 0; i < 64; i++) { ZQA[i] = rnd32(); ZQB[i] = rnd32(); }

// ── Context ──────────────────────────────────────────
// Everything about the table the costs depend on. Built once per decision (or
// per board state inside one) and shared by every hand evaluated under it, so
// the memo carries over between "this hand minus the 7" and "minus the 9".
//
//   need     qualifying sequences still to lay (0 once opened)
//   min      their minimum length
//   openOK   opening (or, if already open, laying) is possible in the frame
//            being evaluated
//   layNow   melds in the "open" answer leave the hand this very turn
//   s        chance the round survives until this player's next turn
//   unseen   per type, copies not visible anywhere (hand, board, pile, beit,
//            cards an opponent is known to hold); unseenJ for jokers
//   attach   per type, 1 if such a card attaches to a board group now
//   attachJ  a joker attaches somewhere now
//   slotCost cost of an opening sequence that is still missing entirely
export function makeCtx(o) {
  const s = Math.min(0.97, Math.max(0.05, o.s ?? 0.85));
  const unseen = o.unseen || new Int16Array(52);
  const unseenJ = o.unseenJ || 0;
  let N = unseenJ;
  for (let t = 0; t < 52; t++) N += unseen[t];
  const A = o.access ?? 1.35;    // useful cards seen per turn: the draw, plus a share of discards
  const pTab = new Float64Array(80);
  for (let L = 0; L < 80; L++) {
    if (!N || !L) { pTab[L] = 0; continue; }
    const q = 1 - Math.pow(Math.max(0, 1 - L / N), A);
    // Turns until the round ends are geometric with continuation s; this is
    // E[1 - (1-q)^T] in closed form: the chance one of the outs shows up in time.
    pTab[L] = (s * q) / (1 - s + s * q);
  }
  const ctx = {
    need: o.need | 0, min: o.min || 3, openOK: !!o.openOK, layNow: !!o.layNow,
    s, risk: 1 - s, unseen, unseenJ, N, pTab,
    attach: o.attach || new Uint8Array(52), attachJ: !!o.attachJ,
    slotCost: o.slotCost ?? 30,
    jflex: o.jflex ?? 10 * s * 0.12,     // a joker spent in a meld can't fix a later problem
    jkeep: o.jkeep ?? 10 * (1 - s) * 0.8, // a joker held is only points at risk
    jatt: o.jatt ?? 10 * s * 0.15,       // attaching a spare joker gives up that flexibility
    pSingle: new Float64Array(52),
  };
  // A lone card needs a partner and then a third card (or a joker): two
  // completions in a row, so it rarely comes good.
  for (let t = 0; t < 52; t++) {
    const si = (t / 13) | 0, v = typeValue(t);
    let outs = unseenJ;
    for (let sj = 0; sj < 4; sj++) if (sj !== si) outs += unseen[sj * 13 + (t % 13)];
    for (const pos of v === 1 ? [2, 3, 12, 13] : [v - 2, v - 1, v + 1, v + 2]) {
      if (pos >= 1 && pos <= 14) outs += unseen[posType(si, pos)];
    }
    ctx.pSingle[t] = pOut(ctx, outs) * pOut(ctx, 4) * 0.8;
  }
  return ctx;
}

export const pOut = (ctx, L) => ctx.pTab[Math.max(0, Math.min(79, Math.round(L)))];

// Chance a sequence `k` cards short of the minimum gets there in time.
function pNeed(ctx, outs, k) {
  if (k <= 0) return 1;
  let p = pOut(ctx, outs);
  if (k >= 2) p *= pOut(ctx, outs * 0.6);
  if (k >= 3) p *= pOut(ctx, outs * 0.4);
  return p;
}

// ── The solver ───────────────────────────────────────
// mode: 'eval' — expected penalty (o / c answers)
//       'out'  — 0 if the hand can be laid / attached completely except one
//                card (the discard), INF otherwise
//       'ant'  — the same, without attaching, as the first lay of the round
//
// Built to allocate nothing per search node: the moves for the first card
// left are written into typed buffers (one set per depth), applied, searched
// and undone; memo values sit in typed arrays.
const K_SINGLE = 0, K_ATTACH = 1, K_FREE = 2, K_SET = 3, K_SEQ = 4, K_PARTIAL = 5;
const KIND_NAMES = ['single', 'attach', 'free', 'set', 'seq', 'partial'];
const CAP = 384;   // moves per node, far above what a hand produces
const MT = 14;     // real cards per move

class Moves {
  constructor() {
    this.n = 0;
    this.types = new Int8Array(CAP * MT);
    this.nt = new Uint8Array(CAP);
    this.j = new Uint8Array(CAP);
    this.co = new Float64Array(CAP);
    this.cc = new Float64Array(CAP);
    this.qr = new Uint8Array(CAP);
    this.qs = new Uint8Array(CAP);
    this.f = new Uint8Array(CAP);
    this.kind = new Uint8Array(CAP);
  }
}

export class Solver {
  constructor(ctx, mode = 'eval', budget = { n: 0, max: Infinity }) {
    this.ctx = ctx;
    this.mode = mode;
    this.strict = mode !== 'eval';
    this.isOut = mode === 'out';
    this.budget = budget;
    this.memo = new Map();
    this.mo = new Float64Array(4096);
    this.mc = new Float64Array(4096);
    this.size = 0;
    this.cnt = new Int8Array(52);
    this.J = 0;
    this.h1 = 0; this.h2 = 0;
    this.lite = false;
    this.bufs = [];
    this.ro = 0; this.rc = 0;   // the last dfs answer
    this.tmp = new Int8Array(16);
  }

  setHand(cards) {
    // A very big hand (several buys) drops the "one short of a qualifying
    // run" variants: they multiply the search, and such a hand is far from
    // opening anyway. The flag is part of the memo key.
    this.lite = cards.length > 19;
    this.cnt.fill(0);
    this.J = 0; this.h1 = 0; this.h2 = 0;
    for (const c of cards) {
      if (c.j) this.addJ(1);
      else this.inc(typeOf(c));
    }
  }

  inc(t) { const i = t * 8 + this.cnt[t]; this.h1 ^= ZA[i] ^ ZA[i + 1]; this.h2 ^= ZB[i] ^ ZB[i + 1]; this.cnt[t]++; }
  dec(t) { const i = t * 8 + this.cnt[t]; this.h1 ^= ZA[i] ^ ZA[i - 1]; this.h2 ^= ZB[i] ^ ZB[i - 1]; this.cnt[t]--; }
  addJ(d) { this.h1 ^= ZJA[this.J]; this.h2 ^= ZJB[this.J]; this.J += d; this.h1 ^= ZJA[this.J]; this.h2 ^= ZJB[this.J]; }

  key(qr, qs, f) {
    const q = qr * 9 + qs * 3 + f + (this.lite ? 27 : 0);
    return ((this.h1 ^ ZQA[q]) >>> 0) * 1048576 + ((this.h2 ^ ZQB[q]) & 0xfffff);
  }

  // Root answers for the hand currently loaded: { o, c, v }.
  solve() {
    this.dfs(0, 0, 0, 0);
    return { o: this.ro, c: this.rc, v: Math.min(this.ro, this.rc) };
  }

  evaluate(cards) { this.setHand(cards); return this.solve(); }

  first() { const cnt = this.cnt; for (let i = 0; i < 52; i++) if (cnt[i]) return i; return -1; }

  apply(m, i) { const b = i * MT; for (let k = 0; k < m.nt[i]; k++) this.dec(m.types[b + k]); if (m.j[i]) this.addJ(-m.j[i]); }
  undo(m, i) { if (m.j[i]) this.addJ(m.j[i]); const b = i * MT; for (let k = m.nt[i] - 1; k >= 0; k--) this.inc(m.types[b + k]); }

  dfs(qr, qs, f, depth) {
    const key = this.key(qr, qs, f);
    const hit = this.memo.get(key);
    if (hit !== undefined) { this.ro = this.mo[hit]; this.rc = this.mc[hit]; return; }
    if (++this.budget.n > this.budget.max) throw BUDGET;
    const t = this.first();
    let bo, bc;
    if (t < 0 && !this.J) {
      this.leaf(qr, qs, f);
      bo = this.ro; bc = this.rc;
    } else {
      const m = this.bufs[depth] || (this.bufs[depth] = new Moves());
      this.gen(t, qr, qs, f, m);
      bo = INF; bc = INF;
      const n = m.n;
      for (let i = 0; i < n; i++) {
        const co = m.co[i], cc = m.cc[i];
        if (co >= INF && cc >= INF) continue;
        this.apply(m, i);
        this.dfs(m.qr[i], m.qs[i], m.f[i], depth + 1);
        this.undo(m, i);
        const o = co + this.ro, c = cc + this.rc;
        if (o < bo) bo = o;
        if (c < bc) bc = c;
      }
      if (bo > INF) bo = INF;
      if (bc > INF) bc = INF;
    }
    if (this.size === this.mo.length) {
      const o2 = new Float64Array(this.size * 2); o2.set(this.mo); this.mo = o2;
      const c2 = new Float64Array(this.size * 2); c2.set(this.mc); this.mc = c2;
    }
    this.mo[this.size] = bo; this.mc[this.size] = bc;
    this.memo.set(key, this.size++);
    this.ro = bo; this.rc = bc;
  }

  leaf(qr, qs, f) {
    const ctx = this.ctx;
    if (this.strict) {
      // Exactly the cards to throw (normally one) may be left over.
      this.ro = qr >= ctx.need && f === (ctx.freeNeed ?? 1) && ctx.openOK ? 0 : INF;
      this.rc = INF;
      return;
    }
    this.ro = qr >= ctx.need && ctx.openOK ? 0 : INF;
    // Already open: there is no "closed" way to hold the hand.
    this.rc = ctx.need === 0 ? INF : (ctx.need - qs) * ctx.slotCost;
  }

  push(m, kind, nt, j, co, cc, qr, qs, f) {
    const i = m.n++;
    const b = i * MT, tmp = this.tmp;
    for (let k = 0; k < nt; k++) m.types[b + k] = tmp[k];
    m.nt[i] = nt; m.j[i] = j; m.co[i] = co; m.cc[i] = cc;
    m.qr[i] = qr; m.qs[i] = qs; m.f[i] = f; m.kind[i] = kind;
  }

  // A meld's cost under each answer.
  meldCo(pts, jm) { const c = this.ctx; return this.strict ? 0 : (c.layNow ? 0 : pts * c.risk) + jm * c.jflex; }
  meldCc(pts, jm) { const c = this.ctx; return this.strict ? INF : pts * c.risk + jm * c.jflex; }

  extOuts(si, lo, hi, k) {
    const ctx = this.ctx;
    let o = ctx.unseenJ;
    for (let d = 1; d <= k; d++) {
      if (lo - d >= 1) o += ctx.unseen[posType(si, lo - d)];
      if (hi + d <= 14) o += ctx.unseen[posType(si, hi + d)];
    }
    return o;
  }

  // Writes every way the first card left (type t; -1 = only jokers left) can
  // be used into `m`. this.tmp carries the item's real card types to push().
  gen(t, qr, qs, f, m) {
    m.n = 0;
    const ctx = this.ctx, cnt = this.cnt, strict = this.strict, tmp = this.tmp;
    const need = ctx.need, min = ctx.min;

    if (t < 0) {
      // Only jokers left: each is a single.
      if (strict) {
        if (this.isOut && ctx.attachJ) this.push(m, K_ATTACH, 0, 1, 0, INF, qr, qs, f);
        if (f === 0) this.push(m, K_FREE, 0, 1, 0, INF, qr, qs, 1);
      } else {
        const att = ctx.layNow && ctx.attachJ && ctx.jatt < ctx.jkeep;
        this.push(m, att ? K_ATTACH : K_SINGLE, 0, 1, att ? ctx.jatt : ctx.jkeep, ctx.jkeep, qr, qs, f);
      }
      return;
    }

    const si = (t / 13) | 0, r = t % 13;
    const pts0 = typePts(t);
    const J = this.J;

    // ── 1. On its own ──
    tmp[0] = t;
    if (strict) {
      if (this.isOut && ctx.attach[t]) this.push(m, K_ATTACH, 1, 0, 0, INF, qr, qs, f);
      if (f === 0) this.push(m, K_FREE, 1, 0, 0, INF, qr, qs, 1);
    } else if (ctx.attach[t]) {
      this.push(m, K_ATTACH, 1, 0, ctx.layNow ? 0 : pts0 * ctx.risk, pts0 * ctx.risk, qr, qs, f);
    } else {
      const c1 = pts0 * (1 - ctx.pSingle[t]);
      this.push(m, K_SINGLE, 1, 0, c1, c1, qr, qs, f);
    }

    // ── 2. Sets: same rank, other suits (only later suits can still hold one) ──
    let no = 0;
    const oth0 = si + 1;
    const others = [-1, -1, -1];
    for (let sj = oth0; sj < 4; sj++) if (cnt[sj * 13 + r]) others[no++] = sj * 13 + r;
    for (let mask = 1; mask < (1 << no); mask++) {
      let nt = 1, pts = pts0;
      tmp[0] = t;
      for (let k = 0; k < no; k++) if (mask & (1 << k)) { tmp[nt++] = others[k]; pts += typePts(others[k]); }
      // Jokers only ever top a set up to three: a fourth card adds nothing a
      // later attach couldn't, and keeps a joker out of better uses.
      const jmax = Math.min(J, Math.max(0, 3 - nt));
      for (let j = 0; j <= jmax; j++) {
        const size = nt + j;
        if (size >= 3) {
          this.push(m, K_SET, nt, j, this.meldCo(pts + 10 * j, j), this.meldCc(pts + 10 * j, j), qr, qs, f);
        } else if (size === 2 && !strict) {
          // A pair of a rank: any unseen card of a missing suit completes it.
          let outs = ctx.unseenJ;
          const ps = (tmp[1] / 13) | 0;
          for (let sk = 0; sk < 4; sk++) if (sk !== si && sk !== ps) outs += ctx.unseen[sk * 13 + r];
          const c = pts * (1 - pOut(ctx, outs));
          this.push(m, K_PARTIAL, 2, 0, c, c, qr, qs, f);
        }
      }
    }

    // ── 3. Sequences in which this card is the lowest real card ──
    if (r === 12) {
      // An ace that is the first card left: the rest of its suit is gone, so a
      // run can only be the ace plus jokers.
      tmp[0] = t;
      const emax = Math.min(J, 12, Math.max(2, (qr < need ? min : 3) - 1));
      for (let e = 2; e <= emax; e++) this.seqMove(m, si, 1, 1, 1, e, false, qr, qs, f);
      return;
    }
    const v = r + 2;
    const aceT = si * 13 + 12;
    // Extra jokers on the ends are only worth it to reach a legal length or
    // the opening minimum; beyond that they are better kept.
    const want = qr < need ? Math.max(3, min) : 3;
    for (let variant = 0; variant < 2; variant++) {
      const lowAce = variant === 1;
      if (lowAce && !(cnt[aceT] && v - 2 <= J)) continue;
      // Real cards collected so far live in a local list; the span walk.
      const reals = lowAce ? [aceT, t] : [t];
      const lo = lowAce ? 1 : v;
      let gaps = lowAce ? v - 2 : 0;
      let hi = v;
      for (let p = v; p <= 14; p++) {
        if (p > v) {
          if (p - hi - 1 + gaps > J) break;
          if (p === 14 && lowAce) break;
          const ty = posType(si, p);
          if (!cnt[ty]) continue;
          gaps += p - hi - 1;
          hi = p;
          reals.push(ty);
        }
        // A span: the real cards lo..hi, plus e extra jokers on the ends.
        const span = hi - lo + 1;
        const room = lo === 1 ? 13 - hi : hi === 14 ? lo - 2 : (lo - 1) + (14 - hi);
        const nt = reals.length;
        for (let k = 0; k < nt; k++) tmp[k] = reals[k];
        for (let e = 0; gaps + e <= J && e <= room; e++) {
          const len = span + e;
          if (len < 3) continue;
          if (len > 13 || (e > 0 && len > want)) break;
          this.seqMove(m, si, lo, hi, nt, gaps + e, false, qr, qs, f);
        }
        // Two real cards only, without jokers: a partial run.
        if (!strict && nt === 2 && span <= 3 && !lowAce) this.seqMove(m, si, lo, hi, 2, 0, true, qr, qs, f);
      }
    }
    // Ace-low partials (A2, A3) with the ace held for position 1.
    if (!strict && cnt[aceT] && v <= 3) {
      tmp[0] = aceT; tmp[1] = t;
      this.seqMove(m, si, 1, v, 2, 0, true, qr, qs, f);
    }
  }

  // A run (or partial run) whose real cards are in tmp[0..nt).
  seqMove(m, si, lo, hi, nt, jm, partial, qr, qs, f) {
    const ctx = this.ctx, tmp = this.tmp, need = ctx.need, min = ctx.min;
    let pts = 10 * jm;
    for (let k = 0; k < nt; k++) pts += typePts(tmp[k]);
    if (partial) {
      const gap = hi - lo - 1;
      const outs = gap === 1 ? ctx.unseenJ + ctx.unseen[posType(si, lo + 1)] : this.extOuts(si, lo, hi, 1);
      const p = pOut(ctx, outs);
      const c = pts * (1 - p);
      this.push(m, K_PARTIAL, nt, 0, c, c, qr, qs, f);
      if (qs < need && !this.lite) {
        const k = min - 2;
        const pk = k <= 1 ? p : p * pNeed(ctx, this.extOuts(si, lo, hi, k), k - 1);
        this.push(m, K_PARTIAL, nt, 0, c, c + (1 - pk) * ctx.slotCost, qr, qs + 1, f);
      }
      return;
    }
    const L = nt + jm;
    const co = this.meldCo(pts, jm), cc = this.meldCc(pts, jm);
    if (L >= min) {
      const q1 = qr < need ? qr + 1 : qr, q2 = qs < need ? qs + 1 : qs;
      this.push(m, K_SEQ, nt, jm, co, cc, q1, q2 > q1 ? q2 : q1, f);
    } else {
      this.push(m, K_SEQ, nt, jm, co, cc, qr, qs, f);
      if (qs < need && !this.strict && !this.lite) {
        const k = min - L;
        this.push(m, K_SEQ, nt, jm, co, cc + (1 - pNeed(ctx, this.extOuts(si, lo, hi, k), k)) * ctx.slotCost, qr, qs + 1, f);
      }
    }
  }

  // Rebuilds the split behind the root answer `which` ('o' or 'c'). Returns
  // a list of items { kind, types, jokers } and leaves the hand reloaded.
  plan(which, cards) {
    this.setHand(cards);
    this.dfs(0, 0, 0, 0);
    let target = which === 'o' ? this.ro : this.rc;
    if (target >= INF) return null;
    const items = [];
    let qr = 0, qs = 0, f = 0;
    const m = new Moves();
    for (let guard = 0; guard < 64; guard++) {
      const t = this.first();
      if (t < 0 && !this.J) break;
      this.gen(t, qr, qs, f, m);
      let found = false;
      for (let i = 0; i < m.n; i++) {
        const cost = which === 'o' ? m.co[i] : m.cc[i];
        if (cost >= INF) continue;
        this.apply(m, i);
        this.dfs(m.qr[i], m.qs[i], m.f[i], 1);
        const child = which === 'o' ? this.ro : this.rc;
        if (Math.abs(cost + child - target) <= 1e-7 * Math.max(1, Math.abs(target))) {
          const types = [];
          for (let k = 0; k < m.nt[i]; k++) types.push(m.types[i * MT + k]);
          items.push({ kind: KIND_NAMES[m.kind[i]], types, jokers: m.j[i] });
          target = child; qr = m.qr[i]; qs = m.qs[i]; f = m.f[i];
          found = true;
          break;
        }
        this.undo(m, i);
      }
      if (!found) { this.setHand(cards); return null; }
    }
    this.setHand(cards);
    return items;
  }
}

// Turns a split back into the actual cards of the hand: real cards by type
// (any copy will do), jokers handed out in order.
export function bindPlan(items, cards) {
  const pool = new Map();
  const jokers = [];
  for (const c of cards) {
    if (c.j) { jokers.push(c); continue; }
    const t = typeOf(c);
    if (!pool.has(t)) pool.set(t, []);
    pool.get(t).push(c);
  }
  return items.map(it => {
    const out = [];
    for (const t of it.types) out.push(pool.get(t).pop());
    for (let k = 0; k < it.jokers; k++) out.push(jokers.pop());
    return { kind: it.kind, cards: out };
  });
}
