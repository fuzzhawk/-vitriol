/* ============================================================
   harness-flights.js — the scenarios that have to actually PLAY.

   Split out of harness-game.js for one reason: memory. Every mission
   bakes its own sprite sheets — level layers, two rigs per hostile
   archetype, crawlers, debris, the boss, the wardens — and those are
   native canvas buffers that V8 feels no pressure from, so they are
   never collected inside a long-lived process. Eight flown missions in
   one address space is a few gigabytes and an OOM kill, which reads
   like a test failure and is not one.

   So each scenario runs here, in its own process, and prints one line
   of JSON. harness-game.js spawns them and asserts on the results. The
   checks live with the rest of the suite; only the address space is
   separate.

       node tools/harness-flights.js <scenario>

   Scenarios: autopilot | chain | campaign
   ============================================================ */
'use strict';
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
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

for (const f of [
  'src/gen/greebleworks.js', 'src/gen/mercforge.js', 'src/gen/crawlerforge.js',
  'src/gen/scrapforge.js',
  'src/game/config.js', 'src/game/audio.js', 'src/game/weapons.js',
  'src/game/sprite.js', 'src/game/physics.js', 'src/game/rigid.js',
  'src/game/dialog.js', 'src/game/campaign.js',
  'src/game/pilot.js', 'src/game/entities.js',
  'src/game/world.js', 'src/game/render.js'
]) require(path.join(ROOT, f));

const IDLE = {
  left: false, right: false, up: false, down: false, fire: false,
  jumpPressed: false, reloadPressed: false, talkPressed: false,
  cursorX: 224, cursorY: 126, aimX: 0, aimY: 0
};

function bake(cfg, merc, opts) {
  const g = window.WORLD.buildMission(cfg, merc, opts);
  let r; while (!(r = g.next()).done);
  return r.value;
}

/* Run one mission to its end. Returns what happened, never how. */
function fly(M, maxSeconds) {
  const startX = M.player.x;
  let maxX = startX, deaths = 0, frames = 0;
  const cap = 60 * (maxSeconds || 150);
  while (M.state === 'play' && frames++ < cap) {
    M.update(1 / 60, IDLE);
    if (M.player.x > maxX) maxX = M.player.x;
    if (M.state === 'dead') { deaths++; if (!M.respawn()) break; }
  }
  return {
    state: M.state, deaths, frames,
    kills: M.kills, total: M.totalEnemies,
    progress: +((maxX - startX) / Math.max(1, M.L.LW - startX)).toFixed(3)
  };
}

const SCENARIOS = {
  /* Can it finish a level at all? The headline claim of the whole
     pilot, checked on two unrelated seeds. */
  autopilot() {
    const runs = [];
    for (const sd of [0x51, 0x9E]) {
      const cfg = window.CONFIG.randomLevelCfg(sd);
      cfg.levelLen = 3;
      const M = bake(cfg, window.CONFIG.randomMerc(sd), {
        difficulty: 'recruit', enemyDens: 0.8, lives: 9, allies: 2, autopilot: true
      });
      const held = { touched: false };
      const before = JSON.stringify(IDLE);
      const out = fly(M);
      held.touched = JSON.stringify(IDLE) !== before;
      runs.push(Object.assign({ seed: sd.toString(16), autopilot: M.autopilot,
                                hasPilot: M.pilot instanceof window.PILOT.Pilot,
                                inputTouched: held.touched }, out));
    }
    return { runs };
  },

  /* Continuous mode: a chain of consecutive rolled builds, the way the
     app loop drives one when a full-auto run ends. */
  chain() {
    const rng = window.GREEBLEWORKS.makeRng(0xC4A1);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const sd = (rng.rnd() * 0xffffffff) >>> 0;
      const cfg = window.CONFIG.randomLevelCfg(sd);
      cfg.levelLen = 3;
      const M = bake(cfg, window.CONFIG.randomMerc(sd), {
        difficulty: 'recruit', enemyDens: 0.8, lives: 3, allies: 1, autopilot: true
      });
      const out = fly(M);
      /* The app loop waits on endT to settle before redeploying, so the
         clock has to keep running once the run is over. */
      const t0 = M.endT;
      for (let k = 0; k < 120; k++) M.update(1 / 60, IDLE);
      runs.push(Object.assign({
        seed: sd, style: cfg.style,
        endClockRuns: M.endT > t0,
        stayedEnded: M.state !== 'play',
        keptAutopilot: M.autopilot === true
      }, out));
    }
    return { runs, distinctSeeds: new Set(runs.map(r => r.seed)).size };
  },

  /* A campaign, flown end to end. What is under test is the carry and
     the curve; the sectors are kept short so this stays one process. */
  campaign() {
    const CA = window.CAMPAIGN;
    const camp = new CA.Campaign(0xC0FFEE, {
      difficulty: 'recruit', enemyDens: 0.45, lives: 9, allies: 0, autopilot: true
    });
    camp.total = 3;
    /* Rolled ONCE. If a campaign ever rerolled the operative, the rig
       identity below is the thing that would notice. */
    const merc = window.CONFIG.randomMerc(0xC0FFEE);
    const sectors = [];
    let firstRig = null, carriedWeapon = null, prevDens = 0;

    for (let i = 0; i < camp.total; i++) {
      const b = camp.build();
      b.cfg.levelLen = 3;
      b.opts.wardens = 1;
      const M = bake(b.cfg, merc, Object.assign({}, b.opts,
        { scrap: b.scrap, boss: b.boss, proto: b.proto }));
      if (!firstRig) firstRig = M.player.rig;

      const rec = {
        n: camp.sector,
        style: b.cfg.style,
        knowsCampaign: M.campaign === camp,
        knowsSector: M.sector === camp.sector,
        wardens: M.wardens.length,
        densRose: b.opts.enemyDens >= prevDens - 1e-9,
        /* The rig only legitimately differs once a prototype has been
           picked up — that swaps the sprite to one holding it. */
        sameOperative: M.player.rig === firstRig || M.player.weapon.kind === 'proto',
        carriedWeaponIn: carriedWeapon,
        weaponIn: M.player.weapon.kind,
        buffsIn: JSON.stringify(M.player.buffs),
        hpIn: Math.round(M.player.hp),
        maxHpIn: M.player.maxHp
      };
      prevDens = b.opts.enemyDens;

      Object.assign(rec, fly(M));
      rec.spoken = M.wardens.filter(W => W.spent).length;
      rec.buffsOut = JSON.stringify(M.player.buffs);
      rec.weaponOut = M.player.weapon.kind;
      sectors.push(rec);
      if (M.state !== 'won') break;

      const carry = camp.take(M);
      rec.carryWeapon = carry.weapon;
      rec.carryHp = Math.round(carry.hp);
      rec.carryFloor = Math.round(M.player.maxHp * 0.4);
      carriedWeapon = carry.weapon;
      camp.advance();
    }
    return {
      sectors,
      done: camp.done, won: camp.won,
      logged: camp.log.length, score: camp.score, kills: camp.kills,
      styles: Array.from(new Set(sectors.map(s => s.style)))
    };
  },

  /* Carrying a prototype across a sector boundary: the one carry that
     touches two systems, the gun and the sprite holding it. */
  protocarry() {
    const CA = window.CAMPAIGN;
    const camp = new CA.Campaign(0x1234, { difficulty: 'recruit', allies: 0, wardens: 0 });
    camp.total = 2;
    const merc = window.CONFIG.randomMerc(0x1234);

    const b = camp.build();
    b.cfg.levelLen = 3;
    const M1 = bake(b.cfg, merc, Object.assign({}, b.opts,
      { scrap: b.scrap, boss: b.boss, proto: b.proto, wardens: 0 }));
    const pk = M1.pickups.find(p => p.shrine);
    const out = { placed: !!pk };
    if (!pk) return out;
    M1.take(pk);
    out.equipped = M1.player.weapon.kind === 'proto';
    out.label = M1.player.weapon.def.label;
    const protoRig = M1.player.rig;
    M1.player.buffs.dmg = 1.5;
    M1.player.maxHp = 140; M1.player.hp = 60;
    M1.player.weapon.ammo = 3;
    camp.take(M1);
    camp.advance();

    const b2 = camp.build();
    b2.cfg.levelLen = 3;
    const M2 = bake(b2.cfg, merc, Object.assign({}, b2.opts,
      { scrap: b2.scrap, boss: b2.boss, proto: b2.proto, wardens: 0 }));
    out.kindOut = M2.player.weapon.kind;
    out.labelOut = M2.player.weapon.def.label;
    out.sameRig = M2.player.rig === protoRig;
    out.dmgBuff = M2.player.buffs.dmg;
    out.maxHp = M2.player.maxHp;
    out.hp = M2.player.hp;
    out.ammo = M2.player.weapon.ammo;
    out.differentPlace = b2.cfg.seed !== b.cfg.seed;
    return out;
  }
};

const which = process.argv[2];
if (!SCENARIOS[which]) {
  console.error('usage: harness-flights.js <' + Object.keys(SCENARIOS).join('|') + '>');
  process.exit(2);
}
process.stdout.write(JSON.stringify(SCENARIOS[which]()));
