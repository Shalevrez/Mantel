// ═══════════════════════════════════════════════════════
// CLOUDFLARE WORKER + DURABLE OBJECT
// One Durable Object instance per game room. The Worker
// runs the authoritative game logic (G from game-core),
// holds the real deck, and streams each player a redacted
// view over WebSockets. Players never see each other's
// hands — the server sends opponents as card-backs only.
// ═══════════════════════════════════════════════════════

import {
  G, initGame, cSc, MK,
  aiWantCard, findAIGroups, meetsReq, attachPos, aiDiscard,
} from '../game-core.js';

// ── Room lifetime ────────────────────────────────────
// Nothing ever closed a room: a finished or abandoned game kept its Durable
// Object — and the hands stored inside it — alive forever. These three
// deadlines retire it instead. Whichever comes first wins; see expiryReason.
const MINUTE = 60_000;
const FINISHED_MS =  5 * MINUTE; // game over — long enough to read the final scores
const EMPTY_MS    = 10 * MINUTE; // nobody connected (never started, or everyone left)
const IDLE_MS     = 45 * MINUTE; // connected, but not a single move in all that time

// 4-char room codes, no ambiguous chars (no 0/O/1/I).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// ── Redaction ────────────────────────────────────────
// Build the view a specific seat is allowed to see: own hand
// in full, everyone else's hand replaced by its length only.
export function viewFor(state, seat) {
  if (!state) return null;
  // `undoBefore` is the server's rollback snapshot of the acting player's turn. It
  // carries their entire hand — and, for a beit attempt, the whole deck — so it must
  // never go out on the wire. The client only asks whether an undo is on offer and
  // how big the board was; the board is public.
  const ub = state.undoBefore;
  const undoBefore = ub ? { fromBeit: !!ub.fromBeit, board: ub.board || [] } : null;
  // Selection and staging are the acting player's private working area: which cards
  // they picked up, and the groups they've built but not yet committed.
  const acting = seat === state.cur;
  return {
    ...state,
    // Never leak the deck contents. The beit card itself is public — it's shown
    // face up so everyone can see what's on offer.
    deck: undefined,
    deckCount: state.deck ? state.deck.length : 0,
    beit: state.beit || null,
    beitPresent: !!state.beit,
    undoBefore,
    sel: acting ? (state.sel || []) : [],
    staging: acting ? (state.staging || []) : [],
    players: state.players.map((p, i) => {
      if (i === seat) return { ...p, seat: i, you: true };
      // Opponents: hide hand cards, keep count + public info
      return {
        id: p.id, name: p.name, isAI: p.isAI, seat: i,
        handCount: p.hand.length,
        hasLaid: p.hasLaid, totalScore: p.totalScore,
        lastScore: p.lastScore, you: false,
      };
    }),
  };
}

// ═══════════════════════════════════════════════════════
// ROOM — Durable Object
// ═══════════════════════════════════════════════════════

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;              // authoritative game state (or null pre-start)
    this.seats = [];               // { name, ws, connId, connected, isAI } by seat index
    this.hostConn = null;          // connId of the host (can start / configure)
    this.code = null;
    this.started = false;
    this.sockets = new Map();      // connId -> ws
    this.aiPending = false;        // an AI move is already scheduled (see scheduleAI)
    this.closing = false;          // shutting down — see closeRoom
    this.lastSeen = Date.now();    // last message/connection — the idle clock
    this.emptySince = null;        // when the last socket left (null while someone is on)
    this.endedAt = null;           // when the game reached game_end
  }

  // Persisted load (survives DO eviction)
  async load() {
    if (this._loaded) return;
    const saved = await this.ctx.storage.get('room');
    if (saved) {
      this.state = saved.state;
      this.seats = saved.seats.map(s => ({ ...s, ws: null, connected: false }));
      this.hostConn = saved.hostConn;
      this.code = saved.code;
      this.started = saved.started;
      this.lastSeen = saved.lastSeen || Date.now();
      this.emptySince = saved.emptySince || null;
      this.endedAt = saved.endedAt || null;
    }
    this._loaded = true;
    // Coming back from eviction (or from an alarm) there are no live sockets, so
    // the room counts as empty until one attaches a moment later.
    this.noteConnections();
  }

  async persist() {
    if (this.closing) return;   // never write the room back after it was wiped
    await this.ctx.storage.put('room', {
      state: this.state,
      seats: this.seats.map(s => ({ name: s.name, connId: s.connId, isAI: s.isAI })),
      hostConn: this.hostConn,
      code: this.code,
      started: this.started,
      lastSeen: this.lastSeen,
      emptySince: this.emptySince,
      endedAt: this.endedAt,
    });
  }

  // ── Lifetime bookkeeping ─────────────────────────────
  // Anything that counts as the room being used: a connection, a message, a move.
  touch(now = Date.now()) {
    this.lastSeen = now;
    if (this.state && this.state.phase === 'game_end') {
      if (!this.endedAt) this.endedAt = now;
    } else {
      this.endedAt = null;        // a fresh game revives a room that had finished
    }
  }

  // Keep the "nobody here" clock in step with who is actually connected.
  noteConnections(now = Date.now()) {
    if (this.sockets.size > 0) this.emptySince = null;
    else if (!this.emptySince) this.emptySince = now;
  }

  // Why this room should close right now, or null to keep it.
  expiryReason(now = Date.now()) {
    // A blank object (never created, never joined, or already closed) owns nothing.
    if (!this.code && !this.started && this.seats.length === 0) return null;
    if (this.endedAt && now - this.endedAt >= FINISHED_MS) return 'finished';
    if (this.emptySince && now - this.emptySince >= EMPTY_MS) return 'empty';
    if (now - this.lastSeen >= IDLE_MS) return 'idle';
    return null;
  }

  // The earliest moment any of the three deadlines could come due.
  nextDeadline() {
    if (!this.code && !this.started && this.seats.length === 0) return null;
    let t = this.lastSeen + IDLE_MS;
    if (this.endedAt) t = Math.min(t, this.endedAt + FINISHED_MS);
    if (this.emptySince) t = Math.min(t, this.emptySince + EMPTY_MS);
    return t;
  }

  // Keep an alarm standing for the nearest deadline. An alarm that is already
  // earlier than needed is left alone: it fires, finds nothing due, and re-arms.
  async armAlarm() {
    if (this.closing) return;
    const t = this.nextDeadline();
    if (t == null) return;
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > t) await this.ctx.storage.setAlarm(t);
  }

  // Fired by the deadline set in armAlarm. Survives eviction: the DO is woken
  // up for it, so a room abandoned hours ago still gets cleaned up.
  async alarm() {
    await this.load();
    const reason = this.expiryReason();
    if (reason) return this.closeRoom(reason);
    await this.armAlarm();
  }

  // Say goodbye, hang up, and delete everything this room stored.
  async closeRoom(reason) {
    if (this.closing) return;
    // Hanging up fires each socket's close handler, which would otherwise
    // persist the room again and re-arm an alarm behind our back.
    this.closing = true;
    const bye = JSON.stringify({ t: 'closed', reason });
    for (const ws of this.sockets.values()) {
      // Tell the client first: without this it would just auto-reconnect and
      // land in a brand-new empty room under the same code.
      try { ws.send(bye); } catch {}
      try { ws.close(1000, 'room closed'); } catch {}
    }
    this.sockets.clear();
    this.seats = [];
    this.state = null;
    this.started = false;
    this.hostConn = null;
    this.code = null;
    this.endedAt = null;
    this.emptySince = null;
    this.lastSeen = Date.now();
    // deleteAll() leaves the alarm behind on SQLite-backed Durable Objects, so
    // drop it explicitly — otherwise the empty object wakes itself up again.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // The object itself lives on: whoever dials this code next gets a fresh room.
    this.closing = false;
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const name = url.searchParams.get('name') || 'שחקן';
      const code = url.searchParams.get('code') || '';
      const wantHost = url.searchParams.get('host') === '1';
      this.handleSocket(server, name, code, wantHost);
      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP: create room (host) — assigns a code
    if (url.pathname.endsWith('/create')) {
      if (!this.code) this.code = url.searchParams.get('code') || makeCode();
      this.touch();
      await this.persist();
      // A room nobody ever joins is cleaned up by the same alarm as any other.
      await this.armAlarm();
      return Response.json({ code: this.code });
    }

    return new Response('Room DO', { status: 200 });
  }

  handleSocket(ws, name, code, wantHost) {
    ws.accept();
    const connId = crypto.randomUUID();
    this.sockets.set(connId, ws);

    // Assign / reclaim a seat
    let seat = this.seats.findIndex(s => s.connId === connId);
    if (seat === -1) {
      // Reconnect by name to a disconnected seat, else take a new seat
      seat = this.seats.findIndex(s => s.name === name && !s.connected);
      if (seat === -1 && this.seats.length < 4 && !this.started) {
        seat = this.seats.length;
        this.seats.push({ name, connId, ws, connected: true, isAI: false });
      } else if (seat !== -1) {
        this.seats[seat].connId = connId;
        this.seats[seat].ws = ws;
        this.seats[seat].connected = true;
      }
    }

    if (seat === -1) {
      // Room full or already started with no seat for this player. Drop it from
      // the socket map on the way out, or this dead connection would keep the
      // room looking occupied and it would never hit the empty-room deadline.
      this.sockets.delete(connId);
      ws.send(JSON.stringify({ t: 'error', msg: this.started ? 'המשחק כבר התחיל' : 'החדר מלא (4 שחקנים)' }));
      ws.close(1008, 'no seat');
      return;
    }

    this.seats[seat].ws = ws;
    this.seats[seat].connId = connId;
    this.seats[seat].connected = true;
    if (wantHost && this.hostConn == null) this.hostConn = connId;

    ws.addEventListener('message', (evt) => this.onMessage(connId, seat, evt));
    ws.addEventListener('close', () => this.onClose(connId, seat));
    ws.addEventListener('error', () => this.onClose(connId, seat));

    this.touch();
    this.noteConnections();
    this.persist();
    this.armAlarm();
    this.broadcastLobby();
    if (this.started) this.sendState(seat);
  }

  onClose(connId, seat) {
    this.sockets.delete(connId);
    if (this.closing) return;   // the room is being retired; nothing left to update
    if (this.seats[seat] && this.seats[seat].connId === connId) {
      this.seats[seat].connected = false;
      this.seats[seat].ws = null;
    }
    // The last player leaving starts the empty-room clock.
    this.noteConnections();
    this.persist();
    this.armAlarm();
    this.broadcastLobby();
  }

  // ── Lobby state (pre-game): who's in the room ──
  broadcastLobby() {
    const lobby = {
      t: 'lobby',
      code: this.code,
      started: this.started,
      players: this.seats.map((s, i) => ({
        seat: i, name: s.name, connected: s.connected, isAI: s.isAI,
        host: s.connId === this.hostConn,
      })),
    };
    for (const [connId, ws] of this.sockets) {
      const seat = this.seats.findIndex(s => s.connId === connId);
      try { ws.send(JSON.stringify({ ...lobby, youSeat: seat, youHost: connId === this.hostConn })); } catch {}
    }
  }

  // ── Push redacted state to one seat, or all ──
  sendState(seat) {
    const s = this.seats[seat];
    if (!s || !s.ws || !s.connected) return;
    try { s.ws.send(JSON.stringify({ t: 'state', state: viewFor(this.state, seat) })); } catch {}
  }
  broadcastState() {
    for (let i = 0; i < this.seats.length; i++) this.sendState(i);
  }

  async onMessage(connId, seat, evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    this.touch();

    // ── Host starts the game ──
    if (msg.t === 'start') {
      if (connId !== this.hostConn || this.started) return;
      // Optionally fill empty seats with AI if host requested
      const fillAI = !!msg.fillAI;
      if (fillAI) {
        while (this.seats.length < (msg.minPlayers || 2)) {
          this.seats.push({
            name: `מחשב ${this.seats.length}`, connId: null,
            ws: null, connected: false, isAI: true, ai: 'medium',
          });
        }
      }
      if (this.seats.length < 2) {
        this.seats[seat]?.ws?.send(JSON.stringify({ t: 'error', msg: 'צריך לפחות 2 שחקנים' }));
        return;
      }
      const configs = this.seats.map(s => ({ name: s.name, isAI: s.isAI, ai: s.ai || 'medium' }));
      this.state = initGame(configs);
      this.started = true;
      await this.persist();
      this.broadcastLobby();
      this.broadcastState();
      this.maybeRunAI();
      return;
    }

    // ── A game action ──
    if (msg.t === 'action') {
      if (!this.started || !this.state) return;
      // Only the current player may act (except buying, where the checker acts,
      // and hand arrangement, which every seat may do at any time).
      // The sender's seat is stamped on server-side so a client can never claim
      // another seat's identity by putting `seat` in the payload itself.
      if (!msg.action || typeof msg.action !== 'object') return;
      const action = { ...msg.action, seat };
      if (!this.actionAllowed(seat, action)) return;
      // Last line of defence: one bad message must not kill the room for everyone.
      try { this.state = G(this.state, action); }
      catch (e) { console.error('action failed', action && action.type, e); return; }
      // Re-read the clock against the new state: the move that ends the game
      // starts the countdown to closing the room.
      this.touch();
      await this.persist();
      await this.armAlarm();
      // Hand arrangement changes nothing anyone else can see and never changes
      // whose turn it is: push it back to its owner only, and don't poke the AI
      // (that would queue a second move on top of the one already scheduled).
      if (action.type === 'REORDER' || action.type === 'SORT') {
        this.sendState(seat);
        return;
      }
      this.broadcastState();
      this.maybeRunAI();
      return;
    }
  }

  // ── Authorization: is this seat allowed to take this action now? ──
  actionAllowed(seat, action) {
    const st = this.state;
    if (!st || !action || typeof action.type !== 'string') return false;
    // Server-internal actions, never accepted from a client. The AI_* pair skips the
    // staging/validation path that human actions go through, and __INIT__ would re-deal
    // the entire game from a client-supplied player list.
    if (action.type.startsWith('AI_') || action.type === '__INIT__') return false;
    // Arranging your own hand is private and rule-free: allowed from any seat at
    // any time, including while someone else is playing. The reducer only ever
    // touches `action.seat`'s hand, and that seat was stamped by the server.
    if (action.type === 'REORDER' || action.type === 'SORT')
      return seat >= 0 && seat < st.players.length;
    // Round-end controls: only between rounds. Otherwise any seat could redeal
    // mid-turn, or two clients tapping "next" could skip a mishkakon between them.
    if (['NEW_HAND', 'NEXT_MK', 'GAME_END'].includes(action.type))
      return st.phase === 'round_end';
    // Buying: only the current "checker" seat, and only while buying is actually open.
    // Outside that window these are not merely pointless — SKIP dereferences st.buy and
    // BUY indexes players by a client-supplied idx, so either one crashes the room.
    if (['TAKE_FREE', 'BUY', 'SKIP'].includes(action.type)) {
      if (st.phase !== 'buying' || !st.buy) return false;
      if (action.type === 'BUY') return seat === st.buy.checker && action.idx === seat;
      return seat === st.buy.checker;
    }
    // Everything else: only the player whose turn it is
    return seat === st.cur;
  }

  // ── Server-side AI: drive any AI seat automatically ──
  maybeRunAI() {
    if (!this.state || ['round_end', 'game_end'].includes(this.state.phase)) return;
    const st = this.state;

    // Buying: AI checker
    if (st.phase === 'buying' && st.buy) {
      const checker = this.seats[st.buy.checker];
      if (checker?.isAI) return this.scheduleAI(() => this.aiBuy());
      return;
    }
    const cur = this.seats[st.cur];
    if (!cur?.isAI) return;
    if (st.phase === 'draw') return this.scheduleAI(() => this.aiDraw());
    if (st.phase === 'action') return this.scheduleAI(() => this.aiAction());
  }

  scheduleAI(fn) {
    // small delay so humans see the AI move; DO alarms would be more robust,
    // but a short setTimeout is fine within a single active request lifetime.
    // One at a time: maybeRunAI can be reached more than once for the same AI
    // turn, and without this guard the AI would play its move twice.
    if (this.aiPending) return;
    this.aiPending = true;
    setTimeout(async () => {
      this.aiPending = false;
      try { fn(); this.touch(); await this.persist(); await this.armAlarm(); this.broadcastState(); this.maybeRunAI(); }
      catch (e) { /* swallow */ }
    }, 500 + Math.random() * 400);
  }

  aiBuy() {
    const st = this.state, buy = st.buy;
    const checker = st.players[buy.checker];
    const top = st.discard[st.discard.length - 1];
    if (buy.checker === buy.origNext) {
      const want = top && aiWantCard(checker.hand, top) && (this.seats[buy.checker].ai !== 'easy');
      this.state = G(st, { type: want ? 'TAKE_FREE' : 'SKIP' });
    } else {
      const want = top && aiWantCard(checker.hand, top) && Math.random() > 0.55;
      this.state = G(st, { type: want ? 'BUY' : 'SKIP', idx: buy.checker });
    }
  }

  aiDraw() {
    this.state = G(this.state, { type: 'DRAW' });
  }

  aiAction() {
    const st = this.state;
    const cur = st.players[st.cur];
    if (!st.canLay) { this.state = G(st, { type: 'DISCARD', cid: aiDiscard(cur.hand).id }); return; }
    if (!cur.hasLaid) {
      const { groups } = findAIGroups(cur.hand);
      const usedIds = new Set(groups.flatMap(g => g.cards.map(c => c.id)));
      const spares = cur.hand.filter(c => !usedIds.has(c.id));
      if (meetsReq(groups, st.mk) && spares.length >= 1) {
        // AI_LAY re-validates against the real hand and may refuse, returning the
        // state untouched. Fall through to a discard rather than spinning on it.
        const laid = G(st, { type: 'AI_LAY', groups });
        if (laid !== st) { this.state = laid; return; }
      }
      this.state = G(st, { type: 'DISCARD', cid: aiDiscard(cur.hand).id }); return;
    }
    if (cur.hand.length >= 2) {
      for (const c of cur.hand)
        for (const g of st.board)
          if (attachPos(g.cards, c)) { this.state = G(st, { type: 'AI_ATTACH', cid: c.id, gid: g.id }); return; }
    }
    this.state = G(st, { type: 'DISCARD', cid: aiDiscard(cur.hand).id });
  }
}

// ═══════════════════════════════════════════════════════
// WORKER ENTRY — routes requests to the right Room DO
// ═══════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API routes under /api/*
    if (url.pathname.startsWith('/api/')) {
      // Create a new room: server picks a code, returns it
      if (url.pathname === '/api/new') {
        const code = makeCode();
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        const r = await stub.fetch(new Request(`https://do/create?code=${code}`));
        return withCors(r);
      }
      // WebSocket join: /api/room?code=XXXX&name=...&host=0|1
      if (url.pathname === '/api/room') {
        const code = (url.searchParams.get('code') || '').toUpperCase();
        if (!code) return withCors(new Response('missing code', { status: 400 }));
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        return stub.fetch(request);
      }
      return withCors(new Response('not found', { status: 404 }));
    }

    // Everything else → static assets (the built client)
    return env.ASSETS.fetch(request);
  },
};

function withCors(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}
