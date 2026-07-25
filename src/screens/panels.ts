import type { Grid } from "../gfx/grid.ts";
import { LORE } from "../sim/lore.ts";
import {
  CREATURES,
  KIND_NAME,
  KIND_NOTE,
  RESOURCES,
  RES_IDS,
  STAT_LABEL,
  type CreatureId,
  type GameState,
  type Stat,
} from "../sim/data.ts";
import { canAdvance, canMove, canSend, commandCap } from "../sim/game.ts";
import { C, Hits, type Line, sheet, wrap } from "../ui.ts";

export type PanelId = "" | "node" | "roster" | "army" | "menu" | "confirm";

export type Ui = {
  panel: PanelId;
  node: number;
  pick: number[];
  speed: number;
};

export type Shown = PanelId | "level" | "reward" | "lore" | "over";

export const PANELS: Shown[] = [
  "node",
  "roster",
  "army",
  "menu",
  "confirm",
  "level",
  "reward",
  "lore",
  "over",
];

export type Spec = { title: string; lines: Line[]; minWidth: number };

// Anything the run owes the player is shown before anything the player asked for
export function shownPanel(g: GameState, ui: Ui): Shown {
  if (g.pending) return "reward";
  if (g.pendingLore !== null) return "lore";
  if (g.unspent > 0) return "level";
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
  const wide = Math.max(4, cols - 6);
  const say = (s: string, fg: number): Line[] => wrap(s, wide).map((text) => ({ text, fg }));

  switch (panel) {
    case "node":
      return nodeSpec(g, ui, wide);
    case "roster":
      return rosterSpec(g, ui, wide, true);
    case "army":
      return rosterSpec(g, ui, wide, false);
    case "menu":
      return {
        title: "MENU",
        minWidth: Math.min(wide, 16),
        lines: [
          { text: `might ${g.build.might}`, fg: C.mid },
          { text: `ward  ${g.build.ward}`, fg: C.mid },
          { text: `will  ${g.build.will}`, fg: C.mid },
          { text: "" },
          ...say(`rooms cleared ${g.cleared}`, C.dim),
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
    case "level":
      return {
        title: `LEVEL ${g.level + 1}`,
        minWidth: 0,
        lines: [
          { text: STAT_LABEL.might, act: { t: "stat", s: "might" as Stat } },
          { text: STAT_LABEL.ward, act: { t: "stat", s: "ward" as Stat } },
          { text: STAT_LABEL.will, act: { t: "stat", s: "will" as Stat } },
        ],
      };
    case "reward":
      return rewardSpec(g, wide);
    case "lore": {
      const piece = LORE[g.pendingLore ?? 0];
      return {
        title: piece.title.slice(0, wide),
        minWidth: wide,
        lines: [...say(piece.body, C.mid), { text: "" }, { text: "continue", act: { t: "ok" } }],
      };
    }
    case "over":
      return {
        title: g.over === "won" ? "IT IS DONE" : "YOU FELL",
        minWidth: Math.min(wide, 16),
        lines: [
          ...say(g.over === "won" ? "the ossuary lies still" : "the army crumbles", C.dim),
          ...say(`rooms cleared ${g.cleared}`, C.dim),
          { text: "" },
          { text: "new run", act: { t: "confirm" } },
        ],
      };
    default:
      return null;
  }
}

export function drawPanel(grid: Grid, g: GameState, ui: Ui, hits: Hits, panel: Shown) {
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
  lines.push({ text: "" });

  if (canMove(g, n.id)) lines.push({ text: "walk there", act: { t: "move" } });
  if (canAdvance(g, n.id)) lines.push({ text: "go in yourself", act: { t: "advance" } });
  else if (n.state === "open") lines.push({ text: "too far to walk", fg: C.dim });
  if (canSend(g, n.id)) lines.push({ text: "send a squad", act: { t: "squad" } });
  lines.push({ text: "close", act: { t: "close" } });

  return {
    title: (n.state === "locked" ? "SEALED" : KIND_NAME[n.kind]).slice(0, wide),
    minWidth: Math.min(wide, 16),
    lines,
  };
}

function rosterSpec(g: GameState, ui: Ui, wide: number, select: boolean): Spec {
  const lines: Line[] = [];
  if (!g.army.length) lines.push({ text: "nothing raised", fg: C.dim });

  for (const u of g.army) {
    const t = CREATURES[u.creature];
    const on = ui.pick.includes(u.id);
    lines.push({
      text: `${select ? (on ? "►" : " ") : " "}${t.glyph} ${t.short.padEnd(7)}${u.hp}/${u.maxHp}`,
      act: select ? { t: "toggle", id: u.id } : undefined,
      fg: select ? (on ? C.gold : C.mid) : C.mid,
    });
    if (!select) for (const text of wrap(t.tag, wide - 3)) lines.push({ text: `   ${text}`, fg: C.dim });
  }

  lines.push({ text: "" });
  if (select) {
    if (ui.pick.length) lines.push({ text: `send ${ui.pick.length}`, act: { t: "send" } });
    lines.push({ text: "back", act: { t: "node", id: ui.node } });
  } else {
    lines.push({ text: `slots ${g.army.length}/${commandCap(g)}`, fg: C.dim });
    lines.push({ text: "close", act: { t: "close" } });
  }
  return { title: select ? "SEND SQUAD" : "THE ARMY", minWidth: Math.min(wide, 16), lines };
}

function rewardSpec(g: GameState, wide: number): Spec {
  const r = g.pending!;
  const squad = r.side === "squad";
  const lines: Line[] = [];
  const say = (s: string, fg: number) => {
    for (const text of wrap(s, wide)) lines.push({ text, fg });
  };

  // An expedition reports on rooms; a room you took yourself needs no headline
  if (squad) say(r.rooms ? `took ${r.rooms} rooms` : "took nothing", r.rooms ? C.pale : C.dim);
  lines.push({ text: `+${r.xp} xp`, fg: C.gold });

  const spoils = RES_IDS.filter((k) => r.res[k] > 0)
    .map((k) => `${RESOURCES[k].glyph}${r.res[k]}`)
    .join("  ");
  if (spoils) lines.push({ text: spoils, fg: C.cyan });
  if (r.raised.length) say(`rose: ${r.raised.map((c) => CREATURES[c].short).join(", ")}`, C.green);
  if (r.lost) say(squad ? `${r.lost} never came back` : `lost ${r.lost}`, C.red);

  lines.push({ text: "" }, { text: "continue", act: { t: "ok" } });
  return { title: squad ? "THE EXPEDITION" : "SPOILS", minWidth: Math.min(wide, 16), lines };
}
