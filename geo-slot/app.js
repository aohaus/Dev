/* GEO SLOT — a medal slot machine for learning world geography.
 *
 * Three reels: flag, country name, map outline. Each reel shows five rows;
 * five paylines (three across, two diagonals) cross the middle three. Get the
 * same country's flag, name and map on a line for a JACKPOT.
 *
 * Like a Japanese pachislot: PLAY secretly draws whether this spin can win,
 * the player stops each reel with its STOP button, and a stopped reel may
 * slide up to 4 cells. On a winning draw it slides onto the win if you
 * pressed close enough (aiming matters); otherwise it never lines up.
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
  winChance: 0.07,    // chance a spin is drawn as a win (catch every one → about 70% back)
  chanceLamp: 1,      // how often a winning draw lights the CHANCE lamp (1 = every time)
  speed: 5,           // reel speed, cells per second
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
  const stride = strides[k % strides.length] || 1;
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
    r.p -= CONFIG.speed * dt;
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
  prize: null,      // this spin's secret draw: { line, country } or null for a miss
  autoStop: 0,
};

// ---------- the reel controller ("slip") ----------
// Pressing STOP lets the reel slide up to CONFIG.slip more cells. If this
// spin was drawn as a win and the winning spot is within reach, the reel
// slides onto it; otherwise it picks a spot that can't complete any line.
const lineCountry = (line, posOf) => line.rows.map((row, k) => at(reels[k], posOf(k) + row - MID));
function choiceFor(r) {
  const n = r.order.length;
  const first = Math.floor(r.p);   // the next cell to settle (it's rolling downward)
  const cands = Array.from({ length: CONFIG.slip + 1 }, (_, j) => first - j);
  const stoppedPos = k => reels[k].mode === 'stopped' ? reels[k].pos : null;
  // 1. A drawn win: slide onto the spot that lines the prize up, if it's in reach.
  if (state.prize) {
    const { line, country } = state.prize;
    const row = line.rows[r.k];
    const want = r.order.indexOf(countries().indexOf(country)) - (row - MID);
    const hit = cands.find(c => mod(c, n) === mod(want, n));
    if (hit !== undefined) return hit;
    state.prize = null;   // pressed too early or late: the prize is missed
  }
  // 2. Otherwise stay clear of a win: for the last reel, no line may complete;
  //    before that, avoid leaving so many two-in-a-rows that the last reel couldn't dodge them.
  const others = reels.filter(x => x !== r && x.mode !== 'stopped').length;
  const score = c => {
    const posOf = k => k === r.k ? c : stoppedPos(k);
    let wins = 0, reaches = 0;
    for (const line of LINES) {
      const known = [0, 1, 2].filter(k => posOf(k) !== null);
      const vals = known.map(k => at(reels[k], posOf(k) + line.rows[k] - MID));
      if (vals.every(v => v === vals[0])) {
        if (known.length === 3) wins++;
        else if (known.length === 2) reaches++;
      }
    }
    return others === 0 ? wins * 100 : Math.max(0, reaches - 3) * 10;
  };
  let best = cands[0], bestScore = Infinity;
  for (const c of cands) { const s = score(c); if (s < bestScore) { best = c; bestScore = s; } }
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
function lightLines(wins) {
  document.querySelectorAll('[data-line]').forEach(el => el.classList.toggle('hit', wins.some(w => w.line.no === +el.dataset.line)));
  document.querySelectorAll('.reel .cell').forEach(el => el.classList.remove('hit'));
  for (const w of wins) w.line.rows.forEach((row, k) => reels[k].strip.children[row]?.classList.add('hit'));
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
  state.prize = Math.random() < CONFIG.winChance
    ? { line: LINES[Math.floor(Math.random() * LINES.length)], country: list[Math.floor(Math.random() * list.length)] }
    : null;
  const chance = state.prize && Math.random() < CONFIG.chanceLamp;
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
  if (!reels.every(r => r.mode === 'stopped')) return;
  clearTimeout(state.autoStop);
  $('chance').classList.remove('on');
  const wins = findWins();
  lightLines(wins);
  if (wins.length) jackpot(wins);
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

function jackpot(wins) {
  const total = CONFIG.jackpot * wins.length;
  state.medals += total;
  wallet.save(state.medals);
  sound.jackpot();
  $('machine').classList.add('win');
  $('jackpotCountry').innerHTML = wins.map(w => `<div>${w.country.flag} ${w.country.name} <small>· line ${w.line.no}</small></div>`).join('');
  const seen = [...new Map(wins.map(w => [w.country.id, w.country])).values()];
  $('jackpotFact').innerHTML = seen.map(c => `<div>The capital of ${c.name} is ${c.capital}.</div>`).join('');
  $('jackpotAmount').textContent = wins.length > 1 ? `${wins.length} lines! +${total} medals` : `+${total} medals`;
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

setMessage(`${CONFIG.cost} medals a spin · stop each reel yourself · 5 lines`);
render();

// For testing in the browser console.
window.geoSlot = { REGIONS, CONFIG, state, reels, LINES, shown, findWins, choiceFor, stopReel };
})();
