// ═══════════════════════════════════════════════════════
// PROFILE — the demo account and wallet in localStorage
// Run with: npm test
// ═══════════════════════════════════════════════════════

// A localStorage for node. Set up before profile.js is loaded.
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: k => void mem.delete(k),
};
const P = await import('../src/client/profile.js');
const { START_COINS, AD_REWARD, AD_DAILY, AD_SECONDS, STORE_PACKS } = await import('../src/economy.js');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) failures++;
}

// ── Guest ──
{
  const { user } = P.loginGuest();
  check('a guest starts with the opening coins', user.coins === START_COINS && user.provider === 'guest');
  check('and is signed in', P.current().id === user.id);
}

// ── Welcome ──
{
  check('a new profile has not seen the welcome', P.current().welcomed === false);
  P.markWelcomed();
  check('once seen, it stays seen', P.current().welcomed === true);
  P._reset();
  check('and is remembered after a reload', P.current().welcomed === true);
}

// ── Entry fee and settlement are idempotent ──
{
  check('the fee is charged', P.chargeEntry('g1', 500) && P.current().coins === START_COINS - 500);
  P.chargeEntry('g1', 500);
  check('a second charge for the same game is a no-op', P.current().coins === START_COINS - 500);
  check('a fee the wallet cannot cover is refused', !P.chargeEntry('g-big', 999999));
  const r = { place: 1, prize: 1500, xp: 350, trophies: 20 };
  P.applyGameResult('g1', r);
  P.applyGameResult('g1', r);
  const u = P.current();
  check('the prize is paid once', u.coins === START_COINS - 500 + 1500);
  check('XP, trophies, games and wins are counted once', u.xp === 350 && u.trophies === 20 && u.games === 1 && u.wins === 1);
  check('the game is no longer pending', !('g1' in u.pending));
  P.applyGameResult('g2', { place: 3, prize: 0, xp: 100, trophies: -50 });
  check('trophies never drop under zero', P.current().trophies === 0);
}

// ── Refund and forfeit ──
{
  const before = P.current().coins;
  P.chargeEntry('g3', 250);
  check('refund: the fee comes back', P.refundPending() === 250 && P.current().coins === before);
  check('a refunded game cannot be charged again', P.chargeEntry('g3', 250) && P.current().coins === before);
  P.chargeEntry('g4', 100);
  P.forfeit('g4');
  check('forfeit: the fee stays gone', P.current().coins === before - 100 && P.refundPending() === 0);
}

// ── Paying for buys ──
{
  const before = P.current().coins;
  P.chargeEntry('g5', 500);
  check('buys: the first one is charged', P.chargeBuys('g5', 1, 10) === 10 && P.current().coins === before - 510);
  check('buys: the same count again charges nothing', P.chargeBuys('g5', 1, 10) === 0);
  check('buys: only the new ones are charged', P.chargeBuys('g5', 3, 10) === 20 && P.current().coins === before - 530);
  check('buys: a room closing early hands back fee and buys', P.refundPending() === 530 && P.current().coins === before);
  check('buys: nothing is charged for a finished game', P.chargeBuys('g5', 5, 10) === 0 && P.current().coins === before);
  check('buys: a free room charges nothing', P.chargeBuys('g6', 2, 0) === 0);
}

// ── Store and ads ──
{
  const before = P.current().coins;
  P.buyPack(STORE_PACKS[0].id);
  check('a pack adds its coins', P.current().coins === before + STORE_PACKS[0].coins);
  const t0 = Date.now();
  check('an ad cut short pays nothing', P.claimAd(t0, t0 + 3000) === 0);
  let got = 0;
  for (let i = 0; i < AD_DAILY + 2; i++) got += P.claimAd(t0, t0 + AD_SECONDS * 1000);
  check(`at most ${AD_DAILY} ads a day`, got === AD_DAILY * AD_REWARD && P.adsLeft() === 0);
}

// ── Username and password ──
{
  const guestId = P.current().id;
  const up = await P.upgradeGuest('shalev', 'pass1234');
  check('a guest can be saved as an account, keeping its progress', up.user && up.user.id === guestId && up.user.provider === 'password');
  check('the password is not stored in plain text', !mem.get('mantel_demo_accounts').includes('pass1234'));
  P.logout();
  check('logging out leaves nobody signed in', P.current() === null);
  check('a wrong password is refused', !!(await P.login('shalev', 'nope')).error);
  const back = await P.login('SHALEV', 'pass1234');
  check('the right one signs back in (username is case-blind)', back.user && back.user.id === guestId);
  check('the name is taken for a new account', !!(await P.register('shalev', 'xxxx')).error);
  const reg = await P.register('dana', 'abcd', 'דנה');
  check('register makes a new signed-in profile', reg.user && P.current().displayName === 'דנה' && P.current().coins === START_COINS);
  check('too short a username is refused', !!(await P.register('ab', 'abcd')).error);
}

// ── Pretend Google ──
{
  const a = P.loginGoogleDemo('נועה', 'noa@gmail.com');
  const b = P.loginGoogleDemo('', 'NOA@gmail.com');
  check('the same address returns the same profile', a.user.id === b.user.id);
  check('a bad address is refused', !!P.loginGoogleDemo('x', 'not-an-email').error);
}

// ── Survives a reload ──
{
  const id = P.current().id;
  P._reset();
  check('the signed-in profile is read back from storage', P.current() && P.current().id === id);
  const lb = P.leaderboard();
  check('the leaderboard ranks by trophies and marks you', lb.some(r => r.you) &&
        lb.every((r, i) => i === 0 || lb[i - 1].trophies >= r.trophies));
}

// ── Leaderboard scopes ──
{
  P.loginGuest();
  const me = P.current();
  P.applyGameResult('lb-1', { place: 1, prize: 0, xp: 10, trophies: 25 });
  P.applyGameResult('lb-2', { place: 3, prize: 0, xp: 10, trophies: -5 });
  const mine = (scope, now) => P.leaderboard(scope, now).find(r => r.id === me.id);
  check('local shows only this browser\'s profiles', P.leaderboard('local').every(r => !r.rival));
  check('global adds the rivals', P.leaderboard('global').some(r => r.rival));
  check('daily counts today\'s trophies, losses included', mine('daily').trophies === 20);
  check('weekly counts this week\'s trophies', mine('weekly').trophies === 20);
  const nextWeek = Date.now() + 8 * 24 * 3600 * 1000;
  check('a new day and week start from zero', mine('daily', nextWeek).trophies === 0 && mine('weekly', nextWeek).trophies === 0);
  check('the all-time count keeps them', mine('global', nextWeek).trophies === me.trophies);
  const d1 = P.leaderboard('daily').filter(r => r.rival).map(r => r.trophies).join();
  check('a rival\'s daily haul holds for the day', d1 === P.leaderboard('daily').filter(r => r.rival).map(r => r.trophies).join());
  for (const s of P.LEADERBOARD_SCOPES) {
    const lb = P.leaderboard(s);
    check(`${s} is sorted by trophies`, lb.every((r, i) => i === 0 || lb[i - 1].trophies >= r.trophies));
  }
  // 27 Sep 2026 is a Sunday; the Wednesday after is in its week.
  check('the week starts on Sunday', P.weekKey(new Date(2026, 8, 30, 12).getTime()) === '2026-09-27');
}

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall profile checks passed');
