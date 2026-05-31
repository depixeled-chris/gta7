import * as THREE from 'three';
import { createRng, type Rng } from '../core/rng';
import type { FacadeStyle } from '../world/biome';

/**
 * Builds a tileable facade texture in one of several styles, so the skyline
 * isn't all glass towers: `glass` (dense lit window grid — skyscrapers),
 * `brick` (warm low-rise with sparse windows and mortar courses — houses), and
 * `concrete` (commercial ribbon windows between spandrels). The (0,0) texel is
 * forced dark so roof/floor faces — whose UVs collapse to that corner — read as
 * unlit. Deterministic from `seed`.
 */
export function makeFacadeTexture(seed: number, style: FacadeStyle = 'glass', px = 256): THREE.CanvasTexture {
  const rng = createRng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  if (style === 'brick') drawBrick(ctx, rng, px);
  else if (style === 'concrete') drawConcrete(ctx, rng, px);
  else drawGlass(ctx, rng, px);

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 2, 2); // dark corner texel for roof/floor faces

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const LIT = ['#ffd9a0', '#ffe9c0', '#ffcf87', '#cfe6ff'];

/** Dense grid of lit/dark windows — a glass tower. */
function drawGlass(ctx: CanvasRenderingContext2D, rng: Rng, px: number): void {
  ctx.fillStyle = '#10131b';
  ctx.fillRect(0, 0, px, px);
  const cells = 8;
  const cell = px / cells;
  const pad = cell * 0.18;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (rng.chance(0.42)) {
        ctx.fillStyle = rng.pick(LIT);
        ctx.globalAlpha = rng.range(0.65, 1);
      } else {
        ctx.fillStyle = '#1b2030';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }
}

/** Warm masonry with mortar courses and small, sparsely-lit windows — low-rise. */
function drawBrick(ctx: CanvasRenderingContext2D, rng: Rng, px: number): void {
  ctx.fillStyle = '#5a3d30';
  ctx.fillRect(0, 0, px, px);
  // Mortar courses: faint horizontal lines, brick rows.
  const rows = 16;
  const rh = px / rows;
  ctx.globalAlpha = 1;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = r % 2 ? '#5f4133' : '#54392d';
    ctx.fillRect(0, r * rh, px, rh - 1);
  }
  // Windows: a coarse grid, ~40% present, of those a third warmly lit.
  const cells = 4;
  const cell = px / cells;
  const w = cell * 0.5;
  const h = cell * 0.62;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (!rng.chance(0.78)) continue; // some bays are blank wall
      const ox = x * cell + (cell - w) / 2;
      const oy = y * cell + (cell - h) / 2;
      ctx.fillStyle = '#241a14';
      ctx.globalAlpha = 1;
      ctx.fillRect(ox - 2, oy - 2, w + 4, h + 4); // frame
      if (rng.chance(0.35)) {
        ctx.fillStyle = '#ffdca0';
        ctx.globalAlpha = rng.range(0.55, 0.9);
      } else {
        ctx.fillStyle = '#10141d';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(ox, oy, w, h);
    }
  }
}

/** Concrete spandrels with horizontal ribbon windows — commercial/office. */
function drawConcrete(ctx: CanvasRenderingContext2D, rng: Rng, px: number): void {
  ctx.fillStyle = '#565a62';
  ctx.fillRect(0, 0, px, px);
  const bands = 7;
  const bh = px / bands;
  for (let b = 0; b < bands; b++) {
    const y = b * bh;
    // Spandrel (concrete) strip on top, then a darker ribbon window below it.
    ctx.globalAlpha = 1;
    ctx.fillStyle = b % 2 ? '#5f636b' : '#52565d';
    ctx.fillRect(0, y, px, bh * 0.42);
    const ribY = y + bh * 0.42;
    const ribH = bh * 0.5;
    ctx.fillStyle = '#161b24';
    ctx.fillRect(0, ribY, px, ribH);
    // Lit office segments punched along the ribbon.
    const segs = 6;
    const sw = px / segs;
    for (let s = 0; s < segs; s++) {
      if (!rng.chance(0.4)) continue;
      ctx.fillStyle = rng.chance(0.7) ? '#ffe7b8' : '#bcd6ff';
      ctx.globalAlpha = rng.range(0.5, 0.85);
      ctx.fillRect(s * sw + sw * 0.12, ribY + ribH * 0.2, sw * 0.76, ribH * 0.6);
    }
  }
}

/**
 * Soft radial gradient (white core → transparent edge). Laid flat under a lamp
 * with additive blending it fakes the pool of light a streetlight casts, far
 * cheaper than a real shadow-casting light per pole.
 */
export function makeGlowTexture(px = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const r = px / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,232,196,1)');
  grad.addColorStop(0.4, 'rgba(255,216,150,0.45)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A soft, faintly mottled puff — opaque-ish core fading to nothing at the edge.
 * Mapped onto camera-facing billboard sprites it reads as a smoke particle (not
 * 3D geometry), so a damaged car can trail smoke cheaply.
 */
export function makeSmokeTexture(px = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const r = px / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
