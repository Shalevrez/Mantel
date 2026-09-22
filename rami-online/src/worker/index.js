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

// How long the host keeps the crown after their connection drops. A refresh,
// a phone locking itself or a flaky network all look like a disconnect, so the
// room waits this long before handing the game to somebody else.
const HOST_GRACE_MS = 60000;

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
    this.seats = [];               // { name, uid, ws, connId, connected, isAI } by seat index
    // The host is identified by `uid` — the player's own id, which survives a
    // reconnect — and never by connId, which is minted fresh for every socket.
    this.hostUid = null;
    this.code = null;
    this.started = false;
    this.sockets = new Map();      // connId -> ws
    this.aiPending = false;        // an AI move is already scheduled (see scheduleAI)
  }

  // Persisted load (survives DO eviction)
  async load() {
    if (this._loaded) return;
    const saved = await this.ctx.storage.get('room');
    if (saved) {
      this.state = saved.state;
      // Nobody is connected right after an eviction, but the seats themselves
      // (and who owns them) are exactly as they were — so a returning player,
      // host included, is recognised rather than seated as someone new. They all
      // count as "just dropped", which starts the host's grace period from the
      // moment the room woke up instead of from a stale (or zero) timestamp.
      this.seats = saved.seats.map(s => ({ ...s, ws: null, connected: false, downAt: Date.now() }));
      this.hostUid = saved.hostUid || null;
      this.code = saved.code;
      this.started = saved.started;
    }
    this._loaded = true;
  }

  async persist() {
    await this.ctx.storage.put('room', {
      state: this.state,
      seats: this.seats.map(s => ({
        name: s.name, uid: s.uid, connId: s.connId,
        isAI: s.isAI, ai: s.ai, downAt: s.downAt || 0,
      })),
      hostUid: this.hostUid,
      code: this.code,
      started: this.started,
    });
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
      const pid = url.searchParams.get('pid') || '';
      this.handleSocket(server, name, code, wantHost, pid);
      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP: create room (host) — assigns a code
    if (url.pathname.endsWith('/create')) {
      if (!this.code) this.code = url.searchParams.get('code') || makeCode();
      await this.persist();
      return Response.json({ code: this.code });
    }

    return new Response('Room DO', { status: 200 });
  }

  handleSocket(ws, name, code, wantHost, pid) {
    ws.accept();
    const connId = crypto.randomUUID();
    this.sockets.set(connId, ws);

    // Who this is, across connections. `connId` is a brand-new UUID on every
    // socket, so it can only answer "which pipe is this" — never "which player".
    // The client's own id does that; older clients that don't send one fall back
    // to the name, which is what seat reclaim keyed on before.
    const uid = pid ? `pid:${pid}` : `name:${name}`;

    // Reclaim first: a player who refreshed, lost the network or closed the
    // browser and came back is the same player, and gets their seat (and, if it
    // was theirs, the host role) back.
    let seat = this.seats.findIndex(s => !s.isAI && s.uid === uid);
    // Older clients that reconnect without an id still match by name.
    if (seat === -1) seat = this.seats.findIndex(s => !s.isAI && s.name === name && !s.connected);

    if (seat === -1) {
      if (this.seats.length >= 4 || this.started) {
        // Room full or already started with no seat for this player
        ws.send(JSON.stringify({ t: 'error', msg: this.started ? 'המשחק כבר התחיל' : 'החדר מלא (4 שחקנים)' }));
        ws.close(1008, 'no seat');
        return;
      }
      seat = this.seats.length;
      this.seats.push({ name, uid, connId, ws, connected: true, isAI: false, downAt: 0 });
    } else {
      // Same player on a new socket: drop the old one so a seat never has two
      // live connections (a stale socket would otherwise keep "answering" for it).
      const prev = this.seats[seat];
      if (prev.connId && prev.connId !== connId) this.dropSocket(prev.connId);
      prev.uid = uid;
      prev.name = name;
      prev.downAt = 0;
    }

    this.seats[seat].ws = ws;
    this.seats[seat].connId = connId;
    this.seats[seat].connected = true;
    // First player to ask for it owns the room. Afterwards the crown follows the
    // uid, so reconnecting never has to re-claim it.
    if (wantHost && this.hostUid == null) this.hostUid = uid;

    ws.addEventListener('message', (evt) => this.onMessage(connId, seat, evt));
    ws.addEventListener('close', () => this.onClose(connId, seat));
    ws.addEventListener('error', () => this.onClose(connId, seat));

    this.persist();
    this.broadcastLobby();
    if (this.started) this.sendState(seat);
  }

  // Close a socket we're replacing, without letting its close event tear down
  // the seat that has already moved on to a newer connection.
  dropSocket(connId) {
    const old = this.sockets.get(connId);
    this.sockets.delete(connId);
    if (old) { try { old.close(4000, 'replaced'); } catch {} }
  }

  onClose(connId, seat) {
    this.sockets.delete(connId);
    // Only the seat's *current* socket closing means the player left; a stale
    // one closing after a reconnect must not mark them away again.
    if (this.seats[seat] && this.seats[seat].connId === connId) {
      this.seats[seat].connected = false;
      this.seats[seat].ws = null;
      this.seats[seat].downAt = Date.now();
      // The host's grace period is the one thing that expires on its own, so
      // re-announce the lobby when it runs out: that's when the remaining
      // players find out somebody else can start the game now.
      if (this.seats[seat].uid === this.hostUid) {
        setTimeout(() => this.broadcastLobby(), HOST_GRACE_MS + 500);
      }
    }
    this.broadcastLobby();
  }

  // ── Who may start / configure the room, as a seat index ──
  // Derived on every read rather than stored, so it can't get stuck pointing at
  // a connection that no longer exists — the bug that used to make the host's
  // "start game" button vanish for good after a reconnect.
  hostSeat() {
    const owner = this.hostUid == null ? -1 : this.seats.findIndex(s => !s.isAI && s.uid === this.hostUid);
    if (owner !== -1) {
      const s = this.seats[owner];
      // Still here, or still within the grace period after dropping: theirs.
      if (s.connected || !s.downAt || Date.now() - s.downAt < HOST_GRACE_MS) return owner;
    }
    // Host gone for good: the longest-seated human still in the room takes over,
    // so a room is never left with nobody able to start it.
    const alt = this.seats.findIndex(s => s.connected && !s.isAI);
    return alt !== -1 ? alt : owner;
  }

  // ── Lobby state (pre-game): who's in the room ──
  broadcastLobby() {
    const hostSeat = this.hostSeat();
    const lobby = {
      t: 'lobby',
      code: this.code,
      started: this.started,
      players: this.seats.map((s, i) => ({
        seat: i, name: s.name, connected: s.connected, isAI: s.isAI,
        host: i === hostSeat,
      })),
    };
    for (const [connId, ws] of this.sockets) {
      const seat = this.seats.findIndex(s => s.connId === connId);
      try { ws.send(JSON.stringify({ ...lobby, youSeat: seat, youHost: seat !== -1 && seat === hostSeat })); } catch {}
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

    // ── Host starts the game ──
    if (msg.t === 'start') {
      if (this.started) return;
      // Checked against the seat, not the connection: the host that reconnected
      // is still the host, even though this socket is a different one.
      if (seat !== this.hostSeat()) return;
      // Optionally fill empty seats with AI if host requested
      const fillAI = !!msg.fillAI;
      if (fillAI) {
        while (this.seats.length < (msg.minPlayers || 2)) {
          this.seats.push({
            name: `מחשב ${this.seats.length}`, uid: `ai:${this.seats.length}`, connId: null,
            ws: null, connected: false, isAI: true, ai: 'medium', downAt: 0,
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
      await this.persist();
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
      try { fn(); await this.persist(); this.broadcastState(); this.maybeRunAI(); }
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
