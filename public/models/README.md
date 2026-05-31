# public/models

Runtime 3D models (glTF / **.glb** preferred) loaded via Three's `GLTFLoader`.
Files in `public/` are copied verbatim to the deploy root (not hashed/bundled).

- **Reference with the base path**, not a bare absolute path — the site is served
  from `/gta7/` on GitHub Pages:
  ```ts
  loader.load(`${import.meta.env.BASE_URL}models/car.glb`, …)
  ```
- **Keep big binaries out of git.** Anything more than a few MB (high-poly models,
  large texture sets) goes on a **GitHub Release** and streams by URL — same
  precedent as the radio audio (`radio-v1`). The repo + Pages site stay lean.
- Models are a **render-layer** concern (load them from `src/render/`), keeping the
  pure simulation core Three-free.
