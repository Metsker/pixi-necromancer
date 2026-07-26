// Run: node scripts/check-sim.ts
import { MIN_COLS } from "../src/layout.ts";
import { LORE } from "../src/sim/lore.ts";
import {
  ABILITIES,
  advance,
  bandOf,
  canOrder,
  canSend,
  heroForce,
  chooseStat,
  clearSave,
  commandCap,
  heroUnit,
  load,
  moveUp,
  nearestOpen,
  newGame,
  orderHero,
  raise,
  reserve,
  routeTo,
  takeTurn,
  save,
  sendSquad,
  squads,
  xpNeeded,
} from "../src/sim/game.ts";
import {
  CREATURES,
  TUNING,
  type Battle,
  type BattleUnit,
  type GameState,
  type MapNode,
  type Stat,
} from "../src/sim/data.ts";

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

const openRooms = (g: GameState) => g.nodes.filter((n) => n.state === "open");

// ---------------------------------------------------------------- map

const g0 = newGame(12345);
ok("node ids are their own index", g0.nodes.every((n, i) => n.id === i));
ok("the grid has holes in it", g0.nodes.length < TUNING.mapCols * TUNING.mapRows);
ok("but most of it is rooms", g0.nodes.length > TUNING.mapCols * TUNING.mapRows * 0.5);
ok("the gate is where you start", g0.nodes[g0.forces[0].at].kind === "gate");
ok("exactly one boss", g0.nodes.filter((n) => n.kind === "boss").length === 1);

for (let seed = 1; seed <= 30; seed++) {
  const g = newGame(seed * 7919);
  ok(
    `seed ${seed}: links are orthogonal only`,
    g.nodes.every((n) =>
      n.links.every(
        (id) => Math.abs(g.nodes[id].col - n.col) + Math.abs(g.nodes[id].row - n.row) === 1,
      ),
    ),
  );
  ok(
    `seed ${seed}: links are recorded at both ends`,
    g.nodes.every((n) => n.links.every((id) => g.nodes[id].links.includes(n.id))),
  );
  ok(`seed ${seed}: no room is walled off`, g.nodes.every((n) => n.links.length > 0));
  // A hole may never cut anything off, whatever else it does to the shape
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) for (const id of g.nodes[queue.pop()!].links) if (!seen.has(id)) (seen.add(id), queue.push(id));
  ok(`seed ${seed}: the whole map is reachable`, seen.size === g.nodes.length);
  ok(
    `seed ${seed}: rooms sit where their coordinates say`,
    new Set(g.nodes.map((n) => `${n.col},${n.row}`)).size === g.nodes.length,
  );
  ok(`seed ${seed}: the map is worth panning over`, g.nodes.length > 40);
  ok(
    `seed ${seed}: every room below the gate has foes`,
    g.nodes.every((n) => n.kind === "gate" || n.foes.length > 0),
  );
  ok(
    `seed ${seed}: difficulty stays inside its band`,
    g.nodes.every((n) => n.tier >= 0 && n.tier < TUNING.tiers),
  );
  ok(`seed ${seed}: there is always a way on`, openRooms(g).length >= 1);
  // You start in the middle and it gets worse the further out you go
  const gate = g.nodes.find((n) => n.kind === "gate")!;
  const boss = g.nodes.find((n) => n.kind === "boss")!;
  const away = (n: typeof gate) => Math.abs(n.col - gate.col) + Math.abs(n.row - gate.row);
  ok(
    `seed ${seed}: the gate is near the middle`,
    Math.abs(gate.col - (TUNING.mapCols >> 1)) <= 1 && Math.abs(gate.row - (TUNING.mapRows >> 1)) <= 1,
  );
  ok(`seed ${seed}: the boss is as far out as it gets`, g.nodes.every((n) => away(n) <= away(boss)));
  ok(`seed ${seed}: the boss is the hardest room`, boss.tier === TUNING.tiers - 1);
  ok(
    `seed ${seed}: it is gentler near the gate than at the edge`,
    g.nodes.filter((n) => away(n) <= 2 && n.kind !== "gate").every((n) => n.tier < TUNING.tiers - 1),
  );
}

const a = newGame(999);
ok("the same seed builds the same run", JSON.stringify(a) === JSON.stringify(newGame(999)));
ok("different seeds differ", JSON.stringify(newGame(1000)) !== JSON.stringify(a));

{
  // Nothing moves in until you have had a chance to get going
  const g = newGame(1717);
  const before = g.nodes.map((n) => n.foes.length).join();
  advance(g, TUNING.reinforceAfter);
  ok("the map holds still at the start", g.nodes.map((n) => n.foes.length).join() === before);
  advance(g, TUNING.reinforceEvery * 3);
  ok("and then it starts filling in", g.nodes.map((n) => n.foes.length).join() !== before);
  ok(
    "but never past the cap",
    g.nodes.every((n) => n.foes.length <= Math.max(TUNING.foeCap, n.kind === "boss" ? 3 : 0)),
  );
}

// ---------------------------------------------------------------- routing

{
  const g = newGame(4321);
  const start = g.forces[0].at;
  ok("a route to where you stand is empty", routeTo(g, start, start)!.length === 0);
  const near = openRooms(g)[0];
  ok("a route into an open room is one step", routeTo(g, start, near.id)!.length === 1);
  const far = g.nodes.find((n) => n.state === "locked" && n.row > 3)!;
  ok("there is no route into a sealed room", routeTo(g, start, far.id) === null);
  ok("nearest open finds something", nearestOpen(g, start) !== null);
  ok("the boss is never what a squad picks", g.nodes[nearestOpen(g, start)!].kind !== "boss");
}

// ---------------------------------------------------------------- lore

ok(
  "every room below the gate carries a piece",
  g0.nodes.every((n) => n.kind === "gate" || n.lore !== null),
);
ok("the boss carries the last piece", g0.nodes.find((n) => n.kind === "boss")!.lore === LORE.length - 1);

// ---------------------------------------------------------------- army and levels

{
  const g = newGame(7);
  ok("two rats to start", reserve(g).length === TUNING.startingMinions);
  while (raise(g, "rat")) {
    /* fill it */
  }
  ok("the command cap holds", reserve(g).length === commandCap(g));
  ok("a full reserve refuses another", raise(g, "rat") === false);

  const before = commandCap(g);
  g.unspent = 3;
  chooseStat(g, "will");
  ok("will buys a slot", commandCap(g) === before + TUNING.willPerPoint);
  const hp = heroUnit(g)!.maxHp;
  chooseStat(g, "ward");
  ok("ward raises max hp", heroUnit(g)!.maxHp === hp + TUNING.wardPerPoint);
  ok("ward heals what it adds", heroUnit(g)!.hp === heroUnit(g)!.maxHp);
  chooseStat(g, "might");
  ok("points are spent", g.unspent === 0);
  chooseStat(g, "might");
  ok("spending past zero does nothing", g.build.might === 1);
  ok("the curve grows with level", xpNeeded({ ...g, level: 1 } as GameState) > xpNeeded(g));
}

// ---------------------------------------------------------------- abilities

let slots = 0;
const unit = (over: Partial<BattleUnit>): BattleUnit => ({
  id: 0, src: -1, creature: "rat", faction: "player",
  hp: 10, maxHp: 10, dmg: 2, speed: 3, slot: slots++, tier: 0, withered: 0, ...over,
});
const battle = (units: BattleUnit[], lead: "player" | "enemy" = "player"): Battle => ({
  node: 0, units, hit: [], lead, next: lead, cursor: { player: 0, enemy: 0 },
  round: 0, log: [], done: "", nextId: units.length,
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
  const foes = [unit({ id: 1, hp: 40, maxHp: 40 }), unit({ id: 2, hp: 2 })];
  const bt = battle([me, ...foes]);
  ABILITIES.toll.onDeath!(me, bt);
  ok("toll hits everyone opposite", foes[0].hp === 40 - TUNING.tollDamage);
  ok("toll can finish someone", foes[1].hp === 0);
}
{
  const boss = unit({ id: 0, creature: "ossuary", maxHp: 130, dmg: 8 });
  const bt = battle([boss]);
  ABILITIES.split.onDeath!(boss, bt);
  ok("split makes two", bt.units.length === 3);
  ok("halves carry half the health", bt.units[1].maxHp === 65);
  ok("halves are one tier deeper", bt.units[1].tier === 1);
  const deep = unit({ id: 9, creature: "ossuary", tier: TUNING.splitTiers });
  const bt2 = battle([deep]);
  ABILITIES.split.onDeath!(deep, bt2);
  ok("splitting stops somewhere", bt2.units.length === 1);
}
{
  // The lines alternate: four against one does not mean four blows to one.
  // Plain heroes on both sides, so no ability muddies the arithmetic.
  const plain = (id: number, faction: "player" | "enemy") =>
    unit({ id, faction, creature: "hero", dmg: 1, hp: 200, maxHp: 200, speed: 3 });
  const many = [0, 1, 2, 3].map((i) => plain(i, "player"));
  const lone = plain(10, "enemy");
  const bt = battle([...many, lone], "player");
  for (let i = 0; i < 8; i++) takeTurn(bt);
  ok("eight turns is four blows a side", 200 - lone.hp === 4);
  ok("the outnumbered one swings just as often", 200 - many[0].hp === 4);
  ok("and only the front of the line takes them", many.slice(1).every((u) => u.hp === 200));
  ok("each of the four swings a quarter as often", bt.cursor.player === 0);
}

{
  // One unit swings a turn, and the front of the other line is what it hits
  const me = unit({ id: 0, dmg: 5 });
  const front = unit({ id: 1, faction: "enemy", hp: 40, maxHp: 40 });
  const back = unit({ id: 2, faction: "enemy", hp: 40, maxHp: 40 });
  const bt = battle([me, front, back]);
  takeTurn(bt);
  ok("a turn lands exactly one blow", bt.hit.length === 1);
  ok("and it lands on the front of the line", front.hp < 40 && back.hp === 40);
  ok("the back rank is untouched until the front falls", bt.hit[0].id === front.id);

  front.hp = 0;
  takeTurn(bt);
  takeTurn(bt);
  ok("then it moves to whoever is next", back.hp < 40);
}
{
  // The toss decides who opens, not who is fastest
  const slowUs = unit({ id: 0, speed: 3, dmg: 4 });
  const slowThem = unit({ id: 1, faction: "enemy", speed: 3, hp: 40, maxHp: 40, dmg: 4 });
  const ours = battle([{ ...slowUs }, { ...slowThem }], "player");
  takeTurn(ours);
  ok("winning the toss means you swing first", ours.units[1].hp < 40);
  const theirs = battle([{ ...slowUs }, { ...slowThem }], "enemy");
  takeTurn(theirs);
  ok("losing it means they do", theirs.units[0].hp < 10);
}

{
  // He walks off a room he takes. What he raised does not.
  const g = newGame(3939);
  raise(g, "knight");
  const target = openRooms(g)[0].id;
  orderHero(g, target);
  advance(g, TUNING.marchTicks + 1);
  const band = g.forces[0].battle!.units.filter((u) => u.faction === "player");
  const hero = band.find((u) => u.creature === "hero")!;
  const mate = band.find((u) => u.creature !== "hero")!;
  hero.hp = 40;
  mate.hp = 3;
  g.forces[0].battle!.units.filter((u) => u.faction === "enemy").forEach((u) => (u.hp = 1));
  advance(g, TUNING.turnTicks * 40);
  ok("the room fell", g.nodes[target].state === "cleared");
  ok("he walks it off", heroUnit(g)!.hp === heroUnit(g)!.maxHp);
  ok("a body keeps what it has left", reserve(g).some((u) => u.hp === 3));
}

{
  // He is not pinned to the front of his own line
  const g = newGame(4545);
  raise(g, "knight");
  const before = bandOf(g, heroForce(g)).map((u) => u.creature);
  ok("he stands at the head by default", before[0] === "hero");
  moveUp(g, 1);
  const after = bandOf(g, heroForce(g)).map((u) => u.creature);
  ok("and can be put behind something sturdier", after[0] !== "hero" && after[1] === "hero");
  ok("without losing anybody", after.length === before.length);
  moveUp(g, 0);
  ok("the head of the line cannot move up", bandOf(g, heroForce(g))[1].creature === "hero");
  moveUp(g, 1);
  ok("and he can step forward again", bandOf(g, heroForce(g))[0].creature === "hero");
}

{
  // The order you put them in is the order they stand in, and the front of the
  // line is what the other side hits
  const g = newGame(6767);
  raise(g, "knight");
  raise(g, "warden");
  const order = reserve(g).map((u) => u.creature);
  orderHero(g, openRooms(g)[0].id);
  advance(g, TUNING.marchTicks + 1);
  const line = g.forces[0].battle!.units.filter((u) => u.faction === "player");
  ok("the necromancer stands at the head of it", line[0].creature === "hero");
  ok("and the rest stand where you put them", line.slice(1).map((u) => u.creature).join() === order.join());
  ok("ids run front to back", line.every((u, i) => i === 0 || u.id > line[i - 1].id));

  const foes = g.forces[0].battle!.units.filter((u) => u.faction === "enemy");
  const front = foes[0];
  let guard = 200;
  while (front.hp === front.maxHp && guard-- > 0) advance(g, 1);
  ok("their front rank is what took the first blow", front.hp < front.maxHp);
  ok("nothing behind it was touched", foes.slice(1).every((u) => u.hp === u.maxHp));
}

// ---------------------------------------------------------------- the clock

{
  // Time only moves when it is asked to, and every force moves on the same clock
  const g = newGame(2210);
  const before = JSON.stringify(g);
  advance(g, 0);
  ok("no ticks, no change", JSON.stringify(g) === before);
  const target = openRooms(g)[0].id;
  ok("the hero can be ordered", orderHero(g, target) === true);
  ok("an order does not resolve on the spot", g.forces[0].mode === "march");
  advance(g, TUNING.marchTicks + 1);
  ok("marching takes time", g.forces[0].at === target);
  ok("arriving starts the fight", g.forces[0].mode === "fight");
  ok("a fight starts at round zero", g.forces[0].battle!.round === 0);
  advance(g, TUNING.turnTicks * (g.forces[0].battle!.units.length + 1));
  ok("turns land on the clock", g.forces[0].battle!.round >= 1);
  ok("you cannot be ordered mid-fight", canOrder(g, g.forces[0].at) === false);
  // His reserve walks in with him, so it cannot be detached out from under a fight
  const elsewhere = openRooms(g)[0].id;
  ok("nothing can be detached mid-fight", canSend(g, elsewhere) === false);
  ok("and his band went in with him", g.forces[0].battle!.units.filter((u) => u.faction === "player").length > 1);
}

{
  // Several squads run at once, on the same clock, without the hero
  const g = newGame(3311);
  while (raise(g, "knight")) {
    /* a retinue worth splitting */
  }
  const rooms = openRooms(g).map((n) => n.id);
  const troop = reserve(g).map((u) => u.id);
  ok("two rooms to aim at", rooms.length >= 2);
  ok("first squad goes", sendSquad(g, rooms[0], troop.slice(0, 2)) === true);
  ok("second squad goes", sendSquad(g, rooms[1], troop.slice(2, 4)) === true);
  ok("an order to nowhere is refused", sendSquad(g, 9999, troop) === false);
  ok("both are out there", squads(g).length === 2);
  ok("they left the reserve", reserve(g).length === troop.length - 4);
  ok("the hero stayed put", g.forces[0].mode === "idle");
  const where = g.forces[0].at;

  advance(g, 400);
  ok("the hero still has not moved", g.forces[0].at === where);
  ok(
    "both squads fought without being told twice",
    g.forces.filter((f) => f.kind === "squad").every((f) => f.rooms > 0 || f.mode === "gone"),
  );
}

{
  // Two squads at once, over enough seeds that a bad pair of rooms is not the story
  let took = 0;
  let chained = 0;
  for (let seed = 0; seed < 30; seed++) {
    const g = newGame(3000 + seed * 17);
    while (raise(g, "knight")) {
      /* nothing */
    }
    const troop = reserve(g).map((u) => u.id);
    const rooms = openRooms(g).map((n) => n.id);
    const sent = [...troop.slice(0, 2), ...troop.slice(2, 4)];
    sendSquad(g, rooms[0], troop.slice(0, 2));
    sendSquad(g, rooms[Math.min(1, rooms.length - 1)], troop.slice(2, 4));
    const where = g.forces[0].at;
    advance(g, 600);
    ok(`pair ${seed}: the hero never moved`, g.forces[0].at === where);
    ok(`pair ${seed}: nobody who went is back in the reserve`, reserve(g).every((u) => !sent.includes(u.id)));
    if (g.cleared > 0) took += 1;
    if (g.forces.some((f) => f.kind === "squad" && f.rooms > 1)) chained += 1;
  }
  // Two of them into a room is a gamble, and with the front of the line taking
  // every blow it is a worse one than it used to be
  ok("a scouting pair sometimes takes something", took > 0);
  ok("and sometimes just dies", took < 30);
  void chained;
}

{
  // A squad keeps going until there is nothing left of it, and never returns
  let chained = 0;
  for (let seed = 0; seed < 25; seed++) {
    const g = newGame(9100 + seed * 13);
    while (raise(g, "knight")) {
      /* the sturdiest squad the cap allows */
    }
    const sent = reserve(g).map((u) => u.id);
    sendSquad(g, openRooms(g)[0].id, sent);
    advance(g, 40000);
    const f = g.forces.find((o) => o.kind === "squad")!;
    // Either it dies out there or it runs out of rooms; it never comes home
    ok(
      `chain ${seed}: it ends up spent or holding`,
      f.mode === "gone" || nearestOpen(g, f.at) === null,
    );
    ok(`chain ${seed}: nobody who went comes home`, reserve(g).every((u) => !sent.includes(u.id)));
    ok(
      `chain ${seed}: the boss is not theirs to take`,
      g.nodes.every((n) => n.kind !== "boss" || n.state !== "cleared"),
    );
    if (f.rooms > 1) chained += 1;
  }
  ok("squads do chain rooms together", chained > 5);
}

{
  // A squad wins the room and leaves the dead where they lie, and reads nothing
  const g = newGame(51515);
  while (raise(g, "knight")) {
    /* nothing */
  }
  const target = openRooms(g).find((n) => n.lore !== null)!.id;
  const held = g.reserve.map((u) => u.id);
  sendSquad(g, target, held);
  const before = g.reserve.length;
  advance(g, TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16);
  ok("the squad took it", g.nodes[target].state === "cleared");
  ok("nothing got up for them", g.reserve.length === before);
  ok("and nobody told you a story", g.loreQueue.length === 0);
  ok("the room keeps its piece", g.nodes[target].lore !== null && !g.seenLore.includes(g.nodes[target].lore!));

  // ...until he walks through it himself
  orderHero(g, target);
  advance(g, TUNING.marchTicks * 6);
  ok("he walked in", g.forces[0].at === target);
  ok("and read it there", g.loreQueue.includes(g.nodes[target].lore!));
}

{
  // A room he takes himself does raise what it kills
  let rose = 0;
  for (let seed = 0; seed < 20; seed++) {
    const g = newGame(6100 + seed * 7);
    const before = g.reserve.length;
    orderHero(g, openRooms(g)[0].id);
    advance(g, TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16);
    if (g.reserve.length > before) rose += 1;
  }
  ok("standing over them is what raises them", rose > 5);
}

{
  // A room taken by proxy pays less of the lesson than one you walked into
  const budget = TUNING.marchTicks * 4 + TUNING.turnTicks * TUNING.maxRounds * 16 + 20;
  const squad = newGame(777);
  const solo = newGame(777);
  const target = openRooms(solo)[0].id;
  while (raise(squad, "knight")) {
    /* nothing */
  }
  sendSquad(squad, target, reserve(squad).map((u) => u.id));
  advance(squad, budget);
  orderHero(solo, target);
  advance(solo, budget);
  ok(
    "both rooms fell",
    squad.nodes[target].state === "cleared" && solo.nodes[target].state === "cleared",
  );
  ok("the hero rests in a room he took", solo.forces[0].at === target);
  ok("but a squad leaves you where you were", squad.forces[0].at !== target);
}

// ---------------------------------------------------------------- persistence

{
  const g = newGame(2024);
  advance(g, 50);
  save(g);
  const back = load()!;
  ok("a save round-trips", back !== null && back.seed === g.seed);
  ok("the clock survives", back.time === g.time);
  ok("the forces survive", back.forces.length === g.forces.length);

  store.set("gravelight.save", JSON.stringify({ v: 999, g }));
  ok("an older save is thrown away", load() === null);

  const missing = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
  delete missing.forces;
  store.set("gravelight.save", JSON.stringify({ v: 2, g: missing }));
  ok("a save missing a field is thrown away", load() === null);

  store.set("gravelight.save", "not json");
  ok("garbage is thrown away", load() === null);
  clearSave();
  ok("clearing clears", load() === null);
}

// ---------------------------------------------------------------- balance probe

const STATS: Stat[] = ["might", "ward", "will"];
const PROBES = 30;

// A bot that throws half its retinue ahead and walks in with the rest. The floor
// of play, not the ceiling: it never waits, never picks its fights, never times
// anything. It exists to catch a run that cannot be finished at all.
function autoplay(seedValue: number) {
  const g = newGame(seedValue);
  let guard = 8000;
  const said = new Set<string>();
  while (!g.over && guard-- > 0) {
    while (g.unspent > 0) chooseStat(g, STATS[g.level % STATS.length]);
    g.loreQueue.length = 0;

    // The main line: keep the army together and push at the Ossuary. Squads are
    // measured separately, above - they are a cost you choose, not the default.
    if (g.forces[0].mode === "idle") {
      const b = g.nodes.find((n) => n.kind === "boss")!;
      const toward = (n: MapNode) => Math.abs(n.col - b.col) + Math.abs(n.row - b.row);
      const mine = openRooms(g).sort((x, y) => toward(x) - toward(y))[0];
      if (mine) orderHero(g, mine.id);
    }
    advance(g, 20);
    for (const line of g.log) said.add(line);
  }
  return { g, stuck: guard <= 0, said };
}

let wins = 0;
let deaths = 0;
let clearedTotal = 0;
const chatter = new Set<string>();
for (let s = 0; s < PROBES; s++) {
  const { g, stuck, said } = autoplay(4000 + s * 101);
  ok(`probe seed ${s} terminates`, !stuck);
  ok(`probe seed ${s} is never stranded`, g.over !== "");
  for (const line of said) chatter.add(line);
  if (g.over === "won") wins += 1;
  if (g.over === "dead") deaths += 1;
  clearedTotal += g.cleared;
}
ok("a run can be finished", wins > 0);
ok("a run can be lost", deaths > 0);
ok("rooms are actually being cleared", clearedTotal / PROBES >= 5);
ok("the probe saw a lot of chatter", chatter.size > 10);
for (const line of chatter) ok(`"${line}" fits the narrowest hud`, line.length <= MIN_COLS);

// Ability tags are shown in the roster; a lie there is a real bug
for (const [id, t] of Object.entries(CREATURES)) {
  ok(`${id}: an ability implies a tag`, !t.ability || t.tag.length > 0);
  ok(`${id}: a short name fits the roster`, t.short.length <= 7);
}

// ---------------------------------------------------------------- a fight you can watch

{
  // A fight has to last long enough to be worth opening. Rooms by the gate are
  // short on purpose; the ones that matter are not.
  const room = (list: BattleUnit["creature"][], tier: number) =>
    list.map((c, i) => {
      const t = CREATURES[c];
      return unit({
        id: 100 + i,
        creature: c,
        faction: "enemy" as const,
        hp: t.hp + tier * TUNING.tierHp,
        maxHp: t.hp + tier * TUNING.tierHp,
        dmg: t.dmg + (tier >= TUNING.tierDmgAt ? 1 : 0),
        speed: t.speed,
      });
    });
  const hero = () =>
    unit({
      id: 0,
      creature: "hero",
      hp: TUNING.heroHp,
      maxHp: TUNING.heroHp,
      dmg: TUNING.heroDmg,
      speed: CREATURES.hero.speed,
    });

  const band = () =>
    ["rat", "knight"].map((c, i) => {
      const t = CREATURES[c as BattleUnit["creature"]];
      return unit({ id: 1 + i, creature: t === CREATURES.rat ? "rat" : "knight", hp: t.hp, maxHp: t.hp, dmg: t.dmg, speed: t.speed });
    });
  // Turns, not rounds: one unit swings a turn now, so the beat is what to count
  const turnsIn = (b: Battle) => {
    let turns = 0;
    let guard = 4000;
    while (!b.done && guard-- > 0) {
      takeTurn(b);
      turns += 1;
    }
    return turns;
  };
  const shallow = battle([hero(), ...band(), ...room(["rat", "hound", "moth"], 0)]);
  const shallowTurns = turnsIn(shallow);
  const deep = battle([hero(), ...band(), ...room(["warden", "knight", "hound", "moth"], 4)]);
  const deepTurns = turnsIn(deep);
  const secs = (turns: number) => ((turns * TUNING.turnTicks + TUNING.marchTicks) * 0.11).toFixed(1);

  ok("a room by the gate is not instant", shallowTurns >= 8);
  ok("and it is one you take at level one", shallow.done === "win");
  // Deep rooms are long whether or not you are ready for them. Walking into one
  // at level one and losing is the game telling you to go and get some levels.
  ok("a room that matters is a long fight", deepTurns >= 20);
  ok("a fight is worth opening", +secs(deepTurns) >= 5);
  console.log(
    `fights: ${shallowTurns} blows by the gate (${secs(shallowTurns)}s at x1), ` +
      `${deepTurns} deep (${secs(deepTurns)}s at x1, ${(+secs(deepTurns) / 4).toFixed(1)}s at x4)`,
  );
}

console.log(`sim: ${checks} checks passed`);
console.log(
  `balance: ${wins}/${PROBES} reached the end, ${deaths}/${PROBES} died, ${(clearedTotal / PROBES).toFixed(1)} rooms taken on average`,
);
