import { inset, type Surface } from "../gfx/surface.ts";
import {
  CREATURES,
  DOWN_GLYPH,
  FAMILY_COLOR,
  KINDS,
  MANA_GLYPH,
  OWNER_COLOR,
  SPELLS,
  TAUNT_GLYPH,
  TUNING,
  type BattleUnit,
  type GameState,
  type Hit,
  type SpellId,
} from "../sim/data.ts";
import { canCast, fell, hpFrac, readyFrac, spellCost, spellsOf } from "../sim/game.ts";
import { BTN_ROWS, C, COL, Hits, bar, buttons, cells, cut } from "../ui.ts";

const ROW_H = 3; // a name row, a health row and a wind-up row per slot
const LUNGE = 2; // how far a fighter steps into the middle to land a blow
const BOARD = 44; // the widest the board gets, so a desk monitor does not stretch it
// Cells a figure takes in the arena. Two, so a whole line stands on one row at
// any width worth playing on - the two lines are the picture.
const FIGURE_W = 2;

// How long a blow stays lit, in ticks, and how long a mending does. A blow is a
// flash; putting something back together is worth looking at.
const FLASH_TICKS = 1;
const MEND_TICKS = 3;

// Ticks the three beats of getting up take: the light finds it, its colour comes
// back, and then it walks to the end of your line.
export const RISE_TICKS = 24;
const BEAM_UNTIL = 0.3;
const WAKE_UNTIL = 0.6;

type Rise = { ids: Set<number>; beam: boolean; moved: boolean };
type Look = { beam: (u: BattleUnit) => boolean; woken: (u: BattleUnit) => boolean };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const wall = (u: BattleUnit) => CREATURES[u.creature].taunt;
const tone = (u: BattleUnit) => COL(FAMILY_COLOR[CREATURES[u.creature].family]);

export function drawBattle(full: Surface, g: GameState, hits: Hits, speed: number) {
  const b = g.battle!;
  const n = g.nodes[b.node];
  const rows = full.rows;
  // Held together in the middle of a wide screen, rather than pulled apart by it
  const cols = Math.min(full.cols, BOARD);
  const at = (full.cols - cols) >> 1;
  const grid = cols === full.cols ? full : inset(full, at, cols);
  const last = rows - BTN_ROWS;
  const half = (cols - 1) >> 1; // the divider column; the two blocks flank it
  const rightX = half + 1;
  const rightW = cols - half - 1;

  const pool = `${g.you.mana}/${TUNING.manaCap}`;
  grid.put(cols - cells(pool) - 1, 1, MANA_GLYPH, C.cyan);
  grid.text(cols - cells(pool), 1, pool, C.mid);

  // What you walked into, in the colour of whoever holds it - the same as it
  // reads on the map, because a fight opens where you tapped
  grid.center(0, 0, cols, KINDS[n.kind].name, COL(OWNER_COLOR[n.owner]));
  const beat = b.done ? (b.done === "win" ? "it is yours" : "it is over") : `round ${b.round + 1}`;
  grid.center(0, 1, cols - cells(pool) - 2, beat, b.done === "win" ? C.green : b.done ? C.red : C.frame);

  const ours = b.units.filter((u) => u.faction === "player");
  const theirs = b.units.filter((u) => u.faction === "enemy");

  // Ticks since this blow landed. The gap to the next one is whatever the speeds
  // on the board make it, so the blow says when it landed rather than the view
  // working it back out of a fixed turn length.
  const age = Math.max(0, g.view - b.at);
  const spoils = g.phase === "spoils";
  const swing = spoils ? 0 : age < 1 ? LUNGE : 1;
  const landing = spoils || age > FLASH_TICKS ? [] : b.hit;
  const mending = spoils || age > MEND_TICKS ? [] : b.mend;

  // Getting up runs on its own clock: the board waits for you, but a body that
  // has just been asked has three beats to get through whether you wait or not
  const raised = g.risen;
  const taken = new Set(raised && raised.node === b.node ? raised.units : []);
  let rise: Rise | null = null;
  if (raised && raised.node === b.node && g.view - raised.at <= RISE_TICKS) {
    const p = clamp((g.view - raised.at) / RISE_TICKS, 0, 1);
    rise = { ids: new Set(raised.units), beam: p < BEAM_UNTIL, moved: p >= WAKE_UNTIL };
  }
  const rising = (u: BattleUnit) => rise !== null && rise.ids.has(u.id);
  const look: Look = {
    beam: (u) => rising(u) && rise!.beam,
    woken: (u) => taken.has(u.id) && !(rising(u) && rise!.beam),
  };
  const crossedOver = (u: BattleUnit) => taken.has(u.id) && (!rising(u) || rise!.moved);
  const rosterLook: Look = { beam: () => false, woken: crossedOver };

  // Where a raise actually lands: in a row you already hold, not beside it -
  // `join` deepens the roster, so the board has to say the same thing.
  const ourLine: BattleUnit[] = [];
  for (const u of [...ours, ...theirs.filter(crossedOver)]) {
    // A crossed body is dead, so its living count is nothing - what walked in is
    // what gets up, and that is the number the row has to grow by
    const many = taken.has(u.id) ? fell(u) : u.n;
    const into = ourLine.find((o) => o.creature === u.creature && (o.hp > 0 || taken.has(o.id)));
    if (!into) ourLine.push({ ...u, n: many });
    else {
      into.n += many;
      into.hp += many * into.each;
      into.maxHp += many * into.each;
    }
  }
  const theirLine = theirs.filter((u) => !crossedOver(u));
  const shown = Math.max(ourLine.length, theirLine.length);

  // Nothing is winding up once the fight is over, and a body on the floor is not
  // waiting for anything
  const wind = (u: BattleUnit) => (b.done || u.hp <= 0 ? 0 : readyFrac(b, u, g.view));

  const wide = perRow(cols);
  const ranks = Math.max(Math.ceil(ourLine.length / wide), Math.ceil(theirLine.length / wide));
  const head = 3;
  // The arena is what you opened the fight to watch, so it is served first and a
  // long line does not squeeze it off the screen. The roster takes what is left,
  // and the log takes what is left after that - often nothing, which is the
  // right thing to lose.
  const wants = ranks + 3;
  const arena = last - head - (ROW_H + 3) >= wants ? wants : 0;
  const spare = last - head - arena - 2;
  let roster = Math.min(shown, Math.max(1, Math.floor(spare / ROW_H)));
  if (roster < shown && roster * ROW_H + 1 > spare) roster -= 1;
  roster = Math.max(1, roster);

  let y = head;
  if (arena) {
    drawArena(grid, ourLine, theirLine, y, arena, cols, landing, mending, swing, look);
    y += arena;
  }
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  for (let i = 0; i < roster; i++) {
    if (ourLine[i]) side(grid, 0, half, y, ourLine[i], landing, mending, false, rosterLook, wind(ourLine[i]));
    if (theirLine[i]) side(grid, rightX, rightW, y, theirLine[i], landing, mending, true, rosterLook, wind(theirLine[i]));
    if (ourLine[i] || theirLine[i]) grid.put(half, y, "│", C.frame);
    y += ROW_H;
  }
  if (roster < shown) grid.center(0, y++, cols, `+${shown - roster} more`, C.frame);
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  // Whatever rows are left, and there may be none: slice(-0) is the whole log,
  // which would write it over the button strip
  const tail = Math.max(0, last - y);
  for (const line of tail ? b.log.slice(-tail) : []) grid.text(0, y++, line.slice(0, cols), C.dim);

  // The post-fight window, as one button. What it says depends on the family
  // behind the hero, and it is only ever up while the board is being held.
  const post = spellsOf(g.you.family).find((s) => SPELLS[s].window === "post")!;
  const pre = spellsOf(g.you.family).find((s) => SPELLS[s].window === "pre")!;
  const open: SpellId | null = canCast(g, "player", post)
    ? post
    : canCast(g, "player", pre)
      ? pre
      : null;
  buttons(full, hits, [
    { label: speed === 0 ? "║" : `x${speed}`, act: { t: "speed" } },
    ...(open
      ? [{
          label: `${SPELLS[open].name.split(" ")[0]} ${MANA_GLYPH}${spellCost(g, open)}`,
          act: { t: "cast" as const, id: open },
          color: C.btnAlt,
        }]
      : []),
    spoils ? { label: "LEAVE", act: { t: "leave" } } : { label: "MAP", act: { t: "back" } },
  ]);
}

// How many figures stand on one row of the arena, per side. Two cells each, so a
// full line fits on one row at any playable width; the wrap below it only ever
// fires on a phone narrower than the game asks for.
const perRow = (cols: number) => Math.max(1, Math.floor(((cols >> 1) - 1) / FIGURE_W));

// Two lines of figures facing off across the middle of a dark room. A fighter
// that swung this turn steps in; one that was hit is knocked back a cell, wears
// the blow that did it, and the number floats off it. When the fighting stops,
// whatever got up takes the light and crosses to the end of your line.
function drawArena(
  grid: Surface,
  ours: BattleUnit[],
  theirs: BattleUnit[],
  top: number,
  h: number,
  cols: number,
  landing: Hit[],
  mending: Hit[],
  swing: number,
  look: Look,
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
  const wide = perRow(cols);

  const line = (list: BattleUnit[], dir: 1 | -1) => {
    list.forEach((u, i) => {
      const rank = Math.floor(i / wide);
      const y = ground - 1 - rank;
      if (y <= top) return;
      const down = u.hp <= 0 && !look.woken(u);
      const hurt = took.get(u.id);
      const step = down ? 0 : threw.has(u.id) ? swing : 0;
      const knocked = !down && hurt !== undefined ? 1 : 0;
      const home = mid - dir * (2 + (i % wide) * FIGURE_W);
      const x = home + dir * step - dir * knocked;
      const t = CREATURES[u.creature];
      // The light comes down out of the ceiling and pools on the body. The cell
      // fill and the glyph are separate layers, so the beam sits behind it.
      if (look.beam(u)) {
        for (let by = top + 1; by < y; by++) grid.put(x, by, "║", C.violet, C.bg);
        grid.put(x, y, down ? DOWN_GLYPH : t.glyph, C.shade, C.violet);
        return;
      }
      const put = mended.get(u.id);
      grid.put(
        x,
        y,
        down ? DOWN_GLYPH : t.glyph,
        down ? C.frame : hurt ? C.ink : put ? C.green : tone(u),
        C.bg,
      );
      // A wall wears its own mark above it, because which of them is standing is
      // the only thing that decides where the next blow goes
      if (!down && wall(u)) grid.put(x, y - 1, TAUNT_GLYPH, C.blue, C.bg);
      if (put) {
        const back = `+${put}`;
        grid.text(x - (cells(back) >> 1), y - 1, back, C.green, C.bg);
      }
      if (!knocked) return;
      grid.put(x + dir, y, "✕", C.ink, C.bg);
      const num = `${hurt}`;
      grid.text(x - (cells(num) >> 1), y - 1, num, C.ink, C.bg);
    });
  };
  line(ours, 1);
  line(theirs, -1);
}

// Names hug the outside edge and blows land against the divider, so damage
// always appears in the middle where the fighting is
function side(
  grid: Surface,
  x: number,
  w: number,
  y: number,
  u: BattleUnit,
  landing: Hit[],
  mending: Hit[],
  mirrored: boolean,
  look: Look,
  wind: number,
) {
  const t = CREATURES[u.creature];
  const struck = landing.find((h) => h.id === u.id);
  const put = mending.find((h) => h.id === u.id);
  const woken = look.woken(u);
  const down = u.hp <= 0 && !woken;
  const ink = down ? C.frame : C.ink;
  const glyph = down ? DOWN_GLYPH : t.glyph;
  const colour = down ? C.frame : struck ? C.ink : put ? C.green : tone(u);

  // What goes against the divider: what the blow was, what was put back, or what
  // is on it. Worked out before the name, because the name is what yields when
  // the two cannot both fit and a slot's depth is the last thing to lose.
  let mark = "";
  let marked = C.frame;
  if (struck) [mark, marked] = [`-${struck.n}`, C.ink];
  else if (put) [mark, marked] = [`+${put.n}`, C.green];
  else if (u.withered > 0 && !down) [mark, marked] = ["∿", C.violet];
  else if (!down && wall(u)) [mark, marked] = [TAUNT_GLYPH, C.blue];

  // A slot says how deep it is next to its own name, because that number is both
  // what it hits for and what falls with it
  const count = down ? fell(u) : u.n;
  const full = count > 1 ? `${t.short} x${count}` : t.short;
  const name = cut(full, Math.max(1, w - 2 - (mark ? cells(mark) + 1 : 0)));
  if (mirrored) {
    grid.text(x + w - cells(name) - 2, y, name, ink);
    grid.put(x + w - 1, y, glyph, colour);
  } else {
    grid.put(x, y, glyph, colour);
    grid.text(x + 2, y, name, ink);
  }
  if (mark) grid.text(mirrored ? x : x + w - cells(mark), y, mark, marked);

  // One that has got up is one of yours now, whatever side it fought on
  const mine = u.faction === "player" || woken;
  bar(grid, x, y + 1, w, woken ? 1 : hpFrac(u), mine ? C.green : C.red, mirrored);
  // Under the health, how close it is to swinging - so the roster says who is
  // about to land a blow, not only how much of them is left
  bar(grid, x, y + 2, w, wind, C.blue, mirrored);
}
