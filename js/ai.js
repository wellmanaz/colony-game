// Rule-based AI. It produces the same input shape a controller does, so an
// AI can sit in any seat.

import { OUTFITS, EXCHANGE_X, EXCHANGE_Y, COLS, ROWS, yieldFor, bestOutfit, tileCenter, tileIndex } from './core.js';

export function makeAI() {
  return { round: -1, target: -1, react: 0 };
}

function plotValue(s, tile, seat) {
  let v = 0;
  OUTFITS.forEach((o) => (v = Math.max(v, yieldFor(tile, o.id))));
  // Slight pull toward plots next to ones it already owns.
  const near = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  near.forEach(([dc, dr]) => {
    const c = tile.c + dc;
    const r = tile.r + dr;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (s.tiles[tileIndex(c, r)].owner === seat) v += 0.5;
  });
  return v;
}

function steer(inp, fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    const ease = Math.min(1, d / 60); // slow down on approach so it does not overshoot
    inp.x = (dx / d) * ease;
    inp.y = (dy / d) * ease;
  }
  return d;
}

export function aiInput(s, seat, mem, dt) {
  const inp = { x: 0, y: 0, a: false, b: false, alt: false };
  if (s.banner) return inp;

  if (s.phase === 'claim') {
    const me = s.players[seat];
    if (me.claimed) return inp;
    const cl = s.claim;
    const ahead = cl.order.slice(cl.pos).filter((i) => s.tiles[i].owner < 0);
    if (mem.round !== s.round || !ahead.includes(mem.target)) {
      let best = -1;
      let bestV = -Infinity;
      ahead.forEach((i) => {
        const v = plotValue(s, s.tiles[i], seat) + s.rng() * 1.5;
        if (v > bestV) {
          bestV = v;
          best = i;
        }
      });
      mem.round = s.round;
      mem.target = best;
      mem.react = 0.08 + s.rng() * 0.3;
    }
    if (cl.order[cl.pos] === mem.target) {
      mem.react -= dt;
      if (mem.react <= 0) inp.a = true;
    }
    return inp;
  }

  if (s.phase === 'walk' && s.turn.seat === seat) {
    const tu = s.turn;
    const empty = s.tiles.filter((t) => t.owner === seat && t.bot < 0);
    if (!empty.length) {
      inp.b = true;
      return inp;
    }
    if (!tu.hasBot) {
      steer(inp, tu.x, tu.y, EXCHANGE_X, EXCHANGE_Y);
      return inp;
    }
    // Nearest unstaffed plot.
    let goal = empty[0];
    let goalD = Infinity;
    empty.forEach((t) => {
      const c = tileCenter(t);
      const d = Math.hypot(c.x - tu.x, c.y - tu.y);
      if (d < goalD) {
        goalD = d;
        goal = t;
      }
    });
    // Now and then a Hedgie gets impatient and lets go of the bot too early.
    const key = `${s.round}:${tu.seat}:${tu.botCount}`;
    if (mem.botKey !== key) {
      mem.botKey = key;
      mem.sloppy = s.rng() < 0.07;
    }
    if (tu.outfit !== bestOutfit(goal)) {
      inp.alt = true;
      return inp;
    }
    const c = tileCenter(goal);
    if (steer(inp, tu.x, tu.y, c.x, c.y) < (mem.sloppy ? 90 : 24)) {
      inp.x = 0;
      inp.y = 0;
      inp.a = true;
    }
  }
  return inp;
}
