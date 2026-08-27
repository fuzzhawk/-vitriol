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

  /* Low industrial bed — two detuned saws through a lowpass, plus a
     slow LFO. Cheap, and it makes the levels feel like a place. */
  function ambience(on, mood) {
    if (!ready) return;
    if (!on) {
      ambNodes.forEach(n => { try { n.stop(); } catch (e) {} });
      ambNodes = [];
      if (ambGain) { try { ambGain.disconnect(); } catch (e) {} ambGain = null; }
      return;
    }
    if (ambGain) return;
    resume();
    ambGain = ctx.createGain();
    ambGain.gain.value = 0.0;
    ambGain.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 3;
    lp.connect(ambGain); ambGain.connect(master);
    const base = mood === 'voidnight' || mood === 'eclipse' ? 42 : 55;
    [base, base * 1.005, base * 1.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.25 : 0.5;
      o.connect(g); g.connect(lp);
      o.start(); ambNodes.push(o);
    });
    // Slow filter sweep so the bed breathes instead of droning flat.
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.055; lfoG.gain.value = 70;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    lfo.start(); ambNodes.push(lfo);
  }

  return {
    init, play, ambience, resume,
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = v;
      if (master) master.gain.value = v ? 0.5 : 0;
    },
    get ready() { return ready; }
  };
})();
