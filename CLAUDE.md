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
npm run smoke               # build + headless-Chromium runtime check (see below)
npm run preview             # serve the built dist/
```

Run a single test file or case:

```bash
npx vitest run src/vehicles/VehicleModel.test.ts
npx vitest run -t "caps speed at maxSpeed"
```

The smoke test (`scripts/smoke.mjs`) requires Chromium once: `npx playwright install chromium`. It self-hosts the built app, loads it in headless Chromium, fails on any console/page error, and decodes a screenshot to assert the scene actually rasterized (color diversity + lit-pixel fraction) rather than rendering a blank canvas.

## Architecture

The codebase is split along one hard line: **the simulation core is pure and Three.js-free; the rendering/runtime layer owns everything that imports `three`.** This is what makes the gameplay logic unit-testable in a node environment.

**Pure core (no `three`, unit-tested):**
- `src/core/` — `math` (clamp/lerp/frame-rate-independent `damp`/`angleDelta`), `rng` (seeded mulberry32), `Input` (keyboard with edge detection), `GameLoop` (fixed-timestep accumulator).
- `src/world/City.ts` — deterministic procedural city generation from a seed: buildings, AABB colliders, traffic lanes, spawn point.
- `src/vehicles/VehicleModel.ts` — pure arcade vehicle dynamics (`stepVehicle` is a pure function: state + input → state).
- `src/systems/Collision.ts` — circle-vs-AABB push-out resolution.

**Render/runtime layer (imports `three`, browser-only):**
- `src/render/` — `Scene` (renderer, dusk lighting, ground/roads, fog), `Assets` (building/car/ped mesh factories + material cache), `textures` (procedural canvas facade texture).
- `src/systems/` — `FollowCamera` (smoothed chase cam), `Traffic` and `Pedestrians` (ambient actors).
- `src/entities/Player.ts` — on-foot avatar controller.
- `src/ui/HUD.ts` — DOM overlay: speedometer, mode, controls, live minimap.
- `src/main.ts` — the orchestrator: builds the world, owns the driving↔on-foot state machine, runs the loop, applies collision, drives the camera.

### Conventions and invariants (read before editing sim code)

- **Coordinate frame (single source of truth):** world X = east, Z = south, Y = up. Heading `0` points along +X and increases counter-clockwise (toward −Z). Forward vector is always `(cos h, 0, −sin h)`. `VehicleModel`, `Traffic`, `Player`, and `FollowCamera` all assume this — keep new systems consistent with it.
- **Determinism:** `City`, `Traffic`, and `Pedestrians` are seeded via `createRng`. Same seed → same world. The `City` tests depend on this; don't introduce `Math.random()` into world generation.
- **Fixed timestep:** `GameLoop` calls `update(dt)` at a constant 60 Hz and `render()` once per frame. Put simulation in `update`, presentation in `render`.
- **Collision model:** every moving actor is a ground-plane circle; the world is `city.colliders` (axis-aligned building footprints). Resolve with `resolveCircle`.
- **Building UVs (`Assets.scaleFacadeUvs`)** rely on Three's `BoxGeometry` face/group order: +X, −X, +Y, −Y, +Z, −Z. The roof/floor faces are intentionally collapsed to a dark texel.

### Testing rules specific to this repo

- Vitest runs in a **node environment** (`vite.config.ts` → `test.environment: 'node'`) and only includes `src/**/*.test.ts`. There is no DOM or WebGL in tests.
- **Never import a `three`-dependent module from a `*.test.ts`** — it will fail to load. New game logic that needs testing belongs in the pure core; keep rendering out of it.
- `tsconfig` has `noUnusedLocals` and `noUnusedParameters` on — the build fails on dead bindings.
