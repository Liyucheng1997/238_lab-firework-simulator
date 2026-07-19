/* ============ 主程序：渲染循环 / 夜景背景 / 模式与交互 ============ */
(() => {
  const bgCanvas = document.getElementById('bgCanvas');
  const fxCanvas = document.getElementById('fxCanvas');
  const uiCanvas = document.getElementById('uiCanvas');
  const bg = bgCanvas.getContext('2d');
  const fx = fxCanvas.getContext('2d');
  const ui = uiCanvas.getContext('2d');

  let W = 0, H = 0, DPR = 1;
  let groundY = 0;

  /* ---------- 状态 ---------- */
  const state = {
    mode: 'manual',                  // manual | layout | auto
    typeId: 'peony',
    palette: PALETTES[0],
    power: 1.0,
    heightRatio: 0.65,
    flash: true,
    launchers: [],                   // 布局模式的炮位 [{x, typeId, palette, power}]
    seqTimer: null,
    autoTimer: 0,
  };

  /* ---------- 粒子系统 ---------- */
  const sys = {
    particles: [],
    rockets: [],
    flashes: [],
    spawn(p) { if (this.particles.length < 6000) this.particles.push(p); },
    explode(typeId, x, y, palette, power) {
      (EXPLODERS[typeId] || EXPLODERS.peony)(this, x, y, palette, power);
      if (state.flash) this.flashes.push({ x, y, r: 260 * power, a: 0.55 * power, life: 1 });
      SFX.boom(power, Math.abs(x - W / 2) / W);
      if (typeId === 'chrys' || typeId === 'kamuro' || typeId === 'palm') SFX.crackle(14, 1.2);
      if (typeId === 'crossette') setTimeout(() => SFX.crackle(8, 0.5), 500);
      if (typeId === 'strobe') SFX.crackle(20, 1.6);
    },
    launch(x, targetY, opts = {}) {
      const type = opts.typeId || state.typeId;
      this.rockets.push(new Rocket({
        x, y: groundY,
        tx: opts.tx, targetY,
        type,
        palette: opts.palette || state.palette,
        power: opts.power || state.power,
      }));
      SFX.launch();
    },
  };

  /* ---------- 尺寸 ---------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    for (const c of [bgCanvas, fxCanvas, uiCanvas]) {
      c.width = W * DPR; c.height = H * DPR;
      c.style.width = W + 'px'; c.style.height = H + 'px';
      c.getContext('2d').setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    groundY = H - 40;
    buildStars();
    buildSkyline();
  }

  /* ---------- 夜景背景：星空 / 月亮 / 城市剪影 ---------- */
  let stars = [], skyline = [];
  function buildStars() {
    stars = [];
    const n = Math.round((W * H) / 6500);
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H * 0.75,
        r: Math.random() * 1.1 + 0.2,
        ph: Math.random() * Math.PI * 2,
        sp: 0.5 + Math.random() * 1.5,
      });
    }
  }
  function buildSkyline() {
    skyline = [];
    let x = -20;
    while (x < W + 40) {
      const w = 30 + Math.random() * 70;
      const h = 30 + Math.random() * 110;
      const windows = [];
      const cols = Math.floor(w / 13), rows = Math.floor(h / 16);
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          if (Math.random() < 0.22) windows.push([c * 13 + 5, r * 16 + 8]);
      skyline.push({ x, w, h, windows });
      x += w + Math.random() * 14;
    }
  }

  function drawBackground(t) {
    // 夜空渐变
    const g = bg.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#040510');
    g.addColorStop(0.55, '#0a0c1e');
    g.addColorStop(0.85, '#141228');
    g.addColorStop(1, '#1c1430');
    bg.fillStyle = g;
    bg.fillRect(0, 0, W, H);

    // 星星
    for (const s of stars) {
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.ph + t * 0.02 * s.sp));
      bg.fillStyle = `rgba(255,252,240,${0.75 * tw})`;
      bg.beginPath();
      bg.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      bg.fill();
    }

    // 月亮
    const mx = W * 0.82, my = H * 0.16;
    const mg = bg.createRadialGradient(mx, my, 8, mx, my, 90);
    mg.addColorStop(0, 'rgba(255,250,224,0.9)');
    mg.addColorStop(0.25, 'rgba(255,248,214,0.25)');
    mg.addColorStop(1, 'rgba(255,248,214,0)');
    bg.fillStyle = mg;
    bg.beginPath(); bg.arc(mx, my, 90, 0, Math.PI * 2); bg.fill();
    bg.fillStyle = '#f7ecc8';
    bg.beginPath(); bg.arc(mx, my, 26, 0, Math.PI * 2); bg.fill();
    bg.fillStyle = 'rgba(210,196,160,0.5)';
    bg.beginPath(); bg.arc(mx - 8, my - 5, 5, 0, Math.PI * 2); bg.fill();
    bg.beginPath(); bg.arc(mx + 7, my + 8, 3.5, 0, Math.PI * 2); bg.fill();

    // 城市剪影
    bg.fillStyle = '#07070f';
    for (const b of skyline) bg.fillRect(b.x, groundY - b.h + 40, b.w, b.h);
    bg.fillStyle = 'rgba(255,214,120,0.55)';
    for (const b of skyline)
      for (const [wx, wy] of b.windows)
        bg.fillRect(b.x + wx, groundY - b.h + 40 + wy, 4, 6);

    // 地面
    bg.fillStyle = '#050508';
    bg.fillRect(0, groundY + 40 - 40, W, 40);
  }

  /* ---------- UI 层：炮位标记 ---------- */
  function drawUI(t) {
    ui.clearRect(0, 0, W, H);
    if (state.mode !== 'layout') return;
    // 地面基准线
    ui.strokeStyle = 'rgba(232,196,118,0.35)';
    ui.setLineDash([6, 8]);
    ui.beginPath();
    ui.moveTo(0, groundY); ui.lineTo(W, groundY);
    ui.stroke();
    ui.setLineDash([]);
    state.launchers.forEach((L, i) => {
      const pulse = 0.6 + 0.4 * Math.sin(t * 0.1 + i);
      const type = FIREWORK_TYPES.find(tp => tp.id === L.typeId);
      // 炮筒
      ui.fillStyle = `rgba(232,196,118,${0.85 * pulse})`;
      ui.fillRect(L.x - 4, groundY - 16, 8, 16);
      ui.strokeStyle = `rgba(232,196,118,${0.5 * pulse})`;
      ui.beginPath(); ui.arc(L.x, groundY - 20, 9, 0, Math.PI * 2); ui.stroke();
      // 类型图标与序号
      ui.fillStyle = '#e9e4d8';
      ui.font = '13px serif';
      ui.textAlign = 'center';
      ui.fillText(type ? type.icon : '❀', L.x, groundY - 26);
      ui.fillStyle = 'rgba(233,228,216,0.6)';
      ui.font = '10px sans-serif';
      ui.fillText(String(i + 1), L.x, groundY + 14);
    });
  }

  /* ---------- 主循环 ---------- */
  let frame = 0;
  function step() {
    frame++;
    // 窗口尺寸变化（或初始为 0）时自动重建画布
    if (W !== window.innerWidth || H !== window.innerHeight) resize();
    if (W === 0 || H === 0) return;
    drawBackground(frame);

    // 粒子层拖尾衰减
    fx.globalCompositeOperation = 'destination-out';
    fx.fillStyle = 'rgba(0,0,0,0.16)';
    fx.fillRect(0, 0, W, H);
    fx.globalCompositeOperation = 'lighter';
    fx.lineCap = 'round';

    // 爆炸闪光（空间光照）
    for (let i = sys.flashes.length - 1; i >= 0; i--) {
      const f = sys.flashes[i];
      f.life -= 0.12;
      if (f.life <= 0) { sys.flashes.splice(i, 1); continue; }
      const rg = fx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (1.4 - f.life * 0.4));
      rg.addColorStop(0, `rgba(255,246,220,${f.a * f.life * 0.5})`);
      rg.addColorStop(1, 'rgba(255,246,220,0)');
      fx.fillStyle = rg;
      fx.beginPath();
      fx.arc(f.x, f.y, f.r * 1.4, 0, Math.PI * 2);
      fx.fill();
    }

    // 火箭
    for (let i = sys.rockets.length - 1; i >= 0; i--) {
      const r = sys.rockets[i];
      r.update(sys);
      if (r.exploded) { sys.rockets.splice(i, 1); continue; }
      r.draw(fx);
    }

    // 粒子
    for (let i = sys.particles.length - 1; i >= 0; i--) {
      const p = sys.particles[i];
      p.update(sys, frame);
      if (p.life <= 0 || p.y > groundY + 20) { sys.particles.splice(i, 1); continue; }
      p.draw(fx, frame);
    }

    // 自动表演
    if (state.mode === 'auto' && --state.autoTimer <= 0) {
      state.autoTimer = 30 + Math.random() * 70;
      const x = W * (0.12 + Math.random() * 0.76);
      const type = FIREWORK_TYPES[Math.floor(Math.random() * FIREWORK_TYPES.length)];
      const pal = PALETTES[Math.floor(Math.random() * (PALETTES.length - 1))];
      const power = 0.7 + Math.random() * 0.9;
      sys.launch(x, H * (0.12 + Math.random() * 0.35), { typeId: type.id, palette: pal, power });
      // 偶发齐射
      if (Math.random() < 0.15) {
        for (let k = 0; k < 3; k++) {
          setTimeout(() => sys.launch(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.3),
            { typeId: type.id, palette: pal, power: power * 0.85 }), k * 120);
        }
      }
    }

    drawUI(frame);
  }

  function loop() {
    step();
    requestAnimationFrame(loop);
  }

  // 调试接口（无头验证用）
  window.__fw = { sys, state, step, get frame() { return frame; } };

  /* ==================== UI 交互 ==================== */
  const $ = id => document.getElementById(id);

  // 类型网格
  const typeGrid = $('typeGrid'), typeDesc = $('typeDesc');
  FIREWORK_TYPES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'type-card' + (t.id === state.typeId ? ' active' : '');
    card.innerHTML = `<span class="icon">${t.icon}</span><span class="name">${t.name}</span>`;
    card.onclick = () => {
      state.typeId = t.id;
      typeGrid.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      typeDesc.textContent = t.desc;
      $('curTypePrinciple').textContent = `【${t.name}】${t.principle}`;
      // 手动模式下即时预览
      if (state.mode === 'manual') sys.launch(W / 2 + (Math.random() - 0.5) * W * 0.3, H * 0.3);
    };
    typeGrid.appendChild(card);
  });
  typeDesc.textContent = FIREWORK_TYPES[0].desc;
  $('curTypePrinciple').textContent = `【${FIREWORK_TYPES[0].name}】${FIREWORK_TYPES[0].principle}`;

  // 色彩
  const paletteRow = $('paletteRow');
  PALETTES.forEach((p, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' active' : '');
    sw.style.background = p.css;
    sw.title = p.name;
    sw.style.setProperty('--sw', '#fff');
    sw.onclick = () => {
      state.palette = p;
      paletteRow.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    };
    paletteRow.appendChild(sw);
  });

  // 规格
  const sizeNames = ['2 寸', '3 寸', '4 寸', '5 寸', '6 寸', '8 寸', '10寸'];
  $('sizeSlider').oninput = e => {
    state.power = +e.target.value;
    const idx = Math.min(sizeNames.length - 1, Math.round((state.power - 0.6) / 1.2 * (sizeNames.length - 1)));
    $('sizeVal').textContent = sizeNames[idx];
  };
  const heightNames = { 0.3: '很高', 0.45: '高', 0.65: '中高', 0.8: '较低', 0.9: '低' };
  $('heightSlider').oninput = e => {
    state.heightRatio = +e.target.value;
    const v = state.heightRatio;
    $('heightVal').textContent = v < 0.4 ? '很高' : v < 0.55 ? '高' : v < 0.72 ? '中高' : '较低';
  };

  // 模式切换
  const modeHints = {
    manual: '点击夜空任意位置发射烟花',
    layout: '在下方地面附近点击布置炮位，然后齐射或顺序播放',
    auto: '自动随机编排烟花表演，坐和放宽',
  };
  const footHints = {
    manual: '🖱 点击夜空燃放 · 空格键快速发射',
    layout: '🖱 点击地面布置炮位 · 右键删除最近炮位',
    auto: '🎆 自动表演中 · 点击夜空可随时加放一发',
  };
  $('modeSeg').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      state.mode = btn.dataset.mode;
      $('modeSeg').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('modeHint').textContent = modeHints[state.mode];
      $('footHint').textContent = footHints[state.mode];
      $('layoutPanel').style.display = state.mode === 'layout' ? '' : 'none';
      state.autoTimer = 0;
    };
  });

  // 画布点击
  uiCanvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    SFX.unlock();
    const x = e.clientX, y = e.clientY;
    if (state.mode === 'layout' && y > H * 0.6) {
      state.launchers.push({ x, typeId: state.typeId, palette: state.palette, power: state.power });
      $('layoutCount').textContent = `已布置 ${state.launchers.length} 个炮位`;
      return;
    }
    // 手动/自动：向点击处发射；布局模式点击上方也可试放
    const targetY = Math.min(Math.max(y, H * 0.08), H * 0.72);
    sys.launch(x + (Math.random() - 0.5) * 30, targetY, { tx: x });
  });

  // 右键删除最近炮位
  uiCanvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.mode === 'layout' && state.launchers.length) {
      let best = -1, bd = 1e9;
      state.launchers.forEach((L, i) => {
        const d = Math.abs(L.x - e.clientX);
        if (d < bd) { bd = d; best = i; }
      });
      if (bd < 60) {
        state.launchers.splice(best, 1);
        $('layoutCount').textContent = `已布置 ${state.launchers.length} 个炮位`;
      }
    }
  });

  // 空格快速发射
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      SFX.unlock();
      sys.launch(W * (0.2 + Math.random() * 0.6), H * (0.15 + Math.random() * 0.3));
    }
  });

  /* ---------- 布局编排 ---------- */
  function fireLauncher(L) {
    sys.launch(L.x, H * (state.heightRatio - 0.35) + Math.random() * H * 0.08,
      { typeId: L.typeId, palette: L.palette, power: L.power });
  }
  $('fireAll').onclick = () => {
    SFX.unlock();
    state.launchers.forEach((L, i) => setTimeout(() => fireLauncher(L), Math.random() * 180));
  };
  $('fireSeq').onclick = () => {
    SFX.unlock();
    const delay = +$('seqDelay').value;
    state.launchers.forEach((L, i) => setTimeout(() => fireLauncher(L), i * delay));
  };
  $('clearLayout').onclick = () => {
    state.launchers = [];
    $('layoutCount').textContent = '已布置 0 个炮位';
  };
  $('seqDelay').oninput = e => $('seqDelayVal').textContent = e.target.value + 'ms';

  // 预设布局
  function applyPreset(fn) {
    state.launchers = fn();
    $('layoutCount').textContent = `已布置 ${state.launchers.length} 个炮位`;
  }
  $('presetFan').onclick = () => applyPreset(() => {
    const arr = [];
    for (let i = 0; i < 7; i++)
      arr.push({ x: W * (0.2 + i * 0.1), typeId: state.typeId, palette: state.palette, power: state.power * 0.9 });
    return arr;
  });
  $('presetWave').onclick = () => applyPreset(() => {
    const arr = [];
    const types = ['peony', 'chrys', 'peony', 'strobe', 'peony', 'chrys', 'peony', 'strobe', 'peony'];
    for (let i = 0; i < 9; i++)
      arr.push({ x: W * (0.12 + i * 0.095), typeId: types[i], palette: state.palette, power: 0.8 });
    return arr;
  });
  $('presetCenter').onclick = () => applyPreset(() => ([
    { x: W * 0.3,  typeId: 'willow',  palette: PALETTES[1], power: 1.1 },
    { x: W * 0.42, typeId: 'peony',   palette: state.palette, power: 1.0 },
    { x: W * 0.5,  typeId: 'kamuro',  palette: PALETTES[1], power: 1.6 },
    { x: W * 0.58, typeId: 'peony',   palette: state.palette, power: 1.0 },
    { x: W * 0.7,  typeId: 'willow',  palette: PALETTES[1], power: 1.1 },
  ]));

  // 开关
  $('soundToggle').onchange = e => { SFX.enabled = e.target.checked; if (e.target.checked) SFX.unlock(); };
  $('flashToggle').onchange = e => state.flash = e.target.checked;

  // 面板收起
  $('panelToggle').onclick = () => $('panel').classList.toggle('collapsed');

  // 原理弹窗
  $('principleBtn').onclick = () => $('principleModal').style.display = '';
  $('principleClose').onclick = () => $('principleModal').style.display = 'none';
  $('principleModal').onclick = e => { if (e.target === $('principleModal')) $('principleModal').style.display = 'none'; };

  /* ---------- 启动 ---------- */
  window.addEventListener('resize', resize);
  resize();
  loop();

  // 开场小演出
  setTimeout(() => sys.launch(W * 0.5, H * 0.28, { typeId: 'kamuro', power: 1.3, palette: PALETTES[1] }), 600);
  setTimeout(() => sys.launch(W * 0.32, H * 0.35, { typeId: 'peony', power: 0.9, palette: PALETTES[0] }), 1300);
  setTimeout(() => sys.launch(W * 0.68, H * 0.33, { typeId: 'chrys', power: 0.9, palette: PALETTES[3] }), 1800);
})();
