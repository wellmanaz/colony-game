# Tendie Town

A four-player couch economic strategy game for the browser, played with game controllers. The apes made it to the moon; now somebody has to run the place.

Early prototype: the map, the land grab and walking a bot out to your plot. No economy yet.

## Play

- Game: https://wellmanaz.github.io/tt/
- Controller test: https://wellmanaz.github.io/tt/pad
- AI-only demo: add `?demo` to the game address

Press A to join, Menu to start. Empty seats are played by Hedgies (AI).

## Contents

- `index.html`, `js/main.js` — browser side: input, lobby, drawing
- `js/core.js` — game rules and state, no browser code
- `js/ai.js` — rule-based AI that produces controller-style input
- `pad/index.html` — shows every connected controller and its button presses
- `test/sim.js` — plays 200 AI-only games headless and checks they finish sensibly

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
node test/sim.js              # AI-only test games
```
