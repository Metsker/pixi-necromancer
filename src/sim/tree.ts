// One tree, three arms out of the middle. Numbers and templates only - every
// key here is read at exactly one place in game.ts.

export type ArmId = "swarm" | "bond" | "control";

export type Perk =
  // swarm: more of them, cheaper to ask for, and rats worth having a lot of
  | "slots"
  | "manaPool"
  | "raiseCost"
  | "riseLuck"
  | "swarmPer"
  | "swarmCap"
  | "ratHp"
  | "ratDmg"
  // bond: fewer of them, and a wall worth standing behind
  | "minionDmg"
  | "vetDmg"
  | "vetHp"
  | "mend"
  | "wallHp"
  | "wallCut"
  | "packTaunt"
  // control: what the dark does to the other side
  | "witherPow"
  | "witherLong"
  | "witherAll"
  | "hexDmg"
  | "dread";

export type Perks = Record<Perk, number>;

export const PERK_IDS: Perk[] = [
  "slots", "manaPool", "raiseCost", "riseLuck", "swarmPer", "swarmCap", "ratHp", "ratDmg",
  "minionDmg", "vetDmg", "vetHp", "mend", "wallHp", "wallCut", "packTaunt",
  "witherPow", "witherLong", "witherAll", "hexDmg", "dread",
];

// col and row place it on the board; the links are whatever it ends up beside,
// which is the same rule the map uses and means the shape is the data. The arm
// is what the gate counts, so two arms may touch without opening each other.
export type TreeNode = {
  id: number;
  col: number;
  row: number;
  arm: ArmId | "";
  name: string;
  note: string; // what it does, short enough for the narrowest sheet
  gives: Partial<Perks>;
};

export const TREE_COLS = 5;
export const TREE_ROWS = 5;
export const ROOT = { col: 2, row: 2 };

export const ARM_IDS: ArmId[] = ["swarm", "bond", "control"];

export const ARMS: Record<ArmId, { name: string; note: string; color: number }> = {
  swarm: { name: "SWARM", note: "the many", color: 15 },
  bond: { name: "BOND", note: "the few", color: 14 },
  control: { name: "CONTROL", note: "the dark", color: 20 },
};

// Written out cell by cell, because the shape is the point. The root is index
// zero and comes free: level one buys an arm, not the middle of the board.
const LAID: [number, number, ArmId | "", string, string, Partial<Perks>][] = [
  [2, 2, "", "THE GRAVE", "+1 body", { slots: 1 }],

  // Up: more of them, cheaper, and rats worth keeping a lot of. It has no wall
  // and nothing that mends - what it answers attrition with is replacement.
  [2, 1, "swarm", "THE MANY", "+1 body", { slots: 1 }],
  [1, 1, "swarm", "THIN BLOOD", "rats +18 hp", { ratHp: 18 }],
  [3, 1, "swarm", "VERMIN", "rats +4 dmg", { ratDmg: 4 }],
  [2, 0, "swarm", "GRAVE-GLUT", "more get up free", { riseLuck: 20 }],
  [1, 0, "swarm", "CHEAP ASKING", "asking -1, +4", { raiseCost: -1, manaPool: 4 }],
  [3, 0, "swarm", "KING OF RATS", "+2 bodies, teeth", { slots: 2, swarmPer: 2, swarmCap: 10, riseLuck: 15 }],

  // Left and down: fewer of them, each one worth mending and worth hiding behind
  [1, 2, "bond", "THE FEW", "all +3 dmg", { minionDmg: 3 }],
  [0, 2, "bond", "GRIT", "mend the worst", { mend: 8 }],
  [1, 3, "bond", "STONE SKIN", "walls +20 hp", { wallHp: 20 }],
  [0, 3, "bond", "HARD YEARS", "+2 hp a room", { vetHp: 2 }],
  [1, 4, "bond", "UNBROKEN", "walls take -20%", { wallCut: 20 }],
  [0, 4, "bond", "THE PACK", "old bones bite", { vetDmg: 2, minionDmg: 3, packTaunt: 1 }],

  // Right and down: nothing of yours gets better, everything of theirs gets worse
  [3, 2, "control", "DREAD", "they hit -10%", { dread: 10 }],
  [4, 2, "control", "HEX", "+3 vs withered", { hexDmg: 3 }],
  [3, 3, "control", "DEEP WITHER", "wither cuts more", { witherPow: 15 }],
  [4, 3, "control", "LONG WITHER", "wither holds +2", { witherLong: 2 }],
  [3, 4, "control", "MANA", "+6 asking", { manaPool: 6 }],
  [4, 4, "control", "THE HUSK", "it all withers", { witherAll: 1, dread: 6, hexDmg: 2 }],
];

export const TREE: TreeNode[] = LAID.map(([col, row, arm, name, note, gives], id) => ({
  id, col, row, arm, name, note, gives,
}));

export const rootId = 0;

// How far out a node sits. Distance is the price of admission: nothing at depth
// d opens until d-1 of its own arm is already yours.
export const depthOf = (n: TreeNode) => Math.abs(n.col - ROOT.col) + Math.abs(n.row - ROOT.row);

// Whatever it ends up beside. Same rule as the map: orthogonal only, so every
// join between two nodes is one straight run of line.
export const linksOf = (n: TreeNode): number[] =>
  TREE.filter((o) => Math.abs(o.col - n.col) + Math.abs(o.row - n.row) === 1).map((o) => o.id);
