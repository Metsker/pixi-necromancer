import type { Surface } from "../gfx/surface.ts";
import { TREE_GLYPH, type GameState } from "../sim/data.ts";
import { treeOpen } from "../sim/game.ts";
import { ARMS, TREE, TREE_COLS, TREE_ROWS, depthOf, linksOf, type TreeNode } from "../sim/tree.ts";
import { C, COL, Hits, box, cells, cut } from "../ui.ts";

// One node step in character cells. Three across is a board a thumb can hit and
// a phone can hold without a camera.
const STEP_X = 3;
const STEP_Y = 2;
const BOARD_W = (TREE_COLS - 1) * STEP_X + 1;
const BOARD_H = (TREE_ROWS - 1) * STEP_Y + 1;

// The widest a line under the board is allowed to be, which is what decides how
// wide the sheet gets. Node names and notes are written to fit it.
export const TREE_TEXT = 16;

export const treeWidth = () => Math.max(BOARD_W, TREE_TEXT) + 4;

// What a node is right now. Bought, next, or still behind something.
export const stateOf = (g: GameState, id: number): keyof typeof TREE_GLYPH =>
  g.taken.includes(id) ? "taken" : treeOpen(g).includes(id) ? "open" : "sealed";

const tint = (n: TreeNode) => (n.arm ? COL(ARMS[n.arm].color) : C.gold);

export function drawTree(grid: Surface, g: GameState, hits: Hits, sel: number) {
  const open = treeOpen(g);
  const node = TREE[sel] as TreeNode | undefined;
  const buyable = node !== undefined && g.unspent > 0 && open.includes(node.id);

  // Under the board: what is selected, what it does, the buy, the way out. They
  // are always all four, so the box does not change height as you tap around it.
  const w = Math.min(grid.cols, treeWidth());
  const h = Math.min(grid.rows, BOARD_H + 13);
  const x = Math.max(0, (grid.cols - w) >> 1);
  const y = Math.max(0, (grid.rows - h) >> 1);
  box(grid, x, y, w, h);
  hits.add(x, y, w, h, { t: "none" });

  const title = node?.arm ? ARMS[node.arm].name : "THE TREE";
  grid.center(x + 1, y + 1, w - 2, title, node ? tint(node) : C.gold);
  const points = g.unspent > 0 ? `${g.unspent} to spend` : `level ${g.level + 1}`;
  grid.center(x + 1, y + 2, w - 2, points, g.unspent > 0 ? C.gold : C.dim);

  const bx = x + ((w - BOARD_W) >> 1);
  const by = y + 4;

  // Links first, so a node is drawn over its own joins
  for (const n of TREE) {
    for (const id of linksOf(n)) {
      if (id < n.id) continue;
      const o = TREE[id];
      const both = g.taken.includes(n.id) && g.taken.includes(id);
      const live = g.taken.includes(n.id) || g.taken.includes(id);
      const ink = both ? tint(n.arm ? n : o) : live ? C.dim : C.frame;
      if (n.row === o.row) {
        const from = Math.min(n.col, o.col);
        for (let i = 1; i < STEP_X; i++) grid.put(bx + from * STEP_X + i, by + n.row * STEP_Y, "─", ink);
      } else {
        const from = Math.min(n.row, o.row);
        for (let j = 1; j < STEP_Y; j++) grid.put(bx + n.col * STEP_X, by + from * STEP_Y + j, "│", ink);
      }
    }
  }

  for (const n of TREE) {
    const state = stateOf(g, n.id);
    const nx = bx + n.col * STEP_X;
    const ny = by + n.row * STEP_Y;
    const ink =
      state === "taken" ? tint(n) : state === "open" ? (g.unspent > 0 ? C.gold : C.mid) : C.frame;
    // The one you are reading wears the frame colour behind it, which is the only
    // way to say "this one" on a board made of single characters
    grid.put(nx, ny, TREE_GLYPH[state], n.id === sel ? C.shade : ink, n.id === sel ? ink : C.bg);
    hits.add(nx - 1, ny, STEP_X, STEP_Y, { t: "pick", id: n.id });
  }

  let ly = by + BOARD_H + 1;
  const text = (s: string, fg: number) => {
    if (ly < y + h - 1) grid.text(x + 2, ly, cut(s, w - 4), fg);
    ly += 1;
  };
  if (node) {
    text(node.name, stateOf(g, node.id) === "sealed" ? C.dim : C.ink);
    text(node.note, C.mid);
  } else {
    ly += 2;
  }
  ly += 1;

  // A line you can tap gets two rows, the same as anywhere else a thumb lands.
  // A grid too short for all of them drops them rather than writing on the frame.
  const act = (s: string, fg: number, a: Parameters<Hits["add"]>[4] | null) => {
    if (ly + 2 > y + h - 1) return;
    grid.text(x + 2, ly, cut(s, w - 4), fg);
    if (a) hits.add(x, ly, w, 2, a);
    ly += 2;
  };
  if (buyable) act("take it", C.ink, { t: "take", id: node.id });
  else if (node && g.taken.includes(node.id)) act("bought", tint(node), null);
  else if (node && node.arm && armShort(g, node)) act(armShort(g, node)!, C.dim, null);
  else act("not yet", C.dim, null);
  act("close", C.ink, { t: "close" });
}

// Why a node is still shut, when the reason is the arm rather than the board.
// A player who cannot see the gate reads it as a bug.
function armShort(g: GameState, n: TreeNode): string | null {
  if (!n.arm) return null;
  const need = depthOf(n) - 1;
  const have = g.taken.filter((id) => TREE[id].arm === n.arm).length;
  return have < need ? `needs ${need} in arm` : null;
}

// Held to the same rule as every sheet: nothing is written wider than the box
export const treeLines = (): string[] =>
  TREE.flatMap((n) => [n.name, n.note]).concat(Object.values(ARMS).map((a) => a.name));

export const treeFits = (): boolean => treeLines().every((s) => cells(s) <= TREE_TEXT);
