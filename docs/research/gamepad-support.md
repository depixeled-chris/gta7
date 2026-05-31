# Gamepad support (Web Gamepad API)

**Question:** How to add controller support correctly — mapping, deadzones,
polling, edge detection, browser quirks — and fit it into the existing `Controls`
(keyboard + touch) abstraction?
**Date:** 2026-05-31 · **Status:** 🔬 ready (ROADMAP R036)

## TL;DR
Poll `navigator.getGamepads()` **fresh every frame** (it's a snapshot, not
event-driven), pick the first gamepad whose `mapping === "standard"`, apply a
**radial deadzone (~0.12)** to the sticks, read triggers as **analog
`button.value` (0..1)**, and do **edge detection** in JS (compare `pressed` to
last frame) for one-shot actions. Keep the mapping a **pure function** so it's
unit-tested; the polling/edge glue is thin browser code like `Input`. Merge into
`Controls` exactly like touch — summed with keyboard, never replacing it.

## Standard mapping (W3C "standard gamepad")
Only one layout is standardized; `gamepad.mapping === "standard"` means the
browser remapped the device to it (Xbox / DualShock / Switch Pro all do).
- **Axes:** `0` left X, `1` left Y, `2` right X, `3` right Y. Range −1..1, **up is −1**.
- **Buttons** (`.pressed` bool, `.value` 0..1 analog): `0` A/✕, `1` B/○, `2` X/▢,
  `3` Y/△, `4` LB, `5` RB, `6` LT, `7` RT, `8` Back/Select, `9` Start, `10` L3,
  `11` R3, `12–15` D-pad U/D/L/R, `16` Home.

## Best practices (and how we apply them)
- **Poll per frame, re-query fresh.** `navigator.getGamepads()` returns the
  current snapshot; don't hold a reference from `gamepadconnected`. Cheap to call.
- **Deadzone is mandatory** or the avatar/car drifts. Use a **radial** deadzone
  (treat (x,y) as a vector, ignore magnitude < dz, rescale dz..1 → 0..1 so
  sensitivity stays uniform). dz ≈ 0.05–0.12; we use **0.12** for sticks, a small
  **0.06** for trigger noise.
- **Triggers are analog** → drive throttle/brake from `buttons[7].value` (RT) and
  `buttons[6].value` (LT), nicer than digital.
- **Edge-trigger one-shots in JS** (enter/punch/reset/radio): track previous
  `pressed` and fire on the false→true transition, consumed once per frame.
- **Indices can change** on connect/disconnect; select by scanning for the first
  connected `mapping==="standard"` pad each poll rather than caching index 0.
- **No headless e2e:** Playwright can't synthesize real gamepad input reliably, so
  the **mapping is a pure, node-tested function**; the polling glue mirrors the
  untested `Input` keyboard glue. (Consistent with the repo's "pure logic is
  tested, thin browser glue isn't" line.)

## Our mapping (Xbox-style, fits the single `Controls.move()` vector)
- Left stick → `move` (x = steer/strafe, y = forward); `move.y` also takes
  **RT − LT** so triggers accelerate/reverse while driving. Clamp to [−1,1].
- **B (1)** = handbrake (held) · **L3 (10)** = sprint (held) · **A (0)** =
  enter/exit (edge) · **X (2)** = punch (edge) · **Y (3)** = reset (edge) ·
  **RB (5)** = radio next (edge) · **LB (4)** = radio prev (edge).
- Merged into `Controls` alongside keyboard+touch (summed), so all three input
  methods are always live — same rule as touch.

## Sources
- [MDN — Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
- [W3C Gamepad spec — standard mapping](https://w3c.github.io/gamepad/#remapping)
- [Beej — Using Gamepads and Joysticks in JavaScript](https://beej.us/blog/data/javascript-gamepad/)
- [ensemblejs/gamepad-api-mappings](https://github.com/ensemblejs/gamepad-api-mappings) (per-browser quirks)
