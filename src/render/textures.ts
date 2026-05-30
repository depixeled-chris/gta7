import * as THREE from 'three';
import { createRng } from '../core/rng';

/**
 * Builds a tileable facade texture: an NxN grid of windows, each randomly lit
 * (warm) or dark (cool glass). Tiling this across building faces gives a
 * varied night-city skyline from a single shared material. The (0,0) texel is
 * forced dark so roof/floor faces — whose UVs collapse to that corner — read
 * as unlit concrete.
 */
export function makeFacadeTexture(seed: number, cells = 8, px = 256): THREE.CanvasTexture {
  const rng = createRng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#10131b';
  ctx.fillRect(0, 0, px, px);

  const cell = px / cells;
  const pad = cell * 0.18;
  const lit = ['#ffd9a0', '#ffe9c0', '#ffcf87', '#cfe6ff'];

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const on = rng.chance(0.42);
      if (on) {
        ctx.fillStyle = rng.pick(lit);
        ctx.globalAlpha = rng.range(0.65, 1);
      } else {
        ctx.fillStyle = '#1b2030';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 2, 2); // dark corner texel for roof/floor faces

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
