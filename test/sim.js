// Plays AI-only games with no drawing and checks they finish sensibly.
// Run with: node test/sim.js [games]

import * as C from '../js/core.js';
import { makeAI, aiInput } from '../js/ai.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAMES = Number(process.argv[2]) || 100;
const dt = 1 / 60;
let failures = 0;
const agg = { plots: 0, bots: 0, lost: 0, worth: 0, colony: 0, success: 0, whales: 0, assays: 0, botsLeft: 0, minMoney: Infinity, maxWorth: 0, endings: {} };
const wins = [0, 0, 0, 0];
const byChar = {};
const worthBySeat = [0, 0, 0, 0];
const botsBySeat = [0, 0, 0, 0];
const dbg = [0, 1, 2, 3].map(() => ({}));

for (let g = 0; g < GAMES; g++) {
  // One of each character, rotating seats so no character always sits first.
  const defs = [0, 1, 2, 3].map((i) => {
    const c = C.CHARACTERS[(i + g) % C.CHARACTERS.length];
    return { kind: 'ai', name: `${c.name} CPU`, char: c.id };
  });
  const s = C.newGame(defs, mulberry32(g + 1));
  const ais = defs.map(() => makeAI());
  let steps = 0;
  const seen = {};
  while (s.phase !== 'over' && steps < 60 * 60 * 90) {
    C.update(
      s,
      defs.map((_, i) => aiInput(s, i, ais[i], dt)),
      dt
    );
    s.players.forEach((p) => {
      if (p.money < 0) seen.negativeMoney = true;
      C.GOODS.forEach((gd) => {
        if (p.goods[gd] < 0) seen.negativeGoods = true;
      });
    });
    if (s.store.bots < 0 || Object.values(s.store.stock).some((v) => v < 0)) seen.negativeStore = true;
    steps++;
  }
  const problems = Object.keys(seen);
  if (s.phase !== 'over') problems.push(`did not finish (phase ${s.phase}, round ${s.round})`);
  if (s.tiles.some((t) => t.exchange && (t.owner >= 0 || t.type !== 'plain'))) problems.push('exchange tile altered');
  const r = s.result;
  if (r) {
    agg.colony += r.colony;
    agg.success += r.success ? 1 : 0;
    agg.endings[r.ending] = (agg.endings[r.ending] || 0) + 1;
    wins[r.rows[0].seat]++;
    agg.maxWorth = Math.max(agg.maxWorth, r.rows[0].worth);
  }
  for (let i = 0; i < 4; i++) {
    const p = s.players[i];
    agg.plots += C.countPlots(s, i);
    agg.bots += C.countBots(s, i);
    agg.lost += p.lostBots;
    agg.whales += p.whales;
    agg.worth += C.netWorth(s, p);
    const bc = (byChar[p.char] = byChar[p.char] || { worth: 0, wins: 0, n: 0 });
    bc.worth += C.netWorth(s, p);
    bc.n++;
    if (s.result && s.result.rows[0].seat === i) bc.wins++;
    worthBySeat[i] += C.netWorth(s, p);
    botsBySeat[i] += C.countBots(s, i);
    Object.entries(p.dbg).forEach(([k, v]) => (dbg[i][k] = (dbg[i][k] || 0) + v));
    dbg[i].whales = (dbg[i].whales || 0) + p.whales;
    dbg[i].lost = (dbg[i].lost || 0) + p.lostBots;
    dbg[i].money = (dbg[i].money || 0) + p.money;
    agg.minMoney = Math.min(agg.minMoney, p.money);
    if (C.countPlots(s, i) < 4) problems.push(`seat ${i} only has ${C.countPlots(s, i)} plots`);
  }
  agg.assays += s.tiles.filter((t) => t.assayed).length;
  if (g < 3) console.log(`game ${g + 1} stats`, JSON.stringify(s.stats), 'store', JSON.stringify(s.store));
  agg.botsLeft += s.store.bots;
  if (problems.length) {
    failures++;
    console.log(`game ${g + 1}: ${problems.join('; ')}`);
  }
}

const per = (v) => (v / GAMES / 4).toFixed(2);
console.log(`${GAMES} games, ${failures} with problems.`);
console.log(`Per seat: ${per(agg.plots)} plots, ${per(agg.bots)} bots, ${per(agg.lost)} bots lost, ${per(agg.whales)} whales, net worth $${Math.round(agg.worth / GAMES / 4)}`);
console.log(`Colony: avg $${Math.round(agg.colony / GAMES)}, success ${agg.success}/${GAMES}, best player $${agg.maxWorth}, lowest cash seen $${agg.minMoney}`);
console.log(`Assayed plots per game ${(agg.assays / GAMES).toFixed(1)}, bots left in lot ${(agg.botsLeft / GAMES).toFixed(1)}, wins by seat ${wins.join('/')}`);
console.log('Endings:', agg.endings);
console.log('By character:', Object.entries(byChar).map(([k, v]) => `${k}: avg $${Math.round(v.worth / v.n)}, ${v.wins} wins`).join(' · '));
dbg.forEach((d, i) => console.log(`seat ${i}`, Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v / GAMES)]))));
console.log('Avg worth by seat', worthBySeat.map((w) => Math.round(w / GAMES)).join('/'), 'bots by seat', botsBySeat.map((b) => (b / GAMES).toFixed(1)).join('/'));
process.exit(failures ? 1 : 0);
