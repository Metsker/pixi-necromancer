import type { Grid } from "../gfx/grid.ts";
import { LORE } from "../sim/lore.ts";
import {
  CREATURES,
  KIND_NAME,
  KIND_NOTE,
  RESOURCES,
  RES_IDS,
  SQUAD_GLYPH,
  type CreatureId,
  type Force,
  type GameState,
} from "../sim/data.ts";
import { bandOf, canOrder, canSend, heroForce, perks, reserve, squads, unitDmg } from "../sim/game.ts";
import { PATHS, PATH_IDS } from "../sim/tree.ts";
import { C, COL, Hits, type Line, sheet, wrap } from "../ui.ts";
import { drawTree } from "./tree.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// The widest a line of a sheet is allowed to get, however wide the grid is
export const SHEET_COLS = 40;

export type PanelId = "" | "node" | "roster" | "army" | "unit" | "menu" | "confirm" | "tree";

export type Ui = {
  panel: PanelId;
  node: number;
  pick: number[];
  speed: number;
  watch: number | null;
  unit: number;
  // How much of the piece being read has arrived, and which piece that is
  typed: number;
  loreId: number | null;
  // The node of the tree being read, which is not the same as one being bought
  tnode: number;
};

export type Shown = PanelId | "path" | "lore" | "over";

// The tree draws itself rather than going through sheet(), so it is not listed
// here: what this drives is the width check, and a board is not a list of lines.
export const PANELS: Shown[] = [
  "node",
  "roster",
  "army",
  "unit",
  "menu",
  "confirm",
  "path",
  "lore",
  "over",
];

export type Spec = { title: string; lines: Line[]; minWidth: number };

// Anything the run owes the player is shown before anything the player asked
// for. While any of these is up the clock is stopped, so nothing is missed.
export function shownPanel(g: GameState, ui: Ui): Shown {
  if (!g.path) return "path";
  if (g.loreQueue.length) return "lore";
  if (g.unspent > 0) return "tree";
  if (g.over) return "over";
  return ui.panel;
}

const tally = (foes: CreatureId[]) => {
  const seen: CreatureId[] = [];
  const count = new Map<CreatureId, number>();
  for (const f of foes) {
    if (!count.has(f)) seen.push(f);
    count.set(f, (count.get(f) ?? 0) + 1);
  }
  return seen
    .map((f) => (count.get(f)! > 1 ? `${CREATURES[f].short} x${count.get(f)}` : CREATURES[f].short))
    .join(", ");
};

const doing = (f: Force) =>
  f.mode === "fight" ? "fighting" : f.mode === "march" ? "moving" : "waiting";

// What a sheet says and what its lines do, built in one place and at a known
// width, so a check can hold every panel to the narrowest grid there is
export function panelSpec(g: GameState, ui: Ui, panel: Shown, cols: number): Spec | null {
  // Capped, or a desk monitor turns a sheet of prose into one long line of it
  const wide = Math.min(SHEET_COLS, Math.max(4, cols - 6));
  const say = (s: string, fg: number): Line[] => wrap(s, wide).map((text) => ({ text, fg }));

  switch (panel) {
    case "node":
      return nodeSpec(g, ui, wide);
    case "roster":
      return rosterSpec(g, ui, wide);
    case "army":
      return armySpec(g, wide);
    case "unit":
      return unitSpec(g, ui, wide);
    case "menu":
      return {
        title: "MENU",
        minWidth: Math.min(wide, 16),
        lines: [
          {
            text: g.path ? `${PATHS[g.path].name} ${g.taken.length}/12` : "",
            act: { t: "tree" },
            fg: C.gold,
          },
          ...RES_IDS.map((r) => ({
            text: `${RESOURCES[r].glyph} ${RESOURCES[r].short.padEnd(5)}${g.res[r]}`,
            fg: C.mid,
          })),
          { text: "" },
          ...say(`rooms taken ${g.cleared}`, C.dim),
          ...say(`dead ${g.lost}`, C.dim),
          { text: `lore ${g.seenLore.length}/${LORE.length}`, fg: C.dim },
          { text: "" },
          { text: "restart run", act: { t: "restart" } },
          { text: "close", act: { t: "close" } },
        ],
      };
    case "confirm":
      return {
        title: "RESTART?",
        minWidth: Math.min(wide, 16),
        lines: [
          ...say("this run is lost", C.dim),
          { text: "yes, restart", act: { t: "confirm" } },
          { text: "no, keep going", act: { t: "close" } },
        ],
      };
    case "path":
      return {
        title: "INTO THE DARK",
        minWidth: Math.min(wide, 16),
        // Built from the list, so a nature cannot be added and go unoffered
        lines: PATH_IDS.flatMap((id) => [
          { text: `${PATHS[id].glyph} ${PATHS[id].name}`, act: { t: "path" as const, id }, fg: COL(PATHS[id].color) },
          { text: PATHS[id].hint, fg: C.dim },
        ]),
      };
    case "lore": {
      const piece = LORE[g.loreQueue[0] ?? 0];
      // Wrapped whole and then revealed, so the lines do not reflow as it types
      let left = ui.typed;
      const body = wrap(piece.body, wide).map((line) => {
        const take = clamp(left, 0, line.length);
        left -= line.length;
        return { text: line.slice(0, take), fg: C.mid };
      });
      return {
        title: piece.title.slice(0, wide),
        minWidth: wide,
        lines: [...body, { text: "" }, { text: "continue", act: { t: "ok" } }],
      };
    }
    case "over":
      return {
        title: g.over === "won" ? "IT IS DONE" : "YOU FELL",
        minWidth: Math.min(wide, 16),
        lines: [
          ...say(g.over === "won" ? "the ossuary lies still" : "the army crumbles", C.dim),
          ...say(`rooms taken ${g.cleared}`, C.dim),
          { text: "" },
          { text: "new run", act: { t: "confirm" } },
        ],
      };
    default:
      return null;
  }
}

export function drawPanel(grid: Grid, g: GameState, ui: Ui, hits: Hits, panel: Shown) {
  // A board is not a list of lines, so it does not go through sheet()
  if (panel === "tree") return drawTree(grid, g, hits, ui.tnode);
  const spec = panelSpec(g, ui, panel, grid.cols);
  if (spec) sheet(grid, hits, spec.title, spec.lines, spec.minWidth);
}

function nodeSpec(g: GameState, ui: Ui, wide: number): Spec {
  const n = g.nodes[ui.node];
  const lines: Line[] = [];
  const say = (s: string, fg: number) => {
    for (const text of wrap(s, wide)) lines.push({ text, fg });
  };

  if (n.state === "locked") {
    say("sealed until a way is opened beside it", C.dim);
  } else if (n.state === "cleared") {
    say(KIND_NOTE[n.kind], C.dim);
    say("already quiet", C.dim);
  } else {
    say(KIND_NOTE[n.kind], C.dim);
    say(tally(n.foes), C.mid);
  }

  // Anything fighting here can be watched, whoever it belongs to - and a room he
  // has taken but not left is the one place he still has something to do
  const busy = g.forces.filter(
    (f) => f.at === n.id && (f.mode === "fight" || (f.kind === "hero" && f.mode === "spoils")),
  );
  lines.push({ text: "" });
  for (const f of busy) {
    lines.push({
      text: f.mode === "spoils" ? "take the dead" : f.kind === "hero" ? "watch the fight" : "watch the squad",
      act: { t: "watch", id: f.id },
    });
  }

  if (canOrder(g, n.id) && g.forces[0].at !== n.id) {
    lines.push({
      text: n.state === "open" ? "take it yourself" : "go there",
      act: { t: "order" },
    });
  }
  if (canSend(g, n.id)) lines.push({ text: "send a squad", act: { t: "squad" } });
  lines.push({ text: "close", act: { t: "close" } });

  return {
    title: (n.state === "locked" ? "SEALED" : KIND_NAME[n.kind]).slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines,
  };
}

// You pick them in the order they will stand in, so the number beside a name is
// its place in the line and the first one you tap is the one that gets hit.
function rosterSpec(g: GameState, ui: Ui, wide: number): Spec {
  const lines: Line[] = [];
  const troop = reserve(g);
  if (!troop.length) lines.push({ text: "nothing raised", fg: C.dim });

  for (const u of troop) {
    const t = CREATURES[u.creature];
    const at = ui.pick.indexOf(u.id);
    lines.push({
      text: `${at < 0 ? "  " : `${at + 1}.`}${t.glyph}${t.short.padEnd(6)}${u.hp}`,
      act: { t: "toggle", id: u.id },
      fg: at < 0 ? C.mid : C.gold,
    });
  }

  lines.push({ text: "" });
  if (ui.pick.length) lines.push({ text: `send ${ui.pick.length}`, act: { t: "send" } });
  lines.push({ text: "back", act: { t: "node", id: ui.node } });
  return { title: "SEND SQUAD", minWidth: Math.min(wide, 16), lines };
}

// What a body is, on its own sheet, so the line in the list stays a line
function unitSpec(g: GameState, ui: Ui, wide: number): Spec {
  const u = bandOf(g, heroForce(g)).find((o) => o.id === ui.unit);
  if (!u) return { title: "GONE", minWidth: 0, lines: [{ text: "back", act: { t: "army" } }] };
  const t = CREATURES[u.creature];
  const pace = t.speed >= 5 ? "quick" : t.speed >= 3 ? "steady" : "slow";
  return {
    title: t.name.slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines: [
      { text: `${t.glyph} ${u.hp}/${u.maxHp}`, fg: C.ink },
      { text: t.role, fg: C.gold },
      { text: `hits for ${unitDmg(g, u)}`, fg: C.mid },
      { text: pace, fg: C.mid },
      // Only worth saying to somebody who has bought a reason to care
      ...(u.rooms > 0 && (perks(g).vetDmg || perks(g).vetHp)
        ? [{ text: `${u.rooms} rooms lived`, fg: C.gold }]
        : []),
      ...(t.tag ? [{ text: "" }, ...wrap(t.tag, wide).map((text) => ({ text, fg: C.dim }))] : []),
      { text: "" },
      { text: "back", act: { t: "army" } },
    ],
  };
}

function armySpec(g: GameState, wide: number): Spec {
  const lines: Line[] = [];

  // The line as it will stand, the necromancer included. He can be moved back
  // behind something sturdier, which is most of what the ordering is for.
  bandOf(g, heroForce(g)).forEach((u, k) => {
    const t = CREATURES[u.creature];
    const you = u.creature === "hero";
    lines.push({
      text: ` ${k + 1}.${t.glyph}${(you ? "You" : t.short).padEnd(6)}${u.hp}`,
      fg: you ? COL(CREATURES.hero.color) : C.mid,
      act: { t: "inspect", id: u.id },
      tail: k > 0 ? { text: "▲", act: { t: "up", k } } : undefined,
    });
  });


  const out = squads(g);
  if (out.length) {
    lines.push({ text: "" });
    for (const f of out) {
      lines.push({
        text: `${SQUAD_GLYPH}${f.units.length} ${doing(f)} ${f.rooms}`.slice(0, wide),
        act: f.mode === "fight" ? { t: "watch", id: f.id } : undefined,
        fg: f.mode === "fight" ? C.hot : C.cyan,
      });
    }
  }

  lines.push({ text: "" }, { text: "close", act: { t: "close" } });
  return { title: heroForce(g).mode === "fight" ? "IN A FIGHT" : "THE ARMY", minWidth: Math.min(wide, 16), lines };
}
