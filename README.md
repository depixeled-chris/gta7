# GTA 7 🚗🌃

> A from-scratch, browser-based **GTA-style 3D open-world vertical slice** — built in TypeScript + Three.js in a single session, because a Reddit thread dared a new model to.
>
> No, it is not Grand Theft Auto VII. It's a procedural neon city you can drive around at night, hop out of the car, and wander on foot. The name is the joke.

![GTA 7 — driving through the procedural night city](docs/screenshot.png)

## Features

- **Procedural night city** — a seeded grid of streets and hundreds of lit-window towers; same seed always rebuilds the same skyline.
- **Arcade driving** — acceleration, braking, reverse, speed-scaled steering and a handbrake, with a smoothed chase camera.
- **Get in / get out** — switch between driving and walking on foot at any time.
- **Ambient life** — traffic looping the avenues and pedestrians milling the streets.
- **HUD + live minimap** — speedometer, mode indicator, and a top-down radar of the city and traffic.
- **Backed by tests** — the simulation core (vehicle physics, city generation, collision, RNG) is pure and unit-tested; a headless-Chromium smoke test proves the scene renders.

## Play it

```bash
npm install
npm run dev      # then open the printed localhost URL
```

### Controls

| Action | Keys |
| --- | --- |
| Drive / move | `W` `A` `S` `D` or arrow keys |
| Handbrake | `Space` |
| Enter / exit vehicle | `F` |
| Sprint (on foot) | `Shift` |
| Reset car | `R` |

## Develop

```bash
npm test          # unit tests for the pure simulation core (Vitest)
npm run build     # typecheck + production build
npm run smoke     # build + headless-Chromium render check
```

The smoke test needs Chromium once: `npx playwright install chromium`.

See [`CLAUDE.md`](CLAUDE.md) for architecture — the short version: gameplay logic is kept pure and Three.js-free so it's testable in node, and everything that touches `three` lives in a separate rendering layer.

## Tech

[Three.js](https://threejs.org/) · [TypeScript](https://www.typescriptlang.org/) · [Vite](https://vitejs.dev/) · [Vitest](https://vitest.dev/) · [Playwright](https://playwright.dev/) (smoke test)

## License

MIT — have fun with it.
