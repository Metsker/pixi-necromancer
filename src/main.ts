import { Application, type FederatedPointerEvent } from "pixi.js";
import { bend, crtFilter } from "./gfx/crt.ts";
import { loadGlyphs } from "./gfx/glyphs.ts";
import { Grid } from "./gfx/grid.ts";
import { computeLayout } from "./layout.ts";
import { drawBattle } from "./screens/battle.ts";
import { centerOn, clampCam, drawMap } from "./screens/map.ts";
import { drawPanel, shownPanel, type Ui } from "./screens/panels.ts";
import { LORE } from "./sim/lore.ts";
import { SPELLS, type CreatureId, type Point, type SpellId } from "./sim/data.ts";
import {
  advance,
  canMobilize,
  cast,
  claimBuff,
  clearSave,
  endTurn,
  leaveSpoils,
  load,
  mobilize,
  moveDown,
  moveUp,
  newGame,
  offersHere,
  orderMove,
  save,
} from "./sim/game.ts";
import { sfx, toggleSfx, unlock, type SfxName } from "./sfx.ts";
import { C, Hits, type Act } from "./ui.ts";

// What a tap sounds like. Anything not listed is a plain tap, and a tap on
// nothing says nothing.
const ACT_SFX: Partial<Record<Act["t"], SfxName>> = {
  close: "close",
  back: "close",
  leave: "close",
  node: "open",
  menu: "open",
  army: "open",
  spells: "open",
  muster: "open",
  inspect: "open",
  watch: "open",
  restart: "open",
  read: "open",
  up: "move",
  down: "move",
  move: "move",
  endturn: "move",
  target: "move",
  grab: "buy",
  grabAll: "buy",
  claim: "mend",
  cast: "mend",
};

// One tick of game time. The speed control multiplies how many run per second.
const TICK_MS = 110;
const SPEEDS = [1, 2, 4, 0];
// What their side is paid every week. 1.0 is the fair game the probes measure;
// everything else is the slider.
const LEVELS = [0.7, 1.0, 1.4, 2.0];
// A finger never holds perfectly still, so a tap is allowed to wander this far
const DRAG_SLOP = 10;
const SAVE_EVERY = 4000;
// Characters a second for a piece of the story arriving on screen
const TYPE_CPS = 26;

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

  // The whole picture goes through the glass. app.screen is the same object
  // across resizes, so the area follows the window without being reassigned.
  const crt = crtFilter();
  app.stage.filters = [crt];
  app.stage.filterArea = app.screen;

  let g = load() ?? newGame(Math.floor(Math.random() * 1e9));
  const ui: Ui = {
    panel: "",
    node: 0,
    speed: 1,
    watch: false,
    unit: 0,
    typed: 0,
    loreId: null,
    spell: null,
    picking: null,
  };
  const hits = new Hits();
  let cam: Point = { x: 0, y: 0 };
  let dirty = true;
  let owed = 0;
  let sinceSave = 0;
  let wasFighting = false;
  let drag: { x: number; y: number; cam: Point; moved: boolean } | null = null;

  const recenter = () => {
    cam = centerOn(g, grid.cols, grid.rows);
  };

  // The board, but only while there is actually a fight to look at
  const watching = () =>
    ui.watch && (g.phase === "fight" || g.phase === "spoils") && g.battle !== null;

  // Sound follows what the screen shows rather than what the sim does: the sim
  // stays headless, and a frame that ran ten ticks still only makes one noise.
  const snap = () => ({
    turn: g.turn,
    over: g.over,
    risen: g.risen?.at ?? -1,
    at: g.you.at,
    held: g.nodes.filter((n) => n.owner === "player").length,
  });
  let seen = snap();
  let lastSwing: unknown = null;

  function hear() {
    const now = snap();
    if (now.over && !seen.over) {
      sfx(now.over === "won" ? "win" : "lose");
      save(g);
    } else if (now.held > seen.held) sfx("clear");
    else if (now.turn > seen.turn) sfx("level");
    if (now.risen !== seen.risen) sfx("rise");
    if (now.at !== seen.at) sfx("step");
    seen = now;

    // Only a fight being looked at is heard. Every blow hands out fresh arrays,
    // so their identity is what says one has been thrown since the last frame.
    const b = watching() ? g.battle : null;
    if (!b || b.hit === lastSwing) return;
    lastSwing = b.hit;
    for (const h of b.hit) {
      const from = b.units.find((u) => u.id === h.by);
      const on = b.units.find((u) => u.id === h.id);
      sfx(from?.faction === "player" ? "hit" : "hurt", -Math.min(6, h.n / 2));
      if (on && on.hp <= 0) sfx("die");
    }
    if (b.mend.length) sfx("mend");
  }

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
    if (watching()) drawBattle(grid, g, hits, ui.speed);
    else drawMap(grid, g, cam, hits, ui.picking !== null);
    const panel = shownPanel(g, ui);
    if (panel) drawPanel(grid, g, ui, hits, panel);
    grid.flush();
  }

  function startRun() {
    // The slider is the one thing a new board inherits from the last one
    g = newGame(Math.floor(Math.random() * 1e9), g.difficulty);
    ui.panel = "";
    ui.node = 0;
    ui.watch = false;
    ui.picking = null;
    ui.spell = null;
    recenter();
    seen = snap();
    clearSave();
    save(g);
  }

  // Everything a hero can pay for where it is standing, deepest thing first, for
  // as far as the purse actually reaches
  function musterAll() {
    for (let guard = 0; guard < 60; guard++) {
      const next = offersHere(g, "player").find((o) => canMobilize(g, "player", o.creature));
      if (!next || !mobilize(g, "player", next.creature)) break;
    }
  }

  function onAct(a: Act) {
    if (a.t !== "none") sfx(ACT_SFX[a.t] ?? "tap");
    switch (a.t) {
      case "node":
        ui.node = a.id;
        ui.panel = "node";
        break;
      case "move":
        // The walk is drawn a cell at a time, so the sheet has to come down
        if (orderMove(g, ui.node)) ui.panel = "";
        break;
      case "endturn":
        endTurn(g);
        ui.panel = "";
        recenter();
        break;
      case "muster":
        ui.panel = "muster";
        break;
      case "grab":
        mobilize(g, "player", a.c as CreatureId);
        break;
      case "grabAll":
        musterAll();
        break;
      case "claim":
        claimBuff(g, "player");
        ui.panel = "";
        break;
      case "army":
        ui.panel = "army";
        break;
      case "inspect":
        ui.unit = a.k;
        ui.panel = "unit";
        break;
      case "up":
        moveUp(g.you, a.k);
        break;
      case "down":
        moveDown(g.you, a.k);
        break;
      case "spells":
        ui.panel = "spells";
        break;
      case "read":
        ui.spell = a.id as SpellId;
        ui.panel = "spell";
        break;
      case "cast": {
        const id = a.id as SpellId;
        // A spell that wants a node puts the map back up to pick one on, rather
        // than asking for it in a list - the board is the list
        if (SPELLS[id].window === "map" && id === "shadowstep") {
          ui.picking = id;
          ui.panel = "";
          break;
        }
        cast(g, "player", id);
        if (SPELLS[id].window !== "post") ui.panel = "";
        break;
      }
      case "target":
        if (ui.picking) cast(g, "player", ui.picking, a.id);
        ui.picking = null;
        recenter();
        break;
      case "leave":
        leaveSpoils(g);
        ui.watch = false;
        recenter();
        break;
      case "back":
        ui.watch = false;
        recenter();
        break;
      case "watch":
        ui.watch = true;
        ui.panel = "";
        break;
      case "menu":
        ui.panel = "menu";
        break;
      case "difficulty":
        g.difficulty = LEVELS[(LEVELS.indexOf(g.difficulty) + 1) % LEVELS.length] ?? 1;
        break;
      case "restart":
        ui.panel = "confirm";
        break;
      case "confirm":
        startRun();
        break;
      case "close":
        // Backing out of picking a node for a spell is what CANCEL does
        if (ui.picking) ui.picking = null;
        else ui.panel = "";
        break;
      case "ok":
        // A tap while it is still arriving brings the rest of it at once
        if (ui.loreId !== null && ui.typed < LORE[ui.loreId].body.length) ui.typed = 1e9;
        else g.loreQueue.shift();
        break;
      case "speed":
        ui.speed = SPEEDS[(SPEEDS.indexOf(ui.speed) + 1) % SPEEDS.length];
        break;
      case "sound":
        toggleSfx();
        // Said after the switch, so turning it back on is something you hear
        sfx("open");
        break;
      default:
        break;
    }
    save(g);
    dirty = true;
  }

  const panning = () => !watching() && !shownPanel(g, ui);

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
    unlock();
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
      const p = bend(crt, drag.x, drag.y, app.screen.width, app.screen.height);
      const c = grid.cellAt(p.x, p.y);
      onAct(hits.at(c.x, c.y));
    }
    drag = null;
  };
  app.stage.on("pointerup", release);
  app.stage.on("pointerupoutside", release);

  // Reachable from the page in dev, so a browser check can read the game instead
  // of squinting at a picture of it
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    Object.assign(window, { app, grid, run: () => g, ui, hits, tap: onAct, crt: crt.resources.crt.uniforms });
  }

  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();

  app.ticker.add((t) => {
    // The rules are turns. This clock only ever draws what a turn looks like:
    // a token crossing a cell, and blows landing. Nothing else moves on it, so
    // there is nothing to run while the board is simply waiting on you.
    const busy = g.phase === "fight" || g.you.route.length > 0;
    const running = busy && ui.speed > 0 && !g.over && !shownPanel(g, ui);
    if (running) {
      owed += (t.deltaMS * ui.speed) / TICK_MS;
      const steps = Math.min(240, Math.floor(owed));
      if (steps > 0) {
        owed -= steps;
        const before = g.view;
        advance(g, steps);
        if (g.view !== before) dirty = true;
      }
      sinceSave += t.deltaMS;
      if (sinceSave > SAVE_EVERY) {
        sinceSave = 0;
        if (!g.over) save(g);
      }
    } else {
      owed = 0;
    }
    // The story arrives a letter at a time, on its own clock, because the game
    // clock is stopped while you are reading it
    const showing = shownPanel(g, ui);
    if (showing === "lore") {
      const id = g.loreQueue[0];
      if (ui.loreId !== id) {
        ui.loreId = id;
        ui.typed = 0;
      }
      if (ui.typed < LORE[id].body.length) {
        const was = ui.typed;
        ui.typed += (t.deltaMS * TYPE_CPS) / 1000;
        // Every other letter. One a letter is a machine gun.
        if (Math.floor(ui.typed / 2) !== Math.floor(was / 2)) sfx("type");
        dirty = true;
      }
    } else {
      ui.loreId = null;
    }
    // A fight you walk into is a fight you are shown. Only on the edge, so
    // leaving it does not immediately drag you back in.
    const fighting = g.phase === "fight";
    if (fighting && !wasFighting) {
      ui.watch = true;
      ui.panel = "";
      dirty = true;
    }
    wasFighting = fighting;
    // Leaving a fight that has ended should put the map back by itself
    if (ui.watch && !watching()) {
      ui.watch = false;
      recenter();
      dirty = true;
    }
    hear();
    if (!dirty) return;
    dirty = false;
    redraw();
  });
}

main().catch((err: unknown) => {
  host.textContent = `${err}`;
  host.style.cssText = `color:#ff5777;font:14px/1.5 ui-monospace,monospace;padding:24px`;
});
