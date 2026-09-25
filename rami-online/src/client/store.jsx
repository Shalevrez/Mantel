// ═══════════════════════════════════════════════════════
// STORE — coin packs and the rewarded video (DEMO)
// Nothing is charged and no ad network is called: a "purchase" is
// a confirm dialog, and the "video" is a 15-second countdown. The
// coins land in the demo wallet (profile.js).
// ═══════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { GOLD, FELTD, CREAM } from "../game-core.js";
import { STORE_PACKS, AD_REWARD, AD_SECONDS, AD_DAILY } from "../economy.js";
import { Icon, IconLabel } from "./icons.jsx";
import { LINE, SOFT, MUTED, hubBtn, Modal, DemoTag } from "./account.jsx";
import * as P from "./profile.js";

export function StoreScreen() {
  const [confirm, setConfirm] = useState(null); // the pack being "bought"
  const [watching, setWatching] = useState(false);
  const [toast, setToast] = useState('');
  const left = P.adsLeft();

  function flash(text) {
    setToast(text);
    setTimeout(() => setToast(''), 2600);
  }

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <DemoTag />
        <div style={{ color: MUTED, fontSize: 12.5, marginTop: 6 }}>
          חנות לדוגמה: שום כרטיס לא מחויב, והמטבעות נשמרים בדפדפן הזה בלבד.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        {/* Rewarded video */}
        <Card highlight>
          <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.3 }}>צפו בסרטון<br />וקבלו מטבעות!</div>
          <Amount coins={AD_REWARD} />
          <Icon name="gift" size={44} color="#facc15" strokeWidth={1.5} />
          <div style={{ fontSize: 11.5, color: SOFT }}>נשארו היום: {left}/{AD_DAILY}</div>
          <PriceBtn disabled={left <= 0} onClick={() => setWatching(true)}>
            {left > 0 ? <IconLabel name="play">צפה</IconLabel> : 'נגמרו להיום'}
          </PriceBtn>
        </Card>

        {STORE_PACKS.map(p => (
          <Card key={p.id} tag={p.tag}>
            <Amount coins={p.coins} />
            <CoinPile n={p.coins} />
            <PriceBtn onClick={() => setConfirm(p)}>₪{p.price}</PriceBtn>
          </Card>
        ))}
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          padding: '10px 18px', borderRadius: 99, background: '#15803d', color: '#fff',
          fontWeight: 800, boxShadow: '0 8px 24px rgba(0,0,0,.4)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {confirm && (
        <Modal onClose={() => setConfirm(null)} width={340}>
          <div style={{ textAlign: 'center' }}>
            <Icon name="cart" size={40} color={GOLD} strokeWidth={1.7} />
            <h2 style={{ margin: '6px 0 4px', fontSize: 20 }}>תשלום מדומה</h2>
            <div style={{ fontSize: 14, color: SOFT, lineHeight: 1.6, marginBottom: 14 }}>
              {confirm.coins.toLocaleString('en-US')} מטבעות תמורת ₪{confirm.price}.<br />
              <b style={{ color: '#f9a8d4' }}>זו הדגמה — לא יחויב שום כסף.</b>
            </div>
            <button style={{ ...hubBtn, fontSize: 17 }} onClick={() => {
              const got = P.buyPack(confirm.id);
              setConfirm(null);
              if (got) flash(`+${got.toLocaleString('en-US')} מטבעות נוספו!`);
            }}>אישור רכישה (דמו)</button>
          </div>
        </Modal>
      )}

      {watching && (
        <AdPlayer
          onClose={() => setWatching(false)}
          onReward={(got) => { setWatching(false); if (got) flash(`+${got} מטבעות על הצפייה!`); }}
        />
      )}
    </>
  );
}

function Card({ children, tag, highlight }) {
  return (
    <div style={{
      position: 'relative', borderRadius: 18, padding: '26px 12px 16px', minHeight: 250,
      background: highlight ? 'linear-gradient(160deg, #5b2169, #2a1450)' : 'linear-gradient(160deg, #1f4580, #13284f)',
      border: `2px solid ${highlight ? GOLD : 'rgba(96,165,250,.35)'}`,
      boxShadow: '0 10px 28px rgba(0,0,0,.4)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      textAlign: 'center', color: CREAM,
    }}>
      {tag && (
        <div style={{
          position: 'absolute', top: -11, insetInlineStart: 12, padding: '4px 12px', borderRadius: 8,
          background: tag.includes('בונוס') ? '#dc2626' : tag.includes('פופולרי') ? '#2563eb' : '#16a34a',
          color: '#fff', fontSize: 12.5, fontWeight: 800, transform: 'rotate(-4deg)',
          boxShadow: '0 4px 10px rgba(0,0,0,.35)',
        }}>{tag}</div>
      )}
      {children}
    </div>
  );
}

function Amount({ coins }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 26, fontWeight: 800, color: '#fde68a', direction: 'ltr' }}>
      <Icon name="coins" size={24} color="#facc15" />{coins.toLocaleString('en-US')}
    </div>
  );
}

// A heap of coins that grows with the pack.
function CoinPile({ n }) {
  const count = n >= 100000 ? 9 : n >= 40000 ? 7 : n >= 18000 ? 5 : 3;
  return (
    <div style={{ position: 'relative', width: 110, height: 60 }}>
      {Array.from({ length: count }, (_, i) => {
        const row = i < 4 ? 0 : i < 7 ? 1 : 2;
        const inRow = row === 0 ? i : row === 1 ? i - 4 : i - 7;
        const perRow = row === 0 ? Math.min(count, 4) : row === 1 ? Math.min(count - 4, 3) : count - 7;
        const x = 55 + (inRow - (perRow - 1) / 2) * 24 - 14;
        return (
          <div key={i} style={{
            position: 'absolute', left: x, bottom: row * 16, width: 28, height: 28, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #fef08a, #eab308 60%, #a16207)',
            border: '1.5px solid #854d0e', boxShadow: '0 2px 4px rgba(0,0,0,.4)',
          }} />
        );
      })}
    </div>
  );
}

function PriceBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '90%', padding: '10px 0', borderRadius: 99, cursor: disabled ? 'default' : 'pointer',
      background: 'linear-gradient(#1e293b, #0f172a)', color: '#fff', fontWeight: 800, fontSize: 16,
      border: `2px solid ${GOLD}`, opacity: disabled ? 0.5 : 1, direction: 'ltr',
    }}>{children}</button>
  );
}

// ═══════════════════════════════════════════════════════
// AD PLAYER — a pretend rewarded video
// Full screen, can't be skipped for the reward: closing early pays
// nothing. The wallet re-checks the elapsed time (claimAd).
// ═══════════════════════════════════════════════════════

const AD_SCENES = [
  { bg: 'linear-gradient(135deg, #f97316, #db2777)', text: 'המשחק החדש שכולם מדברים עליו' },
  { bg: 'linear-gradient(135deg, #0ea5e9, #6366f1)', text: 'הורידו עכשיו — בחינם!' },
  { bg: 'linear-gradient(135deg, #22c55e, #0d9488)', text: 'פרסומת לדוגמה · מצב הדגמה' },
];

function AdPlayer({ onClose, onReward }) {
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const elapsed = (now - startedAt.current) / 1000;
  const left = Math.max(0, Math.ceil(AD_SECONDS - elapsed));
  const done = left === 0;
  const scene = AD_SCENES[Math.min(AD_SCENES.length - 1, Math.floor(elapsed / (AD_SECONDS / AD_SCENES.length)))];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400, background: scene.bg, color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', transition: 'background .6s', padding: 20, textAlign: 'center',
    }}>
      <div style={{ position: 'absolute', top: 14, insetInlineStart: 14 }}><DemoTag /></div>
      <div style={{
        position: 'absolute', top: 14, insetInlineEnd: 14, padding: '6px 12px', borderRadius: 99,
        background: 'rgba(0,0,0,.35)', fontWeight: 800,
      }}>
        {done ? 'אפשר לסגור' : `הפרס בעוד ${left} שנ׳`}
      </div>
      <Icon name="play" size={70} strokeWidth={1.5} />
      <div style={{ fontSize: 28, fontWeight: 800, margin: '16px 0 6px', textShadow: '0 2px 10px rgba(0,0,0,.35)' }}>{scene.text}</div>
      <div style={{ fontSize: 14, opacity: .85 }}>כאן תופיע פרסומת אמיתית כשתחובר רשת פרסום</div>

      <div style={{ width: 'min(420px, 90%)', height: 8, borderRadius: 4, background: 'rgba(0,0,0,.25)', marginTop: 26, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, 100 * elapsed / AD_SECONDS)}%`, height: '100%', background: '#fff', transition: 'width .2s linear' }} />
      </div>

      <div style={{ marginTop: 26, display: 'flex', gap: 10 }}>
        {done ? (
          <button onClick={() => onReward(P.claimAd(startedAt.current))} style={{
            padding: '12px 26px', borderRadius: 99, border: `2px solid ${GOLD}`, cursor: 'pointer',
            background: FELTD, color: '#fde68a', fontWeight: 800, fontSize: 17,
          }}><IconLabel name="coins">קבל {AD_REWARD} מטבעות</IconLabel></button>
        ) : (
          <button onClick={onClose} style={{
            padding: '10px 20px', borderRadius: 99, border: `1px solid ${LINE}`, cursor: 'pointer',
            background: 'rgba(0,0,0,.3)', color: '#fff', fontWeight: 700, fontSize: 14,
          }}>סגור בלי פרס</button>
        )}
      </div>
    </div>
  );
}
