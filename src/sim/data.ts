// Numbers and templates only - behaviour lives in game.ts

export type Point = { x: number; y: number };
// Gold mobilizes a garrison into the marching army; a key opens a sealed node
export type Resource = "gold" | "keys";
// Which line of a fight a body stands in. Node ownership is `Owner`, and the
// two are not the same thing: a side is where you stand today.
export type Faction = "player" | "enemy";
export type Owner = "none" | "player" | "enemy";
export type AbilityId = "bulwark" | "wither" | "siphon" | "rend" | "toll";
// Two armies and the ground between them. `wild` belongs to nobody and never
// produces - it is what stands in a node until somebody takes it.
export type Family = "undead" | "human" | "wild";

export type CreatureId =
  | "skeleton" | "shambler" | "wraith" | "vampire" | "lich" | "dreadknight" | "bonewyrm"
  | "levy" | "archer" | "footman" | "swordsman" | "priest" | "knight" | "seraph"
  | "rat" | "bandit" | "wolf" | "brigand" | "ogre";

export type NodeKind =
  | "throne" | "city" | "hamlet" | "barracks" | "keep" | "mine" | "shrine" | "tower" | "vault";

// What a shrine hands over for a week when its owner walks in and claims it
export type BuffId = "vigor" | "ward" | "haste";

// A hero acts on the map, before a fight, or after one. Every spell belongs to
// exactly one of them, which is what keeps a spellbook three buttons wide.
export type SpellWindow = "map" | "pre" | "post";
export type SpellId = "shadowstep" | "terror" | "raise" | "forcedmarch" | "bless" | "mend";

// One slot of an army: `n` of the same thing, standing together. `hp`/`maxHp`
// are the whole stack's, so a stack is one body with everything combined.
export type Unit = {
  id: number;
  creature: CreatureId;
  n: number;
  hp: number;
  maxHp: number;
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
  // Bodies still standing in this slot. It is *derived*: `hp` is the slot's pool
  // and `each` is what one body holds, so damage kills bodies out of it and
  // `n` falls with them. Five skeletons at 10 taking 30 leaves two skeletons.
  n: number;
  each: number; // what one body of this slot holds
  hp: number; // the pool, all of them together
  maxHp: number; // what the slot walked in with, so the bar shows what it lost
  dmg: number; // what ONE body hits for; the blow is this times `n`
  slot: number; // place in its own line, front first, and how ties are broken
  // The battle-clock tick it swings on next. Every body keeps its own, so how
  // often a slot acts is its speed and nothing else.
  ready: number;
  withered: number;
};

// `by` is who threw it, which is what lets the view animate the blow
export type Hit = { id: number; by: number; n: number };

export type Battle = {
  node: number;
  units: BattleUnit[];
  hit: Hit[];
  mend: Hit[]; // who got put back together this turn, and by how much
  // The fight's own clock, in ticks. Nobody takes turns: the next blow is
  // whoever is due soonest, and a body is due by its own speed.
  clock: number;
  at: number; // the view tick the last blow landed on, so it can flash it
  round: number; // beats elapsed - `clock` over `beatTicks`, for the cap and the header
  log: string[];
  done: "" | "win" | "loss";
  // Who walked in. The engine always puts the mover in the "player" line, so
  // everything read from outside the fight has to come back through this.
  mover: Faction;
  // Whether the other line has a hero behind it. A garrison does not, and losing
  // to a hero costs him his whole army rather than a node.
  foeHero: boolean;
  // Set once a spell has been cast into this fight's window, so the sheet knows
  // what is still open
  castPre: boolean;
  castPost: boolean;
  nextId: number;
};

export type MapNode = {
  id: number;
  col: number;
  row: number;
  kind: NodeKind;
  tier: number; // authored by the map, not derived from where it sits
  owner: Owner;
  garrison: CreatureId[]; // what stands here, whoever it belongs to
  buff: BuffId | null; // a shrine's own, rolled once at generation
  claimed: number; // the week its buff was last taken, so it cannot be taken twice
  sealed: boolean; // a vault; a key opens it, once, for whoever spends one
  // A key nobody can see until they take this node off the wild. Two on a board,
  // on hard ground a long way from either throne, and never drawn.
  key: boolean;
  links: number[]; // orthogonal only
  // Terrain sticks once seen; owner and garrison are only live inside sight, so
  // what is drawn outside it is what was true the last time anyone looked.
  seen: boolean;
  knownOwner: Owner;
  knownGarrison: number; // how many bodies were standing when last seen
};

// A hero: a token, a line of bodies, a purse and a spellbook. Both sides are
// this same shape - the only asymmetry is the family it fields and the three
// spells that come with it.
export type Hero = {
  faction: Faction;
  family: Family;
  at: number; // the node it stands in
  moves: number; // movement points left this turn
  reserve: Unit[];
  mana: number;
  res: Record<Resource, number>;
  buffs: Partial<Record<BuffId, number>>; // the week each was claimed on
  route: number[]; // what it still has to walk, drawn while it walks
};

export type Phase = "player" | "enemy" | "fight" | "spoils" | "over";

export type GameState = {
  seed: number;
  rng: number;
  nodes: MapNode[];
  you: Hero;
  foe: Hero;
  turn: number; // turns taken; a week is TUNING.weekTurns of them
  phase: Phase;
  battle: Battle | null;
  view: number; // a tick counter the view animates off; the rules are turns
  next: number; // the view tick the current step or blow lands on
  nextUnit: number;
  difficulty: number; // what the enemy's income is multiplied by; 1 is fair
  risen: Risen | null;
  log: string[];
  over: "" | "dead" | "won";
};

export const TUNING = {
  // Two thrones at opposite corners, and the contested ground is the middle
  mapCols: 9,
  mapRows: 8,
  holeChance: 0.14,
  tiers: 7,

  // A turn is a hero's whole move. Every this many of them, everything anybody
  // holds makes what it makes.
  weekTurns: 7,
  // Steps a hero gets per turn. Flat: what you carry never slows you down, so
  // the roster is a fight decision and never a map tax.
  movePoints: 2,

  // How far a hero sees. Terrain outside it stays whatever it was; owners and
  // garrisons out there are memories, and memories go stale.
  sight: 2,

  // A city is this many nodes around its throne, and the throne is reachable
  // only through them - so taking one is a campaign rather than a sprint.
  cityRing: 1,

  // Ticks inside a fight. Nothing on the map runs on these any more.
  beatTicks: 30,
  speedBase: 10,
  maxRounds: 40,

  // Slots, not bodies. Depth in a slot is free; breadth is what this counts.
  slots: 7,
  // Bodies each hero opens holding, at the second rung of its own ladder. Enough
  // to take the soft ground next to home and not enough to take anything else.
  openBand: 8,

  // What one body costs in gold to pull out of a garrison and into the marching
  // line, per tier. The only thing gold is for, so it is what stops a hero
  // hoovering every node it walks past - a week's income buys roughly a third of
  // a week's growth, and choosing which third is the whole of the decision.
  mobilizeGold: 8,
  // What a mine pays, and what the AI prices one at when it is deciding
  mineGold: 45,
  // What a vault pays. Two on a board, behind the only two locks there are, in
  // corners nobody has to cross - so it has to be worth going out of your way and
  // spending a key you found by taking hard ground.
  vaultGold: 160,

  // Hero spell points. A cap, a trickle every turn, and a full pour at your own
  // city - so mana is a rhythm rather than a hoard.
  manaCap: 30,
  manaTurn: 3,
  // What the three cost. Raise is per body; the rest are flat. Set against each
  // other on purpose: one turn's mana must not comfortably cover a pre-fight
  // buff *and* the raise afterwards, or the buff is never a decision.
  raiseMana: 3,
  hexMana: 9,
  mendMana: 16,
  stepMana: 12,

  // What one mending puts back, as a share of what each surviving slot can hold.
  // A full heal for one flat cost is worth several times what a raise is, and
  // the probe read it straight off: 34.5% against a fair mirror of 55.9%.
  mendFrac: 0.25,

  // What a pre-fight spell is worth, and for how long a shrine's is
  blessPct: 25,
  terrorPct: 35,
  vigorPct: 15,
  wardPct: 15,
  hastePoints: 2,
  // The most any percentage is allowed to be worth, so no stack of them ever
  // makes a thing untouchable
  softCap: 45,

  bulwarkCut: 0.5,
  witherCut: 0.85,
  witherTurns: 3,
  siphonHeal: 5,
  siphonFloor: 8,
  rendBonus: 6,
  tollDamage: 14,

  // How much better than theirs a hero wants to be before it walks into a fight
  // it could avoid
  aiMargin: 1.15,
  // What a bot prices a tower at. It sees the whole board already, so the number
  // is not about vision: a node nobody ever takes is a wall across a small map.
  aiTower: 80,
  // Bodies a bot will never march out of its own throne carrying. The rules let
  // anyone strip a capital bare; only a player should ever actually do it.
  throneKeep: 2,
  // Weeks of its own production a node will hold before the rest is lost. This
  // is the answer to the stalemate the probe found: without it a capital grows a
  // garrison faster than any army can grow to break it.
  stockWeeks: 4,

  logLines: 40,
};

export type Template = {
  name: string;
  short: string;
  role: string; // what it is for, in one word
  family: Family;
  tier: number; // 1..7, and the whole of how strong it is
  glyph: string;
  hp: number;
  dmg: number;
  // How often it swings, against `TUNING.speedBase` for one blow a beat. Tier
  // sets the budget; speed only spreads it, so a quicker body of a tier hits
  // softer and the ladder still climbs.
  speed: number;
  // A wall. Every blow against its side lands on one of these while any is
  // standing, which is the only thing that decides who gets hit.
  taunt: boolean;
  ability: AbilityId | null;
  // What this comes back as. Nothing joins the dead as it was: a human rises as
  // the undead of its own tier, and so does anything wild.
  rises?: CreatureId;
  tag: string;
};

// Nothing shallower than this carries an ability at all: the bottom of the
// ladder is bodies and the top is rules. A check holds the table to it.
export const ABILITY_TIER = 4;

// Colour is the faction and nothing else - nobody was ever going to learn
// nineteen of them, and on a two-army map what you need to read first is whose
// it is. The glyph carries the tier.
export const FAMILY_COLOR: Record<Family, number> = { undead: 22, human: 16, wild: 11 };

// Both ladders climb the same budget - hp times what a body lands over a beat -
// and the two families spend it differently: the dead are slower and hold more,
// the living are quicker and hold less.
// One rung, one set of numbers. A tier's hp/dmg/speed is the *same* for both
// ladders, and a check holds it that way - two families whose stats differ at
// all cannot be balanced by tuning, because in a fight of many slots a small
// edge compounds into every blow after it. Three separate calibrations chased
// that and every one of them came back lopsided.
//
// What actually makes the two sides different is the ability on a rung and the
// three spells behind the hero. Those are one number each to tune, and neither
// of them compounds.
export const TIER_STATS: Record<number, { hp: number; dmg: number; speed: number }> = {
  1: { hp: 11,  dmg: 2,  speed: 10 },
  2: { hp: 19,  dmg: 3,  speed: 11 },
  3: { hp: 28,  dmg: 5,  speed: 12 },
  4: { hp: 42,  dmg: 8,  speed: 11 },
  5: { hp: 60,  dmg: 12, speed: 10 },
  6: { hp: 92,  dmg: 17, speed: 11 },
  7: { hp: 136, dmg: 26, speed: 12 },
};

export const CREATURES: Record<CreatureId, Template> = {
  // undead: what you field. Every one of them was theirs once.
  skeleton:    { name: "Rattlebones",  short: "Bones",  role: "rank",   family: "undead", tier: 1, glyph: "☠", ...TIER_STATS[1], taunt: false, ability: null,      tag: "" },
  shambler:    { name: "Shambler",     short: "Shambr", role: "meat",   family: "undead", tier: 2, glyph: "⩌", ...TIER_STATS[2], taunt: false, ability: null,      tag: "" },
  wraith:      { name: "Barrow Wraith",short: "Wraith", role: "hunter", family: "undead", tier: 3, glyph: "⸙", ...TIER_STATS[3], taunt: false, ability: null,      tag: "" },
  vampire:     { name: "Vampire",      short: "Vampir", role: "eater",  family: "undead", tier: 4, glyph: "♠", ...TIER_STATS[4], taunt: false, ability: "siphon",  tag: "moves its life into the worst hurt" },
  lich:        { name: "Lich",         short: "Lich",   role: "hex",    family: "undead", tier: 5, glyph: "◉", ...TIER_STATS[5], taunt: false, ability: "wither",  tag: "blunts their blows" },
  dreadknight: { name: "Dread Knight", short: "Dread",  role: "wall",   family: "undead", tier: 6, glyph: "⟁", ...TIER_STATS[6], taunt: true,  ability: "bulwark", tag: "a wall, and halves what it takes" },
  bonewyrm:    { name: "Bone Wyrm",    short: "Wyrm",   role: "the end",family: "undead", tier: 7, glyph: "⫙", ...TIER_STATS[7], taunt: false, ability: "toll",    tag: "hurts all of them when it falls" },

  // living: theirs, and every rung of it has its counterpart above. Same
  // numbers, different rules - a swordsman bites the wounded where a vampire
  // drinks, and a priest gives itself where a lich hexes.
  levy:        { name: "Levy",         short: "Levy",   role: "fodder", family: "human",  tier: 1, glyph: "⛑", ...TIER_STATS[1], taunt: false, ability: null,      rises: "skeleton",    tag: "" },
  archer:      { name: "Archer",       short: "Archer", role: "shot",   family: "human",  tier: 2, glyph: "⭦", ...TIER_STATS[2], taunt: false, ability: null,      rises: "shambler",    tag: "" },
  footman:     { name: "Footman",      short: "Footmn", role: "rank",   family: "human",  tier: 3, glyph: "⟎", ...TIER_STATS[3], taunt: false, ability: null,      rises: "wraith",      tag: "" },
  swordsman:   { name: "Swordsman",    short: "Sword",  role: "blade",  family: "human",  tier: 4, glyph: "†", ...TIER_STATS[4], taunt: false, ability: "rend",    rises: "vampire",     tag: "+6 vs wounded" },
  priest:      { name: "Priest",       short: "Priest", role: "mender", family: "human",  tier: 5, glyph: "☥", ...TIER_STATS[5], taunt: false, ability: "siphon",  rises: "lich",        tag: "gives itself to the worst hurt" },
  knight:      { name: "Knight",       short: "Knight", role: "wall",   family: "human",  tier: 6, glyph: "⌤", ...TIER_STATS[6], taunt: true,  ability: "bulwark", rises: "dreadknight", tag: "a wall, and halves what it takes" },
  seraph:      { name: "Seraph",       short: "Seraph", role: "the end",family: "human",  tier: 7, glyph: "★", ...TIER_STATS[7], taunt: false, ability: "toll",    rises: "bonewyrm",    tag: "hurts all of them when it falls" },

  // wild: bandits and beasts. Nobody's, never produced, and they do not come
  // back once a node has been taken off them - so the map is a finite thing to
  // clear rather than a field to farm. Softer than a rung of either ladder,
  // because they are the ground you cross and not an army.
  rat:         { name: "Plague Rat",   short: "Rat",    role: "swarm",  family: "wild",   tier: 1, glyph: "⚇", hp: 9,   dmg: 2,  speed: 10, taunt: false, ability: null,      rises: "skeleton",    tag: "" },
  bandit:      { name: "Bandit",       short: "Bandit", role: "cutter", family: "wild",   tier: 2, glyph: "⟏", hp: 16,  dmg: 3,  speed: 11, taunt: false, ability: null,      rises: "shambler",    tag: "" },
  wolf:        { name: "Grave Wolf",   short: "Wolf",   role: "hunter", family: "wild",   tier: 3, glyph: "⋒", hp: 24,  dmg: 5,  speed: 12, taunt: false, ability: null,      rises: "wraith",      tag: "" },
  brigand:     { name: "Brigand",      short: "Brignd", role: "blade",  family: "wild",   tier: 4, glyph: "⬓", hp: 36,  dmg: 8,  speed: 11, taunt: false, ability: "rend",    rises: "vampire",     tag: "+6 vs wounded" },
  ogre:        { name: "Ogre",         short: "Ogre",   role: "wall",   family: "wild",   tier: 5, glyph: "⩀", hp: 51,  dmg: 12, speed: 10, taunt: true,  ability: "bulwark", rises: "lich",        tag: "a wall, and halves what it takes" },
};

export const CREATURE_IDS = Object.keys(CREATURES) as CreatureId[];

// The one thing a family is: its ladder, shallowest first. `raiseAs` and every
// producer read a body out of here by tier, so the 1:1 pairing is one lookup.
export const LADDER: Record<Family, CreatureId[]> = {
  undead: CREATURE_IDS.filter((c) => CREATURES[c].family === "undead").sort((a, z) => CREATURES[a].tier - CREATURES[z].tier),
  human: CREATURE_IDS.filter((c) => CREATURES[c].family === "human").sort((a, z) => CREATURES[a].tier - CREATURES[z].tier),
  wild: CREATURE_IDS.filter((c) => CREATURES[c].family === "wild").sort((a, z) => CREATURES[a].tier - CREATURES[z].tier),
};

// What a family fields at a depth. Clamped, because the wild ladder is short and
// a deep node still has to put somebody in it.
export const atTier = (f: Family, tier: number): CreatureId => {
  const line = LADDER[f];
  return line[Math.min(line.length, Math.max(1, tier)) - 1];
};

// Bodies a producer of this depth hands its owner each week. Straight off the
// HoMM curve: the bottom of the ladder arrives by the fistful and the top
// arrives one at a time, which is the whole of why a high tier is worth holding.
export const GROWTH = [0, 8, 5, 4, 3, 2, 1, 1];
export const growthFor = (tier: number) => GROWTH[Math.min(GROWTH.length - 1, Math.max(1, tier))];

export type KindInfo = {
  name: string;
  glyph: string;
  // What it is chiefly known for, which is what the map and the sheet say it is
  makes: "bodies" | "gold" | "buff" | "sight";
  // The band its own depth is rolled in. A node's tier is written down at
  // generation and never derived from where it sits.
  tiers: [number, number];
  bodies: boolean; // stands `growthFor(tier)` of the owner's family each week
  gold: number; // and pays this, each week, on top
  guard: number; // bodies of wild standing in it before anyone takes it
  // How far it watches once it is yours. Ground you hold sees a step on its own;
  // a tower sees far and makes nothing at all, so it is worth taking for that.
  sight: number;
};

// A capital is the economy: a throne and its city pay for the bodies they make,
// which is the only reason a hero who holds nothing else can still act. Without
// it the opening is a deadlock - no gold, so no mobilizing, so no army, so no
// mine, so no gold.
export const KINDS: Record<NodeKind, KindInfo> = {
  throne: {
    name: "THE THRONE", glyph: "♖",
    makes: "bodies", tiers: [4, 5], bodies: true, gold: 80, guard: 2, sight: 1,
  },
  city: {
    name: "THE CITY", glyph: "⌂",
    makes: "bodies", tiers: [2, 3], bodies: true, gold: 25, guard: 1, sight: 1,
  },
  hamlet: {
    name: "THE HAMLET", glyph: "▤",
    makes: "bodies", tiers: [1, 2], bodies: true, gold: 0, guard: 0, sight: 1,
  },
  barracks: {
    name: "THE BARRACKS", glyph: "▥",
    makes: "bodies", tiers: [3, 4], bodies: true, gold: 0, guard: 1, sight: 1,
  },
  keep: {
    name: "THE KEEP", glyph: "⛶",
    makes: "bodies", tiers: [5, 7], bodies: true, gold: 0, guard: 1, sight: 1,
  },
  mine: {
    name: "THE MINE", glyph: "⧇",
    makes: "gold", tiers: [1, 3], bodies: false, gold: 45, guard: 0, sight: 1,
  },
  shrine: {
    name: "THE SHRINE", glyph: "⊡",
    makes: "buff", tiers: [1, 2], bodies: false, gold: 0, guard: 0, sight: 1,
  },
  tower: {
    name: "THE TOWER", glyph: "⊤",
    makes: "sight", tiers: [1, 2], bodies: false, gold: 0, guard: 0, sight: 4,
  },
  // The only sealed kind, and the only one placed rather than rolled: one in each
  // free corner, so it is a pocket off the side of the map and never a door
  // anybody has to walk through. Nothing stands in it - the lock is the guard.
  vault: {
    name: "THE VAULT", glyph: "⛼",
    makes: "gold", tiers: [1, 1], bodies: false, gold: TUNING.vaultGold, guard: 0, sight: 1,
  },
};

export const KIND_IDS = Object.keys(KINDS) as NodeKind[];

// Everything a cell that is not a throne or a city can turn out to be. `keep` is
// one roll in seven, so the deep end of the ladder is worth walking to.
export const KIND_ROLL: NodeKind[] = [
  "hamlet", "hamlet", "barracks", "barracks", "mine", "shrine", "keep", "tower",
];
// What the mirrored skeleton is made of. Topology, the thrones, the deep
// producers and the mines - the things whose imbalance compounds every week.
export const MIRRORED: NodeKind[] = ["keep", "mine"];

export type BuffInfo = { name: string; note: string; glyph: string };

export const BUFFS: Record<BuffId, BuffInfo> = {
  vigor: { name: "VIGOR", note: "your blows land harder", glyph: "▲" },
  ward: { name: "WARD", note: "their blows land softer", glyph: "⛨" },
  haste: { name: "HASTE", note: "you cover more ground", glyph: "►" },
};

export const BUFF_IDS = Object.keys(BUFFS) as BuffId[];

export type SpellInfo = {
  name: string;
  note: string; // the card face, at a card's width
  desc: string; // the whole rule, in plain words
  glyph: string;
  family: Family;
  window: SpellWindow;
  mana: number; // 0 means it is priced per body instead
};

// Three windows, three roles, one spell each per family - so neither side is
// structurally short of an answer in any phase of a turn. Mana is the only
// limit on any of them.
export const SPELLS: Record<SpellId, SpellInfo> = {
  shadowstep: {
    name: "SHADOW STEP", note: "step to your own ground", glyph: "⭦",
    desc: "Move at once to any node you hold. The dead walk their own country unseen.",
    family: "undead", window: "map", mana: TUNING.stepMana,
  },
  terror: {
    name: "TERROR", note: "blunt their blows", glyph: "⸬",
    desc: "Everything standing against you swings softer for the whole of the fight to come.",
    family: "undead", window: "pre", mana: TUNING.hexMana,
  },
  raise: {
    name: "RAISE", note: "the fallen, at their own tier", glyph: "☠",
    desc: "What fell here gets up as the undead of its own depth. Priced per body, and the corpses are gone at the end of your turn.",
    family: "undead", window: "post", mana: 0,
  },
  forcedmarch: {
    name: "FORCED MARCH", note: "further, this turn", glyph: "►",
    desc: "More ground this turn than the day has in it. The living can be made to hurry.",
    family: "human", window: "map", mana: TUNING.stepMana,
  },
  bless: {
    name: "BLESS", note: "sharpen your own", glyph: "☥",
    desc: "Everything of yours swings harder for the whole of the fight to come.",
    family: "human", window: "pre", mana: TUNING.hexMana,
  },
  mend: {
    name: "MEND", note: "put them back together", glyph: "♡",
    desc: "What lived through the fight is made whole again, as far as the mana goes.",
    family: "human", window: "post", mana: TUNING.mendMana,
  },
};

export const SPELL_IDS = Object.keys(SPELLS) as SpellId[];

// A family's three, in window order, so a spellbook is always drawn the same way
export const spellsOf = (f: Family): SpellId[] =>
  SPELL_IDS.filter((s) => SPELLS[s].family === f).sort(
    (a, z) => WINDOW_ORDER.indexOf(SPELLS[a].window) - WINDOW_ORDER.indexOf(SPELLS[z].window),
  );

export const WINDOW_ORDER: SpellWindow[] = ["map", "pre", "post"];

// Ticks a body waits between its own blows. Speed is the whole of it: at
// `speedBase` that is one beat, and at double it is half a beat.
export const coolFor = (speed: number) =>
  Math.max(1, Math.round((TUNING.beatTicks * TUNING.speedBase) / speed));
// What a body is actually worth over a beat, which is the only honest way to
// read a blow now that a slow one lands a third as often
export const dmgPerBeat = (dmg: number, speed: number) =>
  Math.round((dmg * speed) / TUNING.speedBase);
// What a speed reads as where a sheet has room for a word and not a number
export const speedWord = (speed: number) =>
  speed * 10 >= TUNING.speedBase * 13 ? "quick" : speed * 10 <= TUNING.speedBase * 7 ? "slow" : "steady";

// What one body of a creature is worth, as one number. Both AIs sort by it, the
// pre-fight sheet ranks a garrison against your line with it, and the mirror
// probe uses it to decide whether a map handed one side the better half.
export const worthOf = (c: CreatureId) => {
  const t = CREATURES[c];
  // A wall is worth twice what its sheet says, because nothing behind it can be
  // touched until it is down
  const soak = t.hp * (t.ability === "bulwark" ? 2 : 1);
  // What it can take *times* what it deals, never the two added. Added
  // underprices speed - and speed is the one axis the two families differ on, so
  // an additive price quietly told the slow army it was 11% stronger than it was
  // and it spent the whole game picking fights it could not win.
  return Math.max(1, Math.round((soak * t.dmg * t.speed) / TUNING.speedBase));
};

// What pulling one body out of a garrison costs, by what it is
export const mobilizeCost = (c: CreatureId) => TUNING.mobilizeGold * CREATURES[c].tier;
// What asking one body back off the floor costs
export const raiseCost = (c: CreatureId) => TUNING.raiseMana * CREATURES[c].tier;

export const RES_IDS: Resource[] = ["gold", "keys"];

export const RESOURCES: Record<Resource, { short: string; glyph: string; color: number }> = {
  gold: { short: "gold", glyph: "⊙", color: 16 },
  keys: { short: "keys", glyph: "⚷", color: 22 },
};

// The two tokens on the board. Neither of them fights - a hero is the line
// behind him - and neither may wear a family's colour, or a token reads as a
// node you lose it on. A check holds all of it.
export const HERO_GLYPH: Record<Faction, string> = { player: "🕱", enemy: "♦" };
export const HERO_COLOR: Record<Faction, number> = { player: 23, enemy: 15 };

// Whose a node is, wherever a node is drawn. Colour is the whole of it.
export const OWNER_COLOR: Record<Owner, number> = { none: 11, player: 22, enemy: 16 };

// A wall is worth marking wherever a body is listed, because it is the one
// thing that decides who gets hit
export const TAUNT_GLYPH = "⛨";

// A body that is down. The same skull Rattlebones wears, which is the joke.
export const DOWN_GLYPH = "☠";

// What it costs to ask, wherever that number is shown
export const MANA_GLYPH = "◇";
