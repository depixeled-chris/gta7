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
npm run test:e2e            # build + render check + gameplay interaction test
npm run preview             # serve the built dist/
```

Run a single test file or case:

```bash
npx vitest run src/vehicles/VehicleModel.test.ts
npx vitest run -t "caps speed at maxSpeed"
```

The browser tests (`scripts/smoke.mjs`, `scripts/interaction.mjs`) require Chromium once: `npx playwright install chromium`. Both self-host the built app. `smoke` fails on any console/page error and decodes a screenshot to assert the scene actually rasterized (color diversity + lit-pixel fraction) rather than rendering a blank canvas. `interaction` drives the real game to assert gameplay: building collision blocks the car, you can enter any nearby car, and ramming shoves traffic. Both use the `window.__game` debug handle (mode, `vehicles`, `player`, `city`) exposed from `main.ts` — keep it in sync if you add state worth testing.

## Architecture

The codebase is split along one hard line: **the simulation core is pure and Three.js-free; the rendering/runtime layer owns everything that imports `three`.** This is what makes the gameplay logic unit-testable in a node environment.

**Pure core (no `three`, unit-tested):**
- `src/core/` — `math` (clamp/lerp/frame-rate-independent `damp`/`angleDelta`), `rng` (seeded mulberry32), `Input` (keyboard with edge detection), `GameLoop` (fixed-timestep accumulator).
- `src/world/City.ts` — deterministic procedural city generation from a seed: buildings, AABB colliders, traffic lanes, streetlight positions, curbside parking spots, spawn point.
- `src/vehicles/VehicleModel.ts` — pure arcade vehicle dynamics. `stepVehicle` is a pure function (state + input → state) over a world **velocity vector**; it decomposes velocity into forward/lateral each step and bleeds the lateral part off by tyre grip. The handbrake slashes that grip, which is what produces powerslides.
- `src/systems/Collision.ts` — circle-vs-AABB push-out, circle-vs-circle overlap (for car-on-car), and nearest-point search.

**Render/runtime layer (imports `three`, browser-only):**
- `src/render/` — `Scene` (renderer, dusk lighting, ground/roads, fog), `Assets` (building/car/ped/streetlight mesh factories + material cache), `textures` (procedural facade + radial-glow canvas textures).
- `src/systems/` — `FollowCamera` (smoothed chase cam), `Vehicles` (ALL cars — player, AI traffic, parked-from-`city.parkingSpots` — with one shared physics + collision pass), `Pedestrians` (ambient walkers).
- `src/entities/Player.ts` — on-foot avatar controller.
- `src/ui/HUD.ts` — DOM overlay: speedometer, mode, controls, live minimap.
- `src/main.ts` — the orchestrator: builds the world, owns the driving↔on-foot state machine, the player health / WASTED / respawn cycle, runs the loop, applies collision, drives the camera, and manages the dynamic light pool + headlights.

### Conventions and invariants (read before editing sim code)

- **Coordinate frame (single source of truth):** world X = east, Z = south, Y = up. Heading `0` points along +X and increases counter-clockwise (toward −Z). Forward = `(cos h, 0, −sin h)`, right = `(sin h, 0, cos h)`. `VehicleModel`, `Vehicles`, `Player`, and `FollowCamera` all assume this — keep new systems consistent with it. A car mesh's `rotation.y` equals its heading directly.
- **One physics model for all cars:** the player's car, AI traffic, and parked/abandoned cars are the same `Car` struct in `Vehicles`. Only the player car is integrated by `stepVehicle`; AI cars follow lanes (with knock-and-recover), parked cars coast to rest. A single pass then resolves every car against buildings and against each other (momentum exchange). Don't add a separate code path for "the player car" — extend the shared one.
- **Determinism:** `City`, `Vehicles`, and `Pedestrians` are seeded via `createRng`. Same seed → same world. The `City` tests depend on this; don't introduce `Math.random()` into world generation.
- **Lighting budget:** the night look is mostly emissive (building windows, lamp heads) plus one shadow-casting directional light. Real dynamic lights are kept to a tiny pool — the streetlights are emissive meshes + additive ground "glow pools", and only ~6 pooled `PointLight`s hop to the streetlights nearest the player each frame; headlights are 2 non-shadow `SpotLight`s on the driven car. Don't add a real light per streetlight (81 of them) — extend the pooling in `main.ts`.
- **Pedestrian safety / WASTED:** AI cars brake for the on-foot player via `safeApproachSpeed(gap, decel)` with a capped deceleration rate, so they stop for you when there's room but can't when you dart in from inside the stopping distance. `Vehicles.pedestrianImpact` reports a car overlapping the player and its speed; `main` turns that into edge-triggered damage (per m/s of impact), and zero health → WASTED → timed respawn. Damage is on-foot only.
- **Fixed timestep:** `GameLoop` calls `update(dt)` at a constant 60 Hz and `render()` once per frame. Put simulation in `update`, presentation in `render`.
- **Collision model:** every moving actor is a ground-plane circle; the world is `city.colliders` (axis-aligned building footprints). Resolve with `resolveCircle`.
- **Building UVs (`Assets.scaleFacadeUvs`)** rely on Three's `BoxGeometry` face/group order: +X, −X, +Y, −Y, +Z, −Z. The roof/floor faces are intentionally collapsed to a dark texel.

### Testing rules specific to this repo

- Vitest runs in a **node environment** (`vite.config.ts` → `test.environment: 'node'`) and only includes `src/**/*.test.ts`. There is no DOM or WebGL in tests.
- **Never import a `three`-dependent module from a `*.test.ts`** — it will fail to load. New game logic that needs testing belongs in the pure core; keep rendering out of it.
- `tsconfig` has `noUnusedLocals` and `noUnusedParameters` on — the build fails on dead bindings.
