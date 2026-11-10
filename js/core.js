/* ============ 核心：命名空间 / 数学工具 / 焰色与配色 ============ */
'use strict';

const FW = (window.FW = {
  G: 9.81,          // 重力加速度 m/s²
  RHO_AIR: 1.2,     // 空气密度 kg/m³
  SOUND: 343,       // 声速 m/s
});

(() => {
  FW.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  FW.lerp = (a, b, t) => a + (b - a) * t;
  FW.rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  /** 近似标准正态（三个均匀分布之和） */
  FW.randn = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  FW.pick = arr => arr[(Math.random() * arr.length) | 0];

  /** 单位球面均匀随机方向 */
  FW.randDir = (out = [0, 0, 0]) => {
    const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a); out[1] = z; out[2] = r * Math.sin(a);
    return out;
  };

  /** 斐波那契球面格点：n 个点近似等距铺满球面（对应药珠在弹壳内的均匀排列） */
  FW.fibDir = (i, n, out) => {
    const z = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - z * z), a = i * 2.399963229728653;
    out[0] = r * Math.cos(a); out[1] = z; out[2] = r * Math.sin(a);
    return out;
  };

  /** 随机旋转矩阵（3x3，行主序），来自随机单位四元数 */
  FW.randBasis = () => {
    const u1 = Math.random(), u2 = Math.random() * Math.PI * 2, u3 = Math.random() * Math.PI * 2;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    const x = a * Math.sin(u2), y = a * Math.cos(u2), z = b * Math.sin(u3), w = b * Math.cos(u3);
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
  };

  FW.mulberry32 = seed => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------- 4x4 矩阵（列主序，与 WebGL 一致） ---------- */
  FW.M4 = {
    create: () => new Float32Array(16),
    perspective(o, fovy, aspect, near, far) {
      const t = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = t / aspect; o[5] = t;
      o[10] = (far + near) / (near - far); o[11] = -1;
      o[14] = (2 * far * near) / (near - far);
      return o;
    },
    lookAt(o, e, c, up) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
      let l = 1 / Math.hypot(zx, zy, zz); zx *= l; zy *= l; zz *= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = 1 / (Math.hypot(xx, xy, xz) || 1); xx *= l; xy *= l; xz *= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
      o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
      o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
      o[15] = 1;
      return o;
    },
    /** o = a · b（o 不可与 a、b 同一数组） */
    mul(o, a, b) {
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        o[c * 4] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
        o[c * 4 + 1] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
        o[c * 4 + 2] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
        o[c * 4 + 3] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];
      }
      return o;
    },
    /** o = a · diag(1,-1,1,1)：关于水面 y=0 的镜像视图矩阵 */
    mirrorY(o, a) {
      o.set(a);
      o[4] = -a[4]; o[5] = -a[5]; o[6] = -a[6]; o[7] = -a[7];
      return o;
    },
    invert(o, m) {
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
        a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
  };

  /* ---------- 金属焰色（线性空间 HDR 基色，已做亮度补偿） ----------
     真实烟花的颜色来自金属盐的发射光谱：锶→红、钙→橙、钠→黄、钡→绿、铜→蓝。
     铜蓝与锶红的发光效率低，肉眼亮度弱，这里乘以补偿系数让画面均衡。 */
  const chem = (r, g, b, gain) => [r * gain, g * gain, b * gain];
  FW.CHEM = {
    red: chem(1.0, 0.045, 0.025, 1.55),      // 锶 Sr
    orange: chem(1.0, 0.27, 0.03, 1.25),     // 钙 Ca
    yellow: chem(1.0, 0.62, 0.07, 1.05),     // 钠 Na
    lemon: chem(0.72, 1.0, 0.12, 0.95),      // 钡 + 钠
    green: chem(0.08, 1.0, 0.14, 0.95),      // 钡 Ba
    aqua: chem(0.05, 0.85, 0.72, 1.05),      // 钡 + 铜
    blue: chem(0.07, 0.19, 1.0, 2.1),        // 铜 Cu
    purple: chem(0.48, 0.09, 1.0, 1.9),      // 锶 + 铜
    pink: chem(1.0, 0.18, 0.42, 1.45),       // 锶 + 镁
    white: chem(1.0, 0.92, 0.84, 0.95),      // 镁 / 铝
    gold: chem(1.0, 0.46, 0.10, 1.15),       // 木炭 / 铁
    silver: chem(0.80, 0.89, 1.0, 0.95),     // 钛 Ti
  };
  const C = FW.CHEM;
  FW.RAINBOW = [C.red, C.orange, C.yellow, C.green, C.aqua, C.blue, C.purple, C.pink];

  /* ---------- 配色方案：a 为主色，b 为芯色 / 变色后的颜色 ---------- */
  FW.PALETTES = [
    { id: 'redgold', name: '锶红金', css: 'linear-gradient(135deg,#ff4040,#ffb347)', a: [C.red], b: [C.gold] },
    { id: 'gold', name: '炭金', css: 'linear-gradient(135deg,#ffcf6e,#ff9a3c)', a: [C.gold], b: [C.white] },
    { id: 'silver', name: '钛银', css: 'linear-gradient(135deg,#ffffff,#cfe3ff)', a: [C.white], b: [C.silver], silver: true },
    { id: 'blue', name: '铜蓝', css: 'linear-gradient(135deg,#3d7bff,#7fd4ff)', a: [C.blue], b: [C.aqua] },
    { id: 'green', name: '钡绿', css: 'linear-gradient(135deg,#2fe06a,#c9ff7f)', a: [C.green], b: [C.lemon] },
    { id: 'violet', name: '锶铜紫', css: 'linear-gradient(135deg,#b45bff,#ff6bd8)', a: [C.purple], b: [C.pink] },
    { id: 'sunset', name: '钙橙钠黄', css: 'linear-gradient(135deg,#ff7a2e,#ffd84a)', a: [C.orange], b: [C.yellow] },
    { id: 'sakura', name: '粉樱', css: 'linear-gradient(135deg,#ff7fb0,#fff0f4)', a: [C.pink], b: [C.white] },
    { id: 'rainbow', name: '七彩', css: 'conic-gradient(#ff4040,#ffcf3c,#3ce07a,#3d8bff,#b45bff,#ff4040)', a: FW.RAINBOW, b: [C.white], rainbow: true },
    { id: 'random', name: '随机', css: 'radial-gradient(circle,#fff,#777)', random: true },
  ];
  FW.PALETTE_MAP = Object.fromEntries(FW.PALETTES.map(p => [p.id, p]));
  /** 把"随机"方案落实为一个具体方案 */
  FW.resolvePalette = p => {
    if (!p) p = FW.PALETTES[0];
    if (!p.random) return p;
    return FW.PALETTES[(Math.random() * (FW.PALETTES.length - 1)) | 0];
  };

  /* ---------- 弹径规格（英寸，即行业所称"寸"） ---------- */
  FW.CALIBERS = [3, 4, 5, 6, 8, 10, 12];
  /** 标准炸高（米）：约每寸 30 米，大弹略收敛 */
  FW.stdHeight = cal => 42 * Math.pow(cal, 0.83);
  /** 标准开花半径（米） */
  FW.stdRadius = cal => 12.5 * cal;
})();
