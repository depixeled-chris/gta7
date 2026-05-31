# Police chase AI

**Question:** How to make the police chase feel good instead of cops trailing
single-file, bunching up, and sticking to buildings?
**Date:** 2026-05-30 · **Status:** ♻️ partially implemented

## TL;DR
Use Reynolds steering behaviors blended into a desired direction. Shipped:
pursuit/interception, separation, obstacle avoidance, busted state, **rubber-band
chase speed + re-leash** (so a player who outruns cops can't just leave them
crawling). Not yet built: flanking slots, line-of-sight cooldown, escalation
table, roadblocks/PIT.

## Findings (prioritized punch-list)
Accumulate weighted behaviors → clamp → integrate (the standard loop).

1. **Pursuit/interception** ✅ — aim where the player *will* be: lead time
   `T = min(maxLead, gap / (copSpeed + targetSpeed))`, seek `target + vel*T`.
   `maxLead ≈ 1.2 s`. Critical because the player outruns cops on straights;
   leading lets a flanker actually cut them off. (`leadTime` in `core/math`.)
2. **Separation** ✅ — push away from nearby cops, weight `1/d²`, normalize.
   Radius ≈ 2.5–3 car lengths; weight > pursuit so they fan out in a scrum.
3. **Obstacle avoidance** ✅ — probe a point ahead along velocity; if it would
   clip a building, steer along the push-out normal (we reuse `city.grid.resolve`).
   Avoidance weight highest so they don't grind walls; the look-ahead now grows
   with speed so high-speed chases don't clip corners. (Full Reynolds uses 3 ray
   whiskers; our single look-ahead probe is the cheap version.)
4. **Flanking/surround** 🔬 — assign each cop an angle *slot* around the player
   in the player's velocity frame; pursue the slot, not the player. Forward slots
   become blockers. Re-assign slots greedily ~every 1 s. Only at wanted ≥ 2.
5. **Losing them (LOS + cooldown)** 🔬 — two phases: seen (any cop has line of
   sight → search circle re-centers, escape timer held) vs cooldown (no LOS →
   cops head to last-known position, timer counts up; survive outside the circle
   → wanted drops). Flash the stars while cooling. We currently use a simpler
   time-based heat decay instead.
6. **Busted** 🔬 (= ROADMAP R008) — `pinned = speed<4 && ≥2 cops within ~9 m &&
   one within ~4 m`; fill a timer (decays 2× faster than it fills); >2 s → busted.
7. **Escalation by wanted level** 🔬 — drive everything off one `WANTED_CONFIG[star]`
   table of scalar knobs (count, speed, sight, flank/PIT toggles). Cheapest
   high-value escalation: roadblocks (just spawned cars using existing collision).
   Keep per-star differences as data, not scattered `if wanted >= n`.
8. **Rubber-band + re-leash** ✅ (= ROADMAP R014) — the player tops out far above
   any sane cop cruise speed, so a fixed cop speed means an opened gap never
   closes. Fix: chase speed `pursuitSpeed(gap, base, max, gain)` ramps with the
   gap (capped just under player top speed — escapable but pressured), and a cop
   beyond a leash distance is teleported back to the spawn radius (`placeNear`),
   reading as a fresh interceptor instead of a useless straggler. Both behaviors
   are e2e-tested. Cleaner long-term home: fold `base`/`max` into per-car profiles
   (R003) so an "interceptor" profile is just faster.

## Behaviour overhaul (R038) — make the chase feel real, not spawned-on-top
Maintainer directives (the current `placeNear`-anywhere-then-instantly-pursue is
the thing to kill):
- **Ambient patrol.** With no wanted level, cruisers **drive the roads** (A*
  patrol routes / lane-follow via pathfinding.md), part of traffic. A crime in a
  patrolling cop's **vicinity** (proximity) **or line of sight** triggers pursuit.
- **Spawn rules.** Reinforcements spawn **on a street**, **outside a periphery**
  of the player — **never on top**. A spawned cop only **pursues immediately if it
  can SEE the player from its spawn point**; otherwise it patrols/approaches via
  pathfinding. A **cooldown timer** spawns further-away cruisers that know the
  player's last position and **path in** toward it.
- **Get away / LOS cooldown.** Wanted **cools off when no cop has line of sight**
  to the player (GTA-style): seen → search circle re-centres, escape timer held;
  unseen → timer counts up, stars flash while cooling, survive out of sight →
  wanted drops. Replaces the current pure time-decay.
- **Line of sight** = a ray from cop to player tested against `WorldGrid`
  (buildings occlude) — pure, reusable, and implementable before streaming.
- **Pathfinding** (pathfinding.md) drives patrol routes, pursuit-along-streets,
  and reinforcement approach; the existing steering blend follows the waypoints.
- **Dependencies:** LOS + spawn-on-street are doable now; full road-patrol wants
  the streamed road graph. Build LOS-cooldown + spawn-on-street-with-LOS first,
  then patrol once streaming lands.

## Sources
Reynolds *Steering Behaviors* (red3d.com/cwr/steer), Nature of Code ch.5
(autonomous agents), GTA V wanted-level search-cone/cooldown model.
