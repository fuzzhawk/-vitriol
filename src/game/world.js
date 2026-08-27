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
    const n = Math.round(span * 2.6 * dens);
    const mix = [];
    for (let i = 0; i < n; i++) {
      const r = rng.rnd();
      mix.push(r < 0.44 ? 'grunt' : r < 0.72 ? 'trooper' : r < 0.88 ? 'drone' : 'heavy');
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
        yield { phase: 'rigs', weight: 0.14,
                msg: 'forging hostiles — ' + kind + ' ' + (v + 1) + '/' + variants };
        const params = window.CONFIG.archetypeParams(kind, (cfg.seed + done * 7717 + v * 131) >>> 0, cfg.style);
        rigs[kind].push(new window.SPRITE.Rig(params));
        done++;
      }
    }

    yield { phase: 'deploy', msg: 'deploying hostiles', weight: 0.02 };
    const M = new Mission(L, cfg, playerRig, rigs, mix, diff, opts, rng);
    return M;
  }

  /* ---------------- mission ---------------- */
  function Mission(L, cfg, playerRig, rigs, mix, diff, opts, rng) {
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
      if (Math.abs(e.x - (this.scroll + LV.W / 2)) > LV.W * 1.35) continue;
      e.step(this.world, P, dt, this);
      if (!P.dead && this.state === 'play' && window.PHYSICS.overlap(e, e.w, e.h, P, P.w, P.h)) {
        if (P.hurt(e.A.label === 'HEAVY' ? 14 : 7)) this.shake = Math.min(5, this.shake + 1.2);
      }
    }

    this.stepBullets(dt);
    this.stepParticles(dt);
    this.stepPickups(dt);

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
        if (W.kind !== 'pistol') P.giveWeapon('pistol');
      }
      return;
    }

    W.cool = W.def.rate;
    W.ammo--;
    P.kick = 1;
    this.shake = Math.min(4.5, this.shake + W.def.shake);

    const m = P.muzzle();
    const spread = W.def.spread * (Math.random() - 0.5) * 2;
    const a = P.aim + spread;
    const tint = P.rig.params.colVisor;
    this.bullets.push(new E.Bullet(m.x, m.y, a, W.def, true, tint));
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

      // Two substeps per frame for tile hits, as the demo does.
      for (let s = 0; s < 2 && !removed; s++) {
        b.x += b.vx / 2; b.y += b.vy / 2;

        if (b.x < -20 || b.x > this.L.LW + 20 || b.y < -40 || b.y > LV.H + 60) {
          this.bullets.splice(i, 1); removed = true; break;
        }
        if (this.world.solidAt(b.x, b.y, true)) {
          this.impact(b, -b.vx, -b.vy);
          window.AUDIO.play('hit', null, this.distTo(b.x));
          this.bullets.splice(i, 1); removed = true; break;
        }
        if (b.friendly) {
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (Math.abs(b.x - e.x) < e.w * 0.62 + b.size &&
                b.y > e.y - e.h && b.y < e.y + 2) {
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
    } else {
      P.giveWeapon(p.payload);
      this.say(window.WEAPONS.table[p.payload].label + ' ACQUIRED');
    }
    window.AUDIO.play('pickup');
  };

  Mission.prototype.say = function (text) { this.banner = text; this.bannerT = 2.0; };

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
