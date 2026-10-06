/* MEDAL BANK — shared medal deposit / withdrawal store for the medal games.
 *
 * All games live on the same origin, so one localStorage key holds every
 * user's bank account on this device. Moving an account to another device
 * is done with a transfer code (引き継ぎコード) encrypted with the user's
 * 3-digit password — no server involved.
 *
 * Medals in hand live in one cup per user (plus a guest cup), shared by every
 * game: a game's CREDIT is the cup. Deposits, withdrawals and the daily
 * service medals happen only at the MEDAL BANK machine.
 */
(() => {
'use strict';

const KEY = 'medal-bank-v1';
// Where the site's top-level pages live (medal-bank.js sits next to them), so
// links work from pages in subfolders too (e.g. geo-slot/).
const BASE = (() => { try { return new URL('.', document.currentScript.src).href; } catch (e) { return ''; } })();
const LOG_MAX = 500;
const EXPORT_LOG_MAX = 80;   // keeps transfer codes small enough for a QR code
const CODE_PREFIX = 'MB1.';
const SERVICE_MEDALS = 100;   // handed out at the bank once a day
// Where each game kept its own credit before the shared cup (moved into the cup once).
const OLD_HANDS = [['piccadilly-circus-v1', 'credit'], ['sigma-poker-v1', 'credit'], ['janken-pop-v1', 'medals']];

const GAMES = {
  piccadilly: { name: 'ピカデリーサーカス', short: 'ピカデリー', en: 'Piccadilly', url: 'piccadilly-circus.html' },
  sigma:      { name: 'シグマポーカー',     short: 'シグマ',     en: 'Sigma',      url: 'sigma-poker.html' },
  janken:     { name: 'じゃんけんポップ',   short: 'じゃんけん', en: 'Janken',     url: 'janken-pop.html' },
  geo:        { name: 'ジオスロット',       short: 'ジオスロット', en: 'Geo Slot', url: 'geo-slot/' },
};
const JANKEN_CARDS = [
  ['usa', '🐰', 'ウサピョン', 'Hoppy Bunny'], ['neko', '🐱', 'ネコマル', 'Kitty Maru'], ['inu', '🐶', 'ワンタ', 'Wanta Pup'],
  ['hiyo', '🐤', 'ピヨコ', 'Piyo Chick'], ['kaeru', '🐸', 'ケロスケ', 'Kero Frog'], ['pen', '🐧', 'ペンタ', 'Penta Penguin'],
  ['kitsu', '🦊', 'コンキチ', 'Konkichi Fox'], ['panda', '🐼', 'パンダン', 'Pandan Panda'], ['tako', '🐙', 'タコハチ', 'Takohachi Octopus'],
  ['uni', '🦄', 'ユニコーン', 'Unicorn'], ['dora', '🐉', 'ドラゴン', 'Dragon'], ['king', '👑', 'ジャンケンキング', 'Janken King'],
].map(([id, em, nm, en]) => ({ id, em, nm, en }));

// How each log entry type moves the bank balance.
const EFFECT = { deposit: 1, withdraw: -1, adjust: 1, service: 0 };
const TYPE_NAME = { deposit: '預け入れ', withdraw: '引き出し', adjust: '調整', service: 'サービス' };
const TYPE_EN = { deposit: 'Deposit', withdraw: 'Withdraw', adjust: 'Adjust', service: 'Service' };

// ---------------- helpers ----------------
function hash(str, seed = 0) {   // cyrb53
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const pinHash = (id, pin) => hash(`${id}:${pin}`, 77);
const validPin = pin => /^\d{3}$/.test(String(pin));
const cleanName = name => String(name || '').trim().slice(0, 12);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const toInt = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : NaN; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Language: one setting shared by every page (日本語 / English).
const LANG_KEY = 'gc-lang';
function lang() {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'ja' || v === 'en') return v; } catch (e) {}
  return /^ja/i.test(navigator.language || '') ? 'ja' : 'en';
}
function setLang(v) {
  try { localStorage.setItem(LANG_KEY, v); } catch (e) {}
  document.documentElement.lang = v;
  emit();
}
const t = (ja, en) => lang() === 'en' ? en : ja;
// Notes written into the log are stored in Japanese; show them in English when asked.
const NOTE_EN = { 'スペシャル': 'special day', '手持ちへ': 'to hand', '手動調整': 'manual adjustment', '切り替え時': 'on user switch', '引き継ぎで受け取り': 'received by transfer', '端末から移行': 'moved up from this device', 'テスト': 'test' };
const noteText = note => (lang() === 'en' && NOTE_EN[note]) || note;
const typeName = type => t(TYPE_NAME[type], TYPE_EN[type]);
const gameName = g => GAMES[g] ? t(GAMES[g].short, GAMES[g].en) : t('バンク', 'Bank');
class BankError extends Error {}
const fail = msg => { throw new BankError(msg); };

// ---------------- storage ----------------
function blank() { return { v: 1, current: null, users: {}, service: {}, guestHand: 0 }; }
function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.v === 1 && raw.users) return { ...blank(), ...raw };
  } catch (e) {}
  return blank();
}
function write(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { fail(t('保存できませんでした（ストレージがいっぱいか、無効です）', 'Could not save (storage is full or disabled)')); }
  emit();
}
// Every operation re-reads storage first so two open tabs never clobber each other.
function tx(fn) { const db = read(); const out = fn(db); write(db); return out; }

const listeners = new Set();
function emit() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
window.addEventListener('storage', e => { if (e.key === KEY) emit(); });

function activeUser(db) {
  const u = db.users[db.current];
  return u && !u.movedAt ? u : null;
}
function needUser(db) { return activeUser(db) || fail(t('ログインしてください', 'Please log in')); }

function pushLog(u, entry) {
  u.log.push({ id: rid(6), t: Date.now(), note: '', ...entry, bal: u.balance });
  if (u.log.length > LOG_MAX) u.log.splice(0, u.log.length - LOG_MAX);
}
// Balance before the oldest kept entry (older entries may have been trimmed).
function baseOf(u) {
  const first = u.log[0];
  return first ? first.bal - EFFECT[first.type] * first.n : u.balance;
}
// Running balances are re-derived after an edit so the log always adds up.
function recompute(u, base) {
  let bal = base;
  for (const e of u.log) { bal += EFFECT[e.type] * e.n; e.bal = bal; }
  return bal;
}

// ---------------- the cup (medals in hand) ----------------
function cupOf(db) { const u = activeUser(db); return u ? (u.hand || 0) : (db.guestHand || 0); }
function setCupOf(db, n) { const u = activeUser(db); if (u) u.hand = n; else db.guestHand = n; }
// Logging in picks up whatever the guest cup was holding.
function takeGuestCup(db, u) {
  if (db.guestHand > 0) { u.hand = (u.hand || 0) + db.guestHand; db.guestHand = 0; }
}
function hand() { return cupOf(read()); }
function setHand(n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  const db = read();
  if (cupOf(db) === n) return n;
  setCupOf(db, n); write(db);
  return n;
}
// One-time move of each game's old separate credit into the cup.
function migrateHands() {
  const db = read();
  if (db.cupV) return;
  let total = 0;
  for (const [key, field] of OLD_HANDS) {
    try {
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      if (s && Number.isFinite(s[field]) && s[field] > 0) {
        total += Math.floor(s[field]);
        s[field] = 0;
        localStorage.setItem(key, JSON.stringify(s));
      }
    } catch (e) {}
  }
  setCupOf(db, cupOf(db) + total);
  db.cupV = 1;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
}

// ---------------- public: users ----------------
function publicUser(u) {
  return u && { id: u.id, name: u.name, balance: u.balance, hand: u.hand || 0, created: u.created, moved: !!u.movedAt, movedAt: u.movedAt || null };
}
function current() { return publicUser(activeUser(read())); }
function users() {
  return Object.values(read().users).sort((a, b) => a.created - b.created).map(publicUser);
}
function localCreateUser(name, pin) {
  name = cleanName(name);
  if (!name) fail(t('名前を入れてください', 'Enter a name'));
  if (!validPin(pin)) fail(t('パスワードは数字3桁です', 'The password is 3 digits'));
  return tx(db => {
    if (Object.values(db.users).some(u => u.name === name && !u.movedAt)) fail(t('その名前はもう使われています', 'That name is already taken'));
    const id = rid();
    db.users[id] = { id, name, pinHash: pinHash(id, pin), balance: 0, hand: 0, log: [], cards: {}, created: Date.now() };
    db.current = id;
    takeGuestCup(db, db.users[id]);
    return publicUser(db.users[id]);
  });
}
function localLogin(id, pin) {
  return tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (u.movedAt) fail(t('このユーザーは別の端末へ引き継ぎ済みです', 'This user has been moved to another device'));
    if (u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
    db.current = id;
    takeGuestCup(db, u);
    return publicUser(u);
  });
}
function localLogout() { tx(db => { db.current = null; }); }
function checkPin(id, pin) {
  const u = read().users[id];
  return !!u && u.pinHash === pinHash(id, pin);
}
function localRenameUser(id, pin, name) {
  name = cleanName(name);
  if (!name) fail(t('名前を入れてください', 'Enter a name'));
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
    if (Object.values(db.users).some(o => o.id !== id && o.name === name && !o.movedAt)) fail(t('その名前はもう使われています', 'That name is already taken'));
    u.name = name;
  });
}
function localChangePin(id, oldPin, newPin) {
  if (!validPin(newPin)) fail(t('パスワードは数字3桁です', 'The password is 3 digits'));
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (u.pinHash !== pinHash(id, oldPin)) fail(t('パスワードがちがいます', 'Wrong password'));
    u.pinHash = pinHash(id, newPin);
  });
}
function localDeleteUser(id, pin) {
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (!u.movedAt && u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
    delete db.users[id];
    if (db.current === id) db.current = null;
  });
}

// ---------------- public: medals (cup ⇄ bank) ----------------
function localDeposit(n, note = '') {
  n = toInt(n);
  if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
  return tx(db => {
    const u = needUser(db);
    if (n > (u.hand || 0)) fail(t(`手持ちが足りません（手持ち ${u.hand || 0} 枚）`, `Not enough in hand (${u.hand || 0} in hand)`));
    u.hand -= n;
    u.balance += n;
    pushLog(u, { type: 'deposit', game: 'bank', n, note });
    return u.balance;
  });
}
function localWithdraw(n, note = '') {
  n = toInt(n);
  if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
  return tx(db => {
    const u = needUser(db);
    if (n > u.balance) fail(t(`残高が足りません（残高 ${u.balance} 枚）`, `Not enough in the bank (balance ${u.balance})`));
    u.balance -= n;
    u.hand = (u.hand || 0) + n;
    pushLog(u, { type: 'withdraw', game: 'bank', n, note });
    return u.balance;
  });
}
// Free service medals: once a day at the bank on this device, whoever is
// logged in (so making extra users can't farm them). A special code lifts
// the limit for the rest of the day it is entered.
const SPECIAL_CODE = '1bou87ribcx';   // hash of the code, not the code itself
function specialDay() { return read().freeDay === today(); }
function useSpecialCode(code) {
  if (hash(String(code || '').trim().toUpperCase(), 5) !== SPECIAL_CODE) fail(t('コードがちがいます', 'Wrong code'));
  tx(db => { db.freeDay = today(); });
}
function endSpecial() { tx(db => { delete db.freeDay; }); }
function serviceAvailable() {
  const db = read();
  return db.freeDay === today() || db.service.bank !== today();
}
function localClaimService() {
  const n = SERVICE_MEDALS;
  return tx(db => {
    const u = activeUser(db);
    const special = db.freeDay === today();
    if (!special && db.service.bank === today()) fail(t('サービスメダルは1日1回です。また明日！', 'Service medals are once a day. See you tomorrow!'));
    db.service.bank = today();
    setCupOf(db, cupOf(db) + n);
    if (u) pushLog(u, { type: 'service', game: 'bank', n, note: special ? 'スペシャル' : '手持ちへ' });
    return n;
  });
}

// ---------------- public: log editing ----------------
function log(id) {
  const db = read(), u = db.users[id || db.current];
  return u ? u.log.map(e => ({ ...e })) : [];
}
function localEditLog(entryId, { n, note, type } = {}) {
  return tx(db => {
    const u = needUser(db);
    const e = u.log.find(x => x.id === entryId) || fail(t('記録が見つかりません', 'Record not found'));
    const before = { ...e }, base = baseOf(u);
    if (n !== undefined) { n = toInt(n); if (!(n >= 0)) fail(t('枚数が正しくありません', 'Invalid number')); e.n = n; }
    if (note !== undefined) e.note = String(note).slice(0, 40);
    if (type !== undefined) { if (!(type in EFFECT)) fail(t('種類が正しくありません', 'Invalid type')); e.type = type; }
    const bal = recompute(u, base);
    if (bal < 0 || u.log.some(x => x.bal < 0)) { Object.assign(e, before); recompute(u, base); fail(t('残高がマイナスになるため変更できません', 'That would make the balance negative')); }
    e.edited = Date.now();
    u.balance = bal;
    return u.balance;
  });
}
function localDeleteLog(entryId) {
  return tx(db => {
    const u = needUser(db);
    const i = u.log.findIndex(x => x.id === entryId);
    if (i < 0) fail(t('記録が見つかりません', 'Record not found'));
    const base = baseOf(u);
    const [removed] = u.log.splice(i, 1);
    const bal = recompute(u, base);
    if (bal < 0 || u.log.some(x => x.bal < 0)) { u.log.splice(i, 0, removed); recompute(u, base); fail(t('残高がマイナスになるため削除できません', 'Deleting that would make the balance negative')); }
    u.balance = bal;
    return u.balance;
  });
}
function localAddAdjust(n, note = '') {
  n = toInt(n);
  if (!n) fail(t('枚数を入れてください（マイナスも可）', 'Enter a number (negative is OK)'));
  return tx(db => {
    const u = needUser(db);
    if (u.balance + n < 0) fail(t('残高がマイナスになります', 'That would make the balance negative'));
    u.balance += n;
    pushLog(u, { type: 'adjust', game: 'bank', n, note: note || '手動調整' });
    return u.balance;
  });
}

// ---------------- public: cards (janken) ----------------
function getCards(game) {
  const u = activeUser(read());
  return u ? { ...((u.cards || {})[game] || {}) } : null;
}
function setCards(game, cards) {
  tx(db => {
    const u = needUser(db);
    u.cards = u.cards || {};
    u.cards[game] = { ...cards };
  });
}

// ---------------- transfer codes ----------------
function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
// xorshift keystream seeded from the password + salt.
function xorWith(bytes, pin, salt) {
  let x = parseInt(hash(`${pin}|${salt}`, 9).slice(0, 8), 36) >>> 0 || 1;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = bytes[i] ^ (x & 255);
  }
  return out;
}
const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function encode(obj, pin) {
  let bytes = new TextEncoder().encode(JSON.stringify(obj));
  let zipped = 0;
  if (canZip) { try { bytes = await pipe(bytes, new CompressionStream('deflate-raw')); zipped = 1; } catch (e) {} }
  const salt = rid(4);
  return CODE_PREFIX + salt + zipped + b64u(xorWith(bytes, pin, salt));
}
async function decode(code, pin) {
  code = String(code || '').trim();
  const m = code.match(/[#&?]t=([^&]+)/);   // accept a whole transfer URL too
  if (m) code = decodeURIComponent(m[1]);
  code = code.replace(/\s+/g, '');
  if (!code.startsWith(CODE_PREFIX)) fail(t('引き継ぎコードの形式がちがいます', 'That is not a transfer code'));
  const salt = code.slice(4, 8), zipped = code[8] === '1';
  let bytes;
  try { bytes = xorWith(unb64u(code.slice(9)), pin, salt); } catch (e) { fail(t('引き継ぎコードが壊れています', 'The transfer code is broken')); }
  try {
    if (zipped) {
      if (!canZip) fail(t('このブラウザでは読み込めません。ブラウザを更新してください', 'This browser cannot read it. Please update your browser'));
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e instanceof BankError) throw e;
    fail(t('パスワードがちがうか、コードが壊れています', 'Wrong password, or the code is broken'));
  }
}

// Issuing a code moves the account out: it is locked on this device so the
// same medals can't be spent in two places.
async function exportUser(id, pin) {
  const db = read(), u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
  if (u.movedAt) fail(t('このユーザーはもう引き継ぎ済みです', 'This user has already been moved'));
  if (u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
  const payload = {
    k: 'medal-bank', v: 1, at: Date.now(),
    user: { ...u, log: u.log.slice(-EXPORT_LOG_MAX) },
  };
  const code = await encode(payload, pin);
  tx(d => {
    const x = d.users[id];
    x.movedAt = Date.now();
    x.moveCode = code;
    if (d.current === id) d.current = null;
  });
  return code;
}
function cancelExport(id) {
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    delete u.movedAt; delete u.moveCode;
  });
}
function pendingCode(id) { const u = read().users[id]; return (u && u.moveCode) || null; }

async function importCode(code, pin) {
  if (!validPin(pin)) fail(t('パスワードは数字3桁です', 'The password is 3 digits'));
  const data = await decode(code, pin);
  if (!data || data.k !== 'medal-bank' || !data.user) fail(t('引き継ぎコードではありません', 'That is not a transfer code'));
  const inc = data.user;
  if (inc.pinHash !== pinHash(inc.id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
  return tx(db => {
    const old = db.users[inc.id];
    if (old && !old.movedAt && (old.importedAt || 0) >= data.at) fail(t('このコードはもう読み込み済みです', 'This code has already been used'));
    if (old && !old.movedAt && old.balance !== inc.balance && !confirm(
      t(`この端末の「${old.name}」（残高 ${old.balance} 枚）を、コードの内容（残高 ${inc.balance} 枚）で上書きします。よろしいですか？`,
        `Replace "${old.name}" on this device (balance ${old.balance}) with the code's data (balance ${inc.balance})?`))) fail(t('キャンセルしました', 'Cancelled'));
    let name = inc.name;
    for (let i = 2; Object.values(db.users).some(o => o.id !== inc.id && o.name === name && !o.movedAt); i++) name = `${inc.name}(${i})`;
    const u = { ...inc, name, importedAt: data.at };
    delete u.movedAt; delete u.moveCode;
    pushLog(u, { type: 'adjust', game: 'bank', n: 0, note: '引き継ぎで受け取り' });
    db.users[u.id] = u;
    db.current = u.id;
    return publicUser(u);
  });
}
function transferUrl(code) {
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  return `${base}medal-bank.html#t=${code}`;
}

// ---------------- server (shared bank across devices) ----------------
// With a server address set, each user's bank balance and history live on the
// MEDAL BANK server (server/medal-bank-worker.js): the same name + password
// works on any device. Medals in hand, cards and service medals stay on the
// device. Without an address everything stays on this device as before.
const SERVER_URL = 'https://medal-bank.aohaus.workers.dev';
// localStorage 'mb-server' overrides the address for testing ('off' = device-only mode).
const server = () => {
  let v = null;
  try { v = localStorage.getItem('mb-server'); } catch (e) {}
  return v === 'off' ? '' : (v || SERVER_URL);
};
const online = () => !!server();

const API_MSG = {
  name_required: () => t('名前を入れてください', 'Enter a name'),
  bad_pin: () => t('パスワードは数字3桁です', 'The password is 3 digits'),
  name_taken: () => t('その名前はもう使われています', 'That name is already taken'),
  no_user: () => t('その名前のユーザーはいません', 'No user with that name'),
  wrong_pin: d => t(`パスワードがちがいます（あと${d.left}回まちがえると15分ロック）`, `Wrong password (${d.left} more tries before a 15-minute lock)`),
  locked: d => t(`まちがいが続いたのでロック中です。${Math.ceil(d.retryAfter / 60)}分後に試してね`, `Locked after too many tries. Try again in ${Math.ceil(d.retryAfter / 60)} min`),
  not_enough: d => t(`残高が足りません（残高 ${d.balance} 枚）`, `Not enough in the bank (balance ${d.balance})`),
  negative: () => t('残高がマイナスになるため変更できません', 'That would make the balance negative'),
  bad_amount: () => t('枚数が正しくありません', 'Invalid number'),
  no_entry: () => t('記録が見つかりません', 'Record not found'),
  auth: () => t('もう一度ログインしてください', 'Please log in again'),
};
async function api(op, body = {}, token) {
  let res, data;
  try {
    res = await fetch(server().replace(/\/$/, '') + '/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ op, ...body }),
    });
    data = await res.json();
  } catch (e) {
    fail(t('オフラインのため使えません。ネットにつながってから試してね', 'Offline — try again when you\'re connected'));
  }
  if (res.ok) return data;
  if (data.error === 'auth') tx(db => { const u = activeUser(db); if (u) { delete u.token; db.current = null; } });
  fail((API_MSG[data.error] || (() => t('サーバーでエラーが起きました', 'Server error')))(data));
}
// Copy the server's view of a user into the local record (balance and history are the server's).
function applyServer(db, u, su, token) {
  u.sid = su.id; u.name = su.name; u.balance = su.balance; u.log = su.log;
  if (token) u.token = token;
  delete u.pinHash;
}
function localRecord(db, su) {
  let u = Object.values(db.users).find(x => x.sid === su.id);
  if (!u) { const id = rid(); u = db.users[id] = { id, name: su.name, balance: 0, hand: 0, log: [], cards: {}, created: Date.now() }; }
  return u;
}
async function authed(op, body = {}) {
  const u = activeUser(read()) || fail(t('ログインしてください', 'Please log in'));
  if (!u.token) { tx(db => { db.current = null; }); fail(t('もう一度ログインしてください', 'Please log in again')); }
  const out = await api(op, { rid: rid(10), ...body }, u.token);
  if (out.user) tx(db => { const x = db.users[u.id]; if (x) applyServer(db, x, out.user); });
  return out;
}

// ---------------- public API (async: works for both modes) ----------------
async function createUser(name, pin) {
  if (!online()) return localCreateUser(name, pin);
  if (!cleanName(name)) fail(t('名前を入れてください', 'Enter a name'));
  if (!validPin(pin)) fail(t('パスワードは数字3桁です', 'The password is 3 digits'));
  const out = await api('register', { name: cleanName(name), pin });
  return tx(db => {
    const u = localRecord(db, out.user);
    applyServer(db, u, out.user, out.token);
    db.current = u.id; takeGuestCup(db, u);
    return publicUser(u);
  });
}
// Log in a user listed on this device. A device-only user moves up to the server here.
async function login(id, pin) {
  if (!online()) return localLogin(id, pin);
  const u = read().users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
  if (u.sid) return loginByName(u.name, pin);
  if (u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
  let out;
  try {
    out = await api('register', { name: u.name, pin, balance: u.balance, log: u.log });
  } catch (e) {
    // Same name already on the server (e.g. moved up from another device): join it, bringing this balance along.
    if (!(e instanceof BankError) || !/使われて|taken/.test(e.message)) throw e;
    out = await api('login', { name: u.name, pin });
    if (u.balance > 0) out = { ...out, ...(await api('adjust', { n: u.balance, note: '端末から移行', rid: rid(10) }, out.token)) };
  }
  return tx(db => {
    const x = db.users[id];
    applyServer(db, x, out.user, out.token);
    db.current = id; takeGuestCup(db, x);
    return publicUser(x);
  });
}
async function loginByName(name, pin) {
  const out = await api('login', { name: cleanName(name), pin });
  return tx(db => {
    const u = localRecord(db, out.user);
    applyServer(db, u, out.user, out.token);
    db.current = u.id; takeGuestCup(db, u);
    return publicUser(u);
  });
}
async function logout() {
  const u = activeUser(read());
  if (online() && u && u.token) api('logout', {}, u.token).catch(() => {});
  tx(db => { const x = activeUser(db); if (x && online()) delete x.token; db.current = null; });
}
// Fetch the latest balance/history (another device may have changed it). Quiet when offline.
async function refresh() {
  const u = activeUser(read());
  // A user who hasn't moved up to the server yet (no token) stays logged in on
  // this device; they'll be asked for their password when they next use the bank.
  if (!online() || !u || !u.token) return;
  try { await authed('me'); } catch (e) {}
}
async function renameUser(id, pin, name) {
  if (!online()) return localRenameUser(id, pin, name);
  await authed('rename', { pin, name: cleanName(name) });
}
async function changePin(id, oldPin, newPin) {
  if (!online()) return localChangePin(id, oldPin, newPin);
  await authed('repin', { pin: oldPin, newPin });
}
async function deleteUser(id, pin) {
  const u = read().users[id];
  if (online() && u && u.sid && !u.movedAt) {
    if (!u.token) fail(t('もう一度ログインしてください', 'Please log in again'));
    await api('delete_user', { pin }, u.token);
    return tx(db => { delete db.users[id]; if (db.current === id) db.current = null; });
  }
  return localDeleteUser(id, pin);
}
async function deposit(n, note = '') {
  if (!online()) return localDeposit(n, note);
  n = toInt(n);
  if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
  const cup = hand();
  if (n > cup) fail(t(`手持ちが足りません（手持ち ${cup} 枚）`, `Not enough in hand (${cup} in hand)`));
  await authed('deposit', { n, note });
  tx(db => setCupOf(db, Math.max(0, cupOf(db) - n)));
  return current().balance;
}
async function withdraw(n, note = '') {
  if (!online()) return localWithdraw(n, note);
  n = toInt(n);
  if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
  await authed('withdraw', { n, note });
  tx(db => setCupOf(db, cupOf(db) + n));
  return current().balance;
}
function claimService() {
  const n = localClaimService();
  // The history lives on the server; recording the service medals there is best-effort.
  if (online() && activeUser(read())) authed('service', { n, note: specialDay() ? 'スペシャル' : '手持ちへ' }).catch(() => {});
  return n;
}
async function editLog(entryId, change = {}) {
  if (!online()) return localEditLog(entryId, change);
  await authed('edit', { entry: entryId, ...change });
}
async function deleteLog(entryId) {
  if (!online()) return localDeleteLog(entryId);
  await authed('remove_entry', { entry: entryId });
}
async function addAdjust(n, note = '') {
  if (!online()) return localAddAdjust(n, note);
  n = toInt(n);
  if (!n) fail(t('枚数を入れてください（マイナスも可）', 'Enter a number (negative is OK)'));
  await authed('adjust', { n, note });
}

// ---------------- admin: difficulty settings ----------------
// Only ADMIN_NAME sees the settings. With the server on, that name is unique
// and password-protected, so it must be a server account. Settings are kept
// on this device; 3 is the standard, 5 the most generous to players.
const ADMIN_NAME = 'はやと';
const LEVEL_KEY = 'gc-settings';
const LEVEL_GAMES = ['piccadilly', 'sigma', 'janken', 'geo'];
function isAdmin() {
  const u = activeUser(read());
  return !!u && u.name === ADMIN_NAME && (!online() || !!u.sid);
}
function levels() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LEVEL_KEY) || '{}') || {}; } catch (e) {}
  return Object.fromEntries(LEVEL_GAMES.map(g => [g, [1, 2, 3, 4, 5].includes(s[g]) ? s[g] : 3]));
}
const level = game => levels()[game] || 3;
function setLevel(game, n) {
  if (!isAdmin()) fail(t('管理者だけが変更できます', 'Only the admin can change this'));
  if (!LEVEL_GAMES.includes(game) || ![1, 2, 3, 4, 5].includes(n)) fail(t('設定が正しくありません', 'Invalid setting'));
  const s = levels(); s[game] = n;
  try { localStorage.setItem(LEVEL_KEY, JSON.stringify(s)); } catch (e) {}
  emit();
}
window.addEventListener('storage', e => { if (e.key === LEVEL_KEY) emit(); });

// ---------------- UI: shared navigation bar ----------------
// A slim bar across the top of every game: Game Centre, the games, the bank.
// Pages that size themselves to the screen subtract var(--gc-nav-h).
const NAV_GAMES = [
  ['piccadilly', '🎡', 'piccadilly-circus.html', 'ピカデリー', 'Piccadilly'],
  ['sigma', '🃏', 'sigma-poker.html', 'シグマ', 'Sigma'],
  ['janken', '✊', 'janken-pop.html', 'じゃんけん', 'Janken'],
  ['geo', '🌏', 'geo-slot/', 'ジオ', 'Geo'],
];
function mountNav(currentGame) {
  if (document.querySelector('.gc-nav')) return;
  const nav = document.createElement('nav');
  nav.className = 'gc-nav';
  nav.setAttribute('aria-label', 'Game Centre');
  const draw = () => {
    const u = current();
    nav.innerHTML = `<a class="gc-home" href="${BASE}game-center.html" aria-label="Game Centre">🏠 <span>Game Centre</span></a>
      <span class="gc-games">${NAV_GAMES.map(([id, icon, url, ja, en]) =>
        `<a href="${BASE}${url}" class="${id === currentGame ? 'on' : ''}" title="${t(ja, en)}" aria-label="${t(ja, en)}"${id === currentGame ? ' aria-current="page"' : ''}>${icon}<small>${t(ja, en)}</small></a>`).join('')}</span>
      <a class="gc-bank" href="${BASE}medal-bank.html" title="MEDAL BANK" aria-label="MEDAL BANK">🏦<small>${u ? esc(u.name) : t('バンク', 'Bank')}</small></a>`;
  };
  draw();
  listeners.add(draw);
  document.body.prepend(nav);
  document.documentElement.classList.add('has-gc-nav');
}

// ---------------- UI: name badge ----------------
function mountBadge(el) {
  el.classList.add('mb-badge');
  const draw = () => {
    const u = current();
    el.textContent = u ? `👤 ${u.name}` : t('👤 ゲスト', '👤 Guest');
    el.classList.toggle('guest', !u);
  };
  draw();
  listeners.add(draw);
}

// ---------------- UI: settings panel ----------------
// Shows who is playing and the cup; banking itself happens at the MEDAL BANK machine.
// opts: { game }
function mountPanel(el) {
  el.classList.add('mb-panel');
  function draw() {
    const u = current(), cup = hand();
    let h = `<div class="mb-head"><span class="mb-logo">MEDAL BANK</span><span class="mb-links"><button class="mb-link" data-a="lang">${t('English', '日本語')}</button><a class="mb-link" href="game-center.html">🏠 Game Centre</a></span></div>`;
    h += `<div class="mb-user">${u ? `👤 <b>${esc(u.name)}</b>` : t('👤 ゲスト', '👤 Guest')}</div>`;
    h += `<div class="mb-meters"><div>${t('手持ち', 'In hand')}<output>${cup}</output></div>${u ? `<div>${t('バンク残高', 'In bank')}<output>${u.balance}</output></div>` : ''}</div>`;
    h += `<p class="mb-dim">${t('手持ちメダルは全部のゲームで共通です。預け入れ・引き出し・サービスメダル・ログインはメダルバンクで。',
      'Medals in hand are shared by every game. Deposit, withdraw, service medals and log-in are at the MEDAL BANK.')}</p>`;
    h += `<div class="mb-line"><a class="mb-btn go" href="medal-bank.html">${t('🏦 メダルバンクへ行く', '🏦 Go to the MEDAL BANK')}</a></div>`;
    el.innerHTML = h;
  }
  el.addEventListener('click', e => {
    if (e.target.closest('[data-a="lang"]')) setLang(lang() === 'en' ? 'ja' : 'en');
  });
  listeners.add(draw);
  draw();
  return { refresh: draw };
}

// ---------------- styles ----------------
const css = `
:root { --gc-nav-h: 0px; }
:root.has-gc-nav { --gc-nav-h: calc(44px + env(safe-area-inset-top, 0px)); }
:root.has-gc-nav body { padding-top: var(--gc-nav-h) !important; }
.gc-nav { position: fixed; left: 0; right: 0; top: 0; z-index: 60; height: var(--gc-nav-h);
  padding: env(safe-area-inset-top, 0px) max(8px, env(safe-area-inset-right, 0px)) 0 max(8px, env(safe-area-inset-left, 0px));
  display: flex; align-items: center; gap: 6px; box-sizing: border-box;
  background: rgba(8, 5, 18, .88); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid #ff4fa3; box-shadow: 0 0 12px rgba(255,79,163,.35);
  font: 800 13px/1 'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', system-ui, sans-serif; color: #fff; }
.gc-nav a { color: inherit; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 4px;
  height: 34px; border-radius: 10px; white-space: nowrap; }
.gc-nav a:active { transform: translateY(1px); }
.gc-home { padding: 0 10px; background: linear-gradient(#3a1d63, #1d1038); border: 1px solid #ff4fa3; color: #ffe4f2 !important;
  text-shadow: 0 0 6px #ff4fa3; flex: 0 0 auto; }
.gc-games { flex: 1 1 auto; display: flex; justify-content: center; gap: 6px; min-width: 0; }
.gc-games a, .gc-bank { flex-direction: column; gap: 1px; min-width: 40px; padding: 0 6px; font-size: 18px; }
.gc-nav small { font-size: 9px; font-weight: 800; opacity: .85; max-width: 56px; overflow: hidden; text-overflow: ellipsis; }
.gc-games a.on { background: rgba(255,79,163,.25); box-shadow: inset 0 0 0 1px #ff4fa3; }
.gc-bank { flex: 0 0 auto; background: rgba(255,177,59,.15); box-shadow: inset 0 0 0 1px rgba(255,177,59,.6); }
@media (max-width: 380px) { .gc-home span { display: none; } .gc-games a { padding: 0 3px; min-width: 36px; } }
.mb-badge { display: inline-block; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: .1em .7em; border-radius: 99px; background: rgba(0,0,0,.45); color: #fff; font-weight: 800; line-height: 1.5;
  letter-spacing: 0; pointer-events: none; }
.mb-badge.guest { opacity: .7; }
.mb-panel { --mb-accent: #e8471f; margin: 12px 0 4px; padding: 10px 12px 12px; border-radius: 12px;
  border: 2px solid var(--mb-accent); background: rgba(127,127,127,.1); text-align: left; font-size: 14px; line-height: 1.45; }
.mb-panel input, .mb-panel button { font: inherit; }
.mb-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 6px; }
.mb-logo { font-family: 'Arial Black', Arial, sans-serif; font-style: italic; font-weight: 900; font-size: 16px; letter-spacing: .06em;
  color: #ffd21a; -webkit-text-stroke: 1px #3a2a00; paint-order: stroke fill; white-space: nowrap; }
.mb-links { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.mb-link { color: inherit; font-size: 12px; opacity: .8; white-space: nowrap; text-decoration: underline; background: none; border: 0; padding: 0; cursor: pointer; }
.mb-user { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.mb-user b { font-size: 16px; }
.mb-mini { border: 1px solid currentColor; background: none; color: inherit; border-radius: 99px; padding: 1px 10px; font-size: 12px; cursor: pointer; }
.mb-meters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }
.mb-meters div { font-size: 12px; text-align: center; }
.mb-meters output { display: block; margin-top: 2px; background: #000; color: #ffb13b; border-radius: 6px; padding: 1px 8px;
  font: 700 18px/1.3 'Courier New', monospace; text-align: right; }
.mb-line { display: flex; gap: 6px; margin-top: 6px; }
.mb-line input { flex: 1 1 auto; min-width: 0; padding: 7px 9px; border-radius: 8px; border: 1px solid rgba(127,127,127,.6);
  background: #fff; color: #111; font-size: 16px; }
.mb-pin { letter-spacing: .3em; }
.mb-btn { flex: 0 0 auto; border: 0; border-radius: 8px; padding: 7px 12px; cursor: pointer; font-weight: 900;
  background: var(--mb-accent); color: #fff; }
.mb-btn.sub { background: rgba(127,127,127,.35); color: inherit; }
.mb-btn.svc { flex: 1 1 auto; background: linear-gradient(#ffe36b, #f0b400); color: #5a3400; }
.mb-btn.go { flex: 1 1 auto; text-align: center; text-decoration: none; padding: 10px 12px; }
.mb-btn:disabled { opacity: .45; cursor: default; }
.mb-box b { display: block; margin-bottom: 4px; }
.mb-users { display: flex; flex-wrap: wrap; gap: 6px; }
.mb-chip { border: 2px solid rgba(127,127,127,.5); background: none; color: inherit; border-radius: 99px; padding: 3px 12px; cursor: pointer; }
.mb-chip.on { border-color: var(--mb-accent); background: var(--mb-accent); color: #fff; }
.mb-dim { opacity: .75; font-size: 12.5px; }
.mb-flash { margin-top: 8px; padding: 5px 9px; border-radius: 8px; font-size: 13px; }
.mb-flash.ok { background: #17a45a; color: #fff; }
.mb-flash.ng { background: #d8141c; color: #fff; }
`;
document.documentElement.lang = lang();
migrateHands();
if (!document.getElementById('mb-style')) {
  const s = document.createElement('style');
  s.id = 'mb-style'; s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}

window.MedalBank = {
  GAMES, JANKEN_CARDS, TYPE_NAME, EFFECT, BankError,
  lang, setLang, t, typeName, gameName, noteText,
  current, users, createUser, login, logout, checkPin, renameUser, changePin, deleteUser,
  hand, setHand, SERVICE_MEDALS, online, refresh, loginByName, mountNav,
  ADMIN_NAME, isAdmin, level, levels, setLevel,
  deposit, withdraw, serviceAvailable, claimService, specialDay, useSpecialCode, endSpecial,
  log, editLog, deleteLog, addAdjust,
  getCards, setCards,
  exportUser, cancelExport, pendingCode, importCode, transferUrl,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  mountBadge, mountPanel, esc, today,
};
})();
