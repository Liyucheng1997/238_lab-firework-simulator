/* ============ 环绕镜头：拖拽旋转 / 滚轮推拉 / 机位预设 / 自动巡航 ============ */
'use strict';

(() => {
  const M4 = FW.M4, clamp = FW.clamp;
  const D = Math.PI / 180;

  /** 机位预设。camY 表示把镜头放在离水面该高度处（由此反算俯仰角） */
  const PRESETS = {
    audience: { name: '观众席', yaw: 0, target: [0, 84, 0], dist: 500, camY: 3 },
    close: { name: '近景仰望', yaw: 0.25, target: [0, 150, 0], dist: 330, camY: 2.5 },
    aerial: { name: '航拍', yaw: 0.6, target: [0, 115, 0], dist: 720, pitch: 22 * D },
    top: { name: '俯瞰', yaw: 0.3, target: [0, 70, 0], dist: 680, pitch: 76 * D },
    side: { name: '侧翼', yaw: 1.45, target: [0, 110, 0], dist: 600, camY: 6 },
    far: { name: '湖畔远眺', yaw: -0.2, target: [0, 110, 0], dist: 980, camY: 2.5 },
  };

  class Camera {
    constructor() {
      this.fov = 58 * D;
      this.near = 1; this.far = 40000;
      this.yaw = 0; this.pitch = 0; this.dist = 620; this.target = [0, 95, 0];
      this.g = { yaw: 0, pitch: 0, dist: 620, target: [0, 95, 0] };   // 目标值，实际值平滑逼近
      this.autoOrbit = false;
      this.shift = 0; this.shiftGoal = 0;
      this.pos = [0, 3, 620];
      this.view = M4.create(); this.proj = M4.create(); this.vp = M4.create(); this.invVP = M4.create();
      this.viewM = M4.create(); this.vpM = M4.create(); this.invVPM = M4.create();
      this.aspect = 1.6;
      this.preset('audience', true);
    }

    preset(id, snap) {
      const p = PRESETS[id];
      if (!p) return;
      const g = this.g;
      g.yaw = this.wrapNear(p.yaw, g.yaw);      // 沿最短方向转过去
      g.dist = p.dist; g.target = p.target.slice();
      g.pitch = p.pitch !== undefined ? p.pitch : Math.asin(clamp((p.camY - p.target[1]) / p.dist, -1, 1));
      if (snap) { this.yaw = g.yaw; this.pitch = g.pitch; this.dist = g.dist; this.target = g.target.slice(); }
    }
    /** 返回与 ref 相差不超过 π 的、等价于 a 的角度 */
    wrapNear(a, ref) {
      const two = Math.PI * 2;
      return a + Math.round((ref - a) / two) * two;
    }

    orbit(dx, dy) {
      this.g.yaw -= dx * 0.0055;
      this.g.pitch = clamp(this.g.pitch + dy * 0.0045, -1.2, 1.5);
      this.clampGoal();
    }
    zoom(f) { this.g.dist = clamp(this.g.dist * f, 90, 1050); this.clampGoal(); }
    pan(dx, dy) {
      const s = this.g.dist * 0.0016, cy = Math.cos(this.g.yaw), sy = Math.sin(this.g.yaw);
      this.g.target[0] = clamp(this.g.target[0] - dx * s * cy, -400, 400);
      this.g.target[2] = clamp(this.g.target[2] + dx * s * sy, -400, 400);
      this.g.target[1] = clamp(this.g.target[1] + dy * s, 10, 420);
      this.clampGoal();
    }
    /** 镜头不得低于水面 2 米 */
    clampGoal() {
      const g = this.g, minP = Math.asin(clamp((2 - g.target[1]) / g.dist, -1, 1));
      if (g.pitch < minP) g.pitch = minP;
    }

    update(dt, aspect) {
      const g = this.g;
      if (this.autoOrbit) g.yaw += dt * 0.07;
      const a = 1 - Math.exp(-dt * 7);
      this.yaw += (g.yaw - this.yaw) * a;
      this.pitch += (g.pitch - this.pitch) * a;
      this.dist += (g.dist - this.dist) * a;
      for (let i = 0; i < 3; i++) this.target[i] += (g.target[i] - this.target[i]) * a;
      const cp = Math.cos(this.pitch), t = this.target;
      this.pos[0] = t[0] + this.dist * Math.sin(this.yaw) * cp;
      this.pos[1] = Math.max(1.5, t[1] + this.dist * Math.sin(this.pitch));
      this.pos[2] = t[2] + this.dist * Math.cos(this.yaw) * cp;
      this.aspect = aspect;
      // 俯仰接近竖直时换一个 up 向量，避免万向节退化
      const up = Math.abs(this.pitch) > 1.45 ? [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)] : [0, 1, 0];
      M4.lookAt(this.view, this.pos, t, up);
      M4.perspective(this.proj, this.fov, aspect, this.near, this.far);
      this.shift += (this.shiftGoal - this.shift) * a;
      this.proj[8] = -this.shift;        // 镜头偏移：让画面中心避开左侧面板
      M4.mul(this.vp, this.proj, this.view);
      M4.invert(this.invVP, this.vp);
      M4.mirrorY(this.viewM, this.view);
      M4.mul(this.vpM, this.proj, this.viewM);
      M4.invert(this.invVPM, this.vpM);
    }

    /** 屏幕归一化坐标 (-1..1, y 向上) → 世界射线 */
    ray(nx, ny) {
      const m = this.invVP;
      const un = z => {
        const w = m[3] * nx + m[7] * ny + m[11] * z + m[15];
        return [(m[0] * nx + m[4] * ny + m[8] * z + m[12]) / w, (m[1] * nx + m[5] * ny + m[9] * z + m[13]) / w, (m[2] * nx + m[6] * ny + m[10] * z + m[14]) / w];
      };
      const a = un(-1), b = un(1);
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = 1 / Math.hypot(d[0], d[1], d[2]);
      return { o: this.pos.slice(), d: [d[0] * l, d[1] * l, d[2] * l] };
    }

    /** 世界坐标 → 屏幕像素；镜头背后返回 null */
    project(x, y, z, W, H) {
      const m = this.vp;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.01) return null;
      return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * H, w];
    }
  }

  FW.Camera = Camera;
  FW.CAM_PRESETS = PRESETS;
})();
