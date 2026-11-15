// Game rules and state. No drawing or browser input in here, so the same
// code runs headless for AI-only test games.

export const COLS = 10;
export const ROWS = 6;
export const ROUNDS = 12;
export const TILE_W = 176;
export const TILE_H = 140;
export const MAP_X = 80;
export const MAP_Y = 110;
export const MAP_W = COLS * TILE_W;
export const MAP_H = ROWS * TILE_H;
export const EXCHANGE_X = MAP_X + 5 * TILE_W;
export const EXCHANGE_Y = MAP_Y + 3 * TILE_H;

export const CLAIM_DWELL = 0.45; // seconds the scanner rests on each plot
export const FULL_TURN = 32; // seconds of a turn with a full belly
export const WALK_SPEED = 460; // pixels per second
export const AI_SPEED = 1; // AI turns run at human speed (raise to fast-forward Hedgie turns)
export const DOCK_RADIUS = 36; // how close to a plot's pad you must stand to install a bot
export const START_MONEY = 1000;
export const PLOT_VALUE = 500;
export const BOT_BASE = 100;
export const PRICE_CAP = 265;
export const AUCTION_TIME = 16;
export const PRICE_SPEED = 55; // dollars per second a bid or ask moves

export const GOODS = ['tendies', 'fuel', 'chips', 'diamonds'];
export const OUTFITS = [
  { id: 'tendies', name: 'Tendies', tool: 'Fryer', shop: 'The Fryer', letter: 'T', color: '#f2a33c', cost: 25 },
  { id: 'fuel', name: 'Fuel', tool: 'Fuel rig', shop: 'Fuel Depot', letter: 'F', color: '#58c7f3', cost: 50 },
  { id: 'chips', name: 'Chips', tool: 'Chip fab', shop: 'Chip Fab', letter: 'C', color: '#b6e35a', cost: 75 },
  { id: 'diamonds', name: 'Diamonds', tool: 'Diamond hands', shop: 'Diamond Cutter', letter: 'D', color: '#c9a4ff', cost: 100 },
];
const MIN_PRICE = { tendies: 15, fuel: 10, chips: 14, diamonds: 50 };
export const STORE_CAP = { tendies: 24, fuel: 24, chips: 30, diamonds: 9999 };

// Town interior. Buildings are touch zones; the walker enters one by
// stepping into it. Doors are where the AI aims for.
export const TOWN = {
  floorTop: 150,
  floorBottom: 930,
  exitLeft: 60,
  exitRight: 1860,
  buildings: [
    { id: 'lot', name: 'Bot Lot', x: 110, y: 190, w: 300, h: 230 },
    { id: 'shop0', name: 'The Fryer', x: 470, y: 190, w: 300, h: 230, outfit: 0 },
    { id: 'shop1', name: 'Fuel Depot', x: 810, y: 190, w: 300, h: 230, outfit: 1 },
    { id: 'shop2', name: 'Chip Fab', x: 1150, y: 190, w: 300, h: 230, outfit: 2 },
    { id: 'shop3', name: 'Diamond Cutter', x: 1490, y: 190, w: 300, h: 230, outfit: 3 },
    { id: 'assay', name: 'Assay Office', x: 470, y: 640, w: 300, h: 230 },
    { id: 'pub', name: 'YOLO Bar', x: 1150, y: 640, w: 300, h: 230 },
  ],
};
export const TOWN_START = { x: 960, y: 560 };

export function doorOf(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h + 34 };
}

export function foodNeed(round) {
  return round <= 4 ? 3 : round <= 8 ? 4 : 5;
}

export function whaleReward(round) {
  return round <= 3 ? 100 : round <= 7 ? 200 : round <= 11 ? 300 : 400;
}

export function botPrice(s) {
  if (s.store.bots <= 0) return null;
  return BOT_BASE + Math.max(0, 8 - s.store.bots) * 20;
}

export function tileIndex(c, r) {
  return r * COLS + c;
}

export function isExchange(c, r) {
  return (c === 4 || c === 5) && (r === 2 || r === 3);
}

// Base units a plot produces per round with a given outfit, before bonuses.
export function yieldFor(tile, outfitId) {
  const lvl = tile.level;
  if (outfitId === 'diamonds') return tile.type === 'dip' ? 0 : tile.dia;
  switch (tile.type) {
    case 'dip':
      return { tendies: 4, fuel: 2, chips: 0 }[outfitId];
    case 'crater':
      return { tendies: 0, fuel: 4, chips: 0 }[outfitId];
    case 'ridge':
      return { tendies: 0, fuel: 1, chips: 1 + lvl }[outfitId];
    default:
      return { tendies: 2, fuel: 3, chips: 0 }[outfitId];
  }
}

// Expected yield including the bonuses this owner would get.
export function expectedYield(s, tile, outfit, seat) {
  let y = yieldFor(tile, OUTFITS[outfit].id);
  if (y <= 0) return 0;
  const same = s.tiles.filter((t) => t.owner === seat && t.bot === outfit && t !== tile).length;
  y += Math.floor((same + 1) / 3);
  if (neighbours(s, tile).some((n) => n.owner === seat && n.bot === outfit)) y += 1;
  return y;
}

export function bestOutfit(s, tile, seat) {
  let best = 0;
  let bestV = -1;
  OUTFITS.forEach((o, i) => {
    const v = expectedYield(s, tile, i, seat) * s.store.sell[o.id];
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return best;
}

export function neighbours(s, tile) {
  const out = [];
  [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].forEach(([dc, dr]) => {
    const c = tile.c + dc;
    const r = tile.r + dr;
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) out.push(s.tiles[tileIndex(c, r)]);
  });
  return out;
}

export function makeMap(rng) {
  const tiles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      tiles.push({
        c,
        r,
        type: 'plain',
        level: 0,
        dia: 0,
        assayed: false,
        owner: -1,
        bot: -1,
        exchange: isExchange(c, r),
      });
    }
  }
  // The Dip: a short valley of five plots, the only land that grows
  // tendies well, so it is worth fighting over.
  let row = 1 + Math.floor(rng() * 4);
  const c0 = 1 + Math.floor(rng() * (COLS - 6));
  for (let c = c0; c < c0 + 5; c++) {
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
  // Hidden diamonds: a rich seam of 3 next to a few 2s and 1s.
  const cand = tiles.filter((t) => !t.exchange && t.type !== 'dip');
  const seam = cand[Math.floor(rng() * cand.length)];
  seam.dia = 3;
  neighbours({ tiles }, seam).forEach((n) => {
    if (!n.exchange && n.type !== 'dip') n.dia = Math.max(n.dia, 2);
  });
  cand.forEach((t) => {
    if (t.dia === 0 && rng() < 0.2) t.dia = 1;
  });
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

export function countPlots(s, seat) {
  return s.tiles.filter((t) => t.owner === seat).length;
}

export function countBots(s, seat, outfit = -1) {
  return s.tiles.filter((t) => t.owner === seat && t.bot >= 0 && (outfit < 0 || t.bot === outfit)).length;
}

export function nonFuelBots(s, seat) {
  return s.tiles.filter((t) => t.owner === seat && t.bot >= 0 && t.bot !== 1).length;
}

export function goodsValue(s, p) {
  return GOODS.reduce((sum, g) => sum + p.goods[g] * s.store.buy[g], 0);
}

export function netWorth(s, p) {
  let bots = 0;
  s.tiles.forEach((t) => {
    if (t.owner === p.index && t.bot >= 0) bots += BOT_BASE + OUTFITS[t.bot].cost;
  });
  return p.money + countPlots(s, p.index) * PLOT_VALUE + bots + goodsValue(s, p);
}

export function ranking(s) {
  return s.players.slice().sort((a, b) => netWorth(s, b) - netWorth(s, a));
}

// The amount of a good a player must keep: next round's food, and fuel
// for every bot that burns it.
export function criticalLevel(s, seat, good) {
  if (good === 'tendies') return foodNeed(s.round + 1);
  if (good === 'fuel') return nonFuelBots(s, seat);
  return 0;
}

// seatDefs: [{ kind: 'human' | 'ai', name }]
export function newGame(seatDefs, rng = Math.random, opts = {}) {
  const s = {
    rng,
    rounds: opts.rounds || ROUNDS,
    tiles: makeMap(rng),
    players: seatDefs.map((d, i) => ({
      index: i,
      kind: d.kind,
      name: d.name,
      money: START_MONEY,
      goods: { tendies: 4, fuel: 2, chips: 0, diamonds: 0 },
      claimed: false,
      lostBots: 0,
      foodShort: 0,
      whales: 0,
      dbg: { pub: 0, event: 0, bought: 0, soldFor: 0, paidFor: 0, assays: 0, dark: 0 },
    })),
    store: {
      stock: { tendies: 16, fuel: 16, chips: 0, diamonds: 0 },
      bots: 14,
      sell: { tendies: 50, fuel: 45, chips: 85, diamonds: 0 },
      buy: { tendies: 15, fuel: 10, chips: 50, diamonds: 100 },
    },
    round: 1,
    phase: 'claim',
    order: [],
    turnIdx: 0,
    claim: null,
    turn: null,
    auction: null,
    report: null,
    summary: null,
    banner: null,
    toasts: [],
    flash: null,
    runaways: [],
    whale: null,
    globalEventsUsed: {},
    playerEventsUsed: {},
    result: null,
    stats: { bolts: {}, pub: 0, pubMoney: 0, botsBought: 0, timeouts: 0 },
  };
  startRound(s);
  return s;
}

function setBanner(s, text, seconds) {
  s.banner = { text, t: seconds };
}

export function toast(s, text, seconds = 2.6) {
  s.toasts.push({ text, t: seconds });
  if (s.toasts.length > 3) s.toasts.shift();
}

// ---------- round flow ----------

function startRound(s) {
  // Poorest goes first.
  s.order = s.players
    .slice()
    .sort((a, b) => netWorth(s, a) - netWorth(s, b) || a.index - b.index)
    .map((p) => p.index);
  startClaim(s);
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
  setBanner(s, `Round ${s.round} of ${s.rounds} — Land grab`, 1.8);
}

function updateClaim(s, inputs, dt) {
  const cl = s.claim;
  if (cl.pos >= cl.order.length || s.players.every((p) => p.claimed)) {
    s.turnIdx = 0;
    startTurn(s, s.order[0]);
    return;
  }
  const tile = s.tiles[cl.order[cl.pos]];
  const pressers = s.players.filter((p) => !p.claimed && inputs[p.index].a);
  if (tile.owner < 0 && pressers.length) {
    const winner = pressers[Math.floor(s.rng() * pressers.length)];
    tile.owner = winner.index;
    winner.claimed = true;
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
}

// ---------- development turn ----------

function turnLength(p) {
  const f = [1, 0.72, 0.4, 0.2][Math.min(3, p.foodShort)];
  return Math.round(FULL_TURN * f);
}

function startTurn(s, seat) {
  const p = s.players[seat];
  // Eat. What you lack now shortens this turn.
  const need = foodNeed(s.round);
  const eaten = Math.min(need, p.goods.tendies);
  p.goods.tendies -= eaten;
  p.foodShort = need - eaten;
  const length = turnLength(p);

  s.phase = 'walk';
  s.claim = null;
  s.turn = {
    seat,
    t: length,
    length,
    scene: 'town',
    x: TOWN_START.x,
    y: TOWN_START.y,
    bx: TOWN_START.x,
    by: TOWN_START.y,
    facing: 1,
    hasBot: false,
    outfit: -1,
    botPaid: 0,
    botCount: 0,
    inBuilding: null,
    assay: 'none',
    sampleTile: -1,
    whaleCaught: false,
    idle: 0,
  };
  s.whale = null;
  let msg = `${p.name} — your turn`;
  if (p.foodShort > 0) msg += ` (short on tendies: ${length}s)`;
  setBanner(s, msg, 1.4);
  maybePlayerEvent(s, p);
}

function bolt(s, tu, reason) {
  const ang = s.rng() * Math.PI * 2;
  s.runaways.push({ x: tu.bx, y: tu.by, vx: Math.cos(ang) * 620, vy: Math.sin(ang) * 620, outfit: tu.outfit, t: 3 });
  tu.hasBot = false;
  tu.outfit = -1;
  s.players[tu.seat].lostBots++;
  s.stats.bolts[reason] = (s.stats.bolts[reason] || 0) + 1;
  toast(s, `Paper hands! ${s.players[tu.seat].name}'s bot bolted${reason ? ` (${reason})` : ''}`);
}

function endTurn(s) {
  const tu = s.turn;
  if (tu.hasBot && tu.scene === 'map') bolt(s, tu, 'out of time');
  else if (tu.hasBot) {
    // Still in town: the Bot Lot takes it back.
    s.players[tu.seat].money += tu.botPaid;
    s.store.bots++;
    tu.hasBot = false;
  }
  s.whale = null;
  s.turnIdx++;
  if (s.turnIdx < s.order.length) startTurn(s, s.order[s.turnIdx]);
  else startProduction(s);
}

function enterBuilding(s, tu, b) {
  const p = s.players[tu.seat];
  if (b.id === 'lot') {
    if (tu.hasBot) {
      p.money += tu.botPaid;
      s.store.bots++;
      tu.hasBot = false;
      tu.outfit = -1;
      toast(s, `Bot returned for $${tu.botPaid}`);
    } else {
      const price = botPrice(s);
      if (price === null) toast(s, 'Bot Lot is sold out — the Exchange needs chips to build more');
      else if (p.money < price) toast(s, `A bot costs $${price}. Not enough bucks.`);
      else {
        p.money -= price;
        s.store.bots--;
        tu.hasBot = true;
        tu.outfit = -1;
        tu.botPaid = price;
        tu.botCount++;
        s.stats.botsBought++;
        p.dbg.bought++;
        tu.bx = tu.x;
        tu.by = tu.y;
        toast(s, `Bought a bot for $${price}. Now give it a tool.`);
      }
    }
  } else if (b.outfit !== undefined) {
    const o = OUTFITS[b.outfit];
    if (!tu.hasBot) toast(s, `${b.name}: bring a bot from the Bot Lot first`);
    else if (tu.outfit === b.outfit) toast(s, `This bot already has a ${o.tool}`);
    else if (p.money < o.cost) toast(s, `A ${o.tool} costs $${o.cost}. Not enough bucks.`);
    else {
      p.money -= o.cost;
      tu.outfit = b.outfit;
      toast(s, `Fitted a ${o.tool} for $${o.cost}`);
    }
  } else if (b.id === 'assay') {
    if (tu.hasBot) toast(s, 'Assay Office: come back without a bot in tow');
    else if (tu.assay === 'have-sample') {
      const t = s.tiles[tu.sampleTile];
      t.assayed = true;
      p.dbg.assays++;
      tu.assay = 'none';
      const word = ['no', 'low', 'medium', 'HIGH'][t.dia];
      toast(s, `Assay result: ${word} diamonds on that plot`);
    } else if (tu.assay === 'none') {
      tu.assay = 'need-sample';
      toast(s, 'Go stand on any plot and press A to take a sample, then come back');
    }
  } else if (b.id === 'pub') {
    const base = 50 + (s.round - 1) * 18;
    const win = Math.max(10, Math.round((base * tu.t) / tu.length));
    p.money += win;
    p.dbg.pub += win;
    s.stats.pub++;
    s.stats.pubMoney += win;
    toast(s, `${p.name} YOLO'd the rest of the turn and won $${win}`, 3);
    tu.t = 0;
  }
}

function updateWhale(s, dt) {
  if (s.whale) {
    s.whale.t -= dt;
    if (s.whale.t <= 0) s.whale = null;
    return;
  }
  const tu = s.turn;
  if (tu.whaleCaught || tu.scene !== 'map' || tu.t < 4) return;
  if (s.rng() < dt * 0.12) {
    const ridges = s.tiles.filter((t) => t.type === 'ridge');
    const t = ridges[Math.floor(s.rng() * ridges.length)];
    s.whale = { tile: tileIndex(t.c, t.r), t: 3.2 };
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
  const moving = mag > 0.1;
  tu.x += ix * WALK_SPEED * dt;
  tu.y += iy * WALK_SPEED * dt;
  if (Math.abs(ix) > 0.1) tu.facing = ix > 0 ? 1 : -1;

  if (tu.scene === 'town') {
    tu.y = Math.max(TOWN.floorTop, Math.min(TOWN.floorBottom, tu.y));
    if (tu.x < TOWN.exitLeft) {
      tu.scene = 'map';
      tu.x = MAP_X + 4 * TILE_W - 30;
      tu.y = EXCHANGE_Y;
      tu.inBuilding = null;
    } else if (tu.x > TOWN.exitRight) {
      tu.scene = 'map';
      tu.x = MAP_X + 6 * TILE_W + 30;
      tu.y = EXCHANGE_Y;
      tu.inBuilding = null;
    } else {
      const b = TOWN.buildings.find((bb) => tu.x >= bb.x && tu.x <= bb.x + bb.w && tu.y >= bb.y && tu.y <= bb.y + bb.h);
      if (b && tu.inBuilding !== b.id) {
        tu.inBuilding = b.id;
        enterBuilding(s, tu, b);
      } else if (!b) tu.inBuilding = null;
    }
    if (tu.scene === 'map') {
      tu.bx = tu.x;
      tu.by = tu.y;
    }
  } else {
    tu.x = Math.max(MAP_X + 24, Math.min(MAP_X + MAP_W - 24, tu.x));
    tu.y = Math.max(MAP_Y + 24, Math.min(MAP_Y + MAP_H - 24, tu.y));
    const here = tileAt(s, tu.x, tu.y);
    if (here && here.exchange) {
      tu.scene = 'town';
      tu.x = tu.x < EXCHANGE_X ? TOWN.exitLeft + 30 : TOWN.exitRight - 30;
      tu.y = 540;
      tu.bx = tu.x;
      tu.by = tu.y;
    } else if (inp.a && here) {
      if (tu.hasBot) {
        const pad = tileCenter(here);
        const onPad = here.owner === tu.seat && Math.hypot(pad.x - tu.x, pad.y - tu.y) <= DOCK_RADIUS;
        if (!onPad) bolt(s, tu, 'missed the pad');
        else if (tu.outfit < 0) toast(s, 'This bot has no tool yet — fit one in town');
        else {
          if (here.bot >= 0) toast(s, `Replaced the ${OUTFITS[here.bot].tool} bot`);
          here.bot = tu.outfit;
          tu.hasBot = false;
          tu.outfit = -1;
          s.flash = { tile: tileIndex(here.c, here.r), t: 0.5 };
        }
      } else if (s.whale && s.whale.tile === tileIndex(here.c, here.r)) {
        const win = whaleReward(s.round);
        player.money += win;
        player.whales++;
        tu.whaleCaught = true;
        s.whale = null;
        toast(s, `${player.name} caught the Whale! It paid $${win} to be let go`, 3);
      } else if (tu.assay === 'need-sample') {
        tu.assay = 'have-sample';
        tu.sampleTile = tileIndex(here.c, here.r);
        toast(s, 'Sample taken — bring it back to the Assay Office');
      }
    }
  }

  // The bot trails behind its owner.
  const follow = Math.min(1, dt * 6);
  tu.bx += (tu.x - tu.facing * 58 - tu.bx) * follow;
  tu.by += (tu.y + 6 - tu.by) * follow;

  updateWhale(s, dt);

  // Standing still burns the clock twice as fast.
  tu.t -= moving ? dt : dt * 2;
  if (tu.t <= 0) s.stats.timeouts++;
  if (inp.b || tu.t <= 0) endTurn(s);
}

// ---------- random events ----------

const GLOBAL_EVENTS = [
  { id: 'crash', p: 0.15, max: 3, text: 'FLASH CRASH — chip fabs run at half speed this round' },
  { id: 'bears', p: 0.15, max: 3, text: 'BEAR RAID — bears eat the tendies on one of a leader\'s plots' },
  { id: 'flare', p: 0.15, max: 3, text: 'SOLAR FLARE — fuel rigs pump extra fuel' },
  { id: 'rain', p: 0.15, max: 3, text: 'TENDIE RAIN — fryers overflow, fuel rigs sputter' },
  { id: 'halt', p: 0.1, max: 2, text: 'TRADING HALTED — the Exchange\'s stock is gone this round' },
  { id: 'meteor', p: 0.1, max: 2, text: 'METEOR STRIKE — a bot is flattened; the crater glitters with diamonds' },
  { id: 'panic', p: 0.1, max: 2, text: 'PAPER HANDS PANIC — a bot runs off' },
  { id: 'rug', p: 0.1, max: 2, text: 'RUG PULL — every chip in the colony vanishes' },
];

function pickGlobalEvent(s) {
  if (s.round === 1) return null;
  for (const e of GLOBAL_EVENTS.slice().sort(() => s.rng() - 0.5)) {
    const used = s.globalEventsUsed[e.id] || 0;
    if (used < e.max && s.rng() < e.p) {
      s.globalEventsUsed[e.id] = used + 1;
      return e;
    }
  }
  return null;
}

const PLAYER_EVENTS = [
  { id: 'stimmy', good: true, text: 'Stimmy check arrives', money: 1 },
  { id: 'squeeze', good: true, text: 'You were in early on a short squeeze', money: 1.6 },
  { id: 'airdrop', good: true, text: 'A mystery airdrop lands in your wallet', money: 0.8 },
  { id: 'plot', good: true, text: 'A lapsed claim is signed over to you', plot: 1 },
  { id: 'margin', good: false, text: 'MARGIN CALL — the broker takes a cut', money: -1.2 },
  { id: 'audit', good: false, text: 'Tax audit. Ouch.', money: -0.8 },
  { id: 'wallet', good: false, text: 'You lost your seed phrase', money: -1 },
  { id: 'repo', good: false, text: 'An empty plot is repossessed', plot: -1 },
];

function maybePlayerEvent(s, p) {
  if (s.round === 1 || s.rng() >= 0.25) return;
  const ranks = ranking(s);
  const isLeader = ranks[0].index === p.index;
  const isLast = ranks[ranks.length - 1].index === p.index;
  const pool = PLAYER_EVENTS.filter((e) => !(e.good && isLeader) && !(!e.good && isLast) && !s.playerEventsUsed[`${p.index}:${e.id}`]);
  if (!pool.length) return;
  const e = pool[Math.floor(s.rng() * pool.length)];
  s.playerEventsUsed[`${p.index}:${e.id}`] = true;
  let text = e.text;
  if (e.money) {
    const amt = Math.round((25 * (s.round + 2) * Math.abs(e.money)) / 5) * 5 * Math.sign(e.money);
    p.money = Math.max(0, p.money + amt);
    p.dbg.event += amt;
    text += ` (${amt > 0 ? '+' : '−'}$${Math.abs(amt)})`;
  }
  if (e.plot === 1) {
    const free = s.tiles.filter((t) => !t.exchange && t.owner < 0);
    if (!free.length) return;
    const t = free[Math.floor(s.rng() * free.length)];
    t.owner = p.index;
    s.flash = { tile: tileIndex(t.c, t.r), t: 1 };
  }
  if (e.plot === -1) {
    const empty = s.tiles.filter((t) => t.owner === p.index && t.bot < 0);
    if (!empty.length) return;
    const t = empty[Math.floor(s.rng() * empty.length)];
    t.owner = -1;
  }
  toast(s, `${p.name}: ${text}`, 3.5);
}

// ---------- production ----------

function startProduction(s) {
  s.phase = 'production';
  const event = pickGlobalEvent(s);
  const notes = [];
  if (event) {
    if (event.id === 'halt') {
      s.store.stock = { tendies: 0, fuel: 0, chips: 0, diamonds: 0 };
    } else if (event.id === 'rug') {
      s.store.stock.chips = 0;
      s.players.forEach((p) => (p.goods.chips = 0));
    } else if (event.id === 'meteor') {
      const staffed = s.tiles.filter((t) => t.bot >= 0);
      const t = staffed.length ? staffed[Math.floor(s.rng() * staffed.length)] : s.tiles.filter((x) => !x.exchange)[0];
      t.bot = -1;
      if (t.type !== 'dip') {
        t.dia = 3;
        t.assayed = true;
      }
      if (t.owner >= 0) notes.push(`${s.players[t.owner].name} lost a bot to the meteor`);
    } else if (event.id === 'panic') {
      const ranks = ranking(s);
      const mids = ranks.slice(1, 3).map((p) => p.index);
      const staffed = s.tiles.filter((t) => t.bot >= 0 && mids.includes(t.owner));
      if (staffed.length) {
        const t = staffed[Math.floor(s.rng() * staffed.length)];
        t.bot = -1;
        s.players[t.owner].lostBots++;
        notes.push(`${s.players[t.owner].name}'s bot ran off`);
      }
    }
  }

  const rows = s.players.map((p) => {
    const seat = p.index;
    const gained = { tendies: 0, fuel: 0, chips: 0, diamonds: 0 };
    const mine = s.tiles.filter((t) => t.owner === seat && t.bot >= 0);
    // Fuel first: every bot that is not a fuel rig burns one unit.
    const burners = mine.filter((t) => t.bot !== 1);
    const fuelled = Math.min(burners.length, p.goods.fuel);
    p.goods.fuel -= fuelled;
    const shuffled = burners.slice().sort(() => s.rng() - 0.5);
    const dark = new Set(shuffled.slice(fuelled).map((t) => tileIndex(t.c, t.r)));
    let bearTile = -1;
    if (event && event.id === 'bears') {
      const ranks = ranking(s);
      if (ranks.slice(0, 2).some((q) => q.index === seat)) {
        const fr = mine.filter((t) => t.bot === 0);
        if (fr.length) {
          const ft = fr[Math.floor(s.rng() * fr.length)];
          bearTile = tileIndex(ft.c, ft.r);
        }
      }
    }
    mine.forEach((t) => {
      const idx = tileIndex(t.c, t.r);
      if (dark.has(idx) || idx === bearTile) return;
      let y = expectedYield(s, t, t.bot, seat);
      const roll = s.rng();
      y += roll < 0.25 ? -1 : roll > 0.75 ? 1 : 0;
      if (event) {
        if (event.id === 'crash' && t.bot === 2) y = Math.floor(y / 2);
        if (event.id === 'flare' && t.bot === 1) y += 2;
        if (event.id === 'rain' && t.bot === 0) y += 2;
        if (event.id === 'rain' && t.bot === 1) y -= 1;
      }
      y = Math.max(0, y);
      const g = OUTFITS[t.bot].id;
      gained[g] += y;
    });
    GOODS.forEach((g) => (p.goods[g] += gained[g]));
    p.dbg.dark += dark.size;
    return { seat, gained, dark: dark.size, bears: bearTile >= 0 };
  });
  s.report = { event, notes, rows, t: 9 };
}

function updateReport(s, inputs, dt) {
  s.report.t -= dt;
  const skip = s.players.some((p) => p.kind === 'human' && inputs[p.index].a);
  if (s.report.t <= 0 || skip) startAuction(s, 0);
}

// ---------- auction ----------

function startAuction(s, gi) {
  s.phase = 'auction';
  const good = GOODS[gi];
  const allAI = s.players.every((p) => p.kind === 'ai');
  const axisMax = Math.max(150, Math.ceil((s.store.sell[good] * 2) / 50) * 50);
  s.auction = {
    gi,
    good,
    stage: 'declare',
    t: allAI ? 0.5 : 6,
    roles: s.players.map(() => 'none'),
    price: s.players.map(() => 0),
    active: s.players.map(() => false),
    bought: s.players.map(() => 0),
    sold: s.players.map(() => 0),
    axisMax,
    trades: 0,
    sum: 0,
    tick: 0,
    quiet: 0,
  };
}

function updateAuction(s, inputs, dt) {
  const a = s.auction;
  const good = a.good;
  const st = s.store;
  if (a.stage === 'declare') {
    s.players.forEach((p, i) => {
      const inp = inputs[i];
      if (inp.y < -0.5 && p.money >= 1) a.roles[i] = 'buy';
      else if (inp.y > 0.5 && p.goods[good] > criticalLevel(s, i, good)) a.roles[i] = 'sell';
      else if (inp.b) a.roles[i] = 'none';
    });
    a.t -= dt;
    if (a.t <= 0) {
      a.stage = 'trade';
      a.t = AUCTION_TIME;
      s.players.forEach((p, i) => {
        a.active[i] = a.roles[i] !== 'none';
        a.price[i] = a.roles[i] === 'buy' ? 0 : a.roles[i] === 'sell' ? a.axisMax : 0;
      });
      if (!a.active.some((x) => x)) {
        a.stage = 'result';
        a.t = 1.2;
      }
    }
    return;
  }
  if (a.stage === 'trade') {
    s.players.forEach((p, i) => {
      if (!a.active[i]) return;
      const inp = inputs[i];
      if (inp.b) {
        a.active[i] = false;
        return;
      }
      // Stick up raises your price, down lowers it, for buyers and sellers alike.
      a.price[i] = Math.max(0, Math.min(a.axisMax, a.price[i] - inp.y * PRICE_SPEED * dt));
      if (a.roles[i] === 'buy' && p.money < 1) a.active[i] = false;
      if (a.roles[i] === 'sell' && p.goods[good] <= criticalLevel(s, i, good)) a.active[i] = false;
    });

    a.tick += dt;
    while (a.tick >= 0.3) {
      a.tick -= 0.3;
      // Best buyer: highest bid; ties go to the poorer player, then a coin
      // flip; the store loses ties.
      const beats = (p, other) => {
        const w = netWorth(s, p) - netWorth(s, other);
        return w < 0 || (w === 0 && s.rng() < 0.5);
      };
      let buyer = null;
      s.players.forEach((p, i) => {
        if (!a.active[i] || a.roles[i] !== 'buy' || p.money < a.price[i]) return;
        const pr = Math.floor(a.price[i]);
        if (!buyer || pr > buyer.price || (pr === buyer.price && beats(p, s.players[buyer.seat]))) buyer = { seat: i, price: pr };
      });
      const storeBuys = st.stock[good] < STORE_CAP[good];
      if ((!buyer || buyer.price < st.buy[good]) && storeBuys) buyer = { seat: -1, price: st.buy[good] };
      if (!buyer) continue;
      let seller = null;
      s.players.forEach((p, i) => {
        if (!a.active[i] || a.roles[i] !== 'sell') return;
        const pr = Math.ceil(a.price[i]);
        if (!seller || pr < seller.price || (pr === seller.price && beats(p, s.players[seller.seat]))) seller = { seat: i, price: pr };
      });
      if (good !== 'diamonds' && st.stock[good] > 0 && (!seller || st.sell[good] <= seller.price)) seller = { seat: -1, price: st.sell[good] };
      if (!seller || buyer.seat === seller.seat || (buyer.seat < 0 && seller.seat < 0)) continue;
      if (buyer.price < seller.price) continue;
      const price = seller.seat < 0 ? st.sell[good] : buyer.seat < 0 ? st.buy[good] : seller.price;
      if (buyer.seat >= 0) {
        const b = s.players[buyer.seat];
        if (b.money < price) continue;
        b.money -= price;
        b.dbg.paidFor += price;
        b.goods[good]++;
        a.bought[buyer.seat]++;
      } else st.stock[good]++;
      if (seller.seat >= 0) {
        const sp = s.players[seller.seat];
        sp.money += price;
        sp.dbg.soldFor += price;
        sp.goods[good]--;
        a.sold[seller.seat]++;
      } else st.stock[good]--;
      a.trades++;
      a.sum += price;
    }

    const buyers = a.active.some((x, i) => x && a.roles[i] === 'buy');
    const sellers = a.active.some((x, i) => x && a.roles[i] === 'sell');
    const possible = (buyers && (sellers || (st.stock[good] > 0 && good !== 'diamonds'))) || (sellers && (buyers || st.stock[good] < STORE_CAP[good]));
    a.quiet = possible ? 0 : a.quiet + dt;
    a.t -= dt;
    if (a.t <= 0 || a.quiet > 1) {
      a.stage = 'result';
      a.t = a.trades ? 2.5 : 1.2;
      settlePrices(s, a);
    }
    return;
  }
  a.t -= dt;
  if (a.t <= 0) {
    if (a.gi + 1 < GOODS.length) startAuction(s, a.gi + 1);
    else startSummary(s);
  }
}

function settlePrices(s, a) {
  const good = a.good;
  const st = s.store;
  if (good === 'diamonds') {
    st.stock.diamonds = 0;
    st.buy.diamonds = 50 + Math.floor(s.rng() * 101);
    return;
  }
  let demand;
  if (good === 'tendies') demand = s.players.length * foodNeed(s.round + 1);
  else if (good === 'fuel') demand = s.players.reduce((n, p) => n + nonFuelBots(s, p.index), 0) + 2;
  else demand = Math.max(6, (16 - st.bots) * 2);
  const level = st.stock[good] / Math.max(1, demand);
  let sell = st.sell[good];
  if (level < 0.5) sell *= 1.35;
  else if (level < 1) sell *= 1.15;
  else if (level > 2) sell *= 0.85;
  if (a.trades) sell = Math.max(sell, (a.sum / a.trades) * 0.8);
  st.sell[good] = Math.round(Math.max(MIN_PRICE[good] * 2, Math.min(PRICE_CAP, sell)));
  st.buy[good] = Math.round(Math.max(MIN_PRICE[good], Math.min(PRICE_CAP - 10, st.sell[good] * 0.45)));
}

// ---------- end of round ----------

function startSummary(s) {
  s.phase = 'summary';
  const spoiled = s.players.map(() => ({ tendies: 0, fuel: 0, chips: 0 }));
  s.players.forEach((p, i) => {
    const needT = foodNeed(s.round + 1);
    if (p.goods.tendies > needT) {
      const extra = p.goods.tendies - needT;
      spoiled[i].tendies = Math.floor(extra / 2);
      p.goods.tendies -= spoiled[i].tendies;
    }
    const needF = nonFuelBots(s, i);
    if (p.goods.fuel > needF) {
      const extra = p.goods.fuel - needF;
      spoiled[i].fuel = Math.floor(extra / 2);
      p.goods.fuel -= spoiled[i].fuel;
    }
    if (p.goods.chips > 50) {
      spoiled[i].chips = p.goods.chips - 50;
      p.goods.chips = 50;
    }
  });
  // The Exchange's perishables rot too.
  ['tendies', 'fuel'].forEach((g) => {
    if (s.store.stock[g] > 30) s.store.stock[g] -= Math.floor((s.store.stock[g] - 30) / 2);
  });
  // The Exchange builds bots from chips (2 each), plus one shipment a round.
  const builds = Math.min(2, Math.floor(s.store.stock.chips / 2));
  s.store.stock.chips -= builds * 2;
  s.store.bots = Math.min(24, s.store.bots + builds + (s.store.bots < 4 ? 1 : 0));

  const ranks = ranking(s);
  s.summary = {
    t: s.players.every((p) => p.kind === 'ai') ? 2 : 10,
    rows: ranks.map((p) => ({ seat: p.index, worth: netWorth(s, p), spoiled: spoiled[p.index] })),
    colony: s.players.reduce((n, p) => n + netWorth(s, p), 0),
    botsBuilt: builds,
  };
}

function updateSummary(s, inputs, dt) {
  s.summary.t -= dt;
  const skip = s.players.some((p) => p.kind === 'human' && inputs[p.index].a);
  if (s.summary.t > 0 && !skip) return;
  if (s.round < s.rounds) {
    s.round++;
    startRound(s);
  } else finish(s);
}

const ENDINGS = [
  [120000, 'Luxury — lambos on the moon'],
  [100000, 'Elegant — penthouse domes'],
  [80000, 'Comfortable — everyone eats tendies daily'],
  [60000, 'Bare minimum — the colony survives'],
  [40000, 'Tents — the colony limps along'],
  [20000, 'On your own — the Exchange pulled out'],
  [0, 'Bagholders — the colony failed'],
];

function finish(s) {
  s.phase = 'over';
  const ranks = ranking(s);
  const colony = s.players.reduce((n, p) => n + netWorth(s, p), 0);
  s.result = {
    rows: ranks.map((p) => ({ seat: p.index, worth: netWorth(s, p) })),
    colony,
    ending: ENDINGS.find(([min]) => colony >= min)[1],
    success: colony >= 60000,
  };
}

// ---------- main update ----------

// inputs: one { x, y, a, b, alt } per seat. a, b and alt are true only on
// the frame the button goes down.
export function update(s, inputs, dt) {
  if (s.phase === 'over') return;
  if (s.flash) {
    s.flash.t -= dt;
    if (s.flash.t <= 0) s.flash = null;
  }
  s.toasts.forEach((t) => (t.t -= dt));
  s.toasts = s.toasts.filter((t) => t.t > 0);
  s.runaways.forEach((r) => {
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.t -= dt;
  });
  s.runaways = s.runaways.filter((r) => r.t > 0);
  if (s.banner) {
    s.banner.t -= dt;
    if (s.banner.t <= 0) s.banner = null;
    return;
  }
  if (s.phase === 'claim') updateClaim(s, inputs, dt);
  else if (s.phase === 'walk') updateWalk(s, inputs, dt);
  else if (s.phase === 'production') updateReport(s, inputs, dt);
  else if (s.phase === 'auction') updateAuction(s, inputs, dt);
  else if (s.phase === 'summary') updateSummary(s, inputs, dt);
}
