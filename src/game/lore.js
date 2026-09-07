/* ============================================================
   lore.js — the world a story happens in.

   Generated BEFORE any story is, and knowing nothing about missions,
   levels or rendering. It produces a place: factions who want things,
   people who work for them, locations they hold, one artifact everyone
   is chasing, and one true thing nobody has said out loud yet.

   The story layer then builds its beats out of what is in here, which
   is why a betrayal in VITRIOL is always by somebody you have met and
   always over something that was established two hours earlier. A story
   generator that invents its own cast as it goes produces incidents;
   one that is handed a world produces a plot.

   Everything is seeded and pure. Same seed, same world, forever.
   ============================================================ */
window.LORE = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ============================================================
     NAMING

     Two-part names off large parts lists. The lists are long enough
     that a run of ten factions has no repeats, and deliberately mixed
     in register — institutional, religious, industrial — because the
     factions are too.
     ============================================================ */
  const FAC_ADJ = [
    'PALE', 'NINTH', 'IRON', 'SILENT', 'BROKEN', 'FIRST', 'HOLLOW', 'GILDED',
    'BURNT', 'LOW', 'BLACK', 'THIRD', 'WHITE', 'DROWNED', 'COLD', 'SEVENTH',
    'RED', 'GREY', 'LAST', 'SUNKEN', 'HALF', 'BRIGHT', 'SOUR', 'THIN',
    'OLD', 'QUIET', 'BLIND', 'SPLIT', 'SALT', 'GLASS'
  ];
  const FAC_NOUN = [
    'CONCORD', 'COMBINE', 'SYNOD', 'CARTEL', 'ASSEMBLY', 'TRUST', 'ORDER',
    'BUREAU', 'COMMUNION', 'HOLDING', 'CONSORTIUM', 'PACT', 'CHAPTER',
    'DIRECTORATE', 'COLLECTIVE', 'GUILD', 'MINISTRY', 'CHOIR', 'LODGE',
    'FRANCHISE', 'CONCERN', 'CONGREGATION', 'ESTATE', 'REGISTRY'
  ];
  const FAC_QUAL = [
    'OF ASH', 'OF THE LOW FLOORS', 'OF THE SECOND SILENCE', 'OF BROKEN GLASS',
    'OF THE LONG DARK', 'OF THE WET WALLS', 'OF THE NINTH HOUR', 'OF SALT',
    'OF THE UNDERSIDE', 'OF THE COLD ENGINE', 'OF THE PATIENT RUST',
    'OF THE OPEN VEIN', 'OF THE LAST SHIFT', 'OF THE SEALED WARD'
  ];

  const GIVEN = [
    'VASK', 'MERIT', 'HOLLOW', 'CALLOW', 'THRENE', 'SABLE', 'ORREL', 'PIKE',
    'VESSEL', 'CANT', 'HARROW', 'MOTH', 'GRIST', 'VELLUM', 'SORE', 'KESTREL',
    'DUNE', 'AUGER', 'FLINT', 'MARROW', 'CIPHER', 'TALLOW', 'REND', 'OSSA',
    'BRINE', 'GALLOW', 'WICK', 'SUMP', 'ARC', 'LEAD', 'HUSK', 'SEVEN',
    'BELLOW', 'CINDER', 'NAIL', 'PALLOR', 'QUILL', 'SHIVE', 'TORQUE', 'VEIN'
  ];
  const SURNAME = [
    'KADE', 'ORSK', 'VANE', 'HULL', 'BRAND', 'STOKE', 'GRIEVE', 'MURR',
    'SELK', 'ACHE', 'DOLE', 'RASP', 'VOSS', 'KELP', 'TARN', 'SCOUR',
    'MILL', 'DRAKE', 'CHASM', 'PLINTH', 'BARROW', 'SLAKE', 'CROW', 'VENN',
    'ASHER', 'DERN', 'FOLD', 'GRAIL', 'HAULT', 'ISK'
  ];
  const RANK = [
    'OVERSEER', 'FACTOR', 'WARDEN-MAJOR', 'CANTOR', 'REGISTRAR', 'PROVOST',
    'CHIEF ASSAYER', 'FIRST HAND', 'THE CURATOR', 'SHIFT-FATHER',
    'DEACON', 'QUARTERMASTER', 'THE ACCOUNTANT', 'PREFECT', 'ARCHIVIST'
  ];

  /* ============================================================
     DOCTRINES

     What a faction believes, and what that does to the people it
     sends at you. Fiction and mechanics in one table on purpose: a
     doctrine that reads well but changes nothing is set dressing, and
     one that changes the fight but has no name for itself is a
     difficulty slider.
     ============================================================ */
  const DOCTRINES = {
    attrition: {
      label: 'ATTRITION',
      creed: 'There is always another shift.',
      /* many, cheap, and they do not stop coming */
      mod: { count: 1.35, hp: 0.85, dmg: 0.9, speed: 1.0, corrupt: 0.9 },
      guns: ['pistol', 'smg', 'nail'], kinds: ['city', 'interior'],
      colour: [22, 46, 38], hostility: 0.5
    },
    purity: {
      label: 'PURITY',
      creed: 'What is wrong must be burned out of what is left.',
      mod: { count: 0.9, hp: 1.1, dmg: 1.25, speed: 1.0, corrupt: 0.15 },
      guns: ['torch', 'rifle', 'flak'], kinds: ['interior', 'natural'],
      colour: [40, 70, 58], hostility: 1.3
    },
    salvage: {
      label: 'SALVAGE',
      creed: 'Everything here was somebody else’s first.',
      mod: { count: 1.1, hp: 0.95, dmg: 1.0, speed: 1.1, corrupt: 1.1 },
      guns: ['scatter', 'nail', 'mortar'], kinds: ['city', 'air'],
      colour: [34, 54, 46], hostility: 0.8
    },
    augury: {
      label: 'AUGURY',
      creed: 'The signal was here before the walls were.',
      mod: { count: 0.85, hp: 1.0, dmg: 1.1, speed: 0.95, corrupt: 1.8 },
      guns: ['beam', 'pulse', 'coil'], kinds: ['interior', 'natural'],
      colour: [188, 76, 56], hostility: 1.0
    },
    order: {
      label: 'ORDER',
      creed: 'A ledger with a name in it is a name that can be settled.',
      mod: { count: 1.0, hp: 1.2, dmg: 1.05, speed: 0.9, corrupt: 0.3 },
      guns: ['rifle', 'rail', 'cannon'], kinds: ['city', 'interior'],
      colour: [210, 30, 62], hostility: 0.9
    },
    rapture: {
      label: 'RAPTURE',
      creed: 'It is not a disease. It is an invitation.',
      mod: { count: 1.15, hp: 0.9, dmg: 1.15, speed: 1.15, corrupt: 2.2 },
      guns: ['torch', 'swarm', 'reaper'], kinds: ['natural', 'interior'],
      colour: [318, 66, 52], hostility: 1.5
    },
    freight: {
      label: 'FREIGHT',
      creed: 'The cargo moves. That is the whole of the law.',
      mod: { count: 1.05, hp: 1.05, dmg: 0.95, speed: 1.05, corrupt: 0.5 },
      guns: ['smg', 'flak', 'scatter'], kinds: ['air', 'city'],
      colour: [30, 62, 50], hostility: 0.7
    },
    quiet: {
      label: 'THE QUIET',
      creed: 'Nothing needs to be said that a closed door does not say.',
      mod: { count: 0.75, hp: 1.15, dmg: 1.4, speed: 1.2, corrupt: 0.6 },
      guns: ['rail', 'reaper', 'coil'], kinds: ['interior', 'air'],
      colour: [258, 34, 44], hostility: 1.2
    },
    growth: {
      label: 'GROWTH',
      creed: 'It was a garden. It is only being one again.',
      mod: { count: 1.2, hp: 1.0, dmg: 1.0, speed: 1.05, corrupt: 1.6 },
      guns: ['swarm', 'torch', 'pulse'], kinds: ['natural', 'city'],
      colour: [96, 52, 44], hostility: 1.1
    },
    ledger: {
      label: 'THE LEDGER',
      creed: 'Debt is the only thing here that has never been destroyed.',
      mod: { count: 0.95, hp: 1.1, dmg: 1.1, speed: 1.0, corrupt: 0.4 },
      guns: ['cannon', 'mortar', 'rail'], kinds: ['city', 'interior'],
      colour: [46, 58, 52], hostility: 1.0
    }
  };
  const DOCTRINE_KEYS = Object.keys(DOCTRINES);

  /* A faction keeps a secret. These are structural — the story layer
     can turn any of them into a beat — and each one implies a scene. */
  const FAC_SECRETS = [
    { k: 'manufactured', line: 'The war they are fighting was commissioned. There is an invoice.' },
    { k: 'hollow',       line: 'Their leader has been dead for some time. The orders have not stopped.' },
    { k: 'infected',     line: 'The thing they burn out of others is already inside their own walls.' },
    { k: 'origin',       line: 'They built the operatives. All of them. Including the ones hunting them.' },
    { k: 'debt',         line: 'They owe another faction everything, and have been paying in people.' },
    { k: 'archive',      line: 'They are not holding territory. They are holding a recording.' },
    { k: 'twin',         line: 'Two of the factions are the same faction, and have been for years.' },
    { k: 'sold',         line: 'They have already sold the thing everyone is fighting over.' }
  ];

  /* ============================================================
     PLACES

     A location is a level style with a name, an owner and a reason to
     exist. The name is built from the architecture, so a `reactor`
     never comes out called a garden.
     ============================================================ */
  const PLACE_PREFIX = {
    city:     ['THE', 'OLD', 'LOWER', 'UPPER', 'OUTER', 'THE LATE'],
    interior: ['THE', 'INNER', 'SEALED', 'THE DEEP', 'LOWER'],
    air:      ['THE', 'HIGH', 'OUTER', 'THE LONG'],
    natural:  ['THE', 'OLD', 'WET', 'THE SLOW', 'DEEP']
  };
  const PLACE_NOUN = {
    slum:        ['WARRENS', 'SHELF', 'ROOKERY'],
    kowloon:     ['STACK', 'LADDER', 'TENEMENT'],
    market:      ['EXCHANGE', 'ARCADE', 'ROW'],
    undercity:   ['UNDERCROFT', 'SUMP', 'HOLLOWS'],
    industrial:  ['ASH FORGE', 'WORKS', 'MILL'],
    refinery:    ['CRACKING YARD', 'STILLS', 'RETORT'],
    reactor:     ['PILE', 'CORE HOUSE', 'STACK'],
    ruin:        ['BREAK', 'CRATERWORK', 'REMAINDER'],
    brutalist:   ['SLAB', 'PRECINCT', 'BASTION'],
    hab:         ['HIVE', 'BLOCKS', 'DORMITORY'],
    megacorp:    ['SPIRE', 'CONCOURSE', 'HOLDING'],
    arcology:    ['ARCOLOGY', 'CROWN', 'TERRACE'],
    spaceport:   ['APRON', 'GANTRY FIELD', 'LIFT YARD'],
    server:      ['GHOST GRID', 'STACKS', 'COLD ROOM'],
    boiler:      ['BOILER RUN', 'STEAM GALLERY', 'HOT CORRIDOR'],
    datafarm:    ['FARM', 'ARCHIVE', 'COLD AISLE'],
    office:      ['ADMINISTRATION', 'FLOOR', 'REGISTRY'],
    residential: ['HABLINE', 'CORRIDOR', 'QUARTERS'],
    skylane:     ['SKY LANE', 'APPROACH', 'CAUSEWAY'],
    freightlane: ['FREIGHT ROAD', 'HAUL', 'CONVOY LINE'],
    aerie:       ['AERIE', 'PERCH', 'CROWN WALK'],
    overgrowth:  ['GREEN RUIN', 'RECLAMATION', 'CHOKE'],
    fungal:      ['BLOOM', 'SPORE GALLERY', 'CAP FOREST'],
    mire:        ['MIRE', 'SOURS', 'SEEP'],
    frost:       ['COLD WASTE', 'RIME', 'FREEZE']
  };

  /* One line of history each. `%F` is filled with the owning faction,
     `%P` with the place. Written rather than generated because a
     history has to actually mean something, and there are few enough
     that they can be. */
  const HISTORY = [
    'Everyone who worked %P was reassigned on the same afternoon. None of them arrived.',
    '%F took it without a shot. The previous holders are still listed as employed.',
    'The lights in %P run on a circuit nobody has found. They have never gone out.',
    'It was sealed for eleven years. %F opened it and did not say what for.',
    'Three surveys of %P disagree about how many floors it has.',
    '%F lost more people taking it than it is worth, and will not say why they wanted it.',
    'The air in %P is filtered by something that is no longer strictly equipment.',
    'It was built to hold something in. %F uses it to hold people.',
    'Every map of %P is a copy of one older map, and that one is wrong.',
    'The last shift never clocked out of %P. Their names are still on the board.',
    '%F calls it a holding. The people inside it use a different word.',
    'Something under %P draws power. %F bills it monthly and does not ask.',
    'It changed hands four times in a year. The bodies are stratified.',
    'They stopped counting the dead in %P when the number became an argument.',
    'The signal that comes out of %P is older than the building around it.'
  ];

  /* ============================================================
     THE ARTIFACT — what everyone is chasing.
     ============================================================ */
  const ART_KIND = [
    { k: 'weapon',  noun: ['ENGINE', 'LANCE', 'INSTRUMENT', 'ORDNANCE'],
      is: 'a weapon that should not have been finished' },
    { k: 'person',  noun: ['SUBJECT', 'WITNESS', 'CHILD', 'SLEEPER'],
      is: 'a person who has been asleep for a very long time' },
    { k: 'signal',  noun: ['BROADCAST', 'CHORUS', 'CARRIER', 'HYMN'],
      is: 'a signal that has been transmitting since before the towers' },
    { k: 'key',     noun: ['KEY', 'WRIT', 'SEAL', 'AUTHORITY'],
      is: 'an authority that opens every sealed door in the stack' },
    { k: 'memory',  noun: ['RECORD', 'ARCHIVE', 'CONFESSION', 'LEDGER'],
      is: 'a record of what was done, and by whom, and for how much' },
    { k: 'seed',    noun: ['SEED', 'CULTURE', 'GRAFT', 'SPORE'],
      is: 'a living thing that remembers being a machine' }
  ];
  const ART_ADJ = ['VITRIOL', 'PALE', 'NINTH', 'DROWNED', 'GILDED', 'LAST',
                   'HOLLOW', 'BURNT', 'COLD', 'FIRST', 'SILENT', 'BROKEN'];

  /* ============================================================
     THE SECRET — the act-three turn.

     Structural: each one names who the last mission is really against
     and what winning it costs. The story layer reads `target` and
     `cost` and builds the finale out of them.
     ============================================================ */
  const SECRETS = [
    { k: 'you-are-it',   target: 'self',
      line: 'The artifact is not in the stack. It is in you, and it always was.',
      cost: 'You cannot take it out and survive it.' },
    { k: 'handler-made', target: 'handler',
      line: 'Your handler did not recruit you. They assembled you, and kept the receipt.',
      cost: 'Everything you remember before the first job is somebody else’s.' },
    { k: 'predecessor',  target: 'antagonist',
      line: 'The thing at the bottom of the stack is the operative who came before you.',
      cost: 'It got further than you have, and this is what that did to it.' },
    { k: 'no-war',       target: 'faction',
      line: 'The war is a contract. One party is paying both sides, and has been all along.',
      cost: 'Ending it puts every name on the payroll out of work, including yours.' },
    { k: 'last-witness', target: 'oracle',
      line: 'The thing you were sent to kill is the last one who remembers what happened.',
      cost: 'When it dies, so does the only account of it.' },
    { k: 'rival-same',   target: 'rival',
      line: 'Your rival is running the identical contract from the other end.',
      cost: 'One of you was always going to be the obstacle in the other’s file.' }
  ];

  /* ============================================================
     VOICE — how a character phrases things.

     Not decoration: the cutscene director asks a character for a line
     and gets it back in their register, so the same beat sounds like
     the person delivering it.
     ============================================================ */
  const VOICES = {
    clipped:   { label: 'clipped',   join: '. ', end: '.',  caps: true,
                 tics: ['UNDERSTOOD.', 'MOVE.', 'NO.', 'CONFIRMED.'] },
    liturgic:  { label: 'liturgical', join: ', and ', end: '.', caps: true,
                 tics: ['AS IT WAS WRITTEN.', 'BE STILL.', 'IT IS ALREADY DONE.'] },
    weary:     { label: 'weary',     join: '. ', end: '.',  caps: true,
                 tics: ['DO NOT MAKE ME EXPLAIN.', 'IT IS LATE.', 'I HAVE DONE THIS BEFORE.'] },
    venal:     { label: 'venal',     join: '. ', end: '.',  caps: true,
                 tics: ['THAT IS THE RATE.', 'YOU ARE BILLED FOR THIS.', 'NOTHING PERSONAL.'] },
    cryptic:   { label: 'cryptic',   join: '. ', end: '.',  caps: true,
                 tics: ['YOU WILL SEE.', 'NOT YET.', 'ASK ME AGAIN LATER.'] },
    feral:     { label: 'feral',     join: '. ', end: '.',  caps: true,
                 tics: ['COME DOWN HERE.', 'IT IS WARM.', 'YOU ARE LATE.'] }
  };
  const VOICE_KEYS = Object.keys(VOICES);

  /* ============================================================
     CHARACTER BACKGROUNDS — what a person wants and what is wrong
     with them. The story layer uses `want` to justify a betrayal and
     `wound` to justify a refusal.
     ============================================================ */
  const WANTS = [
    'to be owed nothing by anyone',
    'to find out what happened to the shift they were on',
    'to be the last one who remembers it correctly',
    'to get one person off the stack alive',
    'to be forgiven by an institution that no longer exists',
    'to stop being useful to people who count',
    'to prove the thing under the floor is real',
    'to die somewhere with a window'
  ];
  const WOUNDS = [
    'signed off on something that killed a floor',
    'was the only one who came back and has never explained it',
    'sold a name to buy a week',
    'was made, not born, and found the paperwork',
    'left somebody behind at a door that was still open',
    'has been dead once already and did not stay',
    'gave an order that was carried out exactly',
    'is the reason the seal was broken'
  ];
  const FLAWS = [
    'cannot leave a question alone',
    'trusts anyone who tells them a hard truth first',
    'has never once withdrawn',
    'keeps promises to people who are gone',
    'assumes the worst and is usually right, which is worse',
    'needs to be the one holding the weapon'
  ];

  /* ============================================================
     THE GENERATOR
     ============================================================ */

  function facName(R, used) {
    for (let t = 0; t < 60; t++) {
      let n = R.pick(FAC_ADJ) + ' ' + R.pick(FAC_NOUN);
      if (R.chance(0.28)) n += ' ' + R.pick(FAC_QUAL);
      if (!used.has(n)) { used.add(n); return n; }
    }
    return 'THE ' + R.int(100, 999) + 'TH CONCERN';
  }

  /* Names have to be distinct in BOTH halves. Three people called
     something PLINTH in one world reads as a bug in the generator,
     which — when the surname list is thirty long and the draw is
     independent — is exactly what it is. */
  function personName(R, usedFull, usedSur) {
    for (let t = 0; t < 80; t++) {
      const g = R.pick(GIVEN), sur = R.pick(SURNAME);
      const n = g + ' ' + sur;
      if (usedFull.has(n)) continue;
      if (usedSur && usedSur.has(sur) && t < 50) continue;
      usedFull.add(n);
      if (usedSur) usedSur.add(sur);
      return n;
    }
    return 'UNIT ' + R.int(1000, 9999);
  }

  /* Deal from a list without replacement, reshuffling when it runs
     dry. Everything that would read as a repeat goes through this:
     two characters with the same wound are two characters the player
     cannot tell apart. */
  function dealer(R, list) {
    let bag = [];
    return () => {
      if (!bag.length) {
        bag = list.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = R.int(0, i); const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
        }
      }
      return bag.pop();
    };
  }

  /* A face. Built from MERC FORGE params so a character can be drawn
     anywhere a rig can, and tinted to their faction so you can tell
     who somebody works for before they open their mouth. */
  function faceFor(R, faction, role) {
    const hue = faction ? faction.hue : R.int(0, 359);
    const sat = faction ? faction.sat : R.range(30, 60);
    const lit = faction ? faction.lit : R.range(40, 60);
    const MF = window.MERCFORGE;
    return Object.assign({}, MF.P_DEFAULTS, {
      seed: R.int(0, 0x7fffffff),
      aimRows: 3, runFrames: 2,
      corrupt: 0, growths: 0, rotVeins: 0,
      height: role === 'antagonist' ? R.int(40, 46) : R.int(30, 40),
      headSize: R.range(0.72, 0.90),
      helmet: R.pick(role === 'oracle' ? ['crest', 'full'] : ['visor', 'full', 'crest', 'none']),
      backpack: R.pick(['none', 'pack', 'tank']),
      gun: 'pistol', gunSize: 0.8, twoHanded: false,
      pads: R.range(0.2, 1.1), plates: R.chance(0.6),
      armour: R.range(0.3, 1.3),
      limbThick: R.range(0.045, 0.070),
      colSuit: MF.hsl(hue, sat * 0.5, lit * 0.45),
      colSuit2: MF.hsl(hue, sat * 0.4, lit * 0.26),
      colGun: MF.hsl(hue, 10, 26),
      colAccent: MF.hsl(hue, sat, lit),
      colVisor: MF.hsl(hue, Math.min(96, sat * 1.4), Math.min(78, lit * 1.3))
    });
  }

  function makeCharacter(R, opts) {
    const o = opts || {};
    return {
      id: o.id,
      role: o.role || 'contact',
      name: o.name,
      title: o.title || null,
      faction: o.faction ? o.faction.id : null,
      voice: o.voice || R.pick(VOICE_KEYS),
      want: o.deal ? o.deal.want() : R.pick(WANTS),
      wound: o.deal ? o.deal.wound() : R.pick(WOUNDS),
      flaw: o.deal ? o.deal.flaw() : R.pick(FLAWS),
      face: faceFor(R, o.faction, o.role),
      /* How they feel about you, -3..+3. Moves during a run; the story
         layer reads it to decide who helps and who does not. */
      standing: o.standing === undefined ? 0 : o.standing,
      alive: true,
      met: false
    };
  }

  /* The relation matrix. Built by picking a small number of real
     grudges and alliances rather than filling every cell at random:
     a map where everybody mildly dislikes everybody is a map with no
     story in it. */
  function relate(R, factions) {
    const n = factions.length;
    const rel = [];
    for (let i = 0; i < n; i++) rel.push(new Array(n).fill(0));

    /* one open war, so the world has a front line */
    const a = R.int(0, n - 1);
    let b = R.int(0, n - 1);
    for (let t = 0; t < 20 && b === a; t++) b = R.int(0, n - 1);
    if (b !== a) { rel[a][b] = rel[b][a] = -2; }

    /* one alliance, so betraying it means something */
    const c = R.int(0, n - 1);
    let d = R.int(0, n - 1);
    for (let t = 0; t < 20 && (d === c || rel[c][d] !== 0); t++) d = R.int(0, n - 1);
    if (d !== c && rel[c][d] === 0) { rel[c][d] = rel[d][c] = 2; }

    /* and a scatter of ordinary friction */
    for (let k = 0; k < n; k++) {
      const i = R.int(0, n - 1), j = R.int(0, n - 1);
      if (i === j || rel[i][j] !== 0) continue;
      const v = R.chance(0.6) ? -1 : 1;
      rel[i][j] = rel[j][i] = v;
    }
    return rel;
  }

  const RELATION_WORD = { '-2': 'at war with', '-1': 'hostile to', '0': 'indifferent to',
                          '1': 'aligned with', '2': 'allied to' };

  /* ------------------------------------------------------------
     makeWorld — the whole thing.
     ------------------------------------------------------------ */
  function makeWorld(seed, opts) {
    const o = opts || {};
    const R = GW.makeRng((seed ^ 0x10121) >>> 0);
    const usedFac = new Set(), usedPer = new Set(), usedPlace = new Set();
    const usedSur = new Set();
    const deal = { want: dealer(R, WANTS), wound: dealer(R, WOUNDS),
                   flaw: dealer(R, FLAWS), history: dealer(R, HISTORY) };

    /* --- factions --- */
    const nFac = clamp(o.factions === undefined ? R.int(4, 6) : o.factions, 3, 8);
    const pool = DOCTRINE_KEYS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = R.int(0, i); const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const factions = [];
    for (let i = 0; i < nFac; i++) {
      const dk = pool[i % pool.length];
      const D = DOCTRINES[dk];
      const f = {
        id: i,
        name: facName(R, usedFac),
        doctrine: dk,
        creed: D.creed,
        mod: Object.assign({}, D.mod),
        guns: D.guns.slice(),
        kinds: D.kinds.slice(),
        hostility: D.hostility,
        /* a colour of their own, nudged off the doctrine's so two
           runs of the same doctrine are not the same shade */
        hue: (D.colour[0] + R.int(-14, 14) + 360) % 360,
        sat: clamp(D.colour[1] + R.int(-8, 8), 12, 92),
        lit: clamp(D.colour[2] + R.int(-6, 6), 26, 70),
        secret: R.pick(FAC_SECRETS),
        holdings: [],
        leader: null,
        /* how you stand with them. Story mode moves this. */
        rep: 0
      };
      factions.push(f);
    }
    const rel = relate(R, factions);

    /* --- places ---
       One per style the run will visit, owned by a faction that would
       plausibly hold it: a doctrine that lives in interiors gets the
       interiors. */
    const styleKinds = window.CONFIG.STYLES_BY_KIND;
    const places = [];
    const allStyles = [];
    for (const k in styleKinds) for (const st of styleKinds[k]) allStyles.push({ st, kind: k });
    for (let i = allStyles.length - 1; i > 0; i--) {
      const j = R.int(0, i); const t = allStyles[i]; allStyles[i] = allStyles[j]; allStyles[j] = t;
    }
    const nPlace = clamp(o.places === undefined ? 14 : o.places, 4, allStyles.length);
    for (let i = 0; i < nPlace; i++) {
      const { st, kind } = allStyles[i];
      /* Prefer an owner whose doctrine lives in this kind of place —
         but only among those not already over their share. Left to
         taste alone, one faction ends up holding half the world and
         three of them hold one site each, which is not a map with a
         war on it. */
      const share = nPlace / factions.length;
      const keen = factions.filter(f => f.kinds.indexOf(kind) >= 0);
      const under = a => a.filter(f => f.holdings.length < share);
      const owner = R.pick(under(keen).length ? under(keen)
                         : under(factions).length ? under(factions)
                         : keen.length ? keen : factions);
      const nouns = PLACE_NOUN[st] || ['SITE'];
      let name = null;
      for (let t = 0; t < 30 && !name; t++) {
        const c = R.pick(PLACE_PREFIX[kind] || PLACE_PREFIX.city) + ' ' + R.pick(nouns);
        if (!usedPlace.has(c)) { usedPlace.add(c); name = c; }
      }
      if (!name) name = 'SITE ' + (i + 1);
      const p = {
        id: i, style: st, kind, name,
        owner: owner.id,
        history: deal.history().replace(/%F/g, owner.name).replace(/%P/g, name)
      };
      owner.holdings.push(p.id);
      places.push(p);
    }
    /* Nobody should be landless — a faction you never fight in a place
       of theirs is a faction you never really meet. */
    for (const f of factions) {
      if (f.holdings.length) continue;
      const take = R.pick(places);
      const prev = factions[take.owner];
      if (prev.holdings.length > 1) {
        prev.holdings = prev.holdings.filter(id => id !== take.id);
        take.owner = f.id;
        take.history = take.history.replace(prev.name, f.name);
        f.holdings.push(take.id);
      }
    }

    /* --- the artifact --- */
    const ak = R.pick(ART_KIND);
    const artifact = {
      kind: ak.k,
      name: 'THE ' + R.pick(ART_ADJ) + ' ' + R.pick(ak.noun),
      is: ak.is,
      /* who is holding it at the start, and who wants it most */
      heldBy: R.pick(factions).id,
      wantedBy: R.pick(factions).id
    };

    /* --- the cast --- */
    const you = makeCharacter(R, {
      id: 'you', role: 'you', deal, name: personName(R, usedPer, usedSur),
      faction: null, voice: R.pick(['clipped', 'weary', 'cryptic'])
    });
    /* Your origin: which faction made you or threw you out. It is the
       hook everything else can pull on. */
    you.origin = R.pick(factions).id;
    you.face = faceFor(R, factions[you.origin], 'you');

    const handlerFac = R.pick(factions);
    const handler = makeCharacter(R, {
      id: 'handler', role: 'handler', faction: handlerFac, deal,
      name: personName(R, usedPer, usedSur), title: R.pick(RANK),
      voice: R.pick(['venal', 'clipped', 'weary']), standing: 1
    });
    const rivalFac = R.pick(factions.filter(f => f.id !== handlerFac.id)) || handlerFac;
    const rival = makeCharacter(R, {
      id: 'rival', role: 'rival', faction: rivalFac, deal,
      name: personName(R, usedPer, usedSur),
      voice: R.pick(['clipped', 'feral', 'weary']), standing: -1
    });
    const oracle = makeCharacter(R, {
      id: 'oracle', role: 'oracle', faction: null, deal,
      name: personName(R, usedPer, usedSur), title: 'THE ORACLE',
      voice: 'cryptic'
    });
    oracle.face = faceFor(R, null, 'oracle');
    const antFac = R.pick(factions);
    const antagonist = makeCharacter(R, {
      id: 'antagonist', role: 'antagonist', faction: antFac, deal,
      name: personName(R, usedPer, usedSur), title: R.pick(RANK),
      voice: R.pick(['liturgic', 'clipped', 'feral']), standing: -2
    });

    /* Leaders last. Backgrounds are dealt from bags that reshuffle
       when they run dry, so whoever is built first gets the clean draw
       — and the five people the player actually talks to should be the
       ones who never share a wound. */
    for (const f of factions) {
      f.leader = makeCharacter(R, {
        id: 'leader' + f.id, role: 'leader', faction: f, deal,
        name: personName(R, usedPer, usedSur), title: R.pick(RANK),
        voice: f.doctrine === 'augury' || f.doctrine === 'rapture' ? 'liturgic'
             : f.doctrine === 'ledger' || f.doctrine === 'salvage' ? 'venal'
             : f.doctrine === 'quiet' ? 'clipped' : R.pick(VOICE_KEYS)
      });
    }

    const cast = [you, handler, rival, oracle, antagonist];
    for (const f of factions) cast.push(f.leader);

    /* --- the secret --- */
    const secret = R.pick(SECRETS);

    const W = {
      seed: seed >>> 0,
      factions, rel, places, artifact, secret,
      you, handler, rival, oracle, antagonist,
      cast,
      /* lookups, so consumers never have to scan */
      facById: id => factions[id] || null,
      placeById: id => places[id] || null,
      charById: id => cast.find(c => c.id === id) || null,
      relation: (a, b) => (a === b ? 2 : (rel[a] ? rel[a][b] : 0) || 0),
      relationWord: (a, b) => RELATION_WORD[String(W.relation(a, b))] || 'indifferent to',
      /* every place a given faction holds */
      holdingsOf: id => places.filter(p => p.owner === id)
    };
    return W;
  }

  /* ------------------------------------------------------------
     A short readable dossier. Used by the codex screen and by the
     harness, which is the real reason it exists: a world you cannot
     print is a world you cannot check.
     ------------------------------------------------------------ */
  function describe(W) {
    const L = [];
    L.push('ARTIFACT  ' + W.artifact.name + ' — ' + W.artifact.is);
    L.push('SECRET    ' + W.secret.line);
    L.push('');
    for (const f of W.factions) {
      L.push(f.name + '  [' + DOCTRINES[f.doctrine].label + ']');
      L.push('   "' + f.creed + '"');
      L.push('   led by ' + (f.leader.title ? f.leader.title + ' ' : '') + f.leader.name);
      const foes = W.factions.filter(g => g.id !== f.id && W.relation(f.id, g.id) < 0);
      const pals = W.factions.filter(g => g.id !== f.id && W.relation(f.id, g.id) > 0);
      if (foes.length) L.push('   hostile to ' + foes.map(g => g.name).join(', '));
      if (pals.length) L.push('   aligned with ' + pals.map(g => g.name).join(', '));
      L.push('   holds ' + f.holdings.map(id => W.places[id].name).join(', '));
    }
    L.push('');
    for (const p of W.places) {
      L.push(p.name + '  (' + p.style + ') — ' + W.factions[p.owner].name);
      L.push('   ' + p.history);
    }
    L.push('');
    for (const c of [W.you, W.handler, W.rival, W.oracle, W.antagonist]) {
      L.push(c.role.toUpperCase() + '  ' + (c.title ? c.title + ' ' : '') + c.name +
             (c.faction !== null ? '  of ' + W.factions[c.faction].name
              : c.origin !== undefined ? '  made by ' + W.factions[c.origin].name
              : '  (unaffiliated)'));
      L.push('   wants ' + c.want + '; ' + c.wound + '; ' + c.flaw);
    }
    return L.join('\n');
  }

  return {
    makeWorld, describe, makeCharacter, faceFor,
    DOCTRINES, DOCTRINE_KEYS, VOICES, VOICE_KEYS,
    SECRETS, FAC_SECRETS, ART_KIND, HISTORY,
    WANTS, WOUNDS, FLAWS, PLACE_NOUN, RELATION_WORD
  };
})();
