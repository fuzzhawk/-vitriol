/* ============================================================
   campaign.js — a run made of many levels instead of one.

   A campaign is a seed and a sector number. Everything else is
   derived: the level, the garrison, the boss, the gun on the pedestal
   and how hard all of it is. That means a campaign is reproducible
   from two numbers, and sector 7 of seed X is always the same sector 7.

   What carries between sectors and what does not is the whole design.
   YOU carry: the operative sprite, the weapon in your hands, the spare
   ammo, the power-ups the wardens gave you, your score. THE WORLD does
   not: every sector rerolls its architecture, its garrison, its debris
   and its boss. You are the continuity; the place is not.
   ============================================================ */
window.CAMPAIGN = (function () {
  "use strict";

  const C = window.CONFIG;
  const GW = window.GREEBLEWORKS;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  const SECTORS = 8;              // a campaign is this many sectors long

  /* The curve. Sector 1 is the difficulty you chose; by the last one
     the same choice is meaningfully harder without ever becoming a
     different game. Each term is separately clamped so no single one
     can run away when SECTORS is turned up. */
  function scaleFor(n, total) {
    const T = Math.max(2, total || SECTORS);
    const t = (n - 1) / (T - 1);                      // 0 at the first, 1 at the last
    return {
      dens: clamp(0.85 + t * 0.95, 0.85, 1.9),        // more of them
      hp: clamp(1 + t * 0.85, 1, 1.9),                // and they take more killing
      dmg: clamp(1 + t * 0.55, 1, 1.6),               // and hit harder
      fire: clamp(1 + t * 0.45, 1, 1.5),              // and faster
      corrupt: clamp(0.10 + t * 0.55, 0.10, 0.70),    // and more of them are wrong
      len: Math.round(clamp(3 + t * 3.2, 3, 7)),      // over more ground
      allies: t > 0.15 ? 2 : 1,                       // with help placed for it
      /* Two on the first floor so you meet the idea early, then one or
         two, so a long campaign is not a shopping trip. */
      wardens: n === 1 ? 2 : (1 + (n % 2 === 0 ? 1 : 0))
    };
  }

  /* Sector names, so a campaign reads as a descent rather than a
     counter. Built from the architecture the sector rolled, which is
     why they are generated here and not written out. */
  const DEPTH = ['SURFACE', 'UPPER', 'MIDLEVEL', 'SUBLEVEL', 'DEEP',
                 'UNDERCROFT', 'ABYSSAL', 'BASEMENT'];

  function Campaign(seed, opts) {
    this.seed = seed >>> 0;
    this.sector = 1;
    this.total = SECTORS;
    this.opts = Object.assign({}, opts);
    this.baseDiff = this.opts.difficulty || 'regular';
    /* Carried between sectors. Written by the mission when a sector
       ends and read back when the next one is built. */
    this.carry = null;
    this.score = 0;
    this.kills = 0;
    this.time = 0;
    this.deaths = 0;
    this.log = [];                // one line per sector cleared
    this.done = false;
    this.won = false;
  }

  /* The seed for a given sector. Derived rather than sequential so two
     campaigns whose seeds differ by one do not share their later
     sectors. */
  Campaign.prototype.seedFor = function (n) {
    return ((this.seed ^ (n * 0x9e3779b1)) * 0x85ebca6b + n * 0x165667b1) >>> 0;
  };

  Campaign.prototype.name = function (n, cfg) {
    /* Past the named depths a campaign just keeps going down, and
       "BASEMENT" four times running reads as a bug. Number them. */
    const d = n <= DEPTH.length ? DEPTH[n - 1]
                                : DEPTH[DEPTH.length - 1] + ' ' + (n - DEPTH.length + 1);
    return 'SECTOR ' + String(n).padStart(2, '0') + ' · ' + d +
           (cfg ? ' ' + cfg.style.toUpperCase() : '');
  };

  /* Everything the loader needs to bake the current sector. The player
     merc is NOT rolled here: it is passed in, because the operative is
     the one thing a campaign does not reroll. */
  Campaign.prototype.build = function () {
    const n = this.sector;
    const sd = this.seedFor(n);
    const sc = scaleFor(n, this.total);
    const cfg = C.randomLevelCfg(sd);
    cfg.levelLen = sc.len;
    const opts = Object.assign({}, this.opts, {
      difficulty: this.baseDiff,
      enemyDens: (this.opts.enemyDens || 1) * sc.dens,
      allies: Math.min(this.opts.allies === 0 ? 0 : sc.allies, 6),
      campaign: this,
      sector: n,
      sectorScale: sc,
      wardens: sc.wardens,
      carry: this.carry
    });
    return {
      seed: sd, cfg, opts, scale: sc,
      title: this.name(n, cfg),
      crawler: C.crawlerParams(sd, cfg, 0),
      scrap: C.scrapParamsFor(sd, cfg),
      boss: C.overlordParams((sd ^ 0x0b055) >>> 0, cfg),
      proto: window.WEAPONS.rollProto(GW.makeRng((sd ^ 0x9ea9) >>> 0))
    };
  };

  /* Snapshot what the player takes with them. Called when a sector is
     cleared; the object is handed straight back to the next mission. */
  Campaign.prototype.take = function (M) {
    const P = M.player;
    const W = P.weapon;
    this.carry = {
      weapon: W.kind,
      proto: W.kind === 'proto' ? W.def : null,
      protoRig: W.kind === 'proto' ? M.protoRig : null,
      ammo: W.ammo,
      spare: Object.assign({}, P.spare),
      buffs: Object.assign({}, P.buffs),
      wardMax: P.wardMax,
      maxHp: P.maxHp,
      /* Health carries, but a sector never starts you on the floor:
         clearing one is worth a breath. */
      hp: Math.max(P.maxHp * 0.4, Math.min(P.maxHp, P.hp + P.maxHp * 0.25))
    };
    this.score += P.score;
    this.kills += M.kills;
    this.time += M.time || 0;
    this.log.push({
      n: this.sector,
      style: M.cfg.style,
      kills: M.kills + '/' + M.totalEnemies,
      score: P.score
    });
    return this.carry;
  };

  /* Put a carried loadout back onto a freshly built player. */
  Campaign.prototype.give = function (P, M) {
    const c = this.carry;
    if (!c) return;
    P.maxHp = c.maxHp || P.maxHp;
    P.hp = clamp(c.hp === undefined ? P.maxHp : c.hp, 1, P.maxHp);
    P.buffs = Object.assign(P.buffs, c.buffs || {});
    P.wardMax = c.wardMax || 0;
    P.ward = P.wardMax;
    for (const k in c.spare) if (k in P.spare) P.spare[k] = c.spare[k];
    if (c.weapon === 'proto' && c.proto) {
      P.weapon = window.WEAPONS.make('proto', c.proto);
      P.spare.proto = Infinity;
      if (c.protoRig) { P.rig = c.protoRig; M.protoRig = c.protoRig; }
      M.proto = c.proto;
    } else if (c.weapon && window.WEAPONS.table[c.weapon]) {
      P.weapon = window.WEAPONS.make(c.weapon);
    }
    // the magazine you walked out with, not a free reload
    if (c.ammo !== undefined) P.weapon.ammo = clamp(c.ammo, 0, P.weapon.def.mag);
  };

  Campaign.prototype.advance = function () {
    this.sector++;
    if (this.sector > this.total) { this.done = true; this.won = true; }
    return !this.done;
  };

  Campaign.prototype.stats = function () {
    return {
      seed: this.seed, sector: Math.min(this.sector, this.total), total: this.total,
      score: this.score, kills: this.kills, time: this.time,
      deaths: this.deaths, won: this.won, log: this.log.slice()
    };
  };

  return { Campaign, scaleFor, SECTORS, DEPTH };
})();
