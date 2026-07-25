# Gravelight

A necromancer walks down through a buried reliquary, raising what his enemies
leave behind. Two screens: a hex map you drag around and pick your way through,
and an autobattle you watch. Built with [PixiJS](https://pixijs.com) v8 and the
[Dungeon Mode](https://datagoblin.itch.io/dungeonmode) tileset. Mobile first.

Play: https://metsker.github.io/pixi-necromancer/

## How it plays

The map is a hex field twelve rows deep, wider than any phone, so you drag it
around. Every room touches six others. A room is **locked** until something
beside it is cleared, then it is **open**, then it is **cleared**.

You can walk into an open room next to you and fight it yourself, and you can
walk freely over ground already taken. Or you can send a **squad**: pick some
minions, point them at any open room, and they go. If they win they walk to the
nearest room still worth taking and fight again, and again, until there is
nothing left of them. You do not watch and you cannot call them back. What comes
back is a report. That is the trade - minions buy map, and they are spent.

Every room won pays experience, a chance at a corpse to raise, and crafting
materials that nothing spends yet. Some rooms give up a piece of the story, and
a squad finds those too.

Fights resolve on their own, your side on the left and theirs on the right.
Your side is commanded and focuses whatever is nearest to dead; theirs is not
commanded by anybody and swings at whatever is in front of it.

## Running it

```
npm install
npm run dev      # regenerates the tilemap, then serves
npm run check    # typecheck, layout cases, sim assertions, balance probe
npm run build    # check, then bundle to dist/
```

`src/tilemap.ts` and `public/dungeon-mode.png` are generated from `dungeonmode/`
by `scripts/gen-tilemap.mjs` and are not committed.

## Layout

- `src/sim/` - state and rules, no renderer. Runs headless under `node --experimental-strip-types`.
- `src/gfx/` - the glyph atlas and a character grid built out of Pixi sprites.
- `src/screens/` - map, battle, and the sheets that overlay them.
- `src/ui.ts` - palette, tap zones, sheet and button drawing.
- `scripts/check-*.ts` - assertions, run by `npm run check`.

The seam between `src/sim/` and everything else is the point: balance can be
measured apart from whether the game is any fun. `scripts/check-sim.ts` ends with
a bot that walks in alone every time and never sends a squad - the floor of play,
not the ceiling.
