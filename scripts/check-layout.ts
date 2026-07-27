// Run: node scripts/check-layout.ts
import { MAX_COLS, MIN_COLS, MIN_ROWS, TARGET_TILE_CSS, computeLayout } from "../src/layout.ts";
import { HUD_ROWS, clampCam, mapSize, viewRows } from "../src/screens/map.ts";
import { PANELS, SHEET_COLS, panelSpec, type Ui } from "../src/screens/panels.ts";
import { drawBattle } from "../src/screens/battle.ts";
import { LORE } from "../src/sim/lore.ts";
import {
  advance,
  commandCap,
  held,
  manaCap,
  newGame,
  newMeta,
  offered,
  orderArmy,
  buyNode,
  raise,
  treeOpen,
} from "../src/sim/game.ts";
import { BTN_ROWS, C, Hits, cells, tailW } from "../src/ui.ts";
import {
  CREATURES,
  KINDS,
  MANA_GLYPH,
  RAISABLE,
  TAUNT_GLYPH,
  TUNING,
  poolFor,
  type NodeKind,
} from "../src/sim/data.ts";

const KIND_IDS = Object.keys(KINDS) as NodeKind[];
import { TREE, rootId } from "../src/sim/tree.ts";
import { POWERS, powerLines } from "../src/sim/powers.ts";
import { TREE_TEXT, stateOf, treeLines, treeWidth } from "../src/screens/tree.ts";
import { TILE, TILE_MAP } from "../src/tilemap.ts";
import { readFileSync, readdirSync } from "node:fs";

let checks = 0;
function ok(label: string, cond: boolean) {
  checks += 1;
  if (!cond) {
    console.error(`FAIL ${label}`);
    process.exit(1);
  }
}

// A stub that records every cell a screen writes, so the drawing can be held to
// what the fight is supposed to look like without dragging the renderer in
type Cell = { ch: string; fg: number; bg: number };
function recorder(cols: number, rows: number) {
  const cells = new Map<string, Cell>();
  const stub = {
    cols,
    rows,
    cssCell: 16,
    put(x: number, y: number, ch: string, fg: number, bg?: number) {
      const was = cells.get(`${x},${y}`);
      cells.set(`${x},${y}`, { ch, fg, bg: bg ?? was?.bg ?? C.bg });
    },
    fill(x: number, y: number, w: number, h: number, bg: number) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, " ", bg, bg);
    },
    text(x: number, y: number, str: string, fg: number, bg?: number) {
      [...str].forEach((ch, i) => this.put(x + i, y, ch, fg, bg));
    },
    center(x: number, y: number, w: number, str: string, fg: number, bg?: number) {
      const t = [...str].slice(0, w);
      this.text(x + Math.max(0, (w - t.length) >> 1), y, t.join(""), fg, bg);
    },
  };
  const surface = stub as unknown as Parameters<typeof drawBattle>[0];
  const row = (n: number) =>
    Array.from({ length: stub.cols }, (_, x) => cells.get(`${x},${n}`)?.ch ?? " ").join("");
  return { stub, surface, cells, row, drawn: () => [...cells.values()] };
}

const cases = [
  { name: "iphone portrait", innerWidth: 390, innerHeight: 844, dpr: 3, reserved: 34 },
  { name: "iphone landscape", innerWidth: 844, innerHeight: 390, dpr: 3, reserved: 21 },
  { name: "small android", innerWidth: 320, innerHeight: 568, dpr: 2, reserved: 0 },
  { name: "very narrow", innerWidth: 240, innerHeight: 600, dpr: 1, reserved: 0 },
  { name: "desktop", innerWidth: 1920, innerHeight: 1080, dpr: 1, reserved: 0 },
  { name: "dpr 1.5", innerWidth: 412, innerHeight: 915, dpr: 1.5, reserved: 24 },
];

for (const c of cases) {
  const l = computeLayout(c);
  ok(`${c.name}: integer scale`, Number.isInteger(l.scale) && l.scale >= 1);
  ok(`${c.name}: cell is a whole number of device pixels`, l.cell === TILE * l.scale);
  ok(`${c.name}: fits width`, l.cssW <= c.innerWidth + 0.001);
  ok(`${c.name}: fits height`, l.cssH <= c.innerHeight - c.reserved + 0.001);
  ok(`${c.name}: columns capped`, l.cols <= MAX_COLS);
  // 240 CSS px at dpr 1 cannot hold MIN_COLS even at scale 1, and must not pretend to
  const possible = Math.floor((c.innerWidth * c.dpr) / TILE);
  ok(`${c.name}: minimum columns when possible`, l.cols >= Math.min(MIN_COLS, possible));
  ok(`${c.name}: at least one row`, l.rows >= 1);
  // Black bars either side of the board are the thing this is here to catch
  ok(
    `${c.name}: takes the width it is given`,
    l.cols >= MAX_COLS || l.cssW > c.innerWidth - l.cssCell,
  );

  const view = viewRows(l.rows);
  ok(`${c.name}: hud has its rows`, view === Math.max(1, l.rows - HUD_ROWS - BTN_ROWS));
  const size = mapSize();
  for (const want of [{ x: -999, y: -999 }, { x: 0, y: 0 }, { x: 999, y: 999 }]) {
    const cam = clampCam(want, l.cols, l.rows);
    ok(`${c.name}: camera keeps the map in frame`, cam.x <= Math.max(0, size.w - l.cols));
    ok(`${c.name}: camera keeps the top in frame`, cam.y <= Math.max(0, size.h - view));
    ok(`${c.name}: camera never runs off the left`, size.w <= l.cols || cam.x >= 0);
    ok(`${c.name}: camera never runs off the top`, size.h <= view || cam.y >= 0);
  }
}

// A desk monitor should be played on, not framed by it
{
  const l = computeLayout({ innerWidth: 1920, innerHeight: 1080, dpr: 1, reserved: 0 });
  ok("a desktop window is filled across", l.cssW > 1920 - l.cssCell);
  ok("its tiles are bigger than a phone's", l.cssCell > TARGET_TILE_CSS);
  ok("and it keeps the rows a fight needs", l.rows >= MIN_ROWS);
}

// A viewport shorter than the chrome must not produce a negative or zero grid
const tiny = computeLayout({ innerWidth: 200, innerHeight: 40, dpr: 1, reserved: 40 });
ok("degenerate viewport still yields a grid", tiny.cols >= 1 && tiny.rows >= 1);

// Every sheet has to fit the narrowest grid the layout will ever hand it, or a
// line is silently clipped and a button reads as half a word
{
  const g = newGame(2468);
  g.unspent = 1;
  g.over = "won";
  g.cleared = 12;
  g.lost = 9;
  // The widest hand the board can pay for, with the reroll line under it
  g.offer = POWERS.slice(0, 3 + 4).map((p) => p.id);
  g.rerolls = 9;
  // A full roster of the widest names, one of them stacked deep. `raise` never
  // refuses a kind it already holds, so this fills by kind and then piles on.
  for (const c of RAISABLE) raise(g, c);
  for (let i = 0; i < 99; i++) raise(g, g.reserve[0].creature);
  // Everything the dark has ever handed out, on one sheet, several deep
  g.powers = POWERS.flatMap((p) => [p.id, p.id]);
  const ui: Ui = {
    panel: "",
    node: 1,
    speed: 1,
    watch: false,
    unit: g.reserve[0]?.id ?? 0,
    typed: 1e9,
    loreId: null,
    tnode: 0,
    power: POWERS[0].id,
  };

  const fits = (panel: Parameters<typeof panelSpec>[2], cols: number, label: string) => {
    const spec = panelSpec(g, ui, panel, cols);
    if (!spec) return;
    ok(`${label}/${cols}: the title fits`, cells(spec.title) <= cols - 4);
    for (const l of spec.lines) {
      const w = cells(l.text) + tailW(l);
      ok(`${label}/${cols}: "${l.text}" fits`, w <= cols - 4);
      // A wide grid must not stretch prose into one long line of it
      ok(`${label}/${cols}: "${l.text}" stays readable`, w <= SHEET_COLS);
    }
  };

  for (const cols of [MIN_COLS, 20, 24, MAX_COLS]) {
    for (const panel of PANELS) {
      for (const lore of [0, LORE.length - 1]) {
        g.loreQueue = [lore];
        for (const state of ["locked", "open", "cleared"] as const) {
          g.nodes[1].state = state;
          // Every kind of room draws the same sheet, and the sealed ones say the
          // most on it - keys, gifts, and what gets up for free
          for (const kind of KIND_IDS) {
            g.nodes[1].kind = kind;
            g.nodes[1].foes = kind === "gate" ? [] : [...poolFor(kind, g.nodes[1].tier), "guard"];
            for (const keys of [0, 1]) {
              g.res.keys = keys;
              fits(panel, cols, panel);
            }
          }
        }
      }
    }
    // Every card's whole description, at every width, because that sheet is the
    // one place the rules are actually written down
    for (const p of POWERS) {
      ui.power = p.id;
      fits("power", cols, `power ${p.id}`);
    }
    ui.power = POWERS[0].id;
  }

  // The line is reordered from this sheet, both ways, and the ends of it say so
  const army = panelSpec(g, ui, "army", MIN_COLS)!;
  const rows = army.lines.filter((l) => l.act?.t === "inspect");
  ok("every body in the line is on the sheet", rows.length === g.reserve.length);
  ok("the front cannot be walked up", !rows[0].tails?.some((t) => t.act.t === "up"));
  ok("but it can be walked down", rows[0].tails?.some((t) => t.act.t === "down") === true);
  ok("the back can be walked up", rows.at(-1)!.tails?.some((t) => t.act.t === "up") === true);
  ok("and not down", !rows.at(-1)!.tails?.some((t) => t.act.t === "down"));
  ok("the ones between get both", rows.slice(1, -1).every((l) => l.tails?.length === 2));
}

// The board draws itself; every line it writes has to fit the box it asks for
{
  for (const s of treeLines()) ok(`"${s}" fits the tree`, cells(s) <= TREE_TEXT);
  ok("and the box it asks for fits the narrowest grid", treeWidth() <= MIN_COLS);
  ok("it is one tree, not three", TREE.length >= 16 && TREE.length <= 22);

  // Every node reachable from the one you start on, or a run can bank gold for a
  // node it can never buy
  const walk = newMeta();
  ok("the middle comes free", walk.taken.join() === `${rootId}`);
  walk.gold = 9999;
  let guard = 200;
  while (treeOpen(walk).length && guard-- > 0) buyNode(walk, treeOpen(walk)[0]);
  ok("every node can be reached", walk.taken.length === TREE.length);
  ok("and nothing is left open", treeOpen(walk).length === 0);
  for (const n of TREE) ok(`${n.name}: it reads as bought`, stateOf(walk, n.id) === "taken");

  // A card the dark deals is held to the same width as everything else
  for (const s of powerLines()) ok(`"${s}" fits a card`, cells(s) <= TREE_TEXT);
}

// A mend has to be as legible on the board as a blow is
{
  const r = recorder(24, 52);
  const g = newGame(8642);
  orderArmy(g, g.nodes.find((n) => n.state === "open" && !KINDS[n.kind].key)!.id);
  advance(g, TUNING.marchTicks + 1);
  const b = g.battle!;
  const mended = b.units.find((u) => u.faction === "player")!;
  mended.hp = 1;
  b.mend = [{ id: mended.id, by: mended.id, n: 7 }];
  g.next = g.time + TUNING.turnTicks;

  drawBattle(r.surface, g, new Hits(), 1);
  const drawn = r.drawn();
  ok("a mend is written on the board", drawn.some((c) => c.ch === "7" && c.fg === C.green));
  ok("with a plus in front of it", drawn.some((c) => c.ch === "+" && c.fg === C.green));
  ok(
    "and the one who got it goes green",
    drawn.some((c) => c.ch === CREATURES[mended.creature].glyph && c.fg === C.green),
  );
}

// Every creature gets its own sheet, and the longest name is what decides
// whether that sheet fits
{
  const g = newGame(606);
  for (const c of RAISABLE) {
    g.reserve.length = 0;
    raise(g, c);
    const ui: Ui = {
      panel: "unit",
      node: 0,
      speed: 1,
      watch: false,
      unit: g.reserve[0].id,
      typed: 1e9,
      loreId: null,
      tnode: 0,
      power: POWERS[0].id,
    };
    for (const cols of [MIN_COLS, 24, MAX_COLS]) {
      const spec = panelSpec(g, ui, "unit", cols)!;
      ok(`${c}/${cols}: its name fits`, cells(spec.title) <= cols - 4);
      for (const l of spec.lines) ok(`${c}/${cols}: "${l.text}" fits`, cells(l.text) <= cols - 4);
      ok(`${c}/${cols}: it says what it does`, spec.lines.some((l) => l.text.includes("hits for")));
    }
    // The one line that decides where a blow goes is said on the sheet
    const spec = panelSpec(g, ui, "unit", MIN_COLS)!;
    ok(
      `${c}: a wall says it is one`,
      CREATURES[c].taunt === spec.lines.some((l) => l.text.includes(TAUNT_GLYPH)),
    );
  }
}

// The battle view draws through the same Grid surface the renderer does
{
  const r = recorder(24, 52);
  const g = newGame(31313);
  // Two different things at least: this scans a board with a slot still on the
  // floor after one has been spoken for, and one kind of thing is one slot
  const room = g.nodes.find((n) => n.state === "open" && !KINDS[n.kind].key)!;
  room.foes = ["rat", "hound"];
  orderArmy(g, room.id);
  advance(g, TUNING.marchTicks + 1);
  const b = g.battle!;
  // Hand it a finished fight with one of theirs already spoken for
  b.units.filter((u) => u.faction === "enemy").forEach((u) => (u.hp = 0));
  b.done = "win";
  const body = b.units.find((u) => u.faction === "enemy")!;
  // Something with a name nothing already in the line shares, or the scan below
  // cannot tell which row it is looking at
  body.creature = "warden";
  b.taken.push(body.id);
  g.risen = { creatures: [body.creature], units: [body.id], node: b.node, at: g.time };
  g.mode = "spoils";
  g.next = g.time + TUNING.spoilsTicks;

  drawBattle(r.surface, g, new Hits(), 1);
  const drawn = r.drawn();
  const beam = drawn.filter((c) => c.ch === "║" && c.fg === C.violet);
  ok("the light comes down as a column", beam.length >= 1);
  const lit = drawn.filter((c) => c.bg === C.violet && c.ch !== " " && c.ch !== "║");
  ok("and it is behind the body, not over it", lit.length === 1);
  ok("the body is still legible in it", lit[0].fg === C.shade);

  // A body that has crossed stands where a raise actually puts it: at the end of
  // the line. Getting up runs on its own clock, so the way to the end of it is
  // to have started earlier.
  g.risen.at = g.time - Math.ceil(TUNING.riseTicks * 0.9);
  r.cells.clear();
  drawBattle(r.surface, g, new Hits(), 1);
  const names: string[] = [];
  for (let y = 0; y < 52; y++) {
    for (const who of [CREATURES[g.reserve[0].creature].short, CREATURES.warden.short]) {
      if (r.row(y).includes(who) && !names.includes(who)) names.push(who);
    }
  }
  ok("the one that got up is on your side of it", names.includes(CREATURES.warden.short));
  ok("and it stands behind what was already there", names[0] !== CREATURES.warden.short);

  // What you have to hand is on the board too, because they are the numbers you spend
  ok("the board says how many you have", r.row(0).includes(`${g.reserve.length}/${commandCap(g)}`));
  ok("and marks it as bodies", r.row(0).includes("†"));
  ok("and says what is left to ask with", r.row(1).includes(`${g.mana}/${manaCap(g)}`));
  ok("marked as asking", r.row(1).includes(MANA_GLYPH));

  // Every body still on the floor is something to tap, at a price you can read
  const hits = new Hits();
  r.cells.clear();
  drawBattle(r.surface, g, hits, 1);
  const spare = offered(g, b);
  ok("there are bodies left on the floor", spare.length > 0);
  for (const u of spare) {
    ok(
      `${u.creature}: tapping it asks for it`,
      hits.list.some((h) => h.act.t === "reap" && h.act.id === u.id),
    );
  }
  ok("what it costs is written by it", r.drawn().some((c) => c.ch === MANA_GLYPH && c.fg === C.cyan));
  ok("and a body you can pay for is lit up", r.drawn().some((c) => c.ch === "☠" && c.fg === C.cyan));

  // ...and every body of yours is one you can give back, while the board is up
  ok("the room is still held", held(g) !== null);
  for (const u of g.reserve.slice(0, -1)) {
    ok(
      `${u.creature}: tapping it gives it back`,
      hits.list.some((h) => h.act.t === "sell" && h.act.id === u.id),
    );
  }

  // Nothing to ask with, nothing to tap
  r.cells.clear();
  const poorHits = new Hits();
  drawBattle(r.surface, { ...g, mana: 0 }, poorHits, 1);
  ok("an empty pool still shows the price", r.drawn().some((c) => c.ch === MANA_GLYPH));
  ok("but nothing on the floor is lit", !r.drawn().some((c) => c.ch === "☠" && c.fg === C.cyan));

  // Both readouts survive the narrowest board there is, rather than the room
  // name being written over one of them
  const narrow = recorder(MIN_COLS, 52);
  drawBattle(narrow.surface, g, new Hits(), 1);
  ok("a narrow board keeps its bodies", narrow.row(0).includes(`†${g.reserve.length}/${commandCap(g)}`));
  ok("and keeps its asking", narrow.row(1).includes(`${MANA_GLYPH}${g.mana}/${manaCap(g)}`));

  // A desktop grid is wide and short, and the fight still has to have its arena
  const desk = computeLayout({ innerWidth: 1920, innerHeight: 1080, dpr: 1, reserved: 0 });
  const wide = recorder(desk.cols, desk.rows);
  drawBattle(wide.surface, g, new Hits(), 1);
  ok("they still fight where you can see it", wide.drawn().some((c) => c.ch === "▔"));
  const drawnAt = [...wide.cells.entries()]
    .filter(([at, c]) => c.ch !== " " && Number(at.split(",")[1]) < desk.rows - BTN_ROWS)
    .map(([at]) => Number(at.split(",")[0]));
  ok("with the width to spare left spare", Math.min(...drawnAt) >= 4);
  ok("on both sides of it", Math.max(...drawnAt) <= desk.cols - 5);
}

// Two horizontal lines is the picture. A full army and a full room both have to
// stand on one row each at any width worth playing on.
{
  const g = newGame(5150);
  g.reserve.length = 0;
  // The longest line the cap allows is one slot per kind, because the same thing
  // shares a slot - so the worst case for the arena is all different things. A
  // room is not capped, so theirs is the longer of the two.
  for (const c of RAISABLE) raise(g, c);
  const room = g.nodes.find((n) => n.state === "open" && !KINDS[n.kind].key)!;
  room.foes = ["rat", "hound", "moth", "wisp", "knight", "warden"];
  orderArmy(g, room.id);
  advance(g, TUNING.marchTicks + 1);
  const b = g.battle!;
  ok("a long line is actually long", b.units.filter((u) => u.faction === "enemy").length >= 6);
  ok("and yours is every slot you have", b.units.filter((u) => u.faction === "player").length === commandCap(g));

  for (const rows of [MIN_ROWS, 32, 40, 52]) {
    for (const cols of [MIN_COLS, 24, 44, MAX_COLS]) {
      const r = recorder(cols, rows);
      drawBattle(r.surface, g, new Hits(), 1);
      const drawn = r.drawn();
      ok(`${cols}x${rows}: the arena survives a full line`, drawn.some((c) => c.ch === "▔"));
      ok(`${cols}x${rows}: and its floor with it`, drawn.some((c) => c.ch === "▁"));
      ok(
        `${cols}x${rows}: the front of the line is still named`,
        drawn.some((c) => c.ch === CREATURES.rat.short[0]),
      );
      // At any width the game actually asks for, both sides are one row each
      if (cols >= 24) {
        const rowsWith = new Set(
          [...r.cells.entries()]
            .filter(([, c]) => c.ch === CREATURES.rat.glyph || c.ch === CREATURES.warden.glyph)
            .map(([at]) => Number(at.split(",")[1])),
        );
        // The roster below writes glyphs too, and it is as long as the longer of
        // the two lines. What is pinned is the arena: its figures share one row
        // per side, which is two at most.
        const roster = Math.max(
          b.units.filter((u) => u.faction === "player").length,
          b.units.filter((u) => u.faction === "enemy").length,
        );
        ok(`${cols}x${rows}: nobody is stacked in ranks`, rowsWith.size <= 2 + roster);
      }
    }
  }

  // The wall is marked wherever a body is drawn, because which of them is
  // standing is the only thing that decides where the next blow goes
  const r = recorder(44, 52);
  drawBattle(r.surface, g, new Hits(), 1);
  ok("a wall wears its mark", r.drawn().some((c) => c.ch === TAUNT_GLYPH && c.fg === C.blue));
}

// Anything the code draws has to exist in the sheet, or it renders as nothing at
// all. Every non-ascii character in src/ is a glyph somebody meant to see.
const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
const files = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith("tilemap.ts"))
  .map((f) => `src/${f}`);
ok("there are sources to scan", files.length > 5);
for (const file of files) {
  for (const { segment } of seg.segment(readFileSync(file, "utf8"))) {
    if (/^[\x20-\x7e\r\n\t]*$/.test(segment)) continue;
    ok(`${file}: the sheet has ${segment}`, segment in TILE_MAP);
  }
}

console.log(`layout: ${checks} checks passed`);
