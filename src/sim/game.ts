import { pick, rnd, rngState, seed as seedRng, setRngState, shuffle } from "./rng.ts";
import { LORE } from "./lore.ts";
import {
  CREATURES,
  EARLY_POOL,
  KIND_ROLL,
  LATE_POOL,
  RESOURCES,
  RES_IDS,
  TUNING,
  type AbilityId,
  type Battle,
  type BattleUnit,
  type CreatureId,
  type Force,
  type GameState,
  type MapNode,
  type NodeKind,
  type Resource,
  type Stat,
  type Unit,
} from "./data.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export const heroForce = (g: GameState) => g.forces[0];
export const heroUnit = (g: GameState) => g.forces[0].units.find((u) => u.creature === "hero");
export const reserve = (g: GameState) => g.reserve;
export const squads = (g: GameState) =>
  g.forces.filter((f) => f.kind === "squad" && f.mode !== "gone");
export const forcesAt = (g: GameState, id: number) =>
  g.forces.filter((f) => f.mode !== "gone" && f.at === id);
export const commandCap = (g: GameState) => TUNING.baseCap + g.build.will * TUNING.willPerPoint;

// Everything he is holding up, wherever it is standing. A squad is still his
// until it is dead, so it still costs him a slot.
export const fielded = (g: GameState) =>
  g.reserve.length + squads(g).reduce((n, f) => n + f.units.length, 0);
export const heroDmg = (g: GameState) => TUNING.heroDmg + g.build.might * TUNING.mightPerPoint;
export const xpNeeded = (g: GameState) => TUNING.xpPerLevel * (g.level + 1);
export const hpFrac = (u: { hp: number; maxHp: number }) => clamp(u.hp / u.maxHp, 0, 1);

// Everyone who walks in with him: whatever he has not sent away. The reserve is
// his retinue when he fights and the pool a squad is drawn from when he does
// not - it cannot be both at once, which is why nothing detaches mid-room.
// The line he walks in with, in the order they stand. He is not pinned to the
// front of it: put a knight there instead and the knight is what gets hit.
export const bandOf = (g: GameState, f: Force): Unit[] => {
  if (f.kind !== "hero") return f.units;
  const at = clamp(g.front, 0, g.reserve.length);
  return [...g.reserve.slice(0, at), ...f.units, ...g.reserve.slice(at)];
};

// Move whoever stands at `k` one place up the line
export function moveUp(g: GameState, k: number) {
  const at = clamp(g.front, 0, g.reserve.length);
  if (k <= 0 || k > g.reserve.length) return;
  if (k === at) {
    g.front = at - 1;
    return;
  }
  if (k === at + 1) {
    g.front = at + 1;
    return;
  }
  const i = k < at ? k : k - 1;
  [g.reserve[i - 1], g.reserve[i]] = [g.reserve[i], g.reserve[i - 1]];
}

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
  if (kind === "boss") return ["ossuary", "warden", "knight"];
  // Rooms near the gate are small enough that a scouting pair has a real chance;
  // the deep ones are not
  const grow = tier >= 2 ? 1 : 0;
  const base = TUNING.roomBase;
  const n = kind === "elite" ? base + 1 + grow : kind === "crypt" ? base - 1 + grow : base + grow;
  const pool = tier < 2 ? EARLY_POOL : LATE_POOL;
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
  g.nodes[id.get(gate)!].state = "cleared";
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

// Nearest room still worth taking. A squad picks its own next fight, but it
// will not walk into the boss on its own.
export function nearestOpen(g: GameState, from: number): number | null {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const id of g.nodes[cur].links) {
      const n = g.nodes[id];
      if (n.state === "open" && n.kind !== "boss") return id;
      if (n.state === "cleared" && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
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
    return sum + t.hp + n.tier * TUNING.tierHp + t.dmg * 6;
  }, 0);

export const threatOf = (n: MapNode): 0 | 1 | 2 => {
  const p = powerOf(n);
  return p < TUNING.threatMild ? 0 : p < TUNING.threatBad ? 1 : 2;
};

// ---------------------------------------------------------------- army

// Raised bodies wait with the necromancer. They are not part of his fight -
// he goes in alone - they are what a squad is made out of.
export function raise(g: GameState, creature: CreatureId): boolean {
  if (fielded(g) >= commandCap(g)) return false;
  const t = CREATURES[creature];
  g.reserve.push({ id: g.nextUnit++, creature, hp: t.hp, maxHp: t.hp });
  return true;
}

export function gainXp(g: GameState, n: number) {
  g.xp += n;
  while (g.xp >= xpNeeded(g)) {
    g.xp -= xpNeeded(g);
    g.level += 1;
    g.unspent += 1;
  }
}

export function chooseStat(g: GameState, s: Stat) {
  if (g.unspent <= 0) return;
  g.unspent -= 1;
  g.build[s] += 1;
  const h = heroUnit(g);
  if (s === "ward" && h) {
    h.maxHp += TUNING.wardPerPoint;
    h.hp += TUNING.wardPerPoint;
  }
}

// ---------------------------------------------------------------- abilities

type Hooks = {
  bonus?: (self: BattleUnit, target: BattleUnit, b: Battle) => number;
  taken?: (self: BattleUnit, amount: number, b: Battle) => number;
  onAttack?: (self: BattleUnit, target: BattleUnit, b: Battle) => void;
  onDeath?: (self: BattleUnit, b: Battle) => void;
};

const living = (b: Battle, f: BattleUnit["faction"]) =>
  b.units.filter((u) => u.faction === f && u.hp > 0);

export const ABILITIES: Record<AbilityId, Hooks> = {
  swarm: {
    bonus: (s, _t, b) =>
      Math.min(TUNING.swarmCap, (living(b, s.faction).length - 1) * TUNING.swarmPerAlly),
  },
  bulwark: { taken: (_s, n) => Math.max(1, Math.ceil(n * TUNING.bulwarkCut)) },
  wither: {
    onAttack: (_s, t) => {
      t.withered = TUNING.witherTurns;
    },
  },
  siphon: {
    onAttack: (s, _t, b) => {
      const hurt = living(b, s.faction)
        .filter((u) => u.hp < u.maxHp)
        .sort((a, z) => a.hp / a.maxHp - z.hp / z.maxHp)[0];
      if (hurt) hurt.hp = Math.min(hurt.maxHp, hurt.hp + TUNING.siphonHeal);
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
    onDeath: (s, b) => {
      if (s.tier >= TUNING.splitTiers) return;
      for (let i = 0; i < 2; i++) {
        b.units.push({
          id: b.nextId++,
          src: -1,
          creature: s.creature,
          faction: s.faction,
          hp: Math.ceil(s.maxHp / 2),
          maxHp: Math.ceil(s.maxHp / 2),
          dmg: Math.max(1, Math.floor(s.dmg * 0.6)),
          speed: CREATURES[s.creature].speed,
          slot: s.slot,
          tier: s.tier + 1,
          withered: 0,
        });
      }
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
}

function strike(b: Battle, a: BattleUnit, d: BattleUnit) {
  let raw = a.dmg + (hooks(a).bonus?.(a, d, b) ?? 0);
  if (a.withered > 0) raw *= TUNING.witherCut;
  const soaked = hooks(d).taken?.(d, raw, b) ?? raw;
  damage(b, d, Math.max(1, Math.round(soaked)), a.id);
  // Fires even on a killing blow, or a wisp would be punished for aiming well
  hooks(a).onAttack?.(a, d, b);
}

// Whoever is standing at the head of the other line. Order is the tactic here:
// what you put first is what gets hit, and ids run front to back.
function frontOf(b: Battle, side: BattleUnit["faction"]): BattleUnit | undefined {
  return living(b, side).sort((a, z) => a.slot - z.slot || a.id - z.id)[0];
}

// A side's own queue, fastest first and front of the line to break a tie
export function orderFor(b: Battle, side: BattleUnit["faction"]): number[] {
  return living(b, side)
    .sort((a, z) => z.speed - a.speed || a.slot - z.slot || a.id - z.id)
    .map((u) => u.id);
}

// The two lines take it in turns, one blow each, and each line cycles through
// its own people. Bringing six against three means each of the six swings half
// as often - the numbers buy you a deeper bench, not more blows.
export function takeTurn(b: Battle) {
  if (b.done) return;
  b.hit = [];
  const side = b.next;
  const list = orderFor(b, side);
  if (list.length) {
    const i = b.cursor[side] % list.length;
    const u = b.units.find((o) => o.id === list[i]);
    b.cursor[side] = i + 1 >= list.length ? 0 : i + 1;
    if (b.cursor[side] === 0 && side === b.lead) b.round += 1;
    const foe = u ? frontOf(b, side === "player" ? "enemy" : "player") : undefined;
    if (u && foe) {
      strike(b, u, foe);
      if (u.withered > 0) u.withered -= 1;
    }
  }
  b.next = side === "player" ? "enemy" : "player";

  if (!living(b, "enemy").length) b.done = "win";
  else if (!living(b, "player").length) b.done = "loss";
  // A fight that will not end is a fight you lost slowly
  else if (b.round >= TUNING.maxRounds) b.done = "loss";
}

export function fight(b: Battle) {
  let guard = TUNING.maxRounds * (b.units.length + 4) + 16;
  while (!b.done && guard-- > 0) takeTurn(b);
}

function makeBattle(g: GameState, f: Force): Battle {
  const n = g.nodes[f.at];
  const b: Battle = {
    node: f.at,
    units: [],
    hit: [],
    lead: "player",
    next: "player",
    cursor: { player: 0, enemy: 0 },
    round: 0,
    log: [],
    done: "",
    healed: 0,
    nextId: 0,
  };

  bandOf(g, f).forEach((u, slot) => {
    const t = CREATURES[u.creature];
    b.units.push({
      id: b.nextId++,
      src: u.id,
      slot,
      creature: u.creature,
      faction: "player",
      hp: u.hp,
      maxHp: u.maxHp,
      dmg: u.creature === "hero" ? heroDmg(g) : t.dmg,
      speed: t.speed,
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
      hp: t.hp + n.tier * TUNING.tierHp,
      maxHp: t.hp + n.tier * TUNING.tierHp,
      dmg: t.dmg + (n.tier >= TUNING.tierDmgAt ? 1 : 0),
      speed: t.speed,
      slot,
      tier: 0,
      withered: 0,
    });
  });
  b.lead = rnd() < 0.5 ? "player" : "enemy";
  b.next = b.lead;
  blog(b, f.kind === "hero" ? "You step in." : "They go in.");
  blog(b, b.lead === "player" ? "You swing first." : "They swing first.");
  return b;
}

// ---------------------------------------------------------------- orders

export const canOrder = (g: GameState, id: number) =>
  !g.over && heroForce(g).mode !== "fight" && routeTo(g, heroForce(g).at, id) !== null;

export const canSend = (g: GameState, id: number) =>
  !g.over &&
  heroForce(g).mode !== "fight" &&
  g.reserve.length > 0 &&
  g.nodes[id]?.state === "open" &&
  routeTo(g, heroForce(g).at, id) !== null;

export function orderHero(g: GameState, id: number): boolean {
  const f = heroForce(g);
  if (!canOrder(g, id)) return false;
  const path = routeTo(g, f.at, id);
  if (!path || !path.length) return false;
  f.path = path;
  f.mode = "march";
  f.next = g.time + TUNING.marchTicks;
  return true;
}

// Cut loose from the retinue and gone for good. It fights where you point it,
// then finds its own next room, and it does not come back.
export function sendSquad(g: GameState, id: number, unitIds: number[]): boolean {
  const hero = heroForce(g);
  if (!canSend(g, id)) return false;
  // The order you picked them in is the order they stand in
  const picked = unitIds
    .map((id) => g.reserve.find((u) => u.id === id))
    .filter((u): u is Unit => u !== undefined);
  if (!picked.length) return false;
  const path = routeTo(g, hero.at, id);
  if (!path || !path.length) return false;

  g.reserve = g.reserve.filter((u) => !picked.includes(u));
  g.forces.push({
    id: g.nextForce++,
    kind: "squad",
    units: picked,
    at: hero.at,
    path,
    mode: "march",
    next: g.time + TUNING.marchTicks,
    battle: null,
    rooms: 0,
  });
  log(g, `${picked.length} sent out.`);
  return true;
}

// ---------------------------------------------------------------- the clock

export function advance(g: GameState, ticks: number) {
  for (let i = 0; i < ticks && !g.over; i++) step(g);
}

function step(g: GameState) {
  g.time += 1;
  if (g.time > TUNING.reinforceAfter && g.time % TUNING.reinforceEvery === 0) reinforce(g);
  // A copy, because a squad can be cut loose or wiped while the list is walked
  for (const f of [...g.forces]) {
    if (g.over) return;
    if (f.mode === "gone" || g.time < f.next) continue;
    if (f.mode === "march") march(g, f);
    else if (f.mode === "fight") fightTurn(g, f);
    else if (f.mode === "spoils") finish(g, f);
    else if (f.mode === "idle" && f.kind === "squad") retarget(g, f);
  }
  g.rng = rngState();
}

// A room you leave standing does not stay the size you found it. This is the
// only clock pressure there is - after a grace period, because losing the first
// room you walk into to something that moved in behind you is not pressure.
function reinforce(g: GameState) {
  const idle = g.nodes.filter(
    (n) => n.state === "open" && n.kind !== "boss" && n.foes.length < TUNING.foeCap,
  );
  if (!idle.length) return;
  const n = pick(idle);
  n.foes.push(pick(n.tier < 2 ? EARLY_POOL : LATE_POOL));
  log(g, "Something moves in.");
}

function march(g: GameState, f: Force) {
  const next = f.path.shift();
  if (next === undefined) return arrive(g, f);
  f.at = next;
  if (!f.path.length) return arrive(g, f);
  f.next = g.time + TUNING.marchTicks;
}

function arrive(g: GameState, f: Force) {
  if (g.nodes[f.at].state === "open") {
    f.battle = makeBattle(g, f);
    f.mode = "fight";
    f.next = g.time + TUNING.turnTicks;
    return;
  }
  f.mode = "idle";
  f.next = g.time + TUNING.idlePoll;
  if (f.kind === "squad") retarget(g, f);
  else readLore(g, g.nodes[f.at]);
}

function retarget(g: GameState, f: Force) {
  f.mode = "idle";
  f.next = g.time + TUNING.idlePoll;
  const target = nearestOpen(g, f.at);
  if (target === null) return;
  const path = routeTo(g, f.at, target);
  if (!path || !path.length) return;
  f.path = path;
  f.mode = "march";
  f.next = g.time + TUNING.marchTicks;
}

function fightTurn(g: GameState, f: Force) {
  const b = f.battle!;
  takeTurn(b);
  f.next = g.time + TUNING.turnTicks;
  if (b.done) settle(g, f, b);
}

function settle(g: GameState, f: Force, b: Battle) {
  // Survivors keep their wounds; the fallen do not come back
  const alive = new Map(
    b.units.filter((u) => u.faction === "player" && u.hp > 0).map((u) => [u.src, u.hp]),
  );
  g.lost += bandOf(g, f).filter((u) => !alive.has(u.id)).length;
  f.units = f.units.filter((u) => alive.has(u.id));
  if (f.kind === "hero") g.reserve = g.reserve.filter((u) => alive.has(u.id));
  for (const u of bandOf(g, f)) u.hp = alive.get(u.id)!;

  // The board stays up for a beat afterwards. That beat is where the dead get
  // up, which is the one thing in this game worth stopping to watch.
  f.mode = "spoils";
  f.next = g.time + TUNING.spoilsTicks;

  if (b.done === "loss") {
    if (f.kind === "hero") {
      g.over = "dead";
      log(g, "The dark has you.");
    } else {
      f.units = [];
      log(g, "A squad is lost.");
    }
    return;
  }

  const n = g.nodes[b.node];
  clearRoom(g, f, b, n);
  f.rooms += 1;
  if (n.kind === "boss") {
    g.over = "won";
    log(g, "It is finished.");
    return;
  }
  if (f.kind !== "hero") return;

  const h = heroUnit(g);
  if (!h) {
    g.over = "dead";
    log(g, "The dark has you.");
    return;
  }
  // A room he takes gives him a little back. Nothing he raised gets anything:
  // what a body has left is what it got up with, and it only goes down.
  const before = h.hp;
  h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp * TUNING.restFrac));
  b.healed = h.hp - before;
  const shown = b.units.find((u) => u.src === h.id);
  if (shown) shown.hp = h.hp;
}

// The beat is over: put the board away and get on with it
function finish(g: GameState, f: Force) {
  const b = f.battle;
  f.battle = null;
  if (!b || b.done === "loss" || (f.kind === "squad" && !f.units.length)) {
    if (f.kind === "squad") {
      f.mode = "gone";
      if (b && b.done !== "loss") log(g, "A squad is spent.");
    }
    return;
  }
  if (f.kind === "squad") {
    retarget(g, f);
    return;
  }
  f.mode = "idle";
  f.next = g.time + TUNING.idlePoll;
  readLore(g, g.nodes[b.node]);
}

function loot(n: MapNode): Record<Resource, number> {
  const out: Record<Resource, number> = { bone: 0, ash: 0, salt: 0 };
  const rolls = n.kind === "boss" ? 6 : n.kind === "cache" ? 4 : n.kind === "elite" ? 3 : 2;
  for (let i = 0; i < rolls; i++) out[pick(RES_IDS)] += 1;
  return out;
}

// Everything a won room pays, whoever won it. There is no sheet to stop and
// read in a game that keeps running, so it all goes to the log.
function clearRoom(g: GameState, f: Force, b: Battle, n: MapNode) {
  n.state = "cleared";
  g.cleared += 1;
  unlock(g);

  // Split spawns are not corpses anybody left behind, so they pay nothing
  const fallen = b.units.filter((u) => u.faction === "enemy" && u.hp <= 0 && u.tier === 0);
  const raw = fallen.reduce((s, u) => s + CREATURES[u.creature].xp, 0);
  const xp = f.kind === "squad" ? Math.max(1, Math.round(raw * TUNING.squadXpCut)) : raw;
  gainXp(g, xp);

  const res = loot(n);
  for (const k of RES_IDS) g.res[k] += res[k];
  const spoils = RES_IDS.filter((k) => res[k] > 0).map((k) => `${RESOURCES[k].glyph}${res[k]}`);
  log(g, `+${xp}xp ${spoils.join(" ")}`.slice(0, 20));

  // Only what he is standing over gets up. A squad wins the room and leaves
  // the dead where they lie, which is why a squad is spent and not invested.
  if (f.kind !== "hero") return;
  const rose: CreatureId[] = [];
  const bodies: number[] = [];
  for (const u of fallen) {
    if (u.creature === "ossuary") continue;
    if (n.kind !== "crypt" && rnd() >= TUNING.raiseChance) continue;
    if (!raise(g, u.creature)) break;
    rose.push(u.creature);
    bodies.push(u.id);
  }
  if (rose.length) {
    g.risen = { creatures: rose, units: bodies, node: n.id, at: g.time };
    log(g, `${rose.map((c) => CREATURES[c].short).join(", ")} rises.`.slice(0, 20));
  }
}

// The story is his to read, not theirs to report. A room a squad took keeps its
// piece until he walks through it himself.
function readLore(g: GameState, n: MapNode) {
  if (n.lore === null || g.seenLore.includes(n.lore)) return;
  g.seenLore.push(n.lore);
  g.loreQueue.push(n.lore);
}

// ---------------------------------------------------------------- lifecycle

export function newGame(seedValue: number): GameState {
  seedRng(seedValue);
  const g: GameState = {
    seed: seedValue,
    rng: rngState(),
    time: 0,
    nodes: [],
    forces: [],
    reserve: [],
    front: 0,
    nextForce: 1,
    nextUnit: 1,
    xp: 0,
    level: 0,
    unspent: 0,
    build: { might: 0, ward: 0, will: 0 },
    res: { bone: 0, ash: 0, salt: 0 },
    risen: null,
    seenLore: [],
    loreQueue: [],
    cleared: 0,
    lost: 0,
    log: [],
    over: "",
  };
  buildMap(g);

  const gate = g.nodes.find((n) => n.kind === "gate")!;
  g.forces.push({
    id: 0,
    kind: "hero",
    units: [{ id: 0, creature: "hero", hp: TUNING.heroHp, maxHp: TUNING.heroHp }],
    at: gate.id,
    path: [],
    mode: "idle",
    next: 0,
    battle: null,
    rooms: 0,
  });
  for (let i = 0; i < TUNING.startingMinions; i++) raise(g, "rat");
  log(g, "Into the dark.");
  g.rng = rngState();
  return g;
}

const KEY = "gravelight.save";
// Bump whenever GameState changes shape. A save from an older shape is thrown
// away rather than half-read: a missing field crashes the first frame.
const SAVE_VERSION = 5;
// Checked as well as the version, because the likely mistake is adding a field
// and forgetting to bump
const REQUIRED: (keyof GameState)[] = [
  "seed", "rng", "time", "nodes", "forces", "reserve", "front", "nextForce", "nextUnit", "xp",
  "level", "unspent", "build", "res", "risen", "seenLore", "loreQueue", "cleared",
  "lost", "log", "over",
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
