// What a level-up puts on the table. Numbers and templates only - every key
// here is read at exactly one place in game.ts.
//
// The three arms live here rather than on the tree, because this is where the
// choice is now: the tree is neutral and buys access, an arm buys power.
import type { Perks } from "./tree.ts";

export type ArmId = "swarm" | "bond" | "control";

export const ARM_IDS: ArmId[] = ["swarm", "bond", "control"];

export const ARMS: Record<ArmId, { name: string; note: string; color: number }> = {
  swarm: { name: "SWARM", note: "the many", color: 15 },
  bond: { name: "BOND", note: "the few", color: 14 },
  control: { name: "CONTROL", note: "the dark", color: 20 },
};

// A common is a number and may be drawn again until it hits the stack cap. A
// rare is a rule, and it leaves the pool the moment it is yours.
export type Power = {
  id: string;
  arm: ArmId;
  name: string;
  note: string;
  rare?: boolean;
  gives: Partial<Perks>;
};

// Five and two an arm, so no arm is a shallower walk than another and the probe
// that says "no arm is simply the answer" is comparing like with like.
//
// A number here is worth about a third of what the same node was worth on the
// old tree, because the tree made you walk past things you did not want and this
// does not: three of the one card you were after is the build now.
export const POWERS: Power[] = [
  // swarm: more of them, cheaper, and rats worth keeping a lot of
  { id: "vermin", arm: "swarm", name: "VERMIN", note: "rats +2 dmg", gives: { ratDmg: 2 } },
  { id: "thinblood", arm: "swarm", name: "THIN BLOOD", note: "rats +8 hp", gives: { ratHp: 8 } },
  { id: "crowding", arm: "swarm", name: "CROWDING", note: "swarm caps +4", gives: { swarmCap: 4 } },
  { id: "carrion", arm: "swarm", name: "CARRION", note: "more get up", gives: { riseLuck: 12 } },
  // The rest of the arm only ever helps rats, so the thing that makes everybody
  // crowd is a common. Drawn again it does not switch on twice - it bites harder.
  { id: "ratking", arm: "swarm", name: "KING OF RATS", note: "all swarm now", gives: { swarmAll: 1, swarmPer: 1 } },
  { id: "thepress", arm: "swarm", name: "THE PRESS", note: "dead crowd too", rare: true, gives: { swarmDead: 1 } },
  { id: "opengraves", arm: "swarm", name: "OPEN GRAVES", note: "all rise free", rare: true, gives: { glut: 1 } },

  // bond: fewer of them, and a wall worth standing behind
  { id: "thefew", arm: "bond", name: "THE FEW", note: "all +2 dmg", gives: { minionDmg: 2 } },
  { id: "hardyears", arm: "bond", name: "HARD YEARS", note: "+1 hp a room", gives: { vetHp: 1 } },
  { id: "stoneskin", arm: "bond", name: "STONE SKIN", note: "walls +10 hp", gives: { wallHp: 10 } },
  { id: "unbroken", arm: "bond", name: "UNBROKEN", note: "walls -8% hit", gives: { wallCut: 8 } },
  { id: "thepack", arm: "bond", name: "THE PACK", note: "old bones bite", gives: { vetDmg: 1 } },
  // Mending is a rule, not a number. Stacked, it is a pump that turns the mana a
  // room hands back into more life than the room ever took.
  { id: "grit", arm: "bond", name: "GRIT", note: "mend the worst", rare: true, gives: { mend: 8 } },
  { id: "shieldwall", arm: "bond", name: "SHIELD WALL", note: "all are walls", rare: true, gives: { wallAll: 1 } },

  // control: nothing of yours gets better, everything of theirs gets worse
  { id: "dread", arm: "control", name: "DREAD", note: "they hit -4%", gives: { dread: 4 } },
  { id: "gloom", arm: "control", name: "GLOOM", note: "they hit -3%", gives: { dread: 3 } },
  { id: "deepwither", arm: "control", name: "DEEP WITHER", note: "wither bites", gives: { witherPow: 5 } },
  { id: "hex", arm: "control", name: "HEX", note: "+3 vs withered", gives: { hexDmg: 3 } },
  // The rest of the arm is dead without something withering, so the thing that
  // withers is a common. Drawn again it does not switch on twice - it lasts longer.
  { id: "thehusk", arm: "control", name: "THE HUSK", note: "it all withers", gives: { witherAll: 1, witherLong: 1 } },
  { id: "therot", arm: "control", name: "THE ROT", note: "withering burns", rare: true, gives: { rot: 1 } },
  { id: "spite", arm: "control", name: "SPITE", note: "dead hurt them", rare: true, gives: { spite: 1 } },
];

export const POWER_BY_ID: Record<string, Power> = Object.fromEntries(
  POWERS.map((p) => [p.id, p]),
);

// Held to the same rule as every sheet: nothing is written wider than the box
export const powerLines = (): string[] =>
  POWERS.flatMap((p) => [p.name, p.note]).concat(Object.values(ARMS).map((a) => a.name));
