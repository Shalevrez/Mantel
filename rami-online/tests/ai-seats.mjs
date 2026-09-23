// ═══════════════════════════════════════════════════════
// COMPUTER PLAYERS — regression checks
// Run with: npm test   (plain node, no test runner needed)
//
// The lobby used to have a single "fill empty seats" checkbox, which filled up
// to two players — so a host alone with the computer started a two-handed game
// and the other chairs stayed empty. Bots are now seated one by one by the
// host, up to three of them at a six-chair table, and they all play at the
// difficulty the host picked. These checks cover the seating rules, the seat
// bookkeeping around removal, the deck a bigger table is dealt from, and that
// each difficulty can actually play a round through.
// ═══════════════════════════════════════════════════════
import { Room } from '../src/worker/index.js';
import { initGame, startHand, aiDiscard, aiWantCard, mkCard, makeDeck, decksFor } from '../src/game-core.js';
import { fakeStorage } from './fake-storage.mjs';

class FakeWS {
  constructor(tag) { this.tag = tag; this.sent = []; this.listeners = {}; this.closed = false; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { if (this.closed) return; this.closed = true; (this.listeners.close || []).forEach(f => f()); }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  msg(obj) { (this.listeners.message || []).forEach(f => f({ data: JSON.stringify(obj) })); }
  lastLobby() { return [...this.sent].reverse().find(m => m.t === 'lobby'); }
  lastError() { return [...this.sent].reverse().find(m => m.t === 'error'); }
}

function makeRoom() {
  const room = new Room({ storage: fakeStorage() }, {});
  room.code = 'ABCD';
  return room;
}
function join(room, { name, pid, host = false }) {
  const ws = new FakeWS(`${name}/${pid}`);
  room.handleSocket(ws, name, 'ABCD', host, pid);
  return ws;
}
const botNames = room => room.seats.filter(s => s.isAI).map(s => s.name);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── 1. The host seats bots one by one, up to three ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  for (let i = 0; i < 5; i++) host.msg({ t: 'addAI' });
  check('at most three computer players', room.aiCount() === 3);
  check('they are numbered 1..3', botNames(room).join(',') === 'מחשב 1,מחשב 2,מחשב 3');
  check('the host is told why the fourth was refused', /עד 3/.test(host.lastError()?.msg || ''));
  check('the lobby reports the count and the cap',
        host.lastLobby().aiCount === 3 && host.lastLobby().maxAI === 3 && host.lastLobby().maxSeats === 6);
  check('bots appear in the lobby list', host.lastLobby().players.filter(p => p.isAI).length === 3);
}

// ── 2. Six chairs, humans included ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  for (const n of ['a', 'b', 'c', 'd', 'e']) join(room, { name: n, pid: 'p-' + n });
  check('six people fill the room', room.seats.length === 6);
  host.msg({ t: 'addAI' });
  check('no bot squeezes into a full table', room.aiCount() === 0);
  check('the host is told the table is full', /מלא/.test(host.lastError()?.msg || ''));
  const late = join(room, { name: 'מאחר', pid: 'p-late' });
  check('a seventh human is refused', /מלא/.test(late.lastError()?.msg || ''));
}

// ── 3. A bot never keeps a person out ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  for (const n of ['a', 'b']) join(room, { name: n, pid: 'p-' + n });
  for (let i = 0; i < 3; i++) host.msg({ t: 'addAI' });
  check('three humans and three bots fill the table', room.seats.length === 6 && room.aiCount() === 3);
  const friend = join(room, { name: 'חבר', pid: 'p-friend' });
  check('a human joining a full lobby gets a seat', friend.lastLobby()?.youSeat >= 0);
  check('the newest bot gave up its chair', room.aiCount() === 2 && room.seats.length === 6);
  check('the bots that stayed keep their names', botNames(room).join(',') === 'מחשב 1,מחשב 2');
  host.msg({ t: 'addAI' });
  check('no bot comes back while the chairs are taken', room.aiCount() === 2);
  host.msg({ t: 'removeAI', seat: room.seats.findIndex(s => s.name === 'מחשב 1') });
  host.msg({ t: 'addAI' });
  check('a freed number is handed out again',
        botNames(room).sort().join(',') === 'מחשב 1,מחשב 2');
}

// ── 4. Removing a bot from the middle doesn't shuffle anyone's seat ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  host.msg({ t: 'addAI' });                       // seat 1
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });  // seat 2
  check('דנה sits behind the bot', dana.lastLobby().youSeat === 2);
  host.msg({ t: 'removeAI', seat: 1 });
  check('the bot is gone', room.seats.length === 2 && room.aiCount() === 0);
  check('דנה moved up to seat 1', dana.lastLobby().youSeat === 1);
  // The socket→seat map is resolved per message, so דנה's next message must be
  // stamped with her new seat — not the one she had when she connected.
  dana.msg({ t: 'start' });
  check('a non-host still cannot start', room.started === false);
  host.msg({ t: 'start' });
  check('the host can start', room.started === true);
  check('the game has exactly the two people in the room', room.state.players.length === 2);
}

// ── 5. Only the host sets the table up ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  const dana = join(room, { name: 'דנה', pid: 'p-dana' });
  dana.msg({ t: 'addAI' });
  check('a guest cannot add a computer player', room.aiCount() === 0);
  host.msg({ t: 'addAI' });
  dana.msg({ t: 'removeAI', seat: 2 });
  check('a guest cannot remove one', room.aiCount() === 1);
  dana.msg({ t: 'aiLevel', level: 'hard' });
  check('a guest cannot change the difficulty', room.aiLevel === 'medium');
  host.msg({ t: 'start' });
  host.msg({ t: 'addAI' });
  check('no bot joins a game already under way', room.aiCount() === 1);
}

// ── 6. Difficulty applies to every bot, new ones included ──
{
  const room = makeRoom();
  const host = join(room, { name: 'שלו', pid: 'p-host', host: true });
  host.msg({ t: 'addAI' });
  host.msg({ t: 'aiLevel', level: 'hard' });
  host.msg({ t: 'addAI' });
  check('the room remembers the level', room.aiLevel === 'hard');
  check('every bot plays at it', room.seats.filter(s => s.isAI).every(s => s.ai === 'hard'));
  check('the lobby shows it', host.lastLobby().aiLevel === 'hard' &&
        host.lastLobby().players.filter(p => p.isAI).every(p => p.ai === 'hard'));
  host.msg({ t: 'aiLevel', level: 'cheating' });
  check('an unknown level falls back to medium', room.aiLevel === 'medium');
  host.msg({ t: 'start' });
  check('the game starts with the host and both bots', room.state.players.length === 3);
  check('the dealt players carry the level', room.state.players.slice(1).every(p => p.ai === 'medium'));
}

// ── 7. A bigger table is dealt from a bigger deck ──
{
  check('two decks up to four players', decksFor(2) === 2 && decksFor(4) === 2);
  check('three decks from five players', decksFor(5) === 3 && decksFor(6) === 3);
  check('a deck is 54 cards per copy', makeDeck(3).length === 162);
  const four = initGame(Array.from({ length: 4 }, (_, i) => ({ name: 'p' + i, isAI: true })));
  const six  = initGame(Array.from({ length: 6 }, (_, i) => ({ name: 'p' + i, isAI: true })));
  const left = st => st.deck.length + st.players.reduce((n, p) => n + p.hand.length, 0) +
                     st.discard.length + (st.beit ? 1 : 0);
  check('four players still play with 108 cards', left(four) === 108);
  check('six players play with 162', left(six) === 162);
  check('everyone gets fourteen', six.players.every(p => p.hand.length === 14));
  check('six players still leave a real pile', six.deck.length === 162 - 6 * 14 - 2);
}

// ── 8. The levels really do throw different cards ──
{
  // A hand where the expensive card is the useful one: the king pairs with two
  // other kings, the lone 3 pairs with nothing.
  const hand = [
    mkCard('h', 13), mkCard('d', 13), mkCard('c', 13),
    mkCard('s', 3), mkCard('h', 9), mkCard('h', 10), mkCard('j', 0),
  ];
  check('medium throws its priciest spare', aiDiscard(hand, 'medium').v === 10);
  check('hard throws the card with no partners', aiDiscard(hand, 'hard').v === 3);
  check('hard keeps its joker', !aiDiscard(hand, 'hard').j);
  check('medium keeps its joker', !aiDiscard(hand, 'medium').j);
  // Easy picks a spare at random — pin the coin flip to see it take the first.
  check('easy throws whatever comes to hand', aiDiscard(hand, 'easy', () => 0).v === 3);
  check('an unknown level plays as medium', aiDiscard(hand, 'nonsense').v === 10);

  // 6♥ completes nothing here (5♥,6♥,8♥ has a gap and there is no second 6 to
  // pair the 6♦ with) but it has partners all over the hand: it scores 5
  // affinity, clearing both hard's bar (3) and medium's (4).
  const near = [mkCard('h', 5), mkCard('h', 8), mkCard('d', 6), mkCard('s', 2)];
  check('hard picks up a card that pairs with the hand', aiWantCard(near, mkCard('h', 6), 'hard'));
  check('medium also picks up a card that pairs with the hand', aiWantCard(near, mkCard('h', 6), 'medium'));
  // A thinner pairing (6♦ same value +2, 8♥ same-suit gap-2 +1 = 3) clears
  // hard's bar but not medium's — that's the gap between the two levels.
  const thinPair = [mkCard('d', 6), mkCard('h', 8)];
  check('hard trusts a thinner pairing than medium', aiWantCard(thinPair, mkCard('h', 6), 'hard'));
  check('medium waits for a stronger pairing than hard', !aiWantCard(thinPair, mkCard('h', 6), 'medium'));
  const completes = [mkCard('h', 5), mkCard('h', 6), mkCard('h', 8), mkCard('s', 2)];
  check('medium takes the card that completes a run', aiWantCard(completes, mkCard('h', 7), 'medium'));
  check('easy takes it too', aiWantCard(completes, mkCard('h', 7), 'easy'));
  const joker = mkCard('j', 0);
  check('medium takes a discarded joker', aiWantCard(near, joker, 'medium'));
  check('easy leaves the joker', !aiWantCard(near, joker, 'easy'));

  // A costly (paid) buy needs a stronger pairing than a free take: 6♥ scores
  // 5 against `near` (two suit-adjacent cards plus a same-value partner), so
  // it clears both bars; a hand that only scores 4 clears the free bar (≥3)
  // but not the costly one (≥5).
  check('hard wants a strong pairing even as a paid buy', aiWantCard(near, mkCard('h', 6), 'hard', { costly: true }));
  const midPair = [mkCard('d', 6), mkCard('h', 5)];
  check('hard takes a middling pairing for free', aiWantCard(midPair, mkCard('h', 6), 'hard'));
  check('hard won’t pay a penalty card for a middling pairing', !aiWantCard(midPair, mkCard('h', 6), 'hard', { costly: true }));
  // Medium's own bars are 4 free / 6 costly: `near` (5) clears the free bar
  // but not medium's costly one.
  check('medium won’t pay a penalty card for a pairing that only just clears its free bar', !aiWantCard(near, mkCard('h', 6), 'medium', { costly: true }));

  // Hard also won't hand an opponent a free lay-off when it can help it: a
  // board run of clubs 6-7-8 makes 9♣ a feed (it extends the run), while 3♠
  // is equally useless to the hand but attaches to nothing on the table.
  const boardHand = [
    mkCard('h', 13), mkCard('d', 13), mkCard('c', 13),
    mkCard('s', 3), mkCard('c', 9),
  ];
  const board = [{ id: 'g1', type: 'seq', cards: [mkCard('c', 6), mkCard('c', 7), mkCard('c', 8)] }];
  check('without board awareness hard would throw the feeding card', aiDiscard(boardHand, 'hard').v === 9);
  check('hard avoids feeding an open board run when it has a choice', aiDiscard(boardHand, 'hard', Math.random, board).v === 3);
  // If every spare feeds the board, hard still has to throw something.
  const onlyFeeds = [mkCard('h', 13), mkCard('d', 13), mkCard('c', 13), mkCard('c', 9)];
  check('hard still discards when every spare feeds the board', aiDiscard(onlyFeeds, 'hard', Math.random, board).v === 9);
  // Medium avoids feeding the board too, same as hard.
  check('without board awareness medium would throw the feeding card', aiDiscard(boardHand, 'medium').v === 9);
  check('medium avoids feeding an open board run when it has a choice', aiDiscard(boardHand, 'medium', Math.random, board).v === 3);

  // Easy no longer risks its own joker on a coin flip: with two candidates
  // (3♠, joker) and a coin flip that used to land on index 1 (the joker),
  // it now always keeps the joker and throws the real card instead.
  const spareAndJoker = [mkCard('s', 3), mkCard('j', 0)];
  check('easy won’t lose its joker to bad luck', aiDiscard(spareAndJoker, 'easy', () => 0.99).v === 3);
  // ...but it still has to throw the joker if it's the only card left.
  check('easy still throws a joker when nothing else is left', aiDiscard([mkCard('j', 0)], 'easy').j);
}

// ── 9. Every level can play a full round without getting stuck ──
// Six computer players, driven straight through the AI entry points the room
// uses — the loop stands in for the timers a real room runs on.
for (const level of ['easy', 'medium', 'hard']) {
  const room = makeRoom();
  room.seats = Array.from({ length: 6 }, (_, i) => ({
    name: `מחשב ${i}`, uid: `ai:${i}`, connId: null, ws: null,
    connected: false, isAI: true, ai: level, downAt: 0,
  }));
  room.started = true;
  room.state = startHand(initGame(room.seats.map(s => ({ name: s.name, isAI: true, ai: level }))));
  let steps = 0;
  while (!['round_end', 'game_end'].includes(room.state.phase) && steps++ < 5000) {
    const before = room.state;
    if (room.state.phase === 'buying') room.aiBuy();
    else if (room.state.phase === 'draw') room.aiDraw();
    else room.aiAction();
    if (room.state === before) break;   // stuck: the round would never end
  }
  const st = room.state;
  const cards = st.deck.length + st.discard.length + (st.beit ? 1 : 0) +
                st.board.reduce((n, g) => n + g.cards.length, 0) +
                st.players.reduce((n, p) => n + p.hand.length, 0);
  check(`${level}: a six-bot round plays to the end`, st.phase === 'round_end');
  check(`${level}: no card was lost or duplicated on the way`, cards === 162);
}

// ── 10. Hard chases an ante (אנט) ────────────────────
// A player wins as an "ant" (−50 bonus) only by going out on the very first
// lay of the round, in that same turn, without attaching to the board. Laying
// a partial group early locks in hasLaid and forfeits that for the rest of
// the round, so a sharp player holds off when it's genuinely close — and
// reaches for the בית (beit) card when it's the exact missing piece.
{
  const seq3 = () => [mkCard('h', 5), mkCard('h', 6), mkCard('h', 7)];

  // Builds a fresh 2-player state with seat 0's hand set directly, ready to
  // act in the 'action' phase on mishkakon 0 (needs just one 3+ sequence).
  function craftAction(hand) {
    const st = initGame([{ name: 'a', isAI: true }, { name: 'b', isAI: true }]);
    return {
      ...st, phase: 'action', cur: 0, canLay: true, mk: 0, board: [],
      laidAtTurnStart: false, attachedThisTurn: false, tookBeit: false,
      players: st.players.map((p, i) => i === 0 ? { ...p, hand, hasLaid: false } : p),
    };
  }

  // Two spares left after grouping (9♠, 2♣): close, but not a sure thing yet
  // — laying now would mean giving up on the ante for the rest of the round.
  const closeHand = [...seq3(), mkCard('s', 9), mkCard('c', 2)];

  const hardRoom = makeRoom();
  hardRoom.seats = [{ ai: 'hard' }, { ai: 'medium' }];
  hardRoom.state = craftAction(closeHand);
  hardRoom.aiAction();
  check('hard holds back a lay two cards short of an ante', hardRoom.state.players[0].hasLaid === false);
  check('hard’s hold-back leaves the board untouched', hardRoom.state.board.length === 0);
  check('hard still discarded this turn', hardRoom.state.phase === 'buying');

  const mediumRoom = makeRoom();
  mediumRoom.seats = [{ ai: 'medium' }, { ai: 'medium' }];
  mediumRoom.state = craftAction(closeHand);
  mediumRoom.aiAction();
  check('medium lays the identical hand immediately (no ante-chasing)', mediumRoom.state.players[0].hasLaid === true);
  check('medium’s lay reaches the board', mediumRoom.state.board.length > 0);

  // Four spares is too far off to gamble on — hard plays it normally.
  const farHand = [...seq3(), mkCard('s', 9), mkCard('c', 2), mkCard('d', 4), mkCard('c', 8)];
  const farRoom = makeRoom();
  farRoom.seats = [{ ai: 'hard' }, { ai: 'medium' }];
  farRoom.state = craftAction(farHand);
  farRoom.aiAction();
  check('hard doesn’t hold back when it’s too far from an ante', farRoom.state.players[0].hasLaid === true);

  // Exactly one spare is already a perfect ante: lay it and it wins outright.
  const perfectHand = [...seq3(), mkCard('s', 9)];
  const perfectRoom = makeRoom();
  perfectRoom.seats = [{ ai: 'hard' }, { ai: 'medium' }];
  perfectRoom.state = craftAction(perfectHand);
  perfectRoom.aiAction();
  check('a perfect one-spare hand lays immediately and wins as an ante',
    perfectRoom.state.phase === 'round_end');
  check('the ante bonus is applied', perfectRoom.state.players[0].lastScore === -50);

  // The beit is exactly the missing card: aiDraw() reaches for it instead of
  // drawing, and aiAction() then completes the ante.
  const beitCard = mkCard('h', 7);
  const beitRoom = makeRoom();
  beitRoom.seats = [{ ai: 'hard' }, { ai: 'medium' }];
  beitRoom.state = {
    ...craftAction([mkCard('h', 5), mkCard('h', 6), mkCard('s', 9)]),
    phase: 'draw', beit: beitCard,
  };
  beitRoom.aiDraw();
  check('hard reaches for the beit when it completes the hand', beitRoom.state.tookBeit === true);
  check('the beit is spent', beitRoom.state.beit === null);
  check('the beit joined the hand', beitRoom.state.players[0].hand.some(c => c.id === beitCard.id));
  beitRoom.aiAction();
  check('hard completes the ante after taking the beit', beitRoom.state.phase === 'round_end');
  check('the ante bonus is applied after a beit win', beitRoom.state.players[0].lastScore === -50);

  // A hand that took the beit but can't actually complete an ante (should
  // never happen — aiDraw only takes it once antReadyWithBeit proves it out
  // — but aiAction must never get stuck on it) gives the card back instead.
  const beforeHand = [mkCard('h', 5), mkCard('h', 6), mkCard('s', 9)];
  const strandedBeit = mkCard('c', 2);
  const stuckRoom = makeRoom();
  stuckRoom.seats = [{ ai: 'hard' }, { ai: 'medium' }];
  stuckRoom.state = {
    ...craftAction([...beforeHand, strandedBeit]),
    tookBeit: true, beit: null,
    undoBefore: {
      hand: beforeHand, board: [], hasLaid: false, beit: strandedBeit,
      deck: [], discard: [], fromBeit: true,
    },
  };
  stuckRoom.aiAction();
  check('a stranded beit is handed back rather than leaving the turn stuck', stuckRoom.state.phase === 'draw');
  check('tookBeit clears on the way out', stuckRoom.state.tookBeit === false);
  check('the beit itself is restored', stuckRoom.state.beit?.id === strandedBeit.id);
  check('the hand is restored to before the beit', stuckRoom.state.players[0].hand.length === beforeHand.length);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
