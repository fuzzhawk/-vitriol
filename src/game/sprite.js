/* ============================================================
   sprite.js — MERC FORGE sheet consumer.

   The sheet contract (handoff §4): columns are animation frames in
   states() order, rows are aim angles spanning -90..+90 inclusive,
   and left-facing is a runtime mirror. Nothing else in the game
   touches SHEET internals; it all goes through a Rig.
   ============================================================ */
window.SPRITE = (function () {
  "use strict";

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function Rig(params) {
    /* Store the EFFECTIVE params, not just the overrides the caller
       passed. forge() merges against P_DEFAULTS internally, so a rig
       built from a partial spec would otherwise report `undefined` for
       everything left unspecified — and anything reading, say, stride
       off it would silently get NaN. */
    this.params = Object.assign({}, window.MERCFORGE.P_DEFAULTS, params);
    this.sheet = window.MERCFORGE.forge(params);
    this.gun = params.gun || 'rifle';
    // Hitbox tracks the sprite, exactly as the tool's demo derives it.
    this.h = params.height * 0.90;
    this.w = Math.max(6, params.height * 0.32);
  }

  /* Aim angle already folded into the facing hemisphere -> sheet row. */
  Rig.prototype.rowFor = function (local) {
    const n = this.sheet.angles.length;
    const deg = local * 180 / Math.PI;
    return clamp(Math.round((deg + 90) / 180 * (n - 1)), 0, n - 1);
  };

  Rig.prototype.colFor = function (state, frame) {
    return this.sheet.colOf(state, frame);
  };

  /* Ground distance one full run cycle covers.

     Each foot's stance runs half the cycle and carries the body two
     strides, so a cycle is four strides of travel. Driving the run
     phase off this rather than off a constant is what stops the feet
     skating: the animation and the ground now advance together. */
  Rig.prototype.cycleDistance = function () {
    const p = this.params;
    const d = 4 * (p.height || 30) * (p.stride || 0.42);
    return Number.isFinite(d) && d > 4 ? d : 40;
  };

  Rig.prototype.framesOf = function (state) { return this.sheet.framesOf(state); };
  Rig.prototype.fpsOf = function (state) { return this.sheet.fpsOf(state); };

  /* Which frame of `state` an entity is showing right now. Run cycles
     off distance travelled so the feet track the ground; everything
     else runs off wall time. */
  Rig.prototype.frameOf = function (state, t, phase) {
    const f = this.framesOf(state);
    if (state === 'run') return Math.floor(phase) % f;
    const i = Math.floor(t * this.fpsOf(state));
    return i % f;
  };

  /* Blit so the sheet anchor (feet centre) lands on (px, py). */
  Rig.prototype.draw = function (ctx, state, frame, local, px, py, flip) {
    const s = this.sheet;
    const col = this.colFor(state, frame);
    const row = this.rowFor(local);
    const x = Math.round(px - (flip ? s.CW - s.anchor.x : s.anchor.x));
    const y = Math.round(py - s.anchor.y);
    const sx = col * s.CW, sy = row * s.CH;
    if (flip) {
      ctx.save();
      ctx.translate(x + s.CW, y);
      ctx.scale(-1, 1);
      ctx.drawImage(s.canvas, sx, sy, s.CW, s.CH, 0, 0, s.CW, s.CH);
      ctx.restore();
    } else {
      ctx.drawImage(s.canvas, sx, sy, s.CW, s.CH, x, y, s.CW, s.CH);
    }
  };

  /* Muzzle position in world space for the frame currently shown. */
  Rig.prototype.muzzle = function (state, frame, local, px, py, flip) {
    const s = this.sheet;
    const mu = s.muzzle[this.rowFor(local)][this.colFor(state, frame)];
    const dx = mu.x - s.anchor.x, dy = mu.y - s.anchor.y;
    return { x: px + (flip ? -dx : dx), y: py + dy };
  };

  /* A single still frame, for menus and the HUD portrait. */
  Rig.prototype.portrait = function (ctx, x, y, scale, state, frame, local) {
    const s = this.sheet;
    const col = this.colFor(state || 'idle', frame || 0);
    const row = this.rowFor(local === undefined ? 0 : local);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.canvas, col * s.CW, row * s.CH, s.CW, s.CH,
      Math.round(x), Math.round(y), Math.round(s.CW * scale), Math.round(s.CH * scale));
    ctx.restore();
  };

  /* ============================================================
     CRAWLER FORGE rig.

     Different sheet contract from MERC FORGE: rows are surface
     ORIENTATIONS rather than aim angles, and it ships a second sheet
     of tentacle strips plus a physics bake that the simulation reads
     its geometry out of.

     Mirroring only applies to the floor and ceiling rows. On a wall
     the creature's facing is up or down, which the sheet has no row
     for, so flipping there would just mirror the drips onto the wrong
     side of the body.
     ============================================================ */
  function CrawlerRig(params) {
    this.params = Object.assign({}, window.CRAWLERFORGE.P_DEFAULTS, params);
    this.sheet = window.CRAWLERFORGE.forge(params);
    this.phys = this.sheet.physics;
    this.tent = this.sheet.tentacles;
    this.kind = 'crawler';
    // The body is addressed by its centre, not its feet: it spends as
    // much time on ceilings as on floors.
    this.r = this.phys.radius;
    this.radiusMax = this.phys.radiusMax;
    this.w = this.phys.radiusMax * 1.5;
    this.h = this.phys.radiusMax * 1.5;
  }

  CrawlerRig.prototype.flippable = function (orient) {
    return orient === 'floor' || orient === 'ceiling';
  };

  CrawlerRig.prototype.cycleDistance = function () { return 24; };   // it has no legs
  CrawlerRig.prototype.framesOf = function (state) { return this.sheet.framesOf(state); };
  CrawlerRig.prototype.fpsOf = function (state) { return this.sheet.fpsOf(state); };

  CrawlerRig.prototype.frameOf = function (state, t) {
    const f = this.framesOf(state);
    return Math.floor(t * this.fpsOf(state)) % f;
  };

  /* Seat offset along a surface normal, straight out of the bake, so
     the blob sits flush against the deck it is gripping. */
  CrawlerRig.prototype.reach = function (orient) {
    const c = this.phys.contacts[orient];
    return c ? c.reach : this.r;
  };

  CrawlerRig.prototype.draw = function (ctx, state, frame, orient, px, py, flip) {
    const s = this.sheet;
    const col = s.colOf(state, frame);
    const row = s.rowOf(orient);
    const doFlip = flip && this.flippable(orient);
    const x = Math.round(px - s.anchor.x);
    const y = Math.round(py - s.anchor.y);
    const sx = col * s.CW, sy = row * s.CH;
    if (doFlip) {
      ctx.save();
      ctx.translate(x + s.CW, y);
      ctx.scale(-1, 1);
      ctx.drawImage(s.canvas, sx, sy, s.CW, s.CH, 0, 0, s.CW, s.CH);
      ctx.restore();
    } else {
      ctx.drawImage(s.canvas, sx, sy, s.CW, s.CH, x, y, s.CW, s.CH);
    }
  };

  /* Where tentacle i leaves the body, in world space, with the outward
     normal it should leave along. */
  CrawlerRig.prototype.socket = function (i, px, py, flip, orient) {
    const list = this.phys.sockets;
    const so = list[((i % list.length) + list.length) % list.length];
    const m = (flip && this.flippable(orient)) ? -1 : 1;
    return { x: px + so.x * m, y: py + so.y, nx: so.nx * m, ny: so.ny };
  };

  CrawlerRig.prototype.socketCount = function () { return this.phys.sockets.length; };

  CrawlerRig.prototype.eyes = function (px, py, flip, orient) {
    const m = (flip && this.flippable(orient)) ? -1 : 1;
    return this.phys.eyes.map(e => ({ x: px + e.x * m, y: py + e.y, r: e.r }));
  };

  /* A random interior point, for a chunk to fly off from. */
  CrawlerRig.prototype.gib = function (px, py, flip, orient) {
    const g = this.phys.gibs;
    if (!g.length) return { x: px, y: py };
    const p = g[(Math.random() * g.length) | 0];
    const m = (flip && this.flippable(orient)) ? -1 : 1;
    return { x: px + p.x * m, y: py + p.y };
  };

  return { Rig: Rig, CrawlerRig: CrawlerRig };
})();
