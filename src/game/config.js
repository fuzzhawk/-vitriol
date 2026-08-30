/* ============================================================
   config.js — the two generator configs the game drives.

   GREEBLEWORKS takes one flat config object (see the handoff, §5).
   The tool builds it from sliders; the game builds it from either
   the randomizer below or the custom-build panel.

   MERC FORGE takes a params object; the player's chosen loadout is
   the sprite AND the gameplay weapon, so one config covers both.
   ============================================================ */
window.CONFIG = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;

  /* ---------------- level defaults ----------------
     Mirrors the tool's neutral slider positions. Sliders are 0-200
     in the DOM and divided by 100, so 1.0 is neutral here. */
  const LEVEL_DEFAULTS = {
    mode: 'level', outW: 448, outH: 252, SS: 2, tileX: true, tileY: false,
    seed: 1337,
    style: 'slum', palette: 'sodium', dither: 0.45,

    greeble: 0.65, pipes: 0.60, windows: 0.55, neon: 0.35,
    grime: 0.60, wear: 0.50, relief: 1.0, lightdir: 315,

    platKind: 'auto',

    decalKind: 'auto',
    decDens: 1.0, decOpen: 1.0, decMach: 1.0, decOrg: 0.8,
    decTexture: 1.0, decGrime: 1.0, decDither: 0.55, decBlend: 1.0,

    skyMood: 'ashfall', cloud: 0.70, glow: 0.85, horizon: 0.76, weatherAmt: 0.90,
    cloudScale: 1.0, cloudStretch: 1.10, cloudSharp: 0.45,
    cloudDetail: 1.0, cloudTurb: 0.40, cloudHeight: 0.70,

    cityLayers: 4, cityDens: 1.30, cityMass: 1.55, cityVar: 0.90,
    cityWidth: 1.20, cityOverlap: 1.50, cityHaze: 1.15, cityContrast: 0.75,
    cityDetail: 0.70, cityWin: 0.55, citySkyway: 0.70, cityRuin: 0.15,
    cityLights: 0.45, cityBlimps: 0.35,

    levelLen: 6, floatDens: 0.90, propDens: 0.95, propGrime: 1.0,
    weather: 'auto', fog: 1.0, speed: 26,
    wireDens: 1.0, wireStrands: 1.0, wireSag: 1.0, wireDrops: 1.0
  };

  /* Game-side settings that ride alongside the generator config. */
  const RUN_DEFAULTS = {
    difficulty: 'regular',    // recruit | regular | veteran | vitriol
    enemyDens: 1.0,           // multiplier on spawn count
    lives: 3,
    allies: 2,                // frozen operatives placed through the level
    autopilot: false          // let the pilot run the whole thing
  };

  const DIFFICULTY = {
    recruit: { label: 'RECRUIT',  dmgIn: 0.55, enemyHp: 0.75, fireRate: 0.70, lives: 5, aggro: 150 },
    regular: { label: 'REGULAR',  dmgIn: 1.00, enemyHp: 1.00, fireRate: 1.00, lives: 3, aggro: 185 },
    veteran: { label: 'VETERAN',  dmgIn: 1.60, enemyHp: 1.35, fireRate: 1.35, lives: 2, aggro: 230 },
    vitriol: { label: 'VITRIOL',  dmgIn: 2.40, enemyHp: 1.80, fireRate: 1.70, lives: 1, aggro: 300 }
  };

  /* ---------------- coherent randomizer ----------------
     A uniform roll over 14 styles x 21 palettes x 15 moods produces
     a lot of incoherent junk. These affinity tables keep a random
     level looking deliberate: the architecture picks the weather it
     lives under, and the skyline that fits behind it. */
  const STYLE_AFFINITY = {
    slum:       { moods: ['ashfall', 'smog', 'monsoon', 'acidmist'],       cities: ['shanty', 'hiveterrace', 'lowindustrial'], pals: ['sodium', 'rust', 'ashen', 'sewer'] },
    kowloon:    { moods: ['monsoon', 'smog', 'voidnight', 'acidmist'],       cities: ['hiveterrace', 'shanty', 'skywaylattice'],  pals: ['neonoir', 'sodium', 'toxic'] },
    market:     { moods: ['smog', 'ashfall', 'dustveil'],                  cities: ['shanty', 'hiveterrace', 'megaplex'],      pals: ['sodium', 'copper', 'amber'] },
    undercity:  { moods: ['voidnight', 'acidmist', 'eclipse', 'smog'],     cities: ['drowned', 'ghostgrid', 'corpwall'],       pals: ['sewer', 'toxic', 'mono3'] },
    industrial: { moods: ['ashfall', 'emberstorm', 'smog', 'dustveil'],    cities: ['lowindustrial', 'ashsil', 'scaffold'],    pals: ['rust', 'sodium', 'chrome', 'copper'] },
    refinery:   { moods: ['emberstorm', 'toxicdusk', 'ashfall'],           cities: ['lowindustrial', 'scaffold', 'ashsil'],    pals: ['rust', 'toxic', 'amber'] },
    reactor:    { moods: ['magnetar', 'toxicdusk', 'nuclearwinter'],       cities: ['corpwall', 'craterrim', 'ashsil'],        pals: ['toxic', 'chrome', 'crthot'] },
    ruin:       { moods: ['dustveil', 'nuclearwinter', 'eclipse', 'ashfall'], cities: ['ruinsprawl', 'craterrim', 'ghostgrid'], pals: ['ashen', 'bloodrust', 'mono1'] },
    brutalist:  { moods: ['coldrain', 'frostfall', 'eclipse', 'smog'],     cities: ['corpwall', 'ghostgrid', 'megaplex'],      pals: ['mono3', 'ashen', 'bunker', 'arctic'] },
    hab:        { moods: ['coldrain', 'smog', 'monsoon', 'ashfall'],       cities: ['hiveterrace', 'megaplex', 'corpwall'],    pals: ['sodium', 'ashen', 'sewer'] },
    megacorp:   { moods: ['magnetar', 'aurora', 'eclipse', 'coldrain'],     cities: ['megaplex', 'spireforest', 'corpwall'],    pals: ['neonoir', 'chrome', 'arctic'] },
    arcology:   { moods: ['aurora', 'toxicdusk', 'magnetar', 'voidnight'],   cities: ['arcologyc', 'spireforest', 'skywaylattice'], pals: ['chrome', 'arctic', 'neonoir'] },
    spaceport:  { moods: ['dustveil', 'frostfall', 'aurora', 'eclipse'],   cities: ['scaffold', 'spireforest', 'megaplex'],    pals: ['chrome', 'sandstorm', 'bunker'] },
    server:     { moods: ['voidnight', 'magnetar', 'aurora', 'eclipse'],   cities: ['ghostgrid', 'corpwall', 'skywaylattice'], pals: ['crtp4', 'crthot', 'mono5', 'toxic'] }
  };

  const STYLE_KEYS = Object.keys(STYLE_AFFINITY);

  /* Palettes that crush the image down to a handful of colours. Great
     to look at, punishing to fight in — the enemy silhouette stops
     separating from the wall. Kept out of the random pool. */
  const HARSH_PALETTES = ['cga4', 'gameboy', 'mono1', 'crtp4', 'vga'];

  function applyCityPreset(cfg, key) {
    const preset = GW.CITY_PRESETS[key];
    if (!preset) return cfg;
    // Preset values are in slider units (0-200); the config wants 0-2,
    // except cityLayers which is a literal count.
    for (const k in preset.v) {
      const camel = { citylayers: 'cityLayers', citydens: 'cityDens', citymass: 'cityMass',
        cityvar: 'cityVar', citywidth: 'cityWidth', cityoverlap: 'cityOverlap',
        cityhaze: 'cityHaze', citycontrast: 'cityContrast', citydetail: 'cityDetail',
        citywin: 'cityWin', cityskyway: 'citySkyway', cityruin: 'cityRuin',
        citylights: 'cityLights', cityblimps: 'cityBlimps' }[k];
      if (!camel) continue;
      cfg[camel] = camel === 'cityLayers' ? preset.v[k] : preset.v[k] / 100;
    }
    return cfg;
  }

  function randomLevelCfg(seed) {
    const R = GW.makeRng(seed >>> 0);
    const cfg = Object.assign({}, LEVEL_DEFAULTS, { seed: seed >>> 0 });

    const style = R.pick(STYLE_KEYS);
    const aff = STYLE_AFFINITY[style];
    cfg.style = style;
    cfg.skyMood = R.pick(aff.moods);
    cfg.palette = R.chance(0.18) ? 'none' : R.pick(aff.pals);
    applyCityPreset(cfg, R.pick(aff.cities));

    cfg.dither = R.range(0.25, 0.75);
    cfg.greeble = R.range(0.35, 1.05);
    cfg.pipes   = R.range(0.30, 1.05);
    cfg.windows = R.range(0.30, 0.95);
    cfg.neon    = R.range(0.10, 0.85);
    cfg.grime   = R.range(0.35, 0.95);
    cfg.wear    = R.range(0.25, 0.90);
    cfg.relief  = R.range(0.75, 1.30);
    cfg.lightdir = R.int(0, 359);

    cfg.cloud   = R.range(0.35, 1.15);
    cfg.glow    = R.range(0.55, 1.25);
    cfg.horizon = R.range(0.50, 1.05);
    cfg.weatherAmt = R.range(0.45, 1.35);
    cfg.cloudScale = R.range(0.65, 1.45);
    cfg.cloudStretch = R.range(0.80, 1.60);
    cfg.cloudSharp = R.range(0.20, 0.85);
    cfg.cloudTurb = R.range(0.15, 0.85);
    cfg.cloudHeight = R.range(0.45, 1.00);

    cfg.levelLen  = R.int(5, 9);
    cfg.floatDens = R.range(0.70, 1.35);
    cfg.propDens  = R.range(0.65, 1.30);
    cfg.fog       = R.range(0.55, 1.35);
    cfg.wireDens  = R.range(0.40, 1.50);
    cfg.wireSag   = R.range(0.60, 1.40);
    cfg.decDens   = R.range(0.60, 1.40);
    cfg.platKind  = R.chance(0.55) ? 'auto' : R.pick(['concrete', 'grating', 'catwalk', 'deck']);

    return cfg;
  }

  /* ---------------- merc archetypes ----------------
     The player is one merc; enemies are the same rig with different
     params. Each archetype is a seeded variation, so a run's hostiles
     look like they came off the same production line as each other
     but never exactly repeat. */
  const ARCHETYPES = {
    grunt: {
      label: 'GRUNT', hp: 3, speed: 0.42, aggro: 1.0, burst: 2, cooldown: 1.5, score: 100,
      build: R => ({
        height: 28 + R.int(0, 4), headSize: R.range(0.78, 0.92), limbThick: R.range(0.040, 0.052),
        taper: R.range(0.55, 0.82), armour: R.range(0.2, 0.7), grit: R.range(0.5, 0.9),
        legLen: R.range(0.47, 0.52), bootSize: R.range(0.35, 0.6), gloveSize: R.range(0.25, 0.5),
        helmet: R.pick(['visor', 'none', 'full']), backpack: R.pick(['none', 'tank']),
        gun: R.chance(0.5) ? 'pistol' : 'smg', gunSize: R.range(0.8, 1.0),
        twoHanded: R.chance(0.6), plates: R.chance(0.4), pads: R.range(0.1, 0.55),
        runFrames: 8, aimRows: 5
      })
    },
    trooper: {
      label: 'TROOPER', hp: 6, speed: 0.62, aggro: 1.25, burst: 4, cooldown: 1.1, score: 220,
      build: R => ({
        height: 31 + R.int(0, 5), headSize: R.range(0.72, 0.86), limbThick: R.range(0.055, 0.070),
        taper: R.range(0.48, 0.70), armour: R.range(0.8, 1.4), grit: R.range(0.55, 1.0),
        legLen: R.range(0.46, 0.51), bootSize: R.range(0.55, 0.85), gloveSize: R.range(0.45, 0.7),
        helmet: R.pick(['full', 'visor', 'crest']), backpack: R.pick(['pack', 'tank']),
        gun: R.chance(0.55) ? 'rifle' : 'smg', gunSize: R.range(0.95, 1.15),
        twoHanded: true, plates: true, pads: R.range(0.6, 0.95), antenna: R.chance(0.5),
        runFrames: 8, aimRows: 5
      })
    },
    heavy: {
      label: 'HEAVY', hp: 14, speed: 0.30, aggro: 0.9, burst: 1, cooldown: 2.2, score: 500,
      build: R => ({
        height: 38 + R.int(0, 6), headSize: R.range(0.60, 0.74), limbThick: R.range(0.072, 0.090),
        taper: R.range(0.35, 0.55), armour: R.range(1.1, 1.5), grit: R.range(0.6, 1.1),
        legLen: R.range(0.43, 0.48), bootSize: R.range(0.8, 1.1), gloveSize: R.range(0.7, 1.0),
        helmet: R.pick(['crest', 'full']), backpack: R.pick(['jet', 'tank', 'pack']),
        gun: 'cannon', gunSize: R.range(1.1, 1.4),
        twoHanded: true, plates: true, pads: R.range(0.95, 1.25), shoulderW: R.range(0.36, 0.43),
        runFrames: 6, aimRows: 5
      })
    },
    overlord: {
      label: 'OVERLORD', hp: 260, speed: 0, aggro: 2.2, burst: 1, cooldown: 1.15,
      score: 5000, lash: 15, crawler: true, boss: true
    },
    crawler: {
      label: 'CRAWLER', hp: 11, speed: 0, aggro: 1.15, burst: 1, cooldown: 1.5,
      score: 400, lash: 11, crawler: true
      // no build(): crawlers come from CRAWLER FORGE, not MERC FORGE
    },
    drone: {
      label: 'DRONE', hp: 4, speed: 0.55, aggro: 1.4, burst: 3, cooldown: 1.3, score: 300,
      flying: true,
      build: R => ({
        height: 24 + R.int(0, 4), headSize: R.range(0.86, 1.05), limbThick: R.range(0.036, 0.048),
        taper: R.range(0.65, 0.92), armour: R.range(0, 0.4), grit: R.range(0.4, 0.8),
        bootSize: R.range(0.2, 0.45), gloveSize: R.range(0.15, 0.4),
        helmet: 'full', backpack: 'jet', gun: 'beam', gunSize: R.range(0.75, 0.95),
        twoHanded: false, plates: false, pads: R.range(0, 0.3), legLen: R.range(0.34, 0.42),
        runFrames: 6, aimRows: 5
      })
    }
  };

  /* Hostiles share the level's colour world so they read as locals,
     but their accent is pushed off the player's hue so a silhouette
     in a firefight is never ambiguous. */
  /* How much of a level's garrison has been got at. Later difficulties
     field more corrupted mercs, which is a real threat change: they
     hover, they vent, and they hit harder. */
  const CORRUPT_RATE = { recruit: 0.18, regular: 0.30, veteran: 0.45, vitriol: 0.62 };

  function archetypeParams(kind, seed, style, corruptRate) {
    const A = ARCHETYPES[kind];
    // Crawlers are grown by CRAWLER FORGE and have no MERC FORGE build;
    // asking for merc params for one is a wiring mistake, not a shrug.
    if (!A || !A.build) {
      throw new Error('archetypeParams: "' + kind + '" has no MERC FORGE build' +
        (A && A.crawler ? ' — use crawlerParams()' : ''));
    }
    const R = GW.makeRng((seed ^ 0x1f2e) >>> 0);
    const base = A.build(R);
    const rate = corruptRate === undefined ? 0.30 : corruptRate;
    const rotten = R.chance(rate);
    base.corrupt = rotten ? R.range(0.45, 1.0) : 0;
    base.growths = R.range(0.6, 1.3);
    base.rotVeins = R.range(0.6, 1.3);
    base.colRot = window.MERCFORGE.hsl(348 + R.range(0, 24), 62 + R.range(0, 28), 28 + R.range(0, 16));
    const h = R.range(0, 360);
    return Object.assign({ seed: seed >>> 0 }, base, {
      colSuit:   window.MERCFORGE.hsl(h, 10 + R.range(0, 18), 26 + R.range(0, 12)),
      colSuit2:  window.MERCFORGE.hsl(h + R.range(-14, 14), 12 + R.range(0, 16), 12 + R.range(0, 7)),
      colAccent: window.MERCFORGE.hsl((h + 180 + R.range(-30, 30)) % 360, 62 + R.range(0, 30), 44 + R.range(0, 12)),
      colVisor:  window.MERCFORGE.hsl((h + 200 + R.range(-25, 25)) % 360, 78 + R.range(0, 20), 56 + R.range(0, 14)),
      colGun:    window.MERCFORGE.hsl(h + 180, 5 + R.range(0, 10), 32 + R.range(0, 12)),
      colSkin:   window.MERCFORGE.hsl(22 + R.range(0, 14), 30 + R.range(0, 20), 46 + R.range(0, 22))
    });
  }

  /* ---------------- crawlers ----------------
     A different generator entirely, so it gets its own params path.
     The palette is picked to belong in the level it infests: a thing
     that grew in a reactor should not look like it grew in a sewer. */
  const CRAWLER_PALETTES = {
    slum:       ['raw', 'rust', 'necrotic'],
    kowloon:    ['raw', 'toxic', 'necrotic'],
    market:     ['raw', 'fungal', 'rust'],
    undercity:  ['necrotic', 'toxic', 'void'],
    industrial: ['rust', 'ember', 'raw'],
    refinery:   ['ember', 'bile', 'rust'],
    reactor:    ['toxic', 'ember', 'bile'],
    ruin:       ['necrotic', 'fungal', 'rust'],
    brutalist:  ['chrome', 'necrotic', 'void'],
    hab:        ['raw', 'chrome', 'fungal'],
    megacorp:   ['chrome', 'void', 'deepsea'],
    arcology:   ['deepsea', 'chrome', 'void'],
    spaceport:  ['deepsea', 'chrome', 'necrotic'],
    server:     ['void', 'deepsea', 'toxic']
  };

  /* ---------------- debris ----------------
     Scrap that arrived from somewhere else reads as pasted on. Two
     things fix that: pick a base palette that belongs to the
     architecture, then re-quantise the finished sprites through the
     level's own palette so they are literally made of the same
     colours as the wall behind them. */
  const SCRAP_PALETTES = {
    slum:       ['rust', 'crate', 'bone'],
    kowloon:    ['rust', 'crate', 'hazard'],
    market:     ['crate', 'rust', 'hazard'],
    undercity:  ['rust', 'toxic', 'bone'],
    industrial: ['steel', 'rust', 'hazard'],
    refinery:   ['hazard', 'toxic', 'rust'],
    reactor:    ['toxic', 'hazard', 'steel'],
    ruin:       ['concrete', 'bone', 'rust'],
    brutalist:  ['concrete', 'steel', 'bone'],
    hab:        ['crate', 'concrete', 'steel'],
    megacorp:   ['steel', 'concrete', 'hazard'],
    arcology:   ['steel', 'bone', 'concrete'],
    spaceport:  ['steel', 'hazard', 'crate'],
    server:     ['steel', 'concrete', 'toxic']
  };

  function scrapParamsFor(seed, levelCfg, override) {
    const SF = window.SCRAPFORGE;
    const p = SF.randomParams(seed);
    const R = GW.makeRng((seed ^ 0x5caa) >>> 0);
    const pool = SCRAP_PALETTES[levelCfg && levelCfg.style] || Object.keys(SF.PALETTES);
    p.palette = R.pick(pool);
    p.size = 13 + R.int(0, 8);
    // borrow the level's own lighting so the debris is lit the same way
    if (levelCfg && levelCfg.lightdir !== undefined) p.lightdir = levelCfg.lightdir;
    if (levelCfg) {
      p.grime = GW.clamp(levelCfg.grime * R.range(0.9, 1.4), 0.2, 1.5);
      p.wear = GW.clamp(levelCfg.wear * R.range(0.9, 1.4), 0.2, 1.5);
    }
    return Object.assign(p, override || {}, { dmgFrames: 3 });
  }

  /* Re-quantise every damage state through the level's palette. A
     no-op when the level is running unpaletted, which is correct: with
     no palette to belong to there is nothing to match. */
  function tintScrapToLevel(set, levelCfg) {
    if (!levelCfg || levelCfg.palette === 'none') return set;
    for (const k in set) {
      try { GW.snapLayer(set[k].canvas, levelCfg, levelCfg.dither * 0.5); }
      catch (e) { /* a tint is never worth failing a bake over */ }
    }
    return set;
  }

  function crawlerParams(seed, levelCfg, variant, pinned) {
    const CF = window.CRAWLERFORGE;
    /* A pinned build means the player designed this thing in the build
       screen and wants exactly it, so the roll is skipped entirely —
       only the seed moves, and only so the two forged variants are not
       byte-identical sheets. */
    if (pinned) {
      return Object.assign({}, pinned, { seed: seed >>> 0 });
    }
    const p = CF.randomParams(seed);
    const R = GW.makeRng((seed ^ 0x9a5b) >>> 0);
    const pool = CRAWLER_PALETTES[levelCfg && levelCfg.style] || Object.keys(CF.PALETTES);
    // Rotate by variant index so the two silhouettes a level forges are
    // never the same colour by coincidence.
    p.palette = pool[(R.int(0, pool.length - 1) + (variant || 0)) % pool.length];
    // Keep it inside the size band the level's collision and the
    // player's weapons were tuned against.
    p.size = Math.max(24, Math.min(40, p.size));
    // Reach scales with the body, or a small crawler flails on threads
    // and a big one moves in tiny hops.
    // Reach of roughly two body-widths. Longer than this and the blob
    // reads as a spider: all legs, no animal.
    p.tentLen = Math.round(p.size * R.range(1.8, 2.6));
    p.tentThick = Math.max(6, Math.round(p.size * R.range(0.24, 0.34)));
    p.tentacles = R.int(4, 7);
    p.tentVariants = R.int(2, 3);
    p.eyes = R.int(2, 5);
    return p;
  }

  /* The boss is a crawler grown past the point of needing the floor.
     Same generator, pushed to the size band where it reads as a mass
     rather than a creature. */
  function overlordParams(seed, levelCfg) {
    const p = crawlerParams(seed, levelCfg, 0);
    const R = GW.makeRng((seed ^ 0x0b055) >>> 0);
    p.size = 52 + R.int(0, 10);
    p.lobes = R.int(6, 10);
    p.chaos = R.range(0.6, 1.05);
    p.tentacles = R.int(8, 11);
    p.tentVariants = 3;
    p.tentLen = Math.round(p.size * R.range(1.9, 2.5));
    p.tentThick = Math.max(12, Math.round(p.size * 0.30));
    p.tentTaper = R.range(0.42, 0.62);     // stays thick most of its length
    p.tentHooks = R.range(0.9, 1.6);
    p.tentRings = R.range(0.8, 1.4);
    p.eyes = R.int(4, 7);
    p.spikes = R.range(0.6, 1.5);
    p.metal = R.range(0.35, 0.75);
    p.slime = R.range(0.8, 1.4);
    p.SS = 3;                    // it is big; keep the bake affordable
    return p;
  }

  /* A starting point for hand-editing a crawler, rather than one of
     the wilder random rolls. */
  function defaultCrawler() {
    return Object.assign({}, window.CRAWLERFORGE.P_DEFAULTS, {
      size: 32, tentacles: 5, tentVariants: 3, eyes: 3
    });
  }

  /* An ally is cut from the same cloth as the player — same build
     family, different colours — so a squad reads as one unit rather
     than as strangers who happen to be shooting the same way. */
  function allyParams(seed, playerParams) {
    const R = GW.makeRng((seed ^ 0xa11) >>> 0);
    const base = Object.assign({}, playerParams || defaultMerc());
    const h = R.range(0, 360);
    return Object.assign(base, {
      seed: seed >>> 0,
      aimRows: 9, runFrames: 8,
      corrupt: 0,                       // your people are not infected
      height: GW.clamp(base.height + R.int(-2, 2), 26, 38),
      helmet: R.pick(['visor', 'full', 'crest']),
      backpack: R.pick(['tank', 'pack', 'jet']),
      gun: R.pick(['rifle', 'smg', 'cannon']),
      pads: R.range(0.3, 0.9),
      plates: true,
      colSuit: window.MERCFORGE.hsl(h, 16 + R.range(0, 22), 30 + R.range(0, 12)),
      colSuit2: window.MERCFORGE.hsl(h + R.range(-12, 12), 20 + R.range(0, 20), 13 + R.range(0, 8)),
      // a cold accent, so an ally never reads as a hostile at a glance
      colAccent: window.MERCFORGE.hsl(180 + R.range(-25, 35), 62 + R.range(0, 26), 48 + R.range(0, 12)),
      colVisor: window.MERCFORGE.hsl(185 + R.range(-20, 30), 76 + R.range(0, 20), 58 + R.range(0, 12))
    });
  }

  /* The default player merc: the tool's own 'nick' preset, which is
     the build every other proportion was tuned against. */
  function defaultMerc() {
    return Object.assign({}, window.MERCFORGE.P_DEFAULTS, { aimRows: 9, runFrames: 8 });
  }

  function randomMerc(seed) {
    const p = window.MERCFORGE.randomParams(seed);
    // The sheet is blitted every frame at 1:1, and the aim row count
    // is the sheet's height. 9 rows is the sweet spot for play.
    p.aimRows = 9;
    p.runFrames = 8;
    // Keep the player readable at gameplay scale.
    p.height = Math.max(28, Math.min(38, p.height));
    return p;
  }

  return {
    LEVEL_DEFAULTS, RUN_DEFAULTS, DIFFICULTY,
    STYLE_AFFINITY, STYLE_KEYS, HARSH_PALETTES,
    ARCHETYPES, archetypeParams, CORRUPT_RATE, defaultMerc, randomMerc, allyParams,
    CRAWLER_PALETTES, crawlerParams, overlordParams, defaultCrawler,
    SCRAP_PALETTES, scrapParamsFor, tintScrapToLevel,
    randomLevelCfg, applyCityPreset
  };
})();
