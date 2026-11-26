# Submission text — copy each block into the Space Apps project form

Deadline (Cairo): **Saturday 14 November 2026, 1:00 PM**. Only the team leader submits. All links must open without login.

---

## Project Name
ARES

(Tagline, for the summary line if the form has one: The Mars Survival Map)

## High-Level Project Summary
ARES is a browser game that teaches how to read a map of Mars in order to stay alive on it. You are an astronaut on
foot in Jezero Crater with a limited oxygen tank. A stranded companion, ARES, needs three pieces of its ship. Every
tile of the board is built from real NASA data: slope from the HiRISE 1 m terrain model, ground firmness from THEMIS
night-time infrared, and the surface image from the HiRISE orthomosaic. An A* planner with a cost made from slope and
ground softness draws the safest walk; the player can follow it or explore and pay for it in oxygen and risk. The game
shows why this matters: at Perseverance's landing site the planned walk uses 15% less oxygen than the shortest one,
crosses 8 dangerous tiles instead of 39, and cuts the chance of an accident from 68% to 18%. We checked the map against
the real rover: Perseverance's own track stays on the ground our map calls safe. The game runs in 2D and 3D, in any
browser, with nothing to install.

## Link to Project Demo
https://3zz2004.github.io/ARES-/demo/video.html
(29-second video, English, public, no login. Direct file: https://3zz2004.github.io/ARES-/demo/ares-demo.mp4 .
A 7-slide version is also at https://3zz2004.github.io/ARES-/demo/ — submit only one of the two links.)

## Link to Final Project
https://3zz2004.github.io/ARES-/
Source code: https://github.com/3zz2004/ARES-

## Detailed Project Description

**What it does.** ARES turns a 1.6 km × 1.52 km window of Jezero Crater, centred on Perseverance's landing site
(18.4447° N, 77.4508° E), into a board of 40 × 40 tiles of 40 m each. The player walks tile by tile to recover three
ship pieces and return before the oxygen runs out. Steep tiles and soft sand cost more oxygen; tiles steeper than 15°
cannot be crossed; dangerous tiles carry a chance of an accident. Five map layers can be switched at any time: the
game art, the real HiRISE photo, height, slope and night heat. A key switches between the 2D map and a 3D view of the
same terrain, with third-person and first-person cameras. At the wreck, a ship computer holds every NASA image of the
site, the four orbital maps and ground data measured live from the layers. The game has a main menu with settings and
works on phones and tablets with touch controls.

**How it works.**
- Data pipeline (Python, `tools/`): streams only the needed window of the HiRISE DTM by HTTP range requests, computes
  slope, reads THEMIS and HiRISE map tiles from NASA Mars Trek, and reads the Mars 2020 rover's waypoints, track and
  Navcam photos. Nothing is invented: every tile value comes from these products.
- Route planner (`game/astar.js`): A* on the tile grid.
  `cost of a step = 40 m × (1 + 2.5 × (slope / 15°)² + 0.6 × softness)`, impassable above 15°. The tour over the three
  pieces is chosen by trying every order.
- ARES, the companion (`game/ares.js`): not a language model. Directions are read off the real A* path; oxygen, slope
  and risk are computed from the data; other questions are answered by search over a written knowledge base about the
  NASA data and the mission, and each answer names its source. Unknown questions are refused instead of guessed.
- Landing sites: besides Perseverance's site, the game offers three sites on ground no rover has reached (more than
  200 m from the whole traverse), screened for slope, firmness and room like a real landing site.
- Game (HTML, JavaScript, Canvas 2D, three.js for 3D). No build step, no server, no account.

**Validation against the real rover.** Perseverance drove across this same board (sols 14–386). On our map its tiles
average 4.2° of slope against 6.1° for the whole board; 5.4% of its tiles are steeper than 10° against 10.1%; none of
its 93 tiles is over our 15° limit; and our terrain heights match the rover's own recorded elevations to ±0.08 m at
85 stops. The real mission chose the same kind of ground our planner chooses.

**Benefits and impact.** Future crews will walk on Mars with a fixed amount of air. The shortest line on a map is
often not the cheapest or the safest. ARES makes that visible and playable for children and students, from about age 10, and for the public: it teaches
slope, thermal inertia and path planning through real mission data, and shows in numbers what a good route saves. The
same method works for any place on Mars that has a terrain model.

**What is not data (stated openly in the game and README).** The story, the oxygen tank size, the accident
probabilities, the 15° limit and the cost weights are our design choices. THEMIS is used as a relative measure inside
this window, not as a calibrated temperature.

**Tools and languages.** JavaScript (ES modules), HTML/CSS, Canvas 2D, WebGL through three.js r160, Web Audio; Python
with NumPy, SciPy and Pillow for the data tools; Git and GitHub Pages for hosting.

## Use of Artificial Intelligence
Yes. AI tools were used to build what the team designed.

The team's own work:
- **The idea and the design.** A survival walk on real Mars data with a companion who reads the data for you; the rules,
  the levels, the oxygen, the landing sites on ground no rover has reached.
- **The decisions.** What goes in and what stays out. Examples: a radiation layer was removed because no real data
  backed it; ARES may answer only from NASA data and the mission, and must name his source; numbers on the map were
  replaced by labels; the route had to be checked against the real rover.
- **Direction, art direction and testing.** Every build was played by the team, and the changes that followed came from
  that play. The team chose the look, the name, the story and the music.

Where AI was used:
- **Code:** written with an AI coding assistant (Claude, by Anthropic) to the team's design, then tested and corrected
  by the team build by build. This is stated in the README, in `AI_DISCLOSURE.md`, and in a comment and metadata tag in
  the game's HTML.
- **Images:** the characters, ground textures, rocks and objects were generated with ChatGPT (OpenAI) image generation,
  to the team's art direction, then cut and placed by our own code. Every one is marked as AI-generated: a visible
  "AI-GENERATED ART" label on the game screen and in the opening cinematic, a visible banner on every source sheet in
  `art_src/`, and a text note in each PNG's metadata. No generated image contains NASA logos, flags or mission
  identifiers.
- **Not AI:** all terrain, slope, thermal, rover-track and photo data is NASA/USGS data. No data was generated or
  changed by AI. No AI model runs inside the game: ARES answers with computation and search. The opening music is a human-made track from Pixabay, not AI. All other sound is synthesised by
  code. The demo video's narration is an AI voice (ElevenLabs), stated on the video page and in the file's metadata. No other AI audio or video was used: the demo video is rendered frame by frame by code from the running game, and
  carries a "GAME ART: AI-GENERATED" label on every frame.

## NASA Data
- **HiRISE Digital Terrain Model of Jezero Crater, 1 m/pixel** (MRO HiRISE; USGS Astrogeology, Mars 2020 Terrain
  Relative Navigation products) — slope, elevation, rock walls and the 3D terrain.
  https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/
- **HiRISE orthomosaic of Jezero, 25 cm/pixel** (NASA/JPL-Caltech/University of Arizona), through NASA Mars Trek —
  the PHOTO layer, the colours of the board, and close-ups of the unvisited sites. https://trek.nasa.gov/mars/
- **THEMIS Night IR controlled mosaic, 100 m/pixel** (Mars Odyssey; NASA/JPL-Caltech/Arizona State University),
  through NASA Mars Trek — ground softness (sand against rock) and the HEAT layer.
- **Mars 2020 Perseverance localisation: waypoints and traverse** (NASA/JPL-Caltech) — the rover's real path on the
  board and the validation. https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
- **Mars 2020 raw images, Navcam** (NASA/JPL-Caltech) — the real photo shown at each ship piece at the rover's site.
  https://mars.nasa.gov/mars2020/multimedia/raw-images/

## Space Agency Partner Data and Other References
- No space agency partner data was used.
- Music in the opening story: "Epic Trailer" by nastelbom (Pixabay, track 356422), used under the Pixabay Content License. All other sound is synthesised by code.
- three.js r160 (MIT licence) — 3D rendering. https://threejs.org
- Fonts: Chakra Petch and Press Start 2P (SIL Open Font License), from Google Fonts.
- Python libraries: NumPy, SciPy, Pillow, pypdf.
- Claude, by Anthropic — AI coding assistant.
- ChatGPT, by OpenAI — AI image generation for the game art.
- GitHub Pages — hosting.
- Hart, Nilsson, Raphael (1968), "A Formal Basis for the Heuristic Determination of Minimum Cost Paths" — the A*
  algorithm.
- NASA does not endorse this project.
