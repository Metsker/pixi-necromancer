import type { Grid } from "../gfx/grid.ts";
import { LORE } from "../sim/lore.ts";
import {
  CREATURES,
  KINDS,
  RESOURCES,
  RES_IDS,
  TAUNT_GLYPH,
  TUNING,
  tierDmgFor,
  tierHpFor,
  type GameState,
} from "../sim/data.ts";
import {
  canOrder,
  needsKey,
  perks,
  raiseAs,
  reserve,
  stackDmg,
  stackOf,
  unitDmg,
  wallish,
  type Meta,
} from "../sim/game.ts";
import { sfxMuted } from "../sfx.ts";
import { TREE } from "../sim/tree.ts";
import { ARMS, POWERS, POWER_BY_ID } from "../sim/powers.ts";
import { C, COL, Hits, cells, cut, type Line, sheet, wrap } from "../ui.ts";
import { drawTree } from "./tree.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// The widest a line of a sheet is allowed to get, however wide the grid is
export const SHEET_COLS = 40;

export type PanelId = "" | "node" | "army" | "unit" | "menu" | "confirm" | "tree" | "power" | "gifts";

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
  // The card being read. A card nobody can read is a card nobody drafts on purpose.
  power: string;
};

export type Shown = PanelId | "lore" | "over" | "draft";

// The tree draws itself rather than going through sheet(), so it is not listed
// here: what this drives is the width check, and a board is not a list of lines.
export const PANELS: Shown[] = [
  "node", "army", "unit", "menu", "confirm", "lore", "over", "draft", "power", "gifts",
];

export type Spec = { title: string; lines: Line[]; minWidth: number };

// Anything the run owes the player is shown before anything the player asked
// for. While any of these is up the clock is stopped, so nothing is missed.
export function shownPanel(g: GameState, ui: Ui): Shown {
  if (g.loreQueue.length) return "lore";
  // Above the draft, or a card cannot be read before it is taken - which is the
  // one moment reading it is worth anything
  if (ui.panel === "power") return "power";
  if (g.unspent > 0 && g.offer.length) return "draft";
  // Above the end of a run, because the end of a run is where the board is spent
  if (ui.panel === "tree") return "tree";
  if (g.over) return "over";
  return ui.panel;
}

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
    case "power":
      return powerSpec(g, ui, wide);
    case "gifts":
      return giftsSpec(g, wide);
    case "menu":
      return {
        title: "MENU",
        minWidth: Math.min(wide, 16),
        lines: [
          { text: `tree ${g.taken.length}/${TREE.length}`, act: { t: "tree" }, fg: C.gold },
          { text: `gifts ${g.powers.length}`, act: { t: "gifts" }, fg: C.violet },
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
    // The level-up. Three of them, coloured by the arm they belong to, with the
    // whole of what each one does one tap away behind the `?`.
    case "draft": {
      const lines: Line[] = [];
      for (const id of g.offer) {
        const p = POWER_BY_ID[id];
        if (!p) continue;
        // A gap between the cards, or one card's note reads as the next one's
        if (lines.length) lines.push({ text: "" });
        lines.push({
          text: p.name,
          act: { t: "power", id },
          fg: COL(ARMS[p.arm].color),
          tails: [{ text: "?", act: { t: "read", id } }],
        });
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

// A name on the left and a number against the right edge, at exactly `wide`.
// Every list in here is built out of this, so nothing drifts out of its column.
const rowAt = (wide: number, left: string, right: string, fg: number): Line => {
  const r = cut(right, Math.max(0, wide - 1));
  const room = Math.max(0, wide - cells(r) - 1);
  const l = cut(left, room);
  return { text: `${l}${" ".repeat(room - cells(l))} ${r}`, fg };
};

// What is standing in a room, before you walk into it: one line a slot, in the
// colour it fights in, with what it can take against what it can give. This is
// the whole of the decision to take a room or leave it standing.
function nodeSpec(g: GameState, ui: Ui, wide: number): Spec {
  const n = g.nodes[ui.node];
  const info = KINDS[n.kind];
  const lines: Line[] = [];
  const say = (s: string, fg: number) => {
    for (const text of wrap(s, wide)) lines.push({ text, fg });
  };

  if (n.state === "locked") {
    say("sealed until a way is opened beside it", C.dim);
  } else if (n.state === "cleared") {
    say(info.note, C.dim);
    say("already quiet", C.dim);
  } else {
    say(info.note, C.dim);
    lines.push({ text: "" });

    let theirHp = 0;
    let theirDmg = 0;
    let wall = false;
    for (const [c, count] of stackOf(n.foes)) {
      const t = CREATURES[c];
      const hp = (t.hp + tierHpFor(n.tier)) * count;
      const dmg = (t.dmg + tierDmgFor(n.tier)) * count;
      theirHp += hp;
      theirDmg += dmg;
      wall = wall || t.taunt;
      const mark = t.taunt ? TAUNT_GLYPH : "";
      lines.push(rowAt(wide, `${t.glyph}${t.short}${count > 1 ? ` x${count}` : ""}${mark}`, `♥${hp}`, COL(t.color)));
    }

    // Yours against theirs, in the two numbers a fight is actually decided by.
    // A wall on their side means none of that damage reaches anything behind it.
    const troop = reserve(g);
    const ourHp = troop.reduce((s, u) => s + u.hp, 0);
    const ourDmg = troop.reduce((s, u) => s + stackDmg(g, u), 0);
    lines.push({ text: "" });
    lines.push(rowAt(wide, `them ✕${theirDmg}`, `♥${theirHp}`, C.red));
    lines.push(rowAt(wide, `you  ✕${ourDmg}`, `♥${ourHp}`, C.green));
    if (wall) say(`${TAUNT_GLYPH} a wall stands in front`, C.blue);

    // What the room is worth beyond the fight: what it hands over, what gets up
    // out of it for nothing, and what a living body comes back as
    const P = perks(g);
    const living = n.foes.filter((c) => CREATURES[c].rises);
    if (living.length) {
      say(`they rise as ${CREATURES[raiseAs(P, living[0])].short}`, C.violet);
    }
    if (info.freeRise) say("the dead here rise free", C.violet);
    if (info.gift) say(`${CREATURES[info.gift].short} is sealed in here`, C.violet);
    if (info.keys) say(`${RESOURCES.keys.glyph} it is carrying a key`, C.cyan);
    if (needsKey(n)) {
      const have = g.res.keys > 0;
      say(
        have ? `${RESOURCES.keys.glyph} a key opens it` : `${RESOURCES.keys.glyph} you have no key`,
        have ? C.cyan : C.red,
      );
    }
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
    title: (n.state === "locked" ? "SEALED" : `${info.glyph} ${info.name}`).slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines,
  };
}

// The whole of what a card does, in plain words. Reachable from the hand it is
// offered in and from the list of what has already been taken.
function powerSpec(g: GameState, ui: Ui, wide: number): Spec {
  const p = POWER_BY_ID[ui.power] ?? POWERS[0];
  const held = g.powers.filter((id) => id === p.id).length;
  const offered = g.offer.includes(p.id) && g.unspent > 0;
  return {
    title: p.name.slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines: [
      { text: ARMS[p.arm].name, fg: COL(ARMS[p.arm].color) },
      ...wrap(
        p.rare ? "a rule, taken once" : `a number, up to ${TUNING.powerStack} deep`,
        wide,
      ).map((text) => ({ text, fg: C.dim })),
      { text: "" },
      ...wrap(p.desc, wide).map((text) => ({ text, fg: C.mid })),
      ...(held ? [{ text: "" }, { text: `you hold ${held}`, fg: C.gold }] : []),
      { text: "" },
      ...(offered ? [{ text: "take it", act: { t: "power" as const, id: p.id }, fg: C.ink }] : []),
      // Back where it was read from, or reading a card you already hold throws
      // you out to the map
      { text: "back", act: offered ? { t: "close" } : { t: "gifts" } },
    ],
  };
}

// Everything the dark has already given, stacked, and every one of them one tap
// from what it actually does
function giftsSpec(g: GameState, wide: number): Spec {
  const held = stackOf(g.powers);
  const lines: Line[] = held.length
    ? held.map(([id, n]) => {
        const p = POWER_BY_ID[id];
        return {
          ...rowAt(wide, p ? p.name : id, n > 1 ? `x${n}` : "", p ? COL(ARMS[p.arm].color) : C.dim),
          act: { t: "read" as const, id },
        };
      })
    : [{ text: "nothing yet", fg: C.dim }];
  lines.push({ text: "" }, { text: "close", act: { t: "close" } });
  return { title: "THE DARK GAVE", minWidth: Math.min(wide, 16), lines };
}

// What a slot is, on its own sheet, so the line in the list stays a line
function unitSpec(g: GameState, ui: Ui, wide: number): Spec {
  const u = reserve(g).find((o) => o.id === ui.unit);
  if (!u) return { title: "GONE", minWidth: 0, lines: [{ text: "back", act: { t: "army" } }] };
  const t = CREATURES[u.creature];
  const P = perks(g);
  const each = unitDmg(g, u);
  return {
    title: t.name.slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines: [
      // Nothing caps how deep a slot goes, so every line of this sheet is cut to
      // the box rather than trusted to be short
      { text: cut(`${t.glyph} ${u.hp}/${u.maxHp}`, wide), fg: C.ink },
      { text: `${t.role} - ${t.family}`, fg: C.gold },
      ...(u.n > 1 ? [{ text: cut(`${u.n} of them`, wide), fg: C.mid }] : []),
      { text: cut(`hits for ${each * u.n}`, wide), fg: C.mid },
      ...(u.n > 1 ? [{ text: cut(`${each} each`, wide), fg: C.dim }] : []),
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
  // Room for the arrows at the end of the line, which is what a tap moves
  const room = Math.max(4, wide - 3);
  const lines: Line[] = troop.length
    ? troop.map((u, k) => {
        const t = CREATURES[u.creature];
        return {
          ...rowAt(room, `${k + 1}.${t.glyph}${t.short}${u.n > 1 ? ` x${u.n}` : ""}`, `${u.hp}`, C.mid),
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
