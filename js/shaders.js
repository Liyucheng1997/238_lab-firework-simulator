/* ============ GLSL 着色器（WebGL2 / GLSL ES 3.00） ============ */
'use strict';

FW.SHADERS = (() => {
  const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

  const LIGHTS = `
#define NL 8
uniform vec4 u_lpos[NL];   // xyz 位置, w 光团半径
uniform vec3 u_lcol[NL];   // 颜色 × 强度
`;

  const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03+vec2(17.1,3.7); a *= .5; } return s; }
`;

  /* 夜空基色：天顶深蓝 → 地平线微亮，朝城区方向(-z)叠加暖色城市辉光 */
  const SKYBASE = `
vec3 skyBase(vec3 d){
  float e = max(d.y, 0.0);
  float hz = pow(1.0 - e, 7.0);
  vec3 col = mix(vec3(0.0022,0.0040,0.0115), vec3(0.008,0.011,0.023), hz);
  vec2 h = normalize(d.xz + vec2(1e-5));
  float toward = 0.5 - 0.5*h.y;
  col += vec3(0.050,0.028,0.015) * exp(-e*11.0) * (0.18 + 0.82*toward*toward);
  return col;
}
`;

  /* ---------- 全屏三角形 ---------- */
  const tri_vs = HEAD + `
out vec2 v_uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

  /* ---------- 天空：星空 / 银河 / 月亮 / 高云 / 远山 / 烟花对大气的散射辉光 ---------- */
  const sky_fs = HEAD + LIGHTS + NOISE + SKYBASE + `
in vec2 v_uv;
out vec4 o;
uniform mat4 u_invVP;
uniform float u_time;
void main(){
  vec2 ndc = v_uv*2.0-1.0;
  vec4 pn = u_invVP*vec4(ndc,-1.,1.), pf = u_invVP*vec4(ndc,1.,1.);
  vec3 ro = pn.xyz/pn.w;
  vec3 d = normalize(pf.xyz/pf.w - ro);
  float e = max(d.y, 0.0);
  vec3 col = skyBase(d);

  // 星星：方向空间的立方格点
  vec3 sp = d*150.0; vec3 ip = floor(sp);
  float h = hash13(ip);
  if (h > 0.990) {
    vec3 c = ip + 0.5 + (vec3(hash13(ip+1.7), hash13(ip+5.3), hash13(ip+9.1)) - 0.5)*0.5;
    float s = smoothstep(0.30, 0.0, length(sp - c));
    float tw = 0.72 + 0.28*sin(u_time*(1.5 + h*40.0) + h*100.0);
    vec3 sc = mix(vec3(1.0,0.82,0.66), vec3(0.72,0.84,1.0), hash13(ip+3.1));
    col += sc * s*s * tw * (0.18 + 2.4*pow(hash13(ip+7.7), 7.0)) * smoothstep(0.03, 0.30, e);
  }
  // 银河
  float mw = exp(-pow(dot(d, normalize(vec3(0.35,0.5,0.79)))*3.4, 2.0));
  col += vec3(0.009,0.010,0.016) * mw * fbm(d.xz*7.0 + d.y*3.0) * smoothstep(0.08, 0.5, e);

  // 月亮
  vec3 M = normalize(vec3(0.58, 0.40, -0.71));
  float md = acos(clamp(dot(d, M), -1.0, 1.0));
  float disc = smoothstep(0.0088, 0.0079, md);
  vec2 mq = (d.xy - M.xy)*90.0;
  col = mix(col, vec3(0.95,0.90,0.78)*(0.38 + 0.30*fbm(mq*4.0+4.0)), disc);
  col += vec3(0.020,0.020,0.026)*exp(-md*16.0) + vec3(0.007,0.007,0.010)*exp(-md*4.0);

  // 高云：被城市与烟花照亮
  if (d.y > 0.015) {
    float t = (2400.0 - ro.y)/d.y;
    vec2 cp = ro.xz + d.xz*t;
    float dens = smoothstep(0.50, 0.86, fbm(cp*0.00042 + vec2(u_time*0.004, 0.0)));
    dens *= exp(-t/16000.0) * smoothstep(0.015, 0.10, d.y);
    vec3 cl = vec3(0.010,0.011,0.017) + vec3(0.050,0.032,0.020)*exp(-length(cp + vec2(0.,1600.))/2600.0);
    for (int i=0;i<NL;i++){
      vec3 L = u_lpos[i].xyz - vec3(cp.x, 2400.0, cp.y);
      cl += u_lcol[i] * (6.0e4/(dot(L,L) + 2.0e6));
    }
    col = mix(col, cl, dens*0.75);
  }

  // 烟花辉光：光在含尘大气中的前向散射
  for (int i=0;i<NL;i++){
    vec3 L = u_lpos[i].xyz - ro; float dl = length(L);
    float ang = acos(clamp(dot(d, L/dl), -1.0, 1.0));
    float x = ang/(u_lpos[i].w/dl*1.3 + 0.035);
    col += u_lcol[i] * (0.0075/(1.0 + x*x) + 0.0010);
  }

  // 远山剪影
  vec2 hd = normalize(d.xz + vec2(1e-6));
  float mh = 0.008 + 0.042*fbm(hd*2.3+3.0) + 0.012*fbm(hd*9.0+11.0);
  float mm = smoothstep(mh+0.0012, mh-0.0012, d.y);
  vec3 mcol = vec3(0.0030,0.0040,0.0075) + skyBase(vec3(d.x,0.,d.z))*0.10;
  col = mix(col, mcol, mm);
  o = vec4(col, 1.0);
}`;

  /* ---------- 建筑（实例化长方体）：城市天际线 / 发射驳船 ---------- */
  const bld_vs = HEAD + `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec4 a_i0;   // x, z, yaw, seed
layout(location=3) in vec4 a_i1;   // w, h, d, y0
uniform mat4 u_vp;
out vec3 v_wp; out vec3 v_n; out vec2 v_fuv; out float v_seed; out float v_h;
void main(){
  vec3 lp = a_pos*a_i1.xyz;
  float c = cos(a_i0.z), s = sin(a_i0.z);
  vec3 wp = vec3(a_i0.x + lp.x*c + lp.z*s, a_i1.w + lp.y, a_i0.y - lp.x*s + lp.z*c);
  v_n = vec3(a_nrm.x*c + a_nrm.z*s, a_nrm.y, -a_nrm.x*s + a_nrm.z*c);
  v_fuv = vec2(abs(a_nrm.x) > 0.5 ? lp.z : lp.x, lp.y);
  v_seed = a_i0.w; v_h = a_i1.y; v_wp = wp;
  gl_Position = u_vp*vec4(wp, 1.0);
}`;

  const bld_fs = HEAD + LIGHTS + NOISE + `
in vec3 v_wp; in vec3 v_n; in vec2 v_fuv; in float v_seed; in float v_h;
out vec4 o;
uniform vec3 u_cam;
void main(){
  vec3 N = normalize(v_n);
  float dist = length(u_cam - v_wp);
  float sd = abs(v_seed);
  vec3 lit = vec3(0.0);
  for (int i=0;i<NL;i++){
    vec3 L = u_lpos[i].xyz - v_wp; float d2 = dot(L,L);
    float ndl = max(dot(N, L*inversesqrt(d2)), 0.0)*0.85 + 0.15;
    lit += u_lcol[i]*ndl*(5.0e4/(d2 + 2.0e4));
  }
  vec3 col = vec3(0.0050,0.0055,0.0085)*(0.6 + 0.8*fract(sd*7.31)) + vec3(0.13,0.14,0.16)*lit;
  if (v_seed >= 0.0 && abs(N.y) < 0.5) {
    // 窗户：按 4m×4.2m 的格子随机点亮
    vec2 g = vec2(v_fuv.x/4.0, v_fuv.y/4.2);
    vec2 cell = floor(g), f = fract(g);
    float rnd = hash12(cell + sd*113.0);
    float frac = 0.10 + 0.30*fract(sd*3.7);
    float on = step(rnd, frac);
    float mask = step(0.18,f.x)*step(f.x,0.82)*step(0.22,f.y)*step(f.y,0.76);
    vec3 wc = mix(vec3(1.0,0.70,0.36), vec3(0.66,0.82,1.0), step(0.78, fract(rnd*17.0)))*(0.30 + 0.9*fract(rnd*31.0));
    float fw = max(fwidth(g.x), fwidth(g.y));
    vec3 em = mix(wc*mask*on, vec3(0.90,0.72,0.46)*frac*0.34, smoothstep(0.30, 1.0, fw));
    col += em*0.55*smoothstep(1.0, 6.0, v_wp.y);
  }
  col = mix(col, vec3(0.008,0.010,0.019), 1.0 - exp(-dist/6500.0));
  o = vec4(col, 1.0);
}`;

  /* ---------- 水面：平面反射 + 菲涅尔 + 波浪扰动 + 粗糙面纵向拉伸 ---------- */
  const water_vs = HEAD + `
uniform mat4 u_vp;
out vec3 v_wp;
void main(){
  vec2 p = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1))*2.0-1.0;
  v_wp = vec3(p.x*14000.0, 0.0, p.y*14000.0);
  gl_Position = u_vp*vec4(v_wp, 1.0);
}`;

  const water_fs = HEAD + LIGHTS + NOISE + SKYBASE + `
in vec3 v_wp;
out vec4 o;
uniform sampler2D u_refl;
uniform vec2 u_res;
uniform vec3 u_cam;
uniform float u_time, u_rough, u_hasRefl;
vec2 slopeSum; float lostVar;
void wave(vec2 p, float ang, float lambda, float steep, float fp){
  vec2 dir = vec2(cos(ang), sin(ang));
  float kw = 6.2832/lambda;
  float att = clamp(lambda/(fp*3.0) - 0.5, 0.0, 1.0);   // 小于像素足迹的波不再解析，转入统计粗糙度
  slopeSum += dir*steep*cos(dot(dir,p)*kw + u_time*sqrt(9.81*kw))*att;
  lostVar += steep*steep*0.5*(1.0 - att*att);
}
void main(){
  vec3 toC = u_cam - v_wp; float dist = length(toC); vec3 V = toC/dist;
  vec2 p = v_wp.xz;
  vec2 ft = fwidth(p); float fp = max(ft.x, ft.y);
  slopeSum = vec2(0.0); lostVar = 0.0;
  float amp = 0.6 + u_rough*8.0;
  wave(p, 0.35, 41.0, 0.010*amp, fp);
  wave(p, 1.20, 23.0, 0.018*amp, fp);
  wave(p, 2.15, 12.1, 0.032*amp, fp);
  wave(p, 3.05, 6.3, 0.055*amp, fp);
  wave(p, 4.20, 3.1, 0.055*amp, fp);
  wave(p, 5.30, 1.7, 0.050*amp, fp);
  vec2 s = slopeSum + (vec2(vnoise(p*1.9 + u_time*0.7), vnoise(p*1.9 + 31.0 - u_time*0.6)) - 0.5)*0.10*clamp(1.2/(fp*3.0), 0.0, 1.0);
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float cosv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98*pow(1.0 - cosv, 5.0);
  fres = min(fres, 0.86) * (1.0 - 0.25*clamp(sqrt(lostVar)*6.0, 0.0, 1.0));

  vec2 suv = gl_FragCoord.xy/u_res;
  vec2 vh = normalize(V.xz + vec2(1e-5));
  vec2 off = vec2(dot(s, vec2(-vh.y, vh.x))*0.30, dot(s, vh)*1.10);
  float sigma = sqrt(lostVar + u_rough*u_rough)*1.25;
  float ign = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 refl = vec3(0.0); float ws = 0.0;
  for (int j=0;j<9;j++){
    float t = (float(j) + ign)/9.0*2.0 - 1.0;
    float w = exp(-t*t*2.4);
    vec2 uv = clamp(suv + off + vec2(t*sigma*0.10, t*sigma), vec2(0.002), vec2(0.998));
    refl += texture(u_refl, uv).rgb*w; ws += w;
  }
  refl /= ws;
  vec3 hzc = skyBase(vec3(-V.x, 0.0, -V.z));
  refl = mix(hzc*0.8, refl, u_hasRefl);

  vec3 deep = vec3(0.0012,0.0026,0.0048);
  vec3 col = mix(deep, refl, fres);
  // 烟花光在近处水体中的漫散射
  for (int i=0;i<NL;i++){
    vec3 L = u_lpos[i].xyz - v_wp;
    col += u_lcol[i]*vec3(0.5,0.75,1.0)*(60.0/(dot(L,L) + 4.0e4))*(1.0 - fres);
  }
  col = mix(col, hzc*0.55, smoothstep(2500.0, 12500.0, dist));
  o = vec4(col, 1.0);
}`;

  /* ---------- 硝烟：受烟花照明的柔性公告板 ---------- */
  const smoke_vs = HEAD + LIGHTS + `
layout(location=0) in vec4 a_ps;    // xyz, 半径
layout(location=1) in vec4 a_misc;  // 不透明度, 种子, 旋转, -
uniform mat4 u_view, u_proj;
out vec2 v_q; out vec3 v_light; out float v_alpha; out float v_seed;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1))*2.0-1.0;
  vec4 vc = u_view*vec4(a_ps.xyz, 1.0);
  float cr = cos(a_misc.z), sr = sin(a_misc.z);
  vc.xy += vec2(c.x*cr - c.y*sr, c.x*sr + c.y*cr)*a_ps.w;
  gl_Position = u_proj*vc;
  vec3 lit = vec3(0.016,0.016,0.022);
  for (int i=0;i<NL;i++){
    vec3 L = u_lpos[i].xyz - a_ps.xyz;
    lit += u_lcol[i]*(2600.0/(dot(L,L) + 2600.0 + a_ps.w*a_ps.w));
  }
  v_light = lit; v_q = c; v_alpha = a_misc.x; v_seed = a_misc.y;
}`;

  const smoke_fs = HEAD + NOISE + `
in vec2 v_q; in vec3 v_light; in float v_alpha; in float v_seed;
out vec4 o;
void main(){
  float r = length(v_q);
  if (r > 1.0) discard;
  float n = fbm(v_q*1.7 + v_seed*37.0);
  float a = smoothstep(1.0, 0.15, r + (n - 0.5)*0.75) * v_alpha;
  o = vec4(v_light*0.55*a, a);
}`;

  /* ---------- 粒子：无状态解析轨迹 + 速度方向拉伸（运动模糊）+ 能量守恒的亚像素处理 ----------
     a_p0 = 出生位置 xyz, 出生时刻
     a_v0 = 出生速度 xyz, 寿命
     a_col = 颜色 rgb(HDR) / 余烬时为 (强度, 初温kK, 末温kK), 半径 m
     a_fx  = 线性阻尼率 1/s, 终端下落速度 m/s, 种类, 随机种子
     种类: 0 余烬(黑体冷却)  1 焰色  2 延时闪光(glitter)  3 频闪  4 星体(由 CPU 逐帧给定) */
  const part_vs = HEAD + `
layout(location=0) in vec4 a_p0;
layout(location=1) in vec4 a_v0;
layout(location=2) in vec4 a_col;
layout(location=3) in vec4 a_fx;
uniform mat4 u_view, u_proj;
uniform float u_time, u_shutter, u_minPx, u_gain;
uniform vec2 u_res;
uniform vec3 u_wind;
out vec2 v_q; out float v_len; out vec3 v_color; out float v_core;

vec3 blackbody(float t){   // t = 温度/100 K
  float g = clamp((99.4708*log(t) - 161.1196)/255.0, 0.0, 1.0);
  float b = t <= 19.0 ? 0.0 : clamp((138.5177*log(t - 10.0) - 305.0448)/255.0, 0.0, 1.0);
  return vec3(1.0, pow(g, 2.2), pow(b, 2.2));
}
float hash11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }

void main(){
  float age = u_time - a_p0.w, life = a_v0.w, kind = a_fx.z, seed = a_fx.w;
  bool star = kind > 3.5;
  if (!star && (age < 0.0 || age >= life)) { gl_Position = vec4(2.,2.,2.,1.); return; }
  float k = a_fx.x;
  vec3 p, pp;
  if (k < 1e-4) {
    p = star ? a_p0.xyz : a_p0.xyz + a_v0.xyz*age;
    pp = p - a_v0.xyz*u_shutter;
  } else {
    // 线性阻力 + 重力 + 风的闭式解：p(t) = p0 + vt·t + (v0 - vt)(1 - e^{-kt})/k
    float wf = 0.35 + 0.65*clamp(a_p0.y/200.0, 0.0, 1.0);
    vec3 vt = u_wind*wf - vec3(0.0, a_fx.y, 0.0);
    vec3 dv = a_v0.xyz - vt;
    p = a_p0.xyz + vt*age + dv*((1.0 - exp(-k*age))/k);
    float ag2 = max(age - u_shutter, 0.0);
    pp = a_p0.xyz + vt*ag2 + dv*((1.0 - exp(-k*ag2))/k);
  }
  if (p.y < 0.0) { gl_Position = vec4(2.,2.,2.,1.); return; }

  float x = star ? 0.0 : age/life;
  vec3 col; float core = 0.0;
  if (kind < 0.5) {
    float T = mix(a_col.y, a_col.z, pow(x, 0.6));
    float fl = 0.65 + 0.7*hash11(seed*71.3 + floor(u_time*22.0 + seed*9.0));
    col = blackbody(T*10.0)*a_col.x*pow(T/a_col.y, 3.2)*fl*smoothstep(1.0, 0.82, x);
  } else if (kind < 1.5) {
    float f = 1.0 - x; col = a_col.rgb*f*f;
  } else if (kind < 2.5) {
    float tf = 0.30 + 0.62*seed;
    float dt = (x - tf)*life;
    col = a_col.rgb*(dt >= 0.0 ? exp(-dt*26.0) : 0.02);
    core = 0.5;
  } else if (kind < 3.5) {
    float ph = fract(age*(4.5 + 4.0*seed) + seed*7.0);
    col = a_col.rgb*(ph < 0.20 ? 1.0 : 0.012)*(1.0 - x*x);
    core = 0.5;
  } else { col = a_col.rgb; core = 1.0; }

  vec4 vc = u_view*vec4(p, 1.0), vp = u_view*vec4(pp, 1.0);
  float dist = -vc.z;
  if (dist < 0.5) { gl_Position = vec4(2.,2.,2.,1.); return; }
  float pxPerM = u_proj[1][1]*u_res.y*0.5/dist;
  float rad = a_col.w, rpx = rad*pxPerM, gain = u_gain;
  if (rpx < u_minPx) { float s = rpx/u_minPx; gain *= s*s; rad = u_minPx/pxPerM; }   // 亚像素粒子：放大到最小像素并等比压低亮度
  vec2 dxy = vc.xy - vp.xy; float len = length(dxy);
  vec2 dir = len > 1e-5 ? dxy/len : vec2(1.0, 0.0);
  float cx = float(gl_VertexID & 1)*2.0-1.0, cy = float(gl_VertexID >> 1)*2.0-1.0;
  vec3 base = cx < 0.0 ? vp.xyz : vc.xyz;
  base.xy += dir*cx*rad + vec2(-dir.y, dir.x)*cy*rad;
  gl_Position = u_proj*vec4(base, 1.0);
  float ln = len/rad;
  v_q = vec2(cx < 0.0 ? -1.0 : ln + 1.0, cy);
  v_len = ln; v_core = core;
  v_color = col*gain/(1.0 + ln*0.55);
}`;

  const part_fs = HEAD + `
in vec2 v_q; in float v_len; in vec3 v_color; in float v_core;
out vec4 o;
void main(){
  float dx = v_q.x - clamp(v_q.x, 0.0, v_len);
  float r2 = dx*dx + v_q.y*v_q.y;
  float a = exp(-r2*4.2) - 0.015;
  if (a <= 0.0) discard;
  float taper = v_len > 0.02 ? mix(0.25, 1.0, clamp(v_q.x/v_len, 0.0, 1.0)) : 1.0;
  vec3 c = v_color*a*taper;
  // 白热内核：星体中心过曝发白，外圈保留焰色
  float lum = dot(v_color, vec3(0.30, 0.50, 0.20));
  c += vec3(lum)*pow(a, 5.0)*0.55*v_core*taper;
  o = vec4(c, 1.0);
}`;

  /* ---------- 辉光（Bloom）：13 点降采样 / 3x3 帐篷升采样 ---------- */
  const down_fs = HEAD + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_px; uniform float u_thr;
vec3 S(vec2 d){ return texture(u_tex, v_uv + d*u_px).rgb; }
void main(){
  vec3 a=S(vec2(-2,2)), b=S(vec2(0,2)), c=S(vec2(2,2)), d=S(vec2(-2,0)), e=S(vec2(0,0)), f=S(vec2(2,0)),
       g=S(vec2(-2,-2)), h=S(vec2(0,-2)), i=S(vec2(2,-2)), j=S(vec2(-1,1)), k=S(vec2(1,1)), l=S(vec2(-1,-1)), m=S(vec2(1,-1));
  vec3 col = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  if (u_thr > 0.0) {
    float br = max(col.r, max(col.g, col.b));
    col *= clamp((br - u_thr)/max(br, 1e-4), 0.0, 1.0);
    col = min(col, vec3(60.0));
  }
  o = vec4(col, 1.0);
}`;

  const up_fs = HEAD + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_px; uniform float u_w;
vec3 S(vec2 d){ return texture(u_tex, v_uv + d*u_px).rgb; }
void main(){
  vec3 col = S(vec2(0,0))*4.0 + (S(vec2(-1,0))+S(vec2(1,0))+S(vec2(0,-1))+S(vec2(0,1)))*2.0
           + S(vec2(-1,-1))+S(vec2(1,-1))+S(vec2(-1,1))+S(vec2(1,1));
  o = vec4(col*(u_w/16.0), 1.0);
}`;

  /* ---------- 合成：辉光叠加 → 曝光 → ACES 色调映射 → 暗角 / 抖动 ---------- */
  const comp_fs = HEAD + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_scene, u_bloom;
uniform float u_bloomK, u_exposure, u_time;
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec3 c = texture(u_scene, v_uv).rgb + texture(u_bloom, v_uv).rgb*u_bloomK;
  c *= u_exposure;
  vec2 q = v_uv - 0.5;
  c *= 1.0 - 0.42*pow(length(q)*1.28, 2.6);
  c = aces(c);
  c = pow(c, vec3(1.0/2.2));
  c += (hash(gl_FragCoord.xy + fract(u_time)*61.0) - 0.5)/255.0;
  o = vec4(c, 1.0);
}`;

  return { tri_vs, sky_fs, bld_vs, bld_fs, water_vs, water_fs, smoke_vs, smoke_fs, part_vs, part_fs, down_fs, up_fs, comp_fs };
})();
