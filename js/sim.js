/* ============ 物理仿真：弹道 / 星体 / 火星 / 硝烟 / 光源 ============
   全部使用真实单位（米、秒、千克）。
   · 礼花弹与星体：二次空气阻力 a = -k|v|v + g，隐式积分，受随高度增强的风影响；
     星体燃烧时质量减小，阻力系数随之增大（越烧越"飘"）。
   · 拖尾火星：数量巨大，采用无状态粒子——出生时把初值写入环形缓冲，
     之后的轨迹由顶点着色器按线性阻力闭式解计算，CPU 零开销。 */
'use strict';

(() => {
  const G = FW.G;
  const CH_SHIFT = 11, CH = 1 << CH_SHIFT, CH_MASK = CH - 1;

  /* ---------- 火星环形缓冲（每粒 16 个 float） ---------- */
  class SparkRing {
    constructor(cap) {
      this.nChunks = Math.max(8, Math.ceil(cap / CH));
      this.cap = this.nChunks * CH;
      this.data = new Float32Array(this.cap * 16);
      this.chunkDeath = new Float32Array(this.nChunks);   // 每块中最晚的熄灭时刻，用于回收
      this.head = 0; this.tailChunk = 0; this.used = 0;
      this.pending = 0;      // 自上次上传 GPU 以来新写入的粒子数
      this.total = 0;        // 累计写入数（用于估算发射速率）
      this.pendStart = 0;
    }
    emit(px, py, pz, t0, vx, vy, vz, life, r, g, b, size, k, fall, kind, seed) {
      const i = this.head, c = i >> CH_SHIFT;
      if ((i & CH_MASK) === 0) {
        if (this.used > 0 && c === this.tailChunk) { this.tailChunk = (c + 1) % this.nChunks; this.used--; }
        this.chunkDeath[c] = 0; this.used++;
      }
      const death = t0 + life;
      if (death > this.chunkDeath[c]) this.chunkDeath[c] = death;
      const d = this.data, o = i * 16;
      d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = t0;
      d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
      d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = size;
      d[o + 12] = k; d[o + 13] = fall; d[o + 14] = kind; d[o + 15] = seed;
      this.head = i + 1 === this.cap ? 0 : i + 1;
      this.pending++; this.total++;
    }
    gc(now) {
      while (this.used > 1 && this.chunkDeath[this.tailChunk] < now) {
        this.tailChunk = (this.tailChunk + 1) % this.nChunks; this.used--;
      }
    }
    /** 仍可能存活的区间 [[起点, 数量], ...] */
    ranges() {
      if (!this.used) return [];
      const start = this.tailChunk * CH, end = this.head;
      if (start < end) return [[start, end - start]];
      return end > 0 ? [[start, this.cap - start], [0, end]] : [[start, this.cap - start]];
    }
    get live() { let n = 0; for (const r of this.ranges()) n += r[1]; return n; }
  }
  FW.SparkRing = SparkRing;

  /** 礼花弹的二次阻力系数 k = ½ρ·Cd·A/m (1/m) */
  function shellDrag(cal) {
    const d = cal * 0.0254 * 0.95;
    const m = 850 * (Math.PI / 6) * d * d * d;
    return (0.5 * FW.RHO_AIR * 0.47 * (Math.PI * d * d / 4)) / m;
  }
  /** 竖直发射达到高度 h 所需的出膛速度与到顶时间（二次阻力下的解析解） */
  function verticalShot(k, h) {
    const v0 = Math.sqrt((G / k) * (Math.exp(2 * k * h) - 1));
    const t = Math.atan(v0 * Math.sqrt(k / G)) / Math.sqrt(G * k);
    return { v0, t };
  }
  /** 打靶法：求初速度使弹道顶点落在 target */
  function solveAim(x0, y0, z0, tg, k) {
    const dy = Math.max(15, tg[1] - y0);
    const vs = verticalShot(k, dy);
    let vy = vs.v0, vx = ((tg[0] - x0) / vs.t) * 1.25, vz = ((tg[2] - z0) / vs.t) * 1.25, ta = vs.t;
    const dt = 1 / 50;
    for (let it = 0; it < 9; it++) {
      let x = x0, y = y0, z = z0, ax = vx, ay = vy, az = vz, t = 0;
      while (ay > 0 && t < 14) {
        const f = 1 / (1 + k * Math.sqrt(ax * ax + ay * ay + az * az) * dt);
        ax *= f; az *= f; ay = ay * f - G * dt;
        x += ax * dt; y += ay * dt; z += az * dt; t += dt;
      }
      ta = t;
      vx += ((tg[0] - x) / t) * 1.1; vz += ((tg[2] - z) / t) * 1.1;
      vy += ((tg[1] - y) * (G + k * vy * vy)) / vy * 0.85;
      vy = FW.clamp(vy, 20, 190);
    }
    return { vx, vy, vz, fuse: ta };
  }

  const STAR_FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'k', 'r', 'g', 'b', 'r2', 'g2', 'b2', 'seed', 'acc'];

  class Sim {
    constructor(o = {}) {
      this.time = 0;
      this.ring = new SparkRing(o.sparkCap || 400000);
      this.cap = 60000;
      for (const f of STAR_FIELDS) this[f] = new Float32Array(this.cap);
      this.spec = new Array(this.cap);
      this.n = 0;
      this.shells = []; this.emitters = []; this.smoke = []; this.lights = []; this.cues = [];
      this.cueDirty = false;
      this.wind = { x: 2.2, z: 0.9 };
      this.density = 1;        // 星体数量倍率（画质）
      this.emitBase = 1;       // 火星发射倍率（画质）
      this.emitAdapt = 1;      // 火星发射倍率（按帧率自适应）
      this.loadAdapt = 1; this.loadT = 0; this.lastTotal = 0;   // 火星发射倍率（按缓冲占用自适应）
      this.emitQ = 1; this.emitComp = 1;
      this.smokeOn = true; this.lightsOn = true;
      this.viewer = [0, 3, 620];
      this.onEvent = () => {};
      this.lastBurst = null;
      this.crack = { n: 0, x: 0, y: 0, z: 0 };
      this.lpos = new Float32Array(32); this.lcol = new Float32Array(24);
    }

    setRing(cap) { this.ring = new SparkRing(cap); this.lastTotal = 0; }
    windFactor(y) { return 0.35 + 0.65 * (y > 200 ? 1 : y < 0 ? 0 : y / 200); }

    /* ---------- 定时事件（基于仿真时间，慢动作/冻结时自动同步） ---------- */
    at(delay, fn, tag) { this.cues.push({ t: this.time + delay, fn, tag }); this.cueDirty = true; }
    atAbs(t, fn, tag) { this.cues.push({ t: Math.max(t, this.time), fn, tag }); this.cueDirty = true; }
    cancel(tag) { this.cues = this.cues.filter(c => c.tag !== tag); }
    runCues() {
      for (let guard = 0; guard < 2000; guard++) {
        if (this.cueDirty) { this.cues.sort((a, b) => b.t - a.t); this.cueDirty = false; }
        const c = this.cues[this.cues.length - 1];
        if (!c || c.t > this.time) break;
        this.cues.pop(); c.fn();
      }
    }

    /* ---------- 星体 ---------- */
    addStar(x, y, z, vx, vy, vz, life, k, c1, c2, spec, delay) {
      if (this.n >= this.cap) return -1;
      const i = this.n++;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      this.age[i] = -(delay || 0); this.life[i] = life; this.k[i] = k;
      this.r[i] = c1[0]; this.g[i] = c1[1]; this.b[i] = c1[2];
      c2 = c2 || c1;
      this.r2[i] = c2[0]; this.g2[i] = c2[1]; this.b2[i] = c2[2];
      this.seed[i] = Math.random(); this.acc[i] = Math.random();
      this.spec[i] = spec;
      return i;
    }
    kill(i) {
      const l = --this.n;
      if (i !== l) {
        for (const f of STAR_FIELDS) this[f][i] = this[f][l];
        this.spec[i] = this.spec[l];
      }
      this.spec[l] = null;
    }

    /** 按火星预算缩放拖尾发射率，并以亮度补偿 */
    fitTail(spec, n, T) {
      const tl = spec.tail;
      if (!tl) return;
      const est = n * tl.rate * Math.min(T, (tl.life0 + tl.life1) / 2);
      const budget = this.ring.cap * 0.2;       // 单发弹最多占用缓冲的两成
      if (est > budget) { spec.tailMul = budget / est; spec.tailComp = Math.pow(est / budget, 0.75); }
    }

    /** 球形开花：药珠均匀铺在球壳上，被开包药以近似相同的速度推出。
        R 为燃尽时的半径，T 为燃烧时间，beta = k·R 决定"先快后慢"的程度。 */
    burstSphere(B, o) {
      const n = Math.max(3, Math.round(o.n * (o.fixed ? 1 : this.density)));
      const R = o.R, beta = o.beta || 2.7, T = o.T, k = beta / R;
      const v0 = ((Math.exp(beta) - 1) / (k * (o.Tx || T))) * (o.boost || 1.08);   // Tx：展开时间与燃烧时间不同时使用
      const sj = o.sj === undefined ? 0.05 : o.sj, tj = o.tj === undefined ? 0.12 : o.tj;
      const M = FW.randBasis(), d = [0, 0, 0], jit = 0.5 / Math.sqrt(n);
      const spec = o.spec;
      this.fitTail(spec, n, T);
      for (let i = 0; i < n; i++) {
        if (o.random) FW.randDir(d);
        else {
          FW.fibDir(i, n, d);
          let a = d[0] + FW.randn() * jit, b = d[1] + FW.randn() * jit, c = d[2] + FW.randn() * jit;
          const l = 1 / Math.hypot(a, b, c); a *= l; b *= l; c *= l;
          d[0] = M[0] * a + M[1] * b + M[2] * c; d[1] = M[3] * a + M[4] * b + M[5] * c; d[2] = M[6] * a + M[7] * b + M[8] * c;
        }
        if (o.filter && !o.filter(d)) continue;
        const c1 = o.color(d), c2 = o.color2 ? o.color2(d) : c1;
        const sp = v0 * (1 + sj * FW.randn()) * (o.speedFn ? o.speedFn(d) : 1);
        const life = T * (1 + tj * (Math.random() * 2 - 1));
        this.addStar(B.x + d[0] * 0.4, B.y + d[1] * 0.4, B.z + d[2] * 0.4,
          B.vx + d[0] * sp, B.vy + d[1] * sp, B.vz + d[2] * sp, life, k, c1, c2, spec, o.delayFn ? o.delayFn(d) : 0);
        if (!spec.dark) { const lc = spec.change ? c2 : c1; B.lr += lc[0]; B.lg += lc[1]; B.lb += lc[2]; B.ln++; }
      }
      if (T > B.T) B.T = T;
    }

    /** 造型弹：药珠在弹内隔板上摆成平面图案。逐星反解初速，使其在 T 时刻恰好到达图案位置。 */
    burstPattern(B, pts, o) {
      const R = o.R, beta = o.beta || 2.4, T = o.T, k = beta / R, u = o.u, w = o.w, spec = o.spec;
      this.fitTail(spec, pts.length, T);
      for (let i = 0; i < pts.length; i++) {
        const px = pts[i][0], py = pts[i][1];
        const rr = Math.hypot(px, py) || 1e-3;
        const sp = ((Math.exp(k * R * rr) - 1) / (k * T)) * 1.06 * (1 + 0.012 * FW.randn());
        const dx = (u[0] * px + w[0] * py) / rr, dy = (u[1] * px + w[1] * py) / rr, dz = (u[2] * px + w[2] * py) / rr;
        const c1 = o.color(pts[i]);
        this.addStar(B.x, B.y, B.z, B.vx + dx * sp, B.vy + dy * sp, B.vz + dz * sp,
          T * (1 + 0.06 * (Math.random() * 2 - 1)), k, c1, c1, spec, 0);
        B.lr += c1[0]; B.lg += c1[1]; B.lb += c1[2]; B.ln++;
      }
      if (T > B.T) B.T = T;
    }

    /** 朝向观众的图案平面基（u 为观众视角的右方，w 为上方），带随机偏角 */
    facingBasis(B, jitter = 0.4) {
      let nx = this.viewer[0] - B.x, nz = this.viewer[2] - B.z;
      const a = Math.atan2(nx, nz) + (Math.random() * 2 - 1) * jitter;
      nx = Math.sin(a); nz = Math.cos(a);
      const tilt = (Math.random() * 2 - 1) * jitter * 0.5, ct = Math.cos(tilt), st = Math.sin(tilt);
      return { u: [nz, 0, -nx], w: [nx * st, ct, nz * st], n: [nx, 0, nz] };
    }

    /** 小型二次开花（千轮的子弹、十字破等） */
    miniBurst(x, y, z, vx, vy, vz, R, n, colorFn, T, spec) {
      const B = { x, y, z, vx, vy, vz, lr: 0, lg: 0, lb: 0, ln: 0, T: 0 };
      this.burstSphere(B, { n, R, T, beta: 2.4, color: colorFn, spec, random: true, sj: 0.08, fixed: true });
      const l = B.ln || 1;
      this.flash(x, y, z, R * 0.5, 5);
      this.addLight(x, y, z, B.lr / l, B.lg / l, B.lb / l, 0.12, T, 2, R);
      this.onEvent('pop', { x, y, z });
    }

    flash(x, y, z, size, inten) {
      this.ring.emit(x, y, z, this.time, 0, 0, 0, 0.11, inten, inten * 0.93, inten * 0.82, size, 0, 0, 1, Math.random());
    }
    addLight(x, y, z, r, g, b, I0, life, flash, R) {
      if (this.lights.length > 96) this.lights.shift();
      this.lights.push({ x, y, z, r, g, b, I0, age: 0, life, flash, R, I: 0 });
    }
    addSmoke(x, y, z, vx, vy, vz, size, grow, alpha, life) {
      if (!this.smokeOn) return;
      if (this.smoke.length >= 420) this.smoke.shift();
      this.smoke.push({ x, y, z, vx, vy, vz, size, grow, alpha, life, age: 0, seed: Math.random(), rot: Math.random() * 6.28 });
    }
    /** 一团向外喷溅的余烬火星 */
    sparkPuff(x, y, z, n, speed, o = {}) {
      n = Math.round(n * this.emitQ);
      const d = [0, 0, 0], up = o.up || 0;
      for (let i = 0; i < n; i++) {
        FW.randDir(d);
        const s = speed * (0.3 + 0.7 * Math.random());
        this.ring.emit(x, y, z, this.time, d[0] * s, d[1] * s + up * Math.random(), d[2] * s,
          (o.life || 0.5) * (0.5 + Math.random()), (o.inten || 5) * this.emitComp, o.T0 || 2.3, o.T1 || 1.1, o.size || 0.3,
          o.k || 4, o.fall || 3, 0, Math.random());
      }
    }

    /* ---------- 发射 ---------- */
    fuseFor(cal, h) { return verticalShot(shellDrag(cal), h || FW.stdHeight(cal)).t; }

    launch(o) {
      const type = FW.TYPE_MAP[o.typeId] || FW.TYPES[0];
      const cal = o.caliber || 6;
      const pal = FW.resolvePalette(o.palette);
      const x = o.x || 0, z = o.z || 0, y = 1.6;
      if (type.ground) {
        type.fire(this, { x, y, z, cal, pal, target: o.target, height: o.height || FW.stdHeight(cal), tiltX: o.tiltX || 0, tiltZ: o.tiltZ || 0 });
        return null;
      }
      const k = shellDrag(cal);
      let vx, vy, vz, fuse, v0;
      if (o.target) {
        ({ vx, vy, vz, fuse } = solveAim(x, y, z, o.target, k));
        v0 = Math.hypot(vx, vy, vz);
      } else {
        const s = verticalShot(k, o.height || FW.stdHeight(cal));
        const tx = Math.tan(o.tiltX || 0), tz = Math.tan(o.tiltZ || 0), l = 1 / Math.hypot(tx, 1, tz);
        v0 = s.v0; fuse = s.t;
        vx = tx * l * v0; vy = l * v0; vz = tz * l * v0;
      }
      fuse *= 0.965 + 0.04 * Math.random();     // 引信燃速的制造公差
      const sh = { x, y, z, vx, vy, vz, k, age: 0, fuse, type, pal, cal, v0, acc: 0, rise: FW.RISE[type.rising || 'faint'] };
      this.shells.push(sh);
      this.liftFx(x, y, z, cal);
      return sh;
    }

    liftFx(x, y, z, cal) {
      const s = cal / 6;
      const n = Math.round(26 * this.emitQ * (0.6 + s));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, c = Math.random() * 0.35, sp = 8 + Math.random() * 30;
        this.ring.emit(x, y, z, this.time, Math.cos(a) * c * sp, sp, Math.sin(a) * c * sp, 0.15 + Math.random() * 0.4,
          7 * this.emitComp, 2.4, 1.1, 0.3, 5, 4, 0, Math.random());
      }
      this.flash(x, y + 1.5, z, 3 + s * 2, 3);
      this.addLight(x, y + 3, z, 1, 0.6, 0.3, 0.05 * s, 0.35, 3, 8);
      this.addSmoke(x, y + 2, z, FW.rand(-1, 1), 2.5, FW.rand(-1, 1), 3 + s * 2, 2.2, 0.16, 7);
      this.onEvent('lift', { x, y, z, cal });
    }

    burst(sh) {
      const type = sh.type, cal = sh.cal;
      const R = FW.stdRadius(cal) * (type.rScale || 1);
      const B = { x: sh.x, y: sh.y, z: sh.z, vx: sh.vx, vy: sh.vy, vz: sh.vz, cal, R, pal: sh.pal, lr: 0, lg: 0, lb: 0, ln: 0, T: 0 };
      type.build(this, B);
      const l = B.ln || 1, s = cal / 6;
      const lr = B.ln ? B.lr / l : 1, lg = B.ln ? B.lg / l : 0.7, lb = B.ln ? B.lb / l : 0.4;
      this.flash(B.x, B.y, B.z, R * 0.30 * (type.flash || 1), 4 + cal * 0.8);
      this.addLight(B.x, B.y, B.z, lr, lg, lb, s * s * (type.lum || 1), Math.max(0.6, B.T * 0.9), 2.2, R);
      const ns = Math.round(3 + cal * 0.7);
      const d = [0, 0, 0];
      for (let i = 0; i < ns; i++) {
        FW.randDir(d);
        const rr = R * 0.16 * Math.random();
        this.addSmoke(B.x + d[0] * rr, B.y + d[1] * rr, B.z + d[2] * rr, d[0] * 5, d[1] * 5, d[2] * 5,
          R * (0.14 + 0.10 * Math.random()), R * 0.06, 0.06 + 0.05 * Math.random(), 9 + Math.random() * 8);
      }
      this.lastBurst = { type, cal, height: B.y, radius: R, v0: sh.v0, fuse: sh.age };
      this.onEvent('burst', { x: B.x, y: B.y, z: B.z, cal, type });
    }

    /* ---------- 推进一步 ---------- */
    step(dt) {
      this.time += dt;
      // 火星缓冲接近写满时自动限流，避免最老的火星被提前覆盖而突然消失
      // 做法：按当前发射速率预估缓冲在一个留存周期（约 3.6 秒）内的占用，超过七成就按比例压低发射率
      if ((this.loadT += dt) > 0.1) {
        const rate = (this.ring.total - this.lastTotal) / this.loadT;
        this.lastTotal = this.ring.total; this.loadT = 0;
        const full = rate / Math.max(this.loadAdapt, 0.05);
        const target = FW.clamp((0.7 * this.ring.cap) / (full * 3.6 + 1), 0.12, 1);
        this.loadAdapt += (target - this.loadAdapt) * (target < this.loadAdapt ? 0.7 : 0.08);
      }
      this.emitQ = this.emitBase * this.emitAdapt * this.loadAdapt;
      this.emitComp = Math.min(3.4, Math.pow(1 / this.emitQ, 0.6));
      this.runCues();
      this.stepShells(dt);
      this.stepStars(dt);
      for (let i = this.emitters.length - 1; i >= 0; i--) {
        const e = this.emitters[i];
        e.age += dt;
        if (e.age >= e.life || e.update(this, e, dt) === false) this.emitters.splice(i, 1);
      }
      this.stepSmoke(dt);
      for (let i = this.lights.length - 1; i >= 0; i--) {
        const L = this.lights[i];
        L.age += dt;
        if (L.age >= L.life) this.lights.splice(i, 1);
      }
      if (this.crack.n > 0) {
        const c = this.crack;
        this.onEvent('crackle', { x: c.x / c.n, y: c.y / c.n, z: c.z / c.n, n: c.n });
        c.n = c.x = c.y = c.z = 0;
      }
      this.ring.gc(this.time);
    }

    stepShells(dt) {
      const t = this.time, ring = this.ring, eq = this.emitQ, comp = this.emitComp;
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        s.age += dt;
        const wf = this.windFactor(s.y), wx = this.wind.x * wf, wz = this.wind.z * wf;
        let rx = s.vx - wx, rz = s.vz - wz;
        const f = 1 / (1 + s.k * Math.sqrt(rx * rx + s.vy * s.vy + rz * rz) * dt);
        rx *= f; rz *= f; s.vy = s.vy * f - G * dt;
        s.vx = rx + wx; s.vz = rz + wz;
        const ox = s.x, oy = s.y, oz = s.z;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        const rs = s.rise;
        if (rs) {
          const c = rs.rate * eq * dt + s.acc;
          let m = c | 0; s.acc = c - m;
          for (; m > 0; m--) {
            const fr = Math.random(), sv = rs.spread;
            const life = rs.life0 + Math.random() * (rs.life1 - rs.life0);
            const vx = s.vx * 0.06 + (Math.random() - 0.5) * 2 * sv, vy = s.vy * 0.06 + (Math.random() - 0.5) * 2 * sv, vz = s.vz * 0.06 + (Math.random() - 0.5) * 2 * sv;
            if (rs.color) ring.emit(ox + (s.x - ox) * fr, oy + (s.y - oy) * fr, oz + (s.z - oz) * fr, t - (1 - fr) * dt, vx, vy, vz, life,
              rs.color[0] * rs.inten * comp, rs.color[1] * rs.inten * comp, rs.color[2] * rs.inten * comp, rs.size, 4, 2.5, 1, Math.random());
            else ring.emit(ox + (s.x - ox) * fr, oy + (s.y - oy) * fr, oz + (s.z - oz) * fr, t - (1 - fr) * dt, vx, vy, vz, life,
              rs.inten * comp * (0.5 + Math.random()), rs.T0, rs.T1, rs.size, 4, 2.5, 0, Math.random());
          }
        }
        if (s.age >= s.fuse || (s.vy < 0 && s.y < 25)) {
          this.shells.splice(i, 1);
          this.burst(s);
        }
      }
    }

    stepStars(dt) {
      const t = this.time, ring = this.ring, eq = this.emitQ, ecomp = this.emitComp;
      const wx0 = this.wind.x, wz0 = this.wind.z;
      const px = this.px, py = this.py, pz = this.pz, VX = this.vx, VY = this.vy, VZ = this.vz;
      for (let i = this.n - 1; i >= 0; i--) {
        const sp = this.spec[i];
        const age = (this.age[i] += dt);
        const life = this.life[i], lit = age > 0;
        const u = lit ? age / life : 0;
        const x = px[i], y = py[i], z = pz[i];
        const wf = 0.35 + 0.65 * (y > 200 ? 1 : y < 0 ? 0 : y / 200);
        const wx = wx0 * wf, wz = wz0 * wf;
        let rx = VX[i] - wx, vy = VY[i], rz = VZ[i] - wz;
        const kk = this.k[i] * (1 + sp.shrink * u);
        const f = 1 / (1 + kk * Math.sqrt(rx * rx + vy * vy + rz * rz) * dt);
        rx *= f; rz *= f; vy = vy * f - G * sp.gscale * dt;
        let vx = rx + wx, vz = rz + wz;
        if (lit) {
          if (sp.thrust) {          // 自推进（蜂群）：推力方向随时间游走
            const ph = this.seed[i] * 100, a = sp.thrust * dt;
            vx += Math.sin(age * 5.1 + ph) * a; vy += Math.sin(age * 4.3 + ph * 1.7) * a + G * dt * 0.9; vz += Math.cos(age * 4.7 + ph * 2.3) * a;
          }
          if (sp.flutter) {         // 飘摆（落叶）
            const ph = this.seed[i] * 60, a = sp.flutter * dt;
            vx += Math.cos(age * 2.3 + ph) * a; vz += Math.sin(age * 1.9 + ph * 1.3) * a;
          }
        }
        const nx = x + vx * dt, ny = y + vy * dt, nz = z + vz * dt;
        const tl = sp.tail;
        if (tl && lit) {
          const c = tl.rate * sp.tailMul * eq * dt * (1 - tl.taper * u * u) + this.acc[i];
          let m = c | 0; this.acc[i] = c - m;
          if (m > 0) {
            const comp = sp.tailComp * ecomp * tl.inten, sv = tl.spread * 2, inh = tl.inherit;
            const dl = tl.life1 - tl.life0;
            if (tl.kind === 0) {
              for (; m > 0; m--) {
                const fr = Math.random();
                ring.emit(x + (nx - x) * fr, y + (ny - y) * fr, z + (nz - z) * fr, t - (1 - fr) * dt,
                  vx * inh + (Math.random() - 0.5) * sv, vy * inh + (Math.random() - 0.5) * sv, vz * inh + (Math.random() - 0.5) * sv,
                  tl.life0 + Math.random() * dl, comp * (0.55 + 0.9 * Math.random()), tl.T0, tl.T1, tl.size,
                  tl.k, tl.fall * (0.6 + 0.8 * Math.random()), 0, Math.random());
              }
            } else {
              const cr = tl.color ? tl.color[0] : this.r[i], cg = tl.color ? tl.color[1] : this.g[i], cb = tl.color ? tl.color[2] : this.b[i];
              for (; m > 0; m--) {
                const fr = Math.random(), q = comp * (0.55 + 0.9 * Math.random());
                ring.emit(x + (nx - x) * fr, y + (ny - y) * fr, z + (nz - z) * fr, t - (1 - fr) * dt,
                  vx * inh + (Math.random() - 0.5) * sv, vy * inh + (Math.random() - 0.5) * sv, vz * inh + (Math.random() - 0.5) * sv,
                  tl.life0 + Math.random() * dl, cr * q, cg * q, cb * q, tl.size,
                  tl.k, tl.fall * (0.6 + 0.8 * Math.random()), tl.kind, Math.random());
              }
            }
          }
        }
        px[i] = nx; py[i] = ny; pz[i] = nz; VX[i] = vx; VY[i] = vy; VZ[i] = vz;
        if (ny < 0) this.kill(i);
        else if (lit && age >= life) {
          if (sp.onEnd) sp.onEnd(this, i);
          this.kill(i);
        }
      }
    }

    stepSmoke(dt) {
      const f = 1 - Math.exp(-0.9 * dt);
      for (let i = this.smoke.length - 1; i >= 0; i--) {
        const s = this.smoke[i];
        s.age += dt;
        if (s.age >= s.life) { this.smoke.splice(i, 1); continue; }
        const wf = this.windFactor(s.y);
        s.vx += (this.wind.x * wf - s.vx) * f; s.vz += (this.wind.z * wf - s.vz) * f;
        s.vy += (0.5 - s.vy) * f;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        s.size += (s.grow * dt) / (1 + s.age * 0.25);
      }
    }

    /* ---------- 输出给渲染器 ---------- */
    /** 把星体与上升中的礼花弹写成粒子实例（种类 4），返回数量 */
    fillRender(out) {
      const t = this.time, tq = Math.floor(t * 45) * 12.9898;
      let o = 0;
      const max = out.length / 16 - 400;
      for (let i = 0, n = Math.min(this.n, max); i < n; i++) {
        const age = this.age[i];
        if (age <= 0) continue;
        const sp = this.spec[i];
        if (sp.dark) continue;
        const u = age / this.life[i], seed = this.seed[i];
        let br = sp.inten * (age < sp.fadeIn ? age / sp.fadeIn : 1);
        if (u > 1 - sp.fadeOut) br *= Math.max(0, (1 - u) / sp.fadeOut);
        let h = Math.sin(seed * 91.7 + tq) * 43758.5453; h -= Math.floor(h);
        br *= 1 - sp.flick + 2 * sp.flick * h;
        if (sp.strobe) {
          let ph = age * sp.strobe.freq + seed * 9; ph -= Math.floor(ph);
          br *= ph < sp.strobe.duty ? 1.6 : 0.02;
        }
        let r, g, b;
        const ch = sp.change;
        if (ch) {
          if (u < ch.at) { r = this.r[i]; g = this.g[i]; b = this.b[i]; br *= ch.dim; }
          else { r = this.r2[i]; g = this.g2[i]; b = this.b2[i]; if (u < ch.at + ch.gap) br *= 0.08; }   // 变色药层之间的暗燃间隙
        } else { r = this.r[i]; g = this.g[i]; b = this.b[i]; }
        out[o] = this.px[i]; out[o + 1] = this.py[i]; out[o + 2] = this.pz[i]; out[o + 3] = t;
        out[o + 4] = this.vx[i]; out[o + 5] = this.vy[i]; out[o + 6] = this.vz[i]; out[o + 7] = 1e9;
        out[o + 8] = r * br; out[o + 9] = g * br; out[o + 10] = b * br; out[o + 11] = sp.size * 1.35;
        out[o + 12] = 0; out[o + 13] = 0; out[o + 14] = 4; out[o + 15] = seed;
        o += 16;
      }
      for (const s of this.shells) {
        out[o] = s.x; out[o + 1] = s.y; out[o + 2] = s.z; out[o + 3] = t;
        out[o + 4] = s.vx; out[o + 5] = s.vy; out[o + 6] = s.vz; out[o + 7] = 1e9;
        out[o + 8] = 0.9; out[o + 9] = 0.42; out[o + 10] = 0.12; out[o + 11] = 0.3;
        out[o + 12] = 0; out[o + 13] = 0; out[o + 14] = 4; out[o + 15] = 0.5;
        o += 16;
      }
      return o / 16;
    }

    fillSmoke(out) {
      let o = 0;
      const max = out.length / 8;
      for (let i = 0, n = Math.min(this.smoke.length, max); i < n; i++) {
        const s = this.smoke[i], u = s.age / s.life;
        out[o] = s.x; out[o + 1] = s.y; out[o + 2] = s.z; out[o + 3] = s.size;
        out[o + 4] = s.alpha * Math.min(1, s.age / 0.5) * Math.pow(1 - u, 1.4);
        out[o + 5] = s.seed; out[o + 6] = s.rot + s.age * 0.05; out[o + 7] = 0;
        o += 8;
      }
      return o / 8;
    }

    /** 选出当前最亮的 8 个光源 */
    pickLights() {
      const lp = this.lpos, lc = this.lcol;
      lp.fill(0); lc.fill(0);
      if (!this.lightsOn) return;
      for (const L of this.lights) {
        const u = L.age / L.life;
        L.I = L.I0 * (L.flash * Math.exp(-L.age / 0.06) + Math.pow(1 - u, 1.3));
      }
      const top = this.lights.length > 8 ? this.lights.slice().sort((a, b) => b.I - a.I).slice(0, 8) : this.lights;
      for (let i = 0; i < top.length; i++) {
        const L = top[i];
        lp[i * 4] = L.x; lp[i * 4 + 1] = L.y; lp[i * 4 + 2] = L.z; lp[i * 4 + 3] = L.R;
        lc[i * 3] = L.r * L.I; lc[i * 3 + 1] = L.g * L.I; lc[i * 3 + 2] = L.b * L.I;
      }
    }

    clear() {
      this.n = 0; this.spec.fill(null);
      this.shells.length = 0; this.emitters.length = 0; this.smoke.length = 0; this.lights.length = 0;
      this.cues.length = 0;
      this.setRing(this.ring.cap);
    }
  }

  FW.Sim = Sim;
  FW.shellDrag = shellDrag;
  FW.verticalShot = verticalShot;
})();
