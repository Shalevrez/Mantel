// ═══════════════════════════════════════════════════════
// WELCOME & TUTORIAL — the first thing a new player sees
// A new profile opens on a welcome page, then a short walk
// through the game, one idea per page, drawn with the game's own
// cards. It ends at the door of a practice table. The same walk
// opens later from the home screen ("איך משחקים"), without the
// welcome page.
// ═══════════════════════════════════════════════════════

import { useState } from "react";
import { FELT, FELTD, GOLD, CREAM, isSeq, isSet } from "../game-core.js";
import { START_COINS } from "../economy.js";
import { CardView } from "./ui.jsx";
import { Icon, IconLabel } from "./icons.jsx";

// A card for the pictures: 'h7' is 7♥, 'sK' K♠, 'jk' the joker.
const FACE = { A: 1, J: 11, Q: 12, K: 13 };
let cardSeq = 0;
function c(code) {
  if (code === 'jk') return { id: `t${cardSeq++}`, suit: 'j', v: 0, j: true };
  const v = FACE[code.slice(1)] || Number(code.slice(1));
  return { id: `t${cardSeq++}`, suit: code[0], v };
}
const cards = (s) => s.split(' ').map(c);

// The pictures, dealt once so a page keeps the same cards between renders.
const HERO = cards('sA hK dQ cJ jk');
const VALUES = cards('h7 sK jk');
const RUN = cards('h5 h6 h7 h8');
const SET = cards('h8 c8 s8');
const JOKER = cards('s4 jk s6');
const BUY = [c('dQ'), { id: 'tback', back: true }];

// A row of cards, with an optional caption under it. `labels` puts a line
// under each card instead — the cards run left to right, so a caption
// written as one Hebrew line would list them in the opposite order.
function Row({ list, caption, labels, sm }) {
  return (
    <div style={{ textAlign: 'center', margin: '8px 0 12px' }}>
      <div style={{ display: 'inline-flex', direction: 'ltr', gap: labels ? 10 : 0 }}>
        {list.map((card, k) => (
          <div key={card.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CardView card={card} back={card.back} sm={sm} />
            {labels && <div style={{ color: '#78716c', fontSize: 12, marginTop: 5, direction: 'rtl' }}>{labels[k]}</div>}
          </div>
        ))}
      </div>
      {caption && <div style={{ color: '#78716c', fontSize: 12, marginTop: 5 }}>{caption}</div>}
    </div>
  );
}

function P({ children }) {
  return <p style={{ color: '#44403c', fontSize: 14, lineHeight: 1.7, margin: '0 0 10px' }}>{children}</p>;
}

// A numbered line, for the steps of a turn.
function Step({ n, icon, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
      <span style={{
        flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: FELT, color: GOLD,
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      }}>
        <Icon name={icon} size={18} />
        <span style={{
          position: 'absolute', top: -5, right: -5, width: 17, height: 17, borderRadius: '50%',
          background: GOLD, color: FELTD, fontSize: 11, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{n}</span>
      </span>
      <div>
        <div style={{ fontWeight: 700, color: FELTD, fontSize: 14.5 }}>{title}</div>
        <div style={{ color: '#57534e', fontSize: 13, lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}

function Tip({ children }) {
  return (
    <div style={{
      background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
      padding: '8px 11px', color: '#92400e', fontSize: 12.5, lineHeight: 1.6, marginTop: 4,
    }}>{children}</div>
  );
}

// ── The exercise: pick a group out of a hand ─────────
// The hand hides one run (9♦ 10♦ J♦) and one set (3♣ 3♥ 3♠); any valid
// group of three or more counts. The verdict says what's wrong, in the
// same words the rules use.
const PRACTICE_HAND = cards('d9 c3 sK d10 h3 h7 dJ s3');

function verdict(sel) {
  if (sel.length === 0) return null;
  if (sel.length < 3) return { ok: false, text: `נבחרו ${sel.length} — קבוצה צריכה לפחות 3 קלפים` };
  if (isSeq(sel)) return { ok: 'seq', text: 'רצף! קלפים עוקבים מאותה צורה' };
  if (isSet(sel)) return { ok: 'set', text: 'סדרה! אותו ערך בצורות שונות' };
  const suits = new Set(sel.map(x => x.suit));
  const vals = new Set(sel.map(x => x.v));
  if (vals.size === 1) return { ok: false, text: 'בסדרה כל קלף צריך להיות מצורה אחרת' };
  if (suits.size === 1) return { ok: false, text: 'אותה צורה — אבל הערכים לא עוקבים' };
  return { ok: false, text: 'זו לא קבוצה: לא אותה צורה ברצף, ולא אותו ערך' };
}

function PickGroup({ onSolved }) {
  const [picked, setPicked] = useState([]);
  const sel = PRACTICE_HAND.filter(x => picked.includes(x.id));
  const v = verdict(sel);
  const toggle = (id) => {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
    setPicked(next);
    const r = verdict(PRACTICE_HAND.filter(x => next.includes(x.id)));
    if (r && r.ok) onSolved(r.ok);
  };
  return (
    <>
      <div style={{
        display: 'flex', justifyContent: 'center', flexWrap: 'wrap', rowGap: 14,
        direction: 'ltr', padding: '18px 4px 8px', borderRadius: 14, marginBottom: 10,
      }} className="felt">
        {PRACTICE_HAND.map(card => (
          <CardView key={card.id} card={card} sel={picked.includes(card.id)} onClick={() => toggle(card.id)} />
        ))}
      </div>
      <div aria-live="polite" style={{
        minHeight: 38, borderRadius: 10, padding: '8px 11px', fontSize: 13.5, fontWeight: 700,
        display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', textAlign: 'center',
        ...(v == null ? { color: '#a8a29e', border: '1px dashed #d6d3d1' }
          : v.ok ? { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }
          : { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }),
      }}>
        {v == null ? 'לחצו על קלפים כדי לבחור אותם'
          : <><Icon name={v.ok ? 'checkCircle' : 'xCircle'} /> {v.text}</>}
      </div>
    </>
  );
}

// ── The pages ────────────────────────────────────────
// Each: { key, icon, title(ctx), body(ctx) }. ctx carries the player's name
// and the groups the exercise has found.
const PAGES = [
  {
    key: 'welcome', icon: 'sparkles', welcomeOnly: true,
    title: (ctx) => `ברוכים הבאים, ${ctx.name}!`,
    body: () => (
      <>
        <Row list={HERO} />
        <P>
          <b>מנטל</b> הוא משחק קלפים לשניים עד שישה שחקנים: אוספים ביד קבוצות של קלפים,
          מורידים אותן לשולחן, ומנסים להיפטר מכל היד לפני כולם.
        </P>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
          background: `${FELT}0f`, border: `1.5px solid ${GOLD}66`, marginBottom: 10,
        }}>
          <Icon name="gift" size={26} color={GOLD} />
          <div style={{ fontSize: 13.5, color: FELTD, lineHeight: 1.5 }}>
            מתנת פתיחה: <b style={{ direction: 'ltr', display: 'inline-block' }}>{START_COINS.toLocaleString('en-US')}</b> מטבעות
            לחדרים עם דמי כניסה.
          </div>
        </div>
        <P>רוצים הדרכה קצרה? שתי דקות, ואתם ליד השולחן.</P>
      </>
    ),
  },
  {
    key: 'goal', icon: 'target', title: () => 'מטרת המשחק',
    body: () => (
      <>
        <P>
          משחק שלם הוא <b>6 משחקונים</b>. בכל משחקון מנסים להוריד את כל הקלפים מהיד.
          מה שנשאר ביד בסוף המשחקון — נספר לחובתכם.
        </P>
        <Row list={VALUES} labels={['7 נקודות', '10 נקודות', '10 נקודות']} />
        <P>
          קלפים 2–10 שווים את הערך שלהם; אס, נסיך, מלכה, מלך וג׳וקר — 10 כל אחד.
          <b> בסוף ששת המשחקונים מנצח מי שצבר הכי מעט נקודות.</b>
        </P>
      </>
    ),
  },
  {
    key: 'groups', icon: 'grid', title: () => 'קבוצות: רצף וסדרה',
    body: () => (
      <>
        <P><b>רצף</b> — 3 קלפים או יותר, עוקבים, מאותה צורה:</P>
        <Row list={RUN} />
        <P><b>סדרה</b> — 3 או 4 קלפים מאותו ערך, כל אחד מצורה אחרת:</P>
        <Row list={SET} />
        <P><b>הג׳וקר</b> מחליף כל קלף שחסר:</P>
        <Row list={JOKER} caption="הג׳וקר משמש כאן כ־5♠" />
      </>
    ),
  },
  {
    key: 'try', icon: 'hand', title: () => 'נסו בעצמכם',
    body: (ctx) => (
      <>
        <P>ביד הזו מסתתרות שתי קבוצות. בחרו קלפים שיוצרים רצף או סדרה:</P>
        <PickGroup onSolved={ctx.onSolved} />
        {ctx.found.length > 0 && (
          <div style={{ textAlign: 'center', color: '#15803d', fontSize: 12.5, marginTop: 8 }}>
            {ctx.found.length === 1
              ? 'מצוין! יש כאן עוד קבוצה אחת — מוצאים אותה?'
              : 'מצאתם את שתיהן — רצף וסדרה. אתם מוכנים להמשיך!'}
          </div>
        )}
      </>
    ),
  },
  {
    key: 'open', icon: 'layDown', title: () => 'דרישת הפתיחה',
    body: () => (
      <>
        <P>
          לכל משחקון יש דרישה: בפעם הראשונה שמורידים קלפים לשולחן צריך להוריד <b>רצפים</b> באורך שהוא דורש.
          זה נקרא "להיפתח".
        </P>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
          {['שלישייה', 'שתי שלישיות', 'רביעייה', 'שתי רביעיות', 'חמישייה', 'שתי חמישיות'].map((n, i) => (
            <div key={n} style={{
              textAlign: 'center', padding: '7px 4px', borderRadius: 10,
              background: '#fff', border: '1.5px solid #e7e5e4',
            }}>
              <div style={{ fontSize: 11, color: '#a8a29e' }}>משחקון {i + 1}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: FELTD }}>{n}</div>
            </div>
          ))}
        </div>
        <P>
          למשל ב"רביעייה" צריך להוריד רצף אחד של 4 קלפים לפחות. <b>אחרי שנפתחתם</b> אפשר להוריד
          עוד קבוצות מכל סוג, ולהצמיד קלפים לקבוצות שכבר על השולחן — גם של שחקנים אחרים.
        </P>
      </>
    ),
  },
  {
    key: 'turn', icon: 'refresh', title: () => 'מהלך תור',
    body: () => (
      <>
        <Step n={1} icon="draw" title="שולפים קלף">
          מהחבילה, או את הקלף העליון באשפה.
        </Step>
        <Step n={2} icon="layDown" title="מורידים ומצמידים (לא חובה)">
          בוחרים קלפים ביד ומורידים קבוצה, או גוררים קלף אל קבוצה על השולחן.
        </Step>
        <Step n={3} icon="trash" title="זורקים קלף">
          כל תור נגמר בזריקת קלף אחד לאשפה — והתור עובר לשחקן הבא, עם כיוון השעון.
        </Step>
        <Tip>
          <Icon name="star" /> כשמגיע התור שלכם מופיע על המסך "תורך!", והכפתורים שאפשר ללחוץ עליהם זוהרים.
        </Tip>
      </>
    ),
  },
  {
    key: 'buy', icon: 'cart', title: () => 'קנייה מהאשפה',
    body: () => (
      <>
        <P>
          כשמישהו זורק קלף, <b>השחקן הבא</b> יכול לקחת אותו בחינם. אם הוא מוותר, שאר השחקנים
          יכולים <b>לקנות</b> אותו — ומקבלים יחד איתו קלף עונשין מהחבילה.
        </P>
        <Row list={BUY} caption="הקלף מהאשפה + קלף עונשין" />
        <P>
          קנייה היא הימור: הקלף עוזר לבנות קבוצה, אבל מוסיף ליד קלף שעוד צריך להיפטר ממנו.
        </P>
      </>
    ),
  },
  {
    key: 'out', icon: 'trophy', title: () => 'סיום משחקון, ואנט',
    body: () => (
      <>
        <P>
          מסיימים משחקון כשמורידים את כל הקלפים <b>חוץ מאחד</b> — וזורקים אותו לאשפה.
          מי שיצא מקבל 0, וכל השאר סופרים את מה שנשאר להם ביד.
        </P>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
          background: '#f0fdf4', border: '1.5px solid #bbf7d0', marginBottom: 10,
        }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#15803d', direction: 'ltr' }}>−50</span>
          <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.55 }}>
            <b>אנט:</b> מורידים את כל היד בקבוצות חדשות משלכם <b>בתור אחד</b>, בלי להצמיד לקבוצות של אחרים.
          </div>
        </div>
        <Tip>
          <Icon name="alert" /> כשנשאר לכם קלף אחד ביד, מותר רק לשלוף מהחבילה — לא לקחת מהאשפה ולא לקנות.
        </Tip>
      </>
    ),
  },
  {
    key: 'ready', icon: 'play', title: () => 'מוכנים לשחק?',
    body: () => (
      <>
        <P>כמה דברים שכדאי לדעת ליד השולחן:</P>
        <Step n={1} icon="sort" title="מסדרים את היד">
          גוררים קלף למקום אחר, או לוחצים "מיין". אפשר גם כשזה לא התור שלכם.
        </Step>
        <Step n={2} icon="book" title="החוקים המלאים">
          לקיחת ג׳וקר מהשולחן, קלף הבית ועוד — בכפתור "חוקים" במסך הבית ובתוך המשחק.
        </Step>
        <Step n={3} icon="bot" title="מתחילים באימון">
          משחק אימון הוא מול המחשב, בלי מטבעות ובלי לחץ — המקום הכי טוב ללמוד.
        </Step>
      </>
    ),
  },
];

export function Tutorial({ name, welcome, onClose, onPractice }) {
  const pages = welcome ? PAGES : PAGES.filter(p => !p.welcomeOnly);
  const [i, setI] = useState(0);
  // Which kinds of group the exercise has found so far: 'seq', 'set'.
  const [found, setFound] = useState([]);
  const page = pages[i];
  const last = i === pages.length - 1;
  const ctx = {
    name: name || 'שחקן', found,
    onSolved: (kind) => setFound(f => f.includes(kind) ? f : [...f, kind]),
  };
  const next = () => setI(n => Math.min(n + 1, pages.length - 1));
  const back = () => setI(n => Math.max(n - 1, 0));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: 14,
    }}>
      <div role="dialog" aria-modal="true" aria-label="הדרכה" className="rules-card" style={{
        background: CREAM, borderRadius: 20, maxWidth: 440, width: '100%',
        display: 'flex', flexDirection: 'column',
        border: `2px solid ${GOLD}88`, boxShadow: '0 24px 72px rgba(0,0,0,.6)',
        overflow: 'hidden',
      }}>
        {/* Header: the page's name, where we are, and a way out */}
        <div style={{
          background: FELT, padding: '14px 18px', display: 'flex', gap: 10,
          alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ color: GOLD, fontSize: 19, fontWeight: 700, minWidth: 0 }}>
            <IconLabel name={page.icon}>{page.title(ctx)}</IconLabel>
          </span>
          <button onClick={onClose} title="דלג על ההדרכה" style={{
            background: 'rgba(255,255,255,.15)', color: CREAM, border: 'none', flexShrink: 0,
            borderRadius: 8, padding: '0 10px', height: 30, fontSize: 13, cursor: 'pointer',
            fontWeight: 700, fontFamily: 'inherit',
          }}>דלג</button>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '12px 0 0' }}>
          {pages.map((p, k) => (
            <button key={p.key} onClick={() => setI(k)} aria-label={`עמוד ${k + 1}`} style={{
              width: k === i ? 22 : 8, height: 8, borderRadius: 99, border: 'none', padding: 0,
              cursor: 'pointer', transition: 'width .15s',
              background: k === i ? GOLD : k < i ? `${FELT}88` : '#e7e5e4',
            }} />
          ))}
        </div>

        {/* Body */}
        <div key={page.key} style={{ padding: '14px 20px 16px', overflowY: 'auto' }}>
          {page.body(ctx)}
        </div>

        {/* Footer */}
        <div style={{ padding: 14, flexShrink: 0, borderTop: '1px solid #e7e5e4' }}>
          {last ? (
            <>
              <button onClick={onPractice} style={primary}>
                <IconLabel name="bot">משחק אימון מול המחשב</IconLabel>
              </button>
              <button onClick={onClose} style={{ ...ghost, width: '100%', marginTop: 8 }}>
                למסך הבית
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {i > 0 && (
                <button onClick={back} style={ghost} title="הקודם">
                  <Icon name="arrowRight" size={18} />
                </button>
              )}
              <button onClick={next} style={{ ...primary, flex: 1 }}>
                {page.welcomeOnly ? 'הראו לי איך משחקים' : 'הבא'}
                {' '}<Icon name="arrowLeft" size={16} />
              </button>
            </div>
          )}
          {page.welcomeOnly && (
            <button onClick={onClose} style={{ ...ghost, width: '100%', marginTop: 8, border: 'none' }}>
              אני כבר יודע לשחק — דלג
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const primary = {
  width: '100%', padding: '12px 0', background: FELT, color: GOLD,
  border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const ghost = {
  padding: '10px 14px', background: 'transparent', color: FELT,
  border: `2px solid ${FELT}33`, borderRadius: 12, fontSize: 14, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
