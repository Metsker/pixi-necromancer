import type { Grid } from "../gfx/grid.ts";
import {
  BUFFS,
  CREATURES,
  FAMILY_COLOR,
  KINDS,
  MANA_GLYPH,
  OWNER_COLOR,
  RESOURCES,
  RES_IDS,
  SPELLS,
  TAUNT_GLYPH,
  TUNING,
  dmgPerBeat,
  growthFor,
  speedWord,
  type GameState,
  type MapNode,
  type SpellId,
} from "../sim/data.ts";
import {
  armyWorth,
  buffHere,
  canCast,
  canMobilize,
  canMove,
  listWorth,
  offersHere,
  routeTo,
  spellCost,
  spellsOf,
  stackOf,
  weekOf,
} from "../sim/game.ts";
import { sfxMuted } from "../sfx.ts";
import { C, COL, Hits, cells, cut, type Line, sheet, wrap } from "../ui.ts";

// The widest a line of a sheet is allowed to get, however wide the grid is
export const SHEET_COLS = 40;

export type PanelId =
  | "" | "node" | "army" | "unit" | "spells" | "spell" | "muster" | "menu" | "confirm";

export type Ui = {
  panel: PanelId;
  node: number;
  speed: number;
  // Whether the board is up rather than the map. There is only one fight.
  watch: boolean;
  unit: number;
  // The spell being read. One nobody can read is one nobody casts on purpose.
  spell: SpellId | null;
  // A map spell that wants a node puts the board back up to pick one on, and
  // nothing else may be over it while that is happening
  picking: SpellId | null;
};

export type Shown = PanelId | "over";

export const PANELS: Shown[] = [
  "node", "army", "unit", "spells", "spell", "muster", "menu", "confirm", "over",
];

export type Spec = { title: string; lines: Line[]; minWidth: number };

// Anything the game owes the player is shown before anything the player asked
// for. While any of these is up the clock is stopped, so nothing is missed.
export function shownPanel(g: GameState, ui: Ui): Shown {
  // Above the book, or a spell could not be read at the one moment reading it is
  // worth anything - which is before you spend the mana on it
  if (ui.panel === "spell") return "spell";
  if (g.over) return "over";
  // Picking a node for a spell puts the map back up; nothing may sit over it
  if (ui.picking) return "";
  return ui.panel;
}

export function drawPanel(grid: Grid, g: GameState, ui: Ui, hits: Hits, panel: Shown) {
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

const pct = (n: number) => `${Math.round(n)}%`;

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
    case "spells":
      return spellsSpec(g, wide);
    case "spell":
      return spellSpec(g, ui, wide);
    case "muster":
      return musterSpec(g, wide);
    case "menu":
      return {
        title: "GRAVELIGHT",
        minWidth: wide,
        lines: [
          rowAt(wide, "difficulty", `x${g.difficulty.toFixed(1)}`, C.gold),
          ...say("what their side is paid every week", C.frame),
          { text: "change it", act: { t: "difficulty" } },
          { text: "" },
          { text: sfxMuted() ? "sound: off" : "sound: on", act: { t: "sound" } },
          { text: "begin again", act: { t: "restart" }, fg: C.red },
          { text: "" },
          rowAt(wide, `week ${weekOf(g.turn) + 1}`, `turn ${g.turn + 1}`, C.dim),
          { text: "close", act: { t: "close" } },
        ],
      };
    case "confirm":
      return {
        title: "BEGIN AGAIN?",
        minWidth: wide,
        lines: [
          { text: "begin again", act: { t: "confirm" }, fg: C.red },
          { text: "no, keep going", act: { t: "close" } },
        ],
      };
    case "over": {
      const won = g.over === "won";
      return {
        title: won ? "THE THRONE IS YOURS" : "YOUR THRONE HAS FALLEN",
        minWidth: wide,
        lines: [
          ...say(
            won
              ? "The land of the living is shorter one king, and longer a great many of the dead."
              : "The living hold the ground, and you do not. What you raised lies down again.",
            won ? C.green : C.red,
          ),
          { text: "" },
          rowAt(wide, "weeks", `${weekOf(g.turn) + 1}`, C.dim),
          rowAt(wide, "nodes held", `${g.nodes.filter((n) => n.owner === "player").length}`, C.dim),
          { text: "" },
          { text: "begin again", act: { t: "confirm" } },
        ],
      };
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ a node

// One line a body, in the colour of the family it fights for, with what it can
// take and what it lands over a beat. Read a blow any other way and a slow thing
// looks like twice the threat it is.
function garrisonLines(n: MapNode, wide: number): Line[] {
  if (!n.garrison.length) return wrap("nobody is standing here", wide).map((text) => ({ text, fg: C.frame }));
  return stackOf(n.garrison).map(([c, many]) => {
    const t = CREATURES[c];
    const name = `${t.glyph} ${many > 1 ? `${t.short} x${many}` : t.short}`;
    const stat = `${t.hp}hp ${dmgPerBeat(t.dmg, t.speed)}/beat${t.taunt ? TAUNT_GLYPH : ""}`;
    return rowAt(wide, name, stat, COL(FAMILY_COLOR[t.family]));
  });
}

function nodeSpec(g: GameState, ui: Ui, wide: number): Spec {
  const n = g.nodes[ui.node];
  const info = KINDS[n.kind];
  const say = (s: string, fg: number): Line[] => wrap(s, wide).map((text) => ({ text, fg }));
  const lines: Line[] = [];

  if (!n.seen) {
    lines.push(...say("Nobody has been this way. Walk closer and it will say what it is.", C.frame));
    lines.push({ text: "" }, { text: "close", act: { t: "close" } });
    return { title: "?", minWidth: wide, lines };
  }

  const who = n.owner === "player" ? "yours" : n.owner === "enemy" ? "theirs" : "nobody's";
  lines.push(rowAt(wide, who, `tier ${n.tier}`, COL(OWNER_COLOR[n.owner])));

  // What holding it is worth, which is the whole reason to walk there
  if (info.bodies) lines.push(rowAt(wide, "makes a week", `${growthFor(n.tier)}`, C.cyan));
  if (info.gold) lines.push(rowAt(wide, "pays a week", `${RESOURCES.gold.glyph}${info.gold}`, C.gold));
  // The only thing a tower is worth, so it is the only thing worth saying
  if (info.sight > 1) lines.push(rowAt(wide, "watches, once yours", `${info.sight}`, C.cyan));
  if (n.buff) {
    const spent = n.claimed === weekOf(g.turn);
    lines.push(rowAt(wide, BUFFS[n.buff].note, BUFFS[n.buff].name, spent ? C.frame : C.green));
  }
  if (n.sealed) {
    lines.push(
      ...say(
        g.you.res.keys > 0 ? "Sealed, and you are carrying a key." : "Sealed, and you have no key.",
        g.you.res.keys > 0 ? C.cyan : C.red,
      ),
    );
  }

  lines.push({ text: "" });
  lines.push(...garrisonLines(n, wide));

  // The one comparison the sheet exists for: what is standing there against what
  // you walked in carrying
  if (n.garrison.length && n.owner !== "player") {
    const mine = armyWorth(g.you);
    const wall = listWorth(n.garrison);
    const share = pct((100 * wall) / Math.max(1, mine));
    lines.push(
      rowAt(wide, "against your line", share, wall > mine ? C.red : wall * 2 > mine ? C.gold : C.green),
    );
  }

  lines.push({ text: "" });
  const route = routeTo(g, "player", n.id);
  if (n.id === g.you.at) {
    if (offersHere(g, "player").length) lines.push({ text: "muster", act: { t: "muster" } });
    if (buffHere(g, "player")) lines.push({ text: "claim it", act: { t: "claim" } });
  } else if (route === null) {
    lines.push(...say("no way there from here", C.red));
  } else if (route.length > g.you.moves) {
    lines.push(rowAt(wide, "too far this turn", `${route.length}/${g.you.moves}`, C.red));
  } else if (canMove(g, n.id)) {
    lines.push(rowAt(wide, n.garrison.length && n.owner !== "player" ? "take it" : "go there", `${route.length}`, C.ink));
    lines[lines.length - 1].act = { t: "move" };
  }
  lines.push({ text: "close", act: { t: "close" } });
  return { title: info.name, minWidth: wide, lines };
}

// ------------------------------------------------------------------ mustering

function musterSpec(g: GameState, wide: number): Spec {
  const offers = offersHere(g, "player");
  const say = (s: string, fg: number): Line[] => wrap(s, wide).map((text) => ({ text, fg }));
  const lines: Line[] = [];
  for (const o of offers) {
    const t = CREATURES[o.creature];
    const can = canMobilize(g, "player", o.creature);
    const row = rowAt(
      wide,
      `${t.glyph} ${t.short} x${o.n}`,
      `${RESOURCES.gold.glyph}${o.cost}`,
      can ? COL(FAMILY_COLOR[t.family]) : C.frame,
    );
    if (can) row.act = { t: "grab", c: o.creature };
    lines.push(row);
  }
  if (!offers.length) lines.push(...say("nothing is standing here", C.frame));
  lines.push({ text: "" });
  lines.push(rowAt(wide, "in the purse", `${RESOURCES.gold.glyph}${g.you.res.gold}`, C.gold));
  lines.push(rowAt(wide, "slots", `${g.you.reserve.length}/${TUNING.slots}`, C.violet));
  if (offers.some((o) => canMobilize(g, "player", o.creature))) {
    lines.push({ text: "take all", act: { t: "grabAll" } });
  }
  lines.push({ text: "close", act: { t: "close" } });
  return { title: "MUSTER", minWidth: wide, lines };
}

// ------------------------------------------------------------------ the army

function armySpec(g: GameState, wide: number): Spec {
  const lines: Line[] = g.you.reserve.map((u, k) => {
    const t = CREATURES[u.creature];
    const row = rowAt(
      wide - 3,
      `${t.glyph} ${t.short} x${u.n}`,
      `${u.hp}/${u.maxHp}`,
      COL(FAMILY_COLOR[t.family]),
    );
    row.act = { t: "inspect", k };
    row.tails = [
      { text: "▲", act: { t: "up", k } },
      { text: "▼", act: { t: "down", k } },
    ];
    return row;
  });
  if (!lines.length) lines.push(...wrap("nothing is standing", wide).map((text) => ({ text, fg: C.red })));
  lines.push({ text: "" });
  lines.push(rowAt(wide, "slots", `${g.you.reserve.length}/${TUNING.slots}`, C.violet));
  lines.push({ text: "close", act: { t: "close" } });
  return { title: "THE ARMY", minWidth: wide, lines };
}

function unitSpec(g: GameState, ui: Ui, wide: number): Spec {
  const u = g.you.reserve[ui.unit];
  if (!u) return armySpec(g, wide);
  const t = CREATURES[u.creature];
  const say = (s: string, fg: number): Line[] => wrap(s, wide).map((text) => ({ text, fg }));
  const lines: Line[] = [
    rowAt(wide, `tier ${t.tier} ${t.family}`, t.role, C.dim),
    { text: "" },
    rowAt(wide, "standing", `${u.n}`, C.ink),
    rowAt(wide, "holding", `${u.hp}/${u.maxHp}`, C.ink),
    rowAt(wide, "a body hits for", `${t.dmg}`, C.ink),
    rowAt(wide, "and swings", speedWord(t.speed), C.ink),
    rowAt(wide, "all of them, a beat", `${dmgPerBeat(t.dmg * u.n, t.speed)}`, C.gold),
  ];
  if (t.taunt) lines.push(...say(`${TAUNT_GLYPH} A wall. Blows land here while it stands.`, C.blue));
  if (t.tag) lines.push(...say(t.tag, C.violet));
  lines.push({ text: "" });
  lines.push({ text: "back", act: { t: "army" } });
  lines.push({ text: "close", act: { t: "close" } });
  return { title: t.name.toUpperCase(), minWidth: wide, lines };
}

// ------------------------------------------------------------------ the book

const WINDOW_WORD: Record<string, string> = {
  map: "on the map",
  pre: "before a fight",
  post: "after a fight",
};

function spellsSpec(g: GameState, wide: number): Spec {
  const lines: Line[] = [];
  for (const id of spellsOf(g.you.family)) {
    const s = SPELLS[id];
    const can = canCast(g, "player", id);
    const cost = spellCost(g, id);
    const row = rowAt(
      wide - 2,
      `${s.glyph} ${s.name}`,
      cost > 0 ? `${MANA_GLYPH}${cost}` : id === "raise" ? "-" : `${MANA_GLYPH}${s.mana}`,
      can ? C.cyan : C.frame,
    );
    if (can) row.act = { t: "cast", id };
    row.tails = [{ text: "?", act: { t: "read", id } }];
    lines.push(row);
    lines.push({ text: cut(`  ${s.note}, ${WINDOW_WORD[s.window]}`, wide), fg: C.frame });
  }
  lines.push({ text: "" });
  lines.push(rowAt(wide, "mana", `${MANA_GLYPH}${g.you.mana}/${TUNING.manaCap}`, C.cyan));
  lines.push(...wrap(`+${TUNING.manaTurn} a turn; your own city fills it`, wide).map((text) => ({ text, fg: C.frame })));
  lines.push({ text: "close", act: { t: "close" } });
  return { title: "THE BOOK", minWidth: wide, lines };
}

function spellSpec(g: GameState, ui: Ui, wide: number): Spec {
  const id = ui.spell;
  if (!id) return spellsSpec(g, wide);
  const s = SPELLS[id];
  const say = (str: string, fg: number): Line[] => wrap(str, wide).map((text) => ({ text, fg }));
  const cost = spellCost(g, id);
  return {
    title: s.name,
    minWidth: wide,
    lines: [
      rowAt(wide, WINDOW_WORD[s.window], id === "raise" ? "per body" : `${MANA_GLYPH}${cost || s.mana}`, C.cyan),
      { text: "" },
      ...say(s.desc, C.ink),
      { text: "" },
      { text: "back", act: { t: "spells" } },
      { text: "close", act: { t: "close" } },
    ],
  };
}

// Read by the hud so the resource row does not have to know the ids
export { RES_IDS };
