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

export function drawPanel(grid: Grid, g: GameState, ui: Ui, hits: Hits, panel: Shown) {
  const wide = Math.max(0, grid.cols - 6);
  switch (panel) {
    case "node":
      return nodeSheet(grid, g, ui, hits);
    case "roster":
      return rosterSheet(grid, g, ui, hits, true);
    case "army":
      return rosterSheet(grid, g, ui, hits, false);
    case "menu":
      return sheet(grid, hits, "MENU", [
        { text: `rooms cleared ${g.cleared}`, fg: C.dim },
        { text: `lore ${g.seenLore.length}/${LORE.length}`, fg: C.dim },
        { text: "" },
        { text: "restart run", act: { t: "restart" } },
        { text: "close", act: { t: "close" } },
      ]);
    case "confirm":
      return sheet(grid, hits, "RESTART?", [
        { text: "this run is lost", fg: C.dim },
        { text: "yes, restart", act: { t: "confirm" } },
        { text: "no, keep going", act: { t: "close" } },
      ]);
    case "level":
      return sheet(grid, hits, `LEVEL ${g.level + 1}`, [
        { text: STAT_LABEL.might, act: { t: "stat", s: "might" as Stat } },
        { text: STAT_LABEL.ward, act: { t: "stat", s: "ward" as Stat } },
        { text: STAT_LABEL.will, act: { t: "stat", s: "will" as Stat } },
      ]);
    case "reward":
      return rewardSheet(grid, g, hits);
    case "lore": {
      const piece = LORE[g.pendingLore ?? 0];
      return sheet(
        grid,
        hits,
        piece.title,
        [
          ...wrap(piece.body, wide).map((text) => ({ text, fg: C.mid })),
          { text: "" },
          { text: "continue", act: { t: "ok" as const } },
        ],
        wide,
      );
    }
    case "over":
      return sheet(grid, hits, g.over === "won" ? "IT IS DONE" : "YOU FELL", [
        {
          text: g.over === "won" ? "the ossuary lies still" : "the army crumbles",
          fg: C.dim,
        },
        { text: `rooms cleared ${g.cleared}`, fg: C.dim },
        { text: "" },
        { text: "new run", act: { t: "confirm" } },
      ]);
    default:
      return;
  }
}

function nodeSheet(grid: Grid, g: GameState, ui: Ui, hits: Hits) {
  const n = g.nodes[ui.node];
  const wide = Math.max(0, grid.cols - 6);
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

  const title = n.state === "locked" ? "SEALED" : KIND_NAME[n.kind];
  return sheet(grid, hits, title, lines, Math.min(wide, 18));
}

function rosterSheet(grid: Grid, g: GameState, ui: Ui, hits: Hits, select: boolean) {
  const lines: Line[] = [];
  if (!g.army.length) lines.push({ text: "nothing raised", fg: C.dim });

  for (const u of g.army) {
    const t = CREATURES[u.creature];
    const on = ui.pick.includes(u.id);
    const mark = select ? (on ? "►" : " ") : " ";
    lines.push({
      text: `${mark}${t.glyph} ${t.short.padEnd(7)}${u.hp}/${u.maxHp}`,
      act: select ? { t: "toggle", id: u.id } : undefined,
      fg: select ? (on ? C.gold : C.mid) : C.mid,
    });
    if (!select) lines.push({ text: `   ${t.tag}`, fg: C.dim });
  }

  lines.push({ text: "" });
  if (select) {
    if (ui.pick.length) lines.push({ text: `send ${ui.pick.length}`, act: { t: "send" } });
    lines.push({ text: "back", act: { t: "node", id: ui.node } });
  } else {
    lines.push({ text: `slots ${g.army.length}/${commandCap(g)}`, fg: C.dim });
    lines.push({ text: "close", act: { t: "close" } });
  }
  return sheet(grid, hits, select ? "SEND SQUAD" : "THE ARMY", lines, 18);
}

function rewardSheet(grid: Grid, g: GameState, hits: Hits) {
  const r = g.pending!;
  const lines: Line[] = [{ text: `+${r.xp} xp`, fg: C.gold }];

  const spoils = RES_IDS.filter((k) => r.res[k] > 0)
    .map((k) => `${RESOURCES[k].glyph}${r.res[k]}`)
    .join("  ");
  if (spoils) lines.push({ text: spoils, fg: C.cyan });
  if (r.raised.length) {
    lines.push({ text: `rose: ${r.raised.map((c) => CREATURES[c].short).join(", ")}`, fg: C.green });
  }
  if (r.lost) lines.push({ text: `lost ${r.lost}`, fg: C.red });
  if (r.side === "squad") lines.push({ text: "half share, no you", fg: C.dim });

  lines.push({ text: "" }, { text: "continue", act: { t: "ok" } });
  return sheet(grid, hits, "SPOILS", lines, 18);
}
