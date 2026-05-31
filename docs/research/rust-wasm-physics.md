# Rust/WASM: a Rapier physics hybrid + a portability plan for the core

**Question:** (1) Is a **hybrid physics** model worth it — keep the hand-rolled
arcade feel for the player car but let **Rapier** (rapier.rs, WASM) own rigid-body
debris / car-stacking / props — or argue against it? (2) Which pure-core systems
are the best **Rust→WASM** candidates *for raw performance now* (not multiplayer),
in what order, and how do we structure the core behind interfaces so it can be
backed by **either TS or Rust/WASM** (and later lifted to a server/another runtime)?
**Date:** 2026-05-31 · **Status:** 🔬 ready (extends perf-wasm-streaming.md R009;
feeds physics R0xx + a portability track). WASM still **deferred until measured**.

## TL;DR
- **Rapier hybrid: NO for now, but design for a YES later.** Adding Rapier today
  buys realism we don't want for the *player car* (the arcade `stepVehicle` feel is
  a deliberate design asset, see car-physics-profiles.md) and pays a real tax:
  a second physics world, a ~1–2 MB WASM payload, and a JS↔WASM step every frame.
  The honest win it *could* unlock — believable **debris/prop rigid bodies and
  car-on-car stacking** — is exactly the chatty-small-kernel quadrant where
  `wasm-bindgen` marshalling can make WASM **slower than JS** ([dev.to benchmark](https://dev.to/bence_rcz_fe471c168707c1/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-4pco):
  wasm-bindgen array test 1.623 ms vs pure JS 1.403 ms). Our debris is already a
  *pooled cosmetic* (`Debris.ts`), not gameplay. Revisit Rapier only when we want
  **interactive physics props** (stacked crates, knock-over objects, ragdolls) as a
  *feature*, and then run it as a **bounded secondary world** that never touches the
  authoritative player-car path.
- **Rust port: still premature as a blanket move, but there is a real near-term
  win** — and it is **NOT physics**. The biggest compute is **world/chunk
  generation + noise** (the streamed-world hot path, perf-wasm-streaming.md R007),
  which is *batch* work (run once per chunk, marshal once), the friendly quadrant
  for WASM. Everything per-frame and chatty (broadphase, integration of ~80 cars)
  stays in TS until a TS spatial grid + profiling say otherwise.
- **The durable deliverable is the abstraction, not the Rust.** Put each pure-core
  hot system behind a thin **TS interface with a TS reference impl**, so a Rust/WASM
  backend is a swap, the TS impl stays the test oracle, and the same seam later lifts
  to a server (multiplayer.md). Build the seam first; port behind it only where
  measured.

## Part 1 — Hybrid physics (arcade + Rapier)

### What Rapier is, and what it would actually give us
Rapier is a Rust 2D/3D rigid-body engine with official `wasm_bindgen` JS packages
(`@dimforge/rapier2d` / `rapier3d`), "5–8× faster than nphysics … close to PhysX,
slightly faster than Box2D" ([Dimforge announcement](https://www.dimforge.com/blog/2020/08/25/announcing-the-rapier-physics-engine/)).
It ships several builds with a clear size/perf/determinism tradeoff
([rapier.js README](https://github.com/dimforge/rapier.js/blob/master/README.md),
[npm](https://www.npmjs.com/package/@dimforge/rapier3d)):
- `rapier3d` — fast, locally deterministic, wide browser support; bundlers can choke
  on the separate `.wasm`.
- `rapier3d-compat` — same engine, `.wasm` base64-embedded in JS (bigger, but loads
  anywhere — easiest with our Vite/Pages setup).
- `rapier3d-simd` — `simd128` build, faster, narrower browser support.
- `rapier3d-deterministic` — slower, but **cross-platform** deterministic.

We are 3D, so `rapier3d`. Realistically `rapier3d-compat` for our build pipeline.

### Determinism — the part that interacts with our invariants
Our whole architecture rests on *same seed ⇒ same world*, fixed 60 Hz, no
`Math.random()` (CLAUDE.md; ecs-architecture.md). Rapier can hold that line, with
caveats:
- The JS/WASM build is **cross-platform deterministic** only via the
  `-deterministic` package, and only if **same initial conditions** hold: identical
  params, and **bodies/colliders added & removed in the exact same order**
  ([Rapier determinism docs](https://rapier.rs/docs/user_guides/javascript/determinism/)).
- **Sharp edge:** Rapier warns that `Math.sin`/`Math.cos` "are not cross-platform
  deterministic and may give different results on different platforms" — so any of
  *our* setup math feeding initial conditions must avoid transcendentals or it
  poisons Rapier's determinism ([ibid](https://rapier.rs/docs/user_guides/javascript/determinism/)).
- `enhanced-determinism` "cannot be enabled at the same time as the parallel or
  simd-{stable,nightly} features" — i.e. **deterministic XOR simd-fast**; you pick
  one ([same search trail; Rapier feature docs](https://rapier.rs/)).
- Rapier must be stepped at our **fixed dt** from `GameLoop.update`, never per
  render frame, and entity **add/remove order** must be deterministic (a problem for
  our pooled spawn/despawn — order would have to be seeded, not arrival-order).

Net: cross-platform determinism is *available* but costs the slow build and forbids
SIMD — fine for a few dozen cosmetic bodies, a poor trade for the per-frame hot path.

### Why NOT to put the player car in Rapier
`stepVehicle` (`src/vehicles/VehicleModel.ts`) is a pure `(state,input,cfg,dt)`
velocity-vector integrator whose lateral-grip bleed *is* the drift feel — a tuned,
unit-tested, **deterministic** design asset (car-physics-profiles.md). A Rapier
raycast-vehicle would replace authored arcade response with emergent rigid-body
behaviour we'd then fight to make feel arcade again. CLAUDE.md's invariant is "one
physics model for all cars" integrated by `stepVehicle`; handing the player car to
Rapier breaks that for no design win.

### The only honest case FOR Rapier: interactive physics props (a *feature*)
Rapier earns its weight if we want **gameplay** physics objects: stacks of crates
you scatter, barriers you knock over, bins, ragdolls, a tow-able trailer — things
whose value *is* emergent rigid-body motion. Today's `Debris.ts` (pooled cube gibs)
and `Smoke.ts` (sprites) are deliberately *cosmetic* and don't need it. So Rapier is
a **future feature dependency**, not a perf upgrade.

### If/when we add it: the hybrid contract (bounded secondary world)
Run Rapier as a **slave secondary world**, never authoritative over driving:
1. **Owner split.** Arcade `stepVehicle` + our circle/AABB resolver
   (`src/systems/Collision.ts`, `SpatialGrid`) stay authoritative for **all cars and
   actors**. Rapier owns **only** prop/debris dynamic bodies.
2. **One-way coupling, mostly.** Each fixed step: push car/building geometry into
   Rapier as **kinematic** bodies (their transforms come *from* us), step Rapier once
   at `dt`, read back **only prop** transforms to their `RenderMesh`. Cars feel props
   (a thrown crate is shoved aside, applies negligible reaction) without props
   destabilising the tuned car model.
3. **Budget + cull.** Cap active dynamic bodies (e.g. ≤ ~64), sleep/despawn by
   distance, tie body lifecycle to `ChunkOwned` (ecs-architecture.md) so chunk
   unload removes bodies — and do it in **seeded order** to keep Rapier's
   add/remove-order determinism.
4. **ECS fit.** A single `propPhysicsSystem` in the update stage owns the Rapier
   world as a **resource**; a `RapierBody` component links entity↔body handle. No
   other system imports Rapier — it stays a render/runtime-layer dependency, the sim
   core stays Three-free *and* Rapier-free.
5. **Tests.** Rapier is browser-only WASM ⇒ it **cannot** be imported from a
   node `*.test.ts` (same rule as `three`, CLAUDE.md). Prop physics is asserted in
   e2e (`scripts/interaction.mjs` via `window.__game`), never in Vitest.

**Cost ledger for the hybrid:** +~1–2 MB WASM (compat build, base64-inflated),
a second world stepped each frame, a per-frame readback of N prop transforms
(batched SoA, see Part 2), and the determinism discipline above. Worth it **only**
when interactive props are a committed feature — flag it, don't free-roll it.

## Part 2 — Rust→WASM abstraction of the core (perf-driven)

This **extends** perf-wasm-streaming.md (which already said: spatial grid in TS
first; WASM deferred R009; triggers = >300–500 colliding bodies or chunk-gen
hitching >4–6 ms; try a Web Worker before WASM; `wasm-pack`/`wasm-bindgen` +
`vite-plugin-wasm`). This section goes deeper on **which** systems, **why**, and the
**portability seam** — it does not re-argue the no-go.

### The boundary is the whole game
Primitives cross JS↔WASM free; **arrays/structs get copied** both ways, and
`wasm-bindgen`'s generated marshalling can dominate — to the point a small chatty
kernel is *slower* in WASM than JS (wasm-bindgen 1.623 ms vs pure JS 1.403 ms),
while **raw WASM over a shared buffer is ~4× and SIMD ~6× faster**
([dev.to benchmark](https://dev.to/bence_rcz_fe471c168707c1/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-4pco)).
The rustwasm Game-of-Life lesson is identical: keep state **in WASM linear memory**,
mutate in place, expose a **pointer**, and have JS read a typed-array **view** over
`memory.buffer` — "avoid copying … across the boundary on every tick"
([Rust+Wasm book](https://rustwasm.github.io/docs/book/game-of-life/implementing.html)).
Caveat: any Rust allocation **invalidates** a previously-taken `Float32Array` view,
so re-take the view after the buffer can grow ([wasm-bindgen guidance](https://rustwasm.github.io/docs/wasm-bindgen/),
[issue #3298](https://github.com/rustwasm/wasm-bindgen/issues/3298)).

**Design rule for any port:** cross the boundary **O(1) times per frame**, not O(n).
One call in (input/intent), one call to step, JS reads results via a view. Never a
call per entity. `SharedArrayBuffer` lets a Web Worker run the sim off the main
thread (needs COOP/COEP headers; check on GitHub Pages before relying on it).

### Candidate ranking by compute profile

| System (module) | Profile | WASM verdict | Why |
| --- | --- | --- | --- |
| **World/chunk gen + noise** (`src/world/streaming.ts`, `generateChunk`, `core/noise`) | **Batch**, heavy fbm/ridged/domainWarp per chunk, marshal **once** per load | **Best candidate** | Friendly quadrant: amortized boundary, embarrassingly numeric. [Noise→WASM is proven prior art](https://github.com/Markyparky56/WasmNoise); galaxy-gen dropped to <2 s ([wasm games](https://medium.com/hackernoon/games-build-on-webassembly-3679b3962a19)). Try a **Web Worker** in TS first (perf-wasm-streaming.md). |
| **A\* road-graph pathfinding** (planned `src/systems/pathfind.ts`, pathfinding.md) | **Batch**, bursty per agent/replan, marshal a path **once** | **Good (later)** | Self-contained, allocation-heavy in JS; [Rust→WASM A\* is well-trodden](https://github.com/jacobdeichert/wasm-astar). Only matters at many agents (R038/R039). |
| **Broadphase / spatial-hash neighbour queries** (`SpatialGrid.ts`, `WorldGrid.ts`) | **Chatty**, per-frame, ~80 cars ≈ µs today | **No until measured** | The chatty quadrant; a **TS grid is the real win** and already specced (R001). Port only past ~300–500 bodies *with hot data already resident in WASM*. |
| **Collision resolution over many actors** (`Collision.ts` resolve + impulse) | **Chatty**, per-frame, tied to broadphase | **No until measured** | Same quadrant; only pays if the *whole* car SoA already lives in WASM so it's one step call, not per-pair marshalling. |
| **Vehicle integration for many cars** (`stepVehicle` × N) | **Chatty**, per-frame; N small today | **No (and feel-sensitive)** | Tiny N; tuning churns here constantly — keep authored in TS. Port only as part of a full resident-state sim, far out. |

So the order is **gen/noise → (pathfinding) → broadphase/collision/integration as a
batch, together, only if profiling demands it** — never broadphase alone, because in
isolation it's the marshalling worst case.

### Portability / abstraction plan (the durable part)
Goal: the pure core sits behind **narrow interfaces with a TS reference impl**, so a
Rust/WASM backend is a drop-in swap, the TS impl is the test oracle, and the same
seam lifts to a server later (multiplayer.md). This is just the ecs-architecture.md
discipline (plain-data components, systems as functions, resources as singletons)
plus a backend selector.

1. **Define the seams (TS, no Rust).** One interface per hot system, data in/out as
   **flat `Float32Array`/`Int32Array` SoA** (already the shape WASM and the GPU
   want), not object graphs:
   - `WorldGen.generateChunk(seed, cx, cz, out: ChunkBuffers): void`
   - `Broadphase.query(positions, radii, out: PairList): void`
   - `Solver.resolve(positions, velocities, radii, colliders, dt): void`
   - `PathPlanner.find(start, goal, out: Path): number`
   Each takes/returns buffers, mutates in place, no per-entity calls. The current
   functions become the **TS reference impl** behind these.
2. **Make data SoA at the boundary, AoS-friendly inside.** Today's per-actor objects
   marshal terribly. Adopt typed-array component columns (the ECS store can expose
   columns) so "hand to backend" is "pass the column," TS or WASM.
3. **Backend registry + flag.** `?backend=ts|wasm` (mirrors `?touch=`) selects impl
   at startup; default `ts`. WASM init is **async** (`await init()` — Rapier/wasm-pack
   both load WASM asynchronously, [Rapier JS getting-started](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)),
   so the selector resolves before `GameLoop` starts.
4. **TS stays the oracle, forever.** Vitest tests target the **interface** with the
   TS impl (node, no WASM). A separate parity harness (e2e/bench, browser) asserts
   the WASM backend matches the TS impl bit-for-bit on the same seed — the only place
   the determinism tax (re-implementing `mulberry32` + noise in Rust to match,
   perf-wasm-streaming.md) gets *verified*. If they ever diverge, the WASM backend is
   wrong, not the test.
5. **Tooling.** `wasm-pack build --target web` → npm-shaped package → import in Vite
   via `vite-plugin-wasm` + `vite-plugin-top-level-await`
   ([wasm-pack](https://github.com/wasm-bindgen/wasm-pack);
   [wasm-bindgen guide](https://rustwasm.github.io/docs/wasm-bindgen/)). Start
   `wasm-bindgen` for ergonomics; if a profiled kernel is boundary-bound, drop to a
   **raw `extern "C"` export over a shared buffer** for that one kernel (the 4–6× tier
   above). Keep the Rust crate a sibling workspace; **never** commit the built `.wasm`
   logic into the sim-core import graph that Vitest loads.
6. **Server lift (free with the seam).** Because the interfaces take flat buffers and
   the TS impl is pure, the same `WorldGen`/`PathPlanner`/`Solver` can run
   server-authoritative (Node or a native Rust service sharing the crate) when
   multiplayer arrives — the abstraction is the bridge, not a rewrite.

### Recommended order (max near-term WebGL/JS/TS payoff)
0. **(already queued) TS spatial grid (R001)** — biggest perf win, no Rust, and it's
   the broadphase seam. Do this regardless.
1. **Carve the interfaces + SoA columns in TS, all backends = TS.** Pure refactor,
   tests stay green, zero WASM. *This is the high-value, low-risk step* — it makes
   everything after optional.
2. **Profile streamed chunk-gen** (R007). If gen hitches >4–6 ms, try a **Web Worker
   (TS)** first; only if still hot, port `WorldGen` to Rust/WASM behind its interface
   with a parity test. ← *first real Rust, if any.*
3. **Pathfinding to WASM** *only* when many-agent A\* (R038/R039) measures hot.
4. **Broadphase+collision+integration to WASM as one resident-state batch** *only*
   past ~300–500 colliding bodies with the grid already in place — never piecemeal.
5. **Rapier hybrid** *only* when interactive physics props become a committed feature
   — as the bounded secondary world in Part 1.

## Tradeoffs / honesty
- The cheap, certain win is **step 0 + step 1** (TS grid + interfaces). They deliver
  perf and portability with no WASM risk and no determinism tax. Everything labelled
  WASM is **measured-trigger gated** — consistent with perf-wasm-streaming.md, not a
  reversal of it.
- WASM reaching "60–90% of native … indistinguishable at 60 fps" is real for
  *resident-state* engines (Bevy in the browser,
  [bevy-cheatbook WASM](https://bevy-cheatbook.github.io/platforms/wasm.html),
  [dublog ECS-WASM](https://dublog.net/blog/rust-2/)) — but that's whole-engine-in-WASM,
  not a JS host calling a kernel per frame. Our value is the *seam*; a piecemeal
  per-frame WASM call without resident state can lose to JS.
- Rapier is a **feature** decision (do we want knock-over props/ragdolls?), not a
  perf decision. Don't adopt it to "speed up physics" — our physics isn't the
  bottleneck and the player car must stay arcade.

## Sources
- [Rapier — JS/WASM determinism (cross-platform, same-initial-conditions, sin/cos warning)](https://rapier.rs/docs/user_guides/javascript/determinism/)
- [Rapier — homepage / feature flags (enhanced-determinism XOR simd/parallel)](https://rapier.rs/)
- [Rapier — JS getting started (async WASM init)](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)
- [rapier.js README — package variants (-compat/-simd/-deterministic), wasm_bindgen, bundle notes](https://github.com/dimforge/rapier.js/blob/master/README.md)
- [@dimforge/rapier3d on npm](https://www.npmjs.com/package/@dimforge/rapier3d) · [@dimforge/rapier2d](https://www.npmjs.com/package/@dimforge/rapier2d) · [-deterministic](https://www.npmjs.com/package/@dimforge/rapier2d-deterministic)
- [Dimforge — Rapier announcement (5–8× nphysics, ≈PhysX, >Box2D)](https://www.dimforge.com/blog/2020/08/25/announcing-the-rapier-physics-engine/)
- [dev.to — JS vs wasm-bindgen vs raw WASM vs SIMD benchmark (boundary cost)](https://dev.to/bence_rcz_fe471c168707c1/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-4pco)
- [Rust + Wasm book — Game of Life: keep state in linear memory, view over memory.buffer](https://rustwasm.github.io/docs/book/game-of-life/implementing.html)
- [wasm-bindgen guide](https://rustwasm.github.io/docs/wasm-bindgen/) · [Float32Array::view invalidation (issue #3298)](https://github.com/rustwasm/wasm-bindgen/issues/3298)
- [wasm-pack — rust→wasm workflow tool](https://github.com/wasm-bindgen/wasm-pack)
- [WasmNoise — fast noise generation in WASM (prior art)](https://github.com/Markyparky56/WasmNoise)
- [wasm-astar — Rust→WASM A\* pathfinding (prior art)](https://github.com/jacobdeichert/wasm-astar)
- [Bevy Cheatbook — WASM target](https://bevy-cheatbook.github.io/platforms/wasm.html) · [dublog — ECS WebAssembly game with Bevy](https://dublog.net/blog/rust-2/)
- [HackerNoon — games built on WebAssembly (galaxy-gen <2 s)](https://medium.com/hackernoon/games-build-on-webassembly-3679b3962a19)
- In-repo: `perf-wasm-streaming.md`, `ecs-architecture.md`, `car-physics-profiles.md`, `pathfinding.md`, `multiplayer.md`, CLAUDE.md.
</content>
</invoke>
