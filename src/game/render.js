/* ============================================================
   render.js — the entity pass and the HUD.

   drawLevelFrame() composites seven parallax layers from the baked
   canvases; the extractor adds one hook between the play layer and
   the foreground, which is where everything here draws. Lamp glow
   and weather land on top of entities, so a merc standing under a
   sodium light is lit by it.

   Everything is drawn at the level's own 1:1 resolution (448x252)
   and upscaled with nearest-neighbour by the caller, so the pixels
   stay square.
   ============================================================ */
window.RENDER = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const LV = GW.LV;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;

  /* ---------------- entity pass ---------------- */
  function entityPass(M, ctx, scroll, time) {
    const S = Math.round(scroll);

    drawExit(M, ctx, S, time);

    /* Slime is on the terrain, so it goes down before anything that
       walks over it. */
    for (const sl of M.slime) drawSlime(ctx, sl, S);

    /* Debris sits on the terrain and in front of it, but behind
       anything alive. */
    for (const b of M.rigid.bodies) drawBody(ctx, b, S);

    for (const p of M.pickups) drawPickup(ctx, p, S);

    /* corpses first, so the living stand in front of them */
    for (const e of M.enemies) {
      if (!e.dead) continue;
      if (e.deathT > 1.2) continue;
      const sx = e.x - S;
      if (sx < -50 || sx > LV.W + 50) continue;
      ctx.save();
      ctx.globalAlpha = clamp(1 - e.deathT / 1.2, 0, 1) * 0.7;
      if (e.kind === 'crawler') {
        // it collapses rather than falling over
        ctx.globalAlpha *= 0.8;
        e.rig.draw(ctx, 'hurt', e.rig.framesOf('hurt') - 1, e.orient, sx, e.y, e.face < 0);
      } else {
        e.rig.draw(ctx, 'crouch', 1, 0, sx, e.y, e.face < 0);
      }
      ctx.restore();
    }

    for (const e of M.enemies) {
      if (e.dead) continue;
      const sx = e.x - S;
      if (sx < -60 || sx > LV.W + 60) continue;
      if (e.kind === 'crawler' || e.kind === 'overlord') drawCrawler(ctx, e, sx, S, time);
      else drawActor(ctx, e, sx, e.y - (e.lift || 0), e.flash > 0);
      if (!e.boss) drawEnemyPip(ctx, e, sx);
    }

    for (const g of M.gibs) drawGib(ctx, g, S);

    /* --- allies --- */
    for (const A of M.allies) {
      const ax = A.x - S;
      if (ax < -60 || ax > LV.W + 60) continue;
      if (A.dead) {
        if (A.downT > 1.4) continue;
        ctx.save();
        ctx.globalAlpha = clamp(1 - A.downT / 1.4, 0, 1) * 0.65;
        A.rig.draw(ctx, 'crouch', 1, 0, ax, A.y, A.face < 0);
        ctx.restore();
        continue;
      }
      if (A.frozen) { drawStasis(ctx, A, ax, time); continue; }
      const blink = A.invuln > 0 && Math.floor(A.invuln * 18) % 2 === 0;
      if (!blink) drawActor(ctx, A, ax, A.y, A.flash > 0);
      drawAllyPip(ctx, A, ax);
      // a just-woken operative flares for a moment
      if (A.wakeT > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const k = clamp(A.wakeT / 1.0, 0, 1);
        const r = 8 + (1 - k) * 22;
        const g = ctx.createRadialGradient(ax, A.y - A.h * 0.5, 0, ax, A.y - A.h * 0.5, r);
        g.addColorStop(0, hexA(A.rig.params.colVisor, 0.5 * k));
        g.addColorStop(1, hexA(A.rig.params.colVisor, 0));
        ctx.fillStyle = g;
        ctx.fillRect(ax - r, A.y - A.h * 0.5 - r, r * 2, r * 2);
        ctx.restore();
      }
    }

    const P = M.player;
    /* The kick-off ring for a second jump. Without a mark at the point
       it happened, an air jump just looks like the physics glitched. */
    if (P.jumpPuff) {
      const k = clamp(P.jumpPuff.t / 0.28, 0, 1);
      const r = 3 + k * 11;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.strokeStyle = hexA(P.rig.params.colVisor || '#f0a830', 1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(P.jumpPuff.x - S, P.jumpPuff.y, r, r * 0.42, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (!P.dead) {
      const blink = P.invuln > 0 && Math.floor(P.invuln * 18) % 2 === 0;
      if (!blink) drawActor(ctx, P, P.x - S, P.y, P.flash > 0);
    }

    for (const b of M.bullets) drawBullet(ctx, b, S);
    for (const p of M.parts) drawParticle(ctx, p, S);

    /* Vapour goes over everything it is pouring off. */
    for (const v of M.vapors) drawVapor(ctx, v, S);

    /* muzzle flashes and blast light, additive */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of M.flashes) {
      const sx = f.x - S;
      if (sx < -40 || sx > LV.W + 40) continue;
      const a = clamp(f.life / 0.07, 0, 1);
      const g = ctx.createRadialGradient(sx, f.y, 0, sx, f.y, f.r);
      g.addColorStop(0, hexA(f.c, 0.85 * a));
      g.addColorStop(0.5, hexA(f.c, 0.25 * a));
      g.addColorStop(1, hexA(f.c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(sx - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.restore();
  }

  /* A shadow puddle under the feet. The walls these levels bake are
     busy and often nearly the same value as a merc's suit; without
     something anchoring the sprite it reads as a decal on the wall. */
  function contactShadow(ctx, a, sx, ground) {
    const d = ground ? 0 : 1;
    if (d) return;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#040506';
    ctx.beginPath();
    ctx.ellipse(Math.round(sx), Math.round(a.y) + 1, Math.max(4, a.w * 0.55), 2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* Blitting the same cell four times at 1px offsets under 'lighter'
     lifts a halo out of the sprite's own colours — no tint buffer
     needed, and it doubles as the tell for "this one has seen you". */
  function halo(ctx, a, sx, sy, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const flip = a.face < 0;
    a.rig.draw(ctx, a.anim, a.frame || 0, a.local, sx - 1, sy, flip);
    a.rig.draw(ctx, a.anim, a.frame || 0, a.local, sx + 1, sy, flip);
    a.rig.draw(ctx, a.anim, a.frame || 0, a.local, sx, sy - 1, flip);
    a.rig.draw(ctx, a.anim, a.frame || 0, a.local, sx, sy + 1, flip);
    ctx.restore();
  }

  function drawActor(ctx, a, sx, sy, flashing) {
    contactShadow(ctx, a, sx, a.ground && !(a.lift > 0.5));
    if (a.corrupt > 0) {
      // a rot-coloured bloom, so a corrupted merc reads across a room
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = a.h * 0.9;
      const beat = 0.5 + 0.5 * Math.sin((a.corruptT || 0) * 3.1);
      const g = ctx.createRadialGradient(sx, sy - a.h * 0.5, 0, sx, sy - a.h * 0.5, r);
      const k = 0.20 * a.corrupt * (0.55 + beat * 0.45);
      g.addColorStop(0, 'rgba(190,30,34,' + k + ')');
      g.addColorStop(1, 'rgba(190,30,34,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, sy - a.h * 0.5 - r, r * 2, r * 2);
      ctx.restore();
    }
    if (a.alerted && !a.dead) halo(ctx, a, sx, sy, 0.20);
    a.rig.draw(ctx, a.anim, a.frame || 0, a.local, sx, sy, a.face < 0);
    if (flashing) {
      // Re-blit the same cell as a white silhouette for the hit tick.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      a.rig.draw(ctx, a.anim, a.frame || 0, a.local, sx, sy, a.face < 0);
      ctx.restore();
    }
  }

  /* ============================================================
     Crawler: tentacles BEHIND the body, then the body, then the eyes.

     The tentacle sheet is a second sheet for exactly this reason —
     the limbs have to pass behind the mass they are hauling, and a
     single sheet cannot be both in front of and behind itself.
     ============================================================ */
  function drawCrawler(ctx, cr, sx, S, time) {
    const rig = cr.rig;
    const flip = cr.face < 0;

    /* --- limbs, behind --- */
    for (const l of cr.limbs) {
      let tip = null;
      // 'coil' is the boss's resting state: nothing to grip up there,
      // so the limb drifts through empty air and still has to be drawn.
      if ((l.state === 'gripped' || l.state === 'coil') && l.anchor) tip = l.anchor;
      else if (l.cast) tip = l.cast;
      if (!tip) continue;
      const so = rig.socket(l.i, cr.x, cr.y, flip, cr.orient);
      const tx = tip.x - S, ty = tip.y;
      const rx = so.x - S, ry = so.y;
      if (Math.max(rx, tx) < -70 || Math.min(rx, tx) > LV.W + 70) continue;
      // a limb under tension bows less than one still casting
      const slack = l.state === 'gripped' ? 0.55 : l.state === 'coil' ? 1.5 : 1.0;
      const bend = l.bend * slack + Math.sin(time * 2.2 + l.phase) * 3;
      const alpha = l.state === 'strike' ? 1 : (l.state === 'retract' ? 0.7 : 0.95);
      // the boss's limbs are drawn heavier than they are baked
      const thick = cr.boss ? 1.35 : 1;
      window.CRAWLERFORGE.drawTentacle(ctx, rig.tent, l.variant,
        rx, ry, tx, ty, bend, { alpha, thickness: thick });
      // a wet highlight where it grips
      if (l.state === 'gripped') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = cr.slimeColour();
        ctx.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 3, 3);
        ctx.restore();
      }
    }

    /* --- body --- */
    if (cr.alerted) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10;
      rig.draw(ctx, cr.anim, cr.frame, cr.orient, sx - 1, cr.y, flip);
      rig.draw(ctx, cr.anim, cr.frame, cr.orient, sx + 1, cr.y, flip);
      ctx.restore();
    }
    rig.draw(ctx, cr.anim, cr.frame, cr.orient, sx, cr.y, flip);
    if (cr.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      rig.draw(ctx, cr.anim, cr.frame, cr.orient, sx, cr.y, flip);
      ctx.restore();
    }

    /* --- eyes ---
       Baked eyes are three pixels of iris; the live glow on top is
       what makes them read, and it brightens once the thing has seen
       you, which is the only tell a creature with no face can give. */
    const pal = window.CRAWLERFORGE.PALETTES[rig.params.palette] ||
                window.CRAWLERFORGE.PALETTES.raw;
    const eyes = rig.eyes(sx, cr.y, flip, cr.orient);
    if (eyes.length) {
      /* Kept deliberately dim. Several eyes under 'lighter' add up
         fast, and an over-bright crawler stops being a thing lurking
         on a wall and becomes a lamp. */
      const beat = cr.alerted
        ? 0.46 + 0.22 * Math.sin(cr.pulse * 2.6)
        : 0.15 + 0.07 * Math.sin(cr.pulse * 0.8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const e of eyes) {
        const r = Math.max(2, e.r * 1.9);
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        g.addColorStop(0, hexA(pal.glow, 0.55 * beat));
        g.addColorStop(0.45, hexA(pal.glow, 0.18 * beat));
        g.addColorStop(1, hexA(pal.glow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  /* A frozen operative: held in a field, waiting to be touched. */
  function drawStasis(ctx, A, ax, time) {
    const col = A.rig.params.colVisor || '#6cf';
    const pulse = 0.5 + 0.5 * Math.sin(A.shimmer);
    const h = A.h + 8, w = A.w + 10;
    const cy = A.y - A.h * 0.5;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, A.y - h, 0, A.y);
    g.addColorStop(0, hexA(col, 0.05 + 0.07 * pulse));
    g.addColorStop(0.5, hexA(col, 0.14 + 0.10 * pulse));
    g.addColorStop(1, hexA(col, 0.04));
    ctx.fillStyle = g;
    ctx.fillRect(ax - w / 2, A.y - h, w, h);
    ctx.restore();

    // the merc itself, drained of colour inside the field
    ctx.save();
    ctx.globalAlpha = 0.72;
    A.rig.draw(ctx, 'idle', 0, 0, ax, A.y, false);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.14 + 0.10 * pulse;
    A.rig.draw(ctx, 'idle', 0, 0, ax, A.y, false);
    ctx.restore();

    // the cage
    ctx.strokeStyle = hexA(col, 0.55 + 0.25 * pulse);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ax - w / 2) + 0.5, Math.round(A.y - h) + 0.5, w - 1, h - 1);
    ctx.fillStyle = hexA(col, 0.85);
    ctx.fillRect(Math.round(ax - w / 2), Math.round(A.y) - 2, w, 2);
    // scan line travelling up the field
    const sy = A.y - ((time * 26 + A.shimmer * 9) % h);
    ctx.fillStyle = hexA(col, 0.35);
    ctx.fillRect(Math.round(ax - w / 2), Math.round(sy), w, 1);
  }

  /* Ally health, in the ally's own colour so a glance separates them
     from the red pips over hostiles. */
  function drawAllyPip(ctx, A, ax) {
    if (A.hp >= A.maxHp) return;
    const w = Math.max(10, A.w + 4), x = Math.round(ax - w / 2);
    const y = Math.round(A.y - A.h - 6);
    ctx.fillStyle = 'rgba(8,9,10,.8)';
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = A.rig.params.colVisor || '#6cf';
    ctx.fillRect(x, y, Math.round(w * clamp(A.hp / A.maxHp, 0, 1)), 2);
  }

  /* Slime pooled on a deck or running down a wall, oriented by the
     normal of whatever it was laid on. */
  function drawSlime(ctx, sl, S) {
    const sx = sl.x - S;
    if (sx < -30 || sx > LV.W + 30) return;
    const a = clamp(sl.life / sl.max, 0, 1);
    const r = sl.r * 1.25;
    ctx.save();
    ctx.globalAlpha = 0.46 * a;
    ctx.fillStyle = sl.col;
    // spread along the surface, thin against its normal
    const alongX = Math.abs(sl.ny), alongY = Math.abs(sl.nx);
    const rx = Math.max(1.5, r * (alongX ? 1 : 0.45));
    const ry = Math.max(1.5, r * (alongY ? 1 : 0.32));
    ctx.beginPath();
    ctx.ellipse(sx, sl.y - sl.ny * 1.5, rx, ry, 0, 0, TAU);
    ctx.fill();
    // a run creeping away from the surface under gravity
    if (sl.ny <= 0 && sl.drip > 0.6) {
      const len = Math.min(r * 1.6, sl.drip * 2.2) * a;
      ctx.globalAlpha = 0.34 * a;
      ctx.fillRect(Math.round(sx) - 1, Math.round(sl.y), 2, len);
    }
    ctx.globalAlpha = 0.30 * a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(sx - rx * 0.3), Math.round(sl.y - sl.ny * 2 - ry * 0.4), 1, 1);
    ctx.restore();
  }

  function drawGib(ctx, g, S) {
    const sx = g.x - S;
    if (sx < -20 || sx > LV.W + 20) return;
    const a = clamp(g.life / g.max, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, a * 2.2);
    ctx.fillStyle = g.col;
    ctx.translate(Math.round(sx), Math.round(g.y));
    ctx.rotate(g.rot);
    ctx.fillRect(-g.size / 2, -g.size / 2, g.size, g.size);
    ctx.restore();
  }

  /* A rigid body, drawn at its spin. The sprite rotates even though
     the collision box does not — at twenty pixels the eye reads the
     tumble, not the box. */
  function drawBody(ctx, b, S) {
    const sx = b.x - S;
    if (sx < -40 || sx > LV.W + 40) return;
    const sh = b.sheet;
    const src = b.frame * sh.CW;
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(b.y));
    // snap to eighth turns: a pixel sprite spun to arbitrary angles
    // shimmers, and stepping it reads as tumbling rather than sliding
    ctx.rotate(Math.round(b.rot / (Math.PI / 8)) * (Math.PI / 8));
    ctx.drawImage(sh.canvas, src, 0, sh.CW, sh.CH,
      -Math.round(sh.CW / 2), -Math.round(sh.CH / 2), sh.CW, sh.CH);
    ctx.restore();
    // a thrown piece glows at the edges so you know it will hurt
    if (b.dangerT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const a = clamp(b.dangerT / 1.6, 0, 1) * 0.5;
      const r = Math.max(b.hw, b.hh) * 1.7;
      const g = ctx.createRadialGradient(sx, b.y, 0, sx, b.y, r);
      g.addColorStop(0, 'rgba(255,90,50,' + (0.45 * a) + ')');
      g.addColorStop(1, 'rgba(255,90,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, b.y - r, r * 2, r * 2);
      ctx.restore();
    }
  }

  /* Demonic vapour. Two passes: a dark body that eats the light, then
     a dim red core inside it. Smoke that only added light read as
     steam; something that takes light out first reads as wrong. */
  function drawVapor(ctx, v, S) {
    const sx = v.x - S;
    if (sx < -40 || sx > LV.W + 40) return;
    const a = clamp(v.life / v.max, 0, 1);
    const fade = a * a;
    ctx.save();
    const g = ctx.createRadialGradient(sx, v.y, 0, sx, v.y, v.r);
    g.addColorStop(0, 'rgba(18,4,8,' + (0.42 * fade) + ')');
    g.addColorStop(0.6, 'rgba(28,6,10,' + (0.22 * fade) + ')');
    g.addColorStop(1, 'rgba(28,6,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - v.r, v.y - v.r, v.r * 2, v.r * 2);
    ctx.globalCompositeOperation = 'lighter';
    const g2 = ctx.createRadialGradient(sx, v.y, 0, sx, v.y, v.r * 0.55);
    g2.addColorStop(0, 'rgba(176,26,30,' + (0.30 * fade) + ')');
    g2.addColorStop(1, 'rgba(176,26,30,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(sx - v.r, v.y - v.r, v.r * 2, v.r * 2);
    ctx.restore();
  }

  /* A hostile's health as a two-pixel bar; only while damaged, so a
     quiet level stays clean. */
  function drawEnemyPip(ctx, e, sx) {
    if (e.hp >= e.maxHp) return;
    const w = Math.max(10, e.w + 4), x = Math.round(sx - w / 2);
    const y = Math.round(e.kind === 'crawler'
      ? e.y - e.rig.r - 7          // centre-anchored, so measure off the radius
      : e.y - e.h - 6);
    ctx.fillStyle = 'rgba(8,9,10,.8)';
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#e0552a' : '#ff9b3d';
    ctx.fillRect(x, y, Math.round(w * clamp(e.hp / e.maxHp, 0, 1)), 2);
  }

  function drawBullet(ctx, b, S) {
    const sx = b.x - S;
    if (sx < -20 || sx > LV.W + 20) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* A rolled round leaves a trail, which is how a homing or
       ricocheting shot shows you what it did. */
    if (b.trail && b.trail.length >= 4) {
      ctx.strokeStyle = hexA(b.tint, 0.35);
      ctx.lineWidth = Math.max(1, b.size - 1);
      ctx.beginPath();
      for (let i = 0; i < b.trail.length; i += 2) {
        const tx = b.trail[i] - S, ty = b.trail[i + 1];
        i ? ctx.lineTo(tx, ty) : ctx.moveTo(tx, ty);
      }
      ctx.stroke();
    }
    const len = b.size > 2 ? 5 : 4;
    const nx = b.vx / (Math.hypot(b.vx, b.vy) || 1), ny = b.vy / (Math.hypot(b.vx, b.vy) || 1);
    ctx.strokeStyle = hexA(b.tint, 0.9);
    ctx.lineWidth = b.size;
    ctx.beginPath();
    ctx.moveTo(sx, b.y);
    ctx.lineTo(sx - nx * len, b.y - ny * len);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(sx) - 1, Math.round(b.y) - 1, 2, 2);
    ctx.restore();
  }

  function drawParticle(ctx, p, S) {
    const sx = p.x - S;
    if (sx < -10 || sx > LV.W + 10) return;
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.c;
    const s = a > 0.6 ? 2 : 1;
    ctx.fillRect(Math.round(sx), Math.round(p.y), s, s);
    ctx.globalAlpha = 1;
  }

  function drawPickup(ctx, p, S) {
    const sx = p.x - S;
    if (sx < -20 || sx > LV.W + 20) return;
    if (p.shrine && p.proto) { drawShrine(ctx, p, sx); return; }
    const bob = Math.sin(p.t * 3) * 2;
    const y = Math.round(p.y - 10 + bob);
    const col = window.ENTITIES.PICKUP_KINDS[p.kind].col;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx, y + 4, 0, sx, y + 4, 14);
    g.addColorStop(0, hexA(col, 0.35));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - 14, y - 10, 28, 28);
    ctx.restore();

    ctx.fillStyle = 'rgba(10,11,12,.9)';
    ctx.fillRect(Math.round(sx) - 5, y, 10, 9);
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(sx) - 4, y + 1, 8, 7);
    ctx.fillStyle = 'rgba(10,11,12,.95)';
    if (p.kind === 'health') {
      ctx.fillRect(Math.round(sx) - 1, y + 2, 2, 5);
      ctx.fillRect(Math.round(sx) - 3, y + 4, 6, 2);
    } else if (p.kind === 'ammo') {
      ctx.fillRect(Math.round(sx) - 3, y + 3, 2, 4);
      ctx.fillRect(Math.round(sx), y + 3, 2, 4);
    } else {
      ctx.fillRect(Math.round(sx) - 3, y + 4, 7, 2);
      ctx.fillRect(Math.round(sx) + 1, y + 2, 2, 2);
    }
  }

  /* The prototype, on a pedestal under a beam. It is the one thing in
     a level worth walking past a fight for, so it is lit like it. */
  function drawShrine(ctx, p, sx) {
    const col = p.proto.tint || '#ffd06b';
    const bob = Math.sin(p.t * 2.2) * 1.6;
    const y = Math.round(p.y - 16 + bob);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(0, p.y - 96, 0, p.y);
    beam.addColorStop(0, hexA(col, 0));
    beam.addColorStop(1, hexA(col, 0.16));
    ctx.fillStyle = beam;
    ctx.fillRect(sx - 9, p.y - 96, 18, 96);
    const r = 22;
    const g = ctx.createRadialGradient(sx, y + 4, 0, sx, y + 4, r);
    g.addColorStop(0, hexA(col, 0.55));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, y + 4 - r, r * 2, r * 2);
    ctx.restore();

    // pedestal
    ctx.fillStyle = 'rgba(12,14,15,.92)';
    ctx.fillRect(Math.round(sx) - 7, Math.round(p.y) - 5, 14, 5);
    ctx.fillStyle = hexA(col, 0.7);
    ctx.fillRect(Math.round(sx) - 7, Math.round(p.y) - 6, 14, 1);

    // the weapon itself: a slab with a barrel, spun slowly
    ctx.save();
    ctx.translate(Math.round(sx), y + 4);
    ctx.rotate(Math.sin(p.t * 0.9) * 0.22 - 0.25);
    ctx.fillStyle = 'rgba(10,11,12,.95)';
    ctx.fillRect(-9, -3, 18, 6);
    ctx.fillStyle = col;
    ctx.fillRect(-8, -2, 16, 4);
    ctx.fillStyle = 'rgba(10,11,12,.95)';
    ctx.fillRect(2, -1, 8, 2);
    ctx.restore();

    // orbiting motes, one per rolled parameter
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hexA(col, 0.8);
    for (let i = 0; i < 10; i++) {
      const a = p.t * 0.8 + (i / 10) * TAU;
      ctx.fillRect(Math.round(sx + Math.cos(a) * 15),
                   Math.round(y + 4 + Math.sin(a) * 7), 1, 1);
    }
    ctx.restore();
  }

  /* The extraction pad: a lit deck plate with rising chevrons. */
  function drawExit(M, ctx, S, time) {
    const sx = M.exit.x - S;
    if (sx < -80 || sx > LV.W + 80) return;
    const y = M.exit.y;
    const pulse = 0.55 + 0.45 * Math.sin(time * 2.6);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, y - 90, 0, y);
    g.addColorStop(0, 'rgba(74,208,122,0)');
    g.addColorStop(1, 'rgba(74,208,122,' + (0.20 * pulse) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(sx - 24, y - 90, 48, 90);
    const rg = ctx.createRadialGradient(sx, y, 0, sx, y, 46);
    rg.addColorStop(0, 'rgba(74,208,122,' + (0.42 * pulse) + ')');
    rg.addColorStop(1, 'rgba(74,208,122,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(sx - 46, y - 46, 92, 92);
    ctx.restore();

    ctx.fillStyle = 'rgba(10,14,12,.9)';
    ctx.fillRect(Math.round(sx) - 22, Math.round(y) - 3, 44, 3);
    ctx.fillStyle = '#4ad07a';
    for (let i = 0; i < 3; i++) {
      const t = ((time * 0.6 + i / 3) % 1);
      const cy = Math.round(y - 8 - t * 42);
      ctx.globalAlpha = (1 - t) * 0.8;
      for (let k = 0; k < 6; k++) {
        ctx.fillRect(Math.round(sx) - 6 + k, cy + Math.abs(k - 2.5) - 2, 1, 1);
        ctx.fillRect(Math.round(sx) + 6 - k, cy + Math.abs(k - 2.5) - 2, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#4ad07a';
    ctx.fillRect(Math.round(sx) - 20, Math.round(y) - 1, 40, 1);
  }

  /* ---------------- HUD ---------------- */
  const FONT = 'bold 7px "Courier New", monospace';

  function text(ctx, s, x, y, col, align) {
    ctx.font = FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(6,7,8,.85)';
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }

  function bar(ctx, x, y, w, h, frac, col, bg) {
    ctx.fillStyle = bg || 'rgba(8,10,11,.78)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = 'rgba(40,46,50,.9)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, Math.round(w * clamp(frac, 0, 1)), h);
  }

  function hud(M, ctx, time) {
    const P = M.player;
    const acc = P.rig.params.colAccent || '#e05a1e';
    const vis = P.rig.params.colVisor || '#f0a830';

    /* vitals */
    ctx.fillStyle = 'rgba(8,10,11,.74)';
    ctx.fillRect(4, 4, 108, 26);
    text(ctx, 'VITALS', 8, 7, '#8d9aa2');
    bar(ctx, 8, 16, 78, 4, P.hp / P.maxHp, P.hp > 35 ? '#4ad07a' : '#e0552a');
    text(ctx, String(Math.max(0, Math.ceil(P.hp))).padStart(3, '0'), 108, 15, P.hp > 35 ? '#cfe6d8' : '#ff9b3d', 'right');
    text(ctx, 'LIVES ' + '■'.repeat(Math.max(0, M.lives)), 8, 23, acc);

    /* weapon */
    const W = P.weapon;
    ctx.fillStyle = 'rgba(8,10,11,.74)';
    ctx.fillRect(LV.W - 118, 4, 114, 26);
    text(ctx, W.def.label, LV.W - 8, 7, W.def.proto ? (W.def.tint || vis) : vis, 'right');
    if (W.def.proto) {
      // a rolled gun earns a line of what it rolled
      const r = W.def;
      const bits = [];
      if (r.count > 1) bits.push('x' + r.count);
      if (r.pierce) bits.push('PRC' + r.pierce);
      if (r.splash) bits.push('BLST');
      if (r.homing) bits.push('SEEK');
      if (r.bounce) bits.push('RIC' + r.bounce);
      if (r.drop) bits.push('ARC');
      if (bits.length) text(ctx, bits.join(' '), LV.W - 8, 31, hexA(r.tint, 0.9), 'right');
    }
    if (W.reloading > 0) {
      bar(ctx, LV.W - 114, 16, 106, 4, 1 - W.reloading / W.def.reload, vis);
      text(ctx, 'RELOADING', LV.W - 8, 23, '#8d9aa2', 'right');
    } else {
      const cells = Math.min(W.def.mag, 30);
      const per = Math.floor(106 / cells);
      const lit = Math.round(cells * (W.ammo / W.def.mag));
      for (let i = 0; i < cells; i++) {
        ctx.fillStyle = i < lit ? vis : 'rgba(52,58,62,.85)';
        ctx.fillRect(LV.W - 114 + i * per, 16, Math.max(1, per - 1), 4);
      }
      const spare = P.spare[W.kind];
      text(ctx, W.ammo + ' / ' + (spare === Infinity ? '∞' : spare),
        LV.W - 8, 23, '#8d9aa2', 'right');
    }

    /* mission progress: how far along the level, and where the exit is */
    const px = clamp((P.x) / M.L.LW, 0, 1);
    const bx = LV.W / 2 - 60;
    ctx.fillStyle = 'rgba(8,10,11,.74)';
    ctx.fillRect(bx - 4, 4, 128, 14);
    text(ctx, 'EXTRACTION', LV.W / 2, 6, '#8d9aa2', 'center');
    ctx.fillStyle = 'rgba(40,46,50,.9)';
    ctx.fillRect(bx, 14, 120, 2);
    ctx.fillStyle = '#4ad07a';
    ctx.fillRect(bx + 118, 13, 2, 4);
    ctx.fillStyle = acc;
    ctx.fillRect(bx + Math.round(px * 118), 12, 2, 6);

    /* hostiles + score */
    text(ctx, 'HOSTILES ' + (M.totalEnemies - M.kills) + '/' + M.totalEnemies, 4, LV.H - 18, '#8d9aa2');
    text(ctx, String(P.score).padStart(6, '0'), LV.W - 4, LV.H - 18, vis, 'right');

    /* boss bar — only once it knows you are there */
    const O = M.overlord;
    if (O && !O.dead && O.aggroed) {
      const bw = 170, bx2 = Math.round(LV.W / 2 - bw / 2), by2 = LV.H - 30;
      ctx.fillStyle = 'rgba(8,10,11,.80)';
      ctx.fillRect(bx2 - 3, by2 - 10, bw + 6, 17);
      text(ctx, 'OVERLORD', LV.W / 2, by2 - 9, '#c8323a', 'center');
      ctx.fillStyle = 'rgba(38,20,22,.95)';
      ctx.fillRect(bx2, by2, bw, 4);
      const f = clamp(O.hp / O.maxHp, 0, 1);
      ctx.fillStyle = O.invuln > 0 && Math.floor(time * 14) % 2 ? '#ffffff' : '#c8323a';
      ctx.fillRect(bx2, by2, Math.round(bw * f), 4);
      // phase ticks, so the bar tells you when it changes gear
      ctx.fillStyle = 'rgba(8,10,11,.9)';
      ctx.fillRect(bx2 + Math.round(bw * 0.33), by2, 1, 4);
      ctx.fillRect(bx2 + Math.round(bw * 0.66), by2, 1, 4);
      text(ctx, 'PHASE ' + O.phase, LV.W / 2 + bw / 2, by2 - 9, '#8d9aa2', 'right');
    }

    /* squad strip — one chip per operative */
    if (M.allies.length) {
      const y2 = 34;
      M.allies.forEach((A, i) => {
        const x2 = 6 + i * 13;
        const col = A.rig.params.colVisor || '#6cf';
        ctx.fillStyle = 'rgba(8,10,11,.7)';
        ctx.fillRect(x2, y2, 11, 5);
        if (A.dead) {
          ctx.fillStyle = 'rgba(90,40,40,.9)';
          ctx.fillRect(x2 + 1, y2 + 1, 9, 3);
        } else if (A.frozen) {
          // hatched: present but not yours yet
          ctx.fillStyle = hexA(col, 0.35);
          for (let k = 0; k < 9; k += 2) ctx.fillRect(x2 + 1 + k, y2 + 1, 1, 3);
        } else {
          ctx.fillStyle = hexA(col, 0.9);
          ctx.fillRect(x2 + 1, y2 + 1, Math.max(1, Math.round(9 * clamp(A.hp / A.maxHp, 0, 1))), 3);
        }
      });
    }

    /* autopilot badge — steps up out of the way when the mission has
       something to say, since both want the same line */
    if (M.autopilot) {
      const blink = 0.6 + 0.4 * Math.sin(time * 4);
      const y = (M.bannerT > 0 && M.banner) ? LV.H - 54 : LV.H - 42;
      text(ctx, 'AUTOPILOT', LV.W / 2, y, hexA('#4ad07a', blink), 'center');
    }

    /* prompt for a stasis pod you are standing next to */
    if (M.activatePrompt) {
      const A = M.activatePrompt;
      const px = A.x - M.scroll;
      const blink = Math.floor(time * 3) % 2 === 0;
      if (blink) text(ctx, 'TOUCH TO REVIVE', px, A.y - A.h - 18,
                      A.rig.params.colVisor || '#6cf', 'center');
    }

    /* pickup / event banner */
    if (M.bannerT > 0 && M.banner) {
      const a = clamp(M.bannerT / 0.5, 0, 1);
      ctx.globalAlpha = a;
      text(ctx, M.banner, LV.W / 2, LV.H - 40, vis, 'center');
      ctx.globalAlpha = 1;
    }

    /* crosshair */
    const cx = Math.round(M.cursorX), cy = Math.round(M.cursorY);
    ctx.strokeStyle = hexA(vis, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5.5, cy + 0.5); ctx.lineTo(cx - 2.5, cy + 0.5);
    ctx.moveTo(cx + 2.5, cy + 0.5); ctx.lineTo(cx + 5.5, cy + 0.5);
    ctx.moveTo(cx + 0.5, cy - 5.5); ctx.lineTo(cx + 0.5, cy - 2.5);
    ctx.moveTo(cx + 0.5, cy + 2.5); ctx.lineTo(cx + 0.5, cy + 5.5);
    ctx.stroke();
    ctx.fillStyle = hexA(vis, 0.8);
    ctx.fillRect(cx, cy, 1, 1);

    /* damage vignette */
    if (M.hitFlash > 0) {
      const a = clamp(M.hitFlash / 0.3, 0, 1) * 0.5;
      const g = ctx.createRadialGradient(LV.W / 2, LV.H / 2, LV.H * 0.25, LV.W / 2, LV.H / 2, LV.H * 0.8);
      g.addColorStop(0, 'rgba(190,30,20,0)');
      g.addColorStop(1, 'rgba(190,30,20,' + a + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, LV.W, LV.H);
    }

    /* low-health pulse */
    if (P.hp < 30 && !P.dead) {
      const a = (0.10 + 0.08 * Math.sin(time * 6)) * (1 - P.hp / 30);
      const g = ctx.createRadialGradient(LV.W / 2, LV.H / 2, LV.H * 0.2, LV.W / 2, LV.H / 2, LV.H * 0.85);
      g.addColorStop(0, 'rgba(150,20,14,0)');
      g.addColorStop(1, 'rgba(150,20,14,' + a + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, LV.W, LV.H);
    }
  }

  /* Full-frame overlays for the run-end states. */
  function overlay(M, ctx, time) {
    if (M.state === 'play') return;
    const a = clamp(M.endT / 0.8, 0, 1);
    ctx.fillStyle = 'rgba(6,7,8,' + (0.66 * a) + ')';
    ctx.fillRect(0, 0, LV.W, LV.H);
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const won = M.state === 'won';
    const label = won ? 'EXTRACTED' : (M.lives > 0 ? 'OPERATIVE DOWN' : 'MISSION FAILED');
    ctx.fillStyle = 'rgba(6,7,8,.9)';
    ctx.fillText(label, LV.W / 2 + 1, LV.H / 2 - 7);
    ctx.fillStyle = won ? '#4ad07a' : '#e0552a';
    ctx.globalAlpha = a;
    ctx.fillText(label, LV.W / 2, LV.H / 2 - 8);
    ctx.globalAlpha = 1;
    if (M.endT > 1.1) {
      const blink = Math.floor(time * 2) % 2 === 0;
      if (blink) {
        ctx.font = 'bold 8px "Courier New", monospace';
        ctx.fillStyle = '#8d9aa2';
        const hint = won ? 'PRESS ENTER FOR DEBRIEF'
          : (M.lives > 0 ? 'PRESS ENTER TO REDEPLOY' : 'PRESS ENTER FOR DEBRIEF');
        ctx.fillText(hint, LV.W / 2, LV.H / 2 + 14);
      }
    }
  }

  function hexA(hex, a) {
    const c = GW.hex2rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* Compose one full frame: level + entities + HUD, with shake. */
  function frame(M, ctx, canvas) {
    const sh = M.shake;
    const ox = sh > 0.05 ? (Math.random() - 0.5) * sh * 2 : 0;
    const oy = sh > 0.05 ? (Math.random() - 0.5) * sh * 2 : 0;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(ox), Math.round(oy));
    GW.drawLevelFrame(M.L, M.cfg, ctx, M.scroll, M.time,
      (c, scroll, time) => entityPass(M, c, scroll, time));
    ctx.restore();

    hud(M, ctx, M.time);
    overlay(M, ctx, M.time);
  }

  return { frame, entityPass, hud, overlay, text, bar, hexA, FONT,
           drawCrawler, drawSlime, drawGib, drawBody, drawVapor,
           drawStasis, drawAllyPip };
})();
