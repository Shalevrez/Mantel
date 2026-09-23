// ═══════════════════════════════════════════════════════
// ICONS — the app's own vector marks
// Emoji look different on every phone (and some old ones draw a
// box instead), so the game draws its icons itself: thin-line SVGs
// on a 24×24 grid that take their colour from the surrounding text
// and their size from the font, like a letter would.
// The home screen and the release notes keep their emoji on purpose.
// ═══════════════════════════════════════════════════════

import { Fragment } from 'react';

// Each icon is a list of SVG children, all stroked with currentColor.
const P = (d) => <path d={d} />;
const C = (cx, cy, r, fill) => <circle cx={cx} cy={cy} r={r} fill={fill ? 'currentColor' : undefined} />;

const ICONS = {
  x:          [P('M18 6 6 18'), P('M6 6l12 12')],
  check:      [P('M20 6 9 17l-5-5')],
  plus:       [P('M12 5v14'), P('M5 12h14')],
  arrowRight: [P('M5 12h14'), P('M12 5l7 7-7 7')],
  arrowLeft:  [P('M19 12H5'), P('M12 19l-7-7 7-7')],
  arrowDown:  [P('M12 5v14'), P('M19 12l-7 7-7-7')],
  arrowUp:    [P('M12 19V5'), P('M5 12l7-7 7 7')],
  chevronDown:[P('M6 9l6 6 6-6')],
  // A small fanned pair of cards — the game itself.
  cards:      [<rect x="8" y="3" width="12" height="16" rx="2" />, P('M4.5 7.5v11a2.5 2.5 0 0 0 2.5 2.5h8.5')],
  logOut:     [P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), P('M16 17l5-5-5-5'), P('M21 12H9')],
  sparkles:   [P('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'), P('M19 3v4'), P('M17 5h4')],
  bot:        [<rect x="4" y="8" width="16" height="12" rx="2" />, P('M12 8V4H8'), P('M2 14h2'), P('M20 14h2'), P('M15 13v2'), P('M9 13v2')],
  book:       [P('M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z'), P('M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z')],
  link:       [P('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'), P('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')],
  dot:        [C(12, 12, 5, true)],
  ring:       [C(12, 12, 5)],
  crown:      [P('M3 7l4.5 5L12 5l4.5 7L21 7l-2 11H5z'), P('M5 21h14')],
  chair:      [P('M8 13V4h8v9'), P('M5 13h14'), P('M6 13v8'), P('M18 13v8'), P('M6 17h12')],
  play:       [P('M7 4l13 8-13 8z')],
  hourglass:  [P('M5 22h14'), P('M5 2h14'), P('M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22'), P('M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2')],
  flag:       [P('M4 22V3'), P('M4 4h14l-3 4.5 3 4.5H4')],
  moon:       [P('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z')],
  home:       [P('M3 11l9-8 9 8'), P('M5 9.5V21h14V9.5'), P('M10 21v-6h4v6')],
  refresh:    [P('M21 12a9 9 0 1 1-2.64-6.36L21 8'), P('M21 3v5h-5')],
  trophy:     [P('M8 21h8'), P('M12 17v4'), P('M7 4h10v5a5 5 0 0 1-10 0z'), P('M17 5h3v2a3 3 0 0 1-3 3'), P('M7 5H4v2a3 3 0 0 0 3 3')],
  target:     [C(12, 12, 9.5), C(12, 12, 5.5), C(12, 12, 1.5, true)],
  pin:        [P('M12 17v5'), P('M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z')],
  hand:       [P('M18 11V6a2 2 0 0 0-4 0v5'), P('M14 10V4a2 2 0 0 0-4 0v6'), P('M10 10.5V6a2 2 0 0 0-4 0v8'), P('M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15')],
  undo:       [P('M9 14 4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  star:       [P('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z')],
  clipboard:  [<rect x="8" y="2" width="8" height="4" rx="1" />, P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'), P('M8 12h8'), P('M8 16h5')],
  sort:       [P('M3 6h11'), P('M3 12h8'), P('M3 18h5'), P('M18 5v15'), P('M15 17l3 3 3-3')],
  coins:      [C(8, 8, 6), P('M18.09 10.37A6 6 0 1 1 10.34 18'), P('M7 6h1v4'), P('M16.71 13.88l.7.71-2.82 2.82')],
  draw:       [P('M12 15V3'), P('M7 8l5-5 5 5'), P('M5 21h14')],
  layDown:    [P('M12 3v12'), P('M7 10l5 5 5-5'), P('M5 21h14')],
  hash:       [P('M4 9h16'), P('M4 15h16'), P('M10 3 8 21'), P('M16 3l-2 18')],
  grid:       [<rect x="3" y="3" width="7" height="7" rx="1.5" />, <rect x="14" y="3" width="7" height="7" rx="1.5" />, <rect x="3" y="14" width="7" height="7" rx="1.5" />, <rect x="14" y="14" width="7" height="7" rx="1.5" />],
  cart:       [C(8, 21, 1), C(19, 21, 1), P('M2 2h3l2.7 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L22 7H6')],
  alert:      [P('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'), P('M12 9v4'), P('M12 17h.01')],
  user:       [C(12, 8, 4), P('M4 21a8 8 0 0 1 16 0')],
  users:      [C(9, 8, 4), P('M1.5 21a7.5 7.5 0 0 1 15 0'), P('M16 4.1a4 4 0 0 1 0 7.8'), P('M22.5 21a7.5 7.5 0 0 0-4.5-6.9')],
  smile:      [C(12, 12, 10), P('M8 14s1.5 2 4 2 4-2 4-2'), P('M9 9h.01'), P('M15 9h.01')],
  flame:      [P('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z')],
  package:    [P('M21 8l-9-5-9 5v8l9 5 9-5z'), P('M3 8l9 5 9-5'), P('M12 13v8')],
  gift:       [<rect x="3" y="8" width="18" height="4" rx="1" />, P('M12 8v13'), P('M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7'), P('M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5')],
  ban:        [C(12, 12, 10), P('M4.9 4.9l14.2 14.2')],
  xCircle:    [C(12, 12, 10), P('M15 9l-6 6'), P('M9 9l6 6')],
  checkCircle:[C(12, 12, 10), P('M8 12l3 3 5-6')],
  trash:      [P('M3 6h18'), P('M8 6V4h8v2'), P('M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6')],
};

// One icon. `size` defaults to the text size around it; `color` to its colour.
export function Icon({ name, size = '1.05em', color, strokeWidth = 2.2, style, title }) {
  const parts = ICONS[name];
  if (!parts) return null;
  return (
    // Sized through CSS rather than the width/height attributes, which reject
    // the calc() lengths the card-relative sizes on the table are written in.
    <svg viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
         role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
         style={{ display: 'inline-block', verticalAlign: '-0.16em', flexShrink: 0,
                  width: size, height: size, color, ...style }}>
      {parts.map((el, i) => <Fragment key={i}>{el}</Fragment>)}
    </svg>
  );
}

// Icon followed by its label, with a little space that survives right-to-left.
export function IconLabel({ name, children, gap = '.3em', ...rest }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <Icon name={name} {...rest} />{children}
    </span>
  );
}

// Place medals: gold, silver and bronze discs for the podium, a plain ring
// with the number after that.
const MEDALS = ['#d4a017', '#9ca3af', '#b87333'];
export function RankBadge({ rank, size = '1.25em' }) {
  const fill = MEDALS[rank];
  return (
    <svg viewBox="0 0 24 24" aria-label={`מקום ${rank + 1}`}
         style={{ display: 'inline-block', verticalAlign: '-0.28em', flexShrink: 0, width: size, height: size }}>
      <circle cx="12" cy="12" r="10" fill={fill || 'none'} stroke={fill ? 'none' : '#a8a29e'} strokeWidth="2" />
      <text x="12" y="16.3" textAnchor="middle" fontSize="12.5" fontWeight="700"
            fill={fill ? '#fff' : '#78716c'} style={{ fontFamily: 'inherit' }}>{rank + 1}</text>
    </svg>
  );
}

// ── Emoji inside text that comes from the game engine ──
// Status messages are plain strings written by game-core (the server sends
// them as they are), and some labels are built as strings too, so their emoji
// are swapped for icons at render time.
const TEXT_ICONS = [
  // Emoji with a variation selector first, so the pair goes as one.
  ['↩️', 'undo'], ['↩', 'undo'], ['⚠️', 'alert'], ['⚠', 'alert'],
  ['⬇️', 'layDown'], ['⬇', 'layDown'], ['🗑️', 'trash'], ['🗑', 'trash'],
  ['✓', 'check'], ['✅', 'checkCircle'], ['❌', 'xCircle'], ['✕', 'x'],
  ['🚫', 'ban'], ['🏠', 'home'], ['🃏', 'cards'], ['📦', 'package'],
  ['💰', 'coins'], ['🚪', 'logOut'], ['🎁', 'gift'], ['⏳', 'hourglass'],
  ['🤖', 'bot'], ['📤', 'draw'], ['🎯', 'target'], ['📌', 'pin'],
  ['📋', 'clipboard'], ['🏆', 'trophy'], ['🔢', 'hash'], ['🧩', 'grid'],
  ['🔄', 'refresh'], ['🛒', 'cart'], ['🏁', 'flag'], ['✋', 'hand'],
  ['🔀', 'sort'], ['⭐', 'star'], ['📖', 'book'], ['🆕', 'sparkles'],
  ['🎮', 'play'], ['😊', 'smile'], ['🔥', 'flame'], ['👤', 'user'],
  ['👥', 'users'], ['→', 'arrowRight'], ['↓', 'arrowDown'], ['↑', 'arrowUp'],
];
const TEXT_RE = new RegExp(`(${TEXT_ICONS.map(([e]) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'u');
const TEXT_MAP = Object.fromEntries(TEXT_ICONS);

export function IconText({ text }) {
  if (!text) return null;
  const parts = String(text).split(TEXT_RE);
  if (parts.length === 1) return text;
  return parts.map((p, i) => {
    if (i % 2 === 0) return p;
    return <Icon key={i} name={TEXT_MAP[p]} />;
  });
}
