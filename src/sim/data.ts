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
export type ForceMode = "idle" | "march" | "fight" | "gone";

export type Unit = { id: number; creature: CreatureId; hp: number; maxHp: number };

export type BattleUnit = {
  id: number;
  src: number; // the force's unit id, or -1 for anything with no roster entry
  creature: CreatureId;
  faction: Faction;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  tier: number;
  withered: number;
};

export type Hit = { id: number; n: number };

export type Battle = {
  node: number;
  units: BattleUnit[];
  hit: Hit[];
  round: number;
  log: string[];
  done: "" | "win" | "loss";
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
  nextForce: number;
  nextUnit: number;
  xp: number;
  level: number;
  unspent: number;
  build: Record<Stat, number>;
  res: Record<Resource, number>;
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

  // Ticks. The clock runs at TICK_MS a tick, multiplied by the speed control.
  marchTicks: 9,
  roundTicks: 7,
  idlePoll: 10,
  maxRounds: 140,

  heroHp: 200,
  heroDmg: 20,
  startingMinions: 2,
  // A room he takes is a room he can rest in, so his question is only ever
  // whether he can win this one, not how much the last one cost
  restHeal: 999,

  baseCap: 4,
  squadCap: 6,
  willPerPoint: 1,
  mightPerPoint: 6,
  wardPerPoint: 34,
  xpPerLevel: 22,

  raiseChance: 0.5,
  squadXpCut: 1,
  reinforceEvery: 260,
  foeCap: 7,

  swarmPerAlly: 1,
  swarmCap: 4,
  bulwarkCut: 0.5,
  witherCut: 0.5,
  witherTurns: 3,
  siphonHeal: 5,
  rendBonus: 3,
  tollDamage: 8,
  splitTiers: 2,

  tierHp: 6,
  tierDmgAt: 3,
  logLines: 40,
};

export type Template = {
  name: string;
  short: string;
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
  hero:    { name: "Necromancer", short: "You",    glyph: "🕱", color: 16, hp: 200, dmg: 20, speed: 3, xp: 0,  ability: null,      tag: "" },
  rat:     { name: "Plague Rat",  short: "Rat",    glyph: "⚇", color: 15, hp: 18,  dmg: 3, speed: 5, xp: 6,  ability: "swarm",   tag: "+1 dmg per ally" },
  hound:   { name: "Grave Hound", short: "Hound",  glyph: "⋒", color: 14, hp: 26,  dmg: 4, speed: 5, xp: 9,  ability: "rend",    tag: "+3 vs wounded" },
  knight:  { name: "Bone Knight", short: "Knight", glyph: "⌤", color: 22, hp: 40,  dmg: 3, speed: 2, xp: 12, ability: "bulwark", tag: "halves damage" },
  moth:    { name: "Grave Moth",  short: "Moth",   glyph: "⫙", color: 20, hp: 24,  dmg: 3, speed: 4, xp: 9,  ability: "wither",  tag: "halves their dmg" },
  wisp:    { name: "Corpse Wisp", short: "Wisp",   glyph: "◉", color: 21, hp: 22,  dmg: 3, speed: 3, xp: 9,  ability: "siphon",  tag: "heals the hurt" },
  warden:  { name: "Tomb Warden", short: "Warden", glyph: "⛨", color: 19, hp: 46,  dmg: 4, speed: 2, xp: 14, ability: "toll",    tag: "hurts all on death" },
  ossuary: { name: "The Ossuary", short: "Ossuary",glyph: "⚱", color: 17, hp: 130, dmg: 8, speed: 3, xp: 60, ability: "split",   tag: "splits when broken" },
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
  might: "MIGHT  +6 dmg",
  ward: "WARD  +34 hp",
  will: "WILL  +1 slot",
};

export const SQUAD_GLYPH = "⸬";
