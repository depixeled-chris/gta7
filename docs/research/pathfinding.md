# Pathfinding (road-graph A*, reusable for all entities)

**Question:** Police (and later traffic, delivery, etc.) need to actually drive
*to* places — patrol routes, pursue along streets, approach from a distance —
not beeline through buildings. What pathfinding fits our world, scales to many
agents, and can be reused?
**Date:** 2026-05-31 · **Status:** 🔬 ready (ROADMAP R039; feeds the police overhaul R038)

## TL;DR
Our roads already form a **graph** (intersections are nodes; road segments are
edges), so use **A\* over that implicit lattice graph** — for an infinite world
you generate neighbours on the fly (`(i,j)` connects to `(i±1,j),(i,j±1)`), no
stored mesh. It's cheap, deterministic, pure, and unit-testable. Agents follow
the returned **waypoints** with the existing steering (the police
pursuit/separation/avoidance blend already steers toward a target point). Defer
**flow fields** (only worth it for big same-goal swarms) and **hierarchical A***
(only when routes span very long distances) until measured need.

## Findings
- **A\*** — lowest-cost path over a graph; ideal when movement is constrained to
  a network (roads). Cost = distance/time; heuristic = Manhattan (grid-aligned
  roads). Efficient on a sparse graph.
- **NavMesh** — encodes free walkable area as a graph; great for open terrain/
  on-foot, overkill for vehicles that must stay on roads (the road graph IS the
  nav graph for cars). Could add a coarse navmesh later for on-foot AI.
- **Flow fields** — one vector field many agents follow to a shared goal; scales
  to thousands but is per-goal. Useful later if a whole faction/horde converges
  on the player; not needed for a handful of cops.
- **Hierarchical** — plan coarse (region) then refine (local); pays off for very
  large maps / long routes. Our streamed world may want it eventually; start flat.

## Decision for us
1. **`findPath(startCell, goalCell, opts)` — pure A\*** over the road-intersection
   lattice (nodes = `(i,j)` at `i*cell, j*cell`; 4-neighbour; uniform/edge cost;
   Manhattan heuristic). Returns intersection waypoints in world space. Pure,
   Three-free, **node-unit-tested** (optimal length, reaches goal, deterministic).
   Cap expanded nodes so a far/blocked goal can't stall a frame.
2. **Agents follow waypoints** via the existing steering: feed the *current
   waypoint* as the steer target to the police pursuit/avoidance blend (and a
   lane-follow variant for traffic); advance to the next waypoint within a
   radius. Reuse for **any** road-bound entity (police, traffic, delivery NPCs).
3. **Re-plan cheaply**: only when the goal moves to a new intersection or the
   agent finishes its path — not every frame.
4. **Streamed world**: the lattice is implicit (compute neighbours from coords),
   so paths work over unloaded regions too; clamp path length to loaded+margin.
5. **Later (measured):** flow field for faction swarms; hierarchical for
   cross-city routes; a coarse on-foot navmesh.

## Reuse
This is shared infrastructure: the same `findPath` + waypoint-follower drives the
**police overhaul** (R038 — patrol routes, pursue/approach along streets,
reinforcements pathing in from afar), smarter **traffic** (route instead of
wrap), and future **delivery / mission** NPCs. Keep it a pure module
(`src/systems/pathfind.ts` or `src/core/`), Three-free, so the server can run it
too (multiplayer.md).

## Sources
- [Wayline — AI navigation meshes & pathfinding](https://www.wayline.io/blog/ai-navigation-mesh-game-engines-pathfinding)
- [jdxdev — RTS flow-field pathfinding](https://www.jdxdev.com/blog/2020/05/03/flowfields/)
- [Howik — Advanced AI pathfinding in Unreal (hierarchical, navmesh)](https://howik.com/advanced-ai-pathfinding-techniques-in-unreal-engine)
- [Multi-threaded Recast-based A* for scalable navigation (arXiv 2602.04130)](https://arxiv.org/pdf/2602.04130)
- Amit Patel / Red Blob Games — A* and grid pathfinding (canonical reference): https://www.redblobgames.com/pathfinding/a-star/introduction.html
