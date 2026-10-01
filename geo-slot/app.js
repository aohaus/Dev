/* GEO SLOT — a medal slot machine for learning world geography.
 *
 * Three reels: flag, country name, map silhouette. Line all three up on the
 * same country for a JACKPOT. HOLD keeps a reel still on the next spin.
 *
 * Plain browser JavaScript, no build step. Sections:
 *   1. DATA     — regions and their countries (add new regions here)
 *   2. CONFIG   — costs, payouts, timings
 *   3. WALLET   — the medals in hand (the Game Centre's shared cup)
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
  jackpot: 100,
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
  c => `<svg class="face shape" viewBox="0 0 100 100" role="img" aria-label="${c.name} map" style="--c:${c.color}">${outline(c)}</svg>`,
];

function outline(c) {
  const d = (window.GEO_SHAPES || {})[c.id];
  return d ? `<path d="${d}"/>` : (c.shape || '<circle cx="50" cy="50" r="30"/>');
}

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
  $('refill').textContent = wallet.shared ? 'Out of medals — get some at the MEDAL BANK 🏦' : `Out of medals — get ${CONFIG.startMedals} more`;
  if (MB) {
    const u = MB.current();
    $('player').textContent = u ? `👤 ${u.name}` : '👤 Guest';
  }
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
  if (wallet.shared) { location.href = '../medal-bank.html'; return; }
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

// Pick up changes made elsewhere (the bank, another game, the back button).
function syncWallet() {
  if (state.busy) return;
  state.medals = wallet.load();
  render();
}
if (MB) MB.onChange(syncWallet);
addEventListener('pageshow', syncWallet);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncWallet(); });

setMessage(`Cost: ${CONFIG.cost} medals per spin`);
render();

// For testing in the browser console.
window.geoSlot = { REGIONS, CONFIG, state, reels };
})();
