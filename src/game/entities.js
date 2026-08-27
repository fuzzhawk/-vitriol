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

  return {
    Actor, Player, Enemy, Bullet, Particle, Pickup,
    PICKUP_KINDS, MOVE, foldAim, clamp
  };
})();
