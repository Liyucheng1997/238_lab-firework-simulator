/* ============ WebGL2 渲染器：HDR 场景 → 水面平面反射 → 辉光 → 色调映射 ============ */
'use strict';

(() => {
  const SH = FW.SHADERS;

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 不可用');
      this.gl = gl; this.canvas = canvas;
      this.hdr = !!gl.getExtension('EXT_color_buffer_float');     // 半浮点渲染目标；缺失时退回 8 位
      this.P = {
        sky: this.program(SH.tri_vs, SH.sky_fs),
        bld: this.program(SH.bld_vs, SH.bld_fs),
        water: this.program(SH.water_vs, SH.water_fs),
        smoke: this.program(SH.smoke_vs, SH.smoke_fs),
        part: this.program(SH.part_vs, SH.part_fs),
        down: this.program(SH.tri_vs, SH.down_fs),
        up: this.program(SH.tri_vs, SH.up_fs),
        comp: this.program(SH.tri_vs, SH.comp_fs),
      };
      this.vaoEmpty = gl.createVertexArray();
      this.w = 0; this.h = 0;
      this.dprCap = 1.5;
      this.opt = { bloom: 1, exposure: 1, reflection: true, smoke: true };
      this.initParticles();
      this.initBoxes();
      this.initSmoke();
    }

    /* ---------- 基础设施 ---------- */
    program(vsSrc, fsSrc) {
      const gl = this.gl;
      const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(s);
          console.error(log, '\n', src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
          throw new Error('着色器编译失败: ' + log);
        }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
      }
      return { p, u };
    }

    target(w, h, depth) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let rb = null;
      if (depth) {
        rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) console.warn('帧缓冲不完整', w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo, tex, rb, w, h };
    }
    freeTarget(t) {
      if (!t) return;
      const gl = this.gl;
      gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex);
      if (t.rb) gl.deleteRenderbuffer(t.rb);
    }

    resize(cssW, cssH) {
      const pr = Math.min(window.devicePixelRatio || 1, this.dprCap);
      const w = Math.max(16, Math.round(cssW * pr)), h = Math.max(16, Math.round(cssH * pr));
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      this.canvas.width = w; this.canvas.height = h;
      this.freeTarget(this.scene); this.freeTarget(this.refl);
      (this.mips || []).forEach(m => this.freeTarget(m));
      this.scene = this.target(w, h, true);
      this.refl = this.target(Math.max(8, w >> 1), Math.max(8, h >> 1), true);
      this.mips = [];
      let mw = w >> 1, mh = h >> 1;
      for (let i = 0; i < 6 && mw >= 4 && mh >= 4; i++) { this.mips.push(this.target(mw, mh, false)); mw >>= 1; mh >>= 1; }
    }

    /* ---------- 粒子缓冲 ---------- */
    initParticles() {
      const gl = this.gl;
      const mkVAO = buf => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        for (let a = 0; a < 4; a++) {
          gl.enableVertexAttribArray(a);
          gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 64, a * 16);
          gl.vertexAttribDivisor(a, 1);
        }
        gl.bindVertexArray(null);
        return vao;
      };
      this.sparkBuf = gl.createBuffer(); this.sparkVAO = mkVAO(this.sparkBuf);
      this.ringRef = null;

      // 岸线路灯与楼顶航标灯：作为常亮的"星体"粒子，随水面倒影一起渲染
      const rnd = FW.mulberry32(7), lamps = [];
      const lamp = (x, y, z, r, g, b, size) => lamps.push(x, y, z, 0, 0, 0, 0, 1e9, r, g, b, size, 0, 0, 4, rnd());
      for (let i = 0; i < 260; i++) {
        const a = (rnd() * 2 - 1) * (i < 190 ? 1.25 : Math.PI), r = 1215 + rnd() * 30;
        const warm = rnd() < 0.75, k = 0.5 + rnd() * 0.9;
        lamp(r * Math.sin(a), 3 + rnd() * 6, -r * Math.cos(a), (warm ? 1.0 : 0.6) * k, (warm ? 0.62 : 0.8) * k, (warm ? 0.28 : 1.0) * k, 1.5);
      }
      this.lampList = lamps;

      this.starData = new Float32Array((60000 + 2600) * 16);
      this.starBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.starData.byteLength, gl.DYNAMIC_DRAW);
      this.starVAO = mkVAO(this.starBuf);
      this.starCount = 0;
    }

    uploadSparks(ring) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkBuf);
      if (ring !== this.ringRef) {
        this.ringRef = ring;
        gl.bufferData(gl.ARRAY_BUFFER, ring.data, gl.DYNAMIC_DRAW);
        ring.pendStart = ring.head; ring.pending = 0;
        return;
      }
      if (ring.pending <= 0) return;
      const start = ring.pendStart, cnt = ring.pending;
      if (cnt >= ring.cap) gl.bufferSubData(gl.ARRAY_BUFFER, 0, ring.data);
      else if (start + cnt <= ring.cap) gl.bufferSubData(gl.ARRAY_BUFFER, start * 64, ring.data, start * 16, cnt * 16);
      else {
        const first = ring.cap - start;
        gl.bufferSubData(gl.ARRAY_BUFFER, start * 64, ring.data, start * 16, first * 16);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, ring.data, 0, (cnt - first) * 16);
      }
      ring.pendStart = ring.head; ring.pending = 0;
    }

    /* ---------- 长方体：城市天际线 + 发射驳船 ---------- */
    initBoxes() {
      const gl = this.gl;
      const faces = [
        [[1, 0, 0], [[.5, 0, -.5], [.5, 0, .5], [.5, 1, .5], [.5, 1, -.5]]],
        [[-1, 0, 0], [[-.5, 0, .5], [-.5, 0, -.5], [-.5, 1, -.5], [-.5, 1, .5]]],
        [[0, 0, 1], [[.5, 0, .5], [-.5, 0, .5], [-.5, 1, .5], [.5, 1, .5]]],
        [[0, 0, -1], [[-.5, 0, -.5], [.5, 0, -.5], [.5, 1, -.5], [-.5, 1, -.5]]],
        [[0, 1, 0], [[-.5, 1, -.5], [.5, 1, -.5], [.5, 1, .5], [-.5, 1, .5]]],
      ];
      const v = [];
      for (const [n, q] of faces) for (const i of [0, 1, 2, 0, 2, 3]) v.push(...q[i], ...n);
      this.cubeBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      this.cubeVerts = v.length / 6;

      const mkVAO = inst => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeBuf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(3, 1);
        gl.bindVertexArray(null);
        return vao;
      };

      // 天际线：城区集中在 -z 方向（默认机位的正前方），其余方向稀疏
      const rnd = FW.mulberry32(229), inst = [];
      for (let i = 0; i < 620; i++) {
        const a = (rnd() * 2 - 1) * Math.PI;
        const dense = Math.exp(-(a * a) / 0.55);
        if (rnd() > 0.16 + 0.84 * dense) continue;
        const r = 1250 + rnd() * rnd() * 1000;
        const tall = dense * rnd();
        const h = 16 + rnd() * 42 + tall * tall * tall * 330;
        const w = 22 + rnd() * 40, d = 22 + rnd() * 40;
        const x = r * Math.sin(a), z = -r * Math.cos(a);
        inst.push(x, z, rnd() * Math.PI, rnd(), w, h, d, 0);
        if (h > 150) this.lampList.push(x, h + 2, z, 0, 0, 0, 0, 1e9, 1.6, 0.08, 0.05, 1.3, 0, 0, 4, rnd());
      }
      this.skyBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
      this.skyVAO = mkVAO(this.skyBuf); this.skyCount = inst.length / 8;
      this.lamps = new Float32Array(this.lampList); this.lampCount = this.lamps.length / 16;

      this.propBuf = gl.createBuffer(); this.propVAO = mkVAO(this.propBuf); this.propCount = 0;
      this.setProps([]);
    }

    /** 驳船 + 炮架 + 布局模式中用户摆放的炮位 */
    setProps(mortars) {
      const gl = this.gl, a = [];
      a.push(0, 0, 0, -1, 250, 1.0, 12, 0);
      for (let i = -5; i <= 5; i++) a.push(i * 21, 0, 0, -0.5, 7, 0.9, 3.4, 1.0);
      for (const m of mortars) {
        if (Math.abs(m.x) > 124 || Math.abs(m.z) > 5.5) a.push(m.x, m.z, 0, -1, 5, 0.9, 5, 0);
        a.push(m.x, m.z, 0, -0.3, 0.9, 1.5, 0.9, 0.9);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.propBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.DYNAMIC_DRAW);
      this.propCount = a.length / 8;
    }

    initSmoke() {
      const gl = this.gl;
      this.smokeData = new Float32Array(420 * 8);
      this.smokeBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.smokeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.smokeData.byteLength, gl.DYNAMIC_DRAW);
      this.smokeVAO = gl.createVertexArray();
      gl.bindVertexArray(this.smokeVAO);
      for (let a = 0; a < 2; a++) {
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 32, a * 16);
        gl.vertexAttribDivisor(a, 1);
      }
      gl.bindVertexArray(null);
      this.smokeCount = 0;
    }

    /* ---------- 各绘制通道 ---------- */
    lights(P) {
      const gl = this.gl;
      gl.uniform4fv(P.u.u_lpos, this.lp);
      gl.uniform3fv(P.u.u_lcol, this.lc);
    }

    drawSky(invVP) {
      const gl = this.gl, P = this.P.sky;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_invVP, false, invVP);
      gl.uniform1f(P.u.u_time, this.wall);
      this.lights(P);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    drawBoxes(vp, cam) {
      const gl = this.gl, P = this.P.bld;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_vp, false, vp);
      gl.uniform3fv(P.u.u_cam, cam);
      this.lights(P);
      gl.bindVertexArray(this.skyVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.cubeVerts, this.skyCount);
      gl.bindVertexArray(this.propVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.cubeVerts, this.propCount);
    }

    drawWater(cam, rough) {
      const gl = this.gl, P = this.P.water;
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_vp, false, cam.vp);
      gl.uniform3fv(P.u.u_cam, cam.pos);
      gl.uniform2f(P.u.u_res, this.w, this.h);
      gl.uniform1f(P.u.u_time, this.wall);
      gl.uniform1f(P.u.u_rough, rough);
      gl.uniform1f(P.u.u_hasRefl, this.opt.reflection ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.refl.tex);
      gl.uniform1i(P.u.u_refl, 0);
      this.lights(P);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    drawSmoke(cam) {
      if (!this.smokeCount) return;
      const gl = this.gl, P = this.P.smoke;
      gl.enable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_view, false, cam.view);
      gl.uniformMatrix4fv(P.u.u_proj, false, cam.proj);
      this.lights(P);
      gl.bindVertexArray(this.smokeVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.smokeCount);
    }

    drawParticles(view, proj, w, h, sim) {
      const gl = this.gl, P = this.P.part;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_view, false, view);
      gl.uniformMatrix4fv(P.u.u_proj, false, proj);
      gl.uniform1f(P.u.u_time, sim.time);
      gl.uniform1f(P.u.u_shutter, this.shutter);
      gl.uniform1f(P.u.u_minPx, 1.15);
      gl.uniform1f(P.u.u_gain, 1.0);
      gl.uniform2f(P.u.u_res, w, h);
      gl.uniform3f(P.u.u_wind, sim.wind.x, 0, sim.wind.z);
      gl.bindVertexArray(this.sparkVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkBuf);
      for (const [start, count] of this.ranges) {
        for (let a = 0; a < 4; a++) gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 64, start * 64 + a * 16);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      gl.bindVertexArray(this.starVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.starCount);
    }

    bloom() {
      const gl = this.gl, m = this.mips;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
      gl.bindVertexArray(this.vaoEmpty);
      gl.activeTexture(gl.TEXTURE0);
      let P = this.P.down;
      gl.useProgram(P.p); gl.uniform1i(P.u.u_tex, 0);
      let src = this.scene;
      for (let i = 0; i < m.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m[i].fbo);
        gl.viewport(0, 0, m[i].w, m[i].h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(P.u.u_px, 1 / src.w, 1 / src.h);
        gl.uniform1f(P.u.u_thr, i === 0 ? 0.22 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = m[i];
      }
      P = this.P.up;
      gl.useProgram(P.p); gl.uniform1i(P.u.u_tex, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = m.length - 2; i >= 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m[i].fbo);
        gl.viewport(0, 0, m[i].w, m[i].h);
        gl.bindTexture(gl.TEXTURE_2D, m[i + 1].tex);
        gl.uniform2f(P.u.u_px, 1 / m[i + 1].w, 1 / m[i + 1].h);
        gl.uniform1f(P.u.u_w, 0.9);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    /* ---------- 一帧 ---------- */
    render(sim, cam, wall, timeScale) {
      const gl = this.gl;
      this.wall = wall % 3600;
      this.shutter = 0.03 * (0.35 + 0.65 * Math.min(1, timeScale));

      this.uploadSparks(sim.ring);
      this.ranges = sim.ring.ranges();
      let n = sim.fillRender(this.starData);
      this.starData.set(this.lamps, n * 16); n += this.lampCount;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.starData, 0, n * 16);
      this.starCount = n;
      this.smokeCount = this.opt.smoke ? sim.fillSmoke(this.smokeData) : 0;
      if (this.smokeCount) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.smokeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.smokeData, 0, this.smokeCount * 8);
      }
      sim.pickLights();
      this.lp = sim.lpos; this.lc = sim.lcol;

      // 1) 水面反射：用关于 y=0 镜像的相机把场景再画一遍（半分辨率）
      if (this.opt.reflection) {
        const R = this.refl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
        gl.viewport(0, 0, R.w, R.h);
        gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
        this.drawSky(cam.invVPM);
        this.drawBoxes(cam.vpM, cam.pos);
        this.drawParticles(cam.viewM, cam.proj, R.w, R.h, sim);
      }

      // 2) 主场景（HDR）
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
      this.drawSky(cam.invVP);
      this.drawBoxes(cam.vp, cam.pos);
      this.drawWater(cam, 0.022 + 0.007 * Math.hypot(sim.wind.x, sim.wind.z));
      this.drawSmoke(cam);
      this.drawParticles(cam.view, cam.proj, this.w, this.h, sim);

      // 3) 辉光 + 合成
      this.bloom();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
      const P = this.P.comp;
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex);
      gl.uniform1i(P.u.u_scene, 0); gl.uniform1i(P.u.u_bloom, 1);
      gl.uniform1f(P.u.u_bloomK, 0.30 * this.opt.bloom);
      gl.uniform1f(P.u.u_exposure, this.opt.exposure);
      gl.uniform1f(P.u.u_time, this.wall);
      gl.bindVertexArray(this.vaoEmpty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  FW.Renderer = Renderer;
})();
