// Numbers and templates only - behaviour lives in game.ts
export type Point = { x: number; y: number };
export type Stat = "might" | "ward" | "will";
export type Resource = "bone" | "ash" | "salt";
export type Faction = "player" | "enemy";
export type AbilityId = "swarm" | "bulwark" | "wither" | "siphon" | "rend" | "toll" | "split";
export type CreatureId =
  | "hero"
  | "rat"
  | "hound"
  | "knight"
  | "moth"
  | "wisp"
  | "warden"
  | "ossuary";
export type NodeKind = "gate" | "fight" | "elite" | "crypt" | "cache" | "boss";
export type NodeState = "locked" | "open" | "cleared";
export type ForceKind = "hero" | "squad";
export type ForceMode = "idle" | "march" | "fight" | "spoils" | "gone";

export type Unit = { id: number; creature: CreatureId; hp: number; maxHp: number };

// The last time the dead got up, so the map can make a moment of it
export type Risen = {
  creatures: CreatureId[];
  units: number[]; // the battle units that got up, so the board can show it
  node: number;
  at: number;
};

export type BattleUnit = {
  id: number;
  src: number; // the force's unit id, or -1 for anything with no roster entry
  creature: CreatureId;
  faction: Faction;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  slot: number; // place in its own line, front first
  tier: number;
  withered: number;
};

// `by` is who threw it, which is what lets the view animate the blow
export type Hit = { id: number; by: number; n: number };

export type Battle = {
  node: number;
  units: BattleUnit[];
  hit: Hit[];
  mend: Hit[]; // who got put back together this turn, and by how much
  // Whose line swings first this fight, decided on the way in. The two sides
  // then alternate, so twice the bodies is not twice the blows.
  lead: Faction;
  next: Faction;
  cursor: Record<Faction, number>;
  round: number;
  log: string[];
  done: "" | "win" | "loss";
  healed: number; // what the room gave him back, for the board to show
  nextId: number;
};

// Everything on the map that moves and fights. The necromancer's retinue is
// force zero; every squad you cut loose is another one running at the same time.
export type Force = {
  id: number;
  kind: ForceKind;
  units: Unit[];
  at: number;
  path: number[];
  mode: ForceMode;
  next: number; // the tick this force's current step finishes on
  battle: Battle | null;
  rooms: number;
};

export type MapNode = {
  id: number;
  col: number;
  row: number;
  kind: NodeKind;
  tier: number;
  foes: CreatureId[];
  links: number[]; // orthogonal only
  state: NodeState;
  lore: number | null;
};

export type GameState = {
  seed: number;
  rng: number;
  time: number;
  nodes: MapNode[];
  forces: Force[];
  reserve: Unit[];
  front: number; // how many of the reserve stand ahead of the necromancer
  nextForce: number;
  nextUnit: number;
  xp: number;
  level: number;
  unspent: number;
  build: Record<Stat, number>;
  res: Record<Resource, number>;
  risen: Risen | null;
  seenLore: number[];
  loreQueue: number[];
  cleared: number;
  lost: number;
  log: string[];
  over: "" | "dead" | "won";
};

export const TUNING = {
  mapCols: 7,
  mapRows: 12,
  holeChance: 0.22,
  tiers: 6,
  // What a room is worth being afraid of, in the two places the bands change
  threatMild: 130,
  threatBad: 205,

  // Ticks. The clock runs at TICK_MS a tick, multiplied by the speed control.
  marchTicks: 5,
  turnTicks: 5,
  spoilsTicks: 45,
  idlePoll: 10,
  maxRounds: 100,

  heroHp: 100,
  heroDmg: 22,
  startingMinions: 2,
  // What a room he takes gives him back, as a share of what he can hold. Not
  // all of it: the run is meant to wear him down.
  restFrac: 0.1,

  baseCap: 6,
  squadCap: 6,
  willPerPoint: 1,
  mightPerPoint: 3,
  wardPerPoint: 40,
  xpPerLevel: 26,

  raiseChance: 0.5,
  squadXpCut: 1,
  reinforceEvery: 260,
  reinforceAfter: 700,
  riseTicks: 60,
  foeCap: 7,

  swarmPerAlly: 2,
  swarmCap: 8,
  bulwarkCut: 0.5,
  witherCut: 0.7,
  witherTurns: 3,
  siphonHeal: 8,
  rendBonus: 6,
  tollDamage: 14,
  splitTiers: 1,

  roomBase: 2,
  tierHp: 2,
  tierDmgAt: 3,
  logLines: 40,
};

export type Template = {
  name: string;
  short: string;
  role: string; // what it is for, in one word
  glyph: string;
  color: number;
  hp: number;
  dmg: number;
  speed: number;
  xp: number;
  ability: AbilityId | null;
  tag: string;
};

// color is an index into PALETTE
export const CREATURES: Record<CreatureId, Template> = {
  hero:    { name: "Necromancer", short: "You",    role: "himself", glyph: "🕱", color: 20, hp: 100, dmg: 22, speed: 3, xp: 0,  ability: null,      tag: "" },
  rat:     { name: "Plague Rat",  short: "Rat",    role: "swarm",   glyph: "⚇", color: 15, hp: 20,  dmg: 4,  speed: 5, xp: 6,  ability: "swarm",   tag: "+2 dmg per ally" },
  hound:   { name: "Grave Hound", short: "Hound",  role: "heavy",   glyph: "⋒", color: 14, hp: 26,  dmg: 12, speed: 5, xp: 12, ability: "rend",    tag: "+6 vs wounded" },
  knight:  { name: "Bone Knight", short: "Knight", role: "wall",    glyph: "⌤", color: 22, hp: 70,  dmg: 3,  speed: 2, xp: 14, ability: "bulwark", tag: "halves what it takes" },
  moth:    { name: "Grave Moth",  short: "Moth",   role: "hex",     glyph: "⫙", color: 16, hp: 24,  dmg: 4,  speed: 4, xp: 10, ability: "wither",  tag: "blunts their blows" },
  wisp:    { name: "Corpse Wisp", short: "Wisp",   role: "mender",  glyph: "◉", color: 21, hp: 26,  dmg: 2,  speed: 3, xp: 12, ability: "siphon",  tag: "mends the worst hurt" },
  warden:  { name: "Tomb Warden", short: "Warden", role: "guard",   glyph: "⛨", color: 19, hp: 80,  dmg: 5,  speed: 2, xp: 18, ability: "toll",    tag: "hurts all when it falls" },
  ossuary: { name: "The Ossuary", short: "Ossuary",role: "the end", glyph: "⚱", color: 17, hp: 150, dmg: 16, speed: 3, xp: 60, ability: "split",   tag: "splits when broken" },
};

export const RAISABLE: CreatureId[] = ["rat", "hound", "knight", "moth", "wisp", "warden"];
export const EARLY_POOL: CreatureId[] = ["rat", "rat", "hound", "moth", "wisp"];
export const LATE_POOL: CreatureId[] = ["rat", "hound", "knight", "moth", "wisp", "warden"];
export const KIND_ROLL: NodeKind[] = ["fight", "fight", "fight", "elite", "crypt", "cache"];

export const KIND_GLYPH: Record<NodeKind, string> = {
  gate: "⌂",
  fight: "✕",
  elite: "☠",
  crypt: "⛼",
  cache: "⩀",
  boss: "⚱",
};

export const KIND_NAME: Record<NodeKind, string> = {
  gate: "THE GATE",
  fight: "WARREN",
  elite: "BARROW",
  crypt: "CRYPT",
  cache: "RELIQUARY",
  boss: "THE OSSUARY",
};

export const KIND_NOTE: Record<NodeKind, string> = {
  gate: "where you came in",
  fight: "a few of them, loose",
  elite: "they were expecting us",
  crypt: "the dead here rise easily",
  cache: "somebody hid something",
  boss: "everything you dismissed",
};

export const RES_IDS: Resource[] = ["bone", "ash", "salt"];

export const RESOURCES: Record<Resource, { short: string; glyph: string; color: number }> = {
  bone: { short: "bone", glyph: "†", color: 23 },
  ash: { short: "ash", glyph: "∿", color: 20 },
  salt: { short: "salt", glyph: "⊙", color: 22 },
};

export const STAT_LABEL: Record<Stat, string> = {
  might: "MIGHT  +3 dmg",
  ward: "WARD  +40 hp",
  will: "WILL  +1 slot",
};

export const SQUAD_GLYPH = "⸬";
