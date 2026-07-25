import type { Grid } from "../gfx/grid.ts";
import { CREATURES, KIND_NAME, type BattleUnit, type GameState } from "../sim/data.ts";
import { hpFrac } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, bar, buttons } from "../ui.ts";

const NAME_W = 7;
const BAR_X = 10;

export function drawBattle(grid: Grid, g: GameState, ui: { speed: number }, hits: Hits) {
  const b = g.battle!;
  const n = g.nodes[b.node];
  const { cols, rows } = grid;
  const last = rows - BTN_ROWS;

  grid.center(0, 0, cols, KIND_NAME[n.kind], C.gold);
  let y = 1;
  const rule = () => {
    for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
    y += 1;
  };
  rule();

  // The fallen stay on the board: the line count must not jump around mid-fight,
  // and what a room cost you should still be readable when it ends
  const side = (f: BattleUnit["faction"]) => b.units.filter((u) => u.faction === f);
  for (const u of side("enemy")) {
    if (y >= last - 4) break;
    unitRow(grid, y++, u, b.hit.includes(u.id), cols);
  }
  rule();
  for (const u of side("player")) {
    if (y >= last - 3) break;
    unitRow(grid, y++, u, b.hit.includes(u.id), cols);
  }
  rule();

  const room = last - y;
  for (const line of b.log.slice(-room)) grid.text(0, y++, line.slice(0, cols), C.dim);

  if (b.done) {
    buttons(grid, hits, [
      { label: b.done === "win" ? "THE ROOM IS YOURS" : "IT IS OVER", act: { t: "resolve" } },
    ]);
    return;
  }
  buttons(grid, hits, [
    { label: `SPEED x${ui.speed}`, act: { t: "speed" } },
    { label: "SKIP", act: { t: "skip" } },
  ]);
}

function unitRow(grid: Grid, y: number, u: BattleUnit, hit: boolean, cols: number) {
  const t = CREATURES[u.creature];
  const down = u.hp <= 0;
  const ink = down ? C.frame : hit ? C.hot : C.ink;
  grid.put(0, y, down ? "☠" : t.glyph, down ? C.frame : hit ? C.hot : COL(t.color));
  grid.text(2, y, t.short.slice(0, NAME_W), ink);
  if (u.withered > 0 && !down) grid.put(BAR_X - 1, y, "∿", C.violet);
  bar(grid, BAR_X, y, Math.max(4, cols - BAR_X), hpFrac(u), u.faction === "player" ? C.green : C.red);
}
