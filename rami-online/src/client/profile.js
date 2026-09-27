// ═══════════════════════════════════════════════════════
// PROFILE — the player's account and wallet (DEMO)
// There is no account server yet: every profile — guest, username
// and password, or the pretend Google sign-in — lives in this
// browser's localStorage, and so do the coins, XP and trophies.
// Clearing the site's data wipes them. The functions below are the
// shape a real account API would have, so the screens won't need to
// change when one exists.
// ═══════════════════════════════════════════════════════

import {
  START_COINS, STORE_PACKS, AD_REWARD, AD_DAILY, AD_SECONDS,
} from '../economy.js';

const KEY = 'mantel_demo_accounts';

// ── Storage ──────────────────────────────────────────
// Guarded like every other store in the app: a browser that blocks storage
// still gets a working (if forgetful) session from the in-memory copy.
let db = null;
function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db || typeof db !== 'object' || !db.users) db = { users: {}, current: null };
  return db;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage blocked */ }
  for (const fn of listeners) fn(current());
}

const listeners = new Set();
// Called with the current profile (or null) after every change.
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Test hook: forget the cached copy so the next read goes back to storage.
export function _reset() { db = null; listeners.clear(); }

export function current() {
  const d = load();
  return (d.current && d.users[d.current]) || null;
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
         `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function blank(fields) {
  return {
    id: newId(), provider: 'guest', username: null, email: null,
    passHash: null, salt: null, displayName: 'שחקן',
    coins: START_COINS, xp: 0, trophies: 0, games: 0, wins: 0,
    createdAt: Date.now(),
    done: [],      // gameIds already settled — a reload must not pay twice
    pending: {},   // gameId → coins paid (fee + buys) for a game still under way
    buys: {},      // gameId → how many paid buys have been charged so far
    ads: { day: '', count: 0 },
    // Trophies won today and this week, for the daily and weekly tables.
    // Each counter starts over when its day or week does.
    period: { day: '', dayTrophies: 0, week: '', weekTrophies: 0 },
    ...fields,
  };
}

function signIn(user) {
  const d = load();
  d.users[user.id] = user;
  d.current = user.id;
  save();
  return user;
}

function update(fn) {
  const u = current();
  if (!u) return null;
  fn(u);
  save();
  return u;
}

// ── Passwords ────────────────────────────────────────
// Hashed even in the demo, so a password typed here never sits in storage
// as plain text.
async function hash(salt, password) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const norm = s => String(s || '').trim().toLowerCase();
function findBy(field, value) {
  return Object.values(load().users).find(u => u[field] && norm(u[field]) === norm(value)) || null;
}

function cleanName(name, fallback) {
  const n = String(name || '').trim().slice(0, 16);
  return n || fallback;
}

// A username is what the player types to sign in: letters, digits, _ . -
export function usernameProblem(username) {
  const u = String(username || '').trim();
  if (u.length < 3) return 'שם המשתמש צריך לפחות 3 תווים';
  if (u.length > 16) return 'שם המשתמש ארוך מדי (עד 16 תווים)';
  if (!/^[\p{L}\p{N}_.-]+$/u.test(u)) return 'שם המשתמש יכול להכיל רק אותיות, ספרות ו־_ . -';
  return null;
}
export function passwordProblem(password) {
  return String(password || '').length < 4 ? 'הסיסמה צריכה לפחות 4 תווים' : null;
}

// ── Signing in ───────────────────────────────────────
// Each returns { user } or { error } — never throws for a user mistake.

export function loginGuest() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return { user: signIn(blank({ provider: 'guest', displayName: `אורח ${n}` })) };
}

export async function register(username, password, displayName) {
  const why = usernameProblem(username) || passwordProblem(password);
  if (why) return { error: why };
  if (findBy('username', username)) return { error: 'שם המשתמש הזה כבר תפוס' };
  const salt = newId();
  const user = blank({
    provider: 'password', username: username.trim(), salt,
    passHash: await hash(salt, password),
    displayName: cleanName(displayName, username.trim()),
  });
  return { user: signIn(user) };
}

export async function login(username, password) {
  const u = findBy('username', username);
  if (!u || !u.passHash || (await hash(u.salt, password)) !== u.passHash)
    return { error: 'שם משתמש או סיסמה שגויים' };
  return { user: signIn(u) };
}

// Pretend Google: whoever types an address "signs in" with it. The same
// address always comes back to the same profile.
export function loginGoogleDemo(name, email) {
  const e = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'כתובת המייל לא תקינה' };
  const found = findBy('email', e);
  if (found) return { user: signIn(found) };
  return { user: signIn(blank({ provider: 'google', email: e, displayName: cleanName(name, e.split('@')[0]) })) };
}

// Turn the guest profile the player is on into a real one, keeping
// everything it has earned.
export async function upgradeGuest(username, password) {
  const u = current();
  if (!u) return { error: 'אין משתמש מחובר' };
  if (u.provider !== 'guest') return { error: 'החשבון כבר שמור' };
  const why = usernameProblem(username) || passwordProblem(password);
  if (why) return { error: why };
  if (findBy('username', username)) return { error: 'שם המשתמש הזה כבר תפוס' };
  const salt = newId();
  const passHash = await hash(salt, password);
  return { user: update(x => { Object.assign(x, { provider: 'password', username: username.trim(), salt, passHash }); }) };
}

export function logout() {
  load().current = null;
  save();
}

export function rename(name) {
  return update(u => { u.displayName = cleanName(name, u.displayName); });
}

// ── Games ────────────────────────────────────────────
// Pay the entry fee for a game that just started. Once per game, however
// many times the state arrives (a reload re-sends it). False when the
// wallet can't cover it.
export function chargeEntry(gameId, fee) {
  const u = current();
  if (!u || !gameId) return false;
  if (u.pending[gameId] != null || u.done.includes(gameId)) return true;
  if (u.coins < fee) return false;
  update(x => { x.coins -= fee; x.pending[gameId] = fee; });
  return true;
}

// Pay for buys with a penalty card: `count` is this seat's total for the
// game so far, and only the ones not charged yet are taken. The server counts
// them, so a reload or a repeated state never charges twice. The coins join
// what's held for the game, so a room that closes early hands them back.
export function chargeBuys(gameId, count, price) {
  const u = current();
  if (!u || !gameId || !price || u.done.includes(gameId)) return 0;
  const already = (u.buys || {})[gameId] || 0;
  const fresh = Math.max(0, (count || 0) - already);
  if (!fresh) return 0;
  const cost = fresh * price;
  update(x => {
    x.buys = { ...(x.buys || {}), [gameId]: already + fresh };
    x.coins = Math.max(0, x.coins - cost);
    x.pending[gameId] = (x.pending[gameId] || 0) + cost;
  });
  return cost;
}

// Credit a finished game: this seat's { place, prize, xp, trophies }.
// Idempotent on gameId, like the charge.
export function applyGameResult(gameId, r) {
  const u = current();
  if (!u || !gameId || !r || u.done.includes(gameId)) return false;
  update(x => {
    x.coins += r.prize;
    x.xp += r.xp;
    x.trophies = Math.max(0, x.trophies + r.trophies);
    x.period = countPeriod(x.period, r.trophies);
    x.games += 1;
    if (r.place === 1) x.wins += 1;
    delete x.pending[gameId];
    if (x.buys) delete x.buys[gameId];
    x.done = [...x.done, gameId].slice(-50);
  });
  return true;
}

// Walking out of a game under way: the fee stays in the pot.
export function forfeit(gameId) {
  const u = current();
  if (!u || !gameId || u.pending[gameId] == null) return;
  update(x => { delete x.pending[gameId]; x.done = [...x.done, gameId].slice(-50); });
}

// The room closed before the game ended (everyone went quiet, or left):
// every fee still held for an unfinished game comes back.
export function refundPending() {
  const u = current();
  if (!u || !Object.keys(u.pending).length) return 0;
  let back = 0;
  update(x => {
    for (const [id, fee] of Object.entries(x.pending)) { back += fee; x.done = [...x.done, id].slice(-50); }
    x.coins += back;
    x.pending = {};
  });
  return back;
}

// ── Store and ads (demo) ─────────────────────────────
export function buyPack(packId) {
  const pack = STORE_PACKS.find(p => p.id === packId);
  if (!pack || !current()) return null;
  update(u => { u.coins += pack.coins; });
  return pack.coins;
}

const today = () => new Date().toISOString().slice(0, 10);
export function adsLeft() {
  const u = current();
  if (!u) return 0;
  return u.ads.day === today() ? Math.max(0, AD_DAILY - u.ads.count) : AD_DAILY;
}
// `startedAt` is when the ad began: a claim before it has run its full
// length is refused.
export function claimAd(startedAt, now = Date.now()) {
  if (!current() || adsLeft() <= 0) return 0;
  if (now - startedAt < AD_SECONDS * 1000 - 250) return 0;
  update(u => {
    if (u.ads.day !== today()) u.ads = { day: today(), count: 0 };
    u.ads.count += 1;
    u.coins += AD_REWARD;
  });
  return AD_REWARD;
}

// ── Leaderboard (demo) ───────────────────────────────
// Four tables: this browser's profiles on their own (local), those plus a
// handful of made-up rivals by all-time trophies (global), and the trophies
// won this week and today (weekly, daily). The rivals are marked as such.
const RIVALS = [
  ['נועה', 480], ['איתי', 355], ['מאיה', 260], ['יונתן', 190],
  ['שירה', 120], ['עומר', 75], ['תמר', 30],
];
export const LEADERBOARD_SCOPES = ['local', 'global', 'weekly', 'daily'];

// Periods run on the player's own clock. A week starts on Sunday.
const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function dayKey(now = Date.now()) { return dateKey(new Date(now)); }
export function weekKey(now = Date.now()) {
  const d = new Date(now);
  d.setDate(d.getDate() - d.getDay());
  return dateKey(d);
}

// Add a game's trophies to the day's and the week's count, starting either
// over when its period has turned.
function countPeriod(p, trophies, now = Date.now()) {
  const day = dayKey(now), week = weekKey(now);
  const cur = p || {};
  return {
    day, dayTrophies: (cur.day === day ? cur.dayTrophies : 0) + trophies,
    week, weekTrophies: (cur.week === week ? cur.weekTrophies : 0) + trophies,
  };
}

// A profile's trophies in a period — zero once that period is over.
function periodTrophies(u, scope, now) {
  const p = u.period;
  if (!p) return 0;
  if (scope === 'daily') return p.day === dayKey(now) ? p.dayTrophies : 0;
  return p.week === weekKey(now) ? p.weekTrophies : 0;
}

// A rival's made-up haul for the period: the same all day (or week), and a
// new one the next, scaled to how strong the rival is overall.
function rivalHaul(name, total, key, scale) {
  let h = 0;
  for (const ch of `${name}|${key}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.round((h % 1000) / 1000 * scale * (0.4 + total / 480));
}

export function leaderboard(scope = 'global', now = Date.now()) {
  const me = current();
  const periodic = scope === 'daily' || scope === 'weekly';
  const rows = Object.values(load().users).map(u => ({
    id: u.id, name: u.displayName, xp: u.xp, you: !!me && u.id === me.id,
    trophies: periodic ? periodTrophies(u, scope, now) : u.trophies,
  }));
  if (scope !== 'local') for (const [name, total] of RIVALS) rows.push({
    id: `rival:${name}`, name, xp: total * 60, rival: true,
    trophies: scope === 'daily' ? rivalHaul(name, total, dayKey(now), 30)
            : scope === 'weekly' ? rivalHaul(name, total, weekKey(now), 110)
            : total,
  });
  return rows.sort((a, b) => b.trophies - a.trophies || b.xp - a.xp);
}
