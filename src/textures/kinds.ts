/**
 * Per-surface drawing code (GLSL bodies of the lamina layers).
 *
 * Every body fills `col` (display-space RGB). Conventions that keep the
 * textures seamless: counts passed in `u_param` are whole numbers, per-cell
 * hashes use `mod(cell, count)` and `HD_hatch` takes whole-number steps.
 * `u_colorA..D` is the pigment ramp (dark to light), `u_ink` the pen colour
 * and `u_extra` a secondary colour (mortar, moss, ...).
 */

const wrap = (code) => /* glsl */ `
void main() {
  vec4 f_out = vec4(0.0);
  {
    vec2 uv = v_uv;
${code}
    f_out = vec4(col, u_alpha);
  }
  return f_out;
}
`;

// u_param: x furrow columns, z birch (1) or furrowed (0) bark
const bark = wrap(/* glsl */ `
    float cols = u_param.x;
    float birch = u_param.z;
    vec2 w = HD_warp(uv, 4.0, 0.05);

    float streak = HD_fbm(uv, vec2(cols * 1.5, 3.0));
    vec3 col = HD_ramp(streak);

    float x = w.x * cols;
    float ridge = HD_h12(vec2(mod(floor(x), cols), 1.0) + u_seed);
    col = mix(col, HD_ramp(ridge), 0.5);
    float ed = min(fract(x), 1.0 - fract(x));
    col *= 0.8 + 0.35 * smoothstep(0.0, 0.5, ed);

    float width = 0.04 + 0.08 * HD_noise(uv, vec2(cols, 9.0));
    float gate = smoothstep(0.28, 0.5, HD_noise(uv + 0.31, vec2(cols, 5.0)));
    float fiss = HD_line(ed, width, 0.05) * mix(0.55, 1.0, gate) * (1.0 - birch);
    float tick = HD_hatch(w, cols * 2.0, 23.0, 0.3, 0.8) * (1.0 - smoothstep(0.05, 0.3, ed))
      * smoothstep(0.4, 0.6, HD_noise(uv + 0.7, vec2(cols, 7.0))) * (1.0 - birch);

    float ry = w.y * 14.0;
    float rid = mod(floor(ry), 14.0);
    float len = 0.05 + 0.1 * HD_h12(vec2(rid, 9.0) + u_seed);
    float dx = abs(fract(w.x - HD_h12(vec2(rid, 3.0) + u_seed) + 0.5) - 0.5);
    float dash = (1.0 - smoothstep(len * 0.6, len, dx)) * HD_line(fract(ry) - 0.5, 0.07, 0.12);
    float dx2 = abs(fract(w.x - HD_h12(vec2(rid, 21.0) + u_seed) + 0.5) - 0.5);
    float dash2 = (1.0 - smoothstep(len * 0.4, len * 0.7, dx2)) * HD_line(fract(ry) - 0.5, 0.05, 0.1)
      * step(0.4, HD_h12(vec2(rid, 5.0) + u_seed));
    float marks = max(dash, dash2) * birch;

    col = mix(col, u_ink, clamp(fiss * 0.9 + tick * 0.35 + marks * 0.85, 0.0, 1.0));
`);

// u_param: x leaf clumps across the tile. Clumps are discs on a jittered grid drawn in
// random order (the highest one covering a pixel wins), like the puffy outlines of a
// drawn tree crown: light on top, pen line and hatching on the shaded underside.
const foliage = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 per = vec2(N);
    vec2 w = HD_warp(uv, 7.0, 0.04);
    vec2 p = w * N;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float wash = HD_fbm(uv, vec2(3.0));

    float topH = -1.0;
    float topR = 1.0;
    float topD = 0.0;
    vec2 topV = vec2(0.0);
    float topId = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 cell = mod(ip + g, per);
        vec3 hh = vec3(HD_h12(cell + u_seed * 5.1 + 0.3), HD_h12(cell + u_seed * 2.3 + 1.7), HD_h12(cell + u_seed * 1.1 + 8.1));
        vec2 r = fp - (g + 0.2 + 0.6 * HD_h22(cell + u_seed * 3.7));
        float rad = 0.6 + 0.3 * hh.y;
        float d = HD_blob(r, hh);
        if (d < rad && hh.x > topH) {
          topH = hh.x;
          topR = rad;
          topD = d;
          topV = r;
          topId = hh.z;
        }
      }
    }
    float shadow = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 cell = mod(ip + g, per);
        vec3 hh = vec3(HD_h12(cell + u_seed * 5.1 + 0.3), HD_h12(cell + u_seed * 2.3 + 1.7), HD_h12(cell + u_seed * 1.1 + 8.1));
        vec2 r = fp - (g + 0.2 + 0.6 * HD_h22(cell + u_seed * 3.7));
        if (hh.x > topH) {
          shadow = max(shadow, 1.0 - smoothstep(0.0, 0.22, HD_blob(r, hh) - (0.6 + 0.3 * hh.y)));
        }
      }
    }

    vec3 col = HD_ramp(0.02 + 0.1 * wash);
    if (topH >= 0.0) {
      vec2 n = topV / topR;
      float lit = dot(n, vec2(-0.55, 0.83));
      float t0 = 0.3 + 0.32 * topId + 0.25 * (wash - 0.5);
      col = HD_ramp(clamp(t0 + 0.32 * lit, 0.0, 1.0));
      float crescent = smoothstep(0.3, 0.8, lit) * smoothstep(0.45, 0.9, topD / topR);
      col = mix(col, HD_ramp(min(t0 + 0.55, 1.0)), crescent * 0.75);
      col *= 1.0 - 0.4 * shadow;

      float shade = smoothstep(-0.1, 0.8, -lit);
      float rim = topR - topD;
      float hatch = HD_hatch(w, N * 3.0, N * 4.0, 0.22, 0.7) * shade * smoothstep(0.1, 0.4, rim);
      float lw = 0.04 + 0.07 * shade;
      float line = (1.0 - smoothstep(lw * 0.55, lw, rim)) * (0.4 + 0.6 * shade)
        * (0.7 + 0.3 * HD_noise(uv, vec2(14.0))) * smoothstep(0.08, 0.2, HD_noise(uv + 0.5, vec2(10.0)) + 0.3 * shade);
      col = mix(col, u_ink, clamp(line * 0.9 + hatch * 0.28, 0.0, 1.0));
    }
`);

// u_param: x needle tufts across the tile, y half angle of the fan. A tuft is a few
// needles hanging down from one point; light needles win over dark ones and a pen
// halo surrounds them, so the order of drawing never matters (and the tile repeats).
const needles = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 per = vec2(N);
    vec2 w = HD_warp(uv, 5.0, 0.02);
    vec2 p = w * N;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float wash = HD_fbm(uv, vec2(3.0));

    float tone = 0.0;
    float halo = 0.0;
    float cover = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 cell = mod(ip + g, per);
        vec2 base = g + 0.1 + 0.8 * HD_h22(cell + u_seed * 3.1);
        float th = HD_h12(cell + u_seed * 1.3 + 0.7);
        for (int k = 0; k < 7; k++) {
          float fk = float(k);
          float nh = HD_h12(cell * 7.0 + fk + u_seed * 2.1);
          float a = (fk - 3.0) * u_param.y / 3.0 + (nh - 0.5) * 0.25;
          vec2 dv = vec2(sin(a), -cos(a));
          float len = 0.5 + 0.35 * HD_h12(cell + fk * 3.7 + 4.1 + u_seed);
          vec2 d = fp - base;
          float t = clamp(dot(d, dv), 0.0, len);
          float dist = length(d - dv * t);
          float wd = 0.075 * (1.0 - 0.55 * t / len);
          float cov = 1.0 - smoothstep(wd * 0.5, wd, dist);
          cover = max(cover, cov);
          tone = max(tone, cov * (0.35 + 0.5 * nh + 0.15 * t / len + 0.2 * (th - 0.5)));
          halo = max(halo, 1.0 - smoothstep(wd, wd * 2.4, dist));
        }
      }
    }
    vec3 col = HD_ramp(0.12 + 0.25 * wash);
    col = mix(col, u_ink, halo * 0.45);
    col = mix(col, HD_ramp(clamp(0.15 + 0.7 * tone + 0.2 * (wash - 0.5), 0.0, 1.0)), cover);
`);

// Rock: large angular plates, contour lines on some plate edges and two-way hatching
// in the shaded parts, like a pen drawing of boulders.
const rock = wrap(/* glsl */ `
    vec2 w = HD_warp(uv, 5.0, 0.05);
    float wash = HD_fbm(uv, vec2(3.0));
    vec4 v = HD_voro(w * 3.0, vec2(3.0), 1.0);
    float tonal = clamp(0.38 + 0.34 * wash + 0.28 * (v.z - 0.5), 0.0, 1.0);
    vec3 col = HD_ramp(tonal);
    float edge = v.y - v.x;
    float gate = smoothstep(0.35, 0.6, HD_noise(uv + 0.2, vec2(6.0)));
    float crack = HD_line(edge, 0.014, 0.04) * mix(0.2, 1.0, gate);
    float shade = 1.0 - smoothstep(0.35, 0.6, tonal);
    float zone = smoothstep(0.35, 0.6, HD_noise(uv + 0.5, vec2(5.0)));
    float h1 = HD_hatch(w, 11.0, 13.0, 0.18, 1.0);
    float h2 = HD_hatch(w, 13.0, -11.0, 0.14, 1.0) * smoothstep(0.8, 0.95, shade) * 0.6;
    float hatch = max(h1, h2) * shade * zone;
    col = mix(col, u_ink, clamp(max(crack * 0.7, hatch * 0.4), 0.0, 1.0));
    float sp = step(0.95, HD_h12(floor(uv * 128.0) + u_seed));
    col = mix(col, HD_ramp(0.0), sp * 0.4);
`);

// u_param: x bricks across, y courses, z mortar half width
const brick = wrap(/* glsl */ `
    float cols = u_param.x;
    float rows = u_param.y;
    vec2 w = HD_warp(uv, 7.0, 0.012);
    float ry = w.y * rows;
    float row = floor(ry);
    float fy = fract(ry);
    float rx = w.x * cols + mod(row, 2.0) * 0.5;
    float ci = floor(rx);
    float fx = fract(rx);
    float d = min(min(fx, 1.0 - fx) / cols, min(fy, 1.0 - fy) / rows);

    vec2 id = vec2(mod(ci, cols), mod(row, rows));
    vec3 b = HD_ramp(HD_h12(id + u_seed));
    b = mix(b, HD_ramp(HD_fbm(uv, vec2(5.0))), 0.35);
    b *= 0.84 + 0.16 * smoothstep(0.0, 0.035, d);
    float hb = HD_hatch(w, 16.0, 9.0, 0.16, 1.0) * step(0.55, HD_h12(id + 7.7 + u_seed)) * smoothstep(0.012, 0.05, d);
    b = mix(b, b * 0.72, hb);

    float gap = u_param.z;
    vec3 col = mix(u_extra, b, smoothstep(gap, gap + 0.006, d));
    float pen = HD_line(d - gap, 0.002, 0.004) * (0.55 + 0.45 * HD_noise(uv, vec2(14.0)))
      * smoothstep(0.1, 0.25, HD_noise(uv + 0.5, vec2(10.0)));
    col = mix(col, u_ink, clamp(pen * 0.85, 0.0, 1.0));
`);

const stoneCode = (moss) => /* glsl */ `
    vec2 w = HD_warp(uv, 6.0, 0.014);
    vec3 cy = HD_cuts(w.y, u_param.y, u_param.w, 1.0, 0.0);
    vec3 cx = HD_cuts(w.x, u_param.x, 0.7, cy.z * 40.0, cy.z);
    float d = min(min(cy.x, cy.y), min(cx.x, cx.y));
    float rr = HD_h12(vec2(cx.z, cy.z) * 31.0 + u_seed);
    vec3 st = HD_ramp(rr);
    st = mix(st, HD_ramp(HD_fbm(uv, vec2(4.0))), 0.4);
    st *= 1.0 + 0.12 * smoothstep(0.03, 0.0, cy.y) - 0.16 * smoothstep(0.03, 0.0, cy.x);
    st *= 0.86 + 0.14 * smoothstep(0.0, 0.04, d);
    float hs = HD_hatch(w, 13.0, 8.0, 0.16, 1.0) * smoothstep(0.55, 0.7, HD_noise(uv + 0.6, vec2(4.0))) * smoothstep(0.015, 0.05, d);
    st = mix(st, st * 0.75, hs);
    ${moss ? /* glsl */ `
    float mm = HD_fbm(uv + 0.2, vec2(4.0)) + 0.3 * smoothstep(0.1, 0.0, cy.y);
    vec4 mv = HD_voro(w * 9.0, vec2(9.0), 1.0);
    float mask = smoothstep(0.62, 0.66, mm);
    vec3 mossy = mix(u_extra * 0.7, u_extra * 1.25, mv.z);
    mossy *= 0.85 + 0.2 * smoothstep(0.0, 0.3, mv.y - mv.x);
    st = mix(st, mossy, mask);
    float mline = HD_line(mm - 0.6, 0.006, 0.012) * 0.45;
    st = mix(st, u_ink, mline);
    ` : ''}
    float gap = 0.006;
    vec3 col = mix(u_ink * 1.6 + 0.12, st, smoothstep(gap, gap + 0.005, d));
    float pen = HD_line(d - gap, 0.002, 0.004) * (0.6 + 0.4 * HD_noise(uv, vec2(12.0)))
      * smoothstep(0.1, 0.25, HD_noise(uv + 0.5, vec2(9.0)));
    col = mix(col, u_ink, clamp(pen * 0.9, 0.0, 1.0));
`;

// u_param: x blocks per course, y courses, w cut jitter
const stone = wrap(stoneCode(false));
const mossy = wrap(stoneCode(true));

// u_param: x cells across, y gap width
const cobble = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 w = HD_warp(uv, 6.0, 0.02);
    vec2 p = w * N;
    vec4 v = HD_voro(p, vec2(N), 0.8);
    float edge = v.y - v.x;
    vec2 dir = HD_voroDir(p, vec2(N), 0.8);
    float wash = HD_fbm(uv, vec2(4.0));
    vec3 st = HD_ramp(clamp(v.z * 0.7 + 0.3 * wash, 0.0, 1.0));
    float lit = dot(normalize(-dir + vec2(0.0001)), vec2(-0.6, 0.8));
    float rim = smoothstep(0.1, 0.5, v.x);
    st *= 1.0 + 0.18 * lit * rim;
    float h = HD_hatch(w, 14.0, 10.0, 0.16, 1.0) * smoothstep(0.1, 0.9, -lit) * rim;
    st = mix(st, st * 0.7, h * 0.7);
    float gapw = u_param.y;
    vec3 col = mix(u_extra, st, smoothstep(gapw, gapw + 0.05, edge));
    float pen = HD_line(edge - gapw, 0.02, 0.05) * (0.6 + 0.4 * HD_noise(uv, vec2(12.0)));
    col = mix(col, u_ink, clamp(pen * 0.8, 0.0, 1.0));
`);

const plaster = wrap(/* glsl */ `
    vec2 w = HD_warp(uv, 4.0, 0.05);
    float wash = HD_fbm(w, vec2(3.0));
    vec3 col = HD_ramp(wash);
    col = mix(col, HD_ramp(HD_fbm(uv + 0.3, vec2(9.0))), 0.25);
    float sweep = HD_noise(w, vec2(6.0, 2.0));
    col *= 0.94 + 0.1 * smoothstep(0.35, 0.65, sweep);
    vec4 v = HD_voro(w * 3.0, vec2(3.0), 1.0);
    float crack = HD_line(v.y - v.x, 0.012, 0.03) * smoothstep(0.5, 0.65, HD_noise(uv + 0.4, vec2(5.0)));
    float h = HD_hatch(w, 8.0, 5.0, 0.12, 1.5) * smoothstep(0.55, 0.7, HD_noise(uv + 0.1, vec2(4.0)));
    col = mix(col, u_ink, clamp(crack * 0.7 + h * 0.18, 0.0, 1.0));
`);

// u_param: x planks across
const planks = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 w = HD_warp(uv, 6.0, 0.012);
    float x = w.x * N;
    float id = mod(floor(x), N);
    float ed = min(fract(x), 1.0 - fract(x));
    vec3 cy = HD_cuts(w.y, 2.0, 0.8, id * 13.0 + 2.0, HD_h12(vec2(id, 5.0) + u_seed));
    float r = HD_h12(vec2(id, cy.z * 50.0) + u_seed);
    vec3 col = HD_ramp(r);

    float g = HD_fbm(uv + vec2(r, 0.0), vec2(N * 3.0, 2.0)) * 9.0;
    float grain = 1.0 - smoothstep(0.06, 0.16, abs(fract(g) - 0.5));
    col = mix(col, col * 0.72, grain * 0.55);

    float kx = 0.3 + 0.4 * HD_h12(vec2(id, 11.0) + u_seed);
    float ky = HD_h12(vec2(id, 12.0) + u_seed);
    float hasKnot = step(0.55, HD_h12(vec2(id, 13.0) + u_seed));
    vec2 kd = vec2((fract(x) - kx) / N, abs(fract(w.y - ky + 0.5) - 0.5));
    float rr = length(kd * vec2(1.0, 0.45)) * 55.0;
    float rings = (1.0 - smoothstep(0.1, 0.25, abs(fract(rr) - 0.5))) * (1.0 - smoothstep(1.5, 2.6, rr)) * hasKnot;
    col = mix(col, u_ink, rings * 0.55);

    float seam = HD_line(ed / N, 0.0022, 0.004);
    float joint = HD_line(min(cy.x, cy.y), 0.0022, 0.004);
    float pen = max(seam, joint) * (0.6 + 0.4 * HD_noise(uv, vec2(12.0)));
    col *= 0.88 + 0.12 * smoothstep(0.0, 0.2, ed);
    col = mix(col, u_ink, clamp(pen * 0.9, 0.0, 1.0));
`);

// u_param: x diagonal reflection streaks (whole number), y pen hatch density
const glass = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 w = HD_warp(uv, 5.0, 0.012);
    float d = HD_fbm(uv, vec2(3.0, 3.0));
    vec3 col = HD_ramp(clamp(0.15 + 0.5 * d, 0.0, 1.0));

    float s = (w.x + w.y) * N;
    float band = 1.0 - smoothstep(0.06, 0.16, abs(fract(s) - 0.5));
    float thin = 1.0 - smoothstep(0.015, 0.04, abs(fract(s * 2.0 + 0.25) - 0.5));
    col = mix(col, HD_ramp(0.95), band * 0.55 + thin * 0.2);

    float h = HD_hatch(w, u_param.y, -u_param.y, 0.1, 1.2) * smoothstep(0.55, 0.75, HD_noise(uv + 0.2, vec2(4.0)));
    float edge = HD_line(abs(fract(s) - 0.5) - 0.16, 0.004, 0.006) * 0.35;
    col = mix(col, u_ink, clamp(h * 0.3 + edge, 0.0, 1.0));
`);

// u_param: x diagonal glints (whole number). Warm lit pane: glowing blotches with a few pen scribbles.
const lamp = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 w = HD_warp(uv, 4.0, 0.02);
    float d = HD_fbm(uv, vec2(2.0, 2.0));
    vec3 col = HD_ramp(clamp(0.2 + 0.8 * d, 0.0, 1.0));

    float s = (w.x - w.y) * N;
    float glint = 1.0 - smoothstep(0.05, 0.13, abs(fract(s) - 0.5));
    col = mix(col, HD_ramp(1.0), glint * 0.5);

    float blot = smoothstep(0.55, 0.75, HD_noise(uv + 0.6, vec2(3.0)));
    float h = HD_hatch(w, 6.0, 6.0, 0.1, 1.4) * blot;
    col = mix(col, u_ink, clamp(h * 0.25, 0.0, 1.0));
`);

// u_param: x tiles per row, y rows (even), z roundness of the lower edge
const shingle = wrap(/* glsl */ `
    float C = u_param.x;
    float R = u_param.y;
    float curve = u_param.z;
    vec2 w = HD_warp(uv, 6.0, 0.012);
    float ry = w.y * R;
    float row = floor(ry);
    float fy = fract(ry);
    float rx = w.x * C + mod(row, 2.0) * 0.5;
    float fx = fract(rx);
    float bottom = curve * pow(abs(fx - 0.5) * 2.0, 2.0);
    float rowSel = row;
    float colSel = floor(rx);
    float fxSel = fx;
    float edgeDist = fy - bottom;
    float shadow = 0.0;
    if (fy < bottom) {
      rowSel = row - 1.0;
      float rx2 = w.x * C + mod(rowSel, 2.0) * 0.5;
      colSel = floor(rx2);
      fxSel = fract(rx2);
      edgeDist = bottom - fy;
      shadow = 1.0 - smoothstep(0.0, 0.35, edgeDist);
    }
    vec2 id = vec2(mod(colSel, C), mod(rowSel, R));
    vec3 col = HD_ramp(HD_h12(id + u_seed));
    col = mix(col, HD_ramp(HD_fbm(uv, vec2(5.0))), 0.3);
    col *= 1.0 - 0.32 * shadow;
    col *= 0.9 + 0.12 * smoothstep(0.0, 0.5, edgeDist);
    float h = HD_hatch(w, 14.0, 6.0, 0.16, 1.0) * smoothstep(0.5, 0.7, HD_noise(uv + 0.2, vec2(5.0)));
    col = mix(col, col * 0.75, h);
    float pen = max(1.0 - smoothstep(0.02, 0.07, edgeDist), 1.0 - smoothstep(0.012, 0.04, min(fxSel, 1.0 - fxSel)));
    pen *= 0.6 + 0.4 * HD_noise(uv, vec2(12.0));
    col = mix(col, u_ink, clamp(pen * 0.85, 0.0, 1.0));
`);

// A whole leaf, drawn once and laid on each blade by its UVs: stem at v = 0, tip
// at v = 1, midrib at u = 0.5. u_param: x pairs of side veins
const leaf = wrap(/* glsl */ `
    float pairs = u_param.x;
    vec2 w = HD_warp(uv, 4.0, 0.02);
    float ax = abs(w.x - 0.5);
    float wash = HD_fbm(uv, vec2(3.0));
    float lit = clamp(0.6 + 0.45 * (wash - 0.5) - 0.8 * ax - 0.15 * uv.y, 0.0, 1.0);
    vec3 col = HD_ramp(lit);

    float along = w.y - 0.5 * ax - 0.7 * ax * ax;
    float s = along * pairs + (HD_noise(uv, vec2(5.0)) - 0.5) * 0.4;
    float dv = abs(fract(s) - 0.5) / pairs;
    float reach = smoothstep(0.03, 0.12, along) * (1.0 - smoothstep(0.84, 0.97, w.y)) * (1.0 - smoothstep(0.33, 0.46, ax));
    float pale = HD_line(dv, 0.006, 0.012) * reach;
    float shade = HD_line(dv - 0.03, 0.012, 0.03) * reach;
    col = mix(col, HD_ramp(min(lit + 0.35, 1.0)), pale * 0.8);
    col *= 1.0 - 0.18 * shade;
    float pen = HD_line(dv - 0.011, 0.0025, 0.005) * reach * (0.5 + 0.5 * HD_noise(uv, vec2(9.0)));

    float tip = 1.0 - smoothstep(0.9, 0.99, w.y);
    float rw = mix(0.035, 0.007, w.y);
    float rib = (1.0 - smoothstep(rw, rw + 0.01, ax)) * tip;
    col = mix(col, HD_ramp(min(lit + 0.4, 1.0)), rib * 0.9);
    float ribPen = HD_line(ax - rw, 0.004, 0.008) * tip;

    float h = HD_hatch(w, 5.0, 16.0, 0.12, 0.8) * smoothstep(0.22, 0.45, ax) * smoothstep(0.3, 0.6, HD_noise(uv + 0.4, vec2(4.0)));
    col = mix(col, u_ink, clamp(pen * 0.35 + ribPen * 0.55 + h * 0.22, 0.0, 1.0));
`);

// A forest seen from above (the far canopy layer of `Forest`). u_param: x tree crowns
// across the tile. Crowns sit on a jittered grid; the tallest one covering a pixel wins
// and taller neighbours cast their shadow away from the sun. Inside a crown, small leaf
// lobes (periodic Worley cells) catch the light, with pen rims and hatching in the shade.
const canopy = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 per = vec2(N);
    vec2 sun = vec2(-0.55, 0.83);
    vec2 w = HD_warp(uv, 6.0, 0.03);
    vec2 p = w * N;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float wash = HD_fbm(uv, vec2(3.0));

    float topH = -1.0;
    float topR = 1.0;
    float topD = 0.0;
    vec2 topV = vec2(0.0);
    float topId = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 cell = mod(ip + g, per);
        vec3 hh = vec3(HD_h12(cell + u_seed * 5.1 + 0.3), HD_h12(cell + u_seed * 2.3 + 1.7), HD_h12(cell + u_seed * 1.1 + 8.1));
        vec2 r = fp - (g + 0.2 + 0.6 * HD_h22(cell + u_seed * 3.7));
        float rad = 0.52 + 0.22 * hh.y;
        float d = HD_blob(r, hh);
        if (d < rad && hh.x > topH) {
          topH = hh.x;
          topR = rad;
          topD = d;
          topV = r;
          topId = hh.z;
        }
      }
    }
    float shadow = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 cell = mod(ip + g, per);
        vec3 hh = vec3(HD_h12(cell + u_seed * 5.1 + 0.3), HD_h12(cell + u_seed * 2.3 + 1.7), HD_h12(cell + u_seed * 1.1 + 8.1));
        vec2 r = fp - (g + 0.2 + 0.6 * HD_h22(cell + u_seed * 3.7));
        if (hh.x > topH) {
          shadow = max(shadow, 1.0 - smoothstep(-0.04, 0.14, HD_blob(r + sun * 0.2, hh) - (0.52 + 0.22 * hh.y)));
        }
      }
    }

    vec3 col = HD_ramp(0.02 + 0.08 * wash);
    if (topH >= 0.0) {
      vec2 n = topV / topR;
      float lit = dot(n, sun);
      vec2 lp = w * N * 3.0;
      vec4 lv = HD_voro(lp, per * 3.0, 1.0);
      vec2 ld = HD_voroDir(lp, per * 3.0, 1.0);
      float lobeLit = dot(normalize(-ld + vec2(0.0001)), sun) * smoothstep(0.05, 0.4, lv.x);
      float t0 = 0.3 + 0.3 * topId + 0.2 * (wash - 0.5);
      col = HD_ramp(clamp(t0 + 0.3 * lit + 0.16 * lobeLit, 0.0, 1.0));
      col *= 1.0 - 0.25 * HD_line(lv.y - lv.x, 0.015, 0.05);

      float shade = smoothstep(-0.1, 0.8, -lit);
      float rim = topR - topD;
      float hatch = HD_hatch(w, N * 4.0, N * 5.0, 0.22, 0.7) * shade * smoothstep(0.08, 0.3, rim);
      float lw = 0.03 + 0.06 * shade;
      float line = (1.0 - smoothstep(lw * 0.55, lw, rim)) * (0.35 + 0.65 * shade)
        * (0.7 + 0.3 * HD_noise(uv, vec2(14.0)));
      col = mix(col, u_ink, clamp(line * 0.85 + hatch * 0.25, 0.0, 1.0));
    }
    col *= 1.0 - 0.45 * shadow;
`);

// u_param: x blade columns across the tile, y flower density (0..1)
// Grass: soft green wash with lighter meadow patches, short pen strokes for
// tufts of blades (dark at the root, light tips) and a few dotted flowers.
const grass = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 w = HD_warp(uv, 4.0, 0.04);
    float wash = HD_fbm(uv, vec2(3.0));
    vec4 pv = HD_voro(w * 4.0, vec2(4.0), 1.0);
    vec3 col = HD_ramp(clamp(0.2 + 0.55 * wash + 0.3 * (pv.z - 0.5), 0.0, 1.0));

    float rows = N;
    float ry = w.y * rows;
    float rid = mod(floor(ry), rows);
    float fy = fract(ry);
    float bx = w.x * N * 3.0 + HD_h12(vec2(rid, 4.0) + u_seed) * 3.0;
    float bid = mod(floor(bx), N * 3.0);
    float hs = HD_h12(vec2(bid, rid) + u_seed);
    float lean = (HD_h12(vec2(bid, rid) + u_seed + 7.0) - 0.5) * 0.8;
    float fx = fract(bx) - 0.5 + (1.0 - fy) * lean;
    float len = 0.45 + 0.45 * hs;
    float body = (1.0 - smoothstep(len * 0.75, len, 1.0 - fy)) * step(0.3, hs);
    float blade = HD_line(fx, 0.05 * fy + 0.015, 0.04) * body;
    float tuft = smoothstep(0.3, 0.6, HD_noise(uv + 0.4, vec2(6.0)));
    col = mix(col, u_ink, blade * fy * 0.55 * (0.4 + 0.6 * tuft));
    col = mix(col, HD_ramp(1.0), blade * (1.0 - fy) * 0.35 * tuft);

    float h = HD_hatch(w, 5.0, 19.0, 0.14, 1.2) * (1.0 - smoothstep(0.3, 0.5, wash));
    col = mix(col, u_ink, h * 0.22);

    vec4 fv = HD_voro(w * 10.0, vec2(10.0), 0.9);
    float fl = step(1.0 - u_param.y, fv.z) * (1.0 - smoothstep(0.1, 0.14, fv.x));
    vec3 petal = mix(u_extra, vec3(1.0), 0.25 * step(0.5, fract(fv.z * 7.0)));
    col = mix(col, petal, fl);
    col = mix(col, vec3(0.95, 0.8, 0.3), fl * (1.0 - smoothstep(0.03, 0.05, fv.x)));
`);

// u_param: x weave threads across the tile, y stripes (0 = plain), z stripe half width
// Cloth: woven canvas with soft fold shading, hatched creases and optional stripes in u_extra.
const cloth = wrap(/* glsl */ `
    float N = u_param.x;
    vec2 w = HD_warp(uv, 4.0, 0.03);
    float wash = HD_fbm(w, vec2(3.0));
    vec3 col = HD_ramp(clamp(0.3 + 0.55 * wash, 0.0, 1.0));
    float fold = HD_noise(w, vec2(5.0, 1.0));
    col *= 0.86 + 0.22 * smoothstep(0.2, 0.8, fold);

    vec2 t = uv * N;
    float wx = abs(fract(t.x) - 0.5);
    float wy = abs(fract(t.y) - 0.5);
    float chk = mod(floor(t.x) + floor(t.y), 2.0);
    float weave = mix(wx, wy, chk);
    col *= 0.93 + 0.1 * (1.0 - smoothstep(0.1, 0.5, weave));

    float S = u_param.y;
    float on = step(0.5, S);
    float sd = abs(fract(w.x * max(S, 1.0)) - 0.5);
    float stripe = on * (1.0 - smoothstep(u_param.z, u_param.z + 0.02, sd));
    col = mix(col, u_extra * (0.85 + 0.25 * wash), stripe);
    col = mix(col, u_ink, HD_line(sd - u_param.z, 0.006, 0.012) * on * 0.45);

    float crease = HD_hatch(w, 3.0, 14.0, 0.14, 1.2) * (1.0 - smoothstep(0.25, 0.45, fold));
    col = mix(col, u_ink, crease * 0.3);
    float seam = HD_line(fract(w.y * 2.0) - 0.5, 0.004, 0.006) * step(0.5, HD_noise(uv + 0.6, vec2(4.0, 1.0)));
    col = mix(col, u_ink, seam * 0.35);
`);

// Water: blue wash, wavy ripple contours in u_extra, short white glints and a
// little hatching in the deeper (darker) parts.
const water = wrap(/* glsl */ `
    vec2 w = HD_warp(uv, 3.0, 0.08);
    float n = HD_fbm(w, vec2(3.0));
    vec3 col = HD_ramp(n);
    float r = HD_fbm(w + 0.37, vec2(4.0)) * 7.0;
    float ripple = HD_line(fract(r) - 0.5, 0.025, 0.035) * smoothstep(0.3, 0.6, HD_noise(uv + 0.2, vec2(5.0)));
    col = mix(col, u_extra, ripple * 0.6);
    float ry = w.y * 24.0;
    float rid = mod(floor(ry), 24.0);
    float gx = abs(fract(w.x * 3.0 - HD_h12(vec2(rid, 2.0) + u_seed)) - 0.5);
    float glint = (1.0 - smoothstep(0.05, 0.09, gx)) * HD_line(fract(ry) - 0.5, 0.07, 0.08)
      * step(0.55, HD_h12(vec2(rid, 7.0) + u_seed));
    col = mix(col, vec3(1.0), glint * 0.85);
    float hatch = HD_hatch(w, 2.0, 17.0, 0.12, 1.0) * (1.0 - smoothstep(0.3, 0.5, n));
    col = mix(col, u_ink, hatch * 0.3);
`);

export const BODIES = { bark, foliage, needles, rock, brick, stone, mossy, cobble, plaster, planks, shingle, glass, lamp, leaf, canopy, grass, cloth, water };
