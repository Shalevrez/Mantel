// ═══════════════════════════════════════════════════════
// ACCOUNT SCREENS — sign-in, the top bar, the home menu,
// the profile sheet and the leaderboard.
// Everything here runs on the demo profile in profile.js: the
// wallet, XP and trophies live in this browser only.
// ═══════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { FELT, FELTD, GOLD, GOLDD, CREAM, CLOTH } from "../game-core.js";
import { levelInfo, shortNum } from "../economy.js";
import { Icon, IconLabel } from "./icons.jsx";
import * as P from "./profile.js";

// ── Palette for the hub screens ──────────────────────
// The menus sit on the checkered tablecloth, like the waiting room, with
// navy strips top and bottom. PANEL/SOFT are for the navy parts (the bars,
// the modals); CARD/MUTED for what sits on the cloth.
export const HUB_BG = CLOTH;
export const PANEL = 'rgba(8, 20, 45, .55)';
export const LINE = 'rgba(201, 151, 58, .45)';
export const SOFT = '#9fb3d1';
export const CARD = 'rgba(255, 255, 255, .9)';
export const CARD_LINE = `${GOLD}77`;
export const MUTED = '#57534e';

// The profile the app is signed in as, kept in step with every change.
export function useProfile() {
  const [profile, setProfile] = useState(P.current);
  useEffect(() => P.subscribe(u => setProfile(u ? { ...u } : null)), []);
  return profile;
}

// A small "this is a demo" tag, shown wherever coins or accounts appear.
export function DemoTag({ style }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      background: '#fce7f3', border: '1px solid #f9a8d4',
      color: '#be185d', fontSize: 10.5, fontWeight: 700, letterSpacing: .5,
      whiteSpace: 'nowrap', ...style,
    }}>מצב הדגמה</span>
  );
}

// ── Avatar ───────────────────────────────────────────
// A round badge with the name's first letter and the level on a star.
const AVATAR_COLORS = ['#2563eb', '#16a34a', '#db2777', '#7c3aed', '#ea580c', '#0891b2'];
function avatarColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function Avatar({ profile, size = 46, level }) {
  const letter = (profile.displayName || '?').trim().charAt(0) || '?';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: avatarColor(profile.id), color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: size * 0.44,
        border: `2.5px solid ${GOLD}`, boxShadow: '0 0 0 2px rgba(0,0,0,.35)',
      }}>{letter}</div>
      {level != null && (
        <div style={{
          position: 'absolute', bottom: -4, left: -6, minWidth: 22, height: 22, padding: '0 4px',
          borderRadius: 11, background: GOLD, color: FELTD, fontSize: 12, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${FELTD}`,
        }}>{level}</div>
      )}
    </div>
  );
}

// ── Top bar ──────────────────────────────────────────
// Who's playing, their level and progress to the next, trophies, and
// the wallet with its "get coins" button — on every hub screen.
export function TopBar({ profile, onProfile, onCoins, onSettings }) {
  const lv = levelInfo(profile.xp);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 14px', background: FELTD,
      borderBottom: `1px solid ${LINE}`,
    }}>
      <button onClick={onProfile} style={{
        display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none',
        padding: 0, cursor: 'pointer', color: CREAM, minWidth: 0,
      }} title="הפרופיל שלי">
        <Avatar profile={profile} size={42} level={lv.level} />
        <div style={{ minWidth: 0, textAlign: 'start' }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
            {profile.displayName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            <div style={{ width: 70, height: 6, borderRadius: 3, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.round(100 * lv.into / lv.need)}%`, height: '100%',
                background: 'linear-gradient(90deg, #a855f7, #38bdf8)',
              }} />
            </div>
            <span style={{ fontSize: 10, color: SOFT, direction: 'ltr' }}>{shortNum(lv.into)}/{shortNum(lv.need)}</span>
          </div>
        </div>
      </button>

      <div style={{ flex: 1 }} />

      <Pill icon="trophy" color={GOLD} value={profile.trophies.toLocaleString('en-US')} title="גביעים — הדירוג שלך" />
      <Pill icon="coins" color="#facc15" value={profile.coins.toLocaleString('en-US')} title="מטבעות"
            action={onCoins && (
              <button onClick={onCoins} style={{
                marginInlineStart: 6, padding: '4px 10px', borderRadius: 99, cursor: 'pointer',
                background: `linear-gradient(${GOLD}, #a37624)`, color: FELTD,
                border: 'none', fontWeight: 800, fontSize: 11.5, whiteSpace: 'nowrap',
              }}>קבל מטבעות</button>
            )} />
      {onSettings && (
        <button onClick={onSettings} title="הגדרות" style={{
          width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
          background: PANEL, border: `1px solid ${LINE}`, color: GOLD,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="gear" size={20} /></button>
      )}
    </div>
  );
}

function Pill({ icon, color, value, title, action }) {
  return (
    <div title={title} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 12px',
      paddingInlineStart: 10, borderRadius: 99, background: PANEL,
      border: `1px solid ${LINE}`, color: CREAM, fontWeight: 700, fontSize: 15,
    }}>
      <Icon name={icon} color={color} size={18} />
      <span style={{ fontVariantNumeric: 'tabular-nums', direction: 'ltr' }}>{value}</span>
      {action}
    </div>
  );
}

// ── Hub frame ────────────────────────────────────────
// Top bar, the screen itself, and a bottom strip with the way back and
// the screen's name (the layout of the reference game's menus).
export function Hub({ profile, title, onBack, onProfile, onCoins, onSettings, children, footer }) {
  return (
    <div style={{
      minHeight: '100dvh', background: HUB_BG, color: FELTD, direction: 'rtl',
      display: 'flex', flexDirection: 'column',
    }}>
      <TopBar profile={profile} onProfile={onProfile} onCoins={onCoins} onSettings={onSettings} />
      <div style={{ flex: 1, padding: '18px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 820 }}>{children}</div>
      </div>
      {(onBack || title || footer) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
          paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(5, 14, 32, .94)', borderTop: `1px solid ${LINE}`, color: CREAM,
          // Stays on screen while a long page scrolls under it.
          position: 'sticky', bottom: 0, zIndex: 20,
        }}>
          {onBack && (
            <button onClick={onBack} title="חזרה" style={{
              width: 44, height: 40, borderRadius: 10, cursor: 'pointer',
              background: 'rgba(56, 189, 248, .12)', border: `1px solid rgba(56, 189, 248, .45)`,
              color: '#7dd3fc', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="arrowRight" size={20} /></button>
          )}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>{footer}</div>
          {title && <div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div>}
        </div>
      )}
    </div>
  );
}

// The main action on a hub screen — navy and gold, like the table's own buttons.
export const hubBtn = {
  padding: '13px 0', width: '100%', borderRadius: 14, cursor: 'pointer',
  background: `linear-gradient(${FELT}, ${FELTD})`, color: GOLD,
  border: `2px solid ${GOLD}`, fontSize: 19, fontWeight: 800, letterSpacing: 1,
  boxShadow: `0 6px 22px ${FELT}66`,
};
export const hubInput = {
  width: '100%', padding: '12px 14px', borderRadius: 11, fontSize: 15,
  background: 'rgba(255,255,255,.95)', color: FELTD, border: `1.5px solid ${LINE}`,
  outline: 'none', marginBottom: 10,
};
export const hubError = {
  marginTop: 10, padding: '9px 12px', borderRadius: 10, fontSize: 13, textAlign: 'center',
  background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
};

// ═══════════════════════════════════════════════════════
// SIGN-IN
// ═══════════════════════════════════════════════════════

export function LoginScreen() {
  const [tab, setTab] = useState('guest'); // guest | password | google
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [display, setDisplay] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Each sign-in path returns { user } or { error }; success needs no
  // handling here — the app follows the profile and leaves this screen.
  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.error) setError(r.error);
    } finally { setBusy(false); }
  }

  const tabs = [
    { key: 'guest', label: 'אורח', icon: 'user' },
    { key: 'password', label: 'שם וסיסמה', icon: 'hash' },
    { key: 'google', label: 'Google', icon: 'sparkles' },
  ];

  return (
    <div style={{
      minHeight: '100dvh', background: HUB_BG, color: FELTD, direction: 'rtl',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: CREAM, borderRadius: 22,
        border: `2px solid ${GOLD}77`, padding: '26px 22px',
        boxShadow: `0 24px 72px rgba(0,0,0,.35), 0 0 0 3px ${GOLD}55`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 50, marginBottom: 2 }}>🃏</div>
          <h1 style={{ margin: 0, fontSize: 32, color: FELTD, letterSpacing: 2 }}>מנטל</h1>
          <div style={{ width: 50, height: 2, background: GOLD, margin: '8px auto' }} />
          <div style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>התחברו כדי לשמור מטבעות, רמה ודירוג</div>
          <DemoTag style={{ marginTop: 8 }} />
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setError(''); }} style={{
              flex: 1, padding: '9px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              background: tab === t.key ? FELT : '#fff',
              color: tab === t.key ? GOLD : MUTED,
              border: `2px solid ${tab === t.key ? FELT : '#e7e5e4'}`,
            }}><IconLabel name={t.icon}>{t.label}</IconLabel></button>
          ))}
        </div>

        {tab === 'guest' && (
          <>
            <p style={{ color: MUTED, fontSize: 13.5, lineHeight: 1.6, margin: '0 0 14px' }}>
              נכנסים מיד, בלי הרשמה. אפשר לשמור את החשבון עם שם משתמש וסיסמה בכל רגע, מתוך הפרופיל,
              בלי לאבד את מה שצברתם.
            </p>
            <button disabled={busy} onClick={() => run(async () => P.loginGuest())} style={hubBtn}>
              <IconLabel name="play">שחק כאורח</IconLabel>
            </button>
          </>
        )}

        {tab === 'password' && (
          <form onSubmit={e => {
            e.preventDefault();
            run(() => mode === 'login' ? P.login(username, password) : P.register(username, password, display));
          }}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="שם משתמש"
                   autoComplete="username" maxLength={16} style={hubInput} />
            <input value={password} onChange={e => setPassword(e.target.value)} placeholder="סיסמה" type="password"
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'} style={hubInput} />
            {mode === 'register' && (
              <input value={display} onChange={e => setDisplay(e.target.value)} placeholder="שם תצוגה במשחק (לא חובה)"
                     maxLength={16} style={hubInput} />
            )}
            <button type="submit" disabled={busy} style={{ ...hubBtn, marginTop: 4 }}>
              {mode === 'login' ? 'התחבר' : 'הירשם'}
            </button>
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
                    style={linkBtn}>
              {mode === 'login' ? 'אין לך חשבון? להרשמה' : 'כבר יש לך חשבון? להתחברות'}
            </button>
          </form>
        )}

        {tab === 'google' && (
          <form onSubmit={e => { e.preventDefault(); run(async () => P.loginGoogleDemo(display, email)); }}>
            <p style={{ color: MUTED, fontSize: 12.5, lineHeight: 1.6, margin: '0 0 12px' }}>
              זו התחברות מדומה: לא נפתח חלון של Google ושום פרט לא נשלח. אותה כתובת תחזיר תמיד לאותו פרופיל בדפדפן הזה.
            </p>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="כתובת Gmail"
                   type="email" autoComplete="email" style={{ ...hubInput, direction: 'ltr', textAlign: 'right' }} />
            <input value={display} onChange={e => setDisplay(e.target.value)} placeholder="שם תצוגה (לא חובה)"
                   maxLength={16} style={hubInput} />
            <button type="submit" disabled={busy} style={{
              ...hubBtn, background: '#fff', color: '#1f2937', boxShadow: 'none', border: '2px solid #d6d3d1',
            }}>
              <span style={{ fontWeight: 800 }}>
                <span style={{ color: '#4285f4' }}>G</span> המשך עם Google
              </span>
            </button>
          </form>
        )}

        {error && <div style={hubError}>{error}</div>}
      </div>
    </div>
  );
}

const linkBtn = {
  width: '100%', padding: '10px 0', background: 'transparent', color: FELT,
  border: 'none', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginTop: 6,
};

// ═══════════════════════════════════════════════════════
// HOME MENU — the big cards
// ═══════════════════════════════════════════════════════

// `items`: [{ key, title, sub, icon, suit, badge, onClick }]
// Each card is drawn like one of the game's own cards turned over: the navy
// back with its gold frame, a suit in two corners (red for ♥ ♦), and the
// icon in gold on a cream disc.
const RED_SUITS = new Set(['♥', '♦']);
export function MenuCards({ items }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14,
    }}>
      {items.map(it => {
        const suitColor = RED_SUITS.has(it.suit) ? '#f87171' : CREAM;
        const corner = (pos) => it.suit && (
          <span style={{
            position: 'absolute', ...pos, fontSize: 18, lineHeight: 1, color: suitColor, opacity: .75,
          }}>{it.suit}</span>
        );
        return (
          <button key={it.key} onClick={it.onClick} style={{
            position: 'relative', minHeight: 150, borderRadius: 18, cursor: 'pointer',
            background: `linear-gradient(160deg, ${FELT}, ${FELTD})`,
            border: `2px solid ${GOLD}`,
            boxShadow: `0 10px 26px rgba(19, 40, 79, .35), inset 0 0 0 4px ${FELTD}, inset 0 0 0 5px ${GOLD}55`,
            color: CREAM, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 8, padding: '18px 10px',
          }}>
            {corner({ top: 10, right: 12 })}
            {corner({ bottom: 10, left: 12, transform: 'rotate(180deg)' })}
            {it.badge && (
              <span style={{
                position: 'absolute', top: 10, left: 10, padding: '2px 8px', borderRadius: 99,
                background: GOLD, fontSize: 11, fontWeight: 800, color: FELTD,
              }}>{it.badge}</span>
            )}
            <span style={{
              width: 62, height: 62, borderRadius: '50%', background: CREAM,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 0 2px ${GOLD}, 0 4px 12px rgba(0,0,0,.35)`,
            }}>
              <Icon name={it.icon} size={34} strokeWidth={1.8} color={FELT} />
            </span>
            <div style={{ fontSize: 19, fontWeight: 800, color: GOLD }}>{it.title}</div>
            {it.sub && <div style={{ fontSize: 12, color: '#c7d2e3', lineHeight: 1.4 }}>{it.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SETTINGS — a place for them; nothing to set yet
// ═══════════════════════════════════════════════════════

export function SettingsSheet({ onClose, version }) {
  return (
    <Modal onClose={onClose} width={360}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <Icon name="gear" size={40} color={GOLD} strokeWidth={1.7} />
        <h2 style={{ margin: '6px 0 2px', fontSize: 21 }}>הגדרות</h2>
      </div>
      <div style={{
        padding: '18px 14px', borderRadius: 12, border: `1px dashed ${LINE}`,
        color: SOFT, fontSize: 13.5, textAlign: 'center', lineHeight: 1.6,
      }}>
        עוד אין כאן הגדרות.<br />בקרוב: צלילים, רטט, מראה הקלפים ועוד.
      </div>
      {version && (
        <div style={{ textAlign: 'center', color: SOFT, fontSize: 11.5, marginTop: 12, direction: 'ltr' }}>v{version}</div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════
// PROFILE SHEET — stats, rename, save a guest, sign out
// ═══════════════════════════════════════════════════════

export function ProfileSheet({ profile, onClose }) {
  const [name, setName] = useState(profile.displayName);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const lv = levelInfo(profile.xp);
  const provider = { guest: 'אורח', password: 'שם משתמש וסיסמה', google: 'Google (דמו)' }[profile.provider];

  async function save() {
    setError(''); setMsg('');
    const r = await P.upgradeGuest(username, password);
    if (r.error) setError(r.error); else setMsg('החשבון נשמר! מעכשיו אפשר להתחבר עם שם המשתמש והסיסמה.');
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Avatar profile={profile} size={56} level={lv.level} />
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{profile.displayName}</div>
          <div style={{ fontSize: 12, color: SOFT }}>
            {provider}{profile.username ? ` · ${profile.username}` : ''}{profile.email ? ` · ${profile.email}` : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
        <Stat label="רמה" value={lv.level} />
        <Stat label="גביעים" value={profile.trophies} />
        <Stat label="משחקים" value={profile.games} />
        <Stat label="ניצחונות" value={profile.wins} />
      </div>

      <div style={{ fontSize: 12.5, color: SOFT, marginBottom: 6 }}>שם במשחק</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={16} style={{ ...hubInput, marginBottom: 0 }} />
        <button onClick={() => { P.rename(name); setMsg('השם עודכן'); }} style={smallBtn}>שמור</button>
      </div>

      {profile.provider === 'guest' && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: `1px dashed ${LINE}` }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>שמירת החשבון</div>
          <div style={{ fontSize: 12, color: SOFT, marginBottom: 8, lineHeight: 1.5 }}>
            בחרו שם משתמש וסיסמה כדי לחזור לפרופיל הזה גם אחרי התנתקות.
          </div>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="שם משתמש" maxLength={16} style={hubInput} />
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="סיסמה" type="password" style={hubInput} />
          <button onClick={save} style={{ ...smallBtn, width: '100%' }}>שמור חשבון</button>
        </div>
      )}

      {msg && <div style={{ ...hubError, background: 'rgba(22,163,74,.18)', borderColor: 'rgba(74,222,128,.6)', color: '#bbf7d0' }}>{msg}</div>}
      {error && <div style={hubError}>{error}</div>}

      <button onClick={() => { P.logout(); onClose(); }} style={{ ...linkBtn, color: '#fca5a5', marginTop: 14 }}>
        <IconLabel name="logOut">התנתקות</IconLabel>
      </button>
      {profile.provider === 'guest' && (
        <div style={{ fontSize: 11, color: SOFT, textAlign: 'center' }}>
          אורח שמתנתק בלי לשמור חשבון לא יוכל לחזור לפרופיל הזה.
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: GOLD }}>{value}</div>
      <div style={{ fontSize: 11, color: SOFT }}>{label}</div>
    </div>
  );
}

export const smallBtn = {
  padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 800, fontSize: 14,
  background: GOLD, color: FELTD, border: 'none', whiteSpace: 'nowrap',
};

export function Modal({ children, onClose, width = 400 }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, direction: 'rtl',
    }}>
      <div className="rules-card" onClick={e => e.stopPropagation()} style={{
        position: 'relative', width: '100%', maxWidth: width, overflowY: 'auto',
        background: `linear-gradient(${FELT}, ${FELTD})`, color: CREAM,
        borderRadius: 20, border: `1.5px solid ${LINE}`, padding: '22px 20px',
        boxShadow: '0 24px 72px rgba(0,0,0,.6)',
      }}>
        <button onClick={onClose} title="סגור" style={{
          position: 'absolute', top: 12, left: 12, width: 30, height: 30, borderRadius: 9,
          background: 'rgba(255,255,255,.08)', border: 'none', color: SOFT, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="x" size={14} strokeWidth={3} /></button>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════

export function LeaderboardList() {
  const rows = P.leaderboard();
  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Icon name="trophy" size={44} color={GOLD} strokeWidth={1.6} />
        <h2 style={{ margin: '4px 0', fontSize: 24 }}>טבלת הדירוג</h2>
        <div style={{ color: MUTED, fontSize: 12.5 }}>
          לפי גביעים. הפרופילים מהדפדפן הזה, ולצידם יריבים לדוגמה.
        </div>
        <DemoTag style={{ marginTop: 6 }} />
      </div>
      {rows.map((r, i) => (
        <div key={r.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 6,
          borderRadius: 12, background: r.you ? '#fefce8' : CARD,
          border: `2px solid ${r.you ? GOLD : '#e7e5e4'}`,
        }}>
          <span style={{
            width: 28, textAlign: 'center', fontWeight: 800,
            color: i === 0 ? '#ca8a04' : i === 1 ? '#9ca3af' : i === 2 ? '#c2410c' : MUTED,
          }}>{i + 1}</span>
          <span style={{ flex: 1, fontWeight: 700 }}>
            {r.name}
            {r.you && <span style={{ color: GOLDD, fontWeight: 400 }}> (את/ה)</span>}
            {r.rival && <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}> · לדוגמה</span>}
          </span>
          <span style={{ color: MUTED, fontSize: 12 }}>רמה {levelInfo(r.xp).level}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, minWidth: 56, justifyContent: 'flex-end' }}>
            <Icon name="trophy" color={GOLD} size={15} />{r.trophies}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GAME REWARD — what the game over screen adds for you
// ═══════════════════════════════════════════════════════

// `r` is this seat's settlement: { place, prize, paid, xp, trophies } — `paid`
// is the entry fee plus the buys. Drawn on the cream game-over card, so in its
// colours.
export function RewardStrip({ r, fee }) {
  if (!r) return null;
  const net = r.prize - (r.paid ?? fee ?? 0);
  const item = (icon, color, text, sub) => (
    <div style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: '#fff', border: '1.5px solid #e7e5e4' }}>
      <div style={{ color, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 16, direction: 'ltr' }}>
        <Icon name={icon} size={16} />{text}
      </div>
      <div style={{ fontSize: 11, color: '#78716c' }}>{sub}</div>
    </div>
  );
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {item('star', '#7c3aed', `+${r.xp}`, 'XP')}
        {item('trophy', r.trophies >= 0 ? '#16a34a' : '#b91c1c', `${r.trophies >= 0 ? '+' : ''}${r.trophies}`, 'גביעים')}
        {fee > 0 && item('coins', '#a16207', `+${r.prize.toLocaleString('en-US')}`,
                        net >= 0 ? `פרס (רווח ${net.toLocaleString('en-US')})` : `פרס (הפסד ${(-net).toLocaleString('en-US')})`)}
      </div>
      <div style={{ textAlign: 'center', marginTop: 5 }}>
        <span style={{ fontSize: 10.5, color: '#be185d' }}>מצב הדגמה — נשמר בדפדפן הזה בלבד</span>
      </div>
    </div>
  );
}
