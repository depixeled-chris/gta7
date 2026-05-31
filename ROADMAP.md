# GTA 7 — Roadmap & Request Queue

This project is community-driven: requests stream in (mostly from the [Reddit
thread](https://www.reddit.com/r/ClaudeAI/comments/1tqz2se/lets_check_opus_48_how_good_is_it/),
relayed by the maintainer). To keep that from derailing the build, every
request lands **here** first, gets triaged, then implemented in a managed order.

---

## How this file is maintained (the repeatable pattern)

**One item = one line:** `[R###] <status> Title — @requester · short note`

- **IDs** are `R###`, assigned in arrival order, **never reused or renumbered**. They're stable handles you can reference in commits ("implements R012").
- **Status** is exactly one emoji: 🔵 queued · 🟡 in progress · 🔬 researched (ready) · ✅ shipped · ⏸ deferred/declined.
- Items **move between sections**; their text isn't rewritten (just the status emoji + section). History stays legible.

**The cycle (do this every working turn):**
1. **Intake** — append each new request to _Queued_ with the next ID + requester. Don't start it yet.
2. **Triage** — reorder so the highest value sits at the top of _Next up_. Research-gated items go 🔬 and wait for findings.
3. **Start** — flip the chosen item to 🟡 and move it under _In progress_ (keep ≤2 there).
4. **Ship** — only when tests are green **and** it's deployed: flip to ✅, move to _Shipped_, append `(YYYY-MM-DD)`. Commit `ROADMAP.md` in the same commit as the change.
5. **Decline/defer** — ⏸ with a one-line reason under _Deferred_.

Keep _Shipped_ compact (one line per item; collapse old detail). When in doubt, the file's order top-to-bottom is the plan.

**Research** lives in [`docs/research/`](docs/research/) (see its index). Before investigating anything, check there first; reference the doc from the item (e.g. "see research/car-physics-profiles.md"). Don't start a parallel investigation — update the existing doc.

---

## 🟡 In progress / next up (top = do first)
- [R003] ➡️ Superseded by **R026** — car profiles now want hand-tuned named makes/models, not generic categories.
- [R004] 🔵 Proper car-car collision / no clipping — @maintainer · cars pass through each other at intersections; AI yielding (grid + damage now in place)

## 🟢 World-gen epic (🔬 RESEARCHED — foundation ready)
Full foundation + phased plan in [`docs/research/generative-world.md`](docs/research/generative-world.md).
Core principle: **everything is a pure function of `(worldSeed, worldX, worldZ)`** —
continuous global fields for cross-seam features + a per-chunk hashed RNG for discrete
placement → deterministic, seam-continuous, unit-testable. Perf order: GPU batching →
Web Worker gen → WASM (deferred behind measurable triggers; determinism tax is why).
Phases (each shippable, test-backed; top = do first):
- [R015] ✅ P1 — Field core: pure `src/core/noise.ts` (simplex + fbm/ridged/warp + `hashSeed`) + `world/biome.ts` classifier/table + determinism tests (2026-05-30)
- [R016] ✅ P2 — `generateChunk(cx,cz)` refactor — finite city is now a tiling of independently-seeded chunks; determinism tests (2026-05-30). *(Rendering-follows-player decouple folded into P3, where streaming actually exercises it.)*
- [R007] 🔬 P3 — AOI streaming: load/unload ring + hysteresis + per-frame budget + pooling; per-chunk traffic/peds/colliders/minimap (drop wrap-around); shadow/fog/ground follow the player (the deferred P2 rendering decouple)
- [R005] 🟡 P4 — Biome variety: ✅ biome density/height/palette, ✅ car body shapes (sedan/compact/sports/van/pickup), ✅ facade styles (glass/brick/concrete per biome); ⏳ street props + varied footprints next
- [R017] 🔬 P5 — Roads & highways: field-driven warped grid + hashed-anchor highway splines + `highway` lane class
- [R018] 🔬 P6 — Rivers & bridges: river SDF + elevation carve + water collision + bridge boolean
- [R009] 🔬 P7 — Perf hardening: merged geometry + InstancedMesh + LOD + dispose; Worker offload if gen hitches; WASM only if triggers met

## 🔵 Queued (triaged, not started)
*(R005 & R007 now live in the World-gen epic above.)*
- [R036] ✅ **Gamepad support** (2026-05-31) — researched ([gamepad-support.md](docs/research/gamepad-support.md)) then built: standard-mapping, radial deadzone, pure tested `readGamepadIntent` + thin polling glue, merged into `Controls` (left stick + RT/LT throttle, B handbrake, L3 sprint, A enter, X punch, Y reset, LB/RB radio). 9 unit tests; e2e confirms keyboard/touch unaffected.
- [R035] 🔵 Rural gaps between cities — @maintainer · tune the streaming **urbanity field** low-frequency so most of the world is rural/empty with sparse dense city clusters and **long inter-city stretches** (room for chases, ambushes, getting waylaid). Pairs with highways (P5) connecting cores across the gaps.
- [R024] 🔵 Better prop geometry — @maintainer · trees = trunk + foliage, hydrants = body+cap+nozzles, benches = seat+back+legs; keep them merged so still one InstancedMesh per type. *(separate task; current cone/box props are too primitive)*
- [R025] 🔵 Building texture/colour variety — @maintainer · keep the procedural facade gen but add per-building hue/colour variation so blocks read as more varied
- [R026] 🔵 Named car makes/models + tuned profiles — @maintainer · NOT procedural; hand-tuned `CarProfile`s with GTA-style manufacturer+model names, categories (sports / general / trucks / city). Supersedes R003. Discussable by name.
- [R027] 🔵 Non-grid street layout — @maintainer · streets are still a pure grid; want warped/curved roads, varied block sizes, arterials/diagonals (ties P5 road research)
- [R028] 🔵 Actors collide with vehicles — @maintainer · the on-foot player and pedestrians clip through parked/other cars; resolve actors against nearby car circles, not just buildings
- [R029] 🔵 Day/night cycle — @maintainer · animate sun/moon + lighting/fog over time; emissive night look is the current fixed state
- [R033] 🔵 Three game modes — @maintainer · (1) **Explore** (free-roam puttering — basically today's sandbox), (2) **Delivery** (A→B jobs; needs world + waypoints/nav + minimap routing), (3) **Racing** (checkpoint circuits on the road network). All ride on the streamed world; intertwined with factions/turf (R032).
- [R034] 🔵 Weapons — @maintainer · **pedestrians** carry handheld firearms; **vehicles** have **mounted** weapons (Interstate '76-style vehicular combat), NOT GTA drive-by — only outfitted vehicles are armed, the weapon belongs to the car. Ties into factions (enforcers shoot you) + wanted. Needs a projectile/damage system on the ECS; armed-vehicle as a component/loadout.
- [R006] 🔵 In-game options menu — @maintainer · volume sliders (radio vs SFX), maybe quality toggle
- [R031] 🔵 Branding: **GTA 7 — Guns, Traffic & Anarchy** (name LOCKED). Title screen + README + manifest/`<title>` rename.
- [R032] 🔵 **7 factions = the 7 colours (ROYGBIV) + turf-war/reputation** — @maintainer · **colour-based** factions, not shape-based (only a few primary shapes exist; 7 rainbow colours map cleanly to the "7" and read instantly — cheerful rainbow gangs, extra-ironic under the wholesome veneer). Each controls one of the 7 districts; collectible per faction (card-suit/Diablo-gem "collect all 7"). Shape gag kept as flavour (e.g. an elite/rare unit — "the dodecahedrons"). **Reputation system:** per-faction rep shifts *generatively* from where you spend time / what you do in whose turf; favouring one faction raises its rep and lowers its rivals' (relationship matrix), so high rep = friendly/safe in their district, low rep = hostile enforcers. Emergent "home turf." A **tolerance web** sets how much each faction aggros based on your standing with *it and with its rivals/allies*; the web is tuned so **universal good standing is impossible (at least not permanently)** — courting one faction sours its enemies, forcing turf tradeoffs. **Depends on:** the streamed world + the 7 districts existing first (P3 streaming → districts → then factions/rep).
- [R030] 🟡 Architecture → **full ECS** (decided) — @maintainer · ✅ design doc ([ecs-architecture.md](docs/research/ecs-architecture.md)) · ✅ ECS core (`src/ecs/World.ts`, 8 tests) · ✅ **Debris**, ✅ **Pedestrians**, ✅ **Vehicles** all migrated onto the ECS in-engine (behaviour-preserving, deployed, e2e-green). ⏳ remaining = the **orchestration** step: unify the per-system internal Worlds into one shared World, fold `main`'s state (mode/health/wanted/busted/radio) into resources+systems, make `window.__game` a read-through. **Stopped before orchestration deliberately** — it reworks `main`'s update ordering and the debug-handle coupling the e2e leans on; best done with eyes on it rather than gambled blind. Then P3 streaming builds on the unified world.

## 🔬 Researched — ready to implement
Full write-ups in [`docs/research/`](docs/research/).
- **R003 — Car physics profiles** → [research/car-physics-profiles.md](docs/research/car-physics-profiles.md). Plumb `CarProfile` + per-car `profile`, then add `mass` / `radius` / `highSpeedSteerMul`; grip circle optional.
- **R001 — Spatial grid** & **R007 — Streaming** → [research/perf-wasm-streaming.md](docs/research/perf-wasm-streaming.md). Grid first (near-O(n) collision, foundation for streaming); streaming step 0 = pure `generateChunk(cx,cz)`.
- **R009 — Rust/WASM**: NO-GO now (premature) — same doc has the revisit triggers.

## 🔵 Future (researched / informing current work)
- [R037] 🔬 Real-time multiplayer — @maintainer · authoritative server running the deterministic ECS headless; client prediction + reconciliation; chunk = AOI = shard unit; sharding + **Redis pub/sub** + **WebSockets**. See [multiplayer.md](docs/research/multiplayer.md). Not built now — it sets *constraints* on current work (keep sim authoritative/deterministic/serializable, drive from intents, chunk-as-shard).

## ⏸ Deferred / declined
- [R009] ⏸ Rust → WASM — premature. Revisit when >300–500 colliding bodies on a TS grid, or runtime chunk-gen hitches (>4–6 ms); try a Web Worker before WASM.
- ⏸ Sex-worker mechanic (community) — declined (sexualized NPCs); offered a tame health-pickup alternative.
- [R013] ⏸ True radio EQ/highpass when on foot — not feasible: the music streams cross-origin from the release CDN, which sends no CORS header, so Web Audio can't filter it without muting. Shipped a volume duck instead (R012). Would need the audio hosted same-origin/CORS-enabled.

---

## ✅ Shipped
Driving + on-foot · procedural night city · chase camera · traffic & pedestrians · HUD + minimap ·
mobile/touch controls · streetlights · parked cars · headlights · powerslides · health + WASTED ·
traffic brakes for you · run-overs (shove vs gib) · wanted level + smart police (interception/separation/
avoidance) · pedestrians flee on foot · car radio (per-car station, mid-broadcast, distance-fade) ·
synthesized SFX (gearbox engine, screech, gib, blips) · ~200 mph + MPH readout · render interpolation ·
[R010] engine idles audibly at a parked car & fades as you walk off · [R011] footsteps on foot ·
[R012] radio ducks when you step out (+ distance fade) ·
[R008] BUSTED screen when a cop pins you slow (resets the game) ·
pedestrians fear the **car** (proximity + vector-dodge), not the on-foot player ·
the original **zero-shot build** is published at `/gta7/zero-shot/` (frozen snapshot in `public/zero-shot/`) ·
[R001] spatial-grid collision (uniform hash, equivalence unit-tested) — the single collision-query authority ·
[R002] damage model: cars take crash damage & explode when wrecked (player → WASTED, NPC → recycled); HUD shows car integrity while driving ·
[R014] police rubber-band pursuit + re-leash — an outrun cop ramps up to close the gap (capped under player top speed) and a hopelessly-far one is re-summoned near you, instead of crawling at a fixed speed ·
crash damage softened (no single hit totals an intact car) + louder footsteps ·
[R020] iOS audio unlock — radio primed in-gesture so sound starts on first tap ·
[R021] damaged cars trail **smoke particles** (billboard sprites, not geometry), thicker as they near wrecking ·
[R022] touch buttons use **lucide** SVG icons (no more "F" glyph) ·
[R019] fullscreen toggle button + PWA/home-screen path & safe-area insets (iPhone Safari has no element-fullscreen API → Add-to-Home-Screen is the true-fullscreen route) ·
[R023] on-foot **punch** that gibs the pedestrian in front of you into pixels (scores + raises heat) — Space / touch fist button ·
street **props** (trees/hydrants/benches, biome-weighted, instanced) + facade UV fix (no half-cut windows) ·
fix: police **arrest** the on-foot player (BUSTED) instead of running them over — a punch-summoned cop near the map edge was spawning on you and WASTED-ing you with no apparent cause.
Requester credits: [README](README.md#requested-by-the-internet).
