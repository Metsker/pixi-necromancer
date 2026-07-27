// What a level-up puts on the table. Numbers and templates only - every key
// here is read at exactly one place in game.ts.
//
// The arms live here rather than on the tree, because this is where the choice
// is: the tree is neutral and buys access, an arm buys power. Two of them are
// the build - beasts or the dead - and the third is neither, because what the
// dark does to the other side helps whichever of them you are running.
import type { Perks } from "./tree.ts";

export type ArmId = "beast" | "undead" | "dark";

export const ARM_IDS: ArmId[] = ["beast", "undead", "dark"];

export const ARMS: Record<ArmId, { name: string; note: string; color: number }> = {
  beast: { name: "BEASTS", note: "the pack", color: 14 },
  undead: { name: "THE DEAD", note: "the risen", color: 22 },
  dark: { name: "THE DARK", note: "the other side", color: 20 },
};

// A common is a number and may be drawn again until it hits the stack cap. A
// rare is a rule, and it leaves the pool the moment it is yours.
//
// `note` is the card face, at a card's width. `desc` is the whole of what it
// does, in plain words, and is what the sheet behind the `?` prints - a card
// nobody can read is a card nobody drafts on purpose.
export type Power = {
  id: string;
  arm: ArmId;
  name: string;
  note: string;
  desc: string;
  rare?: boolean;
  gives: Partial<Perks>;
};

// Eight an arm - six numbers and two rules - so no arm is a shallower walk than
// another and the probe that says "no arm is simply the answer" compares like
// with like.
//
// A card names a *family*, never one creature: a number that only ever helped
// rats is a number that reads as a trap the moment you are running anything else.
export const POWERS: Power[] = [
  // beast: more of them, and they crowd
  {
    id: "feral", arm: "beast", name: "FERAL", note: "beasts +3 dmg",
    desc: "Every beast in your army hits for 3 more. Rats, crows, hounds, moths and boars are beasts.",
    gives: { beastDmg: 3 },
  },
  {
    id: "thickhide", arm: "beast", name: "THICK HIDE", note: "beasts +12 hp",
    desc: "Every beast gains 12 max hp and is healed for it. Beasts you raise later are born with it.",
    gives: { beastHp: 12 },
  },
  {
    // Capacity is the tree's to sell, not an arm's: a card that buys bodies buys
    // health, damage and crowding at once, and no other arm has an answer to it
    id: "savagery", arm: "beast", name: "SAVAGERY", note: "beasts +2, +6hp",
    desc: "Every beast hits for 2 more and gains 6 max hp, healed for it.",
    gives: { beastDmg: 2, beastHp: 6 },
  },
  {
    id: "packhunt", arm: "beast", name: "PACK HUNT", note: "all crowd now",
    desc: "Everything of yours gets the rat's swarm bonus: +2 damage per other body in your army, up to +10. Drawn again it bites harder and higher instead of twice.",
    gives: { swarmAll: 1, swarmPer: 1, swarmCap: 1 },
  },
  {
    id: "oldblood", arm: "beast", name: "OLD BLOOD", note: "+2 dmg a room",
    desc: "Every body hits for 2 more per room it has lived through, up to 6 rooms. A body that dies takes its rooms with it.",
    gives: { vetDmg: 2 },
  },
  {
    id: "hardyears", arm: "beast", name: "HARD YEARS", note: "+1 hp a room",
    desc: "Every body gains 1 max hp for each room it lives through, up to 6 rooms, and is healed for it at the same time.",
    gives: { vetHp: 1 },
  },
  {
    id: "thepress", arm: "beast", name: "THE PRESS", note: "dead crowd too",
    desc: "The swarm bonus counts your fallen as well as your standing, so a line that is losing hits as hard as the one that walked in.",
    rare: true, gives: { swarmDead: 1 },
  },
  {
    id: "bloodscent", arm: "beast", name: "BLOOD SCENT", note: "all rend now",
    desc: "Every blow of yours does 6 more to anything already under half health, the way a grave hound's does.",
    rare: true, gives: { rendAll: 1 },
  },

  // undead: harder to put down, and more of them get back up
  {
    id: "gravecold", arm: "undead", name: "GRAVE COLD", note: "dead +3 dmg",
    desc: "Every undead in your army hits for 3 more. Bones, shamblers, ghouls, wisps, knights and wardens are undead.",
    gives: { deadDmg: 3 },
  },
  {
    id: "oldbone", arm: "undead", name: "OLD BONE", note: "dead +12 hp",
    desc: "Every undead gains 12 max hp and is healed for it. Undead you raise later are born with it.",
    gives: { deadHp: 12 },
  },
  {
    id: "stoneskin", arm: "undead", name: "STONE SKIN", note: "walls +15 hp",
    desc: "Every wall of yours gains 15 max hp, and every undead gains 3, and both are healed for it. Boars, bone knights and tomb wardens are walls.",
    gives: { wallHp: 15, deadHp: 3 },
  },
  {
    id: "unbroken", arm: "undead", name: "UNBROKEN", note: "walls -10% hit",
    desc: "Every blow that lands on a wall of yours does 10% less, and every undead hits for 1 more. Only bodies born a wall are cut, never bodies made one by SHIELD WALL.",
    gives: { wallCut: 10, deadDmg: 1 },
  },
  {
    id: "carrion", arm: "undead", name: "CARRION", note: "+16% up, +2 dmg",
    desc: "16 more chances in a hundred that any given slot left on the floor gets up for free when a room is taken, and every undead hits for 2 more.",
    gives: { riseLuck: 16, deadDmg: 2 },
  },
  {
    id: "theshamble", arm: "undead", name: "THE SHAMBLE", note: "they rise worse",
    desc: "Anything living you raise comes back a shambler instead of bones: more health, less bite. Drawn again it adds 5 max hp and 1 damage to every undead instead of twice.",
    gives: { zombify: 1, deadHp: 5, deadDmg: 1 },
  },
  {
    id: "shieldwall", arm: "undead", name: "SHIELD WALL", note: "all are walls",
    desc: "Everything of yours is a wall, so every blow they throw lands on a random body of yours rather than picking. It changes who is hit, never what a hit is worth.",
    rare: true, gives: { wallAll: 1 },
  },
  {
    id: "opengraves", arm: "undead", name: "OPEN GRAVES", note: "all rise free",
    desc: "Every body left on the floor of a room you take gets up for nothing, as long as you have the capacity to hold it.",
    rare: true, gives: { glut: 1 },
  },

  // dark: nothing of yours gets better, everything of theirs gets worse
  {
    id: "dread", arm: "dark", name: "DREAD", note: "they hit -6%",
    desc: "Every blow they throw does 6% less, wherever it lands. Blunting stacks with withering but shares one 45% floor with it.",
    gives: { dread: 6 },
  },
  {
    // ponytail: stacks to three, so mending peaks at 18 a body a room. It is
    // still gated by the pool it shares with raising - cap it if that stops biting.
    id: "grit", arm: "dark", name: "GRIT", note: "mend the worst",
    desc: "Between rooms you may put the worst hurt slot back together for 6 a body, paid out of the same pool that raises the dead. Mending is a body you will not raise.",
    gives: { mend: 6 },
  },
  {
    id: "thehusk", arm: "dark", name: "THE HUSK", note: "it all withers",
    desc: "Everything you hit is withered for 3 turns, so it swings 15% softer, without needing a grave moth to carry it. Drawn again the withering lasts a turn longer instead of twice.",
    gives: { witherAll: 1, witherLong: 1 },
  },
  {
    id: "deepwither", arm: "dark", name: "DEEP WITHER", note: "wither bites",
    desc: "Withering blunts their blows by a further 8% while it holds, and every body of yours hits for 1 more. Yours are never blunted by withering.",
    gives: { witherPow: 8, minionDmg: 1 },
  },
  {
    id: "hex", arm: "dark", name: "HEX", note: "+5 vs withered",
    desc: "Every blow of yours does 5 more to anything the dark is already holding - anything withered - and 1 more to everything else.",
    gives: { hexDmg: 5, minionDmg: 1 },
  },
  {
    id: "thefew", arm: "dark", name: "THE FEW", note: "all +3 dmg",
    desc: "Every body in your army hits for 3 more, whatever it is made of.",
    gives: { minionDmg: 3 },
  },
  {
    id: "therot", arm: "dark", name: "THE ROT", note: "withering burns",
    desc: "Anything of theirs that swings while withered takes 6 damage for the effort.",
    rare: true, gives: { rot: 1 },
  },
  {
    id: "spite", arm: "dark", name: "SPITE", note: "dead hurt them",
    desc: "Every time one of theirs falls, the rest of them take 14. It carries: a fall that kills can set off the next.",
    rare: true, gives: { spite: 1 },
  },
];

export const POWER_BY_ID: Record<string, Power> = Object.fromEntries(
  POWERS.map((p) => [p.id, p]),
);

// Held to the same rule as every sheet: nothing on a card face is written wider
// than the box. The long description is prose and wraps, so it is not in here.
export const powerLines = (): string[] =>
  POWERS.flatMap((p) => [p.name, p.note]).concat(Object.values(ARMS).map((a) => a.name));
