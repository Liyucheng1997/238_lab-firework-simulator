/* ============ 主程序：主循环 / 输入 / 模式 / 界面绑定 ============ */
'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const { clamp, rand } = FW;
  const glCanvas = $('glCanvas'), uiCanvas = $('uiCanvas'), ui = uiCanvas.getContext('2d');

  let renderer;
  try { renderer = new FW.Renderer(glCanvas); }
  catch (e) { console.error(e); $('glError').style.display = ''; return; }

  /* ---------- 画质档位 ---------- */
  const QUALITY = {
    low: { cap: 140000, density: 0.6, emit: 0.5, dpr: 1 },
    medium: { cap: 320000, density: 0.85, emit: 0.8, dpr: 1.25 },
    high: { cap: 640000, density: 1, emit: 1, dpr: 1.5 },
    ultra: { cap: 1300000, density: 1.3, emit: 1.5, dpr: 2 },
  };

  const state = {
    mode: 'manual',            // manual | layout | auto
    typeId: 'peony',
    palette: FW.PALETTES[0],
    calIdx: 3,                 // 6 寸
    heightMul: 1,
    timeScale: 1,
    frozen: false,
    quality: 'high',
    mortars: [],               // 布局模式的炮位 [{x, z, typeId, palette, caliber, tiltX}]
    windSpeed: 2.4, windDir: 68,
  };
  const caliber = () => FW.CALIBERS[state.calIdx];

  const sim = new FW.Sim({ sparkCap: QUALITY.high.cap });
  const cam = new FW.Camera();
  const show = new FW.Show(sim);

  sim.onEvent = (name, d) => {
    if (name === 'lift') SFX.lift(d, d.cal);
    else if (name === 'burst') { SFX.burst(d, d.cal, d.type.boom || 1); hudBurst(); }
    else if (name === 'pop') SFX.pop(d);
    else if (name === 'crackle') SFX.crackle(d, d.n);
    else if (name === 'fountain') SFX.fountain(d);
  };

  function applyWind() {
    const a = (state.windDir * Math.PI) / 180;
    sim.wind.x = Math.sin(a) * state.windSpeed; sim.wind.z = Math.cos(a) * state.windSpeed;
  }
  function applyQuality(id) {
    const q = QUALITY[id];
    state.quality = id;
    if (Math.abs(sim.ring.cap - q.cap) > 4096) sim.setRing(q.cap);     // 换档会清空现有火星
    sim.density = q.density; sim.emitBase = q.emit; sim.emitAdapt = 1;
    renderer.dprCap = q.dpr;
  }
  applyWind(); applyQuality('high');

  /* ---------- 发射 ---------- */
  /** 朝空间中一点发射：从驳船上最近的炮位出膛，弹道顶点落在该点 */
  function fireAt(P, o = {}) {
    sim.launch({
      x: clamp(P[0] * 0.75, -115, 115), z: clamp(P[2] * 0.3, -4.5, 4.5),
      typeId: o.typeId || state.typeId, palette: o.palette || state.palette, caliber: o.caliber || caliber(), target: P,
    });
  }
  function fireRandom() {
    const h = FW.stdHeight(caliber()) * state.heightMul;
    fireAt([rand(-110, 110), h * rand(0.9, 1.1), rand(-25, 25)]);
  }
  function fireMortar(m) {
    sim.launch({
      x: m.x, z: m.z, typeId: m.typeId, palette: m.palette, caliber: m.caliber,
      height: FW.stdHeight(m.caliber) * state.heightMul * rand(0.97, 1.03), tiltX: m.tiltX || 0,
    });
  }

  /** 把一次点击换算成空中的目标点 */
  function skyPoint(r) {
    let p = null;
    let nx = cam.pos[0] - cam.target[0], nz = cam.pos[2] - cam.target[2];
    const l = Math.hypot(nx, nz);
    if (l > cam.dist * 0.4) {
      // 过发射线、正对镜头的竖直平面
      nx /= l; nz /= l;
      const den = r.d[0] * nx + r.d[2] * nz;
      if (den < -1e-3) {
        const t = -(r.o[0] * nx + r.o[2] * nz) / den;
        p = [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t];
      }
    } else if (r.d[1] < -1e-3) {
      // 俯视时改用标准炸高处的水平面
      const h = FW.stdHeight(caliber()) * state.heightMul, t = (h - r.o[1]) / r.d[1];
      if (t > 0) p = [r.o[0] + r.d[0] * t, h, r.o[2] + r.d[2] * t];
    }
    if (!p) p = [rand(-80, 80), FW.stdHeight(caliber()), rand(-20, 20)];
    p[1] = clamp(p[1], 35, 460);
    const hr = Math.hypot(p[0], p[2]);
    if (hr > 330) { p[0] *= 330 / hr; p[2] *= 330 / hr; }
    return p;
  }

  /* ---------- 尺寸 ---------- */
  let W = 0, H = 0, DPR = 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    uiCanvas.width = W * DPR; uiCanvas.height = H * DPR;
    uiCanvas.style.width = W + 'px'; uiCanvas.style.height = H + 'px';
    ui.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* ---------- 二维叠加层：炮位标记 ---------- */
  function drawOverlay(t) {
    ui.clearRect(0, 0, W, H);
    if (state.mode !== 'layout') return;
    ui.textAlign = 'center';
    const labels = [];
    state.mortars.forEach((m, i) => {
      const s = cam.project(m.x, 2, m.z, W, H);
      if (!s) return;
      const crowded = labels.some(q => Math.abs(q[0] - s[0]) < 30 && Math.abs(q[1] - s[1]) < 14);
      if (!crowded) labels.push(s);
      const pulse = 0.6 + 0.4 * Math.sin(t * 4 + i);
      const type = FW.TYPE_MAP[m.typeId];
      ui.strokeStyle = `rgba(232,196,118,${0.75 * pulse})`;
      ui.lineWidth = 1.2;
      ui.beginPath(); ui.arc(s[0], s[1] - 4, 9, 0, Math.PI * 2); ui.stroke();
      if (m.tiltX) {       // 倾斜炮位画出指向
        ui.beginPath(); ui.moveTo(s[0], s[1] - 4);
        ui.lineTo(s[0] + Math.sin(m.tiltX) * 26 * Math.cos(cam.yaw), s[1] - 4 - Math.cos(m.tiltX) * 26); ui.stroke();
      }
      if (crowded) return;       // 炮位挤在一起时只标注其中一个
      ui.fillStyle = '#f3ead6'; ui.font = '13px serif';
      ui.fillText(type ? type.icon : '❀', s[0], s[1] - 18);
      ui.fillStyle = 'rgba(233,228,216,0.7)'; ui.font = '10px sans-serif';
      ui.fillText(`${i + 1} · ${m.caliber}寸`, s[0], s[1] + 18);
    });
  }

  /* ---------- HUD ---------- */
  const hudStat = $('hudStat'), hudShell = $('hudShell');
  function hudBurst() {
    const b = sim.lastBurst;
    if (!b) return;
    hudShell.textContent = `${b.cal} 寸 ${b.type.name} · 炸高 ${b.height.toFixed(0)} m · 开花直径 ${(b.radius * 2).toFixed(0)} m · 出膛 ${b.v0.toFixed(0)} m/s · 引信 ${b.fuse.toFixed(1)} s`;
  }

  /* ---------- 主循环 ---------- */
  let last = performance.now(), wall = 0, fps = 60, statT = 0, adaptT = 0, slowTicks = 0;
  function advance(rdt) {
    if (state.frozen) return;
    const rem = rdt * state.timeScale;
    const steps = Math.min(4, Math.max(1, Math.ceil(rem / (1 / 60))));
    for (let i = 0; i < steps; i++) sim.step(rem / steps);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    const rdt = Math.min(0.05, Math.max(0.001, raw));
    last = now; wall += rdt;
    if (W !== window.innerWidth || H !== window.innerHeight) resize();
    if (!W || !H) return;
    renderer.resize(W, H);
    advance(rdt);
    cam.shiftGoal = document.body.classList.contains('ui-hidden') || $('panel').classList.contains('collapsed') ? 0 : Math.min(0.3, 292 / W);
    cam.update(rdt, W / H);
    sim.viewer = cam.pos;
    SFX.setListener(cam.pos, [cam.view[0], cam.view[4], cam.view[8]]);
    renderer.render(sim, cam, wall, state.frozen ? 0 : state.timeScale);
    drawOverlay(wall);

    statT += rdt;
    if (raw < 0.1) {            // 标签页被挂起/节流时的长间隔不计入帧率
      fps += (1 / rdt - fps) * 0.05;
      adaptT += rdt;
    }
    if (adaptT > 0.5) {
      // 帧率不足时，自动降低拖尾火星的发射率（并以亮度补偿）；
      // 仍然不够再逐级降低渲染分辨率
      adaptT = 0;
      if (fps < 42) sim.emitAdapt = Math.max(0.3, sim.emitAdapt * 0.85);
      else if (fps > 54) sim.emitAdapt = Math.min(1, sim.emitAdapt * 1.08);
      slowTicks = fps < 33 ? slowTicks + 1 : 0;
      if (slowTicks >= 6 && renderer.dprCap > 0.75) { renderer.dprCap -= 0.25; slowTicks = 0; }
    }
    if (statT > 0.3) {
      statT = 0;
      hudStat.textContent = `${fps.toFixed(0)} FPS · 星体 ${sim.n} · 火星 ${(sim.ring.live / 1000).toFixed(0)}k${state.frozen ? ' · 时间已冻结' : state.timeScale !== 1 ? ` · ${state.timeScale.toFixed(2)}×` : ''}`;
    }
  }

  // 调试接口（无头验证用）
  window.__fw = { sim, cam, renderer, state, show, fireAt, step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) sim.step(dt); } };

  /* ==================== 画布输入 ==================== */
  const ptrs = new Map();
  let drag = null, pinch = 0;
  uiCanvas.addEventListener('pointerdown', e => {
    SFX.unlock();
    uiCanvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button, shift: e.shiftKey };
    else if (ptrs.size === 2) {
      if (drag) drag.moved = true;
      const [a, b] = [...ptrs.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  uiCanvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) cam.zoom(pinch / d);
      pinch = d;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
    drag.lx = e.clientX; drag.ly = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    if (drag.moved) {
      if (drag.button === 2 || drag.shift) cam.pan(dx, dy);
      else cam.orbit(dx, dy);
      uiCanvas.style.cursor = 'grabbing';
    }
  });
  const pointerEnd = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (drag && drag.id === e.pointerId) {
      if (!drag.moved && e.type === 'pointerup') {
        if (drag.button === 0) onClick(e.clientX, e.clientY);
        else if (drag.button === 2) onRightClick(e.clientX, e.clientY);
      }
      drag = null;
      uiCanvas.style.cursor = '';
    }
  };
  uiCanvas.addEventListener('pointerup', pointerEnd);
  uiCanvas.addEventListener('pointercancel', pointerEnd);
  uiCanvas.addEventListener('contextmenu', e => e.preventDefault());
  uiCanvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom(Math.exp(e.deltaY * 0.0011)); }, { passive: false });

  function onClick(x, y) {
    const r = cam.ray((x / W) * 2 - 1, 1 - (y / H) * 2);
    if (state.mode === 'layout' && r.d[1] < -0.005) {
      const t = -r.o[1] / r.d[1], gx = r.o[0] + r.d[0] * t, gz = r.o[2] + r.d[2] * t;
      if (Math.hypot(gx, gz) < 420) {
        state.mortars.push({ x: gx, z: gz, typeId: state.typeId, palette: state.palette, caliber: caliber(), tiltX: 0 });
        mortarsChanged();
        return;
      }
    }
    fireAt(skyPoint(r));
  }
  function onRightClick(x, y) {
    if (state.mode !== 'layout' || !state.mortars.length) return;
    let best = -1, bd = 44;
    state.mortars.forEach((m, i) => {
      const s = cam.project(m.x, 2, m.z, W, H);
      if (!s) return;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { state.mortars.splice(best, 1); mortarsChanged(); }
  }
  function mortarsChanged() {
    $('layoutCount').textContent = `已布置 ${state.mortars.length} 个炮位`;
    renderer.setProps(state.mortars);
  }

  /* ==================== 界面 ==================== */
  // 烟花类型
  const typeGrid = $('typeGrid'), typeDesc = $('typeDesc');
  function selectType(t, card, preview) {
    state.typeId = t.id;
    typeGrid.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    typeDesc.textContent = t.desc;
    $('curTypePrinciple').textContent = `【${t.name}】${t.principle}`;
    if (preview && state.mode === 'manual') {
      SFX.unlock();
      fireAt([rand(-60, 60), FW.stdHeight(caliber()) * state.heightMul, rand(-15, 15)]);
    }
  }
  let groundLabel = false;
  FW.TYPES.forEach((t, i) => {
    if (t.ground && !groundLabel) {
      groundLabel = true;
      const lab = document.createElement('div');
      lab.className = 'type-sep'; lab.textContent = '地面效果';
      typeGrid.appendChild(lab);
    }
    const card = document.createElement('div');
    card.className = 'type-card';
    card.innerHTML = `<span class="icon">${t.icon}</span><span class="name">${t.name}</span>`;
    card.onclick = () => selectType(t, card, true);
    typeGrid.appendChild(card);
    if (i === 0) selectType(t, card, false);
  });

  // 色彩
  const paletteRow = $('paletteRow');
  FW.PALETTES.forEach((p, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' active' : '');
    sw.style.background = p.css; sw.title = p.name;
    sw.onclick = () => {
      state.palette = p;
      paletteRow.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      $('paletteName').textContent = p.name;
    };
    paletteRow.appendChild(sw);
  });

  // 规格
  function showSpec() {
    const c = caliber(), h = FW.stdHeight(c) * state.heightMul;
    $('sizeVal').textContent = `${c} 寸`;
    $('heightVal').textContent = `${h.toFixed(0)} m`;
    $('specHint').textContent = `开花直径约 ${(FW.stdRadius(c) * 2).toFixed(0)} m，出膛约 ${FW.verticalShot(FW.shellDrag(c), h).v0.toFixed(0)} m/s，引信 ${sim.fuseFor(c, h).toFixed(1)} s`;
  }
  $('sizeSlider').oninput = e => { state.calIdx = +e.target.value; showSpec(); };
  $('heightSlider').oninput = e => { state.heightMul = +e.target.value; showSpec(); };
  showSpec();

  // 模式
  const modeHints = {
    manual: '点击夜空任意位置，礼花弹会飞到那里开花',
    layout: '点击水面布置炮位（右键删除），然后齐射或顺序播放',
    auto: '自动编排的完整表演：开场 → 多个段落 → 压轴齐放',
  };
  const footHints = {
    manual: '点击夜空燃放 · 拖拽旋转视角 · 滚轮推拉 · 右键拖拽平移 · 空格快射 · F 冻结时间',
    layout: '点击水面布置炮位 · 右键点击删除 · 点击夜空试放 · 拖拽旋转视角',
    auto: '自动表演中 · 点击夜空可随时加放 · 拖拽旋转视角 · F 冻结时间后可绕着烟花看',
  };
  function setMode(mode) {
    if (mode === 'layout' && state.mode !== 'layout') cam.preset('aerial');     // 俯视水面才方便摆炮位
    state.mode = mode;
    $('modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('modeHint').textContent = modeHints[mode];
    $('footHint').textContent = footHints[mode];
    $('layoutPanel').style.display = mode === 'layout' ? '' : 'none';
    if (mode === 'auto') show.start(); else show.stop();
  }
  $('modeSeg').querySelectorAll('button').forEach(btn => { btn.onclick = () => { SFX.unlock(); setMode(btn.dataset.mode); }; });

  // 布局编排
  $('fireAll').onclick = () => { SFX.unlock(); state.mortars.forEach(m => sim.at(Math.random() * 0.12, () => fireMortar(m), 'layout')); };
  $('fireSeq').onclick = () => {
    SFX.unlock();
    const delay = +$('seqDelay').value / 1000;
    state.mortars.forEach((m, i) => sim.at(i * delay, () => fireMortar(m), 'layout'));
  };
  $('clearLayout').onclick = () => { state.mortars = []; sim.cancel('layout'); mortarsChanged(); };
  $('seqDelay').oninput = e => ($('seqDelayVal').textContent = e.target.value + 'ms');
  const preset = fn => { state.mortars = fn(); mortarsChanged(); };
  const M = (x, typeId, palette, cal, tiltX = 0, z = 0) => ({ x, z, typeId, palette, caliber: cal, tiltX });
  $('presetFan').onclick = () => preset(() => Array.from({ length: 9 }, (_, i) => M((i - 4) * 5, state.typeId, state.palette, caliber(), (i - 4) * 0.14)));
  $('presetWave').onclick = () => preset(() => {
    const types = ['peony', 'chrys', 'peony', 'strobe', 'double', 'strobe', 'peony', 'chrys', 'peony'];
    return types.map((t, i) => M(-100 + i * 25, t, state.palette, 5));
  });
  $('presetCenter').onclick = () => preset(() => [
    M(-90, 'willow', FW.PALETTE_MAP.gold, 8), M(-45, 'peony', state.palette, 6), M(0, 'senrin', FW.PALETTE_MAP.rainbow, 10),
    M(45, 'peony', state.palette, 6), M(90, 'willow', FW.PALETTE_MAP.gold, 8),
  ]);
  $('presetCross').onclick = () => preset(() => {
    const a = [];
    for (let i = 0; i < 6; i++) { a.push(M(-100, 'comet', state.palette, 4, 0.12 + i * 0.1)); a.push(M(100, 'comet', state.palette, 4, -0.12 - i * 0.1)); }
    return a;
  });

  // 镜头
  const camRow = $('camRow');
  Object.entries(FW.CAM_PRESETS).forEach(([id, p], i) => {
    const b = document.createElement('button');
    b.textContent = p.name; b.title = `快捷键 ${i + 1}`;
    b.onclick = () => cam.preset(id);
    camRow.appendChild(b);
  });
  $('orbitToggle').onchange = e => (cam.autoOrbit = e.target.checked);

  // 时间
  function setFrozen(v) {
    state.frozen = v;
    $('freezeBtn').classList.toggle('on', v);
    $('freezeBtn').textContent = v ? '▶ 恢复时间' : '❄ 冻结时间';
  }
  $('freezeBtn').onclick = () => setFrozen(!state.frozen);
  $('speedSlider').oninput = e => {
    state.timeScale = +e.target.value;
    SFX.timeScale = state.timeScale;
    $('speedVal').textContent = state.timeScale.toFixed(2) + '×';
  };

  // 环境
  $('windSlider').oninput = e => { state.windSpeed = +e.target.value; $('windVal').textContent = state.windSpeed.toFixed(1) + ' m/s'; applyWind(); };
  $('windDirSlider').oninput = e => { state.windDir = +e.target.value; $('windDirVal').textContent = state.windDir + '°'; applyWind(); };

  // 画质
  $('qualitySeg').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      $('qualitySeg').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyQuality(btn.dataset.q);
    };
  });
  $('bloomSlider').oninput = e => { renderer.opt.bloom = +e.target.value; $('bloomVal').textContent = (+e.target.value).toFixed(1); };
  $('expSlider').oninput = e => { renderer.opt.exposure = +e.target.value; $('expVal').textContent = (+e.target.value).toFixed(1); };

  // 开关
  $('soundToggle').onchange = e => { SFX.enabled = e.target.checked; if (e.target.checked) SFX.unlock(); };
  $('delayToggle').onchange = e => (SFX.delay = e.target.checked);
  $('flashToggle').onchange = e => (sim.lightsOn = e.target.checked);
  $('reflToggle').onchange = e => (renderer.opt.reflection = e.target.checked);
  $('smokeToggle').onchange = e => { renderer.opt.smoke = sim.smokeOn = e.target.checked; if (!e.target.checked) sim.smoke.length = 0; };

  // 面板与弹窗
  $('panelToggle').onclick = () => $('panel').classList.toggle('collapsed');
  $('principleBtn').onclick = () => ($('principleModal').style.display = '');
  $('principleClose').onclick = () => ($('principleModal').style.display = 'none');
  $('principleModal').onclick = e => { if (e.target === $('principleModal')) $('principleModal').style.display = 'none'; };

  // 键盘
  const presetIds = Object.keys(FW.CAM_PRESETS);
  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.code === 'Space') { if (!e.repeat) { e.preventDefault(); SFX.unlock(); fireRandom(); } }
    else if (e.code === 'KeyF') setFrozen(!state.frozen);
    else if (e.code === 'KeyR') { cam.autoOrbit = !cam.autoOrbit; $('orbitToggle').checked = cam.autoOrbit; }
    else if (e.code === 'KeyH') document.body.classList.toggle('ui-hidden');
    else if (/^Digit[1-6]$/.test(e.code)) cam.preset(presetIds[+e.code.slice(5) - 1]);
  });

  /* ---------- 启动 ---------- */
  window.addEventListener('resize', resize);
  resize();
  mortarsChanged();
  setMode('manual');
  requestAnimationFrame(frame);

  // 开场小演出
  const G = FW.PALETTE_MAP;
  sim.at(0.3, () => fireAt([0, 215, 0], { typeId: 'kamuro', caliber: 8, palette: G.gold }));
  sim.at(1.6, () => fireAt([-120, 170, 10], { typeId: 'peony', caliber: 6, palette: G.redgold }));
  sim.at(2.3, () => fireAt([125, 180, -10], { typeId: 'chrys', caliber: 6, palette: G.blue }));
})();
