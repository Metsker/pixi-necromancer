// Numbers and templates only - behaviour lives in game.ts
import type { Perks } from "./tree.ts";

export type Point = { x: number; y: number };
// Gold is banked into the tree at the end of a run; a key opens a sealed room
export type Resource = "gold" | "keys";
export type Faction = "player" | "enemy";
export type AbilityId = "swarm" | "bulwark" | "wither" | "siphon" | "rend" | "toll" | "split";
// The two things a card can be about, plus the one thing that is neither: what
// is still breathing when you find it. Living bodies never join you as they are.
export type Family = "beast" | "undead" | "living";
export type CreatureId =
  | "crow" | "rat" | "hound" | "moth" | "boar"
  | "skeleton" | "zombie" | "ghoul" | "wisp" | "knight" | "warden"
  | "peasant" | "guard"
  | "ossuary";
export type NodeKind =
  | "gate" | "sewer" | "village" | "wilds" | "barrow" | "graves" | "crypt" | "vault" | "boss";
export type NodeState = "locked" | "open" | "cleared";
export type ArmyMode = "idle" | "march" | "fight" | "spoils";

// One slot of the army: `n` of the same thing, standing together. `hp`/`maxHp`
// are the whole stack's, so a stack is one body with everything combined.
// `rooms` is how many it has lived through; only veterancy reads it.
export type Unit = {
  id: number;
  creature: CreatureId;
  n: number;
  hp: number;
  maxHp: number;
  rooms: number;
};

// The last time the dead got up, so the map can make a moment of it
export type Risen = {
  creatures: CreatureId[];
  units: number[]; // the battle units that got up, so the board can show it
  node: number;
  at: number;
};

export type BattleUnit = {
  id: number;
  src: number; // the roster stack id, or -1 for anything with no roster entry
  creature: CreatureId;
  faction: Faction;
  n: number; // bodies in this stack; hp and dmg are already the sum of them
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
  // more bodies. The two sides then alternate, one blow a side.
  lead: Faction;
  next: Faction;
  cursor: Record<Faction, number>;
  round: number; // one exchange: a blow from each side
  log: string[];
  done: "" | "win" | "loss";
  healed: number; // what the room gave the army back, for the board to show
  taken: number[]; // stacks out of this room that are yours now, however they got up
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
  powers: string[]; // what has been drafted this run, in the order it was taken
  // What is on the table right now. It lives here rather than on the ui, or a
  // reload in the middle of a level-up would deal a fresh hand.
  offer: string[];
  rerolls: number;
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

  // Slots, not bodies. The root of the tree is worth one, so a run opens on four
  // and the opening band already fills three of them.
  baseCap: 3,
  xpPerLevel: 22,

  // What a level-up puts on the table, and how deep one of them can be stacked
  // before it leaves the pool. A common drawn against a rare, so a rule stays
  // something you remember getting.
  offerCount: 3,
  powerStack: 3,
  commonWeight: 4,

  // A node of the tree, priced by how far out it stands. Distance is the whole
  // of the gate now that the board is neutral.
  nodeBase: 3,
  nodeStep: 3,

  // What you can spend on the dead, and what a room you take gives back of it
  manaBase: 12,
  manaRegen: 0.4,
  // What unmaking a body pays back. Always less than the cheapest thing there
  // is, so selling is a slot you wanted, never a profit.
  sellMana: 1,

  raiseChance: 0.12,
  riseTicks: 24,
  // What a sealed room hands over outright, on top of whatever fell in it
  giftBodies: 2,

  swarmPerAlly: 2,
  swarmCap: 10,
  bulwarkCut: 0.5,
  witherCut: 0.85,
  witherTurns: 3,
  // The most any percentage perk is allowed to be worth, so no stack of them
  // ever makes a thing untouchable
  softCap: 45,
  siphonHeal: 5,
  // What a wisp will not spend of itself. It gives until it is nearly out and
  // then stops, so it burns down rather than going out mid-fight.
  siphonFloor: 8,
  rendBonus: 6,
  tollDamage: 14,
  // What the dark takes out of a withered thing every time it swings anyway
  rotDamage: 6,
  splitTiers: 1,

  // The most rooms a body is ever paid for living through. Uncapped - or capped
  // too high - a long run turns veterancy into a number nothing else on the
  // board can answer, and the arm holding it is simply the answer.
  vetCap: 6,

  // Bodies in a room before depth starts adding to them
  roomBase: 2,
  tierHp: 5,
  logLines: 40,
};

export type Template = {
  name: string;
  short: string;
  role: string; // what it is for, in one word
  family: Family;
  // Roughly how deep it belongs. Nothing under `abilityTier` carries an
  // ability at all: the shallow end of the map is bodies, not rules.
  tier: number;
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
  // What it is when it gets up, if it is not itself. Nothing living joins you
  // as it was; it comes back as whatever the dark makes of it.
  rises?: CreatureId;
  tag: string;
};

// Nothing shallower than this carries an ability. A check holds the table to it.
export const ABILITY_TIER = 1;

// color is an index into PALETTE, and no two of them share one
export const CREATURES: Record<CreatureId, Template> = {
  // beasts: cheap, many, and they hit before they think
  crow:     { name: "Carrion Crow", short: "Crow",   role: "flock",  family: "beast",  tier: 0, glyph: "⸙", color: 9,  hp: 18,  dmg: 7,  xp: 6,  mana: 2, taunt: false, ability: null,      tag: "" },
  rat:      { name: "Plague Rat",   short: "Rat",    role: "swarm",  family: "beast",  tier: 1, glyph: "⚇", color: 15, hp: 22,  dmg: 5,  xp: 6,  mana: 2, taunt: false, ability: "swarm",   tag: "+2 dmg per ally" },
  hound:    { name: "Grave Hound",  short: "Hound",  role: "hunter", family: "beast",  tier: 1, glyph: "⋒", color: 14, hp: 30,  dmg: 13, xp: 12, mana: 3, taunt: false, ability: "rend",    tag: "+6 vs wounded" },
  moth:     { name: "Grave Moth",   short: "Moth",   role: "hex",    family: "beast",  tier: 2, glyph: "⫙", color: 16, hp: 26,  dmg: 6,  xp: 10, mana: 3, taunt: false, ability: "wither",  tag: "blunts their blows" },
  boar:     { name: "Tomb Boar",    short: "Boar",   role: "wall",   family: "beast",  tier: 3, glyph: "⟁", color: 13, hp: 60,  dmg: 9,  xp: 18, mana: 4, taunt: true,  ability: "bulwark", tag: "a wall, and halves what it takes" },

  // undead: slower, harder to put down, and they were already yours once
  skeleton: { name: "Rattlebones",  short: "Bones",  role: "rank",   family: "undead", tier: 0, glyph: "⚉", color: 17, hp: 24,  dmg: 5,  xp: 6,  mana: 2, taunt: false, ability: null,      tag: "" },
  zombie:   { name: "Shambler",     short: "Shambr", role: "meat",   family: "undead", tier: 0, glyph: "⩌", color: 21, hp: 34,  dmg: 4,  xp: 7,  mana: 2, taunt: false, ability: null,      tag: "" },
  ghoul:    { name: "Ghoul",        short: "Ghoul",  role: "eater",  family: "undead", tier: 1, glyph: "♠", color: 11, hp: 34,  dmg: 10, xp: 12, mana: 3, taunt: false, ability: "rend",    tag: "+6 vs wounded" },
  wisp:     { name: "Corpse Wisp",  short: "Wisp",   role: "mender", family: "undead", tier: 2, glyph: "◉", color: 23, hp: 28,  dmg: 4,  xp: 12, mana: 3, taunt: false, ability: "siphon",  tag: "gives itself to the worst hurt" },
  knight:   { name: "Bone Knight",  short: "Knight", role: "wall",   family: "undead", tier: 3, glyph: "⌤", color: 22, hp: 55,  dmg: 6,  xp: 16, mana: 4, taunt: true,  ability: "bulwark", tag: "a wall, and halves what it takes" },
  warden:   { name: "Tomb Warden",  short: "Warden", role: "guard",  family: "undead", tier: 4, glyph: "⛨", color: 19, hp: 80,  dmg: 8,  xp: 20, mana: 5, taunt: true,  ability: "toll",    tag: "a wall, and hurts all when it falls" },

  // living: they are somebody else's until they are yours, and then they are bones
  peasant:  { name: "Villager",     short: "Villgr", role: "fodder", family: "living", tier: 0, glyph: "⛑", color: 10, hp: 16,  dmg: 3,  xp: 4,  mana: 2, taunt: false, ability: null,      rises: "skeleton", tag: "" },
  guard:    { name: "Vault Guard",  short: "Guard",  role: "wall",   family: "living", tier: 2, glyph: "⟎", color: 12, hp: 45,  dmg: 9,  xp: 16, mana: 4, taunt: true,  ability: null,      rises: "skeleton", tag: "a wall" },

  ossuary:  { name: "The Ossuary",  short: "Ossuar", role: "the end",family: "undead", tier: 5, glyph: "⚱", color: 20, hp: 130, dmg: 15, xp: 60, mana: 0, taunt: false, ability: "split",   tag: "splits when broken" },
};

export const CREATURE_IDS = Object.keys(CREATURES) as CreatureId[];

// Anything that can end up standing in your line. The Ossuary never answers, and
// nothing living joins you as it was - it joins you as what it rises into.
export const RAISABLE: CreatureId[] = CREATURE_IDS.filter(
  (c) => CREATURES[c].mana > 0 && CREATURES[c].family !== "living",
);

// Three bands of depth. Every step out from the gate changes what is in the
// room, how many of them, or how big they are - which is what makes distance
// readable without a colour for it.
export const bandFor = (tier: number) => (tier < 2 ? 0 : tier < 4 ? 1 : 2);

export type KindInfo = {
  name: string;
  note: string;
  glyph: string;
  // The one thing the map is coloured by now. A room says what it is, not how
  // frightened of it to be - that is what the sheet you open is for.
  color: number;
  // What stands in it, by band. An empty pool is a room with nobody in it.
  pool: [CreatureId[], CreatureId[], CreatureId[]];
  size: number; // bodies on top of TUNING.roomBase, before depth adds more
  tierUp: number; // deeper than where it stands
  key: boolean; // sealed, and a key is what opens it
  freeRise: boolean; // everything that falls here gets up for nothing
  gift: CreatureId | null; // what opening it hands you outright
  gold: number;
  keys: number;
};

const NOBODY: [CreatureId[], CreatureId[], CreatureId[]] = [[], [], []];

export const KINDS: Record<NodeKind, KindInfo> = {
  gate: {
    name: "THE GATE", note: "where you came in", glyph: "⌂", color: 11,
    pool: NOBODY, size: 0, tierUp: 0, key: false, freeRise: false, gift: null, gold: 0, keys: 0,
  },
  sewer: {
    name: "THE SEWERS", note: "it moves in the water", glyph: "≈", color: 21,
    pool: [["rat", "rat", "crow"], ["rat", "rat", "hound", "crow"], ["rat", "hound", "ghoul"]],
    size: 1, tierUp: 0, key: false, freeRise: false, gift: null, gold: 2, keys: 0,
  },
  village: {
    name: "THE VILLAGE", note: "they were alive this morning", glyph: "▤", color: 10,
    pool: [["peasant", "peasant"], ["peasant", "peasant", "guard"], ["peasant", "guard", "guard"]],
    size: 1, tierUp: 0, key: false, freeRise: false, gift: null, gold: 3, keys: 1,
  },
  wilds: {
    name: "THE WILDS", note: "something keeps it fed", glyph: "♣", color: 14,
    pool: [["crow", "hound"], ["hound", "moth", "crow"], ["hound", "moth", "boar"]],
    size: 0, tierUp: 0, key: false, freeRise: false, gift: null, gold: 2, keys: 0,
  },
  barrow: {
    name: "THE BARROW", note: "they were expecting us", glyph: "☠", color: 15,
    pool: [["skeleton", "ghoul"], ["ghoul", "zombie", "knight"], ["knight", "warden", "ghoul"]],
    size: 1, tierUp: 1, key: false, freeRise: false, gift: null, gold: 4, keys: 1,
  },
  graves: {
    name: "THE GRAVEYARD", note: "the dead here rise easily", glyph: "⛼", color: 22,
    pool: [["skeleton", "ghoul"], ["skeleton", "zombie", "ghoul"], ["zombie", "ghoul", "knight"]],
    size: 0, tierUp: 0, key: false, freeRise: true, gift: null, gold: 2, keys: 0,
  },
  crypt: {
    name: "THE CRYPT", note: "sealed, and somebody is still in there", glyph: "♖", color: 20,
    pool: [["skeleton", "knight"], ["knight", "ghoul"], ["knight", "warden"]],
    size: 0, tierUp: 0, key: true, freeRise: true, gift: "knight", gold: 4, keys: 0,
  },
  vault: {
    name: "THE VAULT", note: "sealed, and well looked after", glyph: "⧇", color: 16,
    pool: [["guard", "guard"], ["guard", "guard", "knight"], ["guard", "warden", "knight"]],
    size: 1, tierUp: 1, key: true, freeRise: false, gift: null, gold: 12, keys: 0,
  },
  boss: {
    name: "THE OSSUARY", note: "everything you dismissed", glyph: "⚱", color: 20,
    pool: [["ossuary", "warden"], ["ossuary", "warden"], ["ossuary", "warden"]],
    size: 0, tierUp: 0, key: false, freeRise: false, gift: null, gold: 20, keys: 0,
  },
};

// What a room draws from at the depth it stands at
export const poolFor = (kind: NodeKind, tier: number) => KINDS[kind].pool[bandFor(tier)];

// What depth is worth to a body standing in the room, and to its blow. Read by
// the board that builds the fight and by the sheet you open before walking in.
export const tierHpFor = (tier: number) => tier * TUNING.tierHp;
export const tierDmgFor = (tier: number) => Math.floor(tier / 2);
// A room fills up as it gets further out, a step behind the pool it draws from
export const tierGrow = (tier: number) => (tier >= 5 ? 2 : tier >= 3 ? 1 : 0);

// What a run opens with: three different things, one hand of each path, so the
// first level-up is a choice rather than a confirmation.
export const START_POOL: CreatureId[] = ["rat", "hound", "skeleton", "zombie"];
export const START_BAND = 3;

// The sealed rooms are one roll in nine each, so a key is worth carrying and
// worth spending on the right door
export const KIND_ROLL: NodeKind[] = [
  "sewer", "sewer", "village", "wilds", "wilds", "barrow", "graves", "crypt", "vault",
];

// What the first ring out from the gate is allowed to be. A run that opens
// surrounded by doors it has no key for is a run with nowhere to go.
export const OPEN_ROLL: NodeKind[] = KIND_ROLL.filter((k) => !KINDS[k].key);

export const RES_IDS: Resource[] = ["gold", "keys"];

export const RESOURCES: Record<Resource, { short: string; glyph: string; color: number }> = {
  gold: { short: "gold", glyph: "⊙", color: 16 },
  keys: { short: "keys", glyph: "⚷", color: 22 },
};

// What stands on the map is still him, whatever it is made of: he does not
// fight any more, but the token you move is the necromancer.
export const ARMY_GLYPH = "🕱";
export const ARMY_COLOR = 20;
// A wall is worth marking wherever a body is listed, because it is the one
// thing that decides who gets hit
export const TAUNT_GLYPH = "⛨";

// A node of the tree, as it stands right now: bought, buyable, or still sealed
export const TREE_GLYPH = { taken: "•", open: "∘", sealed: "⬚" };

// What it costs to ask, wherever that number is shown
export const MANA_GLYPH = "◇";
