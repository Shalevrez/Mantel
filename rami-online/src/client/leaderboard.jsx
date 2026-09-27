// ═══════════════════════════════════════════════════════
// LEADERBOARD — opens over the screen like the store: the same
// stall, with a tab per table at the bottom (local, global, weekly,
// daily). The numbers come from the demo profile in profile.js.
// ═══════════════════════════════════════════════════════

import { useState } from "react";
import { GOLD, GOLDD } from "../game-core.js";
import { levelInfo } from "../economy.js";
import { Icon } from "./icons.jsx";
import { CARD, MUTED } from "./account.jsx";
import { Stall } from "./store.jsx";
import * as P from "./profile.js";

const TABS = [
  { key: 'local',  icon: 'home',     label: 'מקומי',
    note: 'הפרופילים שנכנסו מהדפדפן הזה, לפי גביעים.' },
  { key: 'global', icon: 'globe',    label: 'עולמי',
    note: 'כל הזמנים, לפי גביעים. לצד הפרופילים שלכם — יריבים לדוגמה.' },
  { key: 'weekly', icon: 'calendar', label: 'שבועי',
    note: 'גביעים שנצברו השבוע (מיום ראשון). מתאפס בתחילת כל שבוע.' },
  { key: 'daily',  icon: 'sun',      label: 'יומי',
    note: 'גביעים שנצברו היום. מתאפס בחצות.' },
];

export function LeaderboardStall({ onClose }) {
  const [tab, setTab] = useState('global');
  return (
    <Stall title="דירוג" icon="trophy" onClose={onClose} tabs={TABS} tab={tab} setTab={setTab}>
      <Board scope={tab} />
    </Stall>
  );
}

function Board({ scope }) {
  const rows = P.leaderboard(scope);
  const t = TABS.find(x => x.key === scope);
  const periodic = scope === 'daily' || scope === 'weekly';
  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Icon name={t.icon} size={36} color={GOLDD} strokeWidth={1.6} />
        <h2 style={{ margin: '4px 0', fontSize: 22 }}>דירוג {t.label}</h2>
        <div style={{ color: MUTED, fontSize: 12.5 }}>{t.note}</div>
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
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name}
            {r.you && <span style={{ color: GOLDD, fontWeight: 400 }}> (את/ה)</span>}
            {r.rival && <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}> · לדוגמה</span>}
          </span>
          <span style={{ color: MUTED, fontSize: 12, whiteSpace: 'nowrap' }}>רמה {levelInfo(r.xp).level}</span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, minWidth: 56,
            justifyContent: 'flex-end', direction: 'ltr', fontVariantNumeric: 'tabular-nums',
          }}>
            <Icon name="trophy" color={GOLD} size={15} />
            {periodic && r.trophies > 0 ? `+${r.trophies}` : r.trophies}
          </span>
        </div>
      ))}
    </div>
  );
}
