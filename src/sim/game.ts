import { pick, rnd, rngState, seed as seedRng, setRngState, shuffle } from "./rng.ts";
import { LORE } from "./lore.ts";
import {
  BOSS_FOES,
  CREATURES,
  KIND_ROLL,
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

// What a thing adds the moment it is yours. A number you cannot use until the
// next room is not a reward, so the ceiling and anything already standing both
// have to hear about it.
function applyGives(g: GameState, gives: Partial<Perks>) {
  if (gives.manaPool) g.mana += gives.manaPool;
  if (gives.rerolls) g.rerolls += gives.rerolls;
  // A body at the gate is only ever a body at the gate, so it arrives now
  if (gives.startBand) for (let i = 0; i < gives.startBand; i++) raise(g, pick(START_POOL));
  for (const u of g.reserve) {
    const gain =
      (gives.ratHp && u.creature === "rat" ? gives.ratHp : 0) +
      (gives.wallHp && CREATURES[u.creature].taunt ? gives.wallHp : 0);
    if (!gain) continue;
    u.maxHp += gain;
    u.hp += gain;
  }
}

// ---------------------------------------------------------------- the tree

// Distance out is the price. The board is neutral, so there is nothing else to
// gate it with and nothing else it needs.
export const nodeCost = (id: number) => TUNING.nodeBase + depthOf(TREE[id]) * TUNING.nodeStep;

// A node is open if it is beside one already bought - the same rule that opens a
// room next to a room already cleared.
export const treeOpen = (g: GameState): number[] =>
  TREE.filter((n) => !g.taken.includes(n.id) && linksOf(n).some((id) => g.taken.includes(id))).map(
    (n) => n.id,
  );

export const canTake = (g: GameState, id: number) =>
  treeOpen(g).includes(id) && g.res.gold >= nodeCost(id);

export function takeNode(g: GameState, id: number): boolean {
  if (!canTake(g, id)) return false;
  g.res.gold -= nodeCost(id);
  g.taken.push(id);
  applyGives(g, TREE[id].gives);
  return true;
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
export const manaCost = (g: GameState, c: CreatureId) =>
  CREATURES[c].mana === 0 ? 0 : Math.max(1, CREATURES[c].mana + perks(g).raiseCost);

// The army standing in a room it has not finished with. It cannot be given a new
// order: the board is still up and the dead on it are still yours to ask.
export const busy = (g: GameState) => g.mode === "fight" || g.mode === "spoils";

export const fielded = (g: GameState) => g.reserve.length;

// What a body actually hits for: what it is, plus what the tree makes of it,
// plus whatever it has earned by not dying yet. The sheet and the board read
// this same function, or the sheet lies about the thing you are about to spend.
export const unitDmg = (g: GameState, u: Unit): number => {
  const P = perks(g);
  const t = CREATURES[u.creature];
  const years = Math.min(u.rooms, TUNING.vetCap);
  return t.dmg + P.minionDmg + P.vetDmg * years + (u.creature === "rat" ? P.ratDmg : 0);
};
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

function rollFoes(kind: NodeKind, tier: number): CreatureId[] {
  if (kind === "boss") return [...BOSS_FOES];
  // Rooms near the gate are small enough that an opening band has a real chance;
  // the deep ones are not
  const grow = tierGrow(tier);
  const base = TUNING.roomBase;
  // Never nothing: a room with no one in it is a room that wins itself
  const n = Math.max(
    1,
    kind === "elite" ? base + 1 + grow : kind === "crypt" ? base - 1 + grow : base + grow,
  );
  return Array.from({ length: n }, () => pick(poolFor(tier)));
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
      const kind: NodeKind = k === gate ? "gate" : k === boss ? "boss" : pick(KIND_ROLL);
      const tier =
        kind === "boss"
          ? TUNING.tiers - 1
          : clamp(tierForDist(away(col, row), far) + (kind === "elite" ? 1 : 0), 0, TUNING.tiers - 1);
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
// give. Three bands, because a map you have to read at a glance is a map with
// three colours on it.
export const powerOf = (n: MapNode) =>
  n.foes.reduce((sum, c) => {
    const t = CREATURES[c];
    // A wall is worth what it actually costs to get through, not what its sheet
    // says: nothing behind it can be touched until it is down
    const soak = (t.hp + tierHpFor(n.tier)) * (t.ability === "bulwark" ? 2 : 1);
    return sum + soak + (t.dmg + tierDmgFor(n.tier)) * 6;
  }, 0);

export const threatOf = (n: MapNode): 0 | 1 | 2 => {
  const p = powerOf(n);
  return p < TUNING.threatMild ? 0 : p < TUNING.threatBad ? 1 : 2;
};

// ---------------------------------------------------------------- army

// Raised bodies are the army. There is nobody else: what is standing is what
// fights, and when none of it is standing the run is over.
export function raise(g: GameState, creature: CreatureId): boolean {
  if (fielded(g) >= commandCap(g)) return false;
  const t = CREATURES[creature];
  const P = perks(g);
  const hp = t.hp + (creature === "rat" ? P.ratHp : 0) + (t.taunt ? P.wallHp : 0);
  g.reserve.push({ id: g.nextUnit++, creature, hp, maxHp: hp, rooms: 0 });
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
      return Math.min(cap, (side.length - 1) * per);
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
      const spare = Math.min(TUNING.siphonHeal, s.hp - TUNING.siphonFloor);
      const back = Math.min(hurt.maxHp - hurt.hp, spare);
      if (back <= 0) return;
      s.hp -= back;
      hurt.hp += back;
      b.mend.push({ id: hurt.id, by: s.id, n: back });
    },
  },
  rend: { bonus: (_s, t) => (t.hp * 2 <= t.maxHp ? TUNING.rendBonus : 0) },
  toll: {
    onDeath: (s, b) => {
      for (const o of living(b, s.faction === "player" ? "enemy" : "player")) {
        damage(b, o, TUNING.tollDamage, s.id);
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
  // Bought deep enough, everything of yours crowds the way a rat does
  if (a.faction === "player" && b.perks.swarmAll && CREATURES[a.creature].ability !== "swarm") {
    raw += ABILITIES.swarm.bonus!(a, d, b);
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
      hp: u.hp,
      maxHp: u.maxHp,
      dmg: unitDmg(g, u),
      tier: 0,
      withered: 0,
    });
  });
  n.foes.forEach((c, slot) => {
    const t = CREATURES[c];
    b.units.push({
      id: b.nextId++,
      src: -1,
      creature: c,
      faction: "enemy",
      hp: t.hp + tierHpFor(n.tier),
      maxHp: t.hp + tierHpFor(n.tier),
      dmg: t.dmg + tierDmgFor(n.tier),
      slot,
      tier: 0,
      withered: 0,
    });
  });

  // The bigger line opens. Even sides toss for it.
  const ours = g.reserve.length;
  const theirs = n.foes.length;
  b.lead = ours > theirs ? "player" : theirs > ours ? "enemy" : rnd() < 0.5 ? "player" : "enemy";
  b.next = b.lead;
  blog(b, ours > theirs ? "You are more." : theirs > ours ? "They are more." : "Even sides.");
  blog(b, b.lead === "player" ? "You swing first." : "They swing first.");
  return b;
}

// ---------------------------------------------------------------- orders

export const canOrder = (g: GameState, id: number) =>
  !g.over &&
  !busy(g) &&
  g.reserve.length > 0 &&
  routeTo(g, g.at, id) !== null;

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
  if (g.nodes[g.at].state === "open") {
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
  // Survivors keep their wounds; the fallen do not come back
  const alive = new Map(
    b.units.filter((u) => u.faction === "player" && u.hp > 0).map((u) => [u.src, u.hp]),
  );
  g.lost += g.reserve.filter((u) => !alive.has(u.id)).length;
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

// Whoever is worst off, which is the same one a wisp would go for
export const mendable = (g: GameState) => {
  if (!held(g) || !perks(g).mend) return null;
  const u = g.reserve.filter((o) => o.hp < o.maxHp).sort((a, z) => hpFrac(a) - hpFrac(z))[0];
  return u && g.mana >= manaCost(g, u.creature) ? u : null;
};

// The one place a body goes back up instead of only down, and it is paid for out
// of the same pool that would have raised a new one
export function mend(g: GameState): boolean {
  const b = held(g);
  const u = mendable(g);
  if (!b || !u) return false;
  g.mana -= manaCost(g, u.creature);
  const back = Math.min(u.maxHp - u.hp, perks(g).mend);
  u.hp += back;
  const shown = b.units.find((o) => o.src === u.id);
  if (shown) shown.hp = u.hp;
  b.mend.push({ id: shown?.id ?? -1, by: -1, n: back });
  log(g, `${CREATURES[u.creature].short} mended. +${back}`.slice(0, 20));
  return true;
}

// One body, bought. The free ones a room gives up are luck; this is the choice.
export function reap(g: GameState, unitId: number): boolean {
  const b = held(g);
  if (!b) return false;
  const u = b.units.find((o) => o.id === unitId);
  if (!u || !offered(g, b).includes(u)) return false;
  const cost = manaCost(g, u.creature);
  if (g.mana < cost) {
    log(g, "Not enough of you.");
    return false;
  }
  if (!raise(g, u.creature)) {
    log(g, "No room for it.");
    return false;
  }
  g.mana -= cost;
  b.taken.push(u.id);
  g.risen = { creatures: [u.creature], units: [u.id], node: b.node, at: g.time };
  log(g, `${CREATURES[u.creature].short} rises.`.slice(0, 20));
  return true;
}

// Whether unmaking this one is allowed at all. Never the last of them: an army
// of nobody is a dead run, and that is not a button.
export const canSell = (g: GameState, unitId: number) =>
  held(g) !== null && g.reserve.length > 1 && g.reserve.some((u) => u.id === unitId);

// A body given back to the pool it came out of. It always pays the same, and it
// always pays less than the cheapest thing there is - so this is a slot you
// wanted and a body you would rather have, never a way to make mana.
export function sell(g: GameState, unitId: number): boolean {
  if (!canSell(g, unitId)) return false;
  const i = g.reserve.findIndex((u) => u.id === unitId);
  const [gone] = g.reserve.splice(i, 1);
  g.mana = Math.min(manaCap(g), g.mana + TUNING.sellMana);
  const b = held(g)!;
  const shown = b.units.find((o) => o.src === gone.id);
  if (shown) shown.hp = 0;
  log(g, `${CREATURES[gone.creature].short} unmade.`.slice(0, 20));
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

// Gold falls out of anything. Keys are only ever hidden, or held by the last
// thing standing. Neither buys anything yet.
function loot(n: MapNode): Record<Resource, number> {
  const rolls = n.kind === "boss" ? 6 : n.kind === "cache" ? 4 : n.kind === "elite" ? 3 : 2;
  return { gold: rolls, keys: n.kind === "cache" || n.kind === "boss" ? 1 : 0 };
}

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
    if (u.rooms <= TUNING.vetCap) u.maxHp += P.vetHp;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + P.vetHp + Math.ceil(u.maxHp * rest));
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
  const xp = fallen.reduce((s, u) => s + CREATURES[u.creature].xp, 0);
  gainXp(g, xp);

  const res = loot(n);
  for (const k of RES_IDS) g.res[k] += res[k];
  const spoils = RES_IDS.filter((k) => res[k] > 0).map((k) => `${RESOURCES[k].glyph}${res[k]}`);
  log(g, `+${xp}xp ${spoils.join(" ")}`.slice(0, 20));

  // Only a little of it gets up on its own. The rest has to be asked for, one
  // at a time, and paid for.
  const rose: CreatureId[] = [];
  const bodies: number[] = [];
  for (const u of fallen) {
    if (u.creature === "ossuary") continue;
    // A crypt gives up all of it, and so does an open grave
    const free = n.kind === "crypt" || P.glut > 0;
    if (!free && rnd() >= TUNING.raiseChance + P.riseLuck / 100) continue;
    if (!raise(g, u.creature)) break;
    b.taken.push(u.id);
    rose.push(u.creature);
    bodies.push(u.id);
  }
  if (rose.length) {
    g.risen = { creatures: rose, units: bodies, node: n.id, at: g.time };
    log(g, `${rose.map((c) => CREATURES[c].short).join(", ")} rises.`.slice(0, 20));
  }
}

function readLore(g: GameState, n: MapNode) {
  if (n.lore === null || g.seenLore.includes(n.lore)) return;
  g.seenLore.push(n.lore);
  g.loreQueue.push(n.lore);
}

// ---------------------------------------------------------------- lifecycle

// Three different things out of the early pool. Different, so no roll ever
// hands out a band with nothing in it that can kill.
export const rollBand = (more = 0): CreatureId[] =>
  shuffle(START_POOL).slice(0, Math.min(START_POOL.length, START_BAND + more));

export function newGame(seedValue: number): GameState {
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
    taken: [rootId],
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
  // What the board is worth at the gate: the band it opens with and the hands
  // it will be dealt. Everything else the board gives is spent as it goes.
  const P = perks(g);
  g.rerolls = P.rerolls;
  for (const c of rollBand(P.startBand)) raise(g, c);
  log(g, "Into the dark.");
  g.rng = rngState();
  return g;
}

const KEY = "gravelight.save";
// Bump whenever GameState changes shape. A save from an older shape is thrown
// away rather than half-read: a missing field crashes the first frame.
const SAVE_VERSION = 10;
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
