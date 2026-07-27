// Layout, drawing, sheet widths and glyph coverage. Screens draw through the
// narrow `Surface` interface, so this hands them a recording stub instead of a
// renderer and holds the result to the smallest grid the game supports.
import { readFileSync, readdirSync } from "node:fs";
import { TILE, TILE_MAP } from "../src/tilemap.ts";
import { MAX_COLS, MIN_COLS, MIN_ROWS, computeLayout } from "../src/layout.ts";
import { drawBattle } from "../src/screens/battle.ts";
import { HUD_ROWS, drawMap, mapSize, viewRows } from "../src/screens/map.ts";
import { PANELS, SHEET_COLS, panelSpec, type Shown, type Ui } from "../src/screens/panels.ts";
import {
  CREATURES,
  CREATURE_IDS,
  FAMILY_COLOR,
  HERO_COLOR,
  KINDS,
  KIND_IDS,
  OWNER_COLOR,
  SPELL_IDS,
  type GameState,
} from "../src/sim/data.ts";
import { botTurn, endTurn, makeBattle, newGame } from "../src/sim/game.ts";
import { BTN_ROWS, C, Hits, cells, tailW } from "../src/ui.ts";

let checks = 0;
function ok(label: string, cond: boolean) {
  checks += 1;
  if (!cond) {
    console.error(`FAIL ${label}`);
    process.exit(1);
  }
}

// Records every cell a screen writes, so drawing can be held to what it is meant
// to look like without dragging the renderer in
function recorder(cols: number, rows: number) {
  const cells = new Map<string, { ch: string; fg: number; bg: number }>();
  let out = 0;
  const stub = {
    cols,
    rows,
    cssCell: 16,
    put(x: number, y: number, ch: string, fg: number, bg?: number) {
      if (x < 0 || x >= cols || y < 0 || y >= rows) {
        out += 1;
        return;
      }
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
  return {
    surface: stub as unknown as Parameters<typeof drawBattle>[0],
    grid: stub as unknown as Parameters<typeof drawMap>[0],
    outside: () => out,
    written: () => cells.size,
  };
}

// ------------------------------------------------------------------ layout

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
  const possible = Math.floor((c.innerWidth * c.dpr) / TILE);
  ok(`${c.name}: minimum columns when possible`, l.cols >= Math.min(MIN_COLS, possible));
  ok(`${c.name}: at least one row`, l.rows >= 1);
  // Black bars either side of the board are the thing this is here to catch
  ok(
    `${c.name}: takes the width it is given`,
    l.cols >= MAX_COLS || l.cssW > c.innerWidth - l.cssCell,
  );
  ok(`${c.name}: hud has its rows`, viewRows(l.rows) === Math.max(1, l.rows - HUD_ROWS - BTN_ROWS));
}
const size = mapSize();
ok("the whole map is wider than one screen", size.w > MIN_COLS);
console.log(`layout   ${cases.length} viewports, down to ${MIN_COLS}x${MIN_ROWS}`);

// ------------------------------------------------------------------ colour

// Colour is the family and the glyph is the rung. A token that wears a family's
// colour is a token you lose on the board, so the two heroes may not.
const famColours = Object.values(FAMILY_COLOR);
ok("every family has its own colour", new Set(famColours).size === famColours.length);
for (const f of Object.keys(HERO_COLOR) as (keyof typeof HERO_COLOR)[]) {
  ok(`the ${f} hero is not the colour of a family`, !famColours.includes(HERO_COLOR[f]));
}
ok("the two heroes are not the same colour", HERO_COLOR.player !== HERO_COLOR.enemy);
const ownColours = Object.values(OWNER_COLOR);
ok("every owner has its own colour", new Set(ownColours).size === ownColours.length);
for (const f of Object.keys(HERO_COLOR) as (keyof typeof HERO_COLOR)[]) {
  ok(`the ${f} hero is not the colour of an owner`, !ownColours.includes(HERO_COLOR[f]));
}
console.log(`colour   ${famColours.length} families, ${ownColours.length} owners, 2 heroes, all apart`);

// ------------------------------------------------------------------ glyphs

// Every non-ASCII character anywhere in src/ has to exist on the sheet, or it
// renders as nothing at all
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : [],
  );
}
const missing = new Map<string, string>();
for (const file of walk("src")) {
  if (file.endsWith("tilemap.ts")) continue;
  for (const ch of readFileSync(file, "utf8")) {
    if (ch.charCodeAt(0) < 128) continue;
    if (TILE_MAP[ch]) continue;
    if (!missing.has(ch)) missing.set(ch, file);
  }
}
for (const [ch, file] of missing) ok(`${file}: ${ch} (U+${ch.codePointAt(0)!.toString(16)}) is on the sheet`, false);
ok("every glyph in src is on the sheet", missing.size === 0);
console.log(`glyphs   ${CREATURE_IDS.length} bodies, ${KIND_IDS.length} node kinds, all on the sheet`);

// ------------------------------------------------------------------ sheets

const ui: Ui = {
  panel: "",
  node: 0,
  speed: 1,
  watch: false,
  unit: 0,
  typed: 1e9,
  loreId: null,
  spell: SPELL_IDS[0],
  picking: null,
};

// Built at the narrowest grid the game supports, because that is the one a sheet
// actually has to fit inside
const narrow = MIN_COLS;
function everyPanel(g: GameState, cols: number) {
  for (const panel of PANELS as Shown[]) {
    const spec = panelSpec(g, { ...ui, node: g.you.at }, panel, cols);
    if (!spec) continue;
    // The width panelSpec itself builds to, which is the one a line has to fit
    const room = Math.min(SHEET_COLS, Math.max(4, cols - 6));
    for (const l of spec.lines) {
      ok(
        `${panel} at ${cols}: "${l.text}" fits (${cells(l.text) + tailW(l)} > ${room})`,
        cells(l.text) + tailW(l) <= room,
      );
    }
    ok(`${panel} at ${cols}: has a title`, cells(spec.title) > 0);
  }
}

{
  const g = newGame(7);
  // Somewhere with a garrison, a shrine and a fight to look at
  for (let i = 0; i < 6; i++) {
    botTurn(g, "player");
    endTurn(g);
  }
  for (const cols of [narrow, 32, SHEET_COLS, MAX_COLS]) everyPanel(g, cols);

  // ...and the same again once it is over, because the last sheet is a sheet too
  const done = newGame(9);
  done.over = "won";
  everyPanel(done, narrow);
  done.over = "dead";
  everyPanel(done, narrow);
}
console.log(`sheets   ${PANELS.length} panels hold at ${narrow} columns`);

// ------------------------------------------------------------------ drawing

for (const c of cases) {
  const l = computeLayout(c);
  const g = newGame(11);
  for (let i = 0; i < 4; i++) {
    botTurn(g, "player");
    endTurn(g);
  }

  const map = recorder(l.cols, l.rows);
  drawMap(map.grid, g, { x: 0, y: 0 }, new Hits(), false);
  ok(`${c.name}: the map stays on the screen`, map.outside() === 0);
  ok(`${c.name}: the map draws something`, map.written() > 0);

  // ...and again while a spell is asking which node to land on
  const pick = recorder(l.cols, l.rows);
  drawMap(pick.grid, g, { x: 0, y: 0 }, new Hits(), true);
  ok(`${c.name}: picking a node stays on the screen`, pick.outside() === 0);

  // A fight, mid-swing and then held open afterwards
  const target = g.nodes.find((n) => n.owner !== "player" && n.garrison.length) ?? g.nodes[0];
  g.battle = makeBattle(g, "player", target.id);
  for (const phase of ["fight", "spoils"] as const) {
    g.phase = phase;
    const fight = recorder(l.cols, l.rows);
    drawBattle(fight.surface, g, new Hits(), 1);
    ok(`${c.name}: the fight stays on the screen (${phase})`, fight.outside() === 0);
    ok(`${c.name}: the fight draws something (${phase})`, fight.written() > 0);
  }
}
console.log(`drawing  map, node-picking and both halves of a fight, at every viewport`);

// ------------------------------------------------------------------ tags

// Anything written next to a body has to fit the column it is written in
for (const c of CREATURE_IDS) {
  const t = CREATURES[c];
  ok(`${c}: short name fits a roster column`, cells(t.short) <= 8);
  ok(`${c}: has a name and a glyph`, cells(t.name) > 0 && cells(t.glyph) === 1);
}
for (const k of KIND_IDS) {
  ok(`${k}: name fits the narrowest sheet`, cells(KINDS[k].name) <= narrow - 4);
  ok(`${k}: has a note`, cells(KINDS[k].note) > 0);
}

console.log(`check-layout ok (${checks} checks)`);
