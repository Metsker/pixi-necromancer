// Rules assertions, then three probes. Exits 1 on the first failure, and every
// measured line prints *before* it is asserted on, so a regression shows you the
// numbers rather than one FAIL.
import {
  ABILITY_TIER,
  BUFF_IDS,
  CREATURES,
  CREATURE_IDS,
  KINDS,
  KIND_IDS,
  KIND_ROLL,
  LADDER,
  SPELLS,
  SPELL_IDS,
  TIER_STATS,
  TUNING,
  WINDOW_ORDER,
  atTier,
  growthFor,
  spellsOf,
  worthOf,
  type Family,
} from "../src/sim/data.ts";
import { botTurn, endTurn, newGame, throneOf } from "../src/sim/game.ts";

function ok(cond: boolean, what: string) {
  if (cond) return;
  console.log(`FAIL  ${what}`);
  process.exit(1);
}
const say = (line: string) => console.log(line);

// ------------------------------------------------------------------ the ladders

const RUNGS = [1, 2, 3, 4, 5, 6, 7];
for (const fam of ["undead", "human"] as Family[]) {
  const tiers = LADDER[fam].map((c) => CREATURES[c].tier);
  ok(tiers.length === RUNGS.length, `${fam} has ${RUNGS.length} rungs, not ${tiers.length}`);
  ok(tiers.every((t, i) => t === RUNGS[i]), `${fam} covers tiers 1..7 exactly once`);
}

// The invariant every faction-balance number rests on. Two ladders whose stats
// differ at all cannot be balanced by tuning - in a fight of many slots a small
// edge compounds into every blow after it, and three separate calibrations came
// back lopsided proving it. What makes the sides differ is abilities and spells.
for (const t of RUNGS) {
  const u = CREATURES[LADDER.undead[t - 1]];
  const h = CREATURES[LADDER.human[t - 1]];
  const s = TIER_STATS[t];
  ok(u.hp === s.hp && u.dmg === s.dmg && u.speed === s.speed, `undead t${t} is TIER_STATS[${t}]`);
  ok(h.hp === s.hp && h.dmg === s.dmg && h.speed === s.speed, `human t${t} is TIER_STATS[${t}]`);
}

// Every living and every wild body has a counterpart it comes back as, at its
// own depth. That pairing is what "every human unit has an undead counterpart"
// actually means, and `raiseAs` is one lookup because of it.
for (const c of CREATURE_IDS) {
  const t = CREATURES[c];
  if (t.family === "undead") {
    ok(t.rises === undefined, `${c} is already dead and rises as nothing`);
    continue;
  }
  ok(t.rises !== undefined, `${c} says what it rises as`);
  const up = CREATURES[t.rises!];
  ok(up.family === "undead", `${c} rises as something undead`);
  ok(up.tier === t.tier, `${c} (t${t.tier}) rises at its own tier, not t${up.tier}`);
}

// The shallow end of the ladder is bodies; the deep end is rules
for (const c of CREATURE_IDS) {
  const t = CREATURES[c];
  ok(t.ability === null || t.tier >= ABILITY_TIER, `${c} carries no ability below t${ABILITY_TIER}`);
}

// Colour is the family and the glyph is the rung, so no two bodies may share a
// glyph and no two node kinds may either
const glyphs = new Map<string, string>();
for (const c of CREATURE_IDS) {
  const g = CREATURES[c].glyph;
  ok(!glyphs.has(g), `glyph ${g} is ${c} alone, not also ${glyphs.get(g)}`);
  glyphs.set(g, c);
}
const kindGlyphs = new Map<string, string>();
for (const k of KIND_IDS) {
  const g = KINDS[k].glyph;
  ok(!kindGlyphs.has(g), `node glyph ${g} is ${k} alone, not also ${kindGlyphs.get(g)}`);
  kindGlyphs.set(g, k);
}

// The ladder has to climb, or a tier means nothing...
for (const fam of ["undead", "human"] as Family[]) {
  const worths = LADDER[fam].map((c) => worthOf(c));
  ok(
    worths.every((w, i) => i === 0 || w > worths[i - 1]),
    `${fam} worth climbs every rung: ${worths.join(" ")}`,
  );
}
// ...and what a rung hands over each week has to fall, or the top of the ladder
// is only the bottom with bigger numbers on it
ok(
  RUNGS.every((t) => t === 1 || growthFor(t) <= growthFor(t - 1)),
  `growth falls as the ladder climbs: ${RUNGS.map(growthFor).join(" ")}`,
);
say(`ladders  7+7 paired, stats shared per tier, abilities from t${ABILITY_TIER} up`);

// ------------------------------------------------------------------ spells

for (const fam of ["undead", "human"] as Family[]) {
  const mine = spellsOf(fam);
  ok(mine.length === 3, `${fam} holds exactly three spells`);
  const windows = mine.map((s) => SPELLS[s].window);
  for (const w of WINDOW_ORDER) {
    ok(windows.filter((x) => x === w).length === 1, `${fam} has exactly one ${w} spell`);
  }
}
ok(SPELL_IDS.length === 6, "six spells in all");
for (const s of SPELL_IDS) {
  const info = SPELLS[s];
  ok(info.desc.length > info.note.length, `${s}: the whole rule is longer than the card face`);
  ok(info.note.length > 0 && info.name.length > 0, `${s} has a name and a face`);
}
ok(BUFF_IDS.length > 0, "a shrine has something to hand over");
say("spells   3 a family, one each in map / pre-fight / post-fight");

// ------------------------------------------------------------------ the map

for (const seed of [1, 2, 3, 7, 11, 23, 99, 1234]) {
  const g = newGame(seed);
  const yours = throneOf(g, "player");
  const theirs = throneOf(g, "enemy");
  ok(yours.id !== theirs.id, `seed ${seed}: two thrones`);
  ok(yours.owner === "player" && theirs.owner === "enemy", `seed ${seed}: each throne is held`);

  // A throne is reachable only through its own city, so fighting through a city
  // is geometry rather than a rule anybody has to be told
  for (const t of [yours, theirs]) {
    ok(t.links.length > 0, `seed ${seed}: throne ${t.id} is joined to the board`);
    ok(
      t.links.every((id) => g.nodes[id].kind === "city"),
      `seed ${seed}: throne ${t.id} is enclosed by city`,
    );
    ok(
      t.links.every((id) => g.nodes[id].owner === t.owner),
      `seed ${seed}: the city around throne ${t.id} is its own`,
    );
  }

  // An island is a node nobody can ever take
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const id of g.nodes[cur].links) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  ok(seen.size === g.nodes.length, `seed ${seed}: every node is reachable from every other`);

  // Point symmetry. Holes come in pairs, so both sides get the same country to
  // cross - which is the whole of what makes the mirror probe honest.
  const at = new Set(g.nodes.map((n) => n.row * TUNING.mapCols + n.col));
  for (const n of g.nodes) {
    const twin = (TUNING.mapRows - 1 - n.row) * TUNING.mapCols + (TUNING.mapCols - 1 - n.col);
    ok(at.has(twin), `seed ${seed}: node ${n.id} has its opposite - holes come in pairs`);
  }

  // Nothing may be sealed on a board that has no key in it anywhere
  const sealed = g.nodes.filter((n) => n.sealed).length;
  const sources = g.nodes.filter((n) => KINDS[n.kind].keys > 0).length;
  ok(sealed === 0 || sources > 0, `seed ${seed}: ${sealed} sealed nodes but ${sources} key sources`);
}
ok(KIND_ROLL.length > 0, "there is something for a cell to roll into");
say("map      thrones enclosed, board whole and point-symmetric, over 8 seeds");

// ------------------------------------------------------------------ the probes

const CAP = 400;
type Tally = { won: number; dead: number; cap: number; turns: number };

function probe(you: Family, foe: Family, difficulty: number, n: number, seed0: number): Tally {
  const t: Tally = { won: 0, dead: 0, cap: 0, turns: 0 };
  for (let i = 0; i < n; i++) {
    // Sequential on purpose: the rng keeps module-global state, so two games in
    // flight would share one stream
    const g = newGame(seed0 + i, difficulty, foe, you);
    let turns = 0;
    while (!g.over && turns < CAP) {
      botTurn(g, "player");
      endTurn(g);
      turns += 1;
    }
    t.turns += turns;
    if (g.over === "won") t.won += 1;
    else if (g.over === "dead") t.dead += 1;
    else t.cap += 1;
  }
  return t;
}
const rate = (t: Tally) => (100 * t.won) / Math.max(1, t.won + t.dead);
const line = (name: string, t: Tally, n: number) =>
  `${name.padEnd(20)} won ${String(t.won).padStart(3)}  lost ${String(t.dead).padStart(3)}` +
  `  unfinished ${String(t.cap).padStart(3)}  winrate ${rate(t).toFixed(1)}%  avg turns ${Math.round(t.turns / n)}`;

const N = 120;
say("");
say("probe 1  the same greedy brain on both sides, undead against human, at x1.0");
const one = probe("undead", "human", 1, N, 30000);
say(line("  balance", one, N));
ok(one.won > 0, "the run can be won");
ok(one.dead > 0, "the run can be lost");
ok(rate(one) >= 30 && rate(one) <= 70, `winrate ${rate(one).toFixed(1)}% sits inside 30-70`);
// The tripwire the garrison cap was built against: a quarter of games never
// finishing means two armies that can no longer reach each other
ok((100 * one.cap) / N <= 25, `${((100 * one.cap) / N).toFixed(0)}% unfinished is at most 25`);

say("");
say("probe 2  mirror match - the same family on both sides, so only the map differs");
const mirrors: [string, Tally][] = [
  ["  undead mirror", probe("undead", "undead", 1, N, 40000)],
  ["  human mirror", probe("human", "human", 1, N, 40000)],
];
for (const [what, t] of mirrors) say(line(what, t, N));
// A lopsided mirror is a lopsided map generator, and that is the one thing that
// could make probe 1 mean nothing at all
for (const [what, t] of mirrors) {
  ok(
    rate(t) >= 35 && rate(t) <= 65,
    `${what.trim()} ${rate(t).toFixed(1)}% sits inside 35-65 - outside it the map favours a corner`,
  );
}

say("");
say("probe 3  the difficulty slider, undead against human");
const rates: number[] = [];
for (const d of [0.7, 1.0, 1.4, 2.0]) {
  const t = probe("undead", "human", d, 60, 50000);
  rates.push(rate(t));
  say(`  x${d.toFixed(1)}${" ".repeat(15)}winrate ${rate(t).toFixed(1)}%  unfinished ${t.cap}`);
}
ok(
  rates.every((r, i) => i === 0 || r <= rates[i - 1] + 6),
  `the slider only ever gets harder: ${rates.map((r) => r.toFixed(0)).join(" > ")}`,
);
ok(
  rates[0] > rates[rates.length - 1] + 30,
  "the slider is worth having - it has to span more than 30 points",
);

// ------------------------------------------------------------------ the opening

const g = newGame(12345);
ok(g.you.reserve.length > 0, "a hero opens with something to march");
ok(g.you.res.gold > 0, "a hero opens with something to spend");
ok(g.nodes.some((n) => n.owner === "player" && n.garrison.length > 0), "a week is already standing");
ok(atTier("undead", 99) === LADDER.undead[LADDER.undead.length - 1], "a tier past the top clamps to it");
ok(atTier("wild", 1) === LADDER.wild[0], "the wild ladder starts at its own bottom");

say("");
say("check-sim ok");
