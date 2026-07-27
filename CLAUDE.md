# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository. There is no README - this is the source of truth. When behaviour changes, update
the matching section here in the same change.

**Gravelight** - a turn-based necromancer conquest game drawn as a character grid over PixiJS v8,
using the [Dungeon Mode](https://datagoblin.itch.io/dungeonmode) tileset (`dungeonmode/`,
CC-BY). Mobile first, no build-time assets, deployed to GitHub Pages on push to `main`:
https://metsker.github.io/pixi-necromancer/

## Commands

```
npm run dev      # gen + vite dev server (host: true, so a phone on the LAN can reach it)
npm run check    # gen + tsc --noEmit + check-layout + check-sim
npm run build    # check, then vite build to dist/
npm run gen      # regenerate src/tilemap.ts and public/dungeon-mode.png from dungeonmode/
```

There is no test framework. The two check scripts are plain `node` runs of `.ts` files
(Node >= 22.6 type stripping; CI uses 24) and can be run alone:

```
node scripts/check-layout.ts   # drawing, layout, sheet widths, glyph coverage
node scripts/check-sim.ts      # rules assertions, then a balance probe bot
```

Both `exit 1` on the first failed assertion, and every measured line prints *before* it is
asserted on, so a regression shows you the numbers rather than one FAIL.

`check-sim` runs three probes, all driving **the same greedy brain on both sides** - a bot
playing a different game from its opponent measures nothing. Probe 1 is balance: 120 seeded
games, undead against human at difficulty 1.0, asserting the game can be won, can be lost,
sits inside a 30-70% band, and that no more than a quarter of games fail to finish. Probe 2 is
the *mirror*: the same family on both sides, which measures the map generator alone - a
lopsided mirror is a lopsided map, and it is the one thing that could make probe 1 mean
nothing. Probe 3 sweeps the difficulty slider and asserts it only ever gets harder and spans
more than 30 points. A balance regression fails the build, not just a type error.

`src/tilemap.ts` and `public/dungeon-mode.png` are generated and gitignored. Nothing compiles
until `npm run gen` has run at least once.

## How it plays

Design intent, verified against the code. Read this before changing rules - most of it is
load-bearing on some check in `scripts/`.

**It is turn-based, and a week is seven turns.** You spend `TUNING.movePoints` of movement,
end your turn, the other hero spends its own, and every `TUNING.weekTurns` turns everything
anybody holds makes what it makes. Movement is **flat** - what you are carrying never slows
you down, so the roster is a fight decision and never a map tax. `advance(g, ticks)` still
exists but it is no longer the rules: it is only how a turn is *drawn*, a token crossing a
cell and blows landing, and there is nothing for it to run while the board is waiting on you.

**The map is 7x7, and it is point-symmetric on purpose.** Rotate it 180 degrees and both
halves match. The **skeleton** is mirrored - the holes and therefore the whole topology, both
thrones, the deep producers and the mines - because those are the things whose imbalance
compounds every single week. Everything else is rolled again on the other side, so a map still
has a character of its own. Fairness stops being emergent the moment node types are authored
rather than derived, so it has to be *constructed*: that is what makes the mirror probe honest
rather than a number to tune toward.

**A city is a cluster, and its throne is enclosed by it.** Every cell orthogonally around a
throne is a city node, and neither a throne nor its ring is ever punched out. So a throne is
reachable *only* through its own city, and "you must fight through the city" is geometry
rather than a rule anybody has to be told. Take their throne to win; lose yours and it is
over. A check holds the enclosure over eight seeds.

**A node is owned, and what it makes it makes in the owner's family.** `owner` is
`none | player | enemy`; `garrison` is what stands there, whoever it belongs to. A producer
stands `growthFor(tier)` bodies **in its own node** each week, at `atTier(family, tier)` - so
the same barracks gives them footmen and gives you wraiths. That single rule is what makes the
1:1 ladder load-bearing on the whole economy rather than only on necromancy. Nothing
accumulates forever: a node holds `TUNING.stockWeeks` of itself and the rest is lost, which is
the answer to a stalemate probe 1 actually found - uncapped, a capital nobody visits grows a
garrison faster than any army can grow to break it, and the game simply stops.

**The garrison holds the ground for free; marching with it is what costs.** `mobilize` is the
only thing gold is for, priced by tier, and it is what stops a hero hoovering every node it
walks past. A week's income buys roughly a third of a week's growth, and choosing *which*
third is the decision. A throne and its city also pay gold - a capital is the economy, and
without that the opening is a deadlock: no gold, so no mustering, so no army, so no mine, so
no gold. The probe found that one on the first run.

**Neutrals are the ground you cross, and they never come back.** Bandits and beasts guard
every node until somebody takes it, and once they are gone they are gone - so the map is a
finite thing to clear rather than a field to farm. Depth is carried by *what* stands there far
more than by how many, because the ladder is already exponential.

**Two ladders, seven rungs each, and they share one set of numbers.** `TIER_STATS[t]` is the
hp/dmg/speed of tier `t` for *both* families, and a check holds it there. This is the single
invariant every balance number rests on, and it was learned the hard way: two ladders whose
stats differ at all cannot be balanced by tuning, because in a fight of many slots a small
edge compounds into every blow after it. A uniform 25% speed advantage read as a 20-point
faction gap, and three separate calibrations - per-tier HP, a shared speed multiset,
coordinate descent on mixed-ladder duels - every one of them came back lopsided. With the
stats shared, all four matchups measured fair with every spell switched off.

What makes the two sides different is therefore **the ability on a rung and the three spells
behind the hero**, and neither of those compounds. Nothing under `ABILITY_TIER` carries an
ability at all, so the bottom of the ladder is bodies and the top is rules.

**Everything living has an undead counterpart at its own depth.** `Template.rises` points at
it, a check holds the pairing, and `raiseAs` is one lookup because of it. A human tier 6
Knight comes back as a tier 6 Dread Knight; so does anything wild.

**Colour is the family, and the glyph is the rung.** Nineteen bodies against roughly fifteen
usable palette entries is a wall, not a tuning problem - and nobody was ever going to learn
nineteen colours anyway. On a board with two armies on it, *whose* is what you have to read
first, so the same rule runs on the map: colour is the owner, glyph is the kind. Neither hero
token may wear a family's or an owner's colour, and a check holds all of it.

**The spellbook is three windows and three roles.** Every spell belongs to exactly one of
`map`, `pre` and `post`, and each family holds exactly one in each - so neither side is
structurally short of an answer in any phase of a turn, which is the whole point of designing
both sides playable. The necromancer steps to his own ground, blunts their blows, and raises
what fell at its own tier; the human hurries, blesses, and mends. **Mana is the only limit**:
there is no cast cap, so the balance rests entirely on one turn's mana not comfortably
covering a pre-fight buff *and* the raise afterwards. Costs are set against each other rather
than independently. Corpses last only until the end of your turn, so a raise is now-or-never.

Mana is a rhythm, not a hoard: it regenerates `manaTurn` a turn and fills completely in your
own city, which is what gives the capital a job beyond being a win condition.

**Nobody takes turns inside a fight.** The battle engine is unchanged and still the best part
of the game: `Template.speed` is how often a body swings against `TUNING.speedBase`, `nextUp`
only ever moves the clock forward to whoever is due, and a slot is a row of health bars rather
than one long one - `BattleUnit.each` is what one body holds, `n` is derived from the pool and
falls as it drains. A blow is `dmg * n`, so two rats hit for two rats, and every ability pays
per body for the same reason. Targeting is a random living wall if any is standing
(`taunt`), otherwise a random survivor: breaking the wall is the tactic, not sniping.

**A fight is the mover's line against whatever is standing where he stepped** - another
hero's army, or a garrison with nobody behind it. The engine always puts the mover in the
"player" line, so `Battle.mover` is how anything read from *outside* the fight gets back to
the right hero. Getting that wrong meant the enemy's own blessing landed on you.

**Losing costs the army and nothing else.** The whole line is gone, you reappear at your
throne, and you keep every node you hold - the army *was* the price. Symmetric: their hero
breaks the same way. A bot never marches out of its own throne carrying the last of what was
standing in it (`throneKeep`); stripping a capital bare is a move the rules allow and a player
may take, but a bot that takes it every time hands the game away on turn three.

**Fog: terrain sticks, ownership goes stale.** Once you have been near a node you always see
what kind it is. Its owner and its garrison are live only inside `TUNING.sight`; outside it
the board shows what was true the last time anyone looked, so the map can lie and walking
somewhere to check is worth a turn. A seal is only drawn on a node you have actually seen. The
AI plays with full knowledge, the way HoMM's does.

**The other hero is one score over all 49 nodes.** Value, distance, can-I-beat-it, collect
from my own, flip theirs, hunt the hero, rush the throne, claim a shrine - every behaviour is
a weight in `scoreNode`, and there is no state machine. It commits to a route and re-decides
on arrival, so it does not dither and you can bait it. It attacks only above an army-value
margin, so a fleeing hero tells you you are ahead. `botTurn` is faction-generic because the
balance probe runs the same brain on the player side.

`worthOf` is what every one of those decisions is made on, and it is **multiplicative** - what
a body can take times what it deals, never the two added. Additive underprices speed, which
quietly told the slow army it was 11% stronger than it was and had it picking fights it could
not win for the whole game.

**Difficulty is one multiplier on the enemy's income** - production, gold, and nothing else -
and it is neutral at 1.0. It is not a balance crutch: the game has to be fair at 1.0, and
probe 2 is what proves it. Probe 3 measures the slider itself, which currently spans roughly
86% down to 0%.

## Architecture

**The seam is `src/sim/` vs everything else.** The sim imports no Pixi and touches no DOM, so
it runs headless under `node` and balance can be measured apart from whether the game looks
right. Keep it that way - a Pixi import in `src/sim/` breaks both check scripts.

- `src/sim/game.ts` - all behaviour. The rules are turns (`endTurn`, `botTurn`); `advance(g,
  ticks)` only drives what a turn *looks* like. `HELD` is how a won fight waits for the player.
- `src/sim/data.ts` - types plus `TUNING`, the single bag of balance numbers, `TIER_STATS` and
  the `CREATURES` templates built on it, the `KINDS` table, and `SPELLS`. Numbers and templates
  only; no behaviour. Adding a creature = one row reading `...TIER_STATS[t]` with a glyph
  nothing else wears; adding a node = one row in `KINDS`; adding a spell = one row in `SPELLS`,
  keeping the one-per-window-per-family shape a check holds it to.
- `src/sim/lore.ts` - the story pieces, spread over the map at generation.
- `src/sim/rng.ts` - mulberry32 with **module-global state**, mirrored into `g.rng` every tick
  and restored by `load()`. Two `GameState`s in one process share the stream, which is why the
  probes run their games sequentially.

`GameState` is plain JSON, saved to `localStorage`. When its shape changes, bump
`SAVE_VERSION` **and** add the field to `REQUIRED` in `game.ts` - a save that half-loads
crashes the first frame. There is no second save any more: the tree and its `Meta` are gone,
and a game is one board from the first turn to the last.

**Rendering is a character grid, not a scene.** `src/gfx/grid.ts` keeps two sprite pools (cell
background, glyph) and a char/fg/bg array; screens only ever call `put/fill/text/center`, then
`flush()` pushes tints and textures. A tap becomes a cell with arithmetic (`cellAt`), with no
hit-testing of display objects.

- `src/gfx/glyphs.ts` rewrites the 1-bit sheet's luminance into alpha at load, otherwise
  tinting paints solid squares.
- `src/gfx/surface.ts` is the narrow `Surface` interface the screens draw through, so
  `check-layout.ts` can hand them a recording stub instead of a renderer - which is also what
  lets it assert that nothing is ever drawn off the edge of the grid.
- `src/gfx/crt.ts` is the whole-stage barrel/scanline filter. `bend()` duplicates the shader's
  warp in JS; every pointer release goes through it before `cellAt`, or fingers land off the
  glyph they aimed at. Change the shader's curve math and `bend()` with it.

**Screens draw and register hit zones in the same pass.** `src/ui.ts` has the `Hits`
collector, `sheet()`/`buttons()`/`box()`/`bar()` and the palette `C`; a zone is added by the
code that drew the thing, so it cannot drift. `src/screens/panels.ts` builds every sheet's
text as a `Spec` at a known width, which is what lets `check-layout.ts` hold all panels to the
narrowest supported grid - every line of prose goes through `wrap()` for exactly that reason.

**`src/main.ts` is the only place the two halves meet.** Taps become an `Act` union
(`src/ui.ts`), the switch in `onAct` calls one sim function per act, and the ticker owes
`TICK_MS` ticks scaled by the speed control - but only while there is something to animate.
Sound is driven off a snapshot diff of the *visible* state (`hear()`), not from the sim, so a
frame that ran ten ticks still makes one noise. `src/sfx.ts` synthesizes every sound at
runtime through WebAudio - nothing to load.

## Conventions that will bite

- Imports carry `.ts` extensions; `verbatimModuleSyntax` and `noUnusedLocals` are on, so
  type-only imports need `type` and a stray local fails `npm run check`.
- **Every non-ASCII character anywhere in `src/` must exist in `TILE_MAP`.** `check-layout`
  scans the sources for it. A character not on the sheet renders as nothing at all.
- Count strings with `cells()` (code points), not `.length` - the necromancer's glyph is
  astral and would push every line it appears on over.
- Layout is derived, never assumed: `computeLayout()` picks a scale for legibility in device
  pixels and steps down until `MIN_COLS` fits. Nothing may hardcode a grid size.
- Balance numbers live in `TUNING` and nowhere else; a literal in `game.ts` is a bug.
- **The two ladders share `TIER_STATS` and a check holds them to it.** Giving one family
  better numbers at any rung cannot be corrected by tuning the other - it compounds through
  every blow of a multi-slot fight. Differentiate with abilities and spells instead.
- Anything read from *outside* a fight must go through `Battle.mover`, never an absolute
  faction: the engine always puts whoever moved in the `player` line, so the enemy hero
  attacking you is the `player` line of its own battle.
- In dev, `window.app/grid/run()/ui/hits/tap/crt` are exposed for Playwright - read the live
  run with `browser_evaluate` rather than squinting at screenshots.
