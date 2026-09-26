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
  piccadilly: { name: 'ピカデリーサーカス', short: 'ピカデリー', url: 'piccadilly-circus.html', service: 100 },
  sigma:      { name: 'シグマポーカー',     short: 'シグマ',     url: 'sigma-poker.html',       service: 100 },
  janken:     { name: 'じゃんけんポップ',   short: 'じゃんけん', url: 'janken-pop.html',        service: 10  },
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
  catch (e) { fail('保存できませんでした（ストレージがいっぱいか、無効です）'); }
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
function needUser(db) { return activeUser(db) || fail('ログインしてください'); }

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
  if (!name) fail('名前を入れてください');
  if (!validPin(pin)) fail('パスワードは数字3桁です');
  return tx(db => {
    if (Object.values(db.users).some(u => u.name === name && !u.movedAt)) fail('その名前はもう使われています');
    const id = rid();
    db.users[id] = { id, name, pinHash: pinHash(id, pin), balance: 0, log: [], cards: {}, created: Date.now() };
    db.current = id;
    return publicUser(db.users[id]);
  });
}
function login(id, pin) {
  return tx(db => {
    const u = db.users[id] || fail('ユーザーが見つかりません');
    if (u.movedAt) fail('このユーザーは別の端末へ引き継ぎ済みです');
    if (u.pinHash !== pinHash(id, pin)) fail('パスワードがちがいます');
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
  if (!name) fail('名前を入れてください');
  tx(db => {
    const u = db.users[id] || fail('ユーザーが見つかりません');
    if (u.pinHash !== pinHash(id, pin)) fail('パスワードがちがいます');
    if (Object.values(db.users).some(o => o.id !== id && o.name === name && !o.movedAt)) fail('その名前はもう使われています');
    u.name = name;
  });
}
function changePin(id, oldPin, newPin) {
  if (!validPin(newPin)) fail('パスワードは数字3桁です');
  tx(db => {
    const u = db.users[id] || fail('ユーザーが見つかりません');
    if (u.pinHash !== pinHash(id, oldPin)) fail('パスワードがちがいます');
    u.pinHash = pinHash(id, newPin);
  });
}
function deleteUser(id, pin) {
  tx(db => {
    const u = db.users[id] || fail('ユーザーが見つかりません');
    if (!u.movedAt && u.pinHash !== pinHash(id, pin)) fail('パスワードがちがいます');
    delete db.users[id];
    if (db.current === id) db.current = null;
  });
}

// ---------------- public: medals ----------------
function deposit(game, n, note = '') {
  n = toInt(n);
  if (!(n > 0)) fail('枚数を入れてください');
  return tx(db => {
    const u = needUser(db);
    u.balance += n;
    pushLog(u, { type: 'deposit', game, n, note });
    return u.balance;
  });
}
function withdraw(game, n, note = '') {
  n = toInt(n);
  if (!(n > 0)) fail('枚数を入れてください');
  return tx(db => {
    const u = needUser(db);
    if (n > u.balance) fail(`残高が足りません（残高 ${u.balance} 枚）`);
    u.balance -= n;
    pushLog(u, { type: 'withdraw', game, n, note });
    return u.balance;
  });
}
// Free service medals: once per game per day on this device, whoever is
// logged in (so making extra users can't farm them).
function serviceAvailable(game) {
  return read().service[game] !== today();
}
function claimService(game) {
  const n = GAMES[game].service;
  return tx(db => {
    const u = activeUser(db);
    if (db.service[game] === today()) fail('サービスメダルは1日1回です。また明日！');
    db.service[game] = today();
    if (u) pushLog(u, { type: 'service', game, n, note: '手持ちへ' });
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
    const e = u.log.find(x => x.id === entryId) || fail('記録が見つかりません');
    const before = { ...e }, base = baseOf(u);
    if (n !== undefined) { n = toInt(n); if (!(n >= 0)) fail('枚数が正しくありません'); e.n = n; }
    if (note !== undefined) e.note = String(note).slice(0, 40);
    if (type !== undefined) { if (!(type in EFFECT)) fail('種類が正しくありません'); e.type = type; }
    const bal = recompute(u, base);
    if (bal < 0 || u.log.some(x => x.bal < 0)) { Object.assign(e, before); recompute(u, base); fail('残高がマイナスになるため変更できません'); }
    e.edited = Date.now();
    u.balance = bal;
    return u.balance;
  });
}
function deleteLog(entryId) {
  return tx(db => {
    const u = needUser(db);
    const i = u.log.findIndex(x => x.id === entryId);
    if (i < 0) fail('記録が見つかりません');
    const base = baseOf(u);
    const [removed] = u.log.splice(i, 1);
    const bal = recompute(u, base);
    if (bal < 0 || u.log.some(x => x.bal < 0)) { u.log.splice(i, 0, removed); recompute(u, base); fail('残高がマイナスになるため削除できません'); }
    u.balance = bal;
    return u.balance;
  });
}
function addAdjust(n, note = '') {
  n = toInt(n);
  if (!n) fail('枚数を入れてください（マイナスも可）');
  return tx(db => {
    const u = needUser(db);
    if (u.balance + n < 0) fail('残高がマイナスになります');
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
  if (!code.startsWith(CODE_PREFIX)) fail('引き継ぎコードの形式がちがいます');
  const salt = code.slice(4, 8), zipped = code[8] === '1';
  let bytes;
  try { bytes = xorWith(unb64u(code.slice(9)), pin, salt); } catch (e) { fail('引き継ぎコードが壊れています'); }
  try {
    if (zipped) {
      if (!canZip) fail('このブラウザでは読み込めません。ブラウザを更新してください');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e instanceof BankError) throw e;
    fail('パスワードがちがうか、コードが壊れています');
  }
}

// Issuing a code moves the account out: it is locked on this device so the
// same medals can't be spent in two places.
async function exportUser(id, pin) {
  const db = read(), u = db.users[id] || fail('ユーザーが見つかりません');
  if (u.movedAt) fail('このユーザーはもう引き継ぎ済みです');
  if (u.pinHash !== pinHash(id, pin)) fail('パスワードがちがいます');
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
    const u = db.users[id] || fail('ユーザーが見つかりません');
    delete u.movedAt; delete u.moveCode;
  });
}
function pendingCode(id) { const u = read().users[id]; return (u && u.moveCode) || null; }

async function importCode(code, pin) {
  if (!validPin(pin)) fail('パスワードは数字3桁です');
  const data = await decode(code, pin);
  if (!data || data.k !== 'medal-bank' || !data.user) fail('引き継ぎコードではありません');
  const inc = data.user;
  if (inc.pinHash !== pinHash(inc.id, pin)) fail('パスワードがちがいます');
  return tx(db => {
    const old = db.users[inc.id];
    if (old && !old.movedAt && (old.importedAt || 0) >= data.at) fail('このコードはもう読み込み済みです');
    if (old && !old.movedAt && old.balance !== inc.balance && !confirm(
      `この端末の「${old.name}」（残高 ${old.balance} 枚）を、コードの内容（残高 ${inc.balance} 枚）で上書きします。よろしいですか？`)) fail('キャンセルしました');
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
    el.textContent = u ? `👤 ${u.name}` : '👤 ゲスト';
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
    const svc = serviceAvailable(opts.game);
    let h = `<div class="mb-head"><span class="mb-logo">MEDAL BANK</span><a class="mb-link" href="medal-bank.html">バンクを開く ›</a></div>`;
    if (mode === 'login') {
      const list = users().filter(x => !x.moved);
      h += `<div class="mb-box"><b>ユーザーをえらぶ</b><div class="mb-users">${
        list.map(x => `<button class="mb-chip${x.id === loginId ? ' on' : ''}" data-uid="${x.id}">${esc(x.name)}</button>`).join('') || '<span class="mb-dim">まだユーザーがいません</span>'
      }</div>${loginId ? `<div class="mb-line"><input class="mb-pin" type="password" inputmode="numeric" maxlength="3" placeholder="パスワード3桁" data-f="pin"><button class="mb-btn" data-a="doLogin">ログイン</button></div>` : ''}
      <div class="mb-line"><button class="mb-btn sub" data-a="toCreate">新しく作る</button><button class="mb-btn sub" data-a="back">もどる</button></div></div>`;
    } else if (mode === 'create') {
      h += `<div class="mb-box"><b>ユーザー作成</b>
      <div class="mb-line"><input type="text" maxlength="12" placeholder="なまえ" data-f="name"></div>
      <div class="mb-line"><input class="mb-pin" type="password" inputmode="numeric" maxlength="3" placeholder="パスワード3桁" data-f="pin"><button class="mb-btn" data-a="doCreate">作成</button></div>
      <div class="mb-line"><button class="mb-btn sub" data-a="back">もどる</button></div></div>`;
    } else {
      h += `<div class="mb-user">${u ? `👤 <b>${esc(u.name)}</b>` : '👤 ゲスト'}<button class="mb-mini" data-a="toLogin">${u ? '切り替え' : 'ログイン'}</button>${u ? '<button class="mb-mini" data-a="logout">ログアウト</button>' : ''}</div>`;
      if (u) {
        h += `<div class="mb-meters"><div>手持ち<output>${hand}</output></div><div>バンク残高<output>${u.balance}</output></div></div>
        <div class="mb-line"><input type="number" min="1" inputmode="numeric" placeholder="枚数" data-f="n"><button class="mb-btn sub" data-a="allIn">全部</button><button class="mb-btn" data-a="dep">預ける</button></div>
        <div class="mb-line"><input type="number" min="1" inputmode="numeric" placeholder="枚数" data-f="w"><button class="mb-btn sub" data-a="allOut">全部</button><button class="mb-btn" data-a="wd">引き出す</button></div>`;
      } else {
        h += `<p class="mb-dim">ログインすると、手持ちメダルを預けたり、別の日に引き出したりできます。</p>`;
      }
      h += `<div class="mb-line"><button class="mb-btn svc" data-a="svc" ${svc ? '' : 'disabled'}>${svc ? `サービスメダル +${g.service}（1日1回）` : 'サービスメダルは受け取り済み（また明日）'}</button></div>`;
    }
    el.innerHTML = h + flash;
    flash = '';
  }

  const field = f => el.querySelector(`[data-f="${f}"]`);
  const actions = {
    toLogin() { mode = 'login'; loginId = current()?.id || null; },
    toCreate() { mode = 'create'; },
    back() { mode = 'main'; },
    logout() { offerDeposit(); logout(); },
    doLogin() {
      const cur = current();
      const pin = field('pin').value;
      if (cur && cur.id !== loginId) {
        if (!checkPin(loginId, pin)) fail('パスワードがちがいます');
        offerDeposit();
      }
      const u = login(loginId, pin); mode = 'main'; say(`${u.name} さん、ようこそ！`, true);
      return true;
    },
    doCreate() {
      if (current()) offerDeposit();
      const u = createUser(field('name').value, field('pin').value);
      mode = 'main'; say(`${u.name} さんを作成しました`, true); return true;
    },
    allIn() { field('n').value = opts.getHand(); return 'keep'; },
    allOut() { field('w').value = current()?.balance || 0; return 'keep'; },
    dep() {
      const why = movable(); if (why) fail(why);
      const n = toInt(field('n').value);
      if (!(n > 0)) fail('枚数を入れてください');
      if (n > opts.getHand()) fail(`手持ちが足りません（手持ち ${opts.getHand()} 枚）`);
      deposit(opts.game, n);
      opts.setHand(opts.getHand() - n);
      say(`${n} 枚 預けました`, true); return true;
    },
    wd() {
      const why = movable(); if (why) fail(why);
      const n = toInt(field('w').value);
      withdraw(opts.game, n);
      opts.setHand(opts.getHand() + n);
      say(`${n} 枚 引き出しました`, true); return true;
    },
    svc() {
      const why = movable(); if (why) fail(why);
      const n = claimService(opts.game);
      opts.setHand(opts.getHand() + n);
      say(`サービスメダル ${n} 枚！`, true); return true;
    },
  };
  // Leaving a user with medals still in hand: offer to bank them first.
  function offerDeposit() {
    const u = current(), hand = opts.getHand();
    if (!u || hand <= 0 || movable()) return;
    if (confirm(`手持ち ${hand} 枚を「${u.name}」のバンクに預けてから切り替えますか？\n（キャンセルすると手持ちのまま残ります）`)) {
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
.mb-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.mb-logo { font-family: 'Arial Black', Arial, sans-serif; font-style: italic; font-weight: 900; font-size: 16px; letter-spacing: .06em;
  color: #ffd21a; -webkit-text-stroke: 1px #3a2a00; paint-order: stroke fill; }
.mb-link { color: inherit; font-size: 12px; opacity: .8; }
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
if (!document.getElementById('mb-style')) {
  const s = document.createElement('style');
  s.id = 'mb-style'; s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}

window.MedalBank = {
  GAMES, JANKEN_CARDS, TYPE_NAME, EFFECT, BankError,
  current, users, createUser, login, logout, checkPin, renameUser, changePin, deleteUser,
  deposit, withdraw, serviceAvailable, claimService,
  log, editLog, deleteLog, addAdjust,
  getCards, setCards,
  exportUser, cancelExport, pendingCode, importCode, transferUrl,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  mountBadge, mountPanel, esc, today,
};
})();
