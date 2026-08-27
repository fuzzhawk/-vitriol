/* ============================================================
   entities.js — everything that moves.

   All physics constants are PER 1/60 STEP, not per second — the
   MERC FORGE demo fixes its timestep and the handoff (§3.5) warns
   against mixing dt-scaled movement in. The loop in main.js keeps
   that contract; animation timers are the only thing using dt.

   Convention throughout: `x` is the box centre, `y` is the FEET.
   ============================================================ */
window.ENTITIES = (function () {
  "use strict";

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;
  const LV = window.GREEBLEWORKS.LV;

  /* Movement feel, lifted from the tool's demo so the sprite's stride
     still matches the ground it covers. */
  const MOVE = {
    accel: 0.55, maxVX: 2.6, fricGround: 0.80, fricAir: 0.90,
    gravity: 0.36, terminal: 9, jump: -6.1, coyote: 8, crouchMul: 0.55
  };

  function foldAim(aim, face) {
    let local = face > 0 ? aim : (aim > 0 ? Math.PI - aim : -Math.PI - aim);
    return clamp(local, -Math.PI / 2, Math.PI / 2);
  }

  /* ---------------- projectiles ---------------- */
  function Bullet(x, y, a, weapon, friendly, tint) {
    this.x = x; this.y = y;
    this.vx = Math.cos(a) * weapon.speed;
    this.vy = Math.sin(a) * weapon.speed;
    this.life = weapon.life;
    this.dmg = weapon.dmg;
    this.size = weapon.size;
    this.pierce = weapon.pierce || 0;
    this.splash = weapon.splash || 0;
    this.friendly = friendly;
    this.tint = tint || '#ffd8a0';
    this.dead = false;
    this.hitList = null;
  }

  function Particle(x, y, vx, vy, life, col, grav) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.max = life; this.c = col; this.g = grav || 0;
  }

  /* ---------------- pickups ---------------- */
  const PICKUP_KINDS = {
    health: { label: 'MEDPAC', col: '#4ad07a' },
    ammo:   { label: 'AMMO',   col: '#f0a830' },
    weapon: { label: 'WEAPON', col: '#e05a1e' }
  };

  function Pickup(x, y, kind, payload) {
    this.x = x; this.y = y; this.vy = 0; this.kind = kind;
    this.payload = payload; this.t = Math.random() * TAU; this.taken = false;
    this.ground = false;
  }

  /* ---------------- actor base ---------------- */
  function Actor(rig, x, y) {
    this.rig = rig;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.ground = false; this.face = 1;
    this.anim = 'idle'; this.t = 0; this.phase = 0;
    this.aim = 0; this.local = 0;
    this.coyote = 0; this.landT = 0;
    this.hp = 1; this.maxHp = 1;
    this.flash = 0; this.dead = false;
    this.w = rig.w; this.h = rig.h;
  }

  Actor.prototype.animate = function (dt, crouching) {
    let st = 'idle';
    if (!this.ground) st = this.vy < 0 ? 'jump' : 'fall';
    else if (crouching) st = 'crouch';
    else if (Math.abs(this.vx) > 0.25) st = 'run';
    if (this.landT > 0) { this.landT -= dt; st = 'land'; }
    if (st !== this.anim) { this.anim = st; this.t = 0; }
    this.t += dt;
    if (st === 'run') this.phase += Math.abs(this.vx) * dt * 0.9;
    this.frame = this.rig.frameOf(this.anim, this.t, this.phase);
    if (this.flash > 0) this.flash -= dt;
  };

  Actor.prototype.muzzle = function () {
    return this.rig.muzzle(this.anim, this.frame, this.local, this.x, this.y, this.face < 0);
  };

  /* ---------------- player ---------------- */
  function Player(rig, x, y, diff) {
    Actor.call(this, rig, x, y);
    this.maxHp = 100; this.hp = 100;
    this.diff = diff;
    this.weapon = window.WEAPONS.make(rig.gun);
    this.spare = { pistol: Infinity, smg: 0, rifle: 0, cannon: 0, beam: 0 };
    this.spare[rig.gun] = Infinity;   // your own sidearm never runs dry
    this.kick = 0; this.invuln = 0;
    this.checkpoint = { x, y };
    this.kills = 0; this.score = 0;
    this.crouching = false;
    this.dropTimer = 0;
  }
  Player.prototype = Object.create(Actor.prototype);
  Player.prototype.constructor = Player;

  Player.prototype.step = function (world, input, dt) {
    const crouch = input.down && this.ground;
    this.crouching = crouch;
    const spd = crouch ? MOVE.crouchMul : 1;

    const want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.vx += want * MOVE.accel * spd;
    this.vx *= this.ground ? MOVE.fricGround : MOVE.fricAir;
    if (Math.abs(this.vx) < 0.02) this.vx = 0;
    this.vx = clamp(this.vx, -MOVE.maxVX * spd, MOVE.maxVX * spd);

    this.vy += MOVE.gravity;
    this.vy = Math.min(this.vy, MOVE.terminal);

    if (this.ground) this.coyote = MOVE.coyote; else this.coyote--;
    // Down + jump drops through a one-way deck.
    if (input.jumpPressed && input.down && this.ground &&
        this.standingOn && !this.standingOn.ground) {
      this.dropTimer = 8; this.y += 2; this.vy = 1; this.ground = false;
      window.AUDIO.play('land');
    } else if (input.jumpPressed && this.coyote > 0) {
      this.vy = MOVE.jump; this.coyote = 0;
      window.AUDIO.play('jump');
    }
    if (this.dropTimer > 0) this.dropTimer--;

    const wasAir = !this.ground;
    const h = crouch ? this.h * 0.62 : this.h;
    world.move(this, this.w, h, this.dropTimer > 0);

    if (this.ground && wasAir) {
      if (Math.abs(this.vy) < 1) this.landT = 0.16;
      window.AUDIO.play('land');
      if (this.standingOn && this.standingOn.ground) {
        this.checkpoint = { x: this.x, y: this.y };
      }
    }

    /* aim */
    const shoulderY = this.y - h * 0.72;
    const adx = input.aimX - this.x, ady = input.aimY - shoulderY;
    this.aim = Math.atan2(ady, adx);
    if (Math.abs(adx) > 3) this.face = adx > 0 ? 1 : -1;
    this.local = foldAim(this.aim, this.face);

    this.animate(dt, crouch);
    this.kick *= 0.86;
    if (this.invuln > 0) this.invuln -= dt;
  };

  Player.prototype.hurt = function (n) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp -= n * this.diff.dmgIn;
    this.invuln = 0.55; this.flash = 0.25;
    window.AUDIO.play(this.hp <= 0 ? 'die' : 'hurt');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    return true;
  };

  Player.prototype.giveWeapon = function (kind) {
    this.weapon = window.WEAPONS.make(kind);
    if (this.spare[kind] !== Infinity) this.spare[kind] = window.WEAPONS.table[kind].mag * 2;
  };

  /* ---------------- enemy ---------------- */
  function Enemy(rig, x, y, kind, arche, diff, seed) {
    Actor.call(this, rig, x, y);
    this.kind = kind;
    this.A = arche;
    this.diff = diff;
    this.maxHp = Math.round(arche.hp * diff.enemyHp);
    this.hp = this.maxHp;
    this.weapon = window.WEAPONS.table[rig.gun] || window.WEAPONS.table.pistol;
    this.state = 'patrol';
    this.dir = (seed & 1) ? 1 : -1;
    this.cool = 0.4 + (seed % 100) / 100;
    this.burst = 0;
    this.think = 0;
    this.home = { x, y };
    this.hover = (seed % 628) / 100;
    this.flying = !!arche.flying;
    this.deathT = 0;
    this.alerted = false;
  }
  Enemy.prototype = Object.create(Actor.prototype);
  Enemy.prototype.constructor = Enemy;

  Enemy.prototype.step = function (world, player, dt, out) {
    if (this.dead) { this.deathT += dt; return; }

    const dx = player.x - this.x, dy = (player.y - player.h * 0.5) - (this.y - this.h * 0.5);
    const dist = Math.hypot(dx, dy);
    const range = this.diff.aggro * this.A.aggro;
    const sees = dist < range && !player.dead &&
      world.canSee(this.x, this.y - this.h * 0.6, player.x, player.y - player.h * 0.6);

    if (sees && !this.alerted) { this.alerted = true; this.state = 'engage'; }
    if (this.alerted && dist > range * 1.6) this.state = 'patrol';
    else if (sees) this.state = 'engage';

    if (this.flying) this.stepFlying(world, player, dt, dx, dy, dist, sees, out);
    else this.stepWalking(world, player, dt, dx, dist, sees, out);

    this.animate(dt, false);
    this.cool -= dt;
  };

  Enemy.prototype.stepWalking = function (world, player, dt, dx, dist, sees, out) {
    const spd = this.A.speed * this.diff.fireRate;

    if (this.state === 'engage') {
      this.face = dx > 0 ? 1 : -1;
      // Close to a comfortable firing distance, then hold.
      const want = this.A.label === 'HEAVY' ? 110 : 78;
      if (dist > want * 1.25) this.vx += this.face * spd * 0.55;
      else if (dist < want * 0.6) this.vx -= this.face * spd * 0.55;
      else this.vx *= 0.75;
      if (sees) this.tryFire(player, out);
    } else {
      // Patrol the deck, turning at walls and at the edge of the drop.
      this.vx += this.dir * spd * 0.34;
      this.face = this.dir;
      const aheadX = this.x + this.dir * (this.w * 0.5 + 4);
      const edge = world.groundUnder(aheadX, this.y + 2, true);
      if (this.hitWall || !edge || Math.abs(edge.y - this.y) > 24) this.dir *= -1;
      this.think -= dt;
      if (this.think <= 0) { this.think = 1.5 + Math.random() * 2.5; if (Math.random() < 0.3) this.dir *= -1; }
    }

    this.vx *= this.ground ? MOVE.fricGround : MOVE.fricAir;
    this.vx = clamp(this.vx, -MOVE.maxVX * 0.8, MOVE.maxVX * 0.8);
    this.vy += MOVE.gravity;
    this.vy = Math.min(this.vy, MOVE.terminal);
    world.move(this, this.w, this.h, false);
    if (this.y > world.floor) this.kill(out, true);

    const shoulderY = this.y - this.h * 0.72;
    this.aim = Math.atan2((player.y - player.h * 0.55) - shoulderY, player.x - this.x);
    this.local = foldAim(this.aim, this.face);
  };

  Enemy.prototype.stepFlying = function (world, player, dt, dx, dy, dist, sees, out) {
    this.hover += dt * 2.2;
    const spd = this.A.speed;
    if (this.state === 'engage') {
      const want = 92;
      const ux = dx / (dist || 1), uy = dy / (dist || 1);
      const push = dist > want ? 1 : -0.6;
      this.vx += ux * spd * 0.22 * push;
      this.vy += uy * spd * 0.18 * push;
      this.face = dx > 0 ? 1 : -1;
      if (sees) this.tryFire(player, out);
    } else {
      this.vx += this.dir * spd * 0.12;
      this.vy += Math.sin(this.hover * 0.5) * 0.05;
      this.face = this.dir;
      if (this.hitWall) this.dir *= -1;
      if (Math.abs(this.x - this.home.x) > 130) this.dir = this.x > this.home.x ? -1 : 1;
    }
    this.vx *= 0.93; this.vy *= 0.90;
    this.vy += Math.sin(this.hover) * 0.035;
    this.vx = clamp(this.vx, -2.0, 2.0);
    this.vy = clamp(this.vy, -1.8, 1.8);

    // Drones ignore one-way decks but not solid mass.
    const before = this.y;
    world.move(this, this.w, this.h, true);
    if (this.ground) { this.vy = -0.6; this.y = before; this.ground = false; }
    this.y = clamp(this.y, this.h + 6, LV.H - 6);

    const shoulderY = this.y - this.h * 0.72;
    this.aim = Math.atan2((player.y - player.h * 0.55) - shoulderY, player.x - this.x);
    this.local = foldAim(this.aim, this.face);
    // Flyers always read as airborne.
    this.anim = 'fall'; this.ground = false;
  };

  Enemy.prototype.tryFire = function (player, out) {
    if (this.cool > 0) return;
    const rate = this.weapon.rate / this.diff.fireRate;
    if (this.burst > 0) {
      this.burst--;
      this.cool = Math.max(0.08, rate * 1.6);
    } else {
      this.burst = this.A.burst - 1;
      this.cool = this.A.cooldown / this.diff.fireRate;
    }
    const m = this.muzzle();
    const spread = this.weapon.spread * 2.2 * (Math.random() - 0.5) * 2;
    const a = Math.atan2((player.y - player.h * 0.55) - m.y, player.x - m.x) + spread;
    out.bullets.push(new Bullet(m.x, m.y, a, this.weapon, false, this.rig.params.colVisor));
    out.flashes.push({ x: m.x, y: m.y, life: 0.07, r: 7, c: this.rig.params.colVisor });
    window.AUDIO.play('shot', this.weapon.tone, out.distTo(this.x));
  };

  Enemy.prototype.hurtBy = function (n, out) {
    if (this.dead) return;
    this.hp -= n;
    this.flash = 0.12;
    this.alerted = true; this.state = 'engage';
    if (this.hp <= 0) this.kill(out, false);
  };

  Enemy.prototype.kill = function (out, silent) {
    this.dead = true; this.deathT = 0;
    if (!silent) {
      out.explode(this.x, this.y - this.h * 0.5,
        this.rig.params.colAccent, this.rig.params.colVisor, this.A.label === 'HEAVY' ? 1.8 : 1);
      window.AUDIO.play('boom', null, out.distTo(this.x));
    }
  };

  /* ============================================================
     ELDRITCH CRAWLER

     It does not walk. Each tentacle independently releases, casts for
     a new grip on whatever terrain face is in the direction it wants
     to go, and hauls. The body is a mass on the end of those grips:
     it springs toward the seat position the gripped limbs imply, sags
     under gravity, and free-falls the moment nothing is holding on.
     Swinging from an overhead deck comes out of that for free rather
     than being a special case.

     Position is the body CENTRE, not the feet — it spends as much
     time under a catwalk as on top of one.
     ============================================================ */
  const LIMB = {
    reachTime: 0.20,      // seconds to extend a cast
    holdMin: 0.35,        // shortest time a grip is kept
    haul: 0.115,          // spring constant toward the implied seat
    damp: 0.86,
    sag: 0.30,            // fraction of gravity felt while gripping
    strikeTime: 0.16
  };

  function Crawler(rig, x, y, arche, diff, seed) {
    this.rig = rig;
    this.kind = 'crawler';
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.A = arche;
    this.diff = diff;
    this.maxHp = Math.round(arche.hp * diff.enemyHp);
    this.hp = this.maxHp;
    this.w = rig.w; this.h = rig.h;
    this.face = 1;
    this.orient = 'floor';
    this.anim = 'idle'; this.frame = 0; this.t = 0;
    this.flash = 0; this.dead = false; this.deathT = 0;
    this.alerted = false; this.state = 'patrol';
    this.ground = true;          // "attached to something"
    this.slimeT = 0;
    this.strikeCool = 0.8 + (seed % 60) / 60;
    this.dir = (seed & 1) ? 1 : -1;
    this.think = 0;
    this.home = { x, y };
    this.pulse = (seed % 628) / 100;

    const n = rig.socketCount();
    this.limbs = [];
    for (let i = 0; i < n; i++) {
      this.limbs.push({
        i, state: 'idle', anchor: null, cast: null, t: 0,
        variant: i % rig.tent.count,
        bend: ((i % 2) ? 1 : -1) * (8 + (i * 5) % 14),
        phase: (seed * (i + 3) % 628) / 100,
        hold: 0
      });
    }
    /* Stance. This has to be measured against the SILHOUETTE, not the
       centre: a limb is drawn from its socket — already most of a body
       radius out — to its anchor, so a grip planted at 1.5 radii is a
       stub entirely inside the blob. Anchors go out past two radii, and
       the visible span is what is left after the socket offset. */
    this.maxReach = rig.tent.length * 0.95;
    this.minReach = Math.max(rig.radiusMax * 2.0, rig.tent.length * 0.50);
  }

  Crawler.prototype.gripped = function () {
    let n = 0;
    for (const l of this.limbs) if (l.state === 'gripped') n++;
    return n;
  };

  /* Where the body wants to sit, given what is currently holding on. */
  Crawler.prototype.seat = function () {
    let sx = 0, sy = 0, n = 0, best = null, bd = 1e9;
    for (const l of this.limbs) {
      if (l.state !== 'gripped' || !l.anchor) continue;
      const a = l.anchor;
      const reach = this.rig.reach(a.orient || 'floor');
      sx += a.x + a.nx * reach;
      sy += a.y + a.ny * reach;
      n++;
      if (a.dist < bd) { bd = a.dist; best = a; }
    }
    if (!n) return null;
    return { x: sx / n, y: sy / n, lead: best };
  };

  Crawler.prototype.step = function (world, player, dt, out) {
    if (this.dead) { this.deathT += dt; return; }
    this.t += dt;
    this.pulse += dt * 2.4;
    if (this.flash > 0) this.flash -= dt;
    this.strikeCool -= dt;

    const dxp = player.x - this.x;
    const dyp = (player.y - player.h * 0.5) - this.y;
    const dist = Math.hypot(dxp, dyp);
    const range = this.diff.aggro * this.A.aggro;
    const sees = dist < range && !player.dead &&
      world.canSee(this.x, this.y, player.x, player.y - player.h * 0.5);
    if (sees) { this.alerted = true; this.state = 'engage'; }
    else if (this.alerted && dist > range * 1.7) this.state = 'patrol';

    /* where it wants to drag itself */
    let wantX, wantY;
    if (this.state === 'engage') { wantX = dxp; wantY = dyp; }
    else {
      this.think -= dt;
      if (this.think <= 0) { this.think = 2 + Math.random() * 3; if (Math.random() < 0.35) this.dir *= -1; }
      wantX = this.dir; wantY = 0;
      if (Math.abs(this.x - this.home.x) > 150) this.dir = this.x > this.home.x ? -1 : 1;
    }

    this.stepLimbs(world, player, dt, wantX, wantY, dist, sees, out);

    /* body: hauled by whatever is gripping, or falling */
    const seat = this.seat();
    if (seat) {
      this.vx += (seat.x - this.x) * LIMB.haul;
      this.vy += (seat.y - this.y) * LIMB.haul;
      this.vy += MOVE.gravity * LIMB.sag;      // it always hangs a little
      this.vx *= LIMB.damp; this.vy *= LIMB.damp;
      this.ground = true;
      if (seat.lead && seat.lead.orient) this.orient = seat.lead.orient;
    } else {
      this.vy += MOVE.gravity;
      this.vy = Math.min(this.vy, MOVE.terminal);
      this.vx *= 0.99;
      this.ground = false;
      this.orient = 'floor';
    }
    this.vx = clamp(this.vx, -3.4, 3.4);
    this.vy = clamp(this.vy, -3.4, MOVE.terminal);
    this.x += this.vx; this.y += this.vy;

    /* never let it end up inside solid mass */
    const solid = world.solidAt(this.x, this.y, false);
    if (solid) {
      const push = world.surfacesNear(this.x, this.y, this.rig.r * 3);
      if (push.length) {
        let b = push[0];
        for (const c of push) if (c.dist < b.dist) b = c;
        this.x = b.x + b.nx * this.rig.reach(b.orient || 'floor');
        this.y = b.y + b.ny * this.rig.reach(b.orient || 'floor');
        this.vx *= 0.3; this.vy *= 0.3;
      }
    }

    if (Math.abs(this.vx) > 0.05) this.face = this.vx > 0 ? 1 : -1;
    else if (this.state === 'engage') this.face = dxp > 0 ? 1 : -1;

    /* animation: it tenses while any limb is hauling */
    let hauling = false;
    for (const l of this.limbs) if (l.state === 'reaching' || l.state === 'strike') hauling = true;
    const want = this.flash > 0 ? 'hurt' : (hauling ? 'pull' : 'idle');
    if (want !== this.anim) { this.anim = want; this.t = 0; }
    this.frame = this.rig.frameOf(this.anim, this.t);

    /* slime: laid down wherever it is actually touching */
    this.slimeT -= dt;
    if (this.slimeT <= 0 && seat && seat.lead) {
      this.slimeT = 0.14 + Math.random() * 0.12;
      out.addSlime(seat.lead.x, seat.lead.y, seat.lead.nx, seat.lead.ny,
        this.rig.sheet.tentacles ? this.slimeColour() : '#8f6', this.rig.r);
    }

    if (this.y > world.floor + 80) this.kill(out, true);
  };

  Crawler.prototype.slimeColour = function () {
    const pal = window.CRAWLERFORGE.PALETTES[this.rig.params.palette] ||
                window.CRAWLERFORGE.PALETTES.raw;
    return pal.slime;
  };

  Crawler.prototype.stepLimbs = function (world, player, dt, wantX, wantY, dist, sees, out) {
    const rnd = Math.random;
    for (const l of this.limbs) {
      l.t += dt;

      if (l.state === 'strike') {
        const k = clamp(l.t / LIMB.strikeTime, 0, 1);
        l.cast = { x: l.from.x + (l.to.x - l.from.x) * k,
                   y: l.from.y + (l.to.y - l.from.y) * k };
        if (k >= 1) {
          // the lash lands where the player WAS when it started
          const pd = Math.hypot(player.x - l.to.x, (player.y - player.h * 0.5) - l.to.y);
          if (pd < 16 && !player.dead) {
            if (player.hurt(this.A.lash || 10)) out.onCrawlerHit(this, player);
          }
          l.state = 'retract'; l.t = 0;
        }
        continue;
      }
      if (l.state === 'retract') {
        if (l.t > 0.14) { l.state = 'idle'; l.cast = null; l.t = 0; }
        continue;
      }
      if (l.state === 'reaching') {
        const k = clamp(l.t / LIMB.reachTime, 0, 1);
        l.cast = { x: l.from.x + (l.to.x - l.from.x) * k,
                   y: l.from.y + (l.to.y - l.from.y) * k };
        if (k >= 1) { l.state = 'gripped'; l.anchor = l.target; l.hold = 0; l.cast = null; }
        continue;
      }
      if (l.state === 'gripped') {
        l.hold += dt;
        const a = l.anchor;
        const d = Math.hypot(a.x - this.x, a.y - this.y);
        // let go once it is trailing behind, overextended, or just stale
        const behind = ((a.x - this.x) * wantX + (a.y - this.y) * wantY) < -2;
        if (l.hold > LIMB.holdMin && (behind || d > this.maxReach * 1.05 || l.hold > 1.6)) {
          l.state = 'idle'; l.anchor = null; l.t = 0;
        }
        continue;
      }

      /* idle: strike if the player is in reach, otherwise cast for a grip */
      const socket = this.rig.socket(l.i, this.x, this.y, this.face < 0, this.orient);
      if (sees && this.strikeCool <= 0 && dist < this.maxReach * 0.9) {
        this.strikeCool = (this.A.cooldown || 1.4) / this.diff.fireRate;
        l.state = 'strike'; l.t = 0;
        l.from = { x: socket.x, y: socket.y };
        l.to = { x: player.x, y: player.y - player.h * 0.5 };
        out.onCrawlerLash(this, l.to.x, l.to.y);
        continue;
      }
      // stagger the casts so they do not all release at once
      if (l.t < 0.06 + (l.i % 3) * 0.05) continue;
      let target = world.pickAnchor(this.x, this.y, this.minReach, this.maxReach,
                                    wantX, wantY, rnd);
      // In a tight corner there may be nothing at a full stride. Take a
      // short grip rather than freezing with every limb idle.
      if (!target) {
        target = world.pickAnchor(this.x, this.y, this.rig.r * 0.9, this.maxReach,
                                  wantX, wantY, rnd);
      }
      if (!target) { l.t = 0; continue; }
      l.state = 'reaching'; l.t = 0;
      l.target = target;
      l.from = { x: socket.x, y: socket.y };
      l.to = { x: target.x, y: target.y };
    }
  };

  Crawler.prototype.hurtBy = function (n, out) {
    if (this.dead) return;
    this.hp -= n;
    this.flash = 0.14;
    this.alerted = true; this.state = 'engage';
    // chunks come off wherever it was hit
    out.gib(this, Math.min(6, 1 + Math.round(n)));
    if (this.hp <= 0) this.kill(out, false);
  };

  Crawler.prototype.kill = function (out, silent) {
    this.dead = true; this.deathT = 0;
    for (const l of this.limbs) { l.state = 'idle'; l.anchor = null; l.cast = null; }
    if (!silent) {
      out.gib(this, 16);
      out.burst(this);
    }
  };

  /* ============================================================
     OVERLORD — the levitating super blob

     A crawler that has stopped needing the floor. It does not anchor
     to terrain: it hangs in the air on its own and uses its tentacles
     for the two things it has left, lashing and throwing. The rigid
     bodies scattered around the level are its ammunition.

     Fought in three phases that change what it reaches for, so a
     fight has a shape rather than being a damage sponge with a health
     bar over it.
     ============================================================ */
  const OVER = {
    hover: 0.055,        // bob amplitude per step
    drift: 0.020,        // how hard it accelerates toward its station
    damp: 0.955,
    standoff: 108,       // where it likes to sit relative to the player
    grabRange: 150,
    holdTime: 0.85,      // wind-up before a throw, so it can be read
    throwSpeed: 6.2
  };

  function Overlord(rig, x, y, arche, diff, seed) {
    Crawler.call(this, rig, x, y, arche, diff, seed);
    this.kind = 'overlord';
    this.boss = true;
    this.flying = true;
    this.ground = false;
    this.orient = 'floor';       // it never clings, so the row never changes
    this.phase = 1;
    this.phaseT = 0;
    this.grab = null;            // the body it is holding
    this.grabT = 0;
    this.aggroed = false;
    this.stationT = 0;
    this.station = { x, y };
    this.slamT = 0;
    this.vaporT = 0;
    /* Lash range has to cover the standoff it actually keeps, or it
       hovers just outside its own reach and never swings at anything.
       A tentacle strip warps to any length, so a long lash costs
       nothing to draw. */
    this.maxReach = Math.max(rig.tent.length * 1.15, OVER.standoff + 95);
    this.minReach = rig.radiusMax * 1.2;
    this.invuln = 0;
  }
  Overlord.prototype = Object.create(Crawler.prototype);
  Overlord.prototype.constructor = Overlord;

  Overlord.prototype.phaseOf = function () {
    const f = this.hp / this.maxHp;
    return f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  };

  Overlord.prototype.step = function (world, player, dt, out) {
    if (this.dead) { this.deathT += dt; return; }
    this.t += dt;
    this.pulse += dt * 2.2;
    this.phaseT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    this.strikeCool -= dt;

    const ph = this.phaseOf();
    if (ph !== this.phase) {
      this.phase = ph; this.phaseT = 0;
      out.onOverlordPhase(this, ph);
    }

    const dx = player.x - this.x;
    const dy = (player.y - player.h * 0.5) - this.y;
    const dist = Math.hypot(dx, dy);
    /* It is the size of a room; it notices you from further away than
       a merc does, and mostly by how close you are horizontally —
       being on a deck below it is still walking into its arena. */
    const wake = Math.abs(dx) < 300 && Math.abs(dy) < 200;
    if (!this.aggroed && wake && !player.dead) {
      this.aggroed = true; this.alerted = true;
      out.onOverlordWake(this);
    }
    if (!this.aggroed) { this.idleHover(dt); return; }

    /* --- station keeping: hold a standoff, higher in later phases --- */
    this.stationT -= dt;
    if (this.stationT <= 0) {
      this.stationT = 1.4 + Math.random() * 1.2;
      const side = dx > 0 ? -1 : 1;
      const lift = this.phase === 3 ? 78 : this.phase === 2 ? 60 : 46;
      this.station = {
        x: player.x + side * (OVER.standoff + Math.random() * 40),
        y: clamp((player.y - player.h * 0.5) - lift + (Math.random() - 0.5) * 30,
                 this.rig.radiusMax + 8, LV.H - this.rig.radiusMax - 30)
      };
    }
    this.vx += (this.station.x - this.x) * OVER.drift;
    this.vy += (this.station.y - this.y) * OVER.drift;
    this.vy += Math.sin(this.pulse * 0.8) * OVER.hover;
    this.vx *= OVER.damp; this.vy *= OVER.damp;
    this.vx = clamp(this.vx, -2.6, 2.6);
    this.vy = clamp(this.vy, -2.2, 2.2);
    this.x += this.vx; this.y += this.vy;
    this.x = clamp(this.x, 20, out.L.LW - 20);
    this.y = clamp(this.y, this.rig.radiusMax + 6, LV.H - this.rig.radiusMax - 6);
    this.face = dx > 0 ? 1 : -1;

    /* --- vapor: it is always venting --- */
    this.vaporT -= dt;
    if (this.vaporT <= 0) {
      this.vaporT = 0.05;
      out.vapor(this.x + (Math.random() - 0.5) * this.rig.radiusMax * 1.6,
                this.y + (Math.random() - 0.5) * this.rig.radiusMax * 1.4,
                1.1 + this.phase * 0.25);
    }

    this.stepGrab(world, player, dt, dist, out);
    this.stepLimbsBoss(world, player, dt, dist, out);
    this.animateBlob(dt);
  };

  /* Crawler animates inline rather than through Actor.animate, so the
     boss carries its own. It tenses while winding up a throw and
     flinches when hit; otherwise it breathes. */
  Overlord.prototype.animateBlob = function (dt) {
    const want = this.flash > 0 ? 'hurt' : (this.grab ? 'pull' : 'idle');
    if (want !== this.anim) { this.anim = want; this.t = 0; }
    this.t += dt;
    this.frame = this.rig.frameOf(this.anim, this.t);
  };

  Overlord.prototype.idleHover = function (dt) {
    this.vy += Math.sin(this.pulse * 0.6) * OVER.hover * 0.6;
    this.vy *= 0.94; this.vx *= 0.94;
    this.y += this.vy; this.x += this.vx;
    this.animateBlob(dt);
  };

  /* Grab a rigid body, wind up where the player can see it, throw. */
  Overlord.prototype.stepGrab = function (world, player, dt, dist, out) {
    if (this.phase === 1) return;                   // phase 1 is lashes only
    if (this.grab) {
      this.grabT += dt;
      // carry it out to one side while winding up
      const orbit = this.pulse * 2.4;
      const rr = this.rig.radiusMax * 1.5;
      this.grab.x = this.x + Math.cos(orbit) * rr;
      this.grab.y = this.y + Math.sin(orbit) * rr * 0.6 - this.rig.radiusMax * 0.4;
      this.grab.spin = 0.16;
      if (this.grabT >= OVER.holdTime) {
        const tx = player.x, ty = player.y - player.h * 0.5;
        const a = Math.atan2(ty - this.grab.y, tx - this.grab.x);
        const sp = OVER.throwSpeed * (this.phase === 3 ? 1.2 : 1);
        this.grab.held = null;
        this.grab.wake();
        this.grab.vx = Math.cos(a) * sp;
        this.grab.vy = Math.sin(a) * sp;
        this.grab.spin = (Math.random() - 0.5) * 0.5;
        this.grab.dangerT = 1.6;
        this.grab.thrownBy = this;
        out.onOverlordThrow(this, this.grab);
        this.grab = null; this.grabT = 0;
        this.throwCool = this.phase === 3 ? 1.1 : 1.8;
      }
      return;
    }
    this.throwCool = (this.throwCool || 0) - dt;
    if (this.throwCool > 0) return;
    const body = out.rigid.nearest(this.x, this.y, OVER.grabRange, b => !b.dangerT || b.dangerT <= 0);
    if (!body) { this.throwCool = 0.5; return; }
    body.held = this;
    body.wake();
    this.grab = body; this.grabT = 0;
    out.onOverlordGrab(this, body);
  };

  /* Tentacles have nothing to hold onto up here, so they lash and
     coil rather than cast for anchors. */
  Overlord.prototype.stepLimbsBoss = function (world, player, dt, dist, out) {
    for (const l of this.limbs) {
      l.t += dt;
      if (l.state === 'strike') {
        const k = clamp(l.t / LIMB.strikeTime, 0, 1);
        l.cast = { x: l.from.x + (l.to.x - l.from.x) * k,
                   y: l.from.y + (l.to.y - l.from.y) * k };
        if (k >= 1) {
          const pd = Math.hypot(player.x - l.to.x, (player.y - player.h * 0.5) - l.to.y);
          if (pd < 20 && !player.dead) {
            if (player.hurt(this.A.lash || 14)) out.onCrawlerHit(this, player);
          }
          l.state = 'retract'; l.t = 0;
        }
        continue;
      }
      if (l.state === 'retract') {
        if (l.t > 0.16) { l.state = 'idle'; l.cast = null; l.t = 0; }
        continue;
      }
      /* idle: coil in the air, and lash when the player is close */
      const socket = this.rig.socket(l.i, this.x, this.y, this.face < 0, this.orient);
      if (this.strikeCool <= 0 && dist < this.maxReach && !player.dead) {
        // later phases swing more often rather than swinging harder
        this.strikeCool = (this.A.cooldown || 1.2) / this.diff.fireRate /
                          (this.phase === 3 ? 1.8 : this.phase === 2 ? 1.3 : 1);
        l.state = 'strike'; l.t = 0;
        l.from = { x: socket.x, y: socket.y };
        l.to = { x: player.x, y: player.y - player.h * 0.5 };
        out.onCrawlerLash(this, l.to.x, l.to.y);
        continue;
      }
      // resting coil: a slow drifting reach into empty air
      const swirl = this.pulse * 0.7 + l.phase;
      const reach = this.rig.tent.length * (0.34 + 0.14 * Math.sin(swirl));
      const a = Math.atan2(socket.ny, socket.nx) + Math.sin(swirl * 0.6) * 0.5;
      l.anchor = { x: socket.x + Math.cos(a) * reach,
                   y: socket.y + Math.sin(a) * reach };
      l.state = 'coil';
    }
  };

  Overlord.prototype.hurtBy = function (n, out) {
    if (this.dead || this.invuln > 0) return;
    this.hp -= n;
    this.flash = 0.12;
    this.alerted = true; this.aggroed = true;
    out.gib(this, Math.min(4, 1 + Math.round(n * 0.5)));
    out.vapor(this.x + (Math.random() - 0.5) * 20, this.y + (Math.random() - 0.5) * 20, 1.6);
    if (this.hp <= 0) this.kill(out, false);
  };

  Overlord.prototype.kill = function (out, silent) {
    this.dead = true; this.deathT = 0;
    if (this.grab) { this.grab.held = null; this.grab.wake(); this.grab = null; }
    for (const l of this.limbs) { l.state = 'idle'; l.anchor = null; l.cast = null; }
    if (!silent) out.onOverlordDeath(this);
  };

  return {
    Actor, Player, Enemy, Crawler, Overlord, Bullet, Particle, Pickup,
    PICKUP_KINDS, MOVE, LIMB, OVER, foldAim, clamp
  };
})();
