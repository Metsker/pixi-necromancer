import type { Grid } from "../gfx/grid.ts";
import {
  CREATURES,
  KIND_GLYPH,
  RESOURCES,
  RES_IDS,
  TUNING,
  type GameState,
  type MapNode,
  type Point,
} from "../sim/data.ts";
import { canAdvance, canMove, commandCap, xpNeeded } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, buttons } from "../ui.ts";

// log, status, resources; the button strip sits below it
export const HUD_ROWS = 3;

// One hex step in character cells. Odd rows are pushed half a step right, and
// the row pitch is about 0.87 of the column pitch, which is what makes six
// equidistant neighbours look equidistant on a grid of square cells.
export const HEX_W = 6;
export const HEX_H = 5;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export const viewRows = (rows: number) => Math.max(1, rows - HUD_ROWS - BTN_ROWS);

// Where a room sits on the map, in map cells rather than screen cells
export const nodeAt = (n: MapNode): Point => ({
  x: 2 + n.col * HEX_W + (n.row & 1 ? HEX_W >> 1 : 0),
  y: 1 + n.row * HEX_H,
});

export const mapSize = () => ({
  w: 2 + (TUNING.mapCols - 1) * HEX_W + (HEX_W >> 1) + 3,
  h: 1 + (TUNING.mapRows - 1) * HEX_H + 2,
});

// The camera never shows more void than it has to, and centres when the map fits
export function clampCam(cam: Point, cols: number, rows: number): Point {
  const size = mapSize();
  const view = viewRows(rows);
  return {
    x: size.w <= cols ? (size.w - cols) >> 1 : clamp(Math.round(cam.x), 0, size.w - cols),
    y: size.h <= view ? (size.h - view) >> 1 : clamp(Math.round(cam.y), 0, size.h - view),
  };
}

export function centerOn(g: GameState, cols: number, rows: number): Point {
  const at = nodeAt(g.nodes[g.at]);
  return clampCam({ x: at.x - (cols >> 1), y: at.y - (viewRows(rows) >> 1) }, cols, rows);
}

export function drawMap(grid: Grid, g: GameState, cam: Point, hits: Hits) {
  const { cols, rows } = grid;
  const view = viewRows(rows);
  const on = (x: number, y: number) => y >= 0 && y < view && x >= 0 && x < cols;

  for (const n of g.nodes) {
    const a = nodeAt(n);
    for (const id of n.links) {
      if (id < n.id) continue; // each edge is stored at both ends; draw it once
      const other = g.nodes[id];
      const b = nodeAt(other);
      const known = n.state !== "locked" || other.state !== "locked";
      edge(grid, a, b, cam, known ? C.dim : C.frame, on);
    }
  }

  for (const n of g.nodes) {
    const p = nodeAt(n);
    const x = p.x - cam.x;
    const y = p.y - cam.y;
    if (y < -1 || y > view || x < -2 || x > cols + 1) continue;

    const locked = n.state === "locked";
    const cleared = n.state === "cleared";
    const reach = canAdvance(g, n.id) || canMove(g, n.id);
    const frame = locked ? C.frame : reach ? C.gold : cleared ? C.dim : C.mid;
    if (on(x - 1, y)) grid.put(x - 1, y, "(", frame, C.bg);
    if (on(x + 1, y)) grid.put(x + 1, y, ")", frame, C.bg);
    if (on(x, y)) {
      grid.put(x, y, locked ? "?" : KIND_GLYPH[n.kind], locked ? C.frame : cleared ? C.dim : C.ink, C.bg);
    }
    if (g.at === n.id && on(x, y + 1)) grid.put(x, y + 1, CREATURES.hero.glyph, C.gold, C.bg);
    // Clipped to the map area, so a room just off the bottom cannot eat a hud tap
    const top = Math.max(0, y - 1);
    const tall = Math.min(view, y + 2) - top;
    if (tall > 0) hits.add(x - 1, top, 3, tall, { t: "node", id: n.id });
  }

  drawHud(grid, g, view);
  buttons(grid, hits, [
    { label: `ARMY ${g.army.length}`, act: { t: "army" } },
    { label: "MENU", act: { t: "menu" } },
  ]);
}

// Walks the long axis so a link reads as one unbroken run whatever its slope
function edge(
  grid: Grid,
  a: Point,
  b: Point,
  cam: Point,
  color: number,
  on: (x: number, y: number) => boolean,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps < 2) return;
  const ch = dy === 0 ? "─" : dx === 0 ? "│" : dx > 0 === dy > 0 ? "╲" : "╱";
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + dx * t) - cam.x;
    const y = Math.round(a.y + dy * t) - cam.y;
    if (on(x, y)) grid.put(x, y, ch, color);
  }
}

function drawHud(grid: Grid, g: GameState, y: number) {
  const cols = grid.cols;
  grid.text(0, y, (g.log[g.log.length - 1] ?? "").slice(0, cols), C.dim);

  let x = 0;
  grid.put(x, y + 1, "♥", C.hot);
  const hp = `${g.hero.hp}/${g.hero.maxHp}`;
  grid.text(x + 1, y + 1, hp, C.ink);
  x += hp.length + 2;
  grid.put(x, y + 1, "★", C.gold);
  const lvl = `${g.level + 1}`;
  grid.text(x + 1, y + 1, lvl, C.ink);
  x += lvl.length + 2;
  grid.put(x, y + 1, "†", C.violet);
  grid.text(x + 1, y + 1, `${g.army.length}/${commandCap(g)}`, C.ink);

  x = 0;
  for (const r of RES_IDS) {
    const info = RESOURCES[r];
    grid.put(x, y + 2, info.glyph, COL(info.color));
    const n = `${g.res[r]}`;
    grid.text(x + 1, y + 2, n, C.mid);
    x += n.length + 2;
  }
  const xp = `xp${g.xp}/${xpNeeded(g)}`;
  grid.text(Math.max(x, cols - xp.length), y + 2, xp, C.dim);
}
