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

  /* A weapon instance carries live ammo state; the table above is
     shared and must stay immutable. */
  function make(kind) {
    const def = W[kind] || W.rifle;
    return { kind, def, ammo: def.mag, reloading: 0, cool: 0 };
  }

  return { table: W, ORDER, make };
})();
