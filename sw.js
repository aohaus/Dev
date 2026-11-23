/* Game Centre offline support (service worker).
 *
 * Keeps a copy of the Game Centre pages and everything they load, so the
 * games open and play with no connection (on a plane, out of Wi-Fi). Medals
 * in hand live on the device, so play carries on as usual offline.
 *
 * - Game pages: network first (always the newest when online), the saved copy
 *   when offline or when the network takes too long.
 * - Their scripts, styles and icons: saved whenever a page is saved, found by
 *   reading the page (so new ?v= versions are picked up by themselves).
 * - Google Fonts: saved the first time they're used.
 * - "Download for offline" (the 📥 button in the Game Centre) saves all of it
 *   at once, every font included, and reports progress (see the message handler).
 * Registered from medal-bank.js, which every Game Centre page loads.
 */
const CACHE = 'game-centre-v1';
const PAGES = [
  'game-center.html', 'medal-bank.html', 'piccadilly-circus.html',
  'sigma-poker.html', 'janken-pop.html', 'geo-slot/index.html',
  'game-center.webmanifest',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_WAIT_MS = 4000;   // a slow network falls back to the saved page after this
const INFO = 'offline-info';  // cache entry recording the last full download

const ROOT = new URL('./', self.location).href;
const PAGE_URLS = PAGES.map(p => new URL(p, ROOT).href);
const INFO_URL = new URL(INFO, ROOT).href;
// The cache key for a page: no query, and a folder means its index.html.
const pageKey = url => { const u = url.origin + url.pathname; return u.endsWith('/') ? u + 'index.html' : u; };
const isPage = url => PAGE_URLS.includes(pageKey(url));

// The files a page or stylesheet refers to (src="…", href="…", url(…)) that are worth keeping.
function refsIn(text, base) {
  const refs = new Set();
  for (const m of text.matchAll(/(?:src|href)=["']([^"'#]+)["']|url\(["']?([^"')]+)["']?\)/g)) {
    const raw = m[1] || m[2];
    if (/\$\{|^data:/.test(raw)) continue;   // template strings in the page's own scripts, inline data
    try {
      const u = new URL(raw.replace(/&amp;/g, '&'), base);
      const sameSite = u.origin === self.location.origin;
      if (!sameSite && !FONT_HOSTS.includes(u.hostname)) continue;   // other sites (e.g. the QR code library) aren't needed offline
      if (!sameSite && u.pathname === '/') continue;                 // <link rel="preconnect"> to the font hosts
      if (sameSite && isPage(u)) continue;                           // pages are saved on their own
      refs.add(u.href);
    } catch (e) {}
  }
  return [...refs];
}

// Save a page, then the files it refers to. `all` also saves every font file
// a font stylesheet lists (the explicit download); otherwise fonts are saved
// as they're used. Returns the files that couldn't be saved.
async function savePage(key, res, all = false, step = () => {}) {
  const cache = await caches.open(CACHE);
  const text = await res.clone().text();
  await cache.put(key, res);
  const refs = refsIn(text, key);
  const keys = await cache.keys();
  const failed = [];
  await pool(refs, async ref => {
    const u = new URL(ref);
    // Drop older ?v= versions of the same file.
    for (const k of keys) { const o = new URL(k.url); if (o.origin + o.pathname === u.origin + u.pathname && o.href !== u.href) cache.delete(k); }
    let hit = await cache.match(ref);
    if (!hit) {
      try { const r = await fetch(ref); if (r.ok) { hit = r.clone(); await cache.put(ref, r); } else failed.push(ref); }
      catch (e) { failed.push(ref); }
    }
    if (all && hit && u.hostname === 'fonts.googleapis.com') {
      const files = refsIn(await hit.text(), ref);
      step(0, files.length);
      await pool(files, async f => {
        if (!(await cache.match(f))) {
          try { const r = await fetch(f); if (r.ok) await cache.put(f, r); else failed.push(f); } catch (e) { failed.push(f); }
        }
        step(1, 0);
      });
    }
  });
  return failed;
}
// Run `fn` over `items`, a few at a time.
async function pool(items, fn, n = 6) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// The explicit download: every page, file and font, fresh from the network.
async function downloadAll(report) {
  let done = 0, total = PAGE_URLS.length;
  const failed = [];
  const step = (d, t) => { done += d; total += t; report({ type: 'progress', done, total }); };
  for (const u of PAGE_URLS) {
    try {
      const res = await fetch(u, { cache: 'reload' });
      if (res.ok) failed.push(...await savePage(u, res, true, step)); else failed.push(u);
    } catch (e) { failed.push(u); }
    step(1, 0);
  }
  const cache = await caches.open(CACHE);
  const files = (await cache.keys()).length;
  if (!failed.length) await cache.put(INFO_URL, new Response(JSON.stringify({ at: Date.now(), files })));
  return { type: 'done', ok: !failed.length, failed: failed.length, failedUrls: failed.slice(0, 20), files };
}
// Whether every page is saved, and when the last full download finished.
async function status() {
  const cache = await caches.open(CACHE);
  const missing = (await Promise.all(PAGE_URLS.map(async u => (await cache.match(u)) ? null : u))).filter(Boolean);
  const info = await cache.match(INFO_URL).then(r => r && r.json()).catch(() => null);
  return { type: 'status', ready: !missing.length, missing: missing.length, at: info && info.at, files: (await cache.keys()).length };
}

self.addEventListener('message', e => {
  const port = e.ports && e.ports[0];
  if (!port || !e.data) return;
  if (e.data.type === 'status') e.waitUntil(status().then(r => port.postMessage(r)));
  if (e.data.type === 'download') {
    e.waitUntil(downloadAll(m => port.postMessage(m))
      .then(r => port.postMessage(r), err => port.postMessage({ type: 'done', ok: false, error: String(err) })));
  }
});

self.addEventListener('install', e => {
  e.waitUntil(Promise.all(PAGE_URLS.map(u => fetch(u).then(res => res.ok && savePage(u, res)).catch(() => {})))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(n => n.startsWith('game-centre-') && n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Shown instead of the browser's "You're offline" when a page was never saved.
const NOT_SAVED = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Game Centre</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07050d;color:#fff;font:16px/1.7 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box">
<div><div style="font-size:48px">📴</div><p><b>このページはまだダウンロードされていません。</b><br>ネットにつながったら、ゲームセンターの 📥 ボタンで<br>「オフライン用にダウンロード」してください。</p>
<p style="color:#aab">This page hasn't been downloaded yet.<br>When you're online, tap 📥 in the Game Centre to download for offline.</p>
<p><a href="${new URL('game-center.html', ROOT).href}" style="color:#ffd23f">Game Centre</a></p></div>`;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;   // the MEDAL BANK server's API is POST: never cached
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isPage(url)) {
    const key = pageKey(url);
    const net = fetch(req);
    // Save the fresh page (and its files) in the background, without holding up the page.
    e.waitUntil(net.then(res => res.ok && savePage(key, res.clone())).catch(() => {}));
    const offline = () => new Response(NOT_SAVED, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    e.respondWith(caches.match(key).then(saved => {
      if (!saved) return net.catch(offline);
      return Promise.race([
        net.catch(() => saved),
        new Promise(ok => setTimeout(() => ok(saved), NET_WAIT_MS)),
      ]);
    }));
    return;
  }
  // Anything else on this site: the saved copy if there is one, else the network.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
