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
    }
  };

  const ORDER = ['pistol', 'smg', 'rifle', 'cannon', 'beam'];

  /* ============================================================
     PROTOTYPE — one rolled weapon per run.

     Ten parameters, rolled from the run seed, so the thing you find
     before the boss is a different gun every time. They are not
     independent knobs: a build that rolled high on everything would
     trivialise the fight, so the roll spends a fixed budget — take
     more of one thing and the rest gives way. That is what makes a
     prototype interesting rather than simply better.
     ============================================================ */
  const PROTO_PREFIX = ['VITRIOL', 'SCOURGE', 'HALLOW', 'GRIEVE', 'RAPTURE', 'SUNDER',
                        'CINDER', 'PALLOR', 'THRESH', 'VESPER', 'GALLOWS', 'MERIDIAN',
                        'OSSUARY', 'TENEBRE', 'CARRION', 'SABLE'];
  const PROTO_SUFFIX = ['PATTERN', 'ARRAY', 'LANCE', 'ENGINE', 'CHORUS', 'HYMN',
                        'CASCADE', 'VERDICT', 'AUGUR', 'REPEATER', 'CENSER', 'HALO',
                        'SPINE', 'LATTICE', 'MAW', 'DIRGE'];
  const PROTO_MARK = ['I', 'II', 'III', 'IV', 'V', 'VII', 'IX', 'XI', 'XIII', 'XVII'];

  /* The ten rolled parameters, in the order the HUD lists them. */
  const PROTO_PARAMS = ['rate', 'dmg', 'speed', 'count', 'spread',
                        'pierce', 'splash', 'homing', 'bounce', 'drop'];

  function rollProto(rng) {
    const R = rng;
    /* Spend a budget across the ten axes. Dirichlet-ish: draw weights,
       normalise, then map each share onto its own range. */
    const w = [];
    let tot = 0;
    for (let i = 0; i < PROTO_PARAMS.length; i++) {
      const v = Math.pow(R.rnd(), 1.8) + 0.06;   // skewed, so builds have a shape
      w.push(v); tot += v;
    }
    for (let i = 0; i < w.length; i++) w[i] /= tot;
    const S = k => w[PROTO_PARAMS.indexOf(k)] * PROTO_PARAMS.length;   // ~1 on average

    const count = clamp(Math.round(0.35 + S('count') * 1.75), 1, 6);
    const rate = clamp(0.30 / (0.45 + S('rate') * 1.5), 0.045, 0.55);
    const dmg = clamp(2 + S('dmg') * 5.5, 1, 16) / (count > 1 ? Math.sqrt(count) : 1);
    const def = {
      label: null,                     // filled by name()
      proto: true,
      rate,
      dmg: +dmg.toFixed(2),
      speed: clamp(4.2 + S('speed') * 4.6, 3.2, 13),
      count,
      spread: clamp(0.006 + S('spread') * 0.075, 0.004, 0.28),
      /* Every derived stat is clamped, not just scaled. The budget can
         put almost all its weight on one axis, and an unclamped
         pierce of 22 is not a weapon, it is a bug. */
      pierce: clamp(Math.round(S('pierce') * 1.1), 0, 3),
      splash: S('splash') > 1.25 ? clamp(Math.round(10 + S('splash') * 5), 0, 34) : 0,
      homing: +clamp((S('homing') - 0.7) * 0.075, 0, 0.14).toFixed(4),
      bounce: S('bounce') > 1.4 ? clamp(Math.round(S('bounce')), 0, 4) : 0,
      drop: +clamp((S('drop') - 0.9) * 0.09, 0, 0.16).toFixed(4),
      mag: 0, reload: 0, kick: 0, shake: 0, size: 3, life: 1.6,
      tone: null
    };
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
    /* Which of the five base weapons it looks like in the merc's hands.
       The sprite has to come from somewhere, and the shape should not
       lie about what the gun does. */
    def.base = def.splash ? 'cannon'
             : def.count > 2 ? 'smg'
             : def.speed > 9 ? 'beam'
             : def.dmg > 6 ? 'cannon' : 'rifle';
    def.label = PROTO_PREFIX[R.int(0, PROTO_PREFIX.length - 1)] + ' ' +
                PROTO_SUFFIX[R.int(0, PROTO_SUFFIX.length - 1)] + ' ' +
                PROTO_MARK[R.int(0, PROTO_MARK.length - 1)];
    def.tint = R.pick(['#ff5a3d', '#8cff5a', '#3ee0ff', '#c060ff', '#ffd06b', '#ff3d7a']);
    /* A short readout of what actually got rolled, for the debrief. */
    def.rolled = PROTO_PARAMS.map(k => ({ k, v: +S(k).toFixed(2) }));
    return def;
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* A weapon instance carries live ammo state; the table above is
     shared and must stay immutable. */
  function make(kind, protoDef) {
    const def = protoDef || W[kind] || W.rifle;
    return { kind, def, ammo: def.mag, reloading: 0, cool: 0 };
  }

  return { table: W, ORDER, make, rollProto, PROTO_PARAMS, PROTO_PREFIX, PROTO_SUFFIX };
})();
