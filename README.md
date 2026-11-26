# ARES — The Mars Survival Map

**NASA Space Apps Challenge 2026 · Cairo · Team Alexstra**
Challenge: *Interplanetary Survival Guide: Martian Map*

A 2D pixel-art survival game played on a map of the real Jezero Crater. A stranded traveller, ARES, needs you to
recover three pieces of a wrecked ship and walk back before your oxygen runs out. Every hazard on the board — every
slope, sand trap and rock wall — comes from NASA data of the ground around Perseverance's landing site, and the game
checks itself against the route the real rover drove.

## How to play
| Key | Action |
|---|---|
| 1 / 2 / 3 | Start on EASY, NORMAL or HARD |
| Arrows / WASD | Jump one tile (up, down, left, right) |
| Space | Follow ARES's green line (the A* route) |
| M | Zoom out to the whole map and back |
| P | Show / hide where Perseverance really drove (white dots) |
| R | Hide / show the green line |
| 1–5 (in game) | Map layers: MAP · PHOTO · HEIGHT · SLOPE · HEAT |
| V | Switch between the 2D map and the 3D terrain (same game, other camera) |
| H | How it works: data sources, the cost function, the evidence |
| F / N | Full screen / sound on-off |
| C | 3D camera: first person / third person |
| E | Ship computer (when standing on the wreck); the mission can be ended from there |
| I | Show / hide the labels on the map |

- **EASY / NORMAL:** the green line is the cheapest, safest route. Off it, each jump burns 40% more oxygen, and steep or
  sandy ground can kill.
- **HARD:** no line. You read the SLOPE and HEAT layers and plan the walk yourself.
- **Oxygen tanks** refill 25% — but they lie on the hardest ground.
- At the rover's landing site each ship piece lies at a real place where Perseverance stopped. Reach it and you see the
  photo the rover took there. At the unvisited sites you see NASA's close-up of that tile from orbit instead.
- **Phones and tablets:** held upright, the map sits on top with touch buttons under it (arrows, ARES LEADS, MAP, LABELS,
  COMPUTER). Everything on screen can be tapped.
- Ask ARES with the buttons under his speech bubble, or type: `where?`, `tank?`, `air?`, `danger?`, `rover?`

## The science: how NASA data drives the game
The board is a window centred on Perseverance's landing site (18.4447° N, 77.4508° E): 1.60 km north–south by 1.52 km
east–west, split into 40 × 40 tiles.

| Game element | Real data | Source |
|---|---|---|
| Slope of each tile, rock walls, ledges, craters, hillshade, elevation colours, HEIGHT layer | HiRISE Digital Terrain Model, 1 m/pixel | MRO HiRISE — USGS Astrogeology (Mars 2020 terrain products) |
| Sand vs bedrock, HEAT layer | THEMIS night-time infrared mosaic, 100 m/pixel (cold at night = low thermal inertia = loose sand) | Mars Odyssey THEMIS — JPL Mars Trek |
| PHOTO layer, light/dark ground | HiRISE orthomosaic, 25 cm/pixel | MRO HiRISE — JPL Mars Trek |
| White dots: the rover's real drive, sols 14–386 | Mars 2020 localisation (waypoints and traverse) | NASA/JPL-Caltech |
| Photo shown at each ship piece | Navcam images taken at that exact rover stop | NASA/JPL-Caltech — Mars 2020 raw images |

**Route planning.** ARES plans with A* over the tile grid using a custom cost:

```
cost(step) = 40 m × (1 + 2.5 × (slope / 15°)² + 0.6 × sand)
```

Tiles steeper than 15° are impassable. The same cost drains the oxygen tank, so the planner and the survival rules agree.

**How the map is drawn.** `game/tiles.js` chooses each tile's ground texture and rocks from the data: rippled sand where
THEMIS is cold at night, cracked bedrock where it is warm, boulders where the slope is steep, craters in real hollows of
the terrain model, ledges where the ground really drops. Press PHOTO to compare with the real image.

**3D view.** Press V and the same board is shown as a terrain mesh built from the HiRISE elevation model (8 m posts,
heights exaggerated 3.5× so 46 m of real relief reads on screen). The rules, the route and the oxygen do not change —
only the camera does. Uses three.js (MIT licence, bundled in `game/lib`).

**Sound and intro.** Sound effects and the in-game music are synthesised live in the browser (`game/audio.js`); the opening story is scored with "Epic Trailer" by nastelbom (Pixabay, not AI-generated); the opening cinematic is drawn
live from the game's own art (`game/cine.js`) and plays on every visit, followed by a short recorded walk-through of the
game (`game/assets/intro.mp4`, captured frame by frame from the running game). Both can be skipped.

## Landing sites: where the rover went, and where nothing has
The menu offers four places for the ship to have come down (`tools/build_sites.py`, `game/data/sites.json`):

- **Octavia E. Butler Landing** — Perseverance's own landing site. Pieces lie at real rover stops and show the Navcam
  photo taken there.
- **Three unvisited sites.** A tile counts as unvisited when it is more than 200 m from every point of the rover's real
  traverse; 61% of the board qualifies. Sites are screened like real landing sites: under 5° of slope, firm ground, room
  around them, reachable. Their pieces lie on unvisited ground too, so no ground photo exists; each shows a real HiRISE
  close-up of its own tile instead (25 cm per pixel).

On unvisited ground the walk is planned from orbital data alone, which is what a first crew would have. Two honest
limits: no rover track exists there to check the route against, and the HiRISE close-ups show sand ripples on tiles
that THEMIS, at 100 m per pixel, reads as rock. The game says both.

## 3D cameras and the ship computer
- **C** switches the 3D camera between first person (through the visor) and third person.
- **E** at the wreck opens the ship computer, drawn as an old desktop with four folders: every NASA image of this site
  (Navcam photos at the rover's site, HiRISE close-ups elsewhere), the four orbital maps, ground data measured live from
  the layers, and this walk's numbers. Oxygen pauses while it is open. A marker on the wreck shows where it is.

## Menu and settings
The game opens on a main menu: PLAY, HOW IT WORKS, WATCH THE INTRO, THE STORY, SETTINGS, DATA & CREDITS. Settings are
kept in the browser: sound, full screen, start in 3D, labels on the map, the rover's track, and a reset of best scores.

## How ARES answers
ARES is not a language model. Every answer is either computed or retrieved, and each one names its source
(`game/ares.js`, `game/data/knowledge.json`). A question goes through four steps, in order:

1. **Navigation tool.** Directions are read off the real A* path from your tile ("3 down, then 2 left, then 7 down"),
   never a straight-line guess, so following them word for word reaches the target.
2. **State tools.** Your oxygen against the cheapest way to finish from where you stand; the slope, surface and risk of
   the four tiles around you.
3. **Data tools.** Measurements of the board, computed live from the NASA layers: steepest and flattest tile, highest and
   lowest ground, share of sand and rock, number of impassable tiles, how far the rover drove.
4. **Retrieval.** A BM25 search over a written knowledge base (24 entries on Jezero, the Mars 2020 mission, HiRISE,
   THEMIS, the planner, and what in the game is not data), with this board's live numbers filled in.

If nothing matches, ARES says so instead of guessing. After each answer it suggests related questions.

## Checked against the real rover
Perseverance drove across this same board. `tools/build_rover.py` compares its route with ours:

| Check | Rover's tiles | Whole board |
|---|---|---|
| Average slope | 4.2° | 6.1° |
| Tiles steeper than 10° | 5.4% | 10.1% |
| Tiles over our 15° limit | 0 of 93 | 17 of 1600 |
| Tiles on sand | 16.1% | 20.2% |

Rover drivers kept to gentler, firmer ground — the same ground our cost function prefers — and never crossed a tile we
mark impassable. Our terrain model also matches the elevations the rover itself reported at 85 stops to within ±0.08 m.

## What is not data
- The story (ARES, the ship, its parts), the oxygen tank size, the accident probabilities and the dust devil are game design.
- The 15° limit and the weights in the cost function are our own choices, not NASA figures.
- THEMIS is used as a relative measure inside this window (brighter = rockier). It is not a calibrated temperature, and
  at 100 m/pixel the sand/rock boundaries are approximate.
- NASA Worldview (listed with the challenge) covers Earth only and is not used. The USGS geologic maps and the Curiosity
  route example informed the design but are not loaded as data.

## Run it locally
```bash
python -m http.server 5173 --directory game
```
Then open http://localhost:5173

## Rebuild the data from NASA servers
Nothing large is downloaded: the tools stream only the window they need.
```bash
python tools/fetch_dem_window.py --out data/jezero_dem.json
python tools/build_tiles.py
python tools/build_rover.py
```
Requires Python 3 with `numpy`, `Pillow` and `scipy`. `build_rover.py` expects `data/M20_waypoints.json` and
`data/M20_traverse.json` from `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/`.

## Who did what, and how AI was used
The team's own work:
- **The idea and the design.** A survival walk on real Mars data with a companion who reads the data for you; the rules,
  the levels, the oxygen, the landing sites on ground no rover has reached.
- **The decisions.** What goes in and what stays out. Examples: a radiation layer was removed because no real data
  backed it; ARES may answer only from NASA data and the mission, and must name his source; numbers on the map were
  replaced by labels; the route had to be checked against the real rover.
- **Direction, art direction and testing.** Every build was played by the team, and the changes that followed came from
  that play. The team chose the look, the name, the story and the music.

AI tools were used as the Space Apps rules allow, and are declared here:
- **Code:** written with an AI coding assistant (Claude, by Anthropic) to the team's design, then tested and corrected
  by the team build by build.
- **Art:** the characters, ground textures, rocks and objects were generated with ChatGPT (OpenAI) image generation, to
  the team's art direction, then cut and placed by our own code. Every AI image is marked: an "AI-GENERATED ART" label on screen, a banner on
  each sheet in `art_src/`, and a note in each PNG's metadata (`tools/mark_ai_art.py`). No NASA logo or flag appears in
  any generated image. Full list: [AI_DISCLOSURE.md](AI_DISCLOSURE.md).
- **In the game:** no AI model runs inside the game. ARES answers with tools and retrieval (see "How ARES answers").
- **Data:** all terrain, traverse and photo data is NASA/USGS data as listed above. No data was generated by AI.

## Credits
NASA/JPL-Caltech/University of Arizona (HiRISE), NASA/JPL-Caltech/Arizona State University (THEMIS), USGS Astrogeology
Science Center, JPL Mars Trek, NASA/JPL-Caltech (Mars 2020 localisation and Navcam images). Music in the opening story: "Epic Trailer" by nastelbom (Pixabay). Font: Press Start 2P (SIL
Open Font License). NASA does not endorse this project.
