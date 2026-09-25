// ═══════════════════════════════════════════════════════
// ROOM SETUP — the practice table and the online room
// Pick the table size and either the bots' level (practice) or
// the entry fee (online), then PLAY. The prize maths comes from
// economy.js, the same code that settles the game at the end.
// ═══════════════════════════════════════════════════════

import { useState } from "react";
import { GOLD, GOLDD, FELTD, CREAM, AI_LEVELS, AI_LEVEL_NAMES } from "../game-core.js";
import { ENTRY_FEES, DEFAULT_FEE, prizeShares, shortNum, buyPrice } from "../economy.js";
import { Icon, IconLabel } from "./icons.jsx";
import { LINE, SOFT, CARD, CARD_LINE, MUTED, hubBtn, hubInput, hubError, Modal, DemoTag } from "./account.jsx";

// ── One setting: a big value over its name, with − / + under it ──
function Stepper({ value, unit, label, onMinus, onPlus, canMinus, canPlus }) {
  const half = (on, can, icon, side) => (
    <button onClick={on} disabled={!can} style={{
      flex: 1, height: 46, cursor: can ? 'pointer' : 'default', border: 'none',
      background: 'linear-gradient(#2a5591, #173463)', color: can ? '#fff' : 'rgba(255,255,255,.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderInlineStart: side === 'end' ? `1px solid ${LINE}` : 'none',
    }}><Icon name={icon} size={22} strokeWidth={3} /></button>
  );
  return (
    <div style={{ flex: '1 1 130px', minWidth: 120, textAlign: 'center' }}>
      <div style={{ fontSize: 50, fontWeight: 800, lineHeight: 1, color: FELTD, direction: 'ltr', whiteSpace: 'nowrap' }}>
        {value}{unit && <span style={{ fontSize: 26, color: MUTED, marginInlineStart: 2 }}>{unit}</span>}
      </div>
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${FELTD}66, transparent)`, margin: '10px 12px 6px' }} />
      <div style={{ color: GOLDD, fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{label}</div>
      {/* The pair keeps − on the left and + on the right, as on any stepper,
          whatever the page direction. */}
      <div style={{
        display: 'flex', direction: 'ltr', borderRadius: 14, overflow: 'hidden',
        border: `2px solid ${GOLD}`, maxWidth: 150, margin: '0 auto',
      }}>
        {half(onMinus, canMinus, 'minus', 'start')}
        {half(onPlus, canPlus, 'plus', 'end')}
      </div>
    </div>
  );
}

function Side({ children }) {
  return (
    <div style={{
      flex: '1 1 220px', minWidth: 200, padding: '18px 16px', borderRadius: 20, background: CARD,
      border: `2px solid ${CARD_LINE}`, textAlign: 'center', alignSelf: 'stretch',
      boxShadow: '0 8px 24px rgba(19, 40, 79, .12)',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6,
    }}>{children}</div>
  );
}

const Row = ({ children }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', justifyContent: 'center', marginTop: 8 }}>
    {children}
  </div>
);

// ═══════════════════════════════════════════════════════
// PRACTICE — you against bots, free, no rewards
// ═══════════════════════════════════════════════════════

export function PracticeSetup({ busy, error, onPlay }) {
  const [players, setPlayers] = useState(4);
  const [li, setLi] = useState(0);   // index into AI_LEVELS
  return (
    <>
      <Row>
        <Stepper value={players} unit="P" label="שחקנים"
                 canMinus={players > 2} canPlus={players < 6}
                 onMinus={() => setPlayers(players - 1)} onPlus={() => setPlayers(players + 1)} />
        <Stepper value={AI_LEVEL_NAMES[AI_LEVELS[li]]} label="רמה"
                 canMinus={li > 0} canPlus={li < AI_LEVELS.length - 1}
                 onMinus={() => setLi(li - 1)} onPlus={() => setLi(li + 1)} />
        <Side>
          <div style={{ fontSize: 22, fontWeight: 700 }}>דמי כניסה:</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: GOLDD }}>חינם</div>
          <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginTop: 6 }}>
            * ניצחון במצב אימון לא מזכה בנקודות, גביעים או מטבעות.<br />
            את/ה מול {players - 1} שחקני מחשב.
          </div>
        </Side>
      </Row>
      <PlayBar busy={busy} error={error} onPlay={() => onPlay({ seats: players, level: AI_LEVELS[li] })} />
    </>
  );
}

// ═══════════════════════════════════════════════════════
// ONLINE ROOM — entry fee, prize pot by place
// ═══════════════════════════════════════════════════════

export function OnlineSetup({ coins, busy, error, onPlay, onGetCoins }) {
  const [players, setPlayers] = useState(3);
  const [fi, setFi] = useState(Math.max(0, ENTRY_FEES.indexOf(DEFAULT_FEE)));
  const fee = ENTRY_FEES[fi];
  const pot = fee * players;
  const shares = prizeShares(players);
  const short = coins < fee;
  return (
    <>
      <Row>
        <Stepper value={players} unit="P" label="שחקנים"
                 canMinus={players > 2} canPlus={players < 6}
                 onMinus={() => setPlayers(players - 1)} onPlus={() => setPlayers(players + 1)} />
        <Stepper value={shortNum(fee).replace(/K$/, '')} unit={fee >= 1000 ? 'K' : ''} label="דמי כניסה"
                 canMinus={fi > 0} canPlus={fi < ENTRY_FEES.length - 1}
                 onMinus={() => setFi(fi - 1)} onPlus={() => setFi(fi + 1)} />
        <Side>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="coins" color="#ca8a04" size={30} />
            <span style={{ fontSize: 44, fontWeight: 800, direction: 'ltr' }}>{shortNum(pot)}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>סה״כ פרס</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {shares.map((pct, i) => (
              <span key={i} style={{
                padding: '3px 9px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                background: '#fff', border: '1px solid #e7e5e4',
              }}>
                מקום {i + 1}: {Math.floor(pot * pct / 100).toLocaleString('en-US')}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
            משחקים מול אנשים בלבד (מול המחשב — באימון).<br />
            קנייה עם קנס: <b>{buyPrice(fee)} מטבעות</b> — נכנסים לקופה.<br />
            הקופה לפי מספר השחקנים שיושבים כשהמשחק מתחיל, ועוד הקניות. עוזבים באמצע? מה ששילמתם נשאר בקופה.
          </div>
        </Side>
      </Row>
      {short && (
        <div style={{ ...hubError, maxWidth: 420, margin: '14px auto 0' }}>
          אין מספיק מטבעות לדמי הכניסה ({fee.toLocaleString('en-US')}).{' '}
          <button onClick={onGetCoins} style={{ background: 'none', border: 'none', color: '#b91c1c', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
            לחנות
          </button>
        </div>
      )}
      <PlayBar busy={busy} error={error} disabled={short} label="צור חדר"
               onPlay={() => onPlay({ seats: players, fee })} />
    </>
  );
}

function PlayBar({ busy, error, disabled, onPlay, label = 'PLAY' }) {
  return (
    <div style={{ maxWidth: 440, margin: '26px auto 0' }}>
      <button onClick={onPlay} disabled={busy || disabled}
              style={{ ...hubBtn, fontSize: 26, padding: '14px 0', opacity: busy || disabled ? 0.55 : 1 }}>
        {busy ? '...' : label}
      </button>
      {error && <div style={hubError}>{error}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// JOIN — type a room code
// ═══════════════════════════════════════════════════════

export function JoinDialog({ code, setCode, busy, error, onJoin, onClose }) {
  return (
    <Modal onClose={onClose} width={340}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Icon name="users" size={40} color={GOLD} strokeWidth={1.7} />
        <h2 style={{ margin: '4px 0 2px', fontSize: 21 }}>הצטרפות לחדר</h2>
        <div style={{ color: SOFT, fontSize: 12.5 }}>הקלידו את קוד החדר שקיבלתם</div>
      </div>
      <form onSubmit={e => { e.preventDefault(); onJoin(); }}>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD" maxLength={4}
               autoFocus
               style={{ ...hubInput, letterSpacing: 8, textAlign: 'center', fontSize: 26, fontWeight: 800 }} />
        <button type="submit" disabled={busy} style={{ ...hubBtn, fontSize: 18 }}>
          {busy ? '...' : <IconLabel name="play">הצטרף</IconLabel>}
        </button>
      </form>
      {error && <div style={hubError}>{error}</div>}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════
// ROOM TERMS — the strip the waiting room shows at the top
// ═══════════════════════════════════════════════════════

// Drawn on the cream lobby card. `players` is how many are seated now.
export function RoomTerms({ lobby, coins }) {
  if (!lobby || lobby.mode !== 'online' || !lobby.fee) return null;
  const n = (lobby.players || []).length;
  const pot = lobby.fee * Math.max(n, 2);
  const short = coins != null && coins < lobby.fee;
  return (
    <div style={{
      marginBottom: 14, padding: '10px 12px', borderRadius: 13,
      background: FELTD, color: CREAM, border: `2px solid ${GOLD}88`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: SOFT }}>דמי כניסה</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: GOLD, direction: 'ltr' }}>
            <Icon name="coins" size={15} /> {lobby.fee.toLocaleString('en-US')}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: SOFT }}>קופה עכשיו ({Math.max(n, 2)} שחקנים)</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#facc15', direction: 'ltr' }}>
            <Icon name="coins" size={15} /> {pot.toLocaleString('en-US')}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11.5, color: SOFT, marginTop: 6 }}>
        קנייה עם קנס: {buyPrice(lobby.fee)} מטבעות, נכנסים לקופה
      </div>
      <div style={{ textAlign: 'center', marginTop: 6 }}><DemoTag /></div>
      {short && (
        <div style={{ ...hubError, marginTop: 8 }}>
          אין לך מספיק מטבעות לדמי הכניסה. אפשר להשיג עוד בחנות.
        </div>
      )}
    </div>
  );
}
