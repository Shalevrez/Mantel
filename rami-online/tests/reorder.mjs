// ═══════════════════════════════════════════════════════
// HAND REORDER — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// A drag drops a card in front of another one, or — new with the insertion
// bar — right after it, which is the only way to reach the last slot. The
// client applies the move itself before the server echoes it back, so both
// sides must run the very same `moveCard` and agree on the result.
// ═══════════════════════════════════════════════════════
import { initGame, moveCard, G } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const H = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
const ids = (h) => h.map(c => c.id).join('');

check('before a later card', ids(moveCard(H, 'a', 'd')) === 'bcade');
check('before an earlier card', ids(moveCard(H, 'd', 'b')) === 'adbce');
check('after a later card', ids(moveCard(H, 'a', 'd', true)) === 'bcdae');
check('after the last card reaches the end', ids(moveCard(H, 'b', 'e', true)) === 'acdeb');
check('after an earlier card', ids(moveCard(H, 'e', 'a', true)) === 'aebcd');
check('to the very front', ids(moveCard(H, 'c', 'a')) === 'cabde');
check('in front of its own neighbour is a no-op', moveCard(H, 'b', 'c') === H);
check('after its own neighbour is a no-op', moveCard(H, 'b', 'a', true) === H);
check('onto itself is a no-op', moveCard(H, 'b', 'b', true) === H);
check('unknown card is a no-op', moveCard(H, 'x', 'a') === H);
check('input is left untouched', ids(H) === 'abcde');

// The reducer moves the named seat's hand, and only that one.
let st = initGame([{ name: 'שלו', isAI: false }, { name: 'דנה', isAI: false }]);
st = { ...st, players: st.players.map(p => ({ ...p, hand: H })) };
const next = G(st, { type: 'REORDER', seat: 1, cid: 'a', targetId: 'e', after: true });
check('reducer honours `after`', ids(next.players[1].hand) === 'bcdea');
check('other seats untouched', next.players[0].hand === H);
const old = G(st, { type: 'REORDER', seat: 1, cid: 'a', targetId: 'e' });
check('old clients (no `after`) still drop in front', ids(old.players[1].hand) === 'bcdae');
check('no-op returns the same state', G(st, { type: 'REORDER', seat: 1, cid: 'b', targetId: 'c' }) === st);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall reorder checks passed');
