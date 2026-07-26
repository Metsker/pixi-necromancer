// Run: node scripts/check-layout.ts
import { MAX_COLS, MIN_COLS, computeLayout } from "../src/layout.ts";
import { HUD_ROWS, clampCam, mapSize, viewRows } from "../src/screens/map.ts";
import { PANELS, panelSpec, type Ui } from "../src/screens/panels.ts";
import { LORE } from "../src/sim/lore.ts";
import { advance, newGame, raise, sendSquad } from "../src/sim/game.ts";
import { BTN_ROWS, cells } from "../src/ui.ts";
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

  // The map is bigger than any screen now, so what matters is that the camera
  // cannot be pushed past its edges and always shows something
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
  while (raise(g, "warden")) {
    /* a full roster is the widest roster */
  }
  // Two squads out, one of them mid-fight, so the army sheet is at its longest
  sendSquad(g, g.nodes.find((n) => n.state === "open")!.id, [g.reserve[0].id]);
  advance(g, 200);
  const ui: Ui = {
    panel: "",
    node: 1,
    pick: g.reserve.map((u) => u.id),
    speed: 1,
    watch: null,
    typed: 1e9,
    loreId: null,
  };

  for (const cols of [MIN_COLS, 20, 24, MAX_COLS]) {
    for (const panel of PANELS) {
      for (const lore of [0, LORE.length - 1]) {
        g.loreQueue = [lore];
        for (const state of ["locked", "open", "cleared"] as const) {
          g.nodes[1].state = state;
          const spec = panelSpec(g, ui, panel, cols);
          if (!spec) continue;
          ok(`${panel}/${cols}: the title fits`, cells(spec.title) <= cols - 4);
          for (const l of spec.lines) {
            const w = cells(l.text) + (l.tail ? cells(l.tail.text) + 1 : 0);
            ok(`${panel}/${cols}: "${l.text}" fits`, w <= cols - 4);
          }
        }
      }
    }
  }
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
