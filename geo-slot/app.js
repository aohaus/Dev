/* GEO SLOT — a medal slot machine for learning world geography.
 *
 * Three reels: flag, country name, map outline. Each reel shows five rows;
 * five paylines (three across, two diagonals) cross the middle three. Get the
 * same country's flag, name and map on a line for a JACKPOT; the same
 * country's flag and name on a line (left two reels) is a PAIR, a small win.
 * Two of a kind on a line with the last reel still spinning is a REACH: the
 * line flashes and that reel slows down.
 *
 * Like a Japanese pachislot: PLAY secretly draws whether this spin is a
 * JACKPOT, a PAIR or a miss,
 * the player stops each reel with its STOP button, and a stopped reel may
 * slide up to 4 cells. On a winning draw it slides onto the win if you
 * pressed close enough (aiming matters — a missed JACKPOT still pays a PAIR
 * when it can); a PAIR is almost always caught; a miss never lines up.
 *
 * Plain browser JavaScript, no build step. Sections:
 *   1. DATA     — regions and their countries (add new regions here)
 *   2. CONFIG   — costs, payouts, timings
 *   3. WALLET   — the medals in hand (the Game Centre's shared cup)
 *   4. SOUND    — tiny Web Audio synth
 *   5. REELS    — building and spinning the reel strips
 *   6. GAME     — paylines, the reel controller, play, results
 */
(() => {
'use strict';

// ============================================================
// 1. DATA
// ============================================================
// Each region is a list of countries. To add a region, add another entry to
// REGIONS with the same fields:
//   { id, name, flag, capital, color }
// The MAP reel draws each country's real outline from shapes.js (keyed by id,
// generated from Natural Earth). A country can also carry its own `shape`
// (SVG markup in a 100×100 box) if it isn't in shapes.js.
const REGIONS = {
  asean: {
    name: 'ASEAN',
    countries: [
      { id: 'brunei',      name: 'Brunei',      flag: '🇧🇳', capital: 'Bandar Seri Begawan', color: '#ffd23f' },
      { id: 'cambodia',    name: 'Cambodia',    flag: '🇰🇭', capital: 'Phnom Penh',          color: '#ff5c8a' },
      { id: 'indonesia',   name: 'Indonesia',   flag: '🇮🇩', capital: 'Jakarta',             color: '#ff6b3d' },
      { id: 'laos',        name: 'Laos',        flag: '🇱🇦', capital: 'Vientiane',           color: '#3dd6ff' },
      { id: 'malaysia',    name: 'Malaysia',    flag: '🇲🇾', capital: 'Kuala Lumpur',        color: '#7dff6a' },
      { id: 'myanmar',     name: 'Myanmar',     flag: '🇲🇲', capital: 'Naypyidaw',           color: '#b07bff' },
      { id: 'philippines', name: 'Philippines', flag: '🇵🇭', capital: 'Manila',              color: '#4f8bff' },
      { id: 'singapore',   name: 'Singapore',   flag: '🇸🇬', capital: 'Singapore',           color: '#ff3b3b' },
      { id: 'thailand',    name: 'Thailand',    flag: '🇹🇭', capital: 'Bangkok',             color: '#ffa53b' },
      { id: 'vietnam',     name: 'Vietnam',     flag: '🇻🇳', capital: 'Hanoi',               color: '#ff4fd8' },
    ],
  },
  // europe: { name: 'Europe', countries: [ ... ] },
  // eastAsia: { name: 'East Asia', countries: [ ... ] },
};

// ============================================================
// 2. CONFIG
// ============================================================
const CONFIG = {
  region: 'asean',
  startMedals: 100,   // only used if the page runs without ../medal-bank.js
  cost: 10,
  jackpot: 100,       // per winning line; all 5 lines are played every spin
  pair: 20,           // per line with the same country's flag + name (left two reels)
  // Chance a spin is drawn as a JACKPOT / a PAIR, by the admin's setting 1-5
  // (3 = standard). Catching everything returns about 61 / 74 / 85 / 101 / 124%.
  jackpotChance: [0.025, 0.03, 0.035, 0.045, 0.06],
  pairChance:    [0.18, 0.22, 0.25, 0.28, 0.32],
  chanceLamp: 1,      // how often a JACKPOT draw lights the CHANCE lamp (1 = every time)
  speed: 5,           // reel speed, cells per second
  reachSpeed: 2.5,    // the last reel slows to this during a REACH
  slip: 4,            // how many cells a reel may slide after STOP
  autoStopMs: 30000,  // reels left spinning stop by themselves after this
  saveKey: 'geo-slot-v1',
};

// ============================================================
// 3. WALLET — medals in hand
// ============================================================
// In the Game Centre the medals in hand are one cup shared by every game
// (../medal-bank.js); you top it up at the MEDAL BANK. Opened on its own,
// the game falls back to its own medals saved in this browser.
const MB = window.MedalBank;
const wallet = {
  shared: !!MB,
  load() {
    if (MB) return MB.hand();
    try {
      const n = Number(JSON.parse(localStorage.getItem(CONFIG.saveKey) || 'null')?.medals);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : CONFIG.startMedals;
    } catch (e) { return CONFIG.startMedals; }
  },
  save(n) {
    if (MB) { MB.setHand(n); return; }
    try { localStorage.setItem(CONFIG.saveKey, JSON.stringify({ medals: n })); } catch (e) {}
  },
};
// When GEO SLOT first joins the shared cup, medals won above its free 100 start move into the cup.
if (MB) {
  try {
    const old = JSON.parse(localStorage.getItem(CONFIG.saveKey) || 'null');
    if (old && !old.joined) {
      const won = Math.max(0, Math.floor(Number(old.medals) || 0) - CONFIG.startMedals);
      if (won > 0) MB.setHand(MB.hand() + won);
      localStorage.setItem(CONFIG.saveKey, JSON.stringify({ joined: true }));
    }
  } catch (e) {}
}

// ============================================================
// 4. SOUND — synthesized with the Web Audio API (no files)
// ============================================================
const sound = (() => {
  let ctx = null, muted = false;
  function ac() {
    if (muted) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, { type = 'square', vol = 0.06, at = 0 } = {}) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; return muted; },
    coin() { tone(1320, 0.06); tone(1760, 0.1, { at: 0.05 }); },
    tick() { tone(900 + Math.random() * 300, 0.025, { vol: 0.03 }); },
    stop() { tone(220, 0.08, { type: 'triangle', vol: 0.12 }); },
    deny() { tone(150, 0.2, { type: 'sawtooth', vol: 0.05 }); },
    chance() { [880, 1175, 880, 1175, 1568].forEach((f, i) => tone(f, 0.09, { vol: 0.06, at: i * 0.08 })); },
    pair() { [784, 988, 1319].forEach((f, i) => tone(f, 0.1, { vol: 0.07, at: i * 0.07 })); },
    reach() { [523, 659, 523, 659, 523, 659, 784].forEach((f, i) => tone(f, 0.08, { vol: 0.07, at: i * 0.09 })); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.07, at: i * 0.14 })); },
    jackpot() {
      const notes = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
      notes.forEach((f, i) => tone(f, 0.16, { vol: 0.07, at: i * 0.11 }));
      for (let i = 0; i < 12; i++) tone(2200 + Math.random() * 1200, 0.05, { type: 'triangle', vol: 0.04, at: 0.9 + i * 0.06 });
    },
  };
})();

// ============================================================
// 5. REELS
// ============================================================
// Each reel is a fixed strip holding every country once, in its own order
// (like a real slot reel), so what you see above and below the middle is
// what really comes next. Five rows show through each window: the middle
// three are on the paylines, the outer two are a faint peek.
const $ = id => document.getElementById(id);
const countries = () => REGIONS[CONFIG.region].countries;
const ROWS = 5, MID = 2;   // row 2 of 0..4 is the centre line

// What each reel shows for a country.
const FACES = [
  c => `<span class="face flag" role="img" aria-label="${c.name} flag">${c.flag}</span>`,
  c => `<span class="face name">${c.name}</span>`,
  c => `<svg class="face shape" viewBox="0 0 100 100" role="img" aria-label="${c.name} map" style="--c:${c.color}">${outline(c)}</svg>`,
];
function outline(c) {
  const d = (window.GEO_SHAPES || {})[c.id];
  return d ? `<path d="${d}"/>` : (c.shape || '<circle cx="50" cy="50" r="30"/>');
}

// Strip order: reel k steps through the countries by a different stride, so
// the three reels are shuffled against each other and diagonals can line up.
function makeStrip(k) {
  const n = countries().length;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const strides = [];
  for (let s = 1; s < n * 2 && strides.length < 3; s++) if (gcd(s, n) === 1 && !strides.includes(s % n || n)) strides.push(s % n || n);
  // The name reel takes the largest stride (7 of 10): with a small one, the five
  // flag spots that would pair with a name sit side by side, so a miss couldn't
  // always dodge a PAIR within the 4-cell slip.
  const pick = [0, strides.length - 1, 1][k];
  const stride = strides[pick] || 1;
  return Array.from({ length: n }, (_, i) => (i * stride + k * 3) % n);
}

const mod = (a, n) => ((a % n) + n) % n;
const reels = [0, 1, 2].map(k => ({
  k,
  el: $(`reel${k}`),
  strip: $(`reel${k}`).querySelector('.strip'),
  order: makeStrip(k),
  pos: Math.floor(Math.random() * countries().length),   // strip position on the centre row (whole number when stopped)
  p: 0,              // continuous position while moving; it counts down as the reel rolls downward
  mode: 'stopped',   // stopped | spinning | stopping
  target: 0,         // where a stopping reel will come to rest
  drawn: null,       // first strip position currently drawn
}));
reels.forEach(r => { r.p = r.pos; });
const at = (r, p) => r.order[mod(p, r.order.length)];
// Country index showing on a row (0 = top … 4 = bottom) of a stopped reel.
const shown = (r, row) => at(r, r.pos + row - MID);

function cell(k, idx) { return `<div class="cell">${FACES[k](countries()[idx])}</div>`; }
// Draw a reel at continuous position p: seven cells (one spare above and
// below the five rows) shifted by the fractional part, so it rolls smoothly.
function draw(r) {
  const base = Math.floor(r.p), frac = r.p - base;
  if (r.drawn !== base) {
    r.strip.innerHTML = Array.from({ length: ROWS + 2 }, (_, i) => cell(r.k, at(r, base - MID - 1 + i))).join('');
    r.drawn = base;
  }
  const h = r.el.clientHeight / ROWS;
  r.strip.style.transform = `translateY(${(-1 - frac) * h}px)`;
}
function drawStill(r) {
  r.p = r.pos; r.drawn = null;
  r.strip.innerHTML = Array.from({ length: ROWS }, (_, row) => cell(r.k, shown(r, row))).join('');
  r.strip.style.transform = 'translateY(0)';
}

// One animation loop moves every reel that isn't stopped.
let lastFrame = 0, rafId = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  let moving = false;
  for (const r of reels) {
    if (r.mode === 'stopped') continue;
    moving = true;
    const before = Math.floor(r.p);
    r.p -= (state.reach.length ? CONFIG.reachSpeed : CONFIG.speed) * dt;
    if (r.mode === 'stopping' && r.p <= r.target) {
      r.p = r.target; r.pos = mod(r.target, r.order.length); r.mode = 'stopped';
      drawStill(r); sound.stop();
      onReelStopped();
      continue;
    }
    if (Math.floor(r.p) !== before) sound.tick();
    draw(r);
  }
  rafId = moving ? requestAnimationFrame(frame) : 0;
  if (!moving) lastFrame = 0;
}
function startLoop() { if (!rafId) { lastFrame = 0; rafId = requestAnimationFrame(frame); } }

// ============================================================
// 6. GAME
// ============================================================
// The five paylines, as the row (0..4) they cross on each reel.
const LINES = [
  { no: 1, rows: [2, 2, 2] },   // middle
  { no: 2, rows: [1, 1, 1] },   // top
  { no: 3, rows: [3, 3, 3] },   // bottom
  { no: 4, rows: [1, 2, 3] },   // diagonal ↘
  { no: 5, rows: [3, 2, 1] },   // diagonal ↗
];

const state = {
  medals: wallet.load(),
  busy: false,      // a spin is in progress
  prize: null,      // this spin's secret draw: { kind: 'jackpot', line, country }, { kind: 'pair' } or null for a miss
  reach: [],        // lines in REACH right now
  autoStop: 0,
};

// ---------- the reel controller ("slip") ----------
// Pressing STOP lets the reel slide up to CONFIG.slip more cells. On a
// JACKPOT draw with the winning spot in reach, the reel slides onto it.
// Otherwise it picks the spot that best fits the draw: a PAIR draw makes a
// flag + name pair (and no JACKPOT); a miss avoids anything that pays.
const lineCountry = (line, posOf) => line.rows.map((row, k) => at(reels[k], posOf(k) + row - MID));
// What a finished board pays, given every reel's position.
function payLines(posOf) {
  const jackpots = [], pairs = [];
  for (const line of LINES) {
    const [a, b, c] = lineCountry(line, posOf);
    if (a === b && b === c) jackpots.push(line);
    else if (a === b) pairs.push(line);
  }
  return { jackpots, pairs };
}
// 0 when a finished board matches the draw; higher is worse.
function misfit(posOf) {
  const { jackpots, pairs } = payLines(posOf);
  if (state.prize) return jackpots.length ? 100 : pairs.length ? 0 : 50;
  return (jackpots.length + pairs.length) * 100;
}
// The spots a reel can come to rest on when STOP is pressed with `first` next to settle.
const reachable = first => Array.from({ length: CONFIG.slip + 1 }, (_, j) => first - j);
function choiceFor(r) {
  const n = r.order.length;
  const cands = reachable(Math.floor(r.p));   // it's rolling downward
  const stoppedPos = k => reels[k].mode === 'stopped' ? reels[k].pos : null;
  // 1. A JACKPOT draw: slide onto the spot that lines the prize up, if it's in reach.
  if (state.prize && state.prize.kind === 'jackpot') {
    const { line, country } = state.prize;
    const row = line.rows[r.k];
    const want = r.order.indexOf(countries().indexOf(country)) - (row - MID);
    const hit = cands.find(c => mod(c, n) === mod(want, n));
    if (hit !== undefined) return hit;
    state.prize = { kind: 'pair' };   // pressed too early or late: the JACKPOT is missed, try for a PAIR
  }
  // 2. Otherwise score each spot against the draw.
  const rest = reels.filter(x => x !== r && x.mode !== 'stopped');
  // Share of the ways the remaining reels could be stopped (any order, any press
  // timing) that can still end up fitting the draw.
  const fit = (posOf, rest) => {
    if (!rest.length) return misfit(posOf) === 0 ? 1 : 0;
    let sum = 0;
    for (const o of rest) {
      const others = rest.filter(x => x !== o);
      for (let w = 0; w < n; w++) {
        let best = 0;
        for (const x of reachable(w)) { best = Math.max(best, fit(k => k === o.k ? x : posOf(k), others)); if (best === 1) break; }
        sum += best;
      }
    }
    return sum / (rest.length * n);
  };
  const score = c => {
    const posOf = k => k === r.k ? c : stoppedPos(k);
    return rest.length ? 1 - fit(posOf, rest) : misfit(posOf);
  };
  let best = cands[0], bestScore = Infinity;
  for (const c of cands) { const sc = score(c); if (sc < bestScore) { best = c; bestScore = sc; } }
  return best;
}

// ---------- spin ----------
function setMessage(text, kind = '') {
  const m = $('message');
  m.textContent = text;
  m.className = 'message ' + kind;
}
function render() {
  $('medals').textContent = state.medals;
  $('play').disabled = state.busy || state.medals < CONFIG.cost;
  reels.forEach(r => { $(`stop${r.k}`).disabled = r.mode !== 'spinning'; });
  $('refill').hidden = state.busy || state.medals >= CONFIG.cost;
  $('refill').textContent = wallet.shared ? 'Out of medals — get some at the MEDAL BANK 🏦' : `Out of medals — get ${CONFIG.startMedals} more`;
  if (MB) {
    const u = MB.current();
    $('player').textContent = u ? `👤 ${u.name}` : '👤 Guest';
  }
}
// Light lines and their cells: wins = [{ line, reels? }] (reels: which cells, default all three);
// cls = 'hit' (a win) or 'reach'.
function lightLines(wins, cls = 'hit') {
  document.querySelectorAll('.hit, .reach').forEach(el => { if (el.matches('[data-line], .cell')) el.classList.remove('hit', 'reach'); });
  document.querySelectorAll('[data-line]').forEach(el => el.classList.toggle(cls, wins.some(w => w.line.no === +el.dataset.line)));
  for (const w of wins) (w.reels || [0, 1, 2]).forEach(k => reels[k].strip.children[w.line.rows[k]]?.classList.add(cls));
}
// Which lines have the same country on all three reels.
function findWins() {
  const wins = [];
  for (const line of LINES) {
    const [a, b, c] = line.rows.map((row, k) => shown(reels[k], row));
    if (a === b && b === c) wins.push({ line, country: countries()[a] });
  }
  return wins;
}
// Which lines have the same country's flag and name, but not the map.
function findPairs() {
  const pairs = [];
  for (const line of LINES) {
    const [a, b, c] = line.rows.map((row, k) => shown(reels[k], row));
    if (a === b && b !== c) pairs.push({ line, country: countries()[a], reels: [0, 1] });
  }
  return pairs;
}
// With one reel left spinning, the lines where the other two already match.
function findReach() {
  const spinning = reels.filter(r => r.mode !== 'stopped');
  if (spinning.length !== 1) return [];
  const ks = [0, 1, 2].filter(k => k !== spinning[0].k);
  return LINES.filter(line => shown(reels[ks[0]], line.rows[ks[0]]) === shown(reels[ks[1]], line.rows[ks[1]]))
    .map(line => ({ line, country: countries()[shown(reels[ks[0]], line.rows[ks[0]])], reels: ks }));
}

function play() {
  if (state.busy) return;
  if (state.medals < CONFIG.cost) { sound.deny(); setMessage('Not enough medals!', 'warn'); return; }
  state.busy = true;
  state.medals -= CONFIG.cost;
  wallet.save(state.medals);
  sound.coin();
  lightLines([]);
  $('machine').classList.remove('win');

  // The secret draw for this spin.
  const list = countries();
  const lv = MB && MB.level ? MB.level('geo') : 3;
  const roll = Math.random(), jp = CONFIG.jackpotChance[lv - 1];
  state.prize = roll < jp
    ? { kind: 'jackpot', line: LINES[Math.floor(Math.random() * LINES.length)], country: list[Math.floor(Math.random() * list.length)] }
    : roll < jp + CONFIG.pairChance[lv - 1] ? { kind: 'pair' } : null;
  state.reach = [];
  const chance = state.prize && state.prize.kind === 'jackpot' && Math.random() < CONFIG.chanceLamp;
  $('chance').classList.toggle('on', !!chance);
  if (chance) sound.chance();
  setMessage(chance ? '★ CHANCE! Aim carefully and press STOP!' : 'Press STOP on each reel!', chance ? 'win' : '');

  reels.forEach(r => { r.mode = 'spinning'; r.p = r.pos; r.drawn = null; });
  startLoop();
  clearTimeout(state.autoStop);
  state.autoStop = setTimeout(autoStop, CONFIG.autoStopMs);
  render();
}

function stopReel(k) {
  const r = reels[k];
  if (!state.busy || r.mode !== 'spinning') return;
  r.target = choiceFor(r);
  r.mode = 'stopping';
  $(`stop${k}`).classList.add('pressed');
  setTimeout(() => $(`stop${k}`).classList.remove('pressed'), 150);
  render();
}
// Forgot to press? After a while the reels stop by themselves, left to right.
function autoStop() {
  reels.forEach((r, i) => setTimeout(() => stopReel(r.k), i * 400));
}

function onReelStopped() {
  render();
  if (!reels.every(r => r.mode === 'stopped')) {
    const reach = findReach();
    if (reach.length && !state.reach.length) {
      state.reach = reach;
      lightLines(reach, 'reach');
      $('machine').classList.add('reaching');
      sound.reach();
      const c = reach[0].country, left = ['flag', 'name', 'map'][reels.find(r => r.mode !== 'stopped').k];
      setMessage(`REACH! ${c.flag} ${c.name} — stop the ${left}!`, 'win');
    }
    return;
  }
  clearTimeout(state.autoStop);
  $('chance').classList.remove('on');
  $('machine').classList.remove('reaching');
  state.reach = [];
  const wins = findWins(), pairs = findPairs();
  lightLines([...wins, ...pairs]);
  if (wins.length) jackpot(wins, pairs);
  else if (pairs.length) pairWin(pairs);
  else {
    sound.lose();
    setMessage(near(), 'lose');
  }
  state.prize = null;
  state.busy = false;
  render();
}

// A friendly hint after a miss: point out a line that was one away.
function near() {
  for (const line of LINES) {
    const idx = line.rows.map((row, k) => shown(reels[k], row));
    if (idx[0] === idx[1] || idx[1] === idx[2] || idx[0] === idx[2]) {
      const two = idx[0] === idx[1] || idx[0] === idx[2] ? idx[0] : idx[1];
      return `So close! Two ${countries()[two].name} on line ${line.no}. Try again!`;
    }
  }
  return 'No match — try again!';
}

// A small win: the same country's flag and name on a line.
function pairWin(pairs) {
  const total = CONFIG.pair * pairs.length;
  state.medals += total;
  wallet.save(state.medals);
  sound.pair();
  const c = pairs[0].country;
  setMessage(`PAIR! ${c.flag} ${c.name} +${total} medals${pairs.length > 1 ? ` (${pairs.length} lines)` : ''} · its map:`, 'win');
  // Show the answer, so the next REACH is easier to catch.
  $('message').insertAdjacentHTML('beforeend', ` <svg class="answer" viewBox="0 0 100 100" role="img" aria-label="${c.name} map" style="--c:${c.color}">${outline(c)}</svg>`);
}

function jackpot(wins, pairs = []) {
  const total = CONFIG.jackpot * wins.length + CONFIG.pair * pairs.length;
  state.medals += total;
  wallet.save(state.medals);
  sound.jackpot();
  $('machine').classList.add('win');
  $('jackpotCountry').innerHTML = wins.map(w => `<div>${w.country.flag} ${w.country.name} <small>· line ${w.line.no}</small></div>`).join('');
  const seen = [...new Map(wins.map(w => [w.country.id, w.country])).values()];
  $('jackpotFact').innerHTML = seen.map(c => `<div>The capital of ${c.name} is ${c.capital}.</div>`).join('');
  const lines = wins.length + pairs.length;
  $('jackpotAmount').textContent = lines > 1 ? `${lines} lines! +${total} medals` : `+${total} medals`;
  $('jackpot').hidden = false;
  setMessage(`JACKPOT! ${wins.map(w => w.country.name).join(' & ')}! +${total} medals`, 'win');
}

function closeJackpot() {
  $('jackpot').hidden = true;
  $('machine').classList.remove('win');
}

function refill() {
  if (wallet.shared) { location.href = '../medal-bank.html'; return; }
  state.medals = CONFIG.startMedals;
  wallet.save(state.medals);
  sound.coin();
  setMessage(`Here are ${CONFIG.startMedals} medals. Good luck!`);
  render();
}

// ---------------- wiring ----------------
if (MB && MB.mountNav) MB.mountNav('geo');
reels.forEach(r => { drawStill(r); $(`stop${r.k}`).addEventListener('pointerdown', e => { e.preventDefault(); stopReel(r.k); }); });
$('play').addEventListener('click', play);
$('refill').addEventListener('click', refill);
$('jackpot').addEventListener('click', closeJackpot);
$('sound').addEventListener('click', () => {
  const m = sound.toggle();
  $('sound').textContent = m ? '🔇' : '🔊';
  $('sound').setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
});
$('region').textContent = REGIONS[CONFIG.region].name;
const STOP_KEYS = { '1': 0, '2': 1, '3': 2, j: 0, k: 1, l: 2 };
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (!$('jackpot').hidden) { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); closeJackpot(); } return; }
  const key = e.key.toLowerCase();
  if (key in STOP_KEYS) stopReel(STOP_KEYS[key]);
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); play(); }
});

// Pick up changes made elsewhere (the bank, another game, the back button).
function syncWallet() {
  if (state.busy) return;
  state.medals = wallet.load();
  render();
}
if (MB) MB.onChange(syncWallet);
addEventListener('pageshow', syncWallet);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncWallet(); });

setMessage(`${CONFIG.cost} medals a spin · flag + name = PAIR +${CONFIG.pair} · all three = JACKPOT!`);
render();

// For testing in the browser console.
window.geoSlot = { REGIONS, CONFIG, state, reels, LINES, shown, findWins, findPairs, findReach, choiceFor, stopReel };
})();
