import { pick, randInt, rnd, rngState, seed as seedRng, setRngState } from "./rng.ts";
import { LORE } from "./lore.ts";
import {
  CREATURES,
  EARLY_POOL,
  KIND_ROLL,
  LATE_POOL,
  RES_IDS,
  TUNING,
  type AbilityId,
  type Battle,
  type BattleUnit,
  type CreatureId,
  type GameState,
  type MapNode,
  type NodeKind,
  type Resource,
  type Reward,
  type Stat,
  type Unit,
} from "./data.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export const node = (g: GameState, id: number) => g.nodes[id];
export const commandCap = (g: GameState) => TUNING.baseCap + g.build.will * TUNING.willPerPoint;
export const heroDmg = (g: GameState) => TUNING.heroDmg + g.build.might * TUNING.mightPerPoint;
export const xpNeeded = (g: GameState) => TUNING.xpPerLevel * (g.level + 1);

export function log(g: GameState, line: string) {
  g.log.push(line);
  if (g.log.length > TUNING.logLines) g.log.shift();
}

// Both directions: links are stored one way, but the map is walked both ways
export function neighbors(g: GameState, id: number): number[] {
  const out = [...g.nodes[id].links];
  for (const n of g.nodes) if (n.links.includes(id) && !out.includes(n.id)) out.push(n.id);
  return out;
}

// ---------------------------------------------------------------- map

function rollFoes(kind: NodeKind, tier: number): CreatureId[] {
  if (kind === "boss") return ["ossuary", "warden"];
  const n = kind === "elite" ? randInt(3, 4) : kind === "crypt" ? randInt(1, 2) : randInt(2, 3);
  const pool = tier < 2 ? EARLY_POOL : LATE_POOL;
  return Array.from({ length: n }, () => pick(pool));
}

const connect = (g: GameState, a: number, b: number) => {
  if (!g.nodes[a].links.includes(b)) g.nodes[a].links.push(b);
};

// Proportional pairing, so edges fan out instead of knotting in the middle
const slot = (i: number, from: number, to: number) =>
  to <= 1 ? 0 : Math.min(to - 1, Math.round((i * (to - 1)) / Math.max(1, from - 1)));

function link(g: GameState, top: number[], bottom: number[]) {
  for (let i = 0; i < top.length; i++) connect(g, top[i], bottom[slot(i, top.length, bottom.length)]);
  // Nothing below may be unreachable, whichever way the proportional pass fell
  for (let j = 0; j < bottom.length; j++) {
    if (top.some((t) => g.nodes[t].links.includes(bottom[j]))) continue;
    connect(g, top[slot(j, bottom.length, top.length)], bottom[j]);
  }
  if (top.length > 1 && bottom.length > 1 && rnd() < TUNING.crossEdgeChance) {
    connect(g, pick(top), pick(bottom));
  }
}

function buildMap(g: GameState) {
  const layers: number[][] = [];
  for (let l = 0; l < TUNING.layers; l++) {
    const last = l === TUNING.layers - 1;
    const count = l === 0 || last ? 1 : randInt(TUNING.minPerLayer, TUNING.maxPerLayer);
    const row: number[] = [];
    for (let s = 0; s < count; s++) {
      const kind: NodeKind = l === 0 ? "gate" : last ? "boss" : pick(KIND_ROLL);
      const tier = Math.max(0, l - 1) + (kind === "elite" ? 1 : 0);
      g.nodes.push({
        id: g.nodes.length,
        layer: l,
        slot: s,
        of: count,
        kind,
        tier,
        foes: kind === "gate" ? [] : rollFoes(kind, tier),
        links: [],
        state: "locked",
        lore: null,
      });
      row.push(g.nodes.length - 1);
    }
    layers.push(row);
  }
  for (let l = 0; l < layers.length - 1; l++) link(g, layers[l], layers[l + 1]);
  assignLore(g);
  g.nodes[0].state = "cleared";
  unlock(g);
}

// Spread the pieces down the map; the last one always waits at the boss
function assignLore(g: GameState) {
  const path = g.nodes.filter((n) => n.kind !== "gate");
  const last = LORE.length - 1;
  path.forEach((n, i) => {
    n.lore = n.kind === "boss" ? last : Math.floor((i * last) / Math.max(1, path.length - 1));
  });
}

function unlock(g: GameState) {
  for (const n of g.nodes) {
    if (n.state !== "cleared") continue;
    for (const id of neighbors(g, n.id)) {
      if (g.nodes[id].state === "locked") g.nodes[id].state = "open";
    }
  }
}

// ---------------------------------------------------------------- army

export function raise(g: GameState, creature: CreatureId): boolean {
  if (g.army.length >= commandCap(g)) return false;
  const t = CREATURES[creature];
  g.army.push({ id: g.nextId++, creature, hp: t.hp, maxHp: t.hp });
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
  if (s === "ward") {
    g.hero.maxHp += TUNING.wardPerPoint;
    g.hero.hp += TUNING.wardPerPoint;
  }
}

// ---------------------------------------------------------------- abilities

type Hooks = {
  bonus?: (self: BattleUnit, target: BattleUnit, b: Battle) => number;
  taken?: (self: BattleUnit, amount: number, b: Battle) => number;
  onAttack?: (self: BattleUnit, target: BattleUnit, b: Battle) => void;
  onDeath?: (self: BattleUnit, b: Battle) => void;
};

const living = (b: Battle, f: BattleUnit["faction"]) => b.units.filter((u) => u.faction === f && u.hp > 0);

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
        damage(b, o, TUNING.tollDamage);
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

function damage(b: Battle, u: BattleUnit, amount: number) {
  if (u.hp <= 0) return;
  u.hp = Math.max(0, u.hp - amount);
  b.hit.push(u.id);
  if (u.hp > 0) return;
  blog(b, `${CREATURES[u.creature].short} falls.`);
  hooks(u).onDeath?.(u, b);
}

function strike(b: Battle, a: BattleUnit, d: BattleUnit) {
  let raw = a.dmg + (hooks(a).bonus?.(a, d, b) ?? 0);
  if (a.withered > 0) raw *= TUNING.witherCut;
  const soaked = hooks(d).taken?.(d, raw, b) ?? raw;
  damage(b, d, Math.max(1, Math.round(soaked)));
  // Fires even on a killing blow, or a wisp would be punished for aiming well
  hooks(a).onAttack?.(a, d, b);
}

// Your side is commanded and focuses the nearest thing to dead; theirs is not
// commanded by anybody and swings at whatever is in front of it
function targetFor(b: Battle, u: BattleUnit): BattleUnit | undefined {
  const foes = living(b, u.faction === "player" ? "enemy" : "player");
  if (!foes.length) return undefined;
  if (u.faction === "enemy") return foes[Math.floor(rnd() * foes.length)];
  return foes.sort((a, z) => a.hp - z.hp || a.id - z.id)[0];
}

export function tickBattle(g: GameState) {
  const b = g.battle;
  if (!b || b.done) return;
  b.hit = [];
  const order = [...b.units].sort((a, z) => z.speed - a.speed || a.id - z.id);
  for (const u of order) {
    if (u.hp <= 0) continue;
    const foe = targetFor(b, u);
    if (!foe) break;
    strike(b, u, foe);
    if (u.withered > 0) u.withered -= 1;
  }
  b.tick += 1;
  if (!living(b, "enemy").length) b.done = "win";
  else if (!living(b, "player").length) b.done = "loss";
  // A fight that will not end is a fight you lost slowly
  else if (b.tick >= TUNING.maxTicks) b.done = "loss";
  g.rng = rngState();
}

export function runBattle(g: GameState) {
  let guard = TUNING.maxTicks + 2;
  while (g.battle && !g.battle.done && guard-- > 0) tickBattle(g);
}

function makeBattle(
  g: GameState,
  target: number,
  side: "hero" | "squad",
  unitIds: number[],
): Battle {
  const n = g.nodes[target];
  const b: Battle = { node: target, side, units: [], hit: [], tick: 0, log: [], done: "", nextId: 0 };

  if (side === "hero") {
    b.units.push({
      id: b.nextId++,
      src: 0,
      creature: "hero",
      faction: "player",
      hp: g.hero.hp,
      maxHp: g.hero.maxHp,
      dmg: heroDmg(g),
      speed: CREATURES.hero.speed,
      tier: 0,
      withered: 0,
    });
  }
  for (const id of unitIds) {
    const u = g.army.find((a) => a.id === id);
    if (!u) continue;
    const t = CREATURES[u.creature];
    b.units.push({
      id: b.nextId++,
      src: u.id,
      creature: u.creature,
      faction: "player",
      hp: u.hp,
      maxHp: u.maxHp,
      dmg: t.dmg,
      speed: t.speed,
      tier: 0,
      withered: 0,
    });
  }
  for (const c of n.foes) {
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
      tier: 0,
      withered: 0,
    });
  }
  blog(b, side === "hero" ? "You step in." : "They go in alone.");
  return b;
}

export const canMove = (g: GameState, id: number) =>
  !g.battle && !g.over && neighbors(g, g.at).includes(id) && g.nodes[id].state === "cleared";

export const canAdvance = (g: GameState, id: number) =>
  !g.battle && !g.over && neighbors(g, g.at).includes(id) && g.nodes[id].state === "open";

export const canSend = (g: GameState, id: number) =>
  !g.battle && !g.over && g.nodes[id].state === "open" && g.army.length > 0;

export function moveTo(g: GameState, id: number): boolean {
  if (!canMove(g, id)) return false;
  g.at = id;
  g.rng = rngState();
  return true;
}

export function advance(g: GameState, id: number): boolean {
  if (!canAdvance(g, id)) return false;
  g.battle = makeBattle(g, id, "hero", g.army.map((u) => u.id));
  g.rng = rngState();
  return true;
}

export function sendSquad(g: GameState, id: number, unitIds: number[]): boolean {
  if (!canSend(g, id) || !unitIds.length) return false;
  g.battle = makeBattle(g, id, "squad", unitIds);
  g.rng = rngState();
  return true;
}

// ---------------------------------------------------------------- rewards

function loot(n: MapNode): Record<Resource, number> {
  const out: Record<Resource, number> = { bone: 0, ash: 0, salt: 0 };
  const rolls = n.kind === "boss" ? 6 : n.kind === "cache" ? 4 : n.kind === "elite" ? 3 : 2;
  for (let i = 0; i < rolls; i++) out[pick(RES_IDS)] += 1;
  return out;
}

function grantRewards(g: GameState, b: Battle, n: MapNode): Reward {
  // Split spawns are not corpses anybody left behind, so they pay nothing
  const fallen = b.units.filter((u) => u.faction === "enemy" && u.hp <= 0 && u.tier === 0);
  const raw = fallen.reduce((s, u) => s + CREATURES[u.creature].xp, 0);
  const xp = b.side === "squad" ? Math.max(1, Math.round(raw * TUNING.squadXpCut)) : raw;
  gainXp(g, xp);

  const res = loot(n);
  for (const k of RES_IDS) g.res[k] += res[k];

  const raised: CreatureId[] = [];
  for (const u of fallen) {
    if (u.creature === "ossuary") continue;
    if (n.kind !== "crypt" && rnd() >= TUNING.raiseChance) continue;
    if (!raise(g, u.creature)) break;
    raised.push(u.creature);
  }

  const lore = n.lore !== null && !g.seenLore.includes(n.lore) ? n.lore : null;
  if (lore !== null) {
    g.seenLore.push(lore);
    g.pendingLore = lore;
  }
  const lost = b.units.filter((u) => u.faction === "player" && u.src > 0 && u.hp <= 0).length;
  return { xp, res, raised, side: b.side, lost };
}

export function resolveBattle(g: GameState) {
  const b = g.battle;
  if (!b || !b.done) return;
  const n = g.nodes[b.node];
  const won = b.done === "win";

  // Survivors keep their wounds; the fallen do not come back
  for (const u of b.units) {
    if (u.faction !== "player") continue;
    if (u.src === 0) {
      g.hero.hp = u.hp;
      continue;
    }
    if (u.src < 0) continue;
    if (u.hp <= 0) g.army = g.army.filter((a) => a.id !== u.src);
    else {
      const m = g.army.find((a) => a.id === u.src);
      if (m) m.hp = u.hp;
    }
  }

  g.battle = null;
  if (!won) {
    if (b.side === "hero") {
      g.over = "dead";
      log(g, "The dark has you.");
    } else {
      log(g, "The squad is lost.");
    }
    g.rng = rngState();
    return;
  }

  n.state = "cleared";
  g.cleared += 1;
  // A room you took yourself is a room you can rest in
  if (b.side === "hero") {
    g.at = n.id;
    g.hero.hp = Math.min(g.hero.maxHp, g.hero.hp + TUNING.restHeal);
    for (const m of g.army) m.hp = Math.min(m.maxHp, m.hp + TUNING.minionHeal);
  }
  unlock(g);
  g.pending = grantRewards(g, b, n);
  log(g, n.kind === "boss" ? "It is finished." : "The room is quiet.");
  if (n.kind === "boss") g.over = "won";
  g.rng = rngState();
}

// ---------------------------------------------------------------- lifecycle

export function newGame(seedValue: number): GameState {
  seedRng(seedValue);
  const g: GameState = {
    seed: seedValue,
    rng: rngState(),
    nodes: [],
    at: 0,
    hero: { id: 0, creature: "hero", hp: TUNING.heroHp, maxHp: TUNING.heroHp },
    army: [],
    nextId: 1,
    xp: 0,
    level: 0,
    unspent: 0,
    build: { might: 0, ward: 0, will: 0 },
    res: { bone: 0, ash: 0, salt: 0 },
    battle: null,
    pending: null,
    pendingLore: null,
    seenLore: [],
    cleared: 0,
    log: [],
    over: "",
  };
  buildMap(g);
  for (let i = 0; i < TUNING.startingMinions; i++) raise(g, "rat");
  log(g, "Into the dark.");
  g.rng = rngState();
  return g;
}

const KEY = "gravelight.save";
// Bump whenever GameState changes shape. A save from an older shape is thrown
// away rather than half-read: a missing field crashes the first frame.
const SAVE_VERSION = 1;
// Checked as well as the version, because the likely mistake is adding a field
// and forgetting to bump
const REQUIRED: (keyof GameState)[] = [
  "seed", "rng", "nodes", "at", "hero", "army", "nextId", "xp", "level",
  "unspent", "build", "res", "battle", "pending", "pendingLore", "seenLore",
  "cleared", "log", "over",
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

export const armyOf = (g: GameState, ids: number[]): Unit[] =>
  g.army.filter((u) => ids.includes(u.id));

export const hpFrac = (u: { hp: number; maxHp: number }) => clamp(u.hp / u.maxHp, 0, 1);
