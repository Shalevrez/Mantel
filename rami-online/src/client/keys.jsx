// ═══════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS — for players with a keyboard and a mouse
// Keys are matched by their physical position (KeyboardEvent.code), not by
// the letter they type, so "D" is the same key with a Hebrew layout on
// (where it types ג). The map lives in this browser's storage and can be
// changed from the settings; phones and tablets never see any of it.
// ═══════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Icon } from "./icons.jsx";

// In the order they're listed in the settings.
export const KEY_ACTIONS = [
  { id: 'draw',    label: 'שליפה מהחבילה' },
  { id: 'lay',     label: 'הורדה' },
  { id: 'attach',  label: 'הצמדה' },
  { id: 'discard', label: 'זריקה' },
  { id: 'undo',    label: 'ביטול הורדה' },
  { id: 'sort',    label: 'מיון היד' },
  { id: 'take',    label: 'לקיחה / קנייה מהאשפה' },
  { id: 'skip',    label: 'ויתור על הקלף' },
];

export const DEFAULT_KEYS = {
  draw: 'Space', lay: 'KeyD', attach: 'KeyA', discard: 'KeyX',
  undo: 'KeyU', sort: 'KeyS', take: 'KeyB', skip: 'KeyN',
};

const STORE = 'mantel.keys';
const EVENT = 'mantel:keys';

export function loadKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULT_KEYS, ...saved };
  } catch { /* storage blocked or garbled — defaults */ }
  return { ...DEFAULT_KEYS };
}

export function saveKeys(map) {
  try { localStorage.setItem(STORE, JSON.stringify(map)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
}

// The current map, kept in step with the settings screen.
export function useKeys() {
  const [keys, setKeys] = useState(loadKeys);
  useEffect(() => {
    const on = () => setKeys(loadKeys());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return keys;
}

// A mouse and a hover: the only case where shortcuts and their hints show.
export function hasMouse() {
  try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; }
  catch { return false; }
}

// "KeyD" → "D", "Digit4" → "4", "Space" → "רווח".
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return {
    Space: 'רווח', Enter: 'Enter', Backspace: '⌫', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  }[code] || code;
}

// Keys that can't be given to a game action.
const RESERVED = new Set(['Escape', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Tab']);

// The small key cap drawn on a button (".kbd" hides itself without a mouse).
export function Kbd({ code }) {
  return <kbd className="kbd">{keyLabel(code)}</kbd>;
}

// The editor: click an action, press a key. A key that already belongs to
// another action moves over (the other one is left without a key, and says so).
export function KeysEditor() {
  const keys = useKeys();
  const [wait, setWait] = useState(null); // action id waiting for a key

  useEffect(() => {
    if (!wait) return;
    const on = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { setWait(null); return; }
      if (RESERVED.has(e.code)) return;
      const next = { ...keys };
      for (const id of Object.keys(next)) if (next[id] === e.code) next[id] = '';
      next[wait] = e.code;
      saveKeys(next);
      setWait(null);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [wait, keys]);

  return (
    <div>
      <div style={{ display: 'grid', gap: 6 }}>
        {KEY_ACTIONS.map(a => (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '6px 10px', borderRadius: 10,
            background: 'rgba(127,127,127,.10)', border: '1px solid rgba(127,127,127,.22)',
          }}>
            <span style={{ fontSize: 14 }}>{a.label}</span>
            <button onClick={() => setWait(w => w === a.id ? null : a.id)} style={{
              minWidth: 74, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              border: `1px solid ${wait === a.id ? '#e0b252' : 'rgba(127,127,127,.45)'}`,
              background: wait === a.id ? 'rgba(224,178,82,.18)' : 'rgba(255,255,255,.08)',
              color: 'inherit',
            }}>
              {wait === a.id ? 'לחצו מקש…' : keys[a.id] ? keyLabel(keys[a.id]) : 'ללא'}
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12, opacity: .75 }}>
        <span>Esc מבטל · Esc במשחק מבטל גרירה והצמדה</span>
        <button onClick={() => { saveKeys({ ...DEFAULT_KEYS }); setWait(null); }} style={{
          background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12, textDecoration: 'underline', padding: 0,
        }}><Icon name="refresh" /> איפוס לברירת המחדל</button>
      </div>
    </div>
  );
}
