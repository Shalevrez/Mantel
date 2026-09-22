// ═══════════════════════════════════════════════════════
// UI COMPONENTS — presentational React for the online game.
// Adapted from the original single-file game. Game logic now
// lives on the server (game-core via the Worker); here `state`
// arrives already-redacted and `dispatch` sends actions to it.
// ═══════════════════════════════════════════════════════

import { useState, useReducer, useEffect, useRef } from "react";
import {
  SUITS, SYM, COL, VD, cSc, cTxt, MK, FELT, FELTD, GOLD, CREAM,
  isSeq, isSet, isGroup, orderSeq, orderGroup, jokerValues, attachPos, meetsReq,
  sortHand,
} from "../game-core.js";
import { RELEASES } from "../releases.js";


// Card geometry comes from --card-w/--card-h (declared in Game's stylesheet), so
// one media query resizes every card, pip and corner at once. The fallbacks keep
// a CardView rendered outside the game screen at the original size.
const CARD_W    = 'var(--card-w, 44px)';
const CARD_H    = 'var(--card-h, 62px)';
const CARD_W_SM = 'var(--card-w-sm, 26px)';
const CARD_H_SM = 'var(--card-h-sm, 38px)';

// Wipe any text selection the browser started on its own. Called when a long
// press turns into a card drag, and again when the drag ends.
function clearSelection() {
  try {
    const s = window.getSelection && window.getSelection();
    if (s && s.rangeCount) s.removeAllRanges();
  } catch { /* nothing selectable — fine */ }
}

function CardView({ card, sel, onClick, sm, back, glow, faded, newCard }) {
  const w = sm ? CARD_W_SM : CARD_W;
  const h = sm ? CARD_H_SM : CARD_H;
  // Everything inside a card is a ratio of its height, so it scales with it.
  const fs = (ratio) => `calc(${h} * ${ratio})`;
  const radius = `calc(${h} * .1)`;

  if (back) return (
    <div style={{
      width: w, height: h,
      borderRadius: radius, flexShrink: 0, margin: sm ? '0 1px' : '0 2px',
      background: 'linear-gradient(145deg,#234a8c 0%,#13284f 60%,#0c1d3c 100%)',
      border: `1.5px solid #36589c`,
      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,.05) 3px, rgba(255,255,255,.05) 6px),
                        radial-gradient(circle at 50% 50%, rgba(201,151,58,.18), transparent 60%)`,
      boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.04), 0 2px 6px rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ color: 'rgba(201,151,58,.55)', fontSize: fs(.29) }}>♦</span>
    </div>
  );

  const color = card.j ? '#fff' : COL[card.suit];
  const vs = card.j ? 'JK' : VD(card.v);
  const sym = card.j ? '★' : SYM[card.suit];
  const isFace = !card.j && (card.v === 1 || card.v >= 11);

  const inY = `calc(${h} * .045)`, inX = `calc(${w} * .09)`;
  const corner = (rotate) => (
    <div style={{
      position: 'absolute', lineHeight: 0.82, textAlign: 'center', color,
      ...(rotate
        ? { bottom: inY, left: inX, transform: 'rotate(180deg)' }
        : { top: inY, right: inX }),
    }}>
      <div style={{ fontSize: fs(.18), fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{vs}</div>
      <div style={{ fontSize: fs(.145) }}>{sym}</div>
    </div>
  );

  return (
    <div onClick={onClick} style={{
      position: 'relative',
      width: w, height: h,
      borderRadius: radius, flexShrink: 0, margin: sm ? '0 1px' : '0 2px',
      background: card.j
        ? 'linear-gradient(150deg,#7c3aed 0%,#9f67f5 50%,#5b21b6 100%)'
        : 'linear-gradient(157deg,#ffffff 0%,#fbf6ec 55%,#f1e7d6 100%)',
      border: sel ? '2px solid #60a5fa'
        : (newCard || glow) ? `2px solid ${GOLD}`
        : '1px solid rgba(0,0,0,.22)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: onClick ? 'pointer' : 'default', userSelect: 'none', overflow: 'hidden',
      transform: sel ? `translateY(calc(${h} * -.19)) scale(1.07)` : 'none',
      boxShadow: sel ? '0 11px 22px rgba(96,165,250,.55)'
        : newCard ? `0 0 0 3px ${GOLD}, 0 0 18px ${GOLD}88`
        : glow ? `0 0 12px ${GOLD}aa` : '0 2px 5px rgba(0,0,0,.32)',
      transition: 'transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .16s',
      opacity: faded ? 0.38 : 1,
      animation: newCard ? 'newCardPulse 1.6s ease-in-out infinite' : 'none',
    }}>
      {/* gloss highlight */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '42%',
        background: 'linear-gradient(180deg, rgba(255,255,255,.45), transparent)',
        pointerEvents: 'none',
      }} />
      {corner(false)}
      <div style={{
        fontSize: card.j ? fs(.32) : fs(.37),
        color, lineHeight: 1, fontWeight: card.j ? 800 : 400,
        textShadow: card.j ? '0 1px 2px rgba(0,0,0,.3)' : (isFace ? `0 0 1px ${color}55` : 'none'),
        zIndex: 1,
      }}>
        {card.j ? '★' : sym}
      </div>
      {!sm && corner(true)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GROUP ON BOARD
// ═══════════════════════════════════════════════════════

function GroupView({ group, onAttach, canAttach }) {
  const seq = group.type === 'seq';
  return (
    <div onClick={onAttach} data-gid={group.id} className="group-pop" style={{
      display: 'inline-flex', alignItems: 'center',
      background: seq ? 'rgba(34,197,94,.12)' : 'rgba(251,191,36,.12)',
      border: `2px solid ${canAttach ? '#60a5fa' : seq ? 'rgba(34,197,94,.45)' : 'rgba(251,191,36,.45)'}`,
      borderRadius: 10, padding: '5px 7px', margin: '3px 3px',
      cursor: canAttach ? 'pointer' : 'default',
      boxShadow: canAttach ? '0 0 0 3px rgba(96,165,250,.35)' : 'none',
      transition: 'box-shadow .15s',
    }}>
      {group.cards.map(c => <CardView key={c.id} card={c} sm />)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SETUP SCREEN
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// RULES POPUP
// ═══════════════════════════════════════════════════════

function RulesModal({ onClose }) {
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontWeight: 700, color: FELTD, fontSize: 15, marginBottom: 6,
        borderRight: `3px solid ${GOLD}`, paddingRight: 8,
      }}>{title}</div>
      <div style={{ color: '#44403c', fontSize: 13.5, lineHeight: 1.7 }}>{children}</div>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        direction: 'rtl', padding: 14,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rules-card"
        style={{
          background: CREAM, borderRadius: 20, maxWidth: 440, width: '100%',
          display: 'flex', flexDirection: 'column',
          border: `2px solid ${GOLD}88`, boxShadow: '0 24px 72px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          background: FELT, padding: '14px 18px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ color: GOLD, fontSize: 20, fontWeight: 700 }}>
            📖 חוקי רמי אקסטרים
          </span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.15)', color: CREAM, border: 'none',
            borderRadius: 8, width: 30, height: 30, fontSize: 18, cursor: 'pointer',
            fontWeight: 700, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
          <Section title="🎯 מטרת המשחק">
            המשחק מורכב מ־6 משחקונים. בכל משחקון מנסים להוריד את כל הקלפים מהיד.
            בסיום כל משחקון צוברים נקודות לפי הקלפים שנשארו ביד. <b>המנצח הוא בעל
            מספר הנקודות הנמוך ביותר</b> בסוף ששת המשחקונים.
          </Section>

          <Section title="🃏 הקלפים">
            משחקים עם 2 חפיסות + 4 ג׳וקרים (108 קלפים), ומחמישה שחקנים ומעלה עם
            3 חפיסות + 6 ג׳וקרים (162 קלפים) — אחרת החבילה נגמרת לפני שמישהו מספיק
            לסיים. אס יכול לשמש כ־1 (לפני 2) או כ־14 (אחרי מלך). הג׳וקר מחליף כל קלף.
          </Section>

          <Section title="🔢 ערך הקלפים (לניקוד)">
            קלפים 2–10 שווים את ערכם. אס, נסיך, מלכה, מלך וג׳וקר — 10 נקודות כל אחד.
            ככל שנשארים פחות קלפים ביד בסוף המשחקון, הניקוד נמוך יותר.
          </Section>

          <Section title="📋 6 המשחקונים">
            בכל משחקון יש דרישת פתיחה — מה צריך להוריד כדי "להיפתח":
            <ol style={{ margin: '6px 0', paddingRight: 18 }}>
              <li>שלישייה — רצף אחד של 3 קלפים לפחות</li>
              <li>שתי שלישיות — שני רצפים של 3+</li>
              <li>רביעייה — רצף אחד של 4 קלפים לפחות</li>
              <li>שתי רביעיות — שני רצפים של 4+</li>
              <li>חמישייה — רצף אחד של 5 קלפים לפחות</li>
              <li>שתי חמישיות — שני רצפים של 5+</li>
            </ol>
          </Section>

          <Section title="🧩 קבוצות חוקיות">
            <b>רצף</b> — 3 קלפים ומעלה רצופים מאותה צורה (למשל 5♥6♥7♥). האס לא
            "מקיף" (אי אפשר מלך־אס־2).<br/>
            <b>סדרה</b> — 3–4 קלפים מאותו ערך בצורות שונות (למשל 8♥8♣8♠).
          </Section>

          <Section title="🔄 מהלך תור">
            בכל תור: (1) <b>שולפים</b> קלף — מהחבילה, מראש האשפה, או את קלף הבית.
            (2) אפשר <b>להוריד</b> קבוצות ו<b>להצמיד</b> קלפים לקבוצות שכבר על השולחן.
            (3) מסיימים את התור ב<b>זריקת</b> קלף אחד לאשפה.
          </Section>

          <Section title="🛒 קנייה">
            כשמישהו זורק קלף, השחקן הבא בתור יכול לקחת אותו בחינם. אם הוא מוותר,
            שחקנים אחרים יכולים "לקנות" אותו — ומקבלים יחד איתו קלף עונשין מהחבילה.
            אם אף אחד לא לקח — הקלף נשרף והשחקן הבא שולף מהחבילה.
          </Section>

          <Section title="🏆 סיום משחקון (יציאה)">
            כדי לסיים, מורידים את כל הקלפים <b>חוץ מאחד</b>, וזורקים אותו לאשפה.
            תמיד חייבים לסיים את התור בזריקה — אי אפשר לסיים עם 0 קלפים בלי זריקה.
          </Section>

          <Section title="🎯 אנט (−50 נקודות!)">
            אם מורידים את <b>כל</b> היד בקבוצות חדשות משלך <b>בתור אחד</b> (ואז זורקים
            את הקלף האחרון) — זה <b>אנט</b>, ומקבלים בונוס של 50 נקודות פחות.<br/>
            ⚠️ אם הצמדת קלפים לקבוצות קיימות של אחרים — זה כבר ניצחון רגיל (0), לא אנט.
          </Section>

          <Section title="🃏 לקיחת ג׳וקר">
            אם על השולחן יש ג׳וקר בתוך רצף, ואתה מחזיק את הקלף האמיתי שהוא מחליף —
            אפשר להחליף: הקלף שלך נכנס לרצף, והג׳וקר חוזר לידך. <b>חובה להשתמש בו
            באותו תור</b> (להצמיד או להוריד בקבוצה חדשה) לפני הזריקה.
          </Section>

          <Section title="🏠 קלף הבית">
            במקום לשלוף, אפשר לקחת את "קלף הבית" — קלף גלוי שכולם רואים, מיועד
            לניסיון אנט. אם לא הסתדר, אפשר ללחוץ "↩️ החזר בית" כדי להחזיר אותו
            ולבחור שליפה אחרת.
          </Section>

          <Section title="✋ סידור היד">
            אפשר לסדר את הקלפים ביד כרצונך <b>בכל רגע — גם כשזה לא התור שלך</b>:
            <b> לחיצה ארוכה + גרירה</b> של קלף על קלף אחר. כפתור <b>🔀 מיין</b> ממיין
            אוטומטית לפי צורה וערך. הסידור שלך נשמר ואף שחקן אחר לא רואה אותו.
          </Section>
        </div>

        {/* Footer */}
        <div style={{ padding: 14, flexShrink: 0, borderTop: '1px solid #e7e5e4' }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '12px 0', background: FELT, color: GOLD,
            border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>הבנתי, בוא נשחק!</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// RELEASE NOTES ("מה חדש")
// A full screen of what changed, per version. Opens from the
// home screen and from the in-game header, and pops itself once
// after an upgrade (see main.jsx).
// ═══════════════════════════════════════════════════════

function ReleaseNotes({ onClose, current }) {
  // Newest release is expanded; older ones collapse into a short list.
  const [openAll, setOpenAll] = useState(false);
  const shown = openAll ? RELEASES : RELEASES.slice(0, 1);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        direction: 'rtl', padding: 14,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rules-card"
        style={{
          background: CREAM, borderRadius: 20, maxWidth: 440, width: '100%',
          display: 'flex', flexDirection: 'column',
          border: `2px solid ${GOLD}88`, boxShadow: '0 24px 72px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          background: FELT, padding: '14px 18px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ color: GOLD, fontSize: 20, fontWeight: 700 }}>
            🆕 מה חדש
          </span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.15)', color: CREAM, border: 'none',
            borderRadius: 8, width: 30, height: 30, fontSize: 18, cursor: 'pointer',
            fontWeight: 700, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
          {shown.map((rel, idx) => (
            <div key={rel.version} style={{ marginBottom: 20 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                borderBottom: `2px solid ${GOLD}55`, paddingBottom: 6, marginBottom: 10,
              }}>
                <span style={{
                  background: FELT, color: GOLD, borderRadius: 8,
                  padding: '3px 9px', fontSize: 13, fontWeight: 700,
                  direction: 'ltr', fontVariantNumeric: 'tabular-nums',
                }}>
                  v{rel.version}
                </span>
                <span style={{ fontWeight: 700, color: FELTD, fontSize: 15 }}>{rel.title}</span>
                <span style={{ marginInlineStart: 'auto', color: '#a8a29e', fontSize: 11 }}>
                  {rel.date}
                </span>
              </div>

              {idx === 0 && current && current !== rel.version && (
                <div style={{
                  background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
                  padding: '7px 10px', marginBottom: 10, color: '#92400e', fontSize: 12,
                }}>
                  הגרסה שרצה אצלך כרגע היא <b dir="ltr">v{current}</b>. אם משהו כאן חסר —
                  רעננו את הדף כדי לקבל את הגרסה האחרונה.
                </div>
              )}

              {rel.changes.map((ch, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 11 }}>
                  <div style={{ fontSize: 19, lineHeight: 1.2, flexShrink: 0 }}>{ch.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, color: FELTD, fontSize: 14 }}>{ch.title}</div>
                    <div style={{ color: '#57534e', fontSize: 13, lineHeight: 1.65 }}>{ch.text}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {!openAll && RELEASES.length > 1 && (
            <button
              onClick={() => setOpenAll(true)}
              style={{
                width: '100%', padding: '10px 0', background: 'transparent',
                color: FELT, border: `2px solid ${FELT}33`, borderRadius: 11,
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ↓ גרסאות קודמות ({RELEASES.length - 1})
            </button>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 14, flexShrink: 0, borderTop: '1px solid #e7e5e4' }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '12px 0', background: FELT, color: GOLD,
            border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>סגור</button>
        </div>
      </div>
    </div>
  );
}

function Setup({ onStart }) {
  const [n, setN] = useState(3);
  const [showRules, setShowRules] = useState(false);
  const [ps, setPs] = useState([
    { name: 'שחקן 1', isAI: false, ai: 'medium' },
    { name: 'מחשב 1', isAI: true, ai: 'medium' },
    { name: 'מחשב 2', isAI: true, ai: 'medium' },
    { name: 'מחשב 3', isAI: true, ai: 'easy' },
  ]);
  const up = (i, k, v) => setPs(a => a.map((p, j) => j === i ? { ...p, [k]: v } : p));

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(ellipse at 50% 30%, #1f6b3a 0%, ${FELTD} 70%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
      <style>{`
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:4px;}
      `}</style>

      <div style={{
        background: CREAM, borderRadius: 22, padding: '28px 24px',
        maxWidth: 390, width: '100%',
        boxShadow: `0 24px 72px rgba(0,0,0,.6), 0 0 0 3px ${GOLD}55`,
        border: `2px solid ${GOLD}77`,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 56, marginBottom: 4, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.2))' }}>🃏</div>
          <h1 style={{
            margin: 0, fontSize: 32,
            color: FELTD, letterSpacing: 2, fontWeight: 700,
          }}>רמי אקסטרים</h1>
          <div style={{ width: 50, height: 2, background: GOLD, margin: '8px auto' }} />
          <p style={{ color: '#78716c', margin: 0, fontSize: 13 }}>
            2 חפיסות • 4 ג׳וקרים • 6 משחקונים
          </p>
        </div>

        {/* Player count */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 700, color: FELTD, marginBottom: 8, fontSize: 14 }}>מספר שחקנים</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[3, 4].map(x => (
              <button key={x} onClick={() => setN(x)} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                cursor: 'pointer', fontSize: 15, fontWeight: 700,
                background: n === x ? FELT : '#e7e5e4',
                color: n === x ? GOLD : '#57534e',
                boxShadow: n === x ? `0 3px 12px ${FELT}66` : 'none',
                transition: 'all .2s',
              }}>{x} שחקנים</button>
            ))}
          </div>
        </div>

        {/* Player rows */}
        {ps.slice(0, n).map((p, i) => (
          <div key={i} style={{
            marginBottom: 10, padding: 13, borderRadius: 14,
            background: i === 0 ? `${FELT}14` : '#f5f5f4',
            border: `2px solid ${i === 0 ? FELT + '33' : '#e7e5e4'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>
                {i === 0 ? '👤' : p.isAI ? '🤖' : '👥'}
              </span>
              <input
                value={p.name}
                onChange={e => up(i, 'name', e.target.value)}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8,
                  border: '1.5px solid #d6d3d1', fontSize: 14, background: 'white',
                  outline: 'none',
                }}
              />
              {i > 0 && (
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap', color: '#57534e',
                }}>
                  <input
                    type="checkbox" checked={p.isAI}
                    onChange={e => up(i, 'isAI', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  AI
                </label>
              )}
            </div>
            {p.isAI && (
              <div style={{ display: 'flex', gap: 5, marginTop: 9 }}>
                {[['easy', '😊 קל'], ['medium', '🎯 בינוני'], ['hard', '🔥 קשה']].map(([k, label]) => (
                  <button key={k} onClick={() => up(i, 'ai', k)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 8, border: 'none',
                    fontSize: 12, cursor: 'pointer', fontWeight: p.ai === k ? 700 : 400,
                    background: p.ai === k ? FELT : '#e7e5e4',
                    color: p.ai === k ? GOLD : '#78716c',
                    transition: 'all .15s',
                  }}>{label}</button>
                ))}
              </div>
            )}
          </div>
        ))}

        <button onClick={() => onStart(ps.slice(0, n))} style={{
          width: '100%', padding: '14px 0', background: FELT, color: GOLD,
          border: `2px solid ${GOLD}88`, borderRadius: 13,
          fontSize: 18, fontWeight: 700, cursor: 'pointer', marginTop: 8,
          boxShadow: `0 5px 20px ${FELT}77`,
          letterSpacing: 1,
        }}>
          🎮 התחל משחק
        </button>

        <button onClick={() => setShowRules(true)} style={{
          width: '100%', padding: '11px 0', background: 'transparent', color: FELT,
          border: `2px solid ${FELT}44`, borderRadius: 13,
          fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 10,
        }}>
          📖 חוקים והסבר
        </button>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ROUND END
// ═══════════════════════════════════════════════════════

function RoundEnd({ state, dispatch }) {
  const { result, players, mk, sivuv } = state;
  const winner = result.w !== null ? players[result.w] : null;
  const sorted = [...players].sort((a, b) => a.totalScore - b.totalScore);

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(ellipse at 50% 30%, #1f6b3a, ${FELTD})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
      <div style={{
        background: CREAM, borderRadius: 22, padding: 24,
        maxWidth: 380, width: '100%',
        border: `2px solid ${GOLD}66`,
        boxShadow: `0 20px 60px rgba(0,0,0,.55)`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 42 }}>
            {result.isAnt ? '🎯' : result.empty ? '📦' : '✅'}
          </div>
          <h2 style={{ margin: '6px 0 4px', color: FELTD, fontSize: 22, fontWeight: 700 }}>
            {result.isAnt ? 'אנט!' : result.empty ? 'החבילה נגמרה' : 'הסיבוב הסתיים'}
          </h2>
          <p style={{ color: '#78716c', margin: 0, fontSize: 13 }}>
            {MK[mk].name} • סיבוב {sivuv}
          </p>
        </div>

        {winner && (
          <div style={{
            textAlign: 'center', padding: '10px 12px', borderRadius: 12, marginBottom: 14,
            background: result.isAnt ? '#f5f3ff' : '#f0fdf4',
            border: `2px solid ${result.isAnt ? '#a78bfa' : '#86efac'}`,
            color: result.isAnt ? '#5b21b6' : '#15803d', fontWeight: 700, fontSize: 16,
          }}>
            {winner.name} {result.isAnt ? 'אנט! (−50 נק׳) 🎯' : 'סיים ראשון! 🏆'}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          {sorted.map((p, i) => {
            const ls = p.lastScore ?? 0;
            return (
              <div key={p.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 11, marginBottom: 6,
                background: p.id === result.w ? '#f0fdf4' : '#fafaf9',
                border: `2px solid ${p.id === result.w ? '#86efac' : '#e7e5e4'}`,
              }}>
                <span style={{ fontWeight: 700 }}>
                  {['🥇', '🥈', '🥉', '4️⃣'][i]} {p.name}
                </span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: ls > 0 ? '#dc2626' : '#16a34a' }}>
                    {ls > 0 ? `+${ls}` : ls < 0 ? ls : '±0'}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: FELTD }}>
                    {p.totalScore}<span style={{ fontSize: 11, color: '#78716c', fontWeight: 400 }}> נק׳</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => dispatch({ type: 'NEW_HAND' })} style={{
            flex: 1, padding: '11px 0', background: '#e7e5e4',
            color: '#57534e', border: '2px solid #d6d3d1',
            borderRadius: 11, fontSize: 14, cursor: 'pointer', fontWeight: 600,
          }}>
            🔄 סיבוב נוסף
          </button>
          <button
            onClick={() => mk >= 5 ? dispatch({ type: 'GAME_END' }) : dispatch({ type: 'NEXT_MK' })}
            style={{
              flex: 1, padding: '11px 0', background: FELT, color: GOLD,
              border: `2px solid ${GOLD}88`, borderRadius: 11,
              fontSize: 14, cursor: 'pointer', fontWeight: 700,
            }}
          >
            {mk >= 5 ? '🏆 סיום' : `→ ${MK[mk + 1]?.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GAME END
// ═══════════════════════════════════════════════════════

function GameEnd({ state, onRestart }) {
  const sorted = [...state.players].sort((a, b) => a.totalScore - b.totalScore);
  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(ellipse at 50% 30%, #1f6b3a, ${FELTD})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
      <div style={{
        background: CREAM, borderRadius: 22, padding: 28,
        maxWidth: 380, width: '100%',
        border: `2px solid ${GOLD}`, boxShadow: `0 24px 72px rgba(0,0,0,.6)`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 56 }}>🏆</div>
          <h2 style={{ margin: '6px 0 4px', color: FELTD, fontSize: 28, fontWeight: 700 }}>
            סיום המשחק
          </h2>
          <p style={{ color: '#16a34a', fontWeight: 700, fontSize: 20, margin: 0 }}>
            {sorted[0].name} ניצח!
          </p>
        </div>
        {sorted.map((p, i) => (
          <div key={p.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 14px', borderRadius: 12, marginBottom: 8,
            background: i === 0 ? '#fefce8' : '#fafaf9',
            border: i === 0 ? `2px solid ${GOLD}` : '2px solid #e7e5e4',
          }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              {['🥇', '🥈', '🥉', '4️⃣'][i]} {p.name}
            </span>
            <span style={{ fontWeight: 700, fontSize: 20, color: FELTD }}>
              {p.totalScore}<span style={{ fontSize: 12, color: '#78716c', fontWeight: 400 }}> נק׳</span>
            </span>
          </div>
        ))}
        <button onClick={onRestart} style={{
          width: '100%', padding: '14px 0', background: FELT, color: GOLD,
          border: `2px solid ${GOLD}`, borderRadius: 13,
          fontSize: 17, fontWeight: 700, cursor: 'pointer', marginTop: 12,
        }}>
          🎮 משחק חדש
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN GAME SCREEN
// ═══════════════════════════════════════════════════════


function Game({ state, dispatch }) {
  const [attachMode, setAttachMode] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  // Long-press drag: { card, x, y } once a drag is active
  const [drag, setDrag] = useState(null);
  const dragRef = useRef({ timer: null, startX: 0, startY: 0, card: null, active: false });
  // Online: "me" is the seat the server marked with you:true.
  const mySeat  = state.players.findIndex(p => p.you);
  const me      = mySeat >= 0 ? state.players[mySeat] : state.players[0];
  const cur     = state.players[state.cur];
  const isMyTurn = mySeat === state.cur;
  // `human`/`cur.isAI` in the original meant "the local human". Online, that maps
  // to "is it my turn": UI controls light up only on my own turn.
  const human   = me;
  const discard = state.discard[state.discard.length - 1];
  const mk      = MK[state.mk];
  const buy     = state.buy;

  const checker       = buy ? state.players[buy.checker] : null;
  // I decide in the buying phase only when I'm the checker.
  const humanDecides  = buy && buy.checker === mySeat;
  const isFreeOffer   = buy && buy.checker === buy.origNext;

  // ── One draw per turn, even on a double-tap ──────────────────────────────
  // The pile stays lit until the server's next state arrives, so two fast taps would
  // both pass the `phase === 'draw'` test on the pile and send two DRAWs. The server
  // now drops the second, but don't fire it at all: latch the draw decision (pile or
  // beit) to the state object it was made on. Every state the server pushes — a new
  // turn, an undone beit, a reconnect resync — is a fresh object, so the latch clears
  // itself and a dropped message can never leave the player unable to draw.
  const drawLatch = useRef({ state: null, sent: false });
  if (drawLatch.current.state !== state) drawLatch.current = { state, sent: false };
  const drawOnce = (action) => {
    if (drawLatch.current.sent) return;
    drawLatch.current.sent = true;
    dispatch(action);
  };

  const stagedIds  = new Set(state.staging.flatMap(g => g.cards.map(c => c.id)));
  // selCards = selected but not yet staged
  const selCards   = human.hand.filter(c => state.sel.includes(c.id) && !stagedIds.has(c.id));

  // ── Long-press drag: reorder within hand, or attach to a board group ──
  // Rearranging your own hand is allowed at ANY time — also while you're waiting
  // for someone else to play. Only the "drop on a board group" half of the drag
  // (an attach) is restricted to your own turn; see endPress.
  const canDragCard = (card) => !stagedIds.has(card.id);

  function startPress(card, e) {
    if (!canDragCard(card)) return;
    const pt = e.touches ? e.touches[0] : e;
    const d = dragRef.current;
    d.startX = pt.clientX; d.startY = pt.clientY; d.card = card; d.active = false;
    clearTimeout(d.timer);
    d.timer = setTimeout(() => {
      d.active = true;
      // If the browser managed to start a selection before the press became a
      // drag, drop it — otherwise the highlight stays on screen for the whole
      // drag and the card looks like selected text.
      clearSelection();
      setDrag({ card, x: d.startX, y: d.startY });
    }, 350);
  }
  function movePress(e) {
    const d = dragRef.current;
    const pt = e.touches ? e.touches[0] : e;
    if (!d.active) {
      // Moved before long-press fired → treat as scroll, cancel
      if (Math.abs(pt.clientX - d.startX) > 8 || Math.abs(pt.clientY - d.startY) > 8) {
        clearTimeout(d.timer);
      }
      return;
    }
    if (e.cancelable) e.preventDefault(); // block scroll while dragging
    setDrag({ card: d.card, x: pt.clientX, y: pt.clientY });
  }
  function endPress(e) {
    const d = dragRef.current;
    clearTimeout(d.timer);
    if (d.active && d.card) {
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const groupEl = el && el.closest('[data-gid]');
      const cardEl = el && el.closest('[data-cardid]');
      if (groupEl && isMyTurn) {
        const gid = groupEl.getAttribute('data-gid');
        // If the dragged card is part of a current multi-card selection, attach the
        // whole selection at once; otherwise attach just the dragged card.
        if (state.sel.length > 1 && state.sel.includes(d.card.id))
          dispatch({ type: 'ATTACH', gid });
        else
          dispatch({ type: 'ATTACH', gid, cid: d.card.id });
      } else if (cardEl) {
        const targetId = cardEl.getAttribute('data-cardid');
        if (targetId && targetId !== d.card.id)
          dispatch({ type: 'REORDER', cid: d.card.id, targetId });
      }
    }
    d.active = false; d.card = null;
    clearSelection();
    setDrag(null);
  }

  // Global listeners so drag tracks across the whole screen (re-bound each render for fresh state)
  useEffect(() => {
    const move = (e) => movePress(e);
    const up = (e) => endPress(e);
    // While a finger is down on a card, refuse to start a text selection at all.
    // CSS user-select covers most browsers; this catches the rest, and costs
    // nothing when no card is being pressed.
    const noSelect = (e) => {
      const d = dragRef.current;
      if ((d.card || d.active) && e.cancelable) e.preventDefault();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('selectstart', noSelect);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('selectstart', noSelect);
    };
  });

  // AI now runs authoritatively on the server (the Room Durable Object),
  // so there is no local AI effect here. The client only renders state and
  // sends the local player's actions.

  const Btn = ({ label, onClick, disabled, bg, col = 'white' }) => (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, minWidth: 52, padding: '8px 3px',
      background: disabled ? '#374151' : bg,
      color: disabled ? '#6b7280' : col,
      border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
      opacity: disabled ? 0.55 : 1, transition: 'opacity .1s',
    }}>{label}</button>
  );

  const phaseLabel = () => {
    // Buying phase: whoever is the checker decides
    if (state.phase === 'buying') {
      if (humanDecides) return isFreeOffer ? `🎁 האם לקחת מהאשפה?` : `💰 האם לקנות?`;
      return `⏳ ממתין ל${checker?.name || '...'}`;
    }
    // Not my turn → show who we're waiting on
    if (!isMyTurn) {
      const who = cur?.name || '';
      return cur?.isAI ? `🤖 ${who} חושב...` : `⏳ תורו של ${who}`;
    }
    // My turn
    if (state.phase === 'draw') return `📤 שלוף קלף`;
    if (state.phase === 'action') return `🎯 בחר פעולה`;
    return '';
  };

  return (
    <div className="game-shell" style={{
      background: `radial-gradient(ellipse 120% 70% at 50% -5%, #2c7a4d 0%, ${FELT} 42%, ${FELTD} 100%)`,
      backgroundColor: FELTD,
      direction: 'rtl',
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
    }}>
      <style>{`
        /* Belt and braces for the long-press drag: the card and everything
           drawn inside it (value, suit, corners) must never become selectable
           text, or a slow press highlights the card instead of lifting it. */
        .deal-card, .deal-card * {
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-user-drag: none;
        }

        :root {
          /* One knob for every card on the table. Portrait: grow with the phone's
             width, within sane bounds. */
          --card-w: clamp(40px, 12vw, 56px);
          --card-h: calc(var(--card-w) * 1.41);
          --card-w-sm: calc(var(--card-w) * .6);
          --card-h-sm: calc(var(--card-h) * .6);
        }

        /* 100dvh, not 100vh: on mobile browsers vh includes the collapsible URL
           bar, so a 100vh column pushes the hand below the visible viewport. */
        .game-shell {
          height: 100vh; height: 100dvh;
          display: flex; justify-content: center;
          overflow: hidden;
        }
        /* The play field is capped on wide screens so a desktop browser doesn't
           strand the piles in the middle of an ocean of felt. */
        .game-grid {
          width: 100%; max-width: 1040px; height: 100%;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto minmax(0, 1fr) auto auto auto auto auto;
          grid-template-areas: "header" "opp" "board" "piles" "prompt" "msg" "status" "hand";
          padding-left: env(safe-area-inset-left, 0px);
          padding-right: env(safe-area-inset-right, 0px);
        }
        .ga-header { grid-area: header; }
        .ga-opp    { grid-area: opp; }
        .ga-board  { grid-area: board; min-height: 0; overflow-y: auto; }
        .ga-piles  { grid-area: piles; }
        .ga-prompt { grid-area: prompt; }
        .ga-msg    { grid-area: msg; }
        .ga-status { grid-area: status; }
        .ga-hand   { grid-area: hand; }
        /* Portrait: the rail is transparent and its children sit in their own
           grid areas. Landscape turns it into a real side column (below). */
        .rail { display: contents; }

        /* ── Landscape on a phone: height is the scarce axis, width is free.
           Move the opponents, the piles and the status line into a side rail so
           the whole vertical budget goes to the board and the hand. ── */
        @media (orientation: landscape) and (max-height: 560px) {
          :root {
            /* Now bounded by height, so the hand still fits in one row. */
            --card-w: clamp(32px, 9.5vh, 44px);
          }
          .game-grid {
            max-width: none;
            grid-template-columns: minmax(0, 1fr) clamp(108px, 18vw, 156px);
            grid-template-rows: auto minmax(0, 1fr) auto auto auto;
            grid-template-areas:
              "header header"
              "board  rail"
              "prompt rail"
              "msg    rail"
              "hand   rail";
          }
          .rail {
            grid-area: rail; display: flex; flex-direction: column;
            min-height: 0;
          }
          /* Only the opponent list scrolls. The piles and the status line — which
             is where "whose turn is it" lives — stay pinned and always visible. */
          .ga-opp {
            /* !important: the portrait layout pins this row with an inline
               flex-shrink: 0, which would otherwise win over this rule. */
            flex: 1 1 auto !important; min-height: 0; overflow-y: auto;
            flex-direction: column; gap: 4px !important; padding: 4px 6px;
          }
          .ga-piles, .ga-status { flex-shrink: 0; }
          /* The status text has a narrow column to live in; let it stack. */
          .ga-status { font-size: 11px; line-height: 1.5; padding: 5px 6px; }
          .ga-status > span { display: block; margin: 0 !important; }
          .ga-piles { flex-wrap: wrap; gap: 6px !important; padding: 2px 0; }
          /* The decorative fan of card backs costs ~38px per opponent, which is
             the difference between the status line fitting in the rail or not. */
          .opp-fan  { display: none !important; }
          .ga-header { padding-top: 3px; padding-bottom: 3px; }
          .hand-hint { display: none; }
        }

        @keyframes newCardPulse {
          0%   { box-shadow: 0 0 0 3px ${GOLD}, 0 0 18px ${GOLD}88; }
          50%  { box-shadow: 0 0 0 5px ${GOLD}, 0 0 28px ${GOLD}cc; }
          100% { box-shadow: 0 0 0 3px ${GOLD}, 0 0 18px ${GOLD}88; }
        }
        @keyframes dealIn {
          from { opacity: 0; transform: translateY(16px) scale(.88); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes popIn {
          0%   { opacity: 0; transform: scale(.6); }
          65%  { transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes discardDrop {
          from { opacity: 0; transform: translateY(-20px) rotate(-9deg) scale(1.12); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes turnGlow {
          0%,100% { box-shadow: 0 0 0 0 ${GOLD}00; }
          50%     { box-shadow: 0 0 0 2px ${GOLD}aa; }
        }
        .deal-card { animation: dealIn .32s cubic-bezier(.34,1.4,.64,1) both; }
        .group-pop { animation: popIn .34s cubic-bezier(.34,1.56,.64,1) both; }
        .discard-card { animation: discardDrop .3s ease-out both; }
      `}</style>

      <div className="game-grid">

      {/* ── Header ────────────────────────────────── */}
      <div className="ga-header" style={{
        background: 'rgba(0,0,0,.5)', padding: '7px 12px',
        color: CREAM, flexShrink: 0,
        borderBottom: `1px solid ${GOLD}44`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 13,
      }}>
        <span style={{ fontWeight: 700, color: GOLD }}>
          {mk.name}
        </span>
        <span style={{ color: 'rgba(255,255,255,.7)' }}>סיבוב {state.sivuv}</span>
        <span style={{
          fontSize: 11, padding: '2px 9px', borderRadius: 20,
          background: state.canLay ? 'rgba(34,197,94,.25)' : 'rgba(251,191,36,.25)',
          color: state.canLay ? '#86efac' : GOLD,
        }}>
          {state.canLay ? '✓ הורדה' : '⚠ סבב ראשון'}
        </span>
        <span style={{ display: 'flex', gap: 5 }}>
          <button onClick={() => setShowRules(true)} style={{
            background: 'rgba(255,255,255,.12)', color: CREAM, border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '3px 9px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>📖 חוקים</button>
          <button onClick={() => setShowNotes(true)} title="מה חדש בגרסה" style={{
            background: 'rgba(255,255,255,.12)', color: CREAM, border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '3px 8px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>🆕</button>
        </span>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showNotes && <ReleaseNotes onClose={() => setShowNotes(false)} />}

      {/* Opponents, piles and the status line. In portrait each one falls into
          its own grid area; in landscape they stack into the side rail. */}
      <div className="rail">

      {/* ── Opponents — share the width equally, no horizontal scroll ── */}
      <div className="ga-opp" style={{
        display: 'flex', gap: 6, padding: '6px 10px',
        flexShrink: 0, justifyContent: 'center',
      }}>
        {state.players.map((p, i) => {
          if (i === mySeat) return null; // don't render myself as an opponent
          const active = i === state.cur;
          const handN = p.handCount ?? p.hand?.length ?? 0;
          // Five opponents share the width four used to; a shorter fan keeps
          // each tile readable instead of squeezing the name out.
          const miniN = Math.min(handN, state.players.length > 4 ? 3 : 6);
          return (
            <div key={i} style={{
              flex: 1, minWidth: 0,
              background: active
                ? 'linear-gradient(145deg, #b45309, #f59e0b)'
                : 'rgba(255,255,255,.1)',
              border: `2px solid ${active ? '#fde68a' : 'transparent'}`,
              borderRadius: 11, padding: '6px 6px', color: CREAM,
              textAlign: 'center',
              boxShadow: active ? '0 0 16px rgba(245,158,11,.6)' : 'none',
              animation: active ? 'turnGlow 1.8s ease-in-out infinite' : 'none',
              transition: 'background .3s, border-color .3s, box-shadow .3s',
            }}>
              <div style={{
                fontWeight: 700, fontSize: 12, color: active ? '#fffbeb' : CREAM, marginBottom: 3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {active ? '▶ ' : ''}{p.name}
              </div>
              <div className="opp-fan" style={{
                display: 'flex', justifyContent: 'center', marginBottom: 3,
                height: 'var(--card-h-sm)',
              }}>
                {Array.from({ length: miniN }).map((_, k) => (
                  <div key={k} style={{ marginInlineStart: k === 0 ? 0 : 'calc(var(--card-w-sm) * -.7)' }}>
                    <CardView card={{ id: 'b' + k }} back sm />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap' }}>
                🃏{handN} · ⭐{p.totalScore}
              </div>
              {active && (
                <div style={{ fontSize: 10, color: GOLD, marginTop: 2, whiteSpace: 'nowrap' }}>
                  {state.phase === 'action' ? '🎯 פועל' : state.phase === 'draw' ? '📤 שולף' : '⏳'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Piles row ─────────────────────────────── */}
      <div className="ga-piles" style={{
        display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
        gap: 18, padding: '8px 0', flexShrink: 0,
      }}>
        {/* Beit card — face up; takeable in draw phase before you've laid (ANT only) */}
        {(state.beitPresent ?? !!state.beit) && (() => {
          const canTake = state.phase === 'draw' && isMyTurn && !human.hasLaid;
          const blocked = state.phase === 'draw' && isMyTurn && human.hasLaid;
          return (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: GOLD, fontSize: 10, marginBottom: 3 }}>🏠 בית</div>
              <div
                onClick={() => canTake && drawOnce({ type: 'TAKE_BEIT' })}
                style={{ cursor: canTake ? 'pointer' : 'default', opacity: blocked ? 0.4 : 1 }}
                title={blocked ? 'אפשר לקחת בית רק לפני שהורדת (לאנט)' : undefined}
              >
                {state.beit
                  ? <CardView card={state.beit} glow={canTake} />
                  : <CardView card={{ id: 'beit' }} back glow={canTake} />}
              </div>
            </div>
          );
        })()}

        {/* Draw pile */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,.55)', fontSize: 10, marginBottom: 3 }}>
            חבילה ({state.deckCount ?? state.deck?.length ?? 0})
          </div>
          <div
            onClick={() => state.phase === 'draw' && isMyTurn && drawOnce({ type: 'DRAW' })}
            style={{
              width: 'var(--card-w)', height: 'var(--card-h)',
              borderRadius: 'calc(var(--card-h) * .1)',
              background: 'linear-gradient(145deg,#1e3a6e,#0f2245)',
              border: `2px solid ${state.phase === 'draw' && isMyTurn ? GOLD : '#2d4d8a'}`,
              cursor: state.phase === 'draw' && isMyTurn ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: state.phase === 'draw' && isMyTurn ? `0 0 14px ${GOLD}88` : '0 2px 8px rgba(0,0,0,.4)',
              transition: 'box-shadow .2s',
              backgroundImage: `repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,.04) 3px,rgba(255,255,255,.04) 6px)`,
            }}
          >
            <span style={{ fontSize: 'calc(var(--card-h) * .39)', color: CREAM }}>🂠</span>
          </div>
        </div>

        {/* Discard pile — cumulative; take the top only via the buying offer */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,.55)', fontSize: 10, marginBottom: 3 }}>
            אשפה ({state.discard.length})
          </div>
          {discard ? (() => {
            const pile = state.discard;
            const depth = Math.min(pile.length, 4);
            const shown = pile.slice(-depth); // oldest → top
            return (
              <div style={{
                position: 'relative', margin: '0 auto',
                width: `calc(var(--card-w) + ${(depth - 1) * 6}px)`,
                height: `calc(var(--card-h) + ${(depth - 1) * 3}px)`,
              }}>
                {shown.map((c, idx) => {
                  const isTop = idx === shown.length - 1;
                  return (
                    <div
                      key={c.id}
                      className="discard-card"
                      style={{
                        position: 'absolute', left: idx * 6, bottom: idx * 3, zIndex: idx,
                        filter: isTop ? 'none' : 'brightness(.82)',
                      }}
                    >
                      <CardView card={c} />
                    </div>
                  );
                })}
              </div>
            );
          })() : (
            <div style={{
              width: 'var(--card-w)', height: 'var(--card-h)',
              borderRadius: 'calc(var(--card-h) * .1)',
              border: '2px dashed rgba(255,255,255,.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 18 }}>∅</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar ────────────────────────────── */}
      <div className="ga-status" style={{
        background: 'rgba(0,0,0,.45)', padding: '5px 12px',
        color: 'rgba(255,255,255,.7)', fontSize: 12,
        textAlign: 'center', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600 }}>{phaseLabel()}</span>
        <span style={{ color: 'rgba(255,255,255,.45)', marginRight: 10 }}>
          יד: {human.hand.length} • סה״כ: {human.totalScore} נק׳
        </span>
      </div>

      </div>{/* /rail */}

      {/* ── Buying prompt ─────────────────────────── */}
      {state.phase === 'buying' && humanDecides && (
        <div className="ga-prompt" style={{
          background: '#1c2c3e', margin: '0 10px', borderRadius: 14,
          padding: '11px 14px', color: CREAM, textAlign: 'center',
          flexShrink: 0, border: '1px solid rgba(255,255,255,.12)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            {isFreeOffer
              ? `קח את ${discard ? cTxt(discard) : '?'} מהאשפה — בחינם?`
              : `לקנות ${discard ? cTxt(discard) : '?'}? (+קלף קנס מהחבילה)`
            }
          </div>
          {discard && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <CardView card={discard} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => isFreeOffer
                ? dispatch({ type: 'TAKE_FREE' })
                : dispatch({ type: 'BUY', idx: buy.checker })
              }
              style={{
                padding: '9px 24px', background: '#16a34a', color: 'white',
                border: 'none', borderRadius: 9, cursor: 'pointer',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              {isFreeOffer ? '✓ קח' : '💰 קנה'}
            </button>
            <button
              onClick={() => dispatch({ type: 'SKIP' })}
              style={{
                padding: '9px 24px', background: '#475569', color: 'white',
                border: 'none', borderRadius: 9, cursor: 'pointer',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              ✕ וותר
            </button>
          </div>
        </div>
      )}

      {/* ── Message bar ───────────────────────────── */}
      {state.msg && (
        <div className="ga-msg" style={{
          padding: '6px 12px', textAlign: 'center', fontSize: 13, flexShrink: 0,
          background: state.msg.startsWith('✓') ? 'rgba(22,101,52,.85)' : 'rgba(127,29,29,.85)',
          color: CREAM,
        }}>
          {state.msg}
        </div>
      )}


      {/* ── Board ─────────────────────────────────── */}
      <div className="ga-board" style={{ padding: '6px 10px' }}>

        {/* Staging area — shown only while accumulating groups before requirement is met */}
        {state.staging.length > 0 && (() => {
          const reqMet = human.hasLaid || meetsReq(state.staging, state.mk);
          return (
          <div style={{
            background: 'rgba(251,191,36,.12)',
            border: '2px dashed rgba(251,191,36,.45)',
            borderRadius: 12, padding: '7px 9px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ color: GOLD, fontSize: 12, fontWeight: 700 }}>
                ⏳ בתהליך הורדה — {state.staging.length} קבוצ{state.staging.length > 1 ? 'ות' : 'ה'}
              </span>
              <span style={{ color: 'rgba(255,255,255,.55)', fontSize: 11 }}>
                {!reqMet ? `דרוש: ${MK[state.mk].name}` : '✓ מוכן'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {state.staging.map(g => (
                <div key={g.id} style={{
                  display: 'inline-flex', alignItems: 'center',
                  background: 'rgba(255,255,255,.88)', borderRadius: 8,
                  padding: '3px 5px',
                }}>
                  {g.cards.map(c => <CardView key={c.id} card={c} sm />)}
                </div>
              ))}
            </div>
            <button
              onClick={() => dispatch({ type: 'CLEAR_STAGE' })}
              style={{
                width: '100%', marginTop: 6, padding: '4px 0',
                background: 'rgba(255,255,255,.07)', color: 'rgba(255,255,255,.45)',
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 7, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
              }}
            >
              ✕ בטל הורדה
            </button>
          </div>
          );
        })()}

        {/* Must-use joker hint */}
        {state.mustUseJoker && isMyTurn &&
          human.hand.some(c => c.id === state.mustUseJoker) && (
          <div style={{
            background: 'rgba(124,58,237,.25)', border: '2px solid #7c3aed',
            borderRadius: 12, padding: '8px 12px', marginBottom: 8, textAlign: 'center',
            color: '#ddd6fe', fontSize: 13, fontWeight: 700,
          }}>
            🃏 חובה להשתמש בג׳וקר — הצמד לקבוצה או הורד בקבוצה חדשה עם קלפים מהיד
          </div>
        )}

        {/* Board groups */}
        {state.board.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {state.board.map(g => {
              const normalAttach = attachMode && selCards.length >= 1 && human.hasLaid;
              return (
                <GroupView
                  key={g.id} group={g}
                  canAttach={normalAttach}
                  onAttach={() => {
                    if (normalAttach) {
                      dispatch({ type: 'ATTACH', gid: g.id });
                      setAttachMode(false);
                    }
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div style={{
            textAlign: 'center', padding: '20px 0',
            color: 'rgba(255,255,255,.25)', fontSize: 14,
          }}>
            הלוח ריק
          </div>
        )}
      </div>


      {/* ── Human hand area — always visible ─────── */}
      {(() => {
        const myTurn = isMyTurn && state.phase !== 'round_end' && state.phase !== 'game_end';
        return (
      <div className="ga-hand" style={{
        background: myTurn
          ? 'linear-gradient(180deg, #7c4a09, #1a1206)'
          : '#0f172a',
        padding: '8px 10px 10px', flexShrink: 0,
        borderTop: myTurn ? '3px solid #f59e0b' : '3px solid transparent',
        boxShadow: myTurn ? 'inset 0 8px 24px -8px rgba(245,158,11,.5)' : 'none',
        transition: 'background .3s, border-color .3s, box-shadow .3s',
      }}>

        {/* Action buttons — only when it's the human's action phase */}
        {isMyTurn && state.phase === 'action' && (
            <div style={{
              display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap',
              maxWidth: 560, margin: '0 auto 8px',
            }}>
              <Btn
                label={!state.canLay ? '🚫 הורד (סבב ראשון)' : '⬇️ הורד'}
                disabled={selCards.length < (state.mustUseJoker ? 2 : 3) || !state.canLay}
                bg={FELT} col={GOLD}
                onClick={() => dispatch({ type: 'LAY' })}
              />
              <Btn
                label={attachMode ? '❌ בטל' : '📌 הצמד'}
                disabled={!human.hasLaid}
                bg={attachMode ? '#b45309' : '#0369a1'}
                onClick={() => setAttachMode(m => !m)}
              />
              {state.undoBefore &&
                (state.undoBefore.fromBeit ||
                 state.board.length > (state.undoBefore.board?.length || 0) ||
                 state.staging.length > 0) && (
                <Btn
                  label={state.undoBefore.fromBeit ? '↩️ החזר בית' : '↩️ בטל הורדה'}
                  bg="#374151" col="#d1d5db"
                  onClick={() => { dispatch({ type: 'UNDO' }); setAttachMode(false); }}
                />
              )}
              <Btn
                label="🗑️ זרוק"
                disabled={selCards.length !== 1}
                bg="#9f1239"
                onClick={() => selCards.length === 1 && dispatch({ type: 'DISCARD', cid: selCards[0].id })}
              />
            </div>
          )}

          {/* Hand toolbar: manual sort + reorder hint.
              Always available — you may tidy your hand while waiting for others. */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            margin: '0 auto 6px', maxWidth: 560,
          }}>
            <span className="hand-hint" style={{ color: 'rgba(255,255,255,.4)', fontSize: 11 }}>
              לחיצה ארוכה + גרירה לסידור הקלפים
            </span>
            <button
              onClick={() => dispatch({ type: 'SORT' })}
              style={{
                background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155',
                borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '5px 12px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >🔀 מיין</button>
          </div>

          {/* Hand cards — wrap to multiple rows to fit screen width (no scroll) */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
              alignContent: 'flex-start', gap: 2, paddingBottom: 2, paddingTop: 14,
            }}
          >
            {human.hand.map((c, i) => {
              const inStage = stagedIds.has(c.id);
              const dragging = drag && drag.card.id === c.id;
              const sel = state.sel.includes(c.id);
              return (
                <div
                  key={c.id}
                  data-cardid={c.id}
                  className="deal-card"
                  onPointerDown={(e) => startPress(c, e)}
                  // A long press on mobile otherwise pops the copy/lookup menu,
                  // and on desktop a slow press starts a native HTML5 drag.
                  onContextMenu={(e) => e.preventDefault()}
                  onDragStart={(e) => e.preventDefault()}
                  draggable={false}
                  style={{
                    // Always 'none', not just mid-drag: the browser picks the
                    // gesture owner at touch-start, so switching once the drag
                    // has begun is too late to stop a swipe-navigation.
                    // Nothing scrolls here — the hand is a fixed row — so the
                    // touch is ours to keep.
                    touchAction: 'none',
                    opacity: dragging ? 0.3 : 1,
                    zIndex: sel ? 100 : 1,
                    flexShrink: 0,
                  }}
                >
                  <CardView
                    card={c}
                    sel={sel}
                    faded={inStage}
                    newCard={(human.newIds || []).includes(c.id)}
                    onClick={
                      state.phase === 'action' && !inStage
                        ? () => dispatch({ type: 'SEL', id: c.id })
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      </div>{/* /game-grid */}

      {/* Drag ghost — centred on the finger, whatever the current card size */}
      {drag && (
        <div style={{
          position: 'fixed', left: drag.x, top: drag.y,
          pointerEvents: 'none', zIndex: 9999,
          transform: 'translate(-50%, -50%) scale(1.15)',
        }}>
          <CardView card={drag.card} />
        </div>
      )}
    </div>
  );
}

export { CardView, GroupView, RulesModal, ReleaseNotes, Setup, RoundEnd, GameEnd, Game };
