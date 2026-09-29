/* MEDAL BANK — shared medal deposit / withdrawal store for the medal games.
 *
 * All games live on the same origin, so one localStorage key holds every
 * user's bank account on this device. Moving an account to another device
 * is done with a transfer code (引き継ぎコード) encrypted with the user's
 * 3-digit password — no server involved.
 *
 * Each game keeps its own "hand" (credit) as before; this module only moves
 * medals between that hand and the bank, and draws the settings-panel UI.
 */
(() => {
'use strict';

const KEY = 'medal-bank-v1';
const LOG_MAX = 500;
const EXPORT_LOG_MAX = 80;   // keeps transfer codes small enough for a QR code
const CODE_PREFIX = 'MB1.';

const GAMES = {
  piccadilly: { name: 'ピカデリーサーカス', short: 'ピカデリー', en: 'Piccadilly', url: 'piccadilly-circus.html', service: 100 },
  sigma:      { name: 'シグマポーカー',     short: 'シグマ',     en: 'Sigma',      url: 'sigma-poker.html',       service: 100 },
  janken:     { name: 'じゃんけんポップ',   short: 'じゃんけん', en: 'Janken',     url: 'janken-pop.html',        service: 10  },
};
const JANKEN_CARDS = [
  ['usa', '🐰', 'ウサピョン'], ['neko', '🐱', 'ネコマル'], ['inu', '🐶', 'ワンタ'],
  ['hiyo', '🐤', 'ピヨコ'], ['kaeru', '🐸', 'ケロスケ'], ['pen', '🐧', 'ペンタ'],
  ['kitsu', '🦊', 'コンキチ'], ['panda', '🐼', 'パンダン'], ['tako', '🐙', 'タコハチ'],
  ['uni', '🦄', 'ユニコーン'], ['dora', '🐉', 'ドラゴン'], ['king', '👑', 'ジャンケンキング'],
].map(([id, em, nm]) => ({ id, em, nm }));

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
const NOTE_EN = { 'スペシャル': 'special day', '手持ちへ': 'to hand', '手動調整': 'manual adjustment', '切り替え時': 'on user switch', '引き継ぎで受け取り': 'received by transfer' };
const noteText = note => (lang() === 'en' && NOTE_EN[note]) || note;
const typeName = type => t(TYPE_NAME[type], TYPE_EN[type]);
const gameName = g => GAMES[g] ? t(GAMES[g].short, GAMES[g].en) : t('バンク', 'Bank');
class BankError extends Error {}
const fail = msg => { throw new BankError(msg); };

// ---------------- storage ----------------
function blank() { return { v: 1, current: null, users: {}, service: {} }; }
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

// ---------------- public: users ----------------
function publicUser(u) {
  return u && { id: u.id, name: u.name, balance: u.balance, created: u.created, moved: !!u.movedAt, movedAt: u.movedAt || null };
}
function current() { return publicUser(activeUser(read())); }
function users() {
  return Object.values(read().users).sort((a, b) => a.created - b.created).map(publicUser);
}
function createUser(name, pin) {
  name = cleanName(name);
  if (!name) fail(t('名前を入れてください', 'Enter a name'));
  if (!validPin(pin)) fail(t('パスワードは数字3桁です', 'The password is 3 digits'));
  return tx(db => {
    if (Object.values(db.users).some(u => u.name === name && !u.movedAt)) fail(t('その名前はもう使われています', 'That name is already taken'));
    const id = rid();
    db.users[id] = { id, name, pinHash: pinHash(id, pin), balance: 0, log: [], cards: {}, created: Date.now() };
    db.current = id;
    return publicUser(db.users[id]);
  });
}
function login(id, pin) {
  return tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (u.movedAt) fail(t('このユーザーは別の端末へ引き継ぎ済みです', 'This user has been moved to another device'));
    if (u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
    db.current = id;
    return publicUser(u);
  });
}
function logout() { tx(db => { db.current = null; }); }
function checkPin(id, pin) {
  const u = read().users[id];
  return !!u && u.pinHash === pinHash(id, pin);
}
function renameUser(id, pin, name) {
  name = cleanName(name);
  if (!name) fail(t('名前を入れてください', 'Enter a name'));
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
    if (Object.values(db.users).some(o => o.id !== id && o.name === name && !o.movedAt)) fail(t('その名前はもう使われています', 'That name is already taken'));
    u.name = name;
  });
}
function changePin(id, oldPin, newPin) {
  if (!validPin(newPin)) fail(t('パスワードは数字3桁です', 'The password is 3 digits'));
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (u.pinHash !== pinHash(id, oldPin)) fail(t('パスワードがちがいます', 'Wrong password'));
    u.pinHash = pinHash(id, newPin);
  });
}
function deleteUser(id, pin) {
  tx(db => {
    const u = db.users[id] || fail(t('ユーザーが見つかりません', 'User not found'));
    if (!u.movedAt && u.pinHash !== pinHash(id, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
    delete db.users[id];
    if (db.current === id) db.current = null;
  });
}

// ---------------- public: medals ----------------
function deposit(game, n, note = '') {
  n = toInt(n);
  if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
  return tx(db => {
    const u = needUser(db);
    u.balance += n;
    pushLog(u, { type: 'deposit', game, n, note });
    return u.balance;
  });
}
function withdraw(game, n, note = '') {
  n = toInt(n);
  if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
  return tx(db => {
    const u = needUser(db);
    if (n > u.balance) fail(t(`残高が足りません（残高 ${u.balance} 枚）`, `Not enough in the bank (balance ${u.balance})`));
    u.balance -= n;
    pushLog(u, { type: 'withdraw', game, n, note });
    return u.balance;
  });
}
// Free service medals: once per game per day on this device, whoever is
// logged in (so making extra users can't farm them). A special code lifts
// the limit for the rest of the day it is entered.
const SPECIAL_CODE = '1bou87ribcx';   // hash of the code, not the code itself
function specialDay() { return read().freeDay === today(); }
function useSpecialCode(code) {
  if (hash(String(code || '').trim().toUpperCase(), 5) !== SPECIAL_CODE) fail(t('コードがちがいます', 'Wrong code'));
  tx(db => { db.freeDay = today(); });
}
function endSpecial() { tx(db => { delete db.freeDay; }); }
function serviceAvailable(game) {
  const db = read();
  return db.freeDay === today() || db.service[game] !== today();
}
function claimService(game) {
  const n = GAMES[game].service;
  return tx(db => {
    const u = activeUser(db);
    const special = db.freeDay === today();
    if (!special && db.service[game] === today()) fail(t('サービスメダルは1日1回です。また明日！', 'Service medals are once a day. See you tomorrow!'));
    db.service[game] = today();
    if (u) pushLog(u, { type: 'service', game, n, note: special ? 'スペシャル' : '手持ちへ' });
    return n;
  });
}

// ---------------- public: log editing ----------------
function log(id) {
  const db = read(), u = db.users[id || db.current];
  return u ? u.log.map(e => ({ ...e })) : [];
}
function editLog(entryId, { n, note, type } = {}) {
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
function deleteLog(entryId) {
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
function addAdjust(n, note = '') {
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
// opts: { game, getHand(), setHand(n), canMove() -> true | '理由' }
function mountPanel(el, opts) {
  const g = GAMES[opts.game];
  el.classList.add('mb-panel');
  let mode = 'main';   // main | login | create
  let loginId = null;
  let flash = '';

  const say = (msg, ok = false) => { flash = `<p class="mb-flash ${ok ? 'ok' : 'ng'}">${esc(msg)}</p>`; draw(); };
  const guard = fn => (...a) => { try { fn(...a); } catch (e) { if (e instanceof BankError) say(e.message); else throw e; } };
  const movable = () => { const r = opts.canMove ? opts.canMove() : true; return r === true ? null : r; };

  function draw() {
    const u = current(), hand = opts.getHand();
    const svc = serviceAvailable(opts.game), special = specialDay();
    let h = `<div class="mb-head"><span class="mb-logo">MEDAL BANK</span><span class="mb-links"><button class="mb-link" data-a="lang">${t('English', '日本語')}</button><a class="mb-link" href="game-center.html">🏠 Game Centre</a><a class="mb-link" href="medal-bank.html">${t('バンクを開く ›', 'Open bank ›')}</a></span></div>`;
    const pinBox = `<input class="mb-pin" type="password" inputmode="numeric" maxlength="3" placeholder="${t('パスワード3桁', '3-digit password')}" data-f="pin">`;
    if (mode === 'login') {
      const list = users().filter(x => !x.moved);
      h += `<div class="mb-box"><b>${t('ユーザーをえらぶ', 'Choose a user')}</b><div class="mb-users">${
        list.map(x => `<button class="mb-chip${x.id === loginId ? ' on' : ''}" data-uid="${x.id}">${esc(x.name)}</button>`).join('') || `<span class="mb-dim">${t('まだユーザーがいません', 'No users yet')}</span>`
      }</div>${loginId ? `<div class="mb-line">${pinBox}<button class="mb-btn" data-a="doLogin">${t('ログイン', 'Log in')}</button></div>` : ''}
      <div class="mb-line"><button class="mb-btn sub" data-a="toCreate">${t('新しく作る', 'New user')}</button><button class="mb-btn sub" data-a="back">${t('もどる', 'Back')}</button></div></div>`;
    } else if (mode === 'create') {
      h += `<div class="mb-box"><b>${t('ユーザー作成', 'New user')}</b>
      <div class="mb-line"><input type="text" maxlength="12" placeholder="${t('なまえ', 'Name')}" data-f="name"></div>
      <div class="mb-line">${pinBox}<button class="mb-btn" data-a="doCreate">${t('作成', 'Create')}</button></div>
      <div class="mb-line"><button class="mb-btn sub" data-a="back">${t('もどる', 'Back')}</button></div></div>`;
    } else {
      h += `<div class="mb-user">${u ? `👤 <b>${esc(u.name)}</b>` : t('👤 ゲスト', '👤 Guest')}<button class="mb-mini" data-a="toLogin">${u ? t('切り替え', 'Switch') : t('ログイン', 'Log in')}</button>${u ? `<button class="mb-mini" data-a="logout">${t('ログアウト', 'Log out')}</button>` : ''}</div>`;
      if (u) {
        const num = f => `<input type="number" min="1" inputmode="numeric" placeholder="${t('枚数', 'Medals')}" data-f="${f}">`;
        h += `<div class="mb-meters"><div>${t('手持ち', 'In hand')}<output>${hand}</output></div><div>${t('バンク残高', 'In bank')}<output>${u.balance}</output></div></div>
        <div class="mb-line">${num('n')}<button class="mb-btn sub" data-a="allIn">${t('全部', 'All')}</button><button class="mb-btn" data-a="dep">${t('預ける', 'Deposit')}</button></div>
        <div class="mb-line">${num('w')}<button class="mb-btn sub" data-a="allOut">${t('全部', 'All')}</button><button class="mb-btn" data-a="wd">${t('引き出す', 'Withdraw')}</button></div>`;
      } else {
        h += `<p class="mb-dim">${t('ログインすると、手持ちメダルを預けたり、別の日に引き出したりできます。', 'Log in to deposit your medals and withdraw them another day.')}</p>`;
      }
      const label = special ? t(`サービスメダル +${g.service}（きょうは何回でも！）`, `Service medals +${g.service} (unlimited today!)`)
        : svc ? t(`サービスメダル +${g.service}（1日1回）`, `Service medals +${g.service} (once a day)`)
        : t('サービスメダルは受け取り済み（また明日）', 'Service medals already taken (come back tomorrow)');
      h += `<div class="mb-line"><button class="mb-btn svc" data-a="svc" ${svc ? '' : 'disabled'}>${label}</button></div>`;
    }
    el.innerHTML = h + flash;
    flash = '';
  }

  const field = f => el.querySelector(`[data-f="${f}"]`);
  const actions = {
    lang() { setLang(lang() === 'en' ? 'ja' : 'en'); },
    toLogin() { mode = 'login'; loginId = current()?.id || null; },
    toCreate() { mode = 'create'; },
    back() { mode = 'main'; },
    logout() { offerDeposit(); logout(); },
    doLogin() {
      const cur = current();
      const pin = field('pin').value;
      if (cur && cur.id !== loginId) {
        if (!checkPin(loginId, pin)) fail(t('パスワードがちがいます', 'Wrong password'));
        offerDeposit();
      }
      const u = login(loginId, pin); mode = 'main'; say(t(`${u.name} さん、ようこそ！`, `Welcome, ${u.name}!`), true);
      return true;
    },
    doCreate() {
      if (current()) offerDeposit();
      const u = createUser(field('name').value, field('pin').value);
      mode = 'main'; say(t(`${u.name} さんを作成しました`, `Created ${u.name}`), true); return true;
    },
    allIn() { field('n').value = opts.getHand(); return 'keep'; },
    allOut() { field('w').value = current()?.balance || 0; return 'keep'; },
    dep() {
      const why = movable(); if (why) fail(why);
      const n = toInt(field('n').value);
      if (!(n > 0)) fail(t('枚数を入れてください', 'Enter a number of medals'));
      if (n > opts.getHand()) fail(t(`手持ちが足りません（手持ち ${opts.getHand()} 枚）`, `Not enough in hand (${opts.getHand()} in hand)`));
      deposit(opts.game, n);
      opts.setHand(opts.getHand() - n);
      say(t(`${n} 枚 預けました`, `Deposited ${n}`), true); return true;
    },
    wd() {
      const why = movable(); if (why) fail(why);
      const n = toInt(field('w').value);
      withdraw(opts.game, n);
      opts.setHand(opts.getHand() + n);
      say(t(`${n} 枚 引き出しました`, `Withdrew ${n}`), true); return true;
    },
    svc() {
      const why = movable(); if (why) fail(why);
      const n = claimService(opts.game);
      opts.setHand(opts.getHand() + n);
      say(t(`サービスメダル ${n} 枚！`, `${n} service medals!`), true); return true;
    },
  };
  // Leaving a user with medals still in hand: offer to bank them first.
  function offerDeposit() {
    const u = current(), hand = opts.getHand();
    if (!u || hand <= 0 || movable()) return;
    if (confirm(t(`手持ち ${hand} 枚を「${u.name}」のバンクに預けてから切り替えますか？\n（キャンセルすると手持ちのまま残ります）`,
      `Deposit the ${hand} medals in hand to ${u.name}'s bank before switching?\n(Cancel keeps them in hand)`))) {
      deposit(opts.game, hand, '切り替え時');
      opts.setHand(0);
    }
  }

  el.addEventListener('click', guard(e => {
    const chip = e.target.closest('[data-uid]');
    if (chip) { loginId = chip.dataset.uid; draw(); el.querySelector('[data-f="pin"]')?.focus(); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const r = actions[b.dataset.a]();
    if (r === 'keep') return;
    if (r !== true) draw();
  }));
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const btn = e.target.closest('.mb-line')?.querySelector('.mb-btn:not(.sub)');
    if (btn) { e.preventDefault(); btn.click(); }
  });
  listeners.add(() => { if (!el.contains(document.activeElement)) draw(); });
  draw();
  return { refresh: draw };
}

// ---------------- styles ----------------
const css = `
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
if (!document.getElementById('mb-style')) {
  const s = document.createElement('style');
  s.id = 'mb-style'; s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}

window.MedalBank = {
  GAMES, JANKEN_CARDS, TYPE_NAME, EFFECT, BankError,
  lang, setLang, t, typeName, gameName, noteText,
  current, users, createUser, login, logout, checkPin, renameUser, changePin, deleteUser,
  deposit, withdraw, serviceAvailable, claimService, specialDay, useSpecialCode, endSpecial,
  log, editLog, deleteLog, addAdjust,
  getCards, setCards,
  exportUser, cancelExport, pendingCode, importCode, transferUrl,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  mountBadge, mountPanel, esc, today,
};
})();
