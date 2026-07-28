import { pick, rnd, rngState, seed as seedRng, setRngState, shuffle } from "./rng.ts";
import {
  ABILITY_TIER,
  BUFF_IDS,
  CREATURES,
  KINDS,
  KIND_ROLL,
  MIRRORED,
  RES_IDS,
  SPELLS,
  TUNING,
  atTier,
  coolFor,
  growthFor,
  mobilizeCost,
  raiseCost,
  spellsOf,
  worthOf,
  type AbilityId,
  type Battle,
  type BattleUnit,
  type BuffId,
  type CreatureId,
  type Faction,
  type Family,
  type GameState,
  type Hero,
  type MapNode,
  type NodeKind,
  type Owner,
  type SpellId,
  type Unit,
} from "./data.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// The share of a blow left after a cut. Nothing stacks past the soft cap, or a
// deep enough stack of them makes a thing that cannot be hurt.
const left = (pct: number) => clamp(pct, 100 - TUNING.softCap, 100) / 100;

// ---------------------------------------------------------------- the two sides

export const other = (f: Faction): Faction => (f === "player" ? "enemy" : "player");
export const heroOf = (g: GameState, f: Faction): Hero => (f === "player" ? g.you : g.foe);
export const ownerOf = (f: Faction): Owner => f;

// A week is `weekTurns` turns, and everything that is made is made on the turn
// one comes round. A buff lasts exactly as long as the week it was claimed in.
export const weekOf = (turn: number) => Math.floor(turn / TUNING.weekTurns);
export const untilWeek = (g: GameState) =>
  TUNING.weekTurns - (g.turn % TUNING.weekTurns);

export function log(g: GameState, line: string) {
  g.log.push(line);
  if (g.log.length > TUNING.logLines) g.log.shift();
}

// ---------------------------------------------------------------- the army

export const fielded = (h: Hero) => h.reserve.length;
export const bodies = (h: Hero) => h.reserve.reduce((n, u) => n + u.n, 0);

// Depth is free and breadth is the price: a kind a hero already holds never
// refuses another body, so the only thing this ever turns down is a new row.
export const roomFor = (h: Hero, c: CreatureId) =>
  h.reserve.some((u) => u.creature === c) || h.reserve.length < TUNING.slots;

// What one body of a slot holds. Every body in a slot holds the same, which is
// what makes `maxHp` exactly `n` bodies and lets damage kill them one at a time.
export const eachHp = (u: Unit) => Math.max(1, Math.round(u.maxHp / Math.max(1, u.n)));

export const hpFrac = (u: { hp: number; maxHp: number }) => clamp(u.hp / u.maxHp, 0, 1);

// Everything a hero has standing, as one number. Both AIs sort by it and the
// pre-fight sheet ranks a garrison against it.
export const armyWorth = (h: Hero) =>
  h.reserve.reduce((s, u) => s + worthOf(u.creature) * u.n, 0);

export const listWorth = (list: CreatureId[]) =>
  list.reduce((s, c) => s + worthOf(c), 0);

// Folds a line of bodies into slots: four skeletons become one body of four.
// Both sides stack the same way, or a garrison of four would land four blows to
// a slot's one and the whole point of a slot would be on one side only.
export function stackOf<T>(list: T[]): [T, number][] {
  const out: [T, number][] = [];
  for (const item of list) {
    const seen = out.find(([k]) => k === item);
    if (seen) seen[1] += 1;
    else out.push([item, 1]);
  }
  return out;
}

export function moveUp(h: Hero, k: number) {
  if (k <= 0 || k >= h.reserve.length) return;
  [h.reserve[k - 1], h.reserve[k]] = [h.reserve[k], h.reserve[k - 1]];
}
export const moveDown = (h: Hero, k: number) => moveUp(h, k + 1);

// A body joins at the slot's own size, never at the template's, so every body
// in a slot holds the same and a slot stays one row of equal bars.
export function join(g: GameState, h: Hero, creature: CreatureId, n = 1): number {
  if (n <= 0) return 0;
  const stack = h.reserve.find((u) => u.creature === creature);
  if (stack) {
    const each = eachHp(stack);
    stack.n += n;
    stack.maxHp += each * n;
    stack.hp += each * n;
    return n;
  }
  if (h.reserve.length >= TUNING.slots) return 0;
  const each = CREATURES[creature].hp;
  h.reserve.push({ id: g.nextUnit++, creature, n, hp: each * n, maxHp: each * n });
  return n;
}

// Nothing joins the dead as it was. A human or a beast comes back as the undead
// of its own depth, which is the whole of what the 1:1 ladder is for.
export const raiseAs = (c: CreatureId): CreatureId =>
  CREATURES[c].rises ?? atTier("undead", CREATURES[c].tier);

// ---------------------------------------------------------------- the map

const GRID_STEPS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// Cave-in: a cell can be missing, as long as nothing is cut off by its going.
// Checked one hole at a time rather than repaired afterwards, because a repair
// pass is where a map generator quietly starts producing corridors again.
function whole(solid: Set<number>, from: number, cols: number): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const k = queue.pop()!;
    const col = k % cols;
    const row = (k - col) / cols;
    for (const [dc, dr] of GRID_STEPS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= cols) continue;
      const n = r * cols + c;
      if (!solid.has(n) || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size === solid.size;
}

// What a node's garrison is before anybody has taken it: bandits and beasts, at
// the depth the node itself stands at. They never come back once they are gone.
function rollGuard(kind: NodeKind, tier: number): CreatureId[] {
  // Depth is carried by *what* stands there far more than by how many, because
  // the ladder is already exponential. Counting up as steeply as the tier does
  // put a wall in front of the opening army that a whole week could not pay for.
  const n = Math.max(1, 2 + Math.floor(tier / 3) + KINDS[kind].guard);
  // The wild ladder is short, so a deep node is guarded by more of the top of it
  // rather than by something that does not exist
  return Array.from({ length: n }, () => atTier("wild", Math.min(5, tier)));
}

function buildMap(g: GameState) {
  const { mapCols, mapRows } = TUNING;
  const key = (col: number, row: number) => row * mapCols + col;
  // Point symmetry: every cell has exactly one opposite, and the two thrones are
  // each other's. Anything mirrored is written to both at once.
  const flip = (k: number) => {
    const col = k % mapCols;
    const row = (k - col) / mapCols;
    return key(mapCols - 1 - col, mapRows - 1 - row);
  };

  const yours = key(0, mapRows - 1);
  const theirs = flip(yours);
  // The two corners the thrones do not stand in. A corner is a pocket, so a lock
  // on one is never a door across the board, and the two are each other's mirror.
  const vaults = [key(0, 0), key(mapCols - 1, mapRows - 1)];

  const solid = new Set<number>();
  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) solid.add(key(col, row));
  }
  // Thrones and the ring that encloses them are never punched out, or a throne
  // could end up reachable without walking through its own city. The vaults are
  // never punched out either - there are exactly two of them and they are placed.
  const safe = new Set<number>([yours, theirs, ...vaults]);
  for (const t of [yours, theirs]) {
    for (const r of ringOf(t, mapCols, mapRows)) safe.add(r);
  }
  // Holes come in mirrored pairs, so both sides get the same country to cross.
  // The board has to stay whole *without* the vaults as well: a locked corner is
  // only a pocket if nothing behind it needs walking through.
  for (const k of shuffle([...solid])) {
    if (safe.has(k) || !solid.has(k)) continue;
    if (rnd() >= TUNING.holeChance) continue;
    const twin = flip(k);
    if (safe.has(twin)) continue;
    solid.delete(k);
    solid.delete(twin);
    const open = new Set(solid);
    for (const v of vaults) open.delete(v);
    if (!whole(solid, yours, mapCols) || !whole(open, yours, mapCols)) {
      solid.add(k);
      solid.add(twin);
    }
  }

  // The kind of every cell, decided over half the board. The skeleton - the
  // deep producers and the mines - is written to both halves at once; everything
  // else is rolled again on the other side, so the map has a character of its own.
  const kindAt = new Map<number, NodeKind>();
  const tierAt = new Map<number, number>();
  const setKind = (k: number, kind: NodeKind, tier: number) => {
    kindAt.set(k, kind);
    tierAt.set(k, tier);
  };
  const rollTier = (kind: NodeKind) => {
    const [lo, hi] = KINDS[kind].tiers;
    return lo + Math.floor(rnd() * (hi - lo + 1));
  };

  setKind(yours, "throne", rollTier("throne"));
  setKind(theirs, "throne", rollTier("throne"));
  for (const v of vaults) setKind(v, "vault", rollTier("vault"));
  for (const t of [yours, theirs]) {
    for (const r of ringOf(t, mapCols, mapRows)) {
      if (solid.has(r)) setKind(r, "city", rollTier("city"));
    }
  }

  for (const k of [...solid].sort((a, z) => a - z)) {
    if (kindAt.has(k)) continue;
    const twin = flip(k);
    const kind = pick(KIND_ROLL);
    const tier = rollTier(kind);
    setKind(k, kind, tier);
    if (kindAt.has(twin) || !solid.has(twin)) continue;
    if (MIRRORED.includes(kind)) setKind(twin, kind, tier);
    else {
      const own = pick(KIND_ROLL);
      setKind(twin, own, rollTier(own));
    }
  }

  const id = new Map<number, number>();
  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const k = key(col, row);
      if (!solid.has(k)) continue;
      const kind = kindAt.get(k)!;
      const tier = tierAt.get(k)!;
      const throne = k === yours || k === theirs;
      const city = kind === "city";
      // A throne and its city start held by whoever they belong to; everything
      // else on the board is somebody's to take.
      const mine = k === yours || ringOf(yours, mapCols, mapRows).includes(k);
      const owner: Owner = throne || city ? (mine ? "player" : "enemy") : "none";
      id.set(k, g.nodes.length);
      g.nodes.push({
        id: g.nodes.length,
        col,
        row,
        kind,
        tier,
        owner,
        // What somebody already holds opens empty: the week is what stocks it. A
        // vault opens empty too - the lock is the whole of what guards it.
        garrison: owner === "none" && kind !== "vault" ? rollGuard(kind, tier) : [],
        buff: kind === "shrine" ? pick(BUFF_IDS) : null,
        claimed: -1,
        sealed: kind === "vault",
        key: false,
        links: [],
        seen: false,
        knownOwner: owner === "none" ? "none" : owner,
        knownGarrison: 0,
      });
    }
  }

  for (const n of g.nodes) {
    for (const [dc, dr] of GRID_STEPS) {
      const col = n.col + dc;
      const row = n.row + dr;
      if (col < 0 || col >= mapCols || row < 0 || row >= mapRows) continue;
      const o = id.get(key(col, row));
      if (o !== undefined) n.links.push(o);
    }
  }

  g.you.at = id.get(yours)!;
  g.foe.at = id.get(theirs)!;

  // The two keys. Nothing on the board says where they are, so they have to be
  // worth stumbling into: the hardest wild ground furthest from either throne,
  // and a mirrored pair, so what one hero has to walk and fight for is exactly
  // what the other does.
  const stepsFrom = (from: number) => {
    const far = new Map([[from, 0]]);
    for (const queue = [from]; queue.length; ) {
      const cur = queue.shift()!;
      for (const o of g.nodes[cur].links) {
        if (far.has(o)) continue;
        far.set(o, far.get(cur)! + 1);
        queue.push(o);
      }
    }
    return far;
  };
  const walk = stepsFrom(g.you.at);
  const pairs = g.nodes
    .filter((n) => n.owner === "none" && !n.sealed && id.has(flip(key(n.col, n.row))))
    .map((n) => ({ n, twin: g.nodes[id.get(flip(key(n.col, n.row)))!] }))
    .filter(({ n, twin }) => twin.id !== n.id && twin.owner === "none" && !twin.sealed);
  // Only ground the generator mirrored *exactly*. A cell and its opposite are the
  // same shape but not the same kind - everything outside the skeleton is rolled
  // again - so a pair that does not match hands one hero a t7 ogre nest and the
  // other a t4 barracks for the same key. That is a faction gap, not a map.
  const same = pairs.filter(({ n, twin }) => twin.kind === n.kind && twin.tier === n.tier);
  const hard = (same.length ? same : pairs).sort(
    (a, z) => z.n.tier - a.n.tier || (walk.get(z.n.id) ?? 0) - (walk.get(a.n.id) ?? 0),
  );
  if (hard.length) {
    hard[0].n.key = true;
    hard[0].twin.key = true;
  }
}

// The cells orthogonally around one, clipped to the board. A throne's ring is
// its city, and it is the only way in - which is why fighting through a city is
// geometry here rather than a rule anybody has to be told.
function ringOf(k: number, cols: number, rows: number): number[] {
  const col = k % cols;
  const row = (k - col) / cols;
  const out: number[] = [];
  for (const [dc, dr] of GRID_STEPS) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
    out.push(r * cols + c);
  }
  return out;
}

export const throneOf = (g: GameState, f: Faction) =>
  g.nodes.find((n) => n.kind === "throne" && (f === "player" ? n.col === 0 : n.col !== 0))!;

// ---------------------------------------------------------------- fog

// Terrain sticks once seen. An owner and a garrison are only live inside sight -
// outside it the board shows what was true the last time anybody looked, which
// is what makes walking somewhere to check worth a turn.
// Everything the player can see this instant. The hero carries his own reach,
// and every node he holds watches a little way on its own - a tower is the one
// that watches far, which is the whole of what a tower is for. One relaxing
// walk over all the sources, so the longest reach onto a node is the one it keeps.
function sightSet(g: GameState): Set<number> {
  const left = new Map<number, number>();
  const queue: number[] = [];
  const seed = (at: number, d: number) => {
    if ((left.get(at) ?? -1) >= d) return;
    left.set(at, d);
    queue.push(at);
  };
  seed(g.you.at, TUNING.sight);
  for (const n of g.nodes) if (n.owner === "player") seed(n.id, KINDS[n.kind].sight);
  for (let i = 0; i < queue.length; i++) {
    const d = left.get(queue[i])!;
    if (d > 0) for (const o of g.nodes[queue[i]].links) seed(o, d - 1);
  }
  return new Set(left.keys());
}

export function see(g: GameState) {
  for (const k of sightSet(g)) {
    const n = g.nodes[k];
    n.seen = true;
    n.knownOwner = n.owner;
    n.knownGarrison = n.garrison.length;
  }
}

export const inSight = (g: GameState, id: number) => sightSet(g).has(id);

// Whether the other hero can be drawn at all. Outside sight he is a rumour.
export const foeVisible = (g: GameState) => inSight(g, g.foe.at);

// ---------------------------------------------------------------- movement

// Anything with somebody else's bodies in it has to be fought for, so a route
// may only pass *through* ground that is walkable - the last node may be held.
const hostile = (g: GameState, f: Faction, id: number) => {
  // The other hero always stops you, wherever he is standing
  if (heroOf(g, other(f)).at === id) return true;
  const n = g.nodes[id];
  // Your own ground is your own, garrison and all - what stands there is what
  // you put there, and walking in is how you collect it rather than a fight
  if (n.owner === f) return false;
  // Anything else with bodies in it has to be fought for. Anything without is a
  // flag, and a flag just changes hands.
  return n.garrison.length > 0;
};

export const needsKey = (n: MapNode) => n.sealed;

// A route to a target: over ground that costs nothing to cross, where only the
// last node may still be somebody's. That is what makes an order to walk and an
// order to attack the same order.
export function routeTo(g: GameState, f: Faction, target: number): number[] | null {
  const from = heroOf(g, f).at;
  if (!g.nodes[from] || !g.nodes[target]) return null;
  if (from === target) return [];
  const back = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const id of g.nodes[cur].links) {
      if (back.has(id)) continue;
      back.set(id, cur);
      if (id === target) {
        const path: number[] = [];
        for (let n: number = id; n !== from; n = back.get(n)!) path.unshift(n);
        return path;
      }
      // A lock may be walked *to* - the branch above already took it as a target
      // and the key is spent on arrival - but never walked *through*. A vault is
      // empty, so without this a route would stroll across one for free.
      if (!hostile(g, f, id) && !needsKey(g.nodes[id])) queue.push(id);
    }
  }
  return null;
}

export const movesFor = (h: Hero) =>
  TUNING.movePoints + (h.buffs.haste !== undefined ? TUNING.hastePoints : 0);

export const canMove = (g: GameState, id: number) => {
  if (g.phase !== "player" || g.over) return false;
  const h = g.you;
  if (h.reserve.length === 0) return false;
  if (needsKey(g.nodes[id]) && h.res.keys <= 0) return false;
  const route = routeTo(g, "player", id);
  return route !== null && route.length > 0 && route.length <= h.moves;
};

export function orderMove(g: GameState, id: number): boolean {
  if (!canMove(g, id)) return false;
  const route = routeTo(g, "player", id)!;
  g.you.route = route;
  g.next = g.view + STEP_TICKS;
  return true;
}

// Ticks one step of a walk takes to draw. The rules are turns; this is only how
// long the token spends between two cells.
const STEP_TICKS = 5;

// ---------------------------------------------------------------- taking ground

// Walking in is what takes it. Nothing is spent and nothing is fought once the
// bodies in it are gone - a flag is a flag.
function capture(g: GameState, f: Faction, n: MapNode) {
  if (n.owner === f) return;
  const was = n.owner;
  n.owner = f;
  // The key is spent here rather than after a fight, because a vault has nothing
  // standing in it - walking straight in is the usual way one is ever opened.
  if (n.sealed) {
    n.sealed = false;
    heroOf(g, f).res.keys -= 1;
    if (f === "player") log(g, "The seal gives.");
  }
  // Whoever lived here was carrying it, and nothing on the board said so. Only
  // ever on the first taking, so a node cannot be flipped back and forth for keys.
  if (was === "none" && n.key) {
    n.key = false;
    heroOf(g, f).res.keys += 1;
    if (f === "player") log(g, "There is a key on the body.");
  }
  if (n.kind === "throne" && was !== "none") {
    g.over = f === "player" ? "won" : "dead";
    g.phase = "over";
    log(g, f === "player" ? "The throne is yours." : "Your throne has fallen.");
    return;
  }
  if (f === "player") log(g, `${KINDS[n.kind].name} is yours.`);
}

// What a hero can pull out of the node it stands in, and what each body costs.
// The garrison holds the ground for free; joining the marching line is paid for.
export type Offer = { creature: CreatureId; n: number; cost: number };

export const offersHere = (g: GameState, f: Faction): Offer[] => {
  const h = heroOf(g, f);
  const n = g.nodes[h.at];
  if (n.owner !== f) return [];
  return stackOf(n.garrison).map(([c, count]) => ({
    creature: c,
    n: count,
    cost: mobilizeCost(c),
  }));
};

export const canMobilize = (g: GameState, f: Faction, c: CreatureId) => {
  const h = heroOf(g, f);
  const n = g.nodes[h.at];
  return (
    n.owner === f &&
    n.garrison.includes(c) &&
    h.res.gold >= mobilizeCost(c) &&
    roomFor(h, c)
  );
};

// One body at a time, so a hero with half the gold takes half the garrison
export function mobilize(g: GameState, f: Faction, c: CreatureId): boolean {
  if (!canMobilize(g, f, c)) return false;
  const h = heroOf(g, f);
  const n = g.nodes[h.at];
  const k = n.garrison.indexOf(c);
  if (k < 0) return false;
  h.res.gold -= mobilizeCost(c);
  n.garrison.splice(k, 1);
  join(g, h, c, 1);
  return true;
}

export const buffHere = (g: GameState, f: Faction): BuffId | null => {
  const h = heroOf(g, f);
  const n = g.nodes[h.at];
  if (n.kind !== "shrine" || n.owner !== f || !n.buff) return null;
  return n.claimed === weekOf(g.turn) ? null : n.buff;
};

export function claimBuff(g: GameState, f: Faction): boolean {
  const b = buffHere(g, f);
  if (!b) return false;
  const h = heroOf(g, f);
  g.nodes[h.at].claimed = weekOf(g.turn);
  h.buffs[b] = weekOf(g.turn);
  if (f === "player") log(g, `${b} is on you.`);
  return true;
}

export const hasBuff = (g: GameState, h: Hero, b: BuffId) =>
  h.buffs[b] !== undefined && h.buffs[b] === weekOf(g.turn);

// ---------------------------------------------------------------- the week

// Everything anybody holds makes what it makes, once. A producer stands its
// bodies in its own node, at its own depth, in the family of whoever holds it -
// so the same barracks gives them footmen and gives you wraiths.
function payWeek(g: GameState) {
  for (const n of g.nodes) {
    if (n.owner === "none") continue;
    const h = heroOf(g, n.owner);
    const boost = n.owner === "enemy" ? g.difficulty : 1;
    const info = KINDS[n.kind];
    if (info.gold) h.res.gold += Math.round(info.gold * boost);
    if (info.bodies) {
      // Its own depth, in the family of whoever holds it - the same barracks
      // gives them footmen and gives you wraiths
      const c = atTier(h.family, n.tier);
      const many = Math.max(1, Math.round(growthFor(n.tier) * boost));
      for (let i = 0; i < many; i++) n.garrison.push(c);
      // A node only ever holds this many weeks of itself. Uncapped, a throne
      // nobody visits grows into a door neither army can ever open and the game
      // simply stops - which is what the probe found. What overflows is lost, so
      // coming back for it is the decision rather than a formality.
      const cap = growthFor(n.tier) * TUNING.stockWeeks;
      if (n.garrison.length > cap) n.garrison = n.garrison.slice(-cap);
    }
  }
  if (g.turn > 0) log(g, `Week ${weekOf(g.turn) + 1}.`);
}

// ---------------------------------------------------------------- abilities

type Hooks = {
  bonus?: (self: BattleUnit, target: BattleUnit, b: Battle) => number;
  taken?: (self: BattleUnit, amount: number, b: Battle) => number;
  onAttack?: (self: BattleUnit, target: BattleUnit, b: Battle) => void;
  onDeath?: (self: BattleUnit, b: Battle) => void;
};

const living = (b: Battle, f: Faction) => b.units.filter((u) => u.faction === f && u.hp > 0);

export const ABILITIES: Record<AbilityId, Hooks> = {
  bulwark: { taken: (_s, n) => Math.max(1, Math.ceil(n * TUNING.bulwarkCut)) },
  wither: {
    onAttack: (_s, t) => {
      t.withered = TUNING.witherTurns;
    },
  },
  siphon: {
    // Not a heal - it has nothing to give but itself. It moves its own life into
    // whoever is closest to falling and stops before it goes out, so a fight
    // lasts exactly as long as the ones carrying it can pay for.
    onAttack: (s, _t, b) => {
      const hurt = living(b, s.faction)
        .filter((u) => u.id !== s.id && u.hp < u.maxHp)
        .sort((a, z) => a.hp / a.maxHp - z.hp / z.maxHp)[0];
      if (!hurt) return;
      const spare = Math.min(TUNING.siphonHeal * s.n, s.hp - TUNING.siphonFloor * s.n);
      const back = Math.min(hurt.maxHp - hurt.hp, spare);
      if (back <= 0) return;
      s.hp -= back;
      hurt.hp += back;
      sync(s);
      sync(hurt);
      b.mend.push({ id: hurt.id, by: s.id, n: back });
    },
  },
  rend: { bonus: (s, t) => (t.hp * 2 <= t.maxHp ? TUNING.rendBonus * s.n : 0) },
  toll: {
    onDeath: (s, b) => {
      for (const o of living(b, other(s.faction))) {
        damage(b, o, TUNING.tollDamage * s.n, s.id);
      }
    },
  },
};

const hooks = (u: BattleUnit): Hooks => {
  const a = CREATURES[u.creature].ability;
  return a ? ABILITIES[a] : {};
};

// ---------------------------------------------------------------- battle

function blog(b: Battle, line: string) {
  b.log.push(line);
  if (b.log.length > TUNING.logLines) b.log.shift();
}

// Bodies standing in a slot, off what the slot is still holding. A slot is a row
// of health bars, not one long one: five bones at ten take thirty and two of
// them walk out of it, and two bones hit for two bones.
export const standing = (u: BattleUnit) =>
  u.hp > 0
    ? Math.min(Math.ceil(u.hp / Math.max(1, u.each)), Math.ceil(u.maxHp / Math.max(1, u.each)))
    : 0;

const sync = (u: BattleUnit) => {
  u.n = standing(u);
};

// How many bodies the slot walked in with, which is how many corpses it leaves.
// `n` is the living count and a wiped slot has none, so anything counting the
// dead - what rises, what a raise costs - has to ask this instead.
export const fell = (u: BattleUnit) =>
  Math.max(1, Math.round(u.maxHp / Math.max(1, u.each)));

function damage(b: Battle, u: BattleUnit, amount: number, by: number) {
  if (u.hp <= 0) return;
  u.hp = Math.max(0, u.hp - amount);
  sync(u);
  b.hit.push({ id: u.id, by, n: amount });
  if (u.hp > 0) return;
  blog(b, `${CREATURES[u.creature].short} falls.`);
  hooks(u).onDeath?.(u, b);
}

// What a side is carrying into this blow from outside the fight: a pre-fight
// spell and whatever shrine it claimed this week.
type Edge = { hit: number; soak: number };

function strike(b: Battle, a: BattleUnit, d: BattleUnit, edge: Record<Faction, Edge>) {
  // What one body hits for, times the bodies still standing. Everything the
  // hooks add is paid per body too, so a slot that has lost three swings as
  // three fewer bodies rather than as the slot it walked in as.
  let raw = a.dmg * a.n + (hooks(a).bonus?.(a, d, b) ?? 0);
  if (edge[a.faction].hit) raw *= 1 + Math.min(TUNING.softCap, edge[a.faction].hit) / 100;
  // Summed rather than multiplied: two things blunting the same blow answer to
  // one cap between them, or a hex and a ward together make a fight one-sided.
  let soften = 0;
  if (a.withered > 0) soften += 100 - TUNING.witherCut * 100;
  soften += edge[d.faction].soak;
  if (soften > 0) raw *= left(100 - soften);
  const soaked = hooks(d).taken?.(d, raw, b) ?? raw;
  damage(b, d, Math.max(1, Math.round(soaked)), a.id);
  // Fires even on a killing blow, or a mender would be punished for aiming well
  hooks(a).onAttack?.(a, d, b);
}

// Who on the other side can actually be reached. A blow lands on nobody in
// particular - unless a wall is standing, and then it lands on the wall. That is
// the whole of the tactics: break the wall before you can touch anything.
export function targetFor(b: Battle, side: Faction): BattleUnit | undefined {
  const live = living(b, side);
  const wall = live.filter((u) => CREATURES[u.creature].taunt);
  const pool = wall.length ? wall : live;
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : undefined;
}

export const coolOf = (u: BattleUnit) => coolFor(CREATURES[u.creature].speed);

// How far a body is through its own wait: 0 the tick it swung, 1 when it is due.
// The battle clock only moves at a blow, so the wind-up is read off the view
// clock, which is the one that runs between them.
export const readyFrac = (b: Battle, u: BattleUnit, view: number) => {
  const cool = coolOf(u);
  return Math.min(1, Math.max(0, (cool - (u.ready - b.clock - (view - b.at))) / cool));
};

// Who swings next: whoever is due soonest. Ties go to the front of the line, so
// the arrows on the army sheet still decide who lands the blow.
export const nextUp = (b: Battle): BattleUnit | undefined =>
  b.units
    .filter((u) => u.hp > 0)
    .sort((a, z) => a.ready - z.ready || a.slot - z.slot || a.id - z.id)[0];

// What each side brings into a blow from outside the fight. The battle's
// "player" line is always whoever *moved*, so nothing in here may read an
// absolute faction - the enemy hero attacking you is the "player" line of its
// own fight, and its blessing has to land on itself.
function edgesFor(g: GameState, b: Battle): Record<Faction, Edge> {
  const out: Record<Faction, Edge> = { player: { hit: 0, soak: 0 }, enemy: { hit: 0, soak: 0 } };
  const add = (line: Faction, who: Faction) => {
    const h = heroOf(g, who);
    if (hasBuff(g, h, "vigor")) out[line].hit += TUNING.vigorPct;
    if (hasBuff(g, h, "ward")) out[line].soak += TUNING.wardPct;
  };
  add("player", b.mover);
  // A garrison with no hero behind it carries nothing of its own
  if (b.foeHero) add("enemy", other(b.mover));
  // Only the hero who walked in can have cast into this window. Bless sharpens
  // his own line; terror blunts what lands on it.
  if (b.castPre) {
    if (heroOf(g, b.mover).family === "human") out.player.hit += TUNING.blessPct;
    else out.player.soak += TUNING.terrorPct;
  }
  return out;
}

export function takeTurn(g: GameState, b: Battle) {
  if (b.done) return;
  b.hit = [];
  b.mend = [];
  const edge = edgesFor(g, b);
  const u = nextUp(b);
  if (u) {
    // The clock only ever moves forward to whoever is due, so a fight is exactly
    // as long as the speeds standing in it say it is
    b.clock = Math.max(b.clock, u.ready);
    u.ready = b.clock + coolOf(u);
    b.round = Math.floor(b.clock / TUNING.beatTicks);
    const foe = targetFor(b, other(u.faction));
    if (foe) {
      strike(b, u, foe, edge);
      // A hex wears off over the blows it costs its holder, so a quick body
      // shrugs it off in the time a slow one carries it
      if (u.withered > 0) u.withered -= 1;
    }
  }

  if (!living(b, "enemy").length) b.done = "win";
  else if (!living(b, "player").length) b.done = "loss";
  // A fight that will not end is a fight you lost slowly
  else if (b.round >= TUNING.maxRounds) b.done = "loss";
}

// The whole thing at once, for a bot and for anything the player is not watching
export function fight(g: GameState, b: Battle) {
  let guard = TUNING.maxRounds * (b.units.length + 2) * 4 + 64;
  while (!b.done && guard-- > 0) takeTurn(g, b);
}

function lineUp(b: Battle, list: Unit[], f: Faction) {
  list.forEach((u, slot) => {
    b.units.push({
      id: b.nextId++,
      src: u.id,
      slot,
      creature: u.creature,
      faction: f,
      n: u.n,
      each: eachHp(u),
      hp: u.hp,
      maxHp: u.maxHp,
      dmg: CREATURES[u.creature].dmg,
      // Nobody swings on the way in: every body waits out its own first
      // cooldown, so who opens is whoever brought the quickest thing
      ready: coolFor(CREATURES[u.creature].speed),
      withered: 0,
    });
  });
}

// A fight is always the mover's line against whatever is standing where he
// stepped: another hero's army, or a garrison with nobody behind it.
export function makeBattle(g: GameState, mover: Faction, node: number): Battle {
  const b: Battle = {
    node,
    units: [],
    hit: [],
    mend: [],
    clock: 0,
    at: g.view,
    round: 0,
    log: [],
    done: "",
    mover,
    foeHero: heroOf(g, other(mover)).at === node,
    castPre: false,
    castPost: false,
    nextId: 0,
  };

  // The mover always stands in the "player" line of the battle, so the engine
  // never has to know which way round the two heroes are
  lineUp(b, heroOf(g, mover).reserve, "player");
  if (b.foeHero) lineUp(b, heroOf(g, other(mover)).reserve, "enemy");
  else {
    stackOf(g.nodes[node].garrison).forEach(([c, count], slot) => {
      const t = CREATURES[c];
      b.units.push({
        id: b.nextId++,
        src: -1,
        creature: c,
        faction: "enemy",
        n: count,
        each: t.hp,
        hp: t.hp * count,
        maxHp: t.hp * count,
        dmg: t.dmg,
        slot,
        ready: coolFor(t.speed),
        withered: 0,
      });
    });
  }

  const first = nextUp(b);
  if (first) blog(b, `${CREATURES[first.creature].short} is quickest.`);
  return b;
}

// ---------------------------------------------------------------- spells

export const spellCost = (g: GameState, id: SpellId): number => {
  const s = SPELLS[id];
  if (id !== "raise") return s.mana;
  const b = g.battle;
  if (!b) return 0;
  return corpses(b).reduce((sum, u) => sum + raiseCost(raiseAs(u.creature)) * fell(u), 0);
};

// What is on the floor of this fight and could still get up. Split spawns and
// anything of yours are out of it: a corpse is one of theirs.
export const corpses = (b: Battle) =>
  b.units.filter((u) => u.faction === "enemy" && u.hp <= 0);

export function canCast(g: GameState, f: Faction, id: SpellId): boolean {
  const h = heroOf(g, f);
  if (SPELLS[id].family !== h.family) return false;
  if (g.over) return false;
  const w = SPELLS[id].window;
  const b = g.battle;
  if (w === "map") return g.phase === (f === "player" ? "player" : "enemy") && h.mana >= SPELLS[id].mana;
  if (w === "pre") return !!b && !b.castPre && b.round === 0 && h.mana >= SPELLS[id].mana;
  // post
  if (!b || b.castPost || b.done !== "win") return false;
  if (id === "raise") return corpses(b).length > 0 && h.mana > 0;
  return h.mana >= SPELLS[id].mana;
}

// Shadow Step and Forced March are the two map spells; everything else lands on
// a fight. `target` is only ever read by Shadow Step.
export function cast(g: GameState, f: Faction, id: SpellId, target?: number): boolean {
  if (!canCast(g, f, id)) return false;
  const h = heroOf(g, f);
  const b = g.battle;
  switch (id) {
    case "shadowstep": {
      if (target === undefined) return false;
      const n = g.nodes[target];
      if (!n || n.owner !== f) return false;
      h.mana -= SPELLS[id].mana;
      h.at = target;
      h.route = [];
      if (f === "player") {
        see(g);
        log(g, "You step through your own ground.");
      }
      return true;
    }
    case "forcedmarch":
      h.mana -= SPELLS[id].mana;
      h.moves += TUNING.hastePoints;
      return true;
    case "terror":
    case "bless":
      if (!b) return false;
      h.mana -= SPELLS[id].mana;
      b.castPre = true;
      blog(b, id === "terror" ? "The dark settles on them." : "They are blessed.");
      return true;
    case "mend": {
      if (!b) return false;
      h.mana -= SPELLS[id].mana;
      b.castPost = true;
      for (const u of b.units) {
        if (u.faction !== "player" || u.hp <= 0) continue;
        u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * TUNING.mendFrac));
        sync(u);
      }
      writeBack(g, h, b);
      return true;
    }
    case "raise": {
      if (!b) return false;
      // As far as the mana goes, deepest first - a slot you already hold never
      // refuses another body, so the only thing that ever turns one down is
      // having no room for a kind at all.
      const fallen = corpses(b).sort(
        (a, z) => CREATURES[z.creature].tier - CREATURES[a.creature].tier,
      );
      const rose: CreatureId[] = [];
      const shown: number[] = [];
      for (const u of fallen) {
        const c = raiseAs(u.creature);
        const each = raiseCost(c);
        let got = 0;
        for (let i = 0; i < fell(u); i++) {
          if (h.mana < each || !roomFor(h, c)) break;
          h.mana -= each;
          if (!join(g, h, c, 1)) break;
          got += 1;
        }
        if (!got) continue;
        u.creature = c;
        rose.push(c);
        shown.push(u.id);
      }
      if (!rose.length) return false;
      b.castPost = true;
      g.risen = { creatures: rose, units: shown, node: b.node, at: g.view };
      log(g, `${[...new Set(rose)].map((c) => CREATURES[c].short).join(", ")} rises.`.slice(0, 20));
      return true;
    }
  }
}

// ---------------------------------------------------------------- resolving a fight

// Survivors keep their wounds, and a slot comes out as deep as what lived
// through it: bodies fell out of the pool, so the roster has to lose them too,
// or a slot would heal its dead back at the next node.
function writeBack(g: GameState, h: Hero, b: Battle) {
  const alive = new Map(
    b.units.filter((u) => u.faction === "player" && u.hp > 0).map((u) => [u.src, u]),
  );
  h.reserve = h.reserve.filter((u) => alive.has(u.id));
  for (const u of h.reserve) {
    const still = alive.get(u.id)!;
    const each = eachHp(u);
    u.n = still.n;
    u.maxHp = each * still.n;
    u.hp = Math.min(still.hp, u.maxHp);
  }
}

// A hero who loses loses everything he was carrying and walks back into his own
// throne with nothing. He keeps every node he holds: the army was the price.
// `to` is the other hero if one broke him, and keys are the one thing that
// changes hands - a hero beaten by a garrison drops nothing to nobody.
function routed(g: GameState, f: Faction, to: Faction | null = null) {
  const h = heroOf(g, f);
  h.reserve = [];
  h.route = [];
  h.at = throneOf(g, f).id;
  h.moves = 0;
  log(g, f === "player" ? "You are broken, and wake at your throne." : "Their hero is broken.");
  if (to && h.res.keys > 0) {
    heroOf(g, to).res.keys += h.res.keys;
    log(g, to === "player" ? "Their keys are yours." : "Your keys go with them.");
    h.res.keys = 0;
  }
  if (f === "player") see(g);
}

// Everything a finished fight settles except what the player may still cast into
function settle(g: GameState, mover: Faction, b: Battle) {
  const h = heroOf(g, mover);
  if (b.done === "loss") {
    routed(g, mover, b.foeHero ? other(mover) : null);
    return;
  }
  writeBack(g, h, b);
  const n = g.nodes[b.node];
  if (b.foeHero) routed(g, other(mover), mover);
  else n.garrison = [];
  if (h.reserve.length === 0) {
    // A node can be won with nothing left standing, and a won node is still a
    // broken hero
    routed(g, mover);
    return;
  }
  h.at = b.node;
  capture(g, mover, n);
  if (mover === "player") see(g);
}

// ---------------------------------------------------------------- the clock

// The only clock left. The rules are turns; this drives what a turn looks like
// while it is being watched - a token crossing a cell, and blows landing.
export function advance(g: GameState, ticks: number) {
  for (let i = 0; i < ticks && !g.over; i++) tick(g);
}

function tick(g: GameState) {
  g.view += 1;
  if (g.view < g.next) {
    g.rng = rngState();
    return;
  }
  if (g.phase === "player" && g.you.route.length) walk(g);
  else if (g.phase === "fight") fightTick(g);
  else g.next = g.view + STEP_TICKS;
  g.rng = rngState();
}

// One cell of a walk. Movement is spent as it is taken, so a walk that runs into
// a fight has already paid for the ground it crossed.
function walk(g: GameState) {
  const h = g.you;
  const id = h.route.shift();
  if (id === undefined) return;
  h.moves -= 1;
  const wall = hostile(g, "player", id);
  if (wall) {
    h.route = [];
    g.battle = makeBattle(g, "player", id);
    g.phase = "fight";
    g.next = g.view + waitFor(g.battle);
    return;
  }
  h.at = id;
  see(g);
  const n = g.nodes[id];
  if (n.owner !== "player") capture(g, "player", n);
  g.next = g.view + STEP_TICKS;
  if (!h.route.length || h.moves <= 0) h.route = [];
}

const waitFor = (b: Battle) => {
  const up = nextUp(b);
  return Math.max(1, up ? up.ready - b.clock : TUNING.beatTicks);
};

function fightTick(g: GameState) {
  const b = g.battle!;
  takeTurn(g, b);
  b.at = g.view;
  g.next = g.view + waitFor(b);
  if (!b.done) return;
  settle(g, "player", b);
  if (g.over) return;
  // The board stays up until you leave it. That is where the dead get up, which
  // is the one thing in this game worth stopping to watch.
  g.phase = b.done === "win" ? "spoils" : "player";
  g.next = g.phase === "spoils" ? HELD : g.view + STEP_TICKS;
}

export const HELD = Number.MAX_SAFE_INTEGER;

// Walking out of a won fight. Whatever is still on the floor is left there.
export function leaveSpoils(g: GameState): boolean {
  if (g.phase !== "spoils") return false;
  g.battle = null;
  g.risen = null;
  g.phase = "player";
  g.next = g.view + STEP_TICKS;
  return true;
}

// ---------------------------------------------------------------- turns

export const canEndTurn = (g: GameState) => g.phase === "player" && !g.over;

export function endTurn(g: GameState): boolean {
  if (!canEndTurn(g)) return false;
  g.you.route = [];
  g.phase = "enemy";
  botTurn(g, "enemy");
  if (g.over) return true;
  g.turn += 1;
  if (g.turn % TUNING.weekTurns === 0) payWeek(g);
  startTurn(g, g.you);
  startTurn(g, g.foe);
  g.phase = "player";
  g.next = g.view + STEP_TICKS;
  see(g);
  return true;
}

function startTurn(g: GameState, h: Hero) {
  h.moves = movesFor(h);
  h.mana = Math.min(TUNING.manaCap, h.mana + TUNING.manaTurn);
  // A hero standing in his own city is a hero with a full book again
  const n = g.nodes[h.at];
  if (n.owner === h.faction && (n.kind === "throne" || n.kind === "city")) {
    h.mana = TUNING.manaCap;
  }
}

// ---------------------------------------------------------------- the other hero

// What one node is worth to a hero, before distance is taken off it. Every
// behaviour the enemy has is a term in here: taking ground, collecting from its
// own, flipping yours, hunting you, and going for the throne.
function scoreNode(g: GameState, f: Faction, n: MapNode): number {
  const h = heroOf(g, f);
  const mine = armyWorth(h);
  const foe = heroOf(g, other(f));

  // Anything it cannot beat is worth nothing, however good it is
  if (n.owner !== f && n.garrison.length) {
    if (listWorth(n.garrison) * TUNING.aiMargin > mine) return 0;
  }
  if (n.sealed && h.res.keys <= 0) return 0;

  let value = 0;
  const info = KINDS[n.kind];
  if (n.owner !== f) {
    value += info.gold * 3;
    if (info.bodies) value += worthOf(atTier(h.family, n.tier)) * growthFor(n.tier);
    if (info.makes === "buff") value += 120;
    // A tower is worth nothing to a bot that already sees everything, but ground
    // it walks past and never takes is a wall across the map for both of us.
    if (info.makes === "sight") value += TUNING.aiTower;
    // Taking it off them is worth what it stops making for them as well
    if (n.owner === other(f)) value *= 1.6;
  } else if (n.garrison.length) {
    // Its own ground, holding bodies it could be marching with. Only worth
    // walking to as far as the purse actually reaches.
    const afford = n.garrison.filter((c) => mobilizeCost(c) <= h.res.gold);
    value += listWorth(afford.slice(0, 6));
  }
  if (n.kind === "shrine" && n.owner === f && n.claimed !== weekOf(g.turn)) value += 100;

  // The other hero. Worth going after only when it is a long way ahead, because
  // losing costs it everything it is carrying.
  if (foe.at === n.id) {
    const theirs = armyWorth(foe);
    value = mine > theirs * TUNING.aiMargin ? theirs * 1.2 : 0;
  }
  // The end of it, if it can be reached and taken
  if (n.kind === "throne" && n.owner === other(f)) {
    const wall = listWorth(n.garrison) * TUNING.aiMargin;
    value = mine > wall ? 1e6 : 0;
  }
  return value;
}

// One score over every node, best per step wins, commit to the route and decide
// again on arrival. No state machine: every behaviour is a weight in `scoreNode`.
//
// Faction-generic on purpose. The enemy runs it every turn, and the balance
// probe runs the *same* brain on the player side - a bot playing a different
// game from the opponent measures nothing.
export function botTurn(g: GameState, f: Faction) {
  const h = heroOf(g, f);
  const spells = spellsOf(h.family);
  const mapSpell = spells.find((s) => SPELLS[s].window === "map")!;
  let guard = TUNING.movePoints * 3 + 8;
  while (h.moves > 0 && !g.over && guard-- > 0) {
    botSpend(g, f);
    let best: { id: number; per: number; route: number[] } | null = null;
    for (const n of g.nodes) {
      const value = scoreNode(g, f, n);
      if (value <= 0) continue;
      const route = routeTo(g, f, n.id);
      if (!route || !route.length) continue;
      const per = value / route.length;
      if (!best || per > best.per) best = { id: n.id, per, route };
    }
    if (!best) break;
    // Only worth spending on something actually out of reach this turn
    if (best.route.length > h.moves) {
      if (mapSpell === "forcedmarch") cast(g, f, mapSpell);
      else {
        // Shadow Step: jump to whichever of your own nodes leaves the shortest
        // walk to what you want. Straight-line distance is proxy enough, and it
        // costs one comparison a node rather than a search from each of them.
        const away = (a: MapNode, z: MapNode) =>
          Math.abs(a.col - z.col) + Math.abs(a.row - z.row);
        const want = g.nodes[best.id];
        const here = away(g.nodes[h.at], want);
        const jump = g.nodes
          .filter((n) => n.owner === f && away(n, want) < here)
          .sort((a, z) => away(a, want) - away(z, want))[0];
        if (jump) cast(g, f, mapSpell, jump.id);
      }
      // Wherever it ended up, the walk it was planning is no longer the walk
      const again = routeTo(g, f, best.id);
      if (again && again.length) best = { ...best, route: again };
    }
    const steps = Math.min(h.moves, best.route.length);
    let fought = false;
    for (let i = 0; i < steps && !g.over; i++) {
      const id = best.route[i];
      h.moves -= 1;
      if (hostile(g, f, id)) {
        botFight(g, f, id);
        fought = true;
        break;
      }
      h.at = id;
      const n = g.nodes[id];
      if (n.owner !== f) capture(g, f, n);
    }
    if (!fought && h.at === best.id) {
      botSpend(g, f);
      if (buffHere(g, f)) claimBuff(g, f);
    }
    if (h.moves <= 0) break;
  }
}

// A fight nobody is watching resolves whole. The bot casts on the same rules a
// player does: one going in, one coming out, mana the only limit.
function botFight(g: GameState, f: Faction, id: number) {
  const h = heroOf(g, f);
  const spells = spellsOf(h.family);
  const pre = spells.find((s) => SPELLS[s].window === "pre")!;
  const post = spells.find((s) => SPELLS[s].window === "post")!;
  const b = makeBattle(g, f, id);
  const held = g.battle;
  g.battle = b;
  // Mana is the only limit there is, so a bot casts whenever it can pay - which
  // is also the behaviour the pre-fight window was signed off with
  cast(g, f, pre);
  fight(g, b);
  if (b.done === "win") cast(g, f, post);
  settle(g, f, b);
  g.battle = held;
}

// Anything worth buying where it is standing, as far as the purse goes - except
// that a bot never marches out of its own throne carrying the last of what was
// standing in it. Stripping a capital is a move the *rules* allow and a player
// may take; a bot that takes it every time just hands the game away on turn three.
function botSpend(g: GameState, f: Faction) {
  const here = g.nodes[heroOf(g, f).at];
  const floor = here.kind === "throne" && here.owner === f ? TUNING.throneKeep : 0;
  let guard = 40;
  while (guard-- > 0) {
    if (here.garrison.length <= floor) break;
    const best = offersHere(g, f)
      .filter((o) => canMobilize(g, f, o.creature))
      .sort((a, z) => worthOf(z.creature) - worthOf(a.creature))[0];
    if (!best) break;
    if (!mobilize(g, f, best.creature)) break;
  }
}

// ---------------------------------------------------------------- lifecycle

export function newGame(seedValue: number, difficulty = 1, foeFamily: Family = "human", youFamily: Family = "undead"): GameState {
  seedRng(seedValue);
  const hero = (faction: Faction, family: Family): Hero => ({
    faction,
    family,
    at: 0,
    moves: TUNING.movePoints,
    reserve: [],
    mana: TUNING.manaCap,
    res: { gold: 0, keys: 0 },
    buffs: {},
    route: [],
  });
  const g: GameState = {
    seed: seedValue,
    rng: rngState(),
    nodes: [],
    you: hero("player", youFamily),
    foe: hero("enemy", foeFamily),
    turn: 0,
    phase: "player",
    battle: null,
    view: 0,
    next: 0,
    nextUnit: 1,
    difficulty,
    risen: null,
    log: [],
    over: "",
  };
  buildMap(g);
  // A hand to open with, and a week already standing in everything either side
  // holds. Without the stock the first week is seven turns of nobody being able
  // to do anything, which is not an opening so much as a wait.
  for (const h of [g.you, g.foe]) {
    join(g, h, atTier(h.family, 2), TUNING.openBand);
    h.res.gold = TUNING.mineGold * 3;
  }
  payWeek(g);
  see(g);
  log(g, "Into their country.");
  g.rng = rngState();
  return g;
}

const KEY = "gravelight.save";
// Bump whenever GameState changes shape. A save from an older shape is thrown
// away rather than half-read: a missing field crashes the first frame.
const SAVE_VERSION = 16;
const REQUIRED: (keyof GameState)[] = [
  "seed", "rng", "nodes", "you", "foe", "turn", "phase", "battle", "view", "next",
  "nextUnit", "difficulty", "risen", "log", "over",
];

export function save(g: GameState) {
  g.rng = rngState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SAVE_VERSION, g }));
  } catch {
    // a full or blocked store is not worth losing the run over
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const held = JSON.parse(raw) as { v?: number; g?: GameState };
    if (held?.v !== SAVE_VERSION || !held.g) return null;
    if (REQUIRED.some((k) => !(k in held.g!))) return null;
    setRngState(held.g.rng);
    return held.g;
  } catch {
    return null;
  }
}

// Read by the check that holds the shallow end of the ladder to bodies rather
// than rules, so the table cannot quietly grow an ability at tier one.
export const ABILITY_FLOOR = ABILITY_TIER;
export { RES_IDS, spellsOf };
