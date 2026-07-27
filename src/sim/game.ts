import { pick, rnd, rngState, seed as seedRng, setRngState, shuffle } from "./rng.ts";
import { LORE } from "./lore.ts";
import {
  CREATURES,
  KINDS,
  KIND_ROLL,
  OPEN_ROLL,
  RESOURCES,
  RES_IDS,
  START_BAND,
  START_POOL,
  TUNING,
  poolFor,
  tierDmgFor,
  tierGrow,
  tierHpFor,
  type AbilityId,
  type Battle,
  type BattleUnit,
  type CreatureId,
  type Faction,
  type GameState,
  type MapNode,
  type NodeKind,
  type Resource,
  type Unit,
} from "./data.ts";
import { PERK_IDS, TREE, depthOf, linksOf, rootId, type Perks } from "./tree.ts";
import { POWERS, POWER_BY_ID } from "./powers.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// The share of a blow left after a cut. Nothing stacks past the soft cap, or a
// deep enough build makes a thing that cannot be hurt.
const left = (pct: number) => clamp(pct, 100 - TUNING.softCap, 100) / 100;

export const reserve = (g: GameState) => g.reserve;

// ---------------------------------------------------------------- what is bought

// Everything owned, as one bag of numbers: the neutral board plus whatever the
// dark has offered along the way. Small enough that summing it on demand is
// cheaper than keeping a copy honest.
export function perks(g: GameState): Perks {
  const out = Object.fromEntries(PERK_IDS.map((k) => [k, 0])) as Perks;
  const give = (gives: Partial<Perks>) => {
    for (const [k, v] of Object.entries(gives)) out[k as keyof Perks] += v;
  };
  for (const id of g.taken) give(TREE[id].gives);
  for (const id of g.powers) give(POWER_BY_ID[id]?.gives ?? {});
  return out;
}

// What one body of this is worth standing up, everything bought counted in. A
// stack is n of these, so this is the number every slot of the army is built of.
export const bodyHp = (P: Perks, c: CreatureId) => {
  const t = CREATURES[c];
  return (
    t.hp +
    (t.family === "beast" ? P.beastHp : 0) +
    (t.family === "undead" ? P.deadHp : 0) +
    (t.taunt ? P.wallHp : 0)
  );
};

// What one body of this hits for, which is what the stack's blow is n of
export const bodyDmg = (P: Perks, c: CreatureId, rooms: number) => {
  const t = CREATURES[c];
  const years = Math.min(rooms, TUNING.vetCap);
  return (
    t.dmg +
    P.minionDmg +
    P.vetDmg * years +
    (t.family === "beast" ? P.beastDmg : 0) +
    (t.family === "undead" ? P.deadDmg : 0)
  );
};

// What a card adds the moment it is taken. A card that makes bodies bigger has
// to reach the bodies already standing, or taking it late takes nothing - and it
// has to reach every body in a stack, not the stack.
function applyGives(g: GameState, gives: Partial<Perks>) {
  for (const u of g.reserve) {
    const t = CREATURES[u.creature];
    const each =
      (t.family === "beast" ? (gives.beastHp ?? 0) : 0) +
      (t.family === "undead" ? (gives.deadHp ?? 0) : 0) +
      (t.taunt ? (gives.wallHp ?? 0) : 0);
    if (!each) continue;
    u.maxHp += each * u.n;
    u.hp += each * u.n;
  }
}

// ---------------------------------------------------------------- the tree

// What survives a run. Everything else about him is forgotten at the gate; this
// is what the next one starts holding.
export type Meta = { gold: number; taken: number[] };

export const newMeta = (): Meta => ({ gold: 0, taken: [rootId] });

// Distance out is the price. The board is neutral, so there is nothing else to
// gate it with and nothing else it needs.
export const nodeCost = (id: number) => TUNING.nodeBase + depthOf(TREE[id]) * TUNING.nodeStep;

// A node is open if it is beside one already bought - the same rule that opens a
// room next to a room already cleared.
export const treeOpen = (m: Meta): number[] =>
  TREE.filter((n) => !m.taken.includes(n.id) && linksOf(n).some((id) => m.taken.includes(id))).map(
    (n) => n.id,
  );

export const canBuy = (m: Meta, id: number) =>
  treeOpen(m).includes(id) && m.gold >= nodeCost(id);

export function buyNode(m: Meta, id: number): boolean {
  if (!canBuy(m, id)) return false;
  m.gold -= nodeCost(id);
  m.taken.push(id);
  return true;
}

// What a run leaves behind. The purse is emptied as it is paid in, so banking a
// run that has already been banked pays nothing and a reload cannot pay twice.
export function bank(g: GameState, m: Meta): Meta {
  m.gold += g.res.gold;
  g.res.gold = 0;
  return m;
}

// ---------------------------------------------------------------- the offer

// What the dark will put on the table. A rule is gone once it is yours; a number
// may come round again until it has been stacked as deep as it goes.
const drawable = (g: GameState, id: string) => {
  const p = POWER_BY_ID[id];
  const held = g.powers.filter((o) => o === id).length;
  return p.rare ? held === 0 : held < TUNING.powerStack;
};

// A bag with more copies of the common things in it, drawn from without
// replacement so no hand ever shows the same card twice. An empty bag gives the
// point back rather than leaving a sheet up that cannot be answered.
export function rollOffer(g: GameState) {
  const want = Math.max(1, TUNING.offerCount + perks(g).offers);
  const bag: string[] = [];
  for (const p of POWERS) {
    if (!drawable(g, p.id)) continue;
    for (let i = 0; i < (p.rare ? 1 : TUNING.commonWeight); i++) bag.push(p.id);
  }
  const out: string[] = [];
  while (out.length < want && bag.length) {
    const id = bag[Math.floor(rnd() * bag.length)];
    out.push(id);
    for (let i = bag.length - 1; i >= 0; i--) if (bag[i] === id) bag.splice(i, 1);
  }
  g.offer = out;
  if (!out.length) g.unspent = 0;
}

export function takePower(g: GameState, id: string): boolean {
  if (g.unspent <= 0 || !g.offer.includes(id) || !POWER_BY_ID[id]) return false;
  g.unspent -= 1;
  g.powers.push(id);
  applyGives(g, POWER_BY_ID[id].gives);
  g.offer = [];
  if (g.unspent > 0) rollOffer(g);
  return true;
}

// A hand you do not want, once per node of the board that paid for it
export function reroll(g: GameState): boolean {
  if (g.rerolls <= 0 || !g.offer.length) return false;
  g.rerolls -= 1;
  rollOffer(g);
  return true;
}

export const commandCap = (g: GameState) => Math.max(1, TUNING.baseCap + perks(g).slots);
export const manaCap = (g: GameState) => TUNING.manaBase + perks(g).manaPool;

// What a body is when it gets up. Nothing living joins you as it was: the dark
// makes bones of it, or a shambler once you hold the card that says so.
export const raiseAs = (P: Perks, c: CreatureId): CreatureId => {
  const to = CREATURES[c].rises;
  if (!to) return c;
  return P.zombify > 0 ? "zombie" : to;
};

// Priced by what it comes back as, not by what it was: a villager costs what a
// pile of bones costs, because bones is what you get.
export const manaCost = (g: GameState, c: CreatureId) => {
  if (CREATURES[c].mana === 0) return 0;
  const P = perks(g);
  return Math.max(1, CREATURES[raiseAs(P, c)].mana + P.raiseCost);
};

// The army standing in a room it has not finished with. It cannot be given a new
// order: the board is still up and the dead on it are still yours to ask.
export const busy = (g: GameState) => g.mode === "fight" || g.mode === "spoils";

// Slots, not bodies. The same thing shares one, so what the cap holds is how
// many *different* things you can field: depth is free, breadth is the price.
export const fielded = (g: GameState) => g.reserve.length;

// Everything standing, counted one at a time. What leads a fight and what
// crowds a blow are both this, never the slot count.
export const bodies = (g: GameState) => g.reserve.reduce((n, u) => n + u.n, 0);

// Whether one more of this can be stood up: a slot it already has, or a free one
export const roomFor = (g: GameState, c: CreatureId) =>
  g.reserve.some((u) => u.creature === c) || fielded(g) < commandCap(g);

// The same thing in one slot, in the order it first turned up. Both lines are
// built out of this, so a room of four rats stands as one body of four rats.
export function stackOf<T>(list: T[]): [T, number][] {
  const out: [T, number][] = [];
  for (const c of list) {
    const seen = out.find(([id]) => id === c);
    if (seen) seen[1] += 1;
    else out.push([c, 1]);
  }
  return out;
}

// What one body of a stack hits for: what it is, plus what the dark makes of it,
// plus whatever it has earned by not dying yet. The sheet and the board read
// this same function, or the sheet lies about the thing you are about to spend.
export const unitDmg = (g: GameState, u: Unit): number => bodyDmg(perks(g), u.creature, u.rooms);

// ...and what the whole slot throws in one blow, which is what a fight uses
export const stackDmg = (g: GameState, u: Unit): number => unitDmg(g, u) * u.n;
// Levelling sooner is a node of the board, held to the same cap as everything
// else that is bought as a percentage
export const xpNeeded = (g: GameState) =>
  Math.max(1, Math.round(TUNING.xpPerLevel * (g.level + 1) * left(100 - perks(g).xpCut)));
export const hpFrac = (u: { hp: number; maxHp: number }) => clamp(u.hp / u.maxHp, 0, 1);

// Whether a body is a wall, which is the only thing that decides who gets hit.
// The shield wall hands it to everybody, but only on your side of the board.
export const wallish = (u: { creature: CreatureId; faction?: Faction }, P: Perks) =>
  CREATURES[u.creature].taunt || (u.faction !== "enemy" && P.wallAll > 0);

const taunts = (b: Battle, u: BattleUnit) =>
  CREATURES[u.creature].taunt || (u.faction === "player" && b.perks.wallAll > 0);

// Move whoever stands at `k` one place up the line. The order is the order they
// swing in, so this is the whole of it: front of the line goes first.
export function moveUp(g: GameState, k: number) {
  if (k <= 0 || k >= g.reserve.length) return;
  [g.reserve[k - 1], g.reserve[k]] = [g.reserve[k], g.reserve[k - 1]];
}

export const moveDown = (g: GameState, k: number) => moveUp(g, k + 1);

export function log(g: GameState, line: string) {
  g.log.push(line);
  if (g.log.length > TUNING.logLines) g.log.shift();
}

// ---------------------------------------------------------------- map

// A plain grid joined north, south, east and west. Every cell is a room; the
// shape of a run comes from what you choose to take, not from where routes go.
// You start in the middle of it, so difficulty radiates out rather than down.
export const tierForDist = (dist: number, far: number) =>
  clamp(Math.round(((dist - 1) * (TUNING.tiers - 1)) / Math.max(1, far - 1)), 0, TUNING.tiers - 1);

// What is standing in a room is what that kind of room holds, at the depth it
// stands at. The theme is the pool, so a sewer is rats wherever you find it.
function rollFoes(kind: NodeKind, tier: number): CreatureId[] {
  const info = KINDS[kind];
  const pool = poolFor(kind, tier);
  if (!pool.length) return [];
  if (kind === "boss") return [...pool];
  // Rooms near the gate are small enough that an opening band has a real chance;
  // the deep ones are not. Never nothing: an empty room wins itself.
  const n = Math.max(1, TUNING.roomBase + info.size + tierGrow(tier));
  return Array.from({ length: n }, () => pick(pool));
}

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

const GRID_STEPS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function buildMap(g: GameState) {
  const { mapCols, mapRows } = TUNING;
  const gateCol = mapCols >> 1;
  const gateRow = mapRows >> 1;
  const key = (col: number, row: number) => row * mapCols + col;
  const away = (col: number, row: number) => Math.abs(col - gateCol) + Math.abs(row - gateRow);

  const solid = new Set<number>();
  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) solid.add(key(col, row));
  }
  const gate = key(gateCol, gateRow);
  for (const k of shuffle([...solid].filter((k) => k !== gate))) {
    if (rnd() >= TUNING.holeChance) continue;
    solid.delete(k);
    if (!whole(solid, gate, mapCols)) solid.add(k);
  }

  // The Ossuary sits at whatever is left standing furthest from the way in
  let boss = gate;
  let far = 0;
  for (const k of solid) {
    const col = k % mapCols;
    const row = (k - col) / mapCols;
    const d = away(col, row);
    if (d > far || (d === far && row > (boss - (boss % mapCols)) / mapCols)) {
      far = d;
      boss = k;
    }
  }

  const id = new Map<number, number>();
  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const k = key(col, row);
      if (!solid.has(k)) continue;
      // Nothing sealed in the first ring, or a run can open with no way out of
      // the gate and no key to buy one with
      const roll = away(col, row) <= 1 ? OPEN_ROLL : KIND_ROLL;
      const kind: NodeKind = k === gate ? "gate" : k === boss ? "boss" : pick(roll);
      const tier =
        kind === "boss"
          ? TUNING.tiers - 1
          : clamp(tierForDist(away(col, row), far) + KINDS[kind].tierUp, 0, TUNING.tiers - 1);
      id.set(k, g.nodes.length);
      g.nodes.push({
        id: g.nodes.length,
        col,
        row,
        kind,
        tier,
        foes: kind === "gate" ? [] : rollFoes(kind, tier),
        links: [],
        state: "locked",
        lore: null,
      });
    }
  }

  for (const n of g.nodes) {
    for (const [dc, dr] of GRID_STEPS) {
      const col = n.col + dc;
      const row = n.row + dr;
      if (col < 0 || col >= mapCols || row < 0 || row >= mapRows) continue;
      const other = id.get(key(col, row));
      if (other !== undefined) n.links.push(other);
    }
  }

  assignLore(g);
  g.at = id.get(gate)!;
  g.nodes[g.at].state = "cleared";
  unlock(g);
}

// Spread the pieces down the map; the last one always waits at the boss
function assignLore(g: GameState) {
  const path = g.nodes
    .filter((n) => n.kind !== "gate")
    .sort((a, z) => a.row - z.row || a.col - z.col);
  const last = LORE.length - 1;
  path.forEach((n, i) => {
    n.lore = n.kind === "boss" ? last : Math.floor((i * last) / Math.max(1, path.length - 1));
  });
}

function unlock(g: GameState) {
  for (const n of g.nodes) {
    if (n.state !== "cleared") continue;
    for (const id of n.links) if (g.nodes[id].state === "locked") g.nodes[id].state = "open";
  }
  keepOpen(g);
}

// A door is a choice, never a wall. If every way on is sealed and there is
// nothing to open one with, one turns up - a key gates what is worth taking, not
// whether the run can go on at all.
function keepOpen(g: GameState) {
  if (g.res.keys > 0) return;
  const open = g.nodes.filter((n) => n.state === "open");
  if (!open.length || open.some((n) => !KINDS[n.kind].key)) return;
  g.res.keys += 1;
  log(g, "A key turns up.");
}

// A route over ground already taken, where only the last room may still be
// held. That is what makes an order to walk and an order to attack one thing.
export function routeTo(g: GameState, from: number, target: number): number[] | null {
  // An id can outlive the map it came from - a panel left open across a restart
  if (!g.nodes[from] || !g.nodes[target]) return null;
  if (from === target) return [];
  if (g.nodes[target].state === "locked") return null;
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
      if (g.nodes[id].state === "cleared") queue.push(id);
    }
  }
  return null;
}

// What is standing in a room, as one number: what it can take plus what it can
// give. The map is not coloured by this any more - a room says what it is, and
// the sheet you open before walking in says what is in it. This is what the
// probe bot sorts by, and what the sheet ranks a room against your own line with.
export const powerOf = (n: MapNode) =>
  n.foes.reduce((sum, c) => {
    const t = CREATURES[c];
    // A wall is worth what it actually costs to get through, not what its sheet
    // says: nothing behind it can be touched until it is down
    const soak = (t.hp + tierHpFor(n.tier)) * (t.ability === "bulwark" ? 2 : 1);
    return sum + soak + (t.dmg + tierDmgFor(n.tier)) * 6;
  }, 0);

// ---------------------------------------------------------------- army

// Raised bodies are the army. There is nobody else: what is standing is what
// fights, and when none of it is standing the run is over.
//
// The same thing goes in the same slot, and a slot is what the cap counts. A
// stack is one body on the board with everything added up, so a slot of six rats
// swings once for six rats' worth - which makes a narrow army hit harder than a
// broad one, and makes the cap a question of how many kinds, not how many bodies.
export function raise(g: GameState, creature: CreatureId): boolean {
  if (!roomFor(g, creature)) return false;
  const hp = bodyHp(perks(g), creature);
  const stack = g.reserve.find((u) => u.creature === creature);
  if (stack) {
    stack.n += 1;
    stack.maxHp += hp;
    stack.hp += hp;
    return true;
  }
  g.reserve.push({ id: g.nextUnit++, creature, n: 1, hp, maxHp: hp, rooms: 0 });
  return true;
}

export function gainXp(g: GameState, n: number) {
  g.xp += n;
  while (g.xp >= xpNeeded(g)) {
    g.xp -= xpNeeded(g);
    g.level += 1;
    g.unspent += 1;
  }
  // Dealt here rather than when the sheet goes up, so the hand is part of the
  // run and a reload does not deal a fresh one
  if (g.unspent > 0 && !g.offer.length) rollOffer(g);
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
  swarm: {
    // What you have bought is yours, not theirs: their rats swarm at the base rate
    bonus: (s, _t, b) => {
      const mine = s.faction === "player";
      const per = TUNING.swarmPerAlly + (mine ? b.perks.swarmPer : 0);
      const cap = TUNING.swarmCap + (mine ? b.perks.swarmCap : 0);
      // Bought deep enough, the ones already down are still in the way
      const side =
        mine && b.perks.swarmDead
          ? b.units.filter((u) => u.faction === s.faction)
          : living(b, s.faction);
      // Counted per body and paid per body, or a slot holding the whole army
      // would be a slot with no allies in the room
      const bodies = side.reduce((n, u) => n + u.n, 0);
      return Math.min(cap, (bodies - 1) * per) * s.n;
    },
  },
  bulwark: { taken: (_s, n) => Math.max(1, Math.ceil(n * TUNING.bulwarkCut)) },
  wither: {
    onAttack: (s, t, b) => {
      t.withered = TUNING.witherTurns + (s.faction === "player" ? b.perks.witherLong : 0);
    },
  },
  siphon: {
    // Not a heal - a wisp has nothing to give but itself. It moves its own life
    // into whoever is closest to falling and stops before it goes out, so a
    // fight lasts exactly as long as the wisps in it can pay for. Standing
    // behind a wall is what makes that worth doing: it turns life nothing is
    // spending into life the wall is about to lose.
    onAttack: (s, _t, b) => {
      const hurt = living(b, s.faction)
        .filter((u) => u.id !== s.id && u.hp < u.maxHp)
        .sort((a, z) => a.hp / a.maxHp - z.hp / z.maxHp)[0];
      if (!hurt) return;
      // A slot of three wisps gives three wisps' worth and keeps three wisps' floor
      const spare = Math.min(TUNING.siphonHeal * s.n, s.hp - TUNING.siphonFloor * s.n);
      const back = Math.min(hurt.maxHp - hurt.hp, spare);
      if (back <= 0) return;
      s.hp -= back;
      hurt.hp += back;
      b.mend.push({ id: hurt.id, by: s.id, n: back });
    },
  },
  rend: { bonus: (s, t) => (t.hp * 2 <= t.maxHp ? TUNING.rendBonus * s.n : 0) },
  toll: {
    onDeath: (s, b) => {
      for (const o of living(b, s.faction === "player" ? "enemy" : "player")) {
        damage(b, o, TUNING.tollDamage * s.n, s.id);
      }
    },
  },
  split: {
    // One copy, not two. What is behind the wall has to be beatable by whatever
    // is left of you after the wall.
    onDeath: (s, b) => {
      if (s.tier >= TUNING.splitTiers) return;
      b.units.push({
        id: b.nextId++,
        src: -1,
        creature: s.creature,
        faction: s.faction,
        n: s.n,
        hp: Math.ceil(s.maxHp / 2),
        maxHp: Math.ceil(s.maxHp / 2),
        dmg: Math.max(1, Math.floor(s.dmg * 0.6)),
        slot: s.slot,
        tier: s.tier + 1,
        withered: 0,
      });
      blog(b, `${CREATURES[s.creature].short} splits.`);
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

function damage(b: Battle, u: BattleUnit, amount: number, by: number) {
  if (u.hp <= 0) return;
  u.hp = Math.max(0, u.hp - amount);
  b.hit.push({ id: u.id, by, n: amount });
  if (u.hp > 0) return;
  blog(b, `${CREATURES[u.creature].short} falls.`);
  hooks(u).onDeath?.(u, b);
  // Bought deep enough, one of theirs going down is felt by the rest of them.
  // Safe to recurse: anything already down is out at the top of this function.
  if (b.perks.spite && u.faction === "enemy") {
    for (const o of living(b, "enemy")) damage(b, o, TUNING.tollDamage, by);
  }
}

function strike(b: Battle, a: BattleUnit, d: BattleUnit) {
  let raw = a.dmg + (hooks(a).bonus?.(a, d, b) ?? 0);
  // Bought deep enough, everything of yours crowds the way a rat does...
  if (a.faction === "player" && b.perks.swarmAll && CREATURES[a.creature].ability !== "swarm") {
    raw += ABILITIES.swarm.bonus!(a, d, b);
  }
  // ...and bites the wounded the way a grave hound does
  if (a.faction === "player" && b.perks.rendAll && CREATURES[a.creature].ability !== "rend") {
    raw += ABILITIES.rend.bonus!(a, d, b);
  }
  // What the dark has already touched is easier to break open
  if (a.faction === "player" && d.withered > 0) raw += b.perks.hexDmg;
  // ...and what it is holding swings softer, more so the deeper you bought in.
  // Summed rather than multiplied: two debuffs on the same blow answer to one
  // cap between them, or a full arm of them makes a fight one-sided.
  let soften = 0;
  if (a.withered > 0) {
    soften += 100 - TUNING.witherCut * 100 + (a.faction === "enemy" ? b.perks.witherPow : 0);
  }
  if (a.faction === "enemy") soften += b.perks.dread;
  if (soften > 0) raw *= left(100 - soften);
  let soaked = hooks(d).taken?.(d, raw, b) ?? raw;
  // Only what was born a wall. A shield wall changes who is hit, not what a hit
  // is worth, or one card puts the cap on every body you own.
  if (d.faction === "player" && b.perks.wallCut && CREATURES[d.creature].taunt) {
    soaked *= left(100 - b.perks.wallCut);
  }
  damage(b, d, Math.max(1, Math.round(soaked)), a.id);
  // Swinging while the dark is on you costs you something for the effort
  if (a.faction === "enemy" && a.withered > 0 && b.perks.rot) {
    damage(b, a, TUNING.rotDamage, a.id);
  }
  // Fires even on a killing blow, or a wisp would be punished for aiming well
  hooks(a).onAttack?.(a, d, b);
  // Bought deep enough, the dark does not need a moth to carry it
  if (a.faction === "player" && b.perks.witherAll) {
    d.withered = TUNING.witherTurns + b.perks.witherLong;
  }
}

// Who on the other side can actually be reached. A blow lands on nobody in
// particular - unless a wall is standing, and then it lands on the wall. That
// is the whole of the tactics: break the wall before you can touch anything.
export function targetFor(b: Battle, side: Faction): BattleUnit | undefined {
  const live = living(b, side);
  const wall = live.filter((u) => taunts(b, u));
  const pool = wall.length ? wall : live;
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : undefined;
}

// A side's own queue, front of the line first. Nothing hidden decides it: the
// order you put them in is the order they swing in.
export function orderFor(b: Battle, side: Faction): number[] {
  return living(b, side)
    .sort((a, z) => a.slot - z.slot || a.id - z.id)
    .map((u) => u.id);
}

// The two lines take it in turns, one blow each, and each line cycles through
// its own people. Bringing six against three means each of the six swings half
// as often - the numbers buy you a deeper bench and the opening blow, not more blows.
export function takeTurn(b: Battle) {
  if (b.done) return;
  b.hit = [];
  b.mend = [];
  const side = b.next;
  const list = orderFor(b, side);
  if (list.length) {
    const i = b.cursor[side] % list.length;
    const u = b.units.find((o) => o.id === list[i]);
    b.cursor[side] = i + 1 >= list.length ? 0 : i + 1;
    const foe = u ? targetFor(b, side === "player" ? "enemy" : "player") : undefined;
    if (u && foe) {
      strike(b, u, foe);
      if (u.withered > 0) u.withered -= 1;
    }
  }
  b.next = side === "player" ? "enemy" : "player";
  // An exchange is a blow from each side, whatever the two lines are made of,
  // so the cap on a fight means the same thing however many are standing in it
  if (b.next === b.lead) b.round += 1;

  if (!living(b, "enemy").length) b.done = "win";
  else if (!living(b, "player").length) b.done = "loss";
  // A fight that will not end is a fight you lost slowly
  else if (b.round >= TUNING.maxRounds) b.done = "loss";
}

export function fight(b: Battle) {
  let guard = TUNING.maxRounds * 2 + b.units.length + 16;
  while (!b.done && guard-- > 0) takeTurn(b);
}

function makeBattle(g: GameState): Battle {
  const n = g.nodes[g.at];
  const b: Battle = {
    perks: perks(g),
    node: g.at,
    units: [],
    hit: [],
    mend: [],
    lead: "player",
    next: "player",
    cursor: { player: 0, enemy: 0 },
    round: 0,
    log: [],
    done: "",
    healed: 0,
    taken: [],
    nextId: 0,
  };

  g.reserve.forEach((u, slot) => {
    b.units.push({
      id: b.nextId++,
      src: u.id,
      slot,
      creature: u.creature,
      faction: "player",
      n: u.n,
      hp: u.hp,
      maxHp: u.maxHp,
      dmg: stackDmg(g, u),
      tier: 0,
      withered: 0,
    });
  });
  // Their line stacks the way yours does, or a room of four rats would get four
  // blows to your one and the whole point of a slot would be on your side only
  stackOf(n.foes).forEach(([c, count], slot) => {
    const t = CREATURES[c];
    const hp = (t.hp + tierHpFor(n.tier)) * count;
    b.units.push({
      id: b.nextId++,
      src: -1,
      creature: c,
      faction: "enemy",
      n: count,
      hp,
      maxHp: hp,
      dmg: (t.dmg + tierDmgFor(n.tier)) * count,
      slot,
      tier: 0,
      withered: 0,
    });
  });

  // The bigger line opens, counted in bodies rather than slots. Even sides toss.
  const ours = bodies(g);
  const theirs = n.foes.length;
  b.lead = ours > theirs ? "player" : theirs > ours ? "enemy" : rnd() < 0.5 ? "player" : "enemy";
  b.next = b.lead;
  blog(b, ours > theirs ? "You are more." : theirs > ours ? "They are more." : "Even sides.");
  blog(b, b.lead === "player" ? "You swing first." : "They swing first.");
  return b;
}

// ---------------------------------------------------------------- orders

// A sealed room takes a key to walk into, and stays sealed until it is cleared.
// Nothing else on the map ever refuses you.
export const needsKey = (n: MapNode | undefined) => n !== undefined && KINDS[n.kind].key && n.state !== "cleared";

export const canOrder = (g: GameState, id: number) =>
  !g.over &&
  !busy(g) &&
  g.reserve.length > 0 &&
  routeTo(g, g.at, id) !== null &&
  (!needsKey(g.nodes[id]) || g.res.keys > 0);

export function orderArmy(g: GameState, id: number): boolean {
  if (!canOrder(g, id)) return false;
  const route = routeTo(g, g.at, id);
  if (!route || !route.length) return false;
  g.route = route;
  g.mode = "march";
  g.next = g.time + TUNING.marchTicks;
  return true;
}

// ---------------------------------------------------------------- the clock

export function advance(g: GameState, ticks: number) {
  for (let i = 0; i < ticks && !g.over; i++) step(g);
}

function step(g: GameState) {
  g.time += 1;
  if (g.time >= g.next) {
    if (g.mode === "march") march(g);
    else if (g.mode === "fight") fightTurn(g);
    else if (g.mode === "spoils") finish(g);
    else g.next = g.time + TUNING.idlePoll;
  }
  g.rng = rngState();
}

function march(g: GameState) {
  const next = g.route.shift();
  if (next === undefined) return arrive(g);
  g.at = next;
  if (!g.route.length) return arrive(g);
  g.next = g.time + TUNING.marchTicks;
}

function arrive(g: GameState) {
  const n = g.nodes[g.at];
  // The key is spent on the door, not on the room: walking away from a sealed
  // room you have opened does not seal it again
  const sealed = needsKey(n);
  if (n.state === "open" && (!sealed || g.res.keys > 0)) {
    if (sealed) {
      g.res.keys -= 1;
      log(g, "The seal gives.");
    }
    g.battle = makeBattle(g);
    g.mode = "fight";
    g.next = g.time + TUNING.turnTicks;
    return;
  }
  g.mode = "idle";
  g.next = g.time + TUNING.idlePoll;
  readLore(g, g.nodes[g.at]);
}

function fightTurn(g: GameState) {
  const b = g.battle!;
  takeTurn(b);
  g.next = g.time + TUNING.turnTicks;
  if (b.done) settle(g, b);
}

// The dark takes what is left of you. There is nobody standing behind the army.
function dead(g: GameState) {
  g.over = "dead";
  log(g, "The dark has you.");
}

function settle(g: GameState, b: Battle) {
  // Survivors keep their wounds; the fallen do not come back. A slot falls whole,
  // so what it cost you is everybody who was standing in it.
  const alive = new Map(
    b.units.filter((u) => u.faction === "player" && u.hp > 0).map((u) => [u.src, u.hp]),
  );
  g.lost += g.reserve.filter((u) => !alive.has(u.id)).reduce((n, u) => n + u.n, 0);
  g.reserve = g.reserve.filter((u) => alive.has(u.id));
  for (const u of g.reserve) u.hp = alive.get(u.id)!;

  // The board stays up for a beat afterwards. That beat is where the dead get
  // up, which is the one thing in this game worth stopping to watch.
  g.mode = "spoils";
  g.next = g.time + TUNING.spoilsTicks;

  if (b.done === "loss") return dead(g);

  const n = g.nodes[b.node];
  clearRoom(g, b, n);
  g.rooms += 1;
  if (n.kind === "boss") {
    g.over = "won";
    log(g, "It is finished.");
    return;
  }
  // A room can be won with nothing left standing - a warden's toll takes the
  // last of you down on its way out - and a won room is still a lost run
  if (!g.reserve.length) return dead(g);

  // The room is yours and nothing hurries you out of it. The board stays up
  // until you say so, because what to do with the dead on it is the decision.
  g.next = HELD;
  if (offered(g, b).length) log(g, "The dead wait.");
}

// A won room waits: no tick ever comes round to end it
export const HELD = Number.MAX_SAFE_INTEGER;

// Bodies in this room you could still ask, cost aside
export const offered = (g: GameState, b: Battle) =>
  b.units.filter(
    (u) =>
      u.faction === "enemy" && u.hp <= 0 && !b.taken.includes(u.id) && manaCost(g, u.creature) > 0,
  );

// The room you are standing in, if the board is still up and still yours to work
export const held = (g: GameState): Battle | null =>
  g.battle && g.mode === "spoils" && g.battle.done === "win" ? g.battle : null;

// Whoever is worst off, which is the same one a wisp would go for. Paid for and
// paid out per body, so mending a deep slot is a deep slot's worth of both.
export const mendCost = (g: GameState, u: Unit) => manaCost(g, u.creature) * u.n;

export const mendable = (g: GameState) => {
  if (!held(g) || !perks(g).mend) return null;
  const u = g.reserve.filter((o) => o.hp < o.maxHp).sort((a, z) => hpFrac(a) - hpFrac(z))[0];
  return u && g.mana >= mendCost(g, u) ? u : null;
};

// The one place a body goes back up instead of only down, and it is paid for out
// of the same pool that would have raised a new one
export function mend(g: GameState): boolean {
  const b = held(g);
  const u = mendable(g);
  if (!b || !u) return false;
  g.mana -= mendCost(g, u);
  const back = Math.min(u.maxHp - u.hp, perks(g).mend * u.n);
  u.hp += back;
  const shown = b.units.find((o) => o.src === u.id);
  if (shown) shown.hp = u.hp;
  b.mend.push({ id: shown?.id ?? -1, by: -1, n: back });
  log(g, `${CREATURES[u.creature].short} mended. +${back}`.slice(0, 20));
  return true;
}

// One slot, bought whole. The free ones a room gives up are luck; this is the
// choice - and a slot of four costs four, because four is what you get.
export function reap(g: GameState, unitId: number): boolean {
  const b = held(g);
  if (!b) return false;
  const u = b.units.find((o) => o.id === unitId);
  if (!u || !offered(g, b).includes(u)) return false;
  const c = raiseAs(perks(g), u.creature);
  const cost = manaCost(g, u.creature) * u.n;
  if (g.mana < cost) {
    log(g, "Not enough of you.");
    return false;
  }
  // One slot for the whole of it, however deep it is - so the only thing that
  // ever refuses a slot is having no room for a thing of that kind at all
  if (!roomFor(g, c)) {
    log(g, "No room for it.");
    return false;
  }
  for (let i = 0; i < u.n; i++) raise(g, c);
  g.mana -= cost;
  b.taken.push(u.id);
  // It is not what it was any more. The board reads this, so a villager asked
  // for has to stop being a villager on the frame it is asked for.
  u.creature = c;
  g.risen = { creatures: [c], units: [u.id], node: b.node, at: g.time };
  log(g, `${CREATURES[c].short} rises.`.slice(0, 20));
  return true;
}

// Whether unmaking one out of this slot is allowed at all. Never the last of
// them: an army of nobody is a dead run, and that is not a button.
export const canSell = (g: GameState, unitId: number) =>
  held(g) !== null && bodies(g) > 1 && g.reserve.some((u) => u.id === unitId);

// One body given back to the pool it came out of, off the top of its slot. It
// always pays the same, and it always pays less than the cheapest thing there
// is - so this is a slot you wanted and a body you would rather have, never a
// way to make mana.
export function sell(g: GameState, unitId: number): boolean {
  if (!canSell(g, unitId)) return false;
  const i = g.reserve.findIndex((u) => u.id === unitId);
  const u = g.reserve[i];
  const each = Math.round(u.maxHp / u.n);
  u.n -= 1;
  u.maxHp = Math.max(0, u.maxHp - each);
  u.hp = Math.min(u.hp, u.maxHp);
  if (u.n <= 0) g.reserve.splice(i, 1);
  g.mana = Math.min(manaCap(g), g.mana + TUNING.sellMana);
  const b = held(g)!;
  const shown = b.units.find((o) => o.src === u.id);
  if (shown) {
    shown.n = u.n;
    shown.maxHp = Math.max(1, u.maxHp);
    shown.hp = u.hp;
  }
  log(g, `${CREATURES[u.creature].short} unmade.`.slice(0, 20));
  return true;
}

// You are done with the room. Nothing else ends the spoils.
export function leaveRoom(g: GameState): boolean {
  if (g.mode !== "spoils") return false;
  finish(g);
  return true;
}

// The beat is over: put the board away and get on with it
function finish(g: GameState) {
  const b = g.battle;
  g.battle = null;
  if (!b || b.done === "loss") return;
  g.mode = "idle";
  g.next = g.time + TUNING.idlePoll;
  readLore(g, g.nodes[b.node]);
}

// Gold falls out of anything and is banked into the tree at the end of a run. A
// key is carried by the living and the well guarded, and it is what opens a door
// somebody meant to keep shut.
const loot = (n: MapNode): Record<Resource, number> => ({
  gold: KINDS[n.kind].gold,
  keys: KINDS[n.kind].keys,
});

// Everything a won room pays. There is no sheet to stop and read in a game that
// keeps running, so it all goes to the log.
function clearRoom(g: GameState, b: Battle, n: MapNode) {
  n.state = "cleared";
  g.cleared += 1;
  unlock(g);
  // A room that stops fighting back is a room you get some of yourself back in
  const P = perks(g);
  const rise = TUNING.manaRegen + P.manaRise / 100;
  g.mana = Math.min(manaCap(g), g.mana + Math.ceil(manaCap(g) * rise));

  // Anything that lived through it has one more room behind it, and gets a
  // little of itself back for it. With nobody standing behind the army this is
  // the only thing that heals without a node of the tree bought for it.
  let mended = 0;
  const rest = TUNING.restFrac + P.restMore / 100;
  for (const u of g.reserve) {
    u.rooms += 1;
    // Paid per body, or a slot of six veterans would be one veteran's worth
    if (u.rooms <= TUNING.vetCap) u.maxHp += P.vetHp * u.n;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + P.vetHp * u.n + Math.ceil(u.maxHp * rest));
    mended += u.hp - before;
    const shown = b.units.find((o) => o.src === u.id);
    if (shown) {
      shown.maxHp = u.maxHp;
      shown.hp = u.hp;
    }
  }
  b.healed = mended;

  // Split spawns are not corpses anybody left behind, so they pay nothing
  const fallen = b.units.filter((u) => u.faction === "enemy" && u.hp <= 0 && u.tier === 0);
  const xp = fallen.reduce((s, u) => s + CREATURES[u.creature].xp * u.n, 0);
  gainXp(g, xp);

  const res = loot(n);
  for (const k of RES_IDS) g.res[k] += res[k];
  const spoils = RES_IDS.filter((k) => res[k] > 0).map((k) => `${RESOURCES[k].glyph}${res[k]}`);
  log(g, `+${xp}xp ${spoils.join(" ")}`.slice(0, 20));

  // Only a little of it gets up on its own. The rest has to be asked for, a slot
  // at a time, and paid for. The roll is per slot, because a slot is the body.
  const rose: CreatureId[] = [];
  const bodies: number[] = [];
  const free = KINDS[n.kind].freeRise || P.glut > 0;
  for (const u of fallen) {
    if (u.creature === "ossuary") continue;
    if (!free && rnd() >= TUNING.raiseChance + P.riseLuck / 100) continue;
    const c = raiseAs(P, u.creature);
    let got = 0;
    for (let i = 0; i < u.n; i++) if (raise(g, c)) got += 1;
    if (!got) break;
    b.taken.push(u.id);
    u.creature = c;
    rose.push(c);
    bodies.push(u.id);
  }
  // What a sealed room was hiding. It is why you spent the key.
  const gift = KINDS[n.kind].gift;
  if (gift) {
    for (let i = 0; i < TUNING.giftBodies; i++) if (raise(g, gift)) rose.push(gift);
  }
  if (rose.length) {
    g.risen = { creatures: rose, units: bodies, node: n.id, at: g.time };
    log(g, `${[...new Set(rose)].map((c) => CREATURES[c].short).join(", ")} rises.`.slice(0, 20));
  }
}

function readLore(g: GameState, n: MapNode) {
  if (n.lore === null || g.seenLore.includes(n.lore)) return;
  g.seenLore.push(n.lore);
  g.loreQueue.push(n.lore);
}

// ---------------------------------------------------------------- lifecycle

// One thing out of the early pool, several times over. A slot is what an army is
// made of, so the gate hands you one to deepen rather than a spread to sort out -
// and every entry in the pool is something three of can kill and can take a room.
export const rollBand = (more = 0): CreatureId[] => {
  const c = pick(START_POOL);
  return Array.from({ length: Math.max(1, START_BAND + more) }, () => c);
};

// `owned` is what the board carries over. Handed in rather than read, so the sim
// still knows nothing about where a save lives.
export function newGame(seedValue: number, owned: number[] = [rootId]): GameState {
  seedRng(seedValue);
  const g: GameState = {
    seed: seedValue,
    rng: rngState(),
    time: 0,
    nodes: [],
    reserve: [],
    at: 0,
    route: [],
    mode: "idle",
    next: 0,
    battle: null,
    rooms: 0,
    nextUnit: 1,
    xp: 0,
    level: 0,
    unspent: 0,
    mana: TUNING.manaBase,
    // The middle of the board comes free, and it is worth a body
    taken: [...owned],
    powers: [],
    offer: [],
    rerolls: 0,
    res: { gold: 0, keys: 0 },
    risen: null,
    seenLore: [],
    loreQueue: [],
    cleared: 0,
    lost: 0,
    log: [],
    over: "",
  };
  buildMap(g);
  // What the board is worth at the gate: a full pool, the band it opens with,
  // and the hands it will be dealt. The rest it gives is spent as it goes.
  const P = perks(g);
  g.mana = manaCap(g);
  g.rerolls = P.rerolls;
  for (const c of rollBand(P.startBand)) raise(g, c);
  log(g, "Into the dark.");
  g.rng = rngState();
  return g;
}

const KEY = "gravelight.save";
// Bump whenever GameState changes shape. A save from an older shape is thrown
// away rather than half-read: a missing field crashes the first frame.
const SAVE_VERSION = 11;
// Checked as well as the version, because the likely mistake is adding a field
// and forgetting to bump
const REQUIRED: (keyof GameState)[] = [
  "seed", "rng", "time", "nodes", "reserve", "at", "route", "mode", "next", "battle", "rooms",
  "nextUnit", "xp", "level", "unspent", "mana", "taken", "powers", "offer", "rerolls", "res",
  "risen", "seenLore", "loreQueue", "cleared", "lost", "log", "over",
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

// Its own key and its own version, because the likely change is to the shape of
// a run and that must never cost him the board he has spent runs buying.
const META_KEY = "gravelight.meta";
const META_VERSION = 1;

export function saveMeta(m: Meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ v: META_VERSION, m }));
  } catch {
    // a full or blocked store is not worth losing the run over
  }
}

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return newMeta();
    const held = JSON.parse(raw) as { v?: number; m?: Meta };
    if (held?.v !== META_VERSION || !held.m) return newMeta();
    if (typeof held.m.gold !== "number" || !Array.isArray(held.m.taken)) return newMeta();
    // The middle is free and is what every other node hangs off, so a board
    // without it is a board nothing can be bought on
    if (!held.m.taken.includes(rootId)) held.m.taken.push(rootId);
    return held.m;
  } catch {
    return newMeta();
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
