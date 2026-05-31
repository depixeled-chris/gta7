# Research

Findings from research passes, kept so we don't re-investigate the same ground.

**Before researching anything, check this index first.** If a current doc
already covers it, build from that. If it's stale, *update it in place* — don't
start a parallel investigation.

Each doc follows the same shape: **Question · Date · Status · TL;DR · Findings ·
Sources**. Status is one of: 🔬 ready (actionable, not yet built) · ✅ implemented
· ♻️ partially implemented · 🗄️ superseded.

When you add research: create `docs/research/<kebab-topic>.md`, link it below,
and reference it from the relevant `R###` item in [../../ROADMAP.md](../../ROADMAP.md).

## Index
| Doc | Topic | Status | ROADMAP |
| --- | --- | --- | --- |
| [police-chase-ai.md](police-chase-ai.md) | Steering AI + behaviour overhaul (patrol, LOS pursuit/cooldown, spawn-on-street) | ♻️ partial | R038 |
| [pathfinding.md](pathfinding.md) | Road-graph A* + waypoint following, reusable for police/traffic/NPCs | 🔬 ready | R039 |
| [traffic-ai.md](traffic-ai.md) | IDM car-following + collision avoidance, phantom-leader intersections, MOBIL lane-change; pure/deterministic/MP-ready | 🔬 ready | R040 |
| [rust-wasm-physics.md](rust-wasm-physics.md) | Rapier hybrid (defer; bounded prop world later) + a TS-interface seam so the pure core can be backed by TS or Rust/WASM; perf-driven port order (gen/noise first) | 🔬 ready | R041 |
| [car-physics-profiles.md](car-physics-profiles.md) | Maturing the vehicle model for multiple car profiles | 🔬 ready | R003 |
| [perf-wasm-streaming.md](perf-wasm-streaming.md) | Rust/WASM ROI + chunked streaming world + spatial grid | ♻️ partial (grid shipped; streaming half → generative-world.md) | R001 / R007 / R009 |
| [generative-world.md](generative-world.md) | Streamed deterministic world: noise biomes, highways, rivers+bridges, variety, perf/WASM order | 🔬 ready | R005 / R007 / R015–R018 (epic) |
| [ecs-architecture.md](ecs-architecture.md) | Full-ECS target design + incremental, test-gated migration plan | 🔬 design approved | R030 |
| [gamepad-support.md](gamepad-support.md) | Web Gamepad API: standard mapping, radial deadzone, polling, edge detection | 🔬 ready | R036 |
| [multiplayer.md](multiplayer.md) | Authoritative-server netcode, prediction/reconciliation, AOI, sharding+Redis+WS; constraints to keep MP-ready now | 🔬 informing-only | R037 |
| [weapons-combat.md](weapons-combat.md) | Projectile-entity weapons (ped handheld + Interstate-76 vehicle-mounted), ECS + damage + MP-ready | 🔬 ready | R034 |
