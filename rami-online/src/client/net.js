// ═══════════════════════════════════════════════════════
// NET — client-side connection to a game room.
// Wraps a WebSocket to the Worker/Durable Object. All game
// logic lives on the server; this just sends actions and
// receives redacted state + lobby updates.
// ═══════════════════════════════════════════════════════

function wsBase() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

// ── Player id ────────────────────────────────────────
// A stable id for this browser. The server uses it to recognise a player who
// comes back — after a refresh, a dropped connection, or closing the browser
// and reopening it — and hand them their own seat, and the host their controls.
const PID_KEY = 'rami_pid';
let pid = null;
export function playerId() {
  if (pid) return pid;
  try { pid = localStorage.getItem(PID_KEY) || ''; } catch { /* storage blocked */ }
  if (!pid) {
    pid = (crypto.randomUUID && crypto.randomUUID()) ||
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // Blocked storage (private mode) only costs us the id across reloads — it
    // still holds for this page's reconnects, and the server falls back to names.
    try { localStorage.setItem(PID_KEY, pid); } catch {}
  }
  return pid;
}

// Ask the server to mint a new room; returns its code.
export async function createRoom() {
  const r = await fetch('/api/new');
  if (!r.ok) throw new Error('failed to create room');
  const { code } = await r.json();
  return code;
}

// Open a live connection to a room. Returns a small controller.
// callbacks: { onLobby, onState, onError, onOpen, onClose, onRoomClosed }
export function joinRoom({ code, name, host = false }, callbacks = {}) {
  let ws = null;
  let closedByUs = false;
  let retry = 0;

  const url = () =>
    `${wsBase()}/api/room?code=${encodeURIComponent(code)}` +
    `&name=${encodeURIComponent(name)}&host=${host ? 1 : 0}` +
    `&pid=${encodeURIComponent(playerId())}`;

  function connect() {
    ws = new WebSocket(url());

    ws.onopen = () => { retry = 0; callbacks.onOpen && callbacks.onOpen(); };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.t === 'lobby')  callbacks.onLobby && callbacks.onLobby(msg);
      else if (msg.t === 'state') callbacks.onState && callbacks.onState(msg.state);
      else if (msg.t === 'error') callbacks.onError && callbacks.onError(msg.msg);
      else if (msg.t === 'closed') {
        // The server retired the room (game over, or nobody playing). Stop the
        // auto-reconnect below — reconnecting would silently open a new, empty
        // room under the same code instead of telling the player it's over.
        closedByUs = true;
        callbacks.onRoomClosed && callbacks.onRoomClosed(msg.reason);
      }
    };

    ws.onclose = () => {
      callbacks.onClose && callbacks.onClose();
      if (closedByUs) return;
      // Auto-reconnect with backoff (reclaims the same seat by name)
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 400 * retry);
    };

    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  connect();

  return {
    // Send a game action to the server
    action(action) {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: 'action', action }));
    },
    // Host: start the game
    start(opts = {}) {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: 'start', ...opts }));
    },
    // Host: seat one more computer player, free a chair, or set the difficulty
    // every computer player in the room plays at. The server answers with a
    // fresh lobby (or an 'error' when a limit is hit), so there is no local
    // copy of the room to keep in step.
    addAI() {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'addAI' }));
    },
    removeAI(seat) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'removeAI', seat }));
    },
    setAILevel(level) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'aiLevel', level }));
    },
    close() {
      closedByUs = true;
      if (ws) try { ws.close(); } catch {}
    },
    get ready() { return ws && ws.readyState === WebSocket.OPEN; },
  };
}
