/* ============================================================
   story-ui.js — the screens a story run is played through.

   Split in two on purpose. The top half builds VIEW MODELS: plain
   objects that say what a screen contains, in the order it contains
   it, with nothing in them that knows about the DOM. The bottom half
   turns one of those into elements.

   That split is not tidiness. The harness runs headless, with a canvas
   shim and no document to speak of, so a screen built directly out of
   `createElement` cannot be checked at all — and these are the screens
   that decide whether a run reads as a story or as a menu. A view
   model can be asserted about: that the briefing names the place, that
   the choice offers options that differ, that the codex only lists
   what you have actually met.
   ============================================================ */
window.STORYUI = (function () {
  "use strict";

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ============================================================
     VIEW MODELS
     ============================================================ */

  /* Standing, in words. A number between -6 and 6 means nothing on a
     screen; "HUNTED BY" means something at a glance. */
  const STANDING = [
    { at: -5, word: 'HUNTED BY',   tone: 'bad'  },
    { at: -3, word: 'HATED BY',    tone: 'bad'  },
    { at: -1, word: 'UNWELCOME',   tone: 'warn' },
    { at:  1, word: 'UNKNOWN TO',  tone: 'flat' },
    { at:  3, word: 'TOLERATED BY', tone: 'ok'  },
    { at:  5, word: 'TRUSTED BY',  tone: 'good' },
    { at:  7, word: 'OWED BY',     tone: 'good' }
  ];
  function standingOf(rep) {
    for (const s of STANDING) if (rep < s.at) return s;
    return STANDING[STANDING.length - 1];
  }

  /* ---------- the dossier: the world you rolled ----------
     Shown on the setup screen, so a player can reroll until they like
     the shape of the war they are about to walk into. Everything on
     it is world, not run: no spoilers, because none of it is secret
     yet. */
  function dossier(W) {
    const vm = { title: 'THE STACK', sub: 'SEED ' + hex(W.seed), blocks: [] };

    vm.blocks.push({
      h: 'THE OPERATIVE',
      rows: [
        { k: 'NAME', v: W.you.name },
        { k: 'OUT OF', v: W.facById(W.you.origin).name },
        { k: 'WANTS', v: cap(W.you.want) },
        { k: 'AND', v: cap(W.you.wound) }
      ]
    });

    vm.blocks.push({
      h: 'THE JOB',
      rows: [
        { k: 'HANDLER', v: nameOf(W.handler) + ' · ' + W.facById(W.handler.faction).name },
        { k: 'THE PRIZE', v: W.artifact.name },
        { k: 'WHICH IS', v: cap(W.artifact.is) },
        { k: 'HELD BY', v: W.facById(W.artifact.heldBy).name },
        { k: 'WANTED BY', v: W.facById(W.artifact.wantedBy).name }
      ]
    });

    vm.blocks.push({
      h: 'THE FACTIONS',
      rows: W.factions.map(f => ({
        k: f.name,
        v: window.LORE.DOCTRINES[f.doctrine].label + ' · ' +
           f.holdings.length + (f.holdings.length === 1 ? ' HOLDING' : ' HOLDINGS'),
        note: window.LORE.DOCTRINES[f.doctrine].creed,
        hue: f.hue
      }))
    });

    vm.blocks.push({
      h: 'KNOWN GROUND',
      rows: W.places.map(p => ({
        k: p.name,
        v: (window.GREEBLEWORKS.STYLES[p.style] || {}).label || p.style,
        note: W.facById(p.owner).name,
        hue: W.facById(p.owner).hue
      }))
    });

    return vm;
  }

  /* ---------- the briefing: what this mission is ----------
     Read before the bake, so it is the last thing on screen while the
     level is being built, which is exactly the moment a player is
     willing to read something. */
  function briefing(story, beat) {
    const b = beat || story.current();
    if (!b || b.type !== 'mission') return null;
    const W = story.world;
    const place = W.placeById(b.place);
    const foe = W.facById(b.foe);
    const O = window.STORY.OBJECTIVES[b.objective];
    const st = standingOf(story.rep[foe.id]);
    const rep = story.repEffects ? story.repEffects(foe.id) : null;

    const vm = {
      act: 'ACT ' + roman(b.act) + ' · ' + b.actName,
      n: b.n, of: story.missions,
      title: O.label,
      verb: O.verb,
      place: place.name,
      architecture: (window.GREEBLEWORKS.STYLES[place.style] || {}).label || place.style,
      kind: place.kind,
      history: place.history,
      foe: foe.name,
      foeHue: foe.hue,
      doctrine: window.LORE.DOCTRINES[foe.doctrine].label,
      creed: window.LORE.DOCTRINES[foe.doctrine].creed,
      standing: st.word + ' ' + foe.name,
      standingTone: st.tone,
      brief: story.brief(b),
      arsenal: (foe.guns || []).map(g => (window.WEAPONS.table[g] || {}).label || g),
      rows: [],
      notes: []
    };

    if (b.target) vm.rows.push({ k: 'TARGET', v: nameOf(W.charById(b.target)) });
    if (b.seconds) vm.rows.push({ k: 'HOLD FOR', v: b.seconds + ' SECONDS' });
    if (b.charges) vm.rows.push({ k: 'CHARGES', v: String(b.charges) });
    if (b.boss) vm.rows.push({ k: 'EXPECT', v: 'SOMETHING THAT DOES NOT WALK' });

    /* What your standing is buying you, in the only terms that matter:
       what is different when the doors open. */
    if (rep) {
      if (rep.grace > 0) {
        vm.notes.push({ tone: 'good',
          t: 'THEY WILL NOT SHOOT FIRST. ABOUT ' + Math.round(rep.grace) + ' SECONDS OF IT.' });
      }
      if (rep.bounty > 0) {
        vm.notes.push({ tone: 'bad',
          t: 'THEY HAVE PUT EXTRA ON THE FLOOR FOR YOU.' });
      }
      if (rep.tribute) {
        vm.notes.push({ tone: 'good',
          t: W.facById(rep.tribute.from).name + ' HAVE LEFT SOMETHING ON YOUR APPROACH.' });
      }
    }

    const mods = story.mods ? story.mods() : null;
    vm.traits = (story.traits || []).map(k => ({
      k: window.STORY.TRAITS[k].label, v: window.STORY.TRAITS[k].line
    }));
    vm.carrying = mods;
    return vm;
  }

  /* ---------- the choice ---------- */
  function choiceView(story, beat) {
    const b = beat || story.current();
    if (!b || b.type !== 'choice') return null;
    const c = story.choiceAt(b);
    const W = story.world;
    return {
      act: 'ACT ' + roman(b.act) + ' · ' + b.actName,
      title: 'A DECISION',
      prompt: c.prompt,
      options: c.options.map(o => ({
        id: o.id, label: o.label, line: o.line,
        /* What it costs, spelled out. A choice whose consequences are
           invisible is a coin toss with extra steps. */
        cost: costOf(W, b, o),
        trait: o.trait ? window.STORY.TRAITS[o.trait].label : null,
        traitLine: o.trait ? window.STORY.TRAITS[o.trait].line : null
      }))
    };
  }

  function costOf(W, beat, op) {
    const T = window.STORY.CHOICE_TEMPLATES[beat.template];
    const src = (T.opts.find(x => x.id === op.id) || {}).rep || {};
    const out = [];
    for (const who in src) {
      const by = src[who];
      let name = null;
      if (who === 'handler') name = W.facById(W.handler.faction).name;
      else if (who === 'offer') name = beat.offer !== undefined ? W.facById(beat.offer).name : null;
      else if (who === 'holder') name = W.facById(W.artifact.heldBy).name;
      else if (who === 'wanter') name = W.facById(W.artifact.wantedBy).name;
      else if (who === 'rival') name = W.rival.name;
      if (!name) continue;
      out.push({ who: name, by: by, tone: by > 0 ? 'good' : by < 0 ? 'bad' : 'flat' });
    }
    return out;
  }

  /* ---------- the codex: what you have met ----------
     Everything the world contains, filtered to what the run has
     actually shown you. A codex that lists the twist on the first
     screen is a spoiler with a table of contents. */
  function codex(story) {
    const W = story.world;
    const visited = new Set();
    const met = new Set(['you', 'handler']);
    for (const e of story.log) {
      const b = story.beats[e.i];
      if (!b) continue;
      if (b.place !== undefined) visited.add(b.place);
      if (b.target) met.add(b.target);
      if (b.who) for (const w of b.who) met.add(w);
    }
    /* The beat you are on counts as met: you are standing in it. */
    {
      const cur = story.current();
      if (cur) {
        if (cur.place !== undefined) visited.add(cur.place);
        if (cur.who) for (const w of cur.who) met.add(w);
      }
    }

    const sections = [];
    sections.push({
      h: 'PEOPLE',
      rows: W.cast.filter(c => met.has(c.id) || c.role === 'leader' && knownFac(c))
        .map(c => ({
          k: nameOf(c),
          v: c.faction === null || c.faction === undefined ? 'UNALIGNED'
             : W.facById(c.faction).name,
          note: cap(c.want),
          hue: c.faction === null || c.faction === undefined ? null : W.facById(c.faction).hue
        }))
    });
    sections.push({
      h: 'GROUND WALKED',
      rows: W.places.filter(p => visited.has(p.id)).map(p => ({
        k: p.name, v: W.facById(p.owner).name, note: p.history,
        hue: W.facById(p.owner).hue
      }))
    });
    sections.push({
      h: 'STANDING',
      rows: W.factions.map(f => {
        const st = standingOf(story.rep[f.id]);
        return { k: f.name, v: st.word.replace(/ BY$| TO$/, ''), tone: st.tone,
                 note: window.LORE.DOCTRINES[f.doctrine].creed, hue: f.hue };
      })
    });
    if (story.traits.length) {
      sections.push({
        h: 'WHAT IT HAS MADE OF YOU',
        rows: story.traits.map(k => ({
          k: window.STORY.TRAITS[k].label, v: '', note: window.STORY.TRAITS[k].line
        }))
      });
    }
    sections.push({
      h: 'THE PRIZE',
      rows: [{ k: W.artifact.name, v: cap(W.artifact.is),
               note: 'LAST KNOWN WITH ' + W.facById(W.artifact.heldBy).name }]
    });

    function knownFac(c) {
      for (const id of visited) if (W.placeById(id).owner === c.faction) return true;
      return false;
    }
    return { title: 'CODEX', sub: nameOf(W.you), sections: sections };
  }

  /* ---------- the debrief ---------- */
  function debrief(story, M) {
    const W = story.world;
    const done = story.done;
    const end = done ? story.ending() : null;
    const rows = [
      { k: 'BEATS', v: story.beatsDone + ' / ' + story.beats.length },
      { k: 'MISSIONS', v: countMissions(story) + ' / ' + story.missions },
      { k: 'SCORE', v: String(story.score) },
      { k: 'KILLS', v: String(story.kills) },
      { k: 'DEATHS', v: String(story.deaths) },
      { k: 'TIME', v: mmss(story.time) }
    ];
    return {
      title: done ? (end ? end.title : 'DONE') : 'DEBRIEF',
      sub: nameOf(W.you),
      line: done && end ? end.line : null,
      rows: rows,
      traits: story.traits.map(k => window.STORY.TRAITS[k].label),
      standing: W.factions.map(f => ({
        k: f.name, v: standingOf(story.rep[f.id]).word.replace(/ BY$| TO$/, ''),
        tone: standingOf(story.rep[f.id]).tone, hue: f.hue
      }))
    };
  }

  function countMissions(story) {
    let n = 0;
    for (const e of story.log) if (e.kind === 'mission') n++;
    return n;
  }

  /* ---------- helpers ---------- */
  function nameOf(c) { return c ? (c.title ? c.title + ' ' + c.name : c.name) : 'SOMEBODY'; }
  function cap(s) { return String(s || '').toUpperCase(); }
  function hex(n) { return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
  function mmss(t) {
    const s = Math.max(0, Math.round(t));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V'][n] || String(n); }

  /* ============================================================
     RENDERING

     Everything below here touches the document. It is deliberately
     dumb: it walks a view model and emits elements, and makes no
     decisions of its own — every judgement about what a screen says
     was made above, where it can be tested.
     ============================================================ */
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const hueCss = h => 'hsl(' + h + ',52%,62%)';

  function rowsInto(host, rows) {
    for (const r of rows) {
      const line = el('div', 'st-row');
      const k = el('b', 'st-k', r.k);
      if (r.hue !== undefined && r.hue !== null) k.style.color = hueCss(r.hue);
      line.appendChild(k);
      if (r.v) line.appendChild(el('span', 'st-v' + (r.tone ? ' t-' + r.tone : ''), r.v));
      host.appendChild(line);
      if (r.note) host.appendChild(el('p', 'st-note', r.note));
    }
  }

  function renderBlocks(host, blocks) {
    host.textContent = '';
    for (const b of blocks) {
      const sec = el('div', 'st-block');
      sec.appendChild(el('p', 'st-h', b.h));
      rowsInto(sec, b.rows);
      host.appendChild(sec);
    }
  }

  function renderDossier(vm, host) {
    host.textContent = '';
    host.appendChild(el('h3', 'st-title', vm.title));
    host.appendChild(el('p', 'st-sub', vm.sub));
    const body = el('div', 'st-body');
    renderBlocks(body, vm.blocks);
    host.appendChild(body);
  }

  function renderBriefing(vm, host) {
    host.textContent = '';
    if (!vm) return;
    host.appendChild(el('p', 'st-act', vm.act + ' · MISSION ' + vm.n + '/' + vm.of));
    const h = el('h3', 'st-title', vm.title + ' · ' + vm.place);
    host.appendChild(h);
    const sub = el('p', 'st-sub', vm.architecture + ' — HELD BY ' + vm.foe);
    sub.style.color = hueCss(vm.foeHue);
    host.appendChild(sub);
    host.appendChild(el('p', 'st-brief', vm.brief));
    host.appendChild(el('p', 'st-note', vm.history));
    const body = el('div', 'st-body');
    const meta = el('div', 'st-block');
    rowsInto(meta, [{ k: 'STANDING', v: vm.standing, tone: vm.standingTone }].concat(vm.rows));
    body.appendChild(meta);
    if (vm.notes.length) {
      const n = el('div', 'st-block');
      for (const note of vm.notes) n.appendChild(el('p', 'st-flag t-' + note.tone, note.t));
      body.appendChild(n);
    }
    if (vm.traits.length) {
      const t = el('div', 'st-block');
      t.appendChild(el('p', 'st-h', 'CARRIED'));
      rowsInto(t, vm.traits.map(x => ({ k: x.k, note: x.v })));
      body.appendChild(t);
    }
    host.appendChild(body);
  }

  /* `onPick` is called with the option id. The buttons are the whole
     screen: a choice you have to hunt for is a choice you make by
     accident. */
  function renderChoice(vm, host, onPick) {
    host.textContent = '';
    if (!vm) return;
    host.appendChild(el('p', 'st-act', vm.act));
    host.appendChild(el('h3', 'st-title', vm.title));
    host.appendChild(el('p', 'st-brief', vm.prompt));
    const list = el('div', 'st-choices');
    for (const o of vm.options) {
      const b = el('button', 'st-choice');
      b.appendChild(el('b', '', o.label));
      b.appendChild(el('span', 'st-choice-line', o.line));
      if (o.trait) b.appendChild(el('span', 'st-choice-trait', 'BECOMES: ' + o.trait));
      if (o.cost.length) {
        const c = el('span', 'st-choice-cost');
        c.textContent = o.cost.map(x =>
          x.who + ' ' + (x.by > 0 ? '+' : '') + x.by).join('   ');
        b.appendChild(c);
      }
      b.onclick = () => onPick(o.id);
      list.appendChild(b);
    }
    host.appendChild(list);
  }

  function renderCodex(vm, host) {
    host.textContent = '';
    host.appendChild(el('h3', 'st-title', vm.title));
    host.appendChild(el('p', 'st-sub', vm.sub));
    const body = el('div', 'st-body');
    renderBlocks(body, vm.sections);
    host.appendChild(body);
  }

  function renderDebrief(vm, host) {
    host.textContent = '';
    host.appendChild(el('h3', 'st-title', vm.title));
    host.appendChild(el('p', 'st-sub', vm.sub));
    if (vm.line) host.appendChild(el('p', 'st-brief', vm.line));
    const body = el('div', 'st-body');
    const a = el('div', 'st-block');
    rowsInto(a, vm.rows);
    body.appendChild(a);
    if (vm.traits.length) {
      const t = el('div', 'st-block');
      t.appendChild(el('p', 'st-h', 'WHAT IT MADE OF YOU'));
      t.appendChild(el('p', 'st-note', vm.traits.join(' · ')));
      body.appendChild(t);
    }
    const s = el('div', 'st-block');
    s.appendChild(el('p', 'st-h', 'STANDING'));
    rowsInto(s, vm.standing);
    body.appendChild(s);
    host.appendChild(body);
  }

  return {
    STANDING, standingOf,
    dossier, briefing, choiceView, codex, debrief,
    renderDossier, renderBriefing, renderChoice, renderCodex, renderDebrief,
    /* exported for anyone else drawing a story screen */
    nameOf, roman, mmss, hueCss
  };
})();
