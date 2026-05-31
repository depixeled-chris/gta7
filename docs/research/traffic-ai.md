# Ambient traffic AI (collision-avoiding car-following)

**Question:** Our AI traffic just follows lane centerlines and recovers from
knocks (`driveAi` in `Vehicles.ts`); cars are blind to each other, so they
drive through one another, pile up, and never yield at junctions. How do we make
ambient traffic *aware* of other cars and try not to collide — robustly, cheaply,
and inside the pure Three-free sim core?
**Date:** 2026-05-31 · **Status:** 🔬 ready

## TL;DR
Replace the constant-`cruise` lane follower with the **Intelligent Driver Model
(IDM)** for *longitudinal* control: each AI car looks up its **leader** (nearest
car ahead in the same lane, via `city.grid`/spatial-hash) and sets acceleration
from one closed-form equation parameterised by desired speed `v0`, time headway
`T`, jam gap `s0`, max accel `a`, comfortable decel `b`. IDM is **crash-free by
construction** — the braking term diverges as the gap closes — so it gives smooth,
realistic following with zero special-casing. Lateral control stays our existing
lane-centerline correction (a cheap **arrival/path-follow** Reynolds term). Then
**intersections** drop out for free: model a red light / yield-to-crossing-traffic
as a **phantom stopped leader** at the stop line, and IDM brakes for it like any
car — the same trick SUMO uses. **Lane changing (MOBIL)** comes last and is
optional for a grid city. All of it is pure, deterministic, 60 Hz, unit-testable;
the new pieces are 2–3 pure functions in `core/` + a neighbour query, no new code
path for "the player car" (CLAUDE.md invariant). This reuses the Reynolds
machinery already documented for police (police-chase-ai.md) and the road graph
from pathfinding.md.

## Findings

### 1. Car-following: the Intelligent Driver Model (IDM)
The IDM (Treiber, Hennecke, Helbing 2000) is *the* standard microscopic
car-following model: time-continuous, accident-free, and parameterised by
intuitive, empirically calibrated quantities
([traffic-simulation.de/info_IDM](https://traffic-simulation.de/info/info_IDM.html),
[Wikipedia: IDM](https://en.wikipedia.org/wiki/Intelligent_driver_model)). A car
picks its **acceleration** each step from its speed `v`, the bumper-to-bumper
**gap** `s` to the car ahead, and the **approach rate** `Δv = v − v_lead`:

```
dv/dt = a · [ 1 − (v/v0)^δ − (s*(v,Δv) / s)² ]

s*(v,Δv) = s0 + max(0, v·T + (v·Δv) / (2·√(a·b)))
```

- **`v0`** desired (free-road) speed. City value: adapt `v0`, leave the rest
  ([Treiber](https://traffic-simulation.de/info/info_IDM.html)). Maps onto our
  per-car `cruise`.
- **`T`** safe time headway — seconds of gap a driver keeps. Realistic 0.8–2 s
  (German schools say 1.8 s); use ~1.2–1.5 s for lively city traffic.
- **`s0`** minimum standstill gap (~2 m). Our cars are circles of radius 1.9, so
  `s0` is measured *surface to surface* (subtract the two radii from centre
  distance).
- **`a`** max acceleration (realistic 0.8–2.5 m/s²; pick ~1.5).
- **`b`** comfortable deceleration (~2–3 m/s²). Distinct from emergency braking.
- **`δ`** acceleration exponent, conventionally 4 (governs how accel tapers off
  approaching `v0`).

**Why it can't crash:** the interaction term `−(s*/s)²` is the whole trick. The
*desired* gap `s*` grows with speed (`v·T`) and, when closing fast, with the
approach rate (`v·Δv/(2√(ab))` — an explicit "brake so I can stop in time"
term). As the real gap `s → s*` the braking exactly cancels the free-road
acceleration `a·[1−(v/v0)^δ]`, so accel → 0; as `s` shrinks below `s*` the
`(s*/s)²` term blows up and produces hard braking before contact. In almost all
situations the resulting deceleration stays *below* the comfortable `b`
([traffic-simulation.de](https://traffic-simulation.de/info/info_IDM.html)). This
is exactly the smooth, anticipatory following our current `damp`-to-cruise
follower lacks. (IDM is also the default/optional car-follower in SUMO, the
reference open-source traffic microsimulator —
[SUMO car-following](https://sumo.dlr.de/docs/Definition_of_Vehicles%2C_Vehicle_Types%2C_and_Routes.html#car-following_models).)

Note IDM is purely **longitudinal** (along the lane). We keep lateral control as
the existing centerline pull (`-lateral * LANE_CORRECT`) — that is already an
*arrival/path-following* Reynolds term; we are only swapping the speed law.

### 2. Reynolds steering — and how it composes with IDM
Reynolds' *Steering Behaviors* (the same source the police use,
[red3d.com/cwr/steer](https://www.red3d.com/cwr/steer/)) gives the menu and the
composition rule: **weighted summation of steering forces**, each behaviour a
simple vector, accumulate → clamp → integrate. Relevant to traffic:
- **Separation** — push away from nearby agents (we use this for police anti-
  stacking, weight `1/d²`). A cheap lateral *backstop* for traffic so cars that
  end up side-by-side nudge apart.
- **Obstacle avoidance** — look-ahead probe vs. buildings (police reuse
  `city.grid.resolve`). Traffic on rails barely needs it, but it's the same
  primitive if a lane bends.
- **Arrival** — decelerate to reach a target smoothly instead of overshooting
  (vs. plain *seek*). This is conceptually what IDM does for the longitudinal
  axis; think of IDM as a physically-grounded, crash-proof *arrival-at-the-gap*.
- **Path following** — stay on a route; our lane centerline is a degenerate
  straight path. With pathfinding.md's road-graph waypoints, traffic can *route*
  through the city instead of wrapping at the edge.
- **Unaligned collision avoidance** — predictive avoidance of *other moving*
  agents whose paths cross ([red3d.com](https://www.red3d.com/cwr/steer/)). This
  is the steering analogue of intersection yielding; we prefer the IDM
  phantom-leader formulation below because it's deterministic and 1-D.

**Division of labour for us:** IDM owns *how fast* (longitudinal, crash-free);
Reynolds owns *which way* (lateral centerline pull + separation backstop +
optional avoidance). They don't fight — different axes, summed.

### 3. Lane changing & merging (MOBIL) — defer, then add cheaply
MOBIL ("Minimizing Overall Braking Induced by Lane changes", Kesting/Treiber/
Helbing 2007) is the standard companion to IDM
([mtreiber.de/MOBIL](https://mtreiber.de/MicroApplet/MOBIL.html),
[MOBIL TRB pdf](https://mtreiber.de/publications/MOBIL_TRB.pdf)). It decides
*whether* to change lanes using the **same IDM accelerations** evaluated
hypothetically on the target lane — two checks:

- **Safety:** the prospective new follower `B'` must not be forced to brake
  harder than a safe limit: `a_new(B') > −b_safe` (with `b_safe ≈ 4 m/s²`, kept
  well under the ~9 m/s² physical max).
- **Incentive:** change only if your own accel gain outweighs the politeness-
  weighted disadvantage to others, plus a threshold to avoid dithering:
  `a'(M) − a(M) > p·[Δa(B') + Δa(B)] + a_thr`, where `p` is the **politeness
  factor** (0 = selfish … ~0.5 realistic), `a_thr ≈ 0.2 m/s²` is the switching
  threshold, and an asymmetric `Δb ≈ 0.2 m/s²` bias encodes keep-right rules
  ([mtreiber.de](https://mtreiber.de/MicroApplet/MOBIL.html)).

For a Manhattan grid where lanes are short between intersections, MOBIL buys
overtaking of a stopped/slow car and feels nice but is **not required** for
crash-free traffic — IDM alone already prevents collisions by stopping behind a
slow leader. **Defer to phase 2.** When added it's another pure function
(`mobilWantsChange(self, currentLeader, targetLeader, targetFollower, params)`)
reusing the IDM accel function — no new state.

### 4. Intersections — the phantom-leader trick (the key insight)
Don't write a bespoke junction state machine. The robust, well-grounded approach
(SUMO's "ghost/virtual vehicle", and the RTYIDM yielding model) is: when a car
must yield — red light, stop line, or higher-priority crossing traffic — insert a
**phantom stopped leader at the stop line** and let IDM brake for it exactly as
it would for a real car ([SUMO junction model / ghost vehicle approximation,
USPTO 11138349](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11138349);
[ScienceDirect RTYIDM yielding](https://www.sciencedirect.com/science/article/abs/pii/S1569190X24000443)).
Microsimulators step at ~1 s or finer and move cars by car-following logic *in
response to control devices* (signals/stop/yield)
([FHWA Traffic Analysis Toolbox Vol. III §3](https://ops.fhwa.dot.gov/trafficanalysistools/tat_vol3/sect3.htm)).

So intersection handling reduces to **"is there a phantom leader, and where?"**:
1. **Effective leader = nearest of {real car ahead, phantom at stop line}.** Feed
   whichever is closer into the *same* IDM call. One code path.
2. **Right-of-way for a grid.** Two cheap, deterministic schemes — pick per taste:
   - **Traffic signals.** Each intersection has a phase derived *deterministically*
     from time + its grid coords: e.g. N–S green when
     `floor(t / CYCLE) % 2 == hashSeed(seed, ix, iz) & 1`, E–W otherwise, with a
     short all-red. A car approaching on a red axis sees a phantom leader at the
     stop line; on green, none. No stored mutable signal state needed for
     determinism — it's a pure function of `(t, ix, iz)`.
   - **Priority / stop rule** (uncontrolled): the lower-priority axis yields. A
     yielding car gets a phantom leader at the stop line *unless* the conflict
     zone is clear — clearance tested by a spatial-hash query for any
     higher-priority car within a time-to-arrival window. Right-of-way at
     uncontrolled junctions is "who's there / who has priority"
     ([Zutobi right-of-way rules](https://zutobi.com/us/driver-guides/uncontrolled-intersections)).
   Signals are simpler to make deterministic and read well in a night city
   (glowing lights). **Recommend signals first.**
3. **Crossing-traffic gap acceptance** is then just: yield (phantom at stop line)
   until the gap to the nearest crossing car exceeds a critical headway, same
   `safeApproachSpeed`/time-headway logic we already have for pedestrian braking.

This keeps intersections as *data + one pure leader-selection function*, not a
sprawl of `if` cases — matches the CLAUDE.md "priority/fallback logic indicates a
missing abstraction" rule.

### 5. Mapping onto our pure, deterministic, 60 Hz core
- **Purity:** IDM, MOBIL, and the signal-phase function are all closed-form math
  over scalars — they belong in `src/core/` (Three-free, node-unit-testable),
  alongside `safeApproachSpeed`/`pursuitSpeed`. Same coord-frame invariant
  applies (forward `(cos h,0,−sin h)`).
- **Determinism:** no `Math.random()` in the per-step law; signal phase is a pure
  fn of `(t, ix, iz, seed)` via `hashSeed`. Same seed → same traffic, so the
  `City`/`Vehicles` test discipline holds. (NB: `driveAi`/`wreck`/`placeNear`
  currently call `Math.random()` — that's a pre-existing determinism leak; new
  traffic code must not add to it, and ideally those get threaded through
  `createRng` when this lands. Flag per CLAUDE.md.)
- **Neighbour lookup must be cheap.** IDM needs each car's *leader* (and MOBIL
  needs target-lane leader+follower). Naïve is O(n²); we already pay that in
  `collide`. Use the existing **`SpatialGrid`/`WorldGrid`** to query only nearby
  cars, then pick the nearest one *ahead in the same lane* (project the offset
  onto `lane.dir`; same-lane = matching `axis` and `fixed≈`). This is O(1)
  amortised per car and is the same grid the collision pass and police feeler use.
  Build a transient "cars by lane / cars in cell" index once per step.
- **Fixed timestep:** the IDM accel goes in `update(dt)`; integrate
  `v += a·dt; x += v·dt` (semi-implicit Euler, which is what `driveAi` already
  does via `damp`). Presentation/interp stays in `render` (the existing `px/pz`
  snapshot + `lerp`).
- **Streaming (R007):** leader lookup is local (neighbours within a few car
  lengths), so it works per-chunk with a one-cell margin; cars near a chunk seam
  just query the loaded neighbour cell. Signal phase is a pure fn of coords →
  identical across chunk load order, same invariant as world-gen.

### 6. Multiplayer-readiness
Per multiplayer.md, the sim becomes **server-authoritative** with **intents over
the wire** and **chunk = AOI = shard**. Implications for traffic:
- **Ambient traffic is server-simulated, not client-predicted.** Players predict
  *their own* car from their input intents; ambient cars are remote actors the
  client **interpolates** from snapshots. So IDM runs authoritatively on the
  server (or, in deterministic-lockstep style, identically on every peer because
  it's seeded + `Date.now()`-free). Keep traffic state as **plain component data**
  (already true — `Car` is data) so it snapshots/diffs cleanly; never stash
  authoritative state in `THREE` objects (the `group` is client-render-only).
- **Determinism is the enabler.** Because IDM + signal-phase are pure functions of
  `(state, seed, t)`, two servers (or a server and a replaying client) reach the
  same traffic — exactly the "There.com deterministic-sim" model multiplayer.md
  favours. This is *why* it must go in the pure core and avoid `Math.random()`.
- **Chunk ownership.** A zone server owns the cars in its chunks; a car crossing a
  seam hands off like any entity. Leader lookup needing a one-cell margin means a
  car near a border may need a read of the neighbour shard's cars — the same
  border-subscription multiplayer.md already calls for. No new mechanism.
- **Who simulates:** keep ambient-traffic update in the shared, headless-runnable
  system (like all sim systems), distinct from the player's predicted path —
  multiplayer.md constraint #5 ("separate owned/predicted from remote/interpolated").

## Recommended phased approach for this repo

**Phase 1 — Longitudinal IDM along existing lanes (do first).**
- Add pure `idmAccel(v, v0, gap, dv, params)` → acceleration, in `src/core/idm.ts`
  (params: `{ a, b, T, s0, delta }`). Unit-test: free road → accel toward `v0`;
  closing on a slow/stopped leader → brakes, never overshoots the gap, decel
  stays ≤ ~`b` except in cut-in; identical output for identical inputs.
- In `Vehicles.driveAi`: build a per-step **leader index** off `city.grid` (nearest
  car ahead in the same lane), compute `gap` (centre distance − 2·`CAR_RADIUS`)
  and `dv`, call `idmAccel`, integrate longitudinal speed; keep the existing
  lateral centerline pull and `heading = atan2(-vz, vx)`. The current
  pedestrian-brake path becomes "pedestrian = a phantom leader" — fold it in so
  there's one gap source, not two brake systems.
- e2e (`interaction.mjs`): spawn cars nose-to-tail in a lane, assert no overlaps
  over N seconds and that a lead car stopping makes followers queue, not collide.

**Phase 2 — Intersections via phantom leaders + deterministic signals.**
- Add pure `signalPhase(t, ix, iz, seed)` → which axis is green, and
  `stopLineLeader(car, intersection, phase)` → optional phantom `{gap, dv:−v}`.
  Leader selection = nearest of {real leader, phantom}. Unit-test phase
  determinism and that a red-axis car gets a stop-line phantom.
- HUD/render: lit signal heads (cheap emissive, like streetlights) so the player
  reads the phase. Police patrol (R038) and traffic share the same junction rules.

**Phase 3 — Lane changing (MOBIL), optional.**
- Add pure `mobilWantsChange(...)` reusing `idmAccel` for the hypothetical-lane
  accels; gate behind safety + incentive (`p`, `a_thr`, `b_safe`). Only worth it
  once routes (pathfinding.md road graph) replace edge-wrapping, so cars have a
  reason to overtake. Unit-test the safety veto and the politeness threshold.

**Cross-cutting:** thread per-car IDM params off the existing `CarProfile`
(car-physics-profiles.md, R003) so a "truck" follows with larger `T`/`s0`/smaller
`a` as *data*, not a branch. Don't add a player-car code path — the player stays
`stepVehicle`-integrated; IDM only drives `role:'ai'` cars (CLAUDE.md: extend the
shared model, no special cases).

## Sources
- [Treiber — The Intelligent-Driver Model and its Variants](https://traffic-simulation.de/info/info_IDM.html) (equations, parameter values, why it's accident-free)
- [Wikipedia — Intelligent driver model](https://en.wikipedia.org/wiki/Intelligent_driver_model) (exact `dv/dt` and `s*` formulas)
- [arXiv 2506.05909 — Twenty-Five Years of the IDM: Foundations, Extensions, Applications](https://arxiv.org/html/2506.05909v1)
- [Treiber/Kesting — The Lane-change Model MOBIL](https://mtreiber.de/MicroApplet/MOBIL.html) (safety + incentive criteria, politeness `p`, `b_safe`, `a_thr`, keep-right bias)
- [Kesting, Treiber, Helbing — General Lane-Changing Model MOBIL (TRB pdf)](https://mtreiber.de/publications/MOBIL_TRB.pdf)
- [Craig Reynolds — Steering Behaviors For Autonomous Characters](https://www.red3d.com/cwr/steer/) (separation, arrival, path following, unaligned collision avoidance; weighted-sum composition)
- [SUMO — Car-following models (IDM/EIDM, default Krauss)](https://sumo.dlr.de/docs/Definition_of_Vehicles%2C_Vehicle_Types%2C_and_Routes.html#car-following_models)
- [USPTO 11138349 — Ghost/virtual vehicle approximation near intersections](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11138349)
- [ScienceDirect — RTYIDM yielding at signalized intersections](https://www.sciencedirect.com/science/article/abs/pii/S1569190X24000443)
- [FHWA — Traffic Analysis Toolbox Vol. III §3 (microsimulation: time-step + control devices)](https://ops.fhwa.dot.gov/trafficanalysistools/tat_vol3/sect3.htm)
- [Zutobi — Right-of-way at uncontrolled intersections](https://zutobi.com/us/driver-guides/uncontrolled-intersections)
- In-repo: [police-chase-ai.md](police-chase-ai.md) (Reynolds blend we reuse), [pathfinding.md](pathfinding.md) (road-graph routing for traffic), [multiplayer.md](multiplayer.md) (server-authoritative, chunk=AOI), [car-physics-profiles.md](car-physics-profiles.md) (per-profile IDM params).
