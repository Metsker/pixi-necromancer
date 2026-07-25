# Gravelight

A necromancer walks down through a buried reliquary, raising what his enemies
leave behind. It runs in real time: a grid of rooms you drag around, and fights
you can open and watch while everything else keeps going. Built with
[PixiJS](https://pixijs.com) v8 and the
[Dungeon Mode](https://datagoblin.itch.io/dungeonmode) tileset. Mobile first.

Play: https://metsker.github.io/pixi-necromancer/

## How it plays

The map is a grid of rooms joined north, south, east and west, with holes
punched through it - a cave-in is only allowed where it cuts nothing off. A room
is **locked** until something beside it is cleared, then it is **open**, then it
is **cleared**. It is wider and taller than any phone, so you drag it around.

Nothing waits for you. The clock runs at x1, x2 or x4, or you hold it, and any
sheet you have to answer stops it by itself.

You go in **alone** - the necromancer is not a party, he is one very hard thing
to kill, and he rests off every wound in a room he takes. What he raises waits
with him as a **reserve**, and the reserve is what squads are made out of.

Point a squad at any open room and it goes. It fights, and if it wins it walks
to the nearest room still worth taking and fights again, until there is nothing
left of it. You can have several out at once, all running while you take a room
of your own. They never come back - but every corpse they raise reports to you,
which is what makes an expedition a supply line rather than a funeral.

A room you leave standing does not stay the size you found it. That is the only
clock pressure there is, and it is what makes spending a squad worth it.

Every room won pays experience and crafting materials that nothing spends yet.
Some rooms give up a piece of the story, and a squad finds those too.

Fights resolve on their own, your side on the left and theirs on the right. Your
side is commanded and focuses whatever is nearest to dead; theirs is not
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

- `src/sim/` - state and rules, no renderer. One `advance(g, ticks)` drives
  every force on the same clock. Runs headless under `node`.
- `src/gfx/` - the glyph atlas and a character grid built out of Pixi sprites.
- `src/screens/` - map, the battle you drill into, and the sheets that overlay them.
- `src/ui.ts` - palette, tap zones, sheet and button drawing.
- `scripts/check-*.ts` - assertions, run by `npm run check`.

The seam between `src/sim/` and everything else is the point: balance can be
measured apart from whether the game is any fun. `scripts/check-sim.ts` ends with
a bot that throws squads at the shallowest rooms and walks itself into the
deepest - the floor of play, not the ceiling. It is also what caught the version
of this game where sending a squad was always the wrong move.
