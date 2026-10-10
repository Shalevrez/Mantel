// ═══════════════════════════════════════════════════════
// GAME FORMAT — how much of the game a room plays
// Run with: npm test
//
// mega: all six mishkakonim. mini: שלישייה through רביעייה. single: one
// mishkakon the creator picks. Chosen when the room is created, carried by
// the game, and the last mishkakon of the format ends it.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { fakeStorage } from './fake-storage.mjs';
import { initGame, G, MK } from '../src/game-core.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

const seats = n => Array.from({ length: n }, (_, i) => ({ name: 'p' + i, isAI: false }));
// Play a game round by round, as the round-end screen would, and list the
// mishkakonim it went through.
function ladder(st) {
  const played = [st.mk];
  for (let i = 0; i < 10; i++) {
    st = G({ ...st, phase: 'round_end' }, { type: 'NEXT_MK' });
    if (st.phase === 'game_end') return played;
    played.push(st.mk);
  }
  return played;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. The reducer ──
check('no format: the whole game', same(ladder(initGame(seats(3), 0)), [0, 1, 2, 3, 4, 5]));
check('mega: the whole game', same(ladder(initGame(seats(3), 0, { format: 'mega' })), [0, 1, 2, 3, 4, 5]));
check('mini: up to רביעייה', same(ladder(initGame(seats(3), 0, { format: 'mini' })), [0, 1, 2]));
for (let mk = 0; mk < MK.length; mk++) {
  const st = initGame(seats(3), 0, { format: 'single', mk });
  check(`single ${MK[mk].name}: deals it and ends after it`, st.mk === mk && same(ladder(st), [mk]));
}
check('single with a bad mishkakon falls back to שלישייה',
      initGame(seats(3), 0, { format: 'single', mk: 9 }).mk === 0);
check('an unknown format plays the whole game', same(ladder(initGame(seats(3), 0, { format: 'x' })), [0, 1, 2, 3, 4, 5]));
check('a single mishkakon is opened by the drawn seat',
      initGame(seats(4), 2, { format: 'single', mk: 3 }).cur === 2);
{
  // A redeal (NEW_HAND) of the last mishkakon doesn't end the game.
  const st = G({ ...initGame(seats(3), 0, { format: 'single', mk: 4 }), phase: 'round_end' }, { type: 'NEW_HAND' });
  check('a redeal stays on the same mishkakon', st.phase === 'buying' && st.mk === 4);
}
{
  // A game saved before formats existed still plays to the end.
  const { mkFirst, mkLast, format, ...old } = initGame(seats(3), 0);
  check('an old saved game plays all six', same(ladder(old), [0, 1, 2, 3, 4, 5]));
}

// ── 2. The room ──
class FakeWS {
  constructor() { this.sent = []; this.listeners = {}; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() {}
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  last(t) { return [...this.sent].reverse().find(m => m.t === t); }
}
const tick = () => new Promise(r => setTimeout(r, 0));
async function room(q) {
  const store = new Map();
  const r = new Room({ storage: fakeStorage(store) }, {});
  await r.fetch(new Request(`https://do/create?code=ABCD&mode=online&fee=0&seats=2${q}`));
  const host = new FakeWS();
  r.handleSocket(host, 'שלו', 'ABCD', true, 'p1', false);
  r.handleSocket(new FakeWS(), 'דנה', 'ABCD', false, 'p2', false);
  return { r, host, store };
}
{
  const { host } = await room('');
  check('a room with no format plays mega', host.last('lobby').format === 'mega');
  host.msg({ t: 'start' });
  await tick();
  check('and its game ends after שתי חמישיות', host.last('state').state.mkLast === 5);
}
{
  const { r, host, store } = await room('&format=single&mk=3');
  const lobby = host.last('lobby');
  check('the lobby shows the format and the mishkakon', lobby.format === 'single' && lobby.formatMk === 3);
  const again = new Room({ storage: fakeStorage(store) }, {});
  await again.load();
  check('the format is persisted', again.format === 'single' && again.formatMk === 3);
  host.msg({ t: 'start' });
  await tick();
  const st = r.state;
  check('the game deals שתי רביעיות', st.mk === 3 && st.mkFirst === 3 && st.mkLast === 3);
}
{
  const { r, host } = await room('&format=mini&mk=4');
  check('mini ignores a mishkakon', host.last('lobby').formatMk === 0);
  host.msg({ t: 'start' });
  await tick();
  check('mini starts at שלישייה and ends at רביעייה', r.state.mk === 0 && r.state.mkLast === 2);
}
{
  const { host } = await room('&format=bogus&mk=x');
  check('junk terms fall back to mega', host.last('lobby').format === 'mega' && host.last('lobby').formatMk === 0);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall game-format checks passed');
