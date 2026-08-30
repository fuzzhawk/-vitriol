/* ============================================================
   main.js — app state machine, input, and the frame loop.

   States: title -> setup -> loading -> play <-> paused -> debrief

   The loop runs a FIXED 1/60 step (handoff §3.5) and renders once
   per animation frame. The loading state drives the mission
   generator against a frame budget, exactly the way the tool's
   runJob() keeps its UI alive during a bake.
   ============================================================ */
(function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const C = window.CONFIG;
  const S = window.SCREENS;
  const LV = GW.LV;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const $ = id => document.getElementById(id);

  const STEP = 1 / 60;
  const BUDGET = 26;              // ms of generator work per frame while loading

  /* ---------------- app state ---------------- */
  const App = {
    state: 'title',
    canvas: null, ctx: null,
    scale: 2, offX: 0, offY: 0,
    cfg: null, merc: null, crawler: null, scrap: null, boss: null, proto: null,
    opts: Object.assign({}, C.RUN_DEFAULTS),
    mission: null,
    job: null, jobProgress: 0, jobMsg: '', jobPhase: '',
    title: null, titleT: 0,
    mercPreview: null, previewRig: null, previewT: 0, previewTimer: 0,
    crawlerPreview: null, crawlerRig: null, crawlerT: 0, crawlerTimer: 0, crawlerLimbs: [],
    scrapPreview: null, scrapSet: null, scrapTimer: 0,
    bossPreview: null, bossRig: null, bossT: 0, bossTimer: 0, bossLimbs: [],
    protoPreview: null, protoT: 0, protoShots: [],
    mode: 'random',
    tab: 'level',
    autoNext: 0,          // countdown to the next run under autopilot
    autoRuns: 0,          // how many it has flown back to back
    lastStats: null,
    panels: { level: null, merc: null, crawler: null, scrap: null, boss: null, proto: null }
  };

  const input = {
    left: false, right: false, up: false, down: false,
    fire: false, jumpPressed: false, reloadPressed: false,
    cursorX: LV.W / 2, cursorY: LV.H / 2, aimX: 0, aimY: 0
  };

  /* ---------------- canvas sizing ---------------- */
  function resize() {
    const cv = App.canvas;
    const wrap = $('stage');
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // Integer scale keeps the nearest-neighbour upscale crisp.
    let s = Math.min(w / LV.W, h / LV.H);
    s = s >= 1 ? Math.floor(s) : s;
    if (s < 1) s = Math.min(w / LV.W, h / LV.H);
    App.scale = s;
    cv.width = LV.W; cv.height = LV.H;
    cv.style.width = Math.round(LV.W * s) + 'px';
    cv.style.height = Math.round(LV.H * s) + 'px';
    const r = cv.getBoundingClientRect();
    App.offX = r.left; App.offY = r.top;
  }

  function cursorFromEvent(e) {
    const r = App.canvas.getBoundingClientRect();
    input.cursorX = clamp((e.clientX - r.left) / App.scale, 0, LV.W);
    input.cursorY = clamp((e.clientY - r.top) / App.scale, 0, LV.H);
  }

  /* ---------------- input ---------------- */
  const KEYMAP = {
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down'
  };

  function bindInput() {
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        if (App.state === 'play') pause(true);
        else if (App.state === 'paused') pause(false);
        else if (App.state === 'debrief' && App.autoNext > 0) {
          cancelAutoNext();
          window.AUDIO.play('ui');
        }
        return;
      }
      if (e.code === 'Enter') {
        if (App.state === 'play' && App.mission && App.mission.state !== 'play' && App.mission.endT > 1.1) {
          endStep();
          e.preventDefault();
          return;
        }
      }
      if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
      if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
        input.jumpPressed = true;
        if (e.code === 'Space') e.preventDefault();
      }
      if (e.code === 'KeyR') input.reloadPressed = true;
      if (e.code === 'KeyM') toggleSound();
      if (e.code === 'KeyP' && App.mission &&
          (App.state === 'play' || App.state === 'paused')) {
        // handing over mid-run: clear the human's held keys so a key
        // still down when the pilot takes over does not fight it
        App.mission.autopilot = !App.mission.autopilot;
        // a lasting handover: the option, the build screen and the next
        // run all follow what you just did
        App.opts.autopilot = App.mission.autopilot;
        $('autoField').checked = App.mission.autopilot;
        input.left = input.right = input.up = input.down = false;
        input.fire = false;
        App.mission.say(App.mission.autopilot ? 'PILOT HAS CONTROL' : 'MANUAL CONTROL');
        window.AUDIO.play('uiBig');
      }
    });
    window.addEventListener('keyup', e => {
      if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
    });
    window.addEventListener('blur', () => {
      input.left = input.right = input.up = input.down = input.fire = false;
      if (App.state === 'play') pause(true);
    });
    const cv = App.canvas;
    cv.addEventListener('mousemove', cursorFromEvent);
    cv.addEventListener('mousedown', e => {
      cursorFromEvent(e);
      if (e.button === 0) input.fire = true;
      window.AUDIO.resume();
      e.preventDefault();
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) input.fire = false; });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('resize', resize);
  }

  /* ---------------- screen switching ---------------- */
  function show(name) {
    if (name !== 'debrief') cancelAutoNext();
    App.state = name;
    for (const id of ['scr-title', 'scr-setup', 'scr-load', 'scr-pause', 'scr-debrief']) {
      $(id).classList.toggle('on', id === 'scr-' + name.replace('play', 'none')
        .replace('title', 'title').replace('setup', 'setup')
        .replace('loading', 'load').replace('paused', 'pause').replace('debrief', 'debrief'));
    }
    $('stage').classList.toggle('playing', name === 'play' || name === 'paused');
    document.body.classList.toggle('in-game', name === 'play' || name === 'paused');
  }

  /* ---------------- title ---------------- */
  function bootTitle() {
    show('title');
    // A sky bake for the menu backdrop: one generator call, ~0.3s,
    // and the launch screen is then made of the same material as the
    // game instead of a flat colour.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const cfg = C.randomLevelCfg(seed);
    const g = GW.bakeSky(Object.assign({}, cfg, { outW: LV.W, outH: LV.H, SS: 2 }));
    const pump = () => {
      const t0 = performance.now();
      let r;
      while (performance.now() - t0 < 12) {
        r = g.next();
        if (r.done) { App.title = r.value; return; }
      }
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
    $('t-seed').textContent = 'BUILD ' + seed.toString(16).toUpperCase().padStart(8, '0');
  }

  function drawTitle(ctx, dt) {
    App.titleT += dt;
    const t = App.titleT;
    ctx.imageSmoothingEnabled = false;
    const T = App.title;
    if (!T) {
      ctx.fillStyle = '#0b0d0f';
      ctx.fillRect(0, 0, LV.W, LV.H);
      return;
    }
    const tile = (img, f) => {
      const off = -(((t * 9 * f) % img.width) + img.width) % img.width;
      for (let x = off; x < LV.W; x += img.width) ctx.drawImage(img, Math.round(x), 0);
    };
    tile(T.sky, 0.15);
    const n = T.layers.length;
    for (let i = 0; i < n; i++) tile(T.layers[i], 0.4 + 1.5 * (n === 1 ? 1 : i / (n - 1)));
    /* Menu text sits over this, and the skyline behind it can bake out
       anywhere from near-black to bright overcast depending on the
       mood that was rolled. A flat wash plus a band through the middle
       keeps the contrast the same whatever came out of the generator. */
    ctx.fillStyle = 'rgba(7,9,11,.46)';
    ctx.fillRect(0, 0, LV.W, LV.H);

    const band = ctx.createLinearGradient(0, LV.H * 0.10, 0, LV.H);
    band.addColorStop(0, 'rgba(6,7,9,0)');
    band.addColorStop(0.22, 'rgba(6,7,9,.62)');
    band.addColorStop(0.72, 'rgba(6,7,9,.72)');
    band.addColorStop(1, 'rgba(6,7,9,.93)');
    ctx.fillStyle = band;
    ctx.fillRect(0, LV.H * 0.10, LV.W, LV.H * 0.90);

    const vg = ctx.createRadialGradient(LV.W / 2, LV.H / 2, LV.H * 0.28, LV.W / 2, LV.H / 2, LV.H);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, LV.W, LV.H);
  }

  /* ---------------- setup ---------------- */
  function rollSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  function applySeed(seed) {
    App.cfg = C.randomLevelCfg(seed);
    App.merc = C.randomMerc(seed);
    App.crawler = C.crawlerParams(seed, App.cfg, 0);
    /* Seed the debris panel with the LEVEL-MATCHED roll, not a free
       one. The panel's values are passed to the mission as overrides,
       so a free roll here would always win and the level match would
       never take effect — which is exactly what happened. */
    App.scrap = C.scrapParamsFor(seed, App.cfg);
    App.boss = C.overlordParams((seed ^ 0x0b055) >>> 0, App.cfg);
    App.proto = window.WEAPONS.rollProto(GW.makeRng((seed ^ 0x9ea9) >>> 0));
    App.cfg.seed = seed >>> 0;
    App.merc.seed = seed >>> 0;
  }

  function openSetup() {
    if (!App.cfg) applySeed(rollSeed());
    show('setup');
    refreshSetup();
    buildPanels();
    schedulePreview(true);
  }

  function refreshSetup() {
    $('seedField').value = App.cfg.seed.toString(16).toUpperCase().padStart(8, '0');
    $('m-random').classList.toggle('on', App.mode === 'random');
    $('m-custom').classList.toggle('on', App.mode === 'custom');
    $('customWrap').style.display = App.mode === 'custom' ? '' : 'none';
    $('rollSummary').style.display = App.mode === 'random' ? '' : 'none';
    // The per-tab sidebar controls only make sense in custom mode.
    const custom = App.mode === 'custom';
    $('previewWrap').style.display = custom && App.tab === 'merc' ? '' : 'none';
    $('crawlerPreviewWrap').style.display = custom && App.tab === 'crawler' ? '' : 'none';
    $('rollLevelWrap').style.display = custom && App.tab === 'level' ? '' : 'none';
    $('rollMercWrap').style.display = custom && App.tab === 'merc' ? '' : 'none';
    $('rollCrawlerWrap').style.display = custom && App.tab === 'crawler' ? '' : 'none';
    $('scrapPreviewWrap').style.display = custom && App.tab === 'scrap' ? '' : 'none';
    $('rollScrapWrap').style.display = custom && App.tab === 'scrap' ? '' : 'none';
    $('bossPreviewWrap').style.display = custom && App.tab === 'boss' ? '' : 'none';
    $('rollBossWrap').style.display = custom && App.tab === 'boss' ? '' : 'none';
    $('protoPreviewWrap').style.display = custom && App.tab === 'proto' ? '' : 'none';
    $('rollProtoWrap').style.display = custom && App.tab === 'proto' ? '' : 'none';

    const w = window.WEAPONS.table[App.merc.gun];
    $('rollSummary').innerHTML =
      row('ARCHITECTURE', App.cfg.style) +
      row('SKY', App.cfg.skyMood) +
      row('PALETTE', App.cfg.palette) +
      row('LENGTH', App.cfg.levelLen + ' screens') +
      row('WEATHER', App.cfg.weather === 'auto' ? 'auto' : App.cfg.weather) +
      row('OPERATIVE', App.merc.height + 'px · ' + App.merc.helmet + ' · ' + App.merc.backpack) +
      row('LOADOUT', w ? w.label : App.merc.gun) +
      row('CRAWLERS', (C.CRAWLER_PALETTES[App.cfg.style] || ['assorted']).join(' / ')) +
      row('RESERVES', App.opts.allies + ' frozen operative' + (App.opts.allies === 1 ? '' : 's')) +
      row('PILOT', App.opts.autopilot ? 'FULL AUTOPILOT' : 'manual');

    for (const k in C.DIFFICULTY) {
      const b = $('d-' + k);
      if (b) b.classList.toggle('on', App.opts.difficulty === k);
    }
    $('allyField').value = App.opts.allies;
    $('allyVal').textContent = App.opts.allies;
    $('autoField').checked = !!App.opts.autopilot;
    $('t-seed').textContent = 'BUILD ' + App.cfg.seed.toString(16).toUpperCase().padStart(8, '0');
  }

  const row = (k, v) => '<div class="sum-row"><span>' + k + '</span><b>' + v + '</b></div>';

  function buildPanels() {
    const lvHost = $('panel-level'), mcHost = $('panel-merc');
    lvHost.innerHTML = ''; mcHost.innerHTML = '';
    const lp = S.levelPanel(App.cfg, () => { markDirty(); });
    lvHost.appendChild(lp.frag);
    App.panels.level = lp.groups;
    const mp = S.mercPanel(App.merc, () => { markDirty(); schedulePreview(); });
    mcHost.appendChild(mp.frag);
    App.panels.merc = mp.groups;

    const scHost = $('panel-scrap');
    scHost.innerHTML = '';
    const sp = S.scrapPanel(App.scrap, () => { markDirty(); scheduleScrapPreview(); });
    scHost.appendChild(sp.frag);
    App.panels.scrap = sp.groups;

    const bsHost = $('panel-boss');
    bsHost.innerHTML = '';
    const bp = S.bossPanel(App.boss, () => { markDirty(); scheduleBossPreview(); });
    bsHost.appendChild(bp.frag);
    App.panels.boss = bp.groups;

    const prHost = $('panel-proto');
    prHost.innerHTML = '';
    const pp = S.protoPanel(App.proto, () => {
      markDirty();
      window.WEAPONS.retune(App.proto);
      App.protoShots.length = 0;
    });
    prHost.appendChild(pp.frag);
    App.panels.proto = pp.groups;

    const crHost = $('panel-crawler');
    crHost.innerHTML = '';
    const cp = S.crawlerPanel(App.crawler, () => {
      markDirty();
      scheduleCrawlerPreview();
      // keep a pinned build pointing at what the panel is editing
      if (App.opts.crawler) App.opts.crawler = App.crawler;
    });
    crHost.appendChild(cp.frag);
    App.panels.crawler = cp.groups;
  }

  function markDirty() {
    // Hand-editing means the build is no longer just its seed.
    $('seedNote').textContent = 'MODIFIED';
  }

  function syncPanels() {
    if (App.panels.level) S.syncGroups(App.panels.level, App.cfg);
    if (App.panels.merc) S.syncGroups(App.panels.merc, App.merc);
    if (App.panels.crawler) S.syncGroups(App.panels.crawler, App.crawler);
    if (App.panels.scrap) S.syncGroups(App.panels.scrap, App.scrap);
    if (App.panels.boss) S.syncGroups(App.panels.boss, App.boss);
    if (App.panels.proto) S.syncGroups(App.panels.proto, App.proto);
  }

  /* live operative preview */
  function schedulePreview(immediate) {
    clearTimeout(App.previewTimer);
    const go = () => {
      try {
        App.previewRig = new window.SPRITE.Rig(Object.assign({}, App.merc));
      } catch (e) {
        App.previewRig = null;
      }
    };
    if (immediate) go();
    else App.previewTimer = setTimeout(go, 90);   // the tool debounces at 70ms
  }

  function drawPreview(dt) {
    const cv = App.mercPreview;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#0e1113';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // A faint grid gives the figure a sense of scale.
    ctx.fillStyle = '#141819';
    for (let gx = 0; gx < cv.width; gx += 16) ctx.fillRect(gx, 0, 1, cv.height);
    for (let gy = 0; gy < cv.height; gy += 16) ctx.fillRect(0, gy, cv.width, 1);
    // floor line
    ctx.fillStyle = '#242c30';
    ctx.fillRect(0, cv.height - 26, cv.width, 2);
    const R = App.previewRig;
    if (!R) return;
    App.previewT += dt;
    const t = App.previewT;
    const state = (Math.floor(t / 3) % 2) ? 'run' : 'idle';
    const frame = R.frameOf(state, t, t * 9);
    const local = Math.sin(t * 0.7) * (Math.PI / 2) * 0.92;
    // Integer scale, as large as the box allows, so the preview shows
    // the same crisp pixels the game will blit.
    const sc = Math.max(1, Math.min(6, Math.floor(Math.min(
      (cv.width - 24) / R.sheet.CW, (cv.height - 44) / R.sheet.CH))));
    const px = cv.width / 2 / sc;
    const py = (cv.height - 26) / sc;
    ctx.save();
    ctx.scale(sc, sc);
    R.draw(ctx, state, frame, local, px, py, false);
    ctx.restore();
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = '#5d6a72';
    ctx.textAlign = 'left';
    ctx.fillText(R.sheet.cols.length + ' frames × ' + R.sheet.angles.length + ' aim rows', 6, 13);
    ctx.fillText('cell ' + R.sheet.CW + '×' + R.sheet.CH, 6, 25);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f0a830';
    ctx.fillText((window.WEAPONS.table[R.gun] || {}).label || R.gun, cv.width - 6, 13);
  }

  /* live crawler preview: a blob on a deck, hauling on its tentacles */
  function scheduleCrawlerPreview(immediate) {
    clearTimeout(App.crawlerTimer);
    const go = () => {
      try {
        App.crawlerRig = new window.SPRITE.CrawlerRig(Object.assign({}, App.crawler));
        // give each socket its own idle rhythm so the limbs do not pulse together
        App.crawlerLimbs = [];
        const n = App.crawlerRig.socketCount();
        for (let i = 0; i < n; i++) {
          App.crawlerLimbs.push({ i, phase: i * 1.7, variant: i % App.crawlerRig.tent.count });
        }
      } catch (e) {
        App.crawlerRig = null;
      }
    };
    // A crawler bake is heavier than a merc sheet, so give slider drags
    // a longer settle before spending it.
    if (immediate) go();
    else App.crawlerTimer = setTimeout(go, 180);
  }

  function drawCrawlerPreview(dt) {
    const cv = App.crawlerPreview;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e1113';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#141819';
    for (let gx = 0; gx < cv.width; gx += 16) ctx.fillRect(gx, 0, 1, cv.height);
    for (let gy = 0; gy < cv.height; gy += 16) ctx.fillRect(0, gy, cv.width, 1);

    const R = App.crawlerRig;
    if (!R) return;
    App.crawlerT += dt;
    const t = App.crawlerT;

    const sc = Math.max(1, Math.min(5, Math.floor(Math.min(
      (cv.width - 30) / (R.sheet.CW + R.tent.length * 0.5),
      (cv.height - 54) / R.sheet.CH))));
    ctx.save();
    ctx.scale(sc, sc);
    const W = cv.width / sc, H = cv.height / sc;
    const deckY = H - 16;
    ctx.fillStyle = '#242c30';
    ctx.fillRect(4, deckY, W - 8, 4);

    const bx = W / 2, by = deckY - R.reach('floor');
    /* limbs first — behind the body, same as in the game */
    for (const l of App.crawlerLimbs) {
      const so = R.socket(l.i, bx, by, false, 'floor');
      const swing = Math.sin(t * 1.3 + l.phase);
      const reach = R.tent.length * (0.42 + 0.16 * swing);
      const a = Math.atan2(so.ny, so.nx);
      let ax = so.x + Math.cos(a) * reach;
      let ay = so.y + Math.sin(a) * reach;
      // limbs that point downward find the deck and grip it
      if (ay > deckY) ay = deckY;
      window.CRAWLERFORGE.drawTentacle(ctx, R.tent, l.variant,
        so.x, so.y, ax, ay, swing * 9, {});
    }
    const state = (Math.floor(t / 2.6) % 2) ? 'pull' : 'idle';
    R.draw(ctx, state, R.frameOf(state, t), 'floor', bx, by, false);
    ctx.restore();

    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = '#5d6a72';
    ctx.textAlign = 'left';
    ctx.fillText('cell ' + R.sheet.CW + '×' + R.sheet.CH + ' · ' +
                 R.sheet.cols.length + '×4 sheet', 6, 13);
    ctx.fillText(R.socketCount() + ' sockets · ' + R.tent.count + ' strips · r' +
                 R.phys.radius.toFixed(0), 6, 25);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#d4536a';
    ctx.fillText(App.crawler.palette, cv.width - 6, 13);
    if (App.opts.crawler) {
      ctx.fillStyle = '#f0a830';
      ctx.fillText('PINNED', cv.width - 6, 25);
    }
  }

  /* debris preview: the whole set, laid out as it will be scattered */
  function scheduleScrapPreview(immediate) {
    clearTimeout(App.scrapTimer);
    const go = () => {
      try {
        App.scrapSet = window.SCRAPFORGE.forgeSet(App.scrap.seed >>> 0,
          { params: Object.assign({}, App.scrap, { dmgFrames: 3 }) });
      } catch (e) { App.scrapSet = null; }
      drawScrapPreview();
    };
    if (immediate) go(); else App.scrapTimer = setTimeout(go, 140);
  }

  function drawScrapPreview() {
    const cv = App.scrapPreview;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e1113';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#141819';
    for (let gx = 0; gx < cv.width; gx += 16) ctx.fillRect(gx, 0, 1, cv.height);
    for (let gy = 0; gy < cv.height; gy += 16) ctx.fillRect(0, gy, cv.width, 1);
    const set = App.scrapSet;
    if (!set) return;
    const kinds = window.SCRAPFORGE.KINDS;
    const maxW = Math.max.apply(null, kinds.map(k => set[k].CW));
    const maxH = Math.max.apply(null, kinds.map(k => set[k].CH));
    const cols = 3, rows = Math.ceil(kinds.length / cols);
    const sc = Math.max(1, Math.min(4, Math.floor(Math.min(
      (cv.width - 16) / (maxW * cols + 8), (cv.height - 30) / (maxH * rows + 8)))));
    kinds.forEach((k, i) => {
      const S2 = set[k];
      const gx = 8 + (i % cols) * (maxW * sc + 8);
      const gy = 22 + Math.floor(i / cols) * (maxH * sc + 6);
      // show the intact state, and the wrecked one behind it faintly
      ctx.globalAlpha = 0.30;
      ctx.drawImage(S2.canvas, (S2.frames - 1) * S2.CW, 0, S2.CW, S2.CH,
        gx + 4, gy + 3, S2.CW * sc, S2.CH * sc);
      ctx.globalAlpha = 1;
      ctx.drawImage(S2.canvas, 0, 0, S2.CW, S2.CH, gx, gy, S2.CW * sc, S2.CH * sc);
    });
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = '#5d6a72';
    ctx.textAlign = 'left';
    ctx.fillText(kinds.length + ' kinds · 3 damage states', 6, 13);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8aa0b4';
    ctx.fillText(App.scrap.palette, cv.width - 6, 13);
  }

  /* live boss preview: hovering, limbs coiling, at true scale */
  function scheduleBossPreview(immediate) {
    clearTimeout(App.bossTimer);
    const go = () => {
      try {
        App.bossRig = new window.SPRITE.CrawlerRig(Object.assign({}, App.boss));
        App.bossLimbs = [];
        for (let i = 0; i < App.bossRig.socketCount(); i++) {
          App.bossLimbs.push({ i, phase: i * 1.4, variant: i % App.bossRig.tent.count });
        }
      } catch (e) { App.bossRig = null; }
    };
    // a boss bake is the heaviest in the game; let a drag settle first
    if (immediate) go(); else App.bossTimer = setTimeout(go, 260);
  }

  function drawBossPreview(dt) {
    const cv = App.bossPreview;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e1113';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#141819';
    for (let g = 0; g < cv.width; g += 16) ctx.fillRect(g, 0, 1, cv.height);
    for (let g = 0; g < cv.height; g += 16) ctx.fillRect(0, g, cv.width, 1);

    const R = App.bossRig;
    if (!R) return;
    App.bossT += dt;
    const t = App.bossT;
    const sc = Math.max(1, Math.min(3, Math.floor(Math.min(
      (cv.width - 20) / (R.sheet.CW + R.tent.length * 1.1),
      (cv.height - 54) / (R.sheet.CH + R.tent.length * 0.7)))));
    ctx.save();
    ctx.scale(sc, sc);
    const W = cv.width / sc, H = cv.height / sc;
    const bx = W / 2, by = H / 2 - 4 + Math.sin(t * 1.1) * 3;

    for (const l of App.bossLimbs) {
      const so = R.socket(l.i, bx, by, false, 'floor');
      const swirl = t * 0.7 + l.phase;
      const reach = R.tent.length * (0.42 + 0.16 * Math.sin(swirl));
      const a = Math.atan2(so.ny, so.nx) + Math.sin(swirl * 0.6) * 0.5;
      window.CRAWLERFORGE.drawTentacle(ctx, R.tent, l.variant, so.x, so.y,
        so.x + Math.cos(a) * reach, so.y + Math.sin(a) * reach,
        Math.sin(swirl * 0.8) * 12, { thickness: 1.35 });
    }
    const state = (Math.floor(t / 3) % 2) ? 'pull' : 'idle';
    R.draw(ctx, state, R.frameOf(state, t), 'floor', bx, by, false);
    ctx.restore();

    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = '#5d6a72';
    ctx.textAlign = 'left';
    ctx.fillText(App.boss.size + 'px · ' + R.socketCount() + ' limbs · r' +
                 R.phys.radius.toFixed(0), 6, 13);
    ctx.fillText('cell ' + R.sheet.CW + '×' + R.sheet.CH, 6, 25);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c8323a';
    ctx.fillText(App.boss.palette, cv.width - 6, 13);
  }

  /* live weapon preview: a firing range, so the roll is legible as
     behaviour rather than as a table of numbers */
  function drawProtoPreview(dt) {
    const cv = App.protoPreview;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const D = App.proto;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e1113';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!D) return;
    App.protoT += dt;

    const W = cv.width, H = cv.height;
    const rangeTop = 72;
    const muzzleX = 18, muzzleY = rangeTop + (H - rangeTop) * 0.52;

    // range furniture
    ctx.fillStyle = '#141819';
    ctx.fillRect(0, rangeTop, W, H - rangeTop);
    const floorY = H - 14;
    ctx.fillStyle = '#1b2124';
    ctx.fillRect(0, floorY, W, 6);                       // floor
    ctx.fillRect(W - 26, rangeTop + 8, 6, floorY - rangeTop - 8);          // target plate
    ctx.fillStyle = '#2a3338';
    ctx.fillRect(W - 26, muzzleY - 6, 6, 12);

    ctx.fillStyle = '#2a3338';
    ctx.fillRect(muzzleX - 10, muzzleY - 3, 10, 6);      // the muzzle it leaves from

    // fire on the weapon's own cadence
    App.protoFire = (App.protoFire || 0) - dt;
    if (App.protoFire <= 0) {
      App.protoFire = Math.max(0.06, D.rate);
      const n = Math.max(1, D.count | 0);
      for (let k = 0; k < n; k++) {
        const off = n === 1 ? (Math.random() - 0.5) * 2
                            : ((k / (n - 1)) - 0.5) * 2 + (Math.random() - 0.5) * 0.4;
        App.protoShots.push({
          x: muzzleX, y: muzzleY,
          vx: Math.cos(D.spread * off) * D.speed,
          vy: Math.sin(D.spread * off) * D.speed,
          life: D.life, max: D.life, bounce: D.bounce | 0, trail: []
        });
      }
      if (App.protoShots.length > 260) App.protoShots.splice(0, 60);
    }

    for (let i = App.protoShots.length - 1; i >= 0; i--) {
      const b = App.protoShots[i];
      b.life -= dt;
      if (b.life <= 0) { App.protoShots.splice(i, 1); continue; }
      if (D.drop) b.vy += D.drop;
      if (D.homing) {          // curve toward the target plate
        const want = Math.atan2((muzzleY) - b.y, (W - 23) - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        let d2 = want - cur;
        while (d2 > Math.PI) d2 -= TAU;
        while (d2 < -Math.PI) d2 += TAU;
        const na = cur + clamp(d2, -D.homing * 6, D.homing * 6);
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }
      b.x += b.vx; b.y += b.vy;
      b.trail.push(b.x, b.y);
      if (b.trail.length > 12) b.trail.splice(0, 2);
      // floor and ceiling ricochet
      if ((b.y > floorY || b.y < rangeTop + 4) && b.bounce > 0) {
        b.bounce--; b.vy = -b.vy * 0.86;
        b.y = clamp(b.y, rangeTop + 4, floorY);
      }
      if (b.x > W - 23 || b.y > floorY + 4 || b.y < rangeTop) { App.protoShots.splice(i, 1); continue; }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (b.trail.length >= 4) {
        ctx.strokeStyle = hexA(D.tint, 0.30);
        ctx.lineWidth = Math.max(1, (D.size | 0) - 1);
        ctx.beginPath();
        for (let k = 0; k < b.trail.length; k += 2)
          k ? ctx.lineTo(b.trail[k], b.trail[k + 1]) : ctx.moveTo(b.trail[k], b.trail[k + 1]);
        ctx.stroke();
      }
      ctx.fillStyle = D.tint;
      ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, D.size | 0, D.size | 0);
      ctx.restore();
    }

    // the readout
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = D.tint;
    ctx.fillText(D.label, 6, 15);
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = '#8d9aa2';
    const dps = (D.dmg * (D.count || 1) / D.rate).toFixed(0);
    const rows = [
      ['DPS', dps],
      ['SHOT', (D.dmg).toFixed(1) + ' × ' + (D.count | 0) + '  @' + (1 / D.rate).toFixed(1) + '/s'],
      ['MAG', (D.mag | 0) + '  ' + D.reload.toFixed(2) + 's'],
      ['SHAPE', D.base]
    ];
    rows.forEach((r, i) => {
      ctx.fillStyle = '#5d6a72'; ctx.fillText(r[0], 6, 30 + i * 11);
      ctx.fillStyle = '#c8d2d6'; ctx.fillText(r[1], 52, 30 + i * 11);
    });
    const tags = [];
    if (D.pierce) tags.push('PRC' + D.pierce);
    if (D.splash) tags.push('BLST' + D.splash);
    if (D.homing) tags.push('SEEK');
    if (D.bounce) tags.push('RIC' + D.bounce);
    if (D.drop) tags.push('ARC');
    ctx.textAlign = 'right';
    ctx.fillStyle = hexA(D.tint, 0.9);
    ctx.fillText(tags.join(' ') || '—', W - 6, 15);
  }

  const hexA = (hex, a) => {
    const c = GW.hex2rgb(hex || '#ffffff');
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  };
  const TAU = Math.PI * 2;

  /* ---------------- loading ---------------- */
  function deploy() {
    window.AUDIO.init();
    window.AUDIO.play('uiBig');
    show('loading');
    App.jobProgress = 0; App.jobMsg = 'preparing'; App.jobPhase = 'level';
    $('l-seed').textContent = App.cfg.seed.toString(16).toUpperCase().padStart(8, '0');
    $('l-style').textContent = App.cfg.style + ' · ' + App.cfg.skyMood +
      ' · ' + App.cfg.palette + ' · ' + App.cfg.levelLen + ' screens';
    $('l-tip').textContent = S.TIPS[(Math.random() * S.TIPS.length) | 0];
    App.job = {
      gen: window.WORLD.buildMission(App.cfg, App.merc,
              Object.assign({}, App.opts, { scrap: App.scrap,
                                            boss: App.boss, proto: App.proto })),
      done: 0, seen: 0, t0: performance.now()
    };
  }

  /* The bake yields once per stage; there is no total up front, so
     progress is estimated from the phase weights the mission
     generator reports plus how many steps have gone by. A level bake
     is ~150 steps, which is stable enough to make the bar honest. */
  function pumpJob() {
    const J = App.job;
    if (!J) return;
    const t0 = performance.now();
    while (performance.now() - t0 < BUDGET) {
      let r;
      try {
        r = J.gen.next();
      } catch (err) {
        console.error(err);
        App.job = null;
        $('l-msg').textContent = 'BAKE FAILED — ' + err.message;
        return;
      }
      if (r.done) {
        App.mission = r.value;
        App.job = null;
        App.jobProgress = 1;
        window.AUDIO.ambience(true, App.cfg.skyMood);
        startPlay();
        return;
      }
      J.seen++;
      App.jobMsg = r.value.msg;
      App.jobPhase = r.value.phase;
      const est = 150 + App.cfg.levelLen * 4;
      App.jobProgress = clamp(J.seen / est, 0, 0.985);
    }
    $('l-bar').style.width = (App.jobProgress * 100).toFixed(1) + '%';
    $('l-msg').textContent = App.jobMsg;
    $('l-pct').textContent = Math.round(App.jobProgress * 100) + '%';
  }

  function drawLoadBackdrop(ctx, dt) {
    drawTitle(ctx, dt * 0.4);
  }

  /* ---------------- play ---------------- */
  function startPlay() {
    show('play');
    const M = App.mission;
    M.cursorX = input.cursorX; M.cursorY = input.cursorY;
    M.say('MOVE TO EXTRACTION');
  }

  function pause(on) {
    if (on && App.state === 'play') {
      show('paused');
      $('p-stats').innerHTML =
        row('SEED', App.cfg.seed.toString(16).toUpperCase()) +
        row('HOSTILES DOWN', App.mission.kills + ' / ' + App.mission.totalEnemies) +
        row('SCORE', App.mission.player.score);
    } else if (!on && App.state === 'paused') {
      show('play');
    }
  }

  /* Enter at a run-end state: redeploy, or go to debrief. */
  function endStep() {
    const M = App.mission;
    if (M.state === 'dead') {
      if (M.lives > 0 && M.respawn()) return;
      debrief(false);
    } else if (M.state === 'won') {
      debrief(true);
    }
  }

  /* ---------------- continuous autopilot ----------------
     A full-auto run that stops at the debrief screen is a demo, not an
     attract mode. When the pilot had control at the end, roll the next
     build and deploy it — after a beat, so the score is readable. */
  const AUTO_NEXT = 5.0;

  function cancelAutoNext() {
    App.autoNext = 0;
    $('db-auto').classList.remove('on');
  }

  function autoNextRun() {
    cancelAutoNext();
    App.autoRuns++;
    if (App.mode === 'random') {
      // a whole new run: level, operative, boss and gun
      applySeed(rollSeed());
      $('seedNote').textContent = 'SEEDED';
      refreshSetup();
      syncPanels();
    } else {
      /* A custom build is somebody's work — rerolling it would throw
         that away. Reroll only the layout seed, so the terrain is new
         and every panel they set still holds. */
      App.cfg.seed = rollSeed();
      refreshSetup();
    }
    deploy();
  }

  function debrief(won) {
    const st = App.mission.stats();
    const auto = !!App.mission.autopilot;
    App.lastStats = st;
    window.AUDIO.ambience(false);
    show('debrief');
    $('db-title').textContent = won ? 'EXTRACTION CONFIRMED' : 'OPERATIVE LOST';
    $('db-title').className = won ? 'won' : 'lost';
    const mm = Math.floor(st.time / 60), ss = Math.floor(st.time % 60);
    $('db-stats').innerHTML =
      row('HOSTILES ELIMINATED', st.kills + ' / ' + st.total) +
      row('TIME', mm + ':' + String(ss).padStart(2, '0')) +
      row('COMBAT SCORE', st.score) +
      (won ? row('TIME BONUS', st.timeBonus) + row('VITALS BONUS', st.healthBonus) : '') +
      row('FINAL', st.final) +
      row('BUILD', App.cfg.seed.toString(16).toUpperCase().padStart(8, '0')) +
      (App.autoRuns ? row('AUTOPILOT RUNS', App.autoRuns + 1) : '');
    if (auto) {
      App.autoNext = AUTO_NEXT;
      $('db-auto').classList.add('on');
      $('db-auto').textContent = 'AUTOPILOT · NEXT BUILD IN ' + Math.ceil(AUTO_NEXT) +
                                 '  ·  ESC TO STOP';
    } else {
      App.autoRuns = 0;
      cancelAutoNext();
    }
  }

  /* ---------------- loop ---------------- */
  let last = performance.now(), acc = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;

    const ctx = App.ctx;

    if (App.state === 'title' || App.state === 'setup') {
      drawTitle(ctx, dt);
      if (App.state === 'setup') {
        if (App.tab === 'crawler') drawCrawlerPreview(dt);
        else if (App.tab === 'boss') drawBossPreview(dt);
        else if (App.tab === 'proto') drawProtoPreview(dt);
        else if (App.tab !== 'scrap') drawPreview(dt);
      }
      return;
    }

    if (App.state === 'loading') {
      drawLoadBackdrop(ctx, dt);
      pumpJob();
      return;
    }

    const M = App.mission;
    if (!M) return;

    if (App.state === 'play') {
      M.cursorX = input.cursorX;
      M.cursorY = input.cursorY;
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 4) {
        M.update(STEP, input);
        input.jumpPressed = false;
        input.reloadPressed = false;
        acc -= STEP;
        n++;
      }
      if (n === 0) { input.jumpPressed = false; input.reloadPressed = false; }
      if (acc > STEP * 4) acc = 0;

      /* Autopilot clears its own run-end screens. "Without player
         control" has to include the death screen and the extraction
         screen, or a full-auto run ends the first time it takes a bad
         landing and sits on PRESS ENTER forever. */
      if (M.autopilot && M.state !== 'play' && M.endT > 1.4) endStep();
    }

    if (App.state === 'debrief' && App.autoNext > 0) {
      App.autoNext -= dt;
      if (App.autoNext <= 0) { autoNextRun(); return; }
      $('db-auto').textContent = 'AUTOPILOT · NEXT BUILD IN ' + Math.ceil(App.autoNext) +
                                 '  ·  ESC TO STOP';
    }

    window.RENDER.frame(M, ctx, App.canvas);

    if (App.state === 'paused') {
      ctx.fillStyle = 'rgba(6,7,9,.55)';
      ctx.fillRect(0, 0, LV.W, LV.H);
    }
  }

  /* ---------------- sound toggle ---------------- */
  function toggleSound() {
    window.AUDIO.init();
    window.AUDIO.enabled = !window.AUDIO.enabled;
    document.querySelectorAll('.sound-btn').forEach(b => {
      b.textContent = window.AUDIO.enabled ? '♪ SOUND ON' : '♪ SOUND OFF';
      b.classList.toggle('off', !window.AUDIO.enabled);
    });
  }

  /* ---------------- wiring ---------------- */
  function boot() {
    App.canvas = $('game');
    App.ctx = App.canvas.getContext('2d');
    App.mercPreview = $('mercPreview');
    App.crawlerPreview = $('crawlerPreview');
    App.scrapPreview = $('scrapPreview');
    App.bossPreview = $('bossPreview');
    App.protoPreview = $('protoPreview');
    resize();
    bindInput();
    bootTitle();

    $('btn-start').onclick = () => { window.AUDIO.init(); window.AUDIO.play('uiBig'); openSetup(); };
    $('btn-howto').onclick = () => $('howto').classList.toggle('on');

    $('m-random').onclick = () => {
      App.mode = 'random';
      window.AUDIO.play('ui');
      refreshSetup();
    };
    $('m-custom').onclick = () => {
      App.mode = 'custom';
      window.AUDIO.play('ui');
      refreshSetup();
      schedulePreview(true);
    };

    $('btn-roll').onclick = () => {
      applySeed(rollSeed());
      window.AUDIO.play('ui');
      $('seedNote').textContent = 'SEEDED';
      refreshSetup();
      syncPanels();
      schedulePreview(true);
      scheduleCrawlerPreview(true);
      scheduleScrapPreview(true);
      scheduleBossPreview(true);
      App.protoShots.length = 0;
    };
    $('seedField').onchange = () => {
      const v = parseInt($('seedField').value.replace(/[^0-9a-fA-F]/g, ''), 16);
      applySeed(isNaN(v) ? rollSeed() : (v >>> 0));
      $('seedNote').textContent = 'SEEDED';
      refreshSetup();
      syncPanels();
      schedulePreview(true);
      scheduleCrawlerPreview(true);
      scheduleScrapPreview(true);
      scheduleBossPreview(true);
      App.protoShots.length = 0;
    };

    $('btn-rollLevel').onclick = () => {
      const keep = App.cfg.seed;
      App.cfg = C.randomLevelCfg(rollSeed());
      App.cfg.seed = keep;
      markDirty();
      window.AUDIO.play('ui');
      syncPanels();
    };
    $('btn-rollMerc').onclick = () => {
      const keep = App.merc.seed;
      App.merc = C.randomMerc(rollSeed());
      App.merc.seed = keep;
      markDirty();
      window.AUDIO.play('ui');
      buildPanels();
      schedulePreview(true);
    };
    $('btn-rollCrawler').onclick = () => {
      App.crawler = C.crawlerParams(rollSeed(), App.cfg, 0);
      markDirty();
      window.AUDIO.play('ui');
      buildPanels();
      scheduleCrawlerPreview(true);
      if (App.opts.crawler) App.opts.crawler = App.crawler;
    };
    $('btn-rollBoss').onclick = () => {
      App.boss = C.overlordParams(rollSeed(), App.cfg);
      markDirty();
      window.AUDIO.play('ui');
      buildPanels();
      scheduleBossPreview(true);
    };
    $('btn-rollProto').onclick = () => {
      App.proto = window.WEAPONS.rollProto(GW.makeRng(rollSeed()));
      markDirty();
      window.AUDIO.play('ui');
      buildPanels();
      App.protoShots.length = 0;
    };
    $('btn-renameProto').onclick = () => {
      const W2 = window.WEAPONS, R = GW.makeRng(rollSeed());
      App.proto.label = R.pick(W2.PROTO_PREFIX) + ' ' + R.pick(W2.PROTO_SUFFIX) +
                        ' ' + R.pick(W2.PROTO_MARK);
      markDirty();
      window.AUDIO.play('ui');
    };
    $('btn-rollScrap').onclick = () => {
      // rerolling still stays inside what suits the architecture
      App.scrap = C.scrapParamsFor(rollSeed(), App.cfg);
      markDirty();
      window.AUDIO.play('ui');
      buildPanels();
      scheduleScrapPreview(true);
    };
    $('pinCrawler').onchange = e => {
      App.opts.crawler = e.target.checked ? App.crawler : null;
      window.AUDIO.play('ui');
      if (e.target.checked) markDirty();
    };

    $('btn-presetMerc').onclick = () => {
      const keys = Object.keys(window.MERCFORGE.PRESETS);
      const k = keys[(Math.random() * keys.length) | 0];
      Object.assign(App.merc, window.MERCFORGE.PRESETS[k]);
      markDirty();
      window.AUDIO.play('ui');
      buildPanels();
      schedulePreview(true);
      $('seedNote').textContent = 'PRESET · ' + k.toUpperCase();
    };

    for (const k in C.DIFFICULTY) {
      const b = $('d-' + k);
      if (!b) continue;
      b.onclick = () => {
        App.opts.difficulty = k;
        App.opts.lives = C.DIFFICULTY[k].lives;
        window.AUDIO.play('ui');
        refreshSetup();
      };
    }
    $('densField').oninput = e => {
      App.opts.enemyDens = +e.target.value;
      $('densVal').textContent = (+e.target.value).toFixed(2) + '×';
    };
    $('allyField').oninput = e => {
      App.opts.allies = +e.target.value;
      $('allyVal').textContent = e.target.value;
      refreshSetup();
    };
    $('autoField').onchange = e => {
      App.opts.autopilot = e.target.checked;
      window.AUDIO.play('ui');
      refreshSetup();
    };

    $('tab-level').onclick = () => setTab('level');
    $('tab-merc').onclick = () => setTab('merc');
    $('tab-crawler').onclick = () => setTab('crawler');
    $('tab-scrap').onclick = () => setTab('scrap');
    $('tab-boss').onclick = () => setTab('boss');
    $('tab-proto').onclick = () => setTab('proto');

    $('btn-deploy').onclick = deploy;
    $('btn-back').onclick = () => { window.AUDIO.play('ui'); show('title'); };

    $('btn-resume').onclick = () => pause(false);
    $('btn-abort').onclick = () => {
      window.AUDIO.ambience(false);
      window.AUDIO.play('ui');
      show('setup');
    };

    $('btn-again').onclick = () => { window.AUDIO.play('uiBig'); deploy(); };
    $('btn-newseed').onclick = () => {
      applySeed(rollSeed());
      $('seedNote').textContent = 'SEEDED';
      refreshSetup();
      syncPanels();
      schedulePreview(true);
      deploy();
    };
    $('btn-menu').onclick = () => { window.AUDIO.play('ui'); openSetup(); };

    document.querySelectorAll('.sound-btn').forEach(b => { b.onclick = toggleSound; });

    requestAnimationFrame(loop);
  }

  function setTab(t) {
    App.tab = t;
    window.AUDIO.play('ui');
    $('tab-level').classList.toggle('on', t === 'level');
    $('tab-merc').classList.toggle('on', t === 'merc');
    $('panel-level').style.display = t === 'level' ? '' : 'none';
    $('panel-merc').style.display = t === 'merc' ? '' : 'none';
    $('panel-crawler').style.display = t === 'crawler' ? '' : 'none';
    $('tab-crawler').classList.toggle('on', t === 'crawler');
    const custom = App.mode === 'custom';
    $('previewWrap').style.display = custom && t === 'merc' ? '' : 'none';
    $('crawlerPreviewWrap').style.display = custom && t === 'crawler' ? '' : 'none';
    $('rollLevelWrap').style.display = custom && t === 'level' ? '' : 'none';
    $('rollMercWrap').style.display = custom && t === 'merc' ? '' : 'none';
    $('rollCrawlerWrap').style.display = custom && t === 'crawler' ? '' : 'none';
    $('panel-scrap').style.display = t === 'scrap' ? '' : 'none';
    $('tab-scrap').classList.toggle('on', t === 'scrap');
    $('scrapPreviewWrap').style.display = custom && t === 'scrap' ? '' : 'none';
    $('rollScrapWrap').style.display = custom && t === 'scrap' ? '' : 'none';
    $('panel-boss').style.display = t === 'boss' ? '' : 'none';
    $('tab-boss').classList.toggle('on', t === 'boss');
    $('panel-proto').style.display = t === 'proto' ? '' : 'none';
    $('tab-proto').classList.toggle('on', t === 'proto');
    $('bossPreviewWrap').style.display = custom && t === 'boss' ? '' : 'none';
    $('rollBossWrap').style.display = custom && t === 'boss' ? '' : 'none';
    $('protoPreviewWrap').style.display = custom && t === 'proto' ? '' : 'none';
    $('rollProtoWrap').style.display = custom && t === 'proto' ? '' : 'none';
    if (t === 'crawler') scheduleCrawlerPreview(true);
    if (t === 'scrap') scheduleScrapPreview(true);
    if (t === 'boss') scheduleBossPreview(true);
    if (t === 'proto') App.protoShots.length = 0;
  }

  window.addEventListener('DOMContentLoaded', boot);
  window.__APP = App;
})();
