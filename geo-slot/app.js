/* GEO SLOT — a medal slot machine for learning world geography.
 *
 * Three reels: flag, country name, map silhouette. Line all three up on the
 * same country for a JACKPOT. HOLD keeps a reel still on the next spin.
 *
 * Plain browser JavaScript, no build step. Sections:
 *   1. DATA     — regions and their countries (add new regions here)
 *   2. CONFIG   — costs, payouts, timings
 *   3. WALLET   — the medals in hand (saved in this browser)
 *   4. SOUND    — tiny Web Audio synth
 *   5. REELS    — building and spinning the reel strips
 *   6. GAME     — play, hold, results
 */
(() => {
'use strict';

// ============================================================
// 1. DATA
// ============================================================
// Each region is a list of countries. To add a region, add another entry to
// REGIONS with the same shape:
//   { id, name, flag, capital, color, shape }
// `shape` is the silhouette: SVG markup drawn inside a 100×100 box. These are
// simple placeholders for now — swap in real map outlines later.
const REGIONS = {
  asean: {
    name: 'ASEAN',
    countries: [
      { id: 'brunei',      name: 'Brunei',      flag: '🇧🇳', capital: 'Bandar Seri Begawan', color: '#ffd23f',
        shape: '<path d="M30 30 L62 22 L74 48 L58 52 L60 76 L36 78 L40 52 L26 48 Z"/>' },
      { id: 'cambodia',    name: 'Cambodia',    flag: '🇰🇭', capital: 'Phnom Penh',          color: '#ff5c8a',
        shape: '<path d="M18 40 Q30 18 58 20 Q84 22 84 48 Q80 74 56 80 Q32 82 22 64 Z"/>' },
      { id: 'indonesia',   name: 'Indonesia',   flag: '🇮🇩', capital: 'Jakarta',             color: '#ff6b3d',
        shape: '<ellipse cx="16" cy="40" rx="12" ry="7" transform="rotate(35 16 40)"/><ellipse cx="38" cy="66" rx="16" ry="5"/><ellipse cx="44" cy="36" rx="12" ry="11"/><path d="M62 30 L70 28 L66 44 L74 52 L64 54 Z"/><ellipse cx="88" cy="50" rx="10" ry="7"/><ellipse cx="66" cy="70" rx="7" ry="3"/>' },
      { id: 'laos',        name: 'Laos',        flag: '🇱🇦', capital: 'Vientiane',           color: '#3dd6ff',
        shape: '<path d="M26 10 L46 14 L50 34 L66 44 L80 66 L74 90 L62 86 L60 66 L42 50 L36 34 L24 30 Z"/>' },
      { id: 'malaysia',    name: 'Malaysia',    flag: '🇲🇾', capital: 'Kuala Lumpur',        color: '#7dff6a',
        shape: '<path d="M10 22 L22 24 L28 46 L36 70 L30 76 L20 62 L14 42 Z"/><path d="M50 52 L66 34 L80 26 L92 34 L84 50 L66 58 Z"/>' },
      { id: 'myanmar',     name: 'Myanmar',     flag: '🇲🇲', capital: 'Naypyidaw',           color: '#b07bff',
        shape: '<path d="M44 4 L60 10 L66 30 L62 46 L50 52 L48 64 L56 80 L52 96 L44 86 L40 66 L28 58 L26 36 L36 20 Z"/>' },
      { id: 'philippines', name: 'Philippines', flag: '🇵🇭', capital: 'Manila',              color: '#4f8bff',
        shape: '<path d="M40 6 L54 10 L52 30 L58 42 L48 44 L42 28 Z"/><ellipse cx="50" cy="56" rx="6" ry="4"/><ellipse cx="64" cy="54" rx="5" ry="6"/><path d="M22 52 L30 56 L18 72 L12 70 Z"/><path d="M54 70 L74 66 L78 86 L64 92 L56 84 Z"/>' },
      { id: 'singapore',   name: 'Singapore',   flag: '🇸🇬', capital: 'Singapore',           color: '#ff3b3b',
        shape: '<path d="M18 50 Q30 32 56 34 Q80 36 84 50 Q78 64 54 66 Q30 66 18 50 Z"/>' },
      { id: 'thailand',    name: 'Thailand',    flag: '🇹🇭', capital: 'Bangkok',             color: '#ffa53b',
        shape: '<path d="M30 6 L52 10 L60 26 L76 30 L74 50 L56 52 L50 60 L44 58 L46 76 L54 92 L46 94 L36 76 L38 56 L30 40 L24 22 Z"/>' },
      { id: 'vietnam',     name: 'Vietnam',     flag: '🇻🇳', capital: 'Hanoi',               color: '#ff4fd8',
        shape: '<path d="M30 6 L56 8 L48 22 L44 36 L58 50 L66 66 L58 82 L40 94 L36 86 L48 74 L50 62 L36 46 L32 30 Z"/>' },
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
  startMedals: 100,
  cost: 10,
  jackpot: 100,
  saveKey: 'geo-slot-v1',
  // Reel spin times (ms). Reels stop one after another, left to right.
  spinMs: [1200, 1700, 2200],
};

// ============================================================
// 3. WALLET — medals in hand, saved in this browser
// ============================================================
const wallet = {
  load() {
    try {
      const n = Number(JSON.parse(localStorage.getItem(CONFIG.saveKey) || 'null')?.medals);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : CONFIG.startMedals;
    } catch (e) { return CONFIG.startMedals; }
  },
  save(n) {
    try { localStorage.setItem(CONFIG.saveKey, JSON.stringify({ medals: n })); } catch (e) {}
  },
};

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
    hold(on) { tone(on ? 988 : 660, 0.07, { vol: 0.05 }); },
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
const $ = id => document.getElementById(id);
const countries = () => REGIONS[CONFIG.region].countries;
const randomIndex = () => Math.floor(Math.random() * countries().length);

// What each reel shows for a country.
const FACES = [
  c => `<span class="face flag" role="img" aria-label="${c.name} flag">${c.flag}</span>`,
  c => `<span class="face name">${c.name}</span>`,
  c => `<svg class="face shape" viewBox="0 0 100 100" role="img" aria-label="${c.name} map" style="--c:${c.color}">${c.shape}</svg>`,
];

const reels = [0, 1, 2].map(i => ({
  el: $(`reel${i}`),
  strip: $(`reel${i}`).querySelector('.strip'),
  index: randomIndex(),   // the country this reel is showing
  held: false,
}));

function cell(reelNo, idx) { return `<div class="cell">${FACES[reelNo](countries()[idx])}</div>`; }
function showStill(r, reelNo) {
  r.strip.style.transition = 'none';
  r.strip.style.transform = 'translateY(0)';
  r.strip.innerHTML = cell(reelNo, r.index);
}

// Spin one reel to `target`: build a strip of random cells ending on the
// target, then slide it up with an ease-out so it lands exactly there.
function spinReel(r, reelNo, target, ms) {
  return new Promise(resolve => {
    const n = countries().length;
    const count = 14 + reelNo * 6;   // later reels travel further, so they stop later
    const idxs = [r.index];
    for (let i = 1; i < count; i++) idxs.push(Math.floor(Math.random() * n));
    idxs.push(target);
    r.strip.style.transition = 'none';
    r.strip.style.transform = 'translateY(0)';
    r.strip.innerHTML = idxs.map(i => cell(reelNo, i)).join('');
    r.el.classList.add('spinning');
    const h = r.el.clientHeight;
    void r.strip.offsetHeight;   // apply the start position before animating
    r.strip.style.transition = `transform ${ms}ms cubic-bezier(.15,.6,.25,1.02)`;
    r.strip.style.transform = `translateY(${-(idxs.length - 1) * h}px)`;
    // Ticking sound while the strip is moving fast.
    const ticker = setInterval(sound.tick, 70);
    setTimeout(() => clearInterval(ticker), ms * 0.75);
    // Finish on transitionend, with a timer as backup (a background tab may skip the event).
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      r.strip.removeEventListener('transitionend', done);
      r.index = target;
      r.el.classList.remove('spinning');
      showStill(r, reelNo);
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
  const allHeld = reels.every(r => r.held);
  $('play').disabled = state.busy || state.medals < CONFIG.cost || allHeld;
  reels.forEach((r, i) => {
    const b = $(`hold${i}`);
    b.classList.toggle('on', r.held);
    b.setAttribute('aria-pressed', r.held);
    b.disabled = state.busy;
    r.el.classList.toggle('held', r.held);
  });
  $('refill').hidden = state.busy || state.medals >= CONFIG.cost;
}

function toggleHold(i) {
  if (state.busy) return;
  reels[i].held = !reels[i].held;
  sound.hold(reels[i].held);
  if (reels.every(r => r.held)) setMessage('Release at least one reel to spin!', 'warn');
  else setMessage(`Cost: ${CONFIG.cost} medals per spin`);
  render();
}

async function play() {
  if (state.busy) return;
  if (state.medals < CONFIG.cost) { sound.deny(); setMessage('Not enough medals!', 'warn'); return; }
  if (reels.every(r => r.held)) { sound.deny(); return; }

  state.busy = true;
  state.medals -= CONFIG.cost;
  wallet.save(state.medals);
  sound.coin();
  setMessage('Spinning…');
  $('machine').classList.remove('win');
  render();

  // Spin every reel that isn't held; they stop left to right.
  await Promise.all(reels.map((r, i) => r.held ? null : spinReel(r, i, randomIndex(), CONFIG.spinMs[i])));

  const [a, b, c] = reels.map(r => r.index);
  if (a === b && b === c) jackpot(countries()[a]);
  else {
    sound.lose();
    setMessage(near(), 'lose');
  }
  state.busy = false;
  render();
}

// A friendly hint after a miss: point out a pair the player could HOLD.
function near() {
  const idx = reels.map(r => r.index);
  const list = countries();
  for (const [x, y] of [[0, 1], [0, 2], [1, 2]]) {
    if (idx[x] === idx[y]) return `So close! Two reels show ${list[idx[x]].name}. Try HOLD on them!`;
  }
  return 'No match — try again!';
}

function jackpot(country) {
  state.medals += CONFIG.jackpot;
  wallet.save(state.medals);
  sound.jackpot();
  $('machine').classList.add('win');
  $('jackpotCountry').textContent = `${country.flag} ${country.name}`;
  $('jackpotFact').textContent = `The capital of ${country.name} is ${country.capital}.`;
  $('jackpotAmount').textContent = `+${CONFIG.jackpot} medals`;
  $('jackpot').hidden = false;
  setMessage(`JACKPOT! ${country.name}! +${CONFIG.jackpot} medals`, 'win');
  reels.forEach(r => { r.held = false; });   // a fresh start after a win
}

function closeJackpot() {
  $('jackpot').hidden = true;
  $('machine').classList.remove('win');
}

function refill() {
  state.medals = CONFIG.startMedals;
  wallet.save(state.medals);
  sound.coin();
  setMessage(`Here are ${CONFIG.startMedals} medals. Good luck!`);
  render();
}

// ---------------- wiring ----------------
reels.forEach((r, i) => {
  showStill(r, i);
  $(`hold${i}`).addEventListener('click', () => toggleHold(i));
});
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
  else if (['1', '2', '3'].includes(e.key)) toggleHold(Number(e.key) - 1);
});

setMessage(`Cost: ${CONFIG.cost} medals per spin`);
render();

// For testing in the browser console.
window.geoSlot = { REGIONS, CONFIG, state, reels };
})();
