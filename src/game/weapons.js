/* ============================================================
   weapons.js — one definition per weapon, driving both the sprite
   and the behaviour.

   The tool's gunSpec() table decides what a weapon LOOKS like; the
   handoff (§8.4) asks for the behaviour to come from the same
   definition so the two can't drift. These keys extend that table.
   ============================================================ */
window.WEAPONS = (function () {
  "use strict";

  const W = {
    pistol: {
      label: 'SIDEARM', rate: 0.22, speed: 6.4, dmg: 2, spread: 0.025,
      mag: 12, reload: 0.9, kick: 0.7, shake: 0.7, size: 2, life: 1.1,
      pierce: 0, tone: { f: 620, drop: 0.55, len: 0.09, noise: 0.5, type: 'square' }
    },
    smg: {
      label: 'STUTTER SMG', rate: 0.075, speed: 6.4, dmg: 1, spread: 0.075,
      mag: 40, reload: 1.25, kick: 0.45, shake: 0.45, size: 2, life: 0.95,
      pierce: 0, tone: { f: 480, drop: 0.6, len: 0.06, noise: 0.7, type: 'square' }
    },
    rifle: {
      label: 'MARKSMAN', rate: 0.11, speed: 8.0, dmg: 3, spread: 0.018,
      mag: 24, reload: 1.15, kick: 0.85, shake: 0.9, size: 2, life: 1.3,
      pierce: 0, tone: { f: 760, drop: 0.5, len: 0.11, noise: 0.55, type: 'sawtooth' }
    },
    cannon: {
      label: 'BREACH CANNON', rate: 0.42, speed: 4.2, dmg: 9, spread: 0.035,
      mag: 6, reload: 1.6, kick: 2.0, shake: 2.4, size: 4, life: 1.5,
      pierce: 1, splash: 22, tone: { f: 170, drop: 0.35, len: 0.26, noise: 1.0, type: 'sawtooth' }
    },
    beam: {
      label: 'ARC LANCE', rate: 0.06, speed: 11.0, dmg: 1, spread: 0.008,
      mag: 60, reload: 1.4, kick: 0.3, shake: 0.3, size: 2, life: 0.7,
      pierce: 2, tone: { f: 1180, drop: 0.75, len: 0.05, noise: 0.25, type: 'sine' }
    },

    /* --- the second ten ---------------------------------------
       Each one owns a role the first five do not, and each is built
       around a different exotic, so the effects the prototype can roll
       are all things you have already met on a stock gun. */
    scatter: {
      label: 'SHORT SCATTER', rate: 0.55, speed: 5.6, dmg: 2.2, spread: 0.20,
      count: 6, mag: 8, reload: 1.5, kick: 2.2, shake: 1.9, size: 2, life: 0.5,
      pierce: 0, tone: { f: 240, drop: 0.4, len: 0.18, noise: 1.0, type: 'sawtooth' }
    },
    flak: {
      label: 'FLAK REPEATER', rate: 0.30, speed: 5.4, dmg: 4, spread: 0.045,
      mag: 10, reload: 1.5, kick: 1.3, shake: 1.6, size: 3, life: 1.4,
      pierce: 0, splash: 14, drop: 0.04,
      tone: { f: 300, drop: 0.4, len: 0.2, noise: 0.9, type: 'sawtooth' }
    },
    rail: {
      label: 'RAIL SPIKE', rate: 0.85, speed: 16.0, dmg: 14, spread: 0.004,
      mag: 4, reload: 2.0, kick: 2.4, shake: 2.6, size: 2, life: 2.0,
      pierce: 3, tone: { f: 1450, drop: 0.3, len: 0.26, noise: 0.35, type: 'sine' }
    },
    nail: {
      label: 'NAIL DRIVER', rate: 0.09, speed: 7.6, dmg: 1.5, spread: 0.055,
      mag: 36, reload: 1.2, kick: 0.5, shake: 0.5, size: 2, life: 1.1,
      pierce: 0, bounce: 2, tone: { f: 900, drop: 0.7, len: 0.05, noise: 0.8, type: 'square' }
    },
    pulse: {
      label: 'PULSE EMITTER', rate: 0.28, speed: 3.6, dmg: 4, spread: 0.02,
      mag: 14, reload: 1.4, kick: 0.8, shake: 0.9, size: 3, life: 2.0,
      pierce: 0, homing: 0.06,
      tone: { f: 520, drop: 0.85, len: 0.16, noise: 0.2, type: 'sine' }
    },
    torch: {
      label: 'VENT TORCH', rate: 0.035, speed: 3.4, dmg: 0.6, spread: 0.13,
      mag: 90, reload: 1.8, kick: 0.25, shake: 0.35, size: 3, life: 0.28,
      pierce: 1, burn: 2.4,
      tone: { f: 190, drop: 0.9, len: 0.05, noise: 1.0, type: 'sawtooth' }
    },
    mortar: {
      label: 'TRENCH MORTAR', rate: 0.95, speed: 5.0, dmg: 10, spread: 0.03,
      mag: 3, reload: 2.1, kick: 2.4, shake: 2.8, size: 4, life: 2.2,
      pierce: 0, splash: 30, drop: 0.13, quake: 1,
      tone: { f: 130, drop: 0.3, len: 0.3, noise: 1.0, type: 'sawtooth' }
    },
    coil: {
      label: 'COIL DRIVER', rate: 0.34, speed: 12.0, dmg: 6, spread: 0.012,
      mag: 12, reload: 1.35, kick: 1.2, shake: 1.1, size: 2, life: 1.5,
      pierce: 1, chain: 1,
      tone: { f: 1050, drop: 0.5, len: 0.14, noise: 0.3, type: 'sine' }
    },
    swarm: {
      label: 'SWARM HIVE', rate: 0.20, speed: 5.0, dmg: 1.2, spread: 0.09,
      count: 3, mag: 27, reload: 1.5, kick: 0.6, shake: 0.6, size: 2, life: 1.6,
      pierce: 0, homing: 0.09, bounce: 1,
      tone: { f: 700, drop: 0.65, len: 0.08, noise: 0.6, type: 'square' }
    },
    reaper: {
      label: 'REAPER SHARD', rate: 0.50, speed: 7.0, dmg: 7, spread: 0.02,
      mag: 8, reload: 1.7, kick: 1.5, shake: 1.4, size: 3, life: 1.5,
      pierce: 2, vamp: 0.18,
      tone: { f: 400, drop: 0.45, len: 0.22, noise: 0.55, type: 'sawtooth' }
    }
  };

  const ORDER = ['pistol', 'smg', 'rifle', 'cannon', 'beam',
                 'scatter', 'flak', 'rail', 'nail', 'pulse',
                 'torch', 'mortar', 'coil', 'swarm', 'reaper'];

  /* ============================================================
     PROTOTYPE — one rolled weapon per run.

     Twenty parameters, rolled from the run seed, so the thing you find
     before the boss is a different gun every time. They are not
     independent knobs: a build that rolled high on everything would
     trivialise the fight, so the roll spends a fixed budget — take
     more of one thing and the rest gives way. That is what makes a
     prototype interesting rather than simply better.

     The twenty split into five CORE handling axes that every gun has
     some of, and fifteen EXOTIC effects that most guns have none of.
     Spreading one budget over all twenty would give every prototype a
     thin smear of everything and no character, so the roll picks two
     to four exotics and spends a separate budget only on those. A
     prototype should be describable in one sentence.
     ============================================================ */
  const PROTO_PREFIX = ['VITRIOL', 'SCOURGE', 'HALLOW', 'GRIEVE', 'RAPTURE', 'SUNDER',
                        'CINDER', 'PALLOR', 'THRESH', 'VESPER', 'GALLOWS', 'MERIDIAN',
                        'OSSUARY', 'TENEBRE', 'CARRION', 'SABLE'];
  const PROTO_SUFFIX = ['PATTERN', 'ARRAY', 'LANCE', 'ENGINE', 'CHORUS', 'HYMN',
                        'CASCADE', 'VERDICT', 'AUGUR', 'REPEATER', 'CENSER', 'HALO',
                        'SPINE', 'LATTICE', 'MAW', 'DIRGE'];
  const PROTO_MARK = ['I', 'II', 'III', 'IV', 'V', 'VII', 'IX', 'XI', 'XIII', 'XVII'];

  /* The rolled parameters, in the order the HUD lists them. */
  const PROTO_CORE = ['rate', 'dmg', 'speed', 'count', 'spread'];
  const PROTO_EXOTIC = ['pierce', 'splash', 'homing', 'bounce', 'drop',
                        'burn', 'chain', 'fork', 'slow', 'vamp',
                        'charge', 'shield', 'quake', 'spiral', 'echo'];
  const PROTO_PARAMS = PROTO_CORE.concat(PROTO_EXOTIC);

  /* What each exotic is called on the pedestal and in the debrief, and
     how a rolled share maps onto its live value. Keeping the ranges
     here rather than inline in the roll is what lets the panel, the
     readout and the roll all agree about what "seeking 0.09" means. */
  const EXOTIC_SPEC = {
    pierce: { tag: 'PIERCE', max: 3,
              val: S => clamp(Math.round(0.4 + S * 1.3), 1, 3) },
    splash: { tag: 'BLAST',  max: 34,
              val: S => clamp(Math.round(9 + S * 12), 8, 34) },
    homing: { tag: 'SEEK',   max: 0.14,
              val: S => +clamp(0.03 + S * 0.07, 0.02, 0.14).toFixed(4) },
    bounce: { tag: 'RIC',    max: 4,
              val: S => clamp(Math.round(0.5 + S * 1.6), 1, 4) },
    drop:   { tag: 'ARC',    max: 0.16,
              val: S => +clamp(0.03 + S * 0.08, 0.02, 0.16).toFixed(4) },
    /* --- the second ten --- */
    burn:   { tag: 'BURN',   max: 6,
              val: S => +clamp(1.2 + S * 2.4, 1, 6).toFixed(2) },
    chain:  { tag: 'CHAIN',  max: 3,
              val: S => clamp(Math.round(0.5 + S * 1.3), 1, 3) },
    fork:   { tag: 'FORK',   max: 4,
              val: S => clamp(Math.round(1.4 + S * 1.4), 2, 4) },
    slow:   { tag: 'MIRE',   max: 0.7,
              val: S => +clamp(0.22 + S * 0.3, 0.15, 0.7).toFixed(3) },
    vamp:   { tag: 'LEECH',  max: 0.35,
              val: S => +clamp(0.06 + S * 0.14, 0.04, 0.35).toFixed(3) },
    charge: { tag: 'CHARGE', max: 4,
              val: S => +clamp(1.5 + S * 1.4, 1.3, 4).toFixed(2) },
    shield: { tag: 'WARD',   max: 30,
              val: S => clamp(Math.round(5 + S * 9), 4, 30) },
    quake:  { tag: 'QUAKE',  max: 3,
              val: S => +clamp(0.7 + S * 1.0, 0.5, 3).toFixed(2) },
    spiral: { tag: 'SPIRAL', max: 3,
              val: S => +clamp(0.6 + S * 1.1, 0.4, 3).toFixed(2) },
    echo:   { tag: 'ECHO',   max: 0.5,
              val: S => +clamp(0.10 + S * 0.14, 0.07, 0.5).toFixed(3) }
  };

  /* Draw a normalised weight vector: skewed, so a build has a shape
     rather than a flat smear. The returned lookup averages 1. */
  function budget(R, keys) {
    const w = [];
    let tot = 0;
    for (let i = 0; i < keys.length; i++) {
      const v = Math.pow(R.rnd(), 1.8) + 0.06;
      w.push(v); tot += v;
    }
    for (let i = 0; i < w.length; i++) w[i] /= tot;
    return k => {
      const i = keys.indexOf(k);
      return i < 0 ? 0 : w[i] * keys.length;
    };
  }

  function rollProto(rng) {
    const R = rng;
    const S = budget(R, PROTO_CORE);

    /* Two to four exotics, chosen before anything is spent on them.
       Choosing first and spending second is what keeps a prototype
       legible: three effects turned up loud beat fifteen turned down. */
    const pool = PROTO_EXOTIC.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = R.int(0, i);
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const nEx = R.int(2, 4);
    const picked = pool.slice(0, nEx);
    const X = budget(R, picked);

    const count = clamp(Math.round(0.35 + S('count') * 1.75), 1, 6);
    const rate = clamp(0.30 / (0.45 + S('rate') * 1.5), 0.045, 0.55);
    const dmg = clamp(2 + S('dmg') * 5.5, 1, 16) / (count > 1 ? Math.sqrt(count) : 1);
    const def = {
      label: null,                     // filled below
      proto: true,
      rate,
      dmg: +dmg.toFixed(2),
      speed: clamp(4.2 + S('speed') * 4.6, 3.2, 13),
      count,
      spread: clamp(0.006 + S('spread') * 0.075, 0.004, 0.28),
      mag: 0, reload: 0, kick: 0, shake: 0, size: 3, life: 1.6,
      tone: null
    };
    /* Every exotic is off unless it was picked, and every value goes
       through EXOTIC_SPEC — which clamps. The budget can put almost all
       its weight on one axis, and an unclamped pierce of 22 is not a
       weapon, it is a bug. */
    for (const k of PROTO_EXOTIC) def[k] = 0;
    for (const k of picked) def[k] = EXOTIC_SPEC[k].val(X(k));
    def.exotics = picked.slice();
    // magazine and handling fall out of the rest of the build
    def.mag = Math.max(8, Math.round(clamp(3.6 / def.rate, 10, 140) / Math.sqrt(count)));
    def.reload = clamp(0.85 + def.dmg * 0.09 + count * 0.06, 0.8, 2.2);
    def.kick = clamp(0.3 + def.dmg * 0.10 + count * 0.06, 0.3, 2.4);
    def.shake = clamp(0.35 + def.dmg * 0.11 + (def.splash ? 1.1 : 0), 0.3, 2.8);
    def.size = def.splash ? 4 : (def.dmg > 6 ? 3 : 2);
    def.life = clamp(0.8 + def.speed * 0.12, 0.7, 2.0);
    def.tone = {
      f: Math.round(200 + S('speed') * 420),
      drop: 0.42 + S('rate') * 0.16,
      len: clamp(def.rate * 0.9, 0.05, 0.3),
      noise: clamp(0.3 + def.dmg * 0.07, 0.25, 1),
      type: def.splash ? 'sawtooth' : def.count > 2 ? 'square' : 'sine'
    };
    def.base = shapeFor(def);
    def.label = PROTO_PREFIX[R.int(0, PROTO_PREFIX.length - 1)] + ' ' +
                PROTO_SUFFIX[R.int(0, PROTO_SUFFIX.length - 1)] + ' ' +
                PROTO_MARK[R.int(0, PROTO_MARK.length - 1)];
    def.tint = R.pick(['#ff5a3d', '#8cff5a', '#3ee0ff', '#c060ff', '#ffd06b', '#ff3d7a']);
    /* A short readout of what actually got rolled, for the debrief.
       Core axes report their share; an exotic reports how far up its
       own range it landed, which is the number that means something. */
    def.rolled = PROTO_PARAMS.map(k => ({
      k,
      v: PROTO_CORE.indexOf(k) >= 0 ? +S(k).toFixed(2)
                                    : +(def[k] / EXOTIC_SPEC[k].max).toFixed(2),
      on: PROTO_CORE.indexOf(k) >= 0 || def[k] > 0
    }));
    return def;
  }

  /* Which base weapon it looks like in the merc's hands. The sprite has
     to come from somewhere, and the shape should not lie about what the
     gun does — so the loudest thing about the build picks it. */
  function shapeFor(def) {
    if (def.splash >= 26) return 'mortar';
    if (def.splash) return def.drop ? 'flak' : 'cannon';
    if (def.burn) return 'torch';
    if (def.chain) return 'coil';
    if (def.vamp) return 'reaper';
    if (def.count >= 5) return 'scatter';
    if (def.homing && def.count > 1) return 'swarm';
    if (def.homing) return 'pulse';
    if (def.bounce) return 'nail';
    if (def.pierce >= 3 || (def.speed > 11 && def.dmg > 8)) return 'rail';
    if (def.count > 2) return 'smg';
    if (def.speed > 9) return 'beam';
    if (def.dmg > 6) return 'cannon';
    return 'rifle';
  }

  /* The exotics a definition actually has turned on, as HUD tags. */
  function tagsFor(def) {
    const out = [];
    for (const k of PROTO_EXOTIC) {
      if (!def[k]) continue;
      const sp = EXOTIC_SPEC[k];
      const n = sp.max <= 1 ? '' : (k === 'homing' || k === 'drop' || k === 'slow' ||
                                    k === 'vamp' || k === 'echo' ? '' : def[k]);
      out.push(sp.tag + (n === '' ? '' : n));
    }
    return out;
  }

  /* Control schema for the build screen's weapon forge. It lives here
     with the weapon rather than in the UI so the panel and the thing
     it edits cannot drift, the same way the generator panels are built
     from their tool's own table. */
  const PROTO_CONTROLS = [
    { g: 'OUTPUT', c: [
      { k: 'rate',   l: 'fire rate',  t: 'r', min: 0.045, max: 0.55, step: 0.005,
        fmt: v => (1 / v).toFixed(1) + '/s' },
      { k: 'dmg',    l: 'damage',     t: 'r', min: 1, max: 16, step: 0.25 },
      { k: 'count',  l: 'projectiles',t: 'r', min: 1, max: 6, step: 1 },
      { k: 'mag',    l: 'magazine',   t: 'r', min: 4, max: 140, step: 1 },
      { k: 'reload', l: 'reload',     t: 'r', min: 0.5, max: 2.6, step: 0.05,
        fmt: v => (+v).toFixed(2) + 's' }
    ]},
    { g: 'PROJECTILE', c: [
      { k: 'speed',  l: 'speed',      t: 'r', min: 3, max: 14, step: 0.1 },
      { k: 'spread', l: 'spread',     t: 'r', min: 0, max: 0.3, step: 0.004 },
      { k: 'life',   l: 'range',      t: 'r', min: 0.5, max: 2.2, step: 0.05 },
      { k: 'size',   l: 'calibre',    t: 'r', min: 1, max: 5, step: 1 }
    ]},
    { g: 'EXOTIC', c: [
      { k: 'pierce', l: 'pierce',     t: 'r', min: 0, max: 3, step: 1 },
      { k: 'splash', l: 'blast',      t: 'r', min: 0, max: 34, step: 1 },
      { k: 'homing', l: 'seeking',    t: 'r', min: 0, max: 0.14, step: 0.005 },
      { k: 'bounce', l: 'ricochet',   t: 'r', min: 0, max: 4, step: 1 },
      { k: 'drop',   l: 'arc',        t: 'r', min: 0, max: 0.16, step: 0.005 }
    ]},
    { g: 'EXOTIC II', c: [
      { k: 'burn',   l: 'incendiary', t: 'r', min: 0, max: 6, step: 0.2 },
      { k: 'chain',  l: 'chain arc',  t: 'r', min: 0, max: 3, step: 1 },
      { k: 'fork',   l: 'fork',       t: 'r', min: 0, max: 4, step: 1 },
      { k: 'slow',   l: 'mire',       t: 'r', min: 0, max: 0.7, step: 0.05 },
      { k: 'vamp',   l: 'leech',      t: 'r', min: 0, max: 0.35, step: 0.01 }
    ]},
    { g: 'EXOTIC III', c: [
      { k: 'charge', l: 'charge×',    t: 'r', min: 1, max: 4, step: 0.1 },
      { k: 'shield', l: 'ward',       t: 'r', min: 0, max: 30, step: 1 },
      { k: 'quake',  l: 'quake',      t: 'r', min: 0, max: 3, step: 0.1 },
      { k: 'spiral', l: 'spiral',     t: 'r', min: 0, max: 3, step: 0.1 },
      { k: 'echo',   l: 'echo',       t: 'r', min: 0, max: 0.5, step: 0.02,
        fmt: v => +v ? (+v).toFixed(2) + 's' : 'off' }
    ]},
    { g: 'IDENTITY', c: [
      { k: 'base',   l: 'held shape', t: 's', opt: () => ORDER },
      { k: 'tint',   l: 'tint',       t: 'color' },
      { k: 'kick',   l: 'recoil',     t: 'r', min: 0, max: 2.5, step: 0.05 },
      { k: 'shake',  l: 'screen kick',t: 'r', min: 0, max: 3, step: 0.05 }
    ]}
  ];

  /* Rebuild the derived bits after a hand edit — the sound follows the
     gun, so a weapon tuned in the panel still sounds like what it is. */
  function retune(def) {
    def.tone = {
      f: Math.round(clamp(180 + def.speed * 46, 120, 1400)),
      drop: clamp(0.38 + (1 / Math.max(0.05, def.rate)) * 0.012, 0.3, 0.8),
      len: clamp(def.rate * 0.9, 0.05, 0.3),
      noise: clamp(0.3 + def.dmg * 0.07, 0.25, 1),
      type: def.splash ? 'sawtooth' : def.count > 2 ? 'square' : 'sine'
    };
    // the held shape follows the edit too, or the panel lies about the gun
    if (def.proto) def.base = shapeFor(def);
    return def;
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* A weapon instance carries live ammo state; the table above is
     shared and must stay immutable. */
  function make(kind, protoDef) {
    const def = protoDef || W[kind] || W.rifle;
    return { kind, def, ammo: def.mag, reloading: 0, cool: 0, charge: 0 };
  }

  return { table: W, ORDER, make, rollProto, retune, PROTO_CONTROLS,
           PROTO_PARAMS, PROTO_CORE, PROTO_EXOTIC, EXOTIC_SPEC,
           shapeFor, tagsFor,
           PROTO_PREFIX, PROTO_SUFFIX, PROTO_MARK };
})();
