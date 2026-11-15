// Browser side: controller and keyboard input, lobby, drawing, main loop.

import * as C from './core.js';
import { makeAI, aiInput } from './ai.js';

const W = 1920;
const H = 1080;
const SEATS = 4;
const PCOL = ['#ff6b6b', '#4d9dff', '#ffd84d', '#6be3a2'];
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo'); // AI-only game that starts by itself
const SKIP = Number(PARAMS.get('skip')) || 0; // demo only: seconds to fast-forward at start

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------- input ----------

const ZERO = { x: 0, y: 0, a: false, b: false, alt: false, start: false };
const padPrev = [];
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
    padIn.push({ x, y, a: edge(0), b: edge(1), alt: edge(2), start: edge(9) });
    padPrev[i] = down;
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

function keyboardInput() {
  const k = (c) => keysDown.has(c);
  return {
    x: (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0),
    y: (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0),
    a: keysHit.has('Space'),
    b: keysHit.has('Escape') || keysHit.has('KeyB'),
    alt: keysHit.has('KeyX'),
    start: keysHit.has('Enter'),
  };
}

// ---------- lobby and game setup ----------

let mode = 'lobby';
let lobby = new Array(SEATS).fill(null); // { src: 'pad', pad } | { src: 'kbd' }
let seats = [];
let ais = [];
let game = null;
let overTimer = 0;

function updateLobby() {
  let start = false;
  padIn.forEach((p, i) => {
    if (!p) return;
    const seat = lobby.findIndex((s) => s && s.src === 'pad' && s.pad === i);
    if (p.a && seat < 0) {
      const free = lobby.indexOf(null);
      if (free >= 0) lobby[free] = { src: 'pad', pad: i };
    }
    if (p.b && seat >= 0) lobby[seat] = null;
    if (p.start) start = true;
  });
  const kb = keyboardInput();
  const kbSeat = lobby.findIndex((s) => s && s.src === 'kbd');
  if (kb.a && kbSeat < 0) {
    const free = lobby.indexOf(null);
    if (free >= 0) lobby[free] = { src: 'kbd' };
  }
  if (kb.b && kbSeat >= 0) lobby[kbSeat] = null;
  if (kb.start) start = true;
  if (start) startGame();
}

function startGame() {
  seats = lobby.slice();
  let apes = 0;
  let hedgies = 0;
  const defs = seats.map((s) =>
    s ? { kind: 'human', name: `Ape ${++apes}` } : { kind: 'ai', name: `Hedgie ${++hedgies}` }
  );
  ais = seats.map(() => makeAI());
  game = C.newGame(defs);
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

function drawBot(x, y, outfit, scale = 1) {
  const o = C.OUTFITS[outfit];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#8f99a8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.lineTo(0, -38);
  ctx.stroke();
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.arc(0, -40, 5, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#cfd6e0';
  rr(-24, -26, 48, 46, 9);
  ctx.fill();
  ctx.fillStyle = '#1a2030';
  rr(-17, -20, 34, 13, 5);
  ctx.fill();
  ctx.fillStyle = '#7ef0ff';
  ctx.fillRect(-11, -16, 6, 5);
  ctx.fillRect(5, -16, 6, 5);
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.arc(0, 6, 11, 0, 7);
  ctx.fill();
  text(o.letter, 0, 7, 16, '#141821', 'center', 800);
  ctx.restore();
}

function drawWalker(x, y, color, isAI, facing) {
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 34, 26, 8, 0, 0, 7);
  ctx.fill();
  if (isAI) {
    // Hedgie: grey suit, tie in the seat colour
    ctx.fillStyle = '#3a4152';
    rr(-22, -4, 44, 38, 10);
    ctx.fill();
    ctx.fillStyle = '#f1f3f6';
    ctx.beginPath();
    ctx.moveTo(-8, -4);
    ctx.lineTo(8, -4);
    ctx.lineTo(0, 12);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(4, -2);
    ctx.lineTo(3, 20);
    ctx.lineTo(0, 25);
    ctx.lineTo(-3, 20);
    ctx.fill();
    ctx.fillStyle = '#e3c4a4';
    ctx.beginPath();
    ctx.arc(0, -20, 18, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#2a2f3c';
    ctx.beginPath();
    ctx.arc(0, -26, 18, Math.PI, 0);
    ctx.fill();
  } else {
    // Ape: body in the seat colour
    ctx.fillStyle = color;
    rr(-22, -4, 44, 38, 14);
    ctx.fill();
    ctx.fillStyle = '#5b3d2b';
    ctx.beginPath();
    ctx.arc(-19, -22, 8, 0, 7);
    ctx.arc(19, -22, 8, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -20, 20, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#e0b48c';
    ctx.beginPath();
    ctx.ellipse(facing * 3, -15, 13, 11, 0, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#141821';
  ctx.beginPath();
  ctx.arc(facing * 3 - 6, -21, 2.6, 0, 7);
  ctx.arc(facing * 3 + 6, -21, 2.6, 0, 7);
  ctx.fill();
  ctx.restore();
}

function drawTile(t) {
  if (t.exchange) return;
  const x = C.MAP_X + t.c * C.TILE_W + 3;
  const y = C.MAP_Y + t.r * C.TILE_H + 3;
  const w = C.TILE_W - 6;
  const h = C.TILE_H - 6;
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
  }
  if (t.owner >= 0) {
    // the pad a bot has to be installed on
    const mine = game.phase === 'walk' && game.turn.seat === t.owner;
    ctx.strokeStyle = PCOL[t.owner];
    ctx.globalAlpha = mine ? 1 : 0.45;
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, 20, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (t.bot >= 0) drawBot(x + w / 2, y + h / 2 + 12, t.bot, 1.05);
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
  // a chart line that only goes up
  ctx.strokeStyle = '#3ddc84';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const pts = [
    [0.1, 0.82],
    [0.25, 0.66],
    [0.36, 0.74],
    [0.52, 0.5],
    [0.64, 0.58],
    [0.88, 0.3],
  ];
  pts.forEach(([fx, fy], i) => (i ? ctx.lineTo(x + w * fx, y + h * fy) : ctx.moveTo(x + w * fx, y + h * fy)));
  ctx.stroke();
  ctx.fillStyle = '#3ddc84';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.93, y + h * 0.24);
  ctx.lineTo(x + w * 0.82, y + h * 0.28);
  ctx.lineTo(x + w * 0.9, y + h * 0.38);
  ctx.fill();
}

function drawPanels() {
  game.players.forEach((p, i) => {
    const x = 80 + i * 445;
    const y = 968;
    const active = game.phase === 'walk' && game.turn.seat === i;
    ctx.fillStyle = active ? '#263049' : '#161b28';
    rr(x, y, 425, 96, 12);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = PCOL[i];
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.fillStyle = PCOL[i];
    rr(x, y, 16, 96, 8);
    ctx.fill();
    text(p.name, x + 36, y + 32, 32, '#f1f4f8');
    let status = `${C.countPlots(game, i)} plots · ${C.countBots(game, i)} bots`;
    if (game.phase === 'claim') status += p.claimed ? ' · claimed' : '';
    text(status, x + 36, y + 70, 24, '#9aa7bd', 'left', 500);
  });
}

function drawGame(now) {
  drawBackground();
  text('TENDIE TOWN', 80, 58, 44, '#3ddc84', 'left', 800);
  game.tiles.forEach(drawTile);
  drawExchange();

  if (game.flash) {
    const t = game.tiles[game.flash.tile];
    ctx.fillStyle = `rgba(255,255,255,${game.flash.t})`;
    rr(C.MAP_X + t.c * C.TILE_W + 3, C.MAP_Y + t.r * C.TILE_H + 3, C.TILE_W - 6, C.TILE_H - 6, 10);
    ctx.fill();
  }

  if (game.phase === 'claim') {
    text(`Round ${game.round} of ${C.ROUNDS} · Land grab — press A when the scanner is on the plot you want`, 1840, 58, 28, '#c8d2e3', 'right', 500);
    if (!game.banner) {
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
    const o = C.OUTFITS[tu.outfit];
    let hint;
    if (p.kind === 'ai') hint = `${p.name} is working`;
    else if (tu.hasBot) hint = `X: change tool (${o.tool} → ${o.name}) · A: install — stand on your plot's pad or the bot bolts · B: end turn`;
    else hint = 'Walk back to The Exchange for another bot · B: end turn';
    text(hint, 1700, 58, 28, '#c8d2e3', 'right', 500);
    text(String(Math.max(0, Math.ceil(tu.t))), 1840, 58, 48, tu.t < 5 ? '#ff6b6b' : '#f1f4f8', 'right', 800);
    if (tu.hasBot) drawBot(tu.bx, tu.by, tu.outfit, 0.9);
    drawWalker(tu.x, tu.y, PCOL[tu.seat], p.kind === 'ai', tu.facing);
  }

  game.runaways.forEach((r) => {
    const wob = Math.sin(now / 45) * 9;
    drawBot(r.x + wob, r.y, r.outfit, 0.9);
    text('!', r.x + wob + 30, r.y - 44, 40, '#ff6b6b', 'center', 800);
  });

  drawPanels();

  if (game.toast) {
    ctx.fillStyle = 'rgba(8,10,16,0.85)';
    rr(W / 2 - 520, 866, 1040, 70, 35);
    ctx.fill();
    text(game.toast.text, W / 2, 902, 36, '#ffd84d', 'center', 800);
  }

  if (game.banner) {
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.fillRect(0, 440, W, 170);
    text(game.banner.text, W / 2, 525, 72, '#ffffff', 'center', 800);
  }

  if (game.phase === 'over') {
    ctx.fillStyle = 'rgba(8,10,16,0.88)';
    ctx.fillRect(0, 300, W, 480);
    text('Prototype ends here', W / 2, 380, 72, '#3ddc84', 'center', 800);
    game.players.forEach((p, i) => {
      text(`${p.name}: ${C.countPlots(game, i)} plots, ${C.countBots(game, i)} bots, ${p.lostBots} ran off`, W / 2, 470 + i * 52, 36, PCOL[i], 'center');
    });
    text('Press A to go back to the start screen', W / 2, 720, 30, '#c8d2e3', 'center', 500);
  }
}

function drawLobby() {
  drawBackground();
  text('TENDIE TOWN', W / 2, 150, 110, '#3ddc84', 'center', 800);
  text('The apes made it to the moon. Now somebody has to run the place.', W / 2, 250, 34, '#c8d2e3', 'center', 500);
  for (let i = 0; i < SEATS; i++) {
    const x = 130 + i * 425;
    const y = 340;
    const s = lobby[i];
    ctx.fillStyle = '#161b28';
    rr(x, y, 385, 330, 16);
    ctx.fill();
    ctx.strokeStyle = PCOL[i];
    ctx.lineWidth = s ? 7 : 3;
    ctx.stroke();
    drawWalker(x + 192, y + 130, PCOL[i], !s, 1);
    if (s) {
      text(s.src === 'kbd' ? 'Keyboard' : `Controller ${s.pad + 1}`, x + 192, y + 220, 36, '#f1f4f8', 'center');
      text('Ready · B to leave', x + 192, y + 272, 24, '#9aa7bd', 'center', 500);
    } else {
      text('Press A to join', x + 192, y + 220, 36, '#f1f4f8', 'center');
      text('or a Hedgie plays this seat', x + 192, y + 272, 24, '#9aa7bd', 'center', 500);
    }
  }
  text('Press the Menu button to start', W / 2, 760, 44, '#ffffff', 'center', 800);
  text('The Dip grows tendies · craters give fuel · ridges hold chips and diamonds', W / 2, 840, 28, '#c8d2e3', 'center', 500);
  text('Keyboard: Space joins, arrows move, X changes tool, B ends turn, Enter starts', W / 2, 900, 24, '#7f8ba1', 'center', 500);
  text('On Xbox, if the controllers do nothing, switch the browser to controller mode', W / 2, 945, 24, '#7f8ba1', 'center', 500);
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

  if (mode === 'lobby') {
    if (DEMO) {
      startGame();
      for (let t = 0; t < SKIP; t += 1 / 60) {
        const inputs = [];
        for (let i = 0; i < SEATS; i++) inputs.push(seatInput(i, 1 / 60));
        C.update(game, inputs, 1 / 60);
      }
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
      if ((overTimer > 1 && pressed) || (DEMO && overTimer > 8)) {
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
