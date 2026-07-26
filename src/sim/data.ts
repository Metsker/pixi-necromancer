// Numbers and templates only - behaviour lives in game.ts
import type { Perks } from "./tree.ts";

export type Point = { x: number; y: number };
// Nothing spends these yet. They are here so a room can pay something a shop
// and a locked door will want later.
export type Resource = "gold" | "keys";
export type Faction = "player" | "enemy";
export type AbilityId = "swarm" | "bulwark" | "wither" | "siphon" | "rend" | "toll" | "split";
export type CreatureId = "rat" | "hound" | "knight" | "moth" | "wisp" | "warden" | "ossuary";
export type NodeKind = "gate" | "fight" | "elite" | "crypt" | "cache" | "boss";
export type NodeState = "locked" | "open" | "cleared";
export type ArmyMode = "idle" | "march" | "fight" | "spoils";

// `rooms` is how many it has lived through. It ticks for everybody; only the
// bond arm reads it, and only the bond arm pays it back.
export type Unit = { id: number; creature: CreatureId; hp: number; maxHp: number; rooms: number };

// The last time the dead got up, so the map can make a moment of it
export type Risen = {
  creatures: CreatureId[];
  units: number[]; // the battle units that got up, so the board can show it
  node: number;
  at: number;
};

export type BattleUnit = {
  id: number;
  src: number; // the roster unit id, or -1 for anything with no roster entry
  creature: CreatureId;
  faction: Faction;
  hp: number;
  maxHp: number;
  dmg: number;
  slot: number; // place in its own line, front first, and the order it swings in
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
  // Whose line swings first this fight, decided on the way in by who brought
  // more. The two sides then alternate, so twice the bodies is not twice the blows.
  lead: Faction;
  next: Faction;
  cursor: Record<Faction, number>;
  round: number; // one exchange: a blow from each side
  log: string[];
  done: "" | "win" | "loss";
  healed: number; // what the room gave the army back, for the board to show
  taken: number[]; // bodies out of this room that are yours now, however they got up
  nextId: number;
  // What you had bought when this fight started. Carried on the battle because a
  // blow is resolved without the game state to hand.
  perks: Perks;
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

// One army, one token. Everything that used to belong to a force is here now:
// there is only ever the one, and you lose when it is gone.
export type GameState = {
  seed: number;
  rng: number;
  time: number;
  nodes: MapNode[];
  reserve: Unit[];
  at: number; // the room it stands in
  route: number[]; // the rooms it still has to walk through
  mode: ArmyMode;
  next: number; // the tick the current step finishes on
  battle: Battle | null;
  rooms: number;
  nextUnit: number;
  xp: number;
  level: number;
  unspent: number;
  mana: number; // what asking costs; the ceiling is what you have built up to
  taken: number[]; // the nodes of the tree that are bought
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
  // One army walks this now, so it is sized to be chosen from rather than
  // covered: centre to the furthest corner is six steps against six tiers
  mapCols: 7,
  mapRows: 7,
  holeChance: 0.16,
  tiers: 6,
  // What a room is worth being afraid of, in the two places the bands change
  threatMild: 150,
  threatBad: 250,

  // Ticks. The clock runs at TICK_MS a tick, multiplied by the speed control.
  marchTicks: 5,
  turnTicks: 5,
  spoilsTicks: 45,
  idlePoll: 10,
  // An exchange is a blow from each side, so this is a real ceiling on a fight
  // however many bodies are standing in it
  maxRounds: 150,

  // What a room you take gives every body that lived through it back, as a share
  // of what it can hold. Nothing else heals without a node of the tree.
  restFrac: 0.25,

  // The root of the tree is worth a body, so a run opens on six
  baseCap: 5,
  xpPerLevel: 22,

  // What you can spend on the dead, and what a room you take gives back of it
  manaBase: 12,
  manaRegen: 0.4,
  // What unmaking a body pays back. Always less than the cheapest thing there
  // is, so selling is a slot you wanted, never a profit.
  sellMana: 1,

  raiseChance: 0.12,
  riseTicks: 24,

  swarmPerAlly: 2,
  swarmCap: 10,
  bulwarkCut: 0.5,
  witherCut: 0.85,
  witherTurns: 3,
  // The most any percentage perk is allowed to be worth, so no stack of them
  // ever makes a thing untouchable
  softCap: 45,
  siphonHeal: 5,
  rendBonus: 6,
  tollDamage: 14,
  splitTiers: 1,

  // The most rooms a body is ever paid for living through. Uncapped, a long run
  // turns veterancy into a number nothing else on the board can answer.
  vetCap: 10,

  roomBase: 2,
  tierHp: 3,
  tierDmgAt: 4,
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
  xp: number;
  mana: number; // what asking this one back costs; 0 is one that never answers
  // A wall. Every blow against its side lands on one of these while any is
  // standing, which is the only thing that decides who gets hit.
  taunt: boolean;
  ability: AbilityId | null;
  tag: string;
};

// color is an index into PALETTE
export const CREATURES: Record<CreatureId, Template> = {
  rat:     { name: "Plague Rat",  short: "Rat",    role: "swarm",  glyph: "⚇", color: 15, hp: 22,  dmg: 5,  xp: 6,  mana: 2, taunt: false, ability: "swarm",   tag: "+2 dmg per ally" },
  hound:   { name: "Grave Hound", short: "Hound",  role: "heavy",  glyph: "⋒", color: 14, hp: 30,  dmg: 13, xp: 12, mana: 3, taunt: false, ability: "rend",    tag: "+6 vs wounded" },
  moth:    { name: "Grave Moth",  short: "Moth",   role: "hex",    glyph: "⫙", color: 16, hp: 26,  dmg: 6,  xp: 10, mana: 3, taunt: false, ability: "wither",  tag: "blunts their blows" },
  wisp:    { name: "Corpse Wisp", short: "Wisp",   role: "mender", glyph: "◉", color: 21, hp: 28,  dmg: 4,  xp: 12, mana: 3, taunt: false, ability: "siphon",  tag: "mends the worst hurt" },
  knight:  { name: "Bone Knight", short: "Knight", role: "wall",   glyph: "⌤", color: 22, hp: 55,  dmg: 6,  xp: 16, mana: 4, taunt: true,  ability: "bulwark", tag: "a wall, and halves what it takes" },
  warden:  { name: "Tomb Warden", short: "Warden", role: "guard",  glyph: "⛨", color: 19, hp: 80,  dmg: 8,  xp: 20, mana: 5, taunt: true,  ability: "toll",    tag: "a wall, and hurts all when it falls" },
  ossuary: { name: "The Ossuary", short: "Ossuary",role: "the end",glyph: "⚱", color: 17, hp: 130, dmg: 15, xp: 60, mana: 0, taunt: false, ability: "split",   tag: "splits when broken" },
};

export const RAISABLE: CreatureId[] = ["rat", "hound", "knight", "moth", "wisp", "warden"];
export const EARLY_POOL: CreatureId[] = ["rat", "rat", "hound", "moth", "wisp"];
export const LATE_POOL: CreatureId[] = ["rat", "hound", "knight", "moth", "wisp", "warden"];
// What a run opens with is three different things out of this, so no roll ever
// hands out a band with nothing in it that can kill
export const START_POOL: CreatureId[] = ["rat", "hound", "moth", "wisp"];
export const START_BAND = 3;
export const KIND_ROLL: NodeKind[] = ["fight", "fight", "fight", "elite", "crypt", "cache"];
// One wall in front of it, not two. Everything the run dismissed is behind it.
export const BOSS_FOES: CreatureId[] = ["ossuary", "warden"];

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

export const RES_IDS: Resource[] = ["gold", "keys"];

export const RESOURCES: Record<Resource, { short: string; glyph: string; color: number }> = {
  gold: { short: "gold", glyph: "⊙", color: 16 },
  keys: { short: "keys", glyph: "⚷", color: 22 },
};

export const ARMY_GLYPH = "⸬";
// A wall is worth marking wherever a body is listed, because it is the one
// thing that decides who gets hit
export const TAUNT_GLYPH = "⛨";

// A node of the tree, as it stands right now: bought, buyable, or still sealed
export const TREE_GLYPH = { taken: "•", open: "∘", sealed: "⬚" };

// What it costs to ask, wherever that number is shown
export const MANA_GLYPH = "◇";
