# VITRIOL

A procedural industrial side-scrolling shooter. Every wall, deck, skyline, sign,
cloud and merc in the game is generated at runtime from a build seed — no art is
shipped with it.

It is built on two existing generators, kept intact as authoring tools and
consumed by the game as libraries:

| | |
|---|---|
| **GREEBLEWORKS** | procedural texture foundry + side-scroller level generator |
| **MERC FORGE** | procedural spritesheet generator for the run-and-gun rig |
| **CRAWLER FORGE** | procedural eldritch crawlers — meat, metal and tentacles |
| **SCRAP FORGE** | procedural physics debris — crates, drums, rubble |

## Play

Open `index.html` in a browser. No build step, no dependencies, no server.

```
A / D          move
W / SPACE      jump — press again in the air for a second, weaker kick
S              crouch — hold and jump to drop through a catwalk
MOUSE          aim (full 360°)
LEFT CLICK     fire
R              reload
ESC            pause
M              mute
```

Fight east to the extraction pad. A heavy is always posted on it.

## The two build paths

The launch screen leads to **BUILD**, which offers exactly two ways in:

**RANDOMIZE** — one seed rolls the whole run: architecture, palette, sky mood,
skyline, weather, level length, and the operative you play as. The roll is
*coherent* rather than uniform: `STYLE_AFFINITY` in `src/game/config.js` pairs
each of the 14 architectures with the sky moods, skylines and palettes it belongs
under, so a random level looks deliberate instead of like a slot machine.

**CUSTOM BUILD** — both generators opened up.

- **LEVEL · GREEBLEWORKS** — ~60 controls across World, Surface, Sky, Skyline,
  Decals and Terrain, including all 15 city presets.
- **OPERATIVE · MERC FORGE** — frame, gear, weapon, palette, motion and sheet
  controls with a live animated preview.
- **CRAWLERS · CRAWLER FORGE** — body, meat and metal, flesh, surface, tentacles
  and palette, with a live preview of the thing hauling on its limbs. Leave it
  unpinned and each level grows its own crawlers coloured to suit the
  architecture; tick **use this exact build** and every crawler in the run is
  the one you designed.
- **DEBRIS · SCRAP FORGE** — size, palette and surface for the crates, drums and
  rubble scattered through the level, with all six kinds previewed and their
  wrecked states ghosted behind them.

The last two panels are generated directly from their tool's own `CONTROLS`
table, so the tools and the game cannot drift apart. The harness asserts every
control names a parameter the generator actually reads — a slider wired to
nothing is silent otherwise.

Your operative's weapon is not cosmetic: the gun MERC FORGE draws in their hands
is the gun you fire, with its own fire rate, damage, spread, magazine and sound.

Every build is reproducible from its seed, shown on the debrief screen.

## Repo shape

```
index.html              the game shell — screens, styling, script order
src/gen/                GENERATED generator cores (see below)
  greebleworks.js
  mercforge.js
  crawlerforge.js
  scrapforge.js
src/game/
  config.js             level + merc configs, coherent randomizer, archetypes
  audio.js              procedural WebAudio SFX and ambience — no samples
  weapons.js            one definition per weapon: sprite AND behaviour
  sprite.js             MERC FORGE sheet consumer (blit / aim row / muzzle)
  physics.js            swept AABB against the generator's `plats` data
  rigid.js              impulse solver for the debris
  entities.js           player, enemy AI, projectiles, pickups
  world.js              mission build generator + simulation
  render.js             entity pass, HUD, overlays
  screens.js            control-schema UI builder for both generator panels
  main.js               app state machine, input, fixed-step loop
tools/
  greebleworks.html     the authoring tools, standalone and single-file
  mercforge.html
  crawlerforge.html
  scrapforge.html
  extract.js            slices the generator cores out of the tools
  harness.js            the original MERC FORGE validator
  harness-game.js       validates the game layer + dumps contact sheets
docs/                   the original handoff documents
```

### src/gen is generated

The tools stay single-file — that is right for a tool and wrong for a game. The
game needs the generators without their UI, and needs both loaded side by side,
which they cannot be as-is: both declare `clamp` at top level. `tools/extract.js`
slices each generator core out of its tool and wraps it in an IIFE published
under one global.

```bash
node tools/extract.js     # re-run after editing either tool
```

The extractor also adds the one thing the game needs from the compositor: an
optional `entityPass` hook in `drawLevelFrame`, called between the play layer
and the foreground so entities are lit by the level's lamps and occluded by its
cabling.

Do not hand-edit `src/gen/*.js` — edit the tool and re-extract.

## Testing

```bash
npm install @napi-rs/canvas
node tools/harness-game.js     # or: npm test — ~14,900 checks + contact sheets in out/
node tools/harness.js          # the original MERC FORGE validator
```

`harness-game.js` runs the real game code headlessly against a canvas
implementation: it builds an actual mission, asserts collision behaviour
(one-way decks, drop-through, terminal-velocity tunnelling, line of sight),
simulates 30 seconds of play checking invariants every step, verifies the damage
path in both directions, and writes contact sheets to `out/`:

| file | what it proves |
|---|---|
| `out_game.png` | three composited gameplay frames across the level |
| `out_collision.png` | `plats` collision data drawn over the baked play layer |
| `out_cast.png` | the player rig beside all four hostile archetypes |
| `out_aim.png` | every aim row of the player sheet, -90° to +90° |
| `out_crawler.png` | crawlers in a level, mid-fight, with slime and chunks |
| `out_crawler_surfaces.png` | one crawler seated on floor, both walls and ceiling |

Per the MERC FORGE handoff: keep dumping contact sheets. `out_collision.png` in
particular is the one that catches layout bugs — misaligned collision is
invisible in code review and obvious in a PNG.

## The Overlord, the debris, and the rot

**The prototype.** One weapon is rolled per run from the build seed and left on
a lit pedestal on the last ground before the boss. Ten parameters — rate,
damage, speed, projectile count, spread, pierce, splash, homing, ricochet and
arc — plus a generated name, a tint, and which of the five base shapes the merc
holds. The ten are not independent knobs: the roll spends a fixed budget across
them, so taking more of one thing gives way somewhere else. That is what makes
a prototype interesting rather than simply better. A second player rig is forged
during loading holding it, so picking it up swaps the sprite instead of stalling
the frame on a re-forge mid-fight.

**SCRAP FORGE** bakes the physics props: crates, drums, concrete slabs, girder
offcuts, scrap bales and torn plate, in seven industrial palettes. Two things
make it different from a sprite tool. Its columns are DAMAGE STATES rather than
animation frames — damage is not a crack decal, it chips the silhouette, opens
the seams and takes mass out of the piece — and like CRAWLER FORGE it emits a
physics bake measured off the pixels: hull, half extents, mass, restitution,
friction, hit points and gib seeds. A crate that has been shot twice really does
become a smaller obstacle, because its baked body shrank with its silhouette.

Debris belongs to the level it is in twice over: its base palette is chosen from
the architecture, and the finished sprites are then re-quantised through the
level's own palette with GREEBLEWORKS' `snapLayer`, so they are literally made
of the same colours as the wall behind them. The collision box is also
deliberately inset inside the silhouette — a box that matches the outline
exactly leaves a crate perched with a hairline of daylight under it, and real
debris beds into the ground it lands on.

`rigid.js` is the solver. Not a general engine: boxes with linear velocity,
impulse response, pairwise separation, sleeping, and the material numbers the
generator measured. Bullets shove and damage them, and an off-centre hit imparts
spin. Rotation is deliberately visual only — rotating collision on a 20-pixel
sprite buys nothing the eye can see and costs an SAT solver plus every tunnelling
edge case that comes with it.

**The Overlord** is a crawler that has stopped needing the floor. Same generator,
pushed to the size band where it reads as a mass rather than a creature, and it
hovers instead of anchoring. Three phases: phase one is tentacle lashes, phase
two adds picking a rigid body out of the level and hurling it at you, phase three
does both faster. It vents demonic vapour continuously and drops the good weapon
when it dies.

**Corruption** is a MERC FORGE parameter, not a palette swap: `corrupt` grows a
core through the chest, rot veins out from it, and biotech lumps with tendrils
pushing out through the shell. In game a corrupted merc hovers slightly, vents
vapour, carries a rot-coloured bloom and has more health. How much of a garrison
has been got at scales with difficulty, from 18% on recruit to 62% on vitriol.

The vapour is drawn in two passes — a dark body that eats light, then a dim red
core inside it. Smoke that only added light read as steam; taking light out
first is what makes it read as wrong.

## Design notes

**Collision comes free.** `buildLevel()` already returns `plats` as usable
collision data. `ground:true` runs are solid mass to the bottom of the frame and
collide on every face; the gaps between them are lethal pits. `ground:false`
decks are one-way, landable from above, jumpable through from below, and
droppable through with down+jump. `physics.js` does a real swept test per axis
rather than the tool demo's grid sampling, which the handoff flags as prone to
tunnelling.

**Fixed timestep.** Movement constants are per 1/60 step, not per second, matching
MERC FORGE's demo so the sprite's stride still covers the ground it crosses. Only
animation timers use `dt`.

**One rig per archetype variant.** Forging a sheet costs real time, so hostiles
share rigs: two silhouettes each for grunts and troopers, one for heavies and
drones. All of it happens during the loading screen, which reports genuine
progress from the generator's own yielded stage strings rather than a fake bar.

**Sprite work over cel shading.** MERC FORGE draws at 1:1 rather than
supersampling like the other two generators, and that is deliberate: crushing a
30-pixel character down from 4x softens exactly the silhouette that makes it
readable at gameplay scale. The look comes from the drawing and the shading
instead.

Limbs are tapered quads with a hinge plate at the knee and elbow. They used to
be stroked lines with `lineCap: 'round'` and a uniform width, which is precisely
the fat-noodle read — every limb the same thickness end to end with a ball at
each joint. Boots and gauntlets are angular wedges rather than ellipses, the
shoulder line is squared, and pauldrons are clipped plates.

Shading runs on a five-step ramp per material instead of three. The old pass lit
exactly the topmost pixel of a run and sank the bottom one, leaving everything
between as one flat fill; the new one gives a two-pixel rim, a sinking
underside, a darkened lip where two materials meet, and dithered grit in the
flat mid-tones. Grit is held to the mid-tones on purpose — texturing the rim
and the core shadow as well destroys the form and the sprite comes out as static
with a body-shaped hole in it. The key light is straight down the y axis, since
the sheet mirrors at runtime and any horizontal term lands on the wrong side
half the time.

**Readability over fidelity.** These levels bake walls that are often the same
value as a merc's suit. Actors get a contact shadow to anchor them, and any
hostile that has spotted you carries a faint halo — which doubles as the aggro
tell.

## CRAWLER FORGE

The third generator, and the one that is least like a spritesheet tool.

A crawler is a blob of meat and metal that does not walk. It drags itself
around by throwing tentacles at the terrain and hauling, which means it goes
places a biped cannot: up the vertical face of a ground run, along the
underside of a catwalk, or hanging and swinging from a deck overhead.

**Silhouette.** A metaball sum over scattered lobes, sampled through a domain
warp — the lookup position itself is displaced by fBm — so the contour comes out
chewed and irregular. The first version pushed the *threshold* around instead
and every crawler came out a circle; displacing the domain is what makes them
read as lumps of something rather than blobs of geometry.

**Two sheets, because one cannot be both in front of and behind itself.**

- **Body** — columns are animation frames (`idle`, `pull`, `hurt`), rows are the
  four surface orientations. Orientation is baked rather than rotated at runtime
  because a rotated pixel sprite shears its own dither, and because which way is
  down changes where the drips hang and which side the mass sags toward.
- **Tentacle** — one tapered strip per variant, root at the left, tip at the
  right. At runtime `drawTentacle()` slices it into thin columns and rotates
  each to the local tangent of a quadratic, so a single baked strip covers every
  reach, curl and direction the simulation asks for. It draws *behind* the body.

**The physics bake.** The third output is not pixels. Once the sheet is
rasterised, the silhouette is ray-marched from its own centroid to measure:

| | |
|---|---|
| `hull` | 24-point silhouette polygon |
| `sockets` | where tentacles leave the body, with outward normals from the hull tangent |
| `contacts` | the extreme point in each surface direction, so the blob seats flush |
| `gibs` | interior seed points for the chunks that fly off |
| `eyes` | glow positions the game animates on top of the baked iris |
| `radius`, `mass` | collision and anchor-search geometry |

The simulation therefore reads the shape that was actually drawn. Add a spike,
change the lobe count, swap the palette — the hull, the sockets and the seating
distance all follow, with nothing to keep in sync by hand. The tool's PHYSICS
BAKE view draws all of it over the sprite it was measured from.

**Locomotion.** Each limb independently releases, casts for a grip on whatever
terrain face lies in the direction it wants to travel, and hauls. The body is a
mass hanging off those grips: it springs toward the seat position they imply,
sags under gravity, and free-falls the moment nothing is holding on. Swinging
from an overhead deck falls out of that rather than being a special case.

Two things about this were only obvious once rendered. `surfacesNear()` has to
sample *along* each face rather than returning its nearest point, or a crawler
on a long deck finds nothing beyond its own minimum stride and freezes. And
anchors have to be planted past two body radii, measured against the silhouette
rather than the centre — a limb is drawn from a socket already most of a radius
out, so a closer grip is a stub entirely hidden inside the blob, and the
creature appears to hover with no visible means of holding on.
