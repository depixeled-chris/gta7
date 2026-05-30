# GTA 7 🚗🌃

### ▶ [Play the live demo](https://depixeled-chris.github.io/gta7/)

> A from-scratch, browser-based **GTA-style 3D open-world vertical slice** — built in TypeScript + Three.js in a single session, because a Reddit thread dared a new model to.
>
> No, it is not Grand Theft Auto VII. It's a procedural neon city you can drive around at night, hop out of the car, and wander on foot. The name is the joke.
>
> Works on desktop (keyboard) and mobile (on-screen touch controls).

![GTA 7 — driving through the procedural night city](docs/screenshot.png)

## Features

- **Procedural night city** — a seeded grid of streets and hundreds of lit-window towers; same seed always rebuilds the same skyline.
- **Lit streets** — a streetlight on every corner casting warm pools of light, plus working twin headlights on the car you're driving.
- **Arcade driving with powerslides** — a velocity-vector handling model with tyre grip; yank the handbrake mid-corner and the back end steps out into a drift.
- **Carjack anything** — walk up to *any* car — your spawn ride, ambient traffic, or one of the cars parked along the curbs — and get in.
- **Physical cars** — solid buildings and momentum-based car-on-car impacts: ram traffic and it gets shoved off course.
- **Traffic that brakes for you… mostly** — stand in the road and oncoming cars slow and stop; dart out from inside their stopping distance and they can't help it. Get hit and you lose health; run out and it's **WASTED**, then you respawn.
- **Ambient life** — traffic looping the avenues and pedestrians milling the streets.
- **Plays on mobile** — keyboard on desktop, an on-screen analog joystick + action buttons on touch devices (auto-detected), with quality scaled down for phone GPUs.
- **HUD + live minimap** — speedometer, health, mode indicator, and a top-down radar of the city and traffic.
- **Backed by tests** — the simulation core (vehicle physics, city generation, collision, RNG) is pure and unit-tested; headless-Chromium tests prove the scene renders *and* that driving, carjacking, and collisions actually work.

![Powersliding on the handbrake](docs/drift.png)
![A streetlight casting a pool of light over the road](docs/streetlights.png)
![The WASTED screen after being run over](docs/wasted.png)
![Touch controls on a mobile device](docs/mobile.png)

## Play it

```bash
npm install
npm run dev      # then open the printed localhost URL
```

### Controls

| Action | Keys |
| --- | --- |
| Drive / move | `W` `A` `S` `D` or arrow keys |
| Handbrake (powerslide) | `Space` |
| Enter / exit nearest vehicle | `F` |
| Sprint (on foot) | `Shift` |
| Reset car | `R` |

On a touch device the same actions map to an on-screen joystick (steer + throttle / move) and buttons (enter-exit · handbrake · sprint · reset).

## Develop

```bash
npm test          # unit tests for the pure simulation core (Vitest)
npm run build     # typecheck + production build
npm run smoke     # build + headless-Chromium render check
npm run test:e2e  # render check + gameplay interaction test (collision, carjacking, shoving)
```

The browser tests need Chromium once: `npx playwright install chromium`.

See [`CLAUDE.md`](CLAUDE.md) for architecture — the short version: gameplay logic is kept pure and Three.js-free so it's testable in node, and everything that touches `three` lives in a separate rendering layer.

## Tech

[Three.js](https://threejs.org/) · [TypeScript](https://www.typescriptlang.org/) · [Vite](https://vitejs.dev/) · [Vitest](https://vitest.dev/) · [Playwright](https://playwright.dev/) (smoke test)

## License

MIT — have fun with it.
