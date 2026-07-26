import type { Grid } from "../gfx/grid.ts";
import {
  ARMY_COLOR,
  ARMY_GLYPH,
  KIND_GLYPH,
  MANA_GLYPH,
  RESOURCES,
  RES_IDS,
  TUNING,
  type GameState,
  type MapNode,
  type Point,
} from "../sim/data.ts";
import {
  canOrder,
  commandCap,
  fielded,
  manaCap,
  reserve,
  threatOf,
  xpNeeded,
} from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, buttons } from "../ui.ts";

// log, status, asking, resources; the button strip sits below it
export const HUD_ROWS = 4;

// One room step in character cells
export const ROOM_W = 6;
export const ROOM_H = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// Mild, bad, and do not walk in there
const THREAT = [C.pale, C.gold, C.hot];

export const viewRows = (rows: number) => Math.max(1, rows - HUD_ROWS - BTN_ROWS);

export const nodeAt = (n: MapNode): Point => ({ x: 2 + n.col * ROOM_W, y: 1 + n.row * ROOM_H });

export const mapSize = () => ({
  w: 2 + (TUNING.mapCols - 1) * ROOM_W + 3,
  h: 1 + (TUNING.mapRows - 1) * ROOM_H + 2,
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

export function drawMap(grid: Grid, g: GameState, cam: Point, hits: Hits, speed: number) {
  const { cols, rows } = grid;
  const view = viewRows(rows);
  const on = (x: number, y: number) => y >= 0 && y < view && x >= 0 && x < cols;

  // Links first: orthogonal only, so every join is one straight run
  for (const n of g.nodes) {
    const a = nodeAt(n);
    for (const id of n.links) {
      if (id < n.id) continue;
      const other = g.nodes[id];
      const b = nodeAt(other);
      const color = n.state !== "locked" || other.state !== "locked" ? C.dim : C.frame;
      if (a.y === b.y) {
        for (let x = a.x + 2; x < b.x - 1; x++) {
          if (on(x - cam.x, a.y - cam.y)) grid.put(x - cam.x, a.y - cam.y, "─", color);
        }
      } else {
        for (let y = a.y + 1; y < b.y; y++) {
          if (on(a.x - cam.x, y - cam.y)) grid.put(a.x - cam.x, y - cam.y, "│", color);
        }
      }
    }
  }

  for (const n of g.nodes) {
    const p = nodeAt(n);
    const x = p.x - cam.x;
    const y = p.y - cam.y;
    if (y < -1 || y > view || x < -2 || x > cols + 1) continue;

    const here = g.at === n.id;
    const busy = here && g.mode === "fight";
    const locked = n.state === "locked";
    const cleared = n.state === "cleared";
    // The brackets say whether you can act on it and the glyph says how bad it
    // is, so the brackets stay cool and the threat colours stay warm
    const frame = busy
      ? C.hot
      : locked
        ? C.frame
        : canOrder(g, n.id)
          ? C.cyan
          : cleared
            ? C.dim
            : C.mid;
    if (on(x - 1, y)) grid.put(x - 1, y, "(", frame, C.bg);
    if (on(x + 1, y)) grid.put(x + 1, y, ")", frame, C.bg);
    if (on(x, y)) {
      // A room you can still walk into is coloured by what is waiting in it
      const ink = locked ? C.frame : busy ? C.hot : cleared ? C.dim : THREAT[threatOf(n)];
      grid.put(x, y, locked ? "?" : KIND_GLYPH[n.kind], ink, C.bg);
    }
    // He stands under the room he is in. How the army is holding up is the
    // heart in the hud; this is only where you are.
    if (here && on(x, y + 1)) grid.put(x, y + 1, ARMY_GLYPH, COL(ARMY_COLOR), C.bg);

    // Clipped to the map area, so a room just off the bottom cannot eat a hud tap
    const top = Math.max(0, y - 1);
    const tall = Math.min(view, y + 2) - top;
    if (tall > 0) hits.add(x - 1, top, 3, tall, { t: "node", id: n.id });
  }

  drawHud(grid, g, view);
  buttons(grid, hits, [
    { label: speed === 0 ? "║" : `x${speed}`, act: { t: "speed" } },
    { label: `ARMY ${reserve(g).length}`, act: { t: "army" } },
    { label: "MENU", act: { t: "menu" } },
  ]);
}

function drawHud(grid: Grid, g: GameState, y: number) {
  const cols = grid.cols;
  grid.text(0, y, (g.log[g.log.length - 1] ?? "").slice(0, cols), C.dim);

  // What the army has left, as one number, because it is the health bar now
  const troop = reserve(g);
  const hp = `${troop.reduce((s, u) => s + u.hp, 0)}/${troop.reduce((s, u) => s + u.maxHp, 0)}`;
  let x = 0;
  grid.put(x, y + 1, "♥", C.hot);
  grid.text(x + 1, y + 1, hp, C.ink);
  x += hp.length + 2;
  grid.put(x, y + 1, "★", C.gold);
  const lvl = `${g.level + 1}`;
  grid.text(x + 1, y + 1, lvl, C.ink);
  x += lvl.length + 2;
  grid.put(x, y + 1, "†", C.violet);
  grid.text(x + 1, y + 1, `${fielded(g)}/${commandCap(g)}`, C.ink);

  // What is left to ask with, on its own line: it is the number that decides
  // whether a body on the floor is worth anything
  const pool = `${g.mana}/${manaCap(g)}`;
  grid.put(0, y + 2, MANA_GLYPH, C.cyan);
  grid.text(1, y + 2, pool, C.ink);
  const xp = `xp${g.xp}/${xpNeeded(g)}`;
  grid.text(Math.max(pool.length + 2, cols - xp.length), y + 2, xp, C.dim);

  x = 0;
  for (const r of RES_IDS) {
    const info = RESOURCES[r];
    grid.put(x, y + 3, info.glyph, COL(info.color));
    const n = `${g.res[r]}`;
    grid.text(x + 1, y + 3, n, C.mid);
    x += n.length + 2;
  }
}
