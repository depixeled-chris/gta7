# Multiplayer architecture (forward-looking constraints)

**Question:** We'll eventually want real-time multiplayer on **sharding + Redis
pub/sub + WebSockets**. What architecture does that imply, and — more
importantly right now — what must we NOT break as we build single-player so the
netcode isn't a rewrite later?
**Date:** 2026-05-31 · **Status:** 🔬 informing-only (no MP code yet; constraints for current work)

## TL;DR
Build toward an **authoritative server running our deterministic ECS headless**,
with clients doing **prediction + reconciliation** and **interpolating** other
entities. The **chunk is the unit of interest management AND the shard boundary**:
clients subscribe (via WebSocket→server, server↔server via Redis pub/sub) to the
chunks near them; a region/zone server is authoritative for its chunks. To keep
that door open we only need to honour a few constraints now (below) — almost all
already true thanks to the pure ECS + seeded determinism.

## Findings
- **Authoritative server = single source of truth.** Clients never trust local
  state for anything that matters; the server simulates and corrects. Prevents
  cheating and divergence.
- **Client-side prediction + server reconciliation.** The client applies input
  immediately using the *same* sim, tags each input with a **sequence number**,
  and keeps a buffer. The server's authoritative update echoes the last processed
  sequence; the client rewinds to that state and **replays** unacknowledged
  inputs. Corrections are eased in over a few frames to avoid snapping.
- **Other entities are interpolated** from periodic **snapshots/deltas** (render
  ~100ms in the past, between two received states), or — the model that fits us —
  **deterministic simulation**: send inputs+ticks, every peer runs the identical
  sim (There.com style). Our seeded, `Date.now()`/`Math.random()`-free sim is
  already built for this.
- **Interest management (AOI)** is what makes it scale: only sync entities near a
  player. Nearby players/mobs get frequent updates; distant ones a slow rotating
  schedule or none. **Our chunks are exactly this AOI grid.**
- **Sharding:** partition the world into zones/regions, each a server authoritative
  for its chunks; a **gateway** holds client WebSocket connections; **Redis** for
  session/cache and **pub/sub to sync across shards** and hand entities off at
  zone borders. Players near a border subscribe to both shards.
- **Tick-based fixed timestep** on the server (we already run a fixed 60 Hz
  `GameLoop`); network sends decoupled from sim rate (e.g. 10–20 snapshots/s).

## Constraints to honour NOW (cheap; mostly already true)
1. **Sim stays authoritative, deterministic, and headless-runnable** — pure ECS
   systems, Three-free, seeded, tick-based. The server runs the same `update`
   systems with no renderer. (Already our architecture; don't regress it.)
2. **State is serializable data, not behaviour** — entities = ids + plain
   component data; never stash authoritative state inside `THREE` objects or
   closures (RenderMesh is client-only/derived). Makes snapshot/delta + diffing
   possible.
3. **Drive the sim from intents, not UI mutations** — the `Controls` intent shape
   (`move`, `handbrake`, …) is precisely the input packet; keep gameplay reading
   intents so inputs are serializable + sequence-able for prediction/replay.
4. **Chunk = AOI = shard unit** — build streaming so chunk load/subscribe and
   entity ownership are per-chunk; this is the seam Redis pub/sub and zone servers
   slot into. (Reinforces the streaming design.)
5. **Separate "owned by me / predicted" from "remote / interpolated"** — even
   single-player, keep the player entity's update path distinct from ambient
   actors, so remote-player interpolation drops in later.

## Non-goals / deferred
No netcode, server, or transport now — this only steers single-player decisions.
Revisit (and research transports, Redis topology, anti-cheat, lockstep-vs-
snapshot in depth) when we actually build the MP layer. Likely stack when we do:
Node + `ws`/uWebSockets gateway, Redis pub/sub for shard fan-out, deterministic
ECS shared between client and server as a package.

## Sources
- [Gabriel Gambetta — Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- [Web Game Dev — Prediction & Reconciliation](https://www.webgamedev.com/backend/prediction-reconciliation)
- [Wikipedia — Client-side prediction](https://en.wikipedia.org/wiki/Client-side_prediction)
- [PRDeving — MMO Architecture: source of truth, dataflows, I/O bottlenecks](https://prdeving.wordpress.com/2023/09/29/mmo-architecture-source-of-truth-dataflows-i-o-bottlenecks-and-how-to-solve-them/)
- [Edgegap — How MMO architecture scales](https://edgegap.com/blog/how-mmo-games-architecture-scales-with-a-smart-fleet-manager)
- GameDev.net — MMORPG movement netcode (AOI rotating snapshot schedule); There.com deterministic-sim model
