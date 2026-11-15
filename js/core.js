// Game rules and state. No drawing or browser input in here, so the same
// code can run headless for AI-only test games.

export const COLS = 10;
export const ROWS = 6;
export const ROUNDS = 6;
export const TILE_W = 176;
export const TILE_H = 140;
export const MAP_X = 80;
export const MAP_Y = 110;
export const MAP_W = COLS * TILE_W;
export const MAP_H = ROWS * TILE_H;
export const EXCHANGE_X = MAP_X + 5 * TILE_W;
export const EXCHANGE_Y = MAP_Y + 3 * TILE_H;

export const CLAIM_DWELL = 0.55; // seconds the scanner rests on each plot
export const TURN_TIME = 20; // seconds per walking turn
export const WALK_SPEED = 460; // pixels per second
export const AI_SPEED = 2.5; // AI turns play out faster

export const OUTFITS = [
  { id: 'tendies', name: 'Tendies', tool: 'Fryer', letter: 'T', color: '#f2a33c' },
  { id: 'fuel', name: 'Fuel', tool: 'Fuel rig', letter: 'F', color: '#58c7f3' },
  { id: 'chips', name: 'Chips', tool: 'Chip fab', letter: 'C', color: '#b6e35a' },
  { id: 'diamonds', name: 'Diamonds', tool: 'Diamond hands', letter: 'D', color: '#c9a4ff' },
];

export function tileIndex(c, r) {
  return r * COLS + c;
}

export function isExchange(c, r) {
  return (c === 4 || c === 5) && (r === 2 || r === 3);
}

// How many units a plot would produce per round with a given outfit.
// Placeholder numbers; production is not in the prototype yet.
export function yieldFor(tile, outfitId) {
  const lvl = tile.level;
  switch (tile.type) {
    case 'dip':
      return { tendies: 4, fuel: 2, chips: 0, diamonds: 0 }[outfitId];
    case 'crater':
      return { tendies: 1, fuel: 4, chips: 1, diamonds: 1 }[outfitId];
    case 'ridge':
      return { tendies: 1, fuel: 1, chips: 1 + lvl, diamonds: lvl }[outfitId];
    default:
      return { tendies: 2, fuel: 3, chips: 1, diamonds: 0 }[outfitId];
  }
}

export function bestOutfit(tile) {
  let best = 0;
  let bestY = -1;
  OUTFITS.forEach((o, i) => {
    const y = yieldFor(tile, o.id);
    if (y > bestY) {
      bestY = y;
      best = i;
    }
  });
  return best;
}

export function makeMap(rng) {
  const tiles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      tiles.push({ c, r, type: 'plain', level: 0, owner: -1, bot: -1, exchange: isExchange(c, r) });
    }
  }
  // The Dip: a valley that wanders from the left edge to the right edge.
  let row = 1 + Math.floor(rng() * 4);
  for (let c = 0; c < COLS; c++) {
    if (rng() < 0.45) row += rng() < 0.5 ? -1 : 1;
    row = Math.max(0, Math.min(ROWS - 1, row));
    if (isExchange(c, row)) row = row === 2 ? 1 : 4;
    tiles[tileIndex(c, row)].type = 'dip';
  }
  const place = (count, type) => {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 1000) {
      const t = tiles[Math.floor(rng() * tiles.length)];
      if (t.exchange || t.type !== 'plain') continue;
      t.type = type;
      if (type === 'ridge') t.level = 1 + Math.floor(rng() * 3);
      placed++;
    }
  };
  place(9, 'ridge');
  place(9, 'crater');
  return tiles;
}

export function tileAt(s, x, y) {
  const c = Math.floor((x - MAP_X) / TILE_W);
  const r = Math.floor((y - MAP_Y) / TILE_H);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return s.tiles[tileIndex(c, r)];
}

export function tileCenter(t) {
  return { x: MAP_X + (t.c + 0.5) * TILE_W, y: MAP_Y + (t.r + 0.5) * TILE_H };
}

// seatDefs: [{ kind: 'human' | 'ai', name }]
export function newGame(seatDefs, rng = Math.random) {
  const s = {
    rng,
    tiles: makeMap(rng),
    players: seatDefs.map((d, i) => ({ index: i, kind: d.kind, name: d.name, claimed: false, lastPlot: -1 })),
    round: 1,
    phase: 'claim',
    claim: null,
    turn: null,
    banner: null,
    flash: null,
  };
  startClaim(s);
  return s;
}

function setBanner(s, text, seconds) {
  s.banner = { text, t: seconds };
}

function startClaim(s) {
  s.phase = 'claim';
  s.turn = null;
  s.players.forEach((p) => (p.claimed = false));
  const order = [];
  s.tiles.forEach((t, i) => {
    if (!t.exchange && t.owner < 0) order.push(i);
  });
  s.claim = { order, pos: 0, t: 0 };
  setBanner(s, `Round ${s.round} of ${ROUNDS} — Land grab`, 1.8);
}

function updateClaim(s, inputs, dt) {
  const cl = s.claim;
  const tile = s.tiles[cl.order[cl.pos]];
  const pressers = s.players.filter((p) => !p.claimed && inputs[p.index].a);
  if (tile.owner < 0 && pressers.length) {
    const winner = pressers[Math.floor(s.rng() * pressers.length)];
    tile.owner = winner.index;
    winner.claimed = true;
    winner.lastPlot = cl.order[cl.pos];
    s.flash = { tile: cl.order[cl.pos], t: 0.5 };
    cl.t = 0;
    cl.pos++;
  } else {
    cl.t += dt;
    if (cl.t >= CLAIM_DWELL) {
      cl.t = 0;
      cl.pos++;
    }
  }
  if (cl.pos >= cl.order.length || s.players.every((p) => p.claimed)) startTurn(s, 0);
}

function startTurn(s, seat) {
  s.phase = 'walk';
  s.claim = null;
  s.turn = {
    seat,
    t: TURN_TIME,
    x: EXCHANGE_X,
    y: EXCHANGE_Y,
    bx: EXCHANGE_X,
    by: EXCHANGE_Y,
    outfit: 0,
    hasBot: true,
    facing: 1,
  };
  setBanner(s, `${s.players[seat].name} — your turn`, 1.2);
}

function endTurn(s) {
  const next = s.turn.seat + 1;
  if (next < s.players.length) {
    startTurn(s, next);
  } else if (s.round < ROUNDS) {
    s.round++;
    startClaim(s);
  } else {
    s.phase = 'over';
    s.turn = null;
  }
}

function updateWalk(s, inputs, dt) {
  const tu = s.turn;
  const player = s.players[tu.seat];
  const inp = inputs[tu.seat];
  if (player.kind === 'ai') dt *= AI_SPEED;

  let ix = inp.x;
  let iy = inp.y;
  const mag = Math.hypot(ix, iy);
  if (mag > 1) {
    ix /= mag;
    iy /= mag;
  }
  tu.x = Math.max(MAP_X + 24, Math.min(MAP_X + MAP_W - 24, tu.x + ix * WALK_SPEED * dt));
  tu.y = Math.max(MAP_Y + 24, Math.min(MAP_Y + MAP_H - 24, tu.y + iy * WALK_SPEED * dt));
  if (Math.abs(ix) > 0.1) tu.facing = ix > 0 ? 1 : -1;

  // The bot trails behind its owner.
  const follow = Math.min(1, dt * 6);
  tu.bx += (tu.x - tu.facing * 58 - tu.bx) * follow;
  tu.by += (tu.y + 6 - tu.by) * follow;

  const here = tileAt(s, tu.x, tu.y);
  if (!tu.hasBot && here && here.exchange) {
    tu.hasBot = true;
    tu.bx = tu.x;
    tu.by = tu.y;
  }
  if (tu.hasBot && inp.alt) tu.outfit = (tu.outfit + 1) % OUTFITS.length;
  if (tu.hasBot && inp.a && here && !here.exchange && here.owner === tu.seat) {
    here.bot = tu.outfit;
    tu.hasBot = false;
    s.flash = { tile: tileIndex(here.c, here.r), t: 0.5 };
  }

  tu.t -= dt;
  if (inp.b || tu.t <= 0) endTurn(s);
}

// inputs: one { x, y, a, b, alt } per seat. a, b and alt are true only on
// the frame the button goes down.
export function update(s, inputs, dt) {
  if (s.phase === 'over') return;
  if (s.flash) {
    s.flash.t -= dt;
    if (s.flash.t <= 0) s.flash = null;
  }
  if (s.banner) {
    s.banner.t -= dt;
    if (s.banner.t <= 0) s.banner = null;
    return;
  }
  if (s.phase === 'claim') updateClaim(s, inputs, dt);
  else if (s.phase === 'walk') updateWalk(s, inputs, dt);
}

export function countPlots(s, seat) {
  return s.tiles.filter((t) => t.owner === seat).length;
}

export function countBots(s, seat) {
  return s.tiles.filter((t) => t.owner === seat && t.bot >= 0).length;
}
