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


function CardView({ card, sel, onClick, sm, back, glow, faded, newCard }) {
  const w = sm ? 26 : 44, h = sm ? 38 : 62;

  if (back) return (
    <div style={{
      width: w, height: h,
      borderRadius: sm ? 4 : 6, flexShrink: 0, margin: sm ? '0 1px' : '0 2px',
      background: 'linear-gradient(145deg,#234a8c 0%,#13284f 60%,#0c1d3c 100%)',
      border: `1.5px solid #36589c`,
      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,.05) 3px, rgba(255,255,255,.05) 6px),
                        radial-gradient(circle at 50% 50%, rgba(201,151,58,.18), transparent 60%)`,
      boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.04), 0 2px 6px rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ color: 'rgba(201,151,58,.55)', fontSize: sm ? 11 : 18 }}>♦</span>
    </div>
  );

  const color = card.j ? '#fff' : COL[card.suit];
  const vs = card.j ? 'JK' : VD(card.v);
  const sym = card.j ? '★' : SYM[card.suit];
  const isFace = !card.j && (card.v === 1 || card.v >= 11);

  const corner = (rotate) => (
    <div style={{
      position: 'absolute', lineHeight: 0.82, textAlign: 'center', color,
      ...(rotate
        ? { bottom: sm ? 1 : 3, left: sm ? 2 : 4, transform: 'rotate(180deg)' }
        : { top: sm ? 1 : 3, right: sm ? 2 : 4 }),
    }}>
      <div style={{ fontSize: sm ? 7 : 11, fontWeight: 800, fontFamily: 'Georgia,serif' }}>{vs}</div>
      <div style={{ fontSize: sm ? 6 : 9 }}>{sym}</div>
    </div>
  );

  return (
    <div onClick={onClick} style={{
      position: 'relative',
      width: w, height: h,
      borderRadius: sm ? 4 : 6, flexShrink: 0, margin: sm ? '0 1px' : '0 2px',
      background: card.j
        ? 'linear-gradient(150deg,#7c3aed 0%,#9f67f5 50%,#5b21b6 100%)'
        : 'linear-gradient(157deg,#ffffff 0%,#fbf6ec 55%,#f1e7d6 100%)',
      border: sel ? '2px solid #60a5fa'
        : (newCard || glow) ? `2px solid ${GOLD}`
        : '1px solid rgba(0,0,0,.22)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: onClick ? 'pointer' : 'default', userSelect: 'none', overflow: 'hidden',
      transform: sel ? 'translateY(-12px) scale(1.07)' : 'none',
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
        fontSize: card.j ? (sm ? 12 : 20) : (sm ? 13 : 23),
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
        fontFamily: "'Noto Sans Hebrew','Segoe UI',Arial,sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: CREAM, borderRadius: 20, maxWidth: 440, width: '100%',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          border: `2px solid ${GOLD}88`, boxShadow: '0 24px 72px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          background: FELT, padding: '14px 18px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ color: GOLD, fontSize: 20, fontWeight: 700, fontFamily: 'Georgia,serif' }}>
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
            משחקים עם 2 חפיסות + 4 ג׳וקרים (108 קלפים). אס יכול לשמש כ־1 (לפני 2)
            או כ־14 (אחרי מלך). הג׳וקר מחליף כל קלף.
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
            במקום לשלוף, אפשר לקחת את "קלף הבית" (קלף מוסתר) — הימור לניסיון אנט.
            אם לא הסתדר, אפשר ללחוץ "↩️ החזר בית" כדי להחזיר אותו ולבחור שליפה אחרת.
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
        fontFamily: "'Noto Sans Hebrew','Segoe UI',Arial,sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: CREAM, borderRadius: 20, maxWidth: 440, width: '100%',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          border: `2px solid ${GOLD}88`, boxShadow: '0 24px 72px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          background: FELT, padding: '14px 18px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ color: GOLD, fontSize: 20, fontWeight: 700, fontFamily: 'Georgia,serif' }}>
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
                  direction: 'ltr', fontFamily: 'Georgia,serif',
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
      fontFamily: "'Noto Sans Hebrew', 'Segoe UI', Arial, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;600;700&display=swap');
        *{box-sizing:border-box;} input,select,button{font-family:inherit;}
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
            margin: 0, fontSize: 32, fontFamily: 'Georgia,serif',
            color: FELTD, letterSpacing: 2, fontWeight: 400,
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
      fontFamily: "'Noto Sans Hebrew','Segoe UI',Arial,sans-serif",
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
          <h2 style={{ margin: '6px 0 4px', color: FELTD, fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 400 }}>
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
      fontFamily: "'Noto Sans Hebrew','Segoe UI',Arial,sans-serif",
    }}>
      <div style={{
        background: CREAM, borderRadius: 22, padding: 28,
        maxWidth: 380, width: '100%',
        border: `2px solid ${GOLD}`, boxShadow: `0 24px 72px rgba(0,0,0,.6)`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 56 }}>🏆</div>
          <h2 style={{ margin: '6px 0 4px', fontFamily: 'Georgia,serif', color: FELTD, fontSize: 28, fontWeight: 400 }}>
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
    setDrag(null);
  }

  // Global listeners so drag tracks across the whole screen (re-bound each render for fresh state)
  useEffect(() => {
    const move = (e) => movePress(e);
    const up = (e) => endPress(e);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
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
    <div style={{
      height: '100dvh', minHeight: '100vh',
      background: `radial-gradient(ellipse 120% 70% at 50% -5%, #2c7a4d 0%, ${FELT} 42%, ${FELTD} 100%)`,
      backgroundColor: FELTD,
      display: 'flex', flexDirection: 'column',
      direction: 'rtl',
      fontFamily: "'Noto Sans Hebrew','Segoe UI',Arial,sans-serif",
      overflow: 'hidden', userSelect: 'none',
    }}>
      <style>{`
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

      {/* ── Header ────────────────────────────────── */}
      <div style={{
        background: 'rgba(0,0,0,.5)', padding: '7px 12px',
        color: CREAM, flexShrink: 0,
        borderBottom: `1px solid ${GOLD}44`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 13,
      }}>
        <span style={{ fontWeight: 700, color: GOLD, fontFamily: 'Georgia,serif' }}>
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

      {/* ── Opponents — share the width equally, no horizontal scroll ── */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 10px',
        flexShrink: 0, justifyContent: 'center',
      }}>
        {state.players.map((p, i) => {
          if (i === mySeat) return null; // don't render myself as an opponent
          const active = i === state.cur;
          const handN = p.handCount ?? p.hand?.length ?? 0;
          const miniN = Math.min(handN, 6);
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
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3, height: 38 }}>
                {Array.from({ length: miniN }).map((_, k) => (
                  <div key={k} style={{ marginInlineStart: k === 0 ? 0 : -18 }}>
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

      {/* ── Board ─────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', minHeight: 0 }}>

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

      {/* ── Piles row ─────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
        gap: 18, padding: '8px 0', flexShrink: 0,
      }}>
        {/* Beit card — hidden (blind ANT bet); takeable in draw phase before you've laid */}
        {(state.beitPresent ?? !!state.beit) && (() => {
          const canTake = state.phase === 'draw' && isMyTurn && !human.hasLaid;
          const blocked = state.phase === 'draw' && isMyTurn && human.hasLaid;
          return (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: GOLD, fontSize: 10, marginBottom: 3 }}>🏠 בית</div>
              <div
                onClick={() => canTake && dispatch({ type: 'TAKE_BEIT' })}
                style={{ cursor: canTake ? 'pointer' : 'default', opacity: blocked ? 0.4 : 1 }}
                title={blocked ? 'אפשר לקחת בית רק לפני שהורדת (לאנט)' : undefined}
              >
                <CardView card={{ id: 'beit' }} back glow={canTake} />
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
            onClick={() => state.phase === 'draw' && isMyTurn && dispatch({ type: 'DRAW' })}
            style={{
              width: 44, height: 62, borderRadius: 6,
              background: 'linear-gradient(145deg,#1e3a6e,#0f2245)',
              border: `2px solid ${state.phase === 'draw' && isMyTurn ? GOLD : '#2d4d8a'}`,
              cursor: state.phase === 'draw' && isMyTurn ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: state.phase === 'draw' && isMyTurn ? `0 0 14px ${GOLD}88` : '0 2px 8px rgba(0,0,0,.4)',
              transition: 'box-shadow .2s',
              backgroundImage: `repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,.04) 3px,rgba(255,255,255,.04) 6px)`,
            }}
          >
            <span style={{ fontSize: 24, color: CREAM }}>🂠</span>
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
              <div style={{ position: 'relative', width: 44 + (depth - 1) * 6, height: 62 + (depth - 1) * 3, margin: '0 auto' }}>
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
              width: 44, height: 62, borderRadius: 6,
              border: '2px dashed rgba(255,255,255,.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 18 }}>∅</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Buying prompt ─────────────────────────── */}
      {state.phase === 'buying' && humanDecides && (
        <div style={{
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
        <div style={{
          padding: '6px 12px', textAlign: 'center', fontSize: 13, flexShrink: 0,
          background: state.msg.startsWith('✓') ? 'rgba(22,101,52,.85)' : 'rgba(127,29,29,.85)',
          color: CREAM,
        }}>
          {state.msg}
        </div>
      )}

      {/* ── Status bar ────────────────────────────── */}
      <div style={{
        background: 'rgba(0,0,0,.45)', padding: '5px 12px',
        color: 'rgba(255,255,255,.7)', fontSize: 12,
        textAlign: 'center', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600 }}>{phaseLabel()}</span>
        <span style={{ color: 'rgba(255,255,255,.45)', marginRight: 10 }}>
          יד: {human.hand.length} • סה״כ: {human.totalScore} נק׳
        </span>
      </div>

      {/* ── Human hand area — always visible ─────── */}
      {(() => {
        const myTurn = isMyTurn && state.phase !== 'round_end' && state.phase !== 'game_end';
        return (
      <div style={{
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
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
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
            marginBottom: 6,
          }}>
            <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 11 }}>
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
                  style={{
                    touchAction: dragging ? 'none' : 'manipulation',
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

      {/* Drag ghost */}
      {drag && (
        <div style={{
          position: 'fixed', left: drag.x - 22, top: drag.y - 31,
          pointerEvents: 'none', zIndex: 9999, transform: 'scale(1.15)',
        }}>
          <CardView card={drag.card} />
        </div>
      )}
    </div>
  );
}

export { CardView, GroupView, RulesModal, ReleaseNotes, Setup, RoundEnd, GameEnd, Game };
