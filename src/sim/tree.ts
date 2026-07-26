// The tree is neutral: it buys access, not power. What an arm does lives in
// powers.ts now, and every key here is read at exactly one place in game.ts.

export type Perk =
  // the neutral board: what you can hold, what you can spend, and how good the
  // offer is when the dark makes you one
  | "slots"
  | "manaPool"
  | "manaRise"
  | "raiseCost"
  | "restMore"
  | "offers"
  | "rerolls"
  | "xpCut"
  | "startBand"
  // swarm: more of them, cheaper to ask for, and rats worth having a lot of
  | "riseLuck"
  | "swarmPer"
  | "swarmCap"
  | "swarmAll"
  | "swarmDead"
  | "glut"
  | "ratHp"
  | "ratDmg"
  // bond: fewer of them, and a wall worth standing behind
  | "minionDmg"
  | "vetDmg"
  | "vetHp"
  | "mend"
  | "wallHp"
  | "wallCut"
  | "wallAll"
  // control: what the dark does to the other side
  | "witherPow"
  | "witherLong"
  | "witherAll"
  | "rot"
  | "hexDmg"
  | "dread"
  | "spite";

export type Perks = Record<Perk, number>;

export const PERK_IDS: Perk[] = [
  "slots", "manaPool", "manaRise", "raiseCost", "restMore", "offers", "rerolls", "xpCut", "startBand",
  "riseLuck", "swarmPer", "swarmCap", "swarmAll", "swarmDead", "glut", "ratHp", "ratDmg",
  "minionDmg", "vetDmg", "vetHp", "mend", "wallHp", "wallCut", "wallAll",
  "witherPow", "witherLong", "witherAll", "rot", "hexDmg", "dread", "spite",
];

// col and row place it on the board; the links are whatever it ends up beside,
// which is the same rule the map uses and means the shape is the data. Distance
// out is the price, so the far corners are what a long game is for.
export type TreeNode = {
  id: number;
  col: number;
  row: number;
  name: string;
  note: string; // what it does, short enough for the narrowest sheet
  gives: Partial<Perks>;
};

export const TREE_COLS = 5;
export const TREE_ROWS = 5;
export const ROOT = { col: 2, row: 2 };

// Written out cell by cell, because the shape is the point. The root is index
// zero and comes free.
const LAID: [number, number, string, string, Partial<Perks>][] = [
  [2, 2, "THE GRAVE", "+1 body", { slots: 1 }],

  [2, 1, "DEEP POCKETS", "+4 asking", { manaPool: 4 }],
  [1, 2, "COLD HANDS", "asking -1", { raiseCost: -1 }],
  [3, 2, "QUICK STUDY", "level sooner", { xpCut: 10 }],

  [1, 1, "THE HOARD", "+1 body", { slots: 1 }],
  [3, 1, "SECOND WIND", "+8% a room", { manaRise: 8 }],
  [2, 0, "GRAVE GOODS", "+6 asking", { manaPool: 6 }],
  [0, 2, "LONG REST", "+10% healed", { restMore: 10 }],
  [1, 3, "A WIDER CHOICE", "+1 offered", { offers: 1 }],
  [4, 2, "OPEN HANDS", "+1 offered", { offers: 1 }],
  [3, 3, "SECOND THOUGHT", "1 reroll", { rerolls: 1 }],

  [1, 0, "THE HOST", "+1 body", { slots: 1 }],
  [3, 0, "OLD FRIENDS", "+1 at the gate", { startBand: 1 }],
  [0, 3, "DEEP POOL", "+8 asking", { manaPool: 8 }],
  [1, 4, "STILL WATERS", "+12% a room", { manaRise: 12 }],
  [4, 3, "FAST LEARNER", "level sooner", { xpCut: 12 }],
  [3, 4, "THIRD THOUGHT", "1 reroll", { rerolls: 1 }],

  [0, 4, "THE MANY DEAD", "+2 bodies", { slots: 2 }],
  [4, 4, "THE LONG DARK", "+1 offered", { offers: 1, restMore: 10 }],
];

export const TREE: TreeNode[] = LAID.map(([col, row, name, note, gives], id) => ({
  id, col, row, name, note, gives,
}));

export const rootId = 0;

// How far out a node sits, which is what it costs
export const depthOf = (n: TreeNode) => Math.abs(n.col - ROOT.col) + Math.abs(n.row - ROOT.row);

// Whatever it ends up beside. Same rule as the map: orthogonal only, so every
// join between two nodes is one straight run of line.
export const linksOf = (n: TreeNode): number[] =>
  TREE.filter((o) => Math.abs(o.col - n.col) + Math.abs(o.row - n.row) === 1).map((o) => o.id);
