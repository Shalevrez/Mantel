// ═══════════════════════════════════════════════════════
// ANIMATION — cards in flight, the "your turn" banner, confetti
// Everything here is decoration on top of a state that has already changed:
// the game never waits for an animation, and with the system's "reduce
// motion" setting on, none of it runs.
// ═══════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef } from "react";

export function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// One card flying from one screen box to another. `f` is
// { from, to, front, back?, flip?, endScale?, endRotate?, duration? }: `front`
// and `back` are the card's two faces as React nodes; with `flip` it leaves
// face down and turns over on the way (a card drawn from the deck).
export function Flyer({ f, onDone }) {
  const ref = useRef(null);
  const inner = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = centre(f.from), b = centre(f.to);
    const dx = b.x - a.x, dy = b.y - a.y;
    // A little arc: the card lifts on its way, like a hand tossing it.
    const lift = Math.min(60, 18 + Math.hypot(dx, dy) * 0.08);
    const s = f.endScale ?? 1, r = f.endRotate ?? 0;
    const dur = f.duration ?? 340;
    const move = el.animate([
      { transform: 'translate(0px, 0px) rotate(0deg) scale(1)' },
      { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) rotate(${r / 2}deg) scale(${(1 + s) / 2 + 0.06})`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${r}deg) scale(${s})` },
    ], { duration: dur, easing: 'cubic-bezier(.3,.7,.25,1)', fill: 'forwards' });
    if (f.flip && inner.current) {
      inner.current.animate(
        [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
        { duration: dur * 0.8, delay: dur * 0.1, easing: 'ease-in-out', fill: 'forwards' });
    }
    move.onfinish = onDone;
    return () => { move.onfinish = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} style={{
      position: 'fixed', zIndex: 9000, pointerEvents: 'none',
      left: f.from.left + f.from.width / 2, top: f.from.top + f.from.height / 2,
      width: 0, height: 0, willChange: 'transform',
    }}>
      <div style={{ position: 'absolute', transform: 'translate(-50%, -50%)', perspective: 600,
                    filter: 'drop-shadow(0 12px 14px rgba(0,0,0,.45))' }}>
        {f.flip ? (
          <div ref={inner} style={{ position: 'relative', transformStyle: 'preserve-3d' }}>
            <div style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>{f.back}</div>
            <div style={{ position: 'absolute', inset: 0, transform: 'rotateY(180deg)',
                          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>{f.front}</div>
          </div>
        ) : f.front}
      </div>
    </div>
  );
}

// "Your turn!" — a gold ribbon across the table for a moment. Click-through.
export function TurnBanner({ onDone, text = 'תורך!' }) {
  useEffect(() => { const t = setTimeout(onDone, 1250); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="turn-banner" aria-live="polite">
      <span>{text}</span>
    </div>
  );
}

// Confetti over the whole screen, for a win. A small canvas of its own —
// ~160 paper squares in the table's colours falling under gravity — gone
// after a few seconds. `burst` restarts it.
export function Confetti({ burst = 0, pieces = 160, duration = 3600 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reducedMotion()) return;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.width = window.innerWidth * dpr;
    const H = cv.height = window.innerHeight * dpr;
    const colours = ['#e0b252', '#f3d48c', '#c1121f', '#fdf8f0', '#2d5390', '#16a34a', '#db2777'];
    const ps = Array.from({ length: pieces }, (_, i) => {
      // Two cannons, one from each lower corner, aimed up and inward.
      const left = i % 2 === 0;
      const ang = (left ? -60 : -120) * Math.PI / 180 + (Math.random() - .5) * 0.9;
      const sp = (9 + Math.random() * 9) * dpr;
      return {
        x: left ? W * 0.08 : W * 0.92, y: H * 0.95,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
        rot: Math.random() * 6, vr: (Math.random() - .5) * 0.35,
        c: colours[i % colours.length], wob: Math.random() * 6,
      };
    });
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const el = t - t0;
      ctx.clearRect(0, 0, W, H);
      const fade = Math.max(0, Math.min(1, (duration - el) / 600));
      for (const p of ps) {
        p.vy += 0.32 * dpr; p.vx *= 0.99; p.vy *= 0.99;
        p.x += p.vx + Math.sin((el / 180) + p.wob) * 0.8 * dpr; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        // The flutter: a piece of paper turning shows its thin edge.
        ctx.scale(1, Math.abs(Math.cos(el / 140 + p.wob)));
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (el < duration) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burst, pieces, duration]);
  return (
    <canvas ref={ref} aria-hidden="true" style={{
      position: 'fixed', inset: 0, width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: 9500,
    }} />
  );
}
