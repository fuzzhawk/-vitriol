/* ============================================================
   physics.js — collision against GREEBLEWORKS level data.

   buildLevel() hands back `plats` and the handoff is explicit that
   this is the collision data already (§6):

     {x, y, w, ground, thin}   y is the TOP of the deck surface

   ground:true  — solid mass continuing to the bottom of the frame,
                  so it collides on every face. Gaps between ground
                  runs are pits.
   ground:false — a floating deck: one-way, landable from above only,
                  and droppable through on demand.

   The tool's demo sampled a tile grid every 5-6px, which the handoff
   flags as "will tunnel at high speed". Levels here are rect lists,
   not grids, so this does a real swept test per axis instead.
   ============================================================ */
window.PHYSICS = (function () {
  "use strict";

  const LV = window.GREEBLEWORKS.LV;
  const DECK_H = 20;        // platTile.height
  const THIN_H = 14;        // thinTile.height
  const BUCKET = 128;       // spatial index cell, px

  function World(plats) {
    this.plats = plats;
    this.solids = plats.filter(p => p.ground);
    this.decks = plats.filter(p => !p.ground);
    // Bucket by x so a moving box only tests what is near it.
    this.index = new Map();
    for (const p of plats) {
      const a = Math.floor(p.x / BUCKET), b = Math.floor((p.x + p.w) / BUCKET);
      for (let i = a; i <= b; i++) {
        if (!this.index.has(i)) this.index.set(i, []);
        this.index.get(i).push(p);
      }
    }
    this.floor = LV.H + 48;   // below this is a pit kill
  }

  World.prototype.near = function (x0, x1) {
    const a = Math.floor(x0 / BUCKET), b = Math.floor(x1 / BUCKET);
    const seen = new Set(), out = [];
    for (let i = a; i <= b; i++) {
      const list = this.index.get(i);
      if (!list) continue;
      for (const p of list) if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
    return out;
  };

  const thickOf = p => p.ground ? (LV.H + 64 - p.y) : (p.thin ? THIN_H : DECK_H);

  /* Is this point inside solid mass? Used for spawn validation and
     bullet collision. One-way decks count as solid for bullets. */
  World.prototype.solidAt = function (x, y, includeDecks) {
    for (const p of this.near(x, x)) {
      if (!p.ground && !includeDecks) continue;
      if (x < p.x || x > p.x + p.w) continue;
      if (y >= p.y && y <= p.y + thickOf(p)) return p;
    }
    return null;
  };

  /* Ground height directly under (x, y), searching downward. Returns
     null when there is nothing below — i.e. a pit. */
  World.prototype.groundUnder = function (x, y, includeDecks) {
    let best = null;
    for (const p of this.near(x, x)) {
      if (!p.ground && !includeDecks) continue;
      if (x < p.x || x > p.x + p.w) continue;
      if (p.y >= y - 1 && (best === null || p.y < best.y)) best = p;
    }
    return best;
  };

  /* Move an entity box by its velocity, resolving per axis.
     `o` needs {x, y, vx, vy}; x is the box centre, y is the FEET.
     Sets o.ground, and o.hitWall / o.hitCeil for the caller. */
  World.prototype.move = function (o, w, h, dropThrough) {
    const half = w / 2;
    o.hitWall = false; o.hitCeil = false;
    const wasFeet = o.y;

    /* ---- horizontal ---- */
    if (o.vx !== 0) {
      const targetX = o.x + o.vx;
      const dir = o.vx > 0 ? 1 : -1;
      // Sweep the leading edge across the span it covers this step.
      const lead0 = o.x + dir * half, lead1 = targetX + dir * half;
      let stopX = null;
      for (const p of this.near(Math.min(lead0, lead1) - 2, Math.max(lead0, lead1) + 2)) {
        if (!p.ground) continue;                     // decks never block sideways
        const top = p.y, bot = p.y + thickOf(p);
        // Vertical overlap: the box spans feet-h .. feet.
        if (o.y - h >= bot || o.y <= top) continue;
        const face = dir > 0 ? p.x : p.x + p.w;
        if (dir > 0 ? (lead0 <= face && lead1 >= face) : (lead0 >= face && lead1 <= face)) {
          const cand = face - dir * half;
          if (stopX === null || (dir > 0 ? cand < stopX : cand > stopX)) stopX = cand;
        }
      }
      if (stopX !== null) { o.x = stopX - dir * 0.01; o.vx = 0; o.hitWall = true; }
      else o.x = targetX;
    }

    /* ---- vertical ---- */
    o.ground = false;
    const targetY = o.y + o.vy;
    if (o.vy >= 0) {
      let landY = null, landOn = null;
      for (const p of this.near(o.x - half, o.x + half)) {
        if (o.x + half <= p.x || o.x - half >= p.x + p.w) continue;
        if (!p.ground) {
          if (dropThrough) continue;
          // One-way: only catches feet that started at or above the deck.
          if (wasFeet > p.y + 0.51) continue;
        }
        if (targetY >= p.y && wasFeet <= p.y + Math.max(1, o.vy)) {
          if (landY === null || p.y < landY) { landY = p.y; landOn = p; }
        }
      }
      if (landY !== null) { o.y = landY; o.vy = 0; o.ground = true; o.standingOn = landOn; }
      else o.y = targetY;
    } else {
      let ceilY = null;
      for (const p of this.near(o.x - half, o.x + half)) {
        if (!p.ground) continue;                     // you can jump up through decks
        if (o.x + half <= p.x || o.x - half >= p.x + p.w) continue;
        const bot = p.y + thickOf(p);
        if (targetY - h <= bot && wasFeet - h >= bot - Math.max(1, -o.vy)) {
          if (ceilY === null || bot > ceilY) ceilY = bot;
        }
      }
      if (ceilY !== null) { o.y = ceilY + h + 0.01; o.vy = 0; o.hitCeil = true; }
      else o.y = targetY;
    }
    return o;
  };

  /* Two boxes overlap? Both are centre-x / feet-y. */
  function overlap(a, aw, ah, b, bw, bh) {
    return Math.abs(a.x - b.x) < (aw + bw) / 2 &&
           a.y > b.y - bh && a.y - ah < b.y;
  }

  /* Line of sight between two points, blocked by solid mass only. */
  World.prototype.canSee = function (x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.min(64, Math.ceil(d / 7));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, false)) return false;
    }
    return true;
  };

  /* ============================================================
     Surface queries — what the crawler grips.

     A crawler does not walk on `plats`, it grabs them: the top of a
     deck, the underside of a catwalk, the vertical face where one
     ground run steps up against another. Each candidate is a point on
     a rect face plus that face's outward normal, which is what tells
     the sprite which orientation row to use and how far to sit off
     the surface.
     ============================================================ */
  const FACE_ORIENT = {         // outward normal -> sheet row
    '0,-1': 'floor',            // top of a deck: the blob sits on it
    '0,1': 'ceiling',           // underside: it hangs from it
    '1,0': 'wallL',             // face points right, so the wall is on its left
    '-1,0': 'wallR'
  };

  /* Closest point on the axis-aligned segment (ax,ay)-(bx,by). */
  function closestOnSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return { x: ax, y: ay };
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: ax + dx * t, y: ay + dy * t };
  }

  /* Every grippable point within `maxR` of (x, y). */
  World.prototype.surfacesNear = function (x, y, maxR) {
    const out = [];
    const r2 = maxR * maxR;
    for (const p of this.near(x - maxR, x + maxR)) {
      const th = thickOf(p);
      const top = p.y, bot = p.y + th;
      const faces = [
        [p.x, top, p.x + p.w, top, 0, -1]                     // walkable top
      ];
      if (!p.ground) {
        // A deck is grippable all the way round; ground mass runs off
        // the bottom of the frame, so it has no underside to hang from.
        faces.push([p.x, bot, p.x + p.w, bot, 0, 1]);
      }
      faces.push([p.x, top, p.x, Math.min(bot, LV.H), -1, 0]);
      faces.push([p.x + p.w, top, p.x + p.w, Math.min(bot, LV.H), 1, 0]);

      for (const f of faces) {
        /* Sample ALONG the face, not just its nearest point. A crawler
           standing on a long deck is closest to the spot directly
           under it, and if that is the only candidate the anchor
           search finds nothing beyond its own minimum stride and the
           creature never takes a step. Walking a deck means reaching
           further along the same face. */
        const ax = f[0], ay = f[1], bx = f[2], by = f[3];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = len ? (bx - ax) / len : 0, uy = len ? (by - ay) / len : 0;
        const c0 = closestOnSeg(x, y, ax, ay, bx, by);
        const t0 = (c0.x - ax) * ux + (c0.y - ay) * uy;
        const step = Math.max(7, maxR / 5);
        let seenT = -1e9;
        for (let s = -maxR; s <= maxR + 0.001; s += step) {
          const t = s < -t0 ? 0 : (t0 + s > len ? len : t0 + s);
          if (Math.abs(t - seenT) < 1) continue;      // clamped duplicates
          seenT = t;
          const px = ax + ux * t, py = ay + uy * t;
          const dx = px - x, dy = py - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          out.push({
            x: px, y: py, nx: f[4], ny: f[5], plat: p,
            dist: Math.sqrt(d2),
            orient: FACE_ORIENT[f[4] + ',' + f[5]]
          });
        }
      }
    }
    return out;
  };

  /* The best grip in a wanted direction: prefer points that lie the
     way the crawler is trying to travel, and that are a comfortable
     stride away rather than right under it. */
  World.prototype.pickAnchor = function (x, y, minR, maxR, wantX, wantY, rnd) {
    const cands = this.surfacesNear(x, y, maxR);
    if (!cands.length) return null;
    let best = null, bs = -1e9;
    const wl = Math.hypot(wantX, wantY) || 1;
    const ux = wantX / wl, uy = wantY / wl;
    for (const c of cands) {
      if (c.dist < minR) continue;
      const dx = (c.x - x) / (c.dist || 1), dy = (c.y - y) / (c.dist || 1);
      // dot with the wanted heading, plus a bonus for using most of
      // the reach, plus a little noise so a pack does not move in lockstep
      const score = (dx * ux + dy * uy) * 2.4
                  + (c.dist / maxR) * 0.7
                  + (rnd ? (rnd() - 0.5) * 0.5 : 0);
      if (score > bs) { bs = score; best = c; }
    }
    return best;
  };

  return { World, overlap, DECK_H, THIN_H, thickOf, FACE_ORIENT, closestOnSeg };
})();
