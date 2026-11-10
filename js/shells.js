/* ============ 弹种库：每一种烟花的装药结构与开花方式 ============ */
'use strict';

(() => {
  const C = FW.CHEM, G = FW.G;

  /* ---------- 拖尾配方 ----------
     kind 0 = 木炭/铁屑余烬（按黑体辐射从 T0 冷却到 T1，单位千开尔文）
     kind 1 = 固定焰色火星（钛银等）   kind 2 = 延时闪光（glitter） */
  const TAIL = {
    charcoal: { rate: 95, life0: 0.45, life1: 1.15, kind: 0, T0: 2.25, T1: 1.1, inten: 10, size: 0.32, inherit: 0.10, spread: 1.0, k: 4, fall: 2.2, taper: 0.5 },
    lite: { rate: 55, life0: 0.25, life1: 0.7, kind: 0, T0: 2.2, T1: 1.1, inten: 8, size: 0.3, inherit: 0.10, spread: 0.8, k: 4, fall: 2, taper: 0.4 },
    willow: { rate: 72, life0: 1.6, life1: 3.6, kind: 0, T0: 2.25, T1: 1.05, inten: 10, size: 0.32, inherit: 0.06, spread: 0.5, k: 3.5, fall: 1.5, taper: 0.15 },
    kamuro: { rate: 85, life0: 1.5, life1: 3.3, kind: 0, T0: 2.45, T1: 1.15, inten: 11, size: 0.32, inherit: 0.06, spread: 0.6, k: 3.5, fall: 1.7, taper: 0.1 },
    silver: { rate: 90, life0: 0.4, life1: 1.1, kind: 1, color: C.silver, inten: 3.2, size: 0.32, inherit: 0.10, spread: 1.0, k: 4, fall: 2.2, taper: 0.5 },
    silverLong: { rate: 72, life0: 1.5, life1: 3.3, kind: 1, color: C.silver, inten: 2.8, size: 0.32, inherit: 0.06, spread: 0.5, k: 3.5, fall: 1.5, taper: 0.15 },
    palm: { rate: 320, life0: 0.5, life1: 1.5, kind: 0, T0: 2.35, T1: 1.1, inten: 10, size: 0.36, inherit: 0.12, spread: 2.0, k: 3.5, fall: 3, taper: 0.3 },
    comet: { rate: 420, life0: 0.4, life1: 1.3, kind: 0, T0: 2.4, T1: 1.1, inten: 10, size: 0.36, inherit: 0.10, spread: 2.2, k: 3.5, fall: 3, taper: 0 },
    short: { rate: 75, life0: 0.12, life1: 0.38, kind: 0, T0: 2.2, T1: 1.2, inten: 8, size: 0.3, inherit: 0.10, spread: 0.6, k: 5, fall: 2, taper: 0 },
    self: { rate: 70, life0: 0.15, life1: 0.45, kind: 1, color: null, inten: 0.9, size: 0.3, inherit: 0.08, spread: 0.7, k: 5, fall: 2, taper: 0 },
  };
  /* 升空段的尾迹 */
  FW.RISE = {
    none: null,
    faint: { rate: 40, life0: 0.15, life1: 0.45, T0: 1.9, T1: 1.0, inten: 4.5, size: 0.26, spread: 0.6 },
    gold: { rate: 150, life0: 0.35, life1: 1.0, T0: 2.25, T1: 1.1, inten: 9, size: 0.3, spread: 1.4 },
    thick: { rate: 300, life0: 0.5, life1: 1.4, T0: 2.35, T1: 1.1, inten: 10, size: 0.34, spread: 2.0 },
    silver: { rate: 150, life0: 0.3, life1: 0.9, color: C.silver, inten: 2.8, size: 0.3, spread: 1.3 },
  };

  /** 星体规格（默认值） */
  const mk = o => Object.assign({
    size: 0.75,        // 视觉半径 m（含眩光）
    inten: 5.2,        // HDR 亮度
    shrink: 0.6,       // 燃烧失重导致的阻力增长
    gscale: 1,
    tail: null, tailMul: 1, tailComp: 1,
    strobe: null,      // { freq, duty }
    change: null,      // { at, gap, dim }：燃到 at 比例时换色
    thrust: 0, flutter: 0,
    fadeIn: 0.04, fadeOut: 0.2, flick: 0.22,
    onEnd: null, dark: false,
  }, o);

  const cs = cal => Math.pow(cal / 6, 1.4);          // 药珠数量随弹径的缩放
  const colFn = (pal, key) => {
    if (pal.rainbow && key === 'a') return () => FW.pick(FW.RAINBOW);
    const c = FW.pick(pal[key]);
    return () => c;
  };
  const metal = pal => (pal.silver ? C.silver : C.gold);
  const longTail = pal => (pal.silver ? TAIL.silverLong : TAIL.willow);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /* ---------- 星体燃尽时的二段效果 ---------- */
  function endGlitter(S, i) {
    const n = S.emitQ > 0.7 ? 3 : 2;
    for (let j = 0; j < n; j++)
      S.ring.emit(S.px[i], S.py[i], S.pz[i], S.time, S.vx[i] * 0.3 + FW.rand(-1.5, 1.5), S.vy[i] * 0.3 + FW.rand(-1.5, 1.5), S.vz[i] * 0.3 + FW.rand(-1.5, 1.5),
        0.5 + Math.random() * 0.9, 15, 14, 12.5, 0.4, 3, 2.2, 2, Math.random());
  }
  function endCrackle(S, i) {
    for (let j = 0; j < 3; j++)
      S.ring.emit(S.px[i] + FW.rand(-1.2, 1.2), S.py[i] + FW.rand(-1.2, 1.2), S.pz[i] + FW.rand(-1.2, 1.2), S.time + Math.random() * 0.1,
        FW.rand(-5, 5), FW.rand(-5, 5), FW.rand(-5, 5), 0.05 + Math.random() * 0.09, 16, 13, 8, 0.75, 3, 0, 1, Math.random());
    const c = S.crack; c.n++; c.x += S.px[i]; c.y += S.py[i]; c.z += S.pz[i];
  }
  const SPLIT_CHILD = mk({ size: 0.8, inten: 3.6, tail: TAIL.short, fadeOut: 0.35 });
  function endSplit(S, i) {
    const x = S.px[i], y = S.py[i], z = S.pz[i], vx = S.vx[i], vy = S.vy[i], vz = S.vz[i];
    const c = [S.r[i], S.g[i], S.b[i]];
    // 以飞行方向为轴取两条垂线，四颗子星呈十字散开
    let l = Math.hypot(vx, vy, vz) || 1;
    const ax = vx / l, ay = vy / l, az = vz / l;
    let ex = ay * 0 - az * 1, ey = az * 0 - ax * 0, ez = ax * 1 - ay * 0;       // a × (0,1,0)
    l = Math.hypot(ex, ey, ez);
    if (l < 1e-3) { ex = 1; ey = 0; ez = 0; l = 1; }
    ex /= l; ey /= l; ez /= l;
    const fx = ay * ez - az * ey, fy = az * ex - ax * ez, fz = ax * ey - ay * ex;
    const rot = Math.random() * Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
    for (let j = 0; j < 4; j++) {
      const s1 = (j & 1 ? -1 : 1) * (j < 2 ? cr : -sr), s2 = (j & 1 ? -1 : 1) * (j < 2 ? sr : cr);
      const sp = 27 + Math.random() * 5;
      S.addStar(x, y, z, vx * 0.3 + (ex * s1 + fx * s2) * sp, vy * 0.3 + (ey * s1 + fy * s2) * sp, vz * 0.3 + (ez * s1 + fz * s2) * sp,
        0.75 + Math.random() * 0.3, 0.07, c, c, SPLIT_CHILD, 0);
    }
    S.flash(x, y, z, 3.5, 4);
    S.onEvent('pop', { x, y, z });
  }
  const SUB_STAR = mk({ size: 0.65, inten: 3.2, fadeOut: 0.3 });
  function endSub(S, i) {
    const c = [S.r[i], S.g[i], S.b[i]], sp = S.spec[i];
    S.miniBurst(S.px[i], S.py[i], S.pz[i], S.vx[i], S.vy[i], S.vz[i], sp.subR, sp.subN, () => c, 1.0 + Math.random() * 0.4, SUB_STAR);
  }

  /* ---------- 造型弹的图案点阵（单位圆内） ---------- */
  const ring = (n, r = 1, ph = 0) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * 6.2832 + ph) * r, Math.sin((i / n) * 6.2832 + ph) * r]);
  const heartPts = n => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 6.2832;
    return [(16 * Math.pow(Math.sin(t), 3)) / 17, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 + 0.12];
  });
  const smilePts = () => {
    const p = ring(40);
    for (const ex of [-0.36, 0.36]) for (const q of ring(5, 0.07)) p.push([ex + q[0], 0.30 + q[1]]);
    for (let i = 0; i <= 12; i++) { const a = (205 + (i / 12) * 130) * Math.PI / 180; p.push([Math.cos(a) * 0.58, Math.sin(a) * 0.58 + 0.05]); }
    return p;
  };
  const starPts = () => {
    const v = [], p = [];
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i & 1 ? 0.40 : 1; v.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let i = 0; i < 10; i++) { const a = v[i], b = v[(i + 1) % 10]; for (let j = 0; j < 6; j++) p.push([a[0] + ((b[0] - a[0]) * j) / 6, a[1] + ((b[1] - a[1]) * j) / 6]); }
    return p;
  };

  /* ---------- 地面效果的通用发射方向 ---------- */
  function aimDir(o, tUp) {
    if (o.target) return [(o.target[0] - o.x) / tUp, (o.target[2] - o.z) / tUp];
    return null;
  }

  /* ==================== 弹种目录 ==================== */
  FW.TYPES = [
    {
      id: 'peony', icon: '❀', name: '牡丹', rising: 'faint',
      desc: '最经典的球形礼花，星点无拖尾，绽放成饱满的彩色圆球，常在中途整体变色。',
      principle: '牡丹弹：药珠沿球壳内壁单层均匀排列，开包药居中爆开，每颗星获得几乎相同的初速，因而形成完美球面。药剂快燃、不留尾迹；"变色牡丹"的药珠由两层不同配方包裹，外层烧完露出内层，全球同时换色。',
      build(S, B) {
        const change = !B.pal.rainbow && Math.random() < 0.45;
        S.burstSphere(B, {
          n: 300 * cs(B.cal), R: B.R, T: 1.7 + B.cal * 0.16, beta: 2.7, color: colFn(B.pal, 'a'), color2: change ? colFn(B.pal, 'b') : null,
          spec: mk({ change: change ? { at: 0.5, gap: 0.05, dim: 1 } : null }),
        });
      },
    },
    {
      id: 'chrys', icon: '✺', name: '菊花', rising: 'gold',
      desc: '与牡丹同为球形，但每颗星都拖着炭火尾迹，如菊花花瓣向外舒展，末端点亮彩色花尖。',
      principle: '菊花弹：药珠外层包裹慢燃的木炭配方，飞行中持续洒落灼热炭屑——这些炭屑按黑体辐射发光，从亮黄冷却到暗红，于是形成渐暗的金色花瓣。"菊先"则在炭层内再裹一层金属盐，烧到末端花尖才显出红绿蓝色。',
      build(S, B) {
        const tip = Math.random() < 0.6, a = colFn(B.pal, 'a'), m = metal(B.pal);
        S.burstSphere(B, {
          n: 230 * cs(B.cal), R: B.R, T: 2.3 + B.cal * 0.17, beta: 2.9, color: tip ? () => m : a, color2: tip ? a : null,
          spec: mk({ tail: B.pal.silver ? TAIL.silver : TAIL.charcoal, change: tip ? { at: 0.6, gap: 0.03, dim: 0.4 } : null }),
        });
      },
    },
    {
      id: 'willow', icon: '☄', name: '垂柳', rising: 'gold',
      desc: '金色星点耗尽初速后缓缓下坠，长长的尾迹如柳枝低垂，余韵悠长。',
      principle: '垂柳弹：高比例木炭的慢燃药珠，燃烧时间长达 6–8 秒。爆开约一秒后空气阻力就耗尽了它的初速，此后以每秒十来米的终端速度下坠，沿途洒落的炭火被风吹成柳枝般的弧线。',
      build(S, B) {
        S.burstSphere(B, {
          n: 135 * cs(B.cal), R: B.R * 0.9, T: 4.6 + B.cal * 0.33, tj: 0.18, beta: 3.5, color: () => metal(B.pal),
          spec: mk({ inten: 1.3, size: 0.6, tail: longTail(B.pal), fadeOut: 0.35, shrink: 1.0 }),
        });
      },
    },
    {
      id: 'kamuro', icon: '❋', name: '锦冠', rising: 'silver', rScale: 1.1,
      desc: '日式"冠菊"，数百条金丝铺满半个夜空再徐徐垂落，末梢碎银闪烁，是压轴常用弹种。',
      principle: '锦冠弹：药珠数量是普通弹的数倍且极耐燃，配方中掺入铝/钛屑。爆开后火星密如金雾并长时间悬垂；药珠燃尽瞬间残留的金属颗粒延时爆燃，在冠的下缘留下一圈闪烁的碎银。',
      build(S, B) {
        S.burstSphere(B, {
          n: 300 * cs(B.cal), R: B.R, T: 4.0 + B.cal * 0.28, tj: 0.15, beta: 3.2, color: () => metal(B.pal),
          spec: mk({ inten: 1.5, size: 0.6, tail: B.pal.silver ? TAIL.silverLong : TAIL.kamuro, fadeOut: 0.3, shrink: 0.9, onEnd: endGlitter }),
        });
      },
    },
    {
      id: 'ring', icon: '◎', name: '环形', rising: 'faint',
      desc: '星点排成平面圆环——土星环、原子轨道或同心环。环绕视角观看，它会从正圆变成椭圆再变成一条线。',
      principle: '环形弹：药珠不铺满球面，只沿弹体"赤道"排成一圈，爆开后保持共面飞行。弹体升空时会翻滚，所以环的朝向每次都随机。加一个小球芯就是"土星"，三个互相垂直的环就是"原子"。',
      build(S, B) {
        const M = FW.randBasis(), u = [M[0], M[3], M[6]], w = [M[1], M[4], M[7]], q = [M[2], M[5], M[8]];
        const a = colFn(B.pal, 'a'), b = colFn(B.pal, 'b'), T = 1.8 + B.cal * 0.14;
        const n = Math.round(64 * Math.sqrt(cs(B.cal)));
        const sp = () => mk({ size: 0.85, inten: 3.8 });
        const v = Math.random();
        S.burstPattern(B, ring(n), { R: B.R, T, spec: sp(), color: a, u, w });
        if (v < 0.4) S.burstSphere(B, { n: 110 * cs(B.cal), R: B.R * 0.42, T: T * 0.9, color: b, spec: mk() });
        else if (v < 0.72) {
          S.burstPattern(B, ring(n), { R: B.R, T, spec: sp(), color: b, u: w, w: q });
          S.burstPattern(B, ring(n), { R: B.R, T, spec: sp(), color: a, u: q, w: u });
        } else S.burstPattern(B, ring(Math.round(n * 0.6)), { R: B.R * 0.58, T, spec: sp(), color: b, u, w });
      },
    },
    {
      id: 'double', icon: '❂', name: '芯入', rising: 'gold',
      desc: '花中有蕊：外层大球之内同时绽放一到两层不同颜色的小球，层次分明。',
      principle: '芯入弹（八重芯）：弹壳内像套娃一样分层装填，每层药珠外各有一层开包药。越靠内的药珠离爆心越近、被壳层约束越强，获得的速度越小，于是爆开后形成同心的多色球。8 寸以上的大弹可以做到三重。',
      build(S, B) {
        const a = colFn(B.pal, 'a'), b = colFn(B.pal, 'b'), T = 1.9 + B.cal * 0.16, tails = Math.random() < 0.5;
        S.burstSphere(B, { n: 250 * cs(B.cal), R: B.R, T, beta: 2.8, color: a, spec: mk({ tail: tails ? TAIL.lite : null }) });
        S.burstSphere(B, { n: 110 * cs(B.cal), R: B.R * 0.47, T: T * 0.92, color: b, spec: mk({ inten: 3.8 }) });
        if (B.cal >= 8) S.burstSphere(B, { n: 46 * cs(B.cal), R: B.R * 0.21, T: T * 0.85, color: () => C.white, spec: mk({ inten: 3.6 }) });
      },
    },
    {
      id: 'half', icon: '◑', name: '双色', rising: 'faint',
      desc: '一个球被整齐地分成两个半球，各燃一色。转动视角可以看到分界面。',
      principle: '双色弹：装填时把弹壳的两个半球分别填入不同配方的药珠再合拢。由于药珠的飞行方向就是它在壳内的位置方向，爆开后两种颜色泾渭分明。',
      build(S, B) {
        const ax = FW.randDir(), a = FW.pick(B.pal.a), b = FW.pick(B.pal.b);
        S.burstSphere(B, { n: 300 * cs(B.cal), R: B.R, T: 1.8 + B.cal * 0.16, color: d => (dot(d, ax) > 0 ? a : b), spec: mk() });
      },
    },
    {
      id: 'ghost', icon: '◐', name: '幻彩', rising: 'none',
      desc: '一道彩色光带从球的一端扫到另一端——星点并非同时点燃，而是依次亮起又熄灭。',
      principle: '幻彩弹（Ghost Shell）：所有药珠外面都裹着厚度不同的暗燃延时层，按照在弹内的位置由薄到厚排列。爆开后药珠先在黑暗中飞行，延时层烧穿的时刻各不相同，于是观众看到光带扫过整个球面。',
      build(S, B) {
        const ax = FW.randDir(), a = FW.pick(B.pal.a), b = FW.pick(B.pal.b);
        S.burstSphere(B, {
          n: 340 * cs(B.cal), R: B.R, T: 0.95, Tx: 2.7, tj: 0.06, beta: 2.6,
          color: d => (dot(d, ax) > 0 ? b : a), delayFn: d => 0.12 + (dot(d, ax) + 1) * 0.8,
          spec: mk({ fadeIn: 0.1, fadeOut: 0.45, shrink: 0, inten: 3.8 }),
        });
      },
    },
    {
      id: 'heart', icon: '♥', name: '心形', rising: 'faint',
      desc: '星点排列成爱心。它是一个平面图案：正对时是心，绕到侧面就成了一条线。',
      principle: '造型弹：把药珠在弹内的纸隔板上摆成图案，开包药把它们沿各自的方向推出——离中心越远的药珠初速越大，图案因此等比例放大。受空气阻力影响，刚爆开时轮廓偏圆，燃到后段才完全显形。',
      build(S, B) {
        const f = S.facingBasis(B);
        S.burstPattern(B, heartPts(Math.round(66 * Math.sqrt(cs(B.cal)))), { R: B.R * 0.95, T: 2.0 + B.cal * 0.12, spec: mk({ size: 0.9, inten: 4 }), color: colFn(B.pal, 'a'), u: f.u, w: f.w });
      },
    },
    {
      id: 'smile', icon: '☺', name: '笑脸', rising: 'faint',
      desc: '圆脸、双眼和上扬的嘴角。弹体翻滚决定它是正着笑还是歪着笑。',
      principle: '笑脸弹：与心形同属造型弹，隔板上除了一圈轮廓，还用少量药珠摆出眼睛和嘴。因为所有药珠都在同一个平面内，只有平面大致朝向观众时才能认出图案。',
      build(S, B) {
        const f = S.facingBasis(B, 0.5), a = colFn(B.pal, 'a'), b = colFn(B.pal, 'b');
        S.burstPattern(B, smilePts(), { R: B.R * 0.9, T: 2.0 + B.cal * 0.12, spec: mk({ size: 0.9, inten: 4 }), color: p => (Math.hypot(p[0], p[1]) > 0.9 ? a() : b()), u: f.u, w: f.w });
      },
    },
    {
      id: 'star', icon: '★', name: '五角星', rising: 'faint',
      desc: '十条边勾出的五角星轮廓，节庆庆典的标志性造型。',
      principle: '五角星弹：造型弹的一种。药珠沿五角星的十条边等距摆放，尖角处的药珠离中心最远、需要最大的初速，因此尖角最后才"长"出来。',
      build(S, B) {
        const f = S.facingBasis(B, 0.35);
        S.burstPattern(B, starPts(), { R: B.R * 0.95, T: 2.0 + B.cal * 0.12, spec: mk({ size: 0.9, inten: 4 }), color: colFn(B.pal, 'a'), u: f.u, w: f.w });
      },
    },
    {
      id: 'palm', icon: '🌴', name: '棕榈', rising: 'thick',
      desc: '粗壮的金色树干直冲而上，顶端炸开十余条粗大的叶片，再缓缓弯垂。',
      principle: '棕榈弹：只装十余颗特大号的彗星药珠，每颗都拖着浓密的炭火光轨如棕榈叶。弹体底部还附带一截喷焰药柱，升空时一路喷洒火星，这就是"树干"。',
      build(S, B) {
        S.burstSphere(B, {
          n: 22 + Math.random() * 6, fixed: true, R: B.R * 1.05, T: 2.6 + B.cal * 0.12, beta: 2.2, sj: 0.08, filter: d => d[1] > -0.3,
          color: () => metal(B.pal), spec: mk({ size: 1.25, inten: 5, tail: TAIL.palm, fadeOut: 0.3 }),
        });
        S.sparkPuff(B.x, B.y, B.z, 160, B.R * 0.5, { life: 0.6, inten: 8 });
      },
    },
    {
      id: 'crossette', icon: '✚', name: '十字破', rising: 'faint', crackle: true,
      desc: '大星飞行途中再次炸裂成四向小星，在空中织出一张十字交错的网。',
      principle: '十字破弹：每颗大药珠的中心钻有孔洞并填入少量爆药，四周刻有十字凹槽。药珠烧到孔洞时自爆，沿凹槽整齐地裂成四块，垂直于飞行方向呈十字散开。',
      build(S, B) {
        S.burstSphere(B, {
          n: Math.round(26 * Math.sqrt(cs(B.cal))), fixed: true, R: B.R * 0.72, T: 1.15, tj: 0.05, beta: 1.6,
          color: colFn(B.pal, 'a'), spec: mk({ size: 1.0, inten: 4.5, tail: TAIL.short, fadeOut: 0, onEnd: endSplit }),
        });
      },
    },
    {
      id: 'senrin', icon: '❉', name: '千轮', rising: 'gold', lum: 0.3, crackle: true,
      desc: '主弹炸开时几乎看不见，片刻之后数十朵小花在夜空各处同时绽放，五彩缤纷。',
      principle: '千轮弹：弹内装的不是药珠，而是几十个带独立延时引信的小礼花弹。主弹的开包药只负责把它们抛散并点燃引信，约一秒后小弹各自开花，所以先是一声闷响，随后才是满天小菊。',
      build(S, B) {
        const cols = B.pal.rainbow ? FW.RAINBOW : B.pal.a.concat(B.pal.b);
        S.burstSphere(B, {
          n: Math.round(32 * Math.sqrt(cs(B.cal))), fixed: true, R: B.R * 0.62, T: 1.25, tj: 0.3, beta: 2.2, random: true, sj: 0.25,
          color: () => FW.pick(cols), spec: mk({ dark: true, shrink: 0, onEnd: endSub, subR: 9 + B.cal * 0.9, subN: Math.round(34 * S.density) }),
        });
        B.T = 2.2;
      },
    },
    {
      id: 'crackle', icon: '⁂', name: '爆裂', rising: 'gold', crackle: true,
      desc: '金色星点飞散后依次炸成刺眼的白色火花，伴着一片密集的噼啪声。',
      principle: '爆裂弹（龙蛋）：药珠芯部是铋/镁铝合金与氧化剂压成的微型爆裂药粒。外层炭火烧尽后药粒被引燃，瞬间爆成一朵白色小火花并发出脆响；数百颗药粒先后爆裂，便是满天噼啪的"金波"。',
      build(S, B) {
        S.burstSphere(B, {
          n: 300 * cs(B.cal), R: B.R * 0.9, T: 1.5 + B.cal * 0.1, tj: 0.3, beta: 2.8, color: () => C.gold,
          spec: mk({ inten: 1.5, size: 0.6, tail: TAIL.lite, fadeOut: 0.1, onEnd: endCrackle }),
        });
      },
    },
    {
      id: 'strobe', icon: '✦', name: '频闪', rising: 'faint',
      desc: '星点以固定频率明灭闪烁，悬在空中如满天银铃齐鸣。',
      principle: '频闪弹：药剂的燃烧是自振荡的——镁铝合金与硝酸盐先缓慢阴燃积累热量（暗相），达到临界温度后猛烈爆燃（亮相），随后又回到阴燃，每秒循环数次。每颗星的相位不同，所以整体看起来此起彼伏。',
      build(S, B) {
        const a = colFn(B.pal, 'a');
        S.burstSphere(B, {
          n: 250 * cs(B.cal), R: B.R * 0.95, T: 3.6 + B.cal * 0.12, beta: 3.0, color: () => (Math.random() < 0.5 ? C.white : a()),
          spec: mk({ strobe: { freq: 6, duty: 0.2 }, inten: 4.2, size: 0.8, flick: 0, fadeOut: 0.1 }),
        });
      },
    },
    {
      id: 'bees', icon: '✧', name: '蜂群', rising: 'faint',
      desc: '无数小光点像蜂群出巢般嗡嗡乱窜，各自画出不可预测的螺旋。',
      principle: '蜂群弹：每颗"星"其实是一支压在小纸管里的微型火箭，喷口偏心。点燃后推力带着它边自转边前进，加上空气阻力的牵制，就在空中画出扭动的螺旋线。',
      build(S, B) {
        S.burstSphere(B, {
          n: 70 * cs(B.cal), R: B.R * 0.35, T: 2.6, tj: 0.3, beta: 2.0, random: true, sj: 0.4, color: colFn(B.pal, 'a'),
          spec: mk({ thrust: 75, size: 0.6, inten: 3.2, tail: TAIL.self, flick: 0.4 }),
        });
      },
    },
    {
      id: 'leaves', icon: '❧', name: '落叶', rising: 'none',
      desc: '明亮的彩色光点左右飘摆着缓缓飘落，像秋天的落叶，持续七八秒。',
      principle: '落叶弹：药珠是薄片状的慢燃药剂，贴在小纸片上。纸片的空气阻力极大，初速转眼耗尽，之后像真正的落叶一样打着旋儿飘落，下落速度只有每秒三四米。',
      build(S, B) {
        const a = colFn(B.pal, 'a'), b = colFn(B.pal, 'b');
        S.burstSphere(B, {
          n: 80 * Math.pow(cs(B.cal), 0.8), R: B.R * 0.5, T: 6.5, Tx: 1.4, tj: 0.2, beta: 4.0, random: true, sj: 0.3,
          color: () => (Math.random() < 0.7 ? a() : b()), spec: mk({ gscale: 0.22, flutter: 5, inten: 3.4, size: 0.9, flick: 0.45, fadeOut: 0.25, shrink: 0.2 }),
        });
      },
    },
    {
      id: 'horsetail', icon: '♒', name: '瀑布', rising: 'silver',
      desc: '不向四周炸开，而是在高空轻轻散开后集体下泻，拖出一挂金色的瀑布。',
      principle: '瀑布弹（马尾）：开包药极少，只够把弹壳撑裂。慢燃的彗星药珠几乎没有获得初速，便在重力下结伴下坠，各自拖着数十米长的炭火尾迹，汇成一挂垂帘。',
      build(S, B) {
        S.burstSphere(B, {
          n: 70 * cs(B.cal), R: B.R * 0.3, T: 5.2 + B.cal * 0.25, Tx: 1.2, tj: 0.15, beta: 1.5, sj: 0.3, random: true,
          color: () => metal(B.pal), spec: mk({ inten: 1.6, size: 0.7, tail: longTail(B.pal), fadeOut: 0.3, shrink: 0.3 }),
        });
      },
    },
    {
      id: 'salute', icon: '✹', name: '雷鸣', rising: 'none', lum: 2.6, flash: 2.4, boom: 1.8,
      desc: '没有花，只有一道刺眼的白光和震耳的巨响，外加一圈转瞬即逝的钛火花。',
      principle: '雷弹：弹内装满闪光药（高氯酸钾 + 铝粉），燃速极快，近乎爆轰，化学能大部分变成了光和冲击波。掺入的粗钛屑被抛出后燃烧，形成一圈银白色的火花。',
      build(S, B) {
        const n = Math.round(170 * S.emitQ * (B.cal / 6)), d = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          FW.randDir(d);
          const s = 45 + Math.random() * 75;
          S.ring.emit(B.x, B.y, B.z, S.time, d[0] * s, d[1] * s, d[2] * s, 0.25 + Math.random() * 0.5, 7 * S.emitComp, 7.8 * S.emitComp, 8.6 * S.emitComp, 0.32, 4, 3, 1, Math.random());
        }
        B.lr = 1; B.lg = 0.95; B.lb = 0.9; B.ln = 1; B.T = 0.6;
      },
    },

    /* ---------- 地面效果：直接从炮筒喷射，没有升空弹体 ---------- */
    {
      id: 'comet', icon: '➶', name: '彗星', ground: true,
      desc: '一颗拖着粗壮金尾的大星从炮筒直射夜空，燃尽即止。扇形齐射时最为壮观。',
      principle: '彗星：就是一颗特大号的实心药珠，直接由发射药从炮筒推出，没有壳体也不会爆炸。它一边上升一边燃烧洒落火星，升到顶点附近恰好烧完。',
      fire(S, o) {
        const h = o.target ? FW.clamp(o.target[1], 40, 300) : o.height * 0.7;
        const k = 0.011, vs = FW.verticalShot(k, h);
        const hv = aimDir(o, vs.t), tx = Math.tan(o.tiltX), tz = Math.tan(o.tiltZ), l = 1 / Math.hypot(tx, 1, tz);
        const vx = hv ? hv[0] * 1.3 : tx * l * vs.v0, vz = hv ? hv[1] * 1.3 : tz * l * vs.v0, vy = hv ? vs.v0 : l * vs.v0;
        const c = FW.pick(o.pal.a);
        S.addStar(o.x, o.y, o.z, vx, vy, vz, vs.t * 0.9, k, c, c, mk({ size: 1.3, inten: 5.5, tail: o.pal.silver ? Object.assign({}, TAIL.silver, { rate: 380 }) : TAIL.comet, fadeOut: 0.25, shrink: 0 }), 0);
        S.liftFx(o.x, o.y, o.z, o.cal);
      },
    },
    {
      id: 'mine', icon: '♛', name: '地雷花', ground: true,
      desc: '一大簇彩星从炮口呈锥形喷薄而出，像一束瞬间长成的花。',
      principle: '地雷花（Mine）：把一整包药珠直接放在发射药上方，一次点火全部喷出。没有延时引信，所以花开在炮口正上方；越靠上的药珠被推得越快，于是形成上宽下窄的花束。',
      fire(S, o) {
        const h = o.target ? FW.clamp(o.target[1], 40, 200) : o.height * 0.5;
        const n = Math.round(80 * cs(o.cal) * S.density), beta = 2.6, k = beta / h, T = 1.9;
        const a = colFn(o.pal, 'a'), spec = mk({ size: 0.8, inten: 3.8, tail: TAIL.short, fadeOut: 0.3 });
        const tx = Math.tan(o.tiltX), tz = Math.tan(o.tiltZ), tl = 1 / Math.hypot(tx, 1, tz);
        for (let i = 0; i < n; i++) {
          const dist = h * (0.3 + 0.7 * Math.random()), sp = (Math.exp(k * dist) - 1) / (k * T);
          const ang = Math.random() * 6.283, cone = Math.sqrt(Math.random()) * 0.26;
          let dx = tx * tl + Math.cos(ang) * cone, dy = tl, dz = tz * tl + Math.sin(ang) * cone;
          const l = 1 / Math.hypot(dx, dy, dz);
          const c = a();
          S.addStar(o.x, o.y, o.z, dx * l * sp, dy * l * sp, dz * l * sp, T * (0.8 + 0.4 * Math.random()), k, c, c, spec, 0);
        }
        const c = a();
        S.liftFx(o.x, o.y, o.z, o.cal);
        S.flash(o.x, o.y + 3, o.z, 9, 5);
        S.addLight(o.x, o.y + h * 0.4, o.z, c[0], c[1], c[2], 0.35 * (o.cal / 6), T, 1.5, h * 0.4);
      },
    },
    {
      id: 'fountain', icon: '⛲', name: '喷泉', ground: true,
      desc: '固定在地面的喷花筒，持续七秒向上喷出近二十米高的火花泉。',
      principle: '喷泉（Gerb）：厚纸管内压实了掺有铁屑/钛屑的慢燃药，顶端留一个收缩的喷口。燃气把灼热的金属屑高速喷出，金属屑在空气中继续氧化发光，受阻力和重力作用划出喷泉状的抛物线。',
      fire(S, o) {
        const silver = o.pal.silver, c = C.silver, h = 0.7 + o.cal / 12;
        S.emitters.push({
          age: 0, life: 7, acc: 0,
          update(S, e, dt) {
            const env = Math.min(1, e.age / 0.4) * Math.min(1, (e.life - e.age) / 0.8);
            const cnt = 1000 * S.emitQ * env * dt + e.acc;
            let m = cnt | 0; e.acc = cnt - m;
            for (; m > 0; m--) {
              const ang = Math.random() * 6.283, cone = Math.sqrt(Math.random()) * 0.2, sp = (34 + Math.random() * 16) * h;
              const vx = Math.cos(ang) * cone * sp, vz = Math.sin(ang) * cone * sp, life = 1.2 + Math.random();
              if (silver) S.ring.emit(o.x, o.y, o.z, S.time - Math.random() * dt, vx, sp, vz, life, c[0] * 3 * S.emitComp, c[1] * 3 * S.emitComp, c[2] * 3 * S.emitComp, 0.3, 1.6, 9, 1, Math.random());
              else S.ring.emit(o.x, o.y, o.z, S.time - Math.random() * dt, vx, sp, vz, life, 10 * S.emitComp * (0.5 + Math.random()), 2.5, 1.1, 0.3, 1.6, 9, 0, Math.random());
            }
          },
        });
        S.addLight(o.x, o.y + 8, o.z, 1, silver ? 0.95 : 0.62, silver ? 0.9 : 0.3, 0.07, 7, 0, 12);
        S.onEvent('fountain', { x: o.x, y: o.y, z: o.z });
      },
    },
  ];

  FW.TYPE_MAP = Object.fromEntries(FW.TYPES.map(t => [t.id, t]));
  void G;
})();
