# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository. There is no README - this is the source of truth. When behaviour changes, update
the matching section here in the same change.

**Gravelight** - a real-time necromancer roguelite drawn as a character grid over PixiJS v8,
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

Both `exit 1` on the first failed assertion. `check-sim` ends by autoplaying 60 seeded runs
per draft arm (plus a greedy arm-agnostic set) and asserting each arm can win, can lose,
clears >= 10 rooms, is not a walkover, and that no arm wins more than twice as often as the
worst - all of it on a *fresh board*, which is the run a new player gets. A fifth `whole` probe
holds every node and only asks that it still terminates and can still be lost. A balance
regression fails the build, not just a type error. Every `balance` line prints *before* those
assertions, so a regression shows you the numbers rather than one FAIL.

`src/tilemap.ts` and `public/dungeon-mode.png` are generated and gitignored. Nothing compiles
until `npm run gen` has run at least once.

## How it plays

Design intent, verified against the code. Read this before changing rules - most of it is
load-bearing on some check in `scripts/`.

**The map** is a 7x7 grid of rooms joined N/S/E/W (`TUNING.mapCols/mapRows`), with holes
punched at `holeChance`, one at a time, and only where the remaining rooms stay connected -
no repair pass, because that is where a generator quietly starts producing corridors. You
enter at the centre; tier rises with distance out (`tierForDist`, 6 bands), so difficulty
radiates rather than descends. The Ossuary sits at whatever room survives furthest from the
gate. Rooms are `locked` -> `open` (something beside them is cleared) -> `cleared`.

**A room is a theme, and the theme is the pool.** Every kind is one row of `KINDS` in
`data.ts` - name, glyph, colour, three tiered pools, size, loot, and the three flags that
make it interesting (`key`, `freeRise`, `gift`). No two rooms share a colour or a glyph, and
none of them may wear `ARMY_COLOR`: the map is nothing but colour and glyph now, and a token
that reads as a room is a token you lose on it. A check holds all three. `sewer` is rats and crows, `village` is
living peasants who come back as bones, `wilds` is hounds and moths, `barrow` is elite
(`tierUp: 1`), `graves` gives up all of its dead for free, `crypt` and `vault` are **sealed**
and cost a key, `boss` is the Ossuary. The map is coloured by *kind* and nothing else -
`powerOf` still exists, but it prices a room on the sheet you open, it does not paint it.
Adding a room = one row in `KINDS` plus one entry in `KIND_ROLL`.

**A key is a choice, never a wall.** `needsKey` blocks `canOrder` and `arrive` spends the key
on the door, not on the room. Nothing sealed is rolled in the first ring (`OPEN_ROLL`), and
`keepOpen` hands one over if every remaining way on is sealed and the purse is empty - so a
key gates what is worth taking, never whether the run can go on.

**One army, no hero, and the same thing shares a slot.** `g.reserve` is everything you have;
the token on the map is the necromancer but he is not a combatant and has no hit points.
A run opens on **one slot, `START_BAND` deep** - `rollBand` picks one thing out of
`START_POOL` and hands you three of it, so the gate gives you a build to deepen rather than a
spread to sort out. Raising a rat when you hold rats deepens that slot: `Unit.n` goes up and
`hp`/`maxHp` are the whole stack's. Capacity is `commandCap` counted in **slots** (`fielded`) - four at the gate,
`TUNING.baseCap` plus the root - so what the cap holds is how many *different* things you can
field. **Depth is free, breadth is the price.** `roomFor` is the one gate on `raise`: a kind
it already holds never refuses another, which also means `while (raise(...))` never
terminates. `bodies()` is the other count, and it is what leads a fight and what crowds a
blow. A slot is one body on the board with everything summed, so a narrow army hits harder
than a broad one - concentration is the tactic the arrows used to be. There is exactly one
army and one order at a time.

Nothing caps how deep one slot goes, and that is **not solved**. The probe says a slot cap
flattens the arms - beast/undead/dark come in at 42/41/40 wins against an arm-agnostic 41,
because free bodies outweigh the cards that buy power. The levers, when it needs one: a depth
cap on `Unit.n`, or free rises (`raiseChance`, `glut`, `freeRise`, `gift`) only handing over
kinds you do not already hold.

**The clock never stops for you** unless a sheet is up. `advance(g, ticks)` drives march,
fight and spoils off `g.time` vs `g.next`; the speed control is x1/x2/x4/hold. Anything
`shownPanel()` returns halts the ticker, so nothing you must answer can be missed.

**A fight** is one blow at a time and the two lines alternate: bringing six against three
does not buy six blows to three, it buys a deeper bench and (because the bigger line leads on
*bodies*, ties tossed for) the opening blow. Both lines stack the same way - `stackOf` folds a
room of four rats into one body of four rats - or a room would get four blows to your one and
the whole point of a slot would be on your side only. Each side cycles its own line by `slot`, so line order is
*swing* order - the arrows on the army sheet are how you decide who acts first. Targeting is
separate: a blow lands on a random living wall (`taunt`, plus everything of yours once
`wallAll` is drafted) if any is standing, otherwise on a random survivor. `wallCut` deliberately
does *not* follow `wallAll` - a shield wall changes who is hit, not what a hit is worth, or one
card puts the soft cap on every body you own. Breaking the wall is the tactic, not sniping.
`TUNING.maxRounds` exchanges without a result is a loss - a fight that will not end is a
fight you lost slowly.

Opening concentrated is worth about twice opening spread - one slot swinging for three
bodies every turn against three taking turns - so `TUNING.roomBase` carries a body more than
it used to. That is the whole of the compensation and it is where to look first if the early
game reads wrong.

**Two families, and everything on a body is one of them.** `CREATURES[c].family` is `beast`,
`undead` or `living`, and `Template.tier` says how deep it belongs. Nothing under
`ABILITY_TIER` carries an ability at all (a check holds the table to it), so the shallow end
of the map is bodies and the deep end is rules. Nothing `living` ever joins you as it was:
`raiseAs` turns it into what `Template.rises` says - bones, or a shambler once `zombify` is
drafted - and `manaCost` prices it by what it becomes.

**Abilities** hang off `CREATURES[c].ability` and resolve through the four hooks in
`ABILITIES` (`bonus`, `taken`, `onAttack`, `onDeath`): `swarm` (per living *body* on its side,
paid per body in the slot), `bulwark` (halves what it takes), `wither` (blunts their next
blows), `siphon` (a wisp moves its *own* life into whoever is worst off and stops at
`siphonFloor`, so it burns down rather than healing for free), `rend` (bonus vs wounded),
`toll` (hurts everyone when it falls), `split` (the Ossuary, once). Everything a slot throws
or takes scales by `n`. Five drafted rules bolt onto the same loop without an ability of their
own: `swarmAll` (everything of yours crowds), `rendAll` (everything of yours bites the
wounded), `swarmDead` (the fallen still count toward the crowd), `rot` (a withered enemy pays
to swing anyway), `spite` (one of theirs falling is felt by the rest).

**The spoils are the decision.** A won room holds the board open forever (`g.next = HELD`)
until you leave it. A slot of what fell gets up free (one roll a slot, `raiseChance` +
`riseLuck`; a `graves` room, a `freeRise` kind, or a drafted `glut`, gives up all of it), and
a `gift` kind hands over `TUNING.giftBodies` outright - that is what the key bought.
Everything else must be `reap`ed, a **whole slot at a time**, at `manaCost` x n - and all of
it lands in one slot, so the only thing that ever refuses it is having no room for its *kind*. Mana is the only real currency - it regenerates a share of its cap per room cleared
(`manaRegen` + `manaRise`), and `mend` (a dark card) and `reap` come out of the same pool, so
mending is a body you will not raise. `sell` unmakes **one body off a slot** for `sellMana`,
always less than the cheapest thing there is: it is a slot you wanted, never a profit, and
never the last body. What a body has when it gets up is what it has for the run - only a
cleared room heals (`restFrac` + `restMore`), and only what lived through it.

**A level-up is a hand of three.** `unspent > 0` with something on the table forces the draft
sheet up and stops the clock, which is what makes a level a decision instead of a number. The
hand is rolled in the sim (`rollOffer`) and lives on `g.offer`, **not** on the ui - a reload
mid-level-up must not deal a fresh hand. `TUNING.offerCount` cards, plus one per `offers` node
of the board; a `rerolls` node buys the right to throw a hand back. The probe averages level
~8 over a full run, so a run drafts about eight of them.

**Every card says exactly what it does.** `Power.note` is the card face at a card's width;
`Power.desc` is the whole rule in plain words, and the `?` at the end of a card on the draft
sheet opens the `power` panel on it. The same panel is reachable from `menu -> gifts`, which
lists what you already hold, stacked. `shownPanel` puts `power` **above** `draft`, or a card
could not be read at the one moment reading it is worth anything. A check holds every
description to the narrowest grid, and asserts it is longer than the face.

**The cards** are `POWERS` in `src/sim/powers.ts`, eight per arm - six commons and two rares,
held level by a check, because an arm that is a shallower walk than another is an arm the probe
cannot compare. A common is a number and stacks to `TUNING.powerStack`; a rare is a rule and
leaves the pool once taken. The three arms are `beast`, `undead` and `dark`: the first two are
the build - **a card names a family, never one creature**, or it reads as a trap the moment you
are running anything else - and `dark` is neither, because what it does to the other side helps
whichever of them you are running. Each arm's engine sits on a **common**, not a rare -
`swarmAll` for beasts, `zombify` for the dead, `witherAll` for the dark - and they are written
`{ engine: 1, number: 1 }` so a repeat draw is not a dud. Capacity is the *tree's* to sell and
no arm's: a card that buys bodies buys health, damage and crowding at once, and the other arms
have no answer to it.

**The tree** is 19 *neutral* nodes on a 5x5 board and carries no arm: it buys access, the cards
buy power. Nothing on it may touch a fight (a check asserts this). It sells capacity, mana,
healing, levelling speed, and the draft itself - a fourth card, a reroll, a body at the gate.
A node opens when it is beside one you own, and `nodeCost` prices it by `depthOf`, so distance
out is the whole of the gate.

**The tree is the meta, and it is the only thing that survives a run.** It lives on `Meta`
(`{ gold, taken }`), not on `GameState`, under its own key and its own version - a
`SAVE_VERSION` bump changes the shape of a run and must never cost him a board he spent runs
buying. Gold is what a room has always dropped and nothing ever spent; `bank()` pays the run's
purse into the board on the edge `g.over` is set and **empties the purse as it does**, which is
the whole of what stops a reload paying twice. The run save is written on that same frame, or a
tab closed there comes back to a run still holding gold already paid in.

The end of a run is the hub - there is no title screen. `over` offers the board, the board says
`begin` instead of `close`, and `newGame(seed, owned)` takes what is bought as an argument, so
`src/sim/` still knows nothing about where a save lives. During a run the board is a thing to
read: what it hands out it hands out at the gate.

Nothing caps how much of the board one player ends up owning, and that is **deliberately not
solved**. The check's `whole` probe is the tripwire: 60 runs holding every node, asserting only
that it still terminates and can still be lost. It sits close to its limit already. When it goes
red, that is the day the cap has to be designed, not before.

## Architecture

**The seam is `src/sim/` vs everything else.** The sim imports no Pixi and touches no DOM, so
it runs headless under `node` and balance can be measured apart from whether the game looks
right. Keep it that way - a Pixi import in `src/sim/` breaks both check scripts.

- `src/sim/game.ts` - all behaviour. `advance(g, ticks)` is the only clock. `HELD`
  (MAX_SAFE_INTEGER) is how a won room waits for the player instead of timing out.
- `src/sim/data.ts` - types plus `TUNING`, the single bag of balance numbers, the `CREATURES`
  templates (family, tier, glyph, colour, ability, what it `rises` as) and the `KINDS` table
  that makes a room a theme. Numbers and templates only; no behaviour. Adding a creature = one
  row in `CREATURES` with a colour nothing else wears; adding a room = one row in `KINDS`.
- `src/sim/tree.ts` - the neutral board as data, plus `Perk`/`Perks`/`PERK_IDS`, which both
  halves share. `LAID` is written out cell by cell because the board shape *is* the data:
  `linksOf` derives edges from adjacency, `depthOf` from distance to root. Adding a node = one
  row in `LAID`. Adding a *perk* = a key in `Perk`, a string in `PERK_IDS`, and exactly one read
  site in `game.ts`.
- `src/sim/powers.ts` - the draft pool and the three arms (`ArmId`/`ARMS`/`ARM_IDS` live here,
  not on the tree). Adding a card = one row in `POWERS` with both a `note` and a `desc`, keeping
  the six-and-two-per-arm shape the check holds it to.
- `src/sim/lore.ts` - the story pieces, spread over the map at generation and queued when he
  walks into the room himself.
- `src/sim/rng.ts` - mulberry32 with **module-global state**, mirrored into `g.rng` every step
  and restored by `load()`. Two `GameState`s in one process share the stream, which is why the
  probe bot in `check-sim.ts` runs its runs sequentially.

`GameState` is plain JSON, saved to `localStorage`. When its shape changes, bump
`SAVE_VERSION` **and** add the field to `REQUIRED` in `game.ts` - a save that half-loads
crashes the first frame. `Meta` is the other save and versions separately on purpose; a bad
one falls back to `newMeta()` rather than refusing to load, because a board is not worth
crashing over.

**Rendering is a character grid, not a scene.** `src/gfx/grid.ts` keeps two sprite pools (cell
background, glyph) and a char/fg/bg array; screens only ever call `put/fill/text/center`, then
`flush()` pushes tints and textures. A tap becomes a cell with arithmetic (`cellAt`), with no
hit-testing of display objects.

- `src/gfx/glyphs.ts` rewrites the 1-bit sheet's luminance into alpha at load, otherwise
  tinting paints solid squares.
- `src/gfx/surface.ts` is the narrow `Surface` interface the screens draw through, so
  `check-layout.ts` can hand them a recording stub instead of a renderer.
- `src/gfx/crt.ts` is the whole-stage barrel/scanline filter. `bend()` duplicates the shader's
  warp in JS; every pointer release goes through it before `cellAt`, or fingers land off the
  glyph they aimed at. Change the shader's curve math and `bend()` with it.

**Screens draw and register hit zones in the same pass.** `src/ui.ts` has the `Hits`
collector, `sheet()`/`buttons()`/`box()`/`bar()` and the palette `C`; a zone is added by the
code that drew the thing, so it cannot drift. `src/screens/panels.ts` builds every sheet's
text as a `Spec` at a known width, which is what lets `check-layout.ts` hold all panels to the
narrowest supported grid. `src/screens/tree.ts` draws the board itself rather than going
through `sheet()`.

**`src/main.ts` is the only place the two halves meet.** Taps become an `Act` union
(`src/ui.ts`), the switch in `onAct` calls one sim function per act, and the ticker owes
`TICK_MS` ticks scaled by the speed control. Sound is driven off a snapshot diff of the
*visible* state (`hear()`), not from the sim, so a frame that ran ten ticks still makes one
noise. `src/sfx.ts` synthesizes every sound at runtime through WebAudio - nothing to load.

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
- In dev, `window.app/grid/run()/ui/hits/tap/crt` are exposed for Playwright - read the live
  run with `browser_evaluate` rather than squinting at screenshots.
