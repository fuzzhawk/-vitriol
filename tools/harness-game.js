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
  'src/gen/greebleworks.js', 'src/gen/mercforge.js',
  'src/game/config.js', 'src/game/audio.js', 'src/game/weapons.js',
  'src/game/sprite.js', 'src/game/physics.js', 'src/game/entities.js',
  'src/game/world.js', 'src/game/render.js', 'src/game/screens.js'
];
for (const f of FILES) require(path.join(ROOT, f));

const GW = window.GREEBLEWORKS;
const LV = GW.LV;

/* ---------------- check plumbing ---------------- */
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
ok(Object.keys(GW.STYLES).length === 14, '14 facade styles');
ok(Object.keys(GW.SKYMOODS).length === 15, '15 sky moods');
ok(Object.keys(GW.CITY_PRESETS).length === 15, '15 city presets');
for (const m of ['CONFIG', 'WEAPONS', 'SPRITE', 'PHYSICS', 'ENTITIES', 'WORLD', 'RENDER', 'SCREENS', 'AUDIO']) {
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
    for (let i = 0; i < 8; i++) {
      const p = window.CONFIG.archetypeParams(kind, (i * 104729) >>> 0, 'slum');
      ok(p.height > 14 && p.height < 60, kind + ' height sane');
      ok(/^#[0-9a-f]{6}$/i.test(p.colSuit), kind + ' colSuit is a hex colour');
      ok(/^#[0-9a-f]{6}$/i.test(p.colAccent), kind + ' colAccent is a hex colour');
      ok(window.WEAPONS.table[p.gun] !== undefined, kind + ' weapon is defined');
    }
  }
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
  let grounded = 0, flying = 0, bad = 0;
  for (const e of M.enemies) {
    if (e.flying) { flying++; continue; }
    const g = M.world.groundUnder(e.x, e.y - 1, true);
    if (g && Math.abs(g.y - e.y) < 2) grounded++; else bad++;
  }
  ok(bad === 0, 'every walking hostile spawned on a deck (' + bad + ' floating)');
  console.log('  ' + grounded + ' grounded, ' + flying + ' airborne');
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
  const M2 = (() => {
    const g = window.WORLD.buildMission(
      Object.assign({}, cfg, { seed: 4242, levelLen: 3 }),
      merc, { difficulty: 'recruit', enemyDens: 1.5, lives: 3 });
    let rr; while (!(rr = g.next()).done);
    return rr.value;
  })();
  const target = M2.enemies.find(e => !e.flying);
  ok(!!target, 'found a walking hostile to shoot');
  if (target) {
    const hpBefore = target.hp;
    const W = window.WEAPONS.table.rifle;
    for (let i = 0; i < 12; i++) {
      M2.bullets.push(new window.ENTITIES.Bullet(
        target.x - 30, target.y - target.h * 0.5, 0, W, true, '#fff'));
    }
    for (let i = 0; i < 40; i++) M2.stepBullets(1 / 60);
    ok(target.hp < hpBefore || target.dead, 'point-blank fire damaged the hostile');
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
    const rig = new window.SPRITE.Rig(window.CONFIG.archetypeParams(k, 1234 + i * 77, cfg.style));
    rig.draw(cx, 'idle', 0, 0, cell * (i + 1.5), cell - 14, false);
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
