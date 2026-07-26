// Run: node scripts/check-sim.ts
import { MIN_COLS } from "../src/layout.ts";
import { LORE } from "../src/sim/lore.ts";
import {
  ABILITIES,
  advance,
  canOrder,
  canSell,
  clearSave,
  commandCap,
  fielded,
  gainXp,
  held,
  leaveRoom,
  load,
  manaCap,
  manaCost,
  mend,
  mendable,
  moveDown,
  moveUp,
  newGame,
  offered,
  orderArmy,
  nodeCost,
  perks,
  powerOf,
  raise,
  reap,
  reroll,
  reserve,
  rollBand,
  rollOffer,
  routeTo,
  save,
  sell,
  takeNode,
  takePower,
  takeTurn,
  targetFor,
  threatOf,
  treeOpen,
  unitDmg,
  wallish,
  xpNeeded,
} from "../src/sim/game.ts";
import {
  CREATURES,
  START_BAND,
  START_POOL,
  TUNING,
  type Battle,
  type BattleUnit,
  type CreatureId,
  tierDmgFor,
  tierHpFor,
  type GameState,
} from "../src/sim/data.ts";
import { PERK_IDS, TREE, depthOf, rootId } from "../src/sim/tree.ts";
import { ARM_IDS, POWERS, POWER_BY_ID, type ArmId } from "../src/sim/powers.ts";

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
// Levels, without having to find enough dead to pay for them
const gainXpTo = (g: GameState, level: number) => {
  let guard = 200;
  while (g.level < level && guard-- > 0) gainXp(g, xpNeeded(g));
};
// Enough ticks for a march and the longest fight the cap allows
const budgetFor = TUNING.marchTicks * 3 + TUNING.turnTicks * TUNING.maxRounds * 2 + 64;

// ---------------------------------------------------------------- map

const g0 = newGame(12345);
ok("node ids are their own index", g0.nodes.every((n, i) => n.id === i));
ok("the grid has holes in it", g0.nodes.length < TUNING.mapCols * TUNING.mapRows);
ok("but most of it is rooms", g0.nodes.length > TUNING.mapCols * TUNING.mapRows * 0.5);
ok("the gate is where you start", g0.nodes[g0.at].kind === "gate");
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
  ok(`seed ${seed}: the map is worth choosing from`, g.nodes.length > 25);
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
    g.nodes.filter((n) => away(n) <= 1 && n.kind !== "gate").every((n) => n.tier < TUNING.tiers - 1),
  );
}

const a = newGame(999);
ok("the same seed builds the same run", JSON.stringify(a) === JSON.stringify(newGame(999)));
ok("different seeds differ", JSON.stringify(newGame(1000)) !== JSON.stringify(a));

{
  // A room you leave standing stays the size you found it. Nothing moves in
  // behind you now: skipping a room is a choice, not a clock.
  const g = newGame(1717);
  const before = g.nodes.map((n) => n.foes.length).join();
  advance(g, 4000);
  ok("the map holds still", g.nodes.map((n) => n.foes.length).join() === before);
}

{
  // The colour on a room is what is standing in it, and all three show up
  const seen = new Set<number>();
  for (let seed = 0; seed < 20; seed++) {
    const g = newGame(2200 + seed * 13);
    for (const n of g.nodes) {
      if (!n.foes.length) continue;
      seen.add(threatOf(n));
      ok(`seed ${seed}: threat is a band`, [0, 1, 2].includes(threatOf(n)));
    }
    const rooms = g.nodes.filter((n) => n.foes.length);
    const worst = rooms.reduce((x, z) => (powerOf(z) > powerOf(x) ? z : x));
    const softest = rooms.reduce((x, z) => (powerOf(z) < powerOf(x) ? z : x));
    ok(`seed ${seed}: the worst room is not the softest`, threatOf(worst) >= threatOf(softest));
  }
  ok("all three colours turn up on the map", seen.size === 3);
  const g = newGame(4242);
  const n = g.nodes.find((x) => x.foes.length)!;
  const before = powerOf(n);
  n.foes.push("warden");
  ok("something more in it makes it worse", powerOf(n) > before);
}

// ---------------------------------------------------------------- routing

{
  const g = newGame(4321);
  const start = g.at;
  ok("a route to where you stand is empty", routeTo(g, start, start)!.length === 0);
  const near = openRooms(g)[0];
  ok("a route into an open room is one step", routeTo(g, start, near.id)!.length === 1);
  const far = g.nodes.find((n) => n.state === "locked")!;
  ok("there is no route into a sealed room", routeTo(g, start, far.id) === null);
}

// ---------------------------------------------------------------- lore

ok(
  "every room below the gate carries a piece",
  g0.nodes.every((n) => n.kind === "gate" || n.lore !== null),
);
ok("the boss carries the last piece", g0.nodes.find((n) => n.kind === "boss")!.lore === LORE.length - 1);

// ---------------------------------------------------------------- the band you walk in with

{
  const g = newGame(7);
  ok("a run opens with a band", reserve(g).length === START_BAND);
  ok(
    "three different things, never three of one",
    new Set(reserve(g).map((u) => u.creature)).size === START_BAND,
  );
  ok("all of them out of the early pool", reserve(g).every((u) => START_POOL.includes(u.creature)));
  while (raise(g, "rat")) {
    /* fill it */
  }
  ok("the command cap holds", reserve(g).length === commandCap(g));
  ok("a full reserve refuses another", raise(g, "rat") === false);
  ok("the root of the tree is worth a body", commandCap(g) === TUNING.baseCap + 1);
  ok("the curve grows with level", xpNeeded({ ...g, level: 1 } as GameState) > xpNeeded(g));
}

{
  // Over enough rolls, every opening can kill something. This is the one thing
  // the distinct rule is here to guarantee.
  const seen = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const g = newGame(9000 + seed * 13);
    const band = reserve(g).map((u) => u.creature);
    seen.add([...band].sort().join());
    const punch = band.reduce((s, c) => s + CREATURES[c].dmg, 0);
    ok(`roll ${seed}: it can kill something`, punch >= 12);
    ok(`roll ${seed}: and it can take something`, band.reduce((s, c) => s + CREATURES[c].hp, 0) >= 60);
  }
  ok("more than one opening turns up", seen.size >= 3);
  ok("and none of them is impossible", seen.size <= 4);
  void rollBand;
}

// ---------------------------------------------------------------- the tree

{
  // The middle comes free, and the board is neutral: gold is the only gate.
  const g = newGame(1001);
  ok("the root is already yours", g.taken.join() === `${rootId}`);
  ok("and the board opens off it", treeOpen(g).length === 3);
  const first = treeOpen(g)[0];
  g.res.gold = 0;
  ok("gold is needed", takeNode(g, first) === false);
  g.res.gold = nodeCost(first);
  ok("and then it is yours", takeNode(g, first) === true);
  ok("the gold is spent", g.res.gold === 0);
  ok("buying it twice does nothing", takeNode(g, first) === false);
  ok("a node further out costs more", nodeCost(TREE.length - 1) > nodeCost(first));
}

{
  // Adjacency is the whole of the gate, so the far end of the board is not
  // reachable from the middle in one step however much gold there is
  const g = newGame(1002);
  g.res.gold = 9999;
  const deep = TREE.filter((n) => depthOf(n) >= 3);
  ok("there is a far end to reach", deep.length > 0);
  for (const n of deep) ok(`${n.name}: it is not open at the gate`, !treeOpen(g).includes(n.id));

  // Every node is reachable by somebody who banks enough, or a run can save for
  // a node it can never buy
  let guard = 200;
  while (treeOpen(g).length && guard-- > 0) takeNode(g, treeOpen(g)[0]);
  ok("every node can be reached", g.taken.length === TREE.length);
  ok("and nothing is left open", treeOpen(g).length === 0);
}

// Every key handed out either way has to be one the sim reads, or it is a number
// written on a sheet that does nothing
for (const n of TREE) {
  ok(`${n.name}: it does something`, Object.keys(n.gives).length > 0);
  for (const k of Object.keys(n.gives)) {
    ok(`${n.name}: ${k} is a perk`, PERK_IDS.includes(k as (typeof PERK_IDS)[number]));
  }
}
for (const p of POWERS) {
  ok(`${p.name}: it does something`, Object.keys(p.gives).length > 0);
  for (const k of Object.keys(p.gives)) {
    ok(`${p.name}: ${k} is a perk`, PERK_IDS.includes(k as (typeof PERK_IDS)[number]));
  }
}
ok("every card is its own id", new Set(POWERS.map((p) => p.id)).size === POWERS.length);
// An arm that is a shallower walk than another is an arm the probe cannot
// compare, so they are held level
for (const arm of ARM_IDS) {
  const mine = POWERS.filter((p) => p.arm === arm);
  ok(`${arm}: it is worth drafting`, mine.length >= 5);
  ok(
    `${arm}: it is the same walk as the others`,
    mine.length === POWERS.length / ARM_IDS.length &&
      mine.filter((p) => p.rare).length === POWERS.filter((p) => p.rare).length / ARM_IDS.length,
  );
}
// The tree is neutral: nothing on it touches a fight
const COMBAT: (typeof PERK_IDS)[number][] = ["ratDmg", "minionDmg", "wallHp", "dread", "mend"];
for (const k of COMBAT) {
  ok(`${k}: the board does not sell it`, !TREE.some((n) => k in n.gives));
}
// Every perk has to come from somewhere, or it is dead code in the sim
for (const k of PERK_IDS) {
  ok(
    `${k}: something gives it`,
    TREE.some((n) => k in n.gives) || POWERS.some((p) => k in p.gives),
  );
}

{
  // The dark deals a hand the moment there is a point to spend, it is dealt from
  // the run's own stream, and taking one spends the point
  const g = newGame(1010);
  ok("nothing is on the table at the gate", g.offer.length === 0);
  gainXpTo(g, 1);
  ok("a level puts a hand on the table", g.offer.length === TUNING.offerCount);
  ok("and it is three different things", new Set(g.offer).size === g.offer.length);
  ok("a card not on the table cannot be taken", takePower(g, "nonesuch") === false);
  const want = g.offer[1];
  ok("one of them is yours", takePower(g, want) === true);
  ok("the point is spent", g.unspent === 0);
  ok("and the table is cleared", g.offer.length === 0);
  ok("what was taken is held", g.powers.join() === want);
  ok("taking it again does nothing", takePower(g, want) === false);

  // A save and a load deal the same hand, or a reload is a reroll
  gainXpTo(g, 2);
  const dealt = g.offer.join();
  save(g);
  const back = load()!;
  ok("a reload does not deal a fresh hand", back.offer.join() === dealt);
  clearSave();
}

{
  // A rule leaves the pool once it is yours; a number comes round again until it
  // has been stacked as deep as it goes
  const g = newGame(1011);
  const rare = POWERS.find((p) => p.rare)!;
  const common = POWERS.find((p) => !p.rare)!;
  g.powers = [rare.id];
  let guard = 400;
  let sawRare = false;
  while (guard-- > 0) {
    rollOffer(g);
    if (g.offer.includes(rare.id)) sawRare = true;
  }
  ok("a rule taken never comes round again", !sawRare);

  g.powers = Array.from({ length: TUNING.powerStack }, () => common.id);
  guard = 400;
  let sawCommon = false;
  while (guard-- > 0) {
    rollOffer(g);
    if (g.offer.includes(common.id)) sawCommon = true;
  }
  ok("a number stacked to the cap stops being offered", !sawCommon);

  // Nothing on the table with a point owing would stop the clock forever
  g.powers = POWERS.flatMap((p) => Array.from({ length: TUNING.powerStack }, () => p.id));
  g.unspent = 3;
  rollOffer(g);
  ok("an empty pool gives the point back", g.offer.length === 0 && g.unspent === 0);
}

{
  // A reroll is paid for, and there is nothing to pay with until the board sells
  // one
  const g = newGame(1012);
  gainXpTo(g, 1);
  ok("no reroll at the gate", reroll(g) === false);
  g.rerolls = 1;
  ok("and then there is", reroll(g) === true);
  ok("it is spent", g.rerolls === 0);
  ok("but the point is not", g.unspent === 1 && g.offer.length > 0);
}

{
  // A card that makes bodies bigger has to make the bodies already standing
  // bigger, or taking it late takes nothing
  const g = newGame(1004);
  g.reserve.length = 0;
  raise(g, "rat");
  raise(g, "knight");
  const rat = g.reserve[0];
  const wall = g.reserve[1];
  const ratWas = rat.maxHp;
  const wallWas = wall.maxHp;
  for (const k of ["ratHp", "wallHp"] as const) {
    const card = POWERS.find((p) => p.gives[k])!;
    g.unspent = 1;
    g.offer = [card.id];
    ok(`${card.name} is taken`, takePower(g, card.id) === true);
  }
  const P = perks(g);
  ok("thin blood reaches a rat already standing", rat.maxHp === ratWas + P.ratHp);
  ok("and hands it what it added", rat.hp === rat.maxHp);
  ok("stone skin reaches a wall already standing", wall.maxHp === wallWas + P.wallHp);
  // ...and one raised afterwards gets it on the way up
  raise(g, "rat");
  ok("and one raised after it is born with it", g.reserve.at(-1)!.maxHp === ratWas + P.ratHp);
}

// ---------------------------------------------------------------- battle

let slots = 0;
// A warden is the one thing that is completely inert while it is standing - its
// only hook fires on death - so it is what the arithmetic below is measured on.
// Anything else quietly adds a swarm bonus or halves what it takes.
const unit = (over: Partial<BattleUnit>): BattleUnit => ({
  id: 0, src: -1, creature: "warden", faction: "player",
  hp: 10, maxHp: 10, dmg: 2, slot: slots++, tier: 0, withered: 0, ...over,
});
const noPerks = perks({ ...newGame(1), taken: [], powers: [] } as GameState);
const battle = (units: BattleUnit[], lead: "player" | "enemy" = "player"): Battle => ({
  node: 0, units, hit: [], mend: [], lead, next: lead, cursor: { player: 0, enemy: 0 },
  round: 0, log: [], done: "", healed: 0, taken: [], nextId: units.length, perks: { ...noPerks },
});

{
  // A blow lands on nobody in particular. Over enough turns everybody standing
  // has taken one, which is the whole of what "random" has to mean here.
  const foes = [0, 1, 2].map((i) => unit({ id: 10 + i, faction: "enemy", hp: 9999, maxHp: 9999 }));
  const b = battle([unit({ id: 0, dmg: 1, hp: 9999, maxHp: 9999 }), ...foes], "player");
  for (let i = 0; i < 400; i++) takeTurn(b);
  ok("every one of them gets hit sooner or later", foes.every((u) => u.hp < 9999));
  ok("and not all of it lands on one", new Set(foes.map((u) => u.hp)).size > 1);
}

{
  // ...unless a wall is standing, and then it takes all of it
  const wall = unit({ id: 10, creature: "knight", faction: "enemy", hp: 9999, maxHp: 9999 });
  const behind = [0, 1].map((i) =>
    unit({ id: 20 + i, creature: "rat", faction: "enemy", hp: 500, maxHp: 500 }),
  );
  const b = battle([unit({ id: 0, dmg: 1, hp: 9999, maxHp: 9999 }), wall, ...behind], "player");
  for (let i = 0; i < 200; i++) takeTurn(b);
  ok("a wall eats every blow", wall.hp < 9999);
  ok("and nothing behind it is touched", behind.every((u) => u.hp === 500));
  ok("targeting agrees", targetFor(b, "enemy")!.id === wall.id);

  wall.hp = 0;
  for (let i = 0; i < 200; i++) takeTurn(b);
  ok("the line opens when the wall falls", behind.some((u) => u.hp < 500));
}

{
  // A wall is a template flag, not a slot. Both of them are one.
  ok("a knight is a wall", CREATURES.knight.taunt);
  ok("so is a warden", CREATURES.warden.taunt);
  ok(
    "and nothing else is",
    (Object.keys(CREATURES) as CreatureId[])
      .filter((c) => c !== "knight" && c !== "warden")
      .every((c) => !CREATURES[c].taunt),
  );

  // The shield wall hands it to everybody, and only on your side of the board
  const mine = unit({ id: 1, creature: "hound", faction: "player" });
  const theirs = unit({ id: 2, creature: "hound", faction: "enemy" });
  const bare = battle([mine, theirs]);
  ok("a hound is nobody's wall by default", !wallish(mine, bare.perks) && !wallish(theirs, bare.perks));
  const bought = { ...noPerks, wallAll: 1 };
  ok("bought, yours is", wallish({ ...mine, faction: "player" }, bought));
  ok("and theirs is not", !wallish({ ...theirs, faction: "enemy" }, bought));
}

{
  // The bigger line opens. Even sides toss for it.
  const g = newGame(5150);
  const room = openRooms(g)[0];
  room.foes = ["rat"];
  orderArmy(g, room.id);
  advance(g, TUNING.marchTicks + 1);
  ok("more of you means you swing first", g.battle!.lead === "player");

  const h = newGame(5151);
  const big = openRooms(h)[0];
  big.foes = ["rat", "rat", "rat", "rat", "rat", "rat", "rat"];
  orderArmy(h, big.id);
  advance(h, TUNING.marchTicks + 1);
  ok("more of them means they do", h.battle!.lead === "enemy");
}

{
  // The order you put them in is the order they swing in. Nothing hidden.
  const first = unit({ id: 0, slot: 0, dmg: 3 });
  const second = unit({ id: 1, slot: 1, dmg: 7 });
  const mark = unit({ id: 2, faction: "enemy", hp: 500, maxHp: 500 });
  const b = battle([second, first, mark], "player");
  takeTurn(b);
  ok("the front of the line swings first", 500 - mark.hp === 3);
  takeTurn(b);
  takeTurn(b);
  ok("and the one behind it swings next", 500 - mark.hp === 10);
}

{
  // The lines alternate: four against one does not mean four blows to one
  const plain = (id: number, faction: "player" | "enemy") =>
    unit({ id, faction, dmg: 1, hp: 200, maxHp: 200 });
  const many = [0, 1, 2, 3].map((i) => plain(i, "player"));
  const lone = plain(10, "enemy");
  const b = battle([...many, lone], "player");
  for (let i = 0; i < 8; i++) takeTurn(b);
  ok("eight turns is four blows a side", 200 - lone.hp === 4);
  ok("the outnumbered one swings just as often", many.reduce((s, u) => s + 200 - u.hp, 0) === 4);
  ok("each of the four swings a quarter as often", b.cursor.player === 0);
  ok("and an exchange is a blow from each side", b.round === 4);
}

{
  // The cap on a fight means the same thing however many are standing in it
  const stale = (n: number, faction: "player" | "enemy") =>
    Array.from({ length: n }, (_, i) => unit({ id: i + (faction === "enemy" ? 50 : 0), faction, dmg: 0, hp: 9999, maxHp: 9999 }));
  const small = battle([...stale(1, "player"), ...stale(1, "enemy")]);
  const large = battle([...stale(6, "player"), ...stale(6, "enemy")]);
  let guard = 4000;
  while (!small.done && guard-- > 0) takeTurn(small);
  guard = 4000;
  while (!large.done && guard-- > 0) takeTurn(large);
  ok("a fight that will not end is lost", small.done === "loss" && large.done === "loss");
  ok("and it takes the same number of exchanges either way", small.round === large.round);
}

// ---------------------------------------------------------------- abilities

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
  const long = battle([]);
  long.perks.witherLong = 2;
  ABILITIES.wither.onAttack!(unit({ faction: "player" }), target, long);
  ok("bought, it holds longer", target.withered === TUNING.witherTurns + 2);
  ABILITIES.wither.onAttack!(unit({ faction: "enemy" }), target, long);
  ok("and what you bought is not theirs", target.withered === TUNING.witherTurns);
}

{
  // Control: what the dark has touched swings softer and breaks open easier
  const swinger = (over: Partial<BattleUnit>) => unit({ dmg: 20, hp: 500, maxHp: 500, ...over });
  const hit = (perkChanges: Partial<Battle["perks"]>, attacker: Partial<BattleUnit>) => {
    const from = swinger({ id: 0, ...attacker });
    const onto = swinger({ id: 1, faction: attacker.faction === "enemy" ? "player" : "enemy" });
    const b = battle([from, onto], from.faction);
    Object.assign(b.perks, perkChanges);
    takeTurn(b);
    return 500 - onto.hp;
  };
  const plain = hit({}, { faction: "enemy" });
  ok("a blow with nothing on it is what it says", plain === 20);
  ok("withered, theirs lands softer", hit({}, { faction: "enemy", withered: 1 }) < plain);
  ok(
    "and bought deeper, softer still",
    hit({ witherPow: 15 }, { faction: "enemy", withered: 1 }) <
      hit({}, { faction: "enemy", withered: 1 }),
  );
  ok("dread blunts them wherever they swing", hit({ dread: 10 }, { faction: "enemy" }) < plain);
  ok("but never below the soft cap", hit({ dread: 999 }, { faction: "enemy" }) >= Math.round(20 * (100 - TUNING.softCap) / 100));
  ok("and it is theirs it blunts, not yours", hit({ dread: 50 }, { faction: "player" }) === plain);

  // A hex only bites what the dark is already holding
  const fresh = swinger({ id: 1, faction: "enemy" });
  const bh = battle([swinger({ id: 0 }), fresh], "player");
  bh.perks.hexDmg = 6;
  takeTurn(bh);
  ok("a hex does nothing to what is untouched", 500 - fresh.hp === 20);
  const marked = swinger({ id: 1, faction: "enemy", withered: 2 });
  const bm = battle([swinger({ id: 0 }), marked], "player");
  bm.perks.hexDmg = 6;
  takeTurn(bm);
  ok("and bites what it is", 500 - marked.hp === 26);
}

{
  // Bond: a wall you have paid for takes less, and only a wall
  const under = (creature: CreatureId, cut: number) => {
    const wall = unit({ id: 0, creature, faction: "player", hp: 500, maxHp: 500 });
    const b = battle([wall, unit({ id: 1, faction: "enemy", dmg: 20 })], "enemy");
    b.perks.wallCut = cut;
    takeTurn(b);
    return 500 - wall.hp;
  };
  ok("unbroken holds a wall together", under("knight", 25) < under("knight", 0));
  ok("and does nothing for what is not one", under("rat", 25) === under("rat", 0));
}

{
  // A wisp does not make life, it moves its own. Nothing in a fight adds to what
  // the army is holding - all a wisp changes is which body is holding it, which
  // matters only because a wall is what the blows are landing on.
  const me = unit({ id: 0, creature: "wisp", hp: 30, maxHp: 30 });
  const hurt = unit({ id: 1, creature: "rat", hp: 3, maxHp: 60 });
  const bt = battle([me, hurt]);
  const before = me.hp + hurt.hp;
  ABILITIES.siphon.onAttack!(me, unit({ faction: "enemy" }), bt);
  ok("a wisp gives to the worst off", hurt.hp === 3 + TUNING.siphonHeal);
  ok("and it is its own life it gives", me.hp === 30 - TUNING.siphonHeal);
  ok("so a fight never adds to the army", me.hp + hurt.hp === before);
  ok("and it is reported like a blow", bt.mend.length === 1 && bt.mend[0].by === me.id);

  // It gives until it is nearly out and then stops
  const spent = unit({ id: 0, creature: "wisp", hp: TUNING.siphonFloor, maxHp: 30 });
  const other = unit({ id: 1, creature: "rat", hp: 1, maxHp: 60 });
  const dry = battle([spent, other]);
  ABILITIES.siphon.onAttack!(spent, unit({ faction: "enemy" }), dry);
  ok("a spent wisp gives nothing", other.hp === 1 && spent.hp === TUNING.siphonFloor);
  ok("and a wisp never goes out mending", spent.hp > 0);

  // ...and never into itself, or it is a heal again by another name
  const alone = unit({ id: 0, creature: "wisp", hp: 20, maxHp: 30 });
  const solo = battle([alone]);
  ABILITIES.siphon.onAttack!(alone, unit({ faction: "enemy" }), solo);
  ok("and never into itself", alone.hp === 20 && solo.mend.length === 0);

  const giver = unit({ id: 0, creature: "wisp", hp: 30, maxHp: 30 });
  const brimming = unit({ id: 2, creature: "rat", hp: 10, maxHp: 10 });
  const full = battle([giver, brimming]);
  ABILITIES.siphon.onAttack!(giver, unit({ faction: "enemy" }), full);
  ok("and nothing goes over the top", brimming.hp === 10 && giver.hp === 30);
}
ok("rend only bites the wounded", ABILITIES.rend.bonus!(unit({}), unit({ hp: 10 }), battle([])) === 0);
ok("rend bites at half", ABILITIES.rend.bonus!(unit({}), unit({ hp: 5 }), battle([])) === TUNING.rendBonus);
{
  // Rats opposite, or the one it finishes tolls back and the sum stops being one thing
  const me = unit({ id: 0, faction: "enemy" });
  const foes = [
    unit({ id: 1, creature: "rat", hp: 40, maxHp: 40 }),
    unit({ id: 2, creature: "rat", hp: 2 }),
  ];
  const bt = battle([me, ...foes]);
  ABILITIES.toll.onDeath!(me, bt);
  ok("toll hits everyone opposite", foes[0].hp === 40 - TUNING.tollDamage);
  ok("toll can finish someone", foes[1].hp === 0);
}
{
  const boss = unit({ id: 0, creature: "ossuary", maxHp: 130, dmg: 8 });
  const bt = battle([boss]);
  ABILITIES.split.onDeath!(boss, bt);
  ok("split makes one, not two", bt.units.length === 2);
  ok("the half carries half the health", bt.units[1].maxHp === 65);
  ok("and it is one tier deeper", bt.units[1].tier === 1);
  const deep = unit({ id: 9, creature: "ossuary", tier: TUNING.splitTiers });
  const bt2 = battle([deep]);
  ABILITIES.split.onDeath!(deep, bt2);
  ok("splitting stops somewhere", bt2.units.length === 1);
}

// ---------------------------------------------------------------- the line

{
  // The order is yours to set, both ways
  const g = newGame(7373);
  g.reserve.length = 0;
  raise(g, "rat");
  raise(g, "hound");
  raise(g, "knight");
  const was = reserve(g).map((u) => u.creature).join();
  moveUp(g, 2);
  ok("a body walks up the line", reserve(g).map((u) => u.creature).join() === "rat,knight,hound");
  moveDown(g, 1);
  ok("and back down it", reserve(g).map((u) => u.creature).join() === was);
  moveUp(g, 0);
  ok("the front cannot go further up", reserve(g).map((u) => u.creature).join() === was);
  moveDown(g, reserve(g).length - 1);
  ok("nor the back further down", reserve(g).map((u) => u.creature).join() === was);
}

{
  // The line you set is the line that walks in
  const g = newGame(6767);
  const order = reserve(g).map((u) => u.creature);
  orderArmy(g, openRooms(g)[0].id);
  advance(g, TUNING.marchTicks + 1);
  const line = g.battle!.units.filter((u) => u.faction === "player");
  ok("they stand where you put them", line.map((u) => u.creature).join() === order.join());
  ok("slots run front to back", line.every((u, i) => u.slot === i));
}

// ---------------------------------------------------------------- rooms and the pool

{
  // A body on the floor is a decision: the board waits, and what you can take
  // off it is decided by what you have left to ask with
  const g = newGame(8123);
  ok("you start with a full pool", g.mana === manaCap(g) && g.mana === TUNING.manaBase);
  // Not a crypt: a crypt hands over its dead for nothing and there is nothing to buy
  const room = openRooms(g).find((n) => n.kind !== "crypt")!;
  // Not what is being measured here, so the band cannot lose the room
  g.reserve.forEach((u) => ((u.maxHp = 4000), (u.hp = 4000)));
  orderArmy(g, room.id);
  advance(g, budgetFor);
  ok("the room fell", room.state === "cleared");
  ok("and nothing hurried you out of it", g.mode === "spoils");
  ok("a cleared room gives some of the pool back", g.mana > 0);

  const b = g.battle!;
  const body = offered(g, b)[0];
  ok("there is a body left to ask for", body !== undefined);
  const cost = manaCost(g, body.creature);
  const before = g.reserve.length;
  const pool = g.mana;
  ok("it answers", reap(g, body.id) === true);
  ok("and it costs what it says on it", g.mana === pool - cost);
  ok("it is standing with you now", g.reserve.length === before + 1);
  ok("and the same body cannot be asked twice", reap(g, body.id) === false);
  ok("the board knows it is yours", b.taken.includes(body.id));

  g.mana = 0;
  const next = offered(g, b)[0];
  if (next) ok("an empty pool raises nothing", reap(g, next.id) === false);
  ok("and the pool cannot go under", g.mana === 0);

  ok("you cannot be ordered out of a room you are holding", canOrder(g, g.at) === false);
  advance(g, TUNING.spoilsTicks * 20);
  ok("and no amount of waiting moves you", g.mode === "spoils");
  ok("leaving is yours to call", leaveRoom(g) === true);
  ok("and then the room is behind you", g.mode === "idle");
  ok("leaving twice does nothing", leaveRoom(g) === false);
}

{
  // Unmaking a body: a slot back, and rather less than it cost
  const g = newGame(8124);
  const one = reserve(g)[0];
  ok("nothing is sold on the road", canSell(g, one.id) === false);
  ok("and the call refuses it", sell(g, one.id) === false);

  g.reserve.forEach((u) => ((u.maxHp = 4000), (u.hp = 4000)));
  const room = openRooms(g)[0];
  orderArmy(g, room.id);
  advance(g, budgetFor);
  ok("the room fell", held(g) !== null);

  const before = g.reserve.length;
  g.mana = 0;
  ok("a body can be given back", sell(g, one.id) === true);
  ok("it pays what it always pays", g.mana === TUNING.sellMana);
  ok("and it is a slot back", g.reserve.length === before - 1);
  ok("it is gone for good", reserve(g).every((u) => u.id !== one.id));
  ok("selling the same one twice does nothing", sell(g, one.id) === false);

  // Never the last of them. An army of nobody is a dead run, not a button.
  while (g.reserve.length > 1) sell(g, g.reserve[0].id);
  ok("one is left", g.reserve.length === 1);
  ok("and it cannot be sold", canSell(g, g.reserve[0].id) === false);
  ok("nor the pool topped up past its ceiling", g.mana <= manaCap(g));
}

{
  // Nothing is ever worth selling for the money: the floor on asking is above
  // what unmaking pays back
  for (const c of Object.keys(CREATURES) as CreatureId[]) {
    if (CREATURES[c].mana === 0) continue;
    ok(`${c}: it costs more than unmaking pays`, CREATURES[c].mana > TUNING.sellMana);
  }
  ok("a rat is the cheapest thing there is", CREATURES.rat.mana === 2);
  ok("and a warden is not", CREATURES.warden.mana > CREATURES.rat.mana);
  ok("the Ossuary never answers", CREATURES.ossuary.mana === 0);
  const g = newGame(1);
  for (const c of Object.keys(CREATURES) as CreatureId[]) {
    if (c === "ossuary") continue;
    ok(`${c}: affordable from a standing start`, CREATURES[c].mana <= TUNING.manaBase);
    ok(`${c}: and nothing is ever free`, manaCost(g, c) >= 1);
  }
}

{
  // A room you take is the only thing that heals without a node bought for it
  const g = newGame(3939);
  const hurt = reserve(g)[0];
  hurt.hp = 1;
  const room = openRooms(g)[0];
  g.reserve.slice(1).forEach((u) => ((u.maxHp = 4000), (u.hp = 4000)));
  orderArmy(g, room.id);
  advance(g, budgetFor);
  if (room.state === "cleared" && reserve(g).some((u) => u.id === hurt.id)) {
    const back = reserve(g).find((u) => u.id === hurt.id)!;
    ok("a body that lived through it gets something back", back.hp > 1);
    ok("but nowhere near all of it", back.hp < back.maxHp);
    ok("a room lived through is counted", back.rooms === 1);
  }
}

{
  // Mending is a card, not a given
  const g = newGame(5152);
  ok("nothing to mend with at the gate", mendable(g) === null);
  g.powers.push(POWERS.find((p) => p.gives.mend)!.id);
  ok("nor with no room to stand in", mendable(g) === null);
  g.reserve.forEach((u) => ((u.maxHp = 4000), (u.hp = 4000)));
  orderArmy(g, openRooms(g)[0].id);
  advance(g, budgetFor);
  ok("the room fell", held(g) !== null);
  g.mana = manaCap(g);
  const worst = reserve(g)[0];
  worst.hp = 1;
  ok("a room you are holding puts the worst hurt on offer", mendable(g) === worst);
  const pool = g.mana;
  ok("mending works", mend(g) === true);
  ok("it is paid for out of the asking", g.mana < pool);
  ok("and the body goes back up", worst.hp > 1);
  g.mana = 0;
  ok("an empty pool mends nothing", mend(g) === false);
}

{
  // Nothing stands, the run is over. There is nobody behind the army.
  const g = newGame(4242);
  const room = openRooms(g)[0];
  room.foes = ["warden", "warden", "warden"];
  g.reserve.forEach((u) => ((u.hp = 1), (u.maxHp = 1)));
  orderArmy(g, room.id);
  advance(g, budgetFor);
  ok("the army is wiped", reserve(g).length === 0);
  ok("and that is the run", g.over === "dead");
}

{
  // Almost nothing gets up on its own. What this holds down is that the free
  // ones stay a trickle: everything else on the floor has to be paid for.
  let fallen = 0;
  let up = 0;
  let crypts = 0;
  let cryptUp = 0;
  for (let seed = 0; seed < 300; seed++) {
    const g = newGame(6100 + seed * 7);
    g.reserve.forEach((u) => ((u.maxHp = 4000), (u.hp = 4000)));
    const room = g.nodes[openRooms(g)[0].id];
    const before = g.reserve.length;
    const bodies = room.foes.length;
    const crypt = room.kind === "crypt";
    orderArmy(g, room.id);
    advance(g, budgetFor);
    if (room.state !== "cleared") continue;
    const got = g.reserve.length - before;
    if (crypt) {
      crypts += bodies;
      cryptUp += got;
      continue;
    }
    fallen += bodies;
    up += got;
  }
  ok("a decent sample of corpses", fallen > 200);
  const rate = up / fallen;
  ok(
    `the odd one gets up by itself (${(rate * 100).toFixed(0)}%)`,
    rate > TUNING.raiseChance / 3 && rate < TUNING.raiseChance * 3,
  );
  ok("a crypt still gives up all of its dead", crypts === 0 || cryptUp === crypts);
  console.log(`raising: ${up}/${fallen} got up on their own, and ${cryptUp}/${crypts} in crypts`);
}

// ---------------------------------------------------------------- the clock

{
  const g = newGame(2210);
  const before = JSON.stringify(g);
  advance(g, 0);
  ok("no ticks, no change", JSON.stringify(g) === before);
  const target = openRooms(g)[0].id;
  ok("the army can be ordered", orderArmy(g, target) === true);
  ok("an order does not resolve on the spot", g.mode === "march");
  advance(g, TUNING.marchTicks + 1);
  ok("marching takes time", g.at === target);
  ok("arriving starts the fight", g.mode === "fight");
  ok("a fight starts at round zero", g.battle!.round === 0);
  advance(g, TUNING.turnTicks * 4);
  ok("turns land on the clock", g.battle!.round >= 1);
  ok("you cannot be ordered mid-fight", canOrder(g, g.at) === false);
  ok("and the whole army went in", g.battle!.units.filter((u) => u.faction === "player").length === START_BAND);
}

// ---------------------------------------------------------------- persistence

{
  const g = newGame(2024);
  advance(g, 50);
  save(g);
  const back = load()!;
  ok("a save round-trips", back !== null && back.seed === g.seed);
  ok("the clock survives", back.time === g.time);
  ok("the army survives", back.reserve.length === g.reserve.length);

  store.set("gravelight.save", JSON.stringify({ v: 999, g }));
  ok("an older save is thrown away", load() === null);

  const missing = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
  delete missing.reserve;
  store.set("gravelight.save", JSON.stringify({ v: 2, g: missing }));
  ok("a save missing a field is thrown away", load() === null);

  store.set("gravelight.save", "not json");
  ok("garbage is thrown away", load() === null);
  clearSave();
  ok("clearing clears", load() === null);
}

// ---------------------------------------------------------------- balance probe

const PROBES = 60;

// A bot that takes the softest room it can see and saves the Ossuary for last.
// The floor of play, not the ceiling: it never mends at the right moment, never
// orders its line, never turns down a room. The one thing it does do is read the
// threat colour, because that is what the threat colour is for. It exists to
// catch a game that cannot be finished at all - or one that cannot be lost,
// which is the same bug from the other side.
function autoplay(seedValue: number, arm: ArmId | null = null) {
  const g = newGame(seedValue);
  let guard = 12000;
  const said = new Set<string>();
  while (!g.over && guard-- > 0) {
    // It takes every hand the moment it is dealt. Given an arm it drafts that
    // arm wherever the hand allows; given none it takes the first card shown.
    let deals = 40;
    while (g.unspent > 0 && g.offer.length && deals-- > 0) {
      const want = arm ? g.offer.find((id) => POWER_BY_ID[id].arm === arm) : undefined;
      takePower(g, want ?? g.offer[0]);
    }
    // Gold goes on the board, cheapest first. It never saves for the far corner.
    let buys = 40;
    while (buys-- > 0) {
      const next = treeOpen(g)
        .filter((id) => nodeCost(id) <= g.res.gold)
        .sort((a, z) => nodeCost(a) - nodeCost(z))[0];
      if (next === undefined || !takeNode(g, next)) break;
    }
    g.loreQueue.length = 0;

    const b = g.battle;
    if (g.mode === "spoils" && b) {
      while (mend(g)) {
        /* until the pool or the wounded run out */
      }
      const P = perks(g);
      const worth = (c: CreatureId) => {
        const t = CREATURES[c];
        // The same arithmetic the map paints a room with: what it can take plus
        // what it can give. Price says how big a thing is, not how much use it
        // is - by price a Wisp is a Hound, and a bot that believes that fields
        // six menders and calls the build weak.
        const bulk = t.hp * (t.ability === "bulwark" ? 2 : 1);
        const mine = c === "rat" ? P.ratHp + (P.ratDmg + P.swarmPer * 4) * 6 : 0;
        return bulk + t.dmg * 6 + mine;
      };
      // Best first, and it will unmake the least of them to make room
      for (const u of [...offered(g, b)].sort((x, z) => worth(z.creature) - worth(x.creature))) {
        if (g.mana < manaCost(g, u.creature)) continue;
        if (fielded(g) >= commandCap(g)) {
          const chaff = [...g.reserve].sort((x, z) => worth(x.creature) - worth(z.creature))[0];
          if (!chaff || worth(chaff.creature) >= worth(u.creature)) continue;
          if (!sell(g, chaff.id)) continue;
        }
        reap(g, u.id);
      }
      leaveRoom(g);
    }

    if (g.mode === "idle") {
      const soft = openRooms(g)
        .filter((n) => n.kind !== "boss")
        .sort((x, y) => powerOf(x) - powerOf(y))[0];
      const mine = soft ?? openRooms(g).find((n) => n.kind === "boss");
      if (mine) orderArmy(g, mine.id);
    }
    advance(g, 20);
    for (const line of g.log) said.add(line);
  }
  return { g, stuck: guard <= 0, said };
}

const chatter = new Set<string>();
const scores = [null, ...ARM_IDS].map((arm) => {
  let wins = 0;
  let deaths = 0;
  let rooms = 0;
  let levels = 0;
  for (let s = 0; s < PROBES; s++) {
    const { g, stuck, said } = autoplay(4000 + s * 101, arm);
    ok(`${arm ?? "any"} seed ${s} terminates`, !stuck);
    ok(`${arm ?? "any"} seed ${s} is never stranded`, g.over !== "");
    for (const line of said) chatter.add(line);
    if (g.over === "won") wins += 1;
    if (g.over === "dead") deaths += 1;
    rooms += g.cleared;
    levels += g.level;
  }
  return { arm: arm ?? "any", wins, deaths, rooms: rooms / PROBES, level: levels / PROBES + 1 };
});

// Said before the assertions, or a balance regression prints one FAIL and hides
// the four numbers you need to fix it
for (const s of scores) {
  console.log(
    `balance ${s.arm.padEnd(8)} ${s.rooms.toFixed(1)} rooms, level ${s.level.toFixed(1)}, ` +
      `${s.wins}/${PROBES} reached the end, ${s.deaths}/${PROBES} died`,
  );
}

for (const s of scores) {
  ok(`${s.arm}: a run can be lost`, s.deaths > 0);
  ok(`${s.arm}: a run can be finished`, s.wins > 0);
  ok(`${s.arm}: rooms are actually being cleared (${s.rooms.toFixed(1)})`, s.rooms >= 10);
  // The floor of play should not be the whole game. If a bot that never thinks
  // wins nearly every time, nothing above it is a decision.
  ok(`${s.arm}: and the floor of play is not a walkover (${s.wins}/${PROBES})`, s.wins < PROBES * 0.85);
}

// The thing that kills build variety is not a weak arm, it is a correct one.
// Nothing else in this file is looking for that.
const armed = scores.filter((s) => s.arm !== "any");
const best = Math.max(...armed.map((s) => s.wins));
const worst = Math.min(...armed.map((s) => s.wins));
const spread = armed.map((s) => `${s.arm} ${s.wins}`).join(", ");
ok(`no arm is simply the answer (${spread})`, best <= worst * 2);

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
  ok(`${id}: a wall says so`, !t.taunt || t.tag.startsWith("a wall"));
}

// ---------------------------------------------------------------- a fight you can watch

{
  // A fight has to last long enough to be worth opening. Rooms by the gate are
  // short on purpose; the ones that matter are not.
  const room = (list: CreatureId[], tier: number) =>
    list.map((c, i) => {
      const t = CREATURES[c];
      return unit({
        id: 100 + i,
        creature: c,
        faction: "enemy" as const,
        hp: t.hp + tierHpFor(tier),
        maxHp: t.hp + tierHpFor(tier),
        dmg: t.dmg + tierDmgFor(tier),
      });
    });
  const band = (list: CreatureId[]) =>
    list.map((c, i) => {
      const t = CREATURES[c];
      return unit({ id: i, creature: c, hp: t.hp, maxHp: t.hp, dmg: t.dmg });
    });
  // Turns, not rounds: one unit swings a turn, so the beat is what to count
  const turnsIn = (b: Battle) => {
    let turns = 0;
    let guard = 4000;
    while (!b.done && guard-- > 0) {
      takeTurn(b);
      turns += 1;
    }
    return turns;
  };
  const secs = (turns: number) => ((turns * TUNING.turnTicks + TUNING.marchTicks) * 0.11).toFixed(1);

  const shallow = battle([...band(["rat", "hound", "moth"]), ...room(["rat", "hound"], 0)]);
  const shallowTurns = turnsIn(shallow);
  const deep = battle([
    ...band(["knight", "hound", "hound", "rat", "moth", "wisp"]),
    ...room(["warden", "knight", "hound", "moth"], 4),
  ]);
  const deepTurns = turnsIn(deep);

  ok("a room by the gate is not instant", shallowTurns >= 8);
  ok("and it is one the opening band takes", shallow.done === "win");
  ok("a room that matters is a long fight", deepTurns >= 20);
  ok("a fight is worth opening", +secs(deepTurns) >= 5);
  console.log(
    `fights: ${shallowTurns} blows by the gate (${secs(shallowTurns)}s at x1), ` +
      `${deepTurns} deep (${secs(deepTurns)}s at x1, ${(+secs(deepTurns) / 4).toFixed(1)}s at x4)`,
  );
}

void unitDmg;
console.log(`sim: ${checks} checks passed`);
