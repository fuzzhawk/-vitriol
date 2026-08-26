const fs = require('fs');
const { createCanvas } = require('@napi-rs/canvas');

const src = fs.readFileSync(__dirname + '/mercforge.html', 'utf8');
const js = src.split('<script>')[1].split('</script>')[0];

function mkCanvas() {
  const c = createCanvas(2, 2);
  try { c.style = {}; } catch (e) {}
  c.addEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 });
  c.focus = () => {};
  return c;
}
function mkEl(tag) {
  if (tag === 'canvas') return mkCanvas();
  const el = {
    tagName: tag, children: [], style: {}, className: '', textContent: '',
    value: '', checked: false, min: 0, max: 0, step: 0, type: '', onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, setAttribute() {}, focus() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  Object.defineProperty(el, 'innerHTML', { get() { return this._h || ''; }, set(v) { this._h = v; this.children = []; } });
  return el;
}
const byId = {};
const document = {
  createElement: mkEl,
  createTextNode: t => ({ text: t }),
  querySelector: () => null,
  activeElement: null,
  getElementById(id) {
    if (!byId[id]) byId[id] = (['preview', 'sheet', 'demo'].includes(id)) ? mkCanvas() : mkEl('div');
    return byId[id];
  }
};
const mod = { exports: {} };
const exportLine = ';module.exports={P,buildSheet,getSheet:()=>SHEET,states,pose,drawChar,rasterise,aimAngles,buildPalette,randomize,PRESETS,gunSpec,paintLevel,update,render,aimRow,frameOf,player,grid,LW,LH,TILE,keys,mouse,bullets,bots,parts,solidAt};';
new Function('module', 'document', 'performance', 'requestAnimationFrame', 'addEventListener', 'window', js + exportLine)
  (mod, document, { now: () => Date.now() }, () => {}, () => {}, {});
const M = mod.exports;

/* ---------- checks ---------- */
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

const S = M.getSheet();
ok(!!S, 'sheet built on boot');
ok(S.canvas.width === S.CW * S.cols.length, 'sheet width matches column count');
ok(S.canvas.height === S.CH * S.angles.length, 'sheet height matches aim rows');

// every frame must contain pixels, and stay inside its cell
const ctx = S.canvas.getContext('2d');
let empty = 0, clipped = 0, minTop = 999, maxBot = 0, minL = 999, maxR = 0;
for (let r = 0; r < S.angles.length; r++) {
  for (let c = 0; c < S.cols.length; c++) {
    const d = ctx.getImageData(c * S.CW, r * S.CH, S.CW, S.CH).data;
    let n = 0, top = 999, bot = -1, l = 999, rr = -1;
    for (let y = 0; y < S.CH; y++) for (let x = 0; x < S.CW; x++) {
      if (d[(y * S.CW + x) * 4 + 3] > 0) { n++; if (y < top) top = y; if (y > bot) bot = y; if (x < l) l = x; if (x > rr) rr = x; }
    }
    if (n === 0) empty++;
    else {
      if (top === 0 || bot === S.CH - 1 || l === 0 || rr === S.CW - 1) clipped++;
      minTop = Math.min(minTop, top); maxBot = Math.max(maxBot, bot);
      minL = Math.min(minL, l); maxR = Math.max(maxR, rr);
    }
  }
}
ok(empty === 0, 'no empty frames (' + empty + ')');
ok(clipped === 0, 'no frames touching cell edge (' + clipped + ')');
console.log('       bounds: x ' + minL + '-' + maxR + ' of ' + S.CW + ', y ' + minTop + '-' + maxBot + ' of ' + S.CH);

// muzzle points land inside the cell
let badMuz = 0;
for (let r = 0; r < S.angles.length; r++) for (let c = 0; c < S.cols.length; c++) {
  const m = S.muzzle[r][c];
  if (m.x < 0 || m.y < 0 || m.x > S.CW || m.y > S.CH || !isFinite(m.x)) badMuz++;
}
ok(badMuz === 0, 'muzzle offsets inside cell (' + badMuz + ' bad)');

// muzzle should rise as aim goes up
const midCol = S.colOf('idle', 0);
const up = S.muzzle[0][midCol], flat = S.muzzle[(S.angles.length - 1) >> 1][midCol], down = S.muzzle[S.angles.length - 1][midCol];
ok(up.y < flat.y && flat.y < down.y, 'muzzle tracks aim row (up ' + up.y + ' < flat ' + flat.y + ' < down ' + down.y + ')');

// column map round-trips
let mapOk = true;
M.states().forEach(s => { for (let f = 0; f < s.frames; f++) { const c = S.colOf(s.id, f); if (S.cols[c].state !== s.id || S.cols[c].frame !== f) mapOk = false; } });
ok(mapOk, 'state/frame -> column map is consistent');

// aim row lookup covers the hemisphere
ok(M.aimRow(-Math.PI / 2) === 0 && M.aimRow(Math.PI / 2) === S.angles.length - 1, 'aim row spans -90..+90');

// feet should sit on the anchor baseline for grounded states
const groundCols = ['idle', 'run', 'crouch', 'land'].map(s => S.colOf(s, 0));
let footErr = 0;
groundCols.forEach(c => {
  const d = ctx.getImageData(c * S.CW, ((S.angles.length - 1) >> 1) * S.CH, S.CW, S.CH).data;
  let bot = -1;
  for (let y = 0; y < S.CH; y++) for (let x = 0; x < S.CW; x++) if (d[(y * S.CW + x) * 4 + 3] > 0 && y > bot) bot = y;
  if (Math.abs(bot - S.anchor.y) > 3) footErr++;
});
ok(footErr === 0, 'grounded poses rest on the baseline (' + footErr + ' off)');

// regenerate across presets and randoms without throwing
let threw = null;
try {
  Object.values(M.PRESETS).forEach(p => { Object.assign(M.P, p); M.buildSheet(); });
  for (let i = 0; i < 12; i++) { M.P.seed = i * 7919; M.randomize(); M.buildSheet(); }
} catch (e) { threw = e; }
ok(!threw, 'presets + 12 randomizations build clean' + (threw ? ' :: ' + threw.message : ''));

/* ---------- visual dumps ---------- */
Object.assign(M.P, M.PRESETS.nick);
M.P.seed = 4771;
const sheet = M.buildSheet();
fs.writeFileSync(__dirname + '/out_sheet.png', sheet.canvas.toBuffer('image/png'));

// zoomed contact strip: run cycle at three aim rows
const Z = 4, rows = [0, (sheet.angles.length - 1) >> 1, sheet.angles.length - 1];
const runN = sheet.framesOf('run'), c0 = sheet.colOf('run', 0);
const strip = createCanvas(sheet.CW * runN * Z, sheet.CH * rows.length * Z);
const sx = strip.getContext('2d');
sx.imageSmoothingEnabled = false;
sx.fillStyle = '#14120f'; sx.fillRect(0, 0, strip.width, strip.height);
rows.forEach((r, i) => {
  for (let f = 0; f < runN; f++) {
    sx.drawImage(sheet.canvas, (c0 + f) * sheet.CW, r * sheet.CH, sheet.CW, sheet.CH,
      f * sheet.CW * Z, i * sheet.CH * Z, sheet.CW * Z, sheet.CH * Z);
  }
});
fs.writeFileSync(__dirname + '/out_run.png', strip.toBuffer('image/png'));

// zoomed pose row: one frame of every state at flat aim
const st = M.states(), mid = (sheet.angles.length - 1) >> 1;
const pw = createCanvas(sheet.CW * st.length * Z * 1, sheet.CH * Z);
const px = pw.getContext('2d'); px.imageSmoothingEnabled = false;
px.fillStyle = '#14120f'; px.fillRect(0, 0, pw.width, pw.height);
st.forEach((s, i) => {
  const c = sheet.colOf(s.id, s.id === 'run' ? 2 : 0);
  px.drawImage(sheet.canvas, c * sheet.CW, mid * sheet.CH, sheet.CW, sheet.CH,
    i * sheet.CW * Z, 0, sheet.CW * Z, sheet.CH * Z);
});
fs.writeFileSync(__dirname + '/out_states.png', pw.toBuffer('image/png'));

// aim fan: idle pose at every aim row
const fan = createCanvas(sheet.CW * sheet.angles.length * Z, sheet.CH * Z);
const fx = fan.getContext('2d'); fx.imageSmoothingEnabled = false;
fx.fillStyle = '#14120f'; fx.fillRect(0, 0, fan.width, fan.height);
sheet.angles.forEach((a, r) => {
  fx.drawImage(sheet.canvas, sheet.colOf('idle', 0) * sheet.CW, r * sheet.CH, sheet.CW, sheet.CH,
    r * sheet.CW * Z, 0, sheet.CW * Z, sheet.CH * Z);
});
fs.writeFileSync(__dirname + '/out_aim.png', fan.toBuffer('image/png'));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall checks passed');

/* debug dump of out-of-cell muzzles */
const S2 = M.getSheet();
for (let r = 0; r < S2.angles.length; r++) for (let c = 0; c < S2.cols.length; c++) {
  const m = S2.muzzle[r][c];
  if (m.x < 0 || m.y < 0 || m.x > S2.CW || m.y > S2.CH) console.log('  bad muzzle', S2.cols[c].state, 'f' + S2.cols[c].frame, 'aim' + S2.angles[r], m, 'cell', S2.CW + 'x' + S2.CH);
}

/* ---------- simulated play session ---------- */
console.log('\nsim:');
Object.assign(M.P, M.PRESETS.nick); M.buildSheet(); M.paintLevel();
let simErr = null, maxB = 0, hits = 0, jumps = 0;
try {
  for (let f = 0; f < 1800; f++) {                       // 30 seconds at 60Hz
    M.keys.KeyD = (f % 240) < 150;
    M.keys.KeyA = (f % 240) >= 190;
    M.keys.KeyW = (f % 97) === 0;
    M.keys.KeyS = (f % 311) < 25;
    if (M.keys.KeyW) jumps++;
    M.mouse.down = (f % 13) < 6;
    M.mouse.x = 240 + Math.sin(f / 21) * 200;
    M.mouse.y = 135 + Math.cos(f / 13) * 120;
    M.update(1 / 60);
    M.render();
    maxB = Math.max(maxB, M.bullets.length);
    if (!isFinite(M.player.x) || !isFinite(M.player.y)) throw new Error('player position went non-finite at frame ' + f);
    if (M.solidAt(M.player.x, M.player.y - 2)) throw new Error('player embedded in a tile at frame ' + f);
  }
  hits = M.bots.filter(b => b.hp < 3 || b.dead).length;
} catch (e) { simErr = e; }
ok(!simErr, '1800 frames of simulated play' + (simErr ? ' :: ' + simErr.message : ''));
ok(M.player.x > 20 && M.player.x < M.LW * M.TILE - 20, 'player stayed inside the level (x=' + M.player.x.toFixed(0) + ')');
ok(M.bullets.length < 200 && M.parts.length < 900, 'bullets/particles bounded (' + maxB + ' peak bullets, ' + M.parts.length + ' particles)');
ok(hits > 0, 'bullets connected with bots (' + hits + ' damaged/destroyed)');
console.log(fails ? '\n' + fails + ' FAILURES' : '\nsim clean');

/* dump a demo frame */
const demoCv = document.getElementById('demo');
demoCv.width = 960; demoCv.height = 540;
M.player.x = 300; M.player.y = 300; M.player.vx = 1.6;
M.keys.KeyD = true; M.keys.KeyA = false; M.keys.KeyW = false; M.keys.KeyS = false;
M.mouse.down = true; M.mouse.x = 330; M.mouse.y = 90;
for (let i = 0; i < 40; i++) M.update(1 / 60);
M.render();
fs.writeFileSync(__dirname + '/out_demo.png', demoCv.toBuffer('image/png'));

/* ---------- regeneration cost ---------- */
console.log('\nperf:');
Object.assign(M.P, M.PRESETS.nick);
let t = Date.now(); M.buildSheet(); console.log('  default 30px / 9 rows / 8 run frames : ' + (Date.now() - t) + 'ms');
M.P.height = 46; M.P.aimRows = 17; M.P.runFrames = 12;
t = Date.now(); const big = M.buildSheet(); console.log('  max 46px / 17 rows / 12 run frames   : ' + (Date.now() - t) + 'ms  ->  ' + big.canvas.width + 'x' + big.canvas.height + 'px, ' + (big.cols.length * big.angles.length) + ' frames');
M.P.colSuit = '#804020';
t = Date.now(); M.buildSheet(); console.log('  max, colour-only change (cached cell)  : ' + (Date.now() - t) + 'ms');

/* contact sheet of randomized mercs */
const N = 10, Z2 = 3;
const shots = [];
for (let i = 0; i < N; i++) {
  M.P.seed = 100 + i * 613;
  M.randomize();
  const s = M.buildSheet();
  shots.push({ s, col: s.colOf('run', 2), row: (s.angles.length - 1) >> 1 });
}
const w = Math.max(...shots.map(o => o.s.CW)), hh = Math.max(...shots.map(o => o.s.CH));
const cc = createCanvas(w * N * Z2, hh * Z2);
const cx2 = cc.getContext('2d'); cx2.imageSmoothingEnabled = false;
cx2.fillStyle = '#14120f'; cx2.fillRect(0, 0, cc.width, cc.height);
shots.forEach((o, i) => {
  cx2.drawImage(o.s.canvas, o.col * o.s.CW, o.row * o.s.CH, o.s.CW, o.s.CH,
    (i * w + (w - o.s.CW) / 2) * Z2, (hh - o.s.CH) * Z2, o.s.CW * Z2, o.s.CH * Z2);
});
fs.writeFileSync(__dirname + '/out_random.png', cc.toBuffer('image/png'));
