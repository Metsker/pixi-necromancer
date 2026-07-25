import type { Grid } from "../gfx/grid.ts";
import {
  CREATURES,
  KIND_GLYPH,
  RESOURCES,
  RES_IDS,
  SQUAD_GLYPH,
  TUNING,
  type Force,
  type GameState,
  type MapNode,
  type Point,
} from "../sim/data.ts";
import { canOrder, commandCap, forcesAt, heroUnit, reserve, xpNeeded } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, buttons } from "../ui.ts";

// log, status, resources; the button strip sits below it
export const HUD_ROWS = 3;

// One room step in character cells
export const ROOM_W = 6;
export const ROOM_H = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

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
  const at = nodeAt(g.nodes[g.forces[0].at]);
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

    const here = forcesAt(g, n.id);
    const busy = here.some((f) => f.mode === "fight");
    const locked = n.state === "locked";
    const cleared = n.state === "cleared";
    const frame = busy
      ? C.hot
      : locked
        ? C.frame
        : canOrder(g, n.id)
          ? C.gold
          : cleared
            ? C.dim
            : C.mid;
    if (on(x - 1, y)) grid.put(x - 1, y, "(", frame, C.bg);
    if (on(x + 1, y)) grid.put(x + 1, y, ")", frame, C.bg);
    if (on(x, y)) {
      grid.put(
        x,
        y,
        locked ? "?" : KIND_GLYPH[n.kind],
        locked ? C.frame : busy ? C.hot : cleared ? C.dim : C.ink,
        C.bg,
      );
    }
    drawForces(grid, here, x, y + 1, on);
    if (g.risen && g.risen.node === n.id) drawRising(grid, g, x, y, on);

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

// The dead getting up is the whole point of him, so it gets a moment: the
// glyphs climb out of the room and the room says so underneath.
function drawRising(
  grid: Grid,
  g: GameState,
  x: number,
  y: number,
  on: (x: number, y: number) => boolean,
) {
  const risen = g.risen!;
  const age = g.time - risen.at;
  if (age < 0 || age >= TUNING.riseTicks) return;
  const lift = 1 + Math.floor((age * 4) / TUNING.riseTicks);
  const tone = age * 3 < TUNING.riseTicks * 2 ? C.green : C.dim;

  risen.creatures.slice(0, 5).forEach((c, i) => {
    const at = x + i - ((Math.min(5, risen.creatures.length) - 1) >> 1);
    if (on(at, y - lift)) grid.put(at, y - lift, CREATURES[c].glyph, tone, C.bg);
  });

  const names = risen.creatures.map((c) => CREATURES[c].short.toUpperCase());
  const word = `${[...new Set(names)].join(" ")} ${names.length > 1 ? "RISE" : "RISES"}`;
  const text = word.slice(0, grid.cols);
  const at = clamp(x - (text.length >> 1), 0, Math.max(0, grid.cols - text.length));
  if (on(at, y + 2)) grid.text(at, y + 2, text, tone, C.shade);
}

// The necromancer, then anybody he has cut loose standing on the same room
function drawForces(
  grid: Grid,
  here: Force[],
  x: number,
  y: number,
  on: (x: number, y: number) => boolean,
) {
  const hero = here.find((f) => f.kind === "hero");
  const out = here.filter((f) => f.kind === "squad");
  if (hero && on(x, y)) grid.put(x, y, CREATURES.hero.glyph, C.gold, C.bg);
  if (!out.length) return;
  const at = hero ? x + 1 : x;
  if (!on(at, y)) return;
  grid.put(at, y, SQUAD_GLYPH, out.some((f) => f.mode === "fight") ? C.hot : C.cyan, C.bg);
  if (out.length > 1 && on(at + 1, y)) {
    grid.put(at + 1, y, `${Math.min(9, out.length)}`, C.cyan, C.bg);
  }
}

function drawHud(grid: Grid, g: GameState, y: number) {
  const cols = grid.cols;
  grid.text(0, y, (g.log[g.log.length - 1] ?? "").slice(0, cols), C.dim);

  const h = heroUnit(g);
  let x = 0;
  grid.put(x, y + 1, "♥", C.hot);
  const hp = h ? `${h.hp}/${h.maxHp}` : "--";
  grid.text(x + 1, y + 1, hp, C.ink);
  x += hp.length + 2;
  grid.put(x, y + 1, "★", C.gold);
  const lvl = `${g.level + 1}`;
  grid.text(x + 1, y + 1, lvl, C.ink);
  x += lvl.length + 2;
  grid.put(x, y + 1, "†", C.violet);
  grid.text(x + 1, y + 1, `${reserve(g).length}/${commandCap(g)}`, C.ink);

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
