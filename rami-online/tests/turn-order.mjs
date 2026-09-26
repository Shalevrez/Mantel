// ═══════════════════════════════════════════════════════
// TURN ORDER — regression checks
// Run with: npm test
//
// The seat that opens the game is drawn at random. Turns and the buying offer
// go around in seat order (clockwise), and each new mishkakon is opened by the
// seat after the one that opened the last.
// ═══════════════════════════════════════════════════════
import { initGame, retireSeat, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const seats = n => Array.from({ length: n }, (_, i) => ({ name: 'p' + i, isAI: false }));
const nextMk = st => G({ ...st, phase: 'round_end' }, { type: 'NEXT_MK' });

// The opener is random: over many games every seat of four gets to open.
const opened = new Set();
for (let i = 0; i < 200; i++) opened.add(initGame(seats(4)).cur);
check('every seat can open the game', opened.size === 4);

// A given starter opens the first mishkakon, with the opening offer theirs.
let st = initGame(seats(4), 2);
check('the starter is on turn', st.cur === 2 && st.buy.checker === 2 && st.buy.origNext === 2);

// Each mishkakon moves the opener one seat on, wrapping around the table.
const openers = [st.cur];
for (let mk = 1; mk < 6; mk++) { st = nextMk(st); openers.push(st.cur); }
check('openers go 2,3,0,1,2,3', openers.join() === '2,3,0,1,2,3');

// After a discard the next seat plays, and the buy offer goes on from there.
st = initGame(seats(3), 1);
st = G(st, { type: 'SKIP' });                    // seat 1 passes the opening card
check('the offer passes to the next seat', st.phase === 'buying' && st.buy.checker === 2);
st = G(st, { type: 'SKIP' });
st = G(st, { type: 'SKIP' });                    // seat 0 passes too — back to seat 1
check('the opener draws once the offer comes round', st.phase === 'draw' && st.cur === 1);
st = G(st, { type: 'DRAW' });
st = G(st, { type: 'DISCARD', cid: st.players[1].hand[0].id });
check('the turn passes to the next seat', st.cur === 2 && st.buy.checker === 2);
st = G(st, { type: 'SKIP' });
check('then the offer goes to the seat after it', st.buy.checker === 0);

// A seat that walked out is skipped when it would have opened.
st = initGame(seats(3), 0);
st = retireSeat(st, 1);
st = nextMk(st);
check('an empty seat never opens a mishkakon', st.cur === 2);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall turn-order checks passed');
