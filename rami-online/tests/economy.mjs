// ═══════════════════════════════════════════════════════
// ECONOMY — places, prizes, XP and trophies
// Run with: npm test
// ═══════════════════════════════════════════════════════
import {
  places, prizes, prizeShares, gameXp, trophyDelta, levelInfo, settle, normFee, ENTRY_FEES,
} from '../src/economy.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Places: lowest total first, ties share a place ──
check('plain order', eq(places([40, 10, 25]), [3, 1, 2]));
check('a tie shares the place and skips the next', eq(places([10, 10, 30, 5]), [2, 2, 4, 1]));

// ── Prize shares always add up to the whole pot ──
for (let n = 2; n <= 6; n++)
  check(`${n} players: shares add up to 100%`, prizeShares(n).reduce((a, b) => a + b, 0) === 100);

// ── Prizes ──
check('2 players: winner takes the pot', eq(prizes([30, 80], 500), [1000, 0]));
check('3 players: 70/30', eq(prizes([50, 20, 90], 1000), [900, 2100, 0]));
check('4 players: 60/30/10', eq(prizes([1, 2, 3, 4], 100), [240, 120, 40, 0]));
check('6 players: 50/30/20', eq(prizes([6, 5, 4, 3, 2, 1], 100), [0, 0, 0, 120, 180, 300]));
check('a tie for first splits 1st + 2nd', eq(prizes([10, 10, 30, 40], 100), [180, 180, 40, 0]));
check('everyone tied: the pot is shared evenly', eq(prizes([5, 5, 5], 100), [100, 100, 100]));
{
  const pz = prizes([10, 10, 10, 50, 60], 250);
  check('no coin is lost or made in a three-way tie', pz.reduce((a, b) => a + b, 0) === 250 * 5);
}
check('a free room pays nothing', eq(prizes([1, 2], 0), [0, 0]));

// ── XP ──
check('the winner gets the most XP', gameXp(1, 4) > gameXp(2, 4) && gameXp(2, 4) > gameXp(4, 4));
check('last place still earns XP', gameXp(4, 4) > 0);

// ── Trophies ──
check('2 players: +20 / −10', trophyDelta(1, 2) === 20 && trophyDelta(2, 2) === -10);
check('last place always loses 10', [2, 3, 4, 5, 6].every(n => trophyDelta(n, n) === -10));
check('a bigger table is worth more to win', trophyDelta(1, 6) > trophyDelta(1, 3));

// ── Levels ──
check('0 XP is level 1', eq(levelInfo(0), { level: 1, into: 0, need: 1000 }));
check('1000 XP is level 2', levelInfo(1000).level === 2 && levelInfo(1000).into === 0);
check('2600 XP is level 3 with 100 into it', eq(levelInfo(2600), { level: 3, into: 100, need: 2000 }));

// ── Fees ──
check('an unknown fee falls back to a listed one', ENTRY_FEES.includes(normFee(777)));
check('a listed fee is kept', normFee('2500') === 2500);

// ── Settle ──
{
  const state = {
    players: [{ totalScore: 120 }, { totalScore: 40 }, { totalScore: 75 }],
    room: { mode: 'online', fee: 500, gameId: 'g1' },
  };
  const s = settle(state);
  check('settle: pot is fee × players', s.pot === 1500 && s.gameId === 'g1');
  check('settle: seat 1 won', s.seats[1].place === 1 && s.seats[1].prize === 1050);
  check('settle: seat 0 came last', s.seats[0].place === 3 && s.seats[0].prize === 0 && s.seats[0].trophies === -10);
  check('practice settles nothing', settle({ ...state, room: { ...state.room, mode: 'practice' } }) === null);
  check('a game from before modes settles nothing', settle({ players: state.players }) === null);
}

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall economy checks passed');
