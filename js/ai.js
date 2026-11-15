// Rule-based AI. It produces the same input shape a controller does, so an
// AI can sit in any seat. It only knows what a player at the couch would
// know: hidden diamond levels stay hidden until a plot is assayed.

import * as C from './core.js';

export function makeAI() {
  return {
    round: -1,
    target: -1,
    react: 0,
    botKey: '',
    sloppy: false,
    press: 0,
    assayDone: false,
    assayTile: -1,
    wantOutfit: -1,
    targetTile: -1,
    auc: null,
    patience: 0.6 + Math.random() * 0.4,
  };
}

function knownYield(s, tile, outfit, seat) {
  if (outfit === 3 && !tile.assayed) return tile.type === 'dip' ? 0 : 0.7;
  return C.expectedYield(s, tile, outfit, seat);
}

function myProduction(s, seat, outfit) {
  return s.tiles.filter((t) => t.owner === seat && t.bot === outfit).reduce((n, t) => n + C.expectedYield(s, t, outfit, seat), 0);
}

// Value of fitting a given tool on a plot, with urgency for food and fuel.
function outfitValue(s, tile, outfit, seat) {
  const y = knownYield(s, tile, outfit, seat);
  const g = C.OUTFITS[outfit].id;
  let v = y * (s.store.sell[g] + s.store.buy[g]) * 0.5;
  if (outfit === 0 && y >= 2 && myProduction(s, seat, 0) < C.foodNeedFor(s, s.players[seat], s.round + 1)) v *= 2.2;
  if (outfit === 1 && y >= 2 && myProduction(s, seat, 1) < C.nonFuelBots(s, seat) + 1) v *= 2;
  return v;
}

function plotValue(s, tile, seat) {
  let v = 0;
  for (let i = 0; i < 4; i++) v = Math.max(v, outfitValue(s, tile, i, seat));
  if (C.neighbours(s, tile).some((n) => n.owner === seat)) v += 40;
  return v;
}

function chooseOutfit(s, tile, seat, budget) {
  let best = -1;
  let bestV = -1;
  for (let i = 0; i < 4; i++) {
    if (C.OUTFITS[i].cost > budget) continue;
    const v = outfitValue(s, tile, i, seat);
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

function steer(inp, fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    const ease = Math.min(1, d / 60);
    inp.x = (dx / d) * ease;
    inp.y = (dy / d) * ease;
  }
  return d;
}

// The counter at the back of a building's doorway.
function entryOf(b) {
  const d = C.doorOf(b);
  return { x: d.x, y: b.row === 'top' ? b.y + b.h - C.TOWN.depth - 8 : b.y + C.TOWN.depth + 8 };
}

// In town, walk out to the street first, along it, then straight in
// through the doorway, so you never try to push through a wall.
function steerTown(inp, tu, goal) {
  const STREET = C.TOWN.street;
  if (Math.abs(tu.x - goal.x) > 20 && Math.abs(tu.y - STREET) > 16) return steer(inp, tu.x, tu.y, tu.x, STREET) + 1000;
  if (Math.abs(tu.x - goal.x) > 20) return steer(inp, tu.x, tu.y, goal.x, STREET) + 1000;
  return steer(inp, tu.x, tu.y, goal.x, goal.y);
}

// The Exchange block sits in the middle of the map and walking into it
// takes you back to town, so route around it.
const ER = {
  x1: C.MAP_X + 4 * C.TILE_W - 30,
  x2: C.MAP_X + 6 * C.TILE_W + 30,
  y1: C.MAP_Y + 2 * C.TILE_H - 30,
  y2: C.MAP_Y + 4 * C.TILE_H + 30,
};
function inER(x, y) {
  return x > ER.x1 && x < ER.x2 && y > ER.y1 && y < ER.y2;
}
function crossesER(ax, ay, bx, by) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 30);
  for (let i = 1; i < n; i++) {
    const f = i / n;
    if (inER(ax + (bx - ax) * f, ay + (by - ay) * f)) return true;
  }
  return false;
}
function steerMap(inp, tu, gx, gy) {
  if (!crossesER(tu.x, tu.y, gx, gy)) return steer(inp, tu.x, tu.y, gx, gy);
  const corners = [
    [ER.x1, ER.y1],
    [ER.x2, ER.y1],
    [ER.x1, ER.y2],
    [ER.x2, ER.y2],
  ];
  let best = null;
  let bestD = Infinity;
  corners.forEach(([cx, cy]) => {
    if (crossesER(tu.x, tu.y, cx, cy)) return;
    const d = Math.hypot(cx - tu.x, cy - tu.y) + Math.hypot(gx - cx, gy - cy);
    if (d < bestD) {
      bestD = d;
      best = [cx, cy];
    }
  });
  if (!best) return steer(inp, tu.x, tu.y, gx, gy);
  return steer(inp, tu.x, tu.y, best[0], best[1]) + 1000;
}

function building(id) {
  return C.TOWN.buildings.find((b) => b.id === id);
}

function pickTargetPlot(s, seat) {
  const empty = s.tiles.filter((t) => t.owner === seat && t.bot < 0);
  let best = null;
  let bestV = -Infinity;
  empty.forEach((t) => {
    const c = C.tileCenter(t);
    const dist = Math.hypot(c.x - C.EXCHANGE_X, c.y - C.EXCHANGE_Y);
    const v = plotValue(s, t, seat) - dist * 0.05;
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  });
  return best;
}

function walkTurn(s, seat, mem, inp, dt) {
  const tu = s.turn;
  const p = s.players[seat];
  mem.press -= dt;
  const press = () => {
    if (mem.press <= 0) {
      inp.a = true;
      mem.press = 0.5;
    }
  };

  if (tu.scene === 'town') {
    if (tu.hasBot) {
      if (tu.outfit !== mem.wantOutfit && mem.wantOutfit >= 0) {
        steerTown(inp, tu, entryOf(building(`shop${mem.wantOutfit}`)));
        return;
      }
      const t = mem.targetTile >= 0 ? s.tiles[mem.targetTile] : null;
      const exitX = t && t.c < 5 ? C.TOWN.exitLeft - 20 : C.TOWN.exitRight + 20;
      steerTown(inp, tu, { x: exitX, y: C.TOWN.street });
      return;
    }
    if (tu.assay === 'have-sample') {
      steerTown(inp, tu, entryOf(building('assay')));
      return;
    }
    const target = pickTargetPlot(s, seat);
    let price = C.botPrice(s);
    if (price !== null) price = C.shopPrice(p, price);
    if (price === null && s.ownBots && p.goods.chips >= 2) price = C.OWN_BOT_FEE;
    if (target && price !== null) {
      // Keep a little cash back for food at the auction.
      const outfit = chooseOutfit(s, target, seat, (p.money - price - 120) / (C.characterOf(p).shopMult || 1));
      const c = C.tileCenter(target);
      // Lot, shop, exit, then the walk out: about 2600px of town plus the map leg.
      const est = (2600 + Math.hypot(c.x - C.EXCHANGE_X, c.y - C.EXCHANGE_Y)) / C.WALK_SPEED + 3;
      if (outfit >= 0 && tu.t > est) {
        mem.wantOutfit = outfit;
        mem.targetTile = C.tileIndex(target.c, target.r);
        const key = `${s.round}:${seat}:${tu.botCount}`;
        if (mem.botKey !== key) {
          mem.botKey = key;
          mem.sloppy = s.rng() < 0.07;
        }
        steerTown(inp, tu, entryOf(building('lot')));
        return;
      }
    }
    if (tu.assay === 'none' && !mem.assayDone && tu.t > 14 && s.round <= 8 && mem.assayUrge) {
      const cand = s.tiles.filter((t) => !t.exchange && !t.assayed && t.type !== 'dip' && t.owner < 0);
      if (cand.length) {
        let best = cand[0];
        let bestD = Infinity;
        cand.forEach((t) => {
          const c = C.tileCenter(t);
          const d = Math.hypot(c.x - C.EXCHANGE_X, c.y - C.EXCHANGE_Y);
          if (d < bestD) {
            bestD = d;
            best = t;
          }
        });
        mem.assayTile = C.tileIndex(best.c, best.r);
        steerTown(inp, tu, entryOf(building('assay')));
        return;
      }
    }
    if (tu.assay === 'need-sample') {
      const t = s.tiles[mem.assayTile];
      steerTown(inp, tu, { x: t.c < 5 ? C.TOWN.exitLeft - 20 : C.TOWN.exitRight + 20, y: C.TOWN.street });
      return;
    }
    // Nothing left to do: Degens skip the coin-flip bar and just end the turn.
    if (C.characterOf(p).swing > 1) {
      inp.b = true;
      return;
    }
    steerTown(inp, tu, entryOf(building('pub')));
    return;
  }

  // On the map.
  if (tu.hasBot) {
    const t = mem.targetTile >= 0 ? s.tiles[mem.targetTile] : null;
    if (!t || t.owner !== seat) {
      steer(inp, tu.x, tu.y, C.EXCHANGE_X, C.EXCHANGE_Y);
      return;
    }
    const c = C.tileCenter(t);
    // The bot trails 58px behind, so stand just past the pad.
    const d = steerMap(inp, tu, c.x + tu.facing * 58, c.y - 6);
    const botD = Math.hypot(tu.bx - c.x, tu.by - c.y);
    if (mem.sloppy && d < 70) {
      inp.x = 0;
      inp.y = 0;
      press();
    } else if (d < 10) {
      // Stand still and let the bot swing in behind before pressing.
      inp.x = 0;
      inp.y = 0;
      if (botD < 20) press();
    }
    return;
  }
  if (s.coin && !tu.coinCaught) {
    // CPUs take a human-ish moment to notice it, and sometimes don't bother.
    if (mem.coinKey !== s.coin) {
      mem.coinKey = s.coin;
      mem.coinDelay = 0.5 + s.rng() * 0.5;
      mem.coinWant = s.rng() < 0.6;
    }
    mem.coinDelay -= dt;
    const d = Math.hypot(s.coin.x - tu.x, s.coin.y - tu.y);
    if (mem.coinWant && mem.coinDelay <= 0 && d < s.coin.t * C.WALK_SPEED * 0.8) {
      steerMap(inp, tu, s.coin.x, s.coin.y);
      return;
    }
  }
  if (tu.assay === 'need-sample') {
    const c = C.tileCenter(s.tiles[mem.assayTile]);
    if (steerMap(inp, tu, c.x, c.y) < 30) {
      press();
      mem.assayDone = true;
    }
    return;
  }
  steer(inp, tu.x, tu.y, C.EXCHANGE_X, C.EXCHANGE_Y);
}

function landBid(s, seat, mem, inp, dt) {
  const L = s.land;
  const lot = L.lots[L.idx];
  if (L.stage !== 'bid' || lot.seller === seat) return;
  const key = `${s.round}:${L.idx}`;
  const p = s.players[seat];
  if (mem.landKey !== key) {
    mem.landKey = key;
    const t = s.tiles[lot.tile];
    const v = plotValue(s, t, seat);
    // Worth roughly two and a half rounds of its best output, if affordable.
    let willing = Math.round(v * 1.6 + s.rng() * 60);
    willing = Math.min(willing, p.money - 300);
    mem.landWilling = willing >= lot.min ? willing : 0;
    mem.landDelay = 0.4 + s.rng() * 1.2;
  }
  mem.landDelay -= dt;
  if (mem.landDelay > 0 || mem.landWilling <= 0) return;
  // Raise only when someone else is leading, and never past what it's worth to us.
  if (L.leader !== seat && L.bids[seat] < mem.landWilling) inp.y = -1;
}

function auctionTurn(s, seat, mem, inp, dt) {
  const a = s.auction;
  const p = s.players[seat];
  const good = a.good;
  if (!mem.auc || mem.auc.key !== `${s.round}:${a.gi}`) {
    let want = 0;
    const have = p.goods[good];
    if (good === 'tendies') {
      const need = C.foodNeedFor(s, p, s.round + 1) + 1;
      want = have < need ? need - have : have > need + 1 ? -(have - need - 1) : 0;
    } else if (good === 'fuel') {
      const need = C.nonFuelBots(s, seat) + 1;
      want = have < need ? need - have : have > need + 1 ? -(have - need - 1) : 0;
    } else want = -have;
    mem.auc = { key: `${s.round}:${a.gi}`, want, delay: 0.3 + s.rng() * 1.5 };
  }
  const m = mem.auc;
  if (a.stage === 'declare') {
    if (m.want > 0) inp.y = -1;
    else if (m.want < 0) inp.y = 1;
    return;
  }
  if (a.stage !== 'trade' || !a.active[seat]) return;
  m.delay -= dt;
  if (m.delay > 0) return;
  if (a.roles[seat] === 'buy') {
    if (a.bought[seat] >= m.want) {
      inp.b = true;
      return;
    }
    const ceiling = Math.min(p.money, s.store.stock[good] > 0 ? s.store.sell[good] : s.store.sell[good] * 1.4);
    if (a.price[seat] < ceiling) inp.y = -mem.patience;
  } else {
    if (a.sold[seat] >= -m.want) {
      inp.b = true;
      return;
    }
    if (a.price[seat] > s.store.buy[good]) inp.y = mem.patience;
  }
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
        const v = plotValue(s, s.tiles[i], seat) + s.rng() * 60;
        if (v > bestV) {
          bestV = v;
          best = i;
        }
      });
      mem.round = s.round;
      mem.target = best;
      mem.react = 0.08 + s.rng() * 0.3;
      mem.assayDone = false;
      mem.assayUrge = s.rng() < 0.45;
    }
    if (cl.order[cl.pos] === mem.target) {
      mem.react -= dt;
      if (mem.react <= 0) inp.a = true;
    }
    return inp;
  }
  if (s.phase === 'walk' && s.turn.seat === seat) walkTurn(s, seat, mem, inp, dt);
  else if (s.phase === 'auction') auctionTurn(s, seat, mem, inp, dt);
  else if (s.phase === 'land') landBid(s, seat, mem, inp, dt);
  return inp;
}
