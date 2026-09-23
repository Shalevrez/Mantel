// ═══════════════════════════════════════════════════════
// UI COMPONENTS — presentational React for the online game.
// Adapted from the original single-file game. Game logic now
// lives on the server (game-core via the Worker); here `state`
// arrives already-redacted and `dispatch` sends actions to it.
// ═══════════════════════════════════════════════════════

import { useState, useReducer, useEffect, useLayoutEffect, useRef } from "react";
import {
  SUITS, SYM, COL, VD, cSc, cTxt, MK, FELT, FELTD, GOLD, CREAM,
  INK, GOLDD, CLOTH, CLOTH_BASE, TABLE, TABLE_BASE,
  isSeq, isSet, isGroup, orderSeq, orderGroup, jokerValues, attachPos, meetsReq,
  sortHand, moveCard, handScore,
} from "../game-core.js";
import { Icon, IconLabel, IconText, RankBadge } from "./icons.jsx";

// Card backs (hands, fans, the draw pile): a classic white back with a navy
// lattice inside a thin navy frame, so they stand out on the navy table.
// One background shorthand for all layers, so no later property can override it.
const BACK_BG = `repeating-linear-gradient(45deg, transparent 0 4px, rgba(30,58,95,.35) 4px 5px),
                 repeating-linear-gradient(-45deg, transparent 0 4px, rgba(30,58,95,.35) 4px 5px),
                 #fdf8f0`;
// A white margin, then the navy frame line, drawn inside the card edge.
const BACK_FRAME = `inset 0 0 0 3px #fdf8f0, inset 0 0 0 4px ${FELT}`;
import { RELEASES } from "../releases.js";


// Card geometry comes from --card-w/--card-h (declared in Game's stylesheet), so
// one media query resizes every card, pip and corner at once. The fallbacks keep
// a CardView rendered outside the game screen at the original size.
const CARD_W    = 'var(--card-w, 44px)';
const CARD_H    = 'var(--card-h, 62px)';
const CARD_W_SM = 'var(--card-w-sm, 26px)';
const CARD_H_SM = 'var(--card-h-sm, 38px)';

// ── When a press on a card turns into a drag ──────────────────────────────
// Only movement lifts a card: past DRAG_SLOP pixels it follows the pointer, and
// anything shorter stays a tap (select). There is no hold-to-lift any more — it
// flashed a ghost card on every slightly slow tap or click. A finger jitters
// more than a mouse, so touch gets a little more room before it counts.
const DRAG_SLOP_MOUSE = 4;
const DRAG_SLOP_TOUCH = 7;
// On touch the finger would hide the card it's carrying, so the ghost rides
// this far above the contact point (as a fraction of the card's height), and
// the drop lands where the ghost is, not where the finger is.
const TOUCH_LIFT = 0.85;
// How far above the hand a drop still counts as "in the hand" rather than
// on the board — a forgiving strip, so a drop that's a bit high still sorts.
const HAND_ZONE_SLACK = 28;

// Wipe any text selection the browser started on its own. Called when a press
// turns into a card drag, and again when the drag ends.
function clearSelection() {
  try {
    const s = window.getSelection && window.getSelection();
    if (s && s.rangeCount) s.removeAllRanges();
  } catch { /* nothing selectable — fine */ }
}

// Colour of the "just attached" mark, on both the group and the card itself.
const ATT = '#f472b6';

// `attached`: this card was just attached to a board group — pink ring and a pin.
function CardView({ card, sel, onClick, sm, back, glow, faded, newCard, attached }) {
  const w = sm ? CARD_W_SM : CARD_W;
  const h = sm ? CARD_H_SM : CARD_H;
  // Everything inside a card is a ratio of its height, so it scales with it.
  const fs = (ratio) => `calc(${h} * ${ratio})`;
  const radius = `calc(${h} * .1)`;

  if (back) return (
    <div style={{
      width: w, height: h,
      borderRadius: radius, flexShrink: 0, margin: sm ? '0 1px' : '0 2px',
      background: BACK_BG,
      border: '1.5px solid #fdf8f0',
      boxShadow: `${BACK_FRAME}, 0 2px 6px rgba(0,0,0,.45)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ color: FELT, fontSize: fs(.29) }}>♦</span>
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
        : attached ? `2px solid ${ATT}`
        : (newCard || glow) ? `2px solid ${GOLD}`
        : '1px solid rgba(0,0,0,.22)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: onClick ? 'pointer' : 'default', userSelect: 'none', overflow: 'hidden',
      transform: sel ? `translateY(calc(${h} * -.19)) scale(1.07)` : 'none',
      boxShadow: sel ? '0 11px 22px rgba(96,165,250,.55)'
        : attached ? `0 0 0 2px ${ATT}, 0 0 14px ${ATT}cc`
        : newCard ? `0 0 0 3px ${GOLD}, 0 0 18px ${GOLD}88`
        : glow ? `0 0 12px ${GOLD}aa` : '0 2px 5px rgba(0,0,0,.32)',
      transition: 'transform .11s cubic-bezier(.34,1.56,.64,1), box-shadow .11s',
      opacity: faded ? 0.38 : 1,
      animation: newCard ? 'newCardPulse 1.6s ease-in-out infinite' : 'none',
    }}>
      {attached && (
        <div style={{
          position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)',
          lineHeight: 1, zIndex: 2, pointerEvents: 'none', color: '#be185d',
        }}><Icon name="pin" size={fs(.2)} strokeWidth={2.6} /></div>
      )}
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

// `hot`: a card is being dragged over this group and will attach on release.
// `attBy`: name of the player who just attached to this group (group.att), shown as
// a tag above it, with the attached cards themselves glowing.
function GroupView({ group, onAttach, canAttach, hot, attBy }) {
  const seq = group.type === 'seq';
  const att = group.att;
  const attIds = att ? new Set(att.ids) : null;
  return (
    <div onClick={onAttach} data-gid={group.id} className="group-pop" style={{
      position: 'relative',
      display: 'inline-flex', alignItems: 'center',
      background: hot ? 'rgba(96,165,250,.28)' : seq ? 'rgba(220,252,231,.9)' : 'rgba(254,243,199,.9)',
      border: `2px solid ${hot || canAttach ? '#60a5fa' : att ? ATT : seq ? 'rgba(34,197,94,.55)' : 'rgba(217,119,6,.5)'}`,
      borderRadius: 10, padding: '5px 7px', margin: att ? '11px 3px 3px' : '3px 3px',
      cursor: canAttach ? 'pointer' : 'default',
      boxShadow: hot ? '0 0 0 4px rgba(96,165,250,.6), 0 0 18px rgba(96,165,250,.5)'
        : canAttach ? '0 0 0 3px rgba(96,165,250,.35)'
        : att ? `0 0 12px ${ATT}66` : 'none',
      transform: hot ? 'scale(1.04)' : 'none',
      transition: 'box-shadow .1s, transform .1s, background .1s',
    }}>
      {att && (
        <div title={attBy ? `${attBy} הצמיד/ה לקבוצה הזו` : 'הוצמד לקבוצה הזו'} style={{
          position: 'absolute', top: -10, insetInlineStart: 8, zIndex: 2,
          background: ATT, color: '#3b0a24', borderRadius: 8, padding: '0 6px',
          fontSize: 10, fontWeight: 800, lineHeight: '16px', whiteSpace: 'nowrap',
          maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
          boxShadow: '0 1px 4px rgba(0,0,0,.4)', pointerEvents: 'none',
        }}>
          <Icon name="pin" strokeWidth={2.6} /> {attBy || 'הוצמד'}
        </div>
      )}
      {group.cards.map(c => <CardView key={c.id} card={c} sm attached={!!attIds && attIds.has(c.id)} />)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCOREBOARD — every finished round, side by side
// ═══════════════════════════════════════════════════════

// A column header has room for a couple of characters, not "שתי שלישיות", so a
// round's mishkakon is written as its requirement in digits (4+4 = two quartets).
// The full name rides along on the cell's title.
const MK_SHORT = ['3', '3+3', '4', '4+4', '5', '5+5'];

// Standings marks: a medal for the podium, a numbered ring after it (see
// RankBadge), so any seat count up to six gets one.
const rankMark = (i) => <RankBadge rank={i} />;

// A round score is a penalty — less is better, and an ant is negative — so it's
// always written with its sign.
const fmtScore = (n) => n > 0 ? `+${n}` : n < 0 ? String(n) : '0';

// The whole game on one grid: a row per player, a column per finished round,
// and the running total. Fed by `state.history`, which the server appends to
// as each round is scored, so every client sees the same table.
function Leaderboard({ state, note }) {
  const players = state.players || [];
  const history = state.history || [];
  // Lowest total wins, so the standings are ascending — as on every other screen.
  const order = players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => a.p.totalScore - b.p.totalScore);

  const th = {
    padding: '6px 4px', background: FELT, color: GOLD, fontSize: 11,
    fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center',
  };
  const td = {
    padding: '7px 4px', fontSize: 13, textAlign: 'center',
    borderBottom: '1px solid #e7e5e4', fontVariantNumeric: 'tabular-nums',
  };
  // A signed number inside a right-to-left page is reordered by the browser:
  // "+15" comes out as "15+" and "−50" as "50−". The cells that hold one are
  // their own little left-to-right island so the sign stays in front.
  const numCell = { ...td, direction: 'ltr', unicodeBidi: 'isolate' };

  return (
    <div>
      {/* Six mishkakonim and a few extra deals make for more columns than a
          phone is wide; the table scrolls sideways instead of squeezing. */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e7e5e4' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'right', paddingInlineStart: 8 }}>שחקן</th>
              {history.map(h => (
                <th key={h.n} style={th} title={`${h.mkName} • סיבוב ${h.sivuv}`}>
                  <div>{h.n}</div>
                  <div style={{ fontSize: 9, opacity: .75, fontWeight: 400 }}>{MK_SHORT[h.mk] || ''}</div>
                </th>
              ))}
              <th style={{ ...th, background: FELTD }}>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ p, seat }, rank) => (
              <tr key={seat}>
                <td style={{
                  ...td, textAlign: 'right', paddingInlineStart: 8,
                  fontWeight: 700, whiteSpace: 'nowrap',
                  background: rank === 0 ? '#fefce8' : 'transparent',
                }}>
                  {rankMark(rank)} {p.name}{p.you ? ' (אתה)' : ''}
                </td>
                {history.map(h => {
                  const s = h.scores[seat] ?? 0;
                  const won = h.w === seat;
                  return (
                    <td key={h.n}
                      title={won ? (h.isAnt ? 'אנט!' : 'סיים ראשון') : undefined}
                      style={{
                        ...numCell,
                        color: s > 0 ? '#b91c1c' : '#15803d',
                        fontWeight: won ? 700 : 400,
                        background: won ? (h.isAnt ? '#f5f3ff' : '#f0fdf4') : 'transparent',
                      }}>
                      {won && <Icon name={h.isAnt ? 'target' : 'trophy'} style={{ marginInlineEnd: 2 }} />}{fmtScore(s)}
                    </td>
                  );
                })}
                <td style={{
                  ...numCell, fontWeight: 700, fontSize: 15, color: FELTD,
                  background: rank === 0 ? '#fefce8' : '#fafaf9',
                }}>
                  {p.totalScore}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.length === 0 && (
        <div style={{ color: '#78716c', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
          עדיין לא הסתיים אף סיבוב — הטבלה תתמלא בסוף הסיבוב הראשון.
        </div>
      )}
      {note}
      <div style={{ color: '#a8a29e', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
        כמה שפחות נקודות — יותר טוב · <Icon name="target" /> אנט · <Icon name="trophy" /> סיים ראשון
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// BOARD REVEAL — what was laid down, after the round is over
// ═══════════════════════════════════════════════════════

// The groups keep their felt background here: their green/amber tints are drawn
// for the table, and on the cream end-of-round card they'd wash out.
function BoardReveal({ board, empty = 'לא הורדו קבוצות בסיבוב הזה' }) {
  const groups = board || [];
  return (
    <div style={{
      background: `radial-gradient(ellipse at 50% 0%, #2a4d7a, ${FELTD})`,
      borderRadius: 12, border: `1px solid ${GOLD}55`, padding: 8,
      maxHeight: 260, overflowY: 'auto',
    }}>
      {groups.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
          {groups.map(g => <GroupView key={g.id} group={g} />)}
        </div>
      ) : (
        <div style={{
          textAlign: 'center', color: 'rgba(255,255,255,.5)',
          fontSize: 13, padding: '18px 0',
        }}>{empty}</div>
      )}
    </div>
  );
}

// A row of segmented buttons — the end-of-round card is too small to stack the
// round summary, the table and the board on top of each other.
function SegTabs({ tabs, active, onPick }) {
  return (
    <div style={{
      display: 'flex', gap: 4, background: '#e7e5e4',
      borderRadius: 10, padding: 3, marginBottom: 12,
    }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onPick(t.key)} style={{
          flex: 1, padding: '7px 2px', borderRadius: 8, border: 'none',
          cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
          background: active === t.key ? FELT : 'transparent',
          color: active === t.key ? GOLD : '#57534e',
        }}><IconText text={t.label} /></button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCORE MODAL — the table, mid-game
// ═══════════════════════════════════════════════════════

function ScoreModal({ state, onClose }) {
  const me = state.players.find(p => p.you);
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
        <div style={{
          background: FELT, padding: '14px 18px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ color: GOLD, fontSize: 20, fontWeight: 700 }}>
            <IconLabel name="trophy">טבלת ניקוד</IconLabel>
          </span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.15)', color: CREAM, border: 'none',
            borderRadius: 8, width: 30, height: 30, fontSize: 18, cursor: 'pointer',
            fontWeight: 700, lineHeight: 1,
          }}><Icon name="x" size={16} strokeWidth={2.6} /></button>
        </div>

        <div style={{ padding: '16px 16px 20px', overflowY: 'auto' }}>
          <Leaderboard
            state={state}
            note={me && me.hand ? (
              <div style={{
                marginTop: 10, padding: '9px 12px', borderRadius: 10,
                background: '#fffbeb', border: '1px solid #fde68a',
                color: '#92400e', fontSize: 13, textAlign: 'center', fontWeight: 700,
              }}>
                <Icon name="hand" /> היד שלך כרגע: {handScore(me.hand)} נק׳ ({me.hand.length} קלפים)
                <div style={{ fontWeight: 400, fontSize: 11.5, marginTop: 3 }}>
                  זה מה שייזקף לך אם הסיבוב ייגמר ברגע זה
                </div>
              </div>
            ) : null}
          />
        </div>
      </div>
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
      }}><IconText text={title} /></div>
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
            <IconLabel name="book">חוקי מנטל</IconLabel>
          </span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.15)', color: CREAM, border: 'none',
            borderRadius: 8, width: 30, height: 30, fontSize: 18, cursor: 'pointer',
            fontWeight: 700, lineHeight: 1,
          }}><Icon name="x" size={16} strokeWidth={2.6} /></button>
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

          <Section title="☝️ קלף אחרון ביד">
            שחקן שנשאר לו <b>קלף אחד</b> ביד לא יכול לקחת מהאשפה ולא לקנות —
            הדבר היחיד שמותר לו הוא <b>לשלוף מהחבילה</b> בתור שלו.
          </Section>

          <Section title="🏆 סיום משחקון (יציאה)">
            כדי לסיים, מורידים את כל הקלפים <b>חוץ מאחד</b>, וזורקים אותו לאשפה.
            תמיד חייבים לסיים את התור בזריקה — אי אפשר לסיים עם 0 קלפים בלי זריקה.
          </Section>

          <Section title="🎯 אנט (−50 נקודות!)">
            אם מורידים את <b>כל</b> היד בקבוצות חדשות משלך <b>בתור אחד</b> (ואז זורקים
            את הקלף האחרון) — זה <b>אנט</b>, ומקבלים בונוס של 50 נקודות פחות.<br/>
            <Icon name="alert" /> אם הצמדת קלפים לקבוצות קיימות של אחרים — זה כבר ניצחון רגיל (0), לא אנט.
          </Section>

          <Section title="🃏 לקיחת ג׳וקר">
            אם על השולחן יש ג׳וקר בתוך רצף, ואתה מחזיק את הקלף האמיתי שהוא מחליף —
            אפשר להחליף: הקלף שלך נכנס לרצף, והג׳וקר חוזר לידך. <b>חובה להשתמש בו
            באותו תור</b> (להצמיד או להוריד בקבוצה חדשה) לפני הזריקה.
          </Section>

          <Section title="🏠 קלף הבית">
            במקום לשלוף, אפשר לקחת את "קלף הבית" — קלף גלוי שכולם רואים, מיועד
            לניסיון אנט. אם לא הסתדר, אפשר ללחוץ "<Icon name="undo" /> החזר בית" כדי להחזיר אותו
            ולבחור שליפה אחרת.
          </Section>

          <Section title="✋ סידור היד">
            אפשר לסדר את הקלפים ביד כרצונך <b>בכל רגע — גם כשזה לא התור שלך</b>:
            פשוט <b>גוררים</b> קלף למקום החדש — קו זהב מראה בדיוק איפה הוא ינחת. כפתור <b><Icon name="sort" /> מיין</b> ממיין
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
      background: CLOTH,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
      <div style={{
        background: CREAM, borderRadius: 22, padding: '28px 24px',
        maxWidth: 390, width: '100%',
        boxShadow: `0 24px 72px rgba(0,0,0,.6), 0 0 0 3px ${GOLD}55`,
        border: `2px solid ${GOLD}77`,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 56, marginBottom: 4, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.2))', color: FELT }}><Icon name="cards" size={56} strokeWidth={1.8} /></div>
          <h1 style={{
            margin: 0, fontSize: 32,
            color: FELTD, letterSpacing: 2, fontWeight: 700,
          }}>מנטל</h1>
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
                transition: 'all .12s',
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
                <Icon name={i === 0 ? 'user' : p.isAI ? 'bot' : 'users'} />
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
                    transition: 'all .12s',
                  }}><IconText text={label} /></button>
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
          <IconLabel name="play">התחל משחק</IconLabel>
        </button>

        <button onClick={() => setShowRules(true)} style={{
          width: '100%', padding: '11px 0', background: 'transparent', color: FELT,
          border: `2px solid ${FELT}44`, borderRadius: 13,
          fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 10,
        }}>
          <IconLabel name="book">חוקים והסבר</IconLabel>
        </button>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ROUND END
// ═══════════════════════════════════════════════════════

function RoundEnd({ state, dispatch, onLeave }) {
  const { result, players, mk, sivuv } = state;
  const winner = result.w !== null ? players[result.w] : null;
  const sorted = [...players].sort((a, b) => a.totalScore - b.totalScore);
  // This round's own tally opens first. The cross-round table and the cards that
  // were laid down are one tap away, and stay there until somebody deals again.
  const [tab, setTab] = useState('round');
  const [showLeave, setShowLeave] = useState(false);

  return (
    <div style={{
      minHeight: '100vh',
      background: CLOTH,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
      <div className="rules-card" style={{
        background: CREAM, borderRadius: 22, padding: 24,
        maxWidth: 420, width: '100%',
        border: `2px solid ${GOLD}66`,
        boxShadow: `0 12px 40px rgba(19,40,79,.18)`,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 16, flexShrink: 0 }}>
          <div style={{ fontSize: 42, color: result.isAnt ? '#7c3aed' : result.empty ? '#78716c' : '#16a34a' }}>
            <Icon name={result.isAnt ? 'target' : result.empty ? 'package' : 'checkCircle'} strokeWidth={1.8} />
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
            flexShrink: 0,
          }}>
            {winner.name} {result.isAnt ? 'אנט! (−50 נק׳)' : 'סיים ראשון!'} <Icon name={result.isAnt ? 'target' : 'trophy'} />
          </div>
        )}

        <SegTabs
          active={tab} onPick={setTab}
          tabs={[
            { key: 'round', label: '📋 הסיבוב' },
            { key: 'table', label: '🏆 טבלה' },
            { key: 'board', label: '🃏 הורדות' },
          ]}
        />

        <div style={{ marginBottom: 16, overflowY: 'auto' }}>
          {tab === 'round' && sorted.map((p, i) => {
            const ls = p.lastScore ?? 0;
            return (
              <div key={p.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 11, marginBottom: 6,
                background: p.id === result.w ? '#f0fdf4' : '#fafaf9',
                border: `2px solid ${p.id === result.w ? '#86efac' : '#e7e5e4'}`,
              }}>
                <span style={{ fontWeight: 700 }}>
                  {rankMark(i)} {p.name}
                </span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{
                    fontSize: 12, color: ls > 0 ? '#dc2626' : '#16a34a',
                    direction: 'ltr', unicodeBidi: 'isolate',
                  }}>
                    {ls > 0 ? `+${ls}` : ls < 0 ? ls : '±0'}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: FELTD }}>
                    {p.totalScore}<span style={{ fontSize: 11, color: '#78716c', fontWeight: 400 }}> נק׳</span>
                  </span>
                </div>
              </div>
            );
          })}

          {tab === 'table' && <Leaderboard state={state} />}

          {tab === 'board' && (
            <>
              <BoardReveal board={state.board} />
              <div style={{ color: '#a8a29e', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                כל הקבוצות שהורדו לשולחן בסיבוב הזה
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => mk >= 5 ? dispatch({ type: 'GAME_END' }) : dispatch({ type: 'NEXT_MK' })}
            style={{
              flex: 1, padding: '11px 0', background: FELT, color: GOLD,
              border: `2px solid ${GOLD}88`, borderRadius: 11,
              fontSize: 14, cursor: 'pointer', fontWeight: 700,
            }}
          >
            {mk >= 5
              ? <IconLabel name="trophy">סיום</IconLabel>
              : <IconLabel name="arrowRight">{MK[mk + 1]?.name}</IconLabel>}
          </button>
        </div>
        {onLeave && (
          <button onClick={() => setShowLeave(true)} style={{
            width: '100%', marginTop: 10, padding: '8px 0', background: 'transparent',
            color: '#b91c1c', border: 'none', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}>
            <IconLabel name="logOut">יציאה מהחדר</IconLabel>
          </button>
        )}
      </div>
      {showLeave && <LeaveConfirm started onConfirm={onLeave} onClose={() => setShowLeave(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GAME END
// ═══════════════════════════════════════════════════════

function GameEnd({ state, onRestart }) {
  const sorted = [...state.players].sort((a, b) => a.totalScore - b.totalScore);
  // The final table is the point of this screen, so it opens on the standings;
  // the round-by-round grid and the last board are behind the other two tabs.
  const [tab, setTab] = useState('final');

  return (
    <div style={{
      minHeight: '100vh',
      background: CLOTH,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 16,
    }}>
      <div className="rules-card" style={{
        background: CREAM, borderRadius: 22, padding: 28,
        maxWidth: 420, width: '100%',
        border: `2px solid ${GOLD}`, boxShadow: `0 24px 72px rgba(0,0,0,.6)`,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20, flexShrink: 0 }}>
          <div style={{ color: GOLDD }}><Icon name="trophy" size={56} strokeWidth={1.8} /></div>
          <h2 style={{ margin: '6px 0 4px', color: FELTD, fontSize: 28, fontWeight: 700 }}>
            סיום המשחק
          </h2>
          <p style={{ color: '#16a34a', fontWeight: 700, fontSize: 20, margin: 0 }}>
            {sorted[0].name} ניצח!
          </p>
        </div>

        <SegTabs
          active={tab} onPick={setTab}
          tabs={[
            { key: 'final', label: '🏁 סופי' },
            { key: 'table', label: '🏆 טבלה' },
            { key: 'board', label: '🃏 הורדות' },
          ]}
        />

        <div style={{ overflowY: 'auto' }}>
          {tab === 'final' && sorted.map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 14px', borderRadius: 12, marginBottom: 8,
              background: i === 0 ? '#fefce8' : '#fafaf9',
              border: i === 0 ? `2px solid ${GOLD}` : '2px solid #e7e5e4',
            }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {rankMark(i)} {p.name}
              </span>
              <span style={{ fontWeight: 700, fontSize: 20, color: FELTD }}>
                {p.totalScore}<span style={{ fontSize: 12, color: '#78716c', fontWeight: 400 }}> נק׳</span>
              </span>
            </div>
          ))}

          {tab === 'table' && <Leaderboard state={state} />}

          {tab === 'board' && (
            <>
              <BoardReveal board={state.board} empty="לא נשארו קבוצות על השולחן" />
              <div style={{ color: '#a8a29e', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                הקבוצות שהורדו בסיבוב האחרון
              </div>
            </>
          )}
        </div>

        <button onClick={onRestart} style={{
          width: '100%', padding: '14px 0', background: FELT, color: GOLD,
          border: `2px solid ${GOLD}`, borderRadius: 13,
          fontSize: 17, fontWeight: 700, cursor: 'pointer', marginTop: 12, flexShrink: 0,
        }}>
          <IconLabel name="play">משחק חדש</IconLabel>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// LEAVE ROOM — "are you sure?" before giving up the seat
// Leaving is for good: the chair is freed (or, mid-game, handed to
// a computer player), so a stray tap must not do it on its own.
// ═══════════════════════════════════════════════════════

function LeaveConfirm({ started, onConfirm, onClose }) {
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
        style={{
          background: CREAM, borderRadius: 20, maxWidth: 360, width: '100%',
          padding: '22px 20px', textAlign: 'center',
          border: `2px solid ${GOLD}88`, boxShadow: '0 24px 72px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ color: '#b91c1c', marginBottom: 6 }}><Icon name="logOut" size={38} /></div>
        <div style={{ color: FELTD, fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
          לצאת מהחדר?
        </div>
        <p style={{ color: '#57534e', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
          {started
            ? 'המחשב ימשיך לשחק במקומך, ולא תוכלו לחזור למשחק הזה.'
            : 'הכיסא שלך יתפנה. אפשר להצטרף שוב עם קוד החדר.'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '11px 0', background: '#e7e5e4',
            color: '#57534e', border: '2px solid #d6d3d1',
            borderRadius: 11, fontSize: 14, cursor: 'pointer', fontWeight: 600,
            fontFamily: 'inherit',
          }}>
            הישאר
          </button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '11px 0', background: '#b91c1c', color: '#fff',
            border: '2px solid #991b1b', borderRadius: 11,
            fontSize: 14, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit',
          }}>
            <IconLabel name="logOut">יציאה</IconLabel>
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN GAME SCREEN
// ═══════════════════════════════════════════════════════


function Game({ state, dispatch, onLeave }) {
  const [attachMode, setAttachMode] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  // Card drag. `drag` is { card, touch } while a card is lifted and only changes
  // when a drag starts or ends; the pointer position, the insertion slot and the
  // ghost's placement live in dragRef and go straight to the DOM, so following
  // the finger never re-renders the whole table.
  const [drag, setDrag] = useState(null);
  // The board group the dragged card is over, if releasing would attach it.
  const [hotGid, setHotGid] = useState(null);
  const dragRef = useRef({
    card: null, active: false, pointerId: null, touch: false,
    startX: 0, startY: 0, x: 0, y: 0, lift: 0, slop: DRAG_SLOP_MOUSE,
    slot: null, gid: null,
  });
  const ghostRef  = useRef(null);
  const markerRef = useRef(null);
  const handRowRef = useRef(null);
  const handAreaRef = useRef(null);
  // A drag that ends over its own card would otherwise also count as a click
  // on it and toggle its selection.
  const swallowClick = useRef(false);
  // A dropped card goes where it was dropped at once; the server's copy of the
  // hand catches up a round-trip later. `pendingOrder` is the order we showed,
  // kept until the server's hand matches it (or changes under us).
  const [pendingOrder, setPendingOrder] = useState(null);
  // Online: "me" is the seat the server marked with you:true.
  const mySeat  = state.players.findIndex(p => p.you);
  const me      = mySeat >= 0 ? state.players[mySeat] : state.players[0];
  const cur     = state.players[state.cur];
  const isMyTurn = mySeat === state.cur;
  // `human`/`cur.isAI` in the original meant "the local human". Online, that maps
  // to "is it my turn": UI controls light up only on my own turn.
  const human   = me;
  const discard = state.discard[state.discard.length - 1];
  // What the hand is worth right now — the penalty this player takes if the
  // round ends on someone else's card. Recomputed every render, so it tracks
  // every draw, lay and discard without the server having to send it.
  const myPts   = handScore(human.hand);
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

  // ── Card drag: reorder within hand, or attach to a board group ──
  // Rearranging your own hand is allowed at ANY time — also while you're waiting
  // for someone else to play. Only the "drop on a board group" half of the drag
  // (an attach) is restricted to your own turn; see endPress.
  const canDragCard = (card) => !stagedIds.has(card.id);

  // The hand as drawn: the server's order, or the order of a drop the server
  // hasn't confirmed yet. A pending order only applies while it holds exactly
  // the same cards — after a draw or a discard the server's hand is the truth.
  const sameCards = (order, hand) =>
    order && order.length === hand.length && hand.every(c => order.includes(c.id));
  const hand = sameCards(pendingOrder, human.hand)
    ? pendingOrder.map(id => human.hand.find(c => c.id === id))
    : human.hand;
  useEffect(() => {
    if (!pendingOrder) return;
    // Confirmed (the server's order caught up) or superseded (the cards changed).
    const confirmed = human.hand.every((c, i) => c.id === pendingOrder[i]);
    if (confirmed || !sameCards(pendingOrder, human.hand)) setPendingOrder(null);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the dragged card would land if released at (x, y), worked out from
  // the cards' boxes rather than from whatever element is under the point, so
  // gaps between cards, the ends of a row and the space after the last card
  // are all valid drops. Returns { targetId, after, bar } — bar is the gold
  // insertion line's screen box — or null when (x, y) is not over the hand.
  function slotAt(x, y, dragId) {
    const row = handRowRef.current, area = handAreaRef.current;
    if (!row || !area) return null;
    const a = area.getBoundingClientRect();
    if (y < a.top - HAND_ZONE_SLACK || x < a.left || x > a.right) return null;
    const rtl = getComputedStyle(row).direction === 'rtl';
    const items = [...row.querySelectorAll('[data-cardid]')]
      .filter(el => el.getAttribute('data-cardid') !== dragId)
      .map(el => ({ id: el.getAttribute('data-cardid'), r: el.getBoundingClientRect() }));
    if (!items.length) return null;

    // The hand wraps, so first find the row (cards sharing a top edge) whose
    // band is nearest the point, then the gap within that row.
    const rows = [];
    for (const it of items) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last[0].r.top - it.r.top) < it.r.height / 2) last.push(it);
      else rows.push([it]);
    }
    const band = (rw) => {
      const top = rw[0].r.top, bottom = rw[0].r.bottom;
      return y < top ? top - y : y > bottom ? y - bottom : 0;
    };
    const line = rows.reduce((best, rw) => band(rw) < band(best) ? rw : best, rows[0]);

    // DOM order within a row is reading order: right-to-left on this page.
    const past = (r) => rtl ? x < r.left + r.width / 2 : x > r.left + r.width / 2;
    const idx = line.findIndex(it => !past(it.r));
    const r0 = line[0].r;
    if (idx >= 0) {
      const r = line[idx].r;
      return { targetId: line[idx].id, after: false,
               bar: { x: rtl ? r.right + 1 : r.left - 1, top: r.top, h: r.height } };
    }
    const r = line[line.length - 1].r;
    return { targetId: line[line.length - 1].id, after: true,
             bar: { x: rtl ? r.left - 1 : r.right + 1, top: r0.top, h: r.height } };
  }

  // The board group under (x, y), if dropping there is an attach we may try.
  function groupAt(x, y) {
    if (!isMyTurn || state.phase !== 'action') return null;
    const el = document.elementFromPoint(x, y);
    const g = el && el.closest('[data-gid]');
    return g ? g.getAttribute('data-gid') : null;
  }

  // Put the ghost and the insertion bar where dragRef says, straight on the DOM.
  function paintDrag() {
    const d = dragRef.current;
    if (ghostRef.current)
      ghostRef.current.style.transform =
        `translate(${d.x}px, ${d.y - d.lift}px) translate(-50%, -50%) scale(1.12)`;
    const m = markerRef.current;
    if (m) {
      const b = d.slot && d.slot.bar;
      m.style.display = b ? 'block' : 'none';
      if (b) m.style.transform = `translate(${b.x - 2}px, ${b.top - 4}px)`;
      if (b) m.style.height = `${b.h + 8}px`;
    }
  }

  function track(x, y) {
    const d = dragRef.current;
    d.x = x; d.y = y;
    // The drop point is the ghost's centre: on touch that's above the finger.
    const hx = x, hy = y - d.lift;
    d.slot = slotAt(hx, hy, d.card.id);
    d.gid = d.slot ? null : groupAt(hx, hy);
    setHotGid(g => g === d.gid ? g : d.gid);
    paintDrag();
  }

  function startPress(card, e) {
    if (!canDragCard(card)) return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const d = dragRef.current;
    const touch = e.pointerType !== 'mouse';
    const h = e.currentTarget.getBoundingClientRect().height;
    Object.assign(d, {
      card, active: false, pointerId: e.pointerId, touch,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      slop: touch ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE,
      lift: touch ? h * TOUCH_LIFT : 0,
      slot: null, gid: null,
    });
  }
  function movePress(e) {
    const d = dragRef.current;
    if (!d.card || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      // The hand row keeps the touch to itself (touch-action: none), so a press
      // that travels can only mean a drag. Anything shorter is still a tap.
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < d.slop) return;
      d.active = true;
      // If the browser managed to start a selection before the press became a
      // drag, drop it — otherwise the highlight stays on screen for the whole
      // drag and the card looks like selected text.
      clearSelection();
      setDrag({ card: d.card, touch: d.touch });
    }
    if (e.cancelable) e.preventDefault(); // block scroll while dragging
    track(e.clientX, e.clientY);
  }
  function finish(drop) {
    const d = dragRef.current;
    if (d.active && d.card) {
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 80);
      if (drop && d.gid) {
        // If the dragged card is part of a current multi-card selection, attach the
        // whole selection at once; otherwise attach just the dragged card.
        if (state.sel.length > 1 && state.sel.includes(d.card.id))
          dispatch({ type: 'ATTACH', gid: d.gid });
        else
          dispatch({ type: 'ATTACH', gid: d.gid, cid: d.card.id });
      } else if (drop && d.slot) {
        const { targetId, after } = d.slot;
        const next = moveCard(hand, d.card.id, targetId, after);
        if (next !== hand) {
          setPendingOrder(next.map(c => c.id));
          dispatch({ type: 'REORDER', cid: d.card.id, targetId, after });
        }
      }
    }
    Object.assign(d, { card: null, active: false, pointerId: null, slot: null, gid: null });
    clearSelection();
    setDrag(null);
    setHotGid(null);
  }
  function endPress(e) {
    const d = dragRef.current;
    if (!d.card || e.pointerId !== d.pointerId) return;
    // A cancel (the OS took the gesture) puts the card back where it was.
    if (e.type === 'pointerup' && d.active) track(e.clientX, e.clientY);
    finish(e.type === 'pointerup');
  }

  // Global listeners so drag tracks across the whole screen (re-bound each render for fresh state)
  useEffect(() => {
    const move = (e) => movePress(e);
    const up = (e) => endPress(e);
    // Esc drops a card back where it came from.
    const key = (e) => { if (e.key === 'Escape' && dragRef.current.active) finish(false); };
    const click = (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation(); e.preventDefault();
    };
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
    window.addEventListener('keydown', key);
    window.addEventListener('click', click, true);
    window.addEventListener('selectstart', noSelect);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('click', click, true);
      window.removeEventListener('selectstart', noSelect);
    };
  });

  // The ghost and the bar mount with the drag; place them before first paint.
  useLayoutEffect(() => { if (drag) paintDrag(); }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

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
      opacity: disabled ? 0.55 : 1, transition: 'opacity .08s',
    }}><IconText text={label} /></button>
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
      background: TABLE,
      backgroundColor: TABLE_BASE,
      direction: 'rtl',
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
    }}>
      <style>{`
        /* Belt and braces for the card drag: the card and everything
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

        /* ── A phone (or a narrow split view). The header carries five
           controls now, the leave button included, so on anything narrower
           than a small tablet the buttons drop their words and keep their
           icons; on a small phone the hand's drag hint gives up its room to
           the points chip too. ── */
        @media (max-width: 480px) {
          .hdr-label { display: none; }
        }
        @media (max-width: 380px) {
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
        .deal-card { animation: dealIn .18s cubic-bezier(.34,1.4,.64,1) both; }
        .group-pop { animation: popIn .2s cubic-bezier(.34,1.56,.64,1) both; }
        .discard-card { animation: discardDrop .18s ease-out both; }
      `}</style>

      <div className="game-grid">

      {/* ── Header ────────────────────────────────── */}
      <div className="ga-header" style={{
        background: 'rgba(6,14,30,.6)', padding: '7px 12px',
        color: CREAM, flexShrink: 0,
        borderBottom: `1px solid ${GOLD}44`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 13,
      }}>
        <span style={{ fontWeight: 700, color: GOLD }}>
          {mk.name}
        </span>
        <span style={{ color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap' }}>סיבוב {state.sivuv}</span>
        <span style={{
          fontSize: 11, padding: '2px 9px', borderRadius: 20,
          background: state.canLay ? 'rgba(34,197,94,.25)' : 'rgba(251,191,36,.25)',
          color: state.canLay ? '#86efac' : GOLD,
        }}>
          <IconText text={state.canLay ? '✓ הורדה' : '⚠ סבב ראשון'} />
        </span>
        <span style={{ display: 'flex', gap: 5 }}>
          <button onClick={() => setShowRules(true)} title="חוקים" style={{
            background: 'rgba(255,255,255,.12)', color: CREAM, border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '3px 9px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}><Icon name="book" /><span className="hdr-label"> חוקים</span></button>
          <button onClick={() => setShowScores(true)} title="טבלת ניקוד" style={{
            background: 'rgba(255,255,255,.12)', color: CREAM, border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '3px 9px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}><Icon name="trophy" /><span className="hdr-label"> ניקוד</span></button>
          <button onClick={() => setShowNotes(true)} title="מה חדש בגרסה" style={{
            background: 'rgba(255,255,255,.12)', color: CREAM, border: 'none',
            borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '3px 8px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}><Icon name="sparkles" /></button>
          {onLeave && (
            <button onClick={() => setShowLeave(true)} title="יציאה מהחדר" style={{
              background: 'rgba(185,28,28,.35)', color: CREAM, border: 'none',
              borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '3px 9px',
              cursor: 'pointer', fontFamily: 'inherit',
            }}><Icon name="logOut" /><span className="hdr-label"> יציאה</span></button>
          )}
        </span>
      </div>

      {showLeave && <LeaveConfirm started onConfirm={onLeave} onClose={() => setShowLeave(false)} />}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showNotes && <ReleaseNotes onClose={() => setShowNotes(false)} />}
      {showScores && <ScoreModal state={state} onClose={() => setShowScores(false)} />}

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
                : 'rgba(6,14,30,.45)',
              border: `2px solid ${active ? '#fde68a' : 'rgba(255,255,255,.12)'}`,
              borderRadius: 11, padding: '6px 6px', color: CREAM,
              textAlign: 'center',
              boxShadow: active ? '0 0 16px rgba(245,158,11,.6)' : 'none',
              animation: active ? 'turnGlow 1.8s ease-in-out infinite' : 'none',
              transition: 'background .15s, border-color .15s, box-shadow .15s',
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
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', whiteSpace: 'nowrap' }}>
                <Icon name="cards" /> {handN} · <Icon name="star" /> {p.totalScore}
              </div>
              {active && (
                <div style={{ fontSize: 10, color: '#fffbeb', marginTop: 2, whiteSpace: 'nowrap' }}>
                  <IconText text={state.phase === 'action' ? '🎯 פועל' : state.phase === 'draw' ? '📤 שולף' : '⏳'} />
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
              <div style={{ color: GOLD, fontSize: 10, fontWeight: 700, marginBottom: 3 }}><Icon name="home" /> בית</div>
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
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginBottom: 3 }}>
            חבילה ({state.deckCount ?? state.deck?.length ?? 0})
          </div>
          <div
            onClick={() => state.phase === 'draw' && isMyTurn && drawOnce({ type: 'DRAW' })}
            style={{
              width: 'var(--card-w)', height: 'var(--card-h)',
              borderRadius: 'calc(var(--card-h) * .1)',
              border: `2px solid ${state.phase === 'draw' && isMyTurn ? GOLD : '#fdf8f0'}`,
              cursor: state.phase === 'draw' && isMyTurn ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `${BACK_FRAME}, ` + (state.phase === 'draw' && isMyTurn ? `0 0 14px ${GOLD}88` : '0 2px 8px rgba(0,0,0,.45)'),
              transition: 'box-shadow .12s',
              background: BACK_BG,
            }}
          >
            <Icon name="cards" size="calc(var(--card-h) * .39)" color={FELT} strokeWidth={2} />
          </div>
        </div>

        {/* Discard pile — cumulative; take the top only via the buying offer */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginBottom: 3 }}>
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
              border: '2px dashed rgba(255,255,255,.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 18 }}>∅</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar ────────────────────────────── */}
      <div className="ga-status" style={{
        background: 'rgba(6,14,30,.6)', padding: '5px 12px',
        color: 'rgba(255,255,255,.85)', fontSize: 12,
        textAlign: 'center', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600 }}><IconText text={phaseLabel()} /></span>
        <span style={{ color: 'rgba(255,255,255,.6)', marginRight: 10 }}>
          יד: {human.hand.length} קלפים · <b style={{ color: GOLD, whiteSpace: 'nowrap' }}>{myPts} נק׳</b>
          {' '}• סה״כ: {human.totalScore}
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
              <IconText text={isFreeOffer ? '✓ קח' : '💰 קנה'} />
            </button>
            <button
              onClick={() => dispatch({ type: 'SKIP' })}
              style={{
                padding: '9px 24px', background: '#475569', color: 'white',
                border: 'none', borderRadius: 9, cursor: 'pointer',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              <Icon name="x" /> וותר
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
          <IconText text={state.msg} />
        </div>
      )}


      {/* ── Board ─────────────────────────────────── */}
      <div className="ga-board" style={{ padding: '6px 10px' }}>

        {/* Staging area — shown only while accumulating groups before requirement is met */}
        {state.staging.length > 0 && (() => {
          const reqMet = human.hasLaid || meetsReq(state.staging, state.mk);
          return (
          <div style={{
            background: 'rgba(254,243,199,.9)',
            border: '2px dashed rgba(217,119,6,.55)',
            borderRadius: 12, padding: '7px 9px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ color: GOLDD, fontSize: 12, fontWeight: 700 }}>
                <Icon name="hourglass" /> בתהליך הורדה — {state.staging.length} קבוצ{state.staging.length > 1 ? 'ות' : 'ה'}
              </span>
              <span style={{ color: '#57534e', fontSize: 11 }}>
                {!reqMet ? `דרוש: ${MK[state.mk].name}` : <><Icon name="check" /> מוכן</>}
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
                background: 'rgba(255,255,255,.7)', color: '#78716c',
                border: '1px solid rgba(120,113,108,.3)',
                borderRadius: 7, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
              }}
            >
              <Icon name="x" /> בטל הורדה
            </button>
          </div>
          );
        })()}

        {/* Must-use joker hint */}
        {state.mustUseJoker && isMyTurn &&
          human.hand.some(c => c.id === state.mustUseJoker) && (
          <div style={{
            background: 'rgba(237,233,254,.92)', border: '2px solid #7c3aed',
            borderRadius: 12, padding: '8px 12px', marginBottom: 8, textAlign: 'center',
            color: '#5b21b6', fontSize: 13, fontWeight: 700,
          }}>
            <Icon name="cards" /> חובה להשתמש בג׳וקר — הצמד לקבוצה או הורד בקבוצה חדשה עם קלפים מהיד
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
                  attBy={g.att ? state.players[g.att.by]?.name : null}
                  canAttach={normalAttach}
                  hot={hotGid === g.id}
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
            color: 'rgba(255,255,255,.4)', fontSize: 14,
          }}>
            הלוח ריק
          </div>
        )}
      </div>


      {/* ── Human hand area — always visible ─────── */}
      {(() => {
        const myTurn = isMyTurn && state.phase !== 'round_end' && state.phase !== 'game_end';
        return (
      <div className="ga-hand" ref={handAreaRef} style={{
        background: myTurn
          ? 'linear-gradient(180deg, #7c4a09, #1a1206)'
          : '#0f172a',
        padding: '8px 10px 10px', flexShrink: 0,
        borderTop: myTurn ? '3px solid #f59e0b' : '3px solid transparent',
        boxShadow: myTurn ? 'inset 0 8px 24px -8px rgba(245,158,11,.5)' : 'none',
        transition: 'background .15s, border-color .15s, box-shadow .15s',
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
                bg={attachMode ? GOLD : FELT} col={attachMode ? FELTD : GOLD}
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
              גררו קלף כדי לסדר את היד
            </span>
            {/* The live cost of whatever is still in the hand. Tapping it opens
                the full table, so the number is never a dead end. */}
            <button
              onClick={() => setShowScores(true)}
              title="כמה נקודות ייזקפו לך אם הסיבוב ייגמר עכשיו"
              style={{
                background: 'rgba(251,191,36,.14)', color: GOLD,
                border: `1px solid ${GOLD}55`, borderRadius: 8,
                fontSize: 12, fontWeight: 700, padding: '5px 10px',
                cursor: 'pointer', fontFamily: 'inherit',
                marginInlineStart: 'auto', marginInlineEnd: 6,
                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              }}
            ><Icon name="hand" /> {myPts} נק׳ ביד</button>
            <button
              onClick={() => { setPendingOrder(null); dispatch({ type: 'SORT' }); }}
              style={{
                background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155',
                borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '5px 12px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            ><Icon name="sort" /> מיין</button>
          </div>

          {/* Hand cards — wrap to multiple rows to fit screen width (no scroll) */}
          <div
            ref={handRowRef}
            style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
              alignContent: 'flex-start', gap: 2, paddingBottom: 2, paddingTop: 14,
            }}
          >
            {hand.map((c) => {
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
                    cursor: dragging ? 'grabbing' : 'grab',
                    // Always 'none', not just mid-drag: the browser picks the
                    // gesture owner at touch-start, so switching once the drag
                    // has begun is too late to stop a swipe-navigation.
                    // Nothing scrolls here — the hand is a fixed row — so the
                    // touch is ours to keep.
                    touchAction: 'none',
                    zIndex: sel ? 100 : 1,
                    flexShrink: 0,
                  }}
                >
                  <CardView
                    card={c}
                    sel={sel}
                    // The fade lives on the card, not this wrapper: dealIn's
                    // fill-mode pins the wrapper's opacity at 1.
                    faded={inStage || dragging}
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

      {/* Drag ghost — under the cursor, or lifted above the finger on touch so
          it stays visible. Positioned by paintDrag(), never by a re-render. */}
      {drag && (
        <div ref={ghostRef} style={{
          position: 'fixed', left: 0, top: 0,
          pointerEvents: 'none', zIndex: 9999,
          filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.55))',
          willChange: 'transform',
        }}>
          <CardView card={drag.card} />
        </div>
      )}
      {/* Where the card will go when it's let go — drawn over the ghost, which
          on touch sits right on the drop point */}
      {drag && (
        <div ref={markerRef} style={{
          position: 'fixed', left: 0, top: 0, width: 4, display: 'none',
          borderRadius: 2, background: GOLD, pointerEvents: 'none', zIndex: 10000,
          boxShadow: `0 0 10px ${GOLD}, 0 0 3px #fff`,
        }} />
      )}
    </div>
  );
}

export {
  CardView, GroupView, RulesModal, ReleaseNotes, Setup,
  Leaderboard, BoardReveal, ScoreModal, LeaveConfirm,
  RoundEnd, GameEnd, Game,
};
