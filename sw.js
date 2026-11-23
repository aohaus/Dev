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

const ROOT = new URL('./', self.location).href;
const PAGE_URLS = PAGES.map(p => new URL(p, ROOT).href);
// The cache key for a page: no query, and a folder means its index.html.
const pageKey = url => { const u = url.origin + url.pathname; return u.endsWith('/') ? u + 'index.html' : u; };
const isPage = url => PAGE_URLS.includes(pageKey(url));

// Save a page and the files it refers to (src="…", href="…", url(…)).
async function savePage(key, res) {
  const cache = await caches.open(CACHE);
  const text = await res.clone().text();
  await cache.put(key, res);
  const refs = new Set();
  for (const m of text.matchAll(/(?:src|href)=["']([^"'#]+)["']|url\(["']?([^"')]+)["']?\)/g)) {
    try { refs.add(new URL(m[1] || m[2], key).href); } catch (e) {}
  }
  const keys = await cache.keys();
  await Promise.all([...refs].map(async ref => {
    const u = new URL(ref);
    const sameSite = u.origin === self.location.origin;
    if (!sameSite && !FONT_HOSTS.includes(u.hostname)) return;   // other sites (e.g. the QR code library) aren't needed offline
    if (sameSite && isPage(u)) return;                           // pages are saved on their own
    // Drop older ?v= versions of the same file.
    for (const k of keys) { const o = new URL(k.url); if (o.origin + o.pathname === u.origin + u.pathname && o.href !== u.href) cache.delete(k); }
    if (await cache.match(ref)) return;
    try { const r = await fetch(ref); if (r.ok) await cache.put(ref, r); } catch (e) {}
  }));
}

self.addEventListener('install', e => {
  e.waitUntil(Promise.all(PAGE_URLS.map(u => fetch(u).then(res => res.ok && savePage(u, res)).catch(() => {})))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(n => n.startsWith('game-centre-') && n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

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
    e.respondWith(caches.match(key).then(saved => {
      if (!saved) return net;
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
