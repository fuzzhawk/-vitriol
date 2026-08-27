# GREEBLEWORKS — handoff

Procedural texture foundry and side-scroller level generator. Single self-contained
HTML file, vanilla Canvas 2D, zero dependencies, deterministic seeded RNG, runs
offline from `file://`.

Current build: `greebleworks.html`, ~220 KB, one `<script>` tag.

---

## 1. What exists

Five modes in one app, selected from the mode bar:

| Mode | Produces |
|---|---|
| **Facades** | Seamless wall tiles (64–256²) or large non-tiling panels (up to 384×768), plus an 8-variant sheet |
| **Platforms** | Horizontally seamless deck tiles in 5 builds, plus rooftop trim (alpha above the parapet) |
| **Decals** | 8 billboard types pasted over walls, 2 of which punch see-through holes |
| **Sky & city** | Noise sky + 2–5 parallax city silhouette layers, all horizontally seamless |
| **Level** | Bakes everything above, lays out a side-scroller, plays it with 7-layer parallax |

Everything is driven by one seed. The same seed reproduces the same output exactly.

---

## 2. The core idea

Every texture is drawn at high resolution into **three buffers**, then lit and crushed:

```
albedo (colour, RGBA)      ─┐
height (greyscale, BASE=128)├─→ lightPass() ─→ grime ─→ crush() ─→ output tile
emissive (glow, RGBA)      ─┘
```

- **`lightPass`** derives normals from the height buffer with a Sobel-ish difference,
  applies Lambert + cavity AO (from a heavily downscaled blurred height copy) + a tight
  Blinn spec, then adds the emissive with a blurred bloom pass. This is why pipes look
  round and greebles catch light — the 3D read is real, not painted.
- **`crush`** halves the image repeatedly with smoothing, then applies grain, a contrast
  punch, 8×8 Bayer dithering and nearest-palette quantisation. **The pixel-art look comes
  from the downscale, not from drawing chunky.** Design at 4–6× and let the crush do it.

If you add a new generator, follow this shape. Don't hand-shade — write height.

---

## 3. Getting the source into modules

The shipped file is a concatenation. Section banners mark the boundaries, so you can
split it back into editable modules and rebuild with `cat`. Run this once:

```bash
mkdir -p src && python3 - <<'PY'
import re
s = open('greebleworks.html').read()
head, rest = s.split('<script>\n"use strict";', 1)
js, tail = rest.rsplit('</script>', 1)
open('src/00-shell-head.html','w').write(head + '<script>\n"use strict";')
open('src/99-shell-tail.html','w').write('</script>' + tail)

# (banner text, output filename) in file order
marks = [
 ("GREEBLEWORKS — procedural cyber facade textures", "10-core.js"),
 ("EXTENDED DATA",   "20-data.js"),
 ("SHARED PIPELINE", "30-pipeline.js"),
 ("DRAWING KIT",     "40-kit.js"),
 ("ROOF TRIM",       "50-roof.js"),
 ("FACADE GENERATOR","60-facade.js"),
 ("BILLBOARD DECALS","70-decals.js"),
 ("SKY + CITY",      "80-sky.js"),
 ("LEVEL GENERATOR", "90-level.js"),
 ("   UI\n",         "95-ui.js"),
]
idx = [(js.index(m[0]), m[1]) for m in marks]
starts = [js.rfind('/* =', 0, i) for i, _ in idx]   # banners open 2 lines above
starts[0] = 0                                        # keep everything before banner 1
for k, (st, (_, name)) in enumerate(zip(starts, idx)):
    end = starts[k+1] if k+1 < len(starts) else len(js)
    open('src/'+name, 'w').write(js[st:end])
print('split ok')
PY
```

Note the drawing kit and the platform generator share one banner region — `40-kit.js`
will contain `makeKit`, `drawGreeble` **and** `bakePlatform`. Split further by hand if
you want them apart.

Rebuild:

```bash
cat src/00-shell-head.html src/[0-9]*.js src/99-shell-tail.html > greebleworks.html
```

This round-trips byte-identically — verify with `cmp` after the first split before you
start editing.

Concatenation order matters only for top-level `const` data (`PALETTES`, `STYLES`,
`BASE`, `LV`, `WIRE_STYLE`, `SKYMOODS`, `CITY_PRESETS`, `DECAL_KINDS`). Functions hoist,
so generator files can be reordered freely. `20-data.js` must follow `10-core.js`
because it `Object.assign`s onto `PALETTES` and `STYLES`.

---

## 4. API reference

All bakers are **generators**. They `yield` a progress string per stage and `return` a
result object. Drive them with `while(!(r = gen.next()).done) {}` then read `r.value`.

```js
function* bakeFacade(cfg)   → {final, albedo, height, emissive}
function* bakePlatform(cfg) → {final, albedo, height, emissive, kind}
function* bakeRoof(cfg)     → {final, albedo, height, emissive, kind:'roof', capY}
function* bakeDecal(cfg)    → {final, hole|null, albedo, height, emissive, kind, label}
function* bakeSky(cfg)      → {final, sky, city, layers[], far, near, mood, sunX, sunY}
function* buildLevel(cfg)   → L (see §6)
```

Supporting:

```js
makeRng(seed)                     → {rnd, range(a,b), int(a,b), pick(arr), chance(p), sign()}
fbmField(rng, w, h, baseRes, oct) → Float32Array, tileable value-noise fBm
sampleField(f, w, h, x, y)        → bilinear, wrapping
lightPass(A, Hc, E, W, H, cfg, u) → lit canvas
crush(src, outW, outH, cfg, alphaMode) → quantised canvas
snapLayer(canvas, cfg, ditherAmt) → re-quantise a composed layer in place
makeKit(ca, ch, ce, W, H, TX, TY, u, rng) → {place, R, hBox, bolt, hazard, pipe, ledges, metalZones}
tileSpan(fw, want)                → snaps a sampling span to whole noise periods
```

**`crush` alpha modes:** `false`/omitted = force opaque · `true`/`'clip'` = threshold at
110 · `'dither'` = Bayer-dither the alpha so feathered edges dissolve into the wall.
Decals use `'dither'`; roofs and city layers use `'clip'`.

**`makeKit` conventions:**
- `place(x, y, w, h, fn)` wraps a draw across the seam when `TX`/`TY` are set. Every
  element that can touch an edge of a tileable texture **must** go through it.
- `hBox(x, y, w, h, to, ramp, from)` writes a bevelled box into the height buffer.
  `BASE` (128) is the flat wall. Raise for proud geometry, lower for recesses.
- `K.ledges` / `K.metalZones` are collected during drawing and consumed by the grime
  pass — push to them whenever you add a horizontal surface or a metal object, and
  streaks and rust appear for free.

---

## 5. The config object

One flat object drives everything; `readCfg()` in the UI builds it from the controls.
Sliders are 0–200 in the DOM and divided by 100, so **1.0 is the neutral value**.

```
outW, outH, SS          output size and supersample factor (bake size = out × SS)
tileX, tileY            seam wrapping per axis
seed                    uint32
style                   key into STYLES (14)
palette                 key into PALETTES (21) or 'none'
dither                  0–1.5

greeble pipes windows neon      density multipliers
grime wear relief lightdir      surface + lighting (lightdir in degrees)

platKind                auto|concrete|grating|catwalk|deck|pipes|roof

skyMood                 key into SKYMOODS (15)
cloud glow horizon weatherAmt
cloudScale cloudStretch cloudSharp cloudDetail cloudTurb cloudHeight

cityLayers (2–5)  cityDens cityMass cityVar cityWidth cityOverlap
cityHaze cityContrast cityDetail cityWin citySkyway cityRuin cityLights cityBlimps

decalKind               auto | one of DECAL_KINDS
decDens decOpen decMach decOrg          amount + category weights
decTexture decGrime decDither decBlend

levelLen (screens)  floatDens propDens propGrime fog speed
weather                 auto|rain|ash|none
wireDens wireStrands wireSag wireDrops
```

Data tables you'll extend:

```js
PALETTES      21 sets incl. 5 high-contrast CRT/mono sets. Values must be #rrggbb;
              a filter drops malformed entries and rebuilds PAL_RGB.
STYLES        14. Each: concrete[] metal[] accent[] neon[] glass win{} mul{} floorH[] colW[] moss graffiti
SKYMOODS      15. Colour ramp + ember/rain/ash/stars/corona + cl{} cloud-shape defaults
CITY_PRESETS  15 named skyline setups, values in slider units
DECAL_KINDS   ['tunnel','junction','growth','vent','collapse','shrine','graffiti','escape']
DECAL_CATS    {openings, machinery, organic} — the three level mix sliders
WIRE_STYLE    per-style cable character {d, s, g, p}; arcology is 0 (no wires)
```

Adding a palette or style is data-only — no code changes. Adding a decal means writing
a `drawX()` inside `bakeDecal` and registering it in the `DRAW` map, `DECAL_KINDS`, a
`DECAL_CATS` bucket, and the dropdown.

---

## 6. Level data — this is what a game hangs off

`LV = {W: 448, H: 252}` is the internal render resolution. Everything is drawn at 1:1
into that and upscaled with nearest-neighbour, so **level-space units are pixels**.

`buildLevel(cfg)` returns:

```js
{
  LW,            // level width in px = LV.W * levelLen
  plats: [{x, y, w, ground:bool, thin?:bool}],   // y is the TOP of the deck surface
  lights: [{x, y, r, c:[r,g,b], fl, ph}],
  fg: [ {k:'pipe',x,w} | {k:'rail',x,w,y} |
        {k:'cable',x,strands:[{x0,x1,sag,w,knots[],drops[],heavy}],tie} ],
  parts: [...], wk: 'rain'|'ash'|'none',          // weather
  playC,         // pre-rendered gameplay layer, LW × LV.H, RGBA
  wallC,         // pre-rendered back wall, (LW*0.45 + LV.W) × LV.H
  sky, cityLayers[], far, near,                    // LV.W × LV.H, tile horizontally
  walls[8], roofs[2], platTile, thinTile, decals[], M, mood
}
```

**`plats` is your collision data already.** A deck is a one-way platform: the surface is
at `p.y`, spanning `p.x` to `p.x + p.w`, `platTile.height` (20px) thick, `ground:true`
means solid mass continues to the bottom of the frame. Gaps between ground runs are
pits. Layout guarantees step changes of ≤2 grid units (G=8) and floating decks sit
between 24% and 60% of frame height.

Parallax factors in `drawLevelFrame(L, cfg, ctx, scroll, time)`:

```
sky 0.04 · city layers 0.08 → 0.28 · back wall 0.45 · play layer 1.00 · foreground 1.45
```

`scroll` is level-space px, clamped to `[0, LW - LV.W]`. To drive it from a player
instead of the auto-pan, replace the `loop()` scroll integration in the UI section with
a camera that follows the entity.

---

## 7. Testing

Two Node harnesses, no browser and no dependencies. Both stub Canvas 2D, so they verify
that generators **run to completion without throwing and produce sane structures** —
they can't verify pixels.

```bash
node harness.js    # 147 checks: every palette, style, mood, city preset, decal kind,
                   # roof, wire profile, and full level builds with frame renders
node uitest.js     # 15 checks: DOM shim drives the real UI — bake driver, mode
                   # switching, pop-out lifecycle, fullscreen, mood presets
```

The canvas stub throws on non-finite coordinates, negative radii and out-of-range
gradient stops, which is how most real bugs surfaced. **When you add drawing code,
extend the stub if you use a Canvas2D method it doesn't have** — three times a "failure"
was a missing stub method (`rotate`, `ellipse`), not a bug. Check that first.

The DOM shim coerces `.value` and `.textContent` to strings like the real DOM does.

---

## 8. Gotchas

- **Seams.** Anything drawn on a tileable texture must go through `K.place()`. Noise is
  tileable by construction (lattice wrap); if you sample it with a custom scale, snap
  the span with `tileSpan()` or you'll get a discontinuity at the wrap — that exact bug
  was in the sky for several revisions.
- **Bayer alignment.** Decal art and its hole mask are dithered from the same shape at
  the same canvas-local coordinates, so pasting both at the same `(x,y)` gives
  complementary patterns with no seam. Don't offset one without the other.
- **Bake size cap.** Auto supersample targets ~1536px (1024 for sky). 2048² per buffer
  is about the practical ceiling — three buffers at 4096² is 200 MB.
- **A level bake is ~13 sub-bakes** (8 walls, 2 roofs, 2 decks, sky+city, 3–9 decals).
  The driver `runJob()` pulls generator steps until a 32 ms frame budget is spent, which
  is what keeps the UI alive. Keep new bakers yielding at stage granularity.
- **`LEVEL` survives non-level bakes** on purpose, so the popped-out window keeps
  playing while you tweak textures. Don't null it.
- Emissive drawn outside the albedo silhouette will glow in empty space — `'lighter'`
  adds alpha. Mask it with the same shape.

---

## 9. Where to take it

The generator side is done enough. The gap to a game is the entity layer.

**First refactor.** Split bake from play. Right now `buildLevel` bakes assets *and* lays
out the level. Separate them: an asset bake step that emits a manifest, and a layout
step that consumes it. Then levels become JSON you can hand-edit and version, and the
expensive bake can be cached or moved to a Worker.

**Export path.** Add a level export that writes `{seed, cfg, plats, lights, props}` as
JSON plus the baked tiles as PNGs. That's the boundary between this tool and the game —
the game should load a manifest, not run the generator at boot.

**Characters.** Creature Forge already does 8-directional JRPG sprite sheets with
PNG/JSON export. That's the natural source for the player and enemies here, and both
tools speak the same seeded-RNG, single-file Canvas dialect. The main work is a shared
sprite-sheet JSON schema so a Creature Forge export drops straight into a
`drawSprite(sheet, frame, x, y)` in this renderer. Worth defining that schema before
writing the entity code, so the two tools stay compatible.

**Physics.** Side-scroller AABB against `plats`: one-way from above for `ground:false`
decks, solid for `ground:true` mass. Ladders already exist visually in the play layer
but aren't in the data — add them to the returned structure when you need climbing.

**Rendering.** `drawLevelFrame` already composites 7 layers per frame from pre-rendered
canvases; adding an entity pass between the play layer and the foreground is a few
lines. Keep entities at the same 1:1 internal resolution so the nearest-neighbour
upscale stays crisp.

**Deployment.** Single-file output with no dependencies works as-is on Netlify from a
GitHub repo, same as the rest of the ecosystem. If the split-to-modules build sticks,
add the `cat` step as a Netlify build command so the repo keeps the readable source and
the deploy stays one file.
