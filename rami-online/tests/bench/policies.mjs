// ═══════════════════════════════════════════════════════
// AI POLICIES for the benchmark — each turns (state, seat) into the next state.
//
//   hard    the new engine (src/ai/hard.js), exactly as the room calls it
//   legacy  the hard level as it was before the engine: a verbatim copy of
//           the room's old aiBuy / aiDraw / aiAction for 'hard'
//   medium, easy  the unchanged levels, through the same old code path
//
// Every policy is instrumented: decision time, refused moves, fallbacks.
// ═══════════════════════════════════════════════════════
import {
  G, meetsReq, attachPos, aiWantCard, findAIGroups, aiDiscard,
} from '../../src/game-core.js';
import { decideBuy, decideDraw, planTurn, applyIntents, lastWork } from '../../src/ai/hard.js';

export function newStats() {
  return { decisions: 0, ms: 0, maxMs: 0, byKind: {}, refused: 0, fallbacks: 0 };
}
function timed(stats, kind, fn) {
  lastWork.budget = null;
  const t0 = performance.now();
  const r = fn();
  const dt = performance.now() - t0;
  stats.decisions++; stats.ms += dt; if (dt > stats.maxMs) stats.maxMs = dt;
  (stats.samples ||= []).push(dt);
  const k = stats.byKind[kind] ||= { n: 0, ms: 0, max: 0 };
  k.n++; k.ms += dt; if (dt > k.max) k.max = dt;
  if (stats.track) { const n = lastWork.nodes; k.nodes = (k.nodes || 0) + n; k.maxNodes = Math.max(k.maxNodes || 0, n); }
  return r;
}

// ── The old code, verbatim (lv = the seat's level) ──
function antReadyWithBeit(st, seat) {
  const took = G(st, { type: 'TAKE_BEIT' });
  if (took === st || took.phase !== 'action') return false;
  const { groups } = findAIGroups(took.players[seat].hand);
  const laid = G(took, { type: 'AI_LAY', groups });
  if (laid === took || laid.players[seat].hand.length !== 1) return false;
  const done = G(laid, { type: 'DISCARD', cid: laid.players[seat].hand[0].id });
  return done.phase === 'round_end' || done.phase === 'game_end';
}
export function oldBuy(st, seat, lv, rnd = Math.random) {
  const hand = st.players[seat].hand;
  const top = st.discard[st.discard.length - 1];
  if (seat === st.buy.origNext) {
    const want = !!top && aiWantCard(hand, top, lv) && (lv !== 'easy' || rnd() > 0.25);
    return G(st, want ? { type: 'TAKE_FREE' } : { type: 'SKIP', seat });
  }
  const odds = lv === 'hard' ? 0.2 : lv === 'medium' ? 0.3 : 1;
  const want = !!top && aiWantCard(hand, top, lv, { costly: true }) && rnd() > odds;
  return G(st, want ? { type: 'BUY', idx: seat } : { type: 'SKIP', seat });
}
export function oldDraw(st, seat, lv) {
  if (lv === 'hard' && st.beit && st.canLay && !st.players[seat].hasLaid && antReadyWithBeit(st, seat))
    return G(st, { type: 'TAKE_BEIT' });
  return G(st, { type: 'DRAW' });
}
export function oldAction(st, seat, lv, rnd = Math.random) {
  if (st.tookBeit) {
    const { groups } = findAIGroups(st.players[seat].hand);
    const laid = G(st, { type: 'AI_LAY', groups });
    return (laid !== st && laid.players[seat].hand.length === 1)
      ? G(laid, { type: 'DISCARD', cid: laid.players[seat].hand[0].id })
      : G(st, { type: 'UNDO' });
  }
  if (st.canLay && !st.players[seat].hasLaid) {
    const { groups, unused } = findAIGroups(st.players[seat].hand);
    const chasingAnt = lv === 'hard' && unused.length >= 2 && unused.length <= 3;
    if (meetsReq(groups, st.mk) && unused.length >= 1 && !chasingAnt) {
      const laid = G(st, { type: 'AI_LAY', groups });
      if (laid !== st) st = laid;
    }
  }
  if (st.players[seat].hasLaid && lv !== 'easy') {
    const passes = lv === 'hard' ? 14 : lv === 'medium' ? 8 : 1;
    for (let i = 0; i < passes; i++) {
      const before = st;
      for (const c of st.players[seat].hand) {
        let placed = false;
        for (const g of st.board) {
          if (!attachPos(g.cards, c)) continue;
          const next = G(st, { type: 'AI_ATTACH', cid: c.id, gid: g.id });
          if (next !== st) { st = next; placed = true; break; }
        }
        if (placed) break;
      }
      if (st === before) break;
    }
  }
  const hand = st.players[seat].hand;
  return G(st, { type: 'DISCARD', cid: aiDiscard(hand, lv, rnd, st.board).id });
}

// ── Policies ──
export function makePolicy(name, opts = {}) {
  const stats = newStats();
  if (name === 'hard') {
    stats.track = true;
    const budget = opts.budget, tune = opts.tune;
    const guard = (fallback, fn) => { try { return fn(); } catch (e) { stats.fallbacks++; if (opts.loud) console.error(e); return fallback(); } };
    return {
      name, stats,
      buy: (st, seat) => timed(stats, seat === st.buy.origNext ? 'take' : 'buy', () => guard(() => oldBuy(st, seat, 'hard'), () => G(st, decideBuy(st, seat, budget, tune)))),
      draw: (st, seat) => timed(stats, 'draw', () => guard(() => oldDraw(st, seat, 'hard'), () => G(st, decideDraw(st, seat, budget, tune)))),
      // Mirrors the room: a failed turn finishes with the medium routine.
      turn: (st, seat) => timed(stats, 'turn', () => guard(() => oldAction(st, seat, st.tookBeit ? 'hard' : 'medium'), () => {
        const r = applyIntents(st, planTurn(st, seat, budget, tune));
        if (r.ok && r.state.phase !== 'action') return r.state;
        stats.refused++;
        return oldAction(r.state, seat, r.state.tookBeit ? 'hard' : 'medium');
      })),
    };
  }
  const lv = name === 'legacy' ? 'hard' : name;
  return {
    name, stats,
    buy: (st, seat) => timed(stats, 'buy', () => oldBuy(st, seat, lv)),
    draw: (st, seat) => timed(stats, 'draw', () => oldDraw(st, seat, lv)),
    turn: (st, seat) => timed(stats, 'turn', () => oldAction(st, seat, lv)),
  };
}
