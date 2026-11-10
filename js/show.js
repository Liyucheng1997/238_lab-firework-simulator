/* ============ 自动表演编导 ============
   以"开花时刻"为时间轴编排：每发礼花弹按弹径与炸高反推引信时间，提前相应秒数点火，
   这样不同口径的弹才能在同一拍上同时绽放。全部基于仿真时间，慢动作/冻结时自动同步。 */
'use strict';

(() => {
  const rand = FW.rand, pick = FW.pick;
  const COLORS = ['redgold', 'gold', 'silver', 'blue', 'green', 'violet', 'sunset', 'sakura'];
  const pal = id => FW.PALETTE_MAP[id];
  const anyPal = () => pal(pick(COLORS));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  class Show {
    constructor(sim) { this.sim = sim; this.active = false; this.cursor = 0; this.cycle = []; this.idx = 0; }

    start() {
      if (this.active) return;
      this.active = true;
      this.cursor = this.sim.time + 0.5;
      this.cycle = this.makeCycle(); this.idx = 0;
      this.tick();
    }
    stop() { this.active = false; this.sim.cancel('show'); }

    /** 保证时间轴始终提前排好 11 秒（大于最长的引信时间） */
    tick() {
      if (!this.active) return;
      while (this.cursor < this.sim.time + 11) {
        if (this.idx >= this.cycle.length) { this.cycle = this.makeCycle(); this.idx = 0; this.cursor += 6; }
        this.cursor += this[this.cycle[this.idx++]](this.cursor);
      }
      this.sim.at(1, () => this.tick(), 'show');
    }
    makeCycle() {
      const mid = shuffle(['singles', 'volley', 'chase', 'fan', 'willow', 'pattern', 'crackle', 'senrin', 'singles', 'volley']).slice(0, 6);
      return ['opening', ...mid, 'finale'];
    }

    /** 让一发礼花弹在 tb 时刻开花 */
    shell(tb, o) {
      const cal = o.cal || 6, h = FW.stdHeight(cal) * (o.h || 1);
      const fuse = this.sim.fuseFor(cal, h);
      this.sim.atAbs(tb - fuse, () => this.sim.launch({
        x: o.x || 0, z: o.z === undefined ? rand(-4, 4) : o.z, typeId: o.type, palette: o.pal || anyPal(), caliber: cal, height: h, tiltX: o.tilt || 0, tiltZ: o.tiltZ || 0,
      }), 'show');
    }
    /** 地面效果在 t 时刻点火 */
    ground(t, o) {
      const cal = o.cal || 4;
      this.sim.atAbs(t, () => this.sim.launch({
        x: o.x || 0, z: o.z || 0, typeId: o.type, palette: o.pal || anyPal(), caliber: cal, height: FW.stdHeight(cal) * (o.h || 1), tiltX: o.tilt || 0, tiltZ: o.tiltZ || 0,
      }), 'show');
    }

    /* ---------- 段落（返回时长，秒） ---------- */
    opening(t) {
      const a = anyPal(), b = anyPal();
      for (let i = 0; i < 9; i++) {
        this.ground(t + i * 0.13, { type: 'comet', x: -100 + 25 * i, pal: a, tilt: (i - 4) * 0.09, h: 1.25 });
        this.ground(t + 1.9 + i * 0.13, { type: 'comet', x: 100 - 25 * i, pal: b, tilt: -(i - 4) * 0.09, h: 1.25 });
      }
      for (const x of [-84, -42, 0, 42, 84]) this.ground(t + 3.7, { type: 'mine', x, cal: 5, pal: a });
      this.shell(t + 6.3, { type: 'chrys', cal: 8, x: -85, pal: a });
      this.shell(t + 6.3, { type: 'chrys', cal: 8, x: 85, pal: a });
      this.shell(t + 6.5, { type: 'double', cal: 10, x: 0, pal: b });
      return 9.5;
    }
    singles(t) {
      const types = ['peony', 'chrys', 'double', 'half', 'ghost', 'ring', 'kamuro', 'willow', 'palm', 'strobe', 'crossette', 'leaves', 'bees'];
      const n = 5 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) this.shell(t + i * 1.7, { type: pick(types), cal: pick([6, 8, 8, 10]), x: rand(-95, 95) });
      return n * 1.7 + 0.8;
    }
    volley(t) {
      for (let r = 0; r < 3; r++) {
        const type = pick(['peony', 'chrys', 'double', 'half', 'strobe', 'crackle']), p = anyPal();
        for (let i = 0; i < 5; i++) this.shell(t + r * 2.3, { type, cal: i === 2 ? 8 : 6, x: (i - 2) * 46, pal: p, h: 1 - Math.abs(i - 2) * 0.07 });
      }
      return 7.4;
    }
    chase(t) {
      const a = anyPal(), b = anyPal();
      for (let i = 0; i < 12; i++) {
        this.shell(t + i * 0.17, { type: 'peony', cal: 3, x: -100 + i * 18.2, pal: a });
        this.shell(t + 2.7 + i * 0.17, { type: 'chrys', cal: 4, x: 100 - i * 18.2, pal: b });
      }
      return 5.8;
    }
    fan(t) {
      for (let r = 0; r < 2; r++) {
        const type = pick(['peony', 'strobe', 'ring', 'half']), p = anyPal();
        for (let i = 0; i < 7; i++) {
          this.shell(t + r * 2.8, { type, cal: 5, x: (i - 3) * 6, pal: p, tilt: (i - 3) * 0.17 });
          this.ground(t + r * 2.8 - 1.2, { type: 'comet', x: (i - 3) * 6, pal: p, tilt: (i - 3) * 0.2, h: 1.1 });
        }
      }
      return 6;
    }
    willow(t) {
      const p = Math.random() < 0.25 ? pal('silver') : pal('gold');
      for (const x of [-90, -45, 0, 45, 90]) this.ground(t - 0.5, { type: 'fountain', x, pal: p, cal: 6 });
      const types = shuffle(['willow', 'kamuro', 'horsetail', 'willow']);
      for (let i = 0; i < 4; i++) this.shell(t + i * 2.4, { type: types[i], cal: pick([8, 10]), x: rand(-80, 80), pal: p });
      return 10.5;
    }
    pattern(t) {
      const types = shuffle(['heart', 'smile', 'star', 'ring', 'heart', 'star']);
      for (let i = 0; i < 6; i++) this.shell(t + i * 1.25, { type: types[i], cal: pick([6, 8]), x: -90 + i * 36 });
      return 8.3;
    }
    crackle(t) {
      const types = shuffle(['crackle', 'strobe', 'bees', 'crossette']);
      for (let i = 0; i < 4; i++) {
        const p = anyPal();
        this.shell(t + i * 1.6, { type: types[i], cal: 6, x: -60 - rand(0, 30), pal: p });
        this.shell(t + i * 1.6 + 0.15, { type: types[i], cal: 6, x: 60 + rand(0, 30), pal: p });
      }
      return 7.2;
    }
    senrin(t) {
      for (let i = 0; i < 3; i++) this.shell(t + i * 2.2, { type: 'senrin', cal: pick([8, 10]), x: (i - 1) * 70, pal: pal('rainbow') });
      this.shell(t + 4.6, { type: 'leaves', cal: 8, x: rand(-40, 40) });
      return 7.8;
    }
    finale(t) {
      const types = ['peony', 'chrys', 'crackle', 'strobe', 'peony', 'double', 'chrys', 'half'];
      for (let i = 0; i < 36; i++)
        this.shell(t + i * 0.24 + rand(0, 0.1), { type: Math.random() < 0.1 ? 'salute' : pick(types), cal: pick([3, 4, 4, 5, 5, 6]), x: rand(-112, 112) });
      for (let i = 0; i < 20; i++) {
        const s = i & 1 ? 1 : -1;
        this.ground(t + i * 0.42, { type: 'comet', x: s * rand(60, 110), tilt: -s * rand(0.1, 0.4), h: 1.2 });
      }
      for (const x of [-84, -42, 0, 42, 84]) { this.ground(t + 4, { type: 'mine', x, cal: 5 }); this.ground(t + 7, { type: 'mine', x, cal: 6 }); }
      const g = pal('gold');
      for (const x of [-92, -46, 0, 46, 92]) this.shell(t + 9.6, { type: 'kamuro', cal: 10, x, pal: g });
      for (let i = 0; i < 5; i++) this.shell(t + 9.5 + i * 0.2, { type: 'salute', cal: 5, x: rand(-100, 100), h: 0.8 });
      this.shell(t + 11.8, { type: 'kamuro', cal: 12, x: 0, pal: g });
      this.shell(t + 12.0, { type: 'kamuro', cal: 10, x: -75, pal: pal('silver') });
      this.shell(t + 12.0, { type: 'kamuro', cal: 10, x: 75, pal: pal('silver') });
      return 20;
    }
  }

  FW.Show = Show;
})();
