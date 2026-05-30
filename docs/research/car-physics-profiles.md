# Car physics: maturing the model for multiple profiles

**Question:** How to evolve the arcade vehicle model so we can have cars with
different performance profiles (sports / truck / interceptor) — without turning
it into a full sim?
**Date:** 2026-05-30 · **Status:** 🔬 ready (ROADMAP R003)

## TL;DR
`stepVehicle` is already a pure `(state, input, config, dt)` function, so a
profile is mostly "swap the config." Add ~3 fields (`mass`, `radius`,
`highSpeedSteerMul`), data-drive profiles, and make collision mass-weighted via
a pure helper. A grip circle is an optional second pass. Skip real gears and
weight transfer.

## Do-first order
1. **Plumbing (no new physics):** rename `VehicleConfig` → `CarProfile`; add a
   `profile` to the `Car` interface; drop the hardcoded `DEFAULT_VEHICLE` in the
   player step (pass `car.profile`); create `vehicles/profiles.ts` exporting a
   few cars (keep `DEFAULT_VEHICLE` as an alias). The existing 12 fields already
   encode accel/top-speed/grip/braking/handling — authoring is most of the work.
2. **`mass`** — pays off twice: mass-weighted collision impulse and (optionally)
   accel scaling. Extract the inline car-pair impulse into a pure, tested
   `resolveCarImpulse(av, bv, ma, mb, nx, nz, e)`; equal mass reduces to today's
   `imp = -(1+e)*vn/2`. Bias positional separation by mass too (heavy car shoves through).
3. **`radius`** per profile (truck > hatchback); replace the global `CAR_RADIUS`
   at its ~5 call sites with `a.profile.radius (+ b.profile.radius)`.
4. **`highSpeedSteerMul`** — taper turn authority toward top speed:
   `authority = clamp(speed/gripSpeed,0,1) * lerp(1, mul, clamp(speed/maxSpeed,0,1))`.
   Default `1` = today's behavior exactly (tests stay green).

## Optional 2nd pass — grip circle
Share one traction budget between longitudinal and lateral demand: compute
desired `aLong` and `aLat`, and if `hypot(aLong, aLat) > tractionLimit` scale
both down. Gives brake-rotation and power-oversteer (the arcade stand-in for
weight transfer) for ~10 lines. Keep the `exp(-grip*dt)` lateral bleed for the
handbrake path (unconditionally stable); pick one model for normal-grip lateral,
don't run both. Verify stability at `dt = 1/60`.

## Skip (sim rabbit holes)
Real gear ratios affecting accel (our gearbox is audio-only, correct), per-axle
weight transfer (the grip circle covers the feel), downforce (never relevant at
city speeds).

## Sample profiles (illustrative, tune later)
| field | sports | truck | interceptor |
| --- | --- | --- | --- |
| enginePower | 16 | 7 | 14 |
| maxSpeed | 95 | 60 | 88 |
| turnRate | 3.0 | 1.8 | 2.8 |
| gripNormal | 12 | 7 | 11 |
| mass | 1100 | 4500 | 1700 |
| radius | 1.8 | 2.6 | 2.0 |
| highSpeedSteerMul | 0.55 | 0.35 | 0.6 |

## Purity / testing
Profile stays a plain data argument (never a global lookup inside `stepVehicle`).
Profiles live in one module (one source of truth via the `CarProfile` type).
Test the *matrix* with relative assertions (truck tops out slower than sports;
heavier car keeps more velocity after a hit) rather than magic numbers.
