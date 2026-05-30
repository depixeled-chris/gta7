# Performance: Rust/WASM, spatial grid, streaming world

**Question:** Would Rust→WASM help at this scale, and how do we grow the single
static city into a larger streamed world?
**Date:** 2026-05-30 · **Status:** 🔬 ready (ROADMAP R001 / R007); WASM deferred (R009)

## TL;DR
**Rust/WASM: NO-GO now** — premature. The hot loops are microseconds at ~80
cars; per-frame JS↔WASM marshalling would cost more than it saves. Do a **uniform
spatial grid** (TypeScript) first — it's the bigger win *and* the foundation for
streaming. Streaming step 0 is a pure deterministic `generateChunk(cx,cz)`.

## Rust / WASM
- Broadphase (O(n²) circle pairs at 80 cars ≈ 3160 pairs) is ~tens of µs — not
  worth a language change. Marshalling ~80 entities of floats per step, plus the
  required AoS→SoA refactor and keeping `THREE.Group` updates in JS regardless,
  puts this in WASM's worst-case quadrant (small, chatty kernel).
- **Triggers to revisit (measured, not guessed):** >300–500 colliding bodies with
  a TS grid already in place; or runtime per-chunk gen hitching (>4–6 ms) — and
  try a **Web Worker** before WASM. Determinism tax: re-implementing the seeded
  `mulberry32` RNG bit-for-bit in Rust if gen ever moves there.
- Toolchain when the day comes: `wasm-pack`/`wasm-bindgen` with raw `Float32Array`
  views over `memory.buffer`; Vite via `vite-plugin-wasm` + `vite-plugin-top-level-await`.

## Spatial grid (do this first — R001)
`resolveCircle` scans *every* collider for *every* car each step (and the police
feeler does another full scan). It scales as `cars × colliders` and colliders
grow with city size. A uniform grid keyed on the existing `cell` size makes it
near-O(n). Same structure streaming needs — build it once, two payoffs.

## Streaming world (R007)
Generation is already pure + seeded, so we're well-placed. The coupling to undo:
`city.half` / wrap-around / clamp assumptions in `Vehicles` (traffic wrap, player
clamp), `Pedestrians`, the HUD minimap, and `Scene` (city-sized shadow camera, roads).

**Step 0 (smallest real step):** refactor `generateCity` → pure
`generateChunk(cx, cz, config)` with a per-chunk derived seed `hash(seed,cx,cz)`,
in chunk-local space translated by `(cx*size, cz*size)`. Re-express today's city
as an N×N tiling, still all loaded. Keep `generateCity = generateChunk(0,0)` so
nothing else breaks; add a determinism test (same coord ⇒ identical; different ⇒ different).

**Then:** load/unload ring around the player (with hysteresis); mesh/entity pooling
(generalize the existing police off-map pool pattern; `InstancedMesh` for buildings);
per-chunk spawn/despawn for traffic & peds (drop the wrap); query the spatial grid
over loaded chunks for collision.

**Gotchas:** seam alignment (align chunk size to whole road `cell`s; buildings stay
chunk-local), per-chunk determinism (a chunk's RNG must not depend on neighbors),
collider membership across borders (the global grid avoids per-chunk lists),
follow-the-player shadow camera, scrolling minimap, and floating-origin rebase
*only* if we ever go truly infinite.

## Sources
SimonDev chunked/quadtree world pattern; Three.js `InstancedMesh` + dispose
guidance; Vite WASM plugins; floating-origin technique.
