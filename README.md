# Tendie Town

A four-player couch economic strategy game for the browser, played with game controllers. The apes made it to the moon; now somebody has to run the place.

## Play

- Game: https://wellmanaz.github.io/tt/
- Controller test: https://wellmanaz.github.io/tt/pad
- AI-only demo: https://wellmanaz.github.io/tt/?demo
- Shorter game: add `?rounds=6`

Press A to join, Menu to start. Empty seats are played by Hedgies (AI). Y (or M on a keyboard) toggles the music, which is an original loop synthesised in the browser (`js/music.js`).

By default the game streams the M.U.L.E. main theme from the site that hosts it (no copy is stored in this repository) and falls back to its own synthesised loop (`js/music.js`) if that fails to load. `?music=synth` forces the built-in loop; `?music=<url>` plays any other audio file. Music pauses during auctions.

## A round

1. **Land grab** — a scanner sweeps the plots; press A to claim the one it's on. One free plot each per round.
2. **Turns** (poorest player first) — you start in The Exchange. Buy a bot at the Bot Lot, fit a tool at one of the four shops, walk out an exit to your plot and press A on its pad to install it. Miss the pad, or run out of time with a bot in tow, and it bolts. The Assay Office checks a crater for hidden diamonds. The YOLO Bar ends your turn for cash (more the sooner you quit). A Bitcoin sometimes blinks into view near you; run over it before it vanishes for a bounty. Your turn is shorter if you are short on tendies, and standing still burns the clock twice as fast.
3. **Production** — each bot produces by terrain: the Dip (the river valley) grows tendies, the Solar Flats pump fuel, Silicon Ridge mines chips, and diamonds are only found in the impact craters, in amounts the assay reveals. Bots next to a same-tool bot of yours make +1; every three of the same tool make +1. Every non-fuel bot burns 1 fuel first or sits idle. A random event may hit the colony.
4. **Trading floor** — tendies, fuel, chips, then diamonds. Declare buyer or seller (stick up/down), then buyers push up and sellers push down until they meet. The Exchange buys and sells at posted prices while it has room or stock.
5. **Standings** — half your spare tendies and fuel spoil. The Exchange builds bots from the chips it bought.

After 12 rounds the richest ape wins, and the colony as a whole needs $60,000 to count as a success.

## Characters

Six to pick from, each with a trade-off shown on the character card: Ape, Autist, Degen, Smooth-Brain, Regard (nothing of theirs spoils, but starts poorer and pays more in shops) and Full-Regard (starts with $1,800, pays 30% more in shops, shorter turns). The art for all but Smooth-Brain is cut at load time from `assets/chars/sheet.jpg`; the flat grey background is removed in the browser, so a replacement sheet only needs the same six-cell layout.

## Your own images

A tendies plot shows a fast-food sign instead of a robot. The signs are parodies drawn in code; to use pictures of your own, put PNG files in `assets/food/` named `1.png`, `2.png`, … (up to 8) and they are used instead. No such images are included in this repository.

## Contents

- `index.html`, `js/main.js` — browser side: input, lobby, drawing
- `js/core.js` — game rules and state, no browser code
- `js/ai.js` — rule-based AI that produces controller-style input
- `pad/index.html` — shows every connected controller and its button presses
- `test/sim.js` — plays AI-only games headless and reports balance statistics

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
node test/sim.js 100          # AI-only test games
```
