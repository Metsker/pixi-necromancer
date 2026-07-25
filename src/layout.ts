import { TILE } from "./tilemap.ts";

export const TARGET_TILE_CSS = 18;
export const MIN_COLS = 18;
export const MAX_COLS = 44;
export const MAX_ROWS = 64;

export type Viewport = {
  innerWidth: number;
  innerHeight: number;
  dpr: number;
  reserved: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// Scale is chosen for legibility in device pixels, then dropped a step at a time
// until the narrowest usable grid fits. The grid only ever takes what is there.
export function computeLayout({ innerWidth, innerHeight, dpr, reserved }: Viewport) {
  const wDev = Math.max(TILE, innerWidth * dpr);
  const hDev = Math.max(TILE, (innerHeight - reserved) * dpr);

  let scale = Math.max(1, Math.round((TARGET_TILE_CSS * dpr) / TILE));
  while (scale > 1 && Math.floor(wDev / (TILE * scale)) < MIN_COLS) scale -= 1;

  const cell = TILE * scale;
  const cols = clamp(Math.floor(wDev / cell), 1, MAX_COLS);
  const rows = clamp(Math.floor(hDev / cell), 1, MAX_ROWS);
  return {
    dpr,
    scale,
    cell,
    cols,
    rows,
    cssCell: cell / dpr,
    cssW: (cols * cell) / dpr,
    cssH: (rows * cell) / dpr,
  };
}
