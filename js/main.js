// Browser side: controller and keyboard input, lobby, drawing, main loop.

import * as C from './core.js';
import { makeAI, aiInput } from './ai.js';
import { Music } from './music.js';

const W = 1920;
const H = 1080;
const SEATS = 4;
const PCOL = ['#ff6b6b', '#4d9dff', '#ffd84d', '#6be3a2'];
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo'); // AI-only game that starts by itself
const SKIP = Number(PARAMS.get('skip')) || 0; // demo only: seconds to fast-forward at start
const UNTIL = PARAMS.get('until') || ''; // demo only: fast-forward until a phase (e.g. auction:trade), then SKIP more seconds
const opts = { rounds: Number(PARAMS.get('rounds')) === 6 ? 6 : 12, protect: PARAMS.has('protect'), humanPace: PARAMS.get('pace') === 'human', ownBots: PARAMS.has('ownbots') };

const music = new Music();
// Background track: the M.U.L.E. main theme (Roy Glover), streamed from the
// site where it is hosted; the game stores no copy. ?music=synth uses the
// built-in loop instead, ?music=<url> any other track.
const DEFAULT_TRACK = 'https://nu.vgmtreasurechest.com/soundtracks/m.u.l.e.-commodore-64/peefogmq/04_Main%20Theme%20%28SID%20Stereo%29.mp3';
const trackParam = PARAMS.get('music');
if (trackParam !== 'synth') music.useTrack(trackParam || DEFAULT_TRACK);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------- input ----------

const ZERO = { x: 0, y: 0, a: false, b: false, alt: false, start: false };
const padPrev = [];
const padPrevX = [];
let padIn = [];

function pollPads() {
  let pads = [];
  try {
    pads = navigator.getGamepads ? navigator.getGamepads() : [];
  } catch (e) {
    pads = [];
  }
  padIn = [];
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p || !p.connected) {
      padIn.push(null);
      padPrev[i] = null;
      continue;
    }
    const prev = padPrev[i] || [];
    const down = p.buttons.map((b) => b.pressed);
    const edge = (n) => !!down[n] && !prev[n];
    let x = Math.abs(p.axes[0] || 0) > 0.25 ? p.axes[0] : 0;
    let y = Math.abs(p.axes[1] || 0) > 0.25 ? p.axes[1] : 0;
    if (down[14]) x = -1;
    if (down[15]) x = 1;
    if (down[12]) y = -1;
    if (down[13]) y = 1;
    const px = padPrevX[i] || 0;
    const left = (x < -0.5 && px >= -0.5) || edge(14);
    const right = (x > 0.5 && px <= 0.5) || edge(15);
    padIn.push({ x, y, a: edge(0), b: edge(1), alt: edge(2), start: edge(9), music: edge(3), lb: edge(4), rb: edge(5), left, right });
    if (down.some((d, k) => d && !prev[k])) music.start();
    padPrev[i] = down;
    padPrevX[i] = x;
  }
}

const keysDown = new Set();
const keysHit = new Set();
window.addEventListener('keydown', (e) => {
  if (!e.repeat) keysHit.add(e.code);
  keysDown.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('keydown', () => music.start(), { once: false });
window.addEventListener('pointerdown', () => music.start());

function keyboardInput() {
  const k = (c) => keysDown.has(c);
  return {
    x: (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0),
    y: (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0),
    a: keysHit.has('Space'),
    b: keysHit.has('Escape') || keysHit.has('KeyB'),
    alt: keysHit.has('KeyX'),
    start: keysHit.has('Enter'),
    music: keysHit.has('KeyM'),
    lb: keysHit.has('KeyP'),
    rb: keysHit.has('KeyO'),
    left: keysHit.has('ArrowLeft') || keysHit.has('KeyA'),
    right: keysHit.has('ArrowRight') || keysHit.has('KeyD'),
  };
}

// ---------- lobby and game setup ----------

let mode = 'lobby';
let lobby = new Array(SEATS).fill(null); // { src: 'pad'|'kbd', pad, char, ready }
if (PARAMS.has('lobbydemo')) {
  // for screenshots: a lobby with people in it
  lobby = [
    { src: 'kbd', char: 0, ready: true },
    { src: 'pad', pad: 0, char: 1, ready: false },
    { src: 'pad', pad: 1, char: 2, ready: true },
    { src: 'pad', pad: 2, char: 3, ready: false },
  ];
}
let seats = [];
let ais = [];
let game = null;
let overTimer = 0;

// One player's lobby input: join, browse characters, ready up, leave.
function lobbySeatInput(inp, seat, join) {
  if (seat < 0) {
    if (inp.a) {
      const free = lobby.indexOf(null);
      if (free >= 0) lobby[free] = join({ char: free % C.CHARACTERS.length, ready: false });
    }
    return;
  }
  const s = lobby[seat];
  if (!s.ready) {
    if (inp.left) s.char = (s.char + C.CHARACTERS.length - 1) % C.CHARACTERS.length;
    if (inp.right) s.char = (s.char + 1) % C.CHARACTERS.length;
    if (inp.a) s.ready = true;
    else if (inp.b) lobby[seat] = null;
  } else if (inp.b) s.ready = false;
}

function updateLobby() {
  let start = false;
  padIn.forEach((p, i) => {
    if (!p) return;
    const seat = lobby.findIndex((s) => s && s.src === 'pad' && s.pad === i);
    lobbySeatInput(p, seat, (base) => ({ src: 'pad', pad: i, ...base }));
    if (p.start) start = true;
    if (p.alt) opts.rounds = opts.rounds === 12 ? 6 : 12;
    if (p.lb) opts.protect = !opts.protect;
    if (p.rb) opts.ownBots = !opts.ownBots;
  });
  const kb = keyboardInput();
  if (kb.alt) opts.rounds = opts.rounds === 12 ? 6 : 12;
  if (kb.lb) opts.protect = !opts.protect;
  if (kb.rb) opts.ownBots = !opts.ownBots;
  const kbSeat = lobby.findIndex((s) => s && s.src === 'kbd');
  lobbySeatInput(kb, kbSeat, (base) => ({ src: 'kbd', ...base }));
  if (kb.start) start = true;
  const joined = lobby.filter(Boolean);
  if (start && joined.every((s) => s.ready)) startGame();
}

function startGame() {
  seats = lobby.slice();
  let hedgies = 0;
  const used = {};
  const defs = seats.map((s) => {
    if (!s) return { kind: 'ai', name: `Hedgie ${++hedgies}`, char: 'hedgie' };
    const c = C.CHARACTERS[s.char];
    used[c.id] = (used[c.id] || 0) + 1;
    return { kind: 'human', name: c.name, char: c.id };
  });
  // Two of the same character get numbered.
  defs.forEach((d) => {
    if (used[d.char] > 1) {
      used[d.char + ':n'] = (used[d.char + ':n'] || 0) + 1;
      d.name = `${d.name} ${used[d.char + ':n']}`;
    }
  });
  ais = seats.map(() => makeAI());
  game = C.newGame(defs, Math.random, opts);
  mode = 'game';
  overTimer = 0;
}

function seatInput(i, dt) {
  const s = seats[i];
  if (!s) return aiInput(game, i, ais[i], dt);
  if (s.src === 'kbd') return keyboardInput();
  return padIn[s.pad] || ZERO;
}

// ---------- drawing helpers ----------

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(str, x, y, size, color, align = 'left', weight = 700) {
  ctx.font = `${weight} ${size}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function money(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

const stars = [];
for (let i = 0; i < 160; i++) stars.push([Math.random() * W, Math.random() * H, Math.random() * 1.8 + 0.4]);

function drawBackground() {
  ctx.fillStyle = '#0a0c13';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#56607a';
  stars.forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  });
}

// Goods icons: a chicken nugget, an energy-drink can, a microchip, and
// the diamond hands. `size` is roughly the icon's height.
function drawGoodIcon(id, x, y, size) {
  const k = size / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  if (id === 'tendies') {
    ctx.fillStyle = '#e0a23a';
    ctx.beginPath();
    ctx.moveTo(-20, -4);
    ctx.bezierCurveTo(-22, -18, -6, -22, 2, -16);
    ctx.bezierCurveTo(10, -22, 24, -14, 20, -2);
    ctx.bezierCurveTo(26, 8, 14, 20, 2, 16);
    ctx.bezierCurveTo(-8, 22, -24, 12, -20, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2c65c';
    ctx.beginPath();
    ctx.ellipse(-4, -4, 10, 7, -0.4, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#b97a1e';
    [[-12, 4], [6, 8], [10, -8], [-2, 10]].forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, 7);
      ctx.fill();
    });
  } else if (id === 'fuel') {
    // slim can: silver with a blue band and a red emblem on a yellow sun
    ctx.fillStyle = '#c9d1dc';
    rr(-9, -22, 18, 44, 4);
    ctx.fill();
    ctx.fillStyle = '#1f4fd0';
    ctx.beginPath();
    ctx.moveTo(-9, -8);
    ctx.lineTo(9, -16);
    ctx.lineTo(9, 22);
    ctx.lineTo(-9, 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f5c400';
    ctx.beginPath();
    ctx.arc(0, 2, 7, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#d81e1e';
    ctx.beginPath();
    ctx.moveTo(-6, 4);
    ctx.lineTo(-1, -2);
    ctx.lineTo(1, -2);
    ctx.lineTo(6, 4);
    ctx.lineTo(2, 3);
    ctx.lineTo(-2, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8f99a8';
    rr(-9, -24, 18, 4, 2);
    ctx.fill();
  } else if (id === 'chips') {
    ctx.fillStyle = '#2c3340';
    rr(-14, -14, 28, 28, 4);
    ctx.fill();
    ctx.fillStyle = '#b6e35a';
    rr(-7, -7, 14, 14, 2);
    ctx.fill();
    ctx.fillStyle = '#d9b84a';
    for (let i = -9; i <= 9; i += 6) {
      ctx.fillRect(i - 1.5, -20, 3, 6);
      ctx.fillRect(i - 1.5, 14, 3, 6);
      ctx.fillRect(-20, i - 1.5, 6, 3);
      ctx.fillRect(14, i - 1.5, 6, 3);
    }
  } else if (id === 'diamonds') {
    ctx.font = '34px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('💎🙌', 0, 2);
  }
  ctx.restore();
}

// A four-legged robot dog. The tool it carries rides on its back. Legs trot
// when it is moving; `facing` is 1 for right, -1 for left.
function drawBot(x, y, outfit, scale = 1, opts = {}) {
  const o = outfit >= 0 ? C.OUTFITS[outfit] : null;
  const now = opts.now || 0;
  const moving = !!opts.moving;
  const facing = opts.facing || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * facing, scale);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 22, 32, 6, 0, 0, 7);
  ctx.fill();

  // legs: hip positions along the body; a trot pairs diagonal legs
  const hips = [
    [-20, 1, 0],
    [-14, -1, Math.PI],
    [14, -1, Math.PI],
    [20, 1, 0],
  ];
  const t = now / 80;
  hips.forEach(([hx, side, phase], i) => {
    const swing = moving ? Math.sin(t + phase) * 0.55 : 0;
    const lift = moving ? Math.max(0, Math.sin(t + phase)) * 3 : 0;
    const kx = hx + Math.sin(swing) * 10;
    const ky = 8 + Math.cos(swing) * 10 - lift;
    const fx = kx + Math.sin(swing * 0.6) * 8;
    const fy = ky + 10 - lift * 0.4;
    ctx.strokeStyle = side > 0 ? '#aeb7c6' : '#7d8797';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, 2);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = '#2c3340';
    ctx.beginPath();
    ctx.arc(fx, fy + 1, 3.2, 0, 7);
    ctx.fill();
    void i;
  });

  // body
  const bob = moving ? Math.sin(t * 2) * 1.2 : 0;
  ctx.translate(0, bob);
  ctx.fillStyle = '#dfe5ee';
  rr(-30, -12, 60, 22, 9);
  ctx.fill();
  ctx.fillStyle = '#b8c1cf';
  rr(-30, -2, 60, 12, 8);
  ctx.fill();
  // head, out front
  ctx.fillStyle = '#e8edf4';
  rr(22, -18, 22, 16, 6);
  ctx.fill();
  ctx.fillStyle = '#1a2030';
  rr(30, -15, 12, 7, 3);
  ctx.fill();
  ctx.fillStyle = '#7ef0ff';
  ctx.fillRect(33, -14, 7, 4);
  // tail stub
  ctx.strokeStyle = '#b8c1cf';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, -8);
  ctx.lineTo(-38, -16);
  ctx.stroke();
  // tool mount on the back
  if (o) {
    ctx.fillStyle = o.color;
    rr(-12, -26, 24, 16, 5);
    ctx.fill();
    ctx.save();
    ctx.scale(facing, 1);
    text(o.letter, 0, -17, 14, '#141821', 'center', 800);
    ctx.restore();
  } else {
    ctx.strokeStyle = '#8f99a8';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    rr(-12, -26, 24, 16, 5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// Characters. Drawn to about 60px tall at scale 1, feet at y.
function drawCharacter(id, x, y, scale, color, facing = 1, now = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * facing, scale);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 26, 7, 0, 0, 7);
  ctx.fill();
  const eye = (ex, ey, r = 2.6) => {
    ctx.fillStyle = '#141821';
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, 7);
    ctx.fill();
  };
  if (id === 'hedgie') {
    ctx.fillStyle = '#3a4152';
    rr(-22, -38, 44, 38, 10);
    ctx.fill();
    ctx.fillStyle = '#f1f3f6';
    ctx.beginPath();
    ctx.moveTo(-8, -38);
    ctx.lineTo(8, -38);
    ctx.lineTo(0, -22);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4, -36);
    ctx.lineTo(4, -36);
    ctx.lineTo(3, -14);
    ctx.lineTo(0, -9);
    ctx.lineTo(-3, -14);
    ctx.fill();
    ctx.fillStyle = '#e3c4a4';
    ctx.beginPath();
    ctx.arc(0, -54, 18, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#2a2f3c';
    ctx.beginPath();
    ctx.arc(0, -60, 18, Math.PI, 0);
    ctx.fill();
    eye(-6, -55);
    eye(6, -55);
  } else if (id === 'ape') {
    // gorilla in a blue suit, red tie, a diamond in each fist
    ctx.fillStyle = '#2f5fd8';
    rr(-26, -42, 52, 42, 10);
    ctx.fill();
    ctx.fillStyle = '#f1f3f6';
    ctx.beginPath();
    ctx.moveTo(-9, -42);
    ctx.lineTo(9, -42);
    ctx.lineTo(0, -24);
    ctx.fill();
    ctx.fillStyle = '#e03a3a';
    ctx.beginPath();
    ctx.moveTo(-4, -40);
    ctx.lineTo(4, -40);
    ctx.lineTo(3, -16);
    ctx.lineTo(0, -10);
    ctx.lineTo(-3, -16);
    ctx.fill();
    ctx.fillStyle = '#3b3f47';
    ctx.beginPath();
    ctx.arc(0, -58, 20, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#6a6f78';
    ctx.beginPath();
    ctx.ellipse(0, -52, 13, 10, 0, 0, 7);
    ctx.fill();
    eye(-6, -60);
    eye(6, -60);
    ctx.fillStyle = '#3b3f47';
    ctx.beginPath();
    ctx.arc(-30, -40, 8, 0, 7);
    ctx.arc(30, -40, 8, 0, 7);
    ctx.fill();
    [-30, 30].forEach((dx) => {
      ctx.fillStyle = '#4fd0ff';
      ctx.beginPath();
      ctx.moveTo(dx, -58);
      ctx.lineTo(dx + 8, -50);
      ctx.lineTo(dx, -38);
      ctx.lineTo(dx - 8, -50);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(dx - 3, -54);
      ctx.lineTo(dx + 1, -52);
      ctx.lineTo(dx - 2, -48);
      ctx.fill();
    });
  } else if (id === 'autist') {
    // white shirt, pocket full of pens, glasses, messy brown hair
    ctx.fillStyle = '#f4f6f9';
    rr(-22, -40, 44, 40, 10);
    ctx.fill();
    ctx.fillStyle = color;
    rr(8, -36, 10, 10, 2);
    ctx.fill();
    ['#e03a3a', '#2f5fd8', '#141821'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(9 + i * 3, -42, 2, 8);
    });
    ctx.fillStyle = '#efc9a4';
    ctx.beginPath();
    ctx.arc(0, -56, 17, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#7a4a22';
    ctx.beginPath();
    ctx.moveTo(-18, -58);
    ctx.lineTo(-12, -76);
    ctx.lineTo(-4, -66);
    ctx.lineTo(2, -78);
    ctx.lineTo(8, -66);
    ctx.lineTo(16, -74);
    ctx.lineTo(18, -58);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#141821';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-14, -60, 11, 8);
    ctx.strokeRect(3, -60, 11, 8);
    ctx.beginPath();
    ctx.moveTo(-3, -56);
    ctx.lineTo(3, -56);
    ctx.stroke();
    eye(-8, -56, 2);
    eye(8, -56, 2);
    ctx.strokeStyle = '#3ddc84';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-40, -30);
    ctx.lineTo(-34, -40);
    ctx.lineTo(-30, -34);
    ctx.lineTo(-24, -48);
    ctx.stroke();
  } else if (id === 'degen') {
    // stained yellow shirt, stubble, heavy eyes, an energy drink
    ctx.fillStyle = '#d9c64a';
    rr(-28, -40, 56, 40, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,90,20,0.5)';
    ctx.beginPath();
    ctx.arc(8, -22, 5, 0, 7);
    ctx.arc(-10, -14, 3, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath();
    ctx.arc(0, -56, 19, 0, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(80,60,40,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, -46, 13, 7, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#6b4a2b';
    [-10, -4, 3, 9].forEach((hx) => {
      ctx.fillRect(hx, -76, 2, 6);
    });
    ctx.fillStyle = '#141821';
    ctx.fillRect(-11, -58, 8, 3);
    ctx.fillRect(3, -58, 8, 3);
    ctx.fillStyle = 'rgba(90,40,60,0.4)';
    ctx.fillRect(-11, -55, 8, 3);
    ctx.fillRect(3, -55, 8, 3);
    ctx.fillStyle = '#e03a3a';
    rr(26, -34, 9, 16, 2);
    ctx.fill();
  } else if (id === 'smooth') {
    // a pink brain, perfectly smooth, with a couple of friendly eyes
    ctx.fillStyle = '#f2a8c0';
    ctx.beginPath();
    ctx.ellipse(0, -36, 34, 30, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#e88aaa';
    ctx.beginPath();
    ctx.ellipse(-2, -20, 24, 10, 0, 0, 7);
    ctx.fill();
    ctx.strokeStyle = '#d8789a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -66);
    ctx.quadraticCurveTo(4, -40, 0, -24);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-9, -40, 5, 0, 7);
    ctx.arc(9, -40, 5, 0, 7);
    ctx.fill();
    eye(-8, -40, 2.4);
    eye(10, -40, 2.4);
    ctx.fillStyle = color;
    rr(-12, -10, 24, 8, 4);
    ctx.fill();
  }
  ctx.restore();
}

function drawWalker(x, y, color, isAI, facing, charId) {
  drawCharacter(charId || (isAI ? 'hedgie' : 'ape'), x, y + 34, 1, color, facing);
}

function drawCoin(x, y, now) {
  // A small spinning gold coin.
  const spin = Math.abs(Math.cos(now / 110));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(0.15, spin), 1);
  ctx.fillStyle = '#f7931a';
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, 7);
  ctx.fill();
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 3;
  ctx.stroke();
  text('₿', 0, 1, 22, '#fff8e6', 'center', 800);
  ctx.restore();
  // glint
  ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * spin})`;
  ctx.beginPath();
  ctx.arc(x - 8, y - 10, 3, 0, 7);
  ctx.fill();
}

function drawGem(x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.8, y - size * 0.3);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * 0.8, y - size * 0.3);
  ctx.closePath();
  ctx.fill();
}

// ---------- map ----------

function paintTerrain(t, x, y, w, h) {
  const base = { plain: '#555b68', dip: '#2c6152', crater: '#474c59', ridge: '#655f6e' }[t.type];
  ctx.fillStyle = base;
  rr(x, y, w, h, 10);
  ctx.fill();

  ctx.save();
  rr(x, y, w, h, 10);
  ctx.clip();
  if (t.type === 'dip') {
    ctx.strokeStyle = '#3f8a72';
    ctx.lineWidth = 5;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(x, y + 34 + k * 34);
      ctx.bezierCurveTo(x + w * 0.3, y + 14 + k * 34, x + w * 0.7, y + 54 + k * 34, x + w, y + 34 + k * 34);
      ctx.stroke();
    }
  } else if (t.type === 'crater') {
    [
      [0.33, 0.4, 30],
      [0.7, 0.66, 20],
    ].forEach(([fx, fy, r]) => {
      ctx.fillStyle = '#343844';
      ctx.beginPath();
      ctx.ellipse(x + w * fx, y + h * fy, r, r * 0.6, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = '#6b7282';
      ctx.lineWidth = 3;
      ctx.stroke();
    });
  } else if (t.type === 'ridge') {
    for (let k = 0; k < t.level; k++) {
      const px = x + w * (0.25 + k * 0.25);
      ctx.fillStyle = '#8b8496';
      ctx.beginPath();
      ctx.moveTo(px - 30, y + h - 22);
      ctx.lineTo(px, y + 30);
      ctx.lineTo(px + 30, y + h - 22);
      ctx.fill();
      ctx.fillStyle = '#b9b3c4';
      ctx.beginPath();
      ctx.moveTo(px - 9, y + 54);
      ctx.lineTo(px, y + 30);
      ctx.lineTo(px + 9, y + 54);
      ctx.fill();
    }
  }
  ctx.restore();
  if (t.assayed) {
    for (let k = 0; k < 3; k++) drawGem(x + w - 18 - k * 20, y + 16, 8, k < t.dia ? '#c9a4ff' : 'rgba(0,0,0,0.35)');
  }
}

function drawTile(t, now) {
  if (t.exchange) return;
  const x = C.MAP_X + t.c * C.TILE_W + 3;
  const y = C.MAP_Y + t.r * C.TILE_H + 3;
  const w = C.TILE_W - 6;
  const h = C.TILE_H - 6;
  paintTerrain(t, x, y, w, h);

  if (t.forSale) {
    ctx.fillStyle = '#ffd84d';
    rr(x + 8, y + h - 34, 96, 26, 6);
    ctx.fill();
    text('FOR SALE', x + 56, y + h - 21, 15, '#141821', 'center', 800);
  }

  if (t.owner >= 0) {
    ctx.strokeStyle = PCOL[t.owner];
    ctx.lineWidth = 7;
    rr(x + 4, y + 4, w - 8, h - 8, 8);
    ctx.stroke();
    ctx.fillStyle = PCOL[t.owner];
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + 40, y + 4);
    ctx.lineTo(x + 4, y + 40);
    ctx.fill();
    const mine = game.phase === 'walk' && game.turn.seat === t.owner;
    ctx.globalAlpha = mine ? 1 : 0.45;
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, 20, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (t.bot >= 0) drawBot(x + w / 2, y + h / 2 + 12, t.bot, 1.05, { now });
}

function drawExchange() {
  const x = C.MAP_X + 4 * C.TILE_W + 3;
  const y = C.MAP_Y + 2 * C.TILE_H + 3;
  const w = 2 * C.TILE_W - 6;
  const h = 2 * C.TILE_H - 6;
  ctx.fillStyle = '#161c2b';
  rr(x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = '#3ddc84';
  ctx.lineWidth = 5;
  ctx.stroke();
  text('THE EXCHANGE', x + w / 2, y + 44, 34, '#3ddc84', 'center', 800);
  text('bots · tools · assay · land · bar', x + w / 2, y + 78, 18, '#7f8ba1', 'center', 500);
  ctx.strokeStyle = '#3ddc84';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  [
    [0.1, 0.86],
    [0.25, 0.7],
    [0.36, 0.78],
    [0.52, 0.56],
    [0.64, 0.64],
    [0.88, 0.4],
  ].forEach(([fx, fy], i) => (i ? ctx.lineTo(x + w * fx, y + h * fy) : ctx.moveTo(x + w * fx, y + h * fy)));
  ctx.stroke();
  ctx.fillStyle = '#3ddc84';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.93, y + h * 0.34);
  ctx.lineTo(x + w * 0.82, y + h * 0.38);
  ctx.lineTo(x + w * 0.9, y + h * 0.48);
  ctx.fill();
}

function drawMap(now) {
  game.tiles.forEach((t) => drawTile(t, now));
  drawExchange();
  if (game.coin) drawCoin(game.coin.x, game.coin.y, now);
  if (game.flash) {
    const t = game.tiles[game.flash.tile];
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, game.flash.t)})`;
    rr(C.MAP_X + t.c * C.TILE_W + 3, C.MAP_Y + t.r * C.TILE_H + 3, C.TILE_W - 6, C.TILE_H - 6, 10);
    ctx.fill();
  }
}

// ---------- town ----------

function drawTown(now) {
  const tu = game.turn;
  const p = game.players[tu.seat];
  ctx.fillStyle = '#141a27';
  ctx.fillRect(0, C.TOWN.floorTop - 50, W, C.TOWN.floorBottom - C.TOWN.floorTop + 100);
  ctx.strokeStyle = '#1f2838';
  ctx.lineWidth = 2;
  for (let x = 0; x < W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, C.TOWN.floorTop - 50);
    ctx.lineTo(x, C.TOWN.floorBottom + 50);
    ctx.stroke();
  }
  for (let y = C.TOWN.floorTop - 50; y < C.TOWN.floorBottom + 50; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  [
    [C.TOWN.exitLeft - 40, '◀ OUT'],
    [C.TOWN.exitRight + 40, 'OUT ▶'],
  ].forEach(([x, label]) => {
    ctx.fillStyle = '#0a0c13';
    ctx.fillRect(x - 40, C.TOWN.floorTop, 80, C.TOWN.floorBottom - C.TOWN.floorTop);
    text(label, x, 540, 26, '#7f8ba1', 'center', 800);
  });

  const price = C.botPrice(game);
  C.TOWN.buildings.forEach((b) => {
    const o = b.outfit !== undefined ? C.OUTFITS[b.outfit] : null;
    const col = o ? o.color : b.id === 'lot' ? '#cfd6e0' : b.id === 'pub' ? '#ff8ad8' : b.id === 'land' ? '#ffd84d' : '#c9a4ff';
    ctx.fillStyle = '#1d2638';
    rr(b.x, b.y, b.w, b.h, 16);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = col;
    rr(b.x, b.y, b.w, 56, 16);
    ctx.fill();
    ctx.fillRect(b.x, b.y + 30, b.w, 26);
    text(b.name.toUpperCase(), b.x + b.w / 2, b.y + 29, 28, '#0a0c13', 'center', 800);
    let l1 = '';
    let l2 = '';
    if (b.id === 'lot') {
      l1 = price === null ? 'SOLD OUT' : `Bot: ${money(price)}`;
      l2 = `${game.store.bots} in stock · return a bot here for a refund`;
      drawBot(b.x + b.w / 2, b.y + 150, -1, 1.1, { now });
    } else if (o) {
      l1 = `${o.tool}: ${money(o.cost)}`;
      l2 = `makes ${o.name}`;
      drawGoodIcon(o.id, b.x + 70, b.y + 140, o.id === 'diamonds' ? 52 : 56);
      drawBot(b.x + b.w / 2 + 50, b.y + 150, b.outfit, 1.0, { now });
    } else if (b.id === 'assay') {
      l1 = 'Check a plot for diamonds';
      l2 = 'fetch a sample, bring it back';
      drawGem(b.x + b.w / 2, b.y + 140, 30, '#c9a4ff');
    } else if (b.id === 'land') {
      l1 = 'Sell a plot you own';
      l2 = 'then press A on your plot';
      text('🏷️', b.x + b.w / 2, b.y + 140, 54, '#fff', 'center');
    } else if (b.id === 'pub') {
      const base = 50 + (game.round - 1) * 18;
      l1 = 'YOLO the rest of your turn';
      l2 = `up to ${money(base)} · the sooner, the more`;
      text('🍺', b.x + b.w / 2, b.y + 140, 60, '#fff', 'center');
    }
    text(l1, b.x + b.w / 2, b.y + 80, 24, '#f1f4f8', 'center');
    text(l2, b.x + b.w / 2, b.y + b.h - 22, 17, '#9aa7bd', 'center', 500);
  });

  if (tu.hasBot) drawBot(tu.bx, tu.by, tu.outfit, 0.9, { now, moving: tu.moving, facing: tu.facing });
  drawWalker(tu.x, tu.y, PCOL[tu.seat], p.kind === 'ai', tu.facing, p.char);
  if (tu.assay === 'have-sample') text('🧪', tu.x + 34, tu.y - 40, 30, '#fff', 'center');
}

// ---------- HUD ----------

function drawPanels() {
  game.players.forEach((p, i) => {
    const x = 80 + i * 445;
    const y = 962;
    const active = (game.phase === 'walk' && game.turn.seat === i) || (game.phase === 'claim' && !p.claimed);
    ctx.fillStyle = active ? '#263049' : '#161b28';
    rr(x, y, 425, 104, 12);
    ctx.fill();
    if (game.phase === 'walk' && game.turn.seat === i) {
      ctx.strokeStyle = PCOL[i];
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.fillStyle = PCOL[i];
    rr(x, y, 16, 104, 8);
    ctx.fill();
    text(p.name, x + 36, y + 24, 28, '#f1f4f8');
    text(money(p.money), x + 410, y + 24, 28, '#3ddc84', 'right', 800);
    text(`${C.countPlots(game, i)} plots · ${C.countBots(game, i)} bots`, x + 36, y + 52, 18, '#9aa7bd', 'left', 500);
    let gx = x + 36;
    C.OUTFITS.forEach((o) => {
      drawGoodIcon(o.id, gx + 12, y + 82, o.id === 'diamonds' ? 22 : 24);
      text(String(p.goods[o.id]), gx + (o.id === 'diamonds' ? 44 : 34), y + 82, 22, '#dfe6f1', 'left', 600);
      gx += 94;
    });
  });
}

function drawTopBar(hint, hintColor = '#c8d2e3') {
  text('TENDIE TOWN', 80, 52, 40, '#3ddc84', 'left', 800);
  text(`Round ${game.round}/${game.rounds}`, 380, 52, 28, '#9aa7bd', 'left', 600);
  text(hint, 1840, 52, 26, hintColor, 'right', 500);
}

function drawTimer(tu) {
  // The bar is scaled to a full-length turn, so a hungry player's shorter
  // turn shows as a shorter bar from the start.
  const full = 1760 * (tu.length / C.FULL_TURN);
  const frac = Math.max(0, tu.t / tu.length);
  ctx.fillStyle = '#1d2638';
  rr(80, 78, 1760, 14, 7);
  ctx.fill();
  if (tu.length < C.FULL_TURN) {
    ctx.fillStyle = 'rgba(255,107,107,0.25)';
    rr(80 + full, 78, 1760 - full, 14, 7);
    ctx.fill();
  }
  ctx.fillStyle = frac < 0.2 ? '#ff6b6b' : PCOL[tu.seat];
  rr(80, 78, full * frac, 14, 7);
  ctx.fill();
  const p = game.players[tu.seat];
  if (p.foodShort > 0) text(`HUNGRY — ${p.foodShort} tendie${p.foodShort > 1 ? 's' : ''} short last round, ${tu.length}s turn`, 80 + full + 12, 85, 16, '#ff6b6b', 'left', 800);
}

function drawToasts() {
  game.toasts.forEach((t, i) => {
    const y = 905 - i * 58;
    ctx.fillStyle = 'rgba(8,10,16,0.88)';
    rr(W / 2 - 600, y - 24, 1200, 50, 25);
    ctx.fill();
    text(t.text, W / 2, y + 1, 26, '#ffd84d', 'center', 700);
  });
}

// ---------- auction ----------

function drawAuction() {
  const a = game.auction;
  const o = C.OUTFITS[a.gi];
  const st = game.store;
  drawTopBar(`Trading floor ${a.gi + 1} of 4`);
  text(`${o.name.toUpperCase()} AUCTION`, W / 2 + 40, 150, 64, o.color, 'center', 800);
  drawGoodIcon(o.id, W / 2 - 40 - ctx.measureText(`${o.name.toUpperCase()} AUCTION`).width / 2, 150, 64);

  const sells = a.good !== 'diamonds' && st.stock[a.good] > 0;
  const stockText = a.good === 'diamonds' ? 'has buyers offworld' : `has ${st.stock[a.good]} in stock`;
  const sellText = sells ? `sells at ${money(st.sell[a.good])}` : 'has NOTHING to sell — no ceiling';
  text(`The Exchange ${stockText} · ${sellText} · buys at ${money(st.buy[a.good])}`, W / 2, 205, 26, sells ? '#c8d2e3' : '#ffd84d', 'center', 500);

  const top = 280;
  const bottom = 840;
  const yOf = (price) => bottom - (price / a.axisMax) * (bottom - top);
  const colX = (i) => 480 + i * 320;

  if (a.stage === 'chart') {
    drawGoodChart(a.gi, a.age, top, bottom);
    return;
  }
  if (a.stage === 'declare') {
    text(`Buying or selling? ${Math.ceil(a.t)}`, W / 2, 262, 40, '#fff', 'center', 800);
    game.players.forEach((p, i) => {
      const x = colX(i);
      const role = a.roles[i];
      const y = role === 'buy' ? bottom - 130 : top + 60;
      drawWalker(x, y, PCOL[i], p.kind === 'ai', 1, p.char);
      text(p.name, x, y + 60, 24, '#f1f4f8', 'center');
      text(role === 'buy' ? 'BUYING' : 'SELLING', x, y + 90, 26, role === 'buy' ? '#6be3a2' : '#ff8ad8', 'center', 800);
      text(`has ${p.goods[a.good]} · ${money(p.money)}`, x, y + 118, 20, '#9aa7bd', 'center', 500);
    });
    text('Stick UP to be a buyer · stick DOWN to be a seller · everyone is on the floor', W / 2, 900, 28, '#9aa7bd', 'center', 500);
    return;
  }

  ctx.fillStyle = '#10151f';
  rr(300, top - 20, 1320, bottom - top + 40, 16);
  ctx.fill();
  ctx.strokeStyle = '#2a3447';
  ctx.lineWidth = 2;
  for (let p = 0; p <= a.axisMax; p += a.axisMax / 6) {
    const y = yOf(p);
    ctx.beginPath();
    ctx.moveTo(300, y);
    ctx.lineTo(1620, y);
    ctx.stroke();
    text(money(p), 285, y, 20, '#7f8ba1', 'right', 500);
  }
  text('SELLERS ▼', W / 2, top - 40, 22, '#ff8ad8', 'center', 800);
  text('BUYERS ▲', W / 2, bottom + 28, 22, '#6be3a2', 'center', 800);

  const dashed = (price, color, label) => {
    const y = yOf(price);
    ctx.strokeStyle = color;
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(300, y);
    ctx.lineTo(1620, y);
    ctx.stroke();
    ctx.setLineDash([]);
    text(label, 1630, y, 20, color, 'left', 600);
  };
  if (sells) dashed(st.sell[a.good], 'rgba(61,220,132,0.6)', `Exchange sells ${money(st.sell[a.good])}`);
  dashed(st.buy[a.good], 'rgba(255,138,216,0.6)', `Exchange buys ${money(st.buy[a.good])}`);

  const L = a.lines || {};
  const solid = (price, color, label, above) => {
    const y = yOf(price);
    ctx.fillStyle = color;
    ctx.fillRect(300, y - 3, 1320, 6);
    text(label, 310, y + (above ? -18 : 18), 20, color, 'left', 800);
  };
  if (L.sell !== null && L.sell !== undefined) solid(L.sell, '#ff8ad8', `SELL LINE ${money(L.sell)}`, true);
  if (L.buy !== null && L.buy !== undefined) solid(L.buy, '#6be3a2', `BUY LINE ${money(L.buy)}`, false);

  // Everyone keeps their own column; buyers rise from the bottom, sellers
  // drop from the top.
  game.players.forEach((p, i) => {
    const x = colX(i);
    const role = a.roles[i];
    const buyer = role === 'buy';
    const y = yOf(a.price[i]);
    ctx.globalAlpha = a.active[i] ? 1 : 0.4;
    ctx.fillStyle = PCOL[i];
    ctx.fillRect(x - 50, y - 3, 100, 6);
    drawWalker(x, buyer ? y + 30 : y - 30, PCOL[i], p.kind === 'ai', 1, p.char);
    // Sellers parked at the very top get their tag below the line instead.
    const tagY = buyer ? y + 82 : a.price[i] > a.axisMax * 0.85 ? y + 22 : y - 86;
    text(money(a.price[i]), x, tagY, 22, '#fff', 'center', 800);
    const status = a.bounced[i] || (a.active[i] ? '' : 'stepped off');
    text(status ? `${p.name} · ${status}` : p.name, x, tagY + 24, 16, '#c8d2e3', 'center', 500);
    const n = buyer ? a.bought[i] : a.sold[i];
    if (n) text(buyer ? `+${n}` : `−${n}`, x + 70, buyer ? y + 30 : y - 30, 24, buyer ? '#6be3a2' : '#ff8ad8', 'center', 800);
    ctx.globalAlpha = 1;
  });

  let label;
  if (a.stage === 'trade') label = `${Math.ceil(a.t)}s · ${a.trades} traded`;
  else if (a.trades) label = `${a.trades} traded, average ${money(a.sum / a.trades)}`;
  else label = 'No trades';
  text(label, W / 2, 910, 30, '#fff', 'center', 800);
  if (a.stage === 'trade') text('Buyers push UP, sellers push DOWN · when a buyer meets a seller, one unit trades per tick · sold out sends you to the top, broke to the bottom · stand still to do nothing · B steps off the floor', W / 2, 943, 20, '#9aa7bd', 'center', 500);
}

// ---------- report, summary, result ----------

function drawReport() {
  const r = game.report;
  drawTopBar('Production');
  text('PRODUCTION', W / 2, 150, 56, '#3ddc84', 'center', 800);
  let y = 300;
  if (r.event) {
    ctx.fillStyle = 'rgba(255,107,107,0.15)';
    rr(160, y - 44, 1600, 88, 16);
    ctx.fill();
    text(r.event.text, W / 2, y, 34, '#ff6b6b', 'center', 800);
    y += 110;
  }
  r.notes.forEach((n) => {
    text(n, W / 2, y, 26, '#ffd84d', 'center', 600);
    y += 42;
  });
  text(`A to continue (${Math.ceil(r.t)})`, W / 2, 920, 22, '#9aa7bd', 'center', 500);
}

// One good's chart: each player's bar falls for what was used and spoiled,
// then rises by what was produced. Shown right before that good's auction.
let chartKey = '';
let chartSfx = new Set();
const FALL = 1.1;
const RISE = 1.1;

function drawGoodChart(gi, age, top, bottom) {
  const o = C.OUTFITS[gi];
  const g = o.id;
  const rows = game.report ? game.report.rows : [];
  const key = `${game.round}:${gi}`;
  if (chartKey !== key) {
    chartKey = key;
    chartSfx = new Set();
  }
  if (age < FALL && !chartSfx.has('d')) {
    chartSfx.add('d');
    if (rows.some((row) => row.ledger[g].used + row.ledger[g].spoiled > 0)) music.slide(false, FALL);
  }
  if (age >= FALL && age < FALL + RISE && !chartSfx.has('u')) {
    chartSfx.add('u');
    if (rows.some((row) => row.ledger[g].produced > 0)) music.slide(true, RISE);
  }
  const baseY = bottom - 40;
  const maxH = bottom - top - 140;
  let scale = 8;
  rows.forEach((row) => {
    const L = row.ledger[g];
    scale = Math.max(scale, L.before, L.after);
  });
  ctx.fillStyle = '#10151f';
  rr(300, top - 20, 1320, bottom - top + 40, 16);
  ctx.fill();
  ctx.strokeStyle = '#2a3447';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(340, baseY);
  ctx.lineTo(1580, baseY);
  ctx.stroke();
  const stage = age < FALL ? 0 : age < FALL + RISE ? 1 : 2;
  const what = g === 'tendies' ? 'eaten and spoiled' : g === 'fuel' ? 'burned by bots and leaked' : g === 'chips' ? 'over the warehouse cap' : '';
  const caption = stage === 0 ? what : stage === 1 ? 'produced' : 'ready to trade';
  text(caption, W / 2, top + 20, 26, stage === 0 ? '#ff6b6b' : stage === 1 ? '#6be3a2' : '#c8d2e3', 'center', 800);
  rows.forEach((row, i) => {
    const L = row.ledger[g];
    const low = L.before - L.used - L.spoiled;
    let v;
    let tag = '';
    let tagColor = '#fff';
    if (stage === 0) {
      v = L.before + (low - L.before) * (age / FALL);
      if (L.used + L.spoiled) {
        tag = `−${L.used + L.spoiled}`;
        tagColor = '#ff6b6b';
      }
    } else if (stage === 1) {
      v = low + L.produced * ((age - FALL) / RISE);
      if (L.produced) {
        tag = `+${L.produced}`;
        tagColor = '#6be3a2';
      }
    } else v = L.after;
    const bw = 160;
    const x = 480 + i * 320 - bw / 2;
    const bh = Math.max(0, (v / scale) * maxH);
    ctx.fillStyle = PCOL[row.seat];
    rr(x, baseY - bh, bw, bh, 10);
    ctx.fill();
    text(String(Math.round(v)), x + bw / 2, baseY - bh - 22, 32, '#f1f4f8', 'center', 800);
    if (tag) text(tag, x + bw / 2, baseY - bh - 56, 26, tagColor, 'center', 800);
    text(game.players[row.seat].name, x + bw / 2, baseY + 24, 20, '#c8d2e3', 'center', 600);
  });
  text(stage === 2 ? 'A to open the floor' : '', W / 2, 910, 26, '#f1f4f8', 'center', 800);
}

let landSfx = '';
function drawLand(now) {
  const L = game.land;
  const lot = L.lots[L.idx];
  const t = game.tiles[lot.tile];
  // pulse the plot on the map behind the panel
  const pulse = 0.5 + 0.5 * Math.sin(now / 120);
  ctx.strokeStyle = `rgba(255,216,77,${pulse})`;
  ctx.lineWidth = 10;
  rr(C.MAP_X + t.c * C.TILE_W - 2, C.MAP_Y + t.r * C.TILE_H - 2, C.TILE_W + 4, C.TILE_H + 4, 14);
  ctx.stroke();

  const px = 300;
  const py = 170;
  const pw = 1320;
  const ph = 700;
  ctx.fillStyle = 'rgba(10,13,20,0.94)';
  rr(px, py, pw, ph, 20);
  ctx.fill();
  ctx.strokeStyle = '#ffd84d';
  ctx.lineWidth = 4;
  ctx.stroke();
  text(`LAND AUCTION · lot ${L.idx + 1} of ${L.lots.length}`, px + pw / 2, py + 44, 36, '#ffd84d', 'center', 800);

  // plot preview, drawn twice life size
  ctx.save();
  ctx.translate(px + 60, py + 110);
  ctx.scale(2, 2);
  paintTerrain(t, 0, 0, C.TILE_W - 6, C.TILE_H - 6);
  if (t.bot >= 0) drawBot((C.TILE_W - 6) / 2, (C.TILE_H - 6) / 2 + 12, t.bot, 1.05, { now });
  ctx.restore();
  const kind = { plain: 'Plains', dip: 'The Dip', crater: 'Crater', ridge: `Ridge, ${t.level} peak${t.level > 1 ? 's' : ''}` }[t.type];
  text(kind, px + 60 + (C.TILE_W - 6), py + 420, 30, '#f1f4f8', 'center', 800);
  text(`row ${t.r + 1}, column ${t.c + 1}`, px + 60 + (C.TILE_W - 6), py + 456, 20, '#9aa7bd', 'center', 500);
  text(lot.seller >= 0 ? `Sold by ${game.players[lot.seller].name}` : 'Released by the Exchange', px + 60 + (C.TILE_W - 6), py + 488, 20, '#9aa7bd', 'center', 500);
  text(`Minimum ${money(lot.min)}`, px + 60 + (C.TILE_W - 6), py + 530, 26, '#ffd84d', 'center', 800);
  if (t.assayed) text(`Assayed: ${['no', 'low', 'medium', 'HIGH'][t.dia]} diamonds`, px + 60 + (C.TILE_W - 6), py + 566, 20, '#c9a4ff', 'center', 600);

  // bids
  const bx0 = px + 520;
  const baseY = py + 560;
  const maxH = 400;
  const top = Math.max(lot.min * 2.5, Math.max(...L.bids) + 150, 800);
  const yOf = (v) => baseY - (v / top) * maxH;
  ctx.strokeStyle = 'rgba(255,216,77,0.5)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx0 - 20, yOf(lot.min));
  ctx.lineTo(bx0 + 720, yOf(lot.min));
  ctx.stroke();
  ctx.setLineDash([]);
  text(`min ${money(lot.min)}`, bx0 + 730, yOf(lot.min), 16, '#ffd84d', 'left', 600);
  game.players.forEach((p, i) => {
    const x = bx0 + 40 + i * 180;
    const bid = L.bids[i];
    const h = (bid / top) * maxH;
    const selling = i === lot.seller;
    ctx.globalAlpha = selling ? 0.25 : 1;
    ctx.fillStyle = PCOL[i];
    rr(x, baseY - h, 100, h, 8);
    ctx.fill();
    drawWalker(x + 50, baseY - h - 40, PCOL[i], p.kind === 'ai', 1, p.char);
    text(selling ? 'seller' : money(bid), x + 50, baseY - h - 96, 24, '#fff', 'center', 800);
    if (L.leader === i) text('👑 leading', x + 50, baseY - h - 124, 20, '#ffd84d', 'center', 800);
    text(p.name, x + 50, baseY + 22, 18, '#c8d2e3', 'center', 600);
    text(money(p.money), x + 50, baseY + 46, 16, '#9aa7bd', 'center', 500);
    ctx.globalAlpha = 1;
  });

  if (L.stage === 'bid') {
    text(`${Math.ceil(L.t)}s`, px + pw / 2, py + ph - 70, 44, L.t < 3 ? '#ff6b6b' : '#f1f4f8', 'center', 800);
    text('Stick UP to raise your bid, DOWN to lower it · highest bid above the minimum when the clock runs out wins · a late bid adds time', px + pw / 2, py + ph - 28, 18, '#9aa7bd', 'center', 500);
    landSfx = '';
  } else {
    if (landSfx !== `${L.idx}`) {
      landSfx = `${L.idx}`;
      if (L.sold) music.ding();
    }
    text(L.result, px + pw / 2, py + ph - 50, 28, L.sold ? '#6be3a2' : '#ff8ad8', 'center', 800);
  }
}

function drawSummary() {
  const sm = game.summary;
  drawTopBar('End of round');
  text(`ROUND ${game.round} STANDINGS`, W / 2, 150, 60, '#3ddc84', 'center', 800);
  text(`Colony worth ${money(sm.colony)} · needs ${money(60000)} by round ${game.rounds} to count as a success`, W / 2, 215, 26, sm.colony >= 60000 ? '#6be3a2' : '#c8d2e3', 'center', 500);
  let y = 300;
  sm.rows.forEach((row, k) => {
    const p = game.players[row.seat];
    ctx.fillStyle = '#161b28';
    rr(200, y - 36, 1520, 72, 12);
    ctx.fill();
    text(`${k + 1}.`, 240, y, 32, '#7f8ba1', 'left', 800);
    text(p.name, 300, y, 32, PCOL[row.seat], 'left', 800);
    text(money(row.worth), 760, y, 32, '#f1f4f8', 'right', 800);
    text(`${money(p.money)} cash · ${C.countPlots(game, row.seat)} plots · ${C.countBots(game, row.seat)} bots`, 800, y, 22, '#9aa7bd', 'left', 500);
    const g = p.goods;
    text(`${g.tendies} T · ${g.fuel} F · ${g.chips} C · ${g.diamonds} D`, 1690, y, 20, '#9aa7bd', 'right', 500);
    y += 88;
  });
  text(`The Exchange built ${sm.botsBuilt} bot${sm.botsBuilt === 1 ? '' : 's'} from chips · Bot Lot now has ${game.store.bots}`, W / 2, 700, 24, '#c8d2e3', 'center', 500);
  const ss = sm.storeSpoiled || {};
  const rotted = [];
  if (ss.tendies) rotted.push(`${ss.tendies} tendies went stale`);
  if (ss.fuel) rotted.push(`${ss.fuel} fuel leaked`);
  text(
    rotted.length ? `In the Exchange's warehouse ${rotted.join(' and ')} · it now holds ${game.store.stock.tendies} tendies, ${game.store.stock.fuel} fuel, ${game.store.stock.chips} chips` : `The Exchange holds ${game.store.stock.tendies} tendies, ${game.store.stock.fuel} fuel, ${game.store.stock.chips} chips`,
    W / 2,
    770,
    22,
    rotted.length ? '#ff8ad8' : '#9aa7bd',
    'center',
    500
  );
  text('Poorest player goes first next round', W / 2, 735, 22, '#9aa7bd', 'center', 500);
  text(`A to continue (${Math.ceil(sm.t)})`, W / 2, 920, 22, '#9aa7bd', 'center', 500);
}

function drawResult() {
  const r = game.result;
  ctx.fillStyle = 'rgba(8,10,16,0.9)';
  ctx.fillRect(0, 0, W, H);
  text('GAME OVER', W / 2, 150, 72, '#3ddc84', 'center', 800);
  text(`Colony worth ${money(r.colony)}`, W / 2, 230, 36, '#f1f4f8', 'center', 700);
  text(r.ending, W / 2, 285, 30, r.success ? '#6be3a2' : '#ff6b6b', 'center', 600);
  r.rows.forEach((row, k) => {
    const p = game.players[row.seat];
    const y = 400 + k * 80;
    text(k === 0 ? '👑' : `${k + 1}.`, 560, y, 40, '#fff', 'center');
    text(p.name, 620, y, 40, PCOL[row.seat], 'left', 800);
    text(money(row.worth), 1360, y, 40, '#f1f4f8', 'right', 800);
    if (k === r.rows.length - 1) text('Bagholder', 1400, y, 24, '#ff8ad8', 'left', 600);
  });
  text('Press A to go back to the start screen', W / 2, 820, 30, '#c8d2e3', 'center', 500);
}

// ---------- game screen ----------

function drawGame(now) {
  drawBackground();
  if (game.phase === 'auction') {
    drawAuction();
    drawPanels();
    drawToasts();
    return;
  }
  if (game.phase === 'production') {
    drawReport();
    drawPanels();
    return;
  }
  if (game.phase === 'summary') {
    drawSummary();
    drawPanels();
    return;
  }
  if (game.phase === 'over') {
    drawMap(now);
    drawPanels();
    drawResult();
    return;
  }
  if (game.phase === 'land') {
    drawTopBar('Land auction — stick UP to raise your bid');
    drawMap(now);
    drawLand(now);
    drawPanels();
    drawToasts();
    if (game.banner) {
      ctx.fillStyle = 'rgba(8,10,16,0.82)';
      ctx.fillRect(0, 440, W, 170);
      text(game.banner.text, W / 2, 525, 64, '#ffffff', 'center', 800);
    }
    return;
  }

  if (game.phase === 'claim') {
    drawTopBar('Land grab — press A when the scanner is on the plot you want');
    drawMap(now);
    if (!game.banner && game.claim.pos < game.claim.order.length) {
      const t = game.tiles[game.claim.order[game.claim.pos]];
      const pulse = 0.6 + 0.4 * Math.sin(now / 70);
      ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
      ctx.lineWidth = 10;
      rr(C.MAP_X + t.c * C.TILE_W - 2, C.MAP_Y + t.r * C.TILE_H - 2, C.TILE_W + 4, C.TILE_H + 4, 14);
      ctx.stroke();
    }
  } else if (game.phase === 'walk') {
    const tu = game.turn;
    const p = game.players[tu.seat];
    let hint;
    if (p.kind === 'ai') hint = 'working';
    else if (tu.scene === 'town') hint = tu.hasBot ? 'Walk into a shop to fit a tool, then leave town through an exit · B ends turn' : 'Walk into a building · B ends turn';
    else if (tu.hasBot) hint = tu.outfit >= 0 ? "A on your plot's pad installs the bot — miss and it bolts · B ends turn" : 'This bot needs a tool: go back to town';
    else if (tu.assay === 'need-sample') hint = 'Stand on a plot and press A to take a sample';
    else if (tu.assay === 'have-sample') hint = 'Take the sample back to the Assay Office';
    else if (tu.listing) hint = 'A on a plot you own lists it for sale (A again withdraws) · B ends turn';
    else hint = 'Walk into The Exchange for a bot · stand on a Bitcoin and press A to grab it · B ends turn';
    drawTopBar(`${p.name}: ${hint}`);
    drawTimer(tu);
    if (tu.scene === 'town') drawTown(now);
    else {
      drawMap(now);
      if (tu.hasBot) drawBot(tu.bx, tu.by, tu.outfit, 0.9, { now, moving: tu.moving, facing: tu.facing });
      drawWalker(tu.x, tu.y, PCOL[tu.seat], p.kind === 'ai', tu.facing, p.char);
      if (tu.assay === 'have-sample') text('🧪', tu.x + 34, tu.y - 40, 30, '#fff', 'center');
      game.runaways.forEach((r) => {
        const wob = Math.sin(now / 45) * 9;
        drawBot(r.x + wob, r.y, r.outfit, 0.9, { now, moving: true, facing: r.vx >= 0 ? 1 : -1 });
        text('!', r.x + wob + 30, r.y - 44, 40, '#ff6b6b', 'center', 800);
      });
    }
  }

  drawPanels();
  drawToasts();

  if (game.banner) {
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.fillRect(0, 440, W, 170);
    text(game.banner.text, W / 2, 525, 64, '#ffffff', 'center', 800);
  }
}

function drawLobby() {
  drawBackground();
  text('TENDIE TOWN', W / 2, 110, 100, '#3ddc84', 'center', 800);
  text('The apes made it to the moon. Now somebody has to run the place.', W / 2, 190, 30, '#c8d2e3', 'center', 500);
  const joined = lobby.filter(Boolean);
  const allReady = joined.every((s) => s.ready);
  for (let i = 0; i < SEATS; i++) {
    const x = 130 + i * 425;
    const y = 250;
    const s = lobby[i];
    ctx.fillStyle = '#161b28';
    rr(x, y, 385, 400, 16);
    ctx.fill();
    ctx.strokeStyle = PCOL[i];
    ctx.lineWidth = s ? 7 : 3;
    ctx.stroke();
    if (!s) {
      ctx.globalAlpha = 0.5;
      drawCharacter('hedgie', x + 192, y + 230, 1.8, PCOL[i]);
      ctx.globalAlpha = 1;
      text('Press A to join', x + 192, y + 300, 32, '#f1f4f8', 'center');
      text('or a Hedgie plays this seat', x + 192, y + 340, 22, '#9aa7bd', 'center', 500);
      continue;
    }
    const c = C.CHARACTERS[s.char];
    if (!s.ready) {
      text('◀', x + 40, y + 160, 40, '#9aa7bd', 'center', 800);
      text('▶', x + 345, y + 160, 40, '#9aa7bd', 'center', 800);
    }
    drawCharacter(c.id, x + 192, y + 230, 1.9, PCOL[i]);
    text(c.name.toUpperCase(), x + 192, y + 282, 32, '#f1f4f8', 'center', 800);
    text(c.blurb, x + 192, y + 316, 18, '#c8d2e3', 'center', 500);
    text(`${money(c.money)} · turns ×${c.time}`, x + 192, y + 344, 18, '#9aa7bd', 'center', 500);
    if (s.ready) {
      ctx.fillStyle = PCOL[i];
      rr(x + 100, y + 362, 185, 30, 15);
      ctx.fill();
      text('READY · B to change', x + 192, y + 377, 18, '#141821', 'center', 800);
    } else text(`${s.src === 'kbd' ? 'Keyboard' : `Controller ${s.pad + 1}`} · ◀ ▶ pick · A ready · B leave`, x + 192, y + 377, 17, '#9aa7bd', 'center', 500);
  }
  const canStart = allReady;
  text(joined.length && !allReady ? 'Waiting for everyone to press A' : 'Press the Menu button to start', W / 2, 700, 40, canStart ? '#ffffff' : '#7f8ba1', 'center', 800);
  text(`X: ${opts.rounds} rounds (${opts.rounds === 12 ? 'full game' : 'short game'})   ·   LB: starvation protection ${opts.protect ? 'ON' : 'OFF'}   ·   RB: build bots from your own chips ${opts.ownBots ? 'ON' : 'OFF'}`, W / 2, 748, 22, '#ffd84d', 'center', 600);
  text(
    `${opts.protect ? 'You cannot sell the tendies and fuel you need' : 'Sell whatever you like, go hungry if you must'} · ${opts.ownBots ? 'when the Bot Lot is sold out, 2 of your chips and $50 build you a bot' : 'only the Exchange builds bots, from chips it has bought'}`,
    W / 2,
    776,
    18,
    '#9aa7bd',
    'center',
    500
  );
  const lines = [
    'Each round: grab land → take turns buying and placing bots → production → trading floor',
    'Every turn you eat tendies (3, later 5) and each non-fuel bot burns 1 fuel · run short and your turn gets shorter',
    'The Dip grows tendies · plains and craters pump fuel · ridges mine chips · diamonds are hidden until you assay',
    `Y or M toggles music${music.muted ? ' (muted)' : ''}${music.custom ? '' : ' (built-in loop)'} · Keyboard: Space = A, B = B, X = X, P = LB, O = RB, Enter = Menu, arrows move · On Xbox, if the controllers do nothing, switch the browser to controller mode`,
  ];
  lines.forEach((l, k) => text(l, W / 2, 818 + k * 36, k === 3 ? 20 : 23, k === 3 ? '#7f8ba1' : '#c8d2e3', 'center', 500));
}

// ---------- main loop ----------

function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
}
window.addEventListener('resize', fit);
fit();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollPads();
  if (keyboardInput().music || padIn.some((p) => p && p.music)) music.toggleMute();
  if (game) {
    music.setIntensity(game.phase === 'production' || game.phase === 'summary' ? 0.6 : 1);
    // Quiet on the trading floor and at land auctions so the bidding is audible.
    music.setPaused(game.phase === 'auction' || game.phase === 'land');
  } else music.setPaused(false);

  if (mode === 'lobby') {
    if (DEMO) {
      startGame();
      const tick = () => {
        const inputs = [];
        for (let i = 0; i < SEATS; i++) inputs.push(seatInput(i, 1 / 60));
        C.update(game, inputs, 1 / 60);
      };
      if (UNTIL) {
        const [ph, st] = UNTIL.split(':');
        let guard = 0;
        while (guard++ < 60 * 60 * 30 && game.phase !== 'over') {
          if (game.phase === ph && (!st || (game.auction && game.auction.stage === st))) break;
          tick();
        }
      }
      for (let t = 0; t < SKIP; t += 1 / 60) tick();
    } else updateLobby();
  }
  if (mode === 'game') {
    const inputs = [];
    for (let i = 0; i < SEATS; i++) inputs.push(seatInput(i, dt));
    C.update(game, inputs, dt);
    if (game.phase === 'over') {
      overTimer += dt;
      const kb = keyboardInput();
      const pressed = kb.a || kb.start || padIn.some((p) => p && (p.a || p.start));
      if ((overTimer > 1 && pressed) || (DEMO && overTimer > 12)) {
        mode = 'lobby';
        game = null;
      }
    }
  }

  if (mode === 'game') drawGame(now);
  else drawLobby();
  keysHit.clear();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
