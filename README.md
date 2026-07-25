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

You come in at the middle of it and it gets worse the further out you go. The
Ossuary waits at whatever room stands furthest from the way in.

Nothing waits for you. The clock runs at x1, x2 or x4, or you hold it, and any
sheet you have to answer stops it by itself.

You walk in with whatever you have not sent away, and a room you take is a room
you rest in - everyone who walks out of it walks out whole. Only what he is
standing over gets up, and only he reads the walls: a room a squad took keeps
its piece of the story until he goes through it himself.

A fight of your own opens on screen by itself: two ranks facing off across a
dark room, stepping in to swing and knocked back when a blow lands, with the
health of both sides under them.

Point a squad at any open room and it goes. It fights, and if it wins it walks
to the nearest room still worth taking and fights again, until there is nothing
left of it. You can have several out at once, all running while you take a room
of your own. They open the map and bring back experience, and that is all they
bring back: they leave the dead where they lie, and they have nothing to say.

Every one you send is one fewer beside you, so a squad is a thing you spend,
not a thing you invest. The bot in `scripts/check-sim.ts` measures holding the
army as the stronger line; sending is a judgement about a room you think you can
spare the bodies for.

A room you leave standing does not stay the size you found it. That is the only
clock pressure there is, and it is what makes spending a squad worth it.

Every room won pays experience and crafting materials that nothing spends yet.
Some rooms give up a piece of the story when he takes them.

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
