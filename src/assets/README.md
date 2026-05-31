# src/assets

Assets **imported in code** (`import logo from './assets/logo.png'`). Vite
processes these — hashes filenames for cache-busting and inlines tiny ones as
data URLs. Good for small UI images / icons that ship in the bundle.

Use the other locations for:
- **Runtime, URL-loaded files** (3D models, runtime textures, the splash image,
  manifests) → `public/` (referenced via `import.meta.env.BASE_URL`).
- **Large binaries** (big models, texture sets, audio) → a **GitHub Release**,
  streamed by URL (the radio precedent) — keep them out of git.
