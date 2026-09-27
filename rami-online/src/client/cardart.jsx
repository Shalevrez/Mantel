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
