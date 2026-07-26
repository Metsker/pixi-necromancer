import type { Surface } from "./gfx/surface.ts";
import type { PathId } from "./sim/tree.ts";
import { PALETTE } from "./tilemap.ts";

const p = (i: number) => parseInt(PALETTE[i].slice(1), 16);

export const COL = p;
export const C = {
  bg: p(2),
  shade: p(0),
  frame: p(6),
  dim: p(9),
  mid: p(11),
  ink: p(23),
  pale: p(17),
  gold: p(16),
  red: p(14),
  hot: p(15),
  green: p(21),
  cyan: p(22),
  violet: p(20),
  blue: p(19),
  btn: p(5),
  btnAlt: p(6),
};

export const BTN_ROWS = 2;

// Cells a string takes on the grid. Not s.length: the necromancer's own glyph
// is astral, and counting it as two would push every line it appears on over.
export const cells = (s: string) => [...s].length;
export const cut = (s: string, n: number) => [...s].slice(0, Math.max(0, n)).join("");

export type Act =
  | { t: "none" }
  | { t: "node"; id: number }
  | { t: "close" }
  | { t: "order" }
  | { t: "squad" }
  | { t: "toggle"; id: number }
  | { t: "up"; k: number }
  | { t: "inspect"; id: number }
  | { t: "send" }
  | { t: "menu" }
  | { t: "army" }
  | { t: "restart" }
  | { t: "confirm" }
  | { t: "path"; id: PathId }
  | { t: "tree" }
  | { t: "pick"; id: number }
  | { t: "take"; id: number }
  | { t: "eat" }
  | { t: "mend" }
  | { t: "ok" }
  | { t: "speed" }
  | { t: "sound" }
  | { t: "watch"; id: number }
  | { t: "reap"; id: number }
  | { t: "leave" }
  | { t: "back" };

export type Hit = { x: number; y: number; w: number; h: number; act: Act };

// Zones are recorded by the same pass that draws them, so a hit area cannot
// drift away from the thing it belongs to.
export class Hits {
  list: Hit[] = [];

  clear() {
    this.list = [];
  }

  add(x: number, y: number, w: number, h: number, act: Act) {
    this.list.push({ x, y, w, h, act });
  }

  at(x: number, y: number): Act {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z.act;
    }
    return { t: "none" };
  }
}

export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  // A word wider than the box still has to land somewhere
  return out.flatMap((l) => {
    if (l.length <= width) return [l];
    const parts: string[] = [];
    for (let i = 0; i < l.length; i += width) parts.push(l.slice(i, i + width));
    return parts;
  });
}

// Half-height blocks, so bars on neighbouring rows stay separate bars. Mirrored
// bars fill from the right, so both sides drain towards the middle.
export function bar(
  grid: Surface,
  x: number,
  y: number,
  w: number,
  frac: number,
  on: number,
  mirrored = false,
) {
  const n = frac > 0 ? Math.max(1, Math.round(frac * w)) : 0;
  for (let i = 0; i < w; i++) {
    const full = mirrored ? i >= w - n : i < n;
    grid.put(x + i, y, full ? "▄" : "▁", full ? on : C.frame);
  }
}

export function box(grid: Surface, x: number, y: number, w: number, h: number) {
  grid.fill(x, y, w, h, C.shade);
  for (let i = 1; i < w - 1; i++) {
    grid.put(x + i, y, "─", C.frame);
    grid.put(x + i, y + h - 1, "─", C.frame);
  }
  for (let j = 1; j < h - 1; j++) {
    grid.put(x, y + j, "│", C.frame);
    grid.put(x + w - 1, y + j, "│", C.frame);
  }
  grid.put(x, y, "┌", C.frame);
  grid.put(x + w - 1, y, "┐", C.frame);
  grid.put(x, y + h - 1, "└", C.frame);
  grid.put(x + w - 1, y + h - 1, "┘", C.frame);
}

// `tail` is a second, narrow target at the right end of a line - the arrow that
// moves a unit up the order without stealing the tap that selects it
export type Line = { text: string; act?: Act; fg?: number; tail?: { text: string; act: Act } };

// A line you can tap gets two rows, so a thumb has something to land on
const rowsFor = (l: Line) => (l.act || l.tail ? 2 : 1);

export function sheet(
  grid: Surface,
  hits: Hits,
  title: string,
  lines: Line[],
  minWidth = 0,
): { x: number; y: number; w: number; h: number } {
  const keep = [...lines];
  const room = Math.max(1, grid.rows - 4);
  let body = keep.reduce((n, l) => n + rowsFor(l), 0);
  // Prose is what goes when a sheet will not fit; every button has to stay reachable
  for (let i = keep.length - 1; i >= 0 && body > room; i--) {
    if (keep[i].act) continue;
    body -= rowsFor(keep[i]);
    keep.splice(i, 1);
  }

  const want =
    Math.max(
      minWidth,
      cells(title),
      ...keep.map((l) => cells(l.text) + (l.tail ? cells(l.tail.text) + 1 : 0)),
    ) + 4;
  const w = Math.min(grid.cols, want);
  const h = Math.min(grid.rows, body + 4);
  const x = Math.max(0, (grid.cols - w) >> 1);
  const y = Math.max(0, (grid.rows - h) >> 1);

  box(grid, x, y, w, h);
  grid.center(x + 1, y + 1, w - 2, title, C.gold);
  // Registered before the lines, so a tap on the sheet body is swallowed but a
  // tap on a line still wins: at() searches from the end
  hits.add(x, y, w, h, { t: "none" });

  let ly = y + 3;
  for (const l of keep) {
    const tall = rowsFor(l);
    if (ly + tall > y + h - 1) break;
    const room = w - 3 - (l.tail ? cells(l.tail.text) + 1 : 0);
    grid.text(x + 2, ly, cut(l.text, room), l.fg ?? (l.act ? C.ink : C.dim));
    if (l.act) hits.add(x, ly, w, tall, l.act);
    if (l.tail) {
      const at = x + w - 1 - cells(l.tail.text);
      grid.text(at, ly, l.tail.text, C.gold);
      hits.add(at - 1, ly, cells(l.tail.text) + 2, tall, l.tail.act);
    }
    ly += tall;
  }
  return { x, y, w, h };
}

export function buttons(
  grid: Surface,
  hits: Hits,
  items: { label: string; act: Act; color?: number }[],
) {
  const top = grid.rows - BTN_ROWS;
  const each = Math.floor(grid.cols / items.length);
  items.forEach((b, i) => {
    const x = i * each;
    const w = i === items.length - 1 ? grid.cols - x : each;
    grid.fill(x, top, w, BTN_ROWS, b.color ?? (i % 2 ? C.btnAlt : C.btn));
    grid.center(x, top, w, b.label, C.ink);
    hits.add(x, top, w, BTN_ROWS, b.act);
  });
}
