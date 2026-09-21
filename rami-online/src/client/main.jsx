import { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { FELT, FELTD, GOLD, CREAM } from "../game-core.js";
import { Game, RoundEnd, GameEnd, RulesModal } from "./ui.jsx";
import { createRoom, joinRoom } from "./net.js";

// ═══════════════════════════════════════════════════════
// ONLINE APP
// Flow: name + code (lobby) → waiting room → live game.
// The server is authoritative; this component just holds the
// connection, the latest redacted state, and the lobby list.
// ═══════════════════════════════════════════════════════

const FONT = "'Noto Sans Hebrew','Segoe UI',Arial,sans-serif";

// Injected by Vite from package.json (see vite.config.js). The fallback keeps
// the UI sane if the app is ever served without going through the build.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// ── Read ?code= from the URL so a shared link auto-fills the room ──
function urlCode() {
  const p = new URLSearchParams(location.search);
  return (p.get('code') || p.get('room') || '').toUpperCase();
}

function App() {
  const [screen, setScreen] = useState('home'); // home | lobby | game
  const [name, setName] = useState(() => localStorage.getItem('rami_name') || '');
  const [code, setCode] = useState(urlCode());
  const [lobby, setLobby] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const connRef = useRef(null);

  // Persist the chosen name for next time
  useEffect(() => { if (name) localStorage.setItem('rami_name', name); }, [name]);

  const connect = useCallback((roomCode, asHost) => {
    setConnecting(true);
    setError('');
    const conn = joinRoom(
      { code: roomCode, name: name.trim() || 'שחקן', host: asHost },
      {
        onOpen:  () => { setConnecting(false); },
        onLobby: (l) => { setLobby(l); if (!l.started) setScreen('lobby'); },
        onState: (s) => { setState(s); setScreen('game'); },
        onError: (m) => { setError(m); },
        onClose: () => { /* auto-reconnect handled in net.js */ },
      }
    );
    connRef.current = conn;
  }, [name]);

  // Clean up on unmount
  useEffect(() => () => { connRef.current && connRef.current.close(); }, []);

  async function handleCreate() {
    if (!name.trim()) { setError('הכניסו שם שחקן'); return; }
    try {
      setConnecting(true);
      const newCode = await createRoom();
      setCode(newCode);
      connect(newCode, true);
    } catch (e) {
      setConnecting(false);
      setError('יצירת החדר נכשלה — נסו שוב');
    }
  }

  function handleJoin() {
    if (!name.trim()) { setError('הכניסו שם שחקן'); return; }
    if (!code.trim()) { setError('הכניסו קוד חדר'); return; }
    connect(code.trim().toUpperCase(), false);
  }

  // Dispatch = send an action to the server
  const dispatch = useCallback((action) => {
    connRef.current && connRef.current.action(action);
  }, []);

  // ── Screens ──
  if (screen === 'home')
    return <Home {...{ name, setName, code, setCode, error, connecting, handleCreate, handleJoin }} />;

  if (screen === 'lobby')
    return <Lobby {...{ lobby, code, error, onStart: (opts) => connRef.current?.start(opts) }} />;

  // screen === 'game'
  if (!state) return <Splash text="טוען משחק..." />;
  if (state.phase === 'game_end') return <GameEnd state={state} onRestart={() => location.reload()} />;
  if (state.phase === 'round_end') return <RoundEnd state={state} dispatch={dispatch} />;
  return <Game state={state} dispatch={dispatch} />;
}

// ═══════════════════════════════════════════════════════
// HOME — name + create/join
// ═══════════════════════════════════════════════════════

function Home({ name, setName, code, setCode, error, connecting, handleCreate, handleJoin }) {
  const [showRules, setShowRules] = useState(false);
  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 54, marginBottom: 4, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.2))' }}>🃏</div>
        <h1 style={{ margin: 0, fontSize: 30, fontFamily: 'Georgia,serif', color: FELTD, letterSpacing: 2, fontWeight: 400 }}>
          רמי אקסטרים
        </h1>
        <div style={{ width: 50, height: 2, background: GOLD, margin: '8px auto' }} />
        <p style={{ color: '#78716c', margin: 0, fontSize: 13 }}>אונליין · עד 4 שחקנים</p>
      </div>

      <Label>השם שלך</Label>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="איך קוראים לך?"
        maxLength={16}
        style={inputStyle}
      />

      <button onClick={handleCreate} disabled={connecting} style={primaryBtn}>
        {connecting ? '...' : '➕ צור חדר חדש'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 14px' }}>
        <div style={{ flex: 1, height: 1, background: '#e7e5e4' }} />
        <span style={{ color: '#a8a29e', fontSize: 12 }}>או הצטרף לחדר</span>
        <div style={{ flex: 1, height: 1, background: '#e7e5e4' }} />
      </div>

      <Label>קוד חדר</Label>
      <input
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD"
        maxLength={4}
        style={{ ...inputStyle, letterSpacing: 6, textAlign: 'center', fontSize: 22, fontWeight: 700 }}
      />
      <button onClick={handleJoin} disabled={connecting} style={secondaryBtn}>
        {connecting ? '...' : '🚪 הצטרף'}
      </button>

      {error && <div style={errorStyle}>{error}</div>}

      <button onClick={() => setShowRules(true)} style={linkBtn}>📖 חוקים והסבר</button>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════
// LOBBY — waiting room; host starts the game
// ═══════════════════════════════════════════════════════

function Lobby({ lobby, code, error, onStart }) {
  const [copied, setCopied] = useState(false);
  const [fillAI, setFillAI] = useState(false);
  if (!lobby) return <Splash text="מתחבר לחדר..." />;

  const shareLink = `${location.origin}${location.pathname}?code=${lobby.code || code}`;
  const players = lobby.players || [];
  const canStart = lobby.youHost && (players.length >= 2 || fillAI);

  const copy = async () => {
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked — user can copy the code manually */ }
  };

  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 40 }}>🎴</div>
        <h2 style={{ margin: '4px 0', color: FELTD, fontFamily: 'Georgia,serif', fontWeight: 400, fontSize: 22 }}>
          חדר המתנה
        </h2>
      </div>

      {/* Room code — big, tappable to copy */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ color: '#78716c', fontSize: 12, marginBottom: 4 }}>קוד החדר — שתפו עם חברים</div>
        <div
          onClick={copy}
          style={{
            display: 'inline-block', padding: '10px 26px', borderRadius: 14,
            background: FELT, color: GOLD, fontSize: 34, fontWeight: 700,
            letterSpacing: 10, cursor: 'pointer', fontFamily: 'Georgia,serif',
            boxShadow: `0 4px 16px ${FELT}66`, userSelect: 'all',
          }}
          title="העתק קישור הזמנה"
        >
          {lobby.code || code}
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={copy} style={{ ...linkBtn, marginTop: 0, fontSize: 13 }}>
            {copied ? '✓ הקישור הועתק' : '🔗 העתק קישור הזמנה'}
          </button>
        </div>
      </div>

      {/* Player list */}
      <div style={{ marginBottom: 14 }}>
        {players.map((p) => (
          <div key={p.seat} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 11, marginBottom: 6,
            background: p.host ? `${FELT}14` : '#fafaf9',
            border: `2px solid ${p.host ? FELT + '33' : '#e7e5e4'}`,
          }}>
            <span style={{ fontWeight: 700, color: FELTD }}>
              {p.isAI ? '🤖' : p.connected ? '🟢' : '⚪'} {p.name}
              {p.seat === lobby.youSeat && <span style={{ color: '#78716c', fontWeight: 400 }}> (אתה)</span>}
            </span>
            {p.host && <span style={{ fontSize: 11, color: FELT, fontWeight: 700 }}>👑 מארח</span>}
          </div>
        ))}
        {Array.from({ length: Math.max(0, 4 - players.length) }).map((_, k) => (
          <div key={'e' + k} style={{
            padding: '10px 14px', borderRadius: 11, marginBottom: 6,
            background: '#fafaf9', border: '2px dashed #e7e5e4',
            color: '#a8a29e', fontSize: 13, textAlign: 'center',
          }}>
            ממתין לשחקן...
          </div>
        ))}
      </div>

      {lobby.youHost ? (
        <>
          {players.length < 2 && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              color: '#57534e', marginBottom: 12, cursor: 'pointer', justifyContent: 'center',
            }}>
              <input type="checkbox" checked={fillAI} onChange={e => setFillAI(e.target.checked)}
                     style={{ width: 16, height: 16 }} />
              מלא מקומות ריקים בשחקני מחשב
            </label>
          )}
          <button
            onClick={() => onStart({ fillAI, minPlayers: 2 })}
            disabled={!canStart}
            style={{ ...primaryBtn, opacity: canStart ? 1 : 0.5, marginTop: 0 }}
          >
            🎮 התחל משחק
          </button>
          {players.length < 2 && !fillAI && (
            <div style={{ textAlign: 'center', color: '#a8a29e', fontSize: 12, marginTop: 8 }}>
              צריך לפחות 2 שחקנים כדי להתחיל
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', color: '#78716c', fontSize: 14, padding: '10px 0' }}>
          ⏳ ממתינים שהמארח יתחיל את המשחק...
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════
// SHARED BITS
// ═══════════════════════════════════════════════════════

function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: `radial-gradient(ellipse at 50% 30%, #1f6b3a 0%, ${FELTD} 70%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16, fontFamily: FONT,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;600;700&display=swap');
        *{box-sizing:border-box;} input,button{font-family:inherit;}
      `}</style>
      <div style={{
        background: CREAM, borderRadius: 22, padding: '26px 24px',
        maxWidth: 390, width: '100%',
        boxShadow: `0 24px 72px rgba(0,0,0,.6), 0 0 0 3px ${GOLD}55`,
        border: `2px solid ${GOLD}77`,
      }}>
        {children}
        <VersionTag />
      </div>
    </div>
  );
}

// ── Small version label, bottom corner, like any other app ──
function VersionTag({ color = '#a8a29e' }) {
  return (
    <div style={{
      textAlign: 'center', marginTop: 14, fontSize: 10,
      color, letterSpacing: 0.5, direction: 'ltr', userSelect: 'text',
    }}>
      v{APP_VERSION}
    </div>
  );
}

function Splash({ text }) {
  return (
    <div style={{
      minHeight: '100dvh', background: FELTD, color: GOLD,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', fontFamily: FONT, fontSize: 18,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>🃏</div>
        {text}
        <VersionTag color={`${GOLD}88`} />
      </div>
    </div>
  );
}

const Label = ({ children }) => (
  <div style={{ fontWeight: 700, color: FELTD, marginBottom: 6, fontSize: 13 }}>{children}</div>
);

const inputStyle = {
  width: '100%', padding: '11px 13px', borderRadius: 10,
  border: '1.5px solid #d6d3d1', fontSize: 15, background: 'white',
  outline: 'none', marginBottom: 14,
};
const primaryBtn = {
  width: '100%', padding: '13px 0', background: FELT, color: GOLD,
  border: `2px solid ${GOLD}88`, borderRadius: 13,
  fontSize: 17, fontWeight: 700, cursor: 'pointer',
  boxShadow: `0 5px 20px ${FELT}77`, letterSpacing: 1,
};
const secondaryBtn = {
  width: '100%', padding: '11px 0', background: '#e7e5e4', color: '#57534e',
  border: '2px solid #d6d3d1', borderRadius: 13,
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
const linkBtn = {
  width: '100%', padding: '10px 0', background: 'transparent', color: FELT,
  border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 10,
};
const errorStyle = {
  marginTop: 12, padding: '9px 12px', borderRadius: 10,
  background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
  fontSize: 13, textAlign: 'center',
};

// ── Mount ──
createRoot(document.getElementById('root')).render(<App />);
