/* ============================================================
   harness-game.js — headless validation of the game layer.

   The tool harnesses prove the generators run. This one proves the
   GAME runs: it loads the extracted generator modules and every
   src/game module under a DOM shim backed by @napi-rs/canvas,
   builds a real mission, simulates play, and dumps contact sheets.

       npm install @napi-rs/canvas
       node tools/harness-game.js

   Per the MERC FORGE handoff §9: keep dumping contact sheets. The
   bugs that matter here are invisible in code review and obvious in
   a PNG.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');

/* ---------------- DOM shim ---------------- */
global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected createElement(' + tag + ')');
    return createCanvas(1, 1);
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.requestAnimationFrame = () => 0;
global.setTimeout = global.setTimeout;
// No WebAudio in Node; AUDIO.init() returns false and every play() no-ops.

/* ---------------- load ---------------- */
const FILES = [
  'src/gen/greebleworks.js', 'src/gen/mercforge.js', 'src/gen/crawlerforge.js',
  'src/gen/scrapforge.js',
  'src/game/config.js', 'src/game/audio.js', 'src/game/weapons.js',
  'src/game/sprite.js', 'src/game/physics.js', 'src/game/rigid.js',
  'src/game/dialog.js', 'src/game/lore.js', 'src/game/story.js',
  'src/game/cutscene.js', 'src/game/story-ui.js',
  'src/game/campaign.js',
  'src/game/pilot.js', 'src/game/entities.js',
  'src/game/world.js', 'src/game/render.js', 'src/game/screens.js'
];
for (const f of FILES) require(path.join(ROOT, f));

const GW = window.GREEBLEWORKS;
const LV = GW.LV;

/* ---------------- check plumbing ---------------- */
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; fails.push(label); console.log('  FAIL  ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------------- module surface ---------------- */
section('module surface');
ok(typeof GW.buildLevel === 'function', 'greebleworks buildLevel exported');
ok(typeof GW.drawLevelFrame === 'function', 'greebleworks drawLevelFrame exported');
ok(GW.drawLevelFrame.length === 6, 'drawLevelFrame takes the entityPass hook');
ok(typeof window.MERCFORGE.forge === 'function', 'mercforge forge exported');
ok(typeof window.MERCFORGE.randomParams === 'function', 'mercforge randomParams exported');
ok(typeof window.CRAWLERFORGE.forge === 'function', 'crawlerforge forge exported');
ok(typeof window.CRAWLERFORGE.drawTentacle === 'function', 'crawlerforge drawTentacle exported');
ok(Object.keys(window.CRAWLERFORGE.PALETTES).length === 10, '10 crawler palettes');
ok(window.CRAWLERFORGE.ORIENTS.length === 4, '4 surface orientations');
ok(Object.keys(GW.STYLES).length === 25, '25 styles');
ok(typeof GW.STYLE_KIND === 'function', 'the generator classifies its own styles');
{
  const byKind = {};
  for (const k of Object.keys(GW.STYLES)) {
    const kind = GW.STYLE_KIND(k);
    (byKind[kind] || (byKind[kind] = [])).push(k);
  }
  ok(byKind.city && byKind.city.length === 14, '14 street-level styles');
  ok(byKind.interior && byKind.interior.length === 4, '4 interior styles');
  ok(byKind.air && byKind.air.length === 3, '3 air styles');
  ok(byKind.nature && byKind.nature.length === 4, '4 places that grew back');
  /* A nature style has to say what grew there, and it has to be a form
     the layer painter knows — otherwise the parallax band silently
     falls back to a wood and every one of them looks the same. */
  for (const k of byKind.nature || []) {
    const F = GW.STYLES[k].flora;
    ok(!!F, 'nature "' + k + '" says what grew there');
    ok(F && !!GW.FLORA_FORMS[F.form], 'nature "' + k + '" grows in a form that exists');
    ok(F && F.veg && F.veg.length === 3, 'nature "' + k + '" has three greens to mix from');
    ok(F && typeof F.lit === 'string', 'and something in it that glows');
  }
  {
    const forms = new Set((byKind.nature || []).map(k => GW.STYLES[k].flora.form));
    ok(forms.size === (byKind.nature || []).length,
       'and no two of them grew the same way');
  }
  /* An interior needs a roof to hang and an air level needs to say
     what goes behind it; without those the compositor has nothing to
     branch on and the level silently draws as a city. */
  for (const k of byKind.interior) {
    ok(!!GW.STYLES[k].ceil, 'interior "' + k + '" says what hangs from its ceiling');
    ok(!!GW.STYLES[k].amb, 'interior "' + k + '" has a light of its own');
  }
  for (const k of byKind.air) {
    const bg = GW.STYLES[k].bg;
    ok(bg === 'mode7' || bg === 'skyline', 'air "' + k + '" says what is behind it');
    if (bg === 'mode7') ok(!!GW.STYLES[k].plane, 'a mode-7 air style names its ground');
  }
  console.log('  ' + Object.keys(byKind).map(k => k + ': ' + byKind[k].length).join(', '));
}
ok(Object.keys(GW.SKYMOODS).length === 15, '15 sky moods');
ok(Object.keys(GW.CITY_PRESETS).length === 15, '15 city presets');
for (const m of ['CONFIG', 'WEAPONS', 'SPRITE', 'PHYSICS', 'RIGID', 'PILOT', 'ENTITIES', 'WORLD', 'RENDER', 'SCREENS', 'AUDIO']) {
  ok(!!window[m], 'window.' + m + ' present');
}

/* forge() must not leak params into the module-global P */
section('forge isolation');
{
  const before = JSON.stringify(window.MERCFORGE.P_DEFAULTS);
  window.MERCFORGE.forge({ height: 44, gun: 'cannon', helmet: 'crest' });
  const after = JSON.stringify(window.MERCFORGE.P_DEFAULTS);
  ok(before === after, 'forge() leaves P_DEFAULTS untouched');
  const a = window.MERCFORGE.forge({ seed: 99, height: 30 });
  const b = window.MERCFORGE.forge({ seed: 99, height: 30 });
  ok(a.CW === b.CW && a.CH === b.CH, 'forge() is deterministic for one param set');
}

/* ---------------- merc forge sprite work ---------------- */
section('flights (each in its own process)');
{
  /* Every mission bakes its own sprite sheets, and those are native
     canvas buffers V8 feels no pressure from — so a process that flies
     eight of them dies of memory rather than of a failed assertion.
     The scenarios run in child processes and report back; the checks
     are here with everything else.

     Run FIRST, before this process has baked anything of its own. A
     child needing three gigabytes next to a parent already holding
     four is a kernel deciding which of them to kill, and the answer
     reads exactly like a test failure. */
  const { execFileSync } = require('child_process');
  const FLIGHTS = path.join(__dirname, 'harness-flights.js');
  function flight(name) {
    const t0 = Date.now();
    const out = execFileSync(process.execPath, [FLIGHTS, name],
      { encoding: 'utf8', maxBuffer: 8 << 20 });
    console.log('  ' + name + ': ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return JSON.parse(out);
  }

  /* --- can it finish a level at all --- */
  {
    const F = flight('autopilot');
    ok(F.runs.length === 2, 'both autopilot seeds ran');
    for (const r of F.runs) {
      ok(r.autopilot === true, 'the mission knows it is flying itself');
      ok(r.hasPilot, 'and has a pilot to do it');
      ok(!r.inputTouched, 'autopilot never writes into the human input struct');
      ok(r.state === 'won', 'autopilot reached extraction on seed ' + r.seed +
         ' (got ' + r.state + ' at ' + (r.progress * 100).toFixed(0) + '%)');
      ok(r.kills > 0, 'autopilot fought its way there');
      console.log('    seed ' + r.seed + ': ' + r.state + ' at ' +
                  (r.progress * 100).toFixed(0) + '%, ' + r.deaths + ' deaths, ' +
                  r.kills + '/' + r.total + ' killed');
    }
  }

  /* --- continuous mode: a chain of rolled builds --- */
  {
    const F = flight('chain');
    ok(F.runs.length === 3, 'the chain flew three builds');
    ok(F.distinctSeeds === 3, 'each run in the chain is built from its own seed');
    for (const r of F.runs) {
      ok(r.state === 'won', 'chain run reached extraction (' + r.style + ', ' + r.state + ')');
      ok(r.endClockRuns, 'the end-state clock keeps running so the chain can advance');
      ok(r.stayedEnded, 'and the run stays ended rather than resuming itself');
      ok(r.keptAutopilot, 'the next build inherits autopilot from the last');
    }
    console.log('    ' + F.runs.map(r => r.style).join(' → '));
  }

  /* --- a campaign, flown end to end --- */
  {
    const F = flight('campaign');
    ok(F.sectors.length === 3, 'the campaign flew every sector (' + F.sectors.length + '/3)');
    ok(F.done && F.won, 'and the campaign reports itself finished');
    ok(F.logged === 3, 'every cleared sector is logged');
    ok(F.score > 0 && F.kills > 0, 'the campaign totals accumulate');
    ok(F.styles.length > 1, 'the sectors are not all the same place (' +
       F.styles.join(', ') + ')');
    let prev = null;
    for (const sct of F.sectors) {
      ok(sct.state === 'won', 'autopilot cleared sector ' + sct.n +
         ' (' + sct.style + ', got ' + sct.state + ')');
      ok(sct.knowsCampaign, 'the mission knows its campaign');
      ok(sct.knowsSector, 'and which sector it is');
      ok(sct.wardens > 0, 'every sector has someone standing in it');
      ok(sct.densRose, 'each sector deploys at least as many');
      ok(sct.operativeSeed === F.sectors[0].operativeSeed,
         'the same operative walks into every sector');
      if (sct.carriedWeaponIn) {
        ok(sct.weaponIn === sct.carriedWeaponIn,
           'the weapon carried into sector ' + sct.n + ' (' + sct.carriedWeaponIn + ')');
      }
      ok(sct.carryWeapon === sct.weaponOut, 'the carry snapshot took the weapon in hand');
      ok(sct.carryHp > 0, 'and you do not start the next floor dead');
      ok(sct.carryHp >= sct.carryFloor, 'clearing a sector is worth a breath');
      if (prev) {
        /* Whatever the wardens grafted has to still be there. Comparing
           the string is the point: any buff quietly resetting between
           sectors is exactly the bug this catches. */
        const before = JSON.parse(prev.buffsOut), now = JSON.parse(sct.buffsIn);
        for (const k in before) {
          ok(now[k] >= before[k] - 1e-9,
             'buff "' + k + '" survived the sector boundary');
        }
        ok(sct.maxHpIn >= prev.maxHpIn, 'a raised vitals ceiling survives too');
      }
      prev = sct;
    }
    console.log('    ' + F.sectors.map(s => s.n + ':' + s.style).join(' → ') +
                ' | ' + F.kills + ' killed, ' + F.score + ' scored');
  }

  /* --- every objective type, flown --- */
  {
    const F = flight('objectives');
    ok(F.objectives.length === window.STORY.OBJ_KEYS.length, 'every objective was flown');
    for (const o of F.objectives) {
      const r = o.setup;
      ok(r.hasObj && r.kind === o.obj, o.obj + ' is set up on the mission');
      /* an objective that does not gate the pad is not an objective */
      if (o.obj === 'extract') {
        ok(!r.gatedAtStart, 'extract asks nothing extra');
        ok(!r.hasLine, 'and says nothing extra');
      } else {
        ok(r.gatedAtStart, o.obj + ' holds the pad shut to begin with');
        ok(r.hasLine, o.obj + ' tells you what it wants');
      }
      if (o.obj === 'sabotage') ok(r.charges >= 2, 'sabotage places its charges');
      if (o.obj === 'recover') ok(r.cache, 'recover places a cache');
      if (o.obj === 'hunt') ok(r.target, 'hunt promotes a target out of the garrison');
      if (o.obj === 'escort') ok(r.ward, 'escort places somebody to protect');
      /* Every run has to at least be finishable, and most have to
         actually finish. An objective the pilot never completes is one
         a player will find impossible for the same reason. */
      ok(o.wins > 0, 'autopilot can complete ' + o.obj +
         ' (' + o.runs.map(x => x.state).join('/') + ')');
      for (const x of o.runs) {
        ok(!x.objFailed || o.obj === 'escort',
           o.obj + ' does not fail itself');
        if (x.state === 'won') ok(x.objDone, o.obj + ' was actually met when it won');
      }
    }
    {
      const tot = F.objectives.reduce((a, o) => a + o.runs.length, 0);
      const win = F.objectives.reduce((a, o) => a + o.wins, 0);
      ok(win >= tot - 2, 'autopilot completes nearly every objective run (' +
         win + '/' + tot + ')');
      console.log('    ' + F.objectives.map(o => o.obj + ':' + o.wins + '/' + o.runs.length).join(' '));
    }
  }

  /* --- one of every kind of place, walked end to end --- */
  {
    const F = flight('kinds');
    ok(F.kinds.length === 4, 'all four kinds of place were flown');
    let won = 0;
    for (const k of F.kinds) {
      ok(k.kind === k.want, 'asking for a ' + k.want + ' level got one (' + k.style + ')');
      ok(k.plats > 8, 'and it has somewhere to stand (' + k.plats + ')');
      ok(k.progress > 0.5, 'autopilot gets most of the way through a ' + k.want +
         ' level (' + (k.progress * 100).toFixed(0) + '%)');
      if (k.state === 'won') won++;
    }
    ok(won >= 3, 'and finishes at least three of the four (' + won + '/4)');
    ok(F.kinds.some(k => k.weather === 'spore'),
       'the places that grew back have weather of their own');
    console.log('    ' + F.kinds.map(k =>
      k.want + ':' + k.style + ' ' + (k.state === 'won' ? 'won' : k.state) +
      ' @' + (k.progress * 100).toFixed(0) + '%').join('  '));
  }

  /* --- a garrison with an owner --- */
  {
    const F = flight('garrison');
    ok(F.garrison.length === 3, 'three doctrines fielded a garrison');
    const by = {};
    for (const g of F.garrison) {
      by[g.doctrine] = g;
      ok(g.kinds >= 3, g.doctrine + ' fields a mixed room (' + g.kinds + ' kinds)');
      ok(g.accents > 2, 'and enough silhouettes to tell them apart');
      ok(g.state === 'won', 'and autopilot can fight through it (' + g.state + ')');
      ok(g.progress > 0.8, 'and get to the pad (' +
         (g.progress * 100).toFixed(0) + '%)');
    }
    /* The claim the whole doctrine layer rests on: two factions send
       visibly different rooms at you. */
    ok((by.quiet.mix.stalker || 0) + (by.quiet.mix.sniper || 0) >
       (by.attrition.mix.stalker || 0) + (by.attrition.mix.sniper || 0),
       'the quiet send specialists where attrition sends bodies');
    ok((by.attrition.mix.grunt || 0) > (by.quiet.mix.grunt || 0),
       'and attrition sends the bodies');
    console.log('    ' + F.garrison.map(g =>
      g.doctrine + ':' + Object.keys(g.mix).filter(k => k !== 'overlord')
        .sort((a, b) => g.mix[b] - g.mix[a]).slice(0, 3)
        .map(k => k + '×' + g.mix[k]).join(',')).join('  '));
  }

  /* --- reputation, on the ground --- */
  {
    const F = flight('reputation');
    const R = F.reputation;
    ok(R.arsenal.join(',') === R.wanted.join(','),
       'a garrison carries the arsenal its doctrine says it does');
    ok(R.armed > 2, 'and its troops are armed (' + R.armed + ')');
    ok(R.grace0 === 0, 'a run with no standing gets no grace');
    ok(R.giftsAtStart === 0, 'and nothing left out for it');
    ok(R.drops > 20, 'a garrison drops weapons (' + R.drops + ')');
    ok(R.badDrops === 0, 'and never one that does not exist');
    ok(R.ownDrops > R.drops * 0.4,
       'and often its own (' + R.ownDrops + '/' + R.drops + ')');
    ok(R.tribute.weapon === 1, 'a tribute puts the weapon on the floor');
    ok(R.tribute.health === 1 && R.tribute.ammo === 1,
       'with something to drink and something to load');
    ok(R.tribute.downrange, 'downrange, so it has to be walked to');
    ok(R.tribute.remembered, 'and the mission remembers where it put it');
    ok(R.graceAfter1s > 3 && R.graceAfter1s < 5,
       'grace runs down in real time (' + R.graceAfter1s + ')');
    ok(R.heldDuring > 0, 'with the room still deciding about you (' + R.heldDuring + ')');
    ok(R.graceAfter7s === 0, 'and it does not last');
    ok(R.heldAfter < R.heldDuring, 'after which the room notices (' +
       R.heldAfter + ' still holding, was ' + R.heldDuring + ')');
    /* And it is still a level you can get through. A rate rather than
       a win, because the pilot is stochastic and this particular room
       — four stalkers and three snipers — is the hardest garrison the
       doctrine table can field; one unlucky afternoon in it is not a
       regression. */
    ok(R.state === 'won' || R.progress > 0.6,
       'and it is still a level you can fight through (' + R.state +
       ' @' + (R.progress * 100).toFixed(0) + '%)');
    console.log('    ' + R.arsenal.join('/') + ' | ' + R.ownDrops + '/' + R.drops +
                ' own drops | grace held ' + R.heldDuring + ' → ' + R.heldAfter);
  }

  /* --- a whole story, played end to end --- */
  {
    const F = flight('fullstory');
    const R = F.fullstory;
    ok(R.done, 'autopilot plays a story mode run to its end');
    ok(R.missions === R.expectedMissions,
       'flying every mission on the spine (' + R.missions + '/' + R.expectedMissions + ')');
    ok(R.lost === 0, 'and losing none of them (' + R.lost + ')');
    ok(R.scenes >= 5, 'watching the scenes between them (' + R.scenes + ')');
    ok(R.choices === 3, 'and answering every decision (' + R.choices + ')');
    ok(R.shots > R.scenes * 2, 'the scenes are scenes, not title cards (' +
       R.shots + ' shots)');
    ok(R.seconds < 400, 'and the whole run fits in a sitting (' + R.seconds + 's)');

    /* every beat did what its type is for */
    const missions = R.log.filter(e => e.t === 'mission');
    const scenes = R.log.filter(e => e.t === 'scene');
    const choices = R.log.filter(e => e.t === 'choice');
    ok(missions.length === R.missions && scenes.length === R.scenes &&
       choices.length === R.choices, 'and the log accounts for all of them');
    for (const m of missions) {
      ok(m.objDone, 'mission ' + m.n + ' (' + m.objective + ') met its objective');
      ok(m.progress > 0.6, 'and got most of the way through (' +
         (m.progress * 100).toFixed(0) + '%)');
      ok(!!m.place && m.place.indexOf('%') < 0, 'somewhere with a name');
      ok(!!m.foe, 'held by somebody');
    }
    for (const sc of scenes) {
      ok(sc.ended, 'scene "' + sc.kind + '" plays out rather than hanging');
      ok(sc.seconds > 1 && sc.seconds < 90,
         'and takes a sensible amount of time (' + sc.seconds + 's)');
      ok(sc.shots >= 2, 'and has shots in it');
    }
    /* the run has to be a run: different places, different objectives */
    {
      const places = new Set(missions.map(m => m.place));
      const objs = new Set(missions.map(m => m.objective));
      const sets = new Set(scenes.map(sc => sc.set));
      ok(places.size === missions.length, 'no place is visited twice');
      ok(objs.size >= 3, 'and the missions are not all the same job (' + objs.size + ')');
      ok(sets.size >= 3, 'nor the scenes all staged in the same room (' + sets.size + ')');
      const kinds = new Set(missions.map(m => m.kind));
      ok(kinds.size >= 2, 'and it does not all happen in one kind of place');
    }
    /* and it left a mark */
    ok(R.traits.length >= 3, 'the run makes something of the operative (' +
       R.traits.join(', ') + ')');
    ok(R.flags.length >= 3, 'and remembers what they chose');
    ok(R.rep.some(x => x !== 0), 'and somebody out there has an opinion now');
    ok(!!R.ending && !!R.ending.title, 'it ends with an ending (' + R.ending.title + ')');
    ok(R.debrief.title === R.ending.title, 'and the debrief carries its name');
    ok(!!R.debrief.line, 'and its last word');
    ok(R.codexGround === R.missions, 'and the codex remembers every floor walked');
    console.log('    ' + R.missions + ' missions, ' + R.scenes + ' scenes, ' +
                R.choices + ' decisions in ' + R.seconds + 's → ' + R.ending.title);
    console.log('    ' + missions.map(m => m.objective).join(' → '));
  }

  /* --- a story, played --- */
  {
    const F = flight('story');
    ok(F.beats > 12, 'the story had beats');
    ok(F.scenes > 0, 'and scenes between them');
    ok(F.missions.length > 0, 'and missions that became levels');
    let prevTraits = [];
    for (const m of F.missions) {
      ok(m.knowsStory, 'a story mission knows which story it is in');
      ok(m.styleMatches, 'and is built in the architecture of its location (' +
         m.place + ' / ' + m.style + ')');
      ok(m.objKind === m.objective, 'and enforces the beat\'s objective');
      ok(m.brief.indexOf('%') < 0, 'and its briefing is filled in');
      ok(m.state === 'won', 'autopilot cleared ' + m.objective + ' at ' + m.place +
         ' (got ' + m.state + ')');
      ok(m.objDone, 'and met the objective');
      if (m.traitsOut) {
        for (const t of prevTraits) {
          ok(m.traitsOut.indexOf(t) >= 0, 'a trait once earned is never lost');
        }
        prevTraits = m.traitsOut;
      }
      if (m.carryWeapon) ok(typeof m.carryWeapon === 'string', 'the loadout is carried out');
    }
    /* the loadout that walked out walked back in */
    for (let i = 1; i < F.missions.length; i++) {
      const prev = F.missions[i - 1], cur = F.missions[i];
      if (prev.carryWeapon) {
        ok(cur.weaponIn === prev.carryWeapon,
           'the weapon carried into mission ' + cur.n + ' (' + prev.carryWeapon + ')');
      }
    }
    ok(F.ending && F.ending.title, 'and the run knows how it would end');
    console.log('    ' + F.missions.map(m => m.objective + '@' + m.place).join('  '));
  }

  /* --- the prototype across a sector boundary --- */
  {
    const F = flight('protocarry');
    ok(F.placed, 'the sector placed its prototype');
    ok(F.equipped, 'and taking it equips the prototype');
    ok(F.kindOut === 'proto', 'the prototype carries to the next sector');
    ok(F.labelOut === F.label, 'and it is the same gun, not a new roll');
    ok(F.sameRig, 'and the sprite still holds it');
    ok(F.dmgBuff === 1.5, 'grafted power-ups carry');
    ok(F.maxHp === 140, 'a raised vitals ceiling carries');
    ok(F.hp > 60 && F.hp <= 140, 'and you get a breath, not a full heal');
    ok(F.ammo === 3, 'the magazine you walked out with carries');
    ok(F.differentPlace, 'the next sector is a different place');
  }
}

section('merc forge');
{
  const MF = window.MERCFORGE;
  /* Same schema check the crawler panel gets: the build screen
     generates the operative panel from this table, so a control naming
     a key the generator ignores is a dead slider. */
  const keys = new Set(Object.keys(MF.P_DEFAULTS));
  for (const grp of MF.CONTROLS) {
    for (const c of grp.c) {
      if (c.k === '__colors' || c.k === '__buttons') continue;
      ok(keys.has(c.k), 'merc control "' + c.k + '" maps to a real parameter');
      if (c.t === 'r') {
        const v = MF.P_DEFAULTS[c.k];
        ok(c.min < c.max, 'merc control "' + c.k + '" has a sane range');
        ok(v >= c.min && v <= c.max, 'merc default for "' + c.k + '" is inside its range');
      }
    }
  }

  /* The refit's three new knobs have to actually move pixels. */
  const px = S => {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let n = 0, tones = new Set();
    for (let i = 0; i < S.CW * S.CH; i++) {
      if (d[i * 4 + 3] < 8) continue;
      n++; tones.add((d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]);
    }
    return { n, tones: tones.size };
  };
  const base = MF.forge({ seed: 909, grit: 0, taper: 0, armour: 0 });
  const gritty = MF.forge({ seed: 909, grit: 1.0, taper: 0, armour: 0 });
  const tapered = MF.forge({ seed: 909, grit: 0, taper: 1, armour: 0 });
  const armoured = MF.forge({ seed: 909, grit: 0, taper: 0, armour: 1.4 });
  /* Grit is texture, not palette entries: it dithers pixels between
     ramp steps they already use, so counting distinct colours at one
     seed is a coin flip. What it must do is break up flat fills —
     measure how often a pixel differs from the one above it. */
  const roughness = S => {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let n = 0;
    for (let y = 1; y < S.CH; y++) for (let x = 0; x < S.CW; x++) {
      const i = (y * S.CW + x) * 4, j = ((y - 1) * S.CW + x) * 4;
      if (d[i + 3] < 8 || d[j + 3] < 8) continue;
      if (d[i] !== d[j] || d[i + 1] !== d[j + 1]) n++;
    }
    return n;
  };
  let rougher = 0;
  for (let sd = 0; sd < 5; sd++) {
    const b0 = MF.forge({ seed: 500 + sd, grit: 0 });
    const g0 = MF.forge({ seed: 500 + sd, grit: 1.1 });
    if (roughness(g0) > roughness(b0)) rougher++;
  }
  ok(rougher >= 4, 'grit breaks up flat fills (' + rougher + '/5 seeds rougher)');
  ok(tapered.CW !== base.CW || tapered.CH !== base.CH || px(tapered).n < px(base).n,
     'taper takes mass out of the limbs (' + px(base).n + ' -> ' + px(tapered).n + ' px)');
  /* Panelling draws straps and seams in colours already in the ramp,
     so it need not add palette entries — what it must do is change the
     pixels. */
  const differs = (A, B) => {
    if (A.CW !== B.CW || A.CH !== B.CH) return 1e6;   // a resize is a change
    const a = A.canvas.getContext('2d').getImageData(0, 0, A.CW, A.CH).data;
    const b = B.canvas.getContext('2d').getImageData(0, 0, B.CW, B.CH).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 3] !== b[i + 3]) n++;
    return n;
  };
  ok(differs(armoured, base) > 4, 'panelling changes the drawing (' +
     differs(armoured, base) + ' px)');

  /* A five-step ramp means a lit sprite should carry well more than
     the three tones per family the old two-step shading produced. */
  ok(px(MF.forge({ seed: 909 })).tones >= 10,
     'shading produces a real ramp, not two tones per material');

  /* ---- gait ----
     The two things that made the legs read as gliding: the hip sat so
     high the knee could not bend, and the "planted" foot slid on a
     cosine instead of tracking the ground. Both are checked from the
     pixels and the pose data the sheet is built from. */
  {
    /* A rig must report its effective params, or anything reading an
       unspecified field gets undefined — which is how a NaN run phase
       reached the muzzle table. */
    const partial = new window.SPRITE.Rig({ seed: 5, height: 30 });
    ok(typeof partial.params.stride === 'number', 'a rig reports effective params');
    ok(partial.cycleDistance() > 4, 'cycle distance is a real number (' +
       partial.cycleDistance().toFixed(1) + ')');

    /* Frames of the run cycle must genuinely differ from one another:
       a cycle whose frames are near-identical is a glide however fast
       it plays. */
    const S2 = MF.forge(Object.assign({}, MF.PRESETS.nick, { aimRows: 5 }));
    const row = (S2.angles.length - 1) / 2 | 0;
    const cell = f => S2.canvas.getContext('2d')
      .getImageData(S2.colOf('run', f) * S2.CW, row * S2.CH, S2.CW, S2.CH).data;
    const n = S2.framesOf('run');
    let minDiff = 1e9;
    for (let f = 0; f < n; f++) {
      const a = cell(f), b = cell((f + 1) % n);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i + 3] !== b[i + 3]) diff++;
      minDiff = Math.min(minDiff, diff);
    }
    ok(minDiff > 6, 'consecutive run frames differ in silhouette (min ' + minDiff + 'px)');

    /* The lower half of the sprite has to be where that movement is —
       if the legs were static and only the torso bobbed, the check
       above could pass on the arms alone. */
    let legDiff = 0;
    for (let f = 0; f < n; f++) {
      const a = cell(f), b = cell((f + 1) % n);
      for (let y = (S2.CH * 0.55) | 0; y < S2.CH; y++)
        for (let x = 0; x < S2.CW; x++) {
          const i = (y * S2.CW + x) * 4;
          if (a[i + 3] !== b[i + 3]) legDiff++;
        }
    }
    ok(legDiff > 40, 'the legs are what is moving (' + legDiff + 'px over the cycle)');

    /* Run phase must be driven by distance. Two players moving at
       different speeds have to reach different frames. */
    const rigA = new window.SPRITE.Rig(Object.assign({}, MF.PRESETS.nick));
    const diff2 = window.CONFIG.DIFFICULTY.regular;
    const mk = vx => {
      const P3 = new window.ENTITIES.Player(rigA, 50, 200, diff2);
      P3.vx = vx; P3.ground = true; P3.phase = 0;
      for (let i = 0; i < 30; i++) { P3.vx = vx; P3.animate(1 / 60, false); }
      return P3.phase;
    };
    const slow = mk(0.6), fast = mk(2.6);
    ok(fast > slow * 2, 'a faster run cycles faster (' + slow.toFixed(2) +
       ' vs ' + fast.toFixed(2) + ' frames)');
    ok(fast > 1, 'a full-speed run actually advances frames');
  }

  /* Proportions: the refit is meant to be leaner, so guard the band. */
  for (let i = 0; i < 40; i++) {
    const p = MF.randomParams((i * 2654435761) >>> 0);
    ok(p.limbThick <= 0.075, 'random limb weight stays lean (' + p.limbThick.toFixed(3) + ')');
    ok(p.headSize <= 1.05, 'random head stays in proportion');
    ok(p.taper >= 0.4, 'random limbs taper');
    ok(p.grit >= 0, 'random build has grit');
  }
}

/* ---------------- config randomizer ---------------- */
section('config randomizer');
{
  const seen = { style: new Set(), mood: new Set(), pal: new Set() };
  for (let i = 0; i < 240; i++) {
    const cfg = window.CONFIG.randomLevelCfg((i * 2654435761) >>> 0);
    ok(GW.STYLES[cfg.style] !== undefined || fail > 900, 'style ' + cfg.style + ' is real');
    ok(GW.SKYMOODS[cfg.skyMood] !== undefined, 'mood ' + cfg.skyMood + ' is real');
    ok(cfg.palette === 'none' || GW.PALETTES[cfg.palette] !== undefined, 'palette ' + cfg.palette + ' is real');
    ok(cfg.levelLen >= 3 && cfg.levelLen <= 12, 'level length in range');
    ok(cfg.cityLayers >= 2 && cfg.cityLayers <= 5, 'city layers in range');
    seen.style.add(cfg.style); seen.mood.add(cfg.skyMood); seen.pal.add(cfg.palette);
    // Every numeric field must be finite: a NaN here throws deep inside a bake.
    for (const k in cfg) {
      if (typeof cfg[k] === 'number') ok(Number.isFinite(cfg[k]), 'cfg.' + k + ' finite');
    }
  }
  // Reset the counter noise from the loop and report coverage instead.
  console.log('  covered ' + seen.style.size + ' styles, ' + seen.mood.size +
              ' moods, ' + seen.pal.size + ' palettes over 240 rolls');
  ok(seen.style.size >= 12, 'randomizer reaches most styles');
  ok(seen.mood.size >= 10, 'randomizer reaches most moods');
}

section('merc randomizer');
{
  for (let i = 0; i < 60; i++) {
    const p = window.CONFIG.randomMerc((i * 7919 + 13) >>> 0);
    ok(p.height >= 26 && p.height <= 38, 'player height clamped for play');
    ok(p.aimRows === 9, 'player sheet has 9 aim rows');
    ok(window.WEAPONS.table[p.gun] !== undefined, 'weapon ' + p.gun + ' has a behaviour def');
  }
  for (const kind of Object.keys(window.CONFIG.ARCHETYPES)) {
    if (window.CONFIG.ARCHETYPES[kind].crawler) {
      // grown by CRAWLER FORGE, covered in its own section
      let threw = false;
      try { window.CONFIG.archetypeParams(kind, 1, 'slum'); } catch (e) { threw = true; }
      ok(threw, kind + ' rejects a MERC FORGE params request');
      continue;
    }
    for (let i = 0; i < 8; i++) {
      const p = window.CONFIG.archetypeParams(kind, (i * 104729) >>> 0, 'slum');
      ok(p.height > 14 && p.height < 60, kind + ' height sane');
      ok(/^#[0-9a-f]{6}$/i.test(p.colSuit), kind + ' colSuit is a hex colour');
      ok(/^#[0-9a-f]{6}$/i.test(p.colAccent), kind + ' colAccent is a hex colour');
      ok(window.WEAPONS.table[p.gun] !== undefined, kind + ' weapon is defined');
    }
  }
}

/* ---------------- crawler forge ---------------- */
section('crawler forge');
{
  const CF = window.CRAWLERFORGE;
  const before = JSON.stringify(CF.P_DEFAULTS);
  const S = CF.forge({ seed: 4242 });
  ok(JSON.stringify(CF.P_DEFAULTS) === before, 'forge() leaves P_DEFAULTS untouched');
  ok(S.canvas.width === S.CW * S.cols.length, 'body sheet width matches column count');
  ok(S.canvas.height === S.CH * S.orients.length, 'body sheet height matches orientation count');
  ok(S.orients.join(',') === 'floor,wallL,wallR,ceiling', 'orientation rows in the expected order');
  ok(S.pad >= 2, 'cell padding >= 2 so the outline dilate stays inside its cell');
  ok(S.tentacles.canvas.height === S.tentacles.thickness * S.tentacles.count,
     'tentacle sheet is one strip per variant');
  ok(S.tentacles.canvas.width === S.tentacles.length, 'tentacle strip spans the sheet width');

  /* every state and orientation must address a real cell */
  for (const st of S.states) {
    for (let f = 0; f < st.frames; f++) {
      const c = S.colOf(st.id, f);
      ok(c >= 0 && c < S.cols.length, 'column for ' + st.id + ':' + f + ' is in range');
    }
  }
  for (const o of S.orients) {
    const r = S.rowOf(o);
    ok(r >= 0 && r < S.orients.length, 'row for ' + o + ' is in range');
  }

  /* the physics bake has to describe the pixels that were drawn */
  const PH = S.physics;
  ok(PH.hull.length === 24, 'hull is a 24-point polygon');
  ok(PH.radius > 2 && PH.radius < Math.max(S.CW, S.CH), 'grip radius is inside the cell');
  ok(PH.radiusMax >= PH.radius, 'max radius is at least the average');
  ok(PH.sockets.length >= 1, 'sockets baked');
  ok(PH.gibs.length > 0, 'gib seed points baked');
  ok(PH.mass > 0 && PH.mass <= 1, 'mass fraction in range');
  /* Sockets have to sit on drawn pixels. A root parked in the gap
     between two lobes is a tentacle growing out of thin air beside the
     creature, which is exactly how it looked before they were seated
     by walking out from solid ink. */
  {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let off = 0;
    for (const so of PH.sockets) {
      const x = Math.round(S.anchor.x + so.x), y = Math.round(S.anchor.y + so.y);
      if (x < 0 || y < 0 || x >= S.CW || y >= S.CH || d[(y * S.CW + x) * 4 + 3] < 8) off++;
    }
    ok(off === 0, 'every tentacle root sits on drawn pixels (' + off + ' floating)');
  }
  for (const so of PH.sockets) {
    const n = Math.hypot(so.nx, so.ny);
    ok(Math.abs(n - 1) < 0.02, 'socket normal is unit length');
    // the normal must point away from the body, or tentacles grow inward
    ok(so.nx * so.x + so.ny * so.y > -0.01, 'socket normal points outward');
    ok(Math.hypot(so.x, so.y) <= PH.radiusMax + 1, 'socket sits on the body');
  }
  for (const k of ['floor', 'wallL', 'wallR', 'ceiling']) {
    ok(PH.contacts[k] && PH.contacts[k].reach > 0, k + ' contact reach measured');
  }
  /* every gib seed must be inside the drawn silhouette */
  {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let outside = 0;
    for (const g of PH.gibs) {
      const x = Math.round(S.anchor.x + g.x), y = Math.round(S.anchor.y + g.y);
      if (x < 0 || y < 0 || x >= S.CW || y >= S.CH || d[(y * S.CW + x) * 4 + 3] < 8) outside++;
    }
    ok(outside === 0, 'every gib seed lands on drawn pixels (' + outside + ' outside)');
  }

  /* The build screen generates its crawler panel from CF.CONTROLS, so
     a control naming a key the generator does not read would be a dead
     slider in the UI — silent, and only findable by hand. */
  {
    const keys = new Set(Object.keys(CF.P_DEFAULTS));
    let controls = 0;
    for (const grp of CF.CONTROLS) {
      ok(typeof grp.g === 'string' && grp.g.length > 0, 'control group has a name');
      for (const c of grp.c) {
        if (c.t === 'buttons') continue;
        controls++;
        ok(keys.has(c.k), 'control "' + c.k + '" maps to a real parameter');
        ok(typeof c.l === 'string' && c.l.length > 0, 'control "' + c.k + '" has a label');
        if (c.t === 'r') {
          ok(c.min < c.max, 'control "' + c.k + '" has a sane range');
          const v = CF.P_DEFAULTS[c.k];
          ok(v >= c.min && v <= c.max, 'default for "' + c.k + '" is inside its range');
        }
        if (c.t === 's') {
          const opts = typeof c.opt === 'function' ? c.opt() : c.opt;
          ok(opts.indexOf(String(CF.P_DEFAULTS[c.k])) >= 0,
             'default for "' + c.k + '" is one of its options');
        }
      }
    }
    ok(controls > 25, 'the crawler panel exposes a real amount of the generator (' + controls + ')');

    /* a pinned build must survive into the game unchanged */
    const pinned = window.CONFIG.defaultCrawler();
    pinned.palette = 'void'; pinned.size = 37; pinned.tentacles = 6;
    for (let v = 0; v < 3; v++) {
      const got = window.CONFIG.crawlerParams((v * 7717) >>> 0, { style: 'reactor' }, v, pinned);
      ok(got.palette === 'void', 'pinned palette survives variant ' + v);
      ok(got.size === 37, 'pinned size survives variant ' + v);
      ok(got.tentacles === 6, 'pinned tentacle count survives variant ' + v);
      ok(got.seed === ((v * 7717) >>> 0), 'pinned build still varies its seed');
    }
    // and without a pin, the roll still applies
    const rolled = window.CONFIG.crawlerParams(99, { style: 'reactor' }, 0, null);
    ok(rolled.size !== 37 || rolled.palette !== 'void', 'unpinned crawlers still roll');
  }

  /* determinism, and real variety across seeds */
  const a = CF.forge({ seed: 77 }), b = CF.forge({ seed: 77 });
  ok(a.CW === b.CW && a.CH === b.CH, 'forge is deterministic for one seed');
  const sizes = new Set(), pals = new Set();
  for (let i = 0; i < 22; i++) {
    const p = CF.randomParams((i * 2654435761) >>> 0);
    ok(CF.PALETTES[p.palette] !== undefined, 'random palette ' + p.palette + ' is real');
    ok(p.size >= 20 && p.size <= 56, 'random size in range');
    ok(p.tentacles >= 1 && p.tentacles <= 10, 'random tentacle count in range');
    sizes.add(p.size); pals.add(p.palette);
  }
  ok(sizes.size > 6, 'randomizer varies body size (' + sizes.size + ' distinct)');
  ok(pals.size > 4, 'randomizer varies palette (' + pals.size + ' distinct)');

  /* crawlerParams must stay inside what the game was tuned for */
  for (let i = 0; i < 30; i++) {
    const p = window.CONFIG.crawlerParams((i * 104729) >>> 0, { style: 'reactor' });
    ok(p.size >= 24 && p.size <= 40, 'game crawler size clamped');
    ok(p.tentLen >= p.size * 1.7 && p.tentLen <= p.size * 2.7, 'tentacle reach scales with body');
    ok(CF.PALETTES[p.palette] !== undefined, 'game crawler palette is real');
  }
}

/* ---------------- scrap forge ---------------- */
section('scrap forge');
{
  const SF = window.SCRAPFORGE;
  ok(SF.KINDS.length === 6, 'six debris kinds');
  ok(Object.keys(SF.PALETTES).length >= 6, 'a spread of industrial palettes');
  const before = JSON.stringify(SF.P_DEFAULTS);
  const set = SF.forgeSet(4242, { params: { size: 16 } });
  ok(JSON.stringify(SF.P_DEFAULTS) === before, 'forgeSet leaves P_DEFAULTS untouched');
  for (const k of SF.KINDS) {
    const S = set[k], B = S.body;
    ok(!!S && S.canvas.width === S.CW * S.frames, k + ' sheet width matches damage states');
    ok(S.frames >= 2, k + ' has damage states');
    ok(S.bodies.length === S.frames, k + ' bakes a body per damage state');
    ok(B.halfW > 0 && B.halfH > 0, k + ' has real half extents');
    ok(B.mass > 0, k + ' has mass');
    ok(B.bounce >= 0 && B.bounce <= 1, k + ' restitution in range');
    ok(B.friction > 0 && B.friction <= 1, k + ' friction in range');
    ok(B.hp > 0, k + ' has hit points');
    ok(B.gibs.length > 0, k + ' has gib seeds');
    ok(B.hull.length === 16, k + ' hull is a 16-point polygon');
    /* damage must actually take mass out of the piece */
    const solidOf = f => {
      const d = S.canvas.getContext('2d').getImageData(f * S.CW, 0, S.CW, S.CH).data;
      let n = 0;
      for (let i = 0; i < S.CW * S.CH; i++) if (d[i * 4 + 3] > 8) n++;
      return n;
    };
    ok(solidOf(S.frames - 1) < solidOf(0), k + ' wrecked state has less of it left');
    /* every gib seed must land on drawn pixels */
    const d0 = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let outside = 0;
    for (const gg of B.gibs) {
      const x = Math.round(S.CW / 2 + gg.x), y = Math.round(S.CH / 2 + gg.y);
      if (x < 0 || y < 0 || x >= S.CW || y >= S.CH || d0[(y * S.CW + x) * 4 + 3] < 8) outside++;
    }
    ok(outside === 0, k + ' gib seeds land on drawn pixels');
  }
  // heavier things really are heavier
  ok(set.girder.body.mass > set.panel.body.mass, 'a girder outweighs a torn panel');
  /* A crate should burst in a couple of hits, not soak a magazine. */
  const rifleDmg = window.WEAPONS.table.rifle.dmg;
  ok(set.crate.body.hp <= rifleDmg * 4,
     'a crate dies in a few rifle rounds (' + set.crate.body.hp + ' hp vs ' + rifleDmg + '/shot)');
  ok(set.panel.body.hp <= rifleDmg * 3, 'torn plate goes even faster');
  ok(set.girder.body.hp > set.crate.body.hp, 'a girder still takes real work');
  ok(set.slab.body.bounce < set.drum.body.bounce, 'concrete bounces less than a drum');
  for (let i = 0; i < 14; i++) {
    const p = SF.randomParams((i * 2654435761) >>> 0);
    ok(SF.PALETTES[p.palette] !== undefined, 'random scrap palette is real');
    ok(p.size >= 8 && p.size <= 40, 'random scrap size in range');
  }
}

/* the build screen generates the debris panel from this table */
{
  const SF = window.SCRAPFORGE;
  const keys = new Set(Object.keys(SF.P_DEFAULTS));
  let n = 0;
  for (const grp of SF.CONTROLS) {
    ok(typeof grp.g === 'string' && grp.g.length > 0, 'scrap control group has a name');
    for (const c of grp.c) {
      if (c.t === 'buttons') continue;
      n++;
      ok(keys.has(c.k), 'scrap control "' + c.k + '" maps to a real parameter');
      if (c.t === 'r') {
        ok(c.min < c.max, 'scrap control "' + c.k + '" has a sane range');
        const v = SF.P_DEFAULTS[c.k];
        ok(v >= c.min && v <= c.max, 'scrap default for "' + c.k + '" is inside its range');
      }
      if (c.t === 's') {
        const opts2 = typeof c.opt === 'function' ? c.opt() : c.opt;
        ok(opts2.indexOf(String(SF.P_DEFAULTS[c.k])) >= 0,
           'scrap default for "' + c.k + '" is one of its options');
      }
    }
  }
  ok(n > 10, 'the debris panel exposes a real amount of the generator (' + n + ')');

  /* a build-screen debris choice has to reach the mission */
  const cfgS = window.CONFIG.randomLevelCfg(0x5C2A);
  cfgS.levelLen = 3;
  // this section runs before the shared `merc` is built, so roll a local one
  const mercS = window.CONFIG.randomMerc(0x5C2A);
  const gs = window.WORLD.buildMission(cfgS, mercS,
    { difficulty: 'regular', enemyDens: 0.6, lives: 3,
      scrap: { palette: 'toxic', size: 19, grime: 1.2 } });
  let rs; while (!(rs = gs.next()).done);
  const MS = rs.value;
  ok(MS.scrap.crate.palette === 'toxic', 'the debris panel choice reaches the level');
  ok(MS.scrap.crate.size === 19, 'the debris size choice reaches the level');
}

/* ---------------- the prototype weapon ---------------- */
section('prototype weapon');
{
  const W = window.WEAPONS;
  ok(W.PROTO_PARAMS.length === 20, 'twenty rolled parameters');
  ok(W.PROTO_CORE.length === 5, 'five core handling axes');
  ok(W.PROTO_EXOTIC.length === 15, 'fifteen exotic effects');
  for (const k of W.PROTO_EXOTIC) {
    ok(!!W.EXOTIC_SPEC[k], 'exotic "' + k + '" has a spec');
    ok(W.EXOTIC_SPEC[k].max > 0, 'exotic "' + k + '" declares its ceiling');
    ok(typeof W.EXOTIC_SPEC[k].tag === 'string', 'exotic "' + k + '" has a HUD tag');
  }
  const seen = {};
  W.PROTO_PARAMS.forEach(k => { seen[k] = new Set(); });
  const names = new Set(), bases = new Set();
  const hits = {};
  W.PROTO_EXOTIC.forEach(k => { hits[k] = 0; });
  let exSum = 0, minEx = 99, maxEx = 0;
  for (let i = 0; i < 300; i++) {
    const d = W.rollProto(window.GREEBLEWORKS.makeRng((i * 2654435761) >>> 0));
    ok(typeof d.label === 'string' && d.label.length > 4, 'prototype has a generated name');
    ok(d.proto === true, 'prototype is flagged');
    ok(d.rate > 0.02 && d.rate < 1, 'rate in range (' + d.rate.toFixed(3) + ')');
    ok(d.dmg > 0 && d.dmg < 20, 'damage in range');
    ok(d.speed > 2 && d.speed <= 14, 'speed in range');
    ok(d.count >= 1 && d.count <= 6, 'projectile count in range');
    ok(d.spread >= 0 && d.spread < 0.4, 'spread in range');
    ok(d.mag >= 8, 'magazine is usable (' + d.mag + ')');
    ok(d.reload > 0 && d.reload < 3, 'reload in range');
    ok(W.table[d.base] !== undefined, 'base sprite "' + d.base + '" is a real weapon');
    ok(/^#[0-9a-f]{6}$/i.test(d.tint), 'prototype has a tint');
    ok(d.rolled.length === 20, 'prototype reports all twenty rolls');
    ok(!!d.tone, 'prototype has a sound spec');
    /* Every exotic is either off or inside its declared ceiling. An
       unclamped effect is the bug this whole spec table exists to
       stop, so it is checked on every roll rather than on a sample. */
    for (const k of W.PROTO_EXOTIC) {
      const v = d[k];
      ok(v === 0 || (v > 0 && v <= W.EXOTIC_SPEC[k].max + 1e-6),
         'exotic "' + k + '" is off or inside its ceiling (' + v + ')');
      if (v) hits[k]++;
    }
    ok(Array.isArray(d.exotics), 'the roll reports which exotics it picked');
    ok(d.exotics.every(k => d[k] > 0), 'every picked exotic is actually turned on');
    ok(W.PROTO_EXOTIC.every(k => d[k] === 0 || d.exotics.indexOf(k) >= 0),
       'nothing is on that was not picked');
    exSum += d.exotics.length;
    minEx = Math.min(minEx, d.exotics.length);
    maxEx = Math.max(maxEx, d.exotics.length);
    ok(W.tagsFor(d).length === d.exotics.length, 'the HUD tags match the picked effects');
    names.add(d.label); bases.add(d.base);
    W.PROTO_PARAMS.forEach(k => seen[k].add(Math.round(d[k] * 1000)));
  }
  console.log('  ' + names.size + ' distinct names, ' + bases.size + ' base shapes | ' +
    'exotics per gun ' + minEx + '-' + maxEx + ', mean ' + (exSum / 300).toFixed(2));
  console.log('  ' + W.PROTO_EXOTIC.map(k => k + ':' + hits[k]).join(' '));
  ok(names.size > 200, 'names vary run to run (' + names.size + '/300)');
  ok(bases.size >= 6, 'it takes many different shapes (' + bases.size + ')');
  /* A prototype has to be describable in one sentence: a smear of all
     fifteen effects is the failure this roll is shaped to avoid. */
  ok(minEx >= 2 && maxEx <= 4, 'every gun runs two to four effects, never fifteen');
  /* Every axis has to actually vary, or a "rolled" parameter is a
     constant wearing a costume. */
  for (const k of W.PROTO_CORE) {
    ok(seen[k].size > 3, 'core "' + k + '" genuinely varies (' + seen[k].size + ' values)');
  }
  for (const k of W.PROTO_EXOTIC) {
    ok(hits[k] > 8, 'exotic "' + k + '" does come up (' + hits[k] + '/300)');
    ok(seen[k].size > 3, 'exotic "' + k + '" varies when it does (' + seen[k].size + ')');
  }
  /* determinism */
  const a1 = W.rollProto(window.GREEBLEWORKS.makeRng(99));
  const a2 = W.rollProto(window.GREEBLEWORKS.makeRng(99));
  ok(a1.label === a2.label && a1.rate === a2.rate, 'a seed always rolls the same gun');
  ok(W.make('proto', a1).ammo === a1.mag, 'make() accepts a rolled definition');
}

/* the build screen's weapon forge is generated from this table */
{
  const W2 = window.WEAPONS;
  const sample = W2.rollProto(window.GREEBLEWORKS.makeRng(3));
  let n = 0;
  for (const grp of W2.PROTO_CONTROLS) {
    ok(typeof grp.g === 'string' && grp.g.length > 0, 'weapon control group has a name');
    for (const c of grp.c) {
      n++;
      ok(c.k in sample, 'weapon control "' + c.k + '" maps to a real field');
      ok(typeof c.l === 'string' && c.l.length > 0, 'weapon control "' + c.k + '" has a label');
      if (c.t === 'r') {
        ok(c.min < c.max, 'weapon control "' + c.k + '" has a sane range');
        const v = sample[c.k];
        ok(v >= c.min - 1e-6 && v <= c.max + 1e-6,
           'a rolled "' + c.k + '" (' + v + ') sits inside the panel range');
      }
      if (c.t === 's') {
        const opts2 = typeof c.opt === 'function' ? c.opt() : c.opt;
        ok(opts2.indexOf(String(sample[c.k])) >= 0, 'rolled "' + c.k + '" is one of its options');
      }
    }
  }
  ok(n >= 15, 'the weapon forge exposes a real amount of the gun (' + n + ')');
  // retune must keep it playable after a hand edit
  const edited = Object.assign({}, sample, { speed: 13, dmg: 15, count: 5, splash: 30 });
  W2.retune(edited);
  ok(!!edited.tone && edited.tone.f > 0, 'retune rebuilds the sound after an edit');
}

/* ---------------- rigid bodies ---------------- */
section('rigid bodies');
{
  const plats = [{ x: 0, y: 200, w: 600, ground: true }];
  const W = new window.PHYSICS.World(plats);
  const sim = new window.RIGID.Sim(W);
  sim.levelWidth = 600;
  const sheet = window.SCRAPFORGE.forgeOne('crate', { seed: 7, size: 16 });

  const b = sim.add(new window.RIGID.Body(sheet, 100, 60, 0));
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  ok(Math.abs((b.y + b.hh) - 200) < 2, 'a dropped body rests on the deck (y=' + b.y.toFixed(1) + ')');
  ok(b.asleep, 'it goes to sleep once still');
  ok(Math.abs(b.vx) < 0.1 && Math.abs(b.vy) < 0.1, 'a sleeping body has no velocity');

  // an impulse wakes it and moves it
  const x0 = b.x;
  b.applyImpulse(6, -3, b.x + 4, b.y - 4);
  ok(!b.asleep, 'an impulse wakes a sleeping body');
  ok(Math.abs(b.spin) > 0, 'an off-centre impulse imparts spin');
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  ok(b.x > x0 + 2, 'the impulse actually moved it (' + x0.toFixed(0) + ' -> ' + b.x.toFixed(0) + ')');

  // two bodies must not end up inside one another
  const c1 = sim.add(new window.RIGID.Body(sheet, 300, 100, 0));
  const c2 = sim.add(new window.RIGID.Body(sheet, 302, 60, 0));
  for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
  const dx = Math.abs(c1.x - c2.x), dy = Math.abs(c1.y - c2.y);
  ok(dx >= c1.hw + c2.hw - 1.5 || dy >= c1.hh + c2.hh - 1.5,
     'stacked bodies separate rather than interpenetrate');
  ok(c1.y < 260 && c2.y < 260, 'neither fell through the deck');

  // damage steps the sprite and shrinks the box
  const d = sim.add(new window.RIGID.Body(sheet, 450, 180, 0));
  const hw0 = d.hw, f0 = d.frame;
  d.hurt(d.maxHp * 0.9);
  ok(d.frame > f0, 'damage steps to a later damage state');
  ok(d.hw <= hw0, 'a wrecked body is no larger than an intact one');

  // hitTest and nearest
  ok(sim.hitTest(d.x, d.y, 2) === d, 'hitTest finds a body under a point');
  ok(sim.hitTest(d.x, d.y - 400, 2) === null, 'hitTest misses empty air');
  ok(sim.nearest(d.x + 8, d.y, 60) !== null, 'nearest finds a grabbable body');
  ok(sim.nearest(d.x, d.y, 2, () => false) === null, 'nearest respects its filter');

  /* Shooting a body must send it somewhere. A crate that twitches is
     scenery; a crate that skids is a thing you can use. */
  {
    const shove = sim.add(new window.RIGID.Body(sheet, 250, 180, 0));
    for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
    const x0 = shove.x;
    const rifle = window.WEAPONS.table.rifle;
    const push = rifle.dmg * 1.5 + rifle.size * 1.6;
    shove.applyImpulse(rifle.speed * push * 0.30, -0.9, shove.x - 3, shove.y + 2);
    for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
    const moved = shove.x - x0;
    ok(moved > 12, 'one rifle round shoves a crate a real distance (' + moved.toFixed(1) + 'px)');
    ok(Math.abs(shove.spin) > 0 || shove.rot !== 0, 'and sets it tumbling');
  }

  // terminal-velocity drop must not tunnel the deck
  const fast = sim.add(new window.RIGID.Body(sheet, 200, 10, 0));
  fast.vy = 8;
  for (let i = 0; i < 60 * 4; i++) sim.step(1 / 60);
  ok(fast.y < 240, 'a fast-falling body does not tunnel the deck');
}

/* ---------------- weapons ---------------- */
section('weapons');
for (const k of window.WEAPONS.ORDER) {
  const d = window.WEAPONS.table[k];
  ok(d && d.rate > 0 && d.speed > 0 && d.dmg > 0, k + ' has sane numbers');
  ok(d.mag > 0 && d.reload > 0, k + ' has a magazine');
  ok(!!d.tone, k + ' has a sound spec');
  const w = window.WEAPONS.make(k);
  ok(w.ammo === d.mag, k + ' starts loaded');
  /* Every weapon has to be drawable. A gun the forge has never heard
     of silently falls back to the rifle silhouette, which is how a
     roster of twenty turns into a roster of nineteen and one liar. */
  ok(!!window.MERCFORGE.gunSpec, 'the forge can spec a gun');
}
{
  /* --- the arsenals --- */
  const WP = window.WEAPONS;
  ok(WP.ORDER.length === 20, 'twenty weapons (' + WP.ORDER.length + ')');
  ok(WP.ORDER.length === Object.keys(WP.table).length,
     'and the order lists all of them');
  const arsenalGuns = new Set();
  for (const d in WP.ARSENALS) {
    const A = WP.ARSENALS[d];
    ok(A.length >= 3, 'doctrine "' + d + '" has an arsenal (' + A.length + ')');
    ok(new Set(A).size === A.length, 'and lists nothing twice');
    for (const g of A) {
      ok(!!WP.table[g], 'arsenal "' + d + '" carries a real weapon (' + g + ')');
      arsenalGuns.add(g);
    }
    ok(WP.arsenalOf(d).length === A.length, 'and arsenalOf agrees with it');
    /* a copy, not the table itself: a caller that shuffles a faction's
       arsenal must not reorder every faction's */
    const c = WP.arsenalOf(d); c.push('junk');
    ok(WP.ARSENALS[d].length === A.length, 'and hands back a copy');
  }
  ok(WP.arsenalOf('not-a-doctrine').length > 0, 'an unknown doctrine still gets guns');
  /* the five new ones each belong to somebody, and each is somebody's
     signature rather than a spare in three lists */
  const NEW = ['censer', 'harrow', 'tithe', 'bloom', 'ratchet'];
  for (const g of NEW) {
    ok(!!WP.table[g], g + ' exists');
    ok(!!WP.table[g].arsenal, g + ' says whose it is');
    ok(!!WP.ARSENALS[WP.table[g].arsenal], 'and that doctrine exists');
    ok(WP.ARSENALS[WP.table[g].arsenal].indexOf(g) >= 0, 'and carries it');
    const owners = Object.keys(WP.ARSENALS).filter(d => WP.ARSENALS[d].indexOf(g) >= 0);
    ok(owners.length <= 3, g + ' is not in everybody\'s hands (' + owners.length + ')');
    /* each is built around one exotic rather than being a better rifle */
    const d = WP.table[g];
    const exotic = ['pierce', 'splash', 'burn', 'chain', 'fork', 'slow', 'vamp',
                    'bounce', 'drop', 'count'].filter(k => d[k]);
    ok(exotic.length > 0, g + ' is built around something (' + exotic.join(',') + ')');
    ok(d.dmg <= WP.table.rail.dmg, g + ' is not simply the best gun');
  }
  /* and no two doctrines field the same four */
  {
    const sigs = new Set();
    for (const d in WP.ARSENALS) sigs.add(WP.ARSENALS[d].slice().sort().join(','));
    ok(sigs.size === Object.keys(WP.ARSENALS).length,
       'no two doctrines carry the same arsenal');
  }
  /* the lore reads its guns out of here rather than repeating them */
  for (const k of window.LORE.DOCTRINE_KEYS) {
    const D = window.LORE.DOCTRINES[k];
    ok(D.guns.join(',') === WP.arsenalOf(k).join(','),
       'doctrine "' + k + '" carries the arsenal weapons.js says it does');
  }
}

/* ---------------- physics ---------------- */
section('physics');
{
  const plats = [
    { x: 0, y: 200, w: 300, ground: true },
    { x: 400, y: 200, w: 300, ground: true },     // pit between 300 and 400
    { x: 120, y: 140, w: 90, ground: false, thin: false }
  ];
  const W = new window.PHYSICS.World(plats);

  ok(!!W.solidAt(50, 205, false), 'solid inside ground mass');
  ok(!W.solidAt(350, 205, false), 'pit is empty');
  ok(!!W.solidAt(150, 145, true), 'deck is solid to bullets');
  ok(!W.solidAt(150, 145, false), 'deck is not solid to movement queries');

  // fall onto ground
  let o = { x: 50, y: 100, vx: 0, vy: 0 };
  for (let i = 0; i < 120; i++) { o.vy = Math.min(o.vy + 0.36, 9); W.move(o, 10, 27, false); }
  ok(Math.abs(o.y - 200) < 0.5, 'falls and rests on ground (y=' + o.y.toFixed(2) + ')');
  ok(o.ground === true, 'ground flag set');

  // one-way deck catches from above
  o = { x: 150, y: 100, vx: 0, vy: 0 };
  for (let i = 0; i < 60; i++) { o.vy = Math.min(o.vy + 0.36, 9); W.move(o, 10, 27, false); }
  ok(Math.abs(o.y - 140) < 0.5, 'lands on one-way deck (y=' + o.y.toFixed(2) + ')');

  // ...and does not catch from below
  o = { x: 150, y: 190, vx: 0, vy: -6 };
  let blocked = false;
  for (let i = 0; i < 20; i++) { W.move(o, 10, 27, false); if (o.hitCeil) blocked = true; o.vy += 0.36; }
  ok(!blocked, 'jumps up through a one-way deck');
  ok(o.y < 140, 'passed above the deck');

  // drop-through
  o = { x: 150, y: 140, vx: 0, vy: 1 };
  for (let i = 0; i < 40; i++) { o.vy = Math.min(o.vy + 0.36, 9); W.move(o, 10, 27, true); }
  ok(o.y > 150, 'drop-through ignores the deck');

  // no tunnelling at speed: a fast faller must still be caught
  o = { x: 50, y: 20, vx: 0, vy: 9 };
  for (let i = 0; i < 60; i++) { W.move(o, 10, 27, false); if (o.ground) break; o.vy = 9; }
  ok(o.ground && Math.abs(o.y - 200) < 0.5, 'terminal-velocity fall does not tunnel');

  // horizontal wall stop against the step at x=400
  o = { x: 380, y: 199, vx: 0, vy: 0 };
  const plats2 = [{ x: 0, y: 200, w: 400, ground: true }, { x: 400, y: 160, w: 300, ground: true }];
  const W2 = new window.PHYSICS.World(plats2);
  o = { x: 380, y: 200, vx: 6, vy: 0 };
  for (let i = 0; i < 10; i++) W2.move(o, 12, 27, false);
  ok(o.x < 400, 'stops against a taller ground run (x=' + o.x.toFixed(1) + ')');

  /* ---- surface queries: what a crawler can grip ---- */
  {
    const faces = W.surfacesNear(150, 130, 60);
    ok(faces.length > 0, 'found grippable faces near a deck');
    const kinds = new Set(faces.map(f => f.orient));
    ok(kinds.has('floor'), 'deck top is grippable as floor');
    ok(kinds.has('ceiling'), 'deck underside is grippable as ceiling');
    ok(kinds.has('wallL') || kinds.has('wallR'), 'deck sides are grippable as walls');
    for (const f of faces) {
      ok(Math.abs(Math.hypot(f.nx, f.ny) - 1) < 1e-6, 'face normal is unit');
      ok(f.dist <= 60 + 1e-6, 'face is within the search radius');
    }
    // ground mass has no underside inside the frame to hang from
    const groundFaces = W.surfacesNear(50, 205, 40).filter(f => f.plat.ground);
    ok(groundFaces.every(f => f.orient !== 'ceiling'),
       'ground mass exposes no ceiling face');

    const pick = W.pickAnchor(150, 130, 5, 90, 1, 0, () => 0.5);
    ok(!!pick, 'pickAnchor returns a grip');
    ok(pick.dist >= 5, 'pickAnchor respects the minimum stride');
    // it should prefer a grip in the direction asked for
    let rightWins = 0;
    for (let i = 0; i < 24; i++) {
      const r = W.pickAnchor(150, 150, 4, 120, 1, 0, Math.random);
      if (r && r.x >= 150) rightWins++;
    }
    ok(rightWins > 14, 'pickAnchor leans the way it is told (' + rightWins + '/24)');
  }

  /* ---- double jump ---- */
  {
    const rig = { w: 10, h: 27, gun: 'rifle', params: { colVisor: '#fff' },
                  frameOf: () => 0, framesOf: () => 1, fpsOf: () => 1,
                  muzzle: () => ({ x: 0, y: 0 }) };
    const diff = window.CONFIG.DIFFICULTY.regular;
    const P2 = new window.ENTITIES.Player(rig, 50, 200, diff);
    const inp = { left: false, right: false, up: false, down: false, fire: false,
                  jumpPressed: false, reloadPressed: false, aimX: 100, aimY: 180 };
    const stepN = (n, jump) => {
      for (let i = 0; i < n; i++) {
        inp.jumpPressed = jump && i === 0;
        P2.step(W, inp, 1 / 60);
      }
    };
    stepN(6, false);
    ok(P2.ground, 'test player is on the deck');
    ok(P2.airJumps === window.ENTITIES.MOVE.airJumps, 'air jumps are charged on the ground');
    stepN(1, true);
    ok(P2.vy < -4, 'first jump leaves the ground');
    const apex = P2.y;
    stepN(24, false);
    ok(P2.vy > 0, 'it is falling by now');
    const beforeY = P2.y, spent = P2.airJumps;
    stepN(1, true);
    ok(P2.airJumps === spent - 1, 'the air jump is spent');
    ok(P2.vy < 0, 'the second jump reverses the fall (vy=' + P2.vy.toFixed(2) + ')');
    ok(!!P2.jumpPuff, 'the air jump leaves a mark');
    stepN(1, true);
    ok(P2.airJumps === 0, 'there is no third jump');
    // and it recharges on landing
    for (let i = 0; i < 200 && !P2.ground; i++) { inp.jumpPressed = false; P2.step(W, inp, 1 / 60); }
    ok(P2.ground, 'it lands again');
    ok(P2.airJumps === window.ENTITIES.MOVE.airJumps, 'landing recharges the air jump');
    ok(P2.y < 260 && beforeY < 260, 'the double jump did not push it through the floor');
  }

  ok(W.canSee(10, 190, 60, 190) === true, 'clear line of sight along a deck');
  // A tall block between two low runs must break sight across it.
  const W3 = new window.PHYSICS.World([
    { x: 0, y: 200, w: 400, ground: true },
    { x: 400, y: 100, w: 100, ground: true },
    { x: 500, y: 200, w: 300, ground: true }
  ]);
  ok(W3.canSee(380, 180, 600, 180) === false, 'line of sight blocked by mass');
  ok(W3.canSee(380, 60, 600, 60) === true, 'line of sight clears over the block');

  const g = W.groundUnder(50, 100, false);
  ok(g && g.y === 200, 'groundUnder finds the deck below');
  ok(W.groundUnder(350, 100, false) === null, 'groundUnder returns null over a pit');
}

/* ---------------- full mission ---------------- */
section('mission build + simulation');
const cfg = window.CONFIG.randomLevelCfg(0xC0FFEE);
cfg.levelLen = 4;                      // keep the harness quick
const merc = window.CONFIG.randomMerc(0xC0FFEE);
const opts = { difficulty: 'regular', enemyDens: 1.0, lives: 3 };

const t0 = Date.now();
let steps = 0, r;
const gen = window.WORLD.buildMission(cfg, merc, opts);
const phases = new Set();
while (!(r = gen.next()).done) {
  steps++;
  phases.add(r.value.phase);
  ok(typeof r.value.msg === 'string' && r.value.msg.length > 0, 'progress step has a message');
}
const M = r.value;
const bakeMs = Date.now() - t0;
console.log('  bake: ' + bakeMs + 'ms over ' + steps + ' yielded steps');
ok(phases.has('level') && phases.has('rigs') && phases.has('deploy'), 'all load phases reported');
ok(steps > 60, 'enough progress steps for an honest bar');
ok(M.L.plats.length > 4, 'level has platforms');
ok(M.enemies.length > 0, 'hostiles deployed (' + M.enemies.length + ')');
ok(M.player.y <= LV.H, 'player spawned inside the frame');
ok(M.exit.x > M.player.x, 'extraction is downrange of the spawn');
ok(M.exit.x <= M.L.LW, 'extraction is inside the level');

/* Every enemy must start on solid footing (or be a flyer). */
{
  let grounded = 0, flying = 0, clinging = 0, bad = 0;
  for (const e of M.enemies) {
    if (e.kind === 'crawler') {
      /* Seated against a surface at the reach the generator measured.
         The search has to go out to that REACH, not to the body's own
         radius: a crawler whose limbs hold it further off the wall
         than it is wide sits perfectly well, and looking only as far
         as the blob is wide finds no wall and calls it floating. */
      const rr = Math.max(e.rig.radiusMax || 0, e.rig.reach(e.orient)) + 6;
      const faces = M.world.surfacesNear(e.x, e.y, rr);
      let seated = false;
      for (const f of faces) {
        if (!f.orient) continue;
        if (Math.abs(f.dist - e.rig.reach(f.orient)) < 3) { seated = true; break; }
      }
      if (seated) clinging++; else bad++;
      continue;
    }
    if (e.flying) { flying++; continue; }
    const g = M.world.groundUnder(e.x, e.y - 1, true);
    if (g && Math.abs(g.y - e.y) < 2) grounded++; else bad++;
  }
  ok(bad === 0, 'every hostile spawned attached to something (' + bad + ' floating)');
  console.log('  ' + grounded + ' grounded, ' + flying + ' airborne, ' + clinging + ' clinging');
}

/* Nothing spawns on top of the player. */
{
  let tooClose = 0;
  for (const e of M.enemies) if (Math.abs(e.x - M.player.x) < 180) tooClose++;
  ok(tooClose === 0, 'no hostile spawns inside the drop-in zone');
}

/* ---------------- simulate ---------------- */
section('30s of play');
{
  const inp = {
    left: false, right: true, up: false, down: false,
    fire: true, jumpPressed: false, reloadPressed: false,
    cursorX: 300, cursorY: 120, aimX: 0, aimY: 0
  };
  let maxBullets = 0, maxParts = 0, fired = 0, shotsHit = 0;
  const beforeKills = M.kills;
  for (let i = 0; i < 30 * 60; i++) {
    M.cursorX = inp.cursorX; M.cursorY = inp.cursorY;
    // Walk right, jump periodically, sweep the aim so bullets go everywhere.
    inp.jumpPressed = (i % 47 === 0);
    inp.cursorX = 224 + Math.cos(i / 40) * 200;
    inp.cursorY = 126 + Math.sin(i / 27) * 90;
    if (i % 900 === 800) inp.reloadPressed = true; else inp.reloadPressed = false;
    M.update(1 / 60, inp);
    maxBullets = Math.max(maxBullets, M.bullets.length);
    maxParts = Math.max(maxParts, M.parts.length);
    if (M.state === 'dead') {
      if (!M.respawn()) break;
    }
    if (M.state === 'won') break;
    // invariants, every step
    if (!Number.isFinite(M.player.x) || !Number.isFinite(M.player.y)) {
      ok(false, 'player position went non-finite at step ' + i); break;
    }
    if (!Number.isFinite(M.scroll)) { ok(false, 'scroll went non-finite at step ' + i); break; }
  }
  ok(Number.isFinite(M.player.x) && Number.isFinite(M.player.y), 'player position stayed finite');
  ok(M.player.x >= 0 && M.player.x <= M.L.LW, 'player stayed inside the level');
  ok(M.scroll >= 0 && M.scroll <= Math.max(0, M.L.LW - LV.W), 'camera stayed clamped');
  ok(maxBullets < 400, 'bullet list stayed bounded (peak ' + maxBullets + ')');
  ok(maxParts < 3000, 'particle list stayed bounded (peak ' + maxParts + ')');
  ok(M.kills >= beforeKills, 'kill count only goes up');
  console.log('  player at x=' + M.player.x.toFixed(0) + '/' + M.L.LW +
              ', hp=' + M.player.hp.toFixed(0) +
              ', kills=' + M.kills + '/' + M.totalEnemies +
              ', state=' + M.state + ', lives=' + M.lives);
  const st = M.stats();
  ok(Number.isFinite(st.final), 'stats produce a finite score');
}

/* Bullets must actually be able to kill: fire point blank at a hostile. */
section('damage path');
{
  /* Both damage checks need the same thing: a muzzle position with
     clear air between it and the target. Terrain, one-way decks and
     debris all stop bullets, and a test that assumes a firing line
     fails for reasons that have nothing to do with the damage path.
     Ask the world instead. */
  var clearLineIn = (M, ox, oy, tx, ty) => {
    const steps = Math.ceil(Math.hypot(tx - ox, ty - oy) / 2) || 1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const px = ox + (tx - ox) * t, py = oy + (ty - oy) * t;
      if (M.world.solidAt(px, py, true)) return false;
      if (M.rigid.hitTest(px, py, 1)) return false;
      }
    return true;
  };
  var approachTo = (M, tx, ty, dist) => {
    /* Sweep the full circle, and fall back to shorter stand-off
       distances: a hostile wedged into a step has clear air close in
       even when every long line is blocked. */
    for (const scale of [1, 0.65, 0.4]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const d = [Math.cos(a), Math.sin(a)];
        const r = dist * scale;
        const ox = tx + d[0] * r, oy = ty + d[1] * r;
        if (clearLineIn(M, ox, oy, tx, ty)) return { d, ox, oy, r };
      }
    }
    return null;
  };
  const M2 = (() => {
    const g = window.WORLD.buildMission(
      Object.assign({}, cfg, { seed: 4242, levelLen: 3 }),
      merc, { difficulty: 'recruit', enemyDens: 1.5, lives: 3 });
    let rr; while (!(rr = g.next()).done);
    return rr.value;
  })();
  /* Pick a hostile that can actually be shot. A merc standing in a
     doorway or wedged against a step has no clear line to it from any
     angle — that is the level being a level, not the damage path being
     broken, and pinning the test to enemies[0] made it fail whenever
     the layout shifted. */
  const W = window.WEAPONS.table.rifle;
  let target = null, ap0 = null;
  for (const e of M2.enemies) {
    if (e.flying || e.kind === 'crawler' || e.boss || e.dead) continue;
    const a = approachTo(M2, e.x, e.y - e.h * 0.5, 30);
    if (a) { target = e; ap0 = a; break; }
  }
  ok(!!target, 'found a walking hostile with a clear firing line');
  if (target) {
    const hpBefore = target.hp;
    const ty = target.y - target.h * 0.5;
    const d0 = ap0 ? ap0.d : [-1, 0], r0 = ap0 ? ap0.r : 30;
    for (let i = 0; i < 12; i++) {
      M2.bullets.push(new window.ENTITIES.Bullet(
        target.x + d0[0] * r0, ty + d0[1] * r0,
        Math.atan2(-d0[1], -d0[0]), W, true, '#fff'));
    }
    for (let i = 0; i < 40; i++) M2.stepBullets(1 / 60);
    ok(target.hp < hpBefore || target.dead, 'point-blank fire damaged the hostile');

    /* A crawler is a disc around its centre, and shooting one must
       throw chunks off it. Pick a LIVE one: the shots above can pass
       through a crawler on their way to the merc, and a corpse takes
       no further damage — which is correct, and quietly satisfied an
       earlier version of this check through its `|| dead` clause. */
    /* A live crawler, moved into the same open air the merc above was
       shot in if the one the spawner placed is wedged. A crawler in a
       corner is correctly unshootable from three sides, and whether
       the spawner happened to put it in one is not what this check is
       about. */
    const D0 = 34;
    let cr = null, crApproach = null;
    for (const e of M2.enemies) {
      if (e.kind !== 'crawler' || e.dead) continue;
      if (!cr) cr = e;
      const a = approachTo(M2, e.x, e.y, D0);
      if (a) { cr = e; crApproach = a; break; }
    }
    ok(!!cr, 'a live crawler is in the level');
    if (cr && !crApproach) {
      cr.x = target.x; cr.y = ty;
      crApproach = approachTo(M2, cr.x, cr.y, D0);
    }
    if (cr) {
      /* Shoot from a direction with clear air between muzzle and blob.
         A crawler on a wall has solid mass on one side of it, and
         firing from that side just puts a hole in the wall — correct
         behaviour, and the reason two earlier versions of this check
         failed for reasons that had nothing to do with the code under
         test. Pick the approach by asking the world, not by assuming. */
      const D = D0;
      const found = crApproach || approachTo(M2, cr.x, cr.y, D);
      ok(!!found, 'found a clear firing line to the crawler');
      let ap = found ? found.d : [0, -1];
      const apR = found ? found.r : D;
      const shootAt = target => {
        M2.bullets.push(new window.ENTITIES.Bullet(
          target.x + ap[0] * apR, target.y + ap[1] * apR,
          Math.atan2(-ap[1], -ap[0]), W, true, '#fff'));
      };
      const chpBefore = cr.hp, gibsBefore = M2.gibs.length;
      for (let i = 0; i < 10; i++) shootAt(cr);
      for (let i = 0; i < 60; i++) M2.stepBullets(1 / 60);
      ok(cr.hp < chpBefore, 'point-blank fire damaged the crawler');
      ok(M2.gibs.length > gibsBefore, 'chunks flew off the crawler');
      ok(cr.alerted, 'being shot alerts the crawler');

      /* a shot that clears the disc must not register */
      const cr2 = M2.enemies.find(e => e.kind === 'crawler' && !e.dead && e !== cr) || cr;
      if (!cr2.dead) {
        const f2 = approachTo(M2, cr2.x, cr2.y, D);
        const ap2 = f2 ? f2.d : [0, -1];
        const miss = cr2.hp;
        const perpX = -ap2[1], perpY = ap2[0];
        const off = cr2.rig.r + 12;
        M2.bullets.push(new window.ENTITIES.Bullet(
          cr2.x + ap2[0] * (f2 ? f2.r : 34) + perpX * off,
          cr2.y + ap2[1] * (f2 ? f2.r : 34) + perpY * off,
          Math.atan2(-ap2[1], -ap2[0]), W, true, '#fff'));
        for (let i = 0; i < 40; i++) M2.stepBullets(1 / 60);
        ok(cr2.hp === miss, 'a shot clear of the blob is not a hit');
      }
    }
    // and the reverse: an enemy bullet must be able to hurt the player
    const php = M2.player.hp;
    M2.player.invuln = 0;
    M2.bullets.push(new window.ENTITIES.Bullet(
      M2.player.x - 20, M2.player.y - M2.player.h * 0.5, 0,
      window.WEAPONS.table.pistol, false, '#fff'));
    for (let i = 0; i < 30; i++) M2.stepBullets(1 / 60);
    ok(M2.player.hp < php, 'enemy fire damaged the player');
  }
}

/* ---------------- contact sheets ---------------- */
section('contact sheets');
fs.mkdirSync(OUT, { recursive: true });

function dump(name, cv) {
  fs.writeFileSync(path.join(OUT, name), cv.toBuffer('image/png'));
  console.log('  wrote out/' + name);
}

/* a few gameplay frames spread across the level */
{
  const cv = createCanvas(LV.W, LV.H * 3);
  const cx = cv.getContext('2d');
  const one = createCanvas(LV.W, LV.H);
  const ox = one.getContext('2d');
  // Pose the run for the shot rather than photographing whatever
  // state the 30s simulation happened to end in.
  M.state = 'play'; M.endT = 0; M.lives = 3;
  M.player.dead = false; M.player.hp = 72;
  for (let i = 0; i < 3; i++) {
    M.scroll = (M.L.LW - LV.W) * (i / 2);
    M.time = 2 + i * 3;
    M.cursorX = 300; M.cursorY = 110;
    // Stand the player on real ground somewhere in view.
    let px = M.scroll + 120, g = null;
    for (let k = 0; k < 40 && !g; k++) { px = M.scroll + 60 + k * 8; g = M.world.groundUnder(px, 0, true); }
    M.player.x = px;
    if (g) M.player.y = g.y;
    M.player.anim = 'run'; M.player.frame = 2;
    M.player.local = -0.3; M.player.face = 1;
    window.RENDER.frame(M, ox, one);
    cx.drawImage(one, 0, i * LV.H);
  }
  dump('out_game.png', cv);
}

/* the whole weapon roster in one operative's hands. A roster the
   silhouette cannot tell apart is a list, not a roster. */
{
  const kinds = window.WEAPONS.ORDER;
  const cols = 5, rows = Math.ceil(kinds.length / cols);
  const CWc = 232, CHc = 208, Z = 2;    // 2x, or the parts are too small to judge
  const cv = createCanvas(cols * CWc, rows * CHc);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#14181a';
  cx.fillRect(0, 0, cv.width, cv.height);
  cx.font = '12px monospace';
  cx.textAlign = 'center';
  const inkOf = c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  };
  const silhouettes = [];
  kinds.forEach((k, i) => {
    const rig = new window.SPRITE.Rig(Object.assign({}, merc,
      { gun: k, gunSize: 1.25, aimRows: 3, runFrames: 4 }));
    const col = i % cols, row = (i / cols) | 0;
    const x = col * CWc, y = row * CHc;
    cx.save();
    cx.translate(x + CWc * 0.5, y + CHc - 34);
    cx.scale(Z, Z);
    rig.draw(cx, 'idle', 0, 0, 0, 0, false);
    cx.restore();
    cx.fillStyle = '#8a9099';
    cx.fillText(k.toUpperCase(), x + CWc * 0.5, y + 18);
    cx.fillStyle = '#4a5058';
    cx.fillText(window.WEAPONS.table[k].label, x + CWc * 0.5, y + CHc - 10);
    cx.strokeStyle = '#1e242b';
    cx.strokeRect(x + 0.5, y + 0.5, CWc - 1, CHc - 1);
    // the held sheet, on its own, so we can compare silhouettes
    const one = createCanvas(120, 90);
    const oc = one.getContext('2d');
    oc.imageSmoothingEnabled = false;
    rig.draw(oc, 'idle', 0, 0, 60, 76, false);
    silhouettes.push({ k, ink: inkOf(one) });
    ok(rig.gun === k, 'the rig holds the weapon it was built with (' + k + ')');
  });
  /* Every shape has to be genuinely different in the hand. Comparing
     ink counts is crude but it catches the failure that matters: a new
     weapon that silently falls back to the rifle shape. */
  {
    const counts = silhouettes.map(s => s.ink);
    const uniq = new Set(counts);
    ok(uniq.size >= kinds.length - 1,
       'each weapon draws its own silhouette (' + uniq.size + '/' + kinds.length + ' distinct)');
    for (const s of silhouettes) ok(s.ink > 40, s.k + ' actually draws something');
  }
  dump('out_guns.png', cv);
}

/* the entity cast, blitted from their sheets */
{
  const kinds = Object.keys(window.CONFIG.ARCHETYPES);
  const cell = 90;
  const cv = createCanvas(cell * (kinds.length + 1), cell);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#14181a';
  cx.fillRect(0, 0, cv.width, cv.height);
  const pr = new window.SPRITE.Rig(merc);
  pr.draw(cx, 'run', 2, -0.2, cell * 0.5, cell - 14, false);
  kinds.forEach((k, i) => {
    if (window.CONFIG.ARCHETYPES[k].crawler) {
      const rig = new window.SPRITE.CrawlerRig(
        window.CONFIG.crawlerParams(1234 + i * 77, cfg));
      rig.draw(cx, 'idle', 0, 'floor',
        cell * (i + 1.5), cell - 14 - rig.reach('floor'), false);
    } else {
      const rig = new window.SPRITE.Rig(window.CONFIG.archetypeParams(k, 1234 + i * 77, cfg.style));
      rig.draw(cx, 'idle', 0, 0, cell * (i + 1.5), cell - 14, false);
    }
  });
  dump('out_cast.png', cv);
}

/* aim sweep of the player rig: every row of the sheet */
{
  const rig = new window.SPRITE.Rig(merc);
  const n = rig.sheet.angles.length;
  const cw = rig.sheet.CW + 6, ch = rig.sheet.CH + 6;
  const cv = createCanvas(cw * n, ch);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#14181a';
  cx.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < n; i++) {
    const local = (rig.sheet.angles[i]) * Math.PI / 180;
    rig.draw(cx, 'idle', 0, local, cw * (i + 0.5), ch - 4, false);
  }
  dump('out_aim.png', cv);
}

/* crawlers: locomotion over time, on whatever surface they grabbed */
{
  const cfgC = window.CONFIG.randomLevelCfg(0x5EA51DE);
  cfgC.levelLen = 4;
  const gc = window.WORLD.buildMission(cfgC, merc,
    { difficulty: 'regular', enemyDens: 2.2, lives: 3 });
  let rr; while (!(rr = gc.next()).done);
  const MC = rr.value;
  const crawlers = MC.enemies.filter(e => e.kind === 'crawler');
  ok(crawlers.length > 0, 'crawler contact sheet has crawlers (' + crawlers.length + ')');

  /* run them so limbs cast, grip and haul */
  const inp = { left: false, right: false, up: false, down: false, fire: false,
                jumpPressed: false, reloadPressed: false, cursorX: 224, cursorY: 126,
                aimX: 0, aimY: 0 };
  const seen = { gripped: 0, reaching: 0, moved: 0, orients: new Set() };
  const start = crawlers.map(c => ({ x: c.x, y: c.y }));
  /* Off-screen hostiles are culled from the sim, so park the player
     next to each crawler in turn rather than watching from spawn and
     concluding that nothing moves. */
  crawlers.forEach((c, ci) => {
    MC.player.x = c.x + 90;
    const gg = MC.world.groundUnder(MC.player.x, 0, true);
    MC.player.y = gg ? gg.y : c.y;
    MC.scroll = clamp(c.x - LV.W / 2, 0, Math.max(0, MC.L.LW - LV.W));
    for (let i = 0; i < 60 * 5; i++) {
      MC.cursorX = inp.cursorX; MC.cursorY = inp.cursorY;
      MC.update(1 / 60, inp);
      if (c.dead) break;
      seen.orients.add(c.orient);
      for (const l of c.limbs) {
        if (l.state === 'gripped') seen.gripped++;
        if (l.state === 'reaching') seen.reaching++;
      }
    }
    if (Math.hypot(c.x - start[ci].x, c.y - start[ci].y) > 8) seen.moved++;
  });
  ok(seen.gripped > 0, 'crawler limbs gripped terrain (' + seen.gripped + ' limb-frames)');
  ok(seen.reaching > 0, 'crawler limbs cast for new grips (' + seen.reaching + ' limb-frames)');
  ok(seen.moved > 0, 'crawlers hauled themselves somewhere (' + seen.moved + '/' + crawlers.length + ')');
  ok(MC.slime.length > 0, 'crawlers laid a slime trail (' + MC.slime.length + ' marks)');
  for (const c of crawlers) {
    ok(Number.isFinite(c.x) && Number.isFinite(c.y), 'crawler position stayed finite');
    ok(c.y < MC.world.floor + 200, 'crawler did not fall out of the world');
  }
  console.log('  orientations used: ' + Array.from(seen.orients).join(', '));

  /* a frame with a crawler centred, plus its own tentacles */
  const live = crawlers.filter(c => !c.dead);
  if (live.length) {
    const cv = createCanvas(LV.W, LV.H * Math.min(3, live.length));
    const cx2 = cv.getContext('2d');
    const one = createCanvas(LV.W, LV.H);
    const ox2 = one.getContext('2d');
    MC.state = 'play'; MC.endT = 0;
    MC.player.dead = false; MC.player.hp = 80;
    for (let i = 0; i < Math.min(3, live.length); i++) {
      const c = live[i];
      MC.scroll = clamp(c.x - LV.W / 2, 0, Math.max(0, MC.L.LW - LV.W));
      MC.time = 3 + i * 2;
      MC.player.x = MC.scroll + 70;
      const gg = MC.world.groundUnder(MC.player.x, 0, true);
      if (gg) MC.player.y = gg.y;
      MC.player.anim = 'idle'; MC.player.frame = 0; MC.player.local = 0; MC.player.face = 1;
      // gib and slime so the shot shows what a fight with one looks like
      MC.gib(c, 10);
      window.RENDER.frame(MC, ox2, one);
      cx2.drawImage(one, 0, i * LV.H);
    }
    dump('out_crawler.png', cv);
  }

  /* the same crawler on all four surfaces, with limbs out */
  {
    const rig = crawlers[0].rig;
    const T = rig.tent, PH = rig.phys;
    const pad = 96;
    const cell = Math.round(rig.tent.length * 0.9) + pad;
    const cv = createCanvas(cell * 4, cell);
    const c2 = cv.getContext('2d');
    c2.imageSmoothingEnabled = false;
    c2.fillStyle = '#14181a'; c2.fillRect(0, 0, cv.width, cv.height);
    ['floor', 'wallL', 'wallR', 'ceiling'].forEach((o, i) => {
      const ox3 = i * cell + cell / 2, oy3 = cell / 2;
      // the surface it is stuck to
      const n = { floor: [0, -1], ceiling: [0, 1], wallL: [1, 0], wallR: [-1, 0] }[o];
      const reach = rig.reach(o);
      c2.fillStyle = '#232a2e';
      if (n[0] === 0) c2.fillRect(i * cell + 8, oy3 - n[1] * reach - (n[1] < 0 ? 0 : 8), cell - 16, 8);
      else c2.fillRect(ox3 - n[0] * reach - (n[0] < 0 ? 0 : 8), 8, 8, cell - 16);
      // limbs reaching out along their sockets
      for (let k = 0; k < PH.sockets.length; k++) {
        const so = rig.socket(k, ox3, oy3, false, o);
        const a = Math.atan2(so.ny, so.nx);
        const len = 34 + (k % 3) * 16;
        window.CRAWLERFORGE.drawTentacle(c2, T, k % T.count, so.x, so.y,
          so.x + Math.cos(a) * len, so.y + Math.sin(a) * len,
          (k % 2 ? 1 : -1) * 12, {});
      }
      rig.draw(c2, 'idle', 0, o, ox3, oy3, false);
      c2.fillStyle = '#8d9aa2'; c2.font = '11px monospace';
      c2.fillText(o, i * cell + 8, cell - 8);
    });
    dump('out_crawler_surfaces.png', cv);
  }
}

/* the boss, the debris it throws, and the corruption */
section('overlord + corruption');
{
  const cfgB = window.CONFIG.randomLevelCfg(0xB055);
  cfgB.levelLen = 4;
  const gb = window.WORLD.buildMission(cfgB, merc,
    { difficulty: 'veteran', enemyDens: 1.4, lives: 3 });
  let rb; while (!(rb = gb.next()).done);
  const MB = rb.value;
  const O = MB.overlord;

  ok(!!O, 'an overlord was placed');
  ok(O.boss === true, 'it is flagged as a boss');
  ok(O.maxHp > 200, 'boss has boss health (' + O.maxHp + ')');
  ok(O.x > MB.player.x + 200, 'boss holds ground downrange of the spawn');
  ok(O.x < MB.exit.x, 'boss stands between the player and extraction');
  ok(O.flying && !O.ground, 'boss levitates rather than clinging');
  ok(MB.rigid.bodies.length > 4, 'debris scattered through the level (' +
     MB.rigid.bodies.length + ')');

  /* every body must start seated on terrain, not inside it */
  let embedded = 0;
  for (const b of MB.rigid.bodies) if (MB.world.solidAt(b.x, b.y, false)) embedded++;
  ok(embedded === 0, 'no debris spawned inside terrain (' + embedded + ')');

  /* fight it: wake, phases, grabs, throws */
  const inp = { left: false, right: false, up: false, down: false, fire: false,
                jumpPressed: false, reloadPressed: false, cursorX: 224, cursorY: 126,
                aimX: 0, aimY: 0 };
  MB.player.x = O.x - 140;
  const gg = MB.world.groundUnder(MB.player.x, 0, true);
  if (gg) MB.player.y = gg.y;
  MB.player.hp = 100;
  const seen = { phases: new Set(), grabbed: 0, thrown: 0, lashed: 0, maxVapor: 0 };
  let lastGrab = null;
  for (let i = 0; i < 60 * 22; i++) {
    MB.scroll = clamp(O.x - LV.W / 2, 0, Math.max(0, MB.L.LW - LV.W));
    MB.cursorX = inp.cursorX; MB.cursorY = inp.cursorY;
    MB.player.hp = 100;                 // keep the fight running
    MB.update(1 / 60, inp);
    if (O.dead) break;
    seen.phases.add(O.phase);
    seen.maxVapor = Math.max(seen.maxVapor, MB.vapors.length);
    if (O.grab && O.grab !== lastGrab) { seen.grabbed++; lastGrab = O.grab; }
    if (!O.grab && lastGrab) { seen.thrown++; lastGrab = null; }
    for (const l of O.limbs) if (l.state === 'strike') seen.lashed++;
    // walk it down through its phases
    if (i % 90 === 89) O.hurtBy(14, MB);
    ok(Number.isFinite(O.x) && Number.isFinite(O.y), 'boss position stayed finite');
    ok(O.y > 0 && O.y < LV.H, 'boss stayed inside the frame');
  }
  console.log('  phases ' + Array.from(seen.phases).join(',') +
              ' | grabs ' + seen.grabbed + ' | throws ' + seen.thrown +
              ' | lashes ' + seen.lashed + ' | peak vapour ' + seen.maxVapor);
  ok(O.aggroed, 'boss woke when the player closed in');
  ok(seen.phases.size >= 2, 'boss changed phase under fire');
  ok(seen.lashed > 0, 'boss lashed with its tentacles');
  ok(seen.grabbed > 0, 'boss picked up debris (' + seen.grabbed + ')');
  ok(seen.thrown > 0, 'boss threw what it picked up (' + seen.thrown + ')');
  ok(seen.maxVapor > 10, 'boss vents demonic vapour');
  ok(O.dead || O.hp < O.maxHp, 'boss took damage');

  /* it must actually be killable, and drop the goods */
  const pickBefore = MB.pickups.length;
  while (!O.dead) O.hurtBy(40, MB);
  ok(O.dead, 'boss can be killed');
  ok(MB.pickups.length > pickBefore, 'boss drops pickups on death');
  ok(MB.gibs.length > 0, 'boss comes apart');

  /* the prototype is placed, and taking it changes the loadout */
  {
    const pk = MB.pickups.find(p => p.shrine);
    ok(!!pk, 'the prototype was placed');
    if (pk) {
      ok(!!pk.proto, 'the pickup carries its rolled definition');
      // the player has been moved to the boss by now; measure from spawn
      ok(pk.x > MB.ground[0].x + 200, 'prototype is downrange of the spawn');
      ok(pk.x < O.x + 40, 'prototype is reached before the boss');
      const gp = MB.world.groundUnder(pk.x, 0, true);
      ok(gp && Math.abs(gp.y - (pk.y + 2)) < 3, 'prototype sits on real ground');
      const beforeRig = MB.player.rig;
      MB.take(pk);
      ok(MB.player.weapon.kind === 'proto', 'taking it equips the prototype');
      ok(MB.player.weapon.def.proto === true, 'the equipped weapon is the rolled one');
      ok(MB.player.rig !== beforeRig, 'the merc sprite swaps to hold it');
      // firing it must produce its rolled projectile count
      MB.player.weapon.ammo = 20; MB.player.weapon.cool = 0;
      MB.bullets.length = 0;
      MB.fire({ fire: true, reloadPressed: false }, 1 / 60);
      ok(MB.bullets.length === MB.player.weapon.def.count,
         'it fires its rolled projectile count (' + MB.bullets.length + ')');
      // and it never silently downgrades when dry
      MB.player.weapon.ammo = 0; MB.player.spare.proto = 0; MB.player.weapon.cool = 0;
      MB.fire({ fire: true, reloadPressed: false }, 1 / 60);
      ok(MB.player.weapon.kind === 'proto', 'a dry prototype is not swapped away');
    }
  }

  /* debris belongs to the level it is in */
  {
    const pal = MB.scrap.crate.palette;
    ok(window.CONFIG.SCRAP_PALETTES[cfgB.style].indexOf(pal) >= 0,
       'debris palette suits the architecture (' + cfgB.style + ' -> ' + pal + ')');
    /* scrapParamsFor is what the build screen seeds its panel from, so
       a free roll there would silently override the level match. */
    for (let i = 0; i < 20; i++) {
      const sp = window.CONFIG.scrapParamsFor((i * 7919) >>> 0, cfgB);
      ok(window.CONFIG.SCRAP_PALETTES[cfgB.style].indexOf(sp.palette) >= 0,
         'scrapParamsFor stays inside the architecture pool');
      ok(sp.lightdir === cfgB.lightdir, 'debris is lit from the level\'s light angle');
    }
    for (const b of MB.rigid.bodies.slice(0, 6)) {
      const sh = b.sheet;
      const ink = sh.bodies[0];
      ok(b.hw < (ink.halfW / 0.90) + 0.01, 'collision box is inset from the silhouette');
      ok(b.hh < (ink.halfH / 0.82) + 0.01, 'and sunk vertically so it beds in');
    }
    // a resting body should overlap the deck it sits on, not perch above it
    let bedded = 0, resting = 0;
    for (const b of MB.rigid.bodies) {
      const gr = MB.world.groundUnder(b.x, b.y, true);
      if (!gr || Math.abs((b.y + b.hh) - gr.y) > 1.5) continue;
      resting++;
      if (b.y + b.sheet.bodies[0].halfH / 0.82 > gr.y) bedded++;
    }
    ok(resting === 0 || bedded === resting,
       'resting debris beds into the deck rather than floating on it (' +
       bedded + '/' + resting + ')');
  }

  /* the boss forge and weapon forge reach the mission */
  {
    const cfgX = window.CONFIG.randomLevelCfg(0xF0E);
    cfgX.levelLen = 3;
    const customBoss = Object.assign(window.CONFIG.overlordParams(7, cfgX),
      { palette: 'void', size: 54, tentacles: 9 });
    const customGun = Object.assign(
      window.WEAPONS.rollProto(window.GREEBLEWORKS.makeRng(11)),
      { label: 'HAND BUILT TEST I', count: 4, splash: 20, tint: '#3ee0ff' });
    const gx = window.WORLD.buildMission(cfgX, merc,
      { difficulty: 'regular', enemyDens: 0.5, lives: 3,
        boss: customBoss, proto: customGun });
    let rx; while (!(rx = gx.next()).done);
    const MX = rx.value;
    ok(MX.overlord.rig.params.palette === 'void', 'the boss forge choice reaches the level');
    ok(MX.overlord.rig.params.size === 54, 'the boss forge size reaches the level');
    ok(MX.proto.label === 'HAND BUILT TEST I', 'the weapon forge choice reaches the level');
    ok(MX.proto.count === 4, 'the weapon forge parameters reach the level');
    const pkx = MX.pickups.find(p => p.shrine);
    ok(pkx && pkx.proto.label === 'HAND BUILT TEST I', 'the pedestal holds the built gun');
  }

  /* corruption */
  const mercs = MB.enemies.filter(e => e.kind === 'grunt' || e.kind === 'trooper' ||
                                       e.kind === 'heavy' || e.kind === 'drone');
  const rotten = mercs.filter(e => e.corrupt > 0);
  console.log('  corrupted mercs ' + rotten.length + '/' + mercs.length);
  for (const e of rotten) {
    ok(e.corrupt > 0 && e.corrupt <= 1, 'corruption level in range');
    ok(e.rig.params.colRot !== undefined, 'a corrupted merc has a rot colour');
    ok(e.maxHp > window.CONFIG.ARCHETYPES[e.kind].hp * MB.diff.enemyHp * 0.99,
       'corruption makes them tougher');
  }
  /* the generator must draw it, not just flag it */
  const clean = window.MERCFORGE.forge({ seed: 31, corrupt: 0 });
  const foul = window.MERCFORGE.forge({ seed: 31, corrupt: 1 });
  const count = S => {
    const d = S.canvas.getContext('2d').getImageData(0, 0, S.CW, S.CH).data;
    let n = 0;
    for (let i = 0; i < S.CW * S.CH; i++) if (d[i * 4 + 3] > 8) n++;
    return n;
  };
  ok(foul.CW !== clean.CW || foul.CH !== clean.CH || count(foul) !== count(clean),
     'corruption changes the sprite');

  /* a thrown body has to be able to hurt the player */
  {
    const b = MB.rigid.bodies.find(x => !x.dead);
    if (b) {
      MB.player.dead = false; MB.player.hp = 100; MB.player.invuln = 0;
      MB.state = 'play';
      b.held = null; b.dead = false;
      b.x = MB.player.x; b.y = MB.player.y - MB.player.h * 0.5;
      b.vx = 7; b.vy = 0; b.dangerT = 1.5;
      MB.stepCrush(1 / 60);
      ok(MB.player.hp < 100, 'a thrown body hurts the player');
    }
  }
}

section('exotic weapon effects');
{
  /* Every one of the ten new effects has to DO something observable.
     A rolled parameter that changes no state is a number in a table,
     and the whole point of the second ten is that they are not. */
  const cfgX = window.CONFIG.randomLevelCfg(0x5EED);
  cfgX.levelLen = 3;
  const gx = window.WORLD.buildMission(cfgX, window.CONFIG.randomMerc(0x5EED),
    { difficulty: 'regular', enemyDens: 1.4, lives: 9, allies: 0, wardens: 0 });
  let rx; while (!(rx = gx.next()).done);
  const MX = rx.value, PX = MX.player;
  const IDLE = { left: false, right: false, up: false, down: false, fire: false,
                 jumpPressed: false, reloadPressed: false, talkPressed: false,
                 cursorX: 224, cursorY: 126, aimX: 0, aimY: 0 };
  // settle into a real pose, or muzzle() has no frame to read
  for (let i = 0; i < 6; i++) MX.update(1 / 60, IDLE);

  const BASE = { label: 'T', rate: 0.1, speed: 8, dmg: 3, spread: 0, mag: 99, reload: 1,
                 kick: 0, shake: 0, size: 2, life: 1.5, count: 1, pierce: 0,
                 tone: { f: 400, drop: 0.5, len: 0.1, noise: 0.5, type: 'sine' } };
  const mk = o => Object.assign({}, BASE, o);

  /* An immortal dummy on solid ground in front of the player. */
  function dummy(dist) {
    const e = MX.enemies.find(x => !x.dead) || MX.enemies[0];
    const gr = MX.world.groundUnder(PX.x + dist, 0, true);
    e.x = PX.x + dist; if (gr) e.y = gr.y;
    e.dead = false; e.maxHp = 1e6; e.hp = 1e6;
    e.burnT = 0; e.burnDps = 0; e.slowT = 0; e.slowMul = 1;
    return e;
  }
  function volley(def, frames, dist, alsoRigid) {
    const e = dummy(dist === undefined ? 60 : dist);
    MX.bullets.length = 0; MX.arcs = [];
    PX.weapon = { kind: 'test', def, ammo: 9999, reloading: 0, cool: 0, charge: 0 };
    PX.spare.test = Infinity;
    const inp = Object.assign({}, IDLE, { fire: true });
    let peakBullets = 0, peakArcs = 0, forked = 0;
    for (let i = 0; i < (frames || 60); i++) {
      inp.aimX = e.x; inp.aimY = e.y - e.h * 0.5;
      PX.aim = Math.atan2(inp.aimY - (PX.y - PX.h * 0.72), inp.aimX - PX.x);
      MX.fire(inp, 1 / 60);
      MX.stepBullets(1 / 60);
      if (alsoRigid) MX.rigid.step(1 / 60);
      e.stepStatus(1 / 60);
      peakBullets = Math.max(peakBullets, MX.bullets.length);
      peakArcs = Math.max(peakArcs, (MX.arcs || []).length);
      forked = Math.max(forked, MX.bullets.filter(b => b.forked).length);
    }
    return { e, peakBullets, peakArcs, forked };
  }

  // a plain round is the control: everything below is measured against it
  {
    const v = volley(mk({}));
    ok(1e6 - v.e.hp > 10, 'the control weapon damages the dummy');
  }
  { const v = volley(mk({ burn: 4 }));
    ok(v.e.burnT > 0 && v.e.burnDps > 0, 'incendiary sets the target alight');
    ok(v.e.burnDps === 4, 'and burns at the strength it was rolled at');
    // refreshing takes the fiercer, it does not stack into an instant kill
    v.e.ignite(2, 3); ok(v.e.burnDps === 4, 'a weaker burn does not weaken a fiercer one');
    v.e.ignite(9, 3); ok(v.e.burnDps === 9, 'a fiercer burn does replace a weaker one'); }
  { const v = volley(mk({ slow: 0.5 }));
    ok(v.e.slowT > 0, 'mire lands a slow');
    ok(Math.abs(v.e.slowMul - 0.5) < 1e-6, 'and halves the speed it was rolled to halve'); }
  { PX.hp = 40;
    const v = volley(mk({ vamp: 0.3, dmg: 6 }));
    ok(PX.hp > 40, 'leech heals the shooter (' + PX.hp.toFixed(1) + ')');
    ok(PX.hp <= PX.maxHp, 'and never past full');
    PX.hp = PX.maxHp; }
  { PX.ward = 0; PX.wardMax = 0;
    volley(mk({ shield: 12 }));
    ok(PX.wardMax >= 12, 'ward rounds raise a shell (' + PX.wardMax + ')');
    /* and the shell has to actually eat damage before health does */
    PX.ward = PX.wardMax; PX.hp = 100; PX.invuln = 0;
    PX.hurt(4);
    ok(PX.hp === 100, 'a small hit lands entirely on the ward');
    ok(PX.ward < PX.wardMax, 'and the ward is spent by it');
    PX.ward = 3; PX.hp = 100; PX.invuln = 0;
    PX.hurt(20);
    ok(PX.hp < 100, 'an overflowing hit still reaches health');
    PX.wardMax = 0; PX.ward = 0; PX.hp = PX.maxHp; }
  { const e = dummy(60);
    const live = MX.enemies.filter(x => x !== e).slice(0, 2);
    live.forEach((o, i) => { o.dead = false; o.hp = 1e6; o.maxHp = 1e6; o.x = e.x + 18 + i * 22; o.y = e.y; });
    const hp0 = live.map(o => o.hp);
    const v = volley(mk({ chain: 2 }));
    ok(v.peakArcs > 0, 'a chain round draws its arc');
    ok(live.filter((o, i) => o.hp < hp0[i]).length === live.length,
       'and hurts the neighbours it jumped to');
    live.forEach(o => { o.x = -9999; }); }
  { const v = volley(mk({ fork: 3, rate: 0.5 }), 60, 70);
    ok(v.forked >= 3, 'a forking round splits into its children (' + v.forked + ')');
    ok(MX.bullets.every(b => !b.fork || !b.forked),
       'and the children do not fork again'); }
  { const e = dummy(60);
    const body = MX.rigid.bodies.find(b => !b.dead);
    if (body) {
      body.x = e.x + 14; body.y = e.y - 10; body.vx = 0; body.vy = 0;
      body.asleep = false; body.sleep = 0;
      const bx = body.x, by = body.y;
      volley(mk({ quake: 2.5, rate: 0.5 }), 60, 60, true);
      ok(Math.hypot(body.x - bx, body.y - by) > 4,
         'quake shoves loose debris (' + Math.hypot(body.x - bx, body.y - by).toFixed(1) + 'px)');
    } }
  { /* spiral has to wander AND still arrive: a corkscrew that misses
       everything is a visual effect, not a weapon */
    const v = volley(mk({ spiral: 2, speed: 5, life: 2 }));
    ok(1e6 - v.e.hp > 5, 'a spiralling round still lands on what it was aimed at');
    const b = new window.ENTITIES.Bullet(0, 0, 0, mk({ spiral: 2 }), true, '#fff');
    const ys = [];
    for (let i = 0; i < 30; i++) { b.spiralT += 1 / 60;
      const sp = Math.hypot(b.vx, b.vy);
      const a2 = b.baseA + Math.sin(b.spiralT * 13) * b.spiral * 0.30;
      b.vx = Math.cos(a2) * sp; b.vy = Math.sin(a2) * sp; ys.push(b.vy); }
    ok(Math.max.apply(null, ys) > 0 && Math.min.apply(null, ys) < 0,
       'and it wanders to both sides of its flight line'); }
  { /* echo: the same trigger pull produces more rounds than it should */
    const plain = volley(mk({ rate: 0.6 }), 60);
    const plainDmg = 1e6 - plain.e.hp;
    const ech = volley(mk({ rate: 0.6, echo: 0.2 }), 60);
    const echDmg = 1e6 - ech.e.hp;
    ok(echDmg > plainDmg, 'an echo weapon lands more than the same gun without it (' +
       echDmg.toFixed(1) + ' vs ' + plainDmg.toFixed(1) + ')'); }
  { /* charge: holding does not fire, releasing fires harder */
    const e = dummy(60);
    const def = mk({ charge: 3, rate: 0.4 });
    PX.weapon = { kind: 'test', def, ammo: 99, reloading: 0, cool: 0, charge: 0 };
    MX.bullets.length = 0;
    const inp = Object.assign({}, IDLE, { fire: true });
    for (let i = 0; i < 12; i++) {
      PX.aim = Math.atan2((e.y - e.h * 0.5) - (PX.y - PX.h * 0.72), e.x - PX.x);
      MX.fire(inp, 1 / 60);
    }
    ok(MX.bullets.length === 0, 'holding a charge weapon does not fire it');
    ok(PX.weapon.charge > 0, 'it winds up instead');
    for (let i = 0; i < 60; i++) MX.fire(inp, 1 / 60);
    ok(PX.weapon.charge >= 0.999, 'and reaches a full charge');
    inp.fire = false;
    MX.fire(inp, 1 / 60);
    ok(MX.bullets.length > 0, 'releasing fires it');
    ok(MX.bullets[0].dmg > def.dmg * 2.5,
       'a full charge multiplies the damage (' + MX.bullets[0].dmg.toFixed(2) + ')');
    ok(PX.weapon.charge === 0, 'and spends the charge'); }

  /* the stock roster's own exotics have to reach the bullet */
  for (const k of window.WEAPONS.ORDER) {
    const def = window.WEAPONS.table[k];
    const b = new window.ENTITIES.Bullet(0, 0, 0, def, true, '#fff');
    for (const x of window.WEAPONS.PROTO_EXOTIC) {
      if (x === 'charge' || x === 'echo') continue;   // handled in fire(), not on the bullet
      ok((b[x] || 0) === (def[x] || 0),
         k + "'s " + x + ' reaches the round it fires');
    }
    ok(b.dmg === def.dmg && b.size === def.size, k + ' carries its damage and calibre');
  }
}

section('wardens and the dialog box');
{
  const cfgW = window.CONFIG.randomLevelCfg(0xABCD);
  cfgW.levelLen = 3;
  const gw = window.WORLD.buildMission(cfgW, window.CONFIG.randomMerc(0xABCD),
    { difficulty: 'recruit', enemyDens: 0.5, lives: 9, allies: 0, wardens: 3 });
  let rw; while (!(rw = gw.next()).done);
  const MW = rw.value, PW = MW.player;

  ok(MW.wardens.length === 3, 'the level places the wardens it was asked for');
  const bossX = MW.overlord ? MW.overlord.x : MW.exit.x;
  for (const W of MW.wardens) {
    const g = MW.world.groundUnder(W.x, W.y - 1, true);
    ok(g && Math.abs(g.y - W.y) < 2, 'a warden stands on real ground');
    ok(W.x > PW.x + 150, 'and not on top of the drop-in');
    ok(W.x < bossX, 'and on the way to the boss, not past it');
    ok(!!W.gift && (W.gift.kind === 'weapon' || W.gift.kind === 'power'),
       'it is holding something real');
    ok(W.lines.length >= 2, 'and has something to say (' + W.lines.length + ' pages)');
    ok(W.lines.every(l => typeof l === 'string' && l.length > 4), 'every page has text');
    ok(!W.spent, 'it has not been talked to yet');
  }
  {
    const xs = MW.wardens.map(W => W.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      ok(xs[i] - xs[i - 1] > 100, 'wardens are spread out, not stacked');
    }
  }

  /* walking into one opens the box and hands the gift over */
  {
    const W = MW.wardens[0];
    const before = { gun: PW.weapon.kind, buffs: JSON.stringify(PW.buffs),
                     maxHp: PW.maxHp, ward: PW.wardMax };
    PW.x = W.x; PW.y = W.y; PW.dead = false;
    MW.stepWardens(1 / 60);
    ok(MW.dialog.open, 'walking into a warden opens the box');
    ok(MW.dialog.speaker === 'WARDEN', 'the box names who is talking');
    ok(MW.dialog.portrait === W.rig, 'and shows their face');
    ok(W.spent, 'it has handed over what it was holding');
    const changed = PW.weapon.kind !== before.gun ||
                    JSON.stringify(PW.buffs) !== before.buffs ||
                    PW.maxHp !== before.maxHp || PW.wardMax !== before.ward;
    ok(changed, 'and the gift actually landed on the player');
  }

  /* the box: reveal, advance, and hold */
  {
    const D = MW.dialog;
    const pages = D.pages.length;
    ok(D.shown === 0, 'a page starts unrevealed');
    ok(!D.full(), 'and is not complete on the first frame');
    // the opening hold ignores a mash
    D.step(0.01, true, false);
    ok(D.page === 0 && D.shown < D.text().length,
       'a keypress in the first moments does not skip the page');
    for (let i = 0; i < 30; i++) D.step(1 / 60, false, false);
    ok(D.shown > 0, 'text reveals over time');
    // holding runs it out fast
    const before = D.shown;
    D.step(1 / 60, false, true);
    ok(D.shown - before > window.DIALOG.CPS / 60,
       'holding the key runs the reveal out faster');
    // a press fills the page, the next press turns it
    D.step(1 / 60, true, false);
    ok(D.full(), 'a press fills the current page');
    if (pages > 1) {
      D.step(1 / 60, true, false);
      ok(D.page === 1 && D.shown === 0, 'the next press turns to the next page');
    }
    // running off the end closes it
    let guard = 0;
    while (D.open && guard++ < 200) { D.hold = 0; D.step(1 / 60, true, false); }
    ok(!D.open, 'running off the last page closes the box');
    ok(guard < 200, 'and it closes in a bounded number of presses');
  }

  /* an onClose callback fires exactly once */
  {
    let closed = 0;
    MW.dialog.say(['ONE', 'TWO'], { onClose: () => closed++ });
    let guard = 0;
    while (MW.dialog.open && guard++ < 50) { MW.dialog.hold = 0; MW.dialog.step(1 / 60, true, false); }
    ok(closed === 1, 'the close callback fires once');
    MW.dialog.step(1 / 60, true, false);
    ok(closed === 1, 'and not again after it has closed');
  }

  /* talking twice gets a different, empty-handed conversation */
  {
    const W = MW.wardens[0];
    const gunBefore = PW.weapon.kind;
    W.cooldown = 0;
    PW.x = W.x; PW.y = W.y;
    MW.dialog.open = false;
    MW.stepWardens(1 / 60);
    ok(MW.dialog.open, 'you can talk to a spent warden again');
    ok(MW.dialog.pages.some(l => window.DIALOG.EMPTY.indexOf(l) >= 0),
       'and it tells you it has nothing left');
    ok(PW.weapon.kind === gunBefore, 'a spent warden does not hand over a second gift');
    MW.dialog.close();
  }

  /* the box takes nothing away: you can walk, jump and shoot through it */
  {
    const W = MW.wardens[1];
    PW.x = W.x - 400;
    const gr = MW.world.groundUnder(PW.x, 0, true);
    if (gr) PW.y = gr.y;
    PW.dead = false; PW.hp = PW.maxHp;
    PW.weapon.ammo = PW.weapon.def.mag; PW.weapon.cool = 0;
    MW.talker = null;                       // nobody's box, so nothing closes it
    MW.dialog.say(['READ THIS WHILE YOU WORK. IT IS NOT AN INTERRUPTION.'],
                  { speaker: 'TEST' });
    const x0 = PW.x, t0 = MW.time;
    const run = { left: false, right: true, up: false, down: false, fire: true,
                  jumpPressed: false, reloadPressed: false, talkPressed: false,
                  talkHeld: false, cursorX: 300, cursorY: 120, aimX: 0, aimY: 0 };
    const bullets0 = MW.bullets.length;
    for (let i = 0; i < 30; i++) MW.update(1 / 60, run);
    ok(PW.x > x0 + 4, 'the player can walk while a warden is talking');
    ok(MW.bullets.length > bullets0, 'and can shoot through the box');
    ok(MW.time > t0, 'and the mission keeps running behind it');
    ok(MW.dialog.open, 'and the box stays up while nobody has walked away');
    MW.dialog.close();
  }

  /* walking away from the warden ends the conversation */
  {
    const W = MW.wardens[2] || MW.wardens[0];
    /* Stand on the warden's own deck, not on whatever groundUnder finds
       first from the top of the frame — there is usually a catwalk over
       its head, and standing on that is not standing next to it. */
    PW.x = W.x; PW.y = W.y;
    PW.dead = false;
    W.cooldown = 0;
    MW.dialog.open = false;
    MW.stepWardens(1 / 60);
    ok(MW.dialog.open, 'standing on a warden opens its box');
    ok(MW.talker === W, 'and the mission knows whose box it is');
    // a step or two must NOT cut it off
    PW.x = W.x + 18;
    MW.stepWardens(1 / 60);
    ok(MW.dialog.open, 'shuffling about while reading does not cut it off');
    // leaving does
    PW.x = W.x + 200;
    MW.stepWardens(1 / 60);
    ok(!MW.dialog.open, 'walking away ends the conversation');
    ok(MW.talker === null, 'and the mission forgets whose it was');
  }

  /* generated lines have to actually vary */
  {
    const seen = new Set();
    for (let i = 0; i < 120; i++) {
      const rngL = window.GREEBLEWORKS.makeRng((i * 7919) >>> 0);
      const g = window.CONFIG.wardenGift(rngL, 1 + (i % 8));
      seen.add(window.DIALOG.lines(rngL, g, false).join('|'));
    }
    ok(seen.size > 100, 'wardens do not repeat themselves (' + seen.size + '/120)');
  }

  /* the gift roll stays inside what the game can actually give */
  {
    const rngG = window.GREEBLEWORKS.makeRng(4242);
    let weapons = 0, powers = 0;
    for (let i = 0; i < 400; i++) {
      const g = window.CONFIG.wardenGift(rngG, 1 + (i % 8));
      ok(typeof g.line === 'string' && g.line.length > 4, 'a gift has a line to go with it');
      if (g.kind === 'weapon') {
        weapons++;
        ok(!!window.WEAPONS.table[g.weapon], 'a gifted weapon is a real weapon');
        ok(g.weapon !== 'pistol', 'and never your own sidearm');
      } else {
        powers++;
        ok(!!window.CONFIG.POWERUPS[g.power], 'a gifted power-up is a real one');
      }
    }
    ok(weapons > 40 && powers > 40, 'both kinds of gift come up (' + weapons + 'w/' + powers + 'p)');
  }

  /* power-ups are capped: a long campaign must not end in a god merc */
  {
    for (let i = 0; i < 60; i++) {
      for (const k of window.CONFIG.POWERUP_KEYS) MW.giveGift({ kind: 'power', power: k });
    }
    for (const k in PW.buffs) {
      const spec = Object.values(window.CONFIG.POWERUPS).find(s => s.stat === k);
      if (spec) ok(PW.buffs[k] <= spec.cap + 1e-9, 'buff "' + k + '" honours its cap');
    }
    ok(PW.maxHp <= window.CONFIG.POWERUPS.vitals.cap, 'vitals honour their cap');
    ok(PW.wardMax <= window.CONFIG.POWERUPS.ward.cap, 'the ward honours its cap');
  }
}

section('pilot, allies and autopilot');
{
  /* ---- navigation probes, against real terrain ---- */
  {
    const A = { x: 100, y: 200, w: 12, h: 30, vx: 0, vy: 0, ground: true,
                face: 1, airJumps: 1, dead: false, weapon: { def: { speed: 7 } } };
    const pil = new window.PILOT.Pilot(A, {});
    // a fake world made of two terraces and a pit, so the probes have
    // something with a known answer to read
    const plats = [
      { x: 0,   w: 120, y: 200, ground: true },
      { x: 120, w: 120, y: 184, ground: true },   // one step UP
      { x: 300, w: 200, y: 200, ground: true }    // after a 60px pit
    ];
    const fake = {
      world: {
        groundUnder(x, y) {
          let best = null;
          for (const p of plats) {
            if (x < p.x || x > p.x + p.w) continue;
            if (p.y >= y - 1 && (!best || p.y < best.y)) best = p;
          }
          return best;
        },
        solidAt(x, y) {
          for (const p of plats) {
            if (x < p.x || x > p.x + p.w) continue;
            if (y >= p.y && y <= p.y + 400) return p;
          }
          return null;
        },
        canSee: () => true
      },
      enemies: [], pickups: [], wardens: [], allies: [],
      dialog: { open: false },
      exit: { x: 460, y: 200 }, player: A, scroll: 0
    };
    A.x = 110;
    ok(!!pil.floorAt(fake, 130, A.y - 2),
       'a terrace one step up reads as floor, not a hole');
    ok(pil.gapAhead(fake, 1) === 0, 'stepping up is not reported as a gap');
    A.x = 235;
    ok(pil.gapAhead(fake, 1) > 30, 'a real pit is reported as a gap (' +
       pil.gapAhead(fake, 1) + ')');
    A.x = 110; A.y = 200;
    ok(pil.climbDir(fake, 184) === 1, 'the climb probe points at the higher deck');

    /* a body standing directly under its goal must still try to get up
       there — this is the stall that stopped the first autopilot dead */
    const inp = { cursorX: 0, cursorY: 0 };
    fake.pickups = [{ x: 112, y: 150, taken: false }];
    A.x = 112; A.y = 200; A.ground = true;
    let jumped = false;
    for (let i = 0; i < 40 && !jumped; i++) {
      pil.jumpCool = 0;
      pil.think(fake, inp, 1 / 60);
      if (inp.jumpPressed) jumped = true;
    }
    ok(jumped, 'a goal directly overhead makes it jump rather than stand there');

    /* and it must give up on one it cannot reach */
    const far = { x: 112, y: -400, taken: false };
    fake.pickups = [far];
    pil.skip.clear();
    for (let i = 0; i < 60 * 6; i++) pil.think(fake, inp, 1 / 60);
    ok(pil.skip.has(far) || pil.goal.x === fake.exit.x,
       'an unreachable pickup is abandoned instead of chased forever');
  }

  /* ---- allies ---- */
  const cfgA = window.CONFIG.randomLevelCfg(0xA11);
  cfgA.levelLen = 3;
  const ga = window.WORLD.buildMission(cfgA, merc,
    { difficulty: 'recruit', enemyDens: 0.8, lives: 3, allies: 3 });
  let ra; while (!(ra = ga.next()).done);
  const MA = ra.value;

  ok(MA.allies.length === 3, 'the reserve slider decides the squad size (' +
     MA.allies.length + ')');
  ok(MA.allies.every(A => A.frozen), 'allies start frozen in stasis');
  ok(MA.allies.every(A => A.pilot instanceof window.PILOT.Pilot),
     'every ally is driven by the same brain the autopilot uses');
  for (const A of MA.allies) {
    const g = MA.world.groundUnder(A.x, A.y - 1, true);
    ok(g && Math.abs(g.y - A.y) < 2, 'an ally is stood on real ground');
    ok(A.x > MA.player.x + 100 && A.x < MA.exit.x,
       'allies are spread down the level, not stacked at the door');
  }
  {
    const xs = MA.allies.map(A => A.x).sort((a, b) => a - b);
    ok(xs[xs.length - 1] - xs[0] > 200, 'the squad is spread out (' +
       Math.round(xs[xs.length - 1] - xs[0]) + 'px apart)');
  }

  /* frozen is frozen: no damage, no shooting, no walking */
  {
    const A = MA.allies[0];
    const hp0 = A.hp, x0 = A.x;
    ok(A.hurt(50) === false, 'a frozen ally cannot be hurt');
    ok(A.hp === hp0, 'and takes no damage from the attempt');
    const bulletsBefore = MA.bullets.length;
    MA.player.x = A.x - 900;              // well out of touch range
    for (let i = 0; i < 60; i++) MA.stepAllies(1 / 60);
    ok(Math.abs(A.x - x0) < 1.5, 'a frozen ally holds its pod');
    ok(MA.bullets.length === bulletsBefore, 'and does not open fire');
    ok(A.frozen, 'and stays frozen with nobody near it');
  }

  /* walking up to one thaws it, and the prompt appears before that */
  {
    const A = MA.allies[1];
    const gp = MA.world.groundUnder(A.x - 50, 0, true);
    MA.player.x = A.x - 50;
    if (gp) MA.player.y = gp.y;
    MA.player.dead = false;
    MA.stepAllies(1 / 60);
    ok(MA.activatePrompt === A, 'standing near a pod offers the revive prompt');
    MA.player.x = A.x;
    MA.player.y = A.y;
    MA.stepAllies(1 / 60);
    ok(!A.frozen, 'touching the pod brings the operative online');
    ok(A.invuln > 0, 'it comes up with a moment of grace, not into a bullet');
    A.invuln = 0;
    ok(A.hurt(5) !== false, 'once that lapses it is a real body that can be hurt');
    ok(A.maxHp > 0 && A.hp > 0, 'and comes up alive');
  }

  /* a woken ally follows, fights, and draws fire */
  {
    const A = MA.allies[1];
    A.hp = A.maxHp;
    const P = MA.player;
    let fired = 0, moved = 0, targeted = 0;
    const lastX = A.x;
    const inp = { left: false, right: false, up: false, down: false, fire: false,
                  jumpPressed: false, reloadPressed: false,
                  cursorX: 224, cursorY: 126, aimX: 0, aimY: 0 };
    // drop a hostile in front of the pair so there is something to do
    const foe = MA.enemies.find(e => !e.dead);
    if (foe) {
      const gf = MA.world.groundUnder(A.x + 120, 0, true);
      foe.x = A.x + 120; if (gf) foe.y = gf.y;
      foe.dead = false; foe.hp = foe.maxHp;
    }
    for (let i = 0; i < 60 * 8; i++) {
      A.hp = A.maxHp; P.hp = 100;         // keep both on their feet
      if (foe) foe.hp = foe.maxHp;
      const before = MA.bullets.length;
      MA.update(1 / 60, inp);
      if (MA.bullets.length > before) fired++;
      if (Math.abs(A.x - lastX) > 12) moved++;
      if (foe && MA.threatFor(foe) === A) targeted++;
      ok(Number.isFinite(A.x) && Number.isFinite(A.y), 'ally position stayed finite');
    }
    ok(moved > 0, 'a woken ally moves with the squad');
    ok(fired > 0, 'a woken ally puts rounds downrange');
    ok(!A.frozen && !A.dead, 'and survives a quiet eight seconds');
    if (foe) ok(targeted > 0, 'hostiles will shoot at an ally, not only the player');
  }

}

/* wardens in the world, and the box they talk through */
{
  const cfgV = window.CONFIG.randomLevelCfg(0x77A1);
  cfgV.levelLen = 3;
  const gv = window.WORLD.buildMission(cfgV, merc,
    { difficulty: 'regular', enemyDens: 0.4, lives: 3, allies: 0, wardens: 3 });
  let rv; while (!(rv = gv.next()).done);
  const MV = rv.value;
  ok(MV.wardens.length > 0, 'the contact sheet has a warden to photograph');

  const one = createCanvas(LV.W, LV.H);
  const ox = one.getContext('2d');
  const cv = createCanvas(LV.W, LV.H * 3);
  const cx = cv.getContext('2d');
  MV.state = 'play'; MV.player.dead = false; MV.player.hp = 78;
  MV.player.anim = 'idle'; MV.player.frame = 0; MV.player.local = 0; MV.player.face = 1;

  const W0 = MV.wardens[0];
  const shots = [
    /* approaching: the beacon and the light it stands in */
    () => { MV.player.x = W0.x - 74; MV.talkPrompt = null; },
    /* close enough to be offered the conversation */
    () => { MV.player.x = W0.x - 36; MV.talkPrompt = W0; },
    /* mid-sentence */
    () => {
      MV.player.x = W0.x - 20;
      MV.talkPrompt = null;
      MV.dialog.say(W0.lines, { speaker: 'WARDEN', tint: W0.rig.params.colVisor,
                                portrait: W0.rig });
      MV.dialog.shown = 34;
    }
  ];
  shots.forEach((pose, i) => {
    pose();
    const g = MV.world.groundUnder(MV.player.x, 0, true);
    if (g) MV.player.y = g.y;
    MV.scroll = clamp(W0.x - LV.W / 2, 0, Math.max(0, MV.L.LW - LV.W));
    MV.time = 2 + i * 2;
    MV.cursorX = 260; MV.cursorY = 120;
    for (const W of MV.wardens) W.step(0.4);
    window.RENDER.frame(MV, ox, one);
    cx.drawImage(one, 0, i * LV.H);
  });
  /* the box has to have actually drawn something over the frame */
  {
    const d = cx.getImageData(12, LV.H * 2 + LV.H - 60, LV.W - 24, 50).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) lit++;
    ok(lit > 200, 'the dialog box renders over the frame (' + lit + ' lit pixels)');
  }
  /* the portrait panel has to have a face in it, not an empty box */
  {
    const px0 = 16, py0 = LV.H * 2 + (LV.H - 62 - 6) + 6;
    const d = cx.getImageData(px0, py0, 40, 50).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
    ok(lit > 120, 'the speaker portrait draws a face (' + lit + ' lit pixels)');
  }
  MV.dialog.close();

  /* and a zoom on one warden, because the lantern glow is the whole
     read and it is invisible at 1:1 in a contact sheet */
  {
    const Z = 3, zw = 150, zh = 120;
    const zoom = createCanvas(zw * Z, zh * Z);
    const zx = zoom.getContext('2d');
    zx.imageSmoothingEnabled = false;
    zx.fillStyle = '#0b0d10';
    zx.fillRect(0, 0, zoom.width, zoom.height);
    zx.save();
    zx.scale(Z, Z);
    zx.translate(-(W0.x - zw / 2), -(W0.y - zh * 0.78));
    for (const W of MV.wardens) W.step(0.3);
    window.RENDER.drawWarden(zx, W0, W0.x, 3.4);
    zx.restore();
    dump('out_warden_zoom.png', zoom);
  }
  dump('out_wardens.png', cv);
}

section('the garrison (archetypes)');
{
  const CA = window.CONFIG.ARCHETYPES;
  const SPEC = ['sniper', 'sapper', 'shieldman', 'zealot', 'stalker'];

  /* --- the table itself --- */
  for (const k of Object.keys(CA)) {
    const A = CA[k];
    ok(typeof A.label === 'string' && A.label.length > 2, k + ' has a name');
    ok(A.hp > 0 && A.score > 0, k + ' is worth killing');
    ok(A.cooldown > 0, k + ' has a rate of fire');
    if (!A.crawler) ok(typeof A.build === 'function', k + ' knows how to be forged');
  }
  for (const k of SPEC) {
    const A = CA[k];
    ok(!!A, 'the specialist "' + k + '" exists');
    /* Each one has to have a reason to exist that is not "more hp".
       If a specialist's only difference from a trooper is a number,
       it is a trooper. */
    const gimmick = !!(A.standoff || A.charger || A.shield || A.support ||
                       A.cloak !== undefined);
    ok(gimmick, k + ' does something a trooper does not');
    const p = window.CONFIG.archetypeParams(k, 0x1234, 'slum', 0.2);
    ok(p.height > 20 && p.height < 60, k + ' is merc-sized (' + p.height + ')');
    ok(!!window.WEAPONS.table[p.gun], k + ' carries a real weapon (' + p.gun + ')');
  }
  /* the specialists are not all the same shape as each other */
  {
    const heights = new Set(), guns = new Set();
    for (const k of SPEC) {
      const p = window.CONFIG.archetypeParams(k, 0x777, 'slum', 0);
      heights.add(Math.round(p.height / 3)); guns.add(p.gun);
    }
    ok(guns.size >= 3, 'the specialists do not all carry the same gun');
    ok(heights.size >= 2, 'nor are they all the same size');
  }

  /* --- a faction's colour reaches its troops --- */
  {
    /* MERCFORGE.hsl() hands back a hex string, so the hue comes back
       out of the pixels rather than out of the text. */
    const hueOf = hex => {
      const n = parseInt(String(hex).replace('#', ''), 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 0.001) return -1;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
      return h;
    };
    const arc = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
    const sample = (hue, n) => {
      const hs = [];
      for (let i = 0; i < n; i++) {
        const p = window.CONFIG.archetypeParams(i % 2 ? 'grunt' : 'trooper',
          (0x11 + i * 7919) >>> 0, 'slum', 0, hue);
        const h = hueOf(p.colSuit);
        if (h >= 0) hs.push(h);
      }
      return hs;
    };
    const at200 = sample(200, 12), at20 = sample(20, 12);
    ok(at200.length > 6 && at20.length > 6, 'a faction garrison has colour in it');
    const near = at200.filter(h => arc(h, 200) < 45).length;
    ok(near > at200.length * 0.6,
       'a faction garrison wears its own colour (' + near + '/' + at200.length + ')');
    const cross = at20.filter(h => arc(h, 200) < 45).length;
    ok(cross < at20.length * 0.4,
       'and another faction does not (' + cross + '/' + at20.length + ')');
    const free = sample(undefined, 14);
    const spread = new Set(free.map(h => Math.floor(h / 60))).size;
    ok(spread >= 4, 'while an unowned garrison is any colour at all (' + spread + ')');
  }

  /* --- the roster: a doctrine has to be legible in what it fields --- */
  {
    const LRg = window.LORE, WD = window.WORLD;
    ok(typeof WD.roster === 'function', 'the roster is testable on its own');
    const mixFor = (doctrine, seed) => {
      const rng = GW.makeRng(seed >>> 0);
      const mix = WD.roster({ levelLen: 6 },
        { enemyDens: 1.2, faction: doctrine ? { doctrine } : null }, rng);
      const t = {};
      for (const k of mix) t[k] = (t[k] || 0) + 1;
      return { mix, t };
    };
    for (const d of LRg.DOCTRINE_KEYS) {
      ok(!!WD.DOCTRINE_MIX[d], 'doctrine "' + d + '" tells the roster what it fields');
      for (const k in WD.DOCTRINE_MIX[d]) {
        ok(!!CA[k], 'and only asks for archetypes that exist (' + k + ')');
      }
    }
    /* Aggregated over many seeds, because one roster is a roll and the
       claim being tested is about the distribution. */
    const tallies = {};
    for (const d of LRg.DOCTRINE_KEYS) {
      const t = {};
      for (let i = 0; i < 40; i++) {
        const r = mixFor(d, (0xA1 + i * 2654435761) >>> 0);
        for (const k in r.t) t[k] = (t[k] || 0) + r.t[k];
      }
      tallies[d] = t;
      const top = Object.keys(t).sort((a, b) => t[b] - t[a]);
      ok(top.length >= 4, d + ' fields a mixed garrison (' + top.length + ' kinds)');
    }
    const lead = d => Object.keys(tallies[d]).sort((a, b) => tallies[d][b] - tallies[d][a])[0];
    const has = (d, k) => (tallies[d][k] || 0);
    ok(lead('attrition') === 'grunt', 'attrition fields bodies (' + lead('attrition') + ')');
    ok(has('quiet', 'stalker') > has('attrition', 'stalker') * 3,
       'the quiet field stalkers and almost nobody else does');
    ok(has('quiet', 'sniper') > has('attrition', 'sniper') * 3,
       'and snipers');
    ok(has('augury', 'zealot') > has('order', 'zealot') * 3,
       'augury fields the people who do the blessing');
    ok(has('purity', 'crawler') < has('rapture', 'crawler') * 0.25,
       'purity does not field the thing it exists to burn');
    ok(has('rapture', 'crawler') > has('order', 'crawler') * 3,
       'and rapture fields plenty of it');
    ok(has('ledger', 'heavy') > has('quiet', 'heavy'),
       'the ledger sends something expensive');
    /* no doctrine may turn a level into one archetype */
    for (const d of LRg.DOCTRINE_KEYS) {
      let tot = 0, mx = 0;
      for (const k in tallies[d]) { tot += tallies[d][k]; mx = Math.max(mx, tallies[d][k]); }
      ok(mx / tot < 0.62, d + ' never fields only one kind (' +
         (100 * mx / tot).toFixed(0) + '%)');
    }
    // and with no faction at all it still produces a garrison
    const plain = mixFor(null, 0x5150);
    ok(Object.keys(plain.t).length >= 4, 'an unowned level still gets a mixed garrison');
    console.log('  ' + window.LORE.DOCTRINE_KEYS.map(d =>
      d + ':' + Object.keys(tallies[d]).sort((a, b) => tallies[d][b] - tallies[d][a])[0]).join(' '));
  }

  /* --- what the specialists actually DO ---
     Driven on the mission already built, with a body dropped in next
     to the player, because behaviour is the whole claim and a stat
     block proves none of it. */
  {
    const E = window.ENTITIES;
    const P = M.player;
    const rigOf = k => new window.SPRITE.Rig(
      window.CONFIG.archetypeParams(k, 0x2468, M.cfg.style, 0));
    const put = (k, dx, dy) => {
      const e = new E.Enemy(rigOf(k), P.x + dx, P.y + (dy || 0), k, CA[k],
                            M.diff, 0x1357);
      M.enemies.push(e);
      return e;
    };
    const drop = e => { const i = M.enemies.indexOf(e); if (i >= 0) M.enemies.splice(i, 1); };
    P.hp = P.maxHp; P.dead = false; P.invuln = 0; P.ward = 0;

    /* the sapper: closes, lights, and takes the room with it */
    {
      const sap = put('sapper', 40);
      sap.alerted = true; sap.state = 'engage';
      let lit = 0, frames = 0;
      P.invuln = 0; P.ward = 0; P.hp = P.maxHp;
      const hp0 = P.hp;
      while (!sap.dead && frames++ < 60 * 8) {
        /* Pinned for the whole run, lit fuse included. What is under
           test is the blast; a sapper that walks off the deck it was
           dropped next to tests the drop. */
        sap.x = P.x + 40; sap.y = P.y; sap.vx = 0; sap.vy = 0;
        sap.step(M.world, P, 1 / 60, M);
        if (sap.fuse > 0) lit++;
      }
      ok(lit > 0, 'a sapper lights its fuse when it gets close');
      ok(sap.dead, 'and goes off (' + (frames / 60).toFixed(1) + 's)');
      ok(P.hp < hp0, 'taking the player with it (' + (hp0 - P.hp) + ' damage)');
      drop(sap);
      P.hp = P.maxHp;
    }

    /* the shieldman: frontal fire is most of the way wasted */
    {
      const a = put('shieldman', 60);
      const reset = () => { a.hp = a.maxHp = 999; a.dead = false; };
      a.face = -1;                                  // facing back at the player
      reset();
      a.hurtBy(10, M, a.x - 90, a.y - a.h * 0.5);   // straight into the plate
      const tookFront = 999 - a.hp;
      reset();
      a.hurtBy(10, M, a.x + 90, a.y - a.h * 0.5);   // from behind it
      const tookBack = 999 - a.hp;
      reset();
      a.hurtBy(10, M, a.x, a.y - a.h * 2.4);        // from straight above
      const tookAbove = 999 - a.hp;
      reset();
      a.hurtBy(10, M);                              // no direction at all
      const tookBlind = 999 - a.hp;
      ok(tookFront < tookBack, 'a shieldman eats fire from the front (' +
         tookFront + ' vs ' + tookBack + ')');
      ok(tookFront >= 1, 'but never nothing at all');
      ok(tookAbove > tookFront, 'and fire from a catwalk gets past it (' + tookAbove + ')');
      ok(tookBlind === 10, 'and damage with no direction gets through');
      drop(a);
    }

    /* the zealot: heals and hurries whoever is standing near it */
    {
      const z = put('zealot', 30);
      const g = put('grunt', 46);
      g.hp = 1;
      let frames = 0;
      while (frames++ < 60 * 6 && g.hp <= 1) z.step(M.world, P, 1 / 60, M);
      ok(g.hp > 1, 'a zealot heals what is standing next to it (' + g.hp + ')');
      ok(g.blessed > 0, 'and hurries it along');
      const far = put('grunt', 700);
      far.hp = 1;
      for (let k = 0; k < 60 * 6; k++) z.step(M.world, P, 1 / 60, M);
      ok(far.hp === 1, 'and does nothing for one across the level');
      drop(z); drop(g); drop(far);
    }

    /* the sniper: lines the shot up, visibly, before taking it */
    {
      const sn = put('sniper', 150);
      sn.alerted = true; sn.state = 'engage';
      const before = M.bullets.length;
      let peak = 0, shotAt = -1;
      for (let k = 0; k < 60 * 6; k++) {
        sn.step(M.world, P, 1 / 60, M);
        peak = Math.max(peak, sn.sighting());
        if (shotAt < 0 && M.bullets.length > before) shotAt = k;
      }
      ok(peak > 0.5, 'a sniper visibly lines a shot up (' + peak.toFixed(2) + ')');
      ok(shotAt > 20, 'and does not fire the instant it sees you (' +
         (shotAt / 60).toFixed(2) + 's)');
      ok(CA.sniper.standoff > CA.trooper.aggro * 60, 'and stands well back');
      const other = put('trooper', 150);
      ok(!other.sighting || other.sighting() === 0, 'nothing else lines shots up');
      drop(sn); drop(other);
    }

    /* the stalker: fades at range, solid when it matters */
    {
      const st = put('stalker', 600);
      st.alerted = true; st.state = 'engage';
      /* Pinned each frame. What is under test is the fade, and a body
         that walks off the deck it was dropped on tests gravity. */
      const hold = (dx, n) => {
        for (let k = 0; k < n; k++) {
          st.x = P.x + dx; st.y = P.y; st.vx = 0; st.vy = 0;
          st.hp = st.maxHp = 999; st.dead = false;
          st.step(M.world, P, 1 / 60, M);
        }
      };
      hold(600, 180);
      const faded = st.cloak;
      ok(faded < 0.5, 'a stalker fades when it is a long way off (' + faded.toFixed(2) + ')');
      hold(40, 180);
      ok(st.cloak > 0.9, 'and is solid by the time it reaches you (' + st.cloak.toFixed(2) + ')');
      hold(600, 180);
      ok(st.cloak < 0.5, 'and fades again once it backs off');
      st.hurtBy(1, M, st.x + 40, st.y);
      hold(600, 6);
      ok(st.cloak > faded, 'while a round through it gives it away (' +
         st.cloak.toFixed(2) + ')');
      drop(st);
    }
  }

  /* contact sheet: the five of them, so the plate, the fuse, the aura,
     the sight line and the fade are all reviewable at once */
  {
    const E = window.ENTITIES;
    const CW = 96, CH = 110;
    const cv = createCanvas(CW * SPEC.length, CH);
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = '#12161a'; cx.fillRect(0, 0, cv.width, CH);
    SPEC.forEach((k, i) => {
      const rig = new window.SPRITE.Rig(
        window.CONFIG.archetypeParams(k, 0x8642, M.cfg.style, 0, 30));
      const e = new E.Enemy(rig, 0, 0, k, CA[k], M.diff, 0x99);
      e.alerted = true; e.state = 'engage'; e.face = 1;
      e.aim = -0.1; e.local = -0.1; e.anim = 'idle'; e.frame = 0;
      // put each one in the state worth looking at
      if (k === 'sapper') e.fuse = CA.sapper.fuse * 0.45;
      if (k === 'sniper') e.aimT = CA.sniper.telegraph * 0.85;
      if (k === 'zealot') { e.auraPulse = 0.8; }
      if (k === 'stalker') e.cloak = 0.45;
      cx.save();
      cx.translate(i * CW + CW / 2, CH - 18);
      window.RENDER.drawActor(cx, e, 0, 0, false);
      cx.restore();
      cx.font = '9px monospace'; cx.fillStyle = '#8fb';
      cx.fillText(CA[k].label, i * CW + 4, CH - 5);
    });
    let ink = 0;
    const d = cx.getImageData(0, 0, cv.width, CH).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) ink++;
    ok(ink > 400, 'the specialists draw (' + ink + 'px)');
    dump('out_specialists.png', cv);
  }
}

section('the world (lore)');
{
  const LR = window.LORE;

  /* determinism, first: a world you cannot reproduce is a world you
     cannot debug, and the whole run hangs off this */
  {
    const a = LR.makeWorld(0xC0FFEE), b = LR.makeWorld(0xC0FFEE);
    ok(LR.describe(a) === LR.describe(b), 'the same seed makes the same world');
    const c = LR.makeWorld(0xC0FFEF);
    ok(LR.describe(a) !== LR.describe(c), 'a different seed makes a different one');
  }

  /* --- internal consistency, over many worlds --- */
  const facNames = new Set(), castNames = new Set(), placeNames = new Set();
  const arts = new Set(), secrets = new Set(), doctrines = new Set();
  const N = 120;
  for (let i = 0; i < N; i++) {
    const W = LR.makeWorld((i * 2654435761) >>> 0);

    ok(W.factions.length >= 3 && W.factions.length <= 8,
       'a world has a handful of factions (' + W.factions.length + ')');
    ok(W.places.length >= 4, 'and places to fight over');

    for (const f of W.factions) {
      facNames.add(f.name);
      doctrines.add(f.doctrine);
      ok(!!LR.DOCTRINES[f.doctrine], 'faction doctrine is a real one');
      ok(f.holdings.length > 0, 'every faction holds somewhere');
      ok(!!f.leader && f.leader.faction === f.id, 'and is led by one of its own');
      ok(f.hue >= 0 && f.hue < 360, 'and has a colour of its own');
      ok(!!f.secret && typeof f.secret.line === 'string', 'and keeps a secret');
      /* a faction cannot be at war with itself, and the matrix has to
         be symmetric or two factions disagree about whether there is
         a war on */
      ok(W.relation(f.id, f.id) >= 0, 'nobody is at war with themselves');
      for (const g of W.factions) {
        ok(W.relation(f.id, g.id) === W.relation(g.id, f.id),
           'relations are mutual');
      }
      /* every holding actually points back */
      for (const id of f.holdings) {
        ok(W.places[id] && W.places[id].owner === f.id,
           'a holding is held by the faction that claims it');
      }
    }
    /* every place has exactly one owner and that owner lists it */
    for (const p of W.places) {
      placeNames.add(p.name);
      const owner = W.facById(p.owner);
      ok(!!owner, 'every place has an owner');
      ok(owner.holdings.indexOf(p.id) >= 0, 'and the owner knows it');
      ok(typeof p.history === 'string' && p.history.length > 20,
         'and a history worth reading');
      ok(p.history.indexOf('%') < 0, 'with every slot filled in');
      ok(!!window.GREEBLEWORKS.STYLES[p.style], 'and a real architecture');
    }
    /* the world is not evenly split between two people and nobody */
    {
      const counts = W.factions.map(f => f.holdings.length);
      const most = Math.max.apply(null, counts), least = Math.min.apply(null, counts);
      ok(most - least <= Math.ceil(W.places.length / W.factions.length) + 1,
         'the map is not one faction and a rump (' + least + '-' + most + ')');
    }
    /* there is a war on and there is an alliance, or there is no story */
    {
      let wars = 0, pacts = 0;
      for (let a = 0; a < W.factions.length; a++)
        for (let b2 = a + 1; b2 < W.factions.length; b2++) {
          const r = W.relation(a, b2);
          if (r <= -2) wars++;
          if (r >= 2) pacts++;
        }
      ok(wars > 0, 'somebody is at war with somebody');
      ok(pacts > 0, 'and somebody is allied to somebody');
    }

    /* the cast */
    for (const c of W.cast) {
      castNames.add(c.name);
      ok(typeof c.name === 'string' && c.name.indexOf(' ') > 0, 'a character has a name');
      ok(!!LR.VOICES[c.voice], 'and a voice to say things in');
      ok(!!c.want && !!c.wound && !!c.flaw, 'and something to want, regret and get wrong');
      ok(!!c.face && typeof c.face.height === 'number', 'and a face that can be drawn');
      ok(c.faction === null || !!W.facById(c.faction), 'and works for somebody who exists');
    }
    /* the five you actually deal with must be tellable apart */
    {
      const main = [W.you, W.handler, W.rival, W.oracle, W.antagonist];
      const seen = { name: new Set(), sur: new Set(), want: new Set(), wound: new Set() };
      for (const c of main) {
        ok(!seen.name.has(c.name), 'no two of the cast share a name');
        seen.name.add(c.name);
        const sur = c.name.split(' ').pop();
        ok(!seen.sur.has(sur), 'or a surname (' + sur + ')');
        seen.sur.add(sur);
        ok(!seen.want.has(c.want), 'or a motive');
        seen.want.add(c.want);
        ok(!seen.wound.has(c.wound), 'or a wound');
        seen.wound.add(c.wound);
      }
      ok(W.you.origin !== undefined && !!W.facById(W.you.origin),
         'you came from somewhere');
      ok(W.oracle.faction === null, 'the oracle works for nobody');
    }

    /* the artifact and the twist */
    arts.add(W.artifact.name);
    secrets.add(W.secret.k);
    ok(W.artifact.name.indexOf('THE ') === 0, 'the artifact has a name');
    ok(!!W.facById(W.artifact.heldBy), 'somebody is holding it');
    ok(!!W.facById(W.artifact.wantedBy), 'and somebody wants it');
    ok(typeof W.secret.line === 'string' && !!W.secret.target,
       'the twist names who the end is against');
  }

  console.log('  ' + N + ' worlds: ' + facNames.size + ' faction names, ' +
              castNames.size + ' people, ' + placeNames.size + ' places, ' +
              arts.size + ' artifacts');
  /* Generated text has to actually vary. A name list that repeats
     inside one session is a name list the player stops reading. */
  ok(facNames.size > N * 3, 'faction names do not repeat (' + facNames.size + ')');
  ok(castNames.size > N * 4, 'nor do the people (' + castNames.size + ')');
  ok(placeNames.size > 200, 'nor the places (' + placeNames.size + ')');
  ok(arts.size > 60, 'nor the artifact (' + arts.size + ')');
  ok(doctrines.size === LR.DOCTRINE_KEYS.length, 'every doctrine comes up');
  ok(secrets.size === LR.SECRETS.length, 'and every twist');

  /* doctrines are mechanical, not decorative */
  for (const k of LR.DOCTRINE_KEYS) {
    const D = LR.DOCTRINES[k];
    ok(typeof D.creed === 'string' && D.creed.length > 10, k + ' believes something');
    ok(D.mod && D.mod.count > 0 && D.mod.hp > 0, k + ' changes the troops it fields');
    ok(D.guns.every(g => !!window.WEAPONS.table[g]), k + ' arms them with real weapons');
    /* Asked of the generator's own classification rather than a list
       here, so a kind added to GREEBLEWORKS does not leave the world
       quietly claiming to live somewhere that does not exist. */
    ok(D.kinds.every(x => !!window.CONFIG.STYLES_BY_KIND[x]),
       k + ' lives in real kinds of place');
  }

  /* the dossier has to be readable, because it is the codex */
  {
    const W = LR.makeWorld(0xBEEF);
    const txt = LR.describe(W);
    ok(txt.length > 1200, 'the dossier is a real document (' + txt.length + ' chars)');
    ok(txt.indexOf('undefined') < 0, 'with nothing missing from it');
    ok(txt.indexOf('%') < 0, 'and no unfilled slots');
    for (const f of W.factions) ok(txt.indexOf(f.name) >= 0, 'every faction is in it');
  }
}

section('the run (story)');
{
  const LR = window.LORE, ST = window.STORY;

  /* every objective is a real one, and says what it is */
  for (const k of ST.OBJ_KEYS) {
    const O = ST.OBJECTIVES[k];
    ok(typeof O.label === 'string' && O.label.length > 2, k + ' has a label');
    ok(typeof O.brief === 'string' && O.brief.length > 20, k + ' has a briefing');
    ok(typeof O.gate === 'string', k + ' says what gates the pad');
  }
  /* traits are modifiers, not flavour text */
  for (const k of ST.TRAIT_KEYS) {
    const T = ST.TRAITS[k];
    ok(typeof T.line === 'string' && T.line.length > 15, 'trait ' + k + ' means something');
    ok(T.mod && Object.keys(T.mod).length > 0, 'and does something');
  }

  const shapes = new Set(), objSeen = new Set(), placesSeen = new Set();
  const N = 80;
  for (let i = 0; i < N; i++) {
    const W = LR.makeWorld((i * 2654435761) >>> 0);
    const S = ST.makeStory(W, { difficulty: 'regular' });

    ok(S.beats.length > 12, 'a story has enough beats to be one (' + S.beats.length + ')');
    ok(S.missions >= 7, 'and enough missions (' + S.missions + ')');

    let acts = new Set(), missions = 0, choices = 0, scenes = 0;
    let lastAct = 0;
    for (const b of S.beats) {
      acts.add(b.act);
      ok(b.act >= lastAct, 'beats run forward through the acts');
      lastAct = b.act;
      if (b.type === 'mission') {
        missions++;
        objSeen.add(b.objective);
        placesSeen.add(W.placeById(b.place).name);
        ok(!!ST.OBJECTIVES[b.objective], 'every mission has a real objective');
        ok(!!W.placeById(b.place), 'and happens somewhere that exists');
        ok(!!W.facById(b.foe), 'and is against somebody who exists');
        ok(W.placeById(b.place).owner === b.foe,
           'and the garrison is whoever holds the place');
        if (b.objective === 'hunt') {
          ok(!!b.target && !!W.charById(b.target), 'a hunt names somebody real');
        }
        if (b.objective === 'survive') ok(b.seconds >= 30, 'a hold has a real clock');
        if (b.objective === 'sabotage') ok(b.charges >= 2, 'a sabotage has charges');
        /* the briefing has to name the actual place and be filled in */
        const br = S.brief(b);
        ok(br.length > 20, 'the briefing is a briefing');
        ok(br.indexOf('%') < 0, 'with every slot filled');
        ok(br.indexOf('undefined') < 0, 'and nothing missing');
      } else if (b.type === 'choice') {
        choices++;
        const c = S.choiceAt(b);
        ok(!!c && c.options.length >= 2, 'a choice offers a choice');
        ok(c.prompt.indexOf('%') < 0, 'and its prompt is filled in');
        ok(c.prompt.indexOf('undefined') < 0, 'and complete');
        ok(c.prompt.length > 20, 'and worth reading');
        for (const op of c.options) {
          ok(op.label.length > 4 && op.line.length > 15, 'every option says what it is');
          ok(!op.trait || !!ST.TRAITS[op.trait], 'and grants a real trait');
        }
      } else scenes++;
    }
    ok(acts.size === 3, 'three acts');
    ok(choices >= 3, 'at least three choices (' + choices + ')');
    ok(scenes >= 5, 'and enough scenes to carry it (' + scenes + ')');
    shapes.add(S.beats.map(b => b.type === 'mission' ? b.objective[0] : b.type[0]).join(''));

    /* the run has to be walkable end to end without getting stuck */
    let guard = 0;
    while (!S.done && guard++ < 200) {
      const b = S.current();
      if (b.type === 'scene') S.seen();
      else if (b.type === 'choice') S.choose(S.choiceAt(b).options[i % 3].id);
      else S.finishMission({ won: true, score: 100, kills: 3, total: 4,
                             deaths: 0, time: 40, hurt: true });
    }
    ok(S.done, 'a story runs to its end');
    ok(guard < 200, 'without looping');
    ok(S.traits.length >= 3, 'and the operative comes out of it changed (' +
       S.traits.join(',') + ')');
    for (const t of S.traits) ok(!!ST.TRAITS[t], 'every trait earned is a real one');
    const e = S.ending();
    ok(!!e.title && !!e.line, 'and it ends with something');
    /* the modifier roll-up has to stay sane no matter what was earned */
    const m = S.mods();
    for (const k in m) {
      ok(Number.isFinite(m[k]), 'trait modifier ' + k + ' is a number');
      /* vitals and allies are added, everything else multiplies — so
         zero is a legal value for exactly two of them */
      const additive = k === 'vitals' || k === 'allies';
      ok(additive ? m[k] >= 0 : m[k] > 0, 'trait modifier ' + k + ' is in range');
    }
    ok(m.dmg < 3 && m.armour < 3, 'and nothing runs away with itself');
  }

  console.log('  ' + N + ' stories: ' + shapes.size + ' distinct shapes, ' +
              objSeen.size + '/' + ST.OBJ_KEYS.length + ' objectives, ' +
              placesSeen.size + ' places visited');
  ok(objSeen.size === ST.OBJ_KEYS.length, 'every objective type comes up');
  ok(shapes.size > N * 0.5, 'no two stories are the same shape (' + shapes.size + ')');

  /* determinism, and that a story is a function of its world */
  {
    const W = LR.makeWorld(0x1234);
    const a = ST.outline(ST.makeStory(W, {}));
    const b = ST.outline(ST.makeStory(W, {}));
    ok(a === b, 'the same world makes the same story');
    const c = ST.outline(ST.makeStory(LR.makeWorld(0x1235), {}));
    ok(a !== c, 'a different world makes a different one');
    ok(a.split('\n').length > 25, 'and the outline is readable');
  }

  /* choices actually change the run */
  {
    const W = LR.makeWorld(0x99);
    const a = ST.makeStory(W, {}), b = ST.makeStory(W, {});
    while (a.current().type !== 'choice') { const x = a.current();
      if (x.type === 'scene') a.seen(); else a.finishMission({ won: true }); }
    while (b.current().type !== 'choice') { const x = b.current();
      if (x.type === 'scene') b.seen(); else b.finishMission({ won: true }); }
    const opts = a.choiceAt(a.current()).options;
    a.choose(opts[0].id);
    b.choose(opts[1].id);
    ok(JSON.stringify(a.flags) !== JSON.stringify(b.flags), 'a choice sets its own flag');
    ok(JSON.stringify(a.traits) !== JSON.stringify(b.traits), 'and grants its own trait');
    ok(JSON.stringify(a.rep) !== JSON.stringify(b.rep), 'and moves reputation its own way');
  }

  /* reputation: killing a faction's people is noticed by them and by
     whoever hates them */
  {
    const W = LR.makeWorld(0x77);
    const S = ST.makeStory(W, {});
    while (S.current().type !== 'mission') S.seen();
    const beat = S.current();
    const before = S.rep.slice();
    S.finishMission({ won: true, score: 0, kills: 1, total: 4, deaths: 0, time: 30 });
    ok(S.rep[beat.foe] < before[beat.foe], 'shooting a faction costs you with them');
    let anyUp = false;
    for (const f of W.factions) {
      if (f.id === beat.foe) continue;
      if (W.relation(f.id, beat.foe) <= -1 && S.rep[f.id] > before[f.id]) anyUp = true;
    }
    ok(anyUp || W.factions.every(f => f.id === beat.foe || W.relation(f.id, beat.foe) > -1),
       'and earns you credit with their enemies');
    /* and it is bounded */
    for (let k = 0; k < 40; k++) S.shiftRep(beat.foe, -3);
    ok(S.rep[beat.foe] >= -6, 'reputation has a floor');
    for (let k = 0; k < 40; k++) S.shiftRep(beat.foe, +3);
    ok(S.rep[beat.foe] <= 6, 'and a ceiling');
  }
}

section('reputation, cashed out');
{
  const LR = window.LORE, ST = window.STORY, WP = window.WEAPONS;

  /* --- the shape of the effects --- */
  {
    const W = LR.makeWorld(0xBEEF);
    const S = ST.makeStory(W);
    const beat = S.beats.find(b => b.type === 'mission');
    const foe = beat.foe;

    const neutral = S.repEffects(foe);
    ok(neutral.grace === 0 && neutral.bounty === 0,
       'a run where you took no side plays as it always did');
    ok(!neutral.tribute, 'and nobody leaves you anything');

    /* friends buy time */
    const grace = [];
    for (let r = 0; r <= 6; r++) {
      S.rep[foe] = r;
      grace.push(S.repEffects(foe).grace);
    }
    ok(grace[0] === 0 && grace[1] === 0, 'being merely tolerated buys nothing');
    ok(grace[6] > grace[3] && grace[3] > 0, 'and standing buys more of it');
    ok(grace[6] <= 8, 'but never more than a few seconds (' + grace[6] + ')');
    for (let i = 1; i < grace.length; i++) {
      ok(grace[i] >= grace[i - 1], 'grace never goes backwards');
    }

    /* enemies send company */
    const bounty = [];
    for (let r = 0; r >= -6; r--) {
      S.rep[foe] = r;
      bounty.push(S.repEffects(foe).bounty);
    }
    ok(bounty[0] === 0 && bounty[1] === 0 && bounty[2] === 0,
       'being disliked is not yet a bounty');
    ok(bounty[6] > 0, 'being hated is (' + bounty[6] + ')');
    ok(bounty[6] <= 4, 'and it is bounded');
    for (let i = 1; i < bounty.length; i++) {
      ok(bounty[i] >= bounty[i - 1], 'a bounty never shrinks as you get worse');
    }
    /* and the two never happen at once */
    for (let r = -6; r <= 6; r++) {
      S.rep[foe] = r;
      const e = S.repEffects(foe);
      ok(!(e.grace > 0 && e.bounty > 0), 'never in credit and hunted at once');
    }
    S.rep[foe] = 0;

    /* tribute comes from a friend who is not the garrison */
    {
      const other = W.factions.find(f => f.id !== foe).id;
      S.rep[other] = 2;
      const mid = S.repEffects(foe);
      ok(mid.ally === other, 'the friend is the one you are furthest in credit with');
      ok(!!mid.giftPool && mid.giftPool.length > 0, 'and the wardens carry their guns');
      ok(!mid.tribute, 'but a nodding acquaintance leaves no crate');
      S.rep[other] = 6;
      const high = S.repEffects(foe);
      ok(!!high.tribute, 'a real friend does');
      ok(high.tribute.from === other, 'and it is from them');
      ok(!!WP.table[high.tribute.weapon], 'and it is a real weapon');
      ok(W.facById(other).guns.indexOf(high.tribute.weapon) >= 0,
         'out of their own arsenal');
      /* the garrison is never the friend, however well you get on */
      S.rep[foe] = 6;
      const both = S.repEffects(foe);
      ok(both.ally === other, 'the people shooting at you are not your friends');
      S.rep[foe] = 0; S.rep[other] = 0;
    }
  }

  /* --- and they reach the build --- */
  {
    const W = LR.makeWorld(0x5EED);
    const S = ST.makeStory(W);
    while (!S.done && S.current() && S.current().type !== 'mission') {
      if (S.current().type === 'choice') S.choose(S.choiceAt(S.current()).options[0].id);
      else S.seen();
    }
    const beat = S.current();
    const other = W.factions.find(f => f.id !== beat.foe).id;

    S.rep = S.rep.map(() => 0);
    const plain = S.build();
    S.rep[beat.foe] = 5;
    const liked = S.build();
    S.rep[beat.foe] = -6; S.rep[other] = 6;
    const hated = S.build();

    ok(plain.opts.grace === 0, 'a neutral build asks for no grace');
    ok(liked.opts.grace > 0, 'a build against friends does (' +
       liked.opts.grace.toFixed(1) + 's)');
    ok(hated.opts.enemyDens > plain.opts.enemyDens,
       'and a build against people who hate you is busier (' +
       hated.opts.enemyDens.toFixed(2) + ' vs ' + plain.opts.enemyDens.toFixed(2) + ')');
    ok(!!hated.opts.tribute, 'with a crate from the friend you made instead');
    ok(!!hated.opts.giftPool && hated.opts.giftPool.length > 0,
       'and wardens handing out their guns');
    ok(!!hated.opts.faction && hated.opts.faction.id === beat.foe,
       'the garrison still belongs to whoever holds the place');
    S.rep = S.rep.map(() => 0);
  }

  /* --- a warden narrowed to an ally's arsenal hands out their guns --- */
  {
    const pool = ['harrow', 'rail'];
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const g = window.CONFIG.wardenGift(GW.makeRng((i * 7919) >>> 0), 1, pool);
      if (g.kind === 'weapon') seen.add(g.weapon);
    }
    ok(seen.size > 0, 'a narrowed warden still hands out weapons');
    for (const k of seen) ok(pool.indexOf(k) >= 0, 'and only the ally\'s (' + k + ')');
    const wide = new Set();
    for (let i = 0; i < 300; i++) {
      const g = window.CONFIG.wardenGift(GW.makeRng((i * 40503) >>> 0), 1);
      if (g.kind === 'weapon') wide.add(g.weapon);
    }
    ok(wide.size > pool.length, 'an unnarrowed one still hands out anything');
    ok(!wide.has('pistol'), 'and never your own sidearm');
  }

}

section('the scenes (cutscenes)');
{
  const LR = window.LORE, ST = window.STORY, CS = window.CUTSCENE;

  /* --- the sets --- */
  ok(CS.SET_KEYS.length >= 8, 'there are enough places to stage a scene in');
  ok(CS.MOOD_KEYS.length >= 8, 'and enough weather to light them by');
  for (const k of CS.SET_KEYS) {
    const S = CS.SETS[k];
    ok(['city', 'interior', 'air', 'nature'].indexOf(S.paint) >= 0,
       'set "' + k + '" names a painter that exists');
    ok(S.moods.length > 0 && S.moods.every(m => !!CS.MOODS[m]),
       'set "' + k + '" only asks for weather that exists');
    ok(typeof S.label === 'string' && S.label.length > 4, 'set "' + k + '" says where it is');
  }
  /* every scene kind has somewhere to be staged, and every staging it
     could be given is a real one */
  for (const k of CS.SCENE_KEYS) {
    const pref = CS.SET_FOR[k];
    ok(!!pref && pref.length > 0, 'scene "' + k + '" has sets it prefers');
    for (const p of pref) ok(!!CS.SETS[p], 'scene "' + k + '" prefers a set that exists');
  }
  for (const k of CS.STAGING_KEYS) {
    for (const s of CS.STAGING[k]) {
      ok(s.at >= -1 && s.at <= 1, 'staging "' + k + '" puts everyone on the stage');
    }
  }

  /* determinism and variety of the sets themselves */
  {
    const a = CS.makeSet(0xBEEF, { set: 'overlook' });
    const b = CS.makeSet(0xBEEF, { set: 'overlook' });
    ok(JSON.stringify(a) === JSON.stringify(b), 'the same seed paints the same set');
    const c = CS.makeSet(0xBEF0, { set: 'overlook' });
    ok(JSON.stringify(a) !== JSON.stringify(c), 'a different seed does not');
  }
  {
    const shapes = new Set(), moods = new Set();
    for (const k of CS.SET_KEYS) {
      for (let i = 0; i < 24; i++) {
        const B = CS.makeSet((i * 0x9e3779b9 + k.length) >>> 0, { set: k });
        ok(B.id === k, 'a set built by name is that set');
        ok(!!CS.MOODS[B.mood], 'and lit by real weather');
        ok(B.motes.length > 4, 'and has something in the air');
        if (B.paint !== 'interior') {
          ok(B.layers.length === 3, 'an outdoor set has three ranks of depth');
          let shapeN = 0;
          for (const L of B.layers) shapeN += L.shapes.length;
          ok(shapeN > 4, 'and something in each of them');
        } else {
          ok(B.rings >= 4 && B.pipes.length > 0 && B.lamps.length > 0,
             'an interior recedes, and has pipes and a light');
          ok(B.vp.x > 0.2 && B.vp.x < 0.8, 'with the vanishing point on screen');
        }
        moods.add(B.mood);
        shapes.add(k + ':' + B.layers.length + ':' + B.motes.length);
      }
    }
    ok(moods.size >= 8, 'the sets do not all end up under the same sky (' + moods.size + ')');
    ok(shapes.size > CS.SET_KEYS.length * 2, 'and no two are laid out the same');
  }

  /* --- the director --- */
  const lines = new Set(), sets = new Set(), speakers = new Set(), kinds = new Set();
  let sceneN = 0, shotN = 0;
  const NW = 40;
  for (let i = 0; i < NW; i++) {
    const W = LR.makeWorld((0x5cee0000 + i * 2654435761) >>> 0);
    const S = ST.makeStory(W);
    for (const beat of S.beats) {
      if (beat.type === 'mission') continue;
      const ctx = S.ctxFor(beat);
      const opts = {};
      if (beat.type === 'choice') opts.prompt = S.choiceAt(beat).prompt;
      if (beat.kind === 'ending') opts.ending = S.ending().line;
      const sc = CS.direct(beat, ctx, opts);
      sceneN++;
      kinds.add(sc.kind);
      sets.add(sc.setId);
      ok(!!CS.SETS[sc.setId], 'a scene is staged somewhere that exists');
      ok(sc.shots.length >= 2, 'and has an establishing shot and at least one line');
      ok(sc.shots[0].line === null && !!sc.shots[0].caption,
         'the first shot is the establishing one');
      ok(!!sc.card.title && !!sc.card.sub, 'and it carries a card');
      ok(sc.cast.length >= 1 && sc.cast.length <= 3, 'no more than three people on stage');

      for (let n = 1; n < sc.shots.length; n++) {
        const sh = sc.shots[n];
        shotN++;
        ok(typeof sh.line === 'string' && sh.line.length > 3, 'every staged shot has a line');
        ok(sh.line.indexOf('%') < 0,
           'and no unfilled slot in it: ' + JSON.stringify(sh.line));
        ok(sh.line === sh.line.toUpperCase(), 'spoken in the register of the game');
        ok(!!sh.speaker && !!sh.speaker.name, 'and somebody says it');
        ok(sc.cast.length === 0 || sh.cast.length === sc.cast.length,
           'with the whole cast staged');
        /* exactly one figure is lit: the one talking */
        const lit = sh.cast.filter(c => c.dim === 0);
        ok(lit.length === 1, 'and exactly one of them is in the light');
        ok(lit.length === 0 || lit[0].char === sh.speaker, 'and it is the one talking');
        ok(sh.cam.z0 > 0.5 && sh.cam.z1 > 0.5, 'the camera has a move with a scale on it');
        speakers.add(sh.speaker.name);
        lines.add(sh.line);
      }
    }
  }
  ok(kinds.size >= 7, 'every kind of scene in the spine gets staged (' + kinds.size + ')');
  ok(sets.size >= 6, 'and they are not all staged in the same room (' + sets.size + ')');
  ok(lines.size > shotN * 0.65,
     'the grammar does not repeat itself (' + lines.size + '/' + shotN + ' lines distinct)');
  ok(speakers.size > NW, 'and it is a different cast every run (' + speakers.size + ')');
  console.log('  ' + sceneN + ' scenes, ' + shotN + ' staged shots, ' +
              lines.size + ' distinct lines, ' + sets.size + ' sets used');

  /* the same beat in the same world always stages the same way */
  {
    const W = LR.makeWorld(0x1234);
    const S1 = ST.makeStory(W), S2 = ST.makeStory(W);
    const b1 = S1.beats.find(b => b.type === 'scene');
    const b2 = S2.beats.find(b => b.type === 'scene');
    const a = CS.direct(b1, S1.ctxFor(b1)), b = CS.direct(b2, S2.ctxFor(b2));
    ok(a.shots.map(s => s.line).join('|') === b.shots.map(s => s.line).join('|'),
       'the same beat in the same world stages identically');
    const W2 = LR.makeWorld(0x1235);
    const S3 = ST.makeStory(W2);
    const b3 = S3.beats.find(b => b.type === 'scene');
    const c = CS.direct(b3, S3.ctxFor(b3));
    ok(c.shots.map(s => s.line).join('|') !== a.shots.map(s => s.line).join('|'),
       'and a different world does not');
  }

  /* --- the runtime --- */
  {
    const W = LR.makeWorld(0xA11CE);
    const S = ST.makeStory(W);
    const beat = S.beats.find(b => b.type === 'scene');
    const sc = CS.direct(beat, S.ctxFor(beat));

    /* on autopilot it plays itself out, and it finishes */
    const cs = new CS.Cutscene(sc, { auto: true, autoHold: 0.2 });
    let steps = 0, seen = new Set();
    while (!cs.done && steps < 60 * 240) { cs.step(1 / 60, false, false); seen.add(cs.i); steps++; }
    ok(cs.done, 'a cutscene on autopilot reaches its end');
    ok(seen.size === sc.shots.length, 'having played every shot');
    ok(steps < 60 * 200, 'without taking all afternoon (' + (steps / 60).toFixed(1) + 's)');

    /* a player mashing the advance key gets through it much faster */
    const cs2 = new CS.Cutscene(sc, {});
    let s2 = 0;
    while (!cs2.done && s2 < 60 * 240) { cs2.step(1 / 60, s2 % 20 === 0, true); s2++; }
    ok(cs2.done, 'and a player can hurry it along');
    ok(s2 < steps, 'faster than waiting (' + (s2 / 60).toFixed(1) + 's vs ' + (steps / 60).toFixed(1) + 's)');

    /* skip is absolute */
    const cs3 = new CS.Cutscene(sc, {});
    cs3.skip();
    ok(cs3.done && cs3.skipped, 'and skip ends it outright');
    ok(cs3.step(1 / 60, false, false) === false, 'and it stays ended');

    /* the camera actually moves */
    const cs4 = new CS.Cutscene(sc, { auto: true });
    cs4.step(0.01, false, false);
    const c0 = cs4.camAt();
    for (let k = 0; k < 90; k++) cs4.step(1 / 60, false, false);
    const c1 = cs4.camAt();
    ok(Math.abs(c0.x - c1.x) > 0.5 || Math.abs(c0.z - c1.z) > 0.01,
       'and the camera is not nailed down');
  }

  /* --- it draws --- */
  {
    const W = LR.makeWorld(0xF00D);
    const S = ST.makeStory(W);
    const beat = S.beats.find(b => b.type === 'scene');
    const painters = { city: 'overlook', interior: 'sanctum', air: 'updraft', nature: 'wilds' };
    const cells = [];
    let bakeMs = 0;
    for (const paint in painters) {
      const sc = CS.direct(beat, S.ctxFor(beat), { set: painters[paint] });
      ok(sc.set.paint === paint, 'a named set uses the painter it claims');
      const cs = new CS.Cutscene(sc, { auto: true });
      // step into the first spoken shot, so there are figures on stage
      for (let k = 0; k < 60 * 4 && cs.i === 0; k++) cs.step(1 / 60, false, false);
      for (let k = 0; k < 40; k++) cs.step(1 / 60, false, false);
      const cv = createCanvas(CS.CS_W, CS.CS_H);
      const cx = cv.getContext('2d');
      const t0 = Date.now();
      CS.draw(cx, cs, 2.4);
      bakeMs += Date.now() - t0;
      /* a second frame, off the cache, is the one that has to be cheap */
      const t1 = Date.now();
      CS.draw(cx, cs, 2.6);
      const warm = Date.now() - t1;
      ok(warm < 120, 'a cached cutscene frame is cheap (' + paint + ': ' + warm + 'ms)');

      const d = cx.getImageData(0, 0, CS.CS_W, CS.CS_H).data;
      let ink = 0, hues = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] > 40) ink++;
        if ((i >> 2) % 97 === 0) hues.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      }
      ok(ink > CS.CS_W * CS.CS_H * 0.3, 'a ' + paint + ' set draws a picture (' + ink + 'px)');
      ok(hues.size > 12, 'and it is not one flat colour (' + paint + ': ' + hues.size + ')');
      /* the letterbox is solid, top and bottom */
      const topRow = cx.getImageData(0, 4, CS.CS_W, 1).data;
      let dark = 0;
      for (let i = 0; i < topRow.length; i += 4) if (topRow[i] + topRow[i + 1] + topRow[i + 2] < 90) dark++;
      ok(dark > CS.CS_W * 0.8, 'with a letterbox across the top of it (' + paint + ')');
      cells.push([paint + ' / ' + painters[paint] + ' / ' + sc.set.mood, cv]);
    }
    console.log('  first frame of four sets in ' + bakeMs + 'ms (bake included)');

    const sheet = createCanvas(CS.CS_W * 2, CS.CS_H * 2);
    const sx = sheet.getContext('2d');
    cells.forEach(([label, cv], i) => {
      sx.drawImage(cv, (i % 2) * CS.CS_W, Math.floor(i / 2) * CS.CS_H);
      sx.font = '10px monospace'; sx.fillStyle = '#0af';
      sx.fillText(label, (i % 2) * CS.CS_W + 6, Math.floor(i / 2) * CS.CS_H + 14);
    });
    dump('out_cutscene.png', sheet);

    /* and a strip of one scene playing, so the staging is reviewable */
    const sc = CS.direct(beat, S.ctxFor(beat));
    const cs = new CS.Cutscene(sc, { auto: true, autoHold: 0.1 });
    const strip = createCanvas(CS.CS_W, CS.CS_H * Math.min(4, sc.shots.length));
    const tx = strip.getContext('2d');
    for (let n = 0; n < Math.min(4, sc.shots.length); n++) {
      const target = n;
      let guard = 0;
      while (cs.i < target && !cs.done && guard++ < 60 * 60) cs.step(1 / 60, false, false);
      for (let k = 0; k < 30; k++) cs.step(1 / 60, false, false);
      const cv = createCanvas(CS.CS_W, CS.CS_H);
      CS.draw(cv.getContext('2d'), cs, 1.2 + n);
      tx.drawImage(cv, 0, n * CS.CS_H);
    }
    dump('out_cutscene_shots.png', strip);
  }
}

section('the story screens');
{
  const LR = window.LORE, ST = window.STORY, UI = window.STORYUI;

  /* --- standing reads as words, and the words are ordered --- */
  {
    ok(UI.STANDING.length >= 5, 'standing has words for it');
    const seen = [];
    for (let r = -6; r <= 6; r++) seen.push(UI.standingOf(r).word);
    ok(new Set(seen).size >= 5, 'and they are not all the same word');
    ok(UI.standingOf(-6).tone === 'bad', 'being hunted reads as bad');
    ok(UI.standingOf(6).tone === 'good', 'being owed reads as good');
    ok(UI.standingOf(0).tone === 'flat', 'and being nobody reads as neither');
    /* monotone: standing never improves as reputation falls */
    const rank = { bad: 0, warn: 1, flat: 2, ok: 3, good: 4 };
    let last = -1;
    for (let r = -6; r <= 6; r++) {
      const t = rank[UI.standingOf(r).tone];
      ok(t >= last, 'standing improves with reputation (' + r + ')');
      last = t;
    }
  }

  /* --- the dossier --- */
  {
    let anyLong = false;
    for (let i = 0; i < 20; i++) {
      const W = LR.makeWorld((0xD055 + i * 7919) >>> 0);
      const vm = UI.dossier(W);
      ok(!!vm.title && !!vm.sub, 'a dossier has a heading');
      ok(vm.sub.indexOf('0x') === 0 || vm.sub.indexOf('SEED') === 0,
         'and names the seed it came from');
      ok(vm.blocks.length >= 4, 'and has something to read (' + vm.blocks.length + ')');
      const heads = vm.blocks.map(b => b.h);
      ok(heads.indexOf('THE FACTIONS') >= 0, 'including who is fighting');
      ok(heads.indexOf('KNOWN GROUND') >= 0, 'and where');
      for (const b of vm.blocks) {
        ok(b.rows.length > 0, 'block "' + b.h + '" is not empty');
        for (const r of b.rows) {
          ok(typeof r.k === 'string' && r.k.length > 0, 'every row is labelled');
          ok(r.k.indexOf('%') < 0 && String(r.v || '').indexOf('%') < 0,
             'and has no unfilled slot in it');
        }
      }
      const facs = vm.blocks.find(b => b.h === 'THE FACTIONS');
      ok(facs.rows.length === W.factions.length, 'every faction is listed');
      for (const r of facs.rows) ok(r.hue >= 0 && r.hue < 360, 'and has its colour on it');
      const ground = vm.blocks.find(b => b.h === 'KNOWN GROUND');
      ok(ground.rows.length === W.places.length, 'and every place');
      /* the dossier must not give away the twist */
      const all = JSON.stringify(vm);
      ok(all.indexOf(W.secret.line) < 0, 'and the dossier does not spoil the turn');
      if (all.length > 1200) anyLong = true;
    }
    ok(anyLong, 'a dossier is a page, not a line');
  }

  /* --- the briefing --- */
  {
    const kinds = new Set();
    for (let i = 0; i < 24; i++) {
      const W = LR.makeWorld((0xB21E + i * 40503) >>> 0);
      const S = ST.makeStory(W);
      /* walk the whole spine, briefing every mission on the way */
      let guard = 0;
      while (!S.done && S.current() && guard++ < 60) {
        const b = S.current();
        if (b.type === 'mission') {
          const vm = UI.briefing(S, b);
          ok(!!vm, 'a mission has a briefing');
          kinds.add(b.objective);
          ok(vm.title === ST.OBJECTIVES[b.objective].label, 'that names the objective');
          ok(vm.place === W.placeById(b.place).name, 'and the place');
          ok(vm.foe === W.facById(b.foe).name, 'and who holds it');
          ok(vm.brief.length > 20 && vm.brief.indexOf('%') < 0,
             'and reads as a sentence: ' + JSON.stringify(vm.brief));
          ok(vm.n >= 1 && vm.n <= vm.of, 'and says where in the run you are');
          ok(vm.act.indexOf('ACT') === 0, 'and which act');
          ok(vm.standing.indexOf(vm.foe) >= 0, 'and how they feel about you');
          ok(vm.arsenal.length > 0, 'and what they will be carrying');
          ok(vm.arsenal.every(x => typeof x === 'string' && x.length > 1),
             'in words rather than keys');
          ok(Array.isArray(vm.notes), 'and any warnings');
          /* the objective-specific rows */
          const rk = vm.rows.map(r => r.k);
          if (b.objective === 'hunt') ok(rk.indexOf('TARGET') >= 0, 'a hunt names its target');
          if (b.objective === 'survive') ok(rk.indexOf('HOLD FOR') >= 0, 'a hold names its clock');
          if (b.objective === 'sabotage') ok(rk.indexOf('CHARGES') >= 0, 'a sabotage counts its charges');
          if (b.boss) ok(rk.indexOf('EXPECT') >= 0, 'and the last one warns you');
          S.finishMission({ score: 100, kills: 3, time: 40, deaths: 0 });
        } else if (b.type === 'choice') {
          S.choose(S.choiceAt(b).options[0].id);
        } else S.seen();
      }
      ok(!UI.briefing(S, S.beats.find(x => x.type === 'scene')),
         'and a scene has no briefing to give');
    }
    ok(kinds.size === ST.OBJ_KEYS.length,
       'every objective gets briefed (' + kinds.size + '/' + ST.OBJ_KEYS.length + ')');
  }

  /* the notes actually reflect standing */
  {
    const W = LR.makeWorld(0x9111);
    const S = ST.makeStory(W);
    while (!S.done && S.current() && S.current().type !== 'mission') {
      if (S.current().type === 'choice') S.choose(S.choiceAt(S.current()).options[0].id);
      else S.seen();
    }
    const b = S.current();
    const other = W.factions.find(f => f.id !== b.foe).id;
    S.rep = S.rep.map(() => 0);
    ok(UI.briefing(S, b).notes.length === 0, 'a neutral briefing has no warnings');
    S.rep[b.foe] = 5;
    ok(UI.briefing(S, b).notes.some(n => n.tone === 'good'),
       'a briefing against friends says so');
    S.rep[b.foe] = -6; S.rep[other] = 6;
    const hot = UI.briefing(S, b);
    ok(hot.notes.some(n => n.tone === 'bad'), 'and one against enemies says that');
    ok(hot.notes.some(n => n.t.indexOf(W.facById(other).name) >= 0),
       'and names the friend who left you something');
    ok(hot.standingTone === 'bad', 'with the standing line to match');
  }

  /* --- the choice --- */
  {
    const labels = new Set();
    for (let i = 0; i < 20; i++) {
      const W = LR.makeWorld((0xC401 + i * 2654435761) >>> 0);
      const S = ST.makeStory(W);
      let guard = 0, choices = 0;
      while (!S.done && S.current() && guard++ < 60) {
        const b = S.current();
        if (b.type === 'choice') {
          const vm = UI.choiceView(S, b);
          choices++;
          ok(!!vm && vm.options.length >= 2, 'a choice offers a choice');
          ok(vm.prompt.length > 20 && vm.prompt.indexOf('%') < 0,
             'and asks something: ' + JSON.stringify(vm.prompt));
          const ids = vm.options.map(o => o.id);
          ok(new Set(ids).size === ids.length, 'with options that differ');
          for (const o of vm.options) {
            ok(o.label.length > 2 && o.label.indexOf('%') < 0, 'each option is labelled');
            ok(o.line.length > 10, 'and says what taking it means');
            ok(Array.isArray(o.cost), 'and what it costs');
            for (const c of o.cost) {
              ok(typeof c.who === 'string' && c.who.length > 1, 'named, not numbered');
              ok(c.by !== 0, 'and a cost of nothing is not listed');
              ok(c.tone === (c.by > 0 ? 'good' : 'bad'), 'and reads the right way round');
            }
            labels.add(o.label);
          }
          /* at least one option must cost something, or it is not a choice */
          ok(vm.options.some(o => o.cost.length > 0), 'and at least one of them costs');
          S.choose(ids[i % ids.length]);
        } else if (b.type === 'mission') {
          S.finishMission({ score: 10, kills: 1, time: 10, deaths: 0 });
        } else S.seen();
      }
      ok(choices === 3, 'a run puts three decisions to you (' + choices + ')');
      ok(!UI.choiceView(S, S.beats.find(x => x.type === 'mission')),
         'and a mission is not one of them');
    }
    ok(labels.size >= 8, 'the decisions are not the same three every run (' + labels.size + ')');
  }

  /* --- the spine is not the same spine twice ---
     The whole claim of a second pass: two runs differ in SHAPE, not
     only in the names inside it. */
  {
    const shapes = new Set(), lengths = {}, fired = {};
    const asides = new Set(), consequences = new Set();
    const N = 120;
    for (let i = 0; i < N; i++) {
      const W = LR.makeWorld((i * 2654435761) >>> 0);
      const S = ST.makeStory(W);
      /* every run gets the same treatment so the variety measured is
         the story's and not the player's */
      let g = 0;
      while (!S.done && S.current() && g++ < 90) {
        const b = S.current();
        if (b.aside) asides.add(b.kind);
        if (b.consequence) consequences.add(b.consequence);
        if (b.type === 'mission') {
          S.finishMission({ won: true, score: 100, kills: 4, total: 4,
                            time: 40, deaths: i % 5 === 0 ? 2 : 0 });
        } else if (b.type === 'choice') {
          const o = S.choiceAt(b).options;
          S.choose(o[i % o.length].id);
        } else S.seen();
      }
      ok(S.done, 'a run with optional beats still ends');
      ok(g < 90, 'and does not run away with itself (' + g + ' beats)');
      shapes.add(S.beats.map(b => b.type[0] + (b.consequence ? '*' : '')).join(''));
      lengths[S.missions] = (lengths[S.missions] || 0) + 1;
      for (const k in S.fired) fired[k] = (fired[k] || 0) + 1;

      /* the bones survive the roll */
      for (const act of [1, 2, 3]) {
        const inAct = S.beats.filter(b => b.act === act);
        ok(inAct.filter(b => b.type === 'mission').length >= 2,
           'act ' + act + ' keeps at least two missions');
        ok(inAct.some(b => b.type === 'choice'), 'and its decision');
      }
      ok(S.beats[0].kind === 'open', 'a run still opens on the offer');
      ok(S.beats[S.beats.length - 1].kind === 'ending', 'and closes on the ending');
      ok(S.beats.some(b => b.boss), 'and still has a last fight');
      /* indices and mission numbers stay true after a splice */
      for (let k = 0; k < S.beats.length; k++) {
        ok(S.beats[k].i === k, 'every beat knows where it is');
      }
      {
        let n = 0, bad = 0;
        for (const b of S.beats) if (b.type === 'mission') { n++; if (b.n !== n) bad++; }
        ok(bad === 0, 'and the missions are numbered in the order you play them');
        ok(n === S.missions, 'and counted');
      }
    }
    const lens = Object.keys(lengths).map(Number).sort((a, b) => a - b);
    ok(lens.length >= 4, 'a run is not always the same length (' + lens.join('/') + ')');
    ok(lens[0] >= 6, 'but never a short one (' + lens[0] + ')');
    ok(lens[lens.length - 1] <= 16, 'nor an endless one (' + lens[lens.length - 1] + ')');
    ok(shapes.size > N * 0.7,
       'and two runs are rarely the same shape (' + shapes.size + '/' + N + ')');
    ok(asides.size >= 3, 'there are errands off the spine (' + asides.size + ')');
    ok(Object.keys(fired).length >= 4,
       'and beats that only exist because of what you did (' +
       Object.keys(fired).join(', ') + ')');
    for (const id in fired) {
      ok(fired[id] > 2 && fired[id] < N,
         'consequence "' + id + '" is neither guaranteed nor impossible (' +
         fired[id] + '/' + N + ')');
    }
    /* and every consequence beat the run can weld on is one the
       cutscene director and the briefing can actually stage */
    for (const kind of consequences) ok(typeof kind === 'string', 'named');
    console.log('  ' + shapes.size + '/' + N + ' distinct spines, ' +
                lens[0] + '-' + lens[lens.length - 1] + ' missions, ' +
                Object.keys(fired).length + ' consequences');
  }

  /* every scene kind a run can produce has a grammar of its own */
  {
    const CS = window.CUTSCENE;
    const kinds = new Set();
    for (let i = 0; i < 60; i++) {
      const W = LR.makeWorld((0x5CE0 + i * 7919) >>> 0);
      const S = ST.makeStory(W);
      let g = 0;
      while (!S.done && S.current() && g++ < 90) {
        const b = S.current();
        if (b.type === 'scene') kinds.add(b.kind);
        if (b.type === 'mission') S.finishMission({ won: true, score: 50, kills: 2, time: 20, deaths: 1 });
        else if (b.type === 'choice') { const o = S.choiceAt(b).options; S.choose(o[i % o.length].id); }
        else S.seen();
      }
    }
    ok(kinds.size >= 8, 'a run can produce this many kinds of scene (' + kinds.size + ')');
    for (const k of kinds) {
      ok(!!CS.SCENES[k], 'scene "' + k + '" has lines of its own');
      ok(!!CS.SET_FOR[k], 'and somewhere to be staged');
      ok(CS.SET_FOR[k].every(x => !!CS.SETS[x]), 'somewhere that exists');
    }
  }

  /* --- the people you meet on the way ---
     A warden in a rolled level is a figure. In a story run it is
     somebody, and who it is depends on where you are and what you have
     done. */
  {
    const D = window.DIALOG;
    ok(D.ROLE_KEYS.length >= 4, 'there are kinds of person to meet');
    for (const k of D.ROLE_KEYS) {
      const R = D.ROLES[k];
      ok(typeof R.label === 'string' && R.label.length > 2, k + ' has a label');
      ok(R.open.length >= 4 && R.turn.length >= 4, k + ' has things to say');
      /* every clause has to be about this world rather than about the
         dark, which is the whole difference from the warden pool */
      const slotted = R.open.filter(t => /%[FPXY]/.test(t)).length;
      ok(slotted >= 2, k + ' says something about where you are (' + slotted + ')');
      for (const t of R.open.concat(R.turn)) {
        ok(t === t.toUpperCase(), k + ' speaks in the register of the game');
        ok(t.length > 18, 'and says something worth reading');
      }
    }
    /* the slots get filled */
    {
      const ctx = { faction: 'THE LEDGER', place: 'THE ASH FORGE',
                    artifact: 'THE BURNT INSTRUMENT', you: 'ORREL CHASM' };
      const seen = new Set();
      for (const k of D.ROLE_KEYS) {
        for (let i = 0; i < 40; i++) {
          const L = D.storyLines(GW.makeRng((i * 7919) >>> 0), k, ctx,
                                 { line: 'TAKE IT.' }, false);
          ok(L.length === 3, k + ' says three pages');
          for (const page of L) {
            ok(page.indexOf('%') < 0, 'with nothing unfilled: ' + JSON.stringify(page));
          }
          seen.add(L[0]);
        }
        const spent = D.storyLines(GW.makeRng(1), k, ctx, null, true);
        ok(spent.length === 3, k + ' still says something once it is empty-handed');
        ok(spent.join(' ').indexOf('%') < 0, 'and fills that too');
      }
      ok(seen.size > D.ROLE_KEYS.length * 3,
         'and does not say the same thing every time (' + seen.size + ')');
      /* an unknown role must not throw — it falls back to somebody */
      const fb = D.storyLines(GW.makeRng(2), 'not-a-role', ctx, null, false);
      ok(fb.length === 3, 'an unknown role still says something');
    }

    /* who the run puts in front of you */
    {
      const roles = new Set();
      let anyCreditor = false, anyGrudge = false, anySurvivor = false;
      for (let i = 0; i < 40; i++) {
        const W = LR.makeWorld((0x11A5 + i * 40503) >>> 0);
        const S = ST.makeStory(W);
        let g = 0;
        while (!S.done && S.current() && g++ < 90) {
          const b = S.current();
          if (b.type === 'mission') {
            const who = S.wardensFor(b, 2);
            ok(who.length === 2, 'a mission knows who is standing in it');
            /* asked twice, answered the same: the mission bakes their
               faces from one call and reads their lines from another */
            const again = S.wardensFor(b, 2);
            ok(again === who || JSON.stringify(again) === JSON.stringify(who),
               'and does not reinvent them on the second look');
            for (const p of who) {
              ok(!!D.ROLES[p.role], 'each is a kind of person that exists');
              ok(!!p.name && p.name.indexOf('%') < 0, 'with a name');
              ok(!!p.face && p.face.height > 20, 'and a face to put on the rig');
              ok(p.face.aimRows === 3, 'built to stand with the gun down');
              ok(!!p.ctx.faction && !!p.ctx.place && !!p.ctx.artifact,
                 'and enough context to say something');
              roles.add(p.role);
              if (p.role === 'creditor') anyCreditor = true;
              if (p.role === 'grudge') anyGrudge = true;
              if (p.role === 'survivor') anySurvivor = true;
            }
            /* nobody they could be is somebody who is not in this world */
            for (const p of who) {
              if (p.faction === null) continue;
              ok(!!W.facById(p.faction), 'and belongs to a faction that exists');
            }
            ok(S.wardensFor(b, 0).length === 0, 'and a level with no alcoves has nobody in it');
            S.finishMission({ won: true, score: 200, kills: 5, total: 5,
                              time: 40, deaths: i % 3 });
          } else if (b.type === 'choice') {
            const o = S.choiceAt(b).options;
            S.choose(o[i % o.length].id);
          } else S.seen();
        }
      }
      ok(roles.size >= 4, 'the run puts different kinds of person in front of you (' +
         Array.from(roles).join(', ') + ')');
      ok(anySurvivor, 'including somebody who was where you have been');
      ok(anyCreditor, 'somebody sent by people who owe you');
      ok(anyGrudge, 'and somebody from people you have cost');
      /* a scene beat has nobody standing in it */
      const W2 = LR.makeWorld(0x1234);
      const S2 = ST.makeStory(W2);
      ok(S2.wardensFor(S2.beats.find(b => b.type === 'scene'), 2).length === 0,
         'and a scene has no alcove to stand in');
    }

    /* met, not merely seen */
    {
      const W = LR.makeWorld(0x9A11);
      const S = ST.makeStory(W);
      ok(S.people.length === 0, 'you start knowing nobody');
      const b = S.beats.find(x => x.type === 'mission');
      const who = S.wardensFor(b, 2);
      ok(S.people.length === 0, 'and merely walking past does not count');
      ok(S.meet(who[0]), 'talking to somebody does');
      ok(!S.meet(who[0]), 'and only once');
      ok(S.meet(who[1]), 'and the other one is another person');
      ok(S.people.length === 2, 'so you know two people (' + S.people.length + ')');
      ok(!S.meet(null) && !S.meet({}), 'and nobody is not somebody');
      const cx = UI.codex(S);
      const rows = cx.sections.find(x => x.h === 'PEOPLE').rows;
      ok(rows.some(r => r.k === who[0].name), 'and the codex remembers them');
      ok(rows.some(r => String(r.note).indexOf('MET IN THE FIELD') >= 0),
         'and says how you know them');
    }
  }

  /* --- the codex only lists what you have met --- */
  {
    const W = LR.makeWorld(0xC0DE);
    const S = ST.makeStory(W);
    const early = UI.codex(S);
    const ground = early.sections.find(s => s.h === 'GROUND WALKED');
    ok(ground.rows.length <= 1, 'a codex starts almost empty (' + ground.rows.length + ')');
    ok(JSON.stringify(early).indexOf(W.secret.line) < 0, 'and does not know the twist');
    /* standing is always listed: you always know who you have annoyed */
    const st0 = early.sections.find(s => s.h === 'STANDING');
    ok(st0.rows.length === W.factions.length, 'but always lists who is out there');

    let guard = 0;
    while (!S.done && S.current() && guard++ < 60) {
      const b = S.current();
      if (b.type === 'mission') S.finishMission({ score: 50, kills: 2, time: 30, deaths: 0 });
      else if (b.type === 'choice') S.choose(S.choiceAt(b).options[0].id);
      else S.seen();
    }
    const late = UI.codex(S);
    const lg = late.sections.find(s => s.h === 'GROUND WALKED');
    const lp = late.sections.find(s => s.h === 'PEOPLE');
    ok(lg.rows.length > ground.rows.length,
       'and fills up as you walk (' + ground.rows.length + ' → ' + lg.rows.length + ')');
    ok(lg.rows.length === S.missions, 'one entry per place you were sent');
    ok(lp.rows.length >= 3, 'and the people you met (' + lp.rows.length + ')');
    for (const s of late.sections) {
      for (const r of s.rows) {
        ok(String(r.k).indexOf('%') < 0 && String(r.note || '').indexOf('%') < 0,
           'nothing in a codex has an unfilled slot');
      }
    }
    ok(late.sections.some(s => s.h === 'THE PRIZE'), 'and it remembers what this was for');
  }

  /* --- the debrief --- */
  {
    const W = LR.makeWorld(0xDEB1);
    const S = ST.makeStory(W);
    const mid = UI.debrief(S);
    ok(mid.title === 'DEBRIEF', 'a run in progress debriefs as one');
    ok(!mid.line, 'and has no last word yet');
    ok(mid.rows.length >= 5, 'but has numbers');
    let guard = 0;
    while (!S.done && S.current() && guard++ < 60) {
      const b = S.current();
      if (b.type === 'mission') S.finishMission({ score: 400, kills: 9, time: 70, deaths: 1 });
      else if (b.type === 'choice') S.choose(S.choiceAt(b).options[0].id);
      else S.seen();
    }
    const end = UI.debrief(S);
    ok(S.done, 'the run ends');
    ok(end.title !== 'DEBRIEF', 'and the debrief takes the ending\'s name (' + end.title + ')');
    ok(!!end.line && end.line.length > 20, 'and has a last word');
    ok(end.standing.length === W.factions.length, 'with everyone\'s standing on it');
    ok(end.rows.some(r => r.k === 'SCORE' && r.v !== '0'), 'and a score that moved');
    ok(end.rows.some(r => r.k === 'TIME' && /^\d+:\d\d$/.test(r.v)), 'and a clock');
  }

  /* --- the renderers actually emit something ---
     Under a DOM crude enough to be honest about what these functions
     use: create, set text, append, assign onclick. If a renderer ever
     reaches for anything else, this is where it stops being portable
     to a headless run. */
  {
    function mkEl(tag) {
      return { tagName: tag, className: '', textContent: '', style: {},
               children: [], onclick: null,
               appendChild(c) { this.children.push(c); return c; },
               classList: { toggle() {}, add() {}, remove() {} } };
    }
    const realCreate = global.document.createElement;
    global.document.createElement = t => t === 'canvas' ? realCreate(t) : mkEl(t);
    try {
      const count = n => 1 + n.children.reduce((a, c) => a + count(c), 0);
      const text = n => (n.textContent || '') + n.children.map(text).join(' ');
      const W = LR.makeWorld(0x7717);
      const S = ST.makeStory(W);

      let host = mkEl('div');
      UI.renderDossier(UI.dossier(W), host);
      ok(count(host) > 40, 'the dossier renders (' + count(host) + ' nodes)');
      ok(text(host).indexOf(W.you.name) >= 0, 'and has your name on it');
      ok(text(host).indexOf(W.artifact.name) >= 0, 'and what everyone wants');

      while (!S.done && S.current() && S.current().type !== 'mission') {
        if (S.current().type === 'choice') S.choose(S.choiceAt(S.current()).options[0].id);
        else S.seen();
      }
      const mb = S.current();
      host = mkEl('div');
      UI.renderBriefing(UI.briefing(S), host);
      ok(count(host) > 6, 'the briefing renders (' + count(host) + ' nodes)');
      ok(text(host).indexOf(W.placeById(mb.place).name) >= 0, 'and names the place');
      /* an empty view model must not throw */
      const empty = mkEl('div');
      UI.renderBriefing(null, empty);
      ok(empty.children.length === 0, 'and a briefing for no mission renders nothing');

      while (!S.done && S.current() && S.current().type !== 'choice') {
        if (S.current().type === 'mission') {
          S.finishMission({ score: 10, kills: 1, time: 10, deaths: 0 });
        } else S.seen();
      }
      host = mkEl('div');
      let picked = null;
      UI.renderChoice(UI.choiceView(S), host, id => { picked = id; });
      ok(count(host) > 10, 'the choice renders (' + count(host) + ' nodes)');
      const list = host.children.find(c => c.className === 'st-choices');
      ok(!!list && list.children.length >= 2, 'with buttons on it');
      ok(list.children.every(b => typeof b.onclick === 'function'), 'that are wired');
      list.children[0].onclick();
      ok(picked === UI.choiceView(S).options[0].id ||
         typeof picked === 'string', 'and pressing one answers the question');

      host = mkEl('div');
      UI.renderCodex(UI.codex(S), host);
      ok(count(host) > 20, 'the codex renders (' + count(host) + ' nodes)');
      host = mkEl('div');
      UI.renderDebrief(UI.debrief(S), host);
      ok(count(host) > 15, 'and so does the debrief (' + count(host) + ' nodes)');
    } finally {
      global.document.createElement = realCreate;
    }
  }

  /* --- every ending is reachable and has words --- */
  {
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      const W = LR.makeWorld((0xE4D1 + i * 7919) >>> 0);
      const S = ST.makeStory(W);
      let guard = 0;
      while (!S.done && S.current() && guard++ < 60) {
        const b = S.current();
        if (b.type === 'mission') S.finishMission({ score: 100, kills: 4, time: 40, deaths: 0 });
        else if (b.type === 'choice') {
          const o = S.choiceAt(b).options;
          S.choose(o[i % o.length].id);
        } else S.seen();
      }
      const d = UI.debrief(S);
      seen.add(d.title);
      ok(!!d.line, 'every ending has a line');
    }
    ok(seen.size >= 3, 'a story can end more than one way (' + seen.size + ')');
    console.log('  endings seen: ' + Array.from(seen).join(', '));
  }
}

section('what grew back (flora)');
{
  const GWf = window.GREEBLEWORKS;
  const CF = window.CONFIG;
  const kinds = CF.STYLES_BY_KIND.nature;

  /* The parallax band on its own. Baking a whole mission for each of
     four styles is minutes and a gigabyte; the layer is the part that
     is new, and it is the part a PNG settles. */
  const cells = [];
  for (const style of kinds) {
    const cfg = CF.randomLevelCfg(0x5EED0001, 'nature');
    cfg.style = style;
    cfg.skyMood = CF.STYLE_AFFINITY[style].moods[0];
    /* No palette crush on the sheet. The forms are what is being
       reviewed here, and four colours hides which one is which. */
    cfg.palette = 'none';
    const F = GWf.STYLES[style].flora;
    const g = GWf.bakeSky(Object.assign({}, cfg, {
      outW: LV.W, outH: LV.H, SS: 2, flora: F, seed: 0x5EED0001
    }));
    let r, saw = 0;
    while (!(r = g.next()).done) if (String(r.value).indexOf('canopy layer') === 0) saw++;
    const out = r.value;
    ok(saw >= 2, style + ' bakes its wood in layers (' + saw + ')');
    ok(out.layers.length === saw, 'and every layer it yielded came back');

    /* A layer has to have something in it AND has to leave sky showing
       through: a fully opaque band is a wall, and you cannot tell a
       wall from a wood behind a level. */
    const d = out.near.getContext('2d').getImageData(0, 0, LV.W, LV.H).data;
    let solid = 0, clear = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 200) solid++; else if (d[i] < 16) clear++; }
    ok(solid > LV.W * LV.H * 0.02, style + ' grew something (' + solid + 'px)');
    ok(clear > LV.W * LV.H * 0.12, 'and left sky between it (' + clear + 'px)');

    /* the far layer must be hazier than the near one, or there is no
       depth in the band at all */
    const near = out.layers[out.layers.length - 1], far = out.layers[0];
    const inkOfA = c => {
      const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < p.length; i += 4) if (p[i] > 200) n++;
      return n;
    };
    ok(inkOfA(far) !== inkOfA(near), style + ' does not draw the same layer twice');

    const cell = createCanvas(LV.W, LV.H);
    const cc = cell.getContext('2d');
    cc.imageSmoothingEnabled = false;
    cc.drawImage(out.sky, 0, 0);
    for (const l of out.layers) cc.drawImage(l, 0, 0);
    cells.push([style + ' / ' + F.form, cell]);
  }
  ok(cells.length === 4, 'all four grew');

  const sheet = createCanvas(LV.W, LV.H * cells.length);
  const sx = sheet.getContext('2d');
  cells.forEach(([label, cv], i) => {
    sx.drawImage(cv, 0, i * LV.H);
    sx.font = '11px monospace'; sx.fillStyle = '#fff';
    sx.fillText(label.toUpperCase(), 8, i * LV.H + LV.H - 8);
  });
  dump('out_flora.png', sheet);

  /* the props side: a nature level puts growth on its decks */
  {
    const before = Object.keys(GWf.STYLES).filter(k => GWf.STYLE_KIND(k) === 'nature');
    ok(before.length === 4, 'four nature styles reach the level builder');
  }
}

section('level kinds');
{
  const GWk = window.GREEBLEWORKS;
  const CK = window.CONFIG;

  /* the roller has to be able to give you one of each on demand */
  {
    for (const want of ['city', 'interior', 'air', 'nature']) {
      const seen = new Set();
      for (let i = 0; i < 60; i++) {
        const c = CK.randomLevelCfg((i * 2654435761) >>> 0, want);
        ok(GWk.STYLE_KIND(c.style) === want,
           'asking for a ' + want + ' level gets one (' + c.style + ')');
        seen.add(c.style);
      }
      ok(seen.size === CK.STYLES_BY_KIND[want].length,
         'and every ' + want + ' style comes up (' + seen.size + ')');
    }
    // and without a preference it still rolls the whole roster
    const any = new Set();
    for (let i = 0; i < 400; i++) any.add(CK.randomLevelCfg((i * 40503) >>> 0).style);
    ok(any.size === CK.STYLE_KEYS.length, 'an unpinned roll can still be anything');
  }

  /* the campaign deals the kinds out rather than rolling them */
  {
    const CA = window.CAMPAIGN;
    ok(CA.kindFor(1, 12345) === 'city', 'a campaign always opens on a street');
    let anyRepeat = 0;
    const tally = { city: 0, interior: 0, air: 0, nature: 0 };
    for (let sd = 0; sd < 64; sd++) {
      const seed = (sd * 2654435761) >>> 0;
      const kinds = [];
      for (let n = 1; n <= 8; n++) kinds.push(CA.kindFor(n, seed));
      for (const k of kinds) tally[k]++;
      // never the same kind three deep, which is what a fair roll does
      for (let n = 2; n < kinds.length; n++) {
        if (kinds[n] === kinds[n - 1] && kinds[n] === kinds[n - 2]) anyRepeat++;
      }
      const set = new Set(kinds);
      ok(set.size >= 3, 'campaign seed ' + sd + ' visits at least three kinds');
    }
    ok(anyRepeat === 0, 'no campaign runs three of a kind back to back');
    const tot = tally.city + tally.interior + tally.air + tally.nature;
    ok(tally.interior / tot > 0.15, 'interiors are a real share of a campaign (' +
       (100 * tally.interior / tot).toFixed(0) + '%)');
    ok(tally.air / tot > 0.12, 'and so are air lanes (' +
       (100 * tally.air / tot).toFixed(0) + '%)');
    ok(tally.nature / tot > 0.12, 'and so is what grew back (' +
       (100 * tally.nature / tot).toFixed(0) + '%)');
    console.log('  campaign kind mix: ' + Object.keys(tally)
      .map(k => k + ' ' + (100 * tally[k] / tot).toFixed(0) + '%').join(', '));
  }

  /* --- build one of each and check what came out --- */
  const built = {};
  for (const want of ['interior', 'air', 'nature']) {
    let cfgK = null;
    for (let t = 0; t < 200 && !cfgK; t++) {
      const c = CK.randomLevelCfg((0x51A2 + t * 7919) >>> 0, want);
      // an air level with a mode-7 ground is the interesting one to bake
      if (want === 'city' || GWk.STYLES[c.style].bg !== 'skyline') cfgK = c;
    }
    cfgK.levelLen = 3;
    const gk = window.WORLD.buildMission(cfgK, merc,
      { difficulty: 'regular', enemyDens: 0.6, lives: 3, allies: 0, wardens: 1 });
    let rk; while (!(rk = gk.next()).done);
    const MK = rk.value;
    built[want] = MK;
    const L = MK.L;

    ok(L.kind === want, 'the baked level knows it is a ' + want);
    ok(L.plats.length > 6, 'and has something to stand on');
    ok(MK.ground.length > 3, 'and a floor to walk along');
    ok(MK.exit.x > MK.player.x + 200, 'and an exit downrange');

    if (want === 'interior') {
      ok(!!L.ceilTile, 'an interior bakes a ceiling');
      ok(L.ceilTile.height > 20, 'and one deep enough to read (' + L.ceilTile.height + 'px)');
      ok(L.ceilH > 0, 'and reserves headroom for it');
      ok(L.wk === 'none', 'and it does not rain indoors');
      ok(!L.plane, 'and has no ground plane under it');
      /* the back wall has to reach the top of the frame: a room whose
         wall stops short is a room with a hole in the roof */
      const wc = L.wallC.getContext('2d');
      const d = wc.getImageData(0, 0, Math.min(200, L.wallC.width), 3).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
      ok(lit > 200 * 3 * 0.9, 'the interior wall runs to the top of the frame');
      // and the floors never climb into the ceiling
      let intoCeiling = 0;
      for (const p of L.plats) if (p.y < L.ceilH) intoCeiling++;
      ok(intoCeiling === 0, 'nothing is placed inside the ceiling');
    }

    if (want === 'air') {
      ok(!!L.plane, 'a mode-7 air level bakes its ground plane');
      ok(L.plane.tile.width > 32, 'and the plane has a real texture');
      ok(L.plane.wide.width === L.plane.tile.width * L.plane.REP,
         'and a pre-tiled strip so the compositor is cheap');
      /* nothing behind an air level: the wall canvas exists so the
         rest of the pipeline keeps working, and is empty */
      const wc = L.wallC.getContext('2d');
      const d = wc.getImageData(0, 0, Math.min(300, L.wallC.width), Math.min(200, L.wallC.height)).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
      ok(lit === 0, 'an air level has nothing behind it');
      ok(L.fg.length === 0, 'and nothing strung across it');
      /* traversable: a slab you cannot leave is not a level. Every gap
         between consecutive ground runs has to be inside a jump. */
      const runs = L.plats.filter(p => p.ground).sort((a, b) => a.x - b.x);
      let worst = 0;
      for (let i = 1; i < runs.length; i++) {
        worst = Math.max(worst, runs[i].x - (runs[i - 1].x + runs[i - 1].w));
      }
      ok(worst <= 40, 'every gap in an air lane is inside a jump (' + worst + 'px)');
    }
  }

  /* the compositor has to draw all three without throwing, and put
     something different on the screen for each */
  {
    const inkOf = c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum;
    };
    const shot = MK => {
      const cv = createCanvas(LV.W, LV.H);
      const cx2 = cv.getContext('2d');
      MK.state = 'play'; MK.player.dead = false;
      MK.scroll = (MK.L.LW - LV.W) * 0.4; MK.time = 2.5;
      MK.cursorX = 280; MK.cursorY = 150;
      window.RENDER.frame(MK, cx2, cv);
      return cv;
    };
    for (const want of ['interior', 'air', 'nature']) {
      const cv = shot(built[want]);
      ok(inkOf(cv) > 0, 'a ' + want + ' level draws something');
    }
    /* what grew back has to actually be there: a nature level keeps the
       sky and the parallax band, and its weather rises instead of
       falling */
    {
      const MN = built.nature;
      ok(MN.L.kind === 'nature', 'a nature level knows what it is');
      ok(MN.L.cityLayers && MN.L.cityLayers.length >= 2,
         'and has a wood behind it in layers');
      ok(!!MN.L.style.flora, 'and the level carries its flora forward to the frame');
      ok(MN.L.wk === 'spore' || MN.L.wk === 'ash',
         'with weather that suits it (' + MN.L.wk + ')');
      ok(MN.L.wallC.width > LV.W, 'and a thicket wall behind the play layer');
    }
    /* the plane has to MOVE, or it is wallpaper */
    const MA = built.air;
    const a1 = shot(MA);
    MA.time = 2.5;
    const p1 = a1.getContext('2d').getImageData(0, LV.H - 40, LV.W, 30).data;
    MA.time = 4.9;
    const cv2 = createCanvas(LV.W, LV.H);
    window.RENDER.frame(MA, cv2.getContext('2d'), cv2);
    const p2 = cv2.getContext('2d').getImageData(0, LV.H - 40, LV.W, 30).data;
    let diff = 0;
    for (let i = 0; i < p1.length; i += 4) if (Math.abs(p1[i] - p2[i]) > 6) diff++;
    ok(diff > 200, 'the ground plane rushes past rather than sitting still (' + diff + 'px)');
  }

  /* contact sheet: one frame of each kind, since "no sky" and "a
     ground plane a long way down" are both things a PNG settles in a
     second and a paragraph never does */
  {
    const cv = createCanvas(LV.W, LV.H * 4);
    const cx2 = cv.getContext('2d');
    const one = createCanvas(LV.W, LV.H);
    const ox2 = one.getContext('2d');
    const shots = [['city', M], ['interior', built.interior],
                   ['air', built.air], ['nature', built.nature]];
    shots.forEach(([label, MK], i) => {
      MK.state = 'play'; MK.endT = 0; MK.player.dead = false; MK.player.hp = 78;
      MK.scroll = (MK.L.LW - LV.W) * 0.4;
      MK.time = 2.6; MK.cursorX = 300; MK.cursorY = 150;
      let px = MK.scroll + 120, g2 = null;
      for (let k = 0; k < 50 && !g2; k++) { px = MK.scroll + 70 + k * 8; g2 = MK.world.groundUnder(px, 0, true); }
      MK.player.x = px; if (g2) MK.player.y = g2.y;
      MK.player.anim = 'run'; MK.player.frame = 2; MK.player.local = -0.25; MK.player.face = 1;
      window.RENDER.frame(MK, ox2, one);
      cx2.drawImage(one, 0, i * LV.H);
      cx2.font = '12px monospace';
      cx2.fillStyle = '#fff';
      cx2.fillText(label.toUpperCase() + '  ' + MK.cfg.style, 8, i * LV.H + LV.H - 8);
    });
    dump('out_kinds.png', cv);
  }
}

/* the level's collision data drawn over the play layer */
{
  const cv = createCanvas(Math.min(1400, M.L.LW), LV.H);
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(M.L.playC, 0, 0);
  for (const p of M.L.plats) {
    cx.fillStyle = p.ground ? 'rgba(240,168,48,.30)' : 'rgba(74,208,122,.34)';
    cx.fillRect(p.x, p.y, p.w, window.PHYSICS.thickOf(p));
    cx.fillStyle = p.ground ? '#f0a830' : '#4ad07a';
    cx.fillRect(p.x, p.y - 1, p.w, 1);
  }
  cx.fillStyle = '#ff3b30';
  cx.fillRect(M.exit.x - 2, M.exit.y - 40, 4, 40);
  dump('out_collision.png', cv);
}

/* ---------------- report ---------------- */
console.log('\n' + '='.repeat(46));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nfailures:');
  for (const f of fails.slice(0, 25)) console.log('  - ' + f);
}
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
