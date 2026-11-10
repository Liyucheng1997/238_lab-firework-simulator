/* ============ 空间音效（Web Audio 实时合成，无音频文件） ============
   · 声速延迟：按爆点到镜头的距离推迟发声（光先到、声后至）
   · 距离衰减 + 空气吸收（越远高频越少）+ 左右声像
   · 合成混响：模拟爆声在水面与城市楼群之间的回荡 */
'use strict';

const SFX = (() => {
  let ctx = null, master = null, dry = null, wet = null, noiseBuf = null;
  let enabled = true, delayOn = true, timeScale = 1;
  let lis = [0, 3, 620], right = [1, 0, 0];
  let voices = 0;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
      master = ctx.createGain(); master.gain.value = 0.8;
      comp.connect(master).connect(ctx.destination);
      dry = ctx.createGain(); dry.connect(comp);
      // 混响脉冲响应：指数衰减的低通噪声
      const len = Math.floor(ctx.sampleRate * 3.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          lp += ((Math.random() * 2 - 1) - lp) * (0.35 - 0.3 * t);
          d[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
        }
      }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      wet = ctx.createGain(); wet.gain.value = 0.55;
      wet.connect(conv).connect(comp);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true; s.loopStart = Math.random(); s.loopEnd = 2;
    return s;
  }

  /** 为世界坐标 p 处的声源建立输出链，返回 { node, t(开始时刻), dist } */
  function spatial(p, reverb) {
    const dx = p.x - lis[0], dy = p.y - lis[1], dz = p.z - lis[2];
    const dist = Math.hypot(dx, dy, dz);
    const delay = delayOn ? Math.min(7, dist / FW.SOUND / Math.max(0.15, timeScale)) : 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900 + 15000 / (1 + dist / 220);
    const g = ctx.createGain(); g.gain.value = 1 / (1 + dist / 420);
    lp.connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = FW.clamp(((dx * right[0] + dy * right[1] + dz * right[2]) / (dist + 1)) * 1.3, -0.9, 0.9);
      g.connect(pan); out = pan;
    }
    out.connect(dry);
    if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; out.connect(s); s.connect(wet); }
    return { node: lp, t: ctx.currentTime + 0.01 + delay, dist };
  }
  const track = (src, dur) => { voices++; setTimeout(() => voices--, dur * 1000 + 200); return src; };

  /** 出膛：低沉的"嘭" + 一小段气流嘶声 */
  function lift(p, cal) {
    if (!enabled || !ensure() || voices > 70) return;
    const s = Math.pow(cal / 6, 0.6), o = spatial(p, 0.25), t = o.t;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(130 / s, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5 * s, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(og).connect(o.node); osc.start(t); osc.stop(t + 0.25);
    const n = track(noise(), 0.9), f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.32 * s, t); ng.gain.exponentialRampToValueAtTime(0.02, t + 0.12); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    n.connect(f).connect(ng).connect(o.node); n.start(t); n.stop(t + 0.85);
  }

  /** 开花：尖锐的爆裂瞬态 + 低通噪声轰鸣 + 次低频冲击，弹径越大越低沉悠长 */
  function burst(p, cal, loud = 1) {
    if (!enabled || !ensure() || voices > 70) return;
    const s = Math.pow(cal / 6, 0.75), o = spatial(p, 0.5), t = o.t, vol = Math.min(1.5, 0.75 * s * loud);
    const c = track(noise(), 1.6 * s), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(vol * 0.9, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    c.connect(hp).connect(cg).connect(o.node); c.start(t); c.stop(t + 0.07);
    const b = noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400 / s, t); lp.frequency.exponentialRampToValueAtTime(90, t + 0.9 * s);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(vol, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3 * s);
    b.connect(lp).connect(bg).connect(o.node); b.start(t); b.stop(t + 1.4 * s);
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(95 / s, t); osc.frequency.exponentialRampToValueAtTime(30, t + 0.45);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 * s);
    osc.connect(og).connect(o.node); osc.start(t); osc.stop(t + 0.7 * s);
  }

  /** 小爆裂（千轮子弹、十字破分裂） */
  function pop(p) {
    if (!enabled || !ensure() || voices > 40) return;
    const o = spatial(p, 0.3), t = o.t + Math.random() * 0.03;
    const n = track(noise(), 0.3), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 900; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(f).connect(g).connect(o.node); n.start(t); n.stop(t + 0.2);
  }

  /** 噼啪：一串极短的高频噪声脉冲 */
  function crackle(p, count) {
    if (!enabled || !ensure() || voices > 50) return;
    const o = spatial(p, 0.15), n = Math.min(10, count);
    for (let i = 0; i < n; i++) {
      const t = o.t + Math.random() * 0.12;
      const s = track(noise(), 0.1), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800 + Math.random() * 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16 + Math.random() * 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025 + Math.random() * 0.02);
      s.connect(hp).connect(g).connect(o.node); s.start(t); s.stop(t + 0.06);
    }
  }

  /** 喷泉：持续 7 秒的沙沙喷射声 */
  function fountain(p) {
    if (!enabled || !ensure() || voices > 40) return;
    const o = spatial(p, 0.1), t = o.t, dur = 7 / Math.max(0.15, timeScale);
    const n = track(noise(), dur), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.4);
    g.gain.setValueAtTime(0.22, t + dur - 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(o.node); n.start(t); n.stop(t + dur + 0.05);
  }

  return {
    lift, burst, pop, crackle, fountain,
    unlock: ensure,
    setListener(pos, r) { lis = pos; right = r; },
    set enabled(v) { enabled = v; },
    get enabled() { return enabled; },
    set delay(v) { delayOn = v; },
    set timeScale(v) { timeScale = v; },
  };
})();
