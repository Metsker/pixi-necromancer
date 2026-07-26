import type { Grid } from "../gfx/grid.ts";
import {
  CREATURES,
  KIND_NAME,
  TUNING,
  type BattleUnit,
  type Force,
  type GameState,
  type Hit,
} from "../sim/data.ts";
import { hpFrac } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, bar, buttons } from "../ui.ts";

const ROW_H = 2; // a name row and a bar row per unit in the roster
const LUNGE = 2; // how far a fighter steps into the middle to land a blow

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function drawBattle(grid: Grid, g: GameState, f: Force, hits: Hits, speed: number) {
  const b = f.battle!;
  const n = g.nodes[b.node];
  const { cols, rows } = grid;
  const last = rows - BTN_ROWS;
  const half = (cols - 1) >> 1; // the divider column; the two blocks flank it
  const rightX = half + 1;
  const rightW = cols - half - 1;

  grid.center(0, 0, cols, KIND_NAME[n.kind], C.gold);
  const beat = b.done
    ? b.done === "win"
      ? "the room is yours"
      : "it is over"
    : `round ${b.round + 1}${f.kind === "hero" ? "" : ", squad"}`;
  grid.center(0, 1, cols, beat, b.done === "win" ? C.green : b.done ? C.red : C.frame);

  const ours = b.units.filter((u) => u.faction === "player");
  const theirs = b.units.filter((u) => u.faction === "enemy");
  const pairs = Math.max(ours.length, theirs.length);

  // Ticks since this blow landed. One unit swings per turn, so the whole beat is
  // the swing: step in, connect, and it is somebody else's turn.
  const age = clamp(TUNING.turnTicks - (f.next - g.time), 0, TUNING.turnTicks);
  const spoils = f.mode === "spoils";
  const swing = spoils ? 0 : age < 1 ? LUNGE : 1;
  const landing = spoils ? [] : b.hit;
  // How far through the beat after the fight, which is when the dead get up
  const rising =
    spoils && g.risen && g.risen.node === b.node
      ? clamp(1 - (f.next - g.time) / TUNING.spoilsTicks, 0, 1)
      : 0;

  // The arena is sized to what stands in it. A taller box would only be a void,
  // so the slack goes to the log, which fills as the fight goes on.
  const ranks = Math.max(
    Math.ceil(ours.length / perRank(cols)),
    Math.ceil(theirs.length / perRank(cols)),
  );
  const head = 3;
  const roster = Math.min(pairs, Math.max(1, Math.floor((last - head - 6) / ROW_H)));
  const fixed = roster * ROW_H + 2;
  const arena = last - head - fixed >= ranks + 5 ? ranks + 3 : 0;

  let y = head;
  if (arena) {
    drawArena(grid, ours, theirs, y, arena, cols, landing, swing);
    if (rising) drawRising(grid, g, y, arena, cols, rising);
    y += arena;
  }
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  for (let i = 0; i < roster; i++) {
    if (ours[i]) side(grid, 0, half, y, ours[i], landing, false);
    if (theirs[i]) side(grid, rightX, rightW, y, theirs[i], landing, true);
    if (ours[i] || theirs[i]) grid.put(half, y, "│", C.frame);
    y += ROW_H;
  }
  if (roster < pairs) grid.center(0, y++, cols, `+${pairs - roster} more`, C.frame);
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  for (const line of b.log.slice(-(last - y))) grid.text(0, y++, line.slice(0, cols), C.dim);

  buttons(grid, hits, [
    { label: speed === 0 ? "║" : `x${speed}`, act: { t: "speed" } },
    { label: "MAP", act: { t: "back" } },
  ]);
}

const perRank = (cols: number) => Math.max(1, Math.floor(((cols >> 1) - 2) / 3));

// Two lines of figures facing off across the middle of a dark room. A fighter
// that swung this round steps in; one that was hit is knocked back a cell, wears
// the blow that did it, and the number floats off it.
function drawArena(
  grid: Grid,
  ours: BattleUnit[],
  theirs: BattleUnit[],
  top: number,
  h: number,
  cols: number,
  landing: Hit[],
  swing: number,
) {
  const mid = cols >> 1;
  const ground = top + h - 1;
  for (let x = 1; x < cols - 1; x++) {
    grid.put(x, top, "▔", C.frame);
    grid.put(x, ground, "▁", C.frame);
  }

  const threw = new Set(landing.map((hit) => hit.by));
  const took = new Map(landing.map((hit) => [hit.id, hit.n]));
  const wide = perRank(cols);

  const line = (list: BattleUnit[], dir: 1 | -1) => {
    list.forEach((u, i) => {
      const rank = Math.floor(i / wide);
      const y = ground - 1 - rank;
      if (y <= top + 1) return;
      const down = u.hp <= 0;
      const hurt = took.get(u.id);
      const step = down ? 0 : threw.has(u.id) ? swing : 0;
      const knocked = !down && hurt !== undefined ? 1 : 0;
      // Rear ranks stand a little further out, so a front line reads as a front line
      const home = mid - dir * (2 + (i % wide) * 3 + rank);
      const x = home + dir * step - dir * knocked;
      const t = CREATURES[u.creature];
      grid.put(x, y, down ? "☠" : t.glyph, down ? C.frame : hurt ? C.hot : COL(t.color), C.bg);
      if (!knocked) return;
      grid.put(x + dir, y, "✕", C.hot, C.bg);
      const num = `${hurt}`;
      grid.text(x - (num.length >> 1), y - 1, num, C.hot, C.bg);
    });
  };
  line(ours, 1);
  line(theirs, -1);
}

// The one thing worth stopping the board for. What he killed climbs back up on
// his side of the room, and the room says whose they are now.
function drawRising(
  grid: Grid,
  g: GameState,
  top: number,
  h: number,
  cols: number,
  progress: number,
) {
  const risen = g.risen!;
  const mid = cols >> 1;
  const ground = top + h - 1;
  const lift = Math.min(h - 2, 1 + Math.floor(progress * 3));
  const tone = progress < 0.7 ? C.green : C.dim;

  risen.creatures.slice(0, 5).forEach((c, i) => {
    const x = mid - 2 - i * 2;
    const y = ground - lift;
    if (y > top && x > 0) grid.put(x, y, CREATURES[c].glyph, tone, C.bg);
  });

  const names = [...new Set(risen.creatures.map((c) => CREATURES[c].short.toUpperCase()))];
  const word = `${names.join(" ")} ${risen.creatures.length > 1 ? "RISE" : "RISES"}`;
  grid.center(0, top + 1, cols, word.slice(0, cols), tone, C.shade);
}

// Names hug the outside edge and blows land against the divider, so damage
// always appears in the middle where the fighting is
function side(
  grid: Grid,
  x: number,
  w: number,
  y: number,
  u: BattleUnit,
  landing: Hit[],
  mirrored: boolean,
) {
  const t = CREATURES[u.creature];
  const struck = landing.find((h) => h.id === u.id);
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
