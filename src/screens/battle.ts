import { inset, type Surface } from "../gfx/surface.ts";
import {
  CREATURES,
  DOWN_GLYPH,
  KINDS,
  MANA_GLYPH,
  TAUNT_GLYPH,
  TUNING,
  type BattleUnit,
  type GameState,
  type Hit,
} from "../sim/data.ts";
import {
  canSell,
  commandCap,
  fell,
  fielded,
  held,
  hpFrac,
  manaCap,
  manaCost,
  mendable,
  offered,
  perks,
  raiseAs,
  roomFor,
  wallish,
} from "../sim/game.ts";
import type { Perks } from "../sim/tree.ts";
import { BTN_ROWS, C, COL, Hits, bar, buttons, cells, cut } from "../ui.ts";

const ROW_H = 2; // a name row and a bar row per unit in the roster
const LUNGE = 2; // how far a fighter steps into the middle to land a blow
const BOARD = 44; // the widest the board gets, so a desk monitor does not stretch it
// Cells a figure takes in the arena. Two, so a whole line stands on one row at
// any width worth playing on - the two lines are the picture.
const FIGURE_W = 2;

// How long a blow stays lit, in ticks, and how long a mend does. A blow is a
// flash; a mend is worth looking at.
const FLASH_TICKS = 1;
const MEND_TICKS = 3;

// The three beats of getting up, in the arena: the light finds it, the colour
// comes back, and then it walks to the end of your line. The roster does not
// wait for any of it - see `answered` below.
const BEAM_UNTIL = 0.3;
const WAKE_UNTIL = 0.6;

type Rise = { ids: Set<number>; beam: boolean; moved: boolean };

// How a body is drawn right now: lit from above and still dead, or up
type Look = { beam: (u: BattleUnit) => boolean; woken: (u: BattleUnit) => boolean };

// What a body on the far side is worth doing something about: nothing, or it is
// on offer at a price he cannot pay, or he can
type Bid = (u: BattleUnit) => 0 | 1 | 2;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function drawBattle(full: Surface, g: GameState, hits: Hits, speed: number) {
  const b = g.battle!;
  const n = g.nodes[b.node];
  const P = perks(g);
  const rows = full.rows;
  // Held together in the middle of a wide screen, rather than pulled apart by it
  const cols = Math.min(full.cols, BOARD);
  const at = (full.cols - cols) >> 1;
  const grid = cols === full.cols ? full : inset(full, at, cols);
  const last = rows - BTN_ROWS;
  const half = (cols - 1) >> 1; // the divider column; the two blocks flank it
  const rightX = half + 1;
  const rightW = cols - half - 1;

  // The two numbers you spend, in the corner: bodies you can hold, and what you
  // have left to ask one back with. The headings centre in what is left over,
  // so a narrow phone never writes one on top of the other.
  const slots = `${fielded(g)}/${commandCap(g)}`;
  grid.put(cols - slots.length - 1, 0, "†", C.violet);
  grid.text(cols - slots.length, 0, slots, C.mid);
  const pool = `${g.mana}/${manaCap(g)}`;
  grid.put(cols - pool.length - 1, 1, MANA_GLYPH, C.cyan);
  grid.text(cols - pool.length, 1, pool, C.mid);

  // The room says what kind of room it is, in its own colour, the same as it
  // does on the map - a fight opens where you tapped, and it says so
  grid.center(0, 0, cols - slots.length - 2, KINDS[n.kind].name, COL(KINDS[n.kind].color));
  const beat = b.done ? (b.done === "win" ? "it is yours" : "it is over") : `round ${b.round + 1}`;
  grid.center(0, 1, cols - pool.length - 2, beat, b.done === "win" ? C.green : b.done ? C.red : C.frame);

  const ours = b.units.filter((u) => u.faction === "player");
  const theirs = b.units.filter((u) => u.faction === "enemy");
  // Bodies out of this room that answered, however they were asked
  const taken = new Set(b.taken);

  // Ticks since this blow landed. One unit swings per turn, so the whole beat is
  // the swing: step in, connect, and it is somebody else's turn.
  const age = clamp(TUNING.turnTicks - (g.next - g.time), 0, TUNING.turnTicks);
  const spoils = g.mode === "spoils";
  const swing = spoils ? 0 : age < 1 ? LUNGE : 1;
  // The white is a flash, not a state: it is gone well before the turn is
  const landing = spoils || age > FLASH_TICKS ? [] : b.hit;
  const mending = spoils || age > MEND_TICKS ? [] : b.mend;

  // Getting up runs on its own clock: the board waits for you, but a body that
  // has just been asked has three beats to get through whether you wait or not
  const raised = g.risen;
  let rise: Rise | null = null;
  if (raised && raised.node === b.node && g.time - raised.at <= TUNING.riseTicks) {
    const p = clamp((g.time - raised.at) / TUNING.riseTicks, 0, 1);
    rise = { ids: new Set(raised.units), beam: p < BEAM_UNTIL, moved: p >= WAKE_UNTIL };
  }
  const rising = (u: BattleUnit) => rise !== null && rise.ids.has(u.id);
  // Lit and still grey, its colour back, and standing in the line: the three
  // beats, and the arena is the only place they are worth watching
  const look: Look = {
    beam: (u) => rising(u) && rise!.beam,
    woken: (u) => taken.has(u.id) && !(rising(u) && rise!.beam),
  };
  const crossedOver = (u: BattleUnit) => taken.has(u.id) && (!rising(u) || rise!.moved);

  // The figures walk across on their own clock. The roster does not: a body you
  // have paid for is yours on that frame, and a health bar of yours has no
  // business sitting in their column while an animation finishes.
  const answered = (u: BattleUnit) => taken.has(u.id);
  const rosterLook: Look = { beam: () => false, woken: answered };

  // Where a raise actually lands, on both clocks: at the end of your line
  const ourLine = [...ours, ...theirs.filter(crossedOver)];
  const theirLine = theirs.filter((u) => !crossedOver(u));
  const ourRows = [...ours, ...theirs.filter(answered)];
  const theirRows = theirs.filter((u) => !answered(u));
  const shown = Math.max(ourRows.length, theirRows.length);

  // A body you are standing over is yours to ask for, at a price, until you leave
  const holding = held(g) !== null;
  const open = new Set(holding ? offered(g, b).map((u) => u.id) : []);
  // A slot is asked for whole: what it costs is what all of it costs, and all of
  // it lands in one slot - so the only room it needs is room for its kind
  const price = (u: BattleUnit) => manaCost(g, u.creature) * fell(u);
  const bid: Bid = (u) =>
    !open.has(u.id) ? 0 : g.mana >= price(u) && roomFor(g, raiseAs(P, u.creature)) ? 2 : 1;
  const tap = (u: BattleUnit, x: number, y: number) => {
    if (bid(u)) hits.add(at + x - 1, y, 3, 2, { t: "reap", id: u.id });
  };
  // ...and a body of yours is one you can give back to the pool, for a slot you
  // would rather put something else in
  const sellable = (u: BattleUnit) => u.faction === "player" && canSell(g, u.src);

  const wide = perRow(cols);
  const ranks = Math.max(Math.ceil(ourLine.length / wide), Math.ceil(theirLine.length / wide));
  const head = 3;
  // The arena is what you opened the fight to watch, so it is served first and
  // a long line does not squeeze it off the screen. The roster takes what is
  // left over and says how many it could not fit; the log takes what is left
  // after that, which is often nothing, and nothing is the right thing to lose.
  const wants = ranks + 3;
  const arena = last - head - (ROW_H + 3) >= wants ? wants : 0;
  // Two rules, plus a row for "+n more" whenever the roster cannot show it all
  const spare = last - head - arena - 2;
  let roster = Math.min(shown, Math.max(1, Math.floor(spare / ROW_H)));
  if (roster < shown && roster * ROW_H + 1 > spare) roster -= 1;
  roster = Math.max(1, roster);

  let y = head;
  if (arena) {
    drawArena(grid, ourLine, theirLine, y, arena, cols, landing, mending, swing, look, bid, tap, P);
    y += arena;
  }
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  for (let i = 0; i < roster; i++) {
    const mine = ourRows[i];
    if (mine) {
      const give = sellable(mine) ? TUNING.sellMana : 0;
      side(grid, 0, half, y, mine, landing, mending, false, rosterLook, give ? 1 : 0, give, P);
      if (give) hits.add(at, y, half, ROW_H, { t: "sell", id: mine.src });
    }
    if (theirRows[i]) {
      const u = theirRows[i];
      side(grid, rightX, rightW, y, u, landing, mending, true, rosterLook, bid(u), price(u), P);
      if (bid(u)) hits.add(at + rightX, y, rightW, ROW_H, { t: "reap", id: u.id });
    }
    if (mine || theirRows[i]) grid.put(half, y, "│", C.frame);
    y += ROW_H;
  }
  if (roster < shown) grid.center(0, y++, cols, `+${shown - roster} more`, C.frame);
  for (let x = 0; x < cols; x++) grid.put(x, y, "─", C.frame);
  y += 1;

  // Whatever rows are left, and there may be none: slice(-0) is the whole log,
  // which would write it over the button strip
  const tail = Math.max(0, last - y);
  for (const line of tail ? b.log.slice(-tail) : []) grid.text(0, y++, line.slice(0, cols), C.dim);

  // The strip stays the width of the screen: it is what a thumb reaches for.
  // Nothing else ends a room you have taken, so the way out is a button.
  buttons(full, hits, [
    { label: speed === 0 ? "║" : `x${speed}`, act: { t: "speed" } },
    ...(holding && mendable(g) ? [{ label: "MEND", act: { t: "mend" as const } }] : []),
    holding ? { label: "LEAVE", act: { t: "leave" } } : { label: "MAP", act: { t: "back" } },
  ]);
}

// How many figures stand on one row of the arena, per side. Two cells each, so
// a full line and a full room both fit on one row at any playable width; the
// wrap below it only ever fires on a phone narrower than the game asks for.
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
  bid: Bid,
  tap: (u: BattleUnit, x: number, y: number) => void,
  P: Perks,
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
      // One you could still ask for is worth pointing at; one you cannot afford
      // lies there like any other body
      const offer = bid(u);
      tap(u, x, y);
      grid.put(
        x,
        y,
        down ? DOWN_GLYPH : t.glyph,
        offer === 2 ? C.cyan : down ? C.frame : hurt ? C.ink : put ? C.green : COL(t.color),
        C.bg,
      );
      // A wall wears its own mark above it, because which of them is standing is
      // the only thing that decides where the next blow goes
      if (!down && wallish(u, P)) grid.put(x, y - 1, TAUNT_GLYPH, C.blue, C.bg);
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
  grid: Surface,
  x: number,
  w: number,
  y: number,
  u: BattleUnit,
  landing: Hit[],
  mending: Hit[],
  mirrored: boolean,
  look: Look,
  offer: 0 | 1 | 2,
  price: number,
  P: Perks,
) {
  const t = CREATURES[u.creature];
  const struck = landing.find((h) => h.id === u.id);
  const put = mending.find((h) => h.id === u.id);
  const woken = look.woken(u);
  const down = u.hp <= 0 && !woken;
  const ink = down ? C.frame : C.ink;
  const glyph = down ? DOWN_GLYPH : t.glyph;
  const tone =
    offer === 2 ? C.cyan : down ? C.frame : struck ? C.ink : put ? C.green : COL(t.color);

  // What goes against the divider: what the blow was, what it would cost to ask
  // this one back, what giving it up pays, or what is on it. Unmaking is red -
  // it reads as a price on the wrong side of the line, because that is what it
  // is. Worked out before the name, because the name is what yields when the
  // two cannot both fit, and a slot's depth is the last thing to lose.
  let mark = "";
  let marked = C.frame;
  if (struck) [mark, marked] = [`-${struck.n}`, C.ink];
  else if (put) [mark, marked] = [`+${put.n}`, C.green];
  else if (offer && mirrored) [mark, marked] = [`${MANA_GLYPH}${price}`, offer === 2 ? C.cyan : C.frame];
  else if (offer) [mark, marked] = [`${MANA_GLYPH}+${price}`, C.red];
  else if (u.withered > 0 && !down) [mark, marked] = ["∿", C.violet];
  else if (!down && wallish(u, P)) [mark, marked] = [TAUNT_GLYPH, C.blue];

  // A slot says how deep it is next to its own name, because that number is
  // both what it hits for and what falls with it
  const count = down ? fell(u) : u.n;
  const full = count > 1 ? `${t.short} x${count}` : t.short;
  const name = cut(full, Math.max(1, w - 2 - (mark ? cells(mark) + 1 : 0)));
  if (mirrored) {
    grid.text(x + w - cells(name) - 2, y, name, ink);
    grid.put(x + w - 1, y, glyph, tone);
  } else {
    grid.put(x, y, glyph, tone);
    grid.text(x + 2, y, name, ink);
  }
  if (mark) grid.text(mirrored ? x : x + w - cells(mark), y, mark, marked);

  // One that has got up is one of yours now, whatever side it fought on
  const ours = u.faction === "player" || woken;
  bar(grid, x, y + 1, w, woken ? 1 : hpFrac(u), ours ? C.green : C.red, mirrored);
}
