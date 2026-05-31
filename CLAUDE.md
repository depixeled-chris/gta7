# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based, GTA-style 3D open-world **vertical slice** built from scratch in TypeScript + Three.js: a procedural night city you can drive a car around, get out, and walk on foot, with ambient traffic and pedestrians. It is a tech demo, not a full game. (The name is a joke.)

## Commands

```bash
npm install                 # first-time setup
npm run dev                 # Vite dev server (hot reload) — play at the printed URL
npm run build               # tsc --noEmit (typecheck) THEN vite build -> dist/
npm test                    # Vitest: pure-logic unit tests (node env)
npm run test:watch          # Vitest in watch mode
npm run smoke               # build + headless-Chromium render check (see below)
npm run test:e2e            # build + render + gameplay (keyboard) + touch/mobile tests
npm run preview             # serve the built dist/
```

Run a single test file or case:

```bash
npx vitest run src/vehicles/VehicleModel.test.ts
npx vitest run -t "caps speed at maxSpeed"
```

The browser tests (`scripts/smoke.mjs`, `scripts/interaction.mjs`) require Chromium once: `npx playwright install chromium`. Both self-host the built app. `smoke` fails on any console/page error and decodes a screenshot to assert the scene actually rasterized (color diversity + lit-pixel fraction) rather than rendering a blank canvas. `interaction` drives the real game (keyboard) to assert gameplay: building collision, carjacking, shoving, pedestrian braking, and WASTED. `touch` runs a mobile (touch) context to assert the on-screen joystick drives the car and the buttons work, and that desktop shows no touch UI. All use the `window.__game` debug handle (mode, health, wasted, `vehicles`, `player`, `city`) exposed from `main.ts` — keep it in sync if you add state worth testing.

## Architecture

The codebase is split along one hard line: **the simulation core is pure and Three.js-free; the rendering/runtime layer owns everything that imports `three`.** This is what makes the gameplay logic unit-testable in a node environment.

**Pure core (no `three`, unit-tested):**
- `src/core/` — `math` (clamp/lerp/frame-rate-independent `damp`/`angleDelta`/`safeApproachSpeed`/`stickVector`/`pursuitSpeed`), `rng` (seeded mulberry32 + `hashSeed` for per-chunk/field seed mixing), `noise` (deterministic simplex fields + `fbm`/`ridged`/`domainWarp`, the basis for the generative world — see `docs/research/generative-world.md`). Browser-glue (not pure, no Three): `Input` (keyboard edge detection), `GameLoop` (fixed-timestep accumulator), `Controls` (merges keyboard + touch into one analog intent).
- `src/audio/RadioModel.ts` — pure tuner logic (station/track index, OFF state, wrap), unit-tested.
- `src/world/City.ts` — deterministic procedural city generation: traffic lanes, streetlights, curbside parking, spawn point, and the `SpatialGrid`. Buildings + colliders come from **`generateChunk(cx,cz,config)`** — a pure function seeded by `hashSeed(seed,cx,cz)`, so a chunk is identical regardless of visit order. The finite city is just a tiling `generateChunk(0,0)..(n,n)` (`config.chunkBlocks` blocks per chunk); this is the seam the streamed world (R007) loads on demand. `src/world/biome.ts` — pure `classify(urbanity, elevation)` + a `BIOMES` data table (density/height/palette per biome), no scattered biome conditionals.
- **World-gen determinism (invariant):** generation is a pure function of `(seed, worldX, worldZ)` — continuous fields (`core/noise`) for anything that crosses a chunk seam, a per-chunk hashed RNG for discrete placement; never `Math.random()`, visit order, or neighbor state. It's unit-tested (same coord ⇒ identical). This is also why a Rust/WASM port is deferred — it would have to match `mulberry32`+noise bit-for-bit.
- `src/vehicles/VehicleModel.ts` — pure arcade vehicle dynamics. `stepVehicle` is a pure function (state + input → state) over a world **velocity vector**; it decomposes velocity into forward/lateral each step and bleeds the lateral part off by tyre grip. The handbrake slashes that grip, which is what produces powerslides.
- `src/systems/Collision.ts` — circle-vs-AABB push-out, circle-vs-circle overlap (for car-on-car), and nearest-point search.

**Render/runtime layer (imports `three`, browser-only):**
- `src/render/` — `Scene` (renderer, dusk lighting, ground/roads, fog), `Assets` (building/car/ped/streetlight mesh factories + material cache), `textures` (procedural facade + radial-glow canvas textures).
- `src/systems/` — `FollowCamera` (smoothed chase cam), `Vehicles` (ALL cars — player, AI traffic, parked-from-`city.parkingSpots` — with one shared physics + collision pass), `Pedestrians` (ambient walkers that get run over), `Debris` (pooled cube gibs flung when a pedestrian is hit), `Smoke` (pooled billboard-**sprite** particles — NOT geometry — that a car under half health trails, thicker as it nears wrecking; owned by `Vehicles`).
- `src/entities/Player.ts` — on-foot avatar controller.
- `src/ui/HUD.ts` — DOM overlay: speedometer, mode, health bar, run-over counter, radio readout, WASTED screen, live minimap (a `touch` flag repacks it for small screens). `src/ui/TouchControls.ts` — on-screen joystick + action buttons (lucide SVG icons) + a fullscreen toggle, for touch devices. Buttons clear the notch via `env(safe-area-inset-*)`. iPhone Safari has no element-fullscreen API, so true fullscreen there is Add-to-Home-Screen (the `apple-mobile-web-app-*` meta + `manifest.webmanifest` make that launch chrome-less).
- `src/audio/Radio.ts` — runtime radio: one streaming `<audio>` element driven by `RadioModel`. Plays only in a car; entering one drops you onto a random track at a random offset (live-broadcast feel); the next track is prefetched via `<link rel=prefetch>`. Bounded retry on load error so a network outage can't spin the tuner. **iOS:** the first `audio.play()` must run inside a user gesture, so `main` primes the radio from `markGesture` (the gesture handler), never from the game loop — otherwise iOS keeps it silent until the radio button is tapped.
- `src/audio/Sfx.ts` — synthesized sound effects via Web Audio (no files): speed-tracking engine drone, tyre screech (filtered noise), gib crunch, enter/exit blips. Context created/resumed on first gesture.
- Police live in `Vehicles` as a pooled `role: 'police'` (idle off-map, `active` toggled by `setWanted`). `drivePolice` blends Reynolds steering behaviors — pursuit/interception (`leadTime`), separation (anti-stacking), and obstacle avoidance (a look-ahead probe through `resolveCircle`) — into a desired direction; flashing light bars toggle in `render`.
- Pedestrians flee the on-foot player: `Pedestrians.update` takes a `threat` position; within `FEAR_RADIUS` a ped turns to face away, runs at `FLEE_SPEED`, and trembles (a render-only jitter). Passed `null` while driving.
- `src/main.ts` — the orchestrator: builds the world, owns the driving↔on-foot state machine, the player health / WASTED / respawn cycle, runs the loop, applies collision, drives the camera, and manages the dynamic light pool + headlights.

### Conventions and invariants (read before editing sim code)

- **Coordinate frame (single source of truth):** world X = east, Z = south, Y = up. Heading `0` points along +X and increases counter-clockwise (toward −Z). Forward = `(cos h, 0, −sin h)`, right = `(sin h, 0, cos h)`. `VehicleModel`, `Vehicles`, `Player`, and `FollowCamera` all assume this — keep new systems consistent with it. A car mesh's `rotation.y` equals its heading directly.
- **One physics model for all cars:** the player's car, AI traffic, and parked/abandoned cars are the same `Car` struct in `Vehicles`. Only the player car is integrated by `stepVehicle`; AI cars follow lanes (with knock-and-recover), parked cars coast to rest. A single pass then resolves every car against buildings and against each other (momentum exchange). Don't add a separate code path for "the player car" — extend the shared one.
- **Determinism:** `City`, `Vehicles`, and `Pedestrians` are seeded via `createRng`. Same seed → same world. The `City` tests depend on this; don't introduce `Math.random()` into world generation.
- **Lighting budget:** the night look is mostly emissive (building windows, lamp heads) plus one shadow-casting directional light. Real dynamic lights are kept to a tiny pool — the streetlights are emissive meshes + additive ground "glow pools", and only ~6 pooled `PointLight`s hop to the streetlights nearest the player each frame; headlights are 2 non-shadow `SpotLight`s on the driven car. Don't add a real light per streetlight (81 of them) — extend the pooling in `main.ts`.
- **One input abstraction:** the game reads player intent only through `Controls` — `move()` (x: right+, y: forward+), `handbrake()`, `sprint()`, `enterExitPressed()`, `resetPressed()`, `punchPressed()`, `radioStep()`. Keyboard, touch, AND **gamepad** all feed it and are summed; **keyboard is always active**, touch is added on coarse-pointer devices, gamepad when a `mapping:"standard"` pad is connected. Gamepad mapping is a pure tested fn (`core/gamepad.ts` `readGamepadIntent`) + thin polling glue; see `docs/research/gamepad-support.md`. Driving uses `throttle = move.y`, `steer = -move.x`; on foot `forward = move.y`, `strafe = move.x`. Don't read raw keys or touch state in `main` — extend `Controls`.
- **Mobile quality:** touch devices get `maxPixelRatio: 1.5`, a 1024 shadow map, and fewer traffic/peds (passed from `main`). `?touch=1|0` forces/disables the touch path for testing on desktop.
- **Assets / where files go:** `public/` for runtime, URL-loaded, unprocessed files (3D models in `public/models/*.glb` loaded via `GLTFLoader`, runtime textures, splash image, `manifest.webmanifest`, `radio.json`) — reference them via `import.meta.env.BASE_URL` (the site is served from `/gta7/`, so a bare `/foo` 404s in prod). `src/assets/` for assets *imported in code* (Vite hashes/optimizes them) — small UI images/icons. **Large binaries (big models, texture sets, audio) go on a GitHub Release and stream by URL — never commit them** (Pages ~1 GB cap + git bloat). Models are a render-layer concern; keep the sim core Three-free.
- **Radio audio is NOT in the repo.** The MP3s live on a GitHub Release (`radio-v1`) and stream one-at-a-time over CDN range requests; only `public/radio.json` (the manifest: `baseUrl` + stations/tracks) is committed. To change the library, re-run the staging step (copies tracks to gitignored `.radio-staging/`, regenerates `radio.json`), then `gh release upload radio-v1 ... --clobber`. Never commit the audio — it would bloat git and blow past Pages limits.
- **Wanted system:** `main` keeps a 0–100 `heat` meter (raised by your own pedestrian kills, cooled after a grace period via `safeApproachSpeed`-style decay), mapped to 0–5 stars by `starsFromHeat`. Each frame `vehicles.setWanted(stars, target, city)` keeps exactly that many police active and chasing. WASTED clears heat.
- **Pedestrian safety / WASTED:** AI cars brake for the on-foot player via `safeApproachSpeed(gap, decel)` with a capped deceleration rate, so they stop for you when there's room but can't when you dart in from inside the stopping distance. `Vehicles.pedestrianImpact(px,pz,includePlayer)` reports the fastest car overlapping a point (and whether it's the player's). On foot it drives edge-triggered damage → WASTED → respawn (`includePlayer:false`). For pedestrians it's queried with `includePlayer:true`: any car over RUNOVER_SPEED splatters them into a `Debris` burst and respawns them, but only `isPlayer` hits add to the HUD run-over count.
- **Fixed timestep:** `GameLoop` calls `update(dt)` at a constant 60 Hz and `render()` once per frame. Put simulation in `update`, presentation in `render`.
- **Collision model:** every moving actor is a ground-plane circle; the world is `city.colliders` (axis-aligned building footprints). Resolve through **`city.grid.resolve(x,z,r)`** — a `SpatialGrid` (uniform spatial hash over the colliders, built once in `generateCity`) that's push-out-equivalent to a full `resolveCircle` scan but near-O(1) per query. Its unit test asserts that equivalence over the real city; `resolveCircle` itself stays only as the reference/tested primitive. Every hot-path caller (cars, peds, on-foot player, police feeler) goes through the grid.
- **Damage model:** each `Car` carries `health` (0–100). `crashDamage(impactSpeed)` (pure, in `VehicleModel`) turns building/car-car closing speed into damage above a free-bump threshold; `Vehicles.collide` applies it. At 0 health a car wrecks: `Debris.explode` chunks + `Sfx.explosion`, then the player car sets a flag main reads to trigger WASTED, while any NPC car is recycled (relocated to a fresh lane/spot at full health, mesh reused — same pooling idea as police). The HUD health bar shows car integrity while driving, avatar health on foot.
- **Building UVs (`Assets.scaleFacadeUvs`)** rely on Three's `BoxGeometry` face/group order: +X, −X, +Y, −Y, +Z, −Z. The roof/floor faces are intentionally collapsed to a dark texel.

### Testing rules specific to this repo

- Vitest runs in a **node environment** (`vite.config.ts` → `test.environment: 'node'`) and only includes `src/**/*.test.ts`. There is no DOM or WebGL in tests.
- **Never import a `three`-dependent module from a `*.test.ts`** — it will fail to load. New game logic that needs testing belongs in the pure core; keep rendering out of it.
- `tsconfig` has `noUnusedLocals` and `noUnusedParameters` on — the build fails on dead bindings.
