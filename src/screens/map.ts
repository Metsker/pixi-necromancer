import type { Grid } from "../gfx/grid.ts";
import {
  HERO_COLOR,
  HERO_GLYPH,
  KINDS,
  MANA_GLYPH,
  OWNER_COLOR,
  RESOURCES,
  RES_IDS,
  TUNING,
  type GameState,
  type MapNode,
  type Point,
} from "../sim/data.ts";
import { bodies, canMove, foeVisible, inSight, movesFor, untilWeek, weekOf } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, buttons, cells } from "../ui.ts";

// The week's mark. A quarter-filled square, because that is what it is.
const WEEK_GLYPH = "◲";

// log, army + moves, mana + week, resources; the button strip sits below it
export const HUD_ROWS = 4;

// One node step in character cells
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
  const at = nodeAt(g.nodes[g.you.at]);
  return clampCam({ x: at.x - (cols >> 1), y: at.y - (viewRows(rows) >> 1) }, cols, rows);
}

export function drawMap(grid: Grid, g: GameState, cam: Point, hits: Hits, picking: boolean) {
  const { cols, rows } = grid;
  const view = viewRows(rows);
  const on = (x: number, y: number) => y >= 0 && y < view && x >= 0 && x < cols;

  // Links first: orthogonal only, so every join is one straight run
  for (const n of g.nodes) {
    const a = nodeAt(n);
    for (const id of n.links) {
      if (id < n.id) continue;
      const b = nodeAt(g.nodes[id]);
      const color = n.seen || g.nodes[id].seen ? C.dim : C.frame;
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

    const here = g.you.at === n.id;
    // Terrain sticks once seen. Who holds it and what stands in it are only live
    // inside sight - outside it the board shows what was true when you last
    // looked, which is why walking somewhere to check is worth a turn.
    const live = inSight(g, n.id);
    const owner = live ? n.owner : n.knownOwner;
    const reach = canMove(g, n.id);
    // The brackets say whether you can act on it, and the seal says whether a key
    // is what is in the way. A door you cannot open is not a door you tap by
    // mistake, so the whole frame goes red until you are carrying one.
    // A seal is a thing you have to have looked at. Reading it off a node nobody
    // has been near tells you what is out there for free.
    const sealed = n.seen && n.sealed;
    const shut = sealed && g.you.res.keys < 1;
    const frame = !n.seen
      ? C.frame
      : shut
        ? C.red
        : picking
          ? owner === "player"
            ? C.gold
            : C.frame
          : reach
            ? C.cyan
            : C.mid;
    if (on(x - 1, y)) grid.put(x - 1, y, sealed ? "[" : "(", frame, C.bg);
    if (on(x + 1, y)) {
      grid.put(x + 1, y, sealed ? RESOURCES.keys.glyph : ")", frame, C.bg);
    }
    if (on(x, y)) {
      // Colour is whose it is and the glyph is what it is. On a board with two
      // armies on it, whose is the thing you have to read first.
      const ink = !n.seen ? C.frame : COL(OWNER_COLOR[owner]);
      grid.put(x, y, n.seen ? KINDS[n.kind].glyph : "?", ink, C.bg);
    }
    // What is standing in it, under it - only on ground you already hold. What
    // guards a node you have not taken is a thing you find out by going.
    const held = live ? n.garrison.length : n.knownGarrison;
    if (owner === "player" && held > 0 && !here && on(x, y + 1)) {
      grid.text(x, y + 1, `${held}`.slice(0, 2), live ? C.mid : C.frame, C.bg);
    }
    // The two tokens. Neither of them fights - a hero is the line behind him.
    if (here && on(x, y + 1)) {
      grid.put(x, y + 1, HERO_GLYPH.player, COL(HERO_COLOR.player), C.bg);
    } else if (g.foe.at === n.id && foeVisible(g) && on(x, y + 1)) {
      grid.put(x, y + 1, HERO_GLYPH.enemy, COL(HERO_COLOR.enemy), C.bg);
    }

    // Clipped to the map area, so a node just off the bottom cannot eat a hud tap
    const top = Math.max(0, y - 1);
    const tall = Math.min(view, y + 2) - top;
    if (tall > 0) {
      hits.add(x - 1, top, 3, tall, picking ? { t: "target", id: n.id } : { t: "node", id: n.id });
    }
  }

  drawHud(grid, g, view);
  if (picking) {
    buttons(grid, hits, [{ label: "CANCEL", act: { t: "close" }, color: C.btnAlt }]);
    return;
  }
  buttons(grid, hits, [
    { label: `ARMY ${bodies(g.you)}`, act: { t: "army" } },
    { label: `BOOK ${g.you.mana}`, act: { t: "spells" } },
    { label: `END ${g.you.moves}`, act: { t: "endturn" }, color: g.you.moves > 0 ? C.btnAlt : C.btn },
    { label: "MENU", act: { t: "menu" } },
  ]);
}

function drawHud(grid: Grid, g: GameState, y: number) {
  const cols = grid.cols;
  grid.text(0, y, (g.log[g.log.length - 1] ?? "").slice(0, cols), C.dim);

  // What the army has left, as one number, because it is the health bar now
  const troop = g.you.reserve;
  const hp = `${troop.reduce((s, u) => s + u.hp, 0)}/${troop.reduce((s, u) => s + u.maxHp, 0)}`;
  let x = 0;
  grid.put(x, y + 1, "♥", C.hot);
  grid.text(x + 1, y + 1, hp, C.ink);
  x += cells(hp) + 2;
  grid.put(x, y + 1, "†", C.violet);
  grid.text(x + 1, y + 1, `${troop.length}/${TUNING.slots}`, C.ink);

  // Ground left this turn, at the end of its own row - it is the number every
  // decision on the map is actually against
  const legs = `►${g.you.moves}/${movesFor(g.you)}`;
  grid.text(Math.max(x + 6, cols - cells(legs)), y + 1, legs, g.you.moves > 0 ? C.green : C.red);

  const pool = `${g.you.mana}/${TUNING.manaCap}`;
  grid.put(0, y + 2, MANA_GLYPH, C.cyan);
  grid.text(1, y + 2, pool, C.ink);

  // The week rides the end of the mana row rather than taking a line of its own,
  // and goes gold on the turn before everything anybody holds pays out
  const due = untilWeek(g);
  const week = `${WEEK_GLYPH}${weekOf(g.turn) + 1}:${TUNING.weekTurns - due + 1}/${TUNING.weekTurns}`;
  grid.text(Math.max(cells(pool) + 2, cols - cells(week)), y + 2, week, due > 1 ? C.dim : C.gold);

  x = 0;
  for (const r of RES_IDS) {
    const info = RESOURCES[r];
    grid.put(x, y + 3, info.glyph, COL(info.color));
    const n = `${g.you.res[r]}`;
    grid.text(x + 1, y + 3, n, C.mid);
    x += cells(n) + 2;
  }
  // What either side holds, so the race is readable without counting the board
  const mine = g.nodes.filter((n) => n.owner === "player").length;
  const theirs = g.nodes.filter((n) => n.owner === "enemy").length;
  const score = `${mine}v${theirs}`;
  grid.text(Math.max(x, cols - cells(score)), y + 3, score, mine >= theirs ? C.cyan : C.gold);
}
