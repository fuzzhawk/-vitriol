/* ============================================================
   world.js — a mission: baked level + forged rigs + live sim.

   buildMission() is a generator, like the GREEBLEWORKS bakers it
   wraps, so the loading screen can drive it against a frame budget
   and report real progress instead of a fake bar.
   ============================================================ */
window.WORLD = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const E = window.ENTITIES;
  const LV = GW.LV;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;

  /* ---------------- build ---------------- */

  /* Which hostiles this level fields, and how many of each. Longer
     levels earn heavier opposition; difficulty scales the count. */
  function roster(cfg, opts, rng) {
    const span = cfg.levelLen;
    const dens = opts.enemyDens;
    const n = Math.round(span * 2.9 * dens);
    const mix = [];
    for (let i = 0; i < n; i++) {
      const r = rng.rnd();
      mix.push(r < 0.36 ? 'grunt' : r < 0.60 ? 'trooper' :
               r < 0.76 ? 'drone' : r < 0.90 ? 'crawler' : 'heavy');
    }
    return mix;
  }

  function* buildMission(cfg, mercParams, opts) {
    const rng = GW.makeRng((cfg.seed ^ 0xa11e) >>> 0);
    const diff = window.CONFIG.DIFFICULTY[opts.difficulty] || window.CONFIG.DIFFICULTY.regular;

    /* ---- 1. bake the level (the expensive part) ---- */
    let r;
    const gen = GW.buildLevel(cfg);
    while (!(r = gen.next()).done) yield { phase: 'level', msg: r.value, weight: 0.78 };
    const L = r.value;

    /* ---- 2. forge the player ---- */
    yield { phase: 'rigs', msg: 'forging operative', weight: 0.06 };
    const playerRig = new window.SPRITE.Rig(mercParams);

    /* ---- 3. forge hostiles, two silhouettes per archetype ----
       One rig is shared by every instance of a variant: a sheet is
       ~40-90 KB of canvas and takes real time to build, so this is
       the difference between a snappy load and a stall. */
    const mix = roster(cfg, opts, rng);
    const kinds = Array.from(new Set(mix));
    const rigs = {};
    let done = 0;
    for (const kind of kinds) {
      rigs[kind] = [];
      const variants = (kind === 'heavy' || kind === 'drone') ? 1 : 2;
      for (let v = 0; v < variants; v++) {
        const seed = (cfg.seed + done * 7717 + v * 131) >>> 0;
        if (kind === 'crawler') {
          yield { phase: 'rigs', weight: 0.14,
                  msg: 'growing crawler ' + (v + 1) + '/' + variants + ' — meat and metal' };
          rigs[kind].push(new window.SPRITE.CrawlerRig(window.CONFIG.crawlerParams(seed, cfg, v, opts.crawler)));
        } else {
          yield { phase: 'rigs', weight: 0.14,
                  msg: 'forging hostiles — ' + kind + ' ' + (v + 1) + '/' + variants };
          rigs[kind].push(new window.SPRITE.Rig(window.CONFIG.archetypeParams(
            kind, seed, cfg.style,
            window.CONFIG.CORRUPT_RATE[opts.difficulty] || 0.30)));
        }
        done++;
      }
    }

    /* ---- 4. scrap: the physics debris scattered through the level ---- */
    yield { phase: 'rigs', weight: 0.04, msg: 'stamping scrap — crates and rubble' };
    const scrapSeed = (cfg.seed ^ 0x5c2a) >>> 0;
    // the build screen's debris panel overrides the level-matched roll
    const scrapParams = window.CONFIG.scrapParamsFor(scrapSeed, cfg, opts.scrap);
    const scrap = window.CONFIG.tintScrapToLevel(
      window.SCRAPFORGE.forgeSet(scrapSeed, { params: scrapParams }), cfg);

    /* ---- 5. the prototype ----
       One rolled weapon per run, and a second player rig holding it, so
       picking it up swaps the sprite instead of stalling the frame on a
       300ms re-forge mid-fight. */
    yield { phase: 'rigs', weight: 0.05, msg: 'recovering prototype schematics' };
    // the build screen's weapon forge wins over the seeded roll
    const proto = opts.proto || window.WEAPONS.rollProto(GW.makeRng((cfg.seed ^ 0x9ea9) >>> 0));
    const protoRig = new window.SPRITE.Rig(
      Object.assign({}, mercParams, { gun: proto.base, gunSize: 1.25,
                                      colGun: proto.tint, twoHanded: true }));

    /* ---- 6. the boss ---- */
    yield { phase: 'rigs', weight: 0.10, msg: 'something large is already here' };
    const overlordRig = new window.SPRITE.CrawlerRig(
      opts.boss || window.CONFIG.overlordParams((cfg.seed ^ 0x0b055) >>> 0, cfg));

    yield { phase: 'deploy', msg: 'deploying hostiles', weight: 0.02 };
    const M = new Mission(L, cfg, playerRig, rigs, mix, diff, opts, rng, scrap,
                          overlordRig, proto, protoRig);
    return M;
  }

  /* ---------------- mission ---------------- */
  function Mission(L, cfg, playerRig, rigs, mix, diff, opts, rng, scrap,
                   overlordRig, proto, protoRig) {
    this.L = L; this.cfg = cfg; this.diff = diff; this.opts = opts;
    this.world = new window.PHYSICS.World(L.plats);
    this.rigs = rigs;

    const byX = L.plats.filter(p => p.ground).sort((a, b) => a.x - b.x);
    this.ground = byX;
    const first = byX[0] || { x: 40, y: LV.H * 0.7, w: 200 };
    const last = byX[byX.length - 1] || first;

    this.player = new E.Player(playerRig, first.x + Math.min(48, first.w * 0.3), first.y, diff);
    this.player.checkpoint = { x: this.player.x, y: this.player.y };
    this.lives = diff.lives;

    /* Extraction pad sits on the last ground run. */
    this.exit = { x: last.x + last.w - Math.min(60, last.w * 0.4), y: last.y, r: 26 };

    this.enemies = [];
    this.bullets = [];
    this.parts = [];
    this.flashes = [];
    this.pickups = [];
    this.slime = [];        // trail stuck to the terrain
    this.gibs = [];         // chunks with their own little physics
    this.vapors = [];       // the demonic exhaust the corrupted vent
    this.scrap = scrap || null;
    this.rigid = new window.RIGID.Sim(this.world);
    this.rigid.levelWidth = L.LW;
    if (scrap) this.scatterScrap(rng);
    this.overlordRig = overlordRig || null;
    this.proto = proto || null;
    this.protoRig = protoRig || null;
    this.overlord = null;
    this.bossBanner = 0;
    if (overlordRig) this.placeOverlord();
    if (proto) this.placeProto();
    this.spawnEnemies(mix, rng);

    this.scroll = 0;
    this.shake = 0;
    this.time = 0;
    this.state = 'play';      // play | dead | won
    this.endT = 0;
    this.kills = 0;
    this.totalEnemies = this.enemies.length;
    this.hitFlash = 0;
    this.banner = null;
    this.bannerT = 0;
  }

  Mission.prototype.spawnEnemies = function (mix, rng) {
    const L = this.L;
    const safeX = this.player.x + 210;      // don't spawn on top of the drop-in
    const exitX = this.exit.x;
    const decks = L.plats.filter(p => p.x + p.w > safeX);
    if (!decks.length) return;

    for (let i = 0; i < mix.length; i++) {
      const kind = mix[i];
      const variants = this.rigs[kind];
      if (!variants || !variants.length) continue;
      const rig = variants[rng.int(0, variants.length - 1)];

      let x, y;
      if (kind === 'crawler') {
        // Seat it against a real surface, using the reach the generator
        // measured, so it starts flush instead of hovering.
        let placed = null;
        for (let t = 0; t < 30 && !placed; t++) {
          const px = rng.range(safeX, Math.max(safeX + 1, L.LW - 40));
          const py = rng.range(LV.H * 0.20, LV.H * 0.90);
          const cands = this.world.surfacesNear(px, py, 70);
          if (!cands.length) continue;
          const c = cands[rng.int(0, cands.length - 1)];
          if (!c.orient) continue;
          placed = { x: c.x + c.nx * rig.reach(c.orient),
                     y: c.y + c.ny * rig.reach(c.orient), orient: c.orient };
        }
        if (!placed) continue;
        const cr = new E.Crawler(rig, placed.x, placed.y,
          window.CONFIG.ARCHETYPES.crawler, this.diff, (this.cfg.seed + i * 40503) >>> 0);
        cr.orient = placed.orient;
        this.enemies.push(cr);
        continue;
      }
      if (kind === 'drone') {
        x = rng.range(safeX, Math.max(safeX + 1, L.LW - 40));
        y = rng.range(LV.H * 0.28, LV.H * 0.62);
      } else {
        // Stand them on a deck wide enough to patrol.
        let deck = null;
        for (let tries = 0; tries < 24 && !deck; tries++) {
          const c = decks[rng.int(0, decks.length - 1)];
          if (c.w >= rig.w * 3 && c.x + c.w > safeX) deck = c;
        }
        if (!deck) continue;
        x = clamp(rng.range(deck.x + rig.w, deck.x + deck.w - rig.w), safeX, L.LW - 20);
        y = deck.y;
      }
      const e = new E.Enemy(rig, x, y, kind, window.CONFIG.ARCHETYPES[kind],
                            this.diff, (this.cfg.seed + i * 2654435761) >>> 0);
      e.corrupt = rig.params.corrupt || 0;
      if (e.corrupt > 0) {
        // whatever is in them makes them meaner
        e.maxHp = Math.round(e.maxHp * (1 + e.corrupt * 0.5));
        e.hp = e.maxHp;
      }
      this.enemies.push(e);
    }

    /* Something has to be guarding the way out. */
    const last = this.ground[this.ground.length - 1];
    if (last && this.rigs.heavy && this.rigs.heavy.length) {
      const g = new E.Enemy(this.rigs.heavy[0], this.exit.x - 70, last.y, 'heavy',
                            window.CONFIG.ARCHETYPES.heavy, this.diff, (this.cfg.seed ^ 0xbeef) >>> 0);
      g.isGuard = true;
      this.enemies.push(g);
    }
  };

  /* Scatter debris along the ground runs. Bodies start asleep, so a
     level full of crates costs nothing until something disturbs one. */
  Mission.prototype.scatterScrap = function (rng) {
    const kinds = window.SCRAPFORGE.KINDS;
    const runs = this.ground;
    if (!runs.length) return;
    const want = Math.round(this.L.LW / 105);
    const safeX = this.player.x + 90;      // not on top of the drop-in
    for (let i = 0; i < want; i++) {
      const run = runs[rng.int(0, runs.length - 1)];
      if (run.w < 44) continue;
      if (run.x + run.w < safeX) continue;
      const kind = kinds[rng.int(0, kinds.length - 1)];
      const sheet = this.scrap[kind];
      if (!sheet) continue;
      const x = rng.range(Math.max(run.x + 14, safeX), run.x + run.w - 14);
      // Seat it exactly on the collision box. The box is already inset
      // inside the silhouette, so this beds the piece into the deck;
      // the extra pixel of clearance that used to be here is what made
      // scattered debris look pasted on top of the ground.
      const b = new window.RIGID.Body(sheet, x, run.y - sheet.body.halfH, 0);
      // stack a second piece on some of them
      b.asleep = true; b.rest = 99;
      this.rigid.add(b);
      if (rng.chance(0.34)) {
        const k2 = kinds[rng.int(0, kinds.length - 1)];
        const s2 = this.scrap[k2];
        if (s2) {
          const t = new window.RIGID.Body(s2, x + rng.range(-4, 4),
            run.y - sheet.body.halfH * 2 - s2.body.halfH, 0);
          t.asleep = true; t.rest = 99;
          this.rigid.add(t);
        }
      }
    }
  };

  /* The boss holds the ground before the extraction pad — you have to
     go through it, and there is room to fight. */
  Mission.prototype.placeOverlord = function () {
    const last = this.ground[this.ground.length - 1];
    if (!last) return;
    const x = Math.max(this.player.x + 400, this.exit.x - 210);
    const y = clamp(last.y - 78, this.overlordRig.radiusMax + 14, LV.H - 40);
    const O = new E.Overlord(this.overlordRig, x, y,
      window.CONFIG.ARCHETYPES.overlord, this.diff, (this.cfg.seed ^ 0xb055) >>> 0);
    this.overlord = O;
    this.enemies.push(O);
  };

  /* ---------------- debris ---------------- */

  /* Splinters off a body, coloured from the piece that was hit. */
  Mission.prototype.chipBody = function (b, n) {
    const pal = window.SCRAPFORGE.PALETTES[b.sheet.palette] ||
                window.SCRAPFORGE.PALETTES.steel;
    for (let i = 0; i < n; i++) {
      const g = b.b.gibs.length ? b.b.gibs[(Math.random() * b.b.gibs.length) | 0] : { x: 0, y: 0 };
      const a = Math.random() * TAU, sp = 0.6 + Math.random() * 2.2;
      this.parts.push(new E.Particle(b.x + g.x, b.y + g.y,
        Math.cos(a) * sp, Math.sin(a) * sp - 0.5,
        0.25 + Math.random() * 0.4,
        Math.random() < 0.4 ? pal.trim[1] : pal.body[Math.random() < 0.5 ? 0 : 1], 0.08));
    }
  };

  Mission.prototype.breakBody = function (b) {
    if (b.dead) return;
    b.dead = true;
    if (b.held && b.held.grab === b) { b.held.grab = null; b.held = null; }
    this.chipBody(b, 16);
    const pal = window.SCRAPFORGE.PALETTES[b.sheet.palette] ||
                window.SCRAPFORGE.PALETTES.steel;
    this.explode(b.x, b.y, pal.body[0], pal.mark, 0.8);
    window.AUDIO.play('boom', null, this.distTo(b.x));
    // things keep useful items in crates
    if (Math.random() < 0.30) {
      const r = Math.random();
      this.pickups.push(new E.Pickup(b.x, b.y,
        r < 0.45 ? 'health' : 'ammo', r < 0.45 ? 25 : null));
    }
  };

  /* A body moving fast enough hurts whatever it lands on — which is
     the entire point of the boss picking them up. */
  Mission.prototype.stepCrush = function (dt) {
    const P = this.player;
    if (P.dead || this.state !== 'play') return;
    for (const b of this.rigid.bodies) {
      if (b.dead || b.held) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < 2.2 && b.dangerT <= 0) continue;
      if (Math.abs(b.x - P.x) > b.hw + P.w * 0.5) continue;
      if (Math.abs(b.y - (P.y - P.h * 0.5)) > b.hh + P.h * 0.5) continue;
      const dmg = Math.min(34, 6 + speed * 3.2 * (b.mass * 0.6 + 0.5));
      if (P.hurt(dmg)) {
        this.hitFlash = 0.32;
        this.shake = Math.min(6, this.shake + 2.0);
        b.vx *= -0.3; b.vy *= -0.3;
        b.dangerT = 0;
        this.chipBody(b, 6);
      }
    }
    // thrown debris also mangles other hostiles
    for (const b of this.rigid.bodies) {
      if (b.dead || b.held || b.dangerT <= 0) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < 2.6) continue;
      for (const e of this.enemies) {
        if (e.dead || e === b.thrownBy) continue;
        if (Math.abs(b.x - e.x) > b.hw + e.w * 0.5) continue;
        const ey = e.kind === 'crawler' || e.kind === 'overlord' ? e.y : e.y - e.h * 0.5;
        if (Math.abs(b.y - ey) > b.hh + e.h * 0.5) continue;
        e.hurtBy(speed * 2.2, this);
        b.dangerT = 0;
        b.vx *= -0.25; b.vy *= -0.25;
        break;
      }
    }
  };

  /* The prototype sits on the last stretch of ground before the boss —
     far enough in that you have earned it, close enough that you get to
     use it on what it was clearly left there for. */
  Mission.prototype.placeProto = function () {
    const O = this.overlord;
    const wantX = O ? O.x - 190 : this.exit.x - 300;
    let best = null, bd = 1e9;
    for (const run of this.ground) {
      if (run.x + run.w < this.player.x + 260) continue;
      const cx = clamp(wantX, run.x + 14, run.x + run.w - 14);
      const d = Math.abs(cx - wantX);
      if (d < bd) { bd = d; best = { x: cx, y: run.y }; }
    }
    if (!best) return;
    const p = new E.Pickup(best.x, best.y - 2, 'weapon', 'proto');
    p.proto = this.proto;
    p.ground = true;
    p.shrine = true;              // drawn with a pedestal and a beam
    this.pickups.push(p);
    this.protoPickup = p;
  };

  /* ---------------- demonic vapour ---------------- */
  Mission.prototype.vapor = function (x, y, scale) {
    if (this.vapors.length > 260) this.vapors.shift();
    const s = scale || 1;
    this.vapors.push({
      x, y,
      vx: (Math.random() - 0.5) * 0.34,
      vy: -0.16 - Math.random() * 0.30,
      r: (3 + Math.random() * 6) * s,
      grow: 0.10 + Math.random() * 0.16,
      life: 0.85 + Math.random() * 1.1, max: 1.95,
      spin: (Math.random() - 0.5) * 0.06,
      rot: Math.random() * TAU
    });
  };

  Mission.prototype.stepVapor = function (dt) {
    for (let i = this.vapors.length - 1; i >= 0; i--) {
      const v = this.vapors[i];
      v.life -= dt;
      if (v.life <= 0) { this.vapors.splice(i, 1); continue; }
      v.x += v.vx; v.y += v.vy;
      v.vy *= 0.985; v.vx *= 0.99;
      v.r += v.grow;
      v.rot += v.spin;
    }
  };

  /* ---------------- boss callbacks ---------------- */
  Mission.prototype.onOverlordWake = function (O) {
    this.say('THE OVERLORD STIRS');
    this.bossBanner = 3.2;
    this.shake = Math.min(6, this.shake + 3);
    window.AUDIO.play('alarm');
    for (let i = 0; i < 26; i++) this.vapor(O.x + (Math.random() - 0.5) * 60,
                                            O.y + (Math.random() - 0.5) * 50, 1.8);
  };
  Mission.prototype.onOverlordPhase = function (O, ph) {
    this.say('OVERLORD — PHASE ' + ph);
    this.shake = Math.min(6, this.shake + 2.4);
    O.invuln = 0.6;
    window.AUDIO.play('alarm');
    for (let i = 0; i < 30; i++) this.vapor(O.x + (Math.random() - 0.5) * 70,
                                            O.y + (Math.random() - 0.5) * 60, 2.0);
  };
  Mission.prototype.onOverlordGrab = function (O, body) {
    window.AUDIO.play('hit', null, this.distTo(O.x));
  };
  Mission.prototype.onOverlordThrow = function (O, body) {
    this.shake = Math.min(5, this.shake + 1.4);
    window.AUDIO.play('lash', null, this.distTo(O.x));
  };
  Mission.prototype.onOverlordDeath = function (O) {
    this.shake = 8;
    this.kills++;
    this.player.score += O.A.score;
    this.say('OVERLORD DOWN');
    window.AUDIO.play('boom', null, 0);
    for (let i = 0; i < 60; i++) this.vapor(O.x + (Math.random() - 0.5) * 90,
                                            O.y + (Math.random() - 0.5) * 80, 2.4);
    this.gib(O, 40);
    this.explode(O.x, O.y, '#ff5a3d', '#ffd08a', 2.6);
    // it drops everything worth having
    for (let i = 0; i < 3; i++)
      this.pickups.push(new E.Pickup(O.x + (i - 1) * 16, O.y, 'health', 40));
    this.pickups.push(new E.Pickup(O.x, O.y - 10, 'weapon', 'cannon'));
  };

  /* ---------------- helpers used by entities ---------------- */
  Mission.prototype.distTo = function (x) {
    return clamp(Math.abs(x - (this.scroll + LV.W / 2)) / (LV.W * 1.1), 0, 1);
  };

  Mission.prototype.explode = function (x, y, c1, c2, scale) {
    this.shake = Math.min(6, this.shake + 3.4 * (scale || 1));
    const n = Math.round(26 * (scale || 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (0.5 + Math.random() * 3) * (scale || 1);
      this.parts.push(new E.Particle(x, y, Math.cos(a) * s, Math.sin(a) * s,
        0.35 + Math.random() * 0.5, i % 2 ? c1 : c2, 0.09));
    }
    this.flashes.push({ x, y, life: 0.18, r: 26 * (scale || 1), c: c2 });
  };

  Mission.prototype.impact = function (b, nx, ny) {
    const n = b.size > 2 ? 14 : 6;
    for (let i = 0; i < n; i++) {
      this.parts.push(new E.Particle(b.x, b.y,
        (nx / 6) * (Math.random() * 0.6) + (Math.random() - 0.5) * 2.2,
        (ny / 6) * (Math.random() * 0.6) + (Math.random() - 0.5) * 2.2,
        0.18 + Math.random() * 0.25, i % 3 ? b.tint : '#ffffff', 0.06));
    }
    if (b.splash) {
      this.explode(b.x, b.y, '#ffb254', b.tint, 0.8);
      const R = b.splash;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - b.x, (e.y - e.h * 0.5) - b.y);
        if (d < R) e.hurtBy(b.dmg * (1 - d / R) * 0.7, this);
      }
    }
  };

  /* ---------------- simulation ---------------- */
  Mission.prototype.update = function (dt, input) {
    this.time += dt;
    if (this.bannerT > 0) this.bannerT -= dt;

    const P = this.player;

    if (this.state === 'play' && !P.dead) {
      /* aim target in world space */
      input.aimX = input.cursorX + this.scroll;
      input.aimY = input.cursorY;
      P.step(this.world, input, dt);
      if (P.y > this.world.floor) {           // pit
        P.hp = 0; P.dead = true;
        window.AUDIO.play('die');
      }
      P.x = clamp(P.x, 8, this.L.LW - 8);
      this.fire(input, dt);
    } else if (P.dead && this.state === 'play') {
      this.state = 'dead'; this.endT = 0;
    }

    /* enemies */
    for (const e of this.enemies) {
      if (e.dead) { e.deathT += dt; continue; }
      // Only simulate what's near the view; the rest hold position.
      // The boss is never culled: it owns the arena you are fighting in.
      if (!e.boss && Math.abs(e.x - (this.scroll + LV.W / 2)) > LV.W * 1.35) continue;
      e.step(this.world, P, dt, this);
      /* Corrupted mercs vent, and ride a little off the deck. The lift
         is cosmetic — it is applied at draw time, not to the collision
         position — so the thing you shoot at is still where it stands. */
      if (e.corrupt > 0) {
        e.corruptT = (e.corruptT || 0) + dt;
        e.lift = (1.5 + Math.sin(e.corruptT * 2.2) * 1.2) * Math.min(1, e.corrupt * 1.3);
        e.ventT = (e.ventT || 0) - dt;
        if (e.ventT <= 0 && Math.abs(e.x - (this.scroll + LV.W / 2)) < LV.W) {
          e.ventT = 0.20 + Math.random() * 0.22;
          this.vapor(e.x + (Math.random() - 0.5) * e.w,
                     e.y - e.h * (0.3 + Math.random() * 0.6), 0.55 + e.corrupt * 0.5);
        }
      }
      if (!P.dead && this.state === 'play') {
        const touching = e.kind === 'crawler'
          ? Math.hypot(P.x - e.x, (P.y - P.h * 0.5) - e.y) < e.rig.r + P.w * 0.5
          : window.PHYSICS.overlap(e, e.w, e.h, P, P.w, P.h);
        if (touching && P.hurt(e.A.label === 'HEAVY' ? 14 : e.kind === 'crawler' ? 9 : 7)) {
          this.shake = Math.min(5, this.shake + 1.2);
        }
      }
    }

    this.stepBullets(dt);
    this.stepParticles(dt);
    this.stepPickups(dt);
    this.stepSlime(dt);
    this.stepGibs(dt);
    this.stepVapor(dt);
    this.rigid.step(dt, b => { /* settled */ });
    this.stepCrush(dt);

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= dt;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }

    /* extraction */
    if (this.state === 'play' && !P.dead &&
        Math.abs(P.x - this.exit.x) < this.exit.r && Math.abs(P.y - this.exit.y) < 46) {
      this.state = 'won'; this.endT = 0;
      window.AUDIO.play('extract');
    }
    if (this.state !== 'play') this.endT += dt;

    /* camera: lead the player, bias toward the cursor, clamp to level */
    const target = P.x - LV.W / 2 + (input.cursorX - LV.W / 2) * 0.20;
    this.scroll += (target - this.scroll) * Math.min(1, 0.12 * dt * 60);
    this.scroll = clamp(this.scroll, 0, Math.max(0, this.L.LW - LV.W));
    this.shake *= 0.86;
    if (this.hitFlash > 0) this.hitFlash -= dt;
  };

  Mission.prototype.fire = function (input, dt) {
    const P = this.player, W = P.weapon;
    W.cool -= dt;
    if (W.reloading > 0) {
      W.reloading -= dt;
      if (W.reloading <= 0) {
        const take = P.spare[W.kind] === Infinity ? W.def.mag
          : Math.min(W.def.mag, P.spare[W.kind]);
        W.ammo = take;
        if (P.spare[W.kind] !== Infinity) P.spare[W.kind] -= take;
      }
      return;
    }
    if (input.reloadPressed && W.ammo < W.def.mag &&
        (P.spare[W.kind] === Infinity || P.spare[W.kind] > 0)) {
      W.reloading = W.def.reload; window.AUDIO.play('reload'); return;
    }
    if (!input.fire || W.cool > 0) return;
    if (W.ammo <= 0) {
      if (P.spare[W.kind] === Infinity || P.spare[W.kind] > 0) {
        W.reloading = W.def.reload; window.AUDIO.play('reload');
      } else {
        W.cool = 0.3; window.AUDIO.play('dry');
        // the prototype is the run's prize; it never falls back
        if (W.kind !== 'pistol' && W.kind !== 'proto') P.giveWeapon('pistol');
      }
      return;
    }

    W.cool = W.def.rate;
    W.ammo--;
    P.kick = 1;
    this.shake = Math.min(4.5, this.shake + W.def.shake);

    const m = P.muzzle();
    const tint = W.def.tint || P.rig.params.colVisor;
    const n = W.def.count || 1;
    for (let k = 0; k < n; k++) {
      // a single round gets a jittered spread; a burst gets a fan
      const off = n === 1 ? (Math.random() - 0.5) * 2
                          : ((k / (n - 1)) - 0.5) * 2 + (Math.random() - 0.5) * 0.4;
      this.bullets.push(new E.Bullet(m.x, m.y, P.aim + W.def.spread * off,
                                     W.def, true, tint));
    }
    const a = P.aim;
    this.flashes.push({ x: m.x, y: m.y, life: 0.06, r: W.def.size > 2 ? 16 : 9, c: tint });
    for (let i = 0; i < 4; i++) {
      this.parts.push(new E.Particle(m.x, m.y,
        Math.cos(a) * (1 + Math.random() * 2) + (Math.random() - 0.5),
        Math.sin(a) * (1 + Math.random() * 2) + (Math.random() - 0.5),
        0.12 + Math.random() * 0.1, tint, 0));
    }
    window.AUDIO.play('shot', W.def.tone, 0);
  };

  Mission.prototype.stepBullets = function (dt) {
    const P = this.player;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      let removed = false;

      /* Prototype steering, applied once per frame rather than per
         substep so the turn rate does not depend on substep count. */
      if (b.drop) b.vy += b.drop;
      if (b.homing && b.friendly) {
        const t = this.homingTarget(b);
        if (t) {
          const ty = t.kind === 'crawler' || t.kind === 'overlord' ? t.y : t.y - t.h * 0.5;
          const want = Math.atan2(ty - b.y, t.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let d = want - cur;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          const na = cur + clamp(d, -b.homing * 6, b.homing * 6);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      if (b.trail) {
        b.trail.push(b.x, b.y);
        if (b.trail.length > 10) b.trail.splice(0, 2);
      }

      // Two substeps per frame for tile hits, as the demo does.
      for (let s = 0; s < 2 && !removed; s++) {
        b.x += b.vx / 2; b.y += b.vy / 2;

        if (b.x < -20 || b.x > this.L.LW + 20 || b.y < -40 || b.y > LV.H + 60) {
          this.bullets.splice(i, 1); removed = true; break;
        }
        /* Debris is checked before terrain: a crate in front of a wall
           should eat the shot, and shoving it is most of why it is
           there in the first place. */
        const body = this.rigid.hitTest(b.x, b.y, b.size);
        if (body) {
          /* Hit hard enough to be worth doing. Debris that twitches
             when shot reads as scenery; debris that skids across the
             deck is a thing you can use. */
          const push = b.dmg * 1.5 + b.size * 1.6;
          body.applyImpulse(b.vx * push * 0.30, b.vy * push * 0.30 - 0.9, b.x, b.y);
          if (body.hurt(b.dmg)) {
            this.chipBody(body, 5);
            window.AUDIO.play('splat', null, this.distTo(body.x));
          } else {
            this.chipBody(body, 2);
          }
          if (body.hp <= 0) this.breakBody(body);
          this.impact(b, -b.vx, -b.vy);
          window.AUDIO.play('hit', null, this.distTo(b.x));
          this.bullets.splice(i, 1); removed = true; break;
        }
        if (this.world.solidAt(b.x, b.y, true)) {
          if (b.bounce > 0) {
            /* Ricochet. Back the bullet out, then reflect off whichever
               axis was actually blocked — testing each separately is
               what makes it skid along a floor instead of reversing. */
            b.bounce--;
            b.x -= b.vx / 2; b.y -= b.vy / 2;
            if (this.world.solidAt(b.x + b.vx, b.y, true)) b.vx = -b.vx;
            if (this.world.solidAt(b.x, b.y + b.vy, true)) b.vy = -b.vy;
            b.vx *= 0.86; b.vy *= 0.86;
            this.impact(b, -b.vx, -b.vy);
            window.AUDIO.play('hit', null, this.distTo(b.x));
            continue;
          }
          this.impact(b, -b.vx, -b.vy);
          window.AUDIO.play('hit', null, this.distTo(b.x));
          this.bullets.splice(i, 1); removed = true; break;
        }
        if (b.friendly) {
          for (const e of this.enemies) {
            if (e.dead) continue;
            const hit = e.kind === 'crawler'
              // a blob is a disc around its centre, not a standing box
              ? Math.hypot(b.x - e.x, b.y - e.y) < e.rig.r + b.size
              : (Math.abs(b.x - e.x) < e.w * 0.62 + b.size &&
                 b.y > e.y - e.h && b.y < e.y + 2);
            if (hit) {
              if (b.hitList && b.hitList.indexOf(e) >= 0) continue;
              e.hurtBy(b.dmg, this);
              this.impact(b, -b.vx, -b.vy);
              window.AUDIO.play('flesh', null, this.distTo(b.x));
              if (e.dead) {
                this.kills++;
                P.score += e.A.score;
                this.maybeDrop(e);
              }
              if (b.pierce > 0) {
                b.pierce--;
                (b.hitList || (b.hitList = [])).push(e);
              } else { this.bullets.splice(i, 1); removed = true; }
              break;
            }
          }
        } else if (!P.dead &&
            Math.abs(b.x - P.x) < P.w * 0.6 + b.size && b.y > P.y - P.h && b.y < P.y + 2) {
          if (P.hurt(b.dmg * 3.2)) {
            this.hitFlash = 0.3;
            this.shake = Math.min(5, this.shake + 1.1);
          }
          this.impact(b, -b.vx, -b.vy);
          this.bullets.splice(i, 1); removed = true;
        }
      }
      if (!removed && b.life <= 0) this.bullets.splice(i, 1);
    }
  };

  /* Nearest live hostile ahead of a homing round. Deliberately narrow:
     a bullet that turns toward anything on screen feels like it is
     playing the game for you. */
  Mission.prototype.homingTarget = function (b) {
    let best = null, bd = 130 * 130;
    const ang = Math.atan2(b.vy, b.vx);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      const d = dx * dx + dy * dy;
      if (d > bd) continue;
      let off = Math.atan2(dy, dx) - ang;
      while (off > Math.PI) off -= TAU;
      while (off < -Math.PI) off += TAU;
      if (Math.abs(off) > 1.0) continue;      // only what is roughly ahead
      bd = d; best = e;
    }
    return best;
  };

  Mission.prototype.maybeDrop = function (e) {
    const r = Math.random();
    if (r < 0.16) this.pickups.push(new E.Pickup(e.x, e.y - 4, 'health', 30));
    else if (r < 0.42) this.pickups.push(new E.Pickup(e.x, e.y - 4, 'ammo', null));
    else if (r < 0.52) this.pickups.push(new E.Pickup(e.x, e.y - 4, 'weapon', e.rig.gun));
  };

  Mission.prototype.stepPickups = function (dt) {
    const P = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      if (!p.ground) {
        p.vy += E.MOVE.gravity * 0.6;
        const g = this.world.groundUnder(p.x, p.y, true);
        p.y += p.vy;
        if (g && p.y >= g.y) { p.y = g.y; p.vy = 0; p.ground = true; }
        if (p.y > LV.H + 40) { this.pickups.splice(i, 1); continue; }
      }
      if (!P.dead && Math.abs(p.x - P.x) < 14 && Math.abs(p.y - (P.y - P.h * 0.4)) < 22) {
        this.take(p);
        this.pickups.splice(i, 1);
      }
    }
  };

  Mission.prototype.take = function (p) {
    const P = this.player;
    if (p.kind === 'health') {
      P.hp = Math.min(P.maxHp, P.hp + p.payload);
      this.say('+' + p.payload + ' VITALS');
    } else if (p.kind === 'ammo') {
      const k = P.weapon.kind;
      if (P.spare[k] !== Infinity) P.spare[k] += P.weapon.def.mag;
      P.weapon.ammo = P.weapon.def.mag;
      this.say('AMMO RESUPPLY');
    } else if (p.payload === 'proto' && p.proto) {
      P.weapon = window.WEAPONS.make('proto', p.proto);
      P.spare.proto = Infinity;
      if (this.protoRig) P.rig = this.protoRig;   // it looks like what it is now
      this.say(p.proto.label + ' RECOVERED');
      this.bannerT = 3.2;
      this.shake = Math.min(5, this.shake + 2);
      window.AUDIO.play('extract');
      this.protoTaken = true;
    } else {
      P.giveWeapon(p.payload);
      this.say(window.WEAPONS.table[p.payload].label + ' ACQUIRED');
    }
    window.AUDIO.play('pickup');
  };

  Mission.prototype.say = function (text) { this.banner = text; this.bannerT = 2.0; };

  /* ---------------- crawler hooks ----------------
     The Crawler calls back into the mission for anything that leaves
     a mark on the world, so the entity itself stays about locomotion. */

  /* Slime is laid where a tentacle is actually gripping, oriented to
     that surface's normal so it pools on a deck and runs down a wall. */
  Mission.prototype.addSlime = function (x, y, nx, ny, col, r) {
    if (this.slime.length > 220) this.slime.shift();
    this.slime.push({
      x, y, nx, ny, col,
      r: r * (0.34 + Math.random() * 0.30),
      life: 7.5 + Math.random() * 5, max: 12.5,
      drip: Math.random() * 6
    });
  };

  /* Chunks of the thing. They bounce off terrain, smear slime where
     they land, and are the main reason shooting one feels good. */
  Mission.prototype.gib = function (cr, n) {
    const col = cr.slimeColour();
    const pal = window.CRAWLERFORGE.PALETTES[cr.rig.params.palette] ||
                window.CRAWLERFORGE.PALETTES.raw;
    for (let i = 0; i < n; i++) {
      if (this.gibs.length > 140) this.gibs.shift();
      const g = cr.rig.gib(cr.x, cr.y, cr.face < 0, cr.orient);
      const a = Math.random() * TAU, sp = 0.7 + Math.random() * 2.6;
      this.gibs.push({
        x: g.x, y: g.y,
        vx: Math.cos(a) * sp + cr.vx * 0.4,
        vy: Math.sin(a) * sp - 0.8,
        life: 1.1 + Math.random() * 1.5, max: 2.6,
        size: Math.random() < 0.3 ? 3 : 2,
        spin: (Math.random() - 0.5) * 0.4,
        rot: Math.random() * TAU,
        col: Math.random() < 0.28 ? pal.metal[1] : (Math.random() < 0.5 ? pal.meat[0] : pal.meat[1]),
        wet: col, rest: 0
      });
    }
  };

  Mission.prototype.burst = function (cr) {
    this.shake = Math.min(6, this.shake + 3.0);
    const pal = window.CRAWLERFORGE.PALETTES[cr.rig.params.palette] ||
                window.CRAWLERFORGE.PALETTES.raw;
    this.explode(cr.x, cr.y, pal.meat[0], pal.glow, 1.2);
    this.addSlime(cr.x, cr.y, 0, 1, pal.slime, cr.rig.r * 2.4);
    window.AUDIO.play('splat', null, this.distTo(cr.x));
  };

  Mission.prototype.onCrawlerLash = function (cr, tx, ty) {
    window.AUDIO.play('lash', null, this.distTo(cr.x));
  };

  Mission.prototype.onCrawlerHit = function (cr, player) {
    this.hitFlash = 0.3;
    this.shake = Math.min(5, this.shake + 1.4);
    const pal = window.CRAWLERFORGE.PALETTES[cr.rig.params.palette] ||
                window.CRAWLERFORGE.PALETTES.raw;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU, sp = 0.6 + Math.random() * 1.8;
      this.parts.push(new E.Particle(player.x, player.y - player.h * 0.5,
        Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.3, pal.slime, 0.08));
    }
  };

  Mission.prototype.stepSlime = function (dt) {
    for (let i = this.slime.length - 1; i >= 0; i--) {
      const s = this.slime[i];
      s.life -= dt;
      s.drip += dt * 0.6;
      if (s.life <= 0) this.slime.splice(i, 1);
    }
  };

  Mission.prototype.stepGibs = function (dt) {
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.life -= dt;
      if (g.life <= 0) { this.gibs.splice(i, 1); continue; }
      if (g.rest > 0) { g.rest -= dt; continue; }
      g.vy += E.MOVE.gravity * 0.55;
      g.vy = Math.min(g.vy, 7);
      g.rot += g.spin;
      const nx = g.x + g.vx, ny = g.y + g.vy;
      if (this.world.solidAt(nx, ny, true)) {
        // stick where it hits, and leave a smear behind
        g.vx *= -0.22; g.vy *= -0.25;
        g.spin *= 0.4;
        if (Math.abs(g.vy) < 0.5) {
          g.rest = g.life;
          if (Math.random() < 0.55) this.addSlime(g.x, g.y, 0, -1, g.wet, 5);
        }
        g.x += g.vx; g.y += g.vy;
      } else { g.x = nx; g.y = ny; }
      if (g.y > LV.H + 60) this.gibs.splice(i, 1);
    }
  };

  Mission.prototype.stepParticles = function (dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      p.vx *= 0.94; p.vy *= 0.94;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
  };

  /* Respawn at the last ground platform touched. */
  Mission.prototype.respawn = function () {
    const P = this.player;
    this.lives--;
    if (this.lives < 0) return false;
    P.hp = P.maxHp; P.dead = false;
    P.x = P.checkpoint.x; P.y = P.checkpoint.y;
    P.vx = 0; P.vy = 0; P.invuln = 2.0; P.flash = 0;
    P.weapon.ammo = P.weapon.def.mag; P.weapon.reloading = 0;
    this.state = 'play'; this.endT = 0;
    this.bullets.length = 0;
    this.gibs.length = 0;
    this.vapors.length = 0;
    for (const b of this.rigid.bodies) { b.dangerT = 0; b.thrownBy = null; }
    // Let anything that was chasing lose the thread.
    for (const e of this.enemies) if (!e.dead) { e.alerted = false; e.state = 'patrol'; e.burst = 0; }
    this.say('RESPAWN');
    return true;
  };

  Mission.prototype.stats = function () {
    const P = this.player;
    const timeBonus = Math.max(0, Math.round(3000 - this.time * 12));
    const healthBonus = Math.round(P.hp * 8);
    return {
      kills: this.kills, total: this.totalEnemies,
      time: this.time, score: P.score,
      timeBonus, healthBonus,
      final: P.score + (this.state === 'won' ? timeBonus + healthBonus : 0),
      lives: this.lives
    };
  };

  return { buildMission, Mission };
})();
