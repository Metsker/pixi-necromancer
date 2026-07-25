// Numbers and templates only - behaviour lives in game.ts
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

export type Unit = { id: number; creature: CreatureId; hp: number; maxHp: number };

export type BattleUnit = {
  id: number;
  src: number; // army unit id, or -1 for anything that has no roster entry
  creature: CreatureId;
  faction: Faction;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  tier: number;
  withered: number;
};

export type Battle = {
  node: number;
  side: "hero" | "squad";
  units: BattleUnit[];
  hit: number[];
  tick: number;
  log: string[];
  done: "" | "win" | "loss";
  nextId: number;
};

export type MapNode = {
  id: number;
  layer: number;
  slot: number;
  of: number; // how many nodes share this layer, so the view can place it
  kind: NodeKind;
  tier: number;
  foes: CreatureId[];
  links: number[];
  state: NodeState;
  lore: number | null;
};

export type Reward = {
  xp: number;
  res: Record<Resource, number>;
  raised: CreatureId[];
  side: "hero" | "squad";
  lost: number;
};

export type GameState = {
  seed: number;
  rng: number;
  nodes: MapNode[];
  at: number;
  hero: Unit;
  army: Unit[];
  nextId: number;
  xp: number;
  level: number;
  unspent: number;
  build: Record<Stat, number>;
  res: Record<Resource, number>;
  battle: Battle | null;
  pending: Reward | null;
  pendingLore: number | null;
  seenLore: number[];
  cleared: number;
  log: string[];
  over: "" | "dead" | "won";
};

export const TUNING = {
  layers: 7,
  minPerLayer: 2,
  maxPerLayer: 3,
  crossEdgeChance: 0.45,

  heroHp: 34,
  heroDmg: 5,
  startingMinions: 2,
  restHeal: 8,
  minionHeal: 3,

  baseCap: 4,
  willPerPoint: 1,
  mightPerPoint: 2,
  wardPerPoint: 6,
  xpPerLevel: 24,

  raiseChance: 0.5,
  squadXpCut: 0.5,

  swarmPerAlly: 1,
  swarmCap: 4,
  bulwarkCut: 0.5,
  witherCut: 0.5,
  witherTurns: 3,
  siphonHeal: 2,
  rendBonus: 2,
  tollDamage: 3,
  splitTiers: 2,

  tierHp: 2,
  tierDmgAt: 3,
  maxTicks: 60,
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
  hero:    { name: "Necromancer", short: "You",    glyph: "🕱", color: 16, hp: 30, dmg: 4, speed: 3, xp: 0,  ability: null,      tag: "" },
  rat:     { name: "Plague Rat",  short: "Rat",    glyph: "⚇", color: 15, hp: 6,  dmg: 2, speed: 5, xp: 6,  ability: "swarm",   tag: "+1 dmg per ally" },
  hound:   { name: "Grave Hound", short: "Hound",  glyph: "⋒", color: 14, hp: 9,  dmg: 3, speed: 5, xp: 9,  ability: "rend",    tag: "+2 vs wounded" },
  knight:  { name: "Bone Knight", short: "Knight", glyph: "⌤", color: 22, hp: 14, dmg: 2, speed: 2, xp: 12, ability: "bulwark", tag: "halves damage" },
  moth:    { name: "Grave Moth",  short: "Moth",   glyph: "⫙", color: 20, hp: 8,  dmg: 2, speed: 4, xp: 9,  ability: "wither",  tag: "halves their dmg" },
  wisp:    { name: "Corpse Wisp", short: "Wisp",   glyph: "◉", color: 21, hp: 7,  dmg: 2, speed: 3, xp: 9,  ability: "siphon",  tag: "heals the hurt" },
  warden:  { name: "Tomb Warden", short: "Warden", glyph: "⛨", color: 19, hp: 16, dmg: 3, speed: 2, xp: 14, ability: "toll",    tag: "hurts all on death" },
  ossuary: { name: "The Ossuary", short: "Ossuary",glyph: "⚱", color: 17, hp: 40, dmg: 5, speed: 3, xp: 60, ability: "split",   tag: "splits when broken" },
};

// Everything the necromancer can field, which is everything he can kill
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
  might: "MIGHT  +2 dmg",
  ward: "WARD   +6 hp",
  will: "WILL   +1 slot",
};
