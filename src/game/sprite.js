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
    this.params = params;
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

  return { Rig: Rig };
})();
