// ═══════════════════════════════════════════════════════
// CLOUDFLARE WORKER + DURABLE OBJECT
// One Durable Object instance per game room. The Worker
// runs the authoritative game logic (G from game-core),
// holds the real deck, and streams each player a redacted
// view over WebSockets. Players never see each other's
// hands — the server sends opponents as card-backs only.
// ═══════════════════════════════════════════════════════

import {
  G, initGame, cSc, MK, aiLevel as normLevel,
  aiWantCard, findAIGroups, meetsReq, attachPos, aiDiscard,
} from '../game-core.js';
import { normFee, normMode } from '../economy.js';

// ── Table size ───────────────────────────────────────
// Six chairs, of which at most five may be computer players: the host decides
// how many to add in the lobby, and they sit down there and then. A computer
// player never keeps a person out — if a human joins a full room before the
// game starts, the newest bot gives up its chair (see handleSocket).
const MAX_SEATS = 6;
const MAX_AI = 5;

// How long the host keeps the crown after their connection drops. A refresh,
// a phone locking itself or a flaky network all look like a disconnect, so the
// room waits this long before handing the game to somebody else.
const HOST_GRACE_MS = 60000;

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
    // A hint or refusal ("one more group to lay", "invalid group") is meant for
    // the player whose move produced it — nobody else sees it.
    msg: state.msg && state.msgSeat === seat ? state.msg : '',
    msgSeat: undefined,
    sel: acting ? (state.sel || []) : [],
    staging: acting ? (state.staging || []) : [],
    players: state.players.map((p, i) => {
      if (i === seat) return { ...p, seat: i, you: true };
      // Opponents: hide hand cards, keep count + public info
      return {
        id: p.id, name: p.name, isAI: p.isAI, seat: i,
        handCount: p.hand.length,
        hasLaid: p.hasLaid, totalScore: p.totalScore,
        lastScore: p.lastScore, paidBuys: p.paidBuys || 0, you: false,
      };
    }),
  };
}

// Run an action and remember whose move produced any new message, so the
// message only goes out to that seat (see viewFor). An unchanged message
// keeps its owner.
function stampMsg(prev, next, seat) {
  return next.msg && next.msg !== prev.msg ? { ...next, msgSeat: seat } : next;
}

// Simulates taking the beit, laying, and discarding the lone spare, using the
// real reducer chain so this can never say yes to something that then fails
// for real when the AI actually commits to it. Pure — st is never mutated.
function antReadyWithBeit(st, seat) {
  const took = G(st, { type: 'TAKE_BEIT' });
  if (took === st || took.phase !== 'action') return false;
  const { groups } = findAIGroups(took.players[seat].hand);
  const laid = G(took, { type: 'AI_LAY', groups });
  if (laid === took || laid.players[seat].hand.length !== 1) return false;
  const done = G(laid, { type: 'DISCARD', cid: laid.players[seat].hand[0].id });
  return done.phase === 'round_end' || done.phase === 'game_end';
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
    this.aiLevel = 'medium';       // difficulty the host picked, for every bot in the room
    // What kind of room this is, set when it is created (see /create): a free
    // practice table, or an online room with an entry fee (0 = a free friendly
    // game). `cap` is the table size the creator picked. The wallet itself is
    // the client's (demo — see client/profile.js); the server only stamps these
    // on the game so every seat settles it the same way.
    this.mode = 'online';
    this.fee = 0;
    this.cap = MAX_SEATS;
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
      // Nobody is connected right after an eviction, but the seats themselves
      // (and who owns them) are exactly as they were — so a returning player,
      // host included, is recognised rather than seated as someone new. They all
      // count as "just dropped", which starts the host's grace period from the
      // moment the room woke up instead of from a stale (or zero) timestamp.
      this.seats = saved.seats.map(s => ({ ...s, ws: null, connected: false, downAt: Date.now() }));
      this.hostUid = saved.hostUid || null;
      this.code = saved.code;
      this.started = saved.started;
      this.aiLevel = normLevel(saved.aiLevel);
      this.mode = normMode(saved.mode);
      this.fee = saved.fee || 0;
      this.cap = saved.cap || MAX_SEATS;
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
      seats: this.seats.map(s => ({
        name: s.name, uid: s.uid, connId: s.connId,
        isAI: s.isAI, ai: s.ai, botNum: s.botNum, downAt: s.downAt || 0,
      })),
      hostUid: this.hostUid,
      code: this.code,
      started: this.started,
      aiLevel: this.aiLevel,
      mode: this.mode,
      fee: this.fee,
      cap: this.cap,
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
    this.hostUid = null;
    this.code = null;
    this.mode = 'online';
    this.fee = 0;
    this.cap = MAX_SEATS;
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
      const pid = url.searchParams.get('pid') || '';
      const resume = url.searchParams.get('resume') === '1';
      this.handleSocket(server, name, code, wantHost, pid, resume);
      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP: create room (host) — assigns a code
    if (url.pathname.endsWith('/create')) {
      if (!this.code) {
        this.code = url.searchParams.get('code') || makeCode();
        const q = url.searchParams;
        this.mode = normMode(q.get('mode'));
        this.fee = this.mode === 'online' && Number(q.get('fee')) > 0 ? normFee(q.get('fee')) : 0;
        const seats = q.has('seats') ? Number(q.get('seats')) : NaN;
        this.cap = Number.isInteger(seats) ? Math.min(Math.max(seats, 2), MAX_SEATS) : MAX_SEATS;
      }
      this.touch();
      await this.persist();
      // A room nobody ever joins is cleaned up by the same alarm as any other.
      await this.armAlarm();
      return Response.json({ code: this.code });
    }

    return new Response('Room DO', { status: 200 });
  }

  handleSocket(ws, name, code, wantHost, pid, resume = false) {
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

    // A resume is a page that reloaded mid-game and is looking for the seat it
    // already had — never a request to sit down. With no seat to hand back (the
    // room closed and this code now names a blank object, or this player never
    // sat here) say so and touch nothing, rather than opening a fresh, empty
    // room under the old code. The client then falls back to its home screen.
    if (seat === -1 && resume) {
      this.sockets.delete(connId);
      try { ws.send(JSON.stringify({ t: 'noseat' })); } catch {}
      try { ws.close(1000, 'no seat'); } catch {}
      return;
    }

    if (seat === -1) {
      // A full room still has room for a person as long as a bot is sitting in
      // one of the chairs: the newest one gets up. The host can always add it
      // back, and nobody is turned away from a game that hasn't started.
      if (!this.started && this.seats.length >= this.cap) this.removeAISeat(-1);
      if (this.seats.length >= this.cap || this.started) {
        // Room full or already started with no seat for this player. Drop it from
        // the socket map on the way out, or this dead connection would keep the
        // room looking occupied and it would never hit the empty-room deadline.
        this.sockets.delete(connId);
        ws.send(JSON.stringify({ t: 'error', msg: this.started ? 'המשחק כבר התחיל' : `החדר מלא (${this.cap} שחקנים)` }));
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

    // The seat is looked up per event, never captured: removing a bot from the
    // lobby shifts every seat after it, and a stale index would answer for — or
    // silence — the wrong player.
    ws.addEventListener('message', (evt) => this.onMessage(connId, evt));
    ws.addEventListener('close', () => this.onClose(connId));
    ws.addEventListener('error', () => this.onClose(connId));

    this.touch();
    this.noteConnections();
    this.persist();
    this.armAlarm();
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

  // Which seat this socket is sitting in right now, or -1 if it has none.
  seatOf(connId) {
    return this.seats.findIndex(s => s.connId === connId);
  }

  // ── Computer players ─────────────────────────────────
  aiCount() { return this.seats.filter(s => s.isAI).length; }
  // A room with an entry fee is played for coins, and games against the
  // computer never are: bots belong to practice (and free rooms).
  paid() { return this.mode === 'online' && this.fee > 0; }
  maxAI() { return this.paid() ? 0 : Math.min(MAX_AI, this.cap - 1); }

  // Seat one more bot. Returns why it couldn't, or null when it sat down.
  addAISeat() {
    if (this.started) return 'המשחק כבר התחיל';
    if (this.paid()) return 'בחדר עם דמי כניסה משחקים רק מול אנשים — מול המחשב משחקים באימון';
    if (this.aiCount() >= MAX_AI) return `אפשר להוסיף עד ${MAX_AI} שחקני מחשב`;
    if (this.seats.length >= this.cap) return `החדר מלא (${this.cap} שחקנים)`;
    // Lowest free number, so removing "מחשב 2" and adding another gives back a
    // מחשב 2 rather than a מחשב 4 at a three-bot table.
    const taken = new Set(this.seats.filter(s => s.isAI).map(s => s.botNum));
    let n = 1;
    while (taken.has(n)) n++;
    this.seats.push({
      name: `מחשב ${n}`, botNum: n, uid: `ai:${crypto.randomUUID()}`, connId: null,
      ws: null, connected: false, isAI: true, ai: this.aiLevel, downAt: 0,
    });
    return null;
  }

  // Remove one bot: the given seat, or (seat < 0) the one added most recently.
  // Seats after it shift down by one, which is why nothing captures an index.
  removeAISeat(seat) {
    if (this.started) return false;
    let i = seat;
    if (!(i >= 0 && i < this.seats.length && this.seats[i].isAI)) {
      i = -1;
      for (let k = this.seats.length - 1; k >= 0; k--) if (this.seats[k].isAI) { i = k; break; }
    }
    if (i === -1) return false;
    this.seats.splice(i, 1);
    return true;
  }

  // ── Leaving on purpose ───────────────────────────────
  // Unlike a dropped connection, which keeps the seat warm for a comeback, this
  // gives the chair up. Before the game it simply empties; once the cards are
  // dealt the seat can't vanish from under everyone else, so a computer player
  // takes over the hand and the game goes on. Either way the crown passes on
  // straight away, with no grace period, and the player is never seated here
  // again under their old id.
  leaveSeat(seat) {
    const s = this.seats[seat];
    if (!s || s.isAI) return;
    const wasHost = s.uid === this.hostUid;
    const connId = s.connId;

    if (!this.started) {
      this.seats.splice(seat, 1);
    } else {
      Object.assign(s, {
        isAI: true, ai: this.aiLevel, uid: `ai:${crypto.randomUUID()}`,
        connId: null, ws: null, connected: false, downAt: 0,
      });
      let st = this.state;
      if (st && st.players[seat]) {
        // Mid-turn work a bot can't pick up — a beit taken for an ant, lays
        // that haven't been thrown on — is rolled back, as the player's own
        // "undo" would, so the computer starts the turn from a clean position.
        if (st.cur === seat && st.phase === 'action' && st.undoBefore) st = stampMsg(st, G(st, { type: 'UNDO' }), -1);
        st = {
          ...st,
          players: st.players.map((p, i) => i === seat ? { ...p, isAI: true, ai: this.aiLevel } : p),
          log: [...(st.log || []), `🚪 ${s.name} יצא מהחדר — המחשב ממשיך במקומו`],
        };
        this.state = st;
      }
    }

    if (wasHost) {
      const next = this.seats.find(x => !x.isAI && x.connected) || this.seats.find(x => !x.isAI);
      this.hostUid = next ? next.uid : null;
    }

    // Hang up this player's socket. Its seat no longer points at it, so the
    // close event that follows touches nobody.
    if (connId) this.dropSocket(connId);

    // Nobody left but computer players: there is no game for anyone to watch.
    if (!this.seats.some(x => !x.isAI)) return this.closeRoom('empty');

    this.touch();
    this.noteConnections();
    this.persist();
    this.armAlarm();
    this.broadcastLobby();
    if (this.started) { this.broadcastState(); this.maybeRunAI(); }
  }

  onClose(connId) {
    this.sockets.delete(connId);
    if (this.closing) return;   // the room is being retired; nothing left to update
    // Only the seat's *current* socket closing means the player left; a stale
    // one closing after a reconnect must not mark them away again.
    const seat = this.seatOf(connId);
    if (seat !== -1) {
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
    // The last player leaving starts the empty-room clock.
    this.noteConnections();
    this.persist();
    this.armAlarm();
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
      // Room rules the lobby screen needs: how many chairs there are, how many
      // of them may hold a bot, and the difficulty they all play at.
      maxSeats: this.cap,
      mode: this.mode,
      fee: this.fee,
      maxAI: this.maxAI(),
      aiLevel: this.aiLevel,
      aiCount: this.aiCount(),
      players: this.seats.map((s, i) => ({
        seat: i, name: s.name, connected: s.connected, isAI: s.isAI,
        ai: s.isAI ? normLevel(s.ai) : null,
        host: i === hostSeat,
      })),
    };
    for (const [connId, ws] of this.sockets) {
      const seat = this.seats.findIndex(s => s.connId === connId);
      try { ws.send(JSON.stringify({ ...lobby, youSeat: seat, youHost: seat !== -1 && seat === hostSeat })); } catch {}
    }
  }

  // A message meant for one player — why their request was refused.
  sendError(seat, text) {
    const s = this.seats[seat];
    if (!s || !s.ws || !s.connected) return;
    try { s.ws.send(JSON.stringify({ t: 'error', msg: text })); } catch {}
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

  async onMessage(connId, evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    const seat = this.seatOf(connId);
    if (seat === -1) return;      // a socket with no chair has nothing to say
    this.touch();

    // ── Host sets up the computer players (lobby only) ──
    // Adding, removing and the difficulty are all the host's call, and all three
    // are refused once the game is under way — the seats are dealt in by then.
    if (msg.t === 'addAI' || msg.t === 'removeAI' || msg.t === 'aiLevel') {
      if (seat !== this.hostSeat()) return;
      if (this.started) return;
      if (msg.t === 'addAI') {
        const why = this.addAISeat();
        if (why) { this.sendError(seat, why); return; }
      } else if (msg.t === 'removeAI') {
        if (!this.removeAISeat(Number.isInteger(msg.seat) ? msg.seat : -1)) return;
      } else {
        this.aiLevel = normLevel(msg.level);
        for (const s of this.seats) if (s.isAI) s.ai = this.aiLevel;
      }
      // Announce first, store after: everyone in the lobby sees the chair
      // change straight away, and the write is only the crash insurance.
      this.broadcastLobby();
      await this.persist();
      return;
    }

    // ── A player leaves the room for good ──
    if (msg.t === 'leave') {
      await this.leaveSeat(seat);
      return;
    }

    // ── Host starts the game ──
    if (msg.t === 'start') {
      if (this.started) return;
      // Checked against the seat, not the connection: the host that reconnected
      // is still the host, even though this socket is a different one.
      if (seat !== this.hostSeat()) return;
      // The host seats the bots in the lobby now, so by here the table is
      // already set. `fillAI` is the old client's way of asking for one on the
      // way in — still honoured, so a cached tab can start a game.
      if (msg.fillAI) {
        const want = Math.min(Math.max(msg.minPlayers || 2, 2), this.cap);
        while (this.seats.length < want && !this.addAISeat()) { /* addAISeat stops at the caps */ }
      }
      if (this.seats.length < 2) {
        this.sendError(seat, 'צריך לפחות 2 שחקנים');
        return;
      }
      const configs = this.seats.map(s => ({
        name: s.name, isAI: s.isAI, ai: s.isAI ? normLevel(s.ai || this.aiLevel) : 'medium',
      }));
      // The room's terms ride along with the game, so the game-over screen of
      // every seat settles it the same way (economy.settle). `gameId` is what
      // keeps a wallet from being charged or paid twice for one game.
      this.state = {
        ...initGame(configs),
        room: { mode: this.mode, fee: this.fee, gameId: crypto.randomUUID() },
      };
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
      try { this.state = stampMsg(this.state, G(this.state, action), seat); }
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
    // The draw decision — pull from the pile, or take the beit — is open only in the
    // 'draw' phase, and each player makes it once per turn. A double-tap on the pile
    // arrives as two DRAWs, because the client can't know the first one landed until
    // the new state comes back, so anything past the first is dropped here.
    if (['DRAW', 'TAKE_BEIT'].includes(action.type))
      return seat === st.cur && st.phase === 'draw';
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
    // Just enough of a pause for a human to register that the AI moved, and no
    // more — waiting on the computer is the slowest part of a table full of
    // them. DO alarms would be more robust, but a short setTimeout is fine
    // within a single active request lifetime.
    // One at a time: maybeRunAI can be reached more than once for the same AI
    // turn, and without this guard the AI would play its move twice.
    if (this.aiPending) return;
    this.aiPending = true;
    setTimeout(async () => {
      this.aiPending = false;
      // Whatever an AI move tells "the player" is for the AI alone: no human sees it.
      try { const before = this.state; fn(); if (this.state) this.state = stampMsg(before, this.state, -1); this.touch(); await this.persist(); await this.armAlarm(); this.broadcastState(); this.maybeRunAI(); }
      catch (e) { /* swallow */ }
    }, 260 + Math.random() * 160);
  }

  // How sharply a given AI seat plays. Falls back to the room's level for a seat
  // saved before the host could choose one.
  levelOf(seat) {
    return normLevel(this.seats[seat]?.ai || this.aiLevel);
  }

  aiBuy() {
    const st = this.state, buy = st.buy;
    const lv = this.levelOf(buy.checker);
    const checker = st.players[buy.checker];
    const top = st.discard[st.discard.length - 1];
    if (buy.checker === buy.origNext) {
      // First refusal, and free: the only cost is picking up a card it doesn't
      // need. A beginner still lets good cards go by now and then.
      const want = !!top && aiWantCard(checker.hand, top, lv) &&
                   (lv !== 'easy' || Math.random() > 0.25);
      this.state = G(st, { type: want ? 'TAKE_FREE' : 'SKIP' });
    } else if (buy.free) {
      // The opening discard costs nothing even out of turn, so it's judged
      // like a free take.
      const want = !!top && aiWantCard(checker.hand, top, lv) &&
                   (lv !== 'easy' || Math.random() > 0.25);
      this.state = G(st, { type: want ? 'BUY' : 'SKIP', idx: buy.checker });
    } else {
      // Buying out of turn costs a penalty card from the deck, so each level
      // has its own appetite for it — and the beginner never pays at all.
      const odds = lv === 'hard' ? 0.2 : lv === 'medium' ? 0.3 : 1;
      const want = !!top && aiWantCard(checker.hand, top, lv, { costly: true }) && Math.random() > odds;
      this.state = G(st, { type: want ? 'BUY' : 'SKIP', idx: buy.checker });
    }
  }

  aiDraw() {
    const st = this.state;
    const seat = st.cur;
    // A sharp player reaches for the house card when — and only when — it's
    // the exact missing piece of an ante. Taking it is a commitment (every
    // discard is refused until the turn ends as an ante or the card is
    // handed back), so this has to be certain, not a guess.
    if (this.levelOf(seat) === 'hard' && st.beit && st.canLay &&
        !st.players[seat].hasLaid && antReadyWithBeit(st, seat)) {
      this.state = G(st, { type: 'TAKE_BEIT' });
      return;
    }
    this.state = G(this.state, { type: 'DRAW' });
  }

  aiAction() {
    let st = this.state;
    const seat = st.cur;
    const lv = this.levelOf(seat);

    // Took the beit chasing an ante: it must go out as one this very turn —
    // lay everything and discard the lone spare — or hand the card back.
    // Never fall into the ordinary flow below: it has no idea it needs to
    // protect the ante, and could leave the turn stuck (every discard is
    // refused while the beit is held).
    if (st.tookBeit) {
      const { groups } = findAIGroups(st.players[seat].hand);
      const laid = G(st, { type: 'AI_LAY', groups });
      this.state = (laid !== st && laid.players[seat].hand.length === 1)
        ? G(laid, { type: 'DISCARD', cid: laid.players[seat].hand[0].id })
        : G(st, { type: 'UNDO' }); // give the beit back rather than get stuck
      return;
    }

    // 1. Lay down, if the mishkakon is covered and a card is left to throw. A
    // sharp player chasing an ante holds back a lay when it's only one or two
    // cards short of laying its WHOLE hand at once — laying the partial group
    // now would lock in hasLaid and forfeit the ante for the rest of the round.
    if (st.canLay && !st.players[seat].hasLaid) {
      const { groups, unused } = findAIGroups(st.players[seat].hand);
      const chasingAnt = lv === 'hard' && unused.length >= 2 && unused.length <= 3;
      if (meetsReq(groups, st.mk) && unused.length >= 1 && !chasingAnt) {
        // AI_LAY re-validates against the real hand and may refuse, returning the
        // state untouched. Fall through to a discard rather than spinning on it.
        const laid = G(st, { type: 'AI_LAY', groups });
        if (laid !== st) st = laid;
      }
    }

    // 2. Attach to the board. This is where the levels part company: a beginner
    // never bothers, medium clears most of what it can, and a sharp AI empties
    // everything it can (AI_ATTACH refuses to leave it with nothing to throw,
    // which is what stops the loop).
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
        if (st === before) break;   // nothing left to place
      }
    }

    // 3. Throw a card — which is also how an AI goes out.
    const hand = st.players[seat].hand;
    this.state = G(st, { type: 'DISCARD', cid: aiDiscard(hand, lv, Math.random, st.board).id });
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
        // The room's terms: ?mode=practice|online&fee=…&seats=…
        const q = new URLSearchParams({ code });
        for (const k of ['mode', 'fee', 'seats']) {
          const v = url.searchParams.get(k);
          if (v != null) q.set(k, v);
        }
        const r = await stub.fetch(new Request(`https://do/create?${q}`));
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
