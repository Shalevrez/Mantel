// ═══════════════════════════════════════════════════════
// VIBRATION — a buzz on the phone when the game waits on you
// Your turn has begun (to draw), or you're offered the discard (to take it
// free or buy it with a penalty card). On unless the player turns it off in
// the settings; the choice lives in this browser. Browsers without the
// Vibration API (iPhone Safari, desktops) simply do nothing.
// ═══════════════════════════════════════════════════════

const VIB_KEY = 'mantel_vibrate';
let vibOn = (() => {
  try { return localStorage.getItem(VIB_KEY) !== 'off'; } catch { return true; }
})();

export const canVibrate = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export const vibrationOn = () => vibOn;
export function setVibrationOn(on) {
  vibOn = !!on;
  try { localStorage.setItem(VIB_KEY, vibOn ? 'on' : 'off'); } catch { /* storage blocked */ }
}

// Two short pulses. A browser may refuse until the page has had a tap; that's
// fine — it returns false and nothing happens.
export function buzz() {
  if (!vibOn || !canVibrate()) return;
  try { navigator.vibrate([120, 80, 120]); } catch { /* not allowed */ }
}
