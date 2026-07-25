import { Application, type FederatedPointerEvent } from "pixi.js";
import { loadGlyphs } from "./gfx/glyphs.ts";
import { Grid } from "./gfx/grid.ts";
import { computeLayout } from "./layout.ts";
import { drawBattle } from "./screens/battle.ts";
import { centerOn, clampCam, drawMap } from "./screens/map.ts";
import { drawPanel, shownPanel, type Ui } from "./screens/panels.ts";
import type { Point } from "./sim/data.ts";
import {
  advance,
  chooseStat,
  clearSave,
  load,
  moveTo,
  newGame,
  resolveBattle,
  runBattle,
  save,
  sendSquad,
  tickBattle,
} from "./sim/game.ts";
import { C, Hits, type Act } from "./ui.ts";

const TICK_MS = 420;
// A finger never holds perfectly still, so a tap is allowed to wander this far
const DRAG_SLOP = 10;

const host = document.getElementById("stage")!;
const safe = document.getElementById("safe")!;

async function main() {
  const glyphs = await loadGlyphs("dungeon-mode.png");

  const app = new Application();
  await app.init({
    background: C.bg,
    antialias: false,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: "webgl",
    width: 256,
    height: 256,
    eventFeatures: { move: true, globalMove: true, click: true, wheel: false },
  });
  host.appendChild(app.canvas);

  const grid = new Grid(glyphs, C.bg);
  app.stage.addChild(grid.root);

  let g = load() ?? newGame(Math.floor(Math.random() * 1e9));
  const ui: Ui = { panel: "", node: 0, pick: [], speed: 1 };
  const hits = new Hits();
  let cam: Point = { x: 0, y: 0 };
  let dirty = true;
  let since = 0;
  let drag: { x: number; y: number; cam: Point; moved: boolean } | null = null;

  const recenter = () => {
    cam = centerOn(g, grid.cols, grid.rows);
  };

  function fit() {
    const l = computeLayout({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      reserved: safe.offsetHeight,
    });
    app.renderer.resize(l.cssW, l.cssH);
    grid.resize(l.cols, l.rows, l.cssCell);
    app.stage.hitArea = app.screen;
    recenter();
    dirty = true;
  }

  function redraw() {
    hits.clear();
    grid.clear(C.bg);
    if (g.battle) drawBattle(grid, g, ui, hits);
    else drawMap(grid, g, cam, hits);
    const panel = shownPanel(g, ui);
    if (panel) drawPanel(grid, g, ui, hits, panel);
    grid.flush();
  }

  function startRun() {
    clearSave();
    g = newGame(Math.floor(Math.random() * 1e9));
    ui.panel = "";
    ui.pick = [];
    ui.node = 0;
    recenter();
    save(g);
  }

  function onAct(a: Act) {
    switch (a.t) {
      case "node":
        ui.node = a.id;
        ui.panel = "node";
        break;
      case "move":
        moveTo(g, ui.node);
        ui.panel = "";
        recenter();
        break;
      case "advance":
        advance(g, ui.node);
        ui.panel = "";
        since = 0;
        break;
      case "squad":
        ui.pick = [];
        ui.panel = "roster";
        break;
      case "toggle":
        ui.pick = ui.pick.includes(a.id) ? ui.pick.filter((i) => i !== a.id) : [...ui.pick, a.id];
        break;
      case "send":
        // The expedition runs to its end here; what comes back is a report
        if (sendSquad(g, ui.node, ui.pick)) {
          ui.panel = "";
          ui.pick = [];
        }
        break;
      case "army":
        ui.panel = "army";
        break;
      case "menu":
        ui.panel = "menu";
        break;
      case "restart":
        ui.panel = "confirm";
        break;
      case "confirm":
        startRun();
        break;
      case "close":
        ui.panel = "";
        break;
      case "stat":
        chooseStat(g, a.s);
        break;
      case "ok":
        if (g.pending) g.pending = null;
        else g.pendingLore = null;
        break;
      case "speed":
        ui.speed = ui.speed >= 4 ? 1 : ui.speed * 2;
        break;
      case "skip":
        runBattle(g);
        break;
      case "resolve":
        resolveBattle(g);
        recenter();
        break;
      default:
        break;
    }
    if (g.over) clearSave();
    else save(g);
    dirty = true;
  }

  const panning = () => !g.battle && !shownPanel(g, ui);

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
    drag = { x: e.global.x, y: e.global.y, cam: { ...cam }, moved: false };
  });
  app.stage.on("globalpointermove", (e: FederatedPointerEvent) => {
    if (!drag) return;
    const dx = e.global.x - drag.x;
    const dy = e.global.y - drag.y;
    if (!drag.moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    drag.moved = true;
    if (!panning()) return;
    cam = clampCam(
      { x: drag.cam.x - dx / grid.cssCell, y: drag.cam.y - dy / grid.cssCell },
      grid.cols,
      grid.rows,
    );
    dirty = true;
  });
  const release = () => {
    if (drag && !drag.moved) {
      const c = grid.cellAt(drag.x, drag.y);
      onAct(hits.at(c.x, c.y));
    }
    drag = null;
  };
  app.stage.on("pointerup", release);
  app.stage.on("pointerupoutside", release);

  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();

  app.ticker.add((t) => {
    if (g.battle && !g.battle.done) {
      since += t.deltaMS;
      if (since >= TICK_MS / ui.speed) {
        since = 0;
        tickBattle(g);
        dirty = true;
      }
    }
    if (!dirty) return;
    dirty = false;
    redraw();
  });
}

main().catch((err: unknown) => {
  host.textContent = `${err}`;
  host.style.cssText = `color:#ff5777;font:14px/1.5 ui-monospace,monospace;padding:24px`;
});
