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
- [R001] 🔵 Spatial grid for collision — @maintainer · replaces per-car full-collider scan; biggest perf win + foundation for R004/R007 (per research)
- [R002] 🔵 Damage model — @maintainer · cars take impact damage, explode when wrecked (player → WASTED, NPC → debris + respawn)
- [R003] 🔬 Car profiles + mass — @maintainer · data-driven `CarProfile` (sports/truck/interceptor); see Researched

## 🔵 Queued (triaged, not started)
- [R004] 🔵 Proper car-car collision / no clipping — @maintainer · cars pass through each other at intersections; needs R001 + AI yielding
- [R005] 🔵 Street & building variety — @maintainer · more shapes/colours/props/street dressing
- [R006] 🔵 In-game options menu — @maintainer · volume sliders (radio vs SFX), maybe quality toggle
- [R007] 🔬 Chunked / streaming world — @maintainer · deterministic `generateChunk(cx,cz)` then load/unload; see Researched
- [R008] 🔵 Busted state — community · police pin you at low speed → arrested (vs only ramming)

## 🔬 Researched — ready to implement
Full write-ups in [`docs/research/`](docs/research/).
- **R003 — Car physics profiles** → [research/car-physics-profiles.md](docs/research/car-physics-profiles.md). Plumb `CarProfile` + per-car `profile`, then add `mass` / `radius` / `highSpeedSteerMul`; grip circle optional.
- **R001 — Spatial grid** & **R007 — Streaming** → [research/perf-wasm-streaming.md](docs/research/perf-wasm-streaming.md). Grid first (near-O(n) collision, foundation for streaming); streaming step 0 = pure `generateChunk(cx,cz)`.
- **R009 — Rust/WASM**: NO-GO now (premature) — same doc has the revisit triggers.

## ⏸ Deferred / declined
- [R009] ⏸ Rust → WASM — premature. Revisit when >300–500 colliding bodies on a TS grid, or runtime chunk-gen hitches (>4–6 ms); try a Web Worker before WASM.
- ⏸ Sex-worker mechanic (community) — declined (sexualized NPCs); offered a tame health-pickup alternative.

---

## ✅ Shipped
Driving + on-foot · procedural night city · chase camera · traffic & pedestrians · HUD + minimap ·
mobile/touch controls · streetlights · parked cars · headlights · powerslides · health + WASTED ·
traffic brakes for you · run-overs (shove vs gib) · wanted level + smart police (interception/separation/
avoidance) · pedestrians flee on foot · car radio (per-car station, mid-broadcast, distance-fade) ·
synthesized SFX (gearbox engine, screech, gib, blips) · ~200 mph + MPH readout · render interpolation.
Requester credits: [README](README.md#requested-by-the-internet).
