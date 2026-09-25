// ═══════════════════════════════════════════════════════
// ECONOMY — levels, trophies, coins and prizes
// Pure numbers, shared by the server (which stamps a room's mode and
// entry fee on the game) and the client (which keeps the player's
// wallet). Nothing here touches storage or the network.
//
// DEMO: the wallet lives in the browser (see client/profile.js), so
// none of this is money and none of it is tamper-proof. The rules are
// written so they can move to a server as-is later.
// ═══════════════════════════════════════════════════════

// A brand-new profile starts with this much in the wallet.
export const START_COINS = 2000;

// The entry fees a paid room may ask for, cheapest first.
export const ENTRY_FEES = [100, 250, 500, 1000, 2500, 5000];
export const DEFAULT_FEE = 500;
export function normFee(fee) {
  const n = Number(fee);
  return ENTRY_FEES.includes(n) ? n : DEFAULT_FEE;
}

// Room modes. A practice table is free and changes nothing; an online
// room charges the fee up front and pays the pot out by place.
export const MODES = ['practice', 'online'];
export function normMode(mode) {
  return MODES.includes(mode) ? mode : 'online';
}

// ── Buying with a penalty card ───────────────────────
// Buying the discard out of turn (the one that comes with a penalty card from
// the deck) also costs coins in a paid room: 2% of the entry fee, rounded —
// 100 → 2, 500 → 10, 5000 → 100. The coins go into the pot. Free takes, the
// penalty-free opening discard, practice and free rooms cost nothing.
export const BUY_RATE = 0.02;
export function buyPrice(fee) {
  return Math.round((fee || 0) * BUY_RATE);
}

// ── Levels ───────────────────────────────────────────
// Each level asks for 500 XP more than the one before: 1000 to reach
// level 2, 1500 more for level 3, and so on.
export function xpToNext(level) {
  return 1000 + 500 * (level - 1);
}
// Where a total XP puts the player: their level, how far into it they
// are, and how much the level takes in all.
export function levelInfo(xp) {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  while (rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
  return { level, into: rest, need: xpToNext(level) };
}

// ── Places ───────────────────────────────────────────
// Lowest total wins, as on the game-over screen. Equal totals share a
// place and the next place is skipped (1, 1, 3), like any sports table.
export function places(totals) {
  return totals.map(t => 1 + totals.filter(o => o < t).length);
}

// ── XP and trophies for one finished game ────────────
// XP never goes down: everyone who plays a game to the end learns
// something. The winner gets the most, and beating more players is
// worth more.
export function gameXp(place, n) {
  return 100 + 50 * (n - place) + (place === 1 ? 150 : 0);
}
// Trophies are the rating. The last place always loses 10; the winner
// gains 20 at a two-player table and 5 more for each extra opponent;
// the places between are spread evenly. (The wallet keeps the total
// from dropping under zero.)
export function trophyDelta(place, n) {
  if (n < 2) return 0;
  const top = 30 + 5 * (n - 2);
  return Math.round(-10 + top * (n - place) / (n - 1));
}

// ── Prizes ───────────────────────────────────────────
// How the pot is shared between the places, by table size, in percent.
export function prizeShares(n) {
  if (n <= 2) return [100];
  if (n === 3) return [70, 30];
  if (n === 4) return [60, 30, 10];
  return [50, 30, 20];
}
// Each seat's share of the pot. Players who tie share the places they
// cover: two tied for first at a 4-player table split 60% + 30% between
// them. Any coin that doesn't divide evenly goes to the earliest seat of
// the tie.
export function prizes(totals, pot) {
  const n = totals.length;
  const shares = prizeShares(n);
  const pl = places(totals);
  const out = totals.map(() => 0);
  const done = new Set();
  for (let i = 0; i < n; i++) {
    if (done.has(pl[i])) continue;
    done.add(pl[i]);
    const tied = pl.map((p, k) => p === pl[i] ? k : -1).filter(k => k !== -1);
    let pct = 0;
    for (let p = pl[i]; p < pl[i] + tied.length; p++) pct += shares[p - 1] || 0;
    const sum = Math.floor(pot * pct / 100);
    const each = Math.floor(sum / tied.length);
    tied.forEach((k, j) => { out[k] = each + (j === 0 ? sum - each * tied.length : 0); });
  }
  return out;
}

// The whole result of a finished game, seat by seat. `room` is what the
// server stamped on the game when it started: { mode, fee, gameId }.
// A practice game (or one from before rooms had a mode) settles nothing.
// Only a room with an entry fee settles: a free room (and practice) gives no
// coins, no XP and no trophies. A seat that walked out (`out`) paid in like
// everyone else but finishes below all who stayed, and wins nothing; the pot
// is shared among those still playing, by how many they are.
export function settle(state) {
  const room = state && state.room;
  if (!room || room.mode !== 'online' || !(room.fee > 0)) return null;
  const n = state.players.length;
  const stay = state.players.map((p, i) => (p.out ? -1 : i)).filter(i => i !== -1);
  const stayTotals = stay.map(i => state.players[i].totalScore);
  const stayPlaces = places(stayTotals);
  // The pot: every entry fee, plus whatever was paid for buys along the way.
  const price = buyPrice(room.fee);
  const buys = state.players.reduce((a, p) => a + (p.paidBuys || 0), 0);
  const pot = room.fee * n + price * buys;
  const stayPrizes = prizes(stayTotals, pot);
  const pl = state.players.map(() => stay.length + 1);
  const pz = state.players.map(() => 0);
  stay.forEach((i, k) => { pl[i] = stayPlaces[k]; pz[i] = stayPrizes[k]; });
  return {
    gameId: room.gameId,
    fee: room.fee,
    buyPrice: price,
    buys,
    pot,
    seats: pl.map((place, i) => ({
      place,
      prize: pz[i],
      xp: gameXp(place, n),
      trophies: trophyDelta(place, n),
    })),
  };
}

// ── Store (demo) ─────────────────────────────────────
// Buying doesn't charge anything: the "payment" is a confirm dialog.
export const STORE_PACKS = [
  { id: 'p10',  coins: 10000, price: '9.90' },
  { id: 'p18',  coins: 18350, price: '17.90', tag: 'בונוס 10%' },
  { id: 'p40',  coins: 40000, price: '34.90', tag: 'הכי פופולרי' },
  { id: 'p100', coins: 110000, price: '79.90', tag: 'הכי משתלם' },
];

// ── Rewarded ad (demo) ───────────────────────────────
export const AD_REWARD = 100;
export const AD_SECONDS = 15;
export const AD_DAILY = 5;

// "12.6K" / "3K" / "950" — how the top bar and the room screens say a
// number of coins in a small space.
export function shortNum(n) {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${+(n / 1000).toFixed(1)}K`;
  return String(n);
}
