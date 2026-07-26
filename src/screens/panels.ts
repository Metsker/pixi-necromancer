import type { Grid } from "../gfx/grid.ts";
import { LORE } from "../sim/lore.ts";
import {
  CREATURES,
  KIND_NAME,
  KIND_NOTE,
  RESOURCES,
  RES_IDS,
  TAUNT_GLYPH,
  type CreatureId,
  type GameState,
} from "../sim/data.ts";
import { canOrder, perks, reserve, unitDmg, wallish, type Meta } from "../sim/game.ts";
import { sfxMuted } from "../sfx.ts";
import { TREE } from "../sim/tree.ts";
import { ARMS, POWER_BY_ID } from "../sim/powers.ts";
import { C, COL, Hits, type Line, sheet, wrap } from "../ui.ts";
import { drawTree } from "./tree.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// The widest a line of a sheet is allowed to get, however wide the grid is
export const SHEET_COLS = 40;

export type PanelId = "" | "node" | "army" | "unit" | "menu" | "confirm" | "tree";

export type Ui = {
  panel: PanelId;
  node: number;
  speed: number;
  // Whether the board is up rather than the map. There is only one fight.
  watch: boolean;
  unit: number;
  // How much of the piece being read has arrived, and which piece that is
  typed: number;
  loreId: number | null;
  // The node of the tree being read, which is not the same as one being bought
  tnode: number;
};

export type Shown = PanelId | "lore" | "over" | "draft";

// The tree draws itself rather than going through sheet(), so it is not listed
// here: what this drives is the width check, and a board is not a list of lines.
export const PANELS: Shown[] = ["node", "army", "unit", "menu", "confirm", "lore", "over", "draft"];

export type Spec = { title: string; lines: Line[]; minWidth: number };

// Anything the run owes the player is shown before anything the player asked
// for. While any of these is up the clock is stopped, so nothing is missed.
export function shownPanel(g: GameState, ui: Ui): Shown {
  if (g.loreQueue.length) return "lore";
  if (g.unspent > 0 && g.offer.length) return "draft";
  // Above the end of a run, because the end of a run is where the board is spent
  if (ui.panel === "tree") return "tree";
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

// What a sheet says and what its lines do, built in one place and at a known
// width, so a check can hold every panel to the narrowest grid there is
export function panelSpec(g: GameState, ui: Ui, panel: Shown, cols: number): Spec | null {
  // Capped, or a desk monitor turns a sheet of prose into one long line of it
  const wide = Math.min(SHEET_COLS, Math.max(4, cols - 6));
  const say = (s: string, fg: number): Line[] => wrap(s, wide).map((text) => ({ text, fg }));

  switch (panel) {
    case "node":
      return nodeSpec(g, ui, wide);
    case "army":
      return armySpec(g, wide);
    case "unit":
      return unitSpec(g, ui, wide);
    case "menu":
      return {
        title: "MENU",
        minWidth: Math.min(wide, 16),
        lines: [
          { text: `tree ${g.taken.length}/${TREE.length}`, act: { t: "tree" }, fg: C.gold },
          ...RES_IDS.map((r) => ({
            text: `${RESOURCES[r].glyph} ${RESOURCES[r].short.padEnd(5)}${g.res[r]}`,
            fg: C.mid,
          })),
          { text: "" },
          ...say(`rooms taken ${g.cleared}`, C.dim),
          ...say(`dead ${g.lost}`, C.dim),
          { text: `lore ${g.seenLore.length}/${LORE.length}`, fg: C.dim },
          { text: "" },
          { text: sfxMuted() ? "sound off" : "sound on", act: { t: "sound" } },
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
    case "lore": {
      const piece = LORE[g.loreQueue[0] ?? 0];
      // Wrapped whole and then revealed, so the lines do not reflow as it types
      let leftToShow = ui.typed;
      const body = wrap(piece.body, wide).map((line) => {
        const take = clamp(leftToShow, 0, line.length);
        leftToShow -= line.length;
        return { text: line.slice(0, take), fg: C.mid };
      });
      return {
        title: piece.title.slice(0, wide),
        minWidth: wide,
        lines: [...body, { text: "" }, { text: "continue", act: { t: "ok" } }],
      };
    }
    // The level-up. Three of them, coloured by the arm they belong to, and the
    // arm is the whole of what the colour is for.
    case "draft": {
      const lines: Line[] = [];
      for (const id of g.offer) {
        const p = POWER_BY_ID[id];
        if (!p) continue;
        // A gap between the cards, or one card's note reads as the next one's
        if (lines.length) lines.push({ text: "" });
        lines.push({ text: p.name, act: { t: "power", id }, fg: COL(ARMS[p.arm].color) });
        lines.push(...wrap(p.note, wide).map((text) => ({ text, fg: C.dim })));
      }
      if (g.rerolls > 0) {
        lines.push({ text: "" }, { text: `roll again (${g.rerolls})`, act: { t: "reroll" } });
      }
      return { title: "THE DARK OFFERS", minWidth: Math.min(wide, 16), lines };
    }
    // The end of a run is the only hub there is: what it earned is already
    // banked, and the board is the thing to spend it on before the next one.
    case "over":
      return {
        title: g.over === "won" ? "IT IS DONE" : "NOTHING STANDS",
        minWidth: Math.min(wide, 16),
        lines: [
          ...say(g.over === "won" ? "the ossuary lies still" : "the army is gone", C.dim),
          ...say(`rooms taken ${g.cleared}`, C.dim),
          { text: "" },
          { text: "the tree", act: { t: "tree" }, fg: C.gold },
          { text: "new run", act: { t: "confirm" } },
        ],
      };
    default:
      return null;
  }
}

export function drawPanel(grid: Grid, g: GameState, m: Meta, ui: Ui, hits: Hits, panel: Shown) {
  // A board is not a list of lines, so it does not go through sheet()
  if (panel === "tree") return drawTree(grid, m, hits, ui.tnode, g.over !== "");
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

  // A room being fought over can be watched, and a room taken but not left is
  // the one place there is still something to do
  lines.push({ text: "" });
  if (g.at === n.id && (g.mode === "fight" || g.mode === "spoils")) {
    lines.push({
      text: g.mode === "spoils" ? "take the dead" : "watch the fight",
      act: { t: "watch" },
    });
  }

  if (canOrder(g, n.id) && g.at !== n.id) {
    lines.push({ text: n.state === "open" ? "take it" : "go there", act: { t: "order" } });
  }
  lines.push({ text: "close", act: { t: "close" } });

  return {
    title: (n.state === "locked" ? "SEALED" : KIND_NAME[n.kind]).slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines,
  };
}

// What a body is, on its own sheet, so the line in the list stays a line
function unitSpec(g: GameState, ui: Ui, wide: number): Spec {
  const u = reserve(g).find((o) => o.id === ui.unit);
  if (!u) return { title: "GONE", minWidth: 0, lines: [{ text: "back", act: { t: "army" } }] };
  const t = CREATURES[u.creature];
  const P = perks(g);
  return {
    title: t.name.slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines: [
      { text: `${t.glyph} ${u.hp}/${u.maxHp}`, fg: C.ink },
      { text: t.role, fg: C.gold },
      { text: `hits for ${unitDmg(g, u)}`, fg: C.mid },
      // The one line that changes where a blow goes, so it is said plainly
      ...(wallish(u, P) ? [{ text: `${TAUNT_GLYPH} a wall`, fg: C.blue }] : []),
      // Only worth saying to somebody who has bought a reason to care
      ...(u.rooms > 0 && (P.vetDmg || P.vetHp)
        ? [{ text: `${u.rooms} rooms lived`, fg: C.gold }]
        : []),
      ...(t.tag ? [{ text: "" }, ...wrap(t.tag, wide).map((text) => ({ text, fg: C.dim }))] : []),
      { text: "" },
      { text: "back", act: { t: "army" } },
    ],
  };
}

// The line as it will stand, which is also the order it swings in. The arrows
// are the whole of the tactics you get outside a fight.
function armySpec(g: GameState, wide: number): Spec {
  const troop = reserve(g);
  const lines: Line[] = troop.length
    ? troop.map((u, k) => {
        const t = CREATURES[u.creature];
        return {
          text: `${k + 1}.${t.glyph}${t.short.padEnd(6)}${u.hp}`.slice(0, wide),
          fg: C.mid,
          act: { t: "inspect" as const, id: u.id },
          tails: [
            ...(k > 0 ? [{ text: "▲", act: { t: "up" as const, k } }] : []),
            ...(k < troop.length - 1 ? [{ text: "▼", act: { t: "down" as const, k } }] : []),
          ],
        };
      })
    : [{ text: "nothing standing", fg: C.dim }];

  lines.push({ text: "" }, { text: "close", act: { t: "close" } });
  return {
    title: g.mode === "fight" ? "IN A FIGHT" : "THE ARMY",
    minWidth: Math.min(wide, 16),
    lines,
  };
}
