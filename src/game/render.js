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

    for (const p of M.pickups) drawPickup(ctx, p, S);

    /* corpses first, so the living stand in front of them */
    for (const e of M.enemies) {
      if (!e.dead) continue;
      if (e.deathT > 1.2) continue;
      const sx = e.x - S;
      if (sx < -50 || sx > LV.W + 50) continue;
      ctx.save();
      ctx.globalAlpha = clamp(1 - e.deathT / 1.2, 0, 1) * 0.7;
      e.rig.draw(ctx, 'crouch', 1, 0, sx, e.y, e.face < 0);
      ctx.restore();
    }

    for (const e of M.enemies) {
      if (e.dead) continue;
      const sx = e.x - S;
      if (sx < -60 || sx > LV.W + 60) continue;
      drawActor(ctx, e, sx, e.y, e.flash > 0);
      drawEnemyPip(ctx, e, sx);
    }

    const P = M.player;
    if (!P.dead) {
      const blink = P.invuln > 0 && Math.floor(P.invuln * 18) % 2 === 0;
      if (!blink) drawActor(ctx, P, P.x - S, P.y, P.flash > 0);
    }

    for (const b of M.bullets) drawBullet(ctx, b, S);
    for (const p of M.parts) drawParticle(ctx, p, S);

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
    contactShadow(ctx, a, sx, a.ground);
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

  /* A hostile's health as a two-pixel bar; only while damaged, so a
     quiet level stays clean. */
  function drawEnemyPip(ctx, e, sx) {
    if (e.hp >= e.maxHp) return;
    const w = Math.max(10, e.w + 4), x = Math.round(sx - w / 2), y = Math.round(e.y - e.h - 6);
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
    text(ctx, W.def.label, LV.W - 8, 7, vis, 'right');
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

  return { frame, entityPass, hud, overlay, text, bar, hexA, FONT };
})();
