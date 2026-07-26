// The three natures, and what each one lets him buy. Numbers and templates
// only - every key here is read at exactly one place in game.ts.
import type { CreatureId } from "./data.ts";

export type PathId = "rat" | "pack" | "lord";

export type Perk =
  // generic, threaded through all three: what the old stat menu used to sell
  | "slots"
  | "manaPool"
  | "dmg"
  | "hp"
  // rat king
  | "raiseCost"
  | "riseLuck"
  | "swarmPer"
  | "swarmCap"
  | "ratHp"
  | "ratDmg"
  // pack
  | "minionDmg"
  | "vetDmg"
  | "vetHp"
  | "mend"
  // lord
  | "front"
  | "eat"
  | "eatMaxHp"
  | "wispFirst"
  | "wall"
  | "lordDmg";

export type Perks = Record<Perk, number>;

export const PERK_IDS: Perk[] = [
  "slots", "manaPool", "dmg", "hp",
  "raiseCost", "riseLuck", "swarmPer", "swarmCap", "ratHp", "ratDmg",
  "minionDmg", "vetDmg", "vetHp", "mend",
  "front", "eat", "eatMaxHp", "wispFirst", "wall", "lordDmg",
];

// col and row place it on the grid; the links are whatever it ends up beside,
// which is the same rule the map uses and means the shape is the data
export type TreeNode = {
  id: number;
  col: number;
  row: number;
  name: string;
  note: string; // what it does, short enough for the narrowest sheet
  gives: Partial<Perks>;
};

export type Path = {
  id: PathId;
  name: string;
  note: string;
  hint: string; // what he walks in with, said at the gate
  glyph: string;
  color: number; // index into PALETTE
  start: CreatureId[];
  slots: number; // what the nature itself is worth in bodies, before any node
  nodes: TreeNode[];
};

export const TREE_COLS = 3;
export const TREE_ROWS = 4;
export const ROOT = { col: 1, row: 0 };

// Written in reading order, so a grid of twelve is twelve lines
const grid = (rows: [string, string, Partial<Perks>][][]): TreeNode[] =>
  rows.flatMap((row, r) =>
    row.map(([name, note, gives], c) => ({ id: r * TREE_COLS + c, col: c, row: r, name, note, gives })),
  );

export const PATHS: Record<PathId, Path> = {
  // More of them, cheaper to ask for, and rats that are worth having a lot of
  rat: {
    id: "rat",
    name: "RAT KING",
    note: "the many",
    hint: "3 rats, +1 body",
    glyph: "⚇",
    color: 15,
    start: ["rat", "rat", "rat"],
    slots: 1,
    nodes: grid([
      [
        ["CHEAP ASKING", "asking -1", { raiseCost: -1 }],
        ["THE MANY", "+1 body", { slots: 1 }],
        ["THIN BLOOD", "rats +6 hp", { ratHp: 6 }],
      ],
      [
        ["GRAVE-GLUT", "more get up free", { riseLuck: 10 }],
        ["TEETH", "swarm +1 a head", { swarmPer: 1 }],
        ["VERMIN", "rats +2 dmg", { ratDmg: 2 }],
      ],
      [
        ["DEEP WELL", "+5 asking", { manaPool: 5 }],
        ["THE HORDE", "+2 bodies", { slots: 2 }],
        ["MIGHT", "+3 dmg", { dmg: 3 }],
      ],
      [
        ["THIN BLOOD II", "asking -1 again", { raiseCost: -1 }],
        ["WARD", "+30 hp", { hp: 30 }],
        ["KING OF RATS", "+2 bodies, teeth", { slots: 2, ratDmg: 3, swarmCap: 6 }],
      ],
    ]),
  },

  // Fewer of them, each one worth mending, each one worth more the longer it lasts
  pack: {
    id: "pack",
    name: "PACK",
    note: "the few",
    hint: "1 hound, -1 body",
    glyph: "⋒",
    color: 14,
    start: ["hound"],
    slots: -1,
    nodes: grid([
      [
        ["GRIT", "mend the worst", { mend: 8 }],
        ["THE FEW", "minions +4 dmg", { minionDmg: 4 }],
        ["VETERANCY", "+2 dmg a room", { vetDmg: 2 }],
      ],
      [
        ["SPARE NOTHING", "mends +6 more", { mend: 6 }],
        ["HARD YEARS", "+3 hp a room", { vetHp: 3 }],
        ["OLD BLOOD", "+2 dmg a room", { vetDmg: 2 }],
      ],
      [
        ["MANA", "+5 asking", { manaPool: 5 }],
        ["LEANER", "-1 body, +5 dmg", { slots: -1, minionDmg: 5 }],
        ["MIGHT", "+3 dmg", { dmg: 3 }],
      ],
      [
        ["THE BOND", "mends +10 more", { mend: 10 }],
        ["WARD", "+30 hp", { hp: 30 }],
        ["THE PACK", "old bones bite", { vetDmg: 3, vetHp: 4, minionDmg: 5 }],
      ],
    ]),
  },

  // He stands at the front of it and is fed by everything behind him
  lord: {
    id: "lord",
    name: "LORD",
    note: "yourself",
    hint: "knight and wisp",
    glyph: "⌤",
    color: 22,
    // A wall and a mender, because both of his answers are things standing
    // behind him and one body behind him is not a line
    start: ["knight", "wisp"],
    slots: 0,
    // He walks in at the back like anybody else. Stepping to the front is the
    // root of the tree, not the nature - a man with no nodes at the head of his
    // own line is dead by the third room, which is a trap and not a gamble. The
    // wall sits next to the root so the first thing he can buy is the answer.
    nodes: grid([
      [
        ["THE LINE", "-12% a body back", { wall: 12 }],
        ["TAKE THE FRONT", "you go first", { front: 1, eat: 18, wall: 10 }],
        ["STRONG BACK", "+3 dmg a body", { lordDmg: 3 }],
      ],
      [
        ["UNBROKEN", "-8% a body back", { wall: 8 }],
        ["WARD", "+30 hp", { hp: 30 }],
        ["FIRST TENDED", "wisps mend you", { wispFirst: 1 }],
      ],
      [
        ["MANA", "+5 asking", { manaPool: 5 }],
        ["RETINUE", "+1 body", { slots: 1 }],
        ["MIGHT", "+3 dmg", { dmg: 3 }],
      ],
      [
        ["GRAVE-FED", "eating lifts you", { eatMaxHp: 6 }],
        ["GLUTTON", "eating heals +12", { eat: 12 }],
        ["THE LORD", "the line holds", { wall: 10, lordDmg: 4, hp: 40 }],
      ],
    ]),
  },
};

export const PATH_IDS: PathId[] = ["rat", "pack", "lord"];

export const rootId = ROOT.row * TREE_COLS + ROOT.col;

// Whatever it ends up beside. Same rule as the map: orthogonal only, so every
// join between two nodes is one straight run of line.
export const linksOf = (p: Path, n: TreeNode): number[] =>
  p.nodes
    .filter((o) => Math.abs(o.col - n.col) + Math.abs(o.row - n.row) === 1)
    .map((o) => o.id);
