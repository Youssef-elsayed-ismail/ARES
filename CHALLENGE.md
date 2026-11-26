# NASA Space Apps 2026 — Interplanetary Survival Guide: Martian Map

Source: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/
Difficulty: Intermediate · Subjects: Human Exploration, Mars, Planets & Moons, Software, Space Exploration

## The ask
Build a map / tool / interface a Mars astronaut could use during a surface excursion (Marswalk):
a **layered, integrated, hyper-local view** of a location or route, combining data from multiple NASA missions.
Existing tools (Mars Trek, USGS geologic maps) are regional/global — the gap is **hyper-local, mission-specific**.

## Objectives (what judges will look for)
1. Pick **science goals** + a **location** (e.g. boxwork formations at Mount Sharp, studied by Curiosity in 2025).
2. Layer **≥3 data types**: optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, chemical.
3. **Safety first**: radiation / space weather, terrain hazards, suit mobility constraints.
4. **Route map** to the science targets that avoids obstacles (large rocks, steep slopes).

## Optional considerations (differentiators)
- Form factor: habitat planning display, tablet app, or **helmet HUD**.
- Static, interactive, or a **generator** that builds maps for any location / data mix.
- Time frame: past, predicted future, or timeless (topo / geology).
- Include **rover point-of-view images** so the astronaut knows what to expect.
- Rover-assisted transport, or astronauts working in pairs.

## Official resources (Resources tab) — triage
| Resource | Useful? | Notes |
|---|---|---|
| JPL Mars Trek — https://trek.nasa.gov/mars/ | **Core** | Map layers (CTX, HiRISE, DTMs, slope, THEMIS) via WMTS/downloads. Pull only our site. |
| USGS Mars geologic maps — https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars | **Yes** | Geologic units (vector) — small; clip to site. |
| Curiosity proposed path up Mount Sharp — https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/ | Reference | Visual example of a route map; inspiration, not data. |
| NASA Worldview — https://worldview.earthdata.nasa.gov/ | **Skip** | Earth-only imagery. Not relevant to Mars data. |
| Perseverance raw images — https://mars.nasa.gov/mars2020/multimedia/raw-images/ | **Yes, selectively** | >1M images. Download only the sols/cameras covering our route (POV images). |

## Data strategy
Do NOT bulk-download. Everything is clipped to one site:
- Topography: HiRISE DTM (≈1 m) + CTX DTM / MOLA context → slope & roughness hazard layer
- Optical: HiRISE / CTX orthoimages
- Thermal: THEMIS (thermal inertia → loose sand vs bedrock)
- Spectral / chemical: CRISM mineral maps
- Radiation / atmosphere: MSL RAD + REMS (Gale) or MEDA (Jezero); MAVEN space weather
- Ground truth: rover raw images along the route
