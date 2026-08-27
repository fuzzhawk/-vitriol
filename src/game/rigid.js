/* ============================================================
   rigid.js — rigid bodies for the debris SCRAP FORGE bakes.

   Not a general physics engine: a small impulse solver sized for a
   side-scroller with a few dozen crates in it. Bodies are boxes with
   linear velocity, a spin used for drawing, and the mass, bounce and
   friction the generator measured off their own silhouettes.

   Rotation is visual only. Rotating collision on a 20-pixel sprite
   buys almost nothing you can see and costs an SAT solver plus every
   tunnelling edge case that comes with it; a spinning box that
   collides as an upright box reads correctly at this scale.
   ============================================================ */
window.RIGID = (function () {
  "use strict";

  const LV = window.GREEBLEWORKS.LV;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;

  const GRAV = 0.34;
  const TERMINAL = 8.5;
  const SLEEP_V = 0.045;      // below this for a while, stop simulating
  const SLEEP_T = 0.7;

  function Body(sheet, x, y, seedSpin) {
    this.sheet = sheet;
    this.b = sheet.body;               // the intact bake
    this.frame = 0;
    this.x = x; this.y = y;            // centre
    this.vx = 0; this.vy = 0;
    this.rot = 0;
    this.spin = seedSpin || 0;
    this.hw = this.b.halfW;
    this.hh = this.b.halfH;
    this.mass = Math.max(0.05, this.b.mass);
    this.invMass = 1 / this.mass;
    this.hp = this.b.hp;
    this.maxHp = this.b.hp;
    this.rest = 0;                     // seconds spent nearly still
    this.asleep = false;
    this.held = null;                  // the entity carrying it, if any
    this.thrownBy = null;
    this.dangerT = 0;                  // while > 0 it hurts what it hits
    this.dead = false;
    this.kind = this.b.kind;
  }

  Body.prototype.wake = function () { this.asleep = false; this.rest = 0; };

  Body.prototype.applyImpulse = function (ix, iy, atX, atY) {
    this.wake();
    this.vx += ix * this.invMass;
    this.vy += iy * this.invMass;
    // off-centre hits spin it, which is the whole reason to shoot a crate
    if (atX !== undefined) {
      const rx = atX - this.x, ry = atY - this.y;
      this.spin += (rx * iy - ry * ix) * this.invMass * 0.006;
      this.spin = clamp(this.spin, -0.5, 0.5);
    }
  };

  /* Damage steps the sprite through its baked damage states, and each
     state has its own smaller body — a shot-up crate really is a
     smaller obstacle. */
  Body.prototype.hurt = function (n) {
    this.hp -= n;
    this.wake();
    const frames = this.sheet.frames;
    const want = clamp(frames - 1 - Math.floor((this.hp / this.maxHp) * frames), 0, frames - 1);
    if (want !== this.frame) {
      this.frame = want;
      const nb = this.sheet.bodies[want];
      if (nb) { this.hw = nb.halfW; this.hh = nb.halfH; }
      return true;                     // changed state: caller may spawn chips
    }
    return false;
  };

  /* ---------------- world ---------------- */
  function Sim(world) {
    this.world = world;
    this.bodies = [];
  }

  Sim.prototype.add = function (b) { this.bodies.push(b); return b; };

  /* Terrain resolution, axis separated, using the same plats data the
     rest of the game collides against. */
  Sim.prototype.solveTerrain = function (b, dt) {
    const W = this.world;

    b.x += b.vx;
    // horizontal: find the deepest overlap with any solid run
    for (const p of W.near(b.x - b.hw - 4, b.x + b.hw + 4)) {
      if (!p.ground) continue;
      const top = p.y, bot = p.y + window.PHYSICS.thickOf(p);
      if (b.y + b.hh <= top || b.y - b.hh >= bot) continue;
      if (b.x + b.hw <= p.x || b.x - b.hw >= p.x + p.w) continue;
      const pushL = (p.x - (b.x + b.hw));          // negative
      const pushR = ((p.x + p.w) - (b.x - b.hw));  // positive
      const push = Math.abs(pushL) < Math.abs(pushR) ? pushL : pushR;
      b.x += push;
      if (Math.sign(push) !== Math.sign(b.vx)) {
        b.vx = -b.vx * b.b.bounce;
        b.spin *= 0.6;
      }
    }

    b.y += b.vy;
    b.onGround = false;
    for (const p of W.near(b.x - b.hw, b.x + b.hw)) {
      const top = p.y, bot = p.y + window.PHYSICS.thickOf(p);
      if (b.x + b.hw <= p.x || b.x - b.hw >= p.x + p.w) continue;
      if (b.vy >= 0) {
        // land on top — decks catch it the same way they catch a merc
        if (b.y + b.hh >= top && b.y + b.hh - b.vy <= top + 1.5) {
          b.y = top - b.hh;
          if (b.vy > 0.9) { b.vy = -b.vy * b.b.bounce; b.spin *= 0.55; }
          else { b.vy = 0; }
          b.onGround = true;
          b.vx *= (1 - b.b.friction * 0.28);
          b.spin *= (1 - b.b.friction * 0.30);
        }
      } else if (p.ground) {
        if (b.y - b.hh <= bot && b.y - b.hh - b.vy >= bot - 1.5) {
          b.y = bot + b.hh;
          b.vy = -b.vy * b.b.bounce * 0.5;
        }
      }
    }
  };

  /* Pairwise separation. O(n^2) over a list that is a few dozen long
     at most, and only over awake bodies. */
  Sim.prototype.solvePairs = function () {
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.held) continue;
      for (let j = i + 1; j < list.length; j++) {
        const c = list[j];
        if (c.dead || c.held) continue;
        if (a.asleep && c.asleep) continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const ox = (a.hw + c.hw) - Math.abs(dx);
        if (ox <= 0) continue;
        const oy = (a.hh + c.hh) - Math.abs(dy);
        if (oy <= 0) continue;

        const inv = a.invMass + c.invMass;
        if (inv <= 0) continue;
        // separate along the shallower axis
        if (ox < oy) {
          const s = Math.sign(dx) || 1;
          a.x -= s * ox * (a.invMass / inv);
          c.x += s * ox * (c.invMass / inv);
          const rel = c.vx - a.vx;
          if (rel * s < 0) {
            const e = Math.min(a.b.bounce, c.b.bounce);
            const jimp = -(1 + e) * rel / inv;
            a.vx -= jimp * a.invMass; c.vx += jimp * c.invMass;
          }
        } else {
          const s = Math.sign(dy) || 1;
          a.y -= s * oy * (a.invMass / inv);
          c.y += s * oy * (c.invMass / inv);
          const rel = c.vy - a.vy;
          if (rel * s < 0) {
            const e = Math.min(a.b.bounce, c.b.bounce);
            const jimp = -(1 + e) * rel / inv;
            a.vy -= jimp * a.invMass; c.vy += jimp * c.invMass;
            // resting on each other: kill the jitter
            if (Math.abs(rel) < 0.5) { a.vy *= 0.5; c.vy *= 0.5; }
          }
        }
        a.wake(); c.wake();
      }
    }
  };

  Sim.prototype.step = function (dt, onSettle) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.dead) { this.bodies.splice(i, 1); continue; }
      if (b.held) { b.rot += b.spin * 0.4; b.spin *= 0.97; continue; }
      if (b.dangerT > 0) b.dangerT -= dt;

      if (b.asleep) continue;

      b.vy += GRAV;
      b.vy = clamp(b.vy, -TERMINAL, TERMINAL);
      b.vx = clamp(b.vx, -12, 12);
      this.solveTerrain(b, dt);
      b.rot += b.spin;
      b.spin *= 0.985;

      if (b.y > LV.H + 90) { b.dead = true; continue; }
      b.x = clamp(b.x, 4, (this.levelWidth || 1e9) - 4);

      // sleep once it has stopped doing anything interesting
      const still = Math.abs(b.vx) < SLEEP_V && Math.abs(b.vy) < SLEEP_V &&
                    Math.abs(b.spin) < 0.01 && b.onGround;
      if (still) {
        b.rest += dt;
        if (b.rest > SLEEP_T) {
          b.asleep = true;
          b.vx = b.vy = b.spin = 0;
          // snap the drawn angle to a quarter turn so it rests flat
          b.rot = Math.round(b.rot / (Math.PI / 2)) * (Math.PI / 2);
          if (onSettle) onSettle(b);
        }
      } else b.rest = 0;
    }
    this.solvePairs();
    /* Pair separation moves bodies without asking the terrain, so a
       stack being squeezed could push its bottom box through the deck.
       One positional pass afterwards puts anything that ended up
       inside solid mass back on top of it. */
    for (const b of this.bodies) {
      if (b.dead || b.held || b.asleep) continue;
      this.depenetrate(b);
    }
  };

  /* Lift a body out of any solid run it is overlapping. */
  Sim.prototype.depenetrate = function (b) {
    for (const p of this.world.near(b.x - b.hw, b.x + b.hw)) {
      if (!p.ground) continue;
      const top = p.y, bot = p.y + window.PHYSICS.thickOf(p);
      if (b.x + b.hw <= p.x || b.x - b.hw >= p.x + p.w) continue;
      if (b.y + b.hh <= top || b.y - b.hh >= bot) continue;
      const up = (top - b.hh) - b.y;          // negative: move up
      const down = (bot + b.hh) - b.y;        // positive: move down
      if (Math.abs(up) <= Math.abs(down)) {
        b.y += up;
        if (b.vy > 0) b.vy = 0;
        b.onGround = true;
      } else {
        b.y += down;
        if (b.vy < 0) b.vy = 0;
      }
    }
  };

  /* Ray a bullet against the boxes. Returns the nearest hit. */
  Sim.prototype.hitTest = function (x, y, r) {
    let best = null, bd = 1e9;
    for (const b of this.bodies) {
      if (b.dead || b.held) continue;
      const dx = Math.abs(x - b.x) - b.hw, dy = Math.abs(y - b.y) - b.hh;
      if (dx > r || dy > r) continue;
      const d = Math.max(dx, dy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };

  /* Does an entity box overlap any body? Used for crush damage. */
  Sim.prototype.overlapping = function (x, y, hw, hh, minDanger) {
    for (const b of this.bodies) {
      if (b.dead || b.held) continue;
      if (minDanger && b.dangerT <= 0) continue;
      if (Math.abs(x - b.x) < b.hw + hw && Math.abs(y - b.y) < b.hh + hh) return b;
    }
    return null;
  };

  /* Nearest body a grabber can reach. */
  Sim.prototype.nearest = function (x, y, maxR, filter) {
    let best = null, bd = maxR * maxR;
    for (const b of this.bodies) {
      if (b.dead || b.held) continue;
      if (filter && !filter(b)) continue;
      const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };

  return { Body, Sim, GRAV, TERMINAL };
})();
