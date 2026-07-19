/* ============ 烟花核心引擎：粒子物理 + 类型定义 ============ */

const GRAVITY = 0.055;      // 重力加速度 px/frame²
const AIR_DRAG = 0.985;     // 空气阻力系数

/* ---------- 色彩方案（对应真实金属焰色） ---------- */
const PALETTES = [
  { id: 'redgold',  name: '锶红金',  css: 'linear-gradient(135deg,#ff4040,#ffb347)', hues: [[0, 100, 60], [35, 100, 62]] },
  { id: 'gold',     name: '炭金',    css: 'linear-gradient(135deg,#ffcf6e,#ff9a3c)', hues: [[40, 100, 64], [30, 100, 58]] },
  { id: 'silver',   name: '镁银',    css: 'linear-gradient(135deg,#ffffff,#cfe3ff)', hues: [[210, 30, 92], [0, 0, 98]] },
  { id: 'blue',     name: '铜蓝',    css: 'linear-gradient(135deg,#3d7bff,#7fd4ff)', hues: [[220, 100, 66], [195, 100, 70]] },
  { id: 'green',    name: '钡绿',    css: 'linear-gradient(135deg,#2fe06a,#a4ff7f)', hues: [[135, 95, 58], [100, 95, 66]] },
  { id: 'violet',   name: '锶铜紫',  css: 'linear-gradient(135deg,#b45bff,#ff6bd8)', hues: [[275, 95, 66], [320, 95, 68]] },
  { id: 'rainbow',  name: '七彩',    css: 'conic-gradient(#ff4040,#ffcf3c,#3ce07a,#3d8bff,#b45bff,#ff4040)', hues: 'rainbow' },
  { id: 'random',   name: '随机',    css: 'radial-gradient(circle,#fff,#888)', hues: 'random' },
];

function pickHue(palette, seedHue) {
  if (palette.hues === 'rainbow') return [Math.random() * 360, 95, 62];
  if (palette.hues === 'random') {
    if (seedHue !== undefined) return [seedHue, 95, 62];
    return [Math.random() * 360, 95, 62];
  }
  const h = palette.hues[Math.floor(Math.random() * palette.hues.length)];
  return [h[0] + (Math.random() - 0.5) * 10, h[1], h[2]];
}

/* ---------- 烟花类型定义 ---------- */
const FIREWORK_TYPES = [
  {
    id: 'peony', icon: '❀', name: '牡丹',
    desc: '最经典的球形烟花，星点无拖尾，绽放成饱满的彩色圆球。',
    principle: '牡丹弹：药珠沿球面单层排列，开包药居中爆开，每颗星获得几乎相同的初速，因而形成完美球面。药剂快燃、不留尾迹。',
  },
  {
    id: 'chrys', icon: '✺', name: '菊花',
    desc: '与牡丹同为球形，但每颗星都拖着发光的尾迹，如菊花花瓣。',
    principle: '菊花弹：与牡丹结构相同，但药珠外层包裹慢燃碳粉，飞行中持续洒落火星，形成花瓣状拖尾。',
  },
  {
    id: 'willow', icon: '☄', name: '垂柳',
    desc: '金色星点缓慢下垂，长长的尾迹如柳枝低垂，余韵悠长。',
    principle: '垂柳弹：采用高比例木炭慢燃配方，星点燃烧时间极长且质量大，在重力下垂落数秒，勾勒出柳枝般的金色弧线。',
  },
  {
    id: 'kamuro', icon: '❋', name: '锦冠',
    desc: '日式"冠菊"，密集金银星尘缓缓垂落，形成华丽的王冠。',
    principle: '锦冠弹：星的数量是普通弹的数倍且极耐燃，爆开后火星密如尘雾，缓缓下沉覆盖半个天空，是压轴常用弹种。',
  },
  {
    id: 'ring', icon: '◎', name: '环形',
    desc: '星点排成一个平面圆环，随机的倾角让每次绽放都不同。',
    principle: '环形弹：药珠不铺满球面，而是沿弹体"赤道"排成一圈。爆开后星点保持共面飞行，从不同角度观看呈环形或直线。',
  },
  {
    id: 'double', icon: '❂', name: '双层芯',
    desc: '外层与内层两种颜色同时绽放，层次分明，如花中有蕊。',
    principle: '双层芯弹（牡丹芯）：壳内分两层排列不同配方的药珠，外层速度快、内层速度慢，爆开后形成同心双色球。',
  },
  {
    id: 'heart', icon: '♥', name: '心形',
    desc: '星点排列成心形图案，是造型弹的代表。',
    principle: '造型弹：将药珠在弹壳内的隔板上摆成心形，开包药沿垂直方向爆开，星点保持原图案扩张——摆成什么形状就炸出什么形状。',
  },
  {
    id: 'bees', icon: '✧', name: '蜂群',
    desc: '无数小光点如蜂群般乱舞盘旋，充满生命力。',
    principle: '蜂群弹：每颗"星"其实是自带微型推进药的小火箭，喷口方向随机，点燃后各自乱窜，如蜂群出巢。',
  },
  {
    id: 'strobe', icon: '✦', name: '频闪',
    desc: '星点以固定频率明灭闪烁，如满天银铃齐鸣。',
    principle: '频闪弹：药剂由"明燃层"与"暗燃层"交替压制，燃烧时周期性地爆亮-熄灭，产生闪烁效果，常用镁盐产生刺眼白光。',
  },
  {
    id: 'crossette', icon: '✚', name: '十字破',
    desc: '大星飞行途中再次炸裂成四向小星，二段式惊喜。',
    principle: '十字破弹：每颗大药珠内部预埋十字形凹槽与二级爆药，飞行一定距离后自爆，分裂成四颗小星呈十字散开。',
  },
  {
    id: 'palm', icon: '🌴', name: '棕榈',
    desc: '少而粗的金色主干上升后炸开，如热带棕榈树。',
    principle: '棕榈弹：只装十余颗特大号药珠，每颗都是粗大的喷焰体，爆开后拖出粗壮光轨如棕榈叶，弹体上升段还会喷洒"树干"火花。',
  },
];

/* ---------- 粒子 ---------- */
class Particle {
  constructor(o) {
    this.x = o.x; this.y = o.y;
    this.px = o.x; this.py = o.y;
    this.vx = o.vx || 0; this.vy = o.vy || 0;
    this.life = 1;
    this.decay = o.decay || 0.012;
    this.hue = o.hue; this.sat = o.sat ?? 95; this.lum = o.lum ?? 62;
    this.size = o.size || 2;
    this.gMul = o.gMul ?? 1;       // 重力倍率
    this.drag = o.drag ?? AIR_DRAG;
    this.glitter = o.glitter || 0;  // 洒落火星概率
    this.wiggle = o.wiggle || 0;    // 蜂群乱舞
    this.strobe = o.strobe || 0;    // 频闪频率
    this.phase = Math.random() * Math.PI * 2;
    this.splitAt = o.splitAt || 0;  // 十字破二次分裂
    this.hasSplit = false;
    this.fade = o.fade || 0;        // 颜色向暗红衰变(垂柳/锦冠)
    this.isSpark = o.isSpark || false;
  }

  update(sys, t) {
    this.px = this.x; this.py = this.y;
    this.vx *= this.drag; this.vy *= this.drag;
    this.vy += GRAVITY * this.gMul;
    if (this.wiggle) {
      this.vx += (Math.random() - 0.5) * this.wiggle;
      this.vy += (Math.random() - 0.5) * this.wiggle;
    }
    this.x += this.vx; this.y += this.vy;
    this.life -= this.decay * (0.8 + Math.random() * 0.4);

    // 洒落小火星（菊花/锦冠/棕榈）
    if (this.glitter && Math.random() < this.glitter && !this.isSpark) {
      sys.spawn(new Particle({
        x: this.x, y: this.y,
        vx: this.vx * 0.3 + (Math.random() - 0.5) * 0.4,
        vy: this.vy * 0.3 + (Math.random() - 0.5) * 0.4,
        hue: this.hue, sat: this.sat * 0.7, lum: Math.min(90, this.lum + 20),
        size: 1, decay: 0.05 + Math.random() * 0.05,
        gMul: 0.4, isSpark: true,
      }));
    }

    // 十字破：二次分裂
    if (this.splitAt && !this.hasSplit && this.life < this.splitAt) {
      this.hasSplit = true;
      this.life = 0;
      const baseA = Math.random() * Math.PI;
      for (let i = 0; i < 4; i++) {
        const a = baseA + (i * Math.PI) / 2;
        const sp = 2.2 + Math.random() * 0.8;
        sys.spawn(new Particle({
          x: this.x, y: this.y,
          vx: this.vx * 0.25 + Math.cos(a) * sp,
          vy: this.vy * 0.25 + Math.sin(a) * sp,
          hue: this.hue, sat: this.sat, lum: this.lum,
          size: 1.6, decay: 0.022 + Math.random() * 0.012,
        }));
      }
      return;
    }
  }

  draw(ctx, t) {
    let alpha = Math.max(this.life, 0);
    if (this.strobe) {
      const on = Math.sin(this.phase + t * this.strobe) > -0.15;
      alpha *= on ? 1 : 0.03;
    } else {
      alpha *= 0.75 + 0.25 * Math.sin(this.phase + t * 0.25);
    }
    if (alpha <= 0.01) return;

    // 垂柳/锦冠燃尽时颜色向暗橙红衰变
    let hue = this.hue, lum = this.lum, sat = this.sat;
    if (this.fade) {
      const k = 1 - this.life;
      hue = hue + (18 - hue) * k * this.fade;
      lum = lum * (1 - 0.45 * k * this.fade);
      sat = Math.min(100, sat + 20 * k * this.fade);
    }

    ctx.strokeStyle = `hsla(${hue},${sat}%,${lum}%,${alpha})`;
    ctx.lineWidth = this.size;
    ctx.beginPath();
    ctx.moveTo(this.px, this.py);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();

    // 高亮核心
    if (!this.isSpark && alpha > 0.35) {
      ctx.fillStyle = `hsla(${hue},${Math.max(0, sat - 45)}%,${Math.min(96, lum + 28)}%,${alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ---------- 上升的烟花弹 ---------- */
class Rocket {
  constructor(o) {
    this.x = o.x; this.y = o.y;
    this.px = this.x; this.py = this.y;
    this.targetY = o.targetY;
    this.vy = -Math.sqrt(2 * GRAVITY * (this.y - this.targetY)) * 1.02;
    this.vx = (o.tx !== undefined ? (o.tx - o.x) / (Math.abs(this.vy) / GRAVITY) * 1.0 : 0)
              + (Math.random() - 0.5) * 0.3;
    this.type = o.type;
    this.palette = o.palette;
    this.power = o.power;
    this.hue = pickHue(o.palette)[0];
    this.exploded = false;
    this.trail = Math.random() * Math.PI * 2;
  }

  update(sys) {
    this.px = this.x; this.py = this.y;
    this.vy += GRAVITY;
    this.x += this.vx + Math.sin(this.trail += 0.3) * 0.25;
    this.y += this.vy;

    // 上升尾焰
    if (Math.random() < 0.85) {
      sys.spawn(new Particle({
        x: this.x + (Math.random() - 0.5) * 1.5, y: this.y,
        vx: (Math.random() - 0.5) * 0.5, vy: 0.6 + Math.random() * 0.8,
        hue: 38, sat: 90, lum: 60,
        size: 1.1, decay: 0.06 + Math.random() * 0.05,
        gMul: 0.25, isSpark: true,
      }));
    }

    // 到达顶点（速度耗尽）即引爆 —— 对应延时引信原理
    if (this.vy >= -0.4) {
      this.exploded = true;
      sys.explode(this.type, this.x, this.y, this.palette, this.power);
    }
  }

  draw(ctx) {
    ctx.strokeStyle = `hsla(45,90%,75%,.9)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.px, this.py);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
  }
}

/* ---------- 爆炸构造：每种类型的星点排列 ---------- */
const EXPLODERS = {
  peony(sys, x, y, pal, power) {
    const n = Math.round(95 * power);
    const base = 3.4 * power;
    const seed = Math.random() * 360;
    for (let i = 0; i < n; i++) {
      const [h, s, l] = pickHue(pal, seed);
      // 80% 星点集中在球壳，20% 填充内部 → 饱满圆球
      const rim = Math.random() < 0.8;
      const sp = base * (rim ? 0.92 + Math.random() * 0.16 : Math.random() * 0.85);
      const a = Math.random() * Math.PI * 2;
      const ele = Math.acos(2 * Math.random() - 1); // 球面均匀分布
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: Math.sin(a) * Math.sin(ele) * sp * 0.96,
        hue: h, sat: s, lum: l,
        size: 2, decay: 0.0135 + Math.random() * 0.006,
      }));
    }
  },

  chrys(sys, x, y, pal, power) {
    const n = Math.round(80 * power);
    const base = 3.2 * power;
    const seed = Math.random() * 360;
    for (let i = 0; i < n; i++) {
      const [h, s, l] = pickHue(pal, seed);
      const sp = base * (0.9 + Math.random() * 0.2);
      const a = Math.random() * Math.PI * 2;
      const ele = Math.acos(2 * Math.random() - 1);
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: Math.sin(a) * Math.sin(ele) * sp * 0.96,
        hue: h, sat: s, lum: l,
        size: 2, decay: 0.011 + Math.random() * 0.005,
        glitter: 0.28,
      }));
    }
  },

  willow(sys, x, y, pal, power) {
    const n = Math.round(70 * power);
    const base = 2.6 * power;
    for (let i = 0; i < n; i++) {
      const sp = base * (0.75 + Math.random() * 0.35);
      const a = Math.random() * Math.PI * 2;
      const ele = Math.acos(2 * Math.random() - 1);
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: Math.sin(a) * Math.sin(ele) * sp * 0.9,
        hue: 40 + Math.random() * 8, sat: 85, lum: 62,
        size: 1.8, decay: 0.0038 + Math.random() * 0.002,
        drag: 0.965, gMul: 0.55, fade: 1, glitter: 0.06,
      }));
    }
  },

  kamuro(sys, x, y, pal, power) {
    const n = Math.round(150 * power);
    const base = 3.0 * power;
    for (let i = 0; i < n; i++) {
      const gold = Math.random() < 0.75;
      const sp = base * (0.55 + Math.random() * 0.5);
      const a = Math.random() * Math.PI * 2;
      const ele = Math.acos(2 * Math.random() - 1);
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: Math.sin(a) * Math.sin(ele) * sp * 0.92,
        hue: gold ? 42 + Math.random() * 6 : 50, sat: gold ? 90 : 15, lum: gold ? 64 : 88,
        size: 1.6, decay: 0.005 + Math.random() * 0.003,
        drag: 0.962, gMul: 0.5, fade: 0.9, glitter: 0.1,
      }));
    }
  },

  ring(sys, x, y, pal, power) {
    const n = Math.round(60 * power);
    const base = 3.4 * power;
    const seed = Math.random() * 360;
    // 随机 3D 圆环朝向：正交基 u, v
    const t1 = Math.random() * Math.PI * 2, t2 = Math.random() * Math.PI;
    const nx = Math.cos(t1) * Math.sin(t2), ny = Math.sin(t1) * Math.sin(t2), nz = Math.cos(t2);
    let ux = -ny, uy = nx, uz = 0;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx2 = ny * uz - nz * uy, vy2 = nz * ux - nx * uz;
    for (let i = 0; i < n; i++) {
      const [h, s, l] = pickHue(pal, seed);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.05;
      const sp = base * (0.97 + Math.random() * 0.06);
      sys.spawn(new Particle({
        x, y,
        vx: (Math.cos(a) * ux + Math.sin(a) * vx2) * sp,
        vy: (Math.cos(a) * uy + Math.sin(a) * vy2) * sp,
        hue: h, sat: s, lum: l,
        size: 2.2, decay: 0.013 + Math.random() * 0.004,
      }));
    }
  },

  double(sys, x, y, pal, power) {
    const seed = Math.random() * 360;
    const outer = pickHue(pal, seed);
    // 内芯取互补/偏移色
    const inner = pal.hues === 'rainbow' || pal.hues === 'random'
      ? [(outer[0] + 160) % 360, 95, 66]
      : pickHue(pal, (seed + 180) % 360);
    if (pal.hues !== 'rainbow' && pal.hues !== 'random' && pal.hues.length > 1) {
      inner[0] = pal.hues[1][0]; inner[1] = pal.hues[1][1]; inner[2] = pal.hues[1][2];
      outer[0] = pal.hues[0][0];
    }
    const mk = (count, spd, hsl, size) => {
      for (let i = 0; i < count; i++) {
        const sp = spd * (0.92 + Math.random() * 0.16);
        const a = Math.random() * Math.PI * 2;
        const ele = Math.acos(2 * Math.random() - 1);
        sys.spawn(new Particle({
          x, y,
          vx: Math.cos(a) * Math.sin(ele) * sp,
          vy: Math.sin(a) * Math.sin(ele) * sp * 0.96,
          hue: hsl[0] + (Math.random() - 0.5) * 8, sat: hsl[1], lum: hsl[2],
          size, decay: 0.0135 + Math.random() * 0.005,
        }));
      }
    };
    mk(Math.round(85 * power), 3.6 * power, outer, 2);
    mk(Math.round(50 * power), 1.55 * power, inner, 2.3);
  },

  heart(sys, x, y, pal, power) {
    const n = Math.round(75 * power);
    const seed = Math.random() * 360;
    const rot = (Math.random() - 0.5) * 0.5;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const [h, s, l] = pickHue(pal, seed);
      const t = (i / n) * Math.PI * 2;
      // 心形曲线
      let hx = 16 * Math.pow(Math.sin(t), 3);
      let hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      hx /= 17; hy /= 17;
      const sp = 3.2 * power * (0.96 + Math.random() * 0.08);
      sys.spawn(new Particle({
        x, y,
        vx: (hx * cs - hy * sn) * sp,
        vy: (hx * sn + hy * cs) * sp,
        hue: h, sat: s, lum: l,
        size: 2.2, decay: 0.012 + Math.random() * 0.004,
        drag: 0.988, gMul: 0.55,
      }));
    }
  },

  bees(sys, x, y, pal, power) {
    const n = Math.round(46 * power);
    const seed = Math.random() * 360;
    for (let i = 0; i < n; i++) {
      const [h, s, l] = pickHue(pal, seed);
      const sp = 1.6 * power * Math.random();
      const a = Math.random() * Math.PI * 2;
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        hue: h, sat: s, lum: l,
        size: 1.5, decay: 0.009 + Math.random() * 0.006,
        wiggle: 0.55, gMul: 0.12, drag: 0.96,
      }));
    }
  },

  strobe(sys, x, y, pal, power) {
    const n = Math.round(90 * power);
    const seed = Math.random() * 360;
    for (let i = 0; i < n; i++) {
      const [h] = pickHue(pal, seed);
      const white = Math.random() < 0.5;
      const sp = 3.0 * power * (0.4 + Math.random() * 0.6);
      const a = Math.random() * Math.PI * 2;
      const ele = Math.acos(2 * Math.random() - 1);
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: Math.sin(a) * Math.sin(ele) * sp * 0.95,
        hue: h, sat: white ? 12 : 85, lum: white ? 92 : 68,
        size: 2, decay: 0.007 + Math.random() * 0.004,
        strobe: 0.55 + Math.random() * 0.35, gMul: 0.6, drag: 0.972,
      }));
    }
  },

  crossette(sys, x, y, pal, power) {
    const n = Math.round(22 * power);
    const base = 3.0 * power;
    const seed = Math.random() * 360;
    for (let i = 0; i < n; i++) {
      const [h, s, l] = pickHue(pal, seed);
      const sp = base * (0.85 + Math.random() * 0.3);
      const a = Math.random() * Math.PI * 2;
      const ele = Math.acos(2 * Math.random() - 1);
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: Math.sin(a) * Math.sin(ele) * sp * 0.96,
        hue: h, sat: s, lum: l,
        size: 2.6, decay: 0.012,
        splitAt: 0.45 + Math.random() * 0.18,
      }));
    }
  },

  palm(sys, x, y, pal, power) {
    const arms = 11 + Math.floor(Math.random() * 4);
    const base = 3.6 * power;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + Math.random() * 0.25;
      const ele = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = base * (0.9 + Math.random() * 0.2);
      sys.spawn(new Particle({
        x, y,
        vx: Math.cos(a) * Math.sin(ele) * sp,
        vy: (Math.sin(a) * Math.sin(ele) * 0.85 - 0.25) * sp,
        hue: 38 + Math.random() * 8, sat: 92, lum: 62,
        size: 3.6, decay: 0.009 + Math.random() * 0.003,
        drag: 0.975, glitter: 0.75, fade: 0.8,
      }));
    }
    // 中心补充少量碎金
    for (let i = 0; i < Math.round(24 * power); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = base * 0.4 * Math.random();
      sys.spawn(new Particle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        hue: 42, sat: 88, lum: 68, size: 1.4,
        decay: 0.02 + Math.random() * 0.01, isSpark: true,
      }));
    }
  },
};
