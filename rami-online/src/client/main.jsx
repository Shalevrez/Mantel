import { useState, useEffect, useRef, useCallback, Component } from "react";
import { createRoot } from "react-dom/client";
import { FELT, FELTD, GOLD, CREAM, CLOTH, AI_LEVELS, AI_LEVEL_NAMES } from "../game-core.js";
import { Game, RoundEnd, GameEnd, RulesModal, ReleaseNotes, LeaveConfirm } from "./ui.jsx";
import { Icon, IconLabel } from "./icons.jsx";
import { LATEST_RELEASE } from "../releases.js";
import { createRoom, joinRoom } from "./net.js";
import { settle, buyPrice } from "../economy.js";
import * as P from "./profile.js";
import { useProfile, LoginScreen, Hub, MenuCards, ProfileSheet, LeaderboardList, RewardStrip } from "./account.jsx";
import { PracticeSetup, OnlineSetup, JoinDialog, RoomTerms } from "./rooms.jsx";
import { StoreScreen } from "./store.jsx";

// ═══════════════════════════════════════════════════════
// ONLINE APP
// Flow: name + code (lobby) → waiting room → live game.
// The server is authoritative; this component just holds the
// connection, the latest redacted state, and the lobby list.
// ═══════════════════════════════════════════════════════

// Injected by Vite from package.json (see vite.config.js). The fallback keeps
// the UI sane if the app is ever served without going through the build.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Which release the player has already been shown the notes for.
const SEEN_RELEASE_KEY = 'rami_seen_release';

// ── Browser storage ──────────────────────────────────
// Every read and write is guarded: a browser with storage blocked (private
// mode, an in-app webview, a locked-down profile) throws on plain access, and
// a throw while the app is deciding what to put in the name box would take the
// whole screen down. A blocked store just means nothing is remembered.
function readStore(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

// The player's name, kept between visits. It is typed once and comes back
// filled in on every later entry — a reload mid-game, a return after the
// browser was closed, or a fresh invite link.
const NAME_KEY = 'rami_name';

// ── Read ?code= from the URL so a shared link auto-fills the room ──
function urlCode() {
  const p = new URLSearchParams(location.search);
  return (p.get('code') || p.get('room') || '').toUpperCase();
}

// The last room this browser was in. A host who created a room has no ?code= in
// their URL, so without this, closing the browser and coming back leaves them
// with nothing to type. The server still knows them (see playerId in net.js) —
// they just need the code to get back to their seat and their host controls.
const LAST_ROOM_KEY = 'rami_last_room';
function lastRoom() {
  return readStore(LAST_ROOM_KEY).toUpperCase();
}

// The room this browser is sitting in right now — set once the server seats
// us, cleared when the room closes or the player heads home. A reload (to pick
// up a new version, or by accident) finds it here and goes straight back to
// the table instead of the home screen; the server hands the same seat back
// (see playerId in net.js). An invite link to a different room wins over it.
const ACTIVE_ROOM_KEY = 'rami_active_room';
function roomToResume() {
  const active = readStore(ACTIVE_ROOM_KEY).toUpperCase();
  const invited = urlCode();
  return active && (!invited || invited === active) ? active : '';
}
function leaveRoom() {
  writeStore(ACTIVE_ROOM_KEY, '');
  // A clean home screen: drop the ?code= so the old room isn't pre-filled.
  location.href = location.pathname;
}

function App() {
  const profile = useProfile();
  const [resumeCode] = useState(roomToResume);
  // home | practice | online | leaderboard | store | resume | lobby | game
  const [screen, setScreen] = useState(() => resumeCode ? 'resume' : 'home');
  const [code, setCode] = useState(() => urlCode() || lastRoom());
  const [lobby, setLobby] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [notes, setNotes] = useState(false);
  const [closed, setClosed] = useState(null); // why the server retired the room
  const [showProfile, setShowProfile] = useState(false);
  const [showRules, setShowRules] = useState(false);
  // An invite link opens the join box straight away.
  const [showJoin, setShowJoin] = useState(() => !!urlCode() && !resumeCode);
  const connRef = useRef(null);
  // A practice table is set up and started for the player: once the lobby
  // answers, seat the bots at the chosen level and deal (see onLobby).
  const practiceRef = useRef(null);
  // The game on screen, for walking out of it (see handleLeave).
  const gameIdRef = useRef(null);

  // The name at the table is the profile's. Kept in rami_name too, where the
  // older builds looked for it.
  const name = profile ? profile.displayName : '';
  useEffect(() => { if (name) writeStore(NAME_KEY, name); }, [name]);

  // "What's new": pop the release notes once per version, then remember it was
  // seen.
  useEffect(() => {
    if (readStore(SEEN_RELEASE_KEY) !== LATEST_RELEASE.version) setNotes(true);
  }, []);

  const closeNotes = useCallback(() => {
    setNotes(false);
    writeStore(SEEN_RELEASE_KEY, LATEST_RELEASE.version);
  }, []);

  // ── The wallet follows the game (demo — see profile.js) ──
  // The entry fee goes when the cards are dealt; the prize, XP and trophies
  // come when the game is over. Both are keyed on the game's id, so a reload
  // that sends the same state again changes nothing.
  const onGameState = useCallback((s) => {
    const room = s && s.room;
    if (!room || room.mode !== 'online' || !room.gameId) return;
    gameIdRef.current = room.gameId;
    const me = s.players.findIndex(p => p.you);
    // Buys with a penalty card, paid as they happen (the server counts them).
    // Charged before the game is settled, so the last buy still counts.
    const chargeMyBuys = () => me !== -1 &&
      P.chargeBuys(room.gameId, s.players[me].paidBuys || 0, buyPrice(room.fee));
    if (s.phase !== 'game_end') {
      P.chargeEntry(room.gameId, room.fee || 0);
      chargeMyBuys();
      return;
    }
    chargeMyBuys();
    const res = settle(s);
    if (res && me !== -1) P.applyGameResult(room.gameId, res.seats[me]);
  }, []);

  const connect = useCallback((roomCode, asHost, resume = false) => {
    setConnecting(true);
    setError('');
    setClosed(null);
    writeStore(LAST_ROOM_KEY, roomCode);
    const conn = joinRoom(
      { code: roomCode, name: name.trim() || 'שחקן', host: asHost, resume },
      {
        onOpen:  () => { setConnecting(false); },
        onLobby: (l) => {
          writeStore(ACTIVE_ROOM_KEY, roomCode);
          setLobby(l);
          setShowJoin(false);
          const pr = practiceRef.current;
          if (pr && l.youHost && !l.started && l.mode === 'practice') {
            practiceRef.current = null;
            conn.setAILevel(pr.level);
            conn.start({ fillAI: true, minPlayers: pr.seats });
          }
          if (!l.started) setScreen('lobby');
        },
        onState: (s) => { onGameState(s); setState(s); setScreen('game'); },
        onError: (m) => { setError(m); setConnecting(false); },
        onClose: () => { /* auto-reconnect handled in net.js */ },
        onRoomClosed: (reason) => {
          writeStore(ACTIVE_ROOM_KEY, '');
          setConnecting(false);
          setClosed(reason || 'idle');
          // A room that closed before its game ended hands the fee back.
          P.refundPending();
        },
        // The room we were resuming no longer has a seat for us (it closed
        // while we were away). Nothing to go back to — show the home screen.
        onNoSeat: () => {
          writeStore(ACTIVE_ROOM_KEY, '');
          setConnecting(false);
          P.refundPending();
          setScreen('home');
        },
      }
    );
    connRef.current = conn;
  }, [name, onGameState]);

  // Back to the table after a reload. Runs once, on mount — and only for a
  // signed-in player; anyone else signs in first and starts from home.
  useEffect(() => {
    if (resumeCode && P.current()) connect(resumeCode, false, true);
    else if (resumeCode) setScreen('home');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { connRef.current && connRef.current.close(); }, []);

  async function handleCreate(terms) {
    try {
      setConnecting(true);
      setError('');
      const newCode = await createRoom(terms);
      setCode(newCode);
      connect(newCode, true);
    } catch (e) {
      setConnecting(false);
      setError('יצירת החדר נכשלה — נסו שוב');
    }
  }

  function handlePractice({ seats, level }) {
    practiceRef.current = { seats, level };
    handleCreate({ mode: 'practice', seats });
  }

  function handleJoin() {
    if (!code.trim()) { setError('הכניסו קוד חדר'); return; }
    connect(code.trim().toUpperCase(), false);
  }

  // Give up the seat for good and go back to a clean home screen. Walking out
  // of a paid game leaves the fee in the pot.
  const handleLeave = useCallback(async () => {
    const conn = connRef.current;
    connRef.current = null;
    if (gameIdRef.current) P.forfeit(gameIdRef.current);
    if (conn) await conn.leave();
    leaveRoom();
  }, []);

  // Dispatch = send an action to the server
  const dispatch = useCallback((action) => {
    connRef.current && connRef.current.action(action);
  }, []);

  const go = (s) => { setError(''); setScreen(s); };

  // ── Screens ──
  const screenEl = (() => {
    if (!profile) return <LoginScreen />;

    // The server retires a room once the game is over or it has gone quiet.
    // The final scoreboard needs no server, so it stays on screen; every other
    // screen has nothing left to talk to.
    if (closed && !(screen === 'game' && state && state.phase === 'game_end'))
      return <RoomClosed reason={closed} />;

    if (screen === 'resume') return <Splash text="חוזרים למשחק..." />;

    const hub = (title, body, back = () => go('home')) => (
      <Hub profile={profile} title={title} onBack={back}
           onProfile={() => setShowProfile(true)} onCoins={() => go('store')}>
        {body}
      </Hub>
    );

    if (screen === 'home') return (
      <Hub profile={profile} onProfile={() => setShowProfile(true)} onCoins={() => go('store')}
           footer={<>
             <button onClick={() => setShowRules(true)} style={hubLink}><IconLabel name="book">חוקים</IconLabel></button>
             <button onClick={() => setNotes(true)} style={hubLink}><IconLabel name="sparkles">מה חדש ב־{LATEST_RELEASE.version}</IconLabel></button>
           </>}>
        <div style={{ textAlign: 'center', margin: '4px 0 18px' }}>
          <h1 style={{ margin: 0, fontSize: 30, color: FELTD, letterSpacing: 2 }}>מנטל</h1>
          <div style={{ width: 50, height: 2, background: GOLD, margin: '6px auto' }} />
          <div style={{ color: '#78716c', fontSize: 13 }}>אונליין · 2–6 שחקנים</div>
        </div>
        <MenuCards items={[
          { key: 'practice', title: 'אימון', sub: 'מול המחשב · חינם', icon: 'bot',
            colors: ['#166534', '#064e3b'], border: '#4ade80', onClick: () => go('practice') },
          { key: 'online', title: 'צור חדר', sub: 'דמי כניסה ופרס לזוכים', icon: 'coins',
            colors: ['#1d4ed8', '#312e81'], border: '#60a5fa', onClick: () => go('online') },
          { key: 'join', title: 'הצטרף לחדר', sub: 'עם קוד מחבר', icon: 'users',
            colors: ['#9f1239', '#4c0519'], border: '#fb923c', onClick: () => { setError(''); setShowJoin(true); } },
          { key: 'rank', title: 'דירוג', sub: 'טבלת הגביעים', icon: 'trophy',
            colors: ['#86198f', '#3b0764'], border: '#e879f9', onClick: () => go('leaderboard') },
          { key: 'store', title: 'חנות', sub: 'מטבעות וסרטונים', icon: 'cart', badge: 'דמו',
            colors: ['#a16207', '#78350f'], border: '#facc15', onClick: () => go('store') },
        ]} />
        {showJoin && <JoinDialog code={code} setCode={setCode} busy={connecting} error={error}
                                 onJoin={handleJoin} onClose={() => setShowJoin(false)} />}
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </Hub>
    );

    if (screen === 'practice')
      return hub('אימון', <PracticeSetup busy={connecting} error={error} onPlay={handlePractice} />);
    if (screen === 'online')
      return hub('חדר אונליין', <OnlineSetup coins={profile.coins} busy={connecting} error={error}
                                             onGetCoins={() => go('store')}
                                             onPlay={({ seats, fee }) => handleCreate({ mode: 'online', seats, fee })} />);
    if (screen === 'leaderboard') return hub('דירוג', <LeaderboardList />);
    if (screen === 'store') return hub('חנות', <StoreScreen />);

    if (screen === 'lobby') {
      // A practice table deals itself; there is no one to wait for.
      if (lobby && lobby.mode === 'practice' && !lobby.started) return <Splash text="מכינים את שולחן האימון..." />;
      return <Lobby {...{ lobby, code, error }}
                    coins={profile.coins}
                    onStart={() => connRef.current?.start()}
                    onAddAI={() => connRef.current?.addAI()}
                    onRemoveAI={(seat) => connRef.current?.removeAI(seat)}
                    onAILevel={(lv) => connRef.current?.setAILevel(lv)}
                    onLeave={handleLeave}
                    onShowNotes={() => setNotes(true)} />;
    }

    // screen === 'game'
    if (!state) return <Splash text="טוען משחק..." />;
    if (state.phase === 'game_end') {
      const res = settle(state);
      const me = state.players.findIndex(p => p.you);
      const extra = res && me !== -1
        ? <RewardStrip r={res.seats[me]} fee={res.fee} />
        : state.room && state.room.mode === 'practice'
          ? <div style={{ textAlign: 'center', color: '#78716c', fontSize: 12.5, marginBottom: 12 }}>
              משחק אימון — בלי נקודות, גביעים או מטבעות
            </div>
          : null;
      return <GameEnd state={state} onRestart={leaveRoom} extra={extra} />;
    }
    if (state.phase === 'round_end') return <RoundEnd state={state} dispatch={dispatch} onLeave={handleLeave} />;
    const wallet = state.room && state.room.mode === 'online' && state.room.fee > 0
      ? { coins: profile.coins, buyPrice: buyPrice(state.room.fee) } : null;
    return <Game state={state} dispatch={dispatch} onLeave={handleLeave} wallet={wallet} />;
  })();

  return (
    <>
      {screenEl}
      {showProfile && profile && <ProfileSheet profile={profile} onClose={() => setShowProfile(false)} />}
      {notes && <ReleaseNotes onClose={closeNotes} current={APP_VERSION} />}
    </>
  );
}

const hubLink = {
  background: 'none', border: 'none', color: '#9fb3d1', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', padding: '6px 10px',
};


// ═══════════════════════════════════════════════════════
// LOBBY — waiting room; host starts the game
// ═══════════════════════════════════════════════════════

// Height of one row in the lobby's player list (border included).
const LOBBY_ROW_H = 44;

function Lobby({ lobby, code, error, coins, onStart, onAddAI, onRemoveAI, onAILevel, onLeave, onShowNotes }) {
  const [copied, setCopied] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  if (!lobby) return <Splash text="מתחבר לחדר..." />;

  const shareLink = `${location.origin}${location.pathname}?code=${lobby.code || code}`;
  const players = lobby.players || [];
  // The server owns these limits; the fallbacks only matter if an old server
  // answers a new client.
  const maxSeats = lobby.maxSeats || 6;
  const maxAI = lobby.maxAI ?? 5;
  const aiCount = lobby.aiCount ?? players.filter(p => p.isAI).length;
  const level = lobby.aiLevel || 'medium';
  const canAddAI = aiCount < maxAI && players.length < maxSeats;
  // A paid room: the host's own wallet has to cover the fee. (Demo — each
  // player's wallet is in their own browser, so the others check their own.)
  const short = lobby.mode === 'online' && lobby.fee > 0 && coins < lobby.fee;
  const canStart = lobby.youHost && players.length >= 2 && !short;

  const copy = async () => {
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked — user can copy the code manually */ }
  };

  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <Icon name="cards" size={40} color={FELT} strokeWidth={1.8} />
        <h2 style={{ margin: '4px 0', color: FELTD, fontWeight: 700, fontSize: 22 }}>
          חדר המתנה
        </h2>
      </div>

      <RoomTerms lobby={lobby} coins={coins} />

      {/* Room code — big, tappable to copy */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ color: '#78716c', fontSize: 12, marginBottom: 4 }}>קוד החדר — שתפו עם חברים</div>
        <div
          onClick={copy}
          style={{
            display: 'inline-block', padding: '10px 26px', borderRadius: 14,
            background: FELT, color: GOLD, fontSize: 34, fontWeight: 700,
            letterSpacing: 10, cursor: 'pointer', fontVariantNumeric: 'tabular-nums',
            // Opts back in to selection (the app disables it globally for the
            // card drag), so the code can still be long-pressed and copied.
            boxShadow: `0 4px 16px ${FELT}66`,
            userSelect: 'all', WebkitUserSelect: 'all', WebkitTouchCallout: 'default',
          }}
          title="העתק קישור הזמנה"
        >
          {lobby.code || code}
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={copy} style={{ ...linkBtn, marginTop: 0, fontSize: 13 }}>
            {copied
              ? <IconLabel name="check">הקישור הועתק</IconLabel>
              : <IconLabel name="link">העתק קישור הזמנה</IconLabel>}
          </button>
        </div>
      </div>

      {/* Player list */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          color: '#78716c', fontSize: 12, marginBottom: 6,
        }}>
          <span>שחקנים בחדר</span>
          <span>{players.length}/{maxSeats}</span>
        </div>
        {/* The list always takes the room of a full table: every row has a
            fixed height and the free chairs stretch over what's left. The card
            is centred on the screen, so a list that grew with each bot made
            the whole card — and the + button under the pointer — jump. */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          minHeight: maxSeats * (LOBBY_ROW_H + 6) - 6,
        }}>
        {players.map((p) => (
          <div key={p.seat} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            height: LOBBY_ROW_H, flexShrink: 0,
            padding: '0 14px', borderRadius: 11,
            background: p.host ? `${FELT}14` : '#fafaf9',
            border: `2px solid ${p.host ? FELT + '33' : '#e7e5e4'}`,
          }}>
            <span style={{ fontWeight: 700, color: FELTD, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.isAI
                ? <Icon name="bot" color={FELT} />
                : <Icon name="dot" color={p.connected ? '#22c55e' : '#d6d3d1'} />} {p.name}
              {p.seat === lobby.youSeat && <span style={{ color: '#78716c', fontWeight: 400 }}> (אתה)</span>}
              {p.isAI && (
                <span style={{ color: '#78716c', fontWeight: 400, fontSize: 12 }}>
                  {' · '}{AI_LEVEL_NAMES[p.ai || level] || ''}
                </span>
              )}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {p.host && <span style={{ fontSize: 11, color: FELT, fontWeight: 700 }}><IconLabel name="crown" gap=".2em">מארח</IconLabel></span>}
              {p.isAI && lobby.youHost && (
                <button onClick={() => onRemoveAI(p.seat)} title="הסר שחקן מחשב"
                        style={removeBtn}><Icon name="x" size={12} strokeWidth={3} /></button>
              )}
            </span>
          </div>
        ))}
        {/* Six chairs is a long list to draw one by one, so the free ones are
            summed up in a single box that fills the rest of the list. */}
        {players.length < maxSeats && (
          <div style={{
            flex: 1, minHeight: LOBBY_ROW_H,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 14px', borderRadius: 11,
            background: '#fafaf9', border: '2px dashed #e7e5e4',
            color: '#a8a29e', fontSize: 13, textAlign: 'center',
          }}>
            <Icon name="chair" style={{ marginInlineEnd: '.3em' }} />{maxSeats - players.length === 1
              ? 'כיסא פנוי אחד'
              : `${maxSeats - players.length} כיסאות פנויים`}
          </div>
        )}
        </div>
      </div>

      {lobby.youHost ? (
        <>
          {maxAI === 0 ? (
            // A paid room: coins are only ever won against people.
            <div style={{
              border: '2px dashed #e7e5e4', borderRadius: 13, padding: '10px 14px', marginBottom: 12,
              color: '#78716c', fontSize: 12.5, textAlign: 'center', lineHeight: 1.5,
            }}>
              <Icon name="bot" /> בחדר עם דמי כניסה משחקים רק מול אנשים.<br />
              רוצים לשחק מול המחשב? זה במצב אימון, בלי מטבעות.
            </div>
          ) : (
          <>
          {/* Computer players — the host decides how many sit down, and how
              well they play. They join the room the moment they're added, so
              everyone waiting can see the table filling up. */}
          <div style={{
            border: '2px solid #e7e5e4', borderRadius: 13, padding: '12px 14px', marginBottom: 12,
          }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
              marginBottom: 10,
            }}>
              <span style={{ fontWeight: 700, color: FELTD, fontSize: 14 }}><IconLabel name="bot">שחקני מחשב</IconLabel></span>
              <span style={{ color: '#78716c', fontSize: 12 }}>{aiCount}/{maxAI}</span>
            </div>
            <button onClick={onAddAI} disabled={!canAddAI}
                    style={{ ...secondaryBtn, marginTop: 0, marginBottom: 4, opacity: canAddAI ? 1 : 0.5 }}>
              <IconLabel name="plus">הוסף מחשב למשחק</IconLabel>
            </button>
            <div style={{ color: '#a8a29e', fontSize: 11, marginBottom: 10, textAlign: 'center' }}>
              {aiCount >= maxAI
                ? `הגעתם למקסימום — ${maxAI} שחקני מחשב`
                : players.length >= maxSeats
                  ? `השולחן מלא (${maxSeats} שחקנים)`
                  : <>כל לחיצה מושיבה מחשב אחד בשולחן. להסרה — <Icon name="x" size=".95em" strokeWidth={3} /> ליד שמו.</>}
            </div>
            <div style={{ color: '#78716c', fontSize: 12, marginBottom: 6 }}>דרגת קושי</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {AI_LEVELS.map(lv => (
                <button key={lv} onClick={() => onAILevel(lv)}
                        style={{
                          flex: 1, padding: '8px 0', borderRadius: 10, cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                          border: `2px solid ${lv === level ? FELT : '#e7e5e4'}`,
                          background: lv === level ? FELT : '#fff',
                          color: lv === level ? CREAM : '#57534e',
                        }}>
                  {AI_LEVEL_NAMES[lv]}
                </button>
              ))}
            </div>
            <div style={{ color: '#a8a29e', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              {LEVEL_HINT[level]}
            </div>
          </div>
          </>
          )}

          <button
            onClick={onStart}
            disabled={!canStart}
            style={{ ...primaryBtn, opacity: canStart ? 1 : 0.5, marginTop: 0 }}
          >
            <IconLabel name="play">התחל משחק</IconLabel>
          </button>
          {players.length < 2 && (
            <div style={{ textAlign: 'center', color: '#a8a29e', fontSize: 12, marginTop: 8 }}>
              {maxAI === 0 ? 'צריך לפחות 2 שחקנים — הזמינו חברים עם הקוד' : 'צריך לפחות 2 שחקנים — הזמינו חבר או הוסיפו מחשב'}
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', color: '#78716c', fontSize: 14, padding: '10px 0' }}>
          <IconLabel name="hourglass">ממתינים שהמארח יתחיל את המשחק...</IconLabel>
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}

      <button onClick={() => setShowLeave(true)} style={{ ...linkBtn, color: '#b91c1c' }}>
        <IconLabel name="logOut">יציאה מהחדר</IconLabel>
      </button>
      <button onClick={onShowNotes} style={{ ...linkBtn, marginTop: 0, fontSize: 13, color: '#78716c' }}>
        <IconLabel name="sparkles">מה חדש בגרסה {LATEST_RELEASE.version}</IconLabel>
      </button>
      {showLeave && <LeaveConfirm started={false} onConfirm={onLeave} onClose={() => setShowLeave(false)} />}
    </Shell>
  );
}

// What each difficulty actually changes, in one line for the host.
const LEVEL_HINT = {
  easy:   'מתחיל: לא קונה, לא מצמיד לשולחן, וזורק כמעט כל קלף מיותר.',
  medium: 'בינוני: לוקח גם קלפים שמתחברים ליד, קונה קלפים לעיתים קרובות, ומצמיד כמעט כל מה שאפשר בכל תור.',
  hard:   'קשה: אוסף קלפים שמתחברים ליד, קונה בלי היסוס, ומרוקן לשולחן כל מה שאפשר בלי להזין קבוצה פתוחה — ואם הוא קרוב לאנט, הוא ילך על זה.',
};

// ═══════════════════════════════════════════════════════
// ROOM CLOSED — the server retired the room
// Rooms don't live forever: one closes a few minutes after the
// game ends, once everyone has left, or after a long silence.
// ═══════════════════════════════════════════════════════

const CLOSED_TEXT = {
  finished: { icon: 'flag', title: 'המשחק הסתיים',
              text: 'החדר נסגר אחרי סיום המשחק. פתחו חדר חדש כדי לשחק שוב.' },
  empty:    { icon: 'logOut', title: 'החדר נסגר',
              text: 'כל השחקנים יצאו מהחדר, אז הוא נסגר. אפשר לפתוח חדר חדש בכל רגע.' },
  idle:     { icon: 'moon', title: 'החדר נסגר',
              text: 'לא הייתה פעילות בחדר במשך זמן רב, אז הוא נסגר. פתחו חדר חדש כדי להמשיך.' },
};

function RoomClosed({ reason }) {
  const t = CLOSED_TEXT[reason] || CLOSED_TEXT.idle;
  // Back to a clean home screen, so the dead room isn't pre-filled and tapping
  // "הצטרף" doesn't look like it should still work.
  const home = leaveRoom;
  return (
    <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 6 }}><Icon name={t.icon} size={44} color={FELT} strokeWidth={1.8} /></div>
        <h2 style={{ margin: '0 0 6px', color: FELTD, fontSize: 20 }}>{t.title}</h2>
        <p style={{ color: '#57534e', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>{t.text}</p>
        <button onClick={home} style={primaryBtn}><IconLabel name="home">חזרה למסך הבית</IconLabel></button>
      </div>
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
      background: CLOTH,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
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

// ── Small version label pinned to the corner of the screen, like any other app.
// Fixed to the viewport (not the card), clear of the iOS home indicator, and
// click-through so it can never swallow a tap. Sits below the rules modal.
function VersionTag() {
  return (
    <div style={{
      position: 'fixed', left: 10, bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
      fontSize: 10, color: 'rgba(255,255,255,.45)', letterSpacing: 0.5,
      direction: 'ltr', pointerEvents: 'none', zIndex: 50,
      textShadow: '0 1px 2px rgba(0,0,0,.5)',
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
      direction: 'rtl', fontSize: 18,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 10 }}><Icon name="cards" size={44} strokeWidth={1.8} /></div>
        {text}
        <VersionTag />
      </div>
    </div>
  );
}

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
// The ✕ that takes a computer player back out of the lobby.
const removeBtn = {
  width: 24, height: 24, borderRadius: 7, border: '2px solid #e7e5e4',
  background: '#fff', color: '#a8a29e', fontSize: 12, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1, padding: 0,
};

const errorStyle = {
  marginTop: 12, padding: '9px 12px', borderRadius: 10,
  background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
  fontSize: 13, textAlign: 'center',
};


// ═══════════════════════════════════════════════════════
// ERROR BOUNDARY
// A throw during render unmounts the whole tree, which on this
// dark-green page looks identical to "nothing happened". Catch it
// and say so instead.
// ═══════════════════════════════════════════════════════

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error('Mantel crashed during render:', err, info);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 6 }}><Icon name="cards" size={44} color={FELT} strokeWidth={1.8} /></div>
          <h2 style={{ margin: '0 0 6px', color: FELTD, fontSize: 20 }}>משהו השתבש</h2>
          <p style={{ color: '#57534e', fontSize: 14, lineHeight: 1.6, margin: '0 0 14px' }}>
            המשחק נתקל בשגיאה בלתי צפויה. טעינה מחדש בדרך כלל פותרת את זה.
          </p>
          <button onClick={() => location.reload()} style={primaryBtn}><IconLabel name="refresh">טען מחדש</IconLabel></button>
          <code style={{
            display: 'block', marginTop: 12, padding: '8px 10px', borderRadius: 8,
            background: '#f5f5f4', color: '#b91c1c', fontSize: 12,
            direction: 'ltr', textAlign: 'left', whiteSpace: 'pre-wrap',
            wordBreak: 'break-all', maxHeight: 120, overflow: 'auto',
          }}>
            {String(this.state.err && this.state.err.message ? this.state.err.message : this.state.err)}
          </code>
        </div>
      </Shell>
    );
  }
}

// ── Mount ──
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
