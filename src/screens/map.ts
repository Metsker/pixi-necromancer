import type { Grid } from "../gfx/grid.ts";
import {
  CREATURES,
  KIND_GLYPH,
  RESOURCES,
  RES_IDS,
  TUNING,
  type GameState,
  type MapNode,
} from "../sim/data.ts";
import { canAdvance, canMove, commandCap, xpNeeded } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, buttons } from "../ui.ts";

// log, status, resources; the button strip sits below it
export const HUD_ROWS = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// The whole descent has to fit the rows that are left, so the spacing between
// layers shrinks before anything is allowed to run into the HUD
export function mapGeometry(cols: number, rows: number) {
  const area = Math.max(4, rows - HUD_ROWS - BTN_ROWS);
  const layers = TUNING.layers;
  const gap = clamp(Math.floor((area - 1) / (layers - 1)), 1, 6);
  const top = Math.max(1, Math.floor((area - (layers - 1) * gap) / 2));
  return {
    area,
    gap,
    top,
    x: (n: MapNode) => clamp(Math.round((cols * (n.slot + 0.5)) / n.of), 2, cols - 3),
    y: (n: MapNode) => Math.min(top + n.layer * gap, area - 1),
  };
}

export function drawMap(grid: Grid, g: GameState, hits: Hits) {
  const { cols, rows } = grid;
  const geo = mapGeometry(cols, rows);

  for (const n of g.nodes) {
    for (const id of n.links) {
      const c = g.nodes[id];
      const x0 = geo.x(n);
      const x1 = geo.x(c);
      const ya = geo.y(n) + 1;
      const yb = geo.y(c) - 1;
      const ch = x1 === x0 ? "│" : x1 > x0 ? "╲" : "╱";
      const known = n.state !== "locked" || c.state !== "locked";
      for (let y = ya; y <= yb; y++) {
        const t = (y - ya + 1) / (yb - ya + 2);
        grid.put(Math.round(x0 + (x1 - x0) * t), y, ch, known ? C.dim : C.frame);
      }
    }
  }

  for (const n of g.nodes) {
    const x = geo.x(n);
    const y = geo.y(n);
    const locked = n.state === "locked";
    const cleared = n.state === "cleared";
    const reach = canAdvance(g, n.id) || canMove(g, n.id);
    const frame = locked ? C.frame : reach ? C.gold : cleared ? C.dim : C.mid;
    grid.put(x - 1, y, "[", frame, C.bg);
    grid.put(x + 1, y, "]", frame, C.bg);
    grid.put(
      x,
      y,
      locked ? "?" : KIND_GLYPH[n.kind],
      locked ? C.frame : cleared ? C.dim : C.ink,
      C.bg,
    );
    if (g.at === n.id) grid.put(x, y + 1, CREATURES.hero.glyph, C.gold, C.bg);
    hits.add(x - 1, y - 1, 3, 3, { t: "node", id: n.id });
  }

  drawHud(grid, g, rows - HUD_ROWS - BTN_ROWS);
  buttons(grid, hits, [
    { label: `ARMY ${g.army.length}`, act: { t: "army" } },
    { label: "MENU", act: { t: "menu" } },
  ]);
}

function drawHud(grid: Grid, g: GameState, y: number) {
  const cols = grid.cols;
  grid.text(0, y, (g.log[g.log.length - 1] ?? "").slice(0, cols), C.dim);

  let x = 0;
  grid.put(x, y + 1, "♥", C.hot);
  x += 1;
  const hp = `${g.hero.hp}/${g.hero.maxHp}`;
  grid.text(x, y + 1, hp, C.ink);
  x += hp.length + 1;
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
