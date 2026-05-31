# ECS architecture: target design + migration plan

**Question:** Move the game to a full ECS (Bevy-style entities/components/systems)
for clean separation of concerns as it grows (streaming world, many vehicle
types, day/night, more actors). What's the target shape, and how do we migrate a
*working* game without breaking it?
**Date:** 2026-05-31 · **Status:** 🔬 design approved (full ECS) — migrate incrementally

## Why
The game already has a good bone: a **pure, Three-free, unit-tested sim core** vs a
render/runtime layer. But behaviour is accreting into a few big classes —
`Vehicles` alone owns physics, car-car collision, building collision, police AI,
damage, smoke, debris, interpolation and rendering. As we add streaming, named
vehicle profiles, day/night, actor-vehicle collision and more pedestrians, those
classes become god-objects. An ECS makes each concern a small **system** over
**component data**, so features compose instead of pile into one update method.

## Non-negotiables carried over
- **Three-free sim core stays.** Components are plain data. A `RenderMesh`
  component holds the `THREE.Object3D`; only *render systems* touch it. Logic
  systems (physics, AI, collision, damage) never import `three`, so they stay
  node-unit-testable — the same line `vite.config.ts` already enforces.
- **Determinism.** Systems run in a fixed registered order; the sim stage is the
  only place state mutates; no `Math.random()` in sim systems (seeded RNG resource
  instead). Same-seed-same-world invariant is preserved and tested.
- **Fixed timestep + interpolation.** The scheduler keeps the current split:
  `update(dt)` systems at 60 Hz, `render(alpha)` systems once per frame reading
  `prev`/`curr` transforms. `GameLoop` stays; it just ticks the scheduler.

## Target shape (minimal, TS-friendly ECS)
Not a heavyweight framework — a small archetype-free store that fits ~hundreds of
entities (we are nowhere near needing SoA/archetype perf):

- **`World`** — owns entities and components, plus **resources** (singletons:
  input intent, wanted state, camera, time, the streamed map, the THREE scene).
- **Entity** — an opaque integer id from a free-list allocator.
- **Component store** — one `Map<EntityId, T>` per component type (`defineComponent`
  returns a typed handle). Add/get/remove/has; `query(A, B, …)` iterates entities
  that have all listed components. AoS via maps: simplest, fast enough, GC-friendly
  if we reuse query buffers.
- **System** — `(world, dt) => void`, registered into an ordered **stage**
  (`startup` | `update` | `render`). The scheduler runs stages in order; within a
  stage, systems run in registration order (explicit, deterministic).
- **Resources** — `world.setResource(key, value)` / `getResource`. Singletons that
  aren't per-entity (Controls intent, Sfx, Radio, FollowCamera, the chunk manager,
  `timeOfDay`).

## Component & system inventory (current code → ECS)
**Components (data):**
`Transform {x,z,heading, px,pz,ph}` (carries prev pose for interpolation) ·
`Velocity {vx,vz}` · `Vehicle {role, profileId, health, color, shapeId}` ·
`Lane {axis,fixed,dir,cruise}` · `PlayerControlled` (tag) · `Police {…}` ·
`Pedestrian {state,timer,scared,…}` · `Smoking {intensity}` ·
`Avatar` (on-foot) · `RenderMesh {group, steerWheels?, lightMat?}` (render-only) ·
`Health`/`Damageable` · `ChunkOwned {key}` (for streamed despawn).

**Systems (update stage, in order):**
`inputSystem` (Controls→intent resource) · `vehicleControlSystem` (player
`stepVehicle`) · `aiDriveSystem` · `policeDriveSystem` · `coastSystem` ·
`buildingCollisionSystem` (vs `WorldGrid`) · `carCarCollisionSystem` ·
`actorVehicleCollisionSystem` (R028) · `damageSystem` (→ wreck events) ·
`pedFearSystem` · `pedStateSystem` · `smokeEmitSystem` · `debrisSystem` ·
`wantedSystem` · `bustedSystem` · `chunkStreamSystem` (P3) · `dayNightSystem` (R029).

**Systems (render stage):** `interpolateTransforms` (writes `RenderMesh` from
`Transform` lerp) · `cameraSystem` · `headlightSystem` · `streetlightPoolSystem` ·
`hudSystem` · `audioSystem`.

Events (wrecks, gibs, kills) are a small per-frame queue resource drained by
listeners (sfx, score, debris) — replaces the current ad-hoc `consumeExplosions`.

## How the queued work maps on
- **P3 streaming:** `chunkStreamSystem` loads/unloads chunks around the player,
  spawning/despawning entities tagged `ChunkOwned`; colliders go to `WorldGrid`.
- **Named car profiles (R026):** `Vehicle.profileId` indexes a hand-tuned
  `CarProfile` table (mass, engine, grip, model/manufacturer); physics/AI read it.
- **Actor-vehicle collision (R028):** one `actorVehicleCollisionSystem` resolving
  avatar/ped circles vs car circles — its own system, not buried in Vehicles.
- **Day/night (R029):** `dayNightSystem` advances a `timeOfDay` resource; render
  systems read it for sun angle/colour/fog/emissive blend.

## Migration plan (incremental, behaviour-preserving, test-gated)
Strangler pattern — the ECS `World` lives as a resource **alongside** today's
classes; migrate one system at a time, keeping `npm test` + e2e green and
deploying after each step. Order chosen leaf-first (lowest risk) → core:

1. **ECS core** (`src/ecs/`) — World, components, scheduler, queries. Pure + unit
   tests. *Additive; game unchanged.* ← (this session)
2. **Debris + Smoke** — pooled, self-contained, render-coupled but simple. Prove
   the RenderMesh pattern and the update/render split end-to-end. e2e (smoke
   particles, gib bursts) must stay green. ← (proof slice)
3. **Pedestrians** — entities with `Pedestrian`+`Transform`+`RenderMesh`; fear,
   state, gib, punch become systems. e2e (run-over, punch, fear) gates it.
4. **Vehicles** — the big one, migrated last and in sub-steps (transform/velocity
   first, then collision systems, then police, then damage/smoke). The shared
   single-collision-pass invariant becomes explicit collision systems.
5. **Orchestration** — fold `main.ts` state (mode, health, wanted, busted) into
   resources + systems; `window.__game` becomes a thin read-through over the World
   so the e2e keeps working unchanged.

Each step is a commit + deploy + live e2e. If a step can't stay green, it doesn't
merge.

## Tradeoffs / honesty
- A TS ECS over `Map`s is not Bevy's archetype performance — but at hundreds of
  entities the bottleneck is the GPU, not component iteration (see
  perf-wasm-streaming.md). Don't gold-plate the store.
- The migration is the cost: a working game gets rewired. The strangler/leaf-first
  order keeps it shippable throughout, which is the whole point of doing it
  *before* the streaming rewrite rather than after.

## Sources
Bevy ECS book (entities/components/systems/resources/schedules); Sander Mertens
*Building an ECS* (storage tradeoffs, AoS vs SoA); "ECS back and forth" (Skypjack)
on when ECS pays off; prior in-repo split (CLAUDE.md, generative-world.md).
