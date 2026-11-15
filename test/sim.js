// Plays AI-only games with no drawing and checks they finish sensibly.
// Run with: node test/sim.js

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

const GAMES = 200;
const dt = 1 / 60;
let failures = 0;
let totalPlots = 0;
let totalBots = 0;
let totalLost = 0;

for (let g = 0; g < GAMES; g++) {
  const defs = [0, 1, 2, 3].map((i) => ({ kind: 'ai', name: `Hedgie ${i + 1}` }));
  const s = C.newGame(defs, mulberry32(g + 1));
  const ais = defs.map(() => makeAI());
  let steps = 0;
  while (s.phase !== 'over' && steps < 60 * 60 * 20) {
    C.update(
      s,
      defs.map((_, i) => aiInput(s, i, ais[i], dt)),
      dt
    );
    steps++;
  }
  const dips = s.tiles.filter((t) => t.type === 'dip').length;
  const problems = [];
  if (s.phase !== 'over') problems.push('did not finish');
  if (dips < C.COLS) problems.push(`only ${dips} dip tiles`);
  if (s.tiles.some((t) => t.exchange && (t.owner >= 0 || t.type !== 'plain'))) problems.push('exchange tile altered');
  for (let i = 0; i < 4; i++) {
    const plots = C.countPlots(s, i);
    const bots = C.countBots(s, i);
    totalPlots += plots;
    totalBots += bots;
    totalLost += s.players[i].lostBots;
    if (plots > C.ROUNDS) problems.push(`seat ${i} has ${plots} plots`);
    if (plots < C.ROUNDS - 2) problems.push(`seat ${i} only claimed ${plots} plots`);
    if (bots < plots - 1) problems.push(`seat ${i} staffed ${bots} of ${plots} plots`);
  }
  if (problems.length) {
    failures++;
    console.log(`game ${g + 1}: ${problems.join('; ')}`);
  }
}

console.log(
  `${GAMES} games, ${failures} with problems. Average per seat: ${(totalPlots / GAMES / 4).toFixed(2)} plots, ${(totalBots / GAMES / 4).toFixed(2)} bots, ${(totalLost / GAMES / 4).toFixed(2)} bots ran off.`
);
process.exit(failures ? 1 : 0);
