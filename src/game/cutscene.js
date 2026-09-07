/* ============================================================
   cutscene.js — the staged scenes between beats.

   A cutscene is a list of SHOTS. A shot is a backdrop, up to three
   staged figures, a slow camera move and one line of dialogue. The
   DIRECTOR turns a story beat into shots: it knows who is in the room
   and what has just happened, and picks a staging for it. The RENDERER
   draws the result.

   Three rules hold the whole thing up:

   1. **No assets.** Backdrops are painted procedurally at a quarter of
      the play resolution and blown up by two, which is where the chunk
      comes from — the same trick the sprite pipeline uses. Faces are
      MERC FORGE rigs the world already described. A cutscene costs one
      canvas and a rig bake, not an art pass.
   2. **Nothing knows how it was chosen.** This file never asks why a
      beat exists. It is handed a beat, a world and a context, and
      stages it. That is what lets story.js be rewritten without the
      camera noticing.
   3. **The lines are grammar, not script.** A scene kind is a sequence
      of turns; each turn has a pool of clauses, and the speaker's voice
      register shapes what comes out. The hundredth run is still saying
      something you have not read.
   ============================================================ */
window.CUTSCENE = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const mk = GW.mkCanvas;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;

  /* The design space. Deliberately the same 448x252 the HUD is authored
     in, so a caller that already has the HUD transform can draw a
     cutscene through it without a second set of numbers. */
  const CS_W = 448, CS_H = 252;
  /* The backdrop is painted at a quarter of the play area and blown up
     by two. Wider than the window so the camera has something to pan
     across; the window sits in the middle of it. */
  const BW = 288, BH = 126;
  const VIEW = 224;                       // visible backdrop width
  const MARGIN = (BW - VIEW) / 2;         // 32
  const HZ = 78;                          // horizon, in backdrop pixels
  const DECK = 88;                        // where the near floor starts
  const FLOOR = 186;                      // where staged feet land, in design px
  const BAR = 18;                         // letterbox height

  const FONT = 'bold 8px "Courier New", monospace';
  const FONT_BIG = 'bold 14px "Courier New", monospace';

  /* ============================================================
     COLOUR

     A mood is five colours and a light. Everything a backdrop paints
     is mixed out of them, so a set reads as one place rather than a
     pile of shapes that happen to be adjacent.
     ============================================================ */
  const MOODS = {
    ashfall:  { zen: '#181c22', hor: '#4a4038', glow: '#c08850', sil: '#0d1013', lit: '#ffca7a', dust: '#8a7a66' },
    nightfall:{ zen: '#080b14', hor: '#1c2340', glow: '#5f7cc0', sil: '#05070c', lit: '#9fc4ff', dust: '#556a90' },
    toxic:    { zen: '#0c1610', hor: '#2c4a2a', glow: '#8fd44a', sil: '#060b08', lit: '#c8ff86', dust: '#6f9a58' },
    furnace:  { zen: '#1a0c08', hor: '#5a1e10', glow: '#ff7a2a', sil: '#0e0605', lit: '#ffb060', dust: '#a05a34' },
    sodium:   { zen: '#141008', hor: '#4a3a12', glow: '#ffb020', sil: '#0b0906', lit: '#ffd870', dust: '#8f7434' },
    coolant:  { zen: '#06121a', hor: '#134050', glow: '#3fd0e0', sil: '#040c11', lit: '#9ff0ff', dust: '#4a8f9c' },
    rot:      { zen: '#14100c', hor: '#463420', glow: '#b08a3a', sil: '#0a0806', lit: '#e0c070', dust: '#8a7048' },
    votive:   { zen: '#100816', hor: '#3a1c50', glow: '#c060e0', sil: '#08040c', lit: '#e8a0ff', dust: '#7a4a94' },
    frost:    { zen: '#0a1018', hor: '#2c4258', glow: '#a0d8f0', sil: '#060a0e', lit: '#dcf4ff', dust: '#6e8ea6' }
  };
  const MOOD_KEYS = Object.keys(MOODS);

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  /* ============================================================
     SETS — where a scene is staged.

     Not the mission locations: the places between them. A set names a
     painter and a taste in weather, and the director picks one that
     suits the beat. `place` sets take their architecture from a real
     location in the world, which is how a briefing about THE ASH FORGE
     can be delivered while looking at it.
     ============================================================ */
  const SETS = {
    overlook: { paint: 'city',     moods: ['nightfall', 'ashfall', 'sodium'],
                label: 'AN OVERLOOK ABOVE THE STACK' },
    approach: { paint: 'city',     moods: ['ashfall', 'furnace', 'sodium'],
                label: 'THE APPROACH' },
    transit:  { paint: 'interior', variant: 'car',    moods: ['coolant', 'nightfall', 'sodium'],
                label: 'IN TRANSIT' },
    sanctum:  { paint: 'interior', variant: 'shrine', moods: ['votive', 'rot', 'coolant'],
                label: 'A ROOM THAT WAS NOT ON THE PLAN' },
    depot:    { paint: 'interior', variant: 'hold',   moods: ['sodium', 'rot', 'coolant'],
                label: 'THE DEPOT' },
    updraft:  { paint: 'air',      moods: ['nightfall', 'ashfall', 'frost'],
                label: 'ABOVE THE WEATHER' },
    wilds:    { paint: 'nature',   moods: ['toxic', 'rot', 'frost'],
                label: 'WHAT GREW BACK' },
    ruin:     { paint: 'nature',   variant: 'burnt',  moods: ['ashfall', 'furnace', 'rot'],
                label: 'A SITE NOBODY CLAIMS' }
  };
  const SET_KEYS = Object.keys(SETS);

  /* Which sets suit which beat. A betrayal in a garden reads as a
     different film; the pairing is the cheapest direction there is. */
  const SET_FOR = {
    open:         ['depot', 'transit', 'overlook'],
    complication: ['transit', 'depot', 'approach'],
    oracle:       ['sanctum', 'wilds', 'ruin'],
    rival:        ['ruin', 'approach', 'overlook'],
    betrayal:     ['transit', 'depot', 'ruin'],
    revelation:   ['sanctum', 'wilds', 'updraft'],
    ending:       ['overlook', 'updraft', 'ruin'],
    choice:       ['transit', 'depot', 'approach'],
    arrival:      ['approach', 'updraft', 'wilds']
  };

  /* ============================================================
     BACKDROP DESCRIPTION

     Seeded, and separate from painting it, so the harness can check
     that a set has the shape it claims without ever touching a canvas.
     ============================================================ */
  function makeSet(seed, opts) {
    const o = opts || {};
    const R = GW.makeRng(seed >>> 0);
    const id = o.set && SETS[o.set] ? o.set : R.pick(SET_KEYS);
    const S = SETS[id];
    const mood = o.mood && MOODS[o.mood] ? o.mood : R.pick(S.moods);
    const M = MOODS[mood];
    const B = {
      seed: seed >>> 0, id: id, paint: S.paint, variant: S.variant || 'plain',
      mood: mood, M: M, label: S.label,
      sunX: R.range(0.15, 0.85), sunR: R.range(6, 16),
      layers: [], motes: [], deck: null
    };

    if (S.paint === 'city') {
      /* Three ranks of towers, each further back, shorter in contrast
         and taller in silhouette. Depth is what the camera parallaxes
         on and what the haze is mixed by. */
      for (let d = 0; d < 3; d++) {
        const depth = 0.22 + d * 0.34;
        const shapes = [];
        let x = -14;
        while (x < BW + 14) {
          const w = R.int(7, 24) + d * 3;
          const h = R.int(10, Math.round(HZ * (0.28 + d * 0.30)));
          shapes.push({ k: 'tower', x: x, w: w, h: h,
                        mast: R.chance(0.30 - d * 0.08), stack: R.chance(0.16),
                        win: R.chance(0.85 - d * 0.2), lit: R.chance(0.55),
                        step: R.chance(0.35) });
          x += w + R.int(1, 6);
        }
        B.layers.push({ depth: depth, shapes: shapes });
      }
    } else if (S.paint === 'interior') {
      /* A corridor is drawn as frames receding to a vanishing point.
         Only the frames parallax; the fittings hang off the nearest
         one, which is what stops it reading as a tunnel of rectangles. */
      const vpx = R.range(0.38, 0.62), vpy = R.range(0.46, 0.60);
      B.vp = { x: vpx, y: vpy };
      B.rings = R.int(5, 8);
      B.ribbed = R.chance(0.7);
      B.pipes = [];
      const np = R.int(3, 6);
      for (let i = 0; i < np; i++) {
        B.pipes.push({ y: R.range(0.06, 0.34), r: R.range(1.5, 4), lit: R.chance(0.3) });
      }
      B.lamps = [];
      const nl = R.int(2, 5);
      for (let i = 0; i < nl; i++) B.lamps.push({ t: (i + 0.5) / nl, w: R.range(6, 16) });
      B.fittings = [];
      const nf = R.int(4, 9);
      for (let i = 0; i < nf; i++) {
        B.fittings.push({ x: R.range(0, 1), y: R.range(0.12, 0.66),
                          w: R.range(3, 14), h: R.range(3, 20), lit: R.chance(0.22) });
      }
      B.layers.push({ depth: 0.5, shapes: [] });
    } else if (S.paint === 'air') {
      /* Slabs at three depths, plus cloud banks between them. Nothing
         touches the ground because there is not one. */
      for (let d = 0; d < 3; d++) {
        const depth = 0.18 + d * 0.36;
        const shapes = [];
        const n = R.int(2, 4);
        for (let i = 0; i < n; i++) {
          shapes.push({ k: 'slab', x: R.range(-10, BW + 10), y: R.range(HZ * 0.25, HZ * 1.25),
                        w: R.range(18, 62) * (1.3 - depth * 0.5), h: R.range(4, 13),
                        mast: R.chance(0.5), chain: R.chance(0.4), lit: R.chance(0.5) });
        }
        B.layers.push({ depth: depth, shapes: shapes });
      }
      B.clouds = [];
      const nc = R.int(4, 8);
      for (let i = 0; i < nc; i++) {
        B.clouds.push({ x: R.range(-20, BW + 20), y: R.range(HZ * 0.35, HZ * 1.1),
                        w: R.range(30, 110), h: R.range(4, 14), a: R.range(0.06, 0.22) });
      }
    } else {
      /* Growth. Trunks and canopies at three depths; a burnt variant
         keeps the trunks and takes the canopies away, which is the
         whole difference between a wood and what is left of one. */
      const burnt = B.variant === 'burnt';
      for (let d = 0; d < 3; d++) {
        const depth = 0.20 + d * 0.34;
        const shapes = [];
        let x = -12;
        while (x < BW + 12) {
          const h = R.int(14, Math.round(HZ * (0.35 + d * 0.35)));
          shapes.push({ k: 'growth', x: x, h: h,
                        w: R.range(1.5, 4.5) + d,
                        lean: R.range(-0.22, 0.22),
                        canopy: burnt ? 0 : R.range(6, 20) - d * 2,
                        frond: R.chance(burnt ? 0.1 : 0.55),
                        pods: !burnt && R.chance(0.3) });
          x += R.int(5, 22);
        }
        B.layers.push({ depth: depth, shapes: shapes });
      }
      B.burnt = burnt;
    }

    /* Airborne particulate, whatever the set. It is the one thing that
       moves in a still frame and it does more for the feel than any of
       the geometry. */
    const nm = R.int(18, 34);
    for (let i = 0; i < nm; i++) {
      B.motes.push({ x: R.rnd(), y: R.rnd(), r: R.chance(0.2) ? 2 : 1,
                     sp: R.range(0.6, 3.4), drift: R.range(-0.4, 0.4),
                     a: R.range(0.10, 0.42) });
    }
    B.deck = { chew: R.range(0, 1), rail: R.chance(0.55), grate: R.chance(0.4) };
    return B;
  }

  /* ============================================================
     PAINTING

     Every layer gets its own canvas so the camera can move them
     against each other. They are baked once and blitted after that:
     a cutscene shot redraws four images and a handful of dots.
     ============================================================ */
  function layerCanvas() {
    const c = mk(BW, BH);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return { c: c, x: x };
  }

  function paintSky(B) {
    const { c, x } = layerCanvas();
    const M = B.M;
    const g = x.createLinearGradient(0, 0, 0, BH);
    g.addColorStop(0, M.zen);
    g.addColorStop(0.62, mix(M.zen, M.hor, 0.7));
    g.addColorStop(1, M.hor);
    x.fillStyle = g; x.fillRect(0, 0, BW, BH);
    // the light: a soft disc low in the frame, and a band of haze on it
    const sx = B.sunX * BW, sy = HZ - B.sunR * 0.4;
    const rg = x.createRadialGradient(sx, sy, 0, sx, sy, B.sunR * 5);
    rg.addColorStop(0, hexA(M.glow, 0.85));
    rg.addColorStop(0.35, hexA(M.glow, 0.22));
    rg.addColorStop(1, hexA(M.glow, 0));
    x.fillStyle = rg; x.fillRect(0, 0, BW, BH);
    x.fillStyle = hexA(M.lit, 0.5);
    x.beginPath(); x.arc(sx, sy, B.sunR * 0.5, 0, TAU); x.fill();
    return c;
  }

  function paintCity(B, L) {
    const { c, x } = layerCanvas();
    const M = B.M;
    const t = L.depth;
    const col = mix(M.sil, M.hor, clamp(0.74 - t * 0.52, 0.08, 0.72));
    x.fillStyle = col;
    for (const s of L.shapes) {
      const y = HZ - s.h;
      x.fillRect(Math.round(s.x), Math.round(y), Math.round(s.w), Math.round(s.h + 4));
      if (s.step) x.fillRect(Math.round(s.x + s.w * 0.2), Math.round(y - 4),
                             Math.round(s.w * 0.6), 5);
      if (s.mast) {
        x.fillRect(Math.round(s.x + s.w * 0.5), Math.round(y - 10), 1, 11);
        if (s.lit) { x.fillStyle = hexA(M.lit, 0.8); x.fillRect(Math.round(s.x + s.w * 0.5), Math.round(y - 11), 1, 1); x.fillStyle = col; }
      }
      if (s.stack) {
        x.fillStyle = hexA(M.dust, 0.16);
        x.beginPath();
        x.ellipse(s.x + s.w * 0.5, y - 12, s.w * 0.7, 8, 0, 0, TAU);
        x.fill();
        x.fillStyle = col;
      }
      if (s.win) {
        x.fillStyle = hexA(M.lit, clamp(0.34 - t * 0.2, 0.05, 0.34));
        for (let wy = y + 3; wy < HZ - 1; wy += 4) {
          for (let wx = s.x + 2; wx < s.x + s.w - 1; wx += 3) {
            if (((wx * 7 + wy * 13 + s.w) % 11) < 3) x.fillRect(Math.round(wx), Math.round(wy), 1, 1);
          }
        }
        x.fillStyle = col;
      }
    }
    return c;
  }

  function paintInterior(B) {
    const { c, x } = layerCanvas();
    const M = B.M;
    const vx = B.vp.x * BW, vy = B.vp.y * BH;
    // the far wall
    x.fillStyle = mix(M.sil, M.hor, 0.35);
    x.fillRect(0, 0, BW, BH);
    // frames receding to the vanishing point, near to far
    for (let i = B.rings - 1; i >= 0; i--) {
      const s = Math.pow(0.74, i);
      const w = BW * 1.25 * s, h = BH * 1.25 * s;
      const x0 = vx - w / 2, y0 = vy - h / 2;
      const shade = clamp(0.16 + (1 - s) * 0.5, 0, 0.8);
      x.strokeStyle = mix(M.sil, M.hor, 0.55 - shade * 0.5);
      x.lineWidth = Math.max(1, Math.round(3 * s));
      x.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(w), Math.round(h));
      if (B.ribbed && i % 2 === 0) {
        x.strokeStyle = hexA(M.glow, 0.10 + s * 0.16);
        x.strokeRect(Math.round(x0 + 3 * s) + 0.5, Math.round(y0 + 3 * s) + 0.5,
                     Math.round(w - 6 * s), Math.round(h - 6 * s));
      }
    }
    // the light at the end of it
    const rg = x.createRadialGradient(vx, vy, 0, vx, vy, BW * 0.28);
    rg.addColorStop(0, hexA(M.glow, 0.7));
    rg.addColorStop(1, hexA(M.glow, 0));
    x.fillStyle = rg; x.fillRect(0, 0, BW, BH);
    // pipes along the ceiling
    for (const p of B.pipes) {
      const py = p.y * BH;
      x.fillStyle = mix(M.sil, M.hor, 0.5);
      x.fillRect(0, Math.round(py), BW, Math.round(p.r));
      x.fillStyle = hexA(p.lit ? M.lit : M.hor, 0.30);
      x.fillRect(0, Math.round(py), BW, 1);
      for (let bx = 6; bx < BW; bx += 34) {
        x.fillStyle = mix(M.sil, M.hor, 0.62);
        x.fillRect(bx, Math.round(py) - 1, 3, Math.round(p.r) + 2);
      }
    }
    // strip lamps
    for (const l of B.lamps) {
      const lx = l.t * BW, ly = BH * 0.09;
      x.fillStyle = hexA(M.lit, 0.75);
      x.fillRect(Math.round(lx - l.w / 2), Math.round(ly), Math.round(l.w), 2);
      const g = x.createRadialGradient(lx, ly + 1, 0, lx, ly + 1, l.w * 2.2);
      g.addColorStop(0, hexA(M.lit, 0.30)); g.addColorStop(1, hexA(M.lit, 0));
      x.fillStyle = g;
      x.fillRect(Math.round(lx - l.w * 2.2), Math.round(ly - l.w), Math.round(l.w * 4.4), Math.round(l.w * 4));
    }
    // whatever is bolted to the walls
    for (const f of B.fittings) {
      const fx = f.x * BW, fy = f.y * BH;
      x.fillStyle = mix(M.sil, M.hor, 0.48);
      x.fillRect(Math.round(fx), Math.round(fy), Math.round(f.w), Math.round(f.h));
      x.fillStyle = hexA(f.lit ? M.lit : M.sil, f.lit ? 0.7 : 0.45);
      x.fillRect(Math.round(fx), Math.round(fy), Math.round(f.w), 1);
    }
    return c;
  }

  function paintAir(B, L) {
    const { c, x } = layerCanvas();
    const M = B.M;
    const t = L.depth;
    const col = mix(M.sil, M.hor, clamp(0.66 - t * 0.5, 0, 0.62));
    for (const s of L.shapes) {
      x.fillStyle = col;
      x.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h));
      // a lit top edge, so a slab reads as a surface rather than a hole
      x.fillStyle = hexA(M.lit, clamp(0.3 - t * 0.18, 0.04, 0.3));
      x.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.w), 1);
      x.fillStyle = col;
      if (s.mast) x.fillRect(Math.round(s.x + s.w * 0.3), Math.round(s.y - 9), 1, 9);
      if (s.chain) {
        x.fillStyle = hexA(M.sil, 0.6);
        for (let cy = s.y + s.h; cy < s.y + s.h + 18; cy += 3)
          x.fillRect(Math.round(s.x + s.w * 0.6), Math.round(cy), 1, 2);
      }
      if (s.lit) {
        x.fillStyle = hexA(M.glow, 0.5);
        x.fillRect(Math.round(s.x + s.w * 0.5), Math.round(s.y - 1), 1, 1);
      }
    }
    return c;
  }

  function paintClouds(B) {
    const { c, x } = layerCanvas();
    const M = B.M;
    for (const cl of B.clouds) {
      x.fillStyle = hexA(M.dust, cl.a);
      x.beginPath();
      x.ellipse(cl.x, cl.y, cl.w / 2, cl.h / 2, 0, 0, TAU);
      x.fill();
      x.fillStyle = hexA(M.lit, cl.a * 0.5);
      x.beginPath();
      x.ellipse(cl.x, cl.y - cl.h * 0.25, cl.w * 0.4, cl.h * 0.28, 0, 0, TAU);
      x.fill();
    }
    return c;
  }

  function paintGrowth(B, L) {
    const { c, x } = layerCanvas();
    const M = B.M;
    const t = L.depth;
    const col = mix(M.sil, M.hor, clamp(0.60 - t * 0.5, 0, 0.6));
    for (const s of L.shapes) {
      const top = HZ - s.h;
      x.strokeStyle = col;
      x.lineWidth = Math.max(1, Math.round(s.w));
      x.beginPath();
      x.moveTo(Math.round(s.x), HZ + 4);
      x.quadraticCurveTo(Math.round(s.x + s.lean * s.h * 0.5), HZ - s.h * 0.5,
                         Math.round(s.x + s.lean * s.h), Math.round(top));
      x.stroke();
      if (s.canopy > 0) {
        x.fillStyle = col;
        x.beginPath();
        x.ellipse(s.x + s.lean * s.h, top, s.canopy, s.canopy * 0.62, 0, 0, TAU);
        x.fill();
        x.fillStyle = hexA(M.lit, clamp(0.20 - t * 0.12, 0.03, 0.2));
        x.beginPath();
        x.ellipse(s.x + s.lean * s.h - s.canopy * 0.25, top - s.canopy * 0.25,
                  s.canopy * 0.5, s.canopy * 0.3, 0, 0, TAU);
        x.fill();
      }
      if (s.frond) {
        x.strokeStyle = col; x.lineWidth = 1;
        for (let f = 0; f < 4; f++) {
          const fy = top + (s.h * 0.2) * f;
          const dir = f % 2 ? 1 : -1;
          x.beginPath();
          x.moveTo(s.x + s.lean * s.h, fy);
          x.quadraticCurveTo(s.x + dir * 9, fy - 3, s.x + dir * 15, fy + 4);
          x.stroke();
        }
      }
      if (s.pods) {
        x.fillStyle = hexA(M.glow, 0.45);
        for (let p = 0; p < 3; p++)
          x.fillRect(Math.round(s.x + s.lean * s.h + (p - 1) * 3), Math.round(top + 6 + p * 5), 1, 2);
      }
    }
    return c;
  }

  /* The near floor everyone stands on. Painted last and in front of
     everything, because a staged figure with nothing under it is a
     sprite on a photograph. */
  function paintDeck(B) {
    const { c, x } = layerCanvas();
    const M = B.M;
    const D = B.deck;
    const top = DECK;
    x.fillStyle = mix(M.sil, M.hor, 0.18);
    if (B.paint === 'air') {
      /* A gantry rather than a floor: it ends, and the ending is the
         point of staging a scene up here at all. */
      const x0 = 22, x1 = BW - 22;
      x.fillRect(x0, top, x1 - x0, 9);
      x.fillStyle = mix(M.sil, M.hor, 0.34);
      for (let i = x0; i < x1; i += 7) x.fillRect(i, top + 9, 2, 5);
      x.fillStyle = mix(M.sil, M.lit, 0.44);
      x.fillRect(x0, top, x1 - x0, 1);
      if (D.rail) {
        x.fillStyle = mix(M.sil, M.hor, 0.42);
        x.fillRect(x0, top - 9, x1 - x0, 1);
        for (let px = x0 + 4; px < x1; px += 26) x.fillRect(px, top - 9, 1, 9);
      }
      const ga = x.createRadialGradient(BW / 2, top + 2, 0, BW / 2, top + 2, BW * 0.3);
      ga.addColorStop(0, hexA(M.glow, 0.14)); ga.addColorStop(1, hexA(M.glow, 0));
      x.fillStyle = ga; x.fillRect(0, top - 8, BW, 24);
      return c;
    }
    x.fillRect(0, top, BW, BH - top);
    x.fillStyle = mix(M.sil, M.lit, 0.34);
    x.fillRect(0, top, BW, 1);
    // wear along the lip
    x.fillStyle = mix(M.sil, M.hor, 0.30);
    for (let i = 0; i < BW; i += 2) {
      if (((i * 13 + B.seed) % 7) < 3 * D.chew + 1) x.fillRect(i, top + 1, 2, 1);
    }
    if (D.grate) {
      x.fillStyle = hexA(M.sil, 0.5);
      for (let gx = 0; gx < BW; gx += 6) x.fillRect(gx, top + 4, 1, BH - top - 4);
    }
    if (D.rail) {
      x.fillStyle = mix(M.sil, M.hor, 0.42);
      x.fillRect(0, top - 9, BW, 1);
      for (let px = 4; px < BW; px += 26) x.fillRect(px, top - 9, 1, 9);
    }
    // a pool of light where the figures stand
    const g = x.createRadialGradient(BW / 2, top + 4, 0, BW / 2, top + 4, BW * 0.35);
    g.addColorStop(0, hexA(M.glow, 0.13));
    g.addColorStop(1, hexA(M.glow, 0));
    x.fillStyle = g; x.fillRect(0, top - 6, BW, BH - top + 6);
    return c;
  }

  /* Everything a set needs to draw, baked once. */
  function bakeSet(B) {
    const art = { sky: paintSky(B), layers: [], deck: paintDeck(B) };
    if (B.paint === 'city') {
      for (const L of B.layers) art.layers.push({ depth: L.depth, c: paintCity(B, L) });
    } else if (B.paint === 'interior') {
      art.layers.push({ depth: 0.5, c: paintInterior(B) });
    } else if (B.paint === 'air') {
      art.layers.push({ depth: 0.30, c: paintClouds(B) });
      for (const L of B.layers) art.layers.push({ depth: L.depth, c: paintAir(B, L) });
    } else {
      for (const L of B.layers) art.layers.push({ depth: L.depth, c: paintGrowth(B, L) });
    }
    /* An interior has no sky to speak of and an air set has no deck to
       stand on; saying so here keeps the draw loop free of branches. */
    art.hasSky = B.paint !== 'interior';
    /* Everyone stands on something, air included: a figure with open
       sky under its feet reads as a mistake rather than as vertigo. */
    art.hasDeck = true;
    return art;
  }

  /* Static grain, baked once for the module. Real film grain crawls;
     this deliberately does not, because a still frame that fizzes reads
     as video noise rather than as a print. */
  let GRAIN = null;
  function grain() {
    if (GRAIN) return GRAIN;
    const n = 64;
    const c = mk(n, n), x = c.getContext('2d');
    const img = x.createImageData(n, n), d = img.data;
    let s = 0x9e3779b9;
    for (let i = 0; i < n * n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const v = (s >>> 24);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = v > 224 ? 26 : v < 26 ? 20 : 0;
    }
    x.putImageData(img, 0, 0);
    GRAIN = c;
    return c;
  }

  /* ============================================================
     FIGURES

     A staged character is its MERC FORGE rig, baked once, plus a rim
     light on the side the set's key light is on and an optional wash
     that pushes it back into the dark. Cached per shot: a scene draws
     three images, not three sprite composites.
     ============================================================ */
  const RIGS = new WeakMap();
  function rigFor(char) {
    if (!char || !char.face) return null;
    let r = RIGS.get(char);
    if (!r) { r = new window.SPRITE.Rig(char.face); RIGS.set(char, r); }
    return r;
  }

  function figureArt(rig, flip, key, dim, aim) {
    const s = rig.sheet;
    const a = aim === undefined ? 1.35 : aim;
    const c = mk(s.CW, s.CH), x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    rig.draw(x, 'idle', 0, a, s.anchor.x, s.anchor.y, flip);
    x.globalCompositeOperation = 'source-atop';
    /* Shadow on everyone who is not talking, and a wash of the key
       light on whoever is — a figure that is merely LESS dark than the
       others is not lit, it is just nearer the front. */
    x.fillStyle = dim > 0 ? 'rgba(6,8,11,' + dim + ')' : hexA(key, 0.14);
    x.fillRect(0, 0, s.CW, s.CH);
    x.globalCompositeOperation = 'source-over';
    // rim: a one-pixel offset copy of the silhouette in the key colour,
    // dropped in behind, so the figure separates from the backdrop
    const r = mk(s.CW, s.CH), rx = r.getContext('2d');
    rx.imageSmoothingEnabled = false;
    rig.draw(rx, 'idle', 0, a, s.anchor.x, s.anchor.y, flip);
    rx.globalCompositeOperation = 'source-atop';
    rx.fillStyle = hexA(key, 0.34);
    rx.fillRect(0, 0, s.CW, s.CH);
    x.globalCompositeOperation = 'destination-over';
    x.drawImage(r, flip ? 1 : -1, -1);
    x.globalCompositeOperation = 'source-over';
    return { c: c, ax: s.anchor.x, ay: s.anchor.y, w: s.CW, h: s.CH };
  }

  /* ============================================================
     VOICE

     A line comes out of the grammar in the plainest form it has. The
     speaker's register is what makes it theirs — and a tic once in a
     while is what stops six characters in six runs sounding like one
     writer with a thesaurus.
     ============================================================ */
  function speak(R, char, text) {
    const V = (window.LORE.VOICES[char && char.voice] || window.LORE.VOICES.clipped);
    let s = String(text).trim();
    if (V.caps) s = s.toUpperCase();
    if (V.tics && V.tics.length && R.chance(0.26)) s += ' ' + R.pick(V.tics);
    return s;
  }

  /* ============================================================
     THE GRAMMAR

     A scene kind is a run of TURNS. A turn names who speaks and gives
     a pool of clauses; some turns compose two pools, which is where
     most of the variety comes from — six openings against six closes
     is thirty-six lines out of twelve written ones.

     The %-codes are story.js's, with a few of our own added on top,
     so a clause can name the place, the faction, the artifact or the
     person without knowing which run it is in.
     ============================================================ */
  const SCENES = {
    open: {
      title: 'THE OFFER',
      turns: [
        { who: 'handler', a: [
          'THE WORK IS IN %P.',
          '%F HOLD %P AND HAVE STOPPED ANSWERING.',
          'SOMETHING WALKED OUT OF %P AND SIGNED FOR A SECTOR IT DOES NOT OWN.',
          'I HAVE A CONTRACT WITH YOUR NAME ALREADY ON IT.',
          'SIT DOWN. THIS IS THE PART WHERE I LIE TO YOU EFFICIENTLY.',
          'EVERY OTHER NAME ON THIS LIST IS EITHER DEAD OR EXPENSIVE.',
          'THERE IS A DOOR IN %P THAT WAS NOT IN THE ORIGINAL BUILD.',
          '%F HAVE BEEN QUIET FOR ELEVEN DAYS. THAT IS TEN TOO MANY.'
        ], b: [
          'IT PAYS. THAT IS THE ENTIRE PITCH.',
          'THE FILE IS THIN BECAUSE THE FILE WAS EDITED.',
          'YOU HAVE WORKED WORSE FOR LESS.',
          'I NEED IT DONE BEFORE ANYONE ELSE IS TOLD IT NEEDS DOING.',
          'DO NOT ASK ME WHO IS PAYING. I ASKED. IT DID NOT HELP.',
          'NOBODY IS GOING TO THANK EITHER OF US FOR THIS.',
          'THE WINDOW IS NARROW AND IT IS CLOSING FROM BOTH ENDS.',
          'I AM TELLING YOU THE PARTS THAT ARE MINE TO TELL.'
        ] },
        { who: 'you', a: [
          'AND THE RATE.',
          'WHO ELSE HAS THIS FILE.',
          'YOU SAID THAT ABOUT THE LAST ONE.',
          'I AM LISTENING.',
          'WHAT IS ACTUALLY IN THERE.',
          'HOW MANY WENT IN BEFORE ME.',
          'YOU CAME TO ME LAST.',
          'SAY THE NUMBER FIRST.'
        ], b: [
          'THAT IS NOT AGREEMENT.',
          'AND THEN SAY IT AGAIN SLOWLY.',
          'I WILL WANT IT IN WRITING FROM SOMEBODY WHO EXISTS.',
          'THE LAST ONE COST ME A HAND I LIKED.',
          'BECAUSE I WILL FIND OUT EITHER WAY.',
          'I HAVE STOPPED PRETENDING NOT TO NOTICE.',
          'I AM NOT WALKING IN BLIND FOR A ROUND FIGURE.'
        ] },
        { who: 'handler', a: [
          'ENOUGH THAT I DID NOT ASK ANYONE BETTER.',
          '%X. WHAT IT IS DEPENDS ON WHO IS HOLDING IT.',
          'NOBODY YOU WILL MEET TWICE.',
          'THE LESS OF THAT YOU KNOW, THE LONGER YOU ARE USEFUL.',
          'DO NOT MAKE THIS A CONVERSATION. IT IS A JOB.',
          'FOUR. THE FOURTH ONE IS STILL IN THERE SOMEWHERE.',
          'I CAME TO YOU LAST BECAUSE YOU COME BACK.',
          'THE FIGURE IS THE ONLY HONEST THING IN THE FILE.'
        ], b: [
          'GO IN. COME OUT. GET PAID.',
          'THAT IS THE WHOLE ARRANGEMENT AND IT IS GENEROUS.',
          'I WILL BE ON THE OTHER END OF THIS THE ENTIRE TIME.',
          'DO NOT IMPROVISE. IMPROVISING IS WHAT KILLED THE OTHERS.',
          'THE DOOR CLOSES AT SHIFT CHANGE. BE THROUGH IT.',
          'WE ARE BOTH TOO OLD TO NEGOTIATE THIS PROPERLY.'
        ] }
      ]
    },
    complication: {
      title: 'REVISION',
      turns: [
        { who: 'handler', a: [
          'THE FLOOR PLAN WAS OLD.',
          '%F KNOW YOU ARE COMING.',
          'THERE IS A SECOND PARTY IN %P.',
          'CHANGE OF SCOPE.',
          'SOMEBODY OPENED SOMETHING IN %P AND HAS NOT SAID WHAT.',
          'THE SITE WENT DARK AT SHIFT CHANGE.',
          'YOUR APPROACH IS COMPROMISED.',
          'THE GARRISON DOUBLED OVERNIGHT AND NOBODY SIGNED FOR THEM.'
        ], b: [
          'EVERY DRAWING WE HAVE OF THAT PLACE IS OLD.',
          'SOMEBODY BILLED THEM FOR THE WARNING.',
          'WHOEVER THEY ARE, THEY ARE NOT MINE AND NOT YOURS.',
          'THE PAY IS THE SAME.',
          'DO NOT GO QUIET ON ME. THE LAST ONE WENT QUIET.',
          'I AM STILL SENDING YOU. READ INTO THAT WHAT YOU LIKE.',
          'ASSUME EVERY ROOM HAS BEEN MOVED SINCE THE SURVEY.',
          'I WOULD PULL YOU OUT IF PULLING YOU OUT WERE AN OPTION.'
        ] },
        { who: 'you', a: [
          'YOU KNEW.',
          'SAY THE PART YOU LEFT OUT.',
          'I WILL BILL YOU FOR THE SURPRISE.',
          'THEN IT IS A DIFFERENT JOB.',
          'HOW LONG HAVE YOU HAD THAT.',
          'AND YOU TELL ME NOW.',
          'THAT IS THE SECOND THING TODAY.'
        ], b: [
          'YOU KNEW WHEN YOU HANDED ME THE FILE.',
          'I WILL FINISH IT. I WILL NOT FORGET IT.',
          'A DIFFERENT JOB IS A DIFFERENT NUMBER.',
          'DO NOT DO THAT AGAIN.',
          'I AM ALREADY INSIDE THE PERIMETER, SO THANK YOU.',
          'KEEP THE CHANNEL OPEN THIS TIME.'
        ] }
      ]
    },
    oracle: {
      title: 'THE ORACLE',
      turns: [
        { who: 'oracle', a: [
          'YOU ARE EARLY. EVERYONE IS, THE FIRST TIME.',
          'I HAVE SEEN THIS CONVERSATION.',
          'THEY BUILT %P TO HOLD SOMETHING IN.',
          'SIT WHERE THE LIGHT IS. I LIKE TO SEE WHAT I AM TELLING.',
          'YOU CAME UP THE SAME STAIR THEY ALL DO.',
          'I KNEW THE SHAPE OF YOU BEFORE THE DOOR OPENED.',
          'THERE IS A VERSION OF THIS WHERE YOU DO NOT COME IN.',
          'THE MACHINES UNDER US HAVE BEEN COUNTING SINCE BEFORE %F.'
        ], b: [
          'IT GOES BADLY FOR ONE OF US.',
          'IT HAS BEEN VERY PATIENT.',
          'YOU WILL NOT REMEMBER THIS PART. THAT IS ARRANGED.',
          'I AM NOT GOING TO CHARGE YOU. THAT SHOULD WORRY YOU.',
          'AND NONE OF THEM CAME BACK DOWN IT.',
          'I HAVE STOPPED TRYING TO CHANGE WHICH ONE WE ARE IN.',
          'NOTHING DOWN THERE HAS FORGOTTEN ANYTHING.',
          'YOU ARE NOT LATE. YOU ARE SIMPLY LAST.'
        ] },
        { who: 'you', a: [
          'WHAT IS IT.',
          'WHO ARE YOU TO ME.',
          'GIVE ME SOMETHING I CAN USE.',
          'I DID NOT COME HERE FOR RIDDLES.',
          'SAY IT PLAINLY OR DO NOT SAY IT.',
          'HOW DO YOU KNOW MY NAME.',
          'PEOPLE PAY YOU FOR THIS.'
        ], b: [
          'I HAVE A DOOR TO BE THROUGH BY MORNING.',
          'I AM NOT ASKING TWICE.',
          'I HAVE HAD A LONG WEEK OF BEING TOLD ALMOST THINGS.',
          'IF YOU ARE WRONG I WILL COME BACK AND SAY SO.',
          'MAKE IT SOMETHING I CAN CARRY.',
          'THEN EARN IT.'
        ] },
        { who: 'oracle', a: [
          '%X IS NOT A THING. IT IS A DECISION SOMEBODY ALREADY MADE.',
          'WHEN IT SPEAKS IN YOUR VOICE, DO NOT ANSWER.',
          'THE ONE WHO SENT YOU IS NOT THE ONE PAYING.',
          'GO TO %P. COUNT THE DOORS. THERE WILL BE ONE TOO MANY.',
          'YOU HAVE ALREADY MET THE PERSON WHO ENDS THIS.',
          'THE FLOOR OF %P IS NOT THE BOTTOM OF %P.',
          '%F ARE NOT GUARDING IT. THEY ARE FEEDING IT.',
          'WHAT YOU ARE CARRYING WAS ISSUED TO SOMEBODY ELSE FIRST.'
        ], b: [
          'THAT IS THE WHOLE OF IT AND IT IS MORE THAN I SHOULD SAY.',
          'YOU WILL UNDERSTAND IT ON THE WAY OUT, NOT ON THE WAY IN.',
          'DO NOT COME BACK AND TELL ME I WAS UNCLEAR.',
          'THE REST IS YOURS TO WALK INTO.',
          'GO. THE LIGHT IN HERE IS NOT FOR YOU.',
          'I WILL BE HERE. I AM ALWAYS HERE.'
        ] }
      ]
    },
    rival: {
      title: 'THE OTHER CONTRACTOR',
      turns: [
        { who: 'rival', a: [
          'YOU ARE STANDING ON MY INVOICE.',
          'THEY SENT YOU TOO. THAT IS INSULTING TO BOTH OF US.',
          'I HAVE BEEN IN %P SINCE BEFORE YOUR BRIEFING.',
          'I KNOW WHAT YOU WERE TOLD. I WAS TOLD IT FIRST.',
          'WALK BACK OUT AND I WILL SAY I NEVER SAW YOU.',
          'THE LAST TIME WE WERE IN A ROOM I WAS BEHIND YOU.',
          'YOU LOOK EXACTLY LIKE THE PHOTOGRAPH. WELL DONE.',
          'THEY GAVE YOU THE SAME MAP. LOOK AT US.'
        ], b: [
          'I AM NOT MOVING.',
          'ONE OF US IS BEING PAID TO FAIL.',
          'ASK YOURSELF WHO BENEFITS IF WE BOTH KEEP GOING.',
          'AND I AM AHEAD OF YOU.',
          'DO NOT MAKE THIS EXPENSIVE.',
          'THERE IS ONE FEE AND IT DOES NOT DIVIDE.',
          'I HAVE NO INTEREST IN THE PART WHERE WE FIGHT.',
          'THE PEOPLE WHO SENT US ARE NOT IN HERE, ARE THEY.'
        ] },
        { who: 'you', a: [
          'THEN STAND SOMEWHERE ELSE.',
          'WHO IS PAYING YOU.',
          'YOU ARE IN MY WAY AND YOU KNOW IT.',
          'I HAVE NO INSTRUCTIONS ABOUT YOU. YET.',
          'SAY THAT AGAIN WITHOUT YOUR HAND THERE.',
          'I REMEMBER THE ROOM. I REMEMBER WHO LEFT FIRST.',
          'YOU HAVE MISREAD WHICH OF US IS IN A HURRY.'
        ], b: [
          'I AM NOT GOING BACK OUT.',
          'MOVE, OR WE FIND OUT.',
          'GIVE ME A NAME AND I WILL CONSIDER IT.',
          'I DID NOT COME THIS FAR TO SHARE.',
          'THIS IS THE POLITE VERSION.',
          'YOU HAVE ABOUT A SENTENCE LEFT.'
        ] },
        { who: 'rival', a: [
          'THE SAME PEOPLE. THAT IS THE JOKE.',
          'I WILL SEE YOU FURTHER IN. WE BOTH KNOW WHERE.',
          'THEN WE ARE BOTH GOING TO FIND OUT SOMETHING TODAY.',
          'YOU ARE NOT THE FIRST OF YOU I HAVE MET.',
          'REMEMBER THAT I OFFERED.',
          'FINE. TAKE THE FLOOR. I WILL TAKE WHAT IS UNDER IT.',
          'I HAVE BEEN PAID EITHER WAY. THINK ABOUT THAT.'
        ], b: [
          'DO NOT BE THERE WHEN I COME BACK THROUGH.',
          'THAT IS THE LAST FRIENDLY THING EITHER OF US SAYS.',
          'I WILL NOT WARN YOU IN THE NEXT ROOM.',
          'GO ON THEN. I WILL WAIT FOR THE NOISE.',
          'SOMEBODY IS GOING TO BE WRONG ABOUT TODAY.'
        ] }
      ]
    },
    betrayal: {
      title: 'THE TURN',
      turns: [
        { who: 'handler', a: [
          'THE CONTRACT IS CLOSED.',
          'YOU ARE NOT COMING OUT WITH IT.',
          'IT WAS NEVER ABOUT %P.',
          'I NEEDED SOMEBODY TO WALK IN AND BE SEEN DOING IT.',
          'DO NOT MAKE ME SAY THE NEXT PART.',
          'THE ACCOUNT WAS SETTLED THIS MORNING. NOT WITH YOU.',
          'I AM GOING TO SAY THIS ONCE AND THEN LEAVE THE CHANNEL.',
          'YOU WERE NEVER THE CONTRACTOR. YOU WERE THE DELIVERY.'
        ], b: [
          'YOUR CODES WENT COLD AN HOUR AGO.',
          'THE CLIENT CHANGED. THE JOB DID NOT.',
          'IT WAS ABOUT SOMEBODY BEING IN THERE WHEN IT OPENED.',
          'NOTHING PERSONAL SURVIVES THIS LONG IN THIS TRADE.',
          'YOU WERE THE CHEAPEST WAY TO ASK A QUESTION.',
          'THE DOOR BEHIND YOU IS ALREADY SEALED. I DID THAT.',
          'THERE IS NOTHING WAITING AT THE EXTRACTION POINT.',
          'I WOULD HAVE PICKED SOMEBODY I LIKED LESS IF I COULD.'
        ] },
        { who: 'you', a: [
          'SAY IT.',
          'HOW LONG.',
          'I WANT THE NAME.',
          'YOU HAD A DOZEN CHANCES TO TELL ME.',
          'THEN WE ARE FINISHED TALKING.',
          'LOOK AT ME WHEN YOU DO IT.',
          'YOU ARE STILL ON THE CHANNEL. THAT IS INTERESTING.'
        ], b: [
          'SAY THE WHOLE THING.',
          'AND THEN STAY WHERE I CAN REACH YOU.',
          'I HAVE BEEN THROUGH WORSE DOORS THAN THE ONE YOU SEALED.',
          'YOU ARE GOING TO REGRET THE HOUR YOU CHOSE.',
          'I AM NOT ASKING FOR AN APOLOGY. I AM ASKING FOR A NAME.',
          'I WILL FINISH THIS EITHER WAY.'
        ] },
        { who: 'handler', a: [
          'LONG ENOUGH THAT ASKING IS BEHIND YOU.',
          'IF I GIVE YOU THE NAME YOU WILL GO AND GET KILLED WITH IT.',
          'I AM NOT SORRY. I AM SOMEWHERE ELSE.',
          'THERE IS NOTHING TO SETTLE. THERE IS ONLY WHAT IS NEXT.',
          'GO. WHILE THE DOOR IS STILL A DOOR.',
          'YOU WILL NOT REACH ME. NOBODY HAS.',
          'I LIKED YOU. THAT IS WHY I AM STILL TALKING.'
        ], b: [
          'THAT IS THE LAST THING I OWE YOU.',
          'DO NOT COME LOOKING. I HAVE ALREADY MOVED.',
          'THE CHANNEL CLOSES WHEN I STOP SPEAKING.',
          'IF YOU GET OUT, WE WILL BOTH PRETEND THIS DID NOT HAPPEN.',
          'GOOD LUCK. I MEAN IT AND IT IS WORTH NOTHING.'
        ] }
      ]
    },
    revelation: {
      title: 'WHAT IT IS',
      turns: [
        { who: 'oracle', a: [
          'YOU WERE ALWAYS GOING TO COME BACK.',
          'SIT. THIS IS THE ANSWER YOU ASKED FOR.',
          'I HAVE HELD THIS SINCE YOU FIRST WALKED IN.',
          'THEY WILL TELL YOU IT WAS AN ACCIDENT. IT WAS A DESIGN.',
          'YOU HAVE EARNED THE PART I KEPT BACK.',
          'PUT IT DOWN. YOU WILL WANT BOTH HANDS FOR THIS.'
        ], b: [
          'EVERYBODY DOES, ONCE THEY HAVE COUNTED THE DOORS.',
          'I HAVE SAID IT TO NOBODY ELSE AND I WILL NOT AGAIN.',
          'IT IS NOT KINDNESS. IT IS BOOKKEEPING.',
          'AFTERWARDS YOU WILL WISH I HAD KEPT IT.',
          'DO NOT INTERRUPT. I ONLY HAVE IT IN ONE ORDER.'
        ] },
        { who: 'oracle', a: ['%S'] },
        { who: 'you', a: [
          'AND YOU LET ME WALK ALL THE WAY HERE.',
          'THAT CHANGES WHO I AM GOING TO SEE.',
          'HOW MANY PEOPLE KNOW.',
          'THEN THERE IS ONLY ONE PLACE LEFT TO GO.',
          'I WOULD HAVE PREFERRED THE RIDDLES.',
          'SAY IT AGAIN. SLOWLY.',
          'EVERY JOB I TOOK WAS PART OF IT.'
        ], b: [
          'I AM GOING ANYWAY.',
          'DO NOT FOLLOW ME DOWN.',
          'NOW I KNOW WHOSE NAME TO SAY AT THE END.',
          'THAT IS THE FIRST HONEST THING ANYONE HAS SAID TO ME.',
          'IT DOES NOT CHANGE WHAT HAPPENS NEXT. ONLY WHY.'
        ] }
      ]
    },
    ending: {
      title: 'AFTER',
      turns: [
        { who: 'you', a: ['%E'] },
        { who: 'you', a: [
          'THE STACK DOES NOT NOTICE. IT NEVER DID.',
          'SOMEBODY WILL FILE THIS UNDER A NUMBER.',
          'THERE IS ANOTHER CONTRACT ALREADY. THERE ALWAYS IS.',
          'I WILL NOT BE TELLING THIS PART.',
          'IT IS QUIET. THAT IS NOT THE SAME AS OVER.',
          'THE LIGHTS IN %P WENT OUT AN HOUR AGO AND NOBODY CAME.',
          'I HAVE STOPPED COUNTING WHAT IT COST.'
        ], b: [
          'THAT IS THE WHOLE OF IT.',
          'IT WILL DO.',
          'IT IS ENOUGH TO WALK OUT ON.',
          'I WILL SLEEP SOMEWHERE WITH A WINDOW.',
          'AND THAT IS ALL ANYONE HERE GETS.',
          'THE REST IS SOMEBODY ELSE\'S SHIFT.'
        ] }
      ]
    },
    choice: {
      title: 'A DECISION',
      turns: [
        { who: 'handler', a: ['%Q'] },
        { who: 'you', a: [
          'GIVE ME A MOMENT.',
          'YOU ARE ENJOYING THIS.',
          'BOTH ANSWERS COST SOMETHING.',
          'I HAVE HEARD BETTER OFFERS IN WORSE ROOMS.',
          'DO NOT RUSH ME.',
          'SOMEBODY ALWAYS ASKS THIS ONE.',
          'THERE IS NO VERSION OF THIS I WALK AWAY CLEAN FROM.'
        ], b: [
          'I WILL SAY IT ONCE AND THEN WE GO.',
          'AND THEN NEITHER OF US MENTIONS IT AGAIN.',
          'WHATEVER I PICK, IT IS MINE.',
          'I AM AWARE OF WHAT THE OTHER ONE COSTS.',
          'STOP TALKING WHILE I THINK.'
        ] }
      ]
    },
    arrival: {
      title: 'ARRIVAL',
      turns: [
        { who: 'you', a: [
          '%P. HELD BY %F.',
          'THIS IS %P. IT LOOKS EXACTLY LIKE THE FILE.',
          '%P, AND NOBODY ON THE APPROACH.',
          'THE FILE CALLED THIS %P. THE FILE WAS BEING POLITE.',
          '%F HAVE HAD %P LONGER THAN THE FILE ADMITS.'
        ], b: [
          'THAT IS NEVER GOOD.',
          'IN AND OUT.',
          'THE FILE HAS BEEN WRONG ALL WEEK.',
          'SOMEBODY IS AWAKE IN THERE.',
          'NOTHING ABOUT THE APPROACH IS RIGHT.'
        ] }
      ]
    }
  };
  const SCENE_KEYS = Object.keys(SCENES);

  /* Extra %-codes on top of story.js's, then hand the rest over. A
     clause never has to know which layer owns which letter. */
  function fill(text, ctx, extra) {
    let s = String(text || '');
    const e = extra || {};
    s = s.replace(/%Y/g, ctx.W.you.name)
         .replace(/%E/g, e.ending || '')
         .replace(/%Q/g, e.prompt || '')
         .replace(/%W/g, e.want || (ctx.W.you.want || ''))
         .replace(/%U/g, e.wound || (ctx.W.you.wound || ''));
    return window.STORY.fill(s, ctx);
  }

  /* ============================================================
     THE DIRECTOR

     Beat in, shots out. Everything it decides — the set, the staging,
     who is lit, where the camera starts and stops — comes off the
     beat and the world, so the same run always stages the same way and
     two runs never do.
     ============================================================ */
  /* Where a figure's gun is pointing. Everybody stands with it lowered
     unless the scene is one where it would not be — which is two of
     them, and they are the two the player remembers. */
  const AIM_LEVEL = { rival: true, betrayal: true };
  const AIM_DOWN = 1.35;

  const STAGING = {
    duo:    [{ at: -0.40, flip: false }, { at: 0.38, flip: true }],
    close:  [{ at: -0.26, flip: false, scale: 3 }, { at: 0.28, flip: true, scale: 3 }],
    solo:   [{ at: 0.00, flip: false }],
    aside:  [{ at: -0.30, flip: false }],
    over:   [{ at: -0.62, flip: false, dim: 0.72, scale: 3 }, { at: 0.28, flip: true }],
    trio:   [{ at: -0.56, flip: false }, { at: 0.02, flip: false }, { at: 0.56, flip: true }]
  };
  const STAGING_KEYS = Object.keys(STAGING);

  function camMove(R) {
    /* Four moves, all slow. A cutscene camera that does anything
       energetic fights the stillness the form is built on. */
    const k = R.int(0, 3);
    if (k === 0) return { x0: -12, y0: 0, z0: 1.0, x1: 12, y1: 0, z1: 1.0, k: 'pan' };
    if (k === 1) return { x0: 8, y0: 2, z0: 1.0, x1: -8, y1: -1, z1: 1.06, k: 'drift' };
    if (k === 2) return { x0: 0, y0: 0, z0: 1.0, x1: 0, y1: -2, z1: 1.14, k: 'push' };
    return { x0: 0, y0: -2, z0: 1.10, x1: 0, y1: 1, z1: 1.0, k: 'pull' };
  }

  function whoIn(W, id) {
    if (id === 'you') return W.you;
    if (id === 'handler') return W.handler;
    if (id === 'rival') return W.rival;
    if (id === 'oracle') return W.oracle;
    if (id === 'antagonist') return W.antagonist;
    return W.charById(id) || W.you;
  }

  /* `beat` is a story beat; `ctx` is story.ctxFor(beat); `opts` may
     carry an ending line or a choice prompt for the beats that have
     one. Returns a scene: a set, a card and a list of shots. */
  function direct(beat, ctx, opts) {
    const o = opts || {};
    const W = ctx.W;
    /* A beat's `kind` is its scene name when it has one; a choice beat
       is named after its template ("allegiance"), which is a story
       word rather than a staging one, so it falls through to its
       type. */
    const kind = (beat && SCENES[beat.kind]) ? beat.kind
               : (beat && SCENES[beat.type]) ? beat.type : 'open';
    const G = SCENES[kind] || SCENES.open;
    const seed = ((W.seed ^ 0x5ce2e) + (beat && beat.i !== undefined ? beat.i * 2654435761 : 0)) >>> 0;
    const R = GW.makeRng(seed);

    const setId = o.set || R.pick(SET_FOR[kind] || SET_KEYS);
    const B = makeSet((seed ^ 0x9e3779b9) >>> 0, { set: setId, mood: o.mood });

    /* Who is on stage. The beat says who it is about; anyone it names
       who is not `you` is staged opposite, and `you` always gets a
       body, because a scene where the person the story is happening to
       is off-camera is a memo. */
    const names = (beat && beat.who) ? beat.who.slice() : [];
    for (const t of G.turns) if (names.indexOf(t.who) < 0) names.push(t.who);
    if (names.indexOf('you') < 0 && names.length < 2) names.push('you');
    const cast = names.slice(0, 3).map(id => ({ id: id, char: whoIn(W, id) }));

    const stageKey = cast.length >= 3 ? 'trio'
                   : cast.length === 1 ? 'solo'
                   : R.pick(['duo', 'close', 'over']);
    const stage = STAGING[stageKey];

    const extra = {
      ending: o.ending || '',
      prompt: o.prompt || '',
      want: (cast[0] && cast[0].char.want) || '',
      wound: (cast[0] && cast[0].char.wound) || ''
    };

    const shots = [];
    /* The establishing shot: the set, nobody in it, and a caption. It
       is what tells the player they are somewhere new before anybody
       opens their mouth. */
    shots.push({
      set: B, cam: camMove(R), cast: [], speaker: null, line: null,
      caption: B.label, hold: 2.0, tint: B.M.lit
    });

    for (let i = 0; i < G.turns.length; i++) {
      const turn = G.turns[i];
      const sp = cast.find(c => c.id === turn.who) || cast[0];
      let text = R.pick(turn.a);
      if (turn.b && R.chance(0.8)) text += ' ' + R.pick(turn.b);
      const line = speak(R, sp.char, fill(text, ctx, extra));
      const staged = cast.map((c, n) => {
        const st = stage[Math.min(n, stage.length - 1)];
        return {
          id: c.id, char: c.char,
          at: st.at, flip: st.flip,
          scale: st.scale || 2,
          /* Whoever is not talking goes back into the dark. It is the
             oldest trick in staging and it does all the work of a
             camera cut without needing one. */
          dim: c === sp ? 0 : (st.dim !== undefined ? st.dim : 0.55),
          aim: AIM_LEVEL[kind] ? 0 : AIM_DOWN
        };
      });
      shots.push({
        set: B, cam: camMove(R), cast: staged, speaker: sp.char,
        line: line, caption: null, hold: 0, tint: B.M.lit
      });
    }

    return {
      kind: kind, seed: seed, set: B, setId: setId,
      title: G.title,
      card: {
        title: (beat && beat.actName) || G.title,
        sub: ctx.place ? ctx.place.name : (ctx.faction ? ctx.faction.name : B.label)
      },
      shots: shots,
      cast: cast.map(c => c.id)
    };
  }

  /* ============================================================
     THE RUNTIME

     A tiny state machine over the shots. Lines run through a DIALOG,
     which is why they reveal and advance exactly like the wardens do:
     one text machine, one feel.
     ============================================================ */
  function Cutscene(scene, opts) {
    const o = opts || {};
    this.scene = scene;
    this.i = -1;
    this.t = 0;
    this.total = 0;
    this.done = false;
    this.skipped = false;
    this.dialog = new window.DIALOG.Dialog();
    this.auto = !!o.auto;         // autopilot: no keys, so shots time out
    this.autoHold = o.autoHold === undefined ? 1.1 : o.autoHold;
    this.art = null;              // baked lazily on the first draw
    this.enter(0);
  }

  Cutscene.prototype.shot = function () { return this.scene.shots[this.i] || null; };

  Cutscene.prototype.enter = function (i) {
    if (i >= this.scene.shots.length) { this.finish(); return; }
    this.i = i;
    this.t = 0;
    const s = this.shot();
    this.figures = null;          // rebuilt on the first draw of the shot
    if (s.line) {
      this.dialog.say([s.line], {
        speaker: s.speaker ? (s.speaker.title ? s.speaker.title + ' ' + s.speaker.name
                                              : s.speaker.name) : null,
        tint: s.tint, portrait: null
      });
    } else {
      this.dialog.open = false;
    }
  };

  Cutscene.prototype.finish = function () {
    this.done = true;
    this.dialog.open = false;
  };

  /* Skip the whole thing. Every cutscene in a game that generates a
     fresh one every run has to be skippable, or the second run is a
     worse game than the first. */
  Cutscene.prototype.skip = function () {
    this.skipped = true;
    this.finish();
  };

  Cutscene.prototype.step = function (dt, advance, held) {
    if (this.done) return false;
    this.t += dt;
    this.total += dt;
    const s = this.shot();
    if (!s) { this.finish(); return false; }
    if (s.line) {
      /* An autopilot has no hands. It reads at the speed the reveal
         runs and then waits a beat, which is the same pacing a person
         who is not skipping would get. */
      const adv = this.auto ? (this.dialog.full() && this.t > this.dialog.text().length / 42 + this.autoHold)
                            : advance;
      const alive = this.dialog.step(dt, adv, held);
      if (!alive) this.enter(this.i + 1);
    } else {
      if (this.t >= s.hold || (!this.auto && advance)) this.enter(this.i + 1);
    }
    return !this.done;
  };

  /* Where the camera is in the current shot, 0..1 through it. */
  Cutscene.prototype.camAt = function () {
    const s = this.shot();
    if (!s) return { x: 0, y: 0, z: 1 };
    const c = s.cam;
    const span = s.line ? Math.max(2.2, s.line.length / 34) : s.hold;
    const u = clamp(this.t / Math.max(0.5, span), 0, 1);
    const e = u * u * (3 - 2 * u);        // smoothstep, so it eases both ends
    return { x: c.x0 + (c.x1 - c.x0) * e,
             y: c.y0 + (c.y1 - c.y0) * e,
             z: c.z0 + (c.z1 - c.z0) * e };
  };

  /* ============================================================
     THE RENDERER

     Draws into the 448x252 design space. The caller supplies the
     transform, exactly as it does for the HUD.
     ============================================================ */
  function textAt(ctx, s, x, y, col, align, font) {
    ctx.font = font || FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,.75)';
    ctx.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
    ctx.fillStyle = col;
    ctx.fillText(s, Math.round(x), Math.round(y));
    ctx.textAlign = 'left';
  }

  function wrap(ctx, s, maxW) {
    ctx.font = FONT;
    const out = [];
    let line = '';
    for (const word of String(s).split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; }
      else line = test;
    }
    if (line) out.push(line);
    return out;
  }

  function draw(ctx, cs, time) {
    const s = cs.shot();
    if (!s) return;
    if (!cs.art) cs.art = bakeSet(cs.scene.set);
    const art = cs.art, B = cs.scene.set, M = B.M;
    const cam = cs.camAt();

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.beginPath(); ctx.rect(0, 0, CS_W, CS_H); ctx.clip();

    // the zoom, about the middle of the frame
    ctx.translate(CS_W / 2, CS_H / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-CS_W / 2, -CS_H / 2);

    const put = (canvas, depth) => {
      const ox = -(MARGIN + cam.x * depth) * 2;
      const oy = -(cam.y * depth) * 2;
      ctx.drawImage(canvas, 0, 0, BW, BH, Math.round(ox), Math.round(oy), BW * 2, BH * 2);
    };

    if (art.hasSky) put(art.sky, 0.06);
    else put(art.sky, 0.0);
    for (const L of art.layers) put(L.c, L.depth);
    if (art.hasDeck) put(art.deck, 1.0);

    // particulate, drifting across everything behind the figures
    ctx.fillStyle = hexA(M.dust, 1);
    for (const m of B.motes) {
      const mx = ((m.x * CS_W + time * m.sp * 6) % (CS_W + 20)) - 10 - cam.x * 1.4;
      const my = ((m.y * CS_H + Math.sin(time * 0.6 + m.x * 9) * 6) % CS_H);
      ctx.globalAlpha = m.a;
      ctx.fillRect(Math.round(mx), Math.round(my), m.r, m.r);
    }
    ctx.globalAlpha = 1;

    /* the figures. Baked on first draw of the shot and cached, so a
       held shot is a blit and a sine wave rather than a composite. */
    if (!cs.figures) {
      cs.figures = s.cast.map(c => {
        const rig = rigFor(c.char);
        if (!rig) return null;
        return { art: figureArt(rig, c.flip, M.lit, c.dim, c.aim),
                 at: c.at, scale: c.scale, dim: c.dim, id: c.id };
      }).filter(Boolean);
    }
    for (let n = 0; n < cs.figures.length; n++) {
      const f = cs.figures[n];
      const px = CS_W / 2 + f.at * (CS_W * 0.42) - cam.x * 2;
      // breathing: a pixel of vertical sway, out of phase per figure
      const sway = Math.sin(time * 1.15 + n * 2.1) * 1.0;
      const py = FLOOR - cam.y * 2 + sway;
      const w = f.art.w * f.scale, h = f.art.h * f.scale;
      // contact shadow, so the feet are on the deck rather than near it
      ctx.fillStyle = 'rgba(0,0,0,.34)';
      ctx.beginPath();
      ctx.ellipse(px, FLOOR - cam.y * 2 + 1, 13 * f.scale * 0.5, 3, 0, 0, TAU);
      ctx.fill();
      ctx.drawImage(f.art.c, 0, 0, f.art.w, f.art.h,
                    Math.round(px - f.art.ax * f.scale), Math.round(py - f.art.ay * f.scale),
                    Math.round(w), Math.round(h));
    }

    ctx.restore();

    /* --- the pass that makes it a print rather than a render --- */
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // grain
    const g = grain();
    ctx.globalAlpha = 0.34;
    for (let gy = 0; gy < CS_H; gy += 128)
      for (let gx = 0; gx < CS_W; gx += 128)
        ctx.drawImage(g, 0, 0, 64, 64, gx, gy, 128, 128);
    ctx.globalAlpha = 1;
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    for (let y = 0; y < CS_H; y += 2) ctx.fillRect(0, y, CS_W, 1);
    // vignette
    const vg = ctx.createRadialGradient(CS_W / 2, CS_H / 2, CS_H * 0.30,
                                        CS_W / 2, CS_H / 2, CS_W * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, CS_W, CS_H);
    // letterbox
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, CS_W, BAR);
    ctx.fillRect(0, CS_H - BAR, CS_W, BAR);
    ctx.fillStyle = hexA(M.lit, 0.18);
    ctx.fillRect(0, BAR, CS_W, 1);
    ctx.fillRect(0, CS_H - BAR - 1, CS_W, 1);
    ctx.restore();

    /* --- titles and text, above the grain --- */
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // the act card, over the establishing shot only, fading at both ends
    if (cs.i === 0 && cs.scene.card) {
      const u = clamp(cs.t / 0.45, 0, 1) * clamp((s.hold - cs.t) / 0.5, 0, 1);
      if (u > 0.01) {
        ctx.globalAlpha = u;
        textAt(ctx, cs.scene.card.title, CS_W / 2, CS_H / 2 - 14, '#e6ecf2', 'center', FONT_BIG);
        textAt(ctx, cs.scene.card.sub, CS_W / 2, CS_H / 2 + 6, hexA(M.lit, 0.85), 'center');
        ctx.globalAlpha = 1;
      }
    }
    if (s.caption && cs.i !== 0) {
      textAt(ctx, s.caption, 14, CS_H - BAR + 5, hexA(M.lit, 0.8));
    }

    // the line, in the lower bar, with the speaker on a tab above it
    const D = cs.dialog;
    if (D.open && s.line) {
      const x0 = 22, x1 = CS_W - 22;
      const boxY = CS_H - BAR - 42;
      ctx.fillStyle = 'rgba(5,7,10,.86)';
      ctx.fillRect(x0, boxY, x1 - x0, 38);
      ctx.strokeStyle = hexA(s.tint, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, boxY + 0.5, x1 - x0 - 1, 37);
      if (D.speaker) {
        ctx.font = FONT;
        const label = ' ' + D.speaker + ' ';
        const lw = Math.ceil(ctx.measureText(label).width) + 4;
        ctx.fillStyle = 'rgba(5,7,10,.98)';
        ctx.fillRect(x0 + 4, boxY - 9, lw, 10);
        ctx.strokeStyle = hexA(s.tint, 0.8);
        ctx.strokeRect(x0 + 4.5, boxY - 8.5, lw - 1, 10);
        textAt(ctx, D.speaker, x0 + 7, boxY - 7, s.tint);
      }
      const lines = wrap(ctx, D.text(), x1 - x0 - 16);
      let budget = Math.floor(D.shown);
      let ly = boxY + 7;
      for (const line of lines) {
        if (budget <= 0) break;
        const take = line.slice(0, budget);
        budget -= line.length + 1;
        if (take) textAt(ctx, take, x0 + 8, ly, '#dce3ea');
        ly += 10;
        if (ly > boxY + 32) break;
      }
      if (D.full() && Math.floor(time * 2.6) % 2 === 0) {
        ctx.fillStyle = s.tint;
        const bx = x1 - 12, by = boxY + 29;
        ctx.beginPath();
        ctx.moveTo(bx, by); ctx.lineTo(bx + 5, by); ctx.lineTo(bx + 2.5, by + 4);
        ctx.closePath(); ctx.fill();
      }
    }
    // the shot counter and the skip hint, in the top bar
    textAt(ctx, (cs.i + 1) + '/' + cs.scene.shots.length, CS_W - 14, 5,
           'rgba(150,165,180,.55)', 'right');
    textAt(ctx, cs.scene.title, 14, 5, 'rgba(150,165,180,.55)');
    ctx.restore();
  }

  return {
    /* the world of sets */
    MOODS, MOOD_KEYS, SETS, SET_KEYS, SET_FOR, SCENES, SCENE_KEYS, STAGING, STAGING_KEYS,
    makeSet, bakeSet, grain, AIM_LEVEL, AIM_DOWN,
    /* the director */
    direct, fill, speak, rigFor, figureArt,
    /* the runtime and the camera */
    Cutscene, draw,
    /* geometry, for anyone drawing around it */
    CS_W, CS_H, BW, BH, HZ, DECK, FLOOR, BAR, FONT, FONT_BIG
  };
})();
