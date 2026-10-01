/* GEO SLOT — a medal slot machine for learning world geography.
 *
 * Three reels: flag, country name, map outline. Each reel shows five rows;
 * five paylines (three across, two diagonals) cross the middle three. Get the
 * same country's flag, name and map on a line for a JACKPOT.
 *
 * Plain browser JavaScript, no build step. Sections:
 *   1. DATA     — regions and their countries (add new regions here)
 *   2. CONFIG   — costs, payouts, timings
 *   3. WALLET   — the medals in hand (the Game Centre's shared cup)
 *   4. SOUND    — tiny Web Audio synth
 *   5. REELS    — building and spinning the reel strips
 *   6. GAME     — paylines, play, results
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
  saveKey: 'geo-slot-v1',
  // Reel spin times (ms). Reels stop one after another, left to right.
  spinMs: [1200, 1700, 2200],
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

const reels = [0, 1, 2].map(k => ({
  el: $(`reel${k}`),
  strip: $(`reel${k}`).querySelector('.strip'),
  order: makeStrip(k),
  pos: Math.floor(Math.random() * countries().length),   // strip position on the centre row
}));
const at = (r, p) => r.order[((p % r.order.length) + r.order.length) % r.order.length];
// Country index showing on a row (0 = top … 4 = bottom) of a reel.
const shown = (r, row) => at(r, r.pos + row - MID);

function cell(k, idx) { return `<div class="cell">${FACES[k](countries()[idx])}</div>`; }
function showStill(r, k) {
  r.strip.style.transition = 'none';
  r.strip.style.transform = 'translateY(0)';
  r.strip.innerHTML = Array.from({ length: ROWS }, (_, row) => cell(k, shown(r, row))).join('');
}

// Spin a reel forward to strip position `target`, going round a few times.
// The strip is laid out in real order, so it lands showing true neighbours.
function spinReel(r, k, target, ms) {
  return new Promise(resolve => {
    const n = r.order.length;
    const steps = (2 + k) * n + (((target - r.pos) % n) + n) % n;
    const first = r.pos - MID;
    r.strip.style.transition = 'none';
    r.strip.style.transform = 'translateY(0)';
    r.strip.innerHTML = Array.from({ length: steps + ROWS }, (_, i) => cell(k, at(r, first + i))).join('');
    r.el.classList.add('spinning');
    const h = r.strip.firstElementChild.offsetHeight;
    void r.strip.offsetHeight;   // apply the start position before animating
    r.strip.style.transition = `transform ${ms}ms cubic-bezier(.15,.6,.25,1.02)`;
    r.strip.style.transform = `translateY(${-steps * h}px)`;
    const ticker = setInterval(sound.tick, 70);
    setTimeout(() => clearInterval(ticker), ms * 0.75);
    // Finish on transitionend, with a timer as backup (a background tab may skip the event).
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      r.strip.removeEventListener('transitionend', done);
      r.pos = target;
      r.el.classList.remove('spinning');
      showStill(r, k);
      sound.stop();
      resolve();
    };
    r.strip.addEventListener('transitionend', done);
    setTimeout(done, ms + 400);
  });
}

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
  busy: false,
};

function setMessage(text, kind = '') {
  const m = $('message');
  m.textContent = text;
  m.className = 'message ' + kind;
}
function render() {
  $('medals').textContent = state.medals;
  $('play').disabled = state.busy || state.medals < CONFIG.cost;
  $('refill').hidden = state.busy || state.medals >= CONFIG.cost;
  $('refill').textContent = wallet.shared ? 'Out of medals — get some at the MEDAL BANK 🏦' : `Out of medals — get ${CONFIG.startMedals} more`;
  if (MB) {
    const u = MB.current();
    $('player').textContent = u ? `👤 ${u.name}` : '👤 Guest';
  }
}
function lightLines(wins) {
  document.querySelectorAll('.lines [data-line]').forEach(el => el.classList.toggle('hit', wins.some(w => w.line.no === +el.dataset.line)));
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

async function play() {
  if (state.busy) return;
  if (state.medals < CONFIG.cost) { sound.deny(); setMessage('Not enough medals!', 'warn'); return; }

  state.busy = true;
  state.medals -= CONFIG.cost;
  wallet.save(state.medals);
  sound.coin();
  setMessage('Spinning…');
  lightLines([]);
  $('machine').classList.remove('win');
  render();

  // All three reels spin and stop left to right.
  const n = countries().length;
  await Promise.all(reels.map((r, k) => spinReel(r, k, Math.floor(Math.random() * n), CONFIG.spinMs[k])));

  const wins = findWins();
  lightLines(wins);
  if (wins.length) jackpot(wins);
  else {
    sound.lose();
    setMessage(near(), 'lose');
  }
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
reels.forEach((r, k) => showStill(r, k));
$('play').addEventListener('click', play);
$('refill').addEventListener('click', refill);
$('jackpot').addEventListener('click', closeJackpot);
$('sound').addEventListener('click', () => {
  const m = sound.toggle();
  $('sound').textContent = m ? '🔇' : '🔊';
  $('sound').setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
});
$('region').textContent = REGIONS[CONFIG.region].name;
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (!$('jackpot').hidden) { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); closeJackpot(); } return; }
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); play(); }
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

setMessage(`${CONFIG.cost} medals a spin · 5 lines · each line +${CONFIG.jackpot}`);
render();

// For testing in the browser console.
window.geoSlot = { REGIONS, CONFIG, state, reels, LINES, shown, findWins };
})();
