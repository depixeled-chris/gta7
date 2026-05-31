# Generative world: streamed chunks, biomes, highways, rivers & bridges

**Question:** How do we grow the fixed 8×8 origin-centered city into a deterministic,
streamed open world with noise-driven biomes (city → suburb → rural), a highway
layer, rivers + bridges, and variety in buildings/streets/cars — without breaking
the pure-core / render-layer split, determinism, or 60 fps?
**Date:** 2026-05-30 · **Status:** 🔬 ready (epic foundation; supersedes the streaming half of [perf-wasm-streaming.md](perf-wasm-streaming.md))

## TL;DR
**Everything is a pure function of `(worldSeed, worldX, worldZ)`.** Build a small set
of **continuous global fields** (elevation, urbanity/biome, road lattice, highway
splines, river SDF) that any chunk samples at *absolute* world coordinates, plus a
per-chunk RNG seeded by `hash(worldSeed, cx, cz)` for discrete placement only. That
single rule makes cross-seam features (roads, rivers, biome edges) line up **for
free with no stitching pass**, and keeps generation deterministic and unit-testable
in the Three-free core. Performance: **GPU batching (merge + instance + LOD +
dispose) and a Web Worker for generation are the real wins — WASM is deferred**
behind measurable triggers (porting the seeded RNG/noise bit-exactly to Rust is a
determinism tax we don't pay until generation is provably heavy).

---

## 1. The determinism invariant (non-negotiable)

The maintainer requires deterministic world-gen. We make it structural, not a
best-effort:

- **Continuous features** (elevation, biome/urbanity, the road lattice, highway
  centrelines, the river channel) are pure functions evaluated at **absolute world
  coordinates** — never chunk-relative. Two chunks sampling the same world point get
  the same value, so a road/river/biome boundary that crosses a seam resolves
  identically on both sides. This is the same property that makes tiled Perlin
  terrain seamless.
- **Discrete per-chunk placement** (which building variant sits on a lot, spawn
  jitter, prop scatter) uses `mulberry32(hash(worldSeed, cx, cz))` — a fresh stream
  per chunk from a good integer mix (cyrb53/splitmix-style over
  `worldSeed ^ cx*0x9E3779B1 ^ cz*0x85EBCA77`). Adjacent chunks decorrelate; a chunk
  is identical regardless of which direction the player arrived from.
- **Never** seed from visit order, frame count, neighbor state, or `Math.random()`
  in generation. Features straddling a seam are owned by exactly one chunk (the one
  containing their origin/min-corner) and deduped by ownership, but rendered/collided
  past the seam.
- **Tested:** `generateChunk(cx,cz)` is pure and node-unit-tested — same coord ⇒
  identical output (deep-equal), different coord ⇒ different. The classifier and
  field helpers are pure functions with their own tests. This is also the core reason
  WASM is deferred (see §6): a Rust re-implementation would have to match
  `mulberry32` + noise bit-for-bit or worlds diverge between tests and runtime.

## 2. Noise & field core (`src/core/noise.ts`, pure)

- **Library:** `simplex-noise` v4 (dependency-free, ~2 KB, isotropic, ~20 ns/sample)
  seeded via `alea`. **One PRNG instance per field** (`:elev`, `:urban`, `:moist`,
  `:road`) — `createNoise2D` *consumes* the PRNG, so sharing one couples the fields.
- **Helpers (pure, tested):** `fbm` (4–6 octaves terrain / 2–3 density; lacunarity 2,
  gain 0.5, per-octave coord offset to decorrelate), `ridged` (mountains, optional),
  and **`domainWarp`** (Inigo Quilez single warp `value = fbm(p + 4·(fbm(p), fbm(p+k)))`)
  — the highest-leverage trick for making roads/coastlines/biome edges look organic
  instead of blobby.
- Keep noise in the **pure core** (Three-free, node-tested), consistent with the
  existing `rng.ts`. `mulberry32` stays for discrete per-chunk decisions.

## 3. Biomes & density — data, not conditionals

Two warped low-frequency fields → a **table-driven classifier**, the Whittaker /
Red Blob pattern:

- `urbanity` (warped fBm) drives the city-core → urban → suburb → rural gradient;
  `moisture`/secondary field adds variety; `elevation < seaLevel` ⇒ water.
- `classify(urbanity, moisture, elevation) → BiomeId` is a **pure function** (tested).
- All per-biome behaviour lives in one `BIOMES: Record<BiomeId, BiomeDef>` table
  (`buildingDensity`, `heightRange`, `lotSize`, `pedDensity`, `trafficDensity`,
  `palette`, road spacing/rotation). **No `if (biome === 'urbanCore')` scattered
  through generation** — that's the priority/fallback smell our own rules flag.
- Density is a continuous 0–1: `height = lerp(heightRange, density·roll)`, building
  frequency = `density` as a per-lot spawn probability. Cores tall+dense, rural
  sparse+low, **from one number**. Blend density across a transition band (or rely on
  domain-warped fields) so boundaries don't form visible "walls". Expect to retune
  thresholds — keep them in the table.

## 4. Roads, highways, rivers & bridges — "everything is a field"

Streamline-tracing (tensor fields, Parish-Müller) and agent/L-system growth look
best on paper but rely on **sequential global state** (priority queues, accept/reject
neighbour checks) that can't be reproduced per-chunk → seams won't align. Rejected.
The smallest design that looks good *and* survives no-stitch streaming:

- **Roads (grid, field-driven):** `isRoad(p) = nearLatticeLine(warp(p), spacing, width)`
  for arterial + local spacings on a domain-warped world-space lattice. Locals meet
  arterials on the shared lattice by construction. District noise modulates spacing /
  rotation (continuous, so it doesn't snap at seams). At chunk build, walk the chunk's
  lattice nodes → emit the existing lane structs, tagged by class.
- **Highways (hashed-anchor splines):** coarse region-cells each spawn 0–1 city-core
  anchor at `hash(cellId)`-jittered position, gated by `urbanity`. A chunk enumerates
  anchors in a neighbourhood window **sized by `MAX_HWY_LEN`** (not chunk size, or a
  highway dead-ends at a seam), connects nearby pairs by `hash(a,b)`, and routes a
  cheap noise-perturbed spline down a cost field (low slope, avoid cores, prefer
  valleys). `isHighway(p) = distToSpline(p) < halfWidth`. Lanes get
  `class:'highway'` + a higher `speedLimit`; on/off ramps where a highway runs near an
  arterial, placed at spline arc-length multiples (pure ⇒ seam-safe). Traffic's
  existing lane-follow reads the per-lane cap — nothing else changes.
- **Rivers (signed distance field, not flow sim):** flow/erosion sims are global &
  iterative (not chunk-local); plain `elev < seaLevel` gives uncontrollable-width
  coastlines, not rivers. Instead define a **channel centreline** as a warped iso-line
  and take signed distance: `isWater(p) = riverDist(p) < halfWidth(p)`, width a pure
  function of a downstream parameter. **Carve elevation toward the channel** so the
  river sits in a valley it dug (reads natural, zero simulation). Water suppresses the
  road lattice; the player resolves against a per-chunk water mask (drive-in = drag/
  death, GTA-style) — a single field eval, no raycast.
- **Bridges (a 2-line boolean):** `needsBridge(p) = isRoad(p) && riverDist(p) <
  halfWidth(p)+margin`. Both inputs are pure functions of world pos, so both sides of
  a seam agree with zero communication. Raise the lane Y on a smooth arc, suppress the
  water blocker under the deck, ramp the approaches; piers at arc-length multiples,
  deduped by owner-chunk. Sample the whole segment, not one point.
- **Reconciliation — one fixed precedence, no special-casing:**
  `elevation → river SDF (carves valleys, separates districts) → highway splines
  (anchored on cores, routed through rural gaps) → biome/district field → local road
  grid (suppressed in water) → bridges (the only roads over water)`.

## 5. Streaming / AOI

- **Chunk:** `generateChunk(cx, cz, worldSeed, config)` pure → `{ buildings,
  colliders, lanes, props, waterMask, biome }` in chunk-local space + world offset.
  Chunk edge ≈ **128–256 m** (a fast car crosses in ~2–4 s), aligned to whole road
  cells so the lattice tiles. **Step 0:** re-express today's city as
  `generateChunk(0,0)` and tile N×N all-loaded — nothing else changes yet.
- **AOI ring with hysteresis:** load at `loadRadius`, unload only past
  `unloadRadius = loadRadius + 1` chunk, so oscillating across a boundary doesn't
  thrash. View radius 3–5 chunks. Recompute the desired set only when the player
  crosses a chunk boundary.
- **Per-frame budget:** phased queues (`load → setup → build → unload`), N chunks/
  frame, nearest-first, inside the fixed-60 Hz `update(dt)` — never block a frame.
- **Pooling:** extend the existing `Debris`/`Smoke`/`PointLight`/police pools to
  chunk `Group`s, geometry scratch buffers, and per-variant building/car/ped meshes.
- **Floating origin:** **defer** (a few-km world stays inside f32-safe range). Design
  authoritative positions as f64-in-core now so adding camera-relative rebasing later
  is a render-layer-only change.
- **Per-chunk traffic/peds:** spawn/despawn per loaded chunk; **drop the wrap-around**
  teleport.

## 6. Performance & the WASM verdict

The bottleneck at "thousands of buildings + ~80 cars" is the **GPU draw-call /
triangle path, not CPU sim**. Order of work, with measurable triggers:

1. **GPU batching + lifecycle (do first, pure TS).** Per-chunk **merged geometry**
   (`BufferGeometryUtils.mergeGeometries`) for *varied* buildings (bake transform +
   tint into vertex attributes; one shared facade-atlas material → a few draw calls
   per chunk); **`InstancedMesh`** per identical prop type per chunk (streetlights,
   trees, parked-car shells); **per-chunk `THREE.LOD`** (full → box-only → billboard
   imposter); **strict `dispose()` on unload** of chunk-owned geometry/material/
   texture only (never the shared atlas). Caveats: `InstancedMesh` is *not*
   per-instance frustum-culled (keep counts modest or use InstancedMesh2); instancing
   isn't always a win vs merging for static varied geometry — measure with
   `renderer.info`. Budgets: desktop ≤ ~1000–1500 draw calls / 3–5 M tris; mobile
   ≤ ~200–400 draw calls / 0.5–1 M tris. Keep the current light pool (≤6 PointLights
   + 1 dir + 2 headlight spots).
2. **Web Worker chunk generation (next, pure TS).** Build vertex/index/matrix data
   into `ArrayBuffer`s and `postMessage(…, [buffers])` (transfer, zero-copy); shared
   RNG/noise modules imported by both main and worker ⇒ **zero determinism tax**.
   **Trigger:** measured main-thread chunk gen ≥ ~4–8 ms (visible hitch).
3. **Rust → WASM (last, conditional, inside the Worker).** Only batch noise/mesh
   generation (one call in, one big `Float32Array` out — never per-frame kernels like
   `stepVehicle`/`resolveCircle`). **Trigger:** post-Worker per-chunk gen still
   ≥ ~15–20 ms *and* it's a bulk array workload *and* we've budgeted to re-implement
   `mulberry32` + noise bit-exactly. We're currently orders of magnitude below this.
   (Collision broadphase WASM only pays off at thousands of dynamic bodies — not our
   ~80 cars on an already-near-optimal spatial grid.)

## 7. What in the current code assumes a fixed, finite, origin-centered city

Inventory to undo (from a read-only sweep), grouped:

- **Extent-tied rendering** — fog `city.extent*0.18/0.7` (`Scene.ts:35`), camera far
  `city.extent*1.5` (`Scene.ts:41`), ground plane `extent*2` (`Scene.ts:76`), road
  meshes from `roadCenters` (`Scene.ts:86-103`), shadow-cam ortho bounds = `±city.half`
  + light pos scaled to city (`Scene.ts:60,64-69`). → follow the player / per-chunk.
- **Bounds & spawn** — `city.extent`/`half` (`City.ts:44-45,73-74`); clamp-to-bounds on
  player (`main.ts:162-165`), cars (`Vehicles.ts:213-215`), peds
  (`Pedestrians.ts:158-159,187-188`); single `city.center` spawn/respawn.
- **Wrap-around traffic** — AI cars teleport at `±half` (`Vehicles.ts:246-250`); lanes
  skip outer roads (`City.ts:172-174`). → per-chunk spawn/despawn.
- **Up-front generation** — `generateCity()` builds all buildings/colliders/lanes/
  streetlights/parking once (`City.ts:69-116`); one `SpatialGrid` over all colliders
  (`City.ts:110`); everything added to the scene in one pass (`main.ts:41-42`);
  streetlight pool sorts all lights (`main.ts:59`). → `generateChunk` + per-chunk grid.
- **Minimap** — fixed `MAP_SIZE/extent` scaling + baked static map over all roads/
  buildings (`HUD.ts:5,27,133-165`). → scrolling, chunk-aware.
- **Police spawn** — `POLICE_SPAWN_DIST` + clamp `city.half-4` (`Vehicles.ts:412-414`).
- **RNG order** — generation consumes the `mulberry32` stream in nested `(i,j)` loop
  order (`City.ts:82-91`); chunking must regenerate from a **chunk-local** hashed seed
  rather than a single global stream (this is the determinism refactor, not a bug).
- **Collision** — colliders are a frozen global array queried via `city.grid`
  (`SpatialGrid.ts`); no dynamic insertion. → per-chunk grids (or a chunked grid).
- **Keep stable:** the `window.__game` debug handle (e2e depends on it) — extend, keep
  `mode/health/carHealth/wasted/busted/runOverCount/wanted/police/vehicles/player/
  peds/city` working; `city` will need a streamed-world shape.

## 8. Phased plan (each phase shippable, test-backed, determinism-preserving)

Recommended order — invisible foundation first, then visible payoff, then scale:

- **P1 — Field core** (`src/core/noise.ts` + `biome` classifier, pure + unit tests).
  No visible change; everything else builds on it.
- **P2 — `generateChunk` refactor** — `generateCity` becomes a tiling of pure
  `generateChunk(cx,cz)` with a hashed per-chunk seed; today's city re-expressed as an
  N×N tiling, still all loaded. Determinism tests. Decouple rendering from `extent`
  (shadow/fog/ground/far follow the player).
- **P3 — AOI streaming** — load/unload ring + hysteresis + per-frame budget + pooling;
  per-chunk colliders/lanes/props; scrolling minimap; per-chunk traffic/peds (drop
  wrap); per-chunk spatial grid. The big architectural lift.
- **P4 — Biome variety** — plug the `BIOMES` table into chunk gen (core→suburb→rural
  density/height/palette); varied building footprints (L-shapes, podium+tower) +
  street props (trees, hydrants, signage) + **car variety** (ties into R003 profiles).
  The first big visual payoff. *(A subset — footprint/prop/car variety on the current
  single city — can land as a quick "P0" before streaming if a fast visible win is
  wanted.)*
- **P5 — Roads & highways** — field-driven warped road grid + hashed-anchor highway
  splines + `highway` lane class (faster traffic, limited access + ramps).
- **P6 — Rivers & bridges** — river SDF + elevation carve + water collision/render +
  bridge boolean.
- **P7 — Perf hardening** — per-chunk merged geometry + InstancedMesh + LOD + dispose;
  measure budgets; Worker offload if gen hitches; WASM only if §6 triggers are met.

## Sources
Per-track research is captured in the agent runs that produced this doc; primary
external sources:
- Red Blob Games — terrain/biomes from noise (fBm, redistribution, biome table, pitfalls)
- simplex-noise.js v4 (API + alea seeding + per-call PRNG gotcha); Inigo Quilez — domain warping; The Book of Shaders — fBm
- Let's Make a Voxel Engine — phased per-frame chunk load/build/unload queues; Babylon.js & three.js forum — floating origin
- Parish & Müller *Procedural Modeling of Cities* (SIGGRAPH 2001) and Chen et al. *Interactive Procedural Street Modeling* (tensor fields) — why streamline/agent road gen is **not** chunk-local
- Nick McDonald *Procedural Hydrology* — why flow-sim rivers aren't chunk-local; GameDev.net — absolute-world-coord seamless chunks
- three.js manual — *How to dispose of objects* / `BufferGeometry.dispose`; three.js forum — `InstancedMesh` per-instance culling; `@three.ez/instanced-mesh`
- wasm-bindgen guide; `vite-plugin-wasm` (+ top-level-await); Float32Array-over-`memory.buffer` invalidation caveat; 2025 JS↔WASM interop benchmarks (marshalling dominates small/chatty kernels)
