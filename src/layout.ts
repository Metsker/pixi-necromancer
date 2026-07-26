import { TILE } from "./tilemap.ts";

export const TARGET_TILE_CSS = 18;
export const MIN_COLS = 20;
// A fight needs an arena, a roster and a few lines of log under it
export const MIN_ROWS = 28;
export const MAX_COLS = 64;
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

  // A big window gets bigger tiles, not more of them, up to a playable grid
  const fill = Math.floor(Math.min(wDev / (TILE * MIN_COLS), hDev / (TILE * MIN_ROWS)));
  let scale = Math.max(1, Math.round((TARGET_TILE_CSS * dpr) / TILE), fill);
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
