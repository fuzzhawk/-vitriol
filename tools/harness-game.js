/* ============================================================
   harness-game.js — headless validation of the game layer.

   The tool harnesses prove the generators run. This one proves the
   GAME runs: it loads the extracted generator modules and every
   src/game module under a DOM shim backed by @napi-rs/canvas,
   builds a real mission, simulates play, and dumps contact sheets.

       npm install @napi-rs/canvas
       node tools/harness-game.js

   Per the MERC FORGE handoff §9: keep dumping contact sheets. The
   bugs that matter here are invisible in code review and obvious in
   a PNG.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');

/* ---------------- DOM shim ---------------- */
global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected createElement(' + tag + ')');
    return createCanvas(1, 1);
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.requestAnimationFrame = () => 0;
global.setTimeout = global.setTimeout;
// No WebAudio in Node; AUDIO.init() returns false and every play() no-ops.

/* ---------------- load ---------------- */
const FILES = [
  'src/gen/greebleworks.js', 'src/gen/mercforge.js', 'src/gen/crawlerforge.js',
  'src/gen/scrapforge.js',
  'src/game/config.js', 'src/game/audio.js', 'src/game/weapons.js',
  'src/game/sprite.js', 'src/game/physics.js', 'src/game/rigid.js', 'src/game/entities.js',
  'src/game/world.js', 'src/game/render.js', 'src/game/screens.js'
];
for (const f of FILES) require(path.join(ROOT, f));

const GW = window.GREEBLEWORKS;
const LV = GW.LV;

/* ---------------- check plumbing ---------------- */
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; fails.push(label); console.log('  FAIL  ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------------- module surface ---------------- */
section('module surface');
ok(typeof GW.buildLevel === 'function', 'greebleworks buildLevel exported');
ok(typeof GW.drawLevelFrame === 'function', 'greebleworks drawLevelFrame exported');
ok(GW.drawLevelFrame.length === 6, 'drawLevelFrame takes the entityPass hook');
ok(typeof window.MERCFORGE.forge === 'function', 'mercforge forge exported');
ok(typeof window.MERCFORGE.randomParams === 'function', 'mercforge randomParams exported');
ok(typeof window.CRAWLERFORGE.forge === 'function', 'crawlerforge forge exported');
ok(typeof window.CRAWLERFORGE.drawTentacle === 'function', 'crawlerforge drawTentacle exported');
ok(Object.keys(window.CRAWLERFORGE.PALETTES).length === 10, '10 crawler palettes');
ok(window.CRAWLERFORGE.ORIENTS.length === 4, '4 surface orientations');
ok(Object.keys(GW.STYLES).length === 14, '14 facade styles');
ok(Object.keys(GW.SKYMOODS).length === 15, '15 sky moods');
ok(Object.keys(GW.CITY_PRESETS).length === 15, '15 city presets');
for (const m of ['CONFIG', 'WEAPONS', 'SPRITE', 'PHYSICS', 'RIGID', 'ENTITIES', 'WORLD', 'RENDER', 'SCREENS', 'AUDIO']) {
  ok(!!window[m], 'window.' + m + ' present');
}

/* forge() must not leak params into the module-global P */
section('forge isolation');
{
  const before = JSON.stringify(window.MERCFORGE.P_DEFAULTS);
  window.MERCFORGE.forge({ height: 44, gun: 'cannon', helmet: 'crest' });
  const after = JSON.stringify(window.MERCFORGE.P_DEFAULTS);
  ok(before === after, 'forge() leaves P_DEFAULTS untouched');
  const a = window.MERCFORGE.forge({ seed: 99, height: 30 });
  const b = window.MERCFORGE.forge({ seed: 99, height: 30 });
  ok(a.CW === b.CW && a.CH === b.CH, 'forge() is deterministic for one param set');
}

/* ---------------- merc forge sprite work ---------------- */
section('merc forge');
{
  const MF = window.MERCFORGE;
  /* Same schema check the crawler panel gets: the build screen
     generates the operative panel from this table, so a control naming
     a key the generator ignores is a dead slider. */
  const keys = new Set(Object.keys(MF.P_DEFAULTS));
  for (const grp of MF.CONTROLS) {
    for (const c of grp.c) {
      if (c.k === '__colors' || c.k === '__buttons') continue;
      ok(keys.has(c.k), 'merc control "' + c.k + '" maps to a real parameter');
      if (c.t === 'r') {
        const v = MF.P_DEFAULTS[c.k];
        ok(c.min < c.max, 'merc control "' + c.k + '" has a sane range');
        ok(v >= c.min && v <= c.max, 'merc default for "' + c.k + '" is inside its range');
      }
    }
  }

  /* The refit's three new knobs have to actually move pixels. */
  const px = S => {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let n = 0, tones = new Set();
    for (let i = 0; i < S.CW * S.CH; i++) {
      if (d[i * 4 + 3] < 8) continue;
      n++; tones.add((d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]);
    }
    return { n, tones: tones.size };
  };
  const base = MF.forge({ seed: 909, grit: 0, taper: 0, armour: 0 });
  const gritty = MF.forge({ seed: 909, grit: 1.0, taper: 0, armour: 0 });
  const tapered = MF.forge({ seed: 909, grit: 0, taper: 1, armour: 0 });
  const armoured = MF.forge({ seed: 909, grit: 0, taper: 0, armour: 1.4 });
  ok(px(gritty).tones > px(base).tones, 'grit adds tonal variety (' +
     px(base).tones + ' -> ' + px(gritty).tones + ' colours)');
  ok(tapered.CW !== base.CW || tapered.CH !== base.CH || px(tapered).n < px(base).n,
     'taper takes mass out of the limbs (' + px(base).n + ' -> ' + px(tapered).n + ' px)');
  /* Panelling draws straps and seams in colours already in the ramp,
     so it need not add palette entries — what it must do is change the
     pixels. */
  const differs = (A, B) => {
    if (A.CW !== B.CW || A.CH !== B.CH) return 1e6;   // a resize is a change
    const a = A.canvas.getContext('2d').getImageData(0, 0, A.CW, A.CH).data;
    const b = B.canvas.getContext('2d').getImageData(0, 0, B.CW, B.CH).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 3] !== b[i + 3]) n++;
    return n;
  };
  ok(differs(armoured, base) > 4, 'panelling changes the drawing (' +
     differs(armoured, base) + ' px)');

  /* A five-step ramp means a lit sprite should carry well more than
     the three tones per family the old two-step shading produced. */
  ok(px(MF.forge({ seed: 909 })).tones >= 10,
     'shading produces a real ramp, not two tones per material');

  /* Proportions: the refit is meant to be leaner, so guard the band. */
  for (let i = 0; i < 40; i++) {
    const p = MF.randomParams((i * 2654435761) >>> 0);
    ok(p.limbThick <= 0.075, 'random limb weight stays lean (' + p.limbThick.toFixed(3) + ')');
    ok(p.headSize <= 1.05, 'random head stays in proportion');
    ok(p.taper >= 0.4, 'random limbs taper');
    ok(p.grit >= 0, 'random build has grit');
  }
}

/* ---------------- config randomizer ---------------- */
section('config randomizer');
{
  const seen = { style: new Set(), mood: new Set(), pal: new Set() };
  for (let i = 0; i < 240; i++) {
    const cfg = window.CONFIG.randomLevelCfg((i * 2654435761) >>> 0);
    ok(GW.STYLES[cfg.style] !== undefined || fail > 900, 'style ' + cfg.style + ' is real');
    ok(GW.SKYMOODS[cfg.skyMood] !== undefined, 'mood ' + cfg.skyMood + ' is real');
    ok(cfg.palette === 'none' || GW.PALETTES[cfg.palette] !== undefined, 'palette ' + cfg.palette + ' is real');
    ok(cfg.levelLen >= 3 && cfg.levelLen <= 12, 'level length in range');
    ok(cfg.cityLayers >= 2 && cfg.cityLayers <= 5, 'city layers in range');
    seen.style.add(cfg.style); seen.mood.add(cfg.skyMood); seen.pal.add(cfg.palette);
    // Every numeric field must be finite: a NaN here throws deep inside a bake.
    for (const k in cfg) {
      if (typeof cfg[k] === 'number') ok(Number.isFinite(cfg[k]), 'cfg.' + k + ' finite');
    }
  }
  // Reset the counter noise from the loop and report coverage instead.
  console.log('  covered ' + seen.style.size + ' styles, ' + seen.mood.size +
              ' moods, ' + seen.pal.size + ' palettes over 240 rolls');
  ok(seen.style.size >= 12, 'randomizer reaches most styles');
  ok(seen.mood.size >= 10, 'randomizer reaches most moods');
}

section('merc randomizer');
{
  for (let i = 0; i < 60; i++) {
    const p = window.CONFIG.randomMerc((i * 7919 + 13) >>> 0);
    ok(p.height >= 26 && p.height <= 38, 'player height clamped for play');
    ok(p.aimRows === 9, 'player sheet has 9 aim rows');
    ok(window.WEAPONS.table[p.gun] !== undefined, 'weapon ' + p.gun + ' has a behaviour def');
  }
  for (const kind of Object.keys(window.CONFIG.ARCHETYPES)) {
    if (window.CONFIG.ARCHETYPES[kind].crawler) {
      // grown by CRAWLER FORGE, covered in its own section
      let threw = false;
      try { window.CONFIG.archetypeParams(kind, 1, 'slum'); } catch (e) { threw = true; }
      ok(threw, kind + ' rejects a MERC FORGE params request');
      continue;
    }
    for (let i = 0; i < 8; i++) {
      const p = window.CONFIG.archetypeParams(kind, (i * 104729) >>> 0, 'slum');
      ok(p.height > 14 && p.height < 60, kind + ' height sane');
      ok(/^#[0-9a-f]{6}$/i.test(p.colSuit), kind + ' colSuit is a hex colour');
      ok(/^#[0-9a-f]{6}$/i.test(p.colAccent), kind + ' colAccent is a hex colour');
      ok(window.WEAPONS.table[p.gun] !== undefined, kind + ' weapon is defined');
    }
  }
}

/* ---------------- crawler forge ---------------- */
section('crawler forge');
{
  const CF = window.CRAWLERFORGE;
  const before = JSON.stringify(CF.P_DEFAULTS);
  const S = CF.forge({ seed: 4242 });
  ok(JSON.stringify(CF.P_DEFAULTS) === before, 'forge() leaves P_DEFAULTS untouched');
  ok(S.canvas.width === S.CW * S.cols.length, 'body sheet width matches column count');
  ok(S.canvas.height === S.CH * S.orients.length, 'body sheet height matches orientation count');
  ok(S.orients.join(',') === 'floor,wallL,wallR,ceiling', 'orientation rows in the expected order');
  ok(S.pad >= 2, 'cell padding >= 2 so the outline dilate stays inside its cell');
  ok(S.tentacles.canvas.height === S.tentacles.thickness * S.tentacles.count,
     'tentacle sheet is one strip per variant');
  ok(S.tentacles.canvas.width === S.tentacles.length, 'tentacle strip spans the sheet width');

  /* every state and orientation must address a real cell */
  for (const st of S.states) {
    for (let f = 0; f < st.frames; f++) {
      const c = S.colOf(st.id, f);
      ok(c >= 0 && c < S.cols.length, 'column for ' + st.id + ':' + f + ' is in range');
    }
  }
  for (const o of S.orients) {
    const r = S.rowOf(o);
    ok(r >= 0 && r < S.orients.length, 'row for ' + o + ' is in range');
  }

  /* the physics bake has to describe the pixels that were drawn */
  const PH = S.physics;
  ok(PH.hull.length === 24, 'hull is a 24-point polygon');
  ok(PH.radius > 2 && PH.radius < Math.max(S.CW, S.CH), 'grip radius is inside the cell');
  ok(PH.radiusMax >= PH.radius, 'max radius is at least the average');
  ok(PH.sockets.length >= 1, 'sockets baked');
  ok(PH.gibs.length > 0, 'gib seed points baked');
  ok(PH.mass > 0 && PH.mass <= 1, 'mass fraction in range');
  /* Sockets have to sit on drawn pixels. A root parked in the gap
     between two lobes is a tentacle growing out of thin air beside the
     creature, which is exactly how it looked before they were seated
     by walking out from solid ink. */
  {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let off = 0;
    for (const so of PH.sockets) {
      const x = Math.round(S.anchor.x + so.x), y = Math.round(S.anchor.y + so.y);
      if (x < 0 || y < 0 || x >= S.CW || y >= S.CH || d[(y * S.CW + x) * 4 + 3] < 8) off++;
    }
    ok(off === 0, 'every tentacle root sits on drawn pixels (' + off + ' floating)');
  }
  for (const so of PH.sockets) {
    const n = Math.hypot(so.nx, so.ny);
    ok(Math.abs(n - 1) < 0.02, 'socket normal is unit length');
    // the normal must point away from the body, or tentacles grow inward
    ok(so.nx * so.x + so.ny * so.y > -0.01, 'socket normal points outward');
    ok(Math.hypot(so.x, so.y) <= PH.radiusMax + 1, 'socket sits on the body');
  }
  for (const k of ['floor', 'wallL', 'wallR', 'ceiling']) {
    ok(PH.contacts[k] && PH.contacts[k].reach > 0, k + ' contact reach measured');
  }
  /* every gib seed must be inside the drawn silhouette */
  {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let outside = 0;
    for (const g of PH.gibs) {
      const x = Math.round(S.anchor.x + g.x), y = Math.round(S.anchor.y + g.y);
      if (x < 0 || y < 0 || x >= S.CW || y >= S.CH || d[(y * S.CW + x) * 4 + 3] < 8) outside++;
    }
    ok(outside === 0, 'every gib seed lands on drawn pixels (' + outside + ' outside)');
  }

  /* The build screen generates its crawler panel from CF.CONTROLS, so
     a control naming a key the generator does not read would be a dead
     slider in the UI — silent, and only findable by hand. */
  {
    const keys = new Set(Object.keys(CF.P_DEFAULTS));
    let controls = 0;
    for (const grp of CF.CONTROLS) {
      ok(typeof grp.g === 'string' && grp.g.length > 0, 'control group has a name');
      for (const c of grp.c) {
        if (c.t === 'buttons') continue;
        controls++;
        ok(keys.has(c.k), 'control "' + c.k + '" maps to a real parameter');
        ok(typeof c.l === 'string' && c.l.length > 0, 'control "' + c.k + '" has a label');
        if (c.t === 'r') {
          ok(c.min < c.max, 'control "' + c.k + '" has a sane range');
          const v = CF.P_DEFAULTS[c.k];
          ok(v >= c.min && v <= c.max, 'default for "' + c.k + '" is inside its range');
        }
        if (c.t === 's') {
          const opts = typeof c.opt === 'function' ? c.opt() : c.opt;
          ok(opts.indexOf(String(CF.P_DEFAULTS[c.k])) >= 0,
             'default for "' + c.k + '" is one of its options');
        }
      }
    }
    ok(controls > 25, 'the crawler panel exposes a real amount of the generator (' + controls + ')');

    /* a pinned build must survive into the game unchanged */
    const pinned = window.CONFIG.defaultCrawler();
    pinned.palette = 'void'; pinned.size = 37; pinned.tentacles = 6;
    for (let v = 0; v < 3; v++) {
      const got = window.CONFIG.crawlerParams((v * 7717) >>> 0, { style: 'reactor' }, v, pinned);
      ok(got.palette === 'void', 'pinned palette survives variant ' + v);
      ok(got.size === 37, 'pinned size survives variant ' + v);
      ok(got.tentacles === 6, 'pinned tentacle count survives variant ' + v);
      ok(got.seed === ((v * 7717) >>> 0), 'pinned build still varies its seed');
    }
    // and without a pin, the roll still applies
    const rolled = window.CONFIG.crawlerParams(99, { style: 'reactor' }, 0, null);
    ok(rolled.size !== 37 || rolled.palette !== 'void', 'unpinned crawlers still roll');
  }

  /* determinism, and real variety across seeds */
  const a = CF.forge({ seed: 77 }), b = CF.forge({ seed: 77 });
  ok(a.CW === b.CW && a.CH === b.CH, 'forge is deterministic for one seed');
  const sizes = new Set(), pals = new Set();
  for (let i = 0; i < 22; i++) {
    const p = CF.randomParams((i * 2654435761) >>> 0);
    ok(CF.PALETTES[p.palette] !== undefined, 'random palette ' + p.palette + ' is real');
    ok(p.size >= 20 && p.size <= 56, 'random size in range');
    ok(p.tentacles >= 1 && p.tentacles <= 10, 'random tentacle count in range');
    sizes.add(p.size); pals.add(p.palette);
  }
  ok(sizes.size > 6, 'randomizer varies body size (' + sizes.size + ' distinct)');
  ok(pals.size > 4, 'randomizer varies palette (' + pals.size + ' distinct)');

  /* crawlerParams must stay inside what the game was tuned for */
  for (let i = 0; i < 30; i++) {
    const p = window.CONFIG.crawlerParams((i * 104729) >>> 0, { style: 'reactor' });
    ok(p.size >= 24 && p.size <= 40, 'game crawler size clamped');
    ok(p.tentLen >= p.size * 1.7 && p.tentLen <= p.size * 2.7, 'tentacle reach scales with body');
    ok(CF.PALETTES[p.palette] !== undefined, 'game crawler palette is real');
  }
}

/* ---------------- scrap forge ---------------- */
section('scrap forge');
{
  const SF = window.SCRAPFORGE;
  ok(SF.KINDS.length === 6, 'six debris kinds');
  ok(Object.keys(SF.PALETTES).length >= 6, 'a spread of industrial palettes');
  const before = JSON.stringify(SF.P_DEFAULTS);
  const set = SF.forgeSet(4242, { params: { size: 16 } });
  ok(JSON.stringify(SF.P_DEFAULTS) === before, 'forgeSet leaves P_DEFAULTS untouched');
  for (const k of SF.KINDS) {
    const S = set[k], B = S.body;
    ok(!!S && S.canvas.width === S.CW * S.frames, k + ' sheet width matches damage states');
    ok(S.frames >= 2, k + ' has damage states');
    ok(S.bodies.length === S.frames, k + ' bakes a body per damage state');
    ok(B.halfW > 0 && B.halfH > 0, k + ' has real half extents');
    ok(B.mass > 0, k + ' has mass');
    ok(B.bounce >= 0 && B.bounce <= 1, k + ' restitution in range');
    ok(B.friction > 0 && B.friction <= 1, k + ' friction in range');
    ok(B.hp > 0, k + ' has hit points');
    ok(B.gibs.length > 0, k + ' has gib seeds');
    ok(B.hull.length === 16, k + ' hull is a 16-point polygon');
    /* damage must actually take mass out of the piece */
    const solidOf = f => {
      const d = S.canvas.getContext('2d').getImageData(f * S.CW, 0, S.CW, S.CH).data;
      let n = 0;
      for (let i = 0; i < S.CW * S.CH; i++) if (d[i * 4 + 3] > 8) n++;
      return n;
    };
    ok(solidOf(S.frames - 1) < solidOf(0), k + ' wrecked state has less of it left');
    /* every gib seed must land on drawn pixels */
    const d0 = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let outside = 0;
    for (const gg of B.gibs) {
      const x = Math.round(S.CW / 2 + gg.x), y = Math.round(S.CH / 2 + gg.y);
      if (x < 0 || y < 0 || x >= S.CW || y >= S.CH || d0[(y * S.CW + x) * 4 + 3] < 8) outside++;
    }
    ok(outside === 0, k + ' gib seeds land on drawn pixels');
  }
  // heavier things really are heavier
  ok(set.girder.body.mass > set.panel.body.mass, 'a girder outweighs a torn panel');
  ok(set.slab.body.bounce < set.drum.body.bounce, 'concrete bounces less than a drum');
  for (let i = 0; i < 14; i++) {
    const p = SF.randomParams((i * 2654435761) >>> 0);
    ok(SF.PALETTES[p.palette] !== undefined, 'random scrap palette is real');
    ok(p.size >= 8 && p.size <= 40, 'random scrap size in range');
  }
}

/* the build screen generates the debris panel from this table */
{
  const SF = window.SCRAPFORGE;
  const keys = new Set(Object.keys(SF.P_DEFAULTS));
  let n = 0;
  for (const grp of SF.CONTROLS) {
    ok(typeof grp.g === 'string' && grp.g.length > 0, 'scrap control group has a name');
    for (const c of grp.c) {
      if (c.t === 'buttons') continue;
      n++;
      ok(keys.has(c.k), 'scrap control "' + c.k + '" maps to a real parameter');
      if (c.t === 'r') {
        ok(c.min < c.max, 'scrap control "' + c.k + '" has a sane range');
        const v = SF.P_DEFAULTS[c.k];
        ok(v >= c.min && v <= c.max, 'scrap default for "' + c.k + '" is inside its range');
      }
      if (c.t === 's') {
        const opts2 = typeof c.opt === 'function' ? c.opt() : c.opt;
        ok(opts2.indexOf(String(SF.P_DEFAULTS[c.k])) >= 0,
           'scrap default for "' + c.k + '" is one of its options');
      }
    }
  }
  ok(n > 10, 'the debris panel exposes a real amount of the generator (' + n + ')');

  /* a build-screen debris choice has to reach the mission */
  const cfgS = window.CONFIG.randomLevelCfg(0x5C2A);
  cfgS.levelLen = 3;
  // this section runs before the shared `merc` is built, so roll a local one
  const mercS = window.CONFIG.randomMerc(0x5C2A);
  const gs = window.WORLD.buildMission(cfgS, mercS,
    { difficulty: 'regular', enemyDens: 0.6, lives: 3,
      scrap: { palette: 'toxic', size: 19, grime: 1.2 } });
  let rs; while (!(rs = gs.next()).done);
  const MS = rs.value;
  ok(MS.scrap.crate.palette === 'toxic', 'the debris panel choice reaches the level');
  ok(MS.scrap.crate.size === 19, 'the debris size choice reaches the level');
}

/* ---------------- the prototype weapon ---------------- */
section('prototype weapon');
{
  const W = window.WEAPONS;
  ok(W.PROTO_PARAMS.length === 10, 'ten rolled parameters');
  const seen = {};
  W.PROTO_PARAMS.forEach(k => { seen[k] = new Set(); });
  const names = new Set(), bases = new Set();
  let anyCount = 0, anySplash = 0, anyHoming = 0, anyBounce = 0, anyDrop = 0, anyPierce = 0;
  for (let i = 0; i < 80; i++) {
    const d = W.rollProto(window.GREEBLEWORKS.makeRng((i * 2654435761) >>> 0));
    ok(typeof d.label === 'string' && d.label.length > 4, 'prototype has a generated name');
    ok(d.proto === true, 'prototype is flagged');
    ok(d.rate > 0.02 && d.rate < 1, 'rate in range (' + d.rate.toFixed(3) + ')');
    ok(d.dmg > 0 && d.dmg < 20, 'damage in range');
    ok(d.speed > 2 && d.speed <= 14, 'speed in range');
    ok(d.count >= 1 && d.count <= 6, 'projectile count in range');
    ok(d.spread >= 0 && d.spread < 0.4, 'spread in range');
    ok(d.pierce >= 0 && d.pierce <= 4, 'pierce in range');
    ok(d.splash >= 0 && d.splash < 40, 'splash in range');
    ok(d.homing >= 0 && d.homing <= 0.2, 'homing in range');
    ok(d.bounce >= 0 && d.bounce <= 4, 'bounce in range');
    ok(d.drop >= 0 && d.drop <= 0.2, 'drop in range');
    ok(d.mag >= 8, 'magazine is usable (' + d.mag + ')');
    ok(d.reload > 0 && d.reload < 3, 'reload in range');
    ok(W.table[d.base] !== undefined, 'base sprite "' + d.base + '" is a real weapon');
    ok(/^#[0-9a-f]{6}$/i.test(d.tint), 'prototype has a tint');
    ok(d.rolled.length === 10, 'prototype reports its ten rolls');
    ok(!!d.tone, 'prototype has a sound spec');
    names.add(d.label); bases.add(d.base);
    W.PROTO_PARAMS.forEach(k => seen[k].add(Math.round(d[k] * 1000)));
    if (d.count > 1) anyCount++;
    if (d.count === 1) anyCount += 0;
    if (d.splash) anySplash++;
    if (d.homing) anyHoming++;
    if (d.bounce) anyBounce++;
    if (d.drop) anyDrop++;
    if (d.pierce) anyPierce++;
  }
  console.log('  ' + names.size + ' distinct names, ' + bases.size + ' base shapes | ' +
    'multishot ' + anyCount + ' · blast ' + anySplash + ' · seek ' + anyHoming +
    ' · ricochet ' + anyBounce + ' · arc ' + anyDrop + ' · pierce ' + anyPierce + ' / 80');
  ok(names.size > 60, 'names vary run to run (' + names.size + '/80)');
  ok(bases.size >= 3, 'it takes several different shapes');
  /* Every axis has to actually vary, or a "rolled" parameter is a
     constant wearing a costume. */
  for (const k of W.PROTO_PARAMS) {
    ok(seen[k].size > 3, 'parameter "' + k + '" genuinely varies (' + seen[k].size + ' values)');
  }
  ok(anySplash > 2 && anyHoming > 2 && anyBounce > 2, 'the exotic behaviours do come up');
  /* determinism */
  const a1 = W.rollProto(window.GREEBLEWORKS.makeRng(99));
  const a2 = W.rollProto(window.GREEBLEWORKS.makeRng(99));
  ok(a1.label === a2.label && a1.rate === a2.rate, 'a seed always rolls the same gun');
  ok(W.make('proto', a1).ammo === a1.mag, 'make() accepts a rolled definition');
}

/* ---------------- rigid bodies ---------------- */
section('rigid bodies');
{
  const plats = [{ x: 0, y: 200, w: 600, ground: true }];
  const W = new window.PHYSICS.World(plats);
  const sim = new window.RIGID.Sim(W);
  sim.levelWidth = 600;
  const sheet = window.SCRAPFORGE.forgeOne('crate', { seed: 7, size: 16 });

  const b = sim.add(new window.RIGID.Body(sheet, 100, 60, 0));
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  ok(Math.abs((b.y + b.hh) - 200) < 2, 'a dropped body rests on the deck (y=' + b.y.toFixed(1) + ')');
  ok(b.asleep, 'it goes to sleep once still');
  ok(Math.abs(b.vx) < 0.1 && Math.abs(b.vy) < 0.1, 'a sleeping body has no velocity');

  // an impulse wakes it and moves it
  const x0 = b.x;
  b.applyImpulse(6, -3, b.x + 4, b.y - 4);
  ok(!b.asleep, 'an impulse wakes a sleeping body');
  ok(Math.abs(b.spin) > 0, 'an off-centre impulse imparts spin');
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  ok(b.x > x0 + 2, 'the impulse actually moved it (' + x0.toFixed(0) + ' -> ' + b.x.toFixed(0) + ')');

  // two bodies must not end up inside one another
  const c1 = sim.add(new window.RIGID.Body(sheet, 300, 100, 0));
  const c2 = sim.add(new window.RIGID.Body(sheet, 302, 60, 0));
  for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
  const dx = Math.abs(c1.x - c2.x), dy = Math.abs(c1.y - c2.y);
  ok(dx >= c1.hw + c2.hw - 1.5 || dy >= c1.hh + c2.hh - 1.5,
     'stacked bodies separate rather than interpenetrate');
  ok(c1.y < 260 && c2.y < 260, 'neither fell through the deck');

  // damage steps the sprite and shrinks the box
  const d = sim.add(new window.RIGID.Body(sheet, 450, 180, 0));
  const hw0 = d.hw, f0 = d.frame;
  d.hurt(d.maxHp * 0.9);
  ok(d.frame > f0, 'damage steps to a later damage state');
  ok(d.hw <= hw0, 'a wrecked body is no larger than an intact one');

  // hitTest and nearest
  ok(sim.hitTest(d.x, d.y, 2) === d, 'hitTest finds a body under a point');
  ok(sim.hitTest(d.x, d.y - 400, 2) === null, 'hitTest misses empty air');
  ok(sim.nearest(d.x + 8, d.y, 60) !== null, 'nearest finds a grabbable body');
  ok(sim.nearest(d.x, d.y, 2, () => false) === null, 'nearest respects its filter');

  // terminal-velocity drop must not tunnel the deck
  const fast = sim.add(new window.RIGID.Body(sheet, 200, 10, 0));
  fast.vy = 8;
  for (let i = 0; i < 60 * 4; i++) sim.step(1 / 60);
  ok(fast.y < 240, 'a fast-falling body does not tunnel the deck');
}

/* ---------------- weapons ---------------- */
section('weapons');
for (const k of window.WEAPONS.ORDER) {
  const d = window.WEAPONS.table[k];
  ok(d && d.rate > 0 && d.speed > 0 && d.dmg > 0, k + ' has sane numbers');
  ok(d.mag > 0 && d.reload > 0, k + ' has a magazine');
  ok(!!d.tone, k + ' has a sound spec');
  const w = window.WEAPONS.make(k);
  ok(w.ammo === d.mag, k + ' starts loaded');
}

/* ---------------- physics ---------------- */
section('physics');
{
  const plats = [
    { x: 0, y: 200, w: 300, ground: true },
    { x: 400, y: 200, w: 300, ground: true },     // pit between 300 and 400
    { x: 120, y: 140, w: 90, ground: false, thin: false }
  ];
  const W = new window.PHYSICS.World(plats);

  ok(!!W.solidAt(50, 205, false), 'solid inside ground mass');
  ok(!W.solidAt(350, 205, false), 'pit is empty');
  ok(!!W.solidAt(150, 145, true), 'deck is solid to bullets');
  ok(!W.solidAt(150, 145, false), 'deck is not solid to movement queries');

  // fall onto ground
  let o = { x: 50, y: 100, vx: 0, vy: 0 };
  for (let i = 0; i < 120; i++) { o.vy = Math.min(o.vy + 0.36, 9); W.move(o, 10, 27, false); }
  ok(Math.abs(o.y - 200) < 0.5, 'falls and rests on ground (y=' + o.y.toFixed(2) + ')');
  ok(o.ground === true, 'ground flag set');

  // one-way deck catches from above
  o = { x: 150, y: 100, vx: 0, vy: 0 };
  for (let i = 0; i < 60; i++) { o.vy = Math.min(o.vy + 0.36, 9); W.move(o, 10, 27, false); }
  ok(Math.abs(o.y - 140) < 0.5, 'lands on one-way deck (y=' + o.y.toFixed(2) + ')');

  // ...and does not catch from below
  o = { x: 150, y: 190, vx: 0, vy: -6 };
  let blocked = false;
  for (let i = 0; i < 20; i++) { W.move(o, 10, 27, false); if (o.hitCeil) blocked = true; o.vy += 0.36; }
  ok(!blocked, 'jumps up through a one-way deck');
  ok(o.y < 140, 'passed above the deck');

  // drop-through
  o = { x: 150, y: 140, vx: 0, vy: 1 };
  for (let i = 0; i < 40; i++) { o.vy = Math.min(o.vy + 0.36, 9); W.move(o, 10, 27, true); }
  ok(o.y > 150, 'drop-through ignores the deck');

  // no tunnelling at speed: a fast faller must still be caught
  o = { x: 50, y: 20, vx: 0, vy: 9 };
  for (let i = 0; i < 60; i++) { W.move(o, 10, 27, false); if (o.ground) break; o.vy = 9; }
  ok(o.ground && Math.abs(o.y - 200) < 0.5, 'terminal-velocity fall does not tunnel');

  // horizontal wall stop against the step at x=400
  o = { x: 380, y: 199, vx: 0, vy: 0 };
  const plats2 = [{ x: 0, y: 200, w: 400, ground: true }, { x: 400, y: 160, w: 300, ground: true }];
  const W2 = new window.PHYSICS.World(plats2);
  o = { x: 380, y: 200, vx: 6, vy: 0 };
  for (let i = 0; i < 10; i++) W2.move(o, 12, 27, false);
  ok(o.x < 400, 'stops against a taller ground run (x=' + o.x.toFixed(1) + ')');

  /* ---- surface queries: what a crawler can grip ---- */
  {
    const faces = W.surfacesNear(150, 130, 60);
    ok(faces.length > 0, 'found grippable faces near a deck');
    const kinds = new Set(faces.map(f => f.orient));
    ok(kinds.has('floor'), 'deck top is grippable as floor');
    ok(kinds.has('ceiling'), 'deck underside is grippable as ceiling');
    ok(kinds.has('wallL') || kinds.has('wallR'), 'deck sides are grippable as walls');
    for (const f of faces) {
      ok(Math.abs(Math.hypot(f.nx, f.ny) - 1) < 1e-6, 'face normal is unit');
      ok(f.dist <= 60 + 1e-6, 'face is within the search radius');
    }
    // ground mass has no underside inside the frame to hang from
    const groundFaces = W.surfacesNear(50, 205, 40).filter(f => f.plat.ground);
    ok(groundFaces.every(f => f.orient !== 'ceiling'),
       'ground mass exposes no ceiling face');

    const pick = W.pickAnchor(150, 130, 5, 90, 1, 0, () => 0.5);
    ok(!!pick, 'pickAnchor returns a grip');
    ok(pick.dist >= 5, 'pickAnchor respects the minimum stride');
    // it should prefer a grip in the direction asked for
    let rightWins = 0;
    for (let i = 0; i < 24; i++) {
      const r = W.pickAnchor(150, 150, 4, 120, 1, 0, Math.random);
      if (r && r.x >= 150) rightWins++;
    }
    ok(rightWins > 14, 'pickAnchor leans the way it is told (' + rightWins + '/24)');
  }

  /* ---- double jump ---- */
  {
    const rig = { w: 10, h: 27, gun: 'rifle', params: { colVisor: '#fff' },
                  frameOf: () => 0, framesOf: () => 1, fpsOf: () => 1,
                  muzzle: () => ({ x: 0, y: 0 }) };
    const diff = window.CONFIG.DIFFICULTY.regular;
    const P2 = new window.ENTITIES.Player(rig, 50, 200, diff);
    const inp = { left: false, right: false, up: false, down: false, fire: false,
                  jumpPressed: false, reloadPressed: false, aimX: 100, aimY: 180 };
    const stepN = (n, jump) => {
      for (let i = 0; i < n; i++) {
        inp.jumpPressed = jump && i === 0;
        P2.step(W, inp, 1 / 60);
      }
    };
    stepN(6, false);
    ok(P2.ground, 'test player is on the deck');
    ok(P2.airJumps === window.ENTITIES.MOVE.airJumps, 'air jumps are charged on the ground');
    stepN(1, true);
    ok(P2.vy < -4, 'first jump leaves the ground');
    const apex = P2.y;
    stepN(24, false);
    ok(P2.vy > 0, 'it is falling by now');
    const beforeY = P2.y, spent = P2.airJumps;
    stepN(1, true);
    ok(P2.airJumps === spent - 1, 'the air jump is spent');
    ok(P2.vy < 0, 'the second jump reverses the fall (vy=' + P2.vy.toFixed(2) + ')');
    ok(!!P2.jumpPuff, 'the air jump leaves a mark');
    stepN(1, true);
    ok(P2.airJumps === 0, 'there is no third jump');
    // and it recharges on landing
    for (let i = 0; i < 200 && !P2.ground; i++) { inp.jumpPressed = false; P2.step(W, inp, 1 / 60); }
    ok(P2.ground, 'it lands again');
    ok(P2.airJumps === window.ENTITIES.MOVE.airJumps, 'landing recharges the air jump');
    ok(P2.y < 260 && beforeY < 260, 'the double jump did not push it through the floor');
  }

  ok(W.canSee(10, 190, 60, 190) === true, 'clear line of sight along a deck');
  // A tall block between two low runs must break sight across it.
  const W3 = new window.PHYSICS.World([
    { x: 0, y: 200, w: 400, ground: true },
    { x: 400, y: 100, w: 100, ground: true },
    { x: 500, y: 200, w: 300, ground: true }
  ]);
  ok(W3.canSee(380, 180, 600, 180) === false, 'line of sight blocked by mass');
  ok(W3.canSee(380, 60, 600, 60) === true, 'line of sight clears over the block');

  const g = W.groundUnder(50, 100, false);
  ok(g && g.y === 200, 'groundUnder finds the deck below');
  ok(W.groundUnder(350, 100, false) === null, 'groundUnder returns null over a pit');
}

/* ---------------- full mission ---------------- */
section('mission build + simulation');
const cfg = window.CONFIG.randomLevelCfg(0xC0FFEE);
cfg.levelLen = 4;                      // keep the harness quick
const merc = window.CONFIG.randomMerc(0xC0FFEE);
const opts = { difficulty: 'regular', enemyDens: 1.0, lives: 3 };

const t0 = Date.now();
let steps = 0, r;
const gen = window.WORLD.buildMission(cfg, merc, opts);
const phases = new Set();
while (!(r = gen.next()).done) {
  steps++;
  phases.add(r.value.phase);
  ok(typeof r.value.msg === 'string' && r.value.msg.length > 0, 'progress step has a message');
}
const M = r.value;
const bakeMs = Date.now() - t0;
console.log('  bake: ' + bakeMs + 'ms over ' + steps + ' yielded steps');
ok(phases.has('level') && phases.has('rigs') && phases.has('deploy'), 'all load phases reported');
ok(steps > 60, 'enough progress steps for an honest bar');
ok(M.L.plats.length > 4, 'level has platforms');
ok(M.enemies.length > 0, 'hostiles deployed (' + M.enemies.length + ')');
ok(M.player.y <= LV.H, 'player spawned inside the frame');
ok(M.exit.x > M.player.x, 'extraction is downrange of the spawn');
ok(M.exit.x <= M.L.LW, 'extraction is inside the level');

/* Every enemy must start on solid footing (or be a flyer). */
{
  let grounded = 0, flying = 0, clinging = 0, bad = 0;
  for (const e of M.enemies) {
    if (e.kind === 'crawler') {
      // seated against a surface at the reach the generator measured
      const faces = M.world.surfacesNear(e.x, e.y, e.rig.radiusMax || 90);
      let seated = false;
      for (const f of faces) {
        if (!f.orient) continue;
        if (Math.abs(f.dist - e.rig.reach(f.orient)) < 3) { seated = true; break; }
      }
      if (seated) clinging++; else bad++;
      continue;
    }
    if (e.flying) { flying++; continue; }
    const g = M.world.groundUnder(e.x, e.y - 1, true);
    if (g && Math.abs(g.y - e.y) < 2) grounded++; else bad++;
  }
  ok(bad === 0, 'every hostile spawned attached to something (' + bad + ' floating)');
  console.log('  ' + grounded + ' grounded, ' + flying + ' airborne, ' + clinging + ' clinging');
}

/* Nothing spawns on top of the player. */
{
  let tooClose = 0;
  for (const e of M.enemies) if (Math.abs(e.x - M.player.x) < 180) tooClose++;
  ok(tooClose === 0, 'no hostile spawns inside the drop-in zone');
}

/* ---------------- simulate ---------------- */
section('30s of play');
{
  const inp = {
    left: false, right: true, up: false, down: false,
    fire: true, jumpPressed: false, reloadPressed: false,
    cursorX: 300, cursorY: 120, aimX: 0, aimY: 0
  };
  let maxBullets = 0, maxParts = 0, fired = 0, shotsHit = 0;
  const beforeKills = M.kills;
  for (let i = 0; i < 30 * 60; i++) {
    M.cursorX = inp.cursorX; M.cursorY = inp.cursorY;
    // Walk right, jump periodically, sweep the aim so bullets go everywhere.
    inp.jumpPressed = (i % 47 === 0);
    inp.cursorX = 224 + Math.cos(i / 40) * 200;
    inp.cursorY = 126 + Math.sin(i / 27) * 90;
    if (i % 900 === 800) inp.reloadPressed = true; else inp.reloadPressed = false;
    M.update(1 / 60, inp);
    maxBullets = Math.max(maxBullets, M.bullets.length);
    maxParts = Math.max(maxParts, M.parts.length);
    if (M.state === 'dead') {
      if (!M.respawn()) break;
    }
    if (M.state === 'won') break;
    // invariants, every step
    if (!Number.isFinite(M.player.x) || !Number.isFinite(M.player.y)) {
      ok(false, 'player position went non-finite at step ' + i); break;
    }
    if (!Number.isFinite(M.scroll)) { ok(false, 'scroll went non-finite at step ' + i); break; }
  }
  ok(Number.isFinite(M.player.x) && Number.isFinite(M.player.y), 'player position stayed finite');
  ok(M.player.x >= 0 && M.player.x <= M.L.LW, 'player stayed inside the level');
  ok(M.scroll >= 0 && M.scroll <= Math.max(0, M.L.LW - LV.W), 'camera stayed clamped');
  ok(maxBullets < 400, 'bullet list stayed bounded (peak ' + maxBullets + ')');
  ok(maxParts < 3000, 'particle list stayed bounded (peak ' + maxParts + ')');
  ok(M.kills >= beforeKills, 'kill count only goes up');
  console.log('  player at x=' + M.player.x.toFixed(0) + '/' + M.L.LW +
              ', hp=' + M.player.hp.toFixed(0) +
              ', kills=' + M.kills + '/' + M.totalEnemies +
              ', state=' + M.state + ', lives=' + M.lives);
  const st = M.stats();
  ok(Number.isFinite(st.final), 'stats produce a finite score');
}

/* Bullets must actually be able to kill: fire point blank at a hostile. */
section('damage path');
{
  /* Both damage checks need the same thing: a muzzle position with
     clear air between it and the target. Terrain, one-way decks and
     debris all stop bullets, and a test that assumes a firing line
     fails for reasons that have nothing to do with the damage path.
     Ask the world instead. */
  var clearLineIn = (M, ox, oy, tx, ty) => {
    const steps = Math.ceil(Math.hypot(tx - ox, ty - oy) / 2) || 1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const px = ox + (tx - ox) * t, py = oy + (ty - oy) * t;
      if (M.world.solidAt(px, py, true)) return false;
      if (M.rigid.hitTest(px, py, 1)) return false;
      }
    return true;
  };
  var approachTo = (M, tx, ty, dist) => {
    /* Sweep the full circle, and fall back to shorter stand-off
       distances: a hostile wedged into a step has clear air close in
       even when every long line is blocked. */
    for (const scale of [1, 0.65, 0.4]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const d = [Math.cos(a), Math.sin(a)];
        const r = dist * scale;
        const ox = tx + d[0] * r, oy = ty + d[1] * r;
        if (clearLineIn(M, ox, oy, tx, ty)) return { d, ox, oy, r };
      }
    }
    return null;
  };
  const M2 = (() => {
    const g = window.WORLD.buildMission(
      Object.assign({}, cfg, { seed: 4242, levelLen: 3 }),
      merc, { difficulty: 'recruit', enemyDens: 1.5, lives: 3 });
    let rr; while (!(rr = g.next()).done);
    return rr.value;
  })();
  /* Pick a hostile that can actually be shot. A merc standing in a
     doorway or wedged against a step has no clear line to it from any
     angle — that is the level being a level, not the damage path being
     broken, and pinning the test to enemies[0] made it fail whenever
     the layout shifted. */
  const W = window.WEAPONS.table.rifle;
  let target = null, ap0 = null;
  for (const e of M2.enemies) {
    if (e.flying || e.kind === 'crawler' || e.boss || e.dead) continue;
    const a = approachTo(M2, e.x, e.y - e.h * 0.5, 30);
    if (a) { target = e; ap0 = a; break; }
  }
  ok(!!target, 'found a walking hostile with a clear firing line');
  if (target) {
    const hpBefore = target.hp;
    const ty = target.y - target.h * 0.5;
    const d0 = ap0 ? ap0.d : [-1, 0], r0 = ap0 ? ap0.r : 30;
    for (let i = 0; i < 12; i++) {
      M2.bullets.push(new window.ENTITIES.Bullet(
        target.x + d0[0] * r0, ty + d0[1] * r0,
        Math.atan2(-d0[1], -d0[0]), W, true, '#fff'));
    }
    for (let i = 0; i < 40; i++) M2.stepBullets(1 / 60);
    ok(target.hp < hpBefore || target.dead, 'point-blank fire damaged the hostile');

    /* A crawler is a disc around its centre, and shooting one must
       throw chunks off it. Pick a LIVE one: the shots above can pass
       through a crawler on their way to the merc, and a corpse takes
       no further damage — which is correct, and quietly satisfied an
       earlier version of this check through its `|| dead` clause. */
    const cr = M2.enemies.find(e => e.kind === 'crawler' && !e.dead);
    ok(!!cr, 'a live crawler is in the level');
    if (cr) {
      /* Shoot from a direction with clear air between muzzle and blob.
         A crawler on a wall has solid mass on one side of it, and
         firing from that side just puts a hole in the wall — correct
         behaviour, and the reason two earlier versions of this check
         failed for reasons that had nothing to do with the code under
         test. Pick the approach by asking the world, not by assuming. */
      const D = 34;
      const found = approachTo(M2, cr.x, cr.y, D);
      ok(!!found, 'found a clear firing line to the crawler');
      let ap = found ? found.d : [0, -1];
      const apR = found ? found.r : D;
      const shootAt = target => {
        M2.bullets.push(new window.ENTITIES.Bullet(
          target.x + ap[0] * apR, target.y + ap[1] * apR,
          Math.atan2(-ap[1], -ap[0]), W, true, '#fff'));
      };
      const chpBefore = cr.hp, gibsBefore = M2.gibs.length;
      for (let i = 0; i < 10; i++) shootAt(cr);
      for (let i = 0; i < 60; i++) M2.stepBullets(1 / 60);
      ok(cr.hp < chpBefore, 'point-blank fire damaged the crawler');
      ok(M2.gibs.length > gibsBefore, 'chunks flew off the crawler');
      ok(cr.alerted, 'being shot alerts the crawler');

      /* a shot that clears the disc must not register */
      const cr2 = M2.enemies.find(e => e.kind === 'crawler' && !e.dead && e !== cr) || cr;
      if (!cr2.dead) {
        const f2 = approachTo(M2, cr2.x, cr2.y, D);
        const ap2 = f2 ? f2.d : [0, -1];
        const miss = cr2.hp;
        const perpX = -ap2[1], perpY = ap2[0];
        const off = cr2.rig.r + 12;
        M2.bullets.push(new window.ENTITIES.Bullet(
          cr2.x + ap2[0] * (f2 ? f2.r : 34) + perpX * off,
          cr2.y + ap2[1] * (f2 ? f2.r : 34) + perpY * off,
          Math.atan2(-ap2[1], -ap2[0]), W, true, '#fff'));
        for (let i = 0; i < 40; i++) M2.stepBullets(1 / 60);
        ok(cr2.hp === miss, 'a shot clear of the blob is not a hit');
      }
    }
    // and the reverse: an enemy bullet must be able to hurt the player
    const php = M2.player.hp;
    M2.player.invuln = 0;
    M2.bullets.push(new window.ENTITIES.Bullet(
      M2.player.x - 20, M2.player.y - M2.player.h * 0.5, 0,
      window.WEAPONS.table.pistol, false, '#fff'));
    for (let i = 0; i < 30; i++) M2.stepBullets(1 / 60);
    ok(M2.player.hp < php, 'enemy fire damaged the player');
  }
}

/* ---------------- contact sheets ---------------- */
section('contact sheets');
fs.mkdirSync(OUT, { recursive: true });

function dump(name, cv) {
  fs.writeFileSync(path.join(OUT, name), cv.toBuffer('image/png'));
  console.log('  wrote out/' + name);
}

/* a few gameplay frames spread across the level */
{
  const cv = createCanvas(LV.W, LV.H * 3);
  const cx = cv.getContext('2d');
  const one = createCanvas(LV.W, LV.H);
  const ox = one.getContext('2d');
  // Pose the run for the shot rather than photographing whatever
  // state the 30s simulation happened to end in.
  M.state = 'play'; M.endT = 0; M.lives = 3;
  M.player.dead = false; M.player.hp = 72;
  for (let i = 0; i < 3; i++) {
    M.scroll = (M.L.LW - LV.W) * (i / 2);
    M.time = 2 + i * 3;
    M.cursorX = 300; M.cursorY = 110;
    // Stand the player on real ground somewhere in view.
    let px = M.scroll + 120, g = null;
    for (let k = 0; k < 40 && !g; k++) { px = M.scroll + 60 + k * 8; g = M.world.groundUnder(px, 0, true); }
    M.player.x = px;
    if (g) M.player.y = g.y;
    M.player.anim = 'run'; M.player.frame = 2;
    M.player.local = -0.3; M.player.face = 1;
    window.RENDER.frame(M, ox, one);
    cx.drawImage(one, 0, i * LV.H);
  }
  dump('out_game.png', cv);
}

/* the entity cast, blitted from their sheets */
{
  const kinds = Object.keys(window.CONFIG.ARCHETYPES);
  const cell = 90;
  const cv = createCanvas(cell * (kinds.length + 1), cell);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#14181a';
  cx.fillRect(0, 0, cv.width, cv.height);
  const pr = new window.SPRITE.Rig(merc);
  pr.draw(cx, 'run', 2, -0.2, cell * 0.5, cell - 14, false);
  kinds.forEach((k, i) => {
    if (window.CONFIG.ARCHETYPES[k].crawler) {
      const rig = new window.SPRITE.CrawlerRig(
        window.CONFIG.crawlerParams(1234 + i * 77, cfg));
      rig.draw(cx, 'idle', 0, 'floor',
        cell * (i + 1.5), cell - 14 - rig.reach('floor'), false);
    } else {
      const rig = new window.SPRITE.Rig(window.CONFIG.archetypeParams(k, 1234 + i * 77, cfg.style));
      rig.draw(cx, 'idle', 0, 0, cell * (i + 1.5), cell - 14, false);
    }
  });
  dump('out_cast.png', cv);
}

/* aim sweep of the player rig: every row of the sheet */
{
  const rig = new window.SPRITE.Rig(merc);
  const n = rig.sheet.angles.length;
  const cw = rig.sheet.CW + 6, ch = rig.sheet.CH + 6;
  const cv = createCanvas(cw * n, ch);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#14181a';
  cx.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < n; i++) {
    const local = (rig.sheet.angles[i]) * Math.PI / 180;
    rig.draw(cx, 'idle', 0, local, cw * (i + 0.5), ch - 4, false);
  }
  dump('out_aim.png', cv);
}

/* crawlers: locomotion over time, on whatever surface they grabbed */
{
  const cfgC = window.CONFIG.randomLevelCfg(0x5EA51DE);
  cfgC.levelLen = 4;
  const gc = window.WORLD.buildMission(cfgC, merc,
    { difficulty: 'regular', enemyDens: 2.2, lives: 3 });
  let rr; while (!(rr = gc.next()).done);
  const MC = rr.value;
  const crawlers = MC.enemies.filter(e => e.kind === 'crawler');
  ok(crawlers.length > 0, 'crawler contact sheet has crawlers (' + crawlers.length + ')');

  /* run them so limbs cast, grip and haul */
  const inp = { left: false, right: false, up: false, down: false, fire: false,
                jumpPressed: false, reloadPressed: false, cursorX: 224, cursorY: 126,
                aimX: 0, aimY: 0 };
  const seen = { gripped: 0, reaching: 0, moved: 0, orients: new Set() };
  const start = crawlers.map(c => ({ x: c.x, y: c.y }));
  /* Off-screen hostiles are culled from the sim, so park the player
     next to each crawler in turn rather than watching from spawn and
     concluding that nothing moves. */
  crawlers.forEach((c, ci) => {
    MC.player.x = c.x + 90;
    const gg = MC.world.groundUnder(MC.player.x, 0, true);
    MC.player.y = gg ? gg.y : c.y;
    MC.scroll = clamp(c.x - LV.W / 2, 0, Math.max(0, MC.L.LW - LV.W));
    for (let i = 0; i < 60 * 5; i++) {
      MC.cursorX = inp.cursorX; MC.cursorY = inp.cursorY;
      MC.update(1 / 60, inp);
      if (c.dead) break;
      seen.orients.add(c.orient);
      for (const l of c.limbs) {
        if (l.state === 'gripped') seen.gripped++;
        if (l.state === 'reaching') seen.reaching++;
      }
    }
    if (Math.hypot(c.x - start[ci].x, c.y - start[ci].y) > 8) seen.moved++;
  });
  ok(seen.gripped > 0, 'crawler limbs gripped terrain (' + seen.gripped + ' limb-frames)');
  ok(seen.reaching > 0, 'crawler limbs cast for new grips (' + seen.reaching + ' limb-frames)');
  ok(seen.moved > 0, 'crawlers hauled themselves somewhere (' + seen.moved + '/' + crawlers.length + ')');
  ok(MC.slime.length > 0, 'crawlers laid a slime trail (' + MC.slime.length + ' marks)');
  for (const c of crawlers) {
    ok(Number.isFinite(c.x) && Number.isFinite(c.y), 'crawler position stayed finite');
    ok(c.y < MC.world.floor + 200, 'crawler did not fall out of the world');
  }
  console.log('  orientations used: ' + Array.from(seen.orients).join(', '));

  /* a frame with a crawler centred, plus its own tentacles */
  const live = crawlers.filter(c => !c.dead);
  if (live.length) {
    const cv = createCanvas(LV.W, LV.H * Math.min(3, live.length));
    const cx2 = cv.getContext('2d');
    const one = createCanvas(LV.W, LV.H);
    const ox2 = one.getContext('2d');
    MC.state = 'play'; MC.endT = 0;
    MC.player.dead = false; MC.player.hp = 80;
    for (let i = 0; i < Math.min(3, live.length); i++) {
      const c = live[i];
      MC.scroll = clamp(c.x - LV.W / 2, 0, Math.max(0, MC.L.LW - LV.W));
      MC.time = 3 + i * 2;
      MC.player.x = MC.scroll + 70;
      const gg = MC.world.groundUnder(MC.player.x, 0, true);
      if (gg) MC.player.y = gg.y;
      MC.player.anim = 'idle'; MC.player.frame = 0; MC.player.local = 0; MC.player.face = 1;
      // gib and slime so the shot shows what a fight with one looks like
      MC.gib(c, 10);
      window.RENDER.frame(MC, ox2, one);
      cx2.drawImage(one, 0, i * LV.H);
    }
    dump('out_crawler.png', cv);
  }

  /* the same crawler on all four surfaces, with limbs out */
  {
    const rig = crawlers[0].rig;
    const T = rig.tent, PH = rig.phys;
    const pad = 96;
    const cell = Math.round(rig.tent.length * 0.9) + pad;
    const cv = createCanvas(cell * 4, cell);
    const c2 = cv.getContext('2d');
    c2.imageSmoothingEnabled = false;
    c2.fillStyle = '#14181a'; c2.fillRect(0, 0, cv.width, cv.height);
    ['floor', 'wallL', 'wallR', 'ceiling'].forEach((o, i) => {
      const ox3 = i * cell + cell / 2, oy3 = cell / 2;
      // the surface it is stuck to
      const n = { floor: [0, -1], ceiling: [0, 1], wallL: [1, 0], wallR: [-1, 0] }[o];
      const reach = rig.reach(o);
      c2.fillStyle = '#232a2e';
      if (n[0] === 0) c2.fillRect(i * cell + 8, oy3 - n[1] * reach - (n[1] < 0 ? 0 : 8), cell - 16, 8);
      else c2.fillRect(ox3 - n[0] * reach - (n[0] < 0 ? 0 : 8), 8, 8, cell - 16);
      // limbs reaching out along their sockets
      for (let k = 0; k < PH.sockets.length; k++) {
        const so = rig.socket(k, ox3, oy3, false, o);
        const a = Math.atan2(so.ny, so.nx);
        const len = 34 + (k % 3) * 16;
        window.CRAWLERFORGE.drawTentacle(c2, T, k % T.count, so.x, so.y,
          so.x + Math.cos(a) * len, so.y + Math.sin(a) * len,
          (k % 2 ? 1 : -1) * 12, {});
      }
      rig.draw(c2, 'idle', 0, o, ox3, oy3, false);
      c2.fillStyle = '#8d9aa2'; c2.font = '11px monospace';
      c2.fillText(o, i * cell + 8, cell - 8);
    });
    dump('out_crawler_surfaces.png', cv);
  }
}

/* the boss, the debris it throws, and the corruption */
section('overlord + corruption');
{
  const cfgB = window.CONFIG.randomLevelCfg(0xB055);
  cfgB.levelLen = 4;
  const gb = window.WORLD.buildMission(cfgB, merc,
    { difficulty: 'veteran', enemyDens: 1.4, lives: 3 });
  let rb; while (!(rb = gb.next()).done);
  const MB = rb.value;
  const O = MB.overlord;

  ok(!!O, 'an overlord was placed');
  ok(O.boss === true, 'it is flagged as a boss');
  ok(O.maxHp > 200, 'boss has boss health (' + O.maxHp + ')');
  ok(O.x > MB.player.x + 200, 'boss holds ground downrange of the spawn');
  ok(O.x < MB.exit.x, 'boss stands between the player and extraction');
  ok(O.flying && !O.ground, 'boss levitates rather than clinging');
  ok(MB.rigid.bodies.length > 4, 'debris scattered through the level (' +
     MB.rigid.bodies.length + ')');

  /* every body must start seated on terrain, not inside it */
  let embedded = 0;
  for (const b of MB.rigid.bodies) if (MB.world.solidAt(b.x, b.y, false)) embedded++;
  ok(embedded === 0, 'no debris spawned inside terrain (' + embedded + ')');

  /* fight it: wake, phases, grabs, throws */
  const inp = { left: false, right: false, up: false, down: false, fire: false,
                jumpPressed: false, reloadPressed: false, cursorX: 224, cursorY: 126,
                aimX: 0, aimY: 0 };
  MB.player.x = O.x - 140;
  const gg = MB.world.groundUnder(MB.player.x, 0, true);
  if (gg) MB.player.y = gg.y;
  MB.player.hp = 100;
  const seen = { phases: new Set(), grabbed: 0, thrown: 0, lashed: 0, maxVapor: 0 };
  let lastGrab = null;
  for (let i = 0; i < 60 * 22; i++) {
    MB.scroll = clamp(O.x - LV.W / 2, 0, Math.max(0, MB.L.LW - LV.W));
    MB.cursorX = inp.cursorX; MB.cursorY = inp.cursorY;
    MB.player.hp = 100;                 // keep the fight running
    MB.update(1 / 60, inp);
    if (O.dead) break;
    seen.phases.add(O.phase);
    seen.maxVapor = Math.max(seen.maxVapor, MB.vapors.length);
    if (O.grab && O.grab !== lastGrab) { seen.grabbed++; lastGrab = O.grab; }
    if (!O.grab && lastGrab) { seen.thrown++; lastGrab = null; }
    for (const l of O.limbs) if (l.state === 'strike') seen.lashed++;
    // walk it down through its phases
    if (i % 90 === 89) O.hurtBy(14, MB);
    ok(Number.isFinite(O.x) && Number.isFinite(O.y), 'boss position stayed finite');
    ok(O.y > 0 && O.y < LV.H, 'boss stayed inside the frame');
  }
  console.log('  phases ' + Array.from(seen.phases).join(',') +
              ' | grabs ' + seen.grabbed + ' | throws ' + seen.thrown +
              ' | lashes ' + seen.lashed + ' | peak vapour ' + seen.maxVapor);
  ok(O.aggroed, 'boss woke when the player closed in');
  ok(seen.phases.size >= 2, 'boss changed phase under fire');
  ok(seen.lashed > 0, 'boss lashed with its tentacles');
  ok(seen.grabbed > 0, 'boss picked up debris (' + seen.grabbed + ')');
  ok(seen.thrown > 0, 'boss threw what it picked up (' + seen.thrown + ')');
  ok(seen.maxVapor > 10, 'boss vents demonic vapour');
  ok(O.dead || O.hp < O.maxHp, 'boss took damage');

  /* it must actually be killable, and drop the goods */
  const pickBefore = MB.pickups.length;
  while (!O.dead) O.hurtBy(40, MB);
  ok(O.dead, 'boss can be killed');
  ok(MB.pickups.length > pickBefore, 'boss drops pickups on death');
  ok(MB.gibs.length > 0, 'boss comes apart');

  /* the prototype is placed, and taking it changes the loadout */
  {
    const pk = MB.pickups.find(p => p.shrine);
    ok(!!pk, 'the prototype was placed');
    if (pk) {
      ok(!!pk.proto, 'the pickup carries its rolled definition');
      // the player has been moved to the boss by now; measure from spawn
      ok(pk.x > MB.ground[0].x + 200, 'prototype is downrange of the spawn');
      ok(pk.x < O.x + 40, 'prototype is reached before the boss');
      const gp = MB.world.groundUnder(pk.x, 0, true);
      ok(gp && Math.abs(gp.y - (pk.y + 2)) < 3, 'prototype sits on real ground');
      const beforeRig = MB.player.rig;
      MB.take(pk);
      ok(MB.player.weapon.kind === 'proto', 'taking it equips the prototype');
      ok(MB.player.weapon.def.proto === true, 'the equipped weapon is the rolled one');
      ok(MB.player.rig !== beforeRig, 'the merc sprite swaps to hold it');
      // firing it must produce its rolled projectile count
      MB.player.weapon.ammo = 20; MB.player.weapon.cool = 0;
      MB.bullets.length = 0;
      MB.fire({ fire: true, reloadPressed: false }, 1 / 60);
      ok(MB.bullets.length === MB.player.weapon.def.count,
         'it fires its rolled projectile count (' + MB.bullets.length + ')');
      // and it never silently downgrades when dry
      MB.player.weapon.ammo = 0; MB.player.spare.proto = 0; MB.player.weapon.cool = 0;
      MB.fire({ fire: true, reloadPressed: false }, 1 / 60);
      ok(MB.player.weapon.kind === 'proto', 'a dry prototype is not swapped away');
    }
  }

  /* debris belongs to the level it is in */
  {
    const pal = MB.scrap.crate.palette;
    ok(window.CONFIG.SCRAP_PALETTES[cfgB.style].indexOf(pal) >= 0,
       'debris palette suits the architecture (' + cfgB.style + ' -> ' + pal + ')');
    /* scrapParamsFor is what the build screen seeds its panel from, so
       a free roll there would silently override the level match. */
    for (let i = 0; i < 20; i++) {
      const sp = window.CONFIG.scrapParamsFor((i * 7919) >>> 0, cfgB);
      ok(window.CONFIG.SCRAP_PALETTES[cfgB.style].indexOf(sp.palette) >= 0,
         'scrapParamsFor stays inside the architecture pool');
      ok(sp.lightdir === cfgB.lightdir, 'debris is lit from the level\'s light angle');
    }
    for (const b of MB.rigid.bodies.slice(0, 6)) {
      const sh = b.sheet;
      const ink = sh.bodies[0];
      ok(b.hw < (ink.halfW / 0.90) + 0.01, 'collision box is inset from the silhouette');
      ok(b.hh < (ink.halfH / 0.82) + 0.01, 'and sunk vertically so it beds in');
    }
    // a resting body should overlap the deck it sits on, not perch above it
    let bedded = 0, resting = 0;
    for (const b of MB.rigid.bodies) {
      const gr = MB.world.groundUnder(b.x, b.y, true);
      if (!gr || Math.abs((b.y + b.hh) - gr.y) > 1.5) continue;
      resting++;
      if (b.y + b.sheet.bodies[0].halfH / 0.82 > gr.y) bedded++;
    }
    ok(resting === 0 || bedded === resting,
       'resting debris beds into the deck rather than floating on it (' +
       bedded + '/' + resting + ')');
  }

  /* corruption */
  const mercs = MB.enemies.filter(e => e.kind === 'grunt' || e.kind === 'trooper' ||
                                       e.kind === 'heavy' || e.kind === 'drone');
  const rotten = mercs.filter(e => e.corrupt > 0);
  console.log('  corrupted mercs ' + rotten.length + '/' + mercs.length);
  for (const e of rotten) {
    ok(e.corrupt > 0 && e.corrupt <= 1, 'corruption level in range');
    ok(e.rig.params.colRot !== undefined, 'a corrupted merc has a rot colour');
    ok(e.maxHp > window.CONFIG.ARCHETYPES[e.kind].hp * MB.diff.enemyHp * 0.99,
       'corruption makes them tougher');
  }
  /* the generator must draw it, not just flag it */
  const clean = window.MERCFORGE.forge({ seed: 31, corrupt: 0 });
  const foul = window.MERCFORGE.forge({ seed: 31, corrupt: 1 });
  const count = S => {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let n = 0;
    for (let i = 0; i < S.CW * S.CH; i++) if (d[i * 4 + 3] > 8) n++;
    return n;
  };
  ok(foul.CW !== clean.CW || foul.CH !== clean.CH || count(foul) !== count(clean),
     'corruption changes the sprite');

  /* a thrown body has to be able to hurt the player */
  {
    const b = MB.rigid.bodies.find(x => !x.dead);
    if (b) {
      MB.player.dead = false; MB.player.hp = 100; MB.player.invuln = 0;
      MB.state = 'play';
      b.held = null; b.dead = false;
      b.x = MB.player.x; b.y = MB.player.y - MB.player.h * 0.5;
      b.vx = 7; b.vy = 0; b.dangerT = 1.5;
      MB.stepCrush(1 / 60);
      ok(MB.player.hp < 100, 'a thrown body hurts the player');
    }
  }
}

/* the level's collision data drawn over the play layer */
{
  const cv = createCanvas(Math.min(1400, M.L.LW), LV.H);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(M.L.playC, 0, 0);
  for (const p of M.L.plats) {
    cx.fillStyle = p.ground ? 'rgba(240,168,48,.30)' : 'rgba(74,208,122,.34)';
    cx.fillRect(p.x, p.y, p.w, window.PHYSICS.thickOf(p));
    cx.fillStyle = p.ground ? '#f0a830' : '#4ad07a';
    cx.fillRect(p.x, p.y - 1, p.w, 1);
  }
  cx.fillStyle = '#ff3b30';
  cx.fillRect(M.exit.x - 2, M.exit.y - 40, 4, 40);
  dump('out_collision.png', cv);
}

/* ---------------- report ---------------- */
console.log('\n' + '='.repeat(46));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  for (const f of fails.slice(0, 25)) console.log('  - ' + f);
}
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
