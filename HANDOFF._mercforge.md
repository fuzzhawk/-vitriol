# MERC FORGE — handoff

Procedural spritesheet generator for an Abuse-style run-and-gun, plus a playable demo level.
This doc is written for picking the project up cold in Claude Code and growing it into a full game.

**Current state:** working generator + demo, validated by a Node harness. Not a game yet — no
enemies worth the name, no weapons pickups, no level format, no audio.

---

## 1. Files

| File | What it is |
|---|---|
| `mercforge.html` | The whole tool. ~1160 lines, single file, vanilla Canvas 2D, zero deps. Open directly in a browser, no server needed. |
| `harness.js` | Node validator. Runs the generator headlessly against `@napi-rs/canvas`, asserts sprite invariants, simulates 30s of play, dumps inspection PNGs. |

```bash
npm install @napi-rs/canvas
node harness.js          # prints checks, writes out_*.png next to it
```

`harness.js` works by string-splitting the `<script>` block out of the HTML, stubbing a minimal
`document`, and `new Function`-ing it with an appended `module.exports` line. **If you split the
HTML into modules, that extraction breaks** — see §7.

---

## 2. Generator pipeline

```
params (P)
  -> pose(state, frame, nFrames, aimRad)     skeleton anchors in local units
  -> drawChar(ctx, pose, palette, opts)      vector-ish shapes, 2-bone IK, returns muzzle point
  -> [measure pass]                          union bbox of every frame -> tight cell + anchor
  -> draw all frames into one sheet canvas
  -> rasterise(sheetCtx, w, h, palette)      one pass over the whole sheet
       alpha cut (>114)  ->  nearest-palette snap  ->  edge shading  ->  outline dilate
  -> SHEET {canvas, CW, CH, cols, angles, anchor, muzzle, colOf, framesOf, fpsOf}
```

**Local space convention:** feet at `y = 0`, up is `-y`, character faces `+x`. Everything in
`pose()` and `drawChar()` is in that space and in pixel units scaled off `P.height`. The caller
translates to `(anchor.x, anchor.y)` inside the cell.

### Sheet layout

- **Columns = animation frames**, concatenated in `states()` order:
  `idle 4 @6fps · run N @14 · jump 2 @9 · fall 2 @9 · land 1 @8 · crouch 2 @5` (N = `P.runFrames`, 6/8/10/12)
- **Rows = aim angles**, `P.aimRows` of them (5/9/13/17), evenly spanning **−90°…+90° inclusive**.
  Odd counts are deliberate: they include exact horizontal, which is the pose you look at most.
- Left-facing is a **runtime mirror**, so one hemisphere covers full 360° aiming.

### Cell size is measured, not computed

`measureCell()` stacks *every* frame into one oversized canvas without clearing, reads the alpha
union bbox in a single `getImageData`, and derives `CW`, `CH`, `anchor` from it. It also stamps a
2px dot at each muzzle point so the bbox contains bullet spawn positions.

This exists because the analytic version was wrong twice: boots clipped the cell floor, and a rifle
aimed straight down while crouching ran off the bottom. Any new gear (crest, antenna, backpack,
longer weapon) is handled for free. **Don't replace it with arithmetic.**

`boxCache`/`geoKey()` skips the measure pass when only colours changed — colours never move a
pixel. If you add a param that affects *geometry*, add it to `geoKey()` or you'll get stale cells.

---

## 3. Invariants that will bite you

1. **`pad >= 2` around each cell.** The whole sheet is rasterised in one pass, so one cell's outline
   dilation must not reach its neighbour. Outline expands 1px; pad 2 keeps it contained. If you add
   a thicker outline or a glow/dilate step, increase the pad or go back to per-cell rasterising.
2. **Nothing may be thinner than ~2px.** The shading pass turns any pixel with transparency above it
   into the *light* palette variant. A 1px-tall feature becomes 100% rim light and reads as a pale
   scratch — this is exactly what made the rifle barrel disappear. All weapon parts now clamp:
   `Math.max(2, ...)`. Apply the same when adding parts.
3. **Outline colour is excluded from palette matching** (`pal.matchCount`), otherwise dark suit
   pixels snap to the outline colour and the silhouette goes muddy.
4. **The demo blits from the sheet.** It never draws the rig live. Keep it that way — it's the only
   thing proving the export is actually usable.
5. **Fixed 60Hz step.** `loop()` accumulates and calls `update(1/60)` up to 4 times per frame.
   Physics constants are per-step, not per-second. Don't mix in `dt`-scaled movement.

---

## 4. Sheet contract (how a game consumes this)

The JSON export is the contract. Schema:

```jsonc
{
  "generator": "MERC FORGE", "seed": 4771,
  "cell": { "w": 38, "h": 52 },
  "anchor": { "x": 14, "y": 47 },        // feet-centre inside the cell
  "sheet": { "w": 646, "h": 468, "cols": 17, "rows": 9 },
  "rowsAreAimAngleDegrees": [-90, -67.5, ... 90],
  "columns": [{ "index": 0, "state": "idle", "frame": 0 }, ...],
  "animations": [{ "id": "run", "frames": 8, "fps": 14, "loop": true, "firstColumn": 4 }, ...],
  "muzzleOffsets": [[{ "x": 27.4, "y": 22.3 }, ...]],  // [row][col], cell-local
  "params": { ... }                      // full P, so any sheet is reproducible
}
```

Blitting (see `blit()` and `render()`):

```js
// top-left of the cell, so the anchor lands on the player's feet-centre
const x = px - (flip ? CW - anchor.x : anchor.x);
const y = py - anchor.y;

// muzzle in world space
const mx = px + (flip ? -(mu.x - anchor.x) : (mu.x - anchor.x));
const my = py + (mu.y - anchor.y);
```

Row selection: `aimRow(local)` where `local` is the aim angle folded into the facing hemisphere and
clamped to ±90°. Facing only flips when `|dx| > 3` so the sprite doesn't strobe when the cursor sits
directly above the character.

---

## 5. Demo internals

Everything below `/* DEMO */`. It is scaffolding, not a game — expect to replace most of it.

- **View:** 960×540 canvas, `ctx.scale(2,2)`, world view 480×270. Tiles 16px. Level 72×24 tiles,
  built from rects in `buildLevel()`, pre-rendered once to `levelCv` by `paintLevel()` (re-runs on
  palette change).
- **Physics** (per 1/60 step): accel 0.55, max vx 2.6, ground friction 0.80, air 0.90, gravity 0.36,
  terminal 9, jump impulse −6.1, coyote 8 steps, crouch multiplier 0.55.
  Hitbox `w = max(6, H*0.32)`, `h = H*0.90` — derived from `P.height`, so it tracks the sprite.
- **Collision:** `moveBox()` — axis-separated AABB against the tile grid, sampled every 5–6px along
  each edge. Tolerable at this size; it will tunnel at high speed. Replace with swept AABB before
  adding dashes, knockback, or fast projectile-riding.
- **Weapons:** fire rates `{pistol .22, smg .075, rifle .11, cannon .42, beam .06}`, bullet speeds
  `{beam 9, cannon 4.2, else 6.4}`, 2 substeps per bullet per frame for tile hits.
- **Bots:** 3 HP, drift horizontally, reverse at walls. Placeholder.
- **Camera:** lerped, biased toward the cursor (~20%), clamped to level bounds. Shake on fire.

---

## 6. Known rough edges

- Aiming straight up crowds the head against the arms below ~26px height. `pose()` already pulls the
  head back by `steep * headR * 0.45`; going further starts to look broken. A dedicated up-aim arm
  pose is probably the real fix.
- Rebuild at max settings (46px, 17 rows, 12 run frames = 391 frames) is ~400ms in Node, so slider
  drags get chunky at the extreme end. Debounce is 70ms. If it matters, rasterise into a Worker or
  regenerate only the visible aim row while dragging.
- The randomizer can still produce heavy-limbed silhouettes where the head merges into the torso at
  small heights. Ranges were tightened once; a proportion-coherence pass would do better.
- `land` state only triggers from a near-idle landing, so it rarely shows while running. Intentional
  for now, but it means one column is nearly dead weight.
- Bot respawn reads `e.hx` which is never set, so bots respawn in place. Harmless, but it's a stub.
- The `bullets connected with bots` harness check is stochastic (bullet spread + bot placement use
  `Math.random`). It can flake. Everything else is deterministic.

---

## 7. Suggested repo shape for the game

The single-file constraint is right for a *tool*; it fights you for a *game*. Proposed split:

```
/tools/mercforge.html          # keep single-file, it's the authoring tool
/tools/harness.js              # keep pointed at the tool
/src/
  sprite.js                    # SpriteSheet loader: PNG + JSON -> blit(), rowFor(aim), muzzle()
  physics.js                   # swept AABB, tile grid
  player.js                    # state machine, aim, weapons
  weapons.js                   # data-driven weapon defs (the gunSpec table is the seed of this)
  enemies.js
  level.js                     # level format + loader
  render.js                    # camera, layers, particles
  main.js
/assets/sprites/*.png + *.json # generator output, committed
index.html
```

Two viable paths for sprites, worth deciding early:

- **Bake:** run the generator, commit PNG + JSON, load at runtime. Fast boot, deterministic, easy to
  hand-touch pixels later. Best for the hero.
- **Generate at runtime:** import `buildSheet()` as a module and make sheets on load from a seed.
  Gets you palette-swapped enemy variants and per-run character generation for free. Costs ~70ms per
  sheet, so it's fine for a handful, not for dozens.

Realistically: bake the player, generate enemies from seeds.

The extraction trick in `harness.js` assumes one `<script>` block. If you modularise, convert the
generator to an ES module with a real export and have both the tool and the harness import it —
that's the cleaner end state anyway.

---

## 8. Build order I'd suggest

1. **Extract the sheet consumer first.** `sprite.js` that loads PNG + JSON and exposes
   `blit(ctx, state, frame, aimRad, x, y, flip)` and `muzzle(...)`. Prove it by making the current
   demo use it instead of its inline `blit()`. That locks the contract before anything depends on it.
2. **Swept AABB collision.** Do this before movement gets interesting; retrofitting hurts.
3. **Level format.** Tiled JSON, or a plain tile array + entity list. The rect-based `buildLevel()`
   is a placeholder that will not survive real level design.
4. **Weapon data table** — lift `gunSpec()` into shared data so a weapon's *sprite* and its
   *behaviour* come from one definition (fire rate, damage, spread, projectile, muzzle offset).
5. **One real enemy** with the same rig: enemies can use the same generator with a different seed and
   an AI state machine driving the same animation table. This is the payoff of the row/column layout.
6. Then: hit reactions, death animation (new state = new columns), doors/switches, audio.

Adding a new animation state is one entry in `states()` plus a branch in `pose()`. The sheet, the
JSON, the preview state bar and the column map all follow automatically — that's the seam designed
for growth. Adding a new *aim* dimension (e.g. separate legs/arms layers) is a much bigger change:
it means splitting the sheet into two aligned sheets, which would cut frame count from
`states × angles` to `states + angles`. Worth considering if the sheet gets big.

---

## 9. Context for whoever picks this up

- Conventions this project follows: single self-contained HTML output, vanilla Canvas 2D, no
  dependencies, deterministic seeded RNG, Node test harness for validation before shipping.
- Every visual decision here was verified by rendering PNGs headlessly and looking at them. The three
  bugs that mattered (feet clipping the cell, sub-pixel barrel washing out, torso leaning into the
  aim instead of counterweighting) were all invisible in code review and obvious in a contact sheet.
  **Keep dumping contact sheets.** `out_run.png`, `out_aim.png`, `out_states.png`, `out_random.png`
  and `out_demo.png` are the ones that earned their keep.
