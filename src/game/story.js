/* ============================================================
   story.js — a run through a world.

   Takes a world from lore.js and lays a three-act spine over it. What
   comes out is a list of BEATS: missions to play and interludes to
   choose at. It knows nothing about how a level is baked or how a
   cutscene is drawn — a beat says what is happening and to whom, and
   the layers above work out what that looks like.

   The design is a spine with a memory, not a branching tree. The shape
   of a run is fixed — job, complication, escalation, betrayal, turn,
   revelation, confrontation — because that shape is what makes a story
   feel like one. What varies is who each beat is against, what it costs
   you, and how it ends. A tree doubles in size for every choice and
   most of it is never seen; a spine with a memory spends everything it
   has on the run you are actually playing.
   ============================================================ */
window.STORY = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const LR = window.LORE;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ============================================================
     OBJECTIVES — the reason you are in a level.

     `enforce` is read by the mission layer: it says what has to be
     true before the pad opens, and what ends the run early. Keeping
     the rule here rather than in world.js is what stops the mission
     code growing a switch statement per objective.
     ============================================================ */
  const OBJECTIVES = {
    extract: {
      label: 'EXTRACT', verb: 'get out',
      brief: 'Cross %P and reach the pad. Nothing else is being asked.',
      gate: 'none'
    },
    hunt: {
      label: 'HUNT', verb: 'kill %T',
      brief: '%T is somewhere in %P. Put them down, then leave.',
      gate: 'target'
    },
    purge: {
      label: 'PURGE', verb: 'clear the place',
      brief: 'Everything %F has in %P. All of it. Then the pad.',
      gate: 'kills'
    },
    sabotage: {
      label: 'SABOTAGE', verb: 'break what they need',
      brief: 'Three of their charges are set in %P. Blow them and go.',
      gate: 'charges'
    },
    recover: {
      label: 'RECOVER', verb: 'take it back',
      brief: 'A cache is down there. Carry it to the pad. Do not open it.',
      gate: 'cache'
    },
    survive: {
      label: 'HOLD', verb: 'hold the ground',
      brief: 'The pad is cold for %S seconds. Be alive when it warms up.',
      gate: 'timer'
    },
    escort: {
      label: 'ESCORT', verb: 'keep them breathing',
      brief: 'One of ours is in %P and cannot fight. Get them to the pad.',
      gate: 'ally'
    }
  };
  const OBJ_KEYS = Object.keys(OBJECTIVES);

  /* ============================================================
     ACT STRUCTURE

     Each act is a run of beat templates. A template says what KIND of
     beat it is and how to pick its participants; the world supplies
     the actual people and places. Written out rather than generated
     because structure is the one thing a story cannot roll for.
     ============================================================ */
  const ACTS = [
    {
      n: 1, name: 'THE JOB',
      beats: [
        { t: 'scene',   k: 'open',        who: ['handler', 'you'] },
        { t: 'mission', k: 'first',       obj: ['extract', 'hunt'] },
        { t: 'scene',   k: 'complication', who: ['handler'] },
        { t: 'mission', k: 'contact',     obj: ['purge', 'sabotage', 'extract'] },
        { t: 'choice',  k: 'allegiance' },
        { t: 'mission', k: 'reprisal',    obj: ['survive', 'hunt', 'extract'] }
      ]
    },
    {
      n: 2, name: 'THE DEBT',
      beats: [
        { t: 'scene',   k: 'oracle',      who: ['oracle', 'you'] },
        { t: 'mission', k: 'deep',        obj: ['recover', 'sabotage', 'extract'] },
        { t: 'scene',   k: 'rival',       who: ['rival', 'you'] },
        { t: 'mission', k: 'rivalfight',  obj: ['hunt', 'purge'] },
        { t: 'choice',  k: 'mercy' },
        { t: 'scene',   k: 'betrayal',    who: ['handler', 'you'] },
        { t: 'mission', k: 'burned',      obj: ['survive', 'escort', 'extract'] }
      ]
    },
    {
      n: 3, name: 'THE TURN',
      beats: [
        { t: 'scene',   k: 'revelation',  who: ['oracle', 'you'] },
        { t: 'mission', k: 'approach',    obj: ['sabotage', 'recover', 'purge'] },
        { t: 'choice',  k: 'final' },
        { t: 'mission', k: 'confront',    obj: ['hunt'], boss: true },
        { t: 'scene',   k: 'ending',      who: ['you'] }
      ]
    }
  ];

  /* ============================================================
     CHOICES — the interludes.

     Two or three options. Each sets a flag, moves reputation, and may
     grant a trait. The flags are read later: `story.flag('spared')`
     is how act three knows what act two did.
     ============================================================ */
  const CHOICE_TEMPLATES = {
    allegiance: {
      prompt: '%H wants the contract honoured. %L of %F has offered to double it.',
      opts: [
        { id: 'honour',  label: 'HONOUR THE CONTRACT',
          line: 'You took the work. You do the work.',
          flag: 'loyal', rep: { handler: +2, offer: -2 }, trait: 'reliable' },
        { id: 'defect',  label: 'TAKE THE BETTER OFFER',
          line: 'Loyalty is a rate like any other.',
          flag: 'bought', rep: { handler: -2, offer: +2 }, trait: 'venal' },
        { id: 'neither', label: 'TELL THEM BOTH NOTHING',
          line: 'Two people expecting an answer is two people who have to wait.',
          flag: 'silent', rep: { handler: -1, offer: -1 }, trait: 'unreadable' }
      ]
    },
    mercy: {
      prompt: '%R is on the floor and out of rounds. They are still talking.',
      opts: [
        { id: 'spare',  label: 'LET THEM UP',
          line: 'Somebody who owes you is worth more than somebody who does not.',
          flag: 'spared', rep: { rival: +3 }, trait: 'merciful' },
        { id: 'finish', label: 'FINISH IT',
          line: 'The file said one of you. It did not say which.',
          flag: 'killed', rep: { rival: -3 }, trait: 'ruthless' },
        { id: 'take',   label: 'TAKE WHAT THEY CARRY',
          line: 'They can keep the breathing. You will have the rest.',
          flag: 'robbed', rep: { rival: -1 }, trait: 'scavenger' }
      ]
    },
    final: {
      prompt: '%S',
      opts: [
        { id: 'burn',    label: 'END IT ANYWAY',
          line: 'Whatever it costs, it stops here.',
          flag: 'burn', rep: {}, trait: 'unflinching' },
        { id: 'bargain', label: 'MAKE A DEAL',
          line: 'Everything in this stack has a price. Including this.',
          flag: 'bargain', rep: {}, trait: 'pragmatist' },
        { id: 'walk',    label: 'WALK AWAY',
          line: 'Some doors are better left where they are.',
          flag: 'walk', rep: {}, trait: 'survivor' }
      ]
    }
  };

  /* ============================================================
     TRAITS — character development, with teeth.

     Earned at choices and by how you play. Each is a permanent
     modifier with a line of fiction attached, and the modifiers are
     read by the mission layer the same way warden grafts are.
     ============================================================ */
  const TRAITS = {
    reliable:    { label: 'RELIABLE',    line: 'People who pay you say your name without a pause.',
                   mod: { rep: 1.25 } },
    venal:       { label: 'VENAL',       line: 'You have a rate and it goes up.',
                   mod: { score: 1.3 } },
    unreadable:  { label: 'UNREADABLE',  line: 'Nobody briefs against what they cannot predict.',
                   mod: { aggro: 0.85 } },
    merciful:    { label: 'MERCIFUL',    line: 'Somebody out there still owes you a door.',
                   mod: { allies: 1 } },
    ruthless:    { label: 'RUTHLESS',    line: 'You do not leave a thing behind you that can talk.',
                   mod: { dmg: 1.15 } },
    scavenger:   { label: 'SCAVENGER',   line: 'You have never once walked past something useful.',
                   mod: { mag: 1.25 } },
    unflinching: { label: 'UNFLINCHING', line: 'The part of you that hesitated is gone.',
                   mod: { armour: 1.2 } },
    pragmatist:  { label: 'PRAGMATIST',  line: 'Every problem is a price you have not named yet.',
                   mod: { reload: 1.25 } },
    survivor:    { label: 'SURVIVOR',    line: 'You are still here. That is the whole skill.',
                   mod: { vitals: 25 } },
    /* earned by play rather than choice */
    surgical:    { label: 'SURGICAL',    line: 'You cleared a floor without being touched.',
                   mod: { dmg: 1.1, rate: 1.1 } },
    stubborn:    { label: 'STUBBORN',    line: 'You have died more times than the job was worth.',
                   mod: { armour: 1.25, vitals: 20 } },
    quick:       { label: 'QUICK',       line: 'You were out before they finished forming up.',
                   mod: { speed: 1.1, rate: 1.1 } },
    thorough:    { label: 'THOROUGH',    line: 'Nothing you have walked past is still standing.',
                   mod: { score: 1.2, mag: 1.15 } }
    };
  const TRAIT_KEYS = Object.keys(TRAITS);

  /* ============================================================
     THE GENERATOR
     ============================================================ */

  /* Fill the %-slots in a template line. Everything a beat can talk
     about is here, so a template can name anything the world knows. */
  function fill(text, ctx) {
    if (!text) return '';
    return String(text)
      .replace(/%P/g, ctx.place ? ctx.place.name : 'THE SITE')
      .replace(/%F/g, ctx.faction ? ctx.faction.name : 'THEM')
      .replace(/%T/g, ctx.target ? ctx.target.name : 'THE TARGET')
      .replace(/%H/g, ctx.W.handler.name)
      .replace(/%R/g, ctx.W.rival.name)
      .replace(/%O/g, ctx.W.oracle.name)
      .replace(/%A/g, ctx.W.antagonist.name)
      .replace(/%L/g, ctx.offer ? (ctx.offer.leader.title ? ctx.offer.leader.title + ' ' : '') +
                                   ctx.offer.leader.name : 'SOMEBODY')
      .replace(/%X/g, ctx.W.artifact.name)
      .replace(/%S/g, ctx.secondsOrSecret === undefined ? ctx.W.secret.line
                                                        : String(ctx.secondsOrSecret));
  }

  /* Pick the faction a mission is against. Weighted so the run works
     down the map: whoever holds the artifact and whoever you have the
     worst standing with come up more, and a faction you are allied
     with does not send troops at you for no reason. */
  function foeFor(R, W, story, place) {
    if (place) return W.facById(place.owner);
    const weights = W.factions.map(f => {
      let w = 1;
      if (f.id === W.artifact.heldBy) w += 1.5;
      if (f.id === W.you.origin) w += 0.5;
      w += clamp(-story.rep[f.id] * 0.4, 0, 2);
      w *= f.hostility;
      return Math.max(0.05, w);
    });
    let tot = 0; for (const w of weights) tot += w;
    let t = R.rnd() * tot;
    for (let i = 0; i < weights.length; i++) { if ((t -= weights[i]) <= 0) return W.factions[i]; }
    return W.factions[0];
  }

  /* A named target for a hunt. Somebody who exists: a faction leader,
     the rival, or the antagonist, depending on how far in we are. */
  function targetFor(R, W, story, act, foe) {
    if (act === 3) return W.antagonist;
    if (story.beatsDone > 5 && R.chance(0.4) && W.rival.alive) return W.rival;
    return foe.leader;
  }

  function makeStory(W, opts) {
    const o = opts || {};
    const R = GW.makeRng((W.seed ^ 0x570a1) >>> 0);

    const story = {
      world: W,
      seed: W.seed,
      opts: Object.assign({}, o),
      beats: [],
      at: 0,                       // index of the beat we are on
      beatsDone: 0,
      flags: {},
      traits: [],
      rep: W.factions.map(f => f.rep || 0),
      log: [],
      done: false, won: false,
      /* run totals, filled in as missions are cleared */
      score: 0, kills: 0, deaths: 0, time: 0
    };

    /* Places are dealt so a run visits a spread of the map rather than
       the same two rooms. A story that plays three missions in one
       location is a story about a corridor. */
    const bag = W.places.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = R.int(0, i); const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    let bagAt = 0;
    const nextPlace = () => bag[(bagAt++) % bag.length];

    /* --- lay the spine --- */
    let mission = 0;
    for (const act of ACTS) {
      for (const tmpl of act.beats) {
        const beat = { act: act.n, actName: act.name, type: tmpl.t, kind: tmpl.k,
                       i: story.beats.length };
        if (tmpl.t === 'mission') {
          const place = nextPlace();
          const foe = W.facById(place.owner);
          const obj = R.pick(tmpl.obj);
          beat.place = place.id;
          beat.foe = foe.id;
          beat.objective = obj;
          beat.n = ++mission;
          beat.boss = !!tmpl.boss;
          beat.target = null;
          if (obj === 'hunt') {
            const t = targetFor(R, W, story, act.n, foe);
            beat.target = t.id;
          }
          if (obj === 'survive') beat.seconds = R.int(45, 80);
          if (obj === 'sabotage') beat.charges = R.int(3, 4);
        } else if (tmpl.t === 'choice') {
          beat.template = tmpl.k;
          /* the rival offer for the allegiance choice: somebody who is
             not the handler and would plausibly want you */
          const others = W.factions.filter(f => f.id !== W.handler.faction);
          beat.offer = (others.length ? R.pick(others) : W.factions[0]).id;
        } else {
          beat.who = tmpl.who.slice();
        }
        story.beats.push(beat);
      }
    }
    story.missions = mission;

    /* ---------------- reading the run ---------------- */

    story.current = () => story.beats[story.at] || null;

    story.ctxFor = function (beat) {
      if (!beat) return { W };
      /* A scene has no location of its own, but it is almost always
         about the one coming up — a briefing names the place you are
         being sent to, and a cutscene staged with %P reading "THE
         SITE" is a cutscene about nowhere. So a non-mission beat
         borrows the next mission's place, and its garrison too unless
         the beat already has a faction of its own to talk about. */
      let ahead = null;
      if (beat.type !== 'mission') {
        for (let i = beat.i; i < story.beats.length; i++) {
          if (story.beats[i].type === 'mission') { ahead = story.beats[i]; break; }
        }
        if (!ahead) {
          for (let i = beat.i; i >= 0; i--) {
            if (story.beats[i].type === 'mission') { ahead = story.beats[i]; break; }
          }
        }
      }
      return {
        W,
        place: beat.place !== undefined ? W.placeById(beat.place)
             : ahead ? W.placeById(ahead.place) : null,
        /* A choice has no garrison, so %F on one names the faction
           making the offer — otherwise the allegiance prompt offers you
           a job with "THEM". */
        faction: beat.foe !== undefined ? W.facById(beat.foe)
               : beat.offer !== undefined ? W.facById(beat.offer)
               : ahead ? W.facById(ahead.foe) : null,
        target: beat.target ? W.charById(beat.target)
              : ahead && ahead.target ? W.charById(ahead.target) : null,
        offer: beat.offer !== undefined ? W.facById(beat.offer) : null,
        secondsOrSecret: beat.seconds
      };
    };

    /* The one-line briefing a mission gets. Built from the objective
       template and the world, so it always names the actual place and
       the actual people. */
    story.brief = function (beat) {
      if (!beat || beat.type !== 'mission') return '';
      return fill(OBJECTIVES[beat.objective].brief, story.ctxFor(beat));
    };

    story.title = function (beat) {
      if (!beat) return '';
      if (beat.type !== 'mission') return beat.actName;
      const p = W.placeById(beat.place);
      return OBJECTIVES[beat.objective].label + ' · ' + p.name;
    };

    /* The choice a `choice` beat is asking, with its options already
       filled in. The UI renders this; the harness reads it. */
    story.choiceAt = function (beat) {
      if (!beat || beat.type !== 'choice') return null;
      const T = CHOICE_TEMPLATES[beat.template];
      const ctx = story.ctxFor(beat);
      return {
        template: beat.template,
        prompt: fill(T.prompt, ctx),
        options: T.opts.map(op => ({
          id: op.id, label: op.label, line: op.line,
          flag: op.flag, trait: op.trait
        }))
      };
    };

    /* ------------------------------------------------------------
       Everything the loader needs to bake the beat we are on. The
       shape matches Campaign.build() on purpose: the app has one
       loading path, and a mode that needed its own would be a mode
       that drifts.
       ------------------------------------------------------------ */
    story.build = function () {
      const beat = story.current();
      if (!beat || beat.type !== 'mission') return null;
      const C = window.CONFIG;
      const place = W.placeById(beat.place);
      const foe = W.facById(beat.foe);
      const sd = ((W.seed ^ (beat.i * 0x9e3779b1)) * 0x85ebca6b) >>> 0;

      /* The level is the place. Its architecture is fixed by the
         location — you do not get a different ASH FORGE each visit —
         but everything else about the bake still rolls. */
      let cfg = null;
      for (let t = 0; t < 400 && !cfg; t++) {
        const c = C.randomLevelCfg((sd + t * 7919) >>> 0, place.kind);
        if (c.style === place.style) cfg = c;
      }
      if (!cfg) { cfg = C.randomLevelCfg(sd, place.kind); cfg.style = place.style; }

      /* The curve: act by act, and steeper if you have been making
         enemies. A run where the last act is the same fight as the
         first is a run with no shape. */
      const t = (beat.act - 1) / 2;
      const heat = clamp(-story.rep.reduce((a, b) => a + Math.min(0, b), 0) * 0.05, 0, 0.5);
      const mods = story.mods();
      const sc = {
        dens: (0.85 + t * 0.85 + heat) * (foe.mod.count || 1),
        hp: (1 + t * 0.7) * (foe.mod.hp || 1),
        dmg: (1 + t * 0.45) * (foe.mod.dmg || 1),
        fire: (1 + t * 0.4) * (foe.mod.speed || 1),
        corrupt: clamp(0.12 + t * 0.4, 0, 0.85) * (foe.mod.corrupt || 1),
        len: Math.round(clamp(3 + t * 2.6, 3, 7))
      };
      cfg.levelLen = beat.objective === 'survive' ? 3 : sc.len;

      const opts = Object.assign({}, story.opts, {
        difficulty: story.opts.difficulty || 'regular',
        enemyDens: (story.opts.enemyDens || 1) * sc.dens,
        allies: clamp((story.opts.allies === 0 ? 0 : 1) + (mods.allies || 0), 0, 4),
        wardens: beat.act === 1 ? 2 : 1,
        story, beat,
        sectorScale: sc,
        objective: beat.objective,
        seconds: beat.seconds,
        charges: beat.charges,
        targetName: beat.target ? W.charById(beat.target).name : null,
        bossTarget: !!beat.boss,
        carry: story.carry || null,
        /* the garrison is this faction's, and looks like it */
        faction: foe
      });
      return {
        seed: sd, cfg, opts, beat, place, foe,
        title: story.title(beat),
        brief: story.brief(beat),
        crawler: C.crawlerParams(sd, cfg, 0),
        scrap: C.scrapParamsFor(sd, cfg),
        boss: C.overlordParams((sd ^ 0x0b055) >>> 0, cfg),
        proto: window.WEAPONS.rollProto(GW.makeRng((sd ^ 0x9ea9) >>> 0))
      };
    };

    /* The loadout carry, same contract as a campaign's. */
    story.carry = null;
    story.take = function (M) {
      const P = M.player, Wp = P.weapon;
      story.carry = {
        weapon: Wp.kind,
        proto: Wp.kind === 'proto' ? Wp.def : null,
        protoRig: Wp.kind === 'proto' ? M.protoRig : null,
        ammo: Wp.ammo,
        spare: Object.assign({}, P.spare),
        buffs: Object.assign({}, P.buffs),
        wardMax: P.wardMax,
        maxHp: P.maxHp,
        hp: Math.max(P.maxHp * 0.4, Math.min(P.maxHp, P.hp + P.maxHp * 0.25))
      };
      return story.carry;
    };
    story.give = function (P, M) {
      const c = story.carry;
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
      if (c.ammo !== undefined) P.weapon.ammo = clamp(c.ammo, 0, P.weapon.def.mag);
    };

    /* ---------------- moving through it ---------------- */

    story.flag = k => !!story.flags[k];

    story.addTrait = function (k) {
      if (!TRAITS[k] || story.traits.indexOf(k) >= 0) return false;
      story.traits.push(k);
      return true;
    };

    /* Every trait's modifiers, rolled up. The mission layer applies
       this the same way it applies a warden's graft. */
    story.mods = function () {
      const m = { dmg: 1, rate: 1, reload: 1, speed: 1, mag: 1, armour: 1,
                  vitals: 0, score: 1, rep: 1, aggro: 1, allies: 0 };
      for (const k of story.traits) {
        const t = TRAITS[k];
        if (!t) continue;
        for (const j in t.mod) {
          if (j === 'vitals' || j === 'allies') m[j] += t.mod[j];
          else m[j] *= t.mod[j];
        }
      }
      return m;
    };

    story.shiftRep = function (facId, by) {
      if (facId === null || facId === undefined) return;
      const scale = by > 0 ? story.mods().rep : 1;
      story.rep[facId] = clamp(story.rep[facId] + by * scale, -6, 6);
      W.factions[facId].rep = story.rep[facId];
    };

    /* Answer a choice. Sets its flag, moves reputation, grants the
       trait, and logs what you did — the log is what the ending is
       written out of. */
    story.choose = function (optId) {
      const beat = story.current();
      if (!beat || beat.type !== 'choice') return false;
      const T = CHOICE_TEMPLATES[beat.template];
      const op = T.opts.find(x => x.id === optId) || T.opts[0];
      story.flags[op.flag] = true;
      if (op.trait) story.addTrait(op.trait);
      for (const who in op.rep) {
        if (who === 'handler') { story.shiftRep(W.handler.faction, op.rep[who]); W.handler.standing += op.rep[who]; }
        else if (who === 'offer') story.shiftRep(beat.offer, op.rep[who]);
        else if (who === 'rival') { W.rival.standing += op.rep[who]; if (op.rep[who] < -2) W.rival.alive = false; }
      }
      story.log.push({ i: beat.i, kind: 'choice', template: beat.template,
                       chose: op.id, line: op.line });
      story.advance();
      return true;
    };

    /* Record how a mission went, and let the play itself grant traits.
       A story that only develops your character at menus is a story
       that is not paying attention to the game. */
    story.finishMission = function (res) {
      const beat = story.current();
      if (!beat || beat.type !== 'mission') return false;
      story.score += res.score || 0;
      story.kills += res.kills || 0;
      story.deaths += res.deaths || 0;
      story.time += res.time || 0;
      story.beatsDone++;

      if (res.deaths === 0 && res.hurt === false) story.addTrait('surgical');
      if (story.deaths >= 6) story.addTrait('stubborn');
      if (res.seconds !== undefined && res.seconds < 45) story.addTrait('quick');
      if (res.kills !== undefined && res.total !== undefined &&
          res.total > 0 && res.kills >= res.total) story.addTrait('thorough');

      /* Killing a faction's people is noticed by that faction, and by
         anyone who hates them. */
      story.shiftRep(beat.foe, -1);
      for (const f of W.factions) {
        if (f.id === beat.foe) continue;
        if (W.relation(f.id, beat.foe) <= -1) story.shiftRep(f.id, +1);
      }

      story.log.push({ i: beat.i, kind: 'mission', n: beat.n,
                       place: beat.place, objective: beat.objective,
                       won: !!res.won, kills: res.kills, deaths: res.deaths });
      story.advance();
      return true;
    };

    story.advance = function () {
      story.at++;
      if (story.at >= story.beats.length) {
        story.at = story.beats.length - 1;
        story.done = true;
        story.won = true;
      }
      /* Scenes have nothing to do; the caller steps past them by
         calling seen(). Missions and choices wait to be answered. */
      return story.current();
    };

    story.seen = function () {
      const b = story.current();
      if (!b || b.type !== 'scene') return false;
      story.log.push({ i: b.i, kind: 'scene', beat: b.kind });
      story.advance();
      return true;
    };

    /* How the run ends, given what was done. Read at the last scene. */
    story.ending = function () {
      const S = W.secret;
      if (story.flag('walk')) {
        return { k: 'walked', title: 'THE DOOR STAYS SHUT',
                 line: 'You left it where it was. Somebody else will open it, and it will not be your name on the file.' };
      }
      if (story.flag('bargain')) {
        return { k: 'bargained', title: 'TERMS',
                 line: 'You came out with something. So did it. Neither of you has said what.' };
      }
      if (S.k === 'you-are-it') {
        return { k: 'burned-self', title: 'THE VITRIOL',
                 line: 'It was in you. Taking it out was the job, and the job is finished.' };
      }
      return { k: 'burned', title: 'SETTLED',
               line: 'The stack is quieter than it was. That is the most anyone here has managed.' };
    };

    /* Everything a save file or a debrief needs, in one object. */
    story.stats = function () {
      return {
        seed: story.seed, missions: story.missions,
        at: story.at, beatsDone: story.beatsDone,
        score: story.score, kills: story.kills, deaths: story.deaths,
        time: story.time,
        traits: story.traits.slice(),
        flags: Object.keys(story.flags),
        rep: story.rep.slice(),
        done: story.done, won: story.won
      };
    };

    return story;
  }

  /* A readable outline. The harness prints it; a session picking this
     work up cold can run it and see whether a story is a story. */
  function outline(story) {
    const W = story.world;
    const L = [];
    let act = 0;
    for (const b of story.beats) {
      if (b.act !== act) { act = b.act; L.push(''); L.push('— ACT ' + act + ': ' + b.actName + ' —'); }
      if (b.type === 'mission') {
        const p = W.placeById(b.place), f = W.facById(b.foe);
        L.push('  [' + String(b.n).padStart(2, '0') + '] ' +
               OBJECTIVES[b.objective].label.padEnd(8) + ' ' + p.name +
               ' (' + p.style + ') vs ' + f.name +
               (b.target ? ' — target ' + W.charById(b.target).name : '') +
               (b.boss ? '  [BOSS]' : ''));
        L.push('       ' + story.brief(b));
      } else if (b.type === 'choice') {
        const c = story.choiceAt(b);
        L.push('  ??  ' + c.prompt);
        for (const op of c.options) L.push('       - ' + op.label + ': ' + op.line);
      } else {
        L.push('  ..  scene: ' + b.kind + ' (' + b.who.join(', ') + ')');
      }
    }
    return L.join('\n');
  }

  return { makeStory, outline, fill,
           OBJECTIVES, OBJ_KEYS, ACTS, CHOICE_TEMPLATES, TRAITS, TRAIT_KEYS };
})();
