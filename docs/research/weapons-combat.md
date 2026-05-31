# Weapons & combat (ped handheld + vehicle-mounted)

**Question:** How to add weapons — pedestrians with handheld firearms and
**Interstate-'76-style vehicle-mounted** weapons (the gun belongs to the car;
only outfitted cars are armed) — in a way that fits the ECS, the existing damage
model, and stays deterministic + MP-ready?
**Date:** 2026-05-31 · **Status:** 🔬 ready (ROADMAP R034)

## TL;DR
Make shots **projectile entities** (pooled), not hitscan — they're visible
(arcade feel), reuse the existing pooled-effect pattern (Debris/Smoke), drop
straight onto the ECS, and are the easiest thing to sync/reconcile for
multiplayer. A **`Weapon` component** (a loadout) sits on an armed entity — a
pedestrian or a *vehicle hardpoint*; firing is an **intent** (so it sequences
for prediction). A `projectileSystem` moves them, tests them against the
`WorldGrid` (walls stop bullets) and actor/car circles, and applies damage via
the existing health paths (car health→wreck, ped→gib, player→WASTED). Hit
detection lives in the pure sim so a server can be authoritative later.

## Findings
- **Hitscan vs projectile.** Hitscan = instant ray, great for twitchy FPS
  responsiveness; projectile = a moving object you can see/lead, with travel
  time. For a 3rd-person/top-down driving game, **projectiles read better**
  (you see tracers/rockets) and model rockets/lobs naturally. Keep **hitscan as
  an option** for a future "instant" weapon class (ray vs the same colliders).
- **Object pooling** is standard for projectiles (spawn from a pool, return on
  impact) — exactly our Debris/Smoke pattern, and a natural ECS entity lifecycle.
- **Server-authoritative hit detection** (for MP): the client sends a *fire
  intent*; the server simulates the projectile and decides hits; client predicts
  and reconciles. So firing must be an **intent**, hit detection must be in the
  **deterministic sim** (not the renderer), and projectile state must be plain
  serializable component data. (Matches multiplayer.md.)
- **Vehicular combat** (Stainless/Twisted-Metal lineage): weapons are **mounted
  hardpoints**; damage accumulates **modularly** (we already have car `health`
  → wreck). Ramming is its own attack (we have mass-weighted collisions). Only
  *outfitted* vehicles carry weapons — the weapon is the car's, per the user.

## Design for us (build order)
1. **Projectile ECS** — `Projectile` component `{ vx,vz, life, damage, ownerId, kind }`
   + `Transform` + a pooled render mesh (tracer/rocket), exactly like Debris.
   `projectileSystem`: integrate; stop on `WorldGrid.resolve` hit (wall);
   `circleOverlap` vs cars (→ `damage`) and actors (→ ped gib / player WASTED);
   expire on life/`life<=0`. Pure-testable hit math (ray/segment vs circle).
2. **`Weapon` loadout** — `{ kind, cooldownLeft, fireRate, muzzleSpeed, damage }`.
   A `fireSystem` spawns projectiles when a fire intent is set and cooldown is 0,
   from the muzzle (ped: forward of the avatar; vehicle: a hardpoint offset on the
   car, fired along its heading — the weapon belongs to the car).
3. **Armament** — only *some* vehicle profiles get a weapon (a `weapon?` on
   `CarProfile`, or a separate "armed vehicle" spawn). Pedestrians: a fraction
   carry handhelds (later: faction enforcers, R032). The player fires the
   current car's weapon if it has one, or a handheld on foot.
4. **Input** — a `fire` intent on `Controls` (gamepad RT-as-fire when on foot /
   a dedicated button; mouse/space on desktop; a touch fire button). Edge or
   held depending on weapon. Sequence-numbered with a view to MP.
5. **Feedback** — muzzle SFX (synth, like the others), tracer/rocket mesh,
   impact spark/explosion (reuse Debris/Smoke). Damage flows through existing
   `crashDamage`-style health so wrecks/gibs already "just work".

## Keep deterministic + MP-ready
- No `Math.random()` in hit logic; projectile spread (if any) from the seeded rng
  or fixed pattern. Hit detection is a pure function of positions/velocities.
- Firing is an intent; projectiles are ids+data; the sim (not render) owns hits —
  so an authoritative server can run the same `fireSystem`/`projectileSystem`.

## Skip for v1
Ballistic drop/wind (top-down doesn't need it), per-hit-zone car damage (single
`health` is enough for now), reloading/inventory UI (one weapon + cooldown).

## Sources
- [NeoFPS — Hitscan vs Projectiles](https://docs.neofps.com/manual/weapons-firearms-hitscan-projectiles.html); [Hitscan — Wikipedia](https://en.wikipedia.org/wiki/Hitscan)
- [The Art of Hit Registration](https://danieljimenezmorales.github.io/2023-10-29-the-art-of-hit-registration/); [Gabriel Gambetta — Client-Server Game Architecture](https://gabrielgambetta.com/client-server-game-architecture.html)
- [Getgud.io — Multiplayer game architecture](https://www.getgud.io/blog/mastering-multiplayer-game-architecture-choosing-the-right-approach/); ECS netcode bullet-entity pattern (condidios/ecs-netcode-multiplayer-demo)
- [Unreal — Stainless Games on vehicular combat design](https://www.unrealengine.com/en-US/developer-interviews/stainless-games-explains-how-to-design-a-modern-vehicular-combat-game); [Vehicular combat — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/VehicularCombat)
