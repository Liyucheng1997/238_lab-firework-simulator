/* ============ 合成音效引擎（Web Audio API，无音频文件） ============ */
const SFX = (() => {
  let ctx = null;
  let master = null;
  let enabled = true;
  let noiseBuf = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      // 预生成 2 秒白噪声缓冲
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noiseSource() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  /** 升空啸声：带通噪声 + 频率上扫 */
  function launch() {
    if (!enabled) return;
    ensure();
    const t = ctx.currentTime;
    const src = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 14;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + 1.05);
  }

  /** 爆炸：低频正弦冲击 + 低通噪声轰鸣，size 0.6~1.8 */
  function boom(size = 1, dist = 0) {
    if (!enabled) return;
    ensure();
    const t = ctx.currentTime;
    const vol = Math.min(0.9, 0.35 * size) * (1 - Math.min(dist, 0.5));
    // 低频冲击
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 / size, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 * size);
    osc.connect(og).connect(master);
    osc.start(t); osc.stop(t + 0.7 * size);
    // 轰鸣噪声
    const src = noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 1.1 * size);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2 * size);
    src.connect(lp).connect(g).connect(master);
    src.start(t); src.stop(t + 1.3 * size);
  }

  /** 噼啪声：一串短促噪声脉冲 */
  function crackle(n = 12, spread = 0.9) {
    if (!enabled) return;
    ensure();
    const t0 = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const t = t0 + 0.08 + Math.random() * spread;
      const src = noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05 + Math.random() * 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(hp).connect(g).connect(master);
      src.start(t); src.stop(t + 0.04);
    }
  }

  return {
    launch, boom, crackle,
    set enabled(v) { enabled = v; },
    get enabled() { return enabled; },
    unlock: ensure,
  };
})();
