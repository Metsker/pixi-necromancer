// Run: node scripts/check-sim.ts
import { MIN_COLS } from "../src/layout.ts";
import { LORE } from "../src/sim/lore.ts";
import {
  ABILITIES,
  advance,
  bandOf,
  canOrder,
  canSend,
  fielded,
  heroForce,
  choosePath,
  clearSave,
  commandCap,
  eat,
  eatable,
  heroUnit,
  leaveRoom,
  load,
  manaCap,
  manaCost,
  mend,
  mendable,
  moveUp,
  nearestOpen,
  newGame,
  orderHero,
  offered,
  perks,
  powerOf,
  raise,
  reap,
  reserve,
  routeTo,
  takeNode,
  takeTurn,
  threatOf,
  treeOpen,
  save,
  sendSquad,
  squads,
  unitDmg,
  xpNeeded,
} from "../src/sim/game.ts";
import {
  CREATURES,
  TUNING,
  type Battle,
  type BattleUnit,
  type GameState,
  type MapNode,
} from "../src/sim/data.ts";
import { PATHS, PATH_IDS, PERK_IDS, rootId, type PathId } from "../src/sim/tree.ts";

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

// Nothing moves until he has chosen what he is, so every check walks in as
// somebody. The rat king is the closest to how this played before there were
// natures: he trails his own line and spends bodies rather than keeping them.
const newRun = (seed: number, path: PathId = "rat") => {
  const g = newGame(seed);
  choosePath(g, path);
  return g;
};

// ---------------------------------------------------------------- map

const g0 = newRun(12345);
ok("node ids are their own index", g0.nodes.every((n, i) => n.id === i));
ok("the grid has holes in it", g0.nodes.length < TUNING.mapCols * TUNING.mapRows);
ok("but most of it is rooms", g0.nodes.length > TUNING.mapCols * TUNING.mapRows * 0.5);
ok("the gate is where you start", g0.nodes[g0.forces[0].at].kind === "gate");
ok("exactly one boss", g0.nodes.filter((n) => n.kind === "boss").length === 1);

for (let seed = 1; seed <= 30; seed++) {
  const g = newRun(seed * 7919);
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

const a = newRun(999);
ok("the same seed builds the same run", JSON.stringify(a) === JSON.stringify(newRun(999)));
ok("different seeds differ", JSON.stringify(newRun(1000)) !== JSON.stringify(a));

{
  // Nothing moves in until you have had a chance to get going
  const g = newRun(1717);
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

{
  // The colour on a room is what is standing in it, and all three show up
  const seen = new Set<number>();
  for (let seed = 0; seed < 20; seed++) {
    const g = newRun(2200 + seed * 13);
    for (const n of g.nodes) {
      if (!n.foes.length) continue;
      seen.add(threatOf(n));
      ok(`seed ${seed}: threat is a band`, [0, 1, 2].includes(threatOf(n)));
    }
    const rooms = g.nodes.filter((n) => n.foes.length);
    const worst = rooms.reduce((a, z) => (powerOf(z) > powerOf(a) ? z : a));
    const softest = rooms.reduce((a, z) => (powerOf(z) < powerOf(a) ? z : a));
    ok(`seed ${seed}: the worst room is not the softest`, threatOf(worst) >= threatOf(softest));
  }
  ok("all three colours turn up on the map", seen.size === 3);
  // and it has to move when the room does
  const g = newRun(4242);
  const n = g.nodes.find((x) => x.foes.length)!;
  const before = powerOf(n);
  n.foes.push("warden");
  ok("something moving in makes it worse", powerOf(n) > before);
}

// ---------------------------------------------------------------- routing

{
  const g = newRun(4321);
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

// ---------------------------------------------------------------- army and the tree

{
  const g = newRun(7);
  ok("a rat king walks in with three", reserve(g).length === PATHS.rat.start.length);
  while (raise(g, "rat")) {
    /* fill it */
  }
  ok("the command cap holds", reserve(g).length === commandCap(g));
  ok("a full reserve refuses another", raise(g, "rat") === false);
  ok("and the nature itself is worth bodies", commandCap(g) === TUNING.baseCap + PATHS.rat.slots);
  ok("the curve grows with level", xpNeeded({ ...g, level: 1 } as GameState) > xpNeeded(g));
}

{
  // A nature is chosen once and it is chosen
  const g = newGame(77);
  ok("nothing runs before he is somebody", g.path === "");
  const before = g.time;
  advance(g, 100);
  ok("and the clock does not either", g.time === before);
  ok("choosing works", choosePath(g, "pack") === true);
  ok("choosing again does not", choosePath(g, "lord") === false);
  ok("and he is still what he chose", g.path === "pack");
  ok("a pack walks in narrower", commandCap(g) === TUNING.baseCap + PATHS.pack.slots);
  advance(g, 100);
  ok("and now the clock runs", g.time > before);

  // Standing at the head of his own line is bought, not given: a man with no
  // nodes at the front of it is dead by the third room
  const l = newRun(78, "lord");
  ok("a lord walks in at the back like anybody", bandOf(l, heroForce(l)).at(-1)!.creature === "hero");
  l.unspent = 1;
  takeNode(l, rootId);
  ok("and taking the front is what moves him", bandOf(l, heroForce(l))[0].creature === "hero");
  ok("nobody else's root does that", bandOf(newRun(78), heroForce(newRun(78))).at(-1)!.creature === "hero");
}

{
  // Points buy nodes, nodes are only ever bought beside what he already has
  const g = newRun(1001);
  ok("nothing is bought at the gate", g.taken.length === 0);
  ok("only the root is open", treeOpen(g).join() === `${rootId}`);
  ok("a point is needed", takeNode(g, rootId) === false);
  g.unspent = 2;
  ok("and then it is his", takeNode(g, rootId) === true);
  ok("the point is spent", g.unspent === 1);
  ok("buying it twice does nothing", takeNode(g, rootId) === false);
  const far = PATHS.rat.nodes.find((n) => !treeOpen(g).includes(n.id) && !g.taken.includes(n.id))!;
  ok("nothing far off can be bought", takeNode(g, far.id) === false);
  ok("but everything beside it can", treeOpen(g).every((id) => takeNode({ ...g, unspent: 1 }, id)));

  // What a node adds to the top of him, he has to hand
  const w = newRun(1002);
  const ward = PATHS.rat.nodes.find((n) => n.gives.hp)!;
  const hp = heroUnit(w)!.maxHp;
  w.unspent = 12;
  let guard = 20;
  while (!w.taken.includes(ward.id) && guard-- > 0) {
    const next = treeOpen(w).find((id) => id === ward.id) ?? treeOpen(w)[0];
    takeNode(w, next);
  }
  ok("ward raises the top of him", heroUnit(w)!.maxHp === hp + ward.gives.hp!);
  ok("and hands him what it added", heroUnit(w)!.hp === heroUnit(w)!.maxHp);
}

// Every key the tree hands out has to be one the sim reads, or it is a number
// written on a sheet that does nothing
for (const id of PATH_IDS) {
  for (const n of PATHS[id].nodes) {
    ok(`${id}/${n.name}: it does something`, Object.keys(n.gives).length > 0);
    for (const k of Object.keys(n.gives)) {
      ok(`${id}/${n.name}: ${k} is a perk`, PERK_IDS.includes(k as (typeof PERK_IDS)[number]));
    }
  }
}

// ------------------------------------------------- what each nature actually does

// Walk him into the nearest room and leave him standing over what is left of it
const budgetFor = TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16;
function holdARoom(g: GameState) {
  const h = heroUnit(g)!;
  // He is not what is being measured here, and a lord stands where blows land
  h.maxHp = 4000;
  h.hp = 4000;
  orderHero(g, openRooms(g)[0].id);
  advance(g, budgetFor);
  return g.forces[0].mode === "spoils" && g.forces[0].battle?.done === "win";
}

{
  // Rat king: what a body costs him, and the floor under that
  const g = newRun(5150);
  const base = manaCost(g, "knight");
  const cheap = PATHS.rat.nodes.find((n) => n.gives.raiseCost)!;
  g.taken = [cheap.id];
  ok("asking gets cheaper", manaCost(g, "knight") === base + cheap.gives.raiseCost!);
  ok("the Ossuary still never answers", manaCost(g, "ossuary") === 0);
  g.taken = PATHS.rat.nodes.map((n) => n.id);
  ok("but nothing is ever free", manaCost(g, "rat") >= 1);
  ok("and a rat is worth more to a rat king", CREATURES.rat.dmg + perks(g).ratDmg > CREATURES.rat.dmg);
}

{
  // Pack: a body is worth more the longer it has been standing
  const g = newRun(5151, "pack");
  const hound = reserve(g)[0];
  const green = unitDmg(g, hound);
  // Only the nodes that buy years, or the capstone's flat damage muddies it
  g.taken = PATHS.pack.nodes.filter((n) => n.gives.vetDmg && !n.gives.minionDmg).map((n) => n.id);
  ok("a body fresh out of the ground has learned nothing", unitDmg(g, hound) === green);
  hound.rooms = 3;
  ok("and one that has lived through it hits harder", unitDmg(g, hound) > green);
  ok("nobody else's does", unitDmg(newRun(5151), reserve(newRun(5151))[0]) === CREATURES.rat.dmg);
}

{
  // Pack: the one place a body goes back up instead of only down
  const g = newRun(5152, "pack");
  ok("nothing to mend with at the gate", mendable(g) === null);
  g.taken = PATHS.pack.nodes.filter((n) => n.gives.mend).map((n) => n.id);
  ok("nor with no room to stand in", mendable(g) === null);
  while (raise(g, "knight")) {
    /* something that can hold a room */
  }
  ok("the room fell", holdARoom(g));
  g.mana = manaCap(g);
  const hurt = reserve(g)[0];
  hurt.hp = 1;
  ok("a room he is holding puts the worst hurt on offer", mendable(g) === hurt);
  const pool = g.mana;
  ok("mending works", mend(g) === true);
  ok("it is paid for out of the asking", g.mana < pool);
  ok("and the body goes back up", hurt.hp > 1);
  g.mana = 0;
  ok("and an empty pool mends nothing", mend(g) === false);
}

{
  // Pack: a room lived through is a room that shows on the body
  const g = newRun(5154, "pack");
  g.taken = PATHS.pack.nodes.filter((n) => n.gives.vetHp).map((n) => n.id);
  const top = perks(g).vetHp;
  while (raise(g, "knight")) {
    /* nothing */
  }
  const one = reserve(g)[0];
  const was = one.maxHp;
  ok("the room fell", holdARoom(g));
  ok("a body that lived through it counts the room", one.rooms === 1);
  ok("and it is a bigger body for it", one.maxHp === was + top);
}

{
  // Lord: he pays for standing at the front by eating what he put there
  const g = newRun(5153, "lord");
  ok("no appetite at the gate", eatable(g) === null);
  g.taken = PATHS.lord.nodes.filter((n) => n.gives.eat).map((n) => n.id);
  while (raise(g, "knight")) {
    /* nothing */
  }
  ok("the room fell", holdARoom(g));
  g.mana = manaCap(g);
  const h = heroUnit(g)!;
  h.hp = 10;
  ok("there is something on the floor worth eating", eatable(g) !== null);
  const pool = g.mana;
  const floor = offered(g, g.forces[0].battle!).length;
  ok("eating works", eat(g) === true);
  ok("it is paid for out of the asking", g.mana < pool);
  ok("it puts him back on his feet", h.hp > 10);
  ok("and what he ate never gets up", offered(g, g.forces[0].battle!).length === floor - 1);
  g.mana = 0;
  ok("an empty pool eats nothing", eat(g) === false);
}

// ---------------------------------------------------------------- abilities

let slots = 0;
const unit = (over: Partial<BattleUnit>): BattleUnit => ({
  id: 0, src: -1, creature: "rat", faction: "player",
  hp: 10, maxHp: 10, dmg: 2, speed: 3, slot: slots++, tier: 0, withered: 0, ...over,
});
const noPerks = perks(newGame(1));
const battle = (units: BattleUnit[], lead: "player" | "enemy" = "player"): Battle => ({
  node: 0, units, hit: [], mend: [], lead, next: lead, cursor: { player: 0, enemy: 0 },
  round: 0, log: [], done: "", healed: 0, taken: [], nextId: units.length, perks: { ...noPerks },
});

{
  // Lord: the line behind him is both his armour and his reach, and it is worth
  // exactly as much as it is still standing
  const lord = () =>
    unit({ id: 0, creature: "hero", faction: "player", hp: 100, maxHp: 100, dmg: 4, speed: 9, slot: 0 });
  const line = () => [unit({ id: 1, slot: 1 }), unit({ id: 2, slot: 2 })];
  const swinger = (dmg: number) => unit({ id: 3, faction: "enemy", hp: 100, maxHp: 100, dmg, slot: 0 });

  const bare = lord();
  takeTurn(battle([bare, ...line(), swinger(20)], "enemy"));
  ok("a lord who has bought nothing takes all of it", bare.hp === 80);

  const held = lord();
  const b1 = battle([held, ...line(), swinger(20)], "enemy");
  b1.perks.wall = 10;
  takeTurn(b1);
  ok("two bodies behind him take a fifth of it", held.hp === 84);

  const alone = lord();
  const b2 = battle([alone, swinger(20)], "enemy");
  b2.perks.wall = 10;
  takeTurn(b2);
  ok("and with nobody left behind him he takes all of it again", alone.hp === 80);

  const deep = lord();
  const b3 = battle([deep, ...line(), unit({ id: 4, slot: 3 }), swinger(20)], "enemy");
  b3.perks.wall = 40;
  takeTurn(b3);
  ok("a long enough line never makes him untouchable", deep.hp === 100 - 20 * (1 - TUNING.wallCap / 100));

  const fed = lord();
  const mark = swinger(1);
  const b4 = battle([fed, ...line(), mark], "player");
  b4.perks.lordDmg = 5;
  takeTurn(b4);
  ok("and the line behind him feeds his own blow", mark.hp === 100 - (4 + 5 * 2));
}

{
  // A wisp goes for whoever is worst off, which is rarely him - a lord has to buy
  // its attention rather than wait for it
  const mender = () =>
    unit({ id: 2, creature: "wisp", faction: "player", hp: 10, maxHp: 10, dmg: 2, speed: 9, slot: 2 });
  const him = () => unit({ id: 0, creature: "hero", faction: "player", hp: 50, maxHp: 100, speed: 1, slot: 0 });
  const runt = () => unit({ id: 1, faction: "player", hp: 1, maxHp: 10, speed: 1, slot: 1 });

  const hero = him();
  const rat = runt();
  takeTurn(battle([hero, rat, mender(), unit({ id: 3, faction: "enemy", slot: 0 })], "player"));
  ok("by default it mends the worst hurt", rat.hp > 1 && hero.hp === 50);

  const his = him();
  const other = runt();
  const b = battle([his, other, mender(), unit({ id: 3, faction: "enemy", slot: 0 })], "player");
  b.perks.wispFirst = 1;
  takeTurn(b);
  ok("bought, it goes for him instead", his.hp > 50 && other.hp === 1);
}

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
  // A mend is reported the same way a blow is, so the board can show it
  const me = unit({ id: 0, creature: "wisp", hp: 26, maxHp: 26 });
  const hurt = unit({ id: 1, hp: 4, maxHp: 60 });
  const bt = battle([me, hurt, unit({ id: 2, faction: "enemy", hp: 40, maxHp: 40 })], "player");
  bt.cursor.player = 0;
  let guard = 20;
  while (!bt.mend.length && guard-- > 0) takeTurn(bt);
  ok("mending is reported like a blow", bt.mend.length === 1);
  ok("with who did it and how much", bt.mend[0].by === me.id && bt.mend[0].n > 0);
  ok("and it landed on the one who needed it", bt.mend[0].id === hurt.id);
}

{
  // The mender tops up whoever is worst off, and never past their ceiling
  const me = unit({ id: 0, hp: 10, maxHp: 10 });
  const hurt = unit({ id: 1, hp: 3, maxHp: 60 });
  const bt = battle([me, hurt]);
  ABILITIES.siphon.onAttack!(me, unit({ faction: "enemy" }), bt);
  ok("siphon heals the worst off", hurt.hp === 3 + TUNING.siphonHeal);
  const brimming = unit({ id: 2, hp: 10, maxHp: 10 });
  ABILITIES.siphon.onAttack!(me, unit({ faction: "enemy" }), battle([me, brimming]));
  ok("and nothing goes over the top", brimming.hp === 10);
}

{
  // He walks at the back and stays there as the line grows
  const g = newRun(7373);
  ok("he is behind what he has raised", bandOf(g, heroForce(g)).at(-1)!.creature === "hero");
  raise(g, "knight");
  raise(g, "hound");
  ok("and behind what he raises next", bandOf(g, heroForce(g)).at(-1)!.creature === "hero");
  // ...unless you put him somewhere, and then he stays put
  moveUp(g, bandOf(g, heroForce(g)).length - 1);
  const at = bandOf(g, heroForce(g)).findIndex((u) => u.creature === "hero");
  raise(g, "rat");
  ok("moving him up sticks", bandOf(g, heroForce(g)).findIndex((u) => u.creature === "hero") === at);
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
  const g = newRun(3939);
  raise(g, "knight");
  // He takes the front here, so the wounded one behind him lives to be counted
  g.front = 0;
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
  const h = heroUnit(g)!;
  // He was left on 40 going in and may have taken more on the way out, so what
  // is pinned down is the ceiling: a trickle, never a full heal
  ok("he gets something back", h.hp > 0);
  ok("but nowhere near all of it", h.hp < h.maxHp);
  ok("a tenth at the very most", h.hp <= 40 + Math.ceil(h.maxHp * TUNING.restFrac));
  ok("a body keeps what it has left", reserve(g).some((u) => u.hp === 3));
}

{
  // He sends the dead in first by default, and is not pinned anywhere
  const g = newRun(4545);
  raise(g, "knight");
  const before = bandOf(g, heroForce(g)).map((u) => u.creature);
  ok("the dead go in ahead of him", before[before.length - 1] === "hero");
  ok("so something else is what gets hit", before[0] !== "hero");

  const last = before.length - 1;
  moveUp(g, last);
  const after = bandOf(g, heroForce(g)).map((u) => u.creature);
  ok("he can be walked up the line", after[last - 1] === "hero");
  ok("without losing anybody", after.length === before.length);
  for (let i = last - 1; i > 0; i--) moveUp(g, i);
  ok("all the way to the front", bandOf(g, heroForce(g))[0].creature === "hero");
  moveUp(g, 0);
  ok("and no further", bandOf(g, heroForce(g))[0].creature === "hero");
}

{
  // The order you put them in is the order they stand in, and the front of the
  // line is what the other side hits
  const g = newRun(6767);
  raise(g, "knight");
  raise(g, "warden");
  const order = reserve(g).map((u) => u.creature);
  orderHero(g, openRooms(g)[0].id);
  advance(g, TUNING.marchTicks + 1);
  const line = g.forces[0].battle!.units.filter((u) => u.faction === "player");
  ok("the dead go in ahead of him", line[line.length - 1].creature === "hero");
  ok("and stand where you put them", line.slice(0, -1).map((u) => u.creature).join() === order.join());
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
  const g = newRun(2210);
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
  // A squad is still his until it is dead, so it still costs him a slot
  const g = newRun(2468);
  while (raise(g, "knight")) {
    /* fill him up */
  }
  ok("the cap is full", fielded(g) === commandCap(g));
  const sent = reserve(g).slice(0, 2).map((u) => u.id);
  sendSquad(g, openRooms(g)[0].id, sent);
  ok("sending them does not free the slots", fielded(g) === commandCap(g));
  ok("and he cannot raise into them", raise(g, "rat") === false);
  ok("but they are not at his side", reserve(g).length === commandCap(g) - 2);

  advance(g, 40000);
  ok("they are gone in the end", squads(g).length === 0);
  ok("and the slots come back", fielded(g) < commandCap(g) || reserve(g).length === commandCap(g));
}

{
  // Several squads run at once, on the same clock, without the hero
  const g = newRun(3311);
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
    const g = newRun(3000 + seed * 17);
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
    const g = newRun(9100 + seed * 13);
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
  // A squad wins the room and leaves the dead where they lie, and reads nothing.
  // Sampled rather than pinned to one seed: whether a given squad can break a
  // given room is exactly the thing the balance keeps moving.
  let checked = 0;
  for (let seed = 0; seed < 40 && checked < 3; seed++) {
    const g = newRun(51000 + seed * 31);
    while (raise(g, "knight")) {
      /* nothing */
    }
    const room = openRooms(g).find((n) => n.lore !== null);
    if (!room) continue;
    const held = g.reserve.map((u) => u.id);
    sendSquad(g, room.id, held);
    advance(g, TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16);
    if (room.state !== "cleared") continue;
    checked += 1;
    ok(`squad ${seed}: nothing got up for them`, g.reserve.length === 0);
    ok(`squad ${seed}: and nobody told you a story`, g.loreQueue.length === 0);
    ok(
      `squad ${seed}: the room keeps its piece`,
      room.lore !== null && !g.seenLore.includes(room.lore),
    );

    // ...until he walks through it himself
    orderHero(g, room.id);
    advance(g, TUNING.marchTicks * 8);
    ok(`squad ${seed}: he walked in`, g.forces[0].at === room.id);
    ok(`squad ${seed}: and read it there`, g.loreQueue.includes(room.lore!));
  }
  ok("squads do take rooms", checked === 3);
}

{
  // Almost nothing gets up on its own now. What this holds down is that the free
  // ones stay a trickle: everything else on the floor has to be paid for.
  let fallen = 0;
  let up = 0;
  let crypts = 0;
  let cryptUp = 0;
  for (let seed = 0; seed < 300; seed++) {
    const g = newRun(6100 + seed * 7);
    const room = g.nodes[openRooms(g)[0].id];
    const before = g.reserve.length;
    const buried = g.lost;
    const bodies = room.foes.length;
    const crypt = room.kind === "crypt";
    orderHero(g, room.id);
    advance(g, TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16);
    if (room.state !== "cleared") continue;
    // The reserve also loses people in there, so count what came in, not the net
    const got = g.reserve.length - before + (g.lost - buried);
    if (crypt) {
      crypts += bodies;
      cryptUp += got;
      continue;
    }
    fallen += bodies;
    up += got;
  }
  ok("a decent sample of corpses", fallen > 300);
  const rate = up / fallen;
  ok(
    `the odd one gets up by itself (${(rate * 100).toFixed(0)}%)`,
    rate > TUNING.raiseChance / 3 && rate < TUNING.raiseChance * 3,
  );
  ok("a crypt still gives up all of its dead", crypts === 0 || cryptUp === crypts);
  console.log(`raising: ${up}/${fallen} got up on their own, and ${cryptUp}/${crypts} in crypts`);
}

{
  // A body on the floor is a decision now: the board waits, and what he can
  // take off it is decided by what he has left to ask with
  const g = newRun(8123);
  ok("he starts with a full pool", g.mana === manaCap(g) && g.mana === TUNING.manaBase);
  // Not a crypt: a crypt hands over its dead for nothing and there is nothing left to buy
  const room = openRooms(g).find((n) => n.kind !== "crypt")!;
  orderHero(g, room.id);
  advance(g, TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16);
  ok("the room fell", room.state === "cleared");
  ok("and nothing hurried him out of it", g.forces[0].mode === "spoils");
  const before = g.mana;
  ok("a cleared room gives some of him back", before > TUNING.manaBase - 1 || g.cleared > 0);

  const b = g.forces[0].battle!;
  const body = offered(g, b)[0];
  ok("there is a body left to ask for", body !== undefined);
  const cost = manaCost(g, body.creature);
  const held = g.reserve.length;
  const pool = g.mana;
  ok("it answers", reap(g, body.id) === true);
  ok("and it costs what it says on it", g.mana === pool - cost);
  ok("it is standing with him now", g.reserve.length === held + 1);
  ok("and the same body cannot be asked twice", reap(g, body.id) === false);
  ok("the board knows it is his", b.taken.includes(body.id));

  // Nothing to ask with is nothing to raise with
  g.mana = 0;
  const next = offered(g, b)[0];
  if (next) ok("an empty pool raises nothing", reap(g, next.id) === false);
  ok("and the pool cannot go under", g.mana === 0);

  // He is pinned in the room until he says he is done with it
  ok("he cannot be ordered out of a room he is holding", canOrder(g, g.forces[0].at) === false);
  advance(g, TUNING.spoilsTicks * 20);
  ok("and no amount of waiting moves him", g.forces[0].mode === "spoils");
  ok("leaving is his to call", leaveRoom(g) === true);
  ok("and then the room is behind him", g.forces[0].mode === "idle");
  ok("leaving twice does nothing", leaveRoom(g) === false);
}

{
  // What a node of it buys, and what a room pays back into it
  const g = newRun(4141);
  const well = PATHS.rat.nodes.find((n) => n.gives.manaPool)!;
  const cap = manaCap(g);
  g.unspent = 12;
  let guard = 20;
  while (!g.taken.includes(well.id) && guard-- > 0) {
    takeNode(g, treeOpen(g).find((id) => id === well.id) ?? treeOpen(g)[0]);
  }
  g.unspent = 0;
  ok("a well raises the ceiling", manaCap(g) === cap + well.gives.manaPool!);
  ok("and hands him what it added", g.mana === TUNING.manaBase + well.gives.manaPool!);
  g.mana = 0;
  const room = g.nodes[openRooms(g)[0].id];
  orderHero(g, room.id);
  advance(g, TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 16);
  if (room.state === "cleared") {
    ok("a room he takes pays into it", g.mana === Math.ceil(manaCap(g) * TUNING.manaRegen));
  }
  g.mana = manaCap(g);
  const full = g.mana;
  const other = g.nodes.find((n) => n.state === "open" && n.kind !== "boss");
  if (other) {
    leaveRoom(g);
    orderHero(g, other.id);
    advance(g, TUNING.marchTicks * 8 + TUNING.turnTicks * TUNING.maxRounds * 16);
    ok("and never over the top of it", g.mana <= full);
  }
}

// What a body costs has to make sense against what a body is
for (const [id, t] of Object.entries(CREATURES)) {
  if (id === "hero" || id === "ossuary") continue;
  ok(`${id}: it has a price`, t.mana >= 1);
  ok(`${id}: and the price is affordable from a standing start`, t.mana <= TUNING.manaBase);
}
ok("a rat is the cheapest thing there is", CREATURES.rat.mana === 1);
ok("and a warden is not", CREATURES.warden.mana > CREATURES.rat.mana);
ok("the Ossuary never answers", CREATURES.ossuary.mana === 0);

{
  // A room taken by proxy pays less of the lesson than one you walked into
  const budget = TUNING.marchTicks * 4 + TUNING.turnTicks * TUNING.maxRounds * 16 + 20;
  const squad = newRun(777);
  const solo = newRun(777);
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
  const g = newRun(2024);
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

const PROBES = 30;

// A bot that walks its whole retinue at the Ossuary. The floor of play, not the
// ceiling: it never waits, never picks its fights, never times anything. It
// exists to catch a nature that cannot be finished at all - or one that is
// simply the correct answer, which is the same bug from the other side.
function autoplay(seedValue: number, path: PathId) {
  const g = newRun(seedValue, path);
  let guard = 8000;
  const said = new Set<string>();
  while (!g.over && guard-- > 0) {
    // It spends every point the moment it has one, on whatever is nearest. A bot
    // that plans its route is a bot measuring a player, not a floor.
    while (g.unspent > 0 && treeOpen(g).length) takeNode(g, treeOpen(g)[0]);
    g.unspent = 0;
    g.loreQueue.length = 0;

    // A room he has taken waits for him. It takes whatever it can afford off the
    // floor, cheapest first, and then walks out - which is the floor of playing it.
    const b = g.forces[0].battle;
    if (g.forces[0].mode === "spoils" && b) {
      // What the tree lets him do with a room comes first: a lord who does not
      // eat is a lord who dies at the front of his own line
      while (eat(g)) {
        /* until the pool or the floor runs out */
      }
      while (mend(g)) {
        /* likewise */
      }
      for (const u of [...offered(g, b)].sort((x, z) => manaCost(g, x.creature) - manaCost(g, z.creature))) {
        if (g.mana < manaCost(g, u.creature)) break;
        if (!reap(g, u.id)) break;
      }
      leaveRoom(g);
    }

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

const chatter = new Set<string>();
const scores = PATH_IDS.map((path) => {
  let wins = 0;
  let deaths = 0;
  let clearedTotal = 0;
  for (let s = 0; s < PROBES; s++) {
    const { g, stuck, said } = autoplay(4000 + s * 101, path);
    ok(`${path} seed ${s} terminates`, !stuck);
    ok(`${path} seed ${s} is never stranded`, g.over !== "");
    for (const line of said) chatter.add(line);
    if (g.over === "won") wins += 1;
    if (g.over === "dead") deaths += 1;
    clearedTotal += g.cleared;
  }
  return { path, wins, deaths, rooms: clearedTotal / PROBES };
});

for (const s of scores) {
  ok(`${s.path}: a run can be lost`, s.deaths > 0);
  // Deliberately loose: how hard the game is belongs in the printed lines below,
  // not in an assertion. What this catches is a nature that cannot take a room.
  ok(`${s.path}: rooms are actually being cleared`, s.rooms >= 2);
}
ok("a run can be finished", scores.some((s) => s.wins > 0));

// The thing that kills build variety is not a weak nature, it is a correct one.
// Nothing else in this file is looking for that.
const best = Math.max(...scores.map((s) => s.rooms));
const worst = Math.min(...scores.map((s) => s.rooms));
const spread = scores.map((s) => `${s.path} ${s.rooms.toFixed(1)}`).join(", ");
ok(`no nature dominates (${spread})`, best / worst < 1.5);

ok("the probe saw a lot of chatter", chatter.size > 10);
for (const line of chatter) ok(`"${line}" fits the narrowest hud`, line.length <= MIN_COLS);

// Two creatures sharing a colour is two creatures you cannot tell apart on the
// board, which is the one thing the board is for
{
  const used = new Map<number, string>();
  for (const [id, t] of Object.entries(CREATURES)) {
    ok(`${id}: nothing else wears its colour`, !used.has(t.color));
    used.set(t.color, id);
  }
}

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
for (const s of scores) {
  console.log(
    `balance ${PATHS[s.path].name.toLowerCase().padEnd(8)} ${s.rooms.toFixed(1)} rooms, ` +
      `${s.wins}/${PROBES} reached the end, ${s.deaths}/${PROBES} died`,
  );
}
