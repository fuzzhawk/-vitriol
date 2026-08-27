/* ============================================================
   screens.js — launch, setup, loading and debrief.

   The setup screen is the whole point of the request: either roll a
   seed and go, or open both generators up and build the run by hand.
   The operative panel is generated straight from MERC FORGE's own
   CONTROLS table, so the tool and the game can't drift apart.
   ============================================================ */
window.SCREENS = (function () {
  "use strict";

  const GW = window.GREEBLEWORKS;
  const MF = window.MERCFORGE;
  const C = window.CONFIG;

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const $ = id => document.getElementById(id);

  /* ---------------- level control schema ----------------
     Curated from the tool's rail: everything that changes what a
     level plays like, grouped the way the tool groups it. Ranges are
     in config units (1.0 = the tool's neutral slider). */
  const LEVEL_PANEL = [
    { g: 'WORLD', c: [
      { k: 'style',    l: 'architecture', t: 'select', opt: () => Object.keys(GW.STYLES) },
      { k: 'palette',  l: 'palette',      t: 'select', opt: () => ['none'].concat(Object.keys(GW.PALETTES)) },
      { k: 'platKind', l: 'deck build',   t: 'select', opt: () => ['auto', 'concrete', 'grating', 'catwalk', 'deck', 'pipes', 'roof'] },
      { k: 'levelLen', l: 'level length', t: 'int', min: 3, max: 12, step: 1, fmt: v => v + ' screens' },
      { k: 'dither',   l: 'dither',       t: 'r', min: 0, max: 1.5, step: 0.01 }
    ]},
    { g: 'SURFACE', c: [
      { k: 'greeble', l: 'greebles',   t: 'r', min: 0, max: 1.2, step: 0.01 },
      { k: 'pipes',   l: 'pipework',   t: 'r', min: 0, max: 1.2, step: 0.01 },
      { k: 'windows', l: 'windows',    t: 'r', min: 0, max: 1.2, step: 0.01 },
      { k: 'neon',    l: 'neon',       t: 'r', min: 0, max: 1.2, step: 0.01 },
      { k: 'grime',   l: 'grime',      t: 'r', min: 0, max: 1.2, step: 0.01 },
      { k: 'wear',    l: 'wear',       t: 'r', min: 0, max: 1.2, step: 0.01 },
      { k: 'relief',  l: 'relief',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'lightdir',l: 'light angle',t: 'int', min: 0, max: 359, step: 1, fmt: v => v + '°' }
    ]},
    { g: 'SKY', c: [
      { k: 'skyMood',      l: 'mood',        t: 'select', opt: () => Object.keys(GW.SKYMOODS) },
      { k: 'weather',      l: 'weather',     t: 'select', opt: () => ['auto', 'rain', 'ash', 'none'] },
      { k: 'weatherAmt',   l: 'weather amt', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloud',        l: 'cloud',       t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'glow',         l: 'glow',        t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'horizon',      l: 'horizon',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloudScale',   l: 'cloud scale', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloudStretch', l: 'stretch',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloudSharp',   l: 'sharpness',   t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloudDetail',  l: 'detail',      t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloudTurb',    l: 'turbulence',  t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cloudHeight',  l: 'deck height', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'fog',          l: 'distance fog',t: 'r', min: 0, max: 2, step: 0.01 }
    ]},
    { g: 'SKYLINE', c: [
      { k: '__cityPreset', l: 'preset',      t: 'preset' },
      { k: 'cityLayers',   l: 'depth layers',t: 'int', min: 2, max: 5, step: 1 },
      { k: 'cityDens',     l: 'density',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityMass',     l: 'mass',        t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityVar',      l: 'variation',   t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityWidth',    l: 'block width', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityOverlap',  l: 'overlap',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityHaze',     l: 'haze',        t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityContrast', l: 'contrast',    t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityDetail',   l: 'detail',      t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityWin',      l: 'lit windows', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'citySkyway',   l: 'skyways',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityRuin',     l: 'ruin',        t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityLights',   l: 'beacons',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'cityBlimps',   l: 'airships',    t: 'r', min: 0, max: 2, step: 0.01 }
    ]},
    { g: 'DECALS', c: [
      { k: 'decalKind', l: 'kind',      t: 'select', opt: () => ['auto'].concat(GW.DECAL_KINDS) },
      { k: 'decDens',   l: 'density',   t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'decOpen',   l: 'openings',  t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'decMach',   l: 'machinery', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'decOrg',    l: 'organic',   t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'decTexture',l: 'texture',   t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'decGrime',  l: 'grime',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'decBlend',  l: 'blend',     t: 'r', min: 0, max: 2, step: 0.01 }
    ]},
    { g: 'TERRAIN & CLUTTER', c: [
      { k: 'floatDens',  l: 'floating decks', t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'propDens',   l: 'props',          t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'propGrime',  l: 'prop grime',     t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'wireDens',   l: 'cabling',        t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'wireStrands',l: 'strands',        t: 'r', min: 0, max: 2, step: 0.01 },
      { k: 'wireSag',    l: 'sag',            t: 'r', min: 0, max: 3, step: 0.01 },
      { k: 'wireDrops',  l: 'drop lines',     t: 'r', min: 0, max: 3, step: 0.01 }
    ]}
  ];

  /* ---------------- generic control builder ---------------- */
  function control(spec, obj, onChange) {
    const row = el('div', 'ctl');

    if (spec.t === 'preset') {
      row.className = 'ctl ctl-wide';
      row.appendChild(el('label', null, spec.l));
      const sel = el('select');
      sel.appendChild(new Option('— choose —', ''));
      for (const k of Object.keys(GW.CITY_PRESETS)) {
        sel.appendChild(new Option(GW.CITY_PRESETS[k].label || k, k));
      }
      sel.onchange = () => {
        if (!sel.value) return;
        C.applyCityPreset(obj, sel.value);
        onChange(true);
      };
      row.appendChild(sel);
      return row;
    }

    row.appendChild(el('label', null, spec.l));

    if (spec.t === 'select' || spec.t === 's') {
      const sel = el('select');
      const opts = typeof spec.opt === 'function' ? spec.opt() : spec.opt;
      for (const o of opts) sel.appendChild(new Option(o, o));
      sel.value = String(obj[spec.k]);
      sel.onchange = () => {
        obj[spec.k] = spec.num ? +sel.value : sel.value;
        onChange();
      };
      row.appendChild(sel);
      row.dataset.key = spec.k;
      row._set = v => { sel.value = String(v); };
      return row;
    }

    if (spec.t === 'c') {
      const wrap = el('div', 'chk');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = !!obj[spec.k];
      box.onchange = () => { obj[spec.k] = box.checked; onChange(); };
      wrap.appendChild(box);
      row.appendChild(wrap);
      row._set = v => { box.checked = !!v; };
      return row;
    }

    if (spec.t === 'color') {
      const inp = el('input');
      inp.type = 'color';
      inp.value = obj[spec.k];
      inp.oninput = () => { obj[spec.k] = inp.value; onChange(); };
      row.appendChild(inp);
      row._set = v => { inp.value = v; };
      return row;
    }

    /* numeric slider */
    const isInt = spec.t === 'int';
    const inp = el('input');
    inp.type = 'range';
    inp.min = spec.min; inp.max = spec.max; inp.step = spec.step;
    inp.value = obj[spec.k];
    const out = el('span', 'val');
    const show = v => out.textContent = spec.fmt ? spec.fmt(v) : (isInt ? v : (+v).toFixed(2));
    show(obj[spec.k]);
    inp.oninput = () => {
      obj[spec.k] = isInt ? parseInt(inp.value, 10) : +inp.value;
      show(obj[spec.k]);
      onChange();
    };
    row.appendChild(inp);
    row.appendChild(out);
    row._set = v => { inp.value = v; show(v); };
    return row;
  }

  function group(title, specs, obj, onChange, collapsed) {
    const g = el('div', 'grp' + (collapsed ? ' closed' : ''));
    const h = el('div', 'grp-h');
    h.appendChild(el('b', null, title));
    h.appendChild(el('i', null, '−'));
    h.onclick = () => {
      g.classList.toggle('closed');
      h.querySelector('i').textContent = g.classList.contains('closed') ? '+' : '−';
    };
    if (collapsed) h.querySelector('i').textContent = '+';
    g.appendChild(h);
    const body = el('div', 'grp-b');
    const rows = [];
    for (const s of specs) {
      const r = control(s, obj, onChange);
      rows.push(r);
      body.appendChild(r);
    }
    g.appendChild(body);
    g._rows = rows;
    g._specs = specs;
    return g;
  }

  /* Rebuild every visible control from the backing object — used
     after a randomize or a city preset changes values underneath. */
  function syncGroups(groups, obj) {
    for (const g of groups) {
      g._specs.forEach((s, i) => {
        const r = g._rows[i];
        if (r && r._set && s.k in obj) r._set(obj[s.k]);
      });
    }
  }

  /* ---------------- operative panel ----------------
     Built from MERC FORGE's own CONTROLS table. */
  function mercPanel(params, onChange) {
    const frag = document.createDocumentFragment();
    const groups = [];
    let first = true;
    for (const grp of MF.CONTROLS) {
      const specs = [];
      for (const c of grp.c) {
        if (c.k === '__colors') {
          specs.push(
            { k: 'colSuit',    l: 'suit',    t: 'color' },
            { k: 'colSuit2',   l: 'suit dark', t: 'color' },
            { k: 'colAccent',  l: 'accent',  t: 'color' },
            { k: 'colSkin',    l: 'skin',    t: 'color' },
            { k: 'colVisor',   l: 'visor',   t: 'color' },
            { k: 'colGun',     l: 'weapon',  t: 'color' },
            { k: 'colOutline', l: 'outline', t: 'color' }
          );
        } else if (c.k === '__buttons') {
          /* the tool's export buttons have no meaning in-game */
        } else if (c.k === 'previewFps') {
          specs.push(c);
        } else {
          specs.push(c);
        }
      }
      if (!specs.length) continue;
      const g = group(grp.g, specs, params, onChange, !first);
      groups.push(g);
      frag.appendChild(g);
      first = false;
    }
    return { frag, groups };
  }

  function levelPanel(cfg, onChange) {
    const frag = document.createDocumentFragment();
    const groups = [];
    LEVEL_PANEL.forEach((grp, i) => {
      const g = group(grp.g, grp.c, cfg, onChange, i > 0);
      groups.push(g);
      frag.appendChild(g);
    });
    return { frag, groups };
  }

  /* ---------------- loading tips ---------------- */
  const TIPS = [
    'Every wall, deck, sign and cloud in this level was generated from the seed. No art was shipped.',
    'Down + Jump drops through a catwalk.',
    'Your operative\'s weapon is the one MERC FORGE drew in their hands.',
    'The breach cannon splashes. Mind the walls you are standing next to.',
    'The arc lance pierces two bodies before it stops.',
    'Reload with R. Your own sidearm never runs out of spare magazines.',
    'Hostiles lose track of you if you break line of sight and back off.',
    'Drones ignore catwalks entirely. Take the high ground away from them.',
    'A heavy is always posted at the extraction pad.',
    'Falling is fatal. There is no bottom to the frame.',
    'Checkpoints are set on solid ground, not on floating decks.'
  ];

  return {
    LEVEL_PANEL, control, group, syncGroups, mercPanel, levelPanel, TIPS, el, $
  };
})();
