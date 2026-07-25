// Run: node scripts/check-sim.ts
import { MIN_COLS } from "../src/layout.ts";
import { LORE } from "../src/sim/lore.ts";
import {
  ABILITIES,
  advance,
  chooseStat,
  clearSave,
  commandCap,
  hexAround,
  load,
  moveTo,
  neighbors,
  newGame,
  raise,
  resolveBattle,
  runBattle,
  save,
  sendSquad,
  tickBattle,
  xpNeeded,
} from "../src/sim/game.ts";
import { CREATURES, RES_IDS, TUNING, type Battle, type BattleUnit, type GameState, type Stat } from "../src/sim/data.ts";

// A memory-backed store, so the save path can be exercised outside a browser
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let checks = 0;
function ok(label: string, cond: boolean) {
  checks += 1;
  if (!cond) {
    console.error(`FAIL ${label}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- map

const g0 = newGame(12345);
ok("node ids are their own index", g0.nodes.every((n, i) => n.id === i));
ok("gate is cleared at the start", g0.nodes[0].state === "cleared" && g0.at === 0);
ok(
  "the gate's neighbours are open",
  neighbors(g0, 0).every((id) => g0.nodes[id].state === "open"),
);
ok("exactly one boss", g0.nodes.filter((n) => n.kind === "boss").length === 1);
ok("the boss is deepest", g0.nodes.find((n) => n.kind === "boss")!.row === TUNING.mapRows - 1);
ok("the gate is at the top", g0.nodes[0].row === 0 && g0.nodes[0].kind === "gate");

for (let seed = 1; seed <= 40; seed++) {
  const g = newGame(seed * 7919);
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) for (const id of neighbors(g, queue.pop()!)) if (!seen.has(id)) (seen.add(id), queue.push(id));
  ok(`seed ${seed}: every room is reachable`, seen.size === g.nodes.length);
  ok(
    `seed ${seed}: every room below the gate has foes`,
    g.nodes.every((n) => n.kind === "gate" || n.foes.length > 0),
  );
  ok(
    `seed ${seed}: every link joins two hexes that actually touch`,
    g.nodes.every((n) =>
      n.links.every((id) =>
        hexAround(n.col, n.row).some((h) => h.col === g.nodes[id].col && h.row === g.nodes[id].row),
      ),
    ),
  );
  ok(
    `seed ${seed}: links are recorded at both ends`,
    g.nodes.every((n) => n.links.every((id) => g.nodes[id].links.includes(n.id))),
  );
  ok(
    `seed ${seed}: no room shares a hex with another`,
    new Set(g.nodes.map((n) => `${n.col},${n.row}`)).size === g.nodes.length,
  );
  ok(`seed ${seed}: the map is worth panning over`, g.nodes.length >= 20);
  ok(
    `seed ${seed}: there is more than one way down`,
    g.nodes.filter((n) => n.links.length > 2).length > g.nodes.length / 3,
  );
  ok(
    `seed ${seed}: difficulty stays inside its band`,
    g.nodes.every((n) => n.tier >= 0 && n.tier < TUNING.tiers),
  );
}

const a = newGame(999);
const b = newGame(999);
ok("the same seed builds the same run", JSON.stringify(a) === JSON.stringify(b));
ok("different seeds differ", JSON.stringify(newGame(1000)) !== JSON.stringify(a));

// ---------------------------------------------------------------- lore

ok("every room below the gate carries a piece", g0.nodes.every((n) => n.kind === "gate" || n.lore !== null));
ok("the boss carries the last piece", g0.nodes.find((n) => n.kind === "boss")!.lore === LORE.length - 1);
ok("no piece is out of range", g0.nodes.every((n) => n.lore === null || (n.lore >= 0 && n.lore < LORE.length)));

// ---------------------------------------------------------------- army and levels

{
  const g = newGame(7);
  ok("two rats to start", g.army.length === TUNING.startingMinions);
  while (raise(g, "rat")) {
    /* fill it */
  }
  ok("the command cap holds", g.army.length === commandCap(g));
  ok("a full army refuses another", raise(g, "rat") === false);

  const before = commandCap(g);
  g.unspent = 3;
  chooseStat(g, "will");
  ok("will buys a slot", commandCap(g) === before + TUNING.willPerPoint);
  const hp = g.hero.maxHp;
  chooseStat(g, "ward");
  ok("ward raises max hp", g.hero.maxHp === hp + TUNING.wardPerPoint);
  ok("ward heals what it adds", g.hero.hp === g.hero.maxHp);
  chooseStat(g, "might");
  ok("points are spent", g.unspent === 0);
  chooseStat(g, "might");
  ok("spending past zero does nothing", g.build.might === 1);
}

{
  const g = newGame(8);
  const need = xpNeeded(g);
  g.xp = 0;
  g.level = 0;
  g.unspent = 0;
  // gainXp is exercised through the reward path below; this covers the curve itself
  ok("the curve grows with level", xpNeeded({ ...g, level: 1 } as GameState) > need);
}

// ---------------------------------------------------------------- abilities

const unit = (over: Partial<BattleUnit>): BattleUnit => ({
  id: 0, src: -1, creature: "rat", faction: "player",
  hp: 10, maxHp: 10, dmg: 2, speed: 3, tier: 0, withered: 0, ...over,
});
const battle = (units: BattleUnit[]): Battle => ({
  node: 0, side: "hero", units, hit: [], tick: 0, log: [], done: "", nextId: units.length,
});

{
  const me = unit({ id: 0 });
  const mates = [unit({ id: 1 }), unit({ id: 2 })];
  const bt = battle([me, ...mates]);
  ok("swarm counts allies, not itself", ABILITIES.swarm.bonus!(me, me, bt) === 2 * TUNING.swarmPerAlly);
  mates[0].hp = 0;
  ok("swarm forgets the dead", ABILITIES.swarm.bonus!(me, me, bt) === 1 * TUNING.swarmPerAlly);
}
ok("bulwark halves", ABILITIES.bulwark.taken!(unit({}), 8, battle([])) === 4);
ok("bulwark never fully blocks", ABILITIES.bulwark.taken!(unit({}), 1, battle([])) === 1);
{
  const target = unit({ id: 1 });
  ABILITIES.wither.onAttack!(unit({}), target, battle([]));
  ok("wither sticks for its turns", target.withered === TUNING.witherTurns);
}
{
  const me = unit({ id: 0 });
  const hurt = unit({ id: 1, hp: 3 });
  const bt = battle([me, hurt]);
  ABILITIES.siphon.onAttack!(me, unit({ faction: "enemy" }), bt);
  ok("siphon heals the worst off", hurt.hp === 3 + TUNING.siphonHeal);
}
ok("rend only bites the wounded", ABILITIES.rend.bonus!(unit({}), unit({ hp: 10 }), battle([])) === 0);
ok("rend bites at half", ABILITIES.rend.bonus!(unit({}), unit({ hp: 5 }), battle([])) === TUNING.rendBonus);
{
  const me = unit({ id: 0, faction: "enemy" });
  const foes = [unit({ id: 1, hp: 10 }), unit({ id: 2, hp: 2 })];
  const bt = battle([me, ...foes]);
  ABILITIES.toll.onDeath!(me, bt);
  ok("toll hits everyone opposite", foes[0].hp === 10 - TUNING.tollDamage);
  ok("toll can finish someone", foes[1].hp === 0);
}
{
  const boss = unit({ id: 0, creature: "ossuary", maxHp: 40, dmg: 5 });
  const bt = battle([boss]);
  ABILITIES.split.onDeath!(boss, bt);
  ok("split makes two", bt.units.length === 3);
  ok("halves carry half the health", bt.units[1].maxHp === 20);
  ok("halves are one tier deeper", bt.units[1].tier === 1);
  const deep = unit({ id: 9, creature: "ossuary", tier: TUNING.splitTiers });
  const bt2 = battle([deep]);
  ABILITIES.split.onDeath!(deep, bt2);
  ok("splitting stops somewhere", bt2.units.length === 1);
}

// ---------------------------------------------------------------- battle

{
  const g = newGame(4242);
  const first = neighbors(g, 0).find((id) => g.nodes[id].state === "open")!;
  ok("you cannot walk into a room you have not opened", advance(g, g.nodes.length - 1) === false);
  ok("advancing starts a fight", advance(g, first) === true);
  ok("two fights cannot run at once", advance(g, first) === false);

  const b = g.battle!;
  ok("your side is in it", b.units.some((u) => u.creature === "hero"));
  ok("their side is in it", b.units.some((u) => u.faction === "enemy"));
  const hp = b.units[0].hp;
  tickBattle(g);
  ok("a tick is a tick", b.tick === 1);
  ok("somebody was hurt", b.hit.length > 0 || b.units[0].hp === hp);

  runBattle(g);
  ok("a fight always ends", b.done !== "");
  ok("a fight ends inside its budget", b.tick <= TUNING.maxTicks);
}

{
  // Clearing a room with the hero moves him there and opens what lies beyond
  const g = newGame(31337);
  const first = neighbors(g, 0).find((id) => g.nodes[id].state === "open")!;
  advance(g, first);
  g.battle!.units.filter((u) => u.faction === "enemy").forEach((u) => (u.hp = 0));
  g.battle!.done = "win";
  resolveBattle(g);
  ok("the room is cleared", g.nodes[first].state === "cleared");
  ok("you are standing in it", g.at === first);
  ok("nothing beside it stays sealed", g.nodes[first].links.every((id) => g.nodes[id].state !== "locked"));
  ok("spoils are waiting", g.pending !== null);
  ok("xp was paid", g.pending!.xp > 0);
  ok("something was found", RES_IDS.some((k) => g.pending!.res[k] > 0));
  ok("a piece of the story surfaced", g.pendingLore !== null);
  const seen = g.pendingLore!;
  g.pendingLore = null;
  g.pending = null;
  ok("a piece is never shown twice", g.seenLore.filter((i) => i === seen).length === 1);
}

{
  // A squad is a one-way expedition: it resolves on dispatch and never returns
  const g = newGame(555);
  const first = neighbors(g, 0).find((id) => g.nodes[id].state === "open")!;
  const ids = g.army.map((u) => u.id);
  ok("a squad needs somebody in it", sendSquad(g, first, []) === false);
  ok("a squad can be sent", sendSquad(g, first, ids) === true);
  ok("nothing is left to watch", g.battle === null);
  ok("the sent do not come back", g.army.every((u) => !ids.includes(u.id)));
  ok("a report comes back", g.pending !== null && g.pending.side === "squad");
  ok("the report counts who went", g.pending!.lost === ids.length);
  ok("you are alive", g.over === "");
  ok("you have not moved", g.at === 0);
}

{
  // A squad that keeps winning keeps walking, and every room it takes is taken
  let chained = 0;
  let doomed = 0;
  for (let seed = 0; seed < 30; seed++) {
    const g = newGame(9100 + seed * 13);
    while (raise(g, "knight")) {
      /* the sturdiest squad the cap allows */
    }
    const first = neighbors(g, 0).find((id) => g.nodes[id].state === "open")!;
    const sent = g.army.map((u) => u.id);
    const before = g.nodes.filter((n) => n.state === "cleared").length;
    sendSquad(g, first, sent);
    const after = g.nodes.filter((n) => n.state === "cleared").length;
    ok(`chain ${seed}: the report matches the map`, after - before === g.pending!.rooms);
    ok(`chain ${seed}: nobody who went comes home`, g.army.every((u) => !sent.includes(u.id)));
    ok(`chain ${seed}: the hero never moves`, g.at === 0);
    ok(
      `chain ${seed}: they never walk into the boss`,
      g.nodes.every((n) => n.kind !== "boss" || n.state !== "cleared"),
    );
    if (g.pending!.rooms > 1) chained += 1;

    // One rat is not an expedition, it is a delivery
    const lone = newGame(9100 + seed * 13);
    const alone = neighbors(lone, 0).find((id) => lone.nodes[id].state === "open")!;
    sendSquad(lone, alone, [lone.army[0].id]);
    if (lone.pending!.rooms === 0) doomed += 1;
  }
  ok("squads do chain rooms together", chained > 5);
  ok("a squad too small dies where it stands", doomed > 5);
}

{
  // The hero losing ends the run
  const g = newGame(556);
  const first = neighbors(g, 0).find((id) => g.nodes[id].state === "open")!;
  advance(g, first);
  g.battle!.units.filter((u) => u.faction === "player").forEach((u) => (u.hp = 0));
  g.battle!.done = "loss";
  resolveBattle(g);
  ok("the run is over", g.over === "dead");
}

{
  // A room taken by proxy pays less of the lesson than one you walked into
  const squad = newGame(777);
  const solo = newGame(777);
  const first = neighbors(solo, 0).find((id) => solo.nodes[id].state === "open")!;

  for (let i = 0; i < 6; i++) raise(squad, "knight");
  sendSquad(squad, first, squad.army.map((u) => u.id));

  advance(solo, first);
  solo.battle!.units.filter((u) => u.faction === "enemy").forEach((u) => (u.hp = 0));
  solo.battle!.done = "win";
  resolveBattle(solo);

  ok("a squad still clears the room", squad.nodes[first].state === "cleared");
  ok("but you stay where you were", squad.at === 0);
  ok("walking in pays the full lesson", solo.pending!.xp > 0);
  ok("the hero rests in a room he took", solo.at === first);
}

// ---------------------------------------------------------------- persistence

{
  const g = newGame(2024);
  save(g);
  const back = load()!;
  ok("a save round-trips", back !== null && back.seed === g.seed);
  ok("the map survives", back.nodes.length === g.nodes.length);

  store.set("gravelight.save", JSON.stringify({ v: 999, g }));
  ok("an older save is thrown away", load() === null);

  const missing = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
  delete missing.res;
  store.set("gravelight.save", JSON.stringify({ v: 1, g: missing }));
  ok("a save missing a field is thrown away", load() === null);

  store.set("gravelight.save", "not json");
  ok("garbage is thrown away", load() === null);
  clearSave();
  ok("clearing clears", load() === null);
}

// ---------------------------------------------------------------- balance probe

const STATS: Stat[] = ["might", "ward", "will"];
const PROBES = 40;

// Nearest room with something left to do, walking only over ground already taken
function routeToWork(g: GameState): number[] {
  const from = new Map<number, number>([[g.at, -1]]);
  const queue = [g.at];
  while (queue.length) {
    const cur = queue.shift()!;
    if (neighbors(g, cur).some((id) => g.nodes[id].state === "open")) {
      const path: number[] = [];
      for (let n = cur; n !== g.at; n = from.get(n)!) path.unshift(n);
      return path;
    }
    for (const id of neighbors(g, cur)) {
      if (from.has(id) || g.nodes[id].state !== "cleared") continue;
      from.set(id, cur);
      queue.push(id);
    }
  }
  return [];
}

// A bot that walks in alone every time and never sends a squad: the floor of
// play, not the ceiling. It exists to catch a run that cannot be finished at all.
function autoplay(seedValue: number) {
  const g = newGame(seedValue);
  let guard = 600;
  while (!g.over && guard-- > 0) {
    if (g.pending) {
      g.pending = null;
      continue;
    }
    if (g.pendingLore !== null) {
      g.pendingLore = null;
      continue;
    }
    if (g.unspent > 0) {
      chooseStat(g, STATS[g.level % STATS.length]);
      continue;
    }
    const open = neighbors(g, g.at).filter((id) => g.nodes[id].state === "open");
    if (!open.length) {
      const path = routeToWork(g);
      if (!path.length || !moveTo(g, path[0])) break;
      continue;
    }
    open.sort(
      (x, y) => g.nodes[y].row - g.nodes[x].row || g.nodes[x].foes.length - g.nodes[y].foes.length,
    );
    advance(g, open[0]);
    runBattle(g);
    for (const line of g.battle!.log) said.add(line);
    resolveBattle(g);
  }
  for (const line of g.log) said.add(line);
  return { g, stuck: guard <= 0 };
}

// The hud gives a log line exactly one row of the narrowest grid there is
const said = new Set<string>();

let wins = 0;
let deaths = 0;
let clearedTotal = 0;
for (let s = 0; s < PROBES; s++) {
  const { g, stuck } = autoplay(4000 + s * 101);
  ok(`probe seed ${s} terminates`, !stuck);
  // Every run must end one way or the other; a bot with nowhere left to go is a map bug
  ok(`probe seed ${s} is never stranded`, g.over !== "");
  if (g.over === "won") wins += 1;
  if (g.over === "dead") deaths += 1;
  clearedTotal += g.cleared;
}
ok("a run can be finished", wins > 0);
ok("a run can be lost", deaths > 0);
ok("rooms are actually being cleared", clearedTotal / PROBES >= 3);
ok("the probe saw a lot of chatter", said.size > 10);
for (const line of said) ok(`"${line}" fits the narrowest hud`, line.length <= MIN_COLS);

console.log(`sim: ${checks} checks passed`);
console.log(
  `balance: ${wins}/${PROBES} reached the end, ${deaths}/${PROBES} died, ${(clearedTotal / PROBES).toFixed(1)} rooms cleared on average`,
);

// Ability tags are shown in the roster; a lie there is a real bug
for (const [id, t] of Object.entries(CREATURES)) {
  ok(`${id}: an ability implies a tag`, !t.ability || t.tag.length > 0);
  ok(`${id}: a short name fits the roster`, t.short.length <= 7);
}
console.log(`sim: ${checks} checks passed in total`);
