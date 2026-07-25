import type { Grid } from "../gfx/grid.ts";
import { CREATURES, KIND_NAME, type BattleUnit, type Force, type GameState } from "../sim/data.ts";
import { hpFrac } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, bar, buttons } from "../ui.ts";

const ROW_H = 2; // a name row and a bar row per unit

export function drawBattle(grid: Grid, g: GameState, f: Force, hits: Hits, speed: number) {
  const b = f.battle!;
  const n = g.nodes[b.node];
  const { cols, rows } = grid;
  const last = rows - BTN_ROWS;
  const half = (cols - 1) >> 1; // the divider column; the two blocks flank it
  const rightX = half + 1;
  const rightW = cols - half - 1;

  grid.center(0, 0, cols, KIND_NAME[n.kind], C.gold);
  grid.center(
    0,
    1,
    cols,
    f.kind === "hero" ? `round ${b.round}` : `squad, round ${b.round}`,
    C.frame,
  );

  const ours = b.units.filter((u) => u.faction === "player");
  const theirs = b.units.filter((u) => u.faction === "enemy");
  const pairs = Math.max(ours.length, theirs.length);
  const top = 3;
  const fits = Math.max(1, Math.floor((last - top - 2) / ROW_H));
  const shown = Math.min(pairs, fits);

  // The line down the middle is where the two sides meet
  for (let i = 0; i < shown * ROW_H; i++) grid.put(half, top + i, "│", C.frame);

  for (let i = 0; i < shown; i++) {
    const y = top + i * ROW_H;
    if (ours[i]) side(grid, 0, half, y, ours[i], b.hit, false);
    if (theirs[i]) side(grid, rightX, rightW, y, theirs[i], b.hit, true);
  }

  let y = top + shown * ROW_H;
  if (shown < pairs) grid.center(0, y++, cols, `+${pairs - shown} more`, C.frame);
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  for (const line of b.log.slice(-(last - y))) grid.text(0, y++, line.slice(0, cols), C.dim);

  buttons(grid, hits, [
    { label: speed === 0 ? "║" : `x${speed}`, act: { t: "speed" } },
    { label: "MAP", act: { t: "back" } },
  ]);
}

// Names hug the outside edge and blows land against the divider, so damage
// always appears in the middle where the fighting is
function side(
  grid: Grid,
  x: number,
  w: number,
  y: number,
  u: BattleUnit,
  hits: { id: number; n: number }[],
  mirrored: boolean,
) {
  const t = CREATURES[u.creature];
  const struck = hits.find((h) => h.id === u.id);
  const down = u.hp <= 0;
  const ink = down ? C.frame : struck ? C.hot : C.ink;
  const glyph = down ? "☠" : t.glyph;
  const tone = down ? C.frame : struck ? C.hot : COL(t.color);

  const name = t.short.slice(0, Math.max(1, w - 2));
  if (mirrored) {
    grid.text(x + w - name.length - 2, y, name, ink);
    grid.put(x + w - 1, y, glyph, tone);
  } else {
    grid.put(x, y, glyph, tone);
    grid.text(x + 2, y, name, ink);
  }

  if (struck) {
    const hurt = `-${struck.n}`;
    grid.text(mirrored ? x : x + w - hurt.length, y, hurt, C.hot);
  } else if (u.withered > 0 && !down) {
    grid.put(mirrored ? x : x + w - 1, y, "∿", C.violet);
  }

  bar(grid, x, y + 1, w, hpFrac(u), u.faction === "player" ? C.green : C.red, mirrored);
}
