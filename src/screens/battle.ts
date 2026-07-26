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
import { commandCap, fielded, hpFrac } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, bar, buttons } from "../ui.ts";

const ROW_H = 2; // a name row and a bar row per unit in the roster
const LUNGE = 2; // how far a fighter steps into the middle to land a blow

// How long a blow stays lit, in ticks
const FLASH_TICKS = 1;

// The three beats of getting up: the light finds it, the colour comes back,
// and then it is standing at the end of your line.
const BEAM_UNTIL = 0.3;
const WAKE_UNTIL = 0.6;

type Rise = { ids: Set<number>; beam: boolean; moved: boolean };

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
  // What he has to hand, in the corner, because it is the number you spend
  const slots = `${fielded(g)}/${commandCap(g)}`;
  grid.put(cols - slots.length - 1, 0, "†", C.violet);
  grid.text(cols - slots.length, 0, slots, C.mid);

  const ours = b.units.filter((u) => u.faction === "player");
  const theirs = b.units.filter((u) => u.faction === "enemy");

  // Ticks since this blow landed. One unit swings per turn, so the whole beat is
  // the swing: step in, connect, and it is somebody else's turn.
  const age = clamp(TUNING.turnTicks - (f.next - g.time), 0, TUNING.turnTicks);
  const spoils = f.mode === "spoils";
  const swing = spoils ? 0 : age < 1 ? LUNGE : 1;
  // The white is a flash, not a state: it is gone well before the turn is
  const landing = spoils || age > FLASH_TICKS ? [] : b.hit;
  const mending = spoils || age > FLASH_TICKS ? [] : b.mend;

  // What the room gave him back, held on screen for as long as the board is
  const mended = spoils && b.done === "win" ? b.healed : 0;
  const raised = g.risen;
  let rise: Rise | null = null;
  if (spoils && raised && raised.node === b.node && g.time - raised.at <= TUNING.spoilsTicks) {
    const p = clamp(1 - (f.next - g.time) / TUNING.spoilsTicks, 0, 1);
    rise = { ids: new Set(raised.units), beam: p < BEAM_UNTIL, moved: p >= WAKE_UNTIL };
  }

  // Once they have crossed they are on his side of the board, in the roster too
  const crossed = rise?.moved ? theirs.filter((u) => rise.ids.has(u.id)) : [];
  const ourLine = [...ours, ...crossed];
  const theirLine = rise?.moved ? theirs.filter((u) => !rise.ids.has(u.id)) : theirs;
  const shown = Math.max(ourLine.length, theirLine.length);

  const ranks = Math.max(
    Math.ceil(ourLine.length / perRank(cols)),
    Math.ceil(theirLine.length / perRank(cols)),
  );
  const head = 3;
  const roster = Math.min(shown, Math.max(1, Math.floor((last - head - 6) / ROW_H)));
  const fixed = roster * ROW_H + 2;
  const arena = last - head - fixed >= ranks + 5 ? ranks + 3 : 0;

  let y = head;
  if (arena) {
    drawArena(grid, ourLine, theirLine, y, arena, cols, landing, mending, swing, rise);
    y += arena;
  }
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  for (let i = 0; i < roster; i++) {
    if (ourLine[i]) side(grid, 0, half, y, ourLine[i], landing, mending, false, rise, mended);
    if (theirLine[i]) side(grid, rightX, rightW, y, theirLine[i], landing, mending, true, rise, 0);
    if (ourLine[i] || theirLine[i]) grid.put(half, y, "│", C.frame);
    y += ROW_H;
  }
  if (roster < shown) grid.center(0, y++, cols, `+${shown - roster} more`, C.frame);
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
// that swung this turn steps in; one that was hit is knocked back a cell, wears
// the blow that did it, and the number floats off it. When the fighting stops,
// whatever he raised takes the light and crosses to the end of his line.
function drawArena(
  grid: Grid,
  ours: BattleUnit[],
  theirs: BattleUnit[],
  top: number,
  h: number,
  cols: number,
  landing: Hit[],
  mending: Hit[],
  swing: number,
  rise: Rise | null,
) {
  const mid = cols >> 1;
  const ground = top + h - 1;
  for (let x = 1; x < cols - 1; x++) {
    grid.put(x, top, "▔", C.frame);
    grid.put(x, ground, "▁", C.frame);
  }

  const threw = new Set(landing.map((hit) => hit.by));
  const took = new Map(landing.map((hit) => [hit.id, hit.n]));
  const mended = new Map(mending.map((m) => [m.id, m.n]));
  const wide = perRank(cols);

  const line = (list: BattleUnit[], dir: 1 | -1) => {
    list.forEach((u, i) => {
      const rank = Math.floor(i / wide);
      const y = ground - 1 - rank;
      if (y <= top) return;
      const woken = rise?.ids.has(u.id) === true;
      const down = u.hp <= 0 && !(woken && !rise!.beam);
      const hurt = took.get(u.id);
      const step = down ? 0 : threw.has(u.id) ? swing : 0;
      const knocked = !down && hurt !== undefined ? 1 : 0;
      // Rear ranks stand a little further out, so a front line reads as a front line
      const home = mid - dir * (2 + (i % wide) * 3 + rank);
      const x = home + dir * step - dir * knocked;
      const t = CREATURES[u.creature];
      // His light comes down out of the ceiling and pools on the body. The cell
      // fill and the glyph are separate layers, so the beam sits behind it.
      if (woken && rise!.beam) {
        for (let by = top + 1; by < y; by++) grid.put(x, by, "║", C.violet, C.bg);
        grid.put(x, y, down ? "☠" : t.glyph, C.shade, C.violet);
        return;
      }
      const put = mended.get(u.id);
      grid.put(
        x,
        y,
        down ? "☠" : t.glyph,
        down ? C.frame : hurt ? C.ink : put ? C.green : COL(t.color),
        C.bg,
      );
      if (put) {
        const back = `+${put}`;
        grid.text(x - (back.length >> 1), y - 1, back, C.green, C.bg);
      }
      if (!knocked) return;
      grid.put(x + dir, y, "✕", C.ink, C.bg);
      const num = `${hurt}`;
      grid.text(x - (num.length >> 1), y - 1, num, C.ink, C.bg);
    });
  };
  line(ours, 1);
  line(theirs, -1);
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
  mending: Hit[],
  mirrored: boolean,
  rise: Rise | null,
  mended: number,
) {
  const t = CREATURES[u.creature];
  const struck = landing.find((h) => h.id === u.id);
  const put = mending.find((h) => h.id === u.id);
  const woken = rise?.ids.has(u.id) === true && !rise.beam;
  const down = u.hp <= 0 && !woken;
  const ink = down ? C.frame : C.ink;
  const glyph = down ? "☠" : t.glyph;
  const tone = down ? C.frame : struck ? C.ink : put ? C.green : COL(t.color);

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
    grid.text(mirrored ? x : x + w - hurt.length, y, hurt, C.ink);
  } else if (put) {
    const back = `+${put.n}`;
    grid.text(mirrored ? x : x + w - back.length, y, back, C.green);
  } else if (mended > 0 && u.creature === "hero") {
    const back = `+${mended}`;
    grid.text(mirrored ? x : x + w - back.length, y, back, C.green);
  } else if (u.withered > 0 && !down) {
    grid.put(mirrored ? x : x + w - 1, y, "∿", C.violet);
  }

  // One that has got up is one of yours now, whatever side it fought on
  const ours = u.faction === "player" || woken;
  bar(grid, x, y + 1, w, woken ? 1 : hpFrac(u), ours ? C.green : C.red, mirrored);
}
