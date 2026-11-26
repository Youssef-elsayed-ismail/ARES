# AI disclosure — ARES: The Mars Survival Map

NASA Space Apps asks teams to say clearly where and how AI tools were used. This is the full list, after a short note on
what the team did itself.

The team's own work:
- **The idea and the design.** A survival walk on real Mars data with a companion who reads the data for you; the rules,
  the levels, the oxygen, the landing sites on ground no rover has reached.
- **The decisions.** What goes in and what stays out. Examples: a radiation layer was removed because no real data
  backed it; ARES may answer only from NASA data and the mission, and must name his source; numbers on the map were
  replaced by labels; the route had to be checked against the real rover.
- **Direction, art direction and testing.** Every build was played by the team, and the changes that followed came from
  that play. The team chose the look, the name, the story and the music.

| What | AI used? | How it is marked |
|---|---|---|
| **The idea** (a survival walk on real Mars data, with a companion who reads the data for you) | No. The concept and every design decision are the team's. | — |
| **Code** (`game/*.js`, `game/index.html`, `tools/*.py`) | Yes. Written with an AI coding assistant (Claude, by Anthropic) to the team's design, then tested and corrected by the team build by build. | This file, the README, a comment and `<meta name="ai-disclosure">` in `game/index.html`. |
| **Characters, ground textures, rocks, objects** (`game/assets/astro.png`, `ares.png`, `tex/`, `props/`, `items/`; originals in `art_src/`) | Yes. Generated with ChatGPT (OpenAI) image generation, to the team's art direction, then cut up and placed by our own code. | A visible **"AI-GENERATED ART"** label on screen wherever they appear; a banner on every sheet in `art_src/`; a text chunk in each PNG's metadata. |
| **Terrain, slopes, night heat, the PHOTO layer, the rover's path, the photos at each ship piece** | No. NASA / USGS data, fetched by `tools/`. | Sources are named in the game and in the README. |
| **ARES's answers** | No language model. Tools compute on the data; a written knowledge base is searched (`game/ares.js`). | Each answer shows its source. |
| **Sound and the opening cinematic** | No AI generation. Sound effects are synthesised by code in the browser; the music of the opening story is a recorded track by a human composer ("Epic Trailer" by nastelbom, from Pixabay), not AI-generated; the cinematic is drawn by code from the art above. | The cinematic carries the "AI-GENERATED ART" label because it shows that art. |

**NASA branding.** The image generator drew a NASA wordmark on the rover and a NASA flag. Generated content may not
carry NASA branding, so the wordmark was painted out and the flag removed (`tools/mark_ai_art.py`); neither appears in
the game. The rover in the game is an illustration, not a NASA image.
