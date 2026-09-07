/* ============================================================
   audio.js — procedural sound. WebAudio only, no samples, no deps,
   in keeping with the rest of the project: everything is generated.

   Every effect is a short envelope over an oscillator plus a noise
   burst, mixed through one master gain so a single mute works.
   ============================================================ */
window.AUDIO = (function () {
  "use strict";

  let ctx = null, master = null, noiseBuf = null;
  let enabled = true, ready = false;
  let ambGain = null, ambNodes = [];

  function init() {
    if (ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // One second of white noise, reused by every percussive effect.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ready = true;
    return true;
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function noise(t, len, gain, filterHz, q) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterHz;
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + len + 0.02);
  }

  function tone(t, type, f0, f1, len, gain) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + len + 0.02);
  }

  /* Distance falloff: `pan` is -1..1 across the view, `dist` 0..1. */
  function place(gain, dist) { return gain * Math.max(0, 1 - dist * 0.85); }

  const SFX = {
    shot(spec, dist) {
      const t = ctx.currentTime, s = spec || { f: 700, drop: 0.5, len: 0.1, noise: 0.5, type: 'square' };
      tone(t, s.type, s.f, s.f * s.drop, s.len, place(0.17, dist));
      noise(t, s.len * 1.4, place(0.13 * s.noise, dist), 1800, 0.7);
    },
    hit(dist) {
      const t = ctx.currentTime;
      noise(t, 0.07, place(0.16, dist), 3200, 1.4);
      tone(t, 'square', 300, 120, 0.05, place(0.06, dist));
    },
    flesh(dist) {
      const t = ctx.currentTime;
      noise(t, 0.11, place(0.15, dist), 700, 0.9);
      tone(t, 'sine', 180, 70, 0.1, place(0.09, dist));
    },
    boom(dist) {
      const t = ctx.currentTime;
      noise(t, 0.45, place(0.34, dist), 320, 0.5);
      tone(t, 'sawtooth', 150, 34, 0.42, place(0.22, dist));
      tone(t, 'sine', 70, 26, 0.5, place(0.18, dist));
    },
    jump() { tone(ctx.currentTime, 'square', 260, 470, 0.09, 0.07); },
    land() { const t = ctx.currentTime; noise(t, 0.09, 0.1, 420, 0.8); tone(t, 'sine', 150, 74, 0.08, 0.07); },
    hurt() {
      const t = ctx.currentTime;
      tone(t, 'sawtooth', 340, 90, 0.24, 0.19);
      noise(t, 0.2, 0.13, 900, 0.6);
    },
    die() {
      const t = ctx.currentTime;
      tone(t, 'sawtooth', 300, 40, 0.9, 0.22);
      tone(t + 0.05, 'square', 180, 30, 0.8, 0.14);
      noise(t, 0.7, 0.16, 500, 0.4);
    },
    pickup() {
      const t = ctx.currentTime;
      tone(t, 'square', 640, 640, 0.05, 0.11);
      tone(t + 0.055, 'square', 980, 980, 0.08, 0.11);
    },
    reload() {
      const t = ctx.currentTime;
      noise(t, 0.05, 0.1, 2400, 2); noise(t + 0.14, 0.07, 0.12, 1500, 2);
    },
    dry() { noise(ctx.currentTime, 0.04, 0.09, 2600, 3); },
    ui() { tone(ctx.currentTime, 'square', 520, 520, 0.035, 0.07); },
    uiBig() {
      const t = ctx.currentTime;
      tone(t, 'square', 300, 300, 0.05, 0.09);
      tone(t + 0.06, 'square', 450, 450, 0.09, 0.09);
    },
    alarm() {
      const t = ctx.currentTime;
      tone(t, 'sawtooth', 440, 700, 0.22, 0.1);
      tone(t + 0.24, 'sawtooth', 440, 700, 0.22, 0.1);
    },
    /* wet, low, and short — a chunk of something coming apart */
    splat(_, dist) {
      const t = ctx.currentTime;
      noise(t, 0.20, place(0.24, dist), 420, 0.5);
      noise(t + 0.03, 0.14, place(0.14, dist), 1100, 0.8);
      tone(t, 'sine', 150, 48, 0.22, place(0.15, dist));
    },
    /* the whip-crack of a tentacle being thrown out */
    lash(_, dist) {
      const t = ctx.currentTime;
      noise(t, 0.13, place(0.15, dist), 2100, 1.6);
      tone(t, 'sawtooth', 200, 620, 0.09, place(0.08, dist));
    },
    extract() {
      const t = ctx.currentTime;
      [330, 440, 550, 740].forEach((f, i) =>
        tone(t + i * 0.11, 'square', f, f, 0.3, 0.1));
    }
  };

  function play(name, arg, dist) {
    if (!enabled || !ready) return;
    resume();
    try { SFX[name] && SFX[name](arg, dist || 0); } catch (e) { /* audio is never fatal */ }
  }

  /* ============================================================
     THE SOUND OF A PLACE.

     One industrial drone for every level is the same mistake as one
     parallax layer for every level: a fungal bloom, a data farm, a sky
     lane and an ash forge are four places and used to be one noise.

     `bedFor` describes the bed as data — layers, filter, movement,
     and what occasionally happens in it — and `ambience` builds nodes
     out of that description. Split for the same reason the story
     screens are: the harness has no WebAudio at all, so a bed written
     straight into oscillators cannot be checked, and "does a wood
     sound different from a corridor" is exactly the kind of claim that
     rots silently.

     Nothing here is sampled. A drip is a sine with a fast pitch drop;
     wind is noise through a sweeping bandpass; a room tone is the same
     noise through a narrow one. It is all the same six primitives the
     effects are made of.
     ============================================================ */
  const KIND_BED = {
    city: {
      /* Wide, low and mechanical: the stack, heard from inside it. */
      base: 55, cut: 220, q: 3, gain: 0.055,
      layers: [{ type: 'sawtooth', mul: 1, gain: 0.5 },
               { type: 'sawtooth', mul: 1.005, gain: 0.5 },
               { type: 'sine', mul: 1.5, gain: 0.25 }],
      sweep: { rate: 0.055, depth: 70 },
      air: null,
      events: [{ k: 'clank', every: [9, 22], gain: 0.05 }]
    },
    interior: {
      /* A room, not a city. Higher fundamental so it reads as close
         walls, a narrow band of air handling over the top, and
         something in the ducts every so often. */
      base: 78, cut: 340, q: 5, gain: 0.05,
      layers: [{ type: 'sawtooth', mul: 1, gain: 0.42 },
               { type: 'square', mul: 2.002, gain: 0.14 },
               { type: 'sine', mul: 0.5, gain: 0.34 }],
      sweep: { rate: 0.09, depth: 40 },
      air: { hz: 620, q: 1.6, gain: 0.030 },
      events: [{ k: 'clank', every: [5, 14], gain: 0.07 },
               { k: 'drip', every: [7, 19], gain: 0.05 }]
    },
    air: {
      /* Nothing under you and a long way to fall. Broadband wind with
         a slow sweep, a pressure rumble beneath it, and no clank —
         there is nothing up here to hit. */
      base: 34, cut: 160, q: 1.4, gain: 0.042,
      layers: [{ type: 'sine', mul: 1, gain: 0.6 },
               { type: 'sine', mul: 1.007, gain: 0.4 }],
      sweep: { rate: 0.031, depth: 26 },
      air: { hz: 900, q: 0.7, gain: 0.055, sweep: { rate: 0.07, depth: 520 } },
      events: [{ k: 'gust', every: [6, 15], gain: 0.05 }]
    },
    nature: {
      /* Alive. The bed breathes rather than hums, and the things that
         happen in it are irregular — a wood that ticks on a schedule
         is a machine with leaves on. */
      base: 46, cut: 200, q: 2, gain: 0.040,
      layers: [{ type: 'sine', mul: 1, gain: 0.45 },
               { type: 'triangle', mul: 2.01, gain: 0.16 }],
      sweep: { rate: 0.043, depth: 55 },
      air: { hz: 430, q: 0.9, gain: 0.040, sweep: { rate: 0.05, depth: 260 } },
      events: [{ k: 'drip', every: [3, 9], gain: 0.06 },
               { k: 'call', every: [8, 24], gain: 0.045 }]
    }
  };
  const KIND_KEYS = Object.keys(KIND_BED);

  /* Sky moods that pull the whole bed down. A level under a dead sky
     should sit lower than one under an ember storm. */
  const MOOD_DROP = { voidnight: 0.72, eclipse: 0.78, nuclearwinter: 0.84,
                      frostfall: 0.88, emberstorm: 1.10, magnetar: 1.14,
                      aurora: 1.06 };

  const clampN = (v, a, b) => v < a ? a : v > b ? b : v;

  /* The bed a place should have. Pure: same arguments, same answer,
     and no WebAudio anywhere in it. */
  function bedFor(opts) {
    const o = opts || {};
    const kind = KIND_BED[o.kind] ? o.kind : 'city';
    const K = KIND_BED[kind];
    const drop = MOOD_DROP[o.mood] || 1;
    /* A faction's holdings have a tone of their own: the owner's hue
       picks the interval the bed's upper voice sits at, so two levels
       under the same people are in the same key without either of them
       becoming a jingle. */
    const INTERVALS = [1.5, 1.335, 1.26, 1.5, 1.6, 1.78, 1.5, 1.335];
    const hue = o.hue === undefined || o.hue === null ? null
              : ((o.hue % 360) + 360) % 360;
    const interval = hue === null ? null
                   : INTERVALS[Math.floor(hue / 360 * INTERVALS.length) % INTERVALS.length];
    const base = clampN(K.base * drop, 24, 180);

    const layers = K.layers.map(L => ({
      type: L.type,
      /* Only the voice ABOVE the fundamental takes the faction's
         interval. Moving the root would transpose the level, which is
         a different place rather than the same place under new
         management. */
      hz: clampN(base * (interval !== null && L.mul > 1.2 ? interval : L.mul), 18, 900),
      gain: L.gain
    }));

    return {
      kind: kind, base: base,
      cut: clampN(K.cut * drop, 90, 900), q: K.q,
      gain: K.gain,
      layers: layers,
      sweep: K.sweep,
      air: K.air ? Object.assign({}, K.air) : null,
      events: K.events.map(e => Object.assign({}, e)),
      interval: interval
    };
  }

  /* What happens in a bed, once. Built out of the same primitives as
     everything else, so a drip and a shot are the same machine. */
  const BED_EVENTS = {
    clank: (t, g) => { tone(t, 'square', 180, 60, 0.16, g * 0.5);
                       noise(t, 0.10, g, 900, 6); },
    drip:  (t, g) => { tone(t, 'sine', 1400, 320, 0.13, g); },
    gust:  (t, g) => { noise(t, 1.1, g, 780, 0.6); },
    call:  (t, g) => { tone(t, 'triangle', 520, 760, 0.10, g);
                       tone(t + 0.13, 'triangle', 760, 610, 0.09, g * 0.7); }
  };

  let ambTimer = null, ambBed = null;

  /* Start or stop the bed. `opts` may be a sky-mood string, as it was
     when there was only one bed, or the description of a place. */
  function ambience(on, opts) {
    if (!ready) return;
    if (!on) {
      ambNodes.forEach(n => { try { n.stop(); } catch (e) {} });
      ambNodes = [];
      if (ambTimer) { clearTimeout(ambTimer); ambTimer = null; }
      if (ambGain) { try { ambGain.disconnect(); } catch (e) {} ambGain = null; }
      ambBed = null;
      return;
    }
    if (ambGain) return;
    resume();
    const bed = ambBed = bedFor(typeof opts === 'string' ? { mood: opts } : opts);

    ambGain = ctx.createGain();
    ambGain.gain.value = 0.0;
    ambGain.gain.linearRampToValueAtTime(bed.gain, ctx.currentTime + 3);
    ambGain.connect(master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = bed.cut; lp.Q.value = bed.q;
    lp.connect(ambGain);

    for (const L of bed.layers) {
      const o = ctx.createOscillator();
      o.type = L.type;
      o.frequency.value = L.hz;
      const g = ctx.createGain();
      g.gain.value = L.gain;
      o.connect(g); g.connect(lp);
      o.start(); ambNodes.push(o);
    }
    // Slow filter sweep so the bed breathes instead of droning flat.
    if (bed.sweep) {
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = bed.sweep.rate; lfoG.gain.value = bed.sweep.depth;
      lfo.connect(lfoG); lfoG.connect(lp.frequency);
      lfo.start(); ambNodes.push(lfo);
    }
    /* Air: a band of noise over the drone. It is what separates a room
       from a chord — the drone says how big the space is and the air
       says what is moving through it. */
    if (bed.air) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = bed.air.hz; bp.Q.value = bed.air.q;
      const ag = ctx.createGain(); ag.gain.value = bed.air.gain;
      src.connect(bp); bp.connect(ag); ag.connect(ambGain);
      src.start(); ambNodes.push(src);
      if (bed.air.sweep) {
        const alfo = ctx.createOscillator(), alfoG = ctx.createGain();
        alfo.frequency.value = bed.air.sweep.rate;
        alfoG.gain.value = bed.air.sweep.depth;
        alfo.connect(alfoG); alfoG.connect(bp.frequency);
        alfo.start(); ambNodes.push(alfo);
      }
    }
    /* And the things that happen in it, on their own irregular clocks. */
    if (bed.events.length) {
      const tick = () => {
        if (!ambGain || !ambBed) return;
        const e = ambBed.events[Math.floor(Math.random() * ambBed.events.length)];
        const fn = BED_EVENTS[e.k];
        if (fn && enabled) { try { fn(ctx.currentTime + 0.01, e.gain); } catch (err) {} }
        const wait = (e.every[0] + Math.random() * (e.every[1] - e.every[0])) * 1000;
        ambTimer = setTimeout(tick, wait);
      };
      ambTimer = setTimeout(tick, 2500 + Math.random() * 4000);
    }
  }

  /* How loud the room is, 0..1. The bed lifts and opens up when the
     level notices you, and settles again when it stops. It is the
     cheapest possible score: no second track, no crossfade, just the
     bed that is already running being leaned on.

     Ramped rather than set, because a bed that jumps is a bug you can
     hear. */
  let ambTension = 0;
  function tension(x) {
    ambTension = clampN(x || 0, 0, 1);
    if (!ready || !ambGain || !ambBed) return;
    const t = ctx.currentTime;
    try {
      ambGain.gain.cancelScheduledValues(t);
      ambGain.gain.setValueAtTime(ambGain.gain.value, t);
      ambGain.gain.linearRampToValueAtTime(
        ambBed.gain * (1 + ambTension * 1.35), t + 0.9);
    } catch (e) { /* audio is never fatal */ }
  }

  return {
    init, play, ambience, bedFor, tension, resume,
    get tensionAt() { return ambTension; },
    KIND_BED, KIND_KEYS, MOOD_DROP, BED_EVENTS,
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = v;
      if (master) master.gain.value = v ? 0.5 : 0;
    },
    get ready() { return ready; }
  };
})();
