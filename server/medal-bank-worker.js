/* MEDAL BANK server — a Cloudflare Worker that keeps each user's bank
 * balance and deposit/withdrawal history, so the same name + 3-digit
 * password works on any device. Medals in hand stay on each device.
 *
 * Setup: see server/SETUP.md. Needs one KV namespace bound as `DB`.
 * Optional variable ALLOWED_ORIGIN (comma-separated) limits which sites may
 * call it; it defaults to the GitHub Pages site.
 *
 * Every call is POST /api with JSON { op, ... }. Logged-in calls send
 * "Authorization: Bearer <token>".
 *
 * KV keys:
 *   u:<id>    user record { id, name, salt, pinHash, balance, log[], ops[], created }
 *   n:<name>  name (lower-cased) → id
 *   t:<token> token → id (expires after 180 days)
 *   f:<name>  failed log-ins { n, until }
 */

const DEFAULT_ORIGIN = 'https://aohaus.github.io';
const LOG_MAX = 500;
const OPS_MAX = 50;            // recent request ids, so a retried request isn't applied twice
const TOKEN_TTL = 60 * 60 * 24 * 180;
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;
const EFFECT = { deposit: 1, withdraw: -1, adjust: 1, service: 0 };

class ApiError extends Error {
  constructor(code, status = 400, extra = {}) { super(code); this.code = code; this.status = status; this.extra = extra; }
}
const bad = (code, status, extra) => { throw new ApiError(code, status, extra); };

function corsHeaders(req, env) {
  const allowed = (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',').map(s => s.trim());
  const origin = req.headers.get('Origin') || '';
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomId = (bytes = 12) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
async function hashPin(salt, pin) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}
const cleanName = s => String(s || '').trim().slice(0, 12);
const nameKey = name => 'n:' + cleanName(name).toLowerCase();
const validPin = pin => /^\d{3}$/.test(String(pin));
const toInt = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : NaN; };

async function getUser(env, id) { return id ? JSON.parse(await env.DB.get('u:' + id) || 'null') : null; }
async function putUser(env, u) { await env.DB.put('u:' + u.id, JSON.stringify(u)); }
const view = u => ({ id: u.id, name: u.name, balance: u.balance, log: u.log });

function pushLog(u, entry) {
  u.log.push({ id: randomId(4), t: Date.now(), note: '', ...entry, bal: u.balance });
  if (u.log.length > LOG_MAX) u.log.splice(0, u.log.length - LOG_MAX);
}
function baseOf(u) {
  const first = u.log[0];
  return first ? first.bal - EFFECT[first.type] * first.n : u.balance;
}
function recompute(u, base) {
  let bal = base;
  for (const e of u.log) { bal += EFFECT[e.type] * e.n; e.bal = bal; }
  return bal;
}

async function issueToken(env, id) {
  const token = randomId(24);
  await env.DB.put('t:' + token, id, { expirationTtl: TOKEN_TTL });
  return token;
}
async function checkPin(env, u, pin) {
  const fk = 'f:' + u.id;
  const f = JSON.parse(await env.DB.get(fk) || 'null') || { n: 0, until: 0 };
  if (f.until > Date.now()) bad('locked', 429, { retryAfter: Math.ceil((f.until - Date.now()) / 1000) });
  if (u.pinHash === await hashPin(u.salt, pin)) {
    if (f.n) await env.DB.delete(fk);
    return;
  }
  f.n += 1;
  if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_SECONDS * 1000; f.n = 0; }
  await env.DB.put(fk, JSON.stringify(f), { expirationTtl: 60 * 60 * 24 });
  bad('wrong_pin', 401, { left: f.until > Date.now() ? 0 : MAX_FAILS - f.n });
}

// ---------------- operations ----------------
const OPEN = {
  // Create a user. `balance` and `log` let an existing device account move up to the server.
  async register(env, b) {
    const name = cleanName(b.name);
    if (!name) bad('name_required');
    if (!validPin(b.pin)) bad('bad_pin');
    if (await env.DB.get(nameKey(name))) bad('name_taken', 409);
    const id = randomId(8), salt = randomId(8);
    const balance = Math.max(0, toInt(b.balance) || 0);
    const u = { id, name, salt, pinHash: await hashPin(salt, b.pin), balance, log: [], ops: [], created: Date.now() };
    if (Array.isArray(b.log)) {
      u.log = b.log.slice(-LOG_MAX).filter(e => e && e.type in EFFECT && Number.isFinite(e.n))
        .map(e => ({ id: String(e.id || randomId(4)).slice(0, 16), t: Number(e.t) || Date.now(), type: e.type, game: String(e.game || 'bank').slice(0, 16), n: Math.max(0, toInt(e.n)), note: String(e.note || '').slice(0, 40), bal: toInt(e.bal) || 0 }));
      if (u.log.length) recompute(u, balance - u.log.reduce((s, e) => s + EFFECT[e.type] * e.n, 0));
    }
    await putUser(env, u);
    await env.DB.put(nameKey(name), id);
    return { token: await issueToken(env, id), user: view(u) };
  },
  async login(env, b) {
    const id = await env.DB.get(nameKey(b.name));
    const u = await getUser(env, id);
    if (!u) bad('no_user', 404);
    await checkPin(env, u, b.pin);
    return { token: await issueToken(env, u.id), user: view(u) };
  },
};

const AUTHED = {
  async me(env, b, u) { return { user: view(u) }; },
  async logout(env, b, u, token) { await env.DB.delete('t:' + token); return { ok: true }; },
  async deposit(env, b, u) {
    const n = toInt(b.n);
    if (!(n > 0)) bad('bad_amount');
    u.balance += n;
    pushLog(u, { type: 'deposit', game: 'bank', n, note: String(b.note || '').slice(0, 40) });
    return 'save';
  },
  async withdraw(env, b, u) {
    const n = toInt(b.n);
    if (!(n > 0)) bad('bad_amount');
    if (n > u.balance) bad('not_enough', 400, { balance: u.balance });
    u.balance -= n;
    pushLog(u, { type: 'withdraw', game: 'bank', n, note: String(b.note || '').slice(0, 40) });
    return 'save';
  },
  async service(env, b, u) {   // record only: service medals go to the device's hand
    const n = toInt(b.n);
    if (!(n > 0)) bad('bad_amount');
    pushLog(u, { type: 'service', game: 'bank', n, note: String(b.note || '').slice(0, 40) });
    return 'save';
  },
  async adjust(env, b, u) {
    const n = toInt(b.n);
    if (!n) bad('bad_amount');
    if (u.balance + n < 0) bad('negative');
    u.balance += n;
    pushLog(u, { type: 'adjust', game: 'bank', n, note: String(b.note || '').slice(0, 40) || '手動調整' });
    return 'save';
  },
  async edit(env, b, u) {
    const e = u.log.find(x => x.id === b.entry) || bad('no_entry', 404);
    const before = { ...e }, base = baseOf(u);
    if (b.n !== undefined) { const n = toInt(b.n); if (!(n >= 0)) bad('bad_amount'); e.n = n; }
    if (b.note !== undefined) e.note = String(b.note).slice(0, 40);
    if (b.type !== undefined) { if (!(b.type in EFFECT)) bad('bad_type'); e.type = b.type; }
    const bal = recompute(u, base);
    if (bal < 0 || u.log.some(x => x.bal < 0)) { Object.assign(e, before); recompute(u, base); bad('negative'); }
    e.edited = Date.now();
    u.balance = bal;
    return 'save';
  },
  async remove_entry(env, b, u) {
    const i = u.log.findIndex(x => x.id === b.entry);
    if (i < 0) bad('no_entry', 404);
    const base = baseOf(u);
    const [removed] = u.log.splice(i, 1);
    const bal = recompute(u, base);
    if (bal < 0 || u.log.some(x => x.bal < 0)) { u.log.splice(i, 0, removed); recompute(u, base); bad('negative'); }
    u.balance = bal;
    return 'save';
  },
  async rename(env, b, u) {
    await checkPin(env, u, b.pin);
    const name = cleanName(b.name);
    if (!name) bad('name_required');
    if (nameKey(name) !== nameKey(u.name)) {
      if (await env.DB.get(nameKey(name))) bad('name_taken', 409);
      await env.DB.put(nameKey(name), u.id);
      await env.DB.delete(nameKey(u.name));
    }
    u.name = name;
    return 'save';
  },
  async repin(env, b, u) {
    await checkPin(env, u, b.pin);
    if (!validPin(b.newPin)) bad('bad_pin');
    u.salt = randomId(8);
    u.pinHash = await hashPin(u.salt, b.newPin);
    return 'save';
  },
  async delete_user(env, b, u, token) {
    await checkPin(env, u, b.pin);
    await env.DB.delete('u:' + u.id);
    await env.DB.delete(nameKey(u.name));
    await env.DB.delete('t:' + token);
    return { ok: true };
  },
};

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'medal-bank' }, 200, cors);
    if (req.method !== 'POST' || url.pathname !== '/api') return json({ error: 'not_found' }, 404, cors);
    if (!env.DB) return json({ error: 'no_kv_binding' }, 500, cors);
    try {
      const b = await req.json().catch(() => ({}));
      if (OPEN[b.op]) return json(await OPEN[b.op](env, b), 200, cors);
      if (!AUTHED[b.op]) bad('unknown_op', 404);
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const u = await getUser(env, token && await env.DB.get('t:' + token));
      if (!u) bad('auth', 401);
      u.ops = u.ops || [];
      if (b.rid && u.ops.includes(b.rid)) return json({ user: view(u), repeat: true }, 200, cors);
      const out = await AUTHED[b.op](env, b, u, token);
      if (out !== 'save') return json(out, 200, cors);
      if (b.rid) { u.ops.push(String(b.rid).slice(0, 24)); if (u.ops.length > OPS_MAX) u.ops.splice(0, u.ops.length - OPS_MAX); }
      await putUser(env, u);
      return json({ user: view(u) }, 200, cors);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, ...e.extra }, e.status, cors);
      return json({ error: 'server', detail: String(e && e.message || e) }, 500, cors);
    }
  },
};
