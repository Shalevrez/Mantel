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

// Ask the server to mint a new room; returns its code.
export async function createRoom() {
  const r = await fetch('/api/new');
  if (!r.ok) throw new Error('failed to create room');
  const { code } = await r.json();
  return code;
}

// Open a live connection to a room. Returns a small controller.
// callbacks: { onLobby, onState, onError, onOpen, onClose }
export function joinRoom({ code, name, host = false }, callbacks = {}) {
  let ws = null;
  let closedByUs = false;
  let retry = 0;

  const url = () =>
    `${wsBase()}/api/room?code=${encodeURIComponent(code)}` +
    `&name=${encodeURIComponent(name)}&host=${host ? 1 : 0}`;

  function connect() {
    ws = new WebSocket(url());

    ws.onopen = () => { retry = 0; callbacks.onOpen && callbacks.onOpen(); };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.t === 'lobby')  callbacks.onLobby && callbacks.onLobby(msg);
      else if (msg.t === 'state') callbacks.onState && callbacks.onState(msg.state);
      else if (msg.t === 'error') callbacks.onError && callbacks.onError(msg.msg);
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
    close() {
      closedByUs = true;
      if (ws) try { ws.close(); } catch {}
    },
    get ready() { return ws && ws.readyState === WebSocket.OPEN; },
  };
}
