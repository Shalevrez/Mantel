// ═══════════════════════════════════════════════════════
// CARD ART — optional drawings for the card faces
// Court figures, the jester and corner ornaments, drawn as small SVGs whose
// colours come from CSS classes. The game's own deck doesn't show them
// (table.css hides .pc-art/.pc-jart/.pc-orn); the alternative decks in the
// design gallery (decks.css, harness.html?screen=decks) switch them on.
// ═══════════════════════════════════════════════════════

// One half of a court figure, in the top half of a 100×140 box: headwear,
// face, shoulders and a held emblem. The bottom half is the same, turned.
function CourtHalf({ v, sym }) {
  const hat = v === 13 ? (
    // King: a five-point crown with jewels.
    <g className="ca-gold">
      <path d="M33 22 L33 10 L40 16 L45 6 L50 15 L55 6 L60 16 L67 10 L67 22 Z" />
      <circle className="ca-jewel" cx="50" cy="18" r="2.2" />
    </g>
  ) : v === 12 ? (
    // Queen: a rounded tiara over long hair.
    <g>
      <path className="ca-hair" d="M36 34 Q34 16 50 14 Q66 16 64 34 L64 46 L36 46 Z" />
      <path className="ca-gold" d="M36 20 Q43 8 50 15 Q57 8 64 20 Q57 17 50 21 Q43 17 36 20 Z" />
      <circle className="ca-jewel" cx="50" cy="13" r="2" />
    </g>
  ) : (
    // Jack: a flat cap with a feather.
    <g>
      <path className="ca-cap" d="M32 22 Q50 8 68 22 L66 25 L34 25 Z" />
      <path className="ca-gold" d="M62 14 Q76 4 80 10 Q70 12 64 20 Z" />
    </g>
  );
  return (
    <g>
      {hat}
      <circle className="ca-skin" cx="50" cy="32" r="10" />
      {/* the eyes and a line of mouth: just enough to read as a face */}
      <circle className="ca-ink-fill" cx="46.5" cy="31" r="1" />
      <circle className="ca-ink-fill" cx="53.5" cy="31" r="1" />
      <path className="ca-ink" d="M47 36 Q50 38 53 36" fill="none" />
      {v === 13 && <path className="ca-hair" d="M42 37 Q50 48 58 37 Q56 44 50 45 Q44 44 42 37 Z" />}
      {/* robe, collar and a trim down the front */}
      <path className="ca-robe" d="M18 70 L26 50 Q50 40 74 50 L82 70 Z" />
      <path className="ca-trim" d="M36 47 Q50 58 64 47 L62 52 Q50 62 38 52 Z" />
      <path className="ca-gold" d="M48 58 L52 58 L52 70 L48 70 Z" />
      <text className="ca-sym" x="34" y="67" textAnchor="middle" fontSize="11">{sym}</text>
    </g>
  );
}

// A court card's picture: two halves, mirrored, split by a diagonal band.
export function CourtArt({ v, sym }) {
  return (
    <svg className="pc-art" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect className="ca-frame" x="2" y="2" width="96" height="136" rx="4" />
      <CourtHalf v={v} sym={sym} />
      <g transform="rotate(180 50 70)"><CourtHalf v={v} sym={sym} /></g>
      <path className="ca-split" d="M4 76 L96 64" />
    </svg>
  );
}

// The joker's picture: a three-pointed jester's cap with bells over a grin.
export function JokerArt() {
  return (
    <svg className="pc-jart" viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="ja-p1" d="M26 66 Q20 34 6 26 Q30 30 40 50 Z" />
      <path className="ja-p2" d="M36 58 Q40 22 50 8 Q60 22 64 58 Z" />
      <path className="ja-p3" d="M74 66 Q80 34 94 26 Q70 30 60 50 Z" />
      <circle className="ja-bell" cx="6" cy="26" r="5" />
      <circle className="ja-bell" cx="50" cy="8" r="5" />
      <circle className="ja-bell" cx="94" cy="26" r="5" />
      <path className="ja-band" d="M24 58 Q50 50 76 58 L76 66 Q50 58 24 66 Z" />
      <circle className="ja-face" cx="50" cy="80" r="15" />
      <path className="ja-ink" d="M41 83 Q50 92 59 83" fill="none" />
      <circle className="ja-ink-fill" cx="44.5" cy="76" r="1.6" />
      <circle className="ja-ink-fill" cx="55.5" cy="76" r="1.6" />
      <path className="ja-collar" d="M26 96 L34 106 L42 97 L50 108 L58 97 L66 106 L74 96 Q50 100 26 96 Z" />
    </svg>
  );
}

// A corner ornament (art-deco fan), placed top-left; CSS turns the others.
export function CornerOrnament({ pos }) {
  return (
    <svg className={`pc-orn ${pos}`} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M1 19 L1 1 L19 1" fill="none" />
      <path d="M1 12 A11 11 0 0 1 12 1" fill="none" />
      <path d="M1 7 A6 6 0 0 1 7 1" fill="none" />
      <path d="M1 1 L8 8" fill="none" />
    </svg>
  );
}

// ── Portraits for the jumbo decks ────────────────────────────────────────
// A court figure as a bust rising from the bottom of a 100×110 box: the king
// crowned and bearded, the queen with a tiara and long hair, the prince
// (jack) young, in a feathered cap. Colours follow the suit: red suits dress
// in red, black suits in black, both trimmed in gold.
function Bust({ v, sym }) {
  const K = v === 13, Q = v === 12, J = v === 11;
  return (
    <g>
      {/* The queen's hair falls behind her shoulders. */}
      {Q && <path className="pt-hair" d="M30 50 Q27 24 50 22 Q73 24 70 50 L76 94 Q63 88 60 72 L40 72 Q37 88 24 94 Z" />}
      {/* Robe and shoulders. */}
      <path className="pt-robe" d="M3 110 C5 90 20 81 34 79 L66 79 C80 81 95 90 97 110 Z" />
      {Q && <path className="pt-skin" d="M38 79 Q50 92 62 79 Z" />}
      {/* The king's ermine collar; the prince's ruff. */}
      {K && <>
        <path className="pt-ermine" d="M24 84 Q50 100 76 84 L80 94 Q50 110 20 94 Z" />
        {[30, 40, 50, 60, 70].map((x, i) => <circle key={i} className="pt-ink-fill" cx={x} cy={x === 50 ? 99 : 94 + Math.abs(50 - x) * -0.12} r="1.3" />)}
      </>}
      {J && <path className="pt-ruff" d="M28 80 L34 88 L40 81 L46 90 L50 82 L54 90 L60 81 L66 88 L72 80 Q50 94 28 80 Z" />}
      {/* Neck, ears, head. */}
      <path className="pt-skin" d="M42 64 L42 80 Q50 85 58 80 L58 64 Z" />
      <ellipse className="pt-skin" cx="33.5" cy="52" rx="3" ry="4.5" />
      <ellipse className="pt-skin" cx="66.5" cy="52" rx="3" ry="4.5" />
      <ellipse className="pt-skin" cx="50" cy="50" rx="16.5" ry="19.5" />
      {/* Hair on top. */}
      {K && <path className="pt-hair" d="M33 52 Q31 30 50 29 Q69 30 67 52 L64 42 Q50 35 36 42 Z" />}
      {J && <path className="pt-hair" d="M33.5 49 Q33 31 50 31 Q67 31 66.5 49 Q61 39 50 39 Q39 39 33.5 49 Z" />}
      {Q && <path className="pt-hair" d="M33.5 50 Q33 30 50 30 Q67 30 66.5 50 Q60 37 50 36 Q40 37 33.5 50 Z" />}
      {/* Face: brows, eyes, nose, mouth — and the king's beard over the jaw. */}
      <path className="pt-brow" d="M40 44 Q44 41.5 47 43.5 M53 43.5 Q56 41.5 60 44" />
      <ellipse className="pt-eye" cx="44" cy="48" rx="2.2" ry="1.6" />
      <ellipse className="pt-eye" cx="56" cy="48" rx="2.2" ry="1.6" />
      <circle className="pt-ink-fill" cx="44.3" cy="48.2" r="1" />
      <circle className="pt-ink-fill" cx="56.3" cy="48.2" r="1" />
      <path className="pt-line" d="M50 49 Q47.6 56 50.5 57.5" />
      {K ? <>
        <path className="pt-beard" d="M33.5 52 Q33 74 50 86 Q67 74 66.5 52 Q63 63 57 62 Q50 67 43 62 Q37 63 33.5 52 Z" />
        <path className="pt-beard" d="M41 60.5 Q50 55 59 60.5 Q55 63.5 50 60 Q45 63.5 41 60.5 Z" />
        <path className="pt-line" d="M46 64.5 Q50 66.5 54 64.5" />
      </> : Q ? (
        <path className="pt-lips" d="M44.5 62 Q50 60 55.5 62 Q50 66.5 44.5 62 Z" />
      ) : (
        <path className="pt-line" d="M45 62 Q50 65 55 62" />
      )}
      {/* Headwear. */}
      {K && <g className="pt-gold">
        <path d="M31 36 L31 19 L38.5 27 L44 12 L50 25 L56 12 L61.5 27 L69 19 L69 36 Z" />
        <rect x="31" y="32" width="38" height="5" rx="1" />
        <circle className="pt-jewel" cx="50" cy="29" r="2.4" />
        <circle className="pt-jewel" cx="39" cy="34.5" r="1.4" />
        <circle className="pt-jewel" cx="61" cy="34.5" r="1.4" />
      </g>}
      {Q && <g>
        <path className="pt-gold" d="M35 33 Q42.5 19 50 26 Q57.5 19 65 33 Q57.5 29.5 50 33 Q42.5 29.5 35 33 Z" />
        <circle className="pt-jewel" cx="50" cy="24.5" r="2.2" />
        <circle className="pt-gold" cx="33.5" cy="60" r="2" />
        <circle className="pt-gold" cx="66.5" cy="60" r="2" />
        <path className="pt-pearls" d="M38 80 Q50 90 62 80" />
      </g>}
      {J && <g>
        <path className="pt-cap" d="M28 38 Q50 14 73 36 L71 40 L29 42 Z" />
        <path className="pt-gold" d="M29 40 L71 38 L71 41 L29 43 Z" />
        <path className="pt-feather" d="M63 28 Q82 8 92 15 Q80 18 70 33 Z" />
      </g>}
      {/* The suit on the chest. */}
      <text className="pt-sym" x="50" y="107" textAnchor="middle" fontSize="15">{sym}</text>
    </g>
  );
}

// The portrait: one bust (for a medallion or rising from the card's edge), or
// with `mirror` the classic double-headed card — two busts, split diagonally.
export function Portrait({ v, sym, mirror }) {
  if (mirror) return (
    <svg className="pc-port pc-mirror" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect className="pt-frame" x="1.5" y="1.5" width="97" height="147" rx="4" />
      <svg x="0" y="0" width="100" height="75" viewBox="0 5 100 105"><Bust v={v} sym={sym} /></svg>
      <g transform="rotate(180 50 75)">
        <svg x="0" y="0" width="100" height="75" viewBox="0 5 100 105"><Bust v={v} sym={sym} /></svg>
      </g>
      <path className="pt-split" d="M3 79 L97 71" />
    </svg>
  );
  return (
    <svg className="pc-port pc-single" viewBox="0 0 100 110" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <Bust v={v} sym={sym} />
    </svg>
  );
}

// The joker as a clown: a jester's cap in red and black with gold bells,
// white face paint, a red nose and a wide grin, over a ruff.
export function Clown() {
  return (
    <svg className="pc-clown" viewBox="0 0 100 110" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <path className="cl-suit" d="M3 110 C5 90 20 81 34 79 L66 79 C80 81 95 90 97 110 Z" />
      <path className="cl-suit2" d="M50 79 L66 79 C80 81 95 90 97 110 L50 110 Z" />
      <path className="cl-ruff" d="M22 82 L30 90 L37 82 L44 92 L50 83 L56 92 L63 82 L70 90 L78 82 Q50 98 22 82 Z" />
      <path className="cl-face" d="M42 64 L42 80 Q50 85 58 80 L58 64 Z" />
      <ellipse className="cl-face" cx="50" cy="53" rx="17" ry="19" />
      {/* the cap: three points, alternately red and black, bells on the tips */}
      <path className="cl-c1" d="M32 44 Q22 20 6 18 Q24 30 38 38 Z" />
      <path className="cl-c2" d="M38 38 Q40 12 50 4 Q60 12 62 38 Z" />
      <path className="cl-c1" d="M68 44 Q78 20 94 18 Q76 30 62 38 Z" />
      <path className="cl-band" d="M31 45 Q50 33 69 45 L68 49 Q50 38 32 49 Z" />
      <circle className="cl-bell" cx="6" cy="18" r="4.5" />
      <circle className="cl-bell" cx="50" cy="4" r="4.5" />
      <circle className="cl-bell" cx="94" cy="18" r="4.5" />
      {/* face paint: diamonds over the eyes, a red nose and grin */}
      <path className="cl-mark" d="M43 45 L45.5 50 L43 55 L40.5 50 Z M57 45 L59.5 50 L57 55 L54.5 50 Z" />
      <circle className="cl-ink" cx="43" cy="50" r="1.3" />
      <circle className="cl-ink" cx="57" cy="50" r="1.3" />
      <circle className="cl-nose" cx="50" cy="57" r="3.6" />
      <path className="cl-grin" d="M39 62 Q50 75 61 62 Q50 68 39 62 Z" />
    </svg>
  );
}
